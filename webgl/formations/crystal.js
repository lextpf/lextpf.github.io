import { MODE } from '../lib/modes.js';
import { TAU } from '../lib/random.js';

const R = 4.5;
const H = 4.5;
const T = 5.0;
const AMP = 0.30;
const LEAN_Z = 0.20;
const LEAN_X = 0.30;

const CZ = Math.cos(LEAN_Z), SZ = Math.sin(LEAN_Z);
const CX = Math.cos(LEAN_X), SX = Math.sin(LEAN_X);

function orient(p) {
  const x = CZ * p[0] - SZ * p[1];
  const y = SZ * p[0] + CZ * p[1];
  return [x, CX * y - SX * p[2], SX * y + CX * p[2]];
}

const KEY = (() => {
  const v = [-0.42, 0.70, 0.58];
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
})();

function shadeOf(normal) {
  const n = orient(normal);
  const d = n[0] * KEY[0] + n[1] * KEY[1] + n[2] * KEY[2];
  return 0.12 + 0.88 * Math.pow(Math.max(0, d), 0.85);
}

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const lerp3 = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const out = weights.map((w) => Math.floor(total * w / sum));
  let rest = total - out.reduce((a, b) => a + b, 0);
  for (let i = 0; rest > 0; i++, rest--) out[i % out.length]++;
  return out;
}

function build(scale, centre) {
  const ring = (y) => {
    const out = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU;
      out.push(add(centre, [Math.cos(a) * R * scale, y * scale, Math.sin(a) * R * scale]));
    }
    return out;
  };
  const top = ring(H);
  const bottom = ring(-H);
  const apex = add(centre, [0, (H + T) * scale, 0]);
  const nadir = add(centre, [0, -(H + T) * scale, 0]);

  const faces = [];
  const outward = (n, at) => {
    const d = sub(at, centre);
    return (n[0] * d[0] + n[1] * d[1] + n[2] * d[2]) < 0 ? scale3(n, -1) : n;
  };
  const centroid = (pts) => scale3(pts.reduce(add, [0, 0, 0]), 1 / pts.length);
  for (let k = 0; k < 6; k++) {
    const n = (k + 1) % 6;
    const radial = normalize(sub(lerp3(top[k], top[n], 0.5), centre));
    const capTop = [top[k], top[n], apex];
    const capBottom = [bottom[n], bottom[k], nadir];
    faces.push({ kind: 'prism', quad: [top[k], top[n], bottom[n], bottom[k]], normal: [radial[0], 0, radial[2]] });
    faces.push({
      kind: 'cap',
      tri: capTop,
      normal: outward(normalize(cross(sub(top[n], top[k]), sub(apex, top[k]))), centroid(capTop)),
    });
    faces.push({
      kind: 'cap',
      tri: capBottom,
      normal: outward(normalize(cross(sub(bottom[k], bottom[n]), sub(nadir, bottom[n]))), centroid(capBottom)),
    });
  }
  const faceNormal = (kind, k) => faces.find((f, i) => i === k * 3 + (kind === 'prism' ? 0 : kind === 'cap' ? 1 : 2)).normal;

  const edges = [];
  for (let k = 0; k < 6; k++) {
    const n = (k + 1) % 6;
    const p = (k + 5) % 6;
    edges.push({ a: top[k], b: bottom[k], normal: normalize(add(faceNormal('prism', k), faceNormal('prism', p))), rank: 0 });
    edges.push({ a: top[k], b: top[n], normal: normalize(add(faceNormal('prism', k), faces[k * 3 + 1].normal)), rank: 0 });
    edges.push({ a: bottom[k], b: bottom[n], normal: normalize(add(faceNormal('prism', k), faces[k * 3 + 2].normal)), rank: 1 });
    edges.push({ a: top[k], b: apex, normal: normalize(add(faces[k * 3 + 1].normal, faces[p * 3 + 1].normal)), rank: 0 });
    edges.push({ a: bottom[k], b: nadir, normal: normalize(add(faces[k * 3 + 2].normal, faces[p * 3 + 2].normal)), rank: 1 });
  }

  return { faces, edges, corners: top.concat(bottom, [apex, nadir]), top, bottom, apex, nadir, scale };
}

const MAIN = build(1, [0, 0, 0]);
const INNER = build(0.5, [0, 0.5, 0]);

function rotateLocal(point, rotation) {
  let [x, y, z] = point;
  const [rx, ry, rz] = rotation;
  let s = Math.sin(rx), co = Math.cos(rx);
  [y, z] = [co * y - s * z, s * y + co * z];
  s = Math.sin(ry); co = Math.cos(ry);
  [x, z] = [co * x + s * z, -s * x + co * z];
  s = Math.sin(rz); co = Math.cos(rz);
  [x, y] = [co * x - s * y, s * x + co * y];
  return [x, y, z];
}

function placeSatellite(point, satellite) {
  return add(
    satellite.centre,
    orient(scale3(rotateLocal(point, satellite.rotation), satellite.scale)),
  );
}

function wireSatellite(name, centre, scale, rotation, vertices, connections, weight = 1) {
  return {
    name,
    centre,
    scale,
    rotation,
    weight,
    nodes: vertices,
    paths: connections.map(([a, b]) => ({
      weight: Math.hypot(...sub(vertices[b], vertices[a])),
      point: (t) => lerp3(vertices[a], vertices[b], t),
    })),
  };
}

const TETRA_VERTICES = [
  [1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1],
];
const TETRA_EDGES = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
const OCTA_VERTICES = [
  [0, 1.45, 0], [0, -1.45, 0], [1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1],
];
const OCTA_EDGES = [
  [0, 2], [0, 3], [0, 4], [0, 5], [1, 2], [1, 3], [1, 4], [1, 5],
  [2, 3], [3, 4], [4, 5], [5, 2],
];
const CUBE_VERTICES = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];
const CUBE_EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

const PHI = (1 + Math.sqrt(5)) / 2;
const ICOSA_VERTICES = (() => {
  const out = [];
  for (const s1 of [-1, 1]) {
    for (const s2 of [-1, 1]) {
      out.push([0, s1, s2 * PHI], [s1, s2 * PHI, 0], [s2 * PHI, 0, s1]);
    }
  }
  const k = 1.45 / Math.hypot(1, PHI);
  return out.map((p) => p.map((x) => x * k));
})();
const ICOSA_EDGES = (() => {
  const out = [];
  const touch = 2.1 * (1.45 / Math.hypot(1, PHI));
  for (let i = 0; i < ICOSA_VERTICES.length; i++) {
    for (let j = i + 1; j < ICOSA_VERTICES.length; j++) {
      if (Math.hypot(...sub(ICOSA_VERTICES[j], ICOSA_VERTICES[i])) < touch) out.push([i, j]);
    }
  }
  return out;
})();

const STELLA_VERTICES = [
  ...TETRA_VERTICES,
  ...TETRA_VERTICES.map(([x, y, z]) => [-x, -y, -z]),
];
const STELLA_EDGES = [
  ...TETRA_EDGES,
  ...TETRA_EDGES.map(([a, b]) => [a + 4, b + 4]),
];

const HYPAR_LEVELS = [-1, -0.66, -0.33, 0, 0.33, 0.66, 1];
const hyparPoint = (u, v) => [u * 1.7, v * 1.7, (u * u - v * v) * 0.72];
const HYPAR_PATHS = [
  ...HYPAR_LEVELS.map((v) => ({
    weight: 3.6,
    point: (t) => hyparPoint(t * 2 - 1, v),
  })),
  ...HYPAR_LEVELS.map((u) => ({
    weight: 3.6,
    point: (t) => hyparPoint(u, t * 2 - 1),
  })),
];
const HYPAR_NODES = [
  hyparPoint(-1, -1), hyparPoint(-1, 1),
  hyparPoint(1, -1), hyparPoint(1, 1),
];

const SATELLITES = [
  wireSatellite('tetrahedron', [8.2, 7.1, -2.4], 0.9, [0.35, -0.28, 0.2], TETRA_VERTICES, TETRA_EDGES, 0.95),
  wireSatellite('octahedron', [-8.0, 7.1, -1.2], 1.0, [-0.3, 0.18, -0.24], OCTA_VERTICES, OCTA_EDGES, 1.0),
  wireSatellite('skew-cube', [8.0, 0.3, -3.3], 0.72, [0.42, 0.5, 0.28], CUBE_VERTICES, CUBE_EDGES, 0.9),
  wireSatellite('icosahedron', [-9.1, 0, 2.7], 1.08, [0.35, 0.22, -0.12], ICOSA_VERTICES, ICOSA_EDGES, 1.35),
  {
    name: 'hypar-shell', centre: [8.3, -7.0, 2.4], scale: 0.78,
    rotation: [-0.34, 0.48, 0.12], weight: 1.3,
    nodes: HYPAR_NODES,
    paths: HYPAR_PATHS,
  },
  wireSatellite('stellated-frame', [-7.8, -7.0, 1.6], 0.78, [0.36, -0.48, 0.2], STELLA_VERTICES, STELLA_EDGES, 1.25),
];

export const crystal = {
  seed: 0x1c01,
  touch: { mode: 10, radius: 4, strength: 4.0 },
  mode: MODE.ROCK_Y,
  pivot: [0, 0, 0],
  build(c) {
    const [ridgeShare, glintShare, faceShare, striationShare,
      innerShare, phantomShare, satelliteShare, moteShare, dustShare] =
      c.split([0.365, 0.03, 0, 0, 0, 0.025, 0.24, 0.03, 0.31]);

    const writeEdge = (edge, n, opts) => {
      const shade = shadeOf(edge.normal);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const p = orient(lerp3(edge.a, edge.b, t));
        const j = opts.jitter;
        c.write(
          p[0] + c.rng.bell() * j,
          p[1] + c.rng.bell() * j,
          p[2] + c.rng.bell() * j,
          opts.size(t, shade),
          opts.tint(t, shade),
          opts.stagger(t),
          AMP,
          1
        );
      }
    };

    const ridgeBudget = allocate(
      ridgeShare,
      MAIN.edges.map((e) => (0.2 + shadeOf(e.normal) * 1.25) * (e.rank === 0 ? 1.2 : 0.85))
    );
    MAIN.edges.forEach((edge, index) => {
      writeEdge(edge, ridgeBudget[index], {
        jitter: 0.010,
        size: (t, shade) => (0.19 + shade * 0.36) * (1 + Math.sin(t * Math.PI) * 0.12),
        tint: (t, shade) => 0.1 + shade * 0.76,
        stagger: (t) => 0.04 + Math.abs(t - 0.5) * 0.16 + (edge.rank === 0 ? 0 : 0.05),
      });
    });

    const glintBudget = allocate(glintShare, MAIN.corners.map((_, i) => (i >= 12 ? 1.9 : 1)));
    MAIN.corners.forEach((corner, index) => {
      const p = orient(corner);
      for (let i = 0; i < glintBudget[index]; i++) {
        const r = 0.15 * Math.pow(c.rng.unit(), 1.8);
        const cosPhi = c.rng.signed();
        const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
        const theta = c.rng.unit() * TAU;
        c.write(
          p[0] + r * sinPhi * Math.cos(theta),
          p[1] + r * cosPhi,
          p[2] + r * sinPhi * Math.sin(theta),
          c.rng.range(0.85, 1.45),
          c.rng.range(0.68, 1),
          0.02 + c.rng.range(0, 0.02),
          AMP,
          1
        );
      }
    });

    const faceBudget = allocate(
      faceShare,
      MAIN.faces.map((f) => {
        const s = shadeOf(f.normal);
        return (f.kind === 'prism' ? 1.25 : 0.85) * (0.1 + s * s * 1.9);
      })
    );
    MAIN.faces.forEach((face, index) => {
      const n = faceBudget[index];
      const shade = shadeOf(face.normal);
      for (let i = 0; i < n; i++) {
        let p;
        let edgeDistance;
        if (face.kind === 'prism') {
          const u = c.rng.unit();
          // growth lamellae: the vertical coordinate snaps to discrete layers,
          // so face fill reads as clean crystal striae instead of scatter.
          const v = (Math.floor(c.rng.unit() * 9) + 0.5) / 9 + c.rng.bell() * 0.008;
          p = lerp3(lerp3(face.quad[0], face.quad[1], u), lerp3(face.quad[3], face.quad[2], u), v);
          edgeDistance = Math.min(u, 1 - u, v, 1 - v) * 2;
        } else {
          let b0 = (Math.floor(c.rng.unit() * 6) + 0.5) / 6 + c.rng.bell() * 0.01;
          let b1 = c.rng.unit() * (1 - b0);
          const b2 = 1 - b0 - b1;
          p = add(add(scale3(face.tri[0], b0), scale3(face.tri[1], b1)), scale3(face.tri[2], b2));
          edgeDistance = Math.min(b0, b1, b2) * 3;
        }
        const rim = 1 + 0.35 * Math.exp(-edgeDistance * 3.4);
        const q = orient(p);
        c.write(
          q[0], q[1], q[2],
          c.rng.range(0.09, 0.16) * (0.5 + shade) * rim,
          (0.12 + shade * 0.5) * c.rng.range(0.7, 1.15),
          0.24 + shade * 0.1 + c.rng.range(0, 0.14),
          AMP,
          1
        );
      }
    });

    const LINES = [0.17, 0.31, 0.58, 0.79];
    const prismFaces = MAIN.faces
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => f.kind === 'prism');
    let litPrisms = prismFaces.filter(({ f }) => shadeOf(f.normal) > 0.36);
    if (!litPrisms.length) {
      litPrisms = prismFaces
        .slice()
        .sort((a, b) => shadeOf(b.f.normal) - shadeOf(a.f.normal))
        .slice(0, 2);
    }
    const lineBudgets = allocate(
      striationShare,
      litPrisms.flatMap(({ f }) => LINES.map(() => 0.35 + shadeOf(f.normal))),
    );
    let lineCursor = 0;
    litPrisms.forEach(({ f }) => {
      const shade = shadeOf(f.normal);
      LINES.forEach((v, lineIndex) => {
        const count = lineBudgets[lineCursor++];
        for (let i = 0; i < count; i++) {
          const u = 0.05 + 0.9 * ((i + 0.5) / count);
          const p = lerp3(lerp3(f.quad[0], f.quad[1], u), lerp3(f.quad[3], f.quad[2], u), v);
          const q = orient([p[0], p[1] + c.rng.bell() * 0.012, p[2]]);
          c.write(
            q[0], q[1], q[2],
            c.rng.range(0.12, 0.2) * (lineIndex === 1 ? 1.5 : 1) * shade,
            c.rng.range(0.2, 0.55),
            0.4 + v * 0.14,
            AMP,
            1
          );
        }
      });
    });

    const innerEdges = INNER.edges.filter((e) => e.rank === 0);
    const innerBudget = allocate(innerShare, innerEdges.map(() => 1));
    innerEdges.forEach((edge, index) => {
      writeEdge(edge, innerBudget[index], {
        jitter: 0.026,
        size: () => c.rng.range(0.11, 0.2),
        tint: () => c.rng.range(0.6, 1),
        stagger: () => c.rng.range(0, 0.05),
      });
    });

    for (let i = 0; i < phantomShare; i++) {
      const k = i % 6;
      const t = (i / 6) % 1;
      const a = (k / 6) * TAU;
      const b = ((k + 1) / 6) * TAU;
      const rr = R * 0.74;
      const p = orient(lerp3(
        [Math.cos(a) * rr, -1.6, Math.sin(a) * rr],
        [Math.cos(b) * rr, -1.6, Math.sin(b) * rr],
        t
      ));
      c.write(
        p[0] + c.rng.bell() * 0.02,
        p[1] + c.rng.bell() * 0.02,
        p[2] + c.rng.bell() * 0.02,
        c.rng.range(0.13, 0.24),
        c.rng.range(0.6, 1),
        0.1 + t * 0.06,
        AMP,
        1
      );
    }

    const satelliteBudgets = allocate(satelliteShare, SATELLITES.map((satellite) => satellite.weight));
    SATELLITES.forEach((satellite, satelliteIndex) => {
      const [basePathShare, baseNodeShare] = allocate(satelliteBudgets[satelliteIndex], [0.88, 0.12]);
      const nodeShare = satellite.nodes.length ? baseNodeShare : 0;
      const pathShare = basePathShare + (satellite.nodes.length ? 0 : baseNodeShare);
      const pathBudgets = allocate(pathShare, satellite.paths.map((path) => path.weight));
      const reveal = Math.min(0.9, 0.58 + satelliteIndex * 0.045);
      const rock = AMP * (0.76 + (satelliteIndex % 3) * 0.16);

      satellite.paths.forEach((path, pathIndex) => {
        const count = pathBudgets[pathIndex];
        for (let i = 0; i < count; i++) {
          const t = (i + c.rng.unit() * 0.35) / Math.max(1, count);
          const p = placeSatellite(path.point(t), satellite);
          const cadence = 0.75 + 0.25 * Math.pow(Math.sin(t * Math.PI * 5), 8);
          c.write(
            p[0] + c.rng.bell() * 0.006,
            p[1] + c.rng.bell() * 0.006,
            p[2] + c.rng.bell() * 0.006,
            c.rng.range(0.2, 0.38) * cadence,
            Math.min(1, 0.3 + satelliteIndex * 0.08 + c.rng.range(0, 0.22)),
            reveal + c.rng.range(0, 0.045),
            rock,
            1
          );
        }
      });

      if (satellite.nodes.length) {
        const nodeBudgets = allocate(nodeShare, satellite.nodes.map(() => 1));
        satellite.nodes.forEach((node, nodeIndex) => {
          const centre = placeSatellite(node, satellite);
          for (let i = 0; i < nodeBudgets[nodeIndex]; i++) {
            const radius = 0.11 * Math.pow(c.rng.unit(), 1.8);
            const y = c.rng.signed();
            const planar = Math.sqrt(Math.max(0, 1 - y * y));
            const angle = c.rng.unit() * TAU;
            c.write(
              centre[0] + Math.cos(angle) * planar * radius,
              centre[1] + y * radius,
              centre[2] + Math.sin(angle) * planar * radius,
              c.rng.range(0.62, 1.08),
              c.rng.range(0.68, 1),
              reveal,
              rock,
              1
            );
          }
        });
      }
    });

    for (let i = 0; i < moteShare; i++) {
      const a = c.rng.unit() * TAU;
      const rad = R * 0.82 * Math.sqrt(c.rng.unit());
      const p = orient([
        Math.cos(a) * rad,
        c.rng.signed() * (H + T * 0.3),
        Math.sin(a) * rad,
      ]);
      c.write(
        p[0], p[1], p[2],
        c.rng.range(0.06, 0.14),
        c.rng.range(0.35, 0.9),
        0.44 + c.rng.range(0, 0.22),
        AMP,
        0.9
      );
    }

    for (let i = 0; i < dustShare; i++) {
      const r = 22 + 56 * Math.pow(c.rng.unit(), 0.7);
      const cosPhi = c.rng.signed();
      const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
      const theta = c.rng.unit() * TAU;
      c.write(
        r * sinPhi * Math.cos(theta),
        r * cosPhi * 0.5,
        r * sinPhi * Math.sin(theta),
        c.rng.range(0.1, 0.24),
        c.rng.range(0, 0.14),
        0.8 + c.rng.range(0, 0.2),
        0.04,
        0
      );
    }
  },
};
