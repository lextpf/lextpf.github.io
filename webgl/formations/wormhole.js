import { MODE, TUNNEL } from '../lib/modes.js';
import { TAU, clamp01, smoothstep } from '../lib/random.js';

const Z_MIN = TUNNEL.zMin;
const Z_LEN = TUNNEL.length;

const RING_SPEED = 0.6;
const HELIX_SPEED = 0.95;
const STREAK_SPEED = 1.55;
const HAZE_SPEED = 0.38;

const RING_PITCH = 7.5;
const BASE_RADIUS = 19;

function radiusAt(z) {
  const swell = 1 + 0.16 * Math.sin(z * 0.05 + 1.2);
  const throat = 0.62 + 0.38 * smoothstep(Math.abs(z + 110) / 60);
  return BASE_RADIUS * swell * throat;
}

const depthAt = (z) => clamp01(1 - (z - Z_MIN) / Z_LEN);

export const wormhole = {
  seed: 0x9909,
  touch: { mode: 7, radius: 12, strength: 3.4 },
  mode: MODE.FLOW_Z,
  warmRadius: 26,
  build(c) {
    const [rings, helices, streaks, haze] = c.split([0.44, 0.22, 0.13, 0.21]);
    const ringCount = Math.max(1, Math.floor(Z_LEN / RING_PITCH));

    for (let i = 0; i < rings; i++) {
      const band = i % ringCount;
      const cadence = [0, 0.55, 1.35, 2.15][band % 4];
      const z = Z_MIN + band * RING_PITCH + cadence + c.rng.bell() * 0.5;
      const r = radiusAt(z) * (1 + c.rng.bell() * 0.045);
      const a = c.rng.unit() * TAU;
      const depth = depthAt(z);
      c.write(
        Math.cos(a) * r,
        Math.sin(a) * r,
        z,
        c.rng.range(0.3, 0.62) * (1.25 - depth * 0.45),
        0.2 + 0.4 * Math.abs(Math.sin(z * 0.03)),
        depth,
        RING_SPEED
      );
    }

    const STRANDS = 5;
    for (let i = 0; i < helices; i++) {
      const z = Z_MIN + Z_LEN * c.rng.unit();
      const R = radiusAt(z) * 0.6;
      const a = z * 0.045 + ((i % STRANDS) / STRANDS) * TAU;
      c.write(
        Math.cos(a) * R + c.rng.bell() * 0.6,
        Math.sin(a) * R + c.rng.bell() * 0.6,
        z,
        c.rng.range(0.4, 0.9),
        c.rng.range(0.55, 1),
        depthAt(z),
        HELIX_SPEED
      );
    }

    for (let i = 0; i < streaks; i++) {
      const z = Z_MIN + Z_LEN * c.rng.unit();
      const R = radiusAt(z) * c.rng.range(1.02, 1.14);
      const a = c.rng.unit() * TAU;
      c.write(
        Math.cos(a) * R,
        Math.sin(a) * R,
        z,
        c.rng.range(0.65, 1.5),
        c.rng.range(0.25, 0.75),
        depthAt(z),
        STREAK_SPEED
      );
    }

    for (let i = 0; i < haze; i++) {
      const z = Z_MIN + Z_LEN * c.rng.unit();
      const R = radiusAt(z) * (0.3 + 0.72 * Math.pow(c.rng.unit(), 0.55));
      const a = c.rng.unit() * TAU;
      c.write(
        Math.cos(a) * R,
        Math.sin(a) * R,
        z,
        c.rng.range(0.2, 0.48),
        c.rng.range(0, 0.35),
        depthAt(z),
        HAZE_SPEED
      );
    }
  },
};
