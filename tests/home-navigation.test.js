const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('split and offline solvers keep native Home in the existing header', () => {
  for (const file of ['index.html', 'dist/ubahn-solver.html']) {
    const html = read(file);
    assert.equal((html.match(/class="site-home"/g) || []).length, 1, file);
    assert.doesNotMatch(html, /<nav class="site-home-dock"/);
    assert.match(html, /<header class="site-header site-header--identity">[\s\S]*?<span class="site-utility-pair"><a class="site-home"[^>]*aria-label="Home — jehlp.net"[\s\S]*?<\/a><button[^>]*data-theme-toggle/, file);
  }
});

test('offline export embeds all shared utility symbols and presentation', () => {
  const html = read('dist/ubahn-solver.html');
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc=|<link\b[^>]*\brel="stylesheet"|url\(["']?(?:https?:|icons\/)/i);
  assert.match(html, /a\.site-home::before\s*\{[^}]*data:image\/svg\+xml/);
  assert.match(html, /button\.site-search::before\s*\{[^}]*data:image\/svg\+xml/);
  assert.match(read('build.js'), /'theme-dial-dark\.svg', 'theme-dial-light\.svg', 'home-compass\.svg', 'search-slash\.svg'/);
  assert.doesNotMatch(html, /--site-home-clearance|keepFocusedControlClear/);
  assert.ok(read('index.html').includes('base.css?v=20261001-utilities'));
  assert.ok(read('index.html').includes('theme.js?v=20260930-header-home'));
});

test('local dark links leave the shared Home ink color intact', () => {
  const css = read('css/style.css');
  assert.match(css, /html\.dark a:not\(\.site-home\) \{ color: var\(--blue\); \}/);
  assert.doesNotMatch(css, /html\.dark a\s*\{[^}]*color: var\(--blue\)/);
});

test('local workspace focus styling leaves the shared utility focus ring intact', () => {
  const css = read('css/style.css');
  assert.match(css, /button:not\(\[data-theme-toggle\]\):focus-visible\s*\{/);
  assert.doesNotMatch(css, /(?:^|\n)\s*button:focus-visible\s*\{/);
});

test('the Solver keeps scrolling tabs beneath the shared utility lane without changing workspace breakpoints', () => {
  const css = read('css/style.css');
  const header = css.split('@media (max-width: 42rem) {')[1]?.split('@media (max-width: 650px) {')[0];
  assert.ok(header, 'header has the shared 42rem breakpoint');
  assert.doesNotMatch(header, /padding-top:|grid-template-columns:/);
  assert.match(header, /\.site-header\.site-header--identity \.tabs \{ width: 100%;[^}]*flex-wrap: nowrap;/);
  assert.match(header, /\.site-actions \{ height: 0; \}/);
  assert.doesNotMatch(header, /main\s*\{|\.toolbar/);
  assert.match(css, /@media \(max-width: 650px\) \{\s*main \{ padding-inline: 14px; \}/);
  assert.ok(read('index.html').includes('css/style.css?v=20261009-deduction-columns'));
  assert.ok(read('dist/ubahn-solver.html').includes(header));
});


test('offline export preserves touch utility alignment', () => {
  const touch = read('dist/ubahn-solver.html').split('@media (pointer: coarse) {')[1].split('@media (prefers-reduced-motion: reduce)')[0];
  assert.match(touch, /\.site-header nav a:not\(\.site-home\), \.site-nav a:not\(\.site-home\)/);
  assert.doesNotMatch(touch, /\.site-header nav a\s*[,\{]|\.site-nav a\s*[,\{]/);
});


test('offline header uses the shared utility fallback tracks', () => {
  assert.match(read('dist/ubahn-solver.html'), /a\.site-home,\s*\[data-theme-toggle\]\.theme-toggle,\s*button\.site-search \{\s*grid-template-rows: minmax\(0, 1fr\);\s*grid-auto-rows: 0;/);
});


test('split and offline headers inherit the stable shared frame', () => {
  const local = read('css/style.css');
  const shared = read('dist/ubahn-solver.html');
  assert.doesNotMatch(local, /header\.site-header(?:\.site-header--identity)?\s*\{[^}]*\b(?:width|padding-inline|padding-top):/);
  assert.match(shared, /--site-frame-page: 74rem;/);
  assert.match(shared, /scrollbar-gutter: stable;/);
  assert.match(shared, /\.site-header \.site-utility-pair \{ position: absolute; top: var\(--site-frame-top\); right: 0;/);
});
