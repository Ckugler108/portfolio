// Progressive enhancement only. Every page works without this file.
(() => {
  'use strict';
  // Every page opens at the top, including after Back/Forward or a reload.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  const toTop = () => { if (!location.hash) window.scrollTo(0, 0); };
  toTop();
  window.addEventListener('pageshow', toTop);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Images fade in as they arrive (lazy images only; the first frame shows at once) ----------
  const reveal = (img) => img.classList.add('is-in');
  document.querySelectorAll('img[loading="lazy"]').forEach((img) => { if (img.complete) reveal(img); });
  document.addEventListener('load', (e) => { if (e.target.tagName === 'IMG') reveal(e.target); }, true);
  document.addEventListener('error', (e) => { if (e.target.tagName === 'IMG') reveal(e.target); }, true);

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };

  // ---------- Phone menu: links live behind a Menu button in the top right ----------
  const bar = document.querySelector('.topbar');
  const menuBtn = bar && bar.querySelector('.menu-btn');
  if (menuBtn) {
    const setOpen = (open) => { bar.classList.toggle('is-open', open); menuBtn.setAttribute('aria-expanded', String(open)); menuBtn.textContent = open ? 'Close' : 'Menu'; };
    menuBtn.addEventListener('click', () => setOpen(!bar.classList.contains('is-open')));
    bar.querySelectorAll('.nav a').forEach((a) => a.addEventListener('click', () => setOpen(false)));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && bar.classList.contains('is-open')) { setOpen(false); menuBtn.focus(); } });
    document.addEventListener('click', (e) => { if (!bar.contains(e.target)) setOpen(false); });
  }

  // ---------- Hero carousel ----------
  for (const root of document.querySelectorAll('[data-carousel]')) {
    const slides = [...root.querySelectorAll('.slide')];
    const dots = [...root.querySelectorAll('.dots button')];
    let i = 0;
    // Slides after the first keep their image in a <template> until they are near.
    const hydrate = (k) => {
      const t = slides[(k + slides.length) % slides.length].querySelector('template.lazy-pic');
      if (t) t.replaceWith(t.content.cloneNode(true));
    };
    // No autoplay: the carousel moves only when the viewer asks it to.
    const go = (n) => {
      i = (n + slides.length) % slides.length;
      hydrate(i); hydrate(i + 1); hydrate(i - 1);
      slides.forEach((s, k) => {
        s.classList.toggle('is-on', k === i);
        s.inert = k !== i;
        s.setAttribute('aria-hidden', String(k !== i));
      });
      dots.forEach((d, k) => d.setAttribute('aria-current', String(k === i)));
    };
    root.querySelector('.hero-arrow.prev')?.addEventListener('click', () => go(i - 1));
    root.querySelector('.hero-arrow.next')?.addEventListener('click', () => go(i + 1));
    dots.forEach((d, k) => d.addEventListener('click', () => go(k)));
    root.addEventListener('keydown', (e) => {
      if (e.target.closest('a, button:not(.hero-arrow)')) return;
      if (e.key === 'ArrowLeft') go(i - 1);
      if (e.key === 'ArrowRight') go(i + 1);
    });
    // swipe on touch screens
    let x0 = null;
    root.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    root.addEventListener('touchend', (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1));
      x0 = null;
    });
    // Only slide 1 is visible at load; its neighbours are fetched after the page settles.
    slides.forEach((s, k) => { s.inert = k !== 0; s.setAttribute('aria-hidden', String(k !== 0)); });
    window.addEventListener('load', () => setTimeout(() => { hydrate(1); hydrate(-1); }, 1500));
  }

  // ---------- Browse: filter pills + list/grid toggle ----------
  // On the home page (data-pick="6") "All" shows 6 projects picked at random on every visit and
  // "Show all" reveals the rest; the Work page shows everything. Type filters show every match.
  for (const root of document.querySelectorAll('[data-browse]')) {
    const PICK = Number(root.dataset.pick) || Infinity;
    const filters = [...root.querySelectorAll('[data-filter]')];
    const views = [...root.querySelectorAll('[data-view]')];
    const panels = [...root.querySelectorAll('[data-view-panel]')];
    const count = root.querySelector('[data-count]');
    const more = root.querySelector('[data-show-all]');
    const total = panels[0].children.length;
    // one random order per visit, applied to both views
    const order = [...Array(total).keys()];
    if (PICK < total) for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    for (const p of panels) {
      const lis = [...p.children];
      order.forEach((k, pos) => { lis[k].dataset.pick = pos < PICK ? '1' : ''; p.append(lis[k]); });
    }
    const items = [...root.querySelectorAll('[data-cat]')];
    let showAll = total <= PICK;
    let current = 'all';
    const setFilter = (f) => {
      current = f;
      filters.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === f)));
      let n = 0;
      for (const el of items) {
        const show = f === 'all' ? (showAll || el.dataset.pick === '1') : el.dataset.cat === f;
        el.hidden = !show;
        if (show && el.closest('[data-view-panel="list"]')) n++;
      }
      const partial = f === 'all' && !showAll;
      if (count) count.textContent = partial ? `${n} of ${total} projects` : `${n} project${n === 1 ? '' : 's'}`;
      if (more) more.hidden = !partial;
    };
    const setView = (v) => {
      views.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
      panels.forEach((p) => { p.hidden = p.dataset.viewPanel !== v; });
      store.set('work-view', v);
    };
    // Reserve the height of the tallest filter so switching filters never shrinks the page
    // (which would pull the footer up and yank the scroll position).
    const reserve = () => {
      const keep = current;
      root.style.minHeight = '';
      let max = 0;
      for (const b of filters) { setFilter(b.dataset.filter); max = Math.max(max, root.offsetHeight); }
      setFilter(keep);
      root.style.minHeight = `${max}px`;
    };
    filters.forEach((b) => b.addEventListener('click', () => setFilter(b.dataset.filter)));
    views.forEach((b) => b.addEventListener('click', () => { setView(b.dataset.view); reserve(); }));
    if (more) more.addEventListener('click', () => { showAll = true; setFilter(current); reserve(); });
    setView(store.get('work-view') === 'grid' ? 'grid' : 'list');
    setFilter('all');
    reserve();
    let rt;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(reserve, 150); });
  }

  // ---------- Showreel in a modal (the link opens the video site without JS) ----------
  const reelDlg = document.getElementById('reel-dialog');
  if (reelDlg) {
    const frame = reelDlg.querySelector('.frame');
    const close = () => reelDlg.close();
    reelDlg.querySelector('.dlg-close').addEventListener('click', close);
    reelDlg.addEventListener('click', (e) => { if (e.target === reelDlg) close(); });
    reelDlg.addEventListener('close', () => frame.replaceChildren());
    for (const a of document.querySelectorAll('[data-reel-open]')) {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const { provider, id } = reelDlg.dataset;
        const iframe = document.createElement('iframe');
        iframe.src = provider === 'youtube'
          ? `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1&modestbranding=1`
          : `https://player.vimeo.com/video/${id}?autoplay=1&dnt=1&title=0&byline=0&portrait=0`;
        iframe.title = 'Showreel';
        iframe.allow = 'autoplay; fullscreen; picture-in-picture';
        iframe.allowFullscreen = true;
        if ('preview' in reelDlg.dataset) {
          const note = document.createElement('p');
          note.className = 'reel-note';
          note.textContent = 'On your live site the reel plays right here. This preview page cannot embed video.';
          frame.replaceChildren(note);
        } else frame.replaceChildren(iframe);
        reelDlg.showModal();
      });
    }
  }

  // ---------- Frames viewer: thumbnails switch the frame (and its breakdown) ----------
  for (const root of document.querySelectorAll('[data-frames]')) {
    const panels = [...root.querySelectorAll('[data-panel]')];
    const thumbs = [...root.querySelectorAll('[data-show]')];
    const select = (k) => {
      panels.forEach((p, i) => p.classList.toggle('is-on', i === k));
      thumbs.forEach((t, i) => t.setAttribute('aria-pressed', String(i === k)));
    };
    thumbs.forEach((t, i) => t.addEventListener('click', () => select(i)));
  }

  // ---------- Lightbox: full-size frames ----------
  const lb = document.getElementById('lightbox');
  if (lb) {
    const links = [...document.querySelectorAll('[data-lb]')].sort((a, b) => a.dataset.i - b.dataset.i);
    const stage = lb.querySelector('.lb-stage');
    const counter = lb.querySelector('[data-lb-count]');
    const prev = lb.querySelector('[data-lb-prev]');
    const next = lb.querySelector('[data-lb-next]');
    let i = 0;
    const show = (n) => {
      i = (n + links.length) % links.length;
      const im = document.createElement('img');
      im.src = links[i].href;
      im.alt = '';
      stage.replaceChildren(im);
      counter.textContent = links.length > 1 ? `${i + 1} / ${links.length}` : '';
    };
    const open = (k) => { show(k); lb.showModal(); };
    prev.hidden = next.hidden = links.length < 2;
    links.forEach((a, k) => a.addEventListener('click', (e) => { e.preventDefault(); open(k); }));
    for (const a of document.querySelectorAll('[data-lb-proxy]')) {
      a.addEventListener('click', (e) => { e.preventDefault(); open(links.findIndex((l) => l.dataset.i === a.dataset.lbProxy)); });
    }
    prev.addEventListener('click', () => show(i - 1));
    next.addEventListener('click', () => show(i + 1));
    lb.querySelector('.dlg-close').addEventListener('click', () => lb.close());
    lb.addEventListener('click', (e) => { if (e.target === lb || e.target === stage) lb.close(); });
    lb.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') show(i - 1);
      if (e.key === 'ArrowRight') show(i + 1);
    });
  }

  // ---------- Breakdown wipe: the before (plate) stays on the left; the right side is the
  // after (final) by default, or any extra pass (layout, CG render…) picked from the pills.
  for (const root of document.querySelectorAll('[data-breakdown]')) {
    const wipe = root.querySelector('.wipe');
    const layers = [...root.querySelectorAll('.wipe-layer')];
    const buttons = [...root.querySelectorAll('[data-layer]')];
    const handle = root.querySelector('.wipe-handle');
    const tagA = root.querySelector('.wipe-tag.a');
    const tagB = root.querySelector('.wipe-tag.b');
    const live = root.querySelector('[data-live]');
    const readout = root.querySelector('[data-readout]');
    const names = layers.map((l) => l.dataset.label);
    const last = layers.length - 1;
    let right = 1;
    let pos = 50;

    const setPos = (p) => {
      pos = Math.max(0, Math.min(100, p));
      wipe.style.setProperty('--pos', pos + '%');
      if (readout) readout.textContent = `Wipe ${String(Math.round(pos)).padStart(3, '0')}%`;
      handle.setAttribute('aria-valuenow', String(Math.round(pos)));
      handle.setAttribute('aria-valuetext', `${Math.round(pos)}%: ${names[0]} left, ${names[right]} right`);
    };
    const show = (k, announce) => {
      right = Math.max(1, Math.min(last, k));
      layers.forEach((l, i) => { l.classList.toggle('is-a', i === 0); l.classList.toggle('is-b', i === right); });
      buttons.forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.i) === right)));
      tagA.textContent = names[0];
      tagB.textContent = names[right];
      setPos(pos);
      if (announce) live.textContent = `Comparing ${names[0]} on the left with ${names[right]} on the right.`;
    };
    buttons.forEach((b) => b.addEventListener('click', () => show(Number(b.dataset.i), true)));

    // Drag anywhere on the frame. touch-action: pan-y keeps vertical page scroll on phones.
    let dragging = false;
    const fromEvent = (e) => {
      const r = wipe.getBoundingClientRect();
      setPos(((e.clientX - r.left) / r.width) * 100);
    };
    wipe.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      dragging = true;
      wipe.setPointerCapture(e.pointerId);
      fromEvent(e);
      if (e.pointerType === 'mouse') { e.preventDefault(); handle.focus({ preventScroll: true }); }
    });
    wipe.addEventListener('pointermove', (e) => { if (dragging) fromEvent(e); });
    const end = () => { dragging = false; };
    wipe.addEventListener('pointerup', end);
    wipe.addEventListener('pointercancel', end);

    handle.addEventListener('keydown', (e) => {
      const big = e.shiftKey ? 10 : 2;
      const map = { ArrowLeft: pos - big, ArrowDown: pos - big, ArrowRight: pos + big, ArrowUp: pos + big, Home: 0, End: 100 };
      if (e.key in map) { setPos(map[e.key]); e.preventDefault(); }
      else if (e.key === 'PageUp' && last > 1) { show(right === 1 ? last : right - 1, true); e.preventDefault(); }
      else if (e.key === 'PageDown' && last > 1) { show(right === last ? 1 : right + 1, true); e.preventDefault(); }
    });

    show(1, false);

    // The first time a slider comes into view it sweeps once (plate, final, back to centre) so
    // visitors see it moves. Any touch, click or key press stops it; skipped with reduced motion.
    if (!reduced && 'IntersectionObserver' in window) {
      let raf = 0;
      const stop = () => { cancelAnimationFrame(raf); raf = -1; };
      ['pointerdown', 'keydown', 'wheel'].forEach((ev) => wipe.addEventListener(ev, stop, { once: true }));
      handle.addEventListener('keydown', stop, { once: true });
      const io = new IntersectionObserver((entries) => {
        if (!entries.some((en) => en.isIntersecting && en.intersectionRatio > 0.6)) return;
        io.disconnect();
        if (raf === -1) return;
        const keys = [50, 18, 82, 50];
        const seg = 650;
        let t0 = 0;
        const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
        const tick = (now) => {
          if (raf === -1) return;
          if (!t0) t0 = now + 350;
          const t = Math.max(0, now - t0);
          const i = Math.min(keys.length - 2, Math.floor(t / seg));
          const f = Math.min(1, (t - i * seg) / seg);
          setPos(keys[i] + (keys[i + 1] - keys[i]) * ease(f));
          if (t < seg * (keys.length - 1)) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      }, { threshold: [0, 0.6, 1] });
      io.observe(wipe);
    }
  }

  // ---------- Layer build-up: layers wipe in one after another as the page scrolls ----------
  const builds = [...document.querySelectorAll('[data-build]')].map((el) => ({
    track: el.querySelector('.build-track'),
    pin: el.querySelector('.build-pin'),
    layers: [...el.querySelectorAll('.build-layer')],
    steps: [...el.querySelectorAll('.build-steps li')],
    readout: el.querySelector('[data-build-readout]'),
    last: -1,
  }));
  if (builds.length) {
    const clamp = (v) => Math.max(0, Math.min(1, v));
    const update = () => {
      for (const b of builds) {
        const r = b.track.getBoundingClientRect();
        const travel = r.height - b.pin.offsetHeight;
        const stick = parseFloat(getComputedStyle(b.pin).top) || 0;
        const t = clamp((stick - r.top) / (travel || 1)) * (b.layers.length - 1);
        let on = 0;
        b.layers.forEach((l, i) => {
          const p = i === 0 ? 1 : clamp(t - (i - 1));
          l.style.setProperty('--p', p.toFixed(4));
          l.style.setProperty('--edge', p > 0 && p < 1 ? '1' : '0');
          b.steps[i].style.setProperty('--p', p.toFixed(4));
          if (p >= 0.5) on = i;
        });
        if (on !== b.last) {
          b.last = on;
          b.steps.forEach((s, i) => s.classList.toggle('is-on', i === on));
          const pad = (n) => String(n).padStart(2, '0');
          b.readout.textContent = `Layer ${pad(on + 1)}/${pad(b.layers.length)} · ${b.layers[on].querySelector('figcaption').textContent.replace(/^\d+ /, '')}`;
        }
      }
    };
    let queued = false;
    const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; update(); }); } };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
  }

  // ---------- Motion loops ----------
  // A loop plays only while it is visible, switched on and in the active slide or frame. Nothing
  // plays by itself for people who prefer reduced motion or have Data Saver on; the button plays it.
  const saveData = navigator.connection && navigator.connection.saveData;
  const loops = [...document.querySelectorAll('[data-loop]')].map((el) => {
    const L = { el, video: el.querySelector('video'), btn: el.querySelector('[data-loop-toggle]'), tc: el.querySelector('[data-tc]'), seen: false, paused: reduced || saveData };
    const pad = (n) => String(n).padStart(2, '0');
    const tick = () => {
      const t = L.video.currentTime;
      L.tc.textContent = `TC 00:${pad(Math.floor(t / 60))}:${pad(Math.floor(t % 60))}:${pad(Math.floor((t % 1) * 24))}`;
      if (!L.video.paused) (L.video.requestVideoFrameCallback ? L.video.requestVideoFrameCallback(tick) : requestAnimationFrame(tick));
    };
    L.video.addEventListener('playing', () => { el.classList.add('is-playing'); tick(); });
    L.video.addEventListener('pause', () => el.classList.remove('is-playing'));
    L.sync = () => {
      const active = L.seen && !el.hidden && !L.paused && !el.closest('.slide:not(.is-on), .frame-panel:not(.is-on)');
      if (active && L.video.paused) L.video.play().catch(() => {});
      else if (!active && !L.video.paused) L.video.pause();
      L.btn.setAttribute('aria-label', L.paused ? 'Play loop' : 'Pause loop');
      el.classList.toggle('is-paused', L.paused);
    };
    L.btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); L.paused = !L.paused; L.sync(); });
    return L;
  });
  if (loops.length) {
    const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
      for (const en of entries) { const L = loops.find((x) => x.el === en.target); L.seen = en.isIntersecting; L.sync(); }
    }, { threshold: 0.4 }) : null;
    const start = () => loops.forEach((L) => { if (io) io.observe(L.el); else { L.seen = true; L.sync(); } });
    // Wait for the page (and its first image) to finish loading so loops never slow the first paint.
    if (document.readyState === 'complete') start(); else window.addEventListener('load', start);
    // Re-check when a slide or a frame changes.
    const mo = new MutationObserver(() => loops.forEach((L) => L.sync()));
    document.querySelectorAll('.slide, .frame-panel').forEach((n) => mo.observe(n, { attributes: true, attributeFilter: ['class'] }));
    // On a breakdown frame, the Loop button swaps the slider for the moving shot.
    for (const sw of document.querySelectorAll('[data-loop-switch]')) {
      const panel = sw.closest('.frame-panel');
      const L = loops.find((x) => panel.contains(x.el));
      sw.addEventListener('click', () => {
        const on = sw.getAttribute('aria-pressed') !== 'true';
        sw.setAttribute('aria-pressed', String(on));
        L.el.hidden = !on;
        if (on) L.paused = false;
        L.sync();
      });
    }
  }

  // ---------- Quick search: Cmd/Ctrl+K (or /) opens a project jump list ----------
  const search = document.getElementById('search');
  if (search && search.showModal) {
    const input = search.querySelector('input');
    const items = [...search.querySelectorAll('[role="option"]')];
    const empty = search.querySelector('.search-empty');
    const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    if (!mac) document.querySelectorAll('.search-btn kbd').forEach((k) => { k.textContent = 'Ctrl K'; });
    let sel = 0;
    const visible = () => items.filter((li) => !li.hidden);
    const mark = () => {
      const v = visible();
      sel = Math.max(0, Math.min(sel, v.length - 1));
      items.forEach((li) => li.setAttribute('aria-selected', 'false'));
      if (v[sel]) { v[sel].setAttribute('aria-selected', 'true'); v[sel].scrollIntoView({ block: 'nearest' }); }
    };
    const filter = () => {
      const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
      items.forEach((li) => { li.hidden = !words.every((w) => li.dataset.q.includes(w)); });
      empty.hidden = visible().length > 0;
      sel = 0; mark();
    };
    const open = () => { input.value = ''; filter(); search.showModal(); input.focus(); };
    document.querySelectorAll('[data-search-open]').forEach((b) => b.addEventListener('click', open));
    document.addEventListener('keydown', (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing && !search.open)) { e.preventDefault(); search.open ? search.close() : open(); }
    });
    input.addEventListener('input', filter);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { sel++; mark(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel--; mark(); e.preventDefault(); }
      else if (e.key === 'Enter') { const a = visible()[sel]?.querySelector('a'); if (a) { e.preventDefault(); location.href = a.href; } }
    });
    items.forEach((li) => li.addEventListener('pointermove', () => { sel = visible().indexOf(li); mark(); }));
    search.addEventListener('click', (e) => { if (e.target === search) search.close(); });
  }
})();
