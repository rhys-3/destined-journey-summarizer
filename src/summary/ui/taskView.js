import { getTask, subscribeTask, phaseLabels, canStopTask, stopTask, dismissTask, clearTaskLog, selectTaskBatch } from '../taskState.js';
import { retryTask, skipPendingTask } from '../summary.js';
import { getHost, isBusy, runAction } from '../../platform/lifecycle.js';
import { escapeHtml } from '../utils.js';

export const TASK_STYLES = `
.sa-task-batches{margin:10px 0}.sa-task-batch-list{display:grid;gap:5px;margin:7px 0}.sa-task-batch-list button{display:flex;align-items:center;justify-content:space-between;gap:10px;text-align:left}.sa-task-batch-list button[aria-current="true"]{border-color:var(--gold);color:var(--gold)}.sa-task-batch-list small{white-space:nowrap}.sa-task-batch-pages{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px}
.sa-notice-layer{position:fixed;top:var(--sa-toolbar-bottom,48px);left:max(8px,env(safe-area-inset-left));right:max(8px,env(safe-area-inset-right));z-index:2147483600;pointer-events:none;display:flex;justify-content:center;padding-top:6px}
.sa-notice{pointer-events:auto;width:min(430px,100%);box-sizing:border-box;background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:12px;padding:12px 46px 10px 14px;box-shadow:0 8px 28px var(--shadow);position:relative;line-height:1.6;overflow-wrap:anywhere}
.sa-notice[hidden],.sa-notice-layer[hidden],[data-task-widget][hidden]{display:none}
.sa-notice-title{font-weight:600}.sa-notice button,.sa-task-widget button{border:1px solid var(--line);background:var(--soft);color:var(--ink);border-radius:7px;padding:7px 10px;min-height:36px;font:inherit;cursor:pointer}.sa-notice button:focus-visible,.sa-task-widget button:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
.sa-notice button:disabled,.sa-task-widget button:disabled{opacity:.55;cursor:default}.sa-notice-actions,.sa-task-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.sa-notice .sa-notice-close{position:absolute;right:5px;top:5px;border:0;background:transparent;min-width:36px}
.sa-summary-badge{font-size:11px;border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:8px;padding:3px 7px;white-space:nowrap}.orb .sa-summary-badge{position:absolute;right:0;top:-12px;pointer-events:none}
.sa-task-widget{border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:14px;background:var(--soft);color:var(--ink)}.sa-task-heading{display:flex;gap:12px;justify-content:space-between;align-items:baseline;flex-wrap:wrap}.sa-task-heading [data-task-title]{font-weight:600}.sa-task-widget textarea{box-sizing:border-box;width:100%;min-height:180px;background:var(--input);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:12px;resize:vertical;line-height:1.7;margin-top:10px}.sa-task-result,.sa-task-details{white-space:pre-wrap;overflow-wrap:anywhere;max-height:360px;overflow:auto;line-height:1.8;font:inherit;background:var(--input);padding:14px;border-radius:8px}.sa-task-details{max-height:200px;font-size:12px}.sa-task-reason,.sa-next-task-note{font-size:12px;color:var(--muted);margin:6px 0}.sa-task-widget [hidden]{display:none!important}.sa-task-widget .sa-disclosure{margin-top:10px}
@media(max-width:540px){.sa-notice{padding-left:11px;font-size:13px}.sa-notice button,.sa-task-widget button{min-height:40px}.sa-task-actions{gap:6px}}
@media(prefers-reduced-motion:reduce){.sa-notice,.sa-task-widget{animation:none!important;transition:none!important}}
`;
const mutations = '#sa-start-summary,#sa-start-custom-summary,#sa-start-mega-summary,#sa-confirm-mega-summary,#sa-bind-worldbook,#sa-switch-worldbook,#sa-unbind-worldbook,#sa-delete-worldbook,#sa-reset,#sa-vis-auto-hide,[id^="sa-vis-"]:is(button),[data-action="regenerate"],[data-action="regenerate-mega"],[data-action="enable-summary"],[data-action="disable-summary"],[data-action="delete"],[data-action="delete-mega"],[data-action="activate-mega"],[data-action="deactivate-mega"],[data-action-reset-blocks],[data-action-reset-mega-blocks],[data-summary-reset],[data-record-save],[data-action="configuration-apply"],[data-action="configuration-recover"],[data-action="configuration-switch"]';
export function applyBusyRules(root) {
  if (!root) return;
  const busy = isBusy();
  for (const button of root.querySelectorAll(mutations)) {
    if(button.id==='sa-vis-refresh')continue;
    if (busy) { if (!button.hasAttribute('data-task-locked')) button.dataset.wasDisabled = String(button.disabled); button.dataset.taskLocked = 'true'; button.disabled = true; button.setAttribute('aria-describedby','sa-busy-reason'); }
    else if (button.hasAttribute('data-task-locked')) { button.disabled = button.dataset.wasDisabled === 'true'; delete button.dataset.taskLocked; delete button.dataset.wasDisabled; button.removeAttribute('aria-describedby'); }
  }
  for(const button of root.querySelectorAll('[data-floor-toggle]'))button.disabled=busy;
  for (const button of root.querySelectorAll('[data-action="view-edit"],[data-action="view-edit-mega"]')) button.textContent = busy ? '查看 / 复制' : '查看 / 编辑';
  const reason = root.querySelector('#sa-busy-reason'); if (reason) { reason.hidden = !busy; reason.textContent = '当前总结任务尚未结束：记录暂时只读。提示词和连接参数的修改将在下次任务生效。'; }
}
export const taskSummary = task => task ? `${task.running ? '◌ ' : task.phase === 'complete' ? '✓ ' : '⚠ '}${task.running ? phaseLabels[task.phase] : task.message || phaseLabels[task.phase]} · ${task.spec.startFloor}—${task.spec.endFloor} 楼` : '';
const retryLabel = task => task.batches?.length>1?'继续未完成批次':task.errorKind === 'visibility' ? '重试隐藏' : task.errorKind === 'save' ? '重试保存' : task.phase === 'stopped' ? '继续本次' : '重试生成';
function renderTaskBatches(widget, task) {
  const target=widget.querySelector('[data-task-batches]'),batches=task.batches??[];
  target.hidden=batches.length<2;if(target.hidden)return;
  const pages=Math.ceil(batches.length/8),page=Math.max(0,Math.min(pages-1,task.running?Math.floor((task.selectedBatch??0)/8):Number(widget.dataset.batchPage??Math.floor((task.selectedBatch??0)/8))));
  widget.dataset.batchPage=page;
  const labels={...phaseLabels,queued:'未开始',skipped:'已跳过',paused:'未执行'};
  target.innerHTML=`<div>本轮 ${batches.length} 批 · 已完成 ${batches.filter(batch=>batch.phase==='complete').length} 批</div><div class="sa-task-batch-list">${batches.slice(page*8,page*8+8).map((batch,offset)=>{const index=page*8+offset;return `<button type="button" data-task-batch="${index}" aria-current="${index===(task.selectedBatch??0)}" ${task.running||['complete','skipped','paused'].includes(batch.phase)?'disabled':''}><span>第 ${index+1} 批 · ${batch.spec.startFloor}—${batch.spec.endFloor} 楼</span><small>${labels[batch.phase]??'待处理'}</small></button>`;}).join('')}</div>${pages>1?`<div class="sa-task-batch-pages"><button type="button" data-task-batch-page="-1" ${page===0?'disabled':''}>上一页</button><span>${page+1} / ${pages}</span><button type="button" data-task-batch-page="1" ${page+1>=pages?'disabled':''}>下一页</button></div>`:''}`;
}
export function refreshTaskWidget(panel) {
  applyBusyRules(panel);
  const widget = panel?.querySelector('[data-task-widget]'); if (!widget) return;
  const task = getTask(); widget.hidden = !task;
  if (!task) return;
  if (widget.dataset.taskId !== task.id) {
    widget.dataset.taskId = task.id;
    widget.innerHTML = '<div class="sa-task-heading"><div data-task-title role="status" aria-live="polite"></div><span class="sa-task-reason" data-task-elapsed></span></div><ol class="sa-task-log" data-task-log aria-label="本次任务日志"></ol><p class="sa-task-reason" data-task-message></p><div class="sa-task-actions" data-task-main-actions><button data-task-stop>停止本次任务</button><button data-task-retry></button></div><details class="sa-disclosure" data-task-details hidden><summary><span>处理待完成结果</span><span class="sa-disclosure-arrow" aria-hidden="true">⌄</span></summary><div class="sa-disclosure-content"><textarea data-task-body aria-label="待处理总结正文"></textarea><div class="sa-task-actions"><button data-task-copy>复制正文</button><button data-task-save>保存编辑后的正文</button><button data-task-regenerate>重新生成</button><button data-task-skip>跳过此批</button></div></div></details><details class="sa-disclosure" data-task-tech-section hidden><summary><span>错误详情与原始返回</span><span class="sa-disclosure-arrow" aria-hidden="true">⌄</span></summary><pre class="sa-task-details" data-task-tech></pre></details>';
    widget.querySelector('[data-task-stop]').onclick = stopTask;
    widget.querySelector('[data-task-retry]').onclick = () => runAction(() => retryTask());
    widget.querySelector('[data-task-regenerate]').onclick = () => runAction(() => retryTask('generate'));
    widget.querySelector('[data-task-save]').onclick = () => runAction(() => retryTask('save', widget.querySelector('[data-task-body]').value));
    widget.querySelector('[data-task-skip]').onclick = () => runAction(skipPendingTask);
    widget.querySelector('[data-task-copy]').onclick = () => panel.ownerDocument.defaultView.navigator.clipboard.writeText(widget.querySelector('[data-task-body]').value).catch(() => getHost()?.status('复制失败，可在文本框内手动选择复制','error'));
    widget.querySelector('[data-task-body]').value = task.body ?? '';
    const batches=widget.ownerDocument.createElement('div');batches.className='sa-task-batches';batches.dataset.taskBatches='';widget.querySelector('[data-task-log]').before(batches);
    delete widget.dataset.batchPage;
    batches.onclick=event=>{
      const page=event.target.closest('[data-task-batch-page]');
      if(page){widget.dataset.batchPage=Number(widget.dataset.batchPage??0)+Number(page.dataset.taskBatchPage);refreshTaskWidget(panel);return;}
      const button=event.target.closest('[data-task-batch]');if(!button)return;
      if(widget.querySelector('[data-task-body]').value!==(getTask()?.body??'')){getHost()?.status('请先保存当前批次的修改，再切换批次。','info');return;}
      selectTaskBatch(Number(button.dataset.taskBatch));
    };
    const clear=widget.ownerDocument.createElement('button');clear.type='button';clear.dataset.taskClearLog='';clear.textContent='清除日志';clear.title='清除日志，不删除总结记录或未完成任务';
    widget.querySelector('.sa-task-heading').append(clear);
    clear.onclick=()=>{try{clearTaskLog();getHost()?.status('日志已清除','success');}catch(error){getHost()?.status(error.message,'error');}};
  }
  const pending = !task.running && task.phase !== 'complete';
  widget.querySelector('[data-task-title]').textContent = taskSummary(task);
  renderTaskBatches(widget,task);
  const log = widget.querySelector('[data-task-log]');
  const logHtml = (task.log ?? [{ at: task.startedAt, phase: task.phase }]).map(item => `<li><time>${escapeHtml(new Date(item.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}))}</time><span>${escapeHtml(phaseLabels[item.phase] ?? item.phase)}</span></li>`).join('');
  if (log.innerHTML !== logHtml) log.innerHTML = logHtml;
  widget.querySelector('[data-task-clear-log]').disabled=task.phase!=='complete'&&!logHtml;
  const message = widget.querySelector('[data-task-message]');
  message.hidden = task.phase === 'complete';
  message.textContent = task.running ? '关闭面板可继续聊天；本次使用开始时的设置。' : task.message || '本次任务等待处理。';
  const body = widget.querySelector('[data-task-body]');
  body.readOnly = !pending;
  body.hidden = !pending;
  if (!pending) body.value = '';
  const bodyKey=task.id+':'+(task.selectedBatch??0)+':'+task.phase;
  if(pending&&widget.dataset.bodyKey!==bodyKey)body.value=task.body??'';
  widget.dataset.bodyKey=bodyKey;
  widget.querySelector('[data-task-details]').hidden = !pending;
  widget.querySelector('[data-task-main-actions]').hidden = task.phase === 'complete';
  widget.querySelector('[data-task-tech]').textContent = pending ? [task.details, task.raw].filter(Boolean).join('\n\n') : '';
  widget.querySelector('[data-task-tech-section]').hidden = !pending || !(task.details || task.raw);
  if (pending && widget.dataset.phase !== task.phase) widget.querySelector('[data-task-details]').open = true;
  widget.dataset.phase = task.phase;
  const stop = widget.querySelector('[data-task-stop]'); stop.hidden = !task.running; stop.disabled = !canStopTask(task);
  widget.querySelector('[data-task-retry]').hidden = !pending; widget.querySelector('[data-task-retry]').textContent = retryLabel(task);
  for (const action of ['save','regenerate','skip']) widget.querySelector(`[data-task-${action}]`).hidden = !pending;
  widget.querySelector('[data-task-copy]').hidden = !task.body && !pending;
  widget.querySelector('[data-task-save]').disabled = !task.sources?.length || task.saved === true;
  widget.querySelector('[data-task-elapsed]').textContent = `已用 ${Math.max(0,Math.floor(((task.endedAt ?? Date.now())-task.startedAt)/1000))} 秒${task.running && !canStopTask(task) ? ' · 正在提交，暂不能停止' : ''}`;
}
export function createTaskView(host) {
  let layer, card, seenId, timer;
  const root = () => host.getRoot?.();
  const view = () => { host.openSummary(); queueMicrotask(() => { root()?.querySelector('.sa-tab-item[data-tab="status"]')?.click(); const details = root()?.querySelector('[data-task-details]'); if (details) details.open = true; }); };
  function refresh() {
    const app = root(); if (!app) return;
    const task = getTask();
    for (const parent of app.querySelectorAll('.orb,.panel-header .panel-title,.header-title')) {
      let badge = parent.querySelector('.sa-summary-badge');
      if (task && task.phase !== 'complete') { if (!badge) { badge = app.ownerDocument.createElement('span'); badge.className = 'sa-summary-badge'; parent.append(badge); } badge.textContent = task.running ? '总结中' : '待处理'; }
      else badge?.remove();
    }
    // A persistent compact badge also remains visible while another assistant page is open.
    const panel = app.querySelector('.panel');
    if (panel) {
      let badge = panel.querySelector('[data-summary-global-status]');
      if (!badge) { badge = app.ownerDocument.createElement('button'); badge.type = 'button'; badge.className = 'sa-summary-badge'; badge.dataset.summaryGlobalStatus = ''; badge.onclick = view; panel.querySelector('header,.panel-header,.panel-head')?.append(badge); }
      badge.hidden = !task || task.phase === 'complete'; badge.textContent = task?.running ? '总结中 · 查看' : '总结待处理 · 查看';
      let reason=panel.querySelector('[data-summary-lock-reason]');
      if(!reason){reason=app.ownerDocument.createElement('span');reason.dataset.summaryLockReason='';reason.className='sa-task-reason';panel.querySelector('.configuration-shortcut')?.append(reason);}
      reason.textContent=isBusy()?'当前总结任务尚未结束，配置切换暂不可用':'';
    }
    refreshTaskWidget(app);
    if (!layer?.isConnected) { layer = app.ownerDocument.createElement('div'); layer.className = 'sa-notice-layer'; app.append(layer); }
    const visible = task && (task.running ? !task.dismissedProgress : !task.dismissedFinal && (task.phase !== 'complete' || (!task.dismissedProgress && Date.now() - task.endedAt < 4000)));
    layer.hidden = !visible; if (!visible) return;
    const toolbar = app.ownerDocument.querySelector('#top-bar,#top-settings-holder');
    layer.style.setProperty('--sa-toolbar-bottom', `${Math.max(0,toolbar?.getBoundingClientRect().bottom ?? 42)}px`);
    if (seenId !== task.id || !card) {
      seenId = task.id; layer.innerHTML = '<section class="sa-notice" aria-label="总结任务提示"><div class="sa-notice-title" role="status" aria-live="polite"></div><div data-notice-elapsed></div><div class="sa-notice-actions"><button data-notice-view>查看</button><button data-notice-stop>停止本次</button><button data-notice-retry></button></div><button class="sa-notice-close" aria-label="关闭提示，任务继续">×</button></section>';
      card = layer.firstElementChild;
      card.querySelector('.sa-notice-close').onclick = dismissTask;
      card.querySelector('[data-notice-view]').onclick = view;
      card.querySelector('[data-notice-stop]').onclick = stopTask;
      card.querySelector('[data-notice-retry]').onclick = () => runAction(() => retryTask());
    }
    card.querySelector('.sa-notice-title').textContent = taskSummary(task);
    card.querySelector('[data-notice-elapsed]').textContent = task.running ? `已用 ${Math.floor((Date.now()-task.startedAt)/1000)} 秒` : '';
    const stop = card.querySelector('[data-notice-stop]'); stop.hidden = !task.running; stop.disabled = !canStopTask(task);
    const retry = card.querySelector('[data-notice-retry]'); retry.hidden = task.running || task.phase === 'complete'; retry.textContent = retryLabel(task);
  }
  const off = subscribeTask(refresh); timer = setInterval(refresh, 1000);
  return { refresh, destroy() { clearInterval(timer); off(); layer?.remove(); root()?.querySelectorAll('.sa-summary-badge').forEach(badge => badge.remove()); } };
}
