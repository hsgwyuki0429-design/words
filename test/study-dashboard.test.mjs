import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ENGLISH_STUDY_MODES,
  GAUGE_COLOR_COUNT,
  GAUGE_MAX_BARS,
  answeredCountForMode,
  dashboardStudyCards,
  gaugeColorIndex,
  hasAnsweredMode,
  mergeAttempt,
  progressForRangeAndMode,
  studyConfigForTarget,
  studyTargetsForDashboard,
  summarizeProgressGauge,
  summarizeRangeModeProgress,
  summarizeSetRing,
  summarizeRangeModes,
  summarizeCycleMeter,
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

test("範囲詳細には現行の英語5形式だけが並ぶ", () => {
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
  const detailSource = functionSource("renderRangeDetail", "startStudyFromTarget");
  assert.match(detailSource, /dashboardTargetGroups\(\)/);
  assert.match(detailSource, /modeProgressCard\(card\)/);
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
  const dashboardSource = functionSource("renderDashboard", "setRingColor").split("// 円：")[0];
  assert.match(dashboardSource, /data-dashboard-range="\$\{escapeHtml\(range\)\}"/);
  assert.match(dashboardSource, /range-choice-name">\$\{escapeHtml\(range\)\}/);
  assert.doesNotMatch(dashboardSource, /formatPercent|answeredRate|masteredRate|accuracy|mastery/);
  assert.doesNotMatch(dashboardSource, /正答率|習得率|回答率|習得|ミス|学習中|あと少し|%/);
  assert.match(indexSource, /id="dashboard-range-list"/);
});

test("進み具合は、習得を円・今の周回を横棒で、形を分けて見せる", () => {
  // 円：その組（範囲・形式・重要度）の全体のうち何%を習得したか。
  const ringSource = functionSource("setRingMarkup", "ringLegendMarkup");
  assert.match(ringSource, /class="meter-ring" style="--ring-a:\$\{a\}%;--ring-b:\$\{b\}%;--ring-main:\$\{setRingColor\(ring\.round\)\};--ring-second:\$\{secondColor\}"/);
  assert.match(ringSource, /<span class="meter-ring-value">\$\{ring\.masteredPercent\}<small>%<\/small><\/span>/);
  assert.match(ringSource, /<span class="meter-ring-label">\$\{escapeHtml\(ring\.label\)\}<\/span>/);
  // 内訳の色は円と同じ。
  assert.match(functionSource("ringLegendMarkup", "cycleBarMarkup"), /style="--key-color:\$\{color\}"/);
  // 横棒：今の周回があと何問か（近い目標）。「◯セット目」は書かない。
  const barSource = functionSource("cycleBarMarkup", "modeProgressCard");
  assert.match(barSource, /const meter = summarizeCycleMeter\(cycle\);/);
  assert.match(barSource, /`あと<b>\$\{meter\.remainingCount\}<\/b>\$\{unit\}`/);
  assert.match(barSource, /まだ始めていません/);
  assert.match(barSource, /const title = `\$\{prefix \? `\$\{prefix\} · ` : ""\}\$\{meter\.cycleNumber\}周目`;/);
  assert.doesNotMatch(appSource, /セット目・/);
  const meter = summarizeCycleMeter({ cycleNumber: 2, masteryRound: 1, targetCount: 40, remainingCount: 10 });
  assert.deepEqual(
    [meter.started, meter.doneCount, meter.remainingCount, meter.percent, meter.complete],
    [true, 30, 10, 75, false],
  );
  assert.equal(summarizeCycleMeter({ cycleNumber: 1, targetCount: 5, remainingCount: 0 }).complete, true);
  assert.equal(summarizeCycleMeter(null).started, false);
  assert.equal(summarizeCycleMeter({ targetCount: 5, remainingCount: 99 }).percent, 0, "壊れた値でも0〜100%");
  // 形式カードは、その範囲・形式でいちばん最近学習した重要度の組だけを円と横棒で見せる（重要度をまたいでまとめない）。
  const cardSource = functionSource("modeProgressCard", "renderRangeDetail");
  assert.match(cardSource, /const entry = latestPracticeEntryForCard\(card, range\);/);
  assert.match(cardSource, /setRingMarkup\(status\.ring\)/);
  assert.match(cardSource, /cycleBarMarkup\(status\.summary, \{ prefix: importance \? `重要度\$\{importance\}` : "", total: status\.pool\.length \}\)/);
  assert.doesNotMatch(cardSource, /modeStats/);
});

test("学習の準備・続きからにも形式カードと同じ円と横棒を出し、選んだ重要度の組だけを見せる", () => {
  // 学習の準備は上の面に、選んでいる重要度の組の円と周回を1つだけ出す（重要度ごとには付けない）。
  const setupSource = functionSource("renderSetupProgress", "sortGroupMarkup");
  assert.match(setupSource, /setup-progress-card meter-card/);
  assert.match(setupSource, /setRingMarkup\(plan\.ring\)/);
  assert.match(setupSource, /cycleBarMarkup\(plan\.summary, \{ total: plan\.pool\.length \}\)/);
  assert.match(setupSource, /ringLegendMarkup\(plan\.ring\)/);
  // 1つの組（範囲1つ・形式・重要度1つ）ごとに、周回と習得の材料を作る。
  const statusSource = functionSource("practiceStatus", "setupPlan");
  assert.match(statusSource, /summarizeSetRing\(\{ progress: stored, poolIds, answeredIds \}\)/);
  assert.match(functionSource("practiceConfig", "currentSetupConfig"), /ranges: \[range\], importance: importance \? \[importance\] : \[\]/);
  const resumeSource = functionSource("resumeStudyMarkup", "resultSession");
  assert.match(resumeSource, /practiceStatus\(/);
  assert.match(resumeSource, /setRingMarkup\(/);
  assert.match(resumeSource, /cycleBarMarkup\(/);
  // 選ぶ札も 44px 以上
  assert.match(stylesSource, /\.setup-chip \{[^}]*min-height: 54px/);
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

  const startSource = functionSource("startStudyFromTarget", "stashStudyProgress");
  assert.match(startSource, /state\.studySelection = normalizeStudySelection\(target\.selection\);/);
  // 次は学習の準備。範囲・出題方向・形式は聞き直さない。
  assert.match(startSource, /setView\("study-setup"\)/);
  assert.doesNotMatch(startSource, /setView\("study-(range-select|method|scope)"\)/);
  assert.match(appSource, /if \(target\.dataset\.studyTarget\) startStudyFromTarget\(target\.dataset\.studyTarget\)/);
});

test("演習では範囲を1つずつ選び、全範囲・複数の範囲は選ばない", () => {
  assert.doesNotMatch(indexSource, /data-dashboard-multi-range|複数の範囲を選ぶ|study-range-options|confirm-study-ranges/);
  assert.doesNotMatch(appSource, /data-dashboard-all-ranges|data-study-range|renderStudyRangeSelect/);
  // 範囲詳細は範囲が1つのときだけ開く。
  assert.match(appSource, /if \(view === "range-detail" && state\.filters\.ranges\.length !== 1\) view = "dashboard";/);
  assert.match(appSource, /if \(target\.dataset\.dashboardRange\) \{\s*\n\s*state\.filters\.ranges = \[target\.dataset\.dashboardRange\];/);
});

test("the mastery gauge is fed by the current mastery round, not by long-term history", () => {
  const scoped = [makeItem("apple"), makeItem("berry")];
  const history = historyFrom([
    ["apple", "ja_to_en_input", true],
    ["apple", "ja_to_en_input", true],
    ["berry", "ja_to_en_input", true],
  ]);
  const noRound = summarizeRangeModeProgress({
    items: scoped,
    history,
    ranges: ["Plastic"],
    mode: "ja_to_en_input",
  });
  assert.equal(noRound.answeredItems, 2);
  assert.equal(noRound.masteredItems, 0);
  assert.equal(noRound.masteredRate, 0);

  const withRound = summarizeRangeModeProgress({
    items: scoped,
    history,
    ranges: ["Plastic"],
    mode: "ja_to_en_input",
    masteredIds: ["apple"],
  });
  assert.equal(withRound.answeredItems, 2);
  assert.equal(withRound.masteredItems, 1);
  assert.equal(withRound.masteredRate, 0.5);

  // 円の習得は、その組の周回の masteredIds（いまのセット）から数える。
  assert.match(logicSource, /export function summarizeSetRing\(/);
  assert.match(stylesSource, /\.progress-gauge-mastered \{[\s\S]*?background: var\(--gauge-strong\)/);
  // 習得条件をダッシュボードの描画へ直接書かない
  assert.doesNotMatch(
    functionSource("modeProgressCard", "renderRangeDetail"),
    /currentCorrectStreak|firstAttemptResults|連続正解/,
  );
});

test("重要度と並び替えは学習の準備で毎回見直せる", () => {
  const setupSource = functionSource("renderStudySetup", "dashboardTargetGroups");
  assert.match(setupSource, /currentImportanceOrder\(\)\s*\n?\s*\.map\(\(importance\) =>/);
  assert.match(functionSource("sortGroupMarkup", "renderStudySetup"), /primarySortOptions\(\)/);
  // 並び替えの選択肢（重要度・苦手順・ランダム・その他）は削っていない
  assert.match(appSource, /\["random", "ランダム"\]/);
  assert.match(appSource, /difficulty: "苦手順"/);
  assert.match(appSource, /"importance-desc": "重要度順"/);
  // 回答状況を毎回選ばせる画面は通常フローから外す
  assert.doesNotMatch(indexSource, /id="view-study-performance"/);
  assert.doesNotMatch(appSource, /data-study-performance=/);
  // 範囲詳細の「詳細設定」は学習の準備へまとめたので残さない
  assert.doesNotMatch(indexSource, /range-detail-advanced/);
  assert.doesNotMatch(appSource, /data-detail-importance|data-detail-sort/);
});

test("一問一答の教科も同じダッシュボード構造を使う", () => {
  const publicGroups = studyTargetsForDashboard({ subject: "public", contents: ["term"] });
  assert.equal(publicGroups.length, 1);
  // 公共は一問一答と4択の2枚。進み具合も出題方法ごとに分けて数える。
  assert.deepEqual(publicGroups[0].cards.map((card) => card.mode), ["public_recall", "public_choice"]);
  assert.deepEqual(
    publicGroups[0].cards.map((card) => card.key),
    ["public:term:recall", "public:term:choice"],
  );
  assert.deepEqual(
    publicGroups[0].cards.map((card) => card.types),
    [["public-term"], ["public-term"]],
  );
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

test("ダッシュボードが入口であり、学習終了後の戻り先でもある", () => {
  assert.match(indexSource, /id="view-dashboard" data-view="dashboard"/);
  assert.match(indexSource, /id="view-range-detail" data-view="range-detail"/);
  assert.doesNotMatch(indexSource, /id="view-home"/);
  assert.match(appSource, /if \(view === "home"\) view = "dashboard"/);
  assert.match(appSource, /if \(view === "dashboard"\) renderDashboard\(\)/);
  assert.match(appSource, /if \(view === "range-detail"\) renderRangeDetail\(\)/);
  assert.match(functionSource("selectSubject", "studyContentLabel"), /setView\("dashboard"\)/);
  // 44px 以上のタップ領域を保つ
  assert.match(stylesSource, /\.range-choice \{[^}]*min-height: 56px/);
  assert.match(stylesSource, /\.mode-progress-card \{[^}]*min-height: 44px/);
  assert.match(stylesSource, /\.setup-chip \{[^}]*min-height: 54px/);
  // 画面が低い端末向けに詰めるときも 44px は下回らない
  const shortScreen = stylesSource.slice(stylesSource.indexOf("@media (max-height: 720px)"));
  [...shortScreen.matchAll(/min-height: (\d+)px/g)].forEach((match) => {
    assert.ok(Number(match[1]) >= 44, `低い画面でも 44px 以上（${match[1]}px）`);
  });
});

test("範囲一覧と形式カードは1画面に収まる高さで組む", () => {
  // 範囲ボタンは2カラム固定（1カラムに戻すメディアクエリを残さない）
  assert.match(stylesSource, /\.range-choice-list \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  const mobile = stylesSource.slice(stylesSource.indexOf("@media (max-width: 760px)"));
  assert.doesNotMatch(mobile, /\.range-choice-list \{\s*\n\s*grid-template-columns: 1fr/);
  // 形式カードは説明文と「この形式で学習する」を畳んで高さを抑える
  const cardSource = functionSource("modeProgressCard", "renderRangeDetail");
  assert.doesNotMatch(cardSource, /mode-progress-start|card\.detail/);
  assert.match(stylesSource, /\.progress-gauge \{[^}]*height: 12px/);
  assert.match(stylesSource, /\.mode-group \{[^}]*margin-bottom: 10px/);
});

test("選択画面の見出しは戻るボタンとタイトルを1行にまとめる", () => {
  // safe-area のある実機でも縦を使い切らないよう、見出しは1行
  const headings = [...indexSource.matchAll(/class="[^"]*compact-step-heading"/g)];
  assert.equal(headings.length, 2, "範囲詳細・学習の準備の2画面");
  assert.equal((indexSource.match(/class="step-heading-row"/g) ?? []).length, 2);
  assert.match(stylesSource, /\.step-heading-row \{[\s\S]*?display: flex/);
  // 縦積みの戻るリンクは残さず、丸い戻るボタンだけにする
  [...indexSource.matchAll(/compact-step-heading">([\s\S]*?)<\/div>\s*\n\s*<\/div>/g)].forEach((match) => {
    assert.doesNotMatch(match[1], /class="text-button back-link"/);
    assert.match(match[1], /class="icon-button step-back"/);
  });
  assert.match(functionSource("renderRangeDetail", "syncHomeMode"), /rangeDetailCopy\.textContent = "";/);
  // 低い画面向けの調整を用意する
  assert.match(stylesSource, /@media \(max-height: 720px\)/);
});

test("ゲージは重要度と学習内容でも絞り込める", () => {
  const scoped = [
    ...Array.from({ length: 10 }, (_, index) =>
      ({ ...makeItem(`sss-${index}`), importance: "SSS" })),
    ...Array.from({ length: 20 }, (_, index) =>
      ({ ...makeItem(`b-${index}`), importance: "B" })),
    ...Array.from({ length: 5 }, (_, index) =>
      ({ ...makeItem(`phrase-${index}`, { type: "phrase" }), importance: "SSS" })),
  ];
  const history = historyFrom([
    ["sss-0", "ja_to_en_input", true],
    ["sss-1", "ja_to_en_input", true],
    ["b-0", "ja_to_en_input", true],
  ]);
  const base = { items: scoped, history, ranges: ["Plastic"], mode: "ja_to_en_input" };

  // 重要度で絞る
  const sss = summarizeRangeModeProgress({ ...base, importance: ["SSS"] });
  assert.equal(sss.totalItems, 15, "SSS は単語10＋熟語5");
  assert.equal(sss.answeredItems, 2);
  const b = summarizeRangeModeProgress({ ...base, importance: ["B"] });
  assert.equal(b.totalItems, 20);
  assert.equal(b.answeredItems, 1);

  // 学習内容（項目種別）で絞る
  const words = summarizeRangeModeProgress({ ...base, types: ["word"] });
  assert.equal(words.totalItems, 30);
  const phrases = summarizeRangeModeProgress({ ...base, types: ["phrase"] });
  assert.equal(phrases.totalItems, 5);
  assert.equal(phrases.answeredItems, 0);

  // 重要度と学習内容の組み合わせ
  const both = summarizeRangeModeProgress({ ...base, types: ["word"], importance: ["SSS"] });
  assert.equal(both.totalItems, 10);
  assert.equal(both.answeredItems, 2);
  assert.equal(both.answeredRate, 0.2);

  // 習得は習得ラウンドの masteredIds から
  const mastered = summarizeRangeModeProgress({
    ...base,
    types: ["word"],
    importance: ["SSS"],
    masteredIds: ["sss-0", "b-0"],
  });
  assert.equal(mastered.masteredItems, 1, "絞り込みの外の b-0 は数えない");
  assert.equal(mastered.masteredRate, 0.1);

  // 絞り込みなしは従来どおり
  assert.equal(summarizeRangeModeProgress(base).totalItems, 35);
});

test("円はセットごとの色で塗り分け、何%が何セット目の習得かが分かる", () => {
  const ringSource = functionSource("setRingMarkup", "ringLegendMarkup");
  // 2セット目からは、前のセットで習得した分を前のセットの色で塗る。
  assert.match(ringSource, /const secondColor = ring\.round > 1 \? setRingColor\(ring\.round - 1\) : "var\(--set-soft-1\)";/);
  assert.match(functionSource("setRingColor", "setRingMarkup"), /`var\(--set-color-\$\{gaugeColorIndex\(round\)\}\)`/);
  assert.match(stylesSource, /--set-color-1: #2b50ff;/);
  assert.match(stylesSource, /--set-color-2: #d92d20;/);
  assert.match(stylesSource, /\.meter-ring::before \{[\s\S]*?var\(--ring-main, var\(--set-color-1\)\) 0 var\(--ring-a, 0%\)/);
  assert.equal(GAUGE_COLOR_COUNT, 5);
  assert.equal(gaugeColorIndex(1), 1);
  assert.equal(gaugeColorIndex(2), 2);
  assert.equal(gaugeColorIndex(GAUGE_COLOR_COUNT + 1), 1, "色は5セットで一巡する");

  // 1セット目：習得・練習中・未回答。中央は「習得」。
  const first = summarizeSetRing({
    progress: { masteryRound: 1, masteredIds: ["a", "b"] },
    poolIds: ["a", "b", "c", "d", "e"],
    answeredIds: ["a", "b", "c"],
  });
  assert.equal(first.label, "習得");
  assert.deepEqual(first.segments.map((segment) => [segment.kind, segment.count, segment.percent]), [
    ["mastered", 2, 40],
    ["practicing", 1, 20],
    ["untouched", 2, 40],
  ]);
  // 2セット目：今のセットの習得（赤）と、前のセットの習得（青）。中央は「習得2」で「2セット目」とは書かない。
  const second = summarizeSetRing({
    progress: { masteryRound: 2, masteredIds: ["a"] },
    poolIds: ["a", "b", "c", "d"],
  });
  assert.equal(second.label, "習得2");
  assert.equal(second.masteredPercent, 25);
  assert.deepEqual(second.segments.map((segment) => [segment.label, segment.count, segment.percent]), [
    ["習得2", 1, 25],
    ["習得1", 3, 75],
  ]);
  assert.doesNotMatch(appSource, /セット目`/);
  // 範囲外のIDや重複は数えない。
  const messy = summarizeSetRing({ progress: { masteredIds: ["x", "a", "a"] }, poolIds: ["a", "b"], answeredIds: ["a", "zz"] });
  assert.equal(messy.masteredCount, 1);
  assert.equal(messy.segments.reduce((sum, segment) => sum + segment.count, 0), 2);
});

test("周回が進んでもバーは増えず、セットが変わったときだけ積む", () => {
  // 「1周終えただけ」で2本目のバーが出ると、全問題を習得したように見えてしまう。
  // バーを積む単位は周回（未習得の絞り込み）ではなく、全問題を習得しきって
  // 始まる次のセット（習得ラウンド）。
  // （古文の形式カードのバー）
  // 1セット目のうちは、何周目でもバーは1本のまま伸びる
  const firstRound = summarizeProgressGauge({ totalItems: 10, answeredItems: 10, masteredItems: 9 }, 1);
  assert.equal(firstRound.finishedBars.length, 0, "満了したバーはまだ出ない");
  assert.equal(firstRound.masteredWidth, 90);
  // 全問題を習得して2セット目に入ると、満了した1本目が残る
  const secondRound = summarizeProgressGauge({ totalItems: 10, answeredItems: 10, masteredItems: 0 }, 2);
  assert.equal(secondRound.finishedBars.length, 1);
  assert.equal(secondRound.masteredWidth, 0, "新しいセットは0%から始まる");
});

test("セットをいくら重ねてもバーは増え続けない", () => {
  // 積み上げ続けるとカードが伸びて1画面に収まらなくなるので、
  // 古いセットは畳んでいちばん古い1本にまとめる。
  for (const roundNumber of [1, 2, 3, 4, 12, 137, 9999]) {
    const gauge = summarizeProgressGauge({ totalItems: 8, answeredItems: 4, masteredItems: 2 }, roundNumber);
    assert.ok(
      gauge.finishedBars.length <= GAUGE_MAX_BARS - 1,
      `${roundNumber}セット目でもバーは${GAUGE_MAX_BARS}本以内（${gauge.finishedBars.length + 1}本）`,
    );
    assert.equal(gauge.roundNumber, roundNumber, "セット番号そのものは丸めない");
  }
  // 2セット目以降はバーの本数が変わらない＝カードの高さが増えない
  const second = summarizeProgressGauge({ totalItems: 8, answeredItems: 4, masteredItems: 2 }, 2);
  const many = summarizeProgressGauge({ totalItems: 8, answeredItems: 4, masteredItems: 2 }, 400);
  assert.equal(many.finishedBars.length, second.finishedBars.length);
  assert.equal(many.collapsedRounds, 398);
  assert.deepEqual(many.finishedBars.map((bar) => bar.roundNumber), [399]);
  assert.equal(many.finishedBars[0].label, "1〜399セット目は完了", "畳んだぶんも読み上げで分かる");
});

test("壊れた保存データでもゲージの幅は0〜100%に収まる", () => {
  const broken = [
    undefined,
    null,
    {},
    { totalItems: 0, answeredItems: 0, masteredItems: 0 },
    { totalItems: 10, answeredItems: -4, masteredItems: Number.NaN },
    { totalItems: 10, answeredItems: 40, masteredItems: 40 },
    { totalItems: "10", answeredItems: "5", masteredItems: "2" },
    { totalItems: Number.POSITIVE_INFINITY, answeredItems: 3, masteredItems: 1 },
  ];
  const rounds = [undefined, null, 0, -3, 1.7, Number.NaN, "4", Number.POSITIVE_INFINITY];
  for (const progress of broken) {
    for (const roundNumber of rounds) {
      const gauge = summarizeProgressGauge(progress, roundNumber);
      for (const width of [gauge.answeredWidth, gauge.masteredWidth, gauge.answeredPercent, gauge.masteredPercent]) {
        assert.ok(Number.isFinite(width) && width >= 0 && width <= 100, `幅が0〜100%に収まる（${width}）`);
      }
      assert.ok(Number.isInteger(gauge.roundNumber) && gauge.roundNumber >= 1);
      assert.ok(gauge.answeredItems <= gauge.totalItems, "解答済みは分母を超えない");
      assert.ok(gauge.masteredItems <= gauge.totalItems, "習得は分母を超えない");
      assert.ok(gauge.finishedBars.length <= GAUGE_MAX_BARS - 1);
    }
  }
});

test("習得が解答済みを上回っても薄い塗りが消えない", () => {
  // 「解答済み」は長期履歴、「習得」はセットの状態と出所が別なので、
  // 履歴だけを取りこぼした端末では習得のほうが多くなり得る。
  const gauge = summarizeProgressGauge({ totalItems: 10, answeredItems: 1, masteredItems: 7 }, 1);
  assert.equal(gauge.answeredPercent, 10, "数値は履歴どおりに出す");
  assert.equal(gauge.masteredPercent, 70);
  assert.equal(gauge.answeredWidth, 70, "包含関係が崩れないよう薄い塗りを広げる");
  assert.ok(gauge.answeredWidth >= gauge.masteredWidth);
});

test("低い画面でも、学習の準備をスタートまで1画面に収める", () => {
  const shortScreenIndex = stylesSource.indexOf("@media (max-height: 720px)");
  assert.ok(shortScreenIndex > stylesSource.indexOf(".setup-chip {"), "札の指定は低い画面向けの指定より前に置く");
  const shortScreen = stylesSource.slice(shortScreenIndex);
  assert.match(shortScreen, /\.setup-chip \{[^}]*min-height: 48px/);
  assert.match(shortScreen, /\.setup-groups \{/);
  // スタートは画面の下に貼りつく
  assert.match(stylesSource, /\.sticky-action \{[^}]*position: fixed/);
});

test("続きからのカードも、同じ条件の周回と同じセットを指す", () => {
  const resumeSource = functionSource("resumeStudyMarkup", "resultSession");
  assert.match(resumeSource, /const cycle = studyProgressSummary\(entry\.progress\);/);
  assert.match(resumeSource, /range: config\.filters\.ranges\[0\],\s*\n\s*importance: config\.filters\.importance\[0\],/);
  assert.match(resumeSource, /const detail = `重要度 \$\{config\.filters\.importance\[0\]\}`;/);
});
