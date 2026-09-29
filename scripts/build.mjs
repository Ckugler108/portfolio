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
const DIST = path.join(ROOT, PREVIEW ? 'preview' : 'dist');
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
const projects = await readJson('content/projects.json');

// ---------- validation ----------
const errors = [];
const slugs = new Set();
projects.forEach((p, i) => {
  const at = `projects[${i}]${p.slug ? ` (${p.slug})` : ''}`;
  for (const k of ['title', 'slug', 'show', 'studio', 'year', 'role', 'description'])
    if (p[k] === undefined || p[k] === '') errors.push(`${at}: missing "${k}"`);
  if (p.slug && !/^[a-z0-9-]+$/.test(p.slug)) errors.push(`${at}: slug must be lowercase letters, digits and dashes`);
  if (slugs.has(p.slug)) errors.push(`${at}: duplicate slug`);
  slugs.add(p.slug);
  if (!Array.isArray(p.tools)) errors.push(`${at}: "tools" must be an array`);
  if (!Array.isArray(p.stills) || !p.stills.length) errors.push(`${at}: needs at least one still`);
  for (const s of p.stills || []) if (!s.src || typeof s.alt !== 'string') errors.push(`${at}: every still needs "src" and "alt"`);
  for (const l of p.breakdownLayers || []) if (!l.src || !l.label) errors.push(`${at}: every breakdown layer needs "label" and "src"`);
});
if (errors.length) {
  console.error('content errors:\n  ' + errors.join('\n  '));
  process.exit(1);
}

// ---------- images ----------
const imageSrcs = new Set();
for (const p of projects) {
  p.stills.forEach((s) => imageSrcs.add(s.src));
  (p.breakdownLayers || []).forEach((l) => imageSrcs.add(l.src));
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


// ---------- html helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad = (n, l = 2) => String(n).padStart(l, '0');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

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
  left: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  right: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>',
  arrow: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  grid: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/></svg>',
  list: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  close: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  play: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>',
  drag: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 7l-5 5 5 5M15 7l5 5-5 5"/></svg>',
};

const css = (await fs.readFile(path.join(ROOT, 'src/styles.css'), 'utf8'))
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
<link rel="preload" href="${root}assets/fonts/figtree-latin-800-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${root}assets/fonts/figtree-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<script>document.documentElement.className='js'</script>
<style>${css.replaceAll('{{ROOT}}', root)}</style>
${PREVIEW ? '' : `<script src="${root}assets/site.js" defer></script>\n`}</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="topbar"><div class="wrap">
<a class="logo" href="${root || './'}">${esc(site.name)}</a>
<nav class="nav" aria-label="Main">
${nav(`${root || './'}#work`, 'Work', 'work')}
${reel ? `<a href="${esc(reelUrl)}"${PREVIEW ? '' : ' data-reel-open'}>Reel</a>` : ''}
${nav(dir(`${root}about/`), 'About', 'about')}
${site.imdb ? `<a href="${esc(site.imdb)}">IMDb</a>` : ''}
${site.linkedin ? `<a href="${esc(site.linkedin)}">LinkedIn</a>` : ''}
</nav>
<a class="btn btn-ghost btn-sm" href="mailto:${esc(site.email)}">Contact</a>
</div></header>
${body}
<footer class="foot"><div class="wrap">
<span class="logo">${esc(site.name)}</span>
<a href="mailto:${esc(site.email)}">${esc(site.email)}</a>
<span>${esc(site.location)}</span>
<span class="end">© ${year} ${esc(site.name)}. Frames © their respective studios.</span>
</div></footer>
${reel && !PREVIEW ? `<dialog id="reel-dialog" class="reel-modal" data-provider="${esc(reel.provider)}" data-id="${esc(reel.id)}" aria-label="Showreel">
<button class="round-btn dlg-close" type="button" aria-label="Close">${icon.close}</button>
<div class="frame"></div>
</dialog>\n` : ''}${PREVIEW ? `<script>${siteJs}</script>\n` : ''}</body>
</html>
`;
}

// Overlay card used in horizontal rows.
function card(p, root, meta) {
  return `<a class="card" href="${projHref(root, p)}">
${picture(keyStill(p).src, root, { alt: '', sizes: '(min-width: 768px) 288px, 78vw' })}
<span class="tag">${esc(category(p))}</span>
<span class="card-info"><span class="card-title">${esc(p.title)} <span class="yr">(${esc(p.year)})</span></span><span class="card-meta">${esc(meta)}</span></span>
</a>`;
}

// Before/after card: the plate on the left half, the final comp on the right.
function splitCard(p, root) {
  const L = p.breakdownLayers;
  const sizes = '(min-width: 768px) 360px, 82vw';
  return `<a class="card split" href="${projHref(root, p)}#breakdown">
${picture(L.at(-1).src, root, { alt: '', sizes })}
<span class="split-before">${picture(L[0].src, root, { alt: '', sizes })}</span>
<span class="split-line" aria-hidden="true"></span>
<span class="tag split-a">${esc(L[0].label)}</span><span class="tag split-b">${esc(L.at(-1).label)}</span>
<span class="card-info"><span class="card-title">${esc(p.title)} <span class="yr">(${esc(p.year)})</span></span><span class="card-meta">${esc(category(p))} · ${plural(L.length, 'layer')}</span></span>
</a>`;
}

function rowSection({ id, title, count, viewAll, items, cls = '' }) {
  return `<section class="section wrap" aria-labelledby="${id}" data-row-wrap>
<div class="section-head">
<h2 id="${id}">${esc(title)}</h2>
${count ? `<span class="count">${esc(count)}</span>` : ''}
${viewAll ? `<a class="view-all" href="${viewAll}">View all ${icon.arrow}</a>` : ''}
<div class="head-end"><button class="round-btn" type="button" data-row-prev aria-label="Scroll ${esc(title)} left">${icon.left}</button><button class="round-btn" type="button" data-row-next aria-label="Scroll ${esc(title)} right">${icon.right}</button></div>
</div>
<ul class="row${cls ? ` ${cls}` : ''}">
${items.map((x) => `<li>${x}</li>`).join('\n')}
</ul>
</section>`;
}

// ---------- index ----------
function indexPage() {
  const root = '';
  const heroSlugs = site.heroProjects || projects.slice(0, 3).map((p) => p.slug);
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
${reel ? `<a class="btn btn-accent" href="${esc(reelUrl)}"${PREVIEW ? '' : ' data-reel-open'}>${icon.play}Watch reel</a>` : ''}
<a class="btn btn-ghost" href="#work">See the work</a>
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

  const withBd = projects.filter((p) => (p.breakdownLayers || []).length >= 2);
  const tiles = projects.map((p) => `<li data-cat="${esc(category(p))}"><a class="tile" href="${projHref(root, p)}">
<span class="tile-img">${picture(keyStill(p).src, root, { alt: '', sizes: '(min-width: 1560px) 354px, (min-width: 1100px) 23vw, (min-width: 768px) 31vw, 48vw' })}</span>
<span class="tile-title">${esc(p.title)}</span>
<span class="tile-meta">${esc(p.year)} · ${esc(p.role)}</span>
</a></li>`).join('\n');
  const rows = projects.map((p) => `<tr data-cat="${esc(category(p))}">
<td class="l-thumb">${picture(keyStill(p).src, root, { alt: '', sizes: '104px' })}</td>
<td class="l-title"><a href="${projHref(root, p)}">${esc(p.title)}</a></td>
<td>${esc(category(p))}</td>
<td>${esc(p.studio)}</td>
<td>${esc(p.year)}</td>
<td>${esc(p.role)}</td>
<td class="l-tools">${esc(p.tools.join(', '))}</td>
</tr>`).join('\n');

  const body = `<main id="main">
<div class="wrap hero-wrap">
<section class="hero" data-carousel aria-roledescription="carousel" aria-label="Featured work">
${slides.join('\n')}
<button class="hero-arrow prev" type="button" aria-label="Previous slide">${icon.left}</button>
<button class="hero-arrow next" type="button" aria-label="Next slide">${icon.right}</button>
<div class="dots">${slides.map((_, k) => `<button type="button" aria-label="Go to slide ${k + 1}" aria-current="${k === 0}"></button>`).join('')}</div>
</section>
</div>

${withBd.length ? rowSection({
    id: 'bd-h', title: 'Plate to final', count: 'Breakdowns from ' + plural(withBd.length, 'project'), viewAll: '',
    items: withBd.map((p) => splitCard(p, root)), cls: 'row-wide',
  }) : ''}

<section id="work" class="section wrap" aria-labelledby="work-h" data-browse>
<div class="section-head">
<h2 id="work-h">All work</h2>
<span class="count" data-count>${plural(projects.length, 'project')}</span>
<div class="head-end">
<div class="tabs" role="group" aria-label="Filter by type">
<button type="button" data-filter="all" aria-pressed="true">All</button>
${categories.map((c) => `<button type="button" data-filter="${esc(c)}" aria-pressed="false">${esc(c)}</button>`).join('\n')}
</div>
<div class="views" role="group" aria-label="Layout">
<button type="button" data-view="grid" aria-pressed="true" aria-label="Grid view">${icon.grid}</button>
<button type="button" data-view="list" aria-pressed="false" aria-label="List view">${icon.list}</button>
</div>
</div>
</div>
<ul class="tiles" data-view-panel="grid">
${tiles}
</ul>
<div class="list-wrap" data-view-panel="list" hidden>
<table class="list">
<caption class="vh">All work. Each row links to a project page.</caption>
<thead><tr><th scope="col"><span class="vh">Frame</span></th><th scope="col">Project</th><th scope="col">Type</th><th scope="col">Studio</th><th scope="col">Year</th><th scope="col">Role</th><th scope="col" class="l-tools">Tools</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>
</section>
</main>`;
  return layout({ root, body, ogImage: reel?.poster, current: 'work' });
}

// ---------- project ----------
function projectPage(p, i) {
  const root = '../../';
  const layers = p.breakdownLayers || [];
  const others = [...projects.slice(i + 1), ...projects.slice(0, i)];

  const gallery = `<section class="section p-top" aria-labelledby="fr-h">
<div class="section-head"><h2 id="fr-h">Frames</h2><span class="count">${plural(p.stills.length, 'still')}</span></div>
<div class="gallery g-${Math.min(p.stills.length, 3)}">
${p.stills.map((s, k) => `<a class="still" href="${largestJpg(s.src, root)}" data-lb aria-label="Open frame ${k + 1} of ${p.stills.length} full size">${picture(s.src, root, { alt: s.alt, sizes: p.stills.length === 1 ? '(min-width: 1024px) 960px, 100vw' : p.stills.length === 2 ? '(min-width: 1560px) 724px, (min-width: 640px) 50vw, 100vw' : '(min-width: 1100px) 480px, (min-width: 640px) 50vw, 100vw', eager: k === 0 })}</a>`).join('\n')}
</div>
</section>`;

  let breakdown = '';
  if (layers.length >= 2) {
    const l0 = manifest[layers[0].src];
    breakdown = `<section id="breakdown" class="section" aria-labelledby="bd-h" data-breakdown>
<div class="section-head"><h2 id="bd-h">Breakdown</h2><span class="count">${plural(layers.length, 'layer')}</span></div>
<div class="bd-panel">
<div class="tabs" role="group" aria-label="Layer shown on the right">
${layers.map((l, k) => `<button type="button" data-layer aria-pressed="false"><span class="n">${pad(k + 1)}</span>${esc(l.label)}</button>`).join('\n')}
</div>
<div class="wipe" style="--ar:${l0.width} / ${l0.height}">
${layers.map((l, k) => `<figure class="wipe-layer" data-label="${esc(l.label)}">${picture(l.src, root, { alt: l.alt || l.label, sizes: '(min-width: 1560px) 1416px, calc(100vw - 64px)' })}<figcaption>${pad(k + 1)} ${esc(l.label)}</figcaption></figure>`).join('\n')}
<span class="tag wipe-tag a" aria-hidden="true"></span><span class="tag wipe-tag b" aria-hidden="true"></span>
<div class="wipe-handle" role="slider" tabindex="0" aria-label="Wipe position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50"><span class="wipe-knob">${icon.drag}</span></div>
</div>
<div class="wipe-ctrl">
<button class="round-btn" type="button" data-prev aria-label="Previous layer">${icon.left}</button>
<span data-step aria-hidden="true"></span>
<button class="round-btn" type="button" data-next aria-label="Next layer">${icon.right}</button>
<span class="hint">Drag across the frame. Arrow keys move the divider, Page Up / Down change layers.</span>
</div>
<p class="vh" aria-live="polite" data-live></p>
</div>
</section>`;
  }

  const details = [['Role', esc(p.role)], ['Studio', esc(p.studio)], ['Year', esc(p.year)],
    ['Tools', `<ul class="chips">${p.tools.map((t) => `<li class="chip">${esc(t)}</li>`).join('')}</ul>`]]
    .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');

  const body = `<main id="main" class="wrap">
<p class="crumbs"><a href="${root}#work">Work</a> / ${esc(category(p))}</p>
<header class="p-head">
<span class="tag">${esc(category(p))}</span>
<h1 class="p-title">${esc(p.title)} <span class="yr">(${esc(p.year)})</span></h1>
<p class="p-sub">${esc(p.show)} · ${esc(p.role)}</p>
</header>
${gallery}
${breakdown}
<section class="section p-body" aria-labelledby="what-h">
<div>
<div class="section-head"><h2 id="what-h">What I did</h2></div>
<div class="prose">${description(p.description)}</div>
</div>
<aside class="panel" aria-label="Project details">
<h3>Details</h3>
<dl class="kv">${details}</dl>
</aside>
</section>
</main>
${rowSection({ id: 'more-h', title: 'More work', count: '', viewAll: `${root}#work`, items: others.map((o) => card(o, root, `${o.role}`)) })}
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
<h1 class="hero-title">About</h1>
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
  const body = `<main id="main" class="wrap about-head"><h1 class="hero-title">Not found</h1><p class="prose">This page does not exist. <a class="view-all" href="/">Back to the work ${icon.arrow}</a></p></main>`;
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
    .replace(/<title>[^<]*<\/title>/, '<title>VFX Portfolio Preview</title>')
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
for (const f of await fs.readdir(path.join(ROOT, 'src/fonts')))
  await fs.copyFile(path.join(ROOT, 'src/fonts', f), path.join(DIST, 'assets/fonts', f));

console.log(`pages: ${projects.length + 3} written to ${path.relative(ROOT, DIST)}/`);
