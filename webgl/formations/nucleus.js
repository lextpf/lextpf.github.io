import { MODE, NUCLEUS_SHELLS, nucleusOrbitSpin } from '../lib/modes.js';
import { TAU, GOLDEN_ANGLE, fibonacciDirection } from '../lib/random.js';

const SPIN_NUC = 0.2;
const SHELL_R = [5.8, 10.2, 14.8];
const SHELL_E = [2, 4, 6];

const norm3 = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function nucleonCentres(rng) {
  const out = [[0, 0, 0]];
  const tmp = [0, 0, 0];
  for (let i = 0; i < 12; i++) {
    fibonacciDirection(i, 12, tmp);
    out.push([tmp[0] * 0.95 + rng.bell() * 0.24, tmp[1] * 0.95 + rng.bell() * 0.24, tmp[2] * 0.95 + rng.bell() * 0.24]);
  }
  for (let i = 0; i < 22; i++) {
    fibonacciDirection(i, 22, tmp);
    out.push([tmp[0] * 1.78 + rng.bell() * 0.28, tmp[1] * 1.78 + rng.bell() * 0.28, tmp[2] * 1.78 + rng.bell() * 0.28]);
  }
  return out;
}

export const nucleus = {
  seed: 0x3a04,
  touch: { mode: 6, radius: 3.2, strength: 2.4 },
  mode: MODE.SPIN_Y,
  pivot: [0, 0, 0],
  tilt: { x: -1.0 },
  build(c) {
    const [nucleonShare, bindingShare, shellShare, ringShare, electronShare, photonShare, fieldShare] =
      c.split([0.13, 0.035, 0.24, 0.095, 0.16, 0.115, 0.225]);

    const centres = nucleonCentres(c.rng);
    const perNucleon = Math.floor(nucleonShare / centres.length);
    const KEY_N = norm3([-0.5, 0.8, 0.45]);
    centres.forEach((centre, index) => {
      const proton = index % 2 === 0;
      const shellIdx = index === 0 ? 0 : index < 13 ? 1 : 2;
      const stag = 0.02 + shellIdx * 0.03;
      const dir = [0, 0, 0];
      const jit = 1.7 / Math.sqrt(Math.max(16, perNucleon));
      // each nucleon is a marble: a dense lit sphere surface with a specular
      // glint toward the key light, protons warm, neutrons cool
      for (let i = 0; i < perNucleon; i++) {
        const glint = i < 2;
        fibonacciDirection(i, perNucleon, dir);
        const d = glint
          ? norm3([KEY_N[0] + c.rng.bell() * 0.22, KEY_N[1] + c.rng.bell() * 0.22, KEY_N[2] + c.rng.bell() * 0.22])
          : norm3([dir[0] + c.rng.bell() * jit, dir[1] + c.rng.bell() * jit, dir[2] + c.rng.bell() * jit]);
        const s = Math.max(0, d[0] * KEY_N[0] + d[1] * KEY_N[1] + d[2] * KEY_N[2]);
        const lit = 0.22 + 0.78 * Math.pow(s, 1.9);
        const r = 0.52;
        c.write(
          centre[0] + d[0] * r,
          centre[1] + d[1] * r,
          centre[2] + d[2] * r,
          glint ? c.rng.range(0.7, 0.9) : c.rng.range(0.2, 0.32) * (0.55 + lit),
          proton ? Math.min(1, 0.5 + lit * 0.4) : 0.06 + lit * 0.14,
          stag + c.rng.range(0, 0.03),
          SPIN_NUC,
          1
        );
      }
    });

    for (let i = 0; i < bindingShare; i++) {
      const r = 2.5 + 0.5 * Math.pow(c.rng.unit(), 0.6);
      const cosPhi = c.rng.signed();
      const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
      const theta = c.rng.unit() * TAU;
      c.write(
        r * sinPhi * Math.cos(theta),
        r * cosPhi,
        r * sinPhi * Math.sin(theta),
        c.rng.range(0.05, 0.11),
        c.rng.range(0.25, 0.5),
        0.06 + c.rng.range(0, 0.06),
        SPIN_NUC,
        0.55
      );
    }

    const shellWeights = [0.46, 0.32, 0.22];
    SHELL_R.forEach((R, s) => {
      const n = Math.floor(shellShare * shellWeights[s]);
      const tmp = [0, 0, 0];
      for (let i = 0; i < n; i++) {
        fibonacciDirection((i * 11 + 5) % n, n, tmp);
        const r = R + c.rng.bell() * 0.3;
        const jx = c.rng.bell() * 0.35, jy = c.rng.bell() * 0.35, jz = c.rng.bell() * 0.35;
        const retro = c.rng.chance(0.3) ? -1 : 1;
        c.write(
          tmp[0] * r + jx, tmp[1] * r + jy, tmp[2] * r + jz,
          c.rng.range(0.09, 0.19) * (s === 0 ? 1.15 : 1),
          c.rng.range(0.2, 0.55),
          0.28 + s * 0.16 + c.rng.range(0, 0.1),
          0.35 * c.rng.range(0.35, 0.95) * retro,
          0.3
        );
      }
    });

    const basis = NUCLEUS_SHELLS.map((sh) => {
      const ax = sh.axis;
      const pick = Math.abs(ax[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
      const u = norm3(cross3(pick, ax));
      const v = cross3(ax, u);
      return { u, v };
    });
    const circle = (s, a, R) => {
      const { u, v } = basis[s];
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      return [
        (u[0] * ca + v[0] * sa) * R,
        (u[1] * ca + v[1] * sa) * R,
        (u[2] * ca + v[2] * sa) * R,
      ];
    };
    const electrons = [];
    let planeCursor = 0;
    SHELL_R.forEach((R, s) => {
      for (let k = 0; k < SHELL_E[s]; k++) {
        const plane = planeCursor++ % NUCLEUS_SHELLS.length;
        electrons.push({
          plane,
          R: R + c.rng.bell() * 0.05,
          a0: (k / SHELL_E[s]) * TAU + s * 1.7 + c.rng.range(0, 0.5),
          w: NUCLEUS_SHELLS[plane].rate * c.rng.range(0.92, 1.08),
          stag: 0.76 + s * 0.05 + k * 0.008,
        });
      }
    });

    const perRing = Math.floor(ringShare / electrons.length);
    electrons.forEach((e) => {
      const enc = nucleusOrbitSpin(e.plane, e.w);
      const dir = Math.sign(e.w) || 1;
      // not a full highlighted orbit — a faint wake arc trailing the electron,
      // reaching a little past the comet tail and dissolving
      for (let i = 0; i < perRing; i++) {
        const u = (i + 0.5) / perRing;
        const back = 0.5 + u * 1.9;
        const a = e.a0 - back * dir + c.rng.bell() * 0.02;
        const fade = 1 - u;
        const p = circle(e.plane, a, e.R + c.rng.bell() * 0.06);
        c.write(
          p[0] + c.rng.bell() * 0.05,
          p[1] + c.rng.bell() * 0.05,
          p[2] + c.rng.bell() * 0.05,
          c.rng.range(0.07, 0.13) * (0.4 + 0.6 * fade),
          c.rng.range(0.3, 0.55) * (0.5 + 0.5 * fade),
          e.stag - 0.06 + c.rng.range(0, 0.04),
          enc,
          0.85
        );
      }
    });

    const perElectron = Math.floor(electronShare / electrons.length);
    electrons.forEach((e) => {
      const enc = nucleusOrbitSpin(e.plane, e.w);
      const nHead = Math.floor(perElectron * 0.26);
      const pcen = circle(e.plane, e.a0, e.R);
      const d3 = [0, 0, 0];
      const jitE = 1.7 / Math.sqrt(Math.max(9, nHead));
      // electron marble: smaller than a nucleon, glassier — hard specular
      // falloff and a tight bright glint toward the key light
      for (let i = 0; i < nHead; i++) {
        const glint = i < 3;
        fibonacciDirection(i, nHead, d3);
        const d = glint
          ? norm3([KEY_N[0] + c.rng.bell() * 0.16, KEY_N[1] + c.rng.bell() * 0.16, KEY_N[2] + c.rng.bell() * 0.16])
          : norm3([d3[0] + c.rng.bell() * jitE, d3[1] + c.rng.bell() * jitE, d3[2] + c.rng.bell() * jitE]);
        const s = Math.max(0, d[0] * KEY_N[0] + d[1] * KEY_N[1] + d[2] * KEY_N[2]);
        const lit = 0.3 + 0.7 * Math.pow(s, 1.6);
        const r = 0.16;
        c.write(
          pcen[0] + d[0] * r,
          pcen[1] + d[1] * r,
          pcen[2] + d[2] * r,
          glint ? c.rng.range(0.85, 1.0) : c.rng.range(0.12, 0.2) * (0.45 + lit),
          Math.min(1, 0.55 + lit * 0.45),
          e.stag,
          enc,
          1
        );
      }
      const nTail = perElectron - nHead;
      const dir = Math.sign(e.w) || 1;
      for (let i = 0; i < nTail; i++) {
        const u = Math.pow((i + 0.5) / nTail, 0.7);
        // the tail meets the head directly, starts loose and condenses into
        // a fine line as it recedes
        const back = 0.02 + u * 0.8;
        const a = e.a0 - back * dir;
        const fray = 0.03 + (1 - u) * 0.16;
        const p = circle(e.plane, a, e.R + c.rng.bell() * fray);
        c.write(
          p[0] + c.rng.bell() * fray,
          p[1] + c.rng.bell() * fray,
          p[2] + c.rng.bell() * fray,
          (0.38 - u * 0.33) * c.rng.range(0.8, 1.15),
          c.rng.range(0.4, 0.65) * (1 - u * 0.4),
          e.stag + u * 0.04,
          enc,
          0.95
        );
      }
    });

    const TRAINS = 9;
    const perTrain = Math.floor(photonShare / TRAINS);
    for (let k = 0; k < TRAINS; k++) {
      const R = c.rng.range(17, 27);
      const y0 = c.rng.bell() * 8;
      const a0 = (k / TRAINS) * TAU + c.rng.range(0, 0.5);
      const arc = c.rng.range(6.5, 10) / R;
      const waves = c.rng.range(2.6, 3.6);
      const amp = c.rng.range(0.55, 0.85);
      const w = (k % 2 ? -1 : 1) * c.rng.range(0.09, 0.16);
      const tilt = c.rng.unit() * TAU;
      for (let i = 0; i < perTrain; i++) {
        const u = (i + 0.5) / perTrain;
        const a = a0 + (u - 0.5) * arc;
        const phase = u * waves * TAU;
        const env = Math.sin(u * Math.PI);
        const off = amp * env * Math.sin(phase);
        const anti = 0.45 + 0.55 * Math.abs(Math.sin(phase));
        const spark = i % 7 === 0;
        const rr = R + off * Math.sin(tilt) + c.rng.bell() * 0.05;
        c.write(
          Math.cos(a) * rr,
          y0 + off * Math.cos(tilt) + c.rng.bell() * 0.05,
          Math.sin(a) * rr,
          (spark ? c.rng.range(0.7, 1.0) : c.rng.range(0.26, 0.44)) * (0.55 + env * 0.75) * anti,
          c.rng.range(0.7, 1.0),
          0.8 + k * 0.018 + u * 0.08,
          w,
          spark ? 1 : 0.85
        );
      }
    }

    for (let i = 0; i < fieldShare; i++) {
      const r = 26 + 38 * Math.pow(c.rng.unit(), 0.78);
      const theta = i * GOLDEN_ANGLE;
      const cosPhi = c.rng.signed();
      const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
      c.write(
        r * sinPhi * Math.cos(theta),
        r * cosPhi * 0.47,
        r * sinPhi * Math.sin(theta),
        c.rng.range(0.14, 0.36),
        c.rng.range(0, 0.12),
        0.88 + c.rng.range(0, 0.12),
        0.004,
        0
      );
    }
  },
};
