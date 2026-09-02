import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ENGLISH_STUDY_MODES,
  MASTERY_RULE,
  answeredCountForMode,
  dashboardStudyCards,
  hasAnsweredMode,
  isMasteredForMode,
  mergeAttempt,
  progressForRangeAndMode,
  studyConfigForTarget,
  studyTargetsForDashboard,
  summarizeRangeModeProgress,
  summarizeRangeModes,
} from "../src/logic.js";

const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const logicSource = readFileSync(new URL("../src/logic.js", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const items = JSON.parse(readFileSync(new URL("../data/items.json", import.meta.url), "utf8"));

function functionSource(name, nextName) {
  const start = appSource.indexOf(`function ${name}`);
  const end = appSource.indexOf(`function ${nextName}`, start + 1);
  assert.ok(start >= 0, `${name} should exist`);
  assert.ok(end > start, `${nextName} should follow ${name}`);
  return appSource.slice(start, end);
}

const ALL_ENGLISH_MODES = [
  "en_to_ja_choice",
  "ja_to_en_choice",
  "ja_to_en_input",
];

function makeItem(id, { range = "Plastic", type = "word", modes = ALL_ENGLISH_MODES } = {}) {
  return {
    id,
    english: id,
    japanese: `${id}の意味`,
    type,
    importance: "B",
    difficulty: "C",
    range,
    tags: [],
    acceptedAnswers: [id],
    questionModes: [...modes],
  };
}

function historyFrom(attempts) {
  const history = new Map();
  for (const [itemId, mode, correct = true] of attempts) {
    history.set(itemId, mergeAttempt(history.get(itemId), { itemId, mode, correct }));
  }
  return history;
}

test("answered progress is counted per mode, never from totalAttempts", () => {
  const scoped = [makeItem("apple")];
  const history = historyFrom([
    ["apple", "en_to_ja_choice", true],
    ["apple", "en_to_ja_choice", false],
    ["apple", "en_to_ja_choice", true],
  ]);
  const record = history.get("apple");
  assert.equal(record.totalAttempts, 3);
  assert.equal(hasAnsweredMode(record, "en_to_ja_choice"), true);
  assert.equal(hasAnsweredMode(record, "ja_to_en_input"), false);

  const choice = summarizeRangeModeProgress({
    items: scoped,
    history,
    ranges: ["Plastic"],
    mode: "en_to_ja_choice",
  });
  const input = summarizeRangeModeProgress({
    items: scoped,
    history,
    ranges: ["Plastic"],
    mode: "ja_to_en_input",
  });
  assert.equal(choice.answeredItems, 1);
  assert.equal(choice.answeredRate, 1);
  assert.equal(input.answeredItems, 0);
  assert.equal(input.answeredRate, 0);
  assert.equal(input.totalItems, 1);
});

test("the gauge denominator is the number of study items in the range", () => {
  const scoped = Array.from({ length: 100 }, (_, index) => makeItem(`item-${index}`));
  const history = historyFrom(
    Array.from({ length: 20 }, (_, index) => [`item-${index}`, "ja_to_en_input", true]),
  );
  const progress = progressForRangeAndMode(scoped, history, "Plastic", "ja_to_en_input");
  assert.equal(progress.range, "Plastic");
  assert.equal(progress.totalItems, 100);
  assert.equal(progress.answeredItems, 20);
  assert.equal(progress.answeredRate, 0.2);
  assert.equal(answeredCountForMode(scoped, history, "ja_to_en_input", { ranges: ["Plastic"] }), 20);
});

test("items that cannot be asked in a mode are excluded from the denominator", () => {
  const scoped = [
    ...Array.from({ length: 60 }, (_, index) => makeItem(`full-${index}`)),
    ...Array.from({ length: 40 }, (_, index) =>
      makeItem(`choice-only-${index}`, { modes: ["en_to_ja_choice"] })),
  ];
  const history = historyFrom([]);
  const input = progressForRangeAndMode(scoped, history, "Plastic", "ja_to_en_input");
  const enToJaChoice = progressForRangeAndMode(scoped, history, "Plastic", "en_to_ja_choice");
  // フラッシュカードは4択と同じ出題可否に従う
  const enToJaFlashcard = progressForRangeAndMode(scoped, history, "Plastic", "en_to_ja_flashcard");
  const jaToEnFlashcard = progressForRangeAndMode(scoped, history, "Plastic", "ja_to_en_flashcard");
  assert.equal(input.totalItems, 60);
  assert.equal(enToJaChoice.totalItems, 100);
  assert.equal(enToJaFlashcard.totalItems, 100);
  assert.equal(jaToEnFlashcard.totalItems, 60);

  // 出題できない項目を含めたままだと 100% に到達できないゲージになってしまう
  const answered = historyFrom(
    Array.from({ length: 60 }, (_, index) => [`full-${index}`, "ja_to_en_input", true]),
  );
  assert.equal(progressForRangeAndMode(scoped, answered, "Plastic", "ja_to_en_input").answeredRate, 1);
});

test("range detail exposes exactly the five current English study formats", () => {
  assert.deepEqual(ENGLISH_STUDY_MODES, [
    "en_to_ja_choice",
    "en_to_ja_flashcard",
    "ja_to_en_choice",
    "ja_to_en_flashcard",
    "ja_to_en_input",
  ]);
  const groups = studyTargetsForDashboard({ subject: "english" });
  // 出題方向でグループ分けはするが、画面はこれ以上増やさない
  assert.deepEqual(groups.map((group) => group.label), ["英語 → 日本語", "日本語 → 英語"]);
  assert.deepEqual(
    dashboardStudyCards({ subject: "english" }).map((card) => card.mode),
    ENGLISH_STUDY_MODES,
  );
  assert.deepEqual(
    summarizeRangeModes({ items, history: new Map(), ranges: ["Plastic"] }).map((stat) => stat.mode),
    ENGLISH_STUDY_MODES,
  );
  const detailSource = functionSource("renderRangeDetail", "detailSortOptions");
  assert.match(detailSource, /dashboardTargetGroups\(\)/);
  assert.match(detailSource, /modeProgressCard\(card, unit\)/);
});

test("the retired spelling_input format is not revived in the new flow", () => {
  assert.ok(!ENGLISH_STUDY_MODES.includes("spelling_input"));
  assert.ok(!dashboardStudyCards({ subject: "english" }).some((card) => card.mode === "spelling_input"));
  assert.doesNotMatch(functionSource("dashboardTargetGroups", "showToast"), /spelling_input/);
  assert.doesNotMatch(indexSource, /spelling_input/);
  assert.match(
    logicSource,
    /export const ENGLISH_STUDY_MODES = \[\s*"en_to_ja_choice",\s*"en_to_ja_flashcard",\s*"ja_to_en_choice",\s*"ja_to_en_flashcard",\s*"ja_to_en_input",\s*\]/,
  );
});

test("the range list shows range names only, with no rates or scores", () => {
  const dashboardSource = functionSource("renderDashboard", "modeProgressCard");
  assert.match(dashboardSource, /data-dashboard-range="\$\{escapeHtml\(range\)\}"/);
  assert.match(dashboardSource, /range-choice-name">\$\{escapeHtml\(range\)\}/);
  assert.doesNotMatch(dashboardSource, /formatPercent|answeredRate|masteredRate|accuracy|mastery/);
  assert.doesNotMatch(dashboardSource, /正答率|習得率|回答率|習得|ミス|学習中|あと少し|%/);
  assert.match(indexSource, /id="dashboard-range-list"/);
});

test("format cards state what each number means", () => {
  const cardSource = functionSource("modeProgressCard", "renderRangeDetail");
  assert.match(cardSource, /解答済み \$\{answeredPercent\}%（\$\{progress\.answeredItems\} \/ \$\{progress\.totalItems\}\$\{unit\}）/);
  assert.match(cardSource, /習得 \$\{masteredPercent\}%（\$\{progress\.masteredItems\} \/ \$\{progress\.totalItems\}\$\{unit\}）/);
  // 集計そのものは logic.js の純粋関数に任せる
  assert.match(cardSource, /summarizeRangeModeProgress\(\{/);
  assert.doesNotMatch(cardSource, /modeStats/);
});

test("tapping a format card settles range and format in one step", () => {
  const card = dashboardStudyCards({ subject: "english" })
    .find((entry) => entry.mode === "ja_to_en_input");
  const config = studyConfigForTarget({
    target: card,
    ranges: ["Plastic"],
    filters: { importance: [], performance: "all", minimumWrong: 0 },
    sortKey: "importance-desc",
  });
  assert.deepEqual(config.filters.ranges, ["Plastic"]);
  assert.equal(config.selection.method, "ja_to_en_input");
  assert.equal(config.selection.subject, "english");
  assert.equal(config.selection.direction, "ja_to_en");
  assert.deepEqual(config.selection.contents, ["word", "phrase", "structure"]);
  assert.equal(config.count, "all");

  const startSource = functionSource("startStudyFromTarget", "showToast");
  assert.match(startSource, /studyConfigForTarget\(\{/);
  assert.match(startSource, /startSession\(config\)/);
  // 範囲・出題方向・形式を聞き直すステップへ戻らないこと
  assert.doesNotMatch(startSource, /setView\("study-(range-select|content|method|scope)"\)/);
  assert.match(appSource, /if \(target\.dataset\.studyTarget\) startStudyFromTarget\(target\.dataset\.studyTarget\)/);
});

test("a dedicated multi-range entry reuses the existing multi-select flow", () => {
  assert.match(indexSource, /data-dashboard-multi-range/);
  assert.match(indexSource, /複数の範囲を選ぶ/);
  assert.match(appSource, /data-dashboard-multi-range"\)\) \{[\s\S]*?setView\("study-range-select"\)/);
  assert.match(
    appSource,
    /confirm-study-ranges[\s\S]*?setView\(state\.rangeFlow === "dashboard" \? "range-detail" : "study-content"\)/,
  );
  // 既存の複数選択ロジックを壊していないこと
  assert.match(indexSource, /id="study-range-options"/);
  assert.match(appSource, /data-study-range-all/);
  assert.match(appSource, /target\.dataset\.studyRange/);
  assert.match(appSource, /state\.filters\.ranges = wasAllSelected/);
});

test("mastery stays an undecided, swappable layer", () => {
  assert.equal(MASTERY_RULE.decided, false);
  const record = historyFrom([
    ["apple", "ja_to_en_input", true],
    ["apple", "ja_to_en_input", true],
  ]).get("apple");
  assert.equal(isMasteredForMode(record, "ja_to_en_input"), null);
  const progress = progressForRangeAndMode([makeItem("apple")], historyFrom([]), "Plastic", "ja_to_en_input");
  assert.equal(progress.masteryDecided, false);
  assert.equal(progress.masteredItems, null);
  assert.equal(progress.masteredRate, null);
  // UI と CSS は習得レイヤーを受け入れる形だけ用意しておく
  assert.match(appSource, /mode-progress-mastered\$\{progress\.masteryDecided \? "" : " is-pending"\}/);
  assert.match(stylesSource, /\.mode-progress-mastered \{[\s\S]*?background: var\(--blue\)/);
  assert.match(logicSource, /export function isMasteredForMode/);
  // 習得条件をダッシュボードの描画・集計へ直接書かないこと
  assert.doesNotMatch(
    functionSource("dashboardTargetGroups", "startStudyFromTarget"),
    /currentCorrectStreak|bestCorrectStreak|lastResult|accuracyFor|連続正解/,
  );
});

test("importance, sorting and answer-status filters survive as secondary controls", () => {
  const advancedSource = functionSource("renderRangeDetailAdvanced", "startStudyFromTarget");
  assert.match(advancedSource, /data-detail-importance/);
  assert.match(advancedSource, /data-detail-performance/);
  assert.match(advancedSource, /data-detail-sort/);
  assert.match(advancedSource, /PERFORMANCE_LABELS/);
  assert.match(advancedSource, /detailSortOptions\(\)/);
  assert.match(indexSource, /id="range-detail-advanced"/);
  // 並び替えの選択肢（重要度・苦手順・ランダム・その他）は削っていない
  assert.match(appSource, /\["random", "ランダム"\]/);
  assert.match(appSource, /difficulty: "苦手順"/);
  assert.match(appSource, /"importance-desc": "重要度順"/);
  // 従来のステップ形式も残す
  assert.match(indexSource, /id="view-study-sort-kind"/);
  assert.match(indexSource, /id="view-study-performance"/);
  assert.match(appSource, /data-open-step-flow"\)\) \{[\s\S]*?setView\("study-content"\)/);
});

test("recall subjects share the same dashboard shape", () => {
  const publicGroups = studyTargetsForDashboard({ subject: "public", contents: ["term"] });
  assert.equal(publicGroups.length, 1);
  assert.deepEqual(publicGroups[0].cards.map((card) => card.mode), ["public_recall"]);
  assert.deepEqual(publicGroups[0].cards.map((card) => card.types), [["public-term"]]);
  const healthGroups = studyTargetsForDashboard({ subject: "health", contents: ["term", "short"] });
  assert.deepEqual(
    healthGroups[0].cards.map((card) => card.key),
    ["health:term", "health:short", "health:all"],
  );
  assert.equal(healthGroups[0].cards.at(-1).selection.content, "all");
});

test("real workbook data fills every format gauge for a range", () => {
  const plasticItems = items.filter((item) => item.range === "Plastic");
  const progress = summarizeRangeModes({ items, history: new Map(), ranges: ["Plastic"] });
  progress.forEach((stat) => {
    assert.equal(stat.totalItems, plasticItems.length);
    assert.equal(stat.answeredItems, 0);
    assert.equal(stat.answeredRate, 0);
  });
  const history = historyFrom(
    plasticItems.slice(0, 10).map((item) => [item.id, "ja_to_en_input", true]),
  );
  const input = progressForRangeAndMode(items, history, "Plastic", "ja_to_en_input");
  assert.equal(input.answeredItems, 10);
  assert.equal(input.answeredRate, 10 / plasticItems.length);
  assert.equal(progressForRangeAndMode(items, history, "Plastic", "en_to_ja_choice").answeredItems, 0);
});

test("the dashboard is the entry point and the place a session ends", () => {
  assert.match(indexSource, /id="view-dashboard" data-view="dashboard"/);
  assert.match(indexSource, /id="view-range-detail" data-view="range-detail"/);
  assert.doesNotMatch(indexSource, /id="view-home"/);
  assert.match(appSource, /if \(view === "home"\) view = "dashboard"/);
  assert.match(appSource, /if \(view === "dashboard"\) renderDashboard\(\)/);
  assert.match(appSource, /if \(view === "range-detail"\) renderRangeDetail\(\)/);
  assert.match(functionSource("selectSubject", "selectionIsComplete"), /setView\("dashboard"\)/);
  // 44px 以上のタップ領域と safe-area を保つ
  assert.match(stylesSource, /\.range-choice \{[\s\S]*?min-height: 66px/);
  assert.match(stylesSource, /\.mode-progress-card \{[\s\S]*?min-height: 44px/);
  assert.match(stylesSource, /\.advanced-chip \{[\s\S]*?min-height: 44px/);
});
