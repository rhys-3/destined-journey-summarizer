const assert = require('node:assert/strict');
const fs = require('node:fs');

// Use browser hit testing and native pointer/keyboard dispatch. HTMLElement.click()
// bypasses pointer-events and cannot detect a visible but unreachable dialog.
module.exports = async (cdp, evaluate) => {
  const results = [];
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = async (name, expression) => { assert(await evaluate(expression), name); results.push(name); };
  async function click(selector) {
    const point = await evaluate(`(()=>{const e=ui.shadow.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing click target');e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=ui.shadow.elementFromPoint(x,y);return{x,y,reachable:!!r.width&&!!r.height&&!e.disabled&&(hit===e||e.contains(hit)),hit:hit?.className,pointer:getComputedStyle(e).pointerEvents};})()`);
    assert(point.reachable, selector + ' is not reachable: ' + JSON.stringify(point));
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await pause(50);
  }
  async function fill(selector, value) {
    await click(selector);
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
    await cdp('Input.insertText', { text: value });
    await check('可输入：' + selector, `ui.shadow.querySelector(${JSON.stringify(selector)}).value===${JSON.stringify(value)}`);
  }
  async function choose(selector, value) {
    const index = await evaluate(`[...ui.shadow.querySelector(${JSON.stringify(selector)}).options].findIndex(option=>option.value===${JSON.stringify(value)})`);
    assert(index >= 0, 'Missing option ' + value);
    await click(selector);
    const key = async (name, code) => { for (const type of ['keyDown','keyUp']) await cdp('Input.dispatchKeyEvent',{type,key:name,code:name,windowsVirtualKeyCode:code}); };
    await key('Home',36);
    for (let i=0;i<index;i++) await key('ArrowDown',40);
    await key('Enter',13); await pause(50);
    await check('可选择：'+selector+' → '+value, `ui.shadow.querySelector(${JSON.stringify(selector)}).value===${JSON.stringify(value)}`);
  }
  const confirm = () => click('.dj-dialog-actions button:first-child');
  const cancel = () => click('.dj-dialog-actions button:last-child');
  const closed = () => check('操作后弹窗关闭', `!ui.shadow.querySelector('.dj-dialog')`);
  await evaluate(`(async()=>{await ui.summary.apply({...ui.summary.capture(),enabled:false});ui.state.activeTab='summary';ui.render();Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedSummaryText=text;}}});window.replaceWorldbook=async(name,entries)=>{books[name]=structuredClone(entries);};window.deleteWorldbook=async name=>{delete books[name];};window.dialogSummaryBody='---\\n日期未明 | 地点未明:\\n  时间未明\\n  点击验证记录';window.generateRaw=async request=>{window.lastRequest=request;return '<summary_result>'+dialogSummaryBody+'</summary_result>';};})()`);

  await click('.sa-tab-item[data-tab="settings"]');
  await click('.sa-settings-nav-item[data-sub-nav="core"]');
  await fill('#sa-mega-batch', '4');
  await fill('#sa-mega-trigger', '6');
  await pause(900);
  await check('大总结触发和合并条数可修改并持久化', 'ui.summary.capture().megaTriggerCount===6&&ui.summary.capture().megaBatchCount===4');

  for (const width of [1280, 390, 320]) {
    const height = width === 1280 ? 960 : 844;
    await cdp('Emulation.setDeviceMetricsOverride', { width, height, screenWidth: width, screenHeight: height, deviceScaleFactor: 1, mobile: width < 720 });
    await evaluate('ui.render()'); await pause(80);
    await click('#sa-start-custom-summary');
    await fill('[data-form-field="start"]', '40');await fill('[data-form-field="end"]', '45');
    await check(width + 'px：弹窗输入框获得焦点且确认按钮可用', `ui.shadow.activeElement===ui.shadow.querySelector('[data-form-field="end"]')&&!ui.shadow.querySelector('.dj-dialog-actions button').disabled`);
    const shot = await cdp('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('.ui-review/summary-dialog-' + width + '.png', Buffer.from(shot.data, 'base64'));
    await cancel(); await closed();
  }
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 960, screenWidth: 1280, screenHeight: 960, deviceScaleFactor: 1, mobile: false });
  await evaluate('ui.render()'); await pause(80);
  await click('#sa-start-custom-summary'); await fill('[data-form-field="start"]', '40');await fill('[data-form-field="end"]', '45'); await confirm();
  await pause(150);
  await check('关闭自动总结仍可由指定楼层弹窗确认并生成', `!ui.summary.capture().enabled&&Object.values(books).flat().some(entry=>entry.name==='总结40-45楼'&&entry.content===dialogSummaryBody)`);

  await click('.sa-tab-item[data-tab="prompts"]');
  await click('[data-action-add-block]'); await fill('.dj-dialog textarea', '鼠标新增条目'); await confirm();
  await pause(900);
  const blockId = await evaluate(`ui.summary.capture().promptBlocks.find(block=>block.name==='鼠标新增条目')?.id`);
  assert(blockId, 'Pointer-confirmed block was not saved');
  const openAdded=()=>click('[data-block-edit="'+blockId+'"]');
  await openAdded();await click('.dj-dialog-actions button:nth-child(2)');await cancel();
  await check('删除提示词弹窗可取消',`!!ui.shadow.querySelector('[data-block-edit="${blockId}"]')`);
  await openAdded();await click('.dj-dialog-actions button:nth-child(2)');await confirm();await pause(900);
  await check('删除提示词弹窗可确认并保存',`!ui.summary.capture().promptBlocks.some(block=>block.id==='${blockId}')`);
  for (const selector of ['[data-action-reset-blocks]', '[data-action-reset-mega-blocks]']) {
    await click('[data-prompt-page="' + (selector.includes('mega')?'mega':'normal') + '"]');
    await click(selector); await cancel(); await closed();
    await click(selector); await confirm(); await closed();
  }

  await click('.sa-tab-item[data-tab="worldbook"]');
  await click('#sa-view-worldbook'); await confirm();
  await check('世界书查看弹窗可复制内容', `typeof copiedSummaryText==='string'&&copiedSummaryText.includes('点击验证记录')`);
  await cancel(); await closed();
  await fill('#sa-new-wb-name', '鼠标迁移验证书');
  await click('#sa-switch-worldbook'); await cancel(); await closed();
  await click('#sa-switch-worldbook'); await confirm(); await pause(100);
  await check('迁移确认后保存绑定和条目', `chatVars.summary_assistant_worldbook==='鼠标迁移验证书'&&books['鼠标迁移验证书'].some(entry=>entry.name==='总结40-45楼')`);
  await click('#sa-unbind-worldbook'); await cancel(); await closed();
  await click('#sa-unbind-worldbook'); await confirm();
  await check('解绑后按钮状态与绑定一致', `!chatVars.summary_assistant_worldbook&&ui.shadow.querySelector('#sa-unbind-worldbook').disabled&&ui.shadow.querySelector('#sa-switch-worldbook').disabled`);
  await fill('#sa-new-wb-name', '鼠标迁移验证书'); await click('#sa-bind-worldbook');
  await check('重新绑定后迁移和解绑按钮恢复', `chatVars.summary_assistant_worldbook==='鼠标迁移验证书'&&!ui.shadow.querySelector('#sa-unbind-worldbook').disabled&&!ui.shadow.querySelector('#sa-switch-worldbook').disabled`);
  await click('#sa-delete-worldbook'); await cancel(); await closed();
  await click('#sa-delete-worldbook'); await confirm();
  await check('删除世界书弹窗可确认', `!chatVars.summary_assistant_worldbook`);
  await fill('#sa-new-wb-name', '手动点击验证书'); await click('#sa-bind-worldbook');

  await click('#sa-reset'); await cancel(); await closed();
  await click('#sa-reset'); await confirm(); await pause(100);
  await check('重置总结参数弹窗可确认并恢复默认值', `ui.summary.capture().megaTriggerCount===15&&ui.summary.capture().megaBatchCount===10&&!ui.summary.capture().enabled&&ui.shadow.querySelector('#sa-user-prefix').value==='{{user}}'&&ui.shadow.querySelector('#sa-assistant-prefix').value==='AI'`);
  await click('#sa-start-summary'); await pause(150);
  await check('关闭自动总结仍可点击手动开始并保存', `Object.values(books).flat().some(entry=>entry.name==='总结0-19楼'&&entry.content===dialogSummaryBody)&&!ui.summary.capture().enabled`);
  await evaluate(`window.summaryToastCalls=[];for(const kind of ['info','success','warning','error'])window.toastr[kind]=(...args)=>summaryToastCalls.push([kind,...args]);`);
  for (const width of [1280,390,320]) {
    const height = width===1280?960:844;
    await cdp('Emulation.setDeviceMetricsOverride',{width,height,screenWidth:width,screenHeight:height,deviceScaleFactor:1,mobile:width<720});
    await evaluate('ui.render()'); await pause(80);
    await click('.sa-tab-item[data-tab="status"]');
    await check(width+'px：任务只显示日志，完成后不重复展示总结正文', '!ui.shadow.querySelector("[data-task-result]")&&ui.shadow.querySelector("[data-task-details]").hidden&&ui.shadow.querySelector("[data-task-log]").children.length>=3');
    await check(width+'px：显隐统计包含 0 楼和消息类型', 'ui.shadow.querySelector("#sa-visibility-info").textContent.includes("从 0 楼计数")&&ui.shadow.querySelector("#sa-visibility-info").textContent.includes("AI 输出")');
    await check(width+'px：三个立即操作按钮同排且没有持续选中状态', '(()=>{const buttons=[...ui.shadow.querySelectorAll(".sa-visibility-actions button")],rects=buttons.map(button=>button.getBoundingClientRect()),panel=ui.shadow.querySelector(".sa-visibility-panel").getBoundingClientRect();return buttons.length===3&&buttons[2].textContent==="隐藏已总结楼层"&&buttons.every(button=>!button.hasAttribute("aria-pressed"))&&rects.every(rect=>Math.abs(rect.top-rects[0].top)<1&&rect.left>=panel.left&&rect.right<=panel.right);})()');
    await evaluate('ui.shadow.querySelector(".sa-visibility-panel").scrollIntoView({block:"start"})');
    const visibilityShot=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync('.ui-review/summary-visibility-switch-'+width+'.png',Buffer.from(visibilityShot.data,'base64'));
    let shot=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync('.ui-review/summary-log-'+width+'.png',Buffer.from(shot.data,'base64'));
    await click('.sa-tab-item[data-tab="prompts"]');await click('[data-prompt-page="normal"]');
    await check('提示词只有普通和大总结两个预设页', 'ui.shadow.querySelectorAll("[data-prompt-page]").length===2&&!ui.shadow.querySelector("#sa-depth-worldbook")&&!ui.shadow.querySelector("#sa-result-format")&&!ui.shadow.querySelector("#sa-no-trans-tag")');
    await click('[data-block-enable="format_archive"]');await pause(900);
    await check('格式条目开关互斥并在左下角显示保存结果', 'ui.summary.capture().promptBlocks.find(block=>block.id==="format_archive").enabled&&!ui.summary.capture().promptBlocks.find(block=>block.id==="format_legacy").enabled&&ui.shadow.querySelector(".status").textContent.includes("总结设置已保存")&&summaryToastCalls.length===0');
    await click('[data-block-edit="format_archive"]');
    await check('格式在原生条目编辑窗中完整可编辑', 'ui.shadow.querySelector("[data-form-field=content]").value.includes("【时空与事件】")&&ui.shadow.querySelector("[data-form-field=role]").value==="user"');await cancel();
    await click('[data-block-enable="check_brief"]');await click('[data-block-enable="tail_prefill"]');await pause(900);
    await check('尾部预填充与非预填充二选一', 'ui.summary.capture().promptBlocks.find(block=>block.id==="tail_prefill").enabled&&!ui.summary.capture().promptBlocks.find(block=>block.id==="tail_instruction").enabled');
    await click('[data-prompt-preview="normal"]');
    await check('展开请求反映格式、检查和末尾 assistant 预填充', 'ui.shadow.querySelector(".dj-dialog textarea").value.includes("【时空与事件】")&&ui.shadow.querySelector(".dj-dialog textarea").value.includes("整理前简短核对")&&ui.shadow.querySelector(".dj-dialog textarea").value.includes("[8 · assistant]")&&!ui.shadow.querySelector(".dj-dialog textarea").value.includes("<|no-trans|>")');await cancel();
    await click('[data-block-enable="tail_prefill"]');await pause(900);
    await check('关闭预填充自动恢复另一尾部条目', '!ui.summary.capture().promptBlocks.find(block=>block.id==="tail_prefill").enabled&&ui.summary.capture().promptBlocks.find(block=>block.id==="tail_instruction").enabled');
    await click('[data-block-enable="check_brief"]');await click('[data-block-enable="format_legacy"]');await pause(900);
    shot=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync('.ui-review/summary-native-prompts-'+width+'.png',Buffer.from(shot.data,'base64'));
  }
  await click('.sa-tab-item[data-tab="status"]');await fill('#sa-vis-from','0');await fill('#sa-vis-to','1');await click('#sa-vis-show-range');await pause(150);
  await check('显隐面板可以显示第 0 楼且刷新保持选择','!messages[0].is_hidden&&!messages[1].is_hidden');await click('#sa-vis-refresh');await check('刷新不会再次隐藏手动显示的楼层','!messages[0].is_hidden');
  await check('范围显示为一次操作，并暂停本聊天自动隐藏','!ui.shadow.querySelector("#sa-vis-show-range").hasAttribute("aria-pressed")&&!ui.shadow.querySelector("#sa-vis-auto-hide").checked&&chatVars.summary_assistant_visibility_auto===false');
  await click('#sa-vis-hide-summarized');await pause(150);await check('隐藏已总结楼层立即生效且按钮无持续选中状态','messages[0].is_hidden&&messages[1].is_hidden&&!ui.shadow.querySelector("#sa-vis-hide-summarized").hasAttribute("aria-pressed")');
  await evaluate('ui.render()');await pause(120);await click('.sa-tab-item[data-tab="status"]');
  await check('重开面板后开关保持暂停，按钮不显示长期状态','!ui.shadow.querySelector("#sa-vis-auto-hide").checked&&ui.shadow.querySelector("[data-visibility-policy]").textContent.includes("已暂停")&&!ui.shadow.querySelector(".sa-visibility-panel [aria-pressed]")');
  await click('#sa-vis-show-all');await pause(100);await click('#sa-vis-auto-hide');await pause(100);
  await check('重新开启后清除全部手动选择并按总结隐藏','messages[0].is_hidden&&ui.shadow.querySelector("#sa-vis-auto-hide").checked&&chatVars.summary_assistant_visibility_auto===true&&Object.keys(chatVars.summary_assistant_visibility_overrides).length===0');
  await check('只有一个自动隐藏开关且不出现在生成参数中','!ui.shadow.querySelector("#sa-auto-hide-summarized")&&!ui.shadow.querySelector("#sa-vis-restore-auto")&&ui.shadow.querySelector("#sa-vis-auto-hide").getAttribute("role")==="switch"');
  await click('#sa-vis-auto-hide');await pause(100);await click('#sa-vis-refresh');
  await check('关闭开关保留当前显隐并保存暂停状态','messages[0].is_hidden&&!ui.shadow.querySelector("#sa-vis-auto-hide").checked&&ui.shadow.querySelector("[data-visibility-policy]").textContent.includes("保留当前楼层状态")');
  await click('#sa-vis-show-all');await pause(100);await check('显示全部立即生效，开关继续暂停','messages.every(message=>!message.is_hidden)&&!ui.shadow.querySelector("#sa-vis-show-all").hasAttribute("aria-pressed")&&!ui.shadow.querySelector("#sa-vis-auto-hide").checked');
  let visibilityShot=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync('.ui-review/summary-visibility-state-320.png',Buffer.from(visibilityShot.data,'base64'));
  await click('[data-task-clear-log]');await pause(80);await check('清除完成日志不删除总结记录','ui.shadow.querySelector("[data-task-widget]").hidden&&Object.values(books).flat().some(entry=>entry.content===dialogSummaryBody)');

  await evaluate(`books['原有设定书']=[{uid:99,name:'其他设定',content:'保留资料'}];books['外部空书']=[];globalBooks.push('原有设定书');`);
  await click('.sa-tab-item[data-tab="worldbook"]');await click('#sa-refresh-worldbooks');
  await check('下拉框列出酒馆全部世界书', `[...ui.shadow.querySelector('#sa-wb-select').options].some(option=>option.value==='原有设定书')&&[...ui.shadow.querySelector('#sa-wb-select').options].some(option=>option.value==='外部空书')`);
  await choose('#sa-wb-select','外部空书');await click('#sa-bind-worldbook');
  await check('可以绑定助手目录之外的已有世界书', `chatVars.summary_assistant_worldbook==='外部空书'`);
  await click('.sa-tab-item[data-tab="status"]');await fill('#sa-vis-from','0');await fill('#sa-vis-to','1');await click('#sa-vis-hide-range');await pause(100);
  await check('无总结时仍可手动隐藏并暂停自动状态','messages[0].is_hidden&&!ui.shadow.querySelector("#sa-vis-auto-hide").checked');
  await click('#sa-vis-auto-hide');await pause(100);
  await check('无总结时开启仍清除手动状态，恢复显示并等待总结','!messages[0].is_hidden&&!messages[1].is_hidden&&ui.shadow.querySelector("#sa-vis-auto-hide").checked&&Object.keys(chatVars.summary_assistant_visibility_overrides).length===0&&ui.shadow.querySelector("[data-visibility-policy]").textContent.includes("等待总结")&&!ui.shadow.querySelector("[data-visibility-policy]").textContent.includes("手动")');
  await evaluate('ui.render()');await pause(100);await click('.sa-tab-item[data-tab="status"]');
  await check('无总结状态重开后仍显示开启并等待总结','ui.shadow.querySelector("#sa-vis-auto-hide").checked&&ui.shadow.querySelector("[data-visibility-policy]").textContent.includes("等待总结")');
  await click('#sa-vis-hide-summarized');await check('没有已总结楼层时空操作不会关闭开关','ui.shadow.querySelector("#sa-vis-auto-hide").checked');
  await evaluate('ui.shadow.querySelector(".sa-visibility-panel").scrollIntoView({block:"start"})');
  visibilityShot=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync('.ui-review/summary-visibility-waiting-320.png',Buffer.from(visibilityShot.data,'base64'));
  await click('.sa-tab-item[data-tab="worldbook"]');
  await click('#sa-delete-worldbook');await confirm();
  await check('删除后绑定和下拉选项立即清除', `!books['外部空书']&&!chatVars.summary_assistant_worldbook&&![...ui.shadow.querySelector('#sa-wb-select').options].some(option=>option.value==='外部空书')`);
  await choose('#sa-wb-select','原有设定书');await click('#sa-bind-worldbook');await click('#sa-delete-worldbook');await confirm();
  await check('已有世界书中的其他条目和原有全局启用保持完整', `books['原有设定书'][0].content==='保留资料'&&globalBooks.includes('原有设定书')&&!chatVars.summary_assistant_worldbook&&summaryToastCalls.length===0`);
  await choose('#sa-wb-select','手动点击验证书');await click('#sa-bind-worldbook');
  await click('.sa-tab-item[data-tab="prompts"]');await click('[data-prompt-page="normal"]');
  await check('两套预设都保留可拖动条目、右侧开关与弹窗编辑', 'ui.summary.capture().promptBlocks.length===12&&ui.summary.capture().megaPromptBlocks.length===12&&ui.shadow.querySelectorAll("#sa-blocks-container [draggable=true]").length===12&&ui.shadow.querySelectorAll("#sa-blocks-container [role=switch]").length===12');
  await click('#sa-blocks-container .sa-block-drag');
  for(const type of ['keyDown','keyUp'])await cdp('Input.dispatchKeyEvent',{type,key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40,modifiers:1});await pause(900);
  await check('条目可以使用辅助键向下排序并持久化','ui.summary.capture().promptBlocks[1].id==="jailbreak"');
  for(const type of ['keyDown','keyUp'])await cdp('Input.dispatchKeyEvent',{type,key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38,modifiers:1});await pause(900);
  await check('条目可以移回原位','ui.summary.capture().promptBlocks[0].id==="jailbreak"');
  await require('./usability-tests.cjs')(cdp,evaluate,{click,fill,choose,check,pause,confirm,cancel});
  console.log(results);
  fs.writeFileSync('.ui-review/summary-dialog-results.json', JSON.stringify(results, null, 2));
};
