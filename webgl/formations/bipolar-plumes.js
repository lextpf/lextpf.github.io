import { TAU } from '../lib/random.js';
import { BIPOLAR_PLUME } from '../lib/modes.js';
import { allocate } from './sculpt.js';

export const BIPOLAR_PLUME_SPIN = BIPOLAR_PLUME.spin;

export function writeBipolarPlumes(c, total, {
  start = BIPOLAR_PLUME.start,
  end = BIPOLAR_PLUME.end,
  spin = BIPOLAR_PLUME_SPIN,
} = {}) {
  const [bodyShare, lineShare] = allocate(total, [0.62, 0.38]);
  const perSideBody = allocate(bodyShare, [1, 1]);

  for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
    const side = sideIndex ? 1 : -1;
    const count = perSideBody[sideIndex];
    for (let i = 0; i < count; i++) {
      const t = Math.pow((i + c.rng.unit()) / count, 1.08);
      const distance = start + (end - start) * t;
      const radius = 0.5 + Math.pow(t, 1.18) * 7.2;
      const angle = c.rng.unit() * TAU + side * t * 1.8;
      const radial = radius * Math.pow(c.rng.unit(), 1.45);
      const bend = side * Math.sin(t * Math.PI) * 2.3;
      const edgeFade = Math.sin(Math.PI * Math.min(1, t * 1.04));
      c.write(
        Math.cos(angle) * radial + bend,
        Math.sin(angle) * radial * 0.92,
        side * distance,
        c.rng.range(0.2, 0.46) * (1.16 - t * 0.66) * (0.72 + edgeFade * 0.4),
        Math.min(1, 0.48 + t * 0.46),
        0.09 + t * 0.67,
        spin,
        0.92,
      );
    }
  }

  const linesPerSide = 12;
  const lineBudgets = allocate(lineShare, Array.from({ length: linesPerSide * 2 }, () => 1));
  for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
    const side = sideIndex ? 1 : -1;
    for (let line = 0; line < linesPerSide; line++) {
      const count = lineBudgets[sideIndex * linesPerSide + line];
      const phase = (line / linesPerSide) * TAU + sideIndex * 0.31;
      const handed = line % 2 ? 1 : -1;
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count;
        const distance = start + (end - start) * t;
        const radius = 0.55 + Math.pow(t, 1.12) * (3.3 + (line % 4) * 0.72);
        const angle = phase + handed * (0.5 + t * 3.7);
        c.write(
          Math.cos(angle) * radius + side * Math.sin(t * Math.PI) * 2.3,
          Math.sin(angle) * radius * 0.94,
          side * distance,
          c.rng.range(0.17, 0.34) * (1.12 - t * 0.68),
          Math.min(1, 0.6 + t * 0.36),
          0.1 + t * 0.68,
          spin,
          1,
        );
      }
    }
  }
}
