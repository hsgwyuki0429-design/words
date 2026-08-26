import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  ALL_MODES,
  accuracyFor,
  applyFilters,
  buildQuestion,
  buildSession,
  buildStudySession,
  difficultyScore,
  emptyHistory,
  isAnswerCorrect,
  mergeAttempt,
  normalizeAnswer,
  studyCombinationKey,
  studyCyclePolicy,
  studyModeForItem,
  slotTokensForQuestion,
  sortItems,
  summarizeByMode,
  summarizeByRange,
  summarizeHistory,
  summarizeSession,
} from "../src/logic.js";

const items = JSON.parse(fs.readFileSync(new URL("../data/items.json", import.meta.url), "utf8"));

test("answer normalization ignores case and repeated spaces but not spelling", () => {
  assert.equal(normalizeAnswer("  Mistake   A For B  "), "mistake a for b");
  assert.equal(isAnswerCorrect("Mistake A For B", ["mistake A for B"]), true);
  assert.equal(isAnswerCorrect("avairable", ["available"]), false);
});

test("Japanese-to-English input exposes one slot per English word", () => {
  const item = items.find((candidate) => candidate.english === "enable A to do");
  assert.deepEqual(slotTokensForQuestion(item, "ja_to_en_input"), ["enable", "A", "to", "do"]);
  assert.equal(slotTokensForQuestion(item, "ja_to_en_input").length, 4);
});

test("history records overall and per-mode results", () => {
  const first = mergeAttempt(null, {
    itemId: "sample",
    mode: "ja_to_en_input",
    correct: false,
    answeredAt: 100,
    durationMs: 1200,
  });
  const second = mergeAttempt(first, {
    itemId: "sample",
    mode: "ja_to_en_input",
    correct: true,
    answeredAt: 200,
    durationMs: 800,
  });
  assert.equal(second.totalAttempts, 2);
  assert.equal(second.correctCount, 1);
  assert.equal(second.wrongCount, 1);
  assert.equal(second.hasEverMissed, true);
  assert.equal(second.currentCorrectStreak, 1);
  assert.equal(second.modeStats.ja_to_en_input.attempts, 2);
  assert.equal(second.modeStats.ja_to_en_input.wrong, 1);
  assert.equal(second.totalAnswerTimeMs, 2000);
  assert.equal(accuracyFor(second), 0.5);
});

test("multiple filter categories combine while values inside a category OR together", () => {
  const history = new Map();
  const target = items.find(
    (item) => item.range === "Plastic" && item.importance === "SSS" && item.type !== "word",
  );
  history.set(
    target.id,
    mergeAttempt(emptyHistory(target.id), {
      itemId: target.id,
      mode: "ja_to_en_input",
      correct: false,
    }),
  );
  const result = applyFilters(items, history, {
    ranges: ["Plastic", "FOMO"],
    importance: ["SSS", "SS"],
    types: [],
    modes: ["ja_to_en_input"],
    tags: [],
    performance: "everMissed",
    minimumWrong: 1,
  });
  assert.ok(result.some((item) => item.id === target.id));
  assert.ok(result.every((item) => ["Plastic", "FOMO"].includes(item.range)));
  assert.ok(result.every((item) => ["SSS", "SS"].includes(item.importance)));
});

test("difficulty order prioritizes repeated mistakes", () => {
  const sample = items.slice(0, 2);
  const history = new Map([
    [sample[0].id, { ...emptyHistory(sample[0].id), totalAttempts: 4, correctCount: 4 }],
    [
      sample[1].id,
      { ...emptyHistory(sample[1].id), totalAttempts: 4, wrongCount: 4, hasEverMissed: true },
    ],
  ]);
  const sorted = sortItems(sample, history, "difficulty");
  assert.equal(sorted[0].id, sample[1].id);
  assert.ok(
    difficultyScore(history.get(sample[1].id), sample[1].importance) >
      difficultyScore(history.get(sample[0].id), sample[0].importance),
  );
});

test("workbook difficulty order starts with the hardest level", () => {
  const sample = ["4級", "2級", "準1級", "専門"].map((difficulty) =>
    items.find((item) => item.difficulty === difficulty),
  );
  const sorted = sortItems(sample, new Map(), "difficulty-level-desc");
  assert.deepEqual(sorted.map((item) => item.difficulty), ["専門", "準1級", "2級", "4級"]);
});

test("choice questions contain four unique options and the correct answer", () => {
  const item = items.find((candidate) => candidate.english === "remarkable");
  const question = buildQuestion(item, "en_to_ja_choice", items, () => 0.42);
  assert.equal(question.choices.length, 4);
  assert.equal(new Set(question.choices).size, 4);
  assert.ok(question.choices.includes(item.japanese));
});

test("sessions never repeat an item and only use supported modes", () => {
  const session = buildSession({
    items,
    history: new Map(),
    filters: { ranges: ["Mars"] },
    selectedModes: ALL_MODES,
    sortKey: "importance-desc",
    count: 30,
    rng: () => 0.37,
  });
  assert.equal(session.length, 30);
  assert.equal(new Set(session.map((entry) => entry.item.id)).size, 30);
  assert.ok(session.every((entry) => entry.item.range === "Mars"));
  assert.ok(session.every((entry) => entry.item.questionModes.includes(entry.mode)));
});

test("session summary reports streak, speed, and unique items", () => {
  const summary = summarizeSession([
    { itemId: "a", correct: true, durationMs: 900 },
    { itemId: "b", correct: true, durationMs: 1100 },
    { itemId: "a", correct: false, durationMs: 1000 },
  ]);
  assert.equal(summary.total, 3);
  assert.equal(summary.correct, 2);
  assert.equal(summary.bestStreak, 2);
  assert.equal(summary.uniqueItems, 2);
  assert.equal(summary.averageDurationMs, 1000);
});

test("phase 4 analytics aggregate history by range and by mode", () => {
  const target = items.find((item) => item.questionModes.includes("ja_to_en_input"));
  const history = new Map([
    [
      target.id,
      mergeAttempt(emptyHistory(target.id), {
        itemId: target.id,
        mode: "ja_to_en_input",
        correct: false,
        durationMs: 1500,
      }),
    ],
  ]);
  const range = summarizeByRange(items, history).find((stat) => stat.range === target.range);
  const mode = summarizeByMode(items, history).find((stat) => stat.mode === "ja_to_en_input");
  assert.equal(range.wrong, 1);
  assert.equal(range.answeredItems, 1);
  assert.equal(mode.attempts, 1);
  assert.equal(mode.wrong, 1);
  assert.equal(mode.averageDurationMs, 1500);
});

test("overall two-correct streak rate counts mastered items", () => {
  const sample = items.slice(0, 3);
  const history = new Map([
    [sample[0].id, { ...emptyHistory(sample[0].id), currentCorrectStreak: 2 }],
    [sample[1].id, { ...emptyHistory(sample[1].id), currentCorrectStreak: 1 }],
    [sample[2].id, { ...emptyHistory(sample[2].id), currentCorrectStreak: 3 }],
  ]);
  const summary = summarizeHistory(sample, history);
  assert.equal(summary.twoCorrectStreakItems, 2);
  assert.equal(summary.twoCorrectStreakRate, 2 / 3);
});

test("step-based study selection maps words and phrases to the requested writing scope", () => {
  const word = items.find((item) => item.type === "word" && item.questionModes.includes("spelling_input"));
  const phrase = items.find((item) => item.type !== "word" && item.questionModes.includes("phrase_blank_input"));
  assert.equal(
    studyModeForItem(word, { content: "all", method: "write", scope: "partial" }),
    "spelling_input",
  );
  assert.equal(
    studyModeForItem(phrase, { content: "phrase", method: "write", scope: "partial" }),
    "phrase_blank_input",
  );
  assert.equal(
    studyModeForItem(phrase, { content: "phrase", method: "write", scope: "full" }),
    "ja_to_en_input",
  );
  assert.equal(
    studyModeForItem(phrase, { content: "word", method: "write", scope: "full" }),
    null,
  );
});

test("same study combination resumes after completed item ids", () => {
  const selection = { content: "phrase", method: "en_to_ja_choice", scope: "full" };
  const first = buildStudySession({
    items,
    history: new Map(),
    selection,
    sortKey: "importance-desc",
    count: 5,
  });
  const resumed = buildStudySession({
    items,
    history: new Map(),
    selection,
    completedItemIds: first.map((entry) => entry.item.id),
    sortKey: "importance-desc",
    count: 5,
  });
  assert.equal(studyCombinationKey(selection), "phrase:en_to_ja_choice:full");
  assert.equal(first.length, 5);
  assert.equal(resumed.length, 5);
  assert.ok(resumed.every((entry) => !first.some((done) => done.item.id === entry.item.id)));
  assert.ok(first.every((entry) => entry.item.type !== "word"));
});

test("study cycle performance is automatic twice and required from cycle three", () => {
  assert.deepEqual(studyCyclePolicy(1), {
    cycle: 1,
    performance: "all",
    requiresChoice: false,
  });
  assert.deepEqual(studyCyclePolicy(2), {
    cycle: 2,
    performance: "everMissed",
    requiresChoice: false,
  });
  assert.equal(studyCyclePolicy(3).requiresChoice, true);
  assert.deepEqual(studyCyclePolicy(4, "accuracyUnder70"), {
    cycle: 4,
    performance: "accuracyUnder70",
    requiresChoice: false,
  });
});
