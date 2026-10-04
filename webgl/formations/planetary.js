
import {
  MODE, TOUCH, GIANT, GIANT_STORMS, GIANT_FLARES, zonalRate, stormSpin, flareSpin,
} from '../lib/modes.js';
import { TAU, clamp01, bezier2 } from '../lib/random.js';
import { slotRanks, progressiveGrid, hash01, r2, backdrop } from '../lib/sampling.js';

/* ==========================================================================
   THE GAS GIANT

   One body, drawn as a stipple engraving: an opaque, self-luminous gas giant
   whose belts and zones are carried by how densely the dots are laid, not by
   how big or soft they are. Every dot is the same crisp point (the point model
   in shaders/particles.js); tone is the number of dots per area.

   Only the near hemisphere shows. While the giant is bound the vertex shader
   hides everything behind a sphere of 0.94 R (behindSphere), and gives every
   surface dot the light of its limb angle, mu * mix(0.6, 1, sqrt(mu)), none on
   the far side. A uniformly dotted shell projects with a density of 1 / mu, so
   the disc runs from full brightness at the centre to 0.6 at the edge and then
   stops: a crisp limb with gentle limb darkening, the way a self-luminous
   atmosphere looks. The same factor carries the body's own light (GIANT_GLOW):
   the surface is brighter per dot than an ordinary particle, so the chapter's
   exposure, which also grades the formations the giant morphs with, stays
   put. Before, both hemispheres showed, the far side's bands laid over the
   near side's (halving their contrast), and the shell piled up into a hoop
   where it turned edge-on (2.75 times the centre's brightness at 0.95 R).

   The populations (shares of the budget):

     deck x4     0.81  four cloud strata, turning at slightly different rates.
                       Each is laid by density: candidates are a jittered
                       Roberts (R2) sequence on the cylindrical equal-area map,
                       kept where a fixed coin falls under the local density,
                       until exactly the stratum's budget is kept; write j
                       takes the kept candidate of its slot rank, so a ladder
                       cut keeps the dots a smaller bake would lay and the 37k
                       frame keeps the tone of the 100k one
     storms      0.03  six vortices from lib/modes.js, each drawn in the deck's
                       own dot size as a soft swell of density: a Gaussian
                       body, a soft eye wall and two wide logarithmic spiral
                       arms, all falling to nothing at the storm's edge, turning
                       rigidly about their own centre while the zonal wind
                       carries them round
     corona      0.05  a static halo just outside the limb
     flares      0.075 twenty-one eruption sites the shader grows out of the surface
                       and retracts on their own cycle, seen as prominences
                       against the sky
     field       0.03  a faint star field behind the body

   --- Which populations rotate ---

   `spin` decides. Deck, storm and flare particles carry a real rate (or a body
   tag) and the shader spins them and applies the axial tilt. The corona and
   the field carry spin 0, which mode 8 passes through untouched, so both are
   authored in final world coordinates and stay put while the body turns.

   --- Differential rotation ---

   Every deck dot's rate comes from zonalRate() at its own latitude, so the
   shear is free. Bands are rotationally symmetric, so shearing them changes
   nothing about how they look; what shears visibly is everything that is not
   symmetric, the filaments along the band edges. That is the correct behaviour
   and it is why the surface keeps evolving instead of looping. It also sets the
   fine texture: at the steep jets neighbouring latitudes slip a dot spacing
   past each other within a few seconds, so no arrangement finer than the bands
   survives. The candidates are jittered off the R2 lattice from the start, so
   the stipple does not show a lattice for the first seconds of a read and turn
   random afterwards.
   ========================================================================== */

const R = GIANT.radius;

/* The chapter camera, mirrored from chapters.js ('education'). Only the corona
   and the star field need it, and only because those two are composed against
   the frame rather than against the body. If the chapter camera moves, move
   these with it. */
const CAM = [3, 4.5, 72];
const TGT = [0, 0, 0];
const FOV = 41;
// The reduced-motion score's education camera (chapters.js REDUCED_CHAPTERS),
// which the star field widens to hold.
const CAM_REDUCED = [3, 4.5, 74];

const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

const VIEW = norm([TGT[0] - CAM[0], TGT[1] - CAM[1], TGT[2] - CAM[2]]);
// Screen right and screen up, so a population can be composed in frame space.
const SX = norm(cross(VIEW, [0, 1, 0]));
const SY = norm(cross(SX, VIEW));

// Whether the line from the chapter camera through a world point passes the
// body's centre at more than `clear`: a point off the disc in the camera's
// perspective, whether in front of the limb or behind it.
function missesBody(x, y, z, clear) {
  const vx = x - CAM[0], vy = y - CAM[1], vz = z - CAM[2];
  const cx = vy * -CAM[2] - vz * -CAM[1];
  const cy = vz * -CAM[0] - vx * -CAM[2];
  const cz = vx * -CAM[1] - vy * -CAM[0];
  return Math.hypot(cx, cy, cz) >= clear * Math.hypot(vx, vy, vz);
}

// A tangent frame at a point on the unit sphere. `east` follows the rotation,
// `north` climbs toward the pole, and (east, north, dir) is right-handed, so an
// angle measured from east toward north turns the way the shader turns a storm
// with a positive rate.
function frameAt(dir) {
  const up = Math.abs(dir[1]) > 0.92 ? [1, 0, 0] : [0, 1, 0];
  const east = norm(cross(up, dir));
  return { east, north: norm(cross(dir, east)) };
}

function dirAt(lat, lon) {
  const cl = Math.cos(lat);
  return [cl * Math.cos(lon), Math.sin(lat), cl * Math.sin(lon)];
}

/* A cheap band-limited fbm. Not gradient noise: each octave is a product of a
   sine and a cosine whose arguments are themselves modulated, which is a domain
   warp in disguise and gives the curdled, filamentary look a real cloud deck
   has. Gradient noise at this octave count reads too regular. `n` takes fewer
   octaves for the slow fields. */
function makeFbm(rng, octaves) {
  const K = [];
  for (let o = 0; o < octaves; o++) {
    K.push({
      a: rng.range(0.82, 1.24), b: rng.range(0.82, 1.24),
      c: rng.range(0.82, 1.24), d: rng.range(0.82, 1.24),
      p: rng.range(0, TAU), q: rng.range(0, TAU), s: rng.range(0, TAU),
    });
  }
  return (x, y, z, n = octaves) => {
    let sum = 0;
    let amp = 1;
    let norms = 0;
    let f = 1;
    for (let o = 0; o < n; o++) {
      const k = K[o];
      sum += amp
        * Math.sin(x * f * k.a + Math.cos(y * f * k.b + k.p) * 1.6 + k.q)
        * Math.cos(z * f * k.c + Math.sin(x * f * k.d + k.s) * 1.2);
      norms += amp;
      amp *= 0.53;
      f *= 2.11;
    }
    return sum / norms;
  };
}

/* Belts and zones, laid out the way a real gas giant's are: a bright
   equatorial zone split by a faint equatorial band, two strong equatorial belts
   either side of it, narrower and fainter temperate belts poleward, and past
   about 45 degrees no bands at all (the polar hood, below). Each belt is
   [south edge, north edge, depth] in degrees of latitude, depth 1 the full belt
   floor. The irregular spacing is what reads as an atmosphere; evenly spaced
   stripes read as corduroy. The largest storm in lib/modes.js sits at 17
   degrees south, on the southern edge of the south equatorial belt, where a
   real giant keeps its great spot. */
const BELTS = [
  [-1.6, 1.4, 0.3],
  [7, 17.5, 1.0],
  [-19.5, -6.5, 1.0],
  [23.5, 30.5, 0.72],
  [-33.5, -25.5, 0.78],
  [35.5, 41.5, 0.5],
  [-44, -37.5, 0.55],
];
const BELT_EDGE = 1.6;
const DEG = 180 / Math.PI;
// The zone value of a latitude (radians): 1 on a zone's crown, 1 - depth inside
// a belt, soft over BELT_EDGE degrees at each edge.
function bandZone(lat) {
  const x = lat * DEG;
  let z = 1;
  for (const [lo, hi, depth] of BELTS) {
    if (x < lo - BELT_EDGE || x > hi + BELT_EDGE) continue;
    z -= depth * smooth(lo - BELT_EDGE, lo + BELT_EDGE, x) * (1 - smooth(hi - BELT_EDGE, hi + BELT_EDGE, x));
  }
  return z;
}

/* Sample the cloud field along a direction.

   The noise is evaluated on the direction vector itself, not on longitude, so
   there is no seam at the date line. Two things make it read as weather rather
   than as static: the sampling frame is pre-wound by the zonal wind at that
   latitude, so features lean into their jet; and the y frequency is many times
   the x/z frequency, which stretches every feature east-west into a filament.

   `zone` is the band read crisply: the belt-to-zone value, perturbed by the
   filaments, goes through a smoothstep over its middle half, so a band is flat
   inside and turns over within a few dots at its edge, and the filaments
   decide where along its length an edge wanders, festoons and breaks. */
function sampleDeck(layer, d, fbm, out) {
  const s = d[1];
  const phi = (zonalRate(s) - 0.19) * 27.0;
  const cs = Math.cos(phi);
  const sn = Math.sin(phi);
  const wx = d[0] * cs + d[2] * sn;
  const wz = -d[0] * sn + d[2] * cs;
  const kx = layer.kLon;
  const ky = layer.kLat;
  // The warp and the meander are slow fields; two octaves are enough for them.
  const warp = fbm(wx * 0.9, s * 2.4, wz * 0.9, 2) * 0.6;
  const fil = fbm(wx * kx + warp, s * ky, wz * kx - warp);
  // Meander the band boundaries. Reading the profile at the true latitude gives
  // perfectly straight stripes, which is the tell that this is a function and
  // not an atmosphere; a low-frequency offset in latitude makes each boundary
  // wander a couple of degrees as it goes round. The wind rate still comes off
  // the true latitude, so the physics does not wander with the paint.
  const meander = fbm(wx * 1.25, s * 3.1, wz * 1.25, 2) * 0.035;
  const band = bandZone(Math.asin(Math.max(-1, Math.min(1, s + meander))));
  /* Polar hoods. The tilt throws one pole onto the limb, and a hood drawn as
     the deepest belt value would bite a notch out of the silhouette. So the
     band structure fades out poleward of about 46 degrees into a flat mid
     tone: cooler, mottled texture, never an absence. */
  const polar = clamp01((Math.abs(s) - 0.72) / 0.28);
  const zone = smooth(0.25, 0.75, clamp01(band + fil * 0.13));
  out.fil = fil;
  out.polar = polar;
  out.zone = zone + (0.5 - zone) * polar * 0.85;
  return out;
}

/* Density: the stratum's floor in the deepest belt, 1 on a zone's crown. The
   filaments add bright rifts inside the belts and dark wisps inside the zones,
   about a quarter of the range either way, so a band has inner structure
   without its edges going soft. */
const deckDensity = (layer, f) =>
  layer.floor + (1 - layer.floor) * clamp01(f.zone + 0.26 * f.fil);

/* Belt-to-zone colour, on the palette's escape ramp (tint above 1.5 in the
   fragment shader: accent to mint to gold to rust). Zones are gold with about a
   sixth of their dots dropped onto near-white, the ammonia crowns catching the
   light; belts are rust with about a quarter dropped onto the accent, which
   cools them without reading as a blue stripe. The tone of a band is its
   density; the colour only says which kind of band it is. `h` and `h2` are
   fixed hashes in [0, 1), so a ladder cut keeps each dot's colour. */
function deckTint(zone, h, h2) {
  if (zone > 0.72) return h < 0.17 ? 0.04 + 0.16 * h2 : 2.56 + 0.08 * h2;
  if (zone > 0.42) return 2.68 + (0.72 - zone) * 0.75 + 0.04 * h2;
  return h < 0.24 ? 0.7 + 0.25 * h2 : 2.92 + 0.08 * h2;
}

/* The four strata. They sit within half a percent of the radius of each other
   (plus the zones' lift), so the limb is one crisp edge: spread over 0.95-1.06
   R, as they were, they ended one after another and blurred it into a 60 px
   staircase at 4K. What separates them is how they turn and what they carry.
   `floor` is the density of the deepest belt relative to a zone's crown, so a
   belt is drawn at about a quarter to a half of a zone's density; `lum` weights
   the strata against each other; `role` is the rigidity, 0.86 and up, so the
   chapter's noise field (0.9 here) cannot carry a dot more than about 0.05
   units and soften a band edge. */
const LAYERS = [
  // Deep: the substrate, the most even of the four, low-frequency structure
  // only, so that something under the weather is continuous.
  { r: 0.990, lift: 0.006, rate: 0.93, role: 0.9, kLon: 1.6, kLat: 8.5, lum: 0.7, floor: 0.45, salt: 1 << 24 },
  // Mid: the cloud deck proper. The largest share, the sharpest structure.
  { r: 0.994, lift: 0.006, rate: 1.0, role: 0.92, kLon: 2.7, kLat: 13.5, lum: 1.0, floor: 0.24, salt: 2 << 24 },
  // High: thin, wispy, fastest. Sparse on purpose, so it reads as haze
  // drifting over the deck rather than as a fourth band system.
  { r: 0.996, lift: 0.006, rate: 1.075, role: 0.86, kLon: 4.2, kLat: 20.5, lum: 0.88, floor: 0.22, salt: 3 << 24 },
  // Fill: whatever the populations above left of the budget, at frequencies
  // between mid and high. Its budget is decided last, from the cursor.
  { r: 0.992, lift: 0.006, rate: 0.97, role: 0.9, kLon: 3.4, kLat: 16.5, lum: 0.85, floor: 0.34, salt: 4 << 24 },
];
// One narrow size range for every stratum: size is light, not blur, and tone
// belongs to density. Zones are a little brighter per dot than belts (the
// shade factor, 0.85 to 1.1).
const DECK_SIZE = [0.4, 0.5];
// Jitter of each candidate, as a share of the spacing of the R2 prefix that
// first holds it (lib/sampling.js backdrop and jittered use the same rule).
const DECK_JITTER = 0.7;
// The storms' dot size: the deck's own (2026-09-29). A storm is the same
// cloud, denser, not a finer ink drawn over it. Drawn in half-size dots packed
// four times as close it was a hard-edged patch of a different texture.
const STORM_INK = 0.44;

/* Lay one stratum by density, exactly `budget` dots, cut-true.

   Candidate k is the k-th Roberts point, offset per stratum (so the four strata
   never share a dot) and jittered, mapped onto the sphere by the cylindrical
   equal-area projection (z = 2v - 1, longitude 2 pi u), which keeps every
   prefix of the sequence even over the whole sphere: the old Fibonacci sweep
   ran from pole to pole and could not stop early without deleting the southern
   cap. A fixed hash of k is the acceptance coin, so the walk and everything it
   keeps are the same at every bake size, and it stops at exactly `budget` kept
   candidates. Write j takes the kept candidate of its slot rank: a ladder cut
   keeps the first kept candidates, which is the stratum a smaller bake lays. */
function bakeDeck(c, layer, budget, fbm) {
  if (budget <= 0) return;
  const slots = c.ahead(budget);
  const n = slots.length;
  const rank = slotRanks(slots);
  const salt = layer.salt;
  const ou = hash01(salt), ov = hash01(salt + 1);
  const px = new Float32Array(n * 3);
  const fz = new Float32Array(n);
  const ff = new Float32Array(n);
  const fp = new Float32Array(n);
  const fk = new Int32Array(n);
  const f = { fil: 0, polar: 0, zone: 0 };
  const uv = new Float64Array(2);
  const d = [0, 0, 0];
  const limit = 64 * n + 4096;
  let m = 0;
  for (let k = 0; m < n; k++) {
    if (k > limit) throw new Error('[universe] planetary: a deck stratum ran out of candidates');
    r2(k, uv);
    const js = DECK_JITTER / Math.sqrt(k + 1);
    let u = uv[0] + ou + (hash01(salt + 3 * k + 2) - 0.5) * js;
    let v = uv[1] + ov + (hash01(salt + 3 * k + 3) - 0.5) * js;
    u -= Math.floor(u);
    v -= Math.floor(v);
    const z = 2 * v - 1;
    const cl = Math.sqrt(Math.max(0, 1 - z * z));
    const lon = TAU * u;
    d[0] = cl * Math.cos(lon);
    d[1] = z;
    d[2] = cl * Math.sin(lon);
    sampleDeck(layer, d, fbm, f);
    if (hash01(salt + 3 * k + 4) >= deckDensity(layer, f)) continue;
    px[m * 3] = d[0];
    px[m * 3 + 1] = d[1];
    px[m * 3 + 2] = d[2];
    fz[m] = f.zone;
    ff[m] = f.fil;
    fp[m] = f.polar;
    fk[m] = k;
    m++;
  }

  for (let j = 0; j < n; j++) {
    const a = rank[j];
    const x = px[a * 3], y = px[a * 3 + 1], zz = px[a * 3 + 2];
    const zone = fz[a], fil = ff[a], polar = fp[a];
    const h = hash01(salt + 7 * fk[a] + 11);
    const h2 = hash01(salt + 7 * fk[a] + 12);
    const h3 = hash01(salt + 7 * fk[a] + 13);
    // Zones sit a little higher than belts, the way upwelling cloud does.
    const rr = R * (layer.r + layer.lift * (0.3 + 0.7 * zone) + (h3 - 0.5) * 0.003);
    const shade = 0.85 + 0.25 * zone;
    const size = (DECK_SIZE[0] + (DECK_SIZE[1] - DECK_SIZE[0]) * h2) * layer.lum * shade;
    // The polar hoods drop about a third of their dots onto a pale accent.
    const tint = h3 < polar * 0.32 ? 0.26 + 0.29 * h2 : deckTint(zone, h, h2);
    c.write(
      x * rr, y * rr, zz * rr,
      size,
      tint,
      (0.5 + y * 0.9 + fil * 0.07 + 2) % 1,
      zonalRate(y) * layer.rate,
      layer.role,
    );
  }
}

/* One storm: a soft swell of the deck's density in the shape of a vortex.

   Three parts, all in the deck's own dot size, all falling smoothly to
   nothing at the storm's radius so the storm has no edge against the deck:
   the body (30% of its dots) is a Gaussian cloud over the storm's disc,
   sigma 0.5 of the radius; the eye wall (10%) a soft ring at 0.3 of the
   radius, sigma 0.1; each arm (the rest, half each) winds out from the wall
   to the full radius at a pitch of 25 degrees, a = a0 - sense * 2.14
   ln(rho / rho_eye) (1 / tan 25 degrees = 2.14), so it trails the storm's
   own rotation the way a vortex's bands do. The second arm is a little
   tighter and shorter and sits a quarter radian off the opposite side, so the
   pair is not a stamp. Along an arm the dots thin toward the tip (t = u^1.15)
   and scatter across it ever wider (sigma 0.06 of the radius at the wall,
   0.13 at the tip), and the dots shrink toward the tip, so an arm is a band
   of cloud that dissolves into the deck rather than a stroke drawn on it.
   Every part is written in one run on the progressive grid, so a ladder cut
   thins it evenly. Three dots in ten take a deck-like tint, so the storm's
   colour also fades into the deck's.

   The whole storm turns rigidly at its table rate (w constant across it), the
   way the galaxy's arms are a density wave: the earlier profile let the rim lag
   the core by a fifth, which wound a 2.6 rad arm by about a radian a minute at
   the chapter's clock. */
function bakeStorm(c, st, k, n, ink) {
  if (n <= 0) return;
  const C = dirAt(st.lat, st.lon);
  const { east, north } = frameAt(C);
  const rng = c.rng;
  const eyeR = st.r * 0.3;
  const spin = stormSpin(k, st.w * st.sense);
  const a0 = rng.range(0, TAU);
  const gauss = () => {
    const u = Math.max(1e-6, rng.unit());
    return Math.max(-2.5, Math.min(2.5, Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * rng.unit())));
  };
  const put = (rho, a, size) => {
    const ang = rho / R;
    const sa = Math.sin(ang);
    const ca = Math.cos(ang);
    const ex = east[0] * Math.cos(a) + north[0] * Math.sin(a);
    const ey = east[1] * Math.cos(a) + north[1] * Math.sin(a);
    const ez = east[2] * Math.cos(a) + north[2] * Math.sin(a);
    const d = norm([C[0] * ca + ex * sa, C[1] * ca + ey * sa, C[2] * ca + ez * sa]);
    // A storm domes a little above the deck toward its eye, never past the
    // limb: a storm that pokes outside the silhouette stops being a feature on
    // the body and becomes an arc beside it.
    const q = Math.min(1, rho / st.r);
    const rad = R * (0.998 + 0.008 * Math.pow(1 - q, 1.3) + rng.bell() * 0.001);
    const deckLike = rng.unit() < 0.3;
    const tint = deckLike ? rng.range(0.0, 0.25) : st.tint + (st.tint > 1.5 ? rng.range(-0.06, 0.05) : rng.range(0, 0.12));
    c.write(d[0] * rad, d[1] * rad, d[2] * rad, size * (0.9 + 0.2 * rng.unit()), tint, (0.5 + d[1] * 0.9 + 2) % 1, spin, 0.95);
  };

  const bodyN = Math.floor(n * 0.3);
  const gb = progressiveGrid(c.ahead(bodyN));
  // Redrawn rather than clamped when the Gaussian lands past the radius:
  // clamping piled those dots onto the rim as a ring.
  const within = (sigma) => { for (let tries = 0; tries < 8; tries++) { const rho = Math.abs(gauss()) * sigma; if (rho <= st.r) return rho; } return st.r * rng.unit(); };
  for (let j = 0; j < bodyN; j++) {
    const rho = within(st.r * 0.5);
    put(rho, a0 + (TAU * (gb[j] + 0.5)) / bodyN + gauss() * 0.4, ink * (1 - 0.25 * rho / st.r));
  }
  const eyeN = Math.floor(n * 0.1);
  const ge = progressiveGrid(c.ahead(eyeN));
  for (let j = 0; j < eyeN; j++) {
    put(eyeR + gauss() * st.r * 0.1, a0 + (TAU * (ge[j] + 0.5)) / eyeN, ink);
  }
  const armN = n - eyeN - bodyN;
  for (let arm = 0; arm < 2; arm++) {
    const m = arm ? armN - (armN >> 1) : armN >> 1;
    const g = progressiveGrid(c.ahead(m));
    const base = a0 + arm * (Math.PI + 0.25);
    const wind = st.sense * 2.14 * (arm ? 1.08 : 1);
    const reach = arm ? 0.86 : 1;
    for (let j = 0; j < m; j++) {
      // Thinning toward the tip (u^1.3 along the length), never packed at the
      // root: spaced evenly in angle, the root by the eye wall took six times
      // the dots per unit length of the wall itself and read as a bright hook.
      const t = Math.pow((g[j] + 0.5) / m, 1.15) * reach;
      const rho = eyeR + (st.r - eyeR) * t;
      const a = base - wind * Math.log(rho / eyeR);
      // The arm's own direction in the storm's tangent plane, so each dot is
      // scattered across the stroke and never along it.
      const x = rho * Math.cos(a), y = rho * Math.sin(a);
      const tx = Math.cos(a) + wind * Math.sin(a);
      const ty = Math.sin(a) - wind * Math.cos(a);
      const tl = Math.hypot(tx, ty);
      const off = gauss() * st.r * (0.06 + 0.07 * t);
      const X = x - (ty / tl) * off, Y = y + (tx / tl) * off;
      put(Math.hypot(X, Y), Math.atan2(Y, X), (1 - 0.45 * t) * ink);
    }
  }
}

export const planetary = {
  seed: 0x5505,
  touch: { mode: TOUCH.SWIRL, radius: 7.5, strength: 1.7 },
  mode: MODE.ORBIT,
  pivot: [0, 0, 0],
  tilt: GIANT.tilt,
  // Wide, and deliberately much wider than the body. vWarm falls off as
  // 1 - r/warmRadius, so a radius close to the body's own would leave the
  // surface barely warmed at all; at 62 the cloud deck sits around 0.75 of the
  // warm mix, the corona around a third of it, and the star field outside it
  // entirely. That gradient is what makes the giant read hot against a cool sky.
  warmRadius: 62,
  build(c) {
    const rng = c.rng;
    const fbm = makeFbm(rng, 3);
    /* The particle budget. The last share is the fill stratum, which is sized
       from the cursor at the end, so it takes exactly what the populations
       before it left (a few storm and flare dots of rounding). The old core
       volume (16%) and the near-camera embers are gone: the opaque body would
       hide the one, and the other was bokeh for a depth of field no chapter
       uses. */
    const [deepShare, midShare, highShare, stormShare, coronaShare, flareShare, fieldShare] =
      c.split([0.20, 0.355, 0.09, 0.03, 0.05, 0.075, 0.03, 0.17]);
    const out = [0, 0, 0];

    /* ---- The cloud deck ------------------------------------------------- */
    bakeDeck(c, LAYERS[0], deepShare, fbm);
    bakeDeck(c, LAYERS[1], midShare, fbm);
    bakeDeck(c, LAYERS[2], highShare, fbm);

    /* ---- Storms ---------------------------------------------------------
       Every storm is drawn in the deck's own dot size and at the same dots
       per area (its budget goes as its area, whatever the table's `share`
       says: 2026-09-29): a storm is the cloud deck gathered denser, not a
       finer ink drawn over it, and its density falls to the deck's at its
       edge. Given the table's shares instead, the small storms packed four
       times the dots per area of the large one and read as solid blobs. */
    const stormWeight = GIANT_STORMS.reduce((a, s) => a + s.r * s.r, 0);
    GIANT_STORMS.forEach((st, k) => {
      bakeStorm(c, st, k, Math.floor((stormShare * st.r * st.r) / stormWeight), STORM_INK * st.lum);
    });

    /* ---- Corona ---------------------------------------------------------
       A halo just outside the atmosphere, falling off as roughly 1/r-squared,
       static, and confined to a band around the LIMB PLANE rather than spread
       over a full sphere: a full spherical halo projects its near cap straight
       onto the disc as a veil. As baked, nothing of it falls on the disc: the
       line from the chapter camera through a halo particle misses the body by
       at least 1% of its radius (a margin that also holds for the reduced and
       the narrow cameras). The halo's near half used to lie over the disc, in
       front of the body, and lifted its outer tenth above its centre.

       Low rigidity, so the frame's noise field is what animates it: the corona
       is the one part of the body that drifts instead of turning. The drift
       (about 0.5-2 units at education's noise, far past the 0.15-unit margin)
       carries some halo dots across the limb in front of the body at run
       time, so the off-disc rule is a bake-time guarantee, not a runtime one.
       What crosses is faint: with the corona removed, the displayed limb
       loses at most 0.07 of its face-on light, and only at mu under 0.15. */
    for (let i = 0; i < coronaShare; i++) {
      let rr = R;
      let d = VIEW;
      for (let tries = 0; tries < 24; tries++) {
        const along = rng.bell() * 0.44;
        const ring = Math.sqrt(Math.max(0, 1 - along * along));
        rr = R * (1.0 + 1.55 * Math.pow(rng.unit(), 1.85));
        const a = rng.unit() * TAU;
        const ca = Math.cos(a) * ring;
        const sa = Math.sin(a) * ring;
        d = norm([
          SX[0] * ca + SY[0] * sa + VIEW[0] * along,
          SX[1] * ca + SY[1] * sa + VIEW[1] * along,
          SX[2] * ca + SY[2] * sa + VIEW[2] * along,
        ]);
        if (missesBody(d[0] * rr, d[1] * rr, d[2] * rr, 1.01 * R)) break;
      }
      const fall = Math.pow(R / rr, 2.1);
      c.write(
        d[0] * rr, d[1] * rr, d[2] * rr,
        rng.range(0.21, 0.5) * fall,
        rng.unit() < 0.3 ? rng.range(0.3, 0.8) : 2.72 + rng.range(0, 0.2),
        rng.unit(),
        0,
        0.1,
      );
    }

    /* ---- Flares ---------------------------------------------------------
       Twenty-one eruption sites (lib/modes.js GIANT_FLARES), phased so five
       or six are erupting at any moment, and every limb has one rising or
       falling. At rest the shader collapses each plume onto the
       surface and hides it; on that site's turn in the flare cycle it grows
       the arc back out and lets the tail escape. Because the shape is baked
       and only its extension is animated, an eruption costs the same as a
       stationary particle. The shader shows a flare only against the sky:
       cooler plasma cannot darken a self-luminous disc in an additive render,
       and drawn over it a plume read as a scratch across the bands. So an
       eruption reads as a prominence at the limb.

       Every particle gets its OWN arc rather than sharing one: the apex is
       jittered in height and in both tangent directions per particle, so the
       site erupts as a fan of a few hundred slightly different trajectories.
       One shared arc with the particles scattered around it reads as a whisker
       stuck to the limb; a fan of arcs reads as a plume. */
    const perFlare = Math.floor(flareShare / GIANT_FLARES.length);
    const ctrl = [0, 0, 0];
    const apex = [0, 0, 0];
    const foot = [0, 0, 0];
    GIANT_FLARES.forEach((fl, k) => {
      const C = dirAt(fl.lat, fl.lon);
      const { east, north } = frameAt(C);
      for (let i = 0; i < 3; i++) foot[i] = C[i] * R;
      for (let i = 0; i < perFlare; i++) {
        const height = fl.reach * rng.range(0.5, 1.3);
        const swing = fl.curl + rng.bell() * 0.55;
        const lean = rng.bell() * 0.5;
        for (let j = 0; j < 3; j++) {
          apex[j] = C[j] * (R + height) + east[j] * height * swing + north[j] * height * lean;
          ctrl[j] = C[j] * (R + height * 1.45) + east[j] * height * swing * 0.3;
        }
        // Past 1 the particle overshoots the arc: the ejecta that does not
        // fall back.
        const t = Math.pow(rng.unit(), 1.25) * (rng.unit() < 0.24 ? rng.range(1.12, 1.45) : 1.0);
        bezier2(foot, ctrl, apex, t, out);
        const spread = fl.reach * (0.05 + 0.16 * t);
        const j1 = rng.bell();
        const j2 = rng.bell();
        c.write(
          out[0] + (east[0] * j1 + north[0] * j2) * spread,
          out[1] + (east[1] * j1 + north[1] * j2) * spread,
          out[2] + (east[2] * j1 + north[2] * j2) * spread,
          rng.range(0.42, 0.9) * (1 - t * 0.4),
          2.62 + t * 0.34 + rng.range(-0.04, 0.04),
          rng.unit(),
          flareSpin(k),
          0.24,
        );
      }
    });

    /* ---- Star field -----------------------------------------------------
       Screen-uniform stars across the chapter camera's frame (and the reduced
       one's), at view depth 95-150, behind the body's far side (lib/sampling.js
       backdrop). Spin 0, so mode 8 leaves them where they are placed, and
       rigid, so the chapter's noise field does not wobble a star. Faint and
       sparse on purpose: a sky that competes with the body for brightness
       turns the frame into confetti. The slab this replaces sat mostly behind
       the disc, where the opaque body now hides it. */
    backdrop(c, fieldShare, {
      cam: CAM, tgt: TGT, fov: FOV, also: [{ cam: CAM_REDUCED, tgt: TGT, fov: FOV }],
      depth: [95, 150], size: [0.03, 0.11], lean: 2.4, tint: [0, 0.36], pulse: [0, 1],
      rigidity: 1, mode: MODE.ORBIT, jitter: 0.7,
    });

    /* ---- Fill -----------------------------------------------------------
       The fourth stratum takes exactly what is left of the budget. */
    bakeDeck(c, LAYERS[3], Math.max(0, c.count - c.cursor), fbm);
  },
};
