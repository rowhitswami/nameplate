// Builds the public product page and the README animations from one source:
//
//   docs/site-source.html  →  docs/index.html            (GitHub Pages)
//                          →  media/readme/<scene>.gif   (README / Marketplace: no SVG or scripts allowed there)
//
// Every scene is animated with CSS keyframes only, so each GIF frame is rendered
// by pausing all animations and seeking them to an exact time.
//
//   node scripts/render-media.mjs                 # page + all GIFs
//   node scripts/render-media.mjs --page-only     # page only
//   node scripts/render-media.mjs --shots <dir>   # also save full-page review screenshots
//   node scripts/render-media.mjs --contact <dir> # also save a grid of sampled frames per scene
//
// Needs Google Chrome (or set CHROME_PATH). Dev-only: puppeteer-core, pngjs, gifenc.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import { PNG } from 'pngjs';
import gifenc from 'gifenc';

const { GIFEncoder, quantize, applyPalette } = gifenc;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const shotsDir = args.includes('--shots') ? resolve(args[args.indexOf('--shots') + 1]) : undefined;
const contactDir = args.includes('--contact')
  ? resolve(args[args.indexOf('--contact') + 1])
  : undefined;

/** Scenes, their loop length (must match the CSS) and frame rate. */
const SCENES = [
  { name: 'hero', loopMs: 12_000, fps: 10 },
  { name: 'coordinate', loopMs: 9_000, fps: 12 },
  { name: 'menu', loopMs: 9_000, fps: 12 },
  { name: 'git', loopMs: 10_000, fps: 10 },
];

const CHROME =
  process.env.CHROME_PATH ??
  {
    darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    linux: '/usr/bin/google-chrome',
    win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  }[process.platform];

// --- page ---------------------------------------------------------------------
const source = readFileSync(join(root, 'docs', 'site-source.html'), 'utf8');
const split = source.indexOf('<header');
const head = source.slice(0, split);
// The launch kit (private publishing notes) is only merged in for the owner's preview, never here.
const body = source.slice(split).replace(/\s*<!-- launch-kit:(tab|panel) -->/g, '');
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Nameplate gives every VS Code window its project name and its own status bar color.">
${head.trim()}
</head>
<body>
${body.trim()}
</body>
</html>
`;
writeFileSync(join(root, 'docs', 'index.html'), page);
console.log('wrote docs/index.html');
if (args.includes('--page-only')) {
  process.exit(0);
}

// --- frames -------------------------------------------------------------------
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--hide-scrollbars'],
});
try {
  const pageUrl = pathToFileURL(join(root, 'docs', 'index.html')).href;

  if (shotsDir) {
    mkdirSync(shotsDir, { recursive: true });
    for (const [label, width, scheme] of [
      ['desktop-light', 1280, 'light'],
      ['desktop-dark', 1280, 'dark'],
      ['phone-light', 400, 'light'],
    ]) {
      const tab = await browser.newPage();
      await tab.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
      await tab.setViewport({ width, height: 900, deviceScaleFactor: 1 });
      await tab.goto(pageUrl, { waitUntil: 'networkidle0' });
      await tab.evaluate(() => document.fonts.ready);
      await tab.screenshot({ path: join(shotsDir, `${label}.png`), fullPage: true });
      await tab.close();
      console.log(`screenshot ${label}`);
    }
  }

  const outDir = join(root, 'media', 'readme');
  mkdirSync(outDir, { recursive: true });
  for (const scene of SCENES) {
    const tab = await browser.newPage();
    await tab.setViewport({ width: 880, height: 700, deviceScaleFactor: 1 });
    await tab.goto(`${pageUrl}?render=${scene.name}`, { waitUntil: 'networkidle0' });
    await tab.evaluate(() => document.fonts.ready);
    const element = await tab.$('.render-target');
    if (!element) {
      throw new Error(`scene ${scene.name} not found`);
    }
    await tab.evaluate(() => document.getAnimations().forEach((animation) => animation.pause()));
    const frameMs = 1000 / scene.fps;
    const frames = [];
    for (let t = 0; t < scene.loopMs; t += frameMs) {
      await tab.evaluate((time) => {
        for (const animation of document.getAnimations()) {
          // Every animation in a scene loops with the scene; negative delays are part of currentTime.
          animation.currentTime = time;
        }
      }, t);
      const png = PNG.sync.read(Buffer.from(await element.screenshot({ type: 'png' })));
      frames.push(png);
    }
    if (contactDir) {
      mkdirSync(contactDir, { recursive: true });
      writeFileSync(join(contactDir, `${scene.name}.png`), contactSheet(frames, 8));
    }
    const gif = encodeGif(frames, frameMs);
    writeFileSync(join(outDir, `${scene.name}.gif`), gif);
    console.log(`${scene.name}.gif: ${frames.length} frames, ${(gif.length / 1024).toFixed(0)} KB`);
    await tab.close();
  }
} finally {
  await browser.close();
}

/** One shared palette for the whole loop (no flicker), identical frames merged into longer delays. */
function encodeGif(frames, frameMs) {
  const { width, height } = frames[0];
  const sample = new Uint8Array(width * height * 4 * Math.min(frames.length, 12));
  const step = Math.max(1, Math.floor(frames.length / 12));
  for (let i = 0, j = 0; i < frames.length && j < 12; i += step, j++) {
    sample.set(frames[i].data, j * width * height * 4);
  }
  const palette = quantize(sample, 256, { format: 'rgb565' });
  const encoder = GIFEncoder();
  let pending;
  let pendingDelay = 0;
  const flush = () => {
    if (pending) {
      encoder.writeFrame(pending, width, height, { palette, delay: Math.round(pendingDelay) });
    }
  };
  for (const frame of frames) {
    const index = applyPalette(frame.data, palette, 'rgb565');
    if (pending && sameIndex(pending, index)) {
      pendingDelay += frameMs;
      continue;
    }
    flush();
    pending = index;
    pendingDelay = frameMs;
  }
  flush();
  encoder.finish();
  return Buffer.from(encoder.bytes());
}

/** Evenly sampled frames tiled two per row, at half size. */
function contactSheet(frames, count) {
  const picks = Array.from(
    { length: count },
    (_, i) => frames[Math.floor((i * frames.length) / count)],
  );
  const w = Math.floor(picks[0].width / 2);
  const h = Math.floor(picks[0].height / 2);
  const sheet = new PNG({ width: w * 2, height: h * Math.ceil(count / 2) });
  picks.forEach((frame, i) => {
    const ox = (i % 2) * w;
    const oy = Math.floor(i / 2) * h;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const from = (y * 2 * frame.width + x * 2) * 4;
        const to = ((oy + y) * sheet.width + ox + x) * 4;
        frame.data.copy(sheet.data, to, from, from + 4);
      }
    }
  });
  return PNG.sync.write(sheet);
}

function sameIndex(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}
