import test from 'node:test';
import assert from 'node:assert/strict';
import { createHaptics } from '../src/haptics.js';

function setup({ enabled = true, active = false, supported = true } = {}) {
  const calls = [];
  const listeners = {};
  const documentObject = { hidden: false, addEventListener(type, callback) { listeners[type] = callback; } };
  const navigatorObject = { userActivation: { hasBeenActive: active } };
  if (supported) navigatorObject.vibrate = (pattern) => { calls.push(pattern); return true; };
  const settings = { enabled };
  const haptics = createHaptics({ isEnabled: () => settings.enabled, documentObject, navigatorObject });
  return { haptics, calls, listeners, documentObject, navigatorObject, settings };
}

test('起動時は操作を待ち、信頼された最初の操作で一度だけ振動する', () => {
  const s = setup();
  s.haptics.start();
  s.haptics.start();
  assert.deepEqual(s.calls, []);
  s.listeners.click({ isTrusted: false });
  assert.deepEqual(s.calls, []);
  s.navigatorObject.userActivation.hasBeenActive = true;
  s.listeners.click({ isTrusted: true });
  s.listeners.keyup({ isTrusted: true });
  assert.deepEqual(s.calls, [12]);
});

test('最初の学習操作では起動通知を重ねず、反転・正解・不正解を区別する', () => {
  const s = setup();
  s.haptics.start();
  s.navigatorObject.userActivation.hasBeenActive = true;
  s.haptics.trigger('flip');
  s.listeners.click({ isTrusted: true });
  s.haptics.trigger('correct');
  s.haptics.trigger('wrong');
  assert.deepEqual(s.calls, [10, [15, 35, 25], [35, 45, 35]]);
});

test('設定オフ・非表示・未操作・非対応でも学習を妨げない', () => {
  for (const options of [{enabled:false,active:true}, {supported:false,active:true}, {}]) {
    const s = setup(options);
    assert.equal(s.haptics.trigger('correct'), false);
    assert.deepEqual(s.calls, []);
  }
  const s = setup({active:true});
  s.documentObject.hidden = true;
  assert.equal(s.haptics.trigger('flip'), false);
  s.documentObject.hidden = false;
  s.navigatorObject.vibrate = () => { throw new Error('制限'); };
  assert.equal(s.haptics.trigger('flip'), false);
  assert.doesNotThrow(() => s.haptics.stop());
});

test('画面を離れたら停止し、復帰時は設定に従う', () => {
  const s = setup({active:true});
  s.haptics.start();
  s.documentObject.hidden = true;
  s.listeners.visibilitychange();
  s.documentObject.hidden = false;
  s.listeners.visibilitychange();
  s.settings.enabled = false;
  s.listeners.visibilitychange();
  assert.deepEqual(s.calls, [12, 0, 12]);
});
