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
function compileClue(clue, maxSum, letterIds, kd, minSumRef, zeroOk) {
  minSumRef = minSumRef || 0;
  if (!clue) return null;
  const kdSet = set => {
    if (!kd || set === null) return set;
    const out = new Set();
    for (const v of set) { out.add(v - 1); if (v + 1 <= maxSum) out.add(v + 1); }
    return out;
  };
  return clue.map(tok => {
    if (typeof tok === 'number') {
      // numeric clues are always exact (negative sums included); '#' is the catch-all
      if (!kd) return { type: 'exact', v: tok, max: tok, min: tok };
      const s2 = kdSet(new Set([tok]));
      let mn = Infinity, mx = 0;
      for (const v of s2) { if (v < mn) mn = v; if (v > mx) mx = v; }
      return { type: 'set', set: s2, max: mx, min: mn === Infinity ? 1 : mn };
    }
    let s = String(tok).toUpperCase().trim();
    let neg = false;
    if (s[0] === '-') { neg = true; s = s.slice(1); }
    const chars = [];
    let hasLetter = false;
    for (const ch of s) {
      if (ch >= '0' && ch <= '9') chars.push({ d: ch.charCodeAt(0) - 48 });
      else if (ch === '#') return { type: 'set', set: null, max: maxSum, min: 1 };
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
      const vlo = Math.max((kd || (zeroOk && !neg)) ? 0 : 1, lo);
      for (let v = vlo; v <= Math.min(hi, Math.abs(neg ? -1e9 : maxSum) + (kd ? 1 : 0)); v++) {
        if (neg && v === 0) continue;   // '-?' and kin are strictly negative
        const ds = String(v).padStart(chars.length, '0').split('').map(Number);
        if (ds.length !== chars.length) continue;
        let ok = true;
        for (let p = 0; p < chars.length; p++) if (chars[p].d !== undefined && chars[p].d !== ds[p]) ok = false;
        if (ok) set.add(neg ? -v : v);
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
  const { R, C } = cfg;
  // value palette: distinct values (any integers) with per-line multiplicities
  // (default: digits 1..D once each)
  let pal, cnt;
  if (cfg.values && cfg.values.length) {
    const byVal = new Map();
    for (const v of cfg.values) byVal.set(v, (byVal.get(v) || 0) + 1);
    pal = [...byVal.keys()].sort((a, b) => a - b);
    cnt = pal.map(v => Math.min(3, byVal.get(v)));
  } else {
    pal = []; cnt = [];
    for (let d = 1; d <= cfg.D; d++) { pal.push(d); cnt.push(1); }
  }
  const M = pal.length;                       // mask bits 1..M
  const maxSum = pal.reduce((a, v, k) => a + (v > 0 ? v * cnt[k] : 0), 0);
  const minSum = pal.reduce((a, v, k) => a + (v < 0 ? v * cnt[k] : 0), 0);
  const letterIds = [];
  const rowClues = (cfg.rowClues || []).map(cl => compileClue(cl, maxSum, letterIds, cfg.kd, minSum, minSum < 0 || pal.includes(0)));
  const colClues = (cfg.colClues || []).map(cl => compileClue(cl, maxSum, letterIds, cfg.kd, minSum, minSum < 0 || pal.includes(0)));
  const V = Object.assign({ numConn: false, blankConn: false, no22num: false, no22blank: false, asc: false, reach: false },
    cfg.coral ? { blankConn: true, no22blank: true, asc: true, reach: true } : null,
    cfg.variants || null);
  const coral = V.asc;   // 'coral' below = unordered ascending clues
  const N = R * C;
  const grid = new Int8Array(N).fill(-1);          // 0 = blank, k = palette index k (1..M)
  const rowPack = new Int32Array(R), colPack = new Int32Array(C);   // 2-bit usage counters per value
  // unified line state: which clue indices are used + the value each took
  const rowUsed = new Int32Array(R), colUsed = new Int32Array(C);
  const rowRun = new Int32Array(R), colRun = new Int32Array(C);
  const rowLen = new Int32Array(R), colLen = new Int32Array(C);   // cells in the pending group
  const rowVals = rowClues.map(cl => cl ? new Int8Array(cl.length) : null);
  const colVals = colClues.map(cl => cl ? new Int8Array(cl.length) : null);
  const FULL = (1 << (M + 1)) - 2;
  const letterVal = new Int8Array(26).fill(-1);
  let letterUsed = 0;

  function popcnt(m) { let c = 0; while (m) { c += m & 1; m >>>= 1; } return c; }
  function usedOf(pack, k) { return (pack >> (2 * k)) & 3; }
  function bumpPack(pack, k) { return pack + (1 << (2 * k)); }
  function dropPack(pack, k) { return pack - (1 << (2 * k)); }
  // remaining positive / negative capacity of a line (for two-sided pruning)
  function posLeft(pack) { let s = 0; for (let k = 0; k < M; k++) if (pal[k] > 0) s += pal[k] * (cnt[k] - usedOf(pack, k)); return s; }
  function negLeft(pack) { let s = 0; for (let k = 0; k < M; k++) if (pal[k] < 0) s += pal[k] * (cnt[k] - usedOf(pack, k)); return s; }
  function anyLeft(pack) { for (let k = 0; k < M; k++) if (usedOf(pack, k) < cnt[k]) return true; return false; }

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
  function undoLetters(bound) {
    for (const L of bound) { letterUsed &= ~(1 << letterVal[L]); letterVal[L] = -1; }
  }
  function groupMatchOptions(g, s) {
    // ways one clue group can absorb TRUE sum s: list of displayed values
    if (g.type === 'exact') return g.v === s ? [g.v] : [];
    if (g.type === 'set') return (g.set === null || g.set.has(s)) ? [s] : [];
    const cands = g.kd ? [s - 1, s + 1].filter(v => v >= 0) : [s];
    return cands;   // viability of letter binding checked at bind time
  }

  // every viable close of TRUE sum s in this line: pick an unused clue index
  // (any index under coral, the next-in-order index otherwise), a displayed
  // value its token matches, and (coral) keep the values ascending by index
  function closeList(clue, used, vals, s) {
    if (!clue) return [{ k: -1, dv: 0 }];
    const out = [];
    const idxs = [];
    if (coral) { for (let k = 0; k < clue.length; k++) if (!(used & (1 << k))) idxs.push(k); }
    else { const k = popcnt(used); if (k < clue.length) idxs.push(k); }
    for (const k of idxs) {
      const g = clue[k];
      for (const dv of groupMatchOptions(g, s)) {
        if (coral) {
          let ok = true;
          for (let k2 = 0; k2 < clue.length && ok; k2++) {
            if (!(used & (1 << k2)) || k2 === k) continue;
            if (k2 < k && vals[k2] > s) ok = false;
            if (k2 > k && vals[k2] < s) ok = false;
          }
          if (!ok) continue;
        }
        out.push({ k, dv, g });
      }
    }
    return out;
  }
  function applyClose(clue, usedRef, vals, s, opt) {
    // returns undo record or null (letter binding may fail)
    if (!clue) return { bound: [] };
    let bound = [];
    if (opt.g.type === 'letters') {
      bound = bindDisplayed(opt.g, opt.dv);
      if (bound === null) return null;
    }
    usedRef.m |= 1 << opt.k;
    vals[opt.k] = s;
    return { bound, k: opt.k };
  }
  function undoClose(clue, usedRef, vals, rec2) {
    if (!clue) return;
    undoLetters(rec2.bound);
    usedRef.m &= ~(1 << rec2.k);
    vals[rec2.k] = 0;
  }

  function groupMaxUnused(clue, used) {
    if (!clue) return maxSum;
    let mx = 0;
    if (coral) { for (let k = 0; k < clue.length; k++) if (!(used & (1 << k))) mx = Math.max(mx, groupMaxOf(clue[k])); }
    else { const k = popcnt(used); if (k < clue.length) mx = groupMaxOf(clue[k]); }
    return mx;
  }
  function groupMaxOf(g) {
    if (g.type !== 'letters') return g.max;
    let mx = 0;
    for (let p = 0; p < g.len; p++) {
      const ch = g.chars[p];
      let d = 9;
      if (ch.d !== undefined) d = ch.d;
      else if (ch.L !== undefined && letterVal[ch.L] >= 0) d = letterVal[ch.L];
      mx = mx * 10 + d;
    }
    if (g.kd) mx += 1;
    return Math.min(mx, g.max);
  }
  function groupMinNext(clue, used) {
    if (!clue) return 1;
    if (coral) { let mn = Infinity; for (let k = 0; k < clue.length; k++) if (!(used & (1 << k))) mn = Math.min(mn, clue[k].min); return mn === Infinity ? 1 : mn; }
    const k = popcnt(used);
    return k < clue.length ? clue[k].min : 1;
  }

  function lineFeasible(clue, used, run, runLen, left, avail) {
    if (!clue) return true;
    const usedN = popcnt(used);
    if (runLen > 0) {
      if (usedN >= clue.length) return false;
      const gm = groupMaxUnused(clue, used);
      if (run > gm && negLeft(avail) === 0) return false;   // cannot come back down
      const gmin = groupMinNext(clue, used);
      if (run < gmin || run > gm) {
        // must extend: reachable window is [run + negLeft, run + posLeft]
        if (left <= 0) return false;
        if (!anyLeft(avail)) return false;
        if (run + posLeft(avail) < gmin) return false;
        if (run + negLeft(avail) > gm) return false;
      }
    }
    const pending = runLen > 0 ? 1 : 0;
    let cellsNeeded = (runLen > 0 && (run < groupMinNext(clue, used) || run > groupMaxUnused(clue, used))) ? 1 : 0;
    for (let g2 = usedN + pending; g2 < clue.length; g2++) cellsNeeded += 2;
    if (run === 0 && usedN < clue.length && cellsNeeded >= 2) cellsNeeded -= 1;
    return cellsNeeded <= left;
  }
  function lineDone(clue, used, run) {
    if (!clue) return run === 0 || true;
    return run === 0 && popcnt(used) === clue.length;
  }

  return { grid, rowPack, colPack, rowUsed, colUsed, rowRun, colRun, rowLen, colLen, rowVals, colVals,
    rowClues, colClues, closeList, applyClose, undoClose, lineFeasible, lineDone,
    groupMaxUnused, undoLetters, FULL, letterVal, letterIds, maxSum, minSum, coral, V, popcnt,
    pal, cnt, M, usedOf, bumpPack, dropPack, posLeft, negLeft,
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
  const V = S.V;
  // under ascending (unordered) clues, equal group sums can close into
  // different clue indices and reach the same solution twice - dedupe
  const seenSol = V.asc ? new Set() : null;
  const rowUsedRef = Array.from({ length: R }, (_, r) => ({ get m() { return S.rowUsed[r]; }, set m(v) { S.rowUsed[r] = v; } }));
  const colUsedRef = Array.from({ length: C }, (_, c) => ({ get m() { return S.colUsed[c]; }, set m(v) { S.colUsed[c] = v; } }));

  // coral shape: no blank 2x2 (checked incrementally), blanks connected, and
  // every filled component touches the grid edge (checked on completion)
  function connectedOk(isMember) {
    let start = -1, total = 0;
    for (let i = 0; i < N; i++) if (isMember(i)) { total++; if (start < 0) start = i; }
    if (total === 0) return true;
    const seen = new Uint8Array(N);
    const stack = [start];
    seen[start] = 1;
    let cnt = 0;
    while (stack.length) {
      const i = stack.pop(); cnt++;
      const r = (i / C) | 0, c = i % C;
      for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const r2 = r + dr, c2 = c + dc;
        if (r2 < 0 || r2 >= R || c2 < 0 || c2 >= C) continue;
        const j = r2 * C + c2;
        if (!seen[j] && isMember(j)) { seen[j] = 1; stack.push(j); }
      }
    }
    return cnt === total;
  }
  function shapeOk() {
    if (V.blankConn && !connectedOk(i => S.grid[i] === 0)) return false;
    if (V.numConn && !connectedOk(i => S.grid[i] > 0)) return false;
    if (!V.reach) return true;
    return reachOk();
  }
  function coralOk() {
    // blanks connected
    let start = -1, blanks = 0;
    for (let i = 0; i < N; i++) if (S.grid[i] === 0) { blanks++; if (start < 0) start = i; }
    if (blanks > 0) {
      const seen = new Uint8Array(N);
      const stack = [start];
      seen[start] = 1;
      let cnt = 0;
      while (stack.length) {
        const i = stack.pop(); cnt++;
        const r = (i / C) | 0, c = i % C;
        for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const r2 = r + dr, c2 = c + dc;
          if (r2 < 0 || r2 >= R || c2 < 0 || c2 >= C) continue;
          const j = r2 * C + c2;
          if (!seen[j] && S.grid[j] === 0) { seen[j] = 1; stack.push(j); }
        }
      }
      if (cnt !== blanks) return false;
    }
    return true;
  }
  function reachOk() {
    // filled components reach the edge
    const seenF = new Uint8Array(N);
    const stackF = [];
    for (let i = 0; i < N; i++) {
      const r = (i / C) | 0, c = i % C;
      if (S.grid[i] > 0 && (r === 0 || c === 0 || r === R - 1 || c === C - 1)) { seenF[i] = 1; stackF.push(i); }
    }
    while (stackF.length) {
      const i = stackF.pop();
      const r = (i / C) | 0, c = i % C;
      for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const r2 = r + dr, c2 = c + dc;
        if (r2 < 0 || r2 >= R || c2 < 0 || c2 >= C) continue;
        const j = r2 * C + c2;
        if (!seenF[j] && S.grid[j] > 0) { seenF[j] = 1; stackF.push(j); }
      }
    }
    for (let i = 0; i < N; i++) if (S.grid[i] > 0 && !seenF[i]) return false;
    return true;
  }

  // iterate every combination of close options for a list of pending closes
  function withCloses(closes, k, body) {
    if (k === closes.length) { body(); return; }
    const cl = closes[k];
    const opts = S.closeList(cl.clue, cl.usedRef ? cl.usedRef.m : 0, cl.vals, cl.s);
    for (const opt of opts) {
      if (!cl.clue) { withCloses(closes, k + 1, body); return; }
      const rec2 = S.applyClose(cl.clue, cl.usedRef, cl.vals, cl.s, opt);
      if (rec2 === null) continue;
      withCloses(closes, k + 1, body);
      S.undoClose(cl.clue, cl.usedRef, cl.vals, rec2);
      if (timedOut || solCount >= maxSol) return;
    }
  }

  function rec(i) {
    if (timedOut || solCount >= maxSol) return;
    if ((++nodes & 2047) === 0 && Date.now() > deadline) { timedOut = true; return; }
    if (i === N) {
      const closes = [];
      let ok = true;
      for (let c = 0; c < C && ok; c++) {
        if (S.colLen[c] > 0) closes.push({ clue: S.colClues[c], usedRef: colUsedRef[c], vals: S.colVals[c], s: S.colRun[c] });
      }
      withCloses(closes, 0, () => {
        // all clue lists must be exhausted
        for (let c = 0; c < C; c++) { const cc = S.colClues[c]; if (cc && S.popcnt(S.colUsed[c]) !== cc.length) return; }
        if (!shapeOk()) return;
        if (seenSol) {
          let key = '';
          for (let j = 0; j < N; j++) key += S.grid[j] + ',';
          for (const L of S.letterIds) key += '|' + S.letterVal[L];
          if (seenSol.has(key)) return;
          seenSol.add(key);
        }
        solCount++;
        if (!firstSol) { firstSol = Int16Array.from(S.grid, k => k === 0 ? 0 : S.pal[k - 1]); firstLetters = Int8Array.from(S.letterVal); }
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
    else if (cfg.candMask && cfg.candMask[i]) { const m = cfg.candMask[i]; for (let v = 0; v <= S.M; v++) if ((m >> v) & 1) vals.push(v); }
    else { vals.push(0); for (let v = 1; v <= S.M; v++) vals.push(v); }
    for (const v of vals) {
      const svRRun = S.rowRun[r], svCRun = S.colRun[c], svRLen = S.rowLen[r], svCLen = S.colLen[c];
      if (v === 0) {
        // forbid a 2x2 of blanks when the variant demands it
        if (V.no22blank && r > 0 && c > 0 && S.grid[i - 1] === 0 && S.grid[i - C] === 0 && S.grid[i - C - 1] === 0) continue;
        const closes = [];
        if (S.rowLen[r] > 0) closes.push({ clue: rcl, usedRef: rowUsedRef[r], vals: S.rowVals[r], s: S.rowRun[r] });
        if (S.colLen[c] > 0) closes.push({ clue: ccl, usedRef: colUsedRef[c], vals: S.colVals[c], s: S.colRun[c] });
        withCloses(closes, 0, () => {
          S.rowRun[r] = 0; S.colRun[c] = 0; S.rowLen[r] = 0; S.colLen[c] = 0;
          S.grid[i] = v;
          let fine = true;
          if (atRowEnd && rcl && S.popcnt(S.rowUsed[r]) !== rcl.length) fine = false;
          if (fine && !S.lineFeasible(rcl, S.rowUsed[r], S.rowRun[r], S.rowLen[r], C - 1 - c, S.rowPack[r])) fine = false;
          if (fine && !S.lineFeasible(ccl, S.colUsed[c], S.colRun[c], S.colLen[c], R - 1 - r, S.colPack[c])) fine = false;
          if (fine) rec(i + 1);
          S.grid[i] = -1;
          S.rowRun[r] = svRRun; S.colRun[c] = svCRun; S.rowLen[r] = svRLen; S.colLen[c] = svCLen;
        });
      } else {
        let ok = true;
        if (S.usedOf(S.rowPack[r], v - 1) >= S.cnt[v - 1] || S.usedOf(S.colPack[c], v - 1) >= S.cnt[v - 1]) ok = false;
        if (ok && rcl && S.pal[v - 1] > 0 && S.rowRun[r] + S.pal[v - 1] > S.groupMaxUnused(rcl, S.rowUsed[r]) && S.negLeft(S.rowPack[r]) - Math.min(0, S.pal[v - 1]) === 0) ok = false;
        if (ok && rcl && S.popcnt(S.rowUsed[r]) >= rcl.length && S.rowLen[r] === 0) ok = false;
        if (ok && ccl && S.pal[v - 1] > 0 && S.colRun[c] + S.pal[v - 1] > S.groupMaxUnused(ccl, S.colUsed[c]) && S.negLeft(S.colPack[c]) === 0) ok = false;
        if (ok && ccl && S.popcnt(S.colUsed[c]) >= ccl.length && S.colLen[c] === 0) ok = false;
        if (ok && V.no22num && r > 0 && c > 0 && S.grid[i - 1] > 0 && S.grid[i - C] > 0 && S.grid[i - C - 1] > 0) ok = false;
        if (ok) {
          S.rowPack[r] = S.bumpPack(S.rowPack[r], v - 1); S.colPack[c] = S.bumpPack(S.colPack[c], v - 1);
          S.rowRun[r] += S.pal[v - 1]; S.colRun[c] += S.pal[v - 1];
          S.rowLen[r]++; S.colLen[c]++;
          S.grid[i] = v;
          const finish = () => {
            let fine = true;
            if (fine && !S.lineFeasible(rcl, S.rowUsed[r], S.rowRun[r], S.rowLen[r], C - 1 - c, S.rowPack[r])) fine = false;
            if (fine && !S.lineFeasible(ccl, S.colUsed[c], S.colRun[c], S.colLen[c], R - 1 - r, S.colPack[c])) fine = false;
            if (fine) rec(i + 1);
          };
          if (atRowEnd) {
            // the row's pending group closes at the boundary
            const closes = [{ clue: rcl, usedRef: rowUsedRef[r], vals: S.rowVals[r], s: S.rowRun[r] }];
            withCloses(closes, 0, () => {
              const svRun = S.rowRun[r], svLen2 = S.rowLen[r];
              S.rowRun[r] = 0; S.rowLen[r] = 0;
              let fine = !(rcl && S.popcnt(S.rowUsed[r]) !== rcl.length);
              if (fine) finish();
              S.rowRun[r] = svRun; S.rowLen[r] = svLen2;
            });
          } else finish();
          S.grid[i] = -1;
          S.rowPack[r] = S.dropPack(S.rowPack[r], v - 1); S.colPack[c] = S.dropPack(S.colPack[c], v - 1);
          S.rowRun[r] = svRRun; S.colRun[c] = svCRun; S.rowLen[r] = svRLen; S.colLen[c] = svCLen;
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
