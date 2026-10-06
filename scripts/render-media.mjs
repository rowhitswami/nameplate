// Builds the public product page and the README animations from one source:
//
//   site/source.html  →  docs/index.html            (GitHub Pages, with SEO tags and structured data)
//                          →  docs/og.png, sitemap.xml, llms.txt, icon.png
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
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const SITE = 'https://rowhitswami.github.io/nameplate/';
const MARKETPLACE = 'https://marketplace.visualstudio.com/items?itemName=rowhitswami.nameplate';
const OPEN_VSX = 'https://open-vsx.org/extension/rowhitswami/nameplate';
const REPO = 'https://github.com/rowhitswami/nameplate';
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
// Pages load Google Fonts; a slow fetch should not fail a render.
const LOAD_TIMEOUT = 120_000;
const TITLE = 'Nameplate for VS Code: a name and a color for every window';
const DESCRIPTION =
  'Nameplate is a free VS Code extension that shows the project name in the status bar and gives every window its own color, so you can tell projects apart at a glance. Works in Cursor, Windsurf and Antigravity.';

const source = readFileSync(join(root, 'site', 'source.html'), 'utf8');
const split = source.indexOf('<header');
// The launch kit (private publishing notes) is only merged in for the owner's preview, never here.
const body = source.slice(split).replace(/\s*<!-- launch-kit:(tab|panel) -->/g, '');
const head = source.slice(0, split).replace(/<title>[^<]*<\/title>/, '');

/** The visible questions and answers, reused for structured data and llms.txt. */
const faq = [...body.matchAll(/<h3>([\s\S]*?)<\/h3><p>([\s\S]*?)<\/p>/g)]
  .filter((m) => body.indexOf(m[0]) > body.indexOf('class="faq"'))
  .map((m) => ({ q: plain(m[1]), a: plain(m[2]) }));

const structuredData = [
  {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Nameplate',
    alternateName: 'Nameplate for VS Code',
    description: DESCRIPTION,
    url: SITE,
    applicationCategory: 'DeveloperApplication',
    applicationSubCategory: 'Visual Studio Code extension',
    operatingSystem: 'Windows, macOS, Linux',
    softwareVersion: manifest.version,
    softwareRequirements: 'Visual Studio Code 1.85 or later, or an editor based on it',
    isAccessibleForFree: true,
    license: 'https://opensource.org/licenses/MIT',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    downloadUrl: MARKETPLACE,
    installUrl: MARKETPLACE,
    image: `${SITE}og.png`,
    screenshot: ['hero', 'coordinate', 'menu', 'git'].map(
      (n) => `${REPO}/raw/main/media/readme/${n}.gif`,
    ),
    author: { '@type': 'Person', name: 'Rohit Swami', url: 'https://github.com/rowhitswami' },
    sameAs: [REPO, MARKETPLACE, OPEN_VSX],
    featureList: [
      'Shows the project name in the status bar',
      'Gives every project its own status bar color',
      'Open windows never share a color',
      'Keeps the color settings out of Git',
      'Works in VS Code, Cursor, Windsurf, Antigravity, Kiro, Positron and VSCodium',
    ],
  },
  {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  },
];

const seo = `<title>${TITLE}</title>
<meta name="description" content="${DESCRIPTION}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="author" content="Rohit Swami">
<meta name="theme-color" content="#0d0f13">
<link rel="canonical" href="${SITE}">
<link rel="icon" type="image/png" href="icon.png">
<link rel="apple-touch-icon" href="icon.png">
<link rel="sitemap" type="application/xml" href="sitemap.xml">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Nameplate">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="${DESCRIPTION}">
<meta property="og:url" content="${SITE}">
<meta property="og:image" content="${SITE}og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="VS Code windows with project names and different status bar colors">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${TITLE}">
<meta name="twitter:description" content="${DESCRIPTION}">
<meta name="twitter:image" content="${SITE}og.png">
<script type="application/ld+json">${JSON.stringify(structuredData)}</script>`;

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${seo}
${head.trim()}
</head>
<body>
${body.trim()}
</body>
</html>
`;
const docs = join(root, 'docs');
writeFileSync(join(docs, 'index.html'), page);
copyFileSync(join(root, 'media', 'icon.png'), join(docs, 'icon.png'));
writeFileSync(join(docs, '.nojekyll'), '');
const today = new Date().toISOString().slice(0, 10);
writeFileSync(
  join(docs, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE}</loc><lastmod>${today}</lastmod></url>
  <url><loc>${SITE}llms.txt</loc><lastmod>${today}</lastmod></url>
</urlset>
`,
);
writeFileSync(
  join(docs, 'llms.txt'),
  `# Nameplate for VS Code

> ${DESCRIPTION}

Nameplate adds the project's name to the left end of the VS Code status bar and colors the whole status bar, a different color for each project. Colors are chosen automatically from the Git remote, windows that are open at the same time never share a color, and the color settings are kept out of Git with a local exclude entry or Git filter. It has no settings that need changing, makes no network requests and has no telemetry.

## Links

- [Product page](${SITE})
- [Source code and documentation](${REPO})
- [Visual Studio Marketplace](${MARKETPLACE})
- [Open VSX (Cursor, Windsurf, Antigravity, Kiro, Positron, VSCodium)](${OPEN_VSX})

## Facts

- Extension ID: rowhitswami.nameplate
- Version: ${manifest.version}
- Requires: VS Code 1.85 or later, or an editor built on it
- License: MIT, free
- Author: Rohit Swami

## Questions

${faq.map(({ q, a }) => `### ${q}\n\n${a}`).join('\n\n')}
`,
);
console.log(`wrote docs/index.html (${faq.length} FAQ entries), sitemap.xml, llms.txt, icon.png`);

function plain(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

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
      await tab.goto(pageUrl, { waitUntil: 'networkidle0', timeout: LOAD_TIMEOUT });
      await tab.evaluate(() => document.fonts.ready);
      await tab.screenshot({ path: join(shotsDir, `${label}.png`), fullPage: true });
      await tab.close();
      console.log(`screenshot ${label}`);
    }
  }

  // Social preview image (Open Graph / X), 1200×630.
  const card = await browser.newPage();
  await card.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  await card.setContent(socialCard(), { waitUntil: 'networkidle0', timeout: LOAD_TIMEOUT });
  await card.evaluate(() => document.fonts.ready);
  await card.screenshot({ path: join(root, 'docs', 'og.png') });
  await card.close();
  console.log('wrote docs/og.png');

  const outDir = join(root, 'media', 'readme');
  mkdirSync(outDir, { recursive: true });
  for (const scene of SCENES) {
    const tab = await browser.newPage();
    await tab.setViewport({ width: 880, height: 700, deviceScaleFactor: 1 });
    await tab.goto(`${pageUrl}?render=${scene.name}`, {
      waitUntil: 'networkidle0',
      timeout: LOAD_TIMEOUT,
    });
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
    const gif = encodeGif(frames, frameMs);
    if (contactDir) {
      // The contact sheet shows the quantized frames, exactly as the GIF will look.
      mkdirSync(contactDir, { recursive: true });
      const { width, height } = frames[0];
      const shown = gif.indexed.map((index) => fromIndexed(index, gif.palette, width, height));
      writeFileSync(join(contactDir, `${scene.name}.png`), contactSheet(shown, 8));
    }
    writeFileSync(join(outDir, `${scene.name}.gif`), gif.bytes);
    console.log(
      `${scene.name}.gif: ${frames.length} frames, ${(gif.bytes.length / 1024).toFixed(0)} KB`,
    );
    await tab.close();
  }
} finally {
  await browser.close();
}

/**
 * One shared palette for the whole loop (no flicker), built from every frame so
 * that short-lived elements (menus, toasts) keep their exact colors; identical
 * frames are merged into longer delays.
 */
function encodeGif(frames, frameMs) {
  const { width, height } = frames[0];
  const pixelsPerFrame = width * height;
  const stride = 3; // every third pixel of every frame is plenty for 256 colors
  const sample = new Uint8Array(Math.ceil(pixelsPerFrame / stride) * 4 * frames.length);
  let o = 0;
  for (const frame of frames) {
    for (let p = 0; p < pixelsPerFrame; p += stride) {
      sample.set(frame.data.subarray(p * 4, p * 4 + 4), o);
      o += 4;
    }
  }
  const palette = quantize(sample.subarray(0, o), 256, { format: 'rgb565' });
  const encoder = GIFEncoder();
  const indexed = [];
  let pending;
  let pendingDelay = 0;
  const flush = () => {
    if (pending) {
      encoder.writeFrame(pending, width, height, { palette, delay: Math.round(pendingDelay) });
    }
  };
  for (const frame of frames) {
    const index = applyPalette(frame.data, palette, 'rgb565');
    indexed.push(index);
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
  return { bytes: Buffer.from(encoder.bytes()), palette, indexed };
}

/** What the GIF actually shows: indexed frames turned back into RGBA. */
function fromIndexed(index, palette, width, height) {
  const png = new PNG({ width, height });
  for (let i = 0; i < index.length; i++) {
    const [r, g, b] = palette[index[i]];
    png.data[i * 4] = r;
    png.data[i * 4 + 1] = g;
    png.data[i * 4 + 2] = b;
    png.data[i * 4 + 3] = 255;
  }
  return png;
}

function socialCard() {
  const bars = [
    ['STOREFRONT', '#216de8', '#fff'],
    ['BILLING API', '#9051eb', '#fff'],
    ['MOBILE APP', '#c3ea43', '#000'],
    ['DOCS', '#c74b15', '#fff'],
  ];
  const windows = bars
    .map(
      ([name, color, text], i) =>
        `<div class="w" style="top:${34 + i * 140}px;left:${i % 2 ? 110 : 40}px"><div class="tb"><i></i><i></i><i></i></div><div class="lines"><b style="width:62%"></b><b style="width:80%"></b><b style="width:46%"></b></div><div class="sb" style="background:${color};color:${text}">▣ ${name}<span>⎇ main</span></div><div class="glow" style="background:${color}"></div></div>`,
    )
    .join('');
  return `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sofia+Sans+Extra+Condensed:wght@800;900&family=Atkinson+Hyperlegible+Next:wght@400;700&display=swap">
<style>
body{margin:0;width:1200px;height:630px;background:#0d0f13;font-family:"Atkinson Hyperlegible Next",sans-serif;color:#e9ecf1;overflow:hidden;position:relative}
.text{position:absolute;left:72px;top:110px;width:560px}
h1{font:900 104px/0.88 "Sofia Sans Extra Condensed",sans-serif;text-transform:uppercase;margin:0 0 26px}
p{font-size:28px;line-height:1.4;color:#a6adbb;margin:0}
.brand{position:absolute;left:72px;top:52px;font:800 30px/1 "Sofia Sans Extra Condensed",sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#cfd4dd}
.stage{position:absolute;right:40px;top:0;width:520px;height:630px}
.w{position:absolute;width:400px;height:116px;background:#1d1e23;border-radius:10px;overflow:visible;box-shadow:0 18px 40px rgb(0 0 0/.45),0 0 0 1px #000}
.tb{height:22px;background:#24262c;border-radius:10px 10px 0 0;display:flex;gap:6px;align-items:center;padding:0 10px}
.tb i{width:8px;height:8px;border-radius:50%;background:#4a4d55;display:block}
.lines{padding:12px 16px;display:grid;gap:9px}.lines b{display:block;height:7px;border-radius:4px;background:#3a3d46}
.sb{position:absolute;left:0;right:0;bottom:0;height:28px;border-radius:0 0 10px 10px;display:flex;gap:14px;align-items:center;padding:0 12px;font:700 15px/1 "Atkinson Hyperlegible Next",sans-serif;letter-spacing:.03em}
.sb span{font-weight:400;opacity:.85}
.glow{position:absolute;left:30px;right:30px;bottom:-26px;height:40px;filter:blur(26px);opacity:.45;z-index:-1;border-radius:50%}
</style>
<div class="brand">Nameplate for VS Code</div>
<div class="text"><h1>Which project is this window?</h1><p>The project name and its own status bar color in every VS Code window.</p></div>
<div class="stage">${windows}</div>`;
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
