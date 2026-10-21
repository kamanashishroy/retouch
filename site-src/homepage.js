(function () {
  'use strict';

  const DOCK_TOP = 76;
  const HOLD = 0.3;
  let restY = 400;
  let wireLow = 240;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function getKeepOut() {
    const copy = document.getElementById('copy');
    const h1 = copy ? copy.querySelector('h1') : null;
    const lede = copy ? copy.querySelector('.lede') : null;
    const W = window.innerWidth;
    if (!copy || !h1) return [{ left: 0, right: W, top: -999, bottom: 82 }];

    const h1R = h1.getBoundingClientRect();
    const ledeR = lede ? lede.getBoundingClientRect() : { left: 0, right: 0, top: 0, bottom: 0 };
    return [
      { left: 0, right: W, top: -999, bottom: 82 },
      { left: h1R.left - 14, right: h1R.right + 14, top: h1R.top - 14, bottom: h1R.bottom + 14 },
      { left: ledeR.left - 10, right: ledeR.right + 10, top: ledeR.top - 10, bottom: ledeR.bottom + 10 }
    ];
  }

  function measure() {
    const H = window.innerHeight;
    const hero = document.getElementById('hero');
    const copy = document.getElementById('copy');
    const h1 = copy ? copy.querySelector('h1') : null;
    if (!hero || !copy || !h1) return;

    document.documentElement.style.setProperty('--copy-top', `${Math.round(clamp(H * 0.3, 190, 300))}px`);
    const top = h1.offsetTop + copy.offsetTop;
    const bottom = copy.offsetTop + copy.offsetHeight;
    wireLow = top - 34;
    restY = Math.max(bottom + 44, H * 0.5) - DOCK_TOP;

    if (window.innerWidth >= 1100) {
      hero.style.height = `${Math.round(H + restY + H * HOLD)}px`;
    } else {
      hero.style.height = '';
    }

    const dockSnap = document.getElementById('dock-snap');
    if (dockSnap) {
      dockSnap.style.top = `${Math.round(restY)}px`;
    }
  }

  function sendHeroData(iframe) {
    if (!iframe || !iframe.contentWindow) return;
    const lift = Math.max(0, restY - window.scrollY);
    iframe.contentWindow.postMessage({
      retouchWorld: 1,
      type: 'hero',
      restY,
      wireLow,
      lift,
      keepOut: getKeepOut()
    }, location.origin);
  }

  function initTryFrame() {
    if (window.innerWidth < 1100) return;
    const stage = document.getElementById('stage') || document.getElementById('try-stage');
    if (!stage) return;

    let iframe = stage.querySelector('iframe');
    if (iframe) return;

    measure();

    iframe = document.createElement('iframe');
    iframe.src = `shell.html?rest=${Math.round(restY)}&low=${Math.round(wireLow)}`;
    iframe.title = 'Try Retouch on a page an AI wrote';

    const still = stage.querySelector('.try-still');
    if (still) still.remove();

    stage.appendChild(iframe);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.body.appendChild(s);
    });
  }

  async function initPageWorld() {
    if (window.innerWidth < 1100) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (window.__pageWorldLoaded) return;
    window.__pageWorldLoaded = true;

    try {
      if (!window.gsap) await loadScript('vendor/gsap.min.js');
      if (!window.DraftBird) await loadScript('draft/bird.js');
      if (!window.DraftTree) await loadScript('draft/tree.js');
      if (!window.DraftWires) await loadScript('draft/wires.js');
      await loadScript('world/page-world.js');
      await loadScript('page-birds.js');
    } catch (err) {
      console.warn('Could not load page-world:', err);
    }
  }

  let scrollTicking = false;
  function onScroll() {
    if (!scrollTicking) {
      scrollTicking = true;
      requestAnimationFrame(() => {
        scrollTicking = false;
        const lift = Math.max(0, restY - window.scrollY);
        const copy = document.getElementById('copy');
        if (copy && window.innerWidth >= 1100) {
          copy.style.opacity = clamp(1 - window.scrollY / (restY * 0.3), 0, 1);
        }

        const iframe = document.querySelector('.stage iframe, #stage iframe');
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage({
            retouchWorld: 1,
            type: 'lift',
            lift
          }, location.origin);
        }
      });
    }
  }

  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin) return;
    if (e.data && e.data.retouchWorld && e.data.type === 'dock') {
      window.scrollTo({ top: restY, behavior: 'smooth' });
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    measure();
    const tryBtn = document.getElementById('try');
    if (tryBtn) {
      tryBtn.addEventListener('click', () => {
        window.scrollTo({ top: restY, behavior: 'smooth' });
      });
    }
  });

  window.addEventListener('load', () => {
    measure();
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(() => {
        initTryFrame();
        initPageWorld();
      }, { timeout: 2000 });
    } else {
      setTimeout(() => {
        initTryFrame();
        initPageWorld();
      }, 100);
    }
  });

  window.addEventListener('scroll', onScroll, { passive: true });

  // A gentle dock instead of CSS scroll snapping (a snap point pulled small trackpad scrolls back to the dock, so
  // the page felt stuck): when scrolling down stops just short of the dock, finish the last stretch. Never pulls
  // back up, and never acts below the dock.
  // It waits until the visitor's hands are off: no wheel, touch or key input for 400 ms (a trackpad's momentum
  // keeps sending wheel events), so it never animates against a gesture.
  let lastY = window.scrollY, goingDown = false, settleTimer = 0, lastInput = 0;
  const handsOn = () => { lastInput = performance.now(); };
  ['wheel', 'touchmove', 'keydown'].forEach((t) => window.addEventListener(t, handsOn, { passive: true, capture: true }));
  window.addEventListener('message', (e) => {
    if (e.origin === location.origin && e.data && e.data.retouchWorld && e.data.type === 'input') handsOn();
  });
  const trySettle = () => {
    clearTimeout(settleTimer);
    const idle = performance.now() - lastInput;
    if (idle < 400) { settleTimer = setTimeout(trySettle, 400 - idle + 10); return; }
    if (window.innerWidth < 1100 || !goingDown) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const gap = restY - window.scrollY;
    if (gap > 2 && gap < 160) window.scrollTo({ top: restY, behavior: 'smooth' });
  };
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    if (y !== lastY) goingDown = y > lastY;
    lastY = y;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(trySettle, 180);
  }, { passive: true });

  // In-page links (the nav, the skip link) still glide, now that the page itself has no smooth scrolling.
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || a.getAttribute('href').length < 2) return;
    const target = document.getElementById(a.getAttribute('href').slice(1));
    if (!target) return;
    e.preventDefault();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    history.replaceState(null, '', a.getAttribute('href'));
    if (a.classList.contains('skip-link')) target.focus({ preventScroll: true });
  });

  window.addEventListener('resize', () => {
    measure();
    if (window.innerWidth >= 1100) {
      initTryFrame();
      initPageWorld();
      const iframe = document.querySelector('.stage iframe, #stage iframe');
      if (iframe) sendHeroData(iframe);
    }
    onScroll();
  }, { passive: true });
})();
