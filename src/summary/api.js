import { requestGeneration } from '../platform/lifecycle.js';
import { extractHttpStatus, errorCatched, safeErrorDetails } from './errorHandler.js';
import { getSettings } from './storage.js';
import { compilePrompt, generationApi } from './macros.js';
import { tavernContext } from '../platform/ambient.js';
const parseOptionalNumberSetting = (value, fieldLabel) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;

  const normalized = String(value).trim();
  if (!normalized || normalized === 'same_as_preset') return undefined;

  const unquoted = normalized.replace(/^(["'])(.*)\1$/, '$2').trim();
  if (!unquoted || unquoted === 'same_as_preset') return undefined;

  const parsed = Number(unquoted);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldLabel} 必须是数字或 same_as_preset`);
  }
  return parsed;
};

const buildCustomApiConfig = (settings) => {

  if (settings.apiMode === 'custom' && (!settings.customApiUrl || !settings.customApiModel)) {
    throw new Error('自定义API模式下必须填写API地址和模型名称');
  }
  const config = settings.apiMode === 'custom' ? { apiurl: settings.customApiUrl, model: settings.customApiModel, source: settings.customApiSource || 'openai' } : {};
  const temperature = parseOptionalNumberSetting(settings.temperature, '温度');
  const maxTokens = parseOptionalNumberSetting(settings.maxTokens, '最大Tokens');
  if (settings.apiMode === 'custom' && settings.customApiKey) config.key = settings.customApiKey;
  if (temperature !== undefined) config.temperature = temperature;
  if (maxTokens !== undefined) config.max_tokens = maxTokens;
  return Object.keys(config).length ? config : undefined;
};

export async function prepareGeneration(params, settings = getSettings()) {
  const compiled = await compilePrompt(params, settings);
  const config = { should_silence: true, ordered_prompts: compiled.orderedPrompts, max_chat_history: 0, overrides: { chat_history: { prompts: [], with_depth_entries: false }, world_info_before: '', world_info_after: '', persona_description: '', char_description: '', char_personality: '', scenario: '', dialogue_examples: '' } };
  const custom = { ...buildCustomApiConfig(settings) };
  const st=tavernContext(), context=st?.getContext?.()??{}, active=st?.chatCompletionSettings??context.chatCompletionSettings;
  if(active){
    if(settings.temperature==='same_as_preset'&&Number.isFinite(active.temp_openai))custom.temperature=active.temp_openai;
    if(settings.maxTokens==='same_as_preset'&&Number.isInteger(active.openai_max_tokens))custom.max_tokens=active.openai_max_tokens;
    if(settings.apiMode==='tavern'){
      if(active.chat_completion_source)custom.source=active.chat_completion_source;
      const model=(st?.getChatCompletionModel??context.getChatCompletionModel)?.(active.chat_completion_source);if(model)custom.model=model;
    }
  }
  if(Object.keys(custom).length)config.custom_api=custom;
  return { config, prefill: compiled.prefill, resultFormat: compiled.resultFormat, macroValues: compiled.macroValues };
}
export async function sendPreparedGeneration(prepared, settings = getSettings()) {
  const generate = generationApi();
  if (!generate) throw new Error('需要酒馆助手 generateRaw 接口，请更新或启用酒馆助手');
  try { return String(await requestGeneration(config => generate(config), structuredClone(prepared.config)) ?? '').trim(); }
  catch (error) {
    if (error.name === 'AbortError') throw error;
    const status = extractHttpStatus(error);
    const failure = new Error(safeErrorDetails(error, [settings.customApiKey])); failure.status = status; throw failure;
  }
}
const callSummaryApi = async (params, settings = getSettings()) => sendPreparedGeneration(await prepareGeneration(params, settings), settings);
const callMegaSummaryApi = callSummaryApi;
export async function testConnection(settings = getSettings()) {
  const config = { should_silence: true, max_chat_history: 0, ordered_prompts: [{ role: 'user', content: '请只回复 OK。' }], overrides: { chat_history: { prompts: [], with_depth_entries: false } }, custom_api: { ...buildCustomApiConfig(settings), max_tokens: 32 } };
  const text = await sendPreparedGeneration({ config }, settings); if (!text.trim()) throw new Error('连接已返回，但内容为空'); return true;
}

const fetchModelList = errorCatched(async (apiUrl, apiKey) => {
  if (!apiUrl) throw new Error('请先填写API地址');
  const params = { apiurl: apiUrl };
  if (apiKey) params.key = apiKey;

  let getModelListFn = undefined;
  try {
    if (typeof getModelList !== 'undefined') getModelListFn = getModelList;
    else if (typeof window !== 'undefined' && window.getModelList)
      getModelListFn = window.getModelList;
    else if (typeof window !== 'undefined' && window.parent && window.parent.getModelList)
      getModelListFn = window.parent.getModelList;
  } catch (e) {}

  if (getModelListFn) {
    try {
      const result = await getModelListFn(params);
      // 验证返回结果是否为有效的模型列表
      if (result && Array.isArray(result) && result.length > 0) {
        return result;
      }
    } catch (e) {
      // 如果是明确的错误（如权限问题），不要fallback
      const status = extractHttpStatus(e);
      if (status && (status === 401 || status === 403)) {
        throw new Error(`API认证失败 [HTTP ${status}]，请检查密钥与权限`);
      }
    }
  }

  const url = apiUrl.trim().replace(/\/(?:chat\/completions|completions|responses|models)\/?$/, '').replace(/\/$/, '') + '/models';
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  try {
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const data = await res.json();
    if (data && Array.isArray(data.data)) {
      return data.data.map((x) => x.id);
    }
    if (Array.isArray(data)) {
      return data.map((x) => x.id || x);
    }
    throw new Error('响应格式无法解析');
  } catch (e) {
    throw new Error('获取模型列表失败：' + safeErrorDetails(e, [apiKey]));
  }
});

export { parseOptionalNumberSetting, buildCustomApiConfig, callSummaryApi, callMegaSummaryApi, fetchModelList };
