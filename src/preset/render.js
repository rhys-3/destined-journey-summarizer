import * as summary from '../summary/service.js';

// Dependencies use live accessors so asynchronous operations share the current state.
export function createRender(ctx) {
  function renderFeatherIcon() {
    return '<svg class="feather-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path class="feather-vane" d="M27 4C19 2.5 9 7 7.5 15.5c-.5 3 .3 5.5 2.5 6.5 3.6 1.5 7.5-1.6 10.5-5.5C24 12 26 7.5 27 4Z"/><path d="M4 28C9 22 15 15.5 23 8M10 21l5 .5M14 17l5 .2M18 12.5l-.5-4M13.5 17.5l-.7-5"/></svg>';
  }

  function syncOrbVisibility() {
    if (!ctx.app) return;
    const existing = ctx.app.querySelector('.orb');
    if (ctx.state.config.entry_points.floating_orb !== true) {
      existing?.remove();
      return;
    }
    if (existing) return;
    const ui = ctx.loadUiState();
    ctx.app.insertAdjacentHTML('afterbegin', `
      <button class="orb" type="button" aria-label="打开${ctx.BUTTON_NAME}" title="${ctx.BUTTON_NAME}"
        style="${ui.orb ? `left:${ui.orb.x}px;top:${ui.orb.y}px;right:auto;bottom:auto;` : ''}">
        ${renderFeatherIcon()}
      </button>
    `);
    ctx.clampOrbToViewport();
  }

  function render() {
    if (ctx.destroyed || !ctx.app) return;
    if (!ctx.app.querySelector('.panel-slot')) ctx.app.innerHTML = '<div class="panel-slot"></div>';
    ctx.applyTheme();
    syncOrbVisibility();
    const slot = ctx.app.querySelector('.panel-slot');
    if (!ctx.state.open) {
      summary.detach();
      slot.replaceChildren();
      return;
    }
    if (!slot.querySelector('.panel')) { slot.innerHTML = renderPanel(); if(ctx.state.activeTab === 'summary') summary.mount(slot.querySelector('.summary-slot')); }
    else renderActiveContent(true);
    ctx.applyPanelGeometry();
    renderStyleEditorLayer();
    renderStatus();
  }

  function renderActiveContent(preserveScroll = false) {
    ctx.cancelPromptSort();
    if (!ctx.state.open || !ctx.shadow) return;
    const content = ctx.shadow.querySelector('.content');
    if (!content) return;
    if (!['advanced','configurations','settings','summary'].includes(ctx.state.activeTab) && !ctx.authorLayout().pages.some(p=>p.id===ctx.state.activeTab&&!p.hidden)) ctx.state.activeTab='daily';
    const nav = ctx.shadow.querySelector('.tabs');
    if (nav) nav.innerHTML = ctx.renderPlacementNavigation();
    for (const item of content.querySelectorAll('[data-disclosure]')) {
      if (item.open) ctx.state.disclosures.add(item.dataset.disclosure);
      else ctx.state.disclosures.delete(item.dataset.disclosure);
    }
    const scrollTop = preserveScroll ? content.scrollTop : 0;
    const active = ctx.shadow.activeElement;
    const focusKey = active && content.contains(active)
      ? ['action', 'field', 'key', 'id', 'model'].map(key => [key, active.dataset?.[key]]).filter(([, value]) => value)
      : [];
    const invalidDraft = active?.dataset?.action === 'field-number' && !/^-?\d+$/u.test(active.value.trim()) ? active.value : null;
    const selectionStart = typeof active?.selectionStart === 'number' ? active.selectionStart : null;
    const selectionEnd = typeof active?.selectionEnd === 'number' ? active.selectionEnd : null;
    content.className = `content content-${ctx.state.activeTab}`;
    if (ctx.state.activeTab === 'summary' && content.querySelector('.summary-slot')) { summary.refresh(); return; }
    summary.detach();
    content.innerHTML = ctx.state.preset ? renderActiveTab() : '<div class="empty">无法读取当前预设。</div>';
    if (ctx.state.activeTab === 'summary') summary.mount(content.querySelector('.summary-slot'));
    restoreContentScroll(content, scrollTop);
    for (const button of ctx.shadow.querySelectorAll('[data-action="tab"]')) {
      button.classList.toggle('active', button.dataset.tab === ctx.state.activeTab);
      if (button.closest('.tabs')) button.setAttribute('aria-current', button.dataset.tab === ctx.state.activeTab ? 'page' : 'false');
    }
    if (focusKey.length > 0) {
      const replacement = [...content.querySelectorAll('[data-action]')].find(element =>
        focusKey.every(([key, value]) => element.dataset?.[key] === value),
      );
      if (replacement) {
        if (invalidDraft !== null) {
          replacement.value = invalidDraft;
          const error = replacement.closest('.numeric-card')?.querySelector('.field-error');
          if (error) error.textContent = invalidDraft ? '请输入有效整数。' : '自定义数值不能为空。';
        }
        replacement.focus({ preventScroll: true });
        if (selectionStart !== null && typeof replacement.setSelectionRange === 'function') {
          replacement.setSelectionRange(selectionStart, selectionEnd);
        }
      }
    }
    renderStyleEditorLayer();
    ctx.updateWorkspaceUi();
  }

  function restoreContentScroll(content, requestedScrollTop) {
    const clamp = () => {
      if (!content.isConnected) return;
      const maxScrollTop = Math.max(0, content.scrollHeight - content.clientHeight);
      content.scrollTop = Math.min(Math.max(0, requestedScrollTop), maxScrollTop);
    };
    clamp();
    window.parent.requestAnimationFrame(() => {
      clamp();
      window.parent.requestAnimationFrame(clamp);
    });
  }

  function renderStyleEditorLayer() {
    const slot = ctx.shadow?.querySelector('.editor-layer-slot');
    if (!slot) return;
    const active = ctx.shadow.activeElement;
    const action = slot.contains(active) ? active?.dataset?.action : null;
    const selection = action && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
    ctx.syncPromptEditor();
    const field = active?.dataset?.field;
    const bodyScroll = slot.querySelector('.prompt-editor-body')?.scrollTop ?? 0;
    const textScroll = slot.querySelector('textarea')?.scrollTop ?? 0;
    slot.innerHTML = ctx.state.promptEditor ? ctx.renderPromptEditor() : renderStyleEditor();
    const modal = slot.querySelector('[role="dialog"]');
    ctx.shadow.querySelector('.panel-layout')?.toggleAttribute('inert', !!modal);
    ctx.shadow.querySelector('.panel-head')?.toggleAttribute('inert', !!modal);
    if (slot.querySelector('.prompt-editor-body')) slot.querySelector('.prompt-editor-body').scrollTop = bodyScroll;
    if (slot.querySelector('textarea')) slot.querySelector('textarea').scrollTop = textScroll;
    if (action) {
      const input = [...slot.querySelectorAll('[data-action]')].find(item => item.dataset.action === action && (!field || item.dataset.field === field));
      input?.focus({ preventScroll: true });
      if (selection && input?.setSelectionRange && !['number','checkbox'].includes(input.type)) input.setSelectionRange(...selection);
    }
  }

  function renderStatus() {
    ctx.updateWorkspaceUi();
    const status = ctx.shadow?.querySelector('.status');
    if (!status) return;
    for (const button of ctx.shadow.querySelectorAll('button[aria-pressed]')) button.setAttribute('aria-pressed', String(button.classList.contains('selected')));
    for (const toggle of ctx.shadow.querySelectorAll('.switch input')) toggle.parentElement.title = toggle.checked ? '关闭' : '开启';
    const summaryFeedback = ctx.state.activeTab === 'summary' ? ctx.state.summaryFeedback : null;
    const kind = summaryFeedback ? (summaryFeedback.kind === 'error' ? 'error' : summaryFeedback.kind === 'success' ? 'saved' : 'idle') : ctx.state.saveState;
    const message = summaryFeedback?.message ?? ctx.state.saveMessage;
    status.className = `status status-${kind}`;
    const undo = ctx.state.reorderUndo;
    const canUndo = ctx.state.editorUnlocked && undo && undo.presetName === getLoadedPresetName() && JSON.stringify(undo.order) === JSON.stringify(ctx.state.preset?.prompts?.map(p => p.id));
    status.innerHTML = `<span class="status-dot"></span><span>${ctx.escapeHtml(message)}</span>${canUndo ? `<button type="button" class="text-button sort-undo-button" data-action="sort-undo" ${ctx.state.reorderSaving ? 'disabled' : ''}>撤销排序</button>` : ''}`;
  }

  function renderPanel() {
    return `
      <section class="panel" data-tt-mobile-surface="free-window" role="dialog" aria-modal="false" aria-labelledby="destined-title">
        <header class="panel-head" data-panel-drag-handle title="拖动窗口">
          <div><span class="eyebrow">DESTINED DUSK PRIME</span><h2 id="destined-title">${renderFeatherIcon()}命定·黄昏 Prime <span>预设助手</span></h2><p>按你的习惯，调整叙事与表达。</p></div>
          <div class="head-actions"><label class="edit-mode-switch"><input type="checkbox" data-action="edit-mode" aria-label="编辑模式" ${ctx.state.editorUnlocked?'checked':''} ${ctx.state.reorderSaving||ctx.state.promptEditor?.saving?'disabled':''}><span>编辑模式</span></label><button type="button" class="secondary-button" data-action="tab" data-tab="advanced">预设条目</button><button class="icon-button" type="button" data-action="close" aria-label="关闭设置">×</button></div>
        </header>
        <div class="configuration-shortcut">${ctx.renderConfigurationShortcut()}</div>
        <div class="panel-layout">
          <nav class="tabs" aria-label="设置页面">${ctx.renderPlacementNavigation()}</nav>
          <main class="content content-${ctx.state.activeTab}" tabindex="-1">${ctx.state.preset ? renderActiveTab() : '<div class="empty">无法读取当前预设，请确认已加载命定预设后重新打开。</div>'}</main>
        </div>
        <footer class="status status-${ctx.state.saveState}" role="status" aria-live="polite"><span class="status-dot"></span><span>${ctx.escapeHtml(ctx.state.saveMessage)}</span></footer>
        <span class="sr-only theme-feedback" role="status" aria-live="polite"></span><div class="editor-layer-slot">${renderStyleEditor()}</div><div class="panel-resize-handle" data-panel-resize-handle aria-hidden="true"></div>
      </section>`;
  }

  function renderFold(id, title, description, content) {
    return `<details class="settings-fold" data-disclosure="${id}" ${ctx.state.disclosures.has(id) ? 'open' : ''}><summary><span><strong>${ctx.escapeHtml(title)}</strong><small>${ctx.escapeHtml(description)}</small></span><span class="fold-chevron" aria-hidden="true">⌄</span></summary><div class="fold-body">${content}</div></details>`;
  }

  function renderActiveTab() {
    if (ctx.state.activeTab === 'summary') return '<div class="summary-slot"></div>';
    if (ctx.state.activeTab === 'settings') return renderSettingsTab();
    if (ctx.state.activeTab === 'configurations') return ctx.renderConfigurationsTab();
    if (ctx.state.activeTab === 'advanced') return renderAdvancedTab();
    return ctx.renderPlacementPage(ctx.state.activeTab);
  }

  function renderSectionHeader(title, description) {
    return `<div class="section-head"><div><h3>${ctx.escapeHtml(title)}</h3><p>${ctx.escapeHtml(description)}</p></div></div>`;
  }

  function renderSettingsTab() {
    const entryBlock = ctx.authorLayout().blocks.find(block => block.id === 'entry-points');
    return renderSectionHeader('设置', '调整界面外观与打开方式。')
      + '<article class="card appearance-card"><div class="card-title"><div><h4>界面外观</h4><p>主题与透明度仅保存在当前浏览器。</p></div></div>' + ctx.renderThemeControl() + '<p class="appearance-note">透明度越低，背景越实；0% 为完全不透明。</p></article>'
      + (entryBlock ? ctx.renderPlacementBlock(entryBlock) : renderEntryPointSettings());
  }

  function renderModelTab() {
    const current = ctx.detectModelAdapter();
    const tail = ctx.getGeminiTail();
    const link = ctx.state.config.connection_link;
    return `
      ${current ? '' : '<div class="warning">当前模型条目存在零选、多选或交叉启用。选择一个适配即可修复。</div>'}
      <div class="model-grid">
        ${Object.keys(ctx.MODEL_ADAPTERS).map(name => `
          <button type="button" class="model-card ${current === name ? 'selected' : ''}" data-action="model" data-model="${name}" aria-pressed="${current === name}" ${disabledAttribute()}>
            <span class="model-rune">${name === 'Gemini' ? '✦' : name === 'Claude' ? '◇' : '◆'}</span>
            <strong>${ctx.escapeHtml(ctx.MODEL_ADAPTERS[name].label)}</strong><small>${current === name ? '当前适配' : '点击切换'}</small>
          </button>
        `).join('')}
      </div>
      <article class="card">
        <div class="card-title"><div><h4>Gemini 尾部模式</h4><p>仅在 Gemini 适配时生效。</p></div></div>
        <div class="segmented">
          ${choiceButton('gemini-tail', 'prefill', '预填充', tail === 'prefill', current !== 'Gemini')}
          ${choiceButton('gemini-tail', 'no-prefill', '非预填充', tail === 'no-prefill', current !== 'Gemini')}
        </div>
      </article>
      <article class="card connection-card">
        <div class="card-title">
          <div><h4>切换模型时，一起切换连接</h4><p>为各模型绑定酒馆连接配置；关闭后只切换预设适配。</p></div>
          ${toggleHtml('connection-link', link.enabled, !link.enabled && ctx.state.profiles.length === 0)}
        </div>
        ${ctx.state.profiles.length === 0 ? `<div class="subtle">${ctx.state.profileLoading ? '正在读取连接配置…' : '未发现 Connection Profile；请先在 SillyTavern 中创建。'}</div>` : `
          <div class="profile-grid">
            ${Object.keys(ctx.MODEL_ADAPTERS).map(name => renderProfileSelect(name)).join('')}
          </div>
        `}
        <button type="button" class="text-button" data-action="refresh-profiles">刷新连接配置</button>
      </article>
      ${ctx.state.config.configuration_error ? '<div class="warning">' + ctx.escapeHtml(ctx.state.config.configuration_error) + '</div>' : ctx.renderCustomModelControls()}
    `;
  }

  function renderProfileSelect(adapterName) {
    const binding = ctx.state.config.connection_link.bindings[adapterName];
    const selected = ctx.resolveBoundProfile(binding);
    return `
      <label class="field-label"><span>${ctx.escapeHtml(ctx.MODEL_ADAPTERS[adapterName]?.label ?? adapterName)}</span>
        <select data-action="profile-binding" data-model="${adapterName}" ${disabledAttribute()}>
          <option value="">不绑定</option>
          ${ctx.state.profiles.map(profile => `<option value="${ctx.escapeHtml(ctx.profileKey(profile))}" ${selected && ctx.profileKey(selected) === ctx.profileKey(profile) ? 'selected' : ''}>${ctx.escapeHtml(profile.name)}${profile.model ? ` · ${ctx.escapeHtml(profile.model)}` : ''}</option>`).join('')}
        </select>
      </label>
    `;
  }

  function renderNumericControl(key) {
    const definition = ctx.FIELD_DEFINITIONS[key];
    const current = ctx.readNumericField(key);
    const mode = current.ok ? ctx.getNumericMode(key, current.value) : 'custom';
    return `
      <article class="card numeric-card">
        <div class="card-title"><div><h4>${ctx.escapeHtml(definition.label)}</h4><p>${ctx.escapeHtml(({ hanzi: '每次回复的正文篇幅要求', dialogueRatio: '对白在正文中的占比', dialogueRounds: '角色之间至少来回几轮对白', combatRounds: '每次回复推进几回合战斗' })[key])}</p></div>${['hanzi', 'dialogueRatio'].includes(key) && ctx.getPrompt(ctx.state.preset, definition.promptId) ? toggleHtml(`prompt:${definition.promptId}`, ctx.getPrompt(ctx.state.preset, definition.promptId).enabled) : ''}</div>
        <div class="chips">
          ${definition.presets.map(value => `<button type="button" data-action="field-preset" data-field="${key}" data-value="${value}" class="${current.ok && mode === 'preset' && current.value === String(value) ? 'selected' : ''}" ${current.ok ? disabledAttribute() : 'disabled'}>${value}${key === 'dialogueRatio' ? '%' : ''}</button>`).join('')}
          <button type="button" data-action="field-custom" data-field="${key}" class="${mode === 'custom' ? 'selected' : ''}" ${current.ok ? disabledAttribute() : 'disabled'}>自定义</button>
        </div>
        <label class="number-input"><span>自定义</span><input type="text" inputmode="numeric" data-action="field-number" data-field="${key}" value="${current.ok ? ctx.escapeHtml(current.value) : ''}" ${current.ok ? disabledAttribute() : 'disabled'}></label>
        <div class="field-error" data-field-error="${key}">${current.ok ? '' : '受管字段缺失或格式异常，已停止写入。'}</div>
      </article>
    `;
  }

  function renderLanguageControl(key) {
    const definition = ctx.LANGUAGE_DEFINITIONS[key];
    const current = ctx.readLanguageField(key);
    const preset = ctx.LANGUAGE_PRESETS.find(([value]) => value === current.value);
    return `
      <article class="card language-card">
        <div class="card-title"><div><h4>${ctx.escapeHtml(definition.label)}</h4><p>${ctx.escapeHtml(definition.description)}</p></div></div>
        <div class="chips">
          ${ctx.LANGUAGE_PRESETS.map(([value, label]) => `<button type="button" data-action="language-preset" data-language="${key}" data-value="${ctx.escapeHtml(value)}" class="${current.ok && preset?.[0] === value ? 'selected' : ''}" ${current.ok ? disabledAttribute() : 'disabled'}>${ctx.escapeHtml(label)}</button>`).join('')}
          <button type="button" data-action="language-custom" data-language="${key}" class="${current.ok && !preset ? 'selected' : ''}" ${current.ok ? disabledAttribute() : 'disabled'}>自定义</button>
        </div>
        <label class="language-input"><span>自定义</span><input type="text" data-action="language-input" data-language="${key}" value="${current.ok ? ctx.escapeHtml(current.value) : ''}" maxlength="80" placeholder="例如：Deutsch" ${current.ok ? disabledAttribute() : 'disabled'}></label>
        <div class="field-error" data-language-error="${key}">${current.ok ? '' : `${ctx.escapeHtml(definition.label)}短宏缺失或格式异常。`}</div>
      </article>
    `;
  }

  function renderStyleEditor() {
    const editor = ctx.state.styleEditor;
    if (!editor) return '';
    const definition = ctx.USER_CREATABLE_GROUPS[editor.groupId];
    if (!definition) return '';
    return `
      <div class="editor-layer" data-action="close-style-editor">
        <article class="card style-editor" role="dialog" aria-modal="true" aria-labelledby="style-editor-title">
          <div class="card-title"><div><h4 id="style-editor-title">${editor.id ? `编辑自定义${definition.label}` : `新增自定义${definition.label}`}</h4><p>预设设置会自动用 &lt;${definition.tag}&gt; 包裹正文。</p></div><button type="button" class="icon-button compact-close" data-action="cancel-style" aria-label="关闭编辑器">×</button></div>
          <label class="field-label"><span>${definition.label}名称</span><input type="text" data-action="style-title" value="${ctx.escapeHtml(editor.title)}" placeholder="${editor.groupId === 'base-tone' ? '例如：克制冷峻' : '例如：冷峻冒险史诗'}" ${disabledAttribute()}></label>
          <label class="field-label"><span>提示词正文</span><textarea data-action="style-content" rows="9" placeholder="输入这套${definition.label}需要模型遵循的规则……" ${disabledAttribute()}>${ctx.escapeHtml(editor.content)}</textarea></label>
          <div class="editor-actions">
            <button type="button" class="primary-button" data-action="save-style" ${disabledAttribute()}>保存${definition.label}</button>
            <button type="button" class="secondary-button" data-action="cancel-style">取消</button>
          </div>
        </article>
      </div>
    `;
  }

  function renderEntryPointSettings() {
    const points = ctx.sanitizeEntryPoints(ctx.state.config.entry_points);
    const items = [
      ['floating_orb', '悬浮球', '显示可自由拖动的羽毛悬浮球'],
      ['input_button', '输入框上方按钮', `显示“${ctx.BUTTON_NAME}”按钮`],
      ['wand_menu', '魔术棒菜单', '在酒馆魔术棒扩展菜单中显示入口'],
    ];
    return `
      <article class="card entry-point-card">
        <div class="card-title"><div><h4>设置界面入口</h4><p>三个入口可以同时开启；为避免无法再次打开设置，至少保留一个。</p></div></div>
        <div class="toggle-grid">
          ${items.map(([key, label, description]) => `
            <article class="mini-card">
              <div><strong>${ctx.escapeHtml(label)}</strong><small>${ctx.escapeHtml(description)}</small></div>
              ${toggleHtml(`entry:${key}`, points[key])}
            </article>
          `).join('')}
        </div>
      </article>
    `;
  }

  function renderAdvancedTab() {
    const query = ctx.state.search.trim().toLocaleLowerCase('zh-CN');
    const sortable = ctx.canSortPrompts();
    const used = (ctx.state.preset.prompts ?? []).map((prompt, nativeIndex) => ({ prompt, nativeIndex }));
    const unused = (ctx.state.preset.prompts_unused ?? []).map(prompt => ({ prompt, nativeIndex: -1 }));
    const source = ctx.state.entryFilter === 'unused' ? unused : used;
    const prompts = source.filter(({ prompt }) => !['enabled','disabled'].includes(ctx.state.entryFilter) || !!prompt.enabled === (ctx.state.entryFilter === 'enabled'))
      .filter(({ prompt }) => !query || `${prompt.name} ${prompt.id} ${prompt.content ?? ''}`.toLocaleLowerCase('zh-CN').includes(query));
    return `${renderSectionHeader('预设条目', `按酒馆发送列表排列 · ${used.length} 项，未加入 ${unused.length} 项`)}

      <div class="entry-filters segmented wrap">${[['all','发送列表'],['enabled','已启用'],['disabled','已关闭'],['unused','未加入']].map(([value,label])=>choiceButton('entry-filter',value,label,ctx.state.entryFilter===value)).join('')}${ctx.state.editorUnlocked?'<button type="button" data-action="prompt-new">＋ 新建条目</button>':''}</div>
      <label class="search"><span aria-hidden="true">⌕</span><input aria-label="搜索预设条目" type="search" data-action="search" value="${ctx.escapeHtml(ctx.state.search)}" placeholder="搜索名称或完整正文"></label>
      <div class="sort-help"><span>${ctx.state.reorderSaving ? '正在同步顺序…' : !ctx.state.editorUnlocked ? '顶部开启编辑模式后可修改条目。' : sortable ? '拖动左侧手柄排序；手机按住手柄再移动，文字区域可正常滑动。' : '排序需显示完整发送列表，避免遗漏隐藏条目。'}</span>${ctx.state.editorUnlocked && !sortable && !ctx.state.reorderSaving ? '<button type="button" class="text-button" data-action="sort-show-all">显示完整列表</button>' : ''}</div><div class="sort-live sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
      <div class="advanced-list">${prompts.map(({prompt,nativeIndex})=>`<article class="advanced-item prompt-sort-row" data-sort-id="${ctx.escapeHtml(prompt.id)}">${ctx.state.editorUnlocked && nativeIndex >= 0 ? `<button type="button" class="sort-handle" data-action="sort-grip" data-id="${ctx.escapeHtml(prompt.id)}" aria-label="拖动排序：${ctx.escapeHtml(prompt.name)}" title="拖动排序；键盘可用 Alt + ↑ / ↓" ${sortable?'':'disabled'}><span aria-hidden="true">⠿</span></button>` : ''}<button type="button" class="prompt-row" data-action="prompt-open" data-id="${ctx.escapeHtml(prompt.id)}"><span class="prompt-index">${nativeIndex<0?'—':String(nativeIndex+1).padStart(2,'0')}</span><span class="entry-state ${nativeIndex>=0&&prompt.enabled?'on':'off'}"></span><span class="entry-title"><strong>${ctx.escapeHtml(prompt.name)}</strong><small>${nativeIndex<0?'未加入':prompt.enabled?'已启用':'已关闭'} · ${ctx.escapeHtml(prompt.role??'system')}${prompt.position?.type==='in_chat'?` · 深度 ${ctx.escapeHtml(prompt.position.depth)}`:''}</small></span>${ctx.PROTECTED_IDS.has(prompt.id)?'<span class="badge">必需</span>':''}<span class="row-arrow" aria-hidden="true">↗</span></button></article>`).join('')||'<div class="empty">没有匹配的条目。</div>'}</div>`;

  }

  function toggleHtml(key, checked, disabled = false) {
    const label = key.startsWith('prompt:') ? ctx.getPrompt(ctx.state.preset, key.slice(7))?.name : ({ streaming: '流式输出', 'connection-link': '联动连接配置', 'entry:floating_orb': '悬浮球入口', 'entry:input_button': '输入框按钮入口', 'entry:wand_menu': '魔术棒入口' })[key];
    return `<label class="switch" title="${checked ? '关闭' : '开启'}"><input type="checkbox" role="switch" aria-label="${ctx.escapeHtml(label || key)}" data-action="toggle" data-key="${ctx.escapeHtml(key)}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span></span></label>`;
  }

  function choiceButton(action, value, label, selected, disabled = false, groupId = '') {
    return `<button type="button" data-action="${action}" aria-pressed="${selected}" data-value="${ctx.escapeHtml(value)}" ${groupId ? `data-group="${ctx.escapeHtml(groupId)}"` : ''} class="${selected ? 'selected' : ''}" ${disabled ? 'disabled' : ''}>${ctx.escapeHtml(label)}</button>`;
  }

  function disabledAttribute() {
    return '';
  }

  return {
    renderFeatherIcon,
    syncOrbVisibility,
    render,
    renderActiveContent,
    restoreContentScroll,
    renderStyleEditorLayer,
    renderStatus,
    renderPanel,
    renderFold,
    renderActiveTab,
    renderSectionHeader,
    renderSettingsTab,
    renderModelTab,
    renderProfileSelect,
    renderNumericControl,
    renderLanguageControl,
    renderStyleEditor,
    renderEntryPointSettings,
    renderAdvancedTab,
    toggleHtml,
    choiceButton,
    disabledAttribute
  };
}
