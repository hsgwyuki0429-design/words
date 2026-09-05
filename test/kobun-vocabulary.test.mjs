import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  KOBUN_VOCAB_RANGE_ORDER,
  MODE_LABELS,
  TYPE_LABELS,
  buildQuestion,
  vocabCardDensity,
  vocabExampleSegments,
  isRecallSubjectId,
  normalizeStudySelection,
  rangeOrderForSubject,
  sortItems,
  studyTargetsForDashboard,
} from "../src/logic.js";

const vocabulary = JSON.parse(
  readFileSync(new URL("../data/kobun-vocabulary.json", import.meta.url), "utf8"),
).items;
const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const kobunSource = readFileSync(new URL("../src/kobun.js", import.meta.url), "utf8");

const byId = (id) => vocabulary.find((item) => item.id === id);

test("古文単語は公共・保健と同じ自己採点カードとして扱う", () => {
  assert.ok(isRecallSubjectId("kobun-vocab"));
  assert.equal(MODE_LABELS["kobun-vocab_recall"], "古文単語 重要語句");
  assert.equal(TYPE_LABELS["kobun-vocab-term"], "重要語句");
  assert.deepEqual(rangeOrderForSubject("kobun-vocab"), KOBUN_VOCAB_RANGE_ORDER);
  const selection = normalizeStudySelection({ subject: "kobun-vocab", content: "term", method: "recall" });
  assert.equal(selection.subject, "kobun-vocab");
  assert.equal(selection.method, "recall");
});

test("重要語句の学習カードは作品順に1種類だけ並ぶ", () => {
  const groups = studyTargetsForDashboard({ subject: "kobun-vocab", contents: ["term"] });
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].cards.map((card) => card.key), ["kobun-vocab:term"]);
  assert.equal(groups[0].cards[0].mode, "kobun-vocab_recall");
  assert.equal(groups[0].cards[0].title, "重要語句");
  assert.deepEqual(groups[0].cards[0].types, ["kobun-vocab-term"]);
});

test("カードの表は本文中の用例、裏は本文中での意味になる", () => {
  const item = byId("kobun:vocab:0001");
  const question = buildQuestion(item, "kobun-vocab_recall", vocabulary);
  assert.equal(question.prompt, item.example);
  assert.equal(question.answer, item.japanese);
  assert.equal(question.instruction, "tap");
});

test("用例は下線を引く区間へ分かれ、つなげると本文にもどる", () => {
  const item = byId("kobun:vocab:0012");
  const [line] = vocabExampleSegments(item);
  assert.equal(line.parts.map((part) => part.text).join(""), item.example);
  assert.ok(line.parts.some((part) => part.mark), "語句にあたる区間へ下線を引く");
  assert.ok(
    line.parts.filter((part) => !part.mark).length >= 1,
    "用例のうち語句以外は下線を引かない",
  );
});

test("ふりがなは読みをもとに漢字のかたまりへ振る", () => {
  // 「率て行きければ」＝「ゐてゆきければ」。送り仮名にはふりがなを付けない。
  const parts = vocabExampleSegments(byId("kobun:vocab:0012"))[0].parts;
  const ruby = Object.fromEntries(
    parts.filter((part) => part.reading).map((part) => [part.text, part.reading]),
  );
  assert.deepEqual(ruby, { "率": "ゐ", "行": "ゆ" });
  // ひらがなだけの語句には、読みが同じであればふりがなを付けない。
  assert.ok(
    vocabExampleSegments(byId("kobun:vocab:0009")).every(
      (line) => line.parts.every((part) => !part.reading),
    ),
    "「かひなし」のような読みが同じ語句にはふりがなを付けない",
  );
});

test("用例が並記されている語句は、用例ごとに下線を引く", () => {
  // 「をり／ゐたり」＝「戸口にをり」「思ひつつゐたりけるに」。
  const lines = vocabExampleSegments(byId("kobun:vocab:0018"));
  assert.equal(lines.length, 2);
  for (const line of lines) {
    assert.ok(line.parts.some((part) => part.mark), "どちらの用例にも下線を引く");
  }
});

test("カードの大きさは変えず、文字量が多いカードだけ文字を縮める", () => {
  const short = byId("kobun:vocab:0001");
  assert.equal(vocabCardDensity(short, false), "roomy");
  assert.equal(vocabCardDensity(short, true), "normal");
  // 掛詞・縁語をまとめた最長のポイントは、裏返したときだけ最小の段階になる。
  const longest = byId("kobun:vocab:0042");
  assert.notEqual(vocabCardDensity(longest, false), "compact");
  assert.equal(vocabCardDensity(longest, true), "compact");
  const densities = new Set(vocabulary.map((item) => vocabCardDensity(item, true)));
  assert.ok([...densities].every((density) => ["roomy", "normal", "dense", "compact"].includes(density)));
  assert.match(stylesSource, /\.vocab-recall-card \{[^}]*height: min\(620px, max\(64dvh, 100dvh - 176px\)\);/);
  assert.match(stylesSource, /\.vocab-recall-card\[data-density="compact"\] \{ --vocab-scale: 0\.63; \}/);
});

test("難易度は教材にないので、難易度順の並び替えでも順番が入れ替わらない", () => {
  const sample = vocabulary.slice(0, 20);
  assert.ok(sample.every((item) => item.difficulty === "—"));
  const sorted = sortItems(sample, new Map(), "difficulty-level-desc", () => 0.5);
  assert.deepEqual(sorted.map((item) => item.id), sample.map((item) => item.id));
  // 並び替えの選択画面では、一問一答と同じく「難易度順」を出さない。
  assert.match(appSource, /\.\.\.\(!isRecallSubject\(\)\s*\n\s*\? \[\{ key: "difficulty-level-desc"/);
});

test("作品の順に範囲を並べ、範囲名は作品名になる", () => {
  assert.deepEqual([...new Set(vocabulary.map((item) => item.range))], KOBUN_VOCAB_RANGE_ORDER);
  const shuffled = [vocabulary.at(-1), vocabulary[0]];
  assert.deepEqual(
    sortItems(shuffled, new Map(), "range").map((item) => item.range),
    [KOBUN_VOCAB_RANGE_ORDER[0], KOBUN_VOCAB_RANGE_ORDER.at(-1)],
  );
});

test("カードの裏には意味・覚えるポイント・範囲を出す", () => {
  assert.match(appSource, /<span class="vocab-answer-label">本文中での意味<\/span>/);
  assert.match(appSource, /<span class="vocab-point-label">覚えるポイント<\/span>/);
  assert.match(appSource, /class="public-recall-source vocab-range">\$\{escapeHtml\(item\.work \?\? item\.range\)\}/);
  // 用例のうち語句が見つからなかったカードだけ、表に語句そのものを添える。
  assert.match(appSource, /item\.termMarked === false/);
  assert.match(appSource, /<ruby>\$\{escapeHtml\(part\.text\)\}<rt>\$\{escapeHtml\(part\.reading\)\}<\/rt><\/ruby>/);
  assert.match(appSource, /part\.mark \? `<span class="vocab-term">/);
});

test("古文の「古文単語」から学習画面へ進む", () => {
  // 教科選択には古文だけを置き、古文単語はその中から開く。
  assert.doesNotMatch(indexSource, /data-subject="classic"/);
  assert.match(kobunSource, /new CustomEvent\("kobun-vocabulary"/);
  // 古文のホームに作品が並んでいるので、選んだ作品をそのまま学習範囲にする。
  assert.match(kobunSource, /detail: \{ range: target\.dataset\.kbRange \?\? null \}/);
  assert.match(appSource, /"kobun-vocabulary", \(event\) => \{/);
  assert.match(appSource, /selectSubject\("kobun-vocab"\);/);
  assert.match(appSource, /state\.filters\.ranges = range \? \[range\] : dashboardRanges\(\);/);
  assert.match(appSource, /fetch\("\.\/data\/kobun-vocabulary\.json/);
  assert.match(appSource, /state\.kobunVocabItems = \(await vocabResponse\.json\(\)\)\.items;/);
});
