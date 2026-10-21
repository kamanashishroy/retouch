// Springy power lines for the site's world. Each wire is a fixed base curve plus one bending mode: a damped
// spring whose displacement is largest mid-span and zero at the anchored ends. Birds perched on a wire ride it,
// a landing pushes it down, a take-off flicks it up, and a little wind keeps it alive.
//
// Usage:
//   const wires = DraftWires.create({ svg, curves: [(w, h) => 'M0 ... T ...', ...] });
//   wires.perch(bird, 0, 0.12);   // bird rides wire 0 at 12% of its length
//   wires.kick(0, 0.12, 1);       // a landing there (negative to flick upward)
// Requires gsap (its ticker drives the springs). Elements carry data-retouch-ui and take no pointer events.
(function (global) {
  const NS = 'http://www.w3.org/2000/svg';
  const SAMPLES = 64;

  function create(opts = {}) {
    const gsap = global.gsap;
    if (!gsap) throw new Error('DraftWires needs gsap loaded first.');
    const svg = opts.svg;
    const curves = opts.curves || [];
    const stiffness = opts.stiffness || 38;       // spring constant
    const damping = opts.damping || 3.2;          // per second
    const wind = opts.wind != null ? opts.wind : 40;  // gust strength: about 1 px of sway
    const reduce = opts.reduce != null ? opts.reduce : matchMedia('(prefers-reduced-motion: reduce)').matches;
    svg.setAttribute('data-retouch-ui', '');
    svg.setAttribute('aria-hidden', 'true');

    const probe = document.createElementNS(NS, 'path');   // measures the base curves; never shown
    const wires = curves.map(() => {
      const path = document.createElementNS(NS, 'path');
      svg.appendChild(path);
      return { path, base: [], b: 0, v: 0 };
    });
    const riders = new Map();   // bird -> { wire, s }

    // Sample each base curve by arc length, so s in [0, 1] means "this far along the visible line".
    function layout() {
      const w = innerWidth, h = innerHeight;
      svg.appendChild(probe);
      wires.forEach((wire, i) => {
        probe.setAttribute('d', curves[i](w, h));
        const L = probe.getTotalLength();
        wire.base = [];
        for (let k = 0; k <= SAMPLES; k++) { const p = probe.getPointAtLength(L * k / SAMPLES); wire.base.push({ x: p.x, y: p.y }); }
      });
      probe.remove();
      draw();
    }
    const shape = (s) => Math.sin(Math.PI * Math.max(0, Math.min(1, s)));
    // The wire's current point at s (base plus bend).
    function point(i, s) {
      const wire = wires[i], f = Math.max(0, Math.min(1, s)) * SAMPLES, k = Math.min(SAMPLES - 1, Math.floor(f)), t = f - k;
      const a = wire.base[k], c = wire.base[k + 1];
      return { x: a.x + (c.x - a.x) * t, y: a.y + (c.y - a.y) * t + wire.b * shape(s) };
    }
    function draw() {
      wires.forEach((wire, i) => {
        let d = '';
        for (let k = 0; k <= SAMPLES; k++) { const p = point(i, k / SAMPLES); d += (k ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1); }
        wire.path.setAttribute('d', d);
      });
    }

    let last = performance.now(), windPhase = Math.random() * 10;
    function tick() {
      const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      windPhase += dt;
      wires.forEach((wire, i) => {
        // each perched bird adds a little weight, so a busy wire hangs lower
        let load = 0;
        riders.forEach((r) => { if (r.wire === i) load += 1.4 * shape(r.s); });
        const gust = reduce ? 0 : wind * (Math.sin(windPhase * (0.7 + i * 0.13)) * 0.6 + Math.sin(windPhase * 2.3 + i) * 0.4);
        const a = -stiffness * (wire.b - load) - damping * wire.v + gust;
        wire.v += a * dt;
        wire.b += wire.v * dt;
      });
      draw();
      riders.forEach((r, bird) => { if (!bird.busy) { const p = point(r.wire, r.s); bird.setPos(p.x, p.y); } });
    }
    // Lay the wires out before the first tick can run: tick() reads the sampled curves.
    layout();
    addEventListener('resize', layout);
    gsap.ticker.add(tick);

    return {
      count: wires.length,
      point,
      // Push wire i at s: positive is down (a landing), negative is up (a take-off).
      kick(i, s, strength = 1) { if (!reduce) wires[i].v += 60 * strength * (0.35 + 0.65 * shape(s)); },
      perch(bird, i, s) { riders.set(bird, { wire: i, s }); const p = point(i, s); bird.setPos(p.x, p.y); },
      unperch(bird) { riders.delete(bird); },
      riderOf(bird) { return riders.get(bird) || null; },
      riders() { return [...riders.entries()].map(([bird, r]) => ({ bird, wire: r.wire, s: r.s })); },
      // The s on wire i whose point is nearest to (x, y), searched along the samples.
      nearest(i, x, y) {
        let best = 0, bd = Infinity;
        for (let k = 0; k <= SAMPLES; k++) { const p = point(i, k / SAMPLES), d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = k / SAMPLES; } }
        return best;
      },
      layout,
      destroy() { gsap.ticker.remove(tick); removeEventListener('resize', layout); wires.forEach((w) => w.path.remove()); }
    };
  }

  global.DraftWires = { create };
})(typeof self !== 'undefined' ? self : globalThis);
