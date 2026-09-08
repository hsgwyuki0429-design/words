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

test("解説を足してもカードの大きさは変えず、文字を縮めて収める", () => {
  const rule = stylesSource.slice(
    stylesSource.indexOf(".public-recall-card:not(.vocab-recall-card) {"),
    stylesSource.indexOf(".public-recall-card:not(.vocab-recall-card)[data-density"),
  );
  // 高さは今までのカードと同じ。あふれる分は文字の大きさと行間で吸収する。
  assert.match(rule, /height:\s*min\(64dvh, 620px\);/);
  assert.match(rule, /overflow:\s*hidden;/);
  assert.match(stylesSource, /\.public-recall-card:not\(\.vocab-recall-card\) h1 \{[^}]*var\(--recall-scale\)/);
  assert.match(stylesSource, /\.public-recall-card:not\(\.vocab-recall-card\) \.public-recall-explanation p \{[^}]*var\(--recall-scale\)/);
  // 解説の中だけをスクロールさせる作りは残さない（文の途中で切れて見えなくなるため）。
  assert.doesNotMatch(stylesSource, /\.public-recall-explanation\.is-scrollable/);
  assert.doesNotMatch(appSource, /markScrollableExplanation/);
});

test("はみ出す分だけ縮め、収まっているカードは今までの大きさのまま出す", () => {
  assert.match(appSource, /fitRecallCard\("\.public-recall-card", "--recall-scale"\)/);
  assert.match(appSource, /fitRecallCard\("\.vocab-recall-card", "--vocab-scale"\)/);
  // 文字の大きさは今までと同じ値から始める（入りきる問題は縮めない）。
  assert.match(
    stylesSource,
    /\.public-recall-card:not\(\.vocab-recall-card\) h1 \{[^}]*clamp\(1\.55rem, 5vw, 2\.8rem\) \* var\(--recall-scale\)/,
  );
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
