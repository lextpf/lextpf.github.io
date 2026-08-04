
export const TIER_ORDER = ['high', 'medium', 'low', 'minimal'];

export const TIERS = Object.freeze({
  high: {
    count: 100000, dpr: 1.75, superSample: 1.0, bloomLevels: 3,
    trails: false, parallax: 1,
  },
  medium: {
    count: 100000, dpr: 1.65, superSample: 1.0, bloomLevels: 3,
    trails: false, parallax: 1,
  },
  low: {
    count: 100000, dpr: 1.4, superSample: 1.0, bloomLevels: 2,
    trails: false, parallax: 0.6,
  },
  minimal: {
    count: 100000, dpr: 1.15, superSample: 0.9, bloomLevels: 1,
    trails: false, parallax: 0,
  },
});

export function detectTier(gl) {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const narrow = Math.min(innerWidth, innerHeight) < 620;
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory;

  let renderer = '';
  try {
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
  } catch (_) {
    renderer = '';
  }
  const software = /swiftshader|basic render|software|llvmpipe/i.test(renderer);

  if (software) return 'minimal';
  if (coarse || narrow) return cores >= 8 ? 'low' : 'minimal';
  if (typeof memory === 'number' && memory > 0 && memory < 4) return 'low';
  if (cores <= 4) return 'low';
  if (/intel|uhd graphics|iris|hd graphics|vega \d|radeon r5|mali|adreno/i.test(renderer)) {
    return 'medium';
  }
  return 'high';
}

const WINDOW = 120;
const COOLDOWN_MS = 4000;

export class PerformanceManager {
  constructor(initialTier, onChange) {
    this.ceiling = TIER_ORDER.indexOf(initialTier);
    this.index = this.ceiling;
    this.onChange = onChange;
    this.samples = new Float32Array(WINDOW);
    this.filled = 0;
    this.cursor = 0;
    this.goodStreak = 0;
    this.lastChange = 0;
    this.stats = { avg: 0, p95: 0, p99: 0, worst: 0 };
    this._sorted = new Float32Array(WINDOW);
  }

  get tier() {
    return TIER_ORDER[this.index];
  }

  get settings() {
    return TIERS[this.tier];
  }

  sample(dtMs, now) {
    if (dtMs <= 0 || dtMs > 250) return;
    this.samples[this.cursor] = dtMs;
    this.cursor = (this.cursor + 1) % WINDOW;
    this.filled = Math.min(this.filled + 1, WINDOW);
    if (this.filled < WINDOW || this.cursor % 30 !== 0) return;

    const sorted = this._sorted;
    sorted.set(this.samples);
    Array.prototype.sort.call(sorted, (a, b) => a - b);
    let total = 0;
    for (let i = 0; i < WINDOW; i++) total += sorted[i];
    const stats = this.stats;
    stats.avg = total / WINDOW;
    stats.p95 = sorted[Math.floor(WINDOW * 0.95)];
    stats.p99 = sorted[Math.floor(WINDOW * 0.99)];
    stats.worst = sorted[WINDOW - 1];

    if (now - this.lastChange < COOLDOWN_MS) return;

    if (stats.p95 > 30 && stats.avg > 16 && this.index < TIER_ORDER.length - 1) {
      this.index++;
      this.goodStreak = 0;
      this.lastChange = now;
      this.onChange(this.tier, stats);
      return;
    }

    if (stats.p95 < 14.5) {
      this.goodStreak++;
      if (this.goodStreak >= 5 && this.index > this.ceiling) {
        this.index--;
        this.goodStreak = 0;
        this.lastChange = now;
        this.onChange(this.tier, stats);
      }
    } else {
      this.goodStreak = 0;
    }
  }
}
