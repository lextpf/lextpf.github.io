
import { damp } from './lib/random.js';

export class PointerController {
  constructor(scale = 1) {
    this.x = 0;
    this.y = 0;
    this.strength = 0;
    this.scale = scale;
    // Touch devices get nothing. A coarse pointer has no hover state, so the
    // effect would only ever fire mid-tap and read as a glitch.
    this.enabled = !matchMedia('(pointer: coarse)').matches;
    this._targetX = 0;
    this._targetY = 0;
    this._active = 0;
    this._idle = 0;

    // Normalise to -1..1 with the origin at the centre of the viewport.
    this._onMove = (event) => {
      if (!this.enabled) return;
      this._targetX = (event.clientX / innerWidth) * 2 - 1;
      this._targetY = (event.clientY / innerHeight) * 2 - 1;
      this._active = 1;
      this._idle = 0;
    };
    this._onLeave = () => {
      this._active = 0;
    };

    if (this.enabled) {
      addEventListener('pointermove', this._onMove, { passive: true });
      addEventListener('pointerdown', this._onMove, { passive: true });
      document.addEventListener('pointerleave', this._onLeave, { passive: true });
    }
  }

  // The quality ladder calls this: parallax is one of the few things it cuts,
  // and it drops to 0 on the minimal rung.
  setScale(scale) {
    this.scale = scale;
  }

  update(dt) {
    if (!this.enabled || this.scale <= 0) {
      this.strength = 0;
      return this;
    }
    // A cursor parked for 2.2 seconds counts as gone, even without a leave
    // event, which never fires if the pointer simply stops inside the window.
    this._idle += dt;
    if (this._idle > 2.2) this._active = 0;
    this.x = damp(this.x, this._targetX, 2.6, dt);
    this.y = damp(this.y, this._targetY, 2.6, dt);
    // Slower than the position so influence fades in and out gently rather than
    // snapping the moment the cursor crosses the idle threshold.
    this.strength = damp(this.strength, this._active * this.scale, 1.6, dt);
    return this;
  }

  dispose() {
    if (!this.enabled) return;
    removeEventListener('pointermove', this._onMove);
    removeEventListener('pointerdown', this._onMove);
    document.removeEventListener('pointerleave', this._onLeave);
  }
}
