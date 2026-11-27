// Lab 08: a data pipeline for vision-language models.
// The robot pulls studies off the PACS archive shelves, places them on a belt that runs
// through a de-identification "washing machine" (the name tag gets scrubbed), a quality
// check (a blurry image gets knocked into the reject bin), and into a box of clean
// image + report pairs for VLM training.
(function () {
  const { G, seg, ease, lerp, pulse, TAU } = SK;
  const { robot } = ROBOT;

  const BELT_Y = 540, BELT_X0 = 220, BELT_X1 = 868;
  const RBX = 300, RBY = 548, RS = 0.85;
  const PLACE_X = 262, BOX_X = 860, V = BOX_X - PLACE_X; // px per loop; each study takes one loop
  const WASH = [420, 580], QC_X = 706, CARD_W = 104, CARD_H = 78;
  const SLOTS = [[182, 372], [156, 466], [188, 466]];
  const SHELF = { x: 24, y: 120, w: 184, h: 420 };
  const mod = (a, n) => ((a % n) + n) % n;

  // a study card: film on the left, report on the right, fake name tag until washed
  function card(sk, x, y, o) {
    const P = sk.pal, c = sk.ctx;
    c.save(); c.translate(x, y); if (o.rot) c.rotate(o.rot); c.globalAlpha *= o.alpha ?? 1;
    const w = CARD_W, h = CARD_H;
    sk.shape(G.rect(-w / 2, -h / 2, w, h, 6), { fill: P.cream, lw: 2.8 });
    // film
    c.save();
    if (o.blurry) c.filter = 'blur(2.6px)';
    sk.shape(G.rect(-w / 2 + 7, -h / 2 + 7, 46, h - 14, 3), { fill: '#10181E', lw: 2 });
    XRAY.draw(sk, -w / 2 + 7, -h / 2 + 7, 46, h - 14, { nodule: false });
    c.restore();
    // report
    sk.shape(G.rect(4, -h / 2 + 7, 42, h - 14, 2), { fill: '#fff', lw: 2 });
    if (o.washed) sk.fillPts(G.rect(9, -h / 2 + 13, 32, 7), P.ink);
    else sk.fillPts(G.rect(9, -h / 2 + 13, 32, 7), P.coral, { alpha: 0.85 });
    for (let i = 0; i < 4; i++) sk.line(9, -h / 2 + 30 + i * 9, 41 - (i === 3 ? 12 : 0), -h / 2 + 30 + i * 9, { lw: 1.6, color: P.blue, double: false });
    // name tag
    if (!o.washed) {
      sk.line(-w / 2 + 14, -h / 2 + 2, -w / 2 + 6, -h / 2 - 16, { lw: 2, double: false });
      c.save(); c.translate(-w / 2 + 2, -h / 2 - 26); c.rotate(-0.12);
      sk.shape(G.rect(-6, -14, 70, 26, 5), { fill: '#fff', lw: 2.4 });
      sk.text('J. Doe', 29, 6, { font: '700 22px Caveat', align: 'center', color: P.coral });
      c.restore();
    }
    if (o.checked) {
      sk.shape(G.circle(w / 2 - 4, h / 2 - 4, 14), { fill: P.green, lw: 2.4 });
      sk.path([[w / 2 - 11, h / 2 - 4], [w / 2 - 5, h / 2 + 2], [w / 2 + 4, h / 2 - 10]], { lw: 3.2, color: '#fff', double: false });
    }
    c.restore();
  }

  function hexLabel(sk, n, text, cx, y) {
    const c = sk.ctx;
    c.font = '700 34px Caveat';
    const tw = c.measureText(text).width;
    const hx = cx - tw / 2 - 8;
    sk.shape(G.hex(hx - 14, y - 11, 16), { fill: sk.pal.gold, lw: 2.6 });
    sk.text(String(n), hx - 14, y - 3, { font: '800 20px Bricolage', align: 'center' });
    sk.text(text, hx + 8, y, { font: '700 34px Caveat', jitter: true });
  }

  function scene(sk, t) {
    const P = sk.pal, c = sk.ctx;
    const cyc = t * 3, k = Math.floor(cyc), p = cyc - k; // robot works 3 studies per loop
    const isBad = (idx) => mod(idx, 3) === 0;

    // ---------- headline arrow ----------
    sk.text('raw clinical data', 252, 156, { font: '700 34px Caveat', jitter: true, color: P.tealDark });
    sk.path(G.bezier([478, 146], [550, 122], [630, 122], [694, 142], 20), { lw: 3, dash: [12, 9], dashOffset: -t * 21 * 6 });
    sk.arrowHead(694, 142, 0.3, 16, { lw: 3 });
    sk.text('clean training pairs', 962, 156, { font: '700 34px Caveat', align: 'right', jitter: true, color: P.tealDark });

    // ---------- archive shelves ----------
    hexLabel(sk, 1, 'select cohort', 128, 112);
    {
      const S = SHELF;
      sk.shape(G.rect(S.x, S.y + 10, S.w, S.h - 10, 6), { fill: P.wood, lw: 3.2, hatch: { region: G.rect(S.x + S.w - 34, S.y, 40, S.h + 10), gap: 6, alpha: 0.35 } });
      sk.shape(G.rect(S.x + 34, S.y + 22, S.w - 68, 30, 4), { fill: '#fff', lw: 2.4 });
      sk.text('PACS', S.x + S.w / 2, S.y + 46, { font: '800 22px JetBrains', align: 'center', color: P.navy });
      const cols = [P.tealLight, '#C9D8EE', P.cream, '#F2C9B7', '#DDEBC9'];
      const rows = [S.y + 150, S.y + 250, S.y + 346];
      const grabbing = SLOTS[mod(k + 1, 3)];
      for (let r = 0; r < rows.length; r++) {
        const yb = rows[r];
        for (let i = 0; i < 9; i++) {
          const fx = S.x + 18 + i * 17, fh = 62 + ((i * 7 + r * 3) % 4) * 4;
          const emptySlot = Math.abs(fx + 7 - grabbing[0]) < 9 && Math.abs(yb - 36 - grabbing[1]) < 40 && p > 0.42;
          if (emptySlot) continue;
          const sel = Math.abs(fx + 7 - grabbing[0]) < 9 && Math.abs(yb - 36 - grabbing[1]) < 40;
          if (sel && p > 0.05) sk.glow(fx + 7, yb - fh / 2, 40, P.gold, pulse(p, 0.05, 0.42, 0.05));
          sk.shape(G.rect(fx, yb - fh, 14, fh, 2), { fill: sel && p > 0.05 ? P.gold : cols[(i + r * 2) % cols.length], lw: 2 });
        }
        sk.shape(G.rect(S.x + 8, yb, S.w - 16, 10, 2), { fill: '#B98E52', lw: 2.4 });
      }
      // cohort query note
      c.save(); c.translate(S.x + 120, S.y + 380 + 30); c.rotate(0.05);
      c.restore();
    }

    // ---------- conveyor ----------
    for (let x = 250; x < BELT_X1; x += 150) if (Math.abs(x - QC_X) > 90) sk.line(x, BELT_Y + 40, x - 8, 668, { lw: 3.2 });
    // the robot stands behind the belt
    const items = [];
    for (let j = 0; j < 3; j++) {
      const age = p / 3 + j / 3, idx = k - j;
      items.push({ age, idx, x: PLACE_X + V * age, bad: isBad(idx) });
    }
    // robot pose: reach to the shelf, grab, carry to the belt start
    const slot = SLOTS[mod(k + 1, 3)];
    const placeHand = [PLACE_X, BELT_Y - CARD_H - 4];
    const restHand = [PLACE_X + 6, BELT_Y - CARD_H - 34];
    let hand;
    if (p < 0.1) hand = [lerp(placeHand[0], restHand[0], seg(p, 0, 0.1)), lerp(placeHand[1], restHand[1], seg(p, 0, 0.1))];
    else if (p < 0.4) { const q = ease.inOut(seg(p, 0.1, 0.4)); hand = [lerp(restHand[0], slot[0], q), lerp(restHand[1], slot[1] - 30, q)]; }
    else if (p < 0.5) hand = [slot[0] + 2 * seg(p, 0.4, 0.5), slot[1] - 30];
    else if (p < 0.88) { const q = ease.inOut(seg(p, 0.5, 0.88)); hand = [lerp(slot[0], placeHand[0], q), lerp(slot[1] - 30, placeHand[1] - 26, q) - Math.sin(q * Math.PI) * 50]; }
    else hand = [placeHand[0], lerp(placeHand[1] - 26, placeHand[1], ease.out(seg(p, 0.88, 1)))];
    const carrying = p >= 0.44;
    const nextIdx = k + 1;
    const toL = ([x, y]) => [(x - RBX) / RS, (y - RBY) / RS];
    const ropts = {
      look: p > 0.1 && p < 0.5 ? [-1, 0.2] : [-0.4, 1],
      blink: pulse(t, 0.55, 0.58, 0.012),
      happy: p < 0.08,
      bob: Math.sin(t * TAU * 6) * 2,
      sway: Math.sin(t * TAU * 3) * 0.12,
      antenna: pulse(p, 0.4, 0.55, 0.03),
      reach: 1.25,
      handL: toL(hand), handR: [84, -60],
      tilt: p > 0.1 && p < 0.5 ? -0.06 : 0,
    };
    c.save(); c.translate(RBX, RBY); c.scale(RS, RS); robot(sk, Object.assign({}, ropts, { noArms: true })); c.restore();

    sk.shape(G.rect(BELT_X0, BELT_Y, BELT_X1 - BELT_X0, 30, 14), { fill: '#59657A', lw: 3.2 });
    const boff = (V * t) % 35;
    for (let x = BELT_X0 + boff; x < BELT_X1 - 6; x += 35) sk.line(x, BELT_Y + 6, x - 6, BELT_Y + 24, { lw: 2, color: '#9AA4B5', double: false });
    for (let x = BELT_X0 + 30; x < BELT_X1 - 10; x += 78) {
      sk.shape(G.circle(x, BELT_Y + 44, 13), { fill: P.grey, lw: 2.8 });
      const ang = (V * t) / 13;
      sk.line(x, BELT_Y + 44, x + Math.cos(ang) * 10, BELT_Y + 44 + Math.sin(ang) * 10, { lw: 2.2, double: false });
    }

    // ---------- reject bin (behind the falling card's front) ----------
    const binX = QC_X - 70, binY = 596;
    sk.shape(G.rect(binX, binY - 6, 140, 14, 4), { fill: '#8C96A6', lw: 2.6 });

    // ---------- studies on the belt ----------
    const QC_AGE = (QC_X - PLACE_X) / V;
    for (const it of items) {
      const washed = it.x > (WASH[0] + WASH[1]) / 2;
      if (it.bad && it.age > QC_AGE) {
        // knocked off the front of the belt into the reject bin
        const f = seg(it.age, QC_AGE, QC_AGE + 0.12);
        const x = QC_X + 18 * ease.out(f), y = BELT_Y - CARD_H / 2 + ease.in(f) * 110;
        if (it.age < QC_AGE + 0.3) card(sk, x, y, { washed, blurry: true, rot: f * 0.9, alpha: 1 - seg(it.age, QC_AGE + 0.18, QC_AGE + 0.3) });
        continue;
      }
      if (it.x > BOX_X + 10) continue;
      card(sk, it.x, BELT_Y - CARD_H / 2, { washed, blurry: it.bad, checked: !it.bad && it.x > QC_X + 6 });
    }
    // the card in the robot's hand
    if (carrying) card(sk, hand[0], hand[1] + CARD_H / 2 + 4, { blurry: isBad(nextIdx), rot: p < 0.88 ? -0.08 : 0 });
    c.save(); c.translate(RBX, RBY); c.scale(RS, RS); robot(sk, Object.assign({}, ropts, { armsOnly: true })); c.restore();

    // reject bin front
    sk.shape(G.rect(binX, binY, 140, 70, 8), { fill: '#B7C0CC', lw: 3, hatch: { region: G.rect(binX + 110, binY - 4, 40, 80), gap: 6, alpha: 0.35 } });
    sk.path([[binX + 12, binY + 24], [binX + 30, binY + 44]], { lw: 4, color: P.red });
    sk.path([[binX + 30, binY + 24], [binX + 12, binY + 44]], { lw: 4, color: P.red });
    sk.text('rejected', binX + 82, binY + 43, { font: '700 26px Caveat', align: 'center' });

    // ---------- de-identification washer ----------
    hexLabel(sk, 2, 'de-identify', (WASH[0] + WASH[1]) / 2, 262);
    {
      const [x0, x1] = WASH, top = 330, cx = (x0 + x1) / 2;
      const inside = items.filter((it) => it.x > x0 - 20 && it.x < x1 + 20);
      // bubbles rising from the top
      for (let i = 0; i < 7; i++) {
        const ph = mod(t * 2 + i / 7, 1);
        const bx = cx - 50 + ((i * 37) % 100) + Math.sin((ph + i) * TAU) * 6, by = top - 6 - ph * 40;
        c.save(); c.globalAlpha = 1 - ph;
        sk.shape(G.circle(bx, by, 5 + (i % 3) * 2.5), { fill: 'rgba(255,255,255,0.8)', lw: 1.8, color: P.blue, double: false });
        c.restore();
      }
      sk.shape(G.rect(x0, top, x1 - x0, BELT_Y + 22 - top, 12), { fill: '#D7E6F2', lw: 3.4, hatch: { region: G.rect(x1 - 34, top - 4, 40, 260), gap: 6, alpha: 0.35 } });
      sk.shape(G.rect(x0 + 10, top + 10, x1 - x0 - 20, 30, 6), { fill: '#fff', lw: 2.4 });
      for (let i = 0; i < 3; i++) sk.shape(G.circle(x0 + 30 + i * 26, top + 25, 7), { fill: [P.gold, P.coral, P.teal][i], lw: 2 });
      sk.shape(G.circle(x1 - 30, top + 25, 6), { fill: inside.length ? P.green : '#2E6B3A', lw: 2 });
      // porthole with swirling suds
      const py = top + 106, pr = 50;
      sk.shape(G.circle(cx, py, pr + 10), { fill: P.grey, lw: 3.2 });
      c.save();
      c.beginPath(); c.arc(cx, py, pr, 0, TAU); c.clip();
      c.fillStyle = '#5FA8D8'; c.fillRect(cx - pr, py - pr, pr * 2, pr * 2);
      const sp = t * TAU * 2;
      for (let i = 0; i < 6; i++) {
        const a = sp + (i / 6) * TAU;
        sk.fillPts(G.circle(cx + Math.cos(a) * 26, py + Math.sin(a) * 26, 11), '#fff', { alpha: 0.75 });
      }
      // the scrubbed name tag tumbling while a study is inside
      const washing = items.find((it) => it.x > x0 + 20 && it.x < x1 - 20);
      if (washing) {
        const f = (washing.x - x0 - 20) / (x1 - x0 - 40);
        c.save(); c.translate(cx, py); c.rotate(sp * 1.5); c.globalAlpha = 1 - f;
        sk.shape(G.rect(-34, -12, 68, 24, 5), { fill: '#fff', lw: 2.2 });
        sk.text('J. Doe', 0, 7, { font: '700 21px Caveat', align: 'center', color: P.coral });
        c.restore();
      }
      c.restore();
      sk.shape(G.circle(cx, py, pr), { stroke: true, lw: 3 });
      sk.path(G.arc(cx, py, pr - 12, pr - 12, Math.PI * 1.15, Math.PI * 1.45, 8), { lw: 3, color: '#fff', double: false });
      // rubber curtains at the openings
      for (const ex of [x0, x1]) for (let i = 0; i < 3; i++) sk.line(ex + (ex === x0 ? 4 : -4) + (i - 1) * 5, BELT_Y - 84, ex + (ex === x0 ? 4 : -4) + (i - 1) * 5, BELT_Y - 2, { lw: 3.4, color: P.navy, double: false });
    }

    // ---------- quality check gate ----------
    hexLabel(sk, 3, 'quality check', QC_X, 262);
    {
      const under = items.filter((it) => Math.abs(it.x - QC_X) < 34);
      const bad = under.some((it) => it.bad), good = under.some((it) => !it.bad);
      sk.shape(G.rect(QC_X - 52, 380, 12, BELT_Y - 376, 4), { fill: P.grey, lw: 2.8 });
      sk.shape(G.rect(QC_X + 40, 380, 12, BELT_Y - 376, 4), { fill: P.grey, lw: 2.8 });
      sk.shape(G.rect(QC_X - 62, 360, 124, 30, 8), { fill: P.navy, lw: 3 });
      // the inspecting eye
      const ex = QC_X, ey = 330;
      sk.shape(G.circle(ex, ey, 30), { fill: '#fff', lw: 3 });
      const look = under.length ? 0 : Math.sin(t * TAU * 3) * 8;
      sk.shape(G.circle(ex + look, ey + 6, 12), { fill: P.blue, lw: 2.4 });
      sk.fillPts(G.circle(ex + look, ey + 6, 5), P.ink);
      sk.line(ex, ey + 30, ex, 360, { lw: 3 });
      const lightCol = bad ? P.red : good ? P.green : P.gold;
      if (under.length) sk.glow(QC_X, 375, 44, lightCol, 0.7);
      sk.shape(G.circle(QC_X, 375, 8), { fill: lightCol, lw: 2 });
      if (bad) {
        sk.text('blurry!', QC_X, 428, { font: '700 32px Caveat', color: P.red, align: 'center', jitter: true });
      }
    }

    // ---------- packing box ----------
    hexLabel(sk, 4, 'pack pairs', 908, 262);
    {
      const bx = 848, by = 440, bw = 126, bh = 170;
      // flaps and a few packed pairs peeking out
      sk.shape([[bx, by], [bx - 20, by - 34], [bx + 40, by - 30], [bx + 50, by]], { fill: '#C99F63', lw: 2.8 });
      sk.shape([[bx + bw, by], [bx + bw + 6, by - 40], [bx + bw - 50, by - 34], [bx + bw - 56, by]], { fill: '#C99F63', lw: 2.8 });
      for (let i = 0; i < 3; i++) {
        c.save(); c.translate(bx + 36 + i * 28, by - 6 - (i % 2) * 6); c.rotate(-0.15 + i * 0.12);
        sk.shape(G.rect(-16, -22, 32, 40, 3), { fill: i % 2 ? '#fff' : '#2C3B46', lw: 2.2 });
        c.restore();
      }
      sk.shape(G.rect(bx, by, bw, bh, 6), { fill: P.wood, lw: 3.4, hatch: { region: G.rect(bx + bw - 36, by - 4, 40, bh + 8), gap: 6, alpha: 0.35 } });
      sk.shape(G.rect(bx + 14, by + 36, bw - 28, 74, 4), { fill: '#fff', lw: 2.4 });
      sk.text('VLM', bx + bw / 2, by + 70, { font: '800 30px Bricolage', align: 'center', color: P.navy });
      sk.text('training set', bx + bw / 2, by + 99, { font: '700 21px Caveat', align: 'center' });
      const landed = items.some((it) => !it.bad && it.x > BOX_X - 30 && it.x < BOX_X + 20);
      if (landed) sk.glow(bx + bw / 2, by - 10, 60, P.gold, 0.6);
    }
  }

  window.SCENES.lab08 = scene;
})();
