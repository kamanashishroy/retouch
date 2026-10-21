// The site's mascot, rigged for GSAP. The artwork (site-src/draft/bird.svg) is used exactly as drawn: the
// black body and both legs are one path, so the rig cuts that path with clip rectangles. The body sits above the hips, and each leg is split at its knee
// diamond. The plain shafts between knee and foot are rects of the legs' exact 5-unit width, so the legs can
// be longer than drawn (double by default) without stretching the knees or feet.
//
// Usage: const bird = DraftBird.create({ parent: document.body });
//        await bird.walkTo(400); await bird.hopTo(600, 300); await bird.peck((i) => ...);
// Positions are the point between the bird's feet, in `parent`'s coordinate space (absolute positioning).
// Every action returns a Promise. Actions don't queue: check `bird.busy` or await the previous one.
// Requires gsap (site-src/vendor/gsap.min.js). Nothing here touches the page outside its own element,
// which carries data-retouch-ui so Retouch never edits or saves it.
(function (global) {
  const NS = 'http://www.w3.org/2000/svg';
  const RED = 'M274.6,59.7h-120.2c-32.2,0-58.3,26.1-58.3,58.3v185.3c0,15.5-6.1,30.3-17.1,41.3l229.5-229.5,26.6-26.6v-28.8h-60.4Z';
  const BLACK = 'M78.9,344.6l-57.3,57.3c-5.5,5.5-1.6,14.9,6.2,14.9h67.6c5.9,0,10.6,4.8,10.6,10.6v100.7c0,.8-.3,1.5-.8,2l-2.3,2.3c-1.1,1.1-1.1,2.9,0,4.1l2.3,2.3c.5.5.8,1.3.8,2v107.4c0,3.9-3.1,7-7,7h-6.9v5h32.8v-5h-6.9c-3.9,0-7-3.1-7-7v-107.3c0-.8.3-1.5.8-2l2.4-2.4c1.1-1.1,1.1-2.9,0-4.1l-2.4-2.4c-.5-.5-.8-1.3-.8-2v-100.7c0-5.9,4.8-10.6,10.6-10.6h63.7c5.9,0,10.6,4.8,10.6,10.6v100.7c0,.8-.3,1.5-.8,2l-2.3,2.3c-1.1,1.1-1.1,2.9,0,4.1l2.3,2.3c.5.5.8,1.3.8,2v107.4c0,3.9-3.1,7-7,7h-6.9v5h32.8v-5h-6.9c-3.9,0-7-3.1-7-7v-107.3c0-.8.3-1.5.8-2l2.4-2.4c1.1-1.1,1.1-2.9,0-4.1l-2.4-2.4c-.5-.5-.8-1.3-.8-2v-100.7c0-5.9,4.8-10.6,10.6-10.6h4.5c32.2,0,58.3-26.1,58.3-58.3v-185.3c0-15.5,6.1-30.3,17.1-41.3l-212.7,212.7s0,0,0,0Z';
  const INK = '#231f20', RED_FILL = '#ed1c24';
  const VB_W = 382.9;
  const HIP_Y = 417, MID = 154, HL = 108.5, HR = 198.4;   // hip line, body centre, leg centres
  const FEET_Y = 660.2;                                    // sole of the drawn feet
  let seq = 0;

  const mk = (tag, attrs, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };
  // Resolve when a timeline finishes, without replacing its own onComplete (which clears `busy`). Resolves with
  // undefined: the timeline itself is a thenable, and resolving with it would recurse.
  const done = (tl) => new Promise((resolve) => { tl.then(() => resolve()); });

  function create(opts = {}) {
    const gsap = global.gsap;
    if (!gsap) throw new Error('DraftBird needs gsap loaded first (site-src/vendor/gsap.min.js).');
    const parent = opts.parent || document.body;
    const legs = opts.legs || 2;                         // 1 = as drawn, 2 = double length
    const width = opts.width || 64;                      // on-screen width in px
    const reduce = opts.reduce != null ? opts.reduce : matchMedia('(prefers-reduced-motion: reduce)').matches;
    const extra = (legs - 1) * 121.5;                    // added to each shaft (thigh and shin)
    const vbH = 720 + 2 * extra;
    const scale = width / VB_W;                          // svg units to px
    const height = Math.round(vbH * scale);
    const feetPx = (FEET_Y + 2 * extra) * scale;         // from the box top to the soles
    const kneeY = 534.45 + extra;
    const id = `bird${++seq}-`;

    // --- build -----------------------------------------------------------------------------------------
    const el = document.createElement('div');
    el.setAttribute('data-retouch-ui', '');
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = `position:absolute;left:0;top:0;width:${width}px;height:${height}px;z-index:${opts.zIndex || 50};` +
      'pointer-events:none;will-change:transform;';
    const svg = mk('svg', { viewBox: `0 0 ${VB_W} ${vbH}`, width: '100%', height: '100%', style: 'overflow:visible;display:block' }, el);
    const defs = mk('defs', {}, svg);
    mk('path', { id: id + 'black', d: BLACK, fill: INK }, defs);
    const clip = (name, x, y, w, h) => { const c = mk('clipPath', { id: id + name }, defs); mk('rect', { x, y, width: w, height: h }, c); };
    clip('body', -50, -50, 500, 479.2);                  // body plus the hip flares, which tilt with it
    clip('knee', 40, 527.9, 234, 13.1);
    clip('foot', 40, 648, 234, 14);
    clip('side-l', 40, 0, 114, 4000);
    clip('side-r', 154, 0, 120, 4000);
    const ref = (name) => `url(#${id}${name})`;
    const flip = mk('g', {}, svg);
    const lean = mk('g', {}, flip);
    const legsG = mk('g', {}, lean);
    function buildLeg(side, cx) {
      const x0 = cx - 2.5;
      const up = mk('g', {}, legsG);
      mk('rect', { x: x0, y: 418, width: 5, height: 528.4 - 418 + extra, fill: INK }, up);   // top hides under the body
      const low = mk('g', {}, up);
      const knee = mk('g', { transform: `translate(0 ${extra})`, 'clip-path': ref('side-' + side) }, low);
      mk('use', { href: `#${id}black`, 'clip-path': ref('knee') }, knee);
      mk('rect', { x: x0, y: 540.6 + extra, width: 5, height: 648.4 - 540.6 + extra, fill: INK }, low);
      const foot = mk('g', { transform: `translate(0 ${2 * extra})`, 'clip-path': ref('side-' + side) }, low);
      mk('use', { href: `#${id}black`, 'clip-path': ref('foot') }, foot);
      return { up, low };
    }
    const far = buildLeg('r', HR);                       // far leg first, so the near leg draws over it
    const near = buildLeg('l', HL);
    const body = mk('g', {}, lean);
    mk('use', { href: `#${id}black`, 'clip-path': ref('body') }, body);
    mk('path', { d: RED, fill: RED_FILL }, body);
    mk('polygon', { points: '335 59.7 335 88.5 363.8 59.7 335 59.7', fill: INK }, body);
    const eye = mk('circle', { cx: 169, cy: 131.5, r: 33.2, fill: INK }, body);
    // Only the body is clickable, so the bird never blocks clicks on the page around its legs.
    const hit = mk('rect', { x: 20, y: 55, width: 350, height: 365, fill: 'transparent', style: 'pointer-events:auto;cursor:pointer' }, body);
    parent.appendChild(el);

    const P = { flip, lean, body, eye, lu: near.up, ll: near.low, ru: far.up, rl: far.low };
    gsap.set(P.lean, { svgOrigin: `${HR} ${HIP_Y}` });  // pecks tip from the front hip
    gsap.set(P.body, { svgOrigin: `${MID} ${HIP_Y}` });
    gsap.set(P.lu, { svgOrigin: `${HL} ${HIP_Y}` });
    gsap.set(P.ll, { svgOrigin: `${HL} ${kneeY}` });
    gsap.set(P.ru, { svgOrigin: `${HR} ${HIP_Y}` });
    gsap.set(P.rl, { svgOrigin: `${HR} ${kneeY}` });
    gsap.set(P.eye, { svgOrigin: '169 131.5' });
    gsap.set(P.flip, { svgOrigin: `${MID} 360` });
    const allLegs = [P.lu, P.ru, P.ll, P.rl];

    // --- state -----------------------------------------------------------------------------------------
    const pos = { x: opts.x != null ? opts.x : -100, y: opts.y != null ? opts.y : 0 };
    let facing = 1;
    const api = { el, width, height, busy: false, get x() { return pos.x; }, get y() { return pos.y; }, get facing() { return facing; } };
    const place = () => gsap.set(el, { x: pos.x - MID * scale, y: pos.y - feetPx });   // pos is the point between the feet
    place();
    const begin = () => { api.busy = true; };
    const end = () => { api.busy = false; };
    // The action in progress, so stop() can cut it short and still settle whoever is awaiting it.
    let current = null;
    const run = (tl) => new Promise((resolve) => {
      current = { tl, resolve };
      tl.then(() => { if (current && current.tl === tl) current = null; resolve(); });
    });

    // --- life: breathe and blink; never stops, actions layer on top --------------------------------------
    const idle = [];
    if (!reduce) {
      idle.push(gsap.to(P.body, { scaleY: 1.015, duration: 1.6, yoyo: true, repeat: -1, ease: 'sine.inOut' }));
      (function blink() {
        idle.push(gsap.timeline({ onComplete: () => idle.push(gsap.delayedCall(2.5 + Math.random() * 3, blink)) })
          .to(P.eye, { scaleY: 0.1, duration: 0.07, ease: 'power1.in' })
          .to(P.eye, { scaleY: 1, duration: 0.12, ease: 'power1.out' }));
      })();
    }

    // --- actions ---------------------------------------------------------------------------------------
    // Blink once, on demand (the idle blinks keep running on their own). A folded bird opens its eye for
    // `hold` seconds instead, then closes it again.
    api.blink = (hold = 0) => {
      if (reduce) return Promise.resolve();
      return done(gsap.timeline()
        .to(P.eye, { scaleY: hold ? 1 : 0.1, duration: 0.08, ease: 'power1.in' })
        .to(P.eye, { scaleY: hold ? 0 : 1, duration: 0.12, ease: 'power1.out', delay: hold }));
    };

    api.setPos = (x, y) => { pos.x = x; if (y != null) pos.y = y; place(); };

    api.face = (dir, instant) => {
      if (!dir || dir === facing) return;
      facing = dir;
      gsap.to(P.flip, { scaleX: dir, duration: reduce || instant ? 0 : 0.12, ease: 'power1.inOut' });
    };

    // One stride: the swinging leg lifts with the knee folding, swings forward, plants. The body dips once.
    function stride(tl, up, low, dur) {
      tl.to(up, { rotation: -24, duration: dur * 0.5, ease: 'sine.out' }, '<')
        .to(low, { rotation: 38, duration: dur * 0.35, ease: 'sine.out' }, '<')
        .to(low, { rotation: 0, duration: dur * 0.4, ease: 'sine.in' }, `<${dur * 0.3}`)
        .to(up, { rotation: 10, duration: dur * 0.5, ease: 'sine.inOut' })
        .to(P.body, { y: 5, duration: dur * 0.25, yoyo: true, repeat: 1, ease: 'sine.inOut' }, `<-${dur * 0.5}`);
    }

    // Walk along the current ground line at about `speed` px/s.
    api.walkTo = (x, speed = 260) => {
      const dist = x - pos.x;
      if (Math.abs(dist) < 4) return Promise.resolve();
      api.face(Math.sign(dist));
      begin();
      if (reduce) { api.setPos(x); end(); return Promise.resolve(); }
      const total = Math.abs(dist) / speed;
      const steps = Math.max(2, Math.round(total / 0.3));
      const dur = total / steps;
      const tl = gsap.timeline({ onComplete: () => { gsap.to(allLegs, { rotation: 0, duration: 0.15 }); end(); } });
      for (let i = 0; i < steps; i++) {
        const leg = i % 2 ? [P.lu, P.ll] : [P.ru, P.rl];
        const t = gsap.timeline();
        stride(t, leg[0], leg[1], dur);
        t.duration(dur);
        tl.add(t);
      }
      tl.to(pos, { x, duration: tl.duration(), ease: 'none', onUpdate: place }, 0);
      return run(tl);
    };

    // Hop to (x, y) on an arc `arc` px high: crouch, launch, tuck, reach, land with a squash. `air` is the
    // flight time in seconds; longer for long flights.
    api.hopTo = (x, y = pos.y, arc = 70, air = 0.42) => {
      api.face(Math.sign(x - pos.x));
      begin();
      if (reduce) { api.setPos(x, y); end(); return Promise.resolve(); }
      const start = { x: pos.x, y: pos.y };
      const t = { v: 0 };
      const tl = gsap.timeline({ onComplete: end });
      tl.to(P.body, { y: 14, scaleY: 0.94, duration: 0.09, ease: 'power2.in' })
        .to([P.lu, P.ru], { rotation: -14, duration: 0.09 }, '<')
        .to([P.ll, P.rl], { rotation: 30, duration: 0.09 }, '<')
        .addLabel('air')
        .to(P.body, { y: 0, scaleY: 1.06, duration: 0.12, ease: 'power2.out' }, 'air')
        .to(t, { v: 1, duration: air, ease: 'power1.inOut', onUpdate() {
          pos.x = start.x + (x - start.x) * t.v;
          pos.y = start.y + (y - start.y) * t.v - Math.sin(Math.PI * t.v) * arc;
          place();
        } }, 'air')
        .to([P.lu, P.ru], { rotation: 20, duration: air * 0.45 }, 'air')
        .to([P.ll, P.rl], { rotation: 55, duration: air * 0.45 }, 'air')
        .to(allLegs, { rotation: 0, duration: air * 0.45, ease: 'power2.out' }, `air+=${air * 0.5}`)
        .to(P.body, { y: 12, scaleY: 0.9, duration: 0.07, ease: 'power2.out' }, `air+=${air}`)
        .to(P.body, { y: 0, scaleY: 1, duration: 0.35, ease: 'elastic.out(1, 0.45)' });
      return run(tl);
    };

    // Peck `times` times. The whole bird tips forward from the front hip while the legs counter-rotate, so
    // they stay upright and attached; the back foot rises onto its toes. onHit(i) fires as the beak lands.
    api.peck = (onHit, times = 2) => {
      begin();
      if (reduce) { for (let i = 0; i < times; i++) onHit && onHit(i); end(); return Promise.resolve(); }
      const L = { a: 0 };
      const apply = () => { gsap.set(P.lean, { rotation: L.a }); gsap.set([P.lu, P.ru], { rotation: -L.a }); };
      const tl = gsap.timeline({ onComplete: end });
      for (let i = 0; i < times; i++) {
        tl.to(L, { a: 30, duration: 0.14, ease: 'power3.in', onUpdate: apply })
          .call(() => onHit && onHit(i))
          .to(L, { a: 20, duration: 0.08, ease: 'power1.out', onUpdate: apply })
          .to(L, { a: 30, duration: 0.07, ease: 'power3.in', onUpdate: apply })
          .to(L, { a: 0, duration: 0.3, ease: 'back.out(2)', onUpdate: apply });
      }
      return run(tl);
    };

    // Where the beak's tip lands at full peck lean (30 degrees about the front hip), in parent coordinates.
    // Stand the bird at (target.x - (beakTarget().x - x), target.y - (beakTarget().y - y)) to peck a point.
    const PECK = 30 * Math.PI / 180, TIP = { x: 363.8, y: 59.7 };
    api.beakTarget = () => {
      const dx = TIP.x - HR, dy = TIP.y - HIP_Y;
      const bx = HR + dx * Math.cos(PECK) - dy * Math.sin(PECK);
      const by = HIP_Y + dx * Math.sin(PECK) + dy * Math.cos(PECK);
      return { x: pos.x + facing * (bx - MID) * scale, y: pos.y - (FEET_Y + 2 * extra - by) * scale };
    };

    // --- woodpecker: cling beside a target and drum on it sideways ----------------------------------------
    // cling() hangs the bird beside something: it leans back a little and its legs reach forward to brace
    // against it. drill(onHit) drums on it with fast sideways jabs, in bursts, the way a woodpecker does.
    const CLING = -8 * Math.PI / 180, JAB = 30;               // lean-back angle, jab distance (svg units)
    let clinging = false;
    api.cling = () => {
      clinging = true;
      if (reduce) return Promise.resolve();
      return run(gsap.timeline()
        .to(P.lean, { rotation: -8, duration: 0.18, ease: 'power2.out' })
        .to([P.lu, P.ru], { rotation: -38, duration: 0.18, ease: 'power2.out' }, '<')
        .to([P.ll, P.rl], { rotation: 24, duration: 0.18, ease: 'power2.out' }, '<'));
    };
    api.uncling = () => {
      clinging = false;
      if (reduce) return Promise.resolve();
      return run(gsap.timeline().to([P.lean, ...allLegs], { rotation: 0, x: 0, duration: 0.2, ease: 'power2.out' }));
    };
    // `bursts` bursts of `taps` jabs; onHit(i) fires on every jab, i counting from 0 across all bursts.
    api.drill = (onHit, taps = 4, bursts = 2) => {
      begin();
      if (reduce) { for (let i = 0; i < taps * bursts; i++) onHit && onHit(i); end(); return Promise.resolve(); }
      const tl = gsap.timeline({ onComplete: end });
      let i = 0;
      for (let b = 0; b < bursts; b++) {
        for (let t = 0; t < taps; t++) {
          const n = i++;
          tl.to(P.lean, { x: JAB, duration: 0.045, ease: 'power2.in' })
            .call(() => onHit && onHit(n))
            .to(P.lean, { x: 0, duration: 0.05, ease: 'power1.out' });
        }
        if (b < bursts - 1) tl.to({}, { duration: 0.28 });   // the pause between bursts
      }
      return run(tl);
    };
    // Where the beak tip lands at the end of a jab while clinging, in parent coordinates; and the position to
    // give the bird (for hopTo or setPos) so that point lands on (tx, ty).
    api.drillTarget = () => {
      const dx = TIP.x - HR, dy = TIP.y - HIP_Y;
      const bx = HR + dx * Math.cos(CLING) - dy * Math.sin(CLING) + JAB;
      const by = HIP_Y + dx * Math.sin(CLING) + dy * Math.cos(CLING);
      return { x: pos.x + facing * (bx - MID) * scale, y: pos.y - (FEET_Y + 2 * extra - by) * scale };
    };
    api.clingPos = (tx, ty, dir = facing) => {
      const dx = TIP.x - HR, dy = TIP.y - HIP_Y;
      const bx = HR + dx * Math.cos(CLING) - dy * Math.sin(CLING) + JAB;
      const by = HIP_Y + dx * Math.sin(CLING) + dy * Math.cos(CLING);
      return { x: tx - dir * (bx - MID) * scale, y: ty + (FEET_Y + 2 * extra - by) * scale };
    };

    // --- folded: the bird as a leaf -------------------------------------------------------------------------
    // The tree's leaves are this bird's body without legs or eye. fold() tucks the legs away and closes the
    // eye; unfold() brings them back. bodyBox()/placeBody() line the body up with a leaf's box.
    const BODY = { x0: 21.6, x1: 363.8, y0: 59.7, y1: 417 };
    api.fold = (instant) => {
      const d = instant || reduce ? 0 : 0.22;
      return run(gsap.timeline()
        .to([P.lu, P.ru], { scaleY: 0, rotation: 0, duration: d, ease: 'power2.in' })
        .to([P.ll, P.rl], { rotation: 0, duration: d }, '<')
        .to(P.eye, { scaleY: 0, duration: d * 0.6 }, '<'));
    };
    api.unfold = (instant) => {
      const d = instant || reduce ? 0 : 0.25;
      return run(gsap.timeline()
        .to(P.eye, { scaleY: 1, duration: d * 0.6, ease: 'power2.out' })
        .to([P.lu, P.ru], { scaleY: 1, duration: d, ease: 'back.out(2)' }, '<'));
    };
    api.bodyBox = () => {
      const left = facing > 0 ? pos.x + (BODY.x0 - MID) * scale : pos.x - (BODY.x1 - MID) * scale;
      return { left, top: pos.y - feetPx + BODY.y0 * scale, width: (BODY.x1 - BODY.x0) * scale, height: (BODY.y1 - BODY.y0) * scale };
    };
    api.placeBody = (left, top) => {
      pos.x = facing > 0 ? left - (BODY.x0 - MID) * scale : left + (BODY.x1 - MID) * scale;
      pos.y = top + feetPx - BODY.y0 * scale;
      place();
    };
    // A shake that sheds one red feather (a fix landed).
    api.ruffle = () => {
      if (reduce) return Promise.resolve();
      const tl = gsap.timeline();
      tl.to(P.body, { rotation: -6, duration: 0.05 })
        .to(P.body, { rotation: 6, duration: 0.05, repeat: 5, yoyo: true })
        .to(P.body, { rotation: 0, duration: 0.1 });
      const f = document.createElement('div');
      f.setAttribute('data-retouch-ui', '');
      f.style.cssText = `position:absolute;width:6px;height:6px;border-radius:50%;background:${RED_FILL};pointer-events:none;z-index:${opts.zIndex || 50}`;
      parent.appendChild(f);
      gsap.fromTo(f, { left: pos.x, top: pos.y - feetPx * 0.8 },
        { top: pos.y - 6, left: `+=${-20 * facing}`, rotation: 200, duration: 1.1, ease: 'power1.in',
          onComplete: () => gsap.to(f, { opacity: 0, delay: 0.6, onComplete: () => f.remove() }) });
      return run(tl);
    };

    // A pleased little jump on the spot (a fix was undone).
    api.smug = () => {
      if (reduce) return Promise.resolve();
      return run(gsap.timeline()
        .to(P.lean, { y: -70, duration: 0.14, ease: 'power2.out' })
        .to(P.lean, { y: 0, duration: 0.3, ease: 'bounce.out' })
        .to(P.body, { rotation: -6, duration: 0.15 }, '<')
        .to(P.body, { rotation: 0, duration: 0.3, ease: 'back.out(3)' }));
    };

    // A speech bubble above the head, gone after `hold` seconds.
    let bubbleEl = null;
    api.say = (text, hold = 0.9) => {
      if (bubbleEl) { const old = bubbleEl; gsap.killTweensOf(old); gsap.to(old, { opacity: 0, duration: 0.12, onComplete: () => old.remove() }); }
      const b = document.createElement('div');
      bubbleEl = b;
      b.setAttribute('data-retouch-ui', '');
      b.textContent = text;
      b.style.cssText = `position:absolute;padding:4px 10px;border-radius:12px;background:${INK};color:#fff;font:800 15px/1.3 Urbanist,system-ui,sans-serif;` +
        `white-space:nowrap;pointer-events:none;z-index:${(opts.zIndex || 50) + 1}`;
      parent.appendChild(b);
      // Above the head, leaning the way the bird faces; flipped to the other side if it would leave the screen.
      const pr = parent.getBoundingClientRect(), bw = b.offsetWidth;
      let left = pos.x + facing * width * 0.15, origin = '0% 100%';
      if (pr.left + left + bw > innerWidth - 8) { left = pos.x - bw + width * 0.3; origin = '100% 100%'; }
      left = Math.max(8 - pr.left, left);
      gsap.set(b, { left, top: pos.y - feetPx - 26, transformOrigin: origin });
      const tl = gsap.timeline({ onComplete: () => { b.remove(); if (bubbleEl === b) bubbleEl = null; } });
      if (reduce) tl.to(b, { opacity: 0, duration: 0.01, delay: hold });
      else tl.from(b, { scale: 0.6, opacity: 0, duration: 0.25, ease: 'back.out(3)' }).to(b, { y: -10, opacity: 0, duration: 0.3, delay: hold });
      return done(tl);   // a bubble isn't an action: stop() leaves it to finish and remove itself
    };

    // Cut the current action short: the bird stands still, upright, where it is. A pending walkTo/hopTo/peck
    // promise resolves, so code awaiting it carries on (check your own "cancelled" flag after each await).
    api.stop = () => {
      if (current) { const c = current; current = null; c.tl.kill(); c.resolve(); }
      gsap.killTweensOf(pos);
      gsap.killTweensOf([P.lean, ...allLegs]);
      gsap.killTweensOf(P.body, 'y,rotation');
      gsap.set([P.lean, ...allLegs], { rotation: 0, y: 0, x: 0 });
      gsap.set(P.body, { y: 0, rotation: 0 });
      place();
      end();
    };

    // The point between the feet inside the bird's own box, in px: use it as transform-origin to swing the
    // whole bird around its grip (hanging under a branch) or its centre.
    api.feet = () => ({ x: MID * scale, y: feetPx });
    api.center = () => ({ x: MID * scale, y: feetPx * 0.45 });

    api.onClick = (fn) => hit.addEventListener('click', (e) => { e.stopPropagation(); fn(e); });

    api.destroy = () => {
      idle.forEach((t) => t.kill());
      gsap.killTweensOf([el, pos, ...Object.values(P)]);
      el.remove();
    };
    return api;
  }

  // The `width` option is the whole artboard; the body (no legs) is 342.2 of its 382.9 units.
  global.DraftBird = { create, WIDTH_PER_BODY: 382.9 / 342.2 };
})(typeof self !== 'undefined' ? self : globalThis);
