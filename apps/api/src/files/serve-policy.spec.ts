import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileResponseHeaders } from './serve-policy';

test('uploaded HTML, XML and scripts are never served as active content', () => {
  for (const mime of ['text/html', 'application/xhtml+xml', 'text/javascript', 'application/javascript', 'application/ecmascript', 'text/xml', 'application/xml', 'TEXT/HTML; charset=utf-8']) {
    const h = fileResponseHeaders(mime, 'evil.html');
    assert.equal(h['Content-Type'], 'application/octet-stream', mime);
    assert.match(h['Content-Disposition'], /^attachment;/, mime);
    assert.match(h['Content-Security-Policy'], /sandbox/, mime);
    assert.equal(h['X-Content-Type-Options'], 'nosniff');
  }
});

test('SVG keeps its type for <img> previews but downloads, sandboxed, when opened', () => {
  const h = fileResponseHeaders('image/svg+xml', 'logo.svg');
  assert.equal(h['Content-Type'], 'image/svg+xml');
  assert.match(h['Content-Disposition'], /^attachment;/);
  assert.match(h['Content-Security-Policy'], /sandbox/);
});

test('PDFs, images and plain text are shown inline; PDFs keep the browser viewer working', () => {
  const pdf = fileResponseHeaders('application/pdf', 'Runbook.pdf');
  assert.match(pdf['Content-Disposition'], /^inline;/);
  assert.equal(pdf['Content-Security-Policy'], undefined);
  const png = fileResponseHeaders('image/png', 'shot.png');
  assert.match(png['Content-Disposition'], /^inline;/);
  assert.match(png['Content-Security-Policy'], /sandbox/);
  assert.equal(fileResponseHeaders('text/plain', 'notes.txt')['Content-Type'], 'text/plain; charset=utf-8');
  assert.equal(fileResponseHeaders('text/plain', 'a.txt')['Cross-Origin-Resource-Policy'], 'same-origin');
});

test('unknown or missing types download; file names are encoded', () => {
  const h = fileResponseHeaders(null, 'Δοκιμή "x".bin');
  assert.equal(h['Content-Type'], 'application/octet-stream');
  assert.equal(h['Content-Disposition'], `attachment; filename*=UTF-8''${encodeURIComponent('Δοκιμή "x".bin')}`);
  assert.match(fileResponseHeaders('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'a.docx')['Content-Disposition'], /^attachment;/);
});
