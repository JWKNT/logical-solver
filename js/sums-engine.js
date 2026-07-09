// Japanese Sums search engine: solve, count solutions, and per-cell candidate
// statuses. Supports pattern clues ('?' = one digit 1-9, '1?' = 10..19, '?1' =
// 11,21,..,91 — no leading zero) and crypto letters (each letter A-Z stands
// for one digit 0-9, all letters distinct, bound consistently puzzle-wide).
// Runs in a Web Worker in the page (via Blob) and as a Node module for tests.
function sumsWorkerMain() {

// clue tokens -> group objects
// token: number (exact), or string of [0-9A-Z?]: digits fixed, '?' wildcard,
// letters crypto variables. A one-char '?' means a single digit 1..9, '??'
// a two-digit sum, etc. No leading zeros for multi-digit values.
function compileClue(clue, maxSum, letterIds) {
  if (!clue) return null;
  return clue.map(tok => {
    if (typeof tok === 'number') {
      if (tok >= 0) return { type: 'exact', v: tok, max: tok, min: tok };
      // legacy -1: completely unknown sum
      return { type: 'set', set: null, max: maxSum, min: 1 };
    }
    const s = String(tok).toUpperCase().trim();
    const chars = [];
    let hasLetter = false;
    for (const ch of s) {
      if (ch >= '0' && ch <= '9') chars.push({ d: ch.charCodeAt(0) - 48 });
      else if (ch === '?') chars.push({ q: true });
      else if (ch >= 'A' && ch <= 'Z') { chars.push({ L: ch.charCodeAt(0) - 65 }); hasLetter = true; if (!letterIds.includes(ch.charCodeAt(0) - 65)) letterIds.push(ch.charCodeAt(0) - 65); }
    }
    if (!chars.length) return { type: 'set', set: null, max: maxSum, min: 1 };
    if (!hasLetter) {
      // fixed set of matching values
      const set = new Set();
      const lo = chars.length === 1 ? 0 : Math.pow(10, chars.length - 1);
      const hi = Math.pow(10, chars.length) - 1;
      for (let v = Math.max(1, lo); v <= Math.min(hi, maxSum); v++) {
        const ds = String(v).padStart(chars.length, '0').split('').map(Number);
        if (ds.length !== chars.length) continue;
        let ok = true;
        for (let p = 0; p < chars.length; p++) if (chars[p].d !== undefined && chars[p].d !== ds[p]) ok = false;
        if (ok) set.add(v);
      }
      let mn = Infinity, mx = 0;
      for (const v of set) { if (v < mn) mn = v; if (v > mx) mx = v; }
      return { type: 'set', set, max: mx, min: mn === Infinity ? 1 : mn };
    }
    return { type: 'letters', chars, len: chars.length,
      max: Math.min(maxSum, Math.pow(10, chars.length) - 1),
      min: chars.length === 1 ? 1 : Math.pow(10, chars.length - 1) };
  });
}

function makeSolver(cfg) {
  const { R, C, D } = cfg;
  const maxSum = D * (D + 1) / 2;
  const letterIds = [];
  const rowClues = (cfg.rowClues || []).map(cl => compileClue(cl, maxSum, letterIds));
  const colClues = (cfg.colClues || []).map(cl => compileClue(cl, maxSum, letterIds));
  const N = R * C;
  const grid = new Int8Array(N).fill(-1);
  const rowMask = new Int32Array(R), colMask = new Int32Array(C);
  const rowGi = new Int32Array(R), rowRun = new Int32Array(R);
  const colGi = new Int32Array(C), colRun = new Int32Array(C);
  const FULL = (1 << (D + 1)) - 2;
  // crypto letter state
  const letterVal = new Int8Array(26).fill(-1);
  let letterUsed = 0;   // digits 0-9 taken by letters

  function maxSumOf(mask) { let s = 0; for (let d = D; d >= 1; d--) if (mask & (1 << d)) s += d; return s; }
  function minAvail(mask) { for (let d = 1; d <= D; d++) if (mask & (1 << d)) return d; return 0; }

  function groupMax(g) {
    if (!g) return maxSum;
    if (g.type !== 'letters') return g.max;
    // tighten by bound letters
    let mx = 0;
    for (let p = 0; p < g.len; p++) {
      const ch = g.chars[p];
      let d = 9;
      if (ch.d !== undefined) d = ch.d;
      else if (ch.L !== undefined && letterVal[ch.L] >= 0) d = letterVal[ch.L];
      mx = mx * 10 + d;
    }
    return Math.min(mx, g.max);
  }

  // close a group with sum s against clue group g. Returns null (fail) or an
  // undo list of letters bound by this closure.
  function closeGroup(g, s) {
    if (!g) return [];
    if (g.type === 'exact') return g.v === s ? [] : null;
    if (g.type === 'set') return (g.set === null || g.set.has(s)) ? [] : null;
    const ds = String(s).split('').map(Number);
    if (ds.length !== g.len) return null;
    const bound = [];
    for (let p = 0; p < g.len; p++) {
      const ch = g.chars[p], d = ds[p];
      if (ch.d !== undefined) { if (ch.d !== d) { undoLetters(bound); return null; } }
      else if (ch.L !== undefined) {
        const cur = letterVal[ch.L];
        if (cur >= 0) { if (cur !== d) { undoLetters(bound); return null; } }
        else {
          if (letterUsed & (1 << d)) { undoLetters(bound); return null; }   // another letter has d
          letterVal[ch.L] = d; letterUsed |= 1 << d; bound.push(ch.L);
        }
      }
    }
    return bound;
  }
  function undoLetters(bound) {
    for (const L of bound) { letterUsed &= ~(1 << letterVal[L]); letterVal[L] = -1; }
  }

  function lineFeasible(clue, gi, run, left, avail) {
    if (!clue) return true;
    if (run > 0) {
      if (gi >= clue.length) return false;
      const g = clue[gi];
      const gm = groupMax(g);
      if (run > gm) return false;
      if (run < g.min || run < gm) {
        // may need to extend; ensure it's possible when it must
        if (run < g.min) {
          if (left <= 0) return false;
          if (run + maxSumOf(avail) < g.min) return false;
          if (minAvail(avail) === 0) return false;
        }
      }
    }
    let cellsNeeded = (run > 0 && clue[gi] && run < clue[gi].min) ? 1 : 0;
    for (let g2 = gi + (run > 0 ? 1 : 0); g2 < clue.length; g2++) cellsNeeded += 2;
    if (run === 0 && gi < clue.length && cellsNeeded >= 2) cellsNeeded -= 1;
    return cellsNeeded <= left;
  }

  return { grid, rowMask, colMask, rowGi, rowRun, colGi, colRun, rowClues, colClues,
    lineFeasible, groupMax, closeGroup, undoLetters, FULL, letterVal, letterIds, maxSum,
    fixed: cfg.fixed || null };
}

function search(cfg, opts) {
  const { R, C, D } = cfg;
  const S = makeSolver(cfg);
  const N = R * C;
  const deadline = Date.now() + (opts.timeLimit || 10000);
  let nodes = 0, solCount = 0, timedOut = false;
  const maxSol = opts.maxSolutions || Infinity;
  let firstSol = null, firstLetters = null;
  const cand = opts.collect ? new Int32Array(N) : null;
  const letterCand = opts.collect ? new Int32Array(26) : null;
  const post = opts.onSolution || null;

  function rec(i) {
    if (timedOut || solCount >= maxSol) return;
    if ((++nodes & 2047) === 0 && Date.now() > deadline) { timedOut = true; return; }
    if (i === N) {
      // close pending column groups
      const undos = [];
      let ok = true;
      for (let c = 0; c < C && ok; c++) {
        const cc = S.colClues[c];
        let gi = S.colGi[c];
        if (S.colRun[c] > 0) {
          const u = S.closeGroup(cc ? cc[gi] : null, S.colRun[c]);
          if (u === null || (cc && gi >= cc.length)) { ok = false; break; }
          undos.push(u); gi++;
        }
        if (cc && gi !== cc.length) { ok = false; break; }
      }
      if (ok) {
        solCount++;
        if (!firstSol) { firstSol = Int8Array.from(S.grid); firstLetters = Int8Array.from(S.letterVal); }
        if (cand) for (let j = 0; j < N; j++) cand[j] |= 1 << S.grid[j];
        if (letterCand) for (const L of S.letterIds) if (S.letterVal[L] >= 0) letterCand[L] |= 1 << S.letterVal[L];
        if (post) post(S.grid, S.letterVal);
      }
      for (let k = undos.length - 1; k >= 0; k--) S.undoLetters(undos[k]);
      return;
    }
    const r = (i / C) | 0, c = i % C;
    const atRowEnd = c === C - 1;
    const rcl = S.rowClues[r], ccl = S.colClues[c];
    const vals = [];
    if (S.fixed && S.fixed[i] >= 0) vals.push(S.fixed[i]);
    else { vals.push(0); for (let v = 1; v <= D; v++) vals.push(v); }
    for (const v of vals) {
      let undoR = null, undoC = null;
      let ok = true;
      const sv = { rGi: S.rowGi[r], rRun: S.rowRun[r], cGi: S.colGi[c], cRun: S.colRun[c] };
      if (v === 0) {
        if (S.rowRun[r] > 0) {
          if (rcl && S.rowGi[r] >= rcl.length) ok = false;
          else { undoR = S.closeGroup(rcl ? rcl[S.rowGi[r]] : null, S.rowRun[r]); if (undoR === null) ok = false; }
          if (ok) { S.rowGi[r]++; S.rowRun[r] = 0; }
        }
        if (ok && S.colRun[c] > 0) {
          if (ccl && S.colGi[c] >= ccl.length) ok = false;
          else { undoC = S.closeGroup(ccl ? ccl[S.colGi[c]] : null, S.colRun[c]); if (undoC === null) ok = false; }
          if (ok) { S.colGi[c]++; S.colRun[c] = 0; }
        }
      } else {
        if ((S.rowMask[r] & (1 << v)) || (S.colMask[c] & (1 << v))) ok = false;
        if (ok && rcl) {
          if (S.rowGi[r] >= rcl.length) ok = false;
          else if (S.rowRun[r] + v > S.groupMax(rcl[S.rowGi[r]])) ok = false;
        }
        if (ok && ccl) {
          if (S.colGi[c] >= ccl.length) ok = false;
          else if (S.colRun[c] + v > S.groupMax(ccl[S.colGi[c]])) ok = false;
        }
        if (ok) { S.rowMask[r] |= 1 << v; S.colMask[c] |= 1 << v; S.rowRun[r] += v; S.colRun[c] += v; }
      }
      if (ok) {
        S.grid[i] = v;
        let fine = true;
        if (atRowEnd) {
          // close the row's pending group and require the clue exhausted
          if (S.rowRun[r] > 0) {
            const rg = rcl ? rcl[S.rowGi[r]] : null;
            if (rcl && S.rowGi[r] >= rcl.length) fine = false;
            else {
              const u = S.closeGroup(rg, S.rowRun[r]);
              if (u === null) fine = false;
              else { sv.rowEndUndo = u; S.rowGi[r]++; S.rowRun[r] = 0; }
            }
          }
          if (fine && rcl && S.rowGi[r] !== rcl.length) fine = false;
        }
        if (fine && !S.lineFeasible(rcl, S.rowGi[r], S.rowRun[r], C - 1 - c, ~S.rowMask[r] & S.FULL)) fine = false;
        if (fine && !S.lineFeasible(ccl, S.colGi[c], S.colRun[c], R - 1 - r, ~S.colMask[c] & S.FULL)) fine = false;
        if (fine) rec(i + 1);
        if (sv.rowEndUndo) S.undoLetters(sv.rowEndUndo);
      }
      // restore
      S.grid[i] = -1;
      if (v > 0 && ok) { S.rowMask[r] &= ~(1 << v); S.colMask[c] &= ~(1 << v); }
      if (undoR) S.undoLetters(undoR);
      if (undoC) S.undoLetters(undoC);
      S.rowGi[r] = sv.rGi; S.rowRun[r] = sv.rRun; S.colGi[c] = sv.cGi; S.colRun[c] = sv.cRun;
      if (timedOut || solCount >= maxSol) return;
    }
  }
  rec(0);
  return { solCount, nodes, timedOut, complete: !timedOut, firstSol, firstLetters, cand, letterCand,
    letterIds: S.letterIds };
}

function runAny(cfg) {
  if (cfg.mode === 'solve') {
    const r = search(cfg, { timeLimit: cfg.timeLimit, maxSolutions: 1 });
    return { firstSol: r.firstSol ? Array.from(r.firstSol) : null,
      firstLetters: r.firstLetters ? Array.from(r.firstLetters) : null,
      letterIds: r.letterIds, nodes: r.nodes, timedOut: r.timedOut };
  }
  if (cfg.mode === 'count') {
    const r = search(cfg, { timeLimit: cfg.timeLimit, maxSolutions: cfg.maxSolutions || 10000 });
    return { solCount: r.solCount, nodes: r.nodes, complete: r.complete, timedOut: r.timedOut };
  }
  if (cfg.mode === 'candidates') {
    const r = search(cfg, { timeLimit: cfg.timeLimit, collect: true, maxSolutions: cfg.maxSolutions || 100000 });
    return { solCount: r.solCount, nodes: r.nodes, complete: r.complete, timedOut: r.timedOut,
      cand: r.cand ? Array.from(r.cand) : null,
      letterCand: r.letterCand ? Array.from(r.letterCand) : null,
      letterIds: r.letterIds };
  }
  return { error: 'unknown mode' };
}

if (typeof self !== 'undefined' && typeof postMessage === 'function') {
  self.onmessage = function (e) { postMessage(runAny(e.data)); };
}
if (typeof module !== 'undefined' && module.exports !== undefined) {
  module.exports = { runAny, search, makeSolver, compileClue };
}
}
if (typeof module !== 'undefined') {
  const shim = { exports: {} };
  new Function('module', '(' + sumsWorkerMain.toString() + ')()')(shim);
  module.exports = shim.exports;
}
