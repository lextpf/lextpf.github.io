
import * as THREE from './lib/three.js';
import { CHAPTERS, REDUCED_CHAPTERS, DEFAULTS, PORTRAIT_VARIANTS } from './chapters.js';
import { FormationRegistry } from './formation-registry.js';
import { ParticleSystem } from './particle-system.js';
import { PostProcessing } from './post-processing.js';
import { ScrollTimeline } from './scroll-timeline.js';
import { CameraRig } from './camera-rig.js';
import { PointerController } from './pointer.js';
import { PerformanceManager, QualityTrial, TIERS, VsyncEstimator, detectTier, shouldPresent, trialRefresh } from './performance.js';
import { clamp, clamp01, smootherstep } from './lib/random.js';
import { AVATAR } from './lib/modes.js';
import { BLACK_HOLE_HORIZON } from './formations/blackhole.js';

const HORIZON_WORLD_RADIUS = BLACK_HOLE_HORIZON;

// The particle count the look was authored against. Everything below that has to
// compensate to keep the same apparent density, so a lower tier reads as the
// same picture rather than a thinner one.
const DENSITY_REFERENCE = 100000;

// Particle sizes were tuned against a 1080p frame; taller frames scale up so a
// 4K panel does not render the universe as a dusting of single pixels.
const SIZE_REFERENCE_HEIGHT = 1080;

// The CSS root size at which the page's design pixel (--dpx on the source :root)
// is exactly 1px: the 250% zoom reference. Above it the whole page grows with the
// root, so particle sizes and the scroll-speed scale grow with it too.
const DESIGN_ROOT = 17.7;

/* A legibility trim on top of the authored sizes, so formations read as geometry
   rather than as haze. Applied post-blend beside the density compensation, which
   makes it the one place that reaches every chapter of both scores, every tier and
   every in-between morph frame at once.

   8% is bounded on two sides. Above, densitySize already reaches 1.40 on the
   minimal tier against its own 1.6 blur cap, so anything past ~1.14 pushes the
   weakest tier through a ceiling its author set deliberately. Below, sprites are
   additive with no area normalisation, so a k times size is a k squared light lift
   - measured on frozen frames, 1.08 buys 4-7% more pixels carrying structure for
   1-3% more mean brightness, with clipping flat to four decimals.

   Since the point model (shaders/particles.js) a particle's size is its energy
   and every particle is a crisp dot, so this trim is now a 1.166x light lift on
   the dots rather than a wider sprite; the pixel counts above were measured on
   the old size-as-blur sprites. */
const SIZE_TRIM = 1.08;

const QUALITY_LOG_MS = 2000;

// The entrance: a dark beat, then the fade proper (reduced motion: no beat,
// 0.9 s). The fade waits at the end of the beat until every formation is
// baked, or PRIME_HOLD_MS after the first frame, whichever comes first.
const FADE_BEAT = 0.35;
const FADE_TIME = 1.6;
const FADE_TIME_REDUCED = 0.9;
const PRIME_HOLD_MS = 1200;

// On trial the landing pair is judged mid-morph: at rest the shader never
// evaluates formation B, and the first scroll does.
const TRIAL_MORPH = 0.5;

class WebGLExperience {
  constructor(canvas, options) {
    this.canvas = canvas;
    this.reduced = options.reduced;
    this.debugRequested = options.debug;
    // The boot's exit if something fails after construction has returned (the
    // asynchronous prewarm). The module passes disable(); see enable().
    this.onFail = options.onFail || null;
    this.root = document.documentElement;

    /* alpha, because the canvas sits behind the CV and the page background has
       to show through. No antialias, depth or stencil: points do their own
       shaping in the fragment shader, and nothing here is ever occluded.
       preserveDrawingBuffer only under ?universe=debug, since it forces the
       driver to keep the frame around after present and costs real bandwidth,
       but without it a screenshot comes back blank. On trial the context also
       refuses a software fallback, as the head probe's did. */
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: options.trial === true,
      preserveDrawingBuffer: options.debug === true,
    });
    this.renderer.setClearColor(0x000000, 0);
    // Linear, not sRGB. Post-processing does its own grading and tone handling,
    // so three must not apply a conversion on the way out as well.
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    // Every size handed to the renderer is already in device pixels (resize),
    // so three must not multiply it by a ratio of its own.
    this.renderer.setPixelRatio(1);

    /* Behind the page's loader (the head probe's gate) the universe has to earn
       its place: it runs the high rung on trial (performance.js QualityTrial) and
       stays only if the machine holds it. Reduced motion is tried the same way
       and then takes its calm 'low' (endTrial). Without the gate (?universe=on,
       the lab pages) the old guess stands: reduced motion takes 'low', everything
       else what detectTier makes of the hardware. */
    const gl = this.renderer.getContext();
    this.trial = options.trial ? new QualityTrial() : null;
    this.verdict = null;
    this.tier = this.trial ? 'high' : this.reduced ? 'low' : detectTier(gl);
    const settings = TIERS[this.tier];

    this.registry = new FormationRegistry(settings.count);
    this.particles = new ParticleSystem(this.registry, settings.count);
    this.post = new PostProcessing(this.renderer, {
      bloomLevels: this.reduced ? 2 : settings.bloomLevels,
      trails: this.reduced ? false : settings.trails,
      // No camera shutter under reduced motion: like the trails it smears the
      // picture along its motion, and the reduced page is meant to be calm. A
      // reduced flight is drawn as sharp frames.
      shutter: !this.reduced,
      edgeLens: !this.reduced,
      superSample: settings.superSample,
      master: 0.74,
    });
    this.rig = new CameraRig(1);
    this.pointer = new PointerController(this.reduced ? 0 : settings.parallax);
    this.timeline = this.reduced
      ? new ScrollTimeline(REDUCED_CHAPTERS, { ignition: [0.35, 0.9] })
      : new ScrollTimeline(CHAPTERS);
    // The hero's portrait (chapters.js PORTRAIT_VARIANTS), staged before the
    // first sample so the formations baked at boot are the ones on screen.
    this.heroEl = document.getElementById('hero');
    this.portrait = null;
    this.stagePortrait();
    // The variant chooser can set the variant after boot.
    this._variantObserver = typeof MutationObserver === 'function'
      ? new MutationObserver(() => {
        if (this.disposed) return;
        this.stagePortrait();
        this.fitPortrait();
        this.dirty = true;
      })
      : null;
    if (this._variantObserver) this._variantObserver.observe(this.root, { attributes: true, attributeFilter: ['data-cv-variant'] });

    this.scene = new THREE.Scene();
    this.scene.add(this.particles.points, this.particles.mirror);

    this.perf = new PerformanceManager(this.tier, (tier, stats) => this.applyTier(tier, stats));
    // Where the black hole lands on screen and how big it is, recomputed each
    // frame by the rig and consumed by the composite pass.
    this.focusPoint = { centre: new THREE.Vector2(0.5, 0.5), radius: 0.1 };

    // Resolved once, not per frame. See syncDom for what gets written to them.
    this.loudTargets = Array.prototype.slice.call(
      document.querySelectorAll('#code, #hobbies'),
    );

    this.state = { ...DEFAULTS };
    // root / DESIGN_ROOT, at least 1; measured in resize().
    this.designScale = 1;
    // How present the universe is overall (the boot fade), for the composite's
    // horizon: the disc is painted in 2D, not by particles, so particle opacity
    // alone would leave a full-strength disc over a half-faded field.
    this.state.presence = 0;
    this.overrides = null;
    this.review = null;
    // The effective device-pixel ratio of the canvas buffer (buffer width over
    // CSS width), not a cap: the buffer is always the canvas's native box.
    this.dpr = 1;
    this.bufferWidth = 0;
    this.bufferHeight = 0;
    // The last box the ResizeObserver reported (see observeCanvas), used while
    // it still describes the canvas's CSS size.
    this.box = null;
    this.superSample = settings.superSample;
    this.densityAlpha = 1;
    this.densitySize = 1;
    this.elapsed = 0;
    this.lastNow = 0;
    // The refresh period, measured rather than assumed, and the frame clock
    // snapped to it (performance.js). vsync is Infinity until two rAF gaps have
    // been seen, which makes shouldPresent a no-op.
    this.vsyncClock = new VsyncEstimator();
    this.vsync = Infinity;
    // On trial the estimator also reads the bare callbacks while the programs
    // compile, and the period it holds when the loop starts is kept (idleVsync):
    // the panel's refresh, before the trial's load can thin the callbacks out.
    this.idleVsync = Infinity;
    this.lastQualityLog = 0;
    this.fade = 0;
    // Seconds since the entrance began; only advances while fade < 1, so a
    // harness that pins fade = 1 keeps it there.
    this.fadeT = 0;
    // Timestamp of the first frame; the entrance's wait for priming counts
    // from it.
    this.bootAt = 0;
    // Every formation of this timeline baked (primeRemaining).
    this.primed = false;
    // Reduced motion: this frame kept the last picture instead of drawing.
    // Anything that carries history between frames must treat the next drawn
    // frame as a cut.
    this.frozen = false;
    // Something changed that a still reduced frame has to draw anyway: a new
    // rung, a restart.
    this.dirty = true;
    this.lastScrollY = -1;
    // The programs compile asynchronously (prewarm below). Until they have,
    // start() only records that it was asked.
    this.ready = false;
    this.startWanted = false;
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

    // Sizes the canvas synchronously (resize); the observer then refines it
    // to the exact device-pixel box.
    this.applyTier(this.tier);
    this.observeCanvas();

    /* A quiet boot. The programs compile off the main thread where the driver
       allows it and the loop starts only once they are ready, so the first
       frames do not stall on a shader compile. The canvas stays invisible
       until the entrance has drawn something (.is-ready), so the wait never
       shows. A failure here is the same failure a throwing constructor would
       be, and takes the same exit. */
    this._prewarm = this.post.prewarm(this.scene, this.rig.camera, () => this.disposed);
    if (this.trial) {
      const idle = (now) => {
        if (this.disposed || this.running) return;
        this.vsyncClock.sample(now);
        requestAnimationFrame(idle);
      };
      requestAnimationFrame(idle);
    }
    this._prewarm.then(
      () => {
        if (this.disposed) return;
        this.ready = true;
        if (this.startWanted) this.start();
      },
      (error) => {
        if (this.disposed) return;
        console.warn('[universe] initialisation failed, falling back', error);
        if (this.onFail) this.onFail();
        else {
          this.dispose();
          handOverToFallback();
        }
      },
    );

    // A window resize is the observer's to handle wherever it can report
    // device pixels; elsewhere this is the only resize signal for a change of
    // devicePixelRatio that leaves the CSS box alone.
    this._onResize = () => {
      if (!this.exactBox) this.resize();
    };
    // A hidden tab stops the callbacks; the first frame back spans the pause,
    // which the trial must not judge (hiddenGap).
    this._onVisibility = () => {
      if (document.hidden) this.hiddenGap = true;
      else this.start();
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

    this.primeRemaining(first.settledIndex);
  }

  /* Bake every remaining formation during idle time, one per callback, nearest
     chapter first.

     Baking is 20-130 ms each. Doing them all at once would block the main
     thread through the first second of the page; doing them lazily on arrival
     would stall a scroll. Back to back on idle callbacks they are done in
     about half a second on the owner's machine, while the entrance is still
     dark: the fade waits for `primed` (see frame), so none of these stalls
     lands in it.
     Nearest first, so a visitor who scrolls at once meets baked formations in
     the order they will need them.

     Yielding between each is what makes it interruptible: a callback that
     arrives after dispose() simply stops the chain. */
  primeRemaining(here = 0) {
    const distance = new Map();
    this.timeline.chapters.forEach((chapter, i) => {
      const d = Math.abs(i - here);
      if (!(distance.get(chapter.scene) <= d)) distance.set(chapter.scene, d);
    });
    const queue = [...distance.keys()]
      .filter((id) => !this.registry.cache.has(id))
      .sort((a, b) => distance.get(a) - distance.get(b));
    const step = () => {
      if (this.disposed) return;
      const id = queue.shift();
      if (!id) {
        this.primed = true;
        return;
      }
      this.registry.get(id);
      schedule(step);
    };
    if (queue.length) schedule(step);
    else this.primed = true;
  }

  /* Size the canvas to the device pixels it actually covers.

     The buffer used to be floor(CSS size x a capped ratio). At a fractional
     devicePixelRatio that lands a fraction of a pixel off the box the
     compositor draws the canvas into, and the compositor resamples the whole
     frame to fit: measured on a 1-px checkerboard at real device ratios, 49%
     of single-pixel contrast survived at 1.25 and on a 4K panel at 150%, 24%
     at 2 (the old 1.75 cap). A ResizeObserver on the
     'device-pixel-content-box' reports the exact integer box instead, and a
     buffer of exactly that size is composited 1:1 at every ratio. Safari has
     no such box; there the content box times devicePixelRatio, rounded, is
     the best estimate, and the window's resize event stays wired (a change of
     ratio alone moves no CSS box). */
  observeCanvas() {
    this.exactBox = false;
    if (typeof ResizeObserver !== 'function') return;
    this._boxObserver = new ResizeObserver((entries) => this.onCanvasBox(entries[entries.length - 1]));
    try {
      this._boxObserver.observe(this.canvas, { box: 'device-pixel-content-box' });
      this.exactBox = true;
    } catch (_) {
      this._boxObserver.observe(this.canvas);
    }
  }

  /* A device box is the CSS box times the ratio with its edges snapped to
     whole pixels, so it can differ from that product by at most a pixel. One
     that differs by more is not describing this canvas at this ratio: under
     device emulation (DevTools' device mode, Playwright's deviceScaleFactor)
     Chrome reports the box at the window's real ratio while devicePixelRatio
     and the rendering follow the emulated one. The rounded product is right
     there, to within that same pixel. */
  onCanvasBox(entry) {
    if (this.disposed || !entry) return;
    const rect = entry.contentRect;
    const ratio = devicePixelRatio || 1;
    const wantW = rect.width * ratio;
    const wantH = rect.height * ratio;
    const exact = entry.devicePixelContentBoxSize && entry.devicePixelContentBoxSize[0];
    const trusted = exact && Math.abs(exact.inlineSize - wantW) <= 1 && Math.abs(exact.blockSize - wantH) <= 1;
    const w = trusted ? exact.inlineSize : Math.round(wantW);
    const h = trusted ? exact.blockSize : Math.round(wantH);
    // A hidden canvas (display: none) has no box to match.
    if (!(w > 0 && h > 0)) return;
    this.box = { cssWidth: rect.width, cssHeight: rect.height, ratio, w, h, exact: !!trusted };
    this.resize();
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
    /* Fewer particles have to be brighter and bigger, or a lower tier reads as a
       dimmer, sparser page rather than the same page. Both exponents were tuned
       by eye against the reference count and both are capped, because past a
       point compensation stops reading as density and starts reading as blur.
       densitySize reaches the particles twice: through state.size, which is
       their energy, and through setDensity, which widens their dot footprint
       by the same factor, so the extra light spreads the way the old enlarged
       sprites did instead of piling into hotter points. */
    const ratio = DENSITY_REFERENCE / settings.count;
    this.densityAlpha = clamp(Math.sqrt(ratio), 1.0, 1.65);
    this.densitySize = clamp(Math.pow(ratio, 0.34), 1.0, 1.6);
    this.particles.setDensity(this.densitySize);
    // Brighter dots would let dust into the bloom: the threshold follows them.
    this.post.setDensity(this.densityAlpha);
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
    this.dirty = true;
    // A rung is a cut for the camera shutter: the next frame draws sharp.
    this.post.invalidateMotion();
    // A rung never changes the resolution; this re-measures, so a harness that
    // resizes the viewport and applies a tier reads the new frame at once.
    this.resize();
    if (stats) {
      console.info(
        `[universe] quality -> ${tier} (p95 ${stats.p95.toFixed(1)}ms, avg ${stats.avg.toFixed(1)}ms, ` +
        `${settings.count} particles, native dpr ${this.dpr.toFixed(2)})`
      );
    }
  }

  /* Size everything to the canvas's device-pixel box.

     Callable at any time, synchronously: it runs at construction and whenever
     a tier is applied, and harnesses call it directly after changing the
     viewport. It measures the canvas's CSS box (fixed at inset 0 and 100% x
     100%, so the layout viewport less the scrollbar, the box the CV is laid
     out in) and uses the observer's exact device box while that box still
     describes this CSS size at this ratio; otherwise CSS size x
     devicePixelRatio, rounded, until the observer reports. Nothing caps the
     result: no ratio ceiling, no height ceiling, no pixel budget. When the
     ladder needs to buy time it cuts particles, never pixels. */
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    let cssWidth = rect.width;
    let cssHeight = rect.height;
    if (!(cssWidth > 0 && cssHeight > 0)) {
      cssWidth = this.root.clientWidth || innerWidth;
      cssHeight = innerHeight;
    }
    const ratio = devicePixelRatio || 1;
    const box = this.box;
    const observed = box && box.ratio === ratio &&
      Math.abs(box.cssWidth - cssWidth) < 0.01 && Math.abs(box.cssHeight - cssHeight) < 0.01;
    const width = observed ? box.w : Math.max(1, Math.round(cssWidth * ratio));
    const height = observed ? box.h : Math.max(1, Math.round(cssHeight * ratio));
    const changed = width !== this.bufferWidth || height !== this.bufferHeight;
    if (changed || cssWidth !== this.cssWidth || cssHeight !== this.cssHeight) {
      this.cssWidth = cssWidth;
      this.cssHeight = cssHeight;
      this.dpr = width / cssWidth;
      // Attributes only: the canvas's CSS box is the page's, never written.
      if (changed) this.renderer.setSize(width, height, false);
      this.bufferWidth = width;
      this.bufferHeight = height;
      this.aspect = width / height;
      this.rig.setAspect(this.aspect);
      this.narrow = cssWidth < 820;
    }
    this.post.setSize(width, height);
    // The portrait's camera is fitted to the medallion at this size.
    this.fitPortrait();
    // The particles draw into the scene target, so that is their viewport.
    // uSizeScale: the authored sizes were tuned on a 1080p frame at ratio 1.
    // The buffer is always native now, so the bound is the densest real screen:
    // ratio-4 phones, and 8K-class buffers (4320 rows).
    const sceneWidth = this.post.rtScene.width;
    const sceneHeight = this.post.rtScene.height;
    this.particles.setViewport(sceneWidth, sceneHeight);
    // A read, never a write, on <html>. At 100% on a large screen the page is the
    // 250% view scaled by designScale; at 250% the ratio term carries the same
    // factor, so both draw the same particles.
    const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    this.designScale = Math.max(1, rootPx / DESIGN_ROOT);
    this.particles.setSizeScale(clamp(Math.max(sceneWidth / cssWidth * this.designScale, sceneHeight / SIZE_REFERENCE_HEIGHT), 1, 4));
    // Repaint immediately instead of waiting for the next frame, so dragging a
    // window edge does not smear a stale, wrongly-scaled image (a new buffer
    // starts cleared). Not before the programs are ready: a draw now would
    // compile them synchronously, the stall the prewarm exists to avoid.
    if (changed) {
      this.dirty = true;
      if (this.ready && this.particles.slots[this.particles.aIndex].id) this.render();
    }
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
    state.frameX *= 0.22;
    state.holdPush *= 0.5;
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

  /* The hero's portrait (chapters.js PORTRAIT): where the CV carries a photo
     the hero is the avatar and contact the program under the portrait's sky.
     Staged on the timeline's own chapter objects, which it reads every frame,
     so the bands blend into and out of it like any authored chapter; the
     authored values are kept and put back when the variant changes or the
     experience is disposed. */
  stagePortrait(allow = true) {
    const chapters = this.timeline.chapters;
    const hero = chapters.find((c) => c.id === 'hero');
    const contact = chapters.find((c) => c.id === 'contact');
    const spec = hero && hero.portrait;
    const anchor = spec ? document.querySelector(spec.anchor) : null;
    // The portrait's maps travel inside the document (formations/avatar.js).
    const data = document.getElementById('cv-avatar-data');
    const want = !!(allow && spec && contact && anchor && data && PORTRAIT_VARIANTS.includes(this.root.getAttribute('data-cv-variant')));
    // The page hides the photo from the first paint wherever the universe
    // runs (#cv-avatar-style); a photo this variant shows and the universe
    // will not replace stays.
    if (allow && !want && anchor && this.root.hasAttribute('data-cv-variant') && anchor.offsetWidth > 0) {
      this.root.classList.add('cv-avatar-photo');
    }
    if (want === !!this.portrait) return;
    if (want) {
      const keep = { scene: hero.scene };
      Object.keys(spec.knobs).concat(['camX', 'camY', 'camZ', 'tgtX', 'tgtY', 'tgtZ', 'frameX']).forEach((k) => {
        keep[k] = hero[k];
      });
      this.portrait = { hero, contact, spec, anchor, keep, contactScene: contact.scene, lit: false };
      Object.assign(hero, spec.knobs);
      hero.scene = spec.scene;
      contact.scene = spec.contactScene;
      // Until the first fit: the frame the sky is laid for.
      [hero.camX, hero.camY, hero.camZ] = spec.desk.cam;
      [hero.tgtX, hero.tgtY, hero.tgtZ] = spec.desk.tgt;
      if (typeof ResizeObserver === 'function') {
        this._anchorObserver = new ResizeObserver(() => this.fitPortrait());
        this._anchorObserver.observe(anchor);
        if (this.heroEl) this._anchorObserver.observe(this.heroEl);
      }
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => this.fitPortrait());
    } else {
      const p = this.portrait;
      Object.assign(p.hero, p.keep);
      p.contact.scene = p.contactScene;
      if (this._anchorObserver) this._anchorObserver.disconnect();
      this._anchorObserver = null;
      if (this.heroEl) delete this.heroEl.dataset.avatar;
      this.portrait = null;
    }
    this.prefetchedFor = -1;
    // The knobs may change the hero's band and camDelay: re-lay the bands and
    // let the camera re-read which bands hold it.
    this.timeline._held = null;
    this.timeline.measureLayout();
  }

  /* Fit the hero camera so the portrait's circle (lib/modes.js AVATAR: radius
     side / 2 about the centre) lands on the photo's circle in the medallion
     at scroll 0: its centre on the medallion's centre, its radius on the
     photo's. The camera looks straight down -z from in front of the portrait
     (no oblique view of the relief); its distance sets the size, its height
     the row, and a horizontal lens shift the column. The medallion is read through the offset chain,
     which ignores transforms, so its entrance and scroll parallax do not move
     the fit. On a narrow viewport reframe() moves the camera after the blend;
     the fit stores reframe's inverse, so the hero's camera lands exactly here
     and the band into contact blends from it like any authored camera. */
  fitPortrait() {
    const p = this.portrait;
    if (!p || !(this.cssWidth > 0 && this.cssHeight > 0)) return;
    const el = p.anchor;
    if (!el.isConnected || !el.offsetWidth) return;
    let x = 0;
    let y = 0;
    for (let e = el; e; e = e.offsetParent) {
      x += e.offsetLeft;
      y += e.offsetTop;
    }
    const rem = parseFloat(getComputedStyle(this.root).fontSize) || 16;
    const radius = (el.offsetWidth / 2 - p.spec.inset * rem) * (p.spec.scale || 1);
    if (!(radius > 0)) return;
    const W = this.cssWidth;
    const H = this.cssHeight;
    const sx = ((x + el.offsetWidth / 2) / W) * 2 - 1;
    const sy = 1 - ((y + el.offsetHeight / 2) / H) * 2;
    const h = p.hero;
    const t = Math.tan((h.fov * Math.PI) / 360);
    const [ax, ay, az] = AVATAR.centre;
    const D = AVATAR.side / 2 / ((radius / (H / 2)) * t);
    // Head-on across: the camera stands in front of the portrait and a lens
    // shift (frameX, in half-widths) carries it out to the medallion, so a
    // medallion at the side of the frame still sees the face straight on.
    const camY = ay - sy * D * t;
    const camZ = az + D;
    if (this.narrow) {
      const pull = (this.aspect < 0.8 ? 1.34 : 1.16) * (h.narrowPull || 1);
      h.camX = h.tgtX = ax / 0.22;
      h.frameX = sx / 0.22;
      h.camY = (camY - 2.2) / 0.7;
      h.camZ = camZ / pull;
    } else {
      h.camX = h.tgtX = ax;
      h.frameX = sx;
      h.camY = camY;
      h.camZ = camZ;
    }
    h.tgtY = camY;
    h.tgtZ = az;
    p.fit = { sx, sy, radius, D };
    this.dirty = true;
  }

  /* The camera shutter's blur plane is the subject: the rig's distance to its
     look-at point, not state.focus (a depth-of-field knob: contact focuses at
     58 on a subject 46 away, projects at 48 on one at 54, opensource at 46 down
     a tunnel it looks 65 along). The timeline's snap reaches the shutter
     through state.snapped. */
  render() {
    this.rig.projectSphere(HORIZON_WORLD_RADIUS, this.aspect, this.focusPoint);
    this.post.holeFx = this.particles.holeCrescent(this.rig.camera);
    const subject = this.rig.camera.position.distanceTo(this.rig.look);
    this.post.render(this.scene, this.rig.camera, this.state, this.focusPoint, this.elapsed, subject);
  }

  frame(now) {
    if (!this.running) return;
    // Re-arm first, so an exception anywhere below does not silently end the
    // animation loop for the rest of the session.
    this.raf = requestAnimationFrame(this._frame);
    if (!this.bootAt) this.bootAt = now;

    /* The display's refresh grid, from every rAF callback, capped ones included
       (performance.js VsyncEstimator): its period, and, once the stamps lock to
       it, the phase of its edges. */
    this.vsync = this.vsyncClock.sample(now);

    /* The time since the last present, in whole refreshes. rAF timestamps are
       only good to 0.1 ms, and Chrome stamps a callback late (never early) when
       the page is busy, but the frame each one stands for is a whole number of
       refreshes. Counted on the locked grid, a callback stamped late still
       belongs to its own refresh, so the cap cannot mistake the third refresh
       for the fourth, and a given count is the same decision every frame (on a
       panel where 60 fps sits between two counts, 90 Hz, a raw time flips it at
       random). The integrators step by the same exact refreshes, so a steady
       cadence is a steady dt. Unlocked, the time is snapped to the measured
       refresh; a stall passes through raw. The cap's count may only ever be
       short (capSpan), and its period is held under 17.5 ms and the recent
       gaps' lower decile (capPeriod). */
    const dtMs = this.lastNow ? now - this.lastNow : 16.7;
    // The first frame after a (re)start has no real delta, only that stand-in,
    // and the first after a hidden stretch spans the pause.
    const measured = this.lastNow > 0 && !this.hiddenGap;

    // The 60fps cap, and deliberately the first thing after the timing bookkeeping:
    // a capped frame returns here having done essentially no work.
    if (this.lastNow && !shouldPresent(this.vsyncClock.capSpan(this.lastNow, now), this.vsyncClock.capPeriod)) return;
    const stepMs = this.lastNow ? this.vsyncClock.span(this.lastNow, now) : dtMs;
    this.lastNow = now;
    this.hiddenGap = false;

    // Clamped hard at 50ms. A backgrounded tab, a debugger pause or a long GC
    // would otherwise hand every integrator below one enormous step and fling
    // the camera across the scene.
    const dt = clamp(stepMs / 1000, 0.001, 0.05);
    // The sampler judges the machine on the raw time between presents. vsync
    // goes with it: the ladder judges against the cadence the cap can actually
    // produce on this panel, which only the refresh period reveals. On trial the
    // gate's judge takes the frames instead, and only once every formation is
    // baked (a bake is a long frame that says nothing about the GPU) and a
    // version is chosen (behind the chooser the canvas is not even laid out).
    // After a passed trial the ladder also waits out the entrance: the page's
    // reveal lands in those frames, and the trial has just judged the machine.
    let verdict = null;
    if (this.settle > 0) this.settle--;
    else if (!this.trial) {
      if (!this.verdict || this.fade >= 1) this.perf.sample(dtMs, now, this.vsync);
    }
    else if (!this.primed || !this.root.hasAttribute('data-cv-variant')) this.settle = 10;
    else if (measured) verdict = this.trial.sample(dtMs, now, trialRefresh(this.vsync, this.idleVsync));

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
    // The trail history belongs to the chapter we just left: drop it.
    if (live.snapped) {
      this.settle = Math.max(this.settle, 10);
      this.post.historyValid = false;
    }
    const state = this.state;
    for (const key in live) state[key] = live[key];
    // Scroll speed in design px, so the same scroll drives the effects alike at any zoom.
    state.velocity = live.velocity / this.designScale;
    this.reframe(state);
    state.size *= this.densitySize * SIZE_TRIM;
    // Debug-panel escape hatches, both no-ops in production: `overrides` pins
    // individual knobs to slider values, `review` pins a single formation so it
    // can be inspected without scrolling to its chapter.
    if (this.overrides) Object.assign(state, this.overrides);
    if (this.trial && state.sceneA !== state.sceneB) state.morph = TRIAL_MORPH;
    if (this.review && this.review.scene) {
      state.sceneA = this.review.scene;
      state.sceneB = this.review.scene;
      state.morph = 0;
    }

    /* Under reduced motion, a still page is a still picture.

       The reduced chapters animate only very slowly, and they used to keep
       re-rendering at about 7 fps with every clock running, so a held picture
       crept by 0.3-0.7 px per render. Now, once nothing is converging (the
       scroll, the three heads, the dip, the entrance) the clocks stop, dt is 0
       for the particles and nothing is drawn: the canvas keeps its last frame.
       Decided after the timeline has been sampled (its heads have landed) and
       before the elapsed clock, the particle clocks and the render; the pointer
       and the rig still update, harmlessly, since the reduced score has no hold
       push, yaw or parallax. The first scroll or anything marked dirty draws
       again at full rate. */
    const still = this.reduced && !this.trial && this.isStill(live);
    this.frozen = still;
    if (!still) this.elapsed += dt;
    // The camera shutter measures motion between drawn frames; a kept frame
    // breaks that chain, so the next drawn frame is sharp. The shutter is off
    // under reduced motion, the only path that keeps frames, so this holds the
    // rule rather than changing a picture.
    else this.post.invalidateMotion();

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
    // The stir's ray follows the cursor closely (pointer.hx, hy), not the
    // parallax's slow read of it.
    tp.dir.set(this.pointer.hx, -this.pointer.hy, 0.5)
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
    // No bloat under reduced motion (that score has no pointer effects at all).
    this.particles.setPointer(this.rig.camera.position, tp.dir, tp.smooth, this.reduced ? 0 : clamp01(this.pointer.hover));

    this.particles.update(state, still ? 0 : dt, this.elapsed);

    /* One global fade-in from black on first run, so the universe arrives rather
       than appearing: a short beat for the page to settle, then 1.6 s on an
       S-curve that lands exactly on 1 (reduced motion: 0.9 s, no beat). The
       fade waits at the end of the beat until priming has baked every
       remaining formation, or 1.2 s after the first frame: bakes are 20-130 ms
       of blocking work each, and they now land while the canvas is still dark
       instead of stuttering the entrance. The navigation dip (live.cut)
       multiplies in beside it, into the particles and into presence, so the
       horizon disc dips with them. Combined here with the chapter's own opacity
       and the density compensation, in one uniform write. */
    if (this.trial) {
      // On trial the picture is drawn whole: at the entrance's low opacities the
      // vertex shader culls points, and those frames would flatter the GPU. The
      // loader covers it; the entrance plays from the dark once it has passed.
      this.fade = 1;
    } else if (this.fade < 1) {
      const beat = this.reduced ? 0 : FADE_BEAT;
      this.fadeT += dt;
      if (!this.primed && now - this.bootAt < PRIME_HOLD_MS) this.fadeT = Math.min(this.fadeT, beat);
      this.fade = smootherstep(clamp01((this.fadeT - beat) / (this.reduced ? FADE_TIME_REDUCED : FADE_TIME)));
    }
    const shown = clamp01(this.fade) * live.cut;
    this.particles.setOpacity(shown * state.opacity * this.densityAlpha);
    state.presence = shown;

    if (!still) {
      this.render();
      this.dirty = false;
      this.lastScrollY = scrollY;
    }
    this.syncDom(state);
    this.maybePrefetch(live);
    // Revealed by CSS transition once there is something to see, so the canvas
    // does not flash empty over the page background on load.
    if (this.fade > 0.02) this.canvas.classList.add('is-ready');
    // The portrait is drawing: the probe's watchdog stands down, and a photo
    // it had brought back cross-fades out (#cv-avatar-style). Once.
    if (this.portrait && !this.portrait.lit && this.fade > 0.02 && this.heroEl) {
      this.portrait.lit = true;
      this.heroEl.dataset.avatar = 'lit';
    }
    // Last, so a failed trial's dispose() is the end of this frame.
    if (verdict) this.endTrial(verdict === 'pass', now);
  }

  /* The gate's verdict on the trial. A pass keeps the universe: the ladder takes
     over from the rung just proved (reduced motion drops to its calm 'low'), the
     entrance plays from the dark, and the loader lifts. A fail hands the page to
     the fallback through the same exit as any other failure. Logged in the
     quality heartbeat's terms, so the console says why. */
  endTrial(pass, now) {
    const s = this.trial.stats;
    this.trial = null;
    this.verdict = { pass, p50: s.p50, p90: s.p90, budget: s.budget, frames: s.frames };
    console.info(
      `[universe] trial ${pass ? 'passed' : 'failed'}: high · ${TIERS.high.count} particles · ` +
      `p50 ${s.p50.toFixed(1)}ms · p90 ${s.p90.toFixed(1)}ms · budget ${s.budget.toFixed(1)}ms · ${s.frames} frames`
    );
    if (!pass) {
      if (this.onFail) this.onFail();
      else {
        this.dispose();
        handOverToFallback();
      }
      return;
    }
    if (this.reduced) {
      this.perf = new PerformanceManager('low', (tier, stats) => this.applyTier(tier, stats));
      this.applyTier('low');
    }
    this.settle = Math.max(this.settle, 12);
    this.fade = 0;
    this.fadeT = 0;
    this.bootAt = now;
    this.dirty = true;
    this.post.historyValid = false;
    this.post.invalidateMotion();
    // The canvas still holds the trial's full-strength picture, and the loader
    // is about to fade off it: draw it dark first.
    this.particles.setOpacity(0);
    this.state.presence = 0;
    this.render();
    releaseGate();
  }

  /* Reduced motion only: is there nothing left to draw? The scroll has not
     moved, every head sits exactly on the scroll (the timeline lands them
     exactly, see its settle epsilon), the dip and the entrance are complete,
     and nothing was marked dirty. The debug panel's overrides and review pins
     always draw. */
  isStill(live) {
    const tl = this.timeline;
    return !this.dirty && !this.overrides && !this.review &&
      Math.abs(scrollY - this.lastScrollY) <= 1 &&
      tl.pos.morph === tl.raw && tl.vel.morph === 0 &&
      tl.pos.camera === tl.raw && tl.pos.post === tl.raw &&
      live.cut >= 1 && this.fade >= 1;
  }

  /* Warm the chapter after next into the spare slot, while the current one is
     held.

     settledIndex + 2, not + 1: during hold k the pair is (k, k + 1), already
     bound. Gated on the hold, when nothing is morphing and the 3 MB upload
     cannot land mid-transition, and on not scrolling violently, because a fast
     scroll will have blown through several chapters before the idle callback
     ever runs and would be prefetching the wrong one. The hold test uses the
     scroll's own holdTarget, not the damped hold, which lags into the band.
     Both the trigger and the idle callback also require the pair to sit exactly
     at an endpoint (morph 0 or 1; remap clamps, so any band fraction below
     morphStart reads exactly 0), so the upload can never land on the first
     frames of a visible morph. The callback re-arms if that no longer holds.
     `prefetchedFor` keeps it to once per held chapter. */
  maybePrefetch(live) {
    const k = live.settledIndex;
    // live.index === k: the bound pair is (k, k + 1), so k + 1 is not the spare.
    // A same-scene pair (stack -> hobbies) never morphs, so its band counts as a
    // hold too; otherwise a short hold before it can be scrolled past unfetched.
    const still = (s) => s.sceneA === s.sceneB || s.morph === 0 || s.morph === 1;
    const resting = this.timeline.holdTarget > 0.5 || live.sceneA === live.sceneB;
    if (k === this.prefetchedFor || live.index !== k || !resting || !still(live) || Math.abs(live.velocity) / this.designScale > 2500) return;
    const chapters = this.timeline.chapters;
    const next = chapters[k + 2];
    if (!next) return;
    this.prefetchedFor = k;
    schedule(() => {
      if (this.disposed) return;
      const s = this.timeline.state;
      if (s.index !== k || !still(s)) {
        this.prefetchedFor = -1;
        return;
      }
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
  // however long the tab was hidden, and the refresh clock forgets the gap
  // across the pause. Before the programs are ready it only records the
  // request; the prewarm starts the loop when they are.
  start() {
    if (this.running || this.disposed) return;
    if (!this.ready) {
      this.startWanted = true;
      return;
    }
    this.startWanted = false;
    this.running = true;
    this.lastNow = 0;
    if (this.trial && !Number.isFinite(this.idleVsync)) this.idleVsync = this.vsyncClock.period;
    this.vsyncClock.restart();
    this.dirty = true;
    // Whatever the camera did while the loop was stopped, the first frame back
    // is not a continuation of the last one it drew.
    this.post.invalidateMotion();
    // Bound once and cached. A fresh closure per frame would be garbage, and
    // cancelAnimationFrame needs a stable reference.
    this._frame = this._frame || ((now) => this.frame(now));
    this.raf = requestAnimationFrame(this._frame);
  }

  stop() {
    this.startWanted = false;
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
    this.trial = null;
    removeEventListener('resize', this._onResize);
    removeEventListener('orientationchange', this._onResize);
    removeEventListener('pageshow', this._onVisibility);
    document.removeEventListener('visibilitychange', this._onVisibility);
    this.canvas.removeEventListener('webglcontextlost', this._onContextLost);
    if (this._boxObserver) this._boxObserver.disconnect();
    if (this._variantObserver) this._variantObserver.disconnect();
    // Puts the authored hero and contact back and lets the photo return.
    this.stagePortrait(false);
    this.timeline.dispose();
    this.pointer.dispose();
    this.rig.dispose();
    this.registry.dispose();
    /* The GPU side. three's compileAsync polls the programs the prewarm is
       compiling and throws if they are released under it, so while it is in
       flight (the loader gave up during a slow compile) the release waits for
       it to settle. One that never settles keeps them; the canvas is hidden. */
    const release = () => {
      this.particles.dispose();
      this.post.dispose();
      this.renderer.dispose();
    };
    if (this.ready || !this._prewarm) release();
    else this._prewarm.then(release, release);
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

/* The single exit. No WebGL, a failed trial, context lost, or construction
   threw: everything ends here, swaps the html classes the CSS keys off (the
   photo comes back with cv-universe-off), starts the DOM particle background
   that the source HTML left dormant, and lifts the loader.

   Safe to call more than once. The class operations are idempotent, the
   fallback's own boot() guards against double-starting, and so does the gate. */
function handOverToFallback() {
  document.documentElement.classList.remove('cv-universe-on');
  document.documentElement.classList.add('cv-universe-off');
  const dom = window.__cvBackgroundParticles;
  if (dom && typeof dom.boot === 'function') dom.boot();
  releaseGate();
}

/* The page's quality gate (the head probe in the source HTML): while it is
   pending the CV waits behind its loader, input held, for the universe's
   verdict. Lifting it reveals the page (body.is-loaded waits on it). */
function gatePending() {
  const gate = window.__cvUniverseGate;
  return !!(gate && gate.pending);
}

function releaseGate() {
  document.documentElement.classList.remove('cv-universe-pending');
  const gate = window.__cvUniverseGate;
  if (gate && typeof gate.settle === 'function') gate.settle();
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
    const created = new WebGLExperience(canvas, {
      reduced,
      debug: flag === 'debug',
      // On trial only while the page waits behind its loader; a console
      // enable() after the verdict runs as it always did.
      trial: gatePending(),
      // A failure after construction (the asynchronous prewarm) takes the same
      // exit as a thrown constructor, unless the console has moved on.
      onFail: () => {
        if (experience === created) disable();
      },
    });
    experience = created;
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
  if (!canvas) {
    handOverToFallback();
    return;
  }
  // The head probe has the last word where it ran: no WebGL2, a software
  // renderer, ?universe=off, or a loader that gave up waiting.
  if (window.__cvUniverseWillRender === false || !supportsWebGL()) {
    handOverToFallback();
  } else if (flag !== 'off') {
    enable();
  } else {
    handOverToFallback();
  }

  // The console handle. Getters rather than values so it keeps reporting the
  // live experience across enable/disable cycles instead of a stale snapshot.
  window.__cvUniverse = {
    // Tells the head probe this module settles its gate (an older one would
    // leave the loader up until it gave up).
    gated: true,
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
   covers the module arriving after 'load' has already fired.

   Behind the gate's loader nothing of the CV is on screen yet and the visitor is
   waiting on the universe itself, so there it boots at the first idle moment. */
if (gatePending()) schedule(boot);
else if (document.readyState === 'complete') schedule(boot);
else addEventListener('load', () => schedule(boot), { once: true });

export { WebGLExperience };
