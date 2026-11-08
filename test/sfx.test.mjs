import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  CORRECT_VARIANTS,
  LANDING_VARIANTS,
  SFX_EVENTS,
  SFX_LEVELS,
  SFX_MAX_VOICES,
  SFX_NOTE_NAMES,
  SFX_RARITIES,
  SFX_SOUND_IDS,
  SFX_VOLUME_OPTIONS,
  buildSfxGraph,
  createSfxEngine,
  normalizeSfxVolume,
  pickVariant,
  planSfxEvent,
  scheduleSfxSound,
  sfxVolumeGain,
} from "../src/sfx.js";

const appSource = fs.readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const serviceWorker = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const functionSource = (name) => appSource.match(new RegExp(`function ${name}\\([^]*?\\n}`))?.[0] ?? "";

function seeded(seed = 1) {
  let value = seed;
  return () => {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- 本物の Web Audio と同じ制約で値を確かめる偽物 ---------------------------

class FakeParam {
  constructor(value = 0) {
    this.value = value;
    this.events = [];
  }
  record(name, value, time, extra) {
    assert.ok(Number.isFinite(value), `${name} の値が有限でない: ${value}`);
    assert.ok(Number.isFinite(time) && time >= 0, `${name} の時刻が不正: ${time}`);
    this.events.push([name, value, time, extra]);
    this.value = value;
  }
  setValueAtTime(value, time) { this.record("setValueAtTime", value, time); }
  linearRampToValueAtTime(value, time) { this.record("linearRampToValueAtTime", value, time); }
  exponentialRampToValueAtTime(value, time) {
    // 本物は 0 や負の値へ指数で近づけようとすると RangeError になる。
    if (!(value > 0)) throw new RangeError(`exponentialRamp の目標が正でない: ${value}`);
    this.record("exponentialRampToValueAtTime", value, time);
  }
  setTargetAtTime(value, time, constant) {
    assert.ok(constant > 0, `時定数が正でない: ${constant}`);
    this.record("setTargetAtTime", value, time, constant);
  }
  cancelScheduledValues() {}
}

class FakeNode {
  constructor(kind, context) {
    this.kind = kind;
    this.context = context;
    this.outputs = [];
    this.gain = new FakeParam(1);
    this.frequency = new FakeParam(440);
    this.Q = new FakeParam(1);
    this.pan = new FakeParam(0);
    this.threshold = new FakeParam(0);
    this.knee = new FakeParam(0);
    this.ratio = new FakeParam(1);
    this.attack = new FakeParam(0);
    this.release = new FakeParam(0);
    this.started = null;
    this.stopped = null;
    this.disconnected = false;
  }
  connect(target) {
    this.outputs.push(target);
    return target;
  }
  disconnect() { this.disconnected = true; }
  start(time = 0, offset = 0) {
    assert.equal(this.started, null, "start は1回だけ");
    assert.ok(Number.isFinite(time) && time >= 0);
    assert.ok(Number.isFinite(offset) && offset >= 0);
    this.started = time;
  }
  stop(time = 0) {
    assert.ok(Number.isFinite(time));
    if (this.stopped === null || time < this.stopped) this.stopped = time;
  }
}

class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 48_000;
    this.state = "suspended";
    this.destination = new FakeNode("destination", this);
    this.nodes = [];
    this.resumeCalls = 0;
    this.suspendCalls = 0;
  }
  make(kind) {
    const node = new FakeNode(kind, this);
    this.nodes.push(node);
    return node;
  }
  createGain() { return this.make("gain"); }
  createBiquadFilter() { return this.make("filter"); }
  createDynamicsCompressor() { return this.make("compressor"); }
  createWaveShaper() { return this.make("shaper"); }
  createConvolver() { return this.make("convolver"); }
  createStereoPanner() { return this.make("panner"); }
  createOscillator() { return this.make("oscillator"); }
  createBufferSource() { return this.make("bufferSource"); }
  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { duration: length / sampleRate, numberOfChannels: channels, getChannelData: (channel) => data[channel] };
  }
  async resume() { this.resumeCalls += 1; this.state = "running"; }
  async suspend() { this.suspendCalls += 1; this.state = "suspended"; }
}

function manualTimers() {
  const timers = new Map();
  let nextId = 1;
  return {
    setTimer(callback, milliseconds) {
      const id = nextId;
      nextId += 1;
      timers.set(id, { callback, milliseconds });
      return id;
    },
    clearTimer(id) { timers.delete(id); },
    run(predicate = () => true) {
      for (const [id, timer] of [...timers]) {
        if (!timers.has(id) || !predicate(timer)) continue;
        timers.delete(id);
        timer.callback();
      }
    },
    get size() { return timers.size; },
  };
}

// --- 音の一覧とレア度 -------------------------------------------------------

test("めくった音と正解の音は、系統の違う10種類ずつで、気持ちいい音ほど出にくい", () => {
  for (const [variants, prefix] of [[LANDING_VARIANTS, "land"], [CORRECT_VARIANTS, "correct"]]) {
    assert.equal(variants.length, 10);
    assert.equal(new Set(variants.map((entry) => entry.id)).size, 10, "id が重ならない");
    assert.equal(new Set(variants.map((entry) => entry.family)).size, 10, "素材（系統）が重ならない");
    const total = variants.reduce((sum, entry) => sum + entry.weight, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `出る確率の合計が100%: ${total}`);
    for (let index = 1; index < variants.length; index += 1) {
      const previous = variants[index - 1];
      const current = variants[index];
      assert.ok(SFX_RARITIES[current.rarity].rank >= SFX_RARITIES[previous.rarity].rank, "下へ行くほどレア");
      assert.ok(current.weight <= previous.weight, `${current.id} は ${previous.id} より出にくい`);
    }
    assert.equal(variants.at(-1).rarity, "legendary");
    assert.ok(variants.at(-1).weight <= 0.01, "伝説は1%以下");
    assert.ok(variants.filter((entry) => entry.rarity === "common").reduce((sum, entry) => sum + entry.weight, 0) > 0.5, "ふだんはコモンが鳴る");
    for (const entry of variants) assert.ok(SFX_SOUND_IDS.includes(`${prefix}-${entry.id}`), `${prefix}-${entry.id} のレシピがある`);
  }
});

test("抽選は重みどおりに出て、端の値でも必ずどれかを返す", () => {
  assert.equal(pickVariant(LANDING_VARIANTS, () => 0).id, LANDING_VARIANTS[0].id);
  assert.equal(pickVariant(LANDING_VARIANTS, () => 0.9999999).id, LANDING_VARIANTS.at(-1).id);
  assert.equal(pickVariant(LANDING_VARIANTS, () => 1).id, LANDING_VARIANTS.at(-1).id);
  assert.equal(pickVariant(LANDING_VARIANTS, () => Number.NaN).id, LANDING_VARIANTS[0].id);
  const random = seeded(42);
  const draws = 200_000;
  const counts = new Map();
  for (let index = 0; index < draws; index += 1) {
    const { id } = pickVariant(CORRECT_VARIANTS, random);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const entry of CORRECT_VARIANTS) {
    const rate = (counts.get(entry.id) ?? 0) / draws;
    assert.ok(Math.abs(rate - entry.weight) < 0.004, `${entry.id}: ${rate} ≈ ${entry.weight}`);
  }
});

test("出来事ごとに鳴らす音の計画：めくると「紙の音→落ち着く音」、正解は抽選、払うと方向つき", () => {
  const flip = planSfxEvent("flip", { random: () => 0 });
  assert.deepEqual(flip.sounds.map((sound) => sound.id), ["swish-up", "land-drop"]);
  assert.equal(flip.sounds[0].offset, 0);
  assert.ok(flip.sounds[1].offset > 0.04 && flip.sounds[1].offset < 0.12, "紙の音の山のすぐあと");
  assert.equal(planSfxEvent("flip", { variant: "suikinkutsu" }).rarity, "legendary");
  assert.deepEqual(planSfxEvent("unflip").sounds.map((sound) => sound.id), ["swish-down"]);
  assert.deepEqual(planSfxEvent("swish", { up: false }).sounds.map((sound) => sound.id), ["swish-down"]);
  for (const direction of ["left", "right", "up", "down"]) {
    assert.deepEqual(planSfxEvent("slide", { direction }).sounds.map((sound) => sound.id), [`slide-${direction}`]);
  }
  assert.equal(planSfxEvent("correct", { random: () => 0.9999 }).variant, "suikinkutsu");
  assert.equal(planSfxEvent("correct", { variant: "cup" }).sounds[0].id, "correct-cup");
  assert.equal(planSfxEvent("correct", { variant: "存在しない", random: () => 0 }).variant, "drops");
  assert.deepEqual(planSfxEvent("wrong").sounds.map((sound) => sound.id), ["wrong"]);
  assert.equal(planSfxEvent("unknown"), null);
  for (const event of SFX_EVENTS) assert.ok(planSfxEvent(event, { random: seeded(3) }), event);
});

test("音程は C メジャー・ペンタトニックだけ（半音・増4度が生まれない）", () => {
  for (const name of SFX_NOTE_NAMES) assert.match(name, /^[CDEGA]\d$/, name);
});

test("すべての音に音量の補正があり、大きさの設定は3段階", () => {
  assert.deepEqual(Object.keys(SFX_LEVELS).sort(), [...SFX_SOUND_IDS].sort());
  for (const [id, level] of Object.entries(SFX_LEVELS)) assert.ok(level > 0 && level < 10, `${id}: ${level}`);
  assert.deepEqual(SFX_VOLUME_OPTIONS.map((option) => option.value), ["soft", "normal", "loud"]);
  assert.equal(normalizeSfxVolume("loud"), "loud");
  assert.equal(normalizeSfxVolume("爆音"), "normal");
  assert.equal(normalizeSfxVolume(undefined), "normal");
  assert.ok(sfxVolumeGain("soft") < sfxVolumeGain("normal") && sfxVolumeGain("normal") < sfxVolumeGain("loud"));
  assert.ok(sfxVolumeGain("loud") <= 1, "大きめでも割れない範囲");
});

test("32種のどの音も、値が有限で、音量0から立ち上がり（プチッとならない）、開始より後に止まる", () => {
  for (const id of SFX_SOUND_IDS) {
    for (const seed of [1, 2, 3]) {
      const context = new FakeAudioContext();
      context.currentTime = 1.25;
      const random = seeded(seed);
      const graph = buildSfxGraph(context, { random });
      const before = context.nodes.length;
      const at = context.currentTime + 0.005;
      const voice = scheduleSfxSound(graph, id, at, { random });
      assert.ok(voice, id);
      const created = context.nodes.slice(before);
      const sources = created.filter((node) => node.kind === "oscillator" || node.kind === "bufferSource");
      assert.ok(sources.length > 0, `${id} は音を出す`);
      for (const source of sources) {
        assert.ok(source.started >= at - 1e-9, `${id}: 予約した時刻より前に鳴らさない`);
        assert.ok(source.stopped > source.started, `${id}: 開始より後に止まる`);
        assert.ok(source.stopped - at < 4, `${id}: 4秒以内に終わる`);
        // 音源の先で最初に出会う音量のつまみは、0 から始まっている。
        let node = source.outputs[0];
        while (node && node.kind !== "gain") node = node.outputs[0];
        assert.ok(node, `${id}: 音源のあとに音量のつまみがある`);
        const [first] = node.gain.events;
        assert.deepEqual(first.slice(0, 2), ["setValueAtTime", 0], `${id}: 0 から立ち上がる`);
      }
      assert.ok(voice.endAt > at && Number.isFinite(voice.endAt));
    }
  }
});

test("出口には割れ防止（リミッターとなめらかな頭打ち）と残響があり、頭打ちは -0.9dBFS 以下", () => {
  const context = new FakeAudioContext();
  buildSfxGraph(context, { random: seeded(9) });
  const kinds = context.nodes.map((node) => node.kind);
  assert.ok(kinds.includes("compressor"));
  assert.ok(kinds.includes("convolver"));
  const shaper = context.nodes.find((node) => node.kind === "shaper");
  assert.ok(shaper?.curve instanceof Float32Array);
  const peak = Math.max(...shaper.curve.map(Math.abs));
  assert.ok(peak < 0.91, `頭打ちの高さ: ${peak}`);
  assert.equal(shaper.curve[(shaper.curve.length - 1) / 2], 0, "無音は無音のまま");
});

// --- エンジン ---------------------------------------------------------------

test("効果音がオフ・画面が裏のときは、音の仕組みそのものを作らない", async () => {
  let lookups = 0;
  const settings = { enabled: false, hidden: false };
  const engine = createSfxEngine({
    getAudioContextClass: () => {
      lookups += 1;
      return FakeAudioContext;
    },
    isEnabled: () => settings.enabled,
    isHidden: () => settings.hidden,
  });
  assert.equal(engine.play("flip"), null);
  assert.equal(engine.warm(), false);
  settings.enabled = true;
  settings.hidden = true;
  assert.equal(engine.play("correct"), null);
  assert.equal(lookups, 0);
  assert.equal(engine.debugState().hasContext, false);
  assert.equal(engine.playCount, 0);
  // Web Audio の無い環境でも、学習は止めない。
  const silent = createSfxEngine({ getAudioContextClass: () => null });
  assert.equal(silent.play("tap"), null);
  assert.equal(silent.warm(), false);
});

test("連打しても1つの仕組みを使い回し、同時に鳴る音は上限を超えない", () => {
  let instances = 0;
  class CountedContext extends FakeAudioContext {
    constructor(options) {
      super(options);
      instances += 1;
      assert.equal(options?.latencyHint, "interactive", "遅れの少ない設定で作る");
    }
  }
  const timers = manualTimers();
  const engine = createSfxEngine({
    getAudioContextClass: () => CountedContext,
    random: seeded(5),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  const events = ["flip", "correct", "wrong", "tap", "slide", "unflip", "key", "toggle-on"];
  for (let index = 0; index < 160; index += 1) {
    const plan = engine.play(events[index % events.length], { direction: "left" });
    assert.ok(plan, `${index}`);
    assert.ok(engine.debugState().activeVoices <= SFX_MAX_VOICES);
  }
  assert.equal(instances, 1);
  assert.equal(engine.playCount, 160);
  assert.equal(engine.debugState().contextState, "running", "鳴らすときに再開する");
});

test("上限に達したときは、鳴り終わった音から外し、まだ鳴っている長い響きは残す", () => {
  const timers = manualTimers();
  let context = null;
  class TrackedContext extends FakeAudioContext {
    constructor() {
      super();
      context = this;
    }
  }
  const engine = createSfxEngine({
    getAudioContextClass: () => TrackedContext,
    random: seeded(21),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  // 伝説の水琴窟（約2秒）を鳴らしてから、短い音を上限を超えるまで鳴らす。
  assert.equal(engine.play("flip", { variant: "suikinkutsu" }).variant, "suikinkutsu");
  const bowl = context.nodes.filter((node) => node.kind === "oscillator");
  // 鳴らした時点で決まっている、自然に止まる時刻を控える。
  const planned = bowl.map((node) => node.stopped);
  assert.ok(Math.max(...planned) > 1.8, "水琴窟は長く響く");
  for (let index = 0; index < SFX_MAX_VOICES + 6; index += 1) {
    context.currentTime += 0.08;
    engine.play("key");
  }
  assert.ok(engine.debugState().activeVoices <= SFX_MAX_VOICES);
  assert.deepEqual(bowl.map((node) => node.stopped), planned, "水琴窟の響きは途中で切られない");
});

test("鳴り終わったら後片付けし、しばらく使わなければ電池のために止め、画面を離れたら止める", () => {
  const timers = manualTimers();
  let context = null;
  class TrackedContext extends FakeAudioContext {
    constructor() {
      super();
      context = this;
    }
  }
  const engine = createSfxEngine({
    getAudioContextClass: () => TrackedContext,
    random: seeded(11),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  assert.ok(engine.warm(), "最初の操作で準備できる");
  assert.ok(engine.play("flip"));
  context.state = "running";
  assert.equal(engine.debugState().activeVoices, 2);
  // 音の後片付け（残響の尾まで待つタイマー）
  timers.run((timer) => timer.milliseconds < 15_000);
  assert.equal(engine.debugState().activeVoices, 0);
  // しばらく鳴らさなければ止める
  timers.run();
  assert.equal(context.suspendCalls, 1);
  assert.equal(context.state, "suspended");
  // 次の音で再開する
  assert.ok(engine.play("tap"));
  assert.equal(context.state, "running");
  // 画面を離れたら止める
  engine.stopAll({ suspend: true });
  timers.run((timer) => timer.milliseconds < 15_000);
  assert.equal(context.suspendCalls, 2);
  assert.equal(engine.debugState().activeVoices, 0);
});

// --- アプリへのつなぎ --------------------------------------------------------

test("アプリ：効果音は初期設定でオン、大きさを選べ、MAXの派手な音とは別の設定", () => {
  assert.match(appSource, /import \{[\s\S]*createSfxEngine[\s\S]*\} from "\.\/sfx\.js\?v=/);
  assert.match(appSource, /uiSound: true,/);
  assert.match(appSource, /uiSoundVolume: "normal",/);
  assert.match(appSource, /isEnabled: \(\) => Boolean\(state\.settings\.uiSound\)/);
  assert.match(appSource, /toggle\("uiSound", "効果音"/);
  assert.match(appSource, /data-sfx-volume="\$\{value\}"/);
  assert.match(appSource, /toggle\("sound", "MAXの演出音"/);
  assert.match(appSource, /state\.settings\.uiSoundVolume = normalizeSfxVolume\(target\.dataset\.sfxVolume\);/);
});

test("アプリ：めくる・払う・答える・ボタン・スイッチ・キーのそれぞれに音がつながっている", () => {
  const flip = functionSource("toggleRecallFace");
  assert.match(flip, /sfx\.play\(session\.revealed \? "flip" : "unflip"\);/);
  assert.ok(flip.indexOf("sfx.play(session.revealed") < flip.lastIndexOf("renderQuiz()"), "描画より先に鳴らす");
  assert.match(flip, /sfx\.play\("swish", \{ up: !session\.choiceQuestionVisible \}\);/);
  for (const name of ["handleRecallSwipe", "handleChoiceNextSwipe"]) {
    const swipe = functionSource(name);
    assert.match(swipe, /sfx\.play\("slide", \{ direction \}\);/, name);
    assert.ok(swipe.indexOf("sfx.play(\"slide\"") > swipe.indexOf("animateSwipeCancel"), `${name}: 戻したスワイプでは鳴らさない`);
  }
  const submit = functionSource("submitAnswer");
  assert.match(submit, /const answerSound = !isRecallMode\(question\.mode\) && Boolean\(sfx\.play\(correct \? "correct" : "wrong"\)\);/);
  assert.ok(submit.indexOf("sfx.play(correct") < submit.indexOf("await recordAttempt"), "保存を待たずに鳴らす");
  assert.match(appSource, /onAnswer: \(correct\) => \{\s*haptics\.trigger\(correct \? "correct" : "wrong"\);\s*sfx\.play\(correct \? "correct" : "wrong"\);/);
  assert.match(appSource, /queueButtonSound\(target\);/);
  assert.match(functionSource("queueButtonSound"), /if \(sfx\.playCount === mark\) sfx\.play\("tap"\);/);
  assert.match(appSource, /sfx\.play\(event\.target\.checked \? "toggle-on" : "toggle-off"\);/);
  assert.match(appSource, /sfx\.play\(action === "delete" \? "key-delete" : "key"\)/);
  assert.match(appSource, /for \(const type of \["pointerdown", "pointerup", "touchend", "keydown"\]\) \{\s*document\.addEventListener\(type, \(\) => sfx\.warm\(\)/);
  assert.match(appSource, /if \(document\.hidden\)[\s\S]{0,320}sfx\.stopAll\(\{ suspend: true \}\)/);
});

test("アプリ：MAXでは、正誤の音を重ねず、コンボなどの節目の音だけを上乗せする", () => {
  assert.match(functionSource("runMaxCue"), /if \(!\(answerSound && \(plan\.event === "correct" \|\| plan\.event === "wrong"\)\)\) \{\s*playMaxSound/);
  assert.match(functionSource("correctEffect"), /runMaxCue\(event, \{[^}]*answerSound \}\)/);
  assert.match(functionSource("wrongEffect"), /answerSound \}\)/);
});

test("オフラインでも効果音が使えるよう、同じ版でキャッシュする", () => {
  assert.match(serviceWorker, /`\.\/src\/sfx\.js\?v=\$\{APP_VERSION\}`/);
  const version = serviceWorker.match(/const APP_VERSION = "([^"]+)"/)[1];
  assert.match(appSource, new RegExp(`from "\\./sfx\\.js\\?v=${version.replaceAll(".", "\\.")}"`));
});
