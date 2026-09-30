// Static site build. No framework: reads content/*.json, writes dist/.
//   npm run build
// Images in images/ are resized to several widths and encoded as AVIF, WebP and JPG.
// Encoded images are cached in dist/img and only rebuilt when the source changes.

import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
// --preview writes preview/ for hosting as a claude.ai Artifact: fewer image files,
// explicit index.html links, inlined JS, and the reel links out instead of embedding.
const PREVIEW = process.argv.includes('--preview');
// --theme=<name> layers src/themes/<name>.css over the base styles (design variations).
const THEME = (process.argv.find((a) => a.startsWith('--theme=')) || '').slice(8);
const DIST = path.join(ROOT, (PREVIEW ? 'preview' : 'dist') + (THEME ? `-${THEME}` : ''));
const WIDTHS = PREVIEW ? [640, 1600] : [320, 640, 1024, 1600, 2400];
const dir = (p) => (PREVIEW ? p + 'index.html' : p);
const ALL_FORMATS = [
  ['avif', (s) => s.avif({ quality: 50, effort: 4 })],
  ['webp', (s) => s.webp({ quality: 78 })],
  ['jpg', (s) => s.jpeg({ quality: 80, mozjpeg: true, progressive: true })],
];

const readJson = async (f) => JSON.parse(await fs.readFile(path.join(ROOT, f), 'utf8'));
const FORMATS = PREVIEW ? ALL_FORMATS.filter(([ext]) => ext !== 'webp') : ALL_FORMATS;
const site = await readJson('content/site.json');
// One JSON file per project in content/projects/ (this is what the /admin editor writes).
// Sorted by "order" (lowest first), then newest year first.
const projectFiles = (await fs.readdir(path.join(ROOT, 'content/projects'))).filter((f) => f.endsWith('.json'));
const projects = (await Promise.all(projectFiles.map((f) => readJson(`content/projects/${f}`).then((p) => ({ ...p, _file: f })))))
  .sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || (b.year ?? 0) - (a.year ?? 0));

// Image paths may be written as "/images/x/y.jpg" (admin editor) or "x/y.jpg"; both mean images/x/y.jpg.
const img = (src) => String(src || '').replace(/^\/?(images\/)?/, '');
for (const p of projects) {
  p.tools = Array.isArray(p.tools) ? p.tools : String(p.tools || '').split(',').map((t) => t.trim()).filter(Boolean);
  // Each frame can carry its own breakdown: a "before" (usually the plate) and optional extra
  // passes. The frame itself is the "after". Kept internally as s.layers = [before, frame, ...passes].
  const layer = (x, label) => (x && x.src ? { label: x.label || label, src: img(x.src), alt: x.alt || '' } : null);
  p.stills = (p.stills || []).map((st) => {
    const s = { ...st, src: img(st.src) };
    const b = st.breakdown || {};
    const before = layer(b.before, 'Plate');
    s.layers = before
      ? [before, { label: b.afterLabel || 'Final', src: s.src, alt: s.alt || '' }, ...(b.passes || []).map((x) => layer(x, 'Pass')).filter(Boolean)]
      : [];
    return s;
  });
}

// Reel: paste any Vimeo or YouTube link; provider + id are worked out here.
if (site.reel) {
  const u = site.reel.url || '';
  const yt = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/);
  const vm = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (yt) Object.assign(site.reel, { provider: 'youtube', id: yt[1] });
  else if (vm) Object.assign(site.reel, { provider: 'vimeo', id: vm[1] });
  if (site.reel.poster) site.reel.poster = img(site.reel.poster);
  if (!site.reel.id) delete site.reel;
}

// ---------- validation ----------
const errors = [];
const slugs = new Set();
projects.forEach((p, i) => {
  const at = `content/projects/${p._file}`;
  for (const k of ['title', 'slug', 'show', 'studio', 'year', 'role', 'description'])
    if (p[k] === undefined || p[k] === '') errors.push(`${at}: missing "${k}"`);
  if (p.slug && !/^[a-z0-9-]+$/.test(p.slug)) errors.push(`${at}: slug must be lowercase letters, digits and dashes`);
  if (slugs.has(p.slug)) errors.push(`${at}: duplicate slug`);
  slugs.add(p.slug);
  if (!Array.isArray(p.tools)) errors.push(`${at}: "tools" must be an array`);
  if (!Array.isArray(p.stills) || !p.stills.length) errors.push(`${at}: needs at least one still`);
  for (const s of p.stills || []) if (!s.src || typeof s.alt !== 'string') errors.push(`${at}: every still needs "src" and "alt"`);
});
if (errors.length) {
  console.error('content errors:\n  ' + errors.join('\n  '));
  process.exit(1);
}
for (const p of projects) if (!p.stills.some((st) => st.layers.length)) console.warn(`note: ${p._file} has no before/after yet (add a Before image to one of its frames)`);
if (!site.reel) console.warn('note: no reel link set in content/site.json (the Watch reel button is hidden)');

// ---------- images ----------
const imageSrcs = new Set();
for (const p of projects) {
  p.stills.forEach((s) => imageSrcs.add(s.src));
  p.stills.forEach((s) => s.layers.forEach((l) => imageSrcs.add(l.src)));
}
if (site.reel?.poster) imageSrcs.add(site.reel.poster);

const manifest = {};
const newer = async (a, b) => {
  try { return (await fs.stat(a)).mtimeMs > (await fs.stat(b)).mtimeMs; } catch { return true; }
};

async function processImage(src) {
  const input = path.join(ROOT, 'images', src);
  try { await fs.access(input); } catch { throw new Error(`image not found: images/${src} (run "npm run placeholders" to create stand-ins)`); }
  const { width, height } = await sharp(input).metadata();
  const widths = [...new Set([...WIDTHS.filter((w) => w < width), Math.min(width, WIDTHS.at(-1))])];
  const base = src.replace(/\.[a-z0-9]+$/i, '');
  const outDir = path.join(DIST, 'img', path.dirname(src));
  await fs.mkdir(outDir, { recursive: true });
  let encoded = 0;
  for (const w of widths) {
    for (const [ext, enc] of FORMATS) {
      const out = path.join(DIST, 'img', `${base}-${w}.${ext}`);
      if (!(await newer(input, out))) continue;
      await enc(sharp(input).resize({ width: w, withoutEnlargement: true })).toFile(out);
      encoded++;
    }
  }
  const h = (w) => Math.round((height * Math.min(w, width)) / width);
  manifest[src] = { base, width: widths.at(-1), height: h(widths.at(-1)), widths };
  return encoded;
}

async function pool(items, n, fn) {
  const queue = [...items];
  let total = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (queue.length) { const n = await fn(queue.shift()); total += n; }
  }));
  return total;
}

const t0 = Date.now();
const encodedCount = await pool(imageSrcs, 4, processImage);
console.log(`images: ${imageSrcs.size} sources, ${encodedCount} files encoded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

// Breakdown images are stacked for the wipe, so each must match its frame's shape.
for (const p of projects) {
  p.stills.forEach((st, k) => {
    const L = st.layers;
    if (L.length < 2) return;
    const ratio = (src) => manifest[src].width / manifest[src].height;
    const bad = L.filter((l) => Math.abs(ratio(l.src) - ratio(st.src)) > 0.01);
    if (bad.length) {
      console.error(`content error in ${p._file}, frame ${k + 1}: breakdown images must be the same size as the frame (${manifest[st.src].width}×${manifest[st.src].height}). Different: ${bad.map((l) => `"${l.label}" (${manifest[l.src].width}×${manifest[l.src].height})`).join(', ')}`);
      process.exit(1);
    }
  });
}


// ---------- html helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad = (n, l = 2) => String(n).padStart(l, '0');
const plural = (n, w, pl = w + 's') => `${n} ${n === 1 ? w : pl}`;

function picture(src, root, { alt = '', sizes = '100vw', eager = false, cls = '' } = {}) {
  const m = manifest[src];
  const set = (ext) => m.widths.map((w) => `${root}img/${m.base}-${w}.${ext} ${w}w`).join(', ');
  const fallback = m.widths.filter((w) => w <= 1024).at(-1) ?? m.widths[0];
  return `<picture>` +
    `<source type="image/avif" srcset="${set('avif')}" sizes="${sizes}">` +
    (FORMATS.some(([e]) => e === 'webp') ? `<source type="image/webp" srcset="${set('webp')}" sizes="${sizes}">` : '') +
    `<img src="${root}img/${m.base}-${fallback}.jpg" srcset="${set('jpg')}" sizes="${sizes}" width="${m.width}" height="${m.height}" alt="${esc(alt)}"` +
    (eager ? ` fetchpriority="high" decoding="async"` : ` loading="lazy" decoding="async"`) +
    (cls ? ` class="${cls}"` : '') + `></picture>`;
}
const largestJpg = (src, root) => `${root}img/${manifest[src].base}-${manifest[src].width}.jpg`;

function description(text) {
  const paras = Array.isArray(text) ? text : [text];
  return paras.map((t) => {
    const todo = /^TODO:?\s*/.test(t);
    return `<p>${todo ? '<span class="todo">TODO</span>' : ''}${esc(t.replace(/^TODO:?\s*/, ''))}</p>`;
  }).join('');
}

const icon = {
  frames: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="14" height="11" rx="1.5"/><path d="M7 19h13V9"/></svg>',
  split: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M12 3v18"/></svg>',
  left: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  right: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>',
  arrow: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  grid: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/></svg>',
  list: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  close: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  play: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>',
  drag: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 7l-5 5 5 5M15 7l5 5-5 5"/></svg>',
};

const css = ((await fs.readFile(path.join(ROOT, 'src/styles.css'), 'utf8')) +
  (THEME ? '\n' + (await fs.readFile(path.join(ROOT, `src/themes/${THEME}.css`), 'utf8')) : ''))
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')
  .replace(/\s*([{}:;,>])\s*/g, '$1')
  .replace(/;}/g, '}')
  .trim();

const year = new Date().getFullYear();
const siteJs = await fs.readFile(path.join(ROOT, 'src/site.js'), 'utf8');
const reel = site.reel;
const reelUrl = reel && (reel.provider === 'youtube' ? `https://www.youtube.com/watch?v=${reel.id}` : `https://vimeo.com/${reel.id}`);

// The frame that represents a project: the still marked "featured", else the first.
const keyStill = (p) => p.stills.find((s) => s.featured) || p.stills[0];
const category = (p) => p.category || 'Film';
const categories = [...new Set(projects.map(category))];
const projHref = (root, p) => dir(`${root}work/${p.slug}/`);

function layout({ root, title, desc, body, ogImage, current }) {
  const fullTitle = title ? `${title} — ${site.name}` : `${site.name} — ${site.tagline}`;
  const abs = site.url ? site.url.replace(/\/$/, '') + '/' : '';
  const nav = (href, label, key) => `<a href="${href}"${current === key ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(desc || site.description)}">
<meta name="theme-color" content="#0a0a0a">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(desc || site.description)}">
${abs && ogImage ? `<meta property="og:image" content="${abs}img/${manifest[ogImage].base}-${manifest[ogImage].widths.filter((w) => w <= 1600).at(-1)}.jpg">\n` : ''}<link rel="icon" href="data:,">
${(THEME === 'mono' ? ['geist-sans-latin-600-normal', 'geist-mono-latin-400-normal'] : ['figtree-latin-800-normal', 'figtree-latin-400-normal'])
  .map((f) => `<link rel="preload" href="${root}assets/fonts/${f}.woff2" as="font" type="font/woff2" crossorigin>`).join('\n')}
<script>document.documentElement.className='js'</script>
<style>${css.replaceAll('{{ROOT}}', root)}</style>
${PREVIEW ? '' : `<script src="${root}assets/site.js" defer></script>\n`}</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="topbar"><div class="wrap">
<a class="logo" href="${root || './'}">${esc(site.name)}</a>
<nav class="nav" aria-label="Main">
${nav(root || './', 'Work', 'work')}
${reel ? `<a href="${esc(reelUrl)}" data-reel-open>Reel</a>` : ''}
${nav(dir(`${root}about/`), 'About', 'about')}
${site.imdb ? `<a href="${esc(site.imdb)}">IMDb</a>` : ''}
${site.linkedin ? `<a href="${esc(site.linkedin)}">LinkedIn</a>` : ''}
</nav>
<a class="btn btn-ghost btn-sm" href="mailto:${esc(site.email)}">Contact</a>
</div></header>
${body}
<footer class="foot"><div class="wrap">
<a href="mailto:${esc(site.email)}">${esc(site.email)}</a>
<span>${esc(site.location)}</span>
<span class="end">© ${year} ${esc(site.name)}. Frames © their respective studios.</span>
</div></footer>
${reel ? `<dialog id="reel-dialog" class="reel-modal" data-provider="${esc(reel.provider)}" data-id="${esc(reel.id)}"${PREVIEW ? ' data-preview' : ''} aria-label="Showreel">
<button class="round-btn dlg-close" type="button" aria-label="Close">${icon.close}</button>
<div class="frame"></div>
</dialog>\n` : ''}${PREVIEW ? `<script>${siteJs}</script>\n` : ''}</body>
</html>
`;
}

// Project tile: used by the home grid and the "More work" row on project pages.
const tileSizes = '(min-width: 1560px) 354px, (min-width: 1100px) 23vw, (min-width: 768px) 31vw, 48vw';
function tile(p, root) {
  return `<a class="tile" href="${projHref(root, p)}">
<span class="tile-img">${picture(keyStill(p).src, root, { alt: '', sizes: tileSizes })}</span>
<span class="tile-title">${esc(p.title)}</span>
<span class="tile-meta">${esc(p.year)} · ${esc(p.role)}</span>
</a>`;
}

// ---------- index ----------
function indexPage() {
  const root = '';
  const heroSlugs = site.heroProjects?.length ? site.heroProjects : projects.slice(0, 3).map((p) => p.slug);
  const heroProjects = heroSlugs.map((s) => projects.find((p) => p.slug === s)).filter(Boolean);
  const slides = [];
  const total = heroProjects.length + 1;
  const sizesHero = '(min-width: 1560px) 1464px, calc(100vw - 32px)';
  slides.push(`<article class="slide is-on" aria-roledescription="slide" aria-label="1 of ${total}">
${picture(reel?.poster || keyStill(projects[0]).src, root, { alt: '', sizes: sizesHero, eager: true })}
<div class="slide-body">
<h1 class="hero-title">${esc(site.name)}</h1>
<p class="sub">${esc(site.tagline)}</p>
${site.availability && !/^TODO/.test(site.availability) ? `<p class="status"><span class="dot" aria-hidden="true"></span>${esc(site.availability)}</p>` : ''}
<div class="actions">
${reel ? `<a class="btn btn-accent" href="${esc(reelUrl)}" data-reel-open>${icon.play}Watch reel</a>` : ''}
<a class="btn btn-ghost" href="${dir('about/')}">About me</a>
</div>
</div>
</article>`);
  heroProjects.forEach((p, k) => slides.push(`<article class="slide" aria-roledescription="slide" aria-label="${k + 2} of ${total}">
<template class="lazy-pic">${picture(keyStill(p).src, root, { alt: '', sizes: sizesHero })}</template>
<div class="slide-body">
<p class="kicker">${esc(category(p))} · ${esc(p.year)}</p>
<h2 class="hero-title">${esc(p.title)}</h2>
<p class="sub">${esc(p.role)} — ${esc(p.studio)}</p>
<div class="actions"><a class="btn btn-accent" href="${projHref(root, p)}">View project</a></div>
</div>
</article>`));

  // One-line summary for cards: the "summary" field, else the first sentence of the description
  // (skipped while it is still TODO placeholder text), else the show line.
  const summary = (p) => p.summary || ((p.description && !/^TODO/.test(p.description)) ? p.description.split(/(?<=\.)\s/)[0] : `${p.show}`);
  const bdOf = (p) => (p.stills.find((st) => st.featured && st.layers.length) || p.stills.find((st) => st.layers.length) || null);

  // Grid view: cards with the frame on top, a type tag and an italic title over the image.
  const cards = projects.map((p) => {
    const k = keyStill(p);
    const bd = bdOf(p);
    return `<li data-cat="${esc(category(p))}"><a class="pcard" href="${projHref(root, p)}">
<span class="pcard-img">${picture(k.src, root, { alt: '', sizes: '(min-width: 1100px) 460px, (min-width: 640px) 46vw, 100vw' })}<span class="tag">${esc(category(p))}</span><span class="pcard-title">${esc(p.title)}</span></span>
<span class="pcard-body"><span class="pcard-by">${esc(p.role)} · ${esc(p.studio)}</span><span class="pcard-sum">${esc(summary(p))}</span></span>
<span class="pcard-foot"><span>${icon.frames}${plural(p.stills.length, 'frame')}</span>${bd ? `<span>${icon.split}Before / after</span>` : ''}<span class="end">${esc(p.year)}</span></span>
</a></li>`;
  }).join('\n');

  // List view (default): one row per project — plate + final, title, role, year, tools, show, breakdown.
  const rows = projects.map((p) => {
    const k = keyStill(p);
    const bd = bdOf(p);
    const before = bd ? bd.layers[0] : null;
    const after = bd ? bd.layers[1] : k;
    return `<li data-cat="${esc(category(p))}"><a class="prow" href="${projHref(root, p)}">
<span class="prow-media">${before ? `<span class="prow-before">${picture(before.src, root, { alt: '', sizes: '128px' })}</span>` : ''}<span class="prow-after">${picture(after.src, root, { alt: '', sizes: '(min-width: 768px) 224px, 60vw' })}${bd ? `<span class="prow-icon" aria-hidden="true">${icon.split}</span>` : ''}</span></span>
<span class="prow-info">
<span class="prow-top"><span class="prow-title">${esc(p.title)}</span><span class="prow-role">${esc(p.role)} · ${esc(category(p))}</span><span class="box">${esc(p.year)}</span></span>
<span class="prow-tools">${p.tools.map((t) => `<span class="box">${esc(t)}</span>`).join('')}</span>
<span class="prow-show">${[p.show, p.studio].filter(Boolean).map(esc).join(' · ')}</span>
${bd ? `<span class="prow-bd"><span class="lbl">Breakdown</span>${bd.layers.map((l) => esc(l.label)).join(' · ')}</span>` : ''}
</span>
<span class="prow-go" aria-hidden="true">${icon.arrow}</span>
</a></li>`;
  }).join('\n');

  const body = `<main id="main">
<div class="wrap hero-wrap">
<section class="hero" data-carousel aria-roledescription="carousel" aria-label="Featured work">
${slides.join('\n')}
<button class="hero-arrow prev" type="button" aria-label="Previous slide">${icon.left}</button>
<button class="hero-arrow next" type="button" aria-label="Next slide">${icon.right}</button>
<div class="dots">${slides.map((_, k) => `<button type="button" aria-label="Go to slide ${k + 1}" aria-current="${k === 0}"></button>`).join('')}</div>
</section>
</div>

<section id="work" class="section wrap" aria-labelledby="work-h" data-browse>
<div class="section-head">
<h2 id="work-h">Work</h2>
<span class="count" data-count>${plural(projects.length, 'project')}</span>
<div class="head-end">
<div class="tabs" role="group" aria-label="Filter by type">
<button type="button" data-filter="all" aria-pressed="true">All</button>
${categories.map((c) => `<button type="button" data-filter="${esc(c)}" aria-pressed="false">${esc(c)}</button>`).join('\n')}
</div>
<div class="views" role="group" aria-label="Layout">
<button type="button" data-view="list" aria-pressed="true" aria-label="List view">${icon.list}</button>
<button type="button" data-view="grid" aria-pressed="false" aria-label="Grid view">${icon.grid}</button>
</div>
</div>
</div>
<ul class="prows" data-view-panel="list">
${rows}
</ul>
<ul class="pcards" data-view-panel="grid" hidden>
${cards}
</ul>
</section>
</main>`;
  return layout({ root, body, ogImage: reel?.poster, current: 'work' });
}

// ---------- project ----------
function projectPage(p, i) {
  const root = '../../';
  // The next four projects in the site's order, wrapping around, so each page shows a different set.
  const more = [1, 2, 3, 4].map((k) => projects[(i + k) % projects.length]).filter((o, k, a) => o !== p && a.indexOf(o) === k);

  // The frames are the hero: full width at the top of the page. A frame with a breakdown is a
  // before/after slider; one without is the plain frame. Thumbnails underneath switch frames.
  const n = p.stills.length;
  const sizesView = '100vw';
  const panel = (st, k) => {
    const L = st.layers;
    const m = manifest[st.src];
    const fit = `style="--ar:${m.width} / ${m.height};--arn:${(m.width / m.height).toFixed(4)}"`;
    const full = `<a class="full-link" href="${largestJpg(st.src, root)}" data-lb data-i="${k}">View full size</a>`;
    if (L.length < 2) {
      return `<div class="frame-panel${k === 0 ? ' is-on' : ''}" data-panel="${k}">
<div class="stage"><div class="fit" ${fit}>
<a class="still" href="${largestJpg(st.src, root)}" aria-label="Open frame ${k + 1} full size" data-lb-proxy="${k}">${picture(st.src, root, { alt: st.alt, sizes: sizesView, eager: k === 0 })}</a>
</div></div>
<div class="wrap panel-bar">${st.caption ? `<span class="hint">${esc(st.caption)}</span>` : ''}${full}</div>
</div>`;
    }
    const passes = L.length > 2;
    return `<div class="frame-panel${k === 0 ? ' is-on' : ''}" data-panel="${k}" data-breakdown>
<div class="stage"><div class="fit" ${fit}>
<div class="wipe">
${L.map((l, j) => `<figure class="wipe-layer" data-label="${esc(l.label)}">${picture(l.src, root, { alt: l.alt || l.label, sizes: sizesView, eager: k === 0 && j < 2 })}<figcaption>${esc(l.label)}</figcaption></figure>`).join('\n')}
<span class="tag wipe-tag a" aria-hidden="true"></span><span class="tag wipe-tag b" aria-hidden="true"></span>
<div class="wipe-handle" role="slider" tabindex="0" aria-label="Wipe position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50"><span class="wipe-knob">${icon.drag}</span></div>
</div>
</div></div>
<div class="wrap panel-bar">
${passes ? `<div class="tabs" role="group" aria-label="Compare ${esc(L[0].label)} with">${L.slice(1).map((l, j) => `<button type="button" data-layer data-i="${j + 1}" aria-pressed="${j === 0}">${esc(l.label)}</button>`).join('')}</div>` : ''}
<span class="hint wipe-hint">Drag to compare</span>${full}
</div>
<p class="vh" aria-live="polite" data-live></p>
</div>`;
  };

  const body = `<main id="main" class="p-layout">
<header class="p-head">
<p class="kicker">${esc(category(p))} · ${esc(p.year)}</p>
<h1 class="p-title">${esc(p.title)}</h1>
<p class="p-sub">${[p.show, p.studio, p.role].filter(Boolean).map(esc).join(' · ')}</p>
</header>
<section class="p-hero" aria-label="Frames" data-frames>
${n > 0 ? `<div class="wrap thumbs" role="group" aria-label="Choose a frame">
${p.stills.map((st, k) => `<button type="button" class="thumb" data-show="${k}" aria-pressed="${k === 0}" aria-label="Frame ${k + 1}${st.layers.length ? ', Before / after' : ''}">${picture(st.src, root, { alt: '', sizes: '(min-width: 768px) 384px, 312px' })}${st.layers.length ? '<span class="tag">Before / after</span>' : ''}</button>`).join('\n')}
</div>` : ''}
${p.stills.map(panel).join('\n')}
</section>
<div class="p-desc">
<ul class="chips" aria-label="Tools">${p.tools.map((t) => `<li class="chip">${esc(t)}</li>`).join('')}</ul>
<section class="p-what" aria-labelledby="what-h">
<h2 id="what-h" class="label">What I did</h2>
<div class="prose">${description(p.description)}</div>
</section>
</div>
</main>
${more.length ? `<section class="section wrap more-work" aria-labelledby="more-h">
<div class="section-head"><h2 id="more-h">More work</h2></div>
<ul class="tiles">
${more.map((o) => `<li>${tile(o, root)}</li>`).join('\n')}
</ul>
</section>` : ''}
<dialog id="lightbox" class="lightbox" aria-label="Frame viewer">
<button class="round-btn dlg-close" type="button" aria-label="Close">${icon.close}</button>
<div class="lb-stage"></div>
<div class="lb-bar"><button class="round-btn" type="button" data-lb-prev aria-label="Previous frame">${icon.left}</button><span data-lb-count></span><button class="round-btn" type="button" data-lb-next aria-label="Next frame">${icon.right}</button></div>
</dialog>`;
  const desc = `${p.title} (${p.year}) — ${p.role}, ${p.studio}. ${site.name}.`;
  return layout({ root, title: p.title, desc, body, ogImage: keyStill(p).src, current: 'work' });
}

// ---------- about ----------
function aboutPage() {
  const root = '../';
  const byYear = new Map();
  for (const c of [...(site.credits || [])].sort((a, b) => b.year - a.year)) {
    if (!byYear.has(c.year)) byYear.set(c.year, []);
    byYear.get(c.year).push(c);
  }
  const credits = [...byYear].map(([y, list]) => `<div class="yr-group">
<h3>${esc(y)}</h3>
<ul>${list.map((c) => `<li><span class="c-t">${esc(c.title)}</span><span class="c-m">${esc(c.role)} · ${esc(c.studio)}</span></li>`).join('')}</ul>
</div>`).join('\n');

  const software = (site.software || []).map((g) => `<div class="soft-group"><h4>${esc(g.group)}</h4><ul class="chips">${g.items.map((t) => `<li class="chip">${esc(t)}</li>`).join('')}</ul></div>`).join('');
  const contact = [
    ['Email', `<a href="mailto:${esc(site.email)}">${esc(site.email)}</a>`],
    ['Based', esc(site.location)],
    site.availability && ['Status', /^TODO/.test(site.availability) ? `<span class="todo">TODO</span>${esc(site.availability.replace(/^TODO:?\s*/, ''))}` : esc(site.availability)],
    site.imdb && ['IMDb', `<a href="${esc(site.imdb)}">Profile</a>`],
    site.linkedin && ['LinkedIn', `<a href="${esc(site.linkedin)}">Profile</a>`],
  ].filter(Boolean).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');

  const body = `<main id="main" class="wrap">
<header class="about-head">
<h1 class="p-title">About</h1>
<div class="prose">${description(site.bio || [])}</div>
</header>
<div class="section p-body">
<section aria-labelledby="cr-h">
<div class="section-head"><h2 id="cr-h">Credits</h2><span class="count">${plural((site.credits || []).length, 'credit')}</span></div>
<div class="panel credits">${credits}</div>
</section>
<aside>
<section class="panel" aria-labelledby="sw-h"><h3 id="sw-h">Software</h3>${software}</section>
<section class="panel" aria-labelledby="ct-h"><h3 id="ct-h">Contact</h3><dl class="kv">${contact}</dl></section>
</aside>
</div>
</main>`;
  return layout({ root, title: 'About', body, current: 'about' });
}

function notFoundPage() {
  // Served from any depth, so links are root-absolute here.
  const body = `<main id="main" class="wrap about-head"><h1 class="p-title">Not found</h1><p class="prose">This page does not exist. <a class="view-all" href="/">Back to the work ${icon.arrow}</a></p></main>`;
  return layout({ root: '/', title: 'Not found', body });
}

// ---------- write ----------
async function write(rel, html) {
  const file = path.join(DIST, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, html);
}

// remove stale project folders (e.g. after renaming a slug)
await fs.rm(path.join(DIST, 'work'), { recursive: true, force: true });
let indexHtml = indexPage();
if (PREVIEW) {
  // The Artifact host supplies the document skeleton for the main page.
  indexHtml = indexHtml
    .replace(/<!doctype html>\s*<html[^>]*>\s*<head>\s*<meta charset[^>]*>\s*<meta name="viewport"[^>]*>\s*/, '')
    .replace(/<title>[^<]*<\/title>/, `<title>${{ square: 'Portfolio Square Variation', mono: 'Portfolio Programmatic Variation' }[THEME] || 'VFX Portfolio Preview'}</title>`)
    .replace(/<\/head>\s*<body>\s*/, '')
    .replace(/<\/body>\s*<\/html>\s*$/, '');
}
await write('index.html', indexHtml);
await write('about/index.html', aboutPage());
await write('404.html', notFoundPage());
await Promise.all(projects.map((p, i) => write(`work/${p.slug}/index.html`, projectPage(p, i))));

await fs.rm(path.join(DIST, 'assets/fonts'), { recursive: true, force: true });
await fs.mkdir(path.join(DIST, 'assets/fonts'), { recursive: true });
await fs.copyFile(path.join(ROOT, 'src/site.js'), path.join(DIST, 'assets/site.js'));
for (const d of ['src/fonts', 'src/fonts-extra'])
  for (const f of await fs.readdir(path.join(ROOT, d)))
    await fs.copyFile(path.join(ROOT, d, f), path.join(DIST, 'assets/fonts', f));

// Content editor at /admin (not in the Artifact preview, which can't reach GitHub).
if (!PREVIEW) {
  const cms = path.join(ROOT, 'node_modules/@sveltia/cms/dist');
  await fs.rm(path.join(DIST, 'admin'), { recursive: true, force: true });
  await fs.cp(path.join(ROOT, 'admin'), path.join(DIST, 'admin'), { recursive: true });
  await fs.cp(cms, path.join(DIST, 'admin'), { recursive: true, filter: (f) => !f.endsWith('.map') && !f.endsWith('.mjs') });
}

console.log(`pages: ${projects.length + 3} written to ${path.relative(ROOT, DIST)}/`);
