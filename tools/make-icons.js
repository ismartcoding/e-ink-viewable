// 生成扩展图标：纸白圆角底 + 墨黑对比圆（左暗右亮 = 暗色转亮色）。
// 纯 Node 无依赖，SDF 光栅化 + 超采样抗锯齿。运行：node tools/make-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function pngEncode(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const PAPER = [0xF6, 0xF3, 0xEC];
const INK = [0x1B, 0x19, 0x17];
const WHITE = [0xFF, 0xFF, 0xFF];

// 512 设计空间：圆角方 + 中心圆 r=150（描边 22），左半墨黑、右半纸白
function sample(px, py) {
  const dx = Math.abs(px - 256) - (256 - 116);
  const dy = Math.abs(py - 256) - (256 - 116);
  const ax = Math.max(dx, 0), ay = Math.max(dy, 0);
  const dBox = Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - 116;
  if (dBox > 0) return null;

  const dC = Math.hypot(px - 256, py - 256) - 150;
  if (Math.abs(dC) <= 11) return INK;
  if (dC <= 0) return px < 256 ? INK : WHITE;
  return PAPER;
}

function render(size) {
  const SS = 6;
  const img = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = (x + (sx + 0.5) / SS) * 512 / size;
          const py = (y + (sy + 0.5) / SS) * 512 / size;
          const col = sample(px, py);
          if (col) {
            r += col[0]; g += col[1]; b += col[2]; a += 255;
          }
        }
      }
      const n = SS * SS, i = (y * size + x) * 4;
      img[i] = Math.round(r / n);
      img[i + 1] = Math.round(g / n);
      img[i + 2] = Math.round(b / n);
      img[i + 3] = Math.round(a / n);
    }
  }
  return img;
}

module.exports = { render, pngEncode };

if (require.main === module) {
  const outDir = path.join(__dirname, '..', 'src', 'icons');
  fs.mkdirSync(outDir, { recursive: true });
  for (const size of [16, 24, 32, 48, 128]) {
    fs.writeFileSync(path.join(outDir, `icon_${size}.png`), pngEncode(size, size, render(size)));
    console.log(`icon_${size}.png`);
  }
}
