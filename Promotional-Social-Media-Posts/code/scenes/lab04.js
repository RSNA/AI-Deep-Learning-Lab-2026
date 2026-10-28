// Lab 04: evaluating a model for real-world deployment.
// The robot (the model) reads a familiar scan confidently, then gets a scan from a new scanner:
// its uncertainty meter and the data-drift gauge spike, it hands the case to a radiologist,
// who checks it and gives a thumbs-up. A "ready to deploy?" checklist ticks off along the way.
(function () {
  const { G, seg, ease, lerp, pulse, TAU, bezierAt } = SK;
  const { robot, ik } = ROBOT;

  const RBX = 404, RBY = 500, RS = 0.85;
  const HX = 806, HY = 600, HS = 0.95;
  const CHUTE = [196, 132], HOLD_R = [404, 424], TRAY = [536, 566], HOLD_H = [700, 372];
  const SKIN = '#E2AE88', HAIR = '#3A2A22';

  // ----- a cartoon radiologist, drawn around the feet -----
  function human(sk, o = {}) {
    const P = sk.pal, c = sk.ctx;
    sk.shape(G.rect(-28, -96, 24, 92, 8), { fill: P.navy, lw: 3 });
    sk.shape(G.rect(4, -96, 24, 92, 8), { fill: P.navy, lw: 3 });
    sk.shape(G.ellipse(-18, -4, 20, 9), { fill: P.ink, lw: 2.6 });
    sk.shape(G.ellipse(18, -4, 20, 9), { fill: P.ink, lw: 2.6 });
    const coat = [[-46, -204], [46, -204], [58, -86], [-58, -86]];
    sk.shape(coat, { fill: '#FFFFFF', hatch: { region: G.rect(26, -210, 40, 130), gap: 6, alpha: 0.3 } });
    sk.shape([[-17, -204], [17, -204], [0, -170]], { fill: P.teal, lw: 2.6 });
    sk.path([[-17, -204], [-6, -150], [-12, -96]], { lw: 2.4 });
    sk.path([[17, -204], [6, -150], [12, -96]], { lw: 2.4 });
    sk.shape(G.rect(20, -168, 20, 26, 3), { fill: P.tealLight, lw: 2.2 });
    sk.line(26, -172, 26, -152, { lw: 3, color: P.blue, double: false });
    sk.shape(G.rect(-36, -164, 16, 20, 2), { fill: P.gold, lw: 2 });
    sk.shape(G.rect(-8, -218, 16, 16, 3), { fill: SKIN, lw: 2.6 });

    const arm = (sh, hand, bend, thumb) => {
      const el = ik(sh[0], sh[1], hand[0], hand[1], 54, 54, bend);
      sk.tube([sh, el], 20, '#FFFFFF', { salt: 'h1' + bend });
      sk.tube([el, hand], 20, '#FFFFFF', { salt: 'h2' + bend });
      if (thumb) sk.shape(G.rect(hand[0] - 5, hand[1] - 27, 10, 20, 5), { fill: SKIN, lw: 2.4 });
      sk.shape(G.circle(hand[0], hand[1], 12), { fill: SKIN, lw: 2.6 });
    };
    if (o.holdL) o.holdL(sk);
    arm([-44, -196], o.handL || [-58, -104], 1, false);
    arm([44, -196], o.handR || [58, -104], -1, o.thumb);

    // head
    c.save(); c.translate(0, -258); c.rotate(o.tilt || 0);
    sk.shape(G.circle(-40, 2, 8), { fill: SKIN, lw: 2.4 });
    sk.shape(G.circle(40, 2, 8), { fill: SKIN, lw: 2.4 });
    sk.shape(G.circle(0, 0, 40), { fill: SKIN, lw: 3.2 });
    const hair = G.arc(0, -2, 43, 43, Math.PI * 1.02, Math.PI * 1.98, 20).concat([[34, -14], [12, -22], [-8, -12], [-36, -12]]);
    sk.shape(hair, { fill: HAIR, lw: 3 });
    const lx = (o.look ? o.look[0] : 0) * 4, ly = (o.look ? o.look[1] : 0) * 3;
    for (const s of [-1, 1]) {
      sk.shape(G.circle(s * 17, 4, 12), { fill: 'rgba(255,255,255,0.35)', lw: 2.8 });
      sk.fillPts(G.circle(s * 17 + lx, 5 + ly, 3.4, 10), P.ink);
    }
    sk.line(-5, 3, 5, 3, { lw: 2.6, double: false });
    sk.path(G.arc(0, 18, 11, o.smile ? 9 : 5, 0.15 * Math.PI, 0.85 * Math.PI, 10), { lw: 2.8, double: false });
    sk.fillPts(G.ellipse(-28, 18, 6, 4, 12), P.coral, { alpha: 0.6 });
    sk.fillPts(G.ellipse(28, 18, 6, 4, 12), P.coral, { alpha: 0.6 });
    c.restore();
  }

  // ----- a film; "drifted" films come from a new scanner: purple cast, tilted, noisy -----
  function film(sk, x, y, drifted, s = 1, alpha = 1) {
    const P = sk.pal, c = sk.ctx;
    c.save(); c.globalAlpha *= alpha; c.translate(x, y); c.scale(s, s);
    if (drifted) c.rotate(-0.08);
    sk.shape(G.rect(-48, -56, 96, 112, 6), { fill: '#F4F1E8', lw: 3 });
    sk.shape(G.rect(-40, -48, 80, 96, 3), { fill: '#10181E', lw: 2 });
    XRAY.draw(sk, -40, -48, 80, 96, { nodule: false, tint: drifted ? '#7E62C8' : null });
    if (drifted) {
      const r = SK.mulberry32(11 + sk.boil);
      c.fillStyle = 'rgba(255,255,255,0.55)';
      for (let i = 0; i < 40; i++) c.fillRect(-38 + r() * 76, -46 + r() * 92, 1.8, 1.8);
      c.save(); c.translate(20, 62); c.rotate(-0.1);
      sk.shape(G.rect(-44, -16, 88, 28, 4), { fill: P.coral, lw: 2.4 });
      sk.text('new scanner', 0, 4, { font: '700 21px Caveat', align: 'center', color: '#fff' });
      c.restore();
    }
    c.restore();
  }

  function along(a, b, p, lift) {
    const c1 = [lerp(a[0], b[0], 0.3), Math.min(a[1], b[1]) - lift], c2 = [lerp(a[0], b[0], 0.7), Math.min(a[1], b[1]) - lift];
    return bezierAt(a, c1, c2, b, ease.inOut(p));
  }

  function scene(sk, t) {
    const P = sk.pal, c = sk.ctx;

    // ---------- story values ----------
    const unsure = 0.16 + 0.05 * Math.sin(t * TAU * 3)
      + 0.72 * ease.inOut(seg(t, 0.58, 0.66)) * (1 - ease.inOut(seg(t, 0.8, 0.94)));
    const drift = 0.18 + 0.66 * ease.inOut(seg(t, 0.52, 0.62)) * (1 - ease.inOut(seg(t, 0.84, 0.98)));
    const flag = pulse(t, 0.64, 0.8, 0.02);

    // ---------- inbox of new scans (top left) ----------
    sk.text('new scans', 132, 46, { font: '700 34px Caveat', align: 'center', jitter: true });
    sk.shape(G.rect(52, 66, 160, 92, 10), { fill: P.wood, lw: 3.2, hatch: { gap: 8, alpha: 0.18, angle: 0.2 } });
    c.save(); c.beginPath(); c.rect(40, 0, 200, 112); c.clip();
    film(sk, 112, 120, false, 0.7);
    if (t < 0.5) film(sk, 154, 126, true, 0.7);
    c.restore();
    sk.shape(G.rect(52, 112, 160, 46, 8), { fill: P.wood, lw: 3.2 });

    // ---------- drift gauge (top right) ----------
    {
      const gx = 820, gy = 160, R = 84;
      sk.text('data drift', gx, 46, { font: '700 34px Caveat', align: 'center', jitter: true });
      sk.shape(G.arc(gx, gy, R, R, Math.PI, TAU, 30).concat([[gx + R, gy]]), { fill: '#fff', lw: 3.2 });
      const zones = [[P.green, 0, 0.45], [P.gold, 0.45, 0.72], [P.coral, 0.72, 1]];
      for (const [col, a0, a1] of zones) sk.path(G.arc(gx, gy, R - 14, R - 14, Math.PI * (1 + a0), Math.PI * (1 + a1), 12), { lw: 12, color: col, double: false, overshoot: false });
      sk.line(gx - R, gy, gx + R, gy, { lw: 3.2 });
      const na = Math.PI * (1 + drift) + Math.sin(t * TAU * 12) * 0.02;
      sk.line(gx, gy, gx + Math.cos(na) * (R - 22), gy + Math.sin(na) * (R - 22), { lw: 4.2 });
      sk.shape(G.circle(gx, gy, 8), { fill: P.navy, lw: 2.6 });
      if (drift > 0.6) sk.glow(gx + Math.cos(na) * (R - 26), gy + Math.sin(na) * (R - 26), 40, P.coral, 0.6 * seg(drift, 0.6, 0.8));
    }

    // ---------- uncertainty meter ----------
    {
      const mx = 548, top = 250, bot = 472;
      sk.text('unsure?', mx + 18, top - 18, { font: '700 32px Caveat', align: 'center', jitter: true });
      sk.shape(G.rect(mx, top, 38, bot - top, 19), { fill: '#fff', lw: 3.2 });
      const h = (bot - top - 12) * unsure;
      const col = unsure > 0.6 ? P.coral : unsure > 0.4 ? P.gold : P.green;
      sk.shape(G.rect(mx + 7, bot - 6 - h, 24, h, 10), { fill: col, lw: 2.2, double: false });
      const ty = bot - 6 - (bot - top - 12) * 0.6;
      sk.line(mx - 8, ty, mx + 46, ty, { lw: 2.4, dash: [6, 5], color: P.coral });
    }

    // ---------- done tray ----------
    sk.shape(G.rect(476, 578, 124, 40, 6), { fill: P.wood, lw: 3 });
    sk.text('done', 538, 607, { font: '700 26px Caveat', align: 'center' });

    // ---------- checklist clipboard (bottom left) ----------
    {
      const bx = 30, by = 236, bw = 276, bh = 412;
      sk.shape(G.rect(bx, by, bw, bh, 12), { fill: P.wood, lw: 3.2, hatch: { gap: 9, alpha: 0.16, angle: 0.15 } });
      sk.shape(G.rect(bx + 14, by + 26, bw - 28, bh - 40, 4), { fill: '#fff', lw: 2.4 });
      sk.shape(G.rect(bx + bw / 2 - 40, by - 12, 80, 30, 8), { fill: P.grey, lw: 2.8 });
      sk.text('ready to deploy?', bx + bw / 2, by + 74, { font: '700 32px Caveat', align: 'center', jitter: true });
      const items = [['works off-site', 0.16], ['calibrated', 0.36], ['tracks drift', 0.6], ['knows when unsure', 0.7], ['human in the loop', 0.88]];
      const fade = 1 - seg(t, 0.96, 1);
      items.forEach(([label, at], i) => {
        const y = by + 120 + i * 52;
        sk.shape(G.rect(bx + 30, y - 22, 28, 28, 4), { fill: '#fff', lw: 2.6 });
        sk.text(label, bx + 68, y, { font: '600 25px Caveat', jitter: true });
        const p = seg(t, at, at + 0.04);
        if (p > 0 && fade > 0) {
          const pts = [[bx + 32, y - 10], [bx + 42, y + 2], [bx + 64, y - 30]];
          const L1 = Math.hypot(10, 12), L2 = Math.hypot(22, 32), d = p * (L1 + L2);
          const path = d <= L1 ? [pts[0], [lerp(pts[0][0], pts[1][0], d / L1), lerp(pts[0][1], pts[1][1], d / L1)]]
            : [pts[0], pts[1], [lerp(pts[1][0], pts[2][0], (d - L1) / L2), lerp(pts[1][1], pts[2][1], (d - L1) / L2)]];
          c.save(); c.globalAlpha *= fade; sk.path(path, { lw: 4.6, color: P.green, overshoot: false }); c.restore();
        }
      });
      const st = ease.back(seg(t, 0.9, 0.94)) * fade;
      if (st > 0.01) {
        c.save(); c.translate(bx + bw / 2 + 24, by + bh - 34); c.rotate(-0.12); c.scale(st, st);
        sk.shape(G.rect(-72, -26, 144, 50, 8), { stroke: true, lw: 4, color: P.coral });
        sk.text('READY!', 0, 13, { font: '800 34px Bricolage', align: 'center', color: P.coral });
        c.restore();
      }
    }

    // ---------- films in motion ----------
    // film A: familiar scan, read confidently, filed in the tray
    let A = null, B = null, robotHolds = null, humanHolds = false;
    if (t < 0.08) A = { p: along(CHUTE, HOLD_R, seg(t, 0, 0.08), 60), s: lerp(0.7, 0.8, seg(t, 0, 0.08)) };
    else if (t < 0.36) { A = { p: HOLD_R, s: 0.8 }; robotHolds = 'A'; }
    else if (t < 0.5) A = { p: along(HOLD_R, TRAY, seg(t, 0.36, 0.43), 30), s: lerp(0.8, 0.6, seg(t, 0.36, 0.43)), a: 1 - seg(t, 0.46, 0.5) };
    // film B: new scanner, sent to the radiologist
    if (t >= 0.5 && t < 0.58) B = { p: along(CHUTE, HOLD_R, seg(t, 0.5, 0.58), 60), s: lerp(0.7, 0.8, seg(t, 0.5, 0.58)) };
    else if (t >= 0.58 && t < 0.7) { B = { p: HOLD_R, s: 0.8 }; robotHolds = 'B'; }
    else if (t >= 0.7 && t < 0.8) B = { p: along(HOLD_R, HOLD_H, seg(t, 0.7, 0.8), 150), s: lerp(0.8, 1, seg(t, 0.7, 0.8)) };
    else if (t >= 0.8) { B = { p: HOLD_H, s: 1, a: 1 - seg(t, 0.95, 1) }; humanHolds = true; }

    // ---------- robot ----------
    sk.shape(G.ellipse(RBX, RBY + 2, 92, 14), { fill: 'rgba(60,45,25,0.10)', stroke: false, hatch: { gap: 5, alpha: 0.35, angle: -0.5 } });
    const toL = ([x, y]) => [(x - RBX) / RS, (y - RBY) / RS];
    const hold = robotHolds ? 1 : 0;
    const hc = toL(HOLD_R);
    const handL = hold ? [hc[0] - 50, hc[1] + 16] : [-80, -44], handR = hold ? [hc[0] + 50, hc[1] + 16] : [80, -44];
    const confident = robotHolds === 'A' && t > 0.24;
    const ropts = {
      look: robotHolds ? [0, 1] : t > 0.7 && t < 0.86 ? [1, 0] : [0, 0],
      blink: pulse(t, 0.45, 0.48, 0.012),
      happy: confident,
      confused: unsure > 0.55,
      bob: Math.sin(t * TAU * 4) * 2,
      antenna: unsure > 0.55 ? 0.5 + 0.5 * Math.sin(t * TAU * 16) : 0,
      antennaColor: unsure > 0.55 ? P.coral : P.gold,
      tilt: unsure > 0.55 ? -0.1 : 0,
      handL, handR,
    };
    c.save(); c.translate(RBX, RBY); c.scale(RS, RS); robot(sk, Object.assign({}, ropts, { noArms: true })); c.restore();
    if (A) film(sk, A.p[0], A.p[1], false, A.s, A.a ?? 1);
    if (B && !humanHolds) film(sk, B.p[0], B.p[1], true, B.s, B.a ?? 1);
    c.save(); c.translate(RBX, RBY); c.scale(RS, RS); robot(sk, Object.assign({}, ropts, { armsOnly: true })); c.restore();
    if (t > 0.42 && t < 0.5) {
      sk.path([[TRAY[0] - 14, TRAY[1] - 4], [TRAY[0] - 4, TRAY[1] + 6], [TRAY[0] + 16, TRAY[1] - 18]], { lw: 5, color: P.green });
    }

    // ---------- radiologist ----------
    const thumb = seg(t, 0.86, 0.9) * (1 - seg(t, 0.97, 1));
    const hl = [(HOLD_H[0] - HX) / HS + 40, (HOLD_H[1] - HY) / HS + 40];
    c.save(); c.translate(HX, HY); c.scale(HS, HS);
    human(sk, {
      look: humanHolds ? [-1, 0.3] : t > 0.6 ? [-1, 0] : [-0.5, 0],
      smile: thumb > 0.2 || t < 0.6,
      tilt: humanHolds ? -0.08 : 0,
      handL: humanHolds ? hl : [-58, -104],
      handR: thumb > 0 ? [lerp(58, 74, thumb), lerp(-104, -236, thumb)] : [58, -104],
      thumb: thumb > 0.5,
      holdL: humanHolds ? () => { c.save(); c.scale(1 / HS, 1 / HS); c.translate(-HX, -HY); film(sk, B.p[0], B.p[1], true, 1, B.a ?? 1); c.restore(); } : null,
    });
    c.restore();
    sk.text('radiologist', HX, 652, { font: '700 32px Caveat', align: 'center', jitter: true });

    // ---------- speech ----------
    const sb = ease.back(seg(t, 0.64, 0.68)) * (1 - ease.in(seg(t, 0.78, 0.81)));
    if (sb > 0.01) {
      c.save(); c.translate(404, 168); c.scale(sb, sb);
      sk.shape([[30, 38], [10, 84], [62, 38]], { fill: '#fff', lw: 3 });
      sk.shape(G.rect(-108, -40, 216, 82, 24), { fill: '#fff', lw: 3 });
      sk.fillPts(G.rect(24, 28, 44, 14), '#fff');
      sk.text("hmm, not sure…", 0, -6, { font: '700 30px Caveat', align: 'center', jitter: true });
      sk.text('ask a human!', 0, 28, { font: '700 30px Caveat', align: 'center', color: P.coral, jitter: true });
      c.restore();
    }
    const hb = ease.back(seg(t, 0.87, 0.9)) * (1 - ease.in(seg(t, 0.97, 1)));
    if (hb > 0.01) {
      c.save(); c.translate(882, 276); c.scale(hb, hb);
      sk.shape([[-30, 30], [-50, 66], [-4, 30]], { fill: '#fff', lw: 3 });
      sk.shape(G.rect(-84, -34, 168, 70, 22), { fill: '#fff', lw: 3 });
      sk.fillPts(G.rect(-36, 22, 36, 14), '#fff');
      sk.text('looks good!', 0, 10, { font: '700 30px Caveat', align: 'center', jitter: true });
      c.restore();
    }
    if (flag > 0) sk.glow(RBX, RBY - 290 * RS, 50, P.coral, flag * 0.5);
  }

  window.SCENES.lab04 = scene;
})();
