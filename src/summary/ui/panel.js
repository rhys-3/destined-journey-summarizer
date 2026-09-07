import { escapeHtml } from '../utils.js';
import { renderTagEditor } from './tagEditor.js';
import { getActiveWorldbookName, isChatWorldbookBound } from '../worldbook.js';
import { renderVisibilityPanel } from './visibilityView.js';
/**
 * ui/panel.js
 * 设置面板 UI、HTML 构建、事件绑定
 * 依赖: config.js, utils.js, storage.js, summary.js, worldbook.js,
 *       ui/styles.js, ui/renderer.js, errorHandler.js
 */



// ---- 辅助渲染函数 ----

export function editablePromptBlock(block) {
  if(block.content!==undefined)return {...block,type:'prompt'};
  const content=block.type==='builtin_group'?['world_before','persona','character','personality','scenario','world_after','examples'].map(name=>'{{summary.'+name+'}}').join('\n\n'):block.type==='old_summary'?'<prior_memory>\n{{summary.history}}\n</prior_memory>':(block.leadText??'')+'\n<'+(block.xmlTag||'source_material')+'>\n{{summary.material}}\n</'+(block.xmlTag||'source_material')+'>';
  return {...block,type:'prompt',role:block.role||'user',content};
}
const renderBlock = raw => {
  const block=editablePromptBlock(raw),id=escapeHtml(block.id);
  return '<div class="sa-block sa-prompt-entry '+(block.enabled?'':'sa-block-disabled')+'" data-block-id="'+id+'" data-block="'+escapeHtml(JSON.stringify(block))+'" draggable="true"><div class="sa-block-header"><span class="sa-block-drag" title="拖动排序；也可用 Alt 加方向键" role="button" tabindex="0" aria-label="拖动 '+escapeHtml(block.name)+'">⠿</span><button type="button" class="sa-block-name" data-block-edit="'+id+'">'+escapeHtml(block.name)+'</button><span class="sa-role-badge">'+escapeHtml(block.role||'system')+'</span><label class="sa-block-enable" title="启用 '+escapeHtml(block.name)+'"><input type="checkbox" role="switch" aria-label="启用 '+escapeHtml(block.name)+'" data-block-enable="'+id+'" '+(block.enabled?'checked':'')+'></label></div></div>';
};

const renderBlocks = (blocks, containerId = "sa-blocks-container") => {
  const resetAction =
    containerId === "sa-mega-blocks-container"
      ? "data-action-reset-mega-blocks"
      : "data-action-reset-blocks";
  const addAction =
    containerId === "sa-mega-blocks-container"
      ? "data-action-add-mega-block"
      : "data-action-add-block";
  return (
    blocks.map((b, i) => renderBlock(b, i, blocks.length)).join("") +
    `<div class="sa-add-block-row">
      <button class="sa-add-block-btn" ${addAction}>＋ 添加自定义提示词板块</button>
      <button class="sa-btn sa-btn-sm sa-btn-danger" ${resetAction}>重置提示词</button>
    </div>`
  );
};

// ---- 面板 HTML 构建 ----

const buildPanelHtml = (settings) => `
<div class="sa-panel">
  <div class="sa-workspace-heading"><div><h3>剧情档案</h3><p class="sa-hint">整理剧情、管理记忆与生成规则</p></div><label class="sa-enable"><input type="checkbox" id="sa-enabled" ${settings.enabled ? 'checked' : ''}>自动总结</label></div>
  <div class="sa-generation-actions"><button class="sa-btn sa-btn-primary" id="sa-start-summary">手动开始总结</button><button class="sa-btn" id="sa-start-custom-summary">指定楼层总结</button><span class="sa-hint">自动开关只控制后续自动任务。</span></div>
  <p class="sa-hint sa-binding-hint" data-binding-hint></p>
  <p id="sa-busy-reason" class="sa-task-reason" hidden></p>
  <div class="sa-tabs">
    <button class="sa-tab-item active" data-tab="status">记录与任务</button>
    <button class="sa-tab-item" data-tab="settings">生成设置</button>
    <button class="sa-tab-item" data-tab="prompts">提示词</button>
    <button class="sa-tab-item" data-tab="worldbook">世界书</button>
  </div>
  <div class="sa-body">
    <div class="sa-tab-pane active" data-pane="status">
      <div class="sa-task-widget" data-task-widget hidden></div>
      ${renderVisibilityPanel(settings)}
      <div class="sa-status-bar"><div id="sa-status-info" class="sa-status">加载中...</div></div>
      <div class="sa-section">
        <div class="sa-section-header">
          <span>普通总结</span>
          <button class="sa-btn sa-btn-sm sa-btn-primary" id="sa-start-mega-summary" style="margin-left:auto">开始大总结</button>
        </div>
        <div class="sa-section-body">
          <div id="sa-entry-list" class="sa-entry-list"><div class="sa-empty">加载中...</div></div>
        </div>
      </div>
      <div class="sa-section" style="margin-top:16px">
        <div class="sa-section-header"><span>大总结</span></div>
        <div class="sa-section-body">
          <div id="sa-mega-entry-list" class="sa-entry-list"><div class="sa-empty">加载中...</div></div>
        </div>
      </div>
    </div>
    <div class="sa-tab-pane" data-pane="settings">
      <div class="sa-settings-layout">
        <div class="sa-settings-nav">
          <button class="sa-settings-nav-item active" data-sub-nav="core">自动与批次</button>
          <button class="sa-settings-nav-item" data-sub-nav="api">连接与模型</button>
          <button class="sa-settings-nav-item" data-sub-nav="tags">读取正文</button>
        </div>
        <div class="sa-settings-content">
          <div class="sa-settings-pane active" data-sub-pane="core">
            <h4 class="sa-group-title">普通总结</h4>
            <label class="sa-field">批次方案（触发 / 保留）<select class="sa-select" id="sa-batch-preset"><option value="with-summary" ${settings.batchPreset==='with-summary'?'selected':''}>已开启摘要 · 推荐 50 / 10</option><option value="without-summary" ${settings.batchPreset==='without-summary'?'selected':''}>未开启摘要 · 推荐 20 / 5</option><option value="custom" ${settings.batchPreset==='custom'?'selected':''}>自定义</option></select></label>
            <p class="sa-hint">请按自己的摘要使用情况选择。这里不会读取或修改摘要开关；修改触发数或保留数会切换为自定义。</p>
            <div class="sa-row sa-row-pair">
              <div class="sa-pair-item"><span class="sa-label">触发楼层数</span><input class="sa-input" id="sa-trigger-count" type="number" min="1" max="999" value="${settings.triggerFloorCount}"></div>
              <div class="sa-pair-item"><span class="sa-label">保留楼层数</span><input class="sa-input" id="sa-keep-count" type="number" min="1" max="999" value="${settings.keepFloorCount}"></div>
            </div>
            <div class="sa-row sa-row-pair"><div class="sa-pair-item"><span class="sa-label">每批最多楼层</span><input class="sa-input" id="sa-batch-count" type="number" min="1" max="999" value="${settings.batchFloorCount}"></div></div>
            <p class="sa-hint">每批上限用来控制单次请求的材料量，避免一次发送过多 Tokens。达到触发数后，会完成本轮可总结范围。</p>
            <div class="sa-row"><label class="sa-enable"><input type="checkbox" id="sa-parallel-batches" ${settings.parallelBatches?'checked':''}>并发生成批次</label><label class="sa-concurrency-field">并发数<input class="sa-input" id="sa-batch-concurrency" type="number" min="1" max="8" value="${settings.batchConcurrency}" ${settings.parallelBatches?'':'disabled'}></label></div>
            <p class="sa-batch-explanation" data-batch-explanation role="status"></p>
            <p class="sa-hint" data-batch-history-hint ${settings.parallelBatches?'':'hidden'}>同一组并发批次使用生成前已有的总结，不包含彼此刚生成的结果。需要逐批参考前一批结果时，请关闭并发。</p>
            <h4 class="sa-group-title">大总结</h4>
            <label class="sa-enable"><input type="checkbox" id="sa-auto-mega" ${settings.autoMegaSummary?'checked':''}>自动合并连续普通总结</label>
            <div class="sa-row sa-row-pair"><div class="sa-pair-item"><span class="sa-label">普通总结累计（条）</span><input class="sa-input" id="sa-mega-trigger" type="number" min="3" max="999" value="${settings.megaTriggerCount}"></div><div class="sa-pair-item"><span class="sa-label">合并最早连续（条）</span><input class="sa-input" id="sa-mega-batch" type="number" min="2" max="998" value="${settings.megaBatchCount}"></div></div>
            <p class="sa-hint">两项均可修改。默认累计 15 条时合并最早 10 条，保留最近 5 条普通总结。</p>
            <h4 class="sa-group-title">记忆与保存</h4>
            <div class="sa-checkbox-grid">
              <label><input type="checkbox" id="sa-include-old-summary" ${settings.includeOldSummary ? "checked" : ""}> 发送已有总结</label>
              <input type="checkbox" id="sa-auto-confirm" hidden ${settings.autoTriggerConfirm ? "checked" : ""}>
            </div>
            <h4 class="sa-group-title">材料前缀</h4>
            <div class="sa-row" style="margin-top:12px"><span class="sa-label">用户前缀</span><input class="sa-input" id="sa-user-prefix" type="text" placeholder="{{user}}" value="${escapeHtml(settings.userPrefix || "{{user}}")}"></div>
            <div class="sa-row"><span class="sa-label">AI前缀</span><input class="sa-input" id="sa-assistant-prefix" type="text" placeholder="AI" value="${escapeHtml(settings.assistantPrefix ?? 'AI')}"></div>
            <div class="sa-hint">前缀用于标注发给总结模型的楼层材料。用户默认 {{user}}，AI 默认 AI；可按自定义总结预设修改，支持 {{user}}、{{char}} 名称宏。</div>
          </div>
          <div class="sa-settings-pane" data-sub-pane="api">
            <div class="sa-row"><span class="sa-label">API 模式</span>
              <div class="sa-radio-group">
                <label><input type="radio" name="sa-api-mode" value="tavern" ${settings.apiMode === "tavern" ? "checked" : ""}> 酒馆主API</label>
                <label><input type="radio" name="sa-api-mode" value="custom" ${settings.apiMode === "custom" ? "checked" : ""}> 自定义API</label>
              </div>
            </div>
            <div id="sa-custom-api-fields" style="${settings.apiMode === "custom" ? "" : "display:none"}">
              <div class="sa-row"><span class="sa-label">API 地址</span><input class="sa-input" id="sa-api-url" type="text" placeholder="https://api.example.com/v1" value="${escapeHtml(settings.customApiUrl)}"></div>
              <div class="sa-row"><span class="sa-label">API 密钥</span><input class="sa-input" id="sa-api-key" type="password" placeholder="sk-..." value="${escapeHtml(settings.customApiKey)}"></div>
              <div class="sa-row"><span class="sa-label">模型</span><select class="sa-select" id="sa-api-model" style="flex:1">${settings.customApiModel ? `<option value="${escapeHtml(settings.customApiModel)}" selected>${escapeHtml(settings.customApiModel)}</option>` : '<option value="">请先获取模型列表</option>'}</select><button class="sa-btn sa-btn-sm" id="sa-fetch-models">获取列表</button></div>
              <div class="sa-row"><span class="sa-label">手动填写模型</span><input class="sa-input" id="sa-api-model-manual" value="${escapeHtml(settings.customApiModel)}" placeholder="模型名称"></div>
            </div>
            <div class="sa-hint">跟随当前连接，或为总结单独指定数值。两种连接模式均有效，修改将在下次任务生效。</div>
            <div class="sa-row sa-row-pair" style="margin-top:12px">
              <div class="sa-pair-item"><span class="sa-label">温度</span><select class="sa-select" id="sa-temperature-mode"><option value="follow" ${settings.temperature==='same_as_preset'?'selected':''}>跟随连接</option><option value="override" ${settings.temperature!=='same_as_preset'?'selected':''}>指定数值</option></select><input class="sa-input" id="sa-temperature" type="number" min="0" step="0.1" aria-label="总结温度" value="${settings.temperature==='same_as_preset'?1:settings.temperature}" ${settings.temperature==='same_as_preset'?'disabled':''}></div>
              <div class="sa-pair-item"><span class="sa-label">最大 Tokens</span><select class="sa-select" id="sa-max-tokens-mode"><option value="follow" ${settings.maxTokens==='same_as_preset'?'selected':''}>跟随连接</option><option value="override" ${settings.maxTokens!=='same_as_preset'?'selected':''}>指定数值</option></select><input class="sa-input" id="sa-max-tokens" type="number" min="1" aria-label="总结最大 Tokens" value="${settings.maxTokens==='same_as_preset'?32000:settings.maxTokens}" ${settings.maxTokens==='same_as_preset'?'disabled':''}></div>
            </div>
          </div>
           <div class="sa-settings-pane" data-sub-pane="tags">
            ${renderTagEditor('includeTags','提取标签',settings.includeTags)}
            <div class="sa-hint">AI 回复只读取这些标签内的正文；用户输入保留全文。未添加任何标签时读取完整 AI 回复。</div>
            ${renderTagEditor('excludeTags','排除标签',settings.excludeTags)}
            <div class="sa-hint">从已经提取的 AI 正文中移除这些标签及其内容，默认留空。</div>
            <div class="sa-row" style="margin-top:12px">
              <label><input type="checkbox" id="sa-exclude-html-comments" ${settings.excludeHtmlComments !== false ? "checked" : ""}> 隐藏HTML注释 (&lt;!-- ... --&gt;)</label>
            </div>
            <div class="sa-hint">隐藏消息中被 &lt;!-- 和 --&gt; 包裹的内容。</div>
          </div>
        </div>
      </div>
    </div>
    <div class="sa-tab-pane" data-pane="worldbook">
      <section class="sa-section"><div class="sa-section-header">本聊天的总结世界书</div><div class="sa-section-body">
        <div class="sa-bound-book" id="sa-wb-bind-status">${isChatWorldbookBound() ? `已绑定：${escapeHtml(getActiveWorldbookName())}` : '尚未绑定'}</div>
        <p class="sa-hint">首次总结时，如未绑定世界书，会自动创建并绑定本聊天的独立总结书。也可手动选择酒馆已有的世界书；主动解绑后会暂停自动建书。</p>
        <div class="sa-btn-group"><button class="sa-btn" id="sa-view-worldbook">查看记忆</button><button class="sa-btn" id="sa-unbind-worldbook">解绑</button><button class="sa-btn sa-btn-danger" id="sa-delete-worldbook">删除总结书</button></div>
      </div></section>
      <section class="sa-section"><div class="sa-section-header">选择绑定其他世界书</div><div class="sa-section-body">
        <label class="sa-field">酒馆全部世界书<select class="sa-select" id="sa-wb-select"><option value="">加载中…</option></select></label>
        <button class="sa-btn sa-btn-sm" id="sa-refresh-worldbooks">刷新列表</button>
        <label class="sa-field">或新建世界书<input class="sa-input" id="sa-new-wb-name" type="text" placeholder="输入新名称；不选已有书且留空则自动命名"></label>
        <div class="sa-btn-group"><button class="sa-btn sa-btn-primary" id="sa-bind-worldbook">绑定世界书</button><button class="sa-btn" id="sa-switch-worldbook">迁移</button></div>
        <p class="sa-hint">“绑定”更换后续保存位置；“迁移”同时搬移当前总结记录。已有书的其他条目会保留。</p>
      </div></section>
    </div>
    <div class="sa-tab-pane" data-pane="prompts">
      <p class="sa-next-task-note">提示词及连接修改在下次任务生效。只保存 &lt;summary_result&gt; 内的最终正文。</p>
      <nav class="sa-prompt-nav" aria-label="提示词分类"><button class="active" data-prompt-page="normal">普通总结</button><button data-prompt-page="mega">大总结</button></nav>
      <div class="sa-prompt-page active" data-prompt-pane="normal">
        <div class="sa-prompt-toolbar"><span class="sa-hint">按顺序发送；点击条目编辑正文与角色。</span><button class="sa-btn" data-prompt-preview="normal">查看实际请求</button></div>
        <div class="sa-section-header"><span>普通总结提示词</span></div>
        <div class="sa-section-body">
            <div id="sa-blocks-container" class="sa-blocks-container">${renderBlocks(settings.promptBlocks || [], "sa-blocks-container")}</div>
        </div>
      </div>
      <div class="sa-prompt-page" data-prompt-pane="mega">
        <div class="sa-prompt-toolbar"><span class="sa-hint">整合连续普通总结；可单独编辑与排序。</span><button class="sa-btn" data-prompt-preview="mega">查看实际请求</button></div>
        <div class="sa-section-header"><span>大总结提示词</span></div>
        <div class="sa-section-body">
            <div id="sa-mega-blocks-container" class="sa-blocks-container">${renderBlocks(settings.megaPromptBlocks || [], "sa-mega-blocks-container")}</div>
        </div>
      </div>
      <div class="sa-prompt-library"><span class="sa-hint">右侧开关，拖动排序，点击条目弹窗编辑。</span><div class="sa-btn-group"><button class="sa-btn" data-edit-macros>自定义变量</button><button class="sa-btn" data-prompts-export>导出提示词</button><button class="sa-btn" data-prompts-import>导入提示词</button><input type="file" accept=".json,application/json" data-prompts-file hidden></div></div>
    </div>
  </div>
  <div class="sa-footer">
    <div class="sa-footer-left"><button class="sa-btn sa-btn-danger" id="sa-reset">重置总结参数</button></div>
    <span class="sa-hint">修改自动保存，结果显示在助手左下角。</span>
  </div>
</div>
`;

export { renderBlock, renderBlocks, buildPanelHtml };
