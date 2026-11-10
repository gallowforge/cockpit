// Builds the content of every glass window as a PNG in shots/.
//  - Screens: the real UI, served by `cockpit demo` on a frozen clock and captured at 2x (desktop)
//    and 3x (phone). Cockpit has one theme, night, so the light images use the same captures.
//  - Terminals: `cockpit check` run fresh on a demo snapshot (its ANSI colours kept), and the
//    end-to-end run in demo/e2e.txt (written by `sudo scripts/e2e.sh bin/cockpit`), dark and light.
//  - The design diagram and the numbers band, typeset from the README's own facts, dark and light.
//   BIN=bin/cockpit node textures.mjs [name ...]
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');   // resolved through NODE_PATH
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'shots');
const BIN = resolve(process.env.BIN || join(HERE, '../../../bin/cockpit'));
const AT = '2026-03-10T07:42:00Z';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---- screens from `cockpit demo` --------------------------------------------------------
const SCEN = { calm: 8291, attention: 8292, incident: 8293, blind: 8294 };
const SHOTS = [
  // name, scenario, route, query, width, height, scale
  ['ov-calm', 'calm', '', 'since=9h', 1440, 1000, 2],
  ['ov-inc', 'incident', '', 'since=9h', 1440, 1000, 2],
  ['palette', 'incident', '', 'palette=vau', 1440, 900, 2],
  ['services', 'incident', 'services/homeassistant', '', 1440, 1300, 2],
  ['backups', 'calm', 'backups', '', 1440, 1400, 2],
  ['history', 'attention', 'history', '', 1440, 1300, 2],
  ['calm-services', 'calm', 'services', '', 1440, 1000, 2],
  ['calm-backups', 'calm', 'backups', '', 1440, 1000, 2],
  ['calm-history', 'calm', 'history', '', 1440, 1000, 2],
  ['m-calm-runbook', 'calm', 'runbooks/dns', 'tick=0', 390, 844, 3],
  ['m-ov-calm', 'calm', '', 'since=9h', 390, 844, 3],
  ['m-ov-inc', 'incident', '', 'since=9h', 390, 844, 3],
  ['m-ov-blind', 'blind', '', 'since=9h', 390, 844, 3],
  ['m-runbook', 'incident', 'runbooks/dns', 'tick=0', 390, 844, 3],
  ['m-backups', 'calm', 'backups', '', 390, 844, 3],
  ['m-jobs', 'calm', 'jobs', '', 390, 844, 3],
];

// ---- themes for the typeset windows ------------------------------------------------------
const THEME = {
  dark: { bg: '#0a0d12', fg: '#c3ccd8', dim: '#6f7b8b', hi: '#eef3f8', ok: '#49e3a0', bad: '#ff6b6b', warn: '#ffad4a', acc: '#a9d8ff',
    card: '#121821', rule: 'rgba(214,226,240,0.10)', soft: '#9aa5b4' },
  light: { bg: '#fbfbfc', fg: '#3a4250', dim: '#8a93a0', hi: '#0d1117', ok: '#0b8650', bad: '#cc3b2b', warn: '#a35f00', acc: '#2a62b8',
    card: '#eef0f3', rule: 'rgba(20,30,50,0.10)', soft: '#5d6674' },
};
const css = (t) => `
@import url("https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=block");
html,body{margin:0;background:${t.bg}}
body{-webkit-font-smoothing:antialiased;color:${t.fg};font-family:"Geist",sans-serif}
.term{box-sizing:border-box;padding:24px 28px 26px;font:400 13.4px/1.74 "Geist Mono",monospace;color:${t.fg}}
.l{white-space:pre-wrap}.l[data-box]{width:fit-content;max-width:100%}
.p{color:${t.dim}}.c{color:${t.hi}}.d{color:${t.dim}}.ok{color:${t.ok};font-weight:500}.warn{color:${t.warn}}.acc{color:${t.acc}}.b{font-weight:600;color:${t.hi}}
.cur{display:inline-block;width:8px;height:16px;background:${t.fg};vertical-align:-3px;margin-left:1px;opacity:.85}
`;
const PROMPT = (cmd, cursor) => `<div class="l"><span class="p">pi@raspberrypi:~$</span> <span class="c">${esc(cmd)}</span>${cursor ? '<span class="cur"></span>' : ''}</div>`;

// ANSI SGR to spans (the codes `cockpit check -color always` uses: 0 1 32 33 90)
function ansi(line) {
  const cls = { 1: 'b', 32: 'ok', 33: 'warn', 31: 'bad', 90: 'd' };
  let out = '', open = 0;
  for (const part of line.split(/(\x1b\[[\d;]*m)/)) {
    const m = part.match(/^\x1b\[([\d;]*)m$/);
    if (!m) { out += esc(part); continue; }
    for (const c of (m[1] || '0').split(';')) {
      if (c === '0') { out += '</span>'.repeat(open); open = 0; } else if (cls[c]) { out += `<span class="${cls[c]}">`; open++; }
    }
  }
  return out + '</span>'.repeat(open);
}

function checkOutput() {
  const dir = mkdtempSync(join(tmpdir(), 'cockpit-check-'));
  try {
    // a snapshot taken now, so `check` does not add its "snapshot is old" note
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    execFileSync(BIN, ['demo', '-scenario', 'attention', '-at', now, '-write', join(dir, 's.json')]);
    let out = '';
    try { out = execFileSync(BIN, ['check', '-state', join(dir, 's.json'), '-color', 'always']).toString(); }
    catch (e) { out = e.stdout.toString(); }   // exit 1 means "warn", which is what this snapshot is
    return out.replace(/\n$/, '').split('\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const e2e = readFileSync(join(HERE, 'demo', 'e2e.txt'), 'utf8').replace(/\n$/, '').split('\n');
function e2eLine(l) {
  let m;
  if ((m = l.match(/^== (.*)$/))) return `<div class="l" style="margin-top:7px"><span class="acc">== ${esc(m[1])}</span></div>`;
  if ((m = l.match(/^PASS (.*)$/))) return `<div class="l"><span class="ok">PASS</span> <span>${esc(m[1])}</span></div>`;
  if ((m = l.match(/^(cockpit-\S+)(\s+)([\d.]+) (\w+)(?:\s+\S+)?$/))) return `<div class="l" data-box="score"><span class="c">${m[1]}</span>${m[2]}<span class="ok">${m[3]} ${m[4]}</span></div>`;
  if ((m = l.match(/^RESULT: (.*)$/))) return `<div class="l" data-box="result"><span class="c">RESULT: </span><span class="ok">${esc(m[1])}</span></div>`;
  return `<div class="l">${esc(l)}</div>`;
}

const TEX = {
  check: () => ({ w: 640, body: `<div class="term" style="width:640px">${PROMPT('cockpit check -config /etc/cockpit/cockpit.conf')}${checkOutput().map(l => `<div class="l">${ansi(l)}</div>`).join('')}${PROMPT('', true)}</div>` }),
  e2e: () => ({ w: 600, body: `<div class="term" style="width:600px">${PROMPT('sudo scripts/e2e.sh bin/cockpit')}${e2e.map(e2eLine).join('')}</div>` }),
  design: (t) => design(t, false), 'design-phone': (t) => design(t, true),
  numbers: (t) => numbers(t, false), 'numbers-phone': (t) => numbers(t, true),
};

function numbers(t, phone) {
  const F = [['7.9 MB', 'one binary for the Pi,', 'the UI inside'], ['0', 'Go dependencies,', 'standard library only'], [process.env.RAM_MB ? process.env.RAM_MB + ' MB' : '27 MB', 'of RAM on a', 'Raspberry Pi 5'], ['137', 'tests, 34 of them', 'under real systemd']];
  const cell = ([v, a, b], i) => `<div style="padding:${phone ? '26px 24px 24px' : '30px 30px 28px'};${phone ? (i % 2 ? `border-left:1px solid ${t.rule};` : '') + (i > 1 ? `border-top:1px solid ${t.rule};` : '') : (i ? `border-left:1px solid ${t.rule};` : '')}">
    <div style="font:600 ${phone ? 44 : 50}px/1 Geist;letter-spacing:-.045em;color:${t.hi};margin-left:-3px">${v}</div>
    <div style="font:400 15px/1.4 Geist;color:${t.soft};margin-top:12px">${a}<br>${b}</div></div>`;
  return { w: phone ? 520 : 1040, body: `<div style="width:${phone ? 520 : 1040}px;display:grid;grid-template-columns:${phone ? '1fr 1fr' : 'repeat(4,1fr)'}">${F.map(cell).join('')}</div>` };
}

// the privilege split, from deploy/systemd/ and the scores CI prints
function design(t, phone) {
  const li = (s, good) => `<div style="display:flex;gap:9px;font:400 13.5px/1.4 Geist;color:${t.fg};margin-top:7px"><span style="flex:none;width:6px;height:6px;border-radius:50%;margin-top:6px;background:${good ? t.ok : t.dim}"></span><span>${s}</span></div>`;
  const node = (title, role, items, o = {}) => `<div${o.id ? ` data-box="${o.id}"` : ''} style="border:1px solid ${o.line || t.rule};border-radius:14px;padding:16px 17px 17px;box-sizing:border-box;${o.style || ''}">
    <div style="font:600 17px/1.2 'Geist Mono';letter-spacing:-.01em;color:${t.hi}">${title}</div>
    <div style="font:500 12.5px/1.3 Geist;color:${o.roleCol || t.soft};margin-top:5px">${role}</div>${items}
    ${o.score ? `<div style="margin-top:14px;padding-top:12px;border-top:1px solid ${t.rule};display:flex;align-items:baseline;gap:10px"><span style="font:600 30px/1 Geist;letter-spacing:-.03em;color:${t.ok}">${o.score[0]}</span><span style="font:500 12px/1.3 Geist;color:${t.soft}">${o.score[1]}<br>systemd-analyze security</span></div>` : ''}</div>`;
  const arrow = (label) => phone
    ? `<div style="display:flex;align-items:center;gap:12px;height:34px;padding-left:24px"><svg width="14" height="34" viewBox="0 0 14 34"><path d="M7,3 L7,30 M2,25 L7,30 L12,25" fill="none" stroke="${t.dim}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg><span style="font:500 11.5px/1 'Geist Mono';color:${t.dim}">${label}</span></div>`
    : `<div style="display:flex;flex-direction:column;justify-content:center;align-items:center;gap:6px"><span style="font:500 11px/1 'Geist Mono';color:${t.dim}">${label}</span><svg width="34" height="12" viewBox="0 0 34 12"><path d="M2,6 L31,6 M26,1.5 L31,6 L26,10.5" fill="none" stroke="${t.dim}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`;
  const src = node('the homelab', 'what it reads', ['systemd journal', 'systemctl show', 'Docker API, GET only', 'backup status files', 'notifier state', 'MANIFEST and git', 'HTTPS, TCP and DNS probes'].map(s => li(s)).join(''));
  const col = node('cockpit collect', 'root, boxed in', [['only CAP_DAC_READ_SEARCH', 1], ['writes only /run/cockpit', 1], ['no internet, no listener', 1], ['every 20 s; journal every 5 min', 0]].map(([s, g]) => li(s, g)).join(''), { score: ['2.4', 'OK,'], line: t.warn + '66', roleCol: t.warn, id: 'collect' });
  const ram = `<div style="border:1px solid ${t.acc}55;border-radius:14px;padding:16px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center">
    <div style="font:600 15px/1.2 'Geist Mono';color:${t.hi}">state.json</div><div style="font:600 34px/1 Geist;letter-spacing:-.03em;color:${t.acc};margin-top:10px">RAM</div>
    <div style="font:500 12.5px/1.3 Geist;color:${t.soft};margin-top:8px">0 disk writes</div></div>`;
  const srv = node('cockpit serve', 'a throwaway user', [['no capabilities', 1], ['no network at all', 1], ['socket from systemd', 1], ['live updates over SSE', 0]].map(([s, g]) => li(s, g)).join(''), { score: ['0.5', 'SAFE,'], line: t.ok + '66', roleCol: t.ok, id: 'serve' });
  const edge = node('Caddy', 'TLS in front', li('one sign-in, then a', 0) + li('year-long signed cookie', 0), {});
  const phoneN = node('your phone', 'or any browser', li('read-only: no button', 1) + li('changes anything', 1));
  if (phone) return { w: 460, body: `<div style="width:460px;box-sizing:border-box;padding:16px;display:flex;flex-direction:column">${src}${arrow('reads')}${col}${arrow('writes')}${ram}${arrow('reads')}${srv}${arrow('socket')}<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${edge}${phoneN}</div></div>` };
  return { w: 1240, body: `<div style="width:1240px;box-sizing:border-box;padding:22px;display:grid;grid-template-columns:1fr 50px 1.12fr 50px 0.62fr 50px 1fr 50px 0.92fr;align-items:stretch">
    ${src}${arrow('reads')}${col}${arrow('writes')}${ram}${arrow('reads')}${srv}${arrow('socket')}<div style="display:flex;flex-direction:column;gap:12px">${edge}${phoneN}</div></div>` };
}

// ---- render ------------------------------------------------------------------------------
const only = process.argv.slice(2);
const want = (n) => !only.length || only.includes(n) || (only.includes('screens') && SHOTS.some(s => s[0] === n));
mkdirSync(OUT, { recursive: true });
const BOXES = {};
try { Object.assign(BOXES, (await import(pathToFileURL(join(OUT, 'boxes.js')).href + '?' + Date.now())).BOXES); } catch {}
const browser = await chromium.launch();
const mark = async (page, el, name, scale) => {
  const box = await el.boundingBox();
  const marks = await page.$$eval('[data-box]', (els) => els.map(e => { const r = e.getBoundingClientRect(); return [e.dataset.box, r.left, r.top, r.width, r.height]; }));
  BOXES[name] = { size: [Math.round(box.width * scale), Math.round(box.height * scale)] };
  for (const [k, x, y, w, h] of marks) {
    const b = [x - box.x, y - box.y, w, h].map(v => Math.round(v * scale)), o = BOXES[name][k];
    BOXES[name][k] = o ? [Math.min(o[0], b[0]), Math.min(o[1], b[1]), Math.max(o[0] + o[2], b[0] + b[2]) - Math.min(o[0], b[0]), Math.max(o[1] + o[3], b[1] + b[3]) - Math.min(o[1], b[1])] : b;
  }
};

// screens
if (SHOTS.some(s => want(s[0]))) {
  const procs = Object.entries(SCEN).map(([s, port]) => spawn(BIN, ['demo', '-scenario', s, '-at', AT, '-listen', `127.0.0.1:${port}`], { stdio: 'ignore' }));
  try {
    await new Promise(r => setTimeout(r, 800));
    for (const [name, scen, route, q, w, h, scale] of SHOTS) {
      if (!want(name)) continue;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale, colorScheme: 'dark', timezoneId: 'Asia/Kuwait', isMobile: w < 500, hasTouch: w < 500 });
      const page = await ctx.newPage();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(`http://127.0.0.1:${SCEN[scen]}/?shot${q ? '&' + q : ''}#/${route}`, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(900);
      await page.screenshot({ path: join(OUT, `${name}.png`) });
      BOXES[name] = { size: [w * scale, h * scale] };
      // parts of the screen that the compositions lift out toward the viewer
      for (const [k, sel] of [['status', '.status'], ['strip', '.daystrip'], ['figs', '.figs'], ['since', '.ov-rail .only-desk'], ['palette', '.palette'], ['day', '.sec .panel'], ['drill', '.drill-grid'], ['hist', '.hist'], ['checks', '.md > ol']]) {
        const r = await page.$eval(sel, e => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; }).catch(() => null);
        if (r) BOXES[name][k] = r.map(v => Math.round(v * scale));
      }
      console.log(`${name}.png  ${w * scale}x${h * scale}  ${Object.keys(BOXES[name]).filter(k => k !== 'size').join(' ')}`);
      await ctx.close();
    }
  } finally { procs.forEach(p => p.kill()); }
}

// typeset windows
for (const [name, make] of Object.entries(TEX)) {
  if (!want(name)) continue;
  for (const theme of ['dark', 'light']) {
    const t = THEME[theme], { w, body, scale = 2 } = make(t);
    const ctx = await browser.newContext({ viewport: { width: w, height: 400 }, deviceScaleFactor: scale });
    const page = await ctx.newPage();
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>${css(t)}</style><body>${body}</body>`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const el = await page.$('body > *');
    await el.screenshot({ path: join(OUT, `${name}-${theme}.png`) });
    if (theme === 'dark') await mark(page, el, name, scale);
    console.log(`${name}-${theme}.png  ${BOXES[name].size.join('x')}`);
    await ctx.close();
  }
}
await browser.close();
writeFileSync(join(OUT, 'boxes.js'), '// Generated by textures.mjs: [x, y, w, h] in texture pixels of marked parts of each window.\nexport const BOXES = ' + JSON.stringify(BOXES, null, 1) + ';\n');
