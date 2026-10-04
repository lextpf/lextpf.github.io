
import { makeRng, TAU } from '../lib/random.js';
import { hash01 } from '../lib/sampling.js';
import { STACK_PIVOT, STACK_GEOM, STACK_FRAMES, stackCentre } from '../lib/modes.js';

/* ==========================================================================
   CODE KIT: the shared parts of the three code constellations

   mainfn (hero), program (contact) and callgraph (overview) are one program
   seen three ways: `int main() {}`, the short program it grows into, and the
   call graph of the functions that program calls. The codex (career) then
   spells the same universe out in full C++. All three are built here, from
   the same glyphs and the same plan, so a particle can keep its identity from
   one to the next.

   - Constellation glyphs. A character is rasterised once with the page's
     monospace stack and reduced to a drawing: a few stars on its stroke
     centreline (farthest-point sampling from its extremity, so stroke ends
     and corners come first), link lines of points between stars whose
     segment stays on the stroke (a relative neighbourhood graph over the
     on-ink segments, so rings close and bars do not double), and a sparse
     stipple of the stroke core. Stars lead, links follow, stipple fills.
   - One text block, written first by all three generators. Write j lands in
     the same slot in every formation (the registry's shared shuffle), so
     what write j is in the hero, in contact and in overview is a decision
     made once, here, in the plan.
   - Construction by departure. The shader decides when a particle leaves
     from its slot seed alone (fract(aSeed * 317.71) * the chapter's
     stagger). The plan reads the same seeds (particle-system.js,
     makeRng(0x0ff1ce), one per slot) and hands every point the write whose
     departure matches the moment its token should be built: the line forms,
     the closing brace drops, then each token of the body is emitted in
     reading order, skeleton first. Nothing in the shader changes; the hero
     chapter's stagger (0.8) narrows each particle's window so the tokens
     read one after another.
   - Every rung. Stars take writes whose slot is below the 37k cut, links
     below the 68k cut, stipple anything: a lower rung loses fill before it
     loses a letter.
   ========================================================================== */

export const TINT = Object.freeze({ KW: 0.92, FN: 0.6, PLAIN: 0.24, PP: 0.8, LIT: 0.46, EDGE: 0.84 });
const { KW, FN, PLAIN, PP, LIT } = TINT;

export const TEXT_SHARE = 0.55;
export const textBlock = (count) => Math.floor(count * TEXT_SHARE);

const PX = 64;
const INK = 200;
const FONT = `${PX}px Consolas, Menlo, 'Courier New', monospace`;
const LINK_STEP = 0.075;
// Ink points per cell of core ink at one world unit per character: the codex's
// density (its blocks run 1,100-2,600 per world unit of ink).
const STIPPLE_DENSITY = 1700;
const MAX_STARS = 12;
const R2A = 0.7548776662466927;
const R2B = 0.5698402909980532;

const vdc = (i) => {
  let r = 0;
  for (let f = 0.5; i > 0; i >>= 1, f *= 0.5) if (i & 1) r += f;
  return r;
};

function context2d(w, h) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas.getContext('2d', { willReadFrequently: true });
}

const EMPTY = Object.freeze({ stars: [], links: [], stipple: [] });

// Without a canvas (Node, the content test) a glyph is a short vertical bar.
function fallbackGlyph() {
  const links = [];
  for (let i = 0; i < 12; i++) links.push([0, 0.05 + 0.62 * vdc(i + 1)]);
  return { stars: [[0, 0.05], [0, 0.36], [0, 0.67]], links, stipple: [] };
}

/* One character as a constellation, in cell units: x from the cell centre, y
   up from the baseline, one unit = one character advance. */
function buildGlyph(ch) {
  if (ch === ' ') return EMPTY;
  const probe = context2d(4, 4);
  if (!probe) return fallbackGlyph();
  probe.font = FONT;
  const adv = probe.measureText('M').width || PX * 0.55;
  const pad = Math.ceil(PX * 0.25);
  const W = Math.ceil(adv + 2 * pad);
  const H = Math.ceil(PX * 1.5);
  const base = Math.round(PX * 1.12);
  const ctx = context2d(W, H);
  ctx.font = FONT;
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(ch, pad + (adv - ctx.measureText(ch).width) / 2, base);
  const data = ctx.getImageData(0, 0, W, H).data;
  const A = new Uint8Array(W * H);
  let n = 0;
  for (let i = 0; i < W * H; i++) {
    A[i] = data[i * 4 + 3];
    if (A[i] > INK) n++;
  }
  if (n < 4) return fallbackGlyph();
  const ink = (x, y) => x >= 0 && y >= 0 && x < W && y < H && A[y * W + x] > INK;
  const inkIdx = new Int32Array(n);
  for (let i = 0, k = 0; i < W * H; i++) if (A[i] > INK) inkIdx[k++] = i;

  // Stroke width: the median of the shorter run through a spread of ink pixels.
  const runs = [];
  const probes = Math.min(60, n);
  for (let s = 0; s < probes; s++) {
    const i = inkIdx[Math.floor(((s + 0.5) / probes) * n)];
    const x = i % W, y = (i / W) | 0;
    let l = x, r = x, u = y, d = y;
    while (ink(l - 1, y)) l--;
    while (ink(r + 1, y)) r++;
    while (ink(x, u - 1)) u--;
    while (ink(x, d + 1)) d++;
    runs.push(Math.min(r - l + 1, d - u + 1));
  }
  runs.sort((a, b) => a - b);
  const sw = Math.max(2, runs[runs.length >> 1]);
  const toCell = (x, y) => [(x - pad - adv / 2) / adv, (base - y) / adv];

  // Centreline candidates: ink whose neighbours 0.4 stroke widths away are ink.
  const e = Math.max(1, Math.floor(sw * 0.4));
  let cand = [];
  for (let k = 0; k < n; k++) {
    const i = inkIdx[k], x = i % W, y = (i / W) | 0;
    if (ink(x - e, y) && ink(x + e, y) && ink(x, y - e) && ink(x, y + e)) cand.push(i);
  }
  if (cand.length < 2) cand = Array.from(inkIdx);
  const step = Math.max(1, Math.floor(cand.length / 1200));
  const C = [];
  for (let k = 0; k < cand.length; k += step) C.push([(cand[k] % W) + 0.5, ((cand[k] / W) | 0) + 0.5]);

  // Stars: farthest-point sampling, starting at the extremity.
  const K = Math.max(1, Math.min(MAX_STARS, Math.round(n / (sw * adv * 0.4))));
  let cx = 0, cy = 0;
  for (const p of C) { cx += p[0]; cy += p[1]; }
  cx /= C.length; cy /= C.length;
  let cur = 0, far = -1;
  C.forEach((p, k) => {
    const d = (p[0] - cx) ** 2 + (p[1] - cy) ** 2;
    if (d > far) { far = d; cur = k; }
  });
  const dist = new Float64Array(C.length).fill(Infinity);
  const S = [];
  for (let s = 0; s < K && S.length < C.length; s++) {
    S.push(C[cur]);
    let best = -1, bestK = 0;
    for (let k = 0; k < C.length; k++) {
      const d = (C[k][0] - C[cur][0]) ** 2 + (C[k][1] - C[cur][1]) ** 2;
      if (d < dist[k]) dist[k] = d;
      if (dist[k] > best) { best = dist[k]; bestK = k; }
    }
    if (best < 1) break;
    cur = bestK;
  }

  // Links: segments that stay on the (slightly dilated) stroke, pruned to a
  // relative neighbourhood graph.
  const rr = Math.max(1, Math.round(sw * 0.35));
  const soft = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) soft[i] = A[i] > 40 ? 1 : 0;
  const tmp = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 0;
    for (let d = -rr; d <= rr && !v; d++) { const xx = x + d; if (xx >= 0 && xx < W && soft[y * W + xx]) v = 1; }
    tmp[y * W + x] = v;
  }
  const near = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 0;
    for (let d = -rr; d <= rr && !v; d++) { const yy = y + d; if (yy >= 0 && yy < H && tmp[yy * W + x]) v = 1; }
    near[y * W + x] = v;
  }
  const onInk = (a, b) => {
    for (let t = 0; t <= 20; t++) {
      const x = Math.floor(a[0] + (b[0] - a[0]) * t / 20);
      const y = Math.floor(a[1] + (b[1] - a[1]) * t / 20);
      if (x < 0 || y < 0 || x >= W || y >= H || !near[y * W + x]) return false;
    }
    return true;
  };
  const m = S.length;
  const D = (i, j) => Math.hypot(S[i][0] - S[j][0], S[i][1] - S[j][1]);
  let nn = 0;
  for (let i = 0; i < m; i++) {
    let b = Infinity;
    for (let j = 0; j < m; j++) if (j !== i) b = Math.min(b, D(i, j));
    if (b < Infinity) nn = Math.max(nn, b);
  }
  const maxLen = Math.max(nn * 1.6, adv * 0.35);
  const V = [];
  for (let i = 0; i < m; i++) V.push(new Uint8Array(m));
  for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) {
    if (D(i, j) <= maxLen && onInk(S[i], S[j])) V[i][j] = V[j][i] = 1;
  }
  const edges = [];
  for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) {
    if (!V[i][j]) continue;
    const dij = D(i, j);
    let redundant = false;
    for (let k = 0; k < m && !redundant; k++) {
      if (k === i || k === j) continue;
      if (V[i][k] && V[j][k] && D(i, k) < dij && D(j, k) < dij) redundant = true;
    }
    if (!redundant) edges.push([i, j]);
  }
  const links = [];
  edges.forEach(([i, j], ei) => {
    const a = toCell(S[i][0], S[i][1]), b = toCell(S[j][0], S[j][1]);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const cnt = Math.max(1, Math.floor(len / LINK_STEP));
    for (let k = 0; k < cnt; k++) {
      const t = (k + 0.5) / cnt;
      links.push({ p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], key: vdc(k + 1) + ei * 1e-5 });
    }
  });
  links.sort((p, q) => p.key - q.key);

  // Ink: the codex's stipple. R2 over the raster, kept where the bilinear
  // alpha at the sub-pixel position is stroke core (above 200 of 255), so the
  // antialiased fringe never scatters points around the letter. Every prefix
  // is an even subset of the same ink.
  const want = Math.round((n / (adv * adv)) * STIPPLE_DENSITY);
  const stipple = [];
  let u = 0.5, v = 0.5;
  for (let k = 0, limit = Math.ceil(want * (W * H) / n) * 3 + 4000; stipple.length < want && k < limit; k++) {
    u += R2A; v += R2B;
    if (u >= 1) u -= 1;
    if (v >= 1) v -= 1;
    const x = u * W, y = v * H;
    const fx = x > 0.5 ? x - 0.5 : 0, fy = y > 0.5 ? y - 0.5 : 0;
    const x0 = Math.min(W - 1, fx | 0), y0 = Math.min(H - 1, fy | 0);
    const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
    const tx = fx - x0, ty = fy - y0;
    const a = (A[y0 * W + x0] * (1 - tx) + A[y0 * W + x1] * tx) * (1 - ty) + (A[y1 * W + x0] * (1 - tx) + A[y1 * W + x1] * tx) * ty;
    if (a > INK) stipple.push(toCell(x, y));
  }
  return { stars: S.map((p) => toCell(p[0], p[1])), links: links.map((l) => l.p), stipple };
}

const GLYPHS = new Map();
function glyph(ch) {
  let g = GLYPHS.get(ch);
  if (!g) {
    g = buildGlyph(ch);
    GLYPHS.set(ch, g);
  }
  return g;
}

/* A glyph's ink at rung scale s (count / 100k) and advance cw: the R2
   prefix the codex would draw at that size. `kind` is the slot tier the
   point asks for (0 below the 37k cut, 1 below 68k, 2 anywhere), so a lower
   rung keeps an even prefix of every letter. */
function glyphPoints(ch, s, cw) {
  const g = glyph(ch);
  const src = g.stipple.length ? g.stipple : g.links.concat(g.stars);
  const n = Math.round(src.length * Math.min(1, s) * Math.min(1, cw * cw));
  const out = [];
  for (let i = 0; i < n; i++) {
    const rank = i / Math.max(1, n);
    out.push({ lx: src[i][0], ly: src[i][1], kind: rank < 0.37 ? 0 : rank < 0.68 ? 1 : 2, rank });
  }
  return out;
}

/* A line of text as codex-quality stipple, in world units from its left end
   on the baseline, x along the line and y up; `kind` is the slot tier. */
export function textStipple(text, s, cw) {
  const out = [];
  [...text].forEach((ch, i) => glyphPoints(ch, s, cw).forEach((p) => out.push({ x: (i + 0.5 + p.lx) * cw, y: p.ly * cw, kind: p.kind })));
  return out;
}

/* Split authored runs into tokens with their column. A run is
   [text, tint, id]; whitespace runs only advance the column. */
function tokenize(runs, line) {
  const out = [];
  let col = 0;
  for (const [t, tint = PLAIN, id] of runs) {
    if (t.trim()) out.push({ text: t, tint, id: id || `L${line}c${col}`, line, col });
    col += t.length;
  }
  return out;
}

/* --- The program ---------------------------------------------------------- */

export const PROGRAM_LINES = [
  { scope: -1, runs: [['#include', PP, 'include'], [' '], ['<cosmos>', LIT, 'header']] },
  { scope: 0, runs: [] },
  { scope: 0, runs: [['int', KW, 'int'], [' '], ['main', FN, 'main'], ['(', PLAIN, 'lp'], [')', PLAIN, 'rp'], [' '], ['{', PLAIN, 'lb']] },
  { scope: 1, runs: [['  '], ['auto', KW], [' '], ['u'], [' '], ['='], [' '], ['big_bang', FN, 'big_bang'], ['()'], [';']] },
  { scope: 1, runs: [['  '], ['while', KW], [' '], ['('], ['u'], ['.'], ['alive', FN, 'alive'], ['()'], [')']] },
  { scope: 2, runs: [['    '], ['u'], ['.'], ['evolve', FN, 'evolve'], ['('], ['dt'], [')'], [';']] },
  { scope: 1, runs: [['  '], ['return', KW], [' '], ['0', LIT], [';']] },
  { scope: 0, runs: [['}', PLAIN, 'rb']] },
];
// The hero's two lines, `int` over `main() {...}`: the tokens of line 2 and
// the closing brace, each at its [row, column] in the hero's layout. The
// three dots are the hero's own: they are what the body grows out of.
const MINIMAL = ['int', 'main', 'lp', 'rp', 'lb'];
const HERO_AT = { int: [0, 0], main: [1, 0], lp: [1, 4], rp: [1, 5], lb: [1, 7], rb: [1, 11] };
const HERO_DOTS = [8, 9, 10];
const HERO_LH = 1.9;

export const CODE = Object.freeze({ x0: -9.5, y2: 1.5, lh: 2.1, cw: 1.0, depth: 1.6, curve: 0.012 });
const XC = CODE.x0 + 11;
const lineY = (l) => CODE.y2 - (l - 2) * CODE.lh;
const lineZ = (l, x) => PROGRAM_LINES[l].scope * CODE.depth - CODE.curve * (x - XC) * (x - XC);
export const PROGRAM_PIVOT = [XC, lineY(4.5), 0];
// The hero block's anchor (the first column of `main`'s baseline) and scale:
// it sits where the crystal did, right of the hero's text, and is drawn at
// HERO_SCALE because the hero camera is 62 units out. Raised by twice the
// block's own height (two lines of HERO_LH plus a cap height, at scale).
const HERO_ORIGIN = [-9.4, -0.6 + 2.0 * (HERO_LH + 0.75) * 1.5, 0];
const HERO_SCALE = 1.5;
export const MAIN_PIVOT = [HERO_ORIGIN[0] + 6 * HERO_SCALE, HERO_ORIGIN[1] + 1.2 * HERO_SCALE, 0];

const placeProgram = (line, col, lx, ly) => {
  const x = CODE.x0 + (col + 0.5 + lx) * CODE.cw;
  return [x, lineY(line) + ly * CODE.cw, lineZ(line, x)];
};

/* --- Seeds and the slot pool ---------------------------------------------- */

const SEEDS = new Map();
function slotSeeds(count) {
  let s = SEEDS.get(count);
  if (!s) {
    // particle-system.js: one seed per slot, in slot order, from this rng.
    const rng = makeRng(0x0ff1ce);
    s = new Float32Array(count);
    for (let i = 0; i < count; i++) s[i] = rng.unit();
    SEEDS.set(count, s);
  }
  return s;
}
const F317 = Math.fround(317.71);
const departure = (seed) => {
  const v = Math.fround(seed * F317);
  return v - Math.floor(v);
};

/* The block's writes, sorted by departure, in three nested tiers of slot
   rank: tier 0 survives the 37k cut, tier 1 the 68k cut, tier 2 is the rest.
   take(tier, d) hands out the unused write in that tier (or a looser one)
   whose departure is the first at or after d. */
class SlotPool {
  constructor(slots, count) {
    const seeds = slotSeeds(count);
    this.n = slots.length;
    this.used = new Uint8Array(this.n);
    this.d = new Float32Array(this.n);
    for (let j = 0; j < this.n; j++) this.d[j] = departure(seeds[slots[j]]);
    const tier = (s) => (s < 0.37 * count ? 0 : s < 0.68 * count ? 1 : 2);
    this.lists = [0, 1, 2].map((t) => {
      const idx = [];
      for (let j = 0; j < this.n; j++) if (tier(slots[j]) <= t) idx.push(j);
      idx.sort((a, b) => this.d[a] - this.d[b]);
      const L = Int32Array.from(idx);
      const nxt = new Int32Array(L.length + 1);
      for (let i = 0; i <= L.length; i++) nxt[i] = i;
      return { L, d: Float32Array.from(idx, (j) => this.d[j]), nxt };
    });
  }
  _find(list, p) {
    const { L, nxt } = list;
    let q = p;
    while (q < L.length && (nxt[q] !== q || this.used[L[q]])) {
      if (nxt[q] === q) nxt[q] = q + 1;
      q = nxt[q];
    }
    while (p < q) {
      const t = nxt[p];
      nxt[p] = q;
      p = t;
    }
    return q;
  }
  take(tier, d) {
    for (let t = tier; t < 3; t++) {
      const list = this.lists[t];
      let lo = 0, hi = list.d.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (list.d[mid] < d) lo = mid + 1;
        else hi = mid;
      }
      let q = this._find(list, lo);
      if (q >= list.L.length) {
        // Nothing left at or after d: the latest unused write before it.
        q = -1;
        for (let b = Math.min(lo, list.L.length) - 1; b >= 0; b--) if (!this.used[list.L[b]]) { q = b; break; }
        if (q < 0) continue;
      }
      if (q < list.L.length) {
        const j = list.L[q];
        this.used[j] = 1;
        return j;
      }
    }
    return -1;
  }
  claim(j) {
    this.used[j] = 1;
  }
  free() {
    const out = [];
    for (let j = 0; j < this.n; j++) if (!this.used[j]) out.push(j);
    return out;
  }
}

/* A plan: for each write of the block, where it is in one formation. */
function emptyPlan(T) {
  return {
    x: new Float32Array(T), y: new Float32Array(T), z: new Float32Array(T),
    size: new Float32Array(T), tint: new Float32Array(T), phase: new Float32Array(T),
    rig: new Float32Array(T).fill(1), token: new Int16Array(T).fill(-1),
    placed: new Uint8Array(T), spin: new Float32Array(T).fill(NaN),
  };
}
const put = (P, j, p, size, tint, phase, rig = 1) => {
  P.x[j] = p[0]; P.y[j] = p[1]; P.z[j] = p[2];
  P.size[j] = size; P.tint[j] = tint; P.phase[j] = phase; P.rig[j] = rig;
  P.placed[j] = 1;
};
// Park the writes a formation does not show on its own points at size 0, so
// a neighbour that does show them grows them out of this structure.
function parkUnused(P, rng) {
  const shown = [];
  for (let j = 0; j < P.size.length; j++) if (P.size[j] > 0) shown.push(j);
  for (let j = 0; j < P.size.length; j++) {
    if (P.placed[j]) continue;
    const k = shown.length ? shown[Math.floor(rng.unit() * shown.length)] : -1;
    // The spin goes with the position: in the call stack it says which frame
    // the point belongs to, so a parked write moves and fades with it.
    if (k >= 0) { P.x[j] = P.x[k]; P.y[j] = P.y[k]; P.z[j] = P.z[k]; P.tint[j] = P.tint[k]; P.spin[j] = P.spin[k]; }
    P.size[j] = 0;
  }
}

// The codex's dot size range (career camera, 60 units), scaled by each
// chapter's viewing distance so the type reads at the same weight.
const SIZES = { minimal: [0.26, 0.4], program: [0.2, 0.3], graph: [0.15, 0.23] };
const inkTint = (t, rng) => t + rng.bell() * 0.04;

/* --- Hero and contact: one plan -------------------------------------------- */

const PROGRAM_PLANS = new Map();

export function programPlan(count, slots) {
  const T = slots.length;
  const key = `${count}:${T}`;
  const cached = PROGRAM_PLANS.get(key);
  if (cached) return cached;

  const s = count / 100000;
  const rng = makeRng(0xc0de);
  const pool = new SlotPool(slots, count);
  const A = emptyPlan(T);
  const B = emptyPlan(T);
  const tokenIds = [];
  const idOf = (id) => {
    let i = tokenIds.indexOf(id);
    if (i < 0) { i = tokenIds.length; tokenIds.push(id); }
    return i;
  };

  const tokens = [];
  PROGRAM_LINES.forEach((ln, l) => tokenize(ln.runs, l).forEach((t) => tokens.push(t)));
  const reading = (line, col) => (line + col / 24) / PROGRAM_LINES.length;

  // Every glyph of the program with its points; the hero's glyphs (its
  // tokens of line 2, the closing brace and its own three dots) set straight
  // on a two-line grid, `int` above `main() {...}`.
  const glyphs = [];
  tokens.forEach((t) => {
    [...t.text].forEach((ch, i) => {
      glyphs.push({ token: t, ch, col: t.col + i, pts: glyphPoints(ch, s, CODE.cw) });
    });
  });
  const minimal = new Map();
  glyphs.forEach((g) => {
    const at = HERO_AT[g.token.id];
    if (at) minimal.set(g, { row: at[0], col: at[1] + (g.col - g.token.col) });
  });
  const dots = HERO_DOTS.map((col) => {
    const g = { ch: '.', col, dot: true, pts: glyphPoints('.', s, CODE.cw), token: null };
    minimal.set(g, { row: 1, col });
    return g;
  });
  const rbGlyph = glyphs.find((g) => g.token.id === 'rb');
  const placeMinimal = (g, lx, ly) => {
    const P = minimal.get(g);
    return [
      HERO_ORIGIN[0] + (P.col + 0.5 + lx) * CODE.cw * HERO_SCALE,
      HERO_ORIGIN[1] + (ly + (1 - P.row) * HERO_LH) * CODE.cw * HERO_SCALE,
      HERO_ORIGIN[2] - P.row * 0.6,
    ];
  };
  const minimalGlyphs = [...minimal.keys()];
  const centreOf = (g, place) => place(g, 0, 0.35);

  // Departure windows: the line settles, the brace drops, then the body is
  // emitted token by token in reading order.
  const emitted = tokens.filter((t) => !MINIMAL.includes(t.id) && t.id !== 'rb');
  const K = emitted.length;
  const windowOf = (t) => {
    if (MINIMAL.includes(t.id)) return [0.0, 0.1];
    if (t.id === 'rb') return [0.05, 0.1];
    const k = emitted.indexOf(t);
    return [0.16 + 0.68 * (k / Math.max(1, K - 1)), 0.1];
  };

  // Every point to place, with its departure, priority tier and both ends.
  const jobs = [];
  // The body (lines 3-6) grows out of the three dots, one after another;
  // the include line splits off `int`.
  const intG = glyphs.find((g) => g.token.id === 'int');
  let bodyK = 0;
  glyphs.forEach((g) => {
    const t = g.token;
    const [w0, w] = windowOf(t);
    const isMin = minimal.has(g);
    let src = null;
    if (!isMin) src = t.line === 0 ? intG : dots[Math.floor((bodyK++ * dots.length) / 60) % dots.length];
    g.pts.forEach((p) => {
      jobs.push({
        g, p, tier: p.kind, d: w0 + w * p.rank + rng.range(0, 0.012),
        src, token: idOf(t.id),
      });
    });
  });
  jobs.sort((p, q) => p.tier - q.tier || p.d - q.d);

  for (const job of jobs) {
    const j = pool.take(job.tier, Math.min(0.999, job.d));
    if (j < 0) continue;
    const { g, p } = job;
    const tint = inkTint(g.token.tint, rng);
    put(B, j, placeProgram(g.token.line, g.col, p.lx, p.ly), rng.range(...SIZES.program), tint, reading(g.token.line, g.col));
    B.token[j] = job.token;
    if (minimal.has(g)) {
      put(A, j, placeMinimal(g, p.lx, p.ly), rng.range(...SIZES.minimal), tint, 0.5 + minimalGlyphs.indexOf(g) * 0.07);
      A.token[j] = job.token;
    } else if (job.src.dot && (job.src.drawn = (job.src.drawn || 0) + 1) <= job.src.pts.length) {
      // The dot's own ink: drawn in the hero by particles the body will take.
      const dp = job.src.pts[job.src.drawn - 1];
      put(A, j, placeMinimal(job.src, dp.lx, dp.ly), rng.range(...SIZES.minimal), inkTint(PLAIN, rng), 0.5);
      A.token[j] = job.token;
    } else {
      // Latent: on the stroke of the glyph it will split from, at size 0.
      const sp = job.src.pts[Math.floor(rng.unit() * job.src.pts.length)];
      put(A, j, placeMinimal(job.src, sp.lx, sp.ly), 0, tint, 0.5);
      A.token[j] = job.token;
    }
  }
  parkUnused(A, rng);
  parkUnused(B, rng);
  const plan = { A, B, T, tokenIds };
  PROGRAM_PLANS.set(key, plan);
  return plan;
}

/* Curves, shared by the program's scope bracket. */
function cubic(P0, P1, P2, P3, t) {
  const u = 1 - t;
  return [0, 1, 2].map((i) => u * u * u * P0[i] + 3 * u * u * t * P1[i] + 3 * u * t * t * P2[i] + t * t * t * P3[i]);
}
function sampleCurve(fn, step, s) {
  let len = 0, prev = fn(0);
  const N = 96;
  for (let i = 1; i <= N; i++) {
    const p = fn(i / N);
    len += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
    prev = p;
  }
  const cnt = Math.max(2, Math.round((len / step) * Math.min(1, 1.3 * s)));
  const out = [];
  for (let k = 0; k < cnt; k++) {
    const t = (k + 0.5) / cnt;
    out.push({ p: fn(t), t, key: vdc(k + 1) });
  }
  return { pts: out, len };
}

/* --- Career: the call stack tower ----------------------------------------- */

/* The program's call stack as a tower of frames (lib/modes.js STACK_*,
   moved by shaders/particles.js mode 10). Every frame is a floating slab
   drawn in points: a fine front outline with bright corners, a sparser back
   one and the four edges between (so it has thickness), its function's
   signature, one local and its return address, and its index on a tab.
   main is always there; the rest are pushed and popped as the program runs.
   Left of the tower: a spine with the frames' addresses (the stack grows
   down in memory as the tower grows up), the base hatched under main, and
   the stack pointer riding up and down with the depth. */
const FRAME_TEXT = {
  main: { sig: [['int', KW], [' '], ['main', FN], ['('], ['int', KW], [' argc, '], ['char', KW], ['** argv)']], local: 'argc = 1    u = {}', ret: 'ret __libc_start' },
  big_bang: { sig: [['universe'], [' '], ['big_bang', FN], ['('], ['uint64_t', KW], [' seed)']], local: 'seed = 0x5eed', ret: 'ret main+0x1c' },
  inflate: { sig: [['void', KW], [' '], ['inflate', FN], ['(space& s, '], ['double', KW], [' a)']], local: 'a = 1e30', ret: 'ret big_bang+0x44' },
  seed: { sig: [['void', KW], [' '], ['seed', FN], ['(field& f, rng& r)']], local: 'r = mt19937', ret: 'ret big_bang+0x58' },
  alive: { sig: [['bool', KW], [' '], ['alive', FN], ['() '], ['const', KW]], local: 't = 13.8e9', ret: 'ret main+0x31' },
  entropy: { sig: [['double', KW], [' '], ['entropy', FN], ['('], ['const', KW], [' universe& u)']], local: 'S = 0.93', ret: 'ret alive+0x12' },
  evolve: { sig: [['void', KW], [' '], ['evolve', FN], ['('], ['double', KW], [' dt)']], local: 'dt = 0.016', ret: 'ret main+0x3a' },
  radiate: { sig: [['void', KW], [' '], ['radiate', FN], ['(star& s, '], ['double', KW], [' dt)']], local: 'L = 3.8e26', ret: 'ret evolve+0x20' },
  gravity: { sig: [['void', KW], [' '], ['gravity', FN], ['(span<body> b, '], ['double', KW], [' G)']], local: 'G = 6.674e-11', ret: 'ret evolve+0x2c' },
  collide: { sig: [['void', KW], [' '], ['collide', FN], ['(body& a, body& b)']], local: 'v = 0.98', ret: 'ret gravity+0x71' },
};
const STACK_ADDR = ['0x7ffe40', '0x7ffe00', '0x7ffdc0', '0x7ffd80'];

const STACK_PLANS = new Map();

export function stackPlan(count, slots) {
  const T = slots.length;
  const key = count + ':' + T;
  const cached = STACK_PLANS.get(key);
  if (cached) return cached;
  const s = count / 100000;
  const dens = Math.min(1, 1.3 * s);
  const rng = makeRng(0x57ac);
  const G = emptyPlan(T);
  const pool = new SlotPool(slots, count);
  const tierOf = (q) => (q < 0.37 ? 0 : q < 0.68 ? 1 : 2);
  const jobs = [];
  const { H, D, y0, dy, spineX } = STACK_GEOM;
  const line = (a, b, step, spin, size, tint, phase, d0) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const n = Math.max(2, Math.round((len / step) * dens));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      jobs.push({
        p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
        tier: tierOf(vdc(i + 1)), size: size * (0.85 + 0.3 * rng.unit()), tint: tint + rng.range(0, 0.05), phase, spin, d: d0,
      });
    }
  };
  const bead = (p, spin, phase, d0) => {
    for (let i = 0; i < 5; i++) {
      jobs.push({ p: [p[0] + rng.bell() * 0.03, p[1] + rng.bell() * 0.03, p[2] + rng.bell() * 0.03], tier: 0, size: i ? 0.2 : 0.42, tint: 0.1, phase, spin, d: d0 });
    }
  };
  const write = (runs, x0, yb, z, cw, spin, phase, d0) => {
    tokenize(runs, 0).forEach((t) => {
      [...t.text].forEach((ch, i) => {
        glyphPoints(ch, s, cw).forEach((q) => jobs.push({
          p: [x0 + (t.col + i + 0.5 + q.lx) * cw, yb + q.ly * cw, z], tier: q.kind,
          size: rng.range(0.15, 0.24) * (0.8 + 0.5 * cw), tint: inkTint(t.tint, rng), phase, spin, d: d0,
        }));
      });
    });
  };
  const runLen = (runs) => runs.reduce((n, r) => n + r[0].length, 0);

  STACK_FRAMES.forEach((f, idx) => {
    const spin = 6000 + 100 * idx;
    const txt = FRAME_TEXT[f.id];
    const ph = f.level / 4;
    const d0 = 0.1 + 0.2 * f.level;
    const cwS = 0.4, cwL = 0.25, cwR = 0.21;
    const W = Math.max(runLen(txt.sig) * cwS, txt.local.length * cwL + txt.ret.length * cwR + 1.4) + 1.2;
    const x0 = -W / 2, x1 = W / 2, ya = -H / 2, yz = H / 2, zf = D / 2, zb = -D / 2;
    const corners = [[x0, ya], [x1, ya], [x1, yz], [x0, yz]];
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = corners[i], [bx, by] = corners[(i + 1) % 4];
      line([ax, ay, zf], [bx, by, zf], 0.06, spin, 0.16, 0.52, ph, d0);
      line([ax, ay, zb], [bx, by, zb], 0.13, spin, 0.12, 0.62, ph, d0);
      line([ax, ay, zb], [ax, ay, zf], 0.06, spin, 0.14, 0.58, ph, d0);
      bead([ax, ay, zf], spin, ph, d0);
    }
    line([x0 + 0.45, yz - 1.06, zf], [x1 - 0.45, yz - 1.06, zf], 0.16, spin, 0.1, 0.62, ph, d0);
    write(txt.sig, x0 + 0.55, yz - 0.78, zf, cwS, spin, ph, d0);
    write([[txt.local, LIT]], x0 + 0.55, yz - 1.62, zf, cwL, spin, ph, d0);
    write([[txt.ret, PLAIN]], x1 - 0.45 - txt.ret.length * cwR, ya + 0.32, zf, cwR, spin, ph, d0);
    write([['#' + f.level, PP]], x0 + 0.15, yz + 0.22, zf, 0.24, spin, ph, d0);
  });

  // The furniture: the spine with the frames' addresses, the base under
  // main, and the stack pointer (written at level 0; the shader lifts it).
  line([spineX, y0 - H / 2 - 0.9, 0], [spineX, y0 + 3 * dy + H / 2 + 0.6, 0], 0.06, 7000, 0.13, 0.55, 0.5, 0.05);
  for (let L = 0; L < 4; L++) {
    const cy = stackCentre(L)[1];
    line([spineX, cy, 0], [spineX + 0.45, cy, 0], 0.05, 7000, 0.14, 0.6, L / 4, 0.05);
    const a = STACK_ADDR[L];
    write([[a, LIT]], spineX - 0.35 - a.length * 0.22, cy - 0.08, 0, 0.22, 7000, L / 4, 0.05);
  }
  const yb = y0 - H / 2 - 0.55;
  line([-8.5, yb, 0], [8.5, yb, 0], 0.07, 7000, 0.13, 0.55, 0, 0.05);
  for (let x = -8.3; x < 8.4; x += 0.5) line([x, yb, 0], [x - 0.3, yb - 0.3, 0], 0.06, 7000, 0.1, 0.62, 0, 0.05);
  write([['sp', KW]], spineX + 0.65, y0 - 0.12, 0, 0.3, 7100, 0.9, 0.05);
  line([spineX + 1.4, y0, 0], [spineX + 2.4, y0, 0], 0.05, 7100, 0.15, 0.84, 0.9, 0.05);
  line([spineX + 2.4, y0, 0], [spineX + 2.15, y0 + 0.2, 0], 0.05, 7100, 0.15, 0.84, 0.9, 0.05);
  line([spineX + 2.4, y0, 0], [spineX + 2.15, y0 - 0.2, 0], 0.05, 7100, 0.15, 0.84, 0.9, 0.05);

  jobs.sort((a, b) => a.tier - b.tier);
  for (const jb of jobs) {
    const j = pool.take(jb.tier, Math.min(0.999, jb.d + rng.range(0, 0.35)));
    if (j < 0) break;
    put(G, j, jb.p, jb.size, jb.tint, jb.phase);
    G.spin[j] = jb.spin;
  }
  parkUnused(G, rng);
  const plan = { G, T };
  STACK_PLANS.set(key, plan);
  return plan;
}

/* Write one plan into the registry, write j at cursor j. A plan may carry a
   per-write spin (the call graph's rock by depth); otherwise `spin`. */
export function writePlan(c, P, spin) {
  for (let j = 0; j < P.size.length; j++) {
    const sp = Number.isNaN(P.spin[j]) ? spin : P.spin[j];
    c.write(P.x[j], P.y[j], P.z[j], P.size[j], P.tint[j], P.phase[j], sp, P.rig[j]);
  }
}
