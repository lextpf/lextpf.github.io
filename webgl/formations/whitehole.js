
import { MODE, OUTFLOW } from '../lib/modes.js';
import { TAU } from '../lib/random.js';
import { CHAPTERS, REDUCED_CHAPTERS } from '../chapters.js';
import { progressiveGrid, jittered, backdrop } from '../lib/sampling.js';
import { allocate, ellipsoid } from './sculpt.js';
import { BLACK_HOLE_HORIZON } from './blackhole.js';

// The axis the black hole had until its seventh cut (formations/blackhole.js
// BLACK_HOLE_TILT): the white hole keeps it.
const WHITE_HOLE_TILT = { x: -1.08, y: 0.58, z: 0 };
import { BIPOLAR_PLUME_SPIN, writeBipolarPlumes } from './bipolar-plumes.js';

/* ==========================================================================
   THE WHITE HOLE (Closing)

   The black hole run backwards: the same axis (WHITE_HOLE_TILT), the same
   jets, matter streaming out instead of in, and a lit aperture instead of a
   shadow. The composite draws the white disc and its limb (post-processing.js)
   at 0.72 of the projected 6.2-unit sphere; everything here is laid out from
   that drawn limb, LIMB, rather than from the tiny kernel inside it, where 82%
   of the old corona and 38% of the old disc sat hidden under the plateau.

   Populations, in write order (shares of the budget): core 0.01, corona 0.20,
   disc 0.15, spiral arms 0.17, jets 0.20, emitter 0.20, shock shells 0.05 and
   the sky 0.02.

   - The corona is an eclipse corona at solar minimum, drawn in the Closing
     camera's sky plane (world space, spin 0: mode 7 passes spin 0 through
     untouched, so it neither tilts, turns nor pulses with the jets). 84 rays
     start at the drawn limb. The long ones lie along the equator (across the
     projected jet axis) and the short ones at the poles: a ray's length is
     scaled by 0.55 + 0.75 |sin(theta - psi)|^1.5, psi the projected jet
     angle. Equatorial rays are helmet streamers: five field lines leaving
     the limb across a base about 0.2 rad wide and converging on a stalk 0.04
     wide. Polar rays stay single lines. The light sits at the limb: a
     particle's energy falls as (LIMB / r)^2.5, the rays are denser near their
     base, and the streamers outshine the polar plumes. Each ray bends once,
     coherently, toward the equator (the open field of a real corona), never
     by per-particle curl.
   - The disc and the seven spiral arms start at the limb too and run out to
     r 32 (mode 7: plumeMotion's slow twist). The disc turns differentially,
     as before; the arms turn as one pattern, so they never wind into rings.
     The disc is a jittered Roberts fill, each arm a jittered band along its
     log spiral, so a ladder cut keeps them even.
   - The jets are the shared bipolar plumes (bipolar-plumes.js).
   - The emitter is the transport (spin < 0): ejecta streaming out from the
     kernel to the frame's edge (shape() mode 7, curvedTransport).
   - The shock shells are five arcs round the disc, along the progressive grid.
   - The sky is a backdrop (lib/sampling.js) in the Closing frame, widened to
     hold the reduced one, at view depth 80-140, world space, spin 0. It
     replaces a ring of dust at r 36-58, half of it outside the frame.
   ========================================================================== */

const KERNEL = 0.75;
const DISC_OUT = 32;
const SPIN = BIPOLAR_PLUME_SPIN;

const CLOSING = CHAPTERS.find((ch) => ch.id === 'closing');
const CLOSING_REDUCED = REDUCED_CHAPTERS.find((ch) => ch.id === 'closing');
const cameraOf = (ch) => ({
  cam: [ch.camX, ch.camY, ch.camZ], tgt: [ch.tgtX, ch.tgtY, ch.tgtZ], fov: ch.fov,
});

// The drawn limb: the composite's aperture is the chapter's `horizon` (0.72)
// of the projected BLACK_HOLE_HORIZON sphere; the corona starts 2% outside it.
const LIMB = BLACK_HOLE_HORIZON * CLOSING.horizon * 1.02;

// The Closing camera's sky plane: its right and up vectors, the way three's
// lookAt builds them with world Y up. The reduced camera ([0, 0, 54]) looks
// within 2.1 degrees of it.
const norm3 = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const VIEW = norm3([CLOSING.tgtX - CLOSING.camX, CLOSING.tgtY - CLOSING.camY, CLOSING.tgtZ - CLOSING.camZ]);
const SKY_X = norm3(cross3(VIEW, [0, 1, 0]));
const SKY_Y = cross3(SKY_X, VIEW);
// The jet axis, local z carried through the tilt (three's Euler XYZ: the
// third column of the rotation), projected onto the sky: its angle there, psi.
const JET = (() => {
  const { x, y } = WHITE_HOLE_TILT;
  return [Math.sin(y), -Math.sin(x) * Math.cos(y), Math.cos(x) * Math.cos(y)];
})();
const PSI = Math.atan2(
  JET[0] * SKY_Y[0] + JET[1] * SKY_Y[1] + JET[2] * SKY_Y[2],
  JET[0] * SKY_X[0] + JET[1] * SKY_X[1] + JET[2] * SKY_X[2],
);

const smooth = (t) => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};
// A triangular variate on [-1, 1] from a uniform one, for sets placed by rank.
const tri = (p) => (p < 0.5 ? -1 + Math.sqrt(2 * p) : 1 - Math.sqrt(2 * (1 - p)));

/* ---- The corona -------------------------------------------------------- */

const RAYS = 84;
// Density along a ray: write t lands at s = t^RAY_DENSITY of its length, so
// the rays crowd their base, where the light is.
const RAY_DENSITY = 1.6;
// A particle's energy at radius r is (LIMB / r)^2.5 of one at the limb, so
// its size (energy goes as size squared) is (LIMB / r)^1.25.
const CORONA_FALL = 1.25;
// Where a fan's field lines leave the limb, across its base (in half-widths).
const FAN_LINES = [-1, -0.5, 0, 0.5, 1];

function corona(c, n) {
  const rays = [];
  for (let k = 0; k < RAYS; k++) {
    // Spaced evenly round the limb, each nudged by up to a third of the
    // spacing, so the rays never stand like the teeth of a comb.
    const theta = ((k + 0.5 + c.rng.bell() * 0.35) / RAYS) * TAU;
    const phi = theta - PSI;
    const eq = Math.abs(Math.sin(phi));
    const lat = Math.pow(eq, 1.5);
    const length = c.rng.range(2.5, k % 11 === 0 ? 11 : 7) * (0.55 + 0.75 * lat);
    // How much of a helmet streamer the ray is: none at the poles, all of it
    // along the equator.
    const fan = smooth((eq - 0.7) / 0.25);
    // One coherent bend, toward the equator (phi = +-90 degrees), strongest
    // at mid latitudes, plus a little of the ray's own.
    const bend = 0.14 * Math.sin(2 * phi) + c.rng.bell() * 0.05;
    // The ray's light: the streamers carry the corona, the polar plumes are a
    // fine brush, and no two rays are quite as bright.
    const gain = c.rng.range(0.55, 1) * (0.55 + 0.45 * lat) * (k % 11 === 0 ? 1.15 : 1);
    rays.push({ theta, length, fan, bend, gain });
  }
  const budgets = allocate(n, rays.map((ray) => ray.length * (0.5 + 2 * ray.fan)));
  rays.forEach((ray, k) => {
    // A fan is a family of field lines leaving the limb across its base and
    // converging on its stalk; a polar ray is one line. Each line is written
    // consecutively along the progressive grid, so a cut keeps it even.
    const lines = ray.fan > 0.02 ? FAN_LINES : [0];
    const counts = allocate(budgets[k], lines.map((v) => 1 - 0.45 * Math.abs(v)));
    lines.forEach((v, li) => {
      const m = counts[li];
      if (m <= 0) return;
      const g = progressiveGrid(c.ahead(m));
      for (let j = 0; j < m; j++) {
        // Rays rise out of the glow: they start at 0.55 of the old limb and
        // fade in over their first stretch, so no ring of ray bases marks an
        // edge (the white hole has none).
        const s = Math.pow((g[j] + 0.5) / m, RAY_DENSITY);
        const r = LIMB * 0.55 + (ray.length + LIMB * 0.45) * s;
        const rise = smooth((r - LIMB * 0.55) / (LIMB * 0.6));
        // Half-width in radians: 0.1 at the limb narrowing to 0.02 at the tip.
        const half = ray.fan * (0.02 + 0.08 * Math.pow(1 - s, 1.5));
        const across = v * half;
        const angle = ray.theta + ray.bend * s * s + across;
        const cx = Math.cos(angle) * r;
        const cy = Math.sin(angle) * r;
        c.write(
          SKY_X[0] * cx + SKY_Y[0] * cy,
          SKY_X[1] * cx + SKY_Y[1] * cy,
          SKY_X[2] * cx + SKY_Y[2] * cy,
          c.rng.range(0.42, 0.58) * Math.pow(LIMB / Math.max(r, LIMB), CORONA_FALL) * (1 - 0.25 * Math.abs(v)) * Math.sqrt(ray.gain) * (0.15 + 0.85 * rise),
          Math.min(1, 0.15 + 0.65 * s + 0.2 * Math.abs(v)),
          0.035 + s * 0.2,
          0,
          0.96,
        );
      }
    });
  });
}

/* ---- The disc and the arms --------------------------------------------- */

function disc(c, n) {
  const { p } = jittered(c.ahead(n), 2, 0.7, 17);
  for (let j = 0; j < n; j++) {
    const u = p[j * 2];
    const radius = LIMB * Math.pow(DISC_OUT / LIMB, u);
    const angle = p[j * 2 + 1] * TAU;
    const turbulence =
      0.58 +
      0.24 * Math.cos(angle * 3 - Math.log(radius / LIMB) * 8.5) +
      0.18 * Math.sin(angle * 7 + radius * 0.45);
    const height = c.rng.bell() * (0.12 + radius * 0.052) * (0.5 + turbulence);
    c.write(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      height,
      c.rng.range(0.17, 0.38) * (1.15 - u * 0.62) * (0.75 + turbulence),
      Math.min(1, 0.34 + u * 0.56 + turbulence * 0.08),
      0.1 + u * 0.48,
      SPIN * (1.35 - u * 0.7),
      0.82,
    );
  }
}

// The arms turn as one pattern (mode 7's slow twist, at ARM_SPIN): turned
// differentially, inner faster, they wound themselves into rings within a few
// minutes of the page being left open. ARM_PHASE sets where they stand.
const ARM_SPIN = SPIN * 1.1;
const ARM_PHASE = 0.9;

function arms(c, n) {
  const ARMS = 7;
  const budgets = allocate(n, Array.from({ length: ARMS }, (_, index) => (index < 2 ? 1.25 : 1)));
  for (let arm = 0; arm < ARMS; arm++) {
    const count = budgets[arm];
    // Evenly phased, alternately wound: arms of opposite hand cross each
    // other in projection, which is what draws the white hole's loops. The
    // pitches step by the golden ratio through 2.0-3.2, fixed, so the arms do
    // not reshuffle whenever another population draws more or fewer numbers.
    const phase = ARM_PHASE + (arm / ARMS) * TAU + 0.12 * Math.sin(arm * 2.3);
    const pitch = (2.0 + 1.2 * ((arm * 0.618034) % 1)) * (arm % 2 ? 1 : -1);
    const at = (u) => {
      const radius = LIMB + (DISC_OUT - LIMB) * Math.pow(u, 1.18);
      const angle = phase + pitch * Math.log(radius / LIMB);
      return [Math.cos(angle) * radius, Math.sin(angle) * radius, radius];
    };
    // Along the arm and across it: a jittered Roberts set, so the band is
    // even along its length at every rung; the scatter stays across it.
    const { p } = jittered(c.ahead(count), 2, 0.7, 509 + arm * 13);
    for (let j = 0; j < count; j++) {
      const u = p[j * 2];
      const [x, y, radius] = at(u);
      const [x1, y1] = at(Math.min(1, u + 1e-3));
      const [x0, y0] = at(Math.max(0, u - 1e-3));
      const tl = Math.hypot(x1 - x0, y1 - y0) || 1;
      const nx = -(y1 - y0) / tl;
      const ny = (x1 - x0) / tl;
      const gap = 0.6 + 0.4 * Math.pow(Math.sin(u * Math.PI * (3 + arm % 3) + phase), 2);
      const width = (0.12 + radius * 0.018) * 1.6;
      const across = tri(p[j * 2 + 1]) * width;
      c.write(
        x + nx * across,
        y + ny * across,
        c.rng.bell() * (0.1 + radius * 0.025),
        c.rng.range(0.25, 0.53) * (1.2 - u * 0.62) * gap,
        Math.min(1, 0.52 + u * 0.44),
        0.09 + u * 0.5,
        ARM_SPIN,
        0.96,
      );
    }
  }
}

/* ---- The outflow ------------------------------------------------------- */

function emitter(c, n) {
  for (let i = 0; i < n; i++) {
    const t = (i + c.rng.unit()) / n;
    const distance = OUTFLOW.ejectStart + OUTFLOW.ejectSpan * t;
    const polar = c.rng.range(-1, 1);
    const planar = Math.sqrt(Math.max(0, 1 - polar * polar));
    const angle = c.rng.unit() * TAU;
    const spread = 0.025 + distance * 0.0035;
    c.write(
      Math.cos(angle) * planar * distance + c.rng.bell() * spread,
      Math.sin(angle) * planar * distance + c.rng.bell() * spread,
      polar * distance + c.rng.bell() * spread,
      c.rng.range(0.22, 0.5) * (1.08 - t * 0.46),
      Math.min(1, 0.58 + t * 0.4),
      0.08 + t * 0.82,
      -c.rng.range(0.16, 1.16),
      1,
    );
  }
}

function shocks(c, n) {
  const SHELLS = 5;
  const budgets = allocate(n, Array.from({ length: SHELLS }, (_, index) => 1 + index * 0.12));
  for (let shell = 0; shell < SHELLS; shell++) {
    const count = budgets[shell];
    const radius = 6.0 + shell * 3.0;
    const start = c.rng.range(-0.7, 0.4);
    const span = c.rng.range(3.7, 5.2);
    const g = progressiveGrid(c.ahead(count));
    for (let i = 0; i < count; i++) {
      const t = (g[i] + 0.5) / count;
      const angle = start + span * t;
      const wobble = Math.sin(angle * 3 + shell) * 0.22;
      c.write(
        Math.cos(angle) * (radius + wobble),
        Math.sin(angle) * (radius + wobble),
        c.rng.bell() * (0.18 + shell * 0.08),
        c.rng.range(0.13, 0.3) * (1 - shell * 0.09),
        c.rng.range(0.62, 0.96),
        0.62 + shell * 0.045 + t * 0.04,
        SPIN * 0.7,
        0.88,
      );
    }
  }
}

export const whitehole = {
  seed: 0xf10e,
  touch: { mode: 11, radius: 11, strength: 1.6 },
  mode: MODE.OUTFLOW,
  // The black hole's former axis; its jets turn 11 degrees through the collapse.
  tilt: WHITE_HOLE_TILT,
  pivot: [0, 0, 0],
  // A backstop: the Closing chapter's `warm` is 0 in both scores.
  warmRadius: 4.6,
  build(c) {
    const [coreShare, coronaShare, discShare, spiralShare,
      plumeShare, emitterShare, shockShare] =
      c.split([0.01, 0.20, 0.15, 0.17, 0.20, 0.20, 0.05, 0.02]);

    // The kernel, under the plateau: a trace of it, for the morph.
    ellipsoid(c, [0, 0, 0], coreShare, {
      radii: [KERNEL * 1.05, KERNEL * 1.05, KERNEL],
      shellShare: 0.3,
      shellMin: 0.7,
      volumePower: 0.85,
      size: (radius) => 0.78 - radius * 0.22,
      tint: (radius) => 0.6 + radius * 0.32,
      tintJitter: 0.08,
      stagger: (radius) => 0.008 + radius * 0.02,
      spin: () => SPIN,
      rigidity: () => 1,
    });
    corona(c, coronaShare);
    disc(c, discShare);
    arms(c, spiralShare);
    // The jets rise out of the glow from near the kernel and fade in over
    // their first third: the white hole has no horizon to start them at.
    writeBipolarPlumes(c, plumeShare, { spin: SPIN, start: 1.2, end: 39.5, fadeIn: 0.34 });
    emitter(c, emitterShare);
    shocks(c, shockShare);

    // The sky: the rest of the budget (the split's last share, 0.02), in the
    // Closing frame and widened to hold the reduced one. World space, spin 0.
    backdrop(c, c.count - c.cursor, {
      ...cameraOf(CLOSING),
      aspect: 2.1,
      jitter: 0.7,
      also: [{ ...cameraOf(CLOSING_REDUCED), aspect: 1.9 }],
      depth: [80, 140],
      size: [0.2, 0.8],
      lean: 2.6,
      tint: [0, 0.14],
      mode: MODE.OUTFLOW,
    });
  },
};
