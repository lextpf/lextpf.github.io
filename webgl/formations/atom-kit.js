
import { TAU, fibonacciDirection } from '../lib/random.js';

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

// A shaded sphere. Points are spread by fibonacciDirection so they cover the
// surface evenly, then each is dimmed or brightened by how much it faces the key
// direction. `glints` adds a few specular-bright points near the highlight,
// which is what sells it as a solid rather than a shaded ball of fog.
export function litBall(c, centre, radius, n, opts) {
  const dir = [0, 0, 0];
  const jit = 1.7 / Math.sqrt(Math.max(opts.head ? 9 : 16, n));
  const glints = opts.glints ?? 2;
  for (let i = 0; i < n; i++) {
    const glint = i < glints;
    fibonacciDirection(i, n, dir);
    const jw = opts.head ? 0.16 : 0.22;
    const d = glint
      ? norm3([KEY_N[0] + c.rng.bell() * jw, KEY_N[1] + c.rng.bell() * jw, KEY_N[2] + c.rng.bell() * jw])
      : norm3([dir[0] + c.rng.bell() * jit, dir[1] + c.rng.bell() * jit, dir[2] + c.rng.bell() * jit]);
    const s = Math.max(0, d[0] * KEY_N[0] + d[1] * KEY_N[1] + d[2] * KEY_N[2]);
    const lit = (opts.head ? 0.3 : 0.22) + (opts.head ? 0.7 : 0.78) * Math.pow(s, opts.head ? 1.6 : 1.9);
    c.write(
      centre[0] + d[0] * radius, centre[1] + d[1] * radius, centre[2] + d[2] * radius,
      glint
        ? (opts.head ? c.rng.range(0.85, 1.0) : c.rng.range(0.7, 0.9))
        : (opts.head ? c.rng.range(0.12, 0.2) * (0.45 + lit) : c.rng.range(0.2, 0.32) * (0.55 + lit)),
      opts.tint(lit),
      opts.stag + c.rng.range(0, 0.03),
      opts.spin,
      1
    );
  }
}

export function nucleonCluster(c, centre, share, layers, opts) {
  const centres = [[...centre]];
  const tmp = [0, 0, 0];
  layers.forEach(([count, R]) => {
    for (let i = 0; i < count; i++) {
      fibonacciDirection(i, count, tmp);
      centres.push([
        centre[0] + tmp[0] * R + c.rng.bell() * 0.26,
        centre[1] + tmp[1] * R + c.rng.bell() * 0.26,
        centre[2] + tmp[2] * R + c.rng.bell() * 0.26,
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

export function electronComet(c, def, nHeadTail, nArc, tintScale) {
  const { centre, u, v, R, a0, spin, stag } = def;
  const dir = def.dir ?? 1;
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
  for (let i = 0; i < nTail; i++) {
    const t = Math.pow((i + 0.5) / nTail, 0.7);
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
  for (let i = 0; i < nArc; i++) {
    const t = (i + 0.5) / nArc;
    const back = 0.5 + t * 1.9;
    const fade = 1 - t;
    const p = circle(a0 - back * dir + c.rng.bell() * 0.02, R + c.rng.bell() * 0.06);
    c.write(
      p[0] + c.rng.bell() * 0.05, p[1] + c.rng.bell() * 0.05, p[2] + c.rng.bell() * 0.05,
      c.rng.range(0.07, 0.13) * (0.4 + 0.6 * fade),
      c.rng.range(0.3, 0.55) * (0.5 + 0.5 * fade),
      stag - 0.06 + c.rng.range(0, 0.04),
      spin,
      0.85
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
