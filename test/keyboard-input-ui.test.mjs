import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  characterHintForToken,
  distributeInputText,
  inputPlanForAnswers,
} from "../src/logic.js";

const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const logicSource = readFileSync(new URL("../src/logic.js", import.meta.url), "utf8");
const storageSource = readFileSync(new URL("../src/storage.js", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

function functionSource(name, nextName) {
  const start = appSource.indexOf(`function ${name}`);
  const end = appSource.indexOf(`function ${nextName}`, start + 1);
  assert.ok(start >= 0, `${name} should exist`);
  assert.ok(end > start, `${nextName} should follow ${name}`);
  return appSource.slice(start, end);
}

test("keyboard boxes expose mobile-friendly lowercase English input attributes", () => {
  const slots = functionSource("renderWordSlots", "updateCharacterCountDisplay");
  for (const attribute of [
    'type="text"',
    'inputmode="text"',
    'autocomplete="off"',
    'autocapitalize="none"',
    'autocorrect="off"',
    'spellcheck="false"',
    'lang="en"',
  ]) {
    assert.ok(slots.includes(attribute), `${attribute} must be present on every word box`);
  }
  assert.match(slots, /enterkeyhint="\$\{index === plan\.slots\.length - 1 \? "done" : "next"\}"/);
  assert.match(slots, /\$\{answered \? "disabled" : ""\}/);
});

test("character hints are absent while hidden and preserve typed values when toggled", () => {
  const renderSlots = functionSource("renderWordSlots", "updateCharacterCountDisplay");
  const updateHints = functionSource("updateCharacterCountDisplay", "ensureInputVisible");
  const toggleHandler = appSource.match(/if \(target\.hasAttribute\("data-toggle-character-count"\)\)[\s\S]*?\n\s*}/)?.[0] ?? "";
  assert.match(renderSlots, /showCharacterCount \? characterHintMarkup\(slot\.answer, value\) : ""/);
  assert.match(updateHints, /show \? characterHintMarkup\(input\.dataset\.hintToken, input\.value\) : ""/);
  assert.match(updateHints, /aria-pressed/);
  assert.match(toggleHandler, /saveSettings\(\)/);
  assert.match(toggleHandler, /updateCharacterCountDisplay\(\)/);
  assert.doesNotMatch(toggleHandler, /renderQuiz\(\)/);
  assert.equal(characterHintForToken("apple"), "_____");
  assert.equal(characterHintForToken("take care"), "________");
});

test("the character-count control exists only in keyboard-input quiz headers", () => {
  const quiz = functionSource("renderQuiz", "currentTypedAnswer");
  assert.match(quiz, /const isKeyboardInput = question\.mode === "ja_to_en_input"/);
  assert.match(quiz, /\$\{isKeyboardInput \? `<div class="quiz-header-tools">[\s\S]*?data-toggle-character-count[\s\S]*?aria-pressed/);
  assert.match(stylesSource, /\.character-count-toggle\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(stylesSource, /\.character-count-toggle\s*\{[\s\S]*?min-width:\s*44px/);
});

test("space, next, done, backspace, paste, focus, and visual viewport behaviors are wired", () => {
  assert.match(appSource, /if \(event\.key === "Enter"\)[\s\S]*?inputs\[index \+ 1\]\.focus\(\)[\s\S]*?submitAnswer\(currentTypedAnswer\(\)\)/);
  assert.match(appSource, /if \(event\.key === " "\)[\s\S]*?inputs\[index \+ 1\]\.focus\(\)/);
  assert.match(appSource, /event\.key === "Backspace" && !input\.value && index > 0/);
  assert.match(appSource, /addEventListener\("paste"[\s\S]*?distributeSlotText\(input, text\)/);
  assert.match(appSource, /addEventListener\("focusin"[\s\S]*?ensureInputVisible\(input\)/);
  assert.match(appSource, /visualViewport\?\.addEventListener\("resize", \(\) => ensureInputVisible\(\)\)/);
  assert.match(functionSource("renderQuiz", "currentTypedAnswer"), /firstInput\?\.focus\(\{ preventScroll: true }\)/);

  const plan = inputPlanForAnswers(["take care of"]);
  assert.deepEqual(distributeInputText(plan, "take care of"), ["take", "care", "of"]);
});

test("optional words and fixed notation remain answerable without typing notation marks", () => {
  const plan = inputPlanForAnswers(["suggest (that) S + V"]);
  assert.equal(plan.slots.length, 4);
  assert.equal(plan.slots[1].optional, true);
  assert.ok(plan.segments.some((segment) => segment.kind === "fixed" && segment.text === "+"));
  assert.deepEqual(distributeInputText(plan, "suggest S V"), ["suggest", "", "S", "V"]);
  const slots = functionSource("renderWordSlots", "updateCharacterCountDisplay");
  assert.match(slots, /word-slot-optional">任意/);
  assert.match(slots, /segment\.kind === "slot"[\s\S]*?word-slot-fixed/);
});

test("keyboard boxes wrap without revealing exact length while hints are hidden", () => {
  assert.match(stylesSource, /\.word-slots\s*\{[\s\S]*?display:\s*flex[\s\S]*?flex-wrap:\s*wrap/);
  assert.match(stylesSource, /\.word-slot\s*\{[\s\S]*?flex:\s*0 1 112px[\s\S]*?width:\s*112px/);
  assert.match(stylesSource, /\.word-slot--long\s*\{[\s\S]*?width:\s*148px/);
  assert.match(stylesSource, /\.word-slot-input\s*\{[\s\S]*?min-width:\s*0/);
  assert.match(stylesSource, /\.word-slot-fixed\s*\{[\s\S]*?overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(stylesSource, /\.word-slot-input[^}]*text-transform\s*:/s);
});

test("legacy letter-choice spelling is removed from user-facing code", () => {
  const userFacingSource = [appSource, indexSource, stylesSource].join("\n");
  assert.doesNotMatch(userFacingSource, /ja_to_en_spelling|スペル1文字ずつ4択|1文字ずつ4択/);
  assert.doesNotMatch(userFacingSource, /spelling-letter|data-spelling|generateLetterChoices|chooseSpellingLetter/);
  assert.match(logicSource, /selection\.method === "ja_to_en_spelling"[\s\S]*?"ja_to_en_input"/);
});

test("keyboard input is the official Japanese-to-English format for every English content type", () => {
  assert.match(appSource, /title: "キーボード入力", detail: "日本語を見て、英語をキーボードで入力する"/);
  assert.match(appSource, /word: \{[\s\S]*?phrase: \{[\s\S]*?structure: \{/);
  const scope = functionSource("renderStudyScope", "renderStudyRangeSelect");
  assert.match(scope, /if \(format !== "input"\) return true/);
  assert.match(scope, /state\.studySelection\.direction === "ja_to_en"/);
  assert.doesNotMatch(scope, /content|contents|word|phrase|structure/);
});

test("legacy settings load safely and character-count preference persists", () => {
  assert.match(storageSource, /export async function getMetaObject\(key, defaults = \{\}\)/);
  assert.match(storageSource, /\{ \.\.\.defaults, \.\.\.stored }/);
  assert.match(appSource, /showCharacterCount: false/);
  assert.match(appSource, /getMetaObject\("settings", DEFAULT_SETTINGS\)/);
  assert.match(appSource, /state\.settings\.showCharacterCount = !state\.settings\.showCharacterCount/);
  assert.match(appSource, /function saveSettings\(\)[\s\S]*?setMeta\("settings", state\.settings\)/);
});

test("answered keyboard input shows accessible correctness and answer details", () => {
  const feedback = functionSource("renderFeedback", "renderNextButton");
  assert.match(feedback, /correct \? "✓" : "×"/);
  assert.match(feedback, /correct \? "正解" : "不正解"/);
  assert.match(feedback, /あなたの回答/);
  assert.match(feedback, /正しい回答/);
  assert.match(feedback, /importance-badge/);
  assert.match(feedback, /範囲：/);
  assert.match(feedback, /state\.settings\.showSources && !isChoice && sourceLine/);
  assert.match(stylesSource, /\.word-slot\.is-correct\s*\{/);
  assert.match(stylesSource, /\.word-slot\.is-wrong\s*\{/);
});
