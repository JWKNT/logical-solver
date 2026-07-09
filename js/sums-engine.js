// Japanese Sums search engine: solve, count solutions, and per-cell candidate
// statuses. Runs in a Web Worker in the page (via Blob) and as a Node module
// for the tests.
//
// Rules: place digits 1..D in some cells of an R x C grid; a digit appears at
// most once per row and per column; empty cells split each line into groups of
// consecutive digits, and a clued line lists the sums of its groups in order.
// A clue value of -1 (entered as '?') is a wildcard group of unknown sum. An
// unclued line is unconstrained.
function sumsWorkerMain() {

// ---- clue state helpers -------------------------------------------------
// Per line we track: group index, running sum. Placing digit v extends the
// current group; placing empty closes it (sum must match the clue) or is a
// plain gap. At line end the pending group closes and all groups must be used.

function makeSolver(cfg) {
  const { R, C, D } = cfg;
  const rowClues = cfg.rowClues;   // array per row: null (unclued) or [s1, s2, ...] with -1 = '?'
  const colClues = cfg.colClues;
  const N = R * C;
  const grid = new Int8Array(N).fill(-1);   // -1 undecided, 0 empty, 1..D digit
  const rowMask = new Int32Array(R);        // digits used
  const colMask = new Int32Array(C);
  const rowGi = new Int32Array(R), rowRun = new Int32Array(R);
  const colGi = new Int32Array(C), colRun = new Int32Array(C);
  const fixed = cfg.fixed || null;          // optional Int8Array of prefills (-1 = free)

  const FULL = (1 << (D + 1)) - 2;          // bits 1..D

  // max sum obtainable from a digit mask, and with at most k digits
  function maxSumOf(mask) { let s = 0; for (let d = D; d >= 1; d--) if (mask & (1 << d)) s += d; return s; }
  function minAvail(mask) { for (let d = 1; d <= D; d++) if (mask & (1 << d)) return d; return 0; }

  // Can the current group for a line still be completed and the rest of the
  // clue list still fit into `left` remaining cells with `avail` digit mask?
  function lineFeasible(clue, gi, run, left, avail) {
    if (!clue) return true;
    let need = 0;
    if (run > 0) {
      if (gi >= clue.length) return false;
      const target = clue[gi];
      if (target >= 0) {
        if (run > target) return false;
        if (run < target) {
          // must extend: need at least one more cell and enough digit mass
          if (left <= 0) return false;
          if (run + maxSumOf(avail) < target) return false;
          if (minAvail(avail) === 0) return false;
        }
      } else if (left < 0) return false;
      need = (target >= 0 && run < target) ? 1 : 0;
    }
    // remaining groups after the current one: each needs >= 1 cell + 1 gap before it
    const remGroups = clue.length - gi - (run > 0 ? 1 : 0);
    if (remGroups < 0) return false;
    let cellsNeeded = need;
    for (let g = gi + (run > 0 ? 1 : 0); g < clue.length; g++) cellsNeeded += 2;  // gap + at least 1 cell
    if (run === 0 && gi < clue.length && cellsNeeded >= 2) cellsNeeded -= 1;      // no gap needed before the first pending group if we're already at a gap
    return cellsNeeded <= left;
  }

  function tryPlace(i, v) {
    const r = (i / C) | 0, c = i % C;
    const rc = rowClues[r], cc = colClues[c];
    // row transition
    if (v === 0) {
      if (rowRun[r] > 0) {
        const t = rc ? rc[rowGi[r]] : -2;
        if (rc && (rowGi[r] >= rc.length || (t >= 0 && rowRun[r] !== t))) return false;
      }
      if (colRun[c] > 0) {
        const t = cc ? cc[colGi[c]] : -2;
        if (cc && (colGi[c] >= cc.length || (t >= 0 && colRun[c] !== t))) return false;
      }
    } else {
      if (rowMask[r] & (1 << v)) return false;
      if (colMask[c] & (1 << v)) return false;
      if (rc) {
        const gi = rowRun[r] > 0 ? rowGi[r] : rowGi[r];
        if (gi >= rc.length) return false;
        const t = rc[gi];
        if (t >= 0 && rowRun[r] + v > t) return false;
      }
      if (cc) {
        const gi = colGi[c];
        if (gi >= cc.length) return false;
        const t = cc[gi];
        if (t >= 0 && colRun[c] + v > t) return false;
      }
    }
    return true;
  }

  function apply(i, v) {
    const r = (i / C) | 0, c = i % C;
    const undo = { rGi: rowGi[r], rRun: rowRun[r], cGi: colGi[c], cRun: colRun[c] };
    if (v === 0) {
      if (rowRun[r] > 0) { rowGi[r]++; rowRun[r] = 0; }
      if (colRun[c] > 0) { colGi[c]++; colRun[c] = 0; }
    } else {
      rowMask[r] |= 1 << v; colMask[c] |= 1 << v;
      rowRun[r] += v; colRun[c] += v;
    }
    grid[i] = v;
    return undo;
  }
  function unapply(i, v, undo) {
    const r = (i / C) | 0, c = i % C;
    if (v > 0) { rowMask[r] &= ~(1 << v); colMask[c] &= ~(1 << v); }
    rowGi[r] = undo.rGi; rowRun[r] = undo.rRun; colGi[c] = undo.cGi; colRun[c] = undo.cRun;
    grid[i] = -1;
  }

  function lineEndOk(clue, gi, run) {
    if (!clue) return true;
    let g = gi;
    if (run > 0) {
      const t = clue[g];
      if (g >= clue.length || (t >= 0 && run !== t)) return false;
      g++;
    }
    return g === clue.length;
  }

  return { grid, rowMask, colMask, rowGi, rowRun, colGi, colRun, tryPlace, apply, unapply, lineEndOk, lineFeasible, FULL, fixed };
}

function search(cfg, opts) {
  const { R, C, D } = cfg;
  const S = makeSolver(cfg);
  const N = R * C;
  const deadline = Date.now() + (opts.timeLimit || 10000);
  let nodes = 0, solCount = 0, timedOut = false;
  const maxSol = opts.maxSolutions || Infinity;
  let firstSol = null;
  // per-cell candidate accumulation: bit 0 = empty, bits 1..D digit
  const cand = opts.collect ? new Int32Array(N) : null;
  const post = opts.onSolution || null;

  function rec(i) {
    if (timedOut || solCount >= maxSol) return;
    if ((++nodes & 2047) === 0 && Date.now() > deadline) { timedOut = true; return; }
    if (i === N) {
      // verify column ends (row ends checked at each row boundary)
      for (let c = 0; c < C; c++) if (!S.lineEndOk(cfg.colClues[c], S.colGi[c], S.colRun[c])) return;
      solCount++;
      if (!firstSol) firstSol = Int8Array.from(S.grid);
      if (cand) for (let j = 0; j < N; j++) cand[j] |= 1 << S.grid[j];
      if (post) post(S.grid);
      return;
    }
    const r = (i / C) | 0, c = i % C;
    const atRowEnd = c === C - 1;
    const vals = [];
    if (S.fixed && S.fixed[i] >= 0) vals.push(S.fixed[i]);
    else { vals.push(0); for (let v = 1; v <= D; v++) vals.push(v); }
    for (const v of vals) {
      if (!S.tryPlace(i, v)) continue;
      const undo = S.apply(i, v);
      let ok = true;
      if (atRowEnd && !S.lineEndOk(cfg.rowClues[r], S.rowGi[r], S.rowRun[r])) ok = false;
      if (ok) {
        // row feasibility for the remainder of this row
        const leftInRow = C - 1 - c;
        if (!S.lineFeasible(cfg.rowClues[r], S.rowGi[r], S.rowRun[r], leftInRow, ~S.rowMask[r] & S.FULL)) ok = false;
        if (ok) {
          const leftInCol = R - 1 - r;
          if (!S.lineFeasible(cfg.colClues[c], S.colGi[c], S.colRun[c], leftInCol, ~S.colMask[c] & S.FULL)) ok = false;
        }
      }
      if (ok) rec(i + 1);
      S.unapply(i, v, undo);
      if (timedOut || solCount >= maxSol) return;
    }
  }
  rec(0);
  return { solCount, nodes, timedOut, complete: !timedOut, firstSol, cand };
}

function runAny(cfg) {
  if (cfg.mode === 'solve') {
    const r = search(cfg, { timeLimit: cfg.timeLimit, maxSolutions: 1 });
    return { firstSol: r.firstSol ? Array.from(r.firstSol) : null, nodes: r.nodes, timedOut: r.timedOut };
  }
  if (cfg.mode === 'count') {
    const r = search(cfg, { timeLimit: cfg.timeLimit, maxSolutions: cfg.maxSolutions || 10000 });
    return { solCount: r.solCount, nodes: r.nodes, complete: r.complete, timedOut: r.timedOut };
  }
  if (cfg.mode === 'candidates') {
    const r = search(cfg, { timeLimit: cfg.timeLimit, collect: true, maxSolutions: cfg.maxSolutions || 100000 });
    return { solCount: r.solCount, nodes: r.nodes, complete: r.complete, timedOut: r.timedOut, cand: r.cand ? Array.from(r.cand) : null };
  }
  return { error: 'unknown mode' };
}

if (typeof self !== 'undefined' && typeof postMessage === 'function') {
  self.onmessage = function (e) { postMessage(runAny(e.data)); };
}
if (typeof module !== 'undefined' && module.exports !== undefined) {
  module.exports = { runAny, search, makeSolver };
}
}
if (typeof module !== 'undefined') {
  const shim = { exports: {} };
  new Function('module', '(' + sumsWorkerMain.toString() + ')()')(shim);
  module.exports = shim.exports;
}
