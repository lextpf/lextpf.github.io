
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
  // The morph window, as fractions of the transition band that leaves this
  // chapter (scroll-timeline.js), not of the section: the formation is whole
  // before morphStart and after morphEnd.
  morphStart: 0.10,
  morphEnd: 0.90,
  stagger: 0.65,
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
  // A transition key: how far (world units) particles puff out along their
  // own random directions mid-flight, so a formation comes apart as an even
  // cloud.
  scatter: 0,
  // A transition key: the portrait's erosion (lib/modes.js ERODE). Above 0 a
  // ragged front crosses the departing formation from right to left in place
  // of the seed timing (stagger, arc and scatter are then not read); 1 is the
  // authored motion, lower is calmer.
  erode: 0,

  // Glow means lit. bloomThreshold is the settled formation's lit-HDR p99: the
  // 99th percentile of the half-whitened largest channel over the raw
  // full-resolution scene pixels the formation lights (HDR luminance above
  // 0.05), measured at 3840x2025 on the 100k frame. The bright pass
  // (shaders/post.js) compares that quantity only after a Karis-weighted 3x3
  // tent at half resolution, which damps isolated dots and thin strokes, so it
  // extracts far less than 1% of the lit pixels: 1-440 half-resolution pixels
  // per chapter. Authored at the 100k reference density; post-processing.js
  // scales it for the lower rungs. Re-measure it whenever a formation's lit set
  // changes.
  bloom: 0.3,
  bloomThreshold: 1,
  bloomRadius: 1.0,
  bloomTight: 1,
  bloomMid: 0.4,
  bloomWide: 0.25,
  anamorphic: 0,
  trail: 0,
  dirt: 0,
  haze: 0,
  hazeScale: 0.55,
  hazeMix: 0.35,
  lens: 0,
  // The black hole's particle lens (lib/modes.js HOLE_LENS): 1 is the
  // authored lens, 0 none. Only mode-5 particles are lensed.
  lensing: 0,
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
  // How much the scroll turns the galaxy (particle-system.js): the same
  // velocity bias the tunnel's flow takes, added to its clock.
  spinFromScroll: 0,
  // Transition keys, read from the departing chapter (scroll-timeline.js):
  // warp speeds a flowing formation up over the band that leaves it (the
  // tunnel into the black hole: travelling through it faster and faster
  // until it comes apart), camDelay holds the camera for that fraction of
  // the band before it starts to move.
  warp: 0,
  camDelay: 0,
  narrowPull: 1,
  // Framing. frameX is a horizontal lens shift in half-widths of the screen
  // (camera-rig.js); holdPush is the fraction of the way to the subject the
  // camera eases while a chapter is held, holdYaw the degrees it turns about
  // world Y over the same hold. All three are camera-head keys.
  frameX: 0,
  holdPush: 0.02,
  holdYaw: 0,
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
  'lens', 'lensing', 'horizon', 'ring', 'horizonLight', 'warm', 'chroma', 'hazeMix',
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

/* The hero's subject where the CV carries a photo (PORTRAIT_VARIANTS): the
   portrait as a constellation (formations/avatar.js) in place of the photo
   medallion, and contact's program under the portrait's sky
   (programPortrait), so the face comes apart into the program with the stars
   standing still. Every other variant keeps `int main() {}`.

   cv-universe.js stages it (applyPortrait): it swaps the two scenes, applies
   `knobs` to the hero, and fits the hero camera to `anchor` at every layout,
   so the photo's circle (the anchor's box less `inset` rem of padding) is
   where the portrait's circle lands at scroll 0, at any window size. `desk`
   and `phone` are that fit at 1440 x 900 and at 390 x 844: the frames the
   portrait's sky is laid for (code.js portraitSky), and the camera wherever
   the fit cannot run. */
export const PORTRAIT_VARIANTS = Object.freeze(['dach']);
const PORTRAIT = Object.freeze({
  scene: 'avatar',
  contactScene: 'programPortrait',
  anchor: '#hero .portrait-wrap',
  inset: 0.5,
  // The portrait's circle against the photo's: a little larger than the
  // medallion, into the gutter beside it (the bust fades out before its rim).
  scale: 1.2,
  // desk is seen through a lens shift; for the sky it is the same camera
  // turned toward the frame's centre.
  desk: Object.freeze({ cam: [-12, 3.9, 59.3], tgt: [10.6, 3.9, 0], fov: 38 }),
  phone: Object.freeze({ cam: [-12, -6.7, 111.7], tgt: [-12, -6.7, 0], fov: 38 }),
});

/* The ten beats, in scroll order. The narrative arc is deliberate: code is written
   (mainfn, program), structured (callgraph, codex), then matter organises
   (planetary, galaxy), then collapses and
   is reborn (wormhole, black hole, white hole).

   One pair shares a formation: stack and hobbies are both 'blackhole';
   consecutive chapters on the same scene have nothing to morph, so those
   transitions are pure camera moves.

   `exposure` holds each chapter's mean displayed luminance at 3840x2025 within
   10% of the look approved before the crisp point model and the lit-only bloom
   (2026-09-27), which took the bloom veil away. Two exceptions wait on the
   owner: the hero, whose light was mostly veil (the band would need about 4x,
   which would burn the lit ridges flat), and the galaxy and tunnel, which keep
   the darker level already under review. The hero's exposure instead holds the
   re-carved crystal's frame (thinner lit ridges, glints only on lit corners)
   within 10% of the mean displayed luminance of the crystal it replaced:
   measured at 3840x2025 and at 2560x1300 at 1.5, on a 390x844 phone and a
   768x1024 tablet, and on the reduced path at 3840x2025, on the phone and on
   the tablet. Its `bloom` (0.25) keeps the glints' glow under a fifth of the
   light in the crystal's brightest window at both desktop sizes. The same
   holds for the re-carved galaxy and tunnel against the formations they
   replaced, at that darker level: the galaxy at its old exposure, the tunnel
   at a higher one (1.5, reduced 1.35), since its light moved from large
   scattered streak dots into thin lines. The re-carved black hole's frame
   is held within 10% of the one it replaced (Stack 1.86, Hobbies 1.93, both
   reduced 1.35): a fifth of its light was a sphere of loose infall dots
   spread across the whole frame, and the streams that replace it light far
   less of it. The re-carved gas giant is the open exception (for the owner):
   its opaque engraving shows about half the dots the old see-through sphere
   did, each a crisp point, and its limb no longer carries a bright rim, so
   its frame reads about a third of the old one (0.34-0.38) at every size
   measured. Its extra light is its own (GIANT_GLOW in
   shaders/particles.js), not a higher education exposure, which would also
   grade the codex and the galaxy it morphs with; at the sharpness ceiling
   no exposure or dot size gets within 10%. Education's pulse is 0.25
   (reduced 0.11): the pulse is weighted by rigidity, and the giant's deck is
   rigid now, so this keeps its old swing. */
export const CHAPTERS = Object.freeze([
  // The hero holds `int main() {}`; the band into Contact is where it grows
  // into the program. `band` stretches that band over most of a screen (it
  // ends once Contact's top has passed 0.1 H), and a stagger of 0.8 narrows
  // every particle's flight to a fifth of the morph, so the tokens the plan
  // orders by departure (formations/code-kit.js) are built one after another.
  chapter('hero', '#hero', 'mainfn', [-24.5, 6.8, 62], [-24.5, 6.8, 0], 38, {
    band: { arrive: -0.1, maxLen: 1.0, idealLen: 0.8 },
    morphStart: 0.04, morphEnd: 0.96, stagger: 0.8, arc: 2.4,
    size: 0.98, opacity: 0.94, noise: 0.16, noiseScale: 0.03, noiseSpeed: 0.022,
    bloom: 0.25, bloomThreshold: 2.4, focus: 62, dof: 0, bokeh: 0, vignette: 0.56,
    pulse: 0.55, pulseRate: 0.1, pulseWidth: 1.1, streak: 0.3,
    narrowPull: 1.35, holdPush: 0.012,
    haze: 0, hazeMix: 0.3, temp: -0.05, sat: 0.95, exposure: 1.9,
    portrait: {
      ...PORTRAIT,
      /* The face is eroded from right to left (erode, lib/modes.js ERODE):
         the band starts on the first pixel of scroll (hold 0) and is read
         over about a screen, like the hero's own. A ragged front crosses the
         face in the first half of the morph; where it passes, the points
         loosen and are pulled away to the right, and the stream carries them
         on to the program, which condenses left to right as they land. Ahead
         of the front the face holds still, so it reads as the portrait until
         the front gets there. The camera waits for the first 40% of the band
         (camDelay), so the face is eroded where it was and the camera then
         follows the stream. No hold push: the fit is exact at scroll 0. */
      knobs: {
        band: { hold: 0, arrive: -0.1, maxLen: 1.1, idealLen: 1.0 },
        morphStart: 0, morphEnd: 0.85, erode: 1, camDelay: 0.4, holdPush: 0,
        pulse: 0.08, pulseRate: 0.06, pulseWidth: 1.0, bloomThreshold: 5, exposure: 1.9,
      },
    },
  }),
  chapter('contact', '#contact', 'program', [4, -2, 46], [0, 0, 0], 40, {
    opacity: 0.88, noise: 0.3, noiseScale: 0.05, noiseSpeed: 0.048,
    bloom: 0.36, bloomThreshold: 2.2, focus: 58, arc: 4.0, streak: 0.6, vignette: 0.56,
    pulse: 0.85, pulseRate: 0.16, pulseWidth: 1.3,
    narrowPull: 1.4,
    haze: 0, hazeMix: 0.4, temp: 0.06, sat: 1.02,
  }),
  // Overview frames the codex and Career the call stack tower (swapped
  // 2026-09-28): each chapter carries its formation's camera and knobs.
  chapter('overview', '#overview', 'codex', [-11, 2.5, 60], [-1, 0, -1], 41, {
    opacity: 0.7, noise: 0.18, noiseScale: 0.05, noiseSpeed: 0.038,
    bloom: 0.34, bloomThreshold: 0.86, focus: 61, dof: 0, bokeh: 0, arc: 3.6,
    narrowPull: 2.0, holdPush: 0.012,
    pulse: 0.9, pulseRate: 0.22, pulseWidth: 1.0, streak: 0.15,
    haze: 0, hazeMix: 0.5, temp: -0.04, sat: 0.94,
  }),
  chapter('career', '#career', 'callgraph', [0, 0, 35], [0, 0, 0], 42, {
    opacity: 0.8, noise: 0.22, noiseScale: 0.055, noiseSpeed: 0.052,
    bloom: 0.34, bloomThreshold: 2.2, focus: 36, focusRange: 84, dof: 0, bokeh: 0, vignette: 0.56,
    pulse: 0.7, pulseRate: 0.16, pulseWidth: 1.15, streak: 0.8,
    narrowPull: 1.4, holdPush: 0.05, holdYaw: 0.6,
    accent: 0.95, haze: 0, hazeScale: 0.5, hazeMix: 0.42, fogTint: 0.55,
    temp: 0.04, sat: 1.02, exposure: 1.15,
  }),
  chapter('education', '#education', 'planetary', [3, 4.5, 72], [0, 0, 0], 41, {
    arc: 1.6, stagger: 0.65,
    size: 1.05, opacity: 0.7, noise: 0.9, noiseScale: 0.05, noiseSpeed: 0.034,
    warm: 0.15, clockRate: 0.38, streak: 0.8,
    pulse: 0.25, pulseRate: 0.12, pulseWidth: 1.0,
    bloom: 0.30, bloomThreshold: 1.38, bloomTight: 1.0,
    focus: 72, focusRange: 70, dof: 0, bokeh: 0, vignette: 0.58,
    fogNear: 46, fogFar: 300, fogTint: 0.42,
    narrowPull: 1.25,
    haze: 0, hazeScale: 0.7, hazeMix: 0.85,
    exposure: 2.1, temp: 0.04, sat: 1.08, contrast: 1.04,
  }),
  chapter('projects', '#projects', 'galaxy', [0, 28, 44], [0, 0, -2], 44, {
    morphStart: 0.08, morphEnd: 0.70, arc: 1.0, stagger: 0.65,
    opacity: 0.8, noise: 0.34, warm: 0.12, bloom: 0.32, bloomThreshold: 2.3, anamorphic: 0,
    // sat 1.25: the nebulae's cyan and pink and the companion's gold read as
    // colour, not as tinted white.
    focus: 48, focusRange: 95, dof: 0, exposure: 1.12, sat: 1.25, streak: 0.5,
    haze: 0, hazeScale: 0.8, hazeMix: 0.55, temp: -0.06, spinFromScroll: 3.5,
  }),
  chapter('opensource', '#opensource', 'wormhole', [0, 0.5, 20], [0, 0.5, -45], 64, {
    morphStart: 0.46, morphEnd: 0.97, arc: 0.35, stagger: 0.6, vortex: 0, warp: 1, camDelay: 0.55,
    size: 1.08, noise: 0.28, noiseScale: 0.05, noiseSpeed: 0.055,
    bloom: 0.4, bloomThreshold: 2.3, anamorphic: 0, trail: 0, dirt: 0,
    chroma: 0, vignette: 0.6,
    focus: 46, focusRange: 100, dof: 0, bokeh: 0,
    // The far end fades into the fog, so the strands and hoops dissolve into
    // the throat instead of ending in a ring there.
    fogNear: 34, fogFar: 175, fogTint: 0.56,
    haze: 0, hazeScale: 0.62, hazeMix: 0.62,
    exposure: 1.5, temp: 0.02, sat: 1.0, loud: 0.28, flowFromScroll: 0.9, streak: 0.5,
  }),
  chapter('stack', '#code', 'blackhole', [-3.5, 2.5, 51], [0, 0, 0], 44, {
    arc: 3.0, stagger: 0.65, streak: 1.1,
    noise: 0.14, warm: 0.6, lens: 0, lensing: 1, horizon: 0.72, ring: 0.28,
    narrowPull: 1.45,
    pulse: 0.9, pulseRate: 0.55, pulseWidth: 1.5,
    bloom: 0.38, bloomThreshold: 0.94, anamorphic: 0,
    trail: 0, dirt: 0, chroma: 0,
    focus: 50, focusRange: 96, dof: 0, bokeh: 0, exposure: 1.86,
    haze: 0, hazeScale: 0.62, hazeMix: 0.72,
    temp: 0.12, sat: 1.02, loud: 0.48,
  }),
  chapter('hobbies', '#hobbies', 'blackhole', [-5, 1.8, 49], [0, 0, 0], 44, {
    morphStart: 0.06, morphEnd: 0.80, arc: 2.5, stagger: 0.45, streak: 1.15, pinch: 0,
    noise: 0.14, warm: 0.6, lens: 0, lensing: 1, horizon: 0.72, ring: 0.28,
    narrowPull: 1.45,
    pulse: 0.9, pulseRate: 0.55, pulseWidth: 1.5,
    bloom: 0.38, bloomThreshold: 0.98, anamorphic: 0,
    trail: 0, dirt: 0, chroma: 0,
    focus: 50, focusRange: 96, dof: 0, bokeh: 0, exposure: 1.93,
    haze: 0, hazeScale: 0.62, hazeMix: 0.72,
    temp: 0.12, sat: 1.02, loud: 0.52,
  }),
  chapter('closing', '#closing', 'whitehole', [0, 2, 54], [0, 0, 0], 43, {
    arc: 3.0, stagger: 0.65, streak: 0.95,
    // The white hole is white: no warm cast (warm stays on the black hole's ring
    // and core only).
    size: 1.1, opacity: 0.92, noise: 0.1, warm: 0, lens: 0,
    horizon: 0.72, ring: 0.32, horizonLight: 1,
    pulse: 0.9, pulseRate: 0.48, pulseWidth: 1.2, clockRate: 0.6,
    accent: 1.0, bloom: 0.44, bloomThreshold: 1.33, bloomTight: 0.98,
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
// Transition keys are read from the departing chapter, so every reduced chapter
// carries a low flight arc (at most 1.2) and a faint morph streak (at most 0.2),
// never more than its full-path counterpart. The camera holds still while a
// chapter is read: no hold push, no hold yaw.
// Bloom thresholds are measured on the reduced path itself (its 50k rung, its
// cameras) and divided by that rung's threshold gain (1.30), because every
// threshold is authored at the 100k reference density.
const calm = (c) => {
  const full = CHAPTERS.find((f) => f.id === c.id) || c;
  return {
    ...c,
    arc: Math.min(full.arc, 1.2),
    streak: Math.min(full.streak, 0.2),
    holdPush: 0,
    holdYaw: 0,
  };
};

export const REDUCED_CHAPTERS = Object.freeze([
  chapter('hero', '#hero', 'mainfn', [-20, 4, 66], [-20, 4, 0], 40, {
    band: { arrive: -0.1, maxLen: 1.0, idealLen: 0.8 },
    morphStart: 0.04, morphEnd: 0.96, stagger: 0.7,
    noise: 0.12, noiseSpeed: 0.014, bloom: 0.32, bloomThreshold: 3.6, dof: 0, clockRate: 0.12, exposure: 1.9,
    pulse: 0.4, pulseRate: 0.05, pulseWidth: 1.1, narrowPull: 1.35,
    chroma: 0, haze: 0, hazeMix: 0.3, temp: -0.04,
    portrait: {
      ...PORTRAIT,
      knobs: {
        band: { hold: 0, arrive: -0.1, maxLen: 1.1, idealLen: 1.0 },
        morphStart: 0, morphEnd: 0.85, erode: 0.5, camDelay: 0.4,
        pulse: 0.05, pulseWidth: 1.0, bloomThreshold: 6,
      },
    },
  }),
  chapter('contact', '#contact', 'program', [0, 0, 60], [0, 0, 0], 40, {
    noise: 0.12, noiseSpeed: 0.014, bloom: 0.34, bloomThreshold: 3.3, dof: 0, clockRate: 0.12,
    pulse: 0.6, pulseRate: 0.07, pulseWidth: 1.3, narrowPull: 1.4,
    chroma: 0, haze: 0, temp: 0.04,
  }),
  chapter('overview', '#overview', 'codex', [0, 2, 56], [0, 0, 0], 42, {
    opacity: 0.88, noise: 0.12, noiseSpeed: 0.014, bloom: 0.34, bloomThreshold: 0.79, dof: 0, clockRate: 0.08,
    pulse: 0.6, pulseRate: 0.1, pulseWidth: 1.0, narrowPull: 2.1,
    chroma: 0, haze: 0, hazeMix: 0.5,
  }),
  chapter('career', '#career', 'callgraph', [0, 2, 35], [0, 0, 0], 42, {
    noise: 0.16, noiseSpeed: 0.020, bloom: 0.36, bloomThreshold: 4.85, dof: 0, clockRate: 0.1,
    pulse: 0.4, pulseRate: 0.06, pulseWidth: 1.15, narrowPull: 1.4,
    chroma: 0, haze: 0, hazeMix: 0.42, temp: 0.04, sat: 1.02,
  }),
  chapter('education', '#education', 'planetary', [3, 4.5, 74], [0, 0, 0], 41, {
    size: 1.05, opacity: 0.5, noise: 0.3, noiseSpeed: 0.012, bloom: 0.4, bloomThreshold: 1.02, exposure: 1.2,
    dof: 0, bokeh: 0,
    focus: 74, focusRange: 74, clockRate: 0.05,
    warm: 0.12, pulse: 0.11, pulseRate: 0.05, vignette: 0.55,
    fogNear: 46, fogFar: 300, fogTint: 0.42,
    narrowPull: 1.25,
    chroma: 0, haze: 0, hazeMix: 0.85, temp: 0.04, sat: 1.06,
  }),
  chapter('projects', '#projects', 'galaxy', [0, 22, 54], [0, 0, 0], 44, {
    morphStart: 0.08, morphEnd: 0.70,
    noise: 0.14, noiseSpeed: 0.014, warm: 0.5, bloom: 0.34, bloomThreshold: 2.1, dof: 0, clockRate: 0.05, exposure: 1.27,
    chroma: 0, haze: 0, hazeMix: 0.5,
  }),
  chapter('opensource', '#opensource', 'wormhole', [0, 0, 56], [0, 0, 0], 44, {
    morphStart: 0.34, morphEnd: 0.95, vortex: 0,
    noise: 0.14, noiseSpeed: 0.014, bloom: 0.34, bloomThreshold: 1.6, dof: 0, clockRate: 0.05, exposure: 1.35,
    chroma: 0, haze: 0, hazeMix: 0.55, temp: 0.08,
  }),
  chapter('stack', '#code', 'blackhole', [0, 2.5, 58], [0, 0, 0], 42, {
    // The aperture belongs to the formation: without it Stack, and the
    // same-scene band into Hobbies that cross-fades from it, show no horizon.
    horizon: 0.72, ring: 0.24, warm: 0.55, lensing: 1,
    noise: 0.14, noiseSpeed: 0.014, bloom: 0.36, bloomThreshold: 0.66, dof: 0, clockRate: 0.06, exposure: 1.35,
    chroma: 0, haze: 0, hazeMix: 0.55, trail: 0,
  }),
  chapter('hobbies', '#hobbies', 'blackhole', [0, 2.5, 58], [0, 0, 0], 42, {
    morphStart: 0.06, morphEnd: 0.80, pinch: 0,
    noise: 0.12, noiseSpeed: 0.014, warm: 0.55, ring: 0.24, horizon: 0.72, lensing: 1,
    bloom: 0.3, bloomThreshold: 0.72, dof: 0, bokeh: 0, clockRate: 0.05, chroma: 0, exposure: 1.35,
    lens: 0,
    narrowPull: 1.45,
    haze: 0, hazeMix: 0.7, temp: 0.12,
  }),
  chapter('closing', '#closing', 'whitehole', [0, 0, 54], [0, 0, 0], 42, {
    noise: 0.08, noiseSpeed: 0.010, bloom: 0.28, bloomThreshold: 1.1, dof: 0, clockRate: 0.04,
    warm: 0, horizon: 0.72, ring: 0.32, horizonLight: 1, lens: 0,
    size: 1.05, accent: 1.0, chroma: 0, haze: 0, hazeMix: 0.4,
    narrowPull: 1.7,
  }),
].map(calm));
