
// How the vertex shader animates a formation once it is in place.
export const MODE = Object.freeze({
  STILL: 0,
  SPIN_Y: 1,
  FLOW_Z: 2,
  SPIN_Z: 3,
  ROCK_Y: 4,
  ACCRETION: 5,
  SPIN_X: 6,
  OUTFLOW: 7,
  ORBIT: 8,
  STACK: 10,
});

// How a formation used to react to the pointer. Retired (2026-10-03): every
// formation now speeds up and moves around under the pointer alike
// (shaders/particles.js touchStir), and the shader no longer reads a formation's `touch` metadata
// (uTouchA / uTouchB are still bound, unused). Kept so the metadata parses.
export const TOUCH = Object.freeze({
  REPEL: 0,
  SWIRL: 1,
  ATTRACT: 2,
  DENT: 3,
  GUST: 4,
  RIPPLE: 5,
  IONIZE: 6,
  SURGE: 7,
  BURST: 8,
  PULSE: 9,
  STATIC: 10,
  SCRAMBLE: 12,
});

/* ── The gas giant ────────────────────────────────────────────────────────

   MODE.ORBIT belongs entirely to formations/planetary.js: one massive luminous
   proto-star, rendered from nothing but points. Everything the body does after
   it is baked is driven by the tables below, and both sides read them.
   planetary.js uses them at bake time to place cloud, storm and flare
   particles; shaders/particles.js splices them into GLSL so the same numbers
   move those particles every frame. Change one here and both follow. */
export const GIANT = Object.freeze({
  radius: 15.0,
  // Axial tilt, applied as the formation's tilt matrix. Only the rotating
  // populations get it; the view-locked limb, corona and star field are baked
  // in world space and skip it (their spin is 0, which the shader passes
  // through untouched).
  tilt: { x: -0.26, z: 0.19 },
  // Eruption cycles per unit of formation clock, shared by every flare site.
  flareRate: 0.05,
});

/* The zonal wind profile: angular rate about the spin axis as a function of
   sin(latitude), sampled at 17 evenly spaced knots from the south pole (-1) to
   the north pole (+1). The alternation is the point — neighbouring knots are
   fast and slow jets, so the cloud deck shears against itself and a storm at
   one latitude slowly laps a storm at the next. The equator super-rotates.

   Cloud particles get their own knot-interpolated rate baked into `spin`, so
   the differential rotation costs the shader nothing. Flares read the same
   curve through the generated GLSL below, which is why an eruption drifts with
   the band it came out of instead of with the body as a whole. */
export const GIANT_JETS = Object.freeze([
  0.086, 0.104, 0.152, 0.121, 0.186, 0.148, 0.223, 0.181, 0.298,
  0.192, 0.236, 0.158, 0.201, 0.134, 0.163, 0.112, 0.092,
]);

export function zonalRate(sinLat) {
  const n = GIANT_JETS.length - 1;
  const t = Math.min(n, Math.max(0, (sinLat + 1) * 0.5 * n));
  const i = Math.min(n - 1, Math.floor(t));
  const f = t - i;
  return GIANT_JETS[i] + (GIANT_JETS[i + 1] - GIANT_JETS[i]) * f;
}

/* Long-lived vortices. `lat`/`lon` place the storm on the body in radians, `r`
   is its radius in body units, `w` the peak swirl rate at its core, and `share`
   its slice of the storm particle budget.

   There are deliberately none at the poles. A polar cyclone is centred on the
   rotation axis, so the shader rotates it about its own centre and it never
   moves on screen; it lands on the polar hood, which is the dimmest part of
   the deck; and being collar-weighted it is a ring. A stationary bright ring
   on the dimmest part of the limb reads as a hoop floating beside the disc,
   not as weather. The deck's own polar hood carries the poles instead. */
export const GIANT_STORMS = Object.freeze([
  { lat: -0.30, lon: 1.15, r: 3.35, w: 0.30, sense: 1, tint: 2.95, lum: 1.0, share: 0.36 },
  { lat: 0.52, lon: -1.90, r: 2.10, w: 0.34, sense: -1, tint: 2.60, lum: 0.95, share: 0.21 },
  { lat: -0.62, lon: 2.60, r: 1.55, w: 0.38, sense: 1, tint: 2.5, lum: 1.1, share: 0.14 },
  { lat: 0.24, lon: 2.95, r: 1.25, w: 0.40, sense: -1, tint: 2.78, lum: 0.9, share: 0.11 },
  { lat: -0.14, lon: -0.55, r: 1.05, w: 0.42, sense: 1, tint: 2.54, lum: 0.95, share: 0.08 },
  { lat: 0.78, lon: 0.35, r: 1.35, w: 0.33, sense: -1, tint: 2.88, lum: 0.85, share: 0.10 },
]);

/* Eruption sites. `phase` offsets each one in the shared flare cycle so they
   fire in turn rather than together — the active part of the cycle is about
   three tenths of it, which with twenty-one sites keeps six or so erupting
   at any moment (the ones at the limb show); `reach` is how far the plume throws in body units
   and `curl` how far the zonal wind bends it over. Bend matters: a plume that
   only rises reads as a spike stuck to the limb rather than as an arc. */
export const GIANT_FLARES = Object.freeze([
  { lat: 1.11, lon: -3.14, phase: 0.000, reach: 5.7, curl: 0.50 },
  { lat: 0.98, lon: -0.74, phase: 0.381, reach: 10.0, curl: -1.05 },
  { lat: 0.82, lon: 1.66, phase: 0.762, reach: 7.6, curl: 0.83 },
  { lat: 0.69, lon: -2.22, phase: 0.143, reach: 11.9, curl: -0.61 },
  { lat: 0.58, lon: 0.18, phase: 0.524, reach: 9.5, curl: 1.16 },
  { lat: 0.47, lon: 2.58, phase: 0.905, reach: 6.9, curl: -0.94 },
  { lat: 0.37, lon: -1.31, phase: 0.286, reach: 11.2, curl: 0.72 },
  { lat: 0.28, lon: 1.09, phase: 0.667, reach: 8.8, curl: -0.50 },
  { lat: 0.18, lon: -2.79, phase: 0.048, reach: 6.3, curl: 1.05 },
  { lat: 0.09, lon: -0.39, phase: 0.429, reach: 10.7, curl: -0.83 },
  { lat: 0.00, lon: 2.01, phase: 0.810, reach: 8.1, curl: 0.61 },
  { lat: -0.09, lon: -1.87, phase: 0.190, reach: 5.7, curl: -1.16 },
  { lat: -0.18, lon: 0.53, phase: 0.571, reach: 10.0, curl: 0.94 },
  { lat: -0.28, lon: 2.93, phase: 0.952, reach: 7.6, curl: -0.72 },
  { lat: -0.37, lon: -0.96, phase: 0.333, reach: 11.9, curl: 0.50 },
  { lat: -0.47, lon: 1.44, phase: 0.714, reach: 9.5, curl: -1.05 },
  { lat: -0.58, lon: -2.44, phase: 0.095, reach: 6.9, curl: 0.83 },
  { lat: -0.69, lon: -0.04, phase: 0.476, reach: 11.2, curl: -0.61 },
  { lat: -0.82, lon: 2.36, phase: 0.857, reach: 8.8, curl: 1.16 },
  { lat: -0.98, lon: -1.52, phase: 0.238, reach: 6.3, curl: -0.94 },
  { lat: -1.11, lon: 0.88, phase: 0.619, reach: 10.7, curl: 0.72 },
]);

/* The per-particle `spin` attribute is overloaded. Below 90 it is a literal
   angular rate; from 100 up it is a tag the shader decodes back into "which
   body does this particle belong to", with the rate packed into the fractional
   part. Bands: 100+ giant storms, 200+ nucleus shells, 500+ reaction planes.
   Negative values below -0.5 are the second tag space, currently the giant's
   flare sites. It saves spending a whole extra attribute on a small enum.
   In mode 5 (the black hole) 1000+ are the whirlpool arms. */
export const stormSpin = (index, rate) => 100 + index * 10 + 5 + rate;
export const flareSpin = (index) => -(2 + index);

// Eight electron shells for the nucleus, each tumbling about its own axis. The
// axes are pre-normalised and irregular on purpose: evenly spaced ones would
// visibly line up as the shells rotate through each other.
export const NUCLEUS_SHELLS = Object.freeze([
  { axis: [0, 1, 0], rate: 0.6 },
  { axis: [0, 0.4226, 0.9063], rate: -0.42 },
  { axis: [0.8829, 0.4695, 0], rate: 0.3 },
  { axis: [-0.7295, 0.4997, 0.4597], rate: 0.5 },
  { axis: [0.3497, 0.3497, -0.8692], rate: -0.34 },
  { axis: [-0.5507, 0.7209, -0.4205], rate: 0.46 },
  { axis: [0.6194, 0.1998, 0.7592], rate: -0.55 },
  { axis: [-0.15, 0.8997, 0.4099], rate: 0.38 },
]);
export const nucleusOrbitSpin = (shell, rate) => 200 + shell * 10 + 5 + rate;

// The nucleus molecule's slow yaw, in radians per unit of formation clock:
// the nucleons spin at it, and the shader turns every orbit-tagged electron
// (the 500+ band below) with the body at the same rate. 0.19 (half the old
// 0.38, one turn in about 55 s at clockRate 0.6) keeps the fastest structure,
// the lone pairs on the outer oxygens, near 3 px per frame at 4K with the
// halved orbit rates in formations/nucleus.js.
export const REACT_BODY_SPIN = 0.19;
// Orbital planes for the nucleus formation. Each plane is a centre plus the axis
// its ring of electrons spins about. Still named REACT_* because the formation
// is a molecule caught mid-reaction and the shader decodes the same names; the
// generator was called `reactants` until the scene id and the module name were
// collapsed onto one.
export const REACT_PLANES = Object.freeze([
  { centre: [0, 3.4892, -0.7137], axis: [0, 0.9797, -0.2004] },
  { centre: [-3.3702, -0.8723, -0.7137], axis: [-0.9484, -0.2455, -0.2008] },
  { centre: [4.0235, 0.1871, -1.1231], axis: [0.9622, 0.0448, -0.2685] },
  { centre: [-0.882, -3.087, 2.723], axis: [-0.2095, -0.7332, 0.6468] },
  { centre: [9.871, 1.0875, -2.008], axis: [0.9245, 0.3617, 0.1206] },
  { centre: [-0.246, -7.213, 6.165], axis: [0.7687, -0.526, 0.3641] },
  { centre: [0, 6.9784, -1.4274], axis: [1, 0, 0] },
  { centre: [-6.7405, -1.7446, -1.4274], axis: [0.199, -0.895, 0.398] },
  { centre: [8.047, 0.374, -2.246], axis: [0, 0.929, 0.371] },
  { centre: [-1.764, -6.174, 5.446], axis: [0.995, 0.1, 0] },
  { centre: [11.695, 1.801, -1.77], axis: [-0.365, 0.931, 0] },
  { centre: [1.272, -8.252, 6.884], axis: [0.565, 0.825, 0] },
]);
export const reactOrbitSpin = (plane, rate) => 500 + plane * 10 + 5 + rate;

// The twin jets fired along the spin axis of the black and white holes.
// start: where the black hole's shadow ends along the tilted axis (the
// drawn shadow is 0.72 of the 6.2 sphere), plus the jet's own radius at its
// base; also where JET_BEND starts. Both holes pass their own start and fade
// their jets in: the black hole's rise from its centre (1.2), the white
// hole's from near its kernel.
export const BIPOLAR_PLUME = Object.freeze({
  start: 5.2,
  end: 39.5,
  spin: 0.065,
});

// Black hole: matter spirals inward. Particles further out than jetThreshold
// join the jet instead of the disc.
export const ACCRETION = Object.freeze({
  jetThreshold: 4.0,
  jetStart: BIPOLAR_PLUME.start,
  jetSpan: BIPOLAR_PLUME.end - BIPOLAR_PLUME.start,
  // The capture radius sits just outside the disc's inner rim (0.82 of the
  // 6.2 sphere since the fifth cut, 2026-10-03), so the infall reaches the
  // light it feeds.
  infallIn: 5.6,
  infallSpan: 31.0,
  infallSpeed: 2.6,
  /* The disc is a warped, puffed sheet, not a plane (2026-09-29). A rotating
     disc particle's baked z is not a height: it is the AMPLITUDE of its bob
     about the disc plane, and the shader (mode 5) lifts it to
       z = z0 * sin(azimuth - node(r)),   node(r) = warpNode0 + warpNode1 ln r
     as it orbits. Every particle therefore rides its own inclined orbit (the
     inclination atan(z0 / r), the node line shared by radius), the orbits
     cross above and below the plane, and the surface they trace is a fixed
     warp the material flows through, which is why it never winds up under
     the disc's differential rotation. formations/blackhole.js bakes amplitudes
     with these numbers in mind: the inner torus is thick, the outer skirt
     lifts into an S-warp whose node line twists with the radius, its
     amplitude growing from `warpFrom` outward (blackhole.js warpH, and the
     whirlpool arms in shaders/effects.js). */
  warpNode0: 0.9,
  warpNode1: 1.4,
  warpFrom: 10.5,
});

/* The hole's lens (sixth cut, 2026-10-03). Every particle of the black hole
   is drawn where its light reaches the camera past a Schwarzschild hole whose
   shadow is the one the composite draws (shaders/particles.js holeImage, the
   exact image radii in lib/lens-table.js), and drawn a second time at its
   secondary image, the light that went round the other side (the mirror
   pass, particle-system.js). The mass is not a knob: it is fixed by the
   drawn aperture, which is the critical curve, and scaled by the chapters'
   `lensing`, which arrives with the geometry (SCENE_LINKED).
     drag       frame dragging: an image whose light passed behind the hole
                turns about it in the disc's sense by this many radians at the
                shadow's edge, falling as (b_c / b)^dragPower
     gain       the most light a lensed dot takes or loses (its magnification
                is clamped to [1 / gain, gain]; higher piles light into knots)
     mirror     the light of the mirror arch: the arch the lens lifts over the
                shadow, reflected across the disc's line so it shows under the
                shadow too (60% of its dots)
     mirrorLift how far the lens must have lifted a dot (1 - its unlensed
                radius over its image's) for it to join the mirror arch
     pack       where the lens packs images (magnification under this), only
                that share of the dots stays, so the far side's inner edge
                keeps the disc's density instead of piling into a line
     edge       those packed images are scattered outward by up to this many
                shadow radii (per particle), a soft inner edge to the arch
     rimSoft    while lensed, the disc's light rises from rimFloor at its inner
     rimFloor   rim to full over this fraction of the rim's radius, instead
                of peaking at the rim (a thin disc's emission vanishes at its
                inner edge), so the rim beside the orange ring is soft
     jetLens    the share of the lens the jets take (all of it: the near jet,
                in front of the hole, barely moves; the far jet's base is laid
                round the shadow's rim and the rest pushed out)
     sky        how much of the lens the backdrop takes (its stars are lensed
                as the camera moves past the hole; it has no mirror image)
   particle-system.js copies this table (ParticleSystem.lens), so a harness or
   the console can try other values live. */
export const HOLE_LENS = Object.freeze({
  drag: 0.5,
  dragPower: 3.0,
  gain: 2.0,
  mirror: 1.0,
  mirrorLift: 0.3,
  sky: 1.0,
  jetLens: 1.0,
  pack: 0.8,
  edge: 0.3,
  rimSoft: 0.3,
  rimFloor: 0.2,
});

/* The black hole's jets (shaders/particles.js jetShape, mode 5). They rise
   from the hole's centre along the disc's spin axis (BLACK_HOLE_TILT), so
   they lean with the disc and run in depth, then, past the shadow, turn back
   toward the screen's vertical: the centreline's sideways slope in the disc's
   own frame grows from 0 at BIPOLAR_PLUME.start (5.2) to `turn` at `end`
   (slowly, then strongly) and holds, so beyond `end` each jet runs straight
   up or down and leaves the frame near the middle of the top or bottom edge.
   -0.38 about cancels the axis's 26 degree lean from the Stack and Hobbies
   cameras. The two jets turn opposite ways, one S through the hole, and the
   cross-section turns with the curve so each keeps its width. `angle` turns
   the bend from the disc's x axis toward its -y axis (keep it small: -y also
   points down the screen). Applied after the shader's twist, so it holds
   still. The depth cues (shaders/particles.js main):
     beam   the jets' speed over c: relativistic beaming makes the jet coming
            toward the camera brighter and the far one dimmer (Doppler factor
            to the 2.5; about 1.9 to 1 here)
     depth  the jets' perspective exaggerated: dot size times (D_hole / D)
            to this power, on top of the camera's own perspective
     shade  the disc's opacity to the far jet (discShade): it comes out from
            behind the disc instead of from the shadow's rim
     lift   the upper jet moved out along the axis by this many units, bend
            and all, so its base is at the disc and not over the shadow
     lower  the lower jet's light against the beaming's (it also has 35%
            more particles and 0.7 of the width, formations/blackhole.js),
            so it is nearly as dense and bright as the upper one
     early  extra light on the lower jet where it clears the disc (4 to 9
            units out, fading by 20), so it is bright from its base */
export const JET_BEND = Object.freeze({
  turn: -0.38,
  angle: -0.2,
  end: 16.0,
  beam: 0.3,
  depth: 1.0,
  shade: 0.6,
  lift: 3.0,
  lower: 1.5,
  early: 0.8,
});

/* The black hole's seventh cut (2026-10-03): three additions, each a switch
   (0 or 1). particle-system.js copies this table (ParticleSystem.fx), so the
   console can turn one off to compare
   (__cvUniverse.experience.particles.fx.doppler = 0).
     doppler   the side of the disc coming toward the camera white-hot and
               brighter, the receding side warm (shaders/particles.js, vHot),
               and the photon ring brightest on the approaching side, dim on
               the receding one (shaders/post.js, uCrescent)
     frozen    frozen infall: matter falling in slows, reddens and dims at the
               shadow instead of vanishing into it (frozenRadius,
               frozenRedden); half the cloud is dropped, by seed
     corkscrew the jets precess: the nozzle turns round a small cone and each
               dot keeps the direction it left in, so each jet is a widening
               helix, with three knots running up it (corkscrew, jetKnots)
   Each also runs on the white hole (the eighth cut), which is never warmed:
     doppler   its disc, arms and shells whiter and brighter on the side
               coming toward the camera, dimmer on the other (whiteDoppler),
               and its glow's halo brighter on that side (uCrescent.zw)
     frozen    its outflow comes from the centre: born at 0.3 units and drawn
               over the glow, never behind it (a white hole has no horizon),
               slow at first and speeding up outward, white-hot as it leaves
               (thawRadius, thawHeat)
     corkscrew the same helix and knots on its plumes (whiteJet) */
export const HOLE_FX = Object.freeze({
  doppler: 1,
  frozen: 1,
  corkscrew: 1,
});

/* Tilted rings round the black hole: debris rings on their own inclined
   planes (22 to 55 degrees to the disc), each turning about its own normal
   (mode 5, spin 100 + 10 k + 5 + rate; the shader decodes the plane from this
   table). Normals in the disc's own frame, before BLACK_HOLE_TILT, and
   pre-normalised. */
export const ACCRETION_STREAMS = Object.freeze([
  { axis: [-0.1873, -0.3244, 0.9272] },
  { axis: [0.2868, -0.4968, 0.8192] },
  { axis: [-0.7178, -0.1923, 0.6691] },
  { axis: [0.6428, 0.2339, 0.7295] },
  { axis: [-0.2, 0.6, 0.7746] },
]);
export const streamSpin = (k, rate) => 100 + k * 10 + 5 + rate;

// White hole: the same machinery with the sign flipped, matter streaming out.
export const OUTFLOW = Object.freeze({
  ejectStart: 1.2,
  ejectSpan: 49.0,
  ejectSpeed: 2.0,
});

/* The wormhole's tube (mode 2, FLOW_Z). Particles recycle through the z extent
   [zMin, zMin + length]: one that passes zMin wraps back to the far end, which
   is what makes the tunnel endless from a finite number of points.

   Since 2026-09-29 the tube is a shape the flow passes THROUGH rather than a
   shape each layer carries along. formations/wormhole.js bakes a straight
   cylinder in tube space (xy at `radius`, z the position along the length),
   and the shader deforms it by the depth a particle has flowed to, so
   everything below is a fixed feature of the tunnel and material compresses,
   twists and slows as it passes:
     radius, swell    the wall's radius at the mouth, and a slow irregular
                      swell about it (two whole waves over the length)
     throat, throatAt the wall pinches to `throat` of its radius at `throatAt`
                      of the length (a periodic bell, power `throatSharp`)
     twist            whole turns the cross-section turns over the length,
                      plus `twistThroat` turns gathered round the throat and
                      given back opposite it, so a particle's path is a helix
                      that spins up through the throat and runs nearly
                      straight near the mouth
     slow             the display z lags the flow by slow * sin(phase from
                      the throat): the flow slows and packs through the
                      throat, races and thins past it
     sway             the axis wanders by this much far from the throat,
                      anchored at it, on the page clock
     darkBeyond,      the tube is dark beyond its throat: a particle is
     lightBy          hidden `darkBeyond` units past it and fully lit
                      `lightBy` units in front of it, so the far half no
                      longer piles into a still ring round the centre and
                      the flow comes out of the dark at the throat
                      (shaders/particles.js transportVisibility)
   Everything is periodic over the length, so the wrap stays seamless. The
   per-particle `spin` in mode 2 packs a flow speed with a rotation rate:
   tunnelSpin(flow, rot) below, rot 0..9 turning the particle rigidly at
   (rot - 5) * 0.015 rad per unit of clock (5 is still), flow the speed offset
   the old encoding used ((0.55 + flow) * 7 per unit of clock; -0.55 is a
   particle that does not flow). */
export const TUNNEL = Object.freeze({
  zMin: -220,
  length: 260,
  radius: 19,
  swell: 0.09,
  throat: 0.52,
  throatAt: 0.5,
  throatSharp: 8,
  twist: 1,
  twistThroat: 0.8,
  slow: 11,
  sway: 0.8,
  darkBeyond: 14,
  lightBy: 25,
});
export const tunnelSpin = (flow, rot = 5) => rot * 10 + 1 + flow;
export const TUNNEL_STILL = -0.55;


/* ── The call stack tower ─────────────────────────────────────────────────

   MODE.STACK belongs to formations/code.js callgraph (built in code-kit.js
   stackPlan): the program's call stack as a tower of frames, each a floating
   slab of code (its function's signature, a local, its return address).
   main sits at the base for good; the rest are pushed and popped in the
   order a run of the program calls them (a depth-first walk of STACK_TREE),
   so the tower grows to main, evolve, gravity, collide and falls back, over
   and over. A pushed frame drops onto the stack turning into place; a popped
   one lifts off and comes apart. Both sides read these tables: code-kit.js
   writes every frame in its own coordinates, shaders/particles.js places,
   moves and fades it by the schedule.

   The `spin` tags, in mode 10 only:
     below 999        still, in world space (the sky)
     6000 + 100 f     a particle of frame f, in the frame's own coordinates
                      (centre at the origin, unturned)
     7000             the stack's fixed furniture (spine, addresses, base)
     7100             the stack pointer: it rides up and down with the depth */
export const STACK_PIVOT = Object.freeze([0, -0.2, 0]);
export const STACK_GEOM = Object.freeze({ y0: -5.4, dy: 3.35, spineX: -11.4, H: 2.4, D: 0.9 });
const STACK_TREE = [
  ['main', null], ['big_bang', 'main'], ['inflate', 'big_bang'], ['seed', 'big_bang'],
  ['alive', 'main'], ['entropy', 'alive'],
  ['evolve', 'main'], ['radiate', 'evolve'], ['gravity', 'evolve'], ['collide', 'gravity'],
];
// Schedule units: TR for a push or a pop, a leaf held HOLD, PAUSE before a
// frame's first call and after its last, GAP between its calls, BETWEEN
// main's calls. One unit is 0.9 s at the full score's clock rate of 0.6.
export const STACK_TIME = (() => {
  const TR = 1, HOLD = 1.6, PAUSE = 0.4, GAP = 0.35, BETWEEN = 0.9;
  const frames = STACK_TREE.map(([id, parent]) => ({ id, parent, level: 0, push: -1e4, pop: 1e4 }));
  const byId = Object.fromEntries(frames.map((f) => [f.id, f]));
  frames.forEach((f) => { for (let q = f; q.parent; q = byId[q.parent]) f.level++; });
  let t = 0.8;
  const visit = (f) => {
    f.push = t;
    t += TR;
    const kids = frames.filter((c) => c.parent === f.id);
    if (!kids.length) t += HOLD;
    else {
      t += PAUSE;
      kids.forEach((c, i) => { if (i) t += GAP; visit(c); });
      t += PAUSE;
    }
    f.pop = t;
    t += TR;
  };
  frames.filter((c) => c.parent === 'main').forEach((c, i) => { if (i) t += BETWEEN; visit(c); });
  return Object.freeze({ frames, tr: TR, period: t + 1.2, rate: 1 / (0.9 * 0.6) });
})();
export const STACK_FRAMES = STACK_TIME.frames;
// Each level's frame centre (about the pivot) and turn about y: the tower
// steps back and twists as it rises.
const LEVEL_X = [0, 0.7, -0.5, 0.9];
const LEVEL_Z = [0, -1.0, -2.2, -3.1];
const LEVEL_YAW = [-0.14, 0.16, -0.1, 0.22];
export const stackCentre = (L) => [LEVEL_X[L], STACK_GEOM.y0 + STACK_GEOM.dy * L, LEVEL_Z[L]];
export const stackYaw = (L) => LEVEL_YAW[L];

/* ── The whirlpool's named clusters ─────────────────────────────────────────

   formations/galaxy.js puts three star clusters in the disc's interarm gaps,
   each with a project's name beside it. They ride the disc's rotation
   without turning: shaders/particles.js (mode 1, spin 700 + 10 k + 5 + rate)
   moves each particle with its cluster's anchor, turned about the galaxy's
   axis like the disc, so the name keeps facing the camera. Anchors are about
   the galaxy's pivot, in its untilted frame; y lifts them off the disc. */
export const GALAXY_CARRIED = Object.freeze([
  { name: 'rift', at: [9.43, 0.9, 11.87] },
  { name: 'seal', at: [-10.22, 0.9, 1.43] },
  { name: 'tiny', at: [7.86, 0.9, -4.38] },
]);
export const galaxyCarrySpin = (k, rate) => 700 + k * 10 + 5 + rate;

/* Supernovae in the whirlpool (formations/galaxy.js, 2026-09-30). Twelve
   sites along the arms, in the disc frame about the pivot. Each is baked as
   a progenitor star (kind 1) and a remnant shell (kind 0) of radius `seed`
   about the site; the shader (mode 1, spin 800 + 10 k + 5 + 2 kind + rate)
   runs one shared cycle offset by each site's phase: the star flashes white
   and decays, the shell is driven out to `reach` over the first `span` of the
   cycle and hidden for the rest, so at any moment one or two remnants are
   lit somewhere in the arms and the other sites are single faint stars.
   `rate` is the cycle's frequency per clock unit (a period of 24). */
export const GALAXY_SUPERNOVAE = Object.freeze({
  rate: 1 / 24,
  span: 0.4,
  seed: 0.05,
  reach: 1.7,
  sites: [
    { at: [-4.36, 0, 2.91], phase: 0.13 },
    { at: [-6.23, 0.04, -2.33], phase: 0.748 },
    { at: [-5.78, -0.06, -6.16], phase: 0.366 },
    { at: [-3.27, 0.03, -9.73], phase: 0.984 },
    { at: [7.15, 0.01, -10.89], phase: 0.602 },
    { at: [14.7, -0.05, -8.35], phase: 0.22 },
    { at: [5.12, 0.06, -2.67], phase: 0.838 },
    { at: [5.86, -0.02, 4.41], phase: 0.456 },
    { at: [4.39, -0.03, 8.21], phase: 0.074 },
    { at: [0.6, 0.06, 11.3], phase: 0.692 },
    { at: [-9.78, -0.05, 10.53], phase: 0.31 },
    { at: [-18.23, 0.01, 3.88], phase: 0.928 },
  ],
});
export const supernovaSpin = (k, kind, rate) => 800 + k * 10 + 5 + 2 * kind + rate;

/* ── The whirlpool arms (fourth cut, 2026-09-30) ────────────────────────────

   The white hole's arms, run inward. Seven arms leave the rim of the black
   hole's disc as jittered bands along one logarithmic spiral each, evenly
   phased and all wound the same way, so they never cross; the scatter stays
   across the arm. Their material streams inward along them: each particle's
   place along its arm runs from the rim (rOut) to the torus (rIn) over
   `period` clock units, uniformly in log radius, so the beads are even along
   the spiral and crowd toward the hole, where the light is (energy falls as
   (rIn / r)^fall). The arms turn as one pattern at `pattern` (turned
   differentially they would wind into rings), they rise out of the skirt at
   the rim and dissolve into the torus at the inside, so no ring of arm ends
   marks an edge. Mode 5 only: spin 1000 + k for arm k; position carries the
   particle's place along the arm (0 to 1, where it stands at clock 0), its
   offset across the arm (-1 to 1) and its height. */
export const WHIRL = Object.freeze({
  arms: 7,
  rIn: 5.3,
  rOut: 27.0,
  pitch: -3.0,
  period: 28.0,
  pattern: 0.012,
  phase: 0.9,
  fall: 0.6,
});
export const whirlSpin = (k) => 1000 + k;

/* The whirlpool's arms (formations/galaxy.js), shared with the shader: arm k's
   angle at radius r is a0 + k pi + pitch ln(r / r0) plus a wiggle. */
export const GALAXY_ARMS = Object.freeze({ pitch: 2.7, r0: 2.2, a0: 0.4, pattern: 0.04 });

/* The whirlpool's inflow (fourth cut, 2026-09-30): the white hole's arms run
   inward, laid on the whirlpool's own two arms. Each arm carries a bright
   spine of light on its convex side, out of the lane, streaming inward along
   the arm from the rim to the nucleus, uniformly in log radius, so the beads
   are even along the spiral and crowd toward the core; it rises out of the
   outer disc and dissolves into the nucleus, so no end marks an edge. Mode 1,
   spin 1000 + k for arm k; position carries the particle's place along the arm
   (0 to 1, where it stands at clock 0), its offset across the arm (-1 to 1)
   and its height. */
export const GALAXY_WHIRL = Object.freeze({ rIn: 0.5, rOut: 21.0, period: 44.0, pool: 3.0, fall: 0.35 });
export const galaxyWhirlSpin = (k) => 1000 + k;

/* ── The portrait (formations/avatar.js) ──────────────────────────────────

   The hero's constellation where the CV carries a photo (the dach variant):
   the portrait drawn in points, lifted off the page by its depth map. Both
   sides read this table: avatar.js bakes the square photo `side` world units
   across about `centre`, with the depth map's `plane` value on the centre's
   plane and its full range `relief` units deep; cv-universe.js fits the hero
   camera so the photo's inscribed circle (radius side / 2 about the centre)
   lands exactly on the medallion it replaces (chapters.js hero `portrait`).
   `relief` and `rock` (the ROCK_Y amplitude, radians) are kept low: enough for
   the face to read as a surface, not so much that it stops reading as the photo. */
export const AVATAR = Object.freeze({
  centre: [-12, 9, 0],
  side: 14,
  relief: 3.2,
  plane: 0.55,
  rock: 0.04,
});
