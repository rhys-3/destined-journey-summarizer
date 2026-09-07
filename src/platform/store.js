// All script-variable writes pass through this synchronous coordinator.
const SUMMARY_KEYS = ['summary_assistant_settings', 'summary_assistant_secrets', 'summary_assistant_migration', 'summary_assistant_runtime', 'summary_assistant_owned_books', 'summary_assistant_books'];
export function readStore() { return structuredClone(getVariables({ type: 'script' }) ?? {}); }
export function writeStore(value) {
  const next = structuredClone(value);
  replaceVariables(next, { type: 'script' });
  const actual = readStore();
  if (JSON.stringify(actual) !== JSON.stringify(next)) throw new Error('脚本设置持久化校验失败');
  return actual;
}
export function writePresetStore(value) {
  const latest = readStore();
  const next = structuredClone(value);
  for (const key of SUMMARY_KEYS) {
    if (Object.hasOwn(latest, key)) next[key] = latest[key];
    else delete next[key];
  }
  return writeStore(next);
}
export function patchSummaryStore(patch) {
  return writeStore({ ...readStore(), ...structuredClone(patch) });
}
