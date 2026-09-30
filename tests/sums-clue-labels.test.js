'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../js/sums-app.js'), 'utf8');
const definition = source.match(/const slotBox = (\(prefix, vertical, lineNumber\) => \{[\s\S]*?\n  \});/);
assert.ok(definition, 'clue rendering helper exists');
for (const G of [1, 3, 8]) for (const alien of [false, true]) {
  const slotBox = vm.runInNewContext(definition[1], { G, $: () => ({ checked: alien }) });
  for (const vertical of [false, true]) for (const number of [1, 16]) {
    const prefix = (vertical ? 'sumsCol' : 'sumsRow') + (number - 1);
    const html = slotBox(prefix, vertical, number);
    assert.equal((html.match(/<input /g) || []).length, G);
    for (let g = 0; g < G; g++) {
      assert.ok(html.includes(`id="${prefix}_${g}" aria-label="${vertical ? 'Column' : 'Row'} ${number}, group ${g + 1} sum"`));
    }
    assert.ok(html.includes(`maxlength="${alien ? 12 : 3}"`));
  }
}
assert.ok(source.includes("slotBox('sumsCol' + c, true, c + 1)"));
assert.ok(source.includes("slotBox('sumsRow' + r, false, r + 1)"));
console.log('Japanese Sums clues have unique row/column and group labels at every supported scale');
