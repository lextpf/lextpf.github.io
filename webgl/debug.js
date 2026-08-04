import { STATE_KEYS } from './chapters.js';
import { GENERATORS } from './formations/index.js';

const CONTROLS = [
  ['morph', 0, 1, 0.01],
  ['size', 0.2, 3, 0.01],
  ['opacity', 0, 1, 0.01],
  ['noise', 0, 3, 0.01],
  ['noiseScale', 0.005, 0.2, 0.001],
  ['noiseSpeed', 0, 0.5, 0.005],
  ['arc', 0, 20, 0.1],
  ['stagger', 0, 0.9, 0.01],
  ['clockRate', 0, 4, 0.01],
  ['camX', -80, 80, 0.5],
  ['camY', -60, 60, 0.5],
  ['camZ', -200, 160, 0.5],
  ['tgtX', -60, 60, 0.5],
  ['tgtY', -60, 60, 0.5],
  ['tgtZ', -160, 60, 0.5],
  ['fov', 18, 90, 0.5],
  ['accent', 0, 1, 0.01],
  ['warm', 0, 1, 0.01],
  ['bloom', 0, 2, 0.01],
  ['bloomThreshold', 0, 2, 0.01],
  ['bloomRadius', 0.2, 3, 0.05],
  ['bloomTight', 0, 2, 0.05],
  ['bloomWide', 0, 2, 0.05],
  ['anamorphic', 0, 1, 0.01],
  ['trail', 0, 0.8, 0.01],
  ['dirt', 0, 0.5, 0.01],
  ['haze', 0, 0.6, 0.005],
  ['hazeScale', 0.1, 1.5, 0.01],
  ['hazeMix', 0, 1, 0.01],
  ['fogNear', 1, 120, 1],
  ['fogFar', 40, 500, 2],
  ['fogTint', 0, 1, 0.01],
  ['focus', 1, 200, 1],
  ['focusRange', 5, 300, 1],
  ['dof', 0, 2, 0.01],
  ['bokeh', 0, 1, 0.01],
  ['pulse', 0, 2, 0.01],
  ['pulseRate', 0, 1, 0.005],
  ['streak', 0, 2, 0.05],
  ['vortex', 0, 1, 0.01],
  ['pinch', 0, 1, 0.01],
  ['pulseWidth', 0.2, 6, 0.05],
  ['narrowPull', 0.8, 2.5, 0.01],
  ['lens', 0, 3, 0.01],
  ['horizon', 0, 3, 0.01],
  ['ring', 0, 3, 0.01],
  ['chroma', 0, 2, 0.01],
  ['exposure', 0.2, 2.5, 0.01],
  ['temp', -1, 1, 0.01],
  ['sat', 0.4, 1.6, 0.01],
  ['contrast', 0.7, 1.5, 0.01],
  ['lift', 0, 0.06, 0.001],
  ['grain', 0, 0.08, 0.001],
  ['vignette', 0, 1, 0.01],
  ['loud', 0, 1, 0.01],
];

const HINTS = {
  morph: 'Blend between this chapter’s formation (0) and the next (1)',
  size: 'Global particle size multiplier',
  opacity: 'Overall universe opacity',
  noise: 'Curl-noise wobble amplitude — free dust moves most, structure barely',
  noiseScale: 'Noise field frequency — smaller = broader, calmer swells',
  noiseSpeed: 'How fast the noise field drifts over time',
  arc: 'How far morph flights bow sideways in transit',
  stagger: 'Per-particle timing spread of a morph — 0 = everyone at once',
  clockRate: 'Master speed of formation motion (orbits, flows, infall)',
  camX: 'Camera position X', camY: 'Camera position Y', camZ: 'Camera position Z',
  tgtX: 'Camera look-at X', tgtY: 'Camera look-at Y', tgtZ: 'Camera look-at Z',
  fov: 'Camera field of view — lower = telephoto compression',
  accent: 'How strongly tinted particles pull toward the accent blue',
  warm: 'Warm color mix near the formation core (amber)',
  bloom: 'Overall bloom strength',
  bloomThreshold: 'Brightness where bloom begins — lower = more things glow',
  bloomRadius: 'Bloom blur radius',
  bloomTight: 'Tight bloom octave — crisp halo around bright cores',
  bloomWide: 'Widest bloom octave — atmospheric glow, slightly cool',
  anamorphic: 'Horizontal streak bloom, cinema-lens style',
  trail: 'Temporal trail persistence — motion smear (0 = crisp)',
  dirt: 'Lens-dirt response to bright areas',
  haze: 'Volumetric haze amount',
  hazeScale: 'Haze cell size',
  hazeMix: 'Haze color: 0 neutral white → 1 accent blue',
  fogNear: 'Depth fog start (world units from camera)',
  fogFar: 'Depth fog end — beyond this, particles fade out',
  fogTint: 'How much distant particles take the fog color',
  focus: 'Focal distance (world units)',
  focusRange: 'Depth of the sharp zone around focus',
  dof: 'Defocus strength outside the focus range',
  bokeh: 'Iris shaping of defocused points (hex bokeh)',
  pulse: 'Brightness of travelling energy pulses',
  pulseRate: 'How often pulses fire',
  pulseWidth: 'Pulse band thickness',
  streak: 'Motion-aligned exposure streaks — movement draws as light',
  vortex: 'Wormhole→black hole choreography: ride out, black, genesis infall',
  pinch: 'Routes morph flights through the singularity — flash and erupt',
  narrowPull: 'Composition tightening on narrow viewports',
  lens: 'Gravitational lensing warp (black hole chapters)',
  horizon: 'Event-horizon darkening',
  ring: 'Photon-ring brightness at the horizon',
  chroma: 'Chromatic fringing toward frame edges',
  exposure: 'Scene exposure before the filmic curve',
  temp: 'Color temperature: − cool / + warm',
  sat: 'Saturation',
  contrast: 'Contrast around mid gray',
  lift: 'Black floor lift — raises the darkest tones',
  grain: 'Film grain amount (luma-shaped, silent in blacks)',
  vignette: 'Edge darkening',
  loud: 'How far the page text steps back this chapter',
};

const RAW = {
  noise: 0, bloom: 0, haze: 0, dirt: 0, trail: 0, chroma: 0, lens: 0,
  grain: 0, vignette: 0.15, dof: 0, fogTint: 0, exposure: 1, temp: 0,
  sat: 1, contrast: 1, clockRate: 0, opacity: 1, morph: 0, pulse: 0,
};

export function mountDebugPanel(experience) {
  const panel = document.createElement('div');
  panel.setAttribute('data-universe-debug', '');
  panel.style.cssText = `
    position:fixed; top:0; left:0; z-index:9999; width:17rem; max-height:100vh;
    overflow:auto; padding:.75rem; background:rgba(6,6,8,.92); color:#F4F4F5;
    font:11px/1.5 ui-monospace,Menlo,Consolas,monospace; letter-spacing:.04em;
    border-right:1px solid rgba(255,255,255,.14); backdrop-filter:blur(6px);`;

  const readout = document.createElement('div');
  readout.style.cssText = 'margin-bottom:.5rem;color:#9CC2FF;white-space:pre;';
  panel.appendChild(readout);

  const overrides = {};
  experience.overrides = overrides;
  const review = { scene: null };

  const button = (label, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText =
      'padding:.3rem .4rem;background:none;color:#9CC2FF;border:1px solid rgba(255,255,255,.2);font:inherit;cursor:pointer;';
    b.addEventListener('click', onClick);
    return b;
  };

  const sliders = new Map();
  const setOverride = (key, value) => {
    overrides[key] = value;
    const row = sliders.get(key);
    if (row) {
      row.input.value = value;
      row.value.textContent = Number(value).toFixed(2);
    }
  };

  const reviewBox = document.createElement('div');
  reviewBox.style.cssText = 'display:grid;gap:.3rem;margin-bottom:.6rem;';
  const heading = document.createElement('div');
  heading.textContent = 'formation review';
  heading.style.cssText = 'color:#A0A0A6;';
  reviewBox.appendChild(heading);

  const picker = document.createElement('select');
  picker.style.cssText = 'width:100%;background:#111;color:#F4F4F5;border:1px solid rgba(255,255,255,.2);font:inherit;padding:.25rem;';
  const off = document.createElement('option');
  off.value = '';
  off.textContent = '— follow scroll —';
  picker.appendChild(off);
  Object.keys(GENERATORS).forEach((id) => {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = id;
    picker.appendChild(option);
  });
  picker.addEventListener('change', () => {
    review.scene = picker.value || null;
    experience.review = review.scene ? review : null;
  });
  reviewBox.appendChild(picker);

  const row = document.createElement('div');
  row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:.3rem;';
  const btnRaw = button('raw shape', () => Object.entries(RAW).forEach(([k, v]) => setOverride(k, v)));
  btnRaw.title = 'Strip all post-processing and motion — bare formation geometry';
  const btnFx = button('effects on', () => {
    Object.keys(RAW).forEach((k) => {
      delete overrides[k];
      const s = sliders.get(k);
      if (s) s.value.textContent = '—';
    });
  });
  btnFx.title = 'Restore the full rendering pipeline';
  const btnFreeze = button('freeze time', () => setOverride('clockRate', 0));
  btnFreeze.title = 'Stop all formation motion (clockRate = 0)';
  const btnHold = button('hold morph', () => setOverride('morph', 1));
  btnHold.title = 'Pin the transition fully on the next formation';
  row.append(btnRaw, btnFx, btnFreeze, btnHold);
  reviewBox.appendChild(row);

  const STORE_KEY = 'cv-universe-debug-settings';
  const saveRow = document.createElement('div');
  saveRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:.3rem;margin-top:.3rem;';
  const flash = (b, text) => {
    const prev = b.textContent;
    b.textContent = text;
    setTimeout(() => { b.textContent = prev; }, 900);
  };
  const btnSave = button('save', () => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ overrides, scene: review.scene }));
      flash(btnSave, 'saved ✓');
    } catch (_) { flash(btnSave, 'failed'); }
  });
  btnSave.title = 'Persist current slider overrides (and review formation) in this browser — restored automatically on reload';
  const btnCopy = button('copy json', () => {
    const json = JSON.stringify(overrides, null, 2);
    (navigator.clipboard ? navigator.clipboard.writeText(json) : Promise.reject())
      .then(() => flash(btnCopy, 'copied ✓'), () => { console.info('[universe] overrides:\n' + json); flash(btnCopy, 'in console'); });
  });
  btnCopy.title = 'Copy overrides as JSON — paste values into chapters.js to make them permanent';
  const btnForget = button('forget', () => {
    try { localStorage.removeItem(STORE_KEY); } catch (_) {}
    flash(btnForget, 'cleared ✓');
  });
  btnForget.title = 'Delete the saved settings (current sliders stay until reload)';
  saveRow.append(btnSave, btnCopy, btnForget);
  reviewBox.appendChild(saveRow);
  panel.appendChild(reviewBox);

  CONTROLS.forEach(([key, min, max, step]) => {
    if (!STATE_KEYS.includes(key) && key !== 'morph') return;
    const label = document.createElement('label');
    label.style.cssText = 'display:grid;grid-template-columns:5.5rem 1fr 2.6rem;gap:.35rem;align-items:center;';
    if (HINTS[key]) label.title = HINTS[key];
    const name = document.createElement('span');
    name.textContent = key;
    if (HINTS[key]) name.style.cssText = 'cursor:help;border-bottom:1px dotted rgba(255,255,255,.25);';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = experience.state[key] ?? min;
    input.style.width = '100%';
    const value = document.createElement('span');
    value.textContent = Number(input.value).toFixed(2);
    input.addEventListener('input', () => {
      overrides[key] = Number(input.value);
      value.textContent = Number(input.value).toFixed(2);
    });
    label.append(name, input, value);
    panel.appendChild(label);
    sliders.set(key, { input, value });
  });

  const reset = button('clear overrides', () => {
    Object.keys(overrides).forEach((k) => delete overrides[k]);
    sliders.forEach(({ input, value }, key) => {
      input.value = experience.state[key] ?? input.value;
      value.textContent = Number(input.value).toFixed(2);
    });
  });
  reset.title = 'Drop every live override and follow the scroll-driven chapter values again (saved settings are kept)';
  reset.style.cssText += 'margin-top:.6rem;width:100%;';
  panel.appendChild(reset);

  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved && saved.overrides) {
      Object.entries(saved.overrides).forEach(([k, v]) => setOverride(k, Number(v)));
      if (saved.scene && GENERATORS[saved.scene]) {
        picker.value = saved.scene;
        review.scene = saved.scene;
        experience.review = review;
      }
    }
  } catch (_) {}

  document.body.appendChild(panel);

  const tick = () => {
    const s = experience.state;
    const m = experience.perf.stats;
    readout.textContent =
      `${s.chapterId}  t=${s.t.toFixed(2)}  morph=${s.morph.toFixed(2)}\n` +
      `${s.sceneA} -> ${s.sceneB}${review.scene ? '   [review: ' + review.scene + ']' : ''}\n` +
      `tier=${experience.tier}  n=${experience.particles.activeCount}  dpr=${experience.dpr.toFixed(2)}\n` +
      `avg ${m.avg.toFixed(1)}  p95 ${m.p95.toFixed(1)}  p99 ${m.p99.toFixed(1)}`;
    requestAnimationFrame(tick);
  };
  tick();

  return panel;
}
