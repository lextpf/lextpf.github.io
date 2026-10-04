
import { DEFAULTS, STATE_KEYS, SCENE_LINKED, ENVELOPED } from './chapters.js';
import { clamp, clamp01, lerp, smootherstep, remap, damp } from './lib/random.js';

// Approach rates for the read heads. Bigger converges quicker, so the camera
// leads and the grade follows. The geometry is not first order: it rides a
// critically damped spring (MORPH_OMEGA), which gives the matter weight. It
// lags a moving scroll, carries on after the scroll stops and settles without
// a velocity step or an overshoot of its own making.
const LAMBDA = { camera: 5.4, post: 4.4, velocity: 4 };
// 95% settled in about 1.5 s. omega * dt stays <= 0.16 at the 50 ms dt clamp,
// so the semi-implicit Euler step below is stable.
const MORPH_OMEGA = 3.2;
// Settle epsilon: close enough and slow enough, the spring lands exactly on the
// target, so uMorph is exactly constant at rest and the morph streak stops.
const SETTLE_POS = 5e-4;
const SETTLE_VEL = 5e-3;
/* Cut on a dip. An anchor click or a scrollbar drag moves the target further
   than any smoothing should cover, and a spring crawling through every chapter
   in between reads as a fast-forward. So past CATCH_UP chapters of error (or
   CATCH_UP_FAST while the scroll itself moves faster than JUMP_SPEED H per
   second) the heads freeze and the universe dips out; once the scroll has come
   to rest and the dip has bottomed out they snap once to the destination and
   it fades back in, so even an instant jump never pops in half visible. The
   fast branch reads the smoothed velocity: the wheel scroller's per-notch
   bursts pass JUMP_SPEED for a frame or two inside an ordinary skim. COOLDOWN
   keeps a skim from blinking the universe repeatedly; it guards both branches
   except past CATCH_UP_FAR, which only a new navigation reaches. */
const CATCH_UP = 1.75;
const CATCH_UP_FAST = 1.25;
const CATCH_UP_FAR = 2.5;
const JUMP_SPEED = 4;
// Released when the scroll is slower than REST_SPEED (H per second) for two
// frames, or after JUMP_MAX seconds whatever it is doing. JUMP_MAX and COOLDOWN
// are wall-clock seconds, not summed frame dt: dt is clamped at 50 ms, so on a
// slow frame rate a dt sum would stretch both far past what they mean.
const REST_SPEED = 0.25;
const JUMP_MAX = 0.7;
const COOLDOWN = 1.5;
// Rates of the dip: out fast, back in gently.
const CUT_OUT = 18;
const CUT_IN = 5;
// The release waits for the dip to reach this, whatever the scroll is doing.
const CUT_FLOOR = 0.02;

/* Reading rhythm, in viewport heights. A formation holds while its section is
   read and only moves inside a band before the next heading: the band ends when
   the next section's top reaches 0.30 H, is ideally 0.45-0.62 H long (never under
   0.30 H), keeps at least 0.25 H of hold before it, and the last band lands
   0.18 H above the bottom of the document so the finale rests on "End of file". */
const BAND = {
  firstHold: 0.10, arrive: 0.30, maxLen: 0.62, minHold: 0.25,
  idealLen: 0.45, minLen: 0.30, tail: 0.18,
};
// Safety net for layout changes nothing observable reports.
const MEASURE_INTERVAL_MS = 1000;

// Which head drives which knobs. Every key in STATE_KEYS belongs to exactly one
// of these three groups: POST_KEYS is defined as the remainder, so adding a knob
// to DEFAULTS without classifying it here silently makes it a post knob.
// stagger, arc, pinch and vortex are blended here too, but update() overwrites
// them with TRANSITION_KEYS straight after sampling.
const CAMERA_KEYS = [
  'camX', 'camY', 'camZ', 'tgtX', 'tgtY', 'tgtZ', 'fov', 'focus', 'focusRange', 'dof',
  'frameX', 'holdPush', 'holdYaw',
];
const PARTICLE_KEYS = [
  'size', 'opacity', 'noise', 'noiseScale', 'noiseSpeed', 'accent', 'warm',
  'fogNear', 'fogFar', 'fogTint', 'arc', 'stagger', 'bokeh', 'clockRate',
  'flowFromScroll', 'loud', 'warp', 'camDelay',
];
const POST_KEYS = STATE_KEYS.filter(
  (k) => !CAMERA_KEYS.includes(k) && !PARTICLE_KEYS.includes(k)
);
// Keys that shape a transition rather than describe a chapter. Like morphStart
// they belong to the departing chapter and are constant through its band, never
// blended: a stagger that changes while particles are in flight can push them
// backwards, and a pinch blended on the post head runs at half strength.
const TRANSITION_KEYS = ['stagger', 'arc', 'pinch', 'vortex', 'scatter', 'erode', 'warp', 'camDelay'];

export class ScrollTimeline {
  constructor(chapters, options = {}) {
    // Chapters whose anchor is not in the document are dropped rather than
    // treated as zero-height. A variant that hides a section simply has a
    // shorter timeline, instead of a dead stop where that section used to be.
    this.chapters = chapters.filter((c) => document.querySelector(c.selector));
    this.elements = this.chapters.map((c) => document.querySelector(c.selector));
    // The morph range over which a black hole turns white. The default leaves a
    // dark beat before a quick ignition; reduced motion asks for a slow one.
    this.ignition = options.ignition || [0.52, 0.74];
    this.tops = new Float64Array(this.chapters.length);
    // One band per transition: [bandStart[i], bandEnd[i]] carries chapter i to i+1.
    const bands = Math.max(0, this.chapters.length - 1);
    this.bandStart = new Float64Array(bands);
    this.bandEnd = new Float64Array(bands);
    this.maxScroll = 1;
    // Hold envelope: rises 0 -> 1 across each hold stretch, falls 1 -> 0 across
    // the following band. holdTarget is the scroll's, hold the damped value.
    this.holdTarget = 0;
    this.hold = 0;
    this.lastY = window.scrollY;
    this.velocity = 0;
    this.rawVelocity = 0;
    this.raw = 0;
    this.snapped = false;
    // Cut-on-dip state (see CATCH_UP). cut is the dip itself, 1 when fully shown.
    this.jumping = false;
    this.jumpAt = 0;
    this.slowFrames = 0;
    this.snapAt = -Infinity;
    this.cut = 1;
    // The three read heads. All three chase the same target at different rates.
    this.pos = { camera: 0, morph: 0, post: 0 };
    // Only the morph head has a velocity of its own; the other two are first order.
    this.vel = { morph: 0 };
    // Where the camera is actually sampled (see _cameraPos): the camera head,
    // except through a held band, where it keeps pace with the morph head.
    this.camEff = 0;
    this._camOffset = 0;
    this._camRule = -2;
    this._held = null;
    this.initialised = false;

    // One state object, mutated in place every frame and handed out by
    // reference. Allocating a fresh ~50-key object per frame would be needless
    // garbage-collector pressure.
    this.state = {
      index: 0, nextIndex: 0, t: 0, eased: 0, morph: 0, raw: 0, snapped: false,
      sceneA: this.chapters[0] ? this.chapters[0].scene : 'primordial',
      sceneB: this.chapters[0] ? this.chapters[0].scene : 'primordial',
      chapterId: this.chapters[0] ? this.chapters[0].id : 'hero',
      global: 0, velocity: 0, morphVelocity: 0, horizonBase: 0, ringBase: 0, horizonLightBase: 0,
      hold: 0, settledIndex: 0, jumping: false, cut: 1,
    };
    STATE_KEYS.forEach((k) => {
      this.state[k] = this.chapters[0] ? this.chapters[0][k] : 0;
    });

    /* Layout is measured here and on change, never in the frame loop: a per-frame
       getBoundingClientRect forces a synchronous layout whenever anything earlier
       in the frame dirtied it. A ResizeObserver on the chapters and the root
       catches fonts, images, variant swaps and viewport changes; fonts.ready and
       a slow interval cover whatever slips past it. */
    this.disposed = false;
    this._measure = () => {
      if (!this.disposed) this.measureLayout();
    };
    this.measureLayout();
    if (typeof ResizeObserver === 'function') {
      this._observer = new ResizeObserver(this._measure);
      this._observer.observe(document.documentElement);
      this.elements.forEach((el) => this._observer.observe(el));
    }
    // Height-only viewport changes (mobile URL bar, devtools dock) resize none of
    // the observed boxes on a page taller than the viewport, but BAND is in H.
    window.addEventListener('resize', this._measure, { passive: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(this._measure, () => {});
    this._interval = setInterval(this._measure, MEASURE_INTERVAL_MS);
  }

  dispose() {
    this.disposed = true;
    if (this._observer) this._observer.disconnect();
    window.removeEventListener('resize', this._measure);
    clearInterval(this._interval);
  }

  get scenes() {
    return this.chapters.map((c) => c.scene);
  }

  /* Re-read where every chapter starts, then lay the transition bands over it.
     Not per frame: see the constructor. The max() keeps the tops monotonic, so a
     mid-layout measurement can never report a chapter beginning above the one
     before it and send readRaw backwards. A chapter with no layout box (hidden
     by a variant) collapses onto the previous top instead of reading as 0. */
  measureLayout() {
    const y = window.scrollY;
    const tops = this.tops;
    for (let i = 0; i < this.elements.length; i++) {
      const el = this.elements[i];
      const top = el.getClientRects().length ? el.getBoundingClientRect().top + y : 0;
      tops[i] = i === 0 ? 0 : Math.max(top, tops[i - 1]);
    }
    const H = window.innerHeight || 1;
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - H);
    this.maxScroll = maxScroll;

    // Each band ends when the next section's top reaches BAND.arrive, then is
    // stretched or squeezed to keep a minimum hold before it and fit the page.
    const bs = this.bandStart;
    const be = this.bandEnd;
    // A chapter's `band.hold` replaces the hold before its band (for the
    // first chapter, the first hold as well): the portrait's 0 starts its
    // dissolve on the first pixel of scroll.
    const first = (this.chapters[0] && this.chapters[0].band) || {};
    let prevEnd = first.hold != null ? 0 : BAND.firstHold * H;
    for (let i = 0; i < bs.length; i++) {
      // A chapter may lengthen the band that leaves it (`band` in chapters.js):
      // the hero's growth into the program is read over most of a screen.
      const own = this.chapters[i].band || {};
      const arrive = own.arrive ?? BAND.arrive;
      const maxLen = own.maxLen ?? BAND.maxLen;
      const idealLen = own.idealLen ?? BAND.idealLen;
      const minHold = own.hold ?? BAND.minHold;
      const endIdeal = tops[i + 1] - arrive * H;
      let start = Math.max(endIdeal - maxLen * H, prevEnd + minHold * H);
      let end = Math.max(endIdeal, start + idealLen * H);
      end = Math.min(end, maxScroll - BAND.tail * H);
      if (end - start < BAND.minLen * H) start = Math.max(prevEnd, end - BAND.minLen * H);
      // Only reachable on a page too short for its chapters: keep the bands
      // ordered and non-empty so readRaw stays monotonic.
      start = Math.max(start, prevEnd);
      if (end < start + 1) end = start + 1;
      bs[i] = start;
      be[i] = end;
      prevEnd = end;
    }
  }

  // Kept for the harnesses that call it to force a re-read.
  measure() {
    this.measureLayout();
  }

  /* Scroll position as a fractional chapter index: exactly i while chapter i is
     held, i + fraction inside the band that carries it to i + 1, and n - 1 past
     the last band. Also writes holdTarget, the hold envelope for that position. */
  readRaw() {
    const y = window.scrollY;
    const n = this.chapters.length;
    const bs = this.bandStart;
    const be = this.bandEnd;
    // A page too short to scroll pins to the first chapter.
    if (n < 2 || this.maxScroll <= 2) {
      this.holdTarget = 1;
      return 0;
    }
    let i = 0;
    while (i < n - 1 && be[i] <= y) i++;
    const holdFrom = i > 0 ? be[i - 1] : 0;
    if (i >= n - 1 || y < bs[i]) {
      const holdTo = i >= n - 1 ? this.maxScroll : bs[i];
      this.holdTarget = holdTo - holdFrom < 1 ? 1 : clamp01((y - holdFrom) / (holdTo - holdFrom));
      return i >= n - 1 ? n - 1 : i;
    }
    const t = clamp01((y - bs[i]) / (be[i] - bs[i]));
    this.holdTarget = 1 - t;
    return i + t;
  }

  // Blend one group of keys between the two chapters straddling position p.
  // smootherstep rather than a straight lerp so a knob arrives at each chapter
  // with zero velocity and zero acceleration, and nothing visibly kicks.
  _sample(p, keys, delayed = false) {
    const n = this.chapters.length;
    const idx = clamp(Math.floor(p), 0, n - 2);
    const ft = clamp01(p - idx);
    const a = this.chapters[idx];
    const b = this.chapters[idx + 1];
    // The camera may wait for part of the band (the departing chapter's
    // camDelay) and then make its whole move in the rest of it.
    const hold = delayed && a.scene !== b.scene ? a.camDelay || 0 : 0;
    const eased = smootherstep(hold > 0 ? remap(ft, hold, 1) : ft);
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k];
      this.state[key] = lerp(a[key], b[key], eased);
    }
    return { a, b, ft, eased, idx };
  }

  /* Teleport all three heads to the scroll and flag it: the experience reads
     `snapped`, extends its settle countdown so the performance sampler does not
     mistake the resulting spike for a slow device, and drops the trail history
     so the old chapter is not smeared over the new one. */
  _snap(raw) {
    this.camEff = raw;
    this._camOffset = 0;
    this._camRule = -2;
    this.pos.camera = raw;
    this.pos.morph = raw;
    this.pos.post = raw;
    this.vel.morph = 0;
    // The jump's own speed would otherwise push the flow bias of the new
    // formation for half a second of its fade-in.
    this.velocity = 0;
    this.hold = this.holdTarget;
    this.initialised = true;
    this.snapped = true;
    this.snapAt = performance.now();
  }

  /* The camera head leads the morph head on a moving scroll (first order at
     5.4 against a spring at 3.2), which is right almost everywhere. Not
     through a band whose departing chapter holds the camera (camDelay: the
     warp out of the tunnel): there the camera has to wait for the matter, or
     a fast scroll swings it off the tunnel toward the next framing before the
     tunnel has sped up and come apart. So while either head is in such a
     band, or they straddle it, the camera's progress through it is the morph
     head's. When the rule changes, the jump in the target is taken up by an
     offset that decays in about half a second, so the camera never steps. */
  _cameraPos(dt) {
    if (!this._held) {
      this._held = [];
      for (let i = 0; i + 1 < this.chapters.length; i++) {
        const a = this.chapters[i], b = this.chapters[i + 1];
        if ((a.camDelay || 0) > 0 && a.scene !== b.scene) this._held.push(i);
      }
    }
    let target = this.pos.camera;
    let rule = -1;
    for (let i = 0; i < this._held.length; i++) {
      const h = this._held[i];
      const pc = this.pos.camera - h, pm = this.pos.morph - h;
      if ((pc > 0 && pc < 1) || (pm > 0 && pm < 1) || (pc >= 1 && pm <= 0) || (pc <= 0 && pm >= 1)) {
        target = h + clamp(pm, 0, 1);
        rule = h;
        break;
      }
    }
    if (this._camRule === -2) this._camOffset = 0;
    else if (rule !== this._camRule) this._camOffset = this.camEff - target;
    this._camRule = rule;
    this._camOffset = damp(this._camOffset, 0, 6, dt);
    if (Math.abs(this._camOffset) < SETTLE_POS) this._camOffset = 0;
    this.camEff = target + this._camOffset;
    return this.camEff;
  }

  // One ordinary frame of the three heads chasing the scroll.
  _integrate(raw, dt) {
    this.pos.camera = damp(this.pos.camera, raw, LAMBDA.camera, dt);
    this.pos.post = damp(this.pos.post, raw, LAMBDA.post, dt);
    this.hold = damp(this.hold, this.holdTarget, LAMBDA.camera, dt);
    // First-order heads have no velocity; close enough is exactly there, so a
    // held chapter samples its own values rather than 99.97% of them.
    if (Math.abs(raw - this.pos.camera) < SETTLE_POS) this.pos.camera = raw;
    if (Math.abs(raw - this.pos.post) < SETTLE_POS) this.pos.post = raw;
    if (Math.abs(this.holdTarget - this.hold) < SETTLE_POS) this.hold = this.holdTarget;
    // Critically damped spring on the morph head, semi-implicit Euler.
    const w = MORPH_OMEGA;
    const last = this.chapters.length - 1;
    this.vel.morph += (w * w * (raw - this.pos.morph) - 2 * w * this.vel.morph) * dt;
    const next = this.pos.morph + this.vel.morph * dt;
    this.pos.morph = clamp(next, 0, last);
    // Pinned against an end of the timeline: the velocity has nowhere to go.
    if (next !== this.pos.morph) this.vel.morph = 0;
    if (Math.abs(raw - this.pos.morph) < SETTLE_POS && Math.abs(this.vel.morph) < SETTLE_VEL) {
      this.pos.morph = raw;
      this.vel.morph = 0;
    }
  }

  update(dt) {
    const y = window.scrollY;
    this.rawVelocity = dt > 0 ? (y - this.lastY) / dt : 0;
    this.lastY = y;
    // Smoothed, because the raw per-frame delta is far too noisy to drive
    // anything visible with.
    this.velocity = damp(this.velocity, this.rawVelocity, LAMBDA.velocity, dt);

    const raw = this.readRaw();
    this.raw = raw;

    this.snapped = false;
    const now = performance.now();
    const H = window.innerHeight || 1;
    const speed = Math.abs(this.rawVelocity);
    let released = false;
    if (!this.initialised) {
      // First sample, or a harness forcing a re-read: compose in place, no dip.
      this._snap(raw);
      this.jumping = false;
      this.cut = 1;
      // Composing in place is not a jump, so it starts no cooldown.
      this.snapAt = -Infinity;
    } else if (this.jumping) {
      // Every head stays frozen until the scroll rests at its destination and
      // the dip is dark (cut is last frame's value here).
      this.slowFrames = speed < REST_SPEED * H ? this.slowFrames + 1 : 0;
      if (
        (this.slowFrames >= 2 || now - this.jumpAt >= JUMP_MAX * 1000) &&
        this.cut < CUT_FLOOR
      ) {
        this.jumping = false;
        this._snap(raw);
        released = true;
      }
    } else {
      const err = Math.abs(raw - this.pos.morph);
      const cool = now - this.snapAt >= COOLDOWN * 1000;
      const fast = err > CATCH_UP_FAST && Math.abs(this.velocity) > JUMP_SPEED * H;
      if (err > CATCH_UP_FAR || (cool && (err > CATCH_UP || fast))) {
        this.jumping = true;
        this.jumpAt = now;
        this.slowFrames = 0;
      } else {
        this._integrate(raw, dt);
      }
    }
    // The snap frame itself stays dark; the fade back in starts on the next.
    if (!released) {
      this.cut = damp(this.cut, this.jumping ? 0 : 1, this.jumping ? CUT_OUT : CUT_IN, dt);
    }
    if (this.cut > 1 - SETTLE_POS) this.cut = 1;

    const s = this.state;
    this._sample(this._cameraPos(dt), CAMERA_KEYS, true);
    const post = this._sample(this.pos.post, POST_KEYS);
    const form = this._sample(this.pos.morph, PARTICLE_KEYS);

    // The chapter identity the rest of the system sees is the morph head's, not
    // the camera's: what matters downstream is which formations are bound. It is
    // the nearest chapter, so a held chapter reports itself (the settle epsilon
    // lands the head exactly on it) and the last one, closing, is reachable.
    const { a, b, ft, eased, idx } = form;
    // Read from the departing chapter; between two chapters on one formation
    // nothing moves, so the neutral values. At rollover the morph is clamped to
    // an endpoint, where these keys have no effect, so the switch is invisible.
    const tk = a.scene !== b.scene ? a : DEFAULTS;
    for (let k = 0; k < TRANSITION_KEYS.length; k++) {
      const key = TRANSITION_KEYS[k];
      s[key] = tk[key];
    }
    const settled = clamp(Math.round(this.pos.morph), 0, this.chapters.length - 1);
    s.index = idx;
    s.nextIndex = Math.min(idx + 1, this.chapters.length - 1);
    s.t = ft;
    s.eased = eased;
    s.raw = raw;
    s.settledIndex = settled;
    s.hold = this.hold;
    s.chapterId = this.chapters[settled].id;
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
      // Collapse, one dark beat, then ignition: the light holds at the departing
      // hole's value until mid-morph and turns over late, so a black hole going
      // white reads as a black disc first and only then catches fire.
      const [i0, i1] = this.ignition;
      s.horizonLightBase = lerp(a.horizonLight, b.horizonLight, smootherstep(remap(s.morph, i0, i1)));
    } else {
      const holeChapter = holeA ? a : holeB ? b : null;
      s.horizonBase = holeChapter ? holeChapter.horizon : 0;
      s.ringBase = holeChapter ? holeChapter.ring : 0;
      s.horizonLightBase = holeChapter ? holeChapter.horizonLight : 0;
    }
    s.global = this.chapters.length > 1 ? raw / (this.chapters.length - 1) : 1;
    s.velocity = this.velocity;
    // Chapters per second of the morph head, signed.
    s.morphVelocity = this.vel.morph;
    s.snapped = this.snapped;
    s.jumping = this.jumping;
    s.cut = this.cut;

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
