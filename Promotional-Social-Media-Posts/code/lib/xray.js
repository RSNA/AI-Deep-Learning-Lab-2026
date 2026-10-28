// Small frontal (PA) chest X-ray, drawn in a 100 x 110 local box and scaled into any film window.
// Options set how "real" vs "cartoon" it reads: bone opacity, lung markings, softness, etc.
(function () {
  const { G } = SK;

  const VARIANTS = {
    // A: closest to a real film. Faint ribs, no visible spine, lung vessels, soft edges.
    real: { ribA: 0.24, ribW: 2.2, antA: 0, clavA: 0.55, spineA: 0.1, medA: 0.66, heartA: 0.74, vessels: 0.24, hila: 0.3, trachea: 0.5, blur: 0.7, bubble: 0.5 },
    // B: middle ground. Ribs a bit clearer, otherwise like A.
    balanced: { ribA: 0.36, ribW: 2.5, antA: 0, clavA: 0.65, spineA: 0.1, medA: 0.66, heartA: 0.74, vessels: 0.18, hila: 0.25, trachea: 0.45, blur: 0.45, bubble: 0.45 },
    // C: cartoon. Bold silhouettes (heart, mediastinum, clavicles), a few soft ribs, no vessels.
    cartoon: { ribA: 0.3, ribW: 3.2, ribN: 5, antA: 0, clavA: 0.75, spineA: 0, medA: 0.7, heartA: 0.8, vessels: 0, hila: 0.35, trachea: 0.4, blur: 0, bubble: 0.5 },
    // D: the first attempt (dense bones), kept for comparison.
    dense: { cover: 0, ribA: 0.8, ribW: 2.8, antA: 0, clavA: 0.9, spineA: 0.7, spineBlocks: true, medA: 0.55, heartA: 0.6, vessels: 0, hila: 0, trachea: 0, blur: 0, bubble: 0 },
  };

  // o: a variant (default B, "balanced") plus optional overrides:
  //   nodule: [x, y] in the 100 x 110 box, or false (the scene draws its own finding)
  //   tint:   a colour washed over the film (e.g. a "new scanner" cast)
  function draw(sk, fx, fy, fw, fh, opts = {}) {
    const o = Object.assign({ nodule: [29, 42] }, VARIANTS.balanced, opts);
    const c = sk.ctx;
    const bone = '#DCE6EB', lungC = '#0B1319', tissue = '#3B4D59';
    c.save();
    c.beginPath(); c.rect(fx + 1, fy + 1, fw - 2, fh - 2); c.clip();
    c.fillStyle = '#10181E'; c.fillRect(fx, fy, fw, fh);
    // fit the 100 x 110 anatomy into the window, allowing at most 20% stretch either way
    const fit = Math.min(fw / 100, fh / 110);
    const sx = Math.min(fw / 100, fit * 1.2), sy = Math.min(fh / 110, fit * 1.2);
    c.translate(fx + (fw - 100 * sx) / 2, fy + (fh - 110 * sy) / 2); c.scale(sx, sy);
    const outer = c.filter && c.filter !== 'none' ? c.filter : '';
    const soft = (px, fn) => { if (px > 0) c.filter = `${outer} blur(${px}px)`.trim(); fn(); c.filter = outer || 'none'; };
    const alpha = (a, fn) => { const g = c.globalAlpha; c.globalAlpha = g * a; fn(); c.globalAlpha = g; };

    // soft tissue: neck, shoulders, torso and the abdomen under the diaphragm
    sk.fillPts(G.rect(40, -6, 20, 24, 4), tissue, { amp: 0.3 });
    sk.fillPts(G.ellipse(50, 74, 56, 64, 28), tissue, { amp: 0.3 });

    // lung fields
    const lungR = [[38, 14], [26, 19], [15, 33], [10, 55], [9, 80], [11, 97], [20, 89], [32, 85], [42, 87], [42, 70], [40, 50], [41, 30], [40, 18]];
    const lungL = [[62, 14], [74, 19], [85, 33], [90, 55], [91, 82], [89, 99], [80, 93], [70, 91], [62, 93], [60, 60], [59, 32], [60, 18]];
    soft(o.blur * 1.2, () => { sk.fillPts(lungR, lungC, { amp: 0.4 }); sk.fillPts(lungL, lungC, { amp: 0.4 }); });

    // lung markings: vessels fanning out from the hila, fading toward the edges
    if (o.vessels > 0) soft(o.blur, () => {
      const v = (pts, a, w = 1.5) => sk.path(pts, { lw: w, color: bone, alpha: o.vessels * a, double: false, amp: 0.8 });
      for (const d of [1, -1]) {
        const hx = 50 - 11 * d, hy = d > 0 ? 50 : 48;
        v([[hx, hy], [hx - 7 * d, hy - 7], [hx - 12 * d, hy - 14]], 1, 1.8); v([[hx - 7 * d, hy - 7], [hx - 13 * d, hy - 6]], 0.7, 1.2);
        v([[hx, hy + 1], [hx - 8 * d, hy + 4], [hx - 15 * d, hy + 6]], 1, 1.8); v([[hx - 8 * d, hy + 4], [hx - 12 * d, hy + 12]], 0.7, 1.2);
        v([[hx, hy + 3], [hx - 5 * d, hy + 13], [hx - 9 * d, hy + 22]], 0.9, 1.6); v([[hx - 5 * d, hy + 13], [hx - 12 * d, hy + 16]], 0.6, 1.1);
      }
    });

    // spine, mostly hidden behind the heart
    if (o.spineA > 0) soft(o.blur, () => alpha(o.spineA, () => { c.fillStyle = bone; if (o.spineBlocks) { for (let y = 6; y < 108; y += 7.5) c.fillRect(46.5, y, 7, 5.5); } else c.fillRect(46, 0, 8, 110); }));

    // ribs: posterior arcs (clearer) and anterior arcs sloping down toward the middle (fainter)
    soft(o.blur, () => {
      const n = o.ribN || 7, step = 62 / n;
      for (let i = 0; i < n; i++) {
        const r = 24 + i * step;
        const pr = (dir) => [[50 - 3 * dir, r], [50 - 12 * dir, r - 5], [50 - 24 * dir, r - 3], [50 - 34 * dir, r + 4], [50 - 39 * dir, r + 12]];
        for (const d of [1, -1]) sk.path(pr(d), { lw: o.ribW, color: bone, alpha: o.ribA, double: false, amp: 0.35, salt: 'rib' + i + d });
        if (o.antA > 0 && i < n - 1) for (const d of [1, -1])
          sk.path([[50 - 38 * d, r + 6], [50 - 30 * d, r + 13], [50 - 20 * d, r + 20]], { lw: o.ribW * 0.9, color: bone, alpha: o.antA, double: false, amp: 0.35, salt: 'ant' + i + d });
      }
    });

    // trachea (dark air column down the middle)
    if (o.trachea > 0) alpha(o.trachea, () => sk.fillPts(G.rect(47.5, -4, 5, 44, 2.5), lungC, { amp: 0.2 }));

    // mediastinum and heart: the brightest soft-tissue shapes on a PA film
    soft(o.blur * 1.5, () => {
      const med = [[43, 6], [57, 6], [58, 26], [62, 31], [64, 37], [61, 42], [59, 50], [44, 52], [41, 44], [42, 26]];
      const heart = [[44, 50], [59, 48], [64, 54], [71, 63], [76, 75], [77, 86], [70, 91], [56, 92], [45, 91], [40, 85], [39, 72], [41, 60]];
      // solid base so ribs and spine only faintly show through, as on a real film
      alpha(o.cover ?? 0.85, () => { sk.fillPts(med, '#56697440'.slice(0, 7), { amp: 0.3 }); sk.fillPts(heart, '#566974', { amp: 0.3 }); });
      alpha(o.medA, () => sk.fillPts(med, '#B4C3CC', { amp: 0.3 }));
      alpha(o.heartA, () => sk.fillPts(heart, '#BFCDD5', { amp: 0.3 }));
    });
    if (o.hila > 0) soft(o.blur * 1.5, () => alpha(o.hila, () => {
      sk.fillPts(G.ellipse(40.5, 50, 3, 5, 12), '#C9D5DC', { amp: 0.3 });
      sk.fillPts(G.ellipse(60, 48, 3, 5, 12), '#C9D5DC', { amp: 0.3 });
    }));

    // clavicles sit in front of everything
    soft(o.blur, () => {
      for (const d of [1, -1]) sk.path([[50 - 4 * d, 16], [50 - 14 * d, 12], [50 - 28 * d, 13], [50 - 42 * d, 9]], { lw: o.ribW * 1.35, color: bone, alpha: o.clavA, double: false, amp: 0.3 });
    });

    // diaphragm edges and the stomach bubble under the left dome
    soft(o.blur, () => {
      sk.path([[11, 97], [20, 89], [32, 85], [42, 87]], { lw: 1.6, color: bone, alpha: 0.3, double: false, amp: 0.3 });
      sk.path([[62, 93], [70, 91], [80, 93], [89, 99]], { lw: 1.6, color: bone, alpha: 0.3, double: false, amp: 0.3 });
      if (o.bubble > 0) alpha(o.bubble, () => sk.fillPts(G.ellipse(74, 101, 6, 3.5, 12), lungC, { amp: 0.2 }));
    });

    // a nodule in the right upper lung (Lab 02's "detect" agent circles it)
    if (o.nodule) soft(o.blur * 0.6, () => sk.fillPts(G.circle(o.nodule[0], o.nodule[1], 3.4, 12), '#E6EEF2', { amp: 0.3 }));
    c.restore();
    if (o.tint) {
      c.save();
      c.beginPath(); c.rect(fx + 1, fy + 1, fw - 2, fh - 2); c.clip();
      c.globalCompositeOperation = 'color'; c.globalAlpha *= o.tintA ?? 0.75;
      c.fillStyle = o.tint; c.fillRect(fx, fy, fw, fh);
      c.restore();
    }
  }

  window.XRAY = { draw, VARIANTS };
})();
