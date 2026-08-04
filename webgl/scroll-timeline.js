import { STATE_KEYS, SCENE_LINKED, ENVELOPED } from './chapters.js';
import { clamp, clamp01, lerp, smootherstep, remap, damp } from './lib/random.js';

const LAMBDA = { camera: 5.4, morph: 1.5, post: 4.4, velocity: 4 };
const CATCH_UP = 1.75;

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
    this.chapters = chapters.filter((c) => document.querySelector(c.selector));
    this.elements = this.chapters.map((c) => document.querySelector(c.selector));
    this.tops = new Float64Array(this.chapters.length);
    this.maxScroll = 1;
    this.lastY = window.scrollY;
    this.velocity = 0;
    this.rawVelocity = 0;
    this.raw = 0;
    this.snapped = false;
    this.pos = { camera: 0, morph: 0, post: 0 };
    this.initialised = false;

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

  measure() {
    const y = window.scrollY;
    const tops = this.tops;
    for (let i = 0; i < this.elements.length; i++) {
      const top = this.elements[i].getBoundingClientRect().top + y;
      tops[i] = i === 0 ? 0 : Math.max(top, tops[i - 1]);
    }
    this.maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  }

  readRaw() {
    const y = window.scrollY;
    const n = this.chapters.length;
    let i = 0;
    while (i < n - 1 && this.tops[i + 1] > 0 && y >= this.tops[i + 1]) i++;

    const start = this.tops[i];
    const end = i < n - 1 ? this.tops[i + 1] : this.maxScroll;
    const span = end - start;
    const t = this.maxScroll <= 2 ? 0 : span < 1 ? 1 : clamp01((y - start) / span);
    return i + t;
  }

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
    this.velocity = damp(this.velocity, this.rawVelocity, LAMBDA.velocity, dt);

    const raw = this.readRaw();
    this.raw = raw;

    this.snapped = false;
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

    const { a, b, ft, eased, idx } = form;
    s.index = idx;
    s.nextIndex = Math.min(idx + 1, this.chapters.length - 1);
    s.t = ft;
    s.eased = eased;
    s.raw = raw;
    s.chapterId = a.id;
    s.sceneA = a.scene;
    s.sceneB = b.scene;
    s.morph = a.scene === b.scene ? 0 : remap(ft, a.morphStart, a.morphEnd);
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

    if (a.scene !== b.scene) {
      for (let k = 0; k < SCENE_LINKED.length; k++) {
        const key = SCENE_LINKED[k];
        s[key] = lerp(a[key], b[key], s.morph);
      }
    }

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
