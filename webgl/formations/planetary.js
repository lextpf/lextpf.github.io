
import {
  MODE, TOUCH, GIANT, GIANT_STORMS, GIANT_FLARES, zonalRate, stormSpin, flareSpin,
} from '../lib/modes.js';
import { TAU, clamp01, fibonacciDirection, bezier2 } from '../lib/random.js';

/* ==========================================================================
   THE GAS GIANT

   One body, nothing else: a proto-star the size of the frame, built out of
   points and nothing but points. There is no lighting pass anywhere in this
   project, so everything that reads as depth here is either baked into a
   particle's size and tint, or falls out of additive blending: a shell of
   points is denser along a line of sight that grazes it, which is why the limb
   glows without anyone lighting it.

   The body is assembled from eight populations, and the split between them is
   the whole design:

     core        a filled volume whose density falls as 1/r-squared, so the
                 disc reads solid and lit from within rather than hollow.
                 Additive blending turns an empty shell into a ring
     deck x3     three cloud layers at slightly different radii, sampled from
                 the same turbulence field at different frequencies and turning
                 at slightly different rates. The layers sliding over each other
                 is what makes the surface look volumetric rather than painted.
     storms      long-lived vortices from lib/modes.js, each one swirling about
                 its own radius while the zonal wind carries it around the body
     corona      a static 1/r-squared halo just outside the atmosphere,
                 confined to a band around the limb plane so it glows at the
                 edge of the disc instead of veiling it. This is the whole of
                 the rim: an earlier pass added a discrete bright ring on the
                 limb circle and it read as a hoop laid over the picture,
                 separated from the body by a visible gap
     flares      nine eruption sites, each a lofted arc that the shader grows
                 out of the surface and retracts on its own cycle
     embers      a handful of near-camera motes, deliberately far outside focus
     field       distant stars behind the body

   --- Which populations rotate ---

   `spin` decides. Cloud, core, storm and flare particles carry a real rate (or
   a body tag) and the shader spins them and applies the axial tilt. The
   corona, embers and field carry spin 0, which mode 8 passes through
   untouched, so those three are authored in final world coordinates and stay
   put while the body turns underneath them.

   --- Differential rotation ---

   Every cloud particle's rate comes from zonalRate() at its own latitude, so
   the shear is free: no per-frame work, no extra attribute. Bands are
   rotationally symmetric, so shearing them changes nothing about how they
   look; what shears visibly is everything that is NOT symmetric, which is
   exactly the storms and the filaments. That is the correct behaviour and it
   is why the surface keeps evolving instead of looping.
   ========================================================================== */

const R = GIANT.radius;

/* The chapter camera, mirrored from chapters.js ('education'). Only the
   corona, the embers and the star field need it, and only because those three
   are composed against the frame rather than against the body. If the chapter
   camera moves, move these with it. */
const CAM = [3, 4.5, 72];
const TGT = [0, 0, 0];

const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const VIEW = norm([TGT[0] - CAM[0], TGT[1] - CAM[1], TGT[2] - CAM[2]]);
// Screen right and screen up, so a population can be composed in frame space.
const SX = norm(cross(VIEW, [0, 1, 0]));
const SY = norm(cross(SX, VIEW));

// A tangent frame at a point on the unit sphere. `east` follows the rotation,
// `north` climbs toward the pole; both are used to grow storms and flares out
// of the surface without them shearing at the poles.
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
   sine and a cosine whose arguments are themselves modulated, which is a
   domain warp in disguise and gives the curdled, filamentary look a real cloud
   deck has. Gradient noise at this octave count reads too regular. */
function makeFbm(rng, octaves) {
  const K = [];
  for (let o = 0; o < octaves; o++) {
    K.push({
      a: rng.range(0.82, 1.24), b: rng.range(0.82, 1.24),
      c: rng.range(0.82, 1.24), d: rng.range(0.82, 1.24),
      p: rng.range(0, TAU), q: rng.range(0, TAU), s: rng.range(0, TAU),
    });
  }
  return (x, y, z) => {
    let sum = 0;
    let amp = 1;
    let norms = 0;
    let f = 1;
    for (let o = 0; o < octaves; o++) {
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

/* Belts and zones as a function of sin(latitude). Four harmonics rather than
   one, so the spacing is irregular the way a real atmosphere's is; a single
   sine reads as corduroy. */
const bandProfile = (s) =>
  0.52 * Math.sin(s * 12.4 + 0.35)
  + 0.27 * Math.sin(s * 24.6 - 1.15)
  + 0.16 * Math.sin(s * 6.1 + 2.35)
  + 0.09 * Math.sin(s * 37.0 + 0.8);

/* Sample the cloud field along a direction.

   The noise is evaluated on the direction vector itself, not on longitude, so
   there is no seam at the date line. Two things make it read as weather rather
   than as static: the sampling frame is pre-wound by the zonal wind at that
   latitude, so features lean into their jet; and the y frequency is many times
   the x/z frequency, which stretches every feature east-west into a filament. */
function sampleDeck(layer, d, fbm) {
  const s = d[1];
  const phi = (zonalRate(s) - 0.19) * 27.0;
  const cs = Math.cos(phi);
  const sn = Math.sin(phi);
  const wx = d[0] * cs + d[2] * sn;
  const wz = -d[0] * sn + d[2] * cs;
  const kx = layer.kLon;
  const ky = layer.kLat;
  const warp = fbm(wx * 0.9, s * 2.4, wz * 0.9) * 0.6;
  const fil = fbm(wx * kx + warp, s * ky, wz * kx - warp);
  const fine = fbm(wx * kx * 2.4 + warp * 1.7, s * ky * 2.15, wz * kx * 2.4);
  // Meander the band boundaries. Reading the profile at the true latitude gives
  // perfectly straight stripes, which is the tell that this is a function and
  // not an atmosphere; a low-frequency offset in latitude makes each boundary
  // wander a couple of degrees as it goes round. The wind rate still comes off
  // the true latitude, so the physics does not wander with the paint.
  const band = bandProfile(s + fbm(wx * 1.25, s * 3.1, wz * 1.25) * 0.06);
  return {
    band,
    fil,
    fine,
    // 0 is the floor of a belt, 1 the crown of a zone.
    zone: clamp01(band * 0.58 + 0.5 + fil * 0.13),
    // Bands lead the density, but only just. Let them lead too hard and the
    // belts read as holes cut out of the body instead of as darker cloud.
    turb: band * 0.52 + fil * 0.5 + fine * 0.11,
  };
}

const deckDensity = (layer, f) =>
  layer.floor + (1 - layer.floor) * clamp01(0.44 + 0.78 * f.turb);

/* Belt-to-zone colour. Below 1.5 the fragment shader mixes the near-white base
   toward accent blue; above 1.5 it escapes onto a mint/gold/rust ramp. So the
   two families here are not a gradient of one hue but genuinely different
   parts of the palette, which is what gives the bands their contrast: pale
   ammonia crowns against gold and rust depths. */
/* Belt-to-zone colour, and the trick the whole body depends on.

   In an additive render there is no per-particle brightness dial: a particle's
   contribution is its colour times its size. Making the belts dark by shrinking
   or thinning their particles is therefore self-defeating, because below full
   coverage they stop overlapping and the band reads as speckle rather than as
   cloud. So the belts are darkened by COLOUR instead, and the palette happens
   to be built for exactly that: below 1.5 the fragment shader mixes toward the
   accent blue, whose luminance is less than half the gold's, while above 1.5 it
   escapes onto the mint/gold/rust ramp. Zones can therefore sit at full
   coverage in bright gold and belts at full coverage in deep blue, and the
   band contrast comes out of the two families rather than out of the density.

   A small share of the zone crowns drops to near-white for the ammonia cloud
   catching the light. Only a small share: pale particles win every additive
   overlap, and an earlier pass with white zones bleached the whole giant beige. */
/* Belt-to-zone colour, and where the band contrast actually comes from.

   Sizes are held in a narrow range so the body reads as one material, which
   means the palette has to carry the banding. It can: below 1.5 the fragment
   shader mixes toward the accent blue, whose luminance is less than half the
   gold's, and above 1.5 it escapes onto the mint/gold/rust ramp. So the belts
   are mostly rust with about a third of their particles dropped onto the
   accent, which darkens and cools them without ever reading as a blue stripe,
   and the zones are gold with a sixth dropped onto near-white for the ammonia
   cloud catching the light. Only a sixth: pale particles win every additive
   overlap, and an earlier pass with white zones bleached the whole giant. */
function deckTint(zone, rng) {
  if (zone > 0.72) {
    return rng.unit() < 0.17 ? rng.range(0.04, 0.2) : 2.56 + rng.range(0, 0.08);
  }
  if (zone > 0.42) return 2.68 + (0.72 - zone) * 0.75 + rng.range(0, 0.04);
  return rng.unit() < 0.24 ? 0.7 + rng.range(0, 0.25) : 2.92 + rng.range(0, 0.08);
}

const LAYERS = [
  /* Deep: the substrate. Near-uniform density, because something under the
     weather has to be continuous: three separately banded layers stacked on
     each other leave their holes in the same places and the body reads as
     speckle. One smooth layer underneath is what makes it a surface with cloud
     on it rather than a cloud of points. */
  { r: 0.948, lift: 0.024, rate: 0.93, role: 0.36, bg: 0.55,
    kLon: 1.6, kLat: 8.5, sz: [0.42, 0.6], lum: 0.62, floor: 0.97 },
  // Mid: the cloud deck proper. Most of the budget, the sharpest structure.
  { r: 0.990, lift: 0.018, rate: 1.0, role: 0.9, bg: 1.0,
    kLon: 2.7, kLat: 13.5, sz: [0.46, 0.8], lum: 1.0, floor: 0.92 },
  // High: thin, wispy, fastest. Sparse on purpose, so it reads as haze drifting
  // over the deck rather than as a fourth band system.
  { r: 1.027, lift: 0.032, rate: 1.075, role: 0.5, bg: 1.0,
    kLon: 4.2, kLat: 20.5, sz: [0.3, 0.5], lum: 0.88, floor: 0.5 },
  // Fill: whatever the three above left unspent, at frequencies between mid and
  // high. Its budget is decided last, from the cursor.
  { r: 0.972, lift: 0.020, rate: 0.97, role: 0.7, bg: 0.85,
    kLon: 3.4, kLat: 16.5, sz: [0.44, 0.7], lum: 0.82, floor: 0.94 },
];

/* Rejection sampling, not a uniform shell: a candidate direction is kept with
   a probability proportional to the turbulence field there. That is what
   produces varied density for free, and it is the difference between a
   particle ball and a cloud deck. Candidates come off a Fibonacci sphere so
   the accepted set stays evenly spread wherever the field is flat.

   The candidate walk must run to completion. fibonacciDirection sweeps y
   linearly from the north pole to the south, so stopping early — which is the
   obvious way to guarantee a layer never overspends its budget — does not trim
   the layer evenly, it deletes the southern cap. That bites a flat notch out of
   the bottom of the silhouette which is very hard to read as anything but bad
   shading.

   So the budget is met statistically instead. The acceptance rate is probed
   against the real field first, the candidate count is set so the expected
   number of accepts lands just under the budget, and the loop always finishes.
   The spread is a few tens of particles on a budget of tens of thousands, and
   the fill layer at the end absorbs whatever is left over either way. */
function bakeDeck(c, layer, budget, fbm) {
  if (budget < 64) return;
  const rng = c.rng;
  const dir = [0, 0, 0];
  const probe = 384;
  let mean = 0;
  for (let i = 0; i < probe; i++) {
    fibonacciDirection(i, probe, dir);
    mean += deckDensity(layer, sampleDeck(layer, dir, fbm));
  }
  mean = Math.max(0.05, mean / probe);

  const M = Math.floor(budget / mean);
  // Aims 1.5% under budget. The overshoot that would eat into the next
  // population's share is then about ten standard deviations away.
  const gain = 0.985;
  // Nearly two Fibonacci spacings of jitter. Less than one and the lattice
  // survives as a visible weave in the darker bands, where the particles are
  // sparse enough to be counted.
  const jit = 1.9 / Math.sqrt(M);
  let placed = 0;
  for (let i = 0; i < M; i++) {
    fibonacciDirection(i, M, dir);
    const d = norm([
      dir[0] + rng.bell() * jit,
      dir[1] + rng.bell() * jit,
      dir[2] + rng.bell() * jit,
    ]);
    const f = sampleDeck(layer, d, fbm);
    const density = deckDensity(layer, f);
    if (rng.unit() > density * gain) continue;
    if (placed >= budget) continue;
    placed++;

    const s = d[1];
    // Zones sit higher than belts, the way upwelling cloud actually does, so
    // the edge of the shell is not a perfect sphere.
    const rr = R * (layer.r + layer.lift * (0.3 + 0.7 * f.zone) + rng.bell() * 0.005);
    /* Polar hoods. The tilt throws one pole onto the limb, so whatever happens
       here happens to the silhouette — and a hood that is darkened AND
       shrunk AND swapped onto the accent blue (whose luminance is under half
       the gold's) compounds into a hole. An earlier pass did all three and bit
       a 90-degree notch out of the lower edge of the disc.

       So the hood lifts rather than lowers. Its shading value is pulled toward
       a mid tone, which stops the deepest belt value running all the way to
       the pole; the particles get slightly BIGGER to hold the limb; and only
       about a third of them go cool, at a pale end of the accent. The hood
       should read as cooler, flatter texture, not as an absence. */
    const polar = clamp01((Math.abs(s) - 0.72) / 0.28);
    const zone = f.zone + (0.58 - f.zone) * polar * 0.85;
    /* Coverage stays even; SIZE shades, but only gently.

       Every layer holds near-full density so that no band is ever made of
       points you can count, and the belts are darkened by shrinking their
       particles. The range is deliberately narrow — about 0.6x to 1.1x, on
       sizes inside the same 0.2-to-0.8 band every other formation in the score
       uses — so the giant reads as one material under varying light rather
       than as two different particle systems. Rigidity tracks the bands too:
       belts come out as soft wide halos the noise field pushes around, zones
       as crisp points. */
    const shade = 1 + (0.48 + 0.78 * Math.pow(zone, 1.2) - 1) * layer.bg;
    // Filament detail on top of the band. Without it a band is a flat stripe:
    // the structure inside one is what reads as weather.
    const detail = 1 + (0.17 * f.fil + 0.08 * f.fine) * layer.bg;
    const size = (layer.sz[0] + (layer.sz[1] - layer.sz[0]) * density)
      * layer.lum * shade * detail * rng.range(0.9, 1.1) * (1 + polar * 0.14);
    const tint = rng.unit() < polar * 0.32
      ? rng.range(0.26, 0.55)
      : deckTint(zone, rng);
    c.write(
      d[0] * rr, d[1] * rr, d[2] * rr,
      size,
      tint,
      (0.5 + s * 0.9 + f.fil * 0.07 + 2) % 1,
      zonalRate(s) * layer.rate,
      clamp01(layer.role * (0.3 + 0.85 * zone)),
    );
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
    /* The particle budget. These have to sum to less than one: ctx.write drops
       anything past `count`, so an over-subscribed split does not error, it
       quietly truncates whichever populations happen to be baked last. The
       remainder is deliberate headroom for the fill layer at the end, which
       sizes itself from the cursor. */
    const [coreShare, deepShare, midShare, highShare,
      stormShare, coronaShare, flareShare, emberShare, fieldShare] =
      c.split([0.16, 0.19, 0.32, 0.105, 0.07, 0.075, 0.03, 0.002, 0.03, 0.038]);
    const dir = [0, 0, 0];
    const out = [0, 0, 0];

    /* ---- The core -------------------------------------------------------
       The body is lit from the inside, and this is the light. Radii are drawn
       UNIFORMLY between an inner cutoff and the cloud base, which on a
       Fibonacci sphere puts the same number of particles in every shell and so
       distributes them as 1/r-squared. Integrated along a line of sight that
       falls off as 1/b: a bright centre easing smoothly out to the limb, which
       is the profile that makes a body read as self-luminous instead of as a
       lit ball. A uniform-volume fill instead gives a flat disc, and that flat
       disc is what made every earlier pass look like dust rather than a star.

       The inner cutoff matters: 1/r-squared runs away at the origin and a
       handful of particles at the very centre would clip to white. Stopping at
       0.19R and shrinking the innermost particles keeps the peak in range. */
    for (let i = 0; i < coreShare; i++) {
      fibonacciDirection(i, coreShare, dir);
      const jit = 0.9 / Math.sqrt(coreShare);
      const d = norm([
        dir[0] + rng.bell() * jit,
        dir[1] + rng.bell() * jit,
        dir[2] + rng.bell() * jit,
      ]);
      const q = rng.range(0.19, 0.975);
      const rr = R * q;
      const s = d[1];
      // Banded, at about half the strength of the deck above it, and eased off
      // toward the poles for the same reason the hood is: the core is what
      // holds the limb up where the deck's banding bottoms out.
      const belt = (0.74 + 0.32 * clamp01(bandProfile(s) * 0.58 + 0.5))
        * (1 + 0.16 * clamp01((Math.abs(s) - 0.72) / 0.28));
      const tint = q < 0.42 && rng.unit() < 0.16
        ? rng.range(0.04, 0.2)
        : 2.56 + q * 0.42 + rng.range(0, 0.04);
      c.write(
        d[0] * rr, d[1] * rr, d[2] * rr,
        (0.54 - 0.19 * q) * belt * rng.range(0.9, 1.1),
        tint,
        (0.5 + s * 0.45 + 1) % 1,
        zonalRate(s) * 0.94,
        0.34,
      );
    }

    /* ---- The cloud deck ------------------------------------------------- */
    bakeDeck(c, LAYERS[0], deepShare, fbm);
    bakeDeck(c, LAYERS[1], midShare, fbm);
    bakeDeck(c, LAYERS[2], highShare, fbm);

    /* ---- Storms ---------------------------------------------------------
       Each vortex is a spiral disc laid onto the sphere at its own latitude.
       The shader reads the particle's own swirl rate out of `spin` and rotates
       it about the radius through the storm's centre; the storm's zonal rate
       then carries the whole thing around the body.

       The rate profile across the storm is nearly, but not quite, solid body:
       the rim lags the core by about a fifth. A true Rankine vortex, with the
       rate falling off as the inverse square outside the eye wall, is what a
       real storm does and it looks correct for the first minute — after which
       the arms have wound up completely and the storm is an anonymous bright
       disc. This scene has no beginning or end, so a feature has to survive
       being watched indefinitely; a fifth of shear keeps it visibly turning
       without ever destroying itself. */
    const stormWeight = GIANT_STORMS.reduce((a, s) => a + s.share, 0);
    GIANT_STORMS.forEach((st, k) => {
      const n = Math.floor(stormShare * st.share / stormWeight);
      const C = dirAt(st.lat, st.lon);
      const { east, north } = frameAt(C);
      const eye = st.r * 0.3;
      for (let i = 0; i < n; i++) {
        const q = Math.pow(rng.unit(), 0.52);
        const rr = st.r * q;
        // Spiral the arms in, then thin the gaps between them.
        const a = rng.unit() * TAU + st.sense * 2.7 * (1 - q);
        const arm = 0.42 + 0.58 * Math.pow(0.5 + 0.5 * Math.sin(a * 2 + st.sense * rr * 2.2), 1.4);
        if (rng.unit() > 0.32 + 0.68 * arm) continue;

        const ang = rr / R;
        const sa = Math.sin(ang);
        const ca = Math.cos(ang);
        const ex = east[0] * Math.cos(a) + north[0] * Math.sin(a);
        const ey = east[1] * Math.cos(a) + north[1] * Math.sin(a);
        const ez = east[2] * Math.cos(a) + north[2] * Math.sin(a);
        const d = norm([C[0] * ca + ex * sa, C[1] * ca + ey * sa, C[2] * ca + ez * sa]);
        // Storms bulge, but never past the cloud deck above them: a storm that
        // pokes outside the silhouette stops being a feature on the body and
        // becomes an arc beside it.
        const rad = R * (1.0 + 0.022 * Math.pow(1 - q, 1.3) + rng.bell() * 0.004);
        const collar = 0.55 + 0.75 * Math.exp(-Math.pow((rr - eye * 1.5) / (st.r * 0.32), 2));
        const w = st.w * st.sense * (0.8 + 0.2 * Math.min(1, eye / Math.max(rr, 1e-3)));
        c.write(
          d[0] * rad, d[1] * rad, d[2] * rad,
          rng.range(0.36, 0.66) * st.lum * collar * arm,
          st.tint + (st.tint > 1.5 ? rng.range(-0.06, 0.05) : rng.range(0, 0.12)),
          (0.5 + d[1] * 0.9 + 2) % 1,
          stormSpin(k, w),
          0.93,
        );
      }
    });

    /* ---- Corona ---------------------------------------------------------
       The edge of the body, and the only thing that draws it: a halo just
       outside the atmosphere, falling off as roughly 1/r-squared, static, and
       confined to a band around the LIMB PLANE rather than spread over a full
       sphere. A full spherical halo is the obvious thing to build and it is
       wrong twice over: its near and far caps project straight onto the disc,
       so most of the particles end up as a veil over the body instead of a
       glow around it, and being the coolest population in the scene that veil
       desaturates everything underneath it. Confined to the limb, the same
       particles read as the corona they are meant to be, and the inner edge
       overlaps the cloud deck so the rim brightens continuously out of the
       body instead of hanging off it as a separate ring.

       Low rigidity, so the frame's noise field is what animates it: the corona
       is the one part of the body that drifts instead of turning. */
    for (let i = 0; i < coronaShare; i++) {
      const along = rng.bell() * 0.44;
      const ring = Math.sqrt(Math.max(0, 1 - along * along));
      const a = rng.unit() * TAU;
      const ca = Math.cos(a) * ring;
      const sa = Math.sin(a) * ring;
      const d = norm([
        SX[0] * ca + SY[0] * sa + VIEW[0] * along,
        SX[1] * ca + SY[1] * sa + VIEW[1] * along,
        SX[2] * ca + SY[2] * sa + VIEW[2] * along,
      ]);
      const rr = R * (0.985 + 1.55 * Math.pow(rng.unit(), 1.85));
      const fall = Math.pow(R / rr, 2.1);
      c.write(
        d[0] * rr, d[1] * rr, d[2] * rr,
        rng.range(0.3, 0.72) * fall,
        rng.unit() < 0.3 ? rng.range(0.3, 0.8) : 2.72 + rng.range(0, 0.2),
        rng.unit(),
        0,
        0.1,
      );
    }

    /* ---- Flares ---------------------------------------------------------
       Nine eruption sites. At rest the shader collapses each plume onto the
       surface and hides it; on that site's turn in the flare cycle it grows
       the arc back out and lets the tail escape. Because the shape is baked
       and only its extension is animated, an eruption costs the same as a
       stationary particle.

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
        const height = fl.reach * rng.range(0.45, 1.15);
        const swing = fl.curl + rng.bell() * 0.55;
        const lean = rng.bell() * 0.5;
        for (let j = 0; j < 3; j++) {
          apex[j] = C[j] * (R + height) + east[j] * height * swing + north[j] * height * lean;
          ctrl[j] = C[j] * (R + height * 1.45) + east[j] * height * swing * 0.3;
        }
        // Past 1 the particle overshoots the arc: the ejecta that does not
        // fall back.
        const t = Math.pow(rng.unit(), 1.25) * (rng.unit() < 0.1 ? 1.16 : 1.0);
        bezier2(foot, ctrl, apex, t, out);
        const spread = fl.reach * (0.05 + 0.16 * t);
        const j1 = rng.bell();
        const j2 = rng.bell();
        c.write(
          out[0] + (east[0] * j1 + north[0] * j2) * spread,
          out[1] + (east[1] * j1 + north[1] * j2) * spread,
          out[2] + (east[2] * j1 + north[2] * j2) * spread,
          rng.range(0.36, 0.78) * (1 - t * 0.45),
          2.62 + t * 0.34 + rng.range(-0.04, 0.04),
          rng.unit(),
          flareSpin(k),
          0.24,
        );
      }
    });

    /* ---- Foreground embers ----------------------------------------------
       A few dozen motes between the camera and the body, far enough outside
       the focal plane that the fragment shader draws them as bokeh discs
       rather than points. They exist for one reason: parallax. Anything this
       close swings hard across the frame when the camera drifts, which is what
       tells the eye how far away the body is. */
    for (let i = 0; i < emberShare; i++) {
      const t = rng.range(11, 36);
      const x = rng.range(-28, 28);
      const y = rng.range(-19, 19);
      c.write(
        CAM[0] + VIEW[0] * t + SX[0] * x + SY[0] * y,
        CAM[1] + VIEW[1] * t + SX[1] * x + SY[1] * y,
        CAM[2] + VIEW[2] * t + SX[2] * x + SY[2] * y,
        rng.range(0.42, 0.85),
        rng.unit() < 0.55 ? rng.range(2.62, 2.95) : rng.range(0.1, 0.5),
        rng.unit(),
        0,
        0.04,
      );
    }

    /* ---- Star field -----------------------------------------------------
       A slab behind the body rather than a shell around it, so nothing lands
       between the camera and the giant where it would read as dirt on the
       lens. Deliberately small and dim: at this budget a star field that
       competes with the body for brightness turns the frame into confetti. */
    for (let i = 0; i < fieldShare; i++) {
      const D = 74 + 120 * Math.pow(rng.unit(), 0.8);
      const spread = 0.4 + D * 0.62;
      const bright = i % 14 === 0;
      c.write(
        VIEW[0] * D + SX[0] * rng.signed() * spread + SY[0] * rng.signed() * spread * 0.78,
        VIEW[1] * D + SX[1] * rng.signed() * spread + SY[1] * rng.signed() * spread * 0.78,
        VIEW[2] * D + SX[2] * rng.signed() * spread + SY[2] * rng.signed() * spread * 0.78,
        bright ? rng.range(0.18, 0.32) : rng.range(0.07, 0.16),
        rng.range(0, 0.36),
        rng.unit(),
        0,
        0,
      );
    }

    /* ---- Fill -----------------------------------------------------------
       Everything the rejection-sampled layers left unspent goes back into the
       cloud deck as a fourth stratum, sized from the cursor. Sizing this last
       population from what is actually left is what lets the layers above take
       exactly the particles their density fields ask for, instead of every
       share having to be guessed exactly right in advance. */
    bakeDeck(c, LAYERS[3], Math.max(0, c.count - c.cursor), fbm);
  },
};
