import test from "node:test";
import assert from "node:assert/strict";

import { createMemoryDriver } from "../server/storage/memory-driver.js";
import { createFileDataSource, createQuestionCatalog } from "../server/service/data-source.js";
import { createWordsService } from "../server/service/words-service.js";
import { SUBJECTS } from "../server/service/subjects.js";
import { ValidationError } from "../server/core/validate.js";

const dataDirectory = new URL("../data/", import.meta.url).pathname;

function newService() {
  return createWordsService({
    catalog: createQuestionCatalog(createFileDataSource(dataDirectory)),
    storage: createMemoryDriver(),
    idSuffix: (() => { let count = 0; return () => `t${(count += 1)}`; })(),
  });
}

const actor = { clientName: "claude", tokenLabel: "テスト" };

const publicQuestion = {
  question: "テスト用の問いを何というか。",
  answer: "テスト用語",
  range: "p.36–37",
  explanation: "テストのための解説。",
  choices: { A: "あ", B: "テスト用語", C: "う", D: "え" },
  correctChoice: "B",
};

test("教材データはそのまま読み込まれ、既存の問題数が変わらない", async () => {
  const service = newService();
  const info = await service.getAppInfo();
  assert.equal(info.subjects.english.questions, 1314);
  assert.equal(info.subjects.public.questions, 207);
  assert.equal(info.subjects.health.questions, 282);
  assert.equal(info.subjects["kobun-vocab"].questions, 360);
  assert.equal(info.totalQuestions, 2163);
  assert.equal(info.dataSchemaVersion, 1);
});

test("検索は件数を区切って返し、続きの位置を教える", async () => {
  const service = newService();
  const page = await service.searchQuestions({ query: "民主", limit: 3 });
  assert.ok(page.total > 3, "見つかった総数は返した件数より多い");
  assert.equal(page.questions.length, 3);
  assert.equal(page.hasMore, true);
  assert.equal(page.nextOffset, 3);

  const next = await service.searchQuestions({ query: "民主", limit: 3, offset: 3 });
  assert.notDeepEqual(next.questions[0].id, page.questions[0].id);
});

test("一度に返せる件数には上限があり、それを超える指定はできない", async () => {
  const service = newService();
  await assert.rejects(() => service.listQuestions({ limit: 5000 }), ValidationError);
  const page = await service.listQuestions({ subjects: ["public"], limit: 50 });
  assert.equal(page.questions.length, 50);
});

test("教科・範囲・重要度で絞り込める", async () => {
  const service = newService();
  const page = await service.listQuestions({ subjects: ["health"], importance: ["S"], limit: 10 });
  assert.ok(page.total > 0);
  assert.ok(page.questions.every((question) => question.subject === "health"));
  assert.ok(page.questions.every((question) => question.importance === "S"));
});

test("問題を追加すると、wordsの教材と同じ形で保存される", async () => {
  const service = newService();
  const result = await service.addQuestions({ subject: "public", questions: [publicQuestion] }, actor);
  assert.equal(result.added, 1);

  const id = result.questions[0].id;
  const detail = await service.getQuestion({ id });
  assert.equal(detail.question, publicQuestion.question);
  assert.equal(detail.explanation, publicQuestion.explanation);
  assert.deepEqual(detail.choices, publicQuestion.choices);
  assert.equal(detail.aiAdded, true);

  // 画面がそのまま出題できる形になっている。
  const { items } = await service.resolveItems();
  const stored = items.find((item) => item.id === id);
  assert.equal(stored.subject, "public");
  assert.equal(stored.publicQuestion, publicQuestion.question);
  assert.equal(stored.publicAnswer, publicQuestion.answer);
  assert.deepEqual(stored.questionModes, ["public_recall", "public_choice"]);
  assert.deepEqual(stored.acceptedAnswers, [publicQuestion.answer]);
  assert.equal(stored.editorial.correctChoice, "B");
});

test("不正な入力ではデータが壊れず、1件でも駄目なら1件も追加されない", async () => {
  const service = newService();
  const before = (await service.getAppInfo()).totalQuestions;

  // 存在しない範囲
  await assert.rejects(
    () => service.addQuestions({ subject: "public", questions: [{ ...publicQuestion, range: "架空の範囲" }] }, actor),
    ValidationError,
  );
  // 必須項目が無い
  await assert.rejects(
    () => service.addQuestions({ subject: "public", questions: [{ answer: "答えだけ", range: "p.36–37" }] }, actor),
    ValidationError,
  );
  // 知らない項目（誤字）
  await assert.rejects(
    () => service.addQuestions({ subject: "public", questions: [{ ...publicQuestion, questoin: "誤字" }] }, actor),
    ValidationError,
  );
  // 型が違う
  await assert.rejects(
    () => service.addQuestions({ subject: "public", questions: [{ ...publicQuestion, tags: "配列ではない" }] }, actor),
    ValidationError,
  );
  // 長すぎる
  await assert.rejects(
    () => service.addQuestions({ subject: "public", questions: [{ ...publicQuestion, answer: "あ".repeat(5000) }] }, actor),
    ValidationError,
  );
  // 2件目が壊れているので、1件目も保存されない
  await assert.rejects(
    () => service.addQuestions({
      subject: "public",
      questions: [publicQuestion, { ...publicQuestion, question: "別の問い", range: "架空" }],
    }, actor),
    ValidationError,
  );

  assert.equal((await service.getAppInfo()).totalQuestions, before, "失敗した追加は1件も残っていない");
});

test("一度の呼び出しで大量に追加することはできない", async () => {
  const service = newService();
  const many = Array.from({ length: 100 }, (_, index) => ({
    ...publicQuestion,
    question: `大量追加の問い${index}を何というか。`,
  }));
  await assert.rejects(() => service.addQuestions({ subject: "public", questions: many }, actor), ValidationError);
});

test("同じ問題文は二重に登録されない", async () => {
  const service = newService();
  await service.addQuestions({ subject: "public", questions: [publicQuestion] }, actor);
  await assert.rejects(
    () => service.addQuestions({ subject: "public", questions: [publicQuestion] }, actor),
    ValidationError,
  );
});

test("編集は指定した項目だけを変え、他はそのまま残す", async () => {
  const service = newService();
  const before = await service.getQuestion({ id: "public-20260908-0001" });
  const result = await service.updateQuestion({
    id: "public-20260908-0001",
    patch: { explanation: "書き換えた解説", importance: "SSS" },
  }, actor);

  assert.deepEqual(result.changed, ["explanation", "importance"]);
  const after = await service.getQuestion({ id: "public-20260908-0001" });
  assert.equal(after.explanation, "書き換えた解説");
  assert.equal(after.importance, "SSS");
  assert.equal(after.question, before.question, "問題文は変わらない");
  assert.deepEqual(after.choices, before.choices, "選択肢も変わらない");
  assert.equal(after.edited, true);
});

test("編集しても元の教材データ（data/*.json）には手を触れない", async () => {
  const service = newService();
  await service.updateQuestion({ id: "health-0001", patch: { answer: "書き換えた答え" } }, actor);
  const raw = await createFileDataSource(dataDirectory).read("health");
  assert.equal(raw.find((item) => item.id === "health-0001").healthAnswer, "平均寿命");
});

test("答えを変えると、教科ごとの対の項目もまとめて揃う", async () => {
  const service = newService();
  await service.updateQuestion({ id: "health-0001", patch: { answer: "新しい答え" } }, actor);
  const { items } = await service.resolveItems();
  const item = items.find((candidate) => candidate.id === "health-0001");
  assert.equal(item.healthAnswer, "新しい答え");
  assert.equal(item.japanese, "新しい答え");
  assert.equal(item.acceptedAnswers[0], "新しい答え");
});

test("削除はゴミ箱へ移すだけで、確認なしには実行できない", async () => {
  const service = newService();
  await assert.rejects(
    () => service.deleteQuestion({ id: "public-20260908-0001" }, actor),
    ValidationError,
    "confirm が無いと削除しない",
  );

  const deleted = await service.deleteQuestion({ id: "public-20260908-0001", confirm: true, reason: "重複" }, actor);
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.restorable, true);

  const list = await service.listQuestions({ subjects: ["public"], limit: 1 });
  assert.equal(list.total, 206, "一覧からは消えている");

  const overlay = await service.getOverlay();
  assert.deepEqual(overlay.deletedIds, ["public-20260908-0001"]);

  await service.restoreQuestion({ id: "public-20260908-0001" }, actor);
  assert.equal((await service.listQuestions({ subjects: ["public"], limit: 1 })).total, 207);
});

test("AI経由の操作は記録に残る", async () => {
  const service = newService();
  await service.addQuestions({ subject: "public", questions: [publicQuestion] }, actor);
  await service.updateQuestion({ id: "health-0001", patch: { importance: "S" } }, actor);
  const log = await service.getOperationLog({ limit: 10 });
  assert.equal(log.entries.length, 2);
  assert.equal(log.entries[0].tool, "updateQuestion");
  assert.equal(log.entries[1].tool, "addQuestions");
  assert.equal(log.entries[0].client, "claude");
  assert.match(log.entries[1].summary, /公共に1件追加/);
});

test("学習履歴を預けると、統計・間違い・履歴が返るようになる", async () => {
  const service = newService();
  const today = Date.parse("2026-09-11T10:00:00+09:00");
  const yesterday = today - 86400000;
  await service.saveHistorySnapshot({
    deviceId: "device-test",
    records: {
      "health-0001": {
        itemId: "health-0001",
        totalAttempts: 4,
        correctCount: 1,
        wrongCount: 3,
        lastResult: "wrong",
        lastAttemptAt: today,
        lastWrongAt: today,
        modeStats: {},
      },
      "health-0002": {
        itemId: "health-0002",
        totalAttempts: 2,
        correctCount: 2,
        wrongCount: 0,
        lastResult: "correct",
        lastAttemptAt: yesterday,
        modeStats: {},
      },
    },
    journal: [
      { itemId: "health-0001", at: today, correct: false, mode: "health_recall", durationMs: 4200 },
      { itemId: "health-0002", at: yesterday, correct: true, mode: "health_recall", durationMs: 1200 },
    ],
  });

  const stats = await service.getStudyStats({ subjects: ["health"] });
  assert.equal(stats.overall.attempts, 6);
  assert.equal(stats.overall.correct, 3);
  assert.equal(stats.overall.accuracy, 0.5);
  assert.equal(stats.overall.studiedQuestions, 2);
  const health = stats.bySubject.find((group) => group.subject === "health");
  assert.equal(health.attempts, 6);

  const mistakes = await service.getRecentMistakes({ days: 1 });
  assert.equal(mistakes.source, "journal");
  assert.equal(mistakes.questions.length, 1);
  assert.equal(mistakes.questions[0].id, "health-0001");

  const history = await service.getStudyHistory({ days: 7 });
  assert.equal(history.available, true);
  assert.equal(history.entries.length, 2);
  assert.equal(history.entries[0].questionId, "health-0001");
  assert.equal(history.entries[0].correct, false);
  assert.equal(history.entries[0].mode, "health_recall");
  assert.ok(history.entries[0].question, "問題文も一緒に返る");

  const wrongOnly = await service.getStudyHistory({ days: 7, onlyWrong: true });
  assert.equal(wrongOnly.entries.length, 1);
});

test("1問ごとの記録が無くても、最後に間違えた日時から拾える", async () => {
  const service = newService();
  const today = Date.parse("2026-09-11T10:00:00+09:00");
  await service.saveHistorySnapshot({
    records: {
      "health-0001": {
        itemId: "health-0001", totalAttempts: 1, correctCount: 0, wrongCount: 1,
        lastResult: "wrong", lastAttemptAt: today, lastWrongAt: today, modeStats: {},
      },
    },
  });
  const mistakes = await service.getRecentMistakes({ days: 1 });
  assert.equal(mistakes.source, "history");
  assert.equal(mistakes.questions[0].id, "health-0001");

  const history = await service.getStudyHistory({});
  assert.equal(history.available, false);
  assert.match(history.note, /AI連携を有効/);
});

test("履歴で絞り込める（間違えた問題だけを一覧する）", async () => {
  const service = newService();
  await service.saveHistorySnapshot({
    records: {
      "health-0001": {
        itemId: "health-0001", totalAttempts: 3, correctCount: 1, wrongCount: 2,
        lastResult: "wrong", lastAttemptAt: 1, lastWrongAt: 1, modeStats: {},
      },
    },
  });
  const wrong = await service.listQuestions({ performance: "wrong", limit: 10 });
  assert.equal(wrong.total, 1);
  assert.equal(wrong.questions[0].id, "health-0001");
  assert.equal(wrong.questions[0].study.wrong, 2);

  const unanswered = await service.listQuestions({ performance: "unanswered", limit: 1 });
  assert.equal(unanswered.total, 2162);
});

test("教科ごとの範囲は、wordsの画面が知っている値と同じ", async () => {
  const service = newService();
  const info = await service.getAppInfo();
  for (const [subject, config] of Object.entries(SUBJECTS)) {
    assert.deepEqual(info.subjects[subject].ranges, config.ranges);
  }
});

test("AIが追加した問題は、wordsの出題処理でそのまま問題になる", async () => {
  const { buildQuestion, buildSession, generateChoices, recallChoicesFor, recallCorrectChoiceFor } =
    await import("../src/logic.js");
  const service = newService();

  await service.addQuestions({
    subject: "english",
    questions: [{ question: "serendipity", answer: "偶然の幸運", range: "Mars", type: "word", importance: "S" }],
  }, actor);
  await service.addQuestions({ subject: "public", questions: [publicQuestion] }, actor);
  await service.addQuestions({
    subject: "health",
    questions: [{ question: "健康のテスト問題を何というか。", answer: "テスト", range: "p.12–13" }],
  }, actor);
  await service.addQuestions({
    subject: "kobun-vocab",
    questions: [{ question: "あはれなり", answer: "しみじみと趣がある", range: "伊勢物語 芥川", point: "情趣を表す" }],
  }, actor);

  const { items } = await service.resolveItems();
  const english = items.filter((item) => (item.subject ?? "english") === "english");
  const added = english.find((item) => item.english === "serendipity");

  // 4択・入力・フラッシュカードのどの形式でも問題を組み立てられる。
  for (const mode of ["en_to_ja_choice", "ja_to_en_choice", "ja_to_en_input", "spelling_input"]) {
    const question = buildQuestion(added, mode, english, () => 0.5);
    assert.ok(question, `${mode} の問題が作れる`);
    assert.ok(question.prompt, `${mode} に問題文がある`);
  }
  // 4択の選択肢は、ほかの問題から重複なく作られる。
  const choices = generateChoices(added, "en_to_ja_choice", english, () => 0.5);
  assert.equal(new Set(choices).size, choices.length);

  // 公共の4択は、渡した選択肢と正解がそのまま使われる。
  const publicItem = items.find((item) => item.publicAnswer === publicQuestion.answer && item.aiAdded);
  assert.deepEqual(recallChoicesFor(publicItem), Object.values(publicQuestion.choices));
  assert.equal(recallCorrectChoiceFor(publicItem), publicQuestion.answer);

  // 古文単語カードは、用例の下線データまで組み上がっている。
  const vocabItem = items.find((item) => item.aiAdded && item.subject === "kobun-vocab");
  assert.equal(vocabItem.recallQuestion, "あはれなり");
  assert.equal(vocabItem.recallAnswer, "しみじみと趣がある");
  assert.equal(vocabItem.termMarked, true);
  assert.equal(vocabItem.exampleLines[0].parts.map((part) => part.text).join(""), "あはれなり");

  // 一問一答のセットにも、追加した問題が混ざって出てくる。
  const healthItems = items.filter((item) => item.subject === "health");
  const session = buildSession({
    items: healthItems,
    history: new Map(),
    selectedModes: ["health_recall"],
    count: "all",
    rng: () => 0.5,
  });
  assert.equal(session.length, healthItems.length, "追加した問題も含めて全部が出題対象になる");
  assert.ok(session.some((entry) => entry.item.aiAdded), "AIが追加した問題も出題される");
});
