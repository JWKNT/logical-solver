// verify a ladder-completed alien fill with the engine at the pinned base
const E = require('./js/sums-engine.js');
const S = require('./js/sums-stepper.js');
const P = require('./tests/alien-puzzles.js')[process.argv[2]];
const clues = { rows: P.rows, cols: P.cols };
const st = S.makeSumsState(P.R, P.C, P.D);
st.alien = true;
let mv, k = 0;
const t0 = Date.now();
while (k++ < 2000 && (mv = S.takeSumsStep(st, clues))) if (mv.contradiction) { console.log('CONTRA', mv.text.slice(0,200)); process.exit(1); }
console.log('steps:', k - 1, 'complete:', S.sumsComplete(st), 'base:', [...st.baseCand].join(','), ((Date.now()-t0)/1000).toFixed(0) + 's');
if (!S.sumsComplete(st) || st.baseCand.size !== 1) process.exit(1);
const base = [...st.baseCand][0];
const r = E.runAny({ R: P.R, C: P.C, D: P.D, base, rowClues: P.rows, colClues: P.cols,
  candMask: Array.from(st.cand), mode: 'count', timeLimit: 120000, maxSolutions: 5 });
console.log('engine accepts fill at base ' + base + ':', r.solCount === 1, '(count', r.solCount + ', complete', r.complete + ')');
// letters
const out = [];
for (let L = 0; L < 26; L++) { const ds = S.digitsOf2(st.letterCand[L]); if (ds.length === 1 && st.letterCand[L] !== 1023) out.push(String.fromCharCode(65+L) + '=' + ds[0]); }
console.log('letters:', out.join(' '));
