import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/**
 * Render a crisp emblem PNG of `size` x `size` RGBA pixels (deep slate rounded
 * shield with gold scales/IX motif). Linux `.desktop` entries and AppImage
 * require 512x512 (`build/icon.png`), solving Defect D4.
 */
export function renderIconPng(size: number): Buffer {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  const radius = Math.round(size * 0.18);

  const insideRoundedRect = (x: number, y: number): boolean => {
    const pad = Math.round(size * 0.06);
    if (x < pad || x >= size - pad || y < pad || y >= size - pad) return false;
    const innerLeft = pad + radius;
    const innerRight = size - pad - radius - 1;
    const innerTop = pad + radius;
    const innerBottom = size - pad - radius - 1;
    const cx = x < innerLeft ? innerLeft : x > innerRight ? innerRight : x;
    const cy = y < innerTop ? innerTop : y > innerBottom ? innerBottom : y;
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= radius * radius;
  };

  const isGlyphPixel = (nx: number, ny: number): boolean => {
    // Top & bottom serif bars of Roman numeral "IX"
    const inBandY = ny >= 0.28 && ny <= 0.72;
    if (!inBandY) return false;
    const serifTop = ny >= 0.28 && ny <= 0.34;
    const serifBot = ny >= 0.66 && ny <= 0.72;
    if ((serifTop || serifBot) && nx >= 0.24 && nx <= 0.76) {
      return (nx >= 0.24 && nx <= 0.42) || (nx >= 0.48 && nx <= 0.76);
    }
    // Vertical stem of "I"
    if (nx >= 0.30 && nx <= 0.36) return true;
    // Diagonal strokes of "X" centered at (0.62, 0.50)
    const t = (ny - 0.28) / (0.72 - 0.28);
    const xDiag1 = 0.50 + t * 0.24;
    const xDiag2 = 0.74 - t * 0.24;
    return Math.abs(nx - xDiag1) <= 0.032 || Math.abs(nx - xDiag2) <= 0.032;
  };

  for (let y = 0; y < size; y++) {
    const rowOffset = y * stride;
    raw[rowOffset] = 0; // filter type None
    for (let x = 0; x < size; x++) {
      const px = rowOffset + 1 + x * 4;
      if (!insideRoundedRect(x, y)) {
        raw[px] = 0;
        raw[px + 1] = 0;
        raw[px + 2] = 0;
        raw[px + 3] = 0;
        continue;
      }
      const nx = x / size;
      const ny = y / size;
      if (isGlyphPixel(nx, ny)) {
        // Warm amber-gold glyph (#f59e0b)
        raw[px] = 245;
        raw[px + 1] = 158;
        raw[px + 2] = 11;
        raw[px + 3] = 255;
      } else {
        // Subtle vertical slate gradient (#0f172a -> #1e293b)
        const g = ny;
        raw[px] = Math.round(15 + g * 15);
        raw[px + 1] = Math.round(23 + g * 18);
        raw[px + 2] = Math.round(42 + g * 17);
        raw[px + 3] = 255;
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw, { level: 9 });
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Wrap a 256x256 PNG inside a valid Windows `.ico` container (`build/icon.ico`).
 */
export function wrapPngAsIco(png256: Buffer): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = ICO
  header.writeUInt16LE(1, 4); // 1 image

  const entry = Buffer.alloc(16);
  entry[0] = 0; // 0 means 256px width in ICO format
  entry[1] = 0; // 0 means 256px height in ICO format
  entry[2] = 0; // palette count
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // 32 bpp
  entry.writeUInt32LE(png256.length, 8);
  entry.writeUInt32LE(22, 12); // offset = 6 + 16

  return Buffer.concat([header, entry, png256]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = path.resolve(process.cwd(), "build");
  fs.mkdirSync(outDir, { recursive: true });
  const png512 = renderIconPng(512);
  const png256 = renderIconPng(256);
  const png128 = renderIconPng(128);
  const png32 = renderIconPng(32);
  const ico = wrapPngAsIco(png256);

  fs.writeFileSync(path.join(outDir, "icon.png"), png512);
  fs.writeFileSync(path.join(outDir, "icon.ico"), ico);

  const tauriIconsDir = path.resolve(process.cwd(), "src-tauri", "icons");
  fs.mkdirSync(tauriIconsDir, { recursive: true });
  fs.writeFileSync(path.join(tauriIconsDir, "icon.png"), png512);
  fs.writeFileSync(path.join(tauriIconsDir, "128x128@2x.png"), png256);
  fs.writeFileSync(path.join(tauriIconsDir, "128x128.png"), png128);
  fs.writeFileSync(path.join(tauriIconsDir, "32x32.png"), png32);
  fs.writeFileSync(path.join(tauriIconsDir, "icon.ico"), ico);

  console.log("Generated 512x512 build/icon.png, build/icon.ico, and src-tauri/icons/*");
}
