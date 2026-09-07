import test from 'node:test';
import assert from 'node:assert/strict';
import * as definitions from '../src/preset/definitions.js';
import { createManaged } from '../src/preset/managed.js';
import { createStore } from '../src/preset/store.js';

const markers = ['正文开始', '历史开始', '深度900分界', '深度2分界', '历史结束', '正文结束', '记忆区', '参考区', '运行规则区'].map(name => `<|命定_${name}|>`);
function setup(t, overrides = {}) {
  const notices = [], previousToast = globalThis.toastr;
  globalThis.toastr = { error: message => notices.push(message) };
  t.after(() => { globalThis.toastr = previousToast; });
  t.mock.method(console, 'error', () => {});
  const ctx = { ...definitions, state: { config: { managed_values: { ...definitions.DEFAULT_MANAGED_VALUES, ...overrides } } } };
  ctx.sanitizeManagedValues = createStore(ctx).sanitizeManagedValues;
  return { ...createManaged(ctx), notices };
}

test('managed expansion preserves all current message boundaries and regions without unknown-macro warnings', t => {
  const managed = setup(t);
  for (const marker of markers) {
    const input = `前文 ${marker} <|字数|> <|正文语言|> 后文`;
    assert.equal(managed.expandManagedMacros(input, true), `前文 ${marker} 1500 简体中文 后文`);
  }
  assert.deepEqual(managed.notices, []);
});

test('both outgoing macro passes preserve structural markers and non-text message parts', t => {
  const managed = setup(t);
  const image = { type: 'image_url', image_url: { url: 'data:image/png;base64,fixture' } };
  const messages = [
    { role: 'system', name: 'adapter', content: `${markers[0]} <|字数|>` },
    { role: 'user', content: [{ type: 'text', text: markers.slice(1).join('\n') }, image] },
  ];
  managed.expandOutgoingMessages(messages);
  const firstPass = structuredClone(messages);
  managed.expandOutgoingMessages(messages);
  assert.deepEqual(messages, firstPass);
  assert.equal(messages[0].content, `${markers[0]} 1500`);
  assert.equal(messages[1].content[0].text, markers.slice(1).join('\n'));
  assert.deepEqual(messages[1].content[1], image);
  assert.equal(messages[0].name, 'adapter');
  assert.deepEqual(managed.notices, []);
});

test('unknown names and retired region names remain blocked without removing valid markers', t => {
  const managed = setup(t);
  const unknown = ['<|命定_正文开始错字|>', '<|命定_未知|>', '<|命定_记忆填入处|>', '<|命定_参考填入处|>', '<|命定_运行规则填入处|>'];
  assert.equal(managed.expandManagedMacros([markers[0], ...unknown, markers[6]].join(''), true), markers[0] + markers[6]);
  assert.equal(managed.notices.length, 1);
  assert(unknown.every(token => managed.notices[0].includes(token)));
  assert(!managed.notices[0].includes(markers[0]));
  assert(!managed.notices[0].includes(markers[6]));
});

test('recursive managed values still cannot leave short macros in outgoing content', t => {
  const managed = setup(t, { global_preference: '<|字数|>' });
  assert.equal(managed.expandManagedMacros(`${markers[0]}<|全局偏好|>${markers[5]}`, true), markers[0] + markers[5]);
  assert.equal(managed.notices.length, 1);
  assert.match(managed.notices[0], /短宏递归残留/);
});
