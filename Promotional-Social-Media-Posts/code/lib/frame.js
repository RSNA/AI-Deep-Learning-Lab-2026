// Series layout shared by every lab poster: paper, logos, lab badge, title, taped sketch
// sheet holding the animated scene, and the date/time footer.
(function () {
  const { G } = SK;
  const W = 1080, H = 1350, M = 56;
  const SHEET = { x: 48, y: 478, w: 984, h: 672, rot: -0.004 };

  const PAL = {
    ink: '#26221E', paper: '#F3ECDD', sheet: '#FCF8EF',
    teal: '#3AA6A2', tealDark: '#0F6667', tealLight: '#A6DCD7',
    gold: '#EDB95E', coral: '#E9714B', navy: '#26364F', blue: '#2F6DB3',
    screen: '#173B40', eye: '#CFFCF3', cream: '#F8EBCD', grey: '#C3BCAF',
    wood: '#E1BE86', red: '#D6493B', green: '#4FA463', rsnaTeal: '#026666',
  };

  function wrapWords(ctx, words, maxW) {
    const lines = [];
    let cur = [];
    for (const w of words) {
      const test = cur.concat([w]).map((x) => x.t).join(' ');
      if (cur.length && ctx.measureText(test).width > maxW) { lines.push(cur); cur = [w]; } else cur.push(w);
    }
    if (cur.length) lines.push(cur);
    return lines;
  }

  function drawTitle(sk, lab, top, bottom) {
    const c = sk.ctx;
    const maxW = W - 2 * M;
    const hl = new Set((lab.highlight || '').split(' ').filter(Boolean));
    const words = lab.title.split(' ').map((t) => ({ t, hl: hl.has(t) }));
    const subSize = 30, subH = lab.subtitle ? subSize * 1.5 : 0;
    let size = lab.maxTitle || 92, lines;
    for (; size >= 40; size -= 2) {
      c.font = `800 ${size}px Bricolage`;
      lines = wrapWords(c, words, maxW);
      if (lines.length <= 3 && lines.length * size * 1.04 + subH <= bottom - top) break;
    }
    c.font = `800 ${size}px Bricolage`;
    const blockH = lines.length * size * 1.04 + subH;
    let y = top + Math.max(0, (bottom - top - blockH) / 2) + size * 0.86;
    for (const line of lines) {
      // highlighter swash behind highlighted runs
      let x = M;
      const spaceW = c.measureText(' ').width;
      let run = null;
      const flush = () => { if (run) { sk.line(run[0] - 6, y - size * 0.24, run[1] + 6, y - size * 0.2, { lw: size * 0.36, color: PAL.gold, alpha: 0.9, double: false, amp: 2.2, salt: 'hl' }); run = null; } };
      for (const w of line) {
        const ww = c.measureText(w.t).width;
        if (w.hl) run = run ? [run[0], x + ww] : [x, x + ww]; else flush();
        x += ww + spaceW;
      }
      flush();
      sk.text(line.map((w) => w.t).join(' '), M, y, { font: `800 ${size}px Bricolage`, color: PAL.ink, letterSpacing: '-0.5px' });
      y += size * 1.04;
    }
    if (lab.subtitle) sk.text(lab.subtitle, M, y - size * 1.04 + subSize * 1.45, { font: `500 ${subSize}px Bricolage`, color: PAL.ink, alpha: 0.78 });
  }

  function drawHeader(sk, A, lab) {
    const c = sk.ctx;
    // official RSNA 2026 lockup, trimmed to its visible pixels at load time and fitted by height
    const L = A.lockup, lh = 92, lw = Math.min(420, (lh * L.width) / L.height);
    c.drawImage(L, M, 42, lw, (lw * L.height) / L.width);

    // lab badge + kicker, right-aligned
    const bx = W - M - 40, by = 88;
    sk.shape(G.hex(bx, by, 42), { fill: PAL.gold, lw: 3.4 });
    const badge = lab.badge || lab.id;
    sk.text(badge, bx, by + (badge.length > 2 ? 9 : 12), { font: `800 ${badge.length > 2 ? 26 : 34}px Bricolage`, align: 'center' });
    const rx = bx - 62;
    sk.text(lab.kicker || 'DEEP LEARNING LAB', rx, lab.level ? by - 8 : by + 8, { font: '700 21px JetBrains', align: 'right', letterSpacing: '4px' });
    if (!lab.level) return; // welcome poster: no level pill
    const lvl = lab.level.toUpperCase();
    c.font = '700 18px JetBrains';
    const pw = c.measureText(lvl).width + 34;
    const adv = lab.level === 'Advanced';
    sk.shape(G.rect(rx - pw, by + 8, pw, 32, 16), { fill: adv ? PAL.coral : PAL.tealLight, lw: 2.6 });
    sk.text(lvl, rx - pw / 2, by + 30, { font: '700 18px JetBrains', align: 'center', letterSpacing: '2px' });
  }

  function drawSheet(sk, scene, t, f, N, A) {
    const c = sk.ctx, S = SHEET;
    c.save();
    c.translate(S.x + S.w / 2, S.y + S.h / 2);
    c.rotate(S.rot);
    c.translate(-S.w / 2, -S.h / 2);
    // drop shadow + sheet
    c.fillStyle = 'rgba(80,60,30,0.10)';
    c.fillRect(7, 9, S.w, S.h);
    sk.shape(G.rect(0, 0, S.w, S.h), { fill: PAL.sheet, lw: 2.6, amp: 0.8 });
    c.save();
    c.beginPath(); c.rect(2, 2, S.w - 4, S.h - 4); c.clip();
    scene(sk, t, f, N, A, S);
    c.restore();
    // tape
    const tape = (x, y, w, h, r) => {
      c.save(); c.translate(x, y); c.rotate(r);
      sk.shape(G.rect(-w / 2, -h / 2, w, h, 2), { fill: 'rgba(233,215,160,0.78)', lw: 1.6, alpha: 0.5, amp: 1 });
      c.restore();
    };
    tape(36, 18, 120, 36, -0.62);
    tape(S.w - 36, 18, 120, 36, 0.6);
    tape(S.w - 30, S.h - 14, 110, 34, -0.55);
    tape(40, S.h - 12, 110, 34, 0.5);
    c.restore();
  }

  function drawFooter(sk, lab) {
    const c = sk.ctx, y0 = 1196;
    // calendar doodle
    const cx = M, cw = 84, ch = 86;
    sk.shape(G.rect(cx, y0, cw, ch, 10), { fill: '#fff', lw: 3.2 });
    sk.shape(G.rect(cx, y0, cw, 26, 6), { fill: PAL.coral, lw: 3.2 });
    sk.line(cx + 22, y0 - 8, cx + 22, y0 + 10, { lw: 4 });
    sk.line(cx + cw - 22, y0 - 8, cx + cw - 22, y0 + 10, { lw: 4 });
    sk.text(lab.dayNum, cx + cw / 2, y0 + 72, { font: '800 40px Bricolage', align: 'center' });
    sk.text(lab.day, cx + cw + 24, y0 + 38, { font: '800 42px Bricolage' });
    sk.text(lab.time, cx + cw + 24, y0 + 82, { font: '700 32px Bricolage', color: PAL.tealDark });
    // right side note
    sk.text('hands-on!', W - M, y0 + 36, { font: '700 44px Caveat', align: 'right', jitter: true, color: PAL.coral });
    sk.text('bring your laptop', W - M, y0 + 78, { font: '600 34px Caveat', align: 'right', jitter: true });
  }

  function drawPoster(ctx, sk, lab, f, N, A) {
    sk.boil = Math.floor(f / 2) % 3;
    const t = f / N;
    ctx.drawImage(A.paper, 0, 0);
    drawHeader(sk, A, lab);
    drawTitle(sk, lab, 186, 462);
    drawSheet(sk, window.SCENES[lab.scene], t, f, N, A);
    drawFooter(sk, lab);
  }

  window.FRAME = { W, H, PAL, SHEET, drawPoster };
})();
