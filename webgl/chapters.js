
// The only three colours in the universe. Everything else is these mixed by
// `accent`, `warm` and `hazeMix`, which is what keeps ten wildly different
// scenes looking like one page.
export const PALETTE = Object.freeze({
  base: 0xeef1f6,
  accent: 0x6ba5ff,
  warm: 0xffc98a,
});

// Every knob, with its neutral value. This doubles as the schema: STATE_KEYS is
// derived from it, so adding a key here is enough to make it blendable.
export const DEFAULTS = Object.freeze({
  morphStart: 0.01,
  morphEnd: 0.99,
  stagger: 0.30,
  arc: 3.0,
  envelope: 0,

  size: 1,
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
  haze: 0,
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
  vignette: 0,
  loud: 0,
  clockRate: 0.6,
  flowFromScroll: 0,
  narrowPull: 1,
});

/* Everything the timeline blends per frame.

   morphStart, morphEnd and envelope are excluded because they are not values to
   interpolate, they describe HOW to interpolate: they shape the transition
   itself, and blending them would be blending the rules. The camera keys are
   appended instead of living in DEFAULTS because every chapter must state them
   explicitly, so there is no sensible neutral to default them to. */
export const STATE_KEYS = Object.freeze([
  ...Object.keys(DEFAULTS).filter(
    (k) => k !== 'morphStart' && k !== 'morphEnd' && k !== 'envelope'
  ),
  'camX', 'camY', 'camZ', 'tgtX', 'tgtY', 'tgtZ', 'fov',
]);

// Effects that belong to the formation rather than to the chapter. When the
// scene changes these get re-blended on the morph curve instead of the chapter
// curve, so a black hole's lensing arrives with its geometry and not before it.
export const SCENE_LINKED = Object.freeze([
  'lens', 'horizon', 'ring', 'horizonLight', 'warm', 'chroma', 'hazeMix',
]);

// Effects that swell through the middle of a transition and settle at both ends,
// on chapters that opt in with `envelope`. Flourishes that should happen during
// the move rather than be left switched on after it.
export const ENVELOPED = Object.freeze(['chroma', 'anamorphic', 'trail', 'dirt']);

// Build one complete chapter. Order matters: DEFAULTS first, overrides last.
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

/* The ten beats, in scroll order. The narrative arc is deliberate: matter forms
   (crystal, nucleus), organises (codex, planetary, galaxy), then collapses and
   is reborn (wormhole, black hole, white hole).

   Two pairs share a formation. stack and hobbies are both 'blackhole', and
   contact and overview are both 'nucleus'; consecutive chapters on the same
   scene have nothing to morph, so those transitions are pure camera moves. */
export const CHAPTERS = Object.freeze([
  chapter('hero', '#hero', 'crystal', [-24.5, 6.8, 62], [-24.5, 6.8, 0], 38, {
    morphStart: 0.02, morphEnd: 0.99,
    size: 0.98, opacity: 0.94, noise: 0.16, noiseScale: 0.03, noiseSpeed: 0.022,
    bloom: 0.3, bloomThreshold: 0.98, focus: 62, dof: 0, bokeh: 0, vignette: 0.56,
    pulse: 0.55, pulseRate: 0.1, pulseWidth: 1.1, streak: 0.3,
    narrowPull: 1.35,
    haze: 0, hazeMix: 0.3, temp: -0.05, sat: 0.95,
  }),
  chapter('contact', '#contact', 'nucleus', [4, -2, 58], [0, 0, 0], 40, {
    morphStart: 0.01, morphEnd: 0.99,
    opacity: 0.88, noise: 0.3, noiseScale: 0.05, noiseSpeed: 0.048,
    bloom: 0.36, focus: 58, arc: 4.0, streak: 0.6, vignette: 0.56,
    pulse: 0.85, pulseRate: 0.16, pulseWidth: 1.3,
    narrowPull: 1.4,
    haze: 0, hazeMix: 0.4, temp: 0.06, sat: 1.02,
  }),
  chapter('overview', '#overview', 'nucleus', [0, 0, 35], [0, 0, 0], 42, {
    morphStart: 0.01, morphEnd: 0.99,
    opacity: 0.8, noise: 0.22, noiseScale: 0.055, noiseSpeed: 0.052,
    bloom: 0.34, bloomWide: 0.42, focus: 36, focusRange: 84, dof: 0, bokeh: 0, vignette: 0.56,
    pulse: 0.6, pulseRate: 0.16, pulseWidth: 1.15, streak: 0.6,
    narrowPull: 1.4,
    accent: 0.95, haze: 0, hazeScale: 0.5, hazeMix: 0.42, fogTint: 0.55,
    temp: 0.04, sat: 1.02,
  }),
  chapter('career', '#career', 'codex', [-11, 2.5, 60], [-1, 0, -1], 41, {
    morphStart: 0.01, morphEnd: 0.99,
    opacity: 0.8, noise: 0.18, noiseScale: 0.05, noiseSpeed: 0.038,
    bloom: 0.34, bloomThreshold: 0.98, focus: 61, dof: 0, bokeh: 0, arc: 3.6,
    narrowPull: 2.0,
    pulse: 0.9, pulseRate: 0.22, pulseWidth: 1.0, streak: 0.15,
    haze: 0, hazeMix: 0.5, temp: -0.04, sat: 0.94,
  }),
  chapter('education', '#education', 'planetary', [3, 4.5, 72], [0, 0, 0], 41, {
    morphStart: 0.01, morphEnd: 0.99, arc: 1.6, stagger: 0.26,
    size: 1.05, opacity: 0.7, noise: 0.9, noiseScale: 0.05, noiseSpeed: 0.034,
    warm: 0.5, clockRate: 0.38, streak: 0.8,
    pulse: 0.42, pulseRate: 0.12, pulseWidth: 1.0,
    bloom: 0.46, bloomThreshold: 0.42, bloomTight: 1.0, bloomWide: 0.5,
    focus: 72, focusRange: 70, dof: 0.5, bokeh: 0.55, vignette: 0.58,
    fogNear: 46, fogFar: 300, fogTint: 0.42,
    narrowPull: 1.25,
    haze: 0, hazeScale: 0.7, hazeMix: 0.85,
    exposure: 1.05, temp: 0.14, sat: 1.45, contrast: 1.12,
  }),
  chapter('projects', '#projects', 'galaxy', [0, 28, 44], [0, 0, -2], 44, {
    morphStart: 0.01, morphEnd: 0.85, arc: 1.0, stagger: 0.3,
    opacity: 0.8, noise: 0.34, warm: 0.5, bloom: 0.32, bloomWide: 0.4, bloomThreshold: 1.05, anamorphic: 0,
    focus: 48, focusRange: 95, dof: 0, exposure: 1.05, sat: 1.05, streak: 0.5,
    haze: 0, hazeScale: 0.8, hazeMix: 0.55, temp: -0.06,
  }),
  chapter('opensource', '#opensource', 'wormhole', [0, 0.5, 20], [0, 0.5, -45], 64, {
    morphStart: 0.45, morphEnd: 0.95, arc: 1.2, stagger: 0.3, vortex: 0.7,
    size: 1.08, noise: 0.28, noiseScale: 0.05, noiseSpeed: 0.055,
    bloom: 0.4, bloomWide: 0.5, anamorphic: 0, trail: 0, dirt: 0,
    chroma: 0, vignette: 0.6,
    focus: 46, focusRange: 100, dof: 0, bokeh: 0,
    fogNear: 26, fogFar: 250, fogTint: 0.56,
    haze: 0, hazeScale: 0.62, hazeMix: 0.62,
    exposure: 1.02, temp: 0.02, sat: 1.0, loud: 0.28, flowFromScroll: 0.9, streak: 0.5,
  }),
  chapter('stack', '#code', 'blackhole', [-3.5, 2.5, 51], [0, 0, 0], 44, {
    morphStart: 0.01, morphEnd: 0.99, arc: 26.0, stagger: 0.32, streak: 1.1,
    noise: 0.14, warm: 0.6, lens: 0, horizon: 0.72, ring: 0.28,
    narrowPull: 1.45,
    pulse: 0.9, pulseRate: 0.55, pulseWidth: 1.5,
    bloom: 0.38, bloomThreshold: 1.08, bloomWide: 0.38, anamorphic: 0,
    trail: 0, dirt: 0, chroma: 0,
    focus: 50, focusRange: 96, dof: 0, bokeh: 0, exposure: 1.06,
    haze: 0, hazeScale: 0.62, hazeMix: 0.72,
    temp: 0.12, sat: 1.02, loud: 0.48,
  }),
  chapter('hobbies', '#hobbies', 'blackhole', [-5, 1.8, 49], [0, 0, 0], 44, {
    morphStart: 0.06, morphEnd: 0.68, arc: 2.5, stagger: 0.45, streak: 1.15, pinch: 1,
    noise: 0.14, warm: 0.6, lens: 0, horizon: 0.72, ring: 0.28,
    narrowPull: 1.45,
    pulse: 0.9, pulseRate: 0.55, pulseWidth: 1.5,
    bloom: 0.38, bloomThreshold: 1.08, bloomWide: 0.38, anamorphic: 0,
    trail: 0, dirt: 0, chroma: 0,
    focus: 50, focusRange: 96, dof: 0, bokeh: 0, exposure: 1.06,
    haze: 0, hazeScale: 0.62, hazeMix: 0.72,
    temp: 0.12, sat: 1.02, loud: 0.52,
  }),
  chapter('closing', '#closing', 'whitehole', [0, 2, 54], [0, 0, 0], 43, {
    morphStart: 0.01, morphEnd: 0.99, arc: 26.0, stagger: 0.32, streak: 0.95,
    size: 1.1, opacity: 0.92, noise: 0.1, warm: 0.38, lens: 0,
    horizon: 0.3, ring: 0.24, horizonLight: 1,
    pulse: 0.9, pulseRate: 0.48, pulseWidth: 1.2, clockRate: 0.6,
    accent: 1.0, bloom: 0.44, bloomThreshold: 0.62, bloomTight: 0.98, bloomWide: 0.4,
    anamorphic: 0, trail: 0, dirt: 0,
    chroma: 0, focus: 54, focusRange: 120, dof: 0, bokeh: 0, exposure: 1.0,
    narrowPull: 1.7,
    haze: 0, hazeScale: 0.7, hazeMix: 0.4, temp: 0.0, sat: 1.02, loud: 0.16,
  }),
]);

/* The prefers-reduced-motion score. Same ids, same scenes, same order, so every
   consumer works unchanged; only the numbers are calmer.

   It is a parallel set rather than a filter over CHAPTERS because the changes
   are editorial, not mechanical. Cameras are re-framed nearly head-on (the
   authored off-axis angles read as drift when nothing else is moving) and the
   clock rates drop by five to fifteen times, from the 0.6 default down to
   0.04-0.12. No amount of scaling one set of numbers produces the other. */
export const REDUCED_CHAPTERS = Object.freeze([
  chapter('hero', '#hero', 'crystal', [-14, 4, 66], [-14, 4, 0], 40, {
    noise: 0.12, noiseSpeed: 0.014, bloom: 0.32, dof: 0, clockRate: 0.12,
    pulse: 0.4, pulseRate: 0.05, pulseWidth: 1.1, narrowPull: 1.35,
    chroma: 0, haze: 0, hazeMix: 0.3, temp: -0.04,
  }),
  chapter('contact', '#contact', 'nucleus', [0, 0, 60], [0, 0, 0], 40, {
    noise: 0.12, noiseSpeed: 0.014, bloom: 0.34, dof: 0, clockRate: 0.12,
    pulse: 0.6, pulseRate: 0.07, pulseWidth: 1.3, narrowPull: 1.4,
    chroma: 0, haze: 0, temp: 0.04,
  }),
  chapter('overview', '#overview', 'nucleus', [0, 2, 35], [0, 0, 0], 42, {
    noise: 0.16, noiseSpeed: 0.020, bloom: 0.36, dof: 0, clockRate: 0.1,
    pulse: 0.4, pulseRate: 0.06, pulseWidth: 1.15, narrowPull: 1.4,
    chroma: 0, haze: 0, hazeMix: 0.42, temp: 0.04, sat: 1.02,
  }),
  chapter('career', '#career', 'codex', [0, 2, 56], [0, 0, 0], 42, {
    noise: 0.12, noiseSpeed: 0.014, bloom: 0.34, dof: 0, clockRate: 0.08,
    pulse: 0.6, pulseRate: 0.1, pulseWidth: 1.0, narrowPull: 2.1,
    chroma: 0, haze: 0, hazeMix: 0.5,
  }),
  chapter('education', '#education', 'planetary', [3, 4.5, 74], [0, 0, 0], 41, {
    size: 1.05, opacity: 0.7, noise: 0.3, noiseSpeed: 0.012, bloom: 0.4,
    dof: 0.3, bokeh: 0.4,
    focus: 74, focusRange: 74, clockRate: 0.05,
    warm: 0.3, pulse: 0.2, pulseRate: 0.05, vignette: 0.55,
    fogNear: 46, fogFar: 300, fogTint: 0.42,
    narrowPull: 1.25,
    chroma: 0, haze: 0, hazeMix: 0.85, temp: 0.14, sat: 1.4,
  }),
  chapter('projects', '#projects', 'galaxy', [0, 22, 54], [0, 0, 0], 44, {
    morphStart: 0.01, morphEnd: 0.68,
    noise: 0.14, noiseSpeed: 0.014, warm: 0.5, bloom: 0.34, dof: 0, clockRate: 0.05,
    chroma: 0, haze: 0, hazeMix: 0.5,
  }),
  chapter('opensource', '#opensource', 'wormhole', [0, 0, 56], [0, 0, 0], 44, {
    morphStart: 0.45, morphEnd: 0.95, vortex: 0.7,
    noise: 0.14, noiseSpeed: 0.014, bloom: 0.34, dof: 0, clockRate: 0.05,
    chroma: 0, haze: 0, hazeMix: 0.55, temp: 0.08,
  }),
  chapter('stack', '#code', 'blackhole', [0, 2.5, 58], [0, 0, 0], 42, {
    noise: 0.14, noiseSpeed: 0.014, bloom: 0.36, dof: 0, clockRate: 0.06,
    chroma: 0, haze: 0, hazeMix: 0.55, trail: 0,
  }),
  chapter('hobbies', '#hobbies', 'blackhole', [0, 2.5, 58], [0, 0, 0], 42, {
    morphStart: 0.06, morphEnd: 0.68, pinch: 1,
    noise: 0.12, noiseSpeed: 0.014, warm: 0.55, ring: 0.24, horizon: 0.72,
    bloom: 0.3, bloomThreshold: 1.08, dof: 0, bokeh: 0, clockRate: 0.05, chroma: 0,
    lens: 0,
    narrowPull: 1.45,
    haze: 0, hazeMix: 0.7, temp: 0.12,
  }),
  chapter('closing', '#closing', 'whitehole', [0, 0, 54], [0, 0, 0], 42, {
    noise: 0.08, noiseSpeed: 0.010, bloom: 0.28, dof: 0, clockRate: 0.04,
    warm: 0.42, horizon: 0.3, ring: 0.24, horizonLight: 1, lens: 0,
    size: 1.05, accent: 1.0, chroma: 0, haze: 0, hazeMix: 0.4,
    narrowPull: 1.7,
  }),
]);
