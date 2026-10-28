// Lab 02: a production multi-agent system. An orchestrator dispatches messages to specialist
// agents (triage -> detect -> report) working studies on a conveyor from PACS, through a
// guardrail gate to the worklist, with logs and monitoring running alongside.
(function () {
  const { G, seg, ease, lerp, pulse, TAU, bezierAt } = SK;
  const { robot, props } = ROBOT;

  const BELT_Y = 548, SPACING = 175, NITEMS = 6, TRAVEL = 350; // px per loop = 2 spacings -> seamless
  const AG = [
    { x: 262, name: 'triage', body: '#EDB95E', dark: '#A8772B', tool: 'stamp' },
    { x: 472, name: 'detect', body: '#6C9BD6', dark: '#2F5E9E', tool: 'magnifier' },
    { x: 682, name: 'report', body: '#E9714B', dark: '#A9452A', tool: 'pencil' },
  ];
  const GATE_X = 840, OX = 492, OY = 262, OS = 0.62, AS = 0.6, AFEET = 556;
  const itemXs = (t) => { const xs = []; for (let k = 0; k < NITEMS; k++) xs.push(40 + ((k * SPACING + TRAVEL * t) % (SPACING * NITEMS))); return xs; };
  // loop time at which an item reaches x (twice per loop)
  const arrival = (x) => (((x - 40) / TRAVEL) % 0.5 + 0.5) % 0.5;

  const XRAY_STYLE = new URLSearchParams(location.search).get('xray') || 'balanced';

  function study(sk, x, P) {
    const c = sk.ctx, y = BELT_Y - 54;
    sk.shape(G.rect(x - 35, y, 70, 54, 5), { fill: P.cream, lw: 2.8 });
    sk.shape(G.rect(x - 28, y + 6, 38, 42, 3), { fill: '#121B22', lw: 2 });
    XRAY.draw(sk, x - 28, y + 6, 38, 42, XRAY.VARIANTS[XRAY_STYLE]);
    for (let i = 0; i < 3; i++) sk.line(x + 15, y + 12 + i * 10, x + 29, y + 12 + i * 10, { lw: 1.8, double: false });
    if (x > AG[0].x + 4) { // triage flag
      sk.line(x - 30, y, x - 30, y - 24, { lw: 2.6 });
      sk.shape([[x - 30, y - 24], [x - 10, y - 18], [x - 30, y - 11]], { fill: P.gold, lw: 2.4 });
    }
    if (x > AG[1].x + 4) sk.path(G.circle(x - 17, y + 22, 7.5, 16).concat([G.circle(x - 17, y + 22, 7.5, 16)[0]]), { lw: 2.8, color: P.coral, double: false });
    if (x > AG[2].x + 4) { // report page
      c.save(); c.translate(x + 22, y - 8); c.rotate(0.12);
      sk.shape(G.rect(-12, -14, 28, 36, 2), { fill: '#fff', lw: 2.4 });
      for (let i = 0; i < 4; i++) sk.line(-6, -6 + i * 7, 10 - (i === 3 ? 8 : 0), -6 + i * 7, { lw: 1.6, color: P.blue, double: false });
      c.restore();
    }
    if (x > GATE_X + 2) {
      sk.shape(G.circle(x + 26, y + 46, 12), { fill: P.green, lw: 2.4 });
      sk.path([[x + 20, y + 46], [x + 25, y + 51], [x + 33, y + 40]], { lw: 3, color: '#fff', double: false });
    }
  }

  function stamp(sk, x, y) {
    const P = sk.pal;
    sk.shape(G.rect(x - 5, y - 30, 10, 26, 4), { fill: P.wood, lw: 2.4 });
    sk.shape(G.rect(x - 16, y - 4, 32, 12, 3), { fill: P.navy, lw: 2.4 });
  }

  function envelope(sk, x, y, color) {
    const P = sk.pal;
    sk.glow(x, y, 30, color, 0.6);
    sk.shape(G.rect(x - 15, y - 10, 30, 20, 2), { fill: '#fff', lw: 2.4 });
    sk.path([[x - 15, y - 10], [x, y + 2], [x + 15, y - 10]], { lw: 2, overshoot: false, double: false });
  }

  function scene(sk, t) {
    const P = sk.pal, c = sk.ctx;
    const xs = itemXs(t);

    // ---------- wires: orchestrator -> agents, gate; gate -> monitor; desk -> logs ----------
    const wires = AG.map((a, i) => {
      const p0 = [OX - 50 + i * 50, OY + 12], p3 = [a.x, AFEET - 302 * AS];
      return { p0, p1: [p0[0], p0[1] + 70], p2: [p3[0], p3[1] - 80], p3, arrive: arrival(a.x) - 0.03 };
    });
    wires.push({ p0: [OX + 96, OY - 10], p1: [OX + 220, OY - 10], p2: [GATE_X, 300], p3: [GATE_X, 392], arrive: arrival(GATE_X) - 0.03 });
    for (const w of wires) sk.path(G.bezier(w.p0, w.p1, w.p2, w.p3, 30), { lw: 2.6, alpha: 0.75, dash: [2, 8], salt: 'w' });
    sk.path(G.bezier([GATE_X + 30, 436], [GATE_X + 60, 360], [952, 320], [940, 186], 24), { lw: 2.6, dash: [12, 9], dashOffset: t * 21 * 8, alpha: 0.8 });
    sk.path(G.bezier([OX - 96, OY - 18], [OX - 200, OY - 18], [300, 180], [214, 180], 24), { lw: 2.6, dash: [12, 9], dashOffset: -t * 21 * 8, alpha: 0.8 });

    // ---------- logs printer (top left) ----------
    {
      const px = 46, py = 150;
      c.save();
      c.beginPath(); c.rect(px + 22, 14, 126, py - 8); c.clip();
      sk.shape(G.rect(px + 30, 10, 110, py), { fill: '#fff', lw: 2.4 });
      const gap = 18, off = (t * gap * 8) % gap;
      for (let i = -1; i < 9; i++) {
        const y = py - 14 - i * gap - off;
        const k = (i + Math.floor(t * 8)) % 3;
        sk.path([[px + 64, y], [px + 98 + k * 9, y]], { lw: 2, alpha: 0.75, double: false });
        sk.path([[px + 40, y - 1], [px + 45, y + 4], [px + 54, y - 6]], { lw: 2.2, color: k === 2 ? P.coral : P.green, double: false });
      }
      c.restore();
      sk.shape(G.rect(px, py, 170, 62, 10), { fill: P.grey, lw: 3.2, hatch: { region: G.rect(px + 120, py - 4, 60, 70), gap: 6, alpha: 0.35 } });
      sk.shape(G.rect(px + 24, py - 2, 122, 10, 3), { fill: P.navy, lw: 2.4 });
      sk.shape(G.circle(px + 148, py + 36, 7), { fill: Math.floor(t * 16) % 2 ? P.green : '#2E6B3A', lw: 2 });
      sk.text('logs', px + 70, py + 104, { font: '700 36px Caveat', align: 'center', jitter: true });
    }

    // ---------- monitor (top right) ----------
    {
      const mx = 744, my = 34, mw = 206, mh = 150;
      sk.line(mx + mw / 2, my + mh, mx + mw / 2, my + mh + 26, { lw: 6 });
      sk.shape(G.rect(mx + mw / 2 - 36, my + mh + 22, 72, 12, 4), { fill: P.grey, lw: 2.6 });
      sk.shape(G.rect(mx, my, mw, mh, 12), { fill: P.grey, lw: 3.2 });
      sk.shape(G.rect(mx + 12, my + 12, mw - 24, mh - 24, 6), { fill: P.screen, lw: 2.4 });
      const pts = [];
      for (let i = 0; i <= 40; i++) {
        const u = i / 40 + t;
        const v = 0.5 + 0.22 * Math.sin(TAU * u * 3) + 0.12 * Math.sin(TAU * u * 7 + 1) + 0.08 * Math.sin(TAU * u * 13);
        pts.push([mx + 22 + (i / 40) * (mw - 44), my + 92 - v * 50]);
      }
      sk.path(pts, { lw: 2.6, color: '#7CF0B4', double: false });
      for (let i = 0; i < 3; i++) {
        const on = i < 2 || Math.floor(t * 8) % 2 === 0;
        sk.fillPts(G.circle(mx + 30 + i * 22, my + 112, 6, 12), i < 2 ? '#7CF0B4' : on ? P.gold : '#5a5030');
      }
      sk.text('ok', mx + mw - 30, my + 118, { font: '700 20px JetBrains', color: '#7CF0B4', align: 'right' });
      sk.text('monitoring', mx + mw / 2, my + mh + 74, { font: '700 36px Caveat', align: 'center', jitter: true });
    }

    // ---------- orchestrator at its desk ----------
    let next = 0, best = 1;
    wires.forEach((w, i) => { const d = (((w.arrive - 0.13 - t) % 0.5) + 0.5) % 0.5; if (d < best) { best = d; next = i; } });
    const target = wires[next].p3;
    const gest = ease.inOut(1 - seg(best, 0.02, 0.1));
    c.save(); c.translate(OX, OY); c.scale(OS, OS);
    const tl = [(target[0] - OX) / OS, (target[1] - OY) / OS];
    const dir = Math.atan2(tl[1] + 150, tl[0]);
    robot(sk, {
      headset: true,
      look: [Math.max(-1, Math.min(1, (target[0] - OX) / 260)), 0.6],
      blink: pulse(t, 0.6, 0.63, 0.012),
      bob: Math.sin(t * TAU * 4) * 2,
      antenna: 0.4 + 0.4 * Math.sin(t * TAU * 4),
      handL: [-86, -78], handR: [lerp(86, 60 + Math.cos(dir) * 50, gest), lerp(-78, -150 + Math.sin(dir) * 40, gest)],
      tilt: (target[0] - OX) / 4000,
    });
    c.restore();
    sk.shape(G.rect(OX - 104, OY - 42, 208, 56, 10), { fill: P.navy, lw: 3.2 });
    for (let i = 0; i < 6; i++) {
      const on = (Math.floor(t * 16) + i * 3) % 5 < 3;
      sk.shape(G.circle(OX - 74 + i * 30, OY - 16, 7), { fill: on ? [P.gold, P.green, P.coral][i % 3] : '#4a5368', lw: 2 });
    }
    sk.line(OX - 80, OY + 2, OX + 80, OY + 2, { lw: 2, color: '#8a94a8', double: false });
    sk.text('orchestrator', OX + 74, OY - 182, { font: '700 36px Caveat', jitter: true });

    // ---------- specialist agents (bodies behind the belt) ----------
    const agentState = AG.map((a) => {
      let dip = 0;
      for (const x of xs) dip = Math.max(dip, Math.exp(-Math.pow((x - a.x) / 26, 2)));
      return { dip };
    });
    const msgGlow = wires.map((w) => Math.max(pulse(t, w.arrive - 0.01, w.arrive + 0.08, 0.02), pulse(t, w.arrive + 0.49, w.arrive + 0.58, 0.02), pulse(t, w.arrive - 0.51, w.arrive - 0.42, 0.02)));
    const agentOpts = (a, i) => {
      const dip = agentState[i].dip;
      const hold = a.tool === 'stamp' ? stamp : a.tool === 'magnifier' ? (sk, x, y) => props.magnifier(sk, x, y, -0.2, 20) : (sk, x, y) => props.pencil(sk, x, y, 0.5, 56);
      return {
        body: a.body, dark: a.dark, badge: P.cream,
        look: [0.3, 1], happy: dip > 0.7,
        blink: pulse(t, 0.3 + i * 0.2, 0.33 + i * 0.2, 0.012),
        bob: Math.sin((t + i * 0.17) * TAU * 4) * 2,
        antenna: msgGlow[i], antennaColor: msgGlow[i] > 0.3 ? P.gold : P.cream,
        handR: [26, lerp(-168, -104, dip)], holdR: hold,
        handL: [-82, -60],
      };
    };
    AG.forEach((a, i) => {
      c.save(); c.translate(a.x, AFEET); c.scale(AS, AS);
      robot(sk, Object.assign(agentOpts(a, i), { noArms: true }));
      c.restore();
      sk.text(a.name, a.x - 24, AFEET - 302 * AS + 4, { font: '700 32px Caveat', align: 'right', jitter: true });
    });

    // ---------- guardrail gate (back posts) ----------
    const inGate = Math.max(...xs.map((x) => Math.exp(-Math.pow((x - GATE_X) / 24, 2))));

    // ---------- conveyor ----------
    for (let x = 70; x < 920; x += 150) if (Math.abs(x - GATE_X) > 70) sk.line(x, BELT_Y + 40, x - 8, 668, { lw: 3.2 });
    sk.shape(G.rect(20, BELT_Y, 940, 30, 14), { fill: '#59657A', lw: 3.2 });
    const boff = (TRAVEL * t) % 35;
    for (let x = 20 + boff; x < 960; x += 35) sk.line(x, BELT_Y + 6, x - 6, BELT_Y + 24, { lw: 2, color: '#9AA4B5', double: false });
    for (let x = 60; x < 950; x += 78) {
      sk.shape(G.circle(x, BELT_Y + 44, 13), { fill: P.grey, lw: 2.8 });
      const ang = (TRAVEL * t) / 13;
      sk.line(x, BELT_Y + 44, x + Math.cos(ang) * 10, BELT_Y + 44 + Math.sin(ang) * 10, { lw: 2.2, double: false });
    }

    // ---------- studies on the belt ----------
    for (const x of xs) if (x > 60 && x < 990) study(sk, x, P);

    // ---------- agent arms in front of the belt ----------
    AG.forEach((a, i) => {
      c.save(); c.translate(a.x, AFEET); c.scale(AS, AS);
      robot(sk, Object.assign(agentOpts(a, i), { armsOnly: true }));
      c.restore();
    });

    // ---------- gate frame ----------
    if (inGate > 0.05) { c.save(); c.globalAlpha = 0.25 * inGate; c.fillStyle = P.green; c.fillRect(GATE_X - 26, 452, 52, BELT_Y - 452); c.restore(); }
    sk.shape(G.rect(GATE_X - 36, 440, 12, BELT_Y - 436, 4), { fill: P.grey, lw: 2.8 });
    sk.shape(G.rect(GATE_X + 24, 440, 12, BELT_Y - 436, 4), { fill: P.grey, lw: 2.8 });
    sk.shape(G.rect(GATE_X - 46, 426, 92, 24, 6), { fill: P.navy, lw: 3 });
    const lit = inGate > 0.4;
    if (lit) sk.glow(GATE_X, 438, 40, P.green, 0.8);
    sk.shape(G.circle(GATE_X, 438, 7), { fill: lit ? '#9BF5B9' : P.gold, lw: 2 });
    const sh = [[GATE_X, 376], [GATE_X + 24, 384], [GATE_X + 22, 404], [GATE_X, 420], [GATE_X - 22, 404], [GATE_X - 24, 384]];
    sk.shape(sh, { fill: msgGlow[3] > 0.3 ? P.gold : P.tealLight, lw: 3 });
    sk.path([[GATE_X - 9, 398], [GATE_X - 2, 405], [GATE_X + 10, 390]], { lw: 3, double: false });
    sk.text('guardrails', GATE_X, 644, { font: '700 34px Caveat', align: 'center', jitter: true });
    sk.path([[GATE_X, 612], [GATE_X - 3, 594]], { lw: 2.6 });
    sk.arrowHead(GATE_X - 3, 594, -Math.PI / 2 - 0.15, 10, { lw: 2.6 });

    // ---------- PACS (left) and worklist (right) cover the belt ends ----------
    sk.shape(G.rect(10, 446, 124, 140, 12), { fill: '#D7E3EE', lw: 3.4, hatch: { region: G.rect(96, 440, 50, 150), gap: 6, alpha: 0.35 } });
    sk.shape(G.rect(118, 488, 18, 64, 4), { fill: '#26364F', lw: 2.6 });
    sk.text('PACS', 64, 498, { font: '800 26px JetBrains', align: 'center', color: P.navy });
    for (let i = 0; i < 3; i++) sk.line(30, 520 + i * 14, 96, 520 + i * 14, { lw: 2.2, alpha: 0.6, double: false });
    sk.shape(G.circle(36, 470, 5), { fill: Math.floor(t * 12) % 2 ? P.green : '#2E6B3A', lw: 1.8 });

    sk.shape(G.rect(886, 478, 100, 104, 8), { fill: P.wood, lw: 3.4, hatch: { gap: 8, alpha: 0.2, angle: 0.2 } });
    sk.shape(G.rect(898, 470, 76, 18, 4), { fill: '#fff', lw: 2.4 });
    sk.text('worklist', 934, 456, { font: '700 32px Caveat', align: 'center', jitter: true });
    sk.text('signed off', 934, 538, { font: '700 22px Caveat', align: 'center', color: P.ink });
    sk.path([[918, 556], [928, 566], [948, 546]], { lw: 3.4, color: P.green });

    // ---------- messages in flight ----------
    wires.forEach((w, i) => {
      for (const base of [w.arrive, w.arrive + 0.5, w.arrive - 0.5]) {
        const p = seg(t, base - 0.12, base);
        if (p > 0 && p < 1) {
          const [x, y] = bezierAt(w.p0, w.p1, w.p2, w.p3, ease.inOut(p));
          envelope(sk, x, y, i === 3 ? P.tealLight : P.gold);
        }
      }
    });
  }

  window.SCENES.lab02 = scene;
})();
