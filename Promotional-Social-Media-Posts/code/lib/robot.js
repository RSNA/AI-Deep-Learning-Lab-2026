// The series mascot: a small teal robot with a screen face and an RSNA-gold hex badge.
// Drawn around its feet (0, 0) in local coordinates; callers translate/scale the context.
(function () {
  const { G } = SK;

  // two-bone IK: returns elbow position for a shoulder -> hand reach
  function ik(sx, sy, hx, hy, L1, L2, bend) {
    const dx = hx - sx, dy = hy - sy;
    let d = Math.hypot(dx, dy);
    d = Math.min(d, L1 + L2 - 0.5);
    const a = Math.atan2(dy, dx);
    const c = Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)));
    const e = a + bend * Math.acos(c);
    return [sx + Math.cos(e) * L1, sy + Math.sin(e) * L1];
  }

  /*
    o = {
      body, dark            colours (default teal / tealDark)
      look: [x, y]          pupil offset, -1..1
      blink: 0..1           1 = fully closed
      happy: bool           ^ ^ eyes
      antenna: 0..1         glow amount
      tilt: radians         head tilt
      handL, handR: [x, y]  hand targets in local coords (default resting)
      holdL, holdR: fn(sk, x, y)  drawn under the hand (tools)
      headset: bool
      badge: colour of the chest hex
      bob: px               vertical bounce of the upper body
    }
  */
  function robot(sk, o = {}) {
    const P = sk.pal, c = sk.ctx;
    const body = o.body || P.teal, dark = o.dark || P.tealDark;
    const bob = o.bob || 0;
    const shR = [62, -118 + bob], shL = [-62, -118 + bob];
    const handR = o.handR || [78, -46 + bob], handL = o.handL || [-78, -46 + bob];

    // arms (drawn before head so the head overlaps the shoulders)
    const arm = (sh, hand, bend, hold) => {
      const L = 52 * (o.reach || 1);
      const el = ik(sh[0], sh[1], hand[0], hand[1], L, L, bend);
      sk.tube([sh, el], 17, dark, { salt: 'a1' + bend });
      sk.tube([el, hand], 17, dark, { salt: 'a2' + bend });
      sk.shape(G.circle(el[0], el[1], 9), { fill: P.navy, lw: 2.6 });
      if (hold) hold(sk, hand[0], hand[1]);
      sk.shape(G.circle(hand[0], hand[1], 14), { fill: P.cream, lw: 3 });
    };
    const arms = () => {
      arm(shL, handL, 1, o.holdL);
      arm(shR, handR, -1, o.holdR);
      sk.shape(G.circle(shL[0], shL[1], 11), { fill: P.navy, lw: 2.8 });
      sk.shape(G.circle(shR[0], shR[1], 11), { fill: P.navy, lw: 2.8 });
    };
    // armsOnly / noArms let a scene put the arms in front of props (e.g. a conveyor)
    if (o.armsOnly) { arms(); return; }
    // legs + feet
    sk.shape(G.rect(-42, -44, 26, 42, 8), { fill: dark, lw: 3 });
    sk.shape(G.rect(16, -44, 26, 42, 8), { fill: dark, lw: 3 });
    sk.shape(G.ellipse(-31, -4, 25, 11), { fill: P.navy, lw: 3 });
    sk.shape(G.ellipse(31, -4, 25, 11), { fill: P.navy, lw: 3 });

    c.save();
    c.translate(0, bob);

    // body
    const bodyPts = G.rect(-62, -142, 124, 104, 28);
    sk.shape(bodyPts, { fill: body, hatch: { region: G.rect(26, -150, 50, 120), gap: 6.5, alpha: 0.42 } });
    // belly panel + hex badge
    sk.shape(G.rect(-34, -122, 68, 56, 14), { fill: P.cream, lw: 2.6 });
    sk.shape(G.hex(0, -94, 17), { fill: o.badge || P.gold, lw: 2.6 });
    if (o.badgeGlow) sk.glow(0, -94, 34, P.gold, o.badgeGlow);
    // neck
    sk.shape(G.rect(-16, -156, 32, 16, 4), { fill: P.grey, lw: 2.8 });
    c.restore();

    if (!o.noArms) arms();

    // head
    c.save();
    c.translate(0, -156 + bob);
    c.rotate(o.tilt || 0);
    // antenna
    const sway = o.sway || 0;
    sk.line(0, -106, Math.sin(sway) * 40, -106 - Math.cos(sway) * 40, { lw: 3.4 });
    const ax = Math.sin(sway) * 40, ay = -106 - Math.cos(sway) * 40;
    if (o.antenna) sk.glow(ax, ay, 40, P.gold, o.antenna);
    sk.shape(G.circle(ax, ay, 10), { fill: o.antennaColor || P.gold, lw: 3 });

    if (o.headset) sk.path(G.arc(0, -40, 92, 82, Math.PI * 1.08, Math.PI * 1.92, 20), { lw: 6, color: P.navy });

    const headPts = G.rect(-82, -108, 164, 112, 34);
    sk.shape(headPts, { fill: body, hatch: { region: G.rect(44, -120, 60, 140), gap: 6.5, alpha: 0.42 } });
    // ear bolts
    sk.shape(G.circle(-86, -52, 11), { fill: P.coral, lw: 3 });
    sk.shape(G.circle(86, -52, 11), { fill: P.coral, lw: 3 });
    if (o.headset) {
      sk.shape(G.rect(-100, -70, 22, 40, 8), { fill: P.navy, lw: 3 });
      sk.shape(G.rect(78, -70, 22, 40, 8), { fill: P.navy, lw: 3 });
      sk.path([[-92, -30], [-80, 2], [-48, 12]], { lw: 3.4 });
      sk.shape(G.circle(-44, 12, 7), { fill: P.ink, lw: 2 });
    }
    // screen face
    sk.shape(G.rect(-62, -90, 124, 76, 20), { fill: P.screen, lw: 3 });
    const lx = (o.look ? o.look[0] : 0) * 10, ly = (o.look ? o.look[1] : 0) * 7;
    const blink = o.blink || 0;
    c.save();
    if (o.happy) {
      for (const s of [-1, 1]) sk.path(G.arc(s * 25 + lx, -50 + ly, 11, 10, Math.PI * 1.1, Math.PI * 1.9, 10), { lw: 4.2, color: P.eye, double: false });
    } else {
      for (const s of [-1, 1]) {
        const ry = Math.max(1.5, 13 * (1 - blink) * (o.confused && s < 0 ? 0.45 : 1));
        sk.glow(s * 25 + lx, -54 + ly, 22, 'rgba(160,255,240,0.55)');
        sk.shape(G.ellipse(s * 25 + lx, -54 + ly, 8.5, ry, 18), { fill: P.eye, stroke: false });
      }
    }
    // mouth
    if (o.confused) sk.path([[-14 + lx * 0.6, -30], [-7 + lx * 0.6, -35], [0 + lx * 0.6, -30], [7 + lx * 0.6, -35], [14 + lx * 0.6, -30]], { lw: 3.2, color: P.eye, double: false });
    else if (o.mouth === 'o') sk.shape(G.ellipse(lx * 0.6, -28 + ly * 0.5, 6, 5, 14), { fill: P.eye, stroke: false });
    else sk.path(G.arc(lx * 0.6, -33 + ly * 0.5, 11, 7, 0.2 * Math.PI, 0.8 * Math.PI, 10), { lw: 3.4, color: P.eye, double: false });
    // cheeks
    sk.fillPts(G.ellipse(-46, -26, 7, 4.5, 14), P.coral, { alpha: 0.75 });
    sk.fillPts(G.ellipse(46, -26, 7, 4.5, 14), P.coral, { alpha: 0.75 });
    c.restore();
    c.restore();
  }

  // a few props shared across scenes
  const props = {
    magnifier(sk, x, y, ang = -0.6, r = 24) {
      const P = sk.pal, c = sk.ctx;
      c.save(); c.translate(x, y); c.rotate(ang);
      sk.tube([[0, 0], [0, -34]], 9, P.navy, { shade: false });
      sk.shape(G.circle(0, -34 - r, r), { fill: 'rgba(190,232,240,0.55)', lw: 4.4 });
      sk.path(G.arc(0, -34 - r, r * 0.62, r * 0.62, Math.PI * 1.1, Math.PI * 1.45, 6), { lw: 3, color: '#fff', double: false });
      c.restore();
    },
    pencil(sk, x, y, ang = 0.4, len = 70) {
      const P = sk.pal, c = sk.ctx;
      c.save(); c.translate(x, y); c.rotate(ang);
      sk.shape([[-6, 0], [6, 0], [6, -len], [-6, -len]], { fill: P.gold, lw: 2.6 });
      sk.shape([[-6, 0], [6, 0], [0, 16]], { fill: P.cream, lw: 2.6 });
      sk.shape([[-6, -len], [6, -len], [6, -len - 10], [-6, -len - 10]], { fill: P.coral, lw: 2.6 });
      c.restore();
    },
  };

  window.ROBOT = { robot, props, ik };
})();
