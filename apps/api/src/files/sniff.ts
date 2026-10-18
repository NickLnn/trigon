/**
 * The image type a file really is, from its first bytes — the MIME type a browser sends is whatever the
 * uploader says. Returns null for anything that isn't one of the image formats Trigon accepts.
 */
export function sniffImage(buf: Buffer): string | null {
  const at = (offset: number, ...bytes: number[]) => bytes.every((b, i) => buf[offset + i] === b);
  const ascii = (offset: number, text: string) => buf.toString('latin1', offset, offset + text.length) === text;
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'image/gif';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  if (ascii(4, 'ftyp') && /^(avif|avis)$/.test(buf.toString('latin1', 8, 12))) return 'image/avif';
  if (at(0, 0x00, 0x00, 0x01, 0x00)) return 'image/x-icon';
  // SVG is text: an <svg> root near the start (after an optional XML declaration, comments or BOM).
  const head = buf.toString('utf8', 0, 2048).replace(/^﻿/, '');
  if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*|<!DOCTYPE\s+svg[^>]*>\s*)*<svg[\s>]/i.test(head)) return 'image/svg+xml';
  return null;
}
