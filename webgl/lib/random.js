
// Mulberry32: a small, fast, seeded PRNG. Not cryptographic, but it has a full
// 2^32 period and good enough distribution for scattering points in space.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The shapes of randomness a formation generator actually wants. `bell` sums
// two uniforms to get a rough normal distribution, which clusters points toward
// the middle of a range instead of spreading them evenly.
export function makeRng(seed) {
  const next = mulberry32(seed);
  return {
    unit: next,
    range: (min, max) => min + (max - min) * next(),
    signed: () => next() * 2 - 1,
    bell: () => next() + next() - 1,
    chance: (p) => next() < p,
    int: (n) => Math.min(n - 1, Math.floor(next() * n)),
  };
}

export const TAU = Math.PI * 2;
// The angle that makes consecutive points on a spiral never line up, which is
// how sunflowers pack seeds and how fibonacciDirection spreads points evenly.
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
// Rescale v from the range [a, b] onto [0, 1]. Used to turn a chapter-wide
// progress value into a sub-range, e.g. "morph only between 45% and 95%".
export const remap = (v, a, b) => clamp01((v - a) / (b - a || 1e-6));

// S-curves. smoothstep has zero velocity at both ends; smootherstep also has
// zero acceleration, so it starts and stops without the faint kick smoothstep
// leaves on a slow camera move. The timeline uses smootherstep for that reason.
export const smoothstep = (t) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

export const smootherstep = (t) => {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

export const easeOutQuint = (t) => 1 - Math.pow(1 - clamp01(t), 5);
export const easeInOutSine = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(t));

// Frame-rate independent approach to a target: each step closes the same
// FRACTION of the remaining distance per unit of wall time, so the curve looks
// identical at 30fps and at 144fps. The naive version (current += delta * 0.1)
// does not, and moves twice as fast on a 120Hz panel as on a 60Hz one.
// `lambda` is the rate: bigger converges quicker.
export const damp = (current, target, lambda, dt) =>
  current + (target - current) * (1 - Math.exp(-lambda * Math.max(dt, 0)));

// Evenly spread the i-th of n directions over a sphere. Stepping the angle by
// the golden angle while walking y linearly from +1 to -1 avoids the clumping
// at the poles that naive lat/long sampling produces.
export function fibonacciDirection(i, n, out) {
  const y = 1 - (2 * i + 1) / n;
  const radius = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = i * GOLDEN_ANGLE;
  out[0] = Math.cos(theta) * radius;
  out[1] = y;
  out[2] = Math.sin(theta) * radius;
  return out;
}

// A fixed shuffle of 0..n-1 (Fisher-Yates on a seeded PRNG). The registry writes
// every formation through this permutation so that a generator emitting points
// arm-by-arm still lands them scattered across the buffer. Without it the morph
// stagger would sweep the shape in generator order and read as a wipe rather
// than a dissolve. Seeded, so it is the same permutation for every formation.
export function seededOrder(n, seed) {
  const next = mulberry32(seed);
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }
  return order;
}

// Quadratic Bezier. p1 is a pull point the curve bends toward but never touches,
// which is how generators bend a strand without authoring every point on it.
export function bezier2(p0, p1, p2, t, out) {
  const u = 1 - t;
  const a = u * u;
  const b = 2 * u * t;
  const c = t * t;
  out[0] = a * p0[0] + b * p1[0] + c * p2[0];
  out[1] = a * p0[1] + b * p1[1] + c * p2[1];
  out[2] = a * p0[2] + b * p1[2] + c * p2[2];
  return out;
}
