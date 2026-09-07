import { configureRuntime, getHost, invalidate, disposeRuntime, runAction, isBusy, isEnabled } from '../platform/lifecycle.js';
import { readStore, patchSummaryStore } from '../platform/store.js';
import { DEFAULT_SETTINGS, CONFIG } from './config.js';
import { summarySnapshot } from './settingsSchema.js';
import { loadSettings, getSettings, saveSettings, migrateOldSettings, getKeyForUrl } from './storage.js';
import { buildPanelHtml } from './ui/panel.js';
import { bindPanelEvents, refreshEntryList, refreshMegaEntryList, refreshStatus } from './ui/panelEvents.js';
import { autoTriggerSummary } from './summary.js';
import { reconcileChatBinding } from './worldbook.js';
import { restoreTaskState, detachTaskState } from './taskState.js';
import { createTaskView, refreshTaskWidget } from './ui/taskView.js';

const LEGACY_ID='3eb6e3eb-7a14-47dc-900c-759cd2f0bf64';
let panel=null, slot=null, stops=[], refreshPromise=null;
let savedPanel=null;
let bindingChain=Promise.resolve();
let taskView=null, queued=false, queueTimer=null;
function schedule() {
  queued=true; if(queueTimer || isBusy())return;
  queueTimer=setTimeout(async()=>{
    queueTimer=null; if(isBusy())return;
    queued=false;
    await runAction(()=>autoTriggerSummary(),{quiet:true});
  },150);
}
function flatten(trees){return trees.flatMap(item=>item.type==='folder'?flatten(item.scripts??[]):[item]);}
export async function migrate() {
  const raw=readStore();
  let old;
  if(typeof getScriptTrees==='function') {
    const scripts=flatten(getScriptTrees({type:'preset'}));
    old=scripts.find(s=>s.id===LEGACY_ID);
    if(!old) {
      const matches=scripts.filter(s=>['【命定之诗】总结','命定之诗总结助手'].includes(s.name) && /destined-journey-summarizer|summary_assistant_settings/.test(s.content??''));
      if(matches.length>1)throw new Error('发现多个旧总结脚本，未自动迁移或停用；请先保留一个需要接续的旧总结脚本');
      old=matches[0];
    }
  }
  if(!raw.summary_assistant_migration || raw[CONFIG.SETTINGS_VAR_KEY]?.promptVersion !== DEFAULT_SETTINGS.promptVersion || raw[CONFIG.SETTINGS_VAR_KEY]?.behaviorVersion !== DEFAULT_SETTINGS.behaviorVersion) {
    let oldSettings=old?.data?.[CONFIG.SETTINGS_VAR_KEY];
    if(old) oldSettings=getVariables({type:'script',script_id:old.id})?.[CONFIG.SETTINGS_VAR_KEY]??oldSettings;
    const selected=raw[CONFIG.SETTINGS_VAR_KEY]??(old?{...oldSettings,enabled:old.enabled === true}:DEFAULT_SETTINGS);
    const settings=summarySnapshot(migrateOldSettings(structuredClone(selected)));
    patchSummaryStore({
      [CONFIG.SETTINGS_VAR_KEY]:settings,
      summary_assistant_secrets:{keysByUrl:{...raw.summary_assistant_secrets?.keysByUrl,[settings.customApiUrl.trim()]:raw.summary_assistant_secrets?.keysByUrl?.[settings.customApiUrl.trim()]??raw.summary_assistant_secrets?.customApiKey??selected.customApiKey??''}},
      summary_assistant_migration:{...raw.summary_assistant_migration,version:2,from:raw.summary_assistant_migration?.from??old?.id??null},
    });
  }
  if(old?.enabled) {
    if(typeof updateScriptTreesWith!=='function') throw new Error('请更新酒馆助手后重试迁移：旧总结脚本尚未停用。');
    await updateScriptTreesWith(trees=>{for(const item of flatten(trees))if(item.id===old.id)item.enabled=false;return trees;},{type:'preset'});
  }
}
export async function initialize(host) {
  configureRuntime({...host,remount,busy: value => {host.busy?.(value);taskView?.refresh();if(!value){refresh();if(queued)schedule();}}});
  try { await migrate(); await loadSettings(); }
  catch(error) { throw new Error('总结配置未加载，原数据已保留：'+error.message, {cause:error}); }
  const subscribe=(event,handler)=>{if(event)stops.push(eventOn(event,handler));};
  for(const name of ['MESSAGE_RECEIVED','MESSAGE_EDITED','MESSAGE_DELETED','MESSAGE_SWIPED'])subscribe(tavern_events[name],schedule);
  const contextChanged=()=>{
    detachTaskState(); invalidate(); panel?._dispose?.(); savedPanel?._dispose?.(); savedPanel=null;
    clearTimeout(queueTimer);queueTimer=null;queued=false;
    bindingChain=bindingChain.catch(()=>{}).then(()=>reconcileChatBinding());
    bindingChain.then(()=>{restoreTaskState();remount();schedule();}).catch(error=>{if(error.name!=='AbortError')host.status(error.message,'error');});
  };
  subscribe(tavern_events.CHAT_CHANGED,contextChanged);
  subscribe(tavern_events.PRESET_CHANGED,contextChanged);
  subscribe(tavern_events.OAI_PRESET_CHANGED_AFTER,contextChanged);
  subscribe(tavern_events.WORLDINFO_UPDATED,()=>{refresh();schedule();});
  await reconcileChatBinding().catch(error=>host.status(error.message,'error'));
  restoreTaskState();taskView=createTaskView(host);schedule();
}
export function mount(target) {
  if(!target)return;
  slot=target;
  if(savedPanel) { panel=savedPanel;target.append(panel);savedPanel=null;refreshTaskWidget(panel);return refresh(); }
  panel=target.ownerDocument.createElement('div');panel.innerHTML=buildPanelHtml(getSettings());
  target.append(panel);bindPanelEvents(panel,getSettings());refreshTaskWidget(panel);refresh();
}
export function detach() {
  if(!panel)return;
  panel._flush?.().catch(error=>getHost()?.status(error.message,'error'));
  panel.remove();savedPanel=panel;panel=null;slot=null;
}
export function remount() {
  savedPanel?._dispose?.();savedPanel=null;
  if(!slot?.isConnected)return;
  panel?._dispose?.();slot.replaceChildren();panel=null;mount(slot);
}
export function flush() { return (panel??savedPanel)?._flush?.()??Promise.resolve(); }
export function refresh() {
  taskView?.refresh();
  if(!panel?.isConnected)return Promise.resolve();
  refreshTaskWidget(panel);
  if(isBusy())return Promise.resolve();
  if(refreshPromise)return refreshPromise;
  const current=panel;
  refreshPromise=(async()=>{await current._refreshWorldbooks?.();await Promise.all([refreshEntryList(current,current.querySelector('#sa-start-mega-summary')?.textContent.includes('退出')),refreshMegaEntryList(current),refreshStatus(current)]);})()
    .catch(error=>{if(error.name!=='AbortError')getHost()?.status(error.message,'error');}).finally(()=>{refreshPromise=null;});
  return refreshPromise;
}
export function capture() {return summarySnapshot(getSettings());}
export function validate(value) {return summarySnapshot(migrateOldSettings(structuredClone(value)));}
export async function apply(value) {
  if(isBusy())throw new Error('总结任务尚未结束，请稍候再切换配置');
  await saveSettings({...validate(value),customApiKey:getKeyForUrl(value.customApiUrl)});remount();
}
export function busy(){return isBusy();}
export function dispose() {
  detachTaskState();taskView?.destroy();taskView=null;clearTimeout(queueTimer);queueTimer=null;queued=false;
  panel?._dispose?.();savedPanel?._dispose?.();savedPanel=null;panel=null;slot=null;
  for(const stop of stops){if(typeof stop==='function')stop();else stop?.stop?.();}stops=[];
  disposeRuntime();
}
