// Inverse of the formation tilt (THREE Euler 'XYZ'): author annotation points
// pre-rotated so they render screen-upright after the shader applies the tilt.
export function counterTilt(tilt) {
  const x = tilt?.x || 0, y = tilt?.y || 0, z = tilt?.z || 0;
  const a = Math.cos(x), b = Math.sin(x), cc = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  const m = [
    cc * e, -cc * f, d,
    af + be * d, ae - bf * d, -b * cc,
    bf - ae * d, be + af * d, a * cc,
  ];
  return (p) => [
    m[0] * p[0] + m[3] * p[1] + m[6] * p[2],
    m[1] * p[0] + m[4] * p[1] + m[7] * p[2],
    m[2] * p[0] + m[5] * p[1] + m[8] * p[2],
  ];
}

// Rasterize a short string; normalized outline points in [-0.5..0.5].
function textPoints(str, target) {
  const cv = document.createElement('canvas');
  let ctx = cv.getContext('2d', { willReadFrequently: true });
  const px = 72;
  const font = `600 ${px}px "Avenir Next", "Segoe UI", sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(str).width) + 10;
  const h = Math.ceil(px * 1.4);
  cv.width = w; cv.height = h;
  ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.font = font;
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(str, 5, h / 2);
  const img = ctx.getImageData(0, 0, w, h).data;
  const raw = [];
  for (let yy = 0; yy < h; yy += 2) {
    for (let xx = 0; xx < w; xx += 2) {
      if (img[(yy * w + xx) * 4 + 3] > 120) raw.push([xx / w - 0.5, 0.5 - yy / h]);
    }
  }
  const stride = Math.max(1, raw.length / target);
  const pts = [];
  for (let i = 0; i < raw.length; i += stride) pts.push(raw[Math.floor(i)]);
  return { pts, aspect: w / h };
}

function writeGlyphs(c, inv, str, cx, cy, worldW, share, opts) {
  const { pts, aspect } = textPoints(str, share);
  const worldH = worldW / aspect;
  pts.forEach(([nx, ny]) => {
    const t = nx + 0.5;
    const p = inv([cx + nx * worldW + c.rng.bell() * 0.02, cy + ny * worldH + c.rng.bell() * 0.02, c.rng.bell() * 0.06]);
    c.write(
      p[0], p[1], p[2],
      c.rng.chance(0.03) ? c.rng.range(0.2, 0.28) : c.rng.range(0.09, 0.15),
      c.rng.range(opts.tint[0], opts.tint[1]),
      opts.stag + t * 0.08 + c.rng.range(0, 0.01),
      0,
      0.7
    );
  });
}

// Skeletal formula of sulfuric acid matching the reference drawing:
//
//      O
//      ‖
//  O = S ⁄⁄⁄ OH   (hashed wedge right)
//      ◢
//       OH        (solid wedge down)
//
// Element symbols font-rasterized in blue-white; every bond stroke is GOLD
// (bond lines are shared pairs — same semantics as the 3D bond rings).
export function writeH2SO4Skeletal(c, share, opts) {
  const inv = counterTilt(opts.tilt);
  const S = opts.scale ?? 1;
  const xS = opts.x ?? 0;
  const yS = opts.y;
  const gold = (x, y, size, stag) => {
    const p = inv([xS + x * S + c.rng.bell() * 0.045, yS + y * S + c.rng.bell() * 0.045, c.rng.bell() * 0.06]);
    c.write(p[0], p[1], p[2], size, c.rng.range(2.64, 2.74), stag + c.rng.range(0, 0.01), 0, 0.9);
  };
  const glyph = (str, x, y, w, frac, stag) =>
    writeGlyphs(c, inv, str, xS + x * S, yS + y * S, w * S, Math.floor(share * frac), { tint: [0.55, 0.85], stag });
  // straight strokes — crisp lines, particle texture only from the tiny jitter
  const line = (x0, y0, x1, y1, frac, stag) => {
    const n = Math.floor(share * frac);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      gold(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t,
        i % 13 === 0 ? c.rng.range(0.18, 0.26) : c.rng.range(0.1, 0.17),
        0.74 + t * 0.015);
    }
  };
  // atoms — generous clearance between letterforms and strokes
  glyph('S', 0, 0, 1.9, 0.095, 0.72);
  glyph('O', 0, 4.1, 1.9, 0.08, 0.7);
  glyph('O', -4.3, 0, 1.9, 0.08, 0.71);
  glyph('OH', 5.35, -1.25, 3.4, 0.125, 0.73);
  glyph('OH', 1.7, -5.15, 3.4, 0.125, 0.74);
  // double bond up (two parallel verticals)
  line(-0.19, 1.7, -0.19, 2.75, 0.04, 0);
  line(0.19, 1.7, 0.19, 2.75, 0.04, 0);
  // double bond left (two parallel horizontals)
  line(-2.85, 0.19, -1.5, 0.19, 0.04, 0);
  line(-2.85, -0.19, -1.5, -0.19, 0.04, 0);
  // hashed wedge to OH right: straight perpendicular ticks widening toward OH
  const TICKS = 6;
  const hx0 = 1.35, hy0 = -0.35, hx1 = 2.9, hy1 = -0.9;
  const perTick = Math.floor(share * 0.05 / TICKS);
  for (let k = 0; k < TICKS; k++) {
    const t = k / (TICKS - 1);
    const cxx = hx0 + (hx1 - hx0) * t;
    const cyy = hy0 + (hy1 - hy0) * t;
    const half = 0.1 + t * 0.34;
    for (let i = 0; i < perTick; i++) {
      const s = (i + 0.5) / perTick * 2 - 1;
      gold(cxx + s * half * 0.34, cyy + s * half * 0.94, c.rng.range(0.1, 0.17), 0.755 + k * 0.004);
    }
  }
  // solid wedge to OH down: filled triangle widening toward OH
  const nW = Math.floor(share * 0.055);
  const wx0 = 0.5, wy0 = -1.4, wx1 = 1.2, wy1 = -3.7;
  for (let i = 0; i < nW; i++) {
    const t = Math.sqrt(c.rng.unit());
    const half = 0.04 + t * 0.32;
    const s = c.rng.signed();
    gold(
      wx0 + (wx1 - wx0) * t + s * half * 0.95,
      wy0 + (wy1 - wy0) * t + s * half * 0.3,
      c.rng.range(0.09, 0.16), 0.77 + t * 0.012
    );
  }
}
