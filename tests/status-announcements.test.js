const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const script = read('js/status-announcements.js');
const ids = ['status', 'sumsStatus', 'a38Status', 'caveStatus'];

function harness() {
  const timers = new Map(), observers = new Map(), sources = new Map();
  let nextTimer = 0;
  const lives = ids.map(id => {
    sources.set(id, { textContent: '', children: [], hidden: false, closest() { return this.hidden; } });
    let text = '', writes = 0;
    return { dataset: { statusSource: id }, get textContent() { return text; },
      set textContent(value) { text = value; writes++; }, get writes() { return writes; } };
  });
  class MutationObserver {
    constructor(callback) { this.callback = callback; }
    observe(source, options) { observers.set(source, { callback: this.callback, options }); }
  }
  vm.runInNewContext(script, {
    window: { MutationObserver }, MutationObserver,
    document: { querySelectorAll: () => lives, getElementById: id => sources.get(id) },
    setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout: id => timers.delete(id)
  });
  return {
    lives, sources, observers, timers,
    update(id, text, children = []) {
      const source = sources.get(id);
      source.textContent = text; source.children = children;
      observers.get(source).callback();
    },
    flush() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback()); }
  };
}

test('each split and offline puzzle has its own initially empty polite status region', () => {
  for (const file of ['index.html', 'dist/ubahn-solver.html']) {
    const html = read(file);
    const liveTags = html.match(/<div\b[^>]*data-status-source="[^"]+"[^>]*><\/div>/g) || [];
    assert.equal(liveTags.length, 4, file);
    for (const id of ids) {
      const tag = liveTags.find(tag => tag.includes(`data-status-source="${id}"`));
      assert.ok(tag, `${file}: ${id}`);
      for (const attr of ['class="sr-only"', 'role="status"', 'aria-live="polite"', 'aria-atomic="true"']) assert.ok(tag.includes(attr), attr);
      assert.match(tag, /aria-label="[^"]+ solver status"/);
      assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1);
      assert.ok(html.includes(`<div class="status" id="${id}">`), 'full explanations stay outside the live region');
    }
  }
});

test('build embeds the exact helper without an external runtime dependency', () => {
  assert.ok(read('dist/ubahn-solver.html').includes(script));
  assert.match(read('index.html'), /<script src="js\/status-announcements\.js\?v=20261002-status"><\/script>/);
  assert.doesNotMatch(read('dist/ubahn-solver.html'), /<script\b[^>]*\bsrc=/);
});

test('all modes announce short solve, candidates, errors, reset and undo updates', () => {
  const h = harness();
  for (const id of ids) {
    for (const text of ['Solving…', 'Solved. Multiple solutions exist.', 'True candidates proved. 15 solutions in total.', 'No solution exists.', 'Solver worker failed: fixture error', 'Search cancelled.', 'Marks reset; clues kept.', 'Reverted to before step 2.']) {
      h.update(id, text); h.flush();
      assert.equal(h.lives[ids.indexOf(id)].textContent, text);
    }
  }
});

test('named steps summarize the rule and final verdict without reading proof chains', () => {
  const h = harness();
  for (const [index, id] of ids.entries()) {
    const verdict = index % 2 ? ' Contradiction — check the clues.' : ' Solved!';
    const children = [{ textContent: 'Long proof'.repeat(500), matches: () => false }, { textContent: verdict, matches: () => true }];
    h.update(id, 'Step 12 — Test deduction: ' + 'Long proof'.repeat(500) + verdict, children);
    h.flush();
    assert.equal(h.lives[index].textContent, `Step 12 — Test deduction. ${verdict.trim()} Explanation below.`);
    assert.ok(h.sources.get(id).textContent.includes('Long proof'), 'visible proof remains unchanged');
  }
});

test('rapid steps coalesce to the latest update and identical summaries do not repeat', () => {
  const h = harness();
  for (let i = 1; i <= 100; i++) h.update('caveStatus', `Step ${i} — Number cell: details`);
  assert.equal(h.timers.size, 1);
  assert.equal(h.lives[3].writes, 0);
  h.flush();
  assert.equal(h.lives[3].textContent, 'Step 100 — Number cell. Explanation below.');
  h.update('caveStatus', 'Step 100 — Number cell: details changed but same summary');
  h.flush();
  assert.equal(h.lives[3].writes, 1);
});

test('hidden puzzles and pending updates after switching tabs stay quiet', () => {
  const h = harness();
  h.update('caveStatus', 'Solving…'); h.flush();
  assert.equal(h.lives[3].textContent, 'Solving…');
  h.update('caveStatus', 'Thinking…');
  h.sources.get('caveStatus').hidden = true;
  h.flush();
  assert.equal(h.lives[3].textContent, '');
  h.update('caveStatus', 'Solved!'); h.flush();
  assert.equal(h.lives[3].textContent, '');
  h.sources.get('caveStatus').hidden = false;
  assert.equal(h.lives[3].textContent, '', 'showing the tab cannot expose the stale Solving message');
  h.update('caveStatus', 'Marks reset; clues kept.'); h.flush();
  assert.equal(h.lives[3].textContent, 'Marks reset; clues kept.');
});

test('shortening a long result preserves its final search-limit warning', () => {
  const h = harness();
  h.update('sumsStatus', 'Solved. Letters: ' + 'X=10, '.repeat(70) + '(search truncated)',
    [{ textContent: '(search truncated)', matches: selector => selector.includes('.warn') }]);
  h.flush();
  assert.match(h.lives[1].textContent, /\(search truncated\)/);
  assert.equal(h.lives[1].textContent.split('(search truncated)').length, 2);
  assert.ok(h.lives[1].textContent.length <= 320);
  const error = 'Solver error: ' + 'a detailed diagnostic '.repeat(100);
  h.update('a38Status', error, [{ textContent: error, matches: () => true }]); h.flush();
  assert.match(h.lives[2].textContent, /^Solver error:/);
  assert.ok(h.lives[2].textContent.length <= 320);
});

test('long unstructured status is bounded and text-node replacements are observed', () => {
  const h = harness();
  h.update('status', 'A long status message. '.repeat(100)); h.flush();
  assert.ok(h.lives[0].textContent.length <= 320);
  assert.match(h.lives[0].textContent, /Full status below\.$/);
  for (const { options } of h.observers.values()) {
    assert.equal(options.childList, true);
    assert.equal(options.characterData, true);
    assert.equal(options.subtree, true);
  }
});

test('missing optional observer support does not stop solver initialization', () => {
  assert.doesNotThrow(() => vm.runInNewContext(script, { window: {} }));
});
