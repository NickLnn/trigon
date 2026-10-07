import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectLanguage, fromVsCodeMode, scoreCode } from './code-detect';

const TS = `import { useState } from 'react';

export function Counter({ start = 0 }: { start?: number }) {
  const [n, setN] = useState(start);
  return <button onClick={() => setN(n + 1)}>{n}</button>;
}`;

const PY = `def fib(n):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a

print(fib(10))`;

const SQL = `SELECT u.id, u.email, count(d.id) AS docs
FROM users u
LEFT JOIN documents d ON d.created_by_id = u.id
WHERE u.active = true
GROUP BY u.id;`;

const PROSE = `Trigon is a collaborative knowledge platform. It lets teams write, organise and find documentation.
Pages live inside spaces and can be shared with groups synced from your directory.`;

test('classifies code as code', () => {
  assert.ok(scoreCode(TS).isCode, 'typescript');
  assert.ok(scoreCode(PY).isCode, 'python');
  assert.ok(scoreCode(SQL).isCode, 'sql');
  assert.ok(scoreCode('{\n  "name": "trigon",\n  "private": true\n}').isCode, 'json');
});

test('leaves prose alone', () => {
  assert.equal(scoreCode(PROSE).isCode, false);
  assert.equal(scoreCode('Meeting notes for Tuesday').isCode, false);
  assert.equal(scoreCode('Remember to call Anna (re: budget) tomorrow.').isCode, false);
});

test('single-line code needs a strong signal', () => {
  assert.ok(scoreCode('npm install @tiptap/react yjs').isCode);
  assert.ok(scoreCode('$ docker compose up -d').isCode);
});

test('detects languages', () => {
  assert.equal(detectLanguage('{"a": 1, "b": [true, null]}'), 'json');
  assert.equal(detectLanguage(PY), 'python');
  assert.equal(detectLanguage(SQL), 'sql');
  assert.equal(detectLanguage('FROM node:22-alpine\nWORKDIR /app\nRUN npm ci'), 'dockerfile');
  assert.equal(detectLanguage('$ git push origin dev'), 'bash');
});

test('maps VS Code clipboard modes', () => {
  assert.equal(fromVsCodeMode('typescriptreact'), 'typescript');
  assert.equal(fromVsCodeMode('python'), 'python');
  assert.equal(fromVsCodeMode('plaintext'), null);
});
