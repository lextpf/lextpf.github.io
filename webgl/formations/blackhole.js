import { MODE, ACCRETION } from '../lib/modes.js';
import { TAU } from '../lib/random.js';
import { BIPOLAR_PLUME_SPIN, writeBipolarPlumes } from './bipolar-plumes.js';

export const BLACK_HOLE_HORIZON = 6.2;

export const BLACK_HOLE_TILT = { x: -1.08, y: 0.58, z: 0 };
const R = BLACK_HOLE_HORIZON;

const INNER_IN = R * 1.06;
const INNER_OUT = R * 2.45;
const OUTER_OUT = R * 2.8;

const OMEGA = (r) => 4.8 / Math.pow(Math.max(R, r), 1.5);
const DOPPLER = 0.55;
const doppler = (a) => Math.cos(a - DOPPLER);

export const blackhole = {
  seed: 0xa10a,
  touch: { mode: 2, radius: 9, strength: 2.8 },
  mode: MODE.ACCRETION,
  tilt: BLACK_HOLE_TILT,
  warmRadius: 14,
  build(c) {
    const [innerShare, outerShare, infallShare, dragShare,
      coreShare, sheathShare, haloShare] =
      c.split([0.20, 0.18, 0.18, 0.06, 0.20, 0.16, 0.02]);

    for (let i = 0; i < innerShare; i++) {
      // material lives in fine log-spaced lanes: with Kepler shear and the
      // motion streaks each lane reads as a continuous flowing thread, not a
      // scatter of dots. A sparse ember population keeps the sparkle.
      const lane = Math.floor(Math.pow(c.rng.unit(), 1.15) * 26);
      const u = (lane + 0.5) / 26 + c.rng.bell() * 0.012;
      const r = INNER_IN * Math.pow(INNER_OUT / INNER_IN, Math.min(1, Math.max(0, u)));
      const a = c.rng.unit() * TAU;
      const shear = 0.5 + 0.5 * Math.cos(4 * a - Math.log(r / INNER_IN) * 17);
      const d = doppler(a);
      const ember = c.rng.chance(0.03);
      c.write(
        Math.cos(a) * r,
        Math.sin(a) * r,
        c.rng.bell() * r * 0.03,
        (ember ? c.rng.range(0.72, 1.0) : c.rng.range(0.24, 0.5))
          * (0.72 + shear * 0.5) * (1 + d * 0.22),
        Math.min(1, 0.4 + shear * 0.24 + Math.max(0, d) * 0.22),
        0.1 + u * 0.14,
        OMEGA(r),
        1
      );
    }

    const DRAG = 9;
    const perDrag = Math.max(10, Math.floor(dragShare / DRAG));
    for (let s = 0; s < DRAG; s++) {
      const a0 = (s / DRAG) * TAU + c.rng.bell() * 0.25;
      const r0 = INNER_IN * (1.02 + (s % 4) * 0.14);
      const sweep = 3.4 + (s % 3) * 0.8;
      const zPlane = c.rng.bell() * 0.22;
      for (let i = 0; i < perDrag; i++) {
        const t = (i + c.rng.unit()) / perDrag;
        const r = r0 * (1 - t * 0.1);
        const a = a0 + sweep * t;
        const lead = Math.pow(1 - t, 0.5);
        c.write(
          Math.cos(a) * r + c.rng.bell() * 0.05,
          Math.sin(a) * r + c.rng.bell() * 0.05,
          zPlane * (1 - t) + c.rng.bell() * 0.05,
          c.rng.range(0.3, 0.62) * (0.5 + lead * 0.9),
          Math.min(1, 0.5 + lead * 0.4),
          0.14 + t * 0.12,
          OMEGA(r),
          1
        );
      }
    }

    for (let i = 0; i < outerShare; i++) {
      const u = c.rng.unit();
      const r = INNER_OUT * Math.pow(OUTER_OUT / INNER_OUT, u);
      const a = c.rng.unit() * TAU;
      const wave = 0.5 + 0.5 * Math.cos(2 * a - Math.log(r / INNER_OUT) * 5.2);
      const fine = 0.5 + 0.5 * Math.cos(Math.log(r / INNER_OUT) * 26);
      const d = doppler(a);
      c.write(
        Math.cos(a) * r,
        Math.sin(a) * r,
        c.rng.bell() * r * 0.05,
        c.rng.range(0.2, 0.42) * (0.5 + wave * 0.7 + fine * 0.45) * (1 + d * 0.2),
        Math.min(1, 0.1 + (1 - u) * 0.28 + wave * 0.18 + Math.max(0, d) * 0.16),
        0.24 + u * 0.3,
        OMEGA(r),
        1
      );
    }

    for (let i = 0; i < infallShare; i++) {
      const t = (i + c.rng.unit()) / infallShare;
      const radius = ACCRETION.infallIn + ACCRETION.infallSpan * t;
      const polar = c.rng.range(-1, 1);
      const planar = Math.sqrt(Math.max(0, 1 - polar * polar));
      const angle = c.rng.unit() * TAU;
      const spread = 0.035 + radius * 0.0025;
      c.write(
        Math.cos(angle) * planar * radius + c.rng.bell() * spread,
        Math.sin(angle) * planar * radius + c.rng.bell() * spread,
        polar * radius + c.rng.bell() * spread,
        c.rng.range(0.24, 0.52) * (0.7 + (1 - t) * 0.55),
        Math.min(1, 0.2 + (1 - t) * 0.54),
        0.24 + t * 0.7,
        -c.rng.range(0.16, 1.16),
        0.94
      );
    }

    writeBipolarPlumes(c, coreShare + sheathShare, {
      spin: BIPOLAR_PLUME_SPIN,
    });

    const rest = c.count - c.cursor;
    for (let i = 0; i < rest; i++) {
      const r = OUTER_OUT * 1.9 + 44 * Math.pow(c.rng.unit(), 0.72);
      const a = c.rng.unit() * TAU;
      c.write(
        Math.cos(a) * r,
        Math.sin(a) * r,
        c.rng.bell() * 2.2,
        c.rng.range(0.1, 0.3),
        c.rng.range(0, 0.18),
        0.8 + c.rng.range(0, 0.2),
        OMEGA(r) * 0.5,
        0
      );
    }
    void haloShare;
  },
};
