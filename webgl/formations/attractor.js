import { MODE } from '../lib/modes.js';
import { TAU } from '../lib/random.js';

const SIGMA = 10;
const RHO = 28;
const BETA = 8 / 3;
const TOTAL_TIME = 42;
const LANES = 3;
const AMP = 0.32;
const S = 1.25;

const SX = 0.80 * S;
const SY = 0.45 * S;
const SZ = 0.42 * S;

function derivative(s, out) {
  out[0] = SIGMA * (s[1] - s[0]);
  out[1] = s[0] * (RHO - s[2]) - s[1];
  out[2] = s[0] * s[1] - BETA * s[2];
  return out;
}

const k1 = [0, 0, 0], k2 = [0, 0, 0], k3 = [0, 0, 0], k4 = [0, 0, 0], tmp = [0, 0, 0];

function step(s, dt) {
  derivative(s, k1);
  for (let i = 0; i < 3; i++) tmp[i] = s[i] + k1[i] * dt * 0.5;
  derivative(tmp, k2);
  for (let i = 0; i < 3; i++) tmp[i] = s[i] + k2[i] * dt * 0.5;
  derivative(tmp, k3);
  for (let i = 0; i < 3; i++) tmp[i] = s[i] + k3[i] * dt;
  derivative(tmp, k4);
  for (let i = 0; i < 3; i++) {
    s[i] += (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  }
  return s;
}

const place = (s) => [s[0] * SX, (s[2] - 25) * SY, s[1] * SZ];

function tangent(s) {
  derivative(s, k1);
  const t = [k1[0] * SX, k1[2] * SY, k1[1] * SZ];
  const l = Math.hypot(t[0], t[1], t[2]) || 1;
  return [t[0] / l, t[1] / l, t[2] / l];
}

function ribbonFrame(t) {
  let n = [t[2], 0, -t[0]];
  let l = Math.hypot(n[0], n[1], n[2]);
  if (l < 1e-4) { n = [1, 0, 0]; l = 1; }
  n = [n[0] / l, n[1] / l, n[2] / l];
  return [n, [
    t[1] * n[2] - t[2] * n[1],
    t[2] * n[0] - t[0] * n[2],
    t[0] * n[1] - t[1] * n[0],
  ]];
}

const DEPTH_MAX = 26 * SZ;

function settle(s) {
  for (let i = 0; i < 300; i++) step(s, 0.005);
  return s;
}

export const attractor = {
  seed: 0x9a09,
  touch: { mode: 8, radius: 8, strength: 2.2 },
  mode: MODE.ROCK_Y,
  pivot: [0, 0, 0],
  build(c) {
    const samples = Math.max(600, Math.floor(c.count / LANES));
    const dt = TOTAL_TIME / samples;

    const state = [0.9, 0.6, 21.4];
    settle(state);
    let arc = 0;
    for (let i = 0; i < samples; i++) {
      step(state, dt);
      const p = place(state);
      const t = tangent(state);
      const [n, b] = ribbonFrame(t);
      arc += dt;

      const d = derivative(state, tmp);
      const speed = Math.min(1, Math.hypot(d[0], d[1], d[2]) / 260);

      const depth = 0.5 + 0.5 * (p[2] / DEPTH_MAX);
      const twist = arc * 5.4;

      for (let lane = 0; lane < LANES; lane++) {
        const a = twist + (lane / LANES) * TAU;
        const r = 0.16;
        c.write(
          p[0] + (n[0] * Math.cos(a) + b[0] * Math.sin(a)) * r,
          p[1] + (n[1] * Math.cos(a) + b[1] * Math.sin(a)) * r,
          p[2] + (n[2] * Math.cos(a) + b[2] * Math.sin(a)) * r,
          (0.34 + speed * 0.58) * (0.62 + depth * 0.6),
          0.14 + speed * 0.42,
          0.03 + (i / samples) * 0.82,
          AMP,
          1
        );
      }
    }

  },
};
