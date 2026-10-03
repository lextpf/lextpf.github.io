// The motion added in the fourth cut (2026-09-30), spliced into the vertex
// shader ahead of shape(). Both are the white hole's arms run inward
// (lib/modes.js WHIRL, GALAXY_WHIRL): jittered bands along logarithmic
// spirals, the scatter across the arm only, the material streaming along each
// arm toward the centre, the arms turning as one pattern.
import { WHIRL, GALAXY_ARMS, GALAXY_WHIRL, ACCRETION } from '../lib/modes.js';

const f = (n) => {
  const s = String(+Number(n).toFixed(6));
  return s.includes('.') || s.includes('e') ? s : `${s}.0`;
};
const W = WHIRL;
const G = GALAXY_WHIRL;

export const EFFECTS_GLSL = /* glsl */ `
const float WH_RIN = ${f(W.rIn)};
const float WH_ROUT = ${f(W.rOut)};
const float WH_PITCH = ${f(W.pitch)};
const float WH_PERIOD = ${f(W.period)};
const float WH_PATTERN = ${f(W.pattern)};
const float WH_PHASE = ${f(W.phase)};
const float WH_FALL = ${f(W.fall)};
const float WH_LNR = ${f(Math.log(W.rIn / W.rOut))};
const float WH_ARMS = ${f(W.arms)};

// Where the flow has carried a particle along its arm: 0 at the rim, 1 in.
float whirlS(vec3 p, float clock, float period) { return fract(p.x + clock / period); }

// Black hole arm k (spin 1000 + k), in the disc's own frame: along one
// logarithmic spiral, offset across it by the band's width, lifted by the
// disc's warp (lib/modes.js ACCRETION warpNode*) so the arms lie on the skirt.
vec3 whirlShape(vec3 p, float spin, float clock) {
  float k = floor(spin - 1000.0 + 0.5);
  float s = whirlS(p, clock, WH_PERIOD);
  float r = WH_ROUT * exp(WH_LNR * s);
  float a = WH_PHASE + k / WH_ARMS * 6.2831853 + 0.12 * sin(k * 2.3)
          + WH_PITCH * log(r / WH_RIN) + WH_PATTERN * clock;
  vec2 radial = vec2(cos(a), sin(a));
  vec2 tangent = normalize(radial + WH_PITCH * vec2(-radial.y, radial.x));
  vec2 normal = vec2(-tangent.y, tangent.x);
  vec2 xy = r * radial + normal * p.y * (0.12 + r * 0.018) * 1.05;
  float node = ${f(ACCRETION.warpNode0)} + ${f(ACCRETION.warpNode1)} * log(r);
  float lift = (xy.y * cos(node) - xy.x * sin(node)) / r;
  float warp = 0.09 * pow(max(0.0, r - ${f(ACCRETION.warpFrom)}), 1.4) * lift;
  return vec3(xy, p.z * (0.1 + r * 0.025) + warp);
}

// The light: rising out of the skirt at the rim, pooling toward the hole,
// dissolving into the torus at the inside.
float whirlVis(vec3 p, float spin, float clock) {
  float s = whirlS(p, clock, WH_PERIOD);
  float r = WH_ROUT * exp(WH_LNR * s);
  return smoothstep(0.0, 0.14, s) * (1.0 - smoothstep(0.82, 1.0, s)) * pow(WH_RIN / r, WH_FALL);
}

// Bluer toward the rim, as the white hole's arms are.
float whirlTint(vec3 p, float spin, int mode, float clock) {
  return min(1.0, 0.52 + 0.44 * (1.0 - whirlS(p, clock, WH_PERIOD)));
}

const float GA_PITCH = ${f(GALAXY_ARMS.pitch)};
const float GA_R0 = ${f(GALAXY_ARMS.r0)};
const float GA_A0 = ${f(GALAXY_ARMS.a0)};
const float GA_PATTERN = ${f(GALAXY_ARMS.pattern)};
const float GW_RIN = ${f(G.rIn)};
const float GW_ROUT = ${f(G.rOut)};
const float GW_PERIOD = ${f(G.period)};
const float GW_POOL = ${f(G.pool)};
const float GW_FALL = ${f(G.fall)};
const float GW_LNR = ${f(Math.log(G.rIn / G.rOut))};
const float GA_SIN_PSI = ${f(1 / Math.hypot(1, GALAXY_ARMS.pitch))};

// formations/galaxy.js armAngle, SIG and warpAt, the same numbers.
float galaxyArm(float r, float k) {
  return GA_A0 + k * PI + GA_PITCH * log(r / GA_R0)
    + 0.07 * sin(1.35 * r + 1.1 + 2.3 * k) + 0.045 * sin(2.9 * r + 0.3 + 1.1 * k);
}
float galaxySig(float r) { return 0.62 + 0.05 * r; }
float galaxyWarp(float x, float z) {
  float r = length(vec2(x, z));
  if (r < 12.0) return 0.0;
  float a = atan(z, x);
  float w = pow((r - 12.0) / 14.0, 2.0);
  return w * (2.4 * sin(a - 0.9) + sin(a * 2.3 + r * 0.22) + 0.55 * sin(a * 4.7 - r * 0.13));
}

// Arm k's inflow (spin 1000 + k, mode 1): on the arm's convex side, where its
// stars sit (galaxy.js arms: d = s (0.75 g - 0.25)), clear of the lane, in the
// disc's frame about the pivot, lifted by the warp, turned with the pattern.
vec3 galaxyWhirlShape(vec3 p, float spin, float clock) {
  float k = floor(spin - 1000.0 + 0.5);
  float s = whirlS(p, clock, GW_PERIOD);
  float r = GW_ROUT * exp(GW_LNR * s);
  float d = galaxySig(r) * (-0.25 + 0.42 * p.y) * smoothstep(0.3, 2.4, r);
  float a = galaxyArm(max(r, 0.35), k) + d / (max(r, 0.35) * GA_SIN_PSI);
  float x = r * cos(a);
  float z = r * sin(a);
  vec3 q = vec3(x, p.z * (0.05 + 0.008 * r) + galaxyWarp(x, z), z);
  float pa = GA_PATTERN * clock;
  float sn = sin(pa);
  float cs = cos(pa);
  return vec3(cs * q.x + sn * q.z, q.y, -sn * q.x + cs * q.z);
}

float galaxyWhirlVis(vec3 p, float spin, float clock) {
  float s = whirlS(p, clock, GW_PERIOD);
  float r = GW_ROUT * exp(GW_LNR * s);
  return smoothstep(0.0, 0.12, s) * (1.0 - smoothstep(0.86, 1.0, s)) * pow(GW_POOL / max(r, GW_POOL), GW_FALL);
}

// Blue-white along the arm, bluer outward as the arm's stars are; gold once it
// reaches the bulge, each particle turning at its own radius so the change
// has no edge.
float galaxyWhirlTint(vec3 p, float clock) {
  float s = whirlS(p, clock, GW_PERIOD);
  float r = GW_ROUT * exp(GW_LNR * s);
  float h = fract(p.y * 43.758 + p.z * 17.13 + p.x * 5.31);
  return r < 1.6 + 1.6 * h ? 2.6 + 0.1 * h : 0.34 + 0.3 * (1.0 - s) + 0.08 * h;
}
`;
