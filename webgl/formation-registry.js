
import { makeRng, seededOrder } from './lib/random.js';
import { MODE } from './lib/modes.js';
import { GENERATORS } from './formations/index.js';

export { MODE };

export class FormationRegistry {
  constructor(count) {
    this.count = count;
    // One permutation, shared by every formation baked through this registry.
    // See the note on ctx.write below for why it exists.
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

    // The context handed to a generator. Its own seeded rng, so two generators
    // never interfere and a formation bakes identically every time.
    const ctx = {
      count,
      rng: makeRng(generator.seed),
      get cursor() {
        return cursor;
      },
      // The slots the next n writes will land in, in write order. A copy, so
      // the shared shuffle itself is never exposed, and reading ahead changes
      // nothing: write() still takes order[cursor++]. A structure ranks these
      // slots to place its writes so that every ladder cut keeps an even
      // subset of it (lib/sampling.js).
      ahead(n) {
        return order.slice(cursor, Math.min(count, cursor + Math.max(0, n)));
      },
      /* Place one particle.

         The important detail: this writes to order[cursor], not to cursor. Every
         generator's output is scattered through the buffer by the shared
         permutation.

         What it buys: the quality ladder cuts particles by drawing only the
         first N slots, so a cut removes a uniform random sample of every
         formation instead of whole arms or shells in the order the generator
         emitted them.

         The authored `stagger` argument does NOT drive morph timing. It lands
         in attr.z, which the shader reads as the pulse phase. When a particle
         departs comes from its slot seed (fract(aSeed * 317.71)) scaled by the
         chapter's `stagger` span, so a morph is a random, spatially uniform
         dissolve. Wiring the authored order back into timing produces a
         directional wipe; _check_morph_ordering.mjs guards against that. */
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

        // Rigidity: 1 holds formation, 0 drifts freely with the noise field.
        // Unless the generator authors it, derive it from size on a smoothstep,
        // so big particles read as structure and small ones as loose dust.
        const t = Math.max(0, Math.min(1, (size - 0.45) / 0.7));
        const sizeRigidity = t * t * (3 - 2 * t);
        const authoredRigidity = Number.isFinite(rigidity) ? rigidity : sizeRigidity;
        role[slot] = Math.max(0, Math.min(1, authoredRigidity));
      },
      // Divide the particle budget into named parts. The rounding remainder is
      // pushed onto the last part so the fractions always sum to exactly count,
      // whatever the tier's particle budget happens to be.
      split(fractions) {
        const sizes = fractions.map((f) => Math.max(0, Math.floor(count * f)));
        const sum = sizes.reduce((a, b) => a + b, 0);
        sizes[sizes.length - 1] += count - sum;
        return sizes;
      },
    };

    generator.build(ctx);
    // Park whatever the generator did not use on a wide invisible ellipse at
    // size 0. Every formation has to be exactly `count` long: the shader blends
    // particle i of A with particle i of B and cannot bounds-check per vertex.
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

    // Everything past the buffers is per-formation animation metadata that the
    // particle system copies into uniforms when this record is bound.
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
