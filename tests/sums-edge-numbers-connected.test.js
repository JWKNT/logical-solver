'use strict';

const assert = require('assert');
const S = require('../js/sums-stepper.js');

// User-supplied 11x11: ordinary 1-9 Japanese Sums, ascending clues,
// numbers connected, and every shaded component touching the edge.
const PUZZLE = {
  rows: [
    [5, '#', '#', 7], ['#', 8, '?', '1?'], ['2?', '#'],
    [7, '#', '#', 8, '#'], ['#', 3, '#', 8], [5, '#', 25],
    [5, '#', '?2'], [6, '#', '?'], null, [8, '#'], ['#', '#', '1?']
  ],
  cols: [
    [7, '#', 20], ['#', '?3'], ['#', 5, 10], [9, '#', 11, '#'],
    ['#', 15, 22], [6, '#', '?0'], ['#', '?'], ['#', 10, '1?'],
    ['#', '?0'], null, [8, '#', '?']
  ]
};

// 0 denotes shading.  Supplied by the puzzle author/user and used as an
// oracle: every human Take-step must preserve the corresponding candidate.
const SOLUTION = [
  [5,0,0,1,6,0,2,3,0,7,0],
  [3,0,1,8,9,0,6,2,0,5,4],
  [4,9,7,0,0,0,0,5,8,6,1],
  [8,0,2,5,0,9,0,7,0,4,3],
  [0,0,0,3,0,4,0,1,0,8,0],
  [9,0,4,6,8,7,0,0,0,3,2],
  [6,0,0,0,5,0,0,9,4,2,7],
  [1,5,0,7,2,0,0,0,6,0,0],
  [0,3,5,4,7,8,1,6,2,0,0],
  [7,1,0,0,0,0,5,4,3,9,8],
  [0,4,0,9,1,6,3,0,5,0,0]
];

function state() {
  const st = S.makeSumsState(11, 11, 9);
  st.noTrial = true;
  Object.assign(st.variants, { asc: true, blankReach: true, numConn: true });
  return st;
}

{
  const st = state();
  const first = S.takeSumsStep(st, PUZZLE);
  assert(first && first.rule === 'Line placements');
  assert.strictEqual(st.cand[3 * 11], st.cand[3 * 11] & ~1, 'R4C1 is a number');
  assert.strictEqual(st.cand[3 * 11 + 10], st.cand[3 * 11 + 10] & ~1, 'R4C11 is a number');

  const second = S.takeSumsStep(st, PUZZLE);
  assert(second && second.rule === 'Checkerboard transfer');
  assert.match(second.text, /three-number run/);
  assert.match(second.text, /whenever one of r4c2/);
  assert.strictEqual(st.shapeRelations.length, 9);
  for (let c = 1; c <= 9; c++) {
    const rel = st.shapeRelations.find(x => x.a === 3 * 11 + c && x.b === 4 * 11 + c);
    assert(rel && rel.av === 0 && rel.bv === 0, `R4C${c + 1} shaded implies R5C${c + 1} shaded`);
  }

  const third = S.takeSumsStep(st, PUZZLE);
  assert(third && third.rule === 'Linked line bounds');
  assert.match(third.text, /total at least 40 \(9\+9\+11\+11\)/);
  assert.match(third.text, /at least 7 number cells/);
  assert.strictEqual(st.cand[3 * 11 + 3] & 1, 0, 'C4 bounds force R4C4 to be a number');
  const fourth = S.takeSumsStep(st, PUZZLE);
  assert(fourth && fourth.rule === 'Sum ceiling');
  assert.match(fourth.text, /Row 1.*largest possible group sum is 7/);
  for (let c = 0; c < 11; c++) assert.strictEqual(st.cand[c] & ((1 << 8) | (1 << 9)), 0, `R1C${c + 1} loses 8 and 9`);

  const fifth = S.takeSumsStep(st, PUZZLE);
  assert(fifth && fifth.rule === 'Cross-line singleton');
  assert.match(fifth.text, /If r2c4 were shaded/);
  assert.match(fifth.text, /r1c4 as a one-cell group/);
  assert.match(fifth.text, /can only be 9/);
  assert.match(fifth.text, /Row 1.*largest possible group sum is 7/);
  assert.strictEqual(st.cand[1 * 11 + 3] & 1, 0, 'R2C4 is forced to be a number');
  assert.strictEqual(st.cand[2 * 11 + 3], 1, 'the same C4 layouts force R3C4 shaded');

  const sixth = S.takeSumsStep(st, PUZZLE);
  assert(sixth && sixth.rule === 'Line placements');
  for (const c of [0, 1, 2, 7]) assert.strictEqual(st.cand[2 * 11 + c] & 1, 0, `R3C${c + 1} is a number`);
  const seventh = S.takeSumsStep(st, PUZZLE);
  assert(seventh && seventh.rule === 'Shaded reach edge');
  assert.match(seventh.text, /r3c4.*r3c5/);
  assert.strictEqual(st.cand[2 * 11 + 4], 1, 'R3C5 is the only shaded route to the edge');
}

{
  // Symmetry regression: unlike the old committed-cell-only connectivity
  // test, Numbers spine uses the number requirement of whole clued lines.
  const st = S.makeSumsState(3, 3, 3);
  st.variants.numConn = true;
  S.filterCand(st, 3, 1); // R2C1 shaded
  S.filterCand(st, 5, 1); // R2C3 shaded
  const clues = { rows: [[1], null, [1]], cols: [null, null, null] };
  const move = S.takeSumsStep(st, clues);
  assert(move && move.rule === 'Numbers spine');
  const move2 = S.takeSumsStep(st, clues);
  assert(move2 && move2.rule === 'Numbers spine');
  assert.strictEqual(st.cand[4] & 1, 0, 'R2C2 is the only bridge between the two required number lines');
}

if (process.argv.includes('--full')) {
  const st = state();
  st.noTrial = false;
  const counts = new Map();
  let move, steps = 0;
  while (steps < 600 && (move = S.takeSumsStep(st, PUZZLE))) {
    steps++;
    assert(!move.contradiction, `step ${steps} (${move.rule}) contradicted the supplied solution: ${move.text}`);
    counts.set(move.rule, (counts.get(move.rule) || 0) + 1);
    for (let r = 0; r < 11; r++) for (let c = 0; c < 11; c++) {
      const v = SOLUTION[r][c];
      assert(st.cand[r * 11 + c] & (1 << v), `step ${steps} (${move.rule}) removed solution value ${v || 'shaded'} from R${r + 1}C${c + 1}`);
    }
  }
  assert(S.sumsComplete(st), `human ladder stalled after ${steps} steps`);
  for (let r = 0; r < 11; r++) for (let c = 0; c < 11; c++) {
    assert.strictEqual(st.cand[r * 11 + c], 1 << SOLUTION[r][c], `wrong final value at R${r + 1}C${c + 1}`);
  }
  console.log(`ok: supplied 11x11 fully solved and oracle-checked in ${steps} human Take-steps`);
  console.log('techniques:', [...counts].map(([name, n]) => `${name}=${n}`).join(', '));
}

console.log('ok: checkerboard transfer, C4 linked min/max, cross-line singleton, fast edge cascade, and symmetric Numbers spine');
