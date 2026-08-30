export const MAX_TIMELINE_PHASES = [
  "anticipationAt",
  "hitStopAt",
  "flashAt",
  "calloutAt",
  "impactAt",
  "particleBurstAt",
  "fanfareAt",
  "tailEndAt",
];

export const MAX_AUDIO_LIMITS = Object.freeze({
  maxVoices: 48,
  normalVoiceLimit: 14,
  masterGainFull: 0.68,
  masterGainGentle: 0.44,
});

const PALETTES = {
  cyan: ["#e9fbff", "#72ddff", "#ffe18a", "#ffffff"],
  gold: ["#fff8cf", "#ffd45f", "#ff9f43", "#ffffff"],
  jackpot: ["#fffbea", "#ffd45f", "#71e4ff", "#ff7ecb", "#ffffff"],
  platinum: ["#ffffff", "#bdf4ff", "#d6c2ff", "#ffd96e"],
  royal: ["#ffffff", "#f7d66d", "#b990ff", "#69e4ff", "#ff7cda"],
  muted: ["#d8dbe3", "#aeb4c0", "#84909e"],
  release: ["#4c5263", "#bdf4ff", "#ffffff", "#ffd96e"],
};

const cue = ({
  power,
  duration,
  anticipationAt = 0,
  hitStopAt = 0,
  impactAt = 0,
  flashAt = impactAt,
  calloutAt = impactAt,
  particleBurstAt = impactAt,
  fanfareAt = impactAt,
  palette = "cyan",
  callout = "pop",
  emblem = "✦",
  particles,
  rings,
  rays,
  coins = 0,
  stars = 0,
  prisms = 0,
  shower = 0,
  converge = 0,
  beams = 0,
  aura = 1,
  zoom = 0.016,
  shake = 0,
  flash = 0.2,
  freeze = 28,
  stereo = 0.15,
  tail = 0.2,
  layers = 2,
}) => Object.freeze({
  power,
  duration,
  timeline: Object.freeze({
    anticipationAt,
    hitStopAt,
    flashAt,
    calloutAt,
    impactAt,
    particleBurstAt,
    fanfareAt,
    tailEndAt: duration,
  }),
  sound: Object.freeze({ stereo, tail, layers }),
  visual: Object.freeze({
    palette,
    colors: PALETTES[palette],
    callout,
    emblem,
    particles,
    rings,
    rays,
    coins,
    stars,
    prisms,
    shower,
    converge,
    beams,
    aura,
    zoom,
    shake,
    flash,
    freeze,
  }),
});

export const MAX_CUE_DEFINITIONS = Object.freeze({
  "max-enter": cue({
    power: 4, duration: 1120, anticipationAt: 0, hitStopAt: 24, flashAt: 300,
    calloutAt: 300, impactAt: 300, particleBurstAt: 300, fanfareAt: 300,
    palette: "platinum", callout: "royal", emblem: "MAX", particles: 150,
    rings: 2, rays: 32, prisms: 42, converge: 38, beams: 2, aura: 3,
    zoom: 0.055, shake: 7, flash: 0.76, freeze: 72, stereo: 0.62, tail: 0.8, layers: 7,
  }),
  correct: cue({
    power: 1, duration: 330, palette: "cyan", callout: "sharp", emblem: "✓",
    particles: 32, rings: 1, rays: 0, prisms: 10, aura: 1,
    zoom: 0.012, shake: 0, flash: 0.14, freeze: 30, stereo: 0.12, tail: 0.16, layers: 3,
  }),
  "combo-3": cue({
    power: 2, duration: 480, palette: "cyan", callout: "pop", emblem: "Ⅲ",
    particles: 58, rings: 2, rays: 5, prisms: 18, stars: 8, aura: 2,
    zoom: 0.022, shake: 2.5, flash: 0.23, freeze: 32, stereo: 0.28, tail: 0.28, layers: 4,
  }),
  "combo-5": cue({
    power: 2, duration: 620, palette: "gold", callout: "pop", emblem: "Ⅴ",
    particles: 78, rings: 2, rays: 16, coins: 14, stars: 12, prisms: 20, aura: 2,
    zoom: 0.028, shake: 3.5, flash: 0.3, freeze: 38, stereo: 0.42, tail: 0.38, layers: 5,
  }),
  "combo-10": cue({
    power: 3, duration: 820, anticipationAt: 0, hitStopAt: 16, impactAt: 58,
    flashAt: 58, calloutAt: 48, particleBurstAt: 58, fanfareAt: 58,
    palette: "jackpot", callout: "slam", emblem: "Ⅹ", particles: 120,
    rings: 3, rays: 28, coins: 24, stars: 18, prisms: 36, beams: 1, aura: 3,
    zoom: 0.046, shake: 6, flash: 0.48, freeze: 48, stereo: 0.58, tail: 0.58, layers: 7,
  }),
  "combo-20": cue({
    power: 4, duration: 1120, anticipationAt: 0, hitStopAt: 72, impactAt: 156,
    flashAt: 156, calloutAt: 142, particleBurstAt: 156, fanfareAt: 156,
    palette: "gold", callout: "jackpot", emblem: "XX", particles: 160,
    rings: 4, rays: 40, coins: 44, stars: 28, prisms: 45, shower: 38,
    converge: 42, beams: 2, aura: 4, zoom: 0.06, shake: 7,
    flash: 0.58, freeze: 62, stereo: 0.7, tail: 0.84, layers: 9,
  }),
  "combo-30": cue({
    power: 4, duration: 1450, anticipationAt: 0, hitStopAt: 94, impactAt: 168,
    flashAt: 168, calloutAt: 158, particleBurstAt: 168, fanfareAt: 168,
    palette: "jackpot", callout: "unstoppable", emblem: "∞", particles: 190,
    rings: 5, rays: 52, coins: 58, stars: 38, prisms: 58, shower: 56,
    converge: 54, beams: 3, aura: 5, zoom: 0.072, shake: 8,
    flash: 0.64, freeze: 76, stereo: 0.78, tail: 1.05, layers: 11,
  }),
  "new-record": cue({
    power: 4, duration: 1180, anticipationAt: 0, hitStopAt: 48, impactAt: 112,
    flashAt: 112, calloutAt: 104, particleBurstAt: 112, fanfareAt: 112,
    palette: "platinum", callout: "record", emblem: "♛", particles: 145,
    rings: 3, rays: 32, coins: 30, stars: 32, prisms: 40, shower: 28,
    beams: 3, aura: 4, zoom: 0.055, shake: 6, flash: 0.52, freeze: 52,
    stereo: 0.68, tail: 0.86, layers: 9,
  }),
  "weakness-destroyed": cue({
    power: 4, duration: 1060, anticipationAt: 0, hitStopAt: 44, impactAt: 124,
    flashAt: 146, calloutAt: 136, particleBurstAt: 124, fanfareAt: 146,
    palette: "release", callout: "destroyed", emblem: "◆", particles: 138,
    rings: 3, rays: 24, stars: 24, prisms: 56, converge: 22, beams: 2,
    aura: 4, zoom: 0.052, shake: 6, flash: 0.48, freeze: 58,
    stereo: 0.58, tail: 0.78, layers: 8,
  }),
  perfect: cue({
    power: 4, duration: 1680, anticipationAt: 0, hitStopAt: 44, impactAt: 108,
    flashAt: 108, calloutAt: 102, particleBurstAt: 108, fanfareAt: 108,
    palette: "jackpot", callout: "finale", emblem: "★", particles: 190,
    rings: 5, rays: 46, coins: 64, stars: 54, prisms: 52, shower: 68,
    converge: 34, beams: 4, aura: 5, zoom: 0.06, shake: 6,
    flash: 0.56, freeze: 58, stereo: 0.8, tail: 1.28, layers: 12,
  }),
  "sss-master": cue({
    power: 4, duration: 2150, anticipationAt: 0, hitStopAt: 82, impactAt: 176,
    flashAt: 176, calloutAt: 166, particleBurstAt: 176, fanfareAt: 176,
    palette: "royal", callout: "sss", emblem: "♛ SSS ♛", particles: 220,
    rings: 6, rays: 58, coins: 72, stars: 68, prisms: 78, shower: 80,
    converge: 64, beams: 5, aura: 6, zoom: 0.066, shake: 7,
    flash: 0.6, freeze: 72, stereo: 0.86, tail: 1.65, layers: 15,
  }),
  wrong: cue({
    power: 0, duration: 220, palette: "muted", callout: "none", emblem: "",
    particles: 6, rings: 1, rays: 0, aura: 0, zoom: -0.006, shake: 0,
    flash: 0, freeze: 0, stereo: 0, tail: 0.08, layers: 1,
  }),
});

const PENTATONIC_MIDI = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84, 86, 88, 91, 93, 96];

export function midiToFrequency(midi) {
  return 440 * (2 ** ((Number(midi) - 69) / 12));
}

export function comboPitchPlan(combo = 1, requestedVariation = null) {
  const step = Math.max(1, Number(combo) || 1) - 1;
  const variation = requestedVariation === null
    ? step % 4
    : Math.abs(Math.floor(Number(requestedVariation) || 0)) % 4;
  const rootIndex = 5 + (step % 5);
  const patterns = [
    [0, 1, 2],
    [0, 2, 4],
    [0, 1, 3, 5],
    [0, 3, 4, 6],
  ];
  const midi = patterns[variation].map((offset) => PENTATONIC_MIDI[Math.min(rootIndex + offset, PENTATONIC_MIDI.length - 1)]);
  return Object.freeze({
    variation,
    scale: "C-major-pentatonic",
    midi: Object.freeze(midi),
    frequencies: Object.freeze(midi.map(midiToFrequency)),
  });
}

export function maxCueForAnswer({ correct = true, combo = 0, special = "" } = {}) {
  if (!correct) return "wrong";
  const normalizedSpecial = String(special).trim().toUpperCase();
  if (normalizedSpecial === "NEW RECORD") return "new-record";
  if (normalizedSpecial === "WEAKNESS DESTROYED") return "weakness-destroyed";
  const value = Math.max(0, Number(combo) || 0);
  if (value >= 30) return "combo-30";
  if (value >= 20) return "combo-20";
  if (value >= 10) return "combo-10";
  if (value >= 5) return "combo-5";
  if (value >= 3) return "combo-3";
  return "correct";
}

export function maxCueForFinale(sssOnly = false) {
  return sssOnly ? "sss-master" : "perfect";
}

export function scaledVisualPlan(visual, { lowPower = false, reducedMotion = false } = {}) {
  const factor = reducedMotion ? 0 : lowPower ? 0.54 : 1;
  const scale = (value) => Math.max(0, Math.round((Number(value) || 0) * factor));
  return Object.freeze({
    ...visual,
    particles: scale(visual.particles),
    rings: reducedMotion ? 0 : scale(visual.rings),
    rays: reducedMotion ? 0 : scale(visual.rays),
    coins: scale(visual.coins),
    stars: scale(visual.stars),
    prisms: scale(visual.prisms),
    shower: scale(visual.shower),
    converge: scale(visual.converge),
    beams: reducedMotion ? 0 : scale(visual.beams),
    zoom: reducedMotion ? 0 : visual.zoom,
    shake: reducedMotion ? 0 : visual.shake,
    freeze: reducedMotion ? 0 : visual.freeze,
    flash: reducedMotion ? Math.min(0.18, visual.flash) : visual.flash,
  });
}

export function resolveMaxCue(event, options = {}) {
  const name = MAX_CUE_DEFINITIONS[event] ? event : "correct";
  const definition = MAX_CUE_DEFINITIONS[name];
  const combo = Math.max(0, Number(options.combo) || 0);
  return Object.freeze({
    event: name,
    combo,
    power: options.power === undefined ? definition.power : Math.max(0, Number(options.power) || 0),
    duration: definition.duration,
    timeline: definition.timeline,
    sound: definition.sound,
    visual: definition.visual,
    pitch: comboPitchPlan(Math.max(1, combo), options.variation ?? null),
  });
}

export function shouldPlayMaxSound(settings = {}, { hidden = false, audioAvailable = true } = {}) {
  return Boolean(
    settings.effectsMode === "max"
    && settings.sound === true
    && !hidden
    && audioAvailable,
  );
}
