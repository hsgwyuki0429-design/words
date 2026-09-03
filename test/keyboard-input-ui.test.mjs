import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ALPHABET_KEYBOARD_ROWS,
  acceptedInputAnswers,
  alphabetKeyboardKeys,
  applyKeyboardKey,
  characterHintForToken,
  clampSlotIndex,
  deleteKeyboardCharacter,
  distributeInputText,
  inputPlanForAnswers,
  isAnswerCorrect,
  moveKeyboardSlot,
} from "../src/logic.js";
import { quizGesturePolicy } from "../src/quiz-gestures.js";

const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const logicSource = readFileSync(new URL("../src/logic.js", import.meta.url), "utf8");
const storageSource = readFileSync(new URL("../src/storage.js", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const gestureSource = readFileSync(new URL("../src/quiz-gestures.js", import.meta.url), "utf8");
const serviceWorkerSource = readFileSync(new URL("../sw.js", import.meta.url), "utf8");

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
  assert.match(stylesSource, /\.word-slot\s*\{[\s\S]*?height:\s*62px[\s\S]*?min-height:\s*62px/);
  assert.doesNotMatch(stylesSource, /\.show-character-count \.word-slot\s*\{/);
  assert.doesNotMatch(stylesSource, /\.show-character-count \.word-slot-input\s*\{/);
  assert.match(stylesSource, /\.word-slot-input:focus\s*\{[\s\S]*?box-shadow:\s*none/);
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

test("入力枠の幅は正解の文字数に合わせ、文字数表示の切替では変わらない", () => {
  const slots = functionSource("renderWordSlots", "updateCharacterCountDisplay");
  assert.match(slots, /const slotLength = Math\.max\(3, characterHintForToken\(slot\.answer\)\.length\)/);
  assert.match(slots, /style="--slot-length:\$\{slotLength\}"/);
  assert.match(stylesSource, /\.word-slots\s*\{[\s\S]*?display:\s*flex[\s\S]*?flex-wrap:\s*wrap/);
  assert.match(stylesSource, /\.word-slots\s*\{[\s\S]*?--slot-char-width:\s*10px/);
  assert.match(
    stylesSource,
    /\.word-slot\s*\{[\s\S]*?flex:\s*0 1 calc\(var\(--slot-length, 6\) \* var\(--slot-char-width\) \+ 18px\)/,
  );
  // 幅の指定は1か所だけ。長さごとの決め打ちクラスは持たない。
  assert.doesNotMatch(stylesSource, /\.word-slot--long|\.word-slot--xlong/);
  assert.doesNotMatch(appSource, /word-slot--long|word-slot--xlong/);
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

test("answered keyboard input keeps the typed boxes and shows only the correct answer and range", () => {
  const slots = functionSource("renderWordSlots", "updateCharacterCountDisplay");
  const feedback = functionSource("renderFeedback", "renderNextButton");
  const keyboardFeedback = feedback.slice(
    feedback.indexOf("if (isKeyboardInput)"),
    feedback.indexOf("const showSourceBox"),
  );
  assert.match(slots, /\$\{answered \? "" : '<button class="primary-button answer-button"/);
  assert.match(keyboardFeedback, /keyboard-feedback-card/);
  assert.match(keyboardFeedback, />正答</);
  assert.match(keyboardFeedback, />範囲</);
  assert.doesNotMatch(keyboardFeedback, /あなたの回答|重要度|importance-badge|sourceLine|itemEvidenceLine/);
  assert.match(stylesSource, /\.word-slot\.is-correct\s*\{/);
  assert.match(stylesSource, /\.word-slot\.is-wrong\s*\{/);
  assert.match(stylesSource, /\.quiz-answered \.word-slot\s*\{[\s\S]*?pointer-events:\s*none/);
  assert.match(stylesSource, /\.quiz-keyboard-input \.swipe-input-card,[\s\S]*?\.quiz-keyboard-input\.quiz-answered \.swipe-input-card[\s\S]*?padding:/);
});

test("answered keyboard cards use the same four-direction swipe progression as choices", () => {
  const quiz = functionSource("renderQuiz", "currentTypedAnswer");
  assert.match(quiz, /renderCardPreview\(isChoice \? "choice" : "input"\)/);
  assert.match(quiz, /isKeyboardInput \? " swipe-input-card"/);
  assert.match(quiz, /answered && isSwipeAdvance \? renderChoiceSwipeHints\(\)/);
  assert.match(stylesSource, /\.swipe-input-card\s*\{[\s\S]*?min-height:\s*var\(--input-card-height\)/);
  assert.match(stylesSource, /\.swipe-input-card > \.keyboard-feedback-card\s*\{[\s\S]*?border-top:/);
});

/* ---------------------------------------------------------------------------
   アプリ内小文字英字キーボード
   --------------------------------------------------------------------------- */

test("アプリ内キーボードは小文字QWERTYの全26文字を持つ", () => {
  assert.deepEqual(ALPHABET_KEYBOARD_ROWS[0], ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"]);
  assert.deepEqual(ALPHABET_KEYBOARD_ROWS[1], ["a", "s", "d", "f", "g", "h", "j", "k", "l"]);
  assert.deepEqual(ALPHABET_KEYBOARD_ROWS[2], ["'", "z", "x", "c", "v", "b", "n", "m", "-"]);
  const keys = alphabetKeyboardKeys();
  const letters = keys.filter((key) => /[a-z]/.test(key));
  assert.equal(new Set(letters).size, 26);
  assert.equal(letters.join(""), letters.join("").toLowerCase());
  // Shift・大文字モードは実装しない。
  assert.ok(keys.every((key) => key === key.toLowerCase()));

  const keyboard = functionSource("renderAlphabetKeyboard", "syncInputSlotState");
  for (const key of letters) {
    assert.ok(keyboard.includes("data-alphabet-key=") , "各キーは data-alphabet-key を持つ");
  }
  assert.match(keyboard, /ALPHABET_KEYBOARD_ROWS\.map/);
  assert.doesNotMatch(keyboard, /Shift|toUpperCase/);
});

test("アポストロフィーとハイフンのキーが存在する", () => {
  const keys = alphabetKeyboardKeys();
  assert.ok(keys.includes("'"));
  assert.ok(keys.includes("-"));
  assert.equal(applyKeyboardKey(["don"], 0, "'").values[0], "don'");
  assert.equal(applyKeyboardKey(["well"], 0, "-").values[0], "well-");
});

test("キー入力は選択中の枠だけを更新する", () => {
  const first = applyKeyboardKey(["", "", ""], 1, "a");
  assert.deepEqual(first.values, ["", "a", ""]);
  assert.equal(first.activeIndex, 1);
  const second = applyKeyboardKey(first.values, first.activeIndex, "t");
  assert.deepEqual(second.values, ["", "at", ""]);
  // 配列の入れ替えではなく複製を返すので、元の値は書き換わらない。
  assert.deepEqual(first.values, ["", "a", ""]);
  // キーボードに無い文字は無視する（採点対象の記号を勝手に増やさない）。
  assert.deepEqual(applyKeyboardKey(["ab"], 0, "+").values, ["ab"]);
});

test("削除キーは選択中の枠の末尾1文字を削除する", () => {
  const result = deleteKeyboardCharacter(["take", "care"], 1);
  assert.deepEqual(result.values, ["take", "car"]);
  assert.equal(result.activeIndex, 1);
});

test("空欄での削除は前の枠へ移動してその末尾1文字を削除する", () => {
  const result = deleteKeyboardCharacter(["take", ""], 1);
  assert.deepEqual(result.values, ["tak", ""]);
  assert.equal(result.activeIndex, 0);
  // 先頭の枠が空のときは何も起きない。
  const head = deleteKeyboardCharacter(["", "care"], 0);
  assert.deepEqual(head.values, ["", "care"]);
  assert.equal(head.activeIndex, 0);
});

test("前の語・次の語で対象枠が正しく切り替わる", () => {
  assert.equal(moveKeyboardSlot(0, 1, 3), 1);
  assert.equal(moveKeyboardSlot(1, 1, 3), 2);
  assert.equal(moveKeyboardSlot(2, 1, 3), 2);
  assert.equal(moveKeyboardSlot(1, -1, 3), 0);
  assert.equal(moveKeyboardSlot(0, -1, 3), 0);
  assert.equal(clampSlotIndex(9, 3), 2);
  assert.equal(clampSlotIndex(-4, 3), 0);
  assert.equal(clampSlotIndex(2, 0), 0);

  const move = functionSource("moveActiveInputSlot", "switchToSystemKeyboard");
  assert.match(move, /moveKeyboardSlot\(inputKeyboardState\.activeSlotIndex, delta, inputs\.length\)/);
  const actions = appSource.match(/if \(target\.dataset\.alphabetAction\)[\s\S]*?\n {4}\}/)?.[0] ?? "";
  assert.match(actions, /action === "previous"\) moveActiveInputSlot\(-1\)/);
  assert.match(actions, /action === "next"\) moveActiveInputSlot\(1\)/);
  assert.match(actions, /action === "delete"\) deleteAlphabetCharacter\(\)/);
  // 誤操作を避けるため、画面上の回答ボタンとは別に「回答する」キーも用意する。
  assert.match(actions, /action === "submit"\) submitAnswer\(currentTypedAnswer\(\)\)/);
  assert.match(functionSource("renderWordSlots", "updateCharacterCountDisplay"), /answer-button/);
});

test("任意語は空欄のまま回答でき、採点は既存のlogicだけを使う", () => {
  const plan = inputPlanForAnswers(["suggest (that) S + V"]);
  assert.equal(plan.slots[1].optional, true);
  const values = ["suggest", "", "S", "V"];
  const typed = values.join(" ").trim();
  assert.ok(isAnswerCorrect(typed, ["suggest (that) S + V"]));
  assert.ok(acceptedInputAnswers(["suggest (that) S + V"]).includes("suggest S V"));
  // 別解・アポストロフィー・ハイフンもキーボード入力そのままで通る。
  assert.ok(isAnswerCorrect("better", ["good/better"]));
  assert.ok(isAnswerCorrect("good", ["good/better"]));
  assert.ok(isAnswerCorrect("don't", ["don't"]));
  assert.ok(isAnswerCorrect("well-known", ["well-known"]));
  // キーボード専用の採点処理を持たない。
  assert.doesNotMatch(appSource, /function \w*[Kk]eyboard\w*(Correct|Score|Judge)/);
});

test("キー操作は入力欄・文字数ヒント・アクティブ表示だけを局所更新する", () => {
  const sync = functionSource("syncInputSlotState", "activateInputSlot");
  assert.match(sync, /input\.value = values\[index\]/);
  assert.match(sync, /classList\.toggle\("is-active-slot", active\)/);
  assert.match(sync, /state\.session\.currentSlotValues = inputs\.map/);
  assert.match(sync, /updateCharacterCountDisplay\(\)/);
  assert.doesNotMatch(sync, /renderQuiz\(\)/);

  const apply = functionSource("applyAlphabetKey", "deleteAlphabetCharacter");
  assert.match(apply, /applyKeyboardKey\(currentSlotValueList\(\), inputKeyboardState\.activeSlotIndex, key\)/);
  assert.match(apply, /syncInputSlotState\(result\.values\)/);
  assert.doesNotMatch(apply, /renderQuiz\(\)/);

  const remove = functionSource("deleteAlphabetCharacter", "moveActiveInputSlot");
  assert.match(remove, /deleteKeyboardCharacter\(currentSlotValueList\(\), inputKeyboardState\.activeSlotIndex\)/);
  assert.match(remove, /syncInputSlotState\(result\.values\)/);
  assert.doesNotMatch(remove, /renderQuiz\(\)/);

  // 文字数ヒントは入力値から作り直すだけで、入力値そのものは触らない。
  const updateHints = functionSource("updateCharacterCountDisplay", "ensureInputVisible");
  assert.match(updateHints, /characterHintMarkup\(input\.dataset\.hintToken, input\.value\)/);
  assert.doesNotMatch(updateHints, /input\.value\s*=[^=]/);
  assert.equal(characterHintForToken("don't"), "___'_");
  assert.equal(characterHintForToken("well-known"), "____-_____");
});

test("アクティブな入力枠はDOMではなく専用状態で管理する", () => {
  assert.match(appSource, /const inputKeyboardState = \{\s*activeSlotIndex: 0,\s*slotCount: 0,\s*\}/);
  assert.match(functionSource("prepareQuestion", "sourceLine"), /resetInputKeyboardState\(\)/);
  assert.match(functionSource("resetInputKeyboardState", "renderAlphabetKeyboard"), /activeSlotIndex = 0/);
  const activate = functionSource("activateInputSlot", "applyAlphabetKey");
  assert.match(activate, /inputKeyboardState\.activeSlotIndex = clampSlotIndex\(index, inputs\.length\)/);
  // 入力枠を押したらその枠がアクティブになる。
  assert.match(appSource, /addEventListener\("focusin"[\s\S]*?activateInputSlot\(Number\(input\.dataset\.slotIndex\), \{ focus: false \}\)/);
});

test("回答確定後はアプリ内キーボードを表示しない", () => {
  const quiz = functionSource("renderQuiz", "currentTypedAnswer");
  assert.match(quiz, /const showAlphabetKeyboard = !answered && shouldUseAlphabetKeyboard\(question\.mode\)/);
  assert.match(quiz, /\$\{showAlphabetKeyboard \? renderAlphabetKeyboard\(\) : ""\}/);
  assert.match(quiz, /\$\{showAlphabetKeyboard \? " has-alphabet-keyboard" : ""\}/);
  const slots = functionSource("renderWordSlots", "updateCharacterCountDisplay");
  assert.match(slots, /const useAppKeyboard = !answered && shouldUseAlphabetKeyboard\(question\.mode\)/);
  assert.match(appSource, /function applyAlphabetKey\(key\) \{\s*if \(state\.session\?\.answered\) return;/);
  assert.match(appSource, /function deleteAlphabetCharacter\(\) \{\s*if \(state\.session\?\.answered\) return;/);
});

test("4択・フラッシュカード・一問一答にはアプリ内キーボードを出さない", () => {
  const decide = functionSource("shouldUseAlphabetKeyboard", "wordSlotInputs");
  assert.match(decide, /if \(mode !== "ja_to_en_input"\) return false/);
  assert.match(decide, /if \(state\.settings\.useSystemKeyboard\) return false/);
  assert.match(decide, /return isCoarsePointerDevice\(\)/);
  assert.match(functionSource("isCoarsePointerDevice", "shouldUseAlphabetKeyboard"), /\(pointer: coarse\)/);
  // 4択・フラッシュカード・公共/保健の一問一答を描画する経路には出てこない。
  assert.doesNotMatch(functionSource("renderRecallQuiz", "renderQuiz"), /renderAlphabetKeyboard/);
  assert.doesNotMatch(functionSource("renderChoiceArea", "characterHintMarkup"), /renderAlphabetKeyboard/);
  assert.equal(appSource.match(/(?<!function )renderAlphabetKeyboard\(\)/g).length, 1);
});

test("PCの物理キーボード入力とタッチ以外の環境を妨げない", () => {
  const slots = functionSource("renderWordSlots", "updateCharacterCountDisplay");
  // pointer: coarse でなければ readonly を付けず、従来どおり inputmode="text"。
  assert.match(slots, /const keyboardAttributes = useAppKeyboard\s*\?\s*'inputmode="none" readonly'\s*:\s*'inputmode="text"'/);
  // Enter・スペース・Backspace・貼り付けの既存処理はそのまま残る。
  assert.match(appSource, /if \(event\.key === "Enter"\)[\s\S]*?inputs\[index \+ 1\]\.focus\(\)[\s\S]*?submitAnswer\(currentTypedAnswer\(\)\)/);
  assert.match(appSource, /if \(event\.key === " "\)[\s\S]*?inputs\[index \+ 1\]\.focus\(\)/);
  assert.match(appSource, /event\.key === "Backspace" && !input\.value && index > 0/);
});

test("端末キーボードへ切り替えても貼り付け・Enter・入力値が保たれる", () => {
  const switchSource = functionSource("switchToSystemKeyboard", "renderTextInput");
  assert.match(switchSource, /state\.settings\.useSystemKeyboard = true/);
  assert.match(switchSource, /saveSettings\(\)/);
  assert.match(switchSource, /input\.readOnly = false/);
  assert.match(switchSource, /setAttribute\("inputmode", "text"\)/);
  // 再描画しないので入力値・フォーカス・スワイプ状態が壊れない。
  assert.doesNotMatch(switchSource, /renderQuiz\(\)/);
  assert.match(functionSource("renderAlphabetKeyboard", "syncInputSlotState"), /data-use-system-keyboard>端末キーボードを使う/);
  assert.match(appSource, /if \(target\.hasAttribute\("data-use-system-keyboard"\)\) switchToSystemKeyboard\(\)/);
  // paste・keydown・input・focusin は quizContent への委譲なので切替後も生きている。
  assert.match(appSource, /elements\.quizContent\.addEventListener\("paste"/);
  assert.match(appSource, /elements\.quizContent\.addEventListener\("keydown"/);
  assert.match(appSource, /addEventListener\("paste"[\s\S]*?distributeSlotText\(input, text\)/);
  // 設定画面からアプリ内キーボードへ戻せる。
  assert.match(appSource, /toggle\("useSystemKeyboard", "端末のキーボードを使う"/);
  assert.match(appSource, /useSystemKeyboard: false/);
  assert.match(storageSource, /\{ \.\.\.defaults, \.\.\.stored }/);
});

test("キーのタップはカードスワイプとして処理されない", () => {
  // キーボードは data-quiz-gesture-surface の外側（カードスタージの後ろ）に置く。
  const quiz = functionSource("renderQuiz", "currentTypedAnswer");
  assert.match(
    quiz,
    /\$\{answered && !isSwipeAdvance \? feedbackArea : ""\}\s*<\/div>\s*<\/div>\s*\$\{showAlphabetKeyboard \? renderAlphabetKeyboard\(\) : ""\}/,
  );
  // 各キーは button なので、仮に内側にあってもジェスチャーは開始しない。
  const keyboard = functionSource("renderAlphabetKeyboard", "syncInputSlotState");
  assert.equal((keyboard.match(/<button/g) ?? []).length, (keyboard.match(/type="button"/g) ?? []).length);
  assert.match(gestureSource, /const INTERACTIVE_SELECTOR = "button, input, select, textarea, a, label/);
  assert.match(gestureSource, /if \(isEnabledInteractiveTarget\(event\.target\)\) return;/);
  // キーボードが出ている＝未回答の間は、そもそもドラッグ判定が無効。
  const unanswered = quizGesturePolicy({ mode: "ja_to_en_input", answered: false });
  assert.deepEqual(unanswered, { tapEnabled: false, dragEnabled: false, allowedDirections: [] });
  const answered = quizGesturePolicy({ mode: "ja_to_en_input", answered: true });
  assert.deepEqual(answered.allowedDirections, ["left", "right", "up", "down"]);
  assert.match(stylesSource, /\.alphabet-key\s*\{[\s\S]*?touch-action:\s*manipulation/);
});

test("アプリ内キーボードのスタイルは実機の高さとsafe areaを満たす", () => {
  assert.match(stylesSource, /\.alphabet-key\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(stylesSource, /\.alphabet-key:active\s*\{[\s\S]*?transform:/);
  assert.match(stylesSource, /\.word-slot\.is-active-slot\s*\{[\s\S]*?border-color:\s*var\(--accent\)/);
  assert.match(stylesSource, /\.alphabet-keyboard\s*\{[\s\S]*?padding:[^;]*var\(--safe-bottom\)/);
  assert.match(stylesSource, /\.quiz-shell\.has-alphabet-keyboard\s*\{[\s\S]*?height:\s*100dvh[\s\S]*?max-height:\s*100dvh/);
  // カード側だけをスクロールさせ、キーボードがスワイプ領域へ重ならないようにする。
  assert.match(stylesSource, /\.quiz-shell\.has-alphabet-keyboard \.quiz-card-stage\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(stylesSource, /\.alphabet-keyboard\s*\{[\s\S]*?flex:\s*0 0 auto/);
  assert.match(stylesSource, /\.quiz-shell\.has-alphabet-keyboard \.quiz-card-stage\s*\{[\s\S]*?--input-card-height:\s*clamp\(/);
  assert.match(stylesSource, /\.alphabet-keyboard-row\s*\{[\s\S]*?display:\s*flex/);
  // 横スクロールを出さないため、キーは伸縮して最小幅0にできる。
  assert.match(stylesSource, /\.alphabet-key\s*\{[\s\S]*?flex:\s*1 1 0[\s\S]*?min-width:\s*0/);
  // 横向きでは高さを圧縮する。
  assert.match(stylesSource, /@media \(orientation: landscape\) and \(max-height: 560px\)[\s\S]*?\.alphabet-key\s*\{[\s\S]*?height:\s*34px/);
  // prefers-reduced-motion を尊重する。
  assert.match(stylesSource, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.alphabet-key\s*\{\s*transition:\s*none/);
});

test("PWAの新旧アセットが混在しないようバージョンが揃っている", () => {
  const appVersion = serviceWorkerSource.match(/const APP_VERSION = "([^"]+)"/)?.[1];
  assert.ok(appVersion, "sw.js は APP_VERSION を持つ");
  const escaped = appVersion.replaceAll(".", "\\.");
  assert.match(indexSource, new RegExp(`styles\\.css\\?v=${escaped}`));
  assert.match(indexSource, new RegExp(`src/app\\.js\\?v=${escaped}`));
  assert.match(serviceWorkerSource, /const CACHE_NAME = `words-\$\{APP_VERSION\}`/);
  // app.js が読み込む JS も同じバージョン。
  for (const module of ["logic", "storage", "quiz-gestures"]) {
    assert.match(appSource, new RegExp(`\\./${module}\\.js\\?v=${escaped}`));
  }
  assert.match(appSource, new RegExp(`serviceWorker\\.register\\("\\./sw\\.js\\?v=${escaped}"`));
});

test("入力枠は縦に折り返さず、幅を詰めて横一列に並ぶ", () => {
  // CSS が語数を見て詰められるよう、枠数を data 属性で出している。
  const slots = functionSource("renderWordSlots", "updateCharacterCountDisplay");
  assert.match(slots, /data-word-slot-count="\$\{plan\.slots\.length\}"/);

  // 折り返す前に幅を詰めるため nowrap にしている。
  assert.match(stylesSource, /\.word-slots\[data-word-slot-count\]\s*\{[\s\S]*?flex-wrap:\s*nowrap/);
  // 下限が無いので、語数が増えても横あふれせずに1行へ収まる。
  assert.match(stylesSource, /\.word-slot\s*\{[\s\S]*?flex:\s*0 1 calc\([\s\S]*?min-width:\s*0/);
  // スマホ幅で2枠ずつ折り返していた指定は残っていない。
  assert.doesNotMatch(stylesSource, /flex-basis:\s*calc\(50% - 4px\)/);

  // 語数が多いときは中の文字だけを詰める（枠の高さは1種類に揃える）。
  assert.match(
    stylesSource,
    /\.word-slots\[data-word-slot-count="7"\] \.word-slot-input\s*\{[\s\S]*?font-size:\s*15px/,
  );
  assert.doesNotMatch(stylesSource, /\.word-slots\[data-word-slot-count="\d"\] \.word-slot\s*\{/);
  // 正誤マークは枠が細くても入力文字に重ならないよう角へ置く。
  assert.match(stylesSource, /\.word-slot-result\s*\{[\s\S]*?top:\s*-7px[\s\S]*?right:\s*-4px/);
});
