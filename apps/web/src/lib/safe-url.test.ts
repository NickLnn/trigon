import assert from 'node:assert/strict';
import { test } from 'node:test';
import { embedTarget, safeHref, safeImageSrc, webUrl } from './safe-url';

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

test('pasted and imported links keep only http(s) and mailto targets', () => {
  assert.equal(safeHref('/docs/a', 'https://example.com/x/'), 'https://example.com/docs/a');
  assert.equal(safeHref('mailto:a@example.com'), 'mailto:a@example.com');
  for (const bad of ['javascript:alert(1)', ' javascript:alert(1)', 'data:text/html,x', 'vbscript:x', 'file:///etc/passwd']) assert.equal(safeHref(bad, 'https://example.com/'), null, bad);
  // A hostile clipboard can claim any "source URL" as base; relative links then resolve to nothing usable.
  assert.equal(safeHref('x', 'javascript:alert(1)//'), null);
});

test('pasted images keep only http(s) and inline image data', () => {
  assert.equal(safeImageSrc('a.png', 'https://example.com/p/'), 'https://example.com/p/a.png');
  assert.equal(safeImageSrc('data:image/png;base64,iVBOR'), 'data:image/png;base64,iVBOR');
  for (const bad of ['javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'file:///c:/x.png', 'blob:https://x/1']) assert.equal(safeImageSrc(bad, 'https://example.com/'), null, bad);
});
