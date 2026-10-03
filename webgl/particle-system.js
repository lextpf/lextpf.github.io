
import * as THREE from './lib/three.js';
import { particleVertex, particleFragment } from './shaders/particles.js';
import { PALETTE } from './chapters.js';
import { MODE, TUNNEL, HOLE_LENS, JET_BEND, HOLE_FX } from './lib/modes.js';
import { LENS_TABLE, buildLensTable } from './lib/lens-table.js';
import { makeRng, clamp } from './lib/random.js';
import { BLACK_HOLE_HORIZON } from './formations/blackhole.js';

const IDENTITY = new THREE.Matrix3();

// The lens table (lib/lens-table.js) is the same for every instance: built
// once, uploaded per instance as a half-float texture (filterable in WebGL2).
let lensTable = null;
function makeLensTexture() {
  lensTable = lensTable || buildLensTable();
  const half = new Uint16Array(lensTable.length);
  for (let i = 0; i < lensTable.length; i++) half[i] = THREE.DataUtils.toHalfFloat(lensTable[i]);
  const tex = new THREE.DataTexture(half, LENS_TABLE.width, LENS_TABLE.height, THREE.RedFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

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
        pivot: new THREE.Vector3(), warmRadius: 26, clock: 0, rate: 0, used: 0,
        touch: { mode: 0, radius: 7, strength: 1.2 },
        // The next particle of a streamed upload (see _stream), -1 when none.
        stream: -1,
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
    // Global twinkle clock. Never reset, so no slot rollover can pop it.
    this.clock = 0;

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    /* Every slot's buffers are also attached under names the shader never
       reads. three updates every attribute of a drawn geometry, used or not,
       so all three slots get their GPU buffers on the first draw (the prewarm,
       behind the dark entrance) instead of the first time each is bound, and a
       slot's new contents can be uploaded while it is not bound. That is what
       lets a prefetched formation go up a slice per frame while it waits
       (_stream), instead of all 3.2MB on the frame it is first bound, which
       was the hitch at the start of a morph. Unread attributes cost nothing to
       draw: only the program's own attributes are bound to vertex inputs. */
    this.slots.forEach((slot, i) => {
      this.geometry.setAttribute(`aSlot${i}Pos`, slot.pos);
      this.geometry.setAttribute(`aSlot${i}Attr`, slot.attr);
      this.geometry.setAttribute(`aSlot${i}Role`, slot.role);
    });

    this.uniforms = {
      uMorph: { value: 0 },
      uStaggerSpan: { value: 0.42 },
      uArc: { value: 3 },
      uTime: { value: 0 },
      uClockA: { value: 0 },
      uClockB: { value: 0 },
      uClock: { value: 0 },
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
      uShutter: { value: 0 },
      uRateA: { value: 0 },
      uRateB: { value: 0 },
      uMorphShutter: { value: 0 },
      uMorphVel: { value: 0 },
      uHoleR: { value: 0 },
      uLens: { value: new THREE.Vector4() },
      uLensB: { value: new THREE.Vector4() },
      uLensTable: { value: null },
      uJetBend: { value: new THREE.Vector4() },
      uLensC: { value: new THREE.Vector4() },
      uJetLook: { value: new THREE.Vector4() },
      uJetMore: { value: new THREE.Vector4() },
      uImage: { value: 0 },
      uDensity: { value: 1 },
      uVortex: { value: 0 },
      uPinch: { value: 0 },
      uScatter: { value: 0 },
      uHand: { value: 1 },
      uViewport: { value: new THREE.Vector2(1536, 864) },
      uTouchA: { value: new THREE.Vector3(7, 0, 0) },
      uTouchB: { value: new THREE.Vector3(7, 0, 0) },
      uPointerOrigin: { value: new THREE.Vector3() },
      uPointerDir: { value: new THREE.Vector3(0, 0, -1) },
      uPointerMove: { value: new THREE.Vector3() },
      uPointerGain: { value: 0 },
      uFx: { value: new THREE.Vector3() },
    };

    /* Additive blending with depth switched off entirely.

       Additive means overlapping particles sum toward white, which is what makes
       dense regions glow instead of just stacking opaque dots. Depth testing has
       to go with it: additive blending is order-independent (a + b == b + a), so
       sorting buys nothing, and depth WRITES would actively break it by letting
       a near particle mask the ones behind that should be adding to it.

       Premultiplied, ONE + ONE on both colour and alpha. The fragment shader
       already multiplies its colour by its own coverage, so the RGB sum is the
       same light the old SRC_ALPHA blend produced. What changes is the alpha
       channel of the scene target, which the old blend filled with unused
       coverage: it now accumulates the luminance of the light that sits in front
       of a black- or white-hole horizon, so the composite can draw the aperture
       behind it (see vNear in the vertex shader and nearLight in shaders/post.js). */
    this.lensTexture = makeLensTexture();
    this.uniforms.uLensTable.value = this.lensTexture;
    const look = {
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
    };
    this.material = new THREE.ShaderMaterial({ ...look, uniforms: this.uniforms });

    this.points = new THREE.Points(this.geometry, this.material);
    // Culling is pointless here and would be wrong: the bounding box three
    // computes is of the un-morphed slot A, while the shader moves particles
    // far outside it. Same for the matrix, which never changes from identity.
    this.points.frustumCulled = false;
    this.points.matrixAutoUpdate = false;

    // The lens's second image. The same buffers and the same program, drawn
    // again with uImage 1: the vertex shader puts each of the hole's particles
    // at the light that went round the other side of it (holeImage), and
    // drops everything else. Shown only while the lens is on. Its uniforms are
    // the main pass's own objects, so every update reaches both.
    this.mirrorMaterial = new THREE.ShaderMaterial({ ...look, uniforms: { ...this.uniforms, uImage: { value: 1 } } });
    this.mirror = new THREE.Points(this.geometry, this.mirrorMaterial);
    this.mirror.frustumCulled = false;
    this.mirror.matrixAutoUpdate = false;
    this.mirror.visible = false;

    this.activeCount = count;
    this._neutral = new THREE.Color(PALETTE.base).convertSRGBToLinear();
    this._accent = new THREE.Color(PALETTE.accent).convertSRGBToLinear();
    // The lens's shape (lib/modes.js HOLE_LENS), copied so the debug panel or
    // a harness can try other values live.
    this.lens = { ...HOLE_LENS };
    this.jetBend = { ...JET_BEND };
    // The seventh cut's switches (lib/modes.js HOLE_FX).
    this.fx = { ...HOLE_FX };
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
  _load(index, id, stream = false) {
    const slot = this.slots[index];
    if (slot.id === id) return;
    const record = this.registry.get(id);
    slot.pos.array.set(record.pos);
    slot.attr.array.set(record.attr);
    slot.role.array.set(record.role);
    if (stream) {
      // Uploaded a slice per frame from the next frame on (_stream).
      slot.stream = 0;
    } else {
      slot.stream = -1;
      slot.pos.clearUpdateRanges();
      slot.attr.clearUpdateRanges();
      slot.role.clearUpdateRanges();
      slot.pos.needsUpdate = true;
      slot.attr.needsUpdate = true;
      slot.role.needsUpdate = true;
    }
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
    // A slot is about to be drawn: whatever of its upload is still streaming
    // goes up now, on this frame's draw.
    this._flush(A);
    this._flush(B);
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
    this._load(index, id, true);
    return true;
  }

  // Queue particles [from, count) of a slot for upload on the next draw.
  _range(slot, from, n) {
    slot.pos.addUpdateRange(from * 3, n * 3);
    slot.attr.addUpdateRange(from * 4, n * 4);
    slot.role.addUpdateRange(from, n);
    slot.pos.needsUpdate = true;
    slot.attr.needsUpdate = true;
    slot.role.needsUpdate = true;
  }

  // The rest of a streaming upload, at once.
  _flush(slot) {
    if (slot.stream < 0) return;
    this._range(slot, slot.stream, this.count - slot.stream);
    slot.stream = -1;
  }

  /* One slice of a prefetched slot's upload per frame: an eighth of its
     buffers (about 400KB at 100k particles), so a prefetch never costs a
     frame more than a small copy. It is invisible until bound, and _bind
     flushes whatever is left if the scroll gets there first. */
  _stream() {
    const step = Math.ceil(this.count / 8);
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot.stream < 0) continue;
      if (i === this.aIndex || i === this.bIndex) {
        this._flush(slot);
        continue;
      }
      const n = Math.min(step, this.count - slot.stream);
      this._range(slot, slot.stream, n);
      slot.stream = slot.stream + n >= this.count ? -1 : slot.stream + n;
      return;
    }
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
    this._stream();

    /* Each slot keeps its own animation clock rather than sharing elapsed time.

       A formation that is not currently on screen must not keep spinning: it
       would be at an arbitrary rotation when the morph reaches it, and particles
       would arrive at positions that have drifted away from where they were
       aimed. Per-slot clocks start at 0 on load and only advance while bound:
       the prefetched spare slot stays at 0 until it joins the pair. */
    const rate = state.clockRate;
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot.id === null || (i !== this.aIndex && i !== this.bIndex)) continue;
      // Clock units per second. Kept on the slot because the motion streak
      // below needs the true rate, not the chapter's nominal one.
      slot.rate = rate;
      // The wormhole tunnel is the one formation that reacts to scrolling: its
      // flow speeds up, slows and reverses with the scroll, so travelling down
      // the page feels like travelling down the tunnel. Clamped so a flick
      // cannot fling it, and it keeps a baseline drift so it never fully stops.
      if (slot.mode === MODE.FLOW_Z && state.flowFromScroll > 0.01) {
        const bias = clamp(state.velocity * 0.004, -6, 6) * state.flowFromScroll;
        slot.rate = 0.45 * rate + bias;
      }
      // Warp: leaving a flowing formation whose chapter asks for it, the flow
      // accelerates across the band (state.t, the morph head's place in it),
      // so the tunnel races past faster and faster and its particles leave
      // for the next formation at speed. Only the departing slot.
      if (slot.mode === MODE.FLOW_Z && i === this.aIndex && state.warp > 0.001) {
        const x = clamp((state.t || 0) / 0.8, 0, 1);
        slot.rate += state.warp * 16 * Math.pow(x * x * (3 - 2 * x), 1.8);
      }
      // The galaxy turns with the scroll the same way: scrolling down winds
      // it on, scrolling back unwinds it, and at rest it turns at its own
      // slow pattern speed.
      if (slot.id === 'galaxy' && state.spinFromScroll > 0.01) {
        slot.rate = rate + clamp(state.velocity * 0.004, -6, 6) * state.spinFromScroll;
      }
      slot.clock += dt * slot.rate;
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
    this.clock += dt * rate;
    u.uClock.value = this.clock;
    u.uMorph.value = state.morph;
    u.uStaggerSpan.value = state.stagger;
    u.uArc.value = state.arc;
    u.uVortex.value = state.vortex || 0;
    u.uPinch.value = state.pinch || 0;
    u.uScatter.value = state.scatter || 0;
    // One bow handedness for the whole cloud, alternating per chapter pair. It
    // flips only at a pair rollover, where the morph sits at an endpoint and
    // the bow term is zero, so the flip is never visible.
    u.uHand.value = state.index % 2 ? -1 : 1;
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

    /* Motion streaks are a real shutter. Each particle is drawn smeared over
       the distance it covers while the shutter is open, so a streak's length is
       its true motion, and a scene that is barely turning does not smear as
       though it were.

       The formation's own motion is exposed for at most half a frame (a 180
       degree shutter, 8.3 ms at 60 fps), shorter where a chapter's `streak`
       asks for less, and it moves at each bound slot's true clock rate: the
       tunnel's flow speeds up with the scroll, and so does its streak. The
       morph flight gets half a frame scaled by `streak`. dt is clamped so a
       stall or a burst of frames cannot stretch the exposure. The shader turns
       the resulting displacement into a streak length in pixels and fades the
       streak in between 0.75 and 1.5 px of travel, so a dot that is barely
       moving stays a round dot. */
    const streak = state.streak !== undefined ? state.streak : 0.5;
    const sdt = clamp(dt, 1 / 240, 1 / 30);
    u.uShutter.value = Math.min(0.5 * sdt, 0.026 * streak);
    u.uMorphShutter.value = 0.5 * sdt * Math.min(1, 2 * streak);
    u.uRateA.value = A.rate;
    u.uRateB.value = B.rate;

    /* How fast the morph itself is progressing, in morph units per second,
       used to smear particles along their flight path. Two guards on the raw
       measurement:

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
    u.uMorphVel.value = this._morphVel;

    // The horizon the composite draws is a sphere of BLACK_HOLE_HORIZON *
    // horizon world units at the origin. While a hole formation is bound the
    // shader tells each particle whether it sits in front of that sphere, so
    // the near side of the rotating disc crosses the shadow instead of being
    // erased by it. The transport populations (infall and ejecta) are kept
    // behind it in the shader: as loose dots they would read as stars seen
    // through the hole.
    const hole = (mode) => mode === MODE.ACCRETION || mode === MODE.OUTFLOW;
    u.uHoleR.value = hole(A.mode) || hole(B.mode) ? BLACK_HOLE_HORIZON * (state.horizonBase || 0) : 0;

    // The black hole's lens (lib/modes.js HOLE_LENS), while a mode-5 slot is
    // bound. The shader weights it per particle by that slot's share, and the
    // chapter's `lensing` is scene-linked, so it arrives with the geometry.
    const accretion = A.mode === MODE.ACCRETION || B.mode === MODE.ACCRETION;
    const lensing = accretion ? Math.max(0, state.lensing || 0) : 0;
    // The composite's aperture is the critical curve, 3 sqrt(3) / 2 rs, so the
    // hole whose light the particles follow casts exactly the shadow that is
    // drawn. `lensing` scales its mass: at 0 the lens is the identity.
    const L = this.lens;
    const rs = ((BLACK_HOLE_HORIZON * (state.horizonBase || 0)) / 2.5980762) * lensing;
    u.uLens.value.set(rs, L.drag * Math.min(1, lensing), L.gain, L.mirror);
    u.uLensB.value.set(L.sky, L.dragPower, L.mirrorLift, L.jetLens);
    const J = this.jetBend;
    u.uJetBend.value.set(J.turn, 0, Math.cos(J.angle), Math.sin(J.angle));
    u.uJetLook.value.set(J.beam, J.depth, J.shade, 0);
    u.uJetMore.value.set(J.lift, J.lower, J.early, 0);
    u.uLensC.value.set(L.pack, L.edge * Math.min(1, lensing), L.rimSoft, L.rimFloor);
    this.mirror.visible = rs > 1e-4 && L.mirror > 0;
    const F = this.fx;
    u.uFx.value.set(F.doppler, F.frozen, F.corkscrew);

    // Fog is neutral leaning toward the accent blue and never warm: hazeMix is
    // capped at 0.5 and scaled, so the fog is at most 40% accent. Warm belongs
    // to the black-hole ring and core only.
    u.uFogColor.value.copy(this._neutral).lerp(this._accent, Math.min(state.hazeMix, 0.5) * 0.8);
  }

  /* For the composite's Doppler crescents (shaders/post.js uCrescent): for
     each bound hole, the screen angle (y up, x in screen heights) of the side
     of its disc coming toward the camera, the azimuth whose orbital velocity
     has the most view-space z, as the shader's dopplerFor and whiteDoppler
     measure it. */
  holeCrescent(camera) {
    const ev = this._events || (this._events = { doppler: 0, crescent: 0, white: 0, whiteAngle: 0, _p: new THREE.Vector3(), _o: new THREE.Vector3() });
    const A = this.slots[this.aIndex];
    const B = this.slots[this.bIndex];
    const pick = (mode) => (A.mode === mode ? A : B.mode === mode ? B : null);
    const black = pick(MODE.ACCRETION);
    const white = pick(MODE.OUTFLOW);
    ev.doppler = black ? this.fx.doppler : 0;
    ev.white = white ? this.fx.doppler : 0;
    if (!ev.doppler && !ev.white) return ev;
    camera.updateMatrixWorld();
    if (ev.doppler) ev.crescent = this._approach(black, camera, ev);
    if (ev.white) ev.whiteAngle = this._approach(white, camera, ev);
    return ev;
  }

  _approach(slot, camera, ev) {
    const T = slot.tilt.elements;
    const V = camera.matrixWorldInverse.elements;
    const m0 = V[2] * T[0] + V[6] * T[1] + V[10] * T[2];
    const m1 = V[2] * T[3] + V[6] * T[4] + V[10] * T[5];
    const a = Math.atan2(-m0, m1);
    const c = Math.cos(a) * 5.1, s = Math.sin(a) * 5.1;
    const o = ev._o.set(0, 0, 0).project(camera);
    const p = ev._p.set(T[0] * c + T[3] * s, T[1] * c + T[4] * s, T[2] * c + T[5] * s).project(camera);
    return Math.atan2(p.y - o.y, (p.x - o.x) * camera.aspect);
  }

  setOpacity(v) {
    this.uniforms.uOpacity.value = v;
  }

  setSizeScale(scale) {
    this.uniforms.uSizeScale.value = scale;
  }

  // The quality ladder's size compensation (cv-universe.js densitySize, 1 at
  // the full count). Each dot is a crisp point whatever its size, so on a lower
  // rung the compensation widens the dot's footprint as well as its energy:
  // fewer, slightly larger points, the way the ladder always meant it, instead
  // of the same points made hotter, which the tone curve would compress into a
  // darker, sparser field.
  setDensity(k) {
    this.uniforms.uDensity.value = k;
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
    this.mirrorMaterial.dispose();
    this.lensTexture.dispose();
  }
}
