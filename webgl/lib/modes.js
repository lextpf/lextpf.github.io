
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

/* The planetary system's four orbits. R is the orbital radius, rate the angular
   speed, body the size of the planet itself, and depth/width the dent it presses
   into the grid of spacetime beneath it.

   Both sides need these. formations/planetary.js uses them at bake time to
   brighten the grid at each orbital radius, and shaders/particles.js uses them
   every frame to push the grid down beneath each planet's current position. Move
   a number here and both follow; hardcode it on one side and the dent drifts
   away from the planet that is supposed to be making it. */
export const ORBIT_PLANETS = Object.freeze([
  { R: 12.5, phase: 2.7, rate: 0.16, depth: 5.6, width: 4.2, body: 2.9 },
  { R: 18.0, phase: 5.84, rate: 0.16, depth: 4.2, width: 3.3, body: 2.0 },
  { R: 27.5, phase: 0.9, rate: 0.125, depth: 2.2, width: 2.3, body: 1.25 },
  { R: 37.5, phase: 5.5, rate: 0.085, depth: 1.3, width: 1.7, body: 0.95 },
]);

// The per-particle `spin` attribute is overloaded. Below 90 it is a literal
// angular rate; from 100 up it is a tag the shader decodes back into "which
// body does this particle belong to", with the rate packed into the fractional
// part. Bands: 100+ orbit satellites, 200+ nucleus shells, 500+ reaction planes.
// It saves spending a whole extra per-particle attribute on a small enum.
export const orbitSatelliteSpin = (planetIndex, rate) => 100 + planetIndex * 10 + rate;

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
