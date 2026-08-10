
import { STATE_KEYS, SCENE_LINKED, ENVELOPED } from './chapters.js';
import { clamp, clamp01, lerp, smootherstep, remap, damp } from './lib/random.js';

// Approach rates for the three read heads. Bigger converges quicker, so the
// camera leads, the grade follows, and the geometry trails well behind.
const LAMBDA = { camera: 5.4, morph: 1.5, post: 4.4, velocity: 4 };
// Past this many chapters of error there is nothing to smooth toward, so snap.
const CATCH_UP = 1.75;

// Which head drives which knobs. Every key in STATE_KEYS belongs to exactly one
// of these three groups: POST_KEYS is defined as the remainder, so adding a knob
// to DEFAULTS without classifying it here silently makes it a post knob.
const CAMERA_KEYS = ['camX', 'camY', 'camZ', 'tgtX', 'tgtY', 'tgtZ', 'fov', 'focus', 'focusRange', 'dof'];
const PARTICLE_KEYS = [
  'size', 'opacity', 'noise', 'noiseScale', 'noiseSpeed', 'accent', 'warm',
  'fogNear', 'fogFar', 'fogTint', 'arc', 'stagger', 'bokeh', 'clockRate',
  'flowFromScroll', 'loud',
];
const POST_KEYS = STATE_KEYS.filter(
  (k) => !CAMERA_KEYS.includes(k) && !PARTICLE_KEYS.includes(k)
);

export class ScrollTimeline {
  constructor(chapters) {
    // Chapters whose anchor is not in the document are dropped rather than
    // treated as zero-height. A variant that hides a section simply has a
    // shorter timeline, instead of a dead stop where that section used to be.
    this.chapters = chapters.filter((c) => document.querySelector(c.selector));
    this.elements = this.chapters.map((c) => document.querySelector(c.selector));
    this.tops = new Float64Array(this.chapters.length);
    this.maxScroll = 1;
    this.lastY = window.scrollY;
    this.velocity = 0;
    this.rawVelocity = 0;
    this.raw = 0;
    this.snapped = false;
    // The three read heads. All three chase the same target at different rates.
    this.pos = { camera: 0, morph: 0, post: 0 };
    this.initialised = false;

    // One state object, mutated in place every frame and handed out by
    // reference. Allocating a fresh ~50-key object per frame would be needless
    // garbage-collector pressure.
    this.state = {
      index: 0, nextIndex: 0, t: 0, eased: 0, morph: 0, raw: 0, snapped: false,
      sceneA: this.chapters[0] ? this.chapters[0].scene : 'primordial',
      sceneB: this.chapters[0] ? this.chapters[0].scene : 'primordial',
      chapterId: this.chapters[0] ? this.chapters[0].id : 'hero',
      global: 0, velocity: 0, horizonBase: 0, ringBase: 0, horizonLightBase: 0,
    };
    STATE_KEYS.forEach((k) => {
      this.state[k] = this.chapters[0] ? this.chapters[0][k] : 0;
    });
  }

  get scenes() {
    return this.chapters.map((c) => c.scene);
  }

  // Re-read where every chapter starts. Runs every frame because the page is not
  // static: fonts land, images decode, sections pin and unpin. The max() keeps
  // the list monotonic, so a mid-layout measurement can never report a chapter
  // beginning above the one before it and send readRaw backwards.
  measure() {
    const y = window.scrollY;
    const tops = this.tops;
    for (let i = 0; i < this.elements.length; i++) {
      const top = this.elements[i].getBoundingClientRect().top + y;
      tops[i] = i === 0 ? 0 : Math.max(top, tops[i - 1]);
    }
    this.maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  }

  // Scroll position as a fractional chapter index. The last chapter runs to the
  // bottom of the document rather than to a following top, since it has none.
  readRaw() {
    const y = window.scrollY;
    const n = this.chapters.length;
    let i = 0;
    while (i < n - 1 && this.tops[i + 1] > 0 && y >= this.tops[i + 1]) i++;

    const start = this.tops[i];
    const end = i < n - 1 ? this.tops[i + 1] : this.maxScroll;
    const span = end - start;
    // A page too short to scroll pins to the first chapter; a zero-height
    // chapter counts as complete rather than dividing by zero.
    const t = this.maxScroll <= 2 ? 0 : span < 1 ? 1 : clamp01((y - start) / span);
    return i + t;
  }

  // Blend one group of keys between the two chapters straddling position p.
  // smootherstep rather than a straight lerp so a knob arrives at each chapter
  // with zero velocity and zero acceleration, and nothing visibly kicks.
  _sample(p, keys) {
    const n = this.chapters.length;
    const idx = clamp(Math.floor(p), 0, n - 2);
    const ft = clamp01(p - idx);
    const a = this.chapters[idx];
    const b = this.chapters[idx + 1];
    const eased = smootherstep(ft);
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k];
      this.state[key] = lerp(a[key], b[key], eased);
    }
    return { a, b, ft, eased, idx };
  }

  update(dt) {
    this.measure();

    const y = window.scrollY;
    this.rawVelocity = dt > 0 ? (y - this.lastY) / dt : 0;
    this.lastY = y;
    // Smoothed, because the raw per-frame delta is far too noisy to drive
    // anything visible with.
    this.velocity = damp(this.velocity, this.rawVelocity, LAMBDA.velocity, dt);

    const raw = this.readRaw();
    this.raw = raw;

    this.snapped = false;
    // An anchor click, a scrollbar drag or a restored scroll position moves the
    // target further than any smoothing should try to cover. Teleport all three
    // heads and flag it: the experience reads `snapped` and extends its settle
    // countdown so the performance sampler does not mistake the resulting spike
    // for a slow device.
    if (!this.initialised || Math.abs(raw - this.pos.morph) > CATCH_UP) {
      this.pos.camera = raw;
      this.pos.morph = raw;
      this.pos.post = raw;
      this.initialised = true;
      this.snapped = true;
    } else {
      this.pos.camera = damp(this.pos.camera, raw, LAMBDA.camera, dt);
      this.pos.morph = damp(this.pos.morph, raw, LAMBDA.morph, dt);
      this.pos.post = damp(this.pos.post, raw, LAMBDA.post, dt);
    }

    const s = this.state;
    this._sample(this.pos.camera, CAMERA_KEYS);
    const post = this._sample(this.pos.post, POST_KEYS);
    const form = this._sample(this.pos.morph, PARTICLE_KEYS);

    // The chapter identity the rest of the system sees is the morph head's, not
    // the camera's: what matters downstream is which formations are bound.
    const { a, b, ft, eased, idx } = form;
    s.index = idx;
    s.nextIndex = Math.min(idx + 1, this.chapters.length - 1);
    s.t = ft;
    s.eased = eased;
    s.raw = raw;
    s.chapterId = a.id;
    s.sceneA = a.scene;
    s.sceneB = b.scene;
    // Consecutive chapters often share a formation; there is nothing to morph
    // then. Otherwise morphStart/morphEnd carve a sub-range out of the chapter,
    // so a transition can be made to finish early or start late.
    s.morph = a.scene === b.scene ? 0 : remap(ft, a.morphStart, a.morphEnd);

    // The horizon disc and its ring are drawn by the composite pass, not by
    // particles, so they need their own blend. Between two holes they simply
    // cross-fade; entering or leaving one, they have to assemble and dissolve
    // over part of the morph rather than pop in with the geometry.
    const holeA = a.scene === 'blackhole' || a.scene === 'whitehole';
    const holeB = b.scene === 'blackhole' || b.scene === 'whitehole';
    if (holeA && holeB) {
      s.horizonBase = lerp(a.horizon, b.horizon, s.morph);
      s.ringBase = lerp(a.ring, b.ring, s.morph);
      s.horizonLightBase = lerp(a.horizonLight, b.horizonLight, s.morph);
    } else {
      const holeChapter = holeA ? a : holeB ? b : null;
      s.horizonBase = holeChapter ? holeChapter.horizon : 0;
      s.ringBase = holeChapter ? holeChapter.ring : 0;
      s.horizonLightBase = holeChapter ? holeChapter.horizonLight : 0;
    }
    s.global = this.chapters.length > 1 ? raw / (this.chapters.length - 1) : 1;
    s.velocity = this.velocity;
    s.snapped = this.snapped;

    // A few effects belong to the formation rather than to the chapter, so when
    // the scene is changing they are re-blended on the morph curve, overwriting
    // what _sample just wrote on the chapter curve.
    if (a.scene !== b.scene) {
      for (let k = 0; k < SCENE_LINKED.length; k++) {
        const key = SCENE_LINKED[k];
        s[key] = lerp(a[key], b[key], s.morph);
      }
    }

    // An enveloped chapter swells its effects through the middle of the
    // transition and settles again at both ends, so the flourish happens during
    // the move rather than being left switched on afterwards.
    if (post.a.envelope) {
      const shape = 0.5 + 0.5 * Math.sin(Math.PI * post.ft);
      for (let k = 0; k < ENVELOPED.length; k++) {
        const key = ENVELOPED[k];
        s[key] *= 0.45 + 0.55 * shape;
      }
    }

    return s;
  }
}
