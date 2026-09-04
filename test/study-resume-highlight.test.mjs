import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  createStudyProgress,
  applyStudyAnswer,
  inProgressStudyEntries,
  isStudyInProgress,
  studyProgressKey,
} from "../src/logic.js";

const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

function progressFor({ ranges, mode = "en_to_ja_choice", contents = "word" }) {
  const key = JSON.stringify({
    subject: "english",
    ranges,
    contents,
    mode,
    importance: [],
    types: [],
    tags: [],
    minimumWrong: 0,
  });
  return { key, progress: createStudyProgress({ key, itemIds: ["a", "b"] }) };
}

test("1問も解いていない周回や、解き終えた周回は学習途中に含めない", () => {
  const { progress } = progressFor({ ranges: ["OriHime"] });
  assert.equal(isStudyInProgress(progress), false);

  const started = applyStudyAnswer(progress, { itemId: "a", correct: true });
  assert.equal(isStudyInProgress(started), true);

  const finished = applyStudyAnswer(started, { itemId: "b", correct: true });
  assert.equal(isStudyInProgress(finished), false);
});

test("学習途中の周回は、範囲と形式ごとに最後に学習した順で取り出せる", () => {
  const oriHime = progressFor({ ranges: ["OriHime"], mode: "en_to_ja_flashcard" });
  const other = progressFor({ ranges: ["Bridge"], mode: "en_to_ja_choice" });
  const progressMap = {
    [oriHime.key]: applyStudyAnswer(oriHime.progress, { itemId: "a", correct: false, now: 100 }),
    [other.key]: applyStudyAnswer(other.progress, { itemId: "a", correct: false, now: 200 }),
  };
  const entries = inProgressStudyEntries(progressMap, { subject: "english" });
  assert.deepEqual(entries.map(({ meta }) => meta.ranges), [["Bridge"], ["OriHime"]]);
  assert.deepEqual(entries.map(({ meta }) => meta.mode), ["en_to_ja_choice", "en_to_ja_flashcard"]);
  // 教科が違えば拾わない。
  assert.equal(inProgressStudyEntries(progressMap, { subject: "public" }).length, 0);
});

test("進捗キーは範囲と形式の組み合わせごとに分かれる", () => {
  const base = { subject: "english", selection: { subject: "english", contents: ["word"], direction: "en_to_ja", method: "en_to_ja_flashcard" } };
  const oriHime = studyProgressKey({ ...base, filters: { ranges: ["OriHime"] } });
  const bridge = studyProgressKey({ ...base, filters: { ranges: ["Bridge"] } });
  assert.ok(oriHime && bridge);
  assert.notEqual(oriHime, bridge);
});

test("範囲ボタンと形式カードだけを、一致する周回があるときにハイライトする", () => {
  // 範囲一覧・複数範囲選択は、途中の周回が対象にしている範囲をハイライトする。
  assert.match(appSource, /const resumableRanges = rangesInProgress\(\);/);
  assert.match(appSource, /data-dashboard-range="\$\{escapeHtml\(range\)\}"/);
  assert.match(appSource, /class="range-choice\$\{resumableRanges\.has\(range\) \? " is-in-progress" : ""\}/);
  assert.match(appSource, /class="multi-select-card\$\{selected \? " selected" : ""\}\$\{resumable \? " is-in-progress" : ""\}/);
  // 形式カードは、いま選んでいる範囲・条件に一致する周回のときだけハイライトする。
  assert.match(appSource, /const resumable = isStudyInProgress\(entry\?\.progress\);/);
  assert.match(appSource, /class="mode-progress-card\$\{resumable \? " is-in-progress" : ""\}/);
  assert.match(stylesSource, /\.mode-progress-card\.is-in-progress \{[\s\S]*?border-color: var\(--red\)/);
});
