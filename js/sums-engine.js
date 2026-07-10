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
function digitsInBase(v, b, len) {
  // digits of |v| in base b, or null if it does not fit exactly `len` digits
  let x = Math.abs(v);
  const a = [];
  if (x === 0) a.push(0);
  else while (x > 0) { a.unshift(x % b); x = (x / b) | 0; }
  if (a.length > len) return null;
  while (a.length < len) a.unshift(0);
  return a;
}
function compileClue(clue, maxSum, letterIds, kd, minSumRef, zeroOk, base) {
  minSumRef = minSumRef || 0;
  base = base || 10;
  if (!clue) return null;
  const kdSet = set => {
    if (!kd || set === null) return set;
    const out = new Set();
    for (const v of set) { out.add(v - 1); if (v + 1 <= maxSum) out.add(v + 1); }
    return out;
  };
  return clue.map(tok => {
    if (typeof tok === 'number' && base === 10) {
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
    const addChar = ch => {
      if (ch === '#') return 'any';
      if (ch === '?') { chars.push({ q: true }); return; }
      if (ch >= 'A' && ch <= 'Z') { chars.push({ L: ch.charCodeAt(0) - 65 }); hasLetter = true; if (!letterIds.includes(ch.charCodeAt(0) - 65)) letterIds.push(ch.charCodeAt(0) - 65); return; }
      if (ch >= '0' && ch <= '9') chars.push({ d: ch.charCodeAt(0) - 48 });
    };
    if (base !== 10 && s.includes('.')) {
      // '.'-separated base digits: '11.A.3' is the three-digit numeral [11, A, 3]
      for (const f of s.split('.')) {
        if (/^[0-9]+$/.test(f)) chars.push({ d: parseInt(f, 10) });
        else if (addChar(f) === 'any') return { type: 'set', set: null, max: maxSum, min: 1 };
      }
    } else {
      for (const ch of s) if (addChar(ch) === 'any') return { type: 'set', set: null, max: maxSum, min: 1 };
    }
    if (!chars.length) return { type: 'set', set: null, max: maxSum, min: 1 };
    if (!hasLetter) {
      // fixed set of matching values (numerals read in the given base)
      const set = new Set();
      const lo = chars.length === 1 ? 0 : Math.pow(base, chars.length - 1);
      const hi = Math.pow(base, chars.length) - 1;
      // displayed values run one past maxSum under KD (displayed = true + 1)
      const vlo = Math.max((kd || (zeroOk && !neg)) ? 0 : 1, lo);
      for (let v = vlo; v <= Math.min(hi, Math.abs(neg ? -1e9 : maxSum) + (kd ? 1 : 0)); v++) {
        if (neg && v === 0) continue;   // '-?' and kin are strictly negative
        const ds = digitsInBase(v, base, chars.length);
        if (!ds) continue;
        let ok = true;
        for (let p = 0; p < chars.length; p++) if (chars[p].d !== undefined && chars[p].d !== ds[p]) ok = false;
        if (ok) set.add(neg ? -v : v);
      }
      const set2 = kdSet(set);
      let mn = Infinity, mx = 0;
      for (const v of set2) { if (v < mn) mn = v; if (v > mx) mx = v; }
      return { type: 'set', set: set2, max: mx, min: mn === Infinity ? 1 : mn };
    }
    const rawMax = Math.min(maxSum, Math.pow(base, chars.length) - 1 + (kd ? 1 : 0));
    const rawMin = Math.max(1, (chars.length === 1 ? 1 : Math.pow(base, chars.length - 1)) - (kd ? 1 : 0));
    return { type: 'letters', chars, len: chars.length, kd: !!kd, base, max: rawMax, min: rawMin };
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
  const BASE = cfg.base || 10;
  const rowClues = (cfg.rowClues || []).map(cl => compileClue(cl, maxSum, letterIds, cfg.kd, minSum, minSum < 0 || pal.includes(0), BASE));
  const colClues = (cfg.colClues || []).map(cl => compileClue(cl, maxSum, letterIds, cfg.kd, minSum, minSum < 0 || pal.includes(0), BASE));
  const V = Object.assign({ numConn: false, blankConn: false, no22num: false, no22blank: false, asc: false, reach: false, blankReach: false },
    null,
    cfg.variants || null);
  const asc = V.asc;   // unordered ascending clues
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
  const digitUsed = new Uint8Array(64);   // letter digits can exceed 31 under large alien bases

  function popcnt(m) { let c = 0; while (m) { c += m & 1; m >>>= 1; } return c; }
  function usedOf(pack, k) { return (pack >> (2 * k)) & 3; }
  function bumpPack(pack, k) { return pack + (1 << (2 * k)); }
  function dropPack(pack, k) { return pack - (1 << (2 * k)); }
  // remaining positive / negative capacity of a line (for two-sided pruning)
  function posLeft(pack) { let s = 0; for (let k = 0; k < M; k++) if (pal[k] > 0) s += pal[k] * (cnt[k] - usedOf(pack, k)); return s; }
  function negLeft(pack) { let s = 0; for (let k = 0; k < M; k++) if (pal[k] < 0) s += pal[k] * (cnt[k] - usedOf(pack, k)); return s; }
  function anyLeft(pack) { for (let k = 0; k < M; k++) if (usedOf(pack, k) < cnt[k]) return true; return false; }

  const LMASK = cfg.letterMask || null;   // per-letter allowed digit bits (digits <= 30)
  function bindDisplayed(g, dv) {
    if (dv < 0) return null;
    // numerals may not carry leading zeros (single-char displays may be 0)
    if (g.len > 1 && dv < Math.pow(BASE, g.len - 1)) return null;
    const ds = digitsInBase(dv, BASE, g.len);
    if (!ds) return null;
    const bound = [];
    for (let p = 0; p < g.len; p++) {
      const ch = g.chars[p], d = ds[p];
      if (ch.d !== undefined) { if (ch.d !== d) { undoLetters(bound); return null; } }
      else if (ch.L !== undefined) {
        if (LMASK && d <= 30 && !((LMASK[ch.L] >>> d) & 1)) { undoLetters(bound); return null; }
        const cur = letterVal[ch.L];
        if (cur >= 0) { if (cur !== d) { undoLetters(bound); return null; } }
        else {
          if (digitUsed[d]) { undoLetters(bound); return null; }
          letterVal[ch.L] = d; digitUsed[d] = 1; bound.push(ch.L);
        }
      }
    }
    return bound;
  }
  function undoLetters(bound) {
    for (const L of bound) { digitUsed[letterVal[L]] = 0; letterVal[L] = -1; }
  }
  function groupMatchOptions(g, s) {
    // ways one clue group can absorb TRUE sum s: list of displayed values
    if (g.type === 'exact') return g.v === s ? [g.v] : [];
    if (g.type === 'set') return (g.set === null || g.set.has(s)) ? [s] : [];
    const cands = g.kd ? [s - 1, s + 1].filter(v => v >= 0) : [s];
    return cands;   // viability of letter binding checked at bind time
  }

  // every viable close of TRUE sum s in this line: pick an unused clue index
  // (any index under ascending clues, the next-in-order index otherwise), a displayed
  // value its token matches, and (ascending) keep the values ascending by index
  function closeList(clue, used, vals, s) {
    if (!clue) return [{ k: -1, dv: 0 }];
    const out = [];
    const idxs = [];
    if (asc) { for (let k = 0; k < clue.length; k++) if (!(used & (1 << k))) idxs.push(k); }
    else { const k = popcnt(used); if (k < clue.length) idxs.push(k); }
    for (const k of idxs) {
      const g = clue[k];
      for (const dv of groupMatchOptions(g, s)) {
        if (asc) {
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
    if (asc) { for (let k = 0; k < clue.length; k++) if (!(used & (1 << k))) mx = Math.max(mx, groupMaxOf(clue[k])); }
    else { const k = popcnt(used); if (k < clue.length) mx = groupMaxOf(clue[k]); }
    return mx;
  }
  function groupMaxOf(g) {
    if (g.type !== 'letters') return g.max;
    let mx = 0;
    for (let p = 0; p < g.len; p++) {
      const ch = g.chars[p];
      let d = BASE - 1;
      if (ch.d !== undefined) d = ch.d;
      else if (ch.L !== undefined && letterVal[ch.L] >= 0) d = letterVal[ch.L];
      mx = mx * BASE + d;
    }
    if (g.kd) mx += 1;
    return Math.min(mx, g.max);
  }
  function groupMinNext(clue, used) {
    if (!clue) return 1;
    if (asc) { let mn = Infinity; for (let k = 0; k < clue.length; k++) if (!(used & (1 << k))) mn = Math.min(mn, clue[k].min); return mn === Infinity ? 1 : mn; }
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
    groupMaxUnused, undoLetters, FULL, letterVal, letterIds, maxSum, minSum, asc, V, popcnt,
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
  const cand = opts.collect ? (opts.candInto || new Int32Array(N)) : null;
  const letterCand = opts.collect ? (opts.letterInto || new Int32Array(26)) : null;
  const post = opts.onSolution || null;
  // saturation: once the harvested unions equal the seed masks, nothing more
  // can be learned from further solutions of this space
  const sat = opts.saturate || null;
  let satStop = false;
  function satCheck() {
    if (!sat) return false;
    for (let j = 0; j < N; j++) if (cand[j] !== sat.candMask[j]) return false;
    for (const L of sat.letters) if (letterCand[L] !== sat.letterMask[L]) return false;
    return true;
  }
  const V = S.V;
  // under ascending (unordered) clues, equal group sums can close into
  // different clue indices and reach the same solution twice - dedupe
  const seenSol = V.asc ? new Set() : null;
  const rowUsedRef = Array.from({ length: R }, (_, r) => ({ get m() { return S.rowUsed[r]; }, set m(v) { S.rowUsed[r] = v; } }));
  const colUsedRef = Array.from({ length: C }, (_, c) => ({ get m() { return S.colUsed[c]; }, set m(v) { S.colUsed[c] = v; } }));

  // shape: no shaded 2x2 (checked incrementally), shaded cells connected, and
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
  function edgeReachOk(isMember) {
    const seen = new Uint8Array(N);
    const stack = [];
    for (let i = 0; i < N; i++) {
      const r = (i / C) | 0, c = i % C;
      if (isMember(i) && (r === 0 || c === 0 || r === R - 1 || c === C - 1)) { seen[i] = 1; stack.push(i); }
    }
    while (stack.length) {
      const i = stack.pop();
      const r = (i / C) | 0, c = i % C;
      for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const r2 = r + dr, c2 = c + dc;
        if (r2 < 0 || r2 >= R || c2 < 0 || c2 >= C) continue;
        const j = r2 * C + c2;
        if (!seen[j] && isMember(j)) { seen[j] = 1; stack.push(j); }
      }
    }
    for (let i = 0; i < N; i++) if (isMember(i) && !seen[i]) return false;
    return true;
  }
  function shapeOk() {
    if (V.blankConn && !connectedOk(i => S.grid[i] === 0)) return false;
    if (V.numConn && !connectedOk(i => S.grid[i] > 0)) return false;
    if (V.blankReach && !edgeReachOk(i => S.grid[i] === 0)) return false;
    if (!V.reach) return true;
    return reachOk();
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
      if (timedOut || satStop || solCount >= maxSol) return;
    }
  }

  function rec(i) {
    if (timedOut || satStop || solCount >= maxSol) return;
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
        if (letterCand) for (const L of S.letterIds) if (S.letterVal[L] >= 0 && S.letterVal[L] <= 30) letterCand[L] |= 1 << S.letterVal[L];
        if (sat && !satStop && satCheck()) satStop = true;
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
      if (timedOut || satStop || solCount >= maxSol) return;
    }
  }
  rec(0);
  return { solCount, nodes, timedOut, saturated: satStop, complete: !timedOut && !satStop, firstSol, firstLetters, cand, letterCand,
    letterIds: S.letterIds };
}

// candidate bases for an alien puzzle: every written digit below the base,
// distinct letters need distinct digits, and any k-digit numeral is worth at
// least base^(k-1) which must stay within the palette's largest sum
function alienBases(cfg) {
  let maxSum;
  if (cfg.values && cfg.values.length) {
    const byVal = new Map();
    for (const v of cfg.values) byVal.set(v, (byVal.get(v) || 0) + 1);
    maxSum = [...byVal].reduce((a, [v, c]) => a + (v > 0 ? v * Math.min(3, c) : 0), 0);
  } else {
    maxSum = 0;
    for (let d = 1; d <= cfg.D; d++) maxSum += d;
  }
  let minB = 2, maxLen = 1;
  const letters = new Set();
  for (const list of (cfg.rowClues || []).concat(cfg.colClues || [])) {
    if (!list) continue;
    for (const tok of list) {
      const str = String(tok).toUpperCase().trim().replace(/^-/, '');
      const fields = str.includes('.') ? str.split('.') : str.split('');
      let len = 0;
      for (const f of fields) {
        if (f === '#') { len = 0; break; }
        len++;
        if (/^[0-9]+$/.test(f)) minB = Math.max(minB, parseInt(f, 10) + 1);
        else if (/^[A-Z]$/.test(f)) letters.add(f);
      }
      if (len) maxLen = Math.max(maxLen, len);
    }
  }
  minB = Math.max(minB, letters.size);
  const cap = maxSum + (cfg.kd ? 1 : 0);
  let maxB = Math.min(31, cap + 1);   // aligned with the stepper's 32-bit letter masks (cfg.bases overrides)
  if (maxLen >= 2) { while (maxB > minB && Math.pow(maxB, maxLen - 1) > cap) maxB--; }
  const out = [];
  for (let b = minB; b <= Math.max(minB, maxB); b++) out.push(b);
  return out;
}

// true candidates, U-Bahn style: enumerate while cheap (stopping the moment
// the harvest saturates the seed marks), then prove each leftover candidate
// individually with a bounded satisfiability probe; unresolved candidates are
// kept (a safe over-approximation) and reported
function popcnt32(m) { let c = 0; while (m) { m &= m - 1; c++; } return c; }
function candidatesPhased(cfg) {
  const N = cfg.R * cfg.C;
  const deadline = Date.now() + (cfg.timeLimit || 10000);
  const bases = cfg.alien ? (cfg.bases || alienBases(cfg)) : [cfg.base || 10];
  const sub = b => Object.assign({}, cfg, { alien: false, bases: undefined, base: b });
  // seed masks: the space we enumerate within (defaults to everything)
  let M = 0;
  { const seen = new Set(); for (const v of (cfg.values && cfg.values.length ? cfg.values : Array.from({ length: cfg.D }, (_, d) => d + 1))) seen.add(v); M = seen.size; }
  const fullMask = ((1 << (M + 1)) - 1);
  const seedCand = cfg.candMask ? Int32Array.from(cfg.candMask) : new Int32Array(N).fill(fullMask);
  const letterIds = [];
  for (const list of (cfg.rowClues || []).concat(cfg.colClues || [])) if (list) for (const tok of list) for (const ch of String(tok).toUpperCase()) if (ch >= 'A' && ch <= 'Z' && !letterIds.includes(ch.charCodeAt(0) - 65)) letterIds.push(ch.charCodeAt(0) - 65);
  const maxDigitBits = (() => { const mb = Math.max(...bases); return mb >= 31 ? 0x7FFFFFFF : (1 << mb) - 1; })();
  const seedLetter = new Int32Array(26);
  for (const L of letterIds) seedLetter[L] = cfg.letterMask ? cfg.letterMask[L] : (cfg.alien ? maxDigitBits : 1023);
  const cand = new Int32Array(N), letterCand = new Int32Array(26);
  let solCount = 0, nodes = 0, timedOut = false, saturated = false;
  let allComplete = true;
  const baseState = new Map();   // base -> 'sat' | 'unsat' | 'open'
  const probeCfg = Object.assign({}, cfg, { letterMask: Array.from(seedLetter) });

  // ---- phase 1: enumeration per base, stopping on saturation ----
  for (const b of bases) {
    if (Date.now() >= deadline) { allComplete = false; baseState.set(b, 'open'); continue; }
    const r = search(Object.assign(sub(b), { letterMask: probeCfg.letterMask }), {
      timeLimit: Math.max(1, deadline - Date.now()), collect: true,
      maxSolutions: saturated ? 1 : (cfg.maxSolutions || 100000),
      candInto: cand, letterInto: letterCand,
      saturate: { candMask: seedCand, letterMask: seedLetter, letters: letterIds },
    });
    nodes += r.nodes; timedOut = timedOut || r.timedOut;
    solCount += r.solCount;
    if (r.saturated) saturated = true;
    baseState.set(b, r.solCount > 0 ? 'sat' : (r.complete ? 'unsat' : 'open'));
    if (!r.complete && !r.saturated) allComplete = false;
    if (r.saturated) allComplete = false;   // the count is a floor once we stop early
  }

  // ---- phase 2: per-candidate probes for everything not yet witnessed ----
  // pointless without a single witnessed solution: if the whole enumeration
  // could not find one, individual restrictions will not find one faster -
  // everything unwitnessed is simply reported unresolved
  let unresolved = 0;
  if (!allComplete && !saturated && solCount === 0) {
    for (let i = 0; i < N; i++) { unresolved += popcnt32(seedCand[i] & ~cand[i]); cand[i] |= seedCand[i]; }
    for (const L of letterIds) { unresolved += popcnt32(seedLetter[L] & ~letterCand[L]); letterCand[L] |= seedLetter[L]; }
  } else if (!allComplete && !saturated) {
    const probes = [];
    // most-constrained first: witnesses arrive sooner and each harvest of a
    // full solution proves many other candidates for free
    for (let i = 0; i < N; i++) for (let v = 0; v <= M; v++) if (((seedCand[i] >>> v) & 1) && !((cand[i] >>> v) & 1)) probes.push({ kind: 'cell', i, v, w: popcnt32(seedCand[i]) });
    for (const L of letterIds) for (let d = 0; d <= 30; d++) if (((seedLetter[L] >>> d) & 1) && !((letterCand[L] >>> d) & 1)) probes.push({ kind: 'letter', L, d, w: popcnt32(seedLetter[L]) });
    probes.sort((a, b) => a.w - b.w);
    const openBases = bases.filter(b => baseState.get(b) !== 'unsat');
    for (let q = 0; q < probes.length; q++) {
      const left = deadline - Date.now();
      if (left <= 0) { unresolved += probes.length - q; for (let q2 = q; q2 < probes.length; q2++) keep(probes[q2]); break; }
      const p = probes[q];
      // already witnessed by a probe harvest in the meantime?
      if (p.kind === 'cell' ? ((cand[p.i] >>> p.v) & 1) : ((letterCand[p.L] >>> p.d) & 1)) continue;
      const slice = Math.max(50, Math.min(2000, left / (probes.length - q + 1) * 2));
      let witnessed = false, provenOut = true;
      for (const b of openBases) {
        if (p.kind === 'cell' ? ((cand[p.i] >>> p.v) & 1) : ((letterCand[p.L] >>> p.d) & 1)) { witnessed = true; break; }
        const cm = Array.from(seedCand);
        const lm = Array.from(probeCfg.letterMask);
        if (p.kind === 'cell') cm[p.i] = 1 << p.v; else lm[p.L] = 1 << p.d;
        const r = search(Object.assign(sub(b), { candMask: cm, letterMask: lm }), {
          timeLimit: Math.max(1, Math.min(slice, deadline - Date.now())), collect: true, maxSolutions: 1,
          candInto: cand, letterInto: letterCand,   // a witness proves many candidates at once
        });
        nodes += r.nodes;
        if (r.solCount > 0) { witnessed = true; solCount += r.solCount; if (baseState.get(b) !== 'sat') baseState.set(b, 'sat'); break; }
        if (!r.complete) provenOut = false;
      }
      if (!witnessed && !provenOut) { unresolved++; keep(p); }
      // !witnessed && provenOut: truly impossible - the bit stays off
    }
    function keep(p) { if (p.kind === 'cell') cand[p.i] |= 1 << p.v; else letterCand[p.L] |= 1 << p.d; }
  }
  const okBases = bases.filter(b => baseState.get(b) === 'sat');
  const openBaseList = bases.filter(b => baseState.get(b) === 'open');
  return { solCount, bases: okBases.concat(openBaseList), nodes,
    complete: allComplete, saturated, unresolved, timedOut,
    cand: Array.from(cand), letterCand: Array.from(letterCand), letterIds };
}

function runAny(cfg) {
  if (cfg.alien) {
    const bases = cfg.bases || alienBases(cfg);
    const deadline = Date.now() + (cfg.timeLimit || 10000);
    let nodes = 0, timedOut = false;
    const sub = b => Object.assign({}, cfg, { alien: false, bases: undefined, base: b, timeLimit: Math.max(1, deadline - Date.now()) });
    if (cfg.mode === 'solve') {
      let allComplete = true;
      for (const b of bases) {
        const r = search(sub(b), { timeLimit: Math.max(1, deadline - Date.now()), maxSolutions: 1 });
        nodes += r.nodes; timedOut = timedOut || r.timedOut;
        if (!r.complete) allComplete = false;
        if (r.firstSol) return { firstSol: Array.from(r.firstSol), firstLetters: Array.from(r.firstLetters), letterIds: r.letterIds, base: b, nodes, timedOut, complete: true };
      }
      return { firstSol: null, firstLetters: null, letterIds: [], nodes, timedOut, complete: allComplete };
    }
    if (cfg.mode === 'count') {
      let solCount = 0; const perBase = {};
      let complete = true;
      for (const b of bases) {
        const r = search(sub(b), { timeLimit: Math.max(1, deadline - Date.now()), maxSolutions: cfg.maxSolutions || 10000 });
        nodes += r.nodes; timedOut = timedOut || r.timedOut; complete = complete && r.complete;
        solCount += r.solCount;
        if (r.solCount) perBase[b] = r.solCount;
      }
      return { solCount, perBase, bases: Object.keys(perBase).map(Number), nodes, complete, timedOut };
    }
    if (cfg.mode === 'candidates') return candidatesPhased(cfg);
    return { error: 'unknown mode' };
  }
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
  if (cfg.mode === 'candidates') return candidatesPhased(cfg);
  return { error: 'unknown mode' };
}

if (typeof self !== 'undefined' && typeof postMessage === 'function') {
  self.onmessage = function (e) { postMessage(runAny(e.data)); };
}
if (typeof module !== 'undefined' && module.exports !== undefined) {
  module.exports = { runAny, search, makeSolver, compileClue, alienBases };
}
}
if (typeof module !== 'undefined') {
  const shim = { exports: {} };
  new Function('module', '(' + sumsWorkerMain.toString() + ')()')(shim);
  module.exports = shim.exports;
}
