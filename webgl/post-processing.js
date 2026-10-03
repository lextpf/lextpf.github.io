
import * as THREE from './lib/three.js';
import {
  fullscreenVertex,
  brightFragment,
  downFragment,
  blurFragment,
  trailFragment,
  shutterFragment,
  compositeFragment,
} from './shaders/post.js';
import { PALETTE } from './chapters.js';
import { remap, smootherstep } from './lib/random.js';


/* Half-float, because additive blending routinely pushes bright cores well past
   1.0 and an 8-bit target would clip them flat. Bloom then has nothing to find:
   everything bright reads as exactly white and the threshold pass cannot tell a
   hot core from a merely bright one.

   No depth or stencil buffer anywhere in this file. Every pass here is a
   full-screen quad, so there is nothing to occlude and nothing to mask. */
const target = (w, h) =>
  new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    stencilBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });

// The most a supersampled scene may cost, in pixels. It only ever limits
// supersampling (superSample > 1, unused on every rung): the scene never
// renders below the canvas's own device pixels.
const SUPERSAMPLE_BUDGET = 13e6;

/* The camera shutter (see _cameraShutter and shaders/post.js shutterCommon).
   Below half a pixel of motion per frame the picture is left exactly as it is
   rendered: the breath and the settled hold never reach it, so a still frame
   is bit-identical to one without any of this. Past a 16 px blur (the
   shaders' SHUTTER_DIRECT) the composite's 16 direct taps would sit more than
   a pixel apart, and the shutter pass pre-averages the box instead; it runs
   when the blur may pass that anywhere in the frame (the 0.9 is headroom for
   pixels between the five points the motion is measured at). Motion over a
   quarter of the frame in one frame is a cut the timeline did not flag, never
   a flight: the fastest wheel flight measured is 75 px per frame at 4K and
   117 at a ratio of 2.

   The cap. A flight follows the wheel, which scrolls CSS pixels through a
   page laid out in CSS pixels, so the picture's motion per frame scales with
   devicePixelRatio, not with the frame. The same hero flight moves 74.5 px
   per frame at 3840x2025 (ratio 1), 62.7 at 1920x1080 and 115.8 at 2880x1800
   (ratio 2): a half-frame blur of 1.84% of the frame's height at 4K, but
   2.9% and 3.2% on the smaller frames, where the crane and the small solids
   smear past recognition. SHUTTER_MAX holds every blur to 2% of the frame's
   short side, the 4K frame's own worst with a little headroom: at 4K the cap
   engages on none of the nine flights, and elsewhere no flight smears a
   formation, relative to its size, much past what it does there. Where it
   engages (the fastest few frames of a flight on a smaller or denser frame)
   the gaps between the frames' streaks open past half the step. SHUTTER_LONGEST
   is the longest blur the two-level box keeps an even streak over (shaders/
   post.js); it only binds on frames with a short side over 3200 px. */
const SHUTTER_MIN_PX = 0.5;
const SHUTTER_PRE_PX = 16 * 0.9;
const SHUTTER_CUT = 0.25;
const SHUTTER_PROBES = [-1, -1, 1, -1, -1, 1, 1, 1, 0, 0];
const SHUTTER_MAX = 0.02;
const SHUTTER_LONGEST = 64;

export class PostProcessing {
  constructor(renderer, options) {
    this.renderer = renderer;
    this.bloomLevels = options.bloomLevels;
    this.trailsEnabled = options.trails;
    // The camera shutter (see _cameraShutter). Off under reduced motion, like
    // the trails: a flight there is drawn as sharp frames, and nothing is
    // allocated for it. shutterMax is the cap as a fraction of the frame's
    // short side (SHUTTER_MAX).
    this.shutterEnabled = options.shutter !== false;
    // The edge lens while travelling through the wormhole (off under reduced
    // motion, like the shutter), and its smoothed strength.
    this.edgeLensEnabled = options.edgeLens !== false;
    this.edgeLens = 0;
    this._edgeAt = null;
    this.shutterMax = SHUTTER_MAX;
    this.superSample = options.superSample;
    this.renderScale = options.superSample;
    this.master = options.master ?? 1;
    // Multiplies every chapter's bloomThreshold, which is authored at the
    // 100k reference density. See setDensity.
    this.thresholdGain = 1;

    // One quad, one orthographic camera, reused by every pass. A pass is just
    // "swap the material on this quad and render it somewhere", which is what
    // _pass below does.
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadGeometry = new THREE.PlaneGeometry(2, 2);
    this.quad = new THREE.Mesh(this.quadGeometry);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    // All targets start at 1x1 and are sized for real by setSize. Allocating
    // them here keeps the references stable, so nothing has to be rebound when
    // the window resizes or the quality ladder moves.
    this.rtScene = target(1, 1);
    this.rtHistoryA = null;
    this.rtHistoryB = null;
    this.rtBright = target(1, 1);
    // The shutter pass's pre-averaged scene, full size (see _cameraShutter).
    this.rtShutter = this.shutterEnabled ? target(1, 1) : null;
    // The mip chain: each level half the width and height of the one before, so
    // a fixed-radius blur covers twice as much of the screen at each step.
    // `a` and `b` are the two halves of the separable blur.
    this.rtLevels = [
      { a: target(1, 1), b: target(1, 1), div: 2 },
      { a: target(1, 1), b: target(1, 1), div: 4 },
      { a: target(1, 1), b: target(1, 1), div: 8 },
    ];
    if (this.trailsEnabled) {
      this.rtHistoryA = target(1, 1);
      this.rtHistoryB = target(1, 1);
    }

    // A 1x1 black texture to bind wherever a pass is disabled. Sampling black
    // costs nothing and contributes nothing, which is far simpler than compiling
    // shader variants for every combination of effects that might be off.
    const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    black.needsUpdate = true;
    this.black = black;

    this.bright = new THREE.ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: brightFragment,
      uniforms: {
        tScene: { value: null },
        uThreshold: { value: 0.9 },
        uKnee: { value: 0.55 },
        uTexel: { value: new THREE.Vector2(0, 0) },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.down = new THREE.ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: downFragment,
      uniforms: {
        tScene: { value: null },
        uTexel: { value: new THREE.Vector2(0, 0) },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.blur = new THREE.ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: blurFragment,
      uniforms: {
        tSource: { value: null },
        uDirection: { value: new THREE.Vector2() },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.trail = new THREE.ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: trailFragment,
      uniforms: {
        tScene: { value: null },
        tHistory: { value: black },
        uTrail: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });

    // The camera's homography and the cap are shared: both shutter passes read
    // one Matrix3 and one length.
    const camH = { value: new THREE.Matrix3() };
    const camMax = { value: 1 };
    this.shutter = new THREE.ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: shutterFragment,
      uniforms: {
        tScene: { value: null },
        uCamH: camH,
        uCamMax: camMax,
        uResolution: { value: new THREE.Vector2(1, 1) },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.composite = new THREE.ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: compositeFragment,
      uniforms: {
        tScene: { value: null },
        tBloom0: { value: black },
        tBloom1: { value: black },
        tBloom2: { value: black },
        uTexelB0: { value: new THREE.Vector2(0, 0) },
        uTexelB1: { value: new THREE.Vector2(0, 0) },
        uTexelB2: { value: new THREE.Vector2(0, 0) },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uCamBlur: { value: 0 },
        uCamPre: { value: 0 },
        uCamH: camH,
        uCamMax: camMax,
        tBlur: { value: black },
        uBloom: { value: 0.34 },
        uBloomTight: { value: 1 },
        uBloomMid: { value: 0.4 },
        uBloomWide: { value: 0.25 },
        uDirt: { value: 0 },
        tTrail: { value: black },
        uTrailMix: { value: 0 },
        uChroma: { value: 0 },
        uFringe: { value: 0 },
        uLens: { value: 0 },
        uHorizon: { value: 0 },
        uHorizonAlpha: { value: 0 },
        uHorizonLight: { value: 0 },
        uRing: { value: 0 },
        uLensed: { value: 0 },
        uCrescent: { value: new THREE.Vector4() },
        uCenter: { value: new THREE.Vector2(0.5, 0.5) },
        uEdgeLens: { value: 0 },
        uHaze: { value: 0 },
        uHazeScale: { value: 0.55 },
        uHazeColor: { value: new THREE.Color(PALETTE.accent).convertSRGBToLinear() },
        uExposure: { value: 1 },
        uTemp: { value: 0 },
        uSat: { value: 1 },
        uContrast: { value: 1 },
        uLift: { value: 0.004 },
        uGrain: { value: 0.014 },
        uVignette: { value: 0.5 },
        uColWarm: { value: new THREE.Color(PALETTE.warm).convertSRGBToLinear() },
        uColWhite: { value: new THREE.Color(PALETTE.base).convertSRGBToLinear() },
      },
      depthTest: false,
      depthWrite: false,
    });

    this._base = new THREE.Color();
    this._accent = new THREE.Color(PALETTE.accent).convertSRGBToLinear();
    this._neutral = new THREE.Color(PALETTE.base).convertSRGBToLinear();

    this.width = 1;
    this.height = 1;
    this.historyValid = false;

    // The camera shutter's memory: the view-projection of the last presented
    // frame, and whether it may be trusted (see invalidateMotion).
    this.prevViewProjection = new THREE.Matrix4();
    this.motionValid = false;
    this._viewProjection = new THREE.Matrix4();
    this._reprojection = new THREE.Matrix4();
    this._homography = new Float64Array(9);
    // What the shutter did on the last frame, for harnesses: whether it blurred,
    // the largest motion it measured (device px per frame), the longest blur
    // it drew after the cap (px), and whether the shutter pass ran.
    this.cameraBlur = { on: false, px: 0, blur: 0, pre: false };
  }

  /* Forget the previous frame's camera. The next frame draws sharp and becomes
     the reference: nothing is blurred across a cut. The experience calls it on
     start, on a new rung and after a frame reduced motion kept still (the
     shutter is off there, but the chain stays honest); a resize does it here,
     and a timeline snap arrives through render(). */
  invalidateMotion() {
    this.motionValid = false;
  }

  setSize(width, height) {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    /* The scene renders at the canvas's device pixels, width x height, and the
       composite writes them 1:1. Supersampling would render larger and scale
       down, cheap antialiasing for points; past about 13 million pixels per
       pass the improvement is invisible and the cost is not, so a supersample
       is pulled back to fit that budget, but never below 1. The budget used to
       apply to the native frame too (with a 0.88 floor), which resolved a very
       large window below the display: resolution is not a quality lever. */
    let scale = Math.max(1, this.superSample || 1);
    if (scale > 1 && width * height * scale * scale > SUPERSAMPLE_BUDGET) {
      scale = Math.max(1, Math.sqrt(SUPERSAMPLE_BUDGET / (width * height)));
    }
    this.renderScale = scale;
    const sw = Math.max(1, Math.round(width * scale));
    const sh = Math.max(1, Math.round(height * scale));
    this.rtScene.setSize(sw, sh);
    if (this.rtShutter) this.rtShutter.setSize(sw, sh);
    // A new frame size is a cut for the camera shutter.
    this.motionValid = false;
    // Texel size, so a shader can step exactly one pixel without knowing the
    // resolution it is running at.
    this.bright.uniforms.uTexel.value.set(1 / sw, 1 / sh);
    if (this.rtHistoryA) {
      // Resizing discards the contents, so the trail history is now garbage.
      this.rtHistoryA.setSize(Math.max(1, sw >> 1), Math.max(1, sh >> 1));
      this.rtHistoryB.setSize(Math.max(1, sw >> 1), Math.max(1, sh >> 1));
      this.historyValid = false;
    }
    // Half resolution: this feeds the blur chain, which destroys detail anyway.
    this.rtBright.setSize(Math.max(1, sw >> 1), Math.max(1, sh >> 1));
    this.rtLevels.forEach((level, i) => {
      const w = Math.max(1, Math.floor(sw / level.div));
      const h = Math.max(1, Math.floor(sh / level.div));
      level.a.setSize(w, h);
      level.b.setSize(w, h);
      this.composite.uniforms['uTexelB' + i].value.set(1 / w, 1 / h);
    });
    this.composite.uniforms.uResolution.value.set(width, height);
    this.shutter.uniforms.uResolution.value.set(width, height);
  }

  /* Keep the same lit set on every rung of the quality ladder.

     A lower rung draws fewer particles and makes each one carry more light
     (densityAlpha, from cv-universe.js). A dot's peak rises by densityAlpha (its
     footprint widens with densitySize, so the extra energy spreads) while a
     dense region brightens by only about 1.2x, and the threshold has to follow
     the mix or a 37k frame lets isolated dust into the bloom. Measured on every
     chapter at 4K, the gain that keeps the count of pixels over the threshold
     equal to the 100k frame is 1.19-1.62 at 37k (median 1.45);
     densityAlpha^0.75 (1.16 / 1.30 / 1.45 at 68k / 50k / 37k) holds every
     chapter within 0.78-1.22 of it, at the 37k cut and on a true 37k bake (the
     spec's predicted sqrt(densityAlpha * densitySize^2), 1.80, drops it to
     0.36-0.97: it predates the footprint widening).
     Compensation, like densityAlpha itself, not a quality lever. */
  setDensity(densityAlpha) {
    this.thresholdGain = Math.pow(Math.max(1, densityAlpha || 1), 0.75);
  }

  // One full-screen pass: put this material on the shared quad and draw it into
  // `dest`, or to the canvas when dest is null.
  _pass(material, dest) {
    this.quad.material = material;
    this.renderer.setRenderTarget(dest);
    this.renderer.render(this.scene, this.camera);
  }

  // Half of a separable blur. Callers run it twice, once horizontal and once
  // vertical, which gives the same result as a 2D blur for a fraction of the
  // samples. Direction is in texels, so it doubles as the radius.
  _blur(source, dest, dx, dy) {
    this.blur.uniforms.tSource.value = source.texture;
    this.blur.uniforms.uDirection.value.set(dx, dy);
    this._pass(this.blur, dest);
  }

  /* Compile every program, then run one of every pass, before the first real
     frame. Resolves when the chain can draw without stalling.

     Shader compilation and pipeline setup are lazy in WebGL: the driver does
     the work the first time a program is used to draw, and the page waits for
     it. Without this the first frame pays for the entire chain at once and the
     universe fades in with a visible stutter, on exactly the frame the user is
     most likely watching.

     Asynchronous where the driver allows it (KHR_parallel_shader_compile,
     which Chrome exposes): three's compileAsync hands each program to the
     driver and polls its completion status instead of blocking on it, so the
     compiles, the particle program's above all, run while the main thread
     stays free. Without the extension three resolves at once and the first
     pass below compiles synchronously, as it always did. Each post material is
     compiled by putting it on the shared quad, `down` included (the old
     prewarm never drew it, so it compiled on the first visible frame).

     Then one pass of each, results thrown away: pipeline setup and the first
     upload of the bound slots' buffers happen here, not on a visible frame. */
  async prewarm(sceneRoot, camera) {
    const renderer = this.renderer;
    const pending = [renderer.compileAsync(sceneRoot, camera)];
    const passes = [this.bright, this.down, this.blur, this.composite];
    if (this.rtShutter) passes.splice(3, 0, this.shutter);
    if (this.rtHistoryA) passes.push(this.trail);
    for (const material of passes) {
      this.quad.material = material;
      pending.push(renderer.compileAsync(this.scene, this.camera));
    }
    await Promise.all(pending);

    renderer.setRenderTarget(this.rtScene);
    renderer.render(sceneRoot, camera);
    if (this.rtHistoryA) {
      this.trail.uniforms.tScene.value = this.rtScene.texture;
      this.trail.uniforms.tHistory.value = this.black;
      this.trail.uniforms.uTrail.value = 0;
      this._pass(this.trail, this.rtHistoryA);
      this._pass(this.trail, this.rtHistoryB);
    }
    this.bright.uniforms.tScene.value = this.rtScene.texture;
    this._pass(this.bright, this.rtBright);
    let source = this.rtBright;
    this.rtLevels.forEach((level) => {
      this.down.uniforms.tScene.value = source.texture;
      this.down.uniforms.uTexel.value.set(1 / source.width, 1 / source.height);
      this._pass(this.down, level.a);
      this._blur(level.a, level.b, 1 / level.a.width, 0);
      this._blur(level.b, level.a, 0, 1 / level.a.height);
      source = level.a;
    });
    if (this.rtShutter) {
      this.shutter.uniforms.tScene.value = this.rtScene.texture;
      this._pass(this.shutter, this.rtShutter);
    }
    this.composite.uniforms.tScene.value = this.rtScene.texture;
    this._pass(this.composite, this.rtBright);
    if (this.rtShutter) {
      // The composite's long-shutter branch reads a texture nothing else
      // samples. One draw with it bound, so any first-use setup the driver
      // does for it lands here and not on the first frame of the first flight.
      this.composite.uniforms.tBlur.value = this.rtShutter.texture;
      this.composite.uniforms.uCamBlur.value = 1;
      this.composite.uniforms.uCamPre.value = 1;
      this._pass(this.composite, this.rtBright);
      this.composite.uniforms.uCamBlur.value = 0;
      this.composite.uniforms.uCamPre.value = 0;
      this.composite.uniforms.tBlur.value = this.black;
    }
    renderer.setRenderTarget(null);
    this.historyValid = false;
    this.motionValid = false;
  }

  /* The camera's 180 degree shutter: how the picture moved since the last
     presented frame, decided once per frame on the CPU.

     Particles already streak with their own motion (shaders/particles.js), but
     a chapter flight moves the camera, and at 4K it moves the picture 57-75 px
     per presented frame: sharp dots drawn 60 times a second read as a strobe,
     four copies of everything in any four frames. A real camera's shutter is
     open for half of each frame and smears each point over half its path.

     The motion is taken on the subject plane: the plane through the rig's
     look-at point, facing the camera, at `distance` (the rig's subject
     distance, not state.focus, which is a depth-of-field knob). A pixel's NDC
     on that plane, lifted into camera space (A), carried to the world by the
     camera's matrix and projected by the previous frame's view-projection, is
     where that point was one frame ago:
       H = rows (x, y, w) of prevViewProjection . matrixWorld . A,
       A = [[f/P00, 0, f P02/P00], [0, f/P11, f P12/P11], [0, 0, -f], [0, 0, 1]]
     (P02 and P12 carry the lens shift). One 3x3 homography serves every pixel;
     scaled by 1/f it is the identity at rest. Points far from the plane move
     by other amounts under a translation (the tunnel's near and far dust, the
     jets), and get the subject's blur: acceptable at a half-frame shutter.

     The motion is measured at the four corners and the centre. Under half a
     pixel the composite is not touched at all; over a quarter of the frame it
     is a cut. No blur runs longer than the cap (SHUTTER_MAX of the frame's
     short side, at most SHUTTER_LONGEST px), which the shaders apply per
     pixel. After anything that breaks the chain (a snap, a resize, a new
     rung, a start, a frame reduced motion held) the frame draws sharp and
     becomes the reference. */
  _cameraShutter(camera, distance, snapped) {
    const vp = this._viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    let on = false;
    let px = 0;
    let blur = 0;
    let pre = false;
    if (this.shutterEnabled && this.motionValid && !snapped && distance > 0) {
      const m = this._reprojection.multiplyMatrices(this.prevViewProjection, camera.matrixWorld).elements;
      const p = camera.projectionMatrix.elements;
      const f = distance;
      const ax = 1 / p[0];
      const ay = 1 / p[5];
      const h = this._homography;
      // Rows 0, 1 and 3 of m . A, divided by f.
      for (let row = 0; row < 3; row++) {
        const r = row === 2 ? 3 : row;
        h[row * 3] = m[r] * ax;
        h[row * 3 + 1] = m[4 + r] * ay;
        h[row * 3 + 2] = m[r] * p[8] * ax + m[4 + r] * p[9] * ay - m[8 + r] + m[12 + r] / f;
      }
      const W = this.width;
      const Ht = this.height;
      let cut = false;
      for (let k = 0; k < SHUTTER_PROBES.length; k += 2) {
        const x = SHUTTER_PROBES[k];
        const y = SHUTTER_PROBES[k + 1];
        const hz = h[6] * x + h[7] * y + h[8];
        if (!(hz > 1e-6)) {
          cut = true;
          break;
        }
        const dx = (x - (h[0] * x + h[1] * y + h[2]) / hz) * 0.5 * W;
        const dy = (y - (h[3] * x + h[4] * y + h[5]) / hz) * 0.5 * Ht;
        px = Math.max(px, Math.hypot(dx, dy));
      }
      if (cut || px > SHUTTER_CUT * Math.max(W, Ht)) {
        px = 0;
      } else if (px >= SHUTTER_MIN_PX) {
        on = true;
        const cap = Math.min(this.shutterMax * Math.min(W, Ht), SHUTTER_LONGEST);
        blur = Math.min(px * 0.5, cap);
        pre = blur > SHUTTER_PRE_PX;
        this.composite.uniforms.uCamH.value.set(h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], h[8]);
        this.composite.uniforms.uCamMax.value = cap;
      }
    }
    this.prevViewProjection.copy(vp);
    this.motionValid = true;
    this.cameraBlur.on = on;
    this.cameraBlur.px = px;
    this.cameraBlur.blur = blur;
    this.cameraBlur.pre = on && pre;
    return this.cameraBlur;
  }

  /* `distance` is the camera's subject distance, the blur plane of the camera
     shutter (see _cameraShutter). */
  render(sceneRoot, camera, state, focusPoint, elapsed, distance) {
    const renderer = this.renderer;
    renderer.setRenderTarget(this.rtScene);
    renderer.clear();
    renderer.render(sceneRoot, camera);

    const sceneTexture = this.rtScene.texture;
    const u = this.composite.uniforms;

    // After the scene draw, which brings the camera's matrices up to date. A
    // snap teleports every head: the timeline flags it, and nothing is blurred
    // across it.
    const motion = this._cameraShutter(camera, distance || 0, !!state.snapped);
    u.uCamBlur.value = motion.on ? 1 : 0;
    u.uCamPre.value = motion.pre ? 1 : 0;
    u.tBlur.value = this.black;
    if (motion.pre) {
      this.shutter.uniforms.tScene.value = sceneTexture;
      this._pass(this.shutter, this.rtShutter);
      u.tBlur.value = this.rtShutter.texture;
    }

    // Peaks at the midpoint of a morph and is zero at both ends, so anything
    // driven by it happens during the transition and leaves nothing behind.
    const morphing = state.sceneA !== state.sceneB;
    const swell = morphing
      ? Math.sin(Math.PI * Math.min(1, Math.max(0, state.morph)))
      : 0;

    // A high `arc` means particles are flying on long curved paths rather than
    // sliding across, so those transitions earn a trail automatically without
    // every such chapter having to author one.
    const morphTrail = morphing && (state.arc || 0) >= 16 ? 0.38 * swell : 0;
    const trailAmount = this.trailsEnabled
      ? Math.max(state.trail || 0, morphTrail)
      : 0;
    u.uTrailMix.value = 0;
    // Keep running for one more frame after trails switch off, so the last
    // accumulated frame fades out rather than vanishing.
    if (this.rtHistoryA && (trailAmount > 0.001 || this.historyValid)) {
      this.trail.uniforms.tScene.value = sceneTexture;
      // First frame after a resize or a cold start has no history to read.
      this.trail.uniforms.tHistory.value = this.historyValid
        ? this.rtHistoryA.texture
        : this.black;
      this.trail.uniforms.uTrail.value = trailAmount;
      // The ping-pong: read A, write B, then swap so B becomes the history that
      // next frame reads. Nothing is copied, only the two references trade.
      this._pass(this.trail, this.rtHistoryB);
      const swap = this.rtHistoryA;
      this.rtHistoryA = this.rtHistoryB;
      this.rtHistoryB = swap;
      this.historyValid = trailAmount > 0.001;
      u.tTrail.value = this.rtHistoryA.texture;
      u.uTrailMix.value = this.historyValid ? 1 : 0;
    }
    u.tBloom0.value = this.black;
    u.tBloom1.value = this.black;
    u.tBloom2.value = this.black;

    // bloomLevels is one of the two things the quality ladder actually cuts:
    // 3 levels at high, down to 1 at minimal.
    if (this.bloomLevels > 0 && state.bloom > 0.001) {
      /* Extract everything brighter than the threshold, once, at half size.

         Each chapter's threshold is the lit-HDR p99 of its settled formation
         (chapters.js), so only the brightest lit points glow. The knee is a
         quarter of it: extraction starts at 0.75 of the threshold everywhere,
         where a fixed knee started it at T - 0.55 (0.43 on the hero, below zero
         on a low threshold, which bloomed the whole formation into a veil). */
      const threshold = state.bloomThreshold * this.thresholdGain;
      this.bright.uniforms.tScene.value = sceneTexture;
      this.bright.uniforms.uThreshold.value = threshold;
      this.bright.uniforms.uKnee.value = Math.max(0.05, 0.25 * threshold);
      this._pass(this.bright, this.rtBright);

      const radius = state.bloomRadius;
      let source = this.rtBright;
      const slots = [u.tBloom0, u.tBloom1, u.tBloom2];
      // Each level downsamples the previous one, then blurs horizontally into b
      // and vertically back into a. `source` chaining is what makes this a mip
      // chain rather than three independent blurs of the same image.
      for (let i = 0; i < this.bloomLevels && i < this.rtLevels.length; i++) {
        const level = this.rtLevels[i];
        // Anamorphic: stretch the widest level sideways and squash it
        // vertically, the horizontal flare an anamorphic lens gives. Only on the
        // widest level, where the blur is broad enough for it to read.
        const stretch = i === 2 ? 1 + state.anamorphic * 3.5 : 1;
        const squash = i === 2 ? 1 - state.anamorphic * 0.45 : 1;
        this.down.uniforms.tScene.value = source.texture;
        this.down.uniforms.uTexel.value.set(1 / source.width, 1 / source.height);
        this._pass(this.down, level.a);
        // The radius is a real knob down to a quarter texel (it used to be
        // clamped to at least 1, so the 0.5 default did nothing).
        this._blur(level.a, level.b, Math.max(radius * stretch, 0.25) / level.a.width, 0);
        this._blur(level.b, level.a, 0, Math.max(radius * squash, 0.25) / level.a.height);
        slots[i].value = level.a.texture;
        source = level.a;
      }
    }

    u.tScene.value = sceneTexture;
    u.uTime.value = elapsed;
    u.uBloom.value = state.bloom;
    u.uBloomTight.value = state.bloomTight;
    u.uBloomMid.value = state.bloomMid ?? 0.4;
    u.uBloomWide.value = state.bloomWide;
    u.uDirt.value = state.dirt;
    u.uChroma.value = state.chroma;
    u.uFringe.value = Math.min(1, (state.anamorphic || 0) * 5 + (state.chroma || 0) * 6);
    u.uLens.value = state.lens;
    /* The event horizon is drawn here, in 2D, not as geometry: it is a disc the
       composite pass punches into the image at the projected position and radius
       CameraRig.projectSphere worked out.

       Its fade is asymmetric on purpose. Arriving at a hole it appears late
       (0.64 to 0.91 of the morph), once enough particles have gathered for a
       black disc to read as something they formed. Leaving one it disappears
       early (0.06 to 0.34), before the crowd has dispersed enough for a hole in
       empty space to look like a hole in the image. */
    const holeA = state.sceneA === 'blackhole' || state.sceneA === 'whitehole';
    const holeB = state.sceneB === 'blackhole' || state.sceneB === 'whitehole';
    let horizonAssembly = 0;
    if (holeA && holeB) {
      horizonAssembly = 1;
    } else if (holeB) {
      horizonAssembly = smootherstep(remap(state.morph, 0.64, 0.91));
    } else if (holeA) {
      horizonAssembly = 1 - smootherstep(remap(state.morph, 0.06, 0.34));
    }
    /* The edge lens (shaders/post.js edgeUv): the frame's edges stretch a
       little while you travel through the wormhole, that is while you scroll
       through it and through the warp out of it (its departing chapter's
       warp, over the band), and relax when you stop. Weighted by how much of
       the picture is the wormhole. */
    const worm = (state.sceneA === 'wormhole' ? 1 - state.morph : 0) + (state.sceneB === 'wormhole' ? state.morph : 0);
    const warpRamp = state.sceneA === 'wormhole' && state.sceneB !== 'wormhole'
      ? (state.warp || 0) * smootherstep(Math.min(1, (state.t || 0) / 0.8))
      : 0;
    const moving = Math.min(1, Math.abs(state.velocity || 0) / 1400);
    const edgeTarget = this.edgeLensEnabled ? Math.min(1, worm * (0.8 * moving + warpRamp)) : 0;
    const edgeDt = this._edgeAt === null ? 0 : Math.min(0.1, Math.max(0, elapsed - this._edgeAt));
    this._edgeAt = elapsed;
    this.edgeLens += (edgeTarget - this.edgeLens) * (1 - Math.exp(-edgeDt * 3.5));
    u.uEdgeLens.value = this.edgeLens;
    u.uRing.value = state.ringBase || 0;
    // The particle lens's share (the chapter's `lensing`): its images replace
    // the painted band (shaders/post.js).
    u.uLensed.value = Math.min(1, Math.max(0, state.lensing || 0));
    // The Doppler crescents (particle-system.js holeCrescent, handed over by
    // cv-universe.js as `holeFx`).
    const hf = this.holeFx;
    u.uCrescent.value.set(hf ? hf.doppler : 0, hf ? hf.crescent : 0, hf ? hf.white : 0, hf ? hf.whiteAngle : 0);
    u.uHorizon.value = state.horizonBase > 0.001
      ? focusPoint.radius * state.horizonBase
      : 0;
    // Gated on presence too, so the disc fades in with the particles at boot.
    // Steeper than linear: the tone curve compresses a linear gate, which left
    // the disc near full brightness over a field that had already faded.
    u.uHorizonAlpha.value = horizonAssembly * Math.pow(state.presence ?? 1, 2.5);
    u.uHorizonLight.value = state.horizonLightBase || 0;
    u.uCenter.value.copy(focusPoint.centre);
    u.uHaze.value = state.haze;
    u.uHazeScale.value = state.hazeScale;
    // One accent, never warm: same dial as the particle fog (at most 40% accent).
    this._base.copy(this._neutral).lerp(this._accent, Math.min(state.hazeMix, 0.5) * 0.8);
    u.uHazeColor.value.copy(this._base);
    // `master` is a single global trim over every chapter's authored exposure,
    // so the whole page can be taken up or down without editing ten chapters.
    u.uExposure.value = state.exposure * this.master;
    u.uTemp.value = state.temp;
    u.uSat.value = state.sat;
    u.uContrast.value = state.contrast;
    u.uLift.value = state.lift;
    u.uGrain.value = state.grain;
    u.uVignette.value = state.vignette;

    // The only pass that writes to the canvas. Target null means the swapchain.
    this.quad.material = this.composite;
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
  }

  // GPU memory is not garbage collected. Every target and material allocated in
  // the constructor has to be released by hand, or toggling the universe off and
  // on repeatedly leaks the whole chain each time.
  dispose() {
    const targets = [this.rtScene, this.rtBright, this.rtShutter, this.rtHistoryA, this.rtHistoryB];
    this.rtLevels.forEach((l) => targets.push(l.a, l.b));
    targets.forEach((t) => t && t.dispose());
    this.black.dispose();
    this.quadGeometry.dispose();
    this.bright.dispose();
    this.blur.dispose();
    this.trail.dispose();
    this.shutter.dispose();
    this.composite.dispose();
  }
}
