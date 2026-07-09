// Japanese Sums engine vs an independent brute force on small random grids.
const E = require('../js/sums-engine.js');

function randGrid(R, C, D) {
  // random valid grid by greedy fill with restarts
  for (let attempt = 0; attempt < 400; attempt++) {
    const g = new Int8Array(R * C);
    const rm = new Int32Array(R), cm = new Int32Array(C);
    let ok = true;
    for (let i = 0; i < R * C && ok; i++) {
      const r = (i / C) | 0, c = i % C;
      const opts = [0];
      for (let v = 1; v <= D; v++) if (!(rm[r] & (1 << v)) && !(cm[c] & (1 << v))) opts.push(v);
      const v = opts[(Math.random() * opts.length) | 0];
      g[i] = v;
      if (v) { rm[r] |= 1 << v; cm[c] |= 1 << v; }
    }
    if (ok) return g;
  }
  return null;
}
function cluesOf(g, R, C, D) {
  const rows = [], cols = [];
  for (let r = 0; r < R; r++) {
    const cl = []; let run = 0;
    for (let c = 0; c < C; c++) { const v = g[r * C + c]; if (v) run += v; else if (run) { cl.push(run); run = 0; } }
    if (run) cl.push(run);
    rows.push(cl);
  }
  for (let c = 0; c < C; c++) {
    const cl = []; let run = 0;
    for (let r = 0; r < R; r++) { const v = g[r * C + c]; if (v) run += v; else if (run) { cl.push(run); run = 0; } }
    if (run) cl.push(run);
    cols.push(cl);
  }
  return { rows, cols };
}
// brute: distinctness-pruned enumeration with full clue verification at the end
function brute(R, C, D, rowClues, colClues) {
  const g = new Int8Array(R * C);
  const rm = new Int32Array(R), cm = new Int32Array(C);
  let count = 0;
  function lineOk(cells, cl) {
    let gi = 0, run = 0;
    for (const v of cells) {
      if (v) run += v;
      else if (run) { if (cl && (gi >= cl.length || (cl[gi] >= 0 && cl[gi] !== run))) return false; gi++; run = 0; }
    }
    if (run) { if (cl && (gi >= cl.length || (cl[gi] >= 0 && cl[gi] !== run))) return false; gi++; }
    return !cl || gi === cl.length;
  }
  function rec(i) {
    if (i === R * C) {
      for (let r = 0; r < R; r++) if (!lineOk(g.slice(r * C, r * C + C), rowClues[r])) return;
      for (let c = 0; c < C; c++) { const col = []; for (let r = 0; r < R; r++) col.push(g[r * C + c]); if (!lineOk(col, colClues[c])) return; }
      count++;
      return;
    }
    const r = (i / C) | 0, c = i % C;
    g[i] = 0; rec(i + 1);
    for (let v = 1; v <= D; v++) {
      if ((rm[r] & (1 << v)) || (cm[c] & (1 << v))) continue;
      g[i] = v; rm[r] |= 1 << v; cm[c] |= 1 << v;
      rec(i + 1);
      rm[r] &= ~(1 << v); cm[c] &= ~(1 << v);
    }
    g[i] = 0;
  }
  rec(0);
  return count;
}

let fails = 0;
for (let t = 0; t < 40; t++) {
  const R = 3 + ((Math.random() * 2) | 0), C = 3, D = 3 + ((Math.random() * 2) | 0);
  const g = randGrid(R, C, D);
  const { rows, cols } = cluesOf(g, R, C, D);
  // drop some clues to unclued to vary
  const rowClues = rows.map(cl => Math.random() < 0.15 ? null : cl);
  const colClues = cols.map(cl => Math.random() < 0.15 ? null : cl);
  const bruteN = brute(R, C, D, rowClues, colClues);
  const eng = E.runAny({ R, C, D, rowClues, colClues, mode: 'count', timeLimit: 10000, maxSolutions: 1e9 });
  if (!eng.complete || eng.solCount !== bruteN) {
    console.log('FAIL:', R + 'x' + C, 'D=' + D, 'brute=' + bruteN, 'engine=' + eng.solCount, 'complete=' + eng.complete);
    fails++;
  }
  if (bruteN < 1) { console.log('FAIL: generated puzzle has no solutions?!'); fails++; }
}
console.log(fails ? fails + ' FAILURES' : 'ALL SUMS ENGINE TESTS PASSED');
process.exit(fails ? 1 : 0);
