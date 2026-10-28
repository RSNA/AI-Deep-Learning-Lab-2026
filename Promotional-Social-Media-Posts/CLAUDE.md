# Notes for AI coding assistants

This folder holds the code, post copy and style guide behind the animated social media posters for the RSNA 2026 Deep Learning Labs. Read `README.md` and `STYLE_GUIDE.md` first. This file adds what you need to rebuild or extend the work safely.

## What exists and where

- `code/` is a self-contained static project. `poster.html` draws one frame of a poster on a 1080 x 1350 canvas. `render.js` opens it in headless Chromium through Playwright, saves the frames as PNGs, and encodes them with ffmpeg.
- `code/labs.js` holds the text on each poster. `code/scenes/labNN.js` holds each animation. Lab `00` is the welcome post.
- `POSTS.md` holds the final LinkedIn and X copy. It was generated from the same text the download kit shows, with `**bold**` markers removed.
- The finished MP4s and GIFs are not in the repository. They are on the download kit page, <https://rsna2026-dll-social-kit.vercel.app>, and `render.js` rebuilds them exactly.
- `previews/` holds 540 px wide JPG stills for the README. They were made from `out/RSNA2026_DLL_LabNN_still.png` with `ffmpeg -i <still.png> -vf scale=540:-1:flags=lanczos -q:v 3 previews/labNN.jpg`.

## Rebuild everything

```bash
cd code
npm ci && npx playwright install chromium   # needs Node 18+ and ffmpeg on PATH
for n in 00 01 02 03 04 05 06 07 08; do node render.js $n; done
```

Outputs go to `code/out/`, which is git-ignored:

- `RSNA2026_DLL_LabNN.mp4`, for LinkedIn: H.264, 24 fps, crf 18, the 96-frame loop played 3 times.
- `RSNA2026_DLL_LabNN_X.gif`, for X: 864 x 1080, 128-colour palette with Bayer dithering.
- `RSNA2026_DLL_LabNN_still.png`: frame 52, at 55% of the loop.

Set `CHROME_PATH` to use an existing Chromium or headless-shell binary instead of Playwright's download.

## How the drawing works

- `lib/sketch.js` exports `SK`. `SK.Sketch` strokes and fills point lists with seeded wobble, so the output is deterministic. Its `boil` field changes every 2 frames and gives the hand-animated jitter. `SK.G` builds geometry (rect, ellipse, circle, arc, hex, bezier). `seg`, `pulse` and `ease` handle timing.
- `lib/frame.js` exports `FRAME`, with the palette `PAL`, the sheet rectangle `SHEET` and `drawPoster`. `drawPoster` draws the paper, header, title, sheet and footer, then calls the scene.
- A scene is `window.SCENES.<name> = function (sk, t, f, N, A, S)`. It draws in sheet coordinates (984 x 672, origin top-left) with clipping already applied. `t = f / N` runs from 0 to 1. Most scenes only need `sk` and `t`.
- `lib/robot.js` exports `ROBOT.robot(sk, options)`, drawn around its feet at (0, 0). Translate and scale the context before calling it. See the options used in `scenes/lab01.js` and `scenes/_template.js`.
- `lib/xray.js` exports `XRAY.draw(sk, x, y, w, h, options)`. The default variant, `balanced`, is the one chosen for the series. Pass `{ nodule: false }` when the scene draws its own finding.

## Rules

- Keep rendering deterministic. Don't use `Math.random()` or the clock. Use `SK.mulberry32(SK.hashStr(...))` for seeded randomness.
- Keep the shared layout in `lib/frame.js` unchanged unless you mean to change every poster. Put lab-specific drawing in the scene.
- Make loops seamless: periodic motion uses whole cycles per loop, and the last frame flows into the first.
- After any change, render a few stills (`node render.js NN --still 0,24,52,80`) and look at them before you render the videos.
- Check post copy against `STYLE_GUIDE.md`: tag `@RSNA`, put the day, time and room in the text, keep X posts under 280 characters (a link counts as 23), and never link this repository in a promotional post.
- Faculty names, degrees and affiliations are confirmed by the faculty. Don't "correct" them without asking the lab director.
- Don't commit `code/out/` or `code/node_modules/`. Keep large media out of the repository.
