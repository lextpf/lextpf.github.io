import { ORBIT_PLANETS, NUCLEUS_SHELLS } from '../lib/modes.js';

const glslFloat = (n) => {
  const s = String(n);
  return s.includes('.') || s.includes('e') ? s : `${s}.0`;
};
const ORBIT_TABLE = ORBIT_PLANETS.map((p, i) => {
  const cx = glslFloat(+(p.R * Math.cos(p.phase)).toFixed(5));
  const cz = glslFloat(+(p.R * Math.sin(p.phase)).toFixed(5));
  return `${i ? 'else ' : ''}if (k < ${i}.5) { C = vec2(${cx}, ${cz}); W = ${glslFloat(p.rate)}; }`;
}).join('\n    ');

const ORBIT_DENTS = ORBIT_PLANETS.map((p) => {
  const cx = glslFloat(+(p.R * Math.cos(p.phase)).toFixed(5));
  const cz = glslFloat(+(p.R * Math.sin(p.phase)).toFixed(5));
  const g2 = glslFloat(+(p.width * p.width).toFixed(5));
  return `{ float ca = cos(${glslFloat(p.rate)} * clock); float sa = sin(${glslFloat(p.rate)} * clock);
      vec2 dd = p.xz - vec2(ca * ${cx} + sa * ${cz}, -sa * ${cx} + ca * ${cz});
      dy -= ${glslFloat(p.depth)} / (1.0 + dot(dd, dd) / ${g2}); }`;
}).join('\n    ');

const NUCLEUS_AXES = NUCLEUS_SHELLS.map((sh, i) => {
  const [x, y, z] = sh.axis;
  return `${i ? 'else ' : ''}if (k < ${i}.5) { ax = vec3(${glslFloat(x)}, ${glslFloat(y)}, ${glslFloat(z)}); }`;
}).join('\n      ');

const ORBIT_SHADOW = ORBIT_PLANETS.map((p, i) => {
  const cx = glslFloat(+(p.R * Math.cos(p.phase)).toFixed(5));
  const cz = glslFloat(+(p.R * Math.sin(p.phase)).toFixed(5));
  const ti = glslFloat(+Math.cos(Math.atan((p.body * 0.8) / p.R)).toFixed(5));
  const to = glslFloat(+Math.cos(Math.atan((p.body * 1.6) / p.R)).toFixed(5));
  return `${i ? 'else ' : ''}if (k < ${i}.5) { C = vec2(${cx}, ${cz}); W = ${glslFloat(p.rate)}; TI = ${ti}; TO = ${to}; }`;
}).join('\n    ');

const ORBIT_WAKE = ORBIT_PLANETS.map((p) => {
  const cx = glslFloat(+(p.R * Math.cos(p.phase)).toFixed(5));
  const cz = glslFloat(+(p.R * Math.sin(p.phase)).toFixed(5));
  const g2 = glslFloat(+(p.width * p.width * 1.69).toFixed(5));
  return `{ float ca = cos(${glslFloat(p.rate)} * clock); float sa = sin(${glslFloat(p.rate)} * clock);
      vec2 pp = vec2(ca * ${cx} + sa * ${cz}, -sa * ${cx} + ca * ${cz});
      vec2 dd = p.xz - pp;
      float prox = exp(-dot(dd, dd) / ${g2});
      wake += prox * dot(normalize(dd + vec2(1e-4, 0.0)), -normalize(vec2(pp.y, -pp.x))); }`;
}).join('\n    ');

export const particleVertex = /* glsl */ `
attribute vec3 aPosB;
attribute vec4 aAttrA;
attribute vec4 aAttrB;
attribute float aRoleA;
attribute float aRoleB;
attribute float aSeed;

uniform float uMorph;
uniform float uStaggerSpan;
uniform float uArc;
uniform float uTime;
uniform float uClockA;
uniform float uClockB;
uniform float uSize;
uniform float uPixelRatio;
uniform float uNoise;
uniform float uNoiseScale;
uniform float uNoiseSpeed;
uniform float uFogNear;
uniform float uFogFar;
uniform float uFocus;
uniform float uFocusRange;
uniform float uDof;
uniform float uWarmRadius;
uniform float uPulse;
uniform float uPulseClock;
uniform float uPulseWidth;
uniform vec3 uPivotA;
uniform vec3 uPivotB;
uniform vec2 uTunnel;
uniform int uModeA;
uniform int uModeB;
uniform mat3 uTiltA;
uniform mat3 uTiltB;
uniform float uStreak;
uniform float uMorphVel;
uniform float uVortex;
uniform float uPinch;
uniform vec2 uViewport;
uniform vec3 uTouchA;
uniform vec3 uTouchB;
uniform vec3 uPointerOrigin;
uniform vec3 uPointerDir;
uniform vec3 uPointerMove;
uniform float uPointerGain;

varying float vTint;
varying float vAlpha;
varying float vLum;
varying float vWarm;
varying float vCoc;
varying float vDepth;
varying float vSeed;
varying float vStretch;
varying vec2 vDir;
varying float vRole;

const float PI = 3.141592653589793;

float dopplerFor(vec3 q, float spin, int mode) {
  if (mode != 1 || spin < 1e-3 || spin >= 90.0) return 0.0;
  vec3 vel = normalize(vec3(q.z, 0.0, -q.x) + vec3(1e-4));
  float vz = (modelViewMatrix * vec4(vel, 0.0)).z;
  return clamp(vz, -1.0, 1.0) * min(1.0, spin * 4.0);
}

float jetBase(vec3 lp, vec3 pivot, float spin, int mode) {
  if (spin < 0.0) return 0.0;
  if (mode == 5) {
    float az = abs(lp.z);
    return smoothstep(3.0, 4.5, az) * (1.0 - smoothstep(4.5, 13.0, az));
  }
  if (mode == 7) {
    float az = abs(lp.z - pivot.z);
    return smoothstep(3.0, 4.5, az) * (1.0 - smoothstep(4.5, 13.0, az));
  }
  return 0.0;
}

float sheetWake(vec3 p, float clock) {
  float wake = 0.0;
    ${ORBIT_WAKE}
  return wake;
}

float satelliteShadow(vec3 p0, float spin, float clock) {
  if (spin < 100.0) return 0.0;
  float enc = spin - 100.0;
  float k = floor(enc * 0.1);
  float w2 = enc - k * 10.0;
  vec2 C = vec2(0.0);
  float W = 0.0;
  float TI = 1.0;
  float TO = 1.0;
    ${ORBIT_SHADOW}
  float a2 = w2 * clock;
  float s2 = sin(a2);
  float c2 = cos(a2);
  vec2 d = vec2(p0.x - C.x, p0.z - C.y);
  vec2 e2 = vec2(c2 * d.x + s2 * d.y, -s2 * d.x + c2 * d.y);
  vec2 q2 = C + e2;
  float a1 = W * clock;
  float s1 = sin(a1);
  float c1 = cos(a1);
  vec2 sp = vec2(c1 * q2.x + s1 * q2.y, -s1 * q2.x + c1 * q2.y);
  vec2 Cp = vec2(c1 * C.x + s1 * C.y, -s1 * C.x + c1 * C.y);
  float behind = step(length(Cp) + 0.2, length(sp));
  float cosA = dot(normalize(Cp), normalize(sp));
  return behind * smoothstep(TO, TI, cosA);
}

float perihelionSpark(vec3 sp, float spin, int mode, vec3 pivot) {
  if (mode != 1 || spin < 200.0) return 0.0;
  float pvz = (modelViewMatrix * vec4(pivot, 1.0)).z;
  float svz = (modelViewMatrix * vec4(sp, 1.0)).z;
  float len = max(length(sp - pivot), 1e-3);
  float toward = clamp((svz - pvz) / len, 0.0, 1.0);
  return pow(toward, 6.0);
}

float holeDim(vec3 lp, vec3 pivot, int mode) {
  if (mode == 5) return 0.22 + 0.78 * smoothstep(4.0, 13.0, length(lp));
  if (mode == 7) return 0.22 + 0.78 * smoothstep(4.0, 13.0, length(lp - pivot));
  return 1.0;
}

vec3 curvedTransport(vec3 origin, float distance, float id, float amplitude) {
  vec3 direction = normalize(origin + vec3(0.0001, -0.0002, 0.0003));
  vec3 guide = normalize(vec3(
    sin(id * 12.9898 + 1.7),
    cos(id * 78.233 - 0.4),
    sin(id * 39.425 + 2.3)
  ));
  vec3 side = normalize(cross(direction, guide) + vec3(0.0003, -0.0002, 0.0001));
  vec3 lift = normalize(cross(direction, side));
  float phase = id * PI * 2.0;
  float turnA = sin(distance * (0.11 + 0.025 * fract(id * 7.31)) + phase);
  float turnB = cos(distance * (0.085 + 0.02 * fract(id * 11.7)) - phase * 0.73);
  return direction * distance + amplitude * (side * turnA + lift * turnB * 0.72);
}

vec3 plumeMotion(vec3 p, float spin, float clock) {
  float radial = length(p.xy);
  float axial = abs(p.z);
  float plume = smoothstep(3.5, 8.0, axial);
  float front = sin(clock * 1.15 - radial * 0.31 - axial * 0.24 + spin * 19.0);
  p.xy *= 1.0 + front * mix(0.07, 0.025, plume);
  p.z += sign(p.z) * front * mix(0.12, 1.05, plume);
  float angle = spin * clock * 2.2 + front * 0.018;
  float s = sin(angle);
  float c = cos(angle);
  return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
}

vec3 shape(vec3 p, float spin, int mode, mat3 tilt, float clock, vec3 pivot) {
  if (mode == 2) {
    float z = p.z + (0.55 + spin) * clock * 7.0;
    p.z = mod(z - uTunnel.x, uTunnel.y) + uTunnel.x;
    return p;
  }
  if (mode == 5) {
    const float JET_THRESHOLD = 4.0;
    const float FALL_IN = 6.6;
    const float FALL_SPAN = 32.0;
    const float FALL_SPEED = 4.4;
    if (spin < 0.0) {
      float baseRadius = length(p);
      float distance = mod(baseRadius - FALL_IN - clock * FALL_SPEED, FALL_SPAN) + FALL_IN;
      float progress = (distance - FALL_IN) / FALL_SPAN;
      float id = abs(spin);
      float amplitude = smoothstep(0.0, 0.18, progress)
        * distance * (0.035 + 0.07 * fract(id * 9.17));
      p = curvedTransport(p, distance, id, amplitude);
      return tilt * p;
    }

    float az = abs(p.z);
    if (az > JET_THRESHOLD) {
      return tilt * plumeMotion(p, spin, clock);
    }
    float w = abs(spin) * clock;
    float sw = sin(w);
    float cw = cos(w);
    p = vec3(cw * p.x - sw * p.y, sw * p.x + cw * p.y, p.z);
    return tilt * p;
  }
  if (mode == 7) {
    vec3 q = p - pivot;
    if (spin < 0.0) {
      const float EJECT_START = 1.2;
      const float EJECT_SPAN = 49.0;
      const float EJECT_SPEED = 7.2;
      float radius = length(q);
      float distance = mod(radius - EJECT_START + clock * EJECT_SPEED, EJECT_SPAN) + EJECT_START;
      float progress = (distance - EJECT_START) / EJECT_SPAN;
      float id = abs(spin);
      float amplitude = smoothstep(0.0, 0.15, progress)
        * distance * (0.04 + 0.075 * fract(id * 8.37));
      q = curvedTransport(q, distance, id, amplitude);
      return tilt * (q + pivot);
    }
    q = plumeMotion(q, spin, clock);
    return tilt * (q + pivot);
  }
  if (mode == 8) {
    if (spin < -0.5) {
      float dy = 0.0;
      ${ORBIT_DENTS}
      float rippleR = length(p.xz);
      float lake = smoothstep(5.5, 11.0, rippleR);
      dy += (sin(dot(p.xz, vec2(0.14, 0.10)) + clock * 0.55)
           + 0.6 * sin(dot(p.xz, vec2(-0.08, 0.13)) + clock * 0.38 + 2.3))
          * 0.17 * lake;
      return vec3(p.x, p.y + dy, p.z);
    }
    if (abs(spin) < 1e-4) return p;
    if (spin < 90.0) {
      float a = spin * clock;
      float s = sin(a);
      float c = cos(a);
      return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
    }
    float enc = spin - 100.0;
    float k = floor(enc * 0.1);
    float w2 = enc - k * 10.0;
    vec2 C = vec2(0.0);
    float W = 0.0;
    ${ORBIT_TABLE}
    float a2 = w2 * clock;
    float s2 = sin(a2);
    float c2 = cos(a2);
    vec2 d = vec2(p.x - C.x, p.z - C.y);
    vec2 e = vec2(c2 * d.x + s2 * d.y, -s2 * d.x + c2 * d.y);
    vec2 q2 = C + e;
    float a1 = W * clock;
    float s1 = sin(a1);
    float c1 = cos(a1);
    return vec3(c1 * q2.x + s1 * q2.y, p.y, -s1 * q2.x + c1 * q2.y);
  }
  vec3 q = p - pivot;
  if (mode == 4) {
    float ay = spin * sin(clock * 0.42);
    float ax = spin * 0.34 * sin(clock * 0.27 + 1.1);
    float sy = sin(ay), cy = cos(ay);
    q = vec3(cy * q.x + sy * q.z, q.y, -sy * q.x + cy * q.z);
    float sx = sin(ax), cx = cos(ax);
    q = vec3(q.x, cx * q.y - sx * q.z, sx * q.y + cx * q.z);
    return tilt * (q + pivot);
  }
  float a = spin * clock;
  float s = sin(a);
  float c = cos(a);
  if (mode == 1) {
    if (spin >= 200.0) {
      float enc = spin - 200.0;
      float k = floor(enc * 0.1);
      float w = enc - k * 10.0 - 5.0;
      vec3 ax = vec3(0.0, 1.0, 0.0);
      ${NUCLEUS_AXES}
      float aa = w * clock;
      float ss = sin(aa);
      float cc = cos(aa);
      q = q * cc + cross(ax, q) * ss + ax * dot(ax, q) * (1.0 - cc);
      return tilt * (q + pivot);
    }
    q = vec3(c * q.x + s * q.z, q.y, -s * q.x + c * q.z);
  } else if (mode == 3) {
    q = vec3(c * q.x - s * q.y, s * q.x + c * q.y, q.z);
  } else if (mode == 6) {
    q = vec3(q.x, c * q.y - s * q.z, s * q.y + c * q.z);
  }
  return tilt * (q + pivot);
}

float transportVisibility(vec3 p, float spin, int mode, float clock) {
  if (mode == 7 && spin < 0.0) {
    const float EJECT_START = 1.2;
    const float EJECT_SPAN = 49.0;
    const float EJECT_SPEED = 7.2;
    float distance = mod(length(p) - EJECT_START + clock * EJECT_SPEED, EJECT_SPAN) + EJECT_START;
    float emerge = smoothstep(EJECT_START + 0.45, EJECT_START + 2.3, distance);
    float leave = 1.0 - smoothstep(EJECT_START + EJECT_SPAN - 7.0, EJECT_START + EJECT_SPAN, distance);
    return emerge * leave;
  }
  if (mode != 5) return 1.0;
  const float FALL_IN = 6.6;
  const float FALL_SPAN = 32.0;
  const float FALL_SPEED = 4.4;
  if (spin < 0.0) {
    float radius = mod(length(p) - FALL_IN - clock * FALL_SPEED, FALL_SPAN) + FALL_IN;
    float horizon = smoothstep(FALL_IN, FALL_IN + 1.3, radius);
    float feeder = 1.0 - smoothstep(FALL_IN + FALL_SPAN - 5.5, FALL_IN + FALL_SPAN, radius);
    return horizon * feeder;
  }
  return 1.0;
}

vec3 flow(vec3 q) {
  vec3 f = vec3(sin(q.y) * cos(q.z), sin(q.z) * cos(q.x), sin(q.x) * cos(q.y));
  vec3 q2 = q * 2.31 + 1.7;
  f += 0.42 * vec3(sin(q2.y) * cos(q2.z), sin(q2.z) * cos(q2.x), sin(q2.x) * cos(q2.y));
  return f;
}

vec3 touchDisp(vec3 p, vec3 t, float dust, float seed, vec3 pivot, float spin, mat3 tilt, out float glow) {
  vec3 rel = p - uPointerOrigin;
  vec3 q = uPointerOrigin + uPointerDir * dot(rel, uPointerDir);
  vec3 d = p - q;
  float dist = length(d) + 1e-4;
  float g = exp(-dist * dist / (t.x * t.x)) * t.y * uPointerGain;
  glow = clamp(g, 0.0, 1.5);
  if (g < 1e-4) return vec3(0.0);
  vec3 dir = d / dist;
  float give = 0.2 + 0.8 * dust;
  float m = t.z;
  if (m < 0.5) {
    return (uPointerDir * 0.6 + dir * 0.2) * g * give * sin(uTime * 2.6 + dist * 1.1);
  }
  if (m < 1.5) {
    vec3 N = tilt * vec3(0.0, 1.0, 0.0);
    vec3 orb = normalize(cross(N, p - pivot) + vec3(1e-4));
    return orb * g * give * (0.85 + 0.3 * sin(uTime * 1.7 + seed * 9.0));
  }
  if (m < 2.5) {
    vec3 N = tilt * vec3(0.0, 0.0, 1.0);
    vec3 orb = normalize(cross(N, p - pivot) + vec3(1e-4));
    float kep = min(g / (0.3 + dist * 0.24), 1.6);
    return orb * kep * give + N * g * 0.05 * sin(uTime * 2.1 + dist);
  }
  if (m < 3.5) return spin < -0.5 ? vec3(0.0, -g, 0.0) : vec3(0.0);
  if (m < 4.5) {
    return uPointerMove * g * 0.045 * sin(uTime * 5.5 + seed * 31.0)
         + dir * g * 0.05 * sin(uTime * 3.1 + dist * 1.4);
  }
  if (m < 5.5) {
    float calm = 1.0 / (1.0 + dot(uPointerMove, uPointerMove) * 0.06);
    float wave = sin(dist * 1.4 - uTime * 3.4);
    return dir * wave * g * (0.12 + 0.34 * dust) * calm;
  }
  if (m < 6.5) {
    vec3 jig = vec3(
      sin(uTime * 21.0 + seed * 61.7),
      cos(uTime * 24.0 + seed * 47.3),
      sin(uTime * 18.5 + seed * 83.1));
    return (jig * 0.8 + dir * 0.12) * g * give;
  }
  if (m < 7.5) {
    float wave = sin(uTime * 5.2 - p.z * 0.5 + seed * 4.0);
    return vec3(0.0, 0.0, -1.0) * g * wave * 0.8 - dir * g * 0.08 * wave;
  }
  if (m < 8.5) {
    vec3 chaos = normalize(vec3(
      fract(seed * 127.1) - 0.5,
      fract(seed * 311.7) - 0.5,
      fract(seed * 74.7) - 0.5) + vec3(1e-4));
    return chaos * g * (0.3 + 0.7 * dust) * (0.7 + 0.3 * sin(uTime * 9.0 + seed * 40.0));
  }
  if (m < 9.5) return dir * g * give * (0.55 + 0.45 * sin(dist * 1.3 - uTime * 5.5));
  if (m < 10.5) {
    glow *= 1.4 * (0.55 + 0.45 * (1.0 - dust));
    return vec3(0.0);
  }
  if (m < 11.5) {
    vec3 fan = normalize(p - pivot + vec3(1e-4));
    float pulse2 = 0.35 + 0.65 * max(0.0, sin(uTime * 3.4 - length(p - pivot) * 0.55));
    return fan * g * (0.35 + 0.65 * dust) * pulse2;
  }
  vec3 jig = vec3(
    sin(uTime * 31.0 + seed * 151.7),
    cos(uTime * 27.0 + seed * 113.3),
    sin(uTime * 23.0 + seed * 71.9) * 0.3);
  return jig * g * smoothstep(0.25, 0.6, 1.0 - dust);
}

void main() {
  float stagger = mix(aAttrA.z, aAttrB.z, 0.5);
  float anchor = smoothstep(0.45, 1.15, mix(aAttrA.x, aAttrB.x, 0.5));
  stagger *= 1.0 - 0.55 * anchor;
  float m = clamp((uMorph - stagger * uStaggerSpan) / max(1e-3, 1.0 - uStaggerSpan), 0.0, 1.0);
  float e = m * m * (3.0 - 2.0 * m);
  float size = mix(aAttrA.x, aAttrB.x, e);
  if (size < 1e-4) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  float role = clamp(mix(aRoleA, aRoleB, e), 0.0, 1.0);

  vec3 pa = shape(position, aAttrA.w, uModeA, uTiltA, uClockA, uPivotA);
  vec3 pb = shape(aPosB, aAttrB.w, uModeB, uTiltB, uClockB, uPivotB);
  float flight = sin(PI * e);
  size *= 1.0 + flight * 0.28;

  float seedAngle = aSeed * PI * 2.0 + stagger * 5.7;
  vec2 fallback = vec2(cos(seedAngle), sin(seedAngle));
  float lane = fract(aSeed * 7.31 + stagger * 3.17);
  float polar = mix(-1.0, 1.0, fract(aSeed * 17.17 + stagger * 9.11));
  float planar = sqrt(max(0.0, 1.0 - polar * polar));
  vec3 scatter = vec3(fallback * planar, polar);
  vec3 delta = pb - pa;
  vec3 travelAxis = normalize(delta + vec3(fallback * 0.001, 0.001));
  vec3 curveSide = normalize(cross(travelAxis, scatter) + vec3(fallback * 0.001, 0.001));
  vec3 curveLift = normalize(cross(travelAxis, curveSide) + scatter * 0.001);
  float edgeRoute = smoothstep(16.0, 23.0, uArc);
  float localReach = 1.35 + uArc * 0.16;
  float edgeReach = 8.0 + uArc * 0.55;
  float reach = mix(localReach, edgeReach, edgeRoute) * (0.18 + lane * lane * 0.92);
  float handedness = mix(-1.0, 1.0, step(0.5, fract(aSeed * 13.7)));
  float curve = sin(PI * e);
  float corkscrew = sin(PI * 2.0 * e + seedAngle) * curve;
  vec3 direct = mix(pa, pb, e);
  vec3 p = direct
    + curveSide * curve * reach * handedness
    + curveLift * corkscrew * reach * 0.28;

  float flightArc = sin(PI * e);
  float genesisDim = 1.0;
  if (uVortex > 1e-3) {
    float birth = smoothstep(0.5, 1.0, e);
    vec3 sky = normalize(vec3(fallback, polar * 1.4) + scatter * 0.7);
    vec3 S = mix(uPivotA, uPivotB, e) + sky * (46.0 + lane * 30.0);
    vec3 flight2 = mix(S, pb, birth * birth * (3.0 - 2.0 * birth));
    p = mix(p, mix(pa, flight2, smoothstep(0.44, 0.56, e)), uVortex);
    genesisDim = 1.0 - (smoothstep(0.30, 0.44, uMorph) - smoothstep(0.56, 0.72, uMorph)) * uVortex;
  }
  if (uPinch > 1e-3) {
    vec3 core = mix(uPivotA, uPivotB, e);
    float squeeze = pow(max(flightArc, 0.0), 1.7) * uPinch * 0.92;
    p = mix(p, core, squeeze);
  }

  float dust = 1.0 - role;
  float noiseRole = 0.03 + 0.97 * dust * dust;
  vec3 q = p * uNoiseScale + uTime * uNoiseSpeed + aSeed * 7.31;
  p += flow(q) * uNoise * (0.5 + 0.8 * aSeed) * noiseRole * (1.0 + 1.15 * flight);

  float touchGlow = 0.0;
  if (uPointerGain > 1e-3) {
    float glowA = 0.0;
    float glowB = 0.0;
    vec3 disp = mix(
      touchDisp(p, uTouchA, dust, aSeed, uPivotA, aAttrA.w, uTiltA, glowA),
      touchDisp(p, uTouchB, dust, aSeed, uPivotB, aAttrB.w, uTiltB, glowB),
      e);
    p += disp;
    touchGlow = min(1.0, length(disp) * 0.9 + mix(glowA, glowB, e) * 0.4);
  }

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float dist = -mv.z;
  gl_Position = projectionMatrix * mv;

  float coc = clamp(abs(dist - uFocus) / max(uFocusRange, 1.0), 0.0, 1.0);
  coc = coc * coc * (3.0 - 2.0 * coc);
  float grow = 1.0 + coc * uDof * 2.4 * (0.55 + 0.45 * role);
  float attenuation = mix(205.0, 245.0, 1.0 - dust);
  float px = size * uSize * uPixelRatio * grow * (attenuation / max(dist, 0.75));
  px = min(px, mix(52.0, 8.0, dust) * uPixelRatio);
  float floorPx = 1.05 * uPixelRatio;
  float subpixel = clamp(px / floorPx, 0.0, 1.0);

  float stretch = 1.0;
  vec2 dir = vec2(1.0, 0.0);
  if (uStreak + uMorphVel > 1e-4) {
    const float H = 0.045;
    vec3 va = (shape(position, aAttrA.w, uModeA, uTiltA, uClockA + H, uPivotA) - pa) / H;
    vec3 vb = (shape(aPosB, aAttrB.w, uModeB, uTiltB, uClockB + H, uPivotB) - pb) / H;
    if (dot(va, va) > 900.0) va = vec3(0.0);
    if (dot(vb, vb) > 900.0) vb = vec3(0.0);
    vec3 vel = mix(va, vb, e) * uStreak + delta * (uMorphVel * flight * 0.8);
    vec4 clip2 = projectionMatrix * (modelViewMatrix * vec4(p + vel * 0.026, 1.0));
    vec2 track = (clip2.xy / max(clip2.w, 1e-4) - gl_Position.xy / max(gl_Position.w, 1e-4))
               * 0.5 * uViewport;
    float trackLen = length(track);
    if (trackLen > 0.4) {
      stretch = 1.0 + trackLen / max(px, 1.0);
      stretch = min(stretch, 4.5);
      dir = normalize(vec2(track.x, -track.y));
    }
  }
  float total = min(px * stretch, 52.0 * uPixelRatio);
  stretch = max(total / max(px, 1e-3), 1.0);
  gl_PointSize = clamp(total, floorPx, 52.0 * uPixelRatio);
  vStretch = stretch;
  vDir = dir;

  vDepth = smoothstep(uFogNear, uFogFar, dist);
  float nearFade = smoothstep(0.0, 2.5, dist);
  float tunnelness = mix(uModeA == 2 ? 1.0 : 0.0, uModeB == 2 ? 1.0 : 0.0, e);
  float tunnelFade = smoothstep(9.0, 44.0, dist);
  nearFade = mix(nearFade, tunnelFade * tunnelFade * tunnelFade, tunnelness);
  vTint = mix(aAttrA.y, aAttrB.y, e);

  float phase = mix(aAttrA.z, aAttrB.z, e);
  float wave = 0.5 + 0.5 * sin((phase * uPulseWidth - uPulseClock) * 6.2831853);
  float pulse = 1.0 + uPulse * role * pow(wave, 3.0);

  vLum = (0.34 + 0.5 * aSeed) * (1.0 + 0.22 * flight) * pulse
       * (1.0 + uPinch * pow(max(sin(PI * e), 0.0), 3.0) * 1.8);
  vLum *= 1.0 - 0.18 * dust;
  float dopp = mix(dopplerFor(pa, aAttrA.w, uModeA), dopplerFor(pb, aAttrB.w, uModeB), e);
  vLum *= 1.0 + 0.3 * dopp;
  float jb = mix(jetBase(position, uPivotA, aAttrA.w, uModeA), jetBase(aPosB, uPivotB, aAttrB.w, uModeB), e);
  vLum *= 1.0 + jb * uPulse * 0.55 * (0.5 + 0.5 * sin(uPulseClock * 6.2831853));
  vLum *= 1.0 + 0.05 * dust * sin((uClockA + uClockB) * (1.7 + 2.8 * fract(aSeed * 3.7)) + aSeed * 41.0);
  float wk = 0.0;
  if (uModeA == 8 && aAttrA.w < -0.5) wk += (1.0 - e) * sheetWake(position, uClockA);
  if (uModeB == 8 && aAttrB.w < -0.5) wk += e * sheetWake(aPosB, uClockB);
  vLum *= 1.0 + 0.45 * max(0.0, wk) - 0.12 * max(0.0, -wk);
  float ecl = 0.0;
  if (uModeA == 8) ecl += (1.0 - e) * satelliteShadow(position, aAttrA.w, uClockA);
  if (uModeB == 8) ecl += e * satelliteShadow(aPosB, aAttrB.w, uClockB);
  vLum *= 1.0 - 0.72 * clamp(ecl, 0.0, 1.0);
  float spk = mix(perihelionSpark(pa, aAttrA.w, uModeA, uPivotA), perihelionSpark(pb, aAttrB.w, uModeB, uPivotB), e);
  vLum *= 1.0 + 0.55 * spk;
  vLum *= mix(holeDim(position, uPivotA, uModeA), holeDim(aPosB, uPivotB, uModeB), e);
  vLum *= 1.0 + 0.5 * touchGlow;
  vSeed = aSeed;
  vCoc = coc;
  vRole = role;
  float transportAlpha = mix(
    transportVisibility(position, aAttrA.w, uModeA, uClockA),
    transportVisibility(aPosB, aAttrB.w, uModeB, uClockB),
    e
  );
  float dustNear = mix(1.0, smoothstep(7.0, 22.0, dist), dust);
  vAlpha = (1.0 - vDepth)
         * nearFade
         * dustNear
         * subpixel * subpixel
         * transportAlpha
         / (1.0 + coc * uDof * (2.6 + 3.0 * dust))
         / (0.25 + 0.75 * stretch);
  vAlpha *= genesisDim;
  vWarm = clamp(1.0 - length(p) / uWarmRadius, 0.0, 1.0);
}
`;

export const particleFragment = /* glsl */ `
precision highp float;

uniform vec3 uColBase;
uniform vec3 uColAccent;
uniform vec3 uColWarm;
uniform vec3 uFogColor;
uniform float uAccent;
uniform float uWarm;
uniform float uFogTint;
uniform float uBokeh;
uniform float uOpacity;

varying float vTint;
varying float vAlpha;
varying float vLum;
varying float vWarm;
varying float vCoc;
varying float vDepth;
varying float vSeed;
varying float vStretch;
varying vec2 vDir;
varying float vRole;

void main() {
  vec2 pc = gl_PointCoord - 0.5;
  vec2 pcl = vec2(dot(pc, vDir), dot(pc, vec2(-vDir.y, vDir.x)));
  pcl.y *= vStretch;
  float r = length(pcl) * 2.0;
  if (r > 1.0) discard;

  float structure = smoothstep(0.35, 0.9, vRole);
  float core = exp(-r * r * mix(5.1, 6.5, structure));
  float halo = exp(-r * r * 1.55) * mix(0.38, 0.15, structure);
  float edge = smoothstep(1.0, 0.55, r);
  float sharp = clamp(core * mix(0.84, 0.96, structure) + halo * edge, 0.0, 1.0);
  float th = atan(pcl.y, pcl.x) + 0.3;
  float hexEdge = 0.8660254 / cos(mod(th, 1.0471976) - 0.5235988);
  float iris = clamp(uBokeh * vCoc, 0.0, 1.0);
  float rh = r / mix(1.0, hexEdge * 0.92, iris * 0.9);
  float disc = smoothstep(1.0, 0.6, rh) * (0.36 + 0.3 * smoothstep(0.38, 0.9, rh));
  float shape = mix(sharp, disc, iris);

  float a = shape * vAlpha * uOpacity;
  if (a < 0.002) discard;

  vec3 col = mix(uColBase, uColAccent, clamp(vTint * uAccent, 0.0, 1.0));
  if (vTint > 1.5) {
    float h = clamp(vTint - 2.0, 0.0, 1.0);
    vec3 mint = vec3(0.58, 0.93, 0.84);
    vec3 gold = vec3(1.0, 0.84, 0.58);
    vec3 rust = vec3(1.0, 0.63, 0.5);
    col = h < 0.34 ? mix(uColAccent, mint, h / 0.34)
        : h < 0.67 ? mix(mint, gold, (h - 0.34) / 0.33)
        : mix(gold, rust, (h - 0.67) / 0.33);
  }
  float wAmt = clamp(uWarm * vWarm, 0.0, 1.0);
  vec3 viaBase = mix(col, uColBase, wAmt * 0.55);
  col = mix(viaBase, uColWarm, wAmt);
  col = mix(col, uFogColor, vDepth * uFogTint);
  col = mix(col, uFogColor, clamp(1.0 - core * 1.5, 0.0, 1.0) * 0.10);
  col = mix(col, vec3(1.0), core * 0.16 * (1.0 - iris));
  float jit = vSeed * 2.0 - 1.0;
  col *= vec3(1.0 + jit * 0.03, 1.0, 1.0 - jit * 0.03);

  gl_FragColor = vec4(col * vLum, a);
}
`;
