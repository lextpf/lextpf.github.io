
import * as THREE from './lib/three.js';
import { CHAPTERS, REDUCED_CHAPTERS, DEFAULTS } from './chapters.js';
import { FormationRegistry } from './formation-registry.js';
import { ParticleSystem } from './particle-system.js';
import { PostProcessing } from './post-processing.js';
import { ScrollTimeline } from './scroll-timeline.js';
import { CameraRig } from './camera-rig.js';
import { PointerController } from './pointer.js';
import { PerformanceManager, TIERS, detectTier, shouldPresent } from './performance.js';
import { clamp, clamp01, damp } from './lib/random.js';
import { BLACK_HOLE_HORIZON } from './formations/blackhole.js';

const HORIZON_WORLD_RADIUS = BLACK_HOLE_HORIZON;

// The particle count the look was authored against. Everything below that has to
// compensate to keep the same apparent density, so a lower tier reads as the
// same picture rather than a thinner one.
const DENSITY_REFERENCE = 100000;

// Particle sizes were tuned against a 1080p frame; taller frames scale up so a
// 4K panel does not render the universe as a dusting of single pixels.
const SIZE_REFERENCE_HEIGHT = 1080;

const QUALITY_LOG_MS = 2000;

class WebGLExperience {
  constructor(canvas, options) {
    this.canvas = canvas;
    this.reduced = options.reduced;
    this.debugRequested = options.debug;
    this.root = document.documentElement;

    /* alpha, because the canvas sits behind the CV and the page background has
       to show through. No antialias, depth or stencil: points do their own
       shaping in the fragment shader, and nothing here is ever occluded.
       preserveDrawingBuffer only under ?universe=debug, since it forces the
       driver to keep the frame around after present and costs real bandwidth,
       but without it a screenshot comes back blank. */
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
    // Linear, not sRGB. Post-processing does its own grading and tone handling,
    // so three must not apply a conversion on the way out as well.
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

    // Reduced motion skips hardware detection entirely and takes 'low': the
    // point is a calm page, and there is no reason to spend a high tier on it.
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
    // Where the black hole lands on screen and how big it is, recomputed each
    // frame by the rig and consumed by the composite pass.
    this.focusPoint = { centre: new THREE.Vector2(0.5, 0.5), radius: 0.1 };

    // Resolved once, not per frame. See syncDom for what gets written to them.
    this.loudTargets = Array.prototype.slice.call(
      document.querySelectorAll('#code, #hobbies'),
    );

    this.state = { ...DEFAULTS };
    this.overrides = null;
    this.review = null;
    this.dpr = 1;
    this.dprCap = settings.dpr;
    this.heightCap = settings.maxHeight;
    this.superSample = settings.superSample;
    this.densityAlpha = 1;
    this.densitySize = 1;
    this.elapsed = 0;
    this.lastNow = 0;
    this.lastRaf = 0;
    // Estimated refresh period, measured rather than assumed. Infinity until the
    // first two frames have been seen, which makes shouldPresent a no-op.
    this.vsync = Infinity;
    this.vsyncSince = 0;
    this.lastQualityLog = 0;
    this.fade = 0;
    this.staticAccum = 0;
    this.lastScrollY = -1;
    // Last values pushed to the DOM. Kept so syncDom can skip writes that would
    // not change anything.
    this.lastLoud = -1;
    this.lastChapter = '';
    this.prefetchedFor = -1;
    // Frames to skip before feeding the performance sampler. Boot, resize and
    // tier changes all produce slow frames that say nothing about the hardware,
    // and letting the ladder see them causes an immediate spurious downgrade.
    this.settle = 6;
    this.raf = 0;
    this.running = false;
    this.disposed = false;

    // Sample the timeline once before the first frame so the universe appears
    // already composed for wherever the page was scrolled to, rather than
    // starting at chapter one and racing to catch up. This also decides which
    // two formations are worth baking synchronously.
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
    // A lost context is unrecoverable here: every buffer, texture and compiled
    // program is gone. preventDefault is what tells the browser we are handling
    // it rather than leaving a dead canvas on screen.
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

  /* Bake every remaining formation during idle time, one per callback.

     Baking is a few tens of milliseconds each. Doing them all at once would
     block the main thread through the first second of the page; doing them
     lazily on arrival would stall a scroll. One at a time on idle callbacks
     spreads the cost across the period the visitor is still reading the hero,
     and by the time they scroll the cache is warm.

     Yielding between each is what makes it interruptible: a callback that
     arrives after dispose() simply stops the chain. */
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

  // Move to a quality rung. Called once at construction and thereafter by the
  // PerformanceManager whenever it decides to climb or drop.
  applyTier(tier, stats) {
    const settings = TIERS[tier];
    this.tier = tier;
    this.particles.setActiveCount(settings.count);
    this.post.bloomLevels = this.reduced ? 2 : settings.bloomLevels;
    this.post.trailsEnabled = this.reduced ? false : settings.trails && !!this.post.rtHistoryA;
    this.pointer.setScale(this.reduced ? 0 : settings.parallax);
    this.dprCap = settings.dpr;
    this.heightCap = settings.maxHeight;
    /* Fewer particles have to be brighter and bigger, or a lower tier reads as a
       dimmer, sparser page rather than the same page. Both exponents were tuned
       by eye against the reference count and both are capped, because past a
       point compensation stops reading as density and starts reading as blur. */
    const ratio = DENSITY_REFERENCE / settings.count;
    this.densityAlpha = clamp(Math.sqrt(ratio), 1.0, 1.65);
    this.densitySize = clamp(Math.pow(ratio, 0.34), 1.0, 1.6);
    // A root write, but only on an actual rung change (a handful of times per
    // session at most), never per frame. See syncDom for why that matters.
    this.root.dataset.universeTier = tier;
    // Changing the supersample factor changes every buffer in the chain, so
    // force setSize to treat the next call as a real resize.
    if (settings.superSample !== this.superSample) {
      this.superSample = settings.superSample;
      this.post.superSample = settings.superSample;
      this.post.width = -1;
    }
    // Reallocating buffers produces slow frames. Do not let the ladder judge
    // itself on the cost of its own last decision.
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
    // clientWidth rather than innerWidth: it excludes the scrollbar, so the
    // canvas matches the layout viewport the CV is laid out in.
    const width = this.root.clientWidth || innerWidth;
    const height = innerHeight;
    // Three ceilings at once: what the display asks for, what the tier allows,
    // and an absolute pixel-height cap so a very tall window cannot quietly
    // multiply the cost of every pass in the chain.
    const dpr = Math.min(
      devicePixelRatio || 1,
      this.dprCap || 1.5,
      (this.heightCap || Infinity) / Math.max(1, height),
    );
    if (width !== this.cssWidth || height !== this.cssHeight || dpr !== this.dpr) {
      this.cssWidth = width;
      this.cssHeight = height;
      this.dpr = dpr;
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(width, height, false);
      this.aspect = width / Math.max(1, height);
      this.rig.setAspect(this.aspect);
      this.narrow = width < 820;
    }
    this.post.setSize(Math.floor(width * this.dpr), Math.floor(height * this.dpr));
    // post may have clamped its own scale to stay inside the pixel budget, so
    // read renderScale back rather than assuming superSample was honoured.
    const scale = this.dpr * this.post.renderScale;
    const frameHeight = Math.floor(height * scale);
    this.particles.setViewport(Math.floor(width * scale), frameHeight);
    this.particles.setSizeScale(clamp(Math.max(this.dpr, frameHeight / SIZE_REFERENCE_HEIGHT), 1, 3));
    // Repaint immediately instead of waiting for the next frame, so dragging a
    // window edge does not smear a stale, wrongly-scaled image. Guarded because
    // resize() also runs during construction, before anything is loaded.
    if (this.particles.slots[this.particles.aIndex].id) this.render();
  }

  /* Re-stage the authored shot for a narrow viewport.

     Chapters are composed for a landscape window. On a phone the same camera
     crops the formation badly and the effects, tuned for a wide frame, are far
     too heavy in a small one. So the camera pulls back, the horizontal offsets
     that would push the subject off a narrow screen collapse toward the centre,
     the framing lifts, and every effect is scaled down.

     This mutates the state object in place rather than returning a copy: it runs
     every frame, and the state object is deliberately long-lived. */
  reframe(state) {
    if (!this.narrow) return state;
    // Portrait needs more pull-back than merely narrow does. narrowPull is the
    // per-chapter trim on top, for shots that crop worse than the rest.
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
    // Re-arm first, so an exception anywhere below does not silently end the
    // animation loop for the rest of the session.
    this.raf = requestAnimationFrame(this._frame);

    /* Estimate the display's refresh period from the gaps between rAF calls.

       Every gap is some whole number of refreshes, so the smallest one seen is
       the period itself. The 2 second reset stops the estimate being permanently
       poisoned by one anomalously short gap, and lets it re-converge if the
       window is dragged to a display running at a different rate. Gaps outside
       0.5..100ms are timer noise or stalls, not refreshes. */
    if (this.lastRaf) {
      const raw = now - this.lastRaf;
      if (raw > 0.5 && raw < 100) {
        if (now - this.vsyncSince > 2000) {
          this.vsync = raw;
          this.vsyncSince = now;
        } else {
          this.vsync = Math.min(this.vsync, raw);
        }
      }
    }
    this.lastRaf = now;

    // The 60fps cap, and deliberately the first thing after the timing bookkeeping:
    // a capped frame returns here having done essentially no work.
    if (this.lastNow && !shouldPresent(now - this.lastNow, this.vsync)) return;

    // Clamped hard at 50ms. A backgrounded tab, a debugger pause or a long GC
    // would otherwise hand every integrator below one enormous step and fling
    // the camera across the scene.
    const dtMs = this.lastNow ? now - this.lastNow : 16.7;
    this.lastNow = now;
    const dt = clamp(dtMs / 1000, 0.001, 0.05);
    this.elapsed += dt;
    if (this.settle > 0) this.settle--;
    else this.perf.sample(dtMs, now);

    // The quality heartbeat. Distinct from the "quality ->" line applyTier logs
    // on a rung change: this one keeps reporting once the ladder has converged
    // and stopped moving, which is the normal steady state. _check_quality_log
    // asserts it keeps arriving, so the [universe] prefix and the shape of this
    // string are load-bearing.
    if (this.perf.stats.p50 > 0 && now - this.lastQualityLog > QUALITY_LOG_MS) {
      this.lastQualityLog = now;
      const s = this.perf.stats;
      const fps = 1000 / s.p50;
      console.info(
        `[universe] ${this.tier} · ${this.particles.activeCount} particles · dpr ${this.dpr.toFixed(2)} · ` +
        `p50 ${s.p50.toFixed(1)}ms (${fps.toFixed(0)}fps) · p95 ${s.p95.toFixed(1)}ms · budget ${s.budget.toFixed(1)}ms`
      );
    }

    const live = this.timeline.update(dt);
    // A scroll jump produced a teleport rather than a smooth move; the frames
    // that follow are not representative of the hardware.
    if (live.snapped) this.settle = Math.max(this.settle, 10);
    const state = this.state;
    for (const key in live) state[key] = live[key];
    this.reframe(state);
    state.size *= this.densitySize;
    // Debug-panel escape hatches, both no-ops in production: `overrides` pins
    // individual knobs to slider values, `review` pins a single formation so it
    // can be inspected without scrolling to its chapter.
    if (this.overrides) Object.assign(state, this.overrides);
    if (this.review && this.review.scene) {
      state.sceneA = this.review.scene;
      state.sceneB = this.review.scene;
      state.morph = 0;
    }

    this.pointer.update(dt);
    this.rig.update(state, this.pointer, dt, this.elapsed);

    /* Turn the 2D pointer into something the particles can be pushed by.

       unproject casts the cursor position back out through the camera into a
       world-space ray. A point on that ray at the focus distance is the "tip",
       roughly where the cursor is in the scene, and the frame-to-frame movement
       of that tip is what gives a flick its force: hovering displaces, sweeping
       shoves. Clamped at 40 units/s so a fast drag across the window cannot
       launch the formation, and smoothed so the push has weight instead of
       snapping to every jittery mouse sample.

       Allocated lazily and reused, like the rig's scratch vectors: five fresh
       Vector3s per frame is exactly the kind of steady garbage that shows up as
       periodic collection hitches. */
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
    // Skipped on the very first frame, where there is no previous tip and the
    // implied velocity would be the whole distance from the origin.
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

    // One global fade-in from black on first run, so the universe arrives rather
    // than appearing. Combined here with the chapter's own opacity and the
    // density compensation, in one uniform write.
    this.fade = damp(this.fade, 1, 3.2, dt);
    this.particles.setOpacity(clamp01(this.fade) * state.opacity * this.densityAlpha);

    /* Under reduced motion, stop redrawing a picture that is not changing.

       The reduced chapters still animate, just very slowly, so this throttles to
       roughly 7fps while the page is still and returns to full rate the moment
       the scroll moves. Everything above this point has already run, so the
       state stays current; only the expensive part is skipped. */
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
    // Revealed by CSS transition once there is something to see, so the canvas
    // does not flash empty over the page background on load.
    if (this.fade > 0.02) this.canvas.classList.add('is-ready');
  }

  /* Warm the chapter after next into the spare slot.

     Index + 2, not + 1: the next chapter is already bound as B. Gated on being
     45% of the way in, by which point the direction of travel is clear, and on
     not scrolling violently, because a fast scroll will have blown through
     several chapters before the idle callback ever runs and would be prefetching
     the wrong one. `prefetchedFor` keeps it to once per chapter. */
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

  /* The only place the universe writes to the document, and written defensively
     for one reason: an inline style write, or a redeclared inherited custom
     property, on <html> forces a style recalculation of the whole document. On
     this page that is around 68ms, and it lands mid-scroll, so it reads as lag.

     Hence both rules below.

     --cv-loud goes onto #code and #hobbies directly, never onto the root, even
     though a root variable would be tidier. Its only consumer is one rule
     matching those two elements, so writing it at the root buys nothing and
     costs a full recalc. It is also quantised to 1/50ths first, which turns a
     continuously varying float into a handful of distinct values per chapter and
     skips almost every write.

     The two dataset attributes ARE root writes, but they are gated on change and
     only move on chapter or tier boundaries: a few dozen times per session, not
     sixty times a second.

     _check_root_style_writes.mjs exists to catch this regressing. */
  syncDom(state) {
    if (state.chapterId !== this.lastChapter) {
      this.lastChapter = state.chapterId;
      this.root.dataset.universeChapter = state.chapterId;
    }
    const loud = Math.round(clamp01(state.loud) * 50) / 50;
    if (loud !== this.lastLoud) {
      this.lastLoud = loud;
      for (let i = 0; i < this.loudTargets.length; i++) {
        // Removed rather than set to 0, so the CSS falls back to its own default
        // and the property does not linger on the element.
        if (loud > 0.01) this.loudTargets[i].style.setProperty('--cv-loud', String(loud));
        else this.loudTargets[i].style.removeProperty('--cv-loud');
      }
    }
  }

  get metrics() {
    return { tier: this.tier, dpr: this.dpr, particles: this.particles.activeCount, ...this.perf.stats };
  }

  // Idempotent, because it is also the visibilitychange handler: returning to a
  // backgrounded tab calls it whether or not the loop was actually stopped.
  // Clearing lastNow makes the first frame back compute a default dt instead of
  // however long the tab was hidden.
  start() {
    if (this.running || this.disposed) return;
    this.running = true;
    this.lastNow = 0;
    // Bound once and cached. A fresh closure per frame would be garbage, and
    // cancelAnimationFrame needs a stable reference.
    this._frame = this._frame || ((now) => this.frame(now));
    this.raf = requestAnimationFrame(this._frame);
  }

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /* Give everything back: listeners, GPU resources, and the marks left on the
     document. This runs on ?universe=off toggling and on any handover to the
     fallback, so it has to be complete or repeated toggling leaks a full
     renderer each time.

     `disposed` also stops the idle-callback chains (primeRemaining, prefetch)
     that may still have callbacks queued against a dead experience. */
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
    this.loudTargets.forEach((el) => el.style.removeProperty('--cv-loud'));
    delete this.root.dataset.universeChapter;
    delete this.root.dataset.universeTier;
    this.canvas.classList.remove('is-ready');
  }
}

// Run this when the browser is not busy. The timeout is the promise that it will
// run eventually even on a page that never goes idle. Safari lacked
// requestIdleCallback for years, hence the setTimeout arm.
const schedule =
  typeof requestIdleCallback === 'function'
    ? (fn) => requestIdleCallback(fn, { timeout: 1200 })
    : (fn) => setTimeout(fn, 60);

/* The single exit. No WebGL, context lost, or construction threw: everything
   ends here, swaps the html classes the CSS keys off, and starts the DOM
   particle background that the source HTML left dormant.

   Safe to call more than once. Both class operations are idempotent, and the
   fallback's own boot() guards against double-starting. */
function handOverToFallback() {
  document.documentElement.classList.remove('cv-universe-on');
  document.documentElement.classList.add('cv-universe-off');
  const dom = window.__cvBackgroundParticles;
  if (dom && typeof dom.boot === 'function') dom.boot();
}

// Cheapest possible probe: creating a context on a throwaway canvas. Some
// browsers throw rather than returning null, hence the try.
function supportsWebGL() {
  try {
    const probe = document.createElement('canvas');
    return !!(probe.getContext('webgl2') || probe.getContext('webgl'));
  } catch (_) {
    return false;
  }
}

/* Module scope from here down: the boot sequence.

   '#cv-universe' is a build contract. scripts/encrypt-cv.mjs mangles every id in
   the document, and it only knows to spare this one because it reads this file
   and finds the literal. It has been broken before: the canvas became id="_9b",
   this lookup returned null, boot() took its early return, and neither the
   universe nor the fallback started. */
const canvas = document.getElementById('cv-universe');
const params = new URLSearchParams(location.search);
// ?universe=off forces the DOM fallback, ?universe=debug mounts the slider panel.
const flag = params.get('universe');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

let experience = null;
let enabled = false;

function enable() {
  if (enabled || !canvas) return;
  enabled = true;
  document.documentElement.classList.add('cv-universe-on');
  document.documentElement.classList.remove('cv-universe-off');
  // Only one background at a time. The DOM particles may already be running,
  // either because the inline probe started them or because we fell back earlier
  // and are now being re-enabled from the console.
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
    // Warn, never throw. A background effect failing must not take the CV with
    // it, and the page is perfectly readable without it.
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

  // The console handle. Getters rather than values so it keeps reporting the
  // live experience across enable/disable cycles instead of a stale snapshot.
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

/* Boot after load, and then only when the browser is idle.

   Deliberately last in the queue. The CV's own fonts, images and layout matter
   more than the background does, and compiling shaders while they are still
   landing delays the thing the visitor actually came for. The readyState check
   covers the module arriving after 'load' has already fired. */
if (document.readyState === 'complete') schedule(boot);
else addEventListener('load', () => schedule(boot), { once: true });

export { WebGLExperience };
