// Builds every brand asset from the master artwork.  Run: npm run icons -w @trigon/web
//
//   brand-src/trigon-logo-original.png      master (2752×1536, mark + wordmark on navy); kept out of
//                                           public/ so the service worker doesn't precache 1.8 MB
//     → public/brand/trigon-mark.png         transparent mark (works on light and dark UI)
//     → public/brand/trigon-lockup.jpg       mark + TRIGON + tagline on navy (README, sharing)
//     → public/icons/icon-192/512.png        rounded navy tiles (PWA "any")
//     → public/icons/maskable-512.png        full-bleed, mark inside the 80% safe zone
//     → public/icons/apple-touch-icon.png    full-bleed 180px (iOS rounds it)
//     → src/app/favicon.ico                  16/32/48/64
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const brand = join(root, 'public', 'brand');
const icons = join(root, 'public', 'icons');
const master = join(root, 'brand-src', 'trigon-logo-original.png');

// Region of the master that holds the triangle mark (pixels in the 2752×1536 original).
const MARK = { left: 990, top: 262, width: 775, height: 675 };
// Mark + wordmark + tagline.
const LOCKUP = { left: 820, top: 230, width: 1112, height: 1020 };

const markCrop = await sharp(master).extract(MARK).raw().toBuffer({ resolveWithObject: true });

/** Average colour of the crop's border = the navy background behind the mark. */
function borderColour({ data, info }) {
  const { width: w, height: h, channels: c } = info;
  const acc = [0, 0, 0];
  let n = 0;
  for (let x = 0; x < w; x++) {
    for (const y of [0, h - 1]) {
      const i = (y * w + x) * c;
      acc[0] += data[i];
      acc[1] += data[i + 1];
      acc[2] += data[i + 2];
      n++;
    }
  }
  return acc.map((v) => v / n);
}
const bg = borderColour(markCrop);

/**
 * 1-D binary dilation by `r` along one axis. `step` is the stride between neighbours along the axis,
 * `lineStride` the stride between lines (horizontal pass: 1, width — vertical pass: width, 1).
 */
function dilate(src, width, height, r, step, lineStride) {
  const out = new Uint8Array(src.length);
  const [lines, len] = step === 1 ? [height, width] : [width, height];
  for (let l = 0; l < lines; l++) {
    const base = l * lineStride;
    let last = -Infinity;
    for (let k = 0; k < len; k++) {
      if (src[base + k * step]) last = k;
      if (k - last <= r) out[base + k * step] = 1;
    }
    last = Infinity;
    for (let k = len - 1; k >= 0; k--) {
      if (src[base + k * step]) last = k;
      if (last - k <= r) out[base + k * step] = 1;
    }
  }
  return out;
}

/**
 * Background removal: alpha from how far a pixel is from the navy backdrop (the faint guide grid
 * stays below the threshold), then un-blend the backdrop so edges keep their true blue.
 */
function knockOut({ data, info }) {
  const { width, height, channels } = info;
  const out = Buffer.alloc(width * height * 4);
  const bgLum = (bg[0] + bg[1] + bg[2]) / 3;

  // Mask of clearly-mark pixels, dilated by R px: shadows only count right next to the mark,
  // so the backdrop's own darker gradient doesn't leak in as speckle.
  const R = 14;
  const solid = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p++) {
    const i = p * channels;
    solid[p] = Math.hypot(data[i] - bg[0], data[i + 1] - bg[1], data[i + 2] - bg[2]) > 70 ? 1 : 0;
  }
  // Morphological closing (dilate, then erode = dilate the inverse): fills only narrow gaps *between*
  // ribbons — exactly where the overlap shadows are — and never the outside edge of the mark.
  const grow = (m) => dilate(dilate(m, width, height, R, 1, width), width, height, R, width, 1);
  const invert = (m) => m.map((v) => 1 - v);
  const near = invert(grow(invert(grow(solid))));

  for (let p = 0; p < width * height; p++) {
    const i = p * channels;
    const o = p * 4;
    const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
    if (lum < bgLum - 3) {
      if (!near[p]) continue;
      // Darker than the backdrop: the drop shadows where the ribbons overlap. Keep them as shadow.
      const a = Math.min(1, (bgLum - lum) / 12) * 0.85;
      out[o] = 4;
      out[o + 1] = 8;
      out[o + 2] = 26;
      out[o + 3] = Math.round(a * 255);
      continue;
    }
    // Lighter/bluer than the backdrop: the mark. The faint guide grid sits below the 45 threshold.
    const d = Math.hypot(data[i] - bg[0], data[i + 1] - bg[1], data[i + 2] - bg[2]);
    const a = Math.min(1, Math.max(0, (d - 45) / 55));
    for (let k = 0; k < 3; k++) {
      out[o + k] = a > 0 ? Math.min(255, Math.max(0, Math.round((data[i + k] - bg[k] * (1 - a)) / a))) : 0;
    }
    out[o + 3] = Math.round(a * 255);
  }
  return sharp(out, { raw: { width, height, channels: 4 } });
}

// Transparent mark, trimmed and centred on a square canvas.
const markPng = await knockOut(markCrop).png().toBuffer();
const trimmed = await sharp(markPng).trim({ threshold: 1 }).toBuffer({ resolveWithObject: true });
const side = Math.max(trimmed.info.width, trimmed.info.height);
const square = await sharp({ create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: trimmed.data, gravity: 'center' }])
  .png()
  .toBuffer();
await sharp(square).resize(512, 512).png({ compressionLevel: 9, palette: true, quality: 95, effort: 10 }).toFile(join(brand, 'trigon-mark.png'));

await sharp(master).extract(LOCKUP).resize({ width: 900 }).jpeg({ quality: 88, mozjpeg: true }).toFile(join(brand, 'trigon-lockup.jpg'));

const navy = { r: Math.round(bg[0]), g: Math.round(bg[1]), b: Math.round(bg[2]), alpha: 1 };

/** Navy tile with the mark at `scale` of its width, optionally with rounded corners. */
async function tile(size, scale, radius = 0) {
  const mark = await sharp(square).resize(Math.round(size * scale)).toBuffer();
  let img = sharp({ create: { width: size, height: size, channels: 4, background: navy } }).composite([
    { input: mark, gravity: 'center' },
  ]);
  if (radius) {
    const mask = Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="#fff"/></svg>`);
    img = sharp(await img.png().toBuffer()).composite([{ input: mask, blend: 'dest-in' }]);
  }
  return img.png().toBuffer();
}

await writeFile(join(icons, 'icon-192.png'), await tile(192, 0.74, 42));
await writeFile(join(icons, 'icon-512.png'), await tile(512, 0.74, 112));
await writeFile(join(icons, 'maskable-512.png'), await tile(512, 0.62));
await writeFile(join(icons, 'apple-touch-icon.png'), await tile(180, 0.72));

/** Minimal ICO container holding PNG frames. */
async function ico(sizes) {
  // Small sizes get a slightly larger mark so the triangle stays legible.
  const frames = await Promise.all(sizes.map((s) => tile(s, s <= 32 ? 0.9 : 0.8, Math.round(s * 0.2))));
  const header = Buffer.alloc(6 + 16 * frames.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach((data, i) => {
    const e = 6 + i * 16;
    header.writeUInt8(sizes[i], e);
    header.writeUInt8(sizes[i], e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...frames]);
}
await writeFile(join(root, 'src', 'app', 'favicon.ico'), await ico([16, 32, 48, 64]));

console.log('Brand assets written. Background colour:', navy);
