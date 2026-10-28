// Lab 00 (welcome post): the mascot hosts a corkboard schedule of all eight labs.
// A laser pointer and a lift-and-glow highlight sweep the cards 01 -> 08, one per second;
// the Lab 02 agents cheer under a strip of bunting.
(function () {
  const { G, seg, ease, lerp, pulse, TAU } = SK;
  const { robot } = ROBOT;

  const BX = 254, BY = 18, BW = 716, BH = 636;      // board frame
  const IX = 268, IY = 32, IW = 688, IH = 608;       // cork area
  const COLW = IW / 4, CW = 150, CH = 234;
  const DAYS = ['Sun, Nov 29', 'Mon, Nov 30', 'Tue, Dec 1', 'Wed, Dec 2'];
  const CARDS = [
    { n: '01', time: '10:30 AM', name: ['intro to', 'AI agents'] },
    { n: '02', time: '2:30 PM', name: ['production', 'agents'] },
    { n: '03', time: '8:00 AM', name: ['foundation', 'models'] },
    { n: '04', time: '9:30 AM', name: ['ready to', 'deploy?'] },
    { n: '05', time: '1:30 PM', name: ['vibe', 'coding'] },
    { n: '06', time: '4:30 PM', name: ['embedding', 'models'] },
    { n: '07', time: '8:00 AM', name: ['fine-tune', 'VLMs'] },
    { n: '08', time: '9:30 AM', name: ['data for', 'VLMs'] },
  ];
  const RX = 126, RY = 642, RS = 0.74;              // host robot
  const AGENTS = [{ body: '#EDB95E', dark: '#A8772B' }, { body: '#6C9BD6', dark: '#2F5E9E' }, { body: '#E9714B', dark: '#A9452A' }];

  const cardPos = (j) => {
    const col = Math.floor(j / 2), row = j % 2;
    const cx = IX + col * COLW + COLW / 2;
    return { x: cx - CW / 2, y: row ? 380 : 108, cx, rot: [-0.018, 0.014, 0.012, -0.016, -0.01, 0.018, 0.016, -0.012][j] };
  };
  const hexCenter = (j) => { const p = cardPos(j); return [p.x + 6, p.y + CH / 2 + 10]; };

  // ---------- tiny icons, one per lab, drawn around (cx, cy) ----------
  function icon(sk, j, cx, cy, act, u) {
    const P = sk.pal, c = sk.ctx;
    const spin = act * u * TAU;
    switch (j) {
      case 0: { // think -> tool loop
        sk.strokePts(G.ellipse(cx, cy, 40, 32, 40), true, { lw: 2.6, dash: [7, 6] });
        sk.arrowHead(cx + 40, cy + 4, Math.PI / 2, 10, { lw: 2.6 });
        sk.arrowHead(cx - 40, cy - 4, -Math.PI / 2, 10, { lw: 2.6 });
        sk.shape(G.circle(cx, cy - 4, 12), { fill: act > 0.5 ? '#FFE39A' : P.cream, lw: 2.4 });
        sk.shape(G.rect(cx - 6, cy + 7, 12, 8, 2), { fill: P.grey, lw: 2 });
        const a = -Math.PI / 2 + spin;
        sk.shape(G.circle(cx + Math.cos(a) * 40, cy + Math.sin(a) * 32, 6), { fill: P.gold, lw: 2 });
        break;
      }
      case 1: { // orchestrator + agents + conveyor
        const top = [cx, cy - 34];
        const kids = [[cx - 36, cy + 2, '#EDB95E'], [cx, cy + 2, '#6C9BD6'], [cx + 36, cy + 2, '#E9714B']];
        for (const [x, y] of kids) sk.line(top[0], top[1], x, y, { lw: 2, alpha: 0.7, double: false });
        sk.shape(G.circle(top[0], top[1], 12), { fill: P.teal, lw: 2.4 });
        kids.forEach(([x, y, col], i) => {
          const hop = act * Math.max(0, Math.sin(u * TAU * 2 - i * 1.2)) * 5;
          sk.shape(G.circle(x, y - hop, 10), { fill: col, lw: 2.4 });
        });
        sk.shape(G.rect(cx - 48, cy + 26, 96, 12, 6), { fill: '#59657A', lw: 2.4 });
        const off = (act * u * 40) % 40;
        for (let k = 0; k < 3; k++) {
          const x = cx - 40 + ((k * 40 + off) % 80);
          sk.shape(G.rect(x - 9, cy + 12, 18, 14, 2), { fill: P.cream, lw: 2 });
        }
        break;
      }
      case 2: { // foundation block of scan bricks + tasks on top
        const cols = ['#2C3B46', '#4A3D66', '#2C3B46', '#4A3D66', '#2C3B46', '#4A3D66'];
        for (let r = 0; r < 2; r++) for (let k = 0; k < 3; k++) {
          const x = cx - 45 + k * 30, y = cy - 4 + r * 22;
          sk.shape(G.rect(x, y, 28, 20, 3), { fill: cols[r * 3 + k], lw: 2 });
          sk.fillPts(G.ellipse(x + 14, y + 10, 7, 6, 10), '#8FA6B3', { alpha: 0.9 });
        }
        const drop = act ? ease.out(seg(u, 0.05, 0.45)) : 1;
        sk.shape(G.rect(cx - 14, lerp(cy - 60, cy - 26, drop), 28, 20, 3), { fill: '#2C3B46', lw: 2 });
        ['#EDB95E', '#6C9BD6', '#E9714B'].forEach((col, k) => sk.shape(G.circle(cx - 36 + k * 36, cy - 14, 7), { fill: col, lw: 2, alpha: drop > 0.95 || k !== 1 ? 1 : 0.0 }));
        break;
      }
      case 3: { // checklist
        sk.shape(G.rect(cx - 34, cy - 42, 68, 86, 6), { fill: '#fff', lw: 2.4 });
        sk.shape(G.rect(cx - 14, cy - 50, 28, 12, 3), { fill: P.grey, lw: 2 });
        for (let k = 0; k < 3; k++) {
          const y = cy - 22 + k * 24;
          sk.shape(G.rect(cx - 26, y - 8, 14, 14, 2), { fill: '#fff', lw: 2 });
          sk.line(cx - 6, y, cx + 24, y, { lw: 2, alpha: 0.6, double: false });
          const done = act ? seg(u, 0.1 + k * 0.2, 0.2 + k * 0.2) : 1;
          if (done > 0) sk.path([[cx - 25, y - 2], [cx - 20, y + 4], [cx - 10, y - 12]], { lw: 3, color: P.green, double: false, overshoot: false, alpha: done });
        }
        break;
      }
      case 4: { // headphones + code
        sk.path(G.arc(cx, cy + 4, 38, 38, Math.PI * 1.05, Math.PI * 1.95, 18), { lw: 5, color: P.navy });
        sk.shape(G.rect(cx - 48, cy - 2, 16, 28, 6), { fill: P.coral, lw: 2.4 });
        sk.shape(G.rect(cx + 32, cy - 2, 16, 28, 6), { fill: P.coral, lw: 2.4 });
        sk.text('</>', cx, cy + 20, { font: '700 26px JetBrains', align: 'center', color: P.tealDark });
        if (act) {
          const k = Math.floor(u * 6) % 2;
          sk.text('♪', cx + 46, cy - 26 - k * 4, { font: '700 24px Bricolage', color: P.gold, align: 'center' });
        }
        break;
      }
      case 5: { // embedding clusters
        const groups = [[cx - 26, cy - 18, P.teal], [cx + 24, cy - 16, P.coral], [cx, cy + 22, P.gold]];
        const r = SK.mulberry32(42);
        groups.forEach(([gx, gy, col]) => {
          sk.fillPts(G.ellipse(gx, gy, 20, 15, 18), col, { alpha: 0.18 });
          for (let k = 0; k < 5; k++) {
            const tight = act ? lerp(1.6, 1, ease.inOut(seg(u, 0.05, 0.5))) : 1;
            const dx = (r() - 0.5) * 24 * tight, dy = (r() - 0.5) * 18 * tight;
            sk.fillPts(G.circle(gx + dx, gy + dy, 3.6, 10), col);
          }
        });
        sk.path([[cx + 2, cy - 44], [cx - 4, cy - 4], [cx + 8, cy + 8], [cx + 46, cy + 4]], { lw: 2, dash: [5, 5] });
        break;
      }
      case 6: { // sliders
        for (let k = 0; k < 3; k++) {
          const x = cx - 32 + k * 32;
          sk.line(x, cy - 38, x, cy + 34, { lw: 3, double: false });
          const base = [0.3, 0.7, 0.5][k];
          const v = act ? base + 0.25 * Math.sin(u * TAU + k * 2) * act : base;
          sk.shape(G.rect(x - 10, lerp(cy + 28, cy - 38, v) - 6, 20, 12, 3), { fill: [P.gold, P.coral, P.teal][k], lw: 2.2 });
        }
        break;
      }
      case 7: { // washing machine + film
        sk.shape(G.rect(cx - 36, cy - 40, 72, 82, 10), { fill: '#fff', lw: 2.4 });
        sk.line(cx - 36, cy - 24, cx + 36, cy - 24, { lw: 2, double: false });
        sk.shape(G.circle(cx + 22, cy - 32, 3), { fill: P.green, lw: 1.4 });
        sk.shape(G.circle(cx, cy + 10, 22), { fill: P.tealLight, lw: 2.6 });
        c.save(); c.translate(cx, cy + 10); c.rotate(spin * 2);
        sk.shape(G.rect(-9, -11, 18, 22, 2), { fill: '#10181E', lw: 1.8 });
        XRAY.draw(sk, -9, -11, 18, 22, { nodule: false });
        c.restore();
        for (let k = 0; k < 3; k++) sk.shape(G.circle(cx - 12 + k * 12, cy + 2 + (k % 2) * 14, 3.2), { fill: '#fff', lw: 1.2 });
        break;
      }
    }
  }

  function card(sk, j, act, u) {
    const P = sk.pal, c = sk.ctx, p = cardPos(j), d = CARDS[j];
    c.save();
    c.translate(p.x + CW / 2, p.y + CH / 2);
    const wig = act * Math.sin(u * TAU * 2) * 0.025;
    c.rotate(p.rot + wig);
    const s = 1 + 0.045 * act;
    c.scale(s, s);
    c.translate(-CW / 2, -CH / 2 - 5 * act);
    if (act > 0) sk.glow(CW / 2, CH / 2, 150, P.gold, 0.7 * act);
    c.fillStyle = `rgba(80,60,30,${0.10 + 0.12 * act})`;
    c.fillRect(5 + 6 * act, 7 + 10 * act, CW, CH);
    sk.shape(G.rect(0, 0, CW, CH, 6), { fill: act > 0.5 ? '#FFFDF4' : P.sheet, lw: 2.8, salt: 'card' + j });
    // tape
    c.save(); c.translate(CW / 2, -2); c.rotate(j % 2 ? 0.08 : -0.07);
    sk.shape(G.rect(-34, -11, 68, 22, 2), { fill: 'rgba(233,215,160,0.85)', lw: 1.4, alpha: 0.5 });
    c.restore();
    // number + time
    sk.shape(G.hex(32, 36, 24), { fill: P.gold, lw: 2.8 });
    sk.text(d.n, 32, 45, { font: '800 24px Bricolage', align: 'center' });
    sk.text(d.time, CW - 8, 46, { font: '700 25px Caveat', align: 'right', color: P.tealDark });
    icon(sk, j, CW / 2, 120, act, u);
    sk.text(d.name[0], CW / 2, 194, { font: '700 30px Caveat', align: 'center', jitter: true });
    sk.text(d.name[1], CW / 2, 224, { font: '700 30px Caveat', align: 'center', jitter: true });
    c.restore();
  }

  function scene(sk, t) {
    const P = sk.pal, c = sk.ctx;
    const k = Math.floor(t * 8) % 8, u = t * 8 - Math.floor(t * 8);
    const actOf = (j) => (j === k ? Math.min(ease.out(seg(u, 0, 0.14)), 1 - ease.in(seg(u, 0.9, 1))) : 0);

    // ---------- bunting (top left) ----------
    const flagCols = [P.gold, P.coral, P.teal, P.blue, P.gold, P.coral, P.teal];
    const bunt = G.bezier([14, 40], [80, 78], [170, 78], [236, 44], 30);
    sk.path(bunt, { lw: 2.4 });
    for (let i = 0; i < 7; i++) {
      const [x, y] = SK.bezierAt([14, 40], [80, 78], [170, 78], [236, 44], (i + 0.5) / 7);
      c.save(); c.translate(x, y); c.rotate(Math.sin(t * TAU * 2 + i) * 0.12);
      sk.shape([[-13, 0], [13, 0], [0, 30]], { fill: flagCols[i], lw: 2.2 });
      c.restore();
    }

    // ---------- cheering agents (top left) ----------
    AGENTS.forEach((a, i) => {
      const x = 52 + i * 74, phase = t * 2 + i / 3;
      const jump = Math.abs(Math.sin(phase * TAU)) * 12;
      const wave = Math.sin(phase * TAU * 2) * 10;
      c.save(); c.translate(x, 262 - jump); c.scale(0.34, 0.34);
      robot(sk, {
        body: a.body, dark: a.dark, badge: P.cream, happy: true,
        handL: [-96 + wave, -230], handR: [96 - wave, -230],
        sway: Math.sin(phase * TAU) * 0.2,
      });
      c.restore();
    });

    // ---------- board ----------
    sk.shape(G.rect(BX, BY, BW, BH, 12), { fill: P.wood, lw: 3.4, hatch: { gap: 9, alpha: 0.18, angle: 0.15 } });
    sk.shape(G.rect(IX, IY, IW, IH, 6), { fill: '#E8CF9C', lw: 2.4 });
    {
      const r = SK.mulberry32(9);
      c.fillStyle = 'rgba(120,85,40,0.22)';
      for (let i = 0; i < 260; i++) { c.beginPath(); c.arc(IX + 6 + r() * (IW - 12), IY + 6 + r() * (IH - 12), 0.8 + r() * 1.6, 0, TAU); c.fill(); }
    }
    DAYS.forEach((d, i) => {
      const cx = IX + i * COLW + COLW / 2;
      const on = Math.floor(k / 2) === i;
      sk.text(d, cx, 72, { font: '700 32px Caveat', align: 'center', color: on ? P.ink : 'rgba(38,34,30,0.75)', jitter: true });
      if (on) sk.path([[cx - 58, 80], [cx + 58, 78]], { lw: 3, color: P.coral, double: false });
    });

    // ---------- cards (inactive first, active on top) ----------
    for (let j = 0; j < 8; j++) if (actOf(j) <= 0) card(sk, j, 0, u);

    // ---------- host robot with laser pointer ----------
    const prev = hexCenter((k + 7) % 8), cur = hexCenter(k);
    const mv = ease.inOut(seg(u, 0, 0.18));
    const tgt = [lerp(prev[0], cur[0], mv), lerp(prev[1], cur[1], mv) - 5 * actOf(k)];
    const hand = [92, -168];
    const hw = [RX + hand[0] * RS, RY + hand[1] * RS];
    const ang = Math.atan2(tgt[1] - hw[1], tgt[0] - hw[0]);
    const tip = [hw[0] + Math.cos(ang) * 34, hw[1] + Math.sin(ang) * 34];
    sk.shape(G.ellipse(RX, RY - 2, 80, 12), { fill: 'rgba(60,45,25,0.10)', stroke: false, hatch: { gap: 5, alpha: 0.35, angle: -0.5 } });
    const wave = Math.sin(t * TAU * 4) * 14;
    c.save(); c.translate(RX, RY); c.scale(RS, RS);
    robot(sk, {
      look: [1, tgt[1] < 300 ? -0.7 : 0.2],
      blink: Math.max(pulse(t, 0.3, 0.33, 0.012), pulse(t, 0.8, 0.83, 0.012)),
      happy: t > 0.5 && t < 0.62,
      bob: Math.sin(t * TAU * 4) * 2.5,
      sway: Math.sin(t * TAU * 2) * 0.12,
      antenna: 0.4 + 0.4 * Math.sin(t * TAU * 8),
      handL: [-104 + wave, -222], handR: hand,
      holdR: (sk, x, y) => {
        sk.ctx.save(); sk.ctx.translate(x, y); sk.ctx.rotate(ang);
        sk.shape(G.rect(-4, -7, 50, 14, 5), { fill: P.navy, lw: 2.4 });
        sk.shape(G.circle(46, 0, 4), { fill: P.coral, lw: 1.6 });
        sk.ctx.restore();
      },
    });
    c.restore();

    // ---------- laser beam ----------
    c.save();
    c.strokeStyle = P.coral; c.globalAlpha = 0.5; c.lineWidth = 3; c.lineCap = 'round';
    c.beginPath(); c.moveTo(tip[0], tip[1]); c.lineTo(tgt[0], tgt[1]); c.stroke();
    c.restore();

    // ---------- active card + laser dot ----------
    if (actOf(k) > 0) card(sk, k, actOf(k), u);
    sk.glow(tgt[0], tgt[1], 30, P.coral, 0.75);
    sk.fillPts(G.circle(tgt[0], tgt[1], 6, 12), P.coral);

    // ---------- speech bubble ----------
    const first = t < 0.5;
    const local = first ? t / 0.5 : (t - 0.5) / 0.5;
    const sb = ease.back(seg(local, 0.0, 0.08)) * (1 - ease.in(seg(local, 0.92, 1)));
    if (sb > 0.01) {
      c.save(); c.translate(124, 356); c.scale(sb, sb);
      sk.shape([[10, 34], [24, 70], [40, 34]], { fill: '#fff', lw: 3 });
      sk.shape(G.rect(-104, -44, 208, 84, 26), { fill: '#fff', lw: 3 });
      sk.fillPts(G.rect(8, 24, 36, 14), '#fff');
      if (first) {
        sk.text('welcome!', 0, -4, { font: '700 42px Caveat', align: 'center', color: P.coral, jitter: true });
        sk.text('8 labs · 4 days', 0, 28, { font: '700 28px Caveat', align: 'center', color: P.tealDark, jitter: true });
      } else {
        sk.text('pick your lab', 0, -4, { font: '700 36px Caveat', align: 'center', jitter: true });
        sk.text('& bring a laptop!', 0, 28, { font: '700 28px Caveat', align: 'center', color: P.tealDark, jitter: true });
      }
      c.restore();
    }
  }

  window.SCENES.lab00 = scene;
})();
