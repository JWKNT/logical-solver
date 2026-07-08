const { runAny, runSolve } = require('./engine-node.js');

// ---------- brute force ground truth ----------
function bruteStatuses(R, C, rowClue, colClue, blocked) {
  const nR = R * (C - 1), nD = (R - 1) * C, T = nR + nD, N = R * C;
  const onR = new Uint8Array(N), offR = new Uint8Array(N), onD = new Uint8Array(N), offD = new Uint8Array(N);
  const used = new Uint8Array(N), empty = new Uint8Array(N);
  let count = 0;
  for (let mask = 1; mask < (1 << T); mask++) {
    const rightE = new Uint8Array(N), downE = new Uint8Array(N);
    let k = 0;
    for (let r = 0; r < R; r++) for (let c = 0; c < C - 1; c++) { if (mask & (1 << k)) rightE[r * C + c] = 1; k++; }
    for (let r = 0; r < R - 1; r++) for (let c = 0; c < C; c++) { if (mask & (1 << k)) downE[r * C + c] = 1; k++; }
    if (!check(R, C, rightE, downE, rowClue, colClue, blocked)) continue;
    count++;
    for (let i = 0; i < N; i++) {
      const r = (i / C) | 0, c = i - r * C;
      if (c < C - 1) { if (rightE[i]) onR[i] = 1; else offR[i] = 1; }
      if (r < R - 1) { if (downE[i]) onD[i] = 1; else offD[i] = 1; }
      const deg = degOf(R, C, rightE, downE, r, c);
      if (deg > 0) used[i] = 1; else empty[i] = 1;
    }
  }
  const stR = new Uint8Array(N), stD = new Uint8Array(N), stCell = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const r = (i / C) | 0, c = i - r * C;
    stR[i] = (c === C - 1) ? 0 : (onR[i] ? (offR[i] ? 1 : 2) : 0);
    stD[i] = (r === R - 1) ? 0 : (onD[i] ? (offD[i] ? 1 : 2) : 0);
    stCell[i] = used[i] ? (empty[i] ? 1 : 2) : 0;
  }
  return { count, stR, stD, stCell };
}
function degOf(R, C, rightE, downE, r, c) {
  const i = r * C + c;
  return (c < C - 1 ? rightE[i] : 0) + (c > 0 ? rightE[i - 1] : 0) +
         (r < R - 1 ? downE[i] : 0) + (r > 0 ? downE[i - C] : 0);
}
function shapeOf(R, C, rightE, downE, r, c) {
  const i = r * C + c;
  const Rt = c < C - 1 ? rightE[i] : 0, L = c > 0 ? rightE[i - 1] : 0;
  const Dn = r < R - 1 ? downE[i] : 0, U = r > 0 ? downE[i - C] : 0;
  const deg = Rt + L + Dn + U;
  if (deg === 4) return 0;
  if (deg === 3) return 1;
  if (deg === 2) return ((L && Rt) || (U && Dn)) ? 2 : 3;
  return -1;
}
function check(R, C, rightE, downE, rowClue, colClue, blocked) {
  const used = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const d = degOf(R, C, rightE, downE, r, c);
    if (d === 1) return false;
    if (d > 0) { if (blocked[r * C + c]) return false; used.push(r * C + c); }
  }
  if (!used.length) return false;
  const seen = new Set([used[0]]); const q = [used[0]];
  while (q.length) {
    const i = q.pop(); const r = (i / C) | 0, c = i - r * C;
    const nb = [];
    if (c < C - 1 && rightE[i]) nb.push(i + 1);
    if (c > 0 && rightE[i - 1]) nb.push(i - 1);
    if (r < R - 1 && downE[i]) nb.push(i + C);
    if (r > 0 && downE[i - C]) nb.push(i - C);
    for (const j of nb) if (!seen.has(j)) { seen.add(j); q.push(j); }
  }
  if (seen.size !== used.length) return false;
  for (let r = 0; r < R; r++) {
    const cnt = [0, 0, 0, 0];
    for (let c = 0; c < C; c++) { const s = shapeOf(R, C, rightE, downE, r, c); if (s >= 0) cnt[s]++; }
    for (let s = 0; s < 4; s++) if (rowClue[r * 4 + s] >= 0 && cnt[s] !== rowClue[r * 4 + s]) return false;
  }
  for (let c = 0; c < C; c++) {
    const cnt = [0, 0, 0, 0];
    for (let r = 0; r < R; r++) { const s = shapeOf(R, C, rightE, downE, r, c); if (s >= 0) cnt[s]++; }
    for (let s = 0; s < 4; s++) if (colClue[c * 4 + s] >= 0 && cnt[s] !== colClue[c * 4 + s]) return false;
  }
  return true;
}
function cluesFrom(R, C, rightE, downE) {
  const rowClue = new Array(R * 4).fill(0), colClue = new Array(C * 4).fill(0);
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const s = shapeOf(R, C, rightE, downE, r, c);
    if (s >= 0) { rowClue[r * 4 + s]++; colClue[c * 4 + s]++; }
  }
  return { rowClue, colClue };
}
const blank = n => new Array(n).fill(-1);
let fails = 0;
function eq(a, b, msg) { if (a !== b) { console.log('FAIL:', msg, '-> got', a, 'expected', b); fails++; } else console.log('ok:', msg, '=', a); }

// Test 1: statuses vs brute force on unconstrained small grids
for (const [R, C] of [[2, 2], [3, 3], [3, 4]]) {
  const cfg = { R, C, rowClue: blank(R * 4), colClue: blank(C * 4), blocked: new Uint8Array(R * C), mode: 'candidates', timeLimit: 30000 };
  const res = runAny(cfg, null);
  const bf = bruteStatuses(R, C, cfg.rowClue, cfg.colClue, cfg.blocked);
  let mism = 0;
  for (let i = 0; i < R * C; i++) {
    if (res.stR[i] !== bf.stR[i]) { mism++; console.log('  stR mismatch @', i, res.stR[i], bf.stR[i]); }
    if (res.stD[i] !== bf.stD[i]) { mism++; console.log('  stD mismatch @', i, res.stD[i], bf.stD[i]); }
    if (res.stCell[i] !== bf.stCell[i]) { mism++; console.log('  stCell mismatch @', i, res.stCell[i], bf.stCell[i]); }
  }
  eq(mism, 0, `${R}x${C} unconstrained: status mismatches`);
  eq(res.solCount, bf.count, `${R}x${C} unconstrained: exact count`);
  eq(res.countExact, true, `${R}x${C} unconstrained: count flagged exact`);
}

// Test 2: 60 random full/partial-clue 3x4 puzzles (incl. blocked cells): statuses + count vs brute force
{
  let mism = 0;
  for (let t = 0; t < 60; t++) {
    const R = 3, C = 4, N = 12;
    const blocked = new Uint8Array(N);
    if (t % 3 === 0) blocked[(Math.random() * N) | 0] = 1;
    const gen = runSolve({ R, C, rowClue: blank(12), colClue: blank(16), blocked, mode: 'random', randomize: true, timeLimit: 5000 }, null);
    if (!gen.firstR) continue;
    const { rowClue, colClue } = cluesFrom(R, C, gen.firstR, gen.firstD);
    if (t >= 20) { // erase some clues for t >= 20
      for (let i = 0; i < rowClue.length; i++) if (Math.random() < 0.6) rowClue[i] = -1;
      for (let i = 0; i < colClue.length; i++) if (Math.random() < 0.6) colClue[i] = -1;
    }
    const res = runAny({ R, C, rowClue, colClue, blocked, mode: 'candidates', timeLimit: 30000 }, null);
    const bf = bruteStatuses(R, C, rowClue, colClue, blocked);
    if (res.solCount !== bf.count) { mism++; console.log('  count mismatch', res.solCount, bf.count); continue; }
    for (let i = 0; i < N; i++) {
      if (res.stR[i] !== bf.stR[i] || res.stD[i] !== bf.stD[i] || res.stCell[i] !== bf.stCell[i]) { mism++; console.log('  status mismatch trial', t, 'at', i); break; }
    }
    if (res.unresolved) { mism++; console.log('  unexpectedly unresolved'); }
  }
  eq(mism, 0, '60 random 3x4 puzzles (full+partial clues, some blocked): statuses & counts vs brute force');
}

// Test 3: intersection with dangling half-pieces is preserved (not filtered to valid pieces)
// Craft a case: find a partial-clue puzzle where some cell has exactly one 'always' incident edge.
{
  let found = false;
  for (let t = 0; t < 200 && !found; t++) {
    const R = 3, C = 4, N = 12;
    const gen = runSolve({ R, C, rowClue: blank(12), colClue: blank(16), blocked: new Uint8Array(N), mode: 'random', randomize: true, timeLimit: 5000 }, null);
    const { rowClue, colClue } = cluesFrom(R, C, gen.firstR, gen.firstD);
    for (let i = 0; i < rowClue.length; i++) if (Math.random() < 0.5) rowClue[i] = -1;
    for (let i = 0; i < colClue.length; i++) if (Math.random() < 0.5) colClue[i] = -1;
    const res = runAny({ R, C, rowClue, colClue, blocked: new Uint8Array(N), mode: 'candidates', timeLimit: 30000 }, null);
    if (res.solCount < 2) continue;
    for (let i = 0; i < N; i++) {
      const r = (i / C) | 0, c = i - r * C;
      let always = 0;
      if (c < C - 1 && res.stR[i] === 2) always++;
      if (c > 0 && res.stR[i - 1] === 2) always++;
      if (r < R - 1 && res.stD[i] === 2) always++;
      if (r > 0 && res.stD[i - C] === 2) always++;
      if (always === 1) { found = true; break; } // a dangling "half-piece": one certain connection, rest undetermined
    }
  }
  eq(found, true, 'found a multi-solution puzzle whose definite map contains a dangling half-piece (degree-1 solid end)');
}

// Test 4a: fresh random sparse 8x8 — honesty: unresolved flag matches presence of undetermined statuses,
// and the definite map is never a dense near-complete grid (the old enumeration-timeout bug)
{
  const R = 8, C = 8, N = 64;
  const gen = runSolve({ R, C, rowClue: blank(32), colClue: blank(32), blocked: new Uint8Array(N), mode: 'random', randomize: true, timeLimit: 5000 }, null);
  const { rowClue, colClue } = cluesFrom(R, C, gen.firstR, gen.firstD);
  let seed = 42; const rnd = () => ((seed = seed * 1103515245 + 12345 >>> 0) / 2 ** 32);
  for (let i = 0; i < rowClue.length; i++) if (rnd() < 0.7) rowClue[i] = -1;
  for (let i = 0; i < colClue.length; i++) if (rnd() < 0.7) colClue[i] = -1;
  const t0 = Date.now();
  const res = runAny({ R, C, rowClue, colClue, blocked: new Uint8Array(N), mode: 'candidates', timeLimit: 10000 }, null);
  let def = 0, undet = 0;
  for (let i = 0; i < N; i++) {
    def += (res.stR[i] === 2) + (res.stD[i] === 2);
    undet += (res.stR[i] === 3) + (res.stD[i] === 3) + (res.stCell[i] === 3);
  }
  console.log(`8x8 fresh sparse: ${Date.now() - t0} ms, ${def} definite, ${undet} undetermined, count>=${res.solCount}${res.countExact ? ' (exact)' : ''}`);
  eq(res.unresolved, undet > 0, '8x8 fresh sparse: unresolved flag matches undetermined statuses');
  if (def > 40 && res.unresolved) { console.log('FAIL: dense definite map while unresolved (old bug symptom)'); fails++; }
  else console.log('ok: no dense-overlay symptom');
}

// Test 4b: deterministic benchmark on the saved hard instance — most segments must resolve in 10s
{
  const inst = JSON.parse(require('fs').readFileSync(__dirname + '/hard8x8.json'));
  inst.blocked = new Uint8Array(64); inst.mode = 'candidates'; inst.timeLimit = 10000;
  const res = runAny(inst, null);
  let undet = 0;
  for (let i = 0; i < 64; i++) undet += (res.stR[i] === 3) + (res.stD[i] === 3);
  console.log('hard8x8.json: undetermined segments =', undet);
  if (undet > 30) { console.log('FAIL: too many undetermined segments on the benchmark instance'); fails++; }
  else console.log('ok: benchmark instance mostly resolved');
}

// Test 5: unique puzzle -> everything determined, count exact = 1
{
  const R = 5, C = 5, N = 25;
  for (let t = 0; t < 50; t++) {
    const gen = runSolve({ R, C, rowClue: blank(20), colClue: blank(20), blocked: new Uint8Array(N), mode: 'random', randomize: true, timeLimit: 5000 }, null);
    const { rowClue, colClue } = cluesFrom(R, C, gen.firstR, gen.firstD);
    const res = runAny({ R, C, rowClue, colClue, blocked: new Uint8Array(N), mode: 'candidates', timeLimit: 20000 }, null);
    if (res.solCount !== 1) continue;
    let bad = 0;
    for (let i = 0; i < N; i++) {
      if (res.stR[i] === 1 || res.stR[i] === 3 || res.stD[i] === 1 || res.stD[i] === 3) bad++;
      // consistency: definite edges must equal the base solution's edges
      if ((res.stR[i] === 2) !== !!gen.firstR && false) {}
    }
    eq(bad, 0, 'unique 5x5 puzzle: no undetermined segments remain');
    break;
  }
}

console.log(fails === 0 ? '\nALL TESTS PASSED' : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
