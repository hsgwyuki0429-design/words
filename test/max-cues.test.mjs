import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { createMaxAudioEngine } from "../src/audio.js";
import {
  MAX_AUDIO_LIMITS,
  MAX_CUE_DEFINITIONS,
  MAX_TIMELINE_PHASES,
  comboPitchPlan,
  maxCueForAnswer,
  maxCueForFinale,
  resolveMaxCue,
  scaledVisualPlan,
  shouldPlayMaxSound,
} from "../src/max-cues.js";

const appSource = fs.readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const indexHtml = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const serviceWorker = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");

test("answer combo thresholds select progressively richer cues", () => {
  const expectations = new Map([
    [1, "correct"], [2, "correct"], [3, "combo-3"], [4, "combo-3"],
    [5, "combo-5"], [9, "combo-5"], [10, "combo-10"], [19, "combo-10"],
    [20, "combo-20"], [29, "combo-20"], [30, "combo-30"], [70, "combo-30"],
  ]);
  for (const [combo, expected] of expectations) {
    assert.equal(maxCueForAnswer({ correct: true, combo }), expected, `combo ${combo}`);
  }
  assert.equal(maxCueForAnswer({ correct: false, combo: 30 }), "wrong");
});

test("achievement and finale cues remain unique", () => {
  assert.equal(maxCueForAnswer({ combo: 12, special: "NEW RECORD" }), "new-record");
  assert.equal(maxCueForAnswer({ combo: 12, special: "WEAKNESS DESTROYED" }), "weakness-destroyed");
  assert.equal(maxCueForFinale(false), "perfect");
  assert.equal(maxCueForFinale(true), "sss-master");
  assert.ok(MAX_CUE_DEFINITIONS.perfect.sound.layers > MAX_CUE_DEFINITIONS.correct.sound.layers);
  assert.ok(MAX_CUE_DEFINITIONS["sss-master"].sound.layers > MAX_CUE_DEFINITIONS.perfect.sound.layers);
  assert.ok(MAX_CUE_DEFINITIONS["sss-master"].duration > MAX_CUE_DEFINITIONS.perfect.duration);
});

test("combo notes stay in C major pentatonic and provide four deterministic variations", () => {
  const allowedPitchClasses = new Set([0, 2, 4, 7, 9]);
  const signatures = new Set();
  for (let variation = 0; variation < 4; variation += 1) {
    const plan = comboPitchPlan(17, variation);
    assert.equal(plan.scale, "C-major-pentatonic");
    assert.equal(plan.variation, variation);
    assert.ok(plan.midi.length >= 3);
    assert.equal(new Set(plan.midi).size, plan.midi.length);
    plan.midi.forEach((note) => assert.ok(allowedPitchClasses.has(note % 12), `MIDI ${note}`));
    plan.frequencies.forEach((frequency) => assert.ok(Number.isFinite(frequency) && frequency > 0));
    signatures.add(plan.midi.join(","));
  }
  assert.equal(signatures.size, 4);
  assert.equal(comboPitchPlan(9).variation, comboPitchPlan(1).variation);
});

test("all cue timelines are ordered, bounded and share every phase", () => {
  for (const event of Object.keys(MAX_CUE_DEFINITIONS)) {
    const plan = resolveMaxCue(event, { combo: 20 });
    assert.deepEqual(Object.keys(plan.timeline), MAX_TIMELINE_PHASES);
    for (const phase of MAX_TIMELINE_PHASES) {
      assert.ok(plan.timeline[phase] >= 0, `${event}:${phase}`);
      assert.ok(plan.timeline[phase] <= plan.duration, `${event}:${phase}`);
    }
    assert.equal(plan.timeline.tailEndAt, plan.duration);
    assert.ok(plan.timeline.impactAt >= plan.timeline.anticipationAt);
    assert.ok(plan.timeline.particleBurstAt >= plan.timeline.anticipationAt);
  }
});

test("visual richness grows at combo milestones and scales down safely", () => {
  const richness = (event) => {
    const visual = MAX_CUE_DEFINITIONS[event].visual;
    return visual.particles + visual.prisms + visual.coins + visual.stars + visual.rays + visual.rings * 8;
  };
  const milestones = ["correct", "combo-3", "combo-5", "combo-10", "combo-20", "combo-30"];
  for (let index = 1; index < milestones.length; index += 1) {
    assert.ok(richness(milestones[index]) > richness(milestones[index - 1]));
  }
  const full = MAX_CUE_DEFINITIONS["combo-30"].visual;
  const lowPower = scaledVisualPlan(full, { lowPower: true });
  const reduced = scaledVisualPlan(full, { reducedMotion: true });
  assert.ok(lowPower.particles < full.particles && lowPower.particles > 0);
  assert.equal(reduced.particles, 0);
  assert.equal(reduced.rays, 0);
  assert.equal(reduced.shake, 0);
  assert.equal(reduced.zoom, 0);
  assert.ok(reduced.flash <= 0.18);
});

test("sound preference gate never creates audio work when disabled", async () => {
  let classLookups = 0;
  const engine = createMaxAudioEngine({
    getAudioContextClass: () => {
      classLookups += 1;
      return class UnusedAudioContext {};
    },
  });
  assert.equal(shouldPlayMaxSound({ effectsMode: "max", sound: false }), false);
  assert.equal(shouldPlayMaxSound({ effectsMode: "simple", sound: true }), false);
  assert.equal(shouldPlayMaxSound({ effectsMode: "max", sound: true }, { hidden: true }), false);
  assert.equal(engine.play("correct", { enabled: false }), false);
  assert.equal(await engine.unlock({ enabled: false }), false);
  assert.equal(classLookups, 0);
  assert.equal(engine.debugState().hasContext, false);
});

class FakeParam {
  constructor(value = 0) { this.value = value; }
  setValueAtTime(value) { this.value = value; }
  setTargetAtTime(value) { this.value = value; }
  exponentialRampToValueAtTime(value) { this.value = value; }
  cancelScheduledValues() {}
}

class FakeNode {
  constructor() {
    this.gain = new FakeParam(1);
    this.frequency = new FakeParam(440);
    this.Q = new FakeParam(0);
    this.pan = new FakeParam(0);
    this.delayTime = new FakeParam(0);
    this.threshold = new FakeParam(0);
    this.knee = new FakeParam(0);
    this.ratio = new FakeParam(0);
    this.attack = new FakeParam(0);
    this.release = new FakeParam(0);
    this.onended = null;
  }
  connect(target) { return target; }
  disconnect() {}
  start() {}
  stop() {}
}

class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 8_000;
    this.state = "suspended";
    this.destination = new FakeNode();
  }
  createGain() { return new FakeNode(); }
  createDynamicsCompressor() { return new FakeNode(); }
  createDelay() { return new FakeNode(); }
  createBiquadFilter() { return new FakeNode(); }
  createStereoPanner() { return new FakeNode(); }
  createOscillator() { return new FakeNode(); }
  createBufferSource() { return new FakeNode(); }
  createBuffer(_channels, length, sampleRate) {
    const samples = new Float32Array(length);
    return { duration: length / sampleRate, getChannelData: () => samples };
  }
  async resume() { this.state = "running"; }
  async suspend() { this.state = "suspended"; }
}

test("rapid rewards reuse one context and keep voices within the hard ceiling", async () => {
  let instances = 0;
  class CountedAudioContext extends FakeAudioContext {
    constructor(options) {
      super(options);
      instances += 1;
    }
  }
  const engine = createMaxAudioEngine({ getAudioContextClass: () => CountedAudioContext });
  assert.equal(await engine.unlock({ enabled: true, intensity: "gentle" }), true);
  for (let combo = 1; combo <= 120; combo += 1) {
    assert.equal(engine.play(maxCueForAnswer({ combo }), {
      enabled: true,
      combo,
      intensity: combo % 2 ? "gentle" : "full",
    }), true);
    assert.ok(engine.debugState().activeVoices <= MAX_AUDIO_LIMITS.maxVoices);
  }
  assert.equal(instances, 1);
  engine.stopAll({ suspend: true });
  await new Promise((resolve) => setTimeout(resolve, 140));
  assert.equal(engine.debugState().activeVoices, 0);
  assert.equal(engine.debugState().contextState, "suspended");
  assert.equal(engine.debugState().masterGain, 0.0001);
});

test("app integration unlocks on MAX actions and stops on mode exit or background", () => {
  assert.doesNotMatch(appSource, /playEffectSound\s*\(/);
  assert.match(appSource, /unlockMaxAudio\(\);[\s\S]{0,220}triggerMaxEntrance/);
  assert.match(appSource, /if \(document\.hidden\)[\s\S]{0,240}maxAudio\.stopAll\(\{ suspend: true \}\)/);
  assert.match(appSource, /function triggerMaxExit\(\)[\s\S]{0,240}maxAudio\.stopAll\(\)/);
  assert.match(appSource, /for \(const phase of MAX_TIMELINE_PHASES\)/);
  assert.match(appSource, /window\.__WORDS_MAX_EFFECTS_LAB__/);
});

test("PWA cache ships every versioned MAX effect asset", () => {
  const appVersion = serviceWorker.match(/const APP_VERSION = "([^"]+)"/)?.[1];
  assert.ok(appVersion, "the service worker must declare an application version");
  assert.match(indexHtml, new RegExp(`styles\\.css\\?v=${appVersion.replaceAll(".", "\\.")}`));
  assert.match(indexHtml, new RegExp(`src/app\\.js\\?v=${appVersion.replaceAll(".", "\\.")}`));
  assert.match(serviceWorker, /const CACHE_NAME = `words-\$\{APP_VERSION\}`/);
  assert.match(serviceWorker, /src\/logic\.js\?v=\$\{APP_VERSION\}/);
  assert.match(serviceWorker, /src\/quiz-gestures\.js\?v=\$\{APP_VERSION\}/);
  assert.match(serviceWorker, /src\/storage\.js\?v=\$\{APP_VERSION\}/);
  // 演出の音と設計も、ほかの部品と同じバージョンでそろえて入れ替える。
  assert.match(serviceWorker, /src\/audio\.js\?v=\$\{APP_VERSION\}/);
  assert.match(serviceWorker, /src\/max-cues\.js\?v=\$\{APP_VERSION\}/);
});

test("フィーバー：正解でゲージがたまり、満タンで入り、間違えると終わる", async () => {
  const { MAX_FEVER_GOAL, createFeverState, nextFeverState } = await import("../src/max-cues.js");
  let fever = createFeverState();
  for (let index = 1; index < MAX_FEVER_GOAL; index += 1) {
    fever = nextFeverState(fever, { correct: true });
    assert.equal(fever.active, false);
    assert.equal(fever.gauge, index);
  }
  fever = nextFeverState(fever, { correct: true });
  assert.equal(fever.active, true);
  assert.equal(fever.entered, true, "満タンになった回答で入る");
  fever = nextFeverState(fever, { correct: true });
  assert.equal(fever.entered, false, "入ったあとは入り直さない");
  assert.equal(fever.active, true);
  fever = nextFeverState(fever, { correct: false });
  assert.deepEqual([fever.active, fever.gauge, fever.ended], [false, 0, true]);
  assert.equal(nextFeverState(createFeverState(), { correct: false }).ended, false, "入っていなければ終わりもない");
});

test("クリティカルは、ときどき出る。速い答えとフィーバー中は出やすく、コンボの節目には重ねない", async () => {
  const { criticalChance, rollCritical, speedRating } = await import("../src/max-cues.js");
  assert.equal(speedRating(1200), "lightning");
  assert.equal(speedRating(2500), "fast");
  assert.equal(speedRating(9000), null);
  assert.equal(speedRating(undefined), null);
  assert.ok(criticalChance({ durationMs: 9000 }) < criticalChance({ durationMs: 2500 }));
  assert.ok(criticalChance({ durationMs: 2500 }) < criticalChance({ durationMs: 1200 }));
  assert.ok(criticalChance({ durationMs: 1200, fever: true }) <= 0.3, "上限は3割");
  assert.equal(rollCritical({ durationMs: 9000, random: () => 0.05 }), true);
  assert.equal(rollCritical({ durationMs: 9000, random: () => 0.5 }), false);
  assert.equal(rollCritical({ combo: 10, random: () => 0 }), false, "節目は節目の演出だけ");
});

test("新記録の演出は、始めた時点の自己ベストを超えた1回だけ", async () => {
  const { isRecordMoment, heatLevel } = await import("../src/max-cues.js");
  assert.equal(isRecordMoment({ combo: 9, recordAtStart: 8 }), true);
  assert.equal(isRecordMoment({ combo: 10, recordAtStart: 8 }), false, "超えた1回だけ");
  assert.equal(isRecordMoment({ combo: 9, recordAtStart: 8, announced: true }), false);
  assert.equal(isRecordMoment({ combo: 3, recordAtStart: 2 }), false, "記録が小さいうちは毎回にならないよう出さない");
  assert.deepEqual([0, 3, 5, 10, 20, 30, 99].map(heatLevel), [0, 1, 2, 3, 4, 5, 5]);
});

test("MAXの演出は見た目だけで、HUD・ほめ言葉・吸い込む光・フィーバーを画面に出す", () => {
  assert.match(appSource, /function renderMaxHud\(\)/);
  assert.match(appSource, /isMaxMode\(\) \? renderMaxHud\(\) : `<span class="mode-pill">/);
  assert.match(appSource, /spawnFloatingText\(origin/);
  assert.match(appSource, /spawnCollectOrbs\(origin/);
  assert.match(appSource, /fxTimeout\(enterFever, 280\)/);
  assert.match(appSource, /runMaxCue\("critical"/);
  // フィーバーは回答の前の状態ごと取り消せる
  assert.match(appSource, /fever: \{ \.\.\.state\.fever \},/);
  assert.match(appSource, /state\.fever = undo\.fever \?\? createFeverState\(\);/);
});
