import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  createStudyProgress,
  applyStudyAnswer,
  inProgressStudyEntries,
  isStudyInProgress,
  studyEntriesByRecency,
  studyProgressKey,
} from "../src/logic.js";

const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");

function functionSource(name, nextName) {
  const start = appSource.indexOf(`function ${name}`);
  const end = appSource.indexOf(`function ${nextName}`, start + 1);
  assert.ok(start >= 0 && end > start, `${name} と ${nextName} が並んでいること`);
  return appSource.slice(start, end);
}
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

test("押した先で実際に続けられるボタンだけをハイライトする", () => {
  // 範囲ボタンは、その範囲だけを対象にした周回が途中のときだけ光る。
  assert.match(appSource, /const resumableRanges = rangesInProgress\(\);/);
  assert.match(appSource, /class="range-choice\$\{resumableRanges\.has\(range\) \? " is-in-progress" : ""\}/);
  assert.match(
    functionSource("rangesInProgress", "allRangesInProgress"),
    /const list = latestStudyRanges\(\);[\s\S]*?list\.length === 1 \? list : \[\]/,
  );
  // 途中の周回がほかにあっても、基準はいちばん最近学習したセット。
  assert.match(
    functionSource("latestStudyRanges", "rangesInProgress"),
    /latestStudyEntry\(\)\?\.meta\.ranges/,
  );
  assert.match(
    functionSource("latestStudyEntry", "sessionResultSnapshot"),
    /recentStudyEntries\(\)\[0\]/,
  );
  // 形式カードは、いま選んでいる範囲・条件に一致する周回のときだけ光る。
  assert.match(appSource, /const resumable = Boolean\(entry\) && entry\.key === latestStudyEntry\(\)\?\.key;/);
  assert.match(appSource, /class="mode-progress-card\$\{resumable \? " is-in-progress" : ""\}/);
  assert.match(stylesSource, /\.mode-progress-card\.is-in-progress \{[\s\S]*?border-color: var\(--red\)/);
  // 複数範囲選択は選び終わるまで条件が決まらないので、個別の範囲カードは光らせない。
  assert.doesNotMatch(appSource, /data-study-range="\$\{escapeHtml\(range\)\}"[\s\S]{0,200}?is-in-progress/);
});

test("全範囲の周回は「全範囲」ボタンだけを光らせ、個別の範囲には広げない", () => {
  const all = progressFor({ ranges: ["OriHime", "Mars"] });
  const progressMap = {
    [all.key]: applyStudyAnswer(all.progress, { itemId: "a", correct: false }),
  };
  const entries = inProgressStudyEntries(progressMap, { subject: "english" });
  assert.equal(entries.length, 1);
  // 範囲ボタンの判定は「その範囲だけを対象にした周回」なので、2範囲の周回は拾わない。
  const singleRangeOnly = new Set(
    entries.flatMap(({ meta }) => (meta.ranges.length === 1 ? meta.ranges : [])),
  );
  assert.equal(singleRangeOnly.size, 0);
});

test("続きのある学習内容（単語・熟語・構文・全選択）もハイライトする", () => {
  const source = functionSource("contentsInProgress", "rangeDetailLabel");
  // いちばん最近学習したセットが、範囲（と決まっていれば形式）に一致するときだけ光らせる。
  assert.match(source, /const meta = latestStudyEntry\(\)\?\.meta;/);
  assert.match(source, /if \(studyContentsKey\(meta\.ranges \?\? \[\]\) !== wantedRanges\) return new Set\(\);/);
  assert.match(source, /if \(mode && meta\.mode !== mode\) return new Set\(\);/);
  assert.match(source, /return new Set\(\[meta\.contents\]\);/);
  // 単体の内容も「全選択」も、進捗キーと同じ並びで突き合わせる。
  assert.match(appSource, /inProgress: resumableContents\.has\(studyContentsKey\(\[content\]\)\)/);
  assert.match(appSource, /inProgress: resumableContents\.has\(studyContentsKey\(\[\.\.\.ENGLISH_CONTENT_TYPES\]\)\)/);
  assert.match(stylesSource, /\.content-choice\.is-in-progress,/);
});

test("周回を終えたセットでも、最後にやったものならハイライトの基準になる", () => {
  const finished = progressFor({ ranges: ["OriHime"], mode: "en_to_ja_flashcard" });
  const halfway = progressFor({ ranges: ["Mars"], mode: "en_to_ja_choice" });
  // Mars は途中のまま、そのあとに OriHime を1周やり切った。
  const progressMap = {
    [halfway.key]: applyStudyAnswer(halfway.progress, { itemId: "a", correct: false, now: 100 }),
    [finished.key]: applyStudyAnswer(
      applyStudyAnswer(finished.progress, { itemId: "a", correct: true, now: 200 }),
      { itemId: "b", correct: true, now: 300 },
    ),
  };
  assert.equal(isStudyInProgress(progressMap[finished.key]), false);

  // 学習途中だけを見ると Mars しか出てこない。
  const inProgress = inProgressStudyEntries(progressMap, { subject: "english" });
  assert.deepEqual(inProgress.map(({ meta }) => meta.ranges), [["Mars"]]);

  // 最後にやった順なら、やり切った OriHime が先頭に来る。
  const recent = studyEntriesByRecency(progressMap, { subject: "english" });
  assert.deepEqual(recent[0].meta.ranges, ["OriHime"]);
  assert.equal(recent.length, 2);
});
