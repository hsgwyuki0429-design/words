import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  INFO_RANGE_ORDER,
  buildQuestion,
  isRecallChoiceMode,
  isRecallSubjectId,
  itemMatchesRange,
  rangeOrderForSubject,
  recallChoicesFor,
  recallCorrectChoiceFor,
  studyTargetsForDashboard,
} from "../src/logic.js";
import { SUBJECTS } from "../server/service/subjects.js";
import { buildQuestion as buildServerQuestion } from "../server/service/question-input.js";

const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const swSource = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const items = JSON.parse(readFileSync(new URL("../data/info-2026-3.json", import.meta.url), "utf8"));

test("情報は公共と同じく、一問一答と教材の選択肢の4択で学習する", () => {
  assert.ok(isRecallSubjectId("info"));
  assert.ok(isRecallChoiceMode("info_choice"));
  assert.ok(isRecallChoiceMode("public_choice"));
  assert.equal(isRecallChoiceMode("info_recall"), false);
  assert.equal(isRecallChoiceMode("en_to_ja_choice"), false);
  const modes = studyTargetsForDashboard({ subject: "info", contents: ["term"] })
    .flatMap((group) => group.cards).map((card) => card.mode);
  assert.deepEqual(modes.sort(), ["info_choice", "info_recall"]);
});

test("範囲は章ごとで、2冊の問題集を章でまとめている", () => {
  assert.deepEqual(rangeOrderForSubject("info"), INFO_RANGE_ORDER);
  assert.deepEqual([...new Set(items.map((item) => item.range))], INFO_RANGE_ORDER);
  // 第1章の問題集（Q001〜Q152）と第2・3章の問題集（Q153〜）が、章の境目でつながる。
  const chapterOf = (number) => items.find((item) => item.number === number).range;
  assert.equal(chapterOf(152), "第1章 情報社会");
  assert.equal(chapterOf(153), "第2章 メディアとデザイン");
  assert.equal(chapterOf(212), "第2章 メディアとデザイン");
  assert.equal(chapterOf(213), "第3章 ネットワークとデータの活用");
  assert.equal(chapterOf(386), "第3章 ネットワークとデータの活用");
  const chapter2 = items.filter((item) => itemMatchesRange(item, "第2章 メディアとデザイン"));
  assert.equal(chapter2.length, 60);
});

test("4択は問題集の選択肢と正解の記号をそのまま使う", () => {
  const item = items.find((entry) => entry.number === 1);
  assert.deepEqual(recallChoicesFor(item), ["データ", "情報", "メディア", "コンテンツ"]);
  assert.equal(recallCorrectChoiceFor(item), "情報");
  const question = buildQuestion(item, "info_choice", items, () => 0.5);
  assert.equal(question.prompt, item.infoQuestion);
  assert.equal(question.correctChoice, "情報");
  assert.equal(question.choices.length, 5);
  const recall = buildQuestion(item, "info_recall", items);
  assert.equal(recall.prompt, item.infoQuestion);
  assert.equal(recall.answer, "情報");
  // 選択肢の無い問題（フラッシュカード専用）は一問一答だけ。
  const flashOnly = items.find((entry) => entry.number === 8);
  assert.equal(flashOnly.infoAnswer, "21世紀の石油");
  assert.deepEqual(flashOnly.questionModes, ["info_recall"]);
});

test("解説・抜粋からMarkdownの太字の印を外している", () => {
  for (const item of items) {
    assert.doesNotMatch(item.editorial.explanation, /\*\*/, item.id);
    assert.doesNotMatch(item.infoQuestion, /\*\*/, item.id);
    item.editorial.evidenceQuotes.forEach((quote) => assert.doesNotMatch(quote, /\*\*/, item.id));
  }
});

test("アプリは3定の教科に情報を並べ、データを読み込んでオフラインにも備える", () => {
  assert.match(appSource, /const INFO_DATA_URL = "\.\/data\/info-2026-3\.json\?v=[\d.]+";/);
  const url = appSource.match(/const INFO_DATA_URL = "([^"]+)"/)[1];
  assert.ok(swSource.includes(`"${url}"`), "sw.js の APP_SHELL に情報のデータを載せる");
  assert.match(appSource, /info: "情報",/);
  assert.match(indexSource, /data-subject="info"/);
  // ホームは公共と同じ（範囲＝章を選び、重要度を選んで始める）。
  assert.match(appSource, /function isPublicSubject\(\) \{\s*\n\s*return state\.subject === "public" \|\| state\.subject === "info";/);
  assert.match(appSource, /return isInfoSubject\(\) \? "章" : "題名";/);
});

test("MCPからも情報の問題を追加でき、4択の選択肢がそろう", () => {
  assert.deepEqual(SUBJECTS.info.modes, ["info_recall", "info_choice"]);
  const item = buildServerQuestion({
    subject: "info",
    id: "info-test-1",
    input: {
      question: "情報を送り手から受け手へ伝える媒体を何というか。",
      answer: "メディア",
      range: "第1章 情報社会",
      choices: { A: "メディア", B: "データ", C: "情報", D: "コンテンツ" },
    },
  });
  assert.equal(item.subject, "info");
  assert.equal(item.infoQuestion, "情報を送り手から受け手へ伝える媒体を何というか。");
  assert.equal(item.title, "第1章 情報社会");
  assert.deepEqual(item.questionModes, ["info_recall", "info_choice"]);
  assert.ok(itemMatchesRange(item, "第1章 情報社会"));
});
