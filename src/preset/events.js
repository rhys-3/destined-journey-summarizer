import * as summary from '../summary/service.js';

// Dependencies use live accessors so asynchronous operations share the current state.
export function createEvents(ctx) {
  function handleClick(event) {
    if(event.target.closest('.summary-slot, .dj-dialog-backdrop')) return;
    const target = event.target.closest('[data-action], .orb');
    if (!target) return;
    if (target.classList.contains('orb')) {
      if (!ctx.suppressOrbClick) ctx.openPanel();
      ctx.suppressOrbClick = false;
      return;
    }
    const action = target.dataset.action;
    if (ctx.state.workspaceBusy) return;
    if (action === 'entry-edit') { if(ctx.state.editorUnlocked)return ctx.openPromptEditor(target.dataset.id);return; }
    if (action === 'entry-new-here') {if(!ctx.state.editorUnlocked)return;return ctx.openPromptEditor('',{block:target.dataset.block});}
    if (action === 'entry-copy' || action === 'entry-delete') return ctx.editEntryAction(action).catch(ctx.showErrorToast);
    if (/^(configuration-|model-(add|rename|delete)$)/u.test(action)) return ctx.handleConfigurationAction(action, target).catch(ctx.showErrorToast);
    if (action === 'sort-grip') return;
    if (ctx.promptSort || (action === 'prompt-open' && Date.now() < ctx.sortClickUntil)) return;
    if (action === 'sort-show-all') { ctx.state.entryFilter = 'all'; ctx.state.search = ''; return ctx.renderActiveContent(false); }
    if (action === 'sort-undo') {
      const undo = ctx.state.reorderUndo;
      if (undo) return ctx.savePromptOrder(undo.id, undo.ordinal, undo.order, undo.presetName, true);
      return;
    }
    if (action === 'prompt-open') return ctx.openPromptEditor(target.dataset.id);
    if (action === 'prompt-new') return ctx.openPromptEditor();
    if (action === 'prompt-save') return ctx.savePromptEditor();
    if (action === 'prompt-step') {
      const editor = ctx.state.promptEditor;
      if (!editor || !ctx.state.editorUnlocked || editor.saving) return;
      const max = ctx.state.preset.prompts.length + (editor.base.included && editor.id ? 0 : 1);
      ctx.setEditorField('ordinal', Math.max(1, Math.min(max, (Number(editor.draft.ordinal) || 1) + Number(target.dataset.value))));
      return ctx.renderStyleEditorLayer();
    }
    if (action === 'prompt-close') return ctx.closePromptEditor();
    if (action === 'prompt-discard') return ctx.closePromptEditor(true);
    if (action === 'prompt-continue') { ctx.state.promptEditor.confirmClose = false; return ctx.renderStyleEditorLayer(); }
    if (action === 'prompt-reload') {
      const editor = ctx.state.promptEditor;
      if (!editor || editor.saving || editor.contextChanged) return;
      if (editor.dirty && !editor.confirmReload) { editor.confirmReload = true; editor.message = '重新载入会丢弃草稿。再次点击“重新载入”确认；也可先复制正文。'; return ctx.renderStyleEditorLayer(); }
      return ctx.openPromptEditor(editor.id);
    }
    if (ctx.state.promptEditor) return;
    if (action === 'close') return ctx.closePanel();
    if (action === 'close-backdrop' && event.target === target) return ctx.closePanel();
    if (action === 'close-style-editor' && event.target === target) {
      ctx.state.styleEditor = null;
      return ctx.renderStyleEditorLayer();
    }
    if (action === 'tab') {
      ctx.state.activeTab = target.dataset.tab;
      return ctx.renderActiveContent(false);
    }
    if (action === 'variable-mode') return ctx.selectVariableMode(target.dataset.value);
    if (action === 'refresh-worldbook') {
      ctx.worldEpoch += 1;
      const pending = ctx.configLibrary().pendingWorld;
      if (pending?.key === ctx.workspaceContextKey()) return ctx.selectVariableMode(pending.mode);
      return ctx.scanWorldbookMode();
    }
    if (action === 'jump') {
      const anchor = [...ctx.shadow.querySelectorAll('[data-anchor]')].find(item => item.dataset.anchor === target.dataset.value);
      if (anchor) {
        anchor.scrollIntoView({ block: 'start' });
        anchor.setAttribute('tabindex', '-1');
        anchor.focus({ preventScroll: true });
      }
      return;
    }
    if (action === 'entry-filter') {
      ctx.state.entryFilter = target.dataset.value;
      return ctx.renderActiveContent(false);
    }
    if (action === 'model') return ctx.selectModelAdapter(target.dataset.model);
    if (action === 'gemini-tail') return ctx.setGeminiTail(target.dataset.value);
    if (action === 'person') return ctx.setNarrationPerson(target.dataset.value);
    if (action === 'group') return ctx.applyGroup(target.dataset.group, target.dataset.value);
    if (action === 'field-preset') {
      ctx.setNumericMode(target.dataset.field, 'preset');
      const task = ctx.setNumericField(target.dataset.field, target.dataset.value);
      const card = target.closest('.numeric-card');
      card?.querySelectorAll('.chips button').forEach(button => button.classList.toggle('selected', button === target));
      const input = card?.querySelector('[data-action="field-number"]');
      if (input) input.value = target.dataset.value;
      const error = card?.querySelector(`[data-field-error="${target.dataset.field}"]`);
      if (error) error.textContent = '';
      return task.catch(ctx.showErrorToast);
    }
    if (action === 'field-custom') {
      ctx.setNumericMode(target.dataset.field, 'custom');
      const card = target.closest('.numeric-card');
      card?.querySelectorAll('.chips button').forEach(button => button.classList.toggle('selected', button === target));
      return card?.querySelector('[data-action="field-number"]')?.focus();
    }
    if (action === 'language-preset') {
      const task = ctx.setLanguageField(target.dataset.language, target.dataset.value);
      const card = target.closest('.language-card');
      card?.querySelectorAll('.chips button').forEach(button => button.classList.toggle('selected', button === target));
      const input = card?.querySelector('[data-action="language-input"]');
      if (input) input.value = target.dataset.value;
      const error = card?.querySelector(`[data-language-error="${target.dataset.language}"]`);
      if (error) error.textContent = '';
      return task.catch(ctx.showErrorToast);
    }
    if (action === 'language-custom') {
      const card = target.closest('.language-card');
      card?.querySelectorAll('.chips button').forEach(button => button.classList.toggle('selected', button === target));
      return card?.querySelector('[data-action="language-input"]')?.focus();
    }
    if (action === 'new-style') return ctx.openStyleEditor('', target.dataset.group);
    if (action === 'edit-style') return ctx.openStyleEditor(target.dataset.id);
    if (action === 'delete-style') return ctx.deleteUserStyle(target.dataset.id);
    if (action === 'save-style') return ctx.saveStyleEditor();
    if (action === 'cancel-style') {
      ctx.state.styleEditor = null;
      return ctx.renderStyleEditorLayer();
    }
    if (action === 'reset-user-additional') {
      const textarea = ctx.shadow.querySelector('[data-action="user-additional"]');
      const error = ctx.shadow.querySelector('[data-user-additional-error]');
      if (textarea) {
        textarea.disabled = false;
        textarea.value = ctx.USER_ADDITIONAL_DEFAULT;
      }
      if (error) error.textContent = '';
      return ctx.resetUserAdditionalSetting().catch(ctx.showErrorToast);
    }
    if (action === 'refresh-profiles') return ctx.loadProfiles();
  }

  async function handleChange(event) {
    const target = event.target;
    const action = target.dataset.action;
    if (action === 'configuration-scope') { const scopes=target.dataset.kind==='save'?ctx.configurationScopes:ctx.exportScopes; scopes[target.dataset.key]=target.checked; return; }
    if (action === 'ui-theme') return ctx.applyTheme(target.value, true);
    if (action === 'ui-transparency') return ctx.applyTransparency(Number(target.value), true);
    if (ctx.state.workspaceBusy) return;
    if (action === 'placement-field') return ctx.setPlacementField(target.dataset.field,target.value);
    if (action === 'model-draft') { ctx.state.modelDraft[target.dataset.field] = target.value; return; }
    if (action === 'configuration-switch') { if (target.value) ctx.applyConfiguration(target.value).catch(ctx.showErrorToast); else ctx.updateWorkspaceUi(); return; }
    if (action === 'configuration-file') {
      const file = target.files?.[0];
      if (file) { if (file.size > 20 * 1024 * 1024) ctx.showErrorToast(new Error('配置文件不能超过 20 MB')); else file.text().then(ctx.importConfigurations).catch(ctx.showErrorToast); }
      target.value = ''; return;
    }
    if (action === 'custom-tail') {
      const model = ctx.state.config.custom_models.find(item => item.id === target.dataset.model);
      const tail = model && ctx.getPrompt(ctx.state.preset, model.ids[2]);
      const edited = tail && (tail.content !== model.tailBaseline.content || tail.role !== model.tailBaseline.role);
      if (edited && !await ctx.dialogs.confirm('切换类型会替换当前自定义尾部的正文和角色，并保存恢复点。继续？')) { target.value = model.tailMode; return; }
      ctx.setCustomTail(target.dataset.model, target.value, !!edited).catch(ctx.showErrorToast); return;
    }
    if (action === 'edit-mode') {
      if (ctx.state.reorderSaving || ctx.state.promptEditor?.saving || ctx.state.promptEditor?.contextChanged) return;
      if(!target.checked&&(ctx.state.promptEditor?.dirty||ctx.state.styleEditor)){target.checked=true;ctx.setSaveStatus('error','请先保存或关闭条目编辑器，再退出编辑模式。');return;}
      ctx.state.editorUnlocked = target.checked;
      if(!target.checked){ctx.cancelPromptSort();ctx.state.promptEditor=null;ctx.state.styleEditor=null;}
      ctx.render();return;
    }
    if (action === 'prompt-field') {
      // Text fields emit change on blur, between pressing and releasing Save.
      // Preserve the button in that interval so the first click reaches it.
      if (target.tagName !== 'SELECT' && target.type !== 'checkbox') return handleInput(event);
      ctx.setEditorField(target.dataset.field, target.type === 'checkbox' ? target.checked : target.value);
      return ctx.renderStyleEditorLayer();
    }
    if (action === 'toggle') {
      const key = target.dataset.key;
      if (key?.startsWith('entry:')) return ctx.updateEntryPoint(key.slice('entry:'.length), target.checked, target);
      if (key === 'connection-link') return ctx.updateConnectionLink(target.checked);
      if (key === 'streaming') return ctx.setStreaming(target.checked);
      if (key?.startsWith('prompt:')) {
        const card = target.closest('.mini-card');
        const small = card?.querySelector('small');
        if (small) small.textContent = target.checked ? '已启用' : '已关闭';
        return ctx.togglePrompt(key.slice('prompt:'.length), target.checked);
      }
    }
    if (action === 'profile-binding') return ctx.updateProfileBinding(target.dataset.model, target.value);

  }

  function handleInput(event) {
    const target = event.target;
    const action = target.dataset.action;
    if (action === 'ui-transparency') return ctx.applyTransparency(Number(target.value));
    if (ctx.state.workspaceBusy) return;
    if (action === 'configuration-name') { ctx.state.configurationName = target.value; return; }
    if (action === 'model-draft') { ctx.state.modelDraft[target.dataset.field] = target.value; return; }
    if (action === 'prompt-field') {
      ctx.setEditorField(target.dataset.field, target.type === 'checkbox' ? target.checked : target.value);
      const editor = ctx.state.promptEditor;
      const button = ctx.shadow.querySelector('[data-action="prompt-save"]');
      if (button) button.disabled = !ctx.state.editorUnlocked || editor.saving || editor.contextChanged || (!editor.dirty && !!editor.id);
      const feedback = ctx.shadow.querySelector('.editor-feedback');
      if (feedback) feedback.textContent = editor.dirty ? '修改尚未保存。' : '原生界面修改会同步到这里。';
      return;
    }
    if (action === 'search') {
      ctx.state.search = target.value;
      return ctx.renderActiveContent(true);
    }
    if (action === 'field-number') {
      const key = target.dataset.field;
      const value = String(target.value ?? '').trim();
      ctx.setNumericMode(key, 'custom');
      const card = target.closest('.numeric-card');
      card?.querySelectorAll('.chips button').forEach(button => button.classList.toggle('selected', button.dataset.action === 'field-custom'));
      const error = card?.querySelector(`[data-field-error="${key}"]`);
      if (!/^-?\d+$/u.test(value)) {
        if (error) error.textContent = value ? '请输入有效整数。' : '自定义数值不能为空。';
        return;
      }
      if (error) error.textContent = '';
      return ctx.setNumericField(key, value).catch(ctx.showErrorToast);
    }
    if (action === 'language-input') {
      const key = target.dataset.language;
      const value = String(target.value ?? '').trim();
      const card = target.closest('.language-card');
      card?.querySelectorAll('.chips button').forEach(button => button.classList.toggle('selected', button.dataset.action === 'language-custom'));
      const error = card?.querySelector(`[data-language-error="${key}"]`);
      if (!value) {
        if (error) error.textContent = '自定义语言不能为空。';
        return;
      }
      if (/[\u0000-\u001f\u007f<>{}]/u.test(value)) {
        if (error) error.textContent = '不能包含换行、控制字符、尖括号或花括号。';
        return;
      }
      if (error) error.textContent = '';
      return ctx.setLanguageField(key, value).catch(ctx.showErrorToast);
    }
    if (action === 'global-preference') {
      const error = ctx.shadow.querySelector('[data-preference-error]');
      if (error) error.textContent = '';
      return ctx.setGlobalPreference(target.value).catch(ctx.showErrorToast);
    }
    if (action === 'user-additional') {
      const error = ctx.shadow.querySelector('[data-user-additional-error]');
      if (String(target.value ?? '').includes('{{/setvar}}')) {
        if (error) error.textContent = '不能包含 {{/setvar}}，否则会截断受管区域。';
        return;
      }
      if (error) error.textContent = '';
      return ctx.setUserAdditionalSetting(target.value).catch(ctx.showErrorToast);
    }
    if (action === 'style-title' && ctx.state.styleEditor) ctx.state.styleEditor.title = target.value;
    if (action === 'style-content' && ctx.state.styleEditor) ctx.state.styleEditor.content = target.value;
  }

  function handleKeydown(event) {
    if(ctx.shadow?.querySelector('.dj-dialog-backdrop')) return;
    if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key) && event.target.closest('.sort-handle') && ctx.canSortPrompts()) {
      event.preventDefault();
      const id = event.target.closest('.sort-handle').dataset.id;
      const order = ctx.state.preset.prompts.map(p => p.id);
      const ordinal = Math.max(1, Math.min(order.length, order.indexOf(id) + 1 + (event.key === 'ArrowUp' ? -1 : 1)));
      return ctx.savePromptOrder(id, ordinal, order, getLoadedPresetName());
    }
    if (event.key === 'Escape' && ctx.state.open) {
      event.preventDefault();
      if (ctx.state.promptEditor) return ctx.closePromptEditor();
      if (ctx.state.styleEditor) {
        ctx.state.styleEditor = null;
        ctx.renderStyleEditorLayer();
        return ctx.shadow.querySelector('[data-action="new-style"]')?.focus();
      }
      return ctx.closePanel();
    }
    if (ctx.state.promptEditor && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); return ctx.savePromptEditor(); }
    if (!ctx.state.open || event.key !== 'Tab' || (!ctx.state.styleEditor && !ctx.state.promptEditor)) return;
    const focusScope = ctx.shadow.querySelector('.prompt-editor, .style-editor');
    if (!focusScope) return;
    const focusable = [...focusScope.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && ctx.shadow.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && ctx.shadow.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function createUi() {
    const parentDocument = window.parent.document;
    parentDocument.getElementById(ctx.HOST_ID)?.remove();
    ctx.host = parentDocument.createElement('div');
    ctx.host.id = ctx.HOST_ID;
    ctx.host.dataset.scriptId = ctx.SCRIPT_ID;
    ctx.host.dataset.ttMobileSurface = 'free-window';
    ctx.host.setAttribute('script_id', ctx.SCRIPT_ID);
    ctx.host.style.position = 'fixed';
    ctx.host.style.inset = '0';
    ctx.host.style.zIndex = '2147481000';
    ctx.host.style.pointerEvents = 'none';
    parentDocument.body.appendChild(ctx.host);
    ctx.shadow = ctx.host.attachShadow({ mode: 'open' });
    const style = parentDocument.createElement('style');
    style.textContent = ctx.STYLES;
    ctx.app = parentDocument.createElement('div');
    ctx.app.className = `destined-root${ctx.isMobileViewport() ? ' mobile-layout' : ''}`;
    ctx.shadow.append(style, ctx.app);
    ctx.app.addEventListener('click', handleClick);
    ctx.app.addEventListener('change', handleChange);
    ctx.app.addEventListener('input', handleInput);
    ctx.app.addEventListener('toggle', event => {
      if (event.target.classList?.contains('editor-properties') && event.target.isConnected && ctx.state.promptEditor) ctx.state.promptEditor.propertiesOpen = event.target.open;
      const id = event.target.dataset?.disclosure;
      if (!id || !event.target.isConnected) return;
      if (event.target.open) ctx.state.disclosures.add(id);
      else ctx.state.disclosures.delete(id);
    }, true);
    ctx.app.addEventListener('pointerdown', ctx.handlePromptSortPointerDown);
    ctx.app.addEventListener('pointerdown', ctx.handleOrbPointerDown);
    ctx.app.addEventListener('pointerdown', ctx.handlePanelPointerDown);
    ctx.shadow.addEventListener('keydown', handleKeydown);
    ctx.render();
  }

  function subscribe(eventName, handler) {
    if (!eventName) return;
    try {
      const stop = eventOn(eventName, handler);
      if (stop) ctx.eventStops.push(stop);
    } catch (error) {
      console.warn(`[${ctx.SCRIPT_NAME}] 监听事件失败：${eventName}`, error);
    }
  }

  function subscribeLast(eventName, handler) {
    if (!eventName) return;
    try {
      const stop = eventMakeLast(eventName, handler);
      if (stop) ctx.eventStops.push(stop);
    } catch (error) {
      console.warn(`[${ctx.SCRIPT_NAME}] 注册末位监听失败，回退到普通监听：${eventName}`, error);
      subscribe(eventName, handler);
    }
  }

  function cleanup() {
    ctx.cancelPromptSort();
    if (ctx.destroyed) return;
    ctx.destroyed = true;
    summary.dispose();
    ctx.dialogs?.destroy();
    for (const item of ctx.debounceTimers.values()) { clearTimeout(item.timer); item.resolve({ cancelled: true }); }
    ctx.debounceTimers.clear();
    for (const stop of ctx.eventStops) {
      try { stop.stop?.(); } catch { /* ignore */ }
    }
    for (const stop of ctx.macroStops) {
      try { stop.unregister?.(); } catch { /* ignore */ }
    }
    if (ctx.syncInterval) window.clearInterval(ctx.syncInterval);
    ctx.worldEpoch += 1;
    clearTimeout(ctx.worldTimer);
    window.parent.document.getElementById(ctx.WAND_CONTAINER_ID)?.remove();
    ctx.host?.remove();
    window.parent.removeEventListener('resize', ctx.handleViewportResize);
    window.parent.visualViewport?.removeEventListener('resize', ctx.handleViewportResize);
    window.parent.visualViewport?.removeEventListener('scroll', ctx.handleViewportResize);
  }

  return { handleClick, handleChange, handleInput, handleKeydown, createUi, subscribe, subscribeLast, cleanup };
}
