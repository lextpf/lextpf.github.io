
import { fibonacciDirection } from '../lib/random.js';
import { slotRanks, fpsOrder, progressiveGrid } from '../lib/sampling.js';

/* ==========================================================================
   ATOM KIT

   The parts the nucleus is built from: lit beads (nucleons, electron heads),
   clusters of them, the soft cloud around an atom, electron comets and their
   orbit traces. Shared with the unregistered reactants.js, so every option a
   caller does not pass keeps its old meaning.

   Every structure here is placed so that a ladder cut keeps an even subset
   of it (lib/sampling.js): a bead takes the farthest-point order of its
   Fibonacci lattice by slot rank, and the 1D parts (comet tails, orbit arcs)
   the progressive grid. The shuffle and the slot every write lands in are
   untouched; only where each write is placed changes.
   ========================================================================== */

// The fixed key-light direction every lit body in this kit shades against. One
// shared vector, so separately-built atoms all appear lit from the same place.
export const KEY_N = (() => {
  const l = Math.hypot(-0.5, 0.8, 0.45);
  return [-0.5 / l, 0.8 / l, 0.45 / l];
})();
export const norm3 = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
export const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
// Two axes perpendicular to `ax`, for drawing a ring around it. Same degenerate
// case sculpt.js:frame guards: a reference vector parallel to the axis gives a
// zero cross product, so switch reference when the axis is near vertical.
export const basisFor = (ax) => {
  const pick = Math.abs(ax[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = norm3(cross3(pick, ax));
  const v = cross3(ax, u);
  return { u, v };
};

/* The key-light density of a bead: w(h) = (0.3 + 0.7 max(0, h))^1.5 per unit
   of area, h = d . KEY_N the height of a surface point toward the key. The
   unlit hemisphere keeps a flat 0.164 of the lit pole's density, the lit one
   rises to 1 at the pole, so about 77% of a bead's points face the key.

   A sphere's area is uniform in h (Archimedes' hat-box), so a uniform point
   at height y0 moves to the h whose share of w below it equals the uniform
   share, (1 + y0) / 2: keyHeight() is that inverse, in closed form. It keeps
   the azimuth, and it is monotonic, so it carries an evenly spread set to an
   evenly spread set under the new density. */
const W_DARK = Math.pow(0.3, 1.5);
const W_EDGE = Math.pow(0.3, 2.5);
const W_TOTAL = W_DARK + (1 - W_EDGE) / 1.75;
function keyHeight(u) {
  const t = u * W_TOTAL;
  if (t <= W_DARK) return t / W_DARK - 1;
  return (Math.pow((t - W_DARK) * 1.75 + W_EDGE, 0.4) - 0.3) / 0.7;
}
const KEY_BASIS = basisFor(KEY_N);

/* A shaded sphere: a lit bead with a terminator.

   A write of slot rank r (past the glints, below) takes lattice point
   fps[r - glints] of the Fibonacci lattice of the other points (fpsOrder:
   farthest-point order, so every prefix covers the sphere like a smaller
   lattice and every ladder cut keeps an even bead), then the lattice pole is
   turned onto the key and each height remapped by keyHeight(), so the
   points crowd onto the lit side with an exact count. Warping after the
   ordering keeps every cut's prefix on the warped density: at the 37k rung
   the largest hole in a bead is 0.91-0.94 of the ideal spacing on the
   median bead (a random subset, as before, 1.18-1.40).

   A uniform shell reads as a bubble: seen through, its points pile up where
   the surface turns edge-on, and every bead becomes a bright ring. Here the
   light sits where the key lands, so a bead reads as a lit ball with a
   shaded side and a terminator between them.

   Each point is also brightened (size) by how squarely it faces the key.
   The `glints` lowest ranks, the ones every cut keeps, are the bright
   points: a tight cluster at the key. On a bead they are its specular
   highlight, white whatever the bead's colour, since a highlight is the
   colour of the light; on an electron head (`head`) they are the electron
   itself and keep its colour. */
export function litBall(c, centre, radius, n, opts) {
  const slots = c.ahead(n);
  const m = slots.length;
  if (!m) return;
  const rank = slotRanks(slots);
  const glints = Math.min(m, opts.glints ?? 2);
  // The lattice holds the other m - glints points, rank r taking lattice rank
  // r - glints, so the glints never leave a lattice point empty (the
  // farthest-point order's second point is the pole opposite the key).
  const n0 = m - glints;
  const lattice = n0 > 0 ? fpsOrder(n0) : null;
  const head = !!opts.head;
  const jw = head ? 0.12 : 0.16;
  const glintTint = head ? opts.tint(1) : Math.min(0.1, opts.tint(1));
  // Seen whole, an exact Fibonacci lattice shows its spiral arms, and the
  // warp gathers them at the lit pole into a sunflower. A nudge of about a
  // fifth of the lattice spacing, in the uniform lattice before the warp (so
  // it scales with the local spacing after it), leaves an even stipple. More
  // (the old 1.7) looks the same and opens the largest hole of a 37k cut
  // further.
  const jit = 1.2 / Math.sqrt(Math.max(head ? 9 : 16, n0));
  // Scalars throughout: a nucleus bakes about 60,000 of these points, and a
  // small array per point was a measurable share of the bake.
  const [k0, k1, k2] = KEY_N;
  const [a0, a1, a2] = KEY_BASIS.u;
  const [b0, b1, b2] = KEY_BASIS.v;
  const dir = [0, 0, 0];
  for (let j = 0; j < m; j++) {
    const r = rank[j];
    const glint = r < glints;
    let dx, dy, dz;
    if (glint) {
      dx = k0 + c.rng.bell() * jw;
      dy = k1 + c.rng.bell() * jw;
      dz = k2 + c.rng.bell() * jw;
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      dx /= l;
      dy /= l;
      dz /= l;
    } else {
      fibonacciDirection(lattice[r - glints], n0, dir);
      let qx = dir[0] + c.rng.bell() * jit;
      let qy = dir[1] + c.rng.bell() * jit;
      let qz = dir[2] + c.rng.bell() * jit;
      const lq = Math.sqrt(qx * qx + qy * qy + qz * qz) || 1;
      qx /= lq;
      qy /= lq;
      qz /= lq;
      const h = keyHeight(0.5 * (1 + qy));
      const s = Math.sqrt(Math.max(0, 1 - h * h)) / (Math.sqrt(qx * qx + qz * qz) || 1);
      dx = k0 * h + (a0 * qx + b0 * qz) * s;
      dy = k1 * h + (a1 * qx + b1 * qz) * s;
      dz = k2 * h + (a2 * qx + b2 * qz) * s;
    }
    const s = Math.max(0, dx * k0 + dy * k1 + dz * k2);
    const lit = (head ? 0.3 : 0.22) + (head ? 0.7 : 0.78) * Math.pow(s, head ? 1.6 : 1.9);
    c.write(
      centre[0] + dx * radius, centre[1] + dy * radius, centre[2] + dz * radius,
      glint
        ? (head ? c.rng.range(0.85, 1.0) : c.rng.range(0.7, 0.9))
        : (head ? c.rng.range(0.12, 0.2) * (0.45 + lit) : c.rng.range(0.2, 0.32) * (0.55 + lit)),
      glint ? glintTint : opts.tint(lit),
      opts.stag + c.rng.range(0, 0.03),
      opts.spin,
      1
    );
  }
}

/* A nucleus: a central bead and shells of beads around it, protons and
   neutrons alternating. `layers` is [[count, radius], ...]; each shell is a
   Fibonacci lattice of bead centres, nudged by `jitter` (default 0.26) so it
   does not read as a lattice. The share is split evenly over the beads. */
export function nucleonCluster(c, centre, share, layers, opts) {
  const centres = [[...centre]];
  const tmp = [0, 0, 0];
  const jit = opts.jitter ?? 0.26;
  layers.forEach(([count, R]) => {
    for (let i = 0; i < count; i++) {
      fibonacciDirection(i, count, tmp);
      centres.push([
        centre[0] + tmp[0] * R + c.rng.bell() * jit,
        centre[1] + tmp[1] * R + c.rng.bell() * jit,
        centre[2] + tmp[2] * R + c.rng.bell() * jit,
      ]);
    }
  });
  const per = Math.floor(share / centres.length);
  centres.forEach((cen, index) => {
    const proton = index % 2 === 0;
    const hot = opts.hotEvery ? index % opts.hotEvery === 3 : false;
    litBall(c, cen, opts.ballR ?? 0.52, per, {
      spin: opts.spin,
      stag: opts.stag + (index === 0 ? 0 : 0.03),
      tint: (lit) => (hot ? 2.55 + lit * 0.3 : proton ? Math.min(1, 0.5 + lit * 0.4) : 0.06 + lit * 0.14),
    });
  });
}

export function shellDust(c, centre, radii, weights, share, opts) {
  const tmp = [0, 0, 0];
  radii.forEach((R, s) => {
    const n = Math.floor(share * weights[s]);
    for (let i = 0; i < n; i++) {
      fibonacciDirection((i * 11 + 5) % n, n, tmp);
      const r = R + c.rng.bell() * 0.3;
      const retro = c.rng.chance(0.3) ? -1 : 1;
      let px = centre[0] + tmp[0] * r + c.rng.bell() * 0.35;
      let py = centre[1] + tmp[1] * r + c.rng.bell() * 0.35;
      let pz = centre[2] + tmp[2] * r + c.rng.bell() * 0.35;
      if (opts.pull && s === radii.length - 1) {
        const dp = Math.max(0, tmp[0] * opts.pull.dir[0] + tmp[1] * opts.pull.dir[1] + tmp[2] * opts.pull.dir[2]);
        const g = dp * dp * opts.pull.k;
        px += opts.pull.dir[0] * g;
        py += opts.pull.dir[1] * g;
        pz += opts.pull.dir[2] * g;
      }
      c.write(
        px, py, pz,
        c.rng.range(0.09, 0.19) * (s === 0 ? 1.15 : 1),
        c.rng.range(0.2, 0.55),
        opts.stag0 + s * 0.16 + c.rng.range(0, 0.1),
        opts.orbital ? 0.35 * c.rng.range(0.35, 0.95) * retro : opts.spin,
        0.3
      );
    }
  });
}

/* An electron on its orbit: a lit head, a spray trailing it, and a thin arc
   tracing the orbit further back, fading.

   The tail and the arc are 1D: each is placed on the progressive grid, so a
   ladder cut keeps them continuous. The tail's spray stays (it is a wake);
   the arc sits on the orbit itself, scattered only across it, radially and
   along the ring's axis, never along it, so it reads as a drawn path. */
export function electronComet(c, def, nHeadTail, nArc, tintScale) {
  const { centre, u, v, R, a0, spin, stag } = def;
  const dir = def.dir ?? 1;
  const w = cross3(u, v);
  const circle = (a, rr) => [
    centre[0] + (u[0] * Math.cos(a) + v[0] * Math.sin(a)) * rr,
    centre[1] + (u[1] * Math.cos(a) + v[1] * Math.sin(a)) * rr,
    centre[2] + (u[2] * Math.cos(a) + v[2] * Math.sin(a)) * rr,
  ];
  const nHead = Math.floor(nHeadTail * 0.26);
  litBall(c, circle(a0, R), 0.16, nHead, {
    head: true, glints: 3, spin, stag,
    tint: (lit) => (tintScale ? tintScale(Math.min(1, 0.55 + lit * 0.45)) : Math.min(1, 0.55 + lit * 0.45)),
  });
  const nTail = nHeadTail - nHead;
  const gt = progressiveGrid(c.ahead(nTail));
  for (let i = 0; i < gt.length; i++) {
    const t = Math.pow((gt[i] + 0.5) / nTail, 0.7);
    const back = 0.02 + t * 0.8;
    const fray = 0.03 + (1 - t) * 0.16;
    const p = circle(a0 - back * dir, R + c.rng.bell() * fray);
    c.write(
      p[0] + c.rng.bell() * fray, p[1] + c.rng.bell() * fray, p[2] + c.rng.bell() * fray,
      (0.38 - t * 0.33) * c.rng.range(0.8, 1.15),
      (tintScale ? tintScale(c.rng.range(0.4, 0.65) * (1 - t * 0.4)) : c.rng.range(0.4, 0.65) * (1 - t * 0.4)),
      stag + t * 0.04,
      spin,
      0.95
    );
  }
  const ga = progressiveGrid(c.ahead(nArc));
  for (let i = 0; i < ga.length; i++) {
    const t = (ga[i] + 0.5) / nArc;
    const back = 0.5 + t * 1.9;
    const fade = 1 - t;
    const across = c.rng.bell() * 0.022;
    const p = circle(a0 - back * dir, R + c.rng.bell() * 0.022);
    c.write(
      p[0] + w[0] * across, p[1] + w[1] * across, p[2] + w[2] * across,
      c.rng.range(0.07, 0.13) * (0.4 + 0.6 * fade),
      c.rng.range(0.3, 0.55) * (0.5 + 0.5 * fade),
      stag - 0.06 + c.rng.range(0, 0.04),
      spin,
      0.95
    );
  }
}

export function fieldDust(c, share) {
  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < share; i++) {
    const r = 26 + 38 * Math.pow(c.rng.unit(), 0.78);
    const theta = i * GOLDEN_ANGLE;
    const cosPhi = c.rng.signed();
    const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
    c.write(
      r * sinPhi * Math.cos(theta), r * cosPhi * 0.47, r * sinPhi * Math.sin(theta),
      c.rng.range(0.14, 0.36), c.rng.range(0, 0.12), 0.88 + c.rng.range(0, 0.12), 0.004, 0
    );
  }
}
