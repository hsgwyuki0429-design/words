import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const healthNotesSource = readFileSync(new URL("../health-notes.html", import.meta.url), "utf8");
const publicNotesSource = readFileSync(new URL("../public-notes.html", import.meta.url), "utf8");

function ruleBody(source, selector) {
  const start = source.indexOf(selector);
  assert.notEqual(start, -1, `${selector} が見つからない`);
  const open = source.indexOf("{", start);
  const close = source.indexOf("}", open);
  return source.slice(open + 1, close);
}

test("画面に収まっているときは指で引っ張っても動かない", () => {
  assert.match(ruleBody(stylesSource, "\nhtml {"), /overscroll-behavior:\s*none/);
  assert.match(ruleBody(stylesSource, "\nbody {"), /overscroll-behavior:\s*none/);
});

test("横に払っても画面がずれない", () => {
  assert.match(ruleBody(stylesSource, "\nbody {"), /overflow-x:\s*hidden/);
});

test("まとめノートでも端で跳ねない", () => {
  assert.match(healthNotesSource, /html\{[^}]*overscroll-behavior:none/);
  assert.match(publicNotesSource, /html\{[^}]*overscroll-behavior:none/);
});

test("MAXのときは学習画面に白い面を敷かず、背景の演出を見せる", () => {
  assert.match(
    stylesSource,
    /body\.max-mode \.quiz-view \{\s*background: transparent;\s*\}/,
  );
});

test("MAXの学習画面では、背景に直に乗る文字が暗い背景でも読める", () => {
  // 進捗の数字は白。土台の進捗バーも白側の色にそろえる。
  assert.match(stylesSource, /body\.max-mode\.quiz-active \.quiz-progress-copy/);
  assert.match(
    ruleBody(stylesSource, "body.max-mode.quiz-active .quiz-progress {"),
    /background:\s*rgba\(255, 255, 255/,
  );
  assert.match(
    ruleBody(stylesSource, "body.max-mode.quiz-active .mode-pill {"),
    /color:\s*#eaf6ff/,
  );
  assert.match(
    ruleBody(stylesSource, "body.max-mode.quiz-active .quiz-header .icon-button {"),
    /color:\s*#eaf6ff/,
  );
});
