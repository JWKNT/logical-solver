// Japanese Sums stepper soundness: on random puzzles, every candidate a step
// eliminates must be absent from every solution's value at that cell.
const E = require('../js/sums-engine.js');
const S = require('../js/sums-stepper.js');
// optional args: --scenarios (skip the random battery) or --battery (skip scenarios)
const ARGS = process.argv.slice(2);
const RUN_SCENARIOS = !ARGS.includes('--battery');
const RUN_BATTERY = !ARGS.includes('--scenarios');

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
if (RUN_SCENARIOS) {
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
    if (mv.rule === 'Case analysis') trials++;
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
  const eng = E.runAny({ R: 1, C: 9, D: 9, mode: 'count', timeLimit: 30000, maxSolutions: 1e9,
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
    if (/trial/i.test(mv.rule) || mv.rule === 'Case analysis') trials++;
    if (mv.contradiction) { console.log('FAIL: 12x12 hit a contradiction: ' + mv.text.slice(0, 100)); fails++; break; }
  }
  const want = { A: 3, B: 1, C: 7, D: 9, E: 5, F: 2, G: 6, H: 4, J: 0 };
  let ok = S.sumsComplete(st) && trials === 0;
  for (const [name, w] of Object.entries(want)) if (S.digitsOf2(st.letterCand[name.charCodeAt(0) - 65]).join('') !== String(w)) ok = false;
  if (!ok) { console.log('FAIL: 12x12 not rule-solved (complete=' + S.sumsComplete(st) + ', trials=' + trials + ')'); fails++; }
  else console.log('ok: 12x12 D=9 crypto (LM 0001GH) fully solved by rules alone in ' + (k - 1) + ' steps, zero trials, ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
}
{
  // checkerboard: r1c1, r2c2 blank + r1c2 digit -> r2c1 blank; and the
  // full checkerboard is a contradiction
  const st = S.makeSumsState(3, 3, 3);
  Object.assign(st.variants, { blankConn: true, no22blank: true, asc: true, reach: true });
  S.filterCand(st, 0, 1); S.filterCand(st, 4, 1); S.filterCand(st, 1, ~1);
  const mv = S.takeSumsStep(st, { rows: [null, null, null], cols: [null, null, null] });
  if (!mv || mv.rule !== 'Checkerboard' || st.cand[3] !== 1) {
    console.log('FAIL: checkerboard deduction (' + (mv && mv.rule) + ', r2c1=' + st.cand[3] + ')'); fails++;
  } else console.log('ok: "Checkerboard": ' + mv.text.slice(0, 120));
  const st2 = S.makeSumsState(3, 3, 3);
  Object.assign(st2.variants, { blankConn: true, no22blank: true, asc: true, reach: true });
  S.filterCand(st2, 0, 1); S.filterCand(st2, 4, 1); S.filterCand(st2, 1, ~1); S.filterCand(st2, 3, ~1);
  const mv2 = S.takeSumsStep(st2, { rows: [null, null, null], cols: [null, null, null] });
  if (!mv2 || !mv2.contradiction || mv2.rule !== 'Checkerboard') { console.log('FAIL: checkerboard contradiction (' + (mv2 && mv2.rule) + ')'); fails++; }
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
{
  // 10x10 palette -4..4 with signed and zero clues (a user's real puzzle that
  // once false-contradicted via a sign-blind span-algebra binder): the ladder
  // must solve it completely, zero trials, and the fill must validate
  const values = [-4, -3, -2, -1, 0, 1, 2, 3, 4];
  const P = {
    rows: [['?','-?','?','-?'], ['?',0,0,'?'], ['-??'], ['?','?','?','-?','?'], [-3,'?','?'],
           ['-?',0,0], [3,-2,'?'], [-2], [3,4], [0,'?',3]],
    cols: [[0,8], [0,0,0,0], ['-?',-3,-2], ['?','-?','?','?','?'], [-2,'?'],
           [-6,1,1], ['?','-?'], ['?',0], ['-?','-?',5,'?'], [1,0,'?','-?']]
  };
  const st = S.makeSumsState(10, 10, 0, values);
  st.noTrial = true;
  let mv, k = 0, contra = false;
  const t0 = Date.now();
  while (k++ < 600 && (mv = S.takeSumsStep(st, { rows: P.rows, cols: P.cols }))) if (mv.contradiction) { contra = true; break; }
  const valAt = i => st.cand[i] === 1 ? null : st.pal[((m2) => { for (let d = 1; d < 31; d++) if (m2 & (1 << d)) return d; })(st.cand[i]) - 1];
  function grps(cells) { const out = []; let run = 0, len = 0; for (const i of cells) { const v = valAt(i); if (v !== null) { run += v; len++; } else if (len) { out.push(run); run = 0; len = 0; } } if (len) out.push(run); return out; }
  function tokOk(t, s2) {
    if (typeof t === 'number') return t === s2;
    const str = String(t); const neg = str[0] === '-'; const body = neg ? str.slice(1) : str;
    if (str === '#') return true;
    if (neg ? s2 >= 0 : s2 < 0) return false;
    const a = Math.abs(s2);
    if (String(a).length !== body.length && !(a === 0 && body.length === 1)) return false;
    const ds = String(a).padStart(body.length, '0');
    for (let q = 0; q < body.length; q++) if (body[q] !== '?' && body[q] !== ds[q]) return false;
    return true;
  }
  let valid = !contra && S.sumsComplete(st);
  if (valid) {
    for (let r = 0; r < 10 && valid; r++) { const gs = grps(Array.from({length: 10}, (_, c) => r * 10 + c)); const cl = P.rows[r]; if (gs.length !== cl.length || !gs.every((s2, q) => tokOk(cl[q], s2))) valid = false; }
    for (let c = 0; c < 10 && valid; c++) { const gs = grps(Array.from({length: 10}, (_, r) => r * 10 + c)); const cl = P.cols[c]; if (gs.length !== cl.length || !gs.every((s2, q) => tokOk(cl[q], s2))) valid = false; }
  }
  if (!valid) { console.log('FAIL: signed 10x10 palette puzzle (contra=' + contra + ', complete=' + S.sumsComplete(st) + ', steps=' + (k - 1) + ')'); fails++; }
  else console.log('ok: signed 10x10 palette -4..4 fully rule-solved in ' + (k - 1) + ' steps, zero trials, ' + ((Date.now() - t0) / 1000).toFixed(1) + 's, fill validates');
}
{
  // Shaded escape: row 1's separator stretch must reach the shaded cells below - with
  // r2c4..r2c7 walled off, layouts sealing the gap inside c4..c7 are dead
  // (the user's 10x10 shaded-connected position, stall regression)
  const P = {
    rows: [[20,'??'], [40], ['??','??'], ['?',6], [4,'??','?',5], ['?','?','?'], ['?',8,'?'], [23,'?','?'], [2,'?',3,6], [13,5]],
    cols: [['?',12,9], ['?',21], [16,'??','?'], [17,'??'], [11,14], ['?',4], ['?','??','??'], ['?','??','?'], ['?',6], ['?',21]]
  };
  const st = S.makeSumsState(10, 10, 9);
  Object.assign(st.variants, { blankConn: true, no22blank: true, reach: true });
  st.noTrial = true;
  let mv, k = 0, escFired = false, contra = false;
  while (k++ < 200 && (mv = S.takeSumsStep(st, P))) {
    if (mv.rule === 'Shaded escape') escFired = true;
    if (mv.contradiction) { contra = true; break; }
  }
  const used = i => (st.cand[i] & 1) === 0;
  if (!escFired || contra || !used(8) || !used(9)) {
    console.log('FAIL: shaded escape regression (fired=' + escFired + ', contra=' + contra + ', r1c9 used=' + used(8) + ', r1c10 used=' + used(9) + ')'); fails++;
  } else console.log('ok: "Shaded escape" seals row 1\'s pocket layouts; r1c9, r1c10 forced used, no contradiction');

  // with trials on, the whole shaded-connected puzzle must fall to the ladder: the stall
  // in the middle (r1c8's shaded stretch must escape DOWN through r2c8 -
  // escaping left would run to r1c3 and leave no room for the 20) is broken
  // by a Shading trial (suppose the cell held a digit - contradiction)
  {
    const st2 = S.makeSumsState(10, 10, 9);
    Object.assign(st2.variants, { blankConn: true, no22blank: true, reach: true });
    let mv2, k2 = 0, contra2 = false, shadeTrials = 0, badChain = 0;
    const t0 = Date.now();
    while (k2++ < 600 && (mv2 = S.takeSumsStep(st2, P))) {
      if (mv2.rule === 'Shading trial') {
        shadeTrials++;
        if (!mv2.chain || !mv2.chain.length || !mv2.chain[mv2.chain.length - 1].contradiction) badChain++;
      }
      if (mv2.contradiction) { contra2 = true; break; }
    }
    const blank = i => st2.cand[i] === 1;
    let valid = !contra2 && S.sumsComplete(st2) && blank(17);   // r2c8 shaded: the escape goes down
    // validate the fill: clue groups and shape constraints
    const valAt = i => st2.cand[i] === 1 ? 0 : S.digitsOf(st2.cand[i])[0];
    const grps = cells => { const out = []; let run = 0, len = 0; for (const i of cells) { const v = valAt(i); if (v) { run += v; len++; } else if (len) { out.push(run); run = 0; len = 0; } } if (len) out.push(run); return out; };
    const tokOk = (t, s2) => typeof t === 'number' ? t === s2 : String(t).length === String(s2).length && [...String(t)].every((ch, q) => ch === '?' || ch === String(s2)[q]);
    if (valid) {
      for (let r = 0; r < 10 && valid; r++) { const gs = grps(Array.from({ length: 10 }, (_, c) => r * 10 + c)); if (gs.length !== P.rows[r].length || !gs.every((s2, q) => tokOk(P.rows[r][q], s2))) valid = false; }
      for (let c = 0; c < 10 && valid; c++) { const gs = grps(Array.from({ length: 10 }, (_, r) => r * 10 + c)); if (gs.length !== P.cols[c].length || !gs.every((s2, q) => tokOk(P.cols[c][q], s2))) valid = false; }
      for (let r = 0; r + 1 < 10 && valid; r++) for (let c = 0; c + 1 < 10; c++) if (!valAt(r * 10 + c) && !valAt(r * 10 + c + 1) && !valAt(r * 10 + c + 10) && !valAt(r * 10 + c + 11)) valid = false;
      const conn = memb => { let start = -1, tot = 0; for (let i = 0; i < 100; i++) if (memb(i)) { tot++; if (start < 0) start = i; } if (!tot) return true; const seen = new Uint8Array(100), stk = [start]; seen[start] = 1; let n = 0; while (stk.length) { const i = stk.pop(); n++; const r = (i / 10) | 0, c = i % 10; for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const r2 = r + dr, c2 = c + dc; if (r2 < 0 || r2 > 9 || c2 < 0 || c2 > 9) continue; const j = r2 * 10 + c2; if (!seen[j] && memb(j)) { seen[j] = 1; stk.push(j); } } } return n === tot; };
      if (!conn(i => !valAt(i))) valid = false;
    }
    if (valid) {
      // the engine, given the completed grid, must accept it (clues + shape)
      const eng = E.runAny({ R: 10, C: 10, D: 9, variants: { blankConn: true, no22blank: true, reach: true },
        rowClues: P.rows, colClues: P.cols, candMask: Array.from(st2.cand), mode: 'count', timeLimit: 60000, maxSolutions: 5 });
      if (eng.solCount !== 1) { valid = false; console.log('  engine rejects the fill (' + eng.solCount + ' solutions)'); }
    }
    if (!valid || badChain || !shadeTrials) {
      console.log('FAIL: 10x10 shaded-connected full solve (complete=' + S.sumsComplete(st2) + ', contra=' + contra2 + ', r2c8 blank=' + blank(17) + ', shadeTrials=' + shadeTrials + ', badChain=' + badChain + ', steps=' + (k2 - 1) + ')'); fails++;
    } else console.log('ok: 10x10 shaded-connected puzzle fully solved in ' + (k2 - 1) + ' steps (' + shadeTrials + ' shading trials, all chain-narrated), r2c8\u2019s escape-down forced, fill validates + engine-confirmed, ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  }
}
{
  // the user's ascending 10x10 (image 2): the mid-solve stall is broken by
  // Case analysis - one of r3c9/r3c10 holds row 3's fifth group, and in both
  // cases the C9/C10 clue cap of 9 forces that column's r2..r4 run to 6-1-2;
  // deductions every case agrees on stand (both chains narrated)
  const P = {
    rows: [['#',12,'#'], ['#',15,'#'], ['#','#',7,'#','#'], [7,'#','#',7], ['#',8,'#'],
           [6,'#','#',8], [21,'#'], [9,24], ['#','#',3], [7,'#',20]],
    cols: [[4,'#','#',9], [5,'#',22], [8,'#','#',8], ['#',10], [13,'#',16],
           ['#',12,15], [1,16,18], ['#'], ['#',9,9], ['#',7,'#',9]]
  };
  const st = S.makeSumsState(10, 10, 9);
  Object.assign(st.variants, { asc: true });
  let mv, k = 0, contra = false, merges = 0, badCases = 0;
  const t0 = Date.now();
  while (k++ < 800 && (mv = S.takeSumsStep(st, P))) {
    if (mv.rule === 'Case analysis' && mv.cases) {
      merges++;
      if (mv.cases.length < 2 || mv.cases.some(cs => !Array.isArray(cs.chain))) badCases++;
    }
    if (mv.contradiction) { contra = true; break; }
  }
  const valAt = i => st.cand[i] === 1 ? 0 : S.digitsOf(st.cand[i])[0];
  let valid = !contra && S.sumsComplete(st);
  // the user's waypoint: column 9 carries the 6-1-2 run under the cap of 9
  if (valid && !(valAt(18) === 6 && valAt(28) === 1 && valAt(38) === 2 && valAt(19) === 9)) valid = false;
  if (valid) {
    const grps = cells => { const out = []; let run = 0, len = 0; for (const i of cells) { const v = valAt(i); if (v) { run += v; len++; } else if (len) { out.push(run); run = 0; len = 0; } } if (len) out.push(run); return out; };
    const matchAsc = (tokens, sums) => { if (tokens.length !== sums.length) return false; const s2 = [...sums].sort((a, b) => a - b); return tokens.every((t, q) => t === '#' || t === s2[q]); };
    for (let r = 0; r < 10 && valid; r++) if (!matchAsc(P.rows[r], grps(Array.from({ length: 10 }, (_, c) => r * 10 + c)))) valid = false;
    for (let c = 0; c < 10 && valid; c++) if (!matchAsc(P.cols[c], grps(Array.from({ length: 10 }, (_, r) => r * 10 + c)))) valid = false;
  }
  if (valid) {
    const eng = E.runAny({ R: 10, C: 10, D: 9, variants: { asc: true },
      rowClues: P.rows, colClues: P.cols, candMask: Array.from(st.cand), mode: 'count', timeLimit: 60000, maxSolutions: 5 });
    if (eng.solCount !== 1) { valid = false; console.log('  engine rejects the ascending fill (' + eng.solCount + ' solutions)'); }
  }
  if (!valid || !merges || badCases) {
    console.log('FAIL: ascending 10x10 case-analysis solve (complete=' + S.sumsComplete(st) + ', contra=' + contra + ', merges=' + merges + ', badCases=' + badCases + ', steps=' + (k - 1) + ')'); fails++;
  } else console.log('ok: ascending 10x10 fully solved in ' + (k - 1) + ' steps via ' + merges + ' Case analyses (both chains narrated), col 9 = 6-1-2 under the cap of 9, fill validates + engine-confirmed, ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
}
{
  // Shaded spine: a pocket that cannot reach the only line forced to hold a
  // shaded cell must be all digits
  const st = S.makeSumsState(3, 3, 3);
  Object.assign(st.variants, { blankConn: true });
  // row 1 clue [1, 1] forces a shaded cell in row 1; wall row 2 solid
  S.filterCand(st, 3, ~1); S.filterCand(st, 4, ~1); S.filterCand(st, 5, ~1);
  let mv, k = 0, fired = false;
  while (k++ < 30 && (mv = S.takeSumsStep(st, { rows: [[1, 1], null, null], cols: [null, null, null] }))) {
    if (mv.rule === 'Shaded spine') { fired = true; break; }
    if (mv.contradiction) break;
  }
  const row3Used = [6, 7, 8].every(i => fired && true);
  if (!fired) { console.log('FAIL: shaded spine did not fire on the sealed pocket'); fails++; }
  else {
    mv.apply && mv.apply();
    const dead = [6, 7, 8].filter(i => (st.cand[i] & 1) === 0);
    if (dead.length === 0) { console.log('FAIL: shaded spine fired but freed no pocket cells'); fails++; }
    else console.log('ok: "Shaded spine": ' + mv.text.slice(0, 150));
  }
}
{
  // multiplicity-aware Equal groups: palette 1,2,3,4,5,5,6,7,8,9,9 - four 'U'
  // groups with U=5 pack as {5},{5},{1,4},{2,3} using both 5-copies; the old
  // strictly-disjoint packer falsely eliminated 5
  const values = [1, 2, 3, 4, 5, 5, 6, 7, 8, 9, 9];
  const st = S.makeSumsState(13, 13, 0, values);
  const cols = Array(13).fill(null);
  cols[7] = ['U', 'U', 'U', 'U', 'WU'];
  let mv, k = 0, contra = false;
  while (k++ < 40 && (mv = S.takeSumsStep(st, { rows: Array(13).fill(null), cols }))) if (mv.contradiction) { contra = true; break; }
  const uc = st.letterCand['U'.charCodeAt(0) - 65];
  if (contra || !(uc & (1 << 5))) { console.log('FAIL: doubled-values Equal groups (contra=' + contra + ', U mask=' + uc.toString(2) + ')'); fails++; }
  else console.log('ok: four U-groups with doubled 5s keep U=5 ({5},{5},{1,4},{2,3})');
}
{
  // dual checkerboard: numbers connected + shaded reach edge also bans it
  const st = S.makeSumsState(3, 3, 3);
  Object.assign(st.variants, { numConn: true, blankReach: true });
  S.filterCand(st, 0, 1); S.filterCand(st, 4, 1); S.filterCand(st, 1, ~1);
  const mv = S.takeSumsStep(st, { rows: [null, null, null], cols: [null, null, null] });
  if (!mv || mv.rule !== 'Checkerboard' || st.cand[3] !== 1) { console.log('FAIL: dual checkerboard (' + (mv && mv.rule) + ')'); fails++; }
  else console.log('ok: dual checkerboard fires under numbers-connected + shaded-reach: ' + mv.text.slice(0, 110));
}
{
  // shaded reach edge: a center-committed blank whose escapes are cut
  const st = S.makeSumsState(3, 3, 3);
  Object.assign(st.variants, { blankReach: true });
  S.filterCand(st, 4, 1);                       // center blank
  S.filterCand(st, 1, ~1); S.filterCand(st, 3, ~1); S.filterCand(st, 5, ~1);   // three exits are digits
  const mv = S.takeSumsStep(st, { rows: [null, null, null], cols: [null, null, null] });
  if (!mv || mv.rule !== 'Shaded reach edge' || st.cand[7] !== 1) { console.log('FAIL: shaded reach (' + (mv && mv.rule) + ', r3c2=' + st.cand[7] + ')'); fails++; }
  else console.log('ok: \"Shaded reach edge\": ' + mv.text.slice(0, 120));
}
{
  // Sum cap under ascending clues: last token 9 caps every group; a committed
  // 7 caps its would-be neighbours at 2
  const st = S.makeSumsState(10, 10, 9);
  st.variants.asc = true;
  S.filterCand(st, 30, 1 << 7);
  const cols = Array(10).fill(null);
  cols[0] = ['#', '#', 9];
  let mv, k = 0, saw = false;
  while (k++ < 12 && (mv = S.takeSumsStep(st, { rows: Array(10).fill(null), cols }))) {
    if (mv.rule === 'Sum cap') saw = true;
    if (mv.contradiction) break;
  }
  const m20 = st.cand[20];
  const vals20 = ((m20 & 1) ? 'b' : '') + S.digitsOf(m20).map(x => st.pal[x - 1]).join('');
  if (!saw || vals20 !== 'b12') { console.log('FAIL: Sum cap (saw=' + saw + ', r3c1=' + vals20 + ')'); fails++; }
  else console.log('ok: \"Sum cap\": ascending last-token 9 pins the 7\u2019s neighbours to 1/2/blank');
}
{
  // ascending Group combinations: a delimited 3-run holding a 6 in a column
  // whose largest clue is 9 forces its open cells to {1,2}
  const st = S.makeSumsState(10, 10, 9);
  st.variants.asc = true;
  const cols = Array(10).fill(null);
  cols[8] = ['#', 9, 9];
  S.filterCand(st, 8, 1); S.filterCand(st, 48, 1);
  S.filterCand(st, 18, 1 << 6); S.filterCand(st, 28, ~1); S.filterCand(st, 38, ~1);
  S.filterCand(st, 58, ~1); S.filterCand(st, 68, 1);
  S.filterCand(st, 78, ~1); S.filterCand(st, 88, 1); S.filterCand(st, 98, 1);
  let mv, k = 0;
  while (k++ < 15 && (mv = S.takeSumsStep(st, { rows: Array(10).fill(null), cols }))) if (mv.contradiction) break;
  const v = i => S.digitsOf(st.cand[i]).map(x => st.pal[x - 1]).join('');
  if (v(28) !== '12' || v(38) !== '12') { console.log('FAIL: asc combos 6-1-2 (r3c9=' + v(28) + ', r4c9=' + v(38) + ')'); fails++; }
  else console.log('ok: ascending combos: 3-run with a 6 under cap 9 pins its mates to {1,2}');
}
}
let steps = 0, trialSteps = 0, solved = 0, puzzles = 0, cryptoPuzzles = 0;
const t00 = Date.now();
while (RUN_BATTERY && puzzles < 24 && Date.now() - t00 < 200000) {
  const R = 4 + ((Math.random() * 3) | 0), C = 4 + ((Math.random() * 3) | 0), D = 4 + ((Math.random() * 6) | 0);
  const g = randGrid(R, C, D);
  const clues = cluesOf(g, R, C);
  // every fifth puzzle: a custom value palette (values with doubles)
  const paletteCase = puzzles % 5 === 4;
  let values = null;
  if (paletteCase) {
    const base = (puzzles % 10 === 9)
      ? [-3, -2, -1, 0, 1, 2, 3, 4, 5]    // negatives and a placeable zero
      : [1, 2, 3, 4, 5, 6, 7, 9, 11];
    const pool = base.sort(() => Math.random() - 0.5).slice(0, D);
    values = [...pool];
    values.push(pool[(Math.random() * pool.length) | 0]);   // one double
  }
  // every sixth puzzle: shape variants (ascending clues + connectivity)
  const shaped = !paletteCase && puzzles % 6 === 5;
  if (shaped) {
    // regenerate until the grid satisfies the shape constraints
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
  const kd = !shaped && puzzles % 4 === 3;
  if (kd) {
    const shift = cl => cl.map(v => Math.random() < 0.5 && v > 1 ? v - 1 : v + 1);
    clues.rows = clues.rows.map(shift);
    clues.cols = clues.cols.map(shift);
  }
  // every third puzzle: crypto-substitute 1-2 digits with letters
  const crypto = !kd && !shaped && puzzles % 3 === 2;   // palettes and crypto DO combine
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
  const eng = E.runAny({ R, C, D, values, kd, variants: shaped ? { blankConn: true, no22blank: true, asc: true, reach: true } : undefined, rowClues: clues.rows, colClues: clues.cols, mode: 'candidates', timeLimit: 20000, maxSolutions: 1e9 });
  if (!eng.complete || eng.solCount === 0) continue;   // skip timeouts and (defensively) unsolvable generations
  puzzles++;
  const truth = eng.cand;   // bitmask per cell
  const st = S.makeSumsState(R, C, D, values);
  st.kd = kd;
  if (shaped) Object.assign(st.variants, { blankConn: true, no22blank: true, asc: true, reach: true });
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
    if (mv.cases) {
      trialSteps++;
      if (mv.cases.length < 2 || mv.cases.some(cs => !cs.intro || !Array.isArray(cs.chain))) { console.log('FAIL: case analysis without narrated cases'); fails++; }
    }
    if (mv.contradiction) { console.log('FAIL: contradiction on a solvable puzzle:', mv.text.slice(0, 120)); console.log('  REPRO:', JSON.stringify({ R, C, D, values, kd, shaped, rows: clues.rows, cols: clues.cols })); fails++; break; }
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
