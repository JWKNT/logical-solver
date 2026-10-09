const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('all four deduction lists share the responsive column rules', () => {
  const html = read('index.html');
  const css = read('css/style.css');
  assert.equal((html.match(/<aside class="strategies-side"/g) || []).length, 4);
  for (const id of ['stratList', 'sumsStrats', 'a38Strats', 'caveStrats']) {
    assert.match(html, new RegExp(`<ol id="${id}"></ol>`));
  }
  assert.match(css, /\.board-row\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);/);
  assert.match(css, /\.strategies ol\s*\{[^}]*columns: 2 12rem;/);
  assert.match(css, /@media \(max-width: 650px\)\s*\{[\s\S]*?\.strategies ol\s*\{ column-count: 1; \}/);
  assert.match(css, /\.strategies li\s*\{[^}]*break-inside: avoid;/);
  assert.match(css, /\.strategies li\.variant-bar\s*\{[^}]*break-after: avoid-column;/);
});

test('offline export contains the same local layout and no remote runtime assets', () => {
  const offline = read('dist/ubahn-solver.html');
  assert.ok(offline.includes(read('css/style.css')));
  assert.doesNotMatch(offline, /<script\b[^>]*\bsrc=|<link\b[^>]*\brel="stylesheet"|<img\b[^>]*\bsrc="https?:|url\(["']?(?:https?:|icons\/)/i);
});
