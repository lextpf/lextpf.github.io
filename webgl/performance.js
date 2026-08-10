
// Best to worst. The index into this array IS the current rung, so order is
// load-bearing: downgrading is index++.
export const TIER_ORDER = ['high', 'medium', 'low', 'minimal'];

// The image-quality settings, held constant across every rung on purpose.
const NATIVE = { dpr: 1.75, maxHeight: 2560, superSample: 1.0 };

export const TIERS = Object.freeze({
  high: {
    ...NATIVE, count: 100000, bloomLevels: 3, trails: false, parallax: 1,
  },
  medium: {
    ...NATIVE, count: 68000, bloomLevels: 3, trails: false, parallax: 1,
  },
  low: {
    ...NATIVE, count: 50000, bloomLevels: 2, trails: false, parallax: 0.6,
  },
  minimal: {
    ...NATIVE, count: 37000, bloomLevels: 1, trails: false, parallax: 0,
  },
});

/* Guess a starting rung before a single frame has been drawn.

   This is only a guess, and it is deliberately pessimistic: the sampler below
   can climb back up if it was wrong, but it can only climb as high as whatever
   this returns (see `ceiling`). Starting too high and visibly falling is a worse
   first impression than starting one rung low. */
export function detectTier(gl) {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const narrow = Math.min(innerWidth, innerHeight) < 620;
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory;

  // The GPU name, where the browser is willing to say. Often it is not, which is
  // why this is one signal among several rather than the whole decision.
  let renderer = '';
  try {
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
  } catch (_) {
    renderer = '';
  }
  const software = /swiftshader|basic render|software|llvmpipe/i.test(renderer);

  // No GPU at all: everything is running on the CPU. Straight to the bottom.
  if (software) return 'minimal';
  if (coarse || narrow) return cores >= 8 ? 'low' : 'minimal';
  if (typeof memory === 'number' && memory > 0 && memory < 4) return 'low';
  if (cores <= 4) return 'low';
  // Integrated graphics: capable, but not of 100k additive-blended points.
  if (/intel|uhd graphics|iris|hd graphics|vega \d|radeon r5|mali|adreno/i.test(renderer)) {
    return 'medium';
  }
  return 'high';
}

export const TARGET_FPS = 60;
export const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;

/* The frame cap. Should this frame be presented, or skipped?

   Targeting 60 rather than whatever the panel offers is a choice: at 144fps the
   animation does not look better, it just burns three times the power and drags
   the ladder down a rung for no visible gain.

   The `vsync * 0.5` slack is the part that matters. requestAnimationFrame only
   fires on refresh boundaries, so the achievable rates are the panel period
   divided by an integer, and a naive `since >= 16.7` picks the first multiple at
   or beyond the target rather than the nearest one. On a 144Hz panel (6.94ms per
   refresh) refresh 2 lands at 13.9ms and gets rejected, so it can only ever
   present on refresh 3 at 20.8ms: a locked 48fps, and a visible beat. Backing the
   threshold off by half a refresh lets it alternate between refresh 2 and 3 and
   average out at 60.

   Never gate presentation on a multiple of the refresh period. */
export function shouldPresent(sinceLastPresent, vsync) {
  if (!Number.isFinite(vsync) || vsync <= 0) return true;
  return sinceLastPresent >= FRAME_INTERVAL_MS - vsync * 0.5;
}

const WINDOW = 120;      // frame times held for percentiles, about 2s at 60fps
const MIN_SAMPLES = 24;  // do not judge anything on less than this
const EVAL_MS = 300;     // how often the percentiles are recomputed
const COOLDOWN_MS = 5000;

// Bounds on the refresh-period estimate. Anything faster than 2ms is a timing
// artefact, anything slower than 17.5ms is a panel we do not want to chase.
const PERIOD_MIN = 2.0;
const PERIOD_MAX = 17.5;

const COMFORT_MS = 1000 / 60;

// Asymmetric on purpose: the gap between them is a dead band where nothing
// happens, which is what stops a device sitting exactly on budget from
// ping-ponging between two rungs.
const DOWNGRADE_AT = 1.4;
const UPGRADE_AT = 1.1;
const BAD_WINDOWS = 3;   // drop fast, three bad windows is under a second
const GOOD_WINDOWS = 5;  // climb slowly
const MAX_ATTEMPTS = 2;  // give up on a rung after this many failures

export class PerformanceManager {
  constructor(initialTier, onChange) {
    // The boot guess is a hard ceiling, not a starting point. If detectTier said
    // "medium" then medium is the best this session will ever run.
    this.ceiling = TIER_ORDER.indexOf(initialTier);
    this.index = this.ceiling;
    this.onChange = onChange;
    // Ring buffer plus a scratch copy to sort. Both preallocated: sorting into a
    // fresh array 3 times a second would be steady garbage-collector pressure.
    this.samples = new Float32Array(WINDOW);
    this._sorted = new Float32Array(WINDOW);
    this.filled = 0;
    this.cursor = 0;
    this.goodStreak = 0;
    this.badStreak = 0;
    this.lastChange = 0;
    this.lastEval = 0;
    // How many times each rung has been fallen out of. Persists across changes,
    // unlike the streaks, so the ladder remembers what it has already tried.
    this.failures = new Uint8Array(TIER_ORDER.length);
    this.stats = { avg: 0, p50: 0, p95: 0, p99: 0, worst: 0, period: 16.7, budget: COMFORT_MS };
  }

  get tier() {
    return TIER_ORDER[this.index];
  }

  get settings() {
    return TIERS[this.tier];
  }

  // Called after every rung change. A new rung has to be judged on frames it
  // actually produced, not on the ones that got it demoted.
  reset() {
    this.filled = 0;
    this.cursor = 0;
    this.goodStreak = 0;
    this.badStreak = 0;
    this.lastEval = 0;
  }

  sample(dtMs, now) {
    // Anything over 250ms is a stall, not a slow frame: a backgrounded tab, a
    // debugger pause, the compositor blocking. Including it would poison the
    // percentiles and demote a machine that is running fine.
    if (dtMs <= 0 || dtMs > 250) return;
    this.samples[this.cursor] = dtMs;
    this.cursor = (this.cursor + 1) % WINDOW;
    this.filled = Math.min(this.filled + 1, WINDOW);
    if (this.filled < MIN_SAMPLES) return;
    if (this.lastEval && now - this.lastEval < EVAL_MS) return;
    this.lastEval = now;

    const n = this.filled;
    const sorted = this._sorted.subarray(0, n);
    sorted.set(this.samples.subarray(0, n));
    sorted.sort();
    let total = 0;
    for (let i = 0; i < n; i++) total += sorted[i];
    const at = (p) => sorted[Math.min(n - 1, Math.floor(n * p))];

    const stats = this.stats;
    stats.avg = total / n;
    stats.p50 = at(0.5);
    stats.p95 = at(0.95);
    stats.p99 = at(0.99);
    stats.worst = sorted[n - 1];
    // The fastest frame observed is the best available estimate of the panel's
    // refresh period: no frame can be quicker than one refresh.
    const period = Math.min(PERIOD_MAX, Math.max(PERIOD_MIN, sorted[0]));
    stats.period = period;
    // Never demand better than 60fps of a slow panel, and never demand better
    // than the panel can physically deliver.
    const budget = Math.max(COMFORT_MS, period);
    stats.budget = budget;

    // Judged on the median, not the average: one 80ms hitch should not demote a
    // machine that is otherwise comfortable.
    const typical = stats.p50;
    if (typical > budget * DOWNGRADE_AT) {
      this.badStreak++;
      this.goodStreak = 0;
    } else if (typical < budget * UPGRADE_AT) {
      this.goodStreak++;
      this.badStreak = 0;
    } else {
      // In the dead band. Clear both, so a run of ambiguous windows never
      // accumulates into a change.
      this.badStreak = 0;
      this.goodStreak = 0;
    }

    if (now - this.lastChange < COOLDOWN_MS) return;

    // Downgrading is unconditional, and records the failure against the rung
    // being left so the climb logic below can remember it later.
    if (this.badStreak >= BAD_WINDOWS && this.index < TIER_ORDER.length - 1) {
      this.failures[this.index] = Math.min(255, this.failures[this.index] + 1);
      this.index++;
      this.lastChange = now;
      this.reset();
      this.onChange(this.tier, stats);
      return;
    }

    // Climbing has to get past all three brakes.
    const next = this.index - 1;
    if (this.goodStreak < GOOD_WINDOWS || next < this.ceiling) return;
    if (this.failures[next] >= MAX_ATTEMPTS) return;
    // Each past failure makes the next attempt cost more evidence: 5 good
    // windows, then 20, then never.
    if (this.goodStreak < GOOD_WINDOWS * (1 + 3 * this.failures[next])) return;

    this.index = next;
    this.lastChange = now;
    this.reset();
    this.onChange(this.tier, stats);
  }
}
