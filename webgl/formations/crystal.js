
import { MODE } from '../lib/modes.js';
import { TAU } from '../lib/random.js';
import { CHAPTERS, REDUCED_CHAPTERS } from '../chapters.js';
import { progressiveGrid, roundRobin, byRank, backdrop } from '../lib/sampling.js';

/* ==========================================================================
   THE CRYSTAL (hero)

   A quartz point drawn as a transparent specimen: the first impression, and
   the strictest silhouette in the universe. Every population is placed
   cut-true (lib/sampling.js), so a lower rung reads as a sparser bake of the
   same drawing rather than a random erosion of it.

     ridge       the 30 edges of the body. Density per unit of length, set by
                 how lit the edge is and by whether the cameras that see the
                 hero see it from the front (hidden lines, below)
     glint       a small hot cluster on each corner, budgeted by the cube of
                 the corner's best face shade: the apex and the lit shoulders
                 carry them, the shadowed corners next to none. The only
                 particles above the hero's bloom threshold: glow means lit
     striation   quartz's diagnostic horizontal lines on the lit prism faces
     phantom     an earlier growth cap inside the point, its faces parallel to
                 the final ones, as in real phantom quartz: faint ghost lines
     satellite   six small wireframe specimens around the point
     mote        inclusions inside the body
     backdrop    screen-uniform dust behind the subject, in the hero frustum
     narrow      the star field of the pulled-back phone and tablet framing,
                 placed only where no desktop camera looks
     haze        a faint mineral haze close around the body's waist

   Light. The key light is baked into density, size and tint. A lit edge is
   drawn nearly white and a shadowed one leans to the accent, the way a cool
   fill reads against a white key: lit is white, and the one blue is shade.

   Lines. Ridges, phantom lines and specimen paths carry a hand-drawn
   thickness, a small jitter across the line and never along it, so the
   cut-true spacing along every line holds exactly at every rung.

   Hidden lines. Seen through, a wireframe prism reads as a Necker cube, every
   back edge as loud as the front ones. An edge whose two faces both face away
   from every camera the hero is ever seen from (the hero camera across its
   pointer parallax and idle breath, the reduced-motion camera, the narrow
   reframes, across the whole rock) is drawn at 0.55 of the density and half
   the energy per point; an edge that turns between front and back somewhere
   in that range at 0.8 and 0.85. What is left reads as a transparent quartz
   with depth. The classification runs once, at module load, from the chapter
   cameras themselves.
   ========================================================================== */

// The prism's radius and half-height, the height of each pyramidal cap, and
// the body's rock amplitude (its ROCK_Y spin).
const R = 4.5;
const H = 4.5;
const T = 5.0;
const AMP = 0.30;
// Ridge particle size: unlit, and its gain with light. Set on the owner's
// 3840x2025 frame so a lit ridge's HDR peak sits near 2 and a shadowed one
// near 0.4 (they were 5.6 and 0.7, bright enough to fatten and bloom): the
// lines stay drawn instead of saturating into bars, and only the glints reach
// the bloom knee.
const RIDGE_SIZE = [0.178, 0.021];
// The pose. Applied last, by orient().
const LEAN_Z = 0.20;
const LEAN_X = 0.30;

// Precomputed once. These run inside loops tens of thousands deep, and calling
// cos/sin per point would be pure waste for a rotation that never changes.
const CZ = Math.cos(LEAN_Z), SZ = Math.sin(LEAN_Z);
const CX = Math.cos(LEAN_X), SX = Math.sin(LEAN_X);

// Tilt a point from the crystal's own upright axes into its final pose: a
// rotation about z, then about x, unrolled rather than going through a matrix.
function orient(p) {
  const x = CZ * p[0] - SZ * p[1];
  const y = SZ * p[0] + CZ * p[1];
  return [x, CX * y - SX * p[2], SX * y + CX * p[2]];
}

// Key-light direction, in the crystal's own upright space, so shading is
// computed before the pose is applied and the two stay independent.
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
    const quad = [top[k], top[n], bottom[n], bottom[k]];
    const capTop = [top[k], top[n], apex];
    const capBottom = [bottom[n], bottom[k], nadir];
    faces.push({ kind: 'prism', quad, centre: centroid(quad), normal: [radial[0], 0, radial[2]] });
    faces.push({
      kind: 'cap',
      tri: capTop,
      centre: centroid(capTop),
      normal: outward(normalize(cross(sub(top[n], top[k]), sub(apex, top[k]))), centroid(capTop)),
    });
    faces.push({
      kind: 'cap',
      tri: capBottom,
      centre: centroid(capBottom),
      normal: outward(normalize(cross(sub(bottom[k], bottom[n]), sub(nadir, bottom[n]))), centroid(capBottom)),
    });
  }

  // Every edge knows its two faces: it is lit by their mean normal, and it is
  // hidden only when both of them face away.
  const edges = [];
  const edge = (a, b, f0, f1, rank) => edges.push({
    a, b, rank, faces: [f0, f1], normal: normalize(add(f0.normal, f1.normal)),
  });
  for (let k = 0; k < 6; k++) {
    const n = (k + 1) % 6;
    const p = (k + 5) % 6;
    edge(top[k], bottom[k], faces[k * 3], faces[p * 3], 0);
    edge(top[k], top[n], faces[k * 3], faces[k * 3 + 1], 0);
    edge(bottom[k], bottom[n], faces[k * 3], faces[k * 3 + 2], 1);
    edge(top[k], apex, faces[k * 3 + 1], faces[p * 3 + 1], 0);
    edge(bottom[k], nadir, faces[k * 3 + 2], faces[p * 3 + 2], 1);
  }

  // Every corner with the faces that meet there, for the glints.
  const corners = [];
  for (let k = 0; k < 6; k++) {
    const p = (k + 5) % 6;
    corners.push({ at: top[k], faces: [faces[k * 3], faces[p * 3], faces[k * 3 + 1], faces[p * 3 + 1]] });
  }
  for (let k = 0; k < 6; k++) {
    const p = (k + 5) % 6;
    corners.push({ at: bottom[k], faces: [faces[k * 3], faces[p * 3], faces[k * 3 + 2], faces[p * 3 + 2]] });
  }
  corners.push({ at: apex, faces: [0, 1, 2, 3, 4, 5].map((k) => faces[k * 3 + 1]) });
  corners.push({ at: nadir, faces: [0, 1, 2, 3, 4, 5].map((k) => faces[k * 3 + 2]) });

  return { faces, edges, corners, top, bottom, apex, nadir, scale };
}

const MAIN = build(1, [0, 0, 0]);
const INNER = build(0.5, [0, 0.5, 0]);

/* ---- Hidden lines ---------------------------------------------------------
   Every camera position the hero is seen from: the hero chapter's camera
   across its pointer parallax (reach 1.6 + |camZ| 0.02, 0.7 of it in y) and
   idle breath (0.55, 0.4), the reduced-motion camera (no parallax), and the
   narrow reframes of each (cv-universe.js reframe: x 0.22, y 0.7 + 2.2, z
   1.16 or 1.34 times narrowPull). Across the whole ROCK_Y range of the body:
   yaw +-AMP and pitch +-0.34 AMP, as the vertex shader applies them. */
function rockPoint(p, ay, ax) {
  const sy = Math.sin(ay), cy = Math.cos(ay);
  const x = cy * p[0] + sy * p[2];
  const z = -sy * p[0] + cy * p[2];
  const sx = Math.sin(ax), cx = Math.cos(ax);
  return [x, cx * p[1] - sx * z, sx * p[1] + cx * z];
}

const HERO = CHAPTERS.find((c) => c.id === 'hero');
const HERO_REDUCED = REDUCED_CHAPTERS.find((c) => c.id === 'hero');

// A chapter's camera, and the same camera as cv-universe.js reframe() stages
// it below 820 CSS px: pulled back 1.16x (1.34x in portrait) times the
// chapter's narrowPull, x at 0.22, the framing lifted. Mirrored here, so a
// change to reframe() has to be repeated in narrowCamera().
const cameraOf = (ch) => ({
  cam: [ch.camX, ch.camY, ch.camZ], tgt: [ch.tgtX, ch.tgtY, ch.tgtZ], fov: ch.fov,
});
const narrowCamera = (ch, pull) => ({
  cam: [ch.camX * 0.22, ch.camY * 0.7 + 2.2, ch.camZ * pull * (ch.narrowPull || 1)],
  tgt: [ch.tgtX * 0.22, ch.tgtY, ch.tgtZ],
  fov: ch.fov,
});

const VIEWS = (() => {
  const out = [];
  for (const ch of [HERO, HERO_REDUCED]) {
    const parallax = ch === HERO ? 1.6 + Math.abs(ch.camZ) * 0.02 : 0;
    const bases = [cameraOf(ch).cam, narrowCamera(ch, 1.16).cam, narrowCamera(ch, 1.34).cam];
    for (const b of bases) {
      for (const px of [-1, 0, 1]) {
        for (const py of [-1, 0, 1]) {
          out.push([b[0] + px * (parallax + 0.55), b[1] + py * (parallax * 0.7 + 0.4), b[2]]);
        }
      }
    }
  }
  return out;
})();

const ROCKS = (() => {
  const out = [];
  for (let i = -4; i <= 4; i++) for (const j of [-1, 0, 1]) out.push([AMP * i / 4, AMP * 0.34 * j]);
  return out;
})();

// Every face's normal and centre in the pose, turned to every rock phase,
// once: six numbers per face and phase, so the classification below is
// dot products only (it runs at module load, inside the boot).
const POSED = ROCKS.map(([ay, ax]) => {
  const out = new Float64Array(MAIN.faces.length * 6);
  MAIN.faces.forEach((f, i) => {
    const n = rockPoint(orient(f.normal), ay, ax);
    const c = rockPoint(orient(f.centre), ay, ax);
    out.set([n[0], n[1], n[2], c[0], c[1], c[2]], i * 6);
  });
  return out;
});
function facing(posed, i, view) {
  const k = i * 6;
  return posed[k] * (view[0] - posed[k + 3]) + posed[k + 1] * (view[1] - posed[k + 4]) +
    posed[k + 2] * (view[2] - posed[k + 5]) > 0;
}

// 'front': one of its faces is seen from the front, from everywhere, always.
// 'back': both faces turned away, from everywhere, always.
// 'turn': anything in between.
function visibility(edge) {
  const i0 = MAIN.faces.indexOf(edge.faces[0]), i1 = MAIN.faces.indexOf(edge.faces[1]);
  let always = true, never = true;
  for (const view of VIEWS) {
    for (const posed of POSED) {
      const seen = facing(posed, i0, view) || facing(posed, i1, view);
      if (seen) never = false; else always = false;
      if (!always && !never) return 'turn';
    }
  }
  return always ? 'front' : 'back';
}
const DENSITY = { front: 1, turn: 0.8, back: 0.55 };
const ENERGY = { front: 1, turn: 0.85, back: 0.5 };
for (const e of MAIN.edges) {
  e.shade = shadeOf(e.normal);
  e.length = Math.hypot(...sub(e.b, e.a));
  e.visibility = visibility(e);
}

/* ---- Satellites ---------------------------------------------------------- */

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

// Local rotation, scale and the body's pose, composed once per specimen into
// a 3x3 matrix (its columns are the images of the local axes), so placing a
// point costs nine multiplies instead of six sines and cosines.
function placement(satellite) {
  const col = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    .map((axis) => orient(scale3(rotateLocal(axis, satellite.rotation), satellite.scale)));
  const [o0, o1, o2] = satellite.centre;
  return (p) => [
    o0 + col[0][0] * p[0] + col[1][0] * p[1] + col[2][0] * p[2],
    o1 + col[0][1] * p[0] + col[1][1] * p[1] + col[2][1] * p[2],
    o2 + col[0][2] * p[0] + col[1][2] * p[1] + col[2][2] * p[2],
  ];
}

// `rock` scales the body's rock amplitude for this specimen; the small
// differences let the specimens drift a little against the body as it turns.
// `nodes` defaults to every vertex.
function wireSatellite(name, centre, scale, rotation, vertices, connections, weight, rock, nodes = null) {
  return {
    name,
    centre,
    scale,
    rotation,
    weight,
    rock,
    nodes: nodes || vertices,
    paths: connections.map(([a, b]) => ({
      weight: Math.hypot(...sub(vertices[b], vertices[a])),
      point: (t) => lerp3(vertices[a], vertices[b], t),
      ends: [vertices[a], vertices[b]],
    })),
  };
}

/* The origami crane (tsuru): x toward the head, y up, z across the wings.
   The body is the folded kite: keel K, fore and aft points F and B, the ridge
   T and the flanks L and Rr. The neck rises from F and K to N and folds down
   into the head Hd, the tail rises from B and K to Ta, and the two wings rise
   from the shoulders FT and BT to their tips WL and WR, so from the hero
   camera they overlap into one raised blade: the classic profile, neck and
   bent head to the right, tail to the left. Only the four tips carry nodes. */
const CRANE = {
  K: [0, -0.55, 0], F: [0.42, -0.08, 0], B: [-0.42, -0.08, 0], T: [0, 0.2, 0],
  L: [0, -0.14, 0.3], Rr: [0, -0.14, -0.3], FT: [0.3, 0.1, 0], BT: [-0.3, 0.1, 0],
  N: [1.08, 1.3, 0], Hd: [1.36, 1.12, 0], Ta: [-1.2, 1.34, 0],
  WL: [-0.12, 1.16, 1.3], WR: [-0.12, 1.16, -1.3],
};
const CRANE_KEYS = Object.keys(CRANE);
const CRANE_VERTICES = CRANE_KEYS.map((k) => CRANE[k]);
const CRANE_EDGES = [
  ['K', 'L'], ['K', 'Rr'], ['L', 'F'], ['Rr', 'F'], ['L', 'B'], ['Rr', 'B'], ['L', 'T'], ['Rr', 'T'],
  ['F', 'N'], ['K', 'N'], ['N', 'Hd'], ['B', 'Ta'], ['K', 'Ta'],
  ['FT', 'WL'], ['BT', 'WL'], ['FT', 'WR'], ['BT', 'WR'], ['T', 'WL'], ['T', 'WR'], ['FT', 'BT'],
].map(([a, b]) => [CRANE_KEYS.indexOf(a), CRANE_KEYS.indexOf(b)]);
const CRANE_TIPS = ['Hd', 'Ta', 'WL', 'WR'].map((k) => CRANE[k]);

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

const TETRA_VERTICES = [
  [1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1],
];
const TETRA_EDGES = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
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

/* Placement. At 16:10 the body leaves no room beside the prism for a
   specimen: the frame edge sits within the rock and the pointer parallax of
   anything there. So the right-hand specimens live in the two pockets beside
   the caps, where the caps taper (and the pose leans the crown away): the
   crane flies above the crown, the skew cube rides at the crown's right
   shoulder, and the saddle hangs below the base. Each keeps its whole hull at least 1% of the frame
   width inside the edge at 1440x900 and 1920x1080 (with a scrollbar), and
   clear of the body, across the rock and the parallax. */
const SATELLITES = [
  wireSatellite('origami-crane', [4.4, 12.9, -3.0], 0.95, [0.3, -0.6, 0.1], CRANE_VERTICES, CRANE_EDGES, 1.3, 0.76, CRANE_TIPS),
  wireSatellite('octahedron', [-8.0, 7.1, -1.2], 1.0, [-0.3, 0.18, -0.24], OCTA_VERTICES, OCTA_EDGES, 1.0, 0.92),
  wireSatellite('skew-cube', [5.5, 8.8, -2.3], 0.6, [0.42, 0.5, 0.28], CUBE_VERTICES, CUBE_EDGES, 0.75, 0.76),
  wireSatellite('icosahedron', [-9.1, 0, 2.7], 1.08, [0.35, 0.22, -0.12], ICOSA_VERTICES, ICOSA_EDGES, 1.35, 0.76),
  {
    name: 'hypar-shell', centre: [4.3, -8.5, 1.4], scale: 0.66,
    rotation: [-0.34, 0.48, 0.12], weight: 1.3, rock: 0.76,
    nodes: HYPAR_NODES,
    paths: HYPAR_PATHS,
  },
  wireSatellite('stellated-frame', [-7.8, -7.0, 1.6], 0.78, [0.36, -0.48, 0.2], STELLA_VERTICES, STELLA_EDGES, 1.25, 1.08),
];

// Inside the body (in its upright frame), shrunk by `k`: the hexagonal prism
// plus the two pyramidal caps.
const APOTHEM = R * Math.cos(Math.PI / 6);
const PRISM_NORMALS = [0, 1, 2, 3, 4, 5].map((i) => [Math.cos(((i + 0.5) / 6) * TAU), Math.sin(((i + 0.5) / 6) * TAU)]);
function insideBody(p, k) {
  let hex = 0;
  for (const [nx, nz] of PRISM_NORMALS) hex = Math.max(hex, (p[0] * nx + p[2] * nz) / (APOTHEM * k));
  const ay = Math.abs(p[1]);
  if (ay <= H * k) return hex <= 1;
  return hex <= (H + T - ay / k) / T;
}

export const crystal = {
  seed: 0x1c01,
  touch: { mode: 10, radius: 4, strength: 4.0 },
  mode: MODE.ROCK_Y,
  pivot: [0, 0, 0],
  build(c) {
    const [ridgeShare, glintShare, faceShare, striationShare,
      innerShare, phantomShare, satelliteShare, moteShare, backdropShare, narrowShare, hazeShare] =
      c.split([0.44, 0.012, 0, 0.015, 0, 0.05, 0.28, 0.01, 0.133, 0.025, 0.035]);

    // A straight or curved structure of n points, written consecutively and
    // placed cut-true: write j takes grid point g[j] of n, so every ladder cut
    // keeps an evenly spaced subset of it (lib/sampling.js progressiveGrid).
    const line = (n, at, write) => {
      if (n <= 0) return;
      const g = progressiveGrid(c.ahead(n));
      for (let j = 0; j < n; j++) {
        const t = (g[j] + 0.5) / n;
        write(at(t), t);
      }
    };
    // A straight segment from a to b, both already posed. Writes into one
    // scratch point: tens of thousands of these run per bake, and the caller
    // consumes each point before asking for the next.
    const P = [0, 0, 0];
    const segment = (a, b) => (t) => {
      P[0] = a[0] + (b[0] - a[0]) * t;
      P[1] = a[1] + (b[1] - a[1]) * t;
      P[2] = a[2] + (b[2] - a[2]) * t;
      return P;
    };
    // The hand-drawn thickness of a line: a bell jitter of s per axis with its
    // component along the line (unit dir) taken out, so it never moves a point
    // along the line and the cut-true spacing holds exactly at every rung.
    const J = [0, 0, 0];
    const across = (p, dir, s) => {
      const jx = c.rng.bell() * s, jy = c.rng.bell() * s, jz = c.rng.bell() * s;
      const k = jx * dir[0] + jy * dir[1] + jz * dir[2];
      J[0] = p[0] + jx - k * dir[0];
      J[1] = p[1] + jy - k * dir[1];
      J[2] = p[2] + jz - k * dir[2];
      return J;
    };

    /* ---- Ridges ----------------------------------------------------------
       Budget by length, so every edge is drawn at the density its light asks
       for (the old shade-only split spread it 7x between edges), times the
       hidden-line weight. Energy per point follows the hidden-line weight
       too, through the size. */
    const ridgeBudget = allocate(
      ridgeShare,
      MAIN.edges.map((e) => e.length * (0.35 + 0.65 * e.shade) * (e.rank === 0 ? 1.1 : 0.9) * DENSITY[e.visibility]),
    );
    MAIN.edges.forEach((edge, index) => {
      const shade = edge.shade;
      const energy = Math.sqrt(ENERGY[edge.visibility]);
      const lit = (shade - 0.12) / 0.88;
      const a = orient(edge.a), b = orient(edge.b);
      const dir = normalize(sub(b, a));
      line(ridgeBudget[index], segment(a, b), (p0, t) => {
        const p = across(p0, dir, 0.010);
        c.write(
          p[0], p[1], p[2],
          (RIDGE_SIZE[0] + RIDGE_SIZE[1] * shade) * (1 + Math.sin(t * Math.PI) * 0.12) * energy,
          0.5 - 0.4 * lit,
          0.04 + Math.abs(t - 0.5) * 0.16 + (edge.rank === 0 ? 0 : 0.05),
          AMP,
          1
        );
      });
    });

    /* ---- Glints ----------------------------------------------------------
       Only where light lands: per corner, the cube of its best face shade, so
       the apex and the lit shoulders carry almost all of it and the shadowed
       corners next to none. A tight ball of small hot points, placed by rank
       (a cut keeps a smaller ball of the same shape), and white. */
    const cornerLight = MAIN.corners.map((k) => Math.max(...k.faces.map((f) => shadeOf(f.normal))));
    const glintBudget = allocate(glintShare, cornerLight.map((s) => s * s * s));
    MAIN.corners.forEach((corner, index) => {
      const n = glintBudget[index];
      if (n <= 0) return;
      const p = orient(corner.at);
      const u = byRank(c.ahead(n), 3);
      for (let j = 0; j < n; j++) {
        const r = 0.09 * u[j * 3] * u[j * 3];
        const cosPhi = u[j * 3 + 1] * 2 - 1;
        const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
        const theta = u[j * 3 + 2] * TAU;
        c.write(
          p[0] + r * sinPhi * Math.cos(theta),
          p[1] + r * cosPhi,
          p[2] + r * sinPhi * Math.sin(theta),
          c.rng.range(0.6, 1.0),
          c.rng.range(0.02, 0.16),
          0.02 + c.rng.range(0, 0.02),
          AMP,
          1
        );
      }
    });

    // Face fill. Budget 0: faces are implied by their edges and striations.
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

    /* ---- Striations ------------------------------------------------------
       Horizontal lines across the lit prism faces, quartz's diagnostic prism
       texture, at four uneven heights and stopping short of the edges. Faint
       and fine; at the 37k cut they read dotted. */
    const LINES = [0.17, 0.31, 0.58, 0.79];
    const prismFaces = MAIN.faces.filter((f) => f.kind === 'prism');
    let litPrisms = prismFaces.filter((f) => shadeOf(f.normal) > 0.36);
    if (!litPrisms.length) {
      litPrisms = prismFaces.slice().sort((a, b) => shadeOf(b.normal) - shadeOf(a.normal)).slice(0, 2);
    }
    const lineBudgets = allocate(
      striationShare,
      litPrisms.flatMap((f) => LINES.map(() => 0.35 + shadeOf(f.normal))),
    );
    let lineCursor = 0;
    litPrisms.forEach((f) => {
      const shade = shadeOf(f.normal);
      LINES.forEach((v) => {
        line(lineBudgets[lineCursor++], (t) => {
          const u = 0.05 + 0.9 * t;
          return lerp3(lerp3(f.quad[0], f.quad[1], u), lerp3(f.quad[3], f.quad[2], u), v);
        }, (p) => {
          const q = orient([p[0], p[1] + c.rng.bell() * 0.008, p[2]]);
          c.write(
            q[0], q[1], q[2],
            c.rng.range(0.08, 0.12) * (0.75 + 0.5 * shade),
            c.rng.range(0.25, 0.4),
            0.4 + v * 0.14,
            AMP,
            1
          );
        });
      });
    });

    // A second, inner body. Budget 0: the phantom below carries the interior.
    const innerEdges = INNER.edges.filter((e) => e.rank === 0);
    const innerBudget = allocate(innerShare, innerEdges.map(() => 1));
    innerEdges.forEach((edge, index) => {
      line(innerBudget[index], (t) => orient(lerp3(edge.a, edge.b, t)), (p) => {
        c.write(
          p[0] + c.rng.bell() * 0.026,
          p[1] + c.rng.bell() * 0.026,
          p[2] + c.rng.bell() * 0.026,
          c.rng.range(0.11, 0.2),
          c.rng.range(0.6, 1),
          c.rng.range(0, 0.05),
          AMP,
          1
        );
      });
    });

    /* ---- Phantom ---------------------------------------------------------
       An earlier growth cap inside the point. Scaled 0.68 about the body's
       axis with its apex 1.2 below the final one, so every face is parallel
       to the final cap's: its six cap edges, its six ring edges, and six drop
       lines down the old prism edges, 1.8 of the scale long, fading to 35%
       the way a phantom fades into clear quartz. Faint continuous ghost
       lines, in the accent. */
    {
      const S = 0.68;
      const apexY = H + T - 1.2;
      const ringY = apexY - T * S;
      const ringV = [];
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU;
        ringV.push([Math.cos(a) * R * S, ringY, Math.sin(a) * R * S]);
      }
      const apexV = [0, apexY, 0];
      const segs = [];
      for (let k = 0; k < 6; k++) {
        segs.push({ a: ringV[k], b: apexV, weight: 1, fade: false });
        segs.push({ a: ringV[k], b: ringV[(k + 1) % 6], weight: 1, fade: false });
        segs.push({ a: ringV[k], b: [ringV[k][0], ringY - 1.8 * S, ringV[k][2]], weight: 0.6, fade: true });
      }
      const budgets = allocate(phantomShare, segs.map((s) => Math.hypot(...sub(s.b, s.a)) * s.weight));
      segs.forEach((seg, index) => {
        const a = orient(seg.a), b = orient(seg.b);
        const dir = normalize(sub(b, a));
        line(budgets[index], segment(a, b), (p0, t) => {
          const taper = seg.fade ? 1 - 0.65 * t : 1;
          const p = across(p0, dir, 0.006);
          c.write(
            p[0], p[1], p[2],
            c.rng.range(0.12, 0.17) * taper,
            c.rng.range(0.72, 0.92),
            0.1 + t * 0.06,
            AMP,
            1
          );
        });
      });
    }

    /* ---- Satellites ------------------------------------------------------
       Paths are lines, placed cut-true. Nodes sit on the vertices (the
       crane's only on its four tips), handed out round robin by rank, so
       every vertex keeps its node at every rung. */
    const satelliteBudgets = allocate(satelliteShare, SATELLITES.map((satellite) => satellite.weight));
    SATELLITES.forEach((satellite, satelliteIndex) => {
      const [basePathShare, baseNodeShare] = allocate(satelliteBudgets[satelliteIndex], [0.94, 0.06]);
      const nodeShare = satellite.nodes.length ? baseNodeShare : 0;
      const pathShare = basePathShare + baseNodeShare - nodeShare;
      const pathBudgets = allocate(pathShare, satellite.paths.map((path) => path.weight));
      const reveal = Math.min(0.9, 0.58 + satelliteIndex * 0.045);
      const tone = 0.3 + satelliteIndex * 0.08;
      const rock = AMP * satellite.rock;
      const place = placement(satellite);

      satellite.paths.forEach((path, pathIndex) => {
        // A straight edge has one direction; the saddle's curved rulings take
        // theirs from the path itself at each point.
        const ends = path.ends && [place(path.ends[0]), place(path.ends[1])];
        const straight = ends && normalize(sub(ends[1], ends[0]));
        const tangent = (t) => straight
          || normalize(sub(place(path.point(Math.min(1, t + 1e-3))), place(path.point(Math.max(0, t - 1e-3)))));
        line(pathBudgets[pathIndex], ends ? segment(ends[0], ends[1]) : (t) => place(path.point(t)), (p0, t) => {
          const cadence = 0.75 + 0.25 * Math.pow(Math.sin(t * Math.PI * 5), 8);
          const p = across(p0, tangent(t), 0.006);
          c.write(
            p[0], p[1], p[2],
            c.rng.range(0.26, 0.32) * cadence,
            Math.min(1, tone + c.rng.range(0.06, 0.16)),
            reveal + c.rng.range(0, 0.045),
            rock,
            1
          );
        });
      });

      const nodeOf = roundRobin(c.ahead(nodeShare), Math.max(1, satellite.nodes.length));
      const centres = satellite.nodes.map(place);
      for (let j = 0; j < nodeShare; j++) {
        const centre = centres[nodeOf[j]];
        const radius = 0.07 * Math.pow(c.rng.unit(), 1.8);
        const y = c.rng.signed();
        const planar = Math.sqrt(Math.max(0, 1 - y * y));
        const angle = c.rng.unit() * TAU;
        c.write(
          centre[0] + Math.cos(angle) * planar * radius,
          centre[1] + y * radius,
          centre[2] + Math.sin(angle) * planar * radius,
          c.rng.range(0.45, 0.75),
          c.rng.range(0.68, 1),
          reveal,
          rock,
          1
        );
      }
    });

    /* ---- Motes -----------------------------------------------------------
       Inclusions, strictly inside the body, low-discrepancy by rank. */
    {
      const box = (q) => [(q[0] * 2 - 1) * R, (q[1] * 2 - 1) * (H + T), (q[2] * 2 - 1) * R];
      const u = byRank(c.ahead(moteShare), 3, (q) => insideBody(box(q), 0.85));
      for (let j = 0; j < moteShare; j++) {
        const p = orient(box([u[j * 3], u[j * 3 + 1], u[j * 3 + 2]]));
        c.write(
          p[0], p[1], p[2],
          c.rng.range(0.06, 0.14),
          c.rng.range(0.35, 0.9),
          0.44 + c.rng.range(0, 0.22),
          AMP,
          0.9
        );
      }
    }

    /* ---- Backdrop --------------------------------------------------------
       The far dust, screen-uniform in the hero frustum (widened to hold the
       reduced-motion frame too) at view depth 80-140, behind the subject,
       where fog dims it. Jittered off the R2 lattice, so it reads as a sky
       and not a grid. It rocks by at most 0.04 about the body, which keeps
       the parallax against the specimen without carrying it out of frame.
       The window ends at 2.1 of the frame height (plus 3%): a 21:9 window's
       outer tenth is left nearly dark, where widening it to 2.45 with a
       thinning taper would cost the common 16:9 field about 6% of its stars. */
    backdrop(c, backdropShare, {
      ...cameraOf(HERO),
      aspect: 2.1,
      jitter: 0.7,
      also: [{ ...cameraOf(HERO_REDUCED), aspect: 1.9 }],
      depth: [80, 140],
      size: [0.2, 0.8],
      lean: 2.6,
      tint: [0, 0.14],
      mode: MODE.ROCK_Y,
      rock: 0.04,
    });

    /* ---- Narrow dust -----------------------------------------------------
       Below 820 CSS px cv-universe.js reframe() pulls the hero camera back
       (to z 97-119), so the backdrop sits 130-190 units away, deep in the
       fog, and the frame, as tall in angle as the desktop's but seen from
       35-57 units further back, looks past the slab above and below it. This
       layer is that frame's star field: screen-uniform in the portrait
       reframe (widened to hold its reduced-motion twin) at 64-95 units, in
       front of the specimen, and only where no desktop camera looks. Every
       candidate inside the hero or the reduced desktop frustum, for any
       window up to 2.7:1, widened by their pointer parallax and breath and by
       this layer's own rock, is skipped. So a desktop never has it in frame
       (it is the 2.5% of the budget a desktop draws offscreen), and on a
       phone it fills the top and bottom of the screen, thinning toward the
       specimen, where the backdrop still shows through the fog. */
    {
      const A = 2.7;
      const sway = (ch, parallax) => {
        const t = Math.tan((ch.fov * Math.PI) / 360);
        // parallax + breath (0.55, 0.4, and 0.35 along the view) + this
        // layer's rock (0.02 rad at up to 56 units from the axis, 0.34 of it
        // in pitch at up to 67) + 0.3 to spare.
        return [parallax + 0.55 + 0.35 * t * A + 1.12 + 0.3, parallax * 0.7 + 0.4 + 0.35 * t + 0.46 + 0.3];
      };
      backdrop(c, narrowShare, {
        ...narrowCamera(HERO, 1.34),
        aspect: 0.6,
        jitter: 0.7,
        also: [{ ...narrowCamera(HERO_REDUCED, 1.34), aspect: 0.6 }],
        avoid: [
          { ...cameraOf(HERO), aspect: A, reach: sway(HERO, 1.6 + Math.abs(HERO.camZ) * 0.02) },
          { ...cameraOf(HERO_REDUCED), aspect: A, reach: sway(HERO_REDUCED, 0) },
        ],
        depth: [64, 95],
        size: [0.2, 0.8],
        lean: 2.6,
        tint: [0, 0.14],
        mode: MODE.ROCK_Y,
        rock: 0.02,
      });
    }

    /* ---- Mineral haze ----------------------------------------------------
       Fine dust close around the body's waist, thinning outward: radius 5.5
       to 8 with the density falling off over about a unit, flattened to 0.6
       in the body's own height, in the pose, clear of the body and of every
       specimen. It barely turns with the body and drifts a little on the
       noise field, so the specimen reads as turning inside it. */
    {
      const clear = SATELLITES.map((s) => s.centre);
      const fall = 1 - Math.exp(-2.5 / 1.1);
      const upright = (q) => {
        const r = 5.5 - 1.1 * Math.log(1 - q[0] * fall);
        const y = 1 - 2 * q[1];
        const s = Math.sqrt(Math.max(0, 1 - y * y));
        const phi = q[2] * TAU;
        return [r * s * Math.cos(phi), r * y * 0.6, r * s * Math.sin(phi)];
      };
      const u = byRank(c.ahead(hazeShare), 3, (q) => {
        const o = upright(q);
        if (insideBody(o, 1.15)) return false;
        const p = orient(o);
        return clear.every((k) => Math.hypot(p[0] - k[0], p[1] - k[1], p[2] - k[2]) > 1.8);
      });
      for (let j = 0; j < hazeShare; j++) {
        const p = orient(upright([u[j * 3], u[j * 3 + 1], u[j * 3 + 2]]));
        c.write(
          p[0], p[1], p[2],
          c.rng.range(0.05, 0.1),
          c.rng.range(0.3, 0.6),
          0.6 + c.rng.range(0, 0.3),
          0.06,
          0.3
        );
      }
    }
  },
};
