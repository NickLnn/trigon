// Renders every raster icon from the SVG sources.  Run: npm run icons -w @trigon/web
//   public/icons/icon.svg  → icon-192/512.png, apple-touch-icon.png, maskable-512.png, src/app/favicon.ico
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'public', 'icons');
const tile = await readFile(join(dir, 'icon.svg'), 'utf8');

// Same artwork without the rounded corners: iOS and Android apply their own mask.
const fullBleed = tile.replace('rx="134"', 'rx="0"');
// Maskable icons must keep the mark inside the central 80% safe zone.
const maskable = fullBleed
  .replace('viewBox="-40 -40 592 592"', 'viewBox="-120 -120 752 752"')
  .replace('<rect x="-40" y="-40" width="592" height="592" rx="0"', '<rect x="-120" y="-120" width="752" height="752" rx="0"');

const png = (svg, size) => sharp(Buffer.from(svg), { density: 600 }).resize(size, size).png().toBuffer();

await writeFile(join(dir, 'icon-192.png'), await png(tile, 192));
await writeFile(join(dir, 'icon-512.png'), await png(tile, 512));
await writeFile(join(dir, 'apple-touch-icon.png'), await png(fullBleed, 180));
await writeFile(join(dir, 'maskable-512.png'), await png(maskable, 512));

/** Minimal ICO container holding PNG frames (supported by every current browser and Windows). */
async function ico(svg, sizes) {
  const frames = await Promise.all(sizes.map((s) => png(svg, s)));
  const header = Buffer.alloc(6 + 16 * frames.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach((data, i) => {
    const e = 6 + i * 16;
    header.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], e);
    header.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], e + 1);
    header.writeUInt16LE(1, e + 4); // colour planes
    header.writeUInt16LE(32, e + 6); // bits per pixel
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...frames]);
}

await writeFile(join(root, 'src', 'app', 'favicon.ico'), await ico(tile, [16, 32, 48, 64]));
console.log('Icons written');
