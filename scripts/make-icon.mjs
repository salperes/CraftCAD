// Generates build/icon.png (512x512): red rounded square with a white "C" ring.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const N = 512, px = new Uint8Array(N * N * 4);
const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const S = 4; // supersampling
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  let a = 0, w = 0;
  for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
    const fx = (x + (sx + 0.5) / S) / N, fy = (y + (sy + 0.5) / S) / N;
    // rounded square (radius 0.18)
    const r = 0.18, qx = Math.max(Math.abs(fx - 0.5) - (0.46 - r), 0), qy = Math.max(Math.abs(fy - 0.5) - (0.46 - r), 0);
    if (Math.hypot(qx, qy) > r) continue;
    a++;
    // "C": ring from radius 0.20 to 0.30, open on the right (±40°)
    const dx = fx - 0.5, dy = fy - 0.5, d = Math.hypot(dx, dy), ang = Math.abs(Math.atan2(dy, dx));
    if (d > 0.19 && d < 0.30 && ang > (40 * Math.PI) / 180) w++;
  }
  const i = (y * N + x) * 4, t = y / N;
  const cov = a / (S * S), white = w / (S * S);
  const base = [0xd0 - 0x30 * t, 0x44 - 0x10 * t, 0x2f - 0x0c * t];
  px[i] = base[0] + (255 - base[0]) * (white / Math.max(cov, 1e-9));
  px[i + 1] = base[1] + (255 - base[1]) * (white / Math.max(cov, 1e-9));
  px[i + 2] = base[2] + (255 - base[2]) * (white / Math.max(cov, 1e-9));
  px[i + 3] = 255 * cov;
}
const raw = Buffer.alloc(N * (N * 4 + 1));
for (let y = 0; y < N; y++) { raw[y * (N * 4 + 1)] = 0; Buffer.from(px.buffer, y * N * 4, N * 4).copy(raw, y * (N * 4 + 1) + 1); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
mkdirSync('build', { recursive: true });
writeFileSync('build/icon.png', Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
console.log('build/icon.png written');
