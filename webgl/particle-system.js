
import * as THREE from './lib/three.js';
import { particleVertex, particleFragment } from './shaders/particles.js';
import { PALETTE } from './chapters.js';
import { MODE, TUNNEL } from './lib/modes.js';
import { makeRng, clamp } from './lib/random.js';

const IDENTITY = new THREE.Matrix3();

// A formation can be authored tilted. Baking the rotation into a matrix here
// keeps it out of the shader's inner loop, where it would cost per particle.
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

    // One fixed random number per particle, uploaded once and never changed.
    // The shader uses it to de-synchronise everything that would otherwise move
    // in lockstep: twinkle phase, noise offset, flight path bend.
    const rng = makeRng(0x0ff1ce);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) seeds[i] = rng.unit();

    // DynamicDrawUsage tells the driver these buffers will be rewritten, so it
    // places them in memory it can update cheaply. The contents are only ever
    // replaced wholesale by _load, never edited in place.
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
    // Three cached point clouds. Two are bound as the morph pair, the
    // third stays free so the next chapter can be prefetched into it.
    //
    // Three is the smallest number that works: with two, scrolling into a new
    // chapter would always evict the slot the chapter after it is about to need.
    this.slots = [makeSlot(), makeSlot(), makeSlot()];
    this.aIndex = 0;
    this.bIndex = 1;
    // Monotonic counter stamped onto a slot whenever it is bound, so `used`
    // orders the slots by how recently they mattered.
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
      uSizeScale: { value: 1 },
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

    /* Additive blending with depth switched off entirely.

       Additive means overlapping particles sum toward white, which is what makes
       dense regions glow instead of just stacking opaque dots. Depth testing has
       to go with it: additive blending is order-independent (a + b == b + a), so
       sorting buys nothing, and depth WRITES would actively break it by letting
       a near particle mask the ones behind that should be adding to it. */
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
    // Culling is pointless here and would be wrong: the bounding box three
    // computes is of the un-morphed slot A, while the shader moves particles
    // far outside it. Same for the matrix, which never changes from identity.
    this.points.frustumCulled = false;
    this.points.matrixAutoUpdate = false;

    this.activeCount = count;
    this._neutral = new THREE.Color(PALETTE.base).convertSRGBToLinear();
    this._accent = new THREE.Color(PALETTE.accent).convertSRGBToLinear();
    this._warmColor = new THREE.Color(PALETTE.warm).convertSRGBToLinear();
  }

  // How the quality ladder cuts cost. The buffers stay at full size and only the
  // draw range shrinks, so changing tier is free: no reallocation, no re-bake.
  // Because the registry writes through a shuffle, the surviving prefix is a
  // uniform random sample of the formation rather than one side of it.
  setActiveCount(n) {
    this.activeCount = clamp(Math.floor(n), 1024, this.count);
    this.geometry.setDrawRange(0, this.activeCount);
  }

  _find(id) {
    for (let i = 0; i < this.slots.length; i++) if (this.slots[i].id === id) return i;
    return -1;
  }

  // Evict the least-recently-bound slot, never one that's live this frame.
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

  // Copy a baked formation into a slot. This is the expensive operation in the
  // file: three typed-array copies totalling about 3.2MB at 100k particles, plus
  // the upload the driver does on next draw. Everything else here exists to
  // avoid calling it at a bad moment.
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

  // Point the geometry at the two chosen slots and copy their per-formation
  // metadata into uniforms. Rebinding an attribute is just a pointer swap, so
  // this is cheap even though _load is not.
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

  // Make idA and idB the bound pair, loading whatever is not already cached.
  // Called every frame, so the already-correct case has to be free.
  setPair(idA, idB) {
    const boundA = this.slots[this.aIndex];
    const boundB = this.slots[this.bIndex];
    if (boundA.id === idA && boundB.id === idB) {
      boundA.used = ++this.tick;
      boundB.used = this.tick;
      return;
    }

    // Prefer a slot that already holds the formation; only then evict. When both
    // ids are the same (consecutive chapters sharing a scene) one slot serves as
    // both ends of the pair and the morph is a no-op.
    let ai = this._find(idA);
    let bi = idA === idB ? ai : this._find(idB);
    if (ai < 0) ai = this._acquire(bi >= 0 ? [bi] : []);
    if (bi < 0) bi = idA === idB ? ai : this._acquire([ai]);

    /* If both ends need loading, do not do both now. Two back-to-back copies of
       3.2MB plus two uploads in one frame is a visible stall, and it lands
       exactly when the user is scrolling fast enough to have outrun the
       prefetch. Load A, defer B to the top of the next frame.

       Deferring is safe because A is the formation currently on screen; B is
       where the particles are heading and is not visible until morph leaves 0. */
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

  // Warm the third slot with a formation nothing is using yet. Called from
  // maybePrefetch once the scroll is far enough into a chapter to be confident
  // which one comes next. Excluding both bound indices is what guarantees this
  // can never evict something on screen.
  prefetch(id) {
    if (!id || this._find(id) >= 0) return false;
    const index = this._acquire([this.aIndex, this.bIndex]);
    this._load(index, id);
    return true;
  }

  update(state, dt, elapsed) {
    // Pay off the load deferred by setPair last frame, before anything else.
    if (this.pendingB) {
      const { index, id } = this.pendingB;
      this.pendingB = null;
      this._load(index, id);
      this._bind();
    }
    this.setPair(state.sceneA, state.sceneB);

    /* Each slot keeps its own animation clock rather than sharing elapsed time.

       A formation that is not currently on screen must not keep spinning: it
       would be at an arbitrary rotation when the morph reaches it, and particles
       would arrive at positions that have drifted away from where they were
       aimed. Per-slot clocks start at 0 on load and only advance while bound. */
    const rate = state.clockRate;
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot.id === null) continue;
      let step = dt * rate;
      // The wormhole tunnel is the one formation that reacts to scrolling: its
      // flow speeds up, slows and reverses with the scroll, so travelling down
      // the page feels like travelling down the tunnel. Clamped so a flick
      // cannot fling it, and it keeps a baseline drift so it never fully stops.
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

    // Motion streaks scale with the formation's own clock, so a scene that is
    // barely turning does not smear as though it were.
    u.uStreak.value = (state.streak !== undefined ? state.streak : 0.55)
      * (state.clockRate !== undefined ? state.clockRate : 0.68);

    /* How fast the morph itself is progressing, used to stretch particles along
       their flight path. Two guards on the raw measurement:

       |dm| < 0.5 rejects a discontinuity. morph is a remapped value, so it can
       jump from 1 back to 0 when the chapter pair rolls over, and that is a
       bookkeeping change rather than motion. `snapped` rejects the same thing
       after an anchor jump.

       Then it is smoothed, because the raw frame-to-frame difference is far too
       noisy to drive a visual with directly. */
    const m = state.morph || 0;
    const dm = this._lastMorph === undefined ? 0 : m - this._lastMorph;
    const rawVel = (state.sceneA !== state.sceneB && Math.abs(dm) < 0.5 && !state.snapped)
      ? Math.min(3, Math.abs(dm) / Math.max(dt, 1e-3))
      : 0;
    this._lastMorph = m;
    this._morphVel = (this._morphVel || 0) + (rawVel - (this._morphVel || 0)) * Math.min(1, dt * 7);
    u.uMorphVel.value = this._morphVel * (state.streak !== undefined ? Math.min(1, state.streak * 1.4) : 0.8);

    // Fog colour is a single 0..1 dial across the three-colour palette: neutral
    // at 0, accent blue at the midpoint, warm at 1. Two lerps rather than one so
    // it passes through accent rather than averaging past it.
    const mix = state.hazeMix;
    const fog = u.uFogColor.value;
    if (mix <= 0.5) fog.copy(this._neutral).lerp(this._accent, mix * 2);
    else fog.copy(this._accent).lerp(this._warmColor, (mix - 0.5) * 2);
  }

  setOpacity(v) {
    this.uniforms.uOpacity.value = v;
  }

  setSizeScale(scale) {
    this.uniforms.uSizeScale.value = scale;
  }

  setViewport(w, h) {
    this.uniforms.uViewport.value.set(Math.max(1, w), Math.max(1, h));
  }

  // The pointer as a ray in world space, not a screen position: the shader needs
  // to know how close each particle is to the line the cursor is pointing along.
  // `move` is the smoothed velocity of the ray's tip, which is what lets a flick
  // push particles rather than merely a hover displacing them.
  setPointer(origin, dir, move, gain) {
    const u = this.uniforms;
    u.uPointerOrigin.value.copy(origin);
    u.uPointerDir.value.copy(dir);
    u.uPointerMove.value.copy(move);
    u.uPointerGain.value = gain;
  }

  // The slot buffers are owned by the geometry and go with it. The baked
  // formations themselves belong to the registry, which is disposed separately.
  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
