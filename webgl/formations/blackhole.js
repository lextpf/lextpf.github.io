
import { MODE, ACCRETION, ACCRETION_STREAMS, streamSpin, WHIRL, whirlSpin } from '../lib/modes.js';
import { TAU } from '../lib/random.js';
import { CHAPTERS, REDUCED_CHAPTERS } from '../chapters.js';
import { progressiveGrid, jittered, hash01, backdrop } from '../lib/sampling.js';
import { allocate, normalize, cross } from './sculpt.js';
import { BIPOLAR_PLUME_SPIN, writeBipolarPlumes } from './bipolar-plumes.js';

/* ==========================================================================
   THE BLACK HOLE (Stack, Hobbies)

   Sixth cut (2026-10-03): the lens is a black hole's. Every particle of the
   formation is drawn where its light reaches the camera past a Schwarzschild
   hole (shaders/particles.js holeImage, exact image radii from
   lib/lens-table.js) whose critical curve is the shadow the composite draws
   (post-processing.js, BLACK_HOLE_HORIZON x the chapter's `horizon`, 0.72),
   and drawn a second time at its secondary image (the mirror pass,
   particle-system.js). That is the double image real renders show: the far
   side of the disc, hidden behind the shadow without the lens, arches over
   it; the near side crosses in front almost untouched. Frame dragging
   turns the light that passed behind the hole a little in the disc's sense.
   The dots are never stretched, only placed, and their light is the
   magnification. The third cut's halo of dots and the fifth cut's vortex are
   gone; the composite keeps only the thin core of its warm ring while the
   lens is on, so the gap between the shadow and the arch stays dark. The
   chapters' `lensing` (1 at Stack and Hobbies) scales the hole's mass; 0 is
   the unlensed disc with the painted ring.

   The mirror pass draws the arch the lens lifts over the shadow a second
   time, reflected across the disc's line on the sky, so it shows under the
   shadow too: the double image, symmetric about the disc, and clear of the
   orange ring.

   The jets rise from the hole's centre along the disc's spin axis, so they
   lean with the disc and run in depth: the upper one toward the camera, the
   lower one away. They grow out of nothing over their first 12% (fadeIn).
   The upper (near) one is moved out along the axis (JET_BEND lift) so its
   base is at the disc, drawn over the shadow's edge (vNear), beamed
   brighter and drawn larger toward the camera; the
   far one is dimmer and smaller, and comes out from behind the disc (the
   disc is opaque to it, discShade), its base lensed round the shadow's rim. Past the shadow both bend in 3D in the
   disc's own frame (lib/modes.js JET_BEND): straight at first, then turning
   back toward the screen's vertical, the two to opposite sides and tipped in depth, so
   they are one S in space. The bend holds still (it is applied after the
   shader's twist), and they take only a fifth of the lens.

   The disc is pulled in and stretched: its inner rim at 0.82 of the sphere
   (1.06 before), 1.14 apertures from the hole's centre, so the brightest
   light sits right against the shadow where the lens is strongest, and its
   outer reach is a quarter further out (the skirt to 3.5 R, 2.8 before; the
   whirlpool's rim, feeders and debris rings moved with it).

   The disc is a thin sheet whose density rises monotonically to the rim. A
   rotating particle's baked z is the amplitude of its bob about the disc
   plane, which the shader lifts by sin(azimuth - node(r)) as it orbits
   (lib/modes.js ACCRETION warpNode*): every particle rides its own inclined
   orbit and together they trace one fixed surface the material flows
   through, so the shape never winds up under the differential rotation.
   Brightness by beaming is the shader's (dopplerFor, mode 5) for everything
   that turns, lensed or not.

   Populations, in write order (shares of the budget):
   - Inner torus 0.198. Thirty lanes from 0.82 R to 1.45 R, overlapping in
     radius so they read as one sheet, each turning rigidly at the Kepler
     rate of its radius (OMEGA, r^-1.5, now held only inside the rim) so
     inner lanes lap outer ones while a lane itself never smears (its dots
     stay evenly spaced round it at every rung: the progressive grid). Dots
     per lane fall outward and the lanes dim outward, so the torus is
     densest and hottest at the rim and has no outer edge against the mid
     disc.
   - Mid disc 0.135. Sixty faint overlapping lanes from 1.45 R to 2.5 R, each
     at its own Kepler rate and faint inclination, even round the lane, dots
     per lane falling as r^-1.6, so the sheet thins smoothly outward.
   - Skirt 0.045. A wide, faint dust disc out to 3.5 R, packed toward its
     inner edge (t = u^2.2) and fading outward, lifting into an S-warp
     (amplitude growing as (r - warpFrom)^1.4).
   - Hot spots: none since the sixth cut (their knots read as clumps against
     the lensed rim; the torus took their share). Before: three loose clumps of the hottest material sheared
     along the innermost orbits (0.9, 1.0 and 1.14 R), each turning at its
     orbit's rate. Most of the time they are three brighter knots in the
     rim; passing behind the hole each is pulled out and smeared round the
     shadow.
   - Feeders 0.04. Four trailing spiral streams of dust winding in from
     4.4 R to the mid disc, at four pitches so they approach and part without
     crossing, turning as one pattern with the disc, widest and faintest at
     their far ends: tidal streams, the black hole's answer to the white
     hole's arms.
   - Rings 0.05. Five thin rings of debris on planes tilted 22 to 55 degrees
     to the disc, just outside the mid disc (radii 14.9 to 20.3),
     alternately turning with and against the disc about their own normals
     (spin tags 100 + 10 k + 5 + rate, ACCRETION_STREAMS).
   - Infall cloud 0.25. The white hole's emitter in reverse: material from
     EVERY direction, spread evenly over the sphere, on transport paths
     (spin < 0, a continuous id; shape() mode 5, curvedTransport), gently
     bent, heating as it falls (transportVisibility). Under the shutter each
     is a short streak along its path, until the lens moves it: there it is
     drawn as dots. Spread outward
     (t = u^1.1) so it does not pile up at the hole and bury the disc.
   - Infall strands 0.01. Six lone strands, one transport id each: a few
     coherent lines among the cloud.
   - Corona 0.02. Sparse sparks on high-amplitude orbits over the disc,
     packed toward the hole.
   - Jets 0.15, the lower jet with 35% more particles than the upper and
     0.7 of its width, so it is a tighter bundle of closer lines. The shared bipolar plumes (bipolar-plumes.js): ten filaments
     a side over a soft body (body 0.4), half again as bright as the white
     hole's (bright 1.5), straight (bow 0), from the hole's centre (1.2, growing in over the first
     12%) out to 30.
   - Whirlpool 0.08. Seven arms from the skirt's rim into the torus (see
     below).
   - Sky 0.022. A backdrop (lib/sampling.js) in the Stack frame, widened for
     Hobbies and the reduced frame, spin 0. It takes only the point lens,
     whose reach (HOLE_LENS) leaves it where it is.

   Placement. Every structure that must stay whole at the 37k rung is placed
   by slot rank (lib/sampling.js): lanes, rings and strands along the
   progressive grid, the fills, spots and streams by jittered(), the sky by
   backdrop().
   ========================================================================== */

// Exported because cv-universe.js needs it to project the horizon to screen
// space for the composite pass. Changing it moves the drawn disc too.
export const BLACK_HOLE_HORIZON = 6.2;

// The disc is deliberately not face-on. Seen edge-on it is a line, face-on it is
// a target; tilted, the jets and the disc are both legible at once. The white
// hole had this axis too until the seventh cut (2026-10-03), which turned the
// black hole's disc about 11 degrees nearer level on screen (y 0.58 to 0.40:
// the jets now lean 26 degrees off vertical, 37 before) and left the white
// hole where it was (formations/whitehole.js WHITE_HOLE_TILT).
export const BLACK_HOLE_TILT = { x: -1.08, y: 0.4, z: 0 };
const R = BLACK_HOLE_HORIZON;

const INNER_IN = R * 0.82;
const TORUS_OUT = R * 1.45;
const MID_OUT = R * 2.5;
const SKIRT_OUT = R * 3.5;
const FEED_OUT = R * 4.4;
const FEED_IN = R * 1.4;

// Angular velocity falling off as r^-1.5: Kepler's third law. Inner material
// laps outer material, which is what shears the disc into spirals over time
// instead of rotating it as a rigid plate. Held at the rim's rate inside it.
const OMEGA = (r) => 4.8 / Math.pow(Math.max(INNER_IN, r), 1.5);
// The skirt's warp amplitude (the bob the shader lifts by sin(azimuth - node)).
const warpH = (r) => 0.1 * Math.pow(Math.max(0, r - ACCRETION.warpFrom), 1.4);

const LANES = 30;
const LANE_SHARE = Array.from({ length: LANES }, (_, k) =>
  Math.pow((k + 1) / LANES, 1 / 1.7) - Math.pow(k / LANES, 1 / 1.7));
const laneRadius = (u) => INNER_IN * Math.pow(TORUS_OUT / INNER_IN, Math.min(1, Math.max(0, u)));
// A lane's radial spread in the torus's log-radius parameter: 0.02 against a
// lane spacing of 1/30, so neighbouring lanes overlap into one sheet.
const LANE_W = 0.02;
const DISC_GLOW = 1.1;

const STREAMERS = 0;
const STRANDS = 3;
const LONE = 6;
const STREAMER_AZ = [30, 150, 270];
const DEG = Math.PI / 180;
const GOLDEN = 0.6180339887498949;

const STACK = CHAPTERS.find((ch) => ch.id === 'stack');
const HOBBIES = CHAPTERS.find((ch) => ch.id === 'hobbies');
const STACK_REDUCED = REDUCED_CHAPTERS.find((ch) => ch.id === 'stack');
const cameraOf = (ch) => ({
  cam: [ch.camX, ch.camY, ch.camZ], tgt: [ch.tgtX, ch.tgtY, ch.tgtZ], fov: ch.fov,
});

function gauss(rng) {
  const u = Math.max(1e-12, rng.unit());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * rng.unit());
}
// A triangular variate on [-1, 1] from a uniform one, for sets placed by rank.
const tri = (p) => (p < 0.5 ? -1 + Math.sqrt(2 * p) : 1 - Math.sqrt(2 * (1 - p)));

/* ---- The populations, in write order ----------------------------------- */

function innerTorus(c, n) {
  const counts = allocate(n, LANE_SHARE);
  for (let lane = 0; lane < LANES; lane++) {
    const m = counts[lane];
    const u0 = (lane + 0.5) / LANES;
    const r0 = laneRadius(u0);
    const spin = OMEGA(r0);
    const glow = 1.2 * Math.pow(INNER_IN / r0, DISC_GLOW);
    // Crisp at the inner rim, puffed through the body: the rim stays a sharp
    // line of light while the torus behind it has depth.
    const thick = 0.012 + 0.07 * Math.pow(Math.sin(Math.PI * u0), 1.2);
    // Lanes fade outward into the mid disc, so the torus has no outer edge.
    const fade = 1 - 0.35 * u0;
    const g = progressiveGrid(c.ahead(m));
    const start = c.rng.unit() * TAU;
    for (let j = 0; j < m; j++) {
      const a = start + ((g[j] + 0.5) / m) * TAU;
      const r = laneRadius(u0 + c.rng.bell() * LANE_W);
      const ember = c.rng.chance(0.02);
      c.write(
        Math.cos(a) * r,
        Math.sin(a) * r,
        r * (0.01 + thick * Math.abs(c.rng.bell())),
        (ember ? c.rng.range(0.7, 0.95) : c.rng.range(0.22, 0.44)) * glow * fade,
        Math.min(1, 0.45 + (1 - u0) * 0.15),
        0.1 + u0 * 0.14,
        spin,
        1,
      );
    }
  }
}

// The mid disc: sixty faint lanes, each at its own Kepler rate and faint
// inclination, even round the lane, overlapping in radius so the sheet is
// continuous and finely grained, and never winding into a smear the way a
// differentially turning fill does within a minute.
const MID_LANES = 60;
function midDisc(c, n) {
  // Dots per lane fall as r^-1.6 (the lanes are log-spaced, so the surface
  // density falls about as r^-2.6 and the disc thins smoothly outward).
  const counts = allocate(n, Array.from({ length: MID_LANES }, (_, k) => Math.pow(MID_OUT / TORUS_OUT, (-1.6 * (k + 0.5)) / MID_LANES)));
  for (let lane = 0; lane < MID_LANES; lane++) {
    const m = counts[lane];
    const u0 = (lane + 0.5) / MID_LANES;
    const r0 = TORUS_OUT * Math.pow(MID_OUT / TORUS_OUT, u0);
    const spin = OMEGA(r0);
    const incline = r0 * (0.002 + 0.006 * hash01(lane * 17 + 4));
    const g = progressiveGrid(c.ahead(m));
    const start = c.rng.unit();
    for (let j = 0; j < m; j++) {
      const t = ((g[j] + 0.5) / m + start) % 1;
      const a = t * TAU;
      const r = r0 * (1 + c.rng.bell() * 0.018);
      c.write(
        Math.cos(a) * r,
        Math.sin(a) * r,
        incline + r * 0.015 * Math.abs(c.rng.bell()),
        c.rng.range(0.22, 0.4) * (1 - 0.3 * u0),
        Math.min(1, 0.18 + (1 - u0) * 0.24),
        0.24 + u0 * 0.3,
        spin,
        1,
      );
    }
  }
}

// The skirt: wide, thin, faint, packed toward its inner edge, lifting into the warp.
function skirt(c, n) {
  const { p } = jittered(c.ahead(n), 2, 0.7, 83);
  for (let j = 0; j < n; j++) {
    const t = Math.pow(p[j * 2], 2.2);
    const r = MID_OUT + (SKIRT_OUT - MID_OUT) * t;
    const a = p[j * 2 + 1] * TAU;
    const patch = 0.75 + 0.25 * Math.sin(2 * a - Math.log(r) * 6.0 + 0.5) * Math.sin(3 * a + r * 0.6);
    c.write(
      Math.cos(a) * r,
      Math.sin(a) * r,
      warpH(r) * (0.75 + 0.5 * hash01(j * 7 + 3)),
      c.rng.range(0.15, 0.28) * (0.55 + 0.45 * patch) * (1 - 0.6 * t),
      c.rng.range(0.1, 0.35),
      0.5 + t * 0.3,
      OMEGA(r),
      0.8,
    );
  }
}

/* The hot spots: three loose clumps of the hottest material on the innermost
   orbits, sheared along them (the orbit's own differential rotation would
   have done it), each turning rigidly at its orbit's rate so it keeps its
   shape. A spot is three times as long as it is wide and its dots thin
   toward its ends, so it reads as a knot in the rim rather than a blob. The
   lens does the rest: every lap, a spot passing behind the hole is pulled
   out of the shadow and smeared into arcs round it, one for each image
   order its dots carry. */
const SPOTS = [
  { r: R * 0.9, a: 0.5, len: 1.5, share: 1.2 },
  { r: R * 1.0, a: 2.7, len: 1.2, share: 1.0 },
  { r: R * 1.14, a: 4.6, len: 1.8, share: 0.9 },
];
function hotSpots(c, n) {
  const counts = allocate(n, SPOTS.map((s) => s.share));
  SPOTS.forEach((s, k) => {
    const m = counts[k];
    const rate = OMEGA(s.r);
    const { p } = jittered(c.ahead(m), 3, 0.7, 1501 + k * 7);
    for (let j = 0; j < m; j++) {
      const along = tri(p[j * 3]);
      const across = tri(p[j * 3 + 1]) * 0.24 * (1 - 0.5 * Math.abs(along));
      const r = s.r + across;
      const a = s.a + (along * s.len) / s.r;
      const core = 1 - Math.abs(along);
      c.write(
        Math.cos(a) * r,
        Math.sin(a) * r,
        r * 0.012 * p[j * 3 + 2],
        c.rng.range(0.3, 0.55) * (0.6 + 0.6 * core),
        0.36 + 0.1 * c.rng.unit(),
        0.1,
        rate,
        1,
      );
    }
  });
}

// The feeders: four trailing spiral streams of dust winding in from 4.4 R to
// the mid disc, at four pitches so they approach and part without crossing,
// turning as one pattern at the disc's rate near their roots (as the
// galaxy's arms do) so they never wind up, widest and faintest at their far
// ends. Tidal streams: the white hole's arms, run inward.
function feeders(c, n) {
  const ARMS = 4;
  const PITCHES = [3.0, 4.4, 3.6, 5.0];
  const spin = OMEGA(R * 2.1);
  const counts = allocate(n, [1.15, 1, 1.1, 0.95]);
  for (let k = 0; k < ARMS; k++) {
    const m = counts[k];
    const a0 = (k / ARMS) * TAU + 0.4 * hash01(k * 7 + 2);
    const rOut = FEED_IN + (FEED_OUT - FEED_IN) * (0.82 + 0.18 * hash01(k * 11 + 3));
    const { p } = jittered(c.ahead(m), 2, 0.7, 601 + k * 13);
    for (let j = 0; j < m; j++) {
      const t = Math.pow(p[j * 2], 1.15);
      const r0 = FEED_IN * Math.pow(rOut / FEED_IN, t);
      const a = a0 - PITCHES[k] * Math.log(r0 / FEED_IN);
      const width = 0.25 + 1.0 * t;
      const across = tri(p[j * 2 + 1]) * width;
      const r = r0 + across * 0.7;
      const aa = a + (across * 0.7) / r0;
      const gap = 0.75 + 0.25 * Math.pow(Math.sin(t * Math.PI * (4 + k) + k), 2);
      c.write(
        Math.cos(aa) * r,
        Math.sin(aa) * r,
        (0.05 + 0.55 * t) * (0.5 + 0.5 * hash01(j * 3 + k)),
        c.rng.range(0.16, 0.32) * (1.15 - 0.6 * t) * gap,
        c.rng.range(0.35, 0.65),
        0.4 + 0.3 * t,
        spin,
        0.85,
      );
    }
  }
}

// Five thin rings of debris on planes tilted 22 to 55 degrees to the disc,
// just outside the mid disc (radii 14.9 to 20.3) so they cross the skirt and
// the sky, not the dense disc; each turning about its own normal.
function streams(c, n) {
  const radii = [14.9, 16.0, 17.3, 18.8, 20.3];
  const widths = [0.3, 0.34, 0.38, 0.42, 0.48];
  const counts = allocate(n, [1.2, 1.1, 1, 0.95, 0.9]);
  ACCRETION_STREAMS.forEach(({ axis }, k) => {
    const ax = normalize(axis);
    const e1 = normalize(cross(ax, Math.abs(ax[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
    const e2 = cross(ax, e1);
    const rs = radii[k];
    const spin = streamSpin(k, OMEGA(rs) * (k % 2 ? -0.9 : 0.9));
    const m = counts[k];
    const g = progressiveGrid(c.ahead(m));
    for (let j = 0; j < m; j++) {
      const a = ((g[j] + 0.5) / m) * TAU;
      const r = rs + gauss(c.rng) * widths[k];
      const h = gauss(c.rng) * widths[k] * 0.5;
      const ca = Math.cos(a) * r, sa = Math.sin(a) * r;
      c.write(
        e1[0] * ca + e2[0] * sa + ax[0] * h,
        e1[1] * ca + e2[1] * sa + ax[1] * h,
        e1[2] * ca + e2[2] * sa + ax[2] * h,
        c.rng.range(0.28, 0.48),
        c.rng.range(0.45, 0.8),
        0.2 + 0.1 * k,
        spin,
        1,
      );
    }
  });
}

/* The infall cloud: material from every direction, spread evenly over the
   sphere (a uniform direction per particle), from the capture radius to
   thirty units out (t = u^1.1, so the cloud is not piled at the hole), each
   particle with its own transport id, so each falls on a gently bent path of
   its own and the shader heats it as it arrives. Placed by rank, so a ladder
   cut thins the cloud evenly. The white hole's emitter, run backwards. */
function infallCloud(c, n) {
  const { infallIn, infallSpan } = ACCRETION;
  const { p, rank } = jittered(c.ahead(n), 3, 0.7, 1201);
  for (let j = 0; j < n; j++) {
    const t = Math.pow(p[j * 3], 1.1);
    const r = infallIn + infallSpan * t;
    const az = TAU * p[j * 3 + 1];
    const polar = (2 * p[j * 3 + 2] - 1) * 0.995;
    const planar = Math.sqrt(Math.max(0, 1 - polar * polar));
    const id = 0.16 + hash01(rank[j] * 7 + 9);
    const spark = rank[j] % 17 === 0;
    c.write(
      Math.cos(az) * planar * r,
      Math.sin(az) * planar * r,
      polar * r,
      (spark ? c.rng.range(0.34, 0.5) : c.rng.range(0.16, 0.3)) * (1.0 - 0.25 * t),
      Math.min(1, 0.5 + t * 0.4),
      0.1 + t * 0.8,
      -id,
      1,
    );
  }
}

// Six lone strands, one transport id per strand:
// spin = -(0.16 + (f + 0.5) / F) for strand f.
function infallStrands(c, n) {
  const F = STREAMERS * STRANDS + LONE;
  const weights = [...new Array(STREAMERS * STRANDS).fill(1), ...new Array(LONE).fill(0.5)];
  const counts = allocate(n, weights);
  const { infallIn, infallSpan } = ACCRETION;
  let f = 0;
  const strand = (az, el, phase, size, m) => {
    const dir = [Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el)];
    const spin = -(0.16 + (f + 0.5) / F);
    // Each strand's grid is shifted by its own fraction of a step, so a
    // streamer never holds its strands' dots abreast in rows.
    const shift = ((f + 0.5) * GOLDEN) % 1 - 0.5;
    const g = progressiveGrid(c.ahead(m));
    for (let j = 0; j < m; j++) {
      const t = (g[j] + 0.5 + shift) / m;
      const r = infallIn + infallSpan * t;
      c.write(dir[0] * r, dir[1] * r, dir[2] * r, c.rng.range(size[0], size[1]), c.rng.range(0.5, 0.78), phase, spin, 0.96);
    }
    f++;
  };
  for (let s = 0; s < STREAMERS; s++) {
    const azimuth = (STREAMER_AZ[s] + c.rng.bell() * 10) * DEG;
    const elevation = (s % 2 ? -1 : 1) * (0.25 + 0.3 * hash01(s * 7 + 1));
    for (let k = 0; k < STRANDS; k++) {
      // A streamer's phases step evenly over two units, so the chapter's
      // pulse lights its strands in turn and never runs down the stream.
      const phase = (2 * (k + 0.5)) / STRANDS + ((s * GOLDEN) % 1);
      strand(azimuth + gauss(c.rng) * 0.09, elevation + gauss(c.rng) * 0.07, phase, [0.26, 0.42], counts[f]);
    }
  }
  for (let k = 0; k < LONE; k++) {
    const az = TAU * hash01(k * 41 + 3);
    const el = (hash01(k * 43 + 5) - 0.5) * 2.4;
    strand(az, el, hash01(k * 47 + 7) * 2, [0.36, 0.54], counts[f]);
  }
}

// Sparse sparks on high orbits over the disc, packed toward the hole.
function corona(c, n) {
  const { p } = jittered(c.ahead(n), 3, 0.7, 131);
  for (let j = 0; j < n; j++) {
    const r = 5.6 + 10 * Math.pow(p[j * 3], 2.0);
    const a = TAU * p[j * 3 + 1];
    c.write(
      Math.cos(a) * r,
      Math.sin(a) * r,
      1.0 + 2.6 * p[j * 3 + 2],
      c.rng.range(0.12, 0.28),
      c.rng.range(0.25, 0.55),
      0.1 + 0.2 * p[j * 3],
      OMEGA(r) * (0.9 + 0.2 * hash01(j * 5 + 1)),
      0.7,
    );
  }
}

/* ---- The whirlpool (fourth cut, 2026-09-30) -----------------------------
   The white hole's arms, run inward (lib/modes.js WHIRL, shaders/effects.js).
   Seven arms leave the rim of the skirt and wind into the torus, evenly
   phased and all wound the same way, so they never cross; the first two
   carry a quarter more. Each is a jittered band (placed by rank, even along
   its length at every rung) with the scatter across it only, beaded where the
   white hole's arms are (gap). The material streams inward along the arms,
   uniformly in log radius, so the beads are even along each spiral and crowd
   toward the hole, where the light pools; the arms turn as one pattern, rise
   out of the skirt at the rim and dissolve into the torus at the inside, so no
   ring of arm ends marks an edge. They lie on the disc's warp, and since the
   fifth cut they run from 27 units in to 5.3, where the lens lifts their far
   side's inner ends over the shadow. */
function whirlpool(c, n) {
  const budgets = allocate(n, Array.from({ length: WHIRL.arms }, (_, k) => (k < 2 ? 1.25 : 1)));
  for (let k = 0; k < WHIRL.arms; k++) {
    const m = budgets[k];
    const { p } = jittered(c.ahead(m), 2, 0.7, 1301 + k * 13);
    for (let j = 0; j < m; j++) {
      const u = p[j * 2];
      const gap = 0.6 + 0.4 * Math.pow(Math.sin(u * Math.PI * (3 + (k % 3)) + WHIRL.phase + k * 0.9), 2);
      c.write(u, tri(p[j * 2 + 1]), c.rng.bell(), c.rng.range(0.3, 0.6) * gap, 0.6, 0.09 + u * 0.5, whirlSpin(k), 0.96);
    }
  }
}

export const blackhole = {
  seed: 0xa10a,
  touch: { mode: 2, radius: 9, strength: 2.8 },
  mode: MODE.ACCRETION,
  tilt: BLACK_HOLE_TILT,
  warmRadius: 15,
  build(c) {
    const [torusShare, midShare, skirtShare, spotShare, feedShare, streamShare,
      cloudShare, strandShare, coronaShare, jetShare, whirlShare] =
      c.split([0.198, 0.135, 0.045, 0, 0.04, 0.05, 0.25, 0.01, 0.02, 0.15, 0.08, 0.022]);

    innerTorus(c, torusShare);
    midDisc(c, midShare);
    skirt(c, skirtShare);
    hotSpots(c, spotShare);
    feeders(c, feedShare);
    streams(c, streamShare);
    infallCloud(c, cloudShare);
    infallStrands(c, strandShare);
    corona(c, coronaShare);
    writeBipolarPlumes(c, jetShare, { spin: BIPOLAR_PLUME_SPIN, body: 0.4, lines: 10, start: 1.2, end: 30, fadeIn: 0.12, bright: 1.5, bow: 0, sides: [1.35, 1], widths: [0.7, 1] });
    whirlpool(c, whirlShare);

    // The sky: the rest of the budget (the split's last share, 0.022), screen
    // uniform in the Stack frame and widened to hold the Hobbies and reduced
    // frames. Written in world space with spin 0, which mode 5 passes through.
    backdrop(c, c.count - c.cursor, {
      ...cameraOf(STACK),
      aspect: 2.1,
      jitter: 0.7,
      also: [{ ...cameraOf(HOBBIES) }, { ...cameraOf(STACK_REDUCED), aspect: 1.9 }],
      depth: [80, 140],
      size: [0.2, 0.8],
      lean: 2.6,
      tint: [0, 0.14],
      mode: MODE.ACCRETION,
    });
  },
};
