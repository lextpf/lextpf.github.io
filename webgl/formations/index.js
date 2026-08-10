
import { primordial } from './field.js';
import { nucleus } from './nucleus.js';
import { crystal } from './crystal.js';
import { codex } from './codex.js';
import { planetary } from './planetary.js';
import { galaxy } from './galaxy.js';
import { wormhole } from './wormhole.js';
import { blackhole } from './blackhole.js';
import { whitehole } from './whitehole.js';

// The formation catalogue: the ids chapters.js is allowed to name as a `scene`.
// Every key here is one, and an unknown one throws at boot rather than quietly
// rendering nothing. Only `primordial` is unused by the current score: it is the
// timeline's fallback when no chapter selector resolves (scroll-timeline.js).
export const GENERATORS = Object.freeze({
  primordial,
  nucleus,
  crystal,
  codex,
  planetary,
  galaxy,
  wormhole,
  blackhole,
  whitehole,
});
