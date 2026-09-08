import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  UNKNOWN_CHOICE,
  buildQuestion,
  exactStudyMode,
  normalizeStudySelection,
  studyModeForItem,
} from "../src/logic.js";

const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const publicItems = JSON.parse(
  readFileSync(new URL("../data/public-items.json", import.meta.url), "utf8"),
);

test("公共のデータは全問に解説を持つ", () => {
  for (const item of publicItems) {
    const explanation = item.explanation ?? item.editorial?.explanation ?? "";
    assert.ok(explanation.trim().length > 0, `${item.id}: 解説が必要`);
  }
});

test("解説は編集原稿側に入っていても拾う", () => {
  assert.match(appSource, /item\.explanation \?\? item\.editorial\?\.explanation \?\? ""/);
});

test("一問一答の答え面に解説を出す", () => {
  assert.match(appSource, /class="public-recall-explanation"/);
});

test("解説を足してもカードの大きさは変えない", () => {
  const rule = stylesSource.slice(
    stylesSource.indexOf(".public-recall-card:not(.vocab-recall-card) {"),
    stylesSource.indexOf(".public-recall-card:not(.vocab-recall-card) .public-recall-meta"),
  );
  // 高さは今までのカードと同じ。あふれる分は文字の大きさと行間で吸収する。
  assert.match(rule, /height:\s*min\(64dvh, 620px\);/);
  assert.match(rule, /overflow:\s*hidden;/);
  // 解説の中だけをスクロールさせる作りは残さない（文の途中で切れて見えなくなるため）。
  assert.doesNotMatch(stylesSource, /\.public-recall-explanation\.is-scrollable/);
  assert.doesNotMatch(appSource, /markScrollableExplanation/);
});

test("問題文・答え・解説はどれも同じ文字の大きさで並べる", () => {
  for (const selector of [
    "h1",
    ".public-recall-answer strong",
    ".public-recall-explanation p",
  ]) {
    const head = `.public-recall-card:not(.vocab-recall-card) ${selector} {`;
    const rule = stylesSource.slice(
      stylesSource.indexOf(head),
      stylesSource.indexOf("}", stylesSource.indexOf(head)),
    );
    assert.match(rule, /font-size:\s*var\(--recall-text\);/, `${selector} も共通の大きさを使う`);
  }
});

test("入りきらないカードだけ、はみ出す分を縮めて収める", () => {
  assert.match(appSource, /fitRecallCard\("\.public-recall-card", "--recall-scale"\)/);
  assert.match(appSource, /fitRecallCard\("\.vocab-recall-card", "--vocab-scale"\)/);
});

test("公共の4択は教科書の選択肢をそのまま使う", () => {
  const item = publicItems[0];
  const question = buildQuestion(item, "public_choice", publicItems, () => 0);
  assert.equal(question.choices.length, 5, "4つの選択肢と「わからない」");
  assert.equal(question.choices.at(-1), UNKNOWN_CHOICE);
  assert.deepEqual(
    [...question.choices].slice(0, 4).sort(),
    Object.values(item.editorial.choices).sort(),
  );
  assert.ok(question.choices.includes(question.correctChoice));
});

test("答えに別名を併記した問題でも、正解の選択肢を取り違えない", () => {
  // 「間接民主制（代表制民主主義）」のように、答えの表記と選択肢の表記が違う問題がある。
  const aliased = publicItems.filter(
    (item) => !Object.values(item.editorial.choices).includes(item.publicAnswer),
  );
  assert.ok(aliased.length > 0, "表記が違う問題が実データにある");
  for (const item of aliased) {
    const question = buildQuestion(item, "public_choice", publicItems, () => 0);
    assert.equal(question.correctChoice, item.editorial.choices[item.editorial.correctChoice]);
    assert.ok(question.choices.includes(question.correctChoice), `${item.id}: 正解が選択肢にない`);
  }
});

test("公共では出題方法として4択も選べる", () => {
  assert.deepEqual(
    normalizeStudySelection({ subject: "public", content: "term", method: "choice" }).method,
    "choice",
  );
  assert.equal(exactStudyMode({ subject: "public", content: "term", method: "choice" }), "public_choice");
  assert.equal(
    studyModeForItem(publicItems[0], { subject: "public", content: "term", method: "choice" }),
    "public_choice",
  );
  // 選択肢を持たない保健は今までどおり一問一答だけ。
  assert.equal(normalizeStudySelection({ subject: "health", content: "term", method: "choice" }).method, null);
});

test("4択も同じ文字の大きさでそろえ、1画面に収める", () => {
  // 問題文・選択肢・解説は共通の大きさ。
  for (const selector of [
    ".swipe-choice-card h1",
    ".choice-button strong",
    ".feedback-explanation p",
  ]) {
    const head = `.quiz-choice ${selector} {`;
    const at = stylesSource.lastIndexOf(head);
    const rule = stylesSource.slice(at, stylesSource.indexOf("}", at));
    assert.match(rule, /font-size:\s*var\(--choice-text\);/, `${selector} も共通の大きさを使う`);
  }
  // 端末別の上書きより後ろに置き、確実に効かせる。
  assert.ok(
    stylesSource.lastIndexOf(".quiz-choice .swipe-choice-card h1 {")
      > stylesSource.lastIndexOf(".quiz-answered .swipe-choice-card h1"),
    "端末別の指定より後ろで定義する",
  );
  // 収まらない画面では、答え合わせまで含めて縮めて収める。
  assert.match(appSource, /function fitChoiceScreen\(\)/);
  assert.match(appSource, /if \(isChoice\) fitChoiceScreen\(\);/);
  assert.match(appSource, /document\.documentElement\.scrollHeight - window\.innerHeight/);
});
