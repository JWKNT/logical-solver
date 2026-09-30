const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('split and offline solvers keep native Home navigation', () => {
  for (const file of ['index.html', 'dist/ubahn-solver.html']) {
    const html = read(file);
    assert.equal((html.match(/class="site-home-dock"/g) || []).length, 1, file);
    assert.match(html, /<body[^>]*>\s*<nav class="site-home-dock" aria-label="Site">/, file);
    assert.match(html, /class="site-home" href="https:\/\/jehlp\.net\/" aria-label="Home · jehlp.net"/, file);
  }
});

test('offline export embeds the Home symbol and all shared presentation', () => {
  const html = read('dist/ubahn-solver.html');
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc=|<link\b[^>]*\brel="stylesheet"|url\(["']?(?:https?:|icons\/)/i);
  assert.match(html, /a\.site-home::before\s*\{[^}]*data:image\/svg\+xml/);
  assert.match(read('build.js'), /'theme-dial-dark\.svg', 'theme-dial-light\.svg', 'home\.svg'/);
});


test('offline export includes the narrow-screen Home edge strip', () => {
  const html = read('dist/ubahn-solver.html');
  assert.match(html, /@media \(max-width: 42rem\)\s*\{\s*\.site-home-dock\s*\{[^}]*width: 100%;[^}]*min-height: calc\(3\.5rem \+ env\(safe-area-inset-bottom, 0px\)\)/);
  const online = read('index.html');
  assert.ok(online.includes('base.css?v=20260930-home2'));
  assert.ok(online.includes('theme.js?v=20260930-home3'));
});


test('offline export retains shared focus clearance behind the Home dock', () => {
  const html = read('dist/ubahn-solver.html');
  assert.match(html, /document\.addEventListener\("focusin", keepFocusedControlClear\)/);
  assert.match(html, /window\.scrollBy\(\{ top: shift, behavior: "instant" \}\)/);
});


test('local dark links leave the shared Home ink color intact', () => {
  const css = read('css/style.css');
  assert.match(css, /html\.dark a:not\(\.site-home\) \{ color: var\(--blue\); \}/);
  assert.doesNotMatch(css, /html\.dark a\s*\{[^}]*color: var\(--blue\)/);
  assert.match(read('index.html'), /css\/style\.css\?v=20260930-home3/);
});
