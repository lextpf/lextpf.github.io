
import { TAU, GOLDEN_ANGLE, clamp01 } from '../lib/random.js';

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (v, s) => [v[0] * s, v[1] * s, v[2] * s];
export const mix3 = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
export const length3 = (v) => Math.hypot(v[0], v[1], v[2]);
export const distance3 = (a, b) => length3(sub(a, b));
export const normalize = (v) => {
  const length = length3(v) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
};
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/* Build two axes perpendicular to a direction, so a curve has a "sideways" and
   an "up" to spread particles across.

   Any reference vector works except one parallel to the tangent, where the cross
   product collapses to zero and the frame is undefined. Switching reference axis
   once the tangent gets within about 28 degrees of vertical avoids that. */
export function frame(tangent) {
  const t = normalize(tangent);
  const reference = Math.abs(t[1]) < 0.88 ? [0, 1, 0] : [1, 0, 0];
  const normal = normalize(cross(t, reference));
  return [normal, normalize(cross(t, normal))];
}

export function cubicPoint(curve, t) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return [
    curve[0][0] * a + curve[1][0] * b + curve[2][0] * d + curve[3][0] * e,
    curve[0][1] * a + curve[1][1] * b + curve[2][1] * d + curve[3][1] * e,
    curve[0][2] * a + curve[1][2] * b + curve[2][2] * d + curve[3][2] * e,
  ];
}

export function cubicTangent(curve, t) {
  const u = 1 - t;
  return normalize([
    3 * u * u * (curve[1][0] - curve[0][0]) +
    6 * u * t * (curve[2][0] - curve[1][0]) +
    3 * t * t * (curve[3][0] - curve[2][0]),
    3 * u * u * (curve[1][1] - curve[0][1]) +
    6 * u * t * (curve[2][1] - curve[1][1]) +
    3 * t * t * (curve[3][1] - curve[2][1]),
    3 * u * u * (curve[1][2] - curve[0][2]) +
    6 * u * t * (curve[2][2] - curve[1][2]) +
    3 * t * t * (curve[3][2] - curve[2][2]),
  ]);
}

// Approximate arc length by walking the curve in straight segments. Used to
// hand longer curves proportionally more particles, so density stays even
// instead of bunching up on the short ones.
export function cubicLength(curve, steps = 24) {
  let length = 0;
  let previous = curve[0];
  for (let i = 1; i <= steps; i++) {
    const point = cubicPoint(curve, i / steps);
    length += distance3(point, previous);
    previous = point;
  }
  return length;
}

// Split a particle budget by weight, distributing the rounding remainder one at
// a time so the parts always sum to exactly `total`. The same guarantee
// ctx.split gives, but for a sub-budget inside a generator.
export function allocate(total, weights) {
  const sum = weights.reduce((value, weight) => value + Math.max(0, weight), 0) || 1;
  const budgets = weights.map((weight) => Math.floor(total * Math.max(0, weight) / sum));
  let remaining = total - budgets.reduce((value, count) => value + count, 0);
  for (let i = 0; remaining > 0; i++, remaining--) budgets[i % budgets.length]++;
  return budgets;
}

// Every style field may be a constant or a function of position along the shape,
// so a tube can taper, or a blob can be tinted by depth, without two code paths.
const resolve = (value, t) => typeof value === 'function' ? value(t) : value;

/* Fill a cubic Bezier with particles, as though extruding a cylinder along it.

   Walk the curve, build a frame at each point, and scatter within a disc facing
   along the tangent. Two details keep it from looking synthetic:

   sqrt on the radial distance gives uniform coverage of the disc. Without it,
   points crowd the centre line, because a disc has more area near its rim than
   near its middle. The (i + rng) stride jitters each point within its own slot
   along the curve, so the result is evenly spread but not visibly regular. */
export function tube(c, curve, count, style) {
  if (count <= 0) return;
  for (let i = 0; i < count; i++) {
    const t = clamp01((i + c.rng.unit()) / count);
    const point = cubicPoint(curve, t);
    const tangent = cubicTangent(curve, t);
    const [normal, binormal] = frame(tangent);
    const radius = Math.max(0, resolve(style.radius, t));
    const angle = c.rng.unit() * TAU;
    const radial = radius * Math.sqrt(c.rng.unit());
    const jitter = style.jitter || 0;
    const x = point[0] + (normal[0] * Math.cos(angle) + binormal[0] * Math.sin(angle)) * radial + c.rng.bell() * jitter;
    const y = point[1] + (normal[1] * Math.cos(angle) + binormal[1] * Math.sin(angle)) * radial + c.rng.bell() * jitter;
    const z = point[2] + (normal[2] * Math.cos(angle) + binormal[2] * Math.sin(angle)) * radial + c.rng.bell() * jitter;
    c.write(
      x,
      y,
      z,
      Math.max(0, resolve(style.size, t) * c.rng.range(0.88, 1.14)),
      clamp01(resolve(style.tint, t) + c.rng.bell() * (style.tintJitter || 0)),
      clamp01(resolve(style.stagger, t)),
      resolve(style.spin, t),
      resolve(style.rigidity, t),
    );
  }
}

/* Fill an ellipsoid, optionally with a denser skin.

   Three things make this read as a solid body rather than a cloud of dots:

   Picking y uniformly and deriving the planar radius from it distributes points
   evenly over the sphere, instead of bunching them at the poles the way stepping
   through latitude and longitude does.

   The cube root on the radius (volumePower 1/3) fills the volume evenly. A
   uniform radius would pack points toward the centre, since volume grows with
   the cube of the radius.

   `shellShare` then pushes a fraction of them out to the surface, which is what
   gives a blob a readable edge instead of fading out into nothing. */
export function ellipsoid(c, centre, count, style) {
  if (count <= 0) return;
  const radii = style.radii || [1, 1, 1];
  const shellShare = style.shellShare || 0;
  for (let i = 0; i < count; i++) {
    const shell = c.rng.unit() < shellShare;
    const y = c.rng.signed();
    const planar = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = i * GOLDEN_ANGLE + c.rng.bell() * 0.04;
    const radius = shell
      ? c.rng.range(style.shellMin || 0.94, 1)
      : Math.pow(c.rng.unit(), style.volumePower || (1 / 3));
    c.write(
      centre[0] + Math.cos(angle) * planar * radii[0] * radius,
      centre[1] + y * radii[1] * radius,
      centre[2] + Math.sin(angle) * planar * radii[2] * radius,
      Math.max(0, resolve(style.size, radius) * c.rng.range(0.88, 1.14)),
      clamp01(resolve(style.tint, radius) + c.rng.bell() * (style.tintJitter || 0)),
      clamp01(resolve(style.stagger, radius)),
      resolve(style.spin, radius),
      resolve(style.rigidity, radius),
    );
  }
}
