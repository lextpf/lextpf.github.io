
import { MODE } from '../lib/modes.js';
import { TAU } from '../lib/random.js';
import { CHAPTERS, REDUCED_CHAPTERS } from '../chapters.js';
import { slotRanks, roundRobin, backdrop } from '../lib/sampling.js';

/* ==========================================================================
   CODEX: C++ spelled out in points

   Two blocks of real code, rasterised with the page's monospace stack and
   stippled, a faint engineering dot lattice behind them, far dust behind
   that, and a phone's stars. Career frames it (chapters.js). The strictest
   formation to keep legible at the 37k rung.

   - Strokes, not blobs. Only the stroke core counts as ink (alpha above
     200 of 255, where the antialiased fringe would scatter points around
     every letter), and every text point has the same size range: no
     brighter glint points and no size banding across a line.
   - Ink sampled by rank. For each block, R2 candidates walk square tiles
     laid over its lines of text (square, so the stipple is isotropic), and
     those landing on core ink, judged on the bilinear alpha at their
     sub-pixel position, are accepted until the block's budget is met.
     Write j takes the accepted point of its slot rank, so every ladder cut
     keeps a low-discrepancy prefix of the same ink: the 37k rung is the
     stipple a 37k bake would draw, evenly spread over the strokes, not a
     random erosion of the full one.
   - The lattice is a true dot grid at a 1.28 u pitch inside an ellipse,
     three particles per node by slot rank (roundRobin), so every node
     survives every cut, fading toward the ellipse's rim. The nodes take
     their particles in a Halton order, so the nodes a cut leaves with one
     more particle are spread evenly, never gathered in one band.
   - The far dust is a backdrop (lib/sampling.js) in the career frame,
     widened to hold the reduced-motion career frame, behind the lattice,
     with spin 0, so it never turns out of frame.
   - A phone's stars are a second backdrop, fitted to the portrait reframe
     and kept out of every desktop frame and flight path (see below).

   Without a canvas (Node, the content test) the text falls back to a dust
   ring of the same budget.
   ========================================================================== */

const SPIN = 0.012;
const CODE_SPIN = 0;
const INK = 200;

// Tint values standing in for a syntax theme: keyword, function, plain. These
// are the 0..1 tints the shader maps onto the palette, not colours.
const KW = 0.92;
const FN = 0.6;
const PLAIN = 0.24;

// What to spell out. `share` is this item's slice of the text budget, and the
// runs within each line are the units that get individually tinted.
const ITEMS = [
  {
    id: 'code', kind: 'code', fontPx: 52, worldWidth: 24,
    pos: [14, -8, 0], share: 0.26, size: [0.24, 0.37],
    stagger: [0.66, 0.28], still: true,
    // The universe as a C++23 coroutine: its history, yielded one state at a
    // time until it runs out of order. (Contact already shows the plain loop.)
    lines: [
      [{ t: 'std::generator', tint: FN }, { t: '<universe>', tint: PLAIN }],
      [{ t: 'history', tint: FN }, { t: '(universe u) {', tint: PLAIN }],
      [{ t: '  while', tint: KW }, { t: ' (u.', tint: PLAIN }, { t: 'entropy', tint: FN }, { t: '() < ', tint: PLAIN }, { t: 'S_MAX', tint: FN }, { t: ') {', tint: PLAIN }],
      [{ t: '    co_yield', tint: KW }, { t: ' u;', tint: PLAIN }],
      [{ t: '    u = ', tint: PLAIN }, { t: 'evolve', tint: FN }, { t: '(', tint: PLAIN }, { t: 'std::move', tint: FN }, { t: '(u), dt);', tint: PLAIN }],
      [{ t: '  }', tint: PLAIN }],
      [{ t: '}', tint: PLAIN }],
    ],
  },
  {
    id: 'concepts', kind: 'code', fontPx: 42, worldWidth: 26.5,
    pos: [-15.5, 6, -0.2], share: 0.32, size: [0.22, 0.35],
    stagger: [0.04, 0.28], still: true,
    lines: [
      [{ t: 'template', tint: KW }, { t: ' <', tint: PLAIN }, { t: 'typename', tint: KW }, { t: ' T>', tint: PLAIN }],
      [{ t: 'concept', tint: KW }, { t: ' Physical = ', tint: PLAIN }, { t: 'requires', tint: KW }, { t: '(T t, ', tint: PLAIN }, { t: 'double', tint: KW }, { t: ' dt) {', tint: PLAIN }],
      [{ t: '  { t.evolve(dt) } -> ', tint: PLAIN }, { t: 'std::same_as', tint: FN }, { t: '<', tint: PLAIN }, { t: 'void', tint: KW }, { t: '>;', tint: PLAIN }],
      [{ t: '  { t.entropy() } -> ', tint: PLAIN }, { t: 'std::same_as', tint: FN }, { t: '<', tint: PLAIN }, { t: 'double', tint: KW }, { t: '>;', tint: PLAIN }],
      [{ t: '};', tint: PLAIN }],
      [{ t: ' ', tint: PLAIN }],
      [{ t: 'template', tint: KW }, { t: ' <Physical T, ', tint: PLAIN }, { t: 'std::size_t', tint: FN }, { t: ' N>', tint: PLAIN }],
      [{ t: 'constexpr void', tint: KW }, { t: ' simulate(', tint: PLAIN }, { t: 'std::span', tint: FN }, { t: '<T, N> w) {', tint: PLAIN }],
      [{ t: '  [&]<', tint: PLAIN }, { t: 'auto', tint: KW }, { t: '... I>(', tint: PLAIN }, { t: 'std::index_sequence', tint: FN }, { t: '<I...>) {', tint: PLAIN }],
      [{ t: '    (w[I].evolve(dt), ...);', tint: PLAIN }],
      [{ t: '  }(', tint: PLAIN }, { t: 'std::make_index_sequence', tint: FN }, { t: '<N>{});', tint: PLAIN }],
      [{ t: '}', tint: PLAIN }],
    ],
  },
];

const chapterOf = (list, id) => list.find((c) => c.id === id);
// The chapter that frames the codex (Overview since 2026-09-28) and the two
// it is flown between (Contact before it, Career after it).
const CAREER = chapterOf(CHAPTERS, 'overview');
const CAREER_REDUCED = chapterOf(REDUCED_CHAPTERS, 'overview');
const OVERVIEW = chapterOf(CHAPTERS, 'contact');
const OVERVIEW_REDUCED = chapterOf(REDUCED_CHAPTERS, 'contact');
const EDUCATION = chapterOf(CHAPTERS, 'career');
const EDUCATION_REDUCED = chapterOf(REDUCED_CHAPTERS, 'career');
const cameraOf = (ch) => ({
  cam: [ch.camX, ch.camY, ch.camZ], tgt: [ch.tgtX, ch.tgtY, ch.tgtZ], fov: ch.fov,
});
// The same camera as cv-universe.js reframe() stages it below 820 CSS px
// (nucleus.js and crystal.js have the same helper): pulled back 1.16x (1.34x
// in portrait) times the chapter's narrowPull, x at 0.22, the framing lifted.
// Mirrored here, so a change to reframe() has to be repeated here.
const narrowCamera = (ch, pull) => ({
  cam: [ch.camX * 0.22, ch.camY * 0.7 + 2.2, ch.camZ * pull * (ch.narrowPull || 1)],
  tgt: [ch.tgtX * 0.22, ch.tgtY, ch.tgtZ],
  fov: ch.fov,
});
// A desktop camera's line of sight as an avoided region for backdrop(): a
// frustum with no angle, seen from far behind the camera, so it keeps out
// every candidate within `reach` of the axis at any depth, behind the camera
// as well as in front of it.
const sightLine = (ch, reach) => {
  const v = [ch.tgtX - ch.camX, ch.tgtY - ch.camY, ch.tgtZ - ch.camZ];
  const l = Math.hypot(v[0], v[1], v[2]);
  return {
    cam: [ch.camX - (v[0] / l) * 400, ch.camY - (v[1] / l) * 400, ch.camZ - (v[2] / l) * 400],
    tgt: [ch.tgtX, ch.tgtY, ch.tgtZ], fov: 1e-4, aspect: 1, reach,
  };
};

function fontFor(kind, px) {
  return kind === 'code'
    ? `${px}px Consolas, Menlo, 'Courier New', monospace`
    : `italic ${px}px Georgia, 'Times New Roman', serif`;
}

/* Draw one item to an offscreen canvas and return its pixels: the alpha and
   the red channel, which carries the run identifier (see below), with the
   layout build() needs to map them back to world space and to tints.

   willReadFrequently tells the browser to keep this canvas on the CPU: it is
   written once and read back immediately, and the default GPU-backed path makes
   getImageData a stall. */
function raster(item) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  const px = item.fontPx;
  const lineH = Math.round(px * 1.32);
  const flat = [];
  item.lines.forEach((line) => line.forEach((run) => flat.push(run)));
  // Spacing between the red values used to tag runs, so they stay far enough
  // apart to survive antialiasing and be read back unambiguously.
  const step = Math.max(6, Math.floor(255 / (flat.length + 1)));

  ctx.font = fontFor(item.kind, px);
  let maxW = 0;
  const widths = item.lines.map((line) => {
    let w = 0;
    for (const run of line) {
      ctx.font = fontFor(item.kind, run.sup ? Math.round(px * 0.62) : px);
      w += ctx.measureText(run.t).width;
    }
    maxW = Math.max(maxW, w);
    return w;
  });
  const W = Math.ceil(maxW + px * 0.24);
  const H = Math.ceil(lineH * item.lines.length + px * 0.55);
  canvas.width = W;
  canvas.height = H;
  ctx.textBaseline = 'alphabetic';

  let runIndex = 0;
  item.lines.forEach((line, li) => {
    let x = px * 0.12;
    const y = lineH * li + px * 0.95;
    line.forEach((run) => {
      const size = run.sup ? Math.round(px * 0.62) : px;
      ctx.font = fontFor(item.kind, size);
      // Not a colour: the red channel is being used as a per-run identifier that
      // survives into the pixel data and comes back out as a tint.
      ctx.fillStyle = `rgb(${Math.min(250, (runIndex + 1) * step)},0,0)`;
      ctx.fillText(run.t, x, y + (run.sup ? -px * 0.42 : 0));
      x += ctx.measureText(run.t).width;
      runIndex++;
    });
  });

  const data = ctx.getImageData(0, 0, W, H).data;
  // near[i]: pixel i or one of its 8 neighbours is core ink. A sub-pixel
  // position's bilinear alpha only reads pixels in the 3x3 block around the
  // pixel it sits in, so outside `near` it cannot be ink and is rejected at
  // the cost of one lookup. reach[row]: one past the rightmost core ink in
  // each band of lineH rows (one text line each, plus the bottom margin).
  const near = new Uint8Array(W * H);
  const reach = new Int32Array(Math.ceil(H / lineH));
  let ink = 0;
  for (let y = 0; y < H; y++) {
    const row = (y / lineH) | 0;
    const ya = y > 0 ? y - 1 : 0, yb = y < H - 1 ? y + 1 : H - 1;
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] <= INK) continue;
      ink++;
      if (x >= reach[row]) reach[row] = x + 1;
      const xa = x > 0 ? x - 1 : 0, xb = x < W - 1 ? x + 1 : W - 1;
      for (let yy = ya; yy <= yb; yy++) {
        for (let xx = xa; xx <= xb; xx++) near[yy * W + xx] = 1;
      }
    }
  }
  return { data, near, reach, ink, W, H, widths, lineH, flat, step };
}

// Roberts' R2 generators (lib/sampling.js r2), stepped incrementally here:
// the ink walk visits a few hundred thousand candidates per block.
const R2A = 0.7548776662466927;
const R2B = 0.5698402909980532;

/* The accepted ink points of one raster, in rank order.

   The candidates are the R2 sequence on a square tile of side lineH, laid
   over every stretch of a text line that holds ink (each line's band, out to
   its last ink; empty lines and the space past a short line get no tile).
   Every tile takes the same R2 point in turn, tile by tile, so the first K
   candidates are each tile's first K / tiles. An R2 prefix is even on the
   torus, so tiles side by side and line bands one under another join
   without a seam: the candidates are one R2 pattern, periodic at lineH,
   isotropic because the tile is square, and the walk skips the empty page
   around the text. A candidate is kept when the bilinear alpha at its
   sub-pixel position is core ink.

   Returns x, y (raster pixels) and the red tag of the most opaque of the
   four pixels around each point, for m points. */
function inkPoints(r, m) {
  const { data, near, reach, W, H } = r;
  const T = r.lineH;
  let nT = 0;
  for (const end of reach) nT += Math.ceil(end / T);
  const tileX = new Int32Array(nT), tileY = new Int32Array(nT);
  for (let row = 0, t = 0; row < reach.length; row++) {
    for (let x0 = 0; x0 < reach[row]; x0 += T, t++) {
      tileX[t] = x0;
      tileY[t] = row * T;
    }
  }
  const xs = new Float32Array(m), ys = new Float32Array(m), tag = new Uint8Array(m);
  const limit = 4096 + Math.ceil((m * nT * T * T) / Math.max(1, r.ink)) * 4;
  let got = 0;
  let u = 0.5, v = 0.5;
  for (let k = 0; nT && got < m && k < limit; u += R2A, v += R2B) {
    if (u >= 1) u -= 1;
    if (v >= 1) v -= 1;
    const lx = u * T, ly = v * T;
    for (let t = 0; t < nT && got < m; t++, k++) {
      const x = tileX[t] + lx, y = tileY[t] + ly;
      if (x >= W || y >= H || !near[(y | 0) * W + (x | 0)]) continue;
      const fx = x > 0.5 ? x - 0.5 : 0, fy = y > 0.5 ? y - 0.5 : 0;
      const x0 = Math.min(W - 1, fx | 0), y0 = Math.min(H - 1, fy | 0);
      const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
      const tx = fx - x0, ty = fy - y0;
      const i00 = (y0 * W + x0) * 4, i10 = (y0 * W + x1) * 4, i01 = (y1 * W + x0) * 4, i11 = (y1 * W + x1) * 4;
      const a00 = data[i00 + 3], a10 = data[i10 + 3], a01 = data[i01 + 3], a11 = data[i11 + 3];
      const a = (a00 * (1 - tx) + a10 * tx) * (1 - ty) + (a01 * (1 - tx) + a11 * tx) * ty;
      if (a <= INK) continue;
      let best = i00, bestA = a00;
      if (a10 > bestA) { best = i10; bestA = a10; }
      if (a01 > bestA) { best = i01; bestA = a01; }
      if (a11 > bestA) best = i11;
      xs[got] = x;
      ys[got] = y;
      tag[got] = data[best];
      got++;
    }
  }
  return { xs, ys, tag, got };
}

// The lattice: nodes at a 1.28 u pitch inside the old sheet's ellipse and
// extent, each with its fade toward the ellipse's rim.
const PITCH = 1.28;
const NX = Math.floor(29 / PITCH), NY = Math.floor(20 / PITCH);
const NODES = (() => {
  const out = [];
  for (let iy = -NY; iy <= NY; iy++) {
    for (let ix = -NX; ix <= NX; ix++) {
      const x = ix * PITCH, y = iy * PITCH;
      const fade = 1 - Math.hypot(x / 31, y / 22);
      if (fade > 0.02) out.push([x, y, fade]);
    }
  }
  return out;
})();

/* The order the nodes take their particles in. A cut keeping K of the
   lattice's writes gives every node floor(K / nodes) particles and one more
   to the first K mod nodes nodes of this order, so that partial layer has to
   be spread as evenly as the grid itself. In row-major order it was the
   bottom rows: on the 50k rung every node below the middle of the frame drew
   twice the light of every node above it.

   A node's place is where the Halton (2, 3) sequence first lands on it, cell
   by cell over the lattice's box (nodes outside the ellipse are skipped).
   Its two coordinates are the radical inverses in bases 2 and 3, each
   evenly spread along its own axis at every prefix, so every prefix of the
   order holds close to its share of every row and every column (row means
   within 2% at 100k and 68k, 7.5% at the half-full 50k rung). R2, a
   quasi-lattice, aliases with the grid and lays the partial layer in
   diagonal streaks at half density. */
function radicalInverse(i, b) {
  let f = 1, r = 0;
  for (; i > 0; i = Math.floor(i / b)) {
    f /= b;
    r += f * (i % b);
  }
  return r;
}
const NODE_ORDER = (() => {
  const W = 2 * NX + 1, H = 2 * NY + 1;
  const cell = new Int32Array(W * H).fill(-1);
  NODES.forEach(([x, y], i) => {
    cell[(Math.round(y / PITCH) + NY) * W + Math.round(x / PITCH) + NX] = i;
  });
  const out = new Int32Array(NODES.length);
  const seen = new Uint8Array(NODES.length);
  let n = 0;
  for (let s = 1; n < NODES.length && s < 256 * W * H; s++) {
    const i = cell[Math.floor(radicalInverse(s, 3) * H) * W + Math.floor(radicalInverse(s, 2) * W)];
    if (i < 0 || seen[i]) continue;
    seen[i] = 1;
    out[n++] = i;
  }
  for (let i = 0; i < NODES.length; i++) if (!seen[i]) out[n++] = i;
  return out;
})();

export const codex = {
  seed: 0x4c05,
  touch: { mode: 12, radius: 2.2, strength: 0.5 },
  mode: MODE.SPIN_Y,
  build(c) {
    const [textShare, gridShare, fieldShare, narrowShare] =
      c.split([0.80, 0.038, 0.147, 0.015]);

    const shareSum = ITEMS.reduce((a, item) => a + item.share, 0);
    const rasters = ITEMS.map((item) => raster(item));

    ITEMS.forEach((item, itemIndex) => {
      const budget = Math.floor(textShare * item.share / shareSum);
      const r = rasters[itemIndex];
      if (!r || r.ink < 30) {
        for (let i = 0; i < budget; i++) {
          const a = c.rng.unit() * TAU;
          const rad = 30 + 26 * c.rng.unit();
          c.write(Math.cos(a) * rad, c.rng.bell() * 12, Math.sin(a) * rad,
            c.rng.range(0.14, 0.3), c.rng.range(0, 0.2), 0.9, 0.004, 0);
        }
        return;
      }
      const slots = c.ahead(budget);
      const rank = slotRanks(slots);
      const ink = inkPoints(r, slots.length);
      const scale = item.worldWidth / r.W;
      const [s0, sSpan] = item.stagger;
      // The run each red tag stands for.
      const runOf = [];
      for (let t = 0; t < 256; t++) runOf.push(r.flat[Math.max(0, Math.min(r.flat.length - 1, Math.round(t / r.step) - 1))]);
      for (let j = 0; j < slots.length; j++) {
        const k = Math.min(ink.got - 1, rank[j]);
        const xx = ink.xs[k];
        const yy = ink.ys[k];
        const run = runOf[ink.tag[k]];
        const u = xx / r.W;
        const line = Math.min(item.lines.length - 1, Math.floor(yy / r.lineH));
        const order = (line + u) / item.lines.length;
        c.write(
          item.pos[0] + (xx - r.W / 2) * scale,
          item.pos[1] - (yy - r.H / 2) * scale,
          item.pos[2],
          c.rng.range(item.size[0], item.size[1]),
          run.tint + c.rng.bell() * 0.04,
          s0 + order * sSpan + c.rng.range(0, 0.015),
          item.still ? CODE_SPIN : SPIN,
          1
        );
      }
    });

    /* The lattice: three particles per node, node = slot rank mod the node
       count, taken through NODE_ORDER, so every node keeps a particle at
       every cut down to a third of its writes (the 37k rung keeps about 37%)
       and the nodes that keep one more are spread evenly over the ellipse.
       Full size over the inner two thirds of the ellipse, fading out over
       its rim. Still, like the text, and rigid, so the noise field leaves it
       a grid. */
    {
      const node = roundRobin(c.ahead(gridShare), NODES.length);
      for (let j = 0; j < node.length; j++) {
        const [x, y, fade] = NODES[NODE_ORDER[node[j]]];
        c.write(
          x, y, -2.4,
          0.11 * Math.sqrt(Math.min(1, fade / 0.35)),
          0.1,
          0.78 + fade * 0.1,
          CODE_SPIN,
          1
        );
      }
    }

    /* The far dust, screen-uniform in the career frame (widened to hold the
       reduced career frame) at view depth 70-135, behind the lattice, where
       fog dims it. Jittered off the R2 lattice so it reads as a sky. */
    backdrop(c, fieldShare, {
      ...cameraOf(CAREER),
      aspect: 2.1,
      jitter: 0.7,
      also: [{ ...cameraOf(CAREER_REDUCED), aspect: 1.9 }],
      depth: [70, 135],
      size: [0.2, 0.8],
      lean: 2.6,
      tint: [0, 0.1],
      pulse: [0.9, 1],
      mode: MODE.SPIN_Y,
    });

    /* The phone's stars. Below 820 CSS px reframe() pulls the career camera
       back to z 158-161 in portrait (narrowPull 2), where the text and the
       backdrop lie 160-235 units away, all but lost in the fog. This layer
       is that frame's sky: screen-uniform in the portrait career frame,
       widened for its reduced twin, 50-120 units out, and only where no
       desktop camera ever looks. Every candidate inside a desktop career
       frustum (full or reduced, any window up to 2.7:1, widened by parallax
       and breath) is skipped, and so is every candidate within 20 x 10 units
       of the line of sight of a camera the codex is seen or left from
       (career, and the overview and education cameras it flies between,
       full and reduced). Most of the layer lies behind the desktop career
       camera, so the flights in and out cross that camera's plane; kept off
       those lines of sight, they cross it outside the frame instead of
       swelling through the middle of it. A desktop never has the layer in
       frame at rest; a phone gets stars in the top and bottom thirds of the
       frame, as the nucleus's and the hero's phone layers give it (the
       middle third is the desktop camera's line of sight). */
    {
      const A = 2.7;
      const sway = (ch, parallax) => {
        const t = Math.tan((ch.fov * Math.PI) / 360);
        // parallax + breath (0.55, 0.4, and 0.35 along the view) + 0.3 to spare
        return [parallax + 0.55 + 0.35 * t * A + 0.3, parallax * 0.7 + 0.4 + 0.35 * t + 0.3];
      };
      const SIGHT = [20, 10];
      backdrop(c, narrowShare, {
        ...narrowCamera(CAREER, 1.34),
        aspect: 0.6,
        jitter: 0.7,
        also: [{ ...narrowCamera(CAREER_REDUCED, 1.34), aspect: 0.6 }],
        avoid: [
          { ...cameraOf(CAREER), aspect: A, reach: sway(CAREER, 1.6 + Math.abs(CAREER.camZ) * 0.02) },
          { ...cameraOf(CAREER_REDUCED), aspect: A, reach: sway(CAREER_REDUCED, 0) },
          ...[CAREER, CAREER_REDUCED, OVERVIEW, OVERVIEW_REDUCED, EDUCATION, EDUCATION_REDUCED]
            .map((ch) => sightLine(ch, SIGHT)),
        ],
        depth: [50, 120],
        size: [0.2, 0.8],
        lean: 2.6,
        tint: [0, 0.1],
        pulse: [0.9, 1],
        mode: MODE.SPIN_Y,
      });
    }
  },
};
