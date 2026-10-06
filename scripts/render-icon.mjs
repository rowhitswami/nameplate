// Renders media/icon.png (256×256) from the same shapes as media/icon.svg,
// without any native dependencies: simple shapes, 4× supersampling, zlib PNG.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const SIZE = 256;
const SCALE = SIZE / 128;
const SS = 4; // supersampling factor per axis

const hex = (value) => [
  parseInt(value.slice(1, 3), 16),
  parseInt(value.slice(3, 5), 16),
  parseInt(value.slice(5, 7), 16),
];

/** Shapes in the 128-unit coordinate system of icon.svg, painted in order. */
const shapes = [
  { kind: 'rrect', x: 0, y: 0, w: 128, h: 128, r: 28, fill: '#0f172a' },
  { kind: 'rrect', x: 18, y: 22, w: 92, h: 84, r: 12, fill: '#1e293b' },
  { kind: 'circle', cx: 30, cy: 34, r: 3.5, fill: '#475569' },
  { kind: 'circle', cx: 41, cy: 34, r: 3.5, fill: '#475569' },
  { kind: 'circle', cx: 52, cy: 34, r: 3.5, fill: '#475569' },
  { kind: 'rrect', x: 28, y: 48, w: 44, h: 5, r: 2.5, fill: '#334155' },
  { kind: 'rrect', x: 28, y: 59, w: 62, h: 5, r: 2.5, fill: '#334155' },
  { kind: 'rrect', x: 28, y: 70, w: 36, h: 5, r: 2.5, fill: '#334155' },
  // Status bar: square top corners, rounded bottom corners.
  { kind: 'rrect', x: 18, y: 84, w: 92, h: 22, r: 12, fill: '#2563eb', squareTop: true },
  { kind: 'rrect', x: 26, y: 90, w: 34, h: 9, r: 4.5, fill: '#ffffff' },
  { kind: 'circle', cx: 98, cy: 94.5, r: 4, fill: '#ffffff', alpha: 0.85 },
];

function insideRoundedRect(px, py, s) {
  const { x, y, w, h, r } = s;
  if (px < x || px > x + w || py < y || py > y + h) {
    return false;
  }
  let cx;
  if (px < x + r) {
    cx = x + r;
  } else if (px > x + w - r) {
    cx = x + w - r;
  } else {
    return true;
  }
  let cy;
  if (py < y + r) {
    if (s.squareTop) {
      return true;
    }
    cy = y + r;
  } else if (py > y + h - r) {
    cy = y + h - r;
  } else {
    return true;
  }
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

function insideCircle(px, py, s) {
  const dx = px - s.cx;
  const dy = py - s.cy;
  return dx * dx + dy * dy <= s.r * s.r;
}

const pixels = new Float32Array(SIZE * SIZE * 4);
for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const ux = (px + (sx + 0.5) / SS) / SCALE;
        const uy = (py + (sy + 0.5) / SS) / SCALE;
        let cr = 0;
        let cg = 0;
        let cb = 0;
        let ca = 0;
        for (const shape of shapes) {
          const hit =
            shape.kind === 'circle'
              ? insideCircle(ux, uy, shape)
              : insideRoundedRect(ux, uy, shape);
          if (!hit) {
            continue;
          }
          const [fr, fg, fb] = hex(shape.fill);
          const fa = shape.alpha ?? 1;
          cr = fr * fa + cr * (1 - fa);
          cg = fg * fa + cg * (1 - fa);
          cb = fb * fa + cb * (1 - fa);
          ca = fa + ca * (1 - fa);
        }
        r += cr * ca;
        g += cg * ca;
        b += cb * ca;
        a += ca;
      }
    }
    const samples = SS * SS;
    const i = (py * SIZE + px) * 4;
    if (a > 0) {
      pixels[i] = r / a;
      pixels[i + 1] = g / a;
      pixels[i + 2] = b / a;
    }
    pixels[i + 3] = (a / samples) * 255;
  }
}

// --- PNG encoding ----------------------------------------------------------
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    const o = y * (SIZE * 4 + 1) + 1 + x * 4;
    raw[o] = Math.round(pixels[i]);
    raw[o + 1] = Math.round(pixels[i + 1]);
    raw[o + 2] = Math.round(pixels[i + 2]);
    raw[o + 3] = Math.round(pixels[i + 3]);
  }
}

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});
const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(new URL('../media/icon.png', import.meta.url), png);
console.log(`Wrote media/icon.png (${png.length} bytes)`);
