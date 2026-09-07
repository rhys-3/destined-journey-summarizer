import { errorCatched } from './errorHandler.js';
import { readStore, patchSummaryStore } from '../platform/store.js';
import { assertRecordWritable } from '../platform/lifecycle.js';
import { readArchive, writeArchive, fingerprint, currentSources, recordValid, sourceFloors, sourcesMatch, excludeRange, parseRange, consecutiveSummaries } from './provenance.js';
import { helperApi } from '../platform/ambient.js';
import { CONFIG } from './config.js';
import { feedback } from './feedback.js';
import { allFloorMessages, readVisibilityOverrides, readVisibilityAutomation } from './visibility.js';
import { parseSummaryEntryName, parseMegaSummaryEntryName, isMegaSummaryEntry, normalizeWorldbookEntries } from './utils.js';
import { getSettings, getMegaSummaryMap, setMegaSummaryMapping, getMegaSummaryMapping, deleteMegaSummaryMapping } from './storage.js';
import { captureContext, checkContext, createWorldbook, rebindGlobalWorldbooks, createWorldbookEntries, updateWorldbookWith, setChatMessages, writeVariableKeys, replaceWorldbook, deleteWorldbook } from '../platform/lifecycle.js';
/**
 * worldbook.js
 * 世界书绑定、条目管理、楼层可见性
 * 依赖: config.js, utils.js, storage.js, errorHandler.js
 */

let _cachedChatWbName = null;
const AUTO_HIDDEN_FLOORS_VAR_KEY = "summary_assistant_auto_hidden_floors";

// ---- 世界书名称与绑定 ----

const generateDefaultWorldbookName = () => {
  const suffix =
    Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return `${CONFIG.WORLDBOOK_NAME_PREFIX}_${suffix}`;
};

const readChatWorldbookBinding = () => {
  try {
    const vars = getVariables({ type: "chat" });
    const name = vars?.[CONFIG.CHAT_WB_VAR_KEY];
    return name && typeof name === "string" ? name : null;
  } catch (e) {
    return null;
  }
};

const writeChatWorldbookBinding = (name) => {
  try {
    writeVariableKeys(
      { [CONFIG.CHAT_WB_VAR_KEY]: name || "", summary_assistant_binding_paused: false },
      { type: "chat" },
    );
    _cachedChatWbName = name || null;
  } catch (e) {
    console.warn("写入聊天世界书绑定失败:", e);
    throw e;
  }
};

const clearChatWorldbookBinding = () => {
  try {
    writeVariableKeys({ [CONFIG.CHAT_WB_VAR_KEY]: "" }, { type: "chat" });
    _cachedChatWbName = null;
  } catch (e) {
    console.warn("清除聊天世界书绑定失败:", e);
    throw e;
  }
};

const getActiveWorldbookName = () => {
  return readChatWorldbookBinding();
};

const isChatWorldbookBound = () => {
  return !!getActiveWorldbookName();
};

// ---- 世界书绑定/解绑 ----

export const getManagedSummaryBookNames = () => [...new Set([...(readStore().summary_assistant_books ?? []), readChatWorldbookBinding()].filter(Boolean))];
function registerSummaryBook(name) { patchSummaryStore({ summary_assistant_books: [...new Set([...getManagedSummaryBookNames(),name])] }); }
const bindWorldbookToChat = errorCatched(async (name, { legacy = false } = {}) => {
  assertRecordWritable();
  if (!name) return;
  const names = await getWorldbookNames();
  if (!names.includes(name)) {
    await createWorldbook(name, []);
    feedback.info(`已创建新世界书: "${name}"`);
  }
  registerSummaryBook(name);
  if (
    typeof getGlobalWorldbookNames === "function" &&
    typeof rebindGlobalWorldbooks === "function"
  ) {
    const globalNames = getGlobalWorldbookNames() || [];
    await syncOwnedBinding(name);
  }
  writeChatWorldbookBinding(name);
});

const unbindWorldbookFromChat = errorCatched(async () => {
  assertRecordWritable();
  const name = getActiveWorldbookName();
  if (!name) return;
  if (
    typeof getGlobalWorldbookNames === "function" &&
    typeof rebindGlobalWorldbooks === "function"
  ) {
    const globalNames = getGlobalWorldbookNames() || [];
    await syncOwnedBinding(null);
  }
  await applySummarizedFloorsVisibility({ autoHide: false });
  clearChatWorldbookBinding();
  writeVariableKeys({ summary_assistant_binding_paused: true }, { type: 'chat' });
});

// ---- 聊天切换处理 ----

const onChatChanged = async () => reconcileChatBinding();

// ---- 旧版迁移 ----

const migrateOldWorldbookName = errorCatched(async () => {
  if (readChatWorldbookBinding()) return;
  try {
    const scriptVars = getVariables({ type: "script" });
    const settings = scriptVars?.[CONFIG.SETTINGS_VAR_KEY];
    if (settings && settings.worldbookName) {
      const oldName = settings.worldbookName;
      const names = await getWorldbookNames();
      if (names.includes(oldName)) {
        await bindWorldbookToChat(oldName, { legacy: true });
        feedback.info(`已将旧版世界书绑定迁移到当前聊天: "${oldName}"`);
      }
      delete settings.worldbookName;
      writeVariableKeys(
        { [CONFIG.SETTINGS_VAR_KEY]: settings },
        { type: "script" },
      );
      return;
    }
  } catch (e) {}
  // Only explicit legacy bindings are migrated; names and depths are not ownership evidence.
});

// ---- 世界书条目迁移 ----

const migrateWorldbookEntries = errorCatched(async (oldName, newName) => {
  assertRecordWritable();
  if (oldName === newName) return;
  const names = await getWorldbookNames();
  if (!names.includes(newName)) {
    await createWorldbook(newName, []);
  }
  registerSummaryBook(newName);
  if (names.includes(oldName)) {
    const oldEntries = normalizeWorldbookEntries(await getWorldbook(oldName));
    const summaryEntries = oldEntries.filter(
      (e) => e && (parseSummaryEntryName(e.name) || parseMegaSummaryEntryName(e.name)),
    );
    if (summaryEntries.length > 0) {
      const newEntries = normalizeWorldbookEntries(await getWorldbook(newName));
      if (summaryEntries.some(entry => newEntries.some(existing => existing.name === entry.name && existing.content !== entry.content))) throw new Error('目标世界书已有不同内容的同名总结，请先处理重名条目');
      const newByName = new Map(newEntries.map((e) => [e.name, e]));
      for (const entry of summaryEntries) {
        newByName.set(entry.name, { ...entry });
      }
      await replaceWorldbook(newName, [...newByName.values()]);
      const actual = normalizeWorldbookEntries(await getWorldbook(newName));
      if (!summaryEntries.every(entry => actual.some(item => item.name === entry.name && item.content === entry.content))) throw new Error('迁移后的记录校验失败，原书已保留');
      writeArchive(readArchive(oldName), newName);
      const remaining = oldEntries.filter(
        (e) => !e || (!parseSummaryEntryName(e.name) && !parseMegaSummaryEntryName(e.name)),
      );
      if (remaining.length === 0) {
        await deleteWorldbook(oldName);
        if (
          typeof getGlobalWorldbookNames === "function" &&
          typeof rebindGlobalWorldbooks === "function"
        ) {
          const globalNames = getGlobalWorldbookNames() || [];
          if (globalNames.includes(oldName) && (readStore().summary_assistant_owned_books ?? []).includes(oldName)) {
            await rebindGlobalWorldbooks(
              globalNames.filter((n) => n !== oldName),
            );
          }
        }
      } else {
        await replaceWorldbook(oldName, remaining);
      }
      feedback.success(
        `已将 ${summaryEntries.length} 个总结条目从 "${oldName}" 迁移到 "${newName}"`,
      );
    }
  }
  if (
    typeof getGlobalWorldbookNames === "function" &&
    typeof rebindGlobalWorldbooks === "function"
  ) {
    const globalNames = getGlobalWorldbookNames() || [];
    await syncOwnedBinding(newName);
  }
  writeChatWorldbookBinding(newName);
});

// ---- 条目读写 ----

const getWorldbookEntriesSafe = errorCatched(async () => {
  const wbName = getActiveWorldbookName();
  if (!wbName) return [];
  const names = await getWorldbookNames();
  if (!names.includes(wbName)) return [];
  const wb = await getWorldbook(wbName);
  return normalizeWorldbookEntries(wb);
});

const ensureWorldbookExists = errorCatched(async ({ taskId } = {}) => {
  assertRecordWritable(taskId);
  let wbName = getActiveWorldbookName();
  if (!wbName) {
    if (getVariables({ type: 'chat' })?.summary_assistant_binding_paused) throw new Error('本聊天已解绑，请先绑定独立总结世界书');
    wbName = generateDefaultWorldbookName();
    await createWorldbook(wbName, []);
    registerSummaryBook(wbName);
    writeChatWorldbookBinding(wbName);
    await syncOwnedBinding(wbName);
    feedback.info(`已自动创建并绑定世界书: "${wbName}"`);
    return;
  }
  const names = await getWorldbookNames();
  if (!names.includes(wbName)) {
    throw new Error('本聊天的总结世界书已不存在，请重新绑定');
  }
  if (
    typeof getGlobalWorldbookNames === "function" &&
    typeof rebindGlobalWorldbooks === "function"
  ) {
    const globalNames = getGlobalWorldbookNames() || [];
    if (!globalNames.includes(wbName)) {
      await syncOwnedBinding(wbName);
      feedback.info(`已将世界书加入全局启用: "${wbName}"`);
    }
  }
});

// ---- 楼层可见性 ----

const VISIBILITY_CHUNK_SIZE = 200;

const isEntryDisabled = (e) => {
  if (!e || typeof e !== "object") return true;
  if (typeof e.enabled === "boolean") return !e.enabled;
  if (typeof e.disable === "boolean") return e.disable;
  if (typeof e.disabled === "boolean") return e.disabled;
  return false;
};

const applyEntryDepthAndOrder = (entry, order) => {
  if (!entry || typeof entry !== "object") return;
  entry.strategy = {
    ...(entry.strategy && typeof entry.strategy === "object"
      ? entry.strategy
      : {}),
    type: "constant",
    keys: Array.isArray(entry.strategy?.keys)
      ? entry.strategy.keys
      : [entry.name || ""],
    keys_secondary: entry.strategy?.keys_secondary || {
      logic: "and_any",
      keys: [],
    },
    scan_depth: entry.strategy?.scan_depth ?? "same_as_global",
  };
  entry.position = {
    type: "at_depth",
    role: CONFIG.ENTRY_ROLE,
    depth: parseMegaSummaryEntryName(entry.name) ? CONFIG.MEGA_SUMMARY_DEPTH : CONFIG.ENTRY_DEPTH,
    order,
  };
};

const addFloorRangeToSet = (set, parsed, lastId) => {
  if (!set || !parsed || lastId < 0) return;
  const start = Math.max(0, parsed.start);
  const end = Math.min(lastId, parsed.end);
  for (let i = start; i <= end; i++) {
    set.add(i);
  }
};

const buildSummarizedFloorSet = (entries, lastId, megaSummaryMap = {}, archive = { records: {} }, sources = null) => {
  const set = new Set();
  if (!Array.isArray(entries) || lastId < 0) return set;

  for (const e of entries) {
    if (!e || isEntryDisabled(e)) continue;
    if (sources && !recordValid(e, archive, sources, entries)) continue;
    if (archive.records[e.name]?.invalid || archive.records[e.name]?.committed === false) continue;
    if (archive.records[e.name]) { for (const id of sourceFloors(e, archive, megaSummaryMap, lastId)) set.add(id); continue; }

    const summaryParsed = parseSummaryEntryName(e.name);
    if (summaryParsed) {
      addFloorRangeToSet(set, summaryParsed, lastId);
      continue;
    }

    const megaParsed = parseMegaSummaryEntryName(e.name);
    if (!megaParsed) continue;

    const mappedSummaryNames = megaSummaryMap?.[e.name];
    if (!Array.isArray(mappedSummaryNames)) continue;
    for (const summaryName of mappedSummaryNames) {
      const mappedParsed = parseSummaryEntryName(summaryName);
      if (mappedParsed) {
        addFloorRangeToSet(set, mappedParsed, lastId);
      }
    }
  }

  return set;
};

const loadAutoHiddenFloorIds = () => {
  try {
    const vars = getVariables({ type: "chat" });
    const value = vars?.[AUTO_HIDDEN_FLOORS_VAR_KEY];
    if (!Array.isArray(value)) return new Set();
    return new Set(
      value
        .map((id) => Number.parseInt(id, 10))
        .filter((id) => Number.isFinite(id) && id >= 0),
    );
  } catch (e) {
    console.warn("加载自动隐藏楼层记录失败:", e);
    return new Set();
  }
};

const saveAutoHiddenFloorIds = (floorIds) => {
  try {
    const list = [...new Set([...floorIds])]
      .filter((id) => Number.isFinite(id) && id >= 0)
      .sort((a, b) => a - b);
    writeVariableKeys(
      { [AUTO_HIDDEN_FLOORS_VAR_KEY]: list },
      { type: "chat" },
    );
  } catch (e) {
    console.warn("保存自动隐藏楼层记录失败:", e);
    throw e;
  }
};

const applySummarizedFloorsVisibility = errorCatched(async ({ taskId, autoHide } = {}) => {
  assertRecordWritable(taskId);
  const settings = getSettings();
  const shouldAutoHide = autoHide ?? readVisibilityAutomation(settings.autoHideSummarizedFloors);
  const lastId = getLastMessageId();
  if (lastId < 0) return false;
  const entries = await getWorldbookEntriesSafe();
  const megaSummaryMap = await getMegaSummaryMap();
  const summarizedSet = buildSummarizedFloorSet(
    entries,
    lastId,
    megaSummaryMap,
    readArchive(), currentSources(),
  );
  const previousAutoHiddenSet = loadAutoHiddenFloorIds();
  const messages = allFloorMessages(), overrides = readVisibilityOverrides(messages);
  const updates = [];
  const nextAutoHiddenSet = new Set();
  for (const message of messages) {
    const id = message.message_id;
    // Manual actions happen once; the paused policy does not reapply them.
    if (overrides[id]) continue;
    const currentHidden = !!message.is_hidden;
    let targetHidden = currentHidden;
    // Losing summary coverage must still restore our own hidden source text.
    if (previousAutoHiddenSet.has(id) && (autoHide === false || !summarizedSet.has(id))) targetHidden = false;
    else if (shouldAutoHide && summarizedSet.has(id)) targetHidden = true;
    if (targetHidden && (!currentHidden || previousAutoHiddenSet.has(id))) nextAutoHiddenSet.add(id);
    if (currentHidden !== targetHidden) updates.push({message_id:id,is_hidden:targetHidden});
  }
  if (updates.length === 0) {
    saveAutoHiddenFloorIds(nextAutoHiddenSet);
    return false;
  }
  // Write ownership before host changes, so partial writes can be recovered safely.
  saveAutoHiddenFloorIds(new Set([...previousAutoHiddenSet, ...nextAutoHiddenSet]));
  const uniqueUpdates = [...new Map(updates.filter(update => update.message_id <= lastId).map(update => [update.message_id, update])).values()];
  for (let i = 0; i < uniqueUpdates.length; i += VISIBILITY_CHUNK_SIZE) {
    await setChatMessages(uniqueUpdates.slice(i, i + VISIBILITY_CHUNK_SIZE), { refresh: 'affected' });
  }
  const actual = getChatMessages(`0-${lastId}`, { role: 'all', hide_state: 'all', include_swipes: false });
  if (!uniqueUpdates.every(update => actual.some(message => message.message_id === update.message_id && !!message.is_hidden === update.is_hidden))) throw new Error('楼层显隐同步未完成');
  saveAutoHiddenFloorIds(nextAutoHiddenSet);
  return true;
});

// ---- 条目排序与写入 ----

const buildSummaryOrderMap = (worldbookEntries, extraNameToInclude = null) => {
  const names = new Set();
  for (const e of worldbookEntries || []) {
    if (!e || typeof e.name !== "string") continue;
    if (parseSummaryEntryName(e.name)) names.add(e.name);
  }
  if (extraNameToInclude && parseSummaryEntryName(extraNameToInclude))
    names.add(extraNameToInclude);
  const list = [...names]
    .map((n) => ({ name: n, ...parseSummaryEntryName(n) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const map = new Map();
  list.forEach((item, idx) => {
    map.set(item.name, CONFIG.ENTRY_START_ORDER + idx);
  });
  return map;
};

const reorderAllSummaryEntries = errorCatched(async () => {
  const wbName = getActiveWorldbookName();
  if (!wbName) return;
  const entries = await getWorldbookEntriesSafe();
  const orderMap = buildSummaryOrderMap(entries);
  if (orderMap.size === 0) return;
  await updateWorldbookWith(wbName, (wb) => {
    const arr = normalizeWorldbookEntries(wb);
    for (const e of arr) {
      if (!e || typeof e.name !== "string") continue;
      if (orderMap.has(e.name)) {
        applyEntryDepthAndOrder(e, orderMap.get(e.name));
      }
    }
    return Array.isArray(wb) ? arr : { ...wb, entries: arr };
  });
});

const upsertSummaryEntryByName = errorCatched(async (name, content, options = {}) => {
  await commitArchiveEntry(name, content, { preserveDisabled: true, ...options });
  await applySummarizedFloorsVisibility(options);
});

const deleteSummaryEntry = errorCatched(async (entryName) => {
  assertRecordWritable(); excludeRange(entryName);
  const wbName = getActiveWorldbookName();
  if (!wbName) return;
  await updateWorldbookWith(wbName, (wb) => {
    const arr = normalizeWorldbookEntries(wb);
    const filtered = arr.filter((e) => e && e.name !== entryName);
    return Array.isArray(wb) ? filtered : { ...wb, entries: filtered };
  });
  await reorderAllSummaryEntries();
  await auditArchiveSources();
  await applySummarizedFloorsVisibility();
});

export const setSummaryEntryEnabled = errorCatched(async (entryName, enabled) => {
  assertRecordWritable();
  if (!enabled) excludeRange(entryName);
  const wbName=getActiveWorldbookName();
  if(!wbName)throw new Error('当前聊天没有绑定总结世界书');
  const map=await getMegaSummaryMap();
  await updateWorldbookWith(wbName, wb=>{
    const entries=normalizeWorldbookEntries(wb);
    if(enabled && entries.some(entry=>!isEntryDisabled(entry)&&parseMegaSummaryEntryName(entry.name)&&map[entry.name]?.includes(entryName)))throw new Error('该条目已被大总结包含，请先回档对应的大总结');
    const entry=entries.find(e=>e.name===entryName);
    if(!entry)throw new Error('总结条目已不存在');
    if(enabled&&!recordValid(entry,readArchive(),currentSources(),entries))throw new Error('来源已变化，请先重新生成该条目');
    entry.enabled=enabled;entry.disable=!enabled;if('disabled' in entry)entry.disabled=!enabled;
    return Array.isArray(wb)?entries:{...wb,entries};
  });
  await applySummarizedFloorsVisibility();
});

// ---- 条目查询 ----

const getAllSummaryEntriesForDisplay = errorCatched(async () => {
  const entries = await getWorldbookEntriesSafe();
  return entries
    .filter((e) => e && parseSummaryEntryName(e.name))
    .map((e) => ({ name: e.name, disabled: isEntryDisabled(e), invalid: readArchive().records[e.name]?.invalid ?? null }))
    .sort(
      (a, b) =>
        (parseSummaryEntryName(a.name)?.start ?? 0) -
        (parseSummaryEntryName(b.name)?.start ?? 0),
    );
});

const getLastSummarizedFloor = errorCatched(async () => {
  const { floors } = await getCoverage(); return floors.size ? Math.max(...floors) : -1;
});

const getAllSummaryContents = errorCatched(async () => {
  const entries = await getWorldbookEntriesSafe(), archive=readArchive(), sources=currentSources();
  return entries
    .filter(
      (e) =>
        e && e.content && !isEntryDisabled(e) && parseRange(e.name) && recordValid(e, archive, sources, entries),
    )
    .sort(
      (a, b) =>
        (parseRange(a.name)?.start ?? 0) -
        (parseRange(b.name)?.start ?? 0),
    )
    .map((e) => ({ name: e.name, content: e.content }));
});

const getSummaryContentsBefore = errorCatched(async (entryName) => {
  const all = await getAllSummaryContents();
  const targetStart = parseRange(entryName)?.start;
  if (targetStart === undefined) return all;
  return all.filter(
    (e) => (parseRange(e.name)?.end ?? Infinity) < targetStart,
  );
});

// ---- 大总结条目管理 ----

const upsertMegaSummaryEntry = errorCatched(async (name, content, summaryNames, options = {}) => {
  const entries = await getWorldbookEntriesSafe(), archive = readArchive(), current = currentSources();
  const sources = [...new Map(summaryNames.flatMap(parent => archive.records[parent]?.sources ?? current.filter(source => { const range = parseRange(parent); return source.id >= range.start && source.id <= range.end; })).map(source => [source.id, source])).values()];
  await commitArchiveEntry(name, content, { ...options, summaryNames, sources: sources.length ? sources : undefined, parents: summaryNames.map(parent => ({ name: parent, fingerprint: fingerprint(entries.find(entry => entry.name === parent)?.content ?? '') })) });
  await applySummarizedFloorsVisibility(options);
});

const reorderAllMegaSummaryEntries = errorCatched(async () => {
  const wbName = getActiveWorldbookName();
  if (!wbName) return;
  const entries = await getWorldbookEntriesSafe();

  const megaEntries = entries
    .filter((e) => e && isMegaSummaryEntry(e.name))
    .sort((a, b) => {
      const aStart = parseMegaSummaryEntryName(a.name)?.start ?? 0;
      const bStart = parseMegaSummaryEntryName(b.name)?.start ?? 0;
      return aStart - bStart;
    });

  if (megaEntries.length === 0) return;

  await updateWorldbookWith(wbName, (wb) => {
    const arr = normalizeWorldbookEntries(wb);
    megaEntries.forEach((megaEntry, idx) => {
      const target = arr.find((e) => e && e.name === megaEntry.name);
      if (target) {
        target.strategy = {
          ...(target.strategy && typeof target.strategy === "object"
            ? target.strategy
            : {}),
          type: "constant",
          keys: [target.name],
          keys_secondary: { logic: "and_any", keys: [] },
          scan_depth: "same_as_global",
        };
        target.position = {
          type: "at_depth",
          role: CONFIG.ENTRY_ROLE,
          depth: CONFIG.MEGA_SUMMARY_DEPTH,
          order: idx + 1,
        };
      }
    });
    return Array.isArray(wb) ? arr : { ...wb, entries: arr };
  });
});

const deleteMegaSummaryEntry = errorCatched(async (entryName) => {
  assertRecordWritable(); excludeRange(entryName); excludeRange(entryName, { mega: true });
  const wbName = getActiveWorldbookName();
  if (!wbName) return;

  // 删除条目
  await updateWorldbookWith(wbName, (wb) => {
    const arr = normalizeWorldbookEntries(wb);
    const filtered = arr.filter((e) => e && e.name !== entryName);
    return Array.isArray(wb) ? filtered : { ...wb, entries: filtered };
  });

  // 删除映射
  await deleteMegaSummaryMapping(entryName);

  // 重新排序
  await reorderAllMegaSummaryEntries();

  await applySummarizedFloorsVisibility();
});

async function toggleMegaSummary(name, enabled, remove = false) {
  assertRecordWritable();
  const summaryNames = await getMegaSummaryMapping(name);
  if (!summaryNames?.length) throw new Error('没有找到原始总结来源映射');
  const { entries, archive, sources } = await getCoverage();
  if (enabled) {
    consecutiveSummaries(summaryNames);
    if (!recordValid(entries.find(entry=>entry.name===name),archive,sources,entries)) throw new Error('来源已变化，请先重新生成大总结');
    const range=parseRange(name);
    if(entries.some(entry=>entry.name!==name&&parseMegaSummaryEntryName(entry.name)&&!isEntryDisabled(entry)&&parseRange(entry.name).end>=range.start&&parseRange(entry.name).start<=range.end))throw new Error('范围与另一条启用的大总结重叠');
  } else excludeRange(name,{mega:true});
  await updateWorldbookWith(getActiveWorldbookName(),wb=>{
    const list=normalizeWorldbookEntries(wb);
    for(const entry of list) {
      if(entry.name===name)setEnabled(entry,enabled);
      if(summaryNames.includes(entry.name))setEnabled(entry,!enabled&&recordValid(entry,archive,sources,list));
    }
    return reorderEntries(remove?list.filter(entry=>entry.name!==name):list);
  });
  if(remove)await deleteMegaSummaryMapping(name);
  await applySummarizedFloorsVisibility();
}
const restoreMegaSummaryToSummaries = name => toggleMegaSummary(name,false,true);
const deactivateMegaSummaryEntry = name => toggleMegaSummary(name,false);
const activateMegaSummaryEntry = name => toggleMegaSummary(name,true);

const getAllMegaSummaryEntriesForDisplay = errorCatched(async () => {
  const entries = await getWorldbookEntriesSafe();
  return entries
    .filter((e) => e && isMegaSummaryEntry(e.name))
    .map((e) => ({ name: e.name, disabled: isEntryDisabled(e), invalid: readArchive().records[e.name]?.invalid ?? null }))
    .sort(
      (a, b) =>
        (parseMegaSummaryEntryName(a.name)?.start ?? 0) -
        (parseMegaSummaryEntryName(b.name)?.start ?? 0),
    );
});

const getMegaSummaryContentsBefore = errorCatched(async (entryName) => {
  const entries = await getWorldbookEntriesSafe();
  const targetStart = parseMegaSummaryEntryName(entryName)?.start;
  if (targetStart === undefined) return [];

  return entries
    .filter((e) => {
      if (!e || !e.content || isEntryDisabled(e)) return false;
      const parsed = parseMegaSummaryEntryName(e.name);
      if (!parsed) return false;
      return parsed.end < targetStart;
    })
    .sort(
      (a, b) =>
        (parseMegaSummaryEntryName(a.name)?.start ?? 0) -
        (parseMegaSummaryEntryName(b.name)?.start ?? 0),
    )
    .map((e) => ({ name: e.name, content: e.content }));
});

const reconcileChatBinding = async () => {
  const token = captureContext(), name = readChatWorldbookBinding();
  const names = await getWorldbookNames(); checkContext(token);
  const catalog = readStore().summary_assistant_books ?? [];
  const existing = catalog.filter(book => names.includes(book));
  if (JSON.stringify(existing) !== JSON.stringify(catalog)) patchSummaryStore({ summary_assistant_books: existing });
  if (name && !names.includes(name)) {
    await applySummarizedFloorsVisibility({ autoHide: false });
    clearChatWorldbookBinding();
    writeVariableKeys({ summary_assistant_binding_paused: true }, { type: 'chat' });
  }
  await syncOwnedBinding(name && names.includes(name) ? name : null);
  return names;
};

async function syncOwnedBinding(name) {
  const token = captureContext(), owned = new Set(readStore().summary_assistant_owned_books ?? []);
  const before = helperApi('getGlobalWorldbookNames')() ?? [];
  const next = before.filter(book => !owned.has(book) || book === name);
  if (name && !next.includes(name)) next.push(name);
  if (JSON.stringify(next) !== JSON.stringify(before)) {
    try { await helperApi('rebindGlobalWorldbooks')(next); }
    finally {
      const actual = helperApi('getGlobalWorldbookNames')() ?? [], stillOwned = [...owned].filter(book => actual.includes(book));
      if (name && !before.includes(name) && actual.includes(name)) stillOwned.push(name);
      patchSummaryStore({ summary_assistant_owned_books: [...new Set(stillOwned)] });
    }
    checkContext(token);
  }
  _cachedChatWbName = name;
}
export async function deleteBoundSummaryBook() {
  assertRecordWritable();
  const name = getActiveWorldbookName(); if (!name) return;
  const entries = await getWorldbookEntriesSafe(), remaining = entries.filter(entry => !parseRange(entry?.name));
  await applySummarizedFloorsVisibility({ autoHide: false });
  if (remaining.length) await replaceWorldbook(name, remaining); else await deleteWorldbook(name);
  await syncOwnedBinding(null); clearChatWorldbookBinding();
  patchSummaryStore({ summary_assistant_books: (readStore().summary_assistant_books ?? []).filter(book => book !== name) });
  writeArchive({ records: {}, excluded: [] }, name);
  writeVariableKeys({ [CONFIG.MEGA_SUMMARY_VAR_KEY]: {} }, { type: 'chat' });
  writeVariableKeys({ summary_assistant_binding_paused: true }, { type: 'chat' });
  return { keptOtherEntries: remaining.length };
}
export async function getCoverage() {
  const entries = await getWorldbookEntriesSafe(), megaMap = await getMegaSummaryMap(), archive = readArchive(), sources = currentSources();
  return { entries, megaMap, archive, sources, floors: buildSummarizedFloorSet(entries, getLastMessageId(), megaMap, archive, sources) };
}
export async function auditArchiveSources({ taskId } = {}) {
  assertRecordWritable(taskId);
  const { entries, megaMap, archive, sources } = await getCoverage();
  let changed = false; const invalid = [];
  for (const entry of entries.filter(entry => parseRange(entry.name))) {
    if (!archive.records[entry.name]) {
      const ids = new Set(sourceFloors(entry, archive, megaMap, getLastMessageId()));
      archive.records[entry.name] = { sources: sources.filter(source => ids.has(source.id)), legacy: true, committed: true }; changed = true;
    }
    const record = archive.records[entry.name];
    if (!recordValid(entry, archive, sources, entries) && record.committed !== false) {
      if (!record.invalid) { record.invalid = '来源楼层、回复版本或原总结已变化'; changed = true; }
      if (!isEntryDisabled(entry)) invalid.push(entry.name);
    }
  }
  if (changed) writeArchive(archive);
  if (invalid.length) await updateWorldbookWith(getActiveWorldbookName(), wb => {
    const list = normalizeWorldbookEntries(wb); for (const entry of list) if (invalid.includes(entry.name)) setEnabled(entry, false); return list;
  });
  return invalid;
}
const setEnabled = (entry, value) => { entry.enabled = value; entry.disable = !value; if ('disabled' in entry) entry.disabled = !value; };
function reorderEntries(entries) {
  for (const mega of [false, true]) entries.filter(entry => mega ? parseMegaSummaryEntryName(entry.name) : parseSummaryEntryName(entry.name)).sort((a, b) => parseRange(a.name).start - parseRange(b.name).start).forEach((entry, i) => applyEntryDepthAndOrder(entry, (mega ? 1 : CONFIG.ENTRY_START_ORDER) + i));
  return entries;
}
// Visibility is separate; provenance stays uncommitted until read-back succeeds.
export async function commitArchiveEntry(name, content, { taskId, sources, parents, summaryNames = [], preserveDisabled = false } = {}) {
  assertRecordWritable(taskId);
  if (!content?.trim()) throw new Error('总结正文不能为空');
  const range = parseRange(name), mega = !!parseMegaSummaryEntryName(name);
  if (!range) throw new Error('总结条目名称无效');
  if (mega) consecutiveSummaries(summaryNames);
  await ensureWorldbookExists({ taskId });
  const book = getActiveWorldbookName(), archive = readArchive(book), entries = await getWorldbookEntriesSafe();
  const existing = entries.find(entry => entry.name === name);
  if (sources && !sourcesMatch(sources)) throw new Error('来源已变化，请重新生成本次总结');
  if (mega && !summaryNames.every(parent => entries.some(entry => entry.name === parent && entry.content))) throw new Error('大总结来源记录不完整');
  const keepDisabled = !!(preserveDisabled && existing && isEntryDisabled(existing));
  const metadata = { ...archive.records[name], sources: sources ?? archive.records[name]?.sources ?? currentSources().filter(source => source.id >= range.start && source.id <= range.end), parents: parents ?? archive.records[name]?.parents ?? [], committed: false, invalid: null };
  archive.records[name] = metadata; writeArchive(archive, book);
  if (!existing) {
    const entry = { name, content: content.trim(), enabled: false, probability: 100, recursion: { prevent_incoming: true, prevent_outgoing: true, delay_until: null }, effect: { sticky: null, cooldown: null, delay: null } };
    applyEntryDepthAndOrder(entry, CONFIG.ENTRY_START_ORDER); await createWorldbookEntries(book, [entry]);
  }
  if (mega) await setMegaSummaryMapping(name, summaryNames);
  await updateWorldbookWith(book, wb => {
    const list = normalizeWorldbookEntries(wb), entry = list.find(item => item.name === name);
    if (!entry) throw new Error('待保存条目已不存在');
    entry.content = content.trim(); setEnabled(entry, !keepDisabled);
    if (mega && !keepDisabled) for (const item of list) if (summaryNames.includes(item.name)) setEnabled(item, false);
    return reorderEntries(list);
  });
  const actual = await getWorldbookEntriesSafe();
  if (!actual.some(entry => entry.name === name && entry.content === content.trim() && isEntryDisabled(entry) === keepDisabled)) throw new Error('总结保存后校验失败');
  if (sources && !sourcesMatch(sources)) throw new Error('保存期间来源发生变化，请重新生成');
  metadata.committed = true; archive.excluded = archive.excluded.filter(item => item.end < range.start || item.start > range.end);
  writeArchive(archive, book); return name;
}

export { _cachedChatWbName, AUTO_HIDDEN_FLOORS_VAR_KEY, generateDefaultWorldbookName, readChatWorldbookBinding, writeChatWorldbookBinding, clearChatWorldbookBinding, getActiveWorldbookName, isChatWorldbookBound, bindWorldbookToChat, unbindWorldbookFromChat, onChatChanged, migrateOldWorldbookName, migrateWorldbookEntries, getWorldbookEntriesSafe, ensureWorldbookExists, VISIBILITY_CHUNK_SIZE, isEntryDisabled, applyEntryDepthAndOrder, addFloorRangeToSet, buildSummarizedFloorSet, loadAutoHiddenFloorIds, saveAutoHiddenFloorIds, applySummarizedFloorsVisibility, buildSummaryOrderMap, reorderAllSummaryEntries, upsertSummaryEntryByName, deleteSummaryEntry, getAllSummaryEntriesForDisplay, getLastSummarizedFloor, getAllSummaryContents, getSummaryContentsBefore, upsertMegaSummaryEntry, reorderAllMegaSummaryEntries, deleteMegaSummaryEntry, restoreMegaSummaryToSummaries, deactivateMegaSummaryEntry, activateMegaSummaryEntry, getAllMegaSummaryEntriesForDisplay, getMegaSummaryContentsBefore, reconcileChatBinding };
