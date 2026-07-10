const S = require('./js/sums-stepper.js');
const P = require('./tests/alien-puzzles.js').knt;
const clues = { rows: P.rows, cols: P.cols };
const st = S.makeSumsState(P.R, P.C, P.D);
st.alien = true; st.noTrial = true;
let mv, k = 0;
while (k++ < 80 && (mv = S.takeSumsStep(st, clues))) {
  const bases = [...st.baseCand].join(',');
  console.log(k + '. [' + mv.rule + '] ' + mv.text.slice(0, 200));
  console.log('    bases: ' + bases);
  if (mv.contradiction) break;
}
