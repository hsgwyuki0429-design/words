import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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

test("result screen keeps counts but removes percentage-like metrics", () => {
  const resultSource = functionSource("renderSessionComplete", "renderAnalysis");
  assert.doesNotMatch(resultSource, /rangeSummary\.accuracy|twoCorrectStreakRate|formatPercent/);
  assert.match(resultSource, /result-score/);
  assert.match(resultSource, /rangeSummary\.correct\} \/ \$\{rangeSummary\.total/);
  assert.match(stylesSource, /\.result-stat-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3/);
  assert.match(stylesSource, /\.result-section-heading,[\s\S]*?\.result-breakdown-row\s*\{[\s\S]*?grid-template-columns:\s*1fr auto/);
});
