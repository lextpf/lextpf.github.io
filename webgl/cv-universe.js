import * as THREE from './lib/three.js';
import { CHAPTERS, REDUCED_CHAPTERS, DEFAULTS } from './chapters.js';
import { FormationRegistry } from './formation-registry.js';
import { ParticleSystem } from './particle-system.js';
import { PostProcessing } from './post-processing.js';
import { ScrollTimeline } from './scroll-timeline.js';
import { CameraRig } from './camera-rig.js';
import { PointerController } from './pointer.js';
import { PerformanceManager, TIERS, detectTier } from './performance.js';
import { clamp, clamp01, damp } from './lib/random.js';
import { BLACK_HOLE_HORIZON } from './formations/blackhole.js';

const HORIZON_WORLD_RADIUS = BLACK_HOLE_HORIZON;

const DENSITY_REFERENCE = 100000;

class WebGLExperience {
  constructor(canvas, options) {
    this.canvas = canvas;
    this.reduced = options.reduced;
    this.debugRequested = options.debug;
    this.root = document.documentElement;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: options.debug === true,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

    const gl = this.renderer.getContext();
    this.tier = this.reduced ? 'low' : detectTier(gl);
    const settings = TIERS[this.tier];

    this.registry = new FormationRegistry(settings.count);
    this.particles = new ParticleSystem(this.registry, settings.count);
    this.post = new PostProcessing(this.renderer, {
      bloomLevels: this.reduced ? 2 : settings.bloomLevels,
      trails: this.reduced ? false : settings.trails,
      superSample: settings.superSample,
      master: 0.74,
    });
    this.rig = new CameraRig(1);
    this.pointer = new PointerController(this.reduced ? 0 : settings.parallax);
    this.timeline = new ScrollTimeline(this.reduced ? REDUCED_CHAPTERS : CHAPTERS);

    this.scene = new THREE.Scene();
    this.scene.add(this.particles.points);

    this.perf = new PerformanceManager(this.tier, (tier, stats) => this.applyTier(tier, stats));
    this.focusPoint = { centre: new THREE.Vector2(0.5, 0.5), radius: 0.1 };

    this.state = { ...DEFAULTS };
    this.overrides = null;
    this.review = null;
    this.dpr = 1;
    this.dprCap = settings.dpr;
    this.superSample = settings.superSample;
    this.densityAlpha = 1;
    this.densitySize = 1;
    this.elapsed = 0;
    this.lastNow = 0;
    this.fade = 0;
    this.staticAccum = 0;
    this.lastScrollY = -1;
    this.lastLoud = -1;
    this.lastChapter = '';
    this.prefetchedFor = -1;
    this.settle = 6;
    this.raf = 0;
    this.running = false;
    this.disposed = false;

    const first = this.timeline.update(0.016);
    this.registry.prime([first.sceneA, first.sceneB]);
    this.particles.setPair(first.sceneA, first.sceneB);
    for (const key in first) this.state[key] = first[key];

    this.applyTier(this.tier);
    this.resize();
    this.post.prewarm(this.scene, this.rig.camera);

    this._onResize = () => this.resize();
    this._onVisibility = () => {
      if (!document.hidden) this.start();
    };
    this._onContextLost = (event) => {
      event.preventDefault();
      this.stop();
      handOverToFallback();
    };

    addEventListener('resize', this._onResize, { passive: true });
    addEventListener('orientationchange', this._onResize, { passive: true });
    addEventListener('pageshow', this._onVisibility, { passive: true });
    document.addEventListener('visibilitychange', this._onVisibility);
    canvas.addEventListener('webglcontextlost', this._onContextLost);

    this.primeRemaining();
  }

  primeRemaining() {
    const queue = [...new Set(this.timeline.scenes)];
    const step = () => {
      if (this.disposed) return;
      const id = queue.shift();
      if (!id) return;
      this.registry.get(id);
      schedule(step);
    };
    schedule(step);
  }

  applyTier(tier, stats) {
    const settings = TIERS[tier];
    this.tier = tier;
    this.particles.setActiveCount(settings.count);
    this.post.bloomLevels = this.reduced ? 2 : settings.bloomLevels;
    this.post.trailsEnabled = this.reduced ? false : settings.trails && !!this.post.rtHistoryA;
    this.pointer.setScale(this.reduced ? 0 : settings.parallax);
    this.dprCap = settings.dpr;
    const ratio = DENSITY_REFERENCE / settings.count;
    this.densityAlpha = clamp(Math.sqrt(ratio), 1.0, 1.65);
    this.densitySize = clamp(Math.pow(ratio, 0.34), 1.0, 1.6);
    this.root.dataset.universeTier = tier;
    if (settings.superSample !== this.superSample) {
      this.superSample = settings.superSample;
      this.post.superSample = settings.superSample;
      this.post.width = -1;
    }
    this.settle = Math.max(this.settle, 12);
    this.resize();
    if (stats) {
      console.info(
        `[universe] quality -> ${tier} (p95 ${stats.p95.toFixed(1)}ms, avg ${stats.avg.toFixed(1)}ms, ` +
        `${settings.count} particles, dpr cap ${settings.dpr})`
      );
    }
  }

  resize() {
    const width = this.root.clientWidth || innerWidth;
    const height = innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, this.dprCap || 1.5);
    if (width !== this.cssWidth || height !== this.cssHeight || dpr !== this.dpr) {
      this.cssWidth = width;
      this.cssHeight = height;
      this.dpr = dpr;
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(width, height, false);
      this.particles.setPixelRatio(dpr);
      this.particles.setViewport(Math.floor(width * dpr), Math.floor(height * dpr));
      this.aspect = width / Math.max(1, height);
      this.rig.setAspect(this.aspect);
      this.narrow = width < 820;
    }
    this.post.setSize(Math.floor(width * this.dpr), Math.floor(height * this.dpr));
    if (this.particles.slots[this.particles.aIndex].id) this.render();
  }

  reframe(state) {
    if (!this.narrow) return state;
    const pull = (this.aspect < 0.8 ? 1.34 : 1.16) * (state.narrowPull || 1);
    state.camZ *= pull;
    state.camX *= 0.22;
    state.tgtX *= 0.22;
    state.camY = state.camY * 0.7 + 2.2;
    state.noise *= 0.85;
    state.bloom *= 0.85;
    state.chroma *= 0.6;
    state.lens *= 0.7;
    state.dof *= 0.6;
    state.trail *= 0.6;
    state.haze *= 0.8;
    state.loud *= 0.7;
    return state;
  }

  render() {
    this.rig.projectSphere(HORIZON_WORLD_RADIUS, this.aspect, this.focusPoint);
    this.post.render(this.scene, this.rig.camera, this.state, this.focusPoint, this.elapsed);
  }

  frame(now) {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this._frame);

    const dtMs = this.lastNow ? now - this.lastNow : 16.7;
    this.lastNow = now;
    const dt = clamp(dtMs / 1000, 0.001, 0.05);
    this.elapsed += dt;
    if (this.settle > 0) this.settle--;
    else this.perf.sample(dtMs, now);

    const live = this.timeline.update(dt);
    if (live.snapped) this.settle = Math.max(this.settle, 10);
    const state = this.state;
    for (const key in live) state[key] = live[key];
    this.reframe(state);
    state.size *= this.densitySize;
    if (this.overrides) Object.assign(state, this.overrides);
    if (this.review && this.review.scene) {
      state.sceneA = this.review.scene;
      state.sceneB = this.review.scene;
      state.morph = 0;
    }

    this.pointer.update(dt);
    this.rig.update(state, this.pointer, dt, this.elapsed);

    if (!this._touch) {
      this._touch = {
        dir: new THREE.Vector3(), tip: new THREE.Vector3(), last: new THREE.Vector3(),
        move: new THREE.Vector3(), smooth: new THREE.Vector3(), has: false,
      };
    }
    const tp = this._touch;
    tp.dir.set(this.pointer.x, -this.pointer.y, 0.5)
      .unproject(this.rig.camera).sub(this.rig.camera.position).normalize();
    tp.tip.copy(tp.dir).multiplyScalar(state.focus || 55).add(this.rig.camera.position);
    if (tp.has) {
      tp.move.copy(tp.tip).sub(tp.last).divideScalar(Math.max(dt, 1e-3));
      const len = tp.move.length();
      if (len > 40) tp.move.multiplyScalar(40 / len);
      tp.smooth.lerp(tp.move, 1 - Math.exp(-8 * dt));
    }
    tp.last.copy(tp.tip);
    tp.has = true;
    this.particles.setPointer(this.rig.camera.position, tp.dir, tp.smooth, clamp01(this.pointer.strength));

    this.particles.update(state, dt, this.elapsed);

    this.fade = damp(this.fade, 1, 3.2, dt);
    this.particles.setOpacity(clamp01(this.fade) * state.opacity * this.densityAlpha);

    if (this.reduced) {
      this.staticAccum += dt;
      const moved = Math.abs(scrollY - this.lastScrollY) > 1;
      if (!moved && this.staticAccum < 0.14 && this.fade > 0.999) return;
      this.staticAccum = 0;
      this.lastScrollY = scrollY;
    }

    this.render();
    this.syncDom(state);
    this.maybePrefetch(live);
    if (this.fade > 0.02) this.canvas.classList.add('is-ready');
  }

  maybePrefetch(live) {
    if (live.index === this.prefetchedFor || live.t < 0.45 || Math.abs(live.velocity) > 2500) return;
    this.prefetchedFor = live.index;
    const chapters = this.timeline.chapters;
    const next = chapters[Math.min(live.index + 2, chapters.length - 1)];
    if (!next) return;
    schedule(() => {
      if (this.disposed) return;
      this.particles.prefetch(next.scene);
    });
  }

  syncDom(state) {
    if (state.chapterId !== this.lastChapter) {
      this.lastChapter = state.chapterId;
      this.root.dataset.universeChapter = state.chapterId;
    }
    const loud = Math.round(clamp01(state.loud) * 50) / 50;
    if (loud !== this.lastLoud) {
      this.lastLoud = loud;
      if (loud > 0.01) this.root.style.setProperty('--cv-loud', String(loud));
      else this.root.style.removeProperty('--cv-loud');
    }
  }

  get metrics() {
    return { tier: this.tier, dpr: this.dpr, particles: this.particles.activeCount, ...this.perf.stats };
  }

  start() {
    if (this.running || this.disposed) return;
    this.running = true;
    this.lastNow = 0;
    this._frame = this._frame || ((now) => this.frame(now));
    this.raf = requestAnimationFrame(this._frame);
  }

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  dispose() {
    this.stop();
    this.disposed = true;
    removeEventListener('resize', this._onResize);
    removeEventListener('orientationchange', this._onResize);
    removeEventListener('pageshow', this._onVisibility);
    document.removeEventListener('visibilitychange', this._onVisibility);
    this.canvas.removeEventListener('webglcontextlost', this._onContextLost);
    this.pointer.dispose();
    this.particles.dispose();
    this.post.dispose();
    this.rig.dispose();
    this.registry.dispose();
    this.renderer.dispose();
    this.root.style.removeProperty('--cv-loud');
    delete this.root.dataset.universeChapter;
    delete this.root.dataset.universeTier;
    this.canvas.classList.remove('is-ready');
  }
}

const schedule =
  typeof requestIdleCallback === 'function'
    ? (fn) => requestIdleCallback(fn, { timeout: 1200 })
    : (fn) => setTimeout(fn, 60);

function handOverToFallback() {
  document.documentElement.classList.remove('cv-universe-on');
  document.documentElement.classList.add('cv-universe-off');
  const dom = window.__cvBackgroundParticles;
  if (dom && typeof dom.boot === 'function') dom.boot();
}

function supportsWebGL() {
  try {
    const probe = document.createElement('canvas');
    return !!(probe.getContext('webgl2') || probe.getContext('webgl'));
  } catch (_) {
    return false;
  }
}

const canvas = document.getElementById('cv-universe');
const params = new URLSearchParams(location.search);
const flag = params.get('universe');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

let experience = null;
let enabled = false;

function enable() {
  if (enabled || !canvas) return;
  enabled = true;
  document.documentElement.classList.add('cv-universe-on');
  document.documentElement.classList.remove('cv-universe-off');
  const dom = window.__cvBackgroundParticles;
  if (dom && typeof dom.destroy === 'function') dom.destroy();

  try {
    experience = new WebGLExperience(canvas, { reduced, debug: flag === 'debug' });
    experience.start();
    if (flag === 'debug') {
      import('./debug.js')
        .then((m) => m.mountDebugPanel(experience))
        .catch((error) => console.warn('[universe] debug panel unavailable', error));
    }
  } catch (error) {
    console.warn('[universe] initialisation failed, falling back', error);
    experience = null;
    enabled = false;
    handOverToFallback();
  }
}

function disable() {
  if (!enabled) return;
  enabled = false;
  if (experience) {
    experience.dispose();
    experience = null;
  }
  handOverToFallback();
}

function boot() {
  if (!canvas) return;
  if (!supportsWebGL()) {
    handOverToFallback();
    return;
  }

  const on = flag !== 'off';
  if (on) enable();
  else handOverToFallback();

  window.__cvUniverse = {
    get enabled() {
      return enabled;
    },
    get experience() {
      return experience;
    },
    get metrics() {
      return experience ? experience.metrics : null;
    },
    enable,
    disable,
    toggle: () => (enabled ? disable() : enable()),
  };
}

if (document.readyState === 'complete') schedule(boot);
else addEventListener('load', () => schedule(boot), { once: true });

export { WebGLExperience };
