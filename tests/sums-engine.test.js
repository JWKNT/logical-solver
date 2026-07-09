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
// crypto letters: substitute letters into some clue digits and compare against
// a brute that tries every distinct letter->digit assignment
for (let t = 0; t < 12; t++) {
  const R = 3, C = 3 + ((Math.random() * 2) | 0), D = 3 + ((Math.random() * 2) | 0);
  const g = randGrid(R, C, D);
  const { rows, cols } = cluesOf(g, R, C, D);
  // pick up to 2 digits that appear in the clue values and letter them
  const digitsSeen = new Set();
  for (const cl of rows.concat(cols)) for (const v of cl) for (const ch of String(v)) digitsSeen.add(+ch);
  const pool = [...digitsSeen];
  const nL = Math.min(pool.length, 1 + ((Math.random() * 2) | 0));
  const chosen = [];
  while (chosen.length < nL && pool.length) chosen.push(pool.splice((Math.random() * pool.length) | 0, 1)[0]);
  const LET = ['A', 'B'];
  const sub = v => String(v).split('').map(ch => { const k = chosen.indexOf(+ch); return k >= 0 ? LET[k] : ch; }).join('');
  const rowClues = rows.map(cl => cl.map(sub));
  const colClues = cols.map(cl => cl.map(sub));
  // brute over assignments: distinct digits 0-9 for each letter
  let bruteN = 0;
  const assign = new Array(nL).fill(0);
  function tryAssign(k) {
    if (k === nL) {
      const unsub = tok => { let out = ''; for (const ch of tok) { const li = LET.indexOf(ch); out += li >= 0 ? String(assign[li]) : ch; } return parseInt(out, 10); };
      const rcl = rowClues.map(cl => cl.map(tok => { const v = unsub(tok); return (String(v).length !== tok.length) ? NaN : v; }));
      const ccl = colClues.map(cl => cl.map(tok => { const v = unsub(tok); return (String(v).length !== tok.length) ? NaN : v; }));
      if (rcl.some(cl => cl.some(isNaN)) || ccl.some(cl => cl.some(isNaN))) return;   // leading zero created a shorter number
      for (const cl of rcl.concat(ccl)) for (const v of cl) if (isNaN(v)) return;
      bruteN += brute(R, C, D, rcl, ccl);
      return;
    }
    for (let d = 0; d <= 9; d++) {
      if (assign.slice(0, k).includes(d)) continue;
      assign[k] = d;
      tryAssign(k + 1);
    }
  }
  tryAssign(0);
  const eng = E.runAny({ R, C, D, rowClues, colClues, mode: 'count', timeLimit: 15000, maxSolutions: 1e9 });
  if (!eng.complete || eng.solCount !== bruteN) {
    console.log('CRYPTO FAIL:', R + 'x' + C, 'D=' + D, 'letters=' + nL, 'brute=' + bruteN, 'engine=' + eng.solCount);
    fails++;
  }
}
console.log(fails ? fails + ' FAILURES' : 'ALL SUMS ENGINE TESTS PASSED');
process.exit(fails ? 1 : 0);
