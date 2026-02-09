import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICON_DIR = resolve(__dirname, '../public/icons');
const SIZES = [16, 32, 48, 128];

const BG_START = [169, 112, 255, 255]; // #A970FF
const BG_MID = [145, 70, 255, 255]; // #9146FF
const BG_END = [119, 44, 232, 255]; // #772CE8
const WHITE = [255, 255, 255, 255];

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mix(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function sampleBg(x, y, size) {
  const t = clamp((x + y) / (2 * (size - 1)), 0, 1);
  const leftT = clamp(t * 2, 0, 1);
  const rightT = clamp((t - 0.5) * 2, 0, 1);

  if (t <= 0.5) {
    return [
      mix(BG_START[0], BG_MID[0], leftT),
      mix(BG_START[1], BG_MID[1], leftT),
      mix(BG_START[2], BG_MID[2], leftT),
      255,
    ];
  }

  return [
    mix(BG_MID[0], BG_END[0], rightT),
    mix(BG_MID[1], BG_END[1], rightT),
    mix(BG_MID[2], BG_END[2], rightT),
    255,
  ];
}

function setPixel(buffer, size, x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= size || y >= size) {
    return;
  }

  const idx = (y * size + x) * 4;
  buffer[idx] = r;
  buffer[idx + 1] = g;
  buffer[idx + 2] = b;
  buffer[idx + 3] = a;
}

function fillRoundedRect(buffer, size, radius) {
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const hw = size / 2 - 0.5;
  const hh = hw;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x - cx;
      const py = y - cy;
      const qx = Math.abs(px) - (hw - radius);
      const qy = Math.abs(py) - (hh - radius);
      const ox = Math.max(qx, 0);
      const oy = Math.max(qy, 0);
      const outside = Math.hypot(ox, oy);
      const inside = Math.min(Math.max(qx, qy), 0);
      const distance = outside + inside;

      if (distance <= 0) {
        setPixel(buffer, size, x, y, sampleBg(x, y, size));
      }
    }
  }
}

function fillRect(buffer, size, x0, y0, x1, y1, color) {
  const startX = Math.max(0, Math.floor(Math.min(x0, x1)));
  const endX = Math.min(size - 1, Math.ceil(Math.max(x0, x1)));
  const startY = Math.max(0, Math.floor(Math.min(y0, y1)));
  const endY = Math.min(size - 1, Math.ceil(Math.max(y0, y1)));

  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      setPixel(buffer, size, x, y, color);
    }
  }
}

function drawRing(buffer, size, center, radius, stroke, color) {
  const [cx, cy] = center;
  const outer = radius + stroke / 2;
  const inner = radius - stroke / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x - cx, y - cy);
      if (d >= inner && d <= outer) {
        setPixel(buffer, size, x, y, color);
      }
    }
  }
}

function writeChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(8 + len + 4);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);

  let crc = 0xffffffff;
  for (let i = 4; i < 8 + len; i += 1) {
    crc = crcTable[(crc ^ chunk[i]) & 0xff] ^ (crc >>> 8);
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  chunk.writeUInt32BE(crc, 8 + len);
  return chunk;
}

function encodePng(width, height, rgba) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    row[0] = 0;
    rgba.copy(row, 1, y * width * 4, (y + 1) * width * 4);
    rows.push(row);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = deflateSync(Buffer.concat(rows), { level: 9 });

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    writeChunk('IHDR', ihdr),
    writeChunk('IDAT', idat),
    writeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function drawCrosshair(size) {
  const buffer = Buffer.alloc(size * size * 4, 0);
  const center = (size - 1) / 2;
  const stroke = Math.max(2, Math.round(size * 0.0625));
  const ringRadius = Math.round(size * 0.19);
  const tickLen = Math.max(3, Math.round(size * 0.11));
  const ringOuter = ringRadius + Math.floor(stroke / 2);
  const centerSize = Math.max(2, Math.round(size * 0.1));

  fillRoundedRect(buffer, size, Math.max(3, Math.round(size * 0.22)));
  drawRing(buffer, size, [center, center], ringRadius, stroke, WHITE);

  fillRect(buffer, size, center - stroke / 2, center - ringOuter - tickLen, center + stroke / 2, center - ringOuter, WHITE);
  fillRect(buffer, size, center - stroke / 2, center + ringOuter, center + stroke / 2, center + ringOuter + tickLen, WHITE);
  fillRect(buffer, size, center - ringOuter - tickLen, center - stroke / 2, center - ringOuter, center + stroke / 2, WHITE);
  fillRect(buffer, size, center + ringOuter, center - stroke / 2, center + ringOuter + tickLen, center + stroke / 2, WHITE);

  fillRect(
    buffer,
    size,
    center - centerSize / 2,
    center - centerSize / 2,
    center + centerSize / 2,
    center + centerSize / 2,
    WHITE,
  );

  return buffer;
}

function generateIcons() {
  mkdirSync(ICON_DIR, { recursive: true });
  for (const size of SIZES) {
    const pixels = drawCrosshair(size);
    const png = encodePng(size, size, pixels);
    writeFileSync(resolve(ICON_DIR, `icon${size}.png`), png);
  }
}

generateIcons();
