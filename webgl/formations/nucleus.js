
import { MODE, REACT_PLANES, REACT_BODY_SPIN, reactOrbitSpin } from '../lib/modes.js';
import { CHAPTERS, REDUCED_CHAPTERS } from '../chapters.js';
import { progressiveGrid, slotRanks, backdrop } from '../lib/sampling.js';
import { norm3, basisFor, litBall, nucleonCluster, shellDust, electronComet } from './atom-kit.js';

/* ==========================================================================
   NUCLEUS: a sulphuric-acid molecule caught mid-reaction

   A sulphur nucleus (25 nucleons) bonded to four oxygens (8 each), two of
   which carry a hydrogen. Contact and overview both frame it (chapters.js).

   - Nucleons are lit beads (atom-kit litBall): each is its own Fibonacci
     lattice in farthest-point order, warped toward the key light, so a bead
     reads as a lit ball with a terminator and a white specular point, not as
     a ring of foam, and a ladder cut keeps every bead evenly covered. Beads
     are 0.72 (sulphur), 0.60 (oxygen) and 0.56 (hydrogen) across, smaller
     than their spacing, so they read as distinct berries.
   - Bonds are white: the bond axis (a thin line with sparks) and the
     bonding electrons circling it. Lone pairs stay the accent blue, which
     keeps the bonding-versus-lone-pair distinction inside the one-accent
     palette. Axis lines, comet tails and orbit arcs are 1D and placed on the
     progressive grid.
   - Orbits and the molecule's own yaw turn at half the rate they used to
     (bonding 1.05-1.35, lone pairs 1.0-1.25, hydrogen 1.4 radians per unit
     of clock; the body 0.19, lib/modes.js REACT_BODY_SPIN), so the fastest
     structure, the lone pairs on the outer oxygens, moves at most about
     2.8 px per frame at 4K (p99 at the overview; 5.5 before).
   - The field is two backdrops (lib/sampling.js), neither of which ever
     turns: far dust screen-uniform in the contact frame, the wider of the
     two chapters, widened to hold the reduced-motion contact frame, behind
     the molecule; and a phone's stars, only where no desktop camera looks
     (see below). Both are written in the formation's un-tilted frame with
     spin 0, so the mode-1 tilt carries them back exactly where they were
     placed.
   ========================================================================== */

const SPIN = REACT_BODY_SPIN;
const TILT = { x: -0.62, z: 0.05 };

// Budget shares: nucleus, oxygen nucleons, hydrogen nucleons, halo, axis,
// bonding electrons, lone pairs, hydrogen electrons, field (the backdrop),
// narrow (the phone's stars). They sum to 1. About 600 points per sulphur
// bead and 875 per oxygen or hydrogen bead at 100k: the hydrogen share is
// sized so both take the same count at every rung, and so share one cached
// farthest-point order (lib/sampling.js fpsOrder), which is most of a cold
// bake's cost.
const SHARES = [0.15, 0.28, 0.0175, 0.0825, 0.05, 0.17, 0.11, 0.02, 0.105, 0.015];

const CONTACT = CHAPTERS.find((c) => c.id === 'contact');
const OVERVIEW = CHAPTERS.find((c) => c.id === 'overview');
const CONTACT_REDUCED = REDUCED_CHAPTERS.find((c) => c.id === 'contact');
const OVERVIEW_REDUCED = REDUCED_CHAPTERS.find((c) => c.id === 'overview');
// A chapter's camera, and the same camera as cv-universe.js reframe() stages
// it below 820 CSS px (crystal.js has the same pair): pulled back 1.16x
// (1.34x in portrait) times the chapter's narrowPull, x at 0.22, the framing
// lifted. Mirrored here, so a change to reframe() has to be repeated here.
const cameraOf = (ch) => ({
  cam: [ch.camX, ch.camY, ch.camZ], tgt: [ch.tgtX, ch.tgtY, ch.tgtZ], fov: ch.fov,
});
const narrowCamera = (ch, pull) => ({
  cam: [ch.camX * 0.22, ch.camY * 0.7 + 2.2, ch.camZ * pull * (ch.narrowPull || 1)],
  tgt: [ch.tgtX * 0.22, ch.tgtY, ch.tgtZ],
  fov: ch.fov,
});

function buildNucleus(c) {
  const [nucS, nucO, nucH, haloShare, axisShare, elecShare, loneShare, hElecShare, fieldShare, narrowShare] = c.split(SHARES);

  const O = [
    [0, 6.9784, -1.4274],
    [-6.7405, -1.7446, -1.4274],
    [8.047, 0.374, -2.246],
    [-1.764, -6.174, 5.446],
  ];
  const H = [[11.695, 1.801, -1.77], [1.272, -8.252, 6.884]];

  nucleonCluster(c, [0, 0, 0], nucS, [[10, 0.85], [14, 1.5]], { spin: SPIN, stag: 0.02, ballR: 0.36, jitter: 0.08 });

  const perO = Math.floor(nucO / 4);
  O.forEach((cen, i) => {
    nucleonCluster(c, cen, perO, [[7, 0.62]], { spin: SPIN, stag: 0.04 + i * 0.01, ballR: 0.3, jitter: 0.08 });
  });
  const perH = Math.floor(nucH / 2);
  H.forEach((cen, i) => {
    litBall(c, cen, 0.28, perH, {
      spin: SPIN, stag: 0.09 + i * 0.01, glints: 2,
      tint: (lit) => Math.min(1, 0.5 + lit * 0.4),
    });
  });

  const haloS = Math.floor(haloShare * 0.3);
  shellDust(c, [0, 0, 0], [2.6], [1], haloS, { spin: SPIN, stag0: 0.28 });
  const perHalo = Math.floor((haloShare - haloS) / 4);
  O.forEach((cen, i) => {
    shellDust(c, cen, [1.8], [1], perHalo, { spin: SPIN, stag0: 0.3 + i * 0.015 });
  });

  const BONDS = [
    { plane: 0, dbl: true, R: 0.95 },
    { plane: 1, dbl: true, R: 0.95 },
    { plane: 2, dbl: false, R: 1.05 },
    { plane: 3, dbl: false, R: 1.05 },
    { plane: 4, dbl: false, R: 0.78 },
    { plane: 5, dbl: false, R: 0.78 },
  ];

  /* Bond axes: a thin white line from atom to atom, trimmed clear of both
     nuclei, on the progressive grid. Its scatter is only across the line, so
     a cut keeps it continuous. One point in 23 is a spark, chosen by slot
     rank (rank mod 23), so the sparks stay evenly spread along the line and
     keep their share at every cut. */
  const AXES = [
    { plane: 0, half: 3.57, trimA: 2.3, trimB: 1.7 },
    { plane: 1, half: 3.57, trimA: 2.3, trimB: 1.7 },
    { plane: 2, half: 4.21, trimA: 2.3, trimB: 1.7 },
    { plane: 3, half: 4.21, trimA: 2.3, trimB: 1.7 },
    { plane: 4, half: 1.975, trimA: 1.6, trimB: 0.8 },
    { plane: 5, half: 1.975, trimA: 1.6, trimB: 0.8 },
  ];
  const perAxis = Math.floor(axisShare / AXES.length);
  AXES.forEach((b) => {
    const pl = REACT_PLANES[b.plane];
    const ax = norm3(pl.axis);
    const { u, v } = basisFor(ax);
    const span = 2 * b.half - b.trimA - b.trimB;
    const slots = c.ahead(perAxis);
    const g = progressiveGrid(slots);
    const rank = slotRanks(slots);
    for (let j = 0; j < g.length; j++) {
      const s = -b.half + b.trimA + ((g[j] + 0.5) / perAxis) * span;
      const spark = rank[j] % 23 === 0;
      const ru = c.rng.bell() * 0.025, rv = c.rng.bell() * 0.025;
      c.write(
        pl.centre[0] + ax[0] * s + u[0] * ru + v[0] * rv,
        pl.centre[1] + ax[1] * s + u[1] * ru + v[1] * rv,
        pl.centre[2] + ax[2] * s + u[2] * ru + v[2] * rv,
        spark ? c.rng.range(0.2, 0.3) : c.rng.range(0.05, 0.11),
        spark ? c.rng.range(0.12, 0.18) : c.rng.range(0.18, 0.3),
        0.55 + c.rng.range(0, 0.07),
        SPIN,
        1
      );
    }
  });

  // Bonding electrons: one ring per single bond, two per double bond, two
  // comets on each ring, white (the head's lit side whitest).
  const rings = [];
  BONDS.forEach((b) => {
    if (b.dbl) {
      rings.push({ ...b, off: -0.5 });
      rings.push({ ...b, off: 0.5 });
    } else {
      rings.push({ ...b, off: 0 });
    }
  });
  const bondTint = (t) => 0.3 - 0.18 * t;
  const perE = Math.floor(elecShare / (rings.length * 2));
  rings.forEach((ring, ri) => {
    const pl = REACT_PLANES[ring.plane];
    const ax = pl.axis;
    const { u, v } = basisFor(ax);
    const centre = [
      pl.centre[0] + ax[0] * ring.off,
      pl.centre[1] + ax[1] * ring.off,
      pl.centre[2] + ax[2] * ring.off,
    ];
    const rate = (ri % 2 ? -1 : 1) * c.rng.range(1.05, 1.35);
    [0, Math.PI].forEach((a0, k) => {
      electronComet(c, {
        centre, u, v, R: ring.R,
        a0: a0 + ri * 0.8, spin: reactOrbitSpin(ring.plane, rate),
        stag: 0.76 + ri * 0.006 + k * 0.003, dir: Math.sign(rate),
      }, Math.floor(perE * 0.62), Math.floor(perE * 0.38), bondTint);
    });
  });

  // Lone pairs: four comets on each oxygen, in the accent.
  const perL = Math.floor(loneShare / 16);
  [6, 7, 8, 9].forEach((plane, oi) => {
    const pl = REACT_PLANES[plane];
    const { u, v } = basisFor(pl.axis);
    const rate = (oi % 2 ? -1 : 1) * c.rng.range(1.0, 1.25);
    [0, 0.55, Math.PI, Math.PI + 0.55].forEach((a0, k) => {
      electronComet(c, {
        centre: pl.centre, u, v, R: 1.95,
        a0: a0 + oi * 1.1, spin: reactOrbitSpin(plane, rate),
        stag: 0.8 + oi * 0.006 + k * 0.003, dir: Math.sign(rate),
      }, Math.floor(perL * 0.62), Math.floor(perL * 0.38));
    });
  });

  const perHE = Math.floor(hElecShare / 2);
  [10, 11].forEach((plane, hi) => {
    const pl = REACT_PLANES[plane];
    const { u, v } = basisFor(pl.axis);
    const rate = (hi % 2 ? -1 : 1) * 1.4;
    electronComet(c, {
      centre: pl.centre, u, v, R: 0.95,
      a0: hi * 2.2, spin: reactOrbitSpin(plane, rate),
      stag: 0.84 + hi * 0.006, dir: Math.sign(rate),
    }, Math.floor(perHE * 0.62), Math.floor(perHE * 0.38));
  });

  /* The field: far dust behind the molecule, screen-uniform in the contact
     frame (widened to hold the reduced contact frame; the overview frame,
     closer in, sees most of it) at view depth 62-125, where fog dims it.
     Jittered off the R2 lattice so it reads as a sky. Written un-tilted with
     spin 0, so the formation's tilt puts it back where it was placed. */
  backdrop(c, fieldShare, {
    ...cameraOf(CONTACT),
    aspect: 2.1,
    jitter: 0.7,
    also: [{ ...cameraOf(CONTACT_REDUCED), aspect: 1.9 }],
    depth: [62, 125],
    size: [0.2, 0.8],
    lean: 2.6,
    tint: [0, 0.12],
    pulse: [0.88, 1],
    mode: MODE.SPIN_Y,
    tilt: TILT,
  });

  /* The phone's stars. Below 820 CSS px reframe() pulls both nucleus cameras
     back (to z 66-113 in portrait), where the backdrop lies 100-170 units
     away, deep in the fog, and the frame looks past it above and below. This
     layer is that frame's sky: screen-uniform in the portrait contact frame,
     widened to hold the portrait overview frame and the reduced twins, at 50
     to 85 units, around and in front of the molecule, and only where no
     desktop camera looks: every candidate inside a contact or overview
     frustum (full or reduced, any window up to 2.7:1, widened by their
     pointer parallax and breath) is skipped. A desktop never has it in frame;
     a phone gets stars at the top and bottom, as the hero's narrow dust
     gives it (crystal.js). */
  {
    const A = 2.7;
    const sway = (ch, parallax) => {
      const t = Math.tan((ch.fov * Math.PI) / 360);
      // parallax + breath (0.55, 0.4, and 0.35 along the view) + 0.3 to spare
      return [parallax + 0.55 + 0.35 * t * A + 0.3, parallax * 0.7 + 0.4 + 0.35 * t + 0.3];
    };
    const reach = (ch) => 1.6 + Math.abs(ch.camZ) * 0.02;
    backdrop(c, narrowShare, {
      ...narrowCamera(CONTACT, 1.34),
      aspect: 0.6,
      jitter: 0.7,
      also: [
        { ...narrowCamera(OVERVIEW, 1.34), aspect: 0.6 },
        { ...narrowCamera(CONTACT_REDUCED, 1.34), aspect: 0.6 },
        { ...narrowCamera(OVERVIEW_REDUCED, 1.34), aspect: 0.6 },
      ],
      avoid: [
        { ...cameraOf(CONTACT), aspect: A, reach: sway(CONTACT, reach(CONTACT)) },
        { ...cameraOf(OVERVIEW), aspect: A, reach: sway(OVERVIEW, reach(OVERVIEW)) },
        { ...cameraOf(CONTACT_REDUCED), aspect: A, reach: sway(CONTACT_REDUCED, 0) },
        { ...cameraOf(OVERVIEW_REDUCED), aspect: A, reach: sway(OVERVIEW_REDUCED, 0) },
      ],
      depth: [50, 85],
      size: [0.2, 0.8],
      lean: 2.6,
      tint: [0, 0.12],
      pulse: [0.88, 1],
      mode: MODE.SPIN_Y,
      tilt: TILT,
    });
  }
}

export const nucleus = {
  seed: 0xac1d,
  touch: { mode: 6, radius: 3.4, strength: 2.2 },
  mode: MODE.SPIN_Y,
  pivot: [0, 0, 0],
  tilt: TILT,
  build: buildNucleus,
};
