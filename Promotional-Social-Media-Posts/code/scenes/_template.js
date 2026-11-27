// Starter scene: copy this file to scenes/labNN.js and change the drawing to tell your lab's story.
// A scene draws inside the taped sketch sheet (984 x 672 px, origin at its top-left corner).
// It is called once per frame with t = f / N, which runs from 0 to 1 over the loop.
// Make the last frame flow into the first so the animation loops without a jump.
(function () {
  const { G, ease, seg, pulse, TAU } = SK; // geometry and timing helpers from lib/sketch.js
  const { robot } = ROBOT;                   // the series mascot from lib/robot.js

  function scene(sk, t) {
    const P = sk.pal, c = sk.ctx; // P = colour palette (see FRAME.PAL in lib/frame.js)

    // 1. A sign that pops in, stays, and leaves before the loop restarts.
    const show = ease.back(seg(t, 0.1, 0.22)) * (1 - ease.in(seg(t, 0.82, 0.92)));
    if (show > 0.01) {
      c.save(); c.translate(640, 250); c.scale(show, show); c.rotate(-0.04);
      sk.shape(G.rect(-190, -80, 380, 160, 14), { fill: P.cream, lw: 3 });
      sk.text('your idea here!', 0, 18, { font: '700 52px Caveat', align: 'center', color: P.tealDark, jitter: true });
      c.restore();
    }

    // 2. The robot, standing on the sheet's floor line.
    sk.line(80, 560, 904, 560, { lw: 2.4, alpha: 0.5 });
    c.save();
    c.translate(300, 560); c.scale(1.1, 1.1); // robot(...) draws around its feet at (0, 0)
    robot(sk, {
      look: [0.5, -0.2],                                   // where the eyes point
      blink: pulse(t, 0.5, 0.53, 0.01),                    // 0 -> 1 -> 0 for a quick blink
      happy: t > 0.25 && t < 0.8,                          // smiling while the sign is up
      bob: Math.sin(t * TAU * 4) * 2.5,                    // whole-number multiples of TAU keep the loop seamless
      antenna: 0.5 + 0.5 * Math.sin(t * TAU * 8),
    });
    c.restore();

    // 3. A small spark that travels once across the sheet per loop.
    const x = 80 + 824 * t, y = 120 + Math.sin(t * TAU) * 30;
    sk.glow(x, y, 30, P.gold, 0.8);
    sk.shape(G.circle(x, y, 9), { fill: P.gold, lw: 2.4 });
  }

  window.SCENES.template = scene;
})();
