// Lab 05: vibe coding. A radiologist with no coding background types a plain-language request;
// the robot (headphones on, vibing) turns it into code blocks that fly over and snap together
// into a small app, which then measures a nodule. The radiologist gives a thumbs-up.
(function () {
  const { G, seg, ease, lerp, pulse, TAU, bezierAt } = SK;
  const { robot, ik } = ROBOT;

  const RBX = 498, RBY = 566, RS = 0.85;
  const HX = 205, HY = 604, HS = 0.95;
  const WIN = { x: 652, y: 112, w: 292, h: 420 };
  const SKIN = '#E2AE88', HAIR = '#3A2A22';
  const BLOCKS = [
    { code: 'load_xray(img)', col: '#A6DCD7' },
    { code: 'find_nodule()', col: '#EDB95E' },
    { code: 'measure_mm()', col: '#F2A07F' },
    { code: 'show_result()', col: '#A9C4EA' },
  ];
  const PROMPT = ['make me a tool that', 'measures lung nodules'];

  // ----- the radiologist (same character as Lab 04) -----
  function human(sk, o = {}) {
    const P = sk.pal, c = sk.ctx;
    sk.shape(G.rect(-28, -96, 24, 92, 8), { fill: P.navy, lw: 3 });
    sk.shape(G.rect(4, -96, 24, 92, 8), { fill: P.navy, lw: 3 });
    const coat = [[-46, -204], [46, -204], [58, -86], [-58, -86]];
    sk.shape(coat, { fill: '#FFFFFF', hatch: { region: G.rect(26, -210, 40, 130), gap: 6, alpha: 0.3 } });
    sk.shape([[-17, -204], [17, -204], [0, -170]], { fill: P.teal, lw: 2.6 });
    sk.path([[-17, -204], [-6, -150], [-12, -96]], { lw: 2.4 });
    sk.path([[17, -204], [6, -150], [12, -96]], { lw: 2.4 });
    sk.shape(G.rect(-8, -218, 16, 16, 3), { fill: SKIN, lw: 2.6 });
    const arm = (sh, hand, bend, thumb) => {
      const el = ik(sh[0], sh[1], hand[0], hand[1], 54, 54, bend);
      sk.tube([sh, el], 20, '#FFFFFF', { salt: 'h1' + bend });
      sk.tube([el, hand], 20, '#FFFFFF', { salt: 'h2' + bend });
      if (thumb) sk.shape(G.rect(hand[0] - 5, hand[1] - 27, 10, 20, 5), { fill: SKIN, lw: 2.4 });
      sk.shape(G.circle(hand[0], hand[1], 12), { fill: SKIN, lw: 2.6 });
    };
    arm([-44, -196], o.handL || [-50, -110], 1, false);
    arm([44, -196], o.handR || [50, -110], -1, o.thumb);
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
    if (o.wow) sk.shape(G.ellipse(0, 22, 7, 8, 14), { fill: P.ink, lw: 2 });
    else sk.path(G.arc(0, 18, 11, o.smile ? 9 : 5, 0.15 * Math.PI, 0.85 * Math.PI, 10), { lw: 2.8, double: false });
    sk.fillPts(G.ellipse(-28, 18, 6, 4, 12), P.coral, { alpha: 0.6 });
    sk.fillPts(G.ellipse(28, 18, 6, 4, 12), P.coral, { alpha: 0.6 });
    c.restore();
  }

  function note(sk, x, y, col, a, s = 1) {
    const c = sk.ctx;
    c.save(); c.globalAlpha *= a; c.translate(x, y); c.scale(s, s); c.rotate(-0.15);
    sk.line(8, 0, 8, -34, { lw: 3, double: false });
    sk.path([[8, -34], [20, -26], [22, -14]], { lw: 3, double: false });
    sk.shape(G.ellipse(0, 0, 10, 7.5, 16), { fill: col, lw: 2.6 });
    c.restore();
  }

  function codeBlock(sk, x, y, b, s = 1, rot = 0, a = 1) {
    const P = sk.pal, c = sk.ctx;
    c.save(); c.globalAlpha *= a; c.translate(x, y); c.rotate(rot); c.scale(s, s);
    const w = 248, h = 44;
    sk.shape(G.rect(-w / 2, -h / 2, w, h, 9), { fill: b.col, lw: 2.8 });
    sk.shape(G.rect(-w / 2 + 12, -h / 2 + 10, 10, h - 20, 3), { fill: '#fff', lw: 1.8, double: false });
    sk.text(b.code, -w / 2 + 34, 7, { font: '700 20px JetBrains', color: P.ink });
    c.restore();
  }

  function scene(sk, t) {
    const P = sk.pal, c = sk.ctx;
    const beat = Math.sin(t * TAU * 8);

    // ---------- app window ----------
    const done = seg(t, 0.64, 0.7) * (1 - seg(t, 0.94, 0.99));
    const flash = pulse(t, 0.6, 0.68, 0.025);
    sk.text('your app', WIN.x + WIN.w / 2, WIN.y - 22, { font: '700 36px Caveat', align: 'center', jitter: true });
    if (flash > 0) sk.glow(WIN.x + WIN.w / 2, WIN.y + WIN.h / 2, 260, 'rgba(255,240,190,1)', flash);
    sk.shape(G.rect(WIN.x, WIN.y, WIN.w, WIN.h, 14), { fill: '#fff', lw: 3.4, hatch: { region: G.rect(WIN.x + WIN.w - 16, WIN.y - 6, 30, WIN.h + 12), gap: 6, alpha: 0.35 } });
    sk.shape(G.rect(WIN.x, WIN.y, WIN.w, 40, 12), { fill: P.navy, lw: 3 });
    [P.coral, P.gold, P.green].forEach((col, i) => sk.shape(G.circle(WIN.x + 22 + i * 22, WIN.y + 20, 6.5), { fill: col, lw: 1.8 }));
    sk.text('nodule_tool', WIN.x + WIN.w - 16, WIN.y + 27, { font: '700 17px JetBrains', align: 'right', color: '#E9E4D8' });
    const ix = WIN.x + 22, iw = WIN.w - 44;
    // empty slots until the blocks land
    if (done < 1) {
      c.save(); c.globalAlpha *= 1 - done;
      for (let i = 0; i < 4; i++) sk.shape(G.rect(ix, WIN.y + 70 + i * 62, iw, 44, 9), { stroke: true, dash: [7, 7], lw: 2, alpha: 0.4 });
      c.restore();
    }
    // the working app
    if (done > 0) {
      c.save(); c.globalAlpha *= done;
      const fx = ix + 8, fy = WIN.y + 62, fw = iw - 16, fh = 230;
      sk.shape(G.rect(fx, fy, fw, fh, 4), { fill: '#2C3B46', lw: 2.6 });
      const mx = fx + fw / 2, cy = fy + fh / 2;
      sk.fillPts(G.ellipse(mx - 42, cy, 36, 82, 24), '#5D7686');
      sk.fillPts(G.ellipse(mx + 42, cy, 36, 82, 24), '#5D7686');
      sk.line(mx, fy + 10, mx, fy + fh - 10, { lw: 5, color: '#A9BCC6', double: false });
      for (let i = 0; i < 5; i++) {
        const y = fy + 50 + i * 30;
        sk.path(G.arc(mx - 42, y, 38, 13, Math.PI * 1.05, Math.PI * 1.95, 10), { lw: 1.8, color: '#B9CCD6', alpha: 0.7, double: false });
        sk.path(G.arc(mx + 42, y, 38, 13, Math.PI * 1.05, Math.PI * 1.95, 10), { lw: 1.8, color: '#B9CCD6', alpha: 0.7, double: false });
      }
      sk.fillPts(G.ellipse(mx + 14, cy + 50, 32, 26, 20), '#8FA6B3', { alpha: 0.85 });
      const nx = mx - 46, ny = cy - 22;
      sk.fillPts(G.circle(nx, ny, 7, 14), '#EEF5F7');
      const m = ease.out(seg(t, 0.7, 0.76));
      if (m > 0) {
        const x0 = nx - 14, y0 = ny + 12, x1 = nx + 14, y1 = ny - 12;
        sk.line(x0, y0, lerp(x0, x1, m), lerp(y0, y1, m), { lw: 3.4, color: P.gold, double: false, overshoot: false });
        if (m > 0.95) { sk.line(x0 - 5, y0 - 6, x0 + 5, y0 + 6, { lw: 3, color: P.gold, double: false }); sk.line(x1 - 5, y1 - 6, x1 + 5, y1 + 6, { lw: 3, color: P.gold, double: false }); }
        if (m > 0.6) sk.text('8 mm', nx + 22, ny - 14, { font: '700 30px Caveat', color: P.gold, jitter: true });
      }
      const ry = fy + fh + 18;
      sk.shape(G.rect(ix, ry, iw, 50, 10), { fill: P.cream, lw: 2.6 });
      sk.text('nodule: 8.2 mm', ix + 16, ry + 33, { font: '700 21px JetBrains' });
      sk.shape(G.circle(ix + iw - 26, ry + 25, 15), { fill: P.green, lw: 2.4 });
      sk.path([[ix + iw - 34, ry + 25], [ix + iw - 28, ry + 31], [ix + iw - 18, ry + 18]], { lw: 3, color: '#fff', double: false });
      c.restore();
    }

    // ---------- desk, radiologist, laptop ----------
    sk.text('you', 64, 330, { font: '700 40px Caveat', color: P.coral, jitter: true });
    sk.path(G.bezier([96, 330], [124, 316], [140, 330], [148, 350], 10), { lw: 2.8, color: P.coral });
    sk.arrowHead(148, 350, 1.3, 11, { lw: 2.8, color: P.coral });
    const typing = t > 0.03 && t < 0.27;
    const thumb = seg(t, 0.74, 0.78) * (1 - seg(t, 0.93, 0.97));
    const watching = t > 0.32 && t < 0.97;
    c.save(); c.translate(HX, HY); c.scale(HS, HS);
    human(sk, {
      look: typing ? [0.2, 1] : watching ? [1, -0.2] : [0, 0],
      smile: thumb > 0.2 || t < 0.04,
      wow: t > 0.66 && t < 0.74,
      tilt: thumb > 0.3 ? 0.06 : 0,
      handR: thumb > 0 ? [lerp(50, 76, thumb), lerp(-110, -250, thumb)] : [50 + (typing ? Math.sin(t * TAU * 40) * 4 : 0), -110],
      handL: [-50 + (typing ? Math.cos(t * TAU * 40) * 4 : 0), -110],
      thumb: thumb > 0.5,
    });
    c.restore();
    // desk (in front of the radiologist's legs)
    sk.shape(G.rect(40, 516, 324, 170, 4), { fill: '#D9B47C', lw: 3.2, hatch: { region: G.rect(300, 510, 80, 180), gap: 6, alpha: 0.32 } });
    sk.shape(G.rect(26, 500, 352, 22, 6), { fill: P.wood, lw: 3.2 });
    c.save(); c.translate(204, 584); c.rotate(-0.04);
    sk.shape(G.rect(-118, -34, 236, 62, 3), { fill: '#FFF1A8', lw: 2.4 });
    sk.text('no coding needed', 0, 8, { font: '700 32px Caveat', align: 'center', jitter: true });
    c.restore();
    // laptop, screen toward us
    sk.shape([[96, 500], [314, 500], [326, 488], [84, 488]], { fill: P.grey, lw: 3 });
    sk.shape(G.rect(110, 402, 190, 88, 8), { fill: P.grey, lw: 3, hatch: { region: G.rect(270, 396, 40, 100), gap: 6, alpha: 0.35 } });
    sk.shape(G.rect(120, 410, 170, 72, 4), { fill: P.screen, lw: 2.2 });
    const lines = Math.floor(seg(t, 0.03, 0.27) * 4 + (t >= 0.27 && t < 0.97 ? 4 : 0));
    for (let i = 0; i < Math.min(lines, 4); i++) sk.line(132, 424 + i * 14, 132 + [120, 90, 136, 70][i], 424 + i * 14, { lw: 3, color: '#7CF0B4', double: false, alpha: 0.85 });
    if (Math.floor(t * 16) % 2 === 0) sk.fillPts(G.rect(132 + (lines < 4 ? [120, 90, 136, 70][Math.min(lines, 3)] * 0.4 : 74), 418 + Math.min(lines, 3) * 14, 8, 12), '#7CF0B4');

    // ---------- robot with headphones ----------
    sk.shape(G.ellipse(RBX, RBY + 2, 90, 14), { fill: 'rgba(60,45,25,0.10)', stroke: false, hatch: { gap: 5, alpha: 0.35, angle: -0.5 } });
    const building = t > 0.34 && t < 0.62;
    const k = Math.floor((t - 0.34) / 0.07);
    const toss = building ? Math.max(0, Math.sin(((t - 0.34) / 0.07) * Math.PI)) : 0;
    const toLocal = ([x, y]) => [(x - RBX) / RS, (y - RBY) / RS];
    const handR = building ? [lerp(80, 104, toss), lerp(-60, -140, toss)] : [80 + beat * 4, -50];
    const handL = t > 0.3 && t < 0.36 ? [-70, -150] : [-80 - beat * 4, -50];
    const happy = t > 0.7 && t < 0.95;
    const bob = beat * 3;
    c.save(); c.translate(RBX, RBY); c.scale(RS, RS);
    robot(sk, {
      look: t < 0.3 ? [-1, -0.2] : t < 0.7 ? [1, -0.3] : [0, 0],
      blink: pulse(t, 0.14, 0.17, 0.012),
      happy,
      bob,
      sway: Math.sin(t * TAU * 4) * 0.18,
      tilt: Math.sin(t * TAU * 4) * 0.05,
      antenna: Math.max(pulse(t, 0.3, 0.38, 0.02), happy ? 0.5 : 0),
      handL, handR,
      mouth: pulse(t, 0.3, 0.36, 0.01) > 0.5 ? 'o' : null,
    });
    // headphones over the head, same transform as the head
    c.save(); c.translate(0, -156 + bob); c.rotate(Math.sin(t * TAU * 4) * 0.05);
    sk.path(G.arc(0, -52, 98, 84, Math.PI * 1.06, Math.PI * 1.94, 22), { lw: 9, color: P.navy });
    sk.shape(G.rect(-104, -78, 30, 54, 12), { fill: P.coral, lw: 3, hatch: { region: G.rect(-84, -82, 14, 62), gap: 5, alpha: 0.35 } });
    sk.shape(G.rect(74, -78, 30, 54, 12), { fill: P.coral, lw: 3, hatch: { region: G.rect(94, -82, 14, 62), gap: 5, alpha: 0.35 } });
    c.restore();
    c.restore();
    // music notes drifting up from the headphones (2 cycles per loop)
    for (let i = 0; i < 4; i++) {
      const u = (t * 2 + i / 4) % 1;
      const side = i % 2 ? 1 : -1;
      const x = RBX + side * (96 + u * 40) + Math.sin(u * TAU) * 10;
      const y = RBY - 250 - u * 120;
      note(sk, x, y, [P.gold, P.teal, P.coral, P.blue][i], Math.min(1, u * 5) * (1 - u), 0.9);
    }
    sk.text('your AI coder', RBX, 640, { font: '700 34px Caveat', align: 'center', jitter: true });

    // ---------- code blocks: fly from the robot, snap into the window ----------
    for (let i = 0; i < 4; i++) {
      const t0 = 0.34 + i * 0.07, p = seg(t, t0, t0 + 0.09);
      if (t < t0 || done >= 1 || t > 0.97) continue;
      const slot = [WIN.x + WIN.w / 2, WIN.y + 92 + i * 62];
      const from = [RBX + 92, RBY - 124];
      const e = ease.inOut(p);
      const pos = bezierAt(from, [from[0] + 20, from[1] - 220], [slot[0] - 60, slot[1] - 120], slot, e);
      const a = 1 - done;
      codeBlock(sk, pos[0], pos[1], BLOCKS[i], lerp(0.45, 1, e), (1 - e) * -0.35, a);
      const snap = pulse(t, t0 + 0.088, t0 + 0.13, 0.01);
      if (snap > 0 && done < 0.5) for (const [dx, dy, ex, ey] of [[-136, -10, -150, -20], [-136, 10, -150, 20], [136, -10, 150, -20], [136, 10, 150, 20]])
        sk.line(slot[0] + dx, slot[1] + dy, slot[0] + ex, slot[1] + ey, { lw: 2.6, alpha: snap });
    }

    // ---------- the request: chat bubble + paper plane to the robot ----------
    const bb = ease.back(seg(t, 0.01, 0.05)) * (1 - ease.in(seg(t, 0.29, 0.33)));
    if (bb > 0.01) {
      c.save(); c.translate(210, 196); c.scale(bb, bb);
      sk.shape([[-30, 44], [-46, 96], [10, 44]], { fill: '#fff', lw: 3 });
      sk.shape(G.rect(-170, -62, 340, 112, 26), { fill: '#fff', lw: 3 });
      sk.fillPts(G.rect(-34, 34, 46, 14), '#fff');
      const n = Math.floor(seg(t, 0.04, 0.25) * (PROMPT[0].length + PROMPT[1].length));
      const l1 = PROMPT[0].slice(0, n), l2 = PROMPT[1].slice(0, Math.max(0, n - PROMPT[0].length));
      sk.text(l1, -150, -10, { font: '700 34px Caveat' });
      sk.text(l2, -150, 30, { font: '700 34px Caveat', color: P.tealDark });
      c.restore();
    }
    const pp = seg(t, 0.26, 0.32);
    if (pp > 0 && pp < 1) {
      const pos = bezierAt([360, 190], [420, 110], [500, 140], [RBX, RBY - 300 * RS], ease.inOut(pp));
      c.save(); c.translate(pos[0], pos[1]); c.rotate(0.5 + pp * 0.6);
      sk.shape([[-18, -10], [20, 0], [-18, 10], [-10, 0]], { fill: '#fff', lw: 2.4 });
      c.restore();
    }

    // ---------- the radiologist's reaction ----------
    const hb = ease.back(seg(t, 0.76, 0.8)) * (1 - ease.in(seg(t, 0.93, 0.97)));
    if (hb > 0.01) {
      c.save(); c.translate(204, 214); c.scale(hb, hb);
      sk.shape([[-10, 34], [-20, 76], [24, 34]], { fill: '#fff', lw: 3 });
      sk.shape(G.rect(-96, -40, 192, 78, 24), { fill: '#fff', lw: 3 });
      sk.fillPts(G.rect(-14, 26, 40, 14), '#fff');
      sk.text('it works!', 0, 12, { font: '700 40px Caveat', align: 'center', color: P.green, jitter: true });
      c.restore();
    }
  }

  window.SCENES.lab05 = scene;
})();
