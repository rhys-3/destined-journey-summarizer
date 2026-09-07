(async () => {
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const variableMerge = require('../helpers/tavern-variables.cjs').mergeTavernVariables.toString();
fs.mkdirSync('.ui-review',{recursive:true});
const raw=JSON.parse(fs.readFileSync('tests/fixtures/preset.json','utf8'));
const convert=(p,enabled)=>({...p,id:p.identifier,enabled,role:p.role??'system',position:p.injection_position===1?{type:'in_chat',depth:p.injection_depth,order:p.injection_order}:{type:'relative'}});
const prompts=raw.prompt_order[0].order.map(o=>{const p=raw.prompts.find(p=>p.identifier===o.identifier);return p?convert(p,o.enabled):null}).filter(Boolean);
const preset={settings:{should_stream:raw.stream_openai},prompts,prompts_unused:raw.prompts.filter(p=>!prompts.some(q=>q.id===p.identifier)).map(p=>convert(p,p.enabled)),extensions:{}};
const script=fs.readFileSync('src/preset/assistant.js','utf8');
const marker='  try {\n    const version = await getTavernHelperVersion();';
assert(script.includes(marker));
let injected=script.slice(0,script.indexOf(marker))+`
  window.ui = { summary, captureCombined: captureConfiguration, captureConfiguration: capturePresetConfiguration, validateSnapshot: validatePresetSnapshot, validateLibrary, loadScriptConfig, emptyLibrary, rebuildModelRegistry, configLibrary, modelRegistry, getGeminiTail, setGeminiTail, detectModelAdapter, flushPendingSaves, addCustomModel, renameCustomModel, deleteCustomModel, setCustomTail, saveNamedConfiguration, renameConfiguration, deleteConfiguration, applyConfiguration, exportConfigurations, importConfigurations, resolveBoundProfile, configurationIsDirty, runWorkspaceOperation, writeWorkspace, state, IDS, GROUPS, MODEL_ADAPTERS, PROTECTED_IDS, worldLink, worldWrites, variablePresetMode, scanWorldbookMode, scheduleWorldbookScan, selectVariableMode, render, renderActiveContent, openPanel, closePanel, applyGroup, selectModelAdapter, setNumericField, setLanguageField, readLanguageField, managedMacroValues, setNarrationPerson, setGlobalPreference, setUserAdditionalSetting, togglePrompt, updateEntryPoint, reconcilePreset, expandManagedMacros, openStyleEditor, saveStyleEditor, deleteUserStyle, getGroupOptions, readUserAdditionalSetting, openPromptEditor, savePromptEditor, closePromptEditor, setEditorField, get shadow(){return shadow;}, async settle(){await new Promise(r=>setTimeout(r,400));await saveChain;} };
  Object.assign(window.ui, {defaultAuthorLayout,validateAuthorLayout,authorLayout,placementEntry,placementMembers,placementSnapshot,setPlacementField,editEntryAction,getPromptGroupId});
`+script.slice(script.indexOf(marker))+'\nstartPresetAssistant().then(() => { window.ui.openPanel(); window.testReady=true; });';
injected=require('esbuild').buildSync({stdin:{contents:injected,resolveDir:path.resolve('src/preset'),sourcefile:'assistant.js'},bundle:true,format:'iife',platform:'browser',target:'es2022',write:false}).outputFiles[0].text;
const mock=`window.mergeTavernVariables=${variableMerge};window.getWorldbookNames=async()=>[];window.getGlobalWorldbookNames=()=>[];window.rebindGlobalWorldbooks=async()=>{};window.getLastMessageId=()=>-1;window.getChatMessages=()=>[];window.insertOrAssignVariables=(v,o)=>{const next=mergeTavernVariables(getVariables(o),v);replaceVariables(next,o);return next;};window.data=${JSON.stringify(preset)};window.stored=structuredClone(data);window.vars={managed_values_version:1,style_structure_version:1};window.errors=[];window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
window.getScriptId=()=> 'a980269e-8d77-4f5e-bad7-b2fe0a2cd470';window.getVariables=()=>vars;window.replaceVariables=v=>{vars=structuredClone(v)};
window.getPreset=n=>structuredClone(n==='in_use'?data:stored);window.getLoadedPresetName=()=> 'test';window.replacePreset=async(n,v)=>{if(window.failWrite===n){window.failWrite=null;throw Error('simulated save failure')} if(n==='in_use')data=structuredClone(v);else stored=structuredClone(v)};
window.handlers=new Map();window.tavern_events=Object.fromEntries(['MESSAGE_RECEIVED','MESSAGE_EDITED','MESSAGE_DELETED','MESSAGE_SWIPED','PRESET_CHANGED','OAI_PRESET_CHANGED_AFTER','SETTINGS_UPDATED','CHAT_COMPLETION_PROMPT_READY','GENERATE_AFTER_DATA','CONNECTION_PROFILE_LOADED','CONNECTION_PROFILE_CREATED','CONNECTION_PROFILE_DELETED','CONNECTION_PROFILE_UPDATED','CHAT_CHANGED','CHARACTER_PAGE_LOADED','CHARACTER_EDITED','WORLDINFO_SETTINGS_UPDATED','WORLDINFO_UPDATED'].map(s=>[s,s]));window.eventOn=(name,fn)=>{const list=handlers.get(name)||[];list.push(fn);handlers.set(name,list);return {stop(){}}};window.eventMakeLast=eventOn;window.getButtonEvent=n=>n;window.registerMacroLike=()=>({});window.getTavernHelperVersion=async()=> '4.0.0';window.SillyTavern={getContext:()=>({})};window.triggerSlash=async()=> '[]';window.updateScriptButtonsWith=()=>{};window.toastr={error:m=>errors.push(String(m)),warning:()=>{},success:()=>{},info:()=>{}};for(const name of ['confirm','prompt','alert'])window[name]=()=>{throw Error('Native browser dialog used: '+name)};`;
const isolationMock=`window.tavern_events.CHAT_COMPLETION_SETTINGS_READY='CHAT_COMPLETION_SETTINGS_READY';window.eventRemoveListener=(name,fn)=>handlers.set(name,(handlers.get(name)||[]).filter(listener=>listener!==fn));window.eventMakeLast=(name,fn)=>{eventRemoveListener(name,fn);return eventOn(name,fn);};`;
fs.writeFileSync('.ui-review/preview.html','<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>命定预设助手 · 本地交互验证</title><body style="margin:0;background:#0c1210"><script>'+(mock+isolationMock).replaceAll('</script','<\\/script')+'</script><script>'+injected.replaceAll('</script','<\\/script')+'</script></body></html>');
const browser=spawn(process.env.CHROME_PATH || (process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':'/usr/bin/google-chrome'),['--headless=new',...(process.env.CI&&process.platform==='linux'?['--no-sandbox','--disable-dev-shm-usage']:[]),'--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--remote-allow-origins=*','--user-data-dir='+path.resolve('.ui-review/chrome-profile'),'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let ws;
let stage='starting Chrome';
const watchdog=setTimeout(()=>{console.error('Browser verification timed out: '+stage);ws?.close();browser.kill();process.exitCode=1;},180000);
try{
const endpoint=awaitPromise();
function awaitPromise(){return new Promise((resolve,reject)=>{browser.once('error',reject);let log='';browser.stderr.on('data',v=>{log+=v;const m=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m)resolve(m[1]);});browser.once('exit',code=>reject(Error('Chrome exited '+code+': '+log.slice(-2000))));setTimeout(()=>reject(Error('Chrome startup timeout: '+log.slice(-2000))),30000).unref();});}
const browserUrl=new URL(await endpoint);
stage='listing browser pages';
const pages=await (await fetch('http://'+browserUrl.host+'/json/list')).json();
stage='connecting to browser';
ws=new WebSocket(pages.find(p=>p.type === 'page').webSocketDebuggerUrl);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Browser connection timeout')),10000);ws.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});ws.addEventListener('error',()=>{clearTimeout(timer);reject(Error('Browser connection failed'));},{once:true});});
let id=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
const cdp=(method,params={})=>new Promise((resolve,reject)=>{stage=method;const key=++id;const timer=setTimeout(()=>{pending.delete(key);reject(Error('Browser command timed out: '+method));},60000);pending.set(key,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});ws.send(JSON.stringify({id:key,method,params}));});
const evaluate=async expression=>{const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text+' '+r.exceptionDetails.exception?.description);return r.result.value;};
await cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:960,screenWidth:1280,screenHeight:960,deviceScaleFactor:1,mobile:false});
await cdp('Page.navigate',{url:'file:///'+path.resolve('.ui-review/preview.html').replaceAll('\\','/')});
for(let i=0;i<50;i++){if(await evaluate('window.testReady && !!window.ui?.shadow?.querySelector(".panel")'))break;await new Promise(r=>setTimeout(r,100));}
console.log(await evaluate('({errors:window.errors,ready:!!window.ui,url:location.href})')); const result=await evaluate(`(async()=>{
const results=[];const check=(name,ok)=>{if(!ok)throw Error(name);results.push(name)};const q=s=>ui.shadow.querySelector(s);const click=s=>{const e=q(s);if(!e)throw Error('Missing '+s);e.click()};await ui.settle();
check('默认日常页与六个主导航',ui.state.activeTab==='daily'&&ui.shadow.querySelectorAll('.tabs button').length===6);
  check('四项数值设置完整',ui.shadow.querySelectorAll('[data-action="field-number"]').length===4);
  check('正文与思维链语言设置完整',ui.shadow.querySelectorAll('[data-action="language-input"]').length===2&&vars.managed_values_version===2&&vars.managed_values.body_language==='简体中文'&&vars.managed_values.thinking_language==='简体中文');
  click('[data-action="language-preset"][data-language="body"][data-value="English"]');await ui.settle();check('正文语言快捷选择自动保存',vars.managed_values.body_language==='English');
  let language=q('[data-action="language-input"][data-language="thinking"]');language.value='Deutsch';language.dispatchEvent(new Event('input',{bubbles:true}));await ui.settle();check('思维链语言支持自定义并自动保存',vars.managed_values.thinking_language==='Deutsch');
  check('语言短宏分别展开',ui.expandManagedMacros('<|正文语言|>|<|思维链语言|>')==='English|Deutsch');
const structuralMarkers=['正文开始','历史开始','深度900分界','深度2分界','历史结束','正文结束','记忆区','参考区','运行规则区'].map(name=>'<|命定_'+name+'|>');
const guardedMessages=[{role:'system',content:structuralMarkers.join(' ')+' <|字数|>'}],noticesBefore=window.errors.length;
check('两个请求阶段均已注册宏处理',(handlers.get('CHAT_COMPLETION_PROMPT_READY')??[]).length>0&&(handlers.get('GENERATE_AFTER_DATA')??[]).length>0);
for(const handler of handlers.get('CHAT_COMPLETION_PROMPT_READY')??[])await handler({chat:guardedMessages});
for(const handler of handlers.get('GENERATE_AFTER_DATA')??[])await handler({prompt:guardedMessages});
check('实际请求回调保留九个中文结构标签',structuralMarkers.every(token=>guardedMessages[0].content.includes(token)));
check('实际请求回调继续展开设置短宏',guardedMessages[0].content.endsWith(' 1500'));
check('结构标签不产生未知宏通知',window.errors.length===noticesBefore);
click('[data-action="field-preset"][data-field="hanzi"][data-value="2500"]');await ui.settle();check('档位自动保存',vars.managed_values.min_hanzi==='2500');
let input=q('[data-action="field-number"][data-field="hanzi"]');input.focus();input.value='-';input.dispatchEvent(new Event('input',{bubbles:true}));ui.renderActiveContent(true);check('无效输入刷新后保留且不保存',q('[data-field="hanzi"][data-action="field-number"]').value==='-'&&vars.managed_values.min_hanzi==='2500');
await ui.setNumericField('hanzi','1500');ui.renderActiveContent();
click('[data-action="person"][data-value="second"]');await ui.settle();check('叙事人称保存',vars.managed_values.narration_person==='second');
const pace=ui.GROUPS['plot-pace'].options[0][0];ui.applyGroup('plot-pace',pace);await ui.settle();check('剧情单选互斥并保存双份',data.prompts.filter(p=>ui.GROUPS['plot-pace'].options.some(([id])=>id===p.id)&&p.enabled).length===1&&stored.prompts.find(p=>p.id===pace).enabled);
click('[data-tab="style"]');check('文风与两项偏好同页',!!q('[data-action="global-preference"]')&&!!q('[data-action="user-additional"]'));
const fold=q('[data-disclosure="content-options"]');fold.open=true;ui.renderActiveContent(true);check('异步刷新保留展开',q('[data-disclosure="content-options"]').open);
await ui.setGlobalPreference('测试偏好');await ui.setUserAdditionalSetting('测试附加要求');await ui.settle();check('偏好与附加设定保存',vars.managed_values.global_preference==='测试偏好'&&ui.readUserAdditionalSetting().value==='测试附加要求');
ui.state.editorUnlocked=true;ui.openStyleEditor('','main-style');q('[data-action="style-title"]').value='回归测试风格';q('[data-action="style-content"]').value='克制地描写。';await ui.saveStyleEditor();await ui.settle();const created=data.prompts.find(p=>p.name.includes('回归测试风格'));check('自建文风保留 XML 包装',created&&created.content.includes('<main_writing_style>'));
const styleDeletion=ui.deleteUserStyle(created.id);check('自建文风删除使用前端确认',!!q('.dj-dialog'));click('.dj-dialog-actions button:first-child');await styleDeletion;await ui.settle();ui.state.editorUnlocked=false;check('自建文风删除',!data.prompts.some(p=>p.id===created.id));
click('[data-tab="tools"]');check('模型卡片完整',ui.shadow.querySelectorAll('[data-action="model"]').length===3);
for(const model of Object.keys(ui.MODEL_ADAPTERS)){await ui.selectModelAdapter(model);await ui.settle();check(model+' 互斥切换',Object.entries(ui.MODEL_ADAPTERS).every(([name,a])=>a.ids.every(id=>data.prompts.find(p=>p.id===id).enabled===(name===model))));}
ui.state.config.entry_points={floating_orb:true,input_button:false,wand_menu:false};ui.updateEntryPoint('floating_orb',false);check('至少保留一个入口',ui.state.config.entry_points.floating_orb===true);
ui.state.config.connection_link.enabled=true;ui.state.profiles=[];ui.renderActiveContent();check('连接配置丢失仍可关闭联动',!q('[data-key="connection-link"]').disabled);
click('[data-tab="advanced"]');const total=ui.shadow.querySelectorAll('.advanced-item').length;check('全部条目数量不丢失',total===data.prompts.length);
click('[data-action="entry-filter"][data-value="enabled"]');check('已启用筛选',ui.shadow.querySelectorAll('.advanced-item').length===data.prompts.filter(p=>p.enabled).length);
input=q('[data-action="search"]');input.value='不存在的测试项xyz';input.dispatchEvent(new Event('input',{bubbles:true}));check('搜索空结果',!!q('.empty'));input=q('[data-action="search"]');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));click('[data-action="entry-filter"][data-value="all"]');
check('核心保护开关不暴露',[...ui.PROTECTED_IDS].every(id=>!q('[data-key="prompt:'+id+'"]')));
const before=structuredClone(stored);window.failWrite='in_use';ui.applyGroup('plot-pace',ui.GROUPS['plot-pace'].options[1][0]);await ui.settle();check('保存失败回滚持久预设',JSON.stringify(stored)===JSON.stringify(before)&&ui.state.saveState==='error');
check('所有开关可访问名称完整',[...ui.shadow.querySelectorAll('input[type="checkbox"]')].every(e=>e.getAttribute('aria-label')));
ui.state.activeTab='daily';ui.state.disclosures.clear();ui.state.saveState='idle';ui.state.saveMessage='修改后自动保存，下次生成时使用';ui.render();return results;
})()`);
console.log(JSON.stringify(result,null,2));fs.writeFileSync('.ui-review/test-results.json',JSON.stringify(result,null,2));
const worldResults=await evaluate(fs.readFileSync('tests/ui/worldbook-tests.txt','utf8'));console.log(JSON.stringify(worldResults,null,2));fs.writeFileSync('.ui-review/worldbook-test-results.json',JSON.stringify(worldResults,null,2));
const editorResults=await evaluate(fs.readFileSync('tests/ui/editor-tests.txt','utf8'));console.log(JSON.stringify(editorResults,null,2));fs.writeFileSync('.ui-review/editor-test-results.json',JSON.stringify(editorResults,null,2));
const sortResults=await require('./sort-tests.cjs')(cdp,evaluate);console.log(JSON.stringify(sortResults,null,2));fs.writeFileSync('.ui-review/sort-test-results.json',JSON.stringify(sortResults,null,2));
const configurationResults=await evaluate(fs.readFileSync('tests/ui/configuration-tests.txt','utf8'));console.log(JSON.stringify(configurationResults,null,2));fs.writeFileSync('.ui-review/configuration-test-results.json',JSON.stringify(configurationResults,null,2));
const placementResults=await evaluate(fs.readFileSync('tests/ui/placement-tests.txt','utf8'));console.log(JSON.stringify(placementResults,null,2));fs.writeFileSync('.ui-review/placement-test-results.json',JSON.stringify(placementResults,null,2));
console.log(await require('./placement-layout-tests.cjs')(cdp,evaluate));
const syncResults=await evaluate(fs.readFileSync('tests/ui/entry-sync-tests.txt','utf8'));console.log(syncResults);fs.writeFileSync('.ui-review/entry-sync-results.json',JSON.stringify(syncResults,null,2));
for(const [name,width,height,tab] of [['desktop',1280,960,'daily'],['desktop-style',1280,960,'style'],['mobile',390,844,'daily'],['mobile-tools',390,844,'tools'],['desktop-configurations',1280,960,'configurations'],['mobile-configurations',320,640,'configurations'],['small-mobile',320,640,'style'],['desktop-entries',1280,960,'advanced'],['mobile-entries',390,844,'advanced'],['desktop-editor',1280,960,'editor'],['mobile-editor',390,844,'editor'],['small-editor',320,640,'editor']]){
await cdp('Emulation.setDeviceMetricsOverride',{width,height,screenWidth:width,screenHeight:height,deviceScaleFactor:1,mobile:width<720});await evaluate(`ui.closePromptEditor(true);ui.state.activeTab=${JSON.stringify(tab==='editor'?'advanced':tab)};ui.render();${tab==='editor'?'ui.openPromptEditor(ui.IDS.resetCache);':''}`);await new Promise(r=>setTimeout(r,150));
const overflow=await evaluate(`(()=>{const root=ui.shadow;const c=root.querySelector('.content');const p=root.querySelector('.panel').getBoundingClientRect();return {overflow:c.scrollWidth>c.clientWidth+1,panelOutside:p.left<0||p.right>innerWidth+1||p.bottom>innerHeight+1}})()`);assert(!overflow.overflow&&!overflow.panelOutside,name+JSON.stringify(overflow));
if(tab==='editor'){const layout=await evaluate(`(()=>{const p=ui.shadow.querySelector('.prompt-editor');const b=p.getBoundingClientRect();const body=p.querySelector('.prompt-editor-body');return {overflow:body.scrollWidth>body.clientWidth+1,outside:b.left<0||b.right>innerWidth+1||b.bottom>innerHeight+1}})()`);assert(!layout.overflow&&!layout.outside,name+JSON.stringify(layout));}
const shot=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync('.ui-review/'+name+'.png',Buffer.from(shot.data,'base64'));console.log(name+' layout OK');}
const lifecycleResults=await evaluate(fs.readFileSync('tests/ui/configuration-lifecycle-tests.txt','utf8'));console.log(JSON.stringify(lifecycleResults,null,2));fs.writeFileSync('.ui-review/configuration-lifecycle-results.json',JSON.stringify(lifecycleResults,null,2));
await cdp('Browser.close');
}catch(e){console.error(e);process.exitCode=1;}finally{clearTimeout(watchdog);ws?.close();browser.kill();}
})().catch(e => { console.error(e); process.exitCode = 1; });
