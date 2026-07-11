const assert=require('assert'),S=require('../js/a38-stepper.js');
const kind=Array(9).fill('cell');kind[4]='clue';kind[0]='start';
const state={},cfg={R:3,C:3,kind,clues:{4:[3]}};
const t=Date.now(),mv=S.step(cfg,state);
assert(Date.now()-t<100,'Take step must be an immediate local deduction');
assert.strictEqual(mv.tech,1);
assert(state.lineEdges.size>=1,'the corner deduction places its line');
assert(!mv.follow,'every deduction stands alone — no batched follow-through');
assert(!state.__result,'Take step must not run or cache an exhaustive solve');
console.log('A38 immediate-step tests passed');

// Overlapping cyclic clues from the user's 12x12 example. The [1,2,3,4],
// [1,5,6], [1,5] cluster must agree on shared permit cells.
{
  const base=require('./a38-000TFE.js'),{R,C}=base,k=base.kind.slice(),cl={...base.clues},at=(r,c)=>(r-1)*C+c-1,st={};
  const factsIn=()=>st.permitCells&&st.permitCells.has(at(3,5))&&st.permitCells.has(at(5,5))&&st.permitCells.has(at(3,4))&&st.permitCells.has(at(5,3))&&st.noPermitCells.has(at(4,6))&&st.noPermitCells.has(at(5,6))&&st.offEdges.has([at(3,4),at(3,5)].sort((a,b)=>a-b).join('-'));
  for(let n=0;n<400&&!factsIn();n++){const m=S.step({R,C,kind:k,clues:cl},st,{noEscalate:true});if(m.done||m.contradiction)break}
  assert(st.permitCells.has(at(3,5))&&st.permitCells.has(at(5,5))&&st.permitCells.has(at(3,4)),'overlapping clue cluster should identify its shared permit cells');
  assert(st.permitCells.has(at(5,3)),'a same-event confirmed strand should eliminate the upper alternative and force the lower-left permit');
  assert(st.noPermitCells.has(at(4,6))&&st.noPermitCells.has(at(5,6)),'cluster should eliminate impossible permit cells');
  assert(st.offEdges.has([at(3,4),at(3,5)].sort((a,b)=>a-b).join('-')),'adjacent pass-acquisition cells cannot be consecutive on the route');
  console.log('A38 overlapping permit-pattern tests passed');
}

// An adjacent clue occupies one of the eight surrounding positions. It is not
// a route cell and therefore leaves a seven-cell cyclic ring.
{
  const R=6,C=6,k=Array(R*C).fill('cell'),at=(r,c)=>(r-1)*C+c-1;
  const a=at(3,4),b=at(4,4);k[a]=k[b]='clue';
  const cfg={R,C,kind:k,clues:{[a]:[6],[b]:[2]}};
  assert.strictEqual(S.ringCells(cfg,a).length,7);
  assert.strictEqual(S.ringCells(cfg,b).length,7);
  assert(!S.ringCells(cfg,a).includes(b)&&!S.ringCells(cfg,b).includes(a));
  console.log('A38 seven-cell clue-ring tests passed');
}

// The 10x10 reference puzzle must remain solvable by foreground human steps.
// In particular, chronology from the empty-handed start directly excludes
// r7c2-r8c2 before a gray cell could be reached without a permit.
{
  const cfg=require('./a38-10x10.js'),st={},edge='61-71';let last;
  for(let n=0;n<900;n++){last=S.step(cfg,st);if(last.done||last.contradiction)break}   // deductions are unbatched: one per step
  assert(st.offEdges.has(edge),'start/pass chronology should exclude r7c2-r8c2');
  assert(last&&last.complete,'the 10x10 reference should solve with Take step alone');
  assert.strictEqual(st.permitCells.size,7,'all seven acquired permits should be marked');
  console.log('A38 10x10 human-ladder regression passed');
}

{
  // the completed 10x10 ladder route must equal the engine's unique solution
  global.Logic = require('../js/vendor/logic-solver.bundle.js');
  delete require.cache[require.resolve('../js/a38-engine.js')];
  const SAT2 = require('../js/a38-engine.js');
  const P = require('./a38-10x10.js');
  const state = {};
  let x;
  for (let n = 0; n < 900; n++) { x = S.step(P, state); if (x.done || x.contradiction) break; }
  assert(x && x.complete, '10x10 should complete for the engine-match check');
  const r = SAT2.solve({ ...P, maxSolutions: 2 }, 120);
  assert.strictEqual(r.solutions.length, 1, '10x10 should be unique');
  const p = r.solutions[0], want = new Set();
  for (let i = 0; i < p.length; i++) want.add(p[i] + '>' + p[(i + 1) % p.length]);
  assert([...want].every(e => state.forcedEdges.has(e)) && [...state.forcedEdges].every(e => want.has(e)), 'ladder route must match the unique solution');
  console.log('A38 10x10 ladder-vs-engine route match passed');
}

{
  // full-ladder regression: LM 000TFE (12x12) solves end to end by Take step
  // alone — the strand-order rule (traversal order of ring cells vs surviving
  // cyclic rotations) carries the hard right-hand region — and the completed
  // route equals the engine's unique solution
  global.Logic = global.Logic || require('../js/vendor/logic-solver.bundle.js');
  delete require.cache[require.resolve('../js/a38-engine.js')];
  const SAT3 = require('../js/a38-engine.js');
  const P = require('./a38-000TFE.js');
  const state = {};
  let x, k = 0;
  const t0 = Date.now();
  for (let n = 0; n < 1500 && Date.now() - t0 < 900000; n++) { x = S.step(P, state); if (x.done || x.contradiction) break; k++; }
  assert(x && x.complete, '000TFE should complete by the ladder (reached step ' + k + ')');
  const r = SAT3.solve({ ...P, maxSolutions: 2 }, 240);
  assert.strictEqual(r.solutions.length, 1, '000TFE should be unique');
  const p = r.solutions[0], want = new Set();
  for (let i = 0; i < p.length; i++) want.add(p[i] + '>' + p[(i + 1) % p.length]);
  assert([...want].every(e => state.forcedEdges.has(e)) && [...state.forcedEdges].every(e => want.has(e)), '000TFE ladder route must match the unique solution');
  console.log('A38 000TFE full-ladder regression passed (' + k + ' steps, ' + ((Date.now() - t0) / 1000).toFixed(0) + 's)');
}

// --deep additionally runs the heaviest full-ladder regression (0002GL,
// 2016 ignore-start rules; roughly 15-30 minutes with its SAT verification)
if (process.argv.includes('--deep')) {
  global.Logic = global.Logic || require('../js/vendor/logic-solver.bundle.js');
  delete require.cache[require.resolve('../js/a38-engine.js')];
  const SAT4 = require('../js/a38-engine.js');
  const P = require('./a38-0002GL.js');
  const state = {};
  let x, k = 0;
  const t0 = Date.now();
  for (let n = 0; n < 2000 && Date.now() - t0 < 3000000; n++) { x = S.step(P, state); if (x.done || x.contradiction) break; k++; }
  assert(x && x.complete, '0002GL should complete by the ladder (reached step ' + k + ')');
  const r = SAT4.solve({ ...P, maxSolutions: 2 }, 600);
  assert(r.solutions.length === 1 || (r.solutions.length >= 1 && r.timed), '0002GL should have a solution');
  const p = r.solutions[0], want = new Set();
  for (let i = 0; i < p.length; i++) want.add(p[i] + '>' + p[(i + 1) % p.length]);
  assert([...want].every(e => state.forcedEdges.has(e)) && [...state.forcedEdges].every(e => want.has(e)), '0002GL ladder route must match the engine solution');
  console.log('A38 0002GL full-ladder regression passed (' + k + ' steps, ' + ((Date.now() - t0) / 1000).toFixed(0) + 's)');
}

{
  // Soundness: orienting a start branch toward "arriving, because the first
  // event out would be gray" is only legal when no cell on the chain could
  // still acquire a pass. Here the chain start-A-gray passes A, which an
  // adjacent clue can still make a pass cell, so no inward arrow may appear.
  const R = 4, C = 5, at = (r, c) => (r - 1) * C + c - 1;
  const kind = Array(R * C).fill('cell');
  kind[at(1, 3)] = 'clue';           // ring covers A = r2c2
  kind[at(3, 2)] = 'start';
  kind[at(1, 2)] = 'station';        // the gray at the end of the chain
  const cfg = { R, C, kind, clues: { [at(1, 3)]: [3] } };
  const key = (a, b) => a < b ? a + '-' + b : b + '-' + a;
  const st = { lineEdges: new Set([key(at(3, 2), at(2, 2)), key(at(2, 2), at(1, 2))]), offEdges: new Set(), forcedEdges: new Set(), offDirections: new Set(), permitCells: new Set(), noPermitCells: new Set(), permitOrdinals: new Map(), patternRestrictions: new Map() };
  for (let n = 0; n < 30; n++) { const mv = S.step(cfg, st, { noTrial: true, noBatch: true }); if (mv.done || mv.contradiction) break; }
  assert(!st.forcedEdges.has(at(2, 2) + '>' + at(3, 2)), 'the branch through a still-grantable cell must not be oriented inward');
  console.log('A38 start-branch grantable soundness test passed');
}

{
  // full-ladder regression: the 2018 tuace puzzle — the ring-degree technique
  // opens it (the author's 'otherwise no 2 passes' moves) and the start-rank
  // rule (a cell joined to the start by a line holds rank 1 or m in any ring)
  // collapses the central clue; route must equal the unique solution
  global.Logic = global.Logic || require('../js/vendor/logic-solver.bundle.js');
  delete require.cache[require.resolve('../js/a38-engine.js')];
  const SAT5 = require('../js/a38-engine.js');
  const P = require('./a38-hwf2018.js');
  const state = {};
  let x, k = 0;
  const t0 = Date.now();
  for (let n = 0; n < 900 && Date.now() - t0 < 600000; n++) { x = S.step(P, state); if (x.done || x.contradiction) break; k++; }
  assert(x && x.complete, 'a38-hwf2018 should complete by the ladder (reached step ' + k + ')');
  const r = SAT5.solve({ ...P, maxSolutions: 2 }, 120);
  assert.strictEqual(r.solutions.length, 1);
  const p = r.solutions[0], want = new Set();
  for (let i = 0; i < p.length; i++) want.add(p[i] + '>' + p[(i + 1) % p.length]);
  assert([...want].every(e => state.forcedEdges.has(e)) && [...state.forcedEdges].every(e => want.has(e)), 'hwf2018 ladder route must match the unique solution');
  console.log('A38 hwf2018 full-ladder regression passed (' + k + ' steps, ' + ((Date.now() - t0) / 1000).toFixed(0) + 's)');
}
