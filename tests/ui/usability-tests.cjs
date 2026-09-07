const fs=require('node:fs');

module.exports=async(cdp,evaluate,{click,fill,choose,check,pause,confirm,cancel})=>{
  const key=async(name,code)=>{for(const type of ['keyDown','keyUp'])await cdp('Input.dispatchKeyEvent',{type,key:name,code:name,windowsVirtualKeyCode:code});};
  const size=async width=>{const height=width===1280?960:844;await cdp('Emulation.setDeviceMetricsOverride',{width,height,screenWidth:width,screenHeight:height,deviceScaleFactor:1,mobile:width<720});};
  const shot=async name=>{const result=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync('.ui-review/usability-'+name+'.png',Buffer.from(result.data,'base64'));};
  await evaluate(`window.usabilityBefore={settings:ui.summary.capture(),messages:structuredClone(messages),chatVars:structuredClone(chatVars),books:structuredClone(books),globalBooks:structuredClone(globalBooks),generate:generateRaw,getMessages:getChatMessages};`);
  await size(1280);await evaluate('ui.render()');await pause(100);
  await click('.sa-tab-item[data-tab="settings"]');await click('[data-sub-nav="core"]');
  await choose('#sa-batch-preset','with-summary');await pause(900);
  await check('摘要推荐为 50/10，单批上限保持独立且解释本轮 20＋20','ui.summary.capture().triggerFloorCount===50&&ui.summary.capture().keepFloorCount===10&&ui.summary.capture().batchFloorCount===20&&ui.shadow.querySelector("[data-batch-explanation]").textContent.includes("20＋20")');
  await fill('#sa-batch-count','30');await pause(900);
  await check('调整单批上限为 30 后明确显示本轮 30＋10','ui.shadow.querySelector("[data-batch-explanation]").textContent.includes("30＋10")&&ui.summary.capture().batchPreset==="with-summary"');
  await choose('#sa-batch-preset','without-summary');await pause(900);
  await check('无摘要推荐为 20/5，不覆盖单批上限','ui.summary.capture().triggerFloorCount===20&&ui.summary.capture().keepFloorCount===5&&ui.summary.capture().batchFloorCount===30');
  await fill('#sa-trigger-count','35');await pause(900);
  await check('手动修改数字自动转为自定义','ui.summary.capture().batchPreset==="custom"');
  await choose('#sa-batch-preset','with-summary');await click('#sa-parallel-batches');await fill('#sa-batch-concurrency','3');await pause(900);
  await check('并发可选且并发数持久化，提示同组记忆限制','ui.summary.capture().parallelBatches&&ui.summary.capture().batchConcurrency===3&&!ui.shadow.querySelector("[data-batch-history-hint]").hidden');
  for(const width of [1280,390,320]){
    await size(width);await evaluate('ui.shadow.querySelector("[data-sub-pane=core]").scrollIntoView({block:"start"})');await shot('batches-'+width);
    await check(width+'px：批次设置没有横向溢出','(()=>{const p=ui.shadow.querySelector("[data-sub-pane=core]");return p.scrollWidth<=p.clientWidth+1;})()');
  }
  await click('#sa-parallel-batches');await pause(900);
  await check('关闭并发后回到串行，并发数不可编辑','!ui.summary.capture().parallelBatches&&ui.shadow.querySelector("#sa-batch-concurrency").disabled');

  await click('[data-sub-nav="tags"]');
  await check('排除标签默认为空','ui.summary.capture().excludeTags.length===0&&ui.shadow.querySelectorAll("[data-tag-key=excludeTags] [data-tag-remove]").length===0');
  await fill('#sa-exclude-tags','aside');await key('Enter',13);await pause(900);
  await check('标签按回车添加为独立项并持久保存','ui.summary.capture().excludeTags.join() === "aside"&&ui.shadow.querySelector("#sa-exclude-tags").value===""');
  await click('#sa-exclude-tags');await cdp('Input.insertText',{text:'！'});
  await check('标签输入阻止标点进入名称','ui.shadow.querySelector("#sa-exclude-tags").value===""');
  await fill('#sa-exclude-tags','note');await cdp('Input.insertText',{text:'，'});await pause(900);
  await check('误按中文逗号会提交已有名称，不把逗号存入标签','ui.summary.capture().excludeTags.join() === "aside,note"&&ui.shadow.querySelector("#sa-exclude-tags").value===""');
  // Clipboard text is synthetic; commit and persistence use the actual paste handler.
  await evaluate(`(()=>{const clipboardData=new DataTransfer();clipboardData.setData('text','meta， aside；comment');ui.shadow.querySelector('#sa-exclude-tags').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData}));})()`);await pause(900);
  await check('粘贴中文分隔符可拆成标签且自动去重','ui.summary.capture().excludeTags.join() === "aside,note,meta,comment"');
  await fill('#sa-include-tags','not_committed');await pause(900);
  await check('未点添加的名称不会成为隐藏设置','!ui.summary.capture().includeTags.includes("not_committed")');
  await fill('#sa-include-tags','');
  for(const width of [1280,320]){await size(width);await evaluate('ui.shadow.querySelector("[data-sub-pane=tags]").scrollIntoView({block:"start"})');await shot('tags-'+width);}
  for(const tag of ['aside','note','meta','comment'])await click('[data-tag-remove="'+tag+'"]');await pause(900);
  await check('标签逐项移除后可保存为空','ui.summary.capture().excludeTags.length===0');

  await evaluate(`messages.push(...Array.from({length:3000-messages.length},(_,offset)=>{const id=offset+usabilityBefore.messages.length;return {message_id:id,role:id%2?'assistant':'user',message:'<gametxt>分页测试 '+id+'</gametxt>',is_hidden:id%3===0};}));`);
  await click('.sa-tab-item[data-tab="status"]');await click('#sa-vis-refresh');await pause(120);
  await check('三千楼的明细默认折叠且不生成隐藏表格行','!ui.shadow.querySelector("[data-floor-details]").open&&ui.shadow.querySelectorAll("[data-floor-view]").length===0');
  await check('交错显隐的范围概览保持短小，不输出几千个编号','[...ui.shadow.querySelectorAll(".sa-visibility-ranges strong")].every(range=>range.textContent.length<160)&&ui.shadow.querySelectorAll("[data-floor-visibility]").length===2');
  await click('[data-floor-details] > summary');
  await check('打开明细仅渲染 30 楼，页码为 1/100','ui.shadow.querySelectorAll("[data-floor-view]").length<=30&&ui.shadow.querySelector(".sa-floor-pages").textContent.includes("1 / 100")');
  await fill('[data-floor-jump-input]','2999');await click('[data-floor-jump]');
  await check('输入楼层直达最后一页，不用翻过前面 99 页','ui.shadow.querySelector(`[data-floor-view][data-from="2999"]`)&&ui.shadow.querySelector(".sa-floor-pages").textContent.includes("100 / 100")');
  await evaluate(`window.floorViewReads=[];window.getChatMessages=(range,options)=>{floorViewReads.push(range);return usabilityBefore.getMessages(range,options);};`);
  await click('[data-floor-view][data-from="2999"]');
  require('node:assert/strict').deepEqual(await evaluate('floorViewReads'),['2999-2999'],'查看原文不应触发全聊天读取');
  await check('查看只读取点击的原文楼层','ui.shadow.querySelector(".dj-dialog textarea").value.includes("分页测试 2999")');await cancel();
  await evaluate('window.getChatMessages=usabilityBefore.getMessages;');
  await evaluate('window.floorFeedbackBefore=JSON.stringify(ui.state.summaryFeedback);');
  await choose('[data-floor-filter="role"]','user');await choose('[data-floor-filter="visibility"]','hidden');
  await check('分页支持消息类型与隐藏状态组合筛选','[...ui.shadow.querySelectorAll("[data-floor-view]")].every(button=>{const m=messages[Number(button.dataset.from)];return m.role==="user"&&m.is_hidden;})&&ui.shadow.querySelectorAll("[data-floor-view]").length<=30');
  await check('筛选仅浏览楼层，不触发总结参数保存','JSON.stringify(ui.state.summaryFeedback)===floorFeedbackBefore');
  for(const width of [1280,390,320]){
    await size(width);await evaluate('ui.shadow.querySelector("[data-floor-details]").scrollIntoView({block:"start"})');await shot('floors-'+width);
    await check(width+'px：楼层筛选和分页没有横向溢出','(()=>{const p=ui.shadow.querySelector("[data-floor-browser]");return p.scrollWidth<=p.clientWidth+1;})()');
  }
  await click('[data-floor-details] > summary');await check('重新收起明细释放表格行','ui.shadow.querySelectorAll("[data-floor-view]").length===0');
  await click('[data-floor-visibility="hidden"]');await check('范围概览的查看可进入对应分页','ui.shadow.querySelector("[data-floor-details]").open&&ui.shadow.querySelector("[data-floor-filter=visibility]").value==="hidden"');

  await evaluate(`(async()=>{messages=Array.from({length:70},(_,id)=>({message_id:id,role:'assistant',message:'<gametxt>批次界面 '+id+'</gametxt>',is_hidden:false}));books['批次界面验证书']=[];chatVars={summary_assistant_worldbook:'批次界面验证书',summary_assistant_visibility_auto:false};await ui.summary.apply({...usabilityBefore.settings,enabled:false,parallelBatches:true,batchConcurrency:2,batchFloorCount:20,keepFloorCount:10});window.uiBatchCalls=[];window.uiBatchResolvers=[];window.generateRaw=request=>{uiBatchCalls.push(request);return new Promise((resolve,reject)=>uiBatchResolvers.push({resolve,reject}));};ui.render();})()`);await pause(100);
  await click('#sa-start-summary');await pause(150);await click('.sa-tab-item[data-tab="status"]');
  await check('界面启动三批任务，仅同时生成两批，其余等待','uiBatchCalls.length===2&&ui.shadow.querySelectorAll("[data-task-batch]").length===3&&ui.shadow.querySelector(`[data-task-batch="2"]`).textContent.includes("未开始")');
  await evaluate(`uiBatchResolvers[1].reject(Object.assign(Error('第二批请求失败'),{status:401}));uiBatchResolvers[0].reject(Object.assign(Error('第一批请求失败'),{status:401}));`);await pause(150);
  await click('[data-task-batch="1"]');await check('选中待处理批次后正文区域保持展开','ui.shadow.querySelector("[data-task-details]").open');
  await fill('[data-task-body]',await evaluate('dialogSummaryBody+"\\n  第二批编辑"'));
  await click('[data-task-batch="0"]');
  await check('切换待处理批次前保留未保存正文','ui.shadow.querySelector(`[data-task-batch="1"]`).getAttribute("aria-current")==="true"&&ui.shadow.querySelector("[data-task-body]").value.includes("第二批编辑")');
  await click('[data-task-save]');await pause(160);
  await check('保存选中批次只处理该批，其他待处理批次保留','uiBatchCalls.length===2&&books["批次界面验证书"].some(entry=>entry.name==="总结20-39楼")&&!books["批次界面验证书"].some(entry=>entry.name==="总结0-19楼")&&ui.shadow.querySelector(`[data-task-batch="1"]`).disabled');
  await evaluate('ui.shadow.querySelector("[data-task-widget]").scrollIntoView({block:"start"})');await shot('pending-batches-320');
  await click('[data-task-retry]');await pause(100);
  await check('继续任务只生成未完成的两批','uiBatchCalls.length===4');
  await evaluate(`uiBatchResolvers[3].resolve('<summary_result>'+dialogSummaryBody+'</summary_result>');uiBatchResolvers[2].resolve('<summary_result>'+dialogSummaryBody+'</summary_result>');`);await pause(180);
  await check('继续后全部完成且已保存批次没有重复','books["批次界面验证书"].filter(entry=>/^总结/.test(entry.name)).length===3&&ui.shadow.querySelector("[data-task-batches]").textContent.includes("已完成 3 批")');
  await click('[data-task-clear-log]');
  await evaluate(`(async()=>{messages=usabilityBefore.messages;chatVars=usabilityBefore.chatVars;books=usabilityBefore.books;globalBooks=usabilityBefore.globalBooks;window.generateRaw=usabilityBefore.generate;await ui.summary.apply(usabilityBefore.settings);ui.render();})()`);await pause(100);

  await size(320);await evaluate(`ui.state.activeTab='style';ui.state.editorUnlocked=true;ui.render();`);
  await click('[data-action="entry-new-here"][data-block="style-extra"]');await click('[data-action="prompt-close"]');
  await check('原生点击：新建默认条目不需要放弃修改确认','!ui.state.promptEditor&&!ui.shadow.querySelector("[data-action=prompt-discard]")');
  await click('[data-action="entry-new-here"][data-block="style-extra"]');await fill('[data-action="prompt-field"][data-field="name"]','界面确认测试条目');
  await click('[data-action="prompt-save"]');await pause(500);
  require('node:assert/strict').equal(await evaluate('ui.state.promptEditor&&({saving:ui.state.promptEditor.saving,message:ui.state.promptEditor.message,dirty:ui.state.promptEditor.dirty})'),null,'第一次点击保存应完成提交');
  await check('原生点击：保存成功直接关闭编辑窗','!ui.state.promptEditor&&data.prompts.some(prompt=>prompt.name==="界面确认测试条目")');
  await evaluate(`window.pointerEntryId=data.prompts.find(prompt=>prompt.name==='界面确认测试条目').id;ui.openPromptEditor(pointerEntryId);`);
  await click('[data-action="entry-delete"]');await shot('delete-entry-320');await cancel();
  await check('原生点击：前端取消删除保留条目与编辑窗','!!ui.state.promptEditor&&data.prompts.some(prompt=>prompt.id===pointerEntryId)');
  await click('[data-action="entry-delete"]');await confirm();await pause(500);
  await check('原生点击：前端确认删除同步酒馆并关闭编辑窗','!ui.state.promptEditor&&!data.prompts.some(prompt=>prompt.id===pointerEntryId)&&!stored.prompts.some(prompt=>prompt.id===pointerEntryId)');
  await evaluate(`(async()=>{window.pointerConfigId=await ui.saveNamedConfiguration('前端改名验证','',{preset:false,summary:true});ui.state.activeTab='configurations';ui.render();})()`);await pause(100);
  const configId=await evaluate('pointerConfigId');
  await click('[data-action="configuration-rename"][data-id="'+configId+'"]');await fill('[data-form-field="text"]','前端改名已保存');await confirm();await pause(500);
  await check('配置重命名也使用助手输入弹窗','ui.configLibrary().items.find(item=>item.id===pointerConfigId).name==="前端改名已保存"&&!ui.shadow.querySelector(".dj-dialog")');
  await click('[data-action="configuration-delete"][data-id="'+configId+'"]');await confirm();await pause(500);
  await check('配置删除使用助手确认弹窗','!ui.configLibrary().items.some(item=>item.id===pointerConfigId)');
  await evaluate(`ui.state.editorUnlocked=false;ui.state.activeTab='summary';ui.render();delete window.usabilityBefore;`);
};
