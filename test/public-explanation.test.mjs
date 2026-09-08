import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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

test("解説はカードからはみ出さないよう高さを抑えて中でスクロールする", () => {
  const rule = stylesSource.slice(
    stylesSource.indexOf(".public-recall-explanation {"),
    stylesSource.indexOf(".public-recall-explanation.is-scrollable"),
  );
  assert.match(rule, /max-height:\s*min\(22dvh, 190px\);/);
  assert.match(rule, /overflow-y:\s*auto;/);
});

test("スクロールできる解説の中ではスワイプ採点を働かせない", () => {
  assert.match(appSource, /explanation\.setAttribute\("data-quiz-gesture-ignore", ""\)/);
  assert.match(appSource, /markScrollableExplanation\(\);/);
});
