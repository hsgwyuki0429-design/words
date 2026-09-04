import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ENGLISH_SPEECH_LANG,
  createEnglishSpeaker,
  pickEnglishVoice,
  speechTextForEnglish,
} from "../src/speech.js";
import { ENGLISH_CONTENT_TYPES } from "../src/logic.js";

const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const swSource = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const items = JSON.parse(readFileSync(new URL("../data/items.json", import.meta.url), "utf8"));
const publicItems = JSON.parse(readFileSync(new URL("../data/public-items.json", import.meta.url), "utf8"));

function functionSource(name, nextName) {
  const start = appSource.indexOf(`function ${name}`);
  const end = appSource.indexOf(`function ${nextName}`, start + 1);
  assert.ok(start >= 0, `${name} should exist`);
  assert.ok(end > start, `${nextName} should follow ${name}`);
  return appSource.slice(start, end);
}

// 呼び出しの記録だけを取る、最小限の SpeechSynthesis 代役。
function fakeSpeech({ voices = [], failOnSpeak = false } = {}) {
  const calls = [];
  const listeners = new Map();
  class FakeUtterance {
    constructor(text) {
      this.text = text;
      this.lang = "";
      this.voice = null;
    }
  }
  const engine = {
    paused: false,
    spoken: [],
    getVoices: () => voices,
    addEventListener(type, handler) {
      listeners.set(type, handler);
      calls.push(`listen:${type}`);
    },
    cancel() {
      calls.push("cancel");
    },
    resume() {
      calls.push("resume");
      engine.paused = false;
    },
    speak(utterance) {
      calls.push("speak");
      if (failOnSpeak) throw new Error("再生できません");
      engine.spoken.push(utterance);
    },
  };
  return {
    engine,
    calls,
    listeners,
    speaker: createEnglishSpeaker({
      getSynthesis: () => engine,
      getUtteranceClass: () => FakeUtterance,
      onWarning: () => {},
    }),
  };
}

test("単語・熟語・構文をひとつづきの表現のまま読み上げる", () => {
  assert.equal(speechTextForEnglish("apple"), "apple");
  assert.equal(speechTextForEnglish("take part in"), "take part in");
  assert.equal(speechTextForEnglish("be unable to do"), "be unable to do");
  // 任意扱いの括弧は中身だけ読む
  assert.equal(speechTextForEnglish("help A (to) do"), "help A to do");
  assert.equal(speechTextForEnglish("suggest (that) S + V"), "suggest that S V");
  // 併記は区切って読む
  assert.equal(speechTextForEnglish("be good/better at doing"), "be good, better at doing");
  // 引用符は読まない
  assert.equal(speechTextForEnglish("known as “garbage beach”"), "known as garbage beach");
  // 英語音声で読めない日本語の注記は落とす
  assert.equal(speechTextForEnglish("make A + 動詞原形"), "make A");
  assert.equal(speechTextForEnglish("倍数 + as many A as B"), "as many A as B");
});

test("英語が無いテキストは読み上げ対象にしない", () => {
  for (const value of ["", "   ", "社会的協働", null, undefined, 123, {}, []]) {
    assert.equal(speechTextForEnglish(value), "", `${JSON.stringify(value)} は読み上げない`);
  }
  // 公共の設問は english 欄にも日本語が入っているので、ここで弾かれる
  const publicList = Array.isArray(publicItems) ? publicItems : publicItems.items;
  assert.equal(speechTextForEnglish(publicList[0].english), "");
});

test("教材データの英語はすべて読み上げ用テキストに変換できる", () => {
  const list = Array.isArray(items) ? items : items.items;
  const englishItems = list.filter((item) => ENGLISH_CONTENT_TYPES.includes(item.type));
  assert.ok(englishItems.length > 1000);
  const empty = englishItems.filter((item) => !speechTextForEnglish(item.english));
  assert.deepEqual(empty, [], "読み上げ文が空になる語句は無い");
});

test("英語の声を探し、無ければ lang 指定だけに任せる", () => {
  const voice = (name, lang, isDefault = false) => ({ name, lang, default: isDefault });
  assert.equal(ENGLISH_SPEECH_LANG, "en-US");
  // 声が1つも無い／英語が無い環境では null（OS・ブラウザ標準へフォールバック）
  assert.equal(pickEnglishVoice([]), null);
  assert.equal(pickEnglishVoice([voice("Kyoko", "ja-JP")]), null);
  assert.equal(pickEnglishVoice(undefined), null);
  // en-US を優先し、その中では既定の声を選ぶ
  assert.equal(pickEnglishVoice([voice("Daniel", "en-GB"), voice("Samantha", "en-US")]).name, "Samantha");
  assert.equal(
    pickEnglishVoice([voice("Google US English", "en-US"), voice("Alex", "en-US", true)]).name,
    "Alex",
  );
  // en-US が無ければ他の英語で代用する（en_GB のような表記ゆれも拾う）
  assert.equal(pickEnglishVoice([voice("Karen", "en-AU"), voice("Daniel", "en_GB", true)]).name, "Daniel");
  // 特定の声の名前を必須条件にしない（選ぶときに voice.name を見ない）
  const speechSource = readFileSync(new URL("../src/speech.js", import.meta.url), "utf8");
  assert.doesNotMatch(speechSource, /voice\.name/);
  assert.match(speechSource, /normalizeLang\(voice\.lang\)\.startsWith\("en"\)/);
});

test("読み上げの直前に必ず前の音声を止める", () => {
  const { speaker, engine, calls } = fakeSpeech({ voices: [{ name: "Samantha", lang: "en-US" }] });
  assert.equal(speaker.speak("apple", { token: 1 }), true);
  assert.deepEqual(calls.filter((call) => call !== "listen:voiceschanged"), ["cancel", "speak"]);
  assert.equal(engine.spoken[0].text, "apple");
  assert.equal(engine.spoken[0].lang, "en-US");
  assert.equal(engine.spoken[0].voice.name, "Samantha");
});

test("素早く連続でスワイプしても、最新の問題だけが読まれる", () => {
  const { speaker, engine, calls } = fakeSpeech();
  speaker.speak("apple", { token: 1 });
  speaker.stop();
  speaker.speak("banana", { token: 2 });
  speaker.stop();
  speaker.speak("cherry", { token: 3 });
  // 読み上げのたびに cancel が入り、キューに積み増さない
  assert.equal(calls.filter((call) => call === "speak").length, 3);
  assert.ok(calls.filter((call) => call === "cancel").length >= 3);
  assert.deepEqual(engine.spoken.map((utterance) => utterance.text), ["apple", "banana", "cherry"]);
});

test("同じ問題は二度読み上げない", () => {
  const { speaker, engine } = fakeSpeech();
  assert.equal(speaker.speak("apple", { token: 7 }), true);
  assert.equal(speaker.speak("apple", { token: 7 }), false, "同じ問題の再描画では読み直さない");
  assert.equal(engine.spoken.length, 1);
  // 同じ語句でも別の問題（再出題）ならもう一度読む
  assert.equal(speaker.speak("apple", { token: 8 }), true);
  assert.equal(engine.spoken.length, 2);
});

test("Web Speech API が無い環境でも例外を投げない", () => {
  const missing = createEnglishSpeaker({ getSynthesis: () => null, getUtteranceClass: () => null });
  assert.equal(missing.supported(), false);
  assert.equal(missing.speak("apple", { token: 1 }), false);
  assert.doesNotThrow(() => missing.prime());
  assert.doesNotThrow(() => missing.stop());

  // 取得そのものが例外を投げる環境（プライベートモードなど）
  const throwing = createEnglishSpeaker({
    getSynthesis: () => { throw new Error("blocked"); },
    getUtteranceClass: () => null,
  });
  assert.equal(throwing.supported(), false);
  assert.equal(throwing.speak("apple", { token: 1 }), false);

  // speak() 自体が拒否されても false を返すだけで、呼び出し側は止まらない
  const { speaker } = fakeSpeech({ failOnSpeak: true });
  assert.equal(speaker.speak("apple", { token: 1 }), false);
});

test("voiceschanged で声一覧を後から受け取る", () => {
  const voices = [];
  const { speaker, engine, listeners } = fakeSpeech({ voices });
  speaker.prime();
  assert.ok(listeners.has("voiceschanged"), "voiceschanged を購読する");
  // 最初は空でも読み上げは止めず、lang 指定だけで話す
  assert.equal(speaker.speak("apple", { token: 1 }), true);
  assert.equal(engine.spoken[0].voice, null);
  // あとから声が届いたら次の問題から使う
  voices.push({ name: "Google US English", lang: "en-US" });
  listeners.get("voiceschanged")();
  assert.equal(speaker.speak("banana", { token: 2 }), true);
  assert.equal(engine.spoken[1].voice.name, "Google US English");
});

test("英語→日本語は問題を開いたとき、日本語→英語は答えが出たときに読む", () => {
  // 形式ごとの読み上げどきを1か所で決める
  const timingSource = functionSource("englishSpeechTiming", "speakQuestionEnglish");
  assert.match(timingSource, /mode\.startsWith\("en_to_ja"\) \? "prompt" : "answer"/);
  // 問題を開いた時点で読むのは英語が問題文の形式だけ
  const prepareSource = functionSource("prepareQuestion", "sourceLine");
  assert.match(prepareSource, /speakQuestionEnglish\(session\.currentQuestion, "prompt"\);/);
  // 4択・入力式は解答した時点で答えの英語を読む
  const submitSource = functionSource("submitAnswer", "injectDueReviews");
  assert.match(submitSource, /if \(!isRecallMode\(question\.mode\)\) speakQuestionEnglish\(question, "answer"\);/);
  // 履歴の保存（await）より前に呼び、タップ・キー操作から途切れさせない
  assert.ok(
    submitSource.indexOf('speakQuestionEnglish(question, "answer")') < submitSource.indexOf("await recordAttempt"),
    "await recordAttempt より前に読み上げる",
  );
  // フラッシュカードは答え面を開いた時点で読む
  const toggleSource = functionSource("toggleRecallFace", "transitionToNextCard");
  assert.match(toggleSource, /if \(session\.revealed\) speakQuestionEnglish\(session\.currentQuestion, "answer"\);/);
});

test("読み上げの呼び出しは3つの場面だけに限る", () => {
  // 再描画のたびに読み上げると同じ問題が何度も読まれるので、renderQuiz には入れない
  assert.equal(
    (appSource.match(/speakQuestionEnglish\(/g) ?? []).length,
    4,
    "定義1つと、問題表示・解答・答え面の3か所",
  );
  assert.match(functionSource("prepareQuestion", "sourceLine"), /session\.currentQuestion = buildQuestion\(/);
  assert.doesNotMatch(functionSource("renderQuiz", "currentTypedAnswer"), /speakQuestionEnglish|englishSpeech/);
  assert.doesNotMatch(functionSource("renderRecallQuiz", "renderQuiz"), /speakQuestionEnglish|englishSpeech/);
});

test("読み上げ対象は単語・熟語・構文だけに絞る", () => {
  const source = functionSource("questionEnglishText", "englishSpeechTiming");
  assert.match(source, /ENGLISH_CONTENT_TYPES\.includes\(item\.type\)/);
  assert.match(source, /item\.english/);
  // 1回の場面につき1回だけ読むための通し番号
  assert.match(functionSource("speakQuestionEnglish", "prepareQuestion"), /questionSpeechToken \+= 1;/);
  assert.match(appSource, /let questionSpeechToken = 0;/);
});

test("次の問題へ進むと確定したスワイプだけを読み上げのきっかけにする", () => {
  // フラッシュカード・一問一答：判定が通ったあとで停止する
  const recall = functionSource("handleRecallSwipe", "handleChoiceNextSwipe");
  assert.match(recall, /await animateSwipeCancel\(\{ surface \}\);\s*\n\s*return;\s*\n\s*\}[\s\S]*englishSpeech\.stop\(\);/);
  assert.ok(
    recall.indexOf("englishSpeech.stop()") > recall.indexOf("animateSwipeCancel"),
    "キャンセルの分岐を抜けたあとで停止する",
  );
  // 4択・キーボード入力：回答済みカードのスワイプ
  const choice = functionSource("handleChoiceNextSwipe", "handleQuizSwipe");
  assert.ok(
    choice.indexOf("englishSpeech.stop()") > choice.indexOf("animateSwipeCancel"),
    "キャンセルの分岐を抜けたあとで停止する",
  );
  assert.match(choice, /englishSpeech\.stop\(\);\s*\n\s*session\.isTransitioning = true;/);
  // スワイプ確定 → 次の問題を決める → 表示 → 読み上げ、が一続きになっている
  assert.match(functionSource("transitionToNextCard", "handleRecallSwipe"), /nextQuestion\(\{ enterFrom: oppositeDirection\(direction\) \}\)/);
  // キャンセル処理そのものには読み上げを足さない
  assert.doesNotMatch(functionSource("animateSwipeCancel", "animateCardExit"), /englishSpeech/);
});

test("最初の問題は学習開始のタップから読み上げる", () => {
  const beginSource = functionSource("beginSession", "startSession");
  // setView → prime → prepareQuestion（＝読み上げ）まで同期でつながる
  assert.match(beginSource, /englishSpeech\.prime\(\);\s*\n\s*prepareQuestion\(\);/);
  // 読み上げを有効にするためだけのボタンや画面は増やさない
  const indexSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.doesNotMatch(indexSource, /speech|読み上げ|発音/i);
  assert.doesNotMatch(appSource, /data-enable-speech|data-next-button/);
});

test("学習をやめたら読み上げも止める", () => {
  assert.match(functionSource("leaveQuiz", "showToast"), /englishSpeech\.stop\(\);/);
});

test("speech.js はオフラインでも使えるようキャッシュへ入れる", () => {
  assert.match(swSource, /`\.\/src\/speech\.js\?v=\$\{APP_VERSION\}`/);
});
