import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DEFAULT_MASTERY_CRITERION,
  MASTERY_CRITERIA,
  MASTERY_CRITERION_LABELS,
  WRONG_REVIEW_DELAY_MS,
  advanceStudyProgress,
  applyStudyAnswer,
  cloneStudyProgress,
  createStudyProgress,
  evaluateMastery,
  exactStudyMode,
  isCycleComplete,
  isMasteredInRound,
  mergeAttempt,
  normalizeMasteryCriterion,
  normalizeStudyProgress,
  pendingCycleItemIds,
  studyProgressKey,
  studyProgressSummary,
  RANDOM_TIE_BREAK_SORT_KEYS,
  sortItems,
} from "../src/logic.js";

const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const logicSource = readFileSync(new URL("../src/logic.js", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const storageSource = readFileSync(new URL("../src/storage.js", import.meta.url), "utf8");

function functionSource(name, nextName) {
  const start = appSource.indexOf(`function ${name}`);
  const end = appSource.indexOf(`function ${nextName}`, start + 1);
  assert.ok(start >= 0, `${name} should exist`);
  assert.ok(end > start, `${nextName} should follow ${name}`);
  return appSource.slice(start, end);
}

function newProgress(itemIds, criterion = DEFAULT_MASTERY_CRITERION) {
  return createStudyProgress({ key: "test", itemIds, criterion, now: 1_000 });
}

function answer(progress, itemId, correct, extra = {}) {
  return applyStudyAnswer(progress, { itemId, correct, now: 2_000, ...extra });
}

// テスト1：その周回の初回で正解 → 周回完了かつ習得
test("a first-attempt correct answer completes the item and masters it", () => {
  const progress = answer(newProgress(["A", "B"]), "A", true);
  assert.deepEqual(progress.cycleSeenIds, ["A"]);
  assert.deepEqual(progress.cycleCorrectIds, ["A"]);
  assert.equal(progress.firstAttemptResults.A, "correct");
  assert.equal(isMasteredInRound(progress, "A"), true);
  assert.deepEqual(pendingCycleItemIds(progress), ["B"]);
  assert.equal(isCycleComplete(progress), false);
});

// テスト2：初手不正解 → あとで正解しても、その周回では習得しない
test("a wrong first attempt completes the cycle for the item but never masters it", () => {
  let progress = newProgress(["A"]);
  progress = answer(progress, "A", false);
  assert.equal(progress.cycleCorrectIds.includes("A"), false);
  assert.equal(isMasteredInRound(progress, "A"), false);
  assert.equal(isCycleComplete(progress), false);

  progress = answer(progress, "A", true);
  assert.deepEqual(progress.cycleCorrectIds, ["A"]);
  // 「その周回で一度正解した」と「習得した」は別概念
  assert.equal(progress.firstAttemptResults.A, "wrong");
  assert.equal(isMasteredInRound(progress, "A"), false);
  assert.equal(isCycleComplete(progress), true);
});

// テスト3：2周目の対象は未習得だけ
test("the next cycle targets only the items that were not mastered", () => {
  let progress = newProgress(["A", "B"]);
  progress = answer(progress, "A", false);
  progress = answer(progress, "A", true);
  progress = answer(progress, "B", true);
  assert.equal(isCycleComplete(progress), true);

  const next = advanceStudyProgress(progress, { now: 3_000 });
  assert.equal(next.cycleNumber, 2);
  assert.equal(next.masteryRound, 1);
  assert.deepEqual(next.cycleTargetIds, ["A"]);
  assert.deepEqual(next.cycleCorrectIds, []);
  assert.deepEqual(next.cycleSeenIds, []);
  assert.deepEqual(next.firstAttemptResults, {});
  assert.deepEqual(next.masteredIds, ["B"]);
});

// テスト4：2周目の初手正解で習得
test("a first-attempt correct answer in the second cycle masters the item", () => {
  let progress = newProgress(["A", "B"]);
  progress = answer(progress, "A", false);
  progress = answer(progress, "A", true);
  progress = answer(progress, "B", true);
  progress = advanceStudyProgress(progress, { now: 3_000 });
  progress = answer(progress, "A", true);
  assert.equal(isMasteredInRound(progress, "A"), true);
  assert.equal(isCycleComplete(progress), true);
});

// テスト5：途中再開はこの周回でまだ正解していない問題だけ
test("resuming a cycle only returns the items not yet answered correctly in it", () => {
  const ids = Array.from({ length: 100 }, (_, index) => `item-${index}`);
  let progress = newProgress(ids);
  ids.slice(0, 80).forEach((itemId) => {
    progress = answer(progress, itemId, true);
  });
  const pending = pendingCycleItemIds(progress);
  assert.equal(pending.length, 20);
  assert.deepEqual(pending, ids.slice(80));

  const resumed = normalizeStudyProgress(JSON.parse(JSON.stringify(progress)), { itemIds: ids });
  assert.deepEqual(pendingCycleItemIds(resumed), ids.slice(80));
  assert.equal(resumed.cycleNumber, 1);
  // 2周目で既に正解した問題は、未習得でも再開対象に戻さない
  let second = advanceStudyProgress(
    ids.slice(80).reduce((current, itemId) => answer(current, itemId, false), progress),
    { now: 4_000 },
  );
  assert.equal(second.cycleNumber, 1, "まだ周回が終わっていないので進まない");
});

// テスト6：再出題待ちが残っている間は周回完了にしない
test("a pending 3-minute review keeps the cycle open", () => {
  let progress = newProgress(["A", "B"]);
  progress = answer(progress, "B", true);
  progress = answer(progress, "A", false, { reviewDueAt: 5_000 + WRONG_REVIEW_DELAY_MS });
  assert.equal(progress.pendingReviews.length, 1);
  assert.deepEqual(progress.pendingReviews[0], { itemId: "A", dueAt: 5_000 + WRONG_REVIEW_DELAY_MS });
  assert.equal(isCycleComplete(progress), false);
  assert.deepEqual(pendingCycleItemIds(progress), ["A"]);
  // 復習で正解すると予約が消えて周回が完了する
  progress = answer(progress, "A", true);
  assert.deepEqual(progress.pendingReviews, []);
  assert.equal(isCycleComplete(progress), true);
});

// テスト7：全習得したら新しい習得ラウンドを全問題で始める
test("mastering everything starts a fresh mastery round over all items", () => {
  let progress = newProgress(["A", "B"]);
  progress = answer(progress, "A", true);
  progress = answer(progress, "B", true);
  assert.equal(isCycleComplete(progress), true);
  const next = advanceStudyProgress(progress, { roundItemIds: ["A", "B", "C"], now: 6_000 });
  assert.equal(next.masteryRound, 2);
  assert.equal(next.cycleNumber, 1);
  assert.deepEqual(next.cycleTargetIds, ["A", "B", "C"]);
  assert.deepEqual(next.masteredIds, []);
  assert.deepEqual(next.consecutiveCorrect, {});
  // 長期履歴には触れない
  assert.match(
    functionSource("completeSession", "sessionResultMarkup"),
    /advanceStudyProgress\(session\.progress, \{ roundItemIds: session\.poolItemIds \}\)/,
  );
  assert.doesNotMatch(functionSource("completeSession", "sessionResultMarkup"), /clearAllData|removeHistory/);
});

// テスト8：5形式の完全分離
test("cycle state is keyed by the exact format, so formats never leak into each other", () => {
  const base = { subject: "english", contents: ["word"], filters: { ranges: ["Plastic"] } };
  const keyFor = (method) => studyProgressKey({
    selection: { subject: "english", contents: ["word"], method },
    filters: base.filters,
  });
  const keys = [
    "en_to_ja_choice",
    "en_to_ja_flashcard",
    "ja_to_en_choice",
    "ja_to_en_flashcard",
    "ja_to_en_input",
  ].map(keyFor);
  assert.equal(new Set(keys).size, 5);
  assert.equal(exactStudyMode({ subject: "english", contents: ["word"], method: "en_to_ja_choice" }), "en_to_ja_choice");
  assert.equal(exactStudyMode({ subject: "public", content: "term", method: "recall" }), "public_recall");

  // 範囲が違えば別の周回、並び替えだけ違うなら同じ周回
  assert.notEqual(
    studyProgressKey({ selection: { contents: ["word"], method: "ja_to_en_input" }, filters: { ranges: ["Plastic"] } }),
    studyProgressKey({ selection: { contents: ["word"], method: "ja_to_en_input" }, filters: { ranges: ["Mars"] } }),
  );
  assert.equal(
    studyProgressKey({ selection: { contents: ["word"], method: "ja_to_en_input" }, filters: { ranges: ["Plastic"] }, sortKey: "random" }),
    studyProgressKey({ selection: { contents: ["word"], method: "ja_to_en_input" }, filters: { ranges: ["Plastic"] }, sortKey: "difficulty" }),
  );
  assert.deepEqual(
    JSON.parse(keyFor("ja_to_en_input")).ranges,
    ["Plastic"],
  );
});

// テスト9・10：Undoは回答前の状態へ戻す
test("undo restores history, cycle state, mastery, reviews and combo", () => {
  const before = newProgress(["A", "B"]);
  const snapshot = cloneStudyProgress(before);
  const afterCorrect = answer(before, "A", true);
  assert.equal(isMasteredInRound(afterCorrect, "A"), true);
  // snapshot からの復元で習得判定ごと巻き戻る
  assert.equal(isMasteredInRound(snapshot, "A"), false);
  assert.deepEqual(snapshot.cycleCorrectIds, []);
  assert.deepEqual(snapshot.firstAttemptResults, {});

  const afterWrong = answer(before, "B", false, { reviewDueAt: 9_000 });
  assert.equal(afterWrong.pendingReviews.length, 1);
  assert.deepEqual(cloneStudyProgress(snapshot).pendingReviews, []);

  const submitSource = functionSource("submitAnswer", "canUndoLastAnswer");
  assert.match(submitSource, /session\.undo = \{/);
  assert.match(submitSource, /historyRecord: state\.history\.has\(question\.item\.id\)/);
  assert.match(submitSource, /progress: cloneStudyProgress\(session\.progress\)/);
  assert.match(submitSource, /deferredReviews: session\.deferredReviews\.map/);
  assert.match(submitSource, /combo: state\.combo/);

  const undoSource = functionSource("undoLastAnswer", "undoButtonMarkup");
  assert.match(undoSource, /putHistory\(undo\.historyRecord\)/);
  assert.match(undoSource, /removeHistory\(undo\.itemId\)/);
  assert.match(undoSource, /session\.progress = undo\.progress/);
  assert.match(undoSource, /persistStudyProgress\(undo\.progressKey, undo\.progress\)/);
  assert.match(undoSource, /session\.deferredReviews = undo\.deferredReviews/);
  assert.match(undoSource, /session\.results = session\.results\.slice\(0, undo\.resultsLength\)/);
  assert.match(undoSource, /session\.complete = false/);
  assert.match(undoSource, /state\.combo = undo\.combo/);
  // 数字を1減らすだけの危険な実装になっていないこと
  assert.doesNotMatch(undoSource, /correctCount\s*-|wrongCount\s*-|totalAttempts\s*-/);
  // 永続化側にも書き戻す
  assert.match(storageSource, /export async function putHistory/);
  assert.match(storageSource, /export async function removeHistory/);
});

test("undo is reachable from the quiz and from the result panel until a new session starts", () => {
  assert.match(appSource, /data-undo-answer"\)\) undoLastAnswer\(\)/);
  assert.match(appSource, /undoButtonMarkup\(\)/);
  assert.match(appSource, /data-undo-answer>↶ 直前の回答を取り消す/);
  assert.match(appSource, /undo: null,\n  \};/);
  assert.match(stylesSource, /\.quiz-header-left \{/);
  assert.match(stylesSource, /\.undo-button \{/);
  // スワイプ面ではなくヘッダーに置き、既存ジェスチャーと干渉させない
  assert.match(appSource, /<div class="quiz-header-left">/);
});

// テスト11・12：2回連続正解
test("the two-consecutive-correct criterion counts within the mastery round", () => {
  assert.deepEqual(MASTERY_CRITERIA, ["first_attempt_in_cycle", "two_consecutive_correct"]);
  let progress = newProgress(["A"], "two_consecutive_correct");
  progress = answer(progress, "A", true);
  assert.equal(progress.consecutiveCorrect.A, 1);
  assert.equal(isMasteredInRound(progress, "A"), false, "1周目は連続1なのでまだ未習得");
  assert.equal(isCycleComplete(progress), true, "その周回では正解したので周回は完了");

  progress = advanceStudyProgress(progress, { now: 7_000 });
  assert.deepEqual(progress.cycleTargetIds, ["A"]);
  assert.equal(progress.consecutiveCorrect.A, 1, "連続はラウンド内で持ち越す");
  progress = answer(progress, "A", true);
  assert.equal(progress.consecutiveCorrect.A, 2);
  assert.equal(isMasteredInRound(progress, "A"), true);
});

test("a wrong answer resets the consecutive-correct counter", () => {
  let progress = newProgress(["A"], "two_consecutive_correct");
  progress = answer(progress, "A", true);
  progress = answer(progress, "A", false);
  assert.equal(progress.consecutiveCorrect.A ?? 0, 0);
  progress = answer(progress, "A", true);
  assert.equal(progress.consecutiveCorrect.A, 1);
  assert.equal(isMasteredInRound(progress, "A"), false);
  assert.equal(evaluateMastery({ criterion: "two_consecutive_correct", consecutiveCorrect: 1 }), false);
  assert.equal(evaluateMastery({ criterion: "two_consecutive_correct", consecutiveCorrect: 2 }), true);
  assert.equal(evaluateMastery({ criterion: "first_attempt_in_cycle", firstAttemptResult: "wrong" }), false);
  assert.equal(evaluateMastery({ criterion: "first_attempt_in_cycle", firstAttemptResult: "correct" }), true);
});

test("mode-level streaks are recorded per format and never taken from the global streak", () => {
  let record = mergeAttempt(null, { itemId: "A", mode: "en_to_ja_choice", correct: true });
  record = mergeAttempt(record, { itemId: "A", mode: "ja_to_en_choice", correct: true });
  assert.equal(record.currentCorrectStreak, 2, "全形式を跨ぐ既存の連続は据え置き");
  assert.equal(record.modeStats.en_to_ja_choice.currentCorrectStreak, 1);
  assert.equal(record.modeStats.ja_to_en_choice.currentCorrectStreak, 1);
  record = mergeAttempt(record, { itemId: "A", mode: "en_to_ja_choice", correct: false });
  assert.equal(record.modeStats.en_to_ja_choice.currentCorrectStreak, 0);
  assert.equal(record.modeStats.en_to_ja_choice.bestCorrectStreak, 1);
  assert.equal(record.modeStats.ja_to_en_choice.currentCorrectStreak, 1);
});

// テスト13・14・15：学習内容選択
test("単語・熟語・構文は1タップで確定して次へ進む", () => {
  const renderSource = functionSource("renderStudyContent", "contentChoiceRow");
  assert.match(renderSource, /data-study-content-choice="\$\{content\}"/);
  assert.match(renderSource, /data-study-content-choice="all"/);
  assert.match(renderSource, /data-study-content-other/);
  assert.match(appSource, /if \(target\.dataset\.studyContentChoice\) \{\s*\n\s*applyContentChoice\(target\.dataset\.studyContentChoice\);\s*\n\s*setView\(state\.studyFlowMode === "dashboard" \? "study-importance" : "study-method"\)/);
  const applySource = functionSource("applyContentChoice", "showToast");
  assert.match(applySource, /choice === "all" \? \[\.\.\.ENGLISH_CONTENT_TYPES\] : \[choice\]/);
  // 単一選択画面には「次へ」を置かない
  assert.doesNotMatch(renderSource, /confirmStudyContent/);
});

test("学習内容の画面は5行に収まり、複数選択は「その他」だけで開く", () => {
  assert.match(indexSource, /id="view-study-content"[\s\S]*?class="content-choice-list" id="study-content-options"/);
  assert.match(indexSource, /id="view-study-content-multi"/);
  assert.doesNotMatch(
    indexSource.slice(indexSource.indexOf('id="view-study-content"'), indexSource.indexOf('id="view-study-content-multi"')),
    /sticky-action/,
  );
  assert.match(appSource, /data-study-content-other"\)\) \{[\s\S]*?setView\("study-content-multi"\)/);
  assert.match(stylesSource, /\.content-choice \{[^}]*min-height: 56px/);
  assert.match(stylesSource, /\.content-choice--secondary \{[^}]*min-height: 50px/);
  // 単語・熟語・構文の表記
  assert.match(appSource, /title: "構文"/);
  assert.match(logicSource, /structure: "構文"/);
});

// テスト16：並び替えは主要4種＋その他。並びは「何を学習しますか？」と同じ形式
test("並び替えは主要4種とその他を、学習内容の画面と同じ1列リストで並べる", () => {
  const sortSource = functionSource("renderStudySortKind", "renderStudySortOther");
  assert.match(sortSource, /key: "importance-desc", title: "重要度順"/);
  assert.match(sortSource, /key: "difficulty-level-desc", title: "難易度順"/);
  assert.match(sortSource, /key: "difficulty", title: "苦手順"/);
  assert.match(sortSource, /key: "random", title: "ランダム"/);
  // 学習内容の画面と同じ contentChoiceRow / content-choice-list を使う
  assert.match(sortSource, /contentChoiceRow\(\{/);
  assert.match(sortSource, /attribute: 'data-study-sort-kind="other"'/);
  assert.match(sortSource, /variant: "secondary"/);
  assert.match(indexSource, /class="content-choice-list" id="study-sort-kind-options"/);
  assert.match(indexSource, /class="content-choice-list" id="study-content-options"/);
  // 主要4種は押した時点で学習開始
  assert.match(appSource, /target\.dataset\.studySortKind === "other"[\s\S]*?setView\("study-sort-other"\)[\s\S]*?startSession\(\)/);
  // 既存の詳細並び替えは削除しない
  assert.match(appSource, /\["accuracy-asc", "正答率が低い順"\]/);
  assert.match(appSource, /\["alpha-ja", "あいうえお順"\]/);
  assert.match(indexSource, /id="view-study-sort-other"/);
});

// テスト17：設定の保存
test("the mastery criterion lives in settings and persists per device", () => {
  assert.equal(normalizeMasteryCriterion(undefined), "first_attempt_in_cycle");
  assert.equal(normalizeMasteryCriterion("nonsense"), "first_attempt_in_cycle");
  assert.equal(normalizeMasteryCriterion("two_consecutive_correct"), "two_consecutive_correct");
  assert.equal(DEFAULT_MASTERY_CRITERION, "first_attempt_in_cycle");
  assert.equal(MASTERY_CRITERION_LABELS.first_attempt_in_cycle.title, "その周回の最初の回答で正解");
  assert.equal(MASTERY_CRITERION_LABELS.two_consecutive_correct.title, "2回連続で正解");
  assert.match(appSource, /masteryCriterion: DEFAULT_MASTERY_CRITERION,/);
  assert.match(appSource, /state\.settings\.masteryCriterion = criterion;\s*\n\s*saveSettings\(\)/);
  assert.match(appSource, /setMeta\("settings", state\.settings\)/);
  assert.match(appSource, /state\.settings\.masteryCriterion = normalizeMasteryCriterion\(state\.settings\.masteryCriterion\)/);
  const settingsSource = functionSource("renderSettings", "prefersReducedMotion");
  assert.match(settingsSource, /学習状況・周回/);
  assert.match(settingsSource, /data-mastery-criterion="\$\{criterion\}"/);
  assert.match(stylesSource, /\.criterion-option \{/);
});

test("changing the criterion restarts only the round, never the long-term history", () => {
  const progress = answer(newProgress(["A"]), "A", true);
  const stored = JSON.parse(JSON.stringify(progress));
  assert.ok(normalizeStudyProgress(stored, { criterion: "first_attempt_in_cycle" }));
  assert.equal(normalizeStudyProgress(stored, { criterion: "two_consecutive_correct" }), null);
  assert.match(appSource, /習得条件を変更したため、進捗判定を新しく開始します/);
  assert.match(functionSource("ensureStudyProgress", "buildCycleQueue"), /createStudyProgress\(\{ key, itemIds, criterion: masteryCriterion\(\) \}\)/);
});

test("cycle state is persisted and restored so a closed app resumes mid-cycle", () => {
  assert.match(appSource, /setMeta\("studyProgress", state\.studyProgress\)/);
  assert.match(appSource, /getMetaObject\("studyProgress", \{\}\)/);
  assert.match(appSource, /normalizeStudyProgress\(state\.studyProgress\[key\]/);
  const buildSource = functionSource("buildCycleQueue", "beginSession");
  assert.match(buildSource, /pendingCycleItemIds\(progress\)/);
  assert.match(buildSource, /dueAt > now/);
  // 通常問題が尽きても、最も早い再出題を前倒しして周回を続ける
  assert.match(buildSource, /if \(!queue\.length && deferredReviews\.length\) \{\s*\n\s*queue\.push\(deferredReviews\.shift\(\)\.entry\)/);
  const nextSource = functionSource("nextQuestion", "completeSession");
  assert.match(nextSource, /if \(session\.deferredReviews\.length\) \{\s*\n\s*renderReviewWait\(\)/);
  assert.match(nextSource, /pendingCycleItemIds\(session\.progress\)\.length/);
  assert.match(nextSource, /requeuePendingCycleItems\(session\)/);
});

test("stale ids from updated workbook data are dropped safely", () => {
  const progress = answer(newProgress(["A", "B", "gone"]), "A", true);
  const restored = normalizeStudyProgress(JSON.parse(JSON.stringify(progress)), { itemIds: ["A", "B"] });
  assert.deepEqual(restored.cycleTargetIds, ["A", "B"]);
  assert.deepEqual(restored.masteredIds, ["A"]);
  assert.equal(normalizeStudyProgress({ cycleTargetIds: ["gone"] }, { itemIds: ["A"] }), null);
  assert.equal(normalizeStudyProgress(null), null);
});

test("a summary describes the current round and cycle for the UI", () => {
  let progress = newProgress(["A", "B", "C"]);
  progress = answer(progress, "A", true);
  progress = answer(progress, "B", false);
  const summary = studyProgressSummary(progress);
  assert.deepEqual(summary, {
    masteryRound: 1,
    cycleNumber: 1,
    criterion: "first_attempt_in_cycle",
    targetCount: 3,
    seenCount: 2,
    correctCount: 1,
    remainingCount: 2,
    masteredCount: 1,
    roundItemCount: 3,
    complete: false,
  });
  assert.equal(studyProgressSummary(null), null);
});

test("flashcard grading, not the reveal tap, is what counts as an answer", () => {
  // タップは表裏を切り替えるだけで回答にしない
  assert.match(functionSource("toggleRecallFace", "transitionToNextCard"), /session\.revealed = !session\.revealed/);
  assert.doesNotMatch(functionSource("toggleRecallFace", "transitionToNextCard"), /submitAnswer/);
  // 「習得」は正解、「3分後」「1時間後」は不正解側として周回・習得判定に渡る
  const swipeSource = functionSource("handleRecallSwipe", "handleChoiceNextSwipe");
  assert.match(swipeSource, /action === "three-minutes"\s*\n\s*\? WRONG_REVIEW_DELAY_MS/);
  assert.match(swipeSource, /ONE_HOUR_REVIEW_DELAY_MS/);
  assert.match(swipeSource, /submitAnswer\(question\.answer, action === "mastered", reviewDelayMs/);
});

test("通常フローでは回答状況をたずねない", () => {
  assert.match(functionSource("studyPoolItems", "ensureStudyProgress"), /performance: "all"/);
  assert.doesNotMatch(appSource, /renderStudyPerformance/);
  assert.doesNotMatch(indexSource, /data-study-performance/);
  // 範囲 → 形式 → 学習内容 → 重要度 → 並び替え → 学習
  assert.match(appSource, /setView\(isRecallSubject\(\) \? "study-importance" : "study-content"\)/);
  assert.match(appSource, /setView\(state\.studyFlowMode === "dashboard" \? "study-importance" : "study-method"\)/);
});

// ③ 同じレベル帯の中だけをランダムに並べる
function levelItems() {
  return [
    ...["a", "b", "c", "d"].map((id, index) => ({
      id, english: id, japanese: id, type: "word", range: "Plastic",
      importance: "S", difficulty: "F", order: index, questionModes: ["en_to_ja_choice"],
    })),
    ...["e", "f", "g", "h"].map((id, index) => ({
      id, english: id, japanese: id, type: "word", range: "Plastic",
      importance: "B", difficulty: "A", order: index + 4, questionModes: ["en_to_ja_choice"],
    })),
  ];
}

test("重要度順・難易度順では同じレベル帯の中だけがランダムになる", () => {
  assert.deepEqual(RANDOM_TIE_BREAK_SORT_KEYS, [
    "importance-desc",
    "importance-asc",
    "difficulty-level-desc",
  ]);
  const items = levelItems();
  for (const sortKey of ["importance-desc", "difficulty-level-desc"]) {
    const seen = new Set();
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const sorted = sortItems(items, new Map(), sortKey, Math.random, { randomizeTies: true });
      // レベル帯の境界は動かさない
      assert.deepEqual(
        sorted.slice(0, 4).map((item) => (sortKey === "importance-desc" ? item.importance : item.difficulty)).sort(),
        sortKey === "importance-desc" ? ["S", "S", "S", "S"] : ["F", "F", "F", "F"],
      );
      seen.add(sorted.map((item) => item.id).join(""));
    }
    // 帯の中の順番は毎回同じにならない
    assert.ok(seen.size > 1, `${sortKey} の同レベル帯がランダムになっていない`);
  }
});

test("単語帳など既定の呼び出しでは並びが変わらない", () => {
  const items = levelItems();
  for (const sortKey of ["importance-desc", "difficulty-level-desc", "registration"]) {
    const results = new Set();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      results.add(sortItems(items, new Map(), sortKey).map((item) => item.id).join(""));
    }
    assert.equal(results.size, 1, `${sortKey} は既定では決定的な並びのままであること`);
  }
  // 学習セッションの並びだけランダム化を有効にする
  assert.match(logicSource, /randomizeTies: true/);
  assert.match(functionSource("buildCycleQueue", "beginSession"), /\{ randomizeTies: true \}/);
});

// ④ 重要度も「何を学習しますか？」と同じ形式で毎回選ぶ
test("重要度は全重要度を先頭にした1列リストで毎回選ぶ", () => {
  const source = functionSource("renderStudyImportance", "renderStudyImportanceSelect");
  // 全重要度が一番上
  const allIndex = source.indexOf('data-study-importance-choice="all"');
  const eachIndex = source.indexOf("available.map((importance)");
  const otherIndex = source.indexOf("data-study-importance-other");
  assert.ok(allIndex > 0 && allIndex < eachIndex, "全重要度が個別の重要度より前にある");
  assert.ok(eachIndex < otherIndex, "「その他」は最後");
  // 学習内容の画面と同じ部品
  assert.match(source, /contentChoiceRow\(\{/);
  assert.match(indexSource, /class="content-choice-list" id="study-importance-options-single"/);
  // 1タップで確定して並び替えへ
  assert.match(appSource, /if \(target\.dataset\.studyImportanceChoice\) \{[\s\S]*?setView\("study-sort-kind"\)/);
  assert.match(appSource, /state\.filters\.importance = choice === "all" \? \[\] : \[choice\]/);
  // 「その他」だけ複数選択画面
  assert.match(appSource, /data-study-importance-other"\)\) \{[\s\S]*?setView\("study-importance-select"\)/);
  assert.match(indexSource, /id="view-study-importance-select"/);
  // 全部／指定の2択だった旧画面は残さない
  assert.doesNotMatch(indexSource, /view-study-importance-kind/);
  assert.doesNotMatch(appSource, /data-importance-filter-mode/);
});

test("学習内容の次に重要度、その次に並び替えを通る", () => {
  // ダッシュボード導線：範囲 → 形式 → 学習内容 → 重要度 → 並び替え
  assert.match(appSource, /setView\(state\.studyFlowMode === "dashboard" \? "study-importance" : "study-method"\)/);
  // 一問一答とステップ形式も問題形式のあとに重要度へ
  assert.match(appSource, /method: "recall",[\s\S]*?setView\("study-importance"\)/);
  assert.match(appSource, /state\.studySelection\.scope = "full";\s*\n\s*setView\("study-importance"\)/);
  // 並び替えからは重要度へ戻る
  assert.match(appSource, /data-back-before-sort"\)\) \{\s*\n\s*setView\("study-importance"\)/);
  assert.match(appSource, /if \(view === "study-importance"\) renderStudyImportance\(\)/);
});
