import { GIANT, GIANT_STORMS, GIANT_FLARES, zonalRate, NUCLEUS_SHELLS, REACT_PLANES, REACT_BODY_SPIN, ACCRETION, ACCRETION_STREAMS, OUTFLOW,
  TUNNEL, STACK_FRAMES, STACK_TIME, STACK_GEOM, stackCentre, stackYaw, GALAXY_CARRIED, GALAXY_SUPERNOVAE, BIPOLAR_PLUME, JET_BEND } from '../lib/modes.js';
import { LENS_TABLE } from '../lib/lens-table.js';
import { EFFECTS_GLSL } from './effects.js';

const glslFloat = (n) => {
  const s = String(n);
  return s.includes('.') || s.includes('e') ? s : `${s}.0`;
};
const g5 = (n) => glslFloat(+Number(n).toFixed(5));

const v3 = (v) => `vec3(${v.map(g5).join(', ')})`;

// The call stack tower (lib/modes.js): every frame's level and schedule, and
// each level's place and turn.
const STACK_GLSL = (() => {
  const N = STACK_FRAMES.length;
  const TR = g5(STACK_TIME.tr);
  const fr = STACK_FRAMES.map((f, i) => `${i ? 'else ' : ''}if (k < ${i}.5) { L = ${g5(f.level)}; A = ${g5(f.push)}; B = ${g5(f.pop)}; }`).join('\n    ');
  const lv = [0, 1, 2, 3].map((L) => `${L ? 'else ' : ''}if (L < ${L}.5) { C = ${v3(stackCentre(L))}; Y = ${g5(stackYaw(L))}; }`).join('\n    ');
  return `void stFrame(float k, out float L, out float A, out float B) {
    L = 0.0; A = -1e4; B = 1e4;
    ${fr}
  }
  void stLevel(float L, out vec3 C, out float Y) {
    C = vec3(0.0); Y = 0.0;
    ${lv}
  }
  float stTau(float clock) { return mod(clock * ${g5(STACK_TIME.rate)}, ${g5(STACK_TIME.period)}); }
  // Frame k's (arrival, departure) at schedule time tau, each 0 to 1.
  vec2 stPhase(float k, float tau) {
    if (k < 0.5) return vec2(1.0, 0.0);
    float L, A, B;
    stFrame(k, L, A, B);
    return vec2(clamp((tau - A) / ${TR}, 0.0, 1.0), clamp((tau - B) / ${TR}, 0.0, 1.0));
  }
  vec3 stHash(vec3 p) {
    return fract(sin(vec3(dot(p, vec3(12.9898, 78.233, 37.719)), dot(p, vec3(39.3468, 11.1353, 83.155)), dot(p, vec3(73.156, 52.235, 9.151)))) * 43758.5453) - 0.5;
  }
  vec3 stackShape(vec3 p, float spin, float clock, vec3 pivot) {
    if (spin < 999.0) return p;
    float tau = stTau(clock);
    if (spin > 7050.0) {
      // The stack pointer: up one level for every frame on the stack.
      float depth = 0.0;
      for (int i = 1; i < ${N}; i++) {
        vec2 ph = stPhase(float(i), tau);
        depth += smoothstep(0.0, 1.0, ph.x) * (1.0 - smoothstep(0.0, 1.0, ph.y));
      }
      return pivot + p + vec3(0.0, ${g5(STACK_GEOM.dy)} * depth, 0.0);
    }
    if (spin > 6999.5) return pivot + p;
    float k = floor((spin - 6000.0) / 100.0 + 0.001);
    float L, A, B;
    stFrame(k, L, A, B);
    vec2 ph = stPhase(k, tau);
    float e = ph.x * ph.x * (3.0 - 2.0 * ph.x);
    float l = ph.y * ph.y;
    vec3 C; float Y;
    stLevel(L, C, Y);
    // Popped: lifted off and coming apart.
    vec3 q = p + stHash(p) * l * vec3(7.0, 3.0, 5.0);
    // Pushed: dropping in, turning into place.
    float yaw = Y + (1.0 - e) * 0.8 - l * 0.6;
    float pitch = -0.08 + (1.0 - e) * 0.35;
    float cp = cos(pitch), spt = sin(pitch);
    q = vec3(q.x, cp * q.y - spt * q.z, spt * q.y + cp * q.z);
    float cy = cos(yaw), sy = sin(yaw);
    q = vec3(cy * q.x + sy * q.z, q.y, -sy * q.x + cy * q.z);
    float bob = 0.07 * sin(clock * 0.9 + L * 1.7);
    return pivot + C + q + vec3(0.0, (1.0 - e) * 6.0 + l * 4.5 + bob, (1.0 - e) * 3.0);
  }
  float stackVis(float spin, float clock) {
    if (spin < 5999.5 || spin > 6999.5) return 1.0;
    float k = floor((spin - 6000.0) / 100.0 + 0.001);
    if (k < 0.5) return 1.0;
    vec2 ph = stPhase(k, stTau(clock));
    return smoothstep(0.0, 0.45, ph.x) * (1.0 - smoothstep(0.3, 1.0, ph.y));
  }`;
})();

// The whirlpool's carried clusters: anchor k for spin tags 700 + 10 k + 5 + rate.
const CARRY_TABLE = GALAXY_CARRIED.map((c, i) => `${i ? 'else ' : ''}if (k < ${i}.5) { C = ${v3(c.at)}; }`).join('\n      ');

// The whirlpool's supernovae: site k (its place and its offset in the shared
// cycle) for spin tags 800 + 10 k + 5 + 2 kind + rate.
const SN_TABLE = GALAXY_SUPERNOVAE.sites.map((s, i) => `${i ? 'else ' : ''}if (k < ${i}.5) { C = ${v3(s.at)}; PH = ${g5(s.phase)}; }`).join('\n    ');
const SN_CONSTS = `const float SN_RATE = ${g5(GALAXY_SUPERNOVAE.rate)};
const float SN_SPAN = ${g5(GALAXY_SUPERNOVAE.span)};
const float SN_SEED = ${g5(GALAXY_SUPERNOVAE.seed)};
const float SN_REACH = ${g5(GALAXY_SUPERNOVAE.reach)};`;

const GIANT_CONSTS = `const float GIANT_R = ${g5(GIANT.radius)};
  const float GIANT_FLARE_RATE = ${g5(GIANT.flareRate)};`;

// Which vortex a storm particle belongs to: its swirl axis (the radius through
// the storm's centre) and the zonal rate that carries the whole storm around
// the body. Both derived from the same entry in lib/modes.js the generator
// placed the particle from.
const STORM_TABLE = GIANT_STORMS.map((s, i) => {
  const cl = Math.cos(s.lat);
  const x = g5(cl * Math.cos(s.lon));
  const y = g5(Math.sin(s.lat));
  const z = g5(cl * Math.sin(s.lon));
  return `${i ? 'else ' : ''}if (k < ${i}.5) { ax = vec3(${x}, ${y}, ${z}); W = ${g5(zonalRate(Math.sin(s.lat)))}; }`;
}).join('\n      ');

// Which eruption site a flare particle belongs to: the zonal rate of the band
// it is launched from, its offset in the shared flare cycle, and how far it
// throws.
const FLARE_TABLE = GIANT_FLARES.map((s, i) => (
  `${i ? 'else ' : ''}if (k < ${i}.5) { W = ${g5(zonalRate(Math.sin(s.lat)))}; PH = ${g5(s.phase)}; RE = ${g5(s.reach)}; }`
)).join('\n      ');

const FLARE_PHASE = GIANT_FLARES.map((s, i) => (
    `${i ? 'else ' : ''}if (k < ${i}.5) { PH = ${g5(s.phase)}; }`
)).join('\n    ');

const NUCLEUS_AXES = NUCLEUS_SHELLS.map((sh, i) => {
  const [x, y, z] = sh.axis;
  return `${i ? 'else ' : ''}if (k < ${i}.5) { ax = vec3(${glslFloat(x)}, ${glslFloat(y)}, ${glslFloat(z)}); }`;
}).join('\n      ');

const REACT_TABLE = REACT_PLANES.map((pl, i) => {
  const [cx, cy, cz] = pl.centre;
  const n = Math.hypot(...pl.axis);
  const [x, y, z] = pl.axis.map((v) => +(v / n).toFixed(5));
  return `${i ? 'else ' : ''}if (k < ${i}.5) { C = vec3(${glslFloat(cx)}, ${glslFloat(cy)}, ${glslFloat(cz)}); ax = vec3(${glslFloat(x)}, ${glslFloat(y)}, ${glslFloat(z)}); }`;
}).join('\n      ');
const REACT_W = glslFloat(REACT_BODY_SPIN);

const FALL_CONSTS = `const float FALL_IN = ${glslFloat(ACCRETION.infallIn)};
  const float FALL_SPAN = ${glslFloat(ACCRETION.infallSpan)};
  const float FALL_SPEED = ${glslFloat(ACCRETION.infallSpeed)};`;
// The disc's warp node line (lib/modes.js ACCRETION): a rotating disc
// particle's baked z is its bob amplitude, lifted by sin(azimuth - node(r)).
const WARP_CONSTS = `const float WARP_NODE0 = ${g5(ACCRETION.warpNode0)};
  const float WARP_NODE1 = ${g5(ACCRETION.warpNode1)};`;
// The lens table's grid (lib/lens-table.js) and the shadow's radius in units
// of rs, 3 sqrt(3) / 2. The live knobs are uLens and uLensB.
const LENS_CONSTS = `const float LT_W = ${g5(LENS_TABLE.width)};
const float LT_H = ${g5(LENS_TABLE.height)};
const float LT_PSI = ${g5(LENS_TABLE.psiMax)};
const float LT_U = ${g5(LENS_TABLE.uMax)};
const float BC_RS = 2.5980762;
const float JET_B0 = ${g5(BIPOLAR_PLUME.start)};
const float JET_B1 = ${g5(JET_BEND.end)};`;
// The tilted streams' planes: normal k for spin tags 100 + 10 k + 5 + rate.
const STREAM_TABLE = ACCRETION_STREAMS.map((s, i) => `${i ? 'else ' : ''}if (k < ${i}.5) { ax = ${v3(s.axis)}; }`).join('\n      ');
// The wormhole's tube (lib/modes.js TUNNEL), the shape the flow passes through.
const TUNNEL_K = (2 * Math.PI) / TUNNEL.length;
const TUNNEL_CONSTS = `const float TUN_K = ${g5(TUNNEL_K)};
    const float TUN_TPH = ${g5(TUNNEL.throatAt * 2 * Math.PI)};
    const float TUN_SWELL = ${g5(TUNNEL.swell)};
    const float TUN_PINCH = ${g5(1 - TUNNEL.throat)};
    const float TUN_TWIST = ${g5(TUNNEL.twist)};
    const float TUN_TWIST_T = ${g5(TUNNEL.twistThroat)};
    const float TUN_SLOW = ${g5(TUNNEL.slow)};
    const float TUN_SWAY = ${g5(TUNNEL.sway)};
    const vec2 TUN_DARK = vec2(${g5(TUNNEL.darkBeyond * TUNNEL_K)}, ${g5(TUNNEL.lightBy * TUNNEL_K)});`;
const TUNNEL_BELL = (() => {
  // ((1 + cos d) / 2) ^ throatSharp by repeated squaring: sharp is a power of two.
  let n = TUNNEL.throatSharp, s = '';
  while (n > 1) { s += 'bell *= bell; '; n /= 2; }
  return s;
})();
const EJECT_CONSTS = `const float EJECT_START = ${glslFloat(OUTFLOW.ejectStart)};
  const float EJECT_SPAN = ${glslFloat(OUTFLOW.ejectSpan)};
  const float EJECT_SPEED = ${glslFloat(OUTFLOW.ejectSpeed)};`;

/* ==========================================================================
   THE VERTEX SHADER

   The hot path of the entire project. This runs once per particle per frame, up
   to 100,000 times at 60fps, and it is where every particle position actually
   comes from. The CPU never moves a particle; it only supplies two static
   formations and a morph value, and this decides where the particle is.

   By convention nothing inside the GLSL below is commented, so the map is here.

   --- What main() does, in order ---

    1. Stagger. Each particle derives its own morph progress from its seed, so a
       transition is a wave across the cloud rather than everything moving at
       once. uStaggerSpan is how wide that wave is. Inside its own window a
       structure particle leads and a dust particle follows by 0.12 (md), both
       smoothstep eased, so there is no velocity step at departure or arrival.
    2. Early out. Particles that are invisible at both ends (the registry's
       filler) are pushed off-screen at zero size and cost nothing further.
    3. shape() on both endpoints, animating each formation by its own MODE and
       its own clock. This is where a formation's motion lives.
    4. The flight path between them: a bowed arc rather than a straight line
       (uArc), bowing to one shared side (uHand) around a mostly non-degenerate axis
       (a thin oblique cone falls back to the per-particle scatter),
       with per-particle lane and polar variation so paths fan out. The
       vortex and pinch set-pieces override this to route particles out through
       the tunnel or in through the singularity.
    5. Curl-like noise displacement, weighted by 1 - role: loose dust wanders,
       rigid structure barely moves.
    6. The pointer's stir (touchStir): inside a cone round the pointer ray, in
       every formation alike, particles speed up and move around their place
       (a fast curl field and a quick orbit each). Size and light unchanged.
    7. The hole's lens, while a mode-5 slot is bound (lensK, that slot's share
       of the particle; uLens carries the chapter's `lensing`). The view-space
       position moves to where its light reaches the camera past a
       Schwarzschild hole whose shadow is the one the composite draws
       (holeImage, lib/lens-table.js) and keeps its depth, so its size, fog
       and shadow test (vNear) are the dot's own: the dot is never stretched,
       only placed, and its light is the image's magnification. The material
       draws the disc a second time with uImage = 1 (particle-system.js
       mirror): the arch the lens lifts over the shadow (the far side's
       primary image), reflected across the disc's line on the sky, so the
       same arch shows under the shadow (mirrorArch): the double image of
       the classic renders, symmetric about the disc. The jets rise from
       the hole's centre along its spin axis and bend in 3D past the shadow
       (jetShape, JET_BEND); the near one shows over the shadow (vNear) and is
       beamed brighter and drawn larger toward the camera; the far one is
       dimmer, smaller, and comes out from behind the disc (discShade), its
       base lensed round the rim and take only uLensB.w of the lens.
    8. Projection, then the point model. `px` is the particle's authored size in
       pixels (perspective, depth of field, hard caps), and it is the particle's
       ENERGY, not its footprint: `energy` is exactly the light the old
       size-as-blur sprite of that size put on screen. Every particle is drawn
       as one pixel-space Gaussian dot. Its sigma is its authored core width
       (px / 7.2, capped per role), never below SIG_MIN (0.40 px). The fragment
       shader samples the dot four times per pixel (see there), which widens
       it by a known variance (SS_VAR, 1/16 px^2), so the Gaussian it evaluates
       is sg2 = sigma^2 - SS_VAR and the dot on screen has exactly sigma. That
       sampling is what lets the floor sit this low: the dot's total light
       stays within 0.55% rms wherever it falls between pixels (measured on the
       GPU; a single sample per pixel needs sigma 0.55 for 1.4%, and the old
       sub-2.5 px sprites flickered 10-140%). Everything above the footprint
       turns into amplitude, so a big particle is a brighter dot rather than a
       blurrier one. A dot too hot for one pixel (peak above A_MAX) widens
       instead, at the same energy. uDensity is the quality ladder's size
       compensation: on a lower rung the footprint and the floor widen with
       it, so fewer points read as the same picture.
    9. Motion streaks, as a real shutter. The distance a particle covers while
       the shutter is open is its formation velocity (finite difference:
       shape() again at clock + H) times its slot's true clock rate times
       uShutter, plus the chain-rule derivative of the bowed flight path (direct
       plus bow) times the morph velocity times uMorphShutter. Projected to
       pixels that length L smears the dot along its motion (sigL^2 = sig^2 +
       L^2 / 12, the variance of a box of length L), faded in between 0.75 and
       1.5 px so a dot that is barely moving stays round. The amplitude divides
       by the evaluated widths (sqrt of sg2), so a streak carries the same
       light as the dot. A lensed dot's streak is measured through the lens
       and held back in proportion to how far the lens moved it, so the
       light wrapped round the shadow stays dots.
   10. Colour, fog, bokeh and the rest, written out as varyings; and vNear: while
       a hole formation is bound, how much of this particle sits in front of the
       horizon sphere the composite draws (behindSphere), so the near side of the
       disc crosses the shadow instead of being erased by it. Only the rotating
       disc does. The transport populations (infall and ejecta, spin < 0 in the
       hole modes 5 and 7) are held behind the aperture, per slot, so a morph
       into or out of a hole treats each endpoint by its own population. Held
       behind, a black-hole infall strand that comes toward the camera ends at
       the shadow's rim instead of laying its hottest end, where it reaches
       the disc, across the shadow, so the shadow stays black; the white
       hole's ejecta start inside its aperture, under the plateau.
   11. The gas giant's body, while a mode-8 slot is bound (presence8, the
       bound share of the giant: 1 at rest, fading with uMorph in a band).
       It is opaque: anything behind a sphere of 0.94 GIANT_R is hidden in
       proportion, so the far side does not add a second set of bands and
       the old core volume is not needed to fill the disc. Each surface dot
       (deck and storms, spin > 0) takes the light of its limb angle from
       its own endpoint, giantLimb, times the body's glow, and none past
       the limb. A uniformly dotted shell projects with density 1 / mu, so
       mu * mix(0.6, 1, sqrt(mu)) alone darkens the disc's HDR light gently
       to 0.6 at the edge. On the screen it did not: the tone curve
       compresses a sparse face-on dot's peak, while the dim dots that
       crowd toward the limb stay nearly linear, so the displayed limb read
       1.3-1.8 times the face-on light, a rim. A second factor,
       mix(toneFloor, 1, mu), takes that back. It is judged on the displayed
       frame (the canvas decoded to linear light, each latitude row against
       its own face-on stretch, so the bands cancel): at 3840x2025 (100k and
       the 37k cut at eight clock times, 68k and 50k at two) the outer 5%
       of the radius (mu under 0.3) reads 0.7-1.0 of face-on at mu 0.15-0.3
       and 0.37-0.77 nearer the edge. Flares (spin < -0.5) show only
       against the sky (giantSky): drawn over the disc a plume reads as a
       scratch, and cooler plasma cannot darken an additive disc. Last, a
       particle whose peak would be below 0.002 is culled before it costs
       any fill.

   --- Helper functions, in the order they appear ---

     dopplerFor          relativistic beaming: brightens the side of a rotating
                         disc that is turning toward the camera (q is measured
                         from the formation's pivot). Mode 1 scales it by the
                         rate; mode 5 (the black hole's disc, 2026-09-29) reads
                         the orbit's tangent in the disc frame through the
                         tilt and beams at a fixed 1.3, so the approaching
                         side is bright whatever the rate
     jetBase             how far along a polar jet a particle is (only the
                         rotating hole populations, spin > 0: transport and
                         world-authored particles never pulse with the jet)
     perihelionSpark     brightening at closest approach
     supernovaSite,      the whirlpool's supernovae (mode 1, the 800-1000 band:
     supernovaKind,      spin 800 + 10 k + 5 + 2 kind + rate, twelve sites reach
                         917; lib/modes.js GALAXY_SUPERNOVAE):
     supernovaGlow,      the site and its cycle offset from the tag, whether a
     supernovaVisibility particle is the star (kind 1) or its shell (0), the
                         star's flash and the shell's fading light over the
                         shared cycle, and the shell's visibility (hidden for
                         the rest of the cycle; the star stays as a faint
                         star). shape() drives the shell out from SN_SEED to
                         SN_REACH as the square root of the cycle's first
                         SN_SPAN, then turns the site with the disc (2026-09-30)
     holeGlow            the black hole's proximity glow (fourth cut, replacing
                         the redshift dim): every mode-5 particle brightens as
                         it nears the hole, 1 + HOLE_GLOW (HOLE_GLOW_R / r)^2,
                         measured where shape() has carried it (so the infall
                         heats as it falls and the whirlpool arms and inner
                         lanes blaze at the rim), r held at the drawn aperture.
                         Never the world-authored spin-0 particles (the sky).
                         A white hole is a source and is never dimmed
     lensImpact          an image's distance from the hole on the plane
                         through it (its impact parameter) for an emitter at
                         radius r whose light sweeps Psi about the hole:
                         b = r sin(alpha) / sqrt(1 - rs / r), the emission
                         angle alpha from the exact table (uLensTable)
     lensRadius          the k-th image's radius for a view-space point. Psi
                         is psi for the primary and 2 pi - psi for the
                         secondary, psi being the angle at the hole between
                         the point and the camera, plus b / D because the
                         camera is D away, not at infinity (two fixed-point
                         steps). The primary is added to the dot's own
                         perspective radius as a displacement, so it is
                         exactly the dot when rs is 0
     holeImage           the k-th image's place at the point's own depth: the
                         primary on the point's side of the hole, the
                         secondary opposite, both turned about the hole in the
                         disc's sense by frame dragging (uLens.y at the
                         shadow, falling as (b_c / b)^uLensB.y, only for light
                         that passed behind the hole). `mu` is the
                         magnification, (b / beta)(db / dbeta) by a finite
                         difference: a lens keeps surface brightness, so the
                         dots spread over the arch are brighter and the
                         mirror's packed dots dimmer
     lensPlace           holeImage, of which the jets take uLensB.w
     mirrorArch          the far side's primary image reflected across the
                         disc's projected line, weighted to what the lens
                         lifted (uLensB.z), for the mirror pass
     curvedTransport     the path of a transport particle (infall and ejecta):
                         straight out along its direction, swirled about that
                         line by a fixed wave per id, so each direction and id
                         is one fixed curve the clock carries particles along.
                         `curl` scales the wave's frequency: 1 for both the
                         white hole's ejecta and the black hole's infall, whose
                         swirl is 0.015-0.065 of the capture radius per id
                         (2026-09-30, down from 0.06-0.24 at curl 1.6: the
                         infall corkscrewed into a cloud of curls; now it is
                         gently bent streaks). The infall's swirl grows
                         through the capture zone and holds its size beyond
                         it (FALL_IN + 0.18 FALL_SPAN): grown with the
                         distance, as the ejecta's still is, it
                         bent the far ends of the black hole's strands that
                         recede from the camera into hooks
     plumeMotion         motion of particles inside the bipolar jets
     jetShape            the black hole's jets: along the spin axis from the
                         hole's centre, then bent ever harder to opposite
                         sides in the disc's frame (JET_BEND), the
                         cross-section turned with the curve
     shape               the big one: per-MODE animation, dispatching on the
                         MODE enum from lib/modes.js. Everything a formation
                         does after it is baked happens here.
                         Mode 2 (2026-09-29): the tunnel is a shape the flow
                         passes through. The bake is a straight cylinder in
                         tube space; from the depth a particle has flowed to
                         (periodic over TUNNEL.length) the shader takes the
                         wall's radius (swell and throat), the cross-section's
                         twist (spinning up through the throat), the flow's
                         slowing there (display z lags the flow), and the
                         axis's sway on uTime, anchored at the throat. spin
                         packs a flow speed with a rigid rotation rate
                         (lib/modes.js tunnelSpin). A tunnel particle's near
                         fade is pow(smoothstep(9, 40, dist), 2.5), softer
                         than the old cube over 9-44, so the near wall frames
                         the view instead of vanishing.
                         Mode 5 (2026-09-29): a rotating disc particle's baked
                         z is its bob amplitude, lifted by sin(azimuth -
                         node(r)) as it orbits (ACCRETION.warpNode*), so each
                         rides an inclined orbit and the disc is a puffed,
                         warped sheet the material flows through; spin tags
                         100 + 10 k + 5 + rate are debris streams turning
                         about the k-th plane of ACCRETION_STREAMS
     transportVisibility hides particles during the part of an infall or ejection
                         cycle where they should not be visible, so recycling
                         does not show as popping, and heats the infall: it
                         is faint where it is captured and brightens as the
                         square of the way it has fallen over a floor of 0.08
                         (2026-09-29: the infall is most of the black hole
                         now, and its far reaches must read as material
                         arriving, not vanish), measured on the
                         distance the clock has carried it to, so the heat
                         stays where it is while the stream flows through it.
                         (The chapter's pulse is the generator's: the black
                         hole gives each strand one phase, so a strand takes
                         the pulse whole and no ring runs down the streams.)
     behindSphere        how far behind a sphere's near surface a view-space
                         point lies along its own ray, softened: 0 in front of
                         the sphere or beside it, 1 behind it
     giantLimb           the gas giant's limb darkening for one surface dot,
                         times GIANT_GLOW, the body's own light: the deck is a
                         self-luminous surface, brighter per dot than an
                         ordinary particle, so the chapter's exposure (which
                         also grades the formations it morphs with) stays put.
                         mu is clamped at 0, not above it: the far side's dots
                         just past the occluder project with density 1 / mu,
                         and any light left on them grows into a rim.
                         toneFloor (0.45 at the full count) is the displayed
                         limb's correction for the tone curve (step 11). On a
                         lower rung each dot's peak rises by densityAlpha,
                         the tone curve compresses the face-on dots by about
                         as much, and the floor divides by it:
                         pow(uDensity, 1.47) is densityAlpha, since
                         cv-universe.js derives densityAlpha (ratio^0.5) and
                         densitySize (ratio^0.34, which uDensity carries)
                         from the same count ratio, and no rung reaches either
                         cap. If either exponent changes there, 1.47 has to
                         change with it
     giantSky            1 where a view-space point lies off the giant's disc,
                         0 in front of or behind it
     flow                the noise field: two octaves of a divergence-free sine
                         pattern, which swirls rather than dilating and so moves
                         dust without thinning or bunching it
     touchStir           the pointer's stir: a fast swirl round each particle's place

   --- The seventh cut (lib/modes.js HOLE_FX in uFx: doppler, frozen, corkscrew,
       each 0 or 1; at 0 each leaves the sixth cut as it was) ---

     frozenX,            frozen infall: the fall's progress remapped through a
     frozenRadius,       softplus, so it slows to a stop at FZ_R and never
     frozenRedden        crosses, and how red it is as it stops
     corkscrew,          the precessing jets: each dot offset by the nozzle's
     jetKnots            direction when it left; three knots a jet
     whiteJet,           the same three on the white hole (mode 7): its jets
     whiteDoppler,       (the plumes, by spin), the side of its disc coming
     thawRadius,         toward the camera, and its outflow, born at the
     thawHeat            centre and speeding up outward, drawn over the glow
                         (a white hole has no horizon), white-hot as it leaves

   --- Things worth knowing before editing ---

   Constants baked in from JS. The ${...} interpolations near the top of the
   string splice in generated GLSL built from the tables in lib/modes.js, so the
   orbits, shells and reaction planes are identical on both sides. Editing those
   numbers here rather than there breaks the correspondence silently.

   `spin` is overloaded. Below 90 it is a literal rate; 100+, 200+ and 500+ are
   tags identifying which body a particle belongs to, and in mode 5 1000+ are
   the whirlpool arms. See lib/modes.js. In the
   orbit and hole modes (8, 5 and 7) a spin of exactly 0 is a world-space
   pass-through: shape() returns the authored position untouched, with no
   tilt, rotation, jet or transport, so a generator can place view-locked
   light (the white hole's corona, the giant's corona) and backdrops
   (lib/sampling.js backdrop()) in world coordinates. No other particle of
   those modes has a spin of exactly 0.

   shape() is called four times per vertex: twice for the endpoints and twice
   more for the finite-difference velocity (skipped when uShutter is 0). It is
   the most expensive thing here and the first place to look if frame times
   regress.

   Diagnostics inject a debug tail before the closing brace of main() and read
   `px`, `stretch` (sigL / sig), `role`, `dist`, `energy`, `sig` and `sig0` by
   name, so those locals stay at the top level of main().
   ========================================================================== */
export const particleVertex = /* glsl */ `
attribute vec3 aPosB;
attribute vec4 aAttrA;
attribute vec4 aAttrB;
attribute float aRoleA;
attribute float aRoleB;
attribute float aSeed;

uniform float uMorph;
uniform float uStaggerSpan;
uniform float uArc;
uniform float uTime;
uniform float uClockA;
uniform float uClockB;
uniform float uClock;
uniform float uSize;
uniform float uSizeScale;
uniform float uNoise;
uniform float uNoiseScale;
uniform float uNoiseSpeed;
uniform float uFogNear;
uniform float uFogFar;
uniform float uFocus;
uniform float uFocusRange;
uniform float uDof;
uniform float uWarmRadius;
uniform float uPulse;
uniform float uPulseClock;
uniform float uPulseWidth;
uniform vec3 uPivotA;
uniform vec3 uPivotB;
uniform vec2 uTunnel;
uniform int uModeA;
uniform int uModeB;
uniform mat3 uTiltA;
uniform mat3 uTiltB;
uniform float uShutter;
uniform float uRateA;
uniform float uRateB;
uniform float uMorphShutter;
uniform float uMorphVel;
uniform float uHoleR;
uniform vec4 uLens;
uniform vec4 uLensB;
uniform vec4 uJetBend;
uniform vec4 uLensC;
uniform vec4 uJetLook;
uniform vec4 uJetMore;
uniform sampler2D uLensTable;
uniform float uImage;
uniform float uDensity;
uniform float uOpacity;
uniform float uVortex;
uniform float uPinch;
uniform float uScatter;
uniform float uHand;
uniform vec2 uViewport;
uniform vec3 uTouchA;
uniform vec3 uTouchB;
uniform vec3 uPointerOrigin;
uniform vec3 uPointerDir;
uniform vec3 uPointerMove;
uniform float uPointerGain;
uniform vec3 uFx;

varying float vTint;
varying float vAlpha;
varying float vLum;
varying float vWarm;
varying float vCoc;
varying float vDepth;
varying float vSeed;
varying float vSide;
varying float vSig;
varying float vSigL;
varying vec2 vDir;
varying float vNear;
varying vec2 vInv;
varying float vHot;

const float PI = 3.141592653589793;
const float SIG_MIN = 0.40;
const float A_MAX = 12.0;
const float SS_VAR = 0.0625;
${GIANT_CONSTS}
${LENS_CONSTS}

float dopplerFor(vec3 q, float spin, int mode, mat3 tilt) {
  if (spin < 1e-3 || (spin >= 90.0 && !(mode == 5 && spin >= 1000.0))) return 0.0;
  if (mode == 5) {
    vec3 lq = vec3(dot(tilt[0], q), dot(tilt[1], q), dot(tilt[2], q));
    vec3 vel = tilt * normalize(vec3(-lq.y, lq.x, 0.0) + vec3(1e-4));
    float vz = (modelViewMatrix * vec4(vel, 0.0)).z;
    return clamp(vz, -1.0, 1.0) * 1.3;
  }
  if (mode != 1) return 0.0;
  vec3 vel = normalize(vec3(q.z, 0.0, -q.x) + vec3(1e-4));
  float vz = (modelViewMatrix * vec4(vel, 0.0)).z;
  return clamp(vz, -1.0, 1.0) * min(1.0, spin * 4.0);
}

float jetBase(vec3 lp, vec3 pivot, float spin, int mode) {
  if (spin < 1e-4 || spin >= 90.0) return 0.0;
  if (mode == 5) {
    float az = abs(lp.z);
    return smoothstep(3.0, 4.5, az) * (1.0 - smoothstep(4.5, 13.0, az));
  }
  if (mode == 7) {
    float az = abs(lp.z - pivot.z);
    return smoothstep(3.0, 4.5, az) * (1.0 - smoothstep(4.5, 13.0, az));
  }
  return 0.0;
}

float perihelionSpark(vec3 sp, float spin, int mode, vec3 pivot) {
  if (mode != 1 || spin < 200.0 || spin >= 700.0) return 0.0;
  float pvz = (modelViewMatrix * vec4(pivot, 1.0)).z;
  float svz = (modelViewMatrix * vec4(sp, 1.0)).z;
  float len = max(length(sp - pivot), 1e-3);
  float toward = clamp((svz - pvz) / len, 0.0, 1.0);
  return pow(toward, 6.0);
}

// The old inner torus's rim (1.06 of the horizon sphere) and the drawn aperture
// (formations/blackhole.js BLACK_HOLE_HORIZON x the chapters' horizon 0.72).
// The fifth cut's rim sits at 0.82 of the sphere, inside HOLE_GLOW_R, so it
// runs hotter than the old one did: that is the light the lens wraps.
const float HOLE_GLOW = 1.4;
const float HOLE_GLOW_R = 6.57;
const float HOLE_APERTURE = 4.464;
// The disc's inner rim (formations/blackhole.js INNER_IN, 0.82 of the sphere).
const float RIM_IN = 5.084;
float holeGlow(vec3 q, float spin, int mode) {
  if (mode != 5 || abs(spin) < 1e-4) return 1.0;
  float k = HOLE_GLOW_R / max(length(q), HOLE_APERTURE);
  return 1.0 + HOLE_GLOW * k * k;
}

float lensImpact(float r, float rs, float sweep) {
  float u = min(rs / max(r, 1e-3), LT_U);
  float s1 = sqrt(1.0 - u);
  float ac = PI - asin(min(1.0, BC_RS * u * s1));
  vec2 st = vec2(clamp(sweep / LT_PSI, 0.0, 1.0), sqrt(u / LT_U));
  st = (st * (vec2(LT_W, LT_H) - 1.0) + 0.5) / vec2(LT_W, LT_H);
  return max(r, rs / LT_U) * sin(ac * (1.0 - texture2D(uLensTable, st).r)) / s1;
}

float lensRadius(vec3 P, vec3 C, float D, float rs, float k, float beta, out float psi) {
  vec3 v = P - C;
  float r = max(length(v), 1e-3);
  psi = acos(clamp(dot(v, -C) / (r * D), -1.0, 1.0));
  float sweep = k > 0.5 ? 2.0 * PI - psi : psi;
  float b = k > 0.5 ? 1.2 * BC_RS * rs : beta;
  b = lensImpact(r, rs, sweep + b / D);
  b = lensImpact(r, rs, sweep + b / D);
  if (k > 0.5) return b;
  float m = r * sin(min(psi + beta / D, PI));
  m = r * sin(min(psi + m / D, PI));
  return max(beta + b - m, 0.0);
}

vec3 holeImage(vec3 P, vec3 C, float rs, float sense, float jit, bool magnify, out float mu, out float shift) {
  mu = 1.0;
  shift = 0.0;
  float Ds = -P.z;
  float Dl = -C.z;
  float D = length(C);
  if (Ds < 0.5 || Dl < 0.5 || rs < 1e-4) return P;
  vec2 bv = P.xy * (Dl / Ds) - C.xy;
  float beta = length(bv);
  vec2 n = beta > 1e-4 ? bv / beta : vec2(0.0, 1.0);
  float bc = BC_RS * rs;
  float psi;
  float b = lensRadius(P, C, D, rs, 0.0, beta, psi);
  if (magnify) {
    float h = 0.04 * bc + 0.01;
    float psi2;
    float b2 = lensRadius(P + vec3(n * h * (Ds / Dl), 0.0), C, D, rs, 0.0, beta + h, psi2);
    mu = abs(b * (b2 - b) / (max(beta, 0.02 * bc) * h));
  }
  // The far side's inner edge lands packed in a thin arc just outside the
  // shadow. uLensC.y scatters those images outward, each by its particle's
  // own jit (0 to 1), so the arch has a soft inner edge and not a line.
  float lift = 1.0 - beta / max(b, 1e-3);
  b += uLensC.y * bc * jit * smoothstep(0.1, 0.35, lift) * (1.0 - smoothstep(1.3, 1.7, b / bc));
  float drag = sense * uLens.y * pow(bc / max(b, bc), uLensB.y) * smoothstep(0.35 * PI, 0.9 * PI, psi);
  float ca = cos(drag);
  float sa = sin(drag);
  vec2 img = vec2(ca * n.x - sa * n.y, sa * n.x + ca * n.y) * b;
  shift = length(img - bv);
  return vec3((C.xy + img) * (Ds / Dl), P.z);
}

// The mirror pass keeps this share of the disc (by seed): an echo of dots.
const float MIRROR_KEEP = 0.6;
float isJet(vec3 p, float spin, int mode) {
  return mode == 5 && spin > 1e-4 && spin < 90.0 && (abs(p.z) > ${glslFloat(ACCRETION.jetThreshold)} || dot(p.xy, p.xy) < 16.0) ? 1.0 : 0.0;
}
float mirrorable(vec3 p, float spin, int mode) {
  return mode == 5 && spin > 1e-4 && isJet(p, spin, mode) < 0.5 ? 1.0 : 0.0;
}

// The jets take uLensB.w of the lens: enough to bend their light near the
// hole, little enough that the far one's base stays on the rim.
vec3 lensPlace(vec3 P, vec3 C, float rs, float sense, float jit, float jet, bool magnify, out float mu, out float shift) {
  vec3 img = holeImage(P, C, rs, sense, jit, magnify, mu, shift);
  float k = mix(1.0, uLensB.w, jet);
  mu = mix(1.0, mu, k);
  shift *= k;
  return mix(P, img, k);
}

// The mirror arch: the primary image of the far side of the disc, the arch
// the lens lifts over the shadow, reflected across the disc's line on the sky
// (the projected disc plane through the hole), so the same arch shows under
// the shadow. w keeps it to what the lens lifted (uLensB.z), behind the
// hole, away from the ends of the line, where the two arches meet, clear of
// the orange ring (b > 1.32 b_c, a dark gap between) and to the inner disc,
// so it is one band.
vec3 mirrorArch(vec3 P, vec3 img, vec3 C, vec2 axis2, float rs, out float w) {
  w = 0.0;
  float Ds = -P.z;
  float Dl = -C.z;
  if (Ds < 0.5 || Dl < 0.5) return img;
  vec2 bv = P.xy * (Dl / Ds) - C.xy;
  vec2 io = img.xy * (Dl / Ds) - C.xy;
  float b = length(io);
  if (b < 1e-3) return img;
  vec2 a = normalize(axis2 + vec2(1e-5, 0.0));
  float lift = 1.0 - length(bv) / b;
  w = smoothstep(0.5, 2.5, Ds - Dl)
    * smoothstep(uLensB.z - 0.12, uLensB.z + 0.18, lift)
    * smoothstep(0.2, 0.6, abs(dot(io, a)) / b)
    * smoothstep(1.32, 1.55, b / (BC_RS * max(rs, 1e-3)))
    * (1.0 - smoothstep(8.5, 11.5, length(P - C)));
  vec2 ir = io - 2.0 * dot(io, a) * a;
  return vec3((C.xy + ir) * (Ds / Dl), P.z);
}

// How much of a jet particle's light gets past the disc (uJetLook.z its
// opacity): the far jet is seen through the disc wherever the straight line to
// the camera crosses the disc plane between the inner rim and r 11, so it
// comes out from behind the disc. Light that crosses inside the inner rim (the
// strongly lensed base, threading between the horizon and the disc) passes.
float discShade(vec3 P, vec3 C, vec3 N) {
  float pn = dot(P, N);
  if (abs(pn) < 1e-4) return 1.0;
  float t = dot(C, N) / pn;
  if (t <= 0.0 || t >= 1.0) return 1.0;
  float r = length(t * P - C);
  return 1.0 - uJetLook.z * smoothstep(RIM_IN * 0.95, RIM_IN * 1.1, r) * (1.0 - smoothstep(6.5, 11.0, r));
}

const float FZ = 0.3;
const float FZ_S = 0.05;
const float FZ_R = 3.0;
float frozenX(float u) { return (u - FZ) / (1.0 - FZ); }
float frozenRadius(float u) {
  ${FALL_CONSTS}
  return FZ_R + (FALL_IN + FALL_SPAN - FZ_R) * FZ_S * log(1.0 + exp(min(frozenX(u) / FZ_S, 40.0)));
}
float frozenRedden(vec3 p, float clock) {
  ${FALL_CONSTS}
  float x = frozenX(mod(length(p) - FALL_IN - clock * FALL_SPEED, FALL_SPAN) / FALL_SPAN);
  return clamp((0.12 - x) / 0.12, 0.0, 2.0);
}

const float CORK_TAN = 0.09;
const float CORK_K = 0.33;
const float CORK_W = 0.45;
const float KNOT_V = 2.2;
vec3 corkscrew(vec3 q, float clock) {
  if (uFx.z < 0.5) return q;
  float az = abs(q.z);
  float ph = CORK_W * clock - CORK_K * az;
  q.xy += sign(q.z) * CORK_TAN * az * smoothstep(1.0, 6.0, az) * vec2(cos(ph), sin(ph));
  return q;
}
float jetKnots(vec3 p, float clock) {
  float az = abs(p.z);
  float sh = p.z < 0.0 ? 0.37 : 0.0;
  float k = 0.0;
  for (int i = 0; i < 3; i++) {
    float zk = 3.0 + mod(KNOT_V * clock + (float(i) / 3.0 + sh) * 27.0, 27.0);
    float d = (az - zk) / 1.1;
    k += exp(-d * d) * smoothstep(3.0, 6.0, zk) * (1.0 - smoothstep(22.0, 30.0, zk));
  }
  return k;
}

// The white hole gets the same three. Its jets are its bipolar plumes: the
// only mode-7 particles that carry exactly the plume's spin, past the kernel.
const float WJ_SPIN = ${glslFloat(BIPOLAR_PLUME.spin)};
float whiteJet(vec3 q, float spin, int mode) {
  return mode == 7 && abs(spin - WJ_SPIN) < 1e-6 && abs(q.z) > 1.0 ? 1.0 : 0.0;
}
// Its disc, arms and shells turn the way the black hole's disc does, so the
// side coming toward the camera is found the same way (dopplerFor).
float whiteDoppler(vec3 q, float spin, int mode, mat3 tilt) {
  if (mode != 7 || spin < 1e-3 || abs(spin - WJ_SPIN) < 1e-6) return 0.0;
  vec3 lq = vec3(dot(tilt[0], q), dot(tilt[1], q), dot(tilt[2], q));
  vec3 vel = tilt * normalize(vec3(-lq.y, lq.x, 0.0) + vec3(1e-4));
  return clamp((modelViewMatrix * vec4(vel, 0.0)).z, -1.0, 1.0) * 1.3;
}
// Its outflow, from the centre: born at THAW_R, inside the kernel, leaving
// at THAW_A of the mean speed and speeding up steadily, to 2 - THAW_A of it
// by the frame's edge, white-hot until it is about 6 units out.
const float THAW_R = 0.3;
const float THAW_A = 0.45;
float thawRadius(float u) {
  ${EJECT_CONSTS}
  return THAW_R + (EJECT_START + EJECT_SPAN - THAW_R) * u * (THAW_A + (1.0 - THAW_A) * u);
}
float thawHeat(vec3 p, float clock) {
  ${EJECT_CONSTS}
  float u = mod(length(p) - EJECT_START + clock * EJECT_SPEED, EJECT_SPAN) / EJECT_SPAN;
  return 1.0 - smoothstep(0.02, 0.2, u);
}

${SN_CONSTS}

vec4 supernovaSite(float spin) {
  float enc = spin - 800.0;
  float k = floor(enc * 0.1);
  vec3 C = vec3(0.0);
  float PH = 0.0;
  ${SN_TABLE}
  return vec4(C, PH);
}

float supernovaKind(float spin) {
  float enc = spin - 800.0;
  float k = floor(enc * 0.1);
  return step(1.0, enc - k * 10.0 - 5.0);
}

float supernovaGlow(float spin, int mode, float clock) {
  if (mode != 1 || spin < 800.0 || spin >= 1000.0) return 1.0;
  float cyc = fract(clock * SN_RATE + supernovaSite(spin).w);
  float rise = smoothstep(0.0, 0.012, cyc);
  float flash = rise * exp(-cyc * 16.0);
  float shell = rise * (1.0 - smoothstep(0.1, SN_SPAN, cyc));
  return mix(0.3 + 1.6 * shell, 0.35 + 9.0 * flash, supernovaKind(spin));
}

float supernovaVisibility(float spin, float clock) {
  float cyc = fract(clock * SN_RATE + supernovaSite(spin).w);
  float vis = smoothstep(0.0, 0.012, cyc) * (1.0 - smoothstep(0.72 * SN_SPAN, SN_SPAN, cyc));
  return mix(vis, 1.0, supernovaKind(spin));
}

vec3 curvedTransport(vec3 origin, float distance, float id, float amplitude, float curl) {
  vec3 direction = normalize(origin + vec3(0.0001, -0.0002, 0.0003));
  vec3 guide = normalize(vec3(
    sin(id * 12.9898 + 1.7),
    cos(id * 78.233 - 0.4),
    sin(id * 39.425 + 2.3)
  ));
  vec3 side = normalize(cross(direction, guide) + vec3(0.0003, -0.0002, 0.0001));
  vec3 lift = normalize(cross(direction, side));
  float phase = id * PI * 2.0;
  float turnA = sin(distance * curl * (0.11 + 0.025 * fract(id * 7.31)) + phase);
  float turnB = cos(distance * curl * (0.085 + 0.02 * fract(id * 11.7)) - phase * 0.73);
  return direction * distance + amplitude * (side * turnA + lift * turnB * 0.72);
}

vec3 plumeMotion(vec3 p, float spin, float clock) {
  float radial = length(p.xy);
  float axial = abs(p.z);
  float plume = smoothstep(3.5, 8.0, axial);
  float front = sin(clock * 1.15 - radial * 0.31 - axial * 0.24 + spin * 19.0);
  p.xy *= 1.0 + front * mix(0.07, 0.025, plume);
  p.z += sign(p.z) * front * mix(0.12, 1.05, plume);
  float angle = spin * clock * 2.2 + front * 0.018;
  float s = sin(angle);
  float c = cos(angle);
  return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
}

// The black hole's jets (lib/modes.js JET_BEND): along the disc's spin axis
// from the hole's centre, then, past the shadow, bending ever harder to
// opposite sides in the disc's own frame, the cross-section turned with the
// curve so the jet keeps its width. The lower jet is the upper one turned
// through the hole.
vec3 jetShape(vec3 q, mat3 tilt) {
  float sg = q.z < 0.0 ? -1.0 : 1.0;
  vec3 qu = q * sg;
  float L = JET_B1 - JET_B0;
  // The sideways slope grows from 0 to uJetBend.x over L (slowly, then
  // strongly) and holds: the jet turns back from the leaning axis toward the
  // screen's vertical and runs straight on, leaving the frame near the middle
  // of the top or bottom edge.
  float t = max(qu.z - JET_B0, 0.0) / L;
  float f = uJetBend.x * L * (t < 1.0 ? 0.5 * t * t : t - 0.5);
  float fp = uJetBend.x * min(t, 1.0);
  vec2 d = uJetBend.zw;
  vec2 dp = vec2(-d.y, d.x);
  float u = dot(qu.xy, d);
  float inv = inversesqrt(1.0 + fp * fp);
  vec3 bent = vec3(d * (f + u * inv) + dp * dot(qu.xy, dp), qu.z - u * fp * inv);
  // The upper jet (local +z) is moved out along the axis by uJetMore.x, bend
  // and all, so it starts at the disc rather than over the shadow.
  if (sg > 0.0) bent.z += uJetMore.x;
  return tilt * (bent * sg);
}

${STACK_GLSL}

${EFFECTS_GLSL}

vec3 shape(vec3 p, float spin, int mode, mat3 tilt, float clock, vec3 pivot) {
  if (mode == 10) return stackShape(p, spin, clock, pivot);
  if (mode == 2) {
    ${TUNNEL_CONSTS}
    float rot = floor(spin * 0.1);
    float flow = spin - rot * 10.0 - 1.0;
    float u = mod(p.z + (0.55 + flow) * clock * 7.0 - uTunnel.x, uTunnel.y) + uTunnel.x;
    float ph = (u - uTunnel.x) * TUN_K;
    float d = ph - TUN_TPH;
    float bell = 0.5 + 0.5 * cos(d);
    ${TUNNEL_BELL}
    float R = (1.0 + TUN_SWELL * sin(2.0 * ph + 1.2)) * (1.0 - TUN_PINCH * bell);
    float theta = TUN_TWIST * ph + TUN_TWIST_T * sin(d) + (rot - 5.0) * 0.015 * clock;
    float st = sin(theta);
    float ct = cos(theta);
    vec2 xy = vec2(ct * p.x - st * p.y, st * p.x + ct * p.y) * R;
    float loose = 1.0 - bell;
    xy += TUN_SWAY * loose * vec2(sin(ph * 2.0 + uTime * 0.21), cos(ph * 1.5 - uTime * 0.17 + 1.0));
    return vec3(xy, u - TUN_SLOW * sin(d));
  }
  if (mode == 5) {
    if (abs(spin) < 1e-4) return p;
    if (spin >= 1000.0) return tilt * whirlShape(p, spin, clock);
    const float JET_THRESHOLD = ${glslFloat(ACCRETION.jetThreshold)};
    ${FALL_CONSTS}
    if (spin < 0.0) {
      float baseRadius = length(p);
      float distance = mod(baseRadius - FALL_IN - clock * FALL_SPEED, FALL_SPAN) + FALL_IN;
      float progress = (distance - FALL_IN) / FALL_SPAN;
      if (uFx.y > 0.5) {
        distance = frozenRadius(progress);
        progress = max(distance - FZ_R, 0.0) / FALL_SPAN;
      }
      float id = abs(spin);
      float amplitude = smoothstep(0.0, 0.18, progress)
        * (FALL_IN + 0.18 * FALL_SPAN) * (0.015 + 0.05 * fract(id * 9.17));
      p = curvedTransport(p, distance, id, amplitude, 1.0);
      return tilt * p;
    }
    if (spin >= 100.0) {
      float enc = spin - 100.0;
      float k = floor(enc * 0.1);
      float w = enc - k * 10.0 - 5.0;
      vec3 ax = vec3(0.0, 0.0, 1.0);
      ${STREAM_TABLE}
      float aa = w * clock;
      float ss = sin(aa);
      float cc = cos(aa);
      return tilt * (p * cc + cross(ax, p) * ss + ax * dot(ax, p) * (1.0 - cc));
    }

    float az = abs(p.z);
    // The jets: past JET_THRESHOLD, and their bases, which start at the
    // hole's centre; no disc particle comes within 4 units of the axis.
    if (az > JET_THRESHOLD || dot(p.xy, p.xy) < 16.0) {
      // Bent after the twist, so the bend holds still (jetShape).
      return jetShape(corkscrew(plumeMotion(p, spin, clock), clock), tilt);
    }
    ${WARP_CONSTS}
    float w = abs(spin) * clock;
    float sw = sin(w);
    float cw = cos(w);
    vec2 xy = vec2(cw * p.x - sw * p.y, sw * p.x + cw * p.y);
    float r = max(length(xy), 1e-3);
    float node = WARP_NODE0 + WARP_NODE1 * log(r);
    float lift = (xy.y * cos(node) - xy.x * sin(node)) / r;
    return tilt * vec3(xy, p.z * lift);
  }
  if (mode == 7) {
    if (abs(spin) < 1e-4) return p;
    vec3 q = p - pivot;
    if (spin < 0.0) {
      ${EJECT_CONSTS}
      float radius = length(q);
      float distance = mod(radius - EJECT_START + clock * EJECT_SPEED, EJECT_SPAN) + EJECT_START;
      float progress = (distance - EJECT_START) / EJECT_SPAN;
      if (uFx.y > 0.5) {
        distance = thawRadius(progress);
        progress = (distance - EJECT_START) / EJECT_SPAN;
      }
      float id = abs(spin);
      float amplitude = smoothstep(0.0, 0.15, progress)
        * distance * (0.04 + 0.075 * fract(id * 8.37));
      q = curvedTransport(q, distance, id, amplitude, 1.0);
      return tilt * (q + pivot);
    }
    float wj = whiteJet(q, spin, mode);
    q = plumeMotion(q, spin, clock);
    if (wj > 0.5) q = corkscrew(q, clock);
    return tilt * (q + pivot);
  }
  if (mode == 8) {
    if (abs(spin) < 1e-4) return p;
    if (spin < -0.5) {
      float k = -spin - 2.0;
      float W = 0.0;
      float PH = 0.0;
      float RE = 5.0;
      ${FLARE_TABLE}
      float cyc = fract(clock * GIANT_FLARE_RATE + PH);
      float burst = smoothstep(0.0, 0.05, cyc) * (1.0 - smoothstep(0.15, 0.3, cyc));
      float loft = pow(burst, 0.68);
      float base = max(length(p), 1e-4);
      vec3 n = p / base;
      vec3 q = mix(n * GIANT_R, p, loft);
      q += n * pow(max(cyc - 0.12, 0.0) * 6.0, 2.0) * RE * 0.7;
      float a1 = W * clock;
      float s1 = sin(a1);
      float c1 = cos(a1);
      return tilt * vec3(c1 * q.x + s1 * q.z, q.y, -s1 * q.x + c1 * q.z);
    }
    if (spin < 90.0) {
      float a = spin * clock;
      float s = sin(a);
      float c = cos(a);
      return tilt * vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
    }
    float enc = spin - 100.0;
    float k = floor(enc * 0.1);
    float w2 = enc - k * 10.0 - 5.0;
    vec3 ax = vec3(0.0, 1.0, 0.0);
    float W = 0.0;
      ${STORM_TABLE}
    float a2 = w2 * clock;
    float s2 = sin(a2);
    float c2 = cos(a2);
    vec3 q = p * c2 + cross(ax, p) * s2 + ax * dot(ax, p) * (1.0 - c2);
    float a1 = W * clock;
    float s1 = sin(a1);
    float c1 = cos(a1);
    return tilt * vec3(c1 * q.x + s1 * q.z, q.y, -s1 * q.x + c1 * q.z);
  }
  vec3 q = p - pivot;
  if (mode == 4) {
    float ay = spin * sin(clock * 0.42);
    float ax = spin * 0.34 * sin(clock * 0.27 + 1.1);
    float sy = sin(ay), cy = cos(ay);
    q = vec3(cy * q.x + sy * q.z, q.y, -sy * q.x + cy * q.z);
    float sx = sin(ax), cx = cos(ax);
    q = vec3(q.x, cx * q.y - sx * q.z, sx * q.y + cx * q.z);
    return tilt * (q + pivot);
  }
  float a = spin * clock;
  float s = sin(a);
  float c = cos(a);
  if (mode == 1) {
    if (spin >= 1000.0 && spin < 1400.0) return tilt * (galaxyWhirlShape(p, spin, clock) + pivot);
    if (spin >= 500.0 && spin < 700.0) {
      float enc = spin - 500.0;
      float k = floor(enc * 0.1);
      float w = enc - k * 10.0 - 5.0;
      vec3 C = vec3(0.0);
      vec3 ax = vec3(0.0, 1.0, 0.0);
      ${REACT_TABLE}
      vec3 d = q - C;
      float aa = w * clock;
      float ss = sin(aa);
      float cc = cos(aa);
      d = d * cc + cross(ax, d) * ss + ax * dot(ax, d) * (1.0 - cc);
      q = C + d;
      float ba = ${REACT_W} * clock;
      float bs = sin(ba);
      float bc = cos(ba);
      q = vec3(bc * q.x + bs * q.z, q.y, -bs * q.x + bc * q.z);
      return tilt * (q + pivot);
    }
    if (spin >= 200.0 && spin < 300.0) {
      float enc = spin - 200.0;
      float k = floor(enc * 0.1);
      float w = enc - k * 10.0 - 5.0;
      vec3 ax = vec3(0.0, 1.0, 0.0);
      ${NUCLEUS_AXES}
      float aa = w * clock;
      float ss = sin(aa);
      float cc = cos(aa);
      q = q * cc + cross(ax, q) * ss + ax * dot(ax, q) * (1.0 - cc);
      return tilt * (q + pivot);
    }
    if (spin >= 700.0 && spin < 800.0) {
      float enc = spin - 700.0;
      float k = floor(enc * 0.1);
      float w = enc - k * 10.0 - 5.0;
      vec3 C = vec3(0.0);
      ${CARRY_TABLE}
      float aa = w * clock;
      float ss = sin(aa);
      float cc = cos(aa);
      vec3 Cr = vec3(cc * C.x + ss * C.z, C.y, -ss * C.x + cc * C.z);
      return tilt * (q + Cr - C + pivot);
    }
    if (spin >= 800.0 && spin < 1000.0) {
      float enc = spin - 800.0;
      float k = floor(enc * 0.1);
      float kind = supernovaKind(spin);
      float w = enc - k * 10.0 - 5.0 - 2.0 * kind;
      vec4 site = supernovaSite(spin);
      float cyc = fract(clock * SN_RATE + site.w);
      float grow = SN_REACH * sqrt(smoothstep(0.0, SN_SPAN, cyc));
      q = site.xyz + (q - site.xyz) * (1.0 + (1.0 - kind) * grow / SN_SEED);
      float aa = w * clock;
      float ss = sin(aa);
      float cc = cos(aa);
      q = vec3(cc * q.x + ss * q.z, q.y, -ss * q.x + cc * q.z);
      return tilt * (q + pivot);
    }
    q = vec3(c * q.x + s * q.z, q.y, -s * q.x + c * q.z);
  } else if (mode == 3) {
    q = vec3(c * q.x - s * q.y, s * q.x + c * q.y, q.z);
  } else if (mode == 6) {
    q = vec3(q.x, c * q.y - s * q.z, s * q.y + c * q.z);
  }
  return tilt * (q + pivot);
}

float transportVisibility(vec3 p, float spin, int mode, float clock) {
  if (mode == 10) return stackVis(spin, clock);
  if (mode == 2) {
    ${TUNNEL_CONSTS}
    float rot = floor(spin * 0.1);
    float flow = spin - rot * 10.0 - 1.0;
    float u = mod(p.z + (0.55 + flow) * clock * 7.0 - uTunnel.x, uTunnel.y) + uTunnel.x;
    return smoothstep(-TUN_DARK.x, TUN_DARK.y, (u - uTunnel.x) * TUN_K - TUN_TPH);
  }
  if (mode == 5 && spin >= 1000.0) return whirlVis(p, spin, clock);
  if (mode == 1 && spin >= 1000.0 && spin < 1400.0) return galaxyWhirlVis(p, spin, clock);
  if (mode == 1) return (spin >= 800.0 && spin < 1000.0) ? supernovaVisibility(spin, clock) : 1.0;
  if (mode == 8) {
    if (spin > -0.5) return 1.0;
    float k = -spin - 2.0;
    float PH = 0.0;
    ${FLARE_PHASE}
    float cyc = fract(clock * ${g5(GIANT.flareRate)} + PH);
    return smoothstep(0.0, 0.035, cyc) * (1.0 - smoothstep(0.17, 0.32, cyc));
  }
  if (mode == 7 && spin < 0.0) {
    ${EJECT_CONSTS}
    float distance = mod(length(p) - EJECT_START + clock * EJECT_SPEED, EJECT_SPAN) + EJECT_START;
    float emerge = smoothstep(EJECT_START + 0.45, EJECT_START + 2.3, distance);
    if (uFx.y > 0.5) {
      distance = thawRadius((distance - EJECT_START) / EJECT_SPAN);
      emerge = smoothstep(THAW_R, THAW_R + 0.9, distance);
    }
    float leave = 1.0 - smoothstep(EJECT_START + EJECT_SPAN - 7.0, EJECT_START + EJECT_SPAN, distance);
    return emerge * leave;
  }
  if (mode != 5) return 1.0;
  ${FALL_CONSTS}
  if (spin < 0.0) {
    float radius = mod(length(p) - FALL_IN - clock * FALL_SPEED, FALL_SPAN) + FALL_IN;
    if (uFx.y > 0.5) {
      float u = (radius - FALL_IN) / FALL_SPAN;
      float x = frozenX(u);
      float h = 1.0 - clamp(x, 0.0, 1.0);
      float far = 1.0 - smoothstep(FALL_IN + FALL_SPAN - 5.5, FALL_IN + FALL_SPAN, frozenRadius(u));
      return far * (0.08 + 0.92 * h * h) * exp(min(x, 0.0) / 0.07) * step(0.5, fract(aSeed * 7.77 + 0.3));
    }
    float horizon = smoothstep(FALL_IN, FALL_IN + 1.3, radius);
    float feeder = 1.0 - smoothstep(FALL_IN + FALL_SPAN - 5.5, FALL_IN + FALL_SPAN, radius);
    float heat = 1.0 - (radius - FALL_IN) / FALL_SPAN;
    return horizon * feeder * (0.08 + 0.92 * heat * heat);
  }
  return 1.0;
}

float behindSphere(vec3 P, vec3 C, float R, float soft) {
  float dP = length(P);
  vec3 dir = P / max(dP, 1e-4);
  float b = dot(C, dir);
  float disc = b * b - (dot(C, C) - R * R);
  if (disc <= 0.0) return 0.0;
  return smoothstep(-soft, soft, dP - (b - sqrt(disc)) - soft);
}

const float GIANT_GLOW = 3.2;
float giantLimb(vec3 P, vec3 C) {
  float mu = clamp(dot(normalize(P - C), -normalize(P)), 0.0, 1.0);
  float toneFloor = 0.45 / pow(uDensity, 1.47);
  return GIANT_GLOW * mu * mix(0.6, 1.0, sqrt(mu)) * mix(toneFloor, 1.0, mu);
}

float giantSky(vec3 P, vec3 C) {
  vec3 dir = P / max(length(P), 1e-4);
  float b = length(C - dir * dot(C, dir));
  return smoothstep(0.995 * GIANT_R, 1.01 * GIANT_R, b);
}

vec3 flow(vec3 q) {
  vec3 f = vec3(sin(q.y) * cos(q.z), sin(q.z) * cos(q.x), sin(q.x) * cos(q.y));
  vec3 q2 = q * 2.31 + 1.7;
  f += 0.42 * vec3(sin(q2.y) * cos(q2.z), sin(q2.z) * cos(q2.x), sin(q2.x) * cos(q2.y));
  return f;
}

/* The pointer's stir, the one hover effect every formation shares. Inside a
   cone round the pointer ray (STIR_CONE: its half-width over its depth, so the
   patch is the same size on screen in every chapter) particles speed up and
   move around their place: a fast curl field swirls the patch as one, and
   each particle adds a quick orbit of its own. Both scale with depth, so the
   motion is the same on screen at any distance. Size and light never change. */
const float STIR_CONE = 0.06;
const float STIR_REACH = 0.008;
const float STIR_SPEED = 1.1;
vec3 touchStir(vec3 p, float seed) {
  vec3 rel = p - uPointerOrigin;
  float ax = dot(rel, uPointerDir);
  float along = max(ax, 1.0);
  vec3 off = rel - uPointerDir * ax;
  float r = STIR_CONE * along;
  float g = exp(-dot(off, off) / (r * r)) * uPointerGain;
  if (g < 1e-3) return vec3(0.0);
  float t = uTime * STIR_SPEED;
  vec3 swirl = flow(p * (1.2 / r) + vec3(t, -0.7 * t, 0.45 * t) + seed * 0.35);
  float w = 5.0 + 4.0 * fract(seed * 7.13);
  float ph = seed * 43.7;
  vec3 orbit = vec3(sin(uTime * w + ph), cos(uTime * w * 1.13 + ph * 1.7), 0.6 * sin(uTime * w * 0.87 + ph * 2.3));
  return (swirl * 0.75 + orbit * 0.5) * STIR_REACH * along * g;
}

void main() {
  float stagger = fract(aSeed * 317.71);
  float m = clamp((uMorph - stagger * uStaggerSpan) / max(1e-3, 1.0 - uStaggerSpan), 0.0, 1.0);
  float md = clamp((m - 0.12 * (1.0 - aRoleB)) / 0.88, 0.0, 1.0);
  float e = md * md * (3.0 - 2.0 * md);
  float size = mix(aAttrA.x, aAttrB.x, e);
  if (size < 1e-4) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  float role = clamp(mix(aRoleA, aRoleB, e), 0.0, 1.0);
  // The mirror pass draws only the hole's disc (not its jets, infall or
  // backdrop, nor another formation), and only MIRROR_KEEP of it.
  if (uImage > 0.5) {
    float mine = mix(mirrorable(position, aAttrA.w, uModeA), mirrorable(aPosB, aAttrB.w, uModeB), e);
    if (mine < 1e-3 || uLens.x < 1e-4 || fract(aSeed * 53.17 + 0.31) > MIRROR_KEEP) {
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
  }

  /* While e == 0 (every particle, whenever the pair is at rest) nothing of
     B reaches the output: every B term below is mixed in by e, or multiplied
     by sin(PI e) or by md, all exactly 0. So B is not evaluated at all, which
     is exact, not an approximation, and saves a shape() per particle (two
     with the shutter) and B's side of every per-mode helper. */
  bool useB = e > 0.0;
  vec3 pa = shape(position, aAttrA.w, uModeA, uTiltA, uClockA, uPivotA);
  vec3 pb = useB ? shape(aPosB, aAttrB.w, uModeB, uTiltB, uClockB, uPivotB) : pa;
  float flight = sin(PI * e);
  size *= 1.0 - flight * 0.10;

  float seedAngle = aSeed * PI * 2.0 + stagger * 5.7;
  vec2 fallback = vec2(cos(seedAngle), sin(seedAngle));
  float lane = fract(aSeed * 7.31 + stagger * 3.17);
  float polar = mix(-1.0, 1.0, fract(aSeed * 17.17 + stagger * 9.11));
  float planar = sqrt(max(0.0, 1.0 - polar * polar));
  vec3 scatter = vec3(fallback * planar, polar);
  vec3 delta = pb - pa;
  vec3 travelAxis = normalize(delta + vec3(fallback * 0.001, 0.001));
  vec3 refAxis = mix(vec3(0.0, 1.0, 0.0), vec3(1.0, 0.0, 0.0), smoothstep(0.75, 0.95, abs(travelAxis.y)));
  vec3 curveSide = normalize(cross(travelAxis, refAxis) + 0.35 * scatter + vec3(fallback * 0.001, 0.001));
  vec3 curveLift = normalize(cross(travelAxis, curveSide) + scatter * 0.001);
  float edgeRoute = smoothstep(16.0, 23.0, uArc);
  float localReach = 1.35 + uArc * 0.16;
  float edgeReach = 8.0 + uArc * 0.55;
  float reach = mix(localReach, edgeReach, edgeRoute) * (0.18 + lane * lane * 0.92);
  float handedness = uHand;
  float curve = sin(PI * e);
  float corkscrew = sin(PI * 2.0 * e + seedAngle) * curve;
  vec3 direct = mix(pa, pb, e);
  vec3 p = direct
    + curveSide * curve * reach * handedness
    + curveLift * corkscrew * reach * 0.10;

  float flightArc = sin(PI * e);
  float genesisDim = 1.0;
  if (uVortex > 1e-3) {
    float birth = smoothstep(0.5, 1.0, e);
    vec3 sky = normalize(vec3(fallback, polar * 1.4) + scatter * 0.7);
    vec3 S = mix(uPivotA, uPivotB, e) + sky * (46.0 + lane * 30.0);
    vec3 flight2 = mix(S, pb, birth * birth * (3.0 - 2.0 * birth));
    p = mix(p, mix(pa, flight2, smoothstep(0.44, 0.56, e)), uVortex);
    genesisDim = 1.0 - (smoothstep(0.30, 0.44, uMorph) - smoothstep(0.56, 0.72, uMorph)) * uVortex;
  }
  // The departing chapter's dust (chapters.js scatter, world units): in
  // flight a particle puffs out along its own random direction and back, so
  // a formation comes apart as an even cloud instead of sliding toward the
  // next one as a whole.
  if (uScatter > 1e-3) {
    p += scatter * (uScatter * (0.55 + 0.9 * fract(aSeed * 5.31)) * pow(max(flightArc, 0.0), 0.7));
  }
  if (uPinch > 1e-3) {
    vec3 core = mix(uPivotA, uPivotB, e);
    float squeeze = pow(max(flightArc, 0.0), 1.7) * uPinch * 0.92;
    p = mix(p, core, squeeze);
  }

  float dust = 1.0 - role;
  float noiseRole = 0.03 + 0.97 * dust * dust;
  vec3 q = p * uNoiseScale + uTime * uNoiseSpeed + aSeed * 0.6;
  p += flow(q) * uNoise * (0.5 + 0.8 * aSeed) * noiseRole * (1.0 + 0.35 * flight);

  // Under the pointer particles speed up and move around (touchStir): the
  // same size and light, only motion, in every formation alike.
  if (uPointerGain > 1e-3) p += touchStir(p, aSeed);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec3 holeC = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float lensK = mix(uModeA == 5 ? 1.0 : 0.0, uModeB == 5 ? 1.0 : 0.0, e) * step(1e-4, uLens.x);
  // The backdrop (spin 0) takes uLensB.x of the lens, everything else all of it.
  float lensRs = uLens.x * (abs(uModeA == 5 ? aAttrA.w : aAttrB.w) < 1e-4 ? uLensB.x : 1.0);
  float lensSense = 0.0;
  float lensGain = 1.0;
  float lensShift = 0.0;
  float jetK = mix(isJet(position, aAttrA.w, uModeA), useB ? isJet(aPosB, aAttrB.w, uModeB) : 0.0, e);
  float lensJit = fract(aSeed * 37.13 + 0.71);
  vec3 mv0 = mv.xyz;
  vec3 jetAxis = normalize((modelViewMatrix * vec4((uModeA == 5 ? uTiltA : uTiltB)[2], 0.0)).xyz);
  float jetSide = (uModeA == 5 ? position.z : aPosB.z) < 0.0 ? -1.0 : 1.0;
  if (lensK > 0.0) {
    mat3 lt = uModeA == 5 ? uTiltA : uTiltB;
    vec3 axisV = (modelViewMatrix * vec4(lt[2], 0.0)).xyz;
    lensSense = clamp(axisV.z * 4.0, -1.0, 1.0);
    float mu;
    vec3 img = lensPlace(mv.xyz, holeC, lensRs, lensSense, lensJit, jetK, true, mu, lensShift);
    if (uImage > 0.5) {
      float w;
      mv.xyz = mirrorArch(mv.xyz, img, holeC, axisV.xy, lensRs, w);
      lensGain = uLens.w * min(mu, uLens.z) * w * lensK * lensK;
    } else {
      mv.xyz = mix(mv.xyz, img, lensK);
      lensGain = mix(1.0, clamp(mu, 1.0 / uLens.z, uLens.z), lensK);
      // Where the lens packs images together (mu under uLensC.x) only that
      // share of the dots stays, faded by seed as they arrive, so the packed
      // arc keeps the disc's own density instead of piling into a line.
      float keep = clamp(mu / uLensC.x, 0.0, 1.0);
      float thr = 0.85 * fract(aSeed * 91.71 + 0.13);
      lensGain *= mix(1.0, smoothstep(thr, thr + 0.15, keep), lensK * (1.0 - jetK));
      lensShift *= lensK;
    }
  }
  float dist = -mv.z;
  gl_Position = projectionMatrix * mv;

  float coc = clamp(abs(dist - uFocus) / max(uFocusRange, 1.0), 0.0, 1.0);
  coc = coc * coc * (3.0 - 2.0 * coc);
  float grow = 1.0 + coc * uDof * 2.4 * (0.55 + 0.45 * role);
  float attenuation = mix(205.0, 245.0, 1.0 - dust);
  float px = size * uSize * uSizeScale * grow * (attenuation / max(dist, 0.75));
  // The jets' perspective, exaggerated (uJetLook.y): the near jet's dots grow
  // toward the camera, the far jet's shrink away from it.
  px *= mix(1.0, pow(max(-holeC.z, 1.0) / max(dist, 0.75), uJetLook.y), jetK);
  px = min(px, mix(52.0, 8.0, dust) * uSizeScale);
  float structure = smoothstep(0.35, 0.9, role);
  float energy = 0.25 * px * px * mix(0.960, 0.643, structure);
  float pxD = min(px, mix(2.6, 4.2, role) * sqrt(uSizeScale) * uDensity);
  float sig0 = max(SIG_MIN * uDensity, pxD / 7.2);
  float sig = max(sig0, min(8.0, sqrt(energy / (6.2832 * A_MAX))));

  vec3 d = vec3(0.0);
  if (uShutter > 0.0 && uImage < 0.5) {
    const float H = 0.045;
    vec3 va = (shape(position, aAttrA.w, uModeA, uTiltA, uClockA + H, uPivotA) - pa) / H;
    vec3 vb = useB ? (shape(aPosB, aAttrB.w, uModeB, uTiltB, uClockB + H, uPivotB) - pb) / H : vec3(0.0);
    if (dot(va, va) > 900.0) va = vec3(0.0);
    if (dot(vb, vb) > 900.0) vb = vec3(0.0);
    d = mix(va * uRateA, vb * uRateB, e) * uShutter;
  }
  if (uMorphVel * uMorphShutter > 0.0 && uImage < 0.5) {
    d += (delta + curveSide * (PI * cos(PI * e) * reach * handedness))
       * (6.0 * md * (1.0 - md) / (0.88 * max(0.05, 1.0 - uStaggerSpan))) * uMorphVel * uMorphShutter;
  }
  float L = 0.0;
  vec2 dir = vec2(1.0, 0.0);
  if (dot(d, d) > 1e-12) {
    vec4 mv2 = modelViewMatrix * vec4(p + d, 1.0);
    if (lensK > 0.0) {
      float g2;
      float s2;
      mv2.xyz = mix(mv2.xyz, lensPlace(mv2.xyz, holeC, lensRs, lensSense, lensJit, jetK, false, g2, s2), lensK);
    }
    vec4 clip2 = projectionMatrix * mv2;
    vec2 track = (clip2.xy / max(clip2.w, 1e-4) - gl_Position.xy / max(gl_Position.w, 1e-4))
               * 0.5 * uViewport;
    float trackLen = length(track);
    if (trackLen > 1e-4) dir = vec2(track.x, -track.y) / trackLen;
    L = min(trackLen, 12.0 * sqrt(uSizeScale)) * smoothstep(0.75, 1.5, trackLen);
    L *= 1.0 - lensK * smoothstep(0.15, 0.9, lensShift);
  }
  float sigL = sqrt(sig * sig + L * L / 12.0);
  float stretch = sigL / sig;
  gl_PointSize = 6.0 * sigL + 1.0;
  vSide = gl_PointSize;
  vSig = sig;
  vSigL = sigL;
  vDir = dir;
  vec2 sg2 = max(vec2(sigL * sigL, sig * sig) - SS_VAR, vec2(0.0784));
  vInv = 1.0 / sg2;

  vDepth = smoothstep(uFogNear, uFogFar, dist);
  float nearFade = smoothstep(0.0, 2.5, dist);
  float tunnelness = mix(uModeA == 2 ? 1.0 : 0.0, uModeB == 2 ? 1.0 : 0.0, e);
  float tunnelFade = pow(smoothstep(9.0, 40.0, dist), 2.5);
  nearFade = mix(nearFade, tunnelFade, tunnelness);
  // The whirlpool arms take their tint from where the flow has carried them.
  bool whA = aAttrA.w >= 1000.0 && aAttrA.w < 1400.0 && (uModeA == 5 || uModeA == 1);
  bool whB = aAttrB.w >= 1000.0 && aAttrB.w < 1400.0 && (uModeB == 5 || uModeB == 1);
  float tA = !whA ? aAttrA.y : uModeA == 5 ? whirlTint(position, aAttrA.w, uModeA, uClockA) : galaxyWhirlTint(position, uClockA);
  float tB = !whB ? aAttrB.y : uModeB == 5 ? whirlTint(aPosB, aAttrB.w, uModeB, uClockB) : galaxyWhirlTint(aPosB, uClockB);
  vTint = mix(tA, tB, e);

  float phase = mix(aAttrA.z, aAttrB.z, e);
  float wave = 0.5 + 0.5 * sin((phase * uPulseWidth - uPulseClock) * 6.2831853);
  float pulse = 1.0 + uPulse * role * pow(wave, 3.0);

  vLum = (0.34 + 0.5 * aSeed) * (1.0 - 0.12 * flight) * pulse
       * (1.0 + uPinch * pow(max(sin(PI * e), 0.0), 3.0) * 1.8);
  vLum *= 1.0 - 0.18 * dust;
  float dopp = dopplerFor(pa - uPivotA, aAttrA.w, uModeA, uTiltA);
  if (useB) dopp = mix(dopp, dopplerFor(pb - uPivotB, aAttrB.w, uModeB, uTiltB), e);
  vLum *= 1.0 + 0.3 * dopp;
  float jb = jetBase(position, uPivotA, aAttrA.w, uModeA);
  if (useB) jb = mix(jb, jetBase(aPosB, uPivotB, aAttrB.w, uModeB), e);
  vLum *= 1.0 + jb * uPulse * 0.55 * (0.5 + 0.5 * sin(uPulseClock * 6.2831853));
  vLum *= 1.0 + 0.05 * dust * sin(uClock * (1.7 + 2.8 * fract(aSeed * 3.7)) + aSeed * 41.0);
  float spk = perihelionSpark(pa, aAttrA.w, uModeA, uPivotA);
  if (useB) spk = mix(spk, perihelionSpark(pb, aAttrB.w, uModeB, uPivotB), e);
  vLum *= 1.0 + 0.55 * spk;
  float hd = holeGlow(pa - uPivotA, aAttrA.w, uModeA);
  if (useB) hd = mix(hd, holeGlow(pb - uPivotB, aAttrB.w, uModeB), e);
  vLum *= mix(hd, 1.0, jetK);
  // Relativistic beaming (uJetLook.x the jets' speed over c): the jet coming
  // toward the camera is brighter, the one going away dimmer, by the Doppler
  // factor to the 2.5.
  if (jetK > 0.0) {
    float bj = uJetLook.x;
    float cosT = jetSide * dot(jetAxis, -normalize(holeC));
    vLum *= mix(1.0, pow(sqrt(1.0 - bj * bj) / (1.0 - bj * cosT), 2.5), jetK);
    // The lower jet's light, raised (uJetMore.y) so it carries nearly as
    // much as the upper one, and more again (uJetMore.z) where it clears the
    // disc, 4 to 9 units out, so it is bright from its base and not only
    // further out.
    float jetAz = abs(uModeA == 5 ? position.z : aPosB.z);
    float early = 1.0 + uJetMore.z * smoothstep(4.0, 6.5, jetAz) * (1.0 - smoothstep(9.0, 20.0, jetAz));
    vLum *= mix(1.0, jetSide < 0.0 ? uJetMore.y * early : 1.0, jetK);
  }
  // While lensed, the disc's light rises from its inner rim instead of
  // peaking at it (a thin disc's emission vanishes at its inner edge), so the
  // rim the lens lays beside the orange ring is a soft edge, not a line.
  if (lensK > 0.0) {
    float rimR = length(uModeA == 5 ? pa - uPivotA : pb - uPivotB);
    vLum *= mix(1.0, mix(uLensC.w, 1.0, smoothstep(RIM_IN, RIM_IN * (1.0 + uLensC.z), rimR)), lensK * (1.0 - jetK));
  }
  // The seventh and eighth cuts (lib/modes.js HOLE_FX), on both holes. vHot
  // whitens a dot above 0 and warms it below, toward deep red past -1. The
  // white hole is never warmed: its receding side only dims.
  vHot = 0.0;
  if (uFx.x > 0.5) {
    float dopp5 = dopp * mix(uModeA == 5 ? 1.0 : 0.0, uModeB == 5 ? 1.0 : 0.0, e) * (1.0 - jetK);
    float dopp7 = mix(whiteDoppler(pa - uPivotA, aAttrA.w, uModeA, uTiltA),
                      useB ? whiteDoppler(pb - uPivotB, aAttrB.w, uModeB, uTiltB) : 0.0, e);
    vLum *= (1.0 + 0.25 * dopp5) * (1.0 + 0.3 * dopp7) * (1.0 + 0.25 * dopp7);
    vHot += 0.6 * clamp(dopp5 / 1.3, -1.0, 1.0) + 0.6 * clamp(dopp7 / 1.3, 0.0, 1.0);
  }
  if (uFx.z > 0.5 && jetK > 0.0) {
    float knot = uModeA == 5 ? jetKnots(position, uClockA) : jetKnots(aPosB, uClockB);
    vLum *= 1.0 + 1.8 * knot * jetK;
    vHot = max(vHot, 0.5 * knot * jetK);
  }
  float wjK = mix(whiteJet(position - uPivotA, aAttrA.w, uModeA), useB ? whiteJet(aPosB - uPivotB, aAttrB.w, uModeB) : 0.0, e);
  if (uFx.z > 0.5 && wjK > 0.0) {
    float knot = uModeA == 7 ? jetKnots(position - uPivotA, uClockA) : jetKnots(aPosB - uPivotB, uClockB);
    vLum *= 1.0 + 1.8 * knot * wjK;
    vHot = max(vHot, 0.5 * knot * wjK);
  }
  if (uFx.y > 0.5) {
    float rA = (uModeA == 5 && aAttrA.w < 0.0) ? frozenRedden(position, uClockA) : 0.0;
    float rB = (useB && uModeB == 5 && aAttrB.w < 0.0) ? frozenRedden(aPosB, uClockB) : 0.0;
    vHot -= mix(rA, rB, e);
    float hA = (uModeA == 7 && aAttrA.w < 0.0) ? thawHeat(position, uClockA) : 0.0;
    float hB = (useB && uModeB == 7 && aAttrB.w < 0.0) ? thawHeat(aPosB, uClockB) : 0.0;
    vHot += mix(hA, hB, e);
  }
  float sn = supernovaGlow(aAttrA.w, uModeA, uClockA);
  if (useB) sn = mix(sn, supernovaGlow(aAttrB.w, uModeB, uClockB), e);
  vLum *= sn;
  vSeed = aSeed;
  vCoc = coc;
  float transportAlpha = transportVisibility(position, aAttrA.w, uModeA, uClockA);
  if (useB) transportAlpha = mix(transportAlpha, transportVisibility(aPosB, aAttrB.w, uModeB, uClockB), e);
  float dustNear = mix(1.0, smoothstep(7.0, 22.0, dist), dust);
  vAlpha = (1.0 - vDepth)
         * nearFade
         * dustNear
         * transportAlpha
         / (1.0 + coc * uDof * (2.6 + 3.0 * dust));
  vAlpha *= genesisDim;
  vAlpha *= energy / (6.2832 * sqrt(sg2.x * sg2.y) * 0.975);
  vAlpha *= lensGain;
  if (jetK > 0.0) vAlpha *= mix(1.0, discShade(mv0, holeC, jetAxis), jetK);
  // Warmth falls off from the formation's centre (its pivot; only the galaxy's
  // is off the origin).
  vWarm = clamp(1.0 - length(p - mix(uPivotA, uPivotB, e)) / uWarmRadius, 0.0, 1.0);
  vNear = 0.0;
  if (uHoleR > 0.0 && uImage < 0.5) {
    vNear = 1.0 - behindSphere(mv.xyz, holeC, uHoleR, 0.25);
    // The near jet rises over the shadow from the hole's centre.
    float toward = dot(mv.xyz - holeC, -normalize(holeC));
    vNear = mix(vNear, max(vNear, smoothstep(0.3, 1.5, toward)), jetK);
    vNear *= mix(
      ((uModeA == 5 || uModeA == 7) && aAttrA.w < 0.0) ? 0.0 : 1.0,
      ((uModeB == 5 || uModeB == 7) && aAttrB.w < 0.0) ? 0.0 : 1.0,
      e);
    // The white hole has no horizon: its outflow (uFx.y) is drawn over the
    // glow from the centre out, never behind it.
    vNear = max(vNear, uFx.y * mix(uModeA == 7 && aAttrA.w < 0.0 ? 1.0 : 0.0, uModeB == 7 && aAttrB.w < 0.0 ? 1.0 : 0.0, e));
  }
  float presence8 = (uModeA == 8 ? 1.0 - uMorph : 0.0) + (uModeB == 8 ? uMorph : 0.0);
  if (presence8 > 0.0) {
    vec3 giantC = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vAlpha *= 1.0 - presence8 * behindSphere(mv.xyz, giantC, 0.94 * GIANT_R, 0.02 * GIANT_R);
    float limbA = (uModeA == 8 && abs(aAttrA.w) > 1e-4 && aAttrA.w > -0.5)
      ? giantLimb((modelViewMatrix * vec4(pa, 1.0)).xyz, giantC) : 1.0;
    float limbB = (uModeB == 8 && abs(aAttrB.w) > 1e-4 && aAttrB.w > -0.5)
      ? giantLimb((modelViewMatrix * vec4(pb, 1.0)).xyz, giantC) : 1.0;
    vLum *= mix(limbA, limbB, e);
    float skyA = (uModeA == 8 && aAttrA.w < -0.5) ? giantSky(mv.xyz, giantC) : 1.0;
    float skyB = (uModeB == 8 && aAttrB.w < -0.5) ? giantSky(mv.xyz, giantC) : 1.0;
    vAlpha *= mix(skyA, skyB, e);
  }
  if (vAlpha * uOpacity < 0.002) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    gl_PointSize = 0.0;
  }
}
`;

/* ==========================================================================
   THE PARTICLE FRAGMENT SHADER

   Runs per pixel of every particle, and its whole job is deciding what a single
   particle looks like up close. Each one is drawn as a square (gl_PointCoord
   runs 0..1 across it, vSide pixels wide) and this turns that square into one
   crisp dot.

   --- What main() does, in order ---

     1. The pixel's offset from the particle's true centre, in pixels, rotated
        into the streak direction the vertex shader worked out.
     2. The dot: a Gaussian in pixel units, sampled at four points a quarter
        pixel from the pixel centre (a 2x2 grid, rotated with the streak) and
        averaged, so the pixel receives its share of the dot's area rather than
        the value at one point. That is what keeps a dot narrower than a pixel
        from flickering as it moves: the four samples add a variance of 1/16
        px^2, which the vertex shader already took out of vInv, so the dot on
        screen is vSig across the motion and vSigL along it. Every sample past
        3 sigma is dropped, and a smooth window over the last sigma (d2 6..9)
        keeps a bright dot from showing a cut ring. The window keeps 97.5% of
        the light, which the vertex shader already put back, so a dot's total
        light is its energy wherever it sits between pixels. There is no halo:
        glow belongs to the bloom, and only to what is lit.
     3. The bokeh alternative, only while a chapter uses depth of field.
        Out-of-focus particles are drawn as hexagonal discs rather than blurred
        points, which is what a real iris does. The hexagon comes from that
        cos(mod(theta)) expression: a cheap way to get a polygon's radius as a
        function of angle. The disc fills the dot's own 3 sigma ellipse, so it
        stretches with a streak and never needs more of the quad than the dot
        does; it is normalised to the dot's energy, and `iris` cross-fades
        between the two, driven by circle-of-confusion.
     4. Colour. Base to accent by tint, then a special branch: a tint above 1.5
        escapes the two-colour palette into a mint/gold/rust ramp, which is how a
        few formations get colours the palette does not contain. Then warm mix,
        fog by depth, and a slight whitening at the centre of the dot.
     5. A tiny per-particle red/blue shift from the seed, so a mass of particles
        has faint colour variation instead of being one flat hue.

   Note there is no lighting here, and no lighting pass anywhere. Everything that
   reads as shading was baked into size and tint when the formation was built.

   The output is premultiplied and blended ONE + ONE (see the material in
   particle-system.js): colour already carries its own coverage, and
   overlapping particles sum. Alpha carries the luminance of whatever part of
   that light sits in front of a horizon (vNear), for the composite.
   ========================================================================== */
export const particleFragment = /* glsl */ `
precision highp float;

uniform vec3 uColBase;
uniform vec3 uColAccent;
uniform vec3 uColWarm;
uniform vec3 uFogColor;
uniform float uAccent;
uniform float uWarm;
uniform float uFogTint;
uniform float uBokeh;
uniform float uOpacity;

varying float vTint;
varying float vAlpha;
varying float vLum;
varying float vWarm;
varying float vCoc;
varying float vDepth;
varying float vSeed;
varying float vSide;
varying float vSig;
varying float vSigL;
varying vec2 vDir;
varying float vNear;
varying vec2 vInv;
varying float vHot;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

// Base to accent by tint, the escape ramp, warmth, fog.
vec3 particleColour() {
  vec3 col = mix(uColBase, uColAccent, clamp(vTint * uAccent, 0.0, 1.0));
  if (vTint > 1.5) {
    float h = clamp(vTint - 2.0, 0.0, 1.0);
    vec3 mint = vec3(0.58, 0.93, 0.84);
    vec3 gold = vec3(1.0, 0.84, 0.58);
    vec3 rust = vec3(1.0, 0.63, 0.5);
    col = h < 0.34 ? mix(uColAccent, mint, h / 0.34)
        : h < 0.67 ? mix(mint, gold, (h - 0.34) / 0.33)
        : mix(gold, rust, (h - 0.67) / 0.33);
  }
  float wAmt = clamp(uWarm * vWarm, 0.0, 1.0);
  vec3 viaBase = mix(col, uColBase, wAmt * 0.55);
  col = mix(viaBase, uColWarm, wAmt);
  if (vHot > 0.001) {
    col = mix(col, vec3(1.0), min(vHot, 1.0) * 0.7);
  } else if (vHot < -0.001) {
    vec3 ember = mix(uColWarm, uColWarm * uColWarm, clamp(-vHot - 1.0, 0.0, 1.0));
    col = mix(col, ember, min(-vHot, 1.0) * 0.8);
  }
  col = mix(col, uFogColor, vDepth * uFogTint);
  return col;
}

void main() {
  vec2 pp = (gl_PointCoord - 0.5) * vSide;
  vec2 q = vec2(dot(pp, vDir), dot(pp, vec2(-vDir.y, vDir.x)));
  vec2 su = 0.25 * vec2(vDir.x + vDir.y, vDir.x - vDir.y);
  vec2 sv = 0.25 * vec2(vDir.x - vDir.y, -vDir.x - vDir.y);
  vec2 s0 = q + su;
  vec2 s1 = q - su;
  vec2 s2 = q + sv;
  vec2 s3 = q - sv;
  vec4 d2 = vec4(dot(s0 * s0, vInv), dot(s1 * s1, vInv), dot(s2 * s2, vInv), dot(s3 * s3, vInv));
  vec2 qn = vec2(q.x / vSigL, q.y / vSig);
  float de2 = dot(qn, qn);
  if (min(min(d2.x, d2.y), min(d2.z, d2.w)) > 9.0 && de2 > 9.0) discard;
  vec4 g = exp(-0.5 * d2) * (1.0 - smoothstep(6.0, 9.0, d2));
  float core = 0.25 * (g.x + g.y + g.z + g.w);
  float iris = clamp(uBokeh * vCoc, 0.0, 1.0);
  float shape = core;
  if (iris > 0.001) {
    float r = sqrt(de2) / 3.0;
    float th = atan(qn.y, qn.x) + 0.3;
    float hexEdge = 0.8660254 / cos(mod(th, 1.0471976) - 0.5235988);
    float rh = r / mix(1.0, hexEdge * 0.92, iris * 0.9);
    float disc = (1.0 - smoothstep(0.6, 1.0, rh)) * (0.36 + 0.3 * smoothstep(0.38, 0.9, rh));
    float ai = 0.9 * iris;
    float k2 = (1.0 - ai) * (1.0 - ai) + 1.6718 * ai * (1.0 - ai) + 0.7 * ai * ai;
    disc *= 6.2832 * 0.975 * inversesqrt(vInv.x * vInv.y) / (9.0 * vSig * vSigL * 0.959 * k2);
    shape = mix(core, disc, iris);
  }

  float a = shape * vAlpha * uOpacity;

  vec3 col = particleColour();
  col = mix(col, vec3(1.0), exp(-0.5 * de2) * 0.16 * (1.0 - iris));
  float jit = vSeed * 2.0 - 1.0;
  col *= vec3(1.0 + jit * 0.03, 1.0, 1.0 - jit * 0.03);

  vec3 lit = col * vLum * a;
  gl_FragColor = vec4(lit, vNear * dot(lit, LUMA));
}
`;
