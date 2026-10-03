
import { TAU } from '../lib/random.js';
import { BIPOLAR_PLUME } from '../lib/modes.js';
import { progressiveGrid } from '../lib/sampling.js';
import { allocate } from './sculpt.js';

/* ==========================================================================
   THE TWIN JETS (shared by the black and the white hole)

   Both holes fire the same pair of plumes along their spin axis (local z),
   so a black hole turning white keeps its jets through the collapse. The
   shader moves them with plumeMotion() in modes 5 and 7: a bounded wave
   along the axis and a slow twist, never a translation.

   The budget splits 62/38 between the diffuse body and the filaments, then
   evenly across the two sides. The body is a soft cone with a dense spine;
   the filaments are 12 helical lines per side. Each filament is written
   consecutively and placed along the progressive grid (lib/sampling.js), so
   every ladder cut keeps an evenly spaced subset of each line instead of a
   random one (dash-dot at 37k). The plumes are designed to leave the frame
   and are outside the offscreen budget.
   ========================================================================== */

export const BIPOLAR_PLUME_SPIN = BIPOLAR_PLUME.spin;

// Callers pass whatever budget they can spare.
// `fadeIn`: the fraction of the length over which a jet grows from nothing
// (size and light), so it has no clear base: the white hole has no horizon
// for its jets to leave from. 0 keeps the black hole's crisp start.
// `body`: the diffuse cone's share of the budget against the filaments'
// (0.62 by default); the black hole passes 0.28, jets thinned to filaments.
// `lines`: helical filaments per side (12).
// `bright`: a size factor on every jet particle (1); the black hole passes
// 1.5 so its thinned jets still read against the disc.
// `sides`: the two jets' shares of the budget, [-z, +z] ([1, 1]).
// `widths`: the two jets' radius factors, [-z, +z] ([1, 1]): body and
// filaments alike, so a narrower jet also has its lines closer together.
// `bow`: how far each plume bows sideways at mid-length (2.3). The shader's
// slow twist turns the bow round the axis, so a bowed jet sweeps; the black
// hole passes 0 and its jets hold still on the axis.
export function writeBipolarPlumes(c, total, {
  start = BIPOLAR_PLUME.start,
  end = BIPOLAR_PLUME.end,
  spin = BIPOLAR_PLUME_SPIN,
  fadeIn = 0,
  body = 0.62,
  lines = 12,
  bright = 1,
  bow = 2.3,
  sides = [1, 1],
  widths = [1, 1],
} = {}) {
  const grow = (t) => {
    if (fadeIn <= 0) return 1;
    const x = Math.min(1, t / fadeIn);
    return x * x * (3 - 2 * x);
  };
  const [bodyShare, lineShare] = allocate(total, [body, 1 - body]);
  const perSideBody = allocate(bodyShare, sides);

  for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
    const side = sideIndex ? 1 : -1;
    const count = perSideBody[sideIndex];
    for (let i = 0; i < count; i++) {
      const t = Math.pow((i + c.rng.unit()) / count, 1.08);
      const distance = start + (end - start) * t;
      const radius = (0.5 + Math.pow(t, 1.18) * 7.2) * widths[sideIndex];
      const angle = c.rng.unit() * TAU + side * t * 1.8;
      // Power above 1 pulls particles toward the axis, so the jet has a dense
      // spine and a soft edge rather than a uniformly filled cone.
      const radial = radius * Math.pow(c.rng.unit(), 1.45);
      // Bow each plume sideways, peaking mid-length: a jet bent by its own
      // rotation, rather than two straight spikes.
      const bend = side * Math.sin(t * Math.PI) * bow;
      const edgeFade = Math.sin(Math.PI * Math.min(1, t * 1.04));
      c.write(
        Math.cos(angle) * radial + bend,
        Math.sin(angle) * radial * 0.92,
        side * distance,
        c.rng.range(0.2, 0.46) * (1.16 - t * 0.66) * (0.72 + edgeFade * 0.4) * grow(t) * bright,
        Math.min(1, 0.48 + t * 0.46),
        0.09 + t * 0.67,
        spin,
        0.92,
      );
    }
  }

  const linesPerSide = lines;
  const lineBudgets = allocate(lineShare, Array.from({ length: linesPerSide * 2 }, (_, i) => sides[i < linesPerSide ? 0 : 1]));
  for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
    const side = sideIndex ? 1 : -1;
    for (let line = 0; line < linesPerSide; line++) {
      const count = lineBudgets[sideIndex * linesPerSide + line];
      const phase = (line / linesPerSide) * TAU + sideIndex * 0.31;
      const handed = line % 2 ? 1 : -1;
      // Write i of the line takes grid point g[i]: the full line is the old
      // even grid, and every cut keeps an evenly spread subset of it.
      const g = progressiveGrid(c.ahead(count));
      for (let i = 0; i < count; i++) {
        const t = (g[i] + 0.5) / count;
        const distance = start + (end - start) * t;
        const radius = (0.55 + Math.pow(t, 1.12) * (3.3 + (line % 4) * 0.72)) * widths[sideIndex];
        const angle = phase + handed * (0.5 + t * 3.7);
        c.write(
          Math.cos(angle) * radius + side * Math.sin(t * Math.PI) * bow,
          Math.sin(angle) * radius * 0.94,
          side * distance,
          c.rng.range(0.17, 0.34) * (1.12 - t * 0.68) * grow(t) * bright,
          Math.min(1, 0.6 + t * 0.36),
          0.1 + t * 0.68,
          spin,
          1,
        );
      }
    }
  }
}
