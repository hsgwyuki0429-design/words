import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { summarizeReviewItems, visibleReviewItems } from "../src/logic.js";

const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

function functionSource(name, nextName) {
  const start = appSource.indexOf(`function ${name}`);
  const end = appSource.indexOf(`function ${nextName}`, start + 1);
  assert.ok(start >= 0, `${name} should exist`);
  assert.ok(end > start, `${nextName} should follow ${name}`);
  return appSource.slice(start, end);
}

test("previous-study resume UI and active snapshot behavior are removed", () => {
  assert.doesNotMatch(appSource, /activeStudy|lastSessionConfig|studyProgress:|data-resume-active|前回の学習|途中から再開/);
  assert.doesNotMatch(indexSource, /resume-study-card/);
  assert.doesNotMatch(stylesSource, /\.resume-study-card|\.home-resume-top/);
  assert.match(appSource, /state\.recentStudies = normalizeRecentStudies/);
  assert.match(appSource, /recent-study-action">この条件で始める/);
});

test("range and English content selections start with all items selected", () => {
  const resetSource = functionSource("resetStudyFlow", "selectSubject");
  assert.match(resetSource, /const ranges = \[\.\.\.currentRangeOrder\(\)\]/);
  assert.match(resetSource, /contents: selectAllEnglishContents \? \[\.\.\.ENGLISH_CONTENT_TYPES\] : \[\]/);
  assert.match(resetSource, /state\.filters\.ranges = ranges/);
  assert.match(resetSource, /state\.rangeSelectionMode = "all"/);
  assert.match(resetSource, /state\.contentSelectionMode = selectAllEnglishContents \? "all" : null/);
});

test("an individual selection replaces the initial select-all state", () => {
  assert.doesNotMatch(appSource, /disabled-by-all/);
  assert.match(appSource, /const current = state\.contentSelectionMode === "all"\s*\? \[\]/);
  assert.match(appSource, /const contents = state\.contentSelectionMode === "all"\s*\? \[content\]/);
  assert.match(appSource, /const wasAllSelected = state\.rangeSelectionMode === "all"/);
  assert.match(appSource, /state\.filters\.ranges = wasAllSelected\s*\? \[range\]/);
});

test("study sorting exposes workbook difficulty order", () => {
  assert.match(appSource, /"difficulty-level-desc": "難易度順"/);
  assert.match(appSource, /key: "difficulty-level-desc"[\s\S]*?title: "難易度順"[\s\S]*?F → A/);
});

test("result screen shows only the three requested session records", () => {
  const resultSource = functionSource("renderSessionComplete", "renderAnalysis");
  assert.match(resultSource, /isSelfGraded \? "習得" : "正解"/);
  assert.match(resultSource, /isSelfGraded \? "復習へ" : "間違い"/);
  assert.match(resultSource, /<span>学習時間<\/span><strong>\$\{formatSeconds\(summary\.durationMs\)\}/);
  assert.match(stylesSource, /\.result-record-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3/);
  assert.doesNotMatch(resultSource, /accuracy|正答率|円グラフ|ランク|SSS判定|result-score/);
  assert.doesNotMatch(stylesSource, /\.result-score|\.result-stat-grid|\.result-breakdown/);
});

test("result screen presents exactly one primary next action", () => {
  const resultSource = functionSource("renderSessionComplete", "renderAnalysis");
  assert.match(resultSource, /heading: "間違えた問題を固めよう"/);
  assert.match(resultSource, /label: `間違えた\$\{reviewItems\.length\}問をもう一度`/);
  assert.match(resultSource, /attribute: "data-retry-wrong"/);
  assert.match(resultSource, /heading: "今回の範囲は完了"/);
  assert.match(resultSource, /label: "同じ条件でもう一周"/);
  assert.match(resultSource, /attribute: "data-repeat-session"/);
  assert.equal((resultSource.match(/class="primary-button/g) ?? []).length, 1);
  assert.match(functionSource("retryWrongItems", "repeatCompletedSession"), /summarizeReviewItems[\s\S]*?beginSession/);
  assert.match(functionSource("repeatCompletedSession", "distributeSlotText"), /initialQueue[\s\S]*?beginSession/);
});

test("review items are deduplicated, counted, and limited to five initially", () => {
  const item = (id) => ({ id, range: "OriHime", acceptedAnswers: [`answer-${id}`] });
  const results = [
    { itemId: "a", item: item("a"), correct: false, answer: "first" },
    { itemId: "a", item: item("a"), correct: false, answer: "second" },
    ...["b", "c", "d", "e", "f"].map((id) => ({ itemId: id, item: item(id), correct: false })),
    { itemId: "mastered", item: item("mastered"), correct: true },
  ];
  const deduplicated = summarizeReviewItems(results);
  assert.equal(deduplicated.length, 6);
  assert.equal(deduplicated.find((entry) => entry.itemId === "a").wrongCount, 2);
  assert.equal(deduplicated.find((entry) => entry.itemId === "a").answer, "second");
  assert.deepEqual(visibleReviewItems(results), {
    items: deduplicated.slice(0, 5),
    total: 6,
    hasMore: true,
  });
  assert.equal(visibleReviewItems(results, true).items.length, 6);
});

test("review section is conditional and safely escapes user answers", () => {
  const resultSource = functionSource("renderSessionComplete", "renderAnalysis");
  assert.match(resultSource, /\$\{reviewItems\.length \? `<section class="result-review-section"/);
  assert.match(resultSource, /reviewItems\.length > 5 && !session\.showAllReviewItems/);
  assert.match(resultSource, /escapeHtml\(reviewUserAnswer\(result\)\)/);
  assert.match(resultSource, /result\.wrongCount > 1[\s\S]*?\$\{result\.wrongCount\}回/);
  assert.equal(summarizeReviewItems([{ itemId: "a", correct: true }]).length, 0);
});

test("result navigation keeps actions visually distinct and routes correctly", () => {
  const resultSource = functionSource("renderSessionComplete", "renderAnalysis");
  assert.match(resultSource, /class="secondary-button"[^>]*data-change-study>学習条件を変える/);
  assert.match(resultSource, /class="text-button"[^>]*data-result-home>ホームへ戻る/);
  assert.match(resultSource, /class="text-button"[^>]*data-view-analysis>詳しい分析を見る/);
  assert.match(appSource, /data-change-study[\s\S]*?setView\("study-range-select"\)/);
  assert.match(appSource, /data-view-analysis[\s\S]*?setView\("analysis"\)/);
  assert.match(appSource, /data-result-home[\s\S]*?setView\("home"\)/);
  assert.match(stylesSource, /\.result-shell\s*\{[\s\S]*?width:\s*min\(100%, 720px\)/);
  assert.match(stylesSource, /\.result-shell\s*\{[\s\S]*?var\(--safe-bottom\)/);
});
