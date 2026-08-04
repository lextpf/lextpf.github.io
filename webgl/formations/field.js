import { MODE } from '../lib/modes.js';
import { GOLDEN_ANGLE, clamp01 } from '../lib/random.js';

export const primordial = {
  seed: 0x1101,
  mode: MODE.SPIN_Y,
  build(c) {
    const R = 76;
    for (let i = 0; i < c.count; i++) {
      const r = 6 + R * Math.pow(c.rng.unit(), 0.55);
      const theta = i * GOLDEN_ANGLE + c.rng.signed() * 0.5;
      const cosPhi = c.rng.signed();
      const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
      const lead = c.rng.chance(0.018);
      c.write(
        r * sinPhi * Math.cos(theta),
        r * cosPhi * 0.38,
        r * sinPhi * Math.sin(theta),
        lead ? c.rng.range(2.2, 3.5) : c.rng.range(0.2, 0.66),
        c.rng.chance(0.13) ? c.rng.range(0.45, 1) : c.rng.range(0, 0.2),
        clamp01(r / (R + 6)),
        0.005 + c.rng.unit() * 0.004
      );
    }
  },
};
