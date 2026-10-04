
import { MODE, TUNNEL, tunnelSpin, TUNNEL_STILL } from '../lib/modes.js';
import { TAU, clamp01 } from '../lib/random.js';
import { progressiveGrid, jittered, hash01 } from '../lib/sampling.js';

/* ==========================================================================
   THE WORMHOLE (Open Source)

   A throat in spacetime, seen from just inside its mouth. The tunnel is one
   fixed shape the material passes THROUGH: the bake is a straight cylinder
   in tube space (xy on TUNNEL.radius, z the place along the length), and the
   vertex shader (mode 2, lib/modes.js TUNNEL) deforms every particle by the
   depth it has flowed to. So the wall swells and pinches to half its radius
   at the throat, the cross-section twists a whole turn over the length and
   spins up through the throat, the flow slows and packs there and races out
   past it, and the axis sways far from the throat while the throat itself
   holds still.

   Third cut (2026-09-29). The tunnel is a SURFACE with rings on it, not a
   bundle of lines: the second cut's seven ropes, sixteen streamlines, three
   vortex helices and eight sheath spirals crossed each other into a tangle
   of thread with no wall to read. Now most of the budget is the wall itself,
   a dense cloudy dust that thickens toward the throat, and the lines are
   fourteen whole rings riding down it (the old tunnel's four-beat cadence)
   plus three wide soft helices that all wind the same way, like the grooves
   of a screw, so nothing crosses.

   Fifth cut (2026-10-03). The still throat ring and the still corona round
   it are gone: everything in the tube now flows, and their budget, with a
   little of the wall's, is 140 lanes, dashes of light streaming down the
   wall; and there are 22 rings instead of 14.

   Populations, in write order (shares of the budget):
   - Wall 0.19. Fine dust on the wall, cloudy (its brightness follows a
     periodic texture of bands and patches in tube space, so the wall has
     weather rather than a grain), packed toward the throat (t^1.25 about it).
     It flows at the rings' speed with no rigid turn, so its texture flows
     through the tunnel intact.
   - Rings 0.25. Twenty-two whole rings at the four-beat cadence (so the hoops
     never strobe), a power law of weights (most fine, a few heavy), each a
     little tilted off its plane, brightest on one side, alternate rings
     turning opposite ways.
   - Helices 0.08. Three wide, soft, beaded strands just inside the wall,
     each one turn over the length in the same sense, golden-angle starts.
   - Lanes 0.18. A hundred and forty dashes of light on the wall, 12 to 52 units
     long, each parallel to the helices (one turn over the length, in the
     same sense), so no line crosses another, flowing at 0.8-1.2: a bright
     head toward the camera and a tail fading behind it.
   - Waves 0.13. Twenty-four fine partial hoops born at the throat and
     riding toward the camera with the flow, each a sparse arc of a third to
     two thirds of the way round, tilted off its plane, thickening a little
     and fading as it comes: the detail the eye follows out of the throat.
     Spread evenly over the near half of the tunnel.
   - Streaks 0.04. Short fast dashes just outside the wall, heads forward.
   - Sky 0.07. Still dust outside the wall, the fixed frame the flow is read
     against.
   - Haze 0.06. Slow loose dust inside, drifting on the noise field.

   Speeds. The wall and the rings flow at 0.6, the lanes 0.8-1.2, the helices
   about 0.95, the streaks 1.45-2, the haze 0.38; the spread between them is
   the depth cue. The shader adds each particle's rigid rotation (tunnelSpin's
   rot digit). Only the sky does not flow (TUNNEL_STILL).

   No seam. A particle leaving the near end re-enters at the far end, so
   everything here repeats exactly over the length: the helices take whole
   turns, the wall's texture and the beads whole waves, and the tube's own
   profile is periodic in the shader. The pulse phase is the one attribute
   that does not: it runs 0 (near) to 1 (far), a whole turn of the wave at
   pulseWidth 1.

   Placement. Every ring, helix and dash is written consecutively on the
   progressive grid; the fills are jittered Roberts sets (lib/sampling.js),
   so a ladder cut thins each evenly instead of breaking it.
   ========================================================================== */

const Z_MIN = TUNNEL.zMin;
const Z_LEN = TUNNEL.length;
const RAD = TUNNEL.radius;
const THROAT_U = Z_MIN + TUNNEL.throatAt * Z_LEN;
const PH = (u) => ((u - Z_MIN) / Z_LEN) * TAU;
const wrapU = (u) => Z_MIN + ((((u - Z_MIN) % Z_LEN) + Z_LEN) % Z_LEN);
// 1 at the far end, 0 at the near end: the pulse phase.
const depthAt = (u) => clamp01(1 - (u - Z_MIN) / Z_LEN);

const RING_FLOW = 0.6;
const HELIX_FLOW = 0.95;
const HAZE_FLOW = 0.38;
const GOLD = 0.6180339887498949;

const RINGS = 22;
const RING_ROT = [3, 7, 4, 6];
// Ring weights, fixed by hash: most fine, a few heavy.
const RING_W = Array.from({ length: RINGS }, (_, i) => 0.3 + 2.2 * Math.pow(hash01(i * 977 + 5), 2.4));
// The rings' places along the tunnel: an even pitch broken by the four-beat
// cadence and a little jitter, so the comb never repeats evenly.
const RING_U = Array.from({ length: RINGS }, (_, i) =>
  Z_MIN + (i + 0.5) * (Z_LEN / RINGS) + [0, 0.55, 1.35, 2.15][i % 4] * 2.4 + (hash01(i * 71 + 3) - 0.5) * 4);

// The wall's weather: a periodic texture of bands and patches in tube space
// (a round the tube, ph = PH(u) along it), 0 to 1, whole waves over the length.
function weather(a, ph) {
  const s = 0.5 * Math.sin(3 * a + 2 * ph + 1.3)
    + 0.3 * Math.sin(5 * a - 3 * ph + 0.4) * Math.sin(2 * a + 5 * ph)
    + 0.2 * Math.sin(7 * a + ph - 2.1) * Math.sin(a - 4 * ph + 0.8);
  return clamp01(0.5 + 0.9 * s);
}

function even(n, k) {
  const base = Math.floor(n / k);
  const out = new Array(k).fill(base);
  for (let i = 0; i < n - base * k; i++) out[i]++;
  return out;
}
function weighted(n, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const out = weights.map((q) => Math.floor((n * q) / sum));
  let rest = n - out.reduce((a, b) => a + b, 0);
  for (let i = 0; rest > 0; i = (i + 1) % out.length, rest--) out[i]++;
  return out;
}

export const wormhole = {
  seed: 0x9909,
  touch: { mode: 7, radius: 12, strength: 3.4 },
  mode: MODE.FLOW_Z,
  warmRadius: 26,
  build(c) {
    const [wall, rings, helices, lanes, waves, streaks, sky, haze] =
      c.split([0.19, 0.25, 0.08, 0.18, 0.13, 0.04, 0.07, 0.06]);
    const rng = c.rng;
    // Tube space: f is the radius as a share of the wall, a the angle round
    // it, u the place along the length.
    const put = (f, a, u, size, tint, spin, rigidity) =>
      c.write(Math.cos(a) * f * RAD, Math.sin(a) * f * RAD, u, size, tint, depthAt(u), spin, rigidity);

    /* The wall: cloudy dust on the surface, packed toward the throat. */
    {
      const { p } = jittered(c.ahead(wall), 2, 0.7, 211);
      const spin = tunnelSpin(RING_FLOW, 5);
      for (let j = 0; j < wall; j++) {
        // Pulled toward the throat: x in -1..1 about it, kept sign, |x|^1.25
        // (1.5 packed the throat's rim into a solid band).
        const x = 2 * p[j * 2] - 1;
        const t = 0.5 + 0.5 * Math.sign(x) * Math.pow(Math.abs(x), 1.25);
        const u = Z_MIN + Z_LEN * ((t + TUNNEL.throatAt - 0.5 + 1) % 1);
        const a = TAU * p[j * 2 + 1];
        const wx = Math.pow(weather(a, PH(u)), 1.4);
        put(1 + rng.bell() * 0.03, a, u,
          (0.1 + 0.28 * Math.pow(rng.unit(), 1.6)) * (0.3 + 1.0 * wx),
          0.1 + 0.3 * wx + rng.range(0, 0.1), spin, 0.55);
      }
    }

    /* The rings: whole hoops riding down the wall, a little tilted, brightest
       on one side. */
    weighted(rings, RING_W).forEach((n, i) => {
      const w = RING_W[i];
      const u0 = RING_U[i];
      const rot = RING_ROT[i % 4];
      const thick = 0.35 + 1.4 * w;
      const tilt = (0.05 + 0.12 * hash01(i * 19 + 3)) * RAD;
      const phT = TAU * hash01(i * 29 + 5), phB = TAU * hash01(i * 31 + 6);
      const bright = 0.6 + 0.4 * hash01(i * 41 + 8);
      const start = TAU * hash01(i * 47 + 9);
      const g = progressiveGrid(c.ahead(n));
      for (let j = 0; j < n; j++) {
        const a = start + ((g[j] + 0.5) / n) * TAU;
        const side = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(2 * a + phB));
        const u = u0 + tilt * Math.sin(a + phT) + rng.bell() * thick;
        const f = 0.975 + rng.bell() * (0.006 + 0.018 * w);
        put(f, a, u,
          rng.range(0.4, 0.78) * (0.6 + 0.4 * w) * side * bright,
          0.35 + 0.3 * hash01(i * 53 + 2) + 0.2 * side + rng.range(0, 0.06),
          tunnelSpin(RING_FLOW, rot), 0.95);
      }
    });

    /* The helices: three wide soft strands, one turn each, the same sense. */
    even(helices, 3).forEach((n, k) => {
      const a0 = TAU * ((k * GOLD) % 1);
      const spin = tunnelSpin(HELIX_FLOW + 0.04 * k, 5);
      const pb = TAU * hash01(k * 79 + 7);
      const g = progressiveGrid(c.ahead(n));
      for (let i = 0; i < n; i++) {
        const u = Z_MIN + Z_LEN * ((g[i] + 0.5) / n);
        const ph = PH(u);
        const a = a0 + ph + 0.1 * Math.sin(2 * ph + pb);
        const bead = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(5 * ph + pb));
        put(0.9 + (rng.bell() * 0.7) / RAD, a + (rng.bell() * 0.7) / (0.9 * RAD), u + rng.bell() * 0.7,
          rng.range(0.5, 0.9) * (0.5 + 0.5 * bead), rng.range(0.55, 0.9), spin, 0.95);
      }
    });

    /* The lanes: dashes of light streaming down the wall, parallel to the
       helices, a bright head toward the camera and a fading tail. */
    {
      const LANES = 140;
      const list = Array.from({ length: LANES }, (_, k) => ({
        a: ((k + 0.5 + (hash01(k * 83 + 1) - 0.5) * 0.7) / LANES) * TAU,
        u0: Z_MIN + Z_LEN * ((k * GOLD + 0.37 * hash01(k * 131 + 7)) % 1),
        len: 12 + 40 * Math.pow(hash01(k * 89 + 2), 1.6),
        flow: 0.8 + 0.4 * hash01(k * 113 + 4),
        bright: 0.5 + 0.5 * hash01(k * 97 + 3),
        f: 0.945 + 0.04 * hash01(k * 127 + 5),
      }));
      weighted(lanes, list.map((l) => l.len)).forEach((m, k) => {
        const L = list[k];
        const spin = tunnelSpin(L.flow, 5);
        const g = progressiveGrid(c.ahead(m));
        for (let j = 0; j < m; j++) {
          // t runs tail (0) to head (1); the head is at the near end, +u.
          const t = (g[j] + 0.5) / m;
          const u = wrapU(L.u0 + L.len * t);
          const head = Math.min(1, (1 - t) * 10);
          put(L.f + rng.bell() * 0.004, L.a + PH(u) + rng.bell() * 0.004, u,
            rng.range(0.3, 0.55) * L.bright * (0.3 + 0.7 * Math.pow(t, 0.8)) * head,
            0.5 + 0.35 * t + rng.range(0, 0.08), spin, 0.95);
        }
      });
    }

    /* The waves: fine partial hoops born at the throat and riding toward the
       camera on the flow, sparse, tilted, thickening and fading as they come. */
    {
      const WAVES = 24;
      even(waves, WAVES).forEach((m, k) => {
        // Depth from the throat toward the camera, spread evenly over the
        // near half so the arcs stagger out visibly (d^1.6 piled them on the
        // throat's rim as one thick ring).
        const d = 0.04 + 0.9 * ((k + 0.5) / WAVES);
        const u0 = THROAT_U + d * (Z_MIN + Z_LEN - THROAT_U) * 0.92;
        const span = TAU * (0.28 + 0.3 * hash01(k * 61 + 1));
        const a0 = TAU * ((k * GOLD) % 1);
        const tilt = (0.04 + 0.1 * hash01(k * 67 + 2)) * RAD;
        const phT = TAU * hash01(k * 71 + 3);
        const rot = k % 2 ? 6 : 4;
        const spin = tunnelSpin(RING_FLOW + 0.15 + 0.2 * hash01(k * 73 + 4), rot);
        const thick = 0.2 + 0.5 * d;
        const g = progressiveGrid(c.ahead(m));
        for (let j = 0; j < m; j++) {
          const t = (g[j] + 0.5) / m;
          const a = a0 + span * t;
          const end = Math.min(1, Math.min(t, 1 - t) * 6);
          put(0.975 + rng.bell() * 0.012, a, u0 + tilt * Math.sin(a + phT) + rng.bell() * thick,
            rng.range(0.24, 0.44) * (0.5 + 0.5 * end) * (1 - 0.25 * d), rng.range(0.5, 0.85), spin, 0.92);
        }
      });
    }

    /* The streaks: short fast dashes just outside the wall, heads forward
       (the flow runs toward the camera, +z). */
    {
      const DASHES = 60;
      even(streaks, DASHES).forEach((m, d) => {
        const u0 = Z_MIN + Z_LEN * hash01(d * 89 + 1);
        const a = TAU * hash01(d * 97 + 2);
        const len = 6 + 12 * hash01(d * 101 + 3);
        const f = 1.03 + 0.12 * hash01(d * 103 + 4);
        const spin = tunnelSpin(1.45 + 0.55 * hash01(d * 107 + 5), 5);
        const bright = 0.3 + 0.4 * hash01(d * 109 + 6);
        const g = progressiveGrid(c.ahead(m));
        for (let j = 0; j < m; j++) {
          const t = (g[j] + 0.5) / m;
          put(f + rng.bell() * 0.006, a + rng.bell() * 0.004, wrapU(u0 + len * t),
            bright * (0.35 + 0.65 * Math.pow(t, 0.8)), rng.range(0.3, 0.8), spin, 0.9);
        }
      });
    }

    /* The sky: still dust outside the wall, the frame the flow is read against. */
    {
      const spin = tunnelSpin(TUNNEL_STILL, 5);
      const { p } = jittered(c.ahead(sky), 3, 0.7, 401);
      for (let j = 0; j < sky; j++) {
        const u = Z_MIN + Z_LEN * p[j * 3];
        const f = 1.45 + 1.3 * Math.pow(p[j * 3 + 1], 1.4);
        put(f, TAU * p[j * 3 + 2], u, 0.12 + 0.3 * Math.pow(rng.unit(), 2.4), rng.range(0, 0.15), spin, 0.3);
      }
    }

    /* The haze: slow loose dust inside the tunnel. */
    {
      const spin = tunnelSpin(HAZE_FLOW, 5);
      const { p } = jittered(c.ahead(haze), 3, 0.7, 503);
      for (let j = 0; j < haze; j++) {
        const u = Z_MIN + Z_LEN * p[j * 3];
        const f = 0.15 + 0.55 * Math.pow(p[j * 3 + 1], 0.55);
        put(f, TAU * p[j * 3 + 2], u, rng.range(0.12, 0.3), rng.range(0, 0.35), spin, 0);
      }
    }

  },
};
