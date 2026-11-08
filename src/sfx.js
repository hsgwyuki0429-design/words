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
 * フラッシュカードをめくったときの音（めくり終えて、カードが落ち着く音）。すべて水の音。
 * 上ほどよく出る。下へ行くほど響きが豊かで気持ちいい音にし、出にくくしてある。
 */
export const LANDING_VARIANTS = Object.freeze([
  variant("drop", "水滴の「ピチョン」", "雫", "common", 0.22),
  variant("plip", "小さな雫の「ポチッ」", "小さな雫", "common", 0.2),
  variant("bubble", "泡がはじける「ポコッ」", "泡", "common", 0.16),
  variant("ripple", "水面を指でつつく「チャプ」", "水面", "uncommon", 0.12),
  variant("bottle", "小瓶に落ちる雫「コポッ」", "小瓶", "uncommon", 0.1),
  variant("rain", "雨だれ2滴「ポツ、ポツン」", "雨だれ", "uncommon", 0.08),
  variant("cup", "グラスの水に落ちる雫「チャポン」", "グラスの水", "rare", 0.055),
  variant("cave", "洞窟に響く雫", "洞窟", "rare", 0.035),
  variant("rise", "泡の列が立ちのぼる「コポコポ…」", "泡の列", "epic", 0.02),
  variant("suikinkutsu", "水琴窟の響き", "水琴窟", "legendary", 0.01),
]);

/**
 * 4択・入力の問題で正解したときの音。すべて水の音で、明るく協和する音程へ上がっていく。
 * 下へ行くほど豪華で、出にくい。
 */
export const CORRECT_VARIANTS = Object.freeze([
  variant("drops", "雫が2つ「ピチョ・ピチョン」", "雫", "common", 0.22),
  variant("bubbles", "泡が2つ「ポコ・ポコン」", "泡", "common", 0.2),
  variant("drip", "雫が3つ「ポ・ポ・ポン」", "小さな雫", "common", 0.16),
  variant("pour", "水を注ぐ「トクトクトン」", "注ぐ水", "uncommon", 0.12),
  variant("leaf", "葉から落ちる雫「ポロン」", "葉の雫", "uncommon", 0.1),
  variant("bottle", "小瓶の「コポコポン」", "小瓶", "uncommon", 0.08),
  variant("cup", "グラスの水「チャポ・チャポン」", "グラスの水", "rare", 0.055),
  variant("rain", "雨だれの和音「ポツポツポロン」", "雨だれ", "rare", 0.035),
  variant("cascade", "泡があふれる「コポポポポン」", "泡の列", "epic", 0.02),
  variant("suikinkutsu", "水琴窟の旋律", "水琴窟", "legendary", 0.01),
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

// 水の音の素。水滴が水面に落ちると、小さな泡が一瞬で縮んで共鳴の高さが急に上がる。
// これが「ピチョン」「ポコッ」の正体（泡の共鳴が上がっていく音）。耳元で聞く ASMR のように、
// 小さく・近く・柔らかく鳴らす。
//   glide … 終わりの高さの倍率（大きいほど「ピチョン」、小さいほど「ポコ」）
function droplet(s, v, at, frequency, { amp = 1, glide = 1.9, glideTime = 0.045, decay = 0.13, click = 0.1, pan = 0, body = 0.07 } = {}) {
  if (click > 0) s.noise(v, { at, dur: 0.004, type: "lowpass", freq: 2600, q: 0.5, amp: click * amp, attack: 0.0004, pan });
  s.mode(v, { at: at + 0.002, freq: frequency, glide, glideTime, amp, decay, attack: 0.002, pan });
  if (body > 0) s.mode(v, { at: at + 0.002, freq: frequency * 2, glide, glideTime, amp: amp * body, decay: decay * 0.4, attack: 0.002, pan });
}

// 水面が揺れる「チャプ」。やわらかい雑音をごく短く。
function splash(s, v, at, { amp = 1, freq = 1400, dur = 0.06, pan = 0 } = {}) {
  s.noise(v, { at, dur, type: "bandpass", freq, endFreq: freq * 0.55, q: 0.9, amp, attack: 0.004, pan, lowpass: 5000 });
}

// 水琴窟：地中の甕（かめ）に落ちた雫が、甕の中で鐘のように響く。
function kinkutsu(s, v, at, frequency, { amp = 1, pan = 0 } = {}) {
  droplet(s, v, at, frequency * 0.5, { amp: amp * 0.35, glide: 2, decay: 0.08, click: 0.05, pan });
  for (const [ratio, rel, decay] of [[1, 1, 1.6], [2.01, 0.32, 0.9], [2.98, 0.12, 0.5]]) {
    s.mode(v, { at: at + 0.012, freq: frequency * ratio, amp: amp * rel * 0.6, decay, attack: 0.006, pan });
  }
  s.mode(v, { at: at + 0.012, freq: frequency * 1.0016, amp: amp * 0.22, decay: 1.4, attack: 0.008, pan: -pan });
}

const SOUNDS = {
  // --- ボタン・スイッチ・キー（ごく小さな雫） -------------------------------
  tap: {
    send: 0.08,
    build(s, v, at, x) {
      droplet(s, v, at, hz("G5") * x.k * (1 + (x.r() - 0.5) * 0.03), { amp: 0.8, glide: 1.45, glideTime: 0.028, decay: 0.06, click: 0.12 });
    },
  },
  "toggle-on": {
    send: 0.12,
    build(s, v, at, x) {
      droplet(s, v, at, hz("E5") * x.k, { amp: 0.6, glide: 1.4, glideTime: 0.028, decay: 0.06 });
      droplet(s, v, at + 0.065, hz("C6") * x.k, { amp: 0.7, glide: 1.5, glideTime: 0.03, decay: 0.09 });
    },
  },
  "toggle-off": {
    send: 0.1,
    build(s, v, at, x) {
      droplet(s, v, at, hz("C6") * x.k, { amp: 0.6, glide: 1.3, glideTime: 0.028, decay: 0.06 });
      droplet(s, v, at + 0.065, hz("E5") * x.k, { amp: 0.6, glide: 1.25, glideTime: 0.03, decay: 0.08 });
    },
  },
  key: {
    send: 0.06,
    build(s, v, at, x) {
      // 打つたびに近い音が選ばれ、雨粒のように少しずつ違って聞こえる。
      const notes = ["E5", "G5", "A5", "C6"];
      const note = notes[Math.floor(x.r() * notes.length) % notes.length];
      droplet(s, v, at, hz(note) * x.k, { amp: 0.7, glide: 1.4, glideTime: 0.022, decay: 0.045, click: 0.1 });
    },
  },
  "key-delete": {
    send: 0.06,
    build(s, v, at, x) {
      droplet(s, v, at, hz("C5") * x.k, { amp: 0.75, glide: 1.25, glideTime: 0.025, decay: 0.055 });
    },
  },

  // --- 紙の音（めくる・すべらせる）。耳元で紙をめくるように、柔らかく近く -------
  "swish-up": {
    send: 0.05,
    build(s, v, at, x) {
      paperSwish(s, v, at, x, { from: 1150, to: 2300, duration: 0.17, flapAt: 0.5, airAmp: 0.2, attackRatio: 0.42 });
    },
  },
  "swish-down": {
    send: 0.05,
    build(s, v, at, x) {
      paperSwish(s, v, at, x, { from: 2100, to: 1100, duration: 0.15, flapAt: 0.42, airAmp: 0.2, attackRatio: 0.42 });
    },
  },
  "slide-left": { send: 0.05, build: (s, v, at, x) => paperSlide(s, v, at, x, "left") },
  "slide-right": { send: 0.05, build: (s, v, at, x) => paperSlide(s, v, at, x, "right") },
  "slide-up": { send: 0.05, build: (s, v, at, x) => paperSlide(s, v, at, x, "up") },
  "slide-down": { send: 0.05, build: (s, v, at, x) => paperSlide(s, v, at, x, "down") },

  // --- めくった音（10種・すべて水） ------------------------------------------
  "land-drop": {
    send: 0.3,
    build(s, v, at, x) {
      droplet(s, v, at, hz("E5") * x.k, { amp: 0.9, glide: 2, glideTime: 0.05, decay: 0.13, click: 0.12 });
      droplet(s, v, at + 0.07 + x.r() * 0.015, hz("C6") * x.k, { amp: 0.17, glide: 1.5, glideTime: 0.03, decay: 0.07, click: 0 });
    },
  },
  "land-plip": {
    send: 0.24,
    build(s, v, at, x) {
      droplet(s, v, at, hz("A5") * x.k, { amp: 0.85, glide: 1.6, glideTime: 0.03, decay: 0.08, click: 0.14 });
    },
  },
  "land-bubble": {
    send: 0.22,
    build(s, v, at, x) {
      // 水の中から浮いてきた泡が、水面ではじける。低めで丸い「ポコッ」。
      droplet(s, v, at, hz("C5") * x.k, { amp: 0.95, glide: 1.5, glideTime: 0.06, decay: 0.12, click: 0.05, body: 0.12 });
    },
  },
  "land-ripple": {
    send: 0.26,
    build(s, v, at, x) {
      splash(s, v, at, { amp: 0.45, freq: 1500 });
      droplet(s, v, at + 0.012, hz("D5") * x.k, { amp: 0.6, glide: 1.7, decay: 0.1, click: 0, pan: -0.15 });
      droplet(s, v, at + 0.045 + x.r() * 0.01, hz("A5") * x.k, { amp: 0.32, glide: 1.6, decay: 0.08, click: 0, pan: 0.2 });
    },
  },
  "land-bottle": {
    send: 0.26,
    build(s, v, at, x) {
      // 細い瓶の中で泡がこもって鳴る「コポッ」。瓶の空洞が少し響く。
      const frequency = hz("G4") * x.k;
      droplet(s, v, at, frequency, { amp: 0.9, glide: 1.6, glideTime: 0.07, decay: 0.16, click: 0.04, body: 0.18 });
      s.noise(v, { at: at + 0.004, dur: 0.07, type: "bandpass", freq: frequency * 2, q: 12, amp: 1.6, attack: 0.004 });
      s.mode(v, { at: at + 0.002, freq: frequency * 3, glide: 1.6, glideTime: 0.07, amp: 0.3, decay: 0.08, attack: 0.003 });
    },
  },
  "land-rain": {
    send: 0.32,
    build(s, v, at, x) {
      droplet(s, v, at, hz("G5") * x.k, { amp: 0.65, glide: 1.8, decay: 0.09, pan: -0.25 });
      droplet(s, v, at + 0.11 + x.r() * 0.02, hz("C6") * x.k, { amp: 0.8, glide: 1.9, decay: 0.12, pan: 0.25 });
    },
  },
  "land-cup": {
    send: 0.34,
    build(s, v, at, x) {
      // グラスの水に落ちる雫。水の音のあとに、グラスがかすかに澄んで鳴る。
      droplet(s, v, at, hz("D5") * x.k, { amp: 0.85, glide: 2, decay: 0.12, click: 0.1 });
      s.mode(v, { at: at + 0.006, freq: hz("A6") * x.k, amp: 0.09, decay: 1.1, attack: 0.003 });
      s.mode(v, { at: at + 0.006, freq: hz("A6") * x.k * 2.71, amp: 0.015, decay: 0.35, attack: 0.003 });
      droplet(s, v, at + 0.085, hz("A5") * x.k, { amp: 0.22, glide: 1.6, decay: 0.07, click: 0 });
    },
  },
  "land-cave": {
    send: 0.62,
    build(s, v, at, x) {
      // 洞窟の天井から落ちる雫。深い残響の中へ、遅れて響きが返ってくる。
      droplet(s, v, at, hz("E5") * x.k, { amp: 0.85, glide: 2.1, glideTime: 0.055, decay: 0.16, click: 0.08 });
      droplet(s, v, at + 0.19, hz("E5") * x.k, { amp: 0.18, glide: 2.1, glideTime: 0.055, decay: 0.14, click: 0, pan: 0.4 });
      droplet(s, v, at + 0.37, hz("E5") * x.k, { amp: 0.07, glide: 2.1, glideTime: 0.055, decay: 0.12, click: 0, pan: -0.4 });
    },
  },
  "land-rise": {
    send: 0.36,
    build(s, v, at, x) {
      // 小さな泡が次々に水面へのぼってはじける。だんだん高く、小さく。
      ["C5", "E5", "G5", "C6", "E6"].forEach((note, index) => {
        droplet(s, v, at + index * (0.055 + x.r() * 0.012), hz(note) * x.k, {
          amp: 0.8 - index * 0.1,
          glide: 1.55,
          glideTime: 0.04,
          decay: 0.09,
          click: 0.03,
          pan: (index % 2 ? 0.3 : -0.3) * (index / 4),
        });
      });
    },
  },
  "land-suikinkutsu": {
    send: 0.5,
    build(s, v, at, x) {
      // 伝説：水琴窟。甕の中で雫が鐘のように響き、余韻が遅れてもう一度返ってくる。
      kinkutsu(s, v, at, hz("E6") * x.k, { amp: 0.9, pan: -0.15 });
      kinkutsu(s, v, at + 0.42 + x.r() * 0.05, hz("A5") * x.k, { amp: 0.5, pan: 0.2 });
    },
  },

  // --- 正解の音（10種・すべて水。明るく上がる） --------------------------------
  "correct-drops": {
    send: 0.28,
    build(s, v, at, x) {
      droplet(s, v, at, hz("G5") * x.k, { amp: 0.75, glide: 1.8, decay: 0.11, pan: -0.1 });
      droplet(s, v, at + 0.1, hz("C6") * x.k, { amp: 1, glide: 1.9, decay: 0.16, pan: 0.1 });
    },
  },
  "correct-bubbles": {
    send: 0.26,
    build(s, v, at, x) {
      droplet(s, v, at, hz("C5") * x.k, { amp: 0.75, glide: 1.5, glideTime: 0.045, decay: 0.12, click: 0.04 });
      droplet(s, v, at + 0.1, hz("G5") * x.k, { amp: 0.95, glide: 4 / 3, glideTime: 0.045, decay: 0.17, click: 0.04 });
      droplet(s, v, at + 0.19 + x.r() * 0.02, hz("E6") * x.k, { amp: 0.15, glide: 1.25, decay: 0.07, click: 0 });
    },
  },
  "correct-drip": {
    send: 0.26,
    build(s, v, at, x) {
      droplet(s, v, at, hz("E5") * x.k, { amp: 0.6, glide: 1.6, decay: 0.08, pan: -0.2 });
      droplet(s, v, at + 0.075, hz("G5") * x.k, { amp: 0.7, glide: 1.6, decay: 0.09 });
      droplet(s, v, at + 0.15, hz("C6") * x.k, { amp: 0.95, glide: 1.8, decay: 0.15, pan: 0.2 });
    },
  },
  "correct-pour": {
    send: 0.24,
    build(s, v, at, x) {
      // 瓶から水を注ぐ「トクトクトン」。空気が入るたびに、こもった泡が上がっていく。
      ["C5", "D5", "E5", "G5"].forEach((note, index) => {
        const time = at + index * 0.07;
        droplet(s, v, time, hz(note) * x.k, { amp: index === 3 ? 0.95 : 0.6, glide: 1.45, glideTime: 0.05, decay: index === 3 ? 0.16 : 0.08, click: 0.03, body: 0.15 });
        splash(s, v, time, { amp: 0.12, freq: 900, dur: 0.05 });
      });
    },
  },
  "correct-leaf": {
    send: 0.3,
    build(s, v, at, x) {
      // 葉の先にたまった雫が、ふるえてから落ちる。最後は澄んで長めに。
      droplet(s, v, at, hz("A5") * x.k, { amp: 0.4, glide: 1.3, glideTime: 0.02, decay: 0.05, click: 0.04 });
      droplet(s, v, at + 0.09, hz("E5") * x.k, { amp: 0.6, glide: 1.6, decay: 0.09 });
      droplet(s, v, at + 0.19, hz("A5") * x.k, { amp: 1, glide: 2, decay: 0.2 });
    },
  },
  "correct-bottle": {
    send: 0.3,
    build(s, v, at, x) {
      ["G4", "C5", "E5", "G5"].forEach((note, index) => {
        const frequency = hz(note) * x.k;
        const time = at + index * 0.06;
        droplet(s, v, time, frequency, { amp: 0.55 + index * 0.13, glide: 1.6, glideTime: 0.06, decay: 0.13, click: 0.03, body: 0.18, pan: -0.3 + index * 0.2 });
        s.noise(v, { at: time + 0.004, dur: 0.06, type: "bandpass", freq: frequency * 2, q: 12, amp: 0.5, attack: 0.004 });
      });
    },
  },
  "correct-cup": {
    send: 0.36,
    build(s, v, at, x) {
      droplet(s, v, at, hz("A5") * x.k, { amp: 0.7, glide: 1.9, decay: 0.1, pan: -0.2 });
      s.mode(v, { at: at + 0.005, freq: hz("A6") * x.k, amp: 0.07, decay: 0.8, attack: 0.003, pan: -0.2 });
      droplet(s, v, at + 0.14, hz("E6") * x.k, { amp: 0.9, glide: 1.8, decay: 0.14, pan: 0.2 });
      s.mode(v, { at: at + 0.145, freq: hz("E7") * x.k, amp: 0.06, decay: 1.2, attack: 0.003, pan: 0.2 });
      s.mode(v, { at: at + 0.145, freq: hz("E6") * x.k, amp: 0.1, decay: 1.4, attack: 0.004, pan: 0.2 });
    },
  },
  "correct-rain": {
    send: 0.38,
    build(s, v, at, x) {
      // 雨だれが和音（ド・ミ・ソ・ド）を描き、最後の1滴が長く残る。
      [["C5", -0.4], ["G5", 0.3], ["E5", -0.1], ["C6", 0.4], ["G6", 0]].forEach(([note, pan], index) => {
        droplet(s, v, at + index * (0.065 + x.r() * 0.01), hz(note) * x.k, { amp: 0.55 + index * 0.08, glide: 1.8, decay: index === 4 ? 0.22 : 0.1, pan });
      });
    },
  },
  "correct-cascade": {
    send: 0.42,
    build(s, v, at, x) {
      // 泡が次々にあふれ、最後に大きな泡がひとつ「ポン」とはじける。
      const notes = ["C5", "D5", "E5", "G5", "A5", "C6", "D6", "E6"];
      notes.forEach((note, index) => {
        droplet(s, v, at + index * 0.038, hz(note) * x.k, { amp: 0.38 + index * 0.03, glide: 1.5, glideTime: 0.035, decay: 0.08, click: 0.02, pan: -0.6 + (1.2 * index) / (notes.length - 1) });
      });
      droplet(s, v, at + notes.length * 0.038 + 0.06, hz("G6") * x.k, { amp: 0.9, glide: 2, decay: 0.24, click: 0.06 });
    },
  },
  "correct-suikinkutsu": {
    send: 0.55,
    build(s, v, at, x) {
      // 伝説：水琴窟の旋律。雫が甕の中で鐘のように響き、ミ→ソ→ド と上がって長く残る。
      kinkutsu(s, v, at, hz("E5") * x.k, { amp: 0.6, pan: -0.3 });
      kinkutsu(s, v, at + 0.2, hz("G5") * x.k, { amp: 0.7, pan: 0.25 });
      kinkutsu(s, v, at + 0.42, hz("C6") * x.k, { amp: 0.9, pan: 0 });
      for (const [delay, note, pan] of [[0.7, "E6", -0.4], [0.9, "G6", 0.4]]) {
        droplet(s, v, at + delay, hz(note) * x.k, { amp: 0.14, glide: 1.6, decay: 0.08, click: 0, pan });
      }
    },
  },

  // --- 不正解の音（1種） ------------------------------------------------------
  wrong: {
    send: 0.16,
    build(s, v, at, x) {
      // 正解と同じ水の世界のまま、低い泡が2つ、こもって下がる「ポコ…ポコ↓」。
      // 泡の音は本来上がるが、ここだけ下がらせて「ちがったね」と知らせる。罰する音にはしない。
      // スマホのスピーカーでも聞こえるよう、2倍の倍音を強めに持たせる（ミッシング・ファンダメンタル）。
      const sink = (time, note, amp, glide, glideTime, decay) => {
        const frequency = hz(note) * x.k;
        droplet(s, v, time, frequency, { amp: amp * 0.6, glide, glideTime, decay, click: 0.03, body: 1 });
        s.mode(v, { at: time + 0.002, freq: frequency * 3, glide, glideTime, amp: amp * 0.3, decay: decay * 0.6, attack: 0.004 });
      };
      sink(at, "C5", 0.75, 0.82, 0.08, 0.14);
      sink(at + 0.14, "G4", 0.95, 0.78, 0.12, 0.2);
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
  tap: 0.827,
  "toggle-on": 0.299,
  "toggle-off": 0.39,
  key: 0.836,
  "key-delete": 0.905,
  "swish-up": 1.35,
  "swish-down": 1.44,
  "slide-left": 1.61,
  "slide-right": 1.61,
  "slide-up": 1.7,
  "slide-down": 1.64,
  "land-drop": 0.816,
  "land-plip": 1.19,
  "land-bubble": 0.969,
  "land-ripple": 0.958,
  "land-bottle": 0.976,
  "land-rain": 0.384,
  "land-cup": 0.809,
  "land-cave": 0.473,
  "land-rise": 0.464,
  "land-suikinkutsu": 0.163,
  "correct-drops": 0.419,
  "correct-bubbles": 0.492,
  "correct-drip": 0.405,
  "correct-pour": 0.485,
  "correct-leaf": 0.39,
  "correct-bottle": 0.443,
  "correct-cup": 0.451,
  "correct-rain": 0.275,
  "correct-cascade": 0.283,
  "correct-suikinkutsu": 0.166,
  wrong: 0.479,
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
