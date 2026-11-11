import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  applyBasicFirstAnswer,
  buildBasicQueue,
  normalizeBasicScope,
  summarizeBasicLevels,
} from "../src/logic.js";

const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const items = ["a", "b", "c", "d"].map((id) => ({ id }));

test("公共（ベーシック）は、習得の回数がいちばん少ない問題だけを出す", () => {
  const levels = { a: 2, b: 1, c: 1 };
  const queue = buildBasicQueue({ items, levels, mode: "public_recall", rng: () => 0.5 });
  assert.deepEqual(queue.map((entry) => entry.item.id), ["d"]);
  assert.ok(queue.every((entry) => entry.mode === "public_recall"));
  // d も1回習得すると、いちばん少ないのは1回の b・c・d になる。
  const next = buildBasicQueue({ items, levels: { ...levels, d: 1 }, mode: "public_recall" });
  assert.deepEqual(next.map((entry) => entry.item.id).sort(), ["b", "c", "d"]);
});

test("設定で「すべて1周」を選ぶと、全部を習得の回数が少ない順に出す", () => {
  const queue = buildBasicQueue({ items, levels: { a: 2, b: 1 }, mode: "public_choice", scope: "all", rng: () => 0.5 });
  const ids = queue.map((entry) => entry.item.id);
  assert.equal(ids.length, 4);
  assert.deepEqual(ids.slice(2), ["b", "a"]);
  assert.deepEqual(ids.slice(0, 2).sort(), ["c", "d"]);
  assert.equal(normalizeBasicScope("all"), "all");
  assert.equal(normalizeBasicScope("unknown"), "lowest");
});

test("最初に答えたときに正解すると、習得の回数が1つ増える", () => {
  assert.deepEqual(applyBasicFirstAnswer({ a: 1 }, "a", true), { a: 2 });
  assert.deepEqual(applyBasicFirstAnswer({ a: 1 }, "a", false), { a: 1 });
  assert.deepEqual(applyBasicFirstAnswer({}, "b", true), { b: 1 });
});

test("カードには、選んだ問題のうち習得1回・習得2回の割合を出す", () => {
  const summary = summarizeBasicLevels({ itemIds: ["a", "b", "c", "d"], levels: { a: 2, b: 1, c: 3 } });
  assert.equal(summary.total, 4);
  assert.equal(summary.onceCount, 3);
  assert.equal(summary.oncePercent, 75);
  assert.equal(summary.twiceCount, 2);
  assert.equal(summary.twicePercent, 50);
  assert.deepEqual(summary.segments.map((segment) => segment.label), ["習得3回", "習得2回", "習得1回", "未習得"]);
});

test("公共のホームは、形式の切り替え・題名と重要度の複数選択・黒いカードで進む", () => {
  assert.match(appSource, /if \(isBasicHome\(\)\) \{/);
  assert.match(appSource, /data-basic-range="\$\{escapeHtml\(range\)\}" aria-pressed="\$\{selected\}"/);
  assert.match(appSource, /attribute: `data-basic-importance="\$\{value\}"`/);
  assert.match(appSource, /\$\{attribute\} aria-pressed="\$\{selected\}"/);
  // 形式は2段の切り替え（上段：問題の種類・向き、下段：形式）。
  assert.match(appSource, /data-format-\$\{level\}="\$\{entry\.key\}"/);
  // 公共には「習得・テスト」の切り替えも、前回の続きのカードも出さない。
  assert.match(appSource, /elements\.modeSwitch\.hidden = !periodHasData\(\) \|\| isBasicHome\(\);/);
  assert.match(appSource, /return state\.homeMode === "test" && !isBasicHome\(\);/);
  // 出す問題の選び方は設定に置く。
  assert.match(appSource, /data-basic-scope="\$\{scope\}"/);
});

test("形式の切り替えは、英語は向き→形式、公共は一問一答・正誤問題→形式の2段", () => {
  assert.match(appSource, /\{ key: "en_to_ja", label: "英語 → 日本語", subs: \[/);
  assert.match(appSource, /\{ key: "ja_to_en_input", label: "キーボード", mode: "ja_to_en_input" \}/);
  assert.match(appSource, /\{ key: "statement", label: "正誤問題", subs: \[\s*\{ key: "statement_choice", label: "4択", mode: "public_choice", type: "public-statement" \},\s*\] \}/);
  // 1つしか無い形式は動かせない。
  assert.match(appSource, /const locked = entries\.length < 2;/);
  // 英語は範囲と重要度を同じ画面で1つずつ選び、カードを押すと始まる。
  assert.match(appSource, /if \(target\.dataset\.englishRange\) pickEnglish\("range", target\.dataset\.englishRange\);/);
  assert.match(appSource, /if \(target\.dataset\.englishImportance\) pickEnglish\("importance", target\.dataset\.englishImportance\);/);
  assert.match(appSource, /if \(target\.hasAttribute\("data-english-start"\)\) startEnglishPractice\(\);/);
});
