
import * as THREE from './lib/three.js';
import {
  fullscreenVertex,
  brightFragment,
  downFragment,
  blurFragment,
  trailFragment,
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

export class PostProcessing {
  constructor(renderer, options) {
    this.renderer = renderer;
    this.bloomLevels = options.bloomLevels;
    this.trailsEnabled = options.trails;
    this.superSample = options.superSample;
    this.renderScale = options.superSample;
    this.master = options.master ?? 1;

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
        uBloom: { value: 0.34 },
        uBloomTight: { value: 1 },
        uBloomWide: { value: 0.45 },
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
        uCenter: { value: new THREE.Vector2(0.5, 0.5) },
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
    this._warm = new THREE.Color(PALETTE.warm).convertSRGBToLinear();
    this._neutral = new THREE.Color(PALETTE.base).convertSRGBToLinear();

    this.width = 1;
    this.height = 1;
    this.historyValid = false;
  }

  setSize(width, height) {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    /* Supersampling would like to render larger than the canvas and scale down,
       which is cheap antialiasing for points. But on a 4K panel at high dpr the
       full multiple is tens of millions of pixels per pass, times the whole
       chain. Past about 13 million the improvement is invisible and the cost is
       not, so the scale is pulled back to fit the budget. The 0.88 floor stops a
       very large window from resolving below the canvas and looking soft. */
    let scale = this.superSample;
    const budget = 13e6;
    if (width * height * scale * scale > budget) {
      scale = Math.max(0.88, Math.sqrt(budget / (width * height)));
    }
    this.renderScale = scale;
    const sw = Math.max(1, Math.round(width * scale));
    const sh = Math.max(1, Math.round(height * scale));
    this.rtScene.setSize(sw, sh);
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

  /* Run one of every pass once, at boot, before the first real frame.

     Shader compilation and pipeline setup are lazy in WebGL: the driver does the
     work the first time a program is actually used to draw. Without this the
     first frame pays for the entire chain at once and the universe fades in with
     a visible stutter, on exactly the frame the user is most likely watching.

     The results are thrown away. Only the side effects matter. */
  prewarm(sceneRoot, camera) {
    this.renderer.compile(sceneRoot, camera);
    this.renderer.setRenderTarget(this.rtScene);
    this.renderer.render(sceneRoot, camera);
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
      this._blur(source, level.a, 1 / level.a.width, 0);
      this._blur(level.a, level.b, 0, 1 / level.a.height);
      source = level.b;
    });
    this.composite.uniforms.tScene.value = this.rtScene.texture;
    this._pass(this.composite, this.rtBright);
    this.renderer.setRenderTarget(null);
    this.historyValid = false;
  }

  render(sceneRoot, camera, state, focusPoint, elapsed) {
    const renderer = this.renderer;
    renderer.setRenderTarget(this.rtScene);
    renderer.clear();
    renderer.render(sceneRoot, camera);

    const sceneTexture = this.rtScene.texture;
    const u = this.composite.uniforms;

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
      // Extract everything brighter than the threshold, once, at half size.
      this.bright.uniforms.tScene.value = sceneTexture;
      this.bright.uniforms.uThreshold.value = state.bloomThreshold;
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
        this._blur(level.a, level.b, Math.max(radius * stretch, 1) / level.a.width, 0);
        this._blur(level.b, level.a, 0, Math.max(radius * squash, 1) / level.a.height);
        slots[i].value = level.a.texture;
        source = level.a;
      }
    }

    u.tScene.value = sceneTexture;
    u.uTime.value = elapsed;
    u.uBloom.value = state.bloom;
    u.uBloomTight.value = state.bloomTight;
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
    u.uRing.value = state.ringBase || 0;
    u.uHorizon.value = state.horizonBase > 0.001
      ? focusPoint.radius * state.horizonBase
      : 0;
    u.uHorizonAlpha.value = horizonAssembly;
    u.uHorizonLight.value = state.horizonLightBase || 0;
    u.uCenter.value.copy(focusPoint.centre);
    u.uHaze.value = state.haze;
    u.uHazeScale.value = state.hazeScale;
    const mix = state.hazeMix;
    if (mix <= 0.5) {
      this._base.copy(this._neutral).lerp(this._accent, mix * 2);
    } else {
      this._base.copy(this._accent).lerp(this._warm, (mix - 0.5) * 2);
    }
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
    const targets = [this.rtScene, this.rtBright, this.rtHistoryA, this.rtHistoryB];
    this.rtLevels.forEach((l) => targets.push(l.a, l.b));
    targets.forEach((t) => t && t.dispose());
    this.black.dispose();
    this.quadGeometry.dispose();
    this.bright.dispose();
    this.blur.dispose();
    this.trail.dispose();
    this.composite.dispose();
  }
}
