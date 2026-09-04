import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// IndexedDB が使えない環境では localStorage へ確実に保存されることを確かめる。
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};
globalThis.window = {};

const { recordAttempt, loadHistory, setMeta, getMeta } = await import("../src/storage.js");

test("IndexedDB が無くても回答履歴とメタ情報が保存される", async () => {
  const saved = await recordAttempt("item-1", "en-ja", true, 1200);
  assert.equal(saved.itemId, "item-1");
  assert.equal(saved.totalAttempts, 1);

  const history = await loadHistory();
  assert.equal(history.get("item-1").totalAttempts, 1);

  await setMeta("lastSessionResult", { subject: "english", results: [{ itemId: "item-1" }] });
  const restored = await getMeta("lastSessionResult", null);
  assert.equal(restored.subject, "english");
});

test("localStorage への保存が失敗したら例外で呼び出し元に伝える", async () => {
  const original = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => {
    throw new Error("QuotaExceededError");
  };
  await assert.rejects(() => recordAttempt("item-2", "en-ja", false, 900));
  globalThis.localStorage.setItem = original;
});

test("書き込みは transaction の complete まで待つ", () => {
  const source = readFileSync(new URL("../src/storage.js", import.meta.url), "utf8");
  assert.match(source, /tx\.oncomplete = \(\) => resolve\(box\?\.value\)/);
  assert.match(source, /tx\.onabort = \(\)/);
  assert.doesNotMatch(source, /putRequest\.onsuccess/);
});
