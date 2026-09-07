import { errorCatched } from './errorHandler.js';
import { CONFIG, BLOCK_TYPES, generateBlockId, DEFAULT_PROMPT_BLOCKS, DEFAULT_MEGA_SUMMARY_PROMPT_BLOCKS, DEFAULT_SETTINGS } from './config.js';
import { getHost, setRuntimeEnabled, writeVariableKeys } from '../platform/lifecycle.js';
import { assertRecordWritable } from '../platform/lifecycle.js';
import { readStore, patchSummaryStore } from '../platform/store.js';
import { summarySnapshot } from './settingsSchema.js';
import { PRESET_PROMPTS as LEGACY_PROMPTS } from './presetDefaults.js';
import { OUTPUT_CONTRACT, PREVIOUS_ARCHIVE_PROMPTS, PREVIOUS_COMPACT_PROMPTS, optionBlocks, PROMPT_VERSION } from './archiveDefaults.js';
/**
 * storage.js
 * 设置的加载、保存、迁移、重置
 * 依赖: config.js, utils.js, errorHandler.js
 */

let _cachedSettings = null;

const matchesDefaultBlocks = (actual, defaults) => {
  if (!Array.isArray(actual) || actual.length !== defaults.length) return false;
  // Persisted snapshots reorder object keys; compare the editable values, not JSON key order.
  const value = (block, key) => key === 'content' ? String(block?.content ?? '').replace(/\n\{\{summary.depth\}\}/g,'') : block?.[key] ?? (key === 'role' ? 'system' : key === 'enabled' ? true : '');
  return actual.every((block, index) => ['id','name','type','enabled','role','content','leadText','xmlTag'].every(key => value(block,key) === value(defaults[index],key)));
};

const cloneSettings = (settings) => ({
  ...structuredClone(settings),
  includeTags: Array.isArray(settings?.includeTags)
    ? [...settings.includeTags]
    : [...DEFAULT_SETTINGS.includeTags],
  excludeTags: Array.isArray(settings?.excludeTags)
    ? [...settings.excludeTags]
    : [...DEFAULT_SETTINGS.excludeTags],
  promptBlocks: Array.isArray(settings?.promptBlocks)
    ? settings.promptBlocks.map((b) => ({ ...b }))
    : DEFAULT_PROMPT_BLOCKS.map((b) => ({ ...b })),
  megaPromptBlocks: Array.isArray(settings?.megaPromptBlocks)
    ? settings.megaPromptBlocks.map((b) => ({ ...b }))
    : DEFAULT_MEGA_SUMMARY_PROMPT_BLOCKS.map((b) => ({ ...b })),
});

const migrateOldSettings = (raw) => {
  if(raw.behaviorVersion===undefined){
    if(JSON.stringify(raw.excludeTags)==='["think"]')raw.excludeTags=[];
    if(raw.megaTriggerCount===8&&raw.megaBatchCount===6){raw.megaTriggerCount=15;raw.megaBatchCount=10;}
    raw.behaviorVersion=1;
  }
  if (raw.promptVersion !== 3 && raw.promptVersion !== PROMPT_VERSION) {
    let replacedNormal = false;
    for (const [key, defaults] of [['promptBlocks', DEFAULT_PROMPT_BLOCKS], ['megaPromptBlocks', DEFAULT_MEGA_SUMMARY_PROMPT_BLOCKS]]) {
      if ([LEGACY_PROMPTS[key], PREVIOUS_ARCHIVE_PROMPTS[key]].some(previous => matchesDefaultBlocks(raw[key], previous))) {
        raw[key] = structuredClone(defaults);
        if (key === 'promptBlocks') replacedNormal = true;
      } else if (raw.promptVersion !== 2 && Array.isArray(raw[key]) && !raw[key].some(block => block.id === 'result_contract' || block.content?.includes('{{summary.output_format}}'))) raw[key].push({ id: 'result_contract', type: 'prompt', name: '结果标签协议', enabled: true, role: 'user', content: OUTPUT_CONTRACT });
    }
    if (replacedNormal && (!raw.resultFormat || raw.resultFormat === 'free')) raw.resultFormat = 'legacy';
    raw.promptVersion = 3;
  }
  if (Array.isArray(raw.promptBlocks)) return migrateNativeOptions(raw);
  const blocks = DEFAULT_PROMPT_BLOCKS.map((b) => ({ ...b }));
  for (const block of blocks) {
    if (block.id === 'jailbreak' && raw.jailbreakPrompt !== undefined) {
      block.content = raw.jailbreakPrompt;
      if (raw.jailbreakRole) block.role = raw.jailbreakRole;
    }
    if (block.id === 'summary_rules' && raw.summaryRulesPrompt !== undefined) {
      block.content = raw.summaryRulesPrompt;
      if (raw.summaryRulesRole) block.role = raw.summaryRulesRole;
    }
    if (block.id === 'old_summary' && raw.oldSummaryRole) {
      block.role = raw.oldSummaryRole;
    }
    if (block.id === 'chat_messages' && raw.chatMessagesRole) {
      block.role = raw.chatMessagesRole;
    }
    if (block.id === 'summary_instruction' && raw.summaryInstruction !== undefined) {
      block.content = raw.summaryInstruction;
      if (raw.summaryInstructionRole) block.role = raw.summaryInstructionRole;
    }
  }
  raw.promptBlocks = blocks;
  if (raw.summaryInstruction !== undefined) raw.promptBlocks.push({ id:'summary_instruction', type:'prompt', name:'附加输出要求', enabled:true, role:raw.summaryInstructionRole || 'user', content:raw.summaryInstruction });
  delete raw.jailbreakPrompt;
  delete raw.jailbreakRole;
  delete raw.summaryRulesPrompt;
  delete raw.summaryRulesRole;
  delete raw.oldSummaryRole;
  delete raw.chatMessagesRole;
  delete raw.summaryInstruction;
  delete raw.summaryInstructionRole;
  return migrateNativeOptions(raw);
};

function migrateNativeOptions(raw) {
  if(raw.promptVersion!==PROMPT_VERSION){
    for(const [key,defaults] of [['promptBlocks',DEFAULT_PROMPT_BLOCKS],['megaPromptBlocks',DEFAULT_MEGA_SUMMARY_PROMPT_BLOCKS]]){
      if(!Array.isArray(raw[key])){raw[key]=structuredClone(defaults);continue;}
      const untouched=matchesDefaultBlocks(raw[key],PREVIOUS_COMPACT_PROMPTS[key]);
      const options=optionBlocks({resultFormat:raw.resultFormat??(untouched?'legacy':'free'),thinkingTemplate:raw.thinkingTemplate??'native',prefillTemplate:raw.prefillTemplate??'off'});
      if(untouched)raw[key]=structuredClone(defaults).map(block=>options.find(option=>option.id===block.id)??block);
      else if(!raw[key].some(block=>block.choiceGroup)){
        const ids=new Set(raw[key].map(block=>block.id));
        raw[key].push(...options.map(block=>ids.has(block.id)?{...block,id:generateBlockId()}:block));
      }
    }
  }
  for(const [key,defaults] of [['promptBlocks',DEFAULT_PROMPT_BLOCKS],['megaPromptBlocks',DEFAULT_MEGA_SUMMARY_PROMPT_BLOCKS]])raw[key]=(raw[key]??structuredClone(defaults)).map(block=>{
    if(block.type===BLOCK_TYPES.PROMPT)return block;
    let content=block.content;
    if(block.type===BLOCK_TYPES.BUILTIN_GROUP)content??=['world_before','persona','character','personality','scenario','world_after','examples'].map(name=>'{{summary.'+name+'}}').join('\n\n');
    if(block.type===BLOCK_TYPES.OLD_SUMMARY)content='<prior_memory>\n{{summary.history}}\n</prior_memory>';
    if(block.type===BLOCK_TYPES.CHAT_MESSAGES){const tag=block.xmlTag||'source_material';content=(block.leadText||'')+'\n<'+tag+'>\n{{summary.material}}\n</'+tag+'>';}
    return {...block,type:BLOCK_TYPES.PROMPT,role:block.role||'user',content:content??''};
  });
  raw.promptVersion=PROMPT_VERSION;
  for(const key of ['resultFormat','thinkingTemplate','prefillTemplate','includeDepthWorldbook','noTransTag','noTransTagValue'])delete raw[key];
  return raw;
}

const validateBlocks = (blocks, defaultBlocks = DEFAULT_PROMPT_BLOCKS) => {
  if (!Array.isArray(blocks)) return defaultBlocks.map((b) => ({ ...b }));
  const normalized = blocks
    .map((b) => {
      if (!b || typeof b !== 'object') return null;
      if (!b.id) b.id = generateBlockId();
      if (!b.type) b.type = BLOCK_TYPES.PROMPT;
      if (!b.name) b.name = '未命名板块';
      if (b.enabled === undefined) b.enabled = true;
      if (b.type === BLOCK_TYPES.PROMPT && b.content === undefined) b.content = '';
      if (b.role === undefined && b.type !== BLOCK_TYPES.BUILTIN_GROUP) b.role = 'system';
      return b;
    })
    .filter(Boolean);
  return normalized;
};

export function getKeyForUrl(url) {
  const vars=readStore(), secrets=vars.summary_assistant_secrets ?? {};
  const key=String(url??'').trim();
  return secrets.keysByUrl?.[key] ?? (String(vars[CONFIG.SETTINGS_VAR_KEY]?.customApiUrl??'').trim()===key ? secrets.customApiKey ?? vars[CONFIG.SETTINGS_VAR_KEY]?.customApiKey ?? '' : '');
}
const loadSettings = async () => {
  const vars = readStore();
  const raw = vars[CONFIG.SETTINGS_VAR_KEY];
  const settings = summarySnapshot(raw ? migrateOldSettings(structuredClone(raw)) : DEFAULT_SETTINGS);
  _cachedSettings = { ...settings, customApiKey: getKeyForUrl(settings.customApiUrl) };
  setRuntimeEnabled(settings.enabled);
  return cloneSettings(_cachedSettings);
};
const saveSettings = async settings => {
  const validated = summarySnapshot(settings);
  patchSummaryStore({
    [CONFIG.SETTINGS_VAR_KEY]: validated,
    summary_assistant_secrets: { keysByUrl: { ...readStore().summary_assistant_secrets?.keysByUrl, [validated.customApiUrl.trim()]: String(settings.customApiKey ?? '') } },
  });
  _cachedSettings = { ...validated, customApiKey: String(settings.customApiKey ?? '') };
  setRuntimeEnabled(validated.enabled);
  getHost()?.changed?.();
};
const getSettings = () => cloneSettings(_cachedSettings ?? DEFAULT_SETTINGS);
const updateSettings = async partial => {
  const settings = { ...getSettings(), ...partial };
  if(partial.customApiUrl !== undefined && partial.customApiUrl !== getSettings().customApiUrl && !Object.hasOwn(partial,'customApiKey')) settings.customApiKey=getKeyForUrl(partial.customApiUrl);
  await saveSettings(settings);
  return settings;
};
const resetSettings = async () => {
  assertRecordWritable();
  const settings = { ...structuredClone(DEFAULT_SETTINGS), enabled: getSettings().enabled, customApiKey: getKeyForUrl(DEFAULT_SETTINGS.customApiUrl) };
  await saveSettings(settings); return settings;
};

// ---- 大总结映射管理 ----

const loadMegaSummaryMap = errorCatched(async () => {
  try {
    const vars = getVariables({ type: 'chat' });
    const map = vars?.[CONFIG.MEGA_SUMMARY_VAR_KEY];
    if (map && typeof map === 'object') {
      return map;
    }
    return {};
  } catch (e) {
    console.warn('加载大总结映射失败:', e);
    return {};
  }
});

const saveMegaSummaryMap = errorCatched(async (map) => {
  writeVariableKeys(
    { [CONFIG.MEGA_SUMMARY_VAR_KEY]: map || {} },
    { type: 'chat' }
  );
});

const getMegaSummaryMap = errorCatched(async () => {
  return await loadMegaSummaryMap();
});

const setMegaSummaryMapping = errorCatched(async (megaSummaryName, summaryNames) => {
  const map = await loadMegaSummaryMap();
  map[megaSummaryName] = Array.isArray(summaryNames) ? [...summaryNames] : [];
  await saveMegaSummaryMap(map);
});

const getMegaSummaryMapping = errorCatched(async (megaSummaryName) => {
  const map = await loadMegaSummaryMap();
  return map[megaSummaryName] || null;
});

const deleteMegaSummaryMapping = errorCatched(async (megaSummaryName) => {
  const map = await loadMegaSummaryMap();
  delete map[megaSummaryName];
  await saveMegaSummaryMap(map);
});

export { _cachedSettings, cloneSettings, migrateOldSettings, validateBlocks, loadSettings, saveSettings, getSettings, updateSettings, resetSettings, loadMegaSummaryMap, saveMegaSummaryMap, getMegaSummaryMap, setMegaSummaryMapping, getMegaSummaryMapping, deleteMegaSummaryMapping };
