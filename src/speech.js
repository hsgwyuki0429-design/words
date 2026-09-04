// 学習中に、いま表示している問題の英語を読み上げる。
// ブラウザ標準の Web Speech API だけを使い、外部サービスやAPIキーは使わない。
// 使えない環境（API が無い・音声が1つも無い・再生が拒否された）では黙って
// 何もしないだけで、出題・スワイプ・正誤判定・学習記録には一切影響しない。

export const ENGLISH_SPEECH_LANG = "en-US";

// 読み上げの速さ。設定画面で 0.5〜1.5 の5段階から選ぶ。値は
// SpeechSynthesisUtterance.rate に渡す倍率で、1 が各ブラウザの標準速度。
export const SPEECH_RATE_OPTIONS = Object.freeze([
  Object.freeze({ rate: 0.5, label: "×0.5", hint: "0.5倍速" }),
  Object.freeze({ rate: 0.75, label: "×0.75", hint: "0.75倍速" }),
  Object.freeze({ rate: 1, label: "×1.0", hint: "標準の速さ" }),
  Object.freeze({ rate: 1.25, label: "×1.25", hint: "1.25倍速" }),
  Object.freeze({ rate: 1.5, label: "×1.5", hint: "1.5倍速" }),
]);

export const DEFAULT_SPEECH_RATE = 1;

// 声の設定。"auto" のときは端末で使える中から自動で選ぶ。個別に選んだときは
// その声の識別子（voiceURI。無ければ name）を保存する。
export const SPEECH_VOICE_AUTO = "auto";

// 保存済みの設定が壊れていても必ず文字列に収める。空文字・長すぎる値・
// 文字列以外はすべて「自動」に戻す。選んだ声が今の端末に無い場合も、
// 読み上げ時に自動選択へ落ちるのでここでは弾かない。
export function normalizeSpeechVoiceURI(value) {
  if (typeof value !== "string") return SPEECH_VOICE_AUTO;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 300) return SPEECH_VOICE_AUTO;
  return trimmed;
}

// 保存済みの設定が古い・壊れていても、必ず用意した5段階のどれかに収める。
// 文字列で保存されていても数値として扱う。
export function normalizeSpeechRate(value) {
  const rate = Number(value);
  return SPEECH_RATE_OPTIONS.some((option) => option.rate === rate)
    ? rate
    : DEFAULT_SPEECH_RATE;
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
    // 略記は音声にすると読めないので展開する（give sth. to sb. → give something to somebody）
    .replace(/\bsth\b\.?/gi, "something")
    .replace(/\bsb\b\.?/gi, "somebody")
    // 省略記号・伏せ字は読み上げない（as ~ as → as as ではなく as, as）
    .replace(/[~〜～]/g, " ")
    .replace(/[…*＊]/g, " ")
    .replace(/\.{2,}/g, " ")
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

// 実際にエンジンへ渡す文字列。単語1語だけだと辞書読みのような平坦な音に
// なるエンジンが多いので、終止符を補って文として読ませる。画面表示や
// speechTextForEnglish() の結果は変えないので、テキスト比較には影響しない。
export function utteranceTextForEnglish(value) {
  const phrase = speechTextForEnglish(value);
  if (!phrase) return "";
  return /[.!?]$/.test(phrase) ? phrase : `${phrase}.`;
}

// 同じ英語でも、端末には機械的な声と自然な声が混ざって入っている。
// 特定の声の名前を必須条件にはせず（OS・ブラウザごとに顔ぶれが違うため）、
// 品質の手がかりを点数にして高いものから選ぶ。手がかりが1つも無い環境でも、
// 英語の声でありさえすれば必ずどれかが選ばれる。
const NATURAL_VOICE_HINT = /(natural|neural|enhanced|premium|online|siri)/i;

// 声の識別子。voiceURI が使えない環境では name で代用する。
export function voiceKey(voice) {
  const uri = typeof voice?.voiceURI === "string" ? voice.voiceURI.trim() : "";
  if (uri) return uri;
  const name = typeof voice?.name === "string" ? voice.name.trim() : "";
  return name || "";
}

// 声の good さの点数。大きいほど優先する。
export function scoreEnglishVoice(voice, preferredLang = ENGLISH_SPEECH_LANG) {
  if (!voice) return -1;
  let score = 0;
  // 望んだ地域（既定は en-US）を最優先。en-GB などより先に選ぶ。
  if (normalizeLang(voice.lang) === normalizeLang(preferredLang)) score += 8;
  // 端末内蔵ではない声＝クラウド合成で、ほぼ確実に自然な音質。
  if (voice.localService === false) score += 4;
  // 高品質版であることを示す名前の手がかり。あくまで加点で、必須ではない。
  if (NATURAL_VOICE_HINT.test(typeof voice.name === "string" ? voice.name : "")) score += 2;
  // 手がかりが並んだときだけ、ブラウザの既定の声を優先する。
  if (voice.default) score += 1;
  return score;
}

// 設定画面に出すための英語の声の一覧。点数の高い順で、同点なら端末が返した
// 並びのまま。英語以外は混ぜない。
export function listEnglishVoices(voices = [], preferredLang = ENGLISH_SPEECH_LANG) {
  return (Array.isArray(voices) ? voices : [])
    .filter((voice) => voice && typeof voice.lang === "string" && voiceKey(voice))
    .filter((voice) => normalizeLang(voice.lang).startsWith("en"))
    .map((voice, index) => ({ voice, index, score: scoreEnglishVoice(voice, preferredLang) }))
    .sort((left, right) => (right.score - left.score) || (left.index - right.index))
    .map((entry) => entry.voice);
}

// 読み上げに使う声を決める。設定で選ばれた声があればそれを使い、その声が
// 今の端末に無ければ自動選択へ落ちる。英語の声が1つも無ければ null を返し、
// lang 指定だけで標準の声へ委ねる。
export function pickEnglishVoice(
  voices = [],
  preferredLang = ENGLISH_SPEECH_LANG,
  preferredVoiceURI = SPEECH_VOICE_AUTO,
) {
  const english = listEnglishVoices(voices, preferredLang);
  if (!english.length) return null;
  const wanted = normalizeSpeechVoiceURI(preferredVoiceURI);
  if (wanted !== SPEECH_VOICE_AUTO) {
    const chosen = english.find((voice) => voiceKey(voice) === wanted);
    if (chosen) return chosen;
  }
  return english[0];
}

export function createEnglishSpeaker({
  getSynthesis = defaultSynthesis,
  getUtteranceClass = defaultUtteranceClass,
  onWarning = (error) => console.warn("英語の読み上げを実行できませんでした。", error),
  // 声一覧が入れ替わったときの通知。設定画面の声の選択肢を出し直すために使う。
  onVoicesChanged = null,
} = {}) {
  let voices = [];
  let voicesBound = false;
  // onVoicesChanged の通知中かどうか。通知からの再入を防ぐ。
  let notifying = false;
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
      if (!Array.isArray(list) || !list.length) return;
      const changed = list.length !== voices.length
        || list.some((voice, index) => voiceKey(voice) !== voiceKey(voices[index]));
      voices = list;
      // 一覧が変わったときだけ知らせる。中身が同じなら何もしない。
      // 通知先が声一覧を読みに来ても入れ子にならないよう、通知中は知らせない。
      if (changed && !notifying) {
        notifying = true;
        try {
          onVoicesChanged?.();
        } finally {
          notifying = false;
        }
      }
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
    // 設定画面に出す英語の声の一覧。まだ届いていなければ空配列。
    englishVoices(lang = ENGLISH_SPEECH_LANG) {
      if (!voices.length) refreshVoices();
      return listEnglishVoices(voices, lang);
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
    speak(text, {
      token = null,
      lang = ENGLISH_SPEECH_LANG,
      rate = 1,
      voiceURI = SPEECH_VOICE_AUTO,
    } = {}) {
      const engine = synthesis();
      const Utterance = getUtteranceClass?.();
      if (typeof engine?.speak !== "function" || typeof Utterance !== "function") return false;
      const phrase = utteranceTextForEnglish(text);
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
        const voice = pickEnglishVoice(voices, lang, voiceURI);
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
