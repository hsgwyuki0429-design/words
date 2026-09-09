import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DEFAULT_THEME_PREFERENCE,
  THEME_STORAGE_KEY,
  applyThemePreference,
  normalizeThemePreference,
  readStoredThemePreference,
  resolveTheme,
  watchSystemTheme,
} from "../src/theme.js";

const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");

// 最低限のダミー画面。data-theme と localStorage の書き込みだけを見る。
function fakeView({ prefersDark = false, storage = new Map() } = {}) {
  const listeners = [];
  const metas = {
    'meta[name="theme-color"]': { content: "", setAttribute(_, value) { this.content = value; } },
  };
  return {
    listeners,
    document: {
      documentElement: { dataset: {} },
      querySelector: (selector) => metas[selector] ?? null,
    },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, value),
    },
    matchMedia: () => ({
      matches: prefersDark,
      addEventListener: (_, handler) => listeners.push(handler),
      removeEventListener: (_, handler) => listeners.splice(listeners.indexOf(handler), 1),
    }),
    metas,
  };
}

test("設定は system・light・dark の3つだけを受け付ける", () => {
  assert.equal(normalizeThemePreference("dark"), "dark");
  assert.equal(normalizeThemePreference("light"), "light");
  assert.equal(normalizeThemePreference("system"), "system");
  assert.equal(normalizeThemePreference("SOLAR"), DEFAULT_THEME_PREFERENCE);
  assert.equal(normalizeThemePreference(undefined), "system");
});

test("端末に合わせる設定は、端末の夜間モードで結果が変わる", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
  // 自分で決めた場合は端末の状態に左右されない。
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
});

test("適用すると data-theme と theme-color が切り替わり、設定が控えられる", () => {
  const storage = new Map();
  const view = fakeView({ prefersDark: true, storage });
  assert.equal(applyThemePreference("system", { view }), "dark");
  assert.equal(view.document.documentElement.dataset.theme, "dark");
  assert.equal(view.document.documentElement.dataset.themePreference, "system");
  assert.equal(view.metas['meta[name="theme-color"]'].content, "#000000");
  assert.equal(storage.get(THEME_STORAGE_KEY), "system");

  assert.equal(applyThemePreference("light", { view }), "light");
  assert.equal(view.document.documentElement.dataset.theme, "light");
  assert.equal(view.metas['meta[name="theme-color"]'].content, "#f6f6f7");
  assert.equal(readStoredThemePreference({ view }), "light");
});

test("端末に合わせるあいだは、端末側の切り替えに追従できる", () => {
  const view = fakeView();
  const seen = [];
  const stop = watchSystemTheme((dark) => seen.push(dark), { view });
  view.listeners.forEach((handler) => handler({ matches: true }));
  assert.deepEqual(seen, [true]);
  stop();
  assert.equal(view.listeners.length, 0);
});

test("保存できない端末でも既定値で動く", () => {
  const view = fakeView();
  view.localStorage = {
    getItem() { throw new Error("保存できません"); },
    setItem() { throw new Error("保存できません"); },
  };
  assert.equal(readStoredThemePreference({ view }), "system");
  assert.equal(applyThemePreference("dark", { view }), "dark");
});

test("設定画面に明るさの選択肢があり、保存と反映がつながっている", () => {
  assert.match(appSource, /<h2>画面の明るさ<\/h2>/);
  assert.match(appSource, /data-theme-preference="\$\{value\}"/);
  assert.match(appSource, /state\.settings\.theme = normalizeThemePreference\(target\.dataset\.themePreference\)/);
  assert.match(appSource, /settings\.theme \?\? readStoredThemePreference\(\)/);
});

test("ダークモードの配色が用意され、最初の描画前に適用される", () => {
  assert.match(stylesSource, /:root\[data-theme="dark"\]\s*\{[^}]*color-scheme: dark;/);
  assert.match(stylesSource, /:root\[data-theme="dark"\]\s*\{[^}]*--background: #000000;/);
  // 起動直後のちらつきを防ぐため、CSSより前に明るさを決めている。
  const script = indexSource.indexOf("words:theme-preference");
  const stylesheet = indexSource.indexOf("styles.css");
  assert.ok(script > 0 && script < stylesheet, "明るさの判定はstyles.cssの読み込みより前にあること");
});
