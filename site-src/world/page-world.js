// The world continues down the page: wires, birds and trees along the marketing page.
// Loaded after load and an idle callback, only at >= 1100px.
(function (global) {
  'use strict';

  if (window.innerWidth < 1100 || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return;
  }

  const gsap = global.gsap;
  const DraftBird = global.DraftBird;
  const DraftTree = global.DraftTree;
  const DraftWires = global.DraftWires;

  if (!gsap || !DraftBird || !DraftWires) {
    console.warn('page-world: missing dependencies');
    return;
  }

  const state = {
    dividers: new Map(), // el -> { wires, birds: [], active: false }
    tickerCount: 0,
    faqBird: null,
    privacyBird: null,
    closingBirds: [],
    gutterTree: null,
    footerBird: null,
    githubBird: null
  };

  // Shared ticker count tracking
  gsap.ticker.add(() => {
    let anyActive = false;
    for (const d of state.dividers.values()) {
      if (d.active) { anyActive = true; break; }
    }
    if (anyActive || state.gutterTree) {
      state.tickerCount++;
    }
  });

  // 1. Setup section dividers
  const dividerEls = Array.from(document.querySelectorAll('.divider-wire'));

  function createDividerContent(dividerEl) {
    const staticSvg = dividerEl.querySelector('.static-wire');
    if (staticSvg) staticSvg.style.display = 'none';

    let svg = dividerEl.querySelector('.live-wire-svg');
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'live-wire-svg');
      svg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:64px;overflow:visible;pointer-events:none;';
      dividerEl.appendChild(svg);
    }

    const type = dividerEl.dataset.divider || 'normal';
    const isClosing = type === 'closing';
    const isPrivacy = type === 'privacy';
    const isFaq = type === 'faq';

    // Sag 15px (20 to 35)
    const wires = DraftWires.create({
      svg,
      curves: [
        (w) => `M 0 20 Q ${w * 0.5} 35 ${w} 20`
      ],
      wind: 35
    });

    // Ensure all wire paths have stroke only
    svg.querySelectorAll('path').forEach(p => {
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', '#231f20');
      p.setAttribute('stroke-width', '2');
      p.setAttribute('stroke-linecap', 'round');
    });

    const birds = [];
    const w = dividerEl.clientWidth || window.innerWidth;

    if (isClosing) {
      // 5 birds: irregular spacing (34-70px apart), mixed facing, troublemaker
      const pixelOffsets = [-110, -65, -15, 38, 105];
      const facings = [1, -1, 1, -1, 1];
      for (let i = 0; i < 5; i++) {
        const b = DraftBird.create({ parent: dividerEl, width: 28, legs: 1 });
        b.trait = (i === 1) ? 'trouble' : 'calm';
        b.face(facings[i], true);
        const s = 0.5 + (pixelOffsets[i] / w);
        wires.perch(b, 0, s);
        birds.push(b);
      }
      state.closingBirds = birds;
      closingScenes(wires, birds, dividerEl);
    } else if (isPrivacy) {
      // 1 bird, asleep (folded)
      const b = DraftBird.create({ parent: dividerEl, width: 28, legs: 1 });
      b.trait = 'sleepy';
      wires.perch(b, 0, 0.48);
      b.fold();
      birds.push(b);
      state.privacyBird = b;
    } else if (isFaq) {
      // 1 bird that blinks on FAQ toggle
      const b = DraftBird.create({ parent: dividerEl, width: 28, legs: 1 });
      b.trait = 'curious';
      wires.perch(b, 0, 0.50);
      birds.push(b);
      state.faqBird = b;
    } else {
      // 1-2 birds per normal divider
      const count = type === 'few' ? 1 : 2;
      const sPositions = count === 1 ? [0.48] : [0.44, 0.53];
      for (let i = 0; i < count; i++) {
        const b = DraftBird.create({ parent: dividerEl, width: 28, legs: 1 });
        b.trait = 'calm';
        if (i % 2 === 1) b.face(-1, true);
        wires.perch(b, 0, sPositions[i]);
        birds.push(b);
      }
    }

    // Idle life for active birds (the closing flock has its own scenes)
    birds.forEach(b => {
      if (b.trait === 'sleepy' || isClosing) return;
      b.idleTimer = setInterval(() => {
        if (!b.busy && Math.random() < 0.4) {
          if (b.trait === 'trouble') {
            const r = Math.random();
            if (r < 0.3) b.peck ? b.peck() : b.ruffle();
            else if (r < 0.6) b.ruffle();
            else b.face(-b.facing);
          } else {
            if (Math.random() < 0.5) {
              if (typeof b.blink === 'function') b.blink();
            } else if (Math.random() < 0.3) {
              b.ruffle();
            } else {
              b.face(-b.facing);
            }
          }
        }
      }, 3000 + Math.random() * 3000);
    });

    return { wires, birds, active: true };
  }

  // The closing flock isn't five birds on a wire, it's a crowd: two chat, the troublemaker shoves in, they all
  // look at the Install button, a ruffle runs down the line. One scene at a time, until the divider leaves.
  const CHATS = [
    ['Did they fix it?', 'All seven.'], ['Install it.', 'You install it.'], ['Who wrote this page?', 'An AI.'],
    ['Byte for byte?', 'Byte for byte.'], ['Is that a typo?', 'Not any more.'], ['Free?', 'And open source.'],
    ['Nice wire.', 'Thanks.']
  ];
  function closingScenes(wires, birds, dividerEl) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const alive = () => birds.length && birds[0].el.isConnected;
    const sOf = (b) => { const r = wires.riderOf(b); return r ? r.s : null; };
    const byX = () => birds.filter((b) => sOf(b) != null).sort((p, q) => sOf(p) - sOf(q));
    const faceEach = (p, q) => { p.face(q.x > p.x ? 1 : -1); q.face(p.x > q.x ? 1 : -1); };
    async function hopTo(b, s) {
      const r = wires.riderOf(b);
      if (r) { wires.kick(0, r.s, -0.25); wires.unperch(b); }
      const p = wires.point(0, s);
      b.face(p.x > b.x ? 1 : -1);
      await b.hopTo(p.x, p.y, 16, 0.26);
      wires.perch(b, 0, s);
      wires.kick(0, s, 0.4);
    }
    let lastChat = -1;
    const scenes = {
      async chat() {
        const row = byX(), i = Math.floor(Math.random() * (row.length - 1));
        const [p, q] = [row[i], row[i + 1]];
        if (!p || !q || p.busy || q.busy) return;
        let k; do { k = Math.floor(Math.random() * CHATS.length); } while (k === lastChat && CHATS.length > 1);
        lastChat = k;
        faceEach(p, q);
        p.say(CHATS[k][0], 1.2);
        await sleep(1500);
        if (!alive()) return;
        q.say(CHATS[k][1], 1.3);
        // the others glance over, a beat late
        row.filter((b) => b !== p && b !== q && !b.busy).forEach((b, n) => setTimeout(() => b.face((p.x + q.x) / 2 > b.x ? 1 : -1), 200 + n * 120));
        await sleep(1700);
      },
      async shove() {
        const row = byX(), tm = birds.find((b) => b.trait === 'trouble');
        if (!tm || tm.busy) return;
        const idx = row.indexOf(tm);
        const n = row[idx + (Math.random() < 0.5 ? -1 : 1)];
        if (!n || n.busy) return;
        const dir = sOf(n) > sOf(tm) ? 1 : -1;
        const gap = 22 / (dividerEl.clientWidth || window.innerWidth);   // shoulder to shoulder
        await hopTo(tm, sOf(n) - dir * gap);
        n.say('hey!', 0.7);
        await hopTo(n, sOf(n) + dir * 2.4 * gap);
        await tm.smug();
      },
      async lookAtButton() {
        const btn = document.querySelector('#closing-section .btn.primary, #closing-section .install-btn');
        if (!btn) return;
        const r = btn.getBoundingClientRect(), cx = r.left + r.width / 2;
        const row = byX();
        for (const b of row) { if (b.busy) continue; const br = b.el.getBoundingClientRect(); b.face(cx > br.left + br.width / 2 ? 1 : -1); await sleep(110); }
        await sleep(500);
        const talker = pick(row.filter((b) => !b.busy));
        if (talker) talker.say(pick(['Go on.', 'Click it.', 'Well?']), 1);
        await sleep(1200);
      },
      async ruffleWave() {
        for (const b of byX()) { if (!b.busy) b.ruffle(); await sleep(140); }
        await sleep(800);
      }
    };
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    (async function loop() {
      await sleep(1500 + Math.random() * 1500);
      while (alive()) {
        const r = Math.random();
        try {
          if (r < 0.45) await scenes.chat();
          else if (r < 0.65) await scenes.shove();
          else if (r < 0.85) await scenes.lookAtButton();
          else await scenes.ruffleWave();
        } catch (e) { /* a scene cut short by the divider leaving is fine */ }
        await sleep(3500 + Math.random() * 3500);
      }
    })();
  }

  function destroyDividerContent(dividerEl, data) {
    if (!data) return;
    data.active = false;
    data.birds.forEach(b => {
      clearInterval(b.idleTimer);
      if (data.wires) data.wires.unperch(b);
      b.destroy();
    });
    if (data.wires) data.wires.destroy();
    const liveSvg = dividerEl.querySelector('.live-wire-svg');
    if (liveSvg) liveSvg.remove();

    const staticSvg = dividerEl.querySelector('.static-wire');
    if (staticSvg) staticSvg.style.display = '';

    if (state.closingBirds === data.birds) state.closingBirds = [];
    if (state.faqBird === data.birds[0]) state.faqBird = null;
    if (state.privacyBird === data.birds[0]) state.privacyBird = null;
  }

  // Observer to start decorations when within 1 screen, stop when off-screen
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const el = entry.target;
      let data = state.dividers.get(el);
      if (entry.isIntersecting) {
        if (!data || !data.active) {
          data = createDividerContent(el);
          state.dividers.set(el, data);
        }
      } else {
        if (data && data.active) {
          destroyDividerContent(el, data);
          state.dividers.delete(el);
        }
      }
    });
  }, { rootMargin: '600px 0px 600px 0px' });

  dividerEls.forEach(el => io.observe(el));

  // 2. Small moment: Privacy section sleepy bird opens eye with blink(1.2)
  const privacySection = document.getElementById('privacy-section');
  if (privacySection) {
    const privacyIo = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const divEl = document.querySelector('.divider-wire[data-divider="privacy"]');
          const data = divEl ? state.dividers.get(divEl) : null;
          const b = (data && data.birds && data.birds[0]) || state.privacyBird;
          if (b && b.trait === 'sleepy') {
            if (typeof b.blink === 'function') {
              b.blink(1.2);
            }
          }
        }
      });
    }, { threshold: 0.3 });
    privacyIo.observe(privacySection);
  }

  // 3. Small moment: FAQ bird blinks on question open
  document.addEventListener('toggle', (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('faq-item')) {
      if (e.target.open && state.faqBird && !state.faqBird.busy) {
        if (typeof state.faqBird.blink === 'function') {
          state.faqBird.blink();
        }
      }
    }
  }, true);

  // 4. Small moment: Closing install button crowdLook
  const closingSection = document.getElementById('closing-section');
  if (closingSection) {
    const installBtn = closingSection.querySelector('.install-btn');
    if (installBtn) {
      installBtn.addEventListener('mouseenter', () => {
        if (!state.closingBirds || state.closingBirds.length === 0) return;
        const btnRect = installBtn.getBoundingClientRect();
        const btnCenter = { x: btnRect.left + btnRect.width / 2, y: btnRect.top + btnRect.height / 2 };

        state.closingBirds.forEach((b, idx) => {
          if (!b.busy) {
            setTimeout(() => {
              if (b && b.face) {
                const bRect = b.el.getBoundingClientRect();
                const bCenter = bRect.left + bRect.width / 2;
                b.face(btnCenter.x > bCenter ? 1 : -1);
              }
            }, idx * 60);
          }
        });
      });
    }
  }

  // 5. Small moment: Open source button perched bird
  // Stands on the top edge of the View on GitHub button with >= 8px clear space
  const openSourceBtn = document.querySelector('#open-source-section .btn.secondary, #open-source-section .btn');
  if (openSourceBtn) {
    let btnBirdSlot = openSourceBtn.querySelector('.btn-bird-slot');
    if (!btnBirdSlot) {
      btnBirdSlot = document.createElement('div');
      btnBirdSlot.className = 'btn-bird-slot';
      btnBirdSlot.style.cssText = 'position:absolute;left:28px;top:0px;transform:translateY(-100%);pointer-events:none;z-index:2;';
      openSourceBtn.style.position = 'relative';
      openSourceBtn.appendChild(btnBirdSlot);
    }

    const b = DraftBird.create({ parent: btnBirdSlot, width: 22, legs: 1 });
    b.setPos(0, 0);
    state.githubBird = b;

    document.addEventListener('pointermove', (e) => {
      if (!b || b.busy) return;
      const rect = openSourceBtn.getBoundingClientRect();
      const dist = Math.hypot(e.clientX - (rect.left + rect.width / 2), e.clientY - (rect.top + rect.height / 2));
      if (dist < 150) {
        const bRect = b.el.getBoundingClientRect();
        b.face(e.clientX > bRect.left + bRect.width / 2 ? 1 : -1);
      }
    }, { passive: true });
  }

  // 6. The footer bird lives in page-birds.js (it's on every page, at every width).

  // 7. Margin Tree beside "Ten small fixes"
  // Fully inside the section box: stands on section bottom (paper), never on a wire
  const gutterSlot = document.querySelector('.gutter-tree');
  if (gutterSlot && DraftTree) {
    const treeIo = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !state.gutterTree) {
          // a full roost sized to its slot (DraftTree takes parent, height and style; a bare trunk reads as dead)
          const tree = DraftTree.create({ parent: gutterSlot, height: gutterSlot.clientHeight || 180, style: 'position:absolute;left:0;bottom:0' });
          tree.setCount(7, true);
          state.gutterTree = tree;
          const onMove = (e) => tree.rustle(e.clientX, e.clientY);
          window.addEventListener('pointermove', onMove, { passive: true });
          tree.__offMove = () => window.removeEventListener('pointermove', onMove);
        } else if (!entry.isIntersecting && state.gutterTree) {
          state.gutterTree.__offMove();
          state.gutterTree.destroy();
          state.gutterTree = null;
        }
      });
    }, { rootMargin: '300px 0px 300px 0px' });
    treeIo.observe(gutterSlot);
  }

  // 8. The roost beside the questions (it used to stand in the hero, where it did nothing): a full tree of
  // sleeping leaves that blink now and then and lean away from the pointer.
  const roostSlot = document.querySelector('.roost-slot');
  if (roostSlot && DraftTree && roostSlot.offsetParent) {
    let roost = null, offMove = null, blinkTimer = 0;
    const blinkSoon = () => {
      blinkTimer = setTimeout(() => {
        if (!roost) return;
        const on = [0, 1, 2, 3, 4, 5].filter((i) => roost.leafShowing(i));
        if (on.length) roost.blink(on[Math.floor(Math.random() * on.length)]);
        blinkSoon();
      }, 2500 + Math.random() * 3500);
    };
    new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && !roost) {
          roost = DraftTree.create({ parent: roostSlot, height: roostSlot.clientHeight, style: 'position:absolute;left:0;bottom:0' });
          roost.setCount(7, true);
          const onMove = (e) => roost.rustle(e.clientX, e.clientY);
          window.addEventListener('pointermove', onMove, { passive: true });
          offMove = () => window.removeEventListener('pointermove', onMove);
          blinkSoon();
          state.roost = roost;
        } else if (!entry.isIntersecting && roost) {
          clearTimeout(blinkTimer);
          offMove();
          roost.destroy();
          roost = null;
          state.roost = null;
        }
      });
    }, { rootMargin: '300px 0px 300px 0px' }).observe(roostSlot);
  }

  // Expose debug interface for tests
  window.__pageWorld = {
    state,
    gutterLeaves: () => (state.gutterTree ? [0, 1, 2, 3, 4, 5].filter((i) => state.gutterTree.leafShowing(i)).length : 0),
    get tickerCallbacks() { return state.tickerCount; },
    get activeBirds() {
      let count = 0;
      for (const d of state.dividers.values()) {
        if (d.active) count += d.birds.length;
      }
      if (state.footerBird) count++;
      if (state.githubBird) count++;
      return count;
    },
    faqBird: () => state.faqBird,
    closingBirds: () => state.closingBirds,
    privacyBird: () => state.privacyBird
  };

})(typeof self !== 'undefined' ? self : globalThis);
