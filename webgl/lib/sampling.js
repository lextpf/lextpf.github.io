
import { fibonacciDirection } from './random.js';

/* ==========================================================================
   CUT-TRUE PLACEMENT

   The quality ladder cuts particles by drawing only the first N slots of the
   buffers (particle-system.js setActiveCount), and the registry writes every
   formation through one seeded shuffle: write j of a structure lands in slot
   order[cursor + j], and it survives a cut to N exactly when that slot is
   below N. Placed in generator order, a structure loses a random subset at
   every cut, so evenly spaced points turn dash-dot: along a crystal ridge the
   largest gap at 37k was five to eight times the mean spacing.

   Nothing here touches the shuffle or the slot a write lands in. These tools
   only change WHERE each write is placed. A generator asks the registry which
   slots its next n writes will take (ctx.ahead(n)) and ranks them: rank 0 is
   the lowest slot, the one every cut keeps, and a cut to N keeps exactly the
   lowest ranks. Write j then takes the point of rank rank[j] from a sequence
   whose every prefix is itself evenly spread, so a cut keeps what a smaller
   bake would have drawn, and the full set is still the full, even structure.

     slotRanks        the rank of each write's slot among the structure's slots
     progressiveGrid  1D structures (edges, rings, filaments, arcs, lines): the
                      n writes fill an n-point grid exactly, and every prefix
                      is a golden-ratio subset of it
     fpsOrder         spheres and beads: the farthest-point order of the
                      n-point Fibonacci lattice, so every prefix covers the
                      sphere like a smaller lattice
     rd, r2, byRank   2D and 3D sets, masked or density-weighted: Roberts
                      low-discrepancy candidates, accepted in order and handed
                      out by rank, so every cut keeps a low-discrepancy prefix
     jittered         2D and 3D fills that turn or flow (discs, bands, haze):
                      the Roberts sequence by rank, each point jittered by a
                      share of its prefix's spacing, so no lattice rows show
                      when the fill shears; hash01 is its fixed hash
     roundRobin       discrete features (vertex nodes, lattice dots): feature
                      rank mod k, so every feature keeps particles for as long
                      as the cut keeps k of the writes
     backdrop         screen-uniform dust inside a chapter camera's frustum,
                      authored so the formation's own motion leaves it there,
                      jittered off the R2 lattice, and optionally kept out of
                      other cameras' frames (a layer for one framing only)

   Usage rule: a structure of n points written consecutively reads its slots
   first, `const g = progressiveGrid(c.ahead(n))`, and places write j at
   t = (g[j] + 0.5) / n. A structure written interleaved with another (an
   i % k loop over rings or arms) has to be restructured to write each one
   consecutively before any of this applies.

   Pure math: no DOM, no three, importable from Node (the content test bakes
   every formation there). Permutations that depend only on n are cached per
   n, so a bake pays for each distinct size once.
   ========================================================================== */

// The indices 0..n-1 in ascending order of key[i]. A bucket sort: every key
// ranked here is spread evenly over its range (the slots of a seeded shuffle,
// the golden-ratio sequence), so n buckets hold about one key each and the
// pass is linear. A bake ranks every structure it places, and a comparison
// sort per structure cost more than the placing did.
function ascending(key, n) {
  const idx = new Int32Array(n);
  if (n === 0) return idx;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const k = key[i];
    if (k < lo) lo = k;
    if (k > hi) hi = k;
  }
  const scale = hi > lo ? (n - 1e-9) / (hi - lo) : 0;
  const start = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) start[((key[i] - lo) * scale) | 0]++;
  for (let b = 0, acc = 0; b <= n; b++) {
    const c = start[b];
    start[b] = acc;
    acc += c;
  }
  const fill = start.slice(0, n);
  for (let i = 0; i < n; i++) idx[fill[((key[i] - lo) * scale) | 0]++] = i;
  // Insertion sort inside each bucket; the buckets are tiny.
  for (let b = 0; b < n; b++) {
    const s0 = start[b], s1 = start[b + 1];
    for (let i = s0 + 1; i < s1; i++) {
      const x = idx[i], v = key[x];
      let k = i - 1;
      while (k >= s0 && key[idx[k]] > v) {
        idx[k + 1] = idx[k];
        k--;
      }
      idx[k + 1] = x;
    }
  }
  return idx;
}

// rank[j] = the rank of write j's slot among the n slots the structure takes,
// 0 for the lowest. A cut to N keeps exactly the writes whose slot is below N,
// and those are the lowest ranks.
export function slotRanks(slots) {
  const n = slots.length;
  const idx = ascending(slots, n);
  const rank = new Int32Array(n);
  for (let r = 0; r < n; r++) rank[idx[r]] = r;
  return rank;
}

const PHI_INV = 0.6180339887498949;
const GRID = new Map();

// P[r] = the rank of frac(r / phi) among r = 0..n-1. The whole permutation is
// a perfect n-point grid; its first m entries are the golden-ratio (Kronecker)
// sequence quantised onto that grid, whose gaps take at most three values at
// any m (the three-gap theorem), so no prefix ever opens a hole.
function goldenGrid(n) {
  let P = GRID.get(n);
  if (P) return P;
  const key = new Float64Array(n);
  for (let r = 0; r < n; r++) key[r] = (r * PHI_INV) % 1;
  const idx = ascending(key, n);
  P = new Int32Array(n);
  for (let g = 0; g < n; g++) P[idx[g]] = g;
  GRID.set(n, P);
  return P;
}

// The grid index of every write of a 1D structure: write j goes to
// t = (g[j] + 0.5) / n. All n writes together take every index exactly once.
export function progressiveGrid(slots) {
  const n = slots.length;
  const rank = slotRanks(slots);
  const P = goldenGrid(n);
  const g = new Int32Array(n);
  for (let j = 0; j < n; j++) g[j] = P[rank[j]];
  return g;
}

const FPS = new Map();

// The n-point Fibonacci lattice (random.js fibonacciDirection) in
// farthest-point order: start at lattice point 0, then always take the point
// farthest from everything taken so far. O(n^2) (about 18 ms at n = 875 in
// Node), once per distinct n. Write j of a sphere goes to the lattice point
// fps[rank[j]]; rotate or warp the sphere after that lookup, so every prefix
// follows the warped density. A golden-ratio subset of the lattice indices is
// no better than a random one at a cut; this is.
export function fpsOrder(n) {
  let order = FPS.get(n);
  if (order) return order;
  const xs = new Float64Array(n), ys = new Float64Array(n), zs = new Float64Array(n);
  const d = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    fibonacciDirection(i, n, d);
    xs[i] = d[0];
    ys[i] = d[1];
    zs[i] = d[2];
  }
  order = new Int32Array(n);
  const near = new Float64Array(n).fill(Infinity);
  const taken = new Uint8Array(n);
  let pick = 0;
  for (let k = 0; k < n; k++) {
    order[k] = pick;
    taken[pick] = 1;
    const px = xs[pick], py = ys[pick], pz = zs[pick];
    let best = -1, bestD = -1;
    for (let i = 0; i < n; i++) {
      if (taken[i]) continue;
      const dx = xs[i] - px, dy = ys[i] - py, dz = zs[i] - pz;
      const q = dx * dx + dy * dy + dz * dz;
      if (q < near[i]) near[i] = q;
      if (near[i] > bestD) {
        bestD = near[i];
        best = i;
      }
    }
    pick = best;
  }
  FPS.set(n, order);
  return order;
}

// Roberts' generalised golden ratios: g is the positive root of
// x^(d+1) = x + 1 (phi for d = 1, the plastic number for d = 2), and the d
// generators are 1 / g^i.
const ALPHA = new Map();
function alphas(d) {
  let a = ALPHA.get(d);
  if (a) return a;
  let g = 2;
  for (let i = 0; i < 40; i++) g = Math.pow(1 + g, 1 / (d + 1));
  a = new Float64Array(d);
  for (let i = 0; i < d; i++) a[i] = 1 / Math.pow(g, i + 1);
  ALPHA.set(d, a);
  return a;
}

// The k-th point of the d-dimensional Roberts sequence in [0, 1)^d (R2 for
// d = 2). Evenly spread at every prefix, and cheaper than any relaxation,
// which is what a bake needs.
export function rd(k, d, out = new Float64Array(d)) {
  const a = alphas(d);
  for (let i = 0; i < d; i++) out[i] = (0.5 + a[i] * k) % 1;
  return out;
}
export const r2 = (k, out = new Float64Array(2)) => rd(k, 2, out);

// Low-discrepancy points for a structure, handed out by rank. Walks the
// d-dimensional Roberts sequence, keeps the candidates `accept(u)` passes (a
// mask, or a density test against a coordinate of its own), stops at exactly
// as many as there are slots, and gives write j the accepted point of rank
// rank[j], so every cut keeps a low-discrepancy prefix of the set. Returns a
// Float64Array of n * d coordinates in [0, 1), write-major.
export function byRank(slots, d, accept = null) {
  const n = slots.length;
  const rank = slotRanks(slots);
  const got = new Float64Array(n * d);
  const u = new Float64Array(d);
  const limit = 256 * n + 4096;
  let m = 0;
  for (let k = 0; m < n; k++) {
    if (k > limit) throw new Error('[universe] sampling: the accepted region is too small');
    rd(k, d, u);
    if (accept && !accept(u)) continue;
    for (let i = 0; i < d; i++) got[m * d + i] = u[i];
    m++;
  }
  const out = new Float64Array(n * d);
  for (let j = 0; j < n; j++) {
    const r = rank[j];
    for (let i = 0; i < d; i++) out[j * d + i] = got[r * d + i];
  }
  return out;
}

// A uniform number in [0, 1) from an integer: a fixed hash, so a jitter, a
// thinning or a coin is the same at every bake and uncorrelated with the R2
// and golden-ratio steps.
export function hash01(k) {
  let t = (k + 0x9e3779b9) | 0;
  t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
  t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
  return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
}

/* n points of the unit d-cube (d = 2 or 3) by slot rank: Roberts' sequence,
   each candidate jittered by up to half of `jitter` times the spacing of the
   prefix that first holds it (reflected at the faces). The set keeps the
   sequence's evenness without its lattice rows, which a differentially
   turning disc would shear into streaks, and a cut keeps an even prefix.
   Write j takes the candidate of its rank; `salt` picks the jitter, so two
   fills of one formation do not share it. Returns { p, rank }: n * d
   coordinates, write-major, and the ranks. (The galaxy, the tunnel and both
   holes fill with it.) */
export function jittered(slots, d, jitter, salt) {
  const n = slots.length;
  const rank = slotRanks(slots);
  // Roberts' generators alpha_i, recovered from the sequence's point 1
  // (rd: point k is (0.5 + alpha_i k) mod 1) rather than read from alphas():
  // the two can differ in the last bit, and this is how every fill that uses
  // it was baked.
  const a = rd(1, d);
  for (let i = 0; i < d; i++) a[i] = (a[i] + 0.5) % 1;
  const p = new Float64Array(n * d);
  for (let j = 0; j < n; j++) {
    const k = rank[j];
    const s = jitter / (d === 2 ? Math.sqrt(k + 1) : Math.cbrt(k + 1));
    for (let i = 0; i < d; i++) {
      let v = (0.5 + a[i] * k) % 1 + (hash01(salt + (d + 1) * k + i) - 0.5) * s;
      if (v < 0) v = -v;
      if (v >= 1) v = 2 - v - 1e-9;
      p[j * d + i] = v;
    }
  }
  return { p, rank };
}

// The feature index of every write for k discrete features: rank mod k. Every
// feature keeps particles while the cut keeps at least k of the writes, so a
// small set wants 5 or more particles per feature, and 3 are enough past about
// 200 features, where one missing is invisible. A cut keeping K writes gives
// features 0 .. (K mod k) - 1 one particle more than the rest, so with few
// particles per feature, index the features through an order spread evenly
// over them (codex.js NODE_ORDER), never a row-major one.
export function roundRobin(slots, k) {
  const rank = slotRanks(slots);
  const f = new Int32Array(rank.length);
  for (let j = 0; j < rank.length; j++) f[j] = rank[j] % k;
  return f;
}

// three's Euler 'XYZ' rotation (particle-system.js tiltMatrix), row-major.
function eulerXYZ(t) {
  const a = Math.cos(t.x || 0), b = Math.sin(t.x || 0);
  const c = Math.cos(t.y || 0), d = Math.sin(t.y || 0);
  const e = Math.cos(t.z || 0), f = Math.sin(t.z || 0);
  return [
    c * e, -c * f, d,
    a * f + b * e * d, a * e - b * f * d, -b * c,
    b * f - a * e * d, b * e + a * f * d, a * c,
  ];
}

const norm3 = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
// A camera's view axis and its right and up vectors, the way three's lookAt
// builds them with world Y up.
function frame(cam, tgt) {
  const view = norm3([tgt[0] - cam[0], tgt[1] - cam[1], tgt[2] - cam[2]]);
  const right = norm3(cross3(view, [0, 1, 0]));
  return { view, right, up: cross3(right, view) };
}

/* Screen-uniform dust behind a subject, inside one chapter camera's frustum.

   n writes, placed by rank: R2 across the screen, so every cut is still
   screen-uniform, and the golden-ratio sequence through the view depth
   [d0, d1], composed in the camera frame the way planetary.js composes its
   CAM and TGT. `aspect` is the widest frame it has to fill (2.1 covers every
   common desktop window), and `margin` widens the window by that share of
   each half-extent on every side, for the pointer parallax and the
   formation's own rock. `also` lists other cameras that see the same
   formation (the reduced-motion camera): the window widens, in this camera's
   frame, until it holds each of their frames at both ends of the depth range,
   so none of them shows an empty band. Fog dims the far end, which is meant.

   R2 is a quasi-lattice: a few thousand equally faint points on it read as a
   grid, not a sky. `jitter` moves candidate k by up to half of `jitter` times
   the spacing of the prefix that first holds it (1 / sqrt(k + 1) of the
   window, per axis), so every prefix, and so every cut, is a jittered
   lattice at its own scale. At 0.7 the rows are gone: up close it scatters
   like a random sky, while its counts across the frame vary about half as
   much as a random set's, at the full count and at the 37k cut.

   The position written is the one the formation's mode maps back onto the
   world position W at rest, and the spin keeps it there. Never a rotation
   rate: a slab fitted to a frustum rotates out of it.
     modes 1, 3, 6    tilt^T W, spin 0 (shape() returns tilt * p at spin 0)
     mode 4           tilt^T W, spin = the rock amplitude, at most 0.04, kept
                      for the parallax against the subject
     modes 5, 7, 8    W, spin 0: shape() passes spin 0 through untouched in
                      the orbit and hole modes (no tilt, turn, jet or
                      transport)
     mode 2           none: a flowing tunnel has no static frame

   `taper` thins the outer strips of a wide window instead of filling them:
   [a0, floor] keeps every candidate within a0 half-widths (in units of the
   frame height, like `aspect`) and past that keeps a share falling linearly
   to `floor` at the window's edge, so an ultrawide frame still finds stars
   at its sides without a common one paying for a full-density slab it never
   sees. `avoid` keeps the dust out of other cameras' frames entirely: a
   candidate inside any of their frusta, widened by `reach` world units
   ([x, y]) for their parallax, breath and the dust's own rock, is skipped.
   That is how a layer meant for one framing (a phone's pulled-back camera)
   stays invisible in another (the desktop's). Skipped candidates are
   skipped before ranking, so every cut still keeps a low-discrepancy prefix
   of what is accepted.

   opts: { cam, tgt, fov, aspect, margin, also: [{ cam, tgt, fov, aspect }],
           avoid: [{ cam, tgt, fov, aspect, reach: [x, y] }], taper: [a0, floor],
           jitter, depth: [d0, d1], size: [s0, s1], lean, tint: [t0, t1],
           pulse: [p0, p1], rigidity, mode, tilt, rock }.
   Sizes lean small, s0 + (s1 - s0) u^lean: many faint points and a few
   brighter ones, as a real star field has. */
export function backdrop(c, n, opts) {
  const {
    cam, tgt, fov, aspect = 2.1, margin = 0.03, also = [], depth = [80, 140],
    size = [0.08, 0.2], lean = 1, tint = [0, 0.14], pulse = [0.8, 1],
    rigidity = 0, mode, tilt = null, rock = 0.04, avoid = [], taper = null, jitter = 0,
  } = opts;
  if (mode === 2) throw new Error('[universe] backdrop: a flowing tunnel has no static frame');
  const slots = c.ahead(n);
  const m = slots.length;
  const rank = slotRanks(slots);
  const { view, right, up } = frame(cam, tgt);
  const ty = Math.tan((fov * Math.PI) / 360);
  let x0 = -ty * aspect, x1 = ty * aspect, y0 = -ty, y1 = ty;
  for (const o of also) {
    const of = frame(o.cam, o.tgt);
    const ot = Math.tan((o.fov * Math.PI) / 360);
    const oa = o.aspect || aspect;
    const off = [o.cam[0] - cam[0], o.cam[1] - cam[1], o.cam[2] - cam[2]];
    const ahead = off[0] * view[0] + off[1] * view[1] + off[2] * view[2];
    for (const d of depth) {
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const dir = [0, 1, 2].map((i) => of.view[i] + (of.right[i] * a * oa + of.up[i] * b) * ot);
        const along = dir[0] * view[0] + dir[1] * view[1] + dir[2] * view[2];
        if (along < 1e-6) continue;
        const s = (d - ahead) / along;
        const rel = [0, 1, 2].map((i) => off[i] + dir[i] * s);
        const X = (rel[0] * right[0] + rel[1] * right[1] + rel[2] * right[2]) / d;
        const Y = (rel[0] * up[0] + rel[1] * up[1] + rel[2] * up[2]) / d;
        x0 = Math.min(x0, X);
        x1 = Math.max(x1, X);
        y0 = Math.min(y0, Y);
        y1 = Math.max(y1, Y);
      }
    }
  }
  const mx = 0.5 * (x1 - x0) * margin, my = 0.5 * (y1 - y0) * margin;
  x0 -= mx;
  x1 += mx;
  y0 -= my;
  y1 += my;
  const T = tilt && (mode === 1 || mode === 3 || mode === 4 || mode === 6) ? eulerXYZ(tilt) : null;
  const spin = mode === 4 ? Math.min(Math.max(0, rock), 0.04) : 0;
  const uv = new Float64Array(2);
  // Candidate k: R2 across the window (jittered, above), the golden ratio
  // through the depth. Its world position lands in W, one scratch array for
  // the whole walk, and its tan-space x in tx, for the taper.
  const W = new Float64Array(3);
  let tx = 0;
  const at = (k) => {
    r2(k, uv);
    if (jitter) {
      const s = jitter / Math.sqrt(k + 1);
      uv[0] = (uv[0] + (hash01(3 * k + 1) - 0.5) * s + 1) % 1;
      uv[1] = (uv[1] + (hash01(3 * k + 2) - 0.5) * s + 1) % 1;
    }
    const d = depth[0] + (depth[1] - depth[0]) * ((0.5 + k * PHI_INV) % 1);
    tx = x0 + (x1 - x0) * uv[0];
    const px = tx * d;
    const py = (y0 + (y1 - y0) * uv[1]) * d;
    W[0] = cam[0] + view[0] * d + right[0] * px + up[0] * py;
    W[1] = cam[1] + view[1] * d + right[1] * px + up[1] * py;
    W[2] = cam[2] + view[2] * d + right[2] * px + up[2] * py;
  };
  // Without a taper or an avoided camera, write j takes candidate rank[j].
  // With them, the accepted candidates in order, and write j the one of rank
  // rank[j]. The taper's coin is a fixed hash of the candidate's index.
  let pick = null;
  if (avoid.length || taper) {
    // Each avoided frustum as 16 numbers: its camera, view, right and up
    // axes, then tan(fov/2) times aspect and tan(fov/2), and the reach.
    const shut = new Float64Array(avoid.length * 16);
    avoid.forEach((o, i) => {
      const f = frame(o.cam, o.tgt);
      const t = Math.tan((o.fov * Math.PI) / 360);
      const reach = o.reach || [0, 0];
      shut.set([...o.cam, ...f.view, ...f.right, ...f.up, t * (o.aspect || aspect), t, reach[0], reach[1]], i * 16);
    });
    const hidden = () => {
      for (let i = 0; i < shut.length; i += 16) {
        const r0 = W[0] - shut[i], r1 = W[1] - shut[i + 1], r2w = W[2] - shut[i + 2];
        const d = r0 * shut[i + 3] + r1 * shut[i + 4] + r2w * shut[i + 5];
        if (d <= 0) continue;
        const X = r0 * shut[i + 6] + r1 * shut[i + 7] + r2w * shut[i + 8];
        if (Math.abs(X) > shut[i + 12] * d + shut[i + 14]) continue;
        const Y = r0 * shut[i + 9] + r1 * shut[i + 10] + r2w * shut[i + 11];
        if (Math.abs(Y) <= shut[i + 13] * d + shut[i + 15]) return true;
      }
      return false;
    };
    const core = taper ? ty * taper[0] : 0;
    pick = new Int32Array(m);
    const limit = 256 * m + 4096;
    for (let k = 0, got = 0; got < m; k++) {
      if (k > limit) throw new Error('[universe] backdrop: the window is too small for its avoided frames');
      at(k);
      if (taper && Math.abs(tx) > core) {
        const edge = tx > 0 ? x1 : -x0;
        const keep = 1 - (1 - taper[1]) * Math.min(1, (Math.abs(tx) - core) / Math.max(1e-9, edge - core));
        if (hash01(3 * k) >= keep) continue;
      }
      if (hidden()) continue;
      pick[got++] = k;
    }
  }
  for (let j = 0; j < m; j++) {
    at(pick ? pick[rank[j]] : rank[j]);
    let w = W;
    if (T) {
      w = [
        T[0] * W[0] + T[3] * W[1] + T[6] * W[2],
        T[1] * W[0] + T[4] * W[1] + T[7] * W[2],
        T[2] * W[0] + T[5] * W[1] + T[8] * W[2],
      ];
    }
    c.write(
      w[0], w[1], w[2],
      size[0] + (size[1] - size[0]) * Math.pow(c.rng.unit(), lean),
      c.rng.range(tint[0], tint[1]),
      c.rng.range(pulse[0], pulse[1]),
      spin,
      rigidity,
    );
  }
}
