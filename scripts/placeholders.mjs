// Generates placeholder master images for every file referenced in
// content/projects.json and content/site.json that does not exist yet.
// Real artwork dropped into images/ is never overwritten.
//
//   npm run placeholders          (only missing files)
//   npm run placeholders -- --force   (regenerate all placeholders)

import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const IMAGES = path.join(ROOT, 'images');
const force = process.argv.includes('--force');

// Scene style per project. Frame sizes follow each show's delivery aspect.
const SCENES = {
  'rings-of-power':            { type: 'mountains', w: 2400, h: 1350, sky: '#d8b98e', fog: '#e8d2ad', far: '#8b7d8e', mid: '#6d5b4a', near: '#3b3027', grade: '#ff9a3c', pillars: true },
  'avatar-the-last-airbender': { type: 'mountains', w: 2400, h: 1200, sky: '#b9d0de', fog: '#dde8ef', far: '#9db4c6', mid: '#dfe7ec', near: '#56697a', grade: '#9fc6ff', walls: true },
  'damsel':                    { type: 'mountains', w: 2400, h: 1004, sky: '#3b2b2a', fog: '#86523d', far: '#523b36', mid: '#3a2a27', near: '#1c1514', grade: '#ff5a1f', spiky: true },
  'shazam':                    { type: 'city',      w: 2400, h: 1004, sky: '#6f7f95', fog: '#a3afbd', far: '#8793a3', mid: '#56616e', near: '#2b3139', grade: '#c9d8ff' },
  'the-walk':                  { type: 'city',      w: 2400, h: 1004, sky: '#a9c4d7', fog: '#d2dce2', far: '#8e9ba6', mid: '#5f6b76', near: '#2e353b', grade: '#ffd9a0', towers: true },
  'bessie':                    { type: 'fields',    w: 2400, h: 1350, sky: '#e0d2a9', fog: '#ebe0bf', far: '#9d9b7c', mid: '#7b7a52', near: '#7f6041', grade: '#ffcf80' },
  'wistmans-wood':             { type: 'forest',    w: 2400, h: 1600, sky: '#c9cdc4', fog: '#d9dcd4', far: '#8f9887', mid: '#667058', near: '#3a3b2f', grade: '#d8e8c0' },
  'site':                      { type: 'mountains', w: 2400, h: 1350, sky: '#a8b4bd', fog: '#cfd6da', far: '#7f8c96', mid: '#58636b', near: '#2c3236', grade: '#d0e0ff' },
};
// Per-file size overrides (e.g. a portrait still).
const SIZE_OVERRIDE = { 'wistmans-wood/final-02.jpg': [1600, 2000] };

// ---------- small helpers ----------
function rng(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const lum = (c) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
const grey = (c, t = 1) => mix(c, [lum(c), lum(c), lum(c)], t);
const f1 = (n) => n.toFixed(1);

function ridge(r, W, y, amp, rough = 1, n = 80) {
  const p = [r(), r(), r()].map((v) => v * Math.PI * 2);
  const f = [1 + r() * 1.5, 3 + r() * 3, 8 + r() * 8];
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const x = i / n;
    const h = Math.sin(x * f[0] * Math.PI + p[0]) * 0.5 + Math.sin(x * f[1] * Math.PI + p[1]) * 0.3 * rough +
      Math.sin(x * f[2] * Math.PI + p[2]) * 0.14 * rough + (r() - 0.5) * 0.12 * rough;
    pts.push([x * W, y - h * amp]);
  }
  return pts;
}
const area = (pts, W, H) => `M0,${H} L${pts.map((p) => f1(p[0]) + ',' + f1(p[1])).join(' L')} L${W},${H} Z`;
const rects = (list) => list.map(([x, y, w, h]) => `M${f1(x)},${f1(y)} h${f1(w)} v${f1(h)} h${f1(-w)} Z`).join(' ');

// ---------- scene construction ----------
// Each element: { depth 0..1 (far..near), fg (exists in plate), matte (painted only), d (path), c (rgb) }
function buildScene(s, W, H, seed) {
  const r = rng(seed);
  const E = [];
  const C = { far: rgb(s.far), mid: rgb(s.mid), near: rgb(s.near) };
  const hz = H * (0.5 + r() * 0.08); // horizon

  // far painted ridges
  E.push({ depth: 0.05, matte: true, c: mix(C.far, rgb(s.sky), 0.3), d: area(ridge(r, W, hz - H * 0.12, H * 0.12, 0.8), W, H) });
  E.push({ depth: 0.18, matte: true, c: C.far, d: area(ridge(r, W, hz - H * 0.03, H * 0.1, 1), W, H) });

  if (s.type === 'mountains') {
    const amp = s.spiky ? H * 0.22 : H * 0.14;
    E.push({ depth: 0.45, c: mix(C.far, C.mid, 0.6), d: area(ridge(r, W, hz + H * 0.06, amp, s.spiky ? 1.8 : 1.2), W, H) });
    if (s.pillars) {
      const list = [];
      const x0 = W * (0.45 + r() * 0.2);
      for (let i = 0; i < 5; i++) list.push([x0 + i * W * 0.03, hz - H * 0.18, W * 0.014, H * 0.3]);
      list.push([x0 - W * 0.01, hz - H * 0.2, W * 0.16, H * 0.025]);
      E.push({ depth: 0.5, c: mix(C.mid, C.far, 0.3), d: rects(list) });
    }
    if (s.walls) {
      const list = [];
      for (let i = 0; i < 3; i++) {
        const y = hz + H * (0.02 + i * 0.05), h = H * (0.08 + i * 0.03);
        list.push([W * (0.1 + i * 0.08), y - h, W * (0.8 - i * 0.16), h]);
      }
      E.push({ depth: 0.55, c: mix(C.mid, [255, 255, 255], 0.2), d: rects(list) });
    }
    E.push({ depth: 0.7, c: C.mid, d: area(ridge(r, W, hz + H * 0.2, H * 0.08, 1.4), W, H) });
    // plate foreground: ledge + a figure-scale block
    const ledge = ridge(r, W, H * 0.9, H * 0.05, 2).map(([x, y]) => [x, y + (x / W) * H * 0.08]);
    E.push({ depth: 0.95, fg: true, c: C.near, d: area(ledge, W, H) + ' ' + rects([[W * 0.3, H * 0.8, W * 0.006, H * 0.05]]) });
  }

  if (s.type === 'city') {
    const band = (depth, base, hmin, hmax, wmin, wmax, c) => {
      const list = [];
      for (let x = -20; x < W; ) {
        const w = wmin + r() * (wmax - wmin), h = hmin + r() * (hmax - hmin);
        list.push([x, base - h, w, H - base + h]);
        x += w + r() * 6;
      }
      E.push({ depth, c, d: rects(list) });
    };
    band(0.35, hz + H * 0.02, H * 0.04, H * 0.14, W * 0.015, W * 0.04, mix(C.far, C.mid, 0.4));
    if (s.towers) E.push({ depth: 0.4, c: mix(C.far, C.mid, 0.5), d: rects([[W * 0.62, hz - H * 0.42, W * 0.035, H], [W * 0.665, hz - H * 0.42, W * 0.035, H]]) });
    band(0.6, hz + H * 0.14, H * 0.05, H * 0.2, W * 0.03, W * 0.07, C.mid);
    // plate foreground: rooftop edge (+ wire for The Walk)
    const roof = [[0, H * 0.84, W, H * 0.16], [W * 0.05, H * 0.8, W * 0.08, H * 0.05], [W * 0.7, H * 0.78, W * 0.05, H * 0.07]];
    let d = rects(roof);
    if (s.towers) d += ` M0,${f1(H * 0.72)} L${W},${f1(H * 0.7)} L${W},${f1(H * 0.705)} L0,${f1(H * 0.725)} Z`;
    E.push({ depth: 0.95, fg: true, c: C.near, d });
  }

  if (s.type === 'fields' || s.type === 'forest') {
    E.push({ depth: 0.45, c: mix(C.far, C.mid, 0.5), d: area(ridge(r, W, hz + H * 0.05, H * 0.04, 0.6), W, H) });
    // tree clusters
    const trees = (depth, n, y0, y1, size, c) => {
      let d = '';
      for (let i = 0; i < n; i++) {
        const x = r() * W, y = y0 + r() * (y1 - y0), s2 = size * (0.6 + r() * 0.8);
        d += `M${f1(x - s2 * 0.08)},${f1(y)} h${f1(s2 * 0.16)} v${f1(s2 * 0.9)} h${f1(-s2 * 0.16)} Z `;
        for (let k = 0; k < 4; k++) {
          const cx = x + (r() - 0.5) * s2 * 0.9, cy = y - r() * s2 * 0.5, rr = s2 * (0.25 + r() * 0.2);
          d += `M${f1(cx - rr)},${f1(cy)} a${f1(rr)},${f1(rr)} 0 1,0 ${f1(rr * 2)},0 a${f1(rr)},${f1(rr)} 0 1,0 ${f1(-rr * 2)},0 `;
        }
      }
      E.push({ depth, c, d });
    };
    if (s.type === 'fields') {
      trees(0.55, 18, hz + H * 0.04, hz + H * 0.09, H * 0.06, C.mid);
      E.push({ depth: 0.7, c: mix(C.mid, rgb(s.fog), 0.25), d: area(ridge(r, W, hz + H * 0.16, H * 0.02, 0.4), W, H) });
      const road = `M${f1(W * 0.42)},${f1(hz + H * 0.15)} L${f1(W * 0.47)},${f1(hz + H * 0.15)} L${f1(W * 0.75)},${H} L${f1(W * 0.1)},${H} Z`;
      E.push({ depth: 0.95, fg: true, c: C.near, d: road + ' ' + area(ridge(r, W, H * 0.95, H * 0.02, 0.5), W, H) });
    } else {
      // boulders
      let b = '';
      for (let i = 0; i < 26; i++) {
        const x = r() * W, y = hz + H * (0.12 + r() * 0.3), rx = W * (0.02 + r() * 0.05), ry = rx * (0.45 + r() * 0.2);
        b += `M${f1(x - rx)},${f1(y)} a${f1(rx)},${f1(ry)} 0 1,0 ${f1(rx * 2)},0 a${f1(rx)},${f1(ry)} 0 1,0 ${f1(-rx * 2)},0 `;
      }
      E.push({ depth: 0.6, c: mix(C.far, C.mid, 0.6), d: b });
      trees(0.72, 14, hz + H * 0.02, hz + H * 0.22, H * 0.2, C.near);
      E.push({ depth: 0.95, fg: true, c: C.mid, d: area(ridge(r, W, H * 0.92, H * 0.04, 1.5), W, H) });
    }
  }
  return { E: E.sort((a, b) => a.depth - b.depth), hz, r };
}

function renderSvg(s, W, H, seed, variant, label) {
  const { E, r } = buildScene(s, W, H, seed);
  const sky = rgb(s.sky), fog = rgb(s.fog);
  let out = '';
  const bg = { plate: '#2447b8', layout: '#c9c9c6', render: hex(mix(sky, [235, 235, 235], 0.4)) }[variant] || s.sky;
  out += `<rect width="${W}" height="${H}" fill="${bg}"/>`;

  if (variant === 'plate') {
    for (let x = W * 0.1; x < W; x += W * 0.2)
      for (let y = H * 0.12; y < H * 0.7; y += H * 0.2)
        out += `<path d="M${f1(x - 10)},${f1(y)} h20 M${f1(x)},${f1(y - 10)} v20" stroke="#cfd6ff" stroke-width="3"/>`;
  }
  if (variant === 'matte' || variant === 'final') {
    for (let i = 0; i < 9; i++) {
      const cx = r() * W, cy = H * (0.08 + r() * 0.3), rx = W * (0.08 + r() * 0.12);
      out += `<ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="${f1(rx)}" ry="${f1(rx * 0.12)}" fill="${hex(mix(sky, [255, 255, 255], 0.35))}" opacity="0.7"/>`;
    }
  }
  for (const e of E) {
    if (variant === 'plate' && !e.fg) continue;
    if (variant === 'render' && e.matte) continue;
    let fill, stroke = '';
    if (variant === 'plate') fill = grey(e.c, 0.35);
    else if (variant === 'layout') {
      if (e.fg) fill = grey(e.c, 1);
      else { const l = 215 - e.depth * 120; fill = [l, l, l]; stroke = ` stroke="#2a2a2a" stroke-width="2"`; }
    } else if (variant === 'render') fill = e.c;
    else if (variant === 'matte') fill = mix(e.c, fog, (1 - e.depth) * 0.25);
    else fill = mix(e.c, fog, Math.pow(1 - e.depth, 1.4) * 0.7);
    out += `<path d="${e.d}" fill="${hex(fill)}"${stroke}/>`;
  }
  if (variant === 'final') out += `<rect width="${W}" height="${H}" fill="${s.grade}" opacity="0.1"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out}</svg>`;
}

// ---------- which files to make ----------
const projects = JSON.parse(await fs.readFile(path.join(ROOT, 'content/projects.json'), 'utf8'));
const site = JSON.parse(await fs.readFile(path.join(ROOT, 'content/site.json'), 'utf8'));

const jobs = [];
for (const p of projects) {
  const s = SCENES[p.slug] || SCENES.site;
  p.stills.forEach((st, i) => jobs.push({ src: st.src, s, seed: `${p.slug}-still-${i}`, variant: 'final', label: `PLACEHOLDER  ${p.code || p.slug}  FINAL ${String(i + 1).padStart(2, '0')}` }));
  (p.breakdownLayers || []).forEach((l, i) => {
    const variant = ['plate', 'layout', 'render', 'matte', 'final'].find((v) => l.src.includes(v)) || 'final';
    jobs.push({ src: l.src, s, seed: `${p.slug}-bd`, variant, label: `PLACEHOLDER  ${p.code || p.slug}  ${String(i + 1).padStart(2, '0')} ${l.label.toUpperCase()}` });
  });
}
if (site.reel?.poster) jobs.push({ src: site.reel.poster, s: SCENES.site, seed: 'reel', variant: 'final', label: 'PLACEHOLDER  SHOWREEL POSTER' });

let made = 0;
for (const j of jobs) {
  const file = path.join(IMAGES, j.src);
  if (!force) { try { await fs.access(file); continue; } catch {} }
  const [W, H] = SIZE_OVERRIDE[j.src] || [j.s.w, j.s.h];
  await fs.mkdir(path.dirname(file), { recursive: true });
  const svg = renderSvg(j.s, W, H, j.seed, j.variant, j.label.replace(/&/g, '&amp;').replace(/'/g, '&#39;'));
  await sharp(Buffer.from(svg)).jpeg({ quality: 90, mozjpeg: true }).toFile(file);
  made++;
}
console.log(`placeholders: ${made} written, ${jobs.length - made} already present`);
