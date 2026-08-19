
// How the vertex shader animates a formation once it is in place.
export const MODE = Object.freeze({
  STILL: 0,
  SPIN_Y: 1,
  FLOW_Z: 2,
  SPIN_Z: 3,
  ROCK_Y: 4,
  ACCRETION: 5,
  SPIN_X: 6,
  OUTFLOW: 7,
  ORBIT: 8,
});

// How a formation reacts to the pointer. Each formation picks one in its
// generator metadata; the shader reads it out of uTouchA / uTouchB.
export const TOUCH = Object.freeze({
  REPEL: 0,
  SWIRL: 1,
  ATTRACT: 2,
  DENT: 3,
  GUST: 4,
  RIPPLE: 5,
  IONIZE: 6,
  SURGE: 7,
  BURST: 8,
  PULSE: 9,
  STATIC: 10,
  SCRAMBLE: 12,
});

/* ── The gas giant ────────────────────────────────────────────────────────

   MODE.ORBIT belongs entirely to formations/planetary.js: one massive luminous
   proto-star, rendered from nothing but points. Everything the body does after
   it is baked is driven by the tables below, and both sides read them.
   planetary.js uses them at bake time to place cloud, storm and flare
   particles; shaders/particles.js splices them into GLSL so the same numbers
   move those particles every frame. Change one here and both follow. */
export const GIANT = Object.freeze({
  radius: 15.0,
  // Axial tilt, applied as the formation's tilt matrix. Only the rotating
  // populations get it; the view-locked limb, corona and star field are baked
  // in world space and skip it (their spin is 0, which the shader passes
  // through untouched).
  tilt: { x: -0.26, z: 0.19 },
  // Eruption cycles per unit of formation clock, shared by every flare site.
  flareRate: 0.035,
});

/* The zonal wind profile: angular rate about the spin axis as a function of
   sin(latitude), sampled at 17 evenly spaced knots from the south pole (-1) to
   the north pole (+1). The alternation is the point — neighbouring knots are
   fast and slow jets, so the cloud deck shears against itself and a storm at
   one latitude slowly laps a storm at the next. The equator super-rotates.

   Cloud particles get their own knot-interpolated rate baked into `spin`, so
   the differential rotation costs the shader nothing. Flares read the same
   curve through the generated GLSL below, which is why an eruption drifts with
   the band it came out of instead of with the body as a whole. */
export const GIANT_JETS = Object.freeze([
  0.086, 0.104, 0.152, 0.121, 0.186, 0.148, 0.223, 0.181, 0.298,
  0.192, 0.236, 0.158, 0.201, 0.134, 0.163, 0.112, 0.092,
]);

export function zonalRate(sinLat) {
  const n = GIANT_JETS.length - 1;
  const t = Math.min(n, Math.max(0, (sinLat + 1) * 0.5 * n));
  const i = Math.min(n - 1, Math.floor(t));
  const f = t - i;
  return GIANT_JETS[i] + (GIANT_JETS[i + 1] - GIANT_JETS[i]) * f;
}

/* Long-lived vortices. `lat`/`lon` place the storm on the body in radians, `r`
   is its radius in body units, `w` the peak swirl rate at its core, and `share`
   its slice of the storm particle budget.

   There are deliberately none at the poles. A polar cyclone is centred on the
   rotation axis, so the shader rotates it about its own centre and it never
   moves on screen; it lands on the polar hood, which is the dimmest part of
   the deck; and being collar-weighted it is a ring. A stationary bright ring
   on the dimmest part of the limb reads as a hoop floating beside the disc,
   not as weather. The deck's own polar hood carries the poles instead. */
export const GIANT_STORMS = Object.freeze([
  { lat: -0.30, lon: 1.15, r: 3.35, w: 0.30, sense: 1, tint: 2.95, lum: 1.0, share: 0.36 },
  { lat: 0.52, lon: -1.90, r: 2.10, w: 0.34, sense: -1, tint: 2.60, lum: 0.95, share: 0.21 },
  { lat: -0.62, lon: 2.60, r: 1.55, w: 0.38, sense: 1, tint: 2.5, lum: 1.1, share: 0.14 },
  { lat: 0.24, lon: 2.95, r: 1.25, w: 0.40, sense: -1, tint: 2.78, lum: 0.9, share: 0.11 },
  { lat: -0.14, lon: -0.55, r: 1.05, w: 0.42, sense: 1, tint: 2.54, lum: 0.95, share: 0.08 },
  { lat: 0.78, lon: 0.35, r: 1.35, w: 0.33, sense: -1, tint: 2.88, lum: 0.85, share: 0.10 },
]);

/* Eruption sites. `phase` offsets each one in the shared flare cycle so they
   fire one or two at a time rather than together — the active part of the
   cycle is about a fifth of it, which with nine sites keeps roughly two
   erupting at any moment; `reach` is how far the plume throws in body units
   and `curl` how far the zonal wind bends it over. Bend matters: a plume that
   only rises reads as a spike stuck to the limb rather than as an arc. */
export const GIANT_FLARES = Object.freeze([
  { lat: 0.10, lon: 0.30, phase: 0.00, reach: 5.0, curl: 0.95 },
  { lat: -0.46, lon: 2.10, phase: 0.12, reach: 3.6, curl: -0.72 },
  { lat: 0.66, lon: -1.20, phase: 0.23, reach: 4.1, curl: 0.6 },
  { lat: -0.18, lon: -2.55, phase: 0.34, reach: 5.6, curl: 1.05 },
  { lat: 0.34, lon: 1.85, phase: 0.45, reach: 3.3, curl: -0.5 },
  { lat: -0.82, lon: 0.95, phase: 0.56, reach: 4.4, curl: 0.8 },
  { lat: 0.02, lon: -0.70, phase: 0.68, reach: 6.4, curl: 1.2 },
  { lat: -0.58, lon: -1.65, phase: 0.79, reach: 3.9, curl: -0.62 },
  { lat: 0.88, lon: 2.70, phase: 0.90, reach: 4.6, curl: 0.7 },
]);

/* The per-particle `spin` attribute is overloaded. Below 90 it is a literal
   angular rate; from 100 up it is a tag the shader decodes back into "which
   body does this particle belong to", with the rate packed into the fractional
   part. Bands: 100+ giant storms, 200+ nucleus shells, 500+ reaction planes.
   Negative values below -0.5 are the second tag space, currently the giant's
   flare sites. It saves spending a whole extra attribute on a small enum. */
export const stormSpin = (index, rate) => 100 + index * 10 + 5 + rate;
export const flareSpin = (index) => -(2 + index);

// Eight electron shells for the nucleus, each tumbling about its own axis. The
// axes are pre-normalised and irregular on purpose: evenly spaced ones would
// visibly line up as the shells rotate through each other.
export const NUCLEUS_SHELLS = Object.freeze([
  { axis: [0, 1, 0], rate: 0.6 },
  { axis: [0, 0.4226, 0.9063], rate: -0.42 },
  { axis: [0.8829, 0.4695, 0], rate: 0.3 },
  { axis: [-0.7295, 0.4997, 0.4597], rate: 0.5 },
  { axis: [0.3497, 0.3497, -0.8692], rate: -0.34 },
  { axis: [-0.5507, 0.7209, -0.4205], rate: 0.46 },
  { axis: [0.6194, 0.1998, 0.7592], rate: -0.55 },
  { axis: [-0.15, 0.8997, 0.4099], rate: 0.38 },
]);
export const nucleusOrbitSpin = (shell, rate) => 200 + shell * 10 + 5 + rate;

export const REACT_BODY_SPIN = 0.38;
// Orbital planes for the nucleus formation. Each plane is a centre plus the axis
// its ring of electrons spins about. Still named REACT_* because the formation
// is a molecule caught mid-reaction and the shader decodes the same names; the
// generator was called `reactants` until the scene id and the module name were
// collapsed onto one.
export const REACT_PLANES = Object.freeze([
  { centre: [0, 3.4892, -0.7137], axis: [0, 0.9797, -0.2004] },
  { centre: [-3.3702, -0.8723, -0.7137], axis: [-0.9484, -0.2455, -0.2008] },
  { centre: [4.0235, 0.1871, -1.1231], axis: [0.9622, 0.0448, -0.2685] },
  { centre: [-0.882, -3.087, 2.723], axis: [-0.2095, -0.7332, 0.6468] },
  { centre: [9.871, 1.0875, -2.008], axis: [0.9245, 0.3617, 0.1206] },
  { centre: [-0.246, -7.213, 6.165], axis: [0.7687, -0.526, 0.3641] },
  { centre: [0, 6.9784, -1.4274], axis: [1, 0, 0] },
  { centre: [-6.7405, -1.7446, -1.4274], axis: [0.199, -0.895, 0.398] },
  { centre: [8.047, 0.374, -2.246], axis: [0, 0.929, 0.371] },
  { centre: [-1.764, -6.174, 5.446], axis: [0.995, 0.1, 0] },
  { centre: [11.695, 1.801, -1.77], axis: [-0.365, 0.931, 0] },
  { centre: [1.272, -8.252, 6.884], axis: [0.565, 0.825, 0] },
]);
export const reactOrbitSpin = (plane, rate) => 500 + plane * 10 + 5 + rate;

// The twin jets fired along the spin axis of the black and white holes.
export const BIPOLAR_PLUME = Object.freeze({
  start: 3.25,
  end: 37.0,
  spin: 0.065,
});

// Black hole: matter spirals inward. Particles further out than jetThreshold
// join the jet instead of the disc.
export const ACCRETION = Object.freeze({
  jetThreshold: 4.0,
  jetStart: BIPOLAR_PLUME.start,
  jetSpan: BIPOLAR_PLUME.end - BIPOLAR_PLUME.start,
  infallIn: 6.6,
  infallSpan: 32.0,
  infallSpeed: 2.0,
});

// White hole: the same machinery with the sign flipped, matter streaming out.
export const OUTFLOW = Object.freeze({
  ejectStart: 1.2,
  ejectSpan: 49.0,
  ejectSpeed: 2.0,
});

// The z extent particles recycle through in FLOW_Z mode. A particle that passes
// zMin wraps back to zMin + length, which is what makes the wormhole read as an
// endless tunnel from a finite number of points.
export const TUNNEL = Object.freeze({ zMin: -220, length: 260 });
