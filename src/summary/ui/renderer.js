import { errorCatched } from '../errorHandler.js';
import { escapeHtml, compressRanges } from '../utils.js';
import { getSettings } from '../storage.js';
import { getActiveWorldbookName, isChatWorldbookBound, getAllSummaryEntriesForDisplay, getLastSummarizedFloor } from '../worldbook.js';
import { getCoverage } from '../worldbook.js';
/**
 * ui/renderer.js
 * 状态信息与条目列表渲染
 * 依赖: utils.js, storage.js, worldbook.js, errorHandler.js
 */

const renderEntryList = (entries, selectionMode = false) => {
  if (!entries || entries.length === 0) {
    return '<div class="sa-empty">暂无总结条目</div>';
  }
  return entries
    .map(
      (e) => {
        const isMega = e.selectableReason === 'mega';
        const statusBadge = selectionMode
          ? (isMega ? '<span class="sa-entry-badge sa-entry-badge-mega" title="已被大总结包含">已大总结</span>' :
             (e.selectable ? '' : (e.disabled ? '<span class="sa-entry-badge sa-entry-badge-disabled" title="条目已禁用">已禁用</span>' : '')))
          : '';
        return `
    <div class="sa-entry-item ${e.selectable ? 'sa-entry-selectable' : ''} ${selectionMode && !e.selectable ? 'sa-entry-unavailable' : ''}" data-entry-name="${escapeHtml(e.name)}">
      ${e.selectable ? `<input type="checkbox" class="sa-entry-checkbox" data-entry-name="${escapeHtml(e.name)}">` : ''}
      <span class="sa-entry-name ${e.disabled ? 'sa-entry-disabled' : ''}" title="${escapeHtml(e.name)}">
        ${escapeHtml(e.name)}
      </span>
      ${statusBadge}
      ${e.invalid ? '<span class="sa-entry-badge">来源已变化，需重生成</span>' : ''}
      <div class="sa-entry-actions">
        <button class="sa-btn sa-btn-sm" data-action="view-edit" data-name="${escapeHtml(e.name)}">查看/编辑</button>
        <button class="sa-btn sa-btn-sm" data-action="regenerate" data-name="${escapeHtml(e.name)}">重新生成</button>
        <button class="sa-btn sa-btn-sm" data-action="${e.disabled ? 'enable-summary' : 'disable-summary'}" data-name="${escapeHtml(e.name)}">${e.disabled ? '启用' : '停用'}</button>
        <button class="sa-btn sa-btn-sm sa-btn-danger" data-action="delete" data-name="${escapeHtml(e.name)}">删除</button>
      </div>
    </div>
  `;
      }
    )
    .join('');
};

const renderMegaEntryList = (entries) => {
  if (!entries || entries.length === 0) {
    return '<div class="sa-empty">暂无大总结条目</div>';
  }
  return entries
    .map(
      (e) => `
    <div class="sa-entry-item sa-mega-entry-item">
      <span class="sa-entry-name ${e.disabled ? 'sa-entry-disabled' : ''}" title="${escapeHtml(e.name)}">
        🔷 ${escapeHtml(e.name)}
      </span>
      ${e.disabled ? '<span class="sa-entry-badge sa-entry-badge-disabled" title="条目已关闭">已关闭</span>' : ''}
      ${e.invalid ? '<span class="sa-entry-badge">来源已变化</span>' : ''}
      <div class="sa-entry-actions">
        <button class="sa-btn sa-btn-sm" data-action="view-edit-mega" data-name="${escapeHtml(e.name)}">查看/编辑</button>
        <button class="sa-btn sa-btn-sm" data-action="regenerate-mega" data-name="${escapeHtml(e.name)}">重新生成</button>
        ${e.disabled
          ? `<button class="sa-btn sa-btn-sm sa-btn-success" data-action="activate-mega" data-name="${escapeHtml(e.name)}">启用</button>`
          : `<button class="sa-btn sa-btn-sm sa-btn-warn" data-action="deactivate-mega" data-name="${escapeHtml(e.name)}">回档</button>`
        }
        <button class="sa-btn sa-btn-sm sa-btn-danger" data-action="delete-mega" data-name="${escapeHtml(e.name)}">删除</button>
      </div>
    </div>
  `
    )
    .join('');
};

const renderStatusInfo = errorCatched(async () => {
  const settings = getSettings();
  const lastId = getLastMessageId();
  const { floors } = await getCoverage();
  const entries = await getAllSummaryEntriesForDisplay();
  const all = lastId < 0 ? [] : getChatMessages(`0-${lastId}`, {role:'all',hide_state:'all',include_swipes:false});
  const unsummarized = all.filter(message=>!floors.has(message.message_id)).length;
  const triggerProgress =
    settings.triggerFloorCount > 0
      ? Math.min(100, Math.round((unsummarized / settings.triggerFloorCount) * 100))
      : 0;
  const hiddenMsgs =
    lastId >= 0
      ? getChatMessages(`0-${lastId}`, {
          role: 'all',
          hide_state: 'hidden',
          include_swipes: false,
        })
      : [];
  const hiddenIds = hiddenMsgs.map((m) => m.message_id).filter(Number.isFinite);
  const model =
    settings.apiMode === 'custom' && settings.customApiModel
      ? `(${escapeHtml(settings.customApiModel)})`
      : '';
  return `
    <div class="sa-metrics"><div class="sa-metric"><strong>${floors.size}</strong><span>已覆盖楼层</span></div><div class="sa-metric"><strong>${unsummarized}</strong><span>未总结消息</span></div><div class="sa-metric"><strong>${entries.length}</strong><span>普通总结记录</span></div></div>
    <details class="sa-disclosure" data-coverage-details><summary><span>查看覆盖范围与触发条件</span><span class="sa-disclosure-arrow" aria-hidden="true">⌄</span></summary>
    <div class="sa-status-grid">
      <span class="sa-status-label">总楼层数</span>
      <span class="sa-status-value">${all.length}（楼层编号从 0 开始）</span>
      <span class="sa-status-label">总结条目数</span>
      <span class="sa-status-value">${entries.length}</span>
      <span class="sa-status-label">有效覆盖楼层</span>
      <span class="sa-status-value">${escapeHtml(compressRanges([...floors].sort((a,b)=>a-b))) || '尚未总结'}</span>
      <span class="sa-status-label">未总结消息</span>
      <span class="sa-status-value">${unsummarized} 条</span>
      <span class="sa-status-label">触发进度</span>
      <span class="sa-status-value">
        ${unsummarized}/${settings.triggerFloorCount} (${triggerProgress}%)
        <div class="sa-progress-bar"><div class="sa-progress-fill" style="width:${triggerProgress}%"></div></div>
      </span>
      <span class="sa-status-label">API 模式</span>
      <span class="sa-status-value">${settings.apiMode === 'custom' ? '自定义API' : '酒馆主API'} ${model}</span>
      <span class="sa-status-label">绑定世界书</span>
      <span class="sa-status-value">${isChatWorldbookBound() ? `✅ ${escapeHtml(getActiveWorldbookName())}` : '❌ 未绑定'}</span>
      <span class="sa-status-label">当前隐藏楼层</span>
      <span class="sa-status-value" title="${hiddenIds.join(', ')}">${escapeHtml(compressRanges(hiddenIds)) || '无'}</span>
    </div>
    </details>
  `;
});

export { renderEntryList, renderMegaEntryList, renderStatusInfo };
