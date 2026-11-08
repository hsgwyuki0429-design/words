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
  // 範囲ボタンは、いちばん最近学習した演習の組の範囲だけが光る（演習は1範囲ずつ）。
  assert.match(appSource, /const resumableRanges = rangesInProgress\(\);/);
  assert.match(appSource, /class="range-choice\$\{resumableRanges\.has\(range\) \? " is-in-progress" : ""\}/);
  assert.match(
    functionSource("rangesInProgress", "studyBadgeMarkup"),
    /return new Set\(latestStudyEntry\(\)\?\.meta\.ranges \?\? \[\]\);/,
  );
  // 基準はいちばん最近学習した演習の組。以前の作りの複数範囲・複数重要度の周回は除く。
  assert.match(functionSource("latestStudyEntry", "rangesInProgress"), /recentStudyEntries\(\)\[0\]/);
  assert.match(functionSource("recentStudyEntries", "latestStudyEntry"), /\.filter\(\(\{ meta \}\) => isPracticeMeta\(meta\)\)/);
  assert.match(functionSource("isPracticeMeta", "recentStudyEntries"), /\(meta\.ranges \?\? \[\]\)\.length !== 1 \|\| \(meta\.importance \?\? \[\]\)\.length !== 1/);
  // 形式カードは、いま選んでいる範囲・形式が最後の組のときだけ光る。
  const cardSource = functionSource("modeProgressCard", "renderRangeDetail");
  assert.match(cardSource, /const resumable = Boolean\(entry\) && entry\.key === latestStudyEntry\(\)\?\.key;/);
  assert.match(cardSource, /class="mode-progress-card meter-card\$\{resumable \? " is-in-progress" : ""\}"/);
  assert.match(stylesSource, /\.mode-progress-card\.is-in-progress[,\s][^{]*\{[^}]*border-color: var\(--red\)/);
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

test("学習の準備でも、いま選んでいる条件が最後のセットならハイライトする", () => {
  const source = functionSource("renderSetupProgress", "sortGroupMarkup");
  // 進捗キーまで一致する（＝そのまま押せば続きになる）ときだけ光らせる。
  assert.match(source, /const isLatest = Boolean\(plan\.stored\) && plan\.key === latestStudyEntry\(\)\?\.key;/);
  assert.match(source, /setup-progress-card meter-card\$\{isLatest \? " is-in-progress" : ""\}/);
  assert.match(source, /\$\{isLatest \? studyBadgeMarkup\(\) : ""\}/);
  assert.match(stylesSource, /\.setup-progress-card\.is-in-progress \{[^}]*border-color: var\(--red\)/);
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

test("セットを丸ごと習得しきったら続きなし、周回が残っていれば続きあり", async () => {
  const { hasStudyContinuation, advanceStudyProgress } = await import("../src/logic.js");
  const { progress } = progressFor({ ranges: ["OriHime"] });
  // 始めたばかりのセットは続きなし。
  assert.equal(hasStudyContinuation(progress), false);

  // 1問だけ解いた途中の状態は続きあり。
  const started = applyStudyAnswer(progress, { itemId: "a", correct: true });
  assert.equal(hasStudyContinuation(started), true);

  // 間違えてから正解した語句は習得にならないので、次の周回が残って続きあり。
  const missed = ["a", "b"].reduce(
    (acc, itemId) => applyStudyAnswer(
      applyStudyAnswer(acc, { itemId, correct: false }),
      { itemId, correct: true },
    ),
    progress,
  );
  const nextCycle = advanceStudyProgress(missed);
  assert.equal(nextCycle.cycleNumber, 2);
  assert.equal(hasStudyContinuation(nextCycle), true);

  // 全問習得して新しいセットに進んだら続きなし。
  const cleared = applyStudyAnswer(started, { itemId: "b", correct: true });
  const nextRound = advanceStudyProgress(cleared);
  assert.equal(nextRound.masteryRound, 2);
  assert.equal(hasStudyContinuation(nextRound), false);
});
