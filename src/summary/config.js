import { ARCHIVE_PROMPTS as PRESET_PROMPTS, PROMPT_VERSION } from './archiveDefaults.js';

/**
 * config.js
 * 全局配置常量、板块类型、内置提示词、默认设置
 */

const CONFIG = {
  MAIN_BUTTON_NAME: "总结设置",
  WORLDBOOK_NAME_PREFIX: "命定之诗总结世界书",
  ENTRY_START_ORDER: 100,
  ENTRY_DEPTH: 9998,
  ENTRY_ROLE: "system",
  SETTINGS_VAR_KEY: "summary_assistant_settings",
  CHAT_WB_VAR_KEY: "summary_assistant_worldbook",
  MEGA_SUMMARY_DEPTH: 9999,
  MEGA_SUMMARY_VAR_KEY: "summary_assistant_mega_summary_map",
};

const BLOCK_TYPES = {
  PROMPT: "prompt",
  BUILTIN_GROUP: "builtin_group",
  OLD_SUMMARY: "old_summary",
  CHAT_MESSAGES: "chat_messages",
};

const BUILTIN_PROMPTS = [
  "world_info_before",
  "persona_description",
  "char_description",
  "char_personality",
  "scenario",
  "world_info_after",
  "dialogue_examples",
];

const generateBlockId = () =>
  `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const DEFAULT_PROMPT_BLOCKS = PRESET_PROMPTS.promptBlocks;
const DEFAULT_MEGA_SUMMARY_PROMPT_BLOCKS = PRESET_PROMPTS.megaPromptBlocks;

const DEFAULT_SETTINGS = {
  behaviorVersion: 1,
  enabled: false,
  apiMode: "tavern",
  customApiUrl: "",
  customApiKey: "",
  customApiModel: "",
  customApiSource: "openai",
  temperature: 'same_as_preset',
  maxTokens: 'same_as_preset',
  includeTags: ["tp", "gametxt"],
  excludeTags: [],
  excludeHtmlComments: true,
  triggerFloorCount: 30,
  keepFloorCount: 10,
  batchFloorCount: 20,
  batchPreset: 'custom',
  parallelBatches: false,
  batchConcurrency: 2,
  autoMegaSummary: true,
  megaTriggerCount: 15,
  megaBatchCount: 10,
  customMacros: [],
  promptVersion: PROMPT_VERSION,
  includeOldSummary: true,
  autoTriggerConfirm: false,
  autoHideSummarizedFloors: true,
  userPrefix: "{{user}}",
  assistantPrefix: "AI",
  promptBlocks: DEFAULT_PROMPT_BLOCKS.map((b) => ({ ...b })),
  megaPromptBlocks: DEFAULT_MEGA_SUMMARY_PROMPT_BLOCKS.map((b) => ({ ...b })),
};


export { CONFIG, BLOCK_TYPES, BUILTIN_PROMPTS, generateBlockId, DEFAULT_PROMPT_BLOCKS, DEFAULT_MEGA_SUMMARY_PROMPT_BLOCKS, DEFAULT_SETTINGS };
