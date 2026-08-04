import { MODE, ORBIT_PLANETS, orbitSatelliteSpin } from '../lib/modes.js';
import { TAU, GOLDEN_ANGLE, fibonacciDirection } from '../lib/random.js';

const KEY = (() => {
  const v = [-0.55, 0.5, 0.66];
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
})();

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

const WORLDS = [
  { r: 2.9, tint: 2.66, share: 0.085, oblate: 0.95, bands: 6.5 },
  { r: 2.0, tint: 2.95, share: 0.06, bands: 5, ringed: true },
  { r: 1.25, tint: 2.02, share: 0.033 },
  { r: 0.95, tint: 0.08, share: 0.022, rocky: 0.24 },
];

const CORE = { r: 0.6, depth: 26, scale: 1.9 };

const MOONS = [
  { planet: 0, d: 3.6, r: 0.3, rate: 1.35, dy: 0.25, tint: 0.06 },
  { planet: 0, d: 4.8, r: 0.24, rate: 0.95, dy: -0.3, tint: 0.3 },
  { planet: 1, d: 4.5, r: 0.26, rate: 1.1, dy: 0.2, tint: 0.08 },
  { planet: 2, d: 2.6, r: 0.2, rate: 1.8, dy: 0.15, tint: 0.3 },
];

function sheet(x, z) {
  // Two-part relativistic well, after the classic "black hole vs star"
  // diagram: a graceful outer dish plus a deep near-vertical shaft — walls
  // almost parallel — plunging toward the singularity. Lake swell is animated
  // in the vertex shader (ORBIT sheet branch), not baked here.
  const rad = Math.hypot(x, z);
  const dish = -12.5 / Math.pow(1 + (rad * rad) / (3.6 * 3.6), 0.8);
  const shaft = -21 * Math.exp(-(rad * rad) / (1.4 * 1.4));
  return dish + shaft;
}

const centreOf = (i) => {
  const o = ORBIT_PLANETS[i];
  return [
    Math.cos(o.phase) * o.R,
    sheet(Math.cos(o.phase) * o.R, Math.sin(o.phase) * o.R) - o.depth + WORLDS[i].r * 1.08 + 2.4,
    Math.sin(o.phase) * o.R,
  ];
};

function shell(c, budget, opts) {
  const { centre, radius, stagger, feature, base, tintBase, spin } = opts;
  const oblate = opts.oblate || 1;
  const rocky = opts.rocky || 0;
  const dir = [0, 0, 0];
  const jitter = 1.6 / Math.sqrt(Math.max(16, budget));
  // Shuffle the fibonacci order: written sequentially it sweeps pole-to-pole,
  // and since morph flights map buffer-contiguous particles to contiguous
  // source regions, the planet assembled as latitude slabs sliding together.
  // Shuffled, arrivals build the whole sphere uniformly.
  const order = new Array(budget);
  for (let i = 0; i < budget; i++) order[i] = i;
  for (let i = budget - 1; i > 0; i--) {
    const j = Math.floor(c.rng.unit() * (i + 1));
    const t = order[i];
    order[i] = order[j];
    order[j] = t;
  }
  for (let i = 0; i < budget; i++) {
    fibonacciDirection(order[i], budget, dir);
    const d = norm([
      dir[0] + c.rng.bell() * jitter,
      dir[1] + c.rng.bell() * jitter,
      dir[2] + c.rng.bell() * jitter,
    ]);
    const f = feature ? feature(d) : 1;
    const L = opts.lightDir;
    const s = Math.max(0, dot(d, L || KEY) * 0.5 + 0.5);
    const lit = L ? 0.16 + 0.84 * Math.pow(s, 2.4) : 0.42 + 0.58 * s;
    let rad = radius;
    let ax = 1;
    let ay = oblate;
    if (rocky) {
      rad *= 1 + rocky * (
        0.55 * Math.sin(d[0] * 3.2 + 1.7) * Math.sin(d[1] * 2.6 - 0.4) +
        0.45 * Math.sin(d[1] * 4.1 + 2.2) * Math.sin(d[2] * 3.4 + 0.8) +
        0.3 * Math.sin(d[2] * 5.3 - 1.1) * Math.sin(d[0] * 4.7 + 2.9));
      ax = 1.28;
      ay = 0.82;
    }
    c.write(
      centre[0] + d[0] * rad * ax,
      centre[1] + d[1] * rad * ay,
      centre[2] + d[2] * rad,
      base * f * lit * c.rng.range(0.92, 1.08),
      tintBase,
      stagger + c.rng.range(0, 0.012),
      spin,
      1
    );
  }
}

export const planetary = {
  seed: 0x5505,
  touch: { mode: 3, radius: 4, strength: 4.6 },
  mode: MODE.ORBIT,
  pivot: [0, 0, 0],
  build(c) {
    const [gridShare, funnelShare, coreShare, planetShare,
      ringShare, moonShare, atmoShare, debrisShare, fieldShare] =
      c.split([0.25, 0.055, 0.05, 0.12, 0.05, 0.03, 0.014, 0.022, 0.409]);

    const EXTENT_X = 52;
    const EXTENT_Z = 44;
    const STEP = 2.8;
    const lines = [];
    for (let x = -EXTENT_X; x <= EXTENT_X + 0.01; x += STEP) lines.push({ axis: 0, at: x });
    for (let z = -EXTENT_Z; z <= EXTENT_Z + 0.01; z += STEP) lines.push({ axis: 1, at: z });
    const perLine = Math.max(60, Math.floor(gridShare / lines.length));
    lines.forEach((line, index) => {
      const span = line.axis === 0 ? EXTENT_Z : EXTENT_X;
      const major = index % 3 === 0;
      // Concentrate samples where the line dives into the well: uniform
      // spacing undersamples the steep throat and reads as jagged steps.
      const pull = 1 / (1 + (line.at * line.at) / 58);
      const K = 7.5;
      const half = Math.atan(span / K);
      for (let i = 0; i < perLine; i++) {
        const t = (i + 0.5) / perLine;
        const lin = -span + 2 * span * t;
        const warped = K * Math.tan((t - 0.5) * 2 * half);
        const u = lin * (1 - pull) + warped * pull;
        const x = line.axis === 0 ? line.at : u;
        const z = line.axis === 0 ? u : line.at;
        const y = sheet(x, z);
        const rad = Math.hypot(x, z);
        let band = 0;
        for (let w = 0; w < WORLDS.length; w++) {
          const g = (rad - ORBIT_PLANETS[w].R) / (ORBIT_PLANETS[w].width * 0.9);
          band += Math.exp(-g * g) * ORBIT_PLANETS[w].depth * 0.3;
        }
        const dip = Math.min(1, -y / 7.5 + band);
        const dark = 0.3 + 0.7 * Math.min(1, Math.max(0, (rad - 0.9) / 1.4));
        const edge = Math.max(0, 1 - Math.pow(Math.hypot(x / (EXTENT_X + 3), z / (EXTENT_Z + 3)), 2.6));
        if (edge <= 0.01) continue;
        c.write(
          x,
          y + c.rng.bell() * 0.02,
          z,
          (0.24 + dip * 0.5) * (major ? 1.28 : 1) * edge * dark * c.rng.range(0.88, 1.12),
          (0.3 + dip * 0.6) * dark,
          0.02 + (index / lines.length) * 0.22,
          -1,
          1
        );
      }
    });

    const coreCentre = [0, sheet(0, 0) - 0.15, 0];
    // A bare ring singularity: one crisp luminous annulus, nothing inside it.
    const RING_R = 0.42;
    const anchorN = 14;
    for (let i = 0; i < coreShare; i++) {
      const anchor = i < anchorN;
      const a = anchor ? (i / anchorN) * TAU : c.rng.unit() * TAU;
      const rr = RING_R + c.rng.bell() * 0.022;
      c.write(
        Math.cos(a) * rr,
        coreCentre[1] + 0.2 + c.rng.bell() * 0.02,
        Math.sin(a) * rr,
        anchor ? c.rng.range(0.34, 0.44) : c.rng.range(0.15, 0.26),
        2.74,
        0.05 + c.rng.range(0, 0.03),
        2.4,
        1
      );
    }

    const FUNNELS = 10;
    const threadBudget = Math.floor(funnelShare * 0.45);
    const perFunnel = Math.floor(threadBudget / FUNNELS);
    for (let f = 0; f < FUNNELS; f++) {
      const a = (f / FUNNELS) * TAU + 0.21;
      for (let i = 0; i < perFunnel; i++) {
        const t = (i + 0.5) / perFunnel;
        // threads live only in the shaft — the sheet's own grid shows the
        // upper warp; the funnel drape starts where the plunge begins
        const r = 0.35 + (2.6 - 0.35) * Math.pow(1 - t, 1.2);
        const y = sheet(r, 0);
        const dip = Math.min(1, -y / 9);
        const dark = 0.45 + 0.55 * Math.min(1, Math.max(0, (r - 0.6) / 1.6));
        c.write(
          Math.cos(a) * r + c.rng.bell() * 0.02,
          y + c.rng.bell() * 0.03,
          Math.sin(a) * r + c.rng.bell() * 0.02,
          c.rng.range(0.22, 0.34) * (0.5 + dip * 0.8) * dark,
          (0.3 + dip * 0.55) * dark,
          0.05 + t * 0.05,
          -1,
          1
        );
      }
    }
    const RING_COUNT = 10;
    const ringBudget = funnelShare - threadBudget;
    const ringWeights = [];
    let ringWeightSum = 0;
    for (let k = 0; k < RING_COUNT; k++) {
      const rr = 0.5 + (2.8 - 0.5) * Math.pow(k / (RING_COUNT - 1), 1.25);
      ringWeights.push(rr);
      ringWeightSum += rr;
    }
    ringWeights.forEach((rr, k) => {
      const n = Math.floor(ringBudget * rr / ringWeightSum);
      const y = sheet(rr, 0);
      const dip = Math.min(1, -y / 9);
      const dark = 0.45 + 0.55 * Math.min(1, Math.max(0, (rr - 0.6) / 1.6));
      for (let i = 0; i < n; i++) {
        const a = (i + 0.5) / n * TAU + k * 0.37;
        c.write(
          Math.cos(a) * rr + c.rng.bell() * 0.02,
          y + c.rng.bell() * 0.03,
          Math.sin(a) * rr + c.rng.bell() * 0.02,
          c.rng.range(0.2, 0.34) * (0.45 + dip * 0.8) * dark,
          (0.28 + dip * 0.55) * dark,
          0.05 + (k / RING_COUNT) * 0.05,
          -1,
          1
        );
      }
    });

    const shareSum = WORLDS.reduce((a, w) => a + w.share, 0);
    WORLDS.forEach((world, index) => {
      const budget = Math.floor(planetShare * world.share / shareSum);
      const rate = ORBIT_PLANETS[index].rate;
      const centre = centreOf(index);
      shell(c, budget, {
        centre,
        radius: world.r * 0.85,
        oblate: world.oblate || 1,
        lightDir: norm([-centre[0], -centre[1] * 0.3, -centre[2]]),
        stagger: 0.3 + index * 0.06,
        base: 0.72 + world.r * 0.03,
        tintBase: world.tint,
        spin: rate,
        rocky: world.rocky,
        feature: world.bands
          ? (d) => 0.84 + 0.3 * (Math.sin(d[1] * world.bands) * 0.5 + 0.5)
          : undefined,
      });
    });

    const RINGED = 1;
    const ringWorld = WORLDS[RINGED];
    const ringCentre = centreOf(RINGED);
    const BANDS = [
      { a: 1.3, b: 1.55, lum: 0.6 },
      { a: 1.63, b: 1.92, lum: 1.0 },
      { a: 2.0, b: 2.18, lum: 0.45 },
    ];
    const weights = BANDS.map((b) => (b.b * b.b - b.a * b.a) * b.lum);
    const wSum = weights.reduce((a, b) => a + b, 0);
    BANDS.forEach((band, index) => {
      const n = Math.floor(ringShare * weights[index] / wSum);
      for (let i = 0; i < n; i++) {
        const t = c.rng.unit();
        const rr = ringWorld.r * Math.sqrt(band.a * band.a + t * (band.b * band.b - band.a * band.a));
        const a = i * GOLDEN_ANGLE + c.rng.range(-0.02, 0.02);
        const fine = 0.65 + 0.5 * (Math.sin((rr / ringWorld.r) * 62) * 0.5 + 0.5);
        const kepler = 1.6 * Math.pow(ringWorld.r * 1.3 / rr, 1.5);
        c.write(
          ringCentre[0] + Math.cos(a) * rr,
          ringCentre[1] + c.rng.bell() * 0.03,
          ringCentre[2] + Math.sin(a) * rr,
          c.rng.range(0.24, 0.42) * band.lum * fine,
          c.rng.range(2.62, 2.8),
          0.5 + index * 0.03 + t * 0.04,
          orbitSatelliteSpin(RINGED, kepler),
          1
        );
      }
    });

    const perMoon = Math.max(24, Math.floor(moonShare / MOONS.length));
    MOONS.forEach((moon, index) => {
      const parent = centreOf(moon.planet);
      const a0 = index * 2.4 + 0.7;
      const moonCentre = [
        parent[0] + Math.cos(a0) * moon.d,
        parent[1] + moon.dy,
        parent[2] + Math.sin(a0) * moon.d,
      ];
      shell(c, perMoon, {
        centre: moonCentre,
        radius: moon.r * 0.85,
        lightDir: norm([-moonCentre[0], -moonCentre[1] * 0.3, -moonCentre[2]]),
        stagger: 0.33 + moon.planet * 0.06,
        base: 0.78,
        tintBase: moon.tint,
        spin: orbitSatelliteSpin(moon.planet, moon.rate),
      });
    });

    const atmo = [0, 1];
    const perAtmo = Math.max(40, Math.floor(atmoShare / atmo.length));
    const dir = [0, 0, 0];
    atmo.forEach((index, order) => {
      const centre = centreOf(index);
      const world = WORLDS[index];
      const jitter = 1.6 / Math.sqrt(perAtmo);
      for (let i = 0; i < perAtmo; i++) {
        fibonacciDirection(i, perAtmo, dir);
        const d = norm([
          dir[0] + c.rng.bell() * jitter,
          dir[1] + c.rng.bell() * jitter,
          dir[2] + c.rng.bell() * jitter,
        ]);
        const r = world.r * 1.06;
        c.write(
          centre[0] + d[0] * r,
          centre[1] + d[1] * r * (world.oblate || 1),
          centre[2] + d[2] * r,
          c.rng.range(0.14, 0.28),
          c.rng.range(0.6, 1),
          0.8 + order * 0.02,
          ORBIT_PLANETS[index].rate,
          1
        );
      }
    });

    {
      const AST = 3;
      const o = ORBIT_PLANETS[AST];
      const baseY = centreOf(AST)[1];
      for (let i = 0; i < debrisShare; i++) {
        const span = Math.pow(c.rng.unit(), 2.2) * 0.8;
        const ang = o.phase + 0.008 + span;
        const fade = Math.pow(1 - span / 0.8, 1.25);
        const width = 0.06 + fade * 0.42;
        const rr = o.R + c.rng.bell() * width;
        const chunk = i % 23 === 0;
        c.write(
          Math.cos(ang) * rr,
          baseY + c.rng.bell() * width * 0.8,
          Math.sin(ang) * rr,
          (chunk ? c.rng.range(0.3, 0.44) : c.rng.range(0.1, 0.26)) * (0.18 + fade * 0.95),
          0.08,
          0.9 + span * 0.04,
          o.rate,
          chunk ? 0.9 : 0.55
        );
      }
    }

    for (let i = 0; i < fieldShare; i++) {
      // starfield: every particle in the shell is spent where the camera can
      // see it — 72% of the sky sits above the sheet, only a thin scatter
      // below for scroll parallax.
      const star = i % 3 === 0;
      const r = 34 + 46 * Math.pow(c.rng.unit(), 0.7);
      const upper = c.rng.unit() < 0.72;
      const cosPhi = (upper ? 1 : -1) * Math.abs(c.rng.signed());
      const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
      const theta = c.rng.unit() * TAU;
      c.write(
        r * sinPhi * Math.cos(theta),
        r * cosPhi * 0.72 + 4,
        r * sinPhi * Math.sin(theta),
        star ? c.rng.range(0.34, 0.58) : c.rng.range(0.16, 0.34),
        c.rng.range(0, 0.22),
        0.9 + c.rng.range(0, 0.1),
        0,
        0
      );
    }
  },
};
