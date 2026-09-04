// 学習中に、いま表示している問題の英語を読み上げる。
// ブラウザ標準の Web Speech API だけを使い、外部サービスやAPIキーは使わない。
// 使えない環境（API が無い・音声が1つも無い・再生が拒否された）では黙って
// 何もしないだけで、出題・スワイプ・正誤判定・学習記録には一切影響しない。

export const ENGLISH_SPEECH_LANG = "en-US";

// 読み上げの速さ。設定画面から選ぶ。値は SpeechSynthesisUtterance.rate に渡す
// 倍率で、1 が各ブラウザの標準速度。
export const SPEECH_RATE_OPTIONS = Object.freeze([
  Object.freeze({ key: "slow", label: "ゆっくり", rate: 0.7 }),
  Object.freeze({ key: "normal", label: "ふつう", rate: 1 }),
  Object.freeze({ key: "fast", label: "はやい", rate: 1.3 }),
]);

export const DEFAULT_SPEECH_RATE_KEY = "normal";

// 保存済みの設定が古い・壊れていても、必ず用意した3段階のどれかに収める。
export function normalizeSpeechRateKey(value) {
  return SPEECH_RATE_OPTIONS.some((option) => option.key === value)
    ? value
    : DEFAULT_SPEECH_RATE_KEY;
}

export function speechRateFor(value) {
  const key = normalizeSpeechRateKey(value);
  return SPEECH_RATE_OPTIONS.find((option) => option.key === key).rate;
}

// 英語音声では読めない日本語の注記（`make A + 動詞原形` の「動詞原形」など）を落とす。
const JAPANESE_PATTERN = /[　-〿぀-ヿ㐀-䶿一-鿿！-｠]+/g;

function defaultSynthesis() {
  if (typeof window === "undefined") return null;
  return "speechSynthesis" in window ? window.speechSynthesis : null;
}

function defaultUtteranceClass() {
  if (typeof window === "undefined") return null;
  return typeof window.SpeechSynthesisUtterance === "function"
    ? window.SpeechSynthesisUtterance
    : null;
}

function normalizeLang(lang) {
  return String(lang ?? "").toLowerCase().replace(/_/g, "-");
}

// 読み上げ用のテキスト。画面の表示は変えず、音声にしたときだけ不自然になる
// 記号を整える。熟語・構文は分割せず、ひとつづきの表現のまま読ませる。
export function speechTextForEnglish(value) {
  // 文字列以外（オブジェクト・数値・欠損）は読み上げない。
  const cleaned = (typeof value === "string" ? value : "")
    .replace(JAPANESE_PATTERN, " ")
    // 引用符は読み上げない（known as “garbage beach” → known as garbage beach）
    .replace(/[“”"«»]/g, " ")
    // 任意扱いの括弧は中身だけ読む（help A (to) do → help A to do）
    .replace(/[()[\]]/g, " ")
    // 併記は区切って読む（be good/better at doing → be good, better at doing）
    .replace(/\s*\/\s*/g, ", ")
    // 構文表記の + は読まない（suggest (that) S + V → suggest that S V）
    .replace(/\s*\+\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,;:.\-–—]+\s*/, "")
    .replace(/\s*[,;:\-–—]+$/, "")
    .trim();
  // 英字が1文字も残らなければ読み上げない。
  return /[A-Za-z]/.test(cleaned) ? cleaned : "";
}

// 利用できる英語の声を選ぶ。"Samantha" や "Google US English" のような
// 特定の名前には依存しない（OS・ブラウザごとに用意される声が違うため）。
// 見つからなければ null を返し、lang 指定だけで標準の声へ委ねる。
export function pickEnglishVoice(voices = [], preferredLang = ENGLISH_SPEECH_LANG) {
  const list = (Array.isArray(voices) ? voices : [])
    .filter((voice) => voice && typeof voice.lang === "string");
  const english = list.filter((voice) => normalizeLang(voice.lang).startsWith("en"));
  if (!english.length) return null;
  const wanted = normalizeLang(preferredLang);
  const exact = english.filter((voice) => normalizeLang(voice.lang) === wanted);
  return exact.find((voice) => voice.default)
    ?? exact[0]
    ?? english.find((voice) => voice.default)
    ?? english[0];
}

export function createEnglishSpeaker({
  getSynthesis = defaultSynthesis,
  getUtteranceClass = defaultUtteranceClass,
  onWarning = (error) => console.warn("英語の読み上げを実行できませんでした。", error),
} = {}) {
  let voices = [];
  let voicesBound = false;
  // 直前に読み上げた問題の識別子。再描画などで同じ問題が二度読まれるのを防ぐ。
  let lastToken = null;

  function synthesis() {
    try {
      return getSynthesis();
    } catch {
      return null;
    }
  }

  function refreshVoices() {
    const engine = synthesis();
    if (typeof engine?.getVoices !== "function") return;
    try {
      const list = engine.getVoices();
      if (Array.isArray(list) && list.length) voices = list;
    } catch (error) {
      // 声一覧が取れなくても lang 指定だけで読み上げられるので、ここでは止めない。
      onWarning?.(error);
    }
  }

  // ブラウザによっては最初の getVoices() が空で、あとから voiceschanged が来る。
  // 待ち合わせはせず、届いた時点で一覧を差し替えるだけにして出題を遅らせない。
  function bindVoicesChanged() {
    const engine = synthesis();
    if (voicesBound || typeof engine?.addEventListener !== "function") return;
    voicesBound = true;
    try {
      engine.addEventListener("voiceschanged", refreshVoices);
    } catch (error) {
      voicesBound = false;
      onWarning?.(error);
    }
  }

  return {
    supported() {
      return typeof synthesis()?.speak === "function";
    },
    // 声一覧の用意だけを行う。読み上げはしないので、どこから呼んでも副作用がない。
    prime() {
      bindVoicesChanged();
      refreshVoices();
    },
    // 再生中の読み上げを止める。学習をやめたときと、次の問題へ進むと決まった
    // ときに呼び、古い問題の音声が残らないようにする。
    stop() {
      const engine = synthesis();
      if (typeof engine?.cancel !== "function") return;
      try {
        engine.cancel();
      } catch (error) {
        onWarning?.(error);
      }
    },
    // 読み上げた場合だけ true。読み上げなかった理由（未対応・空文字・同じ問題）
    // では例外を投げず、呼び出し側の処理を止めない。
    speak(text, { token = null, lang = ENGLISH_SPEECH_LANG, rate = 1 } = {}) {
      const engine = synthesis();
      const Utterance = getUtteranceClass?.();
      if (typeof engine?.speak !== "function" || typeof Utterance !== "function") return false;
      const phrase = speechTextForEnglish(text);
      if (!phrase) return false;
      // 1問につき1回だけ。同じ問題の再描画では読み直さない。
      if (token !== null && token === lastToken) return false;
      lastToken = token;
      try {
        if (!voices.length) refreshVoices();
        // 直前の読み上げを必ず捨ててから話す。速く連続でスワイプしても
        // 古い問題の音声がキューに溜まらず、つねに最新の問題だけが読まれる。
        engine.cancel();
        const utterance = new Utterance(phrase);
        utterance.lang = lang;
        // 仕様上の下限・上限を外れると読み上げごと失敗するブラウザがあるので丸める。
        utterance.rate = Math.min(4, Math.max(0.5, Number(rate) || 1));
        const voice = pickEnglishVoice(voices, lang);
        if (voice) utterance.voice = voice;
        // 一時停止したまま復帰しないことがあるブラウザ向けの保険。
        if (engine.paused && typeof engine.resume === "function") engine.resume();
        engine.speak(utterance);
        return true;
      } catch (error) {
        onWarning?.(error);
        return false;
      }
    },
    // テストと、学習をやり直したときの状態リセット用。
    reset() {
      lastToken = null;
    },
  };
}
