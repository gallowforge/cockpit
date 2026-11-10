// Vesper README: every composition in the Glass language (glass/scene.js renders them).
// Positions are the apparent centre in CSS px (y down); w or h is the apparent content size;
// z is depth (+ toward the viewer; 1 unit = 1 px at z = 0); rot is in degrees.
// A window with `parent` is a part of that window's screen lifted out toward the viewer
// (`src` is the part, in texture pixels, from shots/boxes.js).
// Vesper has one theme, night: in the light images its screens stay dark, on daylight glass.
import { BOXES } from './shots/boxes.js';

// a quiet night: dark glass in cool light, no horizon
const NIGHT = {
  page: '#0d1117',
  env: { top: '#070b13', bot: '#04060a', haze: '#16203a', hazeStr: 0.10, ray: '#9fb8e0',
    shafts: [[0.16, 0.050, 0.05, 0.10], [0.34, 0.022, 0.03, 0.07], [0.64, 0.028, -0.03, 0.08], [0.84, 0.060, -0.06, 0.10], [0.50, 0.20, 0.0, 0.035]],
    glows: [[0.5, 1.12, 0.62, 0.08, '#8ea6d8'], [0.5, 0.36, 0.5, 0.06, '#1e3e6a']],
    horizon: [0.34, 0.05, 0.55, '#5ea8ff', '#ffad4a', 0.05], horizonSpan: [-0.05, 0.22, 1.05, 0.78] },
  glass: { tint: [0.060, 0.066, 0.082], transmit: 0.80, fog: '#070b12', light: [-700, 800, 900], rim: 0.9, spec: 0.40, glow: 0.62, shadow: 0.30, levels: 5, caustic: 0 },
  motes: { n: 70, color: '#d4e2ff', amt: 0.50 },
  bloom: 0.40, bloomThresh: 0.55,
};
const DAY = {
  page: '#ffffff',
  env: { top: '#eef1f6', bot: '#f6f7f9', haze: '#ffffff', hazeStr: 0.04, shadeCol: '#eaeef4', sun: [0.30, 0, -1.0, 1.0], dapple: 0.55, sunStr: 0.075, sunCol: '#fff6e8',
    shadow: 0.55, caustic: 0.10, shadowDir: [0.05, -0.075], glows: [] },
  glass: { tint: [0.075, 0.078, 0.084], transmit: 0.88, fog: '#eef2f7', light: [-700, 800, 900], rim: 0.95, spec: 0.30, glow: 0.0, shadow: 0.12, levels: 5, caustic: 0 },
  motes: { n: 40, color: '#fffaf0', amt: 0.45 },
  bloom: 0.0, bloomThresh: 0.95,
};
const merge = (a, b) => { const o = { ...a }; for (const k in b) o[k] = (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) ? merge(a[k] || {}, b[k]) : b[k]; return o; };
const C = {
  kick: { night: { color: 'rgba(205,214,228,0.56)' }, day: { color: '#7b8291' } },
  name: { night: { color: '#f5f7fb' }, day: { color: '#0b0d11' } },
  line: { night: { color: 'rgba(222,229,240,0.74)' }, day: { color: '#4a5161' } },
};
const T = (cls, html, x, y, style = {}, align) => ({ cls, html, x, y, align, style, ...C[cls] });

const KEY = '#0C0D0F';          // the app's own background, keyed so its UI floats on the glass
const pad = (b, x, y = x) => [b[0] - x, b[1] - y, b[2] + 2 * x, b[3] + 2 * y];
const UNION = (a, b) => { const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]); return [x, y, Math.max(a[0] + a[2], b[0] + b[2]) - x, Math.max(a[1] + a[3], b[1] + b[3]) - y]; };
const full = (name) => [0, 0, ...BOXES[name].size];
// a screen of the real app (dark in both themes)
const S = (name, n, o) => ({ tex: `${name}.png`, crop: full(name), key: KEY, keyAmt: n ? 0.5 : 0.08, bezel: 9, glowColor: '#16304f', ...o });
// a typeset window (terminal, diagram, numbers) in the page's theme
const D = (name, n, o) => ({ tex: `${name}-${n ? 'dark' : 'light'}.png`, crop: full(name), key: n ? '#0A0D12' : '#FBFBFC', keyAmt: n ? 0.6 : 0.72, bezel: 9, glowColor: '#16304f', ...o });
const LIFT = (parent, src, n, o) => ({ parent, src, lift: 90, breathe: [10, 0.25], bezel: 8, radius: 14, key: KEY, keyAmt: n ? 0.85 : 0.15,
  shadowOff: n ? [0, -16, 40] : [10, -22, 26], shadow: n ? 0.45 : 0.22, glow: 0.25, ...o });
const FAR = (n) => ({ lod: 1.1, defocus: 2.4, fog: n ? 0.60 : 0.38 });
const MID = (n) => ({ lod: 0.4, defocus: 0.8, fog: n ? 0.20 : 0.10 });
// the top of the app, without the empty bottom of the viewport
const TOP = (name, hCss) => [0, 0, BOXES[name].size[0], Math.round(hCss * BOXES[name].size[0] / 1440)];
const NOSIDE = (name, y0, hCss, right = 40) => [480, y0 * 2, BOXES[name].size[0] - 480 - right, hCss * 2];   // past the 240 px sidebar

const PANEL = (h, win, o = {}) => ({ css: [840, h], fade: [36, 36, 28, 34], cam: [12, 5], pool: o.pool || [0.5, 0.5, 0.78, 0.86],
  night: merge(NIGHT, o.night || {}), day: merge(DAY, o.day || {}), windows: win, type: o.type || [] });
const PHONE = (h, win, o = {}) => ({ css: [381, h], dpr: 1080 / 381, fade: [16, 16, 22, 26], cam: [7, 3], pool: o.pool || [0.5, 0.5, 0.80, 0.80],
  night: merge(NIGHT, o.night || {}), day: merge(DAY, o.day || {}), windows: win, type: o.type || [] });
const hz = () => ({});

// ---------- the hero: all clear, then one service down, then all clear again ----------
// The lifted status block and the phone cross-fade from the calm overview to the incident
// and back; everything else stays still while the light moves.
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const DOWN = (p) => smooth(0.36, 0.44, p) * (1 - smooth(0.82, 0.90, p));
const HERO_NIGHT = merge(NIGHT, { env: {
  shafts: [[0.30, 0.050, 0.05, 0.12], [0.42, 0.020, 0.02, 0.09], [0.58, 0.022, -0.02, 0.10], [0.71, 0.050, -0.05, 0.12], [0.50, 0.22, 0.0, 0.05]],
  glows: [[0.50, 0.40, 0.42, 0.10, '#22406c'], [0.5, 1.15, 0.65, 0.10, '#8ea6d8'], [0.5, -0.15, 0.6, 0.05, '#4a5f86']] } });
const HERO_DAY = merge(DAY, { env: { sun: [0.10, 0, -0.80, 0.95] } });
const heroWindows = (n, P) => [
  S('calm-backups', n, { crop: TOP('calm-backups', 860), ...P[0], ...FAR(n), breathe: [16, 0.15], bezel: 8 }),
  S('calm-history', n, { crop: TOP('calm-history', 860), ...P[1], ...FAR(n), breathe: [12, 0.8], bezel: 8 }),
  S('calm-services', n, { crop: TOP('calm-services', 900), ...P[2], ...MID(n), breathe: [12, 0.5] }),
  S('m-calm-runbook', n, { ...P[3], ...MID(n), breathe: [12, 0.0], bezel: 8 }),
  S('ov-calm', n, { crop: TOP('ov-calm', 920), ...P[4], breathe: [10, 0.6], bezel: 11, glow: 0.8 }),
  S('m-ov-calm', n, { tex2: 'm-ov-inc.png', ...P[5], breathe: [9, 0.3], bezel: 8 }),
  LIFT(4, pad(UNION(BOXES['ov-calm'].status, BOXES['ov-inc'].status), 8, 6), n, { tex2: 'ov-inc.png', lift: 120, breathe: [12, 0.85], radius: 14 }),
];
const HERO_LINE = 'A read-only operations dashboard for a home server.';

export const LAYOUTS = {
  hero: {
    css: [840, 540], fade: [40, 40, 30, 46], cam: [0, 0], motion: 0, pool: [0.5, 0.42, 0.62, 0.62], mix: DOWN,
    night: HERO_NIGHT, day: HERO_DAY,
    windows: (n) => heroWindows(n, [
      { x: 102, y: 196, w: 124, z: -820, rot: [10, 18, 0] },
      { x: 738, y: 196, w: 124, z: -820, rot: [10, -18, 0] },
      { x: 118, y: 326, w: 214, z: -320, rot: [2, 32, 0] },
      { x: 742, y: 330, h: 236, z: -320, rot: [2, -32, 0] },
      { x: 420, y: 352, w: 440, z: 40, rot: [3, 0, 0] },
      { x: 652, y: 404, h: 240, z: 170, rot: [0, -14, 0] },
    ]),
    type: [
      T('name', 'Vesper', 420, 34, { fontSize: '60px' }, 'center'),
      T('line', HERO_LINE, 420, 110, { fontSize: '16.5px' }, 'center'),
    ],
  },
  'hero-phone': {
    css: [381, 600], dpr: 1080 / 381, fade: [16, 16, 24, 30], cam: [0, 0], motion: 0, pool: [0.5, 0.40, 0.75, 0.55], mix: DOWN,
    night: HERO_NIGHT, day: HERO_DAY,
    windows: (n) => heroWindows(n, [
      { x: 84, y: 226, w: 100, z: -820, rot: [10, 18, 0] },
      { x: 298, y: 226, w: 100, z: -820, rot: [10, -18, 0] },
      { x: 56, y: 306, w: 150, z: -320, rot: [2, 32, 0] },
      { x: 330, y: 312, h: 170, z: -320, rot: [2, -32, 0] },
      { x: 190, y: 372, w: 318, z: 40, rot: [3, 0, 0] },
      { x: 300, y: 456, h: 200, z: 170, rot: [0, -14, 0] },
    ]),
    type: [
      T('name', 'Vesper', 190.5, 34, { fontSize: '50px' }, 'center'),
      T('line', 'A read-only operations dashboard<br>for a home server.', 190.5, 98, { fontSize: '15px', textAlign: 'center' }, 'center'),
    ],
  },

  // ---------- the numbers band ----------
  numbers: PANEL(210, (n) => [D('numbers', n, { x: 420, y: 104, w: 760, z: 0, rot: [7, 0, 0], bezel: 6, breathe: [0, 0], keyAmt: n ? 0.85 : 0.92, glow: 0.35, bar: false })],
    { pool: [0.5, 0.5, 0.80, 0.95] }),
  'numbers-phone': PHONE(300, (n) => [D('numbers-phone', n, { x: 190.5, y: 150, w: 336, z: 0, rot: [8, 0, 0], bezel: 6, breathe: [0, 0], keyAmt: n ? 0.85 : 0.92, glow: 0.35, bar: false })]),

  // ---------- 1. one glance: the answer, and the day behind it ----------
  overview: PANEL(430, (n) => [
    S('ov-inc', n, { crop: TOP('ov-inc', 760), x: 360, y: 206, w: 540, z: -40, rot: [2, 14, 0], breathe: [8, 0.0], bezel: 10, glowColor: '#3a1616' }),
    S('m-ov-inc', n, { x: 690, y: 226, h: 330, z: 80, rot: [0, -14, 0], breathe: [8, 0.45] }),
    LIFT(0, pad(BOXES['ov-inc'].strip, 10, 8), n, { lift: 110, radius: 12 }),
  ]),
  'overview-phone': PHONE(560, (n) => [
    S('ov-inc', n, { crop: NOSIDE('ov-inc', 0, 470, 704), x: 176, y: 160, w: 330, z: -40, rot: [2, 12, 0], breathe: [8, 0.0] }),
    S('m-ov-inc', n, { x: 250, y: 386, h: 300, z: 80, rot: [0, -12, 0], breathe: [8, 0.45] }),
  ]),

  // ---------- 2. every service, and a command bar to reach it ----------
  services: PANEL(430, (n) => [
    S('services', n, { crop: TOP('services', 900), x: 400, y: 206, w: 520, z: -50, rot: [2, 12, 0], breathe: [8, 0.0], bezel: 10 }),
    S('palette', n, { crop: pad(BOXES.palette.palette, 2, 2), x: 660, y: 150, w: 300, z: 110, rot: [0, -16, 0], breathe: [8, 0.45], bezel: 9 }),
    LIFT(0, pad(BOXES.services.day, 6, 6), n, { lift: 100, radius: 12 }),
  ]),
  'services-phone': PHONE(500, (n) => [
    S('services', n, { crop: NOSIDE('services', 0, 760), x: 180, y: 200, w: 330, z: -50, rot: [2, 12, 0], breathe: [8, 0.0] }),
    S('palette', n, { crop: pad(BOXES.palette.palette, 2, 2), x: 214, y: 400, w: 280, z: 110, rot: [0, -12, 0], breathe: [8, 0.45] }),
  ]),

  // ---------- 3. backups with their proof ----------
  backups: PANEL(430, (n) => [
    S('backups', n, { crop: TOP('backups', 1000), x: 380, y: 210, w: 470, z: -50, rot: [2, 14, 0], breathe: [8, 0.0], bezel: 10 }),
    S('m-backups', n, { x: 700, y: 226, h: 330, z: 80, rot: [0, -14, 0], breathe: [8, 0.45] }),
    LIFT(0, pad(BOXES.backups.figs, 4, 4), n, { lift: 110, radius: 12 }),
  ]),
  'backups-phone': PHONE(540, (n) => [
    S('backups', n, { crop: NOSIDE('backups', 0, 800), x: 176, y: 180, w: 330, z: -50, rot: [2, 12, 0], breathe: [8, 0.0] }),
    S('m-backups', n, { x: 254, y: 380, h: 280, z: 80, rot: [0, -12, 0], breathe: [8, 0.45] }),
  ]),

  // ---------- 4. one timeline for everything that happened ----------
  history: PANEL(430, (n) => [
    S('history', n, { crop: TOP('history', 960), x: 420, y: 222, w: 520, z: -40, rot: [4, 0, 0], breathe: [8, 0.0], bezel: 10 }),
    LIFT(0, pad(BOXES.history.figs, 4, 4), n, { lift: 120, radius: 12 }),
  ]),
  'history-phone': PHONE(420, (n) => [
    S('history', n, { crop: NOSIDE('history', 0, 800), x: 190.5, y: 210, w: 340, z: -40, rot: [3, 0, 0], breathe: [8, 0.0] }),
    LIFT(0, pad(BOXES.history.figs, 4, 4), n, { lift: 90, radius: 12 }),
  ]),

  // ---------- 5. made for the phone, and honest when it can't see ----------
  phones: PANEL(470, (n) => [
    S('m-jobs', n, { x: 196, y: 222, h: 330, z: -220, rot: [2, 22, 0], ...MID(n), breathe: [8, 0.7] }),
    S('m-ov-blind', n, { x: 420, y: 232, h: 380, z: 20, rot: [2, 0, 0], breathe: [8, 0.0] }),
    S('m-runbook', n, { x: 646, y: 222, h: 330, z: -100, rot: [2, -18, 0], breathe: [8, 0.45] }),
  ]),
  'phones-phone': PHONE(560, (n) => [
    S('m-runbook', n, { x: 112, y: 270, h: 300, z: -160, rot: [2, 18, 0], ...MID(n), breathe: [8, 0.45] }),
    S('m-ov-blind', n, { x: 236, y: 290, h: 380, z: 20, rot: [2, -6, 0], breathe: [8, 0.0] }),
  ]),

  // ---------- how it works: the privilege split ----------
  design: PANEL(330, (n) => [
    D('design', n, { x: 420, y: 160, w: 760, z: -20, rot: [8, 0, 0], breathe: [6, 0.0], bezel: 10, glow: 0.5 }),
    LIFT(0, pad(BOXES.design.serve, 6, 6), n, { lift: 80, shift: [-34, 0], radius: 16, key: n ? '#0A0D12' : '#FBFBFC', keyAmt: n ? 0.72 : 0.85, glowColor: '#174836' }),
  ], { pool: [0.5, 0.5, 0.80, 0.90] }),
  'design-phone': PHONE(760, (n) => [
    D('design-phone', n, { x: 190.5, y: 380, w: 300, z: -20, rot: [5, 0, 0], breathe: [6, 0.0], bezel: 8, glow: 0.5 }),
  ]),

  // ---------- quality: the end-to-end run and `vesper check` ----------
  proof: PANEL(460, (n) => [
    D('e2e', n, { crop: [0, 2269, 1200, 1100], x: 300, y: 226, w: 380, z: -40, rot: [2, 16, 0], breathe: [8, 0.0], bezel: 10 }),
    D('check', n, { x: 620, y: 200, w: 340, z: 70, rot: [0, -14, 0], breathe: [8, 0.45] }),
    LIFT(0, pad(UNION(BOXES.e2e.score, BOXES.e2e.result), 14, 10), n, { lift: 110, radius: 12, key: n ? '#0A0D12' : '#FBFBFC', keyAmt: n ? 0.72 : 0.85, glowColor: '#174836' }),
  ]),
  'proof-phone': PHONE(560, (n) => [
    D('e2e', n, { crop: [0, 2269, 1200, 1100], x: 170, y: 190, w: 300, z: -40, rot: [2, 12, 0], breathe: [8, 0.0] }),
    D('check', n, { x: 216, y: 410, w: 300, z: 70, rot: [0, -10, 0], breathe: [8, 0.45] }),
  ]),

  // ---------- the social preview, 1280 x 640 ----------
  social: {
    css: [640, 320], fade: [26, 26, 22, 26], cam: [0, 0], motion: 0, pool: [0.70, 0.52, 0.40, 0.75],
    night: NIGHT, day: DAY,
    windows: (n) => [
      S('ov-calm', n, { crop: NOSIDE('ov-calm', 0, 640, 704), x: 448, y: 136, w: 270, z: -80, rot: [2, -18, 0], breathe: [0, 0], bezel: 9 }),
      S('m-ov-calm', n, { x: 568, y: 186, h: 176, z: 60, rot: [0, -14, 0], breathe: [0, 0], bezel: 8 }),
      LIFT(0, pad(BOXES['ov-calm'].status, 10, 10), n, { lift: 70, breathe: [0, 0] }),
    ],
    type: [
      T('kick', 'Self-hosted · Go', 40, 104, { fontSize: '10px' }),
      T('name', 'Vesper', 38, 122, { fontSize: '46px' }),
      T('line', HERO_LINE, 40, 182, { fontSize: '15.5px', whiteSpace: 'normal', width: '236px' }),
    ],
  },
};
for (const k in LAYOUTS) LAYOUTS[k].dpr = LAYOUTS[k].dpr || 2;
