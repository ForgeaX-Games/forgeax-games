// Dump every SPRITE_SHEETS atlas to /tmp/hf-sheets/*.png for visual review.
// Pure generator output — same bytes SpriteSystem uploads at runtime.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { SPRITE_SHEETS } from '../src/fx/textures';

// Minimal PNG encoder (RGBA8, deflate).
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set([...type].map((c) => c.charCodeAt(0)), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width); dv.setUint32(4, height);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter: none
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const out = new Uint8Array(sig.length + (12 + 13) + (12 + idat.length) + 12);
  let o = 0;
  out.set(sig, o); o += 8;
  const c1 = chunk('IHDR', ihdr); out.set(c1, o); o += c1.length;
  const c2 = chunk('IDAT', idat); out.set(c2, o); o += c2.length;
  const c3 = chunk('IEND', new Uint8Array(0)); out.set(c3, o);
  return out;
}

mkdirSync('/tmp/hf-sheets', { recursive: true });
for (const s of SPRITE_SHEETS) {
  const { width, height, data } = s.generate();
  writeFileSync(`/tmp/hf-sheets/${s.id}-${width}x${height}.png`, encodePng(width, height, data));
  // Dark-composited view (additive sheets are invisible on white).
  const comp = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]! / 255;
    comp[i] = Math.round(data[i]! * a + 18 * (1 - a));
    comp[i + 1] = Math.round(data[i + 1]! * a + 16 * (1 - a));
    comp[i + 2] = Math.round(data[i + 2]! * a + 22 * (1 - a));
    comp[i + 3] = 255;
  }
  writeFileSync(`/tmp/hf-sheets/${s.id}-dark.png`, encodePng(width, height, comp));
  console.log(`${s.id}: ${width}x${height} (${s.cols}x${s.rows} grid, ${s.frames} frames)`);
}
