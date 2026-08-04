import { makeRng, seededOrder } from './lib/random.js';
import { MODE } from './lib/modes.js';
import { GENERATORS } from './formations/index.js';

export { MODE };

export class FormationRegistry {
  constructor(count) {
    this.count = count;
    this.order = seededOrder(count, 0x5e3d);
    this.cache = new Map();
  }

  get(id) {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const generator = GENERATORS[id];
    if (!generator) throw new Error(`[universe] unknown formation "${id}"`);

    const count = this.count;
    const order = this.order;
    const pos = new Float32Array(count * 3);
    const attr = new Float32Array(count * 4);
    const role = new Float32Array(count);
    let cursor = 0;

    const ctx = {
      count,
      rng: makeRng(generator.seed),
      get cursor() {
        return cursor;
      },
      write(x, y, z, size, tint, stagger, spin, rigidity) {
        if (cursor >= count) return;
        const slot = order[cursor++];
        const p = slot * 3;
        const a = slot * 4;
        pos[p] = x;
        pos[p + 1] = y;
        pos[p + 2] = z;
        attr[a] = size;
        attr[a + 1] = tint;
        attr[a + 2] = stagger;
        attr[a + 3] = spin;

        const t = Math.max(0, Math.min(1, (size - 0.45) / 0.7));
        const sizeRigidity = t * t * (3 - 2 * t);
        const authoredRigidity = Number.isFinite(rigidity) ? rigidity : sizeRigidity;
        role[slot] = Math.max(0, Math.min(1, authoredRigidity));
      },
      split(fractions) {
        const sizes = fractions.map((f) => Math.max(0, Math.floor(count * f)));
        const sum = sizes.reduce((a, b) => a + b, 0);
        sizes[sizes.length - 1] += count - sum;
        return sizes;
      },
    };

    generator.build(ctx);
    while (cursor < count) {
      const angle = (cursor / Math.max(1, count)) * Math.PI * 2;
      const radius = 58 + (cursor % 17) * 0.35;
      ctx.write(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius * 0.58,
        ((cursor % 29) - 14) * 0.75,
        0,
        0,
        1,
        0,
        0,
      );
    }

    const record = {
      id,
      pos,
      attr,
      role,
      mode: generator.mode ?? MODE.SPIN_Y,
      tilt: generator.tilt ?? null,
      pivot: generator.pivot ?? null,
      warmRadius: generator.warmRadius ?? 26,
      touch: generator.touch ?? { mode: 0, radius: 7, strength: 1.2 },
    };
    this.cache.set(id, record);
    return record;
  }

  prime(ids) {
    ids.forEach((id) => this.get(id));
  }

  dispose() {
    this.cache.clear();
  }
}
