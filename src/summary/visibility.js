import { assertRecordWritable, writeVariableKeys, setChatMessages, captureContext, checkContext } from '../platform/lifecycle.js';
import { sourceOf } from './provenance.js';

export const VISIBILITY_OVERRIDES_KEY = 'summary_assistant_visibility_overrides';
export const VISIBILITY_AUTOMATION_KEY = 'summary_assistant_visibility_auto';
const AUTO_HIDDEN_KEY = 'summary_assistant_auto_hidden_floors';
export function allFloorMessages() {
  const last = getLastMessageId();
  return last < 0 ? [] : getChatMessages(`0-${last}`, {role:'all',hide_state:'all',include_swipes:false}).filter(message => Number.isInteger(message.message_id) && message.message_id >= 0).sort((a,b)=>a.message_id-b.message_id);
}
export function readVisibilityOverrides(messages = allFloorMessages()) {
  const saved = getVariables({type:'chat'})?.[VISIBILITY_OVERRIDES_KEY] ?? {};
  return Object.fromEntries(messages.filter(message => {
    const value = saved[message.message_id];
    return value && typeof value.hidden === 'boolean' && value.fingerprint === sourceOf(message).fingerprint;
  }).map(message => [message.message_id,saved[message.message_id]]));
}
export function readVisibilityAutomation(fallback = true) {
  const saved = getVariables({type:'chat'})?.[VISIBILITY_AUTOMATION_KEY];
  if (typeof saved === 'boolean') return saved;
  return Object.keys(readVisibilityOverrides()).length ? false : fallback !== false;
}
export function setFloorVisibilityAutomation(enabled) {
  assertRecordWritable();
  if (typeof enabled !== 'boolean') throw new Error('自动隐藏开关状态无效');
  const patch = {[VISIBILITY_AUTOMATION_KEY]:enabled};
  if (enabled) {
    const messages = allFloorMessages(), ids = new Set(messages.map(message=>message.message_id));
    const owned = getVariables({type:'chat'})?.[AUTO_HIDDEN_KEY] ?? [];
    // Return every valid assistant-managed floor to the automatic policy, even
    // without summary coverage. Native manual choices remain outside ownership.
    patch[AUTO_HIDDEN_KEY] = [...new Set([...owned.filter(id=>ids.has(id)), ...Object.keys(readVisibilityOverrides(messages)).map(Number)])];
    patch[VISIBILITY_OVERRIDES_KEY] = {};
  }
  writeVariableKeys(patch,{type:'chat'});
}
export function visibilitySnapshot(floors = new Set()) {
  const messages = allFloorMessages(), overrides = readVisibilityOverrides(messages);
  const owned = new Set(getVariables({type:'chat'})?.[AUTO_HIDDEN_KEY] ?? []);
  const counts = { total:messages.length, shown:0, hidden:0, user:0, assistant:0, system:0, shownUser:0, shownAssistant:0, covered:0 };
  const groups = [];
  for (const message of messages) {
    const id=message.message_id, hidden=!!message.is_hidden, role=message.role, covered=floors.has(id);
    counts[hidden?'hidden':'shown']++;
    counts[role === 'user' ? 'user' : role === 'assistant' ? 'assistant' : 'system']++;
    if (!hidden && role === 'user') counts.shownUser++;
    if (!hidden && role === 'assistant') counts.shownAssistant++;
    if (covered) counts.covered++;
    const state = hidden ? owned.has(id) ? '自动隐藏' : '手动隐藏' : overrides[id]?.hidden === false ? '手动显示' : '显示';
    const key = [role,hidden,covered,state,id===0].join('|'), previous=groups.at(-1);
    if (previous?.key === key && previous.to + 1 === id) { previous.to=id;previous.count++; }
    else groups.push({key,from:id,to:id,count:1,role,hidden,covered,state});
  }
  return {messages,counts,groups,overrides,owned,shownIds:messages.filter(message=>!message.is_hidden).map(message=>message.message_id),hiddenIds:messages.filter(message=>message.is_hidden).map(message=>message.message_id)};
}
export async function setManualFloorVisibility(from, to, hidden, role = 'all') {
  assertRecordWritable();
  const last=getLastMessageId();
  if (![from,to].every(Number.isInteger) || from < 0 || to < from || to > last) throw new Error(`请输入 0—${Math.max(0,last)} 之间、起点不大于终点的整数楼层`);
  if (!['all','user','assistant','system'].includes(role)) throw new Error('消息类型无效');
  const ids=allFloorMessages().filter(message=>message.message_id>=from&&message.message_id<=to&&(role==='all'||message.role===role)).map(message=>message.message_id);
  return setManualFloorVisibilityByIds(ids,hidden);
}
export async function setManualFloorVisibilityByIds(ids, hidden) {
  assertRecordWritable();
  const token=captureContext(), wanted=new Set(ids);
  const messages=allFloorMessages(), selected=messages.filter(message=>wanted.has(message.message_id));
  if(selected.length!==wanted.size)throw new Error('所选楼层已变化，请刷新后重试');
  if(!selected.length)return 0;
  const overrides=readVisibilityOverrides(messages), vars=getVariables({type:'chat'}) ?? {};
  for (const message of selected) overrides[message.message_id]={hidden,fingerprint:sourceOf(message).fingerprint};
  const selectedIds=new Set(selected.map(message=>message.message_id));
  writeVariableKeys({[VISIBILITY_AUTOMATION_KEY]:false,[VISIBILITY_OVERRIDES_KEY]:overrides,[AUTO_HIDDEN_KEY]:(vars[AUTO_HIDDEN_KEY]??[]).filter(id=>!selectedIds.has(id))},{type:'chat'});
  const updates=selected.filter(message=>!!message.is_hidden!==hidden).map(message=>({message_id:message.message_id,is_hidden:hidden}));
  for(let index=0;index<updates.length;index+=200) await setChatMessages(updates.slice(index,index+200),{refresh:'affected'});
  checkContext(token);
  const actual=new Map(allFloorMessages().map(message=>[message.message_id,!!message.is_hidden]));
  if(!selected.every(message=>actual.get(message.message_id)===hidden)) throw new Error('楼层显隐没有全部保存，请重试');
  return updates.length;
}
