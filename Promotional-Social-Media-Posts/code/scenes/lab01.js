// Lab 01: a single agent runs the basic loop: think -> act (call a tool) -> observe -> repeat.
// The robot grabs a magnifier "tool" off a pegboard and finds a nodule on a chest X-ray.
(function () {
  const { G, seg, ease, lerp, pulse, TAU } = SK;
  const { robot, props } = ROBOT;

  const CX = 492, CY = 338, RX = 404, RY = 262;
  const at = (a) => [CX + Math.cos(a) * RX, CY + Math.sin(a) * RY];
  const A_THINK = -Math.PI / 2, A_ACT = Math.PI / 6, A_OBS = (5 * Math.PI) / 6;
  const NODULE = [701, 286];
  const RBX = 492, RBY = 522, RS = 0.92; // robot feet + scale

  function cloud(cx, cy, rx, ry) {
    const pts = [];
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * TAU, k = 1 + 0.09 * Math.abs(Math.sin(a * 4.5));
      pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
    }
    return pts;
  }

  function bulb(sk, x, y, s, lit) {
    const P = sk.pal;
    if (lit) sk.glow(x, y - 4 * s, 46 * s, P.gold, 0.9);
    sk.shape(G.circle(x, y - 6 * s, 16 * s), { fill: lit ? '#FFE39A' : P.cream, lw: 3 });
    sk.shape(G.rect(x - 8 * s, y + 8 * s, 16 * s, 12 * s, 3), { fill: P.grey, lw: 2.6 });
    if (lit) for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i - 2.5) * 0.55;
      sk.line(x + Math.cos(a) * 24 * s, y - 6 * s + Math.sin(a) * 24 * s, x + Math.cos(a) * 33 * s, y - 6 * s + Math.sin(a) * 33 * s, { lw: 2.6 });
    }
  }

  function gear(sk, x, y, r, fill) {
    const pts = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * TAU, tooth = Math.floor(i / 3) % 2 === 0 ? 1.18 : 0.94;
      pts.push([x + Math.cos(a) * r * tooth, y + Math.sin(a) * r * tooth]);
    }
    sk.shape(pts, { fill, lw: 2.8 });
    sk.shape(G.circle(x, y, r * 0.38), { fill: sk.pal.sheet, lw: 2.6 });
  }

  function eye(sk, x, y, s) {
    const P = sk.pal;
    const top = G.bezier([x - 26 * s, y], [x - 10 * s, y - 20 * s], [x + 10 * s, y - 20 * s], [x + 26 * s, y], 12);
    const bot = G.bezier([x + 26 * s, y], [x + 10 * s, y + 20 * s], [x - 10 * s, y + 20 * s], [x - 26 * s, y], 12);
    sk.shape(top.concat(bot.slice(1, -1)), { fill: '#fff', lw: 2.8 });
    sk.shape(G.circle(x, y, 9 * s), { fill: P.blue, lw: 2.4 });
    sk.fillPts(G.circle(x, y, 4 * s), P.ink);
  }

  function station(sk, a, active, icon, label, lx, ly, align) {
    const P = sk.pal;
    const [x, y] = at(a);
    if (active > 0) sk.glow(x, y, 82, P.gold, active * 0.85);
    sk.shape(G.circle(x, y, 46), { fill: active > 0.5 ? P.gold : P.cream, lw: 3.4, hatch: { region: G.rect(x + 14, y - 60, 60, 120), gap: 6, alpha: 0.3 } });
    icon(sk, x, y);
    sk.text(label, x + lx, y + ly, { font: '700 38px Caveat', align: align || 'center', jitter: true });
  }

  function xray(sk, t, glowAmt) {
    const P = sk.pal, c = sk.ctx;
    const fx = 636, fy = 178, fw = 194, fh = 236;
    if (glowAmt > 0) sk.glow(fx + fw / 2, fy + fh / 2, 190, 'rgba(255,248,215,1)', glowAmt * 0.9);
    sk.shape(G.rect(fx, fy, fw, fh, 10), { fill: glowAmt > 0.3 ? '#FFFDF2' : P.cream, lw: 3.4 });
    sk.shape(G.rect(fx + 14, fy + 14, fw - 28, fh - 44, 4), { fill: '#2C3B46', lw: 2.4 });
    // stand
    sk.line(fx + 30, fy + fh, fx + 18, fy + fh + 36, { lw: 3.4 });
    sk.line(fx + fw - 30, fy + fh, fx + fw - 18, fy + fh + 36, { lw: 3.4 });
    sk.shape(G.circle(fx + fw - 22, fy + fh - 15, 6), { fill: glowAmt > 0.3 ? P.green : P.grey, lw: 2 });
    // chest film
    XRAY.draw(sk, fx + 14, fy + 14, fw - 28, fh - 44, { nodule: false });
    sk.fillPts(G.circle(NODULE[0], NODULE[1], 5.5, 14), '#EEF5F7');
    // the finding: a gold ring drawn on, then the measurement
    const ring = seg(t, 0.46, 0.54);
    if (ring > 0 && t < 0.97) {
      sk.path(G.arc(NODULE[0], NODULE[1], 17, 16, -Math.PI / 2, -Math.PI / 2 + TAU * 1.08 * ease.out(ring), 26), { lw: 3.6, color: P.gold, double: false });
      if (t > 0.54) sk.text('8 mm', NODULE[0] + 22, NODULE[1] - 14, { font: '700 30px Caveat', color: P.gold, jitter: true });
    }
  }

  function pegboard(sk, t) {
    const P = sk.pal;
    const bx = 178, by = 266, bw = 184, bh = 164;
    sk.text('tools', bx + bw / 2, by - 14, { font: '700 36px Caveat', align: 'center', jitter: true });
    sk.shape(G.rect(bx, by, bw, bh, 10), { fill: P.wood, lw: 3.2, hatch: { gap: 9, alpha: 0.18, angle: 0.15 } });
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) sk.ctx.fillStyle = 'rgba(60,40,20,0.35)', sk.ctx.beginPath(), sk.ctx.arc(bx + 22 + i * 35, by + 20 + j * 33, 2.6, 0, TAU), sk.ctx.fill();
    const taken = t > 0.355 && t < 0.69;
    const findOn = pulse(t, 0.33, 0.5, 0.02), measOn = pulse(t, 0.47, 0.64, 0.02);
    // magnifier slot
    if (findOn > 0) sk.glow(bx + 46, by + 78, 52, P.gold, findOn);
    if (!taken) props.magnifier(sk, bx + 46, by + 136, 0, 20);
    else sk.shape(G.circle(bx + 46, by + 82, 20), { stroke: true, dash: [6, 7], lw: 2.2, alpha: 0.55 });
    // ruler
    if (measOn > 0) sk.glow(bx + 100, by + 86, 52, P.gold, measOn);
    sk.shape(G.rect(bx + 90, by + 26, 22, 118, 3), { fill: P.gold, lw: 2.8 });
    for (let i = 0; i < 9; i++) sk.line(bx + 90, by + 36 + i * 12, bx + 90 + (i % 2 ? 7 : 12), by + 36 + i * 12, { lw: 1.6, double: false });
    // pencil
    props.pencil(sk, bx + 150, by + 146, 0, 100);
  }

  function scene(sk, t) {
    const P = sk.pal, c = sk.ctx;

    // --- the loop track ---
    const loopPts = G.ellipse(CX, CY, RX, RY, 120);
    sk.strokePts(loopPts, true, { lw: 3.6, dash: [16, 13], dashOffset: -t * 29 * 6, amp: 1.2 });
    for (const a of [-Math.PI / 6 + 0.12, Math.PI / 2 + 0.12, (7 * Math.PI) / 6 + 0.12]) {
      const [x, y] = at(a);
      const tang = Math.atan2(Math.cos(a) * RY, -Math.sin(a) * RX);
      sk.arrowHead(x, y, tang, 20, { lw: 4 });
    }

    const phase = t < 1 / 3 ? 0 : t < 2 / 3 ? 1 : 2;
    const near = (a0) => { const ta = ((a0 - A_THINK + TAU) % TAU) / TAU; return pulse(t, ta - 0.005, ta + 0.32, 0.03); };

    station(sk, A_THINK, near(A_THINK), (sk, x, y) => bulb(sk, x, y + 4, 0.95, phase === 0), 'think', 0, 90);
    station(sk, A_ACT, near(A_ACT), (sk, x, y) => gear(sk, x, y, 22, P.teal), 'use a tool', 0, 88);
    station(sk, A_OBS, near(A_OBS), (sk, x, y) => eye(sk, x, y, 1), 'observe', 0, 88);
    sk.text('…and repeat!', CX, 648, { font: '700 36px Caveat', align: 'center', color: P.coral, jitter: true });

    pegboard(sk, t);
    xray(sk, t, Math.max(pulse(t, 0.34, 0.99, 0.04) * 0.9, 0));

    // --- robot ---
    sk.shape(G.ellipse(RBX, RBY + 2, 96, 15), { fill: 'rgba(60,45,25,0.10)', stroke: false, hatch: { gap: 5, alpha: 0.35, angle: -0.5 } });
    const reachIn = ease.inOut(seg(t, 0.35, 0.43)), reachOut = ease.inOut(seg(t, 0.62, 0.7));
    const reach = reachIn * (1 - reachOut);
    const wiggle = Math.sin(t * TAU * 6) * 3 * seg(t, 0.44, 0.46) * (1 - seg(t, 0.6, 0.62));
    const toLocal = ([x, y]) => [(x - RBX) / RS, (y - RBY) / RS];
    const tgt = toLocal([NODULE[0] - 50 + wiggle, NODULE[1] + 44]);
    const rest = [80, -44];
    const handR = [lerp(rest[0], tgt[0], reach), lerp(rest[1], tgt[1], reach)];
    const thinkHand = ease.inOut(pulse(t, 0.04, 0.3, 0.05));
    const handL = [lerp(-80, -44, thinkHand), lerp(-44, -150, thinkHand)];
    const happy = t > 0.71 && t < 0.95;
    let look = [0, 0];
    if (t < 0.33) look = [-0.7, -0.9];
    else if (t < 0.7) look = [1, -0.5];
    else if (!happy) look = [-0.4, -0.6];
    const blink = Math.max(pulse(t, 0.13, 0.16, 0.014), pulse(t, 0.97, 1.0, 0.014));
    const idea = pulse(t, 0.18, 0.3, 0.02);

    c.save();
    c.translate(RBX, RBY); c.scale(RS, RS);
    robot(sk, {
      look, blink, happy,
      tilt: t < 0.33 ? -0.07 * pulse(t, 0.02, 0.3, 0.05) : 0.04 * reach,
      bob: Math.sin(t * TAU * 4) * 2.5,
      sway: Math.sin(t * TAU * 2) * 0.12,
      antenna: Math.max(idea, happy ? 0.6 + 0.4 * Math.sin(t * TAU * 8) : 0),
      reach: 1 + 0.42 * reach,
      handR, handL,
      holdR: reach > 0.05 ? (sk, x, y) => props.magnifier(sk, x, y, 0.75, 26) : null,
      badgeGlow: happy ? 0.7 : 0,
      mouth: idea > 0.5 ? 'o' : null,
    });
    c.restore();

    // --- thought bubble (think) ---
    const tb = ease.back(seg(t, 0.02, 0.08)) * (1 - ease.in(seg(t, 0.3, 0.34)));
    if (tb > 0.01) {
      c.save(); c.translate(352, 158); c.scale(tb, tb);
      sk.shape(G.circle(98, 70, 10), { fill: '#fff', lw: 2.6 });
      sk.shape(G.circle(122, 96, 6), { fill: '#fff', lw: 2.4 });
      sk.shape(cloud(0, 0, 92, 48), { fill: '#fff', lw: 3 });
      if (t < 0.18) sk.text('?', 0, 22, { font: '800 64px Bricolage', align: 'center', color: P.coral, jitter: true });
      else { bulb(sk, -38, 6, 0.9, true); sk.text('plan!', 30, 16, { font: '700 36px Caveat', align: 'center', jitter: true }); }
      c.restore();
    }

    // --- speech bubble (observe) ---
    const sb = ease.back(seg(t, 0.7, 0.76)) * (1 - ease.in(seg(t, 0.94, 0.985)));
    if (sb > 0.01) {
      c.save(); c.translate(346, 156); c.scale(sb, sb);
      const bub = G.rect(-118, -50, 236, 96, 26).concat([]);
      sk.shape([[46, 40], [92, 92], [80, 40]], { fill: '#fff', lw: 3 });
      sk.shape(bub, { fill: '#fff', lw: 3 });
      sk.fillPts(G.rect(40, 30, 50, 14), '#fff');
      sk.text('found it!', -14, -6, { font: '700 38px Caveat', align: 'center', jitter: true });
      sk.text('8 mm nodule', -14, 32, { font: '600 30px Caveat', align: 'center', color: P.tealDark, jitter: true });
      sk.path([[74, -4], [86, 10], [108, -22]], { lw: 5, color: P.green });
      c.restore();
    }

    // --- the spark that travels the loop ---
    const a = A_THINK + TAU * t;
    for (let i = 5; i >= 1; i--) {
      const [x, y] = at(a - i * 0.045);
      sk.fillPts(G.circle(x, y, 7 - i), P.gold, { alpha: 0.5 - i * 0.08 });
    }
    const [sx, sy] = at(a);
    sk.glow(sx, sy, 34, P.gold, 0.9);
    sk.shape(G.circle(sx, sy, 10), { fill: P.gold, lw: 2.6 });
  }

  window.SCENES.lab01 = scene;
})();
