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

{
  // '?' wildcard: one extra granting ordinal, distinct from the listed
  // numbers; solutions are deduplicated by route, and permitInfo resolves
  // the wildcard to the LOWEST feasible ordinal
  const base = require('./a38-10x10.js');
  const at = (r, c) => (r - 1) * base.C + c - 1;
  const q = at(4, 2);
  const cfg = { ...base, clues: { ...base.clues, [q]: [1, 4, '?'] } };
  const r = SAT.solve({ ...cfg, maxSolutions: 12 }, 180);
  assert(r.solutions.length >= 2, 'the wildcard should open at least one extra route');
  const orig = SAT.solve({ ...base, maxSolutions: 2 }, 60).solutions[0];
  const start = base.kind.indexOf('start');
  const key = p => { const s2 = p.indexOf(start); return p.slice(s2).concat(p.slice(0, s2)).join(','); };
  assert(new Set(r.solutions.map(key)).has(key(orig)), 'the plain-clue solution must remain valid with ? = 5');
  const si = orig.indexOf(start);
  const info = SAT.permitInfo(orig.slice(si).concat(orig.slice(0, si)), cfg);
  const ords = [...info.ordinals].filter(([x, m]) => m.has(q)).map(([x, m]) => m.get(q)).sort((a, b) => a - b);
  assert.deepStrictEqual(ords, [1, 4, 5], 'permitInfo should resolve ? to the lowest feasible ordinal (5 here)');
  console.log('A38 wildcard clue test passed');
}

{
  // multiple wildcards: [4,'?','?'] = ordinal 4 plus TWO extra distinct
  // granting ordinals (neither = 4); the plain-clue solution must satisfy it
  // and permitInfo must resolve the extras lowest-first
  const base = require('./a38-10x10.js');
  const at = (r, c) => (r - 1) * base.C + c - 1;
  const q = at(4, 2);
  const cfg = { ...base, clues: { ...base.clues, [q]: [4, '?', '?'] } };
  const r = SAT.solve({ ...cfg, maxSolutions: 1 }, 120);
  assert(r.solutions.length >= 1, 'a multi-wildcard clue must stay satisfiable');
  const orig = SAT.solve({ ...base, maxSolutions: 2 }, 60).solutions[0];
  const start = base.kind.indexOf('start');
  const si = orig.indexOf(start);
  const info = SAT.permitInfo(orig.slice(si).concat(orig.slice(0, si)), cfg);
  const ords = [...info.ordinals].filter(([x, m]) => m.has(q)).map(([x, m]) => m.get(q)).sort((a, b) => a - b);
  assert.deepStrictEqual(ords, [1, 4, 5], 'the two extras should resolve to 1 and 5 on the original route');
  console.log('A38 multi-wildcard clue test passed');
}
