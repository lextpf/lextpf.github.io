
import { MODE, STACK_PIVOT } from '../lib/modes.js';
import { CHAPTERS, REDUCED_CHAPTERS } from '../chapters.js';
import { backdrop } from '../lib/sampling.js';
import {
  textBlock, programPlan, stackPlan, writePlan,
  MAIN_PIVOT, PROGRAM_PIVOT,
} from './code-kit.js';

/* The hero's sky and contact's are one: the same writes, fitted to both
   cameras, so no star moves while the program grows (a sky morphing into
   another streaks across the whole frame and reads as rain). Both
   generators share a seed and write no rng before it, so the two bakes are
   identical past the text block. */
const SHARED_SKY = (c) => sky(c, 'hero', 0, null, 'contact');
// The portrait (avatar.js) writes the same sky after a text block of its own,
// so it morphs into the program with the stars standing still.
export { SHARED_SKY as heroSky };

/* ==========================================================================
   THE CODE CONSTELLATIONS: mainfn (hero), program (contact), callgraph
   (overview). The geometry and the plan live in code-kit.js; each generator
   here writes its view of the shared text block first (write j is the same
   particle in all three), then its own sky.

   - mainfn: `int main() {}` as floating constellation glyphs, each at its
     own depth and turn. The body of the program is already here, latent:
     every particle it will need sits inside the glyph it will split from, at
     size 0, a faint few lit as charge.
   - program: the eight lines it grows into. Scope is depth (the body sits
     1.6 units in front of main's line, the loop body 3.2) and the lines bend
     on a shallow cylinder. The pulse walks it in reading order.
   - callgraph (Career): the call stack as a tower of floating frames,
     pushed and popped as the program runs (MODE.STACK, lib/modes.js).
   mainfn and program rock (ROCK_Y: `spin` is the rock amplitude).
   ========================================================================== */

const chapterOf = (list, id) => list.find((c) => c.id === id);
const cameraOf = (ch) => ({ cam: [ch.camX, ch.camY, ch.camZ], tgt: [ch.tgtX, ch.tgtY, ch.tgtZ], fov: ch.fov });
// cv-universe.js reframe() below 820 CSS px (as in codex.js and crystal.js).
const narrowCamera = (ch, pull) => ({
  cam: [ch.camX * 0.22, ch.camY * 0.7 + 2.2, ch.camZ * pull * (ch.narrowPull || 1)],
  tgt: [ch.tgtX * 0.22, ch.tgtY, ch.tgtZ],
  fov: ch.fov,
});

function sky(c, id, rock, tilt = null, alsoId = null, mode = MODE.ROCK_Y) {
  const full = chapterOf(CHAPTERS, id);
  const reduced = chapterOf(REDUCED_CHAPTERS, id);
  skyFrom(c, {
    full: cameraOf(full),
    reduced: cameraOf(reduced),
    narrow: narrowCamera(full, 1.34),
    narrowReduced: narrowCamera(reduced, 1.34),
    also: alsoId ? [cameraOf(chapterOf(CHAPTERS, alsoId)), cameraOf(chapterOf(REDUCED_CHAPTERS, alsoId))] : [],
  }, rock, tilt, mode);
}

// The two layers of a chapter's sky, given its frames: the field for the
// desktop frames, the phone's stars for the narrow ones (kept out of every
// desktop frame).
function skyFrom(c, f, rock, tilt, mode) {
  // The last part takes the rest of the budget unless a third part is named.
  const [field, narrow] = c.split(f.split || [0.12, 0.02]);
  const common = { jitter: 0.7, size: [0.2, 0.8], lean: 2.6, tint: [0, 0.1], pulse: [0.9, 1], mode, rock, tilt };
  backdrop(c, field, {
    ...f.full, aspect: 2.1,
    also: [{ ...f.reduced, aspect: 1.9 }, ...f.also.map((cam) => ({ ...cam, aspect: 2.1 }))],
    depth: [80, 140], ...common,
  });
  backdrop(c, narrow, {
    ...f.narrow, aspect: 0.6, also: [{ ...f.narrowReduced, aspect: 0.6 }],
    avoid: [
      { ...f.full, aspect: 2.7, reach: [3.2, 2.2] },
      { ...f.reduced, aspect: 2.7, reach: [1.6, 1.2] },
    ],
    depth: f.narrowDepth || [50, 110], ...common,
  });
}

/* The portrait's sky (dach): the hero is the avatar, framed on the medallion
   (chapters.js hero.portrait), so its sky is laid for the medallion's frames,
   desk and phone, and for contact's, which the program's portrait twin
   writes too. Same layers, same budget, same seed as the code sky. */
export const PORTRAIT_SPLIT = Object.freeze([0.12, 0.04, 0]);
/* The portrait's sky is baked twice at boot, for the avatar and for
   programPortrait, and it is the same bake both times: both generators carry
   mainfn's seed and draw nothing from c.rng before the sky (the avatar's plan
   and the program's plan use fixed hashes and their own rngs), and both reach
   it at the same cursor (after the program's text block), so its writes and
   its rng draws are a function of count and cursor alone. Recorded on the
   first bake, replayed on the next (the rng advanced by the same draws), which
   takes a backdrop walk off the boot's synchronous block. Any generator that
   draws from c.rng before calling this must not share the memo. */
const SKY_MEMO = new Map();
const PORTRAIT_SKY = (c) => {
  const key = `${c.count}:${c.cursor}`;
  const hit = SKY_MEMO.get(key);
  if (hit) {
    const w = hit.writes;
    for (let i = 0; i < w.length; i += 8) c.write(w[i], w[i + 1], w[i + 2], w[i + 3], w[i + 4], w[i + 5], w[i + 6], w[i + 7]);
    for (let i = 0; i < hit.draws; i++) c.rng.unit();
    return;
  }
  const writes = [];
  let draws = 0;
  const rng = {
    unit: () => { draws++; return c.rng.unit(); },
    range: (lo, hi) => { draws++; return c.rng.range(lo, hi); },
    signed: () => { draws++; return c.rng.signed(); },
    bell: () => { draws += 2; return c.rng.bell(); },
    chance: (p) => { draws++; return c.rng.chance(p); },
    int: (n) => { draws++; return c.rng.int(n); },
  };
  const recorder = {
    count: c.count,
    rng,
    get cursor() { return c.cursor; },
    ahead: (n) => c.ahead(n),
    split: (f) => c.split(f),
    write: (x, y, z, size, tint, stagger, spin, rigidity) => {
      writes.push(x, y, z, size, tint, stagger, spin, rigidity);
      c.write(x, y, z, size, tint, stagger, spin, rigidity);
    },
  };
  portraitSkyWrite(recorder);
  SKY_MEMO.set(key, { writes: Float32Array.from(writes), draws });
};
const portraitSkyWrite = (c) => {
  const p = chapterOf(CHAPTERS, 'hero').portrait;
  const pr = chapterOf(REDUCED_CHAPTERS, 'hero').portrait || p;
  skyFrom(c, {
    full: p.desk,
    reduced: pr.desk,
    narrow: p.phone,
    narrowReduced: pr.phone,
    // The phone's fit pulls closer on a shorter phone (102 units at 360 x
    // 640, 134 at 390 x 844): its stars sit deeper so none comes near.
    narrowDepth: [80, 150],
    // An explicit phone layer, so the rest of the budget is the portrait's
    // second block (avatar.js PORTRAIT_SPARE) instead of more phone stars.
    split: PORTRAIT_SPLIT,
    also: [cameraOf(chapterOf(CHAPTERS, 'contact')), cameraOf(chapterOf(REDUCED_CHAPTERS, 'contact'))],
  }, 0, null, MODE.ROCK_Y);
};
export { PORTRAIT_SKY as portraitSky };

const TOUCH_TEXT = { mode: 12, radius: 2.2, strength: 0.5 };

export const mainfn = {
  seed: 0x3a1a,
  touch: TOUCH_TEXT,
  mode: MODE.ROCK_Y,
  pivot: MAIN_PIVOT,
  build(c) {
    const slots = c.ahead(textBlock(c.count));
    writePlan(c, programPlan(c.count, slots).A, 0.08);
    SHARED_SKY(c);
  },
};

export const program = {
  seed: 0x3a1a,
  touch: TOUCH_TEXT,
  mode: MODE.ROCK_Y,
  pivot: PROGRAM_PIVOT,
  build(c) {
    const slots = c.ahead(textBlock(c.count));
    writePlan(c, programPlan(c.count, slots).B, 0.06);
    SHARED_SKY(c);
  },
};

// Contact where the hero is the portrait: the same program under the
// portrait's sky, so the face comes apart into it with the stars still.
export const programPortrait = {
  seed: 0x3a1a,
  touch: TOUCH_TEXT,
  mode: MODE.ROCK_Y,
  pivot: PROGRAM_PIVOT,
  build(c) {
    const slots = c.ahead(textBlock(c.count));
    const B = programPlan(c.count, slots).B;
    writePlan(c, B, 0.06);
    PORTRAIT_SKY(c);
    // The portrait's second block lands here: parked on the program's own
    // ink at size 0, so those points fly into the text and go out in it.
    const ink = [];
    for (let j = 0; j < B.size.length; j++) if (B.size[j] > 0) ink.push(j);
    for (let k = 0; c.cursor < c.count; k++) {
      const j = ink.length ? ink[(k * 7919) % ink.length] : 0;
      c.write(B.x[j], B.y[j], B.z[j], 0, B.tint[j], B.phase[j], 0.06, 1);
    }
  },
};

export const callgraph = {
  seed: 0x6a4f,
  touch: TOUCH_TEXT,
  mode: MODE.STACK,
  pivot: STACK_PIVOT,
  build(c) {
    const slots = c.ahead(textBlock(c.count));
    writePlan(c, stackPlan(c.count, slots).G, 0);
    sky(c, 'career', 0, null, null, MODE.STACK);
  },
};
