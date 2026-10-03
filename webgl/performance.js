
// Best to worst. The index into this array IS the current rung, so order is
// load-bearing: downgrading is index++.
export const TIER_ORDER = ['high', 'medium', 'low', 'minimal'];

/* The image-quality settings, held constant across every rung on purpose, and
   since 2026-09-27 no longer a limit at all: the canvas is sized to its exact
   device-pixel box (cv-universe.js resize), whatever the ratio or the height.
   dpr and maxHeight stay as explicit no-cap sentinels, so the tier contract's
   mirror (_check_tier_contract.mjs) still computes the frame every rung renders:
   the display's native one. */
const NATIVE = { dpr: Infinity, maxHeight: Infinity, superSample: 1.0 };

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
   threshold off by half a refresh picks the multiple NEAREST the target instead,
   so 144Hz settles on refresh 2 and runs a steady 72fps.

   There is no alternation and no averaging: the caller resets its clock to each
   presented frame, so a given panel locks onto one multiple and stays there.
   60 is the target, not the outcome - the outcome is the achievable rate closest
   to it (144Hz -> 72fps, 165Hz -> 55fps, 100Hz -> 50fps). presentPeriod() below
   is that outcome expressed as a period, and anything judging the machine has to
   judge it against that rather than against 60fps flat.

   Never gate presentation on a multiple of the refresh period. */
export function shouldPresent(sinceLastPresent, vsync) {
  if (!Number.isFinite(vsync) || vsync <= 0) return true;
  return sinceLastPresent >= FRAME_INTERVAL_MS - vsync * 0.5;
}

/* The cadence shouldPresent() will actually produce on a panel of this period:
   the smallest whole number of refreshes that clears the same threshold. Derived
   from FRAME_INTERVAL_MS and vsync exactly as the comparison above is, so the two
   cannot disagree - including at the borderline (90Hz sits on the knife edge, and
   both land on the same side of it). */
export function presentPeriod(vsync) {
  if (!Number.isFinite(vsync) || vsync <= 0) return FRAME_INTERVAL_MS;
  return Math.max(1, Math.ceil(FRAME_INTERVAL_MS / vsync - 0.5)) * vsync;
}

// Bounds on the refresh-period estimate. Anything faster than 2ms is a timing
// artefact, anything slower than 17.5ms is a panel we do not want to chase.
const PERIOD_MIN = 2.0;
const PERIOD_MAX = 17.5;

const VSYNC_GAPS = 128;        // rAF gaps held for the period
const VSYNC_TIMES = 1024;      // gaps held for the fallback grid: ~4 s at 240 Hz
const VSYNC_STAMPS = 128;      // rAF timestamps held for the lock
const VSYNC_EVERY = 16;        // callbacks between estimates...
const VSYNC_BOOT = 32;         // ...but every callback, on the smallest gap, below this many gaps
const VSYNC_SETTLED = 64;      // below this many gaps a rise is believed at once
const VSYNC_RISE = 1.5;        // a rise past this factor has to persist...
const VSYNC_RISE_MS = 2000;    // ...this long, while the stamps still sit on the grid
const VSYNC_HOLD_MS = 1000;    // a good lock outlives failed fits this long
const VSYNC_SNAP = 0.3;        // refreshes of slack for snapping an elapsed time
const VSYNC_QUANT = 0.1;       // ms: the resolution Chrome stamps rAF callbacks to
const VSYNC_SPANS = [24, 48, 96];

/* The display's refresh grid, measured from the rAF callbacks.

   The callbacks land on refresh boundaries, so every gap is a whole number of
   refreshes. Three things are measured from them.

   `period` is the refresh period as the cap and the ladder need it: a hair short
   of the true one (a short estimate can only make a present late, a long one
   makes it early). It is the lower quartile of the last 128 gaps, which a stray
   late/early callback pair cannot drag down the way it dragged the old
   smallest-gap estimate. The quartile is a lattice point, but not always the
   finest one: on a busy machine most gaps are 2 or 3 refreshes and the quartile
   lands on one of those. Two tests take it to the finer lattice (c/2, c/3, c/4)
   the moment the evidence is there. In the gaps: gaps sitting sharply on its odd
   points (a 1-refresh gap under a 2-refresh quartile sits at exactly half),
   against the smooth spread jitter leaves there, and not counting either half of
   a late/early pair. In the stamps (below): a single 1-refresh gap moves every
   later stamp to the other half of a 2-refresh grid, which shows as stamps
   sharply half a grid step off. Until 32 gaps exist the period is the smallest
   gap, so the first frames are capped at once. A rise past 1.5x is believed only
   after 2 s (a busy stretch, not a new display), and only while the stamps still
   sit on the current grid; a fall is believed at once, and two gaps under 0.6 of
   the period, or three under 0.7, fall on the next callback. If they divide the
   period evenly it is a finer lattice on the same display (the end of an
   overload); otherwise the display changed and the rings start over.

   `refresh` and the lock are the grid as time needs it: exact. Chrome stamps a
   callback on the refresh edge, rounded down to 0.1 ms, or late (by anything up
   to nearly a whole refresh, in bursts, on a loaded machine), never early. So the
   on-time stamps trace the grid: a line through them (time against refresh
   index over the last 128 stamps: seeded where most of the newest 24 sit,
   widened in steps, then moved onto the earliest dense cluster, because in a
   burst most of the newest stamps are late) gives the refresh to within about
   0.03% and the phase of its edges. That is the lock. With it, the time between
   two callbacks is counted in whole refreshes from the edges themselves (span):
   a stamp late by 0.9 of a refresh still belongs to its own refresh, where any
   rounding of the elapsed time counts it as the next one, and a present on the
   third refresh that looked like the fourth was exactly the early present the
   old estimators let through. Replayed on the owner's recorded sessions, no
   present comes before the fourth refresh anywhere the stamps can be judged. A
   burst of late stamps can fail a fit without moving the grid, so a good lock
   is kept for 1 s; stamps sharply half a refresh off, two of the last four,
   halve it.

   The jitter's shape is tested, not assumed: a core of on-time stamps as sharp as
   the 0.1 ms resolution, with next to nothing just before it, is Chrome's. Stamp
   jitter that spreads both ways (the synthetic streams; timers that add noise)
   gets a tolerance of five of its standard deviations, and the cap then counts
   leaning late (capSpan): a miscount can only hold a frame back.

   Without a lock (the first 32 callbacks, a display change, heavy noise) the
   elapsed time is snapped to the gap grid, the ratio of the trimmed gaps' time to
   their whole refreshes, as before; the cap reads that snap only when it rounds
   down. The cap's period is the period, the lower decile of the recent gaps and
   17.5 ms, whichever is least: jitter moves the threshold later by half the
   decile's lead, and a period still holding an overload's long gaps cannot let
   the first fast callbacks after it through. */
export class VsyncEstimator {
  constructor() {
    this.gaps = new Float64Array(VSYNC_GAPS);
    this.count = 0;
    this.cursor = 0;
    this.times = new Float64Array(VSYNC_TIMES);
    this.timeCount = 0;
    this.timeCursor = 0;
    this.stamps = new Float64Array(VSYNC_STAMPS);
    this.stampCount = 0;
    this.stampCursor = 0;
    // Scratch, preallocated: the estimate runs 15 times a second at 240 Hz.
    this._sorted = new Float64Array(VSYNC_GAPS);
    this._scratch = new Float64Array(VSYNC_GAPS);
    this._resid = new Float64Array(VSYNC_STAMPS);
    this._hist = new Float64Array(20);
    this._edge = new Float64Array(30);
    this._line_ = { a: 0, s: 1 };
    this._f = { ok: false, T: 0, phi: 0, finer: 0, tol: 0, halfW: 0, lean: 0 };
    this.run = new Float64Array(3);
    this.runLength = 0;
    this.calls = 0;
    this.last = 0;
    // Infinity until a gap exists, which makes shouldPresent a no-op.
    this.period = Infinity;
    this.refresh = Infinity;
    this.capPeriod = Infinity;
    this.decile = Infinity;
    this.pending = 0;
    this.pendingSince = 0;
    // The lock: refresh `lockT`, an edge at `phi`, stamps up to `tol` of a refresh
    // early still count as on time.
    this.locked = false;
    this.lockT = Infinity;
    this.phi = 0;
    this.tol = 0.05;
    this.halfW = 0;
    this.lean = 0;
    this.lockAt = -Infinity;
    this.halfBits = 0;
  }

  // A stopped loop or a hidden tab: the gap across the pause is not a refresh,
  // and the grid may not be the one the display runs now; the next estimate
  // locks again.
  restart() {
    this.last = 0;
    this.runLength = 0;
    this.locked = false;
    this.lockAt = -Infinity;
  }

  /* An elapsed time in whole refreshes: `ms` rounded to the nearest multiple of
     `refresh` when it lies within 0.3 of a refresh of one. Anything else (a
     stall, an odd callback, no estimate yet) passes through unchanged. */
  snap(ms) {
    const r = this.refresh;
    if (!Number.isFinite(r) || r <= 0) return ms;
    const k = Math.round(ms / r);
    return k >= 1 && Math.abs(ms - k * r) <= VSYNC_SNAP * r ? k * r : ms;
  }

  // The time from one callback to another, in whole refreshes: counted on the
  // locked grid, else snapped. What the integrators step by.
  span(from, to) {
    if (this.locked) {
      const k = this._index(to, 0) - this._index(from, 0);
      if (k >= 1) return k * this.lockT;
    }
    return this.snap(to - from);
  }

  // The same, as the cap reads it: it may be counted short, never long.
  capSpan(from, to) {
    if (this.locked) {
      if (!(this.lean > 0)) return this.span(from, to);
      const k = this._index(to, -this.lean) - this._index(from, this.lean);
      if (k >= 1) return k * this.lockT;
    }
    const raw = to - from;
    return Math.min(raw, this.snap(raw));
  }

  sample(now) {
    const last = this.last;
    this.last = now;
    this.calls++;
    this.stamps[this.stampCursor] = now;
    this.stampCursor = (this.stampCursor + 1) % VSYNC_STAMPS;
    this.stampCount = Math.min(this.stampCount + 1, VSYNC_STAMPS);
    if (last) {
      const gap = now - last;
      // Outside 0.5..100 ms is timer noise or a stall, not a refresh.
      if (gap > 0.5 && gap < 100) {
        this._time(gap);
        this._push(gap);
        if (Number.isFinite(this.period) && gap < 0.7 * this.period) {
          this.run[this.runLength++] = gap;
          let short = 0;
          for (let i = 0; i < this.runLength; i++) short = this.run[i] < 0.6 * this.period ? short + 1 : 0;
          if (short >= 2 || this.runLength >= 3) this._fall();
        } else {
          this.runLength = 0;
        }
      }
    }
    if (this.locked && this.halfW > 0) {
      const u = (now - this.phi) / this.lockT;
      const off = 0.5 - Math.abs(u - Math.round(u)) <= this.halfW ? 1 : 0;
      this.halfBits = ((this.halfBits << 1) | off) & 0xf;
      if (bits(this.halfBits) >= 2 && this.lockT / 2 >= PERIOD_MIN) {
        this.lockT /= 2;
        this.refresh = this.lockT;
        this.halfBits = 0;
        if (this.period > 1.5 * this.lockT) this.period /= 2;
      }
    }
    const n = this.count;
    if (n >= 1 && (n < VSYNC_BOOT || this.calls % VSYNC_EVERY === 0)) this._estimate(now);
    this.capPeriod = Math.min(this.period, PERIOD_MAX, this.decile);
    return this.period;
  }

  _index(t, bias) {
    return Math.floor((t - this.phi) / this.lockT + this.tol + bias);
  }

  _push(gap) {
    this.gaps[this.cursor] = gap;
    this.cursor = (this.cursor + 1) % VSYNC_GAPS;
    this.count = Math.min(this.count + 1, VSYNC_GAPS);
  }

  _time(gap) {
    this.times[this.timeCursor] = gap;
    this.timeCursor = (this.timeCursor + 1) % VSYNC_TIMES;
    this.timeCount = Math.min(this.timeCount + 1, VSYNC_TIMES);
  }

  // The i-th gap, oldest first; the i-th stamp, newest first.
  _gap(i) {
    return this.gaps[(this.cursor - this.count + i + VSYNC_GAPS) % VSYNC_GAPS];
  }

  _stamp(i) {
    return this.stamps[(this.stampCursor - 1 - i + VSYNC_STAMPS) % VSYNC_STAMPS];
  }

  // The first k values of `buf` in order: the rest is filled with Infinity so the
  // whole array sorts in place, without a view.
  _prefixSort(buf, k) {
    buf.fill(Infinity, k);
    buf.sort();
    return buf;
  }

  _fall() {
    let sum = 0;
    for (let i = 0; i < this.runLength; i++) sum += this.run[i];
    const gap = sum / this.runLength;
    const m = Math.round(this.period / gap);
    // Gaps that divide the period evenly: a finer lattice on the same display.
    if (m >= 2 && Math.abs(this.period / m - gap) <= 0.1 * gap) {
      this.period /= m;
      this.pending = 0;
      this.runLength = 0;
      if (this.locked) this.lockT /= m;
      if (Number.isFinite(this.refresh)) this.refresh /= m;
      return;
    }
    // A new display: every ring starts over from the gaps that showed it.
    this.count = 0;
    this.cursor = 0;
    this.timeCount = 0;
    this.timeCursor = 0;
    for (let i = 0; i < this.runLength; i++) {
      this._push(this.run[i]);
      this._time(this.run[i]);
    }
    this.stampCount = Math.min(this.stampCount, this.runLength + 1);
    this.runLength = 0;
    this.pending = 0;
    this.period = Infinity;
    this.locked = false;
    this.lockAt = -Infinity;
  }

  _estimate(now) {
    const n = this.count;
    const sorted = this._sorted;
    for (let i = 0; i < n; i++) sorted[i] = this.gaps[i];
    this._prefixSort(sorted, n);
    this.decile = Math.max(PERIOD_MIN, sorted[Math.floor(0.1 * n)]);
    let c;
    if (n < VSYNC_BOOT) {
      c = Math.max(PERIOD_MIN, sorted[0]);
    } else {
      c = Math.max(PERIOD_MIN, sorted[Math.floor(0.25 * n)]);
      c = this._finerByGaps(c, n);
      if (this._fit(this._grid(c)) && this._f.finer) c /= this._f.finer;
    }

    const before = this.period;
    let rise = false;
    if (Number.isFinite(before) && c > VSYNC_RISE * before && n >= VSYNC_SETTLED) {
      // Held back only while the stamps still sit on the current grid: once they
      // have left it the display changed, or a finer lattice no longer holds.
      if (this.stampCount >= VSYNC_BOOT && !(this._fit(this._grid(before)) && this._f.ok)) {
        rise = true;
      } else if (!this.pending) {
        this.pending = c;
        this.pendingSince = now;
      } else if (now - this.pendingSince > VSYNC_RISE_MS) {
        rise = true;
      }
    }
    if (!Number.isFinite(before) || c <= VSYNC_RISE * before || n < VSYNC_SETTLED || rise) {
      this.period = c;
      this.pending = 0;
    }

    // A new grid that is not a multiple of the old one is a new display: the
    // timekeeping ring and the stamps hold the old one.
    let fresh = false;
    if (n >= VSYNC_SETTLED && Number.isFinite(before) && Math.abs(this.period - before) > 0.1 * before) {
      const q = this.period > before ? this.period / before : before / this.period;
      if (Math.abs(q - Math.round(q)) > 0.03 * q) {
        this.timeCount = 0;
        this.timeCursor = 0;
        this.stampCount = Math.min(this.stampCount, 1);
        fresh = true;
      }
    }

    const grid = fresh ? this.period : this._grid(this.period);
    const fitted = !fresh && this._fit(grid);
    const f = this._f;
    if (fitted && f.ok) {
      this.locked = true;
      this.lockT = f.T;
      this.phi = f.phi;
      this.tol = f.tol;
      this.halfW = f.halfW;
      this.lean = f.lean;
      this.lockAt = now;
      this.halfBits = 0;
      this.refresh = f.T;
    } else if (this.locked && fitted && !f.finer && now - this.lockAt <= VSYNC_HOLD_MS &&
      Math.abs(f.T - this.lockT) < 0.01 * this.lockT) {
      // A burst of late stamps fails the fit, not the grid.
      this.refresh = this.lockT;
    } else {
      this.locked = false;
      this.lockAt = -Infinity;
      this.refresh = grid;
    }
  }

  // Gaps sharply on the odd points of c/m (and not half of a late/early pair)
  // make c/m the lattice. Measured against the cluster's centre, not its lower
  // quartile, which would tip the cluster's upper tail into the test's flanks.
  _finerByGaps(c, n) {
    const s = this._scratch;
    let k = 0;
    for (let i = 0; i < n; i++) {
      const g = this.gaps[i];
      if (g >= 0.8 * c && g <= 1.3 * c) s[k++] = g;
    }
    const centre = k >= 8 ? this._prefixSort(s, k)[k >> 1] : c;
    k = 0;
    for (let i = 0; i < n; i++) {
      const x = this.gaps[i] / centre;
      const r = Math.abs(x - Math.round(x));
      if (Math.round(x) >= 1 && r < 0.25) s[k++] = r;
    }
    const mad = k ? this._prefixSort(s, k)[k >> 1] * 1.4826 : 0.05;
    const w = Math.min(0.12, Math.max(0.03, 2.5 * mad));
    for (let m = 4; m >= 2; m--) {
      if (centre / m < PERIOD_MIN) continue;
      let hit = 0;
      let flank = 0;
      for (let i = 0; i < n; i++) {
        const g = this._gap(i);
        const x = g / centre;
        if (x > 8.5 || x < 0.5 / m || onLattice(g, centre, w)) continue;
        if ((i > 0 && onLattice(this._gap(i - 1) + g, centre, w)) ||
          (i < n - 1 && onLattice(g + this._gap(i + 1), centre, w))) continue;
        const d = oddDistance(x - Math.round(x), m);
        if (d <= w) hit++;
        else if (d <= 3 * w) flank++;
      }
      if (hit >= Math.max(4, 0.03 * n) && hit >= 2 * flank) return c / m;
    }
    return c;
  }

  /* The fallback grid: the trimmed gaps' time over their whole refreshes, seeded
     at the median of the gaps near p and iterated until it stops moving (a seed
     off-centre would otherwise truncate the jitter unevenly). */
  _grid(p) {
    let grid = p;
    const s = this._scratch;
    let k = 0;
    for (let i = 0; i < this.count; i++) {
      const g = this.gaps[i];
      if (g > 0.6 * p && g < 1.4 * p) s[k++] = g;
    }
    if (k >= 8) grid = this._prefixSort(s, k)[k >> 1];
    for (let pass = 0; pass < 8; pass++) {
      let span = 0;
      let ticks = 0;
      for (let i = 0; i < this.timeCount; i++) {
        const g = this.times[i];
        const m = Math.round(g / grid);
        if (m < 1 || m > 8 || Math.abs(g - m * grid) > 0.25 * grid) continue;
        span += g;
        ticks += m;
      }
      if (!ticks) break;
      const next = span / ticks;
      const done = Math.abs(next - grid) < 1e-4 * grid;
      grid = next;
      if (done) break;
    }
    return grid;
  }

  // Regress stamp time on refresh index over the stamps whose residual lies in
  // [lo, hi] of a refresh, and leave every residual in this._resid.
  _line(ref, T0, fit, lo, hi, n) {
    let S0 = 0;
    let S1 = 0;
    let S2 = 0;
    let Sx = 0;
    let Skx = 0;
    for (let i = 0; i < n; i++) {
      const x = (this._stamp(i) - ref) / T0;
      const k = Math.round((x - fit.a) / fit.s);
      const d = (x - fit.a - k * fit.s) / fit.s;
      if (d >= lo && d <= hi) {
        S0++;
        S1 += k;
        S2 += k * k;
        Sx += x;
        Skx += k * x;
      }
    }
    const den = S0 * S2 - S1 * S1;
    if (S0 < 8 || !(den > 0)) return false;
    fit.s = (S0 * Skx - S1 * Sx) / den;
    fit.a = (Sx - fit.s * S1) / S0;
    return true;
  }

  _residuals(ref, T0, fit, N) {
    for (let i = 0; i < N; i++) {
      const x = (this._stamp(i) - ref) / T0;
      const k = Math.round((x - fit.a) / fit.s);
      this._resid[i] = (x - fit.a - k * fit.s) / fit.s;
    }
  }

  // Symmetric jitter's spread: the early side, trimmed of its widest fifth (a
  // stray tail) and scaled back to a standard deviation. Robust to timestamps
  // rounded onto a handful of values, where a median collapses to zero.
  _spread(N) {
    const s = this._scratch;
    let k = 0;
    for (let i = 0; i < N; i++) {
      const d = this._resid[i];
      if (d <= 0 && d > -0.45) s[k++] = -d;
    }
    if (!k) return 0.01;
    this._prefixSort(s, k);
    const m = Math.max(1, Math.floor(0.8 * k));
    let ss = 0;
    for (let i = 0; i < m; i++) ss += s[i] * s[i];
    return Math.max(0.005, 1.513 * Math.sqrt(ss / m));
  }

  /* Lock the stamps to a grid near T0. Returns false when too few stamps sit near
     it to fit a line at all; otherwise fills this._f. */
  _fit(T0) {
    const N = this.stampCount;
    if (!Number.isFinite(T0) || N < VSYNC_BOOT) return false;
    const ref = this._stamp(0);
    const h = this._hist;
    h.fill(0);
    const seed = Math.min(N, VSYNC_SPANS[0]);
    for (let i = 0; i < seed; i++) {
      const x = (this._stamp(i) - ref) / T0;
      h[Math.floor((x - Math.floor(x)) * 20) % 20]++;
    }
    let best = -1;
    let b = 0;
    for (let i = 0; i < 20; i++) {
      const v = h[(i + 19) % 20] + 2 * h[i] + h[(i + 1) % 20];
      if (v > best) {
        best = v;
        b = i;
      }
    }
    const fit = this._line_;
    fit.a = (b + 0.5) / 20;
    fit.s = 1;
    for (let i = 0; i <= VSYNC_SPANS.length; i++) {
      const n = i < VSYNC_SPANS.length ? Math.min(VSYNC_SPANS[i], N) : N;
      if (!this._line(ref, T0, fit, -0.15, 0.15, n)) return false;
      if (n === N) break;
    }
    this._residuals(ref, T0, fit, N);
    const d = this._resid;

    // Onto the refresh edge: the earliest bin holding most of the peak density.
    // The newest stamps seed the fit, and in a burst most of them are late, so
    // the line can settle a little after the edge; the edge is where the stamps
    // begin, not where most of the newest ones sit.
    const H = this._edge;
    H.fill(0);
    for (let i = 0; i < N; i++) {
      const bin = Math.floor((d[i] + 0.3) / 0.02);
      if (bin >= 0 && bin < 30) H[bin]++;
    }
    let peak = 0;
    for (let i = 0; i < 30; i++) peak = Math.max(peak, H[i]);
    let edge = 0;
    while (edge < 30 && H[edge] < 0.7 * peak) edge++;
    const shift = (edge + 0.5) * 0.02 - 0.3;
    if (Math.abs(shift) > 0.02) {
      fit.a += shift * fit.s;
      this._line(ref, T0, fit, -0.05, 0.03, N);
      this._residuals(ref, T0, fit, N);
    }

    // Chrome's shape: a core as sharp as the timestamps' resolution, and almost
    // nothing just before it.
    const core = Math.max(0.03, 0.6 * VSYNC_QUANT / (T0 * fit.s) + 0.01);
    let inCore = 0;
    let before = 0;
    for (let i = 0; i < N; i++) {
      if (Math.abs(d[i]) <= core) inCore++;
      else if (d[i] < -core && d[i] >= -core - 0.1) before++;
    }
    const sharp = inCore >= 0.3 * N && inCore >= 0.97 * (inCore + before);
    let sigma;
    let tol;
    let win;
    let halfW;
    if (sharp) {
      // The line through the core itself, with more room early: stamps round down.
      this._line(ref, T0, fit, -core, 0.5 * core, N);
      this._residuals(ref, T0, fit, N);
      let ss = 0;
      let c = 0;
      for (let i = 0; i < N; i++) {
        if (Math.abs(d[i]) <= core) {
          ss += d[i] * d[i];
          c++;
        }
      }
      sigma = c ? Math.sqrt(ss / c) : 0.01;
      tol = Math.max(0.05, core);
      win = core;
      halfW = core;
    } else {
      sigma = this._spread(N);
      const w = Math.max(3 * sigma, 0.02);
      this._line(ref, T0, fit, -w, w, N);
      this._residuals(ref, T0, fit, N);
      sigma = this._spread(N);
      tol = Math.min(0.5, Math.max(0.05, 5 * sigma));
      win = Math.max(0.075, 3 * sigma);
      halfW = sigma <= 0.05 ? Math.max(0.03, 3 * sigma) : 0;
    }
    let on = 0;
    let early = 0;
    for (let i = 0; i < N; i++) {
      if (Math.abs(d[i]) <= win) on++;
      else if (d[i] < -tol) early++;
    }
    // A finer lattice: stamps sharply on the odd points of T/m.
    let finer = 0;
    if (halfW > 0) {
      for (let m = 4; m >= 2 && !finer; m--) {
        if (T0 * fit.s / m < PERIOD_MIN) continue;
        let hit = 0;
        let flank = 0;
        for (let i = 0; i < N; i++) {
          const q = oddDistance(d[i], m);
          if (q <= halfW) hit++;
          else if (q <= 3 * halfW) flank++;
        }
        if (hit >= Math.max(3, 0.03 * N) && hit >= 2 * flank) finer = m;
      }
    }
    const f = this._f;
    f.ok = !finer && sigma <= 0.25 && on >= 0.4 * N && early <= 0.15 * N;
    f.T = T0 * fit.s;
    f.phi = ref + fit.a * T0;
    f.finer = finer;
    f.tol = tol;
    f.halfW = halfW;
    f.lean = sharp ? 0 : Math.max(0, Math.min(0.2, tol - 0.3));
    return true;
  }
}

function bits(v) {
  let c = 0;
  for (let b = v; b; b &= b - 1) c++;
  return c;
}

function onLattice(s, c, w) {
  const x = s / c;
  const k = Math.round(x);
  return k >= 1 && Math.abs(x - k) <= w;
}

// Distance of a residual (in lattice units, [-0.5, 0.5]) to the nearest odd point
// of the lattice c/m: 1/2 for m = 2, +-1/3 for m = 3, +-1/4 for m = 4.
function oddDistance(r, m) {
  let d = Infinity;
  for (let j = 1; j < m; j++) {
    if (m > 2 && m % 2 === 0 && 2 * j === m) continue;
    let p = j / m;
    if (p > 0.5) p -= 1;
    d = Math.min(d, Math.abs(r - p), Math.abs(r + p));
  }
  return d;
}

const WINDOW = 120;      // frame times held for percentiles, about 2s at 60fps
const MIN_SAMPLES = 24;  // do not judge anything on less than this
const EVAL_MS = 300;     // how often the percentiles are recomputed
const COOLDOWN_MS = 5000;

const COMFORT_MS = 1000 / 60;

// The slowest presented cadence we are willing to read as "this is just what the
// panel does" rather than "this machine is in trouble". 22.5ms is ~44fps, which
// covers every real slow panel once the cap has quantised it - 45Hz and 90Hz both
// land on 22.2ms, 48Hz and 96Hz on 20.8ms, 50Hz and 100Hz on 20.0ms.
//
// It has to stay below 60Hz-dropping-every-other-frame (33.3ms), because that is
// what an overloaded machine looks like: rAF stops firing on every boundary, the
// period estimate rises with the load, and a budget that followed it there would
// excuse the very slowness the ladder exists to fix.
const CADENCE_MAX = 22.5;

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

  sample(dtMs, now, vsync) {
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
    /* Never demand better than 60fps of a slow panel, and never demand better
       than the panel can physically deliver.

       The second half of that is why the cap's own cadence is the reference and
       not the frame times. Presented deltas are quantised to whole refreshes, so
       on a 100Hz panel the only cadences the cap can produce are 10ms and 20ms,
       and it picks 20ms. Judging that against 16.7ms leaves the ratio at 1.14 -
       inside the dead band, which clears goodStreak every window, so a session
       that ever dropped a rung could never climb back no matter how idle the
       machine went. Same arithmetic parked 45, 48, 50, 90 and 96Hz.

       vsync is the VsyncEstimator's period (the lower quartile of the recent rAF
       gaps, taken to the finest lattice they show); without it we fall back to
       the observed period, which is what the offline harnesses that drive
       sample() directly still get. */
    const cadence = Number.isFinite(vsync) && vsync > 0
      ? Math.min(CADENCE_MAX, presentPeriod(vsync))
      : period;
    const budget = Math.max(COMFORT_MS, cadence);
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
