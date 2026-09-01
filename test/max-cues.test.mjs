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
  assert.match(indexHtml, /styles\.css\?v=2026\.9\.2b/);
  assert.match(indexHtml, /src\/app\.js\?v=2026\.9\.2b/);
  assert.match(serviceWorker, /words-2026-9-v5/);
  assert.match(serviceWorker, /src\/quiz-gestures\.js\?v=2026\.9\.1b/);
  assert.match(serviceWorker, /src\/audio\.js\?v=2026\.2\.18/);
  assert.match(serviceWorker, /src\/max-cues\.js\?v=2026\.2\.18/);
});
