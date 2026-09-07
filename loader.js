/* SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
Required Notice: Copyright (c) 2024-2026 Rhys_z_瑞
Required Notice: Licensing scope and historical/third-party exceptions: https://github.com/rhys-3/destined-journey-assistant/blob/main/docs/LICENSING.md
License: https://spdx.org/licenses/PolyForm-Noncommercial-1.0.0.html
*/
// Paste this loader into the existing 命定预设助手 script (preserve its UUID and variables).
const version = '3.1.1';
const url = `https://cdn.jsdelivr.net/gh/rhys-3/destined-journey-assistant@v${version}/dist/destined-journey-assistant.js`;
let loading = false;
let attempt = 0;
let retryEvent;
async function loadAssistant() {
  if (loading) return;
  loading = true;
  try {
    await import(attempt ? `${url}?retry=${attempt}` : url);
    retryEvent?.stop?.();
    updateScriptButtonsWith(buttons => buttons.filter(button => button.name !== '重新加载命定预设助手'));
  } catch (error) {
    console.error(`[命定预设助手 v${version}] 加载失败`, error);
    toastr.error(`命定预设助手 v${version} 加载失败：${error.message}。可点击“重新加载命定预设助手”重试。`);
    updateScriptButtonsWith(buttons => [...buttons.filter(button => button.name !== '重新加载命定预设助手'), { name: '重新加载命定预设助手', visible: true }]);
    retryEvent ??= eventOn(getButtonEvent('重新加载命定预设助手'), () => { attempt++; return loadAssistant(); });
  } finally {
    loading = false;
  }
}
await loadAssistant();
