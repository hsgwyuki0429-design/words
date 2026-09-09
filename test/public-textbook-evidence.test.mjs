import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const items = JSON.parse(readFileSync(new URL("../data/public-items.json", import.meta.url), "utf8"));
const functionSource = (name) => source.match(new RegExp(`function ${name}\\([^]*?\\n}`))[0];
const context = vm.createContext({ state: { settings: { showSources: false }, session: { answered: true } }, isKobunVocabSubject: () => false, answersForMode: (item) => [item.publicAnswer] });
for (const name of ["escapeHtml", "recallExplanation", "markTextbookQuote", "renderTextbookEvidence", "recallCardBody", "renderFeedback"]) vm.runInContext(functionSource(name), context);

test("公共全207問の答え面に教科書の位置・すべての抜粋・注記を表示する", () => {
  assert.equal(items.length, 207);
  for (const item of items) {
    assert.ok(item.sourceDetail);
    assert.ok(item.editorial.evidenceQuotes.length);
    context.item = item;
    for (const expression of [
      'recallCardBody({ item, prompt: item.publicQuestion, answer: item.publicAnswer }, true)',
      'renderFeedback({ item, mode: "public_choice" }, "", false)',
    ]) {
      const html = vm.runInContext(expression, context);
      for (const text of [item.sourceDetail, ...item.editorial.evidenceQuotes, item.editorial.evidenceNote].filter(Boolean)) {
        context.text = text;
        assert.ok(html.replaceAll(/<\/?mark>/g, "").includes(vm.runInContext("escapeHtml(text)", context)), `${item.id}: ${text}`);
      }
      assert.ok(html.indexOf("<blockquote>") < html.indexOf('<p class="textbook-evidence-source">'));
      assert.doesNotMatch(html, /教科書の該当箇所/);
    }
    assert.doesNotMatch(vm.runInContext('recallCardBody({ item, prompt: item.publicQuestion }, false)', context), /textbook-evidence/);
  }
});

test("抜粋の正答語だけをマークし、長い別名を分断せず、本文を保つ", () => {
  context.item = { publicAnswer: "社会的ジレンマ", acceptedAnswers: ["ジレンマ"], editorial: { choices: { A: "社会的ジレンマ", B: "協働" }, correctChoice: "A" } };
  const html = vm.runInContext('markTextbookQuote("協働と社会的ジレンマ。<引用>", item)', context);
  assert.equal(html, "協働と<mark>社会的ジレンマ</mark>。&lt;引用&gt;");
  assert.equal(vm.runInContext('markTextbookQuote("一致しない抜粋", item)', context), "一致しない抜粋");
});

test("抜粋をHTMLとして解釈せず、他教科や未収録データには空欄を追加しない", () => {
  context.item = { subject: "public", sourceDetail: '<img src=x onerror="alert(1)">', editorial: { evidenceQuotes: ["<script>test</script>", "", null], evidenceNote: "A & B" } };
  const html = vm.runInContext("renderTextbookEvidence(item)", context);
  assert.doesNotMatch(html, /<img|<script>/);
  assert.match(html, /&lt;script&gt;test&lt;\/script&gt;/);
  assert.match(html, /A &amp; B/);
  for (const item of [{ subject: "health", sourceDetail: "出典" }, { subject: "public" }]) {
    context.item = item;
    assert.equal(vm.runInContext("renderTextbookEvidence(item)", context), "");
  }
});
