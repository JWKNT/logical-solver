'use strict';

const assert = require('assert');
const S = require('../js/sums-stepper.js');
const { sumsProgressSnapshot } = require('./helpers/sums-progress.js');

{
  const st = S.makeSumsState(2, 2, 3);
  let previous = sumsProgressSnapshot(st);
  const expectProgress = change => {
    change();
    const next = sumsProgressSnapshot(st);
    assert.notStrictEqual(next, previous, 'retained deduction facts must count as progress');
    previous = next;
  };
  expectProgress(() => S.filterCand(st, 0, ~1));
  expectProgress(() => S.filterLetter(st, 0, 6));
  expectProgress(() => { st.baseCand = new Set([7, 11, 13]); });
  expectProgress(() => S.filterBase(st, new Set([7, 11])));
  expectProgress(() => st.shapeRelations.push({ a: 0, av: 0, b: 1, bv: 0, reason: 'a proof' }));
  expectProgress(() => { st.lineShapeDomains['row:0'] = [1, 2, 3]; });
  expectProgress(() => { st.lineShapeDomains['row:0'] = [1, 2]; });
  assert.strictEqual(sumsProgressSnapshot(st), previous, 'a repeated state is still a no-op');
}

{
  const st = S.makeSumsState(2, 2, 3);
  st.baseCand = new Set([7, 11]);
  st.shapeRelations = [
    { a: 0, av: 0, b: 1, bv: 0, reason: 'first proof' },
    { a: 2, av: 1, b: 3, bv: 1, reason: 'second proof' }
  ];
  st.lineShapeDomains = { 'row:0': [1, 2], 'col:1': [2, 3] };
  const before = sumsProgressSnapshot(st);
  st.baseCand = new Set([11, 7]);
  st.shapeRelations.reverse();
  st.shapeRelations[0].reason = 'the same implication, reworded';
  st.shapeRelations.push({ ...st.shapeRelations[0] });
  st.lineShapeDomains = { 'col:1': [3, 2, 3], 'row:0': [2, 1], 'row:1': [] };
  st.__lineCache = new Map([['cached analysis', { anything: true }]]);
  st.__lineCaseMiss = new Set(['an already tried hypothesis']);
  st.__baseNarrated = true;
  assert.strictEqual(sumsProgressSnapshot(st), before,
    'order, duplicates, narration, empty domains, and cache churn must not hide a no-op');
}

// Captured from the existing randomized battery (seed 101). Each is a real
// step that adds useful knowledge while leaving every cell/letter mask alone.
const fixtures = [
  {
    rule: 'Checkerboard transfer', R: 4, C: 6, D: 7, shaped: true,
    clues: {
      rows: [[25], [4, 11], [12], [5, 10]],
      cols: [[5, 10], [5], [3, 6], [1, 9], [16], [12]]
    },
    cand: [254, 254, 254, 254, 254, 254, 254, 255, 255, 255, 254, 254,
      1, 1, 255, 255, 254, 254, 254, 1, 255, 254, 254, 254]
  },
  {
    rule: 'Adjacent line layouts', R: 5, C: 4, D: 9, shaped: true,
    clues: {
      rows: [[22], [15], [11], [2], [4]],
      cols: [[18], [17], [2, 6], [4, 7]]
    },
    cand: [1022, 1022, 102, 254, 1022, 1022, 35, 255, 1022, 1022,
      69, 47, 5, 5, 5, 5, 27, 27, 1, 27]
  },
  {
    rule: 'Line pattern cases', R: 5, C: 5, D: 6,
    clues: {
      rows: [['3'], ['3', '1B'], ['1A'], ['8'], ['10']],
      cols: [['8', 'A'], ['1A'], ['10'], ['12'], ['B']]
    },
    cand: [1, 1, 11, 5, 3, 8, 1, 48, 64, 55, 32, 8, 4, 16, 1,
      1, 32, 10, 5, 1, 16, 64, 1, 1, 1],
    letters: { A: 16, B: 46 },
    domains: { 'col:3': [7, 14], 'col:4': [1, 2, 3] }
  }
];

for (const fixture of fixtures) {
  const st = S.makeSumsState(fixture.R, fixture.C, fixture.D);
  st.cand.set(fixture.cand);
  if (fixture.shaped) Object.assign(st.variants,
    { blankConn: true, no22blank: true, asc: true, reach: true });
  for (const [letter, mask] of Object.entries(fixture.letters || {})) {
    st.letterCand[letter.charCodeAt(0) - 65] = mask;
  }
  st.lineShapeDomains = Object.fromEntries(Object.entries(fixture.domains || {})
    .map(([key, values]) => [key, values.slice()]));
  const masksBefore = JSON.stringify([Array.from(st.cand), Array.from(st.letterCand)]);
  let previous = sumsProgressSnapshot(st);
  const move = S.takeSumsStep(st, fixture.clues);
  assert(move && !move.contradiction);
  assert.strictEqual(move.rule, fixture.rule);
  assert.strictEqual(JSON.stringify([Array.from(st.cand), Array.from(st.letterCand)]), masksBefore,
    fixture.rule + ' exercises progress without a cell/letter-mask change');
  const next = sumsProgressSnapshot(st);
  assert.notStrictEqual(next, previous, fixture.rule + ' retains a new deduction fact');

  // Continue past the formerly rejected step: all later deductions must make
  // progress, and the ladder must eventually stop rather than repeat forever.
  previous = next;
  const seen = new Set([previous]);
  let stopped = false;
  for (let i = 0; i < 100; i++) {
    const following = S.takeSumsStep(st, fixture.clues);
    if (!following) { stopped = true; break; }
    assert(!following.contradiction, fixture.rule + ': ' + following.text);
    const progress = sumsProgressSnapshot(st);
    assert.notStrictEqual(progress, previous, 'a genuine no-op must still fail');
    assert(!seen.has(progress), 'a repeated semantic state must still fail');
    seen.add(progress);
    previous = progress;
  }
  assert(stopped, fixture.rule + ' must finish or stop normally within 100 steps');
  console.log('ok: ' + fixture.rule + ' counts semantic progress and terminates');
}

console.log('ALL SUMS PROGRESS TESTS PASSED');
