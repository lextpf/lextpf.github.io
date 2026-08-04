import { MODE } from '../lib/modes.js';
import { TAU } from '../lib/random.js';

export const dissipate = {
  seed: 0x0e0e,
  mode: MODE.STILL,
  build(c) {
    for (let i = 0; i < c.count; i++) {
      const r = 62 + 130 * Math.pow(c.rng.unit(), 0.55);
      const cosPhi = c.rng.signed();
      const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
      const theta = c.rng.unit() * TAU;
      c.write(
        r * sinPhi * Math.cos(theta),
        r * cosPhi,
        r * sinPhi * Math.sin(theta),
        0,
        1,
        c.rng.unit(),
        0,
        0
      );
    }
  },
};
