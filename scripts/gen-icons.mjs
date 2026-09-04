/* Zero-dependency PWA icon generator: draws a simple suitcase on pastel
 * #dfe8f5 and writes icon-192.png, icon-512.png, maskable-512.png.
 * Run: node scripts/gen-icons.mjs (repo root: luggage-belt-jam). */
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'icons');
mkdirSync(outDir, { recursive: true });

// Palette
const BG = [223, 232, 245]; // #dfe8f5 pastel
const BLUE = [59, 130, 246]; // #3b82f6 suitcase
const DARK_BLUE = [29, 78, 216]; // stripe
const INK = [51, 65, 85]; // #334155 handle/wheels
const WHITE = [255, 255, 255];

function crc32(buf) {
  let table = crc32.t;
  if (!table) {
    table = crc32.t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([td, data])));
  return Buffer.concat([len, td, data, crc]);
}

function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Draw the suitcase scene at size S, with art scaled by `art` (1 = full-bleed layout). */
function draw(size, art = 1) {
  const px = Buffer.alloc(size * size * 4, 255);
  const set = (x, y, c) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const o = (y * size + x) * 4;
    px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
  };
  const u = (f) => Math.round(f * size * art + ((1 - art) * size) / 2); // art-box coordinate
  // Background (full bleed — required for maskable safe zone).
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) set(x, y, BG);
  // Suitcase body: rounded rect x .18–.82, y .34–.78 (radius .09).
  const x0 = u(0.18), x1 = u(0.82), y0 = u(0.34), y1 = u(0.78), r = (u(0.27) - u(0.18));
  const cx = [x0 + r, x1 - r];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const nx = x < cx[0] ? cx[0] : x > cx[1] ? cx[1] : x;
      const ny = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y;
      if ((x - nx) ** 2 + (y - ny) ** 2 <= r * r) set(x, y, BLUE);
    }
  }
  // Dark middle stripe.
  for (let y = u(0.52); y <= u(0.63); y++)
    for (let x = x0; x <= x1; x++) {
      const nx = x < cx[0] ? cx[0] : x > cx[1] ? cx[1] : x;
      const ny = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y;
      if ((x - nx) ** 2 + (y - ny) ** 2 <= r * r) set(x, y, DARK_BLUE);
    }
  // White border stroke.
  const bw = Math.max(2, Math.round(size * art * 0.024));
  const inside = (x, y, m) => {
    const nx = x < cx[0] ? cx[0] : x > cx[1] ? cx[1] : x;
    const ny = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y;
    const d = Math.hypot(x - nx, y - ny);
    return x >= x0 + m && x <= x1 - m && y >= y0 + m && y <= y1 - m && d <= r - m;
  };
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const nx = x < cx[0] ? cx[0] : x > cx[1] ? cx[1] : x;
      const ny = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y;
      if (Math.hypot(x - nx, y - ny) <= r && !inside(x, y, bw)) set(x, y, WHITE);
    }
  // Handle: two legs + top bar in INK.
  const hw = Math.max(2, Math.round(size * art * 0.035));
  for (let y = u(0.27); y <= u(0.36); y++)
    for (let x = u(0.40); x <= u(0.60); x++) {
      const topBar = y <= u(0.27) + hw;
      const leg = x <= u(0.40) + hw || x >= u(0.60) - hw;
      if (topBar || leg) set(x, y, INK);
    }
  // Wheels.
  const wr = Math.max(2, Math.round(size * art * 0.03));
  for (const fx of [0.3, 0.7]) {
    const wcx = u(fx), wcy = y1 + wr;
    for (let y = wcy - wr; y <= wcy + wr; y++)
      for (let x = wcx - wr; x <= wcx + wr; x++)
        if ((x - wcx) ** 2 + (y - wcy) ** 2 <= wr * wr) set(x, y, INK);
  }
  return px;
}

for (const [name, size, art] of [['icon-192.png', 192, 1], ['icon-512.png', 512, 1], ['maskable-512.png', 512, 0.72]]) {
  const png = encodePNG(size, size, draw(size, art));
  writeFileSync(join(outDir, name), png);
  console.log(`wrote public/icons/${name} (${png.length} bytes)`);
}
