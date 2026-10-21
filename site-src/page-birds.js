// Small birds with something to do, on any page that has a place for one: the footer bird beside the logo (every
// page), the bird on the wire under an About or Privacy opening, the bird on Roy's portrait and the one napping on
// the privacy policy's contents. Loads gsap and the mascot rig after `load`; nothing happens with reduced motion.
(function () {
  'use strict';
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const near = (el, e, px) => { const r = el.getBoundingClientRect(); return e.clientX > r.left - px && e.clientX < r.right + px && e.clientY > r.top - px && e.clientY < r.bottom + px; };
  const load = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.body.appendChild(s); });
  // a bird looks toward the pointer (its x in the page) unless it's in the middle of something
  const lookAt = (b, clientX) => { if (b.busy) return; const r = b.el.getBoundingClientRect(); b.face(clientX > r.left + r.width / 2 ? 1 : -1); };
  // an idle loop that stops if the bird's element leaves the page
  function every(b, lo, hi, act) {
    (async function loop() {
      await wait(lo + Math.random() * (hi - lo));
      if (!b.el.isConnected) return;
      if (!b.busy) { try { await act(); } catch (e) { /* a cut-short action is fine */ } }
      loop();
    })();
  }

  // The footer bird stands just right of the lockup. It's the logo, so hovering the logo gets "That's me."
  function footerBird() {
    const slot = document.querySelector('.footer-bird-slot');
    if (!slot || slot.dataset.bird) return;
    slot.dataset.bird = '1';
    slot.innerHTML = '';
    const b = DraftBird.create({ parent: slot, width: 22, legs: 1 });
    b.setPos(11, 22);
    let lastSaid = 0;
    const brand = slot.closest('.footer-brand');
    if (brand) brand.addEventListener('pointerenter', () => {
      if (performance.now() - lastSaid < 8000) return;
      lastSaid = performance.now();
      b.face(-1);
      b.say("That's me.", 1.2);
    });
    document.addEventListener('pointermove', (e) => { if (near(slot, e, 160)) lookAt(b, e.clientX); }, { passive: true });
    b.onClick(() => b.ruffle());
    every(b, 3500, 7000, async () => {
      const r = Math.random();
      if (r < 0.35) { b.face(-1); await b.peck(null, 2); }   // pecks at its own name
      else if (r < 0.6) await b.blink();
      else if (r < 0.8) await b.smug();
      else b.face(-b.facing);
    });
  }

  // The bird on the wire under the page's opening (About, Privacy): the static drawing becomes a live bird that
  // hops along the wire, looks at you and blinks.
  function wireBird() {
    const wire = document.querySelector('.page-wire');
    if (!wire) return;
    const still = wire.querySelector('.still-bird');
    if (still) still.style.display = 'none';
    // the wire is "M0 20 Q 720 35 1440 20" stretched to the element's width; 64px tall, so y is in px
    const yAt = (x) => { const t = Math.min(1, Math.max(0, x / wire.clientWidth)); return 20 + 30 * t * (1 - t); };
    let x = wire.clientWidth * 0.48;
    const b = DraftBird.create({ parent: wire, width: 28, legs: 1 });
    b.setPos(x, yAt(x));
    document.addEventListener('pointermove', (e) => { if (near(wire, e, 220)) lookAt(b, e.clientX); }, { passive: true });
    b.onClick(() => { b.ruffle(); b.say(pick(['hm?', '!', 'hi.']), 0.8); });
    every(b, 3000, 6500, async () => {
      const r = Math.random();
      if (r < 0.35) {
        const to = Math.min(wire.clientWidth * 0.8, Math.max(wire.clientWidth * 0.2, x + (Math.random() < 0.5 ? -1 : 1) * (40 + Math.random() * 90)));
        b.face(to > x ? 1 : -1);
        await b.hopTo(to, yAt(to), 18, 0.3);
        x = to;
      } else if (r < 0.6) await b.blink();
      else if (r < 0.8) await b.ruffle();
      else b.face(-b.facing);
    });
  }

  // About: a bird on the top edge of Roy's portrait walks along it and pecks the frame now and then, which jolts.
  function portraitBird() {
    const wrap = document.querySelector('.portrait-wrap');
    const img = wrap && wrap.querySelector('.portrait');
    if (!img || window.innerWidth < 720) return;
    const W = () => img.clientWidth;
    let x = W() * 0.7;
    const b = DraftBird.create({ parent: wrap, width: 34, legs: 1 });
    b.face(-1, true);
    b.setPos(x, 0);
    const jolt = () => gsap.fromTo(img, { rotation: b.facing > 0 ? 0.8 : -0.8 }, { rotation: 0, duration: 0.35, ease: 'elastic.out(1, 0.4)' });
    let greeted = false;
    img.addEventListener('pointerenter', () => {
      lookAt(b, img.getBoundingClientRect().left + W() / 2);
      if (!greeted && !b.busy) { greeted = true; b.say('He made me.', 1.6); }
    });
    document.addEventListener('pointermove', (e) => { if (near(wrap, e, 200)) lookAt(b, e.clientX); }, { passive: true });
    b.onClick(() => { b.ruffle(); jolt(); });
    every(b, 2600, 5200, async () => {
      const r = Math.random();
      if (r < 0.45) {
        await b.peck(jolt, 1 + Math.floor(Math.random() * 3));
      } else if (r < 0.75) {
        const to = Math.min(W() - 24, Math.max(24, x + (Math.random() < 0.5 ? -1 : 1) * (50 + Math.random() * 110)));
        b.face(to > x ? 1 : -1);
        await b.walkTo(to);
        x = to;
      } else if (r < 0.9) await b.blink();
      else await b.smug();
    });
  }

  // Privacy: a bird naps on top of the contents. The pointer wakes it; it checks on you and dozes off again.
  function tocBird() {
    const box = document.querySelector('.toc-box');
    if (!box || !box.offsetParent) return;
    const b = DraftBird.create({ parent: box, width: 30, legs: 1 });
    b.setPos(box.clientWidth - 46, 0);
    b.fold(true);
    let awake = false, saidOnce = false, dozeTimer = 0;
    const doze = () => { clearTimeout(dozeTimer); dozeTimer = setTimeout(() => { awake = false; b.fold(); }, 4000); };
    document.addEventListener('pointermove', async (e) => {
      if (!near(box, e, 120)) return;
      doze();
      if (!awake) {
        awake = true;
        await b.unfold();
        if (!saidOnce) { saidOnce = true; b.say('Nothing leaves.', 1.4); }
      }
      lookAt(b, e.clientX);
    }, { passive: true });
    // following a link in the contents: it looks down the page with you
    box.addEventListener('click', (e) => { if (e.target.closest('a') && awake) b.smug(); });
  }

  async function start() {
    try {
      if (!window.gsap) await load('vendor/gsap.min.js');
      if (!window.DraftBird) await load('draft/bird.js');
    } catch (e) { return; }
    footerBird();
    wireBird();
    portraitBird();
    tocBird();
  }
  // the homepage loads this after `load` has fired, About and Privacy before it
  if (document.readyState === 'complete') start(); else window.addEventListener('load', start);
})();
