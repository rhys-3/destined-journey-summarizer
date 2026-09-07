// Resolve lazily: Tavern Helper may expose an API as a global lexical binding.
// This module deliberately does not declare bindings with the API names.
export function helperApi(name) {
  const api = {
    generateRaw: typeof generateRaw === 'function' ? generateRaw : undefined,
    createWorldbook: typeof createWorldbook === 'function' ? createWorldbook : undefined,
    replaceWorldbook: typeof replaceWorldbook === 'function' ? replaceWorldbook : undefined,
    deleteWorldbook: typeof deleteWorldbook === 'function' ? deleteWorldbook : undefined,
    rebindGlobalWorldbooks: typeof rebindGlobalWorldbooks === 'function' ? rebindGlobalWorldbooks : undefined,
    createWorldbookEntries: typeof createWorldbookEntries === 'function' ? createWorldbookEntries : undefined,
    updateWorldbookWith: typeof updateWorldbookWith === 'function' ? updateWorldbookWith : undefined,
    setChatMessages: typeof setChatMessages === 'function' ? setChatMessages : undefined,
    replaceVariables: typeof replaceVariables === 'function' ? replaceVariables : undefined,
    getLoadedPresetName: typeof getLoadedPresetName === 'function' ? getLoadedPresetName : undefined,
    getWorldbookNames: typeof getWorldbookNames === 'function' ? getWorldbookNames : undefined,
    getGlobalWorldbookNames: typeof getGlobalWorldbookNames === 'function' ? getGlobalWorldbookNames : undefined,
    stopGenerationById: typeof stopGenerationById === 'function' ? stopGenerationById : undefined,
    eventMakeLast: typeof eventMakeLast === 'function' ? eventMakeLast : undefined,
    eventRemoveListener: typeof eventRemoveListener === 'function' ? eventRemoveListener : undefined,
  }[name];
  return api ?? globalThis[name];
}
export function tavernContext() { return typeof SillyTavern !== 'undefined' ? SillyTavern : globalThis.SillyTavern; }
