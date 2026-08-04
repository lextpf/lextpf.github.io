import { MODE } from '../lib/modes.js';
import { TAU } from '../lib/random.js';

const PITCH = 6.0;
const R0 = 3.4;
const ARM_RATE = (r) => 0.34 / (1 + 0.13 * r);
const warpY = (r, a) => {
  const w = Math.pow(Math.max(0, (r - 14) / 32), 2);
  return w * 3.6 * Math.sin(a - 0.9)
    + w * 2.3 * Math.sin(a * 2.3 + r * 0.22)
    + w * 1.4 * Math.sin(a * 4.7 - r * 0.13);
};

function spiral(c, budget, origin, scale, tintBias) {
  const core = Math.floor(budget * 0.24);
  const arms = Math.floor(budget * 0.66);
  const halo = budget - core - arms;
  const [ox, oy, oz] = origin;

  for (let i = 0; i < core; i++) {
    const r = 7.2 * Math.pow(c.rng.unit(), 1.15) * scale;
    const a = c.rng.unit() * TAU;
    c.write(
      ox + Math.cos(a) * r,
      oy + c.rng.bell() * 1.7 * scale,
      oz + Math.sin(a) * r,
      c.rng.range(0.24, 0.66),
      tintBias + c.rng.range(0, 0.22),
      c.rng.range(0, 0.25),
      0.19
    );
  }

  for (let i = 0; i < arms; i++) {
    const t = Math.pow(c.rng.unit(), 0.55);
    const r = (R0 + 40 * t) * scale;
    const arm = i % 2 === 0 ? 0 : Math.PI;
    let scatter = c.rng.bell() * (0.2 - 0.09 * t);
    if (scatter > -0.105 && scatter < -0.028) scatter = -0.105;
    const a = arm + PITCH * Math.log(r / (R0 * scale)) + scatter;
    const thickness = (2.4 * Math.exp(-r / (26 * scale)) + 0.28) * scale;
    const spine = 1 - Math.min(1, Math.abs(scatter) / 0.24);
    const warmStar = c.rng.chance(0.022);
    c.write(
      ox + Math.cos(a) * r,
      oy + c.rng.bell() * thickness,
      oz + Math.sin(a) * r,
      warmStar ? c.rng.range(1.5, 2.4) : 0.24 + spine * c.rng.range(0.3, 0.78),
      warmStar ? c.rng.range(0.55, 1) : tintBias * (1 - t) + c.rng.range(0, 0.16),
      0.25 + t * 0.6,
      ARM_RATE(r / scale)
    );
  }

  for (let i = 0; i < halo; i++) {
    const r = (44 + 34 * Math.pow(c.rng.unit(), 0.8)) * scale;
    const a = c.rng.unit() * TAU;
    c.write(
      ox + Math.cos(a) * r,
      oy + c.rng.bell() * 9 * scale,
      oz + Math.sin(a) * r,
      c.rng.range(0.16, 0.44),
      c.rng.range(0, 0.28),
      0.8 + c.rng.range(0, 0.2),
      ARM_RATE(r / scale) * 0.7
    );
  }
}

export const galaxy = {
  seed: 0x6606,
  touch: { mode: 1, radius: 11, strength: 3.0 },
  mode: MODE.SPIN_Y,
  warmRadius: 30,
  build(c) {
    const [nucleusShare, bulgeShare, barShare, armShare, spurShare, knotShare,
      nebulaShare, laneGlowShare, haloShare, satShare] =
      c.split([0.07, 0.10, 0.05, 0.21, 0.06, 0.05, 0.07, 0.03, 0.05, 0.10]);

    for (let i = 0; i < nucleusShare; i++) {
      const r = 2.4 * Math.pow(c.rng.unit(), 2.0);
      const a = c.rng.unit() * TAU;
      const hot = i % 12 === 0;
      c.write(
        Math.cos(a) * r,
        c.rng.bell() * (0.9 - r * 0.22),
        Math.sin(a) * r,
        hot ? c.rng.range(0.8, 1.3) : c.rng.range(0.3, 0.68) * (1.25 - r * 0.25),
        c.rng.range(0.02, 0.12),
        c.rng.range(0, 0.08),
        ARM_RATE(Math.max(1.5, r)),
        0.55
      );
    }

    for (let i = 0; i < bulgeShare; i++) {
      const r = 6.8 * Math.pow(c.rng.unit(), 1.25);
      const a = c.rng.unit() * TAU;
      const edge = 1 + 0.45 * Math.exp(-Math.pow((r - 6.1) / 1.1, 2));
      c.write(
        Math.cos(a) * r,
        c.rng.bell() * (2.4 - r * 0.18),
        Math.sin(a) * r,
        c.rng.range(0.22, 0.55) * edge * (1 + (1 - r / 6.8) * 0.5),
        c.rng.range(0.02, 0.16),
        c.rng.range(0, 0.2),
        ARM_RATE(Math.max(2.5, r)),
        0.4
      );
    }

    const BAR_A = 0.55;
    for (let i = 0; i < barShare; i++) {
      const u = c.rng.signed();
      const rr = Math.abs(u) * 7.0;
      const side = u < 0 ? Math.PI : 0;
      const twist = 1.15 * Math.pow(Math.abs(u), 1.5);
      const a = BAR_A + side + twist;
      const across = c.rng.bell() * (1.5 - Math.abs(u) * 0.7);
      c.write(
        Math.cos(a) * rr - Math.sin(a) * across,
        c.rng.bell() * 1.1,
        Math.sin(a) * rr + Math.cos(a) * across,
        c.rng.range(0.26, 0.6) * (1.15 - Math.abs(u) * 0.4),
        c.rng.range(0.04, 0.18),
        0.05 + Math.abs(u) * 0.12,
        ARM_RATE(Math.max(2.2, rr)),
        0.55
      );
    }

    for (let i = 0; i < armShare; i++) {
      const t = Math.pow(c.rng.unit(), 0.85);
      const r = R0 + 42 * t;
      const arm = i % 2 === 0 ? BAR_A : BAR_A + Math.PI;
      let scatter = c.rng.bell() * (0.2 - 0.09 * t);
      if (scatter > -0.105 && scatter < -0.028) scatter = -0.105;
      const a = arm + PITCH * Math.log(r / R0) + scatter;
      const thickness = 2.4 * Math.exp(-r / 26) + 0.28 + t * 0.6;
      const spine = 1 - Math.min(1, Math.abs(scatter) / 0.24);
      const warmStar = c.rng.chance(0.022);
      // arms are mostly fine grain with sparse resolved stars: a photographic
      // star-stream instead of a chain of uniform blobs.
      const fineDust = c.rng.chance(0.72);
      c.write(
        Math.cos(a) * r,
        warpY(r, a) + c.rng.bell() * thickness,
        Math.sin(a) * r,
        warmStar ? c.rng.range(1.15, 1.8)
          : fineDust ? (0.13 + spine * c.rng.range(0.06, 0.22)) * (1 - t * 0.25)
          : (0.34 + spine * c.rng.range(0.24, 0.6)) * (1 - t * 0.3),
        warmStar ? c.rng.range(0.04, 0.2) : 0.2 + t * 0.42 + spine * 0.12 + c.rng.range(0, 0.1),
        0.25 + t * 0.6,
        ARM_RATE(r),
        spine * 0.5
      );
    }

    for (let i = 0; i < spurShare; i++) {
      const t = 0.34 + 0.5 * Math.pow(c.rng.unit(), 0.7);
      const r = R0 + 42 * t;
      const arm = (i % 2 === 0 ? BAR_A : BAR_A + Math.PI) + 0.72;
      const scatter = c.rng.bell() * 0.13;
      const a = arm + PITCH * 1.12 * Math.log(r / R0) + scatter;
      c.write(
        Math.cos(a) * r,
        warpY(r, a) + c.rng.bell() * (1.6 * Math.exp(-r / 26) + 0.24),
        Math.sin(a) * r,
        (0.2 + c.rng.range(0, 0.42)) * (1 - t * 0.25),
        0.25 + t * 0.4 + c.rng.range(0, 0.12),
        0.35 + t * 0.5,
        ARM_RATE(r),
        0.3
      );
    }

    const KNOTS = [0.16, 0.27, 0.38, 0.5, 0.63, 0.2, 0.31, 0.44, 0.57, 0.7];
    const perKnot = Math.floor(knotShare / KNOTS.length);
    KNOTS.forEach((tk, k) => {
      const r = R0 + 42 * tk;
      const arm = k % 2 === 0 ? BAR_A : BAR_A + Math.PI;
      const a = arm + PITCH * Math.log(r / R0) + c.rng.bell() * 0.03;
      const cx = Math.cos(a) * r;
      const cz = Math.sin(a) * r;
      const cy = warpY(r, a);
      const rate = ARM_RATE(r);
      for (let i = 0; i < perKnot; i++) {
        const rr = 0.8 * Math.pow(c.rng.unit(), 0.7);
        const aa = c.rng.unit() * TAU;
        const y = cy + c.rng.bell() * 0.45;
        c.write(
          cx + Math.cos(aa) * rr,
          y,
          cz + Math.sin(aa) * rr,
          i % 17 === 0 ? c.rng.range(0.68, 1.0) * (1 - tk * 0.25) : c.rng.range(0.13, 0.3) * (1 - tk * 0.3),
          c.rng.range(0.02, 0.18),
          0.3 + tk * 0.5,
          rate,
          0.85
        );
      }
    });

    const CLOUDS = [0.2, 0.33, 0.47, 0.6, 0.26, 0.41, 0.55, 0.68];
    const perCloud = Math.floor(nebulaShare / CLOUDS.length);
    CLOUDS.forEach((tk, k) => {
      const r = R0 + 42 * tk;
      const arm = k % 2 === 0 ? BAR_A : BAR_A + Math.PI;
      const a = arm + PITCH * Math.log(r / R0) + 0.05 + c.rng.bell() * 0.04;
      const cx = Math.cos(a) * r;
      const cz = Math.sin(a) * r;
      const tx = -Math.sin(a);
      const tz = Math.cos(a);
      const rate = ARM_RATE(r);
      for (let i = 0; i < perCloud; i++) {
        const along = c.rng.bell() * 4.2;
        const out = c.rng.bell() * 1.3;
        c.write(
          cx + tx * along + Math.cos(a) * out,
          warpY(r, a) + c.rng.bell() * 0.9,
          cz + tz * along + Math.sin(a) * out,
          c.rng.range(0.2, 0.45),
          c.rng.range(0.3, 0.85),
          0.4 + tk * 0.4,
          rate * c.rng.range(0.92, 1.08),
          0
        );
      }
    });

    for (let i = 0; i < laneGlowShare; i++) {
      const t = Math.pow(c.rng.unit(), 0.6);
      const r = R0 + 40 * t;
      const arm = i % 2 === 0 ? BAR_A : BAR_A + Math.PI;
      const a = arm + PITCH * Math.log(r / R0) - 0.021 + c.rng.bell() * 0.004;
      c.write(
        Math.cos(a) * r,
        warpY(r, a) + c.rng.bell() * 0.35,
        Math.sin(a) * r,
        c.rng.range(0.16, 0.3),
        c.rng.range(0.15, 0.4),
        0.3 + t * 0.5,
        ARM_RATE(r),
        0.6
      );
    }

    for (let i = 0; i < haloShare; i++) {
      const r = 44 + 34 * Math.pow(c.rng.unit(), 0.8);
      const a = c.rng.unit() * TAU;
      c.write(
        Math.cos(a) * r,
        warpY(r, a) + c.rng.bell() * 3.2,
        Math.sin(a) * r,
        c.rng.range(0.16, 0.44),
        c.rng.range(0, 0.28),
        0.8 + c.rng.range(0, 0.2),
        ARM_RATE(r) * 0.7,
        0
      );
    }

    const FLARES = [[34, 9, 18], [-40, 6, 8], [18, 12, -26], [-24, 14, -14], [48, 5, -4], [-12, 8, 30]];
    const perFlare = Math.floor(satShare * 0.24 / FLARES.length);
    FLARES.forEach(([fx, fy, fz], fi) => {
      for (let i = 0; i < 6; i++) {
        c.write(
          fx + c.rng.bell() * 0.05, fy + c.rng.bell() * 0.05, fz + c.rng.bell() * 0.05,
          c.rng.range(0.78, 1.05), 0.1 + (fi % 3) * 0.06, 0.8, 0, 1
        );
      }
      const armN = Math.max(6, Math.floor((perFlare - 6) / 4));
      const len = (1.9 + (fi % 3) * 0.55) * 0.7;
      for (let axis = 0; axis < 2; axis++) {
        for (let sgn = -1; sgn <= 1; sgn += 2) {
          for (let i = 0; i < armN; i++) {
            const t = (i + 0.5) / armN;
            const d = sgn * t * len;
            c.write(
              fx + (axis === 0 ? d : c.rng.bell() * 0.03),
              fy + (axis === 1 ? d : c.rng.bell() * 0.03),
              fz + c.rng.bell() * 0.03,
              (0.5 * Math.pow(1 - t, 1.7) + 0.07) * c.rng.range(0.9, 1.1),
              0.16, 0.8 + t * 0.04, 0, 1
            );
          }
        }
      }
    });

    const rest = c.count - c.cursor;
    for (let i = 0; i < rest; i++) {
      // starfield shell: dust with sparse crisp stars in every direction
      const star = i % 4 === 0;
      const r = 40 + 42 * Math.pow(c.rng.unit(), 0.75);
      const cosPhi = c.rng.signed();
      const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
      const theta = c.rng.unit() * TAU;
      c.write(
        r * sinPhi * Math.cos(theta),
        r * cosPhi * 0.75,
        r * sinPhi * Math.sin(theta),
        star ? c.rng.range(0.34, 0.56) : c.rng.range(0.18, 0.38),
        c.rng.range(0, 0.2),
        0.9,
        0.004,
        0
      );
    }
  },
};
