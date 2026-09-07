import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import variableMocks from './helpers/tavern-variables.cjs';
import { DEFAULT_SETTINGS, CONFIG } from '../src/summary/config.js';
import { summarySnapshot } from '../src/summary/settingsSchema.js';
import { writePresetStore } from '../src/platform/store.js';
import { configureRuntime, captureContext, checkContext, invalidate, runAction, isBusy, setRuntimeEnabled } from '../src/platform/lifecycle.js';
import { loadSettings, saveSettings, getSettings, updateSettings, getKeyForUrl, migrateOldSettings } from '../src/summary/storage.js';
import { PREVIOUS_ARCHIVE_PROMPTS, PREVIOUS_COMPACT_PROMPTS, THINKING_TEMPLATES, PREFILLS, optionBlocks, activeResultFormat } from '../src/summary/archiveDefaults.js';
import { deleteBoundSummaryBook, getManagedSummaryBookNames } from '../src/summary/worldbook.js';
import { computeSummaryPlan, computeSummaryPlans, shouldAutoTrigger, executeSummary, finalizeMegaSummarySave, startSummaryProcess, startCustomRangeSummaryProcess, skipPendingTask } from '../src/summary/summary.js';
import { callSummaryApi, callMegaSummaryApi } from '../src/summary/api.js';
import { processMessagesByTags } from '../src/summary/messages.js';
import { upsertSummaryEntryByName, upsertMegaSummaryEntry, restoreMegaSummaryToSummaries, applySummarizedFloorsVisibility, writeChatWorldbookBinding, migrateWorldbookEntries, getAllSummaryEntriesForDisplay } from '../src/summary/worldbook.js';
import { migrate } from '../src/summary/service.js';
import { reconcileChatBinding, getActiveWorldbookName } from '../src/summary/worldbook.js';
import { extractSummaryResult } from '../src/summary/result.js';
import { getTask, stopTask, detachTaskState, restoreTaskState, clearTaskLog, beginTask, updateTask, finishTask, selectTaskBatch } from '../src/summary/taskState.js';
import { retryTask, autoTriggerSummary, computeMegaPlan, executeMegaSummary } from '../src/summary/summary.js';
import { getCoverage, getAllSummaryContents, auditArchiveSources, bindWorldbookToChat, deleteSummaryEntry, setSummaryEntryEnabled } from '../src/summary/worldbook.js';
import { readArchive, currentSources } from '../src/summary/provenance.js';
import { expandMacros, compilePrompt } from '../src/summary/macros.js';
import { buildRegeneratePromptParams, buildSummaryPromptParams } from '../src/summary/prompt.js';
import { setFloorVisibilityAutomation, readVisibilityAutomation, VISIBILITY_AUTOMATION_KEY } from '../src/summary/visibility.js';

// Task lifecycle tests use a custom body; strict default formats are tested separately.
const withOptions=(settings,options)=>({...structuredClone(settings),...Object.fromEntries(['promptBlocks','megaPromptBlocks'].map(key=>[key,settings[key].map(block=>optionBlocks(options).find(option=>option.id===block.id)??structuredClone(block))]))});
const FLOW_SETTINGS = withOptions(DEFAULT_SETTINGS,{resultFormat:'free'});
let script,chat,books,messages,globals,ctx,reports;
function reset() {
  if(typeof globalThis.getVariables==='function')detachTaskState();
  script={};chat={};books={};globals=[];messages=[];ctx={chatId:'a',characterId:1};reports=[];
  globalThis.SillyTavern={getContext:()=>ctx,name1:'User',name2:'Character',POPUP_TYPE:{INPUT:1,CONFIRM:2},POPUP_RESULT:{AFFIRMATIVE:1,CANCELLED:0}};
  globalThis.getLoadedPresetName=()=> '命定';
  globalThis.getVariables=option=>structuredClone(option.type==='chat'?chat:script);
  globalThis.replaceVariables=(value,option)=>{if(option.type==='chat')chat=structuredClone(value);else script=structuredClone(value);};
  globalThis.insertOrAssignVariables=(value,option)=>{const next=variableMocks.mergeTavernVariables(getVariables(option),value);replaceVariables(next,option);return next;};
  globalThis.getWorldbookNames=async()=>Object.keys(books);
  globalThis.getGlobalWorldbookNames=()=>[...globals];
  globalThis.rebindGlobalWorldbooks=async names=>{globals=[...names];};
  globalThis.createWorldbook=async(name,entries)=>{books[name]=structuredClone(entries);};
  globalThis.getWorldbook=async name=>structuredClone(books[name]);
  globalThis.updateWorldbookWith=async(name,fn)=>{books[name]=await fn(structuredClone(books[name]));};
  globalThis.createWorldbookEntries=async(name,entries)=>{books[name].push(...structuredClone(entries));};
  globalThis.replaceWorldbook=async(name,entries)=>{books[name]=structuredClone(entries);};
  globalThis.deleteWorldbook=async name=>{delete books[name];};
  globalThis.getLastMessageId=()=>messages.length-1;
  globalThis.getChatMessages=(range,options={})=>{
    const [start,end]=range.split('-').map(Number);
    return structuredClone(messages.filter(m=>m.message_id>=start&&m.message_id<=end&&(options.hide_state!=='hidden'||m.is_hidden)));
  };
  globalThis.setChatMessages=async updates=>{for(const update of updates)Object.assign(messages[update.message_id],update);};
  globalThis.toastr={info(){},success(){},warning(){},error(){}};
  const events=new Map();
  globalThis.eventRemoveListener=(name,fn)=>events.set(name,(events.get(name)??[]).filter(listener=>listener!==fn));
  globalThis.eventMakeLast=(name,fn)=>{eventRemoveListener(name,fn);events.set(name,[...(events.get(name)??[]),fn]);};
  globalThis.summaryReady=async data=>{for(const fn of events.get('chat_completion_settings_ready')??[])await fn(data);return JSON.parse(JSON.stringify(data));};
  delete globalThis.getScriptTrees;delete globalThis.updateScriptTreesWith;
  configureRuntime({status:(...args)=>reports.push(args),popup:async()=>null,chooseFailure:async()=> 'cancel'});
  invalidate();setRuntimeEnabled(false);writeChatWorldbookBinding('book');books.book=[];restoreTaskState();
}
test.beforeEach(reset);

test('summary snapshots use a whitelist, including prompt block fields',()=>{
  const input={...structuredClone(DEFAULT_SETTINGS),customApiKey:'secret',worldbookName:'private',record:'private'};
  input.promptBlocks[0].apiKey='nested-secret';
  const output=summarySnapshot(input);assert(!JSON.stringify(output).includes('secret'));assert(!('worldbookName' in output));
  assert.throws(()=>summarySnapshot({...input,keepFloorCount:30}),/小于/);
  assert.throws(()=>summarySnapshot({...input,promptBlocks:[input.promptBlocks[0],input.promptBlocks[0]]}),/重复/);
});
test('script writes preserve the latest summary and secret namespaces',async()=>{
  await saveSettings({...FLOW_SETTINGS,customApiKey:'secret',triggerFloorCount:40});
  const stale={...script};await saveSettings({...getSettings(),triggerFloorCount:50});
  writePresetStore({...stale,managed_values:{min_hanzi:'2000'}});
  assert.equal(script.summary_assistant_settings.triggerFloorCount,50);assert.equal(script.summary_assistant_secrets.keysByUrl[''],'secret');
  assert(!Object.hasOwn(script.summary_assistant_settings,'customApiKey'));
});
test('failed settings writes propagate and keep the previous in-memory values',async()=>{
  await saveSettings(DEFAULT_SETTINGS);const previous=getSettings();
  globalThis.replaceVariables=()=>{throw Error('disk failed');};
  await assert.rejects(saveSettings({...previous,triggerFloorCount:45}),/disk failed/);assert.deepEqual(getSettings(),previous);
});
test('legacy migration preserves enabled state and custom prompts, once only',async()=>{
  const legacy={id:'3eb6e3eb-7a14-47dc-900c-759cd2f0bf64',enabled:true,data:{summary_assistant_settings:{...DEFAULT_SETTINGS,userPrefix:'旧用户',customApiKey:'old-secret'}}};
  globalThis.getScriptTrees=()=>[legacy];globalThis.updateScriptTreesWith=fn=>fn([legacy]);
  globalThis.getVariables=option=>structuredClone(option.script_id?legacy.data:option.type==='chat'?chat:script);
  await migrate();assert.equal(script.summary_assistant_settings.enabled,true);assert.equal(legacy.enabled,false);assert.equal(script.summary_assistant_secrets.keysByUrl[''],'old-secret');
  script.summary_assistant_settings.userPrefix='新用户';await migrate();assert.equal(script.summary_assistant_settings.userPrefix,'新用户');assert.equal(legacy.data.summary_assistant_settings.userPrefix,'旧用户');
});
test('legacy scripts with a regenerated id migrate by an unambiguous name and loader',async()=>{
  const legacy={id:'user-copy',name:'【命定之诗】总结',content:"import 'destined-journey-summarizer'",enabled:true};
  globalThis.getScriptTrees=()=>[legacy];globalThis.updateScriptTreesWith=fn=>fn([legacy]);
  await migrate();assert.equal(legacy.enabled,false);assert.equal(script.summary_assistant_settings.enabled,true);
  assert.equal(script.summary_assistant_migration.from,'user-copy');
});
test('custom API keys stay with their endpoint when switching configuration',async()=>{
  await saveSettings({...FLOW_SETTINGS,customApiUrl:'https://one.invalid/v1',customApiKey:'one-secret'});
  await updateSettings({customApiUrl:'https://two.invalid/v1'});assert.equal(getSettings().customApiKey,'');
  await updateSettings({customApiKey:'two-secret'});
  await updateSettings({customApiUrl:'https://one.invalid/v1'});assert.equal(getSettings().customApiKey,'one-secret');
  assert.equal(getKeyForUrl('https://two.invalid/v1'),'two-secret');
});
test('threshold counts raw floors, retaining the latest ten',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true});
  seedFloors(29);assert.equal(await shouldAutoTrigger(),false);
  messages.push({message_id:29,role:'assistant',message:'<gametxt>新事件</gametxt>'});assert.equal(await shouldAutoTrigger(),true);
  assert.deepEqual(await computeSummaryPlan(),{startFloor:0,endFloor:19,entryName:'总结0-19楼',lastId:29,unsummarizedCount:30});
});
test('tag extraction ignores thoughts but preserves untagged user input',()=>{
  const result=processMessagesByTags([{id:0,role:'assistant',message:'<think>secret</think><tp>488-1-1</tp><gametxt>故事<!--注释--></gametxt><summary>摘要</summary>'},{id:1,role:'user',message:'无标签'}],['tp','gametxt'],['think'],true);
  assert.equal(result.length,2);assert.equal(result[0].content,'488-1-1\n故事');assert.equal(result[1].content,'无标签');
});
test('summary generation sends resolved ordered prompts and isolates RP history',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true});let request,sent;
  globalThis.generateRaw=async config=>{request=config;sent=await summaryReady({messages:config.ordered_prompts});return 'result';};
  assert.equal(await callSummaryApi({promptBlocks:DEFAULT_SETTINGS.promptBlocks,oldSummaryContent:'OLD',mergedChatText:'CHAT',scanText:'SCAN'}),'result');
  assert(sent.messages.every(p=>typeof p==='object'&&!p.content.includes('<|no-trans|>')));
  assert.deepEqual(request.overrides.chat_history,{prompts:[],with_depth_entries:false});assert.equal(request.max_chat_history,0);assert(request.generation_id.startsWith('destined-summary-'));
  assert(!request.custom_api);
  await saveSettings({...getSettings(),apiMode:'custom',customApiUrl:'https://example.invalid/v1',customApiModel:'model',customApiKey:'secret',temperature:0.4,maxTokens:2048});
  await callMegaSummaryApi({promptBlocks:DEFAULT_SETTINGS.megaPromptBlocks,mergedSummaryText:'records',oldMegaSummaryContent:''});
  assert.equal(request.custom_api.key,'secret');assert.equal(request.custom_api.max_tokens,2048);
});
test('speaker prefixes remain customizable while the AI default avoids the card name',async()=>{
  await saveSettings({...FLOW_SETTINGS,userPrefix:'玩家 {{user}}'});seedFloors(2);let request;
  globalThis.SillyTavern.name2='不应标注为发言者的角色卡名';
  globalThis.generateRaw=async config=>{request=config;return '<summary_result>正文</summary_result>';};
  const params=await buildSummaryPromptParams(0,1);await callSummaryApi(params);
  const material=request.ordered_prompts.find(prompt=>prompt.content.includes('<source_material>')).content;
  assert(material.includes('第 0 楼 · 用户输入（意图，未必实现） · 玩家 User'));
  assert(material.includes('[第 1 楼 · AI 正文（实际剧情） · AI]'));
  assert(!material.includes(SillyTavern.name2));assert.equal(getSettings().assistantPrefix,'AI');
  assert(!material.includes('{{user}}')&&!material.includes('{{char}}'));
  await updateSettings({assistantPrefix:'自定义记录员 {{char}}'});
  await callSummaryApi(await buildSummaryPromptParams(0,1));
  assert(request.ordered_prompts.some(prompt=>prompt.content.includes('自定义记录员 '+SillyTavern.name2)));
  await loadSettings();assert.equal(getSettings().assistantPrefix,'自定义记录员 {{char}}');
});
test('write depths and mega mapping preserve original summary records on restore',async()=>{
  seedFloors(20);
  await saveSettings({...FLOW_SETTINGS,autoHideSummarizedFloors:false});
  await upsertSummaryEntryByName('总结0-9楼','one');await upsertSummaryEntryByName('总结10-19楼','two');
  assert.equal(books.book[0].position.depth,9998);
  await finalizeMegaSummarySave('大总结0-19楼','mega',['总结0-9楼','总结10-19楼']);
  const mega=books.book.find(e=>e.name==='大总结0-19楼');assert.equal(mega.position.depth,9999);assert(books.book.filter(e=>e.name.startsWith('总结')).every(e=>!e.enabled));
  await restoreMegaSummaryToSummaries('大总结0-19楼');assert(books.book.every(e=>e.enabled));assert.equal(books.book.length,2);
});
test('worldbook migration includes mega summaries and leaves unrelated entries',async()=>{
  await saveSettings({...FLOW_SETTINGS,autoHideSummarizedFloors:false});
  books.book=[{name:'总结0-9楼',content:'one'},{name:'大总结0-19楼',content:'mega'},{name:'无关',content:'keep'}];
  await migrateWorldbookEntries('book','new');assert.deepEqual(books.book,[{name:'无关',content:'keep'}]);assert.equal(books.new.length,2);assert.equal(chat.summary_assistant_worldbook,'new');
});
test('auto visibility does not unhide manually hidden floors',async()=>{
  await saveSettings(DEFAULT_SETTINGS);
  messages=Array.from({length:10},(_,i)=>({message_id:i,is_hidden:i===0}));
  await upsertSummaryEntryByName('总结1-5楼','one');assert.equal(messages[0].is_hidden,true);assert.deepEqual(chat.summary_assistant_auto_hidden_floors,[1,2,3,4,5]);
  setFloorVisibilityAutomation(false);await applySummarizedFloorsVisibility();
  assert(messages.slice(0,6).every(m=>m.is_hidden));
  await applySummarizedFloorsVisibility({autoHide:false});
  assert.equal(messages[0].is_hidden,true);assert(messages.slice(1).every(m=>!m.is_hidden));
});
test('duplicate operations are ignored and context changes reject late writes',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true});let finish;let calls=0;
  const task=runAction(async()=>{calls++;await new Promise(r=>finish=r);await upsertSummaryEntryByName('总结0-1楼','late');});
  assert(isBusy());await runAction(async()=>calls++);ctx.chatId='b';finish();await task;
  assert.equal(calls,1);assert.equal(books.book.length,0);assert(!isBusy());
});
test('rapid chat switches retain the previous global binding until reconciled',async()=>{
  globals=['book','shared'];books.b=[];books.c=[];let finish;
  script.summary_assistant_owned_books=['book'];
  chat.summary_assistant_worldbook='b';ctx.chatId='b';
  globalThis.getWorldbookNames=()=>new Promise(resolve=>finish=resolve);
  const transition=reconcileChatBinding();
  ctx.chatId='c';chat.summary_assistant_worldbook='c';invalidate();
  assert.equal(getActiveWorldbookName(),'c');finish(Object.keys(books));
  await assert.rejects(transition,{name:'AbortError'});
  globalThis.getWorldbookNames=async()=>Object.keys(books);
  await reconcileChatBinding();assert.deepEqual(globals,['shared','c']);
});

function seedFloors(count=30) { messages=Array.from({length:count},(_,id)=>({message_id:id,role:id%2?'assistant':'user',name:id%2?'角色':'用户',swipe_id:0,message:id%2?'<gametxt>事件 '+id+'</gametxt>':'我尝试行动 '+id,is_hidden:false})); }
const nextTick=()=>new Promise(resolve=>setImmediate(resolve));
async function waitUntil(predicate) { for(let i=0;i<100;i++){if(predicate())return;await nextTick();}assert.fail('condition did not settle'); }

test('result parser rejects malformed contracts and stores only one complete body',()=>{
  assert.equal(extractSummaryResult('解释<think>检查</think><summary_result>事实</summary_result>结束'),'事实');
  assert.equal(extractSummaryResult('事实</summary_result>',{prefill:'<summary_result>\n'}),'事实');
  for(const value of ['', '事实','<summary_result> </summary_result>','<summary_result>截断','<summary_result>A</summary_result><summary_result>B</summary_result>','<summary_result>A<summary_result>B</summary_result></summary_result>','<summary_result>A</summary_result><summary_result','</summary_result>wrong<summary_result>'])assert.throws(()=>extractSummaryResult(value));
  assert.equal(extractSummaryResult('<summary_result>自由格式</summary_result>'),'自由格式');
  assert.throws(()=>extractSummaryResult('<summary_result>自由格式</summary_result>',{format:'legacy'}));
});
test('coverage finds middle gaps and mega mappings do not cover intervening holes',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true});seedFloors(50);
  books.book=[{name:'总结0-9楼',content:'a',enabled:true},{name:'总结20-29楼',content:'b',enabled:true}];
  const plan=await computeSummaryPlan();assert.equal(plan.startFloor,10);assert.equal(plan.endFloor,19);
  books.book=[{name:'大总结0-29楼',content:'mega',enabled:true}];chat[CONFIG.MEGA_SUMMARY_VAR_KEY]={'大总结0-29楼':['总结0-9楼','总结20-29楼']};
  const {floors}=await getCoverage();assert(!floors.has(10));assert(floors.has(20));
  await assert.rejects(executeMegaSummary(['总结0-9楼','总结20-29楼'],'大总结0-29楼'),/连续/);
});
test('every automatic normal batch is bounded and ends after an AI reply',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true,batchFloorCount:19});seedFloors(100);
  const plan=await computeSummaryPlan();assert.equal(plan.endFloor,17);assert(plan.endFloor-plan.startFloor+1<=19);
});
test('generation saves body then hides without CHAT_CHANGED reloads',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true});seedFloors();let calls=0;
  globalThis.generateRaw=async()=>{calls++;return '额外文字<summary_result>两人抵达城门。</summary_result>额外文字';};
  const original=globalThis.setChatMessages;
  globalThis.setChatMessages=async(updates,options)=>{assert.equal(options.refresh,'affected');assert.equal(books.book[0].content,'两人抵达城门。');await original(updates);};
  assert.equal(await executeSummary(0,19,'总结0-19楼'),true);assert.equal(calls,1);assert.equal(getTask().phase,'complete');
  assert(messages.slice(0,20).every(message=>message.is_hidden));assert(messages.slice(20).every(message=>!message.is_hidden));
  assert.equal(readArchive().records['总结0-19楼'].sources.length,20);
});
test('visibility failures retry only visibility and survive recovery reload',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true});seedFloors();let calls=0;
  globalThis.generateRaw=async()=>{calls++;return '<summary_result>正文</summary_result>';};
  const original=globalThis.setChatMessages;globalThis.setChatMessages=async()=>{throw Error('hide failed');};
  assert.equal(await executeSummary(0,19,'总结0-19楼'),false);assert.equal(getTask().errorKind,'visibility');assert.equal(books.book[0].content,'正文');
  restoreTaskState();globalThis.setChatMessages=original;assert.equal(await retryTask(),true);assert.equal(calls,1);assert(messages[0].is_hidden);
});
test('save failures preserve a valid result and never hide before retry',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true});seedFloors();let calls=0;
  globalThis.generateRaw=async()=>{calls++;return '<summary_result>正文</summary_result>';};
  const original=globalThis.createWorldbookEntries;globalThis.createWorldbookEntries=async()=>{throw Error('save failed');};
  await executeSummary(0,19,'总结0-19楼');assert.equal(getTask().errorKind,'save');assert(messages.every(message=>!message.is_hidden));
  globalThis.createWorldbookEntries=original;await retryTask();assert.equal(calls,1);assert.equal(getTask().phase,'complete');
});
test('one automatic retry uses identical materials and settings, then manual retry refreshes settings',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true,customApiKey:'hidden-key',temperature:0.1});seedFloors();const requests=[];
  globalThis.generateRaw=async config=>{requests.push(config);await updateSettings({temperature:0.9});throw Error('timeout https://host.invalid?key=hidden-key');};
  await executeSummary(0,19,'总结0-19楼');assert.equal(requests.length,2);assert.equal(getTask().phase,'pending');
  const materials=request=>request.ordered_prompts;
  assert.equal(requests[1].custom_api.temperature,0.1);assert.deepEqual(materials(requests[0]),materials(requests[1]));assert(!getTask().details.includes('hidden-key'));
  globalThis.generateRaw=async config=>{requests.push(config);return '<summary_result>重试正文</summary_result>';};
  await retryTask();assert.equal(requests[2].custom_api.temperature,0.9);assert.equal(getTask().phase,'complete');
});
test('stop cancels only its own generation and blocks automatic restart',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true});seedFloors();let resolve,request;const stopped=[];
  globalThis.stopGenerationById=id=>stopped.push(id);globalThis.generateRaw=config=>{request=config;return new Promise(r=>resolve=r);};
  const running=executeSummary(0,19,'总结0-19楼');await waitUntil(()=>request);
  assert(stopTask());await running;assert.equal(getTask().phase,'stopped');assert.deepEqual(stopped,[request.generation_id]);
  resolve('<summary_result>迟到结果</summary_result>');await autoTriggerSummary();assert.equal(books.book.length,0);
});
test('pause lets an active task finish but queues no more work',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true});seedFloors(50);let resolve;
  globalThis.generateRaw=()=>new Promise(r=>resolve=r);
  const running=executeSummary(0,19,'总结0-19楼');await waitUntil(()=>resolve);await updateSettings({enabled:false});resolve('<summary_result>正文</summary_result>');
  assert.equal(await running,true);assert.equal(getTask().phase,'complete');
});
test('edits and swipes invalidate coverage and restore only assistant-owned hides',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true});seedFloors();messages[2].is_hidden=true;
  globalThis.generateRaw=async()=>'<summary_result>正文</summary_result>';await executeSummary(0,19,'总结0-19楼');
  messages[1].swipe_id=1;messages[1].message='<gametxt>不同版本</gametxt>';
  assert.equal((await getCoverage()).floors.size,0);await auditArchiveSources();await applySummarizedFloorsVisibility();
  assert.equal(books.book[0].enabled,false);assert(messages[2].is_hidden);assert(!messages[1].is_hidden);
});
test('source changes during generation enter pending without saving or hiding',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true});seedFloors();
  globalThis.generateRaw=async()=>{messages[1].message='<gametxt>改楼</gametxt>';return '<summary_result>旧正文</summary_result>';};
  await executeSummary(0,19,'总结0-19楼');assert.equal(getTask().errorKind,'source');assert.equal(books.book.length,0);assert(messages.every(message=>!message.is_hidden));
});
test('deleting or disabling an ordinary summary is respected by automation',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true});seedFloors(50);
  globalThis.generateRaw=async()=>'<summary_result>正文</summary_result>';await executeSummary(0,19,'总结0-19楼');await deleteSummaryEntry('总结0-19楼');
  assert.equal((await computeSummaryPlan()).startFloor,20);assert(!messages[0].is_hidden);
});
test('automatic mega is segmented and history includes mega without future leakage',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true,megaTriggerCount:8,megaBatchCount:6});seedFloors(170);
  for(let i=0;i<8;i++)await upsertSummaryEntryByName('总结'+(i*20)+'-'+(i*20+19)+'楼','记录'+i);
  const plan=await computeMegaPlan();assert.equal(plan.summaryNames.length,6);assert.equal(plan.entryName,'大总结0-119楼');
  globalThis.generateRaw=async()=>'<summary_result>合并档案</summary_result>';assert(await executeMegaSummary(plan.summaryNames,plan.entryName));
  assert.equal((await getAllSummaryContents()).filter(entry=>entry.name.startsWith('总结')).length,2);
  const params=await buildRegeneratePromptParams('总结120-139楼');assert(params.oldSummaryContent.includes('合并档案'));assert(!params.oldSummaryContent.includes('记录7'));
});
test('manual and custom-range generation remain available with automation off',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:false});seedFloors(18);let calls=0;
  globalThis.generateRaw=async()=>{calls++;return '<summary_result>手动归档</summary_result>';};
  await autoTriggerSummary();assert.equal(calls,0);
  assert.equal(await shouldAutoTrigger(),false);
  assert(await startSummaryProcess());assert.equal(calls,1);assert(books.book.some(entry=>entry.name==='总结0-7楼'));
  configureRuntime({status:(...args)=>reports.push(args),form:async options=>{assert.deepEqual(options.fields.map(field=>field.type),['number','number']);assert.equal(options.validate({start:10,end:15}),'');assert(options.validate({start:-1,end:15}));assert(options.validate({start:16,end:10}));return {start:10,end:15};}});
  assert(await startCustomRangeSummaryProcess());assert.equal(calls,2);
  assert(books.book.some(entry=>entry.name==='总结10-15楼'));assert.equal(getSettings().enabled,false);
  assert(messages.slice(10,16).every(message=>message.is_hidden));assert(!messages[8].is_hidden&&!messages[9].is_hidden&&!messages[16].is_hidden);
  messages[1].message='<gametxt>改写后的事件</gametxt>';await autoTriggerSummary();
  assert.equal(calls,2);assert(books.book.find(entry=>entry.name==='总结0-7楼').enabled===false);
  assert(messages.slice(0,8).every(message=>!message.is_hidden));assert(messages[10].is_hidden);
});
test('automatic mega uses the configured trigger and merge counts',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true,megaTriggerCount:6,megaBatchCount:4});seedFloors(130);
  for(let i=0;i<5;i++)await upsertSummaryEntryByName('总结'+(i*20)+'-'+(i*20+19)+'楼','记录'+i);
  assert.equal(await computeMegaPlan(),null);
  await upsertSummaryEntryByName('总结100-119楼','记录5');
  const plan=await computeMegaPlan();assert.equal(plan.summaryNames.length,4);assert.equal(plan.entryName,'大总结0-79楼');
  globalThis.generateRaw=async()=>'<summary_result>四条合并</summary_result>';assert(await executeMegaSummary(plan.summaryNames,plan.entryName));
  assert.equal((await getAllSummaryContents()).filter(entry=>entry.name.startsWith('总结')).length,2);
});
test('pre-existing globally enabled books are not adopted as assistant-owned',async()=>{
  globals=['book','shared'];
  await reconcileChatBinding();await bindWorldbookToChat('next');assert(globals.includes('book'));assert(globals.includes('shared'));
  await bindWorldbookToChat('book');assert(!globals.includes('next'));assert(globals.includes('shared'));
});
test('macros expand custom rules without interpreting source text or inserting merge markers',async()=>{
  const settings={...DEFAULT_SETTINGS,customMacros:[{name:'custom',content:'用户 {{user}}；{{summary.material}}'}]};
  assert.equal(expandMacros('{{custom}}',{user:'甲','summary.material':'字面 {{user}}'},settings.customMacros),'用户 甲；字面 {{user}}');
  assert.throws(()=>expandMacros('{{a}}',{},[{name:'a',content:'{{b}}'},{name:'b',content:'{{a}}'}]),/循环/);
  const compiled=await compilePrompt({promptBlocks:[{type:'builtin_group',enabled:true},{type:'prompt',enabled:true,role:'user',content:'{{custom}}'},optionBlocks({prefillTemplate:'result'}).find(block=>block.id==='tail_prefill')],macroValues:{user:'甲','summary.material':'材料','summary.world_before':'世界','summary.persona':'人设'}},settings);
  assert(compiled.orderedPrompts.every(prompt=>typeof prompt==='object'&&!prompt.content.includes('<|no-trans|>')));assert.equal(compiled.orderedPrompts.at(-1).role,'assistant');assert.equal(compiled.prefill,'<summary_result>\n');
});

test('cancelled generation never opens review or saves into a different chat',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true});messages=[{message_id:0,role:'assistant',message:'<gametxt>事件</gametxt>'}];let finish;
  globalThis.generateRaw=()=>new Promise(r=>finish=r);
  const task=runAction(()=>executeSummary(0,0,'总结0-0楼',{requireReview:true}),{generation:true});
  while(!finish)await new Promise(r=>setImmediate(r));invalidate();ctx.chatId='b';finish('---\n488-1-1 | 地点:\n  事件');await task;
  assert.equal(books.book.length,0);
});
test('legacy SPreset fixture documents the compatible memory, reference and runtime format',()=>{
  const settings=JSON.parse(fs.readFileSync(new URL('./fixtures/spreset.json',import.meta.url)));
  const post=Function('return ('+settings.ChatSquash.squashed_post_script+')')();
  const text=post('<VOID_memory><|ws_slot|></VOID_memory><VOID_reference><|ai_slot|></VOID_reference><VOID_runtime><|ac_slot|></VOID_runtime><VOID_injection_buffer>MEGA_9999 SUMMARY_9998</VOID_injection_buffer><@Cut_900><VOID_injection_buffer>REF</VOID_injection_buffer><@Cut_2><VOID_injection_buffer>RULE</VOID_injection_buffer>');
  assert(text.includes('<VOID_memory>MEGA_9999 SUMMARY_9998</VOID_memory>'));assert(text.includes('<VOID_reference>REF</VOID_reference>'));assert(text.includes('<VOID_runtime>RULE</VOID_runtime>'));
  const regexes=settings.RegexBinding.regexes;
  const recent=regexes.find(r=>r.scriptName.startsWith('07'));const distant=regexes.find(r=>r.scriptName.startsWith('08'));
  assert.equal(recent.maxDepth,10);assert.equal(distant.minDepth,11);assert.equal(settings.ChatSquash.squashed_separator_string,'<|no-trans|>');
});

test('native prompt entries send their enabled roles and combine world and character material', async () => {
  for (const key of ['promptBlocks','megaPromptBlocks']) {
    assert.equal(DEFAULT_SETTINGS[key].length,12);
    const values=Object.fromEntries(['world_before','persona','character','personality','scenario','world_after','history','material'].map(name=>['summary.'+name,'DATA_'+name]));
    const compiled=await compilePrompt({promptBlocks:DEFAULT_SETTINGS[key],macroValues:values},DEFAULT_SETTINGS);
    assert.deepEqual(compiled.orderedPrompts.map(message=>message.role),['system','user','user','user','user','user','user']);
    const world=compiled.orderedPrompts.find(message=>message.content.includes('<world_and_characters>'));
    for(const name of ['world_before','persona','character','personality','scenario','world_after'])assert(world.content.includes('DATA_'+name));
    assert(compiled.orderedPrompts.every(message=>!message.content.includes('<|no-trans|>')));
    assert(compiled.orderedPrompts[2].content.includes('【信息变动】'));
  }
});
const timelineBody = '---\n复兴纪元488年4月15日 | 瓦伦蒂亚城-城门:\n  清晨\n  两人抵达城门，守卫核验身份后放行。\n  【未决事项】两人答应在午后回报调查结果。';

test('format entries change sent rules and edited formats use custom validation',async()=>{
  assert.equal(activeResultFormat(DEFAULT_SETTINGS.promptBlocks),'legacy');
  for(const [format,body,rule] of [['legacy',timelineBody,'日期 | 完整地点路径'],['archive','【时空与事件】\n- 清晨｜城门：守卫核验身份后放行。','【时空与事件】'],['free','自定义段落','自定义格式要求']]){
    const settings=withOptions(DEFAULT_SETTINGS,{resultFormat:format});
    const compiled=await compilePrompt({promptBlocks:settings.promptBlocks,macroValues:{}},settings);
    assert.equal(compiled.resultFormat,format);assert(compiled.orderedPrompts.some(message=>message.content.includes(rule)));
    assert.equal(extractSummaryResult('<summary_result>'+body+'</summary_result>',{format}),body);
  }
  const edited=structuredClone(DEFAULT_SETTINGS.promptBlocks);edited.find(block=>block.id==='format_legacy').content='用户自写的段落格式';assert.equal(activeResultFormat(edited),'free');
  for(const body of ['- **人物与觉醒**：人物醒来。','---\n日期 | 地点:\n没有时间与缩进','---\n地点:\n  清晨\n  事件','---\n日期 | 地点:\n  清晨\n  事件\n---\n坏标题'])assert.throws(()=>extractSummaryResult('<summary_result>'+body+'</summary_result>',{format:'legacy'}));
  assert.throws(()=>extractSummaryResult('<summary_result>- 人物醒来</summary_result>',{format:'archive'}));
});

test('check and tail entries are independently selectable and parse the actual assistant prefill',async()=>{
  for(const thinkingTemplate of ['native','brief','destined'])for(const prefillTemplate of ['off','result','destined']){
    const settings=withOptions(DEFAULT_SETTINGS,{thinkingTemplate,prefillTemplate});
    const compiled=await compilePrompt({promptBlocks:settings.promptBlocks,macroValues:{}},settings);
    assert.equal(compiled.orderedPrompts.filter(message=>message.role==='system').length,1);
    const thinking=THINKING_TEMPLATES[thinkingTemplate];if(thinking.head)assert(compiled.orderedPrompts.some(message=>message.content.includes(thinking.head)&&message.content.includes(thinking.tail)));
    assert.equal(compiled.prefill,PREFILLS[prefillTemplate]);
    assert.equal(settings.promptBlocks.filter(block=>block.choiceGroup==='tail'&&block.enabled).length,1);
    if(compiled.prefill){assert.equal(compiled.orderedPrompts.at(-1).content,compiled.prefill);assert.equal(extractSummaryResult(timelineBody+'</summary_result>',{format:'legacy',prefill:compiled.prefill}),timelineBody);}
  }
});

test('worldbook material includes only before and after context, excluding all depth entries',async()=>{
  books.book=[{name:'总结0-1楼',content:'OWN_MEMORY'}];
  globalThis.SillyTavern.getCharacterCardFields=()=>({description:'CHARACTER',personality:'PERSONALITY',persona:'PERSONA',scenario:'SCENARIO'});
  let dryRun;globalThis.SillyTavern.getWorldInfoPrompt=async(text,budget,dry)=>{dryRun=dry;return {worldInfoBefore:'BEFORE OWN_MEMORY',worldInfoAfter:'AFTER',worldInfoDepth:[{entries:['EXTERNAL_DEPTH','OWN_MEMORY']}]};};
  const compiled=await compilePrompt({promptBlocks:DEFAULT_SETTINGS.promptBlocks,mergedChatText:'MATERIAL'},DEFAULT_SETTINGS);
  const world=compiled.orderedPrompts.find(message=>message.content.includes('<world_and_characters>'));
  assert.equal(world.role,'user');assert(!world.content.includes('EXTERNAL_DEPTH'));assert(!world.content.includes('OWN_MEMORY'));assert(world.content.includes('CHARACTER'));assert.equal(dryRun,true);
});

test('old prompt settings migrate to selectable entries while preserving edited lists and roles',()=>{
  const raw={...structuredClone(DEFAULT_SETTINGS),...structuredClone(PREVIOUS_ARCHIVE_PROMPTS),promptVersion:2,resultFormat:'free'};
  const migrated=migrateOldSettings(structuredClone(raw));assert.equal(migrated.promptVersion,4);assert.deepEqual(migrated.promptBlocks,DEFAULT_SETTINGS.promptBlocks);
  assert.deepEqual(migrateOldSettings({...summarySnapshot(raw),promptVersion:2}).promptBlocks,DEFAULT_SETTINGS.promptBlocks);
  raw.promptBlocks[1].content='用户自己写的格式';raw.promptBlocks[1].role='assistant';raw.resultFormat='archive';
  const custom=migrateOldSettings(structuredClone(raw));assert.deepEqual(custom.promptBlocks.slice(0,raw.promptBlocks.length),raw.promptBlocks);assert.equal(activeResultFormat(custom.promptBlocks),'archive');assert.deepEqual(migrateOldSettings(structuredClone(custom)),custom);
  const compact=migrateOldSettings({...structuredClone(PREVIOUS_COMPACT_PROMPTS),promptVersion:3,resultFormat:'archive',prefillTemplate:'result',thinkingTemplate:'brief',includeDepthWorldbook:true,noTransTag:true});
  assert.equal(compact.promptBlocks.length,12);assert.equal(activeResultFormat(compact.promptBlocks),'archive');assert(compact.promptBlocks.find(block=>block.id==='tail_prefill').enabled);assert(!compact.promptBlocks.find(block=>block.id==='tail_instruction').enabled);
  for(const key of ['resultFormat','thinkingTemplate','prefillTemplate','includeDepthWorldbook','noTransTag'])assert(!Object.hasOwn(compact,key));
});

test('legacy individual prompt fields retain the custom output instruction and its role', () => {
  const migrated=migrateOldSettings({jailbreakPrompt:'自定义身份',summaryRulesPrompt:'自定义记录规则',summaryInstruction:'保留这段原来的输出要求',summaryInstructionRole:'assistant'});
  assert.equal(migrated.promptBlocks.find(block=>block.id==='jailbreak').content,'自定义身份');
  assert.equal(migrated.promptBlocks.find(block=>block.id==='summary_rules').content,'自定义记录规则');
  const tail=migrated.promptBlocks.find(block=>block.id==='summary_instruction');
  assert.equal(tail.content,'保留这段原来的输出要求');assert.equal(tail.role,'assistant');
  assert.deepEqual(migrateOldSettings(structuredClone(migrated)),migrated);
});

test('legacy dynamic material entries become editable macro prompts without losing their source',async()=>{
  const raw={promptVersion:3,promptBlocks:[{id:'old',name:'旧记忆',enabled:true,type:'old_summary',role:'assistant'},{id:'source',name:'来源',enabled:true,type:'chat_messages',role:'user',leadText:'只看本次',xmlTag:'old_tag'},{id:'world',name:'背景',type:'builtin_group',enabled:true}]};
  const migrated=migrateOldSettings(raw);assert(migrated.promptBlocks.every(block=>block.type==='prompt'));
  assert.equal(migrated.promptBlocks[0].role,'assistant');assert(migrated.promptBlocks[0].content.includes('{{summary.history}}'));assert(migrated.promptBlocks[1].content.includes('<old_tag>'));assert(migrated.promptBlocks[1].content.startsWith('只看本次'));assert(migrated.promptBlocks[2].content.includes('{{summary.character}}'));
  migrated.promptBlocks[0].content='编辑后的自定义记忆条目';const compiled=await compilePrompt({promptBlocks:migrated.promptBlocks,macroValues:{}},DEFAULT_SETTINGS);assert.equal(compiled.orderedPrompts[0].content,'编辑后的自定义记忆条目');
});

test('explicit binding accepts every existing worldbook and preserves unrelated entries and global books', async () => {
  books.shared=[{name:'角色知识',content:'KEEP',uid:12}];globals=['shared','external'];
  await bindWorldbookToChat('shared');assert.equal(getActiveWorldbookName(),'shared');
  await upsertSummaryEntryByName('总结0-1楼','正文');
  assert(books.shared.some(entry=>entry.name==='角色知识'&&entry.content==='KEEP'));
  const result=await deleteBoundSummaryBook();assert.equal(result.keptOtherEntries,1);
  assert.deepEqual(books.shared,[{name:'角色知识',content:'KEEP',uid:12}]);assert.deepEqual(globals,['shared','external']);
  assert(!getActiveWorldbookName());assert(!getManagedSummaryBookNames().includes('shared'));
});

test('deleting a book prunes its catalog and externally deleted bindings restore owned hides', async () => {
  await saveSettings(FLOW_SETTINGS);seedFloors();await bindWorldbookToChat('book');
  await upsertSummaryEntryByName('总结0-3楼','正文');assert(messages[0].is_hidden);
  messages[9].is_hidden=true;delete books.book;
  await reconcileChatBinding();assert(!getActiveWorldbookName());assert.equal(chat.summary_assistant_binding_paused,true);
  assert(!getManagedSummaryBookNames().includes('book'));assert(!messages[0].is_hidden);assert(messages[9].is_hidden);
  await bindWorldbookToChat('new');await deleteBoundSummaryBook();
  assert(!books.new);assert(!getManagedSummaryBookNames().includes('new'));
});

test('default generation saves the timeline format and rejects arbitrary bullet summaries before hiding', async () => {
  await saveSettings(DEFAULT_SETTINGS);seedFloors(50);
  globalThis.generateRaw=async()=>'<summary_result>'+timelineBody+'</summary_result>';
  assert(await executeSummary(0,19,'总结0-19楼'));assert.equal(books.book[0].content,timelineBody);
  globalThis.generateRaw=async()=>'<summary_result>- **人物与觉醒**：人物醒来。</summary_result>';
  assert.equal(await executeSummary(20,39,'总结20-39楼'),false);assert.equal(getTask().errorKind,'format');
  assert(!books.book.some(entry=>entry.name==='总结20-39楼'));assert(messages.slice(20).every(message=>!message.is_hidden));
});

test('untagged opening floor zero is fingerprinted and hidden only after a successful batch',async()=>{
  await saveSettings(FLOW_SETTINGS);seedFloors(30);messages[0]={message_id:0,role:'assistant',message:'开局界面，没有剧情正文',is_hidden:false};
  const params=await buildSummaryPromptParams(0,19);assert(!params.mergedChatText.includes('开局界面'));assert(params.sources.some(source=>source.id===0));
  globalThis.generateRaw=async()=>'<summary_result>事件档案</summary_result>';assert(await executeSummary(0,19,'总结0-19楼'));assert(messages[0].is_hidden);assert((await getCoverage()).floors.has(0));
  messages[0].message='<gametxt>修改过的开局剧情</gametxt>';await auditArchiveSources();await applySummarizedFloorsVisibility();assert(!messages[0].is_hidden);assert(!(await getCoverage()).floors.has(0));
  const tagged=await buildSummaryPromptParams(0,19);assert(tagged.mergedChatText.includes('第 0 楼'));assert(tagged.mergedChatText.includes('修改过的开局剧情'));
});
test('manual floor actions include zero, filter roles and pause automation until enabled again',async()=>{
  await saveSettings(FLOW_SETTINGS);seedFloors(30);await upsertSummaryEntryByName('总结0-9楼','档案');
  const {visibilitySnapshot,setManualFloorVisibility}=await import('../src/summary/visibility.js');
  assert.equal(visibilitySnapshot((await getCoverage()).floors).counts.total,30);
  await setManualFloorVisibility(0,9,false,'user');await applySummarizedFloorsVisibility();
  assert.equal(readVisibilityAutomation(),false);
  assert(!messages[0].is_hidden);assert(messages[1].is_hidden);assert.equal(visibilitySnapshot().counts.hidden,5);
  setFloorVisibilityAutomation(true);await applySummarizedFloorsVisibility();assert(messages.slice(0,10).every(message=>message.is_hidden));
  await setManualFloorVisibility(0,29,false);await applySummarizedFloorsVisibility();assert.equal(visibilitySnapshot().counts.shown,30);
  await assert.rejects(setManualFloorVisibility(-1,2,true),/整数楼层/);
});

test('hide summarized floors runs once; enabling automation clears choices across gaps too',async()=>{
  await saveSettings({...FLOW_SETTINGS,autoHideSummarizedFloors:false});seedFloors(30);
  await upsertSummaryEntryByName('总结0-3楼','第一段');await upsertSummaryEntryByName('总结6-9楼','第二段');
  const {setManualFloorVisibilityByIds,setManualFloorVisibility,readVisibilityOverrides}=await import('../src/summary/visibility.js');
  const {floors}=await getCoverage();await setManualFloorVisibilityByIds(floors,true);
  await getAllSummaryEntriesForDisplay();await autoTriggerSummary();await applySummarizedFloorsVisibility();
  assert([...floors].every(id=>messages[id].is_hidden));assert(!messages[4].is_hidden&&!messages[5].is_hidden);
  // Native changes after a one-shot action must not be forced back on refresh.
  messages[0].is_hidden=false;await applySummarizedFloorsVisibility();assert(!messages[0].is_hidden);
  await setManualFloorVisibility(0,29,true);
  setFloorVisibilityAutomation(true);await applySummarizedFloorsVisibility();
  assert([...floors].every(id=>messages[id].is_hidden));assert(!messages[4].is_hidden&&!messages[5].is_hidden);
  assert.equal(readVisibilityAutomation(false),true);assert.deepEqual(readVisibilityOverrides(),{});
});

test('enabling automation removes all assistant overrides and preserves other variables and archives',async()=>{
  await saveSettings(FLOW_SETTINGS);seedFloors(30);await upsertSummaryEntryByName('总结0-9楼','保留的总结正文');
  const {setManualFloorVisibility,readVisibilityOverrides}=await import('../src/summary/visibility.js');
  await setManualFloorVisibility(0,29,false);
  chat.other_extension={nested:{keep:true},list:[1,2,3]};const beforeBooks=structuredClone(books),beforeScript=structuredClone(script);
  setFloorVisibilityAutomation(true);await applySummarizedFloorsVisibility();
  assert(messages.slice(0,10).every(message=>message.is_hidden));assert(messages.slice(10).every(message=>!message.is_hidden));
  assert.deepEqual(readVisibilityOverrides(),{});
  assert.deepEqual(chat.other_extension,{nested:{keep:true},list:[1,2,3]});assert.deepEqual(books,beforeBooks);assert.deepEqual(script,beforeScript);
});

test('a dropped variable replacement is still detected before changing any floor visibility',async()=>{
  await saveSettings(FLOW_SETTINGS);seedFloors(30);await upsertSummaryEntryByName('总结0-9楼','保留档案');
  const {setManualFloorVisibility,readVisibilityOverrides}=await import('../src/summary/visibility.js');
  await setManualFloorVisibility(0,29,false);const before=readVisibilityOverrides(),replace=globalThis.replaceVariables;
  globalThis.replaceVariables=(value,option)=>{if(option.type!=='chat')replace(value,option);};
  assert.throws(()=>setFloorVisibilityAutomation(true),/持久化校验失败/);
  assert.deepEqual(readVisibilityOverrides(),before);assert(messages.every(message=>!message.is_hidden));
});

test('enabling automation without summaries clears manual states and restores only assistant-managed floors',async()=>{
  await saveSettings(FLOW_SETTINGS);seedFloors(12);messages[11].is_hidden=true;
  const {setManualFloorVisibility,readVisibilityOverrides,visibilitySnapshot}=await import('../src/summary/visibility.js');
  await setManualFloorVisibility(0,9,true);await setManualFloorVisibility(2,3,false);
  assert.equal(readVisibilityAutomation(),false);
  setFloorVisibilityAutomation(true);await applySummarizedFloorsVisibility();
  assert.equal(readVisibilityAutomation(),true);assert.deepEqual(readVisibilityOverrides(),{});
  assert(messages.slice(0,11).every(message=>!message.is_hidden));assert(messages[11].is_hidden);
  assert(visibilitySnapshot().groups.filter(group=>group.to<11).every(group=>group.state==='显示'));
  assert.deepEqual(chat.summary_assistant_auto_hidden_floors,[]);
});

test('the automation switch saves in empty chats and remains separate from other chats and configurations',async()=>{
  await saveSettings({...FLOW_SETTINGS,autoHideSummarizedFloors:false});const beforeScript=structuredClone(script);
  setFloorVisibilityAutomation(true);await applySummarizedFloorsVisibility();
  assert.equal(readVisibilityAutomation(false),true);assert.deepEqual(chat.summary_assistant_visibility_overrides,{});
  const firstChat=structuredClone(chat);ctx.chatId='b';chat={};
  assert.equal(readVisibilityAutomation(false),false);setFloorVisibilityAutomation(false);
  const secondChat=structuredClone(chat);ctx.chatId='a';chat=firstChat;
  assert.equal(readVisibilityAutomation(false),true);assert.equal(secondChat[VISIBILITY_AUTOMATION_KEY],false);
  assert.deepEqual(script,beforeScript);assert(!Object.hasOwn(summarySnapshot(getSettings()),VISIBILITY_AUTOMATION_KEY));
});

test('old manual choices migrate to a paused policy until the chat explicitly enables automation',async()=>{
  await saveSettings(FLOW_SETTINGS);seedFloors(12);
  const {setManualFloorVisibility}=await import('../src/summary/visibility.js');
  await setManualFloorVisibility(0,3,false);delete chat[VISIBILITY_AUTOMATION_KEY];
  assert.equal(readVisibilityAutomation(true),false);
  setFloorVisibilityAutomation(true);assert.equal(readVisibilityAutomation(false),true);
});

test('manual actions pause hiding for later generated summaries and automation catches up when enabled',async()=>{
  await saveSettings(FLOW_SETTINGS);seedFloors(30);await upsertSummaryEntryByName('总结0-3楼','第一段');
  const {setManualFloorVisibility}=await import('../src/summary/visibility.js');
  await setManualFloorVisibility(0,3,false);
  globalThis.generateRaw=async()=>'<summary_result>后续总结</summary_result>';
  await executeSummary(4,9,'总结4-9楼');
  assert.equal(getTask().phase,'complete');assert(books.book.some(entry=>entry.name==='总结4-9楼'));
  assert(messages.slice(0,10).every(message=>!message.is_hidden));
  setFloorVisibilityAutomation(true);await applySummarizedFloorsVisibility();assert(messages.slice(0,10).every(message=>message.is_hidden));
  setFloorVisibilityAutomation(false);await deleteSummaryEntry('总结4-9楼');
  assert(messages.slice(0,4).every(message=>message.is_hidden));assert(messages.slice(4,10).every(message=>!message.is_hidden));
});

test('clearing task logs preserves active and pending results; completed logs never delete archives',async()=>{
  await saveSettings(FLOW_SETTINGS);seedFloors();await upsertSummaryEntryByName('总结0-3楼','保留档案');
  const task=beginTask({startFloor:4,endFloor:9});updateTask(task,{phase:'generating',body:'待保存正文',raw:'原始结果'},{save:true});
  clearTaskLog();assert.equal(getTask().running,true);assert.deepEqual(getTask().log,[]);assert.equal(getTask().body,'待保存正文');
  finishTask(task,{phase:'pending',errorKind:'save'});clearTaskLog();restoreTaskState();
  assert.equal(getTask().phase,'pending');assert.equal(getTask().raw,'原始结果');assert.deepEqual(getTask().log,[]);
  const original=globalThis.replaceVariables;globalThis.replaceVariables=()=>{throw Error('disk failed');};
  const before=getTask();assert.throws(clearTaskLog,/disk failed/);assert.deepEqual(getTask(),before);globalThis.replaceVariables=original;
  const resumed=beginTask(before.spec,before);finishTask(resumed,{phase:'complete'});clearTaskLog();restoreTaskState();
  assert.equal(getTask(),null);assert.equal(books.book[0].content,'保留档案');
});

test('a triggered round drains its fixed eligible range in 20+20 or 30+10 batches',async()=>{
  for(const limit of [20,30]){
    reset();await saveSettings({...FLOW_SETTINGS,enabled:true,triggerFloorCount:50,keepFloorCount:10,batchFloorCount:limit});seedFloors(50);
    const requests=[];globalThis.generateRaw=async config=>{requests.push(config);return '<summary_result>批次记忆'+requests.length+'</summary_result>';};
    const plans=await computeSummaryPlans();assert.deepEqual(plans.map(plan=>plan.endFloor-plan.startFloor+1),limit===20?[20,20]:[30,10]);
    await autoTriggerSummary();assert.equal(requests.length,2);assert.equal(getTask().phase,'complete');
    assert(requests[1].ordered_prompts.some(prompt=>prompt.content.includes('批次记忆1')));
    assert(messages.slice(0,40).every(message=>message.is_hidden));assert(messages.slice(40).every(message=>!message.is_hidden));
    assert(getTask().batches.every(batch=>batch.phase==='complete'));
  }
});

test('parallel generation stays bounded and saves each group in floor order despite reversed completion',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true,triggerFloorCount:70,keepFloorCount:10,batchFloorCount:20,parallelBatches:true,batchConcurrency:2});seedFloors(70);
  const pending=[],requests=[];let active=0,peak=0;
  globalThis.generateRaw=config=>{requests.push(config);active++;peak=Math.max(peak,active);return new Promise(resolve=>pending.push(value=>{active--;resolve('<summary_result>'+value+'</summary_result>');}));};
  const run=autoTriggerSummary();await waitUntil(()=>pending.length===2);assert.equal(books.book.length,0);
  pending[1]('第二批');await nextTick();assert.equal(books.book.length,0);assert.equal(getTask().batches[1].body,'第二批');
  pending[0]('第一批');await waitUntil(()=>pending.length===3);
  assert.deepEqual(books.book.map(entry=>entry.name),['总结0-19楼','总结20-39楼']);
  assert(requests[2].ordered_prompts.some(prompt=>prompt.content.includes('第一批')&&prompt.content.includes('第二批')));
  assert(!requests[1].ordered_prompts.some(prompt=>prompt.content.includes('第一批')));
  pending[2]('第三批');await run;assert.equal(peak,2);assert.equal(requests.length,3);assert.equal(getTask().phase,'complete');
});

test('a failed parallel batch preserves successful siblings and retries only unfinished batches after reload',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true,triggerFloorCount:70,keepFloorCount:10,batchFloorCount:20,parallelBatches:true,batchConcurrency:2});seedFloors(70);
  let calls=0;globalThis.generateRaw=async()=>{if(++calls===1)throw Object.assign(Error('denied'),{status:401});return '<summary_result>第二批成功</summary_result>';};
  await autoTriggerSummary();assert.equal(calls,2);assert.equal(getTask().phase,'pending');assert.deepEqual(books.book.map(entry=>entry.name),['总结20-39楼']);
  assert.deepEqual(getTask().batches.map(batch=>batch.phase),['pending','complete','queued']);
  restoreTaskState();globalThis.generateRaw=async()=>{calls++;return '<summary_result>恢复批次</summary_result>';};
  await retryTask();assert.equal(calls,4);assert.equal(getTask().phase,'complete');assert.equal(books.book.find(entry=>entry.name==='总结20-39楼').content,'第二批成功');
  assert(messages.slice(0,60).every(message=>message.is_hidden));
});

test('stopping a parallel round cancels all its own requests and ignores late results',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true,triggerFloorCount:50,keepFloorCount:10,parallelBatches:true,batchConcurrency:2});seedFloors(50);
  const pending=[],ids=[],stops=[];globalThis.stopGenerationById=id=>stops.push(id);
  globalThis.generateRaw=config=>{ids.push(config.generation_id);return new Promise(resolve=>pending.push(resolve));};
  const run=autoTriggerSummary();await waitUntil(()=>pending.length===2);assert(stopTask());await run;
  assert.deepEqual(new Set(stops),new Set(ids));pending.forEach(resolve=>resolve('<summary_result>迟到正文</summary_result>'));await nextTick();
  assert.equal(books.book.length,0);assert.equal(getTask().phase,'stopped');assert(messages.every(message=>!message.is_hidden));
});

test('skipping one failed batch retains completed siblings and leaves queued work resumable',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true,triggerFloorCount:70,keepFloorCount:10,parallelBatches:true,batchConcurrency:2});seedFloors(70);
  let calls=0;globalThis.generateRaw=async()=>{if(++calls===1)throw Object.assign(Error('denied'),{status:401});return '<summary_result>可保留记录</summary_result>';};
  await autoTriggerSummary();skipPendingTask();assert.deepEqual(getTask().batches.map(batch=>batch.phase),['skipped','complete','queued']);
  globalThis.generateRaw=async()=>{calls++;return '<summary_result>最后一批</summary_result>';};await retryTask();
  assert.equal(calls,3);assert.equal(getTask().phase,'complete');assert.equal(books.book.length,2);assert(!(await getCoverage()).floors.has(0));
});

test('editing one failed batch saves just that selection without regenerating another failed batch',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true,triggerFloorCount:50,keepFloorCount:10,parallelBatches:true,batchConcurrency:2});seedFloors(50);
  let calls=0;globalThis.generateRaw=async()=>{calls++;throw Object.assign(Error('denied'),{status:401});};
  await autoTriggerSummary();selectTaskBatch(1);await retryTask('save','手动修复第二批');
  assert.equal(calls,2);assert.equal(getTask().phase,'pending');assert.equal(books.book[0].name,'总结20-39楼');assert.equal(books.book[0].content,'手动修复第二批');
  assert.equal(getTask().batches[0].phase,'pending');assert.equal(getTask().batches[1].phase,'complete');
});

test('custom ranges respect the batch cap and pause stops queuing after the active serial batch',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:false,batchFloorCount:20});seedFloors(50);
  let calls=0;globalThis.generateRaw=async()=>{calls++;return '<summary_result>指定范围</summary_result>';};await executeSummary(0,39,'总结0-39楼');
  assert.equal(calls,2);assert.deepEqual(books.book.map(entry=>entry.name),['总结0-19楼','总结20-39楼']);
  reset();await saveSettings({...FLOW_SETTINGS,enabled:true,triggerFloorCount:50,keepFloorCount:10});seedFloors(50);
  calls=0;globalThis.generateRaw=async()=>{calls++;await updateSettings({enabled:false});return '<summary_result>暂停前完成</summary_result>';};
  await autoTriggerSummary();assert.equal(calls,1);assert.equal(books.book.length,1);assert.equal(getTask().batches[1].phase,'paused');
});

test('new defaults and migration clear only the previous excluded-tag default and preserve custom settings',async()=>{
  assert.deepEqual(DEFAULT_SETTINGS.excludeTags,[]);assert.equal(DEFAULT_SETTINGS.megaTriggerCount,15);assert.equal(DEFAULT_SETTINGS.megaBatchCount,10);assert.equal(DEFAULT_SETTINGS.parallelBatches,false);
  const previous={...structuredClone(DEFAULT_SETTINGS),excludeTags:['think'],megaTriggerCount:8,megaBatchCount:6};delete previous.behaviorVersion;
  const migrated=migrateOldSettings(previous);assert.deepEqual(migrated.excludeTags,[]);assert.equal(migrated.megaTriggerCount,15);assert.equal(migrated.megaBatchCount,10);
  assert.deepEqual(migrateOldSettings({...previous,behaviorVersion:undefined,excludeTags:['hidden'],megaTriggerCount:12,megaBatchCount:9}).excludeTags,['hidden']);
  assert.deepEqual(migrateOldSettings({...DEFAULT_SETTINGS,excludeTags:['think']}).excludeTags,['think']);
});

test('tag exclusions apply inside extracted AI text and accept nested tags and attributes',()=>{
  const input=[{id:0,role:'assistant',message:'<think>不读取</think><gametxt>保留<hidden data-x="1">秘密<hidden>嵌套</hidden>内部</hidden>结尾</gametxt>'},{id:1,role:'user',message:'用户保留 <hidden>原文</hidden>'}];
  const result=processMessagesByTags(input,['gametxt'],['hidden'],true);
  assert.equal(result[0].content,'保留结尾');assert.equal(result[1].content,input[1].message);
  assert.equal(processMessagesByTags([{id:0,role:'assistant',message:'<gametxt>甲<think>正文中的思考</think>乙</gametxt>'}],['gametxt'],[],true)[0].content,'甲<think>正文中的思考</think>乙');
});

test('a long floor list is paged in bounded slices and can jump and filter without loading rows for every floor',async()=>{
  await saveSettings(FLOW_SETTINGS);seedFloors(3000);messages[2999].is_hidden=true;
  const {visibilitySnapshot}=await import('../src/summary/visibility.js'),{floorPage,FLOOR_PAGE_SIZE}=await import('../src/summary/ui/floorBrowser.js');
  const snapshot=visibilitySnapshot();assert.equal(floorPage(snapshot).pages,100);assert(floorPage(snapshot).groups.length<=FLOOR_PAGE_SIZE);
  const last=floorPage(snapshot,{jump:2999});assert.equal(last.page,99);assert.equal(last.groups.at(-1).to,2999);
  const users=floorPage(snapshot,{role:'user',page:49});assert.equal(users.count,1500);assert(users.groups.every(group=>group.role==='user'));
  assert.deepEqual(floorPage(snapshot,{visibility:'hidden'}).groups.map(group=>group.from),[2999]);
  const {parseTagNames}=await import('../src/summary/ui/tagEditor.js');assert.deepEqual(parseTagNames('<tp>，gametxt、hidden;tp'),['tp','gametxt','hidden']);assert.throws(()=>parseTagNames('bad!tag'));
});
