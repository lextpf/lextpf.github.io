
import * as THREE from './lib/three.js';
import { damp, easeInOutSine } from './lib/random.js';

export class CameraRig {
  constructor(aspect) {
    this.camera = new THREE.PerspectiveCamera(40, aspect, 0.6, 900);
    this.camera.position.set(0, 0, 64);

    // The authored pose for this frame, before parallax and drift are added.
    this.pos = new THREE.Vector3(0, 0, 64);
    this.look = new THREE.Vector3(0, 0, 0);
    this.fov = 40;
    // Horizontal lens shift, in half-widths of the screen (see _applyLens).
    this.frameX = 0;
    this.parallax = new THREE.Vector2(0, 0);
    this.travel = 0;

    // Scratch vectors, reused every frame. Allocating THREE objects inside the
    // frame loop is the classic way to hand the garbage collector a hitch.
    this._prev = new THREE.Vector3(0, 0, 64);
    this._right = new THREE.Vector3();
    this._probe = new THREE.Vector3();
    this._centre = new THREE.Vector3();
  }

  setAspect(aspect) {
    this.camera.aspect = aspect;
    this._applyLens();
  }

  /* The lens shift is three's native film offset, so unproject (the pointer
     ray) and projectSphere (the horizon) see the same shifted frustum the
     particles are drawn with. Scaled so frameX is an NDC offset: 0.25 moves the
     subject a quarter of the half-width to the right, at any fov or aspect. */
  _applyLens() {
    const cam = this.camera;
    cam.fov = this.fov;
    cam.filmOffset = -this.frameX * cam.aspect * Math.tan((cam.fov * Math.PI) / 360) * cam.getFilmWidth();
    cam.updateProjectionMatrix();
  }

  update(state, pointer, dt, elapsed) {
    this._prev.copy(this.pos);
    this.pos.set(state.camX, state.camY, state.camZ);
    this.look.set(state.tgtX, state.tgtY, state.tgtZ);

    // The hold: while a chapter is read the camera eases a few percent toward
    // its subject and, where a chapter asks for it, turns a fraction of a degree
    // about world Y. Both are 0 at hold 0, so the authored frame is where the
    // camera arrives, and the ease starts and ends with zero velocity.
    const h = easeInOutSine(state.hold || 0);
    const push = (state.holdPush || 0) * h;
    if (push) this.pos.lerp(this.look, push);
    const yaw = ((state.holdYaw || 0) * h * Math.PI) / 180;
    if (yaw) {
      const dx = this.pos.x - this.look.x;
      const dz = this.pos.z - this.look.z;
      const c = Math.cos(yaw);
      const sn = Math.sin(yaw);
      this.pos.x = this.look.x + dx * c + dz * sn;
      this.pos.z = this.look.z - dx * sn + dz * c;
    }

    // How fast the authored camera is flying, normalised and smoothed.
    const speed = dt > 0 ? this._prev.distanceTo(this.pos) / dt : 0;
    this.travel = damp(this.travel, Math.min(1, speed / 26), 3, dt);

    // Parallax reach grows with distance from the subject (the same cursor
    // movement should displace a far shot more than a close one) and is pulled
    // back by `travel`: during a fast chapter transition the camera is already
    // moving, and adding pointer sway on top reads as a wobble.
    const reach = pointer.strength * (1.6 + Math.abs(this.pos.z) * 0.02) * (1 - this.travel * 0.75);
    this.parallax.x = damp(this.parallax.x, pointer.x * reach, 2.4, dt);
    this.parallax.y = damp(this.parallax.y, -pointer.y * reach * 0.7, 2.4, dt);

    // Three sine waves on mutually non-repeating periods, so the idle drift
    // never visibly loops.
    const breath = elapsed * 0.07;

    const cam = this.camera;
    cam.position.set(
      this.pos.x + this.parallax.x + Math.sin(breath) * 0.55,
      this.pos.y + this.parallax.y + Math.cos(breath * 0.83) * 0.4,
      this.pos.z + Math.sin(breath * 0.61) * 0.35
    );
    cam.lookAt(this.look);
    // Rebuilding the projection matrix is not free, so only on a real change.
    const frameX = state.frameX || 0;
    if (Math.abs(this.fov - state.fov) > 1e-4 || Math.abs(this.frameX - frameX) > 1e-4) {
      this.fov = state.fov;
      this.frameX = frameX;
      this._applyLens();
    }
  }

  /* Where does a sphere of `worldRadius` at the origin land on screen, and how
     big is it in screen units?

     The composite pass draws the event horizon and its ring in 2D, as a post
     effect rather than as geometry, so it needs the black hole's position and
     size in the same 0..1 screen space its fragments live in. Projecting the
     centre gives the position; projecting a point one radius along the camera's
     own right vector and measuring the gap gives the size, which works from any
     camera angle without trigonometry. The x term is scaled by aspect because
     screen space is not square. */
  projectSphere(worldRadius, aspect, out) {
    const cam = this.camera;
    this._centre.set(0, 0, 0).project(cam);
    this._right.setFromMatrixColumn(cam.matrixWorld, 0);
    this._probe.copy(this._right).multiplyScalar(worldRadius).project(cam);

    const cx = this._centre.x * 0.5 + 0.5;
    const cy = this._centre.y * 0.5 + 0.5;
    const px = this._probe.x * 0.5 + 0.5;
    const py = this._probe.y * 0.5 + 0.5;
    const dx = (px - cx) * aspect;
    const dy = py - cy;

    out.centre.set(cx, cy);
    out.radius = Math.sqrt(dx * dx + dy * dy);
    return out;
  }

  // Nothing to release: the rig owns no GPU resources. Kept so every subsystem
  // the experience owns can be disposed through the same interface.
  dispose() {
  }
}
