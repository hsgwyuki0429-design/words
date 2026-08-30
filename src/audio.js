import { MAX_AUDIO_LIMITS, resolveMaxCue } from "./max-cues.js?v=2026.2.17";

const CORRECT_EVENTS = new Set(["correct", "combo-3", "combo-5", "combo-10", "combo-20", "combo-30"]);

function defaultAudioContextClass() {
  if (typeof window === "undefined") return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

export function createMaxAudioEngine({ getAudioContextClass = defaultAudioContextClass } = {}) {
  let context = null;
  let masterInput = null;
  let masterGain = null;
  let compressor = null;
  let delayInput = null;
  let noiseBuffer = null;
  let nextVoiceId = 1;
  const voices = new Map();
  const normalVoiceIds = new Set();

  function disconnectNode(node) {
    try { node.disconnect(); } catch { /* Optional cleanup. */ }
  }

  function cleanupVoice(voice) {
    if (!voice || !voices.has(voice.id)) return;
    voices.delete(voice.id);
    normalVoiceIds.delete(voice.id);
    if (voice.cleanupTimer) clearTimeout(voice.cleanupTimer);
    voice.nodes.forEach(disconnectNode);
  }

  function stopVoice(voice, fadeSeconds = 0.025) {
    if (!voice || !voices.has(voice.id) || !context) return;
    if (voice.cleanupTimer) clearTimeout(voice.cleanupTimer);
    const now = context.currentTime;
    try {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value || 0.0001), now);
      voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + fadeSeconds);
    } catch { /* Already stopped. */ }
    for (const source of voice.sources) {
      try { source.stop(now + fadeSeconds + 0.008); } catch { /* Already stopped. */ }
    }
    voice.cleanupTimer = setTimeout(() => cleanupVoice(voice), Math.ceil((fadeSeconds + 0.08) * 1000));
  }

  function trimVoices() {
    while (voices.size >= MAX_AUDIO_LIMITS.maxVoices) {
      const oldest = voices.values().next().value;
      stopVoice(oldest, 0.012);
      cleanupVoice(oldest);
    }
  }

  function registerVoice({ source, gain, nodes, normal = false, stopAt }) {
    trimVoices();
    const voice = {
      id: nextVoiceId,
      sources: [source],
      gain,
      nodes,
      normal,
      startedAt: context.currentTime,
      cleanupTimer: 0,
    };
    nextVoiceId += 1;
    voices.set(voice.id, voice);
    if (normal) normalVoiceIds.add(voice.id);
    source.onended = () => cleanupVoice(voice);
    const remainingMs = Math.max(100, Math.ceil((stopAt - context.currentTime + 0.35) * 1000));
    voice.cleanupTimer = setTimeout(() => cleanupVoice(voice), remainingMs);
    return voice;
  }

  function createMasterGraph() {
    masterInput = context.createGain();
    masterGain = context.createGain();
    compressor = context.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-20, context.currentTime);
    compressor.knee.setValueAtTime(18, context.currentTime);
    compressor.ratio.setValueAtTime(8, context.currentTime);
    compressor.attack.setValueAtTime(0.003, context.currentTime);
    compressor.release.setValueAtTime(0.22, context.currentTime);
    masterGain.gain.setValueAtTime(MAX_AUDIO_LIMITS.masterGainGentle, context.currentTime);
    masterInput.connect(masterGain).connect(compressor).connect(context.destination);

    const delay = context.createDelay(0.6);
    const feedback = context.createGain();
    const wet = context.createGain();
    const filter = context.createBiquadFilter();
    delay.delayTime.setValueAtTime(0.135, context.currentTime);
    feedback.gain.setValueAtTime(0.16, context.currentTime);
    wet.gain.setValueAtTime(0.15, context.currentTime);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(4800, context.currentTime);
    delayInput = context.createGain();
    delayInput.gain.setValueAtTime(1, context.currentTime);
    delayInput.connect(delay).connect(filter).connect(wet).connect(masterInput);
    filter.connect(feedback).connect(delay);
  }

  function ensureContext() {
    if (context) return context;
    const AudioContextClass = getAudioContextClass?.();
    if (!AudioContextClass) return null;
    try {
      context = new AudioContextClass({ latencyHint: "interactive" });
      createMasterGraph();
      return context;
    } catch {
      context = null;
      return null;
    }
  }

  function setIntensity(intensity = "gentle") {
    if (!context || !masterGain) return;
    const value = intensity === "full"
      ? MAX_AUDIO_LIMITS.masterGainFull
      : MAX_AUDIO_LIMITS.masterGainGentle;
    const now = context.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setTargetAtTime(value, now, 0.025);
  }

  function muteMaster(fadeSeconds = 0.035) {
    if (!context || !masterGain) return;
    const now = context.currentTime;
    try {
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.setValueAtTime(Math.max(0.0001, masterGain.gain.value || 0.0001), now);
      masterGain.gain.exponentialRampToValueAtTime(0.0001, now + fadeSeconds);
    } catch { /* Context can close while the page is being discarded. */ }
  }

  async function unlock({ enabled = false, intensity = "gentle" } = {}) {
    if (!enabled) return false;
    const audioContext = ensureContext();
    if (!audioContext) return false;
    setIntensity(intensity);
    try {
      if (audioContext.state === "suspended") await audioContext.resume();
      return audioContext.state === "running";
    } catch {
      return false;
    }
  }

  function connectVoiceOutput(gain, pan = 0, send = 0) {
    const nodes = [];
    let output = gain;
    if (typeof context.createStereoPanner === "function") {
      const panner = context.createStereoPanner();
      panner.pan.setValueAtTime(Math.max(-0.9, Math.min(0.9, pan)), context.currentTime);
      gain.connect(panner);
      output = panner;
      nodes.push(panner);
    }
    output.connect(masterInput);
    if (send > 0 && delayInput) {
      const sendGain = context.createGain();
      sendGain.gain.setValueAtTime(Math.min(0.5, send), context.currentTime);
      output.connect(sendGain).connect(delayInput);
      nodes.push(sendGain);
    }
    return nodes;
  }

  function tone({
    frequency,
    endFrequency = null,
    when,
    duration,
    gain = 0.05,
    attack = 0.006,
    release = 0.12,
    type = "sine",
    pan = 0,
    filterFrequency = 6400,
    send = 0,
    normal = false,
  }) {
    if (!context || frequency <= 0 || duration <= 0) return;
    const oscillator = context.createOscillator();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, when);
    if (endFrequency && endFrequency > 0) {
      oscillator.frequency.exponentialRampToValueAtTime(endFrequency, when + duration * 0.78);
    }
    filter.type = "lowpass";
    filter.Q.setValueAtTime(0.7, when);
    filter.frequency.setValueAtTime(filterFrequency, when);
    envelope.gain.setValueAtTime(0.0001, when);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), when + Math.max(0.002, attack));
    envelope.gain.setValueAtTime(Math.max(0.0002, gain * 0.78), when + Math.max(attack, duration - release));
    envelope.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    oscillator.connect(filter).connect(envelope);
    const outputNodes = connectVoiceOutput(envelope, pan, send);
    oscillator.start(when);
    oscillator.stop(when + duration + 0.02);
    registerVoice({
      source: oscillator,
      gain: envelope,
      nodes: [oscillator, filter, envelope, ...outputNodes],
      normal,
      stopAt: when + duration + 0.02,
    });
  }

  function getNoiseBuffer() {
    if (noiseBuffer) return noiseBuffer;
    const length = Math.max(1, Math.floor(context.sampleRate * 1.5));
    noiseBuffer = context.createBuffer(1, length, context.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) {
      data[index] = (Math.random() * 2 - 1) * (1 - index / data.length * 0.18);
    }
    return noiseBuffer;
  }

  function noise({
    when,
    duration,
    gain = 0.025,
    attack = 0.002,
    filterType = "highpass",
    filterFrequency = 2400,
    endFilterFrequency = null,
    pan = 0,
    send = 0,
    normal = false,
  }) {
    if (!context || duration <= 0) return;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    source.buffer = getNoiseBuffer();
    filter.type = filterType;
    filter.Q.setValueAtTime(0.9, when);
    filter.frequency.setValueAtTime(filterFrequency, when);
    if (endFilterFrequency) {
      filter.frequency.exponentialRampToValueAtTime(endFilterFrequency, when + duration * 0.85);
    }
    envelope.gain.setValueAtTime(0.0001, when);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), when + Math.max(0.002, attack));
    envelope.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    source.connect(filter).connect(envelope);
    const outputNodes = connectVoiceOutput(envelope, pan, send);
    source.start(when, 0, Math.min(duration + 0.02, noiseBuffer.duration));
    source.stop(when + duration + 0.03);
    registerVoice({
      source,
      gain: envelope,
      nodes: [source, filter, envelope, ...outputNodes],
      normal,
      stopAt: when + duration + 0.03,
    });
  }

  function click(when, normal, strength = 1) {
    noise({ when, duration: 0.026, gain: 0.036 * strength, filterFrequency: 3900, normal });
    tone({ frequency: 1320, endFrequency: 780, when, duration: 0.035, gain: 0.018 * strength, type: "square", filterFrequency: 4200, normal });
  }

  function crystal(frequency, when, { gain = 0.035, pan = 0, duration = 0.22, send = 0.18, normal = false } = {}) {
    tone({ frequency, when, duration, gain, type: "sine", pan, filterFrequency: 7600, send, normal });
    tone({ frequency: frequency * 2.01, when: when + 0.004, duration: duration * 0.72, gain: gain * 0.32, type: "triangle", pan: -pan * 0.8, filterFrequency: 8800, send: send * 0.8, normal });
  }

  function impact(when, strength = 1, normal = false) {
    tone({ frequency: 170, endFrequency: 82, when, duration: 0.22, gain: 0.052 * strength, type: "triangle", filterFrequency: 1200, normal });
    tone({ frequency: 330, endFrequency: 220, when: when + 0.004, duration: 0.15, gain: 0.025 * strength, type: "sine", filterFrequency: 1800, normal });
    noise({ when, duration: 0.09, gain: 0.018 * strength, filterType: "bandpass", filterFrequency: 720, endFilterFrequency: 320, normal });
  }

  function reward(plan, when, scale = 1, normal = true) {
    const root = plan.pitch.frequencies[0];
    click(when, normal, scale);
    crystal(root * 2, when + 0.018, { gain: 0.032 * scale, pan: -0.08, duration: 0.18 + plan.sound.tail * 0.12, send: 0.12 + plan.sound.tail * 0.12, normal });
    crystal(root * 3, when + 0.032, { gain: 0.019 * scale, pan: 0.11, duration: 0.14 + plan.sound.tail * 0.1, send: 0.18, normal });
  }

  function chord(frequencies, when, { duration = 0.42, gain = 0.027, width = 0.4, send = 0.22, normal = false } = {}) {
    const notes = frequencies.slice(0, 5);
    notes.forEach((frequency, index) => {
      const pan = notes.length <= 1 ? 0 : ((index / (notes.length - 1)) * 2 - 1) * width;
      crystal(frequency, when + index * 0.006, { gain, pan, duration, send, normal });
    });
  }

  function run(frequencies, when, { spacing = 0.065, duration = 0.2, gain = 0.026, width = 0.5, repeats = 1, normal = false } = {}) {
    const sequence = [];
    for (let repeat = 0; repeat < repeats; repeat += 1) sequence.push(...frequencies);
    sequence.forEach((frequency, index) => {
      const pan = ((index % 2) * 2 - 1) * width;
      crystal(frequency, when + index * spacing, { gain, pan, duration, send: 0.2, normal });
    });
  }

  function shimmer(frequency, when, duration, width = 0.65, normal = false) {
    for (let index = 0; index < 4; index += 1) {
      const offset = [1, 1.5, 2, 2.5][index];
      crystal(frequency * offset, when + index * 0.038, {
        gain: 0.012 - index * 0.0015,
        pan: index % 2 ? width : -width,
        duration: duration * (1 - index * 0.08),
        send: 0.34,
        normal,
      });
    }
  }

  function riser(frequency, when, duration, strength = 1) {
    tone({ frequency: frequency * 0.5, endFrequency: frequency * 2, when, duration, gain: 0.022 * strength, type: "sawtooth", filterFrequency: 2600, send: 0.18 });
    noise({ when, duration, gain: 0.016 * strength, filterType: "bandpass", filterFrequency: 480, endFilterFrequency: 6200, send: 0.16 });
  }

  function fadeNormalVoices() {
    for (const id of [...normalVoiceIds]) stopVoice(voices.get(id), 0.024);
  }

  function scheduleCue(plan, intensity) {
    const normal = CORRECT_EVENTS.has(plan.event);
    const full = intensity === "full";
    const t = context.currentTime + 0.008;
    const hit = t + plan.timeline.impactAt / 1000;
    const notes = plan.pitch.frequencies;
    const root = notes[0];
    const scale = full ? 1 : 0.78;
    if (normal) fadeNormalVoices();

    switch (plan.event) {
      case "wrong":
        tone({ frequency: 196, endFrequency: 154, when: hit, duration: 0.12, gain: 0.026 * scale, type: "triangle", filterFrequency: 820 });
        noise({ when: hit, duration: 0.07, gain: 0.007 * scale, filterType: "lowpass", filterFrequency: 620 });
        break;
      case "correct":
        reward(plan, hit, scale, true);
        break;
      case "combo-3":
        reward(plan, hit, scale, true);
        chord([notes[0], notes[2] ?? notes[1]], hit + 0.045, { duration: 0.3, gain: 0.022 * scale, width: 0.24, normal: true });
        break;
      case "combo-5":
        reward(plan, hit, scale, true);
        run(notes.slice(0, 3), hit + 0.045, { spacing: 0.066, gain: 0.023 * scale, width: 0.44, normal: true });
        if (full) shimmer(root * 2, hit + 0.15, 0.34, 0.52, true);
        break;
      case "combo-10":
        reward(plan, hit, scale, true);
        impact(hit, 0.75 * scale, true);
        chord(notes.slice(0, 4), hit + 0.035, { duration: 0.46, gain: 0.026 * scale, width: 0.5, normal: true });
        if (full) run(notes, hit + 0.1, { spacing: 0.055, gain: 0.019 * scale, width: 0.62, normal: true });
        break;
      case "combo-20":
        riser(root, t, Math.max(0.12, (plan.timeline.impactAt - 12) / 1000), 0.8 * scale);
        run(notes.concat(notes.slice().reverse()), t + 0.015, { spacing: 0.033, duration: 0.15, gain: 0.014 * scale, width: 0.68 });
        impact(hit, 1.05 * scale);
        if (full) impact(hit + 0.14, 0.72 * scale);
        chord(notes.slice(0, 5), hit + 0.025, { duration: 0.62, gain: 0.028 * scale, width: 0.68, send: 0.3 });
        if (full) shimmer(root * 2, hit + 0.24, 0.58, 0.78);
        break;
      case "combo-30":
        riser(root * 0.75, t, Math.max(0.14, (plan.timeline.impactAt - 8) / 1000), scale);
        run(notes, t + 0.02, { spacing: 0.028, duration: 0.17, gain: 0.014 * scale, width: 0.76, repeats: full ? 2 : 1 });
        impact(hit, 1.18 * scale);
        chord(notes.slice(0, 5), hit + 0.018, { duration: 0.88, gain: 0.03 * scale, width: 0.78, send: 0.34 });
        run(notes.concat(notes.slice(-3).reverse()), hit + 0.18, { spacing: 0.07, duration: 0.28, gain: 0.021 * scale, width: 0.8 });
        if (full) shimmer(root * 2, hit + 0.42, 0.72, 0.85);
        break;
      case "max-enter":
        riser(root * 0.5, t, 0.29, 0.9 * scale);
        run(notes.slice(0, 4), t + 0.045, { spacing: 0.06, duration: 0.19, gain: 0.019 * scale, width: 0.58 });
        impact(hit, 1.12 * scale);
        chord(notes.slice(0, 5), hit + 0.012, { duration: 0.62, gain: 0.029 * scale, width: 0.72, send: 0.32 });
        if (full) shimmer(root * 2, hit + 0.18, 0.56, 0.8);
        break;
      case "new-record":
        riser(root, t, Math.max(0.09, plan.timeline.impactAt / 1000), 0.65 * scale);
        impact(hit, 0.82 * scale);
        run(notes.concat([notes.at(-1) * 1.25]), hit + 0.01, { spacing: 0.085, duration: 0.28, gain: 0.025 * scale, width: 0.7 });
        chord(notes.slice(-3), hit + 0.31, { duration: 0.62, gain: 0.026 * scale, width: 0.6, send: 0.34 });
        if (full) shimmer(root * 2, hit + 0.34, 0.58, 0.8);
        break;
      case "weakness-destroyed":
        tone({ frequency: 118, endFrequency: 62, when: t, duration: 0.16, gain: 0.047 * scale, type: "sawtooth", filterFrequency: 720 });
        noise({ when: t, duration: 0.18, gain: 0.027 * scale, filterType: "lowpass", filterFrequency: 900, endFilterFrequency: 280 });
        impact(hit, 0.95 * scale);
        chord(notes.slice(0, 4), hit + 0.03, { duration: 0.62, gain: 0.028 * scale, width: 0.65, send: 0.34 });
        if (full) run(notes, hit + 0.16, { spacing: 0.068, duration: 0.24, gain: 0.021 * scale, width: 0.7 });
        break;
      case "perfect":
        riser(root * 0.55, t, Math.max(0.09, plan.timeline.impactAt / 1000), 0.8 * scale);
        impact(hit, 1.12 * scale);
        chord(notes.slice(0, 5), hit + 0.01, { duration: 1.05, gain: 0.03 * scale, width: 0.8, send: 0.38 });
        run(notes.concat(notes.slice(1)), hit + 0.12, { spacing: 0.072, duration: 0.3, gain: 0.022 * scale, width: 0.84 });
        if (full) shimmer(root * 2, hit + 0.4, 0.92, 0.88);
        break;
      case "sss-master":
        riser(root * 0.45, t, Math.max(0.14, plan.timeline.impactAt / 1000), scale);
        run(notes, t + 0.018, { spacing: 0.035, duration: 0.2, gain: 0.016 * scale, width: 0.82, repeats: full ? 2 : 1 });
        impact(hit, 1.2 * scale);
        chord(notes.slice(0, 5), hit + 0.008, { duration: 1.42, gain: 0.031 * scale, width: 0.86, send: 0.42 });
        run(notes.concat(notes.slice().reverse()), hit + 0.18, { spacing: 0.065, duration: 0.34, gain: 0.022 * scale, width: 0.88 });
        if (full) {
          chord(notes.slice(-4).map((frequency) => frequency * 1.5), hit + 0.72, { duration: 0.88, gain: 0.018 * scale, width: 0.8, send: 0.44 });
          shimmer(root * 2, hit + 0.54, 1.12, 0.9);
        }
        break;
      default:
        reward(plan, hit, scale, normal);
        break;
    }
  }

  function play(event, options = {}) {
    if (!options.enabled || options.hidden) return false;
    const audioContext = ensureContext();
    if (!audioContext) return false;
    setIntensity(options.intensity);
    if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
    try {
      scheduleCue(resolveMaxCue(event, options), options.intensity);
      return true;
    } catch {
      return false;
    }
  }

  function stopAll({ suspend = false } = {}) {
    muteMaster();
    for (const voice of [...voices.values()]) stopVoice(voice, 0.035);
    if (suspend && context?.state === "running") {
      setTimeout(() => context?.suspend?.().catch(() => {}), 50);
    }
  }

  function debugState() {
    return Object.freeze({
      hasContext: Boolean(context),
      contextState: context?.state ?? "uninitialized",
      activeVoices: voices.size,
      normalVoices: normalVoiceIds.size,
      maxVoices: MAX_AUDIO_LIMITS.maxVoices,
      masterGain: masterGain?.gain?.value ?? 0,
    });
  }

  return Object.freeze({ unlock, play, stopAll, setIntensity, debugState });
}
