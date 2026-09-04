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

test("学習を始める画面の履歴は廃止され、続きは周回の状態から始める", () => {
  assert.doesNotMatch(appSource, /activeStudy|lastSessionConfig|data-resume-active|前回の学習/);
  assert.doesNotMatch(indexSource, /resume-study-card|recent-study/);
  assert.doesNotMatch(stylesSource, /\.resume-study-card|\.home-resume-top|\.recent-study/);
  // 履歴の一覧は持たず、周回ごとの学習条件だけを控える。
  // 旧データは起動時に引き継ぐだけで、画面には出さない。
  assert.doesNotMatch(appSource, /state\.recentStudies|addRecentStudy|renderRecentStudies/);
  assert.match(appSource, /adoptLegacyStudyConfigs\(legacyRecentStudies\)/);
  assert.match(appSource, /persistStudyConfig\(key, \{ \.\.\.config, selection \}\)/);
  assert.match(appSource, /pendingCycleItemIds\(progress\)/);
});

test("学習途中のセットは分析画面から続きを始められる", () => {
  // 完走直後は今回の結果、それ以外は途中のセットを優先する。
  assert.match(appSource, /const resume = state\.session\?\.complete \? null : resumableStudy\(\);/);
  // 続きのカードの下に、学習直後や保存済みの結果を続けて見せる。
  assert.match(appSource, /resume \? resumeStudyMarkup\(resume\) : ""/);
  assert.match(appSource, /completed \? sessionResultMarkup\(completed\) : ""/);
  // 条件の控えが残っているものだけを続きの対象にする。
  assert.match(
    functionSource("resumableStudy", "resumeStudyMarkup"),
    /const config = entry \? state\.studyConfigs\[entry\.key\] : null;/,
  );
  assert.match(appSource, /data-resume-study>続きを始める/);
  assert.match(appSource, /data-resume-study"\)\) \{[\s\S]*?startSession\(resume\.config\)/);
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
  assert.match(appSource, /key: "difficulty-level-desc", title: "難易度順"/);
});

test("result screen shows only the three requested session records", () => {
  const resultSource = functionSource("sessionResultMarkup", "renderSessionComplete");
  assert.match(resultSource, /isSelfGraded \? "習得" : "正解"/);
  assert.match(resultSource, /isSelfGraded \? "復習へ" : "間違い"/);
  assert.match(resultSource, /<span>学習時間<\/span><strong>\$\{formatSeconds\(summary\.durationMs\)\}/);
  assert.match(stylesSource, /\.result-record-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3/);
  assert.doesNotMatch(resultSource, /accuracy|正答率|円グラフ|ランク|SSS判定|result-score/);
  assert.doesNotMatch(stylesSource, /\.result-score|\.result-stat-grid|\.result-breakdown/);
});

test("result screen presents exactly one primary next action", () => {
  const resultSource = functionSource("sessionResultMarkup", "renderSessionComplete");
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
  const resultSource = functionSource("sessionResultMarkup", "renderSessionComplete");
  assert.match(resultSource, /\$\{reviewItems\.length \? `<section class="result-review-section"/);
  assert.match(resultSource, /reviewItems\.length > 5 && !session\.showAllReviewItems/);
  assert.match(resultSource, /escapeHtml\(reviewUserAnswer\(result\)\)/);
  assert.match(resultSource, /result\.wrongCount > 1[\s\S]*?\$\{result\.wrongCount\}回/);
  assert.equal(summarizeReviewItems([{ itemId: "a", correct: true }]).length, 0);
});

test("result navigation keeps actions visually distinct and routes correctly", () => {
  const resultSource = functionSource("sessionResultMarkup", "renderSessionComplete");
  assert.match(resultSource, /class="secondary-button"[^>]*data-change-study>学習条件を変える/);
  assert.match(resultSource, /class="text-button"[^>]*data-dismiss-result>結果を閉じる/);
  assert.doesNotMatch(resultSource, /data-view-analysis/);
  assert.match(appSource, /data-change-study[\s\S]*?setView\("study-range-select"\)/);
  assert.match(appSource, /data-dismiss-result[\s\S]*?clearSessionResult\(\)[\s\S]*?setView\("dashboard"\)/);
  assert.match(stylesSource, /\.result-panel\s*\{[\s\S]*?width:\s*min\(100%, 720px\)/);
  assert.match(stylesSource, /\.main-content\s*\{[\s\S]*?var\(--safe-bottom\)/);
});

test("finishing a session opens the analysis view with the result on top", () => {
  const completeSource = functionSource("renderSessionComplete", "renderAnalysis");
  assert.match(completeSource, /session\.complete = true;\s*\n\s*setView\("analysis"\)/);
  assert.match(appSource, /completed \? sessionResultMarkup\(completed\) : ""/);
  assert.match(indexSource, /<div class="dashboard-result" id="analysis-result" hidden><\/div>/);
  // ダッシュボードには結果を出さない。
  assert.doesNotMatch(appSource, /dashboardResult/);
  assert.doesNotMatch(indexSource, /id="dashboard-result"/);
  assert.doesNotMatch(appSource, /elements\.quizContent\.innerHTML = `\s*<div class="result/);
});

test("the finished session result is stored and restored for the analysis view", () => {
  assert.match(appSource, /const LAST_RESULT_META_KEY = "lastSessionResult"/);
  assert.match(appSource, /persistSessionResult\(session\);\s*\n\s*renderSessionComplete\(\)/);
  assert.match(appSource, /setMeta\(LAST_RESULT_META_KEY, state\.lastSessionResult\)/);
  assert.match(appSource, /getMeta\("lastSessionResult", null\)/);
  assert.match(appSource, /state\.lastSessionResult = normalizeSessionResultSnapshot\(lastSessionResult\)/);
  // 教科に関係なく、いちばん新しい結果を分析画面に出す。
  assert.match(
    functionSource("resultSession", "canStartFromResult"),
    /return state\.session\?\.complete \? state\.session : state\.lastSessionResult;/,
  );
  // ただし別の教科の結果からは学習を始めさせない。
  assert.match(
    functionSource("canStartFromResult", "sessionResultMarkup"),
    /\(session\.subject \?\? "english"\) === \(state\.subject \?\? "english"\)/,
  );
});

test("学習中に画面を離れるときは、どの入口でも終了処理と保存を通す", () => {
  const leaveSource = functionSource("leaveQuiz", "showToast");
  assert.match(leaveSource, /window\.confirm\("この学習を終了しますか？"\)/);
  assert.match(leaveSource, /clearTimeout\(session\.reviewTimer\)/);
  assert.match(leaveSource, /stashStudyProgress\(\)/);
  // 左上のマークなどビュー移動でも、×と同じ経路を通る。
  assert.match(appSource, /if \(state\.view === "quiz" && !leaveQuiz\(\)\) return;/);
  assert.match(appSource, /data-quit-quiz[\s\S]*?if \(leaveQuiz\(\)\) setView\("home"\)/);
  // タブを閉じるときも周回を控えへ逃がす。
  assert.match(appSource, /addEventListener\("pagehide", stashStudyProgress\)/);
});

test("周回の保存は履歴の保存を待たずに先に行う", () => {
  const submitSource = appSource.slice(
    appSource.indexOf("async function submitAnswer"),
    appSource.indexOf("function undoButtonMarkup"),
  );
  const progressAt = submitSource.indexOf("persistStudyProgress(session.progressKey, session.progress)");
  const recordAt = submitSource.indexOf("await recordAttempt(");
  assert.ok(progressAt >= 0 && recordAt >= 0);
  assert.ok(progressAt < recordAt, "周回の保存が履歴の保存より先であること");
});

test("分析画面は学習の記録だけを見せ、統計の一覧は持たない", () => {
  assert.doesNotMatch(appSource, /summarizeByRange|summarizeByMode|analysisContent/);
  assert.doesNotMatch(indexSource, /id="analysis-content"|学習分析/);
  // 記録も学習途中のセットも無いときは、学習への入口を案内する。
  assert.match(
    functionSource("emptyResultMarkup", "retryWrongItems"),
    /まだ学習の記録がありません[\s\S]*?data-view-target="dashboard"/,
  );
  assert.match(appSource, /: emptyResultMarkup\(\);/);
});

test("単語帳の絞り込みと並び替えは廃止され、検索だけが残る", () => {
  assert.doesNotMatch(indexSource, /list-open-filter|id="list-sort"|filter-sheet|filter-backdrop/);
  assert.doesNotMatch(appSource, /openFilter|closeFilter|collectFilterForm|listSortKey/);
  assert.doesNotMatch(stylesSource, /\.filter-sheet|\.filter-chip|\.sheet-backdrop/);
  assert.match(indexSource, /id="list-search"/);
  // 並びは重要度順に固定し、検索だけで絞る。
  assert.match(appSource, /const LIST_SORT_KEY = "importance-desc";/);
  assert.match(appSource, /filteredItems\(\{ \.\.\.emptyFilters\(\), search \}\)/);
});

test("「条件を細かく選んで学習する」の入口は廃止される", () => {
  assert.doesNotMatch(indexSource, /data-start-study|条件学習|条件を細かく選んで学習する/);
  assert.doesNotMatch(appSource, /data-start-study|STUDY_FLOW_VIEWS|data-nav-active/);
  // ボトムナビは4つになる。
  assert.match(stylesSource, /\.bottom-nav \{[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  // 範囲をまとめて選ぶ導線と、結果からの「学習条件を変える」は残る。
  assert.match(indexSource, /data-dashboard-multi-range/);
  assert.match(appSource, /data-change-study[\s\S]*?setView\("study-range-select"\)/);
});
