import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { quizGesturePolicy } from "../src/quiz-gestures.js";

const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const functionSource = (name) => source.match(new RegExp(`function ${name}\\([^]*?\\n}`))[0];

test("公共の回答済みカードはタップとスワイプを区別し、移動中は操作を止める", () => {
  assert.equal(quizGesturePolicy({ mode: "public_choice" }).tapEnabled, false);
  const policy = quizGesturePolicy({ mode: "public_choice", answered: true });
  assert.equal(policy.tapEnabled, true);
  assert.deepEqual(policy.allowedDirections, ["left", "right", "up", "down"]);
  assert.equal(quizGesturePolicy({ mode: "en_to_ja_choice", answered: true }).tapEnabled, false);
  assert.equal(quizGesturePolicy({ mode: "public_choice", answered: true, isTransitioning: true }).tapEnabled, false);
});

test("表裏を何度切り替えても回答・採点・進捗を変えない", () => {
  const session = { currentQuestion: { mode: "public_choice" }, answered: true, currentAnswer: "選択B", results: [{ correct: false }], cursor: 3 };
  let renders = 0;
  const context = vm.createContext({ haptics: { trigger() {} }, state: { session }, currentQuizGesturePolicy: () => quizGesturePolicy({ mode: "public_choice", answered: true }), renderQuiz: () => renders++ });
  vm.runInContext(functionSource("toggleRecallFace"), context);
  for (let i = 0; i < 6; i++) {
    vm.runInContext("toggleRecallFace()", context);
    assert.equal(session.choiceQuestionVisible, i % 2 === 0);
    assert.equal(session.currentAnswer, "選択B");
    assert.equal(session.results.length, 1);
    assert.equal(session.cursor, 3);
  }
  assert.equal(renders, 6);
});

test("公共の答え面は正誤・模範回答・解説を表示し、問題面は選択した回答を明示する", () => {
  const context = vm.createContext({ state: { session: { answered: true } }, answersForMode: () => ["模範の用語"], recallExplanation: () => "用語の解説", escapeHtml: (s) => s, normalizeAnswer: (s) => s, UNKNOWN_CHOICE: "わからない" });
  vm.runInContext(functionSource("renderTextbookEvidence") + functionSource("renderFeedback") + functionSource("renderChoiceArea"), context);
  for (const correct of [true, false]) {
    context.question = { mode: "public_choice", item: {}, choices: ["選択A", "選択B", "選択C", "選択D", "わからない"], correctChoice: "選択A" };
    context.answer = correct ? "選択A" : "選択B";
    context.correct = correct;
    const back = vm.runInContext("renderFeedback(question, answer, correct)", context);
    assert.match(back, /模範回答/);
    assert.match(back, /模範の用語/);
    assert.match(back, /用語の解説/);
    assert.doesNotMatch(back, /choice-list|source-box/);
    const front = vm.runInContext("renderChoiceArea(question, true, answer)", context);
    assert.equal((front.match(/あなたの回答/g) ?? []).length, 1);
    assert.ok(front.includes(`${context.answer}<small`));
  }
});
