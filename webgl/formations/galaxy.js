
import { MODE, GALAXY_CARRIED, galaxyCarrySpin, GALAXY_SUPERNOVAE, supernovaSpin, GALAXY_ARMS, galaxyWhirlSpin } from '../lib/modes.js';
import { TAU } from '../lib/random.js';
import { CHAPTERS, REDUCED_CHAPTERS } from '../chapters.js';
import { progressiveGrid, jittered, hash01, backdrop, slotRanks } from '../lib/sampling.js';
import { textStipple } from './code-kit.js';

/* ==========================================================================
   THE WHIRLPOOL (Projects)

   A grand-design spiral with its companion, after M51: two crisp arms that
   wind a full turn out of a bright core, a dark dust lane carved along the
   inside of each, pink HII regions strung along the lanes and blue clusters
   on the outside of the arms, and the outer arm running on as a tidal bridge
   into a small, dusty companion behind the disc, with a faint plume flung off
   its far side. Three star clusters in the interarm gaps carry the names
   of the projects (rift, seal, tiny) in the code constellations' type and
   ride round with the disc; a few faint galaxies lie deep behind.
   - Detail: dark feathers leave each lane across the arm at an open pitch
     with young spurs beside them, a nuclear spiral of dust and warm stars
     winds inside the bulge, supergiants sparkle along the arms, the inner
     arm runs on as a faint broken outer arm, and faint shells ring the
     companion's far side.
   - Nebulae. Emission clouds strung along each arm on the lane side, each
     three intertwined filaments in a diffuse envelope (pink hydrogen, some
     with a teal oxygen core), a starburst ring round the nucleus, and a
     galactic fountain: filaments of gas rising out of the disc above and
     below the core, curling outward, so the galaxy has depth out of its
     plane.

   - Dark lanes. In an additive point render dark is only an absence, so the
     lane is carved out of the disc's own light: the disc glow is placed by
     rank on a Roberts sequence with a density test (lib/sampling.js byRank)
     that follows the arms, brightens on them and all but empties the strip
     just inside each (concave side). The glow is faint and fine; the arms'
     stars sit on top of it.
   - One body. Everything that draws the spiral (glow, arms, lanes, knots, the
     bridge and the companion) turns rigidly at PATTERN, so the lanes never
     shear off the arms. The scroll winds it on (chapters.js spinFromScroll,
     particle-system.js): it turns as the page moves, back when it moves back.
   - Differential rotation (2026-09-29). The pattern is a density wave; the
     stars are not bound to it. A loose population of field stars on their
     own orbits (FIELD_RATE, a flat rotation curve) streams through the arms,
     several times faster inside than at the rim, the nucleus turns faster
     still and the bulge between them, and a sparse stellar halo turns
     slowly on both senses. The pattern keeps its shape; the motion reads.
   - Out of the plane. A rounder bulge, the halo, fourteen globular clusters
     well above and below the disc, the fountain, and a warp: the disc lifts
     past r 12 into three undulating waves, heaviest on the companion's side,
     so the rim is never a flat ellipse. A third, weaker spur-arm between the
     two main arms, the companion's arm heavier and longer than the other,
     and filaments of outer dust past the arms break the two-fold symmetry.
   - The named clusters and the deep field are still (spin 0), written through
     the inverse of the tilt so they stand where they are placed, facing the
     Projects camera: the galaxy turns under them.
   - Events and scale (2026-09-30). Supernovae: twelve sites along the arms
     (lib/modes.js GALAXY_SUPERNOVAE) on one shared cycle, each a star that
     flashes white and a remnant shell the shader drives out to 1.7 units
     and fades (mode 1, the 800 band), so every few seconds a star somewhere
     in the arms goes off and a ring of oxygen and hydrogen swells and
     dissolves. A tidal tail: the inner arm runs on past the disc as a long
     tail, sweeping round the side away from the companion at an open pitch
     and dropping below the plane to a tidal dwarf at its end, the answer to
     the bridge and the companion on the other side. Star streams: three
     thin arcs of faint old stars wrapped round the halo on inclined great
     circles, each gathered into its progenitor at the leading end and
     turning at its own slow rate, so they precess against the disc.

   mode 1 turns azimuth down over time and the arm angle grows with radius,
   so the arms trail. Structures are placed by slot rank where a cut must not
   break them (arms and bridge on the progressive grid, fills on jittered or
   accepted Roberts sets), so every rung keeps an even subset.
   ========================================================================== */

// The arms' constants live in lib/modes.js GALAXY_ARMS: the shader's flows
// (shaders/effects.js) follow the same spiral.
const PITCH = GALAXY_ARMS.pitch;
const SIN_PSI = 1 / Math.hypot(1, PITCH);
const R0 = GALAXY_ARMS.r0;
const R_IN = 2.4;
const R_OUT = 21;
const A0 = GALAXY_ARMS.a0;
// The arms are not perfect logarithmic spirals: a wiggle in their angle
// gives them M51's kinks and straight segments. Everything that follows an
// arm (glow, lanes, stars, knots, nebulae, bridge) reads this.
const WIG = (r, k) => 0.07 * Math.sin(1.35 * r + 1.1 + 2.3 * k) + 0.045 * Math.sin(2.9 * r + 0.3 + 1.1 * k);
const armAngle = (r, k) => A0 + k * Math.PI + PITCH * Math.log(r / R0) + WIG(r, k);
// The pattern speed: everything that draws the spiral turns rigidly at it.
const PATTERN = GALAXY_ARMS.pattern;
// Field stars, the halo and the bulge turn differentially (2026-09-29): a
// flat rotation curve, angular rate v / r, so the inner disc streams through
// the pattern several times faster than the rim.
const FIELD_RATE = (r) => 0.5 / Math.max(3.5, r);
const NUCLEUS_RATE = 0.11;
const BULGE_RATE = (r3) => 0.05 + 0.06 * Math.exp(-r3 / 1.5);
// The disc's warp: flat inside r 12, rising past it as the square of the
// distance, three waves at unrelated frequencies so the rim undulates without
// a visible period, and heaviest on the companion's side. Baked, and turned
// rigidly with the pattern.
function warpAt(x, z) {
  const r = Math.hypot(x, z);
  if (r < 12) return 0;
  const a = Math.atan2(z, x);
  const w = Math.pow((r - 12) / 14, 2);
  return w * (2.4 * Math.sin(a - 0.9) + 1.0 * Math.sin(a * 2.3 + r * 0.22) + 0.55 * Math.sin(a * 4.7 - r * 0.13));
}
const FEATHERS = 26;
const FEATHER_PITCH = 0.75;
const CENTRE_Z = -6;
const TILT = { x: 0.42, y: 0, z: -0.18 };
// The arm's width (one sigma across it, world units), the lane's place and
// half-width in sigmas on the concave side.
const SIG = (r) => 0.62 + 0.05 * r;
const LANE_AT = 0.95;
const LANE_W = 0.47;
// Inside the lane: the band an arm star is never placed in.
const inLane = (d, s) => d > (LANE_AT - LANE_W) * s && d < (LANE_AT + LANE_W) * s;
// The companion: at the end of the outer arm (k = 1), behind the disc.
const COMP_R = 24.5;
const COMP_A = armAngle(COMP_R, 1) + 0.3;
const COMP = [COMP_R * Math.cos(COMP_A), -2.6, COMP_R * Math.sin(COMP_A)];

const PROJECTS = CHAPTERS.find((c) => c.id === 'projects');
const PROJECTS_REDUCED = REDUCED_CHAPTERS.find((c) => c.id === 'projects');
const cameraOf = (ch) => ({ cam: [ch.camX, ch.camY, ch.camZ], tgt: [ch.tgtX, ch.tgtY, ch.tgtZ], fov: ch.fov });

/* ---- helpers ------------------------------------------------------------ */

const wrap = (a) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
// Signed distance across the nearer arm at (r, a): + is the concave side.
function armOffset(r, a) {
  const d0 = wrap(a - armAngle(r, 0)) * r * SIN_PSI;
  const d1 = wrap(a - armAngle(r, 1)) * r * SIN_PSI;
  return Math.abs(d0) < Math.abs(d1) ? { d: d0, k: 0 } : { d: d1, k: 1 };
}
// Value noise on an integer lattice and its fbm, for the disc's patchiness
// and the centre's dust: the same at every bake.
const lat = (i, j, salt) => hash01((Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(salt, 83492791)) | 0);
function vnoise(x, y, salt) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = lat(xi, yi, salt), b = lat(xi + 1, yi, salt), c = lat(xi, yi + 1, salt), d = lat(xi + 1, yi + 1, salt);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(x, y, salt) {
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let o = 0; o < 4; o++) { sum += amp * vnoise(x * f, y * f, salt + o * 17); norm += amp; amp *= 0.5; f *= 2.03; }
  return sum / norm;
}
const clamp01 = (v) => Math.min(1, Math.max(0, v));
// Sample a field on a swirled copy of the disc, so its structure trails
// like the arms do.
const swirl = (x, z, k) => { const r = Math.hypot(x, z), a = Math.atan2(z, x) - k * Math.log(r + 0.6); return [r * Math.cos(a), r * Math.sin(a)]; };
// Patchiness of the disc's light, 0.3 to 1.
const patchAt = (x, z) => { const [sx, sz] = swirl(x, z, 1.1); return 0.3 + 0.7 * clamp01((fbm(sx * 0.3 + 11, sz * 0.3 - 4, 7) - 0.5) * 2.6 + 0.5); };
// Flocculent dust: thin dark filaments along one contour of a swirled noise
// field, dense and chaotic across the centre, sparse in the disc.
function dustAt(x, z) {
  const r = Math.hypot(x, z);
  const [sx, sz] = swirl(x, z, 1.4);
  const n = fbm(sx * 0.55 + 3.1, sz * 0.55 - 1.7, 41);
  const m = fbm(sx * 0.9 - 6.2, sz * 0.9 + 2.4, 43);
  const fil = Math.max(Math.exp(-Math.pow((n - 0.5) / 0.045, 2)), 0.8 * Math.exp(-Math.pow((m - 0.47) / 0.032, 2)));
  const centre = Math.exp(-Math.pow(r / 4.2, 2)) * clamp01((r - 0.15) / 0.35);
  const disc = 0.4 * clamp01((r - 3) / 3) * Math.exp(-Math.pow(r / 15, 2));
  return fil * (centre + disc);
}
const gaussOf = (i, salt) => {
  const u1 = Math.max(1e-9, hash01(i * 2 + salt * 7919));
  const u2 = hash01(i * 2 + 1 + salt * 7919);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(TAU * u2);
};
const plummer = (u, a) => a / Math.sqrt(Math.pow(Math.max(1e-9, u), -2 / 3) - 1);
const KNOT_U = 64 / Math.pow(17, 1.5);
const hernquist = (u, a) => { const q = Math.sqrt(u); return (a * q) / Math.max(1e-9, 1 - q); };
function apportion(n, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const out = weights.map((w) => Math.floor((n * w) / sum));
  let rest = n - out.reduce((a, b) => a + b, 0);
  for (let i = 0; rest > 0; i = (i + 1) % out.length, rest--) out[i]++;
  return out;
}
// Inverse CDF of a density on t in [0, 1], tabulated.
function quantiles(density) {
  const N = 1024;
  const cdf = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) cdf[i + 1] = cdf[i] + density((i + 0.5) / N);
  return (q) => {
    const target = Math.min(1, Math.max(0, q)) * cdf[N];
    let lo = 0, hi = N;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid + 1] < target) lo = mid + 1; else hi = mid; }
    const f = (target - cdf[lo]) / Math.max(1e-12, cdf[lo + 1] - cdf[lo]);
    return (lo + Math.min(1, Math.max(0, f))) / N;
  };
}
// Exponential disc radius from a mass fraction (scale 5.5, truncated at 21).
const DISC_R = (() => {
  const H = 5.5, RMAX = 21, N = 1024;
  const U = 1 - (1 + RMAX / H) * Math.exp(-RMAX / H);
  const table = new Float64Array(N + 1);
  for (let i = 1, x = 0.05; i <= N; i++) {
    const v = (i / N) * U;
    for (let k = 0; k < 30; k++) {
      const f = 1 - (1 + x) * Math.exp(-x) - v, d = x * Math.exp(-x);
      if (Math.abs(f) < 1e-12 || d < 1e-12) break;
      x = Math.max(0, x - f / d);
    }
    table[i] = Math.min(RMAX, x * H);
  }
  return (u) => {
    const f = Math.min(1, Math.max(0, u)) * N, i = Math.min(N - 1, Math.floor(f));
    return table[i] + (table[i + 1] - table[i]) * (f - i);
  };
})();
// Beads along an arm: star-forming complexes, irregular, the same every bake.
const beads = (t, k) => {
  const w = Math.sin(t * 57 + k * 1.7) + 0.7 * Math.sin(t * 93 + 2.3 + k) + 0.5 * Math.sin(t * 149 + 4.1 - k * 0.6);
  return 0.35 + Math.pow(Math.max(0, 0.5 + w / 4.4), 1.5) * 1.6;
};
const ARM_T = [0, 1].map((k) => quantiles((t) => Math.pow(t + 0.03, -0.35) * beads(t, k)));
const armR = (t) => R_IN * Math.pow(R_OUT / R_IN, t);

/* The inverse of the tilt (three's Euler XYZ: world = Rx Ry Rz p), for the
   still populations written in world space. */
function untilt([x, y, z]) {
  const cx = Math.cos(TILT.x), sx = Math.sin(TILT.x);
  [y, z] = [cx * y + sx * z, -sx * y + cx * z];
  const cy = Math.cos(TILT.y), sy = Math.sin(TILT.y);
  [x, z] = [cy * x - sy * z, sy * x + cy * z];
  const cz = Math.cos(TILT.z), sz = Math.sin(TILT.z);
  [x, y] = [cz * x + sz * y, -sz * x + cz * y];
  return [x, y, z];
}
// The Projects camera's picture plane.
const VIEW = (() => {
  const v = [PROJECTS.tgtX - PROJECTS.camX, PROJECTS.tgtY - PROJECTS.camY, PROJECTS.tgtZ - PROJECTS.camZ];
  const l = Math.hypot(...v);
  const f = v.map((q) => q / l);
  const r = [-f[2], 0, f[0]];
  const rl = Math.hypot(...r);
  const right = r.map((q) => q / rl);
  const up = [right[1] * f[2] - right[2] * f[1], right[2] * f[0] - right[0] * f[2], right[0] * f[1] - right[1] * f[0]];
  return { f, right, up };
})();

/* ---- the populations, in write order ------------------------------------ */

const NUCLEUS_KNOTS = [[0.62, 0.05, 0.28], [-0.45, -0.04, 0.55], [0.2, 0.02, -0.72], [-0.8, 0.0, -0.3]];
const BULGE_KNOTS = [[0.95, 0.1, -0.55], [-0.75, -0.05, 0.85], [0.35, 0.05, 1.25], [-1.35, 0, -0.45], [1.55, -0.1, 0.95], [-0.2, 0.08, -1.5]];

function nucleus(c, n, put) {
  const rng = c.rng;
  const { p, rank } = jittered(c.ahead(n), 3, 0.7, 11);
  for (let j = 0; j < n; j++) {
    const r3 = plummer(p[j * 3] * KNOT_U, 0.42);
    const cz = 2 * p[j * 3 + 1] - 1, sz = Math.sqrt(Math.max(0, 1 - cz * cz)), ph = TAU * p[j * 3 + 2];
    const hot = rank[j] % 6 === 0;
    // Elongated and turned, and a few compact knots off the centre.
    let x = r3 * sz * Math.cos(ph) * 1.3, y = r3 * cz * 0.7, z = r3 * sz * Math.sin(ph) * 0.85;
    [x, z] = [x * 0.85 - z * 0.53, x * 0.53 + z * 0.85];
    if (rank[j] % 19 === 7) {
      const K = NUCLEUS_KNOTS[rank[j] % NUCLEUS_KNOTS.length];
      x = K[0] + x * 0.12; y = K[1] + y * 0.2; z = K[2] + z * 0.12;
    }
    // The centre's dust crosses the nucleus too, down to 0.3 of its light.
    const shade = Math.max(0.3, 1 - 0.95 * dustAt(x, z) * Math.exp(-Math.pow(y / 1.0, 2)));
    // The core proper: the innermost tenth of a unit burns white-gold.
    const core = Math.exp(-Math.pow(r3 / 0.35, 2));
    put(x, y, z,
      (hot ? rng.range(0.9, 1.4) : rng.range(0.34, 0.7) * (1.2 - r3 * 0.22)) * shade * (1 + 0.6 * core),
      r3 < 0.6 ? rng.range(2.62, 2.7) : rng.range(0.0, 0.08), 0.05, NUCLEUS_RATE, 0.95);
  }
}

function bulge(c, n, put) {
  const rng = c.rng;
  const { p, rank } = jittered(c.ahead(n), 3, 0.7, 23);
  const U = (5.5 * 5.5) / ((5.5 + 1.6) * (5.5 + 1.6));
  for (let j = 0; j < n; j++) {
    const r3 = hernquist(p[j * 3] * U, 1.6);
    const cz = 2 * p[j * 3 + 1] - 1, sz = Math.sqrt(Math.max(0, 1 - cz * cz)), ph = TAU * p[j * 3 + 2];
    // Triaxial and turned off the arms' axis, rounder than the disc so it
    // stands above and below the plane, an eighth gathered into compact
    // knots, and dimmed in a column wherever the dust crosses it.
    let x = r3 * sz * Math.cos(ph) * 1.22, y = r3 * cz * 0.7, z = r3 * sz * Math.sin(ph) * 0.84;
    [x, z] = [x * 0.85 - z * 0.53, x * 0.53 + z * 0.85];
    if (rank[j] % 8 === 3) {
      const K = BULGE_KNOTS[(rank[j] >> 3) % BULGE_KNOTS.length];
      x = K[0] + x * 0.16; y = K[1] + y * 0.25; z = K[2] + z * 0.16;
    }
    const shade = 1 - 0.95 * dustAt(x, z) * Math.exp(-Math.pow(y / 1.0, 2));
    put(x, y, z,
      rng.range(0.16, 0.42) * (1 + 0.7 * Math.max(0, 1 - r3 / 4)) * shade, rng.range(0.0, 0.14) + (shade < 0.6 ? 0.5 : 0), 0.1, BULGE_RATE(r3), 0.5);
  }
}

// How far the nuclear spiral bends off its logarithmic course at (x, z).
const nuclearWig = (x, z) => 2.2 * (fbm(x * 1.3, z * 1.3, 19) - 0.5);

/* The disc's light: faint, fine, following the arms, with the lanes carved
   out of it, patchy, and crossed by the centre's dust. */
function glow(c, n, put) {
  const rng = c.rng;
  const weight = (r, a) => {
    const { d } = armOffset(r, a);
    const s = SIG(r);
    // The arm's light is wide and sits a little inside the ridge, so the
    // lane runs through bright material, with a thin lit rim beyond it.
    const ridge = Math.exp(-0.5 * Math.pow((d / s - 0.2) / 1.25, 2));
    const lane = Math.exp(-Math.pow((d / s - LANE_AT) / LANE_W, 2)) * Math.min(1, Math.max(0, (r - 1.8) / 1.5));
    // Feathers: thin dark spurs leaving each lane outward across the arm at
    // a far more open pitch, spaced along the arm, fading past its outer edge.
    const fp = (((a - FEATHER_PITCH * Math.log(r)) * FEATHERS) / TAU) % 1;
    const fd = Math.abs((fp < 0 ? fp + 1 : fp) - 0.5);
    const across = Math.max(0, Math.min(1, (d / s + 1.9) / 1.4)) * Math.max(0, Math.min(1, (LANE_AT - d / s) / 0.4));
    const feather = fd > 0.47 ? across * Math.min(1, Math.max(0, (r - 4) / 3)) : 0;
    // The nuclear spiral: two tight dust arms inside r 2.4, bent and broken.
    const x = r * Math.cos(a), z = r * Math.sin(a);
    const nd = wrap(2 * (a - 0.9 - 1.3 * Math.log(Math.max(0.3, r) / 0.35) + nuclearWig(x, z))) / 2;
    const nuclear = r < 2.4 && r > 0.35
      ? Math.exp(-Math.pow(nd / 0.18, 2)) * Math.min(1, (2.4 - r) / 0.6) * clamp01((fbm(x * 1.6 + 7, z * 1.6, 23) - 0.36) * 4)
      : 0;
    const dust = dustAt(x, z);
    return ((0.2 + 1.0 * ridge) * (1 - 0.96 * lane) * (1 - 0.85 * feather) * (1 - 0.8 * nuclear) * (1 - 0.9 * dust) * patchAt(x, z)) / 1.2;
  };
  // Candidates from a fixed hash, not a Roberts sequence: mapped to polar
  // coordinates a quasi-lattice shows as spokes and hatching in the sparse
  // interarm light. Write j takes the accepted candidate of its slot rank.
  const slots = c.ahead(n);
  const rank = slotRanks(slots);
  const got = new Float64Array(n * 2);
  for (let k = 0, m = 0; m < n && k < 400 * n; k++) {
    const u0 = hash01(k * 3 + 101), u1 = hash01(k * 3 + 102), u2 = hash01(k * 3 + 103);
    if (u2 >= weight(DISC_R(u0), TAU * u1)) continue;
    got[m * 2] = u0; got[m * 2 + 1] = u1; m++;
  }
  const p = new Float64Array(n * 3);
  for (let j = 0; j < n; j++) { p[j * 3] = got[rank[j] * 2]; p[j * 3 + 1] = got[rank[j] * 2 + 1]; }
  for (let j = 0; j < n; j++) {
    // Jittered off the Roberts lattice (which shows as hatching), by less
    // than the lane's half-width across it.
    const r0 = DISC_R(p[j * 3]);
    const r = Math.max(0.2, r0 + (hash01(j * 3 + 11) - 0.5) * 0.12);
    const a = TAU * p[j * 3 + 1];
    const { d } = armOffset(r, a);
    const on = Math.exp(-0.5 * Math.pow(d / SIG(r), 2));
    put(r * Math.cos(a), rng.bell() * (0.1 + 0.012 * r), r * Math.sin(a),
      rng.range(0.12, 0.22) * (0.85 + 0.45 * on), 0.26 + 0.16 * on + rng.range(0, 0.1), 0.2 + 0.03 * r, PATTERN, 0.6);
  }
}

/* The arms' stars: along each arm by rank, bunched into complexes, a little
   to the convex side of the ridge and never in the lane. The companion's arm
   (k = 1) is the heavier and runs further; the other fades before its end. */
function arms(c, n, put) {
  const rng = c.rng;
  apportion(n, [0.9, 1.1]).forEach((m, k) => {
    const slots = c.ahead(m);
    const g = progressiveGrid(slots);
    for (let j = 0; j < m; j++) {
      const t = ARM_T[k]((g[j] + 0.5) / m);
      const r = armR(t);
      const s = SIG(r);
      // Most on the ridge, broad; a quarter on the thin rim beyond the lane.
      const rim = hash01(g[j] * 7 + k * 3 + 1) < 0.24;
      let d = rim ? s * (LANE_AT + LANE_W + 0.12 + 0.18 * Math.abs(gaussOf(g[j], 5 + k)))
        : s * (0.75 * gaussOf(g[j], 3 + k) - 0.25);
      if (inLane(d, s)) d = (LANE_AT - LANE_W) * s - (d - (LANE_AT - LANE_W) * s);
      const a = armAngle(r, k) + d / (r * SIN_PSI);
      const bright = hash01(g[j] * 5 + k) > 0.86;
      const core = Math.exp(-0.5 * (d / s) * (d / s));
      const fade = k === 0 ? 1 - 0.4 * clamp01((t - 0.7) / 0.3) : 1;
      put(r * Math.cos(a), rng.bell() * (0.08 + 0.008 * r), r * Math.sin(a),
        (bright ? rng.range(0.4, 0.66) * (1 - 0.3 * t) : rng.range(0.16, 0.34) * (0.7 + 0.4 * core)) * fade,
        0.34 + 0.3 * t + rng.range(0, 0.08), 0.25 + 0.6 * t, PATTERN, core > 0.5 ? 1 : 0.5);
    }
  });
}

/* A third, weaker arm: a short spur-arm between the two, with no lane,
   broken into complexes, so the spiral is not a perfect two-fold pattern. */
function thirdArm(c, n, put) {
  const rng = c.rng;
  const g = progressiveGrid(c.ahead(n));
  const density = quantiles((t) => 0.5 + 0.5 * Math.pow(0.5 + 0.5 * Math.sin(t * 31 + 1.2) * Math.sin(t * 13 + 0.4), 1.5));
  for (let j = 0; j < n; j++) {
    const t = density((g[j] + 0.5) / n);
    const r = 5.5 + 9.5 * t;
    const s = SIG(r) * 0.8;
    const d = s * 0.7 * gaussOf(g[j], 91);
    const a = A0 + 0.55 * Math.PI + PITCH * 1.05 * Math.log(r / R0) + 0.05 * Math.sin(2.1 * r) + d / (r * SIN_PSI);
    const end = Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
    put(r * Math.cos(a), rng.bell() * (0.1 + 0.01 * r), r * Math.sin(a),
      rng.range(0.14, 0.3) * (0.5 + 0.5 * Math.pow(end, 0.5)), 0.35 + 0.25 * t + rng.range(0, 0.1), 0.3 + 0.4 * t, PATTERN, 0.6);
  }
}

/* Field stars: the disc's loose population, on an exponential disc and
   patchy, each on its own orbit at the flat rotation curve's rate, so the
   inner disc visibly streams through the pattern while the rim barely turns. */
function field(c, n, put) {
  const rng = c.rng;
  const slots = c.ahead(n);
  const rank = slotRanks(slots);
  const got = new Float64Array(n * 2);
  for (let k = 0, m = 0; m < n && k < 400 * n; k++) {
    const u0 = hash01(k * 3 + 1501), u1 = hash01(k * 3 + 1502), u2 = hash01(k * 3 + 1503);
    const r = Math.max(2.5, DISC_R(u0) * 1.15);
    const a = TAU * u1;
    const x = r * Math.cos(a), z = r * Math.sin(a);
    if (u2 >= patchAt(x, z)) continue;
    got[m * 2] = x; got[m * 2 + 1] = z; m++;
  }
  for (let j = 0; j < n; j++) {
    const x = got[rank[j] * 2], z = got[rank[j] * 2 + 1];
    const r = Math.hypot(x, z);
    const bright = rank[j] % 12 === 0;
    put(x, rng.bell() * (0.25 + 0.03 * r), z,
      bright ? rng.range(0.3, 0.5) : rng.range(0.12, 0.26), rng.range(0.15, 0.5), 0.2 + 0.03 * r, FIELD_RATE(r), 0.75);
  }
}

/* The stellar halo: a sparse oblate spheroid of faint old stars above and
   below the disc, out to the companion's distance, each turning slowly on its
   own sense, so the galaxy has a body out of its plane. */
function halo(c, n, put) {
  const rng = c.rng;
  const { p } = jittered(c.ahead(n), 3, 0.7, 1601);
  for (let j = 0; j < n; j++) {
    const r = 3 + 26 * Math.pow(p[j * 3], 1.8);
    const cz = 2 * p[j * 3 + 1] - 1, sz = Math.sqrt(Math.max(0, 1 - cz * cz)), ph = TAU * p[j * 3 + 2];
    const sense = hash01(j * 3 + 7) < 0.6 ? 1 : -1;
    put(r * sz * Math.cos(ph), r * cz * 0.6, r * sz * Math.sin(ph),
      0.12 + 0.18 * Math.pow(rng.unit(), 2.2), rng.range(0.05, 0.3), 0.5 + 0.4 * p[j * 3], sense * (0.015 + 0.03 * hash01(j * 5 + 3)), 0.4);
  }
}

/* Globular clusters: fourteen knots scattered through the halo, well above
   and below the plane, each turning slowly as one body: a power law of
   sizes (two large and loose, most small and tight), so they are not
   fourteen copies of one ball. */
function globulars(c, n, put) {
  const rng = c.rng;
  const G = 14;
  const bigs = Array.from({ length: G }, (_, i) => sizeClass(hash01(i * 29 + 8)));
  const counts = apportion(n, Array.from({ length: G }, (_, i) => (0.6 + hash01(i * 7 + 1)) * (0.35 + 0.65 * bigs[i])));
  for (let i = 0; i < G; i++) {
    const r = 4 + 14 * hash01(i * 11 + 2);
    const a = TAU * hash01(i * 13 + 3);
    const y = (hash01(i * 17 + 4) - 0.5) * 16 * (0.4 + 0.6 * hash01(i * 19 + 5));
    const rate = 0.02 + 0.03 * hash01(i * 23 + 6);
    const loose = bigs[i] > 1.6;
    cluster(c, counts[i], [r * Math.cos(a), y, r * Math.sin(a)], 0.16 * bigs[i], loose ? 1 : 0, [1, 0, 0], 1701 + i * 13, (x, yy, z, rk) => {
      put(x, yy, z, rk % (loose ? 3 : 7) === 0 ? rng.range(0.45, 0.7) : rng.range(0.16, 0.34), rng.range(0.05, 0.25), 0.7, rate, 0.9);
    });
  }
}

/* Outer dust: thin filaments of faint light along the contours of a swirled
   noise field past the arms, loose enough to drift on the noise field, the
   disc's dusty outskirts. */
function outerDust(c, n, put) {
  const rng = c.rng;
  const slots = c.ahead(n);
  const rank = slotRanks(slots);
  const got = new Float64Array(n * 2);
  for (let k = 0, m = 0; m < n && k < 600 * n; k++) {
    const u0 = hash01(k * 3 + 2001), u1 = hash01(k * 3 + 2002), u2 = hash01(k * 3 + 2003);
    const r = 13 + 14 * Math.pow(u0, 0.9);
    const a = TAU * u1;
    const x = r * Math.cos(a), z = r * Math.sin(a);
    const [sx, sz] = swirl(x, z, 1.6);
    // Two octaves of the lattice noise are enough for a filament contour,
    // and a fifth of the cost of the full fbm the disc's dust uses.
    const f = 0.65 * vnoise(sx * 0.32 + 5.3, sz * 0.32 - 2.1, 51) + 0.35 * vnoise(sx * 0.7 + 1.9, sz * 0.7 + 4.4, 68);
    const fil = Math.exp(-Math.pow((f - 0.5) / 0.055, 2)) * (1 - Math.pow((r - 13) / 14, 2) * 0.7);
    if (u2 >= fil) continue;
    got[m * 2] = x; got[m * 2 + 1] = z; m++;
  }
  for (let j = 0; j < n; j++) {
    const x = got[rank[j] * 2], z = got[rank[j] * 2 + 1];
    put(x, rng.bell() * 0.7, z, rng.range(0.1, 0.2), rng.range(0.2, 0.45), 0.85, PATTERN * 0.85, 0.35);
  }
}

/* A Plummer knot about q (local), placed by rank. */
function knot(c, n, q, scale, salt, style) {
  const { p, rank } = jittered(c.ahead(n), 3, 0.7, salt);
  for (let j = 0; j < n; j++) {
    const r3 = plummer(p[j * 3] * KNOT_U, scale);
    const cz = 2 * p[j * 3 + 1] - 1, sz = Math.sqrt(Math.max(0, 1 - cz * cz)), ph = TAU * p[j * 3 + 2];
    style(q[0] + r3 * sz * Math.cos(ph), q[1] + r3 * cz * 0.6, q[2] + r3 * sz * Math.sin(ph), rank[j], r3 / scale);
  }
}

/* A star cluster of one of five kinds about q (local), placed by rank
   (2026-09-29: every knot was the same fuzzy ball at the same size).
     0 compact      a Plummer knot with a bright core (the knot above)
     1 association  a loose group two and a half times the size, of fewer,
                    brighter stars and no core
     2 bubble       a thin flattened shell (a remnant, an HII bubble), a few
                    stars inside it
     3 elongated    a knot stretched 2.5 : 1 along the arm
     4 cometary     a compact head with a tail streaming away behind it along
                    the arm, thinning as it goes
   `dir` is the arm's unit tangent in the disc plane, for kinds 3 and 4. The
   style callback gets (x, y, z, rank, rr, kind), rr the point's radius as a
   share of the cluster's own size. The caller picks the kind and a
   power-law size, so a few clusters are large and most are small. */
function cluster(c, n, q, scale, kind, dir, salt, style) {
  const { p, rank } = jittered(c.ahead(n), 3, 0.7, salt);
  const side = [-dir[2], 0, dir[0]];
  for (let j = 0; j < n; j++) {
    const u = p[j * 3], v = p[j * 3 + 1], w = p[j * 3 + 2];
    const cz = 2 * v - 1, sz = Math.sqrt(Math.max(0, 1 - cz * cz)), ph = TAU * w;
    const bell = v + w - 1;
    let x, y, z, rr;
    if (kind === 1) {
      const s = scale * 2.5;
      const r3 = plummer(u * KNOT_U, s);
      x = r3 * sz * Math.cos(ph); y = r3 * cz * 0.5; z = r3 * sz * Math.sin(ph); rr = r3 / s;
    } else if (kind === 2) {
      const s = scale * 1.8;
      const inside = rank[j] % 6 === 0;
      const r3 = inside ? s * Math.cbrt(u) * 0.8 : s * (0.9 + 0.2 * u);
      x = r3 * sz * Math.cos(ph); y = r3 * cz * 0.3; z = r3 * sz * Math.sin(ph); rr = r3 / s;
    } else if (kind === 3) {
      const r3 = plummer(u * KNOT_U, scale);
      const ex = r3 * sz * Math.cos(ph) * 2.5, ez = r3 * sz * Math.sin(ph);
      x = dir[0] * ex + side[0] * ez; y = r3 * cz * 0.6; z = dir[2] * ex + side[2] * ez; rr = r3 / scale;
    } else if (kind === 4 && rank[j] % 3 !== 0) {
      const s = u * scale * 5;
      const spread = scale * (0.3 + 0.5 * u);
      x = -dir[0] * s + side[0] * bell * spread; y = bell * spread * 0.4 * (w - 0.5); z = -dir[2] * s + side[2] * bell * spread; rr = 1 + u * 2.5;
    } else {
      const s = kind === 4 ? scale * 0.8 : scale;
      const r3 = plummer(u * KNOT_U, s);
      x = r3 * sz * Math.cos(ph); y = r3 * cz * 0.6; z = r3 * sz * Math.sin(ph); rr = r3 / s;
    }
    style(q[0] + x, q[1] + y, q[2] + z, rank[j], rr, kind);
  }
}
// The arm's unit tangent in the disc plane at (r, a): the direction of
// increasing radius along the logarithmic spiral.
function armDir(a) {
  const tx = Math.cos(a) - PITCH * Math.sin(a), tz = Math.sin(a) + PITCH * Math.cos(a);
  const l = Math.hypot(tx, tz) || 1;
  return [tx / l, 0, tz / l];
}
// A cluster's kind and size class from a hash: most compact and small, a few
// large, the rest spread over the other kinds.
function clusterKind(h) { return h < 0.38 ? 0 : h < 0.58 ? 1 : h < 0.7 ? 2 : h < 0.86 ? 3 : 4; }
const sizeClass = (h) => 0.55 + 2.2 * Math.pow(h, 3);

// HII regions: pink, along the lane side of the ridge, each with white stars;
// compact knots, loose associations, bubbles, stretched and cometary ones.
function hii(c, n, put) {
  const rng = c.rng;
  const list = [];
  for (let k = 0; k < 2; k++) {
    for (let t = 0.1 + 0.03 * k; t < 0.86; t += 0.03 + 0.065 * hash01(Math.round(t * 1000) + k)) {
      const big = sizeClass(hash01(Math.round(t * 1013) + 7 * k + 41));
      list.push({ k, t, w: (0.6 + 0.8 * hash01(Math.round(t * 997) + 3 * k)) * (0.4 + 0.6 * big), big, kind: clusterKind(hash01(Math.round(t * 1019) + 11 * k + 43)) });
    }
  }
  const counts = apportion(n, list.map((q) => q.w));
  list.forEach(({ k, t, w, big, kind }, i) => {
    const r = armR(t);
    const a = armAngle(r, k) + (0.38 * SIG(r)) / (r * SIN_PSI);
    const scale = (0.12 + 0.1 * Math.sqrt(w)) * big;
    cluster(c, counts[i], [r * Math.cos(a), 0, r * Math.sin(a)], scale, kind, armDir(a), 400 + i * 7, (x, y, z, rk, rr, kd) => {
      const star = kd === 1 ? rk % 3 === 0 : rk % 10 === 0;
      const gas = kd === 2 || kd === 4 ? rng.range(0.12, 0.24) : rng.range(0.14, 0.3);
      put(x, y, z, star ? rng.range(0.45, 0.7) : gas * (kd === 4 ? Math.max(0.35, 1 - 0.2 * rr) : 1),
        star ? rng.range(0.02, 0.1) : rng.range(2.92, 2.99), 0.3 + 0.5 * t, PATTERN, 0.9);
    });
  });
}

// Young clusters: blue-white, on the convex side, in the same five kinds.
function blue(c, n, put) {
  const rng = c.rng;
  const list = [];
  for (let k = 0; k < 2; k++) {
    for (let t = 0.14 + 0.02 * k; t < 0.92; t += 0.035 + 0.075 * hash01(Math.round(t * 991) + 5 * k)) {
      const big = sizeClass(hash01(Math.round(t * 1021) + 13 * k + 47));
      list.push({ k, t, w: (0.5 + hash01(Math.round(t * 983) + k)) * (0.4 + 0.6 * big), big, kind: clusterKind(hash01(Math.round(t * 1031) + 17 * k + 53)) });
    }
  }
  const counts = apportion(n, list.map((q) => q.w));
  list.forEach(({ k, t, w, big, kind }, i) => {
    const r = armR(t);
    const a = armAngle(r, k) - (0.85 * SIG(r)) / (r * SIN_PSI);
    const scale = (0.1 + 0.08 * Math.sqrt(w)) * big;
    cluster(c, counts[i], [r * Math.cos(a), 0, r * Math.sin(a)], scale, kind, armDir(a), 500 + i * 11, (x, y, z, rk, rr, kd) => {
      const star = kd === 1 ? rk % 2 === 0 : rk % 7 === 0;
      put(x, y, z, star ? rng.range(0.5, 0.8) : rng.range(0.14, 0.28) * (kd === 4 ? Math.max(0.35, 1 - 0.2 * rr) : 1),
        star ? rng.range(0.4, 0.6) : rng.range(0.66, 0.86), 0.3 + 0.5 * t, PATTERN, 0.95);
    });
  });
}

/* The bridge: the outer arm running on past the disc, bending into the
   companion and dropping behind the disc as it goes. */
function bridge(c, n, put) {
  const rng = c.rng;
  const g = progressiveGrid(c.ahead(n));
  const r1 = 16.5;
  for (let j = 0; j < n; j++) {
    const u = (g[j] + 0.5) / n;
    const r = r1 + (COMP_R - r1) * u;
    const blend = u * u * (3 - 2 * u);
    const a = armAngle(r, 1) + 0.3 * blend + (gaussOf(g[j], 9) * 0.35 * SIG(r)) / (r * SIN_PSI);
    const fade = 1 - 0.55 * u;
    // The warp is the disc's; the bridge leaves it as it drops to the companion.
    const x = r * Math.cos(a), z = r * Math.sin(a);
    put(x, -2.6 * blend + rng.bell() * (0.15 + 0.3 * u) - warpAt(x, z) * blend, z,
      rng.range(0.13, 0.3) * fade, 0.3 + 0.2 * u + rng.range(0, 0.1), 0.8, PATTERN, 0.7);
  }
}

/* The companion: an amorphous, dusty body, gold at the core, a dark lane
   across it, inside a faint envelope. */
function companion(c, n, put) {
  const rng = c.rng;
  const [nBody, nEnv] = apportion(n, [0.78, 0.22]);
  const U = (3.6 * 3.6) / ((3.6 + 0.9) * (3.6 + 0.9));
  const { p } = jittered(c.ahead(nBody), 3, 0.7, 601);
  for (let j = 0; j < nBody; j++) {
    const r3 = hernquist(p[j * 3] * U, 0.9);
    const cz = 2 * p[j * 3 + 1] - 1, sz = Math.sqrt(Math.max(0, 1 - cz * cz)), ph = TAU * p[j * 3 + 2];
    let x = r3 * sz * Math.cos(ph), y = r3 * cz * 0.75, z = r3 * sz * Math.sin(ph) * 0.85;
    // The lane across it: a slab, tilted, emptied except for a trace.
    const slab = x * 0.42 + y * 0.9 - 0.25;
    if (Math.abs(slab) < 0.22 && hash01(j * 13 + 1) > 0.12) y += Math.sign(slab || 1) * 0.3;
    put(COMP[0] + x, COMP[1] + y, COMP[2] + z,
      r3 < 0.35 ? rng.range(0.6, 0.95) : rng.range(0.16, 0.36) * (1.15 - Math.min(1, r3 / 3.6) * 0.5),
      r3 < 0.8 ? rng.range(2.6, 2.7) : rng.range(0.04, 0.2), 0.8, PATTERN, 0.8);
  }
  const e = jittered(c.ahead(nEnv), 3, 0.7, 607).p;
  for (let j = 0; j < nEnv; j++) {
    const r3 = 1.5 + 4.5 * Math.pow(e[j * 3], 0.7);
    const cz = 2 * e[j * 3 + 1] - 1, sz = Math.sqrt(Math.max(0, 1 - cz * cz)), ph = TAU * e[j * 3 + 2];
    put(COMP[0] + r3 * sz * Math.cos(ph), COMP[1] + r3 * cz * 0.6, COMP[2] + r3 * sz * Math.sin(ph),
      rng.range(0.1, 0.2), rng.range(0.1, 0.3), 0.8, PATTERN, 0.3);
  }
}

// The plume: a faint fan flung off the companion's far side.
function plume(c, n, put) {
  const rng = c.rng;
  const { p } = jittered(c.ahead(n), 2, 0.7, 701);
  const out = [Math.cos(COMP_A + 0.25), 0, Math.sin(COMP_A + 0.25)];
  const side = [-out[2], 0, out[0]];
  for (let j = 0; j < n; j++) {
    const L = 2.5 + 9 * Math.pow(p[j * 2], 0.8);
    const spread = (p[j * 2 + 1] - 0.5) * (0.4 + 0.08 * L) * 2;
    const curl = 0.02 * L * L;
    put(COMP[0] + out[0] * L + side[0] * (spread + curl), COMP[1] - 0.15 * L + rng.bell() * 0.3, COMP[2] + out[2] * L + side[2] * (spread + curl),
      rng.range(0.1, 0.2) * (1 - L / 14), rng.range(0.2, 0.45), 0.9, PATTERN, 0.2);
  }
}

// The outer disc: a faint, low-density skirt past the arms.
function outer(c, n, put) {
  const rng = c.rng;
  const { p } = jittered(c.ahead(n), 2, 0.7, 801);
  for (let j = 0; j < n; j++) {
    const r = 17 + 9 * Math.pow(p[j * 2], 0.8);
    const a = TAU * p[j * 2 + 1];
    put(r * Math.cos(a), rng.bell() * 0.5, r * Math.sin(a), rng.range(0.1, 0.18), rng.range(0.35, 0.6), 0.9, PATTERN, 0.2);
  }
}

/* Emission nebulae along the arms, on the lane side: three intertwined
   filaments and a diffuse envelope each, following the arm's curve. */
function nebulae(c, n, put) {
  const rng = c.rng;
  const list = [];
  for (let k = 0; k < 2; k++) {
    for (let t = 0.13 + 0.05 * k; t < 0.84; t += 0.1 + 0.035 * hash01(Math.round(t * 887) + 9 * k)) {
      const h = hash01(Math.round(t * 1009) + 13 * k);
      list.push({ k, t, w: 0.6 + 0.9 * h, teal: h > 0.5 });
    }
  }
  const counts = apportion(n, list.map((q) => q.w));
  list.forEach(({ k, t, w, teal }, i) => {
    const m = counts[i];
    const rc = armR(t);
    const s = SIG(rc);
    const L = (4.2 + 4.4 * w) * (0.7 + 0.5 * t);
    const W = s * (1.0 + 0.6 * w);
    const ph = TAU * hash01(i * 31 + 7);
    const { p, rank } = jittered(c.ahead(m), 3, 0.7, 1201 + i * 17);
    for (let j = 0; j < m; j++) {
      const along = (p[j * 3] - 0.5) * L;
      const env = Math.pow(Math.cos((Math.PI * along) / L), 0.6);
      const halo = rank[j] % 10 < 4;
      const f = rank[j] % 3;
      let across, up;
      if (halo) {
        across = (p[j * 3 + 1] - 0.5) * 3.0 * W * env;
        up = (p[j * 3 + 2] - 0.5) * 1.3;
      } else {
        across = W * ((f - 1) * 0.42 + 0.34 * Math.sin(along * (1.3 + 0.55 * f) + ph + f * 2.1)) * env
          + (p[j * 3 + 1] - 0.5) * 0.16 * W;
        up = 0.25 * Math.sin(along * 0.9 + ph * 1.7 + f) + (p[j * 3 + 2] - 0.5) * 0.25;
      }
      const r = rc + along * SIN_PSI;
      const a = armAngle(r, k) + (0.45 * s + across) / (r * SIN_PSI);
      const core = !halo && Math.abs(along) < 0.3 * L;
      // Cyan oxygen filaments in a blue envelope, pink hydrogen at the core
      // of the rest: bright enough to read as glowing gas, not as stars.
      const pinkCore = !teal && core && rank[j] % 3 === 0;
      const tint = pinkCore ? rng.range(2.94, 3.0) : halo ? rng.range(2.06, 2.16) : rng.range(2.22, 2.34);
      put(r * Math.cos(a), up, r * Math.sin(a),
        (halo ? rng.range(0.2, 0.34) : rng.range(0.26, 0.46)) * (0.55 + 0.45 * env),
        tint, 0.35 + 0.5 * t, PATTERN, halo ? 0.25 : 0.55);
    }
  });
}

/* A starburst ring round the nucleus: discrete pink and blue knots of
   every size scattered along a wandering oval, over a loose diffuse ring
   that fades out in the gaps, a few streamers trailing off it. Evenly
   spread (nothing is packed into arcs); the gaps are made by dimming. */
const starburstR = (a) => 1.75 * (1 + 0.16 * Math.sin(2 * a + 0.7) + 0.08 * Math.sin(5 * a + 1.9));
const starburstDensity = (t) => 0.03 + Math.pow(Math.max(0, vnoise(3 * Math.cos(TAU * t) + 10, 3 * Math.sin(TAU * t) + 10, 77) - 0.32), 1.4) * 3;
function starburst(c, n, put) {
  const rng = c.rng;
  const [nKnots, nDiffuse] = apportion(n, [0.6, 0.4]);
  const knots = [];
  for (let i = 0; i < 14; i++) {
    const a = TAU * ((i + 0.5 + 0.8 * (hash01(i * 17 + 3) - 0.5)) / 14);
    knots.push({
      a, rr: starburstR(a) + (hash01(i * 19 + 5) - 0.5) * 0.55,
      w: 0.3 + Math.pow(hash01(i * 23 + 7), 2) * 1.7, pink: hash01(i * 29 + 1) < 0.65,
    });
  }
  const counts = apportion(nKnots, knots.map((q) => q.w));
  knots.forEach(({ a, rr, w, pink }, i) => {
    knot(c, counts[i], [rr * Math.cos(a), 0, rr * Math.sin(a)], 0.06 + 0.08 * Math.sqrt(w), 1401 + i * 7, (x, y, z, rk) => {
      const star = rk % 8 === 0;
      put(x, y * 0.5, z, star ? rng.range(0.4, 0.62) : rng.range(0.12, 0.26),
        star ? rng.range(0.02, 0.1) : pink ? rng.range(2.9, 2.99) : rng.range(0.55, 0.8), 0.15, PATTERN * 1.3, 0.9);
    });
  });
  const grid = progressiveGrid(c.ahead(nDiffuse));
  for (let j = 0; j < nDiffuse; j++) {
    const u = (grid[j] + 0.5) / nDiffuse;
    const a = TAU * u;
    const rr = starburstR(a) + gaussOf(grid[j], 83) * 0.18;
    const streamer = hash01(grid[j] * 5 + 3) < 0.12;
    const r = streamer ? rr + Math.abs(gaussOf(grid[j], 89)) * 0.55 : rr;
    const a2 = streamer ? a - (r - rr) * 0.55 : a;
    const pink = hash01(grid[j] * 3 + 1) < 0.6;
    put(r * Math.cos(a2), rng.bell() * 0.08, r * Math.sin(a2),
      rng.range(0.1, 0.2) * clamp01(0.15 + starburstDensity(u)) * (streamer ? 0.7 : 1),
      pink ? rng.range(2.9, 2.99) : rng.range(0.55, 0.8), 0.15, PATTERN * 1.3, 0.8);
  }
}

/* The fountain: filaments of gas rising out of the disc above and below the
   core, curling outward as they climb, teal at the base and pink at the
   tips. Along each on the progressive grid. */
function fountain(c, n, put) {
  const rng = c.rng;
  const F = 22;
  const counts = apportion(n, Array.from({ length: F }, (_, i) => 0.6 + hash01(i * 19 + 3)));
  for (let i = 0; i < F; i++) {
    const side = i % 2 ? 1 : -1;
    const a0 = TAU * hash01(i * 23 + 1);
    const r0 = 0.8 + 2.4 * hash01(i * 29 + 2);
    const H = 3 + 4 * hash01(i * 31 + 5);
    const out = 2.5 + 4.5 * hash01(i * 37 + 7);
    const twist = (hash01(i * 41 + 9) - 0.5) * 1.6;
    const g = progressiveGrid(c.ahead(counts[i]));
    for (let j = 0; j < counts[i]; j++) {
      const u = (g[j] + 0.5) / counts[i];
      const r = r0 + out * u * u;
      const a = a0 + twist * u;
      const y = side * H * Math.pow(u, 0.8);
      const spread = 0.25 + 0.9 * u;
      put(r * Math.cos(a) + rng.bell() * spread, y + rng.bell() * spread * 0.6, r * Math.sin(a) + rng.bell() * spread,
        rng.range(0.16, 0.3) * (1 - 0.5 * u), u < 0.65 ? rng.range(2.1, 2.26) : rng.range(2.9, 2.98), 0.2 + 0.3 * u, PATTERN, 0.3);
    }
  }
}

/* Spurs: young stars strung along the feathers' pitch just beside each dark
   feather, on the convex side of the arm. */
function spurs(c, n, put) {
  const rng = c.rng;
  const list = [];
  for (let f = 0; f < FEATHERS; f++) {
    for (let k = 0; k < 2; k++) {
      if (hash01(f * 7 + k * 3 + 1) < 0.35) continue;
      list.push({ f, k, w: 0.6 + hash01(f * 11 + k) });
    }
  }
  const counts = apportion(n, list.map((q) => q.w));
  list.forEach(({ f, k }, i) => {
    const psi = ((f + 0.5 + 0.06) / FEATHERS) * TAU;
    // Where the feather's line crosses the arm's ridge: solve a(r) on both.
    let r0 = 3;
    for (let it = 0; it < 40; it++) {
      const diff = wrap(armAngle(r0, k) - (psi + FEATHER_PITCH * Math.log(r0)));
      r0 = Math.min(R_OUT, Math.max(3, r0 * Math.exp(-diff / (PITCH - FEATHER_PITCH) * 0.7)));
    }
    const g = progressiveGrid(c.ahead(counts[i]));
    for (let j = 0; j < counts[i]; j++) {
      const u = (g[j] + 0.5) / counts[i];
      const r = r0 * (1 + 0.28 * u);
      const a = psi + FEATHER_PITCH * Math.log(r) + rng.bell() * 0.01;
      put(r * Math.cos(a), rng.bell() * 0.08, r * Math.sin(a),
        rng.range(0.14, 0.3) * (1 - 0.5 * u), rng.range(0.55, 0.8), 0.4, PATTERN, 0.7);
    }
  });
}

// The nuclear spiral's stars: two loose, clumpy, broken arms of warm light
// inside the lanes, bent with them. Evenly spread along each arm (no
// segment is packed into a line): in the gaps the points shrink to almost
// nothing, a third of the rest gather into knots, and each arm is about half
// a unit wide.
function nuclear(c, n, put) {
  const rng = c.rng;
  apportion(n, [1, 1]).forEach((m, k) => {
    const grid = progressiveGrid(c.ahead(m));
    for (let j = 0; j < m; j++) {
      const u = (grid[j] + 0.5) / m;
      const gap = vnoise(u * 6 + 1.3, k * 3 + 0.5, 29) < 0.45;
      const cell = Math.floor(u * 9);
      const knotU = (cell + 0.5 + 0.3 * (hash01(cell * 13 + k) - 0.5)) / 9;
      const inKnot = hash01(grid[j] * 11 + k * 7 + 5) < 0.35;
      const uu = inKnot ? knotU + (u - knotU) * 0.25 : u;
      const r = Math.max(0.3, 0.4 + 1.9 * uu + gaussOf(grid[j], 61 + k) * (inKnot ? 0.06 : 0.2));
      const a0 = 0.9 + k * Math.PI + 1.3 * Math.log(r / 0.35);
      const a = a0 - 0.32 - nuclearWig(r * Math.cos(a0), r * Math.sin(a0))
        + (gaussOf(grid[j], 71 + k) * (inKnot ? 0.06 : 0.22)) / Math.max(0.5, r);
      const hue = hash01(grid[j] * 7 + k * 5 + 2);
      put(r * Math.cos(a), rng.bell() * 0.08, r * Math.sin(a),
        rng.range(0.1, 0.24) * (1.15 - 0.45 * uu) * (gap ? 0.1 : 1),
        hue < 0.25 ? rng.range(0.0, 0.1) : hue < 0.45 ? rng.range(2.9, 2.99) : rng.range(2.6, 2.7), 0.1, PATTERN * 1.3, 0.9);
    }
  });
}

/* The tidal tail: arm 0 runs on past the disc as a long tail flung out by the
   companion's passage, sweeping round the side away from the companion at a
   more open pitch than the arm, dropping below the plane as it goes (to -5.2
   at its end), widening and thinning, broken into clumps, and ending in a
   tidal dwarf: a knot of young blue stars where the tail's gas has gathered.
   Turns with the pattern, so it stays attached to its arm. Its y is its own
   (the disc's warp at the root, blending to the drop), so it is written with
   putBody. */
function tidalTail(c, n, put) {
  const rng = c.rng;
  const [nTail, nDwarf] = apportion(n, [0.82, 0.18]);
  const rRoot = R_OUT * 0.95;
  const aRoot = armAngle(rRoot, 0);
  const along = (u) => {
    const r = rRoot * (1 + 0.78 * u);
    const a = aRoot + PITCH * 0.55 * Math.log(r / rRoot) + 0.06 * Math.sin(3.1 * u + 0.4);
    const drop = u * u * (3 - 2 * u);
    return { r, a, drop };
  };
  const density = quantiles((u) => (1 - 0.5 * u) * (0.4 + 0.6 * Math.pow(0.5 + 0.5 * Math.sin(u * 23 + 0.7) * Math.sin(u * 9 - 1.1), 1.3)));
  const g = progressiveGrid(c.ahead(nTail));
  for (let j = 0; j < nTail; j++) {
    const u = density((g[j] + 0.5) / nTail) * 0.96;
    const { r, a, drop } = along(u);
    const width = (0.5 + 1.7 * u) * SIG(R_OUT);
    const aa = a + (gaussOf(g[j], 21) * width) / (r * SIN_PSI);
    const x = r * Math.cos(aa), z = r * Math.sin(aa);
    const y = warpAt(x, z) * (1 - drop) - 5.2 * drop + rng.bell() * (0.3 + 1.0 * u);
    put(x, y, z, rng.range(0.12, 0.26) * (1 - 0.3 * u), 0.45 + 0.25 * u + rng.range(0, 0.1), 0.9, PATTERN, 0.4);
  }
  const { r, a, drop } = along(0.94);
  const end = [r * Math.cos(a), -5.2 * drop, r * Math.sin(a)];
  knot(c, nDwarf, end, 0.7, 2101, (x, y, z, rk) => {
    const star = rk % 5 === 0;
    put(x, y, z, star ? rng.range(0.4, 0.62) : rng.range(0.14, 0.28), star ? rng.range(0.5, 0.7) : rng.range(0.6, 0.85), 0.9, PATTERN, 0.9);
  });
}

/* Star streams: three thin arcs of faint old stars wrapped round the galaxy
   on inclined great circles (the halo's fossil record: globulars and dwarfs
   torn into streams), each two thirds of the way round or more, gathered
   into its progenitor at the leading end and widening and fading toward the
   trailing one. Each turns slowly about the galaxy's axis at its own rate
   and sense, so the three precess against the disc and each other. Along
   each on the progressive grid. */
const STREAMS = [
  { r: 13.5, incl: 0.7, node: 0.4, span: 3.9, rate: 0.03, w: 1.0 },
  { r: 17, incl: 1.15, node: 2.3, span: 4.6, rate: -0.024, w: 1.1 },
  { r: 20.5, incl: 2.2, node: 4.1, span: 5.2, rate: 0.018, w: 0.9 },
];
function streams(c, n, put) {
  const rng = c.rng;
  const counts = apportion(n, STREAMS.map((s) => s.w));
  STREAMS.forEach(({ r, incl, node, span, rate }, i) => {
    const m = counts[i];
    const e1 = [Math.cos(node), 0, Math.sin(node)];
    const e2 = [-Math.sin(node) * Math.cos(incl), Math.sin(incl), Math.cos(node) * Math.cos(incl)];
    const nrm = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const a0 = TAU * hash01(i * 13 + 2);
    const g = progressiveGrid(c.ahead(m));
    for (let j = 0; j < m; j++) {
      const u = (g[j] + 0.5) / m;
      // The leading 8% is the progenitor: the same dots gathered into a knot.
      const head = u < 0.08;
      const a = a0 + span * (head ? 0.04 + (u - 0.04) * 0.15 : u);
      const width = head ? 0.3 : 0.35 + 0.95 * u;
      const rr = r * (1 + 0.012 * Math.sin(3 * a)) + gaussOf(g[j], 41 + i) * width;
      const off = gaussOf(g[j], 47 + i) * width;
      const ca = Math.cos(a) * rr, sa = Math.sin(a) * rr;
      put(e1[0] * ca + e2[0] * sa + nrm[0] * off, e1[1] * ca + e2[1] * sa + nrm[1] * off, e1[2] * ca + e2[2] * sa + nrm[2] * off,
        head ? rng.range(0.16, 0.34) : rng.range(0.1, 0.22) * (1 - 0.3 * u), rng.range(0.1, 0.4), 0.75, rate, 0.7);
    }
  });
}

/* Supernovae: twelve sites along the arms (lib/modes.js GALAXY_SUPERNOVAE),
   each a progenitor (a few dots at the site, kind 1) and a remnant shell
   (the rest, kind 0) baked as a small sphere of radius `seed` about the
   site, flattened toward the disc, one side brighter, a fifth of it ejecta
   inside the shell and a few knots on it, cyan oxygen with pink hydrogen
   filaments. The shader flashes the star and drives the shell out to `reach`
   over the visible part of the cycle, then hides it: for most of the cycle a
   site is one faint star. Written with putBody: the baked offsets are what
   the shader scales, and the disc's warp would be scaled with them. */
function supernovae(c, n, put) {
  const rng = c.rng;
  const { sites, seed } = GALAXY_SUPERNOVAE;
  const counts = apportion(n, sites.map((_, i) => 0.7 + 0.6 * hash01(i * 7 + 3)));
  sites.forEach(({ at }, k) => {
    const m = counts[k];
    const nStar = Math.min(m, Math.max(4, Math.round(m * 0.07)));
    const starSpin = supernovaSpin(k, 1, PATTERN);
    const shellSpin = supernovaSpin(k, 0, PATTERN);
    for (let j = 0; j < nStar; j++) {
      const r3 = 0.02 * Math.abs(rng.bell());
      const cz = rng.range(-1, 1), sz = Math.sqrt(Math.max(0, 1 - cz * cz)), ph = rng.range(0, TAU);
      put(at[0] + r3 * sz * Math.cos(ph), at[1] + r3 * cz, at[2] + r3 * sz * Math.sin(ph),
        j === 0 ? 0.72 : rng.range(0.3, 0.5), rng.range(0.0, 0.08), 0.3, starSpin, 1);
    }
    const nShell = m - nStar;
    const { p, rank } = jittered(c.ahead(nShell), 3, 0.7, 1901 + k * 17);
    const bright = TAU * hash01(k * 11 + 5);
    for (let j = 0; j < nShell; j++) {
      const cz = 2 * p[j * 3] - 1, sz = Math.sqrt(Math.max(0, 1 - cz * cz));
      let ph = TAU * p[j * 3 + 1];
      const knotty = rank[j] % 9 === 0;
      if (knotty) { const ka = TAU * ((Math.floor(p[j * 3 + 1] * 5) + 0.5) / 5); ph = ka + (ph - ka) * 0.15; }
      const inner = rank[j] % 5 === 0;
      const rr = inner ? 0.35 + 0.5 * p[j * 3 + 2] : 0.92 + 0.1 * p[j * 3 + 2];
      const side = 0.6 + 0.4 * Math.cos(ph - bright);
      put(at[0] + seed * rr * sz * Math.cos(ph), at[1] + seed * rr * cz * 0.45, at[2] + seed * rr * sz * Math.sin(ph),
        rng.range(0.2, 0.34) * side * (inner ? 0.7 : 1), rank[j] % 4 === 0 ? rng.range(2.9, 2.98) : rng.range(2.14, 2.3), 0.3, shellSpin, 0.9);
    }
  });
}

// The outer arm: arm 0 runs on past the disc, faint and broken, far round
// the side away from the companion.
function outerArm(c, n, put) {
  const rng = c.rng;
  const g = progressiveGrid(c.ahead(n));
  for (let j = 0; j < n; j++) {
    const u = (g[j] + 0.5) / n;
    const r = R_OUT * (0.95 + 0.5 * u);
    const knotty = 0.5 + 0.5 * Math.sin(u * 37 + 1.1) * Math.sin(u * 13);
    const a = armAngle(r, 0) + (gaussOf(g[j], 21) * (0.5 + 0.9 * u) * SIG(r)) / (r * SIN_PSI);
    put(r * Math.cos(a), rng.bell() * (0.3 + 0.8 * u), r * Math.sin(a),
      rng.range(0.12, 0.26) * (0.6 + 0.6 * knotty) * (1 - 0.5 * u), 0.5 + 0.2 * u + rng.range(0, 0.1), 0.9, PATTERN, 0.4);
  }
}

// Supergiants: a sprinkle of bright blue-white stars along the arms.
function supergiants(c, n, put) {
  const rng = c.rng;
  const { p } = jittered(c.ahead(n), 2, 0.7, 1301);
  for (let j = 0; j < n; j++) {
    const k = p[j * 2 + 1] < 0.5 ? 0 : 1;
    const t = ARM_T[k](p[j * 2]);
    const r = armR(t);
    const a = armAngle(r, k) + (gaussOf(j, 31) * 0.8 - 0.4) * SIG(r) / (r * SIN_PSI);
    put(r * Math.cos(a), rng.bell() * 0.1, r * Math.sin(a), rng.range(0.5, 0.78), rng.range(0.45, 0.75), 0.4, PATTERN, 1);
  }
}

// Shells: faint concentric arcs round the companion, on its far side.
function shells(c, n, put) {
  const rng = c.rng;
  const radii = [3.4, 4.9, 6.6];
  const counts = apportion(n, radii);
  const away = Math.atan2(COMP[2], COMP[0]);
  radii.forEach((R, i) => {
    const g = progressiveGrid(c.ahead(counts[i]));
    for (let j = 0; j < counts[i]; j++) {
      const u = (g[j] + 0.5) / counts[i];
      // Diffuse and uneven: a shell is a faint edge of light, not a line.
      const a = away + (u - 0.5) * (1.9 - 0.3 * i) + 0.4 * (i - 1);
      const fade = Math.pow(Math.sin(Math.PI * u), 1.4);
      const rr = R * (1 + 0.05 * Math.sin(u * 9 + i * 2) + Math.abs(rng.bell()) * 0.09);
      put(COMP[0] + rr * Math.cos(a), COMP[1] + rng.bell() * 0.5 + (u - 0.5) * 1.2, COMP[2] + rr * Math.sin(a),
        rng.range(0.09, 0.16) * (0.3 + 0.7 * fade), rng.range(0.25, 0.45), 0.9, PATTERN, 0.3);
    }
  });
}

/* The named clusters: three star clusters in the disc's interarm gaps
   (lib/modes.js GALAXY_CARRIED), each with its project's name beside it,
   riding the disc's rotation without turning (the shader's carried band), so
   the names travel round with the galaxy and keep facing the camera. */
function named(c, n, put, s) {
  const rng = c.rng;
  // Every other point of the stipple: its order is an even prefix, so half
  // of it is still whole letters.
  const labels = GALAXY_CARRIED.map(({ name }) => textStipple(name, s, 0.78).filter((_, i) => i % 2 === 0));
  const labelTotal = labels.reduce((sum, l) => sum + l.length, 0);
  const knots = apportion(Math.max(0, n - labelTotal), GALAXY_CARRIED.map(() => 1));
  GALAXY_CARRIED.forEach(({ at }, i) => {
    const spin = galaxyCarrySpin(i, PATTERN);
    knot(c, knots[i], at, 0.36, 901 + i * 13, (x, y, z, rk, rr) => {
      put(x, y, z, rk % 6 === 0 ? rng.range(0.5, 0.8) : rng.range(0.16, 0.34) * Math.max(0.5, 1.2 - rr * 0.15),
        rng.range(0.0, 0.1), 0.7, spin, 0.95);
    });
    labels[i].forEach((q) => {
      const off = untilt([0, 1, 2].map((d) => VIEW.right[d] * (1.6 + q.x) + VIEW.up[d] * (q.y - 0.32)));
      put(at[0] + off[0], at[1] + off[1], at[2] + off[2], rng.range(0.26, 0.4), 0.6 + rng.bell() * 0.04, 0.7, spin, 1);
    });
  });
}

// The deep field: a few faint galaxies far behind, still.
function deep(c, n, write) {
  const rng = c.rng;
  const list = [
    [-34, 19, -40, 1.6, 0.4, 0.5], [30, -20, -55, 1.2, 0.25, -0.3], [38, 4, -70, 0.9, 0.6, 1.1],
    [-12, -24, -48, 1.0, 0.35, 0.2], [8, 24, -62, 1.4, 0.2, -0.8], [-40, -6, -75, 0.8, 0.5, 0.6],
  ];
  const counts = apportion(n, list.map((q) => q[3]));
  const G = [0, 2.45, -5.48];
  list.forEach(([rx, uy, fz, R, flat, rot], i) => {
    const at = [0, 1, 2].map((d) => G[d] + VIEW.right[d] * rx + VIEW.up[d] * uy + VIEW.f[d] * -fz);
    const { p } = jittered(c.ahead(counts[i]), 2, 0.7, 1001 + i);
    for (let j = 0; j < counts[i]; j++) {
      const r = R * Math.pow(p[j * 2], 0.9);
      const a = TAU * p[j * 2 + 1];
      const ex = r * Math.cos(a), ey = r * Math.sin(a) * flat;
      const lx = ex * Math.cos(rot) - ey * Math.sin(rot), ly = ex * Math.sin(rot) + ey * Math.cos(rot);
      const w = untilt([0, 1, 2].map((d) => at[d] + VIEW.right[d] * lx + VIEW.up[d] * ly));
      write(w[0], w[1], w[2], rng.range(0.2, 0.4) * (1 - 0.6 * r / R), rng.range(0.1, 0.5), 0.9, 0, 0.5);
    }
  });
}

/* The inflow (fourth cut, 2026-09-30): each of the two arms carries a
   bright spine of light streaming inward along it from the rim to the
   nucleus, the white hole's arms run inward (lib/modes.js GALAXY_WHIRL): a
   jittered band placed by rank (even along the arm at every rung), the scatter
   across the arm only, on the convex side where the arm's stars sit and clear
   of the lane, beaded so the beads flow with it, a supergiant in every nine.
   It rises out of the outer disc and dissolves into the nucleus, and turns
   with the pattern, so the spiral itself does not change: its light pours in.
   position carries each particle's place along the arm, its offset across it
   and its height, not a place: the shader (shaders/effects.js
   galaxyWhirlShape) lays the arm. Shares from the glow (0.09 -> 0.066), the
   halo (0.04 -> 0.03), the field (0.03 -> 0.024), the outer disc (0.018 ->
   0.012) and the outer dust (0.03 -> 0.026). */
const triV = (p) => (p < 0.5 ? -1 + Math.sqrt(2 * p) : 1 - Math.sqrt(2 * (1 - p)));
function inflow(c, n, write) {
  const rng = c.rng;
  apportion(n, [0.9, 1.1]).forEach((m, k) => {
    const { p, rank } = jittered(c.ahead(m), 2, 0.7, 2201 + k * 13);
    for (let j = 0; j < m; j++) {
      const u = p[j * 2];
      const gap = 0.55 + 0.45 * Math.pow(Math.sin(u * Math.PI * (9 + 2 * k) + k * 1.3), 2);
      const giant = rank[j] % 9 === 0;
      write(u, triV(p[j * 2 + 1]), rng.bell(),
        (giant ? rng.range(0.46, 0.7) : rng.range(0.2, 0.38)) * gap,
        0.5, 0.25 + 0.6 * u, galaxyWhirlSpin(k), giant ? 1 : 0.9);
    }
  });
}

export const galaxy = {
  seed: 0x6606,
  touch: { mode: 1, radius: 11, strength: 3.0 },
  mode: MODE.SPIN_Y,
  pivot: [0, 0, CENTRE_Z],
  tilt: TILT,
  warmRadius: 26,
  build(c) {
    const s = c.count / 100000;
    const [nNuc, nBulge, nGlow, nArms, nThird, nField, nHii, nBlue, nBridge, nComp, nPlume, nOuter, nNeb, nBurst, nFountain,
      nSpurs, nNuclear, nOuterArm, nGiants, nShells, nHalo, nGlob, nDust, nNamed, nDeep, nTail, nStreams, nSupernovae, nFlow, nSky] =
      c.split([0.035, 0.08, 0.066, 0.13, 0.03, 0.024, 0.03, 0.03, 0.025, 0.05, 0.015, 0.012, 0.06, 0.012, 0.025,
        0.025, 0.01, 0.012, 0.008, 0.01, 0.03, 0.01, 0.026, 0.053, 0.015, 0.035, 0.02, 0.028, 0.05, 0.039]);
    // The spiral is written about the galaxy's centre and lifted by the disc's
    // warp; the companion and what belongs to it (putBody) sit off the disc
    // and take no warp; the still layers are in world space (already
    // untilted).
    const put = (x, y, z, size, tint, stagger, spin, rigidity) => c.write(x, y + warpAt(x, z), z + CENTRE_Z, size, tint, stagger, spin, rigidity);
    const putBody = (x, y, z, size, tint, stagger, spin, rigidity) => c.write(x, y, z + CENTRE_Z, size, tint, stagger, spin, rigidity);
    const write = (x, y, z, size, tint, stagger, spin, rigidity) => c.write(x, y, z, size, tint, stagger, spin, rigidity);
    nucleus(c, nNuc, put);
    bulge(c, nBulge, put);
    glow(c, nGlow, put);
    arms(c, nArms, put);
    thirdArm(c, nThird, put);
    field(c, nField, put);
    hii(c, nHii, put);
    blue(c, nBlue, put);
    bridge(c, nBridge, putBody);
    companion(c, nComp, putBody);
    plume(c, nPlume, putBody);
    outer(c, nOuter, put);
    nebulae(c, nNeb, put);
    starburst(c, nBurst, put);
    fountain(c, nFountain, put);
    spurs(c, nSpurs, put);
    nuclear(c, nNuclear, put);
    outerArm(c, nOuterArm, put);
    supergiants(c, nGiants, put);
    shells(c, nShells, putBody);
    halo(c, nHalo, putBody);
    globulars(c, nGlob, putBody);
    outerDust(c, nDust, put);
    tidalTail(c, nTail, putBody);
    streams(c, nStreams, putBody);
    supernovae(c, nSupernovae, putBody);
    named(c, nNamed, putBody, s);
    deep(c, nDeep, write);
    inflow(c, nFlow, write);
    backdrop(c, nSky, {
      ...cameraOf(PROJECTS),
      aspect: 2.1,
      jitter: 0.7,
      also: [{ ...cameraOf(PROJECTS_REDUCED), aspect: 1.9 }],
      depth: [96, 140],
      size: [0.2, 0.8],
      lean: 2.6,
      tint: [0, 0.12],
      pulse: [0.88, 1],
      mode: MODE.SPIN_Y,
      tilt: TILT,
    });
  },
};
