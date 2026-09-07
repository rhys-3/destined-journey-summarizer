import { helperApi, tavernContext } from './ambient.js';
let host;
let epoch = 0;
let operation = null;
let disposed = false;
let enabled = false;
let taskRuntime = null;
const cancellations = new Set();
export function configureRuntime(value) { host = value; disposed = false; }
export function getHost() { return host; }
export function contextKey() {
  const st = tavernContext();
  const ctx = st?.getContext?.() ?? st ?? {};
  return JSON.stringify([helperApi('getLoadedPresetName')?.(), ctx.chatId ?? ctx.getCurrentChatId?.(), ctx.characterId, ctx.groupId]);
}
export function captureContext() { return { epoch, key: contextKey() }; }
export function checkContext(token) {
  if (disposed || token.epoch !== epoch || token.key !== contextKey()) {
    const error = new Error('聊天、预设或总结状态已变化，本次操作已取消');
    error.name = 'AbortError';
    throw error;
  }
}
export function assertCurrent() {
  if (operation) checkContext(operation.token);
  else if (disposed) throw new Error('脚本已卸载');
}
export function invalidate(reason = 'context') { epoch++; operation = null; for (const cancel of [...cancellations]) cancel(reason); }
export function onCancel(cancel) { cancellations.add(cancel); return () => cancellations.delete(cancel); }
// Pausing automation does not cancel an in-flight snapshot.
export function setRuntimeEnabled(value) { enabled = value; }
export function isEnabled() { return enabled; }
export function isBusy() { return !!operation || !!taskRuntime?.running; }
export function setTaskRuntime(value) { taskRuntime = value; host?.busy?.(isBusy()); }
export function assertRecordWritable(taskId) {
  assertCurrent();
  if (taskRuntime?.running && taskRuntime.id !== taskId) throw new Error('当前总结任务尚未结束，记录暂时只读');
}
export function cancelOwnRequests() { for (const cancel of [...cancellations]) cancel('stop'); }
export async function runAction(fn, { generation = false, quiet = false } = {}) {
  if (isBusy()) { if (!quiet) host?.status('当前总结任务尚未结束，请稍候。', 'info'); return; }
  if (generation && !enabled) { if (!quiet) host?.status('请先启用总结功能。', 'info'); return; }
  const token = captureContext();
  const own = { token };
  operation = own;
  host?.busy?.(true);
  try { const result = await fn(); checkContext(token); return result; }
  catch (error) {
    if (error.name !== 'AbortError' && token.epoch === epoch && token.key === contextKey()) host?.status(error.message ?? '总结操作失败', 'error');
  } finally { if (operation === own) { operation = null; host?.busy?.(isBusy()); } }
}
export function disposeRuntime() { invalidate(); disposed = true; }
export async function requestGeneration(fn, config) {
  assertCurrent();
  const token = captureContext();
  const generation_id = `destined-summary-${crypto.randomUUID()}`;
  const stop = () => { try { Promise.resolve(helperApi('stopGenerationById')?.(generation_id)).catch(() => {}); } catch {} };
  let rejectCancelled;
  const requestAbort=new AbortController();
  const cancelled = new Promise((_, reject) => { rejectCancelled=reject; });
  const off = onCancel(() => { requestAbort.abort();stop(); rejectCancelled(Object.assign(new Error('总结任务已取消'), {name:'AbortError'})); });
  const timer = setTimeout(() => { requestAbort.abort();stop(); rejectCancelled(new Error('总结请求超过 5 分钟，已停止；可重试')); }, 300000);
  try { const result = await Promise.race([fn({ ...config, generation_id },requestAbort.signal), cancelled]); checkContext(token); assertCurrent(); return result; }
  finally { clearTimeout(timer); off(); }
}
export async function guardedWrite(name, ...args) {
  assertCurrent();
  const token = captureContext();
  const api = helperApi(name);
  if (typeof api !== 'function') throw new Error(`酒馆助手缺少 ${name}，请更新扩展后重试`);
  const result = await api(...args);
  checkContext(token);
  assertCurrent();
  return result;
}
export const createWorldbook = (...args) => guardedWrite('createWorldbook', ...args);
export const replaceWorldbook = (...args) => guardedWrite('replaceWorldbook', ...args);
export const deleteWorldbook = (...args) => guardedWrite('deleteWorldbook', ...args);
export const rebindGlobalWorldbooks = (...args) => guardedWrite('rebindGlobalWorldbooks', ...args);
export const createWorldbookEntries = (...args) => guardedWrite('createWorldbookEntries', ...args);
export const updateWorldbookWith = (name, updater) => guardedWrite('updateWorldbookWith', name, value => { assertCurrent(); return updater(value); });
export const setChatMessages = (...args) => guardedWrite('setChatMessages', ...args);
export function writeVariableKeys(patch, options) {
  assertCurrent();
  const token=captureContext(),expected=structuredClone(patch);
  const replace=helperApi('replaceVariables');
  if(typeof replace!=='function')throw new Error('酒馆助手缺少变量保存接口，请更新扩展后重试');
  // These are complete values for named keys, including maps with deleted
  // members. Helper's insertOrAssignVariables deep-merges and retains them.
  // Read and replace synchronously so all unrelated variables stay intact.
  const next={...(getVariables(options)??{}),...expected};
  checkContext(token);
  replace(next,options);
  checkContext(token);
  const actual = getVariables(options);
  for (const [key, value] of Object.entries(expected)) if (JSON.stringify(actual?.[key]) !== JSON.stringify(value)) throw new Error('聊天记录持久化校验失败');
  return actual;
}
export const SillyTavern = new Proxy({}, {
  get(_, key) {
    if (key === 'callGenericPopup') return async (...args) => { assertCurrent(); const value = await host.popup(...args); assertCurrent(); return value; };
    return tavernContext()?.[key];
  },
});
