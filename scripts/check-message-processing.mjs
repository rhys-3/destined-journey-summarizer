import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../src/summary/config.js';
import { compilePrompt } from '../src/summary/macros.js';
import { optionBlocks } from '../src/summary/archiveDefaults.js';
import { sendPreparedGeneration } from '../src/summary/api.js';
import { configureRuntime, invalidate } from '../src/platform/lifecycle.js';
import * as definitions from '../src/preset/definitions.js';
import { createManaged } from '../src/preset/managed.js';
import { createStore } from '../src/preset/store.js';

const sourcePath = process.argv[process.argv.indexOf('--source') + 1];
if (!process.argv.includes('--source') || !sourcePath) throw Error('Pass --source <命定消息处理.js>');
const source = fs.readFileSync(sourcePath, 'utf8');
const { MESSAGE_MARKERS: m, installMessageProcessing } = await import(pathToFileURL(path.resolve(sourcePath)).href);
const reports = [];
for (const processorFirst of [false, true]) {
const events = { CHAT_COMPLETION_PROMPT_READY: 'prompt', GENERATE_AFTER_DATA: 'data', CHAT_COMPLETION_SETTINGS_READY: 'ready', OAI_PRESET_CHANGED_AFTER: 'preset' };
const listeners = new Map(), errors = [];
const on = (event, fn) => listeners.set(event, [...(listeners.get(event) ?? []), fn]);
const off = (event, fn) => listeners.set(event, (listeners.get(event) ?? []).filter(item => item !== fn));
const emit = async (event, ...args) => { for (const fn of [...(listeners.get(event) ?? [])]) { try { await fn(...args); } catch (error) { errors.push(error.message); } } };
const ctx = { ...definitions, state: { config: { managed_values: { ...definitions.DEFAULT_MANAGED_VALUES } } } };
ctx.sanitizeManagedValues = createStore(ctx).sanitizeManagedValues;
const managed = createManaged(ctx);
globalThis.toastr = { error: message => errors.push(message) };
const onPrompt = data => managed.expandOutgoingMessages(data?.chat);
const onData = data => managed.expandOutgoingMessages(data?.prompt);
on(events.CHAT_COMPLETION_PROMPT_READY, onPrompt);
let instance;
if (processorFirst) instance = installMessageProcessing({ on, off, events, notify: message => errors.push(message) });
on(events.GENERATE_AFTER_DATA, onData);
if (!processorFirst) instance = installMessageProcessing({ on, off, events, notify: message => errors.push(message) });
configureRuntime({}); invalidate();
globalThis.SillyTavern = { getContext: () => ({ chatId: 'fixture' }) };
globalThis.getLoadedPresetName = () => 'fixture';
globalThis.eventMakeLast = () => { throw Error('Summary attempted to register a request hook'); };
globalThis.eventRemoveListener = globalThis.eventMakeLast;
const promptBlocks = DEFAULT_SETTINGS.promptBlocks.map(block => optionBlocks({ prefillTemplate: 'result' }).find(option => option.id === block.id) ?? block);
const compiled = await compilePrompt({ promptBlocks, macroValues: { user: '用户', char: '角色', 'summary.history': '此前记忆', 'summary.material': '[第 0 楼]开局；[第 1 楼]尝试开门；[第 2 楼]门没有打开', 'summary.world_before': '背景', 'summary.character': '角色资料' } }, DEFAULT_SETTINGS);
const main = { prompt: [
  { role: 'system', content: 'SYSTEM_ADAPTER <|字数|>' },
  { role: 'system', content: `${m.bodyStart}<VOID_memory><|命定_记忆区|></VOID_memory><VOID_reference><|命定_参考区|></VOID_reference><historical_record>${m.historyStart}` },
  { role: 'system', content: `MEGA_9999 NORMAL_9998${m.depth900}REFERENCE${m.depth2}RULE` },
  { role: 'assistant', content: 'UNCOVERED_HISTORY' },
  { role: 'user', content: 'LATEST_INPUT' },
  { role: 'system', content: `${m.historyEnd}</historical_record><VOID_runtime><|命定_运行规则区|></VOID_runtime>${m.bodyEnd}` },
  { role: 'assistant', content: 'ASSISTANT_PREFILL' },
] };
const queued = [];
globalThis.generateRaw = config => new Promise(resolve => queued.push({ config, resolve }));
const prepared = { config: { ordered_prompts: compiled.orderedPrompts, max_chat_history: 0, overrides: { chat_history: { prompts: [], with_depth_entries: false } } } };
const one = sendPreparedGeneration(prepared, DEFAULT_SETTINGS), two = sendPreparedGeneration(prepared, DEFAULT_SETTINGS);
await emit('prompt', { chat: main.prompt });
const expandedText = main.prompt.map(message => message.content).join('\n');
assert([...Object.values(m), '<|命定_记忆区|>', '<|命定_参考区|>', '<|命定_运行规则区|>'].every(marker => expandedText.includes(marker)));
await emit('data', main, false);
const mainRequest = { messages: main.prompt, stop: [], custom_prompt_post_processing: 'strict' };
const summaryRoles = [];
for (const item of queued.toReversed()) {
  const data = { messages: structuredClone(item.config.ordered_prompts), stop: ['KEPT'], custom_prompt_post_processing: 'strict' };
  const original = structuredClone(data);
  await emit('prompt', { chat: data.messages });
  await emit('data', { prompt: data.messages }, false);
  await emit('ready', data); await emit('ready', mainRequest);
  assert.deepEqual(data, original);
  assert.deepEqual(data.messages, compiled.orderedPrompts);
  assert(!Object.hasOwn(data, 'toJSON'));
  assert(!JSON.stringify(data.messages).includes('<|destined:'));
  summaryRoles.push(data.messages.map(message => message.role));
  item.resolve('完成');
}
assert.deepEqual(await Promise.all([one, two]), ['完成', '完成']);
assert.notEqual(queued[0].config.generation_id, queued[1].config.generation_id);
assert.deepEqual(main.prompt.map(message => message.role), ['system', 'user', 'assistant']);
assert.equal(main.prompt[0].content, 'SYSTEM_ADAPTER 1500');
assert(!JSON.stringify(main.prompt).includes('<|命定_'));
assert(main.prompt[1].content.includes('<VOID_memory>MEGA_9999 NORMAL_9998</VOID_memory>'));
assert(main.prompt[1].content.includes('<VOID_reference>REFERENCE</VOID_reference>'));
assert(main.prompt[1].content.includes('<VOID_runtime>RULE</VOID_runtime>'));
assert(main.prompt[1].content.includes('Participant:<Participant_input>\nLATEST_INPUT\n</Participant_input>'));
assert.deepEqual(mainRequest.stop, ['Participant:']);
assert.equal(mainRequest.custom_prompt_post_processing, 'strict');
instance.dispose();
off(events.CHAT_COMPLETION_PROMPT_READY, onPrompt);
off(events.GENERATE_AFTER_DATA, onData);
assert.equal([...listeners.values()].flat().length, 0); assert.deepEqual(errors, []);
reports.push({ processorFirst, summaryRoles, mainRoles: main.prompt.map(message => message.role) });
}
const report = { sourceSha256: crypto.createHash('sha256').update(source).digest('hex'), testedAt: new Date().toISOString(), cases: reports, verified: ['both macro expansion events preserve all nine structural markers without warnings', 'either processor registration order produces the same final main request', 'all structural markers are consumed before the final request', 'main body partitions, prefixes and latest-input tag', 'two interleaved summary requests preserve exact compiled roles and content', 'summary requests add no markers or serialization hooks', 'only the main request gains its stop word; strict remains unchanged', 'processor and macro listeners removed on disposal'], boundary: 'Actual managed-macro module, message processor and summary API with simulated Tavern events. No live Tavern or model request.' };
fs.mkdirSync('.ui-review', { recursive: true }); fs.writeFileSync('.ui-review/message-processing-integration.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
