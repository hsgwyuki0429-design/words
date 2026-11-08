// ---------------------------------------------------------------------------
// 効果音（SIMPLE・MAX 共通）
//
// 音はすべて Web Audio でその場で合成する（音声ファイルは持たない）。
// 設計の根拠と参考文献は docs/sound-design.md にまとめた。要点だけ書くと：
//
//   1. 素材の音にする … 木・紙・ガラス・水・石など、毎日聞いている物の音は意味が
//      すぐ伝わり（Gaver の auditory icons）、素材の違いは主に「減衰の速さ」で
//      聞き分けられる（Klatzky ら）。そこで、物が鳴るときの固有の振動（モード）を
//      減衰する正弦波の重ね合わせで作る（モード合成）。
//   2. 耳に刺さる帯域を避ける … 不快さは 2.5〜5.5kHz の強いエネルギーと結びつく
//      （Kumar ら）。高い倍音は弱く短くし、出口でもこの帯域をすこし下げる。
//   3. 濁らせない … 近い周波数の音が重なると濁る（Plomp & Levelt）。音程はすべて
//      C メジャー・ペンタトニック（ド・レ・ミ・ソ・ラ）にそろえ、半音や増4度を作らない。
//      わざと作る揺れ（ガラス・ボウル）は毎秒1〜4回の、ゆっくりしたものだけにする。
//   4. 大きくしない … うるささは心地よさを下げる（Zwicker & Fastl）。レアな音は
//      音量ではなく、響き・広がり・余韻の豊かさで特別にする（音量は測ってそろえる）。
//   5. 慣れさせない … 同じ音のくり返しは飽きる。毎回わずかに音程・強さ・響きを変え、
//      ごほうびの音はレア度つきの抽選にする。いつ来るか分からないごほうびは
//      期待そのものを心地よくする（Fiorillo, Tobler & Schultz）。
// ---------------------------------------------------------------------------

/** 再生を予約するときの、わずかな先読み（秒）。 */
const LOOKAHEAD = 0.005;
/** 同時に鳴らす音の上限。超えたら古いものから素早く消す。 */
export const SFX_MAX_VOICES = 14;
/** しばらく音を鳴らさなければ、電池のために音声の処理を止める（ミリ秒）。 */
const IDLE_SUSPEND_MS = 20_000;

export const SFX_RARITIES = Object.freeze({
  common: Object.freeze({ label: "コモン", rank: 0 }),
  uncommon: Object.freeze({ label: "アンコモン", rank: 1 }),
  rare: Object.freeze({ label: "レア", rank: 2 }),
  epic: Object.freeze({ label: "激レア", rank: 3 }),
  legendary: Object.freeze({ label: "伝説", rank: 4 }),
});

const variant = (id, name, family, rarity, weight) => Object.freeze({ id, name, family, rarity, weight });

/**
 * フラッシュカードをめくったときの音（めくり終えて、カードが落ち着く音）。
 * 上ほどよく出る。下へ行くほど響きが豊かで気持ちいい音にし、出にくくしてある。
 */
export const LANDING_VARIANTS = Object.freeze([
  variant("wood", "木の机に置く「トン」", "木", "common", 0.22),
  variant("felt", "紙の束に置く「ポフ」", "紙・布", "common", 0.2),
  variant("bamboo", "竹の「コン」", "竹", "common", 0.16),
  variant("go", "碁石を打つ「パチッ」", "石", "uncommon", 0.12),
  variant("ceramic", "陶器のカップを置く「コトッ」", "陶器", "uncommon", 0.1),
  variant("drop", "水滴の「ピチョン」", "水", "uncommon", 0.08),
  variant("glass", "ガラスのコップを置く「コトン…チン」", "ガラス", "rare", 0.055),
  variant("kalimba", "カリンバの「ポーン」", "金属の舌", "rare", 0.035),
  variant("ice", "氷とグラスの「カラン」", "氷とガラス", "epic", 0.02),
  variant("bowl", "クリスタルボウルの長い響き", "水晶", "legendary", 0.01),
]);

/**
 * 4択・入力の問題で正解したときの音。すべて明るく、協和する音程で上がる（「ピンポン」だけは
 * 日本で正解の合図として定着した下がり方）。下へ行くほど豪華で、出にくい。
 */
export const CORRECT_VARIANTS = Object.freeze([
  variant("marimba", "マリンバ「ポロン」", "木", "common", 0.22),
  variant("piano", "フェルトピアノ「ポ・ポーン」", "弦とフェルト", "common", 0.2),
  variant("pinpon", "鉄琴の「ピンポン」", "金属の棒", "common", 0.16),
  variant("bamboo", "竹のチャイム「カラコロン」", "竹", "uncommon", 0.12),
  variant("bubble", "水の泡「ポコ・ポコン」", "水", "uncommon", 0.1),
  variant("kalimba", "カリンバ「ポロロン」", "金属の舌", "uncommon", 0.08),
  variant("glass", "グラスで乾杯「チン・チーン」", "ガラス", "rare", 0.055),
  variant("handpan", "ハンドパン「ポワーン」", "鋼", "rare", 0.035),
  variant("musicbox", "オルゴール「キラリラン」", "オルゴール", "epic", 0.02),
  variant("harp", "クリスタルハープ「キラキラ…」", "水晶", "legendary", 0.01),
]);

export const SFX_EVENTS = Object.freeze([
  "tap",
  "toggle-on",
  "toggle-off",
  "key",
  "key-delete",
  "flip",
  "unflip",
  "swish",
  "slide",
  "land",
  "correct",
  "wrong",
]);

export const SFX_VOLUME_OPTIONS = Object.freeze([
  Object.freeze({ value: "soft", label: "小さめ" }),
  Object.freeze({ value: "normal", label: "ふつう" }),
  Object.freeze({ value: "loud", label: "大きめ" }),
]);

/** 出口の音量。ふつうでも控えめにしてある（音は小さいほうが心地よく、長く聞ける）。 */
const VOLUME_GAINS = Object.freeze({ soft: 0.5, normal: 0.78, loud: 1 });

export function normalizeSfxVolume(value) {
  return Object.hasOwn(VOLUME_GAINS, value) ? value : "normal";
}

export function sfxVolumeGain(value) {
  return VOLUME_GAINS[normalizeSfxVolume(value)];
}

/** 重みつきの抽選。random は 0 以上 1 未満を返す関数。 */
export function pickVariant(variants, random = Math.random) {
  const total = variants.reduce((sum, entry) => sum + entry.weight, 0);
  const value = Math.min(Math.max(Number(random()) || 0, 0), 0.9999999);
  let roll = value * total;
  for (const entry of variants) {
    roll -= entry.weight;
    if (roll < 0) return entry;
  }
  return variants.at(-1);
}

export function findVariant(variants, id) {
  return variants.find((entry) => entry.id === id) ?? null;
}

export function midiToHz(midi) {
  return 440 * (2 ** ((Number(midi) - 69) / 12));
}

// C メジャー・ペンタトニックの音だけを名前で使う（半音・増4度が生まれない）。
const NOTE_MIDI = Object.freeze({
  G3: 55, C4: 60, D4: 62, E4: 64, G4: 67, A4: 69,
  C5: 72, D5: 74, E5: 76, G5: 79, A5: 81,
  C6: 84, D6: 86, E6: 88, G6: 91, A6: 93,
  C7: 96, E7: 100, G7: 103,
});

export const SFX_NOTE_NAMES = Object.freeze(Object.keys(NOTE_MIDI));

function hz(name) {
  return midiToHz(NOTE_MIDI[name]);
}

// ---------------------------------------------------------------------------
// 音のレシピ
//
// どのレシピも (s, v, at, x) を受け取る。
//   s  … 合成の道具（mode：減衰する正弦波 / noise：形を付けた雑音）
//   v  … 1回の音（声）。ここへつなぐ
//   at … 鳴らし始める時刻（秒）
//   x  … 毎回の小さなゆらぎ。x.k は音程の倍率（±12セント）、x.r は乱数
// mode の decay は「60dB 下がるまでの秒数」。素材ごとの減衰の速さがそのまま質感になる。
// ---------------------------------------------------------------------------

// restrikes は「同じ物がもう一度ふれる」ときの再加振（rel は最初の強さに対する割合）。
// 新しい発振器を足すと位相の重なり方で音量が大きく変わるので、同じ振動を叩き直す。
function strike(s, v, at, frequency, partials, { attack = 0.0012, pan, restrikes = [] } = {}) {
  for (const [ratio, amp, decay] of partials) {
    s.mode(v, {
      at,
      freq: frequency * ratio,
      amp,
      decay,
      attack,
      pan,
      restrikes: restrikes.map((hit) => ({ at: hit.at, amp: amp * hit.rel })),
    });
  }
}

// 紙と紙が擦れる「サッ」。粒立った雑音（紙の繊維がこすれる細かいプチプチ）を帯域で切り出し、
// 中心の高さを動かして「めくる」動きを出す。耳に刺さる帯域より下を中心にし、
// 6.5kHz より上の空気感をほんの少し足して、パリッとした手ざわりにする。
function paperSwish(s, v, at, x, { from, to, duration, flapAt, airAmp = 0.16, attackRatio = 0.38 }) {
  const shift = 1 + (x.r() - 0.5) * 0.18;
  const length = duration * (0.92 + x.r() * 0.16);
  s.noise(v, {
    at,
    dur: length,
    buffer: "grain",
    type: "bandpass",
    freq: from * shift,
    endFreq: to * shift,
    q: 1.1,
    amp: 1,
    attack: length * attackRatio,
    highpass: 650,
    lowpass: 5200,
  });
  s.noise(v, {
    at: at + length * 0.2,
    dur: length * 0.7,
    buffer: "grain",
    type: "highpass",
    freq: 6500,
    q: 0.6,
    amp: airAmp,
    attack: length * 0.3,
  });
  // カードが返るときに空気が動く「ふわっ」。低い雑音をごく短く。
  if (flapAt !== null) {
    s.noise(v, { at: at + length * flapAt, dur: 0.075, type: "lowpass", freq: 360, q: 0.6, amp: 0.36, attack: 0.014 });
  }
}

// カードが机の上をすべっていく音。めくる音より長く、遠ざかるように暗くなる。
function paperSlide(s, v, at, x, direction) {
  const length = 0.21 * (0.94 + x.r() * 0.12);
  const rising = direction === "up";
  const falling = direction === "down";
  const from = rising ? 1100 : falling ? 1600 : 1650;
  const to = rising ? 2100 : falling ? 780 : 850;
  const shift = 1 + (x.r() - 0.5) * 0.14;
  s.noise(v, {
    at,
    dur: length,
    buffer: "grain",
    type: "bandpass",
    freq: from * shift,
    endFreq: to * shift,
    q: 1,
    amp: 1,
    attack: length * 0.22,
    highpass: 600,
    lowpass: 4800,
  });
  s.noise(v, { at: at + 0.01, dur: length * 0.6, buffer: "grain", type: "highpass", freq: 6800, q: 0.6, amp: 0.1, attack: length * 0.2 });
  // 払った方向へ音も動かす。
  const side = direction === "left" ? -0.55 : direction === "right" ? 0.55 : 0;
  if (v.panner && side) {
    v.panner.pan.setValueAtTime(0, at);
    v.panner.pan.linearRampToValueAtTime(side, at + length);
  }
}

function woodBead(s, v, at, frequency, { amp = 1, decay = 0.055 } = {}) {
  // 小さな木の玉を指で押したような「コッ」。高い倍音はすぐ消し、角を丸くする。
  s.noise(v, { at, dur: 0.006, type: "lowpass", freq: 2200, q: 0.5, amp: 0.22 * amp, attack: 0.0004 });
  s.mode(v, { at, freq: frequency, amp: 0.55 * amp, decay, attack: 0.0007 });
  s.mode(v, { at, freq: frequency * 2, amp: 0.2 * amp, decay: decay * 0.6, attack: 0.0007 });
  s.mode(v, { at, freq: frequency * 2.76, amp: 0.08 * amp, decay: decay * 0.4, attack: 0.0007 });
  s.mode(v, { at, freq: frequency / 4, amp: 0.28 * amp, decay: decay * 0.75, attack: 0.002 });
}

const SOUNDS = {
  // --- ボタン・スイッチ・キー ------------------------------------------------
  tap: {
    send: 0.03,
    build(s, v, at, x) {
      // ふつうのボタンは、よく効いたスイッチのような「カチッ」というクリック音。
      // ごく短い接点の音（押す）と、わずかに遅れた戻りの音（離す）の2つで、角を立てすぎない。
      const brightness = 1 + (x.r() - 0.5) * 0.1;
      s.noise(v, { at, dur: 0.006, type: "bandpass", freq: 2600 * brightness, q: 1.2, amp: 0.9, attack: 0.0003, lowpass: 6000 });
      s.mode(v, { at, freq: hz("C7") * x.k, amp: 0.12, decay: 0.018, attack: 0.0004 });
      s.mode(v, { at, freq: hz("C6") * x.k, amp: 0.18, decay: 0.025, attack: 0.0004 });
      const release = at + 0.028 + x.r() * 0.004;
      s.noise(v, { at: release, dur: 0.004, type: "bandpass", freq: 3400 * brightness, q: 1.2, amp: 0.35, attack: 0.0003, lowpass: 6000 });
    },
  },
  "toggle-on": {
    send: 0.08,
    build(s, v, at, x) {
      woodBead(s, v, at, hz("G5") * x.k, { amp: 0.8 });
      s.mode(v, { at: at + 0.06, freq: hz("C6") * x.k, amp: 0.3, decay: 0.16, attack: 0.002 });
      s.mode(v, { at: at + 0.06, freq: hz("C6") * x.k * 2, amp: 0.04, decay: 0.06, attack: 0.002 });
    },
  },
  "toggle-off": {
    send: 0.06,
    build(s, v, at, x) {
      woodBead(s, v, at, hz("C6") * x.k, { amp: 0.7 });
      s.mode(v, { at: at + 0.06, freq: hz("G5") * x.k, amp: 0.24, decay: 0.11, attack: 0.002 });
    },
  },
  key: {
    send: 0.03,
    build(s, v, at, x) {
      // 打つたびに近い音が選ばれ、くり返しても機械的にならない。
      const notes = ["E5", "G5", "A5", "C6"];
      const note = notes[Math.floor(x.r() * notes.length) % notes.length];
      woodBead(s, v, at, hz(note) * x.k, { amp: 0.75, decay: 0.04 });
    },
  },
  "key-delete": {
    send: 0.03,
    build(s, v, at, x) {
      woodBead(s, v, at, hz("C5") * x.k, { amp: 0.75, decay: 0.045 });
    },
  },

  // --- 紙の音（めくる・すべらせる） ---------------------------------------
  "swish-up": {
    send: 0.06,
    build(s, v, at, x) {
      paperSwish(s, v, at, x, { from: 1250, to: 2500, duration: 0.15, flapAt: 0.5 });
    },
  },
  "swish-down": {
    send: 0.06,
    build(s, v, at, x) {
      paperSwish(s, v, at, x, { from: 2300, to: 1200, duration: 0.14, flapAt: 0.42 });
    },
  },
  "slide-left": { send: 0.05, build: (s, v, at, x) => paperSlide(s, v, at, x, "left") },
  "slide-right": { send: 0.05, build: (s, v, at, x) => paperSlide(s, v, at, x, "right") },
  "slide-up": { send: 0.05, build: (s, v, at, x) => paperSlide(s, v, at, x, "up") },
  "slide-down": { send: 0.05, build: (s, v, at, x) => paperSlide(s, v, at, x, "down") },

  // --- めくった音（10種） ----------------------------------------------------
  "land-wood": {
    send: 0.08,
    build(s, v, at, x) {
      // 木は内部の損失が大きく、すぐ減衰する。低い胴鳴りと、短い中域。
      s.noise(v, { at, dur: 0.012, type: "bandpass", freq: 1100, q: 0.7, amp: 0.7, attack: 0.0005 });
      strike(s, v, at, hz("G4") * x.k, [[1, 0.75, 0.14], [2, 0.5, 0.09], [2.31, 0.55, 0.065], [4.12, 0.2, 0.035]]);
      s.mode(v, { at, freq: hz("G3") * x.k, amp: 0.3, decay: 0.08, attack: 0.002 });
    },
  },
  "land-felt": {
    send: 0.06,
    build(s, v, at, x) {
      // 紙の束やフェルトに置いたときの、ふんわりした「ポフ」。高い音を含まない。
      s.noise(v, { at, dur: 0.11, type: "lowpass", freq: 1300, endFreq: 450, q: 0.5, amp: 0.7, attack: 0.012, highpass: 320 });
      s.noise(v, { at, dur: 0.065, type: "bandpass", freq: 900, q: 0.8, amp: 0.55, attack: 0.009 });
      s.mode(v, { at, freq: hz("C4") * x.k, amp: 0.14, decay: 0.09, attack: 0.006 });
      s.mode(v, { at, freq: hz("G4") * x.k, amp: 0.16, decay: 0.06, attack: 0.003 });
      s.mode(v, { at, freq: hz("C5") * x.k, amp: 0.1, decay: 0.045, attack: 0.003 });
    },
  },
  "land-bamboo": {
    send: 0.1,
    build(s, v, at, x) {
      // 竹の筒の中の空気が鳴る、うつろな「コン」。
      const frequency = hz("E5") * x.k;
      s.noise(v, { at, dur: 0.006, type: "highpass", freq: 1600, q: 0.6, amp: 0.2, attack: 0.0005 });
      s.noise(v, { at, dur: 0.06, type: "bandpass", freq: frequency, q: 16, amp: 1.6, attack: 0.0008 });
      strike(s, v, at, frequency, [[1, 0.75, 0.17], [2.76, 0.14, 0.05], [5.4, 0.05, 0.025]]);
    },
  },
  "land-go": {
    send: 0.1,
    build(s, v, at, x) {
      // 硬い石が盤に当たる鋭い一瞬と、榧（かや）の碁盤の木の響き。石はわずかに跳ねる。
      const bounce = at + 0.016 + x.r() * 0.004;
      s.noise(v, { at, dur: 0.005, type: "bandpass", freq: 3000, q: 0.7, amp: 0.7, attack: 0.0003 });
      s.mode(v, { at, freq: hz("C7") * x.k, amp: 0.2, decay: 0.035, attack: 0.0004, restrikes: [{ at: bounce, amp: 0.06 }] });
      s.mode(v, { at, freq: hz("G5") * x.k, amp: 0.4, decay: 0.07, attack: 0.0006, restrikes: [{ at: bounce, amp: 0.09 }] });
      s.mode(v, { at, freq: hz("C5") * x.k, amp: 0.45, decay: 0.11, attack: 0.001 });
      s.mode(v, { at, freq: hz("C4") * x.k, amp: 0.3, decay: 0.06, attack: 0.0015 });
      s.noise(v, { at: bounce, dur: 0.004, type: "bandpass", freq: 3300, q: 0.8, amp: 0.22, attack: 0.0003 });
    },
  },
  "land-ceramic": {
    send: 0.14,
    build(s, v, at, x) {
      // 陶器は木より長く、ガラスより短く鳴る。カップが落ち着くまでの2回の接触「コト」。
      const frequency = hz("A5") * x.k;
      const settle = at + 0.028 + x.r() * 0.004;
      s.noise(v, { at, dur: 0.008, type: "bandpass", freq: 2200, q: 1.1, amp: 0.4, attack: 0.0005 });
      strike(s, v, at, frequency, [[1, 0.55, 0.26], [2.39, 0.2, 0.13], [4.4, 0.07, 0.06], [6.9, 0.025, 0.03]], {
        restrikes: [{ at: settle, rel: 0.35 }],
      });
      s.mode(v, { at, freq: hz("E4") * x.k, amp: 0.35, decay: 0.06, attack: 0.0015 });
      s.noise(v, { at: settle, dur: 0.006, type: "bandpass", freq: 1800, q: 1, amp: 0.18, attack: 0.0005 });
    },
  },
  "land-drop": {
    send: 0.3,
    build(s, v, at, x) {
      // 水滴が水面に落ちると、小さな泡の共鳴が一瞬で高くなる（「ピチョン」の正体）。
      const frequency = hz("E5") * x.k;
      s.noise(v, { at, dur: 0.005, type: "lowpass", freq: 2600, q: 0.5, amp: 0.12, attack: 0.0005 });
      s.mode(v, { at: at + 0.003, freq: frequency, glide: 2, glideTime: 0.05, amp: 0.9, decay: 0.13, attack: 0.002 });
      s.mode(v, { at: at + 0.003, freq: frequency * 2, glide: 2, glideTime: 0.05, amp: 0.07, decay: 0.05, attack: 0.002 });
      // あとから落ちる、小さなしずく
      s.mode(v, { at: at + 0.07 + x.r() * 0.015, freq: hz("C6") * x.k, glide: 1.5, glideTime: 0.03, amp: 0.17, decay: 0.07, attack: 0.002 });
    },
  },
  "land-glass": {
    send: 0.28,
    build(s, v, at, x) {
      // 底がテーブルに当たる鈍い音のあと、ガラスが澄んで長く鳴る。置いたあと一度だけ揺れる。
      const frequency = hz("A5") * x.k;
      const rock = at + 0.042 + x.r() * 0.006;
      s.noise(v, { at, dur: 0.016, type: "lowpass", freq: 1500, q: 0.6, amp: 0.5, attack: 0.001 });
      s.mode(v, { at, freq: hz("G3") * x.k, amp: 0.38, decay: 0.08, attack: 0.002 });
      strike(s, v, at + 0.002, frequency, [[1, 0.5, 1.3], [2.71, 0.15, 0.5], [5.12, 0.05, 0.2], [8.3, 0.015, 0.08]], {
        restrikes: [{ at: rock, rel: 0.3 }],
      });
      s.noise(v, { at: rock, dur: 0.008, type: "lowpass", freq: 1800, q: 0.6, amp: 0.16, attack: 0.0008 });
    },
  },
  "land-kalimba": {
    send: 0.22,
    build(s, v, at, x) {
      // カリンバの金属の舌は、基音が澄んで長く、上の振動（6.27倍）はすぐ消える。木箱も少し鳴る。
      const frequency = hz("E5") * x.k;
      s.noise(v, { at, dur: 0.008, type: "bandpass", freq: 1200, q: 0.9, amp: 0.16, attack: 0.0006 });
      s.mode(v, { at, freq: frequency, amp: 0.85, decay: 1.0, attack: 0.002 });
      s.mode(v, { at, freq: frequency * 2, amp: 0.07, decay: 0.3, attack: 0.002 });
      s.mode(v, { at, freq: frequency * 6.27, amp: 0.06, decay: 0.07, attack: 0.001 });
      s.mode(v, { at, freq: hz("C4") * x.k, amp: 0.18, decay: 0.12, attack: 0.002 });
    },
  },
  "land-ice": {
    send: 0.32,
    build(s, v, at, x) {
      // 氷がグラスの内側に当たる「カ」、もう一度ふれて鳴る「ラン」、最後に小さく一回。
      const clink = (time, frequency, amp, ring, pan) => {
        s.noise(v, { at: time, dur: 0.0035, type: "highpass", freq: 2400, q: 0.6, amp: 0.2 * amp, attack: 0.0003, pan });
        strike(s, v, time, frequency, [[1, amp * 0.5, ring], [2.42, amp * 0.12, ring * 0.38], [4.4, amp * 0.035, ring * 0.16]], { pan });
      };
      clink(at, hz("G6") * x.k, 1, 0.75, -0.18);
      // 氷どうしがこすれる、小さな音
      s.noise(v, { at: at + 0.018, dur: 0.03, type: "bandpass", freq: 1300, q: 2, amp: 0.12, attack: 0.002 });
      clink(at + 0.072 + x.r() * 0.01, hz("E6") * x.k, 0.62, 0.95, 0.2);
      clink(at + 0.122 + x.r() * 0.012, hz("C7") * x.k, 0.22, 0.55, 0.05);
    },
  },
  "land-bowl": {
    send: 0.45,
    build(s, v, at, x) {
      // クリスタルボウル。各振動が2つにわずかに分かれていて、毎秒1〜4回ほどゆっくり揺れる
      // （濁りを生む速い揺れの帯域よりずっと遅い）。左右に分けて置き、揺れが空間で回る。
      const frequency = hz("C5") * x.k;
      s.noise(v, { at, dur: 0.03, type: "lowpass", freq: 520, q: 0.6, amp: 0.3, attack: 0.003 });
      for (const [ratio, amp, decay] of [[1, 0.6, 2.8], [2.71, 0.3, 1.6], [5.05, 0.08, 0.8], [7.9, 0.02, 0.35]]) {
        s.mode(v, { at, freq: frequency * ratio, amp, decay, attack: 0.004, pan: -0.25 });
        s.mode(v, { at, freq: frequency * ratio + 0.9 + ratio * 0.4, amp: amp * 0.55, decay: decay * 0.9, attack: 0.004, pan: 0.25 });
      }
      // 光が差すような、ごく小さなきらめき
      for (const [delay, note, pan] of [[0.16, "G6", -0.5], [0.3, "C7", 0.45], [0.47, "E7", -0.2]]) {
        s.mode(v, { at: at + delay, freq: hz(note) * x.k, amp: 0.04, decay: 0.9, attack: 0.006, pan });
      }
    },
  },

  // --- 正解の音（10種） ------------------------------------------------------
  "correct-marimba": {
    send: 0.18,
    build(s, v, at, x) {
      // ソ→ド。属音から主音へ上がって「着地」する、いちばん安定した終わり方。
      const bar = (time, note, amp, decay) => {
        const frequency = hz(note) * x.k;
        s.noise(v, { at: time, dur: 0.007, type: "lowpass", freq: 1800, q: 0.6, amp: 0.14 * amp, attack: 0.0006 });
        strike(s, v, time, frequency, [[1, amp, decay], [3.93, amp * 0.2, decay * 0.28], [9.2, amp * 0.035, decay * 0.1]]);
      };
      bar(at, "G5", 0.75, 0.45);
      bar(at + 0.09, "C6", 1, 0.6);
    },
  },
  "correct-piano": {
    send: 0.2,
    build(s, v, at, x) {
      // フェルトを挟んだピアノのやわらかい音。2本の弦がわずかにずれ、ゆっくり揺れて温かくなる。
      const key = (time, note, amp, decay, pan) => {
        const frequency = hz(note) * x.k;
        s.noise(v, { at: time, dur: 0.02, type: "lowpass", freq: 700, q: 0.6, amp: 0.12 * amp, attack: 0.002, pan });
        for (const [harmonic, rel, decayRel] of [[1, 1, 1], [2, 0.42, 0.6], [3, 0.14, 0.4], [4, 0.05, 0.28]]) {
          const stretch = Math.sqrt(1 + 0.0004 * harmonic * harmonic);
          s.mode(v, { at: time, freq: frequency * harmonic * stretch, amp: amp * rel, decay: decay * decayRel, attack: 0.004, pan });
        }
        s.mode(v, { at: time, freq: frequency * 1.0012, amp: amp * 0.32, decay: decay * 0.9, attack: 0.004, pan: -pan });
      };
      key(at, "C5", 0.62, 0.9, -0.15);
      key(at + 0.1, "G5", 0.8, 1.1, 0.12);
      key(at + 0.1, "C6", 0.32, 0.9, 0.2);
    },
  },
  "correct-pinpon": {
    send: 0.2,
    build(s, v, at, x) {
      // 日本のクイズで「正解」の合図として耳になじんだ「ピンポン」（ミ→ド）。鉄琴の澄んだ音で。
      const bar = (time, note, amp, decay) => {
        const frequency = hz(note) * x.k;
        s.noise(v, { at: time, dur: 0.005, type: "bandpass", freq: 2500, q: 0.8, amp: 0.08 * amp, attack: 0.0004 });
        strike(s, v, time, frequency, [[1, amp, decay], [4, amp * 0.06, decay * 0.3]]);
      };
      bar(at, "E6", 0.7, 0.55);
      bar(at + 0.19, "C6", 0.85, 0.95);
    },
  },
  "correct-bamboo": {
    send: 0.16,
    build(s, v, at, x) {
      // 竹の筒を3本、低い方から順に鳴らす「カラコロン」。
      const tube = (time, note, amp, decay, pan) => {
        const frequency = hz(note) * x.k;
        s.noise(v, { at: time, dur: 0.045, type: "bandpass", freq: frequency, q: 14, amp: 1.3 * amp, attack: 0.0008, pan });
        strike(s, v, time, frequency, [[1, amp * 0.7, decay], [2.76, amp * 0.12, decay * 0.3], [5.4, amp * 0.035, decay * 0.15]], { pan });
      };
      tube(at, "E5", 0.7, 0.2, -0.3);
      tube(at + 0.06, "G5", 0.8, 0.22, 0);
      tube(at + 0.12, "C6", 1, 0.3, 0.3);
    },
  },
  "correct-bubble": {
    send: 0.25,
    build(s, v, at, x) {
      // 泡が2つ、ド→ソ、ソ→ドへと音程を上げながらはじける。
      const bubble = (time, note, glide, amp, decay) => {
        const frequency = hz(note) * x.k;
        s.mode(v, { at: time, freq: frequency, glide, glideTime: 0.045, amp, decay, attack: 0.002 });
        s.mode(v, { at: time, freq: frequency * 2, glide, glideTime: 0.045, amp: amp * 0.06, decay: decay * 0.4, attack: 0.002 });
      };
      bubble(at, "C5", 1.5, 0.7, 0.12);
      bubble(at + 0.1, "G5", 4 / 3, 0.95, 0.17);
      bubble(at + 0.19 + x.r() * 0.02, "E6", 1.25, 0.14, 0.07);
    },
  },
  "correct-kalimba": {
    send: 0.24,
    build(s, v, at, x) {
      // ド・ミ・ソ・ド。カリンバの和音を指で順にはじく。
      const tine = (time, note, amp, decay) => {
        const frequency = hz(note) * x.k;
        s.noise(v, { at: time, dur: 0.007, type: "bandpass", freq: 1300, q: 0.9, amp: 0.12 * amp, attack: 0.0006 });
        s.mode(v, { at: time, freq: frequency, amp, decay, attack: 0.002 });
        s.mode(v, { at: time, freq: frequency * 2, amp: amp * 0.07, decay: decay * 0.3, attack: 0.002 });
        s.mode(v, { at: time, freq: frequency * 6.27, amp: amp * 0.05, decay: 0.06, attack: 0.001 });
      };
      tine(at, "C5", 0.5, 0.8);
      tine(at + 0.07, "E5", 0.55, 0.85);
      tine(at + 0.14, "G5", 0.62, 0.9);
      tine(at + 0.21, "C6", 0.82, 1.1);
      s.mode(v, { at, freq: hz("C4") * x.k, amp: 0.14, decay: 0.15, attack: 0.002 });
    },
  },
  "correct-glass": {
    send: 0.3,
    build(s, v, at, x) {
      // 乾杯。2つのグラスはわずかに音程がちがい、ゆっくり揺れながら響く（毎秒2〜3回）。
      const clink = (time, note, amp, ring, pan) => {
        const frequency = hz(note) * x.k;
        s.noise(v, { at: time, dur: 0.004, type: "highpass", freq: 2200, q: 0.6, amp: 0.22 * amp, attack: 0.0003, pan });
        strike(s, v, time, frequency, [[1, amp * 0.55, ring], [2.66, amp * 0.15, ring * 0.42], [4.9, amp * 0.04, ring * 0.18]], { pan });
        s.mode(v, { at: time, freq: frequency * 1.0025, amp: amp * 0.3, decay: ring * 0.9, attack: 0.0015, pan: -pan });
      };
      clink(at, "A5", 0.55, 0.6, -0.2);
      clink(at + 0.15, "E6", 1, 1.4, 0.2);
    },
  },
  "correct-handpan": {
    send: 0.36,
    build(s, v, at, x) {
      // ハンドパンは基音・オクターブ・その上の5度（3倍）がそろうように調律される。
      // レ→ラの完全5度で、開放的に、長く響かせる。
      const note = (time, name, amp, decay, pan) => {
        const frequency = hz(name) * x.k;
        s.noise(v, { at: time, dur: 0.018, type: "lowpass", freq: 900, q: 0.7, amp: 0.15 * amp, attack: 0.002, pan });
        s.mode(v, { at: time, freq: frequency, amp, decay, attack: 0.006, pan });
        s.mode(v, { at: time, freq: frequency * 2, amp: amp * 0.42, decay: decay * 0.75, attack: 0.008, pan });
        s.mode(v, { at: time, freq: frequency * 3, amp: amp * 0.15, decay: decay * 0.5, attack: 0.01, pan });
        s.mode(v, { at: time, freq: frequency * 1.0018, amp: amp * 0.25, decay, attack: 0.006, pan: -pan });
      };
      note(at, "D5", 0.72, 1.3, -0.2);
      note(at + 0.13, "A5", 0.9, 1.6, 0.2);
    },
  },
  "correct-musicbox": {
    send: 0.32,
    build(s, v, at, x) {
      // オルゴールの櫛歯をはじく。ソ・ド・ミ・ソと駆け上がり、最後に低いドが支える。
      const pluck = (time, name, amp, pan) => {
        const frequency = hz(name) * x.k;
        s.noise(v, { at: time, dur: 0.004, type: "highpass", freq: 3000, q: 0.6, amp: 0.06 * amp, attack: 0.0003, pan });
        s.mode(v, { at: time, freq: frequency, amp, decay: 1.2, attack: 0.0015, pan });
        s.mode(v, { at: time, freq: frequency * 2, amp: amp * 0.05, decay: 0.4, attack: 0.0015, pan });
        s.mode(v, { at: time, freq: frequency * 6.27, amp: amp * 0.035, decay: 0.08, attack: 0.001, pan });
      };
      pluck(at, "G5", 0.55, -0.3);
      pluck(at + 0.085, "C6", 0.6, -0.1);
      pluck(at + 0.17, "E6", 0.66, 0.1);
      pluck(at + 0.255, "G6", 0.78, 0.3);
      pluck(at + 0.255, "C5", 0.32, 0);
    },
  },
  "correct-harp": {
    send: 0.42,
    build(s, v, at, x) {
      // 7つの音が左から右へ駆け上がり、最後に和音がふわっと広がって、光の粒が散る。
      const notes = ["C5", "E5", "G5", "A5", "C6", "E6", "G6"];
      notes.forEach((name, index) => {
        const time = at + index * 0.048;
        const frequency = hz(name) * x.k;
        const pan = -0.6 + (1.2 * index) / (notes.length - 1);
        const amp = 0.4 + index * 0.045;
        s.noise(v, { at: time, dur: 0.003, type: "highpass", freq: 2500, q: 0.6, amp: 0.05, attack: 0.0003, pan });
        s.mode(v, { at: time, freq: frequency, amp, decay: 1.5, attack: 0.002, pan });
        s.mode(v, { at: time, freq: frequency * 2, amp: amp * 0.16, decay: 0.7, attack: 0.002, pan });
        s.mode(v, { at: time, freq: frequency * 3, amp: amp * 0.04, decay: 0.3, attack: 0.002, pan });
      });
      const bloom = at + notes.length * 0.048 + 0.02;
      for (const [name, pan] of [["C5", -0.35], ["G5", 0.35], ["C6", 0.2], ["E6", -0.15]]) {
        const frequency = hz(name) * x.k;
        s.mode(v, { at: bloom, freq: frequency, amp: 0.12, decay: 1.6, attack: 0.18, pan });
        s.mode(v, { at: bloom, freq: frequency * 1.002, amp: 0.07, decay: 1.5, attack: 0.22, pan: -pan });
      }
      [["G6", 0.36], ["C7", 0.5], ["E7", 0.66], ["G7", 0.8]].forEach(([name, delay], index) => {
        s.mode(v, { at: at + delay, freq: hz(name) * x.k, amp: 0.045, decay: 0.7, attack: 0.004, pan: index % 2 ? 0.55 : -0.55 });
      });
    },
  },

  // --- 不正解の音（1種） ------------------------------------------------------
  wrong: {
    send: 0.08,
    build(s, v, at, x) {
      // 正解と同じ「木」の世界のまま、低く・こもらせ・下がる2音（ド→ソ）。2音目は少しだけ
      // 音程が沈む。ブザーのような濁った音は使わない（罰ではなく、気づかせるだけにする）。
      const thud = (time, note, amp, droop) => {
        const frequency = hz(note) * x.k;
        // スマホの小さなスピーカーは低い基音をほとんど鳴らせない。2〜4倍の倍音を持たせると、
        // 基音が出なくても耳は元の低い音程を補って聞く（ミッシング・ファンダメンタル）。
        s.noise(v, { at: time, dur: 0.035, type: "bandpass", freq: 900, q: 0.7, amp: 0.3 * amp, attack: 0.002 });
        s.mode(v, { at: time, freq: frequency, glide: droop, glideTime: 0.18, amp: amp * 0.7, decay: 0.26, attack: 0.008 });
        s.mode(v, { at: time, freq: frequency * 2, glide: droop, glideTime: 0.18, amp: amp * 0.62, decay: 0.18, attack: 0.008 });
        s.mode(v, { at: time, freq: frequency * 3, glide: droop, glideTime: 0.18, amp: amp * 0.3, decay: 0.11, attack: 0.008 });
        s.mode(v, { at: time, freq: frequency * 4, glide: droop, glideTime: 0.18, amp: amp * 0.11, decay: 0.06, attack: 0.006 });
      };
      thud(at, "C5", 0.75, 0);
      thud(at + 0.13, "G4", 1, 0.955);
    },
  },
};

export const SFX_SOUND_IDS = Object.freeze(Object.keys(SOUNDS));

/**
 * 音ごとの音量の補正。tools/measure-sfx.mjs で Chromium に書き出し、聴感の大きさ（K特性）と
 * スマホのスピーカー相当の大きさ（600Hz より下を落とす）の平均が、種類ごとの目標になるようにそろえた値。
 * レアな音ほど大きくする、はしない（目標は docs/sound-design.md）。
 */
export const SFX_LEVELS = Object.freeze({
  tap: 4.84,
  "toggle-on": 0.568,
  "toggle-off": 0.8,
  key: 1.66,
  "key-delete": 1.94,
  "swish-up": 1.54,
  "swish-down": 1.55,
  "slide-left": 1.61,
  "slide-right": 1.61,
  "slide-up": 1.7,
  "slide-down": 1.64,
  "land-wood": 1.41,
  "land-felt": 3.82,
  "land-bamboo": 1.06,
  "land-go": 2.47,
  "land-ceramic": 0.583,
  "land-drop": 0.796,
  "land-glass": 0.263,
  "land-kalimba": 0.276,
  "land-ice": 0.301,
  "land-bowl": 0.17,
  "correct-marimba": 0.25,
  "correct-piano": 0.187,
  "correct-pinpon": 0.256,
  "correct-bamboo": 0.394,
  "correct-bubble": 0.493,
  "correct-kalimba": 0.233,
  "correct-glass": 0.21,
  "correct-handpan": 0.149,
  "correct-musicbox": 0.188,
  "correct-harp": 0.145,
  wrong: 0.319,
});

/** 全体の出口の大きさ。音ごとの大きさは SFX_LEVELS でそろえてあるので、ここは基準の1。 */
const OUTPUT_TRIM = 1;

/** カードを払った方向から、すべる音を選ぶ。 */
function slideSoundFor(direction) {
  return ["left", "right", "up", "down"].includes(direction) ? `slide-${direction}` : "slide-right";
}

/**
 * 1つの出来事（めくる・正解など）を、どの音をいつ鳴らすかの計画にする。
 * 抽選もここで行う。音は鳴らさないので、テストからそのまま確かめられる。
 */
export function planSfxEvent(event, { variant = null, direction = null, up = true, random = Math.random } = {}) {
  switch (event) {
    case "flip": {
      const landing = (variant && findVariant(LANDING_VARIANTS, variant)) || pickVariant(LANDING_VARIANTS, random);
      return {
        event,
        variant: landing.id,
        rarity: landing.rarity,
        // 紙が擦れる音の山のすぐあとに、カードが落ち着く音を重ねる（「サッ…トン」）。
        sounds: [{ id: "swish-up", offset: 0 }, { id: `land-${landing.id}`, offset: 0.075 }],
      };
    }
    case "land": {
      const landing = (variant && findVariant(LANDING_VARIANTS, variant)) || pickVariant(LANDING_VARIANTS, random);
      return { event, variant: landing.id, rarity: landing.rarity, sounds: [{ id: `land-${landing.id}`, offset: 0 }] };
    }
    case "unflip":
      return { event, variant: null, rarity: null, sounds: [{ id: "swish-down", offset: 0 }] };
    case "swish":
      return { event, variant: null, rarity: null, sounds: [{ id: up ? "swish-up" : "swish-down", offset: 0 }] };
    case "slide":
      return { event, variant: null, rarity: null, sounds: [{ id: slideSoundFor(direction), offset: 0 }] };
    case "correct": {
      const reward = (variant && findVariant(CORRECT_VARIANTS, variant)) || pickVariant(CORRECT_VARIANTS, random);
      return { event, variant: reward.id, rarity: reward.rarity, sounds: [{ id: `correct-${reward.id}`, offset: 0 }] };
    }
    case "wrong":
    case "tap":
    case "toggle-on":
    case "toggle-off":
    case "key":
    case "key-delete":
      return { event, variant: null, rarity: null, sounds: [{ id: event, offset: 0 }] };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// 音の土台（リアルタイムでも書き出しでも同じものを使う）
// ---------------------------------------------------------------------------

function createNoiseBuffers(context, random) {
  const rate = context.sampleRate;
  const white = context.createBuffer(1, Math.max(1, Math.floor(rate * 1.5)), rate);
  const whiteData = white.getChannelData(0);
  for (let index = 0; index < whiteData.length; index += 1) whiteData[index] = random() * 2 - 1;

  // 紙の繊維がこすれる、粒立った雑音。小さな「プチ」が1秒に約1400回、ランダムに混ざる。
  const grain = context.createBuffer(1, Math.max(1, Math.floor(rate * 1.2)), rate);
  const grainData = grain.getChannelData(0);
  const crackleDecay = Math.exp(-1 / (rate * 0.0012));
  const crackleChance = 1400 / rate;
  let crackle = 0;
  let drift = 0.5;
  let peak = 0;
  for (let index = 0; index < grainData.length; index += 1) {
    if (random() < crackleChance) crackle += 0.4 + random() * 0.9;
    crackle *= crackleDecay;
    drift = Math.min(0.7, Math.max(0.3, drift + (random() - 0.5) * 0.002));
    const sample = (random() * 2 - 1) * (drift * 0.55 + crackle);
    grainData[index] = sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  if (peak > 0) for (let index = 0; index < grainData.length; index += 1) grainData[index] *= 0.9 / peak;
  return { white, grain };
}

// 小さめのホールの残響。高い音から先に消えていく（空気と壁が高い音を吸うため）。
function createImpulseResponse(context, random) {
  const rate = context.sampleRate;
  const seconds = 1.2;
  const length = Math.max(1, Math.floor(rate * seconds));
  const impulse = context.createBuffer(2, length, rate);
  const predelay = Math.floor(rate * 0.011);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    let smoothed = 0;
    for (let index = predelay; index < length; index += 1) {
      const time = (index - predelay) / rate;
      const envelope = Math.exp((-time * 6.9) / 1.05);
      const brightness = 0.08 + 0.6 * Math.exp(-time / 0.18);
      smoothed += brightness * ((random() * 2 - 1) - smoothed);
      data[index] = smoothed * envelope;
    }
    // 初期反射（左右でわずかにずらし、広がりを出す）
    const reflections = [[0.0137, 0.42], [0.0211, 0.3], [0.0293, 0.22], [0.0371, 0.16]];
    for (const [time, gain] of reflections) {
      const index = Math.floor(rate * (time + channel * 0.0011));
      if (index < length) data[index] += gain * (channel ? -1 : 1) * 0.5;
    }
  }
  return impulse;
}

/**
 * 出口までのつなぎ。
 *   声 → バス → 低域カット(80Hz) → 2.5〜5.5kHz をすこし下げる → 高域を丸める → 音量
 *      → リミッター → 頭をなめらかに丸める（割れ防止） → 出口
 *   声 → 残響へ送る → 残響 → バスの後ろへ戻す
 */
function softClipCurve(points = 2049) {
  const curve = new Float32Array(points);
  const knee = 0.6;
  const room = 0.38;
  for (let index = 0; index < points; index += 1) {
    const x = (index / (points - 1)) * 2 - 1;
    const magnitude = Math.abs(x);
    const y = magnitude <= knee ? magnitude : knee + room * Math.tanh((magnitude - knee) / room);
    curve[index] = Math.sign(x) * y;
  }
  return curve;
}

export function buildSfxGraph(context, { random = Math.random } = {}) {
  const now = context.currentTime;
  const bus = context.createGain();
  const highpass = context.createBiquadFilter();
  const presence = context.createBiquadFilter();
  const lowpass = context.createBiquadFilter();
  const limiter = context.createDynamicsCompressor();
  const output = context.createGain();
  bus.gain.setValueAtTime(1, now);
  highpass.type = "highpass";
  highpass.frequency.setValueAtTime(80, now);
  highpass.Q.setValueAtTime(0.7, now);
  presence.type = "peaking";
  presence.frequency.setValueAtTime(3600, now);
  presence.Q.setValueAtTime(0.8, now);
  presence.gain.setValueAtTime(-4, now);
  lowpass.type = "lowpass";
  lowpass.frequency.setValueAtTime(11500, now);
  lowpass.Q.setValueAtTime(0.5, now);
  limiter.threshold.setValueAtTime(-9, now);
  limiter.knee.setValueAtTime(4, now);
  limiter.ratio.setValueAtTime(10, now);
  limiter.attack.setValueAtTime(0.002, now);
  limiter.release.setValueAtTime(0.12, now);
  output.gain.setValueAtTime(OUTPUT_TRIM * VOLUME_GAINS.normal, now);
  bus.connect(highpass);
  highpass.connect(presence);
  presence.connect(lowpass);
  lowpass.connect(output);
  output.connect(limiter);
  // いくつもの音が重なっても割れないよう、最後に頭をなめらかに丸める（-0.9dBFS で頭打ち）。
  if (typeof context.createWaveShaper === "function") {
    const shaper = context.createWaveShaper();
    shaper.curve = softClipCurve();
    shaper.oversample = "2x";
    limiter.connect(shaper);
    shaper.connect(context.destination);
  } else {
    limiter.connect(context.destination);
  }

  const buffers = createNoiseBuffers(context, random);
  let reverbInput = null;
  if (typeof context.createConvolver === "function") {
    try {
      const convolver = context.createConvolver();
      convolver.buffer = createImpulseResponse(context, random);
      reverbInput = context.createGain();
      const reverbReturn = context.createGain();
      reverbInput.gain.setValueAtTime(1, now);
      reverbReturn.gain.setValueAtTime(0.55, now);
      reverbInput.connect(convolver);
      convolver.connect(reverbReturn);
      reverbReturn.connect(highpass);
    } catch {
      reverbInput = null;
    }
  }
  return { context, bus, output, reverbInput, buffers };
}

export function setSfxGraphVolume(graph, volume) {
  const target = OUTPUT_TRIM * sfxVolumeGain(volume);
  const param = graph.output.gain;
  const now = graph.context.currentTime;
  try {
    param.cancelScheduledValues(now);
    param.setTargetAtTime(target, now, 0.02);
  } catch {
    param.value = target;
  }
}

function createSynth(graph, random) {
  const { context, buffers } = graph;
  const nyquist = context.sampleRate / 2;
  const audible = (frequency) => frequency > 20 && frequency < nyquist * 0.92;

  function connectWithPan(node, voice, pan) {
    if (pan && typeof context.createStereoPanner === "function") {
      const panner = context.createStereoPanner();
      panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), context.currentTime);
      node.connect(panner);
      panner.connect(voice.out);
      voice.nodes.push(panner);
      return;
    }
    node.connect(voice.out);
  }

  return {
    mode(voice, { at, freq, amp, decay, attack = 0.0015, glide = 0, glideTime = 0.05, pan = 0, restrikes = [] }) {
      const target = glide > 0 && glide !== 1 ? freq * glide : freq;
      if (!audible(freq) || !audible(target) || !(amp > 0) || !(decay > 0)) return;
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      const tau = decay / 6.9;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(freq, at);
      if (target !== freq) oscillator.frequency.exponentialRampToValueAtTime(target, at + glideTime);
      envelope.gain.setValueAtTime(0, at);
      envelope.gain.linearRampToValueAtTime(amp, at + attack);
      envelope.gain.setTargetAtTime(0, at + attack, tau);
      let level = amp;
      let from = at + attack;
      for (const hit of restrikes) {
        if (!(hit.at > from) || !(hit.amp > 0)) continue;
        // その時刻の大きさを計算で求め、そこから段差なく持ち上げる。
        const current = level * Math.exp(-(hit.at - from) / tau);
        envelope.gain.setValueAtTime(current, hit.at);
        envelope.gain.linearRampToValueAtTime(current + hit.amp, hit.at + 0.0012);
        envelope.gain.setTargetAtTime(0, hit.at + 0.0012, tau);
        level = current + hit.amp;
        from = hit.at + 0.0012;
      }
      oscillator.connect(envelope);
      connectWithPan(envelope, voice, pan);
      const end = from + decay + 0.03;
      // 60dB 下がったところから、さらに素早く0へ寄せてから止める（止めた瞬間の「プチッ」を消す）。
      envelope.gain.setTargetAtTime(0, end - 0.025, 0.004);
      oscillator.start(at);
      oscillator.stop(end);
      voice.nodes.push(oscillator, envelope);
      voice.sources.push(oscillator);
      voice.endAt = Math.max(voice.endAt, end);
    },
    noise(voice, { at, dur, buffer = "white", type = "lowpass", freq = 1000, endFreq = 0, q = 0.7, amp, attack = 0.001, pan = 0, highpass = 0, lowpass = 0 }) {
      if (!(dur > 0) || !(amp > 0)) return;
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const envelope = context.createGain();
      // 帯域の外側をさらに削るためのフィルター（必要なときだけ）
      const extra = [];
      for (const [kind, frequency] of [["highpass", highpass], ["lowpass", lowpass]]) {
        if (!frequency) continue;
        const node = context.createBiquadFilter();
        node.type = kind;
        node.frequency.setValueAtTime(frequency, at);
        node.Q.setValueAtTime(0.6, at);
        extra.push(node);
      }
      const sourceBuffer = buffers[buffer] ?? buffers.white;
      const clamp = (value) => Math.min(nyquist * 0.9, Math.max(30, value));
      source.buffer = sourceBuffer;
      filter.type = type;
      filter.frequency.setValueAtTime(clamp(freq), at);
      if (endFreq) filter.frequency.exponentialRampToValueAtTime(clamp(endFreq), at + dur);
      filter.Q.setValueAtTime(q, at);
      const rise = Math.min(attack, dur * 0.9);
      envelope.gain.setValueAtTime(0, at);
      envelope.gain.linearRampToValueAtTime(amp, at + rise);
      envelope.gain.exponentialRampToValueAtTime(amp * 0.0001, at + dur);
      source.connect(filter);
      let tail = filter;
      for (const node of extra) {
        tail.connect(node);
        tail = node;
      }
      tail.connect(envelope);
      connectWithPan(envelope, voice, pan);
      const span = Number(sourceBuffer?.duration) || 0;
      const offset = Math.max(0, (span - dur - 0.05) * random());
      const end = at + dur + 0.02;
      source.start(at, offset);
      source.stop(end);
      voice.nodes.push(source, filter, ...extra, envelope);
      voice.sources.push(source);
      voice.endAt = Math.max(voice.endAt, end);
    },
  };
}

function openVoice(graph, { level, pan = 0, send = 0 }) {
  const { context } = graph;
  const now = context.currentTime;
  const out = context.createGain();
  out.gain.setValueAtTime(level, now);
  const voice = { out, nodes: [out], sources: [], endAt: now, panner: null };
  let tail = out;
  if (typeof context.createStereoPanner === "function") {
    const panner = context.createStereoPanner();
    panner.pan.setValueAtTime(pan, now);
    out.connect(panner);
    tail = panner;
    voice.panner = panner;
    voice.nodes.push(panner);
  }
  tail.connect(graph.bus);
  if (send > 0 && graph.reverbInput) {
    const sendGain = context.createGain();
    sendGain.gain.setValueAtTime(send, now);
    tail.connect(sendGain);
    sendGain.connect(graph.reverbInput);
    voice.nodes.push(sendGain);
  }
  return voice;
}

/** 1つの音を、指定の時刻に予約する。毎回の小さなゆらぎもここで決める。 */
export function scheduleSfxSound(graph, id, at, { random = Math.random } = {}) {
  const sound = SOUNDS[id];
  if (!sound) return null;
  const synth = createSynth(graph, random);
  // ±12セントの音程、±0.5dBほどの強さ。気づかないほど小さいが、くり返しの単調さを消す。
  const cents = (random() - 0.5) * 24;
  const variation = { k: 2 ** (cents / 1200), r: random };
  const level = (SFX_LEVELS[id] ?? 1) * (1 + (random() - 0.5) * 0.12);
  const voice = openVoice(graph, { level, send: sound.send ?? 0 });
  sound.build(synth, voice, at, variation);
  voice.id = id;
  return voice;
}

/** 出来事の計画どおりに音を予約する。 */
export function scheduleSfxPlan(graph, plan, at, { random = Math.random } = {}) {
  return plan.sounds
    .map(({ id, offset }) => scheduleSfxSound(graph, id, at + offset, { random }))
    .filter(Boolean);
}

/**
 * 1つの音を書き出す（測定・試聴用）。OfflineAudioContext のクラスを渡す。
 * 実際の再生と同じつなぎ・同じレシピを通る。
 */
export async function renderSfx(id, { OfflineContextClass, sampleRate = 48_000, seconds = 3, random = Math.random, volume = "normal" } = {}) {
  const context = new OfflineContextClass(2, Math.ceil(sampleRate * seconds), sampleRate);
  const graph = buildSfxGraph(context, { random });
  // 書き出しでは、はじめから選んだ大きさにしておく（なめらかに近づける動きは要らない）。
  graph.output.gain.setValueAtTime(OUTPUT_TRIM * sfxVolumeGain(volume), 0);
  const plan = SOUNDS[id] ? { sounds: [{ id, offset: 0 }] } : planSfxEvent(id, { random });
  if (!plan) throw new Error(`unknown sound: ${id}`);
  scheduleSfxPlan(graph, plan, 0.01, { random });
  return context.startRendering();
}

// ---------------------------------------------------------------------------
// アプリで使うエンジン
// ---------------------------------------------------------------------------

function defaultAudioContextClass() {
  if (typeof window === "undefined") return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

export function createSfxEngine({
  getAudioContextClass = defaultAudioContextClass,
  isEnabled = () => true,
  getVolume = () => "normal",
  isHidden = () => Boolean(globalThis.document?.hidden),
  random = Math.random,
  setTimer = (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimer = (timer) => clearTimeout(timer),
} = {}) {
  let context = null;
  let graph = null;
  let idleTimer = 0;
  let playCount = 0;
  let nextVoiceId = 1;
  const voices = new Map();

  function disconnect(node) {
    try { node.disconnect(); } catch { /* すでに外れている */ }
  }

  function releaseVoice(voice) {
    if (!voices.has(voice.key)) return;
    voices.delete(voice.key);
    if (voice.timer) clearTimer(voice.timer);
    voice.nodes.forEach(disconnect);
  }

  function fadeVoice(voice, seconds = 0.03) {
    if (!context || !voices.has(voice.key)) return;
    const now = context.currentTime;
    try {
      voice.out.gain.cancelScheduledValues(now);
      voice.out.gain.setValueAtTime(Math.max(0.0001, voice.out.gain.value || 0.0001), now);
      voice.out.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
    } catch { /* すでに止まっている */ }
    for (const source of voice.sources) {
      try { source.stop(now + seconds + 0.01); } catch { /* すでに止まっている */ }
    }
    if (voice.timer) clearTimer(voice.timer);
    voice.timer = setTimer(() => releaseVoice(voice), Math.ceil((seconds + 0.08) * 1000));
  }

  function registerVoice(voice) {
    while (voices.size >= SFX_MAX_VOICES) {
      // 上限に達したら、もう鳴り終わっている音から外す。まだ鳴っている音（伝説の長い響きなど）は
      // できるだけ残し、どうしても足りないときだけ、いちばん古い音を素早く消す。
      const now = context.currentTime;
      const finished = [...voices.values()].find((entry) => entry.endAt <= now);
      const victim = finished ?? voices.values().next().value;
      if (!finished) fadeVoice(victim, 0.015);
      releaseVoice(victim);
    }
    voice.key = nextVoiceId;
    nextVoiceId += 1;
    voices.set(voice.key, voice);
    const remaining = Math.max(0.05, voice.endAt - context.currentTime);
    // 鳴り終わったら、つなぎを外す（残響は残響のほうで余韻を持っているので、尾は切れない）。
    voice.timer = setTimer(() => releaseVoice(voice), Math.ceil((remaining + 0.15) * 1000));
  }

  function ensureContext() {
    if (context) return context;
    const AudioContextClass = getAudioContextClass?.();
    if (!AudioContextClass) return null;
    try {
      context = new AudioContextClass({ latencyHint: "interactive" });
      graph = buildSfxGraph(context, { random });
      return context;
    } catch {
      context = null;
      graph = null;
      return null;
    }
  }

  function resume() {
    if (!context || context.state === "running" || context.state === "closed") return;
    try {
      const pending = context.resume?.();
      pending?.catch?.(() => {});
    } catch { /* 操作の外では再開できない端末がある。次の操作で再開する。 */ }
  }

  function scheduleIdleSuspend() {
    if (idleTimer) clearTimer(idleTimer);
    idleTimer = setTimer(() => {
      idleTimer = 0;
      if (!context || voices.size || context.state !== "running") return;
      try { context.suspend?.()?.catch?.(() => {}); } catch { /* 止められなくても困らない */ }
    }, IDLE_SUSPEND_MS);
  }

  /** 最初の操作で音の準備をしておく（最初の音が遅れないように）。 */
  function warm() {
    if (!isEnabled() || isHidden()) return false;
    if (!ensureContext()) return false;
    resume();
    scheduleIdleSuspend();
    return true;
  }

  function play(event, options = {}) {
    if (!isEnabled() || isHidden()) return null;
    const plan = planSfxEvent(event, { ...options, random });
    if (!plan) return null;
    if (!ensureContext()) return null;
    setSfxGraphVolume(graph, getVolume());
    resume();
    try {
      const at = context.currentTime + LOOKAHEAD;
      for (const voice of scheduleSfxPlan(graph, plan, at, { random })) registerVoice(voice);
    } catch {
      return null;
    }
    playCount += 1;
    scheduleIdleSuspend();
    return plan;
  }

  function stopAll({ suspend = false } = {}) {
    for (const voice of [...voices.values()]) fadeVoice(voice, 0.03);
    if (suspend && context?.state === "running") {
      setTimer(() => {
        try { context?.suspend?.()?.catch?.(() => {}); } catch { /* 止められなくても困らない */ }
      }, 60);
    }
  }

  function debugState() {
    return Object.freeze({
      hasContext: Boolean(context),
      contextState: context?.state ?? "uninitialized",
      activeVoices: voices.size,
      maxVoices: SFX_MAX_VOICES,
      playCount,
    });
  }

  return Object.freeze({
    warm,
    play,
    stopAll,
    debugState,
    /** これまでに鳴らした回数。ボタンの音を、ほかの音と重ねないために使う。 */
    get playCount() {
      return playCount;
    },
  });
}
