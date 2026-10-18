import assert from 'node:assert/strict';
import { test } from 'node:test';
import { embedTarget, webUrl } from './safe-url';

test('only absolute http(s) URLs are used for links and thumbnails', () => {
  assert.equal(webUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>', '/api/files/x/content', 'vbscript:x', '', null, undefined]) {
    assert.equal(webUrl(bad), null, String(bad));
  }
});

test('embed players come from the allow-listed providers, never from stored attributes', () => {
  assert.equal(embedTarget('https://www.youtube.com/watch?v=dQw4w9WgXcQ').embedUrl, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.match(embedTarget('https://vimeo.com/76979871').embedUrl!, /^https:\/\/player\.vimeo\.com\//);
  // Same-origin uploads, other sites and look-alike hosts get no iframe at all.
  for (const url of ['https://wiki.example.com/api/files/0f1e2d3c-4b5a-6978-8a9b-acbdcedf0102/content', 'https://evil.example/player', 'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ', 'javascript:alert(1)']) {
    assert.equal(embedTarget(url).embedUrl, null, url);
  }
  assert.equal(embedTarget('javascript:alert(1)').url, null);
});
