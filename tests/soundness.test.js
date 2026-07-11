const { runSolve, runStep } = require('./engine-node.js');
const ST = require('../js/stepper.js');

// ---------- brute force enumeration (ground truth) ----------
function degOf(R, C, rE, dE, r, c) {
  const i = r * C + c;
  return (c < C - 1 ? rE[i] : 0) + (c > 0 ? rE[i - 1] : 0) + (r < R - 1 ? dE[i] : 0) + (r > 0 ? dE[i - C] : 0);
}
function shapeOf(R, C, rE, dE, r, c) {
  const i = r * C + c;
  const Rt = c < C - 1 ? rE[i] : 0, L = c > 0 ? rE[i - 1] : 0, Dn = r < R - 1 ? dE[i] : 0, U = r > 0 ? dE[i - C] : 0;
  const deg = Rt + L + Dn + U;
  if (deg === 4) return 0; if (deg === 3) return 1;
  if (deg === 2) return ((L && Rt) || (U && Dn)) ? 2 : 3;
  return -1;
}
function allSolutions(R, C, rowClue, colClue, blocked, rowEmptyG, colEmptyG) {
  const nR = R * (C - 1), nD = (R - 1) * C, T = nR + nD, N = R * C, sols = [];
  for (let mask = 1; mask < (1 << T); mask++) {
    const rE = new Uint8Array(N), dE = new Uint8Array(N);
    let k = 0;
    for (let r = 0; r < R; r++) for (let c = 0; c < C - 1; c++) { if (mask & (1 << k)) rE[r * C + c] = 1; k++; }
    for (let r = 0; r < R - 1; r++) for (let c = 0; c < C; c++) { if (mask & (1 << k)) dE[r * C + c] = 1; k++; }
    let ok = true; const used = [];
    for (let r = 0; r < R && ok; r++) for (let c = 0; c < C && ok; c++) {
      const d = degOf(R, C, rE, dE, r, c);
      if (d === 1) ok = false;
      if (d > 0) { if (blocked[r * C + c]) ok = false; used.push(r * C + c); }
    }
    if (!ok || !used.length) continue;
    const seen = new Set([used[0]]); const q = [used[0]];
    while (q.length) {
      const i = q.pop(); const r = (i / C) | 0, c = i - r * C;
      if (c < C - 1 && rE[i] && !seen.has(i + 1)) { seen.add(i + 1); q.push(i + 1); }
      if (c > 0 && rE[i - 1] && !seen.has(i - 1)) { seen.add(i - 1); q.push(i - 1); }
      if (r < R - 1 && dE[i] && !seen.has(i + C)) { seen.add(i + C); q.push(i + C); }
      if (r > 0 && dE[i - C] && !seen.has(i - C)) { seen.add(i - C); q.push(i - C); }
    }
    if (seen.size !== used.length) continue;
    for (let r = 0; r < R && ok; r++) {
      const cnt = [0, 0, 0, 0, 0];
      for (let c = 0; c < C; c++) { const s = shapeOf(R, C, rE, dE, r, c); if (s >= 0) cnt[s]++; else cnt[4]++; }
      for (let s = 0; s < 4; s++) if (rowClue[r * 4 + s] >= 0 && cnt[s] !== rowClue[r * 4 + s]) ok = false;
      if (rowEmptyG && rowEmptyG[r] >= 0 && cnt[4] !== rowEmptyG[r]) ok = false;
    }
    for (let c = 0; c < C && ok; c++) {
      const cnt = [0, 0, 0, 0, 0];
      for (let r = 0; r < R; r++) { const s = shapeOf(R, C, rE, dE, r, c); if (s >= 0) cnt[s]++; else cnt[4]++; }
      for (let s = 0; s < 4; s++) if (colClue[c * 4 + s] >= 0 && cnt[s] !== colClue[c * 4 + s]) ok = false;
      if (colEmptyG && colEmptyG[c] >= 0 && cnt[4] !== colEmptyG[c]) ok = false;
    }
    if (ok) sols.push({ rE, dE });
  }
  return sols;
}

function cluesFrom(R, C, rE, dE) {
  const rowClue = new Array(R * 4).fill(0), colClue = new Array(C * 4).fill(0);
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const s = shapeOf(R, C, rE, dE, r, c);
    if (s >= 0) { rowClue[r * 4 + s]++; colClue[c * 4 + s]++; }
  }
  return { rowClue, colClue };
}
const blank = n => new Array(n).fill(-1);
let fails = 0;
let trialCount = 0;

// check every ground-truth solution is still compatible with the step state
function compatible(st, sols, R, C) {
  const armMaskAt = (sol, i) => {
    const r = (i / C) | 0, c = i - r * C;
    let m = 0;
    if (r > 0 && sol.dE[i - C]) m |= 1;
    if (c < C - 1 && sol.rE[i]) m |= 2;
    if (r < R - 1 && sol.dE[i]) m |= 4;
    if (c > 0 && sol.rE[i - 1]) m |= 8;
    return m;
  };
  for (const sol of sols) {
    for (let i = 0; i < R * C; i++) {
      const r = (i / C) | 0, c = i - r * C;
      if (c < C - 1 && st.edgeR[i] >= 0 && st.edgeR[i] !== sol.rE[i]) return 'edgeR@' + i;
      if (r < R - 1 && st.edgeD[i] >= 0 && st.edgeD[i] !== sol.dE[i]) return 'edgeD@' + i;
      const m = armMaskAt(sol, i);
      const k = ST.CFGS.indexOf(m);
      if (k < 0 || !((st.cellCfg[i] >> k) & 1)) return 'cellCfg@' + i + ' mask ' + m;
    }
  }
  return null;
}

// full step loop: human rules, then engine fallback; verify soundness after every step
function runLoop(R, C, rowClue, colClue, blockedGrid, sols, label, rowEmptyG, colEmptyG) {
  let lastMove = null;
  const clues = { row: [], col: [] };
  for (let r = 0; r < R; r++) { const a = rowClue.slice(r * 4, r * 4 + 4); a.push(rowEmptyG ? rowEmptyG[r] : -1); clues.row.push(a); }
  for (let c = 0; c < C; c++) { const a = colClue.slice(c * 4, c * 4 + 4); a.push(colEmptyG ? colEmptyG[c] : -1); clues.col.push(a); }
  const st = ST.makeStepState(R, C, blockedGrid);
  const blk = new Uint8Array(R * C);
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (blockedGrid[r][c]) blk[r * C + c] = 1;
  let steps = 0, human = 0, engine = 0;
  for (; steps < 500; steps++) {
    if (ST.isComplete(st)) break;
    const move = ST.takeHumanStep(st, clues); lastMove = move;
    if (move && ['Shape trial', 'Border trial', 'Cell trial', 'Shape hypothesis'].includes(move.rule)) { trialCount++; if (!move.chain || !move.chain.length || !move.chain[move.chain.length - 1].contradiction) { console.log('FAIL: a trial refutation without a complete chain'); fails++; } } else if (move && move.rule === 'Case agreement') { trialCount++; if (!/share|agree/.test(move.text)) { console.log('FAIL: a case-agreement move without agreement text'); fails++; } }
    if (move) {
      if (move.contradiction) return { result: 'contradiction', steps, human, engine };
      human++;
    } else {
      const res = runStep({ R, C, rowClue, colClue, rowEmpty: rowEmptyG || undefined, colEmpty: colEmptyG || undefined, blocked: blk, mode: 'step', timeLimit: 20000, fixR: st.edgeR, fixD: st.edgeD }, null);
      if (res.result === 'fact') { ST.setEdge(st, res.kind, res.index, res.val); engine++; }
      else if (res.result === 'contradiction') return { result: 'contradiction', steps, human, engine };
      else return { result: res.result, steps, human, engine };
    }
    if (sols) {
      const bad = compatible(st, sols, R, C);
      if (bad) {
        console.log('FAIL[' + label + ']: step ' + steps + ' broke a real solution (' + bad + ') via [' + (lastMove && lastMove.rule) + '] ' + (lastMove && lastMove.text));
        fails++;
        return { result: 'unsound', steps, human, engine };
      }
    }
  }
  return { result: ST.isComplete(st) ? 'complete' : 'stalled', steps, human, engine, st };
}

// ---- Test 1: random 3x4 and 4x4 puzzles, full & partial clues: soundness of every step ----
{
  let humanTotal = 0, engineTotal = 0, done = 0;
  for (let t = 0; t < 24; t++) {
    const R = t % 2 ? 4 : 3, C = 4;
    const blockedGrid = [];
    for (let r = 0; r < R; r++) blockedGrid.push(new Array(C).fill(false));
    if (t % 5 === 0) blockedGrid[(Math.random() * R) | 0][(Math.random() * C) | 0] = true;
    const blk = new Uint8Array(R * C);
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (blockedGrid[r][c]) blk[r * C + c] = 1;
    const gen = runSolve({ R, C, rowClue: blank(R * 4), colClue: blank(C * 4), blocked: blk, mode: 'random', randomize: true, timeLimit: 5000 }, null);
    if (!gen.firstR) continue;
    const { rowClue, colClue } = cluesFrom(R, C, gen.firstR, gen.firstD);
    // empty-cell clues (shaded cells count as empty) on half the trials
    let rowEmptyG = null, colEmptyG = null;
    if (t % 2 === 0) {
      rowEmptyG = new Array(R).fill(0); colEmptyG = new Array(C).fill(0);
      for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (shapeOf(R, C, gen.firstR, gen.firstD, r, c) < 0) { rowEmptyG[r]++; colEmptyG[c]++; }
      for (let r = 0; r < R; r++) if (Math.random() < 0.4) rowEmptyG[r] = -1;
      for (let c = 0; c < C; c++) if (Math.random() < 0.4) colEmptyG[c] = -1;
    }
    if (t >= 12) {
      for (let i = 0; i < rowClue.length; i++) if (Math.random() < 0.5) rowClue[i] = -1;
      for (let i = 0; i < colClue.length; i++) if (Math.random() < 0.5) colClue[i] = -1;
    }
    const sols = allSolutions(R, C, rowClue, colClue, blk, rowEmptyG, colEmptyG);
    if (!sols.length) continue;
    const out = runLoop(R, C, rowClue, colClue, blockedGrid, sols, 'trial ' + t, rowEmptyG, colEmptyG);
    if (out.result === 'unsound') continue;
    humanTotal += out.human; engineTotal += out.engine; done++;
    if (sols.length === 1 && out.result !== 'complete') {
      console.log('FAIL: unique puzzle (trial ' + t + ') did not reach completion: ' + out.result); fails++;
    }
    if (out.result === 'complete') {
      // final state must equal the unique surviving solution
      if (sols.length !== 1) { console.log('FAIL: completed a puzzle with ' + sols.length + ' solutions (trial ' + t + ')'); fails++; }
    }
  }
  console.log('ok: step soundness on ' + done + ' random puzzles \u2014 ' + humanTotal + ' human steps (' + trialCount + ' trials, all chain-narrated), ' + engineTotal + ' engine fallback steps, zero unsound deductions' + (fails ? ' (see failures)' : ''));
}

// ---- Test 2: contradictory clues are detected ----
{
  const R = 3, C = 3;
  const rowClue = blank(12), colClue = blank(12);
  rowClue[0 * 4 + 0] = 3;  // three crosses in the top row: impossible
  const blockedGrid = [[false, false, false], [false, false, false], [false, false, false]];
  const out = runLoop(R, C, rowClue, colClue, blockedGrid, null, 'contradiction');
  if (out.result !== 'contradiction') { console.log('FAIL: contradictory clues not detected, got ' + out.result); fails++; }
  else console.log('ok: contradictory clues detected after ' + out.steps + ' step(s)');
}

// ---- Test 3: guide scenarios fire the intended named rules ----
{
  // zero-clue elimination (guide image 1): straights=0 in a row
  const R = 3, C = 4;
  const clues = { row: [[-1, -1, 0, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]], col: [[-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]] };
  const st = ST.makeStepState(R, C, [[false, false, false, false], [false, false, false, false], [false, false, false, false]]);
  const mv = ST.takeHumanStep(st, clues);
    if (!mv || mv.rule !== 'Clue satisfied') { console.log('FAIL: zero-clue case fired ' + (mv && mv.rule)); fails++; }
  else console.log('ok: zero clue -> "' + mv.rule + '": ' + mv.text);
}
{
  // segment endpoints (turns=0, branches=0 in a middle row -> no horizontal connections there)
  const R = 5, C = 6;
  const mkR = () => [-1, -1, -1, -1];
  const clues = { row: [mkR(), mkR(), [-1, 0, -1, 0], mkR(), mkR()], col: Array.from({ length: C }, mkR) };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  let mv, found = null;
  for (let k = 0; k < 200 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.rule === 'Segment endpoints') { found = mv; break; } if (mv.contradiction) break; }
  if (!found) { console.log('FAIL: segment-endpoints rule never fired'); fails++; }
  else console.log('ok: "' + found.rule + '": ' + found.text);
}
{
  // segment capacity (guide image 3: five straights in a width-6 row -> no horizontal connections)
  const R = 5, C = 6;
  const mkR = () => [-1, -1, -1, -1];
  const clues = { row: [mkR(), mkR(), [-1, -1, 5, -1], mkR(), mkR()], col: Array.from({ length: C }, mkR) };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  let mv, found = null;
  for (let k = 0; k < 200 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.rule === 'Segment capacity') { found = mv; break; } if (mv.contradiction) break; }
  if (!found) { console.log('FAIL: segment-capacity rule never fired'); fails++; }
  else console.log('ok: "' + found.rule + '": ' + found.text);
}
{
  // branch orientation via clue parity (interior row: 1 turn + 1 branch -> the branch is vertical)
  const R = 4, C = 6;
  const mk = () => [-1, -1, -1, -1];
  const clues = { row: [mk(), [-1, 1, -1, 1], mk(), mk()], col: Array.from({ length: C }, mk) };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  let mv, found = null;
  for (let k = 0; k < 80 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.rule === 'Branch orientation') { found = mv; break; } if (mv.contradiction) break; }
  if (!found) { console.log('FAIL: branch orientation rule never fired'); fails++; }
  else console.log('ok: "' + found.rule + '": ' + found.text);
}
{
  // edge-row parity contradiction (guide basic deduction 1: edge rows have an even number of turns)
  const R = 4, C = 6;
  const mk = () => [-1, -1, -1, -1];
  const clues = { row: [[-1, -1, -1, 3], mk(), mk(), mk()], col: Array.from({ length: C }, mk) };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  let mv, found = null;
  for (let k = 0; k < 80 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.contradiction) { found = mv; break; } }
  if (!found || found.rule !== 'Perpendicular-branch parity') { console.log('FAIL: edge-row odd turns not caught, got ' + (found && found.rule)); fails++; }
  else console.log('ok (edge-row even turns): "' + found.rule + '": ' + found.text);
}
{
  // perpendicular-branch parity placement (guide: odd turns -> at least 1 perpendicular branch, one candidate)
  const R = 3, C = 5;
  const mk = () => [-1, -1, -1, -1];
  const clues = { row: [mk(), [-1, -1, -1, 1], mk()], col: Array.from({ length: C }, mk) };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  const pc = m => { let n = 0; while (m) { n += m & 1; m >>= 1; } return n; };
  const isVB = m => pc(m) === 3 && (m & 1) && (m & 4);
  for (let c = 0; c < 4; c++) ST.filterCfg(st, 1 * 5 + c, m => !isVB(m));   // only r2c5 can still be a vertical branch
  let mv, found = null;
  for (let k = 0; k < 80 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.rule === 'Perpendicular-branch parity' && !mv.contradiction) { found = mv; break; } if (mv.contradiction) break; }
  if (!found) { console.log('FAIL: perpendicular-branch parity placement never fired'); fails++; }
  else {
    console.log('ok: "' + found.rule + '": ' + found.text);
    const cls = ST.cellClasses(st, 1 * 5 + 4);
    if (cls !== (1 << 1)) { console.log('FAIL: r2c5 not committed to branch'); fails++; }
  }
}
{
  // cross pigeonhole (guide: N crosses limited to N+1 cells)
  const R = 3, C = 5;
  const mk = () => [-1, -1, -1, -1];
  const clues = { row: [mk(), [2, -1, -1, -1], mk()], col: Array.from({ length: C }, mk) };
  clues.col[0][0] = 0; clues.col[4][0] = 0;   // crosses in row 2 limited to the middle 3 cells
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  let mv, found = null;
  for (let k = 0; k < 80 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.rule === 'Pigeonhole connection') { found = mv; break; } if (mv.contradiction) break; }
  if (!found) { console.log('FAIL: pigeonhole never fired'); fails++; }
  else {
    console.log('ok: "' + found.rule + '": ' + found.text);
    if (st.edgeR[1 * 5 + 1] !== 1 || st.edgeR[1 * 5 + 2] !== 1) { console.log('FAIL: pigeonhole borders not drawn'); fails++; }
  }
}
{
  // single segment (guide: edge line with 2 turns -> 1 segment; known line cells connect)
  const R = 4, C = 6;
  const mk = () => [-1, -1, -1, -1];
  const clues = { row: [[-1, -1, -1, 2], mk(), mk(), mk()], col: Array.from({ length: C }, mk) };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  ST.setEdge(st, 0, 1, 1);   // r1c2-r1c3 carries a line
  ST.setEdge(st, 0, 3, 1);   // r1c4-r1c5 carries a line
  let mv, found = null;
  for (let k = 0; k < 80 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.rule === 'Single segment') { found = mv; break; } if (mv.contradiction) break; }
  if (!found) { console.log('FAIL: single segment never fired'); fails++; }
  else {
    console.log('ok: "' + found.rule + '": ' + found.text);
    if (st.edgeR[2] !== 1) { console.log('FAIL: single segment did not bridge the gap'); fails++; }
  }
}
{
  // region parity (guide advanced parity: one open boundary border of a row is forced)
  const R = 4, C = 6;
  const mk = () => [-1, -1, -1, -1];
  const clues = { row: [mk(), [-1, 1, -1, -1], mk(), mk()], col: Array.from({ length: C }, mk) };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  // boundary of row 2: three lines enter from above (non-adjacent branch candidates,
  // so the pigeonhole cannot pre-empt); every other border known except below r2c6
  ST.setEdge(st, 1, 1, 1); ST.setEdge(st, 1, 2, 1); ST.setEdge(st, 1, 4, 1);   // exits above c2,c3,c5
  ST.setEdge(st, 1, 0, 0); ST.setEdge(st, 1, 3, 0); ST.setEdge(st, 1, 5, 0);
  for (let c = 0; c < 5; c++) ST.setEdge(st, 1, 6 + c, 0);                     // below c1..c5 off, below c6 open
  // 1 branch and 3 known exits (odd = odd), so the last border below r2c6 must stay empty
  let mv, found = null;
  for (let k = 0; k < 80 && (mv = ST.takeHumanStep(st, clues)); k++) {
    if (mv.rule === 'Region parity') { found = mv; break; }
    if (mv.contradiction) break;
    if (st.edgeD[6 + 5] !== -1) { found = mv; break; }   // settled by a stronger rule first
  }
  if (!found && st.edgeD[6 + 5] === -1) { console.log('FAIL: the parity border was never settled'); fails++; }
  else {
    console.log('ok: parity border settled by "' + (found ? found.rule : '?') + '": ' + (found ? found.text.slice(0, 140) : ''));
    for (let k = 0; k < 80 && st.edgeD[6 + 5] === -1 && (mv = ST.takeHumanStep(st, clues)); k++) if (mv.contradiction) break;
    if (st.edgeD[6 + 5] !== 0) { console.log('FAIL: parity border has the wrong value'); fails++; }
  }
}
{
  // combined shape count (5 turns+branches demanded, only 5 possible cells)
  const R = 4, C = 6;
  const mk = () => [-1, -1, -1, -1];
  const clues = { row: [mk(), [-1, 2, -1, 3], mk(), mk()], col: Array.from({ length: C }, mk) };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  const pc = m => { let n = 0; while (m) { n += m & 1; m >>= 1; } return n; };
  ST.filterCfg(st, 1 * 6 + 0, m => pc(m) === 0 || (m === 5 || m === 10));   // r2c1: only empty or straight
  let mv, found = null;
  for (let k = 0; k < 80 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.rule === 'Combined shape count') { found = mv; break; } if (mv.contradiction) break; }
  if (!found) { console.log('FAIL: combined shape count never fired'); fails++; }
  else {
    console.log('ok: "' + found.rule + '": ' + found.text);
    for (let c = 1; c < 6; c++) {
      const cls = ST.cellClasses(st, 1 * 6 + c);
      if (cls & ~((1 << 1) | (1 << 3))) { console.log('FAIL: r2c' + (c + 1) + ' not restricted to turn/branch'); fails++; break; }
    }
  }
}
{
  // connectivity (guide: a shape may not seal off a sub-loop while lines exist elsewhere)
  const R = 5, C = 5;
  const mk = () => [-1, -1, -1, -1];
  const clues = { row: Array.from({ length: R }, mk), col: Array.from({ length: C }, mk) };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  // 2x2 ring through r2c2,r2c3,r3c3,r3c2
  ST.setEdge(st, 0, 1 * 5 + 1, 1); ST.setEdge(st, 0, 2 * 5 + 1, 1);
  ST.setEdge(st, 1, 1 * 5 + 1, 1); ST.setEdge(st, 1, 1 * 5 + 2, 1);
  // finalize r2c2, r2c3, r3c2 as turns (all their other borders off)
  ST.setEdge(st, 1, 0 * 5 + 1, 0); ST.setEdge(st, 0, 1 * 5 + 0, 0);
  ST.setEdge(st, 1, 0 * 5 + 2, 0); ST.setEdge(st, 0, 1 * 5 + 2, 0);
  ST.setEdge(st, 0, 2 * 5 + 0, 0); ST.setEdge(st, 1, 2 * 5 + 1, 0);
  // a distant proven line elsewhere
  ST.setEdge(st, 0, 4 * 5 + 3, 1);
  let mv, found = null;
  for (let k = 0; k < 80 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.rule === 'Connectivity') { found = mv; break; } if (mv.contradiction) break; }
  if (!found) { console.log('FAIL: connectivity never fired'); fails++; }
  else console.log('ok: "' + found.rule + '": ' + found.text);
}
{
  // only connection ("if not for this border, the network would be two disconnected pieces")
  const R = 3, C = 5;
  const mk = () => [-1, -1, -1, -1];
  const clues = { row: Array.from({ length: R }, mk), col: Array.from({ length: C }, mk) };
  const blockedGrid = Array.from({ length: R }, () => new Array(C).fill(false));
  blockedGrid[0][2] = true; blockedGrid[2][2] = true;    // middle column passable only through r2c3
  const st = ST.makeStepState(R, C, blockedGrid);
  ST.setEdge(st, 0, 1 * 5 + 0, 1);   // proven line r2c1-r2c2 (left side)
  ST.setEdge(st, 0, 1 * 5 + 3, 1);   // proven line r2c4-r2c5 (right side)
  let mv, found = null;
  for (let k = 0; k < 80 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.rule === 'Only connection') { found = mv; break; } if (mv.contradiction) break; }
  if (!found) { console.log('FAIL: only-connection never fired'); fails++; }
  else {
    console.log('ok: "' + found.rule + '": ' + found.text);
    // keep stepping: both bottleneck borders must end up on
    for (let k = 0; k < 80 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.contradiction) break; }
    if (st.edgeR[1 * 5 + 1] !== 1 || st.edgeR[1 * 5 + 2] !== 1) { console.log('FAIL: bottleneck borders not both forced on'); fails++; }
  }
}
{
  // unreachable region ("the network can never get there, so it stays empty")
  const R = 3, C = 5;
  const mk = () => [-1, -1, -1, -1];
  const clues = { row: Array.from({ length: R }, mk), col: Array.from({ length: C }, mk) };
  const blockedGrid = Array.from({ length: R }, () => new Array(C).fill(false));
  blockedGrid[0][2] = true; blockedGrid[1][2] = true; blockedGrid[2][2] = true;   // full wall
  const st = ST.makeStepState(R, C, blockedGrid);
  ST.setEdge(st, 0, 1 * 5 + 0, 1);   // proven line on the left side only
  let mv, found = null;
  for (let k = 0; k < 80 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.rule === 'Unreachable region') { found = mv; break; } if (mv.contradiction) break; }
  if (!found) { console.log('FAIL: unreachable-region never fired'); fails++; }
  else {
    console.log('ok: "' + found.rule + '": ' + found.text);
    let ok = true;
    for (const i of [3, 4, 5 + 3, 5 + 4, 10 + 3, 10 + 4]) { if (ST.cellClasses(st, i) !== (1 << 4)) ok = false; }
    if (!ok) { console.log('FAIL: right side not all forced empty'); fails++; }
  }
}
{
  // unreachable region contradiction: proven material on both sides of a full wall
  const R = 3, C = 5;
  const mk = () => [-1, -1, -1, -1];
  const clues = { row: Array.from({ length: R }, mk), col: Array.from({ length: C }, mk) };
  const blockedGrid = Array.from({ length: R }, () => new Array(C).fill(false));
  blockedGrid[0][2] = true; blockedGrid[1][2] = true; blockedGrid[2][2] = true;
  const st = ST.makeStepState(R, C, blockedGrid);
  ST.setEdge(st, 0, 1 * 5 + 0, 1);
  ST.setEdge(st, 0, 1 * 5 + 3, 1);
  let mv, found = null;
  for (let k = 0; k < 80 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.contradiction) { found = mv; break; } }
  if (!found || found.rule !== 'Unreachable region') { console.log('FAIL: split-network contradiction not caught, got ' + (found && found.rule)); fails++; }
  else console.log('ok (split network): "' + found.rule + '": ' + found.text);
}
{
  // segment room (user's example: row with 1 cross, 1 branch, 0 straights, 1 turn;
  // the vertical branch at r2c2 is a known endpoint; no room to its left for the cross)
  const R = 6, C = 6;
  const mk = () => [-1, -1, -1, -1];
  const clues = { row: [mk(), [1, 1, -1, 1], mk(), mk(), mk(), mk()], col: Array.from({ length: C }, mk) };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  const pc = m => { let n = 0, x = m; while (x) { n += x & 1; x >>= 1; } return n; };
  const isVB = m => pc(m) === 3 && (m & 1) && (m & 4);
  ST.filterCfg(st, 1 * 6 + 1, m => isVB(m));   // r2c2 committed as the vertical branch
  let mv, found = null;
  for (let k = 0; k < 120 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.rule === 'Segment room') { found = mv; break; } if (mv.contradiction) break; }
  if (!found) { console.log('FAIL: segment room never fired'); fails++; }
  else {
    console.log('ok: "' + found.rule + '": ' + found.text);
    if (st.edgeR[1 * 6 + 1] !== 1 || st.edgeR[1 * 6 + 2] !== 1) { console.log('FAIL: segment not extended right for the cross'); fails++; }
    if (st.edgeR[1 * 6 + 0] !== 0) { console.log('FAIL: left border of the endpoint not ruled out'); fails++; }
  }
}
{
  // segment room with both endpoints known: span bridged, outside borders off
  const R = 5, C = 6;
  const mk = () => [-1, -1, -1, -1];
  const clues = { row: [mk(), mk(), [1, 0, -1, 2], mk(), mk()], col: Array.from({ length: C }, mk) };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  const pc = m => { let n = 0, x = m; while (x) { n += x & 1; x >>= 1; } return n; };
  const isTurn = m => pc(m) === 2 && m !== 5 && m !== 10;
  ST.filterCfg(st, 2 * 6 + 1, m => isTurn(m));   // r3c2 committed turn
  ST.filterCfg(st, 2 * 6 + 4, m => isTurn(m));   // r3c5 committed turn
  let mv, found = null;
  for (let k = 0; k < 120 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.rule === 'Segment room') { found = mv; break; } if (mv.contradiction) break; }
  if (!found) { console.log('FAIL: segment room (two endpoints) never fired'); fails++; }
  else {
    console.log('ok: "' + found.rule + '": ' + found.text);
    let ok = st.edgeR[2 * 6 + 1] === 1 && st.edgeR[2 * 6 + 2] === 1 && st.edgeR[2 * 6 + 3] === 1;
    if (st.edgeR[2 * 6 + 0] !== 0 || st.edgeR[2 * 6 + 4] !== 0) ok = false;
    if (!ok) { console.log('FAIL: two-endpoint span not resolved correctly'); fails++; }
  }
}
{
  // segment packing, user's example 2: column with 5 turns in 6 cells ->
  // parity forces 1 horizontal branch -> 3 vertical segments in exactly 6 cells -> unique packing
  const R = 6, C = 6;
  const mk = () => [-1, -1, -1, -1];
  const clues = { row: Array.from({ length: R }, mk), col: [mk(), [-1, -1, -1, 5], mk(), mk(), mk(), mk()] };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  let mv, found = null;
  for (let k = 0; k < 120 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.rule === 'Segment packing') { found = mv; break; } if (mv.contradiction) break; }
  if (!found) { console.log('FAIL: segment packing (5 turns) never fired'); fails++; }
  else {
    console.log('ok: "' + found.rule + '": ' + found.text);
    const want = [[0, 1], [1, 0], [2, 1], [3, 0], [4, 1]];   // rows pair (1,2)(3,4)(5,6)
    let ok = true;
    for (const [r, v] of want) if (st.edgeD[r * 6 + 1] !== v) ok = false;
    if (!ok) { console.log('FAIL: unique packing not fully forced'); fails++; }
  }
}
{
  // segment packing, user's example 1: column with 1 turn + 1 branch -> exactly one
  // vertical segment; a lower cell provably on a vertical segment drags it down
  const R = 6, C = 6;
  const mk = () => [-1, -1, -1, -1];
  const clues = { row: Array.from({ length: R }, mk), col: [mk(), mk(), mk(), mk(), [-1, 1, -1, 1], mk()] };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  ST.setEdge(st, 1, 0 * 6 + 4, 1);   // drawn vertical border r1c5-r2c5 (segment exists up top)
  ST.filterCfg(st, 4 * 6 + 4, m => m !== 0 && (m & 5) !== 0);   // r5c5: used, and every option has a vertical arm
  let mv, found = null;
  for (let k = 0; k < 120 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.rule === 'Segment packing' || mv.rule === 'Single segment') { found = mv; break; } if (mv.contradiction) break; }
  if (!found) { console.log('FAIL: segment packing (membership) never fired'); fails++; }
  else {
    console.log('ok: "' + found.rule + '": ' + found.text);
    let ok = true;
    for (const r of [1, 2, 3]) if (st.edgeD[r * 6 + 4] !== 1) ok = false;   // must extend down to r5c5
    if (!ok) { console.log('FAIL: segment not extended down to the visited cell'); fails++; }
  }
}
{
  // segment packing with a RANGE of segment counts (user's example: 3 turns -> at least
  // 2 vertical segments; a committed cross leaves room for only 2 -> packing forced)
  const R = 6, C = 6;
  const mk = () => [-1, -1, -1, -1];
  const clues = { row: Array.from({ length: R }, mk), col: [mk(), mk(), mk(), [-1, -1, -1, 3], mk(), mk()] };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  ST.filterCfg(st, 3 * 6 + 3, m => m === 15);   // r4c4 committed cross
  let mv, found = null;
  for (let k = 0; k < 120 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.rule === 'Segment packing') { found = mv; break; } if (mv.contradiction) break; }
  if (!found) { console.log('FAIL: range segment packing never fired'); fails++; }
  else {
    console.log('ok: "' + found.rule + '": ' + found.text);
    if (st.edgeD[0 * 6 + 3] !== 1 || st.edgeD[1 * 6 + 3] !== 0) { console.log('FAIL: range packing borders wrong'); fails++; }
  }
}
{
  // branch orientation placement (user's example 2): rows 2,3,5 have 4 turns + 1 branch
  // -> their branches are horizontal; column 3 has 3 turns + 2 branches -> exactly one
  // vertical branch, and only r4c3 can hold it
  const R = 6, C = 6;
  const mk = () => [-1, -1, -1, -1];
  const clues = { row: [mk(), [-1, 1, -1, 4], [-1, 1, -1, 4], mk(), [-1, 1, -1, 4], mk()],
                  col: [mk(), mk(), [-1, 2, -1, 3], mk(), mk(), mk()] };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  let mv, placed = null;
  for (let k = 0; k < 200 && (mv = ST.takeHumanStep(st, clues)); k++) {
    if (mv.contradiction) break;
    if (mv.rule === 'Branch orientation' && mv.cells && mv.cells.length === 1 && mv.cells[0] === 3 * 6 + 2) { placed = mv; break; }
  }
  if (!placed) { console.log('FAIL: vertical-branch placement at r4c3 never fired'); fails++; }
  else {
    console.log('ok: "' + placed.rule + '": ' + placed.text);
    if (ST.cellClasses(st, 3 * 6 + 2) !== (1 << 1)) { console.log('FAIL: r4c3 not committed to branch'); fails++; }
  }
}
{
  // derived clue (user's example: all column branch clues but one; grid parity + capacity pin it at 0)
  const R = 6, C = 6;
  const mk = () => [-1, -1, -1, -1];
  const clues = { row: Array.from({ length: R }, mk),
                  col: [[-1, 1, -1, -1], [1, -1, 2, 2], [-1, 1, -1, -1], [-1, 1, -1, -1], [-1, 4, -1, -1], [-1, 1, -1, -1]] };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  let mv, found = null;
  for (let k = 0; k < 120 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.rule === 'Derived clue') { found = mv; break; } if (mv.contradiction) break; }
  if (!found) { console.log('FAIL: derived clue never fired'); fails++; }
  else {
    console.log('ok: "' + found.rule + '": ' + found.text);
    let ok = true;
    for (let r = 0; r < R; r++) if (ST.cellClasses(st, r * 6 + 1) & (1 << 1)) ok = false;
    if (!ok) { console.log('FAIL: branches not eliminated from column 2'); fails++; }
  }
}
{
  // shape trial: the last cross fits in 2 spots; placing it at r2c3 would force turns
  // above and below it, overfilling column 3's single-turn quota -- a two-step failure
  // no single line rule sees on the live board
  const R = 5, C = 4;
  const mk = () => [-1, -1, -1, -1];
  const clues = { row: [mk(), [1, -1, -1, -1], mk(), mk(), mk()],
                  col: [mk(), mk(), [1, -1, -1, -1], mk()] };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  // a cross at r2c3 would ripple down: r3c3 (empty-or-vertical-straight) becomes a straight,
  // which makes r4c3 (empty-or-cross) a second cross in column 3 -- overfilling its quota of 1.
  // No single line sees this on the live board; each cell keeps its options until the trial.
  ST.filterCfg(st, 10, m => m === 0 || m === 5);      // r3c3: empty / vertical straight
  ST.filterCfg(st, 14, m => m === 0 || m === 15);     // r4c3: empty / cross
  // (entrance counting now resolves this position without a what-if -- assert the
  // conclusion is still reached, by whatever sound path fires first)
  let mv;
  for (let k = 0; k < 200 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.contradiction) break; }
  if (ST.cellClasses(st, 1 * 4 + 2) & 1) { console.log('FAIL: cross not eliminated at r2c3'); fails++; }
  else console.log('ok: cross eliminated at r2c3 (entrance counting cascade, no trial needed)');
}
{
  // a derived clue must PERSIST and feed later rules: the other columns' branch clues
  // sum to 7 (odd), so column 2 holds an odd count; capacity (2 straights + 2 turns)
  // caps it at 1 -- and Branch orientation must then consume that derived b=1
  const R = 6, C = 6;
  const mk = () => [-1, -1, -1, -1];
  const clues = { row: Array.from({ length: R }, mk),
                  col: [[-1, 1, -1, -1], [-1, -1, 2, 2], [-1, 1, -1, -1], [-1, 1, -1, -1], [-1, 4, -1, -1], [-1, 0, -1, -1]] };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  let mv, found = null;
  for (let k = 0; k < 120 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.rule === 'Derived clue' && /column 2/.test(mv.text)) { found = mv; break; } if (mv.contradiction) break; }
  if (!found) { console.log('FAIL: derived clue (persistence case) never fired'); fails++; }
  else if (!st.derived || st.derived.col[1][1] !== 1) { console.log('FAIL: derived clue not persisted (got ' + (st.derived && st.derived.col[1][1]) + ')'); fails++; }
  else {
    console.log('ok (derived + persisted): ' + found.text);
    let found2 = null;
    for (let k2 = 0; k2 < 200 && (mv = ST.takeHumanStep(st, clues)); k2++) {
      if (mv.contradiction) break;
      if (mv.rule === 'Branch orientation' && /Column 2/.test(mv.text)) { found2 = mv; break; }
    }
    if (!found2) { console.log('FAIL: derived clue did not feed branch orientation (last mv: ' + (mv && mv.rule) + ')'); fails++; }
    else console.log('ok (derived feeds branch orientation): ' + found2.text);
  }
}
{
  // combined shape count with adjacent exclusions (user's example: r1c5/r2c5 cannot
  // both be straight-or-cross, so with 4 demanded among 5 candidates, r3/r5/r6 are pinned
  // -- no shape trial needed)
  const R = 6, C = 6;
  const mk = () => [-1, -1, -1, -1];
  const clues = { row: Array.from({ length: R }, mk), col: [mk(), mk(), mk(), mk(), [2, -1, 2, -1], mk()] };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  ST.filterCfg(st, 2 * 6 + 4, m => m === 15);                                       // r3c5 committed cross
  ST.filterCfg(st, 3 * 6 + 4, m => ST.classOf(m) === 3 || ST.classOf(m) === 1);     // r4c5 turn-or-branch
  let mv, found = null, usedTrial = false;
  for (let k = 0; k < 200 && (mv = ST.takeHumanStep(st, clues)); k++) {
    if (mv.rule === 'Shape trial') usedTrial = true;
    if (mv.rule === 'Combined shape count' && /cannot both be one/.test(mv.text)) { found = mv; break; }
    if (mv.contradiction) break;
  }
  if (!found) { console.log('FAIL: adjacent-exclusion subset never fired'); fails++; }
  else {
    console.log('ok: "' + found.rule + '": ' + found.text);
    if (usedTrial) { console.log('FAIL: a shape trial was needed before the exclusion rule'); fails++; }
    // finish stepping; r5c5 must lose its cross candidacy the human way
    for (let k = 0; k < 200 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.rule === 'Shape trial') usedTrial = true; if (mv.contradiction) break; }
    const m5 = ST.cellClasses(st, 4 * 6 + 4);
    if ((m5 & 1) !== 0) { console.log('FAIL: r5c5 can still be a cross'); fails++; }
    if (usedTrial) { console.log('FAIL: shape trial was still needed for the c5 position'); fails++; }
    else console.log('ok (no trial needed for the c5 position)');
  }
}
{
  // counting lines (user's example 2): rows 2 and 4 place 3+2 crosses, confined to
  // columns 2-5; row 3 (5 turns + 1 branch) can supply exactly 5 vertical arms there,
  // so its branch is vertical and inside columns 2-5 -- r3c1 and r3c6 are not branches
  const R = 6, C = 6;
  const mk = () => [-1, -1, -1, -1];
  const clues = { row: [mk(), [3, -1, -1, -1], [-1, 1, -1, 5], [2, -1, -1, -1], mk(), mk()],
                  col: Array.from({ length: C }, mk) };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  let mv, found = null;
  for (let k = 0; k < 200 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.rule === 'Counting lines') { found = mv; break; } if (mv.contradiction) break; }
  if (!found) { console.log('FAIL: counting lines never fired (last: ' + (mv && mv.rule) + ')'); fails++; }
  else {
    console.log('ok: "' + found.rule + '": ' + found.text);
    if (ST.cellClasses(st, 2 * 6 + 0) & (1 << 1)) { console.log('FAIL: r3c1 can still be a branch'); fails++; }
    if (ST.cellClasses(st, 2 * 6 + 5) & (1 << 1)) { console.log('FAIL: r3c6 can still be a branch'); fails++; }
    if (!/vertical/.test(found.text)) { console.log('FAIL: branch orientation not mentioned'); fails++; }
  }
}
{
  // pigeonhole connection on STRAIGHTS (user's position): column 1's 2 straights fit in
  // 3 cells, all forced vertical in an edge column -- the adjacent pair shares a line
  const R = 6, C = 6;
  const mk = () => [-1, -1, -1, -1];
  const clues = {
    row: [mk(), [3, -1, -1, -1], [-1, -1, -1, 5], [2, -1, -1, -1], [2, -1, -1, -1], [-1, -1, 2, -1]],
    col: [[-1, -1, 2, -1], [-1, -1, -1, 1], mk(), mk(), [-1, 1, 1, -1], mk()]
  };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  let mv, found = null, trialsBefore = 0;
  for (let k = 0; k < 30 && (mv = ST.takeHumanStep(st, clues)); k++) {
    if (mv.contradiction) break;
    if (mv.rule === 'Shape trial') trialsBefore++;
    if (mv.rule === 'Pigeonhole connection' && /Column 1 needs 2 straights/.test(mv.text)) { found = mv; break; }
  }
  if (!found) { console.log('FAIL: straight pigeonhole never fired'); fails++; }
  else {
    console.log('ok: "' + found.rule + '": ' + found.text);
    if (st.edgeD[3 * 6 + 0] !== 1) { console.log('FAIL: r4c1-r5c1 not forced on'); fails++; }
    if (trialsBefore > 1) { console.log('note: ' + trialsBefore + ' trials fired before it'); }
  }
}
{
  // shape trial still fires (with a full chain) on the user's 6x6 position, where the
  // cross eliminations genuinely need a what-if that spans several lines
  const R = 6, C = 6;
  const mk = () => [-1, -1, -1, -1];
  const clues = {
    row: [mk(), [3, -1, -1, -1], [-1, -1, -1, 5], [2, -1, -1, -1], [2, -1, -1, -1], [-1, -1, 2, -1]],
    col: [[-1, -1, 2, -1], [-1, -1, -1, 1], mk(), mk(), [-1, 1, 1, -1], mk()]
  };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  let mv, found = null;
  for (let k = 0; k < 60 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.rule === 'Shape trial') { found = mv; break; } if (mv.contradiction) break; }
  if (found && (!found.chain || !found.chain.length || !found.chain[found.chain.length - 1].contradiction)) {
    console.log('FAIL: trial fired without a complete refutation chain'); fails++;
  } else if (found) {
    console.log('ok: trial with ' + found.chain.length + '-step chain: ' + found.chainIntro);
  } else {
    // stronger rules (e.g. the derived fifth clue) now solve this without a what-if
    for (let k = 0; k < 200 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.contradiction) break; }
    if (!ST.isComplete(st)) { console.log('FAIL: 6x6 position neither trialed nor completed'); fails++; }
    else console.log('ok: 6x6 position completes with no trial needed (derived fifth clue strengthened the ladder)');
  }
}
{
  // empty-clue basics: e=0 -> every cell used (via zero-quota elimination)
  const R = 4, C = 5;
  const mk = () => [-1, -1, -1, -1, -1];
  const clues = { row: [mk(), [-1, -1, -1, -1, 0], mk(), mk()], col: Array.from({ length: C }, mk) };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  let mv, found = null;
  for (let k = 0; k < 40 && (mv = ST.takeHumanStep(st, clues)); k++) { if ((mv.rule === 'Piece count' || mv.rule === 'Clue satisfied') && /blank/.test(mv.text)) { found = mv; break; } if (mv.contradiction) break; }
  if (!found) { console.log('FAIL: e=0 elimination never fired'); fails++; }
  else {
    console.log('ok: "' + found.rule + '": ' + found.text);
    let allUsed = true;
    for (let c = 0; c < C; c++) if (ST.cellClasses(st, 1 * C + c) & (1 << 4)) allUsed = false;
    if (!allUsed) { console.log('FAIL: e=0 did not commit all cells used'); fails++; }
  }
}
{
  // piece count from a nonzero empty clue: e=2 with two blanks already committed
  // -> the remaining three cells must all hold pieces
  const R = 3, C = 5;
  const mk = () => [-1, -1, -1, -1, -1];
  const clues = { row: [mk(), [-1, -1, -1, -1, 2], mk()], col: Array.from({ length: C }, mk) };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  ST.filterCfg(st, 1 * 5 + 0, m => m === 0);
  ST.filterCfg(st, 1 * 5 + 4, m => m === 0);
  let mv, found = null;
  for (let k = 0; k < 60 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.rule === 'Clue satisfied' && /blank/.test(mv.text)) { found = mv; break; } if (mv.contradiction) break; }
  if (!found) { console.log('FAIL: e=2 satisfied elimination never fired'); fails++; }
  else {
    console.log('ok: "' + found.rule + '": ' + found.text);
    let ok = true;
    for (const c of [1, 2, 3]) if (ST.cellClasses(st, 1 * 5 + c) & (1 << 4)) ok = false;
    if (!ok) { console.log('FAIL: remaining cells not committed used'); fails++; }
  }
}
{
  // blank-cell pigeonhole: 2 blanks confined to 3 adjacent candidates -> shared borders off
  const R = 3, C = 5;
  const mk = () => [-1, -1, -1, -1, -1];
  const clues = { row: [mk(), [-1, -1, -1, -1, 2], mk()], col: Array.from({ length: C }, mk) };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  ST.filterCfg(st, 1 * 5 + 0, m => m !== 0);   // r2c1 used
  ST.filterCfg(st, 1 * 5 + 4, m => m !== 0);   // r2c5 used -> blanks confined to r2c2,r2c3,r2c4
  let mv, found = null;
  for (let k = 0; k < 60 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.rule === 'Pigeonhole connection' && /blank/.test(mv.text)) { found = mv; break; } if (mv.contradiction) break; }
  if (!found) { console.log('FAIL: blank pigeonhole never fired'); fails++; }
  else {
    console.log('ok: "' + found.rule + '": ' + found.text);
    if (st.edgeR[1 * 5 + 1] !== 0 || st.edgeR[1 * 5 + 2] !== 0) { console.log('FAIL: blank pigeonhole borders not off'); fails++; }
  }
}
{
  // derived fifth clue: four of five clues given -> the empty count is inherited
  const R = 4, C = 6;
  const mk = () => [-1, -1, -1, -1, -1];
  const clues = { row: [mk(), [1, 0, 2, 1, -1], mk(), mk()], col: Array.from({ length: C }, mk) };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  let mv, found = null;
  for (let k = 0; k < 60 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.rule === 'Derived clue' && /blank/.test(mv.text)) { found = mv; break; } if (mv.contradiction) break; }
  if (!found) { console.log('FAIL: fifth-clue derivation never fired'); fails++; }
  else {
    console.log('ok: "' + found.rule + '": ' + found.text);
    if (!st.derived || st.derived.row[1][4] !== 2) { console.log('FAIL: derived empty count wrong'); fails++; }
  }
}
{
  // shape footprint (user's example): 9-wide row with 5 empties and used budget 4;
  // two far cells already certainly used -> a cross mid-row would drag both
  // neighbours into use (2+3 = 5 > 4), so crosses die across the middle
  const R = 3, C = 9;
  const mk = () => [-1, -1, -1, -1, -1];
  const clues = { row: [mk(), [1, -1, -1, -1, 5], mk()], col: Array.from({ length: C }, mk) };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  ST.filterCfg(st, 1 * 9 + 0, m => m !== 0);   // r2c1 certainly used
  ST.filterCfg(st, 1 * 9 + 8, m => m !== 0);   // r2c9 certainly used
  let mv, found = null;
  for (let k = 0; k < 80 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.rule === 'Shape footprint') { found = mv; break; } if (mv.contradiction) break; }
  if (!found) { console.log('FAIL: shape footprint never fired'); fails++; }
  else {
    console.log('ok: "' + found.rule + '": ' + found.text.slice(0, 260));
    let ok = true;
    for (const c of [3, 4, 5]) if (ST.cellClasses(st, 1 * 9 + c) & 1) ok = false;   // no cross mid-row
    if (!ok) { console.log('FAIL: crosses not eliminated mid-row'); fails++; }
  }
}
{
  // footprint disjunctions (user's example): column 3 with e=3; two certainly-used
  // turn-or-branch cells must each reach a vertical neighbour -- one shared cell
  // suffices, so the budget of 3 is exhausted and the far cells stay empty
  const R = 6, C = 6;
  const mk = () => [-1, -1, -1, -1, -1];
  const clues = { row: Array.from({ length: R }, mk), col: [mk(), mk(), [-1, -1, -1, -1, 3], mk(), mk(), mk()] };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  ST.filterCfg(st, 1 * 6 + 2, m => ST.classOf(m) === 3 || ST.classOf(m) === 1);
  ST.filterCfg(st, 3 * 6 + 2, m => ST.classOf(m) === 3 || ST.classOf(m) === 1);
  let mv, found = null;
  for (let k = 0; k < 40 && (mv = ST.takeHumanStep(st, clues)); k++) { if ((mv.rule === 'Usage budget' || mv.rule === 'Escape routes') && /stay empty|stays empty/.test(mv.text)) { found = mv; break; } if (mv.contradiction) break; }
  if (!found) { console.log('FAIL: footprint disjunction never fired'); fails++; }
  else {
    console.log('ok: "' + found.rule + '": ' + found.text.slice(0, 240));
    for (let k = 0; k < 40 && (mv = ST.takeHumanStep(st, clues)); k++) if (mv.contradiction) break;
    const emptyAt = r => ST.cellClasses(st, r * 6 + 2) === (1 << 4);
    if (!emptyAt(0) || !emptyAt(5)) { console.log('FAIL: r1c3/r6c3 not committed empty'); fails++; }
  }
}
{
  // border trial (user's example): if r5c1-r5c2 stayed empty, both cells become
  // straights marching into the corner and the pocket collapses -- so they connect
  const R = 6, C = 6;
  const mk = () => [-1, -1, -1, -1, -1];
  const clues = { row: Array.from({ length: R }, mk), col: Array.from({ length: C }, mk) };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  st.fastLadder = true;   // entrance counting sidelined, as in positions where it has nothing
  ST.setEdge(st, 1, 3 * 6 + 0, 1); ST.setEdge(st, 1, 3 * 6 + 1, 1);
  ST.filterCfg(st, 3 * 6 + 0, m => m === 6); ST.filterCfg(st, 3 * 6 + 1, m => m === 12);
  ST.setEdge(st, 0, 4 * 6 + 1, 0);
  ST.filterCfg(st, 5 * 6 + 1, m => ST.classOf(m) !== 1);
  ST.setEdge(st, 0, 0 * 6 + 3, 1);
  let mv, found = null;
  for (let k = 0; k < 80 && (mv = ST.takeHumanStep(st, clues)); k++) {
    if ((mv.rule === 'Border trial' || mv.rule === 'Cell trial' || mv.rule === 'Shape hypothesis') && mv.chain && !found) found = mv;
    if (mv.contradiction) break;
    if (st.edgeR[4 * 6 + 0] !== -1) break;
  }
  if (!found) { console.log('FAIL: no chain-carrying trial fired'); fails++; }
  else if (!found.chain.length || !found.chain[found.chain.length - 1].contradiction) {
    console.log('FAIL: trial carries no complete refutation chain'); fails++;
  } else {
    console.log('ok: "Border trial" (' + found.chain.length + '-step chain): ' + found.chainIntro);
    for (let k = 0; k < 80 && st.edgeR[4 * 6 + 0] === -1 && (mv = ST.takeHumanStep(st, clues)); k++) if (mv.contradiction) break;
    if (st.edgeR[4 * 6 + 0] !== 1) { console.log('FAIL: pocket border not forced on'); fails++; }
  }
}
{
  // trial intersection (user's example): one cross left for row 2, two candidate
  // cells -- no case refutes, but everything both cases agree on is placed free
  const R = 4, C = 9;
  const mk = () => [-1, -1, -1, -1, -1];
  const clues = { row: [mk(), [1, -1, -1, -1, 5], mk(), mk()], col: Array.from({ length: C }, mk) };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  for (const c of [0, 2, 3, 4, 5, 6, 8]) ST.filterCfg(st, 1 * 9 + c, m => ST.classOf(m) !== 0);
  let mv, found = null;
  for (let k = 0; k < 60 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.rule === 'Case agreement') { found = mv; break; } if (mv.contradiction) break; }
  if (!found) { console.log('FAIL: trial intersection never fired'); fails++; }
  else {
    console.log('ok: "' + found.rule + '" (intersection): ' + found.text);
    if (!found.cells.length && !(found.edges && found.edges.length)) { console.log('FAIL: intersection move with no conclusions'); fails++; }
  }
}
{
  // empty-side footprint dual (user's example): row 1 of a 10-wide grid allows a
  // single empty cell; the corners collapse onto their neighbours, so the
  // corner-adjacent cells are certainly used
  const R = 3, C = 10;
  const mk = () => [-1, -1, -1, -1, -1];
  const clues = { row: [[-1, -1, -1, -1, 1], mk(), mk()], col: Array.from({ length: C }, mk) };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  let mv, found = null;
  for (let k = 0; k < 40 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.rule === 'Empty quota' && /certainly used/.test(mv.text)) { found = mv; break; } if (mv.contradiction) break; }
  if (!found) { console.log('FAIL: empty-side dual never fired'); fails++; }
  else {
    console.log('ok: "' + found.rule + '" (empty dual): ' + found.text);
    const usedAt = c => (ST.cellClasses(st, 1 * 0 + c) & (1 << 4)) === 0;
    if (!usedAt(1) || !usedAt(8)) { console.log('FAIL: r1c2/r1c9 not committed used'); fails++; }
  }
}
{
  // neighbour-arm budget (user's example): column 2's 3 crosses sit in rows 2-9 and
  // each pokes an arm into column 3; with r1c3 known used and only 4 used cells
  // allowed, r10c3 must be empty
  const R = 10, C = 3;
  const mk = () => [-1, -1, -1, -1, -1];
  const clues = { row: Array.from({ length: R }, mk), col: [mk(), [3, -1, -1, -1, -1], [-1, -1, -1, -1, 6]] };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  ST.filterCfg(st, 0 * 3 + 2, m => m !== 0);
  let mv, found = null;
  for (let k = 0; k < 60 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.rule === 'Neighbour arms' && /reach into/.test(mv.text)) { found = mv; break; } if (mv.contradiction) break; }
  if (!found) { console.log('FAIL: neighbour-arm budget never fired'); fails++; }
  else {
    console.log('ok: "' + found.rule + '" (neighbour arms): ' + found.text.slice(0, 220));
    if (ST.cellClasses(st, 9 * 3 + 2) !== (1 << 4)) { console.log('FAIL: r10c3 not committed empty'); fails++; }
  }
}
{
  // attribution guard: with MORE used cells in the range than the neighbour has
  // copies (k=1 branch, two used cells), no cell may be committed as the target
  const R = 4, C = 6;
  const mk = () => [-1, -1, -1, -1, -1];
  const clues = { row: [[-1, 1, -1, -1, -1], [-1, -1, -1, -1, 2], mk(), mk()], col: Array.from({ length: C }, mk) };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  ST.filterCfg(st, 1 * 6 + 1, m => m !== 0);
  ST.filterCfg(st, 1 * 6 + 2, m => m !== 0);
  ST.filterCfg(st, 1 * 6 + 3, m => m !== 0);
  ST.filterCfg(st, 1 * 6 + 4, m => m !== 0);   // row 2: budget 4, all four used cells known
  let bad = false, mv;
  for (let k = 0; k < 60 && (mv = ST.takeHumanStep(st, clues)); k++) {
    if (mv.contradiction) break;
    if (mv.rule === 'Arm attribution' && /is used, so/.test(mv.text)) { bad = true; console.log('  saw: ' + mv.text.slice(0, 160)); break; }
  }
  if (bad) { console.log('FAIL: attribution committed targets despite overlap > k'); fails++; }
  else console.log('ok: attribution stays silent when targets cannot be identified (overlap > k)');
}
{
  // budget-derived single segment (user's example): c9 with x=1, s=5, e=2 pins
  // turns+branches at 2 -> one vertical segment; r7c9 (used, no straight option)
  // lies on it, so the segment extends down from the drawn top to r7
  const R = 10, C = 10;
  const mk = () => [-1, -1, -1, -1, -1];
  const clues = { row: Array.from({ length: R }, mk), col: Array.from({ length: C }, mk) };
  clues.col[8] = [1, -1, 5, -1, 2];
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  ST.setEdge(st, 1, 0 * 10 + 8, 1);
  ST.filterCfg(st, 6 * 10 + 8, m => m !== 0 && ST.classOf(m) !== 2);
  let mv, found = null;
  for (let k = 0; k < 80 && (mv = ST.takeHumanStep(st, clues)); k++) { if ((mv.rule === 'Segment packing' || mv.rule === 'Single segment') && /Column 9|column 9/.test(mv.text)) { found = mv; break; } if (mv.contradiction) break; }
  if (!found) { console.log('FAIL: budget-derived packing never fired'); fails++; }
  else {
    console.log('ok: "' + found.rule + '" (budget segments): ' + found.text.slice(0, 200));
    let all = true;
    for (const r of [1, 2, 3, 4, 5]) if (st.edgeD[r * 10 + 8] !== 1) all = false;
    if (!all) { console.log('FAIL: segment not extended to r7'); fails++; }
  }
}
{
  // deep separator (user's example): the escape from the top-left ring must cross
  // row 4 at columns 1-2 (column 3 walled off by committed empties two rows up);
  // row 4's empty quota then blanks the rest of the row
  const R = 6, C = 6;
  const mk = () => [-1, -1, -1, -1, -1];
  const clues = { row: [mk(), mk(), mk(), [-1, -1, -1, -1, 5], mk(), mk()], col: Array.from({ length: C }, mk) };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  ST.setEdge(st, 0, 0 * 6 + 0, 1); ST.setEdge(st, 0, 1 * 6 + 0, 1);
  ST.setEdge(st, 1, 0 * 6 + 0, 1); ST.setEdge(st, 1, 0 * 6 + 1, 1);
  for (const r of [0, 1, 2]) ST.filterCfg(st, r * 6 + 2, m => m === 0);
  ST.setEdge(st, 0, 5 * 6 + 4, 1);
  let mv, found = null;
  for (let k = 0; k < 80 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.rule === 'Escape routes' && /reach the rest/.test(mv.text)) { found = mv; break; } if (mv.contradiction) break; }
  if (!found) { console.log('FAIL: deep separator never fired'); fails++; }
  else {
    console.log('ok: "' + found.rule + '" (deep separator): ' + found.text.slice(0, 200));
    let all = true;
    for (const c of [2, 3, 4, 5]) if (ST.cellClasses(st, 3 * 6 + c) !== (1 << 4)) all = false;
    if (!all) { console.log('FAIL: r4c3-r4c6 not committed empty'); fails++; }
  }
}
{
  // sequential form of the user's row-3 argument: Segment capacity proves row 3's
  // 5 straights are all vertical (a horizontal segment would add 2 endpoints);
  // their arms land in row 4, whose empty quota then blanks the leftover cells
  const R = 5, C = 10;
  const mk = () => [-1, -1, -1, -1, -1];
  const clues = { row: [mk(), mk(), [-1, -1, 5, -1, -1], [-1, -1, -1, -1, 4], mk()], col: Array.from({ length: C }, mk) };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  for (const c of [3, 7, 8, 9]) ST.filterCfg(st, 2 * 10 + c, m => m === 0);
  for (const c of [0, 1, 2, 4, 5, 6]) ST.filterCfg(st, 2 * 10 + c, m => m === 0 || ST.classOf(m) === 2 || ST.classOf(m) === 3);
  ST.filterCfg(st, 3 * 10 + 7, m => m !== 0);
  let mv, found = null, sawCapacity = false;
  for (let k = 0; k < 100 && (mv = ST.takeHumanStep(st, clues)); k++) {
    if (mv.rule === 'Segment capacity') sawCapacity = true;
    if ((mv.rule === 'Neighbour arms' || mv.rule === 'Arm arrivals') && /reach into|However/.test(mv.text)) { found = mv; break; }
    if (mv.contradiction) break;
  }
  if (!found) { console.log('FAIL: straight-arm arrival budget never fired'); fails++; }
  else {
    console.log('ok: "' + found.rule + '" (straight arrivals' + (sawCapacity ? ', after Segment capacity' : '') + '): ' + found.text.slice(0, 200));
    for (let k = 0; k < 60; k++) { const m2 = ST.takeHumanStep(st, clues); if (!m2) break; if (m2.contradiction) { console.log('FAIL: downstream contradiction'); fails++; break; } }
    if (ST.cellClasses(st, 3 * 10 + 3) !== (1 << 4)) { console.log('FAIL: r4c4 not committed empty'); fails++; }
  }
}
{
  // piece-demand dual (user's example): 9-wide row with 2 crosses + 1 straight +
  // 5 turns clued and no branch clue -- odd turns force a vertical branch, so 9
  // pieces must fit and no cell can be empty
  const R = 4, C = 9;
  const mk = () => [-1, -1, -1, -1, -1];
  const clues = { row: [mk(), [2, -1, 1, 5, -1], mk(), mk()], col: Array.from({ length: C }, mk) };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  let mv, found = null;
  for (let k = 0; k < 60 && (mv = ST.takeHumanStep(st, clues)); k++) { if ((mv.rule === 'Piece demand' && /must fit at least/.test(mv.text)) || (mv.rule === 'Exact allocation' && /must fit/.test(mv.text))) { found = mv; break; } if (mv.contradiction) break; }
  if (!found) { console.log('FAIL: piece-demand dual never fired'); fails++; }
  else {
    console.log('ok: "' + found.rule + '" (piece demand): ' + found.text.slice(0, 180));
    if (ST.cellClasses(st, 1 * 9 + 1) & (1 << 4)) { console.log('FAIL: r2c2 not committed used'); fails++; }
  }
}
{
  // wide-line enumeration arrivals (user's example, 10-wide): row 3 needs 5
  // straights; the right side is walled, c5-c7 fits only two vertically, so
  // however the straights are arranged their arms overflow row 4's quota
  const R = 6, C = 10;
  const mk = () => [-1, -1, -1, -1, -1];
  const clues = { row: [mk(), mk(), [0, -1, 5, -1, -1], [-1, -1, -1, -1, 4], mk(), mk()], col: Array.from({ length: C }, mk) };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  ST.filterCfg(st, 2 * 10 + 3, m => m === 0);
  ST.filterCfg(st, 2 * 10 + 7, m => m === 0);
  ST.filterCfg(st, 2 * 10 + 8, m => m === 0);
  ST.setEdge(st, 1, 1 * 10 + 9, 1);
  ST.setEdge(st, 1, 2 * 10 + 9, 1);
  ST.filterCfg(st, 2 * 10 + 6, m => m !== 0);
  ST.filterCfg(st, 2 * 10 + 5, m => ST.classOf(m) !== 2);
  ST.filterCfg(st, 3 * 10 + 8, m => m !== 0);
  let mv, found = null;
  for (let k = 0; k < 30 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.rule === 'Arm arrivals' && /However/.test(mv.text)) { found = mv; break; } if (mv.contradiction) break; }
  if (!found) { console.log('FAIL: wide-line enumeration arrivals never fired'); fails++; }
  else {
    console.log('ok: "' + found.rule + '" (wide-line arrivals): ' + found.text.slice(0, 190));
    if (ST.cellClasses(st, 3 * 10 + 3) !== (1 << 4)) { console.log('FAIL: r4c4 not committed empty'); fails++; }
  }
}
{
  // paired exclusion (user's example): wherever row 2's 4 crosses sit, the cell
  // below cannot be a straight (its downward border is blocked); with 6 straights
  // needed among 10 capable cells, the cells out of reach (the drawn stubs at the
  // edges) must be straights
  const R = 4, C = 10;
  const mk = () => [-1, -1, -1, -1, -1];
  const clues = { row: [mk(), [4, -1, -1, -1, -1], [-1, -1, 6, -1, -1], mk()], col: Array.from({ length: C }, mk) };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  for (let c = 1; c <= 8; c++) ST.setEdge(st, 1, 2 * 10 + c, 0);
  ST.setEdge(st, 1, 2 * 10 + 0, 1);
  ST.setEdge(st, 1, 2 * 10 + 9, 1);
  let mv, found = null;
  for (let k = 0; k < 40 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.rule === 'Paired exclusion' && /reach must be one/.test(mv.text)) { found = mv; break; } if (mv.contradiction) break; }
  if (!found) { console.log('FAIL: paired exclusion never fired'); fails++; }
  else {
    console.log('ok: "' + found.rule + '" (paired exclusion): ' + found.text.slice(0, 200));
    if (ST.classLetters(st, 2 * 10 + 0) !== 'I' || ST.classLetters(st, 2 * 10 + 9) !== 'I') { console.log('FAIL: edge cells not committed straights'); fails++; }
  }
}
{
  // class-aware demand capacity (user's example): x=2, t=5, parity branch = 8
  // pieces; with r2c2 empty, r2c1 collapses to straight-or-empty and cannot host
  // any demanded piece -- 7 capable cells < 8, so r2c2 is visited
  const R = 4, C = 9;
  const mk = () => [-1, -1, -1, -1, -1];
  const clues = { row: [mk(), [2, -1, -1, 5, -1], mk(), mk()], col: Array.from({ length: C }, mk) };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  let mv, found = null;
  for (let k = 0; k < 60 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.rule === 'Piece demand' && /could hold any/.test(mv.text)) { found = mv; break; } if (mv.contradiction) break; }
  if (!found) { console.log('FAIL: class-aware demand never fired'); fails++; }
  else {
    console.log('ok: "' + found.rule + '" (class-aware demand): ' + found.text.slice(0, 200));
    if (ST.cellClasses(st, 1 * 9 + 1) & (1 << 4)) { console.log('FAIL: r2c2 not committed used'); fails++; }
  }
}
{
  // arm-capacity single segment (discovered from the user's test position): c9's
  // quota leaves one horizontal straight in rows 8-10 and one cross in rows 2-6,
  // each poking an arm into edge column c10; every c10 segment end consumes one of
  // at most 3 available arms, so one vertical segment -- and it must absorb both
  // incoming arms, spanning rows 6-8
  const R = 10, C = 10;
  const mk = () => [-1, -1, -1, -1, -1];
  const clues = { row: Array.from({ length: R }, mk), col: Array.from({ length: C }, mk) };
  clues.col[8] = [1, -1, 5, -1, 2];
  clues.col[9] = [-1, -1, 3, -1, -1];
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  for (let r = 0; r < 6; r++) ST.setEdge(st, 1, r * 10 + 8, 1);
  ST.setEdge(st, 0, 0 * 10 + 8, 0);
  ST.setEdge(st, 0, 0 * 10 + 7, 1);
  for (let r = 6; r < 9; r++) ST.setEdge(st, 1, r * 10 + 8, 0);
  ST.filterCfg(st, 0 * 10 + 9, m => m === 0);
  let mv, found = null;
  for (let k = 0; k < 60 && (mv = ST.takeHumanStep(st, clues)); k++) { if ((mv.rule === 'Segment packing' || mv.rule === 'Single segment') && /neighbours can supply|Column 10|column 10/.test(mv.text)) { found = mv; break; } if (mv.contradiction) break; }
  if (!found) { console.log('FAIL: arm-capacity packing never fired'); fails++; }
  else {
    console.log('ok: "' + found.rule + '" (arm capacity): ' + found.text.slice(0, 200));
    if (st.edgeD[5 * 10 + 9] !== 1 || st.edgeD[6 * 10 + 9] !== 1) { console.log('FAIL: c10 segment span not drawn'); fails++; }
  }
}
{
  // single-line analysis (user's example): c9 needs 2 empties, both in rows 8-10,
  // so only one of those is the fifth straight -- rows 2-6 must be exactly four
  // straights plus the cross, never branches
  const R = 10, C = 10;
  const mk = () => [-1, -1, -1, -1, -1];
  const clues = { row: Array.from({ length: R }, mk), col: Array.from({ length: C }, mk) };
  clues.col[8] = [1, -1, 5, -1, 2];
  clues.col[9] = [-1, -1, 3, -1, -1];
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  for (let r = 0; r < 6; r++) ST.setEdge(st, 1, r * 10 + 8, 1);
  ST.setEdge(st, 0, 0 * 10 + 8, 0);
  ST.setEdge(st, 0, 0 * 10 + 7, 1);
  for (let r = 6; r < 9; r++) ST.setEdge(st, 1, r * 10 + 8, 0);
  ST.filterCfg(st, 0 * 10 + 9, m => m === 0);
  let mv, found = null;
  for (let k = 0; k < 80 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.rule === 'Single-line analysis' && /olumn 9/.test(mv.text)) { found = mv; break; } if (mv.contradiction) break; }
  if (!found) { console.log('FAIL: single-line analysis never fired'); fails++; }
  else {
    console.log('ok: "' + found.rule + '": ' + found.text.slice(0, 190));
    let ok = true;
    for (const r of [1, 2, 3, 4, 5]) if (ST.cellClasses(st, r * 10 + 8) & 2) ok = false;
    if (!ok) { console.log('FAIL: branches not eliminated in c9 rows 2-6'); fails++; }
  }
}
{
  // x-wing branches (user's example): rows 4/6 each have one branch, at c1 or c10;
  // both-same-side would force r5's end into a third branch, so they split -- and
  // r7c1/r7c10 can never be branches (each would force the row-8 corner into one,
  // overflowing a column's quota of 2)
  const R = 10, C = 10;
  const mk = () => [-1, -1, -1, -1, -1];
  const clues = { row: Array.from({ length: R }, mk), col: Array.from({ length: C }, mk) };
  clues.row[3] = [-1, 1, -1, -1, -1];
  clues.row[5] = [-1, 1, -1, -1, -1];
  clues.col[0] = [-1, 2, -1, -1, -1];
  clues.col[9] = [-1, 2, -1, -1, -1];
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  for (let c = 0; c < 9; c++) { ST.setEdge(st, 0, 3 * 10 + c, 1); ST.setEdge(st, 0, 5 * 10 + c, 1); }
  ST.setEdge(st, 0, 4 * 10 + 0, 1); ST.setEdge(st, 0, 4 * 10 + 8, 1);
  for (let c = 1; c < 9; c++) { ST.filterCfg(st, 3 * 10 + c, m => ST.classOf(m) !== 1); ST.filterCfg(st, 5 * 10 + c, m => ST.classOf(m) !== 1); }
  ST.setEdge(st, 0, 7 * 10 + 0, 1); ST.setEdge(st, 1, 7 * 10 + 0, 1);
  ST.setEdge(st, 0, 7 * 10 + 8, 1); ST.setEdge(st, 1, 7 * 10 + 9, 1);
  // extra drawn material above, so candidate ordering (not index caps) must find r7
  for (let c = 0; c < 9; c++) ST.setEdge(st, 0, 1 * 10 + c, 1);
  for (let c = 1; c < 9; c++) ST.filterCfg(st, 1 * 10 + c, m => ST.classOf(m) !== 1);
  let mv;
  for (let k = 0; k < 200 && (mv = ST.takeHumanStep(st, clues)); k++) if (mv.contradiction) { console.log('FAIL: x-wing position hit a contradiction'); fails++; break; }
  const gone1 = (ST.cellClasses(st, 6 * 10 + 0) & 2) === 0;
  const gone10 = (ST.cellClasses(st, 6 * 10 + 9) & 2) === 0;
  if (!gone1 || !gone10) { console.log('FAIL: r7 corner branches not eliminated (' + gone1 + ',' + gone10 + ')'); fails++; }
  else console.log('ok: x-wing consequences: r7c1 and r7c10 lose their branch options');
}
{
  // interior composition (user's example): one horizontal segment (1 turn + 1
  // vertical branch by parity) must contain 2 crosses and the flat branch; the
  // right half's interiors cannot host the crosses, so the segment lives left
  const R = 3, C = 12;
  const mk = () => [-1, -1, -1, -1, -1];
  const blocked = Array.from({ length: R }, () => new Array(C).fill(false));
  blocked[1][5] = true;
  const clues = { row: [mk(), [2, 2, -1, 1, -1], mk()], col: Array.from({ length: C }, mk) };
  const st = ST.makeStepState(R, C, blocked);
  for (const c of [7, 8, 9, 10]) ST.filterCfg(st, 1 * 12 + c, m => ST.classOf(m) !== 0);
  let mv, found = null;
  for (let k = 0; k < 60 && (mv = ST.takeHumanStep(st, clues)); k++) { if (mv.rule === 'Segment packing' && /Row 2/.test(mv.text)) { found = mv; break; } if (mv.contradiction) break; }
  if (!found) { console.log('FAIL: interior composition never fired'); fails++; }
  else {
    console.log('ok: "' + found.rule + '" (interior composition): ' + found.text.slice(0, 180));
    let ok = true;
    for (const c of [0, 1, 2, 3]) if (st.edgeR[1 * 12 + c] !== 1) ok = false;
    for (const c of [6, 7, 8, 9, 10]) if (st.edgeR[1 * 12 + c] !== 0) ok = false;
    if (!ok) { console.log('FAIL: segment not forced to the left half'); fails++; }
  }
}
{
  // first-three-rows logic (user's test position): row 1 (s=0, t=2, top row) holds
  // one segment whose every member sends an arm down; row 2's three crosses need
  // those arms, and no cross fits at the edges -- so the segment cannot be the
  // short right block and lands at c2-c7, emptying the right side
  const R = 11, C = 11;
  const clues = {
    row: [
      [-1,-1,0,2,-1], [3,3,1,1,-1], [-1,1,1,1,-1], [-1,-1,-1,-1,-1],
      [-1,-1,-1,2,-1], [-1,-1,-1,2,-1], [-1,-1,-1,-1,-1], [1,5,-1,-1,-1],
      [-1,1,3,3,-1], [1,-1,2,-1,-1], [-1,1,-1,2,-1]
    ],
    col: [
      [-1,-1,7,-1,-1], [-1,-1,-1,-1,-1], [-1,-1,-1,3,-1], [1,-1,4,-1,-1],
      [-1,3,-1,-1,-1], [-1,-1,0,7,-1], [-1,1,4,-1,-1], [-1,0,-1,0,-1],
      [-1,-1,-1,1,-1], [-1,-1,5,2,-1], [-1,-1,1,-1,-1]
    ]
  };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  let mv, k, sawPack = false, sawLine = false;
  for (k = 0; k < 400; k++) {
    mv = ST.takeHumanStep(st, clues);
    if (!mv) break;
    if (mv.rule === 'Segment packing' && /Row 1/.test(mv.text)) sawPack = true;
    if (mv.rule === 'Single-line analysis' && /row 2/.test(mv.text)) sawLine = true;
    if (mv.contradiction) { console.log('FAIL: test position hit a contradiction'); fails++; break; }
  }
  const r1 = Array.from({ length: C }, (_, c) => ST.classLetters(st, c)).join(' ');
  if (r1 !== '\u00b7 L T T T T L \u00b7 \u00b7 \u00b7 \u00b7') { console.log('FAIL: row 1 not resolved (' + r1 + ')'); fails++; }
  else console.log('ok: first-three-rows logic resolves row 1 (' + (sawPack ? 'packing' : '') + (sawLine ? '+line analysis' : '') + ', ' + k + ' steps)');
}
{
  // whole-grid branch parity (all row branch clues sum to an odd number)
  const R = 3, C = 3;
  const mk = () => [-1, -1, -1, -1];
  const clues = { row: [[-1, 1, -1, -1], [-1, 0, -1, -1], [-1, 0, -1, -1]], col: Array.from({ length: C }, mk) };
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  const mv = ST.takeHumanStep(st, clues);
  if (!mv || !mv.contradiction) { console.log('FAIL: odd total branches not caught'); fails++; }
  else console.log('ok (grid branch parity): ' + mv.text);
}

{
  // user's 6x6 (July 2026): unique puzzle that exposed two things — the
  // branch-parity family running arithmetic on UNCLUED counts (undefined
  // slipped past `< 0` guards; clue normalization fixes the class), and the
  // need for the Quota exhaustion technique (cols 2+4 demand 8 straights+
  // branches, matched exactly by row caps incl. the row-3 cross squeeze).
  const R = 6, C = 6, U = undefined;
  const rowClues = [[U,U,U,U,U],[U,1,1,U,U],[2,2,U,U,U],[U,1,1,U,U],[U,U,2,2,U],[U,1,1,U,U]];
  const colClues = [[U,U,U,U,U],[U,2,2,U,U],[0,0,U,U,U],[U,2,2,U,U],[U,U,1,1,U],[U,2,2,U,U]];
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  const clues = { row: rowClues.map(a => a.slice()), col: colClues.map(a => a.slice()) };
  let quota = false, contradiction = false, k = 0, mv;
  while (k < 300 && (mv = ST.takeHumanStep(st, clues))) {
    k++;
    if (mv.rule === 'Quota exhaustion') quota = true;
    if (mv.contradiction) { contradiction = true; break; }
  }
  if (contradiction) { console.log('FAIL: quota puzzle reached a contradiction (unsound rule?)'); fails++; }
  else if (!ST.isComplete(st)) { console.log('FAIL: quota puzzle did not complete (' + k + ' steps)'); fails++; }
  else if (!quota) { console.log('FAIL: Quota exhaustion never fired on its showcase puzzle'); fails++; }
  else console.log('ok: quota-exhaustion showcase 6x6 solves cleanly (' + k + ' steps)');
}

console.log(fails === 0 ? '\nALL STEPPER TESTS PASSED' : '\n' + fails + ' FAILURES');
process.exit(fails === 0 ? 0 : 1);
