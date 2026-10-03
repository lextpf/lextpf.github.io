
/* Shared by every pass below. It does no transformation at all: the geometry is
   already a quad in clip space covering -1..1, so the position passes straight
   through. All the work is in the fragment shaders. */
export const fullscreenVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/* Trails. Combines this frame with the fading previous one.

   max() rather than a blend, deliberately. Averaging would dim the current frame
   toward the history and fog the whole image; taking the brighter of the two
   leaves anything currently lit at full strength and only lets the decayed
   history show where this frame is darker. So a moving particle draws a tail and
   a still image stays crisp. */
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

/* Bright pass. Extracts the parts of the image that should glow, and is the
   first step of the bloom chain.

   Two things are happening at once.

   The nine taps with weights 4/2/1 are a 3x3 tent filter, prefiltering as it
   extracts. Without it, single bright pixels survive into the blur chain and
   flicker violently as they move sub-pixel distances between frames, which on a
   screen made of 100,000 moving points would be unwatchable.

   Those `1 / (1 + luminance)` weights are Karis averaging: weighting each tap by
   the inverse of its own brightness before averaging. It stops one very bright
   pixel from dominating its neighbourhood and is the standard fix for bloom
   fireflies in a high dynamic range buffer, which this is.

   Glow means lit, and lit is white. The average is taken halfway to its own
   luminance before anything else, so the glow is half desaturated and a
   saturated accent pixel, whose largest channel is 2.7x its luminance, does not
   cross the threshold at a third of the light a white one needs.

   The threshold then has a soft knee rather than a hard cut, so a particle
   brightening past the threshold ramps into bloom instead of switching it on.
   The knee is relative (post-processing.js sets it to a quarter of the
   threshold), so extraction starts at 0.75 of the threshold on every chapter:
   only the brightest lit points glow, never the body of a formation. */
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
  c = mix(c, vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), 0.5);
  float l = max(c.r, max(c.g, c.b));
  float soft = clamp(l - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float k = max(soft, l - uThreshold) / max(l, 1e-4);
  gl_FragColor = vec4(c * clamp(k, 0.0, 1.0), 1.0);
}
`;

/* Downsample by half, for the next rung of the bloom mip chain.

   A 3x3 tent again (weights 0.25 centre, 0.125 edges, 0.0625 corners, summing to
   1), rather than letting the hardware do a plain bilinear halving. Bilinear
   only looks at 4 texels, so at every halving it throws away information that
   then reappears as crawling aliasing once the result is scaled back up. */
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

/* One axis of a Gaussian blur. post-processing.js runs it twice per mip level,
   once horizontally and once vertically, which gives a 2D blur for 2N samples
   instead of N squared.

   Only five taps for what is effectively a nine-tap Gaussian. The offsets are
   fractional (1.3846, 3.2308), so each sample sits between two texels and the
   hardware's bilinear filter returns their weighted average for free. That is
   the standard linear-sampling Gaussian trick: two texels per fetch, half the
   samples, identical result.

   uDirection carries the radius as well as the axis, since it is supplied in
   texels by the caller. */
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

/* The camera's shutter, shared by the two passes that blur a flight.

   While the camera moves, a point on the subject plane (the plane through the
   rig's look-at target, facing the camera) that this pixel shows now was
   somewhere else one presented frame ago. uCamH (post-processing.js) maps this
   pixel's NDC on that plane to the previous frame's clip space, so the
   difference is how far the picture moved here in one frame. A 180 degree
   shutter is open for half the frame: the returned vector is that half, in uv,
   and the blur is a box along it, centred on the present.

   No blur runs longer than uCamMax px (post-processing.js: 2% of the frame's
   short side, never more than 64 px). The motion per frame scales with
   devicePixelRatio rather than with the frame, so without the cap a smaller
   or denser frame smears a formation further, relative to its size, than the
   4K one does. Clamping the length, not the direction, keeps a continuous
   field: a pixel under the cap is exactly as it was.

   The box is sampled at fixed midpoints, never jittered: a crisp dot (sigma
   0.40 px) read at taps much more than a pixel apart turns into a row of
   beads, and a random phase per pixel only turns the beads into grain (at 4K
   a flight blurs 30-37 px, where 16 jittered taps leave a floor-sigma streak
   clumpy). Up to a 16 px blur the composite reads the scene directly, at most
   16 taps no more than 1 px apart (0.75 px up to 12 px). Beyond that each of
   its eight taps reads an eighth of the shutter that the shutter pass has
   already averaged at taps no more than 0.375 px apart (0.58 px at 37 px).
   The two nested boxes are the midpoints of one long box (the direction
   barely changes over an eighth), at no more than 16 fetches per pixel. The
   finest spacing is 0.75 px up to a 48 px blur and 1 px at the 64 px ceiling;
   simulated on a floor-sigma dot, the streak's ripple stays at 13-14% or
   less through 64 px (17.5% at 72 px, which the ceiling rules out).
   SHUTTER_DIRECT is repeated in post-processing.js, which decides when the
   shutter pass runs. */
const shutterCommon = /* glsl */ `
uniform mat3 uCamH;
uniform float uCamMax;
const float SHUTTER_STEP = 0.75;
const float SHUTTER_DIRECT = 16.0;
const float SHUTTER_FINE = 0.375;
vec2 shutterUv(vec2 uv) {
  vec2 ndc = uv * 2.0 - 1.0;
  vec3 h = uCamH * vec3(ndc, 1.0);
  if (h.z <= 1e-4) return vec2(0.0);
  vec2 shutter = (ndc - h.xy / h.z) * 0.25;
  float lenPx = length(shutter * uResolution);
  return lenPx > uCamMax ? shutter * (uCamMax / lenPx) : shutter;
}
`;

/* The shutter pass: every pixel's eighth of the camera's box, pre-averaged,
   so the composite's eight taps along a long shutter read even stretches
   rather than points. Only runs while the blur somewhere in the frame may
   pass SHUTTER_DIRECT (post-processing.js decides). */
export const shutterFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tScene;
uniform vec2 uResolution;
${shutterCommon}
void main() {
  vec2 shutter = shutterUv(vUv);
  float lenPx = length(shutter * uResolution);
  float n = clamp(ceil(lenPx / (8.0 * SHUTTER_FINE)), 1.0, 8.0);
  vec2 eighth = shutter * 0.125;
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 8; i++) {
    if (float(i) >= n) break;
    acc += texture2D(tScene, vUv + eighth * ((float(i) + 0.5) / n - 0.5));
  }
  gl_FragColor = acc / n;
}
`;

/* ==========================================================================
   THE COMPOSITE PASS

   The last pass, the only one that writes to the canvas, and by far the largest.
   Everything upstream produced an ingredient; this assembles them and grades the
   result into the final image.

   Note that the event horizon is drawn HERE, not by any particle. The black disc
   and its photon ring are painted in 2D at the position and radius
   CameraRig.projectSphere hands over in uCenter and uHorizon. The black hole
   formation only ever builds what surrounds the hole.

   --- What main() does, in order ---

     sampleScene        reads the scene, and applies gravitational lensing and
                        chromatic aberration on the way in. Both work by warping
                        the lookup coordinates rather than by drawing anything, so
                        the whole image bends around the hole instead of a bent
                        copy being laid over it
     camera shutter     only while the camera flies (uCamBlur): a box along the
                        half-frame of motion (shutterUv, capped at uCamMax),
                        up to 16 scene reads or, past a 16 px blur, eight
                        reads of the shutter pass's pre-averaged eighths
                        (tBlur). Colour and the near-light alpha blur
                        together. At rest this is the single sampleScene read
                        above, untouched, so a still frame is the same frame
                        it always was. The horizon, the haze and the bloom
                        below are drawn unblurred
     trails             the accumulated history buffer, if trails are on
     horizon and ring   the black disc, the photon ring hugging its edge, and the
                        two brighter arcs of that same ring. The white hole takes
                        the same code path with uHorizonLight inverting it from
                        an absence into a source with a crisp white limb. Every
                        edge is sized in device pixels (pxH), not in fractions
                        of the radius: the shadow edge and the plateau edge are
                        2-2.5 px, the ring core 0.012 R but never under 1.3 px
                        with its inner half-maximum where the shadow edge ends,
                        the limb's outer side a 1.2 px sigma. Only the glows
                        (the ring's shoulder, the limb's inner side) stay wide,
                        and nothing the black hole draws reaches inside its
                        shadow. The disc only darkens (or covers) the
                        light BEHIND the horizon: the particles write the
                        luminance of their light in front of the horizon sphere
                        into the scene's alpha, that share is set aside first and
                        added back on top, so the near side of the accretion disc
                        crosses the shadow instead of being erased by it
     haze               a radial volumetric wash, modulated by local brightness so
                        it thickens where there is light to catch and cleared from
                        inside the horizon
     bloom              the three mip levels mixed back separately (uBloomTight,
                        uBloomMid, uBloomWide), tight for the halo of a lit point
                        and wide for what little atmosphere is left. The bright
                        pass only lets the brightest lit points through, so this
                        is a highlight, not a veil. All three are occluded by the
                        horizon (bloomOcclude, the same 2.5 px edge), or the hole
                        would glow through its own event horizon
     dirt               lens grime, lit by the widest bloom level
     grade              exposure, temperature, saturation, contrast, lift
     tonemap            compress high dynamic range into displayable range
     grain and vignette both applied last, after tonemapping, so they behave like
                        artefacts of the image rather than of the scene
     linearToSrgb       the final conversion. The renderer is set to linear
                        output precisely so this pass can own it

   --- Helper functions ---

     aspectify      correct a screen-space offset for the viewport aspect, so
                    round things stay round on a wide window
     hash           cheap per-pixel pseudo-random, for grain and dither
     lensUv         the gravitational lens warp
     sampleScene    sample the scene texture, with the per-channel offset that
                    produces chromatic aberration. Returns the alpha too (from
                    the centre tap): the near-horizon light, see above
     sampleBlur     the same, from tBlur, for the long camera shutter's taps
     shutterUv      the half-frame of camera motion at a pixel (shared with
                    the shutter pass, see shutterCommon)
     tonemap        the filmic curve
     linearToSrgb   gamma encode on the way out
   ========================================================================== */
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
uniform float uCamBlur;
uniform float uCamPre;
uniform sampler2D tBlur;
${shutterCommon}

uniform float uBloom;
uniform float uBloomTight;
uniform float uBloomMid;
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
uniform float uLensed;
// The Doppler crescents (particle-system.js holeCrescent): x on and y the
// screen angle of the side of the black hole's disc coming toward the camera,
// z and w the same for the white hole's.
uniform vec4 uCrescent;
uniform vec2 uCenter;
uniform float uEdgeLens;

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

/* The edge lens (post-processing.js): while you travel through the
   wormhole the frame's edges stretch like a wide lens, only in the outer
   part of the picture (nothing inside 45% of the half-diagonal moves) and
   at most a few percent in the corners. rs scales it per channel, so the
   stretched edges split faintly into colour. */
vec2 edgeUv(vec2 uv, float rs) {
  if (uEdgeLens < 0.001) return uv;
  vec2 d = uv - 0.5;
  float r = length(aspectify(d)) / (0.5 * length(vec2(uResolution.x / uResolution.y, 1.0)));
  float e = smoothstep(0.45, 1.0, r);
  return 0.5 + d * (1.0 - uEdgeLens * 0.06 * rs * e * e);
}

vec4 sampleScene(vec2 uv) {
  vec4 result = texture2D(tScene, lensUv(edgeUv(uv, 1.0), 1.0));
  if (uChroma >= 0.001) {
    vec2 d = uv - uCenter;
    float k = uChroma * 0.006;
    result.r = texture2D(tScene, lensUv(edgeUv(uv + d * k, 1.3), 1.06)).r;
    result.b = texture2D(tScene, lensUv(edgeUv(uv - d * k, 0.7), 0.94)).b;
  } else if (uEdgeLens >= 0.001) {
    result.r = texture2D(tScene, lensUv(edgeUv(uv, 1.3), 1.0)).r;
    result.b = texture2D(tScene, lensUv(edgeUv(uv, 0.7), 1.0)).b;
  }
  return result;
}

vec4 sampleBlur(vec2 uv) {
  vec4 result = texture2D(tBlur, lensUv(edgeUv(uv, 1.0), 1.0));
  if (uChroma >= 0.001) {
    vec2 d = uv - uCenter;
    float k = uChroma * 0.006;
    result.r = texture2D(tBlur, lensUv(edgeUv(uv + d * k, 1.3), 1.06)).r;
    result.b = texture2D(tBlur, lensUv(edgeUv(uv - d * k, 0.7), 0.94)).b;
  } else if (uEdgeLens >= 0.001) {
    result.r = texture2D(tBlur, lensUv(edgeUv(uv, 1.3), 1.0)).r;
    result.b = texture2D(tBlur, lensUv(edgeUv(uv, 0.7), 1.0)).b;
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
  vec4 sc;
  if (uCamBlur > 0.5) {
    vec2 shutter = shutterUv(vUv);
    float lenPx = length(shutter * uResolution);
    sc = vec4(0.0);
    if (uCamPre > 0.5 && lenPx > SHUTTER_DIRECT) {
      for (int i = 0; i < 8; i++) {
        sc += sampleBlur(vUv + shutter * ((float(i) + 0.5) / 8.0 - 0.5));
      }
      sc *= 0.125;
    } else {
      float n = clamp(ceil(lenPx / SHUTTER_STEP), 1.0, 16.0);
      for (int i = 0; i < 16; i++) {
        if (float(i) >= n) break;
        sc += sampleScene(vUv + shutter * ((float(i) + 0.5) / n - 0.5));
      }
      sc /= n;
    }
  } else {
    sc = sampleScene(vUv);
  }
  vec3 col = sc.rgb;

  if (uTrailMix > 0.001) {
    col = max(col, texture2D(tTrail, vUv).rgb * uTrailMix);
  }

  // One device pixel in the composite's radial unit (screen heights), so every
  // edge the horizon draws is a fixed number of pixels wide at any resolution.
  float pxH = 1.0 / uResolution.y;

  if (uHorizon > 0.0001 && uHorizonAlpha > 0.0001) {
    vec3 nearLight = col * clamp(sc.a / max(dot(sc.rgb, vec3(0.2126, 0.7152, 0.0722)), 1e-4), 0.0, 1.0);
    col -= nearLight;
    float r = length(aspectify(vUv - uCenter));
    float light = clamp(uHorizonLight, 0.0, 1.0);
    // The shadow's edge is the horizon itself, 2.5 px from dark to clear.
    float horizon = smoothstep(uHorizon + 1.25 * pxH, uHorizon - 1.25 * pxH, r);
    float aperture = horizon * uHorizonAlpha;
    col *= 1.0 - aperture * (1.0 - light);
    float limb = 0.0;
    float whiteGlow = 0.0;
    float whiteCore = 0.0;
    if (light > 0.001) {
      float q = r / max(uHorizon, 0.0001);
      float pxQ = pxH / max(uHorizon, 0.0001);
      float l2 = light * light;
      // A hot centre over a plateau that runs right up to the limb. At low light
      // only the centre has caught (kindling), and the plateau fills in as the
      // light completes. Cover stops at 0.8 so the formation shows through.
      // The plateau ends in a 2 px edge.
      float gauss = exp(-q * q * mix(8.0, 2.2, light));
      float fill = gauss;
      // The white hole is the black hole's opposite: not an aperture with an
      // edge but a source. A soft hot centre, a long falloff far past the
      // horizon and slow rays through it, so the light has no border and the
      // outflow pours out of it.
      vec2 wd = aspectify(vUv - uCenter);
      float wang = atan(wd.y, wd.x);
      float rays = 0.55 + 0.45 * (0.6 * pow(0.5 + 0.5 * cos(wang * 7.0 + 0.6 + q * 0.35), 3.0)
                                + 0.4 * pow(0.5 + 0.5 * cos(wang * 13.0 - 1.1 - q * 0.2), 5.0));
      float core = exp(-q * q * 2.4);
      float halo = exp(-q * 1.2) * smoothstep(0.0, 0.6, q);
      // No plateau: the white hole has no edge for the silhouettes to stop at.
      whiteGlow = clamp(core * 1.2 + halo * 1.2, 0.0, 1.0);
      whiteCore = core;
      // The white hole's crescent (uCrescent.z): the halo brighter on the side
      // its disc turns toward the camera (uCrescent.w), 1.5x there and 0.7x
      // opposite, its mean light unchanged.
      float wbeam = 0.5 + 0.5 * cos(wang - uCrescent.w);
      float wcres = mix(1.0, 0.7 + 0.8 * wbeam * wbeam, uCrescent.z);
      // The centre is kept below white (1.6, cover 0.3), so what streams out
      // of it, and what lies behind it, shows through.
      vec3 radiant = uColWhite * (1.6 * core * l2 + 0.62 * halo * rays * light * wcres);
      float cover = clamp(core * 0.6, 0.0, 0.3) * light * uHorizonAlpha;
      col = mix(col, radiant, cover);
      col += radiant * 0.55 * light * uHorizonAlpha * (1.0 - cover);
      limb = 0.0;
    }
    // The photon ring is the shadow's lit rim: a thin core (0.012 R, never under
    // 1.3 px) whose inner half-maximum sits exactly where the 2.5 px shadow edge
    // ends (0.83 is sqrt(ln 2), the core's half-width at half maximum), over the
    // wide, faint shoulder that carries its glow.
    // Thicker while the particles are lensed (uLensed): it is then the only
    // painted light at the shadow's edge.
    float coreW = max(uHorizon * mix(0.02, 0.05, uLensed), 1.3 * pxH);
    float ringR = uHorizon + 1.25 * pxH + 0.83 * coreW;
    // Nothing the hole draws shows inside its own shadow: ring, arcs and shoulder
    // are cut by the same edge, so the disc is black right up to the ring.
    float outside = 1.0 - aperture * (1.0 - light);
    float core = exp(-pow((r - ringR) / coreW, 2.0));
    float shoulder = exp(-pow((r - uHorizon * 1.06) / (uHorizon * 0.16), 2.0));
    // The ring lags its aperture: a second uHorizonAlpha factor, so the warm ring
    // only reaches full strength once the disc has fully arrived.
    float ringAlpha = uHorizonAlpha * uHorizonAlpha;
    // The rim: the thin core at the shadow's edge, then a warm band out to
    // 1.3 R, bright at the inside and fading out, with the secondary lensed
    // ring at 1.14 R inside it. The band, that ring and the shoulders stood in
    // for lensed light; while the particles are lensed (uLensed, the
    // chapter's lensing) their own images take that place and only the thin
    // core stays, so the gap between the shadow and the arched far side of
    // the disc is dark, with the particles' mirror image in it.
    float bandIn = smoothstep(ringR - coreW, ringR + coreW, r);
    // While lensed the band stops at 1.12 R: a dark gap parts it from the
    // arch the lens lifts over the shadow.
    float bandOut = mix(1.0 - smoothstep(uHorizon * 1.18, uHorizon * 1.3, r), 1.0 - smoothstep(uHorizon * 1.06, uHorizon * 1.12, r), uLensed);
    float bandFall = mix(1.0, 0.35, clamp((r - ringR) / (uHorizon * 0.3), 0.0, 1.0));
    float band = bandIn * bandOut * bandFall;
    float second = exp(-pow((r - uHorizon * 1.14) / max(uHorizon * 0.01, 1.2 * pxH), 2.0));
    float wideShoulder = exp(-pow((r - uHorizon * 1.12) / (uHorizon * 0.2), 2.0));
    float painted = 1.0 - uLensed;
    vec2 ad = aspectify(vUv - uCenter);
    float ang = atan(ad.y, ad.x);
    // The Doppler crescent (uCrescent.x): the ring brightest where the disc
    // comes toward the camera (uCrescent.y) and dim where it recedes, its
    // mean light unchanged.
    float beam = 0.5 + 0.5 * cos(ang - uCrescent.y);
    float crescent = mix(1.0, 0.4 + 1.6 * beam * beam, uCrescent.x);
    col += uColWarm * (core * crescent + band * mix(0.42, 0.1, uLensed) + (second * 0.4 + wideShoulder * 0.12) * painted + shoulder * mix(0.1, 0.02, uLensed)) * outside * uRing * ringAlpha * (1.0 - light);
    // The two bright arcs (upper right, and a half-strength one opposite) brighten
    // the ring itself, never a second band beside it: centred on the core,
    // slightly wider than it, a restrained lift of about 14% (8% opposite).
    // With the crescent on, one wider arc on the approaching side.
    float arcR = exp(-pow((r - ringR) / max(uHorizon * mix(0.016, 0.04, uLensed), 1.3 * pxH), 2.0));
    float arcAt = mix(0.7, uCrescent.y, uCrescent.x);
    float d1 = atan(sin(ang - arcAt), cos(ang - arcAt));
    float d2 = atan(sin(ang - arcAt - 3.1415927), cos(ang - arcAt - 3.1415927));
    float arcs = exp(-pow(d1 / mix(0.5, 0.7, uCrescent.x), 2.0)) + 0.5 * (1.0 - uCrescent.x) * exp(-pow(d2 / 0.36, 2.0));
    col += uColWarm * (arcR + band * 0.55 * painted) * arcs * outside * uRing * 0.55 * ringAlpha * (1.0 - light);
    // The lit hole's limb, white with no warm cast, plus a faint outer shoulder.
    col += uColWhite * limb * uHorizonAlpha;
    // Light in front of the horizon was never behind it: back on top. In front
    // of the white hole it also stands against the glow: it hides a little of
    // the light behind it (a soft silhouette, in proportion to its own light)
    // and is drawn darker there, so it reads as in front of the glow
    // rather than laid on it.
    if (whiteGlow > 0.001) {
      // Coverage, not raw light: a front particle's small HDR luminance is
      // read as how much of the pixel it covers.
      float nl = dot(nearLight, vec3(0.2126, 0.7152, 0.0722));
      // Strongest over the hot core (whiteCore), where the glow would
      // otherwise wash the silhouettes out: fainter dots count as covering,
      // hide more of the light behind them and are drawn darker.
      float occl = 1.0 - exp(-nl * mix(11.0, 35.0, whiteCore));
      float against = whiteGlow * light * uHorizonAlpha;
      col *= 1.0 - occl * mix(0.78, 0.95, whiteCore) * against;
      nearLight *= 1.0 - mix(0.54, 0.72, whiteCore) * against;
    }
    col += nearLight;
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

  // Bloom is looked up through the edge lens too, so glow stays on its light.
  vec2 bUv = edgeUv(vUv, 1.0);
  vec3 b0 = TENT4(tBloom0, bUv, uTexelB0);
  vec3 b1 = TENT4(tBloom1, bUv, uTexelB1);
  vec3 b2 = TENT4(tBloom2, bUv, uTexelB2);
  vec2 fr = (vUv - uCenter) * 0.007 * uFringe;
  b2 = vec3(texture2D(tBloom2, bUv + fr).r, b2.g, texture2D(tBloom2, bUv - fr).b);
  float bloomOcclude = 1.0;
  if (uHorizon > 0.0001 && uHorizonAlpha > 0.0001) {
    float hr = length(aspectify(vUv - uCenter));
    bloomOcclude = 1.0 - smoothstep(uHorizon + 1.25 * pxH, uHorizon - 1.25 * pxH, hr)
      * uHorizonAlpha * (1.0 - clamp(uHorizonLight, 0.0, 1.0));
  }
  col += b0 * uBloom * uBloomTight * bloomOcclude;
  col += b1 * uBloom * uBloomMid * bloomOcclude;
  col += b2 * uBloom * uBloomWide * bloomOcclude;

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
