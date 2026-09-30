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

test('offline export embeds the abstract Home emblem and all shared presentation', () => {
  const html = read('dist/ubahn-solver.html');
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc=|<link\b[^>]*\brel="stylesheet"|url\(["']?(?:https?:|icons\/)/i);
  assert.match(html, /a\.site-home::before\s*\{[^}]*data:image\/svg\+xml/);
  assert.match(read('build.js'), /'theme-dial-dark\.svg', 'theme-dial-light\.svg', 'home-emblem\.svg'/);
  assert.doesNotMatch(html, /--site-home-clearance|keepFocusedControlClear/);
  for (const asset of ['base.css', 'theme.js']) assert.ok(read('index.html').includes(`${asset}?v=20260930-header-home`));
});

test('local dark links leave the shared Home ink color intact', () => {
  const css = read('css/style.css');
  assert.match(css, /html\.dark a:not\(\.site-home\) \{ color: var\(--blue\); \}/);
  assert.doesNotMatch(css, /html\.dark a\s*\{[^}]*color: var\(--blue\)/);
});
