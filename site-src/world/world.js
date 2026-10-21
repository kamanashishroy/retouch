(() => {
  const W = () => window.innerWidth;
  const H = () => window.innerHeight;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const isReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let worldActive = false;
  let busyScene = false;
  let winEl = null;
  let chromeEl = null;
  let extEl = null;
  let hintEl = null;
  let dockCatcher = null;
  let layerEl = null;
  let wiresSvg = null;
  let wires = null;
  let tree = null;
  let big = null;
  let wireBirds = [];
  let idleTimeouts = [];
  let idleBlinkTimeout = null;
  let cursor = null;
  let lastLook = 0;

  // Geometry state
  const DOCK_TOP = 76;
  const DOCK_BOTTOM = 32;
  let restY = 0;
  let wireLow = 240;
  let currentLift = 0;
  let keepOutBoxes = [];
  let moving = false;
  let moveTimer = 0;
  let rider = null;

  // Opening & intro state
  let openingFinished = false;
  let introTriggered = false;
  let openingPending = false;

  // Bar bird & narration state
  let barBird = null;
  let barObserver = null;
  let dockObserver = null;
  let seenEditFirstTime = false;
  let seenPromptFirstTime = false;
  let lastStatusText = '';
  let lastCopiedState = false;

  // Tree & fixes state
  let currentFixedCount = 0;
  let initialFixesHandled = false;
  let planted = false;
  let flyoverQueue = [];
  let isRunningFlyover = false;
  let inFlightBirds = [];
  let maxInFlightSeen = 0;
  let arrivals = 0;   // birds that have flown in for a fix (tests read it)

  // Read URL params
  try {
    const p = new URLSearchParams(window.location.search);
    if (p.has('rest')) restY = parseInt(p.get('rest'), 10) || 0;
    if (p.has('low')) wireLow = parseInt(p.get('low'), 10) || 240;
  } catch (e) {}

  // If running inside iframe, default lift is restY until parent informs otherwise
  if (window.parent && window.parent !== window && restY > 0) {
    currentLift = restY;
  } else {
    currentLift = 0;
  }

  const PLAN = [
    [0, 0.30, 'trouble'],
    [0, 0.38, 'nervous'],
    [1, 0.62, 'calm'],
    [1, 0.22, 'curious'],
    [0, 0.71, 'nervous']
  ];
  const PACE = {
    trouble: [2200, 4200],
    nervous: [1500, 3000],
    calm: [3800, 6500],
    curious: [2400, 4500]
  };

  const COUNT_LINES = [
    'One down.',
    'Two.',
    'Keep going.',
    'Four.',
    'Nearly.',
    'One left.',
    'All seven. Save it.'
  ];

  // --- Geometry & boxes ------------------------------------------------------
  const getKeepOut = () => {
    if (keepOutBoxes && keepOutBoxes.length) return keepOutBoxes;
    const h1Top = wireLow + 34;
    return [
      { left: 0, right: W(), top: -999, bottom: 82 },
      { left: W() * 0.15, right: W() * 0.85, top: h1Top - 14, bottom: h1Top + 80 }
    ];
  };

  const inside = (p, r) => p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom + 40;

  const winBox = (docked) => {
    const w = W(), h = H();
    const pad = clamp(w * 0.14, 16, 200);
    const top = docked ? DOCK_TOP : DOCK_TOP + currentLift;
    const bottom = docked ? h - DOCK_BOTTOM : h - DOCK_BOTTOM + currentLift;
    return { left: pad, right: w - pad, top, bottom, width: w - 2 * pad, height: bottom - top };
  };

  const visible = (p, docked) => {
    const r = winBox(docked);
    if (p.x < 16 || p.x > W() - 16) return false;
    if (getKeepOut().some((k) => inside(p, k))) return false;
    const windowClear = p.x < r.left - 20 || p.x > r.right + 20 || p.y < r.top - 32;
    if (!windowClear) return false;
    if (big && big.el) {
      const bR = big.el.getBoundingClientRect();
      if (p.x > bR.left - 16 && p.x < bR.right + 16 && p.y > bR.top - 16) return false;
    }
    if (tree && tree.el && planted) {
      const tR = tree.el.getBoundingClientRect();
      if (p.x > tR.left - 16 && p.x < tR.right + 16 && p.y > tR.top - 16) return false;
    }
    return true;
  };

  const visibleS = (i, docked) => {
    const out = [];
    if (!wires) return out;
    for (let s = 0.01; s < 0.99; s += 0.01) {
      if (visible(wires.point(i, s), docked)) out.push(+s.toFixed(2));
    }
    return out;
  };

  const taken = (i, except) => {
    if (!wires) return [];
    return wireBirds
      .filter((o) => o !== except && wires.riderOf(o) && wires.riderOf(o).wire === i)
      .map((o) => wires.riderOf(o).s);
  };

  const nearestFree = (i, s0, except, docked = currentLift === 0) => {
    const t = taken(i, except);
    return visibleS(i, docked)
      .filter((s) => t.every((q) => Math.abs(q - s) > 0.024))
      .reduce((a, c) => (a == null || Math.abs(c - s0) < Math.abs(a - s0) ? c : a), null);
  };

  const gutter = () => clamp(W() * 0.14, 16, 200);
  const treeH = (cap) => Math.min(cap, Math.max(40, (gutter() - 60) * 720 / 280.7));

  // --- Trees setup & plant/unplant -------------------------------------------
  function setupTrees() {
    if (tree) { try { tree.destroy(); } catch (e) {} tree = null; }
    if (big) { try { big.destroy(); } catch (e) {} big = null; }

    const reduce = isReducedMotion();
    const w = W(), h = H();

    tree = DraftTree.create({
      parent: document.body,
      height: treeH(h * 0.40),
      style: 'position:fixed;left:16px;bottom:20px;z-index:3',
      reduce
    });
    tree.el.classList.add('scenery');

    // No roost in the hero (it stands beside Questions, where it has room). A fix
    // brings a bird in from the right edge instead, so `big` stays null.

    if (currentFixedCount > 0) {
      planted = true;
      gsap.set(tree.el, { autoAlpha: 1, scaleY: 1 });
      tree.setCount(currentFixedCount, true);
    } else {
      planted = false;
      gsap.set(tree.el, { autoAlpha: 0, scaleY: 0, transformOrigin: '50% 100%' });
    }
  }

  const plant = () => {
    if (planted) return Promise.resolve();
    planted = true;
    if (tree) {
      if (!isReducedMotion()) tree.shake(0.6, 1);
      return gsap.to(tree.el, { autoAlpha: 1, scaleY: 1, duration: isReducedMotion() ? 0 : 0.6, ease: 'back.out(1.6)' }).then(() => {});
    }
    return Promise.resolve();
  };

  const unplant = () => {
    planted = false;
    if (tree) {
      return gsap.to(tree.el, { autoAlpha: 0, scaleY: 0, duration: isReducedMotion() ? 0 : 0.4, ease: 'power2.in' }).then(() => {});
    }
    return Promise.resolve();
  };

  const leavesOn = (t) => [0, 1, 2, 3, 4, 5].filter((i) => t && t.leafShowing(i));
  const slot = (t, i) => t.slotBox(i);

  // --- Wires setup -----------------------------------------------------------
  const span = (low, k) => (w) => {
    const y0 = Math.max(92, low * 0.5);
    const y1 = Math.max(84, low * 0.42 + k);
    const cy = 2 * low - (y0 + y1) / 2;
    return `M${-60} ${y0} Q ${w * (0.47 + k / 400)} ${cy} ${w + 60} ${y1}`;
  };

  function setupWires() {
    if (wires) { try { wires.destroy(); } catch (e) {} wires = null; }
    if (!wiresSvg) return;

    wires = DraftWires.create({
      svg: wiresSvg,
      curves: [
        (w, h) => span(96 + (wireLow - 96) * 0.5, 0)(w, h),
        (w, h) => span(wireLow, 12)(w, h)
      ],
      wind: 90
    });
  }

  // --- Wire birds & seating --------------------------------------------------
  function seatWireBirds() {
    if (!wires || !layerEl) return;
    wireBirds.forEach((b) => { wires.unperch(b); b.destroy(); });
    wireBirds = [];
    const docked = currentLift === 0;

    for (const [i, s0, trait] of PLAN) {
      const s = nearestFree(i, s0, null, docked);
      if (s == null) continue;
      const b = DraftBird.create({ parent: layerEl, width: 28, legs: 1, reduce: isReducedMotion() });
      b.trait = trait;
      b.home = [i, s0];
      if (Math.random() < 0.4) b.face(-1, true);
      wires.perch(b, i, s);
      wireBirds.push(b);
    }
  }

  const troublemaker = () => wireBirds.find((b) => b.trait === 'trouble');
  const neighbours = (b, range = 0.07) => {
    const r = wires ? wires.riderOf(b) : null;
    return r ? wireBirds.filter((o) => o !== b && !o.busy && wires.riderOf(o) && wires.riderOf(o).wire === r.wire && Math.abs(wires.riderOf(o).s - r.s) < range) : [];
  };
  const faceToward = (b, x) => b.face(x > b.x ? 1 : -1);

  async function hopTo_s(b, i, s, arc = 14, air = 0.26) {
    if (!wires) return;
    const r = wires.riderOf(b);
    if (r) { wires.kick(r.wire, r.s, -0.25); wires.unperch(b); }
    const p = wires.point(i, s);
    await b.hopTo(p.x, p.y, arc, air);
    if (!wires) return;
    wires.perch(b, i, s);
    wires.kick(i, s, 0.35);
  }

  async function hopAlong(b, ds) {
    if (!wires) return;
    const r = wires.riderOf(b);
    if (!r || b.busy) return;
    const s = nearestFree(r.wire, r.s + ds, b, currentLift === 0);
    if (s == null || Math.abs(s - r.s) < 0.005) return;
    await hopTo_s(b, r.wire, s);
  }

  function crowdLook(x, y, opts = {}) {
    if (!wires) return;
    const list = wireBirds
      .filter((b) => b !== opts.except && !b.busy)
      .map((b) => ({ b, d: Math.hypot(b.x - x, b.y - y) }))
      .sort((a, c) => a.d - c.d);

    list.forEach(({ b, d }, k) => {
      const delay = (b.trait === 'calm' ? 220 : b.trait === 'nervous' ? 40 : 110) + Math.min(420, d * 0.35);
      const tid = setTimeout(() => {
        if (!worldActive || b.busy) return;
        faceToward(b, x);
        if (k === 0 && opts.startle !== false && d < 220) {
          const r = wires.riderOf(b);
          b.smug();
          if (r) wires.kick(r.wire, r.s, 0.4);
        }
      }, delay);
      idleTimeouts.push(tid);
    });
  }

  async function idle(b) {
    if (!worldActive || !wireBirds.includes(b) || isReducedMotion()) return;
    try {
      await Promise.race([act(b), wait(6000)]);
    } catch (e) {
      console.error('idle error', b.trait, e);
    }
    const [lo, hi] = PACE[b.trait] || [2000, 4000];
    const tid = setTimeout(() => idle(b), lo + Math.random() * (hi - lo));
    idleTimeouts.push(tid);
  }

  async function act(b) {
    if (b.busy || busyScene || moving || !wires || !wires.riderOf(b)) return;
    const roll = Math.random();
    if (b.trait === 'trouble') {
      const n = neighbours(b, 0.09)[0];
      if (n && roll < 0.35) {
        const rn = wires.riderOf(n);
        n.say('hey!', 0.6);
        await hopAlong(n, (rn.s > wires.riderOf(b).s ? 1 : -1) * 0.04);
        await hopTo_s(b, rn.wire, rn.s, 16, 0.24);
      } else if (roll < 0.8) {
        await hopAlong(b, (Math.random() < 0.5 ? -1 : 1) * 0.03);
      } else {
        b.face(-b.facing);
        await b.smug();
      }
    } else if (b.trait === 'nervous') {
      if (roll < 0.45) b.face(-b.facing);
      else if (roll < 0.75) await hopAlong(b, (Math.random() < 0.5 ? -1 : 1) * 0.02);
      else b.ruffle();
    } else if (b.trait === 'curious') {
      if (cursor && roll < 0.6) faceToward(b, cursor.x);
      else if (roll < 0.8) b.face(-b.facing);
      else await b.smug();
    } else if (roll < 0.5) {
      b.ruffle();
    } else {
      b.face(-b.facing);
    }
  }

  // --- Bar bird --------------------------------------------------------------
  const barSpot = () => {
    const win = document.querySelector('.window');
    const winTop = win ? win.getBoundingClientRect().top : (currentLift === 0 ? DOCK_TOP : DOCK_TOP + currentLift);
    if (extEl) {
      const e = extEl.getBoundingClientRect();
      return { x: e.left + e.width / 2 - 8, y: winTop };
    }
    const w = winBox(false);
    return { x: w.right - 40, y: winTop };
  };

  const seatBarBird = () => {
    if (barBird && !barBird.busy) {
      const s = barSpot();
      barBird.setPos(s.x, s.y);
    }
  };

  function barBirdSay(text, duration = 1.8) {
    const liveEl = document.getElementById('world-live');
    if (liveEl) liveEl.textContent = text;
    if (!barBird || isReducedMotion()) return;
    barBird.say(text, duration);
  }

  // Closing Retouch in the demo goes nowhere (the build swaps the viewer's exit for this event): the bar bird
  // says so, and the edits stay.
  window.addEventListener('retouch-demo-exit', () => {
    barBirdSay('This is the demo. Your fixes stay here.', 2.2);
    if (barBird && !barBird.busy && !isReducedMotion()) barBird.smug();
  });

  // --- Scroll & room making --------------------------------------------------
  function setLift(val) {
    currentLift = Math.max(0, val);
    document.documentElement.style.setProperty('--lift', `${currentLift}px`);
    if (winEl && window.gsap) gsap.set(winEl, { y: currentLift });

    if (dockCatcher) {
      dockCatcher.classList.toggle('docked', currentLift === 0);
    }
    if (hintEl) {
      hintEl.style.opacity = currentLift > 0 ? '1' : '0';
    }

    seatBarBird();

    moving = true;
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      moving = false;
      settle();
    }, 220);

    makeRoom();

    if (rider) {
      const w = winBox(false);
      rider.b.setPos(rider.x, w.top + 1);
      if (currentLift === 0) dropRider();
    }

    if (currentLift === 0) {
      checkDockGate();
    }
  }

  function makeRoom() {
    if (!wires || isReducedMotion()) return;
    const w = winBox(false);
    for (const b of wireBirds) {
      const r = wires.riderOf(b);
      if (!r || b.busy) continue;
      const p = wires.point(r.wire, r.s);
      if (p.x < w.left - 14 || p.x > w.right + 14) continue;
      const margin = { nervous: 120, curious: 70, calm: 26, trouble: 50 }[b.trait] || 50;
      if (w.top - p.y > margin) continue;
      if (b.trait === 'trouble' && !rider && currentLift > 60) {
        ride(b);
        continue;
      }
      flee(b);
    }
  }

  async function flee(b) {
    if (!wires) return;
    const r = wires.riderOf(b);
    b.busy = true;
    let to = null;
    for (const i of [r.wire, 1 - r.wire]) {
      const s = nearestFree(i, r.s, b, true);
      if (s != null) { to = { i, s }; break; }
    }
    if (!to) { b.busy = false; return; }
    if (b.trait === 'nervous') b.say('!', 0.4);
    faceToward(b, wires.point(to.i, to.s).x);
    await hopTo_s(b, to.i, to.s, 40, 0.42);
    b.busy = false;
    crowdLook(b.x, b.y, { except: b, startle: false });
  }

  async function ride(b) {
    if (!wires) return;
    const r = wires.riderOf(b);
    wires.unperch(b);
    wires.kick(r.wire, r.s, -0.6);
    b.busy = true;
    const w = winBox(false);
    const x = clamp(b.x, w.left + 60, w.right - 120);
    rider = { b, x };
    await b.hopTo(x, w.top + 1, 26, 0.3);
    b.say('wheee', 0.7);
    if (currentLift === 0) dropRider();
  }

  async function dropRider() {
    if (!rider || !wires) return;
    const { b } = rider;
    rider = null;
    const wire = nearestFree(0, 0.2, b, true) != null ? 0 : 1;
    const s = nearestFree(wire, 0.2, b, true);
    await wait(500);
    b.say('heh.', 0.5);
    if (s != null) {
      await hopTo_s(b, wire, s, 60, 0.55);
    }
    b.busy = false;
  }

  function settle() {
    if (currentLift < restY - 4 || !wires) return;
    if (rider) {
      const { b } = rider;
      rider = null;
      b.busy = false;
      const s = nearestFree(0, b.home[1], b, false);
      if (s != null) hopTo_s(b, 0, s, 40, 0.4);
    }
    wireBirds.forEach((b, k) => {
      const r = wires.riderOf(b);
      if (!r || b.busy) return;
      const [i, s0] = b.home;
      if (Math.abs(r.s - s0) < 0.06 && r.wire === i) return;
      setTimeout(async () => {
        if (!wires || b.busy || currentLift < restY - 4) return;
        const s = nearestFree(i, s0, b, false);
        if (s != null) {
          b.busy = true;
          await hopTo_s(b, i, s, 50, 0.5);
          b.busy = false;
        }
      }, 300 + k * 450);
    });
  }

  // --- Dock gate & intro hold ------------------------------------------------
  function postIntroHold() {
    const frame = document.getElementById('frame');
    if (frame && frame.contentWindow) {
      frame.contentWindow.postMessage({ retouchWorld: 1, type: 'intro-hold' }, location.origin);
    }
  }

  function checkDockGate() {
    if (openingFinished && currentLift === 0 && !introTriggered) {
      introTriggered = true;
      const frame = document.getElementById('frame');
      if (frame && frame.contentWindow) {
        frame.contentWindow.postMessage({ retouchWorld: 1, type: 'opening-done' }, location.origin);
      }
      window.postMessage({ retouchWorld: 1, type: 'opening-done' }, location.origin);
    }
  }

  // --- Fly-over variants & orchestration -------------------------------------
  async function mob(flier) {
    const tm = troublemaker();
    if (!tm || !wires) return;
    if (tm.busy) tm.stop();
    const home = wires.riderOf(tm);
    if (!home) return;

    wires.unperch(tm);
    wires.kick(home.wire, home.s, -0.8);
    tm.say('mine!', 0.8);
    await tm.hopTo(flier.x - 22, flier.y - 10, 60, 0.45);
    crowdLook(flier.x, flier.y, { startle: false });

    const cx = (tm.x + flier.x) / 2;
    const cy = (tm.y + flier.y) / 2;
    const o = { a: 0 };
    tm.busy = true;
    flier.busy = true;
    await gsap.to(o, {
      a: Math.PI * 4,
      duration: 0.7,
      ease: 'power1.inOut',
      onUpdate: () => {
        tm.setPos(cx + Math.cos(o.a) * 16, cy + Math.sin(o.a) * 10);
        flier.setPos(cx - Math.cos(o.a) * 16, cy - Math.sin(o.a) * 10);
        gsap.set([tm.el, flier.el], { rotation: ((o.a * 180 / Math.PI) % 360) * 0.15 });
      }
    });
    gsap.set([tm.el, flier.el], { rotation: 0 });
    tm.busy = false;
    flier.busy = false;
    flier.say('!!', 0.6);

    const s = nearestFree(home.wire, home.s, tm) ?? home.s;
    (async () => {
      await hopTo_s(tm, home.wire, s, 70, 0.6);
      await tm.smug();
      tm.say('heh.', 0.8);
    })();
  }

  async function flyOver(slotIdx) {
    if (!worldActive || !tree || isReducedMotion()) {
      await plant();
      if (tree) tree.setCount(slotIdx + 1, true);
      return;
    }
    const variant = ['reluctant', 'mobbed', 'missed'][slotIdx] || pick(['plain', 'reluctant', 'mobbed', 'missed']);

    // act 1: a bird arrives from off the right edge, from wherever the rest of the flock lives
    arrivals++;
    const b = DraftBird.create({ parent: layerEl, width: 28, legs: 1, reduce: false });
    inFlightBirds.push(b);
    maxInFlightSeen = Math.max(maxInFlightSeen, inFlightBirds.length);
    const bBox = { left: W() + 40, top: Math.round(H() * 0.22) };
    b.face(-1, true);
    b.setPos(bBox.left, bBox.top);
    crowdLook(bBox.left, bBox.top, { startle: false });

    let perch = null;
    if (wires) {
      for (let i = 0; i < wires.count; i++) {
        for (const s of visibleS(i, currentLift === 0)) {
          const p = wires.point(i, s);
          const d = Math.hypot(p.x - b.x, p.y - b.y);
          if (!perch || d < perch.d) perch = { i, s, d };
        }
      }
    }

    if (perch && wires) {
      const p = wires.point(perch.i, perch.s);
      await b.hopTo(p.x, p.y, 70, 0.55);
      if (wires) {
        wires.perch(b, perch.i, perch.s);
        wires.kick(perch.i, perch.s, 1.2);
      }
      crowdLook(b.x, b.y, { except: b });

      await wait(250);
      if (variant === 'reluctant') {
        // it doesn't want to go: a look back the way it came, twice, then it makes up its mind
        b.face(1); await wait(380);
        b.face(-1); await wait(320);
        b.face(1); await wait(200);
        b.say('!', 0.8);
      }
      b.face(-1);
      await wait(450);
      if (wires) {
        wires.unperch(b);
        wires.kick(perch.i, perch.s, -0.9);
      }
    }

    await plant();
    const toBox = slot(tree, slotIdx);
    b.face(-1);

    const end = (() => {
      const fb = b.bodyBox();
      return { x: b.x + (toBox.left - fb.left), y: b.y + (toBox.top - fb.top) };
    })();
    const winTop = winBox(false).top;
    const topLimit = Math.max(40, winTop - 50);
    const legs = [[0.36, topLimit], [0.72, topLimit + 20]];
    const sx = b.x, sy = b.y;

    for (const [k, [f, y]] of legs.entries()) {
      await b.hopTo(sx + (end.x - sx) * f, Math.min(y, sy), 34, 0.36);
      if (k === 0 && variant === 'mobbed') await mob(b);
    }
    crowdLook(end.x, end.y);

    if (variant === 'missed') {
      await b.hopTo(end.x, end.y + 16, 40, 0.42);
      tree.shake(2, -1);
      const ft = b.feet();
      gsap.set(b.el, { transformOrigin: `${ft.x}px ${ft.y - 4}px` });
      b.say('whoa', 0.8);
      await gsap.timeline()
        .to(b.el, { rotation: 170, duration: 0.35, ease: 'power2.in' })
        .to(b.el, { rotation: 150, duration: 0.25, ease: 'sine.inOut', yoyo: true, repeat: 3 })
        .to(b.el, { rotation: 0, duration: 0.45, ease: 'back.out(2)', delay: 0.15 });
      gsap.set(b.el, { transformOrigin: '50% 50%' });
      await b.hopTo(end.x, end.y, 16, 0.24);
      tree.shake(0.8, 1);
    } else {
      await b.hopTo(end.x, end.y, 40, 0.42);
      tree.shake(1.5, -1);
    }

    b.face(1, true);
    const fb2 = b.bodyBox();
    b.setPos(b.x + (toBox.left - fb2.left), b.y + (toBox.top - fb2.top));
    await wait(200);
    await b.fold();
    tree.setCount(Math.max(tree.count, slotIdx + 1));
    inFlightBirds = inFlightBirds.filter((x) => x !== b);   // landed: it's a leaf now, fading into the tree
    gsap.to(b.el, { opacity: 0, duration: 0.35, onComplete: () => b.destroy() });

    setTimeout(() => {
      barBirdSay(pick(['Show-off.', 'Hmph.', 'I could do that.', 'Whatever.']), 1.1);
    }, 500);
  }

  async function processFlyovers() {
    if (isRunningFlyover || !flyoverQueue.length) return;
    if (currentLift > 0) return; // Wait until docked
    isRunningFlyover = true;
    while (flyoverQueue.length && currentLift === 0) {
      const nextSlot = flyoverQueue.shift();
      if (nextSlot < 6) {
        await flyOver(nextSlot);
        if (flyoverQueue.length > 0) {
          await wait(900);
        }
      } else {
        if (tree) tree.setCount(7);
      }
    }
    isRunningFlyover = false;
  }

  async function handleFixChange(fixes) {
    const newCount = clamp(fixes, 0, 7);
    if (!initialFixesHandled) {
      initialFixesHandled = true;
      currentFixedCount = newCount;
      if (newCount > 0) {
        planted = true;
        if (tree) {
          gsap.set(tree.el, { autoAlpha: 1, scaleY: 1 });
          tree.setCount(newCount, true);
        }
      }
      if (big) {
        big.setCount(7, true);
        for (let k = 0; k < Math.min(6, newCount); k++) {
          big.setLeaf(k, false);
        }
      }
      return;
    }

    const prev = currentFixedCount;
    currentFixedCount = newCount;

    if (currentFixedCount > prev) {
      for (let s = prev; s < currentFixedCount; s++) {
        flyoverQueue.push(s);
      }
      processFlyovers();
      if (COUNT_LINES[currentFixedCount - 1]) {
        barBirdSay(COUNT_LINES[currentFixedCount - 1]);
      }
    } else if (currentFixedCount < prev) {
      flyoverQueue.length = 0;
      if (tree) tree.setCount(currentFixedCount);
      if (big) {
        for (let k = prev; k > currentFixedCount; k--) {
          const emptySlot = [0, 1, 2, 3, 4, 5].find((i) => !big.leafShowing(i));
          if (emptySlot != null) big.setLeaf(emptySlot, true);
        }
      }
      if (currentFixedCount === 0) {
        unplant();
      }
      if (barBird) barBird.smug();
    }
  }

  // --- Observers for Retouch UI (toolbar & prompt dock) ----------------------
  function setupObservers() {
    const barEl = document.getElementById('bar');
    if (barEl && !barObserver) {
      barObserver = new MutationObserver(() => {
        if (!worldActive) return;
        const editBtn = document.getElementById('edit');
        const promptBtn = document.getElementById('prompt');
        const statusEl = document.getElementById('status');

        if (editBtn && editBtn.classList.contains('active')) {
          if (!seenEditFirstTime) {
            seenEditFirstTime = true;
            barBirdSay('Click any text. Change it.');
          }
        }
        if (promptBtn && promptBtn.classList.contains('active')) {
          if (!seenPromptFirstTime) {
            seenPromptFirstTime = true;
            barBirdSay('This one goes to your AI.');
          }
        }
        if (statusEl && !statusEl.hidden && statusEl.textContent) {
          const txt = statusEl.textContent.trim();
          if (txt.includes('Saved') && txt !== lastStatusText) {
            lastStatusText = txt;
            barBirdSay('Saved. Only what you changed.');
          }
        } else if (statusEl && statusEl.hidden) {
          lastStatusText = '';
        }
      });
      barObserver.observe(barEl, {
        attributes: true,
        attributeFilter: ['class', 'hidden'],
        childList: true,
        subtree: true,
        characterData: true
      });
    }

    const dockEl = document.getElementById('dock') || document.body;
    if (dockEl && !dockObserver) {
      dockObserver = new MutationObserver(() => {
        if (!worldActive) return;
        const copyLabel = document.getElementById('copy-label');
        if (copyLabel) {
          const txt = copyLabel.textContent.trim();
          if (txt.includes('Copied') && !lastCopiedState) {
            lastCopiedState = true;
            barBirdSay('Copied. Paste it to your AI.');
          } else if (!txt.includes('Copied')) {
            lastCopiedState = false;
          }
        }
      });
      dockObserver.observe(dockEl, { childList: true, subtree: true, characterData: true });
    }
  }

  // --- Opening shot ----------------------------------------------------------
  const FILE = 'file:///Users/you/Desktop/draft.html';
  function opening() {
    let seen = false;
    try { seen = sessionStorage.getItem('world:opening-seen') === '1'; } catch (e) {}

    const addr = document.getElementById('addr-text');
    const ripple = document.querySelector('.ripple');
    const barEl = document.getElementById('bar');

    if (seen || isReducedMotion()) {
      if (addr) addr.textContent = FILE;
      if (winEl) gsap.set(winEl, { opacity: 1, scale: 1 });
      if (barEl) gsap.set(barEl, { opacity: 1, scaleY: 1, y: 0 });
      document.body.classList.remove('opening-pending');
      openingFinished = true;
      seatBarBird();
      checkDockGate();
      return;
    }

    if (addr) addr.textContent = '';
    if (winEl) gsap.set(winEl, { opacity: 0, scale: 0.94, transformOrigin: '50% 0%' });
    if (barEl) gsap.set(barEl, { opacity: 0, scaleY: 0.4, y: -8 });

    if (barBird) {
      barBird.busy = true;
      if (wires) {
        const p = wires.point(1, 0.8);
        barBird.stop();
        barBird.setPos(p.x, p.y);
      }
    }

    const typed = { n: 0 };
    gsap.timeline({ delay: 0.4 })
      .to(winEl, { opacity: 1, scale: 1, duration: 0.55, ease: 'back.out(1.5)' })
      .to(typed, {
        n: FILE.length,
        duration: 0.9,
        ease: 'none',
        onUpdate: () => {
          if (addr) addr.textContent = FILE.slice(0, Math.round(typed.n));
        }
      })
      .fromTo(ripple, { opacity: 0.8, scale: 0.6 }, { opacity: 0, scale: 2.2, duration: 0.45, ease: 'power2.out' }, '+=0.15')
      .to(barEl, { opacity: 1, scaleY: 1, y: 0, duration: 0.4, ease: 'back.out(1.8)' }, '-=0.25')
      .call(() => {
        document.body.classList.remove('opening-pending');
      })
      .call(async () => {
        const s = barSpot();
        if (barBird) {
          await barBird.hopTo(s.x, s.y, 90);
          barBird.busy = false;
          seatBarBird();
          barBirdSay(currentLift > 0 ? 'Down here. Seven mistakes.' : 'Press Edit, then click any text.', 1.8);
        }
        try { sessionStorage.setItem('world:opening-seen', '1'); } catch (e) {}
        openingFinished = true;
        checkDockGate();
      });
  }

  // --- Dom creation & initialization -----------------------------------------
  function init() {
    if (worldActive || W() < 1100) return;
    worldActive = true;
    document.body.classList.add('has-world');

    let seen = false;
    try { seen = sessionStorage.getItem('world:opening-seen') === '1'; } catch (e) {}
    if (!seen && !isReducedMotion()) {
      document.body.classList.add('opening-pending');
    }

    // Live region
    let liveEl = document.getElementById('world-live');
    if (!liveEl) {
      liveEl = document.createElement('div');
      liveEl.id = 'world-live';
      liveEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(liveEl);
    }

    // Wires SVG
    wiresSvg = document.getElementById('wires');
    if (!wiresSvg) {
      wiresSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      wiresSvg.id = 'wires';
      wiresSvg.setAttribute('aria-hidden', 'true');
      document.body.insertBefore(wiresSvg, document.body.firstChild);
    }

    // Window chrome backdrop
    winEl = document.querySelector('.window');
    if (!winEl) {
      winEl = document.createElement('div');
      winEl.className = 'window';
      winEl.id = 'win';
      winEl.innerHTML = `
        <div class="chrome">
          <span class="lights"><i></i><i></i><i></i></span>
          <span class="tab">draft.html</span>
          <span class="addr" id="addr-text"></span>
          <span class="ext" id="ext"><img class="ext-mark" src="brand/mark.svg" alt=""><span class="ripple"></span></span>
        </div>
      `;
      document.body.insertBefore(winEl, document.getElementById('frame') || document.body.firstChild);
    }
    chromeEl = winEl.querySelector('.chrome');
    extEl = winEl.querySelector('.ext');

    // Dock catcher overlay & hint
    dockCatcher = document.querySelector('.dock-catcher');
    if (!dockCatcher) {
      dockCatcher = document.createElement('div');
      dockCatcher.className = 'dock-catcher';
      dockCatcher.id = 'dock-catcher';
      dockCatcher.innerHTML = `<span class="hint" id="hint">Click to try it</span>`;
      document.body.appendChild(dockCatcher);
    }
    hintEl = dockCatcher.querySelector('#hint');

    // Bird layer
    layerEl = document.querySelector('.bird-layer');
    if (!layerEl) {
      layerEl = document.createElement('div');
      layerEl.className = 'bird-layer';
      document.body.appendChild(layerEl);
    }

    // Bar bird
    barBird = DraftBird.create({ parent: layerEl, width: 30, legs: 1, reduce: isReducedMotion() });

    setupTrees();
    setupWires();
    seatWireBirds();

    // Wire birds idle
    if (!isReducedMotion()) {
      wireBirds.forEach((b) => {
        const tid = setTimeout(() => idle(b), 600 + Math.random() * 2500);
        idleTimeouts.push(tid);
      });
    }

    // Roost blinking idle
    if (!isReducedMotion()) {
      (function idleBlink() {
        if (big) {
          const l = leavesOn(big);
          if (l.length) big.blink(pick(l));
        }
        idleBlinkTimeout = setTimeout(idleBlink, 2500 + Math.random() * 3500);
      })();
    }

    // Cursor movement & rustling
    window.addEventListener('pointermove', (e) => {
      if (isReducedMotion()) return;
      cursor = { x: e.clientX, y: e.clientY };
      if (performance.now() - lastLook < 250) return;
      lastLook = performance.now();
      wireBirds.forEach((b) => {
        if (b.busy || Math.hypot(b.x - cursor.x, b.y - cursor.y) > 320) return;
        if (b.trait === 'nervous') b.face(cursor.x > b.x ? -1 : 1);
        else if (b.trait === 'calm') setTimeout(() => faceToward(b, cursor.x), 400);
        else faceToward(b, cursor.x);
      });
      [big, tree].forEach((t) => { if (t) t.rustle(e.clientX, e.clientY); });
    });

    // 400ms interval for makeRoom check
    setInterval(() => {
      if (currentLift < restY) makeRoom();
    }, 400);

    // Catcher click: dock window
    dockCatcher.addEventListener('click', () => {
      if (currentLift > 0) {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ retouchWorld: 1, type: 'dock' }, location.origin);
        } else {
          setLift(0);
        }
      }
    });

    // No wheel handling here: the shell never scrolls, so Chrome passes the wheel up to the homepage by itself.
    // Scrolling the parent from here as well doubled every tick and, with smooth scrolling, fought a trackpad
    // gesture until the page stuck.
    // Only tell the homepage a hand is on the wheel, so its dock assist waits (at most every 100 ms).
    let lastPing = 0;
    window.addEventListener('wheel', () => {
      const now = performance.now();
      if (now - lastPing < 100 || window.parent === window) return;
      lastPing = now;
      window.parent.postMessage({ retouchWorld: 1, type: 'input' }, location.origin);
    }, { passive: true });

    // Handle frame loading for intro hold
    const frame = document.getElementById('frame');
    if (frame) {
      frame.addEventListener('load', () => {
        postIntroHold();
      });
      postIntroHold();
    }

    setupObservers();
    setLift(currentLift);
    opening();
  }

  // Message dispatcher
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin) return;
    if (!e.data || !e.data.retouchWorld) return;

    if (e.data.type === 'hero') {
      if (e.data.restY != null) restY = e.data.restY;
      if (e.data.wireLow != null) wireLow = e.data.wireLow;
      if (e.data.keepOut) keepOutBoxes = e.data.keepOut;
      if (e.data.lift != null) setLift(e.data.lift);
      if (wires) wires.layout();
    } else if (e.data.type === 'lift') {
      setLift(e.data.lift);
    } else if (e.data.type === 'fixes') {
      const count = Array.isArray(e.data.fixed) ? e.data.fixed.length : (e.data.count ?? 0);
      handleFixChange(count);
    }
  });

  window.addEventListener('resize', () => {
    if (W() < 1100) return;
    if (!worldActive) {
      init();
      return;
    }
    setupTrees();
    if (wires) wires.layout();
    seatWireBirds();
    seatBarBird();
    setLift(currentLift);
  });

  document.addEventListener('DOMContentLoaded', init);
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  }

  // Global test hook
  window.__world = {
    isWorld: () => true,
    wires: () => wires,
    birds: () => wireBirds,
    barBird: () => barBird,
    tree: () => tree,
    roost: () => big,
    arrivals: () => arrivals,
    trees: () => ({ progress: tree, big: big, roosts: [big] }),
    currentFixedCount: () => currentFixedCount,
    inFlightCount: () => maxInFlightSeen,
    restY: () => restY,
    lift: () => currentLift,
    setLift
  };
})();
