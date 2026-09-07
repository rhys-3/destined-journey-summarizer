import { getSettings, getMegaSummaryMapping } from './storage.js';
import { getRawMessages, processMessagesByTags, messagesToMergedText } from './messages.js';
import { getWorldbookEntriesSafe, getSummaryContentsBefore, isEntryDisabled } from './worldbook.js';
import { sourceOf, sourcesMatch, fingerprint, readArchive, parseRange, consecutiveSummaries, recordValid, currentSources } from './provenance.js';
import { makeSummaryEntryName } from './utils.js';

export async function buildSummaryPromptParams(startFloor, endFloor, settings = getSettings()) {
  if (!Number.isInteger(startFloor) || !Number.isInteger(endFloor) || startFloor < 0 || endFloor < startFloor) throw new Error('请输入从 0 开始、起点不大于终点的整数楼层范围');
  if (endFloor > getLastMessageId()) throw new Error('本次来源楼层已删除，请重新选择范围');
  const raw = await getRawMessages(startFloor, endFloor);
  const processed = processMessagesByTags(raw, settings.includeTags, settings.excludeTags, settings.excludeHtmlComments);
  if (!processed.length || !processed.some(message => message.role === 'assistant')) throw new Error('本次范围没有可归档的 AI 正文，请检查提取标签');
  const included = new Set(processed.map(message => message.id));
  // An untagged opening has no story material, but is retired with the first
  // successful batch. Its fingerprint still invalidates that batch if edited.
  if (raw.some(message => message.id === 0)) included.add(0);
  const sources = raw.filter(message => included.has(message.id)).map(sourceOf);
  const history = settings.includeOldSummary ? await getSummaryContentsBefore(makeSummaryEntryName(startFloor, endFloor)) : [];
  return { kind: 'normal', startFloor, endFloor, promptBlocks: settings.promptBlocks, oldSummaryContent: history.map(entry => '[' + entry.name + ']\n' + entry.content).join('\n\n'), mergedChatText: messagesToMergedText(processed, settings.userPrefix, settings.assistantPrefix), scanText: raw.map(message => message.message).join('\n'), sources, parents: [] };
}
export async function buildRegeneratePromptParams(entryName, settings = getSettings()) {
  const range = parseRange(entryName); if (!range) throw new Error('总结条目名称无效');
  return buildSummaryPromptParams(range.start, range.end, settings);
}
export async function buildMegaSummaryPromptParams(summaryNames, entryName = null, settings = getSettings()) {
  const ranges = consecutiveSummaries(summaryNames), entries = await getWorldbookEntriesSafe(), archive = readArchive(), current = currentSources();
  const selected = ranges.map(range => entries.find(entry => entry.name === range.name));
  if (selected.some(entry => !entry?.content || !recordValid(entry, archive, current, entries) || (!entryName && isEntryDisabled(entry)))) throw new Error('大总结来源已失效、停用或缺失，请先处理普通总结');
  const startFloor = ranges[0].start, endFloor = ranges.at(-1).end;
  const sources = [...new Map(selected.flatMap(entry => archive.records[entry.name]?.sources ?? current.filter(source => { const range = parseRange(entry.name); return source.id >= range.start && source.id <= range.end; })).map(source => [source.id, source])).values()];
  if (!sourcesMatch(sources, current)) throw new Error('大总结的原始楼层已变化');
  const history = settings.includeOldSummary ? await getSummaryContentsBefore(entryName ?? '总结' + startFloor + '-' + endFloor + '楼') : [];
  const mergedSummaryText = selected.map(entry => '[' + entry.name + ']\n' + entry.content).join('\n\n');
  return { kind: 'mega', startFloor, endFloor, promptBlocks: settings.megaPromptBlocks, oldMegaSummaryContent: history.map(entry => '[' + entry.name + ']\n' + entry.content).join('\n\n'), mergedSummaryText, scanText: mergedSummaryText, sources, parents: selected.map(entry => ({ name: entry.name, fingerprint: fingerprint(entry.content) })) };
}
export async function buildRegenerateMegaSummaryPromptParams(entryName, settings = getSettings()) {
  const names = await getMegaSummaryMapping(entryName); if (!names?.length) throw new Error('未找到大总结的原始总结映射');
  return buildMegaSummaryPromptParams(names, entryName, settings);
}
