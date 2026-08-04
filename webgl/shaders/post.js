
export const fullscreenVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const trailFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tHistory;
uniform float uTrail;
void main() {
  vec3 scene = texture2D(tScene, vUv).rgb;
  vec3 history = texture2D(tHistory, vUv).rgb * uTrail;
  gl_FragColor = vec4(max(scene, history), 1.0);
}
`;

export const brightFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tScene;
uniform float uThreshold;
uniform float uKnee;
uniform vec2 uTexel;
void main() {
  vec3 c0 = texture2D(tScene, vUv).rgb;
  vec3 c1 = texture2D(tScene, vUv + uTexel * vec2(-1.0, 0.0)).rgb;
  vec3 c2 = texture2D(tScene, vUv + uTexel * vec2(1.0, 0.0)).rgb;
  vec3 c3 = texture2D(tScene, vUv + uTexel * vec2(0.0, -1.0)).rgb;
  vec3 c4 = texture2D(tScene, vUv + uTexel * vec2(0.0, 1.0)).rgb;
  vec3 c5 = texture2D(tScene, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  vec3 c6 = texture2D(tScene, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  vec3 c7 = texture2D(tScene, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  vec3 c8 = texture2D(tScene, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  float w0 = 4.0 / (1.0 + max(c0.r, max(c0.g, c0.b)));
  float w1 = 2.0 / (1.0 + max(c1.r, max(c1.g, c1.b)));
  float w2 = 2.0 / (1.0 + max(c2.r, max(c2.g, c2.b)));
  float w3 = 2.0 / (1.0 + max(c3.r, max(c3.g, c3.b)));
  float w4 = 2.0 / (1.0 + max(c4.r, max(c4.g, c4.b)));
  float w5 = 1.0 / (1.0 + max(c5.r, max(c5.g, c5.b)));
  float w6 = 1.0 / (1.0 + max(c6.r, max(c6.g, c6.b)));
  float w7 = 1.0 / (1.0 + max(c7.r, max(c7.g, c7.b)));
  float w8 = 1.0 / (1.0 + max(c8.r, max(c8.g, c8.b)));
  vec3 c = (c0 * w0 + c1 * w1 + c2 * w2 + c3 * w3 + c4 * w4
          + c5 * w5 + c6 * w6 + c7 * w7 + c8 * w8)
         / (w0 + w1 + w2 + w3 + w4 + w5 + w6 + w7 + w8);
  float l = max(c.r, max(c.g, c.b));
  float soft = clamp(l - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float k = max(soft, l - uThreshold) / max(l, 1e-4);
  gl_FragColor = vec4(c * clamp(k, 0.0, 1.0), 1.0);
}
`;

export const downFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tScene;
uniform vec2 uTexel;
void main() {
  vec3 c = texture2D(tScene, vUv).rgb * 0.25;
  c += (texture2D(tScene, vUv + uTexel * vec2(-1.0, 0.0)).rgb
      + texture2D(tScene, vUv + uTexel * vec2(1.0, 0.0)).rgb
      + texture2D(tScene, vUv + uTexel * vec2(0.0, -1.0)).rgb
      + texture2D(tScene, vUv + uTexel * vec2(0.0, 1.0)).rgb) * 0.125;
  c += (texture2D(tScene, vUv + uTexel * vec2(-1.0, -1.0)).rgb
      + texture2D(tScene, vUv + uTexel * vec2(1.0, -1.0)).rgb
      + texture2D(tScene, vUv + uTexel * vec2(-1.0, 1.0)).rgb
      + texture2D(tScene, vUv + uTexel * vec2(1.0, 1.0)).rgb) * 0.0625;
  gl_FragColor = vec4(c, 1.0);
}
`;

export const blurFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSource;
uniform vec2 uDirection;
void main() {
  vec3 sum = texture2D(tSource, vUv).rgb * 0.227027;
  sum += texture2D(tSource, vUv + uDirection * 1.3846).rgb * 0.316216;
  sum += texture2D(tSource, vUv - uDirection * 1.3846).rgb * 0.316216;
  sum += texture2D(tSource, vUv + uDirection * 3.2308).rgb * 0.070270;
  sum += texture2D(tSource, vUv - uDirection * 3.2308).rgb * 0.070270;
  gl_FragColor = vec4(sum, 1.0);
}
`;

export const compositeFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform sampler2D tScene;
uniform sampler2D tTrail;
uniform sampler2D tBloom0;
uniform sampler2D tBloom1;
uniform sampler2D tBloom2;
uniform vec2 uTexelB0;
uniform vec2 uTexelB1;
uniform vec2 uTexelB2;
#define TENT4(T, UV, TX) ((texture2D(T, (UV) + vec2(-0.75, -0.75) * (TX)).rgb + texture2D(T, (UV) + vec2(0.75, -0.75) * (TX)).rgb + texture2D(T, (UV) + vec2(-0.75, 0.75) * (TX)).rgb + texture2D(T, (UV) + vec2(0.75, 0.75) * (TX)).rgb) * 0.25)
uniform vec2 uResolution;
uniform float uTime;

uniform float uBloom;
uniform float uBloomTight;
uniform float uBloomWide;
uniform float uDirt;
uniform float uTrailMix;

uniform float uChroma;
uniform float uFringe;
uniform float uLens;
uniform float uHorizon;
uniform float uHorizonAlpha;
uniform float uHorizonLight;
uniform float uRing;
uniform vec2 uCenter;

uniform float uHaze;
uniform float uHazeScale;
uniform vec3 uHazeColor;

uniform float uExposure;
uniform float uTemp;
uniform float uSat;
uniform float uContrast;
uniform float uLift;

uniform float uGrain;
uniform float uVignette;
uniform vec3 uColWarm;
uniform vec3 uColWhite;

vec2 aspectify(vec2 d) {
  d.x *= uResolution.x / uResolution.y;
  return d;
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

vec2 lensUv(vec2 uv, float scale) {
  vec2 result = uv;
  if (uLens >= 0.001) {
    vec2 d = aspectify(uv - uCenter);
    float r = length(d) + 1e-5;
    vec2 dir = d / r;
    float pull = uLens * scale / (r * r * 24.0 + 0.2);
    vec2 offset = -dir * pull * 0.055 + vec2(-dir.y, dir.x) * pull * 0.03;
    offset.x /= uResolution.x / uResolution.y;
    result = uv + offset;
  }
  return result;
}

vec3 sampleScene(vec2 uv) {
  vec3 result = texture2D(tScene, lensUv(uv, 1.0)).rgb;
  if (uChroma >= 0.001) {
    vec2 d = uv - uCenter;
    float k = uChroma * 0.006;
    result.r = texture2D(tScene, lensUv(uv + d * k, 1.06)).r;
    result.b = texture2D(tScene, lensUv(uv - d * k, 0.94)).b;
  }
  return result;
}

vec3 tonemap(vec3 c) {
  const mat3 SRGB_2020 = mat3(
    vec3(0.6274, 0.0691, 0.0164),
    vec3(0.3293, 0.9195, 0.0880),
    vec3(0.0433, 0.0113, 0.8956));
  const mat3 REC2020_SRGB = mat3(
    vec3(1.6605, -0.1246, -0.0182),
    vec3(-0.5876, 1.1329, -0.1006),
    vec3(-0.0728, -0.0083, 1.1187));
  const mat3 AGX_INSET = mat3(
    vec3(0.856627153315983, 0.137318972929847, 0.11189821299995),
    vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903),
    vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  const mat3 AGX_OUTSET = mat3(
    vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
    vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
    vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  c = max(c * 1.32, vec3(0.0));
  c = AGX_INSET * (SRGB_2020 * c);
  c = clamp((log2(max(c, vec3(1e-10))) + 12.47393) / 16.5, 0.0, 1.0);
  vec3 c2 = c * c;
  vec3 c4 = c2 * c2;
  c = 15.5 * c4 * c2 - 40.14 * c4 * c + 31.96 * c4
    - 6.868 * c2 * c + 0.4298 * c2 + 0.1191 * c - 0.00232;
  c = AGX_OUTSET * c;
  c = pow(max(c, vec3(0.0)), vec3(2.2));
  return REC2020_SRGB * c;
}

vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(1e-5)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec3 col = sampleScene(vUv);

  if (uTrailMix > 0.001) {
    col = max(col, texture2D(tTrail, vUv).rgb * uTrailMix);
  }

  if (uHorizon > 0.0001 && uHorizonAlpha > 0.0001) {
    float r = length(aspectify(vUv - uCenter));
    float light = clamp(uHorizonLight, 0.0, 1.0);
    float horizon = smoothstep(uHorizon * 1.02, uHorizon * 0.86, r);
    float aperture = horizon * uHorizonAlpha;
    col *= 1.0 - aperture * (1.0 - light);
    if (light > 0.001) {
      float q = r / max(uHorizon, 0.0001);
      float src = exp(-q * q * 1.15);
      float wide = exp(-q * q * 0.18);
      vec3 radiant = uColWhite * (1.55 * src + 0.24 * wide);
      float cover = clamp(src * 1.7, 0.0, 1.0) * light * uHorizonAlpha;
      col = mix(col, radiant, cover);
      col += radiant * 0.18 * light * uHorizonAlpha * (1.0 - cover);
    }
    float core = exp(-pow((r - uHorizon * 1.035) / (uHorizon * 0.035), 2.0));
    float shoulder = exp(-pow((r - uHorizon * 1.06) / (uHorizon * 0.16), 2.0));
    col += uColWarm * (core + shoulder * 0.16) * uRing * uHorizonAlpha * (1.0 - light);
    vec2 ad = aspectify(vUv - uCenter);
    float ang = atan(ad.y, ad.x);
    float arcR = exp(-pow((r - uHorizon * 1.075) / (uHorizon * 0.045), 2.0));
    float d1 = atan(sin(ang - 0.7), cos(ang - 0.7));
    float d2 = atan(sin(ang - 3.8416), cos(ang - 3.8416));
    float arcs = exp(-pow(d1 / 0.5, 2.0)) + 0.5 * exp(-pow(d2 / 0.36, 2.0));
    col += uColWarm * arcR * arcs * uRing * 0.85 * uHorizonAlpha * (1.0 - light);
  }

  if (uHaze > 0.0001) {
    float r = length(aspectify(vUv - uCenter)) / max(uHazeScale, 0.05);
    float density = exp(-r * r * 1.6) * uHaze;
    float lit = dot(col, vec3(0.2126, 0.7152, 0.0722));
    density *= 0.12 + min(1.0, lit * 7.0);
    if (uHorizon > 0.0001 && uHorizonAlpha > 0.0001) {
      float horizonClear = smoothstep(uHorizon * 0.92, uHorizon * 1.5, length(aspectify(vUv - uCenter)));
      density *= mix(1.0, horizonClear, uHorizonAlpha);
    }
    col += uHazeColor * density;
  }

  vec3 b0 = TENT4(tBloom0, vUv, uTexelB0);
  vec3 b1 = TENT4(tBloom1, vUv, uTexelB1);
  vec3 b2 = TENT4(tBloom2, vUv, uTexelB2);
  vec2 fr = (vUv - uCenter) * 0.007 * uFringe;
  b2 = vec3(texture2D(tBloom2, vUv + fr).r, b2.g, texture2D(tBloom2, vUv - fr).b);
  b2 *= vec3(0.94, 0.985, 1.06);
  float bloomOcclude = 1.0;
  if (uHorizon > 0.0001 && uHorizonAlpha > 0.0001) {
    float hr = length(aspectify(vUv - uCenter));
    bloomOcclude = 1.0 - smoothstep(uHorizon * 1.0, uHorizon * 0.84, hr)
      * uHorizonAlpha * (1.0 - clamp(uHorizonLight, 0.0, 1.0));
  }
  col += b0 * uBloom * uBloomTight * bloomOcclude;
  col += b1 * uBloom * 0.62 * bloomOcclude;
  col += b2 * uBloom * uBloomWide * bloomOcclude;

  float hb = max(b0.r, max(b0.g, b0.b));
  col += uColWarm * smoothstep(0.55, 1.7, hb) * hb * 0.15 * bloomOcclude;

  if (uDirt > 0.0001) {
    vec2 g = floor(vUv * 9.0);
    float speck = hash(g) * hash(g + 3.7);
    float smudge = smoothstep(0.62, 1.0, speck) * (0.5 + 0.5 * sin(vUv.y * 31.0 + speck * 12.0));
    col += b2 * smudge * uDirt * 2.2 * bloomOcclude;
  }

  col *= uExposure;
  col *= vec3(1.0 + uTemp * 0.09, 1.0 + uTemp * 0.012, 1.0 - uTemp * 0.075);
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(luma), col, uSat);

  col = tonemap(col);
  col = (col - 0.5) * uContrast + 0.5;
  col += uLift * (1.0 - col);
  col = max(col, vec3(0.0));

  float v = smoothstep(1.25, 0.32, length((vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0)));
  col *= mix(1.0, v, uVignette);

  float lum2 = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float g = fract(52.9829189 * fract(0.06711056 * (vUv.x * uResolution.x + fract(uTime * 0.7309) * 53.0)
                                   + 0.00583715 * (vUv.y * uResolution.y + fract(uTime * 0.4171) * 91.0)));
  float gw = uGrain * (0.28 + 0.72 * smoothstep(0.012, 0.30, lum2))
                    * (1.0 - 0.55 * smoothstep(0.55, 1.0, lum2));
  col += (g - 0.5) * gw;

  vec3 srgb = linearToSrgb(max(col, vec3(0.0)));
  float d2 = hash(vUv * uResolution.yx + fract(uTime * 0.913) * 71.0);
  srgb += (g + d2 - 1.0) * (0.85 / 255.0);
  float a = clamp(max(srgb.r, max(srgb.g, srgb.b)) * 3.2, 0.0, 1.0);
  gl_FragColor = vec4(srgb, a);
}
`;
