// Japanese Sums stepper soundness: on random puzzles, every candidate a step
// eliminates must be absent from every solution's value at that cell.
const E = require('../js/sums-engine.js');
const S = require('../js/sums-stepper.js');

function randGrid(R, C, D) {
  const g = new Int8Array(R * C);
  const rm = new Int32Array(R), cm = new Int32Array(C);
  for (let i = 0; i < R * C; i++) {
    const r = (i / C) | 0, c = i % C;
    const opts = [0, 0];   // bias toward blanks a bit
    for (let v = 1; v <= D; v++) if (!(rm[r] & (1 << v)) && !(cm[c] & (1 << v))) opts.push(v);
    const v = opts[(Math.random() * opts.length) | 0];
    g[i] = v;
    if (v) { rm[r] |= 1 << v; cm[c] |= 1 << v; }
  }
  return g;
}
function cluesOf(g, R, C) {
  const rows = [], cols = [];
  for (let r = 0; r < R; r++) { const cl = []; let run = 0; for (let c = 0; c < C; c++) { const v = g[r * C + c]; if (v) run += v; else if (run) { cl.push(run); run = 0; } } if (run) cl.push(run); rows.push(cl); }
  for (let c = 0; c < C; c++) { const cl = []; let run = 0; for (let r = 0; r < R; r++) { const v = g[r * C + c]; if (v) run += v; else if (run) { cl.push(run); run = 0; } } if (run) cl.push(run); cols.push(cl); }
  return { rows, cols };
}

let fails = 0;
// ---- scenarios (user-supplied techniques) ----
{
  // tens-digit cap: 'B?' with digits 1..9 -> B in 1..4 (max group sum 45)
  const st = S.makeSumsState(4, 12, 9);
  const mv = S.takeSumsStep(st, { rows: [['B?'], null, null, null], cols: new Array(12).fill(null) });
  if (!mv || mv.rule !== 'Sum bounds' || S.digitsOf2(st.letterCand[1]).join('') !== '1234') { console.log('FAIL: tens-digit cap (' + (mv && mv.rule) + ' -> B=' + S.digitsOf2(st.letterCand[1]).join('') + ')'); fails++; }
  else console.log('ok: "Sum bounds" (tens cap): ' + mv.text.slice(0, 110));
}
{
  // line budget: ??, BE, ??, ?? -> the three ?? need >= 30, so BE <= 15, B = 1
  const st = S.makeSumsState(4, 12, 9);
  const clues = { rows: [['??', 'BE', '??', '??'], null, null, null], cols: new Array(12).fill(null) };
  let mv, k = 0;
  while (k++ < 10 && (mv = S.takeSumsStep(st, clues)) && S.popc(st.letterCand[1]) > 1) if (mv.contradiction) break;
  if (S.digitsOf2(st.letterCand[1]).join('') !== '1') { console.log('FAIL: line budget B != 1'); fails++; }
  else console.log('ok: "Sum bounds" (line budget): B = 1 via the 30-minimum of the three ?? groups');
}
{
  // equal groups: X X X X in a 12-wide line -> X in 7..9
  const st = S.makeSumsState(4, 12, 9);
  const clues = { rows: [['X', 'X', 'X', 'X'], null, null, null], cols: new Array(12).fill(null) };
  let mv, k = 0, saw = false;
  while (k++ < 10 && (mv = S.takeSumsStep(st, clues))) { if (mv.rule === 'Equal groups') { saw = true; break; } if (mv.contradiction) break; }
  if (!saw || S.digitsOf2(st.letterCand[23]).join('') !== '789') { console.log('FAIL: equal groups X != 789 (' + S.digitsOf2(st.letterCand[23]).join('') + ')'); fails++; }
  else console.log('ok: "Equal groups": ' + mv.text.slice(0, 140));
}
{
  // the user's 8x8 crypto position: letter pairs (B,C = 1,2), correlated
  // disjoint sums (G,G,B and A,A,B lines), letter trials, and full-ladder
  // ghosts together solve it completely
  const clues = {
    rows: [['F','G','A'], ['G','G','B'], ['F','G','A'], ['CB'], ['B','F','G'], ['B','G','A'], ['CE'], ['G','A','B']],
    cols: [['A','A','B'], ['BC'], null, ['D','B','C'], ['CE'], null, ['BE'], ['A','A','B']]
  };
  const st = S.makeSumsState(8, 8, 6);
  let mv, k = 0, sawPairs = false, sawDisjoint = false, sawSpan = false, trials = 0;
  while (k++ < 1500 && (mv = S.takeSumsStep(st, clues))) {
    if (mv.rule === 'Letter pairs') sawPairs = true;
    if (mv.rule === 'Disjoint sums') sawDisjoint = true;
    if (mv.rule === 'Span algebra') sawSpan = true;
    if (/trial/i.test(mv.rule)) trials++;
    if (mv.contradiction) { console.log('FAIL: crypto position hit a contradiction'); fails++; break; }
  }
  if (trials > 0) { console.log('FAIL: crypto position needed ' + trials + ' trials (should be zero with span algebra)'); fails++; }
  if (!sawSpan) { console.log('FAIL: span algebra never fired on the crypto position'); fails++; }
  // the user's two non-trial conclusions must arrive before any trial:
  // r2c1+r2c4 certainly used (sizes-aware placements) and A = 5/6 (letter-
  // bound line enumeration)
  {
    const st2 = S.makeSumsState(8, 8, 6);
    let mv2, k2 = 0, trial = false, r2ok = false, aOk = false;
    while (k2++ < 200 && (mv2 = S.takeSumsStep(st2, clues))) {
      if (/trial/i.test(mv2.rule)) trial = true;
      if (!r2ok && (st2.cand[8] & 1) === 0 && (st2.cand[11] & 1) === 0) { r2ok = true; if (trial) { console.log('FAIL: r2c1/r2c4 needed a trial'); fails++; } }
      if (!aOk && S.digitsOf2(st2.letterCand[0]).join('') === '56') { aOk = true; if (trial) { console.log('FAIL: A=5/6 needed a trial'); fails++; } }
      if (r2ok && aOk) break;
      if (mv2.contradiction) break;
    }
    if (!r2ok || !aOk) { console.log('FAIL: expected non-trial conclusions missing (r2=' + r2ok + ', A=' + aOk + ')'); fails++; }
    else console.log('ok: r2c1+r2c4 used and A = 5/6 both derived without trials');
  }
  const truth = { A: 6, B: 1, C: 2, D: 8, E: 0, F: 4, G: 5 };
  let ok = S.sumsComplete(st) && sawPairs && sawDisjoint;
  for (const [name, want] of Object.entries(truth)) if (S.digitsOf2(st.letterCand[name.charCodeAt(0) - 65]).join('') !== String(want)) ok = false;
  if (!ok) { console.log('FAIL: crypto position not solved (pairs=' + sawPairs + ', disjoint=' + sawDisjoint + ', complete=' + S.sumsComplete(st) + ')'); fails++; }
  else console.log('ok: 8x8 crypto position fully solved in ' + (k - 1) + ' steps, ZERO trials (pairs + disjoint sums + span algebra)');
}
{
  // trailing '?' may be 0: '4?' and 'H?' (H=4) both admit 40; '?0' admits
  // 10/20/30/40; only the leading position is implicitly nonzero
  const st = S.makeSumsState(3, 12, 9);
  S.filterLetter(st, 7, 1 << 4);
  const s1 = [...S.allowedSums(st, '4?', 45)];
  const s2 = [...S.allowedSums(st, 'H?', 45)];
  const s3 = [...S.allowedSums(st, '?0', 45)];
  if (!s1.includes(40) || !s2.includes(40) || JSON.stringify(s3) !== JSON.stringify([10, 20, 30, 40])) {
    console.log('FAIL: trailing-zero patterns wrong (4?=' + s1 + ' | H?=' + s2 + ' | ?0=' + s3 + ')'); fails++;
  } else console.log('ok: trailing ? admits 0 (4? and H? include 40; ?0 = 10/20/30/40)');
  // engine agrees: a group summing 40 under clue '4?' is solvable
  const eng = E.runAny({ R: 1, C: 9, D: 9, mode: 'count', timeLimit: 5000, maxSolutions: 1e9,
    rowClues: [['4?']], colClues: new Array(9).fill(null) });
  if (!eng.complete || eng.solCount < 1) { console.log('FAIL: engine rejects 4? spanning sums with 0'); fails++; }
  else console.log('ok: engine solves a 4? row (' + eng.solCount + ' completions)');
}
{
  // exact-budget row (user's 12x12): ??, BE(=15), ??, ?? must total 45, so each
  // ?? is exactly 10; with the used/blank state the gaps land uniquely
  const st = S.makeSumsState(3, 12, 9);
  S.filterLetter(st, 1, 1 << 1); S.filterLetter(st, 4, 1 << 5);
  for (const c of [0, 1, 3, 4, 5, 7, 10, 11]) S.filterCand(st, c, ~1);
  S.filterCand(st, 9, ~((1 << 1) | (1 << 3)));
  const clues = { rows: [['??', 'BE', '??', '??'], null, null], cols: new Array(12).fill(null) };
  const mv = S.takeSumsStep(st, clues);
  const okBlank = st.cand[2] === 1 && st.cand[6] === 1 && st.cand[9] === 1;
  const okUsed = (st.cand[8] & 1) === 0;
  if (!mv || mv.rule !== 'Line placements' || !okBlank || !okUsed || !/= 10/.test(mv.text)) {
    console.log('FAIL: exact-budget row (' + (mv && mv.rule) + ', blanks=' + okBlank + ', used=' + okUsed + ')'); fails++;
  } else console.log('ok: exact-budget row: ' + mv.text.slice(0, 120));
}
{
  // the 12x12 digits-1..9 crypto puzzle (logic-masters.de 0001GH): the rule
  // ladder alone must solve it completely, zero trials
  const P = {
    rows: [['?','?','?','?','a','?'], ['?','??','?','?','b','?'], ['?a','c','?d','?'], ['??','?a'],
      ['??','be','??','??'], ['?','?','c','?c'], ['fg','d','??'], ['??','?','h','?','?b'],
      ['ad'], ['h?','e'], ['?','be','?','?'], ['?h','d','bj']],
    cols: [['?','?','??','??'], ['?g','?','?','?'], ['f?','?j','??'], ['??','??','??','??'],
      ['a?','?b'], ['?e','??','??','?j'], ['ah'], ['?','?','??'],
      ['??','?e','?'], ['f?','??','??','h'], null, null]
  };
  const st = S.makeSumsState(12, 12, 9);
  let mv, k = 0, trials = 0;
  const t0 = Date.now();
  while (k++ < 6000 && (mv = S.takeSumsStep(st, P))) {
    if (/trial/i.test(mv.rule)) trials++;
    if (mv.contradiction) { console.log('FAIL: 12x12 hit a contradiction: ' + mv.text.slice(0, 100)); fails++; break; }
  }
  const want = { A: 3, B: 1, C: 7, D: 9, E: 5, F: 2, G: 6, H: 4, J: 0 };
  let ok = S.sumsComplete(st) && trials === 0;
  for (const [name, w] of Object.entries(want)) if (S.digitsOf2(st.letterCand[name.charCodeAt(0) - 65]).join('') !== String(w)) ok = false;
  if (!ok) { console.log('FAIL: 12x12 not rule-solved (complete=' + S.sumsComplete(st) + ', trials=' + trials + ')'); fails++; }
  else console.log('ok: 12x12 D=9 crypto (LM 0001GH) fully solved by rules alone in ' + (k - 1) + ' steps, zero trials, ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
}
{
  // coral checkerboard: r1c1, r2c2 blank + r1c2 digit -> r2c1 blank; and the
  // full checkerboard is a contradiction
  const st = S.makeSumsState(3, 3, 3);
  Object.assign(st.variants, { blankConn: true, no22blank: true, asc: true, reach: true });
  S.filterCand(st, 0, 1); S.filterCand(st, 4, 1); S.filterCand(st, 1, ~1);
  const mv = S.takeSumsStep(st, { rows: [null, null, null], cols: [null, null, null] });
  if (!mv || mv.rule !== 'Coral checkerboard' || st.cand[3] !== 1) {
    console.log('FAIL: checkerboard deduction (' + (mv && mv.rule) + ', r2c1=' + st.cand[3] + ')'); fails++;
  } else console.log('ok: "Coral checkerboard": ' + mv.text.slice(0, 120));
  const st2 = S.makeSumsState(3, 3, 3);
  Object.assign(st2.variants, { blankConn: true, no22blank: true, asc: true, reach: true });
  S.filterCand(st2, 0, 1); S.filterCand(st2, 4, 1); S.filterCand(st2, 1, ~1); S.filterCand(st2, 3, ~1);
  const mv2 = S.takeSumsStep(st2, { rows: [null, null, null], cols: [null, null, null] });
  if (!mv2 || !mv2.contradiction || mv2.rule !== 'Coral checkerboard') { console.log('FAIL: checkerboard contradiction (' + (mv2 && mv2.rule) + ')'); fails++; }
  else console.log('ok: checkerboard contradiction detected');
}
{
  // the user's example palette: 1,2,3,4,5,5,6,7,9,9 - no 8s, two 5s and two
  // 9s per line. A 4-cell group summing 28 = 5+5+9+9 uniquely.
  const values = [1, 2, 3, 4, 5, 5, 6, 7, 9, 9];
  const st = S.makeSumsState(2, 4, 0, values);
  if (st.pal.includes(8)) { console.log('FAIL: 8 in palette'); fails++; }
  let mv, k = 0;
  while (k++ < 60 && (mv = S.takeSumsStep(st, { rows: [[31], null], cols: [null, null, null, null] }))) {
    if (mv.contradiction) { console.log('FAIL: palette 31 contradiction: ' + mv.text.slice(0, 100)); fails++; break; }
  }
  // 31 over this palette in 4 cells is uniquely 6+7+9+9
  let want = 0;
  for (const v of [6, 7, 9]) want |= 1 << (st.pal.indexOf(v) + 1);
  const okAll = [0, 1, 2, 3].every(i => (st.cand[i] & 1) === 0 && (st.cand[i] & ~want) === 0);
  if (!okAll) { console.log('FAIL: palette 31 should pin all four cells to {6,7,9}: ' + [0,1,2,3].map(i => st.cand[i]).join(',')); fails++; }
  else console.log('ok: custom palette 1,2,3,4,5,5,6,7,9,9 - clue 31 pins a 4-cell group to 6+7+9+9');
}
{
  // negative palette end-to-end: engine truth vs stepper on a tiny puzzle
  const values = [-2, 1, 3, 4];
  const R = 3, C = 3;
  const rows = [[3, 4], [-2], [8]], cols = [null, [4], null];
  const eng = E.runAny({ R, C, values, rowClues: rows, colClues: cols, mode: 'candidates', timeLimit: 10000, maxSolutions: 1e9 });
  if (!eng.complete || !eng.solCount) console.log('note: negative scenario unsolvable (' + eng.solCount + '), skipping');
  else {
    const st = S.makeSumsState(R, C, 0, values);
    let mv, k = 0, bad = false;
    while (k++ < 200 && (mv = S.takeSumsStep(st, { rows, cols }))) {
      if (mv.contradiction) { console.log('FAIL: negative palette contradiction on solvable: ' + mv.text.slice(0, 100)); fails++; bad = true; break; }
      for (let i = 0; i < R * C; i++) if (eng.cand[i] & ~st.cand[i]) { console.log('FAIL: negative palette unsound at cell ' + i + ' [' + mv.rule + ']'); fails++; bad = true; k = 999; break; }
    }
    if (!bad) console.log('ok: negative palette [-2,1,3,4] stepper sound vs engine truth');
  }
}
let steps = 0, trialSteps = 0, solved = 0, puzzles = 0, cryptoPuzzles = 0;
const t00 = Date.now();
while (puzzles < 24 && Date.now() - t00 < 200000) {
  const R = 4 + ((Math.random() * 3) | 0), C = 4 + ((Math.random() * 3) | 0), D = 4 + ((Math.random() * 6) | 0);
  const g = randGrid(R, C, D);
  const clues = cluesOf(g, R, C);
  // every fifth puzzle: a custom value palette (values with doubles)
  const paletteCase = puzzles % 5 === 4;
  let values = null;
  if (paletteCase) {
    const pool = [1, 2, 3, 4, 5, 6, 7, 9, 11].sort(() => Math.random() - 0.5).slice(0, D);
    values = [...pool];
    values.push(pool[(Math.random() * pool.length) | 0]);   // one double
  }
  // every sixth puzzle: coral (ascending clues + shape constraints)
  const coral = !paletteCase && puzzles % 6 === 5;
  if (coral) {
    // regenerate until the grid satisfies the coral shape
    let ok2 = false;
    for (let a = 0; a < 4000 && !ok2; a++) {
      const g2 = randGrid(R, C, D);
      const N2 = R * C;
      let blanks = 0, start = -1, shape = true;
      for (let i = 0; i < N2; i++) if (g2[i] === 0) { blanks++; if (start < 0) start = i; }
      for (let r = 0; r + 1 < R && shape; r++) for (let c = 0; c + 1 < C && shape; c++)
        if (g2[r * C + c] === 0 && g2[r * C + c + 1] === 0 && g2[(r + 1) * C + c] === 0 && g2[(r + 1) * C + c + 1] === 0) shape = false;
      if (shape && blanks > 0) {
        const seen = new Uint8Array(N2); const st2 = [start]; seen[start] = 1; let cnt = 0;
        while (st2.length) { const i = st2.pop(); cnt++; const r = (i / C) | 0, c = i % C;
          for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1]]) { const r2 = r + dr, c2 = c + dc;
            if (r2 < 0 || r2 >= R || c2 < 0 || c2 >= C) continue; const j = r2 * C + c2;
            if (!seen[j] && g2[j] === 0) { seen[j] = 1; st2.push(j); } } }
        if (cnt !== blanks) shape = false;
      }
      if (shape) {
        const seenF = new Uint8Array(N2); const stF = [];
        for (let i = 0; i < N2; i++) { const r = (i / C) | 0, c = i % C;
          if (g2[i] > 0 && (r === 0 || c === 0 || r === R - 1 || c === C - 1)) { seenF[i] = 1; stF.push(i); } }
        while (stF.length) { const i = stF.pop(); const r = (i / C) | 0, c = i % C;
          for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1]]) { const r2 = r + dr, c2 = c + dc;
            if (r2 < 0 || r2 >= R || c2 < 0 || c2 >= C) continue; const j = r2 * C + c2;
            if (!seenF[j] && g2[j] > 0) { seenF[j] = 1; stF.push(j); } } }
        for (let i = 0; i < N2; i++) if (g2[i] > 0 && !seenF[i]) shape = false;
      }
      if (shape) { g.set(g2); ok2 = true; }
    }
    if (!ok2) continue;
    const c2 = cluesOf(g, R, C);
    clues.rows = c2.rows.map(cl => [...cl].sort((a, b) => a - b));
    clues.cols = c2.cols.map(cl => [...cl].sort((a, b) => a - b));
  }
  // every fourth puzzle: Knapp daneben (all clues shifted one off)
  const kd = !coral && puzzles % 4 === 3;
  if (kd) {
    const shift = cl => cl.map(v => Math.random() < 0.5 && v > 1 ? v - 1 : v + 1);
    clues.rows = clues.rows.map(shift);
    clues.cols = clues.cols.map(shift);
  }
  // every third puzzle: crypto-substitute 1-2 digits with letters
  const crypto = !kd && puzzles % 3 === 2;
  if (crypto) {
    const digitsSeen = new Set();
    for (const cl of clues.rows.concat(clues.cols)) for (const v of cl) for (const ch of String(v)) digitsSeen.add(+ch);
    const pool = [...digitsSeen];
    const nL = Math.min(pool.length, 1 + ((Math.random() * 2) | 0));
    const chosen = [];
    while (chosen.length < nL && pool.length) chosen.push(pool.splice((Math.random() * pool.length) | 0, 1)[0]);
    const LET = ['A', 'B'];
    const sub = v => String(v).split('').map(ch => { const k = chosen.indexOf(+ch); return k >= 0 ? LET[k] : ch; }).join('');
    clues.rows = clues.rows.map(cl => cl.map(sub));
    clues.cols = clues.cols.map(cl => cl.map(sub));
    cryptoPuzzles++;
  }
  // union of values per cell over ALL solutions
  if (paletteCase) {
    // regenerate the grid under the palette's per-line counts
    const byVal = new Map();
    for (const v of values) byVal.set(v, (byVal.get(v) || 0) + 1);
    const pal = [...byVal.keys()].sort((a, b) => a - b), cnt2 = pal.map(v => byVal.get(v));
    const M = pal.length;
    const rcU = Array.from({ length: R }, () => new Int8Array(M));
    const ccU = Array.from({ length: C }, () => new Int8Array(M));
    for (let i = 0; i < R * C; i++) {
      const r = (i / C) | 0, c = i % C;
      const opts = [0, 0];
      for (let k2 = 1; k2 <= M; k2++) if (rcU[r][k2 - 1] < cnt2[k2 - 1] && ccU[c][k2 - 1] < cnt2[k2 - 1]) opts.push(k2);
      const k2 = opts[(Math.random() * opts.length) | 0];
      g[i] = k2 === 0 ? 0 : pal[k2 - 1];
      if (k2) { rcU[r][k2 - 1]++; ccU[c][k2 - 1]++; }
    }
    const mk = (get, n, len) => {
      const out = [];
      for (let a = 0; a < n; a++) {
        const cl = []; let run = 0, ln = 0;
        for (let b = 0; b < len; b++) { const v = get(a, b); if (v !== 0) { run += v; ln++; } else if (ln) { cl.push(run); run = 0; ln = 0; } }
        if (ln) cl.push(run);
        out.push(Math.random() < 0.2 ? null : cl);
      }
      return out;
    };
    clues.rows = mk((r, c) => g[r * C + c], R, C);
    clues.cols = mk((c, r) => g[r * C + c], C, R);
    if (kd) {
      // the earlier KD shift touched the clues we just replaced - reapply
      const shift = cl => cl && cl.map(v => Math.random() < 0.5 && v > 1 ? v - 1 : v + 1);
      clues.rows = clues.rows.map(shift);
      clues.cols = clues.cols.map(shift);
    }
  }
  const eng = E.runAny({ R, C, D, values, kd, coral, rowClues: clues.rows, colClues: clues.cols, mode: 'candidates', timeLimit: 20000, maxSolutions: 1e9 });
  if (!eng.complete || eng.solCount === 0) continue;   // skip timeouts and (defensively) unsolvable generations
  puzzles++;
  const truth = eng.cand;   // bitmask per cell
  const st = S.makeSumsState(R, C, D, values);
  st.kd = kd;
  if (coral) Object.assign(st.variants, { blankConn: true, no22blank: true, asc: true, reach: true });
  let mv, k = 0;
  let prevHash = null;
  const hashState = () => { let h = 2166136261 >>> 0; for (let i = 0; i < st.cand.length; i++) { h ^= st.cand[i]; h = Math.imul(h, 16777619) >>> 0; } for (let L = 0; L < 26; L++) { h ^= st.letterCand[L]; h = Math.imul(h, 16777619) >>> 0; } return h; };
  prevHash = hashState();
  while (k++ < 800 && (mv = S.takeSumsStep(st, { rows: clues.rows, cols: clues.cols }))) {
    steps++;
    if (!mv.contradiction) {
      const h2 = hashState();
      if (h2 === prevHash) { console.log('FAIL: no-op step (would loop forever) [' + mv.rule + ']: ' + mv.text.slice(0, 120)); fails++; break; }
      prevHash = h2;
    }
    if (mv.chain) {
      trialSteps++;
      if (!mv.chain.length || !mv.chain[mv.chain.length - 1].contradiction) { console.log('FAIL: trial without complete chain'); fails++; }
    }
    if (mv.contradiction) { console.log('FAIL: contradiction on a solvable puzzle:', mv.text.slice(0, 120)); console.log('  REPRO:', JSON.stringify({ R, C, D, values, kd, coral, rows: clues.rows, cols: clues.cols })); fails++; break; }
    // soundness: no cell may have lost a value that some solution uses
    for (let i = 0; i < R * C; i++) {
      if (truth[i] & ~st.cand[i]) {
        console.log('FAIL: unsound elimination at cell', i, 'rule [' + mv.rule + ']:', mv.text.slice(0, 140));
        fails++; k = 9999; break;
      }
    }
    // letter soundness: no letter may lose a digit some solution assigns
    if (eng.letterCand) for (let L = 0; L < 26; L++) {
      if (eng.letterCand[L] & ~st.letterCand[L]) {
        console.log('FAIL: unsound letter elimination for', String.fromCharCode(65 + L), 'rule [' + mv.rule + ']:', mv.text.slice(0, 140));
        fails++; k = 9999; break;
      }
    }
  }
  if (S.sumsComplete(st)) solved++;
}
console.log((fails ? fails + ' FAILURES' : 'ok') + ': sums soundness on ' + puzzles + ' random puzzles (' + cryptoPuzzles + ' crypto, incl KD) \u2014 ' + steps + ' steps (' + trialSteps + ' trials, all chain-narrated), ' + solved + ' fully solved by the ladder, zero unsound deductions' + (fails ? ' EXCEPT THE ABOVE' : ''));
console.log(fails ? fails + ' FAILURES' : 'ALL SUMS STEPPER TESTS PASSED');
process.exit(fails ? 1 : 0);
