import { MODE } from '../lib/modes.js';
import { TAU } from '../lib/random.js';

const SPIN = 0.012;
const CODE_SPIN = 0;

const KW = 0.92;
const FN = 0.6;
const PLAIN = 0.24;
const MATH = 0.13;

const ITEMS = [
  {
    id: 'euler', kind: 'math', fontPx: 150, worldWidth: 12,
    pos: [15, 12, 0.4], share: 0.045, size: [0.22, 0.36], glintEvery: 26,
    stagger: [0.36, 0.06],
    lines: [[{ t: 'e', tint: MATH }, { t: 'iπ', tint: MATH, sup: true }, { t: ' + 1 = 0', tint: MATH }]],
  },
  {
    id: 'code', kind: 'code', fontPx: 52, worldWidth: 24,
    pos: [14, -8, 0], share: 0.26, size: [0.24, 0.37], glintEvery: 60,
    stagger: [0.66, 0.28], still: true,
    lines: [
      [{ t: 'int', tint: KW }, { t: ' main(', tint: PLAIN }, { t: 'void', tint: KW }, { t: ') {', tint: PLAIN }],
      [{ t: '  universe', tint: FN }, { t: ' *u = ', tint: PLAIN }, { t: 'big_bang', tint: FN }, { t: '();', tint: PLAIN }],
      [{ t: '  while', tint: KW }, { t: ' (u->entropy < ', tint: PLAIN }, { t: 'S_MAX', tint: FN }, { t: ')', tint: PLAIN }],
      [{ t: '    evolve', tint: FN }, { t: '(u, dt);', tint: PLAIN }],
      [{ t: '  return', tint: KW }, { t: ' 0;', tint: PLAIN }],
      [{ t: '}', tint: PLAIN }],
    ],
  },
  {
    id: 'boltzmann', kind: 'math', fontPx: 96, worldWidth: 7,
    pos: [22, 5, -0.6], share: 0.03, size: [0.2, 0.32], glintEvery: 40,
    stagger: [0.44, 0.05],
    lines: [[{ t: 'S = k ln W', tint: MATH }]],
  },
  {
    id: 'secondlaw', kind: 'math', fontPx: 90, worldWidth: 8.2,
    pos: [-22, -9.5, 0.8], share: 0.038, size: [0.2, 0.32], glintEvery: 40,
    stagger: [0.5, 0.05],
    lines: [[{ t: 'dS/dt ≥ 0', tint: MATH }]],
  },
  {
    id: 'evolution', kind: 'math', fontPx: 100, worldWidth: 9.2,
    pos: [-11.5, -14.5, -0.4], share: 0.036, size: [0.2, 0.32], glintEvery: 40,
    stagger: [0.56, 0.05],
    lines: [[{ t: 'du = f(u, t) dt', tint: MATH }]],
  },
  {
    id: 'concepts', kind: 'code', fontPx: 42, worldWidth: 26.5,
    pos: [-15.5, 6, -0.2], share: 0.32, size: [0.22, 0.35], glintEvery: 50,
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

function fontFor(kind, px) {
  return kind === 'code'
    ? `${px}px Consolas, Menlo, 'Courier New', monospace`
    : `italic ${px}px Georgia, 'Times New Roman', serif`;
}

function raster(item) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  const px = item.fontPx;
  const lineH = Math.round(px * 1.32);
  const flat = [];
  item.lines.forEach((line) => line.forEach((run) => flat.push(run)));
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
      ctx.fillStyle = `rgb(${Math.min(250, (runIndex + 1) * step)},0,0)`;
      ctx.fillText(run.t, x, y + (run.sup ? -px * 0.42 : 0));
      x += ctx.measureText(run.t).width;
      runIndex++;
    });
  });

  const data = ctx.getImageData(0, 0, W, H).data;
  const pts = [];
  for (let yy = 0; yy < H; yy++) {
    for (let xx = 0; xx < W; xx++) {
      const i = (yy * W + xx) * 4;
      if (data[i + 3] > 110) pts.push(xx, yy, data[i]);
    }
  }
  return { pts, W, H, widths, lineH, flat, step };
}

export const codex = {
  seed: 0x4c05,
  touch: { mode: 12, radius: 2.2, strength: 0.5 },
  mode: MODE.SPIN_Y,
  build(c) {
    const [textShare, gridShare, fieldShare] =
      c.split([0.72, 0.09, 0.19]);

    const shareSum = ITEMS.reduce((a, item) => a + item.share, 0);
    const rasters = ITEMS.map((item) => raster(item));

    ITEMS.forEach((item, itemIndex) => {
      const budget = Math.floor(textShare * item.share / shareSum);
      const r = rasters[itemIndex];
      if (!r || r.pts.length < 30) {
        for (let i = 0; i < budget; i++) {
          const a = c.rng.unit() * TAU;
          const rad = 30 + 26 * c.rng.unit();
          c.write(Math.cos(a) * rad, c.rng.bell() * 12, Math.sin(a) * rad,
            c.rng.range(0.14, 0.3), c.rng.range(0, 0.2), 0.9, 0.004, 0);
        }
        return;
      }
      const M = r.pts.length / 3;
      const scale = item.worldWidth / r.W;
      const stride = M / budget;
      const [s0, sSpan] = item.stagger;
      for (let i = 0; i < budget; i++) {
        const j = Math.min(M - 1, Math.floor(i * stride + c.rng.unit() * stride));
        const xx = r.pts[j * 3];
        const yy = r.pts[j * 3 + 1];
        const run = r.flat[Math.max(0, Math.min(r.flat.length - 1, Math.round(r.pts[j * 3 + 2] / r.step) - 1))];
        const u = xx / r.W;
        const line = Math.min(item.lines.length - 1, Math.floor(yy / r.lineH));
        const order = (line + u) / item.lines.length;
        const glint = i % item.glintEvery === 0;
        c.write(
          item.pos[0] + (xx - r.W / 2) * scale + c.rng.bell() * 0.022,
          item.pos[1] - (yy - r.H / 2) * scale + c.rng.bell() * 0.022,
          item.pos[2] + c.rng.bell() * 0.05,
          glint
            ? c.rng.range(0.62, 0.95)
            : c.rng.range(item.size[0], item.size[1]) * (0.86 + 0.28 * Math.sin(u * 43 + itemIndex * 2.1)),
          glint ? Math.min(1, run.tint + 0.15) : run.tint + c.rng.bell() * 0.04,
          s0 + order * sSpan + c.rng.range(0, 0.015),
          item.still ? CODE_SPIN : SPIN,
          1
        );
      }
    });

    // Irregular chalk-dust substrate behind the type — no lattice, just a
    // soft elliptical field with depth variance.
    for (let i = 0; i < gridShare; i++) {
      const x = c.rng.range(-29, 29);
      const y = c.rng.range(-20, 20);
      const fade = Math.max(0, 1 - Math.hypot(x / 31, y / 22));
      if (fade <= 0.02) { i--; continue; }
      c.write(
        x + c.rng.bell() * 0.4,
        y + c.rng.bell() * 0.4,
        -2.4 + c.rng.bell() * 1.1,
        c.rng.range(0.06, 0.16) * (0.4 + fade),
        c.rng.range(0, 0.16),
        0.78 + fade * 0.1,
        SPIN,
        0.25
      );
    }

    for (let i = 0; i < fieldShare; i++) {
      const r = 32 + 38 * Math.pow(c.rng.unit(), 0.86);
      const theta = c.rng.unit() * TAU;
      const cosPhi = c.rng.signed();
      const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
      c.write(
        r * sinPhi * Math.cos(theta),
        r * cosPhi * 0.44,
        r * sinPhi * Math.sin(theta),
        c.rng.range(0.16, 0.42),
        c.rng.range(0, 0.1),
        0.9 + c.rng.range(0, 0.1),
        0.004,
        0
      );
    }
  },
};
