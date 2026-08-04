
export const MODE = Object.freeze({
  STILL: 0,
  SPIN_Y: 1,
  FLOW_Z: 2,
  SPIN_Z: 3,
  ROCK_Y: 4,
  ACCRETION: 5,
  SPIN_X: 6,
  OUTFLOW: 7,
  ORBIT: 8,
});

export const TOUCH = Object.freeze({
  REPEL: 0,
  SWIRL: 1,
  ATTRACT: 2,
  DENT: 3,
  GUST: 4,
  RIPPLE: 5,
  IONIZE: 6,
  SURGE: 7,
  BURST: 8,
  PULSE: 9,
  STATIC: 10,
  FLARE: 11,
  SCRAMBLE: 12,
});

export const ORBIT_PLANETS = Object.freeze([
  { R: 12.5, phase: 2.7, rate: 0.16, depth: 5.6, width: 4.2, body: 2.9 },
  { R: 18.0, phase: 5.84, rate: 0.16, depth: 4.2, width: 3.3, body: 2.0 },
  { R: 27.5, phase: 0.9, rate: 0.125, depth: 2.2, width: 2.3, body: 1.25 },
  { R: 37.5, phase: 5.5, rate: 0.085, depth: 1.3, width: 1.7, body: 0.95 },
]);

export const orbitSatelliteSpin = (planetIndex, rate) => 100 + planetIndex * 10 + rate;

export const NUCLEUS_SHELLS = Object.freeze([
  { axis: [0, 1, 0], rate: 0.6 },
  { axis: [0, 0.4226, 0.9063], rate: -0.42 },
  { axis: [0.8829, 0.4695, 0], rate: 0.3 },
  { axis: [-0.7295, 0.4997, 0.4597], rate: 0.5 },
  { axis: [0.3497, 0.3497, -0.8692], rate: -0.34 },
  { axis: [-0.5507, 0.7209, -0.4205], rate: 0.46 },
  { axis: [0.6194, 0.1998, 0.7592], rate: -0.55 },
  { axis: [-0.15, 0.8997, 0.4099], rate: 0.38 },
]);
export const nucleusOrbitSpin = (shell, rate) => 200 + shell * 10 + 5 + rate;

export const BIPOLAR_PLUME = Object.freeze({
  start: 3.25,
  end: 37.0,
  spin: 0.065,
});

export const ACCRETION = Object.freeze({
  jetThreshold: 4.0,
  jetStart: BIPOLAR_PLUME.start,
  jetSpan: BIPOLAR_PLUME.end - BIPOLAR_PLUME.start,
  infallIn: 6.6,
  infallSpan: 32.0,
  infallSpeed: 2.1,
});

export const OUTFLOW = Object.freeze({
  ejectStart: 1.2,
  ejectSpan: 49.0,
  ejectSpeed: 3.6,
});

export const TUNNEL = Object.freeze({ zMin: -220, length: 260 });
