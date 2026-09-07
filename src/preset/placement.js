// Dependencies use live accessors so asynchronous operations share the current state.
export function createPlacement(ctx) {
  function defaultAuthorLayout() {
    const pages = [['daily', '日常调整'], ['style', '文风与偏好'], ['tools', '模型与工具']].map(([id, label], order) => ({ id, label, order, hidden: false }));
    const definitions = [
      ['variable', 'daily', '变量处理模式', 'builtin'], ['reply', 'daily', '回复篇幅与对话', 'builtin'],
      ['plot-pace', 'daily', '剧情推进', 'single'], ['person', 'daily', '叙事人称', 'builtin'],
      ['actor-control', 'daily', '抢话控制', 'single'], ['retelling', 'daily', '输入转述', 'single'],
      ['ending', 'daily', '结尾方式', 'single'], ['narrative-extra', 'daily', '叙事增强', 'toggles'],
      ['event-chain', 'daily', '配合世界书事件链', 'builtin'], ['after-body', 'daily', '正文后附加内容', 'toggles'],
      ['base-tone', 'style', '基调', 'single'], ['main-style', 'style', '主文风', 'single'],
      ['style-extra', 'style', '风格增强', 'toggles'], ['beautify', 'style', '美化', 'toggles'],
      ['preference', 'style', '长期叙事偏好', 'builtin'], ['user-additional', 'style', '用户附加设定', 'builtin'],
      ['adult-mode', 'style', '成人内容适配', 'single'], ['content-extra', 'style', '内容偏好与表达约束', 'toggles'],
      ['models', 'tools', '模型与连接', 'builtin'], ['streaming', 'tools', '流式输出', 'builtin'],
      ['helpers', 'tools', '回复辅助', 'toggles'], ['cache', 'tools', '重置命中缓存', 'builtin'],
      ['entry-points', 'tools', '设置入口', 'builtin'], ['unclassified', 'tools', '未分类条目', 'toggles'],
    ];
    return {
    version: 1,
    pages,
    blocks: definitions.map(([id,
    page,
    label,
    kind],
    order) => ({ id,
    page,
    label,
    kind,
    order,
    hidden: false,
    allowNone: false,
    defaultId: ctx.DEFAULT_GROUP_OPTION_IDS[id] ?? '' })),
    trash: []
  };
  }

  function validateAuthorLayout(value) {
    ctx.assertData(ctx.plainObject(value) && value.version === 1, '不支持的作者布局版本');
    ctx.assertData(Array.isArray(value.pages) && value.pages.length <= 40 && Array.isArray(value.blocks) && value.blocks.length <= 200, '页面或板块数量无效');
    const base = defaultAuthorLayout();
    const ids = new Set();
    const text = (v, max = 100) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
    const common = item => {
      ctx.assertData(ctx.plainObject(item) && text(item.id) && /^[a-zA-Z0-9:_-]+$/u.test(item.id) && !['__proto__','constructor','prototype','advanced','author','configurations','settings','hidden'].includes(item.id) && !ids.has(item.id), '页面或板块 ID 无效或重复');
      ids.add(item.id);
      ctx.assertData(text(item.label) && Number.isFinite(item.order) && typeof item.hidden === 'boolean', '页面或板块名称、顺序或隐藏状态无效');
      return { id: item.id, label: item.label.trim(), order: item.order, hidden: item.hidden };
    };
    const pages = value.pages.map(common);
    ctx.assertData(pages.some(p => !p.hidden), '至少保留一个可见页面');
    // Separate namespaces allow a page and a block to share a legacy identifier.
    ids.clear();
    const blocks = value.blocks.map(item => {
      const result = common(item);
      ctx.assertData(pages.some(p => p.id === item.page) && ['builtin','toggles','single'].includes(item.kind), '板块页面或类型无效');
      const original = base.blocks.find(b => b.id === item.id);
      ctx.assertData(item.kind !== 'builtin' || original?.kind === 'builtin', '不能创建未知的专用控件');
      ctx.assertData(!original || original.kind === item.kind, '不能改变内置板块类型');
      ctx.assertData(typeof item.allowNone === 'boolean' && typeof item.defaultId === 'string', '单选组设置无效');
      return { ...result, page: item.page, kind: item.kind, allowNone: item.allowNone, defaultId: item.defaultId };
    });
    for (const block of base.blocks) ctx.assertData(blocks.some(b => b.id === block.id), '内置板块可以隐藏，不能删除：' + block.label);
    ctx.assertData(Array.isArray(value.trash ?? []) && (value.trash ?? []).length <= 100, '回收站最多保留 100 项，请先清理或导出');
    const trashIds = new Set();
    const trash = (value.trash ?? []).map(item => {
      ctx.assertData(ctx.plainObject(item) && typeof item.included === 'boolean' && Number.isSafeInteger(item.ordinal) && item.ordinal >= 1 && typeof item.deletedAt === 'string', '回收站记录无效');
      const prompt = ctx.snapshotPrompt(item.prompt);
      ctx.assertData(!trashIds.has(prompt.id), '回收站包含重复条目'); trashIds.add(prompt.id);
      return { prompt, included: item.included, ordinal: item.ordinal, deletedAt: item.deletedAt };
    });
    return { version: 1, pages, blocks, trash };
  }

  function authorLayout(preset = ctx.state.preset) {
    try { return preset?.extensions?.destined_author ? validateAuthorLayout(preset.extensions.destined_author) : defaultAuthorLayout(); }
    catch { return defaultAuthorLayout(); } // Read-only fallback; mutations below reject malformed source data.
  }

  function authorDependency(prompt) {
    if (!prompt) return '';
    if (ctx.PROTECTED_IDS.has(prompt.id)) return '基础结构依赖：必须保留并启用，可编辑正文；动态占位符正文由酒馆填入。';
    if (Object.values(ctx.BUILTIN_MODEL_ADAPTERS).some(a => [...a.ids, ...a.tails].includes(prompt.id))) return '内置模型适配依赖：通过模型控件切换，不能单独删除。';
    if (ctx.MODEL_IDS?.has(prompt.id)) return '自定义模型依赖：请在模型与工具中删除整套模型。';
    if (ctx.GROUPS['variable-mode'].options.some(([id]) => id === prompt.id)) return '世界书变量联动依赖：通过变量模式控件切换。';
    if ([ctx.IDS.dialogue, ctx.IDS.outputLength, ctx.IDS.narration, ctx.IDS.globalPreference, ctx.IDS.userAdditional].includes(prompt.id)) return '数值或文本控件依赖：请保留条目与受管短宏；可以调整显示位置或不显示。';
    if (['main','nsfw','jailbreak','enhanceDefinitions'].includes(prompt.id)) return '酒馆内置条目：可编辑，不能在这里删除。';
    return '';
  }

  function legacyAuthorBlock(prompt) {
    if (ctx.PROTECTED_IDS.has(prompt.id)) return 'hidden';
    if (ctx.MODEL_IDS.has(prompt.id)) return 'models';
    if (ctx.ID_TO_GROUP.has(prompt.id)) return ctx.ID_TO_GROUP.get(prompt.id) === 'variable-mode' ? 'variable' : ctx.ID_TO_GROUP.get(prompt.id);
    const special = { [ctx.IDS.dialogue]: 'reply', [ctx.IDS.outputLength]: 'reply', [ctx.IDS.narration]: 'person', [ctx.IDS.globalPreference]: 'preference', [ctx.IDS.userAdditional]: 'user-additional', [ctx.IDS.eventChain]: 'event-chain', [ctx.IDS.resetCache]: 'cache' };
    if (special[prompt.id]) return special[prompt.id];
    if (ctx.AFTER_BODY_IDS.includes(prompt.id)) return 'after-body';
    if (ctx.BEAUTIFY_IDS.includes(prompt.id)) return 'beautify';
    for (const [section, list] of Object.entries(ctx.CURATED_TOGGLES)) if (list.includes(prompt.id)) return { narrative:'narrative-extra', style:'style-extra', content:'content-extra', system:'helpers' }[section];
    const meta = ctx.inferPromptMeta(prompt);
    if (meta.control === 'single-option' && Object.hasOwn(ctx.GROUPS, meta.group) && meta.group !== 'variable-mode') return meta.group;
    return 'unclassified';
  }

  function placementEntry(prompt, preset = ctx.state.preset) {
    const meta = prompt?.extra?.destined_ui;
    let original = prompt ? legacyAuthorBlock(prompt) : 'unclassified';
    if(prompt&&original==='unclassified')original=inferNativePlacement(prompt,preset).block;
    let block = [2,3].includes(meta?.version) ? meta.block : original;
    if (block !== 'hidden' && !authorLayout(preset).blocks.some(b=>b.id===block)) block='unclassified';
    return {
    block,
    order: Number.isFinite(meta?.order) && [2,3].includes(meta.version) ? meta.order : 1000,
    label: typeof meta?.label==='string'?meta.label:'',
    description:typeof meta?.description==='string'?meta.description:''
  };
  }

  function placementMembers(block, preset=ctx.state.preset) {
    return (preset?.prompts??[]).filter(p=>placementEntry(p,preset).block===block);
  }

  function placementSnapshot(preset,id) {
    const prompt=ctx.findEditorPrompt(preset,id), entry=placementEntry(prompt,preset);
    const members=placementMembers(entry.block,preset);
    const index=members.findIndex(p=>p.id===id);
    return {block:entry.block,before:index<0?'':members[index+1]?.id??''};
  }

  function writePlacement(prompt,block,order,preset) {
    ctx.assertData(block==='hidden'||authorLayout(preset).blocks.some(b=>b.id===block),'所选板块已不存在，请重新选择');
    const group=ctx.getPromptGroupId(prompt,preset), previous=prompt.extra?.destined_ui??{};
    prompt.extra??={};
    prompt.extra.destined_ui={version:3,block,order,group:group??'',label:previous.label??'',description:previous.description??'',...(previous.created_by?{created_by:previous.created_by}:{})};
  }

  function inferNativePlacement(prompt,preset) {
    const list=preset?.prompts??[],index=list.findIndex(p=>p.id===prompt.id);
    const fallback={block:'unclassified',group:null};
    if(index<0)return fallback;
    const anchor=p=>{
      if(p.id==='3201a47c-47a4-4120-9360-445b4a399c14')return {block:'base-tone',group:'base-tone'};
      if(p.id==='a1acb123-3786-41d4-9287-ff3499d7895a')return {block:'event-chain',group:null};
      const meta=p.extra?.destined_ui;
      const block=[2,3].includes(meta?.version)?meta.block:legacyAuthorBlock(p);
      if(block==='hidden'||block==='models'||ctx.PROTECTED_IDS.has(p.id)||ctx.MODEL_IDS.has(p.id))return fallback;
      if(block==='unclassified'&&!meta)return null;
      const inferred=ctx.inferPromptMeta(p);
      const group=meta?.version===3?meta.group||null:meta?.version===2?authorLayout(preset).blocks.find(b=>b.id===block)?.kind==='single'?block:null:ctx.ID_TO_GROUP.get(p.id)??(inferred.control==='single-option'?inferred.group:null);
      return {block,group:group==='variable-mode'?null:group};
    };
    for(let i=index-1;i>=0;i--){const result=anchor(list[i]);if(result)return result;}
    // At the beginning of the list, use the first following recognizable entry.
    for(let i=index+1;i<list.length;i++){const result=anchor(list[i]);if(result)return result;}
    return fallback;
  }

  function nativePlacementIndex(preset,block,before,id) {
    const list=preset.prompts.filter(p=>p.id!==id);
    if(before){
      const index=list.findIndex(p=>p.id===before);
      ctx.assertData(index>=0&&placementEntry(list[index],preset).block===block,'目标条目已移动或删除，请重新载入');
      return index;
    }
    const members=placementMembers(block,preset).filter(p=>p.id!==id);
    if(members.length)return list.findIndex(p=>p.id===members.at(-1).id)+1;
    // Empty sections reuse the closest surviving section on the same page.
    const blocks=authorLayout(preset).blocks,home=blocks.find(b=>b.id===block);
    if(home&&block!=='hidden'&&block!=='unclassified'){
      const siblings=blocks.filter(b=>b.page===home.page).sort((a,b)=>Math.abs(a.order-home.order)-Math.abs(b.order-home.order));
      for(const sibling of siblings){
        const candidates=list.filter(p=>placementEntry(p,preset).block===sibling.id&&!ctx.PROTECTED_IDS.has(p.id)&&!ctx.MODEL_IDS.has(p.id));
        if(candidates.length)return sibling.order<home.order?list.indexOf(candidates.at(-1))+1:list.indexOf(candidates[0]);
      }
    }
    return list.length;
  }

  function savePlacement(preset,prompt,entry,move=true) {
    const group=ctx.getPromptGroupId(prompt,preset);
    const included=preset.prompts.some(p=>p.id===prompt.id);
    const index=entry.block!=='hidden'&&move?nativePlacementIndex(preset,entry.block,entry.before,prompt.id):-1;
    writePlacement(prompt,entry.block,0,preset);prompt.extra.destined_ui.group=group??'';
    if(included&&index>=0){preset.prompts=preset.prompts.filter(p=>p.id!==prompt.id);preset.prompts.splice(index,0,prompt);}
  }

  function renderPlacementFields(editor,locked) {
    const value=editor.draft.authorUi,layout=authorLayout(),attr=locked?'disabled':'';
    const options=layout.pages.slice().sort((a,b)=>a.order-b.order).map(page=>`<optgroup label="${ctx.escapeHtml(page.label)}${page.hidden?'（页面已隐藏）':''}">${layout.blocks.filter(b=>b.page===page.id).sort((a,b)=>a.order-b.order).map(b=>`<option value="${ctx.escapeHtml(b.id)}" ${b.id===value.block?'selected':''}>${ctx.escapeHtml(b.label)}${b.hidden?'（板块已隐藏）':''}</option>`).join('')}</optgroup>`).join('');
    const others=placementMembers(value.block).filter(p=>p.id!==editor.id);
    return `<div class="placement-fields"><label class="field-label"><span>显示在哪个板块</span><select data-action="placement-field" data-field="block" ${attr}><option value="hidden" ${value.block==='hidden'?'selected':''}>不在设置页显示</option>${options}</select></label><label class="field-label"><span>板块内的位置</span><select data-action="placement-field" data-field="before" ${locked||value.block==='hidden'?'disabled':''}><option value="">放在最后</option>${others.map(p=>`<option value="${ctx.escapeHtml(p.id)}" ${p.id===value.before?'selected':''}>在「${ctx.escapeHtml(p.name)}」前面</option>`).join('')}</select></label><p class="subtle">位置会同步到原生发送列表。选择“不显示”只隐藏界面，开关与原有单选关系保持不变。</p></div>`;
  }

  function setPlacementField(field,value) {
    const editor=ctx.state.promptEditor;
    if(!editor||!ctx.state.editorUnlocked||editor.saving||editor.contextChanged)return;
    ctx.setEditorField('authorUi',{...editor.draft.authorUi,[field]:value,...(field==='block'?{before:''}:{})});
    editor.placementRequested=true;
    if(!editor.id)editor.draft.ordinal=nativePlacementIndex(ctx.state.preset,editor.draft.authorUi.block,editor.draft.authorUi.before,'')+1;
    editor.dirty=JSON.stringify(editor.draft)!==JSON.stringify(editor.initialDraft??editor.base);
    ctx.renderStyleEditorLayer();
  }

  function renderPlacementNavigation() {
    const pages=authorLayout().pages.filter(p=>!p.hidden).sort((a,b)=>a.order-b.order);
    return [...pages,{id:'summary',label:'总结'},{id:'configurations',label:'配置管理'},{id:'settings',label:'设置'}].map((p,index)=>`<button type="button" data-action="tab" data-tab="${ctx.escapeHtml(p.id)}" class="${ctx.state.activeTab===p.id?'active':''}" aria-current="${ctx.state.activeTab===p.id?'page':'false'}"><span class="nav-index" aria-hidden="true">${String(index+1).padStart(2,'0')}</span><strong>${ctx.escapeHtml(p.label)}</strong></button>`).join('');
  }

  function placementEdit(prompt) {
    if(!ctx.state.editorUnlocked)return '';
    return `<button type="button" class="text-button placement-edit" data-action="entry-edit" data-id="${ctx.escapeHtml(prompt.id)}" aria-label="编辑 ${ctx.escapeHtml(prompt.name)}" title="编辑内容与显示位置">编辑</button>`;
  }

  function renderPlacedPrompt(prompt) {
    const meta=placementEntry(prompt),title=meta.label||prompt.name,group=ctx.getPromptGroupId(prompt);
    const description=meta.description||(prompt.id===ctx.IDS.eventChain?'配合世界书事件链使用；此处只切换预设条目。':prompt.id===ctx.IDS.resetCache?'排查命中异常时启用，恢复正常后关闭。':'');
    const edit=placementEdit(prompt);
    if(prompt.id===ctx.IDS.dialogue||prompt.id===ctx.IDS.outputLength){
      const keys=prompt.id===ctx.IDS.dialogue?['dialogueRatio','dialogueRounds']:['hanzi','combatRounds'];
      const languages=prompt.id===ctx.IDS.outputLength?'<div class="language-grid">'+['body','thinking'].map(ctx.renderLanguageControl).join('')+'</div>':'';
      return '<div class="placed-fields" data-placement-id="'+ctx.escapeHtml(prompt.id)+'">'+(edit?'<div class="numeric-edit">'+edit+'</div>':'')+languages+'<div class="field-grid">'+keys.map(ctx.renderNumericControl).join('')+'</div></div>';
    }
    let control='',content='';
    if(ctx.PROTECTED_IDS.has(prompt.id))control='<span class="badge">必需</span>';
    else if(ctx.MODEL_IDS.has(prompt.id)||group==='variable-mode')control='<span class="badge">联动管理</span>';
    else if(group)return '<article class="placed-choice" data-placement-id="'+ctx.escapeHtml(prompt.id)+'">'+ctx.choiceButton('group',prompt.id,title,prompt.enabled,false,group)+edit+'</article>';
    else control=ctx.toggleHtml('prompt:'+prompt.id,prompt.enabled);
    if(prompt.id===ctx.IDS.narration)content='<div class="segmented">'+[['first','第一人称'],['second','第二人称'],['third','第三人称']].map(([v,l])=>ctx.choiceButton('person',v,l,ctx.state.config.managed_values.narration_person===v,!ctx.hasManagedMacro(ctx.IDS.narration,ctx.MANAGED_MACROS.narrationPerson)||!ctx.hasManagedMacro(ctx.IDS.narration,ctx.MANAGED_MACROS.narrationRequirement))).join('')+'</div>';
    else if(prompt.id===ctx.IDS.globalPreference){const p=ctx.readGlobalPreference();content='<textarea aria-label="长期叙事偏好" data-action="global-preference" rows="4" '+(p.ok?'':'disabled')+'>'+ctx.escapeHtml(p.value)+'</textarea><div class="field-error" data-preference-error>'+(p.ok?'':'全局偏好短宏缺失或格式异常。')+'</div>';}
    else if(prompt.id===ctx.IDS.userAdditional){const p=ctx.readUserAdditionalSetting();content='<textarea aria-label="用户附加设定" data-action="user-additional" rows="4" '+(p.ok?'':'disabled')+'>'+ctx.escapeHtml(p.value)+'</textarea><div class="editor-actions"><button class="text-button" data-action="reset-user-additional">恢复默认</button></div><div class="field-error" data-user-additional-error>'+ctx.escapeHtml(p.error)+'</div>';}
    return '<article class="placed-prompt '+(content?'placed-wide':'')+'" data-placement-id="'+ctx.escapeHtml(prompt.id)+'"><div class="placed-head"><div class="placed-label"><strong>'+ctx.escapeHtml(title)+'</strong>'+(description?'<small>'+ctx.escapeHtml(description)+'</small>':'')+'</div><div class="placed-actions">'+control+edit+'</div></div>'+content+'</article>';
  }

  function renderPlacementBlock(block) {
    if(block.hidden)return '';
    let prompts=placementMembers(block.id);
    let dedicated='';
    if(block.id==='variable'){
      if(prompts.some(p=>ctx.getPromptGroupId(p)==='variable-mode'))dedicated=`<div class="variable-slot">${ctx.renderVariablePanel()}</div>`;
      prompts=prompts.filter(p=>ctx.getPromptGroupId(p)!=='variable-mode');
    }
    if(block.id==='models'){dedicated=ctx.renderModelTab();prompts=prompts.filter(p=>!ctx.MODEL_IDS.has(p.id));}
    if(block.id==='streaming')dedicated=`<article class="card"><div class="card-title"><h4>流式输出</h4>${ctx.toggleHtml('streaming',ctx.state.preset.settings.should_stream===true)}</div></article>`;
    if(block.id==='entry-points')dedicated=ctx.renderEntryPointSettings();
    const style=['base-tone','main-style'].includes(block.id);
    if(!dedicated&&!prompts.length&&!style&&!ctx.state.editorUnlocked)return '';
    const canAddEntry = !['models', 'streaming', 'entry-points'].includes(block.id);
    const add=!ctx.state.editorUnlocked||!canAddEntry?'':style?`<button class="text-button" data-action="new-style" data-group="${block.id}">＋ 新增${block.id==='base-tone'?'基调':'主文风'}</button>`:`<button class="text-button" data-action="entry-new-here" data-block="${ctx.escapeHtml(block.id)}">＋ 新增条目</button>`;
    return `<section class="placement-section" data-placement-block="${ctx.escapeHtml(block.id)}"><div class="card-title"><h4>${ctx.escapeHtml(block.label)}</h4>${add}</div>${dedicated}${prompts.length?`<div class="placement-list">${prompts.map(renderPlacedPrompt).join('')}</div>`:''}</section>`;
  }

  function renderPlacementPage(pageId) {
    const layout=authorLayout(),page=layout.pages.find(p=>p.id===pageId);
    if(!page)return '';
    let html=ctx.renderSectionHeader(page.label,ctx.state.editorUnlocked?'编辑模式已开启 · 可新增、修改和删除条目':'');
    const blocks=layout.blocks.filter(b=>b.page===pageId&&b.id!=='entry-points').sort((a,b)=>a.order-b.order);
    for(const block of blocks){const content=renderPlacementBlock(block);html+=['after-body','content-extra','adult-mode','entry-points','helpers'].includes(block.id)&&content?ctx.renderFold(block.id==='content-extra'?'content-options':block.id,block.label,'按需展开',content):content;}
    return html;
  }

  function repairPlacementGroup(preset,groupId) {
    if(!groupId||groupId==='variable-mode')return;
    const options=ctx.getGroupOptions(groupId,preset).map(([id])=>ctx.getPrompt(preset,id));
    if(options.some(p=>p.enabled))return;
    const legacy=authorLayout(preset).blocks.find(b=>b.id===groupId);
    if(legacy?.allowNone)return;
    const fallback=options.find(p=>p.id===(legacy?.defaultId||ctx.DEFAULT_GROUP_OPTION_IDS[groupId]))??options[0];
    if(fallback)fallback.enabled=true;
  }

  async function editEntryAction(action) {
    const editor=ctx.state.promptEditor;
    if(!editor||!ctx.state.editorUnlocked||editor.saving||editor.contextChanged)return;
    if(editor.dirty){editor.message='请先保存修改，再'+(action==='entry-copy'?'复制':'删除')+'。';return ctx.renderStyleEditorLayer();}
    if(action==='entry-delete'&&authorDependency(ctx.findEditorPrompt(ctx.state.preset,editor.id))){editor.message=authorDependency(ctx.findEditorPrompt(ctx.state.preset,editor.id));return ctx.renderStyleEditorLayer();}
    if(action==='entry-delete'&&!await ctx.dialogs.confirm('删除这个条目？','删除条目'))return;
    if(ctx.state.promptEditor!==editor||editor.dirty||editor.saving||editor.contextChanged||!ctx.state.editorUnlocked)return;
    editor.saving=true;ctx.renderStyleEditorLayer();
    const presetName=editor.presetName,id=editor.id;let newId='';
    const task=ctx.saveChain.then(async()=>{
      ctx.assertData(getLoadedPresetName()===presetName&&ctx.state.promptEditor===editor&&ctx.state.editorUnlocked,'预设或编辑状态已变化');
      const latest=getPreset('in_use'),prompt=ctx.findEditorPrompt(latest,id);ctx.assertData(prompt,'条目已不存在');
      const expected=ctx.fingerprintPresetValue(latest);
      if(action==='entry-delete')ctx.assertData(!authorDependency(prompt),authorDependency(prompt));
      else ctx.assertData(!ctx.PLACEHOLDER_IDS.has(id),'动态占位符不能复制');
      newId=action==='entry-copy'?ctx.createPromptId():'';
      await ctx.commitPresetMutation(action==='entry-copy'?'复制条目':'删除条目',preset=>{
        const current=ctx.findEditorPrompt(preset,id),index=preset.prompts.findIndex(p=>p.id===id),group=ctx.getPromptGroupId(current,preset);
        if(action==='entry-copy'){
          const copy=ctx.snapshotPrompt(current);copy.id=newId;copy.name+=' · 副本';copy.enabled=false;
          // Copy content and display location, but do not inherit a model adapter identity.
          writePlacement(copy,placementEntry(current,preset).block,placementEntry(current,preset).order+0.5,preset);
          copy.extra.destined_ui.group=ctx.MODEL_IDS.has(id)||group==='variable-mode'?'':group??'';
          copy.extra.destined_ui.label='';
          if(index>=0)preset.prompts.splice(index+1,0,copy);else(preset.prompts_unused??=[]).push(copy);
        }else{
          preset.prompts=preset.prompts.filter(p=>p.id!==id);preset.prompts_unused=(preset.prompts_unused??[]).filter(p=>p.id!==id);
          repairPlacementGroup(preset,group);
          for(const b of preset.extensions?.destined_author?.blocks??[])if(b.defaultId===id)b.defaultId='';
        }
      },()=>getLoadedPresetName()===presetName&&ctx.state.promptEditor===editor&&ctx.state.editorUnlocked&&ctx.fingerprintPresetValue(getPreset('in_use'))===expected,true);
    });
    ctx.saveChain=task.catch(()=>{});
    try{await ctx.trackPresetOperation(task);ctx.state.promptEditor=null;ctx.renderActiveContent(true);if(newId)ctx.openPromptEditor(newId);}
    catch(error){editor.message=error.message;}
    finally{editor.saving=false;ctx.renderStyleEditorLayer();ctx.renderStatus();}
  }

  return {
    defaultAuthorLayout,
    validateAuthorLayout,
    authorLayout,
    authorDependency,
    legacyAuthorBlock,
    placementEntry,
    placementMembers,
    placementSnapshot,
    writePlacement,
    inferNativePlacement,
    nativePlacementIndex,
    savePlacement,
    renderPlacementFields,
    setPlacementField,
    renderPlacementNavigation,
    placementEdit,
    renderPlacedPrompt,
    renderPlacementBlock,
    renderPlacementPage,
    repairPlacementGroup,
    editEntryAction
  };
}
