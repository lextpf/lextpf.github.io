
export const PALETTE = Object.freeze({
  base: 0xeef1f6,
  accent: 0x6ba5ff,
  warm: 0xffc98a,
});

export const DEFAULTS = Object.freeze({
  morphStart: 0.01,
  morphEnd: 0.99,
  stagger: 0.30,
  arc: 3.0,
  envelope: 0,

  size: 1.15,
  opacity: 1,
  noise: 0,
  noiseScale: 0.047,
  noiseSpeed: 0.05,
  accent: 1,
  warm: 0.0,
  fogNear: 26,
  fogFar: 170,
  fogTint: 0.45,

  focus: 60,
  focusRange: 90,
  dof: 0,
  bokeh: 0,

  pulse: 1,
  pulseRate: 0.2,
  pulseWidth: 1,
  streak: 0.5,
  vortex: 0,
  pinch: 0,

  bloom: 0.3,
  bloomThreshold: 1,
  bloomRadius: 0.5,
  bloomTight: 1,
  bloomWide: 0.5,
  anamorphic: 0,
  trail: 0,
  dirt: 0,
  haze: 0.06,
  hazeScale: 0.55,
  hazeMix: 0.35,
  lens: 0,
  horizon: 0.0,
  ring: 0.0,
  horizonLight: 0.0,
  chroma: 0,
  exposure: 1.0,
  temp: 0.0,
  sat: 1.0,
  contrast: 1.0,
  lift: 0,
  grain: 0,
  vignette: 0.05,

  loud: 0,
  clockRate: 0.6,
  flowFromScroll: 0,
  narrowPull: 1.08,
});

export const STATE_KEYS = Object.freeze([
  ...Object.keys(DEFAULTS).filter(
    (k) => k !== 'morphStart' && k !== 'morphEnd' && k !== 'envelope'
  ),
  'camX', 'camY', 'camZ', 'tgtX', 'tgtY', 'tgtZ', 'fov',
]);

export const SCENE_LINKED = Object.freeze([
  'lens', 'horizon', 'ring', 'horizonLight', 'warm', 'chroma', 'hazeMix',
]);

export const ENVELOPED = Object.freeze(['chroma', 'anamorphic', 'trail', 'dirt']);

const chapter = (id, selector, scene, camera, target, fov, extra = {}) => ({
  ...DEFAULTS,
  id,
  selector,
  scene,
  camX: camera[0],
  camY: camera[1],
  camZ: camera[2],
  tgtX: target[0],
  tgtY: target[1],
  tgtZ: target[2],
  fov,
  ...extra,
});

export const CHAPTERS = Object.freeze([
  chapter('hero', '#hero', 'crystal', [-24.5, 6.8, 62], [-24.5, 6.8, 0], 38, {
    morphStart: 0.02, morphEnd: 0.99,
    opacity: 0.94,
    bloom: 0.3, bloomThreshold: 0.98, focus: 62,
    pulse: 0.55, pulseRate: 0.1, pulseWidth: 1.1, streak: 0.3,
    hazeMix: 0.3, temp: -0.05, sat: 0.95,
  }),
  chapter('contact', '#contact', 'nucleus', [4, -2, 58], [0, 0, 0], 40, {
    morphStart: 0.01, morphEnd: 0.99,
    opacity: 0.88,
    bloom: 0.36, focus: 58, arc: 4.0, streak: 0.6,
    pulse: 0.85, pulseRate: 0.16, pulseWidth: 1.3,
    hazeMix: 0.4, temp: 0.06, sat: 1.02,
  }),
  chapter('overview', '#overview', 'nucleus', [0, 0, 54], [0, 0, 0], 42, {
    morphStart: 0.01, morphEnd: 0.99,
    opacity: 0.8,
    bloom: 0.34, bloomWide: 0.42, focus: 52, focusRange: 84,
    pulse: 0.6, pulseRate: 0.16, pulseWidth: 1.15, streak: 0.6,
    accent: 0.95, hazeScale: 0.5, hazeMix: 0.42, fogTint: 0.55,
    temp: 0.04, sat: 1.02, lift: 0.007,
  }),
  chapter('career', '#career', 'codex', [-11, 2.5, 60], [-1, 0, -1], 41, {
    morphStart: 0.01, morphEnd: 0.99,
    opacity: 0.8,
    bloom: 0.34, bloomThreshold: 0.98, focus: 61, arc: 3.6,
    pulse: 0.9, pulseRate: 0.22, pulseWidth: 1.0, streak: 0.15,
    hazeMix: 0.5, temp: -0.04, sat: 0.94,
  }),
  chapter('education', '#education', 'planetary', [0, 12, 76], [0, -4, 0], 42, {
    morphStart: 0.01, morphEnd: 0.99, arc: 1.0, stagger: 0.22,
    opacity: 0.84, bloom: 0.3, bloomThreshold: 1.0,
    focus: 76, focusRange: 120, streak: 0.55,
    hazeScale: 0.7, hazeMix: 0.4, temp: -0.12, sat: 0.96,
  }),
  chapter('projects', '#projects', 'galaxy', [0, 28, 44], [0, 0, -2], 44, {
    morphStart: 0.01, morphEnd: 0.85, arc: 1.0, stagger: 0.3,
    opacity: 0.8, warm: 0.5, bloom: 0.32, bloomWide: 0.4, bloomThreshold: 1.05, anamorphic: 0,
    focus: 48, focusRange: 95, exposure: 1.05, sat: 1.05, streak: 0.5,
    hazeScale: 0.8, hazeMix: 0.55, temp: -0.06,
  }),
  chapter('opensource', '#opensource', 'wormhole', [0, 0.5, 20], [0, 0.5, -45], 64, {
    morphStart: 0.45, morphEnd: 0.95, arc: 1.2, stagger: 0.3, vortex: 0.7,
    bloom: 0.4, bloomWide: 0.5, anamorphic: 0, trail: 0, dirt: 0,
    chroma: 0,
    focus: 46, focusRange: 100,
    fogNear: 26, fogFar: 250, fogTint: 0.56,
    hazeScale: 0.62, hazeMix: 0.62,
    exposure: 1.02, temp: 0.02, sat: 1.0, loud: 0.28, flowFromScroll: 0.9, streak: 0.5,
  }),
  chapter('stack', '#code', 'blackhole', [-3.5, 2.5, 51], [0, 0, 0], 44, {
    morphStart: 0.01, morphEnd: 0.99, arc: 26.0, stagger: 0.32, streak: 1.1,
    warm: 0.6, lens: 0, horizon: 0.72, ring: 0.28,
    pulse: 0.9, pulseRate: 0.55, pulseWidth: 1.5,
    bloom: 0.38, bloomThreshold: 1.08, bloomWide: 0.38, anamorphic: 0,
    trail: 0, dirt: 0, chroma: 0,
    focus: 50, focusRange: 96, exposure: 1.06,
    hazeScale: 0.62, hazeMix: 0.72,
    temp: 0.12, sat: 1.02, loud: 0.48,
  }),
  chapter('hobbies', '#hobbies', 'blackhole', [-5, 1.8, 49], [0, 0, 0], 44, {
    morphStart: 0.06, morphEnd: 0.68, arc: 2.5, stagger: 0.45, streak: 1.15, pinch: 1,
    warm: 0.6, lens: 0, horizon: 0.72, ring: 0.28,
    pulse: 0.9, pulseRate: 0.55, pulseWidth: 1.5,
    bloom: 0.38, bloomThreshold: 1.08, bloomWide: 0.38, anamorphic: 0,
    trail: 0, dirt: 0, chroma: 0,
    focus: 50, focusRange: 96, exposure: 1.06,
    hazeScale: 0.62, hazeMix: 0.72,
    temp: 0.12, sat: 1.02, loud: 0.52,
  }),
  chapter('closing', '#closing', 'whitehole', [0, 2, 54], [0, 0, 0], 43, {
    morphStart: 0.01, morphEnd: 0.99, arc: 26.0, stagger: 0.32, streak: 0.95,
    opacity: 0.92, warm: 0.38, lens: 0,
    horizon: 0.3, ring: 0.24, horizonLight: 1,
    pulse: 0.9, pulseRate: 0.48, pulseWidth: 1.2, clockRate: 1.05,
    accent: 1.0, bloom: 0.44, bloomThreshold: 0.62, bloomTight: 0.98, bloomWide: 0.4,
    anamorphic: 0, trail: 0, dirt: 0,
    chroma: 0, focus: 54, focusRange: 120, exposure: 1.0,
    hazeScale: 0.7, hazeMix: 0.4, temp: 0.0, sat: 1.02, loud: 0.16,
  }),
]);

export const REDUCED_CHAPTERS = Object.freeze([
  chapter('hero', '#hero', 'crystal', [-14, 4, 66], [-14, 4, 0], 40, {
    bloom: 0.32, clockRate: 0.12,
    pulse: 0.4, pulseRate: 0.05, pulseWidth: 1.1,
    chroma: 0, hazeMix: 0.3, temp: -0.04,
  }),
  chapter('contact', '#contact', 'nucleus', [0, 0, 60], [0, 0, 0], 40, {
    bloom: 0.34, clockRate: 0.12,
    pulse: 0.6, pulseRate: 0.07, pulseWidth: 1.3,
    chroma: 0, temp: 0.04,
  }),
  chapter('overview', '#overview', 'nucleus', [0, 2, 52], [0, 0, 0], 42, {
    bloom: 0.36, clockRate: 0.1,
    pulse: 0.4, pulseRate: 0.06, pulseWidth: 1.15,
    chroma: 0, hazeMix: 0.42, temp: 0.04, sat: 1.02,
  }),
  chapter('career', '#career', 'codex', [0, 2, 56], [0, 0, 0], 42, {
    bloom: 0.34, clockRate: 0.08,
    pulse: 0.6, pulseRate: 0.1, pulseWidth: 1.0,
    chroma: 0, hazeMix: 0.5,
  }),
  chapter('education', '#education', 'planetary', [0, 12.5, 78], [0, -4, 0], 42, {
    bloom: 0.3, clockRate: 0.06,
    chroma: 0, temp: -0.1,
  }),
  chapter('projects', '#projects', 'galaxy', [0, 22, 54], [0, 0, 0], 44, {
    morphStart: 0.01, morphEnd: 0.68,
    warm: 0.5, bloom: 0.34, clockRate: 0.05,
    chroma: 0, hazeMix: 0.5,
  }),
  chapter('opensource', '#opensource', 'wormhole', [0, 0, 56], [0, 0, 0], 44, {
    morphStart: 0.45, morphEnd: 0.95, vortex: 0.7,
    bloom: 0.34, clockRate: 0.05,
    chroma: 0, hazeMix: 0.55, temp: 0.08,
  }),
  chapter('stack', '#code', 'blackhole', [0, 2.5, 58], [0, 0, 0], 42, {
    bloom: 0.36, clockRate: 0.06,
    chroma: 0, hazeMix: 0.55, trail: 0,
  }),
  chapter('hobbies', '#hobbies', 'blackhole', [0, 2.5, 58], [0, 0, 0], 42, {
    morphStart: 0.06, morphEnd: 0.68, pinch: 1,
    warm: 0.55, ring: 0.24, horizon: 0.72,
    bloom: 0.3, bloomThreshold: 1.08, clockRate: 0.05, chroma: 0,
    lens: 0,
    hazeMix: 0.7, temp: 0.12,
  }),
  chapter('closing', '#closing', 'whitehole', [0, 0, 54], [0, 0, 0], 42, {
    bloom: 0.28, clockRate: 0.04,
    warm: 0.42, horizon: 0.3, ring: 0.24, horizonLight: 1, lens: 0,
    accent: 1.0, chroma: 0, hazeMix: 0.4,
  }),
]);
