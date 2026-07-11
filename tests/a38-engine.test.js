const assert=require('assert'),E=require('../js/a38-engine.js');
let kind=Array(9).fill('cell');kind[4]='clue';kind[0]='start';kind[1]='station';
let r=E.solve({R:3,C:3,kind,clues:{4:3}},2);
assert.strictEqual(r.solutions.length,1);
assert.deepStrictEqual(r.solutions[0],[0,3,6,7,8,5,2,1]);
const common=E.commonDirectedEdges(r.solutions);
assert(common.has('0>3') && common.has('1>0'));
assert(!common.has('3>0'), 'directed candidates must not include the reverse edge');
const info=E.permitInfo(r.solutions[0],{R:3,C:3,kind,clues:{4:3}});
assert(info.cells.size===1&&info.cells.has(6),'Solve should expose the acquired permit cells');
kind[1]='cell';r=E.solve({R:3,C:3,kind,clues:{4:3}},2);
assert.strictEqual(r.solutions.length,0,'an unspent permit is invalid');
console.log('A38 engine tests passed');

// Multi-number clues describe a union of visit positions, not a requirement
// that one cell occupy every listed position simultaneously.
global.Logic=require('../js/vendor/logic-solver.bundle.js');
delete require.cache[require.resolve('../js/a38-engine.js')];
const SAT=require('../js/a38-engine.js'),official=require('./a38-000TFE.js');
const exact=SAT.solve({...official,maxSolutions:2},10);
assert.strictEqual(exact.solutions.length,1,'000TFE should solve uniquely with seven-cell rings and multi-number clues');
console.log('A38 000TFE exact uniqueness test passed');

{
  // the SAT solve path must honor its time limit (returns timed, not a hang)
  const kind = Array(64).fill('cell'); kind[0] = 'start';
  const t0 = Date.now();
  const r = SAT.solve({ R: 8, C: 8, kind, clues: {}, maxSolutions: 2000 }, 0.5);
  if (!r.timed || Date.now() - t0 > 10000) { console.log('FAIL: SAT solve ignored the time limit (' + (Date.now() - t0) + 'ms, timed=' + r.timed + ')'); process.exit(1); }
  console.log('A38 SAT time-limit test passed (' + (Date.now() - t0) + 'ms)');
}

{
  // the 2018 tuace puzzle (author-hint cross-checked transcription) is unique
  const P = require('./a38-hwf2018.js');
  const r = SAT.solve({ ...P, maxSolutions: 2 }, 120);
  assert.strictEqual(r.solutions.length, 1, 'a38-hwf2018 should solve uniquely');
  console.log('A38 hwf2018 uniqueness test passed');
}
