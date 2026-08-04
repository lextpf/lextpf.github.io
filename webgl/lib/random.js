
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const remap = (v, a, b) => clamp01((v - a) / (b - a || 1e-6));

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

export const damp = (current, target, lambda, dt) =>
  current + (target - current) * (1 - Math.exp(-lambda * Math.max(dt, 0)));

export function fibonacciDirection(i, n, out) {
  const y = 1 - (2 * i + 1) / n;
  const radius = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = i * GOLDEN_ANGLE;
  out[0] = Math.cos(theta) * radius;
  out[1] = y;
  out[2] = Math.sin(theta) * radius;
  return out;
}

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
