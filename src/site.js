// Progressive enhancement only. Every page works without this file.
(() => {
  'use strict';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };

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

  // ---------- Horizontal card rows ----------
  for (const sec of document.querySelectorAll('[data-row-wrap]')) {
    const row = sec.querySelector('.row');
    const prev = sec.querySelector('[data-row-prev]');
    const next = sec.querySelector('[data-row-next]');
    if (!row || !prev || !next) continue;
    const update = () => {
      prev.disabled = row.scrollLeft < 4;
      next.disabled = row.scrollLeft + row.clientWidth > row.scrollWidth - 4;
    };
    const by = (dir) => row.scrollBy({ left: dir * row.clientWidth * 0.8, behavior: reduced ? 'auto' : 'smooth' });
    prev.addEventListener('click', () => by(-1));
    next.addEventListener('click', () => by(1));
    row.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  // ---------- Browse: filter pills + grid/list toggle ----------
  for (const root of document.querySelectorAll('[data-browse]')) {
    const filters = [...root.querySelectorAll('[data-filter]')];
    const views = [...root.querySelectorAll('[data-view]')];
    const panels = [...root.querySelectorAll('[data-view-panel]')];
    const items = [...root.querySelectorAll('[data-cat]')];
    const count = root.querySelector('[data-count]');
    const setFilter = (f) => {
      filters.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === f)));
      let n = 0;
      for (const el of items) {
        const show = f === 'all' || el.dataset.cat === f;
        el.hidden = !show;
        if (show && el.closest('[data-view-panel="grid"]')) n++;
      }
      if (count) count.textContent = `${n} project${n === 1 ? '' : 's'}`;
    };
    const setView = (v) => {
      views.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
      panels.forEach((p) => { p.hidden = p.dataset.viewPanel !== v; });
      store.set('work-view', v);
    };
    filters.forEach((b) => b.addEventListener('click', () => setFilter(b.dataset.filter)));
    views.forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
    setView(store.get('work-view') === 'list' ? 'list' : 'grid');
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
          ? `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`
          : `https://player.vimeo.com/video/${id}?autoplay=1&dnt=1&title=0&byline=0&portrait=0`;
        iframe.title = 'Showreel';
        iframe.allow = 'autoplay; fullscreen; picture-in-picture';
        iframe.allowFullscreen = true;
        frame.replaceChildren(iframe);
        reelDlg.showModal();
      });
    }
  }

  // ---------- Lightbox for project stills ----------
  const lb = document.getElementById('lightbox');
  if (lb) {
    const links = [...document.querySelectorAll('[data-lb]')];
    const stage = lb.querySelector('.lb-stage');
    const counter = lb.querySelector('[data-lb-count]');
    const prev = lb.querySelector('[data-lb-prev]');
    const next = lb.querySelector('[data-lb-next]');
    let i = 0;
    const show = (n) => {
      i = (n + links.length) % links.length;
      const pic = links[i].querySelector('picture').cloneNode(true);
      pic.querySelectorAll('source, img').forEach((el) => { el.setAttribute('sizes', '100vw'); el.removeAttribute('loading'); });
      stage.replaceChildren(pic);
      counter.textContent = `${i + 1} / ${links.length}`;
    };
    prev.hidden = next.hidden = links.length < 2;
    links.forEach((a, k) => a.addEventListener('click', (e) => { e.preventDefault(); show(k); lb.showModal(); }));
    prev.addEventListener('click', () => show(i - 1));
    next.addEventListener('click', () => show(i + 1));
    lb.querySelector('.dlg-close').addEventListener('click', () => lb.close());
    lb.addEventListener('click', (e) => { if (e.target === lb || e.target === stage) lb.close(); });
    lb.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') show(i - 1);
      if (e.key === 'ArrowRight') show(i + 1);
    });
  }

  // ---------- Breakdown wipe ----------
  for (const root of document.querySelectorAll('[data-breakdown]')) {
    const wipe = root.querySelector('.wipe');
    const layers = [...root.querySelectorAll('.wipe-layer')];
    const buttons = [...root.querySelectorAll('[data-layer]')];
    const handle = root.querySelector('.wipe-handle');
    const tagA = root.querySelector('.wipe-tag.a');
    const tagB = root.querySelector('.wipe-tag.b');
    const count = root.querySelector('[data-step]');
    const prev = root.querySelector('[data-prev]');
    const next = root.querySelector('[data-next]');
    const live = root.querySelector('[data-live]');
    const names = layers.map((l) => l.dataset.label);
    const steps = layers.length - 1;
    const n2 = (k) => String(k + 1).padStart(2, '0');
    let step = 1; // compares layer step-1 (left) with layer step (right)
    let pos = 50;

    const setPos = (p) => {
      pos = Math.max(0, Math.min(100, p));
      wipe.style.setProperty('--pos', pos + '%');
      handle.setAttribute('aria-valuenow', String(Math.round(pos)));
      handle.setAttribute('aria-valuetext', `${Math.round(pos)}%: ${names[step - 1]} left, ${names[step]} right`);
    };
    const setStep = (s, announce) => {
      step = Math.max(1, Math.min(steps, s));
      layers.forEach((l, k) => { l.classList.toggle('is-a', k === step - 1); l.classList.toggle('is-b', k === step); });
      buttons.forEach((b, k) => b.setAttribute('aria-pressed', String(k === step)));
      tagA.textContent = `${n2(step - 1)} ${names[step - 1]}`;
      tagB.textContent = `${n2(step)} ${names[step]}`;
      count.textContent = `Step ${step} of ${steps}`;
      prev.disabled = step === 1;
      next.disabled = step === steps;
      setPos(pos);
      if (announce) live.textContent = `Comparing ${names[step - 1]} on the left with ${names[step]} on the right.`;
    };

    buttons.forEach((b, k) => b.addEventListener('click', () => setStep(Math.max(1, k), true)));
    prev.addEventListener('click', () => setStep(step - 1, true));
    next.addEventListener('click', () => setStep(step + 1, true));

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
      else if (e.key === 'PageUp') { setStep(step - 1, true); e.preventDefault(); }
      else if (e.key === 'PageDown') { setStep(step + 1, true); e.preventDefault(); }
    });

    setStep(1, false);
  }
})();
