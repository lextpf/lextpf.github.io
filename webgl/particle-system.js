import * as THREE from './lib/three.js';
import { particleVertex, particleFragment } from './shaders/particles.js';
import { PALETTE } from './chapters.js';
import { MODE, TUNNEL } from './lib/modes.js';
import { makeRng, clamp } from './lib/random.js';

const IDENTITY = new THREE.Matrix3();

function tiltMatrix(tilt) {
  if (!tilt) return IDENTITY.clone();
  const m4 = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
    tilt.x || 0,
    tilt.y || 0,
    tilt.z || 0,
    'XYZ',
  ));
  return new THREE.Matrix3().setFromMatrix4(m4);
}

export class ParticleSystem {
  constructor(registry, count) {
    this.registry = registry;
    this.count = count;

    const rng = makeRng(0x0ff1ce);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) seeds[i] = rng.unit();

    const makeSlot = () => {
      const pos = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
      const attr = new THREE.BufferAttribute(new Float32Array(count * 4), 4);
      const role = new THREE.BufferAttribute(new Float32Array(count), 1);
      pos.setUsage(THREE.DynamicDrawUsage);
      attr.setUsage(THREE.DynamicDrawUsage);
      role.setUsage(THREE.DynamicDrawUsage);
      return {
        pos, attr, role, id: null, mode: MODE.SPIN_Y, tilt: IDENTITY.clone(),
        pivot: new THREE.Vector3(), warmRadius: 26, clock: 0, used: 0,
        touch: { mode: 0, radius: 7, strength: 1.2 },
      };
    };
    this.slots = [makeSlot(), makeSlot(), makeSlot()];
    this.aIndex = 0;
    this.bIndex = 1;
    this.tick = 0;
    this.pendingB = null;

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

    this.uniforms = {
      uMorph: { value: 0 },
      uStaggerSpan: { value: 0.42 },
      uArc: { value: 3 },
      uTime: { value: 0 },
      uClockA: { value: 0 },
      uClockB: { value: 0 },
      uSize: { value: 1 },
      uPixelRatio: { value: 1 },
      uNoise: { value: 0.5 },
      uNoiseScale: { value: 0.04 },
      uNoiseSpeed: { value: 0.05 },
      uFogNear: { value: 26 },
      uFogFar: { value: 170 },
      uFocus: { value: 60 },
      uFocusRange: { value: 90 },
      uDof: { value: 0.35 },
      uWarmRadius: { value: 26 },
      uPulse: { value: 0 },
      uPulseClock: { value: 0 },
      uPulseWidth: { value: 1.6 },
      uPivotA: { value: new THREE.Vector3() },
      uPivotB: { value: new THREE.Vector3() },
      uTunnel: { value: new THREE.Vector2(TUNNEL.zMin, TUNNEL.length) },
      uModeA: { value: MODE.SPIN_Y },
      uModeB: { value: MODE.SPIN_Y },
      uTiltA: { value: IDENTITY.clone() },
      uTiltB: { value: IDENTITY.clone() },
      uColBase: { value: new THREE.Color(PALETTE.base).convertSRGBToLinear() },
      uColAccent: { value: new THREE.Color(PALETTE.accent).convertSRGBToLinear() },
      uColWarm: { value: new THREE.Color(PALETTE.warm).convertSRGBToLinear() },
      uFogColor: { value: new THREE.Color(PALETTE.accent).convertSRGBToLinear() },
      uAccent: { value: 1 },
      uWarm: { value: 0 },
      uFogTint: { value: 0.45 },
      uBokeh: { value: 0.55 },
      uOpacity: { value: 0 },
      uStreak: { value: 0.35 },
      uMorphVel: { value: 0 },
      uVortex: { value: 0 },
      uPinch: { value: 0 },
      uViewport: { value: new THREE.Vector2(1536, 864) },
      uTouchA: { value: new THREE.Vector3(7, 0, 0) },
      uTouchB: { value: new THREE.Vector3(7, 0, 0) },
      uPointerOrigin: { value: new THREE.Vector3() },
      uPointerDir: { value: new THREE.Vector3(0, 0, -1) },
      uPointerMove: { value: new THREE.Vector3() },
      uPointerGain: { value: 0 },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.matrixAutoUpdate = false;

    this.activeCount = count;
    this._neutral = new THREE.Color(PALETTE.base).convertSRGBToLinear();
    this._accent = new THREE.Color(PALETTE.accent).convertSRGBToLinear();
    this._warmColor = new THREE.Color(PALETTE.warm).convertSRGBToLinear();
  }

  setActiveCount(n) {
    this.activeCount = clamp(Math.floor(n), 1024, this.count);
    this.geometry.setDrawRange(0, this.activeCount);
  }

  _find(id) {
    for (let i = 0; i < this.slots.length; i++) if (this.slots[i].id === id) return i;
    return -1;
  }

  _acquire(exclude) {
    let best = -1;
    let bestUsed = Infinity;
    for (let i = 0; i < this.slots.length; i++) {
      if (exclude.indexOf(i) !== -1) continue;
      if (this.slots[i].used < bestUsed) {
        bestUsed = this.slots[i].used;
        best = i;
      }
    }
    return best === -1 ? 0 : best;
  }

  _load(index, id) {
    const slot = this.slots[index];
    if (slot.id === id) return;
    const record = this.registry.get(id);
    slot.pos.array.set(record.pos);
    slot.attr.array.set(record.attr);
    slot.role.array.set(record.role);
    slot.pos.needsUpdate = true;
    slot.attr.needsUpdate = true;
    slot.role.needsUpdate = true;
    slot.id = id;
    slot.mode = record.mode;
    slot.tilt = tiltMatrix(record.tilt);
    slot.pivot.fromArray(record.pivot || [0, 0, 0]);
    slot.warmRadius = record.warmRadius;
    slot.touch = record.touch || { mode: 0, radius: 7, strength: 1.2 };
    slot.clock = 0;
  }

  _bind() {
    const A = this.slots[this.aIndex];
    const B = this.slots[this.bIndex];
    this.geometry.setAttribute('position', A.pos);
    this.geometry.setAttribute('aAttrA', A.attr);
    this.geometry.setAttribute('aRoleA', A.role);
    this.geometry.setAttribute('aPosB', B.pos);
    this.geometry.setAttribute('aAttrB', B.attr);
    this.geometry.setAttribute('aRoleB', B.role);
    this.geometry.setDrawRange(0, this.activeCount);
    this.uniforms.uModeA.value = A.mode;
    this.uniforms.uModeB.value = B.mode;
    this.uniforms.uTiltA.value = A.tilt;
    this.uniforms.uTiltB.value = B.tilt;
    this.uniforms.uPivotA.value = A.pivot;
    this.uniforms.uPivotB.value = B.pivot;
    this.uniforms.uTouchA.value.set(A.touch.radius, A.touch.strength, A.touch.mode);
    this.uniforms.uTouchB.value.set(B.touch.radius, B.touch.strength, B.touch.mode);
  }

  setPair(idA, idB) {
    const boundA = this.slots[this.aIndex];
    const boundB = this.slots[this.bIndex];
    if (boundA.id === idA && boundB.id === idB) {
      boundA.used = ++this.tick;
      boundB.used = this.tick;
      return;
    }

    let ai = this._find(idA);
    let bi = idA === idB ? ai : this._find(idB);
    if (ai < 0) ai = this._acquire(bi >= 0 ? [bi] : []);
    if (bi < 0) bi = idA === idB ? ai : this._acquire([ai]);

    const needsA = this.slots[ai].id !== idA;
    const needsB = bi !== ai && this.slots[bi].id !== idB;
    this._load(ai, idA);
    if (needsB) {
      if (needsA) this.pendingB = { index: bi, id: idB };
      else this._load(bi, idB);
    } else {
      this.pendingB = null;
    }

    this.aIndex = ai;
    this.bIndex = bi;
    this.slots[ai].used = ++this.tick;
    this.slots[bi].used = this.tick;
    this._bind();
  }

  prefetch(id) {
    if (!id || this._find(id) >= 0) return false;
    const index = this._acquire([this.aIndex, this.bIndex]);
    this._load(index, id);
    return true;
  }

  update(state, dt, elapsed) {
    if (this.pendingB) {
      const { index, id } = this.pendingB;
      this.pendingB = null;
      this._load(index, id);
      this._bind();
    }
    this.setPair(state.sceneA, state.sceneB);

    const rate = state.clockRate;
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot.id === null) continue;
      let step = dt * rate;
      if (slot.mode === MODE.FLOW_Z && state.flowFromScroll > 0.01) {
        const bias = clamp(state.velocity * 0.004, -6, 6) * state.flowFromScroll;
        step = dt * (0.45 * rate + bias);
      }
      slot.clock += step;
    }

    const u = this.uniforms;
    const A = this.slots[this.aIndex];
    const B = this.slots[this.bIndex];
    this.pulseClock = (this.pulseClock || 0) + dt * rate * (state.pulseRate || 0);
    u.uPulse.value = state.pulse || 0;
    u.uPulseClock.value = this.pulseClock;
    u.uPulseWidth.value = state.pulseWidth || 1.6;
    u.uClockA.value = A.clock;
    u.uClockB.value = B.clock;
    u.uMorph.value = state.morph;
    u.uStaggerSpan.value = state.stagger;
    u.uArc.value = state.arc;
    u.uVortex.value = state.vortex || 0;
    u.uPinch.value = state.pinch || 0;
    u.uTime.value = elapsed;
    u.uSize.value = state.size;
    u.uNoise.value = state.noise;
    u.uNoiseScale.value = state.noiseScale;
    u.uNoiseSpeed.value = state.noiseSpeed;
    u.uFogNear.value = state.fogNear;
    u.uFogFar.value = state.fogFar;
    u.uFocus.value = state.focus;
    u.uFocusRange.value = state.focusRange;
    u.uDof.value = state.dof;
    u.uBokeh.value = state.bokeh;
    u.uAccent.value = state.accent;
    u.uWarm.value = state.warm;
    u.uFogTint.value = state.fogTint;
    u.uWarmRadius.value = A.warmRadius + (B.warmRadius - A.warmRadius) * state.morph;

    u.uStreak.value = (state.streak !== undefined ? state.streak : 0.55)
      * (state.clockRate !== undefined ? state.clockRate : 0.68);
    const m = state.morph || 0;
    const dm = this._lastMorph === undefined ? 0 : m - this._lastMorph;
    const rawVel = (state.sceneA !== state.sceneB && Math.abs(dm) < 0.5 && !state.snapped)
      ? Math.min(3, Math.abs(dm) / Math.max(dt, 1e-3))
      : 0;
    this._lastMorph = m;
    this._morphVel = (this._morphVel || 0) + (rawVel - (this._morphVel || 0)) * Math.min(1, dt * 7);
    u.uMorphVel.value = this._morphVel * (state.streak !== undefined ? Math.min(1, state.streak * 1.4) : 0.8);

    const mix = state.hazeMix;
    const fog = u.uFogColor.value;
    if (mix <= 0.5) fog.copy(this._neutral).lerp(this._accent, mix * 2);
    else fog.copy(this._accent).lerp(this._warmColor, (mix - 0.5) * 2);
  }

  setOpacity(v) {
    this.uniforms.uOpacity.value = v;
  }

  setPixelRatio(dpr) {
    this.uniforms.uPixelRatio.value = dpr;
  }

  setViewport(w, h) {
    this.uniforms.uViewport.value.set(Math.max(1, w), Math.max(1, h));
  }

  setPointer(origin, dir, move, gain) {
    const u = this.uniforms;
    u.uPointerOrigin.value.copy(origin);
    u.uPointerDir.value.copy(dir);
    u.uPointerMove.value.copy(move);
    u.uPointerGain.value = gain;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
