import {
  SCRIPT_NAME,
  BUTTON_NAME,
  LEGACY_BUTTON_NAMES,
  UI_THEMES,
  SAVE_DELAY,
  PROFILE_TIMEOUT,
  PRESET_SYNC_INTERVAL,
  MANAGED_VALUES_VERSION,
  STYLE_STRUCTURE_VERSION,
  MOBILE_BREAKPOINT,
  PANEL_VIEWPORT_MARGIN,
  PANEL_MIN_WIDTH,
  PANEL_MIN_HEIGHT,
  DEFAULT_MANAGED_VALUES,
  MANAGED_MACROS,
  MANAGED_MACRO_PATTERN,
  UNKNOWN_DESTINED_MACRO_PATTERN,
  USER_ADDITIONAL_OPEN,
  USER_ADDITIONAL_CLOSE,
  USER_ADDITIONAL_TRIM,
  USER_ADDITIONAL_DEFAULT,
  IDS,
  BUILTIN_MODEL_ADAPTERS,
  GROUPS,
  PROTECTED_IDS,
  SECTION_LABELS,
  CURATED_TOGGLES,
  BEAUTIFY_IDS,
  AFTER_BODY_IDS,
  FIXED_UI_IDS,
  DEFAULT_GROUP_OPTION_IDS,
  USER_CREATABLE_GROUPS,
  VARIABLE_WORLD_ENTRIES,
  WORLD_TIMEOUT,
  FIELD_DEFINITIONS,
  LANGUAGE_DEFINITIONS,
  LANGUAGE_PRESETS,
  PLACEHOLDER_IDS,
  SYSTEM_PROMPT_IDS
} from './definitions.js';
import { createStore } from './store.js';
import { createWorldbook } from './worldbook.js';
import { createModels } from './models.js';
import { createManaged } from './managed.js';
import { createStylesEditor } from './styles-editor.js';
import { createConnections } from './connections.js';
import { createRender } from './render.js';
import { createPlacement } from './placement.js';
import { createPromptEditor } from './prompt-editor.js';
import { createAppearance } from './appearance.js';
import { createEvents } from './events.js';
import { createConfigurationSchema } from './configuration-schema.js';
import { createConfigurations } from './configurations.js';
import { createCustomModels } from './custom-models.js';
import * as summary from '../summary/service.js';

import { createDialogs, DIALOG_STYLES } from '../ui/dialogs.js';
import { PANEL_CSS } from '../ui/styles.js';
import { SUMMARY_STYLES } from '../summary/ui/styles.js';
import { TASK_STYLES } from '../summary/ui/taskView.js';
export async function startPresetAssistant() {
  'use strict';

  // Live references preserve instance ownership, pending writes and cleanup across modules.
  const ctx = {
    get AFTER_BODY_IDS() { return AFTER_BODY_IDS; },
    get BEAUTIFY_IDS() { return BEAUTIFY_IDS; },
    get BUILTIN_MODEL_ADAPTERS() { return BUILTIN_MODEL_ADAPTERS; },
    get BUTTON_NAME() { return BUTTON_NAME; },
    get CURATED_TOGGLES() { return CURATED_TOGGLES; },
    get DEFAULT_GROUP_OPTION_IDS() { return DEFAULT_GROUP_OPTION_IDS; },
    get DEFAULT_MANAGED_VALUES() { return DEFAULT_MANAGED_VALUES; },
    get FIELD_DEFINITIONS() { return FIELD_DEFINITIONS; },
    get GROUPS() { return GROUPS; },
    get HOST_ID() { return HOST_ID; },
    get IDS() { return IDS; },
    get ID_TO_GROUP() { return ID_TO_GROUP; },
    get LANGUAGE_DEFINITIONS() { return LANGUAGE_DEFINITIONS; },
    get LANGUAGE_PRESETS() { return LANGUAGE_PRESETS; },
    get LEGACY_BUTTON_NAMES() { return LEGACY_BUTTON_NAMES; },
    get MANAGED_MACROS() { return MANAGED_MACROS; },
    get MANAGED_MACRO_PATTERN() { return MANAGED_MACRO_PATTERN; },
    get MANAGED_VALUES_VERSION() { return MANAGED_VALUES_VERSION; },
    get MOBILE_BREAKPOINT() { return MOBILE_BREAKPOINT; },
    get MODEL_ADAPTERS() { return MODEL_ADAPTERS; }, set MODEL_ADAPTERS(value) { MODEL_ADAPTERS = value; },
    get MODEL_IDS() { return MODEL_IDS; }, set MODEL_IDS(value) { MODEL_IDS = value; },
    get PANEL_MIN_HEIGHT() { return PANEL_MIN_HEIGHT; },
    get PANEL_MIN_WIDTH() { return PANEL_MIN_WIDTH; },
    get PANEL_VIEWPORT_MARGIN() { return PANEL_VIEWPORT_MARGIN; },
    get PLACEHOLDER_IDS() { return PLACEHOLDER_IDS; },
    get PROFILE_TIMEOUT() { return PROFILE_TIMEOUT; },
    get PROTECTED_IDS() { return PROTECTED_IDS; },
    get SAVE_DELAY() { return SAVE_DELAY; },
    get SCRIPT_ID() { return SCRIPT_ID; },
    get SCRIPT_NAME() { return SCRIPT_NAME; },
    get SECTION_LABELS() { return SECTION_LABELS; },
    get STORAGE_KEY() { return STORAGE_KEY; },
    get STYLES() { return STYLES; },
    get STYLE_STRUCTURE_VERSION() { return STYLE_STRUCTURE_VERSION; },
    get SYSTEM_PROMPT_IDS() { return SYSTEM_PROMPT_IDS; },
    get UI_THEMES() { return UI_THEMES; },
    get UNKNOWN_DESTINED_MACRO_PATTERN() { return UNKNOWN_DESTINED_MACRO_PATTERN; },
    get USER_ADDITIONAL_CLOSE() { return USER_ADDITIONAL_CLOSE; },
    get USER_ADDITIONAL_DEFAULT() { return USER_ADDITIONAL_DEFAULT; },
    get USER_ADDITIONAL_OPEN() { return USER_ADDITIONAL_OPEN; },
    get USER_ADDITIONAL_TRIM() { return USER_ADDITIONAL_TRIM; },
    get USER_CREATABLE_GROUPS() { return USER_CREATABLE_GROUPS; },
    get VARIABLE_WORLD_ENTRIES() { return VARIABLE_WORLD_ENTRIES; },
    get WAND_CONTAINER_ID() { return WAND_CONTAINER_ID; },
    get WORLD_TIMEOUT() { return WORLD_TIMEOUT; },
    get app() { return app; }, set app(value) { app = value; },
    get applyConfiguration() { return applyConfiguration; },
    get applyGroup() { return applyGroup; },
    get applyPanelGeometry() { return applyPanelGeometry; },
    get applyTheme() { return applyTheme; },
    get applyTransparency() { return applyTransparency; },
    get assertData() { return assertData; },
    get authorDependency() { return authorDependency; },
    get authorLayout() { return authorLayout; },
    get buildStylePromptContent() { return buildStylePromptContent; },
    get canSortPrompts() { return canSortPrompts; },
    get cancelPromptSort() { return cancelPromptSort; },
    get captureConfiguration() { return captureConfiguration; },
    get captureWorldContext() { return captureWorldContext; },
    get choiceButton() { return choiceButton; },
    get clampOrbToViewport() { return clampOrbToViewport; },
    get clone() { return clone; },
    get closePanel() { return closePanel; },
    get closePromptEditor() { return closePromptEditor; },
    get commitInProgress() { return commitInProgress; }, set commitInProgress(value) { commitInProgress = value; },
    get commitPresetMutation() { return commitPresetMutation; },
    get configLibrary() { return configLibrary; },
    get configurationScopes() { return configurationScopes; }, set configurationScopes(value) { configurationScopes = value; },
    get createPromptId() { return createPromptId; },
    get currentTheme() { return currentTheme; }, set currentTheme(value) { currentTheme = value; },
    get currentTransparency() { return currentTransparency; }, set currentTransparency(value) { currentTransparency = value; },
    get debounceTimers() { return debounceTimers; },
    get deleteConfiguration() { return deleteConfiguration; },
    get deleteUserStyle() { return deleteUserStyle; },
    get destroyed() { return destroyed; }, set destroyed(value) { destroyed = value; },
    get detectModelAdapter() { return detectModelAdapter; },
    get dialogs() { return dialogs; }, set dialogs(value) { dialogs = value; },
    get downloadConfiguration() { return downloadConfiguration; },
    get editEntryAction() { return editEntryAction; },
    get emptyLibrary() { return emptyLibrary; },
    get enqueueScriptConfigSave() { return enqueueScriptConfigSave; },
    get ensurePromptMetadata() { return ensurePromptMetadata; },
    get escapeHtml() { return escapeHtml; },
    get eventStops() { return eventStops; },
    get exportConfigurations() { return exportConfigurations; },
    get exportRecoverableConfigurations() { return exportRecoverableConfigurations; },
    get exportScopes() { return exportScopes; }, set exportScopes(value) { exportScopes = value; },
    get findEditorPrompt() { return findEditorPrompt; },
    get fingerprintPresetValue() { return fingerprintPresetValue; },
    get flushPendingSaves() { return flushPendingSaves; },
    get getContext() { return getContext; },
    get getCurrentProfileName() { return getCurrentProfileName; },
    get getGeminiTail() { return getGeminiTail; },
    get getGroupOptions() { return getGroupOptions; },
    get getNumericMode() { return getNumericMode; },
    get getPrompt() { return getPrompt; },
    get getPromptGroupId() { return getPromptGroupId; },
    get groupPromptTitle() { return groupPromptTitle; },
    get handleConfigurationAction() { return handleConfigurationAction; },
    get handleOrbPointerDown() { return handleOrbPointerDown; },
    get handlePanelPointerDown() { return handlePanelPointerDown; },
    get handlePromptSortPointerDown() { return handlePromptSortPointerDown; },
    get handleViewportResize() { return handleViewportResize; },
    get hasManagedMacro() { return hasManagedMacro; },
    get host() { return host; }, set host(value) { host = value; },
    get importConfigurations() { return importConfigurations; },
    get inferNativePlacement() { return inferNativePlacement; },
    get inferPromptMeta() { return inferPromptMeta; },
    get isMobileViewport() { return isMobileViewport; },
    get isUserCreatedGroupPrompt() { return isUserCreatedGroupPrompt; },
    get legacyAuthorBlock() { return legacyAuthorBlock; },
    get loadProfiles() { return loadProfiles; },
    get loadUiState() { return loadUiState; },
    get macroStops() { return macroStops; },
    get metadataEnriching() { return metadataEnriching; }, set metadataEnriching(value) { metadataEnriching = value; },
    get modelRegistry() { return modelRegistry; },
    get nativePlacementIndex() { return nativePlacementIndex; },
    get normalizeName() { return normalizeName; },
    get openPanel() { return openPanel; },
    get openPromptEditor() { return openPromptEditor; },
    get openStyleEditor() { return openStyleEditor; },
    get pendingPresetOperations() { return pendingPresetOperations; }, set pendingPresetOperations(value) { pendingPresetOperations = value; },
    get placementSnapshot() { return placementSnapshot; },
    get plainObject() { return plainObject; },
    get presetFingerprint() { return presetFingerprint; }, set presetFingerprint(value) { presetFingerprint = value; },
    get profileKey() { return profileKey; },
    get promptSort() { return promptSort; }, set promptSort(value) { promptSort = value; },
    get queuePresetMutation() { return queuePresetMutation; },
    get readGlobalPreference() { return readGlobalPreference; },
    get readLanguageField() { return readLanguageField; },
    get readNumericField() { return readNumericField; },
    get readStylePromptContent() { return readStylePromptContent; },
    get readUserAdditionalSetting() { return readUserAdditionalSetting; },
    get rebuildModelRegistry() { return rebuildModelRegistry; },
    get reconcilePending() { return reconcilePending; }, set reconcilePending(value) { reconcilePending = value; },
    get reconcilePreset() { return reconcilePreset; },
    get refreshPreset() { return refreshPreset; },
    get renameConfiguration() { return renameConfiguration; },
    get render() { return render; },
    get renderActiveContent() { return renderActiveContent; },
    get renderConfigurationShortcut() { return renderConfigurationShortcut; },
    get renderConfigurationsTab() { return renderConfigurationsTab; },
    get renderCustomModelControls() { return renderCustomModelControls; },
    get renderEntryPointSettings() { return renderEntryPointSettings; },
    get renderFold() { return renderFold; },
    get renderLanguageControl() { return renderLanguageControl; },
    get renderModelTab() { return renderModelTab; },
    get renderNumericControl() { return renderNumericControl; },
    get renderPlacementBlock() { return renderPlacementBlock; },
    get renderPlacementFields() { return renderPlacementFields; },
    get renderPlacementNavigation() { return renderPlacementNavigation; },
    get renderPlacementPage() { return renderPlacementPage; },
    get renderPromptEditor() { return renderPromptEditor; },
    get renderSectionHeader() { return renderSectionHeader; },
    get renderStatus() { return renderStatus; },
    get renderStyleEditorLayer() { return renderStyleEditorLayer; },
    get renderThemeControl() { return renderThemeControl; },
    get renderVariablePanel() { return renderVariablePanel; },
    get repairPlacementGroup() { return repairPlacementGroup; },
    get requirePrompt() { return requirePrompt; },
    get resetUserAdditionalSetting() { return resetUserAdditionalSetting; },
    get resolveBoundProfile() { return resolveBoundProfile; },
    get runWorkspaceOperation() { return runWorkspaceOperation; },
    get sanitizeBinding() { return sanitizeBinding; },
    get sanitizeEntryPoints() { return sanitizeEntryPoints; },
    get sanitizeLanguageSetting() { return sanitizeLanguageSetting; },
    get sanitizeManagedValues() { return sanitizeManagedValues; },
    get saveChain() { return saveChain; }, set saveChain(value) { saveChain = value; },
    get saveNamedConfiguration() { return saveNamedConfiguration; },
    get savePlacement() { return savePlacement; },
    get savePromptEditor() { return savePromptEditor; },
    get savePromptOrder() { return savePromptOrder; },
    get saveRecovery() { return saveRecovery; },
    get saveScriptConfig() { return saveScriptConfig; },
    get saveStyleEditor() { return saveStyleEditor; },
    get savedScriptConfig() { return savedScriptConfig; }, set savedScriptConfig(value) { savedScriptConfig = value; },
    get scanWorldbookMode() { return scanWorldbookMode; },
    get scheduleWorldbookScan() { return scheduleWorldbookScan; },
    get selectModelAdapter() { return selectModelAdapter; },
    get selectVariableMode() { return selectVariableMode; },
    get selectedScopes() { return selectedScopes; },
    get setCustomTail() { return setCustomTail; },
    get setEditorField() { return setEditorField; },
    get setGeminiTail() { return setGeminiTail; },
    get setGlobalPreference() { return setGlobalPreference; },
    get setLanguageField() { return setLanguageField; },
    get setNarrationPerson() { return setNarrationPerson; },
    get setNumericField() { return setNumericField; },
    get setNumericMode() { return setNumericMode; },
    get setPlacementField() { return setPlacementField; },
    get setSaveStatus() { return setSaveStatus; },
    get setStreaming() { return setStreaming; },
    get setUserAdditionalSetting() { return setUserAdditionalSetting; },
    get shadow() { return shadow; }, set shadow(value) { shadow = value; },
    get showErrorToast() { return showErrorToast; },
    get slashQuote() { return slashQuote; },
    get snapshotPrompt() { return snapshotPrompt; },
    get sortClickUntil() { return sortClickUntil; }, set sortClickUntil(value) { sortClickUntil = value; },
    get state() { return state; },
    get suppressOrbClick() { return suppressOrbClick; }, set suppressOrbClick(value) { suppressOrbClick = value; },
    get switchConnectionProfile() { return switchConnectionProfile; },
    get syncEntryPoints() { return syncEntryPoints; },
    get syncInterval() { return syncInterval; }, set syncInterval(value) { syncInterval = value; },
    get syncOrbVisibility() { return syncOrbVisibility; },
    get syncPromptEditor() { return syncPromptEditor; },
    get toggleHtml() { return toggleHtml; },
    get togglePrompt() { return togglePrompt; },
    get trackPresetOperation() { return trackPresetOperation; },
    get updateConnectionLink() { return updateConnectionLink; },
    get updateEntryPoint() { return updateEntryPoint; },
    get updateProfileBinding() { return updateProfileBinding; },
    get updateWorkspaceUi() { return updateWorkspaceUi; },
    get validName() { return validName; },
    get validateAuthorLayout() { return validateAuthorLayout; },
    get validateCustomModels() { return validateCustomModels; },
    get validateLibrary() { return validateLibrary; },
    get validateSnapshot() { return validateSnapshot; },
    get variablePresetMode() { return variablePresetMode; },
    get volatileUiState() { return volatileUiState; }, set volatileUiState(value) { volatileUiState = value; },
    get withLinkedConnection() { return withLinkedConnection; },
    get withWorldTimeout() { return withWorldTimeout; },
    get workspaceContextKey() { return workspaceContextKey; },
    get worldEpoch() { return worldEpoch; }, set worldEpoch(value) { worldEpoch = value; },
    get worldLink() { return worldLink; },
    get worldOperationContext() { return worldOperationContext; }, set worldOperationContext(value) { worldOperationContext = value; },
    get worldReads() { return worldReads; },
    get worldScan() { return worldScan; }, set worldScan(value) { worldScan = value; },
    get worldTimer() { return worldTimer; }, set worldTimer(value) { worldTimer = value; },
    get worldWrites() { return worldWrites; },
    get writePlacement() { return writePlacement; },
    get writeWorkspace() { return writeWorkspace; },
  };
  const {
    clone,
    escapeHtml,
    normalizeName,
    sanitizeIntegerSetting,
    sanitizeManagedValues,
    sanitizeLanguageSetting,
    loadScriptConfig,
    sanitizeEntryPoints,
    sanitizeBinding,
    saveScriptConfig,
    commitScriptConfig,
    enqueueScriptConfigSave,
    getContext,
    getPrompt,
    requirePrompt,
    fingerprintPresetValue,
    refreshPreset,
    setSaveStatus,
    commitPresetMutation,
    trackPresetOperation,
    queuePresetMutation,
    enqueue,
    reconcilePreset
  } = createStore(ctx);
  const {
    worldEntryKey,
    variableEntryRole,
    variablePresetMode,
    captureWorldContext,
    worldContextIsCurrent,
    withWorldTimeout,
    inspectVariableBook,
    readVariableBooks,
    renderVariableSlot,
    showWorldLink,
    saveVariablePreset,
    scheduleWorldbookScan,
    scanWorldbookMode,
    selectVariableMode,
    renderVariablePanel
  } = createWorldbook(ctx);
  const { getGroupOptions, getPromptGroupId, applyGroup, detectModelAdapter, getGeminiTail, applyModelToPreset, selectModelAdapter, setGeminiTail } = createModels(ctx);
  const {
    countOccurrences,
    hasManagedMacro,
    narrationRequirement,
    managedMacroValues,
    expandManagedMacros,
    readGlobalPreference,
    setGlobalPreference,
    buildUserAdditionalContent,
    readUserAdditionalSetting,
    setUserAdditionalSetting,
    resetUserAdditionalSetting,
    languagePromptIds,
    hasLanguageMacro,
    readLanguageField,
    setLanguageField,
    readNumericField,
    setNumericField,
    setNarrationPerson,
    extractLegacyAttribute,
    readLegacyManagedValues,
    replaceTagAttribute,
    migrateManagedPromptContent,
    needsManagedPromptMigration,
    initializeManagedSettings,
    registerManagedMacros,
    expandOutgoingMessages,
    togglePrompt,
    isUserCreatedGroupPrompt,
    groupPromptTitle,
    buildStylePromptContent,
    readStylePromptContent,
    initializeStyleStructures,
    createPromptId
  } = createManaged(ctx);
  const { openStyleEditor, saveStyleEditor, deleteUserStyle, setStreaming, ensurePromptMetadata, inferPromptMeta } = createStylesEditor(ctx);
  const {
    loadProfiles,
    parseProfileList,
    profileKey,
    resolveBoundProfile,
    getCurrentProfileName,
    slashQuote,
    switchConnectionProfile,
    updateConnectionLink,
    updateEntryPoint,
    syncEntryPoints,
    syncInputButtonEntry,
    syncWandEntry,
    updateProfileBinding,
    showErrorToast
  } = createConnections(ctx);
  const {
    renderFeatherIcon,
    syncOrbVisibility,
    render,
    renderActiveContent,
    restoreContentScroll,
    renderStyleEditorLayer,
    renderStatus,
    renderPanel,
    renderFold,
    renderActiveTab,
    renderSectionHeader,
    renderSettingsTab,
    renderModelTab,
    renderProfileSelect,
    renderNumericControl,
    renderLanguageControl,
    renderStyleEditor,
    renderEntryPointSettings,
    renderAdvancedTab,
    toggleHtml,
    choiceButton,
    disabledAttribute
  } = createRender(ctx);
  const {
    defaultAuthorLayout,
    validateAuthorLayout,
    authorLayout,
    authorDependency,
    legacyAuthorBlock,
    placementEntry,
    placementMembers,
    placementSnapshot,
    writePlacement,
    inferNativePlacement,
    nativePlacementIndex,
    savePlacement,
    renderPlacementFields,
    setPlacementField,
    renderPlacementNavigation,
    placementEdit,
    renderPlacedPrompt,
    renderPlacementBlock,
    renderPlacementPage,
    repairPlacementGroup,
    editEntryAction
  } = createPlacement(ctx);
  const {
    findEditorPrompt,
    editorSnapshot,
    openPromptEditor,
    syncPromptEditor,
    setEditorField,
    closePromptEditor,
    savePromptEditor,
    renderPromptEditor,
    canSortPrompts,
    sortAnnouncement,
    cancelPromptSort,
    savePromptOrder,
    handlePromptSortPointerDown
  } = createPromptEditor(ctx);
  const {
    loadUiState,
    saveUiState,
    renderThemeControl,
    normalizeTransparency,
    applyTransparency,
    applyTheme,
    isMobileViewport,
    clampNumber,
    getViewportInsets,
    getMobilePanelGeometry,
    clampPanelGeometry,
    savePanelGeometry,
    applyPanelGeometry,
    handleViewportResize,
    saveOrbPosition,
    getNumericMode,
    setNumericMode,
    clampOrbToViewport,
    dismissExtensionsMenu,
    openPanel,
    closePanel,
    handleOrbPointerDown,
    handlePanelPointerDown
  } = createAppearance(ctx);
  const { handleClick, handleChange, handleInput, handleKeydown, createUi, subscribe, subscribeLast, cleanup } = createEvents(ctx);
  const {
    emptyLibrary,
    plainObject,
    assertData,
    validName,
    validateCustomModels,
    modelRegistry,
    rebuildModelRegistry,
    settingsKeys,
    pickSettings,
    snapshotPrompt,
    snapshotConfig,
    capturePresetConfiguration,
    validatePresetSnapshot,
    selectedScopes,
    captureConfiguration,
    validateSnapshot,
    validateLibrary,
    configLibrary,
    workspaceContextKey,
    flushPendingSaves
  } = createConfigurationSchema(ctx);
  const {
    runWorkspaceOperation,
    writeConfigurationData,
    writeWorkspace,
    saveRecovery,
    saveNamedConfiguration,
    renameConfiguration,
    deleteConfiguration,
    withLinkedConnection,
    applyConfiguration,
    exportConfigurations,
    redactSecrets,
    exportRecoverableConfigurations,
    rejectUnsafeKeys,
    importConfigurations,
    downloadConfiguration
  } = createConfigurations(ctx);
  const {
    addCustomModel,
    renameCustomModel,
    deleteCustomModel,
    setCustomTail,
    updateWorkspaceUi,
    configurationIsDirty,
    renderConfigurationShortcut,
    configButton,
    scopeCheckboxes,
    renderConfigurationsTab,
    renderCustomModelControls,
    handleConfigurationAction
  } = createCustomModels(ctx);

  const SCRIPT_ID = getScriptId();

  const HOST_ID = `destined-settings-${SCRIPT_ID}`;
  const WAND_CONTAINER_ID = `destined-settings-wand-${SCRIPT_ID}`;
  const STORAGE_KEY = `destined-settings-ui:${SCRIPT_ID}`;

  let MODEL_ADAPTERS = { ...BUILTIN_MODEL_ADAPTERS };
  let MODEL_IDS = new Set(
    Object.values(MODEL_ADAPTERS).flatMap(adapter => [...adapter.ids, ...adapter.tails]),
  );
  const ID_TO_GROUP = new Map();
  for (const [groupId, group] of Object.entries(GROUPS)) {
    for (const [id] of group.options) ID_TO_GROUP.set(id, groupId);
  }

  const state = {
    activeTab: 'daily',
    entryFilter: 'all',
    disclosures: new Set(),
    config: loadScriptConfig(),
    open: false,
    preset: null,
    profiles: [],
    profileLoading: false,
    saveMessage: '修改后自动保存，下次生成时使用',
    saveState: 'idle',
    search: '',
    styleEditor: null,
    promptEditor: null,
    editorUnlocked: false,
    reorderSaving: false,
    reorderUndo: null,
    workspaceBusy: false,
    modelDraft: { name: '', tailMode: 'no-prefill', binding: '' },
    configurationName: '',
  };

  let volatileUiState = {};
  let currentTheme = UI_THEMES.some(theme => theme.id === loadUiState().theme) ? loadUiState().theme : 'midnight';
  let currentTransparency = normalizeTransparency(loadUiState().transparency);
  let host;
  let shadow;
  let app;
  let saveChain = Promise.resolve();
  let destroyed = false;
  let dialogs = null;
  let configurationScopes = { preset: true, summary: true };
  let exportScopes = { preset: true, summary: true };
  let metadataEnriching = false;
  let suppressOrbClick = false;
  let commitInProgress = false;
  let reconcilePending = false;
  let presetFingerprint = '';
  let syncInterval = 0;
  let pendingPresetOperations = 0;
  let savedScriptConfig;
  const debounceTimers = new Map();
  const eventStops = [];
  const macroStops = [];

  savedScriptConfig = clone(state.config);
  rebuildModelRegistry();

  // Only bound books are inspected. Worldbook I/O never enters the preset save queue.

  const worldLink = { phase: 'idle', message: '打开后检查当前绑定的世界书。', books: [], issues: [], busy: false, dirty: false };
  const worldReads = new Map();
  const worldWrites = new Set();
  let worldEpoch = 0;
  let worldTimer = 0;
  let worldScan = null;
  let worldOperationContext = '';

  // Existing prompt IDs and explicit display assignments serve as boundaries; no extra prompts are injected.

  let promptSort = null;
  let sortClickUntil = 0;

  // Named configurations contain data only; never embed scripts, extensions or the library itself.

  const STYLES = PANEL_CSS + SUMMARY_STYLES + DIALOG_STYLES + TASK_STYLES;

  globalThis.__destinedJourneyAssistant = { destroy: cleanup, open: openPanel };
  try {
    const version = await getTavernHelperVersion();
    if (typeof version === 'string' && typeof isVersionLessThan === 'function' && isVersionLessThan(version, '4.0.0')) {
      toastr.error(`${BUTTON_NAME}需要酒馆助手 4.0.0 或更高版本。`, '版本不兼容');
    }
  } catch {
    // 老版本可能没有版本比较函数，后续 API 错误会给出明确提示。
  }

  syncEntryPoints();

  createUi();
  dialogs = createDialogs({ getRoot: () => shadow, open: () => { if (!state.open) openPanel(); } });
  await summary.initialize({
    popup: (...args) => dialogs.popup(...args),
    chooseFailure: options => dialogs.chooseFailure(options),
    status: (message, kind) => { state.summaryFeedback={message,kind};renderStatus(); },
    getRoot: () => shadow?.querySelector('.destined-root'),
    viewText: (title, value) => dialogs.viewText(title,value),
    form: options => dialogs.form(options),
    openSummary: () => { state.activeTab = 'summary'; openPanel(); },
    changed: () => { const slot = shadow?.querySelector('.configuration-shortcut'); if(slot)slot.innerHTML=renderConfigurationShortcut(); },
  });
  window.parent.addEventListener('resize', handleViewportResize);
  window.parent.visualViewport?.addEventListener('resize', handleViewportResize);
  window.parent.visualViewport?.addEventListener('scroll', handleViewportResize);
  handleViewportResize();
  registerManagedMacros();
  refreshPreset();
  (async () => {
    await initializeManagedSettings();
    await initializeStyleStructures();
  })().catch(error => {
    console.error(`[${SCRIPT_NAME}] 初始化受管设置失败。`, error);
    showErrorToast(error);
  });
  loadProfiles();
  subscribe(getButtonEvent(BUTTON_NAME), openPanel);
  for (const eventName of [
    tavern_events.PRESET_CHANGED,
    tavern_events.OAI_PRESET_CHANGED_AFTER,
    tavern_events.SETTINGS_UPDATED,
  ]) subscribe(eventName, () => reconcilePreset('酒馆预设界面'));
  subscribeLast(tavern_events.CHAT_COMPLETION_PROMPT_READY, eventData => {
    expandOutgoingMessages(eventData?.chat);
  });
  subscribeLast(tavern_events.GENERATE_AFTER_DATA, generateData => {
    expandOutgoingMessages(generateData?.prompt);
  });
  for (const eventName of [
    tavern_events.CONNECTION_PROFILE_LOADED,
    tavern_events.CONNECTION_PROFILE_CREATED,
    tavern_events.CONNECTION_PROFILE_DELETED,
    tavern_events.CONNECTION_PROFILE_UPDATED,
  ]) subscribe(eventName, () => loadProfiles());
  scheduleWorldbookScan();
  for (const eventName of [tavern_events.CHAT_CHANGED, tavern_events.CHARACTER_PAGE_LOADED, tavern_events.CHARACTER_EDITED, tavern_events.WORLDINFO_SETTINGS_UPDATED, tavern_events.PRESET_CHANGED, tavern_events.OAI_PRESET_CHANGED_AFTER]) {
    subscribe(eventName, () => { reconcilePreset('上下文变化'); scheduleWorldbookScan(); });
  }
  subscribe(tavern_events.WORLDINFO_UPDATED, name => {
    try { if (captureWorldContext().names.includes(name)) scheduleWorldbookScan(); } catch { /* next open retries */ }
  });
  syncInterval = window.setInterval(() => {
    if (window.parent.document.hidden) return;
    syncWandEntry();
    if (state.open) reconcilePreset('原生预设界面');
  }, PRESET_SYNC_INTERVAL);
  window.addEventListener('pagehide', cleanup, { once: true });
  return { destroy: cleanup, open: openPanel };
}
