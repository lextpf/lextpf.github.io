import { MODE, OUTFLOW } from '../lib/modes.js';
import { TAU, GOLDEN_ANGLE } from '../lib/random.js';
import { allocate, ellipsoid } from './sculpt.js';
import { BIPOLAR_PLUME_SPIN, writeBipolarPlumes } from './bipolar-plumes.js';

const KERNEL = 0.75;
const DISC_IN = 2.6;
const DISC_OUT = 32;
const SPIN = BIPOLAR_PLUME_SPIN;

export const whitehole = {
  seed: 0xf10e,
  touch: { mode: 11, radius: 11, strength: 1.6 },
  mode: MODE.OUTFLOW,
  tilt: { x: -1.08, y: -0.58, z: 0 },
  pivot: [0, 0, 0],
  warmRadius: 7.2,
  build(c) {
    const [coreShare, coronaShare, discShare, spiralShare,
      plumeShare, emitterShare, shockShare, fieldShare] =
      c.split([0.05, 0.14, 0.14, 0.17, 0.20, 0.24, 0.04, 0.02]);

    ellipsoid(c, [0, 0, 0], coreShare, {
      radii: [KERNEL * 1.05, KERNEL * 1.05, KERNEL],
      shellShare: 0.3,
      shellMin: 0.7,
      volumePower: 0.85,
      size: (radius) => 0.78 - radius * 0.22,
      tint: (radius) => 0.6 + radius * 0.32,
      tintJitter: 0.08,
      stagger: (radius) => 0.008 + radius * 0.02,
      spin: () => SPIN,
      rigidity: () => 1,
    });

    const RAYS = 84;
    const rayBudgets = allocate(coronaShare, Array.from({ length: RAYS }, (_, index) =>
      index % 11 === 0 ? 1.8 : index % 5 === 0 ? 1.3 : 1
    ));
    for (let ray = 0; ray < RAYS; ray++) {
      const y = 1 - (2 * ray + 1) / RAYS;
      const planar = Math.sqrt(Math.max(0, 1 - y * y));
      const angle = ray * GOLDEN_ANGLE + c.rng.bell() * 0.16;
      const direction = [Math.cos(angle) * planar, y, Math.sin(angle) * planar];
      const length = c.rng.range(3.0, ray % 11 === 0 ? 13.0 : 8.5);
      const count = rayBudgets[ray];
      for (let i = 0; i < count; i++) {
        const t = (i + c.rng.unit()) / count;
        const distance = KERNEL * 0.9 + length * t;
        const curl = Math.sin(t * Math.PI) * c.rng.bell() * 0.42;
        c.write(
          direction[0] * distance + Math.cos(angle + Math.PI / 2) * curl,
          direction[1] * distance + Math.sin(angle + Math.PI / 2) * curl,
          direction[2] * distance + c.rng.bell() * 0.08,
          c.rng.range(0.28, 0.58) * Math.pow(1 - t * 0.76, 0.78),
          c.rng.range(0.62, 0.98),
          0.035 + t * 0.2,
          SPIN,
          0.94,
        );
      }
    }

    for (let i = 0; i < discShare; i++) {
      const u = c.rng.unit();
      const radius = DISC_IN * Math.pow(DISC_OUT / DISC_IN, u);
      const angle = c.rng.unit() * TAU;
      const turbulence =
        0.58 +
        0.24 * Math.cos(angle * 3 - Math.log(radius / DISC_IN) * 8.5) +
        0.18 * Math.sin(angle * 7 + radius * 0.45);
      const height = c.rng.bell() * (0.12 + radius * 0.052) * (0.5 + turbulence);
      c.write(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
        height,
        c.rng.range(0.17, 0.38) * (1.15 - u * 0.62) * (0.75 + turbulence),
        Math.min(1, 0.34 + u * 0.56 + turbulence * 0.08),
        0.1 + u * 0.48,
        SPIN * (1.35 - u * 0.7),
        0.82,
      );
    }

    const ARMS = 7;
    const spiralBudgets = allocate(spiralShare, Array.from({ length: ARMS }, (_, index) =>
      index < 2 ? 1.25 : 1
    ));
    for (let arm = 0; arm < ARMS; arm++) {
      const count = spiralBudgets[arm];
      const phase = (arm / ARMS) * TAU + c.rng.bell() * 0.12;
      const pitch = c.rng.range(2.0, 3.2) * (arm % 2 ? 1 : -1);
      for (let i = 0; i < count; i++) {
        const u = (i + c.rng.unit()) / count;
        const radius = DISC_IN + (DISC_OUT - DISC_IN) * Math.pow(u, 1.18);
        const angle = phase + pitch * Math.log(radius / DISC_IN) + c.rng.bell() * (0.03 + u * 0.05);
        const gap = 0.6 + 0.4 * Math.pow(Math.sin(u * Math.PI * (3 + arm % 3) + phase), 2);
        const width = 0.12 + radius * 0.018;
        c.write(
          Math.cos(angle) * radius + c.rng.bell() * width,
          Math.sin(angle) * radius + c.rng.bell() * width,
          c.rng.bell() * (0.1 + radius * 0.025),
          c.rng.range(0.25, 0.53) * (1.2 - u * 0.62) * gap,
          Math.min(1, 0.52 + u * 0.44),
          0.09 + u * 0.5,
          SPIN * (1.45 - u * 0.78),
          0.96,
        );
      }
    }

    writeBipolarPlumes(c, plumeShare, {
      spin: SPIN,
    });

    for (let i = 0; i < emitterShare; i++) {
      const t = (i + c.rng.unit()) / emitterShare;
      const distance = OUTFLOW.ejectStart + OUTFLOW.ejectSpan * t;
      const polar = c.rng.range(-1, 1);
      const planar = Math.sqrt(Math.max(0, 1 - polar * polar));
      const angle = c.rng.unit() * TAU;
      const spread = 0.025 + distance * 0.0035;
      c.write(
        Math.cos(angle) * planar * distance + c.rng.bell() * spread,
        Math.sin(angle) * planar * distance + c.rng.bell() * spread,
        polar * distance + c.rng.bell() * spread,
        c.rng.range(0.22, 0.5) * (1.08 - t * 0.46),
        Math.min(1, 0.58 + t * 0.4),
        0.08 + t * 0.82,
        -c.rng.range(0.16, 1.16),
        1,
      );
    }

    const SHELLS = 5;
    const shellBudgets = allocate(shockShare, Array.from({ length: SHELLS }, (_, index) => 1 + index * 0.12));
    for (let shell = 0; shell < SHELLS; shell++) {
      const count = shellBudgets[shell];
      const radius = 6.0 + shell * 3.0;
      const start = c.rng.range(-0.7, 0.4);
      const span = c.rng.range(3.7, 5.2);
      for (let i = 0; i < count; i++) {
        const t = (i + c.rng.unit()) / count;
        const angle = start + span * t;
        const wobble = Math.sin(angle * 3 + shell) * 0.22;
        c.write(
          Math.cos(angle) * (radius + wobble),
          Math.sin(angle) * (radius + wobble),
          c.rng.bell() * (0.18 + shell * 0.08),
          c.rng.range(0.13, 0.3) * (1 - shell * 0.09),
          c.rng.range(0.62, 0.96),
          0.62 + shell * 0.045 + t * 0.04,
          SPIN * 0.7,
          0.88,
        );
      }
    }

    for (let i = 0; i < fieldShare; i++) {
      const angle = c.rng.unit() * TAU;
      const radius = c.rng.range(36, 58);
      c.write(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius * 0.58,
        c.rng.bell() * 15,
        c.rng.range(0.07, 0.18),
        c.rng.range(0.28, 0.62),
        0.93 + c.rng.range(0, 0.07),
        SPIN * 0.25,
        0,
      );
    }
  },
};
