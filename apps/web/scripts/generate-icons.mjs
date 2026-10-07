// Renders the PWA / Apple touch icons from public/icons/icon.svg.  Run: npm run icons -w @trigon/web
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const svg = await readFile(join(dir, 'icon.svg'));

const render = (size, file) => sharp(svg, { density: 384 }).resize(size, size).png().toFile(join(dir, file));

await render(192, 'icon-192.png');
await render(512, 'icon-512.png');
// iOS adds its own rounded mask; give it a full-bleed square.
await sharp(svg, { density: 384 }).resize(180, 180).flatten({ background: '#0A5BE0' }).png().toFile(join(dir, 'apple-touch-icon.png'));
// Maskable: keep the mark inside the 80% safe zone on a full-bleed background.
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#0A5BE0' } })
  .composite([{ input: await sharp(svg, { density: 384 }).resize(400, 400).png().toBuffer(), gravity: 'center' }])
  .png()
  .toFile(join(dir, 'maskable-512.png'));

console.log('Icons written to', dir);
