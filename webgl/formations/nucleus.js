
import { MODE, REACT_PLANES, REACT_BODY_SPIN, reactOrbitSpin } from '../lib/modes.js';
import { TAU } from '../lib/random.js';
import { norm3, basisFor, litBall, nucleonCluster, shellDust, electronComet, fieldDust } from './atom-kit.js';

const SPIN = REACT_BODY_SPIN;

// Budget shares, tuned by eye rather than derived, hence the odd precision. In
// order: nucleus, oxygen nucleons, hydrogen nucleons, halo, lens, axis,
// electrons, lone pairs, hydrogen electrons. They plus FIELD_W sum to 1.
const MOLECULE_W = [0.0994, 0.1871, 0.014, 0.1111, 0.0585, 0.0491, 0.1345, 0.0936, 0.014];
const FIELD_W = 0.239;

function buildNucleus(c) {
  const [nucS, nucO, nucH, haloShare, lensShare, axisShare, elecShare, loneShare, hElecShare, fieldShare] =
    c.split([...MOLECULE_W, FIELD_W]);

  const O = [
    [0, 6.9784, -1.4274],
    [-6.7405, -1.7446, -1.4274],
    [8.047, 0.374, -2.246],
    [-1.764, -6.174, 5.446],
  ];
  const H = [[11.695, 1.801, -1.77], [1.272, -8.252, 6.884]];

  nucleonCluster(c, [0, 0, 0], nucS, [[10, 0.85], [14, 1.5]], { spin: SPIN, stag: 0.02, ballR: 0.5 });

  const perO = Math.floor(nucO / 4);
  O.forEach((cen, i) => {
    nucleonCluster(c, cen, perO, [[7, 0.62]], { spin: SPIN, stag: 0.04 + i * 0.01, ballR: 0.4 });
  });
  const perH = Math.floor(nucH / 2);
  H.forEach((cen, i) => {
    litBall(c, cen, 0.34, perH, {
      spin: SPIN, stag: 0.09 + i * 0.01, glints: 2,
      tint: (lit) => Math.min(1, 0.5 + lit * 0.4),
    });
  });

  const haloS = Math.floor(haloShare * 0.3);
  shellDust(c, [0, 0, 0], [2.6], [1], haloS, { spin: SPIN, stag0: 0.28 });
  const perHalo = Math.floor((haloShare - haloS) / 4);
  O.forEach((cen, i) => {
    shellDust(c, cen, [1.8], [1], perHalo, { spin: SPIN, stag0: 0.3 + i * 0.015 });
  });

  const BONDS = [
    { plane: 0, dbl: true, R: 0.95 },
    { plane: 1, dbl: true, R: 0.95 },
    { plane: 2, dbl: false, R: 1.05 },
    { plane: 3, dbl: false, R: 1.05 },
    { plane: 4, dbl: false, R: 0.78 },
    { plane: 5, dbl: false, R: 0.78 },
  ];
  const perLens = Math.floor(lensShare / BONDS.length);
  BONDS.forEach((b) => {
    const pl = REACT_PLANES[b.plane];
    const ax = pl.axis;
    const { u, v } = basisFor(ax);
    for (let i = 0; i < perLens; i++) {
      const along = c.rng.bell() * (b.dbl ? 1.7 : 1.4);
      const ru = c.rng.bell() * 0.55, rv = c.rng.bell() * 0.55;
      const gold = c.rng.chance(0.6);
      c.write(
        pl.centre[0] + ax[0] * along + u[0] * ru + v[0] * rv,
        pl.centre[1] + ax[1] * along + u[1] * ru + v[1] * rv,
        pl.centre[2] + ax[2] * along + u[2] * ru + v[2] * rv,
        c.rng.range(0.04, 0.09),
        gold ? c.rng.range(2.6, 2.7) : c.rng.range(0.45, 0.7),
        0.55 + c.rng.range(0, 0.08),
        SPIN,
        0.5
      );
    }
  });
  const AXES = [
    { plane: 0, half: 3.57, trimA: 2.3, trimB: 1.7 },
    { plane: 1, half: 3.57, trimA: 2.3, trimB: 1.7 },
    { plane: 2, half: 4.21, trimA: 2.3, trimB: 1.7 },
    { plane: 3, half: 4.21, trimA: 2.3, trimB: 1.7 },
    { plane: 4, half: 1.975, trimA: 1.6, trimB: 0.8 },
    { plane: 5, half: 1.975, trimA: 1.6, trimB: 0.8 },
  ];
  const perAxis = Math.floor(axisShare / AXES.length);
  AXES.forEach((b) => {
    const pl = REACT_PLANES[b.plane];
    const ax = pl.axis;
    const span = 2 * b.half - b.trimA - b.trimB;
    for (let i = 0; i < perAxis; i++) {
      const s = -b.half + b.trimA + ((i + 0.5) / perAxis) * span;
      const spark = i % 23 === 0;
      c.write(
        pl.centre[0] + ax[0] * s + c.rng.bell() * 0.06,
        pl.centre[1] + ax[1] * s + c.rng.bell() * 0.06,
        pl.centre[2] + ax[2] * s + c.rng.bell() * 0.06,
        spark ? c.rng.range(0.2, 0.3) : c.rng.range(0.05, 0.11),
        spark ? c.rng.range(2.64, 2.72) : c.rng.range(2.6, 2.68),
        0.55 + c.rng.range(0, 0.07),
        SPIN,
        0.7
      );
    }
  });

  const rings = [];
  BONDS.forEach((b) => {
    if (b.dbl) {
      rings.push({ ...b, off: -0.5 });
      rings.push({ ...b, off: 0.5 });
    } else {
      rings.push({ ...b, off: 0 });
    }
  });
  const perE = Math.floor(elecShare / (rings.length * 2));
  rings.forEach((ring, ri) => {
    const pl = REACT_PLANES[ring.plane];
    const ax = pl.axis;
    const { u, v } = basisFor(ax);
    const centre = [
      pl.centre[0] + ax[0] * ring.off,
      pl.centre[1] + ax[1] * ring.off,
      pl.centre[2] + ax[2] * ring.off,
    ];
    const rate = (ri % 2 ? -1 : 1) * c.rng.range(2.1, 2.7);
    [0, Math.PI].forEach((a0, k) => {
      electronComet(c, {
        centre, u, v, R: ring.R,
        a0: a0 + ri * 0.8, spin: reactOrbitSpin(ring.plane, rate),
        stag: 0.76 + ri * 0.006 + k * 0.003, dir: Math.sign(rate),
      }, Math.floor(perE * 0.62), Math.floor(perE * 0.38), (t) => 2.62 + Math.min(0.16, t * 0.2));
    });
  });

  const perL = Math.floor(loneShare / 16);
  [6, 7, 8, 9].forEach((plane, oi) => {
    const pl = REACT_PLANES[plane];
    const { u, v } = basisFor(pl.axis);
    const rate = (oi % 2 ? -1 : 1) * c.rng.range(2.0, 2.5);
    [0, 0.55, Math.PI, Math.PI + 0.55].forEach((a0, k) => {
      electronComet(c, {
        centre: pl.centre, u, v, R: 1.95,
        a0: a0 + oi * 1.1, spin: reactOrbitSpin(plane, rate),
        stag: 0.8 + oi * 0.006 + k * 0.003, dir: Math.sign(rate),
      }, Math.floor(perL * 0.62), Math.floor(perL * 0.38));
    });
  });

  const perHE = Math.floor(hElecShare / 2);
  [10, 11].forEach((plane, hi) => {
    const pl = REACT_PLANES[plane];
    const { u, v } = basisFor(pl.axis);
    const rate = (hi % 2 ? -1 : 1) * 2.8;
    electronComet(c, {
      centre: pl.centre, u, v, R: 0.95,
      a0: hi * 2.2, spin: reactOrbitSpin(plane, rate),
      stag: 0.84 + hi * 0.006, dir: Math.sign(rate),
    }, Math.floor(perHE * 0.62), Math.floor(perHE * 0.38));
  });

  fieldDust(c, fieldShare);
}

export const nucleus = {
  seed: 0xac1d,
  touch: { mode: 6, radius: 3.4, strength: 2.2 },
  mode: MODE.SPIN_Y,
  pivot: [0, 0, 0],
  tilt: { x: -0.62, z: 0.05 },
  build: buildNucleus,
};
