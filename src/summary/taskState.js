import { captureContext, checkContext, contextKey, onCancel, cancelOwnRequests, setTaskRuntime } from '../platform/lifecycle.js';
import { readStore, patchSummaryStore } from '../platform/store.js';

const RUNTIME_KEY = 'summary_assistant_runtime';
const listeners = new Set();
let current = null;
const copy = value => value == null ? null : structuredClone(value);
export const phaseLabels = { preparing: '准备材料', generating: '请求生成', retrying: '等待重试', validating: '提取与校验', saving: '保存记录', visibility: '同步楼层', complete: '已完成', pending: '待处理', stopped: '已停止' };
export function getTask() { return copy(current?.key === contextKey() ? current : null); }
export function taskBatchFields(batch) {
  const defaults={book:null,sources:[],parents:[],resultFormat:'free',body:'',raw:'',saved:false,errorKind:null,details:'',attempt:0};
  return Object.fromEntries(Object.entries(defaults).map(([key,value])=>[key,copy(batch?.[key]??value)]));
}
export function updatePendingTask(patch) {
  const task=getTask();if(!task||task.running)throw new Error('当前任务不能修改待处理记录');
  const next={...current,...copy(patch)};persist(next);current=next;publish();
}
export function selectTaskBatch(index) {
  const task=getTask(),batch=task?.batches?.[index];
  if(!batch||task.running||['complete','skipped','paused'].includes(batch.phase))return;
  updatePendingTask({...taskBatchFields(batch),selectedBatch:index});
}
export function taskRunning() { return !!getTask()?.running; }
export function canStopTask(task = getTask()) { return !!task?.running && ['preparing', 'generating', 'retrying', 'validating'].includes(task.phase); }
function publish() { setTaskRuntime(current?.key === contextKey() ? current : null); for (const listener of listeners) listener(getTask()); }
export function subscribeTask(listener) { listeners.add(listener); listener(getTask()); return () => listeners.delete(listener); }
function persist(task) {
  const state = readStore()[RUNTIME_KEY] ?? {};
  const saved = copy(task);
  delete saved.token;
  // Connection secrets and expanded request prompts never enter recovery storage.
  patchSummaryStore({ [RUNTIME_KEY]: { ...state, [task.key]: saved } });
}
export function restoreTaskState() {
  current = copy(readStore()[RUNTIME_KEY]?.[contextKey()] ?? null);
  if (current?.running) { current.running = false; current.phase = 'stopped'; current.message = '上次任务已中断，可继续处理'; persist(current); }
  publish();
}
export function beginTask(spec, previous = null) {
  if (taskRunning()) throw new Error('当前总结任务尚未结束');
  current = { ...copy(previous), id: crypto.randomUUID(), key: contextKey(), token: captureContext(), spec: copy(spec), phase: 'preparing', running: true, startedAt: Date.now(), endedAt: null, dismissedProgress: false, dismissedFinal: false, message: '', details: '', errorKind: null, attempt: 0 };
  current.log = [{ at: current.startedAt, phase: 'preparing' }];
  try { persist(current); } catch (error) { current.running = false; publish(); throw error; }
  publish();
  return copy(current);
}
export function checkTask(task) {
  checkContext(task.token);
  if (current?.id !== task.id || !current.running) throw Object.assign(new Error('总结任务已停止'), { name: 'AbortError' });
}
export function updateTask(task, patch, { save = false } = {}) {
  checkTask(task);
  appendPhase(patch);
  Object.assign(current, copy(patch));
  if (save) persist(current);
  publish();
  return getTask();
}
export function finishTask(task, patch) {
  checkTask(task);
  appendPhase(patch);
  Object.assign(current, copy(patch), { running: false, endedAt: Date.now() });
  try { persist(current); } finally { publish(); }
}
function appendPhase(patch) {
  if (patch.phase && patch.phase !== current.phase) current.log = [...(current.log ?? []), { at: Date.now(), phase: patch.phase }].slice(-16);
}
export function dismissTask() {
  if (!current) return;
  if (current.running) current.dismissedProgress = true; else current.dismissedFinal = true;
  persist(current); publish();
}
export function stopTask() {
  if (!canStopTask()) return false;
  const task = current;
  task.running = false; task.phase = 'stopped'; task.message = '本次已停止，等待手动继续'; task.endedAt = Date.now();
  try { persist(task); } finally { publish(); cancelOwnRequests(); }
  return true;
}
export function clearTask() {
  if (taskRunning()) throw new Error('当前总结任务尚未结束');
  if (current) { const state = readStore()[RUNTIME_KEY] ?? {}; delete state[current.key]; patchSummaryStore({ [RUNTIME_KEY]: state }); }
  current = null; publish();
}
export function clearTaskLog() {
  const task=getTask();if(!task)return;
  if(!task.running&&task.phase==='complete'){clearTask();return;}
  const next={...current,log:[]};
  persist(next);current=next;publish();
}
export function detachTaskState() {
  if (current?.running) {
    current.running = false; current.phase = 'stopped'; current.message = '聊天或预设已切换，任务已中断'; current.endedAt = Date.now();
    try { persist(current); } catch { /* Previously persisted running state is recovered as interrupted on reload. */ }
  }
  current = null; publish();
}
export function waitForRetry(task, milliseconds = 1200) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { off(); try { checkTask(task); resolve(); } catch (error) { reject(error); } }, milliseconds);
    const off = onCancel(() => { clearTimeout(timer); off(); reject(Object.assign(new Error('总结任务已取消'), { name: 'AbortError' })); });
  });
}
