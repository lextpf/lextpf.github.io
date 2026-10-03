/* The black hole's lens table (shaders/particles.js lensImpact).

   For an emitter at radius r from a Schwarzschild hole (rs = 1 here), the
   light that reaches a distant camera leaves it at emission angle alpha from
   the outward radial direction and arrives at impact parameter
   b = r sin(alpha) / sqrt(1 - rs / r), the image's distance from the hole's
   centre on the sky. The ray sweeps an angle Psi about the hole on its way:
   Psi = psi for the primary image, where psi is the angle at the hole between
   the emitter and the camera, and 2 pi - psi for the secondary image, which
   goes round the other side and lands opposite, just outside the shadow.
   alpha rises with Psi from 0 toward alpha_c, the angle of the light that
   circles the photon sphere, so one table serves both images.

   The table holds s = 1 - alpha / alpha_c on a grid of Psi (columns, 0 to
   PSI_MAX) and sqrt(u / U_MAX) (rows, u = rs / r), exact to the quadrature:
   the swept angles are Carlson's R_F (DLMF 19.29.4) on the orbit equation
   (du/dphi)^2 = 1/b^2 - u^2 + u^3, with Simpson's rule only below the
   critical impact parameter, where the cubic has one real root. s is used,
   not alpha, so the secondary image (s near 0) keeps its precision in half
   floats. Built once, in about 20 ms. */

export const LENS_TABLE = Object.freeze({ width: 192, height: 48, psiMax: 2 * Math.PI + 0.5, uMax: 0.62 });

const BC = 1.5 * Math.sqrt(3);

function rf(x, y, z) {
  for (let i = 0; i < 40; i++) {
    const a = (x + y + z) / 3;
    const dx = 1 - x / a;
    const dy = 1 - y / a;
    const dz = 1 - z / a;
    if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) < 2e-4) {
      const e2 = dx * dy - dz * dz;
      const e3 = dx * dy * dz;
      return (1 - e2 / 10 + e3 / 14 + (e2 * e2) / 24 - (3 * e2 * e3) / 44) / Math.sqrt(a);
    }
    const sx = Math.sqrt(x);
    const sy = Math.sqrt(y);
    const sz = Math.sqrt(z);
    const l = sx * sy + sy * sz + sz * sx;
    x = (x + l) / 4;
    y = (y + l) / 4;
    z = (z + l) / 4;
  }
  return 1 / Math.sqrt((x + y + z) / 3);
}

// Roots u1 < 0 < u2 <= u3 of u^3 - u^2 + 1/b^2, for b > BC.
function roots(b) {
  const th = Math.acos(Math.max(-1, Math.min(1, 1 - 27 / (2 * b * b))));
  const k = (j) => 1 / 3 + (2 / 3) * Math.cos(th / 3 - (2 * Math.PI * j) / 3);
  return [k(0), k(1), k(2)].sort((a, c) => a - c);
}

// The angle swept from the camera (u = 0) to u = x on the way in.
function sweptIn(b, x) {
  if (x <= 0) return 0;
  if (b <= BC) {
    const f = (u) => 1 / Math.sqrt(Math.max(1 / (b * b) - u * u + u * u * u, 1e-30));
    const n = 400;
    const h = x / n;
    let s = f(0) + f(x);
    for (let i = 1; i < n; i++) s += f(i * h) * (i % 2 ? 4 : 2);
    return (s * h) / 3;
  }
  const [u1, u2, u3] = roots(b);
  const X1 = Math.sqrt(x - u1);
  const X2 = Math.sqrt(Math.max(u2 - x, 0));
  const X3 = Math.sqrt(u3 - x);
  const Y1 = Math.sqrt(-u1);
  const Y2 = Math.sqrt(u2);
  const Y3 = Math.sqrt(u3);
  const U12 = (X1 * X2 * Y3 + Y1 * Y2 * X3) / x;
  const U13 = (X1 * X3 * Y2 + Y1 * Y3 * X2) / x;
  const U23 = (X2 * X3 * Y1 + Y2 * Y3 * X1) / x;
  return 2 * rf(U12 * U12, U13 * U13, U23 * U23);
}

export function buildLensTable({ width, height, psiMax, uMax } = LENS_TABLE) {
  const data = new Float32Array(width * height);
  for (let j = 0; j < height; j++) {
    const v = j / (height - 1);
    const u = uMax * v * v;
    const row = j * width;
    if (u < 1e-9) {
      for (let i = 0; i < width; i++) data[row + i] = 1 - Math.min((psiMax * i) / (width - 1), Math.PI) / Math.PI;
      continue;
    }
    const s = Math.sqrt(1 - u);
    const ac = Math.PI - Math.asin(Math.min(1, BC * u * s));
    const br = 1 / (u * s);
    const path = [[0, 0]];
    const N = 220;
    for (let k = 1; k <= N; k++) {
      const b = br * Math.sin((Math.PI / 2) * (k / N)) * (1 - 1e-9);
      path.push([sweptIn(b, Math.min(u, b > BC ? roots(b)[1] : u)), Math.asin(Math.min(1, b * u * s))]);
    }
    for (let k = 1; k <= N; k++) {
      const t = k / N;
      const b = BC + (br - BC) * Math.exp(-19 * t * t) * (1 - 1e-9);
      if (b <= BC * (1 + 1e-12)) continue;
      const u2 = roots(b)[1];
      if (u2 < u) continue;
      path.push([2 * sweptIn(b, u2) - sweptIn(b, u), Math.PI - Math.asin(Math.min(1, b * u * s))]);
    }
    path.sort((a, b) => a[0] - b[0]);
    let p = 1;
    for (let i = 0; i < width; i++) {
      const psi = (psiMax * i) / (width - 1);
      while (p < path.length - 1 && path[p][0] < psi) p++;
      const [p0, a0] = path[p - 1];
      const [p1, a1] = path[p];
      const alpha = psi >= p1 ? (p === path.length - 1 ? a1 + (ac - a1) * (1 - Math.exp(-(psi - p1))) : a1)
        : a0 + ((a1 - a0) * (psi - p0)) / Math.max(p1 - p0, 1e-12);
      data[row + i] = Math.max(0, 1 - alpha / ac);
    }
  }
  return data;
}
