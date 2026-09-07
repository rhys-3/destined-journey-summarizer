// These structural markers are consumed by the preset's message processor.
// They must survive both assistant macro passes until that processor runs.
const MESSAGE_PROCESSING_MARKERS = new Set([
  '正文开始', '历史开始', '深度900分界', '深度2分界', '历史结束', '正文结束',
  '记忆区', '参考区', '运行规则区',
].map(name => `<|命定_${name}|>`));

// Dependencies use live accessors so asynchronous operations share the current state.
export function createManaged(ctx) {
  function countOccurrences(content, token) {
    return String(content ?? '').split(token).length - 1;
  }

  function hasManagedMacro(promptId, token, minimum = 1, preset = ctx.state.preset) {
    const prompt = ctx.getPrompt(preset, promptId);
    return countOccurrences(prompt?.content, token) >= minimum;
  }

  function narrationRequirement(person = ctx.state.config.managed_values.narration_person) {
    return {
      first: '必须以第一人称有限视角创作正文',
      second: '必须以第二人称有限视角创作正文',
      third: '必须以第三人称有限视角创作正文',
    }[person] ?? '必须以第三人称有限视角创作正文';
  }

  function managedMacroValues() {
    const values = ctx.sanitizeManagedValues(ctx.state.config.managed_values);
    return {
      字数: values.min_hanzi,
      对白比例: values.dialogue_ratio,
      对白轮次: values.dialogue_round_trips,
      战斗回合: values.combat_rounds,
      人称: values.narration_person,
      人称要求: narrationRequirement(values.narration_person),
      正文语言: values.body_language,
      思维链语言: values.thinking_language,
      全局偏好: values.global_preference,
    };
  }

  function expandManagedMacros(content, reportUnknown = false) {
    const values = managedMacroValues();
    let expanded = String(content ?? '').replace(ctx.MANAGED_MACRO_PATTERN, (_whole, key) => values[key]);
    const residualPattern = new RegExp(ctx.MANAGED_MACRO_PATTERN.source, 'gu');
    const residual = expanded.match(residualPattern);
    if (residual?.length) {
      expanded = expanded.replace(new RegExp(ctx.MANAGED_MACRO_PATTERN.source, 'gu'), '');
      if (reportUnknown) {
        console.error(`[${ctx.SCRIPT_NAME}] 宏展开结果中仍有残留，已移除。`, residual);
        toastr.error('检测到短宏递归残留，已阻止其发送。', ctx.BUTTON_NAME);
      }
    }
    const unknown = new Set();
    expanded = expanded.replace(ctx.UNKNOWN_DESTINED_MACRO_PATTERN, token => {
      if (MESSAGE_PROCESSING_MARKERS.has(token)) return token;
      unknown.add(token);
      return '';
    });
    if (unknown.size && reportUnknown) {
      const names = [...unknown].join('、');
      console.error(`[${ctx.SCRIPT_NAME}] 已移除未知命定宏：${names}`);
      toastr.error(`检测到未知命定宏，已阻止其发送：${names}`, ctx.BUTTON_NAME);
    }
    return expanded;
  }

  function readGlobalPreference() {
    return {
      ok: hasManagedMacro(ctx.IDS.globalPreference, ctx.MANAGED_MACROS.globalPreference),
      value: ctx.state.config.managed_values.global_preference,
    };
  }

  function setGlobalPreference(value) {
    ctx.state.config.managed_values.global_preference = String(value ?? '').replace(/\r\n?/gu, '\n');
    return ctx.enqueueScriptConfigSave('全局偏好', 'global-preference');
  }

  function buildUserAdditionalContent(value) {
    const normalized = String(value ?? '').replace(/\r\n?/gu, '\n');
    return `${ctx.USER_ADDITIONAL_OPEN}\n${normalized}${normalized ? '\n' : ''}${ctx.USER_ADDITIONAL_CLOSE}${ctx.USER_ADDITIONAL_TRIM}`;
  }

  function readUserAdditionalSetting(preset = ctx.state.preset) {
    const prompt = ctx.getPrompt(preset, ctx.IDS.userAdditional);
    if (!prompt) return { ok: false, value: '', error: '找不到“用户附加设定”条目。' };
    const content = String(prompt.content ?? '').replace(/\r\n?/gu, '\n');
    const expression = /^\s*\{\{#setvar 用户设定\}\}\n?([\s\S]*?)\n?\{\{\/setvar\}\}(?:\{\{trim\}\})?\s*$/u;
    const match = content.match(expression);
    if (!match
      || countOccurrences(content, ctx.USER_ADDITIONAL_OPEN) !== 1
      || countOccurrences(content, ctx.USER_ADDITIONAL_CLOSE) !== 1) {
      return { ok: false, value: '', error: '用户附加设定的受管包装缺失或格式异常，已停止写入。' };
    }
    return { ok: true, value: match[1], error: '' };
  }

  function setUserAdditionalSetting(value) {
    const normalized = String(value ?? '').replace(/\r\n?/gu, '\n');
    if (normalized.includes('{{/setvar}}')) {
      return Promise.reject(new Error('用户附加设定不能包含 {{/setvar}}，否则会截断受管区域。'));
    }
    if (!readUserAdditionalSetting().ok) {
      return Promise.reject(new Error('用户附加设定的受管包装缺失或格式异常，请先恢复默认。'));
    }
    return ctx.queuePresetMutation('用户附加设定', preset => {
      const prompt = ctx.requirePrompt(preset, ctx.IDS.userAdditional);
      if (!readUserAdditionalSetting(preset).ok) throw new Error('用户附加设定的受管包装缺失或格式异常，请先恢复默认。');
      prompt.content = buildUserAdditionalContent(normalized);
    }, 'user-additional-setting');
  }

  function resetUserAdditionalSetting() {
    const pending = ctx.debounceTimers.get('user-additional-setting');
    if (pending) {
      clearTimeout(pending.timer);
      pending.resolve({ superseded: true });
      ctx.debounceTimers.delete('user-additional-setting');
    }
    return ctx.queuePresetMutation('恢复用户附加设定', preset => {
      ctx.requirePrompt(preset, ctx.IDS.userAdditional).content = buildUserAdditionalContent(ctx.USER_ADDITIONAL_DEFAULT);
    });
  }

  function languagePromptIds(key, preset = ctx.state.preset) {
    if (key === 'body') return [ctx.IDS.outputLength];
    if (key !== 'thinking') return [];
    return [...new Set(Object.values(ctx.MODEL_ADAPTERS).map(adapter => adapter.ids?.[1]))]
      .filter(id => id && ctx.getPrompt(preset, id));
  }

  function hasLanguageMacro(key, preset = ctx.state.preset) {
    const definition = ctx.LANGUAGE_DEFINITIONS[key];
    const ids = languagePromptIds(key, preset);
    if (!definition || ids.length === 0) return false;
    if (key === 'body') return hasManagedMacro(ids[0], definition.macro, 1, preset);
    const current = ctx.detectModelAdapter(preset);
    const currentId = current ? ctx.MODEL_ADAPTERS[current]?.ids?.[1] : '';
    return currentId
      ? hasManagedMacro(currentId, definition.macro, 1, preset)
      : ids.some(id => hasManagedMacro(id, definition.macro, 1, preset));
  }

  function readLanguageField(key) {
    const definition = ctx.LANGUAGE_DEFINITIONS[key];
    if (!definition || !hasLanguageMacro(key)) return { ok: false, value: '' };
    return { ok: true, value: ctx.sanitizeLanguageSetting(ctx.state.config.managed_values[definition.configKey]) };
  }

  function setLanguageField(key, rawValue) {
    const definition = ctx.LANGUAGE_DEFINITIONS[key];
    if (!definition) return Promise.reject(new Error('不支持的语言设置。'));
    const value = String(rawValue ?? '').trim();
    if (!value) return Promise.reject(new Error(`${definition.label}不能为空。`));
    if (value.length > 80) return Promise.reject(new Error(`${definition.label}不能超过 80 个字符。`));
    if (/[\u0000-\u001f\u007f<>{}]/u.test(value)) return Promise.reject(new Error(`${definition.label}不能包含换行、控制字符、尖括号或花括号。`));
    if (!hasLanguageMacro(key)) return Promise.reject(new Error(`${definition.label}对应的短宏缺失或格式异常。`));
    ctx.state.config.managed_values[definition.configKey] = value;
    return ctx.enqueueScriptConfigSave(definition.label, `language:${key}`);
  }

  function readNumericField(key) {
    const definition = ctx.FIELD_DEFINITIONS[key];
    if (!hasManagedMacro(definition.promptId, definition.macro, definition.minimumOccurrences)) {
      return { ok: false, value: '' };
    }
    const value = String(ctx.state.config.managed_values[definition.configKey] ?? '').trim();
    return /^-?\d+$/u.test(value) ? { ok: true, value } : { ok: false, value: '' };
  }

  function setNumericField(key, rawValue) {
    const definition = ctx.FIELD_DEFINITIONS[key];
    const value = String(rawValue ?? '').trim();
    if (!/^-?\d+$/u.test(value)) {
      return Promise.reject(new Error(`${definition.label}必须是有效整数。`));
    }
    if (!hasManagedMacro(definition.promptId, definition.macro, definition.minimumOccurrences)) {
      return Promise.reject(new Error(`${definition.label}对应的短宏缺失或格式异常。`));
    }
    ctx.state.config.managed_values[definition.configKey] = value;
    return ctx.enqueueScriptConfigSave(definition.label, `field:${key}`);
  }

  function setNarrationPerson(person) {
    if (!['first', 'second', 'third'].includes(person)) return ctx.showErrorToast(new Error('不支持的叙事人称。'));
    if (!hasManagedMacro(ctx.IDS.narration, ctx.MANAGED_MACROS.narrationPerson)
      || !hasManagedMacro(ctx.IDS.narration, ctx.MANAGED_MACROS.narrationRequirement)) {
      return ctx.showErrorToast(new Error('叙事人称短宏缺失或格式异常。'));
    }
    ctx.state.config.managed_values.narration_person = person;
    const task = ctx.enqueueScriptConfigSave('叙事人称');
    for (const button of ctx.shadow.querySelectorAll('[data-action="person"]')) {
      button.classList.toggle('selected', button.dataset.value === person);
    }
    task.catch(ctx.showErrorToast);
  }

  function extractLegacyAttribute(preset, promptId, tag, attribute) {
    const prompt = ctx.getPrompt(preset, promptId);
    const openings = String(prompt?.content ?? '').match(new RegExp(`<${tag}\\b[^>]*>`, 'giu')) ?? [];
    if (openings.length !== 1) return null;
    const matches = openings[0].match(new RegExp(`\\b${attribute}="([^"]*)"`, 'giu')) ?? [];
    if (matches.length !== 1) return null;
    return matches[0].slice(matches[0].indexOf('="') + 2, -1);
  }

  function readLegacyManagedValues(preset) {
    const values = {};
    const minHanzi = extractLegacyAttribute(preset, ctx.IDS.outputLength, 'length_control', 'min_hanzi');
    const dialogueRatio = extractLegacyAttribute(preset, ctx.IDS.dialogue, 'dialogue', 'target_ratio')?.replace(/%$/u, '');
    const dialogueRounds = extractLegacyAttribute(preset, ctx.IDS.dialogue, 'dialogue', 'min_round_trips');
    const combatRounds = extractLegacyAttribute(preset, ctx.IDS.outputLength, 'combat_pacing', 'max_rounds_per_response');
    const narrationPerson = extractLegacyAttribute(preset, ctx.IDS.narration, 'narration', 'person');
    if (/^-?\d+$/u.test(minHanzi ?? '')) values.min_hanzi = minHanzi;
    if (/^-?\d+$/u.test(dialogueRatio ?? '')) values.dialogue_ratio = dialogueRatio;
    if (/^-?\d+$/u.test(dialogueRounds ?? '')) values.dialogue_round_trips = dialogueRounds;
    if (/^-?\d+$/u.test(combatRounds ?? '')) values.combat_rounds = combatRounds;
    if (['first', 'second', 'third'].includes(narrationPerson)) values.narration_person = narrationPerson;

    const preference = ctx.getPrompt(preset, ctx.IDS.globalPreference);
    const match = String(preference?.content ?? '').match(/<VOID_likes\b[^>]*>([\s\S]*?)<\/VOID_likes>/iu);
    if (match && !match[1].includes(ctx.MANAGED_MACROS.globalPreference)) {
      let content = match[1].replace(/\r\n?/gu, '\n');
      if (content.startsWith('\n')) content = content.slice(1);
      if (content.endsWith('\n')) content = content.slice(0, -1);
      values.global_preference = content;
    }
    return values;
  }

  function replaceTagAttribute(content, tag, attribute, value) {
    const openingExpression = new RegExp(`<${tag}\\b[^>]*>`, 'iu');
    const opening = String(content ?? '').match(openingExpression)?.[0];
    if (!opening) throw new Error(`找不到迁移标签：${tag}`);
    const attributeExpression = new RegExp(`\\b${attribute}="[^"]*"`, 'iu');
    if (!attributeExpression.test(opening)) throw new Error(`找不到迁移属性：${tag}.${attribute}`);
    const nextOpening = opening.replace(attributeExpression, `${attribute}="${value}"`);
    return String(content).replace(opening, nextOpening);
  }

  function migrateManagedPromptContent(promptId, content) {
    let next = String(content ?? '');
    if (promptId === ctx.IDS.dialogue) {
      next = next.replace(/\sdata-destined-ui="dialogue"/gu, '');
      if (!next.includes(ctx.MANAGED_MACROS.dialogueRounds)) next = replaceTagAttribute(next, 'dialogue', 'min_round_trips', ctx.MANAGED_MACROS.dialogueRounds);
      if (!next.includes(ctx.MANAGED_MACROS.dialogueRatio)) next = replaceTagAttribute(next, 'dialogue', 'target_ratio', `${ctx.MANAGED_MACROS.dialogueRatio}%`);
      next = next.replace('不低于`min_round_trips`所指定轮数', `不低于${ctx.MANAGED_MACROS.dialogueRounds}轮`);
      next = next.replace('对白约占普通叙事与对白的比例遵循`target_ratio`', `对白约占普通叙事与对白的${ctx.MANAGED_MACROS.dialogueRatio}%`);
      return next;
    }
    if (promptId === ctx.IDS.outputLength) {
      next = next.replace(/\sdata-destined-ui="output"/gu, '');
      next = next.replace(/(<length_control\b[^>]*?)\bmin_hanzi=/iu, '$1min_characters=');
      if (!next.includes(ctx.MANAGED_MACROS.hanzi)) next = replaceTagAttribute(next, 'length_control', 'min_characters', ctx.MANAGED_MACROS.hanzi);
      if (!next.includes(ctx.MANAGED_MACROS.combatRounds)) next = replaceTagAttribute(next, 'combat_pacing', 'max_rounds_per_response', ctx.MANAGED_MACROS.combatRounds);
      next = next.replace('本次推进回合数不得超过`max_rounds_per_response`；', `本次推进回合数不得超过${ctx.MANAGED_MACROS.combatRounds}回合；`);
      next = next.replace(/<language\b[^>]*>\s*正文使用简体中文。\s*<\/language>/iu, `<language target="recorder_body">正文、对白与正文内面板使用${ctx.MANAGED_MACROS.bodyLanguage}；角色专名、原文引用和代码可按语境保留原语言。</language>`);
      return next;
    }
    if (Object.values(ctx.MODEL_ADAPTERS).some(adapter => adapter.ids?.[1] === promptId)) {
      next = next.replace(/Language：(?:中文|简体中文)/gu, `Language：${ctx.MANAGED_MACROS.thinkingLanguage}`);
      next = next.replace(/Audit Header: (?:中文|简体中文) \|/gu, `Audit Header: ${ctx.MANAGED_MACROS.thinkingLanguage} |`);
      return next;
    }
    if (promptId === ctx.IDS.narration) {
      next = next.replace(/\sdata-destined-ui="narration"/gu, '');
      next = next.replace(/(<narration\b[^>]*>)(?:必须以第一人称有限视角创作正文|必须以第二人称有限视角创作正文|必须以第三人称有限视角创作正文)(<\/narration>)/iu, `$1${ctx.MANAGED_MACROS.narrationRequirement}$2`);
      if (!next.includes(ctx.MANAGED_MACROS.narrationPerson)) next = replaceTagAttribute(next, 'narration', 'person', ctx.MANAGED_MACROS.narrationPerson);
      return next;
    }
    if (promptId === ctx.IDS.globalPreference) {
      next = next.replace(/\sdata-destined-ui="global-preference"/gu, '');
      const expression = /(<VOID_likes\b[^>]*>)[\s\S]*?(<\/VOID_likes>)/iu;
      if (!expression.test(next)) throw new Error('全局偏好标签格式异常。');
      return next.replace(expression, `$1\n${ctx.MANAGED_MACROS.globalPreference}\n$2`);
    }
    return next;
  }

  function needsManagedPromptMigration(preset) {
    if (ctx.state.config.managed_values_version !== ctx.MANAGED_VALUES_VERSION) return true;
    return [ctx.IDS.dialogue, ctx.IDS.outputLength, ctx.IDS.narration, ctx.IDS.globalPreference, ...languagePromptIds('thinking', preset)]
      .some(id => String(ctx.getPrompt(preset, id)?.content ?? '').includes('data-destined-ui='));
  }

  async function initializeManagedSettings() {
    if (!ctx.state.preset || !needsManagedPromptMigration(ctx.state.preset)) return;
    const legacyValues = readLegacyManagedValues(ctx.state.preset);
    ctx.state.config.managed_values = ctx.sanitizeManagedValues({
      ...ctx.state.config.managed_values,
      ...(ctx.state.config.managed_values_version === ctx.MANAGED_VALUES_VERSION ? {} : legacyValues),
    });
    ctx.state.config.managed_values_version = ctx.MANAGED_VALUES_VERSION;
    await ctx.enqueueScriptConfigSave('迁移预设设置');
    await ctx.queuePresetMutation('迁移命定短宏', preset => {
      for (const id of [ctx.IDS.dialogue, ctx.IDS.outputLength, ctx.IDS.narration, ctx.IDS.globalPreference, ...languagePromptIds('thinking', preset)]) {
        const prompt = ctx.getPrompt(preset, id);
        if (!prompt) continue;
        prompt.content = migrateManagedPromptContent(id, prompt.content);
      }
    });
  }

  function registerManagedMacros() {
    try {
      const registration = registerMacroLike(
        new RegExp(ctx.MANAGED_MACRO_PATTERN.source, 'gu'),
        (_context, _substring, key) => managedMacroValues()[key],
      );
      if (registration) ctx.macroStops.push(registration);
    } catch (error) {
      console.error(`[${ctx.SCRIPT_NAME}] 注册短宏失败，将使用请求阶段保护。`, error);
      toastr.error('短宏注册失败，已启用请求阶段保护。', ctx.BUTTON_NAME);
    }
  }

  function expandOutgoingMessages(messages) {
    if (!Array.isArray(messages)) return;
    for (const message of messages) {
      if (typeof message?.content === 'string') {
        message.content = expandManagedMacros(message.content, true);
        continue;
      }
      if (!Array.isArray(message?.content)) continue;
      for (const part of message.content) {
        if (part?.type === 'text' && typeof part.text === 'string') {
          part.text = expandManagedMacros(part.text, true);
        }
      }
    }
  }

  function togglePrompt(id, enabled) {
    if (ctx.PROTECTED_IDS.has(id)) return ctx.showErrorToast(new Error('这是必需核心条目，不能从预设设置中关闭。'));
    if (ctx.MODEL_IDS.has(id)) {
      ctx.state.activeTab = 'tools';
      ctx.render();
      return toastr.info('模型相关条目请从“模型”页原子切换。', ctx.BUTTON_NAME);
    }
    const current = ctx.getPrompt(ctx.state.preset, id);
    if (!current) return;
    const groupId = ctx.getPromptGroupId(current);
    if (groupId) return enabled ? ctx.applyGroup(groupId, id) : ctx.authorLayout().blocks.find(b => b.id === groupId)?.allowNone ? ctx.applyGroup(groupId, '') : ctx.showErrorToast(new Error('互斥组选项不能单独关闭，请选择同组的另一个选项。'));
    ctx.queuePresetMutation(ctx.normalizeName(current.name), preset => {
      ctx.requirePrompt(preset, id).enabled = enabled;
    }).catch(ctx.showErrorToast);
  }

  function isUserCreatedGroupPrompt(prompt, groupId = '') {
    const meta = prompt?.extra?.destined_ui;
    return (meta?.created_by === ctx.SCRIPT_ID || meta?.created_by === 'destined-author' || (typeof meta?.created_by === 'string' && meta.created_by.length > 0 && meta?.version === 1))
      && meta.group in ctx.USER_CREATABLE_GROUPS
      && (!groupId || meta.group === groupId);
  }

  function groupPromptTitle(prompt, groupId = ctx.getPromptGroupId(prompt)) {
    const title = ctx.normalizeName(prompt?.name);
    const label = ctx.USER_CREATABLE_GROUPS[groupId]?.label;
    return label ? title.replace(new RegExp(`^${label}\\s*[｜|]\\s*`, 'u'), '').trim() : title;
  }

  function buildStylePromptContent(groupId, value) {
    const definition = ctx.USER_CREATABLE_GROUPS[groupId];
    if (!definition) throw new Error('该分组没有可用的文风标签。');
    const normalized = String(value ?? '').replace(/\r\n?/gu, '\n');
    return `<${definition.tag}>\n${normalized}${normalized.endsWith('\n') ? '' : '\n'}</${definition.tag}>{{trim}}`;
  }

  function readStylePromptContent(prompt, groupId = ctx.getPromptGroupId(prompt)) {
    const definition = ctx.USER_CREATABLE_GROUPS[groupId];
    if (!definition) return { ok: false, migratable: false, value: '', error: '该条目不属于可编辑的基调或主文风。' };
    const content = String(prompt?.content ?? '').replace(/\r\n?/gu, '\n');
    const escapedTag = definition.tag.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const expression = new RegExp(`^\\s*<${escapedTag}>\\n?([\\s\\S]*?)\\n?<\\/${escapedTag}>\\{\\{trim\\}\\}\\s*$`, 'u');
    const match = content.match(expression);
    if (match) return { ok: true, migratable: false, value: match[1], error: '' };

    if (groupId === 'base-tone') {
      const legacy = content.match(/^\s*<base_writing_guidance>\n?([\s\S]*?)\n?<\/base_writing_guidance>\s*(?:<Writing_style>)?\s*$/u);
      if (legacy) return { ok: false, migratable: true, value: legacy[1], error: '' };
    }
    if (/<\/?(?:base_tone|main_writing_style|base_writing_guidance|Writing_style)\b/iu.test(content)) {
      return { ok: false, migratable: false, value: '', error: `${definition.label}的 XML 包装缺失或格式异常。` };
    }
    return { ok: false, migratable: true, value: content, error: '' };
  }

  async function initializeStyleStructures() {
    if (!ctx.state.preset || ctx.state.config.style_structure_version >= ctx.STYLE_STRUCTURE_VERSION) return;
    const migratableIds = [];
    const malformedNames = [];
    for (const prompt of ctx.state.preset.prompts ?? []) {
      if (!isUserCreatedGroupPrompt(prompt)) continue;
      const result = readStylePromptContent(prompt);
      if (result.migratable) migratableIds.push(prompt.id);
      else if (!result.ok) malformedNames.push(prompt.name);
    }
    if (migratableIds.length > 0) {
      await ctx.queuePresetMutation('迁移自建文风标签', preset => {
        for (const id of migratableIds) {
          const prompt = ctx.requirePrompt(preset, id);
          const groupId = ctx.getPromptGroupId(prompt);
          const result = readStylePromptContent(prompt, groupId);
          if (!result.migratable) throw new Error(`无法安全迁移自建${ctx.USER_CREATABLE_GROUPS[groupId]?.label ?? '文风'}：${prompt.name}`);
          prompt.content = buildStylePromptContent(groupId, result.value);
        }
      });
    }
    ctx.state.config.style_structure_version = ctx.STYLE_STRUCTURE_VERSION;
    await ctx.enqueueScriptConfigSave('文风标签结构已更新');
    if (malformedNames.length > 0) {
      toastr.warning(`以下自建条目的 XML 包装异常，未自动改写：${malformedNames.join('、')}`, ctx.BUTTON_NAME);
    }
  }

  function createPromptId() {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/gu, character => {
      const random = Math.floor(Math.random() * 16);
      const value = character === 'x' ? random : (random & 0x3) | 0x8;
      return value.toString(16);
    });
  }

  return {
    countOccurrences,
    hasManagedMacro,
    narrationRequirement,
    managedMacroValues,
    expandManagedMacros,
    readGlobalPreference,
    setGlobalPreference,
    buildUserAdditionalContent,
    readUserAdditionalSetting,
    setUserAdditionalSetting,
    resetUserAdditionalSetting,
    languagePromptIds,
    hasLanguageMacro,
    readLanguageField,
    setLanguageField,
    readNumericField,
    setNumericField,
    setNarrationPerson,
    extractLegacyAttribute,
    readLegacyManagedValues,
    replaceTagAttribute,
    migrateManagedPromptContent,
    needsManagedPromptMigration,
    initializeManagedSettings,
    registerManagedMacros,
    expandOutgoingMessages,
    togglePrompt,
    isUserCreatedGroupPrompt,
    groupPromptTitle,
    buildStylePromptContent,
    readStylePromptContent,
    initializeStyleStructures,
    createPromptId
  };
}
