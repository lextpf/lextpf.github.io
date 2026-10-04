
import { primordial } from './field.js';
import { nucleus } from './nucleus.js';
import { crystal } from './crystal.js';
import { codex } from './codex.js';
import { mainfn, program, programPortrait, callgraph } from './code.js';
import { avatar } from './avatar.js';
import { planetary } from './planetary.js';
import { galaxy } from './galaxy.js';
import { wormhole } from './wormhole.js';
import { blackhole } from './blackhole.js';
import { whitehole } from './whitehole.js';

// The formation catalogue: the ids chapters.js is allowed to name as a `scene`.
// Every key here is one, and an unknown one throws at boot rather than quietly
// rendering nothing. `primordial` is the timeline's fallback when no chapter
// selector resolves (scroll-timeline.js); `crystal` and `nucleus` are no
// longer in the score (mainfn, program and callgraph replaced them) and stay
// registered only so a chapter can be pointed back at them. `avatar` is the
// hero's subject where the CV carries a photo (chapters.js hero `portrait`).
export const GENERATORS = Object.freeze({
  primordial,
  nucleus,
  crystal,
  mainfn,
  avatar,
  program,
  programPortrait,
  callgraph,
  codex,
  planetary,
  galaxy,
  wormhole,
  blackhole,
  whitehole,
});
