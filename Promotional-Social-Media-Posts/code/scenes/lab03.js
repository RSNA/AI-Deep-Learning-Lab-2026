// Lab 03: foundation models. The teal robot tosses CT, MRI and X-ray "bricks" from a big pile
// into one large foundation block (pretraining). Each brick sends a pulse through the block and
// up to three small robots on top that reuse it for different tasks: segment, classify, report.
(function () {
  const { G, seg, ease, lerp, pulse, TAU, bezierAt } = SK;
  const { robot } = ROBOT;

  const RBX = 272, RBY = 632, RS = 0.9;          // teal robot
  const BX = 404, BY = 432, BW = 546, BH = 200;  // block front face
  const HOP = [462, 378];                          // hopper mouth centre
  const TASKS = [
    { x: 604, name: 'segment', body: '#EDB95E', dark: '#A8772B' },
    { x: 752, name: 'classify', body: '#6C9BD6', dark: '#2F5E9E' },
    { x: 898, name: 'report', body: '#E9714B', dark: '#A9452A' },
  ];
  const TS = 0.46;
  const MODS = ['xr', 'ct', 'mri'];
  const FINDING = { xr: 'pneumonia', ct: 'nodule', mri: 'tumor' };

  // ----- tiny scan images -----
  function scanImage(sk, x, y, w, h, mod) {
    const P = sk.pal;
    sk.shape(G.rect(x - w / 2, y - h / 2, w, h, 3), { fill: '#2C3B46', lw: 1.8, double: false });
    const L = '#8FA6B3';
    if (mod === 'xr') {
      XRAY.draw(sk, x - w / 2, y - h / 2, w, h, { nodule: false });
    } else if (mod === 'ct') {
      sk.fillPts(G.ellipse(x, y, w * 0.38, h * 0.32, 18), '#6E8898');
      sk.fillPts(G.ellipse(x - w * 0.12, y + h * 0.02, w * 0.1, h * 0.12, 12), L);
      sk.fillPts(G.ellipse(x + w * 0.14, y - h * 0.04, w * 0.08, h * 0.1, 12), L);
      sk.fillPts(G.circle(x, y + h * 0.18, Math.max(1.5, w * 0.05), 10), '#DCE6EA');
    } else {
      sk.fillPts(G.ellipse(x, y, w * 0.32, h * 0.38, 18), '#7C7AA6');
      sk.ctx.save(); sk.ctx.strokeStyle = '#B9B6DE'; sk.ctx.lineWidth = 1.4; sk.ctx.beginPath();
      for (let i = 0; i < 3; i++) { const yy = y - h * 0.2 + i * h * 0.18; sk.ctx.moveTo(x - w * 0.22, yy); sk.ctx.quadraticCurveTo(x - w * 0.08, yy - h * 0.08, x, yy); sk.ctx.quadraticCurveTo(x + w * 0.08, yy + h * 0.08, x + w * 0.22, yy); }
      sk.ctx.stroke(); sk.ctx.restore();
    }
  }

  // a brick = a scan tile in a cream frame
  function brick(sk, x, y, mod, s = 1, rot = 0) {
    const c = sk.ctx;
    c.save(); c.translate(x, y); c.rotate(rot); c.scale(s, s);
    sk.shape(G.rect(-34, -26, 68, 52, 6), { fill: sk.pal.cream, lw: 2.8 });
    scanImage(sk, 0, 0, 54, 40, mod);
    c.restore();
  }

  function bubble(sk, cx, top, w, h, tailX) {
    sk.shape([[tailX - 10, top + h - 4], [tailX - 22, top + h + 26], [tailX + 12, top + h - 4]], { fill: '#fff', lw: 2.8 });
    sk.shape(G.rect(cx - w / 2, top, w, h, 20), { fill: '#fff', lw: 3 });
    sk.fillPts(G.rect(tailX - 14, top + h - 16, 30, 14), '#fff');
  }

  function scene(sk, t) {
    const P = sk.pal, c = sk.ctx;
    const k = Math.floor(t * 3), cy = (t * 3) % 1; // three throws per loop: X-ray, CT, MRI
    const mod = MODS[k];

    // ---------- annotations ----------
    sk.text('1. pretrain on lots of scans', 40, 72, { font: '700 36px Caveat', jitter: true });
    sk.path(G.bezier([300, 92], [360, 140], [420, 220], [452, 318], 16), { lw: 2.6, dash: [8, 7], alpha: 0.7 });
    sk.arrowHead(452, 318, 1.3, 14, { lw: 2.8 });
    sk.text('2. reuse it for many tasks', 752, 62, { font: '700 36px Caveat', align: 'center', jitter: true });

    // ---------- the pile of scans ----------
    sk.text('CT · MRI · X-ray', 18, 444, { font: '700 28px Caveat', jitter: true });
    const pile = [[70, 612, 'ct', -0.06], [140, 616, 'xr', 0.05], [104, 568, 'mri', 0.1], [168, 572, 'ct', -0.12], [62, 560, 'xr', 0.14], [126, 522, 'xr', -0.04], [86, 478, 'mri', 0.2]];
    sk.shape(G.ellipse(118, 640, 100, 12), { fill: 'rgba(60,45,25,0.10)', stroke: false, hatch: { gap: 5, alpha: 0.35, angle: -0.5 } });
    for (const [x, y, m, r] of pile) brick(sk, x, y, m, 0.9, r);

    // ---------- foundation block ----------
    const wave = seg(cy, 0.64, 0.8), wx = lerp(BX - 40, BX + BW + 60, wave);
    const waveOn = wave > 0 && wave < 1;
    sk.shape([[BX, BY], [BX + BW, BY], [BX + BW - 22, BY - 26], [BX + 22, BY - 26]], { fill: '#6F86A0', lw: 3.2 });
    sk.shape(G.rect(BX, BY, BW, BH, 8), { fill: '#40536E', lw: 3.4, hatch: { region: G.rect(BX + BW - 70, BY - 4, 80, BH + 8), gap: 6, alpha: 0.35 } });
    const cols = 8, rows = 3, tw = 58, th = 44, gx = (BW - cols * tw) / (cols + 1), gy = (BH - rows * th) / (rows + 1);
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      const x = BX + gx + q * (tw + gx) + tw / 2, y = BY + gy + r * (th + gy) + th / 2;
      if (r === 1 && q >= 2 && q <= 5) continue; // plaque goes here
      const m = MODS[(q + r * 2) % 3];
      sk.shape(G.rect(x - tw / 2, y - th / 2, tw, th, 4), { fill: ['#566E88', '#5E6390', '#4F7A78'][(q + r * 2) % 3], lw: 2, alpha: 0.9, double: false });
      scanImage(sk, x, y, tw - 12, th - 10, m);
      if (waveOn) { const g = Math.exp(-Math.pow((x - wx) / 46, 2)); if (g > 0.05) sk.glow(x, y, 46, P.gold, g * 0.75); }
    }
    sk.shape(G.rect(BX + 140, BY + 70, 266, 62, 12), { fill: P.cream, lw: 3 });
    sk.text('foundation model', BX + 273, BY + 111, { font: '700 38px Caveat', align: 'center', jitter: true });

    // ---------- small task robots on top, plugged into the block ----------
    const arrive = (x) => lerp(0.64, 0.8, (x - (BX - 40)) / (BW + 100));
    TASKS.forEach((tk, i) => {
      const sx = tk.x + 34, sy = BY - 14;
      const at = arrive(tk.x);
      // cable from the robot's back into a socket on the top face
      const cab = [[tk.x + 22, BY - 70], [tk.x + 52, BY - 70], [sx + 10, sy - 30], [sx, sy]];
      sk.path(G.bezier(cab[0], cab[1], cab[2], cab[3], 14), { lw: 4, color: P.navy });
      sk.shape(G.ellipse(sx, sy + 2, 9, 4, 12), { fill: P.ink, lw: 1.8 });
      const lit = pulse(cy, at, at + 0.14, 0.02);
      const dp = seg(cy, at - 0.02, at + 0.06);
      if (dp > 0 && dp < 1) { const [x, y] = bezierAt(cab[3], cab[2], cab[1], cab[0], dp); sk.glow(x, y, 20, P.gold, 0.9); sk.fillPts(G.circle(x, y, 5), P.gold); }
      c.save(); c.translate(tk.x, BY - 18); c.scale(TS, TS);
      robot(sk, {
        body: tk.body, dark: tk.dark, badge: P.cream,
        look: [-0.2, -1], happy: cy > at + 0.08 || cy < 0.5,
        blink: pulse(t, 0.2 + i * 0.27, 0.23 + i * 0.27, 0.012),
        bob: Math.sin((t + i * 0.11) * TAU * 6) * 2.5,
        antenna: lit, antennaColor: lit > 0.3 ? P.gold : P.cream,
        handL: [-74, -60], handR: [74, -60],
      });
      c.restore();
    });

    // ---------- task bubbles: refresh with each new modality ----------
    const fresh = cy >= 0.72;
    const shown = fresh ? mod : MODS[(k + 2) % 3];
    const prog = (d) => fresh ? ease.out(seg(cy, 0.76 + d, 0.92 + d)) : 1;
    const BT = 100, BHh = 150, BWw = 136;
    TASKS.forEach((tk, i) => {
      bubble(sk, tk.x, BT, BWw, BHh, tk.x - 12);
      sk.text(tk.name, tk.x, BT + 32, { font: '700 30px Caveat', align: 'center', jitter: true });
    });
    // segment: outline drawn around the target
    {
      const x = TASKS[0].x, y = BT + 92, p = prog(0);
      scanImage(sk, x, y, 92, 64, shown);
      const tgt = shown === 'xr' ? [x + 19, y - 1, 11, 21] : shown === 'ct' ? [x - 11, y + 1, 10, 9] : [x + 2, y - 2, 17, 15];
      if (p > 0) sk.path(G.arc(tgt[0], tgt[1], tgt[2], tgt[3], -Math.PI / 2, -Math.PI / 2 + TAU * 1.05 * p, 22), { lw: 3, color: P.coral, double: false });
    }
    // classify: label + confidence bar
    {
      const x = TASKS[1].x, y = BT + 66, p = prog(0.03);
      sk.text(FINDING[shown], x, y, { font: '700 28px Caveat', align: 'center', color: P.tealDark });
      sk.shape(G.rect(x - 50, y + 14, 100, 18, 9), { fill: '#fff', lw: 2.4 });
      if (p > 0.02) sk.shape(G.rect(x - 46, y + 18, 92 * 0.9 * p, 10, 5), { fill: P.green, lw: 1.6, double: false });
      sk.text(Math.round(90 * p) + '%', x, y + 62, { font: '700 22px JetBrains', align: 'center' });
    }
    // report: lines being written
    {
      const x = TASKS[2].x, y = BT + 68, p = prog(0.06);
      const lens = [86, 70, 80, 52];
      lens.forEach((L, j) => {
        const q = SK.clamp01(p * 4 - j);
        if (q > 0) sk.line(x - 43, y + j * 15, x - 43 + L * q, y + j * 15, { lw: 2.6, color: j === 0 ? P.coral : P.ink, double: false, overshoot: false });
      });
    }

    // ---------- the teal robot: pick, lift, toss ----------
    const toW = ([x, y]) => [RBX + x * RS, RBY + y * RS];
    const pick = ease.inOut(pulse(cy, 0.02, 0.26, 0.08));
    const lift = ease.inOut(seg(cy, 0.22, 0.36)) * (1 - ease.inOut(seg(cy, 0.42, 0.56)));
    const toss = seg(cy, 0.38, 0.44);
    const restL = [-80, -44], restR = [80, -44];
    const pickL = [-118, -96], over = [0, -300];
    let handL = [lerp(restL[0], pickL[0], pick), lerp(restL[1], pickL[1], pick)];
    let handR = restR.slice();
    if (lift > 0) {
      handL = [lerp(handL[0], over[0] - 42, lift), lerp(handL[1], over[1] + 10, lift)];
      handR = [lerp(restR[0], over[0] + 42, lift), lerp(restR[1], over[1] + 10, lift)];
    }
    const holding = cy > 0.12 && cy < 0.42;
    const flying = cy >= 0.42 && cy < 0.66;
    const happy = cy > 0.66 && cy < 0.92;
    const ropts = {
      look: cy < 0.24 ? [-1, 0.8] : cy < 0.42 ? [0, -1] : cy < 0.66 ? [1, -0.6] : [1, 0],
      happy, blink: pulse(t, 0.55, 0.58, 0.012),
      bob: -10 * pick + Math.sin(t * TAU * 3) * 2,
      tilt: -0.08 * pick + 0.06 * lift,
      antenna: pulse(cy, 0.62, 0.8, 0.03),
      reach: 1 + 0.75 * lift,
      handL, handR,
    };
    sk.shape(G.ellipse(RBX, RBY + 2, 90, 14), { fill: 'rgba(60,45,25,0.10)', stroke: false, hatch: { gap: 5, alpha: 0.35, angle: -0.5 } });
    // arms drawn behind the head (default order) so they never cover the face when lifting
    c.save(); c.translate(RBX, RBY); c.scale(RS, RS); robot(sk, ropts); c.restore();
    if (holding) {
      const mid = [(handL[0] + handR[0]) / 2, (handL[1] + handR[1]) / 2];
      const hm = toW([lerp(handL[0], mid[0], lift), lerp(handL[1] - 22, mid[1], lift)]);
      brick(sk, hm[0], hm[1] - 16 * lift, mod, 0.95, 0.1 * (1 - lift));
    }

    // brick in flight, then dropping into the hopper (drawn before the hopper's front so it sinks inside)
    if (flying) {
      const p0 = toW([0, over[1] + 10]); p0[1] -= 16;
      const f = seg(cy, 0.42, 0.6);
      const p = bezierAt(p0, [p0[0] + 40, p0[1] - 170], [HOP[0] - 20, HOP[1] - 190], [HOP[0], HOP[1] - 6], ease.inOut(f));
      const sink = seg(cy, 0.6, 0.66);
      brick(sk, p[0], p[1] + sink * 46, mod, 0.95 - 0.25 * sink, f * TAU * 1 + 0);
    }
    // hopper on the top face
    sk.shape([[HOP[0] - 56, HOP[1] - 4], [HOP[0] + 56, HOP[1] - 4], [HOP[0] + 24, BY - 22], [HOP[0] - 24, BY - 22]], { fill: P.gold, lw: 3.2, hatch: { region: G.rect(HOP[0] + 10, HOP[1] - 10, 60, 70), gap: 6, alpha: 0.35 } });
    sk.shape(G.ellipse(HOP[0], HOP[1] - 4, 56, 9, 24), { fill: '#3A2E1E', lw: 3 });
    if (pulse(cy, 0.62, 0.7, 0.02) > 0) sk.glow(HOP[0], HOP[1], 60, P.gold, pulse(cy, 0.62, 0.72, 0.02));
  }

  window.SCENES.lab03 = scene;
})();
