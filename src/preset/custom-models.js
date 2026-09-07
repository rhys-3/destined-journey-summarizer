// Dependencies use live accessors so asynchronous operations share the current state.
export function createCustomModels(ctx) {
  async function addCustomModel(name, tailMode = 'no-prefill', bindingKey = '') {
    ctx.assertData(ctx.state.editorUnlocked,'请先打开编辑模式');
    return ctx.runWorkspaceOperation('新增模型', async current => {
      const config = ctx.clone(ctx.state.config);
      const label = ctx.validName(name, Object.entries(ctx.MODEL_ADAPTERS).map(([id, adapter]) => ({ id, name: adapter.label })));
      ctx.assertData(['prefill', 'no-prefill'].includes(tailMode), '尾部必须二选一');
      const preset = ctx.clone(getPreset('in_use'));
      const expected = ctx.fingerprintPresetValue(preset);
      const gemini = ctx.BUILTIN_MODEL_ADAPTERS.Gemini;
      const sourceIds = [gemini.ids[0], gemini.ids[1], gemini.tails[tailMode === 'prefill' ? 0 : 1]];
      const indices = sourceIds.map(id => preset.prompts.findIndex(prompt => prompt.id === id));
      ctx.assertData(indices.every(index => index >= 0) && indices[0] < indices[1] && indices[1] < indices[2], 'Gemini 模板缺失或头部、思维链、尾部区域顺序异常。');
      const id = 'model:' + ctx.createPromptId();
      const ids = sourceIds.map(() => ctx.createPromptId());
      const parts = ['head', 'thinking', 'tail'];
      const titles = ['🔌 ' + label + '头部', '🧠 ' + label + '思维链', '🔌 ' + label + (tailMode === 'prefill' ? '预填充' : '非预填充')];
      for (let part = 0; part < 3; part++) {
        const source = ctx.requirePrompt(preset, sourceIds[part]);
        const prompt = { ...ctx.clone(source), id: ids[part], name: titles[part], enabled: false };
        prompt.extra = { ...prompt.extra, destined_model: { id, part: parts[part] } };
        let index = preset.prompts.findIndex(item => item.id === source.id);
        const related = new Set(config.custom_models.filter(model => part !== 2 || model.tailMode === tailMode).map(model => model.ids[part]));
        while (related.has(preset.prompts[index + 1]?.id)) index++;
        preset.prompts.splice(index + 1, 0, prompt);
      }
      const sourceTail = ctx.requirePrompt(preset, sourceIds[2]);
      config.custom_models.push({ id, label, ids, tailMode, tailBaseline: { content: sourceTail.content, role: sourceTail.role } });
      if (bindingKey) {
        await ctx.loadProfiles(false);
        const matches = ctx.state.profiles.filter(profile => ctx.profileKey(profile) === bindingKey);
        ctx.assertData(matches.length === 1, '选择的连接已不存在或不唯一。');
        config.connection_link.bindings[id] = { id: matches[0].id, name: matches[0].name };
      } else config.connection_link.bindings[id] = null;
      ctx.assertData(current() && ctx.fingerprintPresetValue(getPreset('in_use')) === expected, '上下文或预设内容已变化，未新增模型。');
      await ctx.writeWorkspace(preset, config, current);
      ctx.state.modelDraft = { name: '', tailMode: 'no-prefill', binding: '' };
      return id;
    });
  }

  async function renameCustomModel(id, name) {
    ctx.assertData(ctx.state.editorUnlocked,'请先打开编辑模式');
    return ctx.runWorkspaceOperation('重命名模型', async current => {
      const next = ctx.clone(ctx.state.config);
      const model = next.custom_models.find(item => item.id === id);
      ctx.assertData(model, '自定义模型不存在');
      const previousLabel = model.label;
      model.label = ctx.validName(name, Object.entries(ctx.MODEL_ADAPTERS).map(([key, adapter]) => ({ id: key, name: adapter.label })), id);
      const preset = ctx.clone(getPreset('in_use'));
      const suffixes = ['头部', '思维链', model.tailMode === 'prefill' ? '预填充' : '非预填充'];
      model.ids.forEach((promptId, index) => {
        const prompt = ctx.requirePrompt(preset, promptId);
        const prefix = index === 1 ? '🧠 ' : '🔌 ';
        if (prompt.name === prefix + previousLabel + suffixes[index]) prompt.name = prefix + model.label + suffixes[index];
      });
      await ctx.writeWorkspace(preset, next, current);
    });
  }

  async function deleteCustomModel(id) {
    ctx.assertData(ctx.state.editorUnlocked,'请先打开编辑模式');
    return ctx.runWorkspaceOperation('删除模型', async current => {
      ctx.assertData(ctx.detectModelAdapter() !== id, '请先切换到其他模型，再删除当前模型。');
      const next = ctx.clone(ctx.state.config);
      const model = next.custom_models.find(item => item.id === id);
      ctx.assertData(model, '自定义模型不存在');
      ctx.assertData(!model.ids.some(promptId => ctx.getPrompt(ctx.state.preset, promptId)?.enabled), '该模型仍有启用条目，请先切换到其他模型。');
      const preset = ctx.clone(getPreset('in_use'));
      ctx.saveRecovery(current);
      next.configuration_library = ctx.clone(ctx.state.config.configuration_library);
      preset.prompts = preset.prompts.filter(prompt => !model.ids.includes(prompt.id));
      preset.prompts_unused = preset.prompts_unused.filter(prompt => !model.ids.includes(prompt.id));
      next.custom_models = next.custom_models.filter(item => item.id !== id);
      delete next.connection_link.bindings[id];
      await ctx.writeWorkspace(preset, next, current);
    });
  }

  async function setCustomTail(id, mode, replaceEdited = false) {
    ctx.assertData(ctx.state.editorUnlocked,'请先打开编辑模式');
    return ctx.runWorkspaceOperation('切换尾部类型', async current => {
      ctx.assertData(['prefill', 'no-prefill'].includes(mode), '尾部必须二选一');
      const next = ctx.clone(ctx.state.config);
      const model = next.custom_models.find(item => item.id === id);
      ctx.assertData(model, '自定义模型不存在');
      if (model.tailMode === mode) return;
      const preset = ctx.clone(getPreset('in_use'));
      const tail = ctx.requirePrompt(preset, model.ids[2]);
      const edited = tail.content !== model.tailBaseline.content || tail.role !== model.tailBaseline.role;
      ctx.assertData(!edited || replaceEdited, '尾部正文已修改，请确认替换后再切换。');
      const source = ctx.requirePrompt(preset, ctx.BUILTIN_MODEL_ADAPTERS.Gemini.tails[mode === 'prefill' ? 0 : 1]);
      ctx.saveRecovery(current);
      next.configuration_library = ctx.clone(ctx.state.config.configuration_library);
      tail.content = source.content;
      tail.role = source.role;
      tail.name = '🔌 ' + model.label + (mode === 'prefill' ? '预填充' : '非预填充');
      model.tailMode = mode;
      model.tailBaseline = { content: source.content, role: source.role };
      await ctx.writeWorkspace(preset, next, current);
    });
  }

  function updateWorkspaceUi() {
    if (!ctx.shadow) return;
    const editMode=ctx.shadow.querySelector('[data-action="edit-mode"]');
    if(editMode){editMode.checked=ctx.state.editorUnlocked;editMode.disabled=ctx.state.workspaceBusy||ctx.state.reorderSaving||!!ctx.state.promptEditor?.saving;}
    const slot = ctx.shadow.querySelector('.configuration-shortcut');
    if (slot) slot.innerHTML = renderConfigurationShortcut();
    for (const area of ctx.shadow.querySelectorAll('.panel-layout, .configuration-shortcut')) area.toggleAttribute('inert', ctx.state.workspaceBusy);
  }

  function configurationIsDirty() {
    const item = ctx.configLibrary().items.find(item => item.id === ctx.configLibrary().activeId);
    if (!item || !ctx.state.preset) return false;
    try { return JSON.stringify(ctx.captureConfiguration(ctx.state.preset, ctx.state.config, ctx.selectedScopes(ctx.validateSnapshot(item.snapshot)))) !== JSON.stringify(ctx.validateSnapshot(item.snapshot)); }
    catch { return true; }
  }

  function renderConfigurationShortcut() {
    const library = ctx.configLibrary();
    return '<label>当前配置 <select aria-label="切换配置" data-action="configuration-switch"><option value="">未命名的当前设置</option>'
      + library.items.map(item => '<option value="' + ctx.escapeHtml(item.id) + '" ' + (item.id === library.activeId ? 'selected' : '') + '>' + ctx.escapeHtml(item.name) + '</option>').join('')
      + '</select></label><span>' + (configurationIsDirty() ? '已修改' : '') + '</span>'
      + '<button type="button" class="text-button" data-action="tab" data-tab="configurations">配置管理</button>';
  }

  function configButton(action, label, id = '') {
    return '<button type="button" class="secondary-button" data-action="' + action + '" data-id="' + ctx.escapeHtml(id) + '">' + label + '</button>';
  }

  function scopeCheckboxes(kind, scopes) {
    return '<div class="configuration-actions" role="group" aria-label="' + (kind==='save'?'保存范围':'导出范围') + '"><strong>'+(kind==='save'?'保存范围':'导出范围')+'</strong>'
      + ['preset','summary'].map(key=>'<label><input type="checkbox" data-action="configuration-scope" data-kind="'+kind+'" data-key="'+key+'" '+(scopes[key]?'checked':'')+'>'+(key==='preset'?'预设配置':'总结配置')+'</label>').join('')+'</div>';
  }

  function renderConfigurationsTab() {
    if (ctx.state.config.configuration_error) return '<div class="warning">' + ctx.escapeHtml(ctx.state.config.configuration_error) + '</div>' + scopeCheckboxes('export',ctx.exportScopes) + configButton('configuration-raw', '导出可恢复配置');
    const library = ctx.configLibrary();
    return ctx.renderSectionHeader('配置管理', '按范围保存与切换。密钥、世界书和聊天记录不会导出。')
      + '<article class="card"><label class="field-label">新配置名称<input data-action="configuration-name" maxlength="100" value="' + ctx.escapeHtml(ctx.state.configurationName) + '"></label><div class="configuration-actions">'
      + scopeCheckboxes('save',ctx.configurationScopes) + configButton('configuration-save-new', '保存当前 / 另存为')
      + (library.activeId ? configButton('configuration-overwrite', '覆盖当前配置', library.activeId) : '') + '</div></article>'
      + scopeCheckboxes('export',ctx.exportScopes) + '<div class="configuration-actions">' + configButton('configuration-import', '导入 JSON') + configButton('configuration-export-all', '导出配置库')
      + (library.recovery ? configButton('configuration-recover', '恢复切换前设置') : '') + '</div>'
      + '<input type="file" accept=".json,application/json" data-action="configuration-file" hidden>'
      + (library.items.length ? library.items.map(item => '<article class="card configuration-row"><div><h4>' + ctx.escapeHtml(item.name)
        + (item.id === library.activeId ? ' · 当前' : '') + '</h4><p>' + ctx.escapeHtml(item.updatedAt) + ' · ' + (item.snapshot.preset ? item.snapshot.preset.prompts.length + ' 个发送条目' : '仅总结配置') + (item.snapshot.preset && item.snapshot.summary ? ' · 含总结配置' : '') + '</p></div><div class="configuration-actions">'
        + configButton('configuration-apply', '切换', item.id) + configButton('configuration-rename', '重命名', item.id)
        + configButton('configuration-export', '导出', item.id) + configButton('configuration-delete', '删除', item.id) + '</div></article>').join('')
        : '<p class="empty">还没有保存的配置。</p>');
  }

  function renderCustomModelControls() {
    if(!ctx.state.editorUnlocked)return '';
    const draft = ctx.state.modelDraft;
    return '<article class="card"><h4>新增自定义模型</h4><p>复制 Gemini 的头部、思维链和选中的一种尾部，共三个独立条目。</p>'
      + '<div class="field-grid"><label class="field-label">模型名称<input data-action="model-draft" data-field="name" maxlength="100" value="' + ctx.escapeHtml(draft.name) + '"></label>'
      + '<label class="field-label">尾部类型<select data-action="model-draft" data-field="tailMode"><option value="no-prefill" ' + (draft.tailMode === 'no-prefill' ? 'selected' : '') + '>非预填充</option><option value="prefill" ' + (draft.tailMode === 'prefill' ? 'selected' : '') + '>预填充</option></select></label>'
      + '<label class="field-label">酒馆连接配置<select data-action="model-draft" data-field="binding"><option value="">不绑定</option>'
      + ctx.state.profiles.map(profile => '<option value="' + ctx.escapeHtml(ctx.profileKey(profile)) + '" ' + (draft.binding === ctx.profileKey(profile) ? 'selected' : '') + '>' + ctx.escapeHtml(profile.name) + '</option>').join('')
      + '</select></label></div><div class="configuration-actions">' + configButton('model-add', '添加模型') + '</div></article>'
      + (ctx.state.config.custom_models ?? []).map(model => '<article class="card"><h4>' + ctx.escapeHtml(model.label) + '</h4><div class="configuration-actions">'
        + configButton('model-rename', '重命名', model.id) + configButton('model-delete', '删除', model.id)
        + model.ids.map((id, index) => configButton('prompt-open', ['头部', '思维链', '尾部'][index], id)).join('')
        + '</div><label class="field-label">尾部类型<select data-action="custom-tail" data-model="' + ctx.escapeHtml(model.id) + '"><option value="no-prefill" ' + (model.tailMode === 'no-prefill' ? 'selected' : '') + '>非预填充</option><option value="prefill" ' + (model.tailMode === 'prefill' ? 'selected' : '') + '>预填充</option></select></label></article>').join('');
  }

  async function handleConfigurationAction(action, target) {
    const id = target.dataset.id;
    if (action === 'configuration-save-new') return ctx.saveNamedConfiguration(ctx.state.configurationName);
    if (action === 'configuration-overwrite') {
      if (await ctx.dialogs.confirm('用当前设置覆盖这份命名配置？')) return ctx.saveNamedConfiguration('', id);
    }
    if (action === 'configuration-apply') return ctx.applyConfiguration(id);
    if (action === 'configuration-recover') return ctx.applyConfiguration('__recovery__');
    if (action === 'configuration-rename') {
      const item = ctx.configLibrary().items.find(item => item.id === id);
      const name = await ctx.dialogs.prompt('配置名称', item?.name ?? '');
      if (name !== null) return ctx.renameConfiguration(id, name);
    }
    if (action === 'configuration-delete' && await ctx.dialogs.confirm('删除这份命名配置？当前设置不会被删除。')) return ctx.deleteConfiguration(id);
    if (action === 'configuration-export') {
      const item = ctx.configLibrary().items.find(item => item.id === id);
      ctx.downloadConfiguration(ctx.exportConfigurations(id), item?.name ?? '命定配置');
    }
    if (action === 'configuration-export-all') ctx.downloadConfiguration(ctx.exportConfigurations(), '命定配置库');
    if (action === 'configuration-raw') ctx.downloadConfiguration(ctx.exportRecoverableConfigurations(), '命定配置恢复备份');
    if (action === 'configuration-import') ctx.shadow.querySelector('[data-action="configuration-file"]')?.click();
    if (action === 'model-add') return addCustomModel(ctx.state.modelDraft.name, ctx.state.modelDraft.tailMode, ctx.state.modelDraft.binding);
    if (action === 'model-rename') {
      const name = await ctx.dialogs.prompt('模型名称', ctx.MODEL_ADAPTERS[id]?.label ?? '');
      if (name !== null) return renameCustomModel(id, name);
    }
    if (action === 'model-delete' && await ctx.dialogs.confirm('删除该模型及其三个条目？已保存的配置保持不变。')) return deleteCustomModel(id);
  }

  return {
    addCustomModel,
    renameCustomModel,
    deleteCustomModel,
    setCustomTail,
    updateWorkspaceUi,
    configurationIsDirty,
    renderConfigurationShortcut,
    configButton,
    scopeCheckboxes,
    renderConfigurationsTab,
    renderCustomModelControls,
    handleConfigurationAction
  };
}
