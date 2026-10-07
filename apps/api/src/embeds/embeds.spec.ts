import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchEmbedProvider } from '@trigon/shared';
import { readMeta } from './embeds.service';

test('matches YouTube watch, short and youtu.be URLs', () => {
  assert.equal(matchEmbedProvider('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.embedUrl, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(matchEmbedProvider('https://youtu.be/dQw4w9WgXcQ?t=42')?.embedUrl, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=42');
  assert.equal(matchEmbedProvider('https://youtube.com/shorts/abcDEF12345')?.id, 'abcDEF12345');
});

test('matches Vimeo and Loom', () => {
  assert.equal(matchEmbedProvider('https://vimeo.com/76979871')?.embedUrl, 'https://player.vimeo.com/video/76979871');
  assert.equal(matchEmbedProvider('https://vimeo.com/76979871/abcdef1234')?.embedUrl, 'https://player.vimeo.com/video/76979871?h=abcdef1234');
  assert.equal(matchEmbedProvider('https://www.loom.com/share/0123456789abcdef0123456789abcdef')?.provider, 'loom');
});

test('ignores other URLs', () => {
  assert.equal(matchEmbedProvider('https://example.com/watch?v=x'), null);
  assert.equal(matchEmbedProvider('not a url'), null);
});

test('reads Open Graph tags in either attribute order', () => {
  const html = `<meta property="og:title" content="Hello &amp; welcome"><meta content="Desc" name="description">`;
  assert.equal(readMeta(html, ['og:title']), 'Hello & welcome');
  assert.equal(readMeta(html, ['og:description', 'description']), 'Desc');
});
