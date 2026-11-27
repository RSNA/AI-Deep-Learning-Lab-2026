// Lab 06: pretrained embedding models. The robot (a pretrained model) takes each image from
// "your images", turns it into a point, and shoots it onto an embedding map where similar
// images gather into clusters. Then a classifier boundary is drawn and an operating-point
// slider shifts it, flipping the borderline cases.
(function () {
  const { G, seg, ease, lerp, pulse, TAU, bezierAt, mulberry32 } = SK;
  const { robot } = ROBOT;

  const RBX = 226, RBY = 552, RS = 0.98;
  const ANT = [RBX, RBY - 302 * RS];               // antenna tip, world
  const HAND = [334, 350];                          // where the robot catches an image
  const FACE = [RBX, RBY - 208 * RS];               // screen face centre
  const TRAY = [122, 128];
  const BOARD = { x: 396, y: 54, w: 556, h: 468 };
  const NITEMS = 6;                                 // images per 8 s loop
  const CL = [
    { name: 'normal', c: [560, 196], col: 'teal', lab: [560, 132] },
    { name: 'pneumonia', c: [826, 214], col: 'coral', lab: [836, 140] },
    { name: 'nodule', c: [668, 408], col: 'gold', lab: [668, 490] },
  ];
  // order the categories arrive in (repeats every loop)
  const ORDER = [0, 1, 2, 1, 0, 2];
  // borderline cases sitting near the classifier boundary
  const BORDER = [{ p: [716, 250], cl: 0 }, { p: [742, 168], cl: 0 }, { p: [770, 300], cl: 1 }];

  const rnd = mulberry32(606);
  const BASE = CL.map((cl, i) => {
    const pts = [];
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * TAU + rnd() * 0.5, r = k === 0 ? 0 : 22 + rnd() * 26;
      pts.push([cl.c[0] + Math.cos(a) * r * 1.15, cl.c[1] + Math.sin(a) * r * 0.9]);
    }
    return pts;
  });
  const NEW = ORDER.map((ci, i) => {
    const a = rnd() * TAU, r = 10 + rnd() * 30, la = rnd() * TAU;
    const tgt = [CL[ci].c[0] + Math.cos(a) * r, CL[ci].c[1] + Math.sin(a) * r * 0.85];
    const land = [tgt[0] + Math.cos(la) * 80, tgt[1] + Math.sin(la) * 60];
    land[0] = Math.max(BOARD.x + 40, Math.min(BOARD.x + BOARD.w - 40, land[0]));
    land[1] = Math.max(BOARD.y + 50, Math.min(BOARD.y + BOARD.h - 50, land[1]));
    return { ci, tgt, land };
  });

  // classifier boundary (pneumonia on the right), shifted by the operating point
  const B0 = [[712, 56], [694, 190], [776, 330], [772, 520]];
  const boundary = (dx) => G.bezier(...B0.map(([x, y]) => [x + dx, y]), 40);
  function boundaryXAt(pts, y) {
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      if ((y - y0) * (y - y1) <= 0) return lerp(x0, x1, (y - y0) / ((y1 - y0) || 1));
    }
    return pts[pts.length - 1][0];
  }

  function thumb(sk, x, y, kind, s = 1) {
    const P = sk.pal, c = sk.ctx;
    c.save(); c.translate(x, y); c.scale(s, s);
    sk.shape(G.rect(-26, -32, 52, 64, 4), { fill: '#F4F1E8', lw: 2.6 });
    sk.shape(G.rect(-20, -26, 40, 52, 2), { fill: '#2C3B46', lw: 1.6 });
    sk.fillPts(G.ellipse(-9, -1, 7.5, 17, 14), '#6E8898');
    sk.fillPts(G.ellipse(9, -1, 7.5, 17, 14), '#6E8898');
    if (kind === 1) sk.fillPts(G.ellipse(9, 6, 7, 9, 12), '#D9E4EA', { alpha: 0.85 });
    if (kind === 2) sk.fillPts(G.circle(-9, -6, 3.2, 10), '#EEF5F7');
    c.restore();
  }

  function dot(sk, x, y, colKey, r = 8, alpha = 1) {
    const P = sk.pal;
    sk.ctx.save(); sk.ctx.globalAlpha *= alpha;
    sk.shape(G.circle(x, y, r, 14), { fill: P[colKey], lw: 2.2, double: false });
    sk.ctx.restore();
  }

  function scene(sk, t) {
    const P = sk.pal, c = sk.ctx;
    const per = 1 / NITEMS;
    const item = Math.floor(t * NITEMS) % NITEMS, u = (t * NITEMS) % 1;
    const cur = NEW[item];

    // ---------- operating point + classifier timing ----------
    const draw = ease.inOut(seg(t, 0.42, 0.56));
    const fade = 1 - seg(t, 0.93, 0.995);
    const knob = -Math.sin(TAU * ease.inOut(seg(t, 0.62, 0.9))) * 0.95;   // left = more sensitive
    const dx = knob * 52;
    const bpts = boundary(dx);

    // ---------- embedding map board ----------
    const B = BOARD;
    sk.shape(G.rect(B.x, B.y, B.w, B.h, 10), { fill: '#fff', lw: 3.2 });
    c.save();
    c.beginPath(); c.rect(B.x + 3, B.y + 3, B.w - 6, B.h - 6); c.clip();
    c.globalAlpha = 0.16; c.strokeStyle = P.ink; c.lineWidth = 1;
    for (let x = B.x + 46; x < B.x + B.w; x += 46) { c.beginPath(); c.moveTo(x, B.y); c.lineTo(x, B.y + B.h); c.stroke(); }
    for (let y = B.y + 46; y < B.y + B.h; y += 46) { c.beginPath(); c.moveTo(B.x, y); c.lineTo(B.x + B.w, y); c.stroke(); }
    c.globalAlpha = 1;
    // pneumonia side of the boundary
    if (draw > 0 && fade > 0) {
      const region = bpts.concat([[B.x + B.w + 10, B.y + B.h + 10], [B.x + B.w + 10, B.y - 10]]);
      const yMax = bpts[Math.max(1, Math.round((bpts.length - 1) * draw))][1];
      c.save(); c.beginPath(); c.rect(B.x, B.y, B.w, yMax - B.y); c.clip();
      c.save(); c.globalAlpha *= 0.55 * Math.min(1, draw * 2) * fade;
      sk.fillPts(region, 'rgba(233,113,75,0.16)', { salt: 'reg' });
      sk.hatch(region, { gap: 9, alpha: 0.22, color: P.coral, angle: -0.8, salt: 'reg' });
      c.restore(); c.restore();
    }
    c.restore();
    sk.text('embedding map', B.x + 20, B.y + 40, { font: '700 34px Caveat', jitter: true });

    // cluster blobs + labels
    CL.forEach((cl) => {
      c.save(); c.globalAlpha *= 0.22;
      sk.fillPts(G.ellipse(cl.c[0], cl.c[1], 66, 52, 30), P[cl.col], { salt: cl.name });
      c.restore();
      sk.text(cl.name, cl.lab[0], cl.lab[1], { font: '700 34px Caveat', align: 'center', jitter: true, color: cl.col === 'gold' ? '#A8772B' : cl.col === 'coral' ? '#B4482B' : P.tealDark });
    });
    BASE.forEach((pts, i) => pts.forEach(([x, y]) => dot(sk, x, y, CL[i].col, 7.5)));

    // borderline cases: ringed when they fall on the pneumonia side
    BORDER.forEach(({ p, cl }) => {
      dot(sk, p[0], p[1], CL[cl].col, 8);
      if (draw > 0.9 && fade > 0) {
        const inside = p[0] > boundaryXAt(bpts, p[1]);
        if (inside) {
          c.save(); c.globalAlpha *= fade;
          sk.path(G.circle(p[0], p[1], 15, 18).concat([G.circle(p[0], p[1], 15, 18)[0]]), { lw: 3, color: P.coral, double: false, salt: 'ring' });
          c.restore();
        }
      }
    });

    // the boundary line, drawn on, then nudged by the slider
    if (draw > 0 && fade > 0) {
      const n = Math.max(2, Math.round(bpts.length * draw));
      c.save(); c.globalAlpha *= fade;
      sk.path(bpts.slice(0, n), { lw: 4.4, color: P.ink, dash: [14, 9], salt: 'bd' });
      c.restore();
      if (draw > 0.95) {
        const vb = pulse(t, 0.58, 0.95, 0.03) * fade;
        if (vb > 0) {
          c.save(); c.globalAlpha *= vb;
          sk.text('validated', B.x + B.w - 56, B.y + B.h - 22, { font: '700 30px Caveat', align: 'right', color: P.green, jitter: true });
          sk.path([[B.x + B.w - 46, B.y + B.h - 34], [B.x + B.w - 38, B.y + B.h - 26], [B.x + B.w - 20, B.y + B.h - 48]], { lw: 4, color: P.green });
          c.restore();
        }
      }
    }

    // ---------- operating point slider ----------
    {
      const x0 = 470, x1 = 880, y = 584, mid = (x0 + x1) / 2;
      sk.text('operating point', mid, 550, { font: '700 32px Caveat', align: 'center', jitter: true });
      sk.shape(G.rect(x0, y - 7, x1 - x0, 14, 7), { fill: P.grey, lw: 2.8 });
      sk.line(mid, y - 14, mid, y + 14, { lw: 2.2, alpha: 0.5, double: false });
      const kx = mid + knob * (x1 - x0) * 0.4;
      sk.shape(G.rect(kx - 14, y - 18, 28, 36, 9), { fill: P.coral, lw: 3, hatch: { region: G.rect(kx + 4, y - 30, 20, 60), gap: 5, alpha: 0.35 } });
      sk.text('more sensitive', x0, 630, { font: '600 28px Caveat', jitter: true, alpha: 0.85 });
      sk.text('more specific', x1, 630, { font: '600 28px Caveat', align: 'right', jitter: true, alpha: 0.85 });
    }

    // ---------- your images (tray) ----------
    sk.text('your images', TRAY[0], 46, { font: '700 34px Caveat', align: 'center', jitter: true });
    sk.shape(G.rect(TRAY[0] - 82, 70, 164, 94, 10), { fill: P.wood, lw: 3.2, hatch: { gap: 8, alpha: 0.18, angle: 0.2 } });
    c.save(); c.beginPath(); c.rect(TRAY[0] - 90, 0, 180, 118); c.clip();
    thumb(sk, TRAY[0] - 34, 118, 0, 0.9);
    thumb(sk, TRAY[0] + 2, 112, 1, 0.9);
    thumb(sk, TRAY[0] + 38, 120, 2, 0.9);
    c.restore();
    sk.shape(G.rect(TRAY[0] - 82, 116, 164, 48, 8), { fill: P.wood, lw: 3.2 });

    // ---------- robot ----------
    sk.text('pretrained model', RBX, 618, { font: '700 32px Caveat', align: 'center', jitter: true });
    sk.shape(G.ellipse(RBX, RBY + 2, 90, 14), { fill: 'rgba(60,45,25,0.10)', stroke: false, hatch: { gap: 5, alpha: 0.35, angle: -0.5 } });
    const raise = ease.inOut(seg(u, 0.18, 0.34)) * (1 - ease.inOut(seg(u, 0.58, 0.8)));
    const hl = [(HAND[0] - RBX) / RS, (HAND[1] - RBY) / RS + 26];
    const handR = [lerp(80, hl[0], raise), lerp(-44, hl[1], raise)];
    const flash = pulse(u, 0.52, 0.72, 0.04);
    const lookUp = u < 0.34 ? [-0.6, -0.9] : u < 0.55 ? [0.8, -0.2] : [1, -0.6];
    c.save(); c.translate(RBX, RBY); c.scale(RS, RS);
    robot(sk, {
      look: lookUp,
      blink: pulse(t, 0.3, 0.33, 0.012),
      happy: u > 0.6 && u < 0.85,
      bob: Math.sin(t * TAU * 6) * 2,
      sway: Math.sin(t * TAU * 6) * 0.1,
      antenna: flash,
      antennaColor: flash > 0.3 ? P[CL[cur.ci].col] : P.gold,
      badgeGlow: flash * 0.6,
      handR, handL: [-80, -44],
      reach: 1.15,
    });
    c.restore();

    // ---------- the image in flight / being read ----------
    if (u < 0.34) {
      const p = ease.inOut(seg(u, 0, 0.34));
      const pt = bezierAt(TRAY, [TRAY[0] + 40, TRAY[1] - 80], [HAND[0], HAND[1] - 140], HAND, p);
      thumb(sk, pt[0], pt[1], cur.ci, lerp(0.9, 1.05, p));
    } else if (u < 0.55) {
      const p = ease.in(seg(u, 0.4, 0.55));
      thumb(sk, lerp(HAND[0], FACE[0], p), lerp(HAND[1], FACE[1], p), cur.ci, lerp(1.05, 0.05, p));
    }

    // ---------- points: shot from the antenna, land, then drift into their cluster ----------
    NEW.forEach((n, i) => {
      const born = (i + 0.55) * per;
      const age = (((t - born) % 1) + 1) % 1;         // loop-periodic age
      const fly = 0.42 * per, drift = 0.75 * per;
      const out = 1 - seg(age, 0.9, 0.985);
      if (age < fly) {
        const p = ease.inOut(age / fly);
        const ctrlY = Math.min(ANT[1], n.land[1]) - 140;
        const pt = bezierAt(ANT, [lerp(ANT[0], n.land[0], 0.3), ctrlY], [lerp(ANT[0], n.land[0], 0.7), ctrlY], n.land, p);
        sk.glow(pt[0], pt[1], 26, P[CL[n.ci].col], 0.7);
        dot(sk, pt[0], pt[1], CL[n.ci].col, 9);
      } else {
        const p = ease.inOut(seg(age, fly, fly + drift));
        const x = lerp(n.land[0], n.tgt[0], p), y = lerp(n.land[1], n.tgt[1], p);
        if (p < 1) { c.save(); c.globalAlpha *= 0.4 * (1 - p); sk.path([n.land, [x, y]], { lw: 2, dash: [4, 6], double: false }); c.restore(); }
        dot(sk, x, y, CL[n.ci].col, 8 + (1 - p) * 1.5, out);
      }
    });
  }

  window.SCENES.lab06 = scene;
})();
