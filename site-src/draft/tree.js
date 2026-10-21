// A progress tree in the mascot's style. The artwork (site-src/draft/tree.svg) has six leaves and a red core
// in its crown: seven parts, one per mistake on the draft. setCount(n) shows the first n. Leaves grow out of
// the stem, bottom to top, alternating sides, and the core lights up last. Lowering the count sheds the most
// recent part (an undone fix): a leaf drops and fades, the core dims.
//
// Usage: const tree = DraftTree.create({ parent, height: 320 }); tree.setCount(3);
// The leaves are the mascot's body folded up (no legs, eye closed): slotBox/setLeaf let a bird take a leaf's place.
// Requires gsap (site-src/vendor/gsap.min.js). The element carries data-retouch-ui so Retouch never edits it.
(function (global) {
  const NS = 'http://www.w3.org/2000/svg';
  const INK = '#231f20', RED = '#ed1c24';
  const VB_W = 280.7, VB_H = 720;
  const TRUNK = 'M142.6,562.2V207.6c0-21.1,11.8-40.3,30.4-50.3,21.7-11.7,36.5-34.7,36.3-61.1-.2-37.1-30.2-67.8-67.4-68.7-38.9-.9-70.7,30.3-70.7,69s14.9,49.5,36.8,61.1c18.5,9.8,30,29.1,30,50v354.6c0,24.7-13.6,47.2-35.3,59-24.4,13.3-41,39.2-41,68.9,0,1.2.9,2.3,2,2.4s2.5-.9,2.5-2.3c0-40.8,33.2-74,74-74s74,33.1,74,73.9c0,1.2.9,2.3,2,2.4s2.5-.9,2.5-2.3c0-29.6-16.5-55.5-40.8-68.9-21.7-11.9-35.5-34.4-35.5-59.1Z';
  const BASE = 'M188.4,692.5c5.7,0,10-5.2,9-10.8-5.1-26.9-28.7-47.2-57-47.2s-52,20.3-57,47.2c-1.1,5.6,3.2,10.8,9,10.8h96.1Z';
  // One leaf shape, drawn for the right side with its top edge at y = 0 (the red half and the black half).
  // Right leaves are this shape moved down; left leaves are the same shape moved left by 100.1 (as drawn).
  const leaf = (dx, dy) => [
    `M${207 + dx},${245.2 + dy}h-47.3c-8.2,0-14.9,6.7-14.9,14.9v53.4l14.1-14.1,58.5-58.5c-2.8,2.8-6.6,4.4-10.5,4.4Z`,
    `M${232.2 + dx},${226.2 + dy}l-14.6,14.6s0,0,0,0l-58.5,58.5,4.3-4.3c2.8-2.8,6.6-4.4,10.5-4.4h47.3c8.2,0,14.9-6.7,14.9-14.9v-48c0-2-2.4-3-3.8-1.6Z`
  ];
  // Growth order: bottom to top, alternating sides. Each leaf grows out of the stem from its pivot.
  const LEAVES = [
    { dx: -100.1, dy: 242.1, side: -1 },  // left, bottom   (drawn at 106.9,487.3)
    { dx: 0, dy: 182.1, side: 1 },        // right, bottom  (207,427.3)
    { dx: -100.1, dy: 151, side: -1 },    // left, middle   (106.9,396.2)
    { dx: 0, dy: 91, side: 1 },           // right, middle  (207,336.2)
    { dx: -100.1, dy: 60, side: -1 },     // left, top      (106.9,305.2)
    { dx: 0, dy: 0, side: 1 }             // right, top     (207,245.2)
  ];
  const STEM_R = 144.8, STEM_L = 136;     // where right and left leaves meet the stem

  const mk = (tag, attrs, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };

  function create(opts = {}) {
    const gsap = global.gsap;
    if (!gsap) throw new Error('DraftTree needs gsap loaded first (site-src/vendor/gsap.min.js).');
    const parent = opts.parent || document.body;
    const height = opts.height || 320;
    const width = Math.round(height * VB_W / VB_H);
    const reduce = opts.reduce != null ? opts.reduce : matchMedia('(prefers-reduced-motion: reduce)').matches;

    const el = document.createElement('div');
    el.setAttribute('data-retouch-ui', '');
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = `position:absolute;width:${width}px;height:${height}px;pointer-events:none;`;
    if (opts.style) el.style.cssText += opts.style;
    const svg = mk('svg', { viewBox: `0 0 ${VB_W} ${VB_H}`, width: '100%', height: '100%', style: 'overflow:visible;display:block' }, el);
    const sway = mk('g', {}, svg);                         // the whole tree sways a little when a leaf lands
    mk('path', { d: TRUNK, fill: INK }, sway);
    const core = mk('circle', { cx: 140.3, cy: 96.5, r: 30.4, fill: RED }, sway);
    const leaves = LEAVES.map((L) => {
      const g = mk('g', {}, sway);
      const [red, black] = leaf(L.dx, L.dy);
      mk('path', { d: red, fill: RED }, g);
      mk('path', { d: black, fill: INK }, g);
      // pivot on the stem-side edge: the red half's left edge for right leaves (x 144.8, y 260-313), the black
      // half's right edge for left leaves (x 136, y 228-276), both before the leaf's own offset
      const px = L.side > 0 ? STEM_R : STEM_L;
      const py = (L.side > 0 ? 285 : 252) + L.dy;
      gsap.set(g, { svgOrigin: `${px} ${py}`, scale: 0, rotation: -40 * L.side, opacity: 0 });
      // a closed eye in the red half: leaves are sleeping birds (blink() opens it for a moment)
      const eye = mk('circle', { cx: 166 + L.dx, cy: 263 + L.dy, r: 7.5, fill: INK }, g);
      gsap.set(eye, { svgOrigin: `${166 + L.dx} ${263 + L.dy}`, scaleY: 0 });
      g.__eye = eye;
      return g;
    });
    mk('path', { d: BASE, fill: INK }, svg);
    gsap.set(sway, { svgOrigin: '140.3 692' });
    gsap.set(core, { svgOrigin: '140.3 96.5', scale: 0.35, fill: INK });
    parent.appendChild(el);

    let count = 0;
    const api = { el, width, height, get count() { return count; } };

    function grow(i, instant) {
      const g = leaves[i], side = LEAVES[i].side;
      gsap.killTweensOf([g, g.__eye]);
      gsap.set(g.__eye, { scaleY: 0 });   // a new leaf is asleep
      if (instant || reduce) { gsap.set(g, { scale: 1, rotation: 0, opacity: 1, y: 0 }); return; }
      gsap.timeline()
        .set(g, { scale: 0, rotation: -40 * side, opacity: 1, y: 0 })
        .to(g, { scale: 1, rotation: 0, duration: 0.7, ease: 'back.out(2.2)' });
      gsap.timeline()
        .to(sway, { rotation: 1.2 * side, duration: 0.25, ease: 'sine.out' })
        .to(sway, { rotation: 0, duration: 0.9, ease: 'elastic.out(1, 0.35)' });
    }
    function shed(i, instant) {
      const g = leaves[i], side = LEAVES[i].side;
      gsap.killTweensOf(g);
      if (instant || reduce) { gsap.set(g, { scale: 0, opacity: 0 }); return; }
      gsap.timeline()
        .to(g, { rotation: 25 * side, duration: 0.2, ease: 'power1.in' })
        .to(g, { y: 260, rotation: 70 * side, opacity: 0, duration: 0.8, ease: 'power2.in' })
        .set(g, { scale: 0, y: 0, rotation: -40 * side });
    }
    function light(on, instant) {
      gsap.killTweensOf(core);
      if (instant || reduce) { gsap.set(core, { scale: on ? 1 : 0.35, fill: on ? RED : INK }); return; }
      if (on) {
        gsap.timeline()
          .to(core, { fill: RED, duration: 0.01 })
          .to(core, { scale: 1.25, duration: 0.25, ease: 'power2.out' })
          .to(core, { scale: 1, duration: 0.6, ease: 'elastic.out(1, 0.4)' });
      } else {
        gsap.to(core, { scale: 0.35, fill: INK, duration: 0.35, ease: 'power2.in' });
      }
    }

    // Show the first n of the seven parts: six leaves, then the core.
    api.setCount = (n, instant = false) => {
      n = Math.max(0, Math.min(7, n | 0));
      if (n === count && !instant) return;
      const from = instant ? 0 : count;
      if (instant) { leaves.forEach((_, i) => shed(i, true)); light(false, true); }
      if (n > from) {
        let delay = 0;
        for (let k = from; k < n; k++) {
          const part = k;
          gsap.delayedCall(instant ? 0 : delay, () => (part < 6 ? grow(part, instant) : light(true, instant)));
          delay += 0.18;
        }
      } else {
        for (let k = from - 1; k >= n; k--) (k < 6 ? shed(k, instant) : light(false, instant));
      }
      count = n;
    };

    // Where leaf i sits, in viewport coordinates, whether or not it is showing. Same box as the bird's body
    // (DraftBird placeBody) so a bird can take a leaf's place exactly; leaves all face right.
    api.slotBox = (i) => {
      const r = el.getBoundingClientRect(), k = r.width / VB_W, L = LEAVES[i];
      return { left: r.left + (144.8 + L.dx) * k, top: r.top + (226.2 + L.dy) * k, width: 91.3 * k, height: 87.3 * k };
    };
    // Show or hide one leaf instantly, outside setCount: for a bird taking off from a leaf or landing as one.
    api.setLeaf = (i, on) => {
      gsap.killTweensOf([leaves[i], leaves[i].__eye]);
      gsap.set(leaves[i].__eye, { scaleY: 0 });
      gsap.set(leaves[i], on ? { scale: 1, rotation: 0, opacity: 1, y: 0 } : { scale: 0, opacity: 0 });
    };
    api.leafShowing = (i) => Number(gsap.getProperty(leaves[i], 'opacity')) > 0.5;
    // A sleeping leaf opens its eye for a moment.
    api.blink = (i, hold = 0.9) => {
      if (reduce) return;
      const eye = leaves[i].__eye;
      gsap.timeline().to(eye, { scaleY: 1, duration: 0.12, ease: 'power2.out' }).to(eye, { scaleY: 0, duration: 0.1, delay: hold });
    };
    // Lean the leaves near a point away from it a little (the cursor rustles them); call with null to settle.
    api.rustle = (x, y) => {
      leaves.forEach((g, i) => {
        const b = api.slotBox(i), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
        const d = x == null ? Infinity : Math.hypot(cx - x, cy - y);
        const a = d < 140 ? Math.sign(cx - x || 1) * (1 - d / 140) * 10 : 0;
        if (api.leafShowing(i)) gsap.to(g, { rotation: a, duration: 0.4, ease: 'sine.out', overwrite: 'auto' });
        if (d < 90 && api.leafShowing(i) && Number(gsap.getProperty(g.__eye, 'scaleY')) < 0.1) api.blink(i, 0.6);
      });
    };

    // The whole tree bends from its base and springs back: a bird landing on it or bursting off it.
    api.shake = (strength = 1, dir = 1) => {
      if (reduce) return;
      gsap.killTweensOf(sway);
      gsap.timeline()
        .to(sway, { rotation: 3.5 * strength * dir, duration: 0.12, ease: 'power2.out' })
        .to(sway, { rotation: 0, duration: 1.2, ease: 'elastic.out(1.1, 0.28)' });
    };
    // A leaf shivers before it wakes; its eye opens partway through.
    api.tremble = (i, dur = 0.6) => {
      if (reduce) return Promise.resolve();
      const g = leaves[i];
      return new Promise((res) => gsap.timeline({ onComplete: res })
        .to(g, { rotation: 6, duration: 0.05, repeat: Math.round(dur / 0.05), yoyo: true, ease: 'sine.inOut' })
        .to(g.__eye, { scaleY: 1, duration: 0.1 }, dur * 0.55)
        .to(g, { rotation: 0, duration: 0.05 }));
    };
    api.leafCount = LEAVES.length;

    api.destroy = () => { gsap.killTweensOf([core, sway, ...leaves]); el.remove(); };
    return api;
  }

  global.DraftTree = { create };
})(typeof self !== 'undefined' ? self : globalThis);
