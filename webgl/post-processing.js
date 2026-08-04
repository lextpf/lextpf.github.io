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
    this.master = options.master ?? 1;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadGeometry = new THREE.PlaneGeometry(2, 2);
    this.quad = new THREE.Mesh(this.quadGeometry);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    this.rtScene = target(1, 1);
    this.rtHistoryA = null;
    this.rtHistoryB = null;
    this.rtBright = target(1, 1);
    this.rtLevels = [
      { a: target(1, 1), b: target(1, 1), div: 2 },
      { a: target(1, 1), b: target(1, 1), div: 4 },
      { a: target(1, 1), b: target(1, 1), div: 8 },
    ];
    if (this.trailsEnabled) {
      this.rtHistoryA = target(1, 1);
      this.rtHistoryB = target(1, 1);
    }

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
    let scale = this.superSample;
    const budget = 13e6;
    if (width * height * scale * scale > budget) {
      scale = Math.max(0.88, Math.sqrt(budget / (width * height)));
    }
    const sw = Math.max(1, Math.round(width * scale));
    const sh = Math.max(1, Math.round(height * scale));
    this.rtScene.setSize(sw, sh);
    this.bright.uniforms.uTexel.value.set(1 / sw, 1 / sh);
    if (this.rtHistoryA) {
      this.rtHistoryA.setSize(Math.max(1, sw >> 1), Math.max(1, sh >> 1));
      this.rtHistoryB.setSize(Math.max(1, sw >> 1), Math.max(1, sh >> 1));
      this.historyValid = false;
    }
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

  _pass(material, dest) {
    this.quad.material = material;
    this.renderer.setRenderTarget(dest);
    this.renderer.render(this.scene, this.camera);
  }

  _blur(source, dest, dx, dy) {
    this.blur.uniforms.tSource.value = source.texture;
    this.blur.uniforms.uDirection.value.set(dx, dy);
    this._pass(this.blur, dest);
  }

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

    const morphing = state.sceneA !== state.sceneB;
    const swell = morphing
      ? Math.sin(Math.PI * Math.min(1, Math.max(0, state.morph)))
      : 0;

    const morphTrail = morphing && (state.arc || 0) >= 16 ? 0.38 * swell : 0;
    const trailAmount = this.trailsEnabled
      ? Math.max(state.trail || 0, morphTrail)
      : 0;
    u.uTrailMix.value = 0;
    if (this.rtHistoryA && (trailAmount > 0.001 || this.historyValid)) {
      this.trail.uniforms.tScene.value = sceneTexture;
      this.trail.uniforms.tHistory.value = this.historyValid
        ? this.rtHistoryA.texture
        : this.black;
      this.trail.uniforms.uTrail.value = trailAmount;
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

    if (this.bloomLevels > 0 && state.bloom > 0.001) {
      this.bright.uniforms.tScene.value = sceneTexture;
      this.bright.uniforms.uThreshold.value = state.bloomThreshold;
      this._pass(this.bright, this.rtBright);

      const radius = state.bloomRadius;
      let source = this.rtBright;
      const slots = [u.tBloom0, u.tBloom1, u.tBloom2];
      for (let i = 0; i < this.bloomLevels && i < this.rtLevels.length; i++) {
        const level = this.rtLevels[i];
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
    u.uExposure.value = state.exposure * this.master;
    u.uTemp.value = state.temp;
    u.uSat.value = state.sat;
    u.uContrast.value = state.contrast;
    u.uLift.value = state.lift;
    u.uGrain.value = state.grain;
    u.uVignette.value = state.vignette;

    this.quad.material = this.composite;
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
  }

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
