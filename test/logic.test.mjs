import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  ALL_MODES,
  ONE_HOUR_REVIEW_DELAY_MS,
  UNKNOWN_CHOICE,
  WRONG_REVIEW_DELAY_MS,
  accuracyFor,
  applyFilters,
  buildQuestion,
  buildSession,
  buildStudySession,
  difficultyScore,
  emptyHistory,
  itemSupportsMode,
  isAnswerCorrect,
  mergeAttempt,
  normalizeAnswer,
  reviewDelayForAnswer,
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
const publicItems = JSON.parse(fs.readFileSync(new URL("../data/public-items.json", import.meta.url), "utf8"));
const healthItems = JSON.parse(fs.readFileSync(new URL("../data/health-items.json", import.meta.url), "utf8"));
const healthNotesHtml = fs.readFileSync(new URL("../health-notes.html", import.meta.url), "utf8");

test("health notebook includes the lower-half red sheet controls", () => {
  assert.match(healthNotesHtml, /id="red-sheet-toggle"/);
  assert.match(healthNotesHtml, /height:50dvh/);
  assert.match(healthNotesHtml, /\.term\.red-sheet-masked/);
  assert.match(healthNotesHtml, /text-decoration-line:none!important/);
});

test("wrong answers become eligible for review after three minutes", () => {
  assert.equal(WRONG_REVIEW_DELAY_MS, 180_000);
  assert.equal(ONE_HOUR_REVIEW_DELAY_MS, 3_600_000);
  assert.equal(reviewDelayForAnswer("en_to_ja_choice", false), WRONG_REVIEW_DELAY_MS);
  assert.equal(reviewDelayForAnswer("ja_to_en_choice", true), null);
  assert.equal(reviewDelayForAnswer("spelling_input", false), null);
  assert.equal(
    reviewDelayForAnswer("public_recall", false, ONE_HOUR_REVIEW_DELAY_MS),
    ONE_HOUR_REVIEW_DELAY_MS,
  );
});

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

test("choice questions contain four answer options, unknown, and the correct answer", () => {
  const item = items.find((candidate) => candidate.english === "remarkable");
  const question = buildQuestion(item, "en_to_ja_choice", items, () => 0.42);
  assert.equal(question.choices.length, 5);
  assert.equal(new Set(question.choices).size, 5);
  assert.ok(question.choices.includes(item.japanese));
  assert.equal(question.choices.at(-1), UNKNOWN_CHOICE);
});

test("English flashcards support both directions and reveal the matching answer", () => {
  const item = items.find((candidate) => candidate.english === "remarkable");
  const englishFirst = buildQuestion(item, "en_to_ja_flashcard", items);
  const japaneseFirst = buildQuestion(item, "ja_to_en_flashcard", items);
  assert.equal(englishFirst.prompt, item.english);
  assert.equal(englishFirst.answer, item.japanese);
  assert.equal(japaneseFirst.prompt, item.japanese);
  assert.equal(japaneseFirst.answer, item.english);
});

test("phrase distractors contain the same number of A and B placeholders", () => {
  const item = items.find((candidate) => candidate.english === "pour A over B");
  const question = buildQuestion(item, "ja_to_en_choice", items, () => 0.42);
  const count = (value, placeholder) =>
    (value.match(new RegExp(`(?<![A-Za-z])${placeholder}(?![A-Za-z])`, "g")) ?? []).length;
  const answerChoices = question.choices.filter((choice) => choice !== UNKNOWN_CHOICE);
  assert.equal(answerChoices.length, 4);
  assert.ok(answerChoices.every((choice) => count(choice, "A") === 1));
  assert.ok(answerChoices.every((choice) => count(choice, "B") === 1));
});

test("structure choices hide grammar notes and avoid recent, nearby-range distractors", () => {
  const target = {
    id: "target",
    type: "structure",
    range: "OriHime",
    importance: "S",
    english: "target structure",
    japanese: "正しい意味（関係代名詞 who）",
    acceptedAnswers: ["target structure"],
  };
  const pool = [
    target,
    { ...target, id: "mars", range: "Mars", english: "mars structure", japanese: "火星の誤答（間接疑問）" },
    { ...target, id: "snow", range: "Snow", english: "snow structure", japanese: "雪の誤答（受動態）" },
    { ...target, id: "fomo", range: "FOMO", english: "fomo structure", japanese: "別範囲の誤答（分詞構文）" },
    { ...target, id: "recent", range: "Plastic", english: "recent structure", japanese: "直近の答え（to不定詞）" },
  ];
  const question = buildQuestion(target, "en_to_ja_choice", pool, () => 0.42, ["recent"]);
  assert.equal(question.choices.length, 5);
  assert.equal(question.correctChoice, "正しい意味");
  assert.ok(question.choices.every((choice) => !choice.includes("（")));
  assert.ok(!question.choices.includes("直近の答え"));
  assert.deepEqual(
    new Set(question.choices),
    new Set(["正しい意味", "火星の誤答", "雪の誤答", "別範囲の誤答", UNKNOWN_CHOICE]),
  );
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
  assert.ok(session.every((entry) => itemSupportsMode(entry.item, entry.mode)));
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

test("step-based English study selection supports choice and flashcards in both directions", () => {
  const word = items.find((item) => item.type === "word");
  const phrase = items.find((item) => item.type === "phrase");
  const structure = items.find((item) => item.type === "structure");
  assert.equal(
    studyModeForItem(word, { content: "all", method: "en_to_ja_choice" }),
    "en_to_ja_choice",
  );
  assert.equal(
    studyModeForItem(phrase, { content: "phrase", method: "en_to_ja_flashcard" }),
    "en_to_ja_flashcard",
  );
  assert.equal(
    studyModeForItem(structure, { content: "structure", method: "ja_to_en_choice" }),
    "ja_to_en_choice",
  );
  assert.equal(
    studyModeForItem(structure, { content: "structure", method: "ja_to_en_flashcard" }),
    "ja_to_en_flashcard",
  );
  assert.equal(
    studyModeForItem(phrase, { content: "word", method: "en_to_ja_flashcard" }),
    null,
  );
  assert.equal(studyModeForItem(word, { content: "word", method: "write" }), null);
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
  assert.ok(first.every((entry) => entry.item.type === "phrase"));
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

test("public study selections keep answer formats separate and use self grading", () => {
  const termSelection = { subject: "public", content: "term", method: "recall", scope: "full" };
  const shortSelection = { subject: "public", content: "short", method: "recall", scope: "full" };
  const term = publicItems.find((item) => item.type === "public-term");
  const short = publicItems.find((item) => item.type === "public-short");
  assert.equal(studyModeForItem(term, termSelection), "public_recall");
  assert.equal(studyModeForItem(short, termSelection), null);
  assert.equal(studyModeForItem(short, shortSelection), "public_recall");
  assert.equal(studyCombinationKey(termSelection), "public:term:recall:full");
  const question = buildQuestion(term, "public_recall", publicItems);
  assert.equal(question.prompt, term.publicQuestion);
  assert.equal(question.answer, term.publicAnswer);
});

test("health study selections match the public self-grading flow", () => {
  const termSelection = { subject: "health", content: "term", method: "recall", scope: "full" };
  const shortSelection = { subject: "health", content: "short", method: "recall", scope: "full" };
  const term = healthItems.find((item) => item.type === "health-term");
  const short = healthItems.find((item) => item.type === "health-short");
  assert.equal(studyModeForItem(term, termSelection), "health_recall");
  assert.equal(studyModeForItem(short, termSelection), null);
  assert.equal(studyModeForItem(short, shortSelection), "health_recall");
  assert.equal(studyCombinationKey(termSelection), "health:term:recall:full");
  const question = buildQuestion(term, "health_recall", healthItems);
  assert.equal(question.prompt, term.healthQuestion);
  assert.equal(question.answer, term.healthAnswer);
  assert.equal(summarizeByRange(healthItems, new Map()).length, 8);
});
