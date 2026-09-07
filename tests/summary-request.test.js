import test from 'node:test';
import assert from 'node:assert/strict';
import { sendPreparedGeneration } from '../src/summary/api.js';
import { configureRuntime, invalidate, cancelOwnRequests } from '../src/platform/lifecycle.js';

const prompts = [{ role: 'system', content: '归档规则' }, { role: 'system', content: '背景' }, { role: 'user', content: '第 0 楼材料' }, { role: 'user', content: '第 1 楼材料' }, { role: 'assistant', content: '<summary_result>' }];
const prepared = () => ({ config: { ordered_prompts: structuredClone(prompts), max_chat_history: 0, overrides: { chat_history: { prompts: [], with_depth_entries: false } } } });
const settings = { apiMode: 'tavern', customApiKey: '' };
let chat, stopped;
test.beforeEach(() => {
  configureRuntime({}); invalidate(); chat = 'a'; stopped = [];
  globalThis.SillyTavern = { getContext: () => ({ chatId: chat }), chatCompletionSettings: { custom_prompt_post_processing: 'strict', stop: ['KEEP'] } };
  globalThis.getLoadedPresetName = () => 'test';
  globalThis.stopGenerationById = id => stopped.push(id);
  globalThis.eventMakeLast = () => { throw new Error('Summary must not register a serialization hook'); };
  globalThis.eventRemoveListener = globalThis.eventMakeLast;
});

test('summary sends exact natural roles and content directly through generateRaw without request hooks', async () => {
  const input = prepared(), before = structuredClone(input), active = structuredClone(SillyTavern.chatCompletionSettings);
  globalThis.generateRaw = async config => {
    assert.deepEqual(config.ordered_prompts, prompts);
    assert.deepEqual(config.overrides, input.config.overrides);
    assert.equal(config.max_chat_history, 0);
    assert.match(config.generation_id, /^destined-summary-/);
    assert(!Object.hasOwn(config, 'toJSON'));
    assert(!Object.hasOwn(config, 'stop'));
    assert(!Object.hasOwn(config, 'custom_prompt_post_processing'));
    assert(!JSON.stringify(config.ordered_prompts).includes('no-trans'));
    assert(!JSON.stringify(config.ordered_prompts).includes('destined-summary'));
    config.ordered_prompts[0].content = 'host modification';
    return ' 完成 ';
  };
  assert.equal(await sendPreparedGeneration(input, settings), '完成');
  assert.deepEqual(input, before);
  assert.deepEqual(SillyTavern.chatCompletionSettings, active);
  assert.deepEqual(stopped, []);
});

test('parallel summary requests use independent snapshots and cancellation targets only their own ids', async () => {
  const calls = [], input = prepared();
  globalThis.generateRaw = config => new Promise(resolve => calls.push({ config, resolve }));
  const one = sendPreparedGeneration(input, settings), two = sendPreparedGeneration(input, settings);
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].config.generation_id, calls[1].config.generation_id);
  assert.notEqual(calls[0].config.ordered_prompts, calls[1].config.ordered_prompts);
  const results = Promise.allSettled([one, two]);
  cancelOwnRequests();
  const cancelled = await results;
  assert(cancelled.every(result => result.status === 'rejected' && result.reason.name === 'AbortError'));
  assert.deepEqual(stopped, calls.map(call => call.config.generation_id));
  calls.forEach(call => call.resolve('late response'));
  assert.deepEqual(input.config.ordered_prompts, prompts);
});

test('a changed chat rejects a late response even when generateRaw finishes normally', async () => {
  let finish;
  globalThis.generateRaw = () => new Promise(resolve => { finish = resolve; });
  const result = sendPreparedGeneration(prepared(), settings);
  chat = 'b'; finish('旧聊天结果');
  await assert.rejects(result, error => error.name === 'AbortError' && /已变化/.test(error.message));
});
