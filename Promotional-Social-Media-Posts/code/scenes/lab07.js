// Lab 07: fine-tuning a vision-language model.
// A new chest X-ray slides onto the model's screen and its caption is vague. The robot sets
// the learning rate and LoRA rank, turns up the epochs and hits "train": the loss curve drops
// and the caption sharpens to "right lower lobe pneumonia". Then the next X-ray slides in.
(function () {
  const { G, seg, ease, lerp, pulse, TAU } = SK;
  const { robot } = ROBOT;

  const RBX = 322, RBY = 500, RS = 0.85;
  const SL_LR = 152, SL_LORA = 288, KNOB = 400, BTN = 490;
  const TRACK_TOP = 434, TRACK_BOT = 486;
  const MON = { x: 640, y: 64, w: 312, h: 296 };
  const FILM = { x: 666, y: 90, w: 136, h: 244 };

  // ---------- story values ----------
  const lrVal = (t) => lerp(0.78, 0.32, ease.inOut(seg(t, 0.12, 0.22))) + (0.78 - 0.32) * ease.inOut(seg(t, 0.93, 0.99));
  const loraVal = (t) => lerp(0.25, 0.72, ease.inOut(seg(t, 0.29, 0.37))) - (0.72 - 0.25) * ease.inOut(seg(t, 0.93, 0.99));
  const knobAng = (t) => lerp(-0.9, 0.9, ease.inOut(seg(t, 0.38, 0.44))) - 1.8 * ease.inOut(seg(t, 0.93, 0.99));
  const training = (t) => seg(t, 0.5, 0.8);
  const stageOf = (t) => (t < 0.6 ? 0 : t < 0.76 ? 1 : 2);

  const CAPTIONS = [
    { l1: 'a picture of…', l2: 'a chest?', color: '#8A837A' },
    { l1: 'chest X-ray,', l2: 'something hazy?', color: '#5C564F' },
    { l1: 'right lower lobe', l2: 'pneumonia', color: '#0F6667' },
  ];

  function desk(sk, t) {
    const P = sk.pal;
    // top surface
    sk.shape([[44, 420], [604, 420], [628, 500], [18, 500]], { fill: '#D8D1C4', lw: 3.2, hatch: { region: G.rect(540, 410, 100, 100), gap: 6, alpha: 0.3 } });
    // front panel
    sk.shape(G.rect(18, 500, 610, 150, 8), { fill: P.navy, lw: 3.4, hatch: { region: G.rect(540, 494, 100, 170), gap: 6, alpha: 0.35, color: '#000' } });
    // LED strip
    for (let i = 0; i < 10; i++) {
      const on = training(t) > 0 && training(t) < 1 ? (Math.floor(t * 48) + i) % 4 < 2 : i < 2;
      sk.fillPts(G.circle(58 + i * 16, 604, 4.5, 10), on ? (i < 7 ? P.green : P.gold) : '#3d4a63');
    }
    for (let i = 0; i < 4; i++) sk.line(380 + i * 18, 590, 380 + i * 18, 630, { lw: 2.4, color: '#4d5a74', double: false });

    // sliders
    const slider = (x, v, label) => {
      sk.shape(G.rect(x - 6, TRACK_TOP, 12, TRACK_BOT - TRACK_TOP, 6), { fill: P.ink, lw: 2 });
      for (let i = 0; i <= 4; i++) sk.line(x + 12, TRACK_TOP + 4 + i * 11, x + 20, TRACK_TOP + 4 + i * 11, { lw: 1.6, double: false });
      const y = TRACK_BOT - 4 - v * (TRACK_BOT - TRACK_TOP - 8);
      sk.shape(G.rect(x - 17, y - 7, 34, 14, 4), { fill: P.gold, lw: 2.6 });
      sk.text(label, x, 548, { font: '700 27px Caveat', align: 'center', color: P.cream, jitter: true });
      return y;
    };
    const yLr = slider(SL_LR, lrVal(t), 'learning rate');
    const yLora = slider(SL_LORA, loraVal(t), 'LoRA rank');

    // epochs knob
    const ka = knobAng(t);
    sk.shape(G.circle(KNOB, 460, 22), { fill: P.coral, lw: 3, hatch: { region: G.rect(KNOB + 6, 430, 30, 60), gap: 5, alpha: 0.3 } });
    sk.line(KNOB, 460, KNOB + Math.sin(ka) * 17, 460 - Math.cos(ka) * 17, { lw: 3.6 });
    for (let i = 0; i < 5; i++) { const a = -1.1 + i * 0.55; sk.line(KNOB + Math.sin(a) * 27, 460 - Math.cos(a) * 27, KNOB + Math.sin(a) * 32, 460 - Math.cos(a) * 32, { lw: 1.8, double: false }); }
    sk.text('epochs', KNOB, 548, { font: '700 28px Caveat', align: 'center', color: P.cream, jitter: true });

    // train button
    const on = training(t) > 0 && t < 0.84;
    const press = pulse(t, 0.47, 0.53, 0.015);
    if (on) sk.glow(BTN, 458, 50, P.green, 0.7);
    sk.shape(G.ellipse(BTN, 466, 30, 12), { fill: '#3a4660', lw: 2.6 });
    sk.shape(G.ellipse(BTN, 458 + press * 5, 24, 11), { fill: on ? '#7BE29A' : P.green, lw: 2.8 });
    sk.text('train!', BTN, 548, { font: '700 30px Caveat', align: 'center', color: P.gold, jitter: true });
    return { yLr, yLora };
  }

  function lossScreen(sk, t) {
    const P = sk.pal, c = sk.ctx;
    const x = 34, y = 44, w = 262, h = 186;
    sk.text('training loss', x + w / 2, y - 12, { font: '700 32px Caveat', align: 'center', jitter: true });
    sk.shape(G.rect(x, y, w, h, 12), { fill: P.grey, lw: 3.2, hatch: { region: G.rect(x + w - 30, y - 6, 40, h + 12), gap: 6, alpha: 0.3 } });
    sk.shape(G.rect(x + 12, y + 12, w - 24, h - 24, 6), { fill: P.screen, lw: 2.4 });
    const ox = x + 34, oy = y + h - 34, gw = w - 64, gh = h - 74;
    sk.line(ox, oy - gh, ox, oy, { lw: 2.2, color: '#7f9aa0', double: false });
    sk.line(ox, oy, ox + gw, oy, { lw: 2.2, color: '#7f9aa0', double: false });
    const p = training(t), wipe = seg(t, 0.93, 0.99);
    const f = (u) => 0.08 + 0.86 * Math.exp(-3.6 * u) + 0.035 * Math.sin(u * 31) * (1 - u) + 0.02 * Math.sin(u * 67);
    if (p > 0 && wipe < 1) {
      c.save();
      c.beginPath(); c.rect(ox + gw * wipe, oy - gh - 6, gw, gh + 12); c.clip();
      const pts = [];
      for (let i = 0; i <= 40 * p; i++) { const u = i / 40; pts.push([ox + u * gw, oy - f(u) * gh]); }
      if (pts.length > 1) sk.path(pts, { lw: 3, color: '#7CF0B4', double: false, overshoot: false });
      const u = p, hx = ox + u * gw, hy = oy - f(u) * gh;
      if (p < 1) sk.fillPts(G.circle(hx, hy, 5, 10), '#CFFCF3');
      c.restore();
    }
    const ep = p <= 0 ? 0 : Math.min(3, 1 + Math.floor(p * 3));
    if (ep > 0 && wipe < 0.5) sk.text(`epoch ${ep}/3`, x + w - 22, y + 36, { font: '700 17px JetBrains', align: 'right', color: '#CFFCF3' });
    if (t > 0.8 && t < 0.93) sk.path([[x + w - 64, y + 56], [x + w - 56, y + 64], [x + w - 42, y + 48]], { lw: 3.4, color: '#7CF0B4', double: false });
  }

  function model(sk, t) {
    const P = sk.pal, c = sk.ctx;
    const { x, y, w, h } = MON;
    sk.text('vision-language model', x + w / 2, y - 18, { font: '700 32px Caveat', align: 'center', jitter: true });
    // stand
    sk.shape(G.rect(x + w / 2 - 12, y + h - 4, 24, 40, 4), { fill: P.grey, lw: 2.8 });
    sk.shape(G.rect(x + w / 2 - 56, y + h + 32, 112, 14, 5), { fill: P.grey, lw: 2.8 });
    sk.shape(G.rect(x, y, w, h, 14), { fill: P.grey, lw: 3.4, hatch: { region: G.rect(x + w - 26, y - 6, 40, h + 12), gap: 6, alpha: 0.3 } });
    sk.shape(G.rect(x + 14, y + 14, w - 28, h - 28, 6), { fill: P.screen, lw: 2.4 });

    // the X-ray slides in from the right and out to the left, clipped to the screen
    const slideIn = 1 - ease.out(seg(t, 0, 0.07)), slideOut = ease.in(seg(t, 0.93, 0.99));
    const dx = slideIn * 300 - slideOut * 200;
    c.save();
    c.beginPath(); c.rect(x + 16, y + 16, w - 32, h - 32); c.clip();
    c.translate(dx, 0);
    const F = FILM;
    sk.shape(G.rect(F.x, F.y, F.w, F.h, 4), { fill: '#10181E', lw: 2.2 });
    XRAY.draw(sk, F.x, F.y, F.w, F.h, { nodule: false });
    const mx = F.x + F.w / 2;
    // the pneumonia: a hazy patch low in the image's left lung (patient's right lower lobe)
    c.save(); c.filter = 'blur(4px)';
    sk.fillPts(G.ellipse(mx - 31, F.y + 154, 17, 14, 18), '#C9D6DC', { alpha: 0.42 });
    sk.fillPts(G.ellipse(mx - 38, F.y + 160, 10, 9, 14), '#DCE6EA', { alpha: 0.4 });
    sk.fillPts(G.ellipse(mx - 25, F.y + 162, 9, 7, 14), '#DCE6EA', { alpha: 0.35 });
    c.restore();
    // scan line while training
    const tr = training(t);
    if (tr > 0 && tr < 1) {
      const sy = F.y + F.h * ((t * 14) % 1);
      c.save(); c.globalAlpha = 0.55; sk.line(F.x + 4, sy, F.x + F.w - 4, sy, { lw: 3, color: '#7CF0B4', double: false }); c.restore();
    }
    // the finding, once the caption gets it right
    const ring = seg(t, 0.76, 0.82);
    if (ring > 0) sk.path(G.arc(mx - 32, F.y + 156, 30, 28, -Math.PI / 2, -Math.PI / 2 + TAU * 1.06 * ease.out(ring), 28), { lw: 3.8, color: P.gold, double: false });
    c.restore();

    // the model: an eye that looks at the image, and lines of text it writes
    const ex = x + w - 66, ey = y + 70;
    const top = G.bezier([ex - 30, ey], [ex - 12, ey - 22], [ex + 12, ey - 22], [ex + 30, ey], 12);
    const bot = G.bezier([ex + 30, ey], [ex + 12, ey + 22], [ex - 12, ey + 22], [ex - 30, ey], 12);
    sk.shape(top.concat(bot.slice(1, -1)), { fill: '#fff', lw: 2.8 });
    const look = tr > 0 && tr < 1 ? Math.sin(t * TAU * 6) * 4 : 0;
    sk.shape(G.circle(ex - 10, ey + look, 10), { fill: P.blue, lw: 2.4 });
    sk.fillPts(G.circle(ex - 11, ey + look, 4.5, 10), P.ink);
    const st = stageOf(t), lineCol = st === 2 ? '#7CF0B4' : '#A6DCD7';
    const capVis = seg(t, 0.07, 0.11) * (1 - seg(t, 0.92, 0.96));
    for (let i = 0; i < 5; i++) {
      const lw = [70, 54, 64, 40, 58][i] * (st === 0 ? 0.6 : st === 1 ? 0.8 : 1);
      const ly = y + 124 + i * 28;
      c.save(); c.globalAlpha *= capVis * (st === 0 && i > 2 ? 0.3 : 1);
      sk.line(ex - 34, ly, ex - 34 + lw, ly, { lw: 5, color: lineCol, double: false, amp: st === 0 ? 2.4 : 1 });
      c.restore();
    }
  }

  function caption(sk, t) {
    const P = sk.pal, c = sk.ctx;
    const bx = 642, by = 432, bw = 322, bh = 132;
    sk.shape([[MON.x + MON.w / 2 - 20, by + 4], [MON.x + MON.w / 2 + 16, 394], [MON.x + MON.w / 2 + 22, by + 4]], { fill: '#fff', lw: 3 });
    sk.shape(G.rect(bx, by, bw, bh, 22), { fill: '#fff', lw: 3.2 });
    sk.fillPts(G.rect(MON.x + MON.w / 2 - 22, by - 2, 48, 12), '#fff');
    const vis = seg(t, 0.07, 0.11) * (1 - seg(t, 0.92, 0.96));
    if (vis <= 0) {
      sk.text('…', bx + bw / 2, by + 78, { font: '700 44px Caveat', align: 'center', color: '#A8A196' });
      return;
    }
    const st = stageOf(t), cap = CAPTIONS[st];
    const since = st === 0 ? seg(t, 0.07, 0.11) : st === 1 ? seg(t, 0.6, 0.64) : seg(t, 0.76, 0.8);
    const pop = ease.back(since);
    c.save();
    c.globalAlpha *= vis;
    c.translate(bx + bw / 2, by + bh / 2); c.scale(lerp(0.85, 1, pop), lerp(0.85, 1, pop)); c.translate(-(bx + bw / 2), -(by + bh / 2));
    const wob = st === 0 ? { rot: Math.sin(t * TAU * 8) * 0.02 } : {};
    sk.text(cap.l1, bx + bw / 2, by + 56, Object.assign({ font: `700 ${st === 2 ? 40 : 36}px Caveat`, align: 'center', color: cap.color, jitter: true }, wob));
    sk.text(cap.l2, bx + bw / 2 - (st === 2 ? 22 : 0), by + 104, Object.assign({ font: `700 ${st === 2 ? 40 : 36}px Caveat`, align: 'center', color: cap.color, jitter: true }, wob));
    if (st === 2) {
      const ck = bx + bw / 2 + 74;
      sk.path([[ck, by + 92], [ck + 10, by + 104], [ck + 30, by + 76]], { lw: 5, color: P.green });
    }
    c.restore();
  }

  function scene(sk, t) {
    const P = sk.pal, c = sk.ctx;
    lossScreen(sk, t);
    model(sk, t);
    caption(sk, t);

    // ---------- robot behind the desk ----------
    const toL = ([x, y]) => [(x - RBX) / RS, (y - RBY) / RS];
    // hands: left works the two sliders, right turns the knob and presses train
    const lrY = TRACK_BOT - 4 - lrVal(t) * (TRACK_BOT - TRACK_TOP - 8);
    const loraY = TRACK_BOT - 4 - loraVal(t) * (TRACK_BOT - TRACK_TOP - 8);
    const toLora = ease.inOut(seg(t, 0.24, 0.29)) * (1 - ease.inOut(seg(t, 0.86, 0.92)));
    const backToLora = ease.inOut(seg(t, 0.93, 0.96)) * (1 - ease.inOut(seg(t, 0.99, 1)));
    const lHandW = toLora > 0 && t < 0.93
      ? [lerp(SL_LR, SL_LORA, toLora), lerp(lrY, loraY, toLora) - 4]
      : [SL_LR, lrY - 4];
    let lH = lHandW;
    if (t >= 0.93) {
      // reset: pull the LoRA slider back first, then the learning rate (reads as "set up the next run")
      lH = [SL_LR, lrY - 4];
    }
    const knobTurn = ease.inOut(seg(t, 0.35, 0.38)) * (1 - ease.inOut(seg(t, 0.44, 0.46)));
    const toBtn = ease.inOut(seg(t, 0.45, 0.47)) * (1 - ease.inOut(seg(t, 0.55, 0.6)));
    const press = pulse(t, 0.47, 0.53, 0.015);
    const ka = knobAng(t);
    const knobHand = [KNOB + Math.sin(ka) * 10, 446 - Math.cos(ka) * 4];
    const restR = [420, 438];
    let rH = [lerp(restR[0], knobHand[0], knobTurn), lerp(restR[1], knobHand[1], knobTurn)];
    if (toBtn > 0) rH = [lerp(rH[0], BTN, toBtn), lerp(rH[1], 444 + press * 8, toBtn)];
    const knobBack = ease.inOut(seg(t, 0.94, 0.96)) * (1 - ease.inOut(seg(t, 0.985, 1)));
    if (knobBack > 0) rH = [lerp(rH[0], knobHand[0], knobBack), lerp(rH[1], knobHand[1], knobBack)];

    const happy = t > 0.8 && t < 0.92;
    let look = [1, -0.2];
    if (t > 0.1 && t < 0.4) look = [-0.4, 1];
    else if (t > 0.45 && t < 0.52) look = [0.8, 1];
    else if (t > 0.6 && t < 0.68) look = [-1, -1];
    const ropts = {
      look, happy,
      blink: Math.max(pulse(t, 0.25, 0.28, 0.012), pulse(t, 0.7, 0.73, 0.012)),
      bob: Math.sin(t * TAU * 4) * 2,
      sway: Math.sin(t * TAU * 2) * 0.1,
      antenna: happy ? 0.6 + 0.4 * Math.sin(t * TAU * 8) : training(t) > 0 && training(t) < 1 ? 0.35 + 0.35 * Math.sin(t * TAU * 12) : 0,
      reach: 1.5,
      handL: toL(lH), handR: toL(rH),
      tilt: happy ? 0.06 : 0,
    };
    c.save(); c.translate(RBX, RBY); c.scale(RS, RS); robot(sk, Object.assign({}, ropts, { noArms: true })); c.restore();
    desk(sk, t);
    c.save(); c.translate(RBX, RBY); c.scale(RS, RS); robot(sk, Object.assign({}, ropts, { armsOnly: true })); c.restore();

    // ---------- "much better!" ----------
    const sb = ease.back(seg(t, 0.8, 0.84)) * (1 - ease.in(seg(t, 0.9, 0.93)));
    if (sb > 0.01) {
      c.save(); c.translate(498, 206); c.scale(sb, sb);
      sk.shape([[-58, 26], [-90, 66], [-30, 26]], { fill: '#fff', lw: 3 });
      sk.shape(G.rect(-96, -36, 192, 68, 22), { fill: '#fff', lw: 3 });
      sk.fillPts(G.rect(-62, 18, 36, 14), '#fff');
      sk.text('much better!', 0, 10, { font: '700 32px Caveat', align: 'center', jitter: true });
      c.restore();
    }
  }

  window.SCENES.lab07 = scene;
})();
