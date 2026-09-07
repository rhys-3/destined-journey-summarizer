// Dependencies use live accessors so asynchronous operations share the current state.
export function createPromptEditor(ctx) {
  function findEditorPrompt(preset, id) {
    return [...(preset.prompts ?? []), ...(preset.prompts_unused ?? [])].find(prompt => prompt.id === id);
  }

  function editorSnapshot(preset, id) {
    const prompt = findEditorPrompt(preset, id);
    if (!prompt) return null;
    const index = (preset.prompts ?? []).findIndex(item => item.id === id);
    return { name: prompt.name, content: prompt.content ?? '', role: prompt.role ?? 'system', enabled: !!prompt.enabled,
      position: ctx.clone(prompt.position ?? { type: 'relative' }), included: index >= 0, ordinal: index >= 0 ? index + 1 : preset.prompts.length + 1, authorUi: ctx.placementSnapshot(preset,id) };
  }

  function openPromptEditor(id = '', { block } = {}) {
    ctx.refreshPreset(false);
    const base = id ? editorSnapshot(ctx.state.preset, id) : { name: '⚙️ 新条目', content: '', role: 'system', enabled: false, position: { type: 'relative' }, included: true, ordinal: ctx.state.preset.prompts.length + 1, authorUi: {block:'unclassified',before:''} };
    if (!base || (!id && !ctx.state.editorUnlocked)) return;
    ctx.state.promptEditor = { id, presetName: getLoadedPresetName(), base, draft: ctx.clone(base), order: ctx.state.preset.prompts.map(p => p.id), dirty: false, saving: false, message: '', contextChanged: false };
    ctx.state.promptEditor.authorLayout = JSON.stringify(ctx.state.preset.extensions?.destined_author ?? null);
    if (!id && block) {
      ctx.setPlacementField('block',block);
      ctx.state.promptEditor.initialDraft=ctx.clone(ctx.state.promptEditor.draft);
      ctx.state.promptEditor.dirty=false;
    }
    ctx.state.styleEditor = null;
    ctx.renderStyleEditorLayer();
    queueMicrotask(() => ctx.shadow.querySelector('[data-action="prompt-close"]')?.focus());
  }

  function syncPromptEditor() {
    const editor = ctx.state.promptEditor;
    if (!editor || editor.saving) return;
    editor.contextChanged = editor.presetName !== getLoadedPresetName();
    if (editor.contextChanged) {
      ctx.state.editorUnlocked = false;
      editor.message = '已切换预设，旧草稿保留供复制。关闭后重新打开条目再编辑。';
      return;
    }
    if (!editor.id) return;
    const live = editorSnapshot(ctx.state.preset, editor.id);
    if (!live) { editor.message = '该条目已被外部移除，草稿仍保留供复制。'; return; }
    if (!editor.dirty) {
      editor.base = live; editor.draft = ctx.clone(live); editor.order = ctx.state.preset.prompts.map(p => p.id);
    } else if (!editor.message && JSON.stringify(live) !== JSON.stringify(editor.base)) {
      editor.message = '酒馆中的条目已更新。你的草稿已保留；保存时会合并未编辑字段，同一字段冲突时停止保存。';
    }
  }

  function setEditorField(field, value) {
    const editor = ctx.state.promptEditor;
    if (!editor || !ctx.state.editorUnlocked || editor.saving || editor.contextChanged) return;
    if (field === 'positionType') editor.draft.position = value === 'in_chat' ? { type: 'in_chat', depth: 4, order: 100 } : { type: 'relative' };
    else if (field === 'depth' || field === 'order') editor.draft.position[field] = value;
    else editor.draft[field] = value;
    editor.dirty = JSON.stringify(editor.draft) !== JSON.stringify(editor.initialDraft ?? editor.base);
    editor.confirmReload = false;
    editor.message = '';
  }

  function closePromptEditor(discard = false) {
    const editor = ctx.state.promptEditor;
    if (editor?.saving) return;
    if (editor?.dirty && !discard) {
      editor.confirmClose = true;
      return ctx.renderStyleEditorLayer();
    }
    const id = editor?.id;
    ctx.state.promptEditor = null;
    ctx.renderStyleEditorLayer();
    [...ctx.shadow.querySelectorAll('[data-action="prompt-open"]')].find(e => e.dataset.id === id)?.focus({ preventScroll: true });
  }

  async function savePromptEditor() {
    const editor = ctx.state.promptEditor;
    if (!editor || !ctx.state.editorUnlocked || editor.saving || editor.contextChanged) return;
    editor.saving = true; editor.message = ''; editor.confirmClose = false;
    ctx.renderStyleEditorLayer();
    const task = ctx.saveChain.then(async () => {
      if (getLoadedPresetName() !== editor.presetName) throw new Error('预设已切换，未保存旧草稿。');
      if (!ctx.state.editorUnlocked || ctx.state.promptEditor !== editor) throw new Error('编辑器已锁定，未保存。');
      const latest = ctx.clone(getPreset('in_use'));
      const draft = ctx.clone(editor.draft);
      draft.name = draft.name.trim();
      if (!draft.name) throw new Error('条目名称不能为空。');
      if (!['system', 'user', 'assistant'].includes(draft.role)) throw new Error('请选择有效的消息角色。');
      if (draft.position.type === 'in_chat') {
        for (const field of ['depth', 'order']) {
          const value = String(draft.position[field]);
          if (!/^\d+$/u.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('深度和同层顺序必须为非负整数。');
          draft.position[field] = Number(value);
        }
      }
      if (!/^\d+$/u.test(String(draft.ordinal)) || !Number.isSafeInteger(Number(draft.ordinal)) || Number(draft.ordinal) < 1) throw new Error('列表序号必须为正整数。');
      draft.ordinal = Number(draft.ordinal);
      const live = editor.id ? editorSnapshot(latest, editor.id) : null;
      if (editor.id && !live) throw new Error('该条目已被外部移除，未覆盖。');
      const fields = ['name', 'content', 'role', 'enabled', 'position', 'included', 'ordinal', 'authorUi'];
      const changed = fields.filter(key => !editor.id || JSON.stringify(draft[key]) !== JSON.stringify(editor.base[key]));
      if (findEditorPrompt(latest,editor.id)?.extra?.destined_ui?.version !== 3 && !changed.includes('authorUi')) changed.push('authorUi');
      const names = { name: '名称', content: '正文', role: '消息角色', enabled: '启用状态', position: '插入位置', included: '列表位置', ordinal: '列表顺序', authorUi:'界面展示' };
      for (const field of changed) {
        if (live && JSON.stringify(live[field]) !== JSON.stringify(editor.base[field]) && JSON.stringify(live[field]) !== JSON.stringify(draft[field])) throw new Error(`「${names[field]}」已被酒馆中的其他操作修改。草稿已保留，请复制需要的文字后重新载入。`);
      }
      const placementMoving=(editor.placementRequested||!!editor.id)&&JSON.stringify(draft.authorUi)!==JSON.stringify(editor.base.authorUi)&&draft.authorUi.block!=='hidden';
      const moving = changed.includes('ordinal') || changed.includes('included');
      if (changed.includes('authorUi') && JSON.stringify(latest.extensions?.destined_author ?? null) !== editor.authorLayout) throw new Error('页面或分组已变化，请重新载入条目后调整展示设置。');
      if (editor.id && (moving||placementMoving) && JSON.stringify(latest.prompts.map(p => p.id)) !== JSON.stringify(editor.order)) throw new Error('列表顺序已在酒馆中改变，请重新载入后调整顺序。');
      if (ctx.PROTECTED_IDS.has(editor.id) && (!draft.enabled || !draft.included)) throw new Error('此项是必需基础条目，必须保留并启用。');
      const groupId = editor.id ? ctx.getPromptGroupId(findEditorPrompt(latest, editor.id)) : null;
      if ((ctx.MODEL_IDS.has(editor.id) || groupId === 'variable-mode') && (changed.includes('enabled') || changed.includes('included'))) throw new Error('模型和变量模式请通过对应的联动选项切换。');
      if (groupId && changed.includes('enabled') && !draft.enabled) throw new Error('互斥组选项请通过选择另一项关闭。');
      if (groupId && changed.includes('included') && ctx.authorDependency(findEditorPrompt(latest,editor.id))) throw new Error('互斥组条目需要保留在发送列表中。');
      const id = editor.id || ctx.createPromptId();
      const maxOrdinal = latest.prompts.length + (live?.included ? 0 : 1);
      if (draft.included && moving && draft.ordinal > maxOrdinal) throw new Error(`列表序号不能超过 ${maxOrdinal}。`);
      const expected = ctx.fingerprintPresetValue(latest);
      const guard = () => !ctx.destroyed && ctx.state.editorUnlocked && ctx.state.promptEditor === editor && getLoadedPresetName() === editor.presetName && ctx.fingerprintPresetValue(getPreset('in_use')) === expected;
      await ctx.commitPresetMutation('预设条目', preset => {
        let prompt = findEditorPrompt(preset, id);
        if (!prompt) { prompt = { id, name: draft.name, content: draft.content, role: draft.role, enabled: draft.enabled, position: draft.position }; (preset.prompts_unused ??= []).push(prompt); }
        for (const field of changed) {
          if (field === 'included' || field === 'ordinal' || field === 'authorUi') continue;
          if (field === 'content' && ctx.PLACEHOLDER_IDS.has(id)) continue;
          if (field === 'position' && ctx.SYSTEM_PROMPT_IDS.has(id)) continue;
          prompt[field] = ctx.clone(draft[field]);
        }
        if (changed.includes('authorUi')) {
          ctx.savePlacement(preset,prompt,draft.authorUi,false);
          prompt.extra.destined_ui.group=groupId??'';
        }
        if (changed.includes('name') && prompt.extra?.destined_ui) prompt.extra.destined_ui.label='';
        if (ctx.PROTECTED_IDS.has(id)) prompt.enabled = true;
        if (groupId && changed.includes('enabled') && draft.enabled) for (const other of preset.prompts) if (other.id !== id && ctx.getPromptGroupId(other) === groupId) other.enabled = false;
        if (moving || !editor.id) {
          preset.prompts = preset.prompts.filter(p => p.id !== id);
          preset.prompts_unused = (preset.prompts_unused ?? []).filter(p => p.id !== id);
          if (draft.included) preset.prompts.splice(draft.ordinal - 1, 0, prompt);
          else preset.prompts_unused.push(prompt);
        }
        if(draft.included&&placementMoving)ctx.savePlacement(preset,prompt,draft.authorUi);
        if(changed.includes('included'))ctx.repairPlacementGroup(preset,groupId);
      }, guard, true);
      editor.id = id;
      editor.base = editorSnapshot(ctx.state.preset, id); editor.draft = ctx.clone(editor.base); editor.order = ctx.state.preset.prompts.map(p => p.id);
      editor.dirty = false; editor.message = '已同步到酒馆当前预设，并保存到预设文件。';
      editor.authorLayout = JSON.stringify(ctx.state.preset.extensions?.destined_author ?? null);
    });
    ctx.saveChain = task.catch(() => {});
    try {
      await ctx.trackPresetOperation(task);
      if (ctx.state.promptEditor === editor) ctx.state.promptEditor = null;
      return editor.id;
    }
    catch (error) { editor.message = error instanceof Error ? error.message : String(error); }
    finally { editor.saving = false; ctx.renderActiveContent(true); }
  }

  function renderPromptEditor() {
    const editor = ctx.state.promptEditor;
    if (!editor) return '';
    const d = editor.draft;
    const locked = !ctx.state.editorUnlocked || editor.saving || editor.contextChanged;
    const attr = locked ? 'disabled' : '';
    const readonly = locked ? 'readonly' : '';
    const required = ctx.PROTECTED_IDS.has(editor.id);
    const linked = ctx.MODEL_IDS.has(editor.id) || ctx.getPromptGroupId(findEditorPrompt(ctx.state.preset, editor.id)) === 'variable-mode';
    const placeholder = ctx.PLACEHOLDER_IDS.has(editor.id);
    const system = ctx.SYSTEM_PROMPT_IDS.has(editor.id);
    const group = ctx.getPromptGroupId(findEditorPrompt(ctx.state.preset, editor.id));
    const enabledLocked = locked || required || linked || (group && editor.base.enabled);
    return `<div class="editor-layer prompt-editor-layer"><article class="prompt-editor" role="dialog" aria-modal="true" aria-labelledby="prompt-editor-title">
      <header class="prompt-editor-head"><div><span class="eyebrow">PRESET EDITOR</span><h3 id="prompt-editor-title">${editor.id ? ctx.escapeHtml(editor.base.name) : '新建预设条目'}</h3><p>${locked ? '只读 · 可以选择、复制完整内容' : '编辑中 · 保存后同步到酒馆'}${editor.dirty ? ' · 有未保存修改' : ''}</p></div><button type="button" class="icon-button" data-action="prompt-close" aria-label="关闭条目编辑器" ${editor.saving ? 'disabled' : ''}>×</button></header>
      <div class="prompt-editor-body">
${required||placeholder?`<p class="editor-note">${required?'必需条目 · 保持启用':'酒馆动态占位符'}</p>`:''}
        ${linked ? '<p class="editor-note">模型与变量开关由联动选项管理，请在日常调整或模型与工具中切换。</p>' : ''}
        <label class="field-label"><span>条目名称</span><input data-action="prompt-field" data-field="name" value="${ctx.escapeHtml(d.name)}" ${readonly}></label>
        <div class="editor-checks"><label><input type="checkbox" aria-label="启用条目" data-action="prompt-field" data-field="enabled" ${d.enabled?'checked':''} ${enabledLocked?'disabled':''}>启用条目</label></div>
        ${ctx.renderPlacementFields(editor,locked)}
        <label class="field-label prompt-content-label"><span>完整正文${placeholder?' · 由酒馆在发送时填入':''}</span><textarea spellcheck="false" data-action="prompt-field" data-field="content" ${locked||placeholder?'readonly':''} placeholder="${placeholder?'这是动态占位符，实际内容来自角色卡、世界书或聊天记录。':'输入提示词正文；宏和模板代码会原样保存。'}">${ctx.escapeHtml(d.content)}</textarea></label>
        <div class="entry-operations">${editor.id ? `<button type="button" class="secondary-button" data-action="entry-copy" ${locked||placeholder?'disabled':''}>复制条目</button><button type="button" class="danger-button" data-action="entry-delete" ${locked||ctx.authorDependency(findEditorPrompt(ctx.state.preset,editor.id))?'disabled':''}>删除条目</button>` : ''}</div>
        <details class="editor-properties" ${editor.propertiesOpen ? 'open' : ''}><summary>发送设置 <small>${ctx.escapeHtml(d.role)} · ${d.included ? `列表第 ${ctx.escapeHtml(d.ordinal)} 项` : '未加入列表'}${d.position.type === 'in_chat' ? ` · 深度 ${ctx.escapeHtml(d.position.depth)}` : ''}</small></summary>
        <label class="field-label"><span>消息角色</span><select data-action="prompt-field" data-field="role" ${attr}>${['system','user','assistant'].map(role=>`<option value="${role}" ${d.role===role?'selected':''}>${({system:'系统',user:'用户',assistant:'助手'})[role]}</option>`).join('')}</select></label>
        <div class="editor-checks"><label><input type="checkbox" aria-label="加入发送列表" data-action="prompt-field" data-field="included" ${d.included?'checked':''} ${locked||required||linked?'disabled':''}>加入发送列表</label></div>
        <div class="prompt-position"><label class="field-label"><span>列表序号</span><span class="editor-order-control"><button type="button" data-action="prompt-step" data-value="-1" aria-label="上移一位" ${locked||!d.included||Number(d.ordinal)<=1?'disabled':''}>↑</button><input type="number" min="1" data-action="prompt-field" data-field="ordinal" value="${ctx.escapeHtml(d.ordinal)}" ${locked||!d.included?'disabled':''}><button type="button" data-action="prompt-step" data-value="1" aria-label="下移一位" ${locked||!d.included||Number(d.ordinal)>=(ctx.state.preset.prompts.length+(editor.base.included&&editor.id?0:1))?'disabled':''}>↓</button></span></label>
        <label class="field-label"><span>插入位置</span><select data-action="prompt-field" data-field="positionType" ${locked||system?'disabled':''}><option value="relative" ${d.position.type==='relative'?'selected':''}>按列表顺序</option><option value="in_chat" ${d.position.type==='in_chat'?'selected':''}>聊天内指定深度</option></select></label>
        ${d.position.type==='in_chat'?`<label class="field-label"><span>聊天深度</span><input type="number" min="0" data-action="prompt-field" data-field="depth" value="${ctx.escapeHtml(d.position.depth)}" ${attr}></label><label class="field-label"><span>同层顺序</span><input type="number" min="0" data-action="prompt-field" data-field="order" value="${ctx.escapeHtml(d.position.order)}" ${attr}></label>`:''}</div></details>
        <details class="editor-reference"><summary>条目信息</summary><code>${ctx.escapeHtml(editor.id||'保存时生成 ID')}</code><p>列表序号对应完整发送列表。聊天内条目还受深度和同层顺序控制；未加入列表的条目不会发送。</p></details>
      </div><footer class="prompt-editor-footer"><div class="editor-feedback" role="status" aria-live="polite">${ctx.escapeHtml(editor.message || (editor.dirty?'修改尚未保存。':'原生界面修改会同步到这里。'))}</div>
      ${editor.confirmClose?'<div class="editor-actions"><span>放弃尚未保存的修改？</span><button class="danger-button" data-action="prompt-discard">放弃修改</button><button class="secondary-button" data-action="prompt-continue">继续编辑</button></div>':`<div class="editor-actions"><button type="button" class="primary-button" data-action="prompt-save" ${locked||(!editor.dirty&&editor.id)?'disabled':''}>${editor.saving?'正在保存…':'保存修改'}</button><button type="button" class="secondary-button" data-action="prompt-reload" ${editor.saving||editor.contextChanged||!editor.id?'disabled':''}>重新载入</button><button type="button" class="secondary-button" data-action="prompt-close" ${editor.saving?'disabled':''}>返回列表</button></div>`}</footer></article></div>`;
  }

  function canSortPrompts() {
    return ctx.state.open && ctx.state.activeTab === 'advanced' && ctx.state.editorUnlocked && !ctx.state.promptEditor
      && !ctx.state.reorderSaving && ctx.state.entryFilter === 'all' && !ctx.state.search.trim();
  }

  function sortAnnouncement(message) {
    const live = ctx.shadow?.querySelector('.sort-live');
    if (live) live.textContent = message;
  }

  function cancelPromptSort(message = '') {
    const drag = ctx.promptSort;
    if (!drag) return;
    ctx.promptSort = null;
    clearTimeout(drag.timer);
    window.parent.cancelAnimationFrame(drag.frame);
    drag.dispose();
    drag.row.classList.remove('sort-source', 'sort-pending');
    drag.handle.removeAttribute('aria-pressed');
    drag.ghost?.remove(); drag.line?.remove();
    ctx.app?.classList.remove('sorting-prompts');
    try { drag.handle.releasePointerCapture(drag.pointerId); } catch { /* pointer already released */ }
    if (drag.active) ctx.sortClickUntil = Date.now() + 350;
    if (message) sortAnnouncement(message);
  }

  async function savePromptOrder(id, ordinal, expectedOrder, presetName, undo = false) {
    if (!ctx.state.editorUnlocked || ctx.state.reorderSaving || !ctx.state.open) return;
    ctx.state.reorderSaving = true;
    const task = ctx.saveChain.then(async () => {
      if (ctx.destroyed || !ctx.state.editorUnlocked || getLoadedPresetName() !== presetName) throw new Error('预设或编辑状态已变化，未调整顺序。');
      const latest = ctx.clone(getPreset('in_use'));
      const order = latest.prompts.map(prompt => prompt.id);
      if (JSON.stringify(order) !== JSON.stringify(expectedOrder)) throw new Error('酒馆中的条目顺序已变化，已保留最新列表，请重新拖动。');
      const from = order.indexOf(id);
      if (from < 0 || !Number.isInteger(ordinal) || ordinal < 1 || ordinal > order.length) throw new Error('目标位置已失效，请重新拖动。');
      if (from === ordinal - 1) return;
      const expected = ctx.fingerprintPresetValue(latest);
      const guard = () => !ctx.destroyed && ctx.state.editorUnlocked && getLoadedPresetName() === presetName && ctx.fingerprintPresetValue(getPreset('in_use')) === expected;
      await ctx.commitPresetMutation(undo ? '撤销拖动排序' : '拖动排序', preset => {
        const index = preset.prompts.findIndex(prompt => prompt.id === id);
        const [prompt] = preset.prompts.splice(index, 1);
        preset.prompts.splice(ordinal - 1, 0, prompt);
      }, guard, true);
      ctx.state.reorderUndo = undo ? null : { id, ordinal: from + 1, order: ctx.state.preset.prompts.map(p => p.id), presetName };
      ctx.setSaveStatus('saved', undo ? '已撤销排序，并同步到酒馆' : `已移至第 ${ordinal} 项，并同步到酒馆`);
    });
    ctx.saveChain = task.catch(() => {});
    ctx.renderActiveContent(true);
    try { await ctx.trackPresetOperation(task); }
    catch (error) { ctx.refreshPreset(false); ctx.setSaveStatus('error', error instanceof Error ? error.message : String(error)); }
    finally {
      ctx.state.reorderSaving = false;
      ctx.renderActiveContent(true);
      ctx.renderStatus();
      const row = [...(ctx.shadow?.querySelectorAll('.prompt-sort-row') ?? [])].find(row => row.dataset.sortId === id);
      row?.classList.add('sort-just-moved');
      row?.querySelector('.sort-handle')?.focus({ preventScroll: true });
    }
  }

  function handlePromptSortPointerDown(event) {
    const handle = event.target.closest('.sort-handle');
    if (!handle || handle.disabled || !canSortPrompts() || event.button !== 0 || event.isPrimary === false) return;
    cancelPromptSort();
    event.preventDefault(); event.stopPropagation();
    const row = handle.closest('.prompt-sort-row');
    const content = ctx.shadow.querySelector('.content');
    const order = ctx.state.preset.prompts.map(prompt => prompt.id);
    const id = row.dataset.sortId;
    const touch = event.pointerType === 'touch';
    const startScroll = content.scrollTop;
    const others = [...ctx.shadow.querySelectorAll('.prompt-sort-row')].filter(item => item !== row).map(item => {
      const rect = item.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, center: (rect.top + rect.bottom) / 2 };
    });
    const drag = { id, handle, row, content, order, others, startScroll, presetName: getLoadedPresetName(),
      pointerId: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY,
      touch, active: false, hasMoved: false, index: order.indexOf(id), frame: 0, timer: 0, lastTime: 0, dispose: () => {} };
    ctx.promptSort = drag;
    row.classList.add('sort-pending');
    handle.focus({ preventScroll: true });
    try { handle.setPointerCapture(event.pointerId); } catch { /* document listeners still track it */ }

    const frame = time => {
      if (ctx.promptSort !== drag || !drag.active) return;
      if (!canSortPrompts() || !row.isConnected || drag.presetName !== getLoadedPresetName()) return cancelPromptSort('列表已变化，拖动已取消。');
      const rect = content.getBoundingClientRect();
      const dt = Math.min(32, drag.lastTime ? time - drag.lastTime : 16);
      drag.lastTime = time;
      const insideX = drag.x >= rect.left && drag.x <= rect.right;
      const edge = Math.min(60, rect.height / 4);
      let speed = 0;
      if (drag.hasMoved && insideX && drag.y >= rect.top - 24 && drag.y <= rect.bottom + 24) {
        if (drag.y < rect.top + edge) speed = -650 * Math.min(1, (rect.top + edge - drag.y) / edge);
        else if (drag.y > rect.bottom - edge) speed = 650 * Math.min(1, (drag.y - rect.bottom + edge) / edge);
      }
      if (speed) content.scrollTop += speed * dt / 1000;
      const delta = content.scrollTop - startScroll;
      const index = others.findIndex(item => drag.y < item.center - delta);
      const next = index < 0 ? others.length : index;
      if (drag.index !== next) {
        drag.index = next;
        sortAnnouncement(`移至第 ${next + 1} 项，松开保存；Escape 取消。`);
      }
      const boundary = next < others.length ? others[next].top - delta - 4 : (others.at(-1)?.bottom ?? row.getBoundingClientRect().bottom) - delta + 4;
      drag.line.style.cssText = `left:${rect.left + 8}px;top:${Math.max(rect.top + 2, Math.min(rect.bottom - 3, boundary))}px;width:${Math.max(0, rect.width - 24)}px;display:${insideX ? 'block' : 'none'}`;
      const width = Math.min(280, rect.width - 24);
      drag.ghost.style.width = `${width}px`;
      drag.ghost.style.left = `${Math.max(rect.left + 8, Math.min(rect.right - width - 8, drag.x + 16))}px`;
      drag.ghost.style.top = `${Math.max(rect.top, Math.min(rect.bottom - 64, drag.y + (touch ? -76 : 16)))}px`;
      drag.ghost.querySelector('small').textContent = insideX ? `第 ${order.indexOf(id) + 1} 项 → 第 ${next + 1} 项 · 松开保存` : '移回列表继续，或松开取消';
      drag.frame = window.parent.requestAnimationFrame(frame);
    };
    const activate = () => {
      if (ctx.promptSort !== drag) return;
      drag.active = true;
      row.classList.remove('sort-pending'); row.classList.add('sort-source');
      ctx.app.classList.add('sorting-prompts'); handle.setAttribute('aria-pressed', 'true');
      drag.ghost = window.parent.document.createElement('div');
      drag.ghost.className = 'sort-ghost'; drag.ghost.setAttribute('aria-hidden', 'true');
      drag.ghost.innerHTML = `<strong>${ctx.escapeHtml(ctx.getPrompt(ctx.state.preset, id)?.name ?? '')}</strong><small></small>`;
      drag.line = window.parent.document.createElement('div'); drag.line.className = 'sort-drop-line';
      drag.line.setAttribute('aria-hidden', 'true'); ctx.app.append(drag.ghost, drag.line);
      sortAnnouncement(`正在移动 ${ctx.getPrompt(ctx.state.preset, id)?.name}。松开保存，Escape 取消。`);
      drag.frame = window.parent.requestAnimationFrame(frame);
    };
    const onMove = e => {
      if (e.pointerId !== drag.pointerId || ctx.promptSort !== drag) return;
      drag.x = e.clientX; drag.y = e.clientY;
      const distance = Math.hypot(drag.x - drag.startX, drag.y - drag.startY);
      if (!drag.active && touch && distance > 9) return cancelPromptSort('未进入拖动；可在条目文字区域滑动列表。');
      if (!drag.active && !touch && distance >= 5) activate();
      if (drag.active && distance >= 5) drag.hasMoved = true;
      if (drag.active) e.preventDefault();
    };
    const onUp = e => {
      if (e.pointerId !== drag.pointerId || ctx.promptSort !== drag) return;
      const rect = content.getBoundingClientRect();
      const valid = drag.active && e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      // Recompute from the release position, even if pointerup arrives before the next animation frame.
      const delta = content.scrollTop - startScroll;
      const next = others.findIndex(item => e.clientY < item.center - delta);
      const ordinal = (next < 0 ? others.length : next) + 1;
      cancelPromptSort(valid ? '' : '已取消拖动，顺序未改变。');
      if (valid && ordinal !== order.indexOf(id) + 1) void savePromptOrder(id, ordinal, order, drag.presetName);
      else if (valid) sortAnnouncement('位置未改变。');
    };
    const onCancel = e => { if (e.pointerId === drag.pointerId) cancelPromptSort('已取消拖动，顺序未改变。'); };
    const onBlur = () => cancelPromptSort('已取消拖动，顺序未改变。');
    const onKey = e => { if (e.key === 'Escape' && ctx.promptSort === drag) { e.preventDefault(); e.stopPropagation(); cancelPromptSort('已取消拖动，顺序未改变。'); } };
    const doc = window.parent.document;
    doc.addEventListener('pointermove', onMove, { passive: false });
    doc.addEventListener('pointerup', onUp); doc.addEventListener('pointercancel', onCancel);
    doc.addEventListener('keydown', onKey, true);
    handle.addEventListener('lostpointercapture', onCancel);
    window.parent.addEventListener('blur', onBlur);
    drag.dispose = () => {
      doc.removeEventListener('pointermove', onMove); doc.removeEventListener('pointerup', onUp);
      doc.removeEventListener('pointercancel', onCancel); doc.removeEventListener('keydown', onKey, true);
      handle.removeEventListener('lostpointercapture', onCancel); window.parent.removeEventListener('blur', onBlur);
    };
    if (touch) drag.timer = setTimeout(activate, 180);
  }

  return {
    findEditorPrompt,
    editorSnapshot,
    openPromptEditor,
    syncPromptEditor,
    setEditorField,
    closePromptEditor,
    savePromptEditor,
    renderPromptEditor,
    canSortPrompts,
    sortAnnouncement,
    cancelPromptSort,
    savePromptOrder,
    handlePromptSortPointerDown
  };
}
