import { bindPromptTools, collectCustomMacros } from './promptTools.js';
import { bindTagEditors, readTagEditor } from './tagEditor.js';
import { bindFloorBrowser, refreshFloorBrowser } from './floorBrowser.js';
import { bindBatchSettings } from './batchSettings.js';
import { applyBusyRules, refreshTaskWidget } from './taskView.js';
import { isBusy, assertRecordWritable } from '../../platform/lifecycle.js';
import { parseMegaSummaryEntryName } from '../utils.js';
import { getMegaSummaryMapping } from '../storage.js';
import { upsertMegaSummaryEntry, deleteBoundSummaryBook, deleteMegaSummaryEntry } from '../worldbook.js';
import { reconcileChatBinding } from '../worldbook.js';
import { feedback } from '../feedback.js';
import { safeErrorDetails } from '../errorHandler.js';
import { MACROS } from '../macros.js';
import { allFloorMessages, setManualFloorVisibility, setManualFloorVisibilityByIds, setFloorVisibilityAutomation } from '../visibility.js';
import { getCoverage } from '../worldbook.js';
import { renderVisibilityInfo, refreshVisibilityControls } from './visibilityView.js';
import { BLOCK_TYPES, generateBlockId, DEFAULT_PROMPT_BLOCKS, DEFAULT_MEGA_SUMMARY_PROMPT_BLOCKS } from '../config.js';
import { clampInt, escapeHtml, parseSummaryEntryName, makeMegaSummaryEntryName } from '../utils.js';
import { getKeyForUrl, getSettings, updateSettings, resetSettings, getMegaSummaryMap, deleteMegaSummaryMapping } from '../storage.js';
import { fetchModelList } from '../api.js';
import { generateDefaultWorldbookName, getActiveWorldbookName, isChatWorldbookBound, bindWorldbookToChat, unbindWorldbookFromChat, migrateWorldbookEntries, getWorldbookEntriesSafe, applySummarizedFloorsVisibility, upsertSummaryEntryByName, deleteSummaryEntry, getAllSummaryEntriesForDisplay, restoreMegaSummaryToSummaries, deactivateMegaSummaryEntry, activateMegaSummaryEntry, getAllMegaSummaryEntriesForDisplay } from '../worldbook.js';
import { startSummaryProcess, startCustomRangeSummaryProcess, regenerateAndReplaceEntry, executeMegaSummary, regenerateAndReplaceMegaEntry } from '../summary.js';
import { renderBlocks } from './panel.js';
import { renderEntryList, renderMegaEntryList, renderStatusInfo } from './renderer.js';
import { getHost, runAction, captureContext, checkContext, SillyTavern, setChatMessages } from '../../platform/lifecycle.js';
import { setSummaryEntryEnabled } from '../worldbook.js';
const actionListener = fn => (...args) => runAction(() => fn(...args));
const uiListener = fn => async (...args) => { const token=captureContext(); try { const value=await fn(...args);checkContext(token);return value; } catch(error) {if(error.name!=='AbortError')getHost().status(safeErrorDetails(error,[getSettings().customApiKey]),'error');} };
let _panelEl = null;
const showSettingsPopup = () => getHost().remount();
// ---- 设置收集 ----

const collectBlocksFromPanel = (
  overlay,
  containerId = "#sa-blocks-container",
) => {
  const container = overlay.querySelector(containerId);
  if (!container) return [];
  return [...container.querySelectorAll('.sa-block')].map(row=>({...JSON.parse(row.dataset.block),enabled:row.querySelector('[data-block-enable]').checked}));
};

const collectSettingsFromPanel = (overlay) => {
  const val = (id) => overlay.querySelector(`#${id}`)?.value ?? "";
  const checked = (id) => overlay.querySelector(`#${id}`)?.checked ?? false;
  return {
    ...getSettings(),
    batchFloorCount: clampInt(val('sa-batch-count'),1,999),
    batchPreset: val('sa-batch-preset'),
    parallelBatches: checked('sa-parallel-batches'),
    batchConcurrency: clampInt(val('sa-batch-concurrency'),1,8),
    autoMegaSummary: checked('sa-auto-mega'),
    megaTriggerCount: clampInt(val('sa-mega-trigger'),3,999),
    megaBatchCount: clampInt(val('sa-mega-batch'),2,998),
    customMacros: collectCustomMacros(overlay),
    enabled: checked("sa-enabled"),
    customApiSource: getSettings().customApiSource,
    triggerFloorCount: clampInt(val("sa-trigger-count"), 1, 999),
    keepFloorCount: clampInt(val("sa-keep-count"), 1, 999),
    includeOldSummary: checked("sa-include-old-summary"),
    autoTriggerConfirm: checked("sa-auto-confirm"),
    userPrefix: val("sa-user-prefix") || "{{user}}",
    assistantPrefix: val("sa-assistant-prefix"),
    apiMode:
      overlay.querySelector('input[name="sa-api-mode"]:checked')?.value ||
      "tavern",
    customApiUrl: val("sa-api-url"),
    customApiKey: val("sa-api-key"),
    customApiModel: val('sa-api-model-manual') || val('sa-api-model'),
    temperature: val('sa-temperature-mode')==='follow' ? 'same_as_preset' : val('sa-temperature'),
    maxTokens: val('sa-max-tokens-mode')==='follow' ? 'same_as_preset' : val('sa-max-tokens'),
    includeTags: readTagEditor(overlay,'includeTags'),
    excludeTags: readTagEditor(overlay,'excludeTags'),
    excludeHtmlComments: checked("sa-exclude-html-comments"),
    promptBlocks: collectBlocksFromPanel(overlay, "#sa-blocks-container"),
    megaPromptBlocks: collectBlocksFromPanel(
      overlay,
      "#sa-mega-blocks-container",
    ),
  };
};

// ---- 板块管理 ----

let _draggedBlockId = null;

const rerenderBlocks = (
  overlay,
  blocks,
  containerId = "#sa-blocks-container",
) => {
  const container = overlay.querySelector(containerId);
  if (!container) return;
  container.innerHTML = renderBlocks(blocks, containerId.replace("#", ""));
  overlay.dispatchEvent(new Event("summary-blocks-changed"));
};

const addNewBlock = async (overlay, containerId = "#sa-blocks-container") => {
  const result = await SillyTavern.callGenericPopup(
    "请输入新板块的名称：",
    SillyTavern.POPUP_TYPE.INPUT,
    "自定义提示词",
    { rows: 1, okButton: "创建", cancelButton: "取消" },
  );
  if (
    result === SillyTavern.POPUP_RESULT.CANCELLED ||
    typeof result !== "string" ||
    !result.trim()
  )
    return;
  const blocks = collectBlocksFromPanel(overlay, containerId);
  blocks.push({
    id: generateBlockId(),
    type: BLOCK_TYPES.PROMPT,
    name: result.trim(),
    role: "user",
    content: "",
    enabled: true,
  });
  rerenderBlocks(overlay, blocks, containerId);
};

const deleteBlock = async (
  overlay,
  blockId,
  containerId = "#sa-blocks-container",
) => {
  const cfm = await SillyTavern.callGenericPopup(
    "确定要删除这个自定义板块吗？",
    SillyTavern.POPUP_TYPE.CONFIRM,
  );
  if (cfm !== SillyTavern.POPUP_RESULT.AFFIRMATIVE) return;
  const blocks = collectBlocksFromPanel(overlay, containerId).filter(
    (b) => b.id !== blockId,
  );
  rerenderBlocks(overlay, blocks, containerId);
};

const resetBlocks = async (
  overlay,
  containerId = "#sa-blocks-container",
  defaultBlocks = DEFAULT_PROMPT_BLOCKS,
) => {
  assertRecordWritable();
  const cfm = await SillyTavern.callGenericPopup(
    "确定要重置所有提示词板块为默认值吗？",
    SillyTavern.POPUP_TYPE.CONFIRM,
  );
  if (cfm !== SillyTavern.POPUP_RESULT.AFFIRMATIVE) return;
  const defaults = defaultBlocks.map((b) => ({ ...b }));
  rerenderBlocks(overlay, defaults, containerId);
  feedback.success("提示词板块已重置");
};

const viewEditEntry = async (overlay, entryName) => {
  const entries = await getWorldbookEntriesSafe();
  const entry = entries.find((e) => e && e.name === entryName);
  if (!entry) {
    feedback.error(`未找到条目: ${entryName}`);
    return;
  }
  if (isBusy()) return getHost().viewText(entryName,entry.content || '');
  const result = await SillyTavern.callGenericPopup(
    `查看/编辑条目「${escapeHtml(entryName)}」：`,
    SillyTavern.POPUP_TYPE.INPUT,
    entry.content || "",
    { rows: 15, wide: true, recordWrite: true, okButton: "保存修改", cancelButton: "取消" },
  );
  if (
    result === SillyTavern.POPUP_RESULT.CANCELLED ||
    typeof result !== "string"
  )
    return;
  await runAction(async()=>{assertRecordWritable();if(parseMegaSummaryEntryName(entryName))await upsertMegaSummaryEntry(entryName,result,await getMegaSummaryMapping(entryName),{preserveDisabled:true});else await upsertSummaryEntryByName(entryName,result);});
  feedback.success(`已保存条目: ${entryName}`);
  await refreshEntryList(overlay);
  await refreshStatus(overlay);
};

// ---- 板块事件绑定 ----

const bindBlockEventsForContainer = (overlay, containerId, defaultBlocks) => {
  const container = overlay.querySelector(containerId);
  if (!container || container._blockEventsBound) return;
  container._blockEventsBound = true;

  container.addEventListener("click", uiListener(async (e) => {
    const target = e.target;
    if (target.closest(".sa-block-enable") || ["INPUT","TEXTAREA","SELECT"].includes(target.tagName))
      return;
    if (
      target.closest("[data-action-add-block]") ||
      target.closest("[data-action-add-mega-block]")
    ) {
      await addNewBlock(overlay, containerId);
      return;
    }
    if (target.closest("[data-action-reset-blocks]")) {
      await resetBlocks(overlay, containerId, DEFAULT_PROMPT_BLOCKS);
      return;
    }
    if (target.closest("[data-action-reset-mega-blocks]")) {
      await resetBlocks(overlay, containerId, DEFAULT_MEGA_SUMMARY_PROMPT_BLOCKS);
      return;
    }
    const deleteEl = target.closest("[data-block-delete]");
    if (deleteEl) {
      e.stopPropagation();
      await deleteBlock(
        overlay,
        deleteEl.getAttribute("data-block-delete"),
        containerId,
      );
      return;
    }
    const editEl=target.closest('[data-block-edit]');
    if(editEl){
      const blocks=collectBlocksFromPanel(overlay,containerId),block=blocks.find(item=>item.id===editEl.dataset.blockEdit);
      const value=await getHost().form({title:'编辑总结条目',message:'修改在下次任务生效。',fields:[{name:'name',label:'条目名称',value:block.name},{name:'role',label:'角色',type:'select',value:block.role,options:['system','user','assistant'].map(role=>[role,role])},{name:'content',label:'提示词内容',type:'textarea',value:block.content,macros:[...MACROS,...collectCustomMacros(overlay).map(item=>[item.name,'自定义 · '+item.name])]}],choices:[['保存','__form__'],['删除条目','__delete__'],['取消',null]],validate:value=>value.name.trim()?'':'请填写条目名称。'});
      if(value==='__delete__')return deleteBlock(overlay,block.id,containerId);
      if(value){Object.assign(block,value,{name:value.name.trim()});rerenderBlocks(overlay,blocks,containerId);}
    }
  }));
  container.addEventListener('keydown',event=>{
    if(!event.altKey||!['ArrowUp','ArrowDown'].includes(event.key))return;
    const row=event.target.closest('.sa-block');if(!row)return;event.preventDefault();
    const blocks=collectBlocksFromPanel(overlay,containerId),index=blocks.findIndex(block=>block.id===row.dataset.blockId),next=index+(event.key==='ArrowUp'?-1:1);
    if(next<0||next>=blocks.length)return;[blocks[index],blocks[next]]=[blocks[next],blocks[index]];rerenderBlocks(overlay,blocks,containerId);container.querySelectorAll('.sa-block-drag')[next].focus({preventScroll:true});
  });
  container.addEventListener('change',event=>{
    const toggle=event.target.closest('[data-block-enable]');if(!toggle)return;
    const blocks=collectBlocksFromPanel(overlay,containerId),current=blocks.find(block=>block.id===toggle.dataset.blockEnable);
    if(current.choiceGroup){
      if(current.enabled){for(const block of blocks)if(block!==current&&block.choiceGroup===current.choiceGroup)block.enabled=false;}
      else if(current.choiceGroup==='tail'){const other=blocks.find(block=>block!==current&&block.choiceGroup==='tail');if(other)other.enabled=true;}
    }
    for(const row of container.querySelectorAll('.sa-block')){const block=blocks.find(item=>item.id===row.dataset.blockId);row.querySelector('[data-block-enable]').checked=block.enabled;row.dataset.block=JSON.stringify(block);row.classList.toggle('sa-block-disabled',!block.enabled);}
    overlay.dispatchEvent(new Event('summary-blocks-changed'));
  });

  // 桌面端拖拽排序
  container.addEventListener("dragstart", (e) => {
    const block = e.target.closest(".sa-block");
    if (!block) return;
    _draggedBlockId = block.getAttribute("data-block-id");
    block.classList.add("sa-block-dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", _draggedBlockId);
  });
  container.addEventListener("dragend", () => {
    container.querySelectorAll(".sa-block").forEach((b) => {
      b.classList.remove(
        "sa-block-dragging",
        "sa-block-drag-over-top",
        "sa-block-drag-over-bottom",
      );
    });
    _draggedBlockId = null;
  });
  container.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const block = e.target.closest(".sa-block");
    container.querySelectorAll(".sa-block").forEach((b) => {
      b.classList.remove("sa-block-drag-over-top", "sa-block-drag-over-bottom");
    });
    if (block && block.getAttribute("data-block-id") !== _draggedBlockId) {
      const rect = block.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      block.classList.add(
        e.clientY < midY
          ? "sa-block-drag-over-top"
          : "sa-block-drag-over-bottom",
      );
    }
  });
  container.addEventListener("drop", (e) => {
    e.preventDefault();
    const targetBlock = e.target.closest(".sa-block");
    if (!targetBlock || !_draggedBlockId) return;
    const targetId = targetBlock.getAttribute("data-block-id");
    if (targetId === _draggedBlockId) return;
    const blocks = collectBlocksFromPanel(overlay, containerId);
    const fromIdx = blocks.findIndex((b) => b.id === _draggedBlockId);
    const toIdx = blocks.findIndex((b) => b.id === targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const rect = targetBlock.getBoundingClientRect();
    const insertBefore = e.clientY < rect.top + rect.height / 2;
    const [moved] = blocks.splice(fromIdx, 1);
    let newIdx = blocks.findIndex((b) => b.id === targetId);
    if (!insertBefore) newIdx += 1;
    blocks.splice(newIdx, 0, moved);
    rerenderBlocks(overlay, blocks, containerId);
    _draggedBlockId = null;
  });

  // 移动端触摸拖拽排序
  let _touchDragEl = null;
  let _touchClone = null;
  let _touchStartY = 0;
  let _touchBlockId = null;

  container.addEventListener(
    "touchstart",
    (e) => {
      const dragHandle = e.target.closest(".sa-block-drag");
      if (!dragHandle) return;
      const block = dragHandle.closest(".sa-block");
      if (!block) return;
      _touchBlockId = block.getAttribute("data-block-id");
      _touchDragEl = block;
      _touchStartY = e.touches[0].clientY;
      _touchDragEl._touchTimer = setTimeout(() => {
        block.classList.add("sa-block-dragging");
        const rect = block.getBoundingClientRect();
        _touchClone = block.cloneNode(true);
        _touchClone.className = "sa-block sa-block-touch-clone";
        _touchClone.style.width = rect.width + "px";
        _touchClone.style.left = rect.left + "px";
        _touchClone.style.top = rect.top + "px";
        const doc = window.top?.document || document;
        overlay.getRootNode().querySelector(".destined-root").appendChild(_touchClone);
      }, 150);
    },
    { passive: true },
  );

  container.addEventListener(
    "touchmove",
    (e) => {
      if (!_touchBlockId || !_touchDragEl) return;
      const touch = e.touches[0];
      if (_touchClone) {
        _touchClone.style.top = touch.clientY - 20 + "px";
      }
      container.querySelectorAll(".sa-block").forEach((b) => {
        b.classList.remove(
          "sa-block-drag-over-top",
          "sa-block-drag-over-bottom",
        );
      });
      const elUnder = overlay.getRootNode().elementFromPoint(touch.clientX, touch.clientY);
      const blockUnder = elUnder?.closest?.(".sa-block");
      if (
        blockUnder &&
        blockUnder.getAttribute("data-block-id") !== _touchBlockId
      ) {
        const rect = blockUnder.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        blockUnder.classList.add(
          touch.clientY < midY
            ? "sa-block-drag-over-top"
            : "sa-block-drag-over-bottom",
        );
      }
    },
    { passive: true },
  );

  container.addEventListener("touchend", (e) => {
    if (_touchDragEl?._touchTimer) clearTimeout(_touchDragEl._touchTimer);
    if (!_touchBlockId) return;
    const touch = e.changedTouches?.[0];
    if (touch && _touchClone) {
      const elUnder = overlay.getRootNode().elementFromPoint(touch.clientX, touch.clientY);
      const targetBlock = elUnder?.closest?.(".sa-block");
      if (targetBlock) {
        const targetId = targetBlock.getAttribute("data-block-id");
        if (targetId && targetId !== _touchBlockId) {
          const blocks = collectBlocksFromPanel(overlay, containerId);
          const fromIdx = blocks.findIndex((b) => b.id === _touchBlockId);
          const toIdx = blocks.findIndex((b) => b.id === targetId);
          if (fromIdx >= 0 && toIdx >= 0) {
            const rect = targetBlock.getBoundingClientRect();
            const insertBefore = touch.clientY < rect.top + rect.height / 2;
            const [moved] = blocks.splice(fromIdx, 1);
            let newIdx = blocks.findIndex((b) => b.id === targetId);
            if (!insertBefore) newIdx += 1;
            blocks.splice(newIdx, 0, moved);
            rerenderBlocks(overlay, blocks, containerId);
          }
        }
      }
    }
    container.querySelectorAll(".sa-block").forEach((b) => {
      b.classList.remove(
        "sa-block-dragging",
        "sa-block-drag-over-top",
        "sa-block-drag-over-bottom",
      );
    });
    if (_touchClone && _touchClone.isConnected) _touchClone.remove();
    _touchClone = null;
    _touchDragEl = null;
    _touchBlockId = null;
  });
};

const bindBlockEvents = (overlay) => {
  bindBlockEventsForContainer(
    overlay,
    "#sa-blocks-container",
    DEFAULT_PROMPT_BLOCKS,
  );
  bindBlockEventsForContainer(
    overlay,
    "#sa-mega-blocks-container",
    DEFAULT_MEGA_SUMMARY_PROMPT_BLOCKS,
  );
};

// ---- 条目列表操作 ----

const handleEntryAction = async (overlay, action, entryName) => {
  switch (action) {
    case 'enable-summary':
    case 'disable-summary':
      await setSummaryEntryEnabled(entryName, action==='enable-summary');
      await refreshEntryList(overlay);await refreshStatus(overlay);
      break;
    case "view-edit":
      await viewEditEntry(overlay, entryName);
      break;
    case "regenerate": {
      await regenerateAndReplaceEntry(entryName);
      await refreshEntryList(overlay);
      await refreshStatus(overlay);
      break;
    }
    case "delete": {
      const cfm = await SillyTavern.callGenericPopup(
        `确定要删除总结条目「${escapeHtml(entryName)}」吗？`,
        SillyTavern.POPUP_TYPE.CONFIRM,
      );
      if (cfm !== SillyTavern.POPUP_RESULT.AFFIRMATIVE) return;
      await deleteSummaryEntry(entryName);
      feedback.success(`已删除条目 "${entryName}"`);
      await refreshEntryList(overlay);
      await refreshStatus(overlay);
      break;
    }
  }
};

const refreshEntryList = async (panel, enableSelection = false) => {
  const el = panel.querySelector("#sa-entry-list");
  if (!el) return;
  try {
    const allEntries = await getAllSummaryEntriesForDisplay();
    const megaMap = await getMegaSummaryMap();

    // 获取实际存在的大总结条目名称，用于验证 mapping 的有效性
    const megaEntries = await getAllMegaSummaryEntriesForDisplay();
    const existingMegaNames = new Set(megaEntries.map((e) => e.name));
    const activeMegaNames = new Set(
      megaEntries.filter((e) => !e.disabled).map((e) => e.name),
    );

    const usedInMega = new Set();
    let needCleanup = false;
    for (const [megaName, summaryNames] of Object.entries(megaMap)) {
      if (!existingMegaNames.has(megaName)) {
        // 大总结条目已不存在，标记需要清理该 mapping
        needCleanup = true;
        continue;
      }
      // 只有启用的大总结才将其对应的总结条目标记为已被大总结
      if (!activeMegaNames.has(megaName)) continue;
      if (Array.isArray(summaryNames)) {
        summaryNames.forEach((name) => usedInMega.add(name));
      }
    }

    // 找到第一个未被大总结的有效条目的索引
    let firstUnmegaIdx = -1;
    for (let i = 0; i < allEntries.length; i++) {
      const e = allEntries[i];
      const parsed = parseSummaryEntryName(e.name);
      if (parsed && !e.disabled && !usedInMega.has(e.name)) {
        firstUnmegaIdx = i;
        break;
      }
    }

    // 标记哪些条目可以被选择用于大总结
    // 规则：从第一个未被大总结的条目开始，所有连续的未被大总结条目都可选
    const entries = allEntries.map((e, idx) => {
      const parsed = parseSummaryEntryName(e.name);
      const isUsedInMega = usedInMega.has(e.name);

      if (!parsed || e.disabled || isUsedInMega) {
        return {
          ...e,
          selectable: false,
          selectableReason: isUsedInMega ? "mega" : "",
        };
      }

      // 只有从第一个未被大总结的条目开始的连续条目才可选
      let canSelect = false;
      if (firstUnmegaIdx >= 0 && idx >= firstUnmegaIdx) {
        // 检查从 firstUnmegaIdx 到 idx 之间是否所有条目都是可选的（没有被大总结的中断）
        canSelect = true;
        for (let i = firstUnmegaIdx; i < idx; i++) {
          const midEntry = allEntries[i];
          const midParsed = parseSummaryEntryName(midEntry.name);
          if (!midParsed || midEntry.disabled) {
            // 跳过非总结条目或已禁用的
            continue;
          }
          if (usedInMega.has(midEntry.name)) {
            // 中间有已被大总结的条目，断开了连续性
            canSelect = false;
            break;
          }
        }
      }

      return { ...e, selectable: enableSelection && canSelect };
    });

    const renderKey=JSON.stringify([entries,enableSelection]);
    if(el._renderKey===renderKey){applyBusyRules(panel);return;}
    el._renderKey=renderKey;el.innerHTML = renderEntryList(entries, enableSelection);
    el.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        (btn.dataset.action==='view-edit'?uiListener:actionListener)(()=>handleEntryAction(panel,btn.dataset.action,btn.dataset.name))();
      });
    });

    // 在选择模式下，绑定 checkbox 联动逻辑
    if (enableSelection) {
      bindMegaSelectionLogic(el);
    }
  } catch (err) {
    el.innerHTML = `<div class="sa-empty">加载条目列表失败: ${err.message}</div>`;
  }
};

// 绑定大总结选择的联动逻辑：确保选中的条目从头开始连续
// 规则：勾选第N个时，自动勾选0~N-1；取消第N个时，自动取消N+1以后的
const bindMegaSelectionLogic = (container) => {
  const checkboxes = Array.from(
    container.querySelectorAll(".sa-entry-checkbox"),
  );
  if (checkboxes.length === 0) return;

  const onCheckboxChange = (e) => {
    const changedCb = e.target;
    const changedIdx = checkboxes.indexOf(changedCb);
    if (changedIdx < 0) return;

    if (changedCb.checked) {
      // 勾选第N个：自动勾选前面所有（0 ~ N-1）
      for (let i = 0; i < changedIdx; i++) {
        checkboxes[i].checked = true;
      }
    } else {
      // 取消第N个：自动取消后面所有（N+1 ~ end）
      for (let i = changedIdx + 1; i < checkboxes.length; i++) {
        checkboxes[i].checked = false;
      }
    }

    updateSelectionCount(container);
  };

  checkboxes.forEach((cb) => {
    cb.addEventListener("change", onCheckboxChange);
  });

  // 添加全选/全不选按钮
  addSelectionControls(container, checkboxes);
};

// 更新选中计数显示
const updateSelectionCount = (container) => {
  const checkboxes = container.querySelectorAll(".sa-entry-checkbox");
  const checkedCount = container.querySelectorAll(
    ".sa-entry-checkbox:checked",
  ).length;
  const countEl = container.querySelector(".sa-selection-count");
  if (countEl) {
    countEl.textContent =
      checkedCount > 0
        ? `已选择 ${checkedCount}/${checkboxes.length} 个条目`
        : `共 ${checkboxes.length} 个可选条目，请从头开始勾选`;
  }
};

// 添加选择辅助控件
const addSelectionControls = (container, checkboxes) => {
  // 检查是否已经存在
  if (container.querySelector(".sa-selection-controls")) return;

  const controls = document.createElement("div");
  controls.className = "sa-selection-controls";
  controls.innerHTML = `
    <span class="sa-selection-count">共 ${checkboxes.length} 个可选条目，请从头开始勾选</span>
    <div class="sa-selection-btns">
      <button class="sa-btn sa-btn-sm sa-select-all">全选</button>
      <button class="sa-btn sa-btn-sm sa-select-none">全不选</button>
    </div>
  `;
  container.insertBefore(controls, container.firstChild);

  controls.querySelector(".sa-select-all").addEventListener("click", () => {
    checkboxes.forEach((cb) => {
      cb.checked = true;
    });
    updateSelectionCount(container);
  });
  controls.querySelector(".sa-select-none").addEventListener("click", () => {
    checkboxes.forEach((cb) => {
      cb.checked = false;
    });
    updateSelectionCount(container);
  });
};

const handleMegaEntryAction = async (overlay, action, entryName) => {
  switch (action) {
    case "view-edit-mega":
      await viewEditEntry(overlay, entryName);
      break;
    case "regenerate-mega": {
      await regenerateAndReplaceMegaEntry(entryName);
      await refreshMegaEntryList(overlay);
      await refreshEntryList(overlay);
      await refreshStatus(overlay);
      break;
    }
    case "deactivate-mega": {
      const cfm = await SillyTavern.callGenericPopup(
        `确定要回档大总结条目「${escapeHtml(entryName)}」吗？\n\n` +
          `回档后将关闭该大总结条目，并恢复其包含的原始总结条目。`,
        SillyTavern.POPUP_TYPE.CONFIRM,
      );
      if (cfm !== SillyTavern.POPUP_RESULT.AFFIRMATIVE) return;
      await deactivateMegaSummaryEntry(entryName);
      await refreshMegaEntryList(overlay);
      await refreshEntryList(overlay);
      await refreshStatus(overlay);
      break;
    }
    case "activate-mega": {
      const cfm = await SillyTavern.callGenericPopup(
        `确定要启用大总结条目「${escapeHtml(entryName)}」吗？\n\n` +
          `启用后将开启该大总结条目，并禁用其包含的原始总结条目。`,
        SillyTavern.POPUP_TYPE.CONFIRM,
      );
      if (cfm !== SillyTavern.POPUP_RESULT.AFFIRMATIVE) return;
      await activateMegaSummaryEntry(entryName);
      await refreshMegaEntryList(overlay);
      await refreshEntryList(overlay);
      await refreshStatus(overlay);
      break;
    }
    case "delete-mega": {
      const cfm = await SillyTavern.callGenericPopup(
        `确定要删除大总结条目「${escapeHtml(entryName)}」吗？\n\n` +
          `删除后恢复本助手隐藏且失去记忆覆盖的原文；该批次不会自动重建。`,
        SillyTavern.POPUP_TYPE.CONFIRM,
      );
      if (cfm !== SillyTavern.POPUP_RESULT.AFFIRMATIVE) return;
      await deleteMegaSummaryEntry(entryName);
      await refreshMegaEntryList(overlay);
      await refreshEntryList(overlay);
      await refreshStatus(overlay);
      break;
    }
  }
};

const refreshMegaEntryList = async (panel) => {
  const el = panel.querySelector("#sa-mega-entry-list");
  if (!el) return;
  try {
    const entries = await getAllMegaSummaryEntriesForDisplay();
    const renderKey=JSON.stringify(entries);if(el._renderKey===renderKey){applyBusyRules(panel);return;}el._renderKey=renderKey;
    el.innerHTML = renderMegaEntryList(entries);
    el.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        (btn.dataset.action==='view-edit-mega'?uiListener:actionListener)(()=>handleMegaEntryAction(panel,btn.dataset.action,btn.dataset.name))();
      });
    });
  } catch (err) {
    el.innerHTML = `<div class="sa-empty">加载大总结列表失败: ${err.message}</div>`;
  }
};

const refreshStatus = async (panel) => {
  const el = panel.querySelector("#sa-status-info");
  if (!el) return;
  try {
    const expanded = el.querySelector('[data-coverage-details]')?.open;
    el.innerHTML = await renderStatusInfo();
    if (expanded) el.querySelector('[data-coverage-details]').open = true;
    const visibility = panel.querySelector('#sa-visibility-info');
    if (visibility) {
      const expandedFloors=visibility.querySelector('[data-floor-details]')?.open;
      const scroll=visibility.querySelector('.sa-floor-table-wrap')?.scrollTop ?? 0;
      const {floors}=await getCoverage();
      visibility.innerHTML=renderVisibilityInfo(floors,panel);
      refreshVisibilityControls(panel,floors);
      if(expandedFloors) visibility.querySelector('[data-floor-details]').open=true;
      refreshFloorBrowser(panel);
      const table=visibility.querySelector('.sa-floor-table-wrap');if(table)table.scrollTop=scroll;
      applyBusyRules(panel);
    }
    const hint=panel.querySelector('[data-binding-hint]');
    if(hint) hint.textContent=isChatWorldbookBound()?`本聊天总结书：${getActiveWorldbookName()}`:getVariables({type:'chat'})?.summary_assistant_binding_paused?'已主动解绑；重新绑定后可继续总结。':'未绑定世界书：首次总结时将自动创建并绑定本聊天的独立总结书。';
  } catch (err) {
    el.innerHTML = `加载状态失败: ${err.message}`;
  }
};

// ---- 面板事件绑定 ----

const bindPanelEvents = (overlay, initialSettings) => {
  // 主标签页切换
  overlay.querySelectorAll(".sa-tab-item").forEach((tab) => {
    tab.addEventListener("click", () => {
      const tabName = tab.dataset.tab;
      overlay.querySelector(".sa-tab-item.active").classList.remove("active");
      overlay.querySelector(".sa-tab-pane.active").classList.remove("active");
      tab.classList.add("active");
      overlay
        .querySelector(`.sa-tab-pane[data-pane="${tabName}"]`)
        .classList.add("active");
      if (tabName === 'worldbook') overlay._refreshWorldbooks?.();
      if (tabName === 'status') refreshVisibilityControls(overlay);
    });
  });
  overlay.querySelectorAll('[data-prompt-page]').forEach(button => button.addEventListener('click', () => {
    for (const item of overlay.querySelectorAll('[data-prompt-page]')) item.classList.toggle('active', item === button);
    for (const pane of overlay.querySelectorAll('[data-prompt-pane]')) pane.classList.toggle('active', pane.dataset.promptPane === button.dataset.promptPage);
  }));
  overlay.addEventListener('change', event => {
    if (event.target.matches('[id^="sa-block-role-"]')) event.target.closest('.sa-block').querySelector('[data-block-role-badge]').textContent = event.target.value;
  });

  // 二级导航切换
  overlay.querySelectorAll(".sa-settings-nav-item").forEach((navItem) => {
    navItem.addEventListener("click", (e) => {
      e.preventDefault();
      const subNavName = navItem.dataset.subNav;
      overlay
        .querySelector(".sa-settings-nav-item.active")
        .classList.remove("active");
      overlay
        .querySelector(".sa-settings-pane.active")
        .classList.remove("active");
      navItem.classList.add("active");
      overlay
        .querySelector(`.sa-settings-pane[data-sub-pane="${subNavName}"]`)
        .classList.add("active");
    });
  });

  // API 模式切换
  const updateApiModeDisplay = () => {
    const customFields = overlay.querySelector("#sa-custom-api-fields");
    if (!customFields) return;
    const selectedMode = overlay.querySelector(
      'input[name="sa-api-mode"]:checked',
    )?.value;
    customFields.style.display = selectedMode === "custom" ? "" : "none";
    const statusGrid = overlay.querySelector(".sa-status-grid");
    if (statusGrid) {
      const labels = statusGrid.querySelectorAll(".sa-status-label");
      labels.forEach((label) => {
        if (label.textContent.trim() === "API 模式") {
          const valueEl = label.nextElementSibling;
          if (valueEl) {
            const model = overlay.querySelector("#sa-api-model")?.value || "";
            valueEl.textContent =
              selectedMode === "custom"
                ? `自定义API${model ? ` (${model})` : ""}`
                : "酒馆主API";
          }
        }
      });
    }
  };
  overlay.querySelectorAll('input[name="sa-api-mode"]').forEach((radio) => {
    radio.addEventListener("change", updateApiModeDisplay);
  });

  // 获取模型列表
  overlay
    .querySelector("#sa-fetch-models")
    .addEventListener("click", uiListener(async () => {
      const url = overlay.querySelector("#sa-api-url").value.trim();
      const key = overlay.querySelector("#sa-api-key").value.trim();
      if (!url) {
        feedback.warning("请先填写API地址");
        return;
      }
      try {
        feedback.info("正在获取模型列表...");
        const models = await fetchModelList(url, key);
        const select = overlay.querySelector("#sa-api-model");
        const selected=overlay.querySelector('#sa-api-model-manual').value || select.value;
        select.innerHTML = '';
        if(selected)select.add(new Option(selected,selected));
        if (models && models.length > 0) {
          models.filter(m=>m!==selected).forEach((m) => select.add(new Option(m, m)));
          select.value=selected||'';
          feedback.success(`获取到 ${models.length} 个模型`);
          if(!selected)select.insertBefore(new Option('请选择模型',''),select.firstChild);select.value=selected;
        } else {
          select.innerHTML = '<option value="">未获取到模型</option>';
          feedback.warning("未获取到任何模型");
        }
      } catch (err) {
        feedback.error(`获取模型列表失败: ${err.message}`);

      }
    }));

  // ---- 楼层隐藏/显示管理 ----
  bindFloorBrowser(overlay);
  const batchSetHidden=(from,to,hidden)=>setManualFloorVisibility(from,to,hidden,overlay.querySelector('#sa-vis-role').value);
  overlay.querySelector('#sa-vis-refresh').onclick=uiListener(()=>refreshStatus(overlay));
  overlay.querySelector('#sa-visibility-info').addEventListener('click',uiListener(async event=>{
    const button=event.target.closest('[data-floor-view],[data-floor-toggle]');if(!button)return;
    const from=Number(button.dataset.from),to=Number(button.dataset.to);
    if(button.hasAttribute('data-floor-view')) {
      const messages=getChatMessages(`${from}-${to}`,{role:'all',hide_state:'all',include_swipes:false});
      await getHost().viewText(`${from===to?from:from+'—'+to} 楼原文`,messages.map(message=>`[第 ${message.message_id} 楼 · ${message.role==='user'?'用户输入':message.role==='assistant'?'AI 输出':'系统消息'} · ${message.is_hidden?'隐藏':'显示'}]\n${message.message}`).join('\n\n'));
    } else await runAction(async()=>{const count=await setManualFloorVisibility(from,to,button.dataset.hide==='true');feedback.success(`已${button.dataset.hide==='true'?'隐藏':'显示'} ${count} 楼`);await refreshStatus(overlay);});
  }));

  overlay
    .querySelector("#sa-vis-hide-range")
    .addEventListener("click", actionListener(async () => {
      const from = overlay.querySelector("#sa-vis-from").valueAsNumber;
      const to = overlay.querySelector("#sa-vis-to").valueAsNumber;
      if (isNaN(from) || isNaN(to)) {
        feedback.warning("请输入有效的楼层范围");
        return;
      }
      const count = await batchSetHidden(from, to, true);
      feedback.success(`已隐藏 ${count} 条消息（${from}-${to} 楼）`);
      await refreshStatus(overlay);
    }));
  overlay
    .querySelector("#sa-vis-show-range")
    .addEventListener("click", actionListener(async () => {
      const from = overlay.querySelector("#sa-vis-from").valueAsNumber;
      const to = overlay.querySelector("#sa-vis-to").valueAsNumber;
      if (isNaN(from) || isNaN(to)) {
        feedback.warning("请输入有效的楼层范围");
        return;
      }
      const count = await batchSetHidden(from, to, false);
      feedback.success(`已显示 ${count} 条消息（${from}-${to} 楼）`);
      await refreshStatus(overlay);
    }));
  overlay
    .querySelector("#sa-vis-hide-summarized")
    .addEventListener("click", actionListener(async () => {
      const {floors}=await getCoverage();
      if(!floors.size){feedback.info('暂无已总结楼层');return;}
      const count=await setManualFloorVisibilityByIds(floors,true);
      feedback.success(count?`已隐藏 ${count} 楼；自动隐藏已暂停`:`已总结的 ${floors.size} 楼均已隐藏；自动隐藏已暂停`);
      await refreshStatus(overlay);
    }));
  overlay.querySelector('#sa-vis-auto-hide').addEventListener('change',uiListener(async()=>{
    const enabled=overlay.querySelector('#sa-vis-auto-hide').checked;
    await runAction(async()=>{
      setFloorVisibilityAutomation(enabled);
      if(enabled)await applySummarizedFloorsVisibility();
      feedback.success(enabled?'已开启按总结自动隐藏':'已暂停自动隐藏，保留当前楼层状态');
    });
    await refreshStatus(overlay);
  }));
  overlay
    .querySelector("#sa-vis-show-all")
    .addEventListener("click", actionListener(async () => {
      const lastId = getLastMessageId();
      if (lastId < 0) {
        feedback.warning("聊天为空");
        return;
      }
      const count = await setManualFloorVisibility(0, lastId, false);
      feedback.success(`已显示全部 ${count} 条已隐藏消息`);
      await refreshStatus(overlay);
    }));

  // ---- 世界书绑定/解绑/迁移 ----
  const refreshWbBindStatus = () => {
    const statusEl = overlay.querySelector("#sa-wb-bind-status");
    if (statusEl) {
      statusEl.textContent = isChatWorldbookBound()
        ? `✅ 已绑定: ${getActiveWorldbookName()}`
        : "❌ 未绑定";
    }
    const unbindBtn = overlay.querySelector("#sa-unbind-worldbook");
    const switchBtn = overlay.querySelector("#sa-switch-worldbook");
    for (const button of [unbindBtn, switchBtn, overlay.querySelector('#sa-delete-worldbook'), overlay.querySelector('#sa-view-worldbook')]) {
      if (!button) continue;
      const disabled = !isChatWorldbookBound();
      if (button.hasAttribute('data-task-locked')) {
        button.dataset.wasDisabled = String(disabled);
        button.disabled = true;
      } else button.disabled = disabled;
    }
  };
  const loadWbSelect = async () => {
    const select = overlay.querySelector("#sa-wb-select");
    if (!select) return;
    try {
      const token = captureContext();
      const names = isBusy() ? await getWorldbookNames() : await reconcileChatBinding();
      checkContext(token);
      const currentName = getActiveWorldbookName();
      const previous = select.value;
      const selection = names.includes(previous) ? previous : currentName;
      select.innerHTML =
        '<option value="">-- 请选择 --</option>' +
        names.slice().sort((a,b) => a.localeCompare(b, 'zh-CN'))
          .map(
            (n) =>
              `<option value="${escapeHtml(n)}" ${n === selection ? "selected" : ""}>${escapeHtml(n)}${n === currentName ? '（当前绑定）' : ''}</option>`,
          )
          .join("");
      refreshWbBindStatus();
    } catch (e) {
      select.innerHTML = '<option value="">-- 加载失败 --</option>';
    }
  };
  loadWbSelect();
  overlay._refreshWorldbooks = loadWbSelect;
  overlay.querySelector('#sa-refresh-worldbooks')?.addEventListener('click', uiListener(loadWbSelect));
  overlay.querySelector('#sa-wb-select')?.addEventListener('focus', () => { loadWbSelect(); });

  overlay
    .querySelector("#sa-bind-worldbook")
    ?.addEventListener("click", actionListener(async () => {
      const selectVal = overlay.querySelector("#sa-wb-select")?.value?.trim();
      const inputVal = overlay.querySelector("#sa-new-wb-name")?.value?.trim();
      const name = inputVal || selectVal;
      if (!name) {
        const autoName = generateDefaultWorldbookName();
        try {
          await bindWorldbookToChat(autoName);
          refreshWbBindStatus();
          await loadWbSelect();
          await refreshEntryList(overlay);
          await refreshStatus(overlay);
          feedback.success(`已自动创建并绑定世界书: "${autoName}"`);
        } catch (err) {
          feedback.error(`绑定失败: ${err.message}`);
        }
        return;
      }
      if (isChatWorldbookBound() && getActiveWorldbookName() === name) {
        feedback.info("当前聊天已绑定该世界书");
        return;
      }
      try {
        await bindWorldbookToChat(name);
        refreshWbBindStatus();
        await loadWbSelect();
        overlay.querySelector("#sa-new-wb-name").value = "";
        await refreshEntryList(overlay);
        await refreshStatus(overlay);
        feedback.success(`已绑定世界书: "${name}"`);
      } catch (err) {
        feedback.error(`绑定失败: ${err.message}`);
      }
    }));

  overlay
    .querySelector("#sa-unbind-worldbook")
    ?.addEventListener("click", actionListener(async () => {
      if (!isChatWorldbookBound()) {
        feedback.info("当前聊天未绑定世界书");
        return;
      }
      const currentName = getActiveWorldbookName();
      const cfm = await SillyTavern.callGenericPopup(
        `确定要解绑世界书「${escapeHtml(currentName)}」吗？\n解绑后世界书不会被删除，但不再对当前聊天生效。`,
        SillyTavern.POPUP_TYPE.CONFIRM,
      );
      if (cfm !== SillyTavern.POPUP_RESULT.AFFIRMATIVE) return;
      try {
        await unbindWorldbookFromChat();
        refreshWbBindStatus();
        await refreshEntryList(overlay);
        await refreshStatus(overlay);
        feedback.success(`已解绑世界书: "${currentName}"`);
      } catch (err) {
        feedback.error(`解绑失败: ${err.message}`);
      }
    }));

  overlay
    .querySelector("#sa-switch-worldbook")
    ?.addEventListener("click", actionListener(async () => {
      if (!isChatWorldbookBound()) {
        feedback.warning("当前聊天未绑定世界书，请先绑定");
        return;
      }
      const selectVal = overlay.querySelector("#sa-wb-select")?.value?.trim();
      const inputVal = overlay.querySelector("#sa-new-wb-name")?.value?.trim();
      const newName = inputVal || selectVal;
      if (!newName) {
        feedback.warning("请选择或输入目标世界书名称");
        return;
      }
      const oldName = getActiveWorldbookName();
      if (newName === oldName) {
        feedback.info("目标世界书与当前相同，无需迁移");
        return;
      }
      const cfm = await SillyTavern.callGenericPopup(
        `确定要将总结条目从「${escapeHtml(oldName)}」迁移到「${escapeHtml(newName)}」吗？\n迁移后当前聊天将绑定到新世界书。`,
        SillyTavern.POPUP_TYPE.CONFIRM,
      );
      if (cfm !== SillyTavern.POPUP_RESULT.AFFIRMATIVE) return;
      try {
        feedback.info("正在迁移世界书...");
        await migrateWorldbookEntries(oldName, newName);
        refreshWbBindStatus();
        await loadWbSelect();
        overlay.querySelector("#sa-new-wb-name").value = "";
        await refreshEntryList(overlay);
        await refreshStatus(overlay);
        feedback.success(`已迁移到世界书「${newName}」`);
      } catch (err) {
        feedback.error(`迁移失败: ${err.message}`);
      }
    }));

  // ---- 自动保存（防抖） ----
  let _autoSaveTimer = null;
  let panelToken = captureContext();
  overlay._flush = async () => {
    if (!_autoSaveTimer) return;
    clearTimeout(_autoSaveTimer); _autoSaveTimer = null;
    checkContext(panelToken);
    await updateSettings(collectSettingsFromPanel(overlay));
    refreshVisibilityControls(overlay);
    feedback.success('总结设置已保存，下次任务生效');
  };
  overlay._dispose = () => { clearTimeout(_autoSaveTimer); _autoSaveTimer = null; };
  const autoSave = () => {
    if (_autoSaveTimer) clearTimeout(_autoSaveTimer);
    feedback.info('总结设置待保存…');
    _autoSaveTimer = setTimeout(async () => {
      try {
        checkContext(panelToken);
        _autoSaveTimer = null;
        const newSettings = collectSettingsFromPanel(overlay);
        await updateSettings(newSettings);
        refreshVisibilityControls(overlay);
        feedback.success("总结设置已保存，下次任务生效");
      } catch (e) {
        getHost().status(`总结设置保存失败：${e.message}`, "error");
      }
    }, 800);
  };
  const onFieldChange = e => {
    if(e.composedPath().some(node=>node?.matches?.('[data-task-widget],.sa-visibility-panel,.sa-tag-editor')))return;
    if (!e.target.matches('input,select,textarea') || ['sa-enabled','sa-vis-from','sa-vis-to','sa-new-wb-name','sa-wb-select'].includes(e.target.id)) return;
    autoSave();
  };
  overlay.addEventListener("summary-blocks-changed", autoSave);
  bindTagEditors(overlay,autoSave);
  bindBatchSettings(overlay);
  overlay.querySelector('#sa-api-url').addEventListener('input', e => { overlay.querySelector('#sa-api-key').value = getKeyForUrl(e.target.value); });
  overlay.addEventListener('input', onFieldChange);
  overlay.addEventListener('change', onFieldChange);

  // ---- 重置设置 ----
  overlay.querySelector("#sa-reset").addEventListener("click", actionListener(async () => {
    const cfm = await SillyTavern.callGenericPopup(
      "确定要重置所有设置为默认值吗？",
      SillyTavern.POPUP_TYPE.CONFIRM,
    );
    if (cfm !== SillyTavern.POPUP_RESULT.AFFIRMATIVE) return;
    await overlay._flush?.();
    await resetSettings();
    await applySummarizedFloorsVisibility();
    await showSettingsPopup();
    feedback.success("设置已重置");
  }));

  // ---- 手动开始总结 ----
  overlay
    .querySelector("#sa-start-summary")
    .addEventListener("click", actionListener(async () => {
      if (_autoSaveTimer) clearTimeout(_autoSaveTimer);
      const newSettings = collectSettingsFromPanel(overlay);
      await updateSettings(newSettings);
      await startSummaryProcess();
      await refreshEntryList(overlay);
      await refreshMegaEntryList(overlay);
      await refreshStatus(overlay);
    }));

  // ---- 指定楼层总结 ----
  overlay
    .querySelector("#sa-start-custom-summary")
    .addEventListener("click", actionListener(async () => {
      if (_autoSaveTimer) clearTimeout(_autoSaveTimer);
      const newSettings = collectSettingsFromPanel(overlay);
      await updateSettings(newSettings);
      await startCustomRangeSummaryProcess();
      await refreshEntryList(overlay);
      await refreshMegaEntryList(overlay);
      await refreshStatus(overlay);
    }));

  // ---- 开始大总结 ----
  overlay
    .querySelector("#sa-start-mega-summary")
    ?.addEventListener("click", actionListener(async () => {
      // 切换选择模式
      const btn = overlay.querySelector("#sa-start-mega-summary");
      const isSelecting = btn.textContent.includes("退出");

      if (isSelecting) {
        // 取消选择模式
        btn.textContent = "开始大总结";
        btn.classList.remove("sa-btn-danger");
        btn.classList.add("sa-btn-primary");
        await refreshEntryList(overlay, false);
        const confirmBtn = overlay.querySelector("#sa-confirm-mega-summary");
        if (confirmBtn) confirmBtn.remove();
        return;
      }

      // 进入选择模式
      btn.textContent = "退出大总结选择";
      btn.classList.remove("sa-btn-primary");
      btn.classList.add("sa-btn-danger");
      await refreshEntryList(overlay, true);

      // 添加确认大总结按钮
      const entryListContainer =
        overlay.querySelector("#sa-entry-list").parentElement;
      let confirmBtn = entryListContainer.querySelector(
        "#sa-confirm-mega-summary",
      );
      if (!confirmBtn) {
        confirmBtn = document.createElement("button");
        confirmBtn.id = "sa-confirm-mega-summary";
        confirmBtn.className = "sa-btn sa-btn-primary";
        confirmBtn.textContent = "确认大总结选中的条目";
        confirmBtn.style.marginTop = "10px";
        confirmBtn.style.width = "100%";
        entryListContainer.appendChild(confirmBtn);

        confirmBtn.addEventListener("click", actionListener(async () => {
          const checkboxes = overlay.querySelectorAll(
            ".sa-entry-checkbox:checked",
          );
          if (checkboxes.length < 2) {
            feedback.warning("请至少选择 2 个总结条目进行大总结");
            return;
          }

          const selectedNames = Array.from(checkboxes).map(
            (cb) => cb.dataset.entryName,
          );

          // 验证选择的条目是否连续
          const allEntries = await getAllSummaryEntriesForDisplay();
          const selectedEntries = allEntries.filter((e) =>
            selectedNames.includes(e.name),
          );
          selectedEntries.sort((a, b) => {
            const aStart = parseSummaryEntryName(a.name)?.start ?? 0;
            const bStart = parseSummaryEntryName(b.name)?.start ?? 0;
            return aStart - bStart;
          });

          const firstParsed = parseSummaryEntryName(selectedEntries[0].name);
          const lastParsed = parseSummaryEntryName(
            selectedEntries[selectedEntries.length - 1].name,
          );

          if (!firstParsed || !lastParsed) {
            feedback.error("选中的条目格式不正确");
            return;
          }

          const entryName = makeMegaSummaryEntryName(
            firstParsed.start,
            lastParsed.end,
          );

          const confirm = await SillyTavern.callGenericPopup(
            `将对以下总结条目进行大总结：\n\n` +
              `选中条目数：${selectedNames.length}\n` +
              `楼层范围：${firstParsed.start}-${lastParsed.end}\n` +
              `大总结名称：${escapeHtml(entryName)}\n\n` +
              `继续吗？`,
            SillyTavern.POPUP_TYPE.CONFIRM,
          );
          if (confirm !== SillyTavern.POPUP_RESULT.AFFIRMATIVE) return;

          // 保存设置并关闭面板
          if (_autoSaveTimer) clearTimeout(_autoSaveTimer);
          const newSettings = collectSettingsFromPanel(overlay);
          await updateSettings(newSettings);


          // 执行大总结
          await executeMegaSummary(selectedNames, entryName, {
            requireReview: true,
          });
        }));
      }
    }));

  overlay.querySelector('#sa-enabled').addEventListener('change', async e => {
    try { await updateSettings({ enabled: e.target.checked }); panelToken = captureContext(); feedback.success(e.target.checked?'自动总结已开启':'自动总结已暂停；当前任务可继续完成'); } catch(error) { e.target.checked = getSettings().enabled; getHost().status(error.message, 'error'); }
  });
  // ---- 绑定板块事件 ----
  bindBlockEvents(overlay);
  bindPromptTools(overlay,initialSettings,{collect:collectSettingsFromPanel,rerender:rerenderBlocks});
  refreshTaskWidget(overlay);
  for(const id of ['sa-temperature','sa-max-tokens'])overlay.querySelector('#'+id+'-mode').addEventListener('change',event=>{overlay.querySelector('#'+id).disabled=event.target.value==='follow';});
  overlay.querySelector('#sa-api-model').addEventListener('change',e=>{overlay.querySelector('#sa-api-model-manual').value=e.target.value;autoSave();});
  overlay.querySelector('#sa-view-worldbook').onclick=uiListener(async()=>getHost().viewText('本聊天的总结记忆',(await getWorldbookEntriesSafe()).filter(entry=>parseSummaryEntryName(entry.name)||parseMegaSummaryEntryName(entry.name)).map(entry=>'['+entry.name+']\n'+entry.content).join('\n\n')));
  overlay.querySelector('#sa-delete-worldbook').onclick=actionListener(async()=>{const name=getActiveWorldbookName();if(!name)return;const confirmed=await SillyTavern.callGenericPopup('确定删除本聊天的总结世界书「'+escapeHtml(name)+'」？如包含其他条目，只清理总结记录。',SillyTavern.POPUP_TYPE.CONFIRM);if(confirmed!==SillyTavern.POPUP_RESULT.AFFIRMATIVE)return;const result=await deleteBoundSummaryBook();await loadWbSelect();await refreshEntryList(overlay);await refreshMegaEntryList(overlay);await refreshStatus(overlay);feedback.success(result?.keptOtherEntries?'总结记录已清理，其他世界书条目已保留':'总结世界书已删除');});
};

export { actionListener, _panelEl, showSettingsPopup, collectBlocksFromPanel, collectSettingsFromPanel, _draggedBlockId, rerenderBlocks, addNewBlock, deleteBlock, resetBlocks, viewEditEntry, bindBlockEventsForContainer, bindBlockEvents, handleEntryAction, refreshEntryList, bindMegaSelectionLogic, updateSelectionCount, addSelectionControls, handleMegaEntryAction, refreshMegaEntryList, refreshStatus, bindPanelEvents };
