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
function compileClue(clue, maxSum, letterIds, kd) {
  if (!clue) return null;
  const kdSet = set => {
    if (!kd || set === null) return set;
    const out = new Set();
    for (const v of set) { if (v - 1 >= 1) out.add(v - 1); if (v + 1 <= maxSum) out.add(v + 1); }
    return out;
  };
  return clue.map(tok => {
    if (typeof tok === 'number') {
      if (tok >= 0) {
        if (!kd) return { type: 'exact', v: tok, max: tok, min: tok };
        const s2 = kdSet(new Set([tok]));
        let mn = Infinity, mx = 0;
        for (const v of s2) { if (v < mn) mn = v; if (v > mx) mx = v; }
        return { type: 'set', set: s2, max: mx, min: mn === Infinity ? 1 : mn };
      }
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
      // displayed values run one past maxSum under KD (displayed = true + 1)
      for (let v = Math.max(kd ? 0 : 1, lo); v <= Math.min(hi, maxSum + (kd ? 1 : 0)); v++) {
        const ds = String(v).padStart(chars.length, '0').split('').map(Number);
        if (ds.length !== chars.length) continue;
        let ok = true;
        for (let p = 0; p < chars.length; p++) if (chars[p].d !== undefined && chars[p].d !== ds[p]) ok = false;
        if (ok) set.add(v);
      }
      const set2 = kdSet(set);
      let mn = Infinity, mx = 0;
      for (const v of set2) { if (v < mn) mn = v; if (v > mx) mx = v; }
      return { type: 'set', set: set2, max: mx, min: mn === Infinity ? 1 : mn };
    }
    const rawMax = Math.min(maxSum, Math.pow(10, chars.length) - 1 + (kd ? 1 : 0));
    const rawMin = Math.max(1, (chars.length === 1 ? 1 : Math.pow(10, chars.length - 1)) - (kd ? 1 : 0));
    return { type: 'letters', chars, len: chars.length, kd: !!kd, max: rawMax, min: rawMin };
  });
}

function makeSolver(cfg) {
  const { R, C, D } = cfg;
  const maxSum = D * (D + 1) / 2;
  const letterIds = [];
  const rowClues = (cfg.rowClues || []).map(cl => compileClue(cl, maxSum, letterIds, cfg.kd));
  const colClues = (cfg.colClues || []).map(cl => compileClue(cl, maxSum, letterIds, cfg.kd));
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
    if (g.kd) mx += 1;   // the displayed value is one off the true sum
    return Math.min(mx, g.max);
  }

  // bind clue group g against displayed value dv; null on mismatch
  function bindDisplayed(g, dv) {
    const ds = String(dv).split('').map(Number);
    if (ds.length !== g.len) return null;
    const bound = [];
    for (let p = 0; p < g.len; p++) {
      const ch = g.chars[p], d = ds[p];
      if (ch.d !== undefined) { if (ch.d !== d) { undoLetters(bound); return null; } }
      else if (ch.L !== undefined) {
        const cur = letterVal[ch.L];
        if (cur >= 0) { if (cur !== d) { undoLetters(bound); return null; } }
        else {
          if (letterUsed & (1 << d)) { undoLetters(bound); return null; }
          letterVal[ch.L] = d; letterUsed |= 1 << d; bound.push(ch.L);
        }
      }
    }
    return bound;
  }
  // every viable way to close group g with TRUE sum s: a list of binding undo
  // lists. Non-letter groups yield [[]] on match. KD tries s-1 and s+1.
  function closeOptions(g, s) {
    if (!g) return [[]];
    if (g.type === 'exact') return g.v === s ? [[]] : [];
    if (g.type === 'set') return (g.set === null || g.set.has(s)) ? [[]] : [];
    const cands = g.kd ? [s - 1, s + 1].filter(v => v >= 0) : [s];   // displayed 0 = true sum 1
    const out = [];
    for (const dv of cands) {
      const b = bindDisplayed(g, dv);
      if (b !== null) { out.push(b); undoLetters(b); }   // re-bound at use time
    }
    return out;
  }
  // re-apply a previously discovered binding option (must still be consistent)
  function applyOption(g, s, wantIdx) {
    if (!g || g.type !== 'letters') return [];
    const cands = g.kd ? [s - 1, s + 1].filter(v => v >= 0) : [s];
    let idx = 0;
    for (const dv of cands) {
      const b = bindDisplayed(g, dv);
      if (b !== null) { if (idx === wantIdx) return b; undoLetters(b); idx++; }
    }
    return null;
  }
  function closeGroup(g, s) {   // legacy single-option close for non-KD paths
    const opts = closeOptions(g, s);
    if (!opts.length) return null;
    if (!g || g.type !== 'letters') return [];
    return applyOption(g, s, 0);
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
    lineFeasible, groupMax, closeGroup, closeOptions, applyOption, undoLetters, FULL, letterVal, letterIds, maxSum,
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

  // iterate every combination of binding options for a list of group closes,
  // running body() inside each combination (KD makes closes branch)
  function withCloses(closes, k, body) {
    if (k === closes.length) { body(); return; }
    const { g, s } = closes[k];
    if (!g || g.type !== 'letters') {
      const opts = S.closeOptions(g, s);
      if (opts.length) withCloses(closes, k + 1, body);
      return;
    }
    const n2 = S.closeOptions(g, s).length;
    for (let oi = 0; oi < n2; oi++) {
      const b = S.applyOption(g, s, oi);
      if (b === null) continue;
      withCloses(closes, k + 1, body);
      S.undoLetters(b);
      if (timedOut || solCount >= maxSol) return;
    }
  }

  function rec(i) {
    if (timedOut || solCount >= maxSol) return;
    if ((++nodes & 2047) === 0 && Date.now() > deadline) { timedOut = true; return; }
    if (i === N) {
      // close every pending column group (each may branch under KD)
      const closes = [];
      let ok = true;
      for (let c = 0; c < C; c++) {
        const cc = S.colClues[c];
        let gi = S.colGi[c];
        if (S.colRun[c] > 0) {
          if (cc && gi >= cc.length) { ok = false; break; }
          if (cc) closes.push({ g: cc[gi], s: S.colRun[c] });
          gi++;
        }
        if (cc && gi !== cc.length) { ok = false; break; }
      }
      if (!ok) return;
      withCloses(closes, 0, () => {
        solCount++;
        if (!firstSol) { firstSol = Int8Array.from(S.grid); firstLetters = Int8Array.from(S.letterVal); }
        if (cand) for (let j = 0; j < N; j++) cand[j] |= 1 << S.grid[j];
        if (letterCand) for (const L of S.letterIds) if (S.letterVal[L] >= 0) letterCand[L] |= 1 << S.letterVal[L];
        if (post) post(S.grid, S.letterVal);
      });
      return;
    }
    const r = (i / C) | 0, c = i % C;
    const atRowEnd = c === C - 1;
    const rcl = S.rowClues[r], ccl = S.colClues[c];
    const vals = [];
    if (S.fixed && S.fixed[i] >= 0) vals.push(S.fixed[i]);
    else if (cfg.candMask && cfg.candMask[i]) { const m = cfg.candMask[i]; for (let v = 0; v <= D; v++) if ((m >> v) & 1) vals.push(v); }
    else { vals.push(0); for (let v = 1; v <= D; v++) vals.push(v); }
    for (const v of vals) {
      const sv = { rGi: S.rowGi[r], rRun: S.rowRun[r], cGi: S.colGi[c], cRun: S.colRun[c] };
      if (v === 0) {
        const closes = [];
        let ok = true;
        if (S.rowRun[r] > 0) {
          if (rcl && S.rowGi[r] >= rcl.length) ok = false;
          else if (rcl) closes.push({ g: rcl[S.rowGi[r]], s: S.rowRun[r] });
        }
        if (ok && S.colRun[c] > 0) {
          if (ccl && S.colGi[c] >= ccl.length) ok = false;
          else if (ccl) closes.push({ g: ccl[S.colGi[c]], s: S.colRun[c] });
        }
        if (ok) {
          withCloses(closes, 0, () => {
            if (S.rowRun[r] > 0) { S.rowGi[r]++; S.rowRun[r] = 0; }
            if (S.colRun[c] > 0) { S.colGi[c]++; S.colRun[c] = 0; }
            S.grid[i] = v;
            let fine = true;
            if (atRowEnd && S.rowRun[r] === 0 && rcl && S.rowGi[r] !== rcl.length) fine = false;
            if (fine && !S.lineFeasible(rcl, S.rowGi[r], S.rowRun[r], C - 1 - c, ~S.rowMask[r] & S.FULL)) fine = false;
            if (fine && !S.lineFeasible(ccl, S.colGi[c], S.colRun[c], R - 1 - r, ~S.colMask[c] & S.FULL)) fine = false;
            if (fine) rec(i + 1);
            S.grid[i] = -1;
            S.rowGi[r] = sv.rGi; S.rowRun[r] = sv.rRun; S.colGi[c] = sv.cGi; S.colRun[c] = sv.cRun;
          });
        }
      } else {
        let ok = true;
        if ((S.rowMask[r] & (1 << v)) || (S.colMask[c] & (1 << v))) ok = false;
        if (ok && rcl) {
          if (S.rowGi[r] >= rcl.length) ok = false;
          else if (S.rowRun[r] + v > S.groupMax(rcl[S.rowGi[r]])) ok = false;
        }
        if (ok && ccl) {
          if (S.colGi[c] >= ccl.length) ok = false;
          else if (S.colRun[c] + v > S.groupMax(ccl[S.colGi[c]])) ok = false;
        }
        if (ok) {
          S.rowMask[r] |= 1 << v; S.colMask[c] |= 1 << v;
          S.rowRun[r] += v; S.colRun[c] += v;
          S.grid[i] = v;
          const finish = () => {
            let fine = true;
            if (atRowEnd && rcl && S.rowGi[r] !== rcl.length) fine = false;
            if (fine && !S.lineFeasible(rcl, S.rowGi[r], S.rowRun[r], C - 1 - c, ~S.rowMask[r] & S.FULL)) fine = false;
            if (fine && !S.lineFeasible(ccl, S.colGi[c], S.colRun[c], R - 1 - r, ~S.colMask[c] & S.FULL)) fine = false;
            if (fine) rec(i + 1);
          };
          if (atRowEnd && S.rowRun[r] > 0) {
            // the row's pending group closes here (may branch)
            if (!(rcl && S.rowGi[r] >= rcl.length)) {
              const closes = rcl ? [{ g: rcl[S.rowGi[r]], s: S.rowRun[r] }] : [];
              withCloses(closes, 0, () => {
                const svR = { gi: S.rowGi[r], run: S.rowRun[r] };
                S.rowGi[r]++; S.rowRun[r] = 0;
                finish();
                S.rowGi[r] = svR.gi; S.rowRun[r] = svR.run;
              });
            }
          } else finish();
          S.grid[i] = -1;
          S.rowMask[r] &= ~(1 << v); S.colMask[c] &= ~(1 << v);
          S.rowRun[r] = sv.rRun; S.colRun[c] = sv.cRun;
        }
      }
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
