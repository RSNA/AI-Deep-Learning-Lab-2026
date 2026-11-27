// Renders one poster to PNG frames in a headless browser, then encodes them with ffmpeg.
//
//   node render.js 01                 -> out/RSNA2026_DLL_Lab01.mp4 (LinkedIn), _X.gif (X), _still.png
//   node render.js 01 --still 0,40    -> out/lab01_f0.png, out/lab01_f40.png (quick previews, no ffmpeg)
//
// Options: --frames 96 (frames per loop), --fps 12, --xray real|balanced|cartoon|dense (Lab 02 X-ray style)
// Set CHROME_PATH to use a specific Chromium build instead of the one `npx playwright install chromium` downloads.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), { execSync } = require('child_process');

const args = process.argv.slice(2);
const lab = args[0] || '01';
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const N = +opt('frames', 96), FPS = +opt('fps', 12), still = opt('still', null), xray = opt('xray', null);
const root = __dirname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ttf': 'font/ttf' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); res.end(d); });
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
  page.on('pageerror', (e) => console.error('PAGE ERROR', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('CONSOLE', m.text()); });
  await page.goto(`http://localhost:${port}/poster.html?lab=${lab}&frames=${N}${xray ? '&xray=' + xray : ''}`);
  await page.waitForFunction('window.ready === true', null, { timeout: 20000 });
  const outDir = path.join(root, 'out');
  const frames = path.join(outDir, `lab${lab}`);
  fs.mkdirSync(outDir, { recursive: true });
  const save = (file, dataUrl) => fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  if (still !== null) {
    const fr = still.split(',').map(Number);
    for (const f of fr) save(path.join(outDir, `lab${lab}_f${f}${xray ? '_' + xray : ''}.png`), await page.evaluate((f) => window.renderFrame(f), f));
    console.log('stills', fr.join(','));
  } else {
    fs.rmSync(frames, { recursive: true, force: true }); fs.mkdirSync(frames, { recursive: true });
    const t0 = Date.now();
    for (let f = 0; f < N; f++) save(path.join(frames, `f${String(f).padStart(4, '0')}.png`), await page.evaluate((f) => window.renderFrame(f), f));
    console.log(`frames ${N} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    const base = path.join(outDir, `RSNA2026_DLL_Lab${lab}`);
    // MP4 for LinkedIn: the loop plays 3 times (~24 s), since LinkedIn doesn't auto-loop videos
    execSync(`ffmpeg -y -loglevel error -stream_loop 2 -framerate ${FPS} -i ${frames}/f%04d.png -vf "fps=24" -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 18 -movflags +faststart ${base}.mp4`);
    // GIF for X: 864 x 1080, 128 colours (X allows up to 1280 x 1080 and 15 MB)
    execSync(`ffmpeg -y -loglevel error -framerate ${FPS} -i ${frames}/f%04d.png -vf "scale=-2:1080:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" -loop 0 ${base}_X.gif`);
    fs.copyFileSync(path.join(frames, `f${String(Math.floor(N * 0.55)).padStart(4, '0')}.png`), base + '_still.png');
    for (const ext of ['.mp4', '_X.gif', '_still.png']) console.log(path.basename(base + ext), (fs.statSync(base + ext).size / 1e6).toFixed(2) + ' MB');
  }
  await browser.close(); server.close();
})();
