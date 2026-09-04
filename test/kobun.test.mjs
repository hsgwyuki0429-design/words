import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CONJUGATION_FORMS, KOBUN_MODES, allMeaningOptions, buildBaseQuestions,
  gradeConjugation, gradeQuestion, gradeSet, questionsForMode, restoreKobunSession,
  summarizeKobun, toggleForm, validateAuxiliaries, validateVocabulary,
} from "../src/kobun-logic.js";
import { mergeAttempt } from "../src/logic.js";

const master = JSON.parse(readFileSync(new URL("../data/kobun-auxiliaries.json", import.meta.url), "utf8"));
const items = master.items;
const find = (key) => items.find((item) => item.id === `kobun:aux:${key}`);

test("28種のマスターは古文専用のIDと全6活用形の配列を保持する", () => {
  assert.equal(validateAuxiliaries(items).length, 28);
  const existing = ["items", "public-items", "health-items"].flatMap((name) => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), "utf8")));
  assert.ok(items.every((item) => !existing.some((entry) => entry.id === item.id)));
  assert.deepEqual(find("keri").conjugation.連用形, []);
  assert.deepEqual(find("zu").conjugation.連体形, ["ぬ", "ざる"]);
  const invalid = structuredClone(items);
  invalid[0].conjugation.未然形 = "れ";
  assert.throws(() => validateAuxiliaries(invalid));
});

test("原本のセルと監査差分を残し、誤った活用・接続を出題しない", () => {
  assert.deepEqual(find("kemu").connections, ["連用形"]);
  assert.deepEqual(find("meri").conjugation.未然形, []);
  assert.deepEqual(find("nari-hearsay").conjugation.未然形, []);
  assert.deepEqual(find("tari-copula").connections, ["体言"]);
  assert.deepEqual(find("tashi").conjugation.連用形, ["たく", "たかり"]);
  assert.deepEqual(find("tashi").conjugation.連体形, ["たき", "たかる"]);
  assert.equal(find("kemu").source.values[0], "終止形※");
  assert.ok(items.every((item) => item.source.range && item.audit.every((audit) => audit.url && audit.reason)));
});

test("接続・意味問題は基本形から生成し、意味は全候補・全正解を使う", () => {
  for (const mode of ["kobun_connection", "kobun_meaning"]) {
    const questions = questionsForMode(items, mode);
    assert.equal(questions.length, items.length);
    assert.ok(questions.every((question) => question.item.base && !question.surface));
  }
  const question = questionsForMode(items, "kobun_meaning").find((q) => q.item.base === "む");
  assert.deepEqual(question.item.meanings, ["推量", "意志", "適当", "勧誘", "仮定", "婉曲"]);
  assert.equal(gradeQuestion(question, ["推量"]).complete, false);
  assert.equal(gradeQuestion(question, [...question.item.meanings].reverse()).complete, true);
  assert.ok(items.every((item) => item.meanings.every((meaning) => allMeaningOptions(items).includes(meaning))));
  const ri = questionsForMode(items, "kobun_connection").find((q) => q.item.base === "り");
  assert.equal(gradeQuestion(ri, ["サ変未然形"]).status, "partial");
  assert.equal(gradeQuestion(ri, ["四段已然形", "サ変未然形"]).complete, true);
});

test("正しく選択・選び忘れ・誤選択をそれぞれ返す", () => {
  const grade = gradeSet(["過去", "完了"], ["過去", "詠嘆"]);
  assert.deepEqual(grade.correct, ["過去"]);
  assert.deepEqual(grade.missing, ["詠嘆"]);
  assert.deepEqual(grade.incorrect, ["完了"]);
  assert.equal(grade.status, "incorrect");
});

test("活用なしの○と空欄は違い、複数の活用は順不同ですべて必要", () => {
  const correct = ["けら", "○", "けり", "ける", "けれ", "○"];
  assert.equal(gradeConjugation(correct, find("keri").conjugation).complete, true);
  correct[1] = "";
  assert.equal(gradeConjugation(correct, find("keri").conjugation).complete, false);
  const zu = CONJUGATION_FORMS.map((form) => [...find("zu").conjugation[form]].reverse().join("／"));
  assert.equal(gradeConjugation(zu, find("zu").conjugation).complete, true);
  zu[0] = "ざら";
  assert.equal(gradeConjugation(zu, find("zu").conjugation).cells[0].status, "partial");
  zu[0] = "ざら／ざら／ず";
  assert.equal(gradeConjugation(zu, find("zu").conjugation).complete, false);
  assert.deepEqual(toggleForm(["けら"], "○"), ["○"]);
  assert.deepEqual(toggleForm(["○"], "けら"), ["けら"]);
  assert.deepEqual(toggleForm(["○"], "○"), []);
});

test("せ・未然形はきとすを自動検出し、順不同・一部正解・重複を採点する", () => {
  const question = buildBaseQuestions(items).find((q) => q.surface === "せ" && q.form === "未然形");
  assert.deepEqual(new Set(question.answers), new Set(["き", "す"]));
  assert.equal(gradeQuestion(question, ["き", "す"]).complete, true);
  assert.equal(gradeQuestion(question, ["す", "き"]).complete, true);
  assert.equal(gradeQuestion(question, ["き", ""]).status, "partial");
  assert.equal(gradeQuestion(question, ["き", "き"]).status, "incorrect");
  assert.equal(gradeQuestion(question, ["き", "けり"]).status, "incorrect");
  assert.ok(buildBaseQuestions(items).every((q) => q.surface !== "○" && q.answers.length > 0));
});

test("同じ基本形の同音語は入力欄を増やさず、該当する全助動詞を保持する", () => {
  const question = buildBaseQuestions(items).find((q) => q.surface === "たら" && q.form === "未然形");
  assert.deepEqual(question.answers, ["たり"]);
  assert.equal(question.itemIds.length, 2);
  const mu = buildBaseQuestions(items).find((q) => q.surface === "め" && q.form === "已然形");
  assert.equal(gradeQuestion(mu, ["ん"]).complete, true);
  assert.equal(gradeQuestion(mu, ["む", "ん"]).complete, false);
});

test("マスター追加時にも同形の正解が増え、同じ表記の別活用形は混ざらない", () => {
  const added = structuredClone(find("keri"));
  added.id = "kobun:aux:test";
  added.base = "試験用";
  added.conjugation.未然形 = ["せ"];
  const questions = buildBaseQuestions([...items, added]);
  assert.equal(questions.find((q) => q.surface === "せ" && q.form === "未然形").answers.length, 3);
  assert.deepEqual(questions.find((q) => q.surface === "せ" && q.form === "連用形").answers, ["す"]);
});

test("5形式の履歴・集計は独立し、英語・公共・保健を集計に含めない", () => {
  const history = new Map();
  for (const [index, mode] of Object.keys(KOBUN_MODES).entries()) {
    const question = questionsForMode(items, mode)[0];
    history.set(question.id, mergeAttempt(history.get(question.id), { itemId: question.id, mode, correct: index % 2 === 0 }));
  }
  history.set("english-1", mergeAttempt(null, { itemId: "english-1", mode: "en_to_ja_choice", correct: true }));
  for (const [index, mode] of Object.keys(KOBUN_MODES).entries()) {
    const summary = summarizeKobun(items, history, mode);
    assert.equal(summary.attempts, 1);
    assert.equal(summary.answered, 1);
    assert.equal(summary.correct, index % 2 === 0 ? 1 : 0);
  }
});

test("途中の回答・採点済み状態を復元し、存在しない問題IDは除外する", () => {
  const questions = questionsForMode(items, "kobun_connection");
  const session = { queue: [questions[0].id, questions[1].id], index: 1, draft: ["未然形"], results: [], feedback: { complete: true } };
  const restored = restoreKobunSession(JSON.parse(JSON.stringify(session)), questions);
  assert.equal(restored.index, 1);
  assert.deepEqual(restored.draft, ["未然形"]);
  assert.equal(restored.feedback.complete, true);
  assert.equal(restoreKobunSession({ queue: ["unknown"] }, questions).queue.length, 0);
});

test("古文単語は英語フィールドなしで複数の意味とメタデータを保持できる", () => {
  const word = { id: "kobun:vocab:aware", subject: "kobun-vocab", category: "vocabulary", headword: "あはれなり", meanings: ["しみじみと心を動かされる", "趣深い", "気の毒だ"], reading: "あはれなり", partOfSpeech: "形容動詞", conjugationType: "ナリ活用", importance: "S", ranges: ["教材1"], sources: [] };
  assert.equal(validateVocabulary([word])[0].meanings.length, 3);
  assert.throws(() => validateVocabulary([{ ...word, meanings: "趣深い" }]));
});

test("バーは回答回数ではなく問題数で進み、直近の誤答と別形式を区別する", () => {
  const id = find("keri").id;
  const history = new Map();
  for (let index = 0; index < 3; index += 1) history.set(id, mergeAttempt(history.get(id), { itemId: id, mode: "kobun_meaning", correct: true }));
  assert.equal(summarizeKobun(items, history, "kobun_meaning").answered, 1);
  assert.equal(summarizeKobun(items, history, "kobun_meaning").correctItems, 1);
  assert.equal(summarizeKobun(items, history, "kobun_connection").answered, 0);
  history.set(id, mergeAttempt(history.get(id), { itemId: id, mode: "kobun_meaning", correct: false }));
  assert.equal(summarizeKobun(items, history, "kobun_meaning").answered, 1);
  assert.equal(summarizeKobun(items, history, "kobun_meaning").correctItems, 0);
});
