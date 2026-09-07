import { visibilitySnapshot, readVisibilityAutomation } from '../visibility.js';
import { compressRanges, escapeHtml } from '../utils.js';
import { getSettings } from '../storage.js';

export function refreshVisibilityControls(panel, floors = panel._visibilityFloors ?? new Set()) {
  panel._visibilityFloors=floors;
  const enabled=readVisibilityAutomation(getSettings().autoHideSummarizedFloors);
  panel.querySelector('#sa-vis-auto-hide').checked=enabled;
  panel.querySelector('[data-visibility-mode]').textContent=enabled?'已开启':'已暂停';
  panel.querySelector('[data-visibility-policy]').textContent=automationDescription(enabled,panel._visibilitySnapshot?.counts.covered??0);
}
const automationDescription = (enabled, covered) => !enabled
  ? '已暂停，保留当前楼层状态。后续总结保存后不会自动隐藏。'
  : covered ? `已开启，按有效总结管理 ${covered} 楼。后续总结保存后会继续自动隐藏。`
  : '已开启，等待总结。有效总结保存后，将自动隐藏对应楼层。';

function renderRangePreview(ids, visibility, label) {
  const full=compressRanges(ids),ranges=full.replace(/（共\d+层）$/,'').split(', ');
  const shortened=ranges.length>6;
  const preview=shortened?`${ranges.slice(0,6).join(', ')}…（共 ${ranges.length} 段）`:full;
  return `<div><span>${label}</span><strong>${escapeHtml(preview)}</strong>${shortened?`<button type="button" class="sa-btn sa-btn-sm" data-floor-visibility="${visibility}" aria-label="查看全部${label}楼层">查看</button>`:''}</div>`;
}

export function renderVisibilityInfo(floors, panel) {
  const state=visibilitySnapshot(floors), {counts,groups}=state;
  if(panel)panel._visibilitySnapshot=state;
  return `<div class="sa-visibility-counts"><div><strong>${counts.total}</strong><span>全部楼层${counts.total?' · 从 0 楼计数':''}</span></div><div><strong>${counts.shown}</strong><span>显示中</span></div><div><strong>${counts.hidden}</strong><span>已隐藏</span></div></div>
    <p class="sa-role-counts">用户输入 <b>${counts.user}</b> 楼（显示 ${counts.shownUser}） · AI 输出 <b>${counts.assistant}</b> 楼（显示 ${counts.shownAssistant}）${counts.system ? ` · 系统 ${counts.system} 楼` : ''}</p>
    <div class="sa-visibility-ranges">${renderRangePreview(state.shownIds,'shown','显示')}${renderRangePreview(state.hiddenIds,'hidden','隐藏')}</div>
    <details class="sa-disclosure" data-floor-details><summary><span>查看各楼层与消息类型</span><span class="sa-disclosure-arrow" aria-hidden="true">⌄</span></summary><div data-floor-browser></div></details>`;
}
export function renderVisibilityPanel(settings) {
  const enabled=readVisibilityAutomation(settings.autoHideSummarizedFloors);
  return `<section class="sa-section sa-visibility-panel"><div class="sa-section-header"><span>楼层显示与隐藏</span><button class="sa-btn sa-btn-sm" id="sa-vis-refresh">刷新</button></div><div class="sa-section-body">
  <div class="sa-visibility-automation">
    <label class="sa-visibility-toggle" for="sa-vis-auto-hide"><span><strong>按总结自动隐藏</strong><small>本聊天 · <span data-visibility-mode>${enabled?'已开启':'已暂停'}</span></small></span><span class="sa-visibility-switch"><input type="checkbox" role="switch" id="sa-vis-auto-hide" aria-describedby="sa-visibility-policy" ${enabled?'checked':''}><span class="sa-visibility-track" aria-hidden="true"></span></span></label>
    <p id="sa-visibility-policy" class="sa-visibility-policy" data-visibility-policy role="status" aria-live="polite">${automationDescription(enabled,0)}</p>
  </div>
  <div id="sa-visibility-info">加载中…</div>
  <div class="sa-visibility-controls"><label>起始楼层<input class="sa-input" id="sa-vis-from" type="number" min="0" placeholder="0" value="0"></label><label>结束楼层<input class="sa-input" id="sa-vis-to" type="number" min="0" placeholder="楼层编号"></label><label>消息类型<select class="sa-select" id="sa-vis-role"><option value="all">全部类型</option><option value="user">用户输入</option><option value="assistant">AI 输出</option><option value="system">系统消息</option></select></label></div>
  <div class="sa-visibility-actions"><button class="sa-btn" id="sa-vis-hide-range">隐藏范围</button><button class="sa-btn" id="sa-vis-show-range">显示范围</button><button class="sa-btn" id="sa-vis-hide-summarized">隐藏已总结楼层</button></div>
  <div class="sa-btn-group"><button class="sa-btn" id="sa-vis-show-all">显示全部楼层</button></div>
  <p class="sa-hint">以上按钮立即操作当前楼层，并暂停本聊天的自动隐藏。重新开启开关，会清除本面板的手动选择并按总结恢复。</p>
</div></section>`;
}
