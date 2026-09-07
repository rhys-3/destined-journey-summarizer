import { writeVariableKeys } from '../platform/lifecycle.js';
import { CONFIG } from './config.js';
import { parseSummaryEntryName, parseMegaSummaryEntryName } from './utils.js';

export const ARCHIVE_VAR_KEY = 'summary_assistant_archive';
export const parseRange = name => parseSummaryEntryName(name) ?? parseMegaSummaryEntryName(name);
// Two independent 32-bit accumulators; stable across browser sessions and hide changes.
export function fingerprint(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i); }
  return `${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}:${text.length}`;
}
export function sourceOf(message) {
  const id = message.id ?? message.message_id;
  return { id, fingerprint: fingerprint([id, message.role, message.name ?? '', message.swipe_id ?? null, message.message ?? '']) };
}
export function currentSources() {
  const last = getLastMessageId();
  return last < 0 ? [] : getChatMessages(`0-${last}`, { role: 'all', hide_state: 'all', include_swipes: false }).map(sourceOf);
}
export function readArchive(book = getVariables({ type: 'chat' })?.[CONFIG.CHAT_WB_VAR_KEY]) {
  const data = getVariables({ type: 'chat' })?.[ARCHIVE_VAR_KEY]?.[book];
  return structuredClone({ records: {}, excluded: [], megaExcluded: [], ...data });
}
export function writeArchive(data, book = getVariables({ type: 'chat' })?.[CONFIG.CHAT_WB_VAR_KEY]) {
  if (!book) throw new Error('当前聊天没有绑定总结世界书');
  const all = getVariables({ type: 'chat' })?.[ARCHIVE_VAR_KEY] ?? {};
  writeVariableKeys({ [ARCHIVE_VAR_KEY]: { ...all, [book]: data } }, { type: 'chat' });
}
export function sourcesMatch(sources, current = currentSources()) {
  const byId = new Map(current.map(source => [source.id, source.fingerprint]));
  return Array.isArray(sources) && sources.length > 0 && sources.every(source => byId.get(source.id) === source.fingerprint);
}
export function recordValid(entry, archive, current, entries = []) {
  if (!entry) return false;
  const record = archive.records[entry.name];
  if (!record) return true; // Legacy coverage is baselined once by auditArchiveSources.
  if (record.committed === false || record.invalid || !sourcesMatch(record.sources, current)) return false;
  return (record.parents ?? []).every(parent => entries.some(item => item.name === parent.name && fingerprint(item.content ?? '') === parent.fingerprint));
}
export function sourceFloors(entry, archive, megaMap, lastId) {
  const record = archive.records[entry.name];
  if (record) return (record.sources ?? []).map(source => source.id).filter(id => id >= 0 && id <= lastId);
  const normal = parseSummaryEntryName(entry.name);
  const ranges = normal ? [normal] : (megaMap[entry.name] ?? []).map(parseSummaryEntryName).filter(Boolean);
  return [...new Set(ranges.flatMap(range => Array.from({ length: Math.max(0, Math.min(lastId, range.end) - range.start + 1) }, (_, i) => range.start + i)))];
}
export function excludeRange(name, { mega = false } = {}) {
  const archive = readArchive(), range = parseRange(name);
  if (mega) archive.megaExcluded = [...new Set([...archive.megaExcluded, name])];
  else if (range && !archive.excluded.some(item => item.start === range.start && item.end === range.end)) archive.excluded.push(range);
  writeArchive(archive);
}
export function consecutiveSummaries(names) {
  const parsed = [...new Set(names)].map(name => ({ name, ...parseSummaryEntryName(name) })).sort((a, b) => a.start - b.start);
  if (parsed.length !== names.length || parsed.length < 2 || parsed.some((range, i) => !Number.isInteger(range.start) || range.end < range.start || (i > 0 && range.start !== parsed[i - 1].end + 1))) {
    throw new Error('大总结需要至少两条按楼层连续、没有重叠的普通总结');
  }
  return parsed;
}
