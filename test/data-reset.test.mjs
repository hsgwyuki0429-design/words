import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 学習データの初期化は、消したあと画面を読み込み直すまでのあいだに
// 書き込みが走ると意味がなくなる。IndexedDB が無い環境（localStorage）で確かめる。
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};
globalThis.window = {};

const { recordAttempt, setMeta, getMeta, stashMeta, clearAllData, loadHistory } =
  await import("../src/storage.js");

const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");

test("初期化のあとは退避も保存も書き戻さない", async () => {
  await setMeta("studyProgress", { "key-1": { cycleNumber: 3, masteryRound: 2 } });
  await recordAttempt("item-1", "en-ja", true, 1000);
  assert.ok(await getMeta("studyProgress", null), "初期化前は保存されている");

  await clearAllData();

  // 読み込み直す直前の pagehide でここが走ると、消した周回が控えから復活する。
  stashMeta("studyProgress", { "key-1": { cycleNumber: 3, masteryRound: 2 } });
  await setMeta("studyProgress", { "key-1": { cycleNumber: 3, masteryRound: 2 } });
  await recordAttempt("item-1", "en-ja", true, 1000);

  assert.equal(await getMeta("studyProgress", null), null, "周回・進捗は復活しない");
  assert.equal((await loadHistory()).size, 0, "回答履歴も復活しない");
});

test("初期化は書き込みを止めてから消す", () => {
  const source = readFileSync(new URL("../src/storage.js", import.meta.url), "utf8");
  // 消す前にフラグを立てないと、消している最中の退避を取りこぼす。
  const clearSource = source.slice(source.indexOf("export async function clearAllData"));
  const flagAt = clearSource.indexOf("dataCleared = true;");
  const removeAt = clearSource.indexOf("localStorage.removeItem(PENDING_KEY)");
  assert.ok(flagAt > 0 && flagAt < removeAt, "控えを消す前に書き込みを止める");
  assert.match(source, /export async function clearAllData[\s\S]*?pendingRestore = Promise\.resolve\(\)/);
  // 退避・保存の入口はすべてフラグを見る
  for (const entry of ["stashMeta", "setMeta", "recordAttempt", "putHistory", "removeHistory", "addPending"]) {
    const body = source.slice(source.indexOf(`function ${entry}(`));
    assert.match(body.slice(0, 400), /if \(dataCleared\)/, `${entry} が初期化後に書き込まない`);
  }
});

test("初期化のあとは画面を読み込み直す", () => {
  assert.match(appSource, /clearAllData\(\)\s*\n\s*\.then\(\(\) => location\.reload\(\)\)/);
});
