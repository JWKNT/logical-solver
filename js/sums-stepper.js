// Japanese Sums human-rule stepper: named deduction rules, simplest first,
// each returning a prose explanation. Mirrors the U-Bahn stepper design.
//
// State: cand[i] bitmask — bit 0 = the cell is blank, bits 1..D = digits.
function sumsStepperMain(global) {
'use strict';

function makeSumsState(R, C, D, values) {
  // value palette: distinct values + per-line multiplicities (default 1..D once)
  let pal, cnt;
  if (values && values.length) {
    const byVal = new Map();
    for (const v of values) byVal.set(v, (byVal.get(v) || 0) + 1);
    pal = [...byVal.keys()].sort((a, b) => a - b);
    cnt = pal.map(v => Math.min(3, byVal.get(v)));
  } else {
    pal = []; cnt = [];
    for (let d = 1; d <= D; d++) { pal.push(d); cnt.push(1); }
  }
  const M = pal.length;
  const full = ((1 << (M + 1)) - 2) | 1;
  return { R, C, D: M, pal, cnt,
    maxTotal: pal.reduce((a, v, k) => a + (v > 0 ? v * cnt[k] : 0), 0),
    minTotal: pal.reduce((a, v, k) => a + (v < 0 ? v * cnt[k] : 0), 0),
    cand: new Int32Array(R * C).fill(full),
    letterCand: new Int32Array(26).fill(1023),   // digits 0-9 per crypto letter (0..base-1 under alien)
    kd: false,   // Knapp daneben: every clue is one off its true value
    alien: false, baseCand: null,   // alien: the clues' number base is unknown (a set of candidate bases 2..31)
    variants: { numConn: false, blankConn: false, no22num: false, no22blank: false, asc: false, reach: false, blankReach: false },
    // Human shape implications discovered by the ladder.  Each entry means
    // "if cell a has shape av, cell b has shape bv", where 0 = shaded and
    // 1 = a number.  They let a genuinely useful pencil-mark relation (rather
    // than only a fixed cell) feed later row/column bounds.
    shapeRelations: [],
    lineShapeDomains: {},
    fastLadder: false, noTrial: false };
}
function cloneSumsState(st) {
  return { R: st.R, C: st.C, D: st.D, pal: st.pal, cnt: st.cnt, maxTotal: st.maxTotal, minTotal: st.minTotal,
    cand: Int32Array.from(st.cand),
    letterCand: Int32Array.from(st.letterCand), kd: st.kd, variants: Object.assign({}, st.variants),
    alien: st.alien, baseCand: st.baseCand ? new Set(st.baseCand) : null,
    shapeRelations: (st.shapeRelations || []).map(x => Object.assign({}, x)),
    lineShapeDomains: Object.fromEntries(Object.entries(st.lineShapeDomains || {}).map(([k, v]) => [k, v.slice()])),
    fastLadder: st.fastLadder, noTrial: st.noTrial, __lineCache: st.__lineCache };
}
// candidate bases the clues could be written in (alien); [10] otherwise.
// st.__forceBase pins a single base inside per-base enumerations.
function baseList(st) {
  if (!st.alien) return [10];
  if (st.__forceBase) return [st.__forceBase];
  return st.baseCand ? [...st.baseCand].sort((a, b) => a - b) : [10];
}
function filterBase(st, keepSet) {
  const next = new Set([...st.baseCand].filter(b => keepSet.has(b)));
  if (!next.size) { const e = new Error('no possible number base remains'); throw e; }
  st.baseCand = next;
}
// initial base range from the clues' syntax: every digit written must be
// below the base, and any k-digit numeral is worth at least base^(k-1),
// which must stay within the largest achievable sum (bases capped at 31 so
// letter digits keep fitting the 32-bit candidate masks)
function ensureBaseCand(st, clues) {
  if (!st.alien || st.baseCand) return;
  let minB = 2, maxLen = 1;
  const letterSet = new Set();
  for (const list of (clues.rows || []).concat(clues.cols || [])) {
    if (!list) continue;
    for (const tok of list) {
      if (typeof tok === 'number') { for (const ch of String(Math.abs(tok))) minB = Math.max(minB, (+ch) + 1); maxLen = Math.max(maxLen, String(Math.abs(tok)).length); continue; }
      const p = tokenParse(tok, st);
      if (!p.chars) continue;
      maxLen = Math.max(maxLen, p.chars.length);
      for (const ch of p.chars) {
        if (ch.d !== undefined) minB = Math.max(minB, ch.d + 1);
        if (ch.L !== undefined) letterSet.add(ch.L);
      }
    }
  }
  minB = Math.max(minB, letterSet.size);   // distinct letters are distinct digits 0..base-1
  const cap = st.maxTotal + (st.kd ? 1 : 0);
  let maxB = 31;
  if (maxLen >= 2) { while (maxB > minB && Math.pow(maxB, maxLen - 1) > cap) maxB--; }
  const set = new Set();
  for (let b = minB; b <= Math.min(31, maxB); b++) set.add(b);
  if (!set.size) set.add(minB);   // leave the contradiction to the rules
  st.baseCand = set;
  // letters stand for digits 0..base-1: widen pristine masks to the alien
  // range (letters already narrowed by the caller keep their filter)
  const mask = maxB >= 31 ? 0x7FFFFFFF : (1 << maxB) - 1;
  for (const list of (clues.rows || []).concat(clues.cols || [])) if (list) for (const tok of list) for (const L of tokenLetters(tok)) {
    if (st.letterCand[L] === 1023) st.letterCand[L] = mask;
    else st.letterCand[L] &= mask;
  }
}
function filterLetter(st, L, keepMask) {
  const nm = st.letterCand[L] & keepMask;
  if (nm === 0) { const e = new Error('no digit left for letter ' + String.fromCharCode(65 + L)); throw e; }
  st.letterCand[L] = nm;
}
// token -> the set of sums it can currently take (an OVERAPPROXIMATION for
// letter tokens: per-character candidate masks, intra-token repeats honoured)
function tokenParse(tok, st) {
  const alien = !!(st && st.alien);
  if (typeof tok === 'number') {
    if (!alien || (tok > -10 && tok < 10)) return { exact: tok };
    tok = String(tok);   // a multi-digit numeral's value depends on the base
  }
  let s = String(tok).toUpperCase().trim();
  let neg = false;
  if (s[0] === '-') { neg = true; s = s.slice(1); }
  if (!alien && /^[0-9]+$/.test(s)) return { exact: (neg ? -1 : 1) * parseInt(s, 10) };
  const chars = [];
  if (alien && s.includes('.')) {
    // '.'-separated base digits: '11.A.3' is the three-digit numeral [11, A, 3]
    for (const f of s.split('.')) {
      if (/^[0-9]+$/.test(f)) chars.push({ d: parseInt(f, 10) });
      else if (f === '#') return { any: true };
      else if (f === '?') chars.push({ q: true });
      else if (/^[A-Z]$/.test(f)) chars.push({ L: f.charCodeAt(0) - 65 });
    }
  } else {
    for (const ch of s) {
      if (ch >= '0' && ch <= '9') chars.push({ d: ch.charCodeAt(0) - 48 });
      else if (ch === '#') return { any: true };
      else if (ch === '?') chars.push({ q: true });
      else if (ch >= 'A' && ch <= 'Z') chars.push({ L: ch.charCodeAt(0) - 65 });
    }
  }
  if (!chars.length) return { any: true };
  if (alien && /^[0-9]+$/.test(s.replace(/\./g, '')) && chars.length === 1) return { exact: (neg ? -1 : 1) * chars[0].d };
  return { chars, neg };
}
// the value of a token whose base digits are all fixed, read in base b (else null)
function tokenFixedValue(p, b) {
  if (p.exact !== undefined) return p.exact;
  if (!p.chars) return null;
  let v = 0;
  for (const ch of p.chars) { if (ch.d === undefined || ch.d >= b) return null; v = v * b + ch.d; }
  return p.neg ? -v : v;
}
function tokenLetters(tok) {
  const p = tokenParse(tok);   // letter extraction is base-independent
  if (!p.chars) return [];
  const out = [];
  for (const ch of p.chars) if (ch.L !== undefined && !out.includes(ch.L)) out.push(ch.L);
  return out;
}
// does displayed value v match the parsed token against current letter cands?
// (under alien, the numeral is read in each candidate base; a match in any is enough)
function matchInBase(st, p, v, b) {
  const n = p.chars.length;
  const lo = n === 1 ? 0 : Math.pow(b, n - 1);   // a 1-char clue may display 0 (KD)
  if (v < lo || v > Math.pow(b, n) - 1) return false;
  const ds = digitsOfValueB(v, b);
  if (ds.length !== n) return false;
  const seen = {};
  for (let q = 0; q < n; q++) {
    const ch = p.chars[q], d = ds[q];
    if (ch.d !== undefined) { if (ch.d !== d) return false; }
    else if (ch.L !== undefined) {
      if (!(st.letterCand[ch.L] & (1 << d))) return false;
      if (seen[ch.L] !== undefined && seen[ch.L] !== d) return false;
      seen[ch.L] = d;
    }
  }
  return true;
}
function displayedMatch(st, p, v) {
  if (p.exact !== undefined) return v === p.exact;
  if (p.any) return true;
  if (p.neg) { if (v >= 0) return false; v = -v; }   // '-?' and kin are strictly negative
  else if (v < 0) return false;
  for (const b of baseList(st)) if (matchInBase(st, p, v, b)) return true;
  return false;
}
// displayed values a TRUE sum s can show: s itself normally; s-1 and s+1 in KD
function displayedOptions(st, s) {
  if (!st.kd) return [s];
  // the displayed-value floor is 0 for positive palettes (a shown 0 means true
  // sum 1); with negatives in play, negative displayed values are legitimate
  return st.minTotal < 0 ? [s - 1, s + 1] : [s - 1, s + 1].filter(v => v >= 0);
}
function dvSignOk(p, dv) { return p.neg ? dv < 0 : dv >= 0; }
const DS_CACHE = new Map();
function digitsOfValueB(v, b) {
  const key = v * 64 + b;
  let a = DS_CACHE.get(key);
  if (!a) {
    let x = Math.abs(v);
    if (x === 0) a = [0];
    else { a = []; while (x > 0) { a.unshift(x % b); x = (x / b) | 0; } }
    if (DS_CACHE.size < 40000) DS_CACHE.set(key, a);
  }
  return a;
}
function digitsOfValue(v) { return digitsOfValueB(v, 10); }
// render a value as a base-b numeral: digits joined, '.'-separated when any digit needs two decimal characters
function numeralOf(v, b) {
  const ds = digitsOfValueB(v, b);
  return (v < 0 ? '-' : '') + (ds.some(d => d > 9) ? ds.join('.') : ds.join(''));
}

function allowedSums(st, tok, maxSum) {
  const p = tokenParse(tok, st);
  const out = new Set();
  const lo2 = Math.min(1, st.minTotal);
  // sum 0 needs a zero-capable palette (cancellation or 0-valued cells); all
  // sums flow through the same displayed-value machinery (KD shifts included)
  const zeroOk = st.minTotal < 0 || st.pal.includes(0);
  for (let s = lo2; s <= maxSum; s++) {
    if (s === 0 && !zeroOk) continue;
    for (const v of displayedOptions(st, s)) if (displayedMatch(st, p, v)) { out.add(s); break; }
  }
  return out;
}
// can k pairwise-disjoint subsets of {1..D}, with the given sizes (or any
// sizes when sizes=null), each sum to v? And the minimal total cell count?
const djMemo = new Map();
function disjointFeasible(st, v, k, sizes) {
  const key = v + '|' + k + '|' + (sizes ? sizes.join(',') : '*') + '|' + st.pal.join(',') + '|' + st.cnt.join(',');
  if (djMemo.has(key)) return djMemo.get(key);
  const subs = [];
  (function gen(d, pack, sum, cntN) {
    if (d > st.pal.length) return;
    if (st.pal[0] > 0 && sum >= v) return;
    gen(d + 1, pack, sum, cntN);
    const left = st.cnt[d - 1] - ((pack >> (2 * (d - 1))) & 3);
    if (left > 0) {
      const s2 = sum + st.pal[d - 1], p2 = pack + (1 << (2 * (d - 1)));
      if (s2 === v) subs.push({ pack: p2, cnt: cntN + 1 });
      gen(d, p2, s2, cntN + 1);
    }
  })(1, 0, 0, 0);
  let best = null;
  (function packRec(idx, used, leftG, total) {
    if (best !== null && total >= best && sizes === null) return;
    if (leftG === 0) { if (best === null || total < best) best = total; return; }
    for (let s2 = idx; s2 < subs.length; s2++) {
      const sub = subs[s2];
      if (st.__uni === true) { if (sub.pack & used) continue; }
      else {
        let clash = false;
        for (let k2 = 1; k2 <= st.pal.length; k2++) {
          const a2 = (sub.pack >> (2 * (k2 - 1))) & 3, b2 = (used >> (2 * (k2 - 1))) & 3;
          if (a2 + b2 > st.cnt[k2 - 1]) { clash = true; break; }
        }
        if (clash) continue;
      }
      if (sizes && sub.cnt !== sizes[sizes.length - leftG]) continue;
      packRec(s2, used + sub.pack, leftG - 1, total + sub.cnt);   // same subset may repeat under multiplicities
    }
  })(0, 0, k, 0);
  const res = best === null ? null : best;
  djMemo.set(key, res);
  return res;
}

// budget-refined per-group sum sets for one line: each group's allowed sums,
// further limited because all groups share the line's distinct digits
// (sum of all group sums <= 1+2+...+D), iterated to a fixpoint
function lineSumSets(st, line) {
  const maxTotal = 0 + st.maxTotal;
  const sets = line.clue.map(tok => allowedSums(st, tok, maxTotal));
  for (let round = 0; round < 3; round++) {
    let changed = false;
    const mins = sets.map(s2 => { let m = Infinity; for (const v of s2) if (v < m) m = v; return m; });
    for (let g = 0; g < sets.length; g++) {
      let others = 0;
      for (let h = 0; h < sets.length; h++) if (h !== g) others += (mins[h] === Infinity ? 0 : mins[h]);
      const cap = maxTotal - others;
      for (const v of [...sets[g]]) if (v > cap) { sets[g].delete(v); changed = true; }
    }
    if (!changed) break;
  }
  if (st.variants.asc) {
    // ascending clues: keep only values that fit an ascending tuple
    const K = sets.length;
    const lo = new Array(K), hi = new Array(K);
    let prev = 1;
    for (let k = 0; k < K; k++) { let m2 = Infinity; for (const v of sets[k]) if (v >= prev && v < m2) m2 = v; lo[k] = m2; prev = m2; }
    let next = Infinity;
    for (let k = K - 1; k >= 0; k--) { let m2 = -1; for (const v of sets[k]) if (v <= next && v > m2) m2 = v; hi[k] = m2; next = m2; }
    for (let k = 0; k < K; k++) {
      const gLo = k > 0 ? lo[k - 1] : 1, gHi = k + 1 < K ? hi[k + 1] : Infinity;
      for (const v of [...sets[k]]) if (v < gLo || v > gHi) sets[k].delete(v);
    }
  }
  return sets;
}

function accumulateSeen(st, p, s, seen) {
  for (const v of displayedOptions(st, s)) {
    for (const b of baseList(st)) {
      if (!matchInBase(st, p, Math.abs(v), b)) continue;
      if (p.neg ? v >= 0 : v < 0) continue;
      const ds = digitsOfValueB(Math.abs(v), b);
      if (ds.length !== seen.length) continue;
      for (let q = 0; q < ds.length; q++) seen[q] |= 1 << ds[q];
    }
  }
}

function tokenLabel(tok) { return typeof tok === 'number' ? (tok < 0 ? '?' : String(tok)) : String(tok).toUpperCase(); }
function popc(m) { let c = 0; while (m) { c += m & 1; m >>>= 1; } return c; }
function rc(st, i) { return 'r' + (((i / st.C) | 0) + 1) + 'c' + ((i % st.C) + 1); }
function digitsOf(mask) { const a = []; for (let d = 1; d < 31; d++) if (mask & (1 << d)) a.push(d); return a; }
function valOf(st, k) { return st.pal[k - 1]; }
function uniformPal(st) {
  if (st.__uni === undefined) st.__uni = st.cnt.every(c => c === 1);
  return st.__uni;   // all multiplicities 1: 2-bit pack fields are 0/1, & is exact
}
function valuesOf(st, mask) { return digitsOf(mask).map(k => st.pal[k - 1]); }
function committedDigit(st, i) { const m = st.cand[i]; return (m & 1) === 0 && popc(m) === 1 ? digitsOf(m)[0] : 0; }

function filterCand(st, i, keepMask) {
  const nm = st.cand[i] & keepMask;
  if (nm === 0) { const e = new Error('contradiction at ' + rc(st, i)); e.cellIdx = i; throw e; }
  st.cand[i] = nm;
}

function eachSumsLine(st, clues) {
  const lines = [];
  for (let r = 0; r < st.R; r++) {
    const cells = []; for (let c = 0; c < st.C; c++) cells.push(r * st.C + c);
    lines.push({ kind: 'row', idx: r, cells, clue: clues.rows[r], name: 'Row ' + (r + 1) });
  }
  for (let c = 0; c < st.C; c++) {
    const cells = []; for (let r = 0; r < st.R; r++) cells.push(r * st.C + c);
    lines.push({ kind: 'col', idx: c, cells, clue: clues.cols[c], name: 'Column ' + (c + 1) });
  }
  return lines;
}

// exact digit-combination feasibility: can `len` distinct digits from `avail`
// (a bitmask over 1..D) sum to `s`? Memoised.
// can `len` cells take values from the remaining palette (2-bit count pack,
// or a plain availability bitmask when st has all-1 counts) summing to s?
const PAL_MEMO = new WeakMap();   // per-palette memo, numeric keys
function comboFeasibleV(st, s, len, availPack, fromK) {
  if (len === 0) return s === 0;
  let slots = PAL_MEMO.get(st.pal);
  if (!slots) { slots = []; PAL_MEMO.set(st.pal, slots); }
  const slot = len * 32 + fromK;
  let memo = slots[slot];
  if (!memo) memo = slots[slot] = new Map();
  // pack bits below fromK can never be picked again - canonicalize them away
  const keyPack = fromK > 1 ? availPack & ~((1 << (2 * (fromK - 1))) - 1) : availPack;
  // (s offset) * 2^30 + pack stays well inside double precision
  const key = s >= -32000 && s <= 32000
    ? (s + 32768) * 1073741824 + keyPack
    : s + '|' + keyPack;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  let ok = false;
  for (let k = fromK; k <= st.pal.length && !ok; k++) {
    const left = st.cnt[k - 1] - ((availPack >> (2 * (k - 1))) & 3);
    if (left <= 0) continue;
    // same value may repeat up to its count, but combinations stay ascending
    if (comboFeasibleV(st, s - st.pal[k - 1], len - 1, availPack + (1 << (2 * (k - 1))), k)) ok = true;
  }
  memo.set(key, ok);
  return ok;
}
function maskToPack(st, availMask) {
  // availMask bit k set = value index k fully available; else exhausted
  let pack = 0;
  for (let k = 1; k <= st.pal.length; k++) if (!(availMask & (1 << k))) pack += st.cnt[k - 1] << (2 * (k - 1));
  return pack;
}
function comboFeasible(st, s, len, availMask) {
  return comboFeasibleV(st, s, len, maskToPack(st, availMask), 1);
}

// enumerate all assignments of one line consistent with the clue, the current
// candidate masks, and in-line distinctness; call onSolution(values[]) each time.
// Returns false on node-budget overflow.
function enumerateSumsLine(st, line, onSolution, nodeCap, shapeFilter) {
  const n = line.cells.length;
  const eb = baseList(st)[0];   // alien callers force a single base per pass
  const maxSum0 = 0 + st.maxTotal;
  const clue = line.clue ? line.clue.map(tok => allowedSums(st, tok, maxSum0)) : null;
  const clueMax = clue ? clue.map(set => { let m = 0; for (const v of set) if (v > m) m = v; return m; }) : null;
  const parsedToks = line.clue ? line.clue.map(t => tokenParse(t, st)) : null;
  const letterVal = new Int8Array(26).fill(-1);
  let digitTaken = 0;
  function nextIdx() { let k = 0; while (k < K && (usedIdx & (1 << k))) k++; return k; }
  function closeIdxOptions(run) {
    if (!clue) return [-1];
    const out = [];
    if (st.variants.asc) {
      for (let k = 0; k < K; k++) {
        if (usedIdx & (1 << k)) continue;
        if (!clue[k].has(run)) continue;
        let ok = true;
        for (let k2 = 0; k2 < K && ok; k2++) {
          if (!(usedIdx & (1 << k2)) || k2 === k) continue;
          if (k2 < k && chosen[k2] > run) ok = false;
          if (k2 > k && chosen[k2] < run) ok = false;
        }
        if (ok) out.push(k);
      }
    } else {
      const k = nextIdx();
      if (k < K && clue[k].has(run)) out.push(k);
    }
    return out;
  }
  function bindDisplayed(gi, v) {
    const p2 = parsedToks[gi];
    if (!p2 || !p2.chars) return [];
    if (!dvSignOk(p2, v)) return null;
    const ds = digitsOfValueB(Math.abs(v), eb);
    if (ds.length !== p2.chars.length) return null;
    const bound = [];
    const bail = () => { for (const L of bound) { digitTaken &= ~(1 << letterVal[L]); letterVal[L] = -1; } return null; };
    for (let q = 0; q < ds.length; q++) {
      const ch = p2.chars[q], d = ds[q];
      if (ch.d !== undefined) { if (ch.d !== d) return bail(); continue; }
      if (ch.L === undefined) continue;
      if (letterVal[ch.L] >= 0) { if (letterVal[ch.L] !== d) return bail(); }
      else {
        if ((digitTaken & (1 << d)) || !(st.letterCand[ch.L] & (1 << d))) return bail();
        letterVal[ch.L] = d; digitTaken |= 1 << d; bound.push(ch.L);
      }
    }
    return bound;
  }
  function unbindClose(bound) { for (const L of bound) { digitTaken &= ~(1 << letterVal[L]); letterVal[L] = -1; } }
  const vals = new Int8Array(n);
  const K = (line.clue || []).length;
  const sortedClue = clue ? clue.map(s2 => Int32Array.from([...s2].sort((a, b) => a - b))) : null;
  const groupSums = new Int32Array(K);
  const chosen = new Int32Array(K);
  let usedIdx = 0;
  let nodes = 0, overflow = false, stopped = false;
  const cap = nodeCap || 400000;
  function rec(p, gi, run, pack, rlen) {
    if (overflow || stopped) return;
    if (++nodes > cap) { overflow = true; return; }
    if (p === n) {
      if (shapeFilter && !shapeFilter(vals)) return;
      if (rlen > 0) {
        if (!clue) { if (onSolution(vals, groupSums) === true) stopped = true; return; }
        for (const k of closeIdxOptions(run)) {
          if ((usedIdx | (1 << k)) !== (1 << K) - 1) continue;
          for (const dv of displayedOptions(st, run)) {
            const bound = bindDisplayed(k, dv);
            if (bound === null) continue;
            usedIdx |= 1 << k; chosen[k] = run; groupSums[k] = run;
            if (onSolution(vals, groupSums) === true) stopped = true;
            usedIdx &= ~(1 << k); chosen[k] = 0;
            unbindClose(bound);
            if (stopped) return;
          }
        }
        return;
      }
      if (clue && usedIdx !== (1 << K) - 1) return;
      if (onSolution(vals, groupSums) === true) stopped = true;
      return;
    }
    const m = st.cand[line.cells[p]];
    // blank
    if (m & 1) {
      if (rlen > 0) {
        vals[p] = 0;
        if (clue) {
          for (const k of closeIdxOptions(run)) {
            for (const dv of displayedOptions(st, run)) {
              const bound = bindDisplayed(k, dv);
              if (bound === null) continue;
              usedIdx |= 1 << k; chosen[k] = run; groupSums[k] = run;
              rec(p + 1, gi + 1, 0, pack, 0);
              usedIdx &= ~(1 << k); chosen[k] = 0;
              unbindClose(bound);
              if (stopped || overflow) break;
            }
            if (stopped || overflow) break;
          }
        } else rec(p + 1, gi + 1, 0, pack, 0);
      } else { vals[p] = 0; rec(p + 1, gi, 0, pack, 0); }
    }
    // values
    let posW = 0, negW = 0, minPos = Infinity, nx = 0;
    if (clue) {
      for (let k2 = 1; k2 <= st.pal.length; k2++) {
        const left = st.cnt[k2 - 1] - ((pack >> (2 * (k2 - 1))) & 3);
        if (left <= 0) continue;
        const pv = st.pal[k2 - 1];
        if (pv > 0) { posW += pv * left; if (pv < minPos) minPos = pv; } else negW += pv * left;
      }
      nx = nextIdx();
    }
    const setReach = (k, target, lo2, hi2) => {
      if (clue[k].has(target)) return true;
      if (lo2 === hi2 && lo2 === target) return false;   // no capacity left
      const arr = sortedClue[k];
      let a = 0, b = arr.length;
      while (a < b) { const m2 = (a + b) >> 1; if (arr[m2] < lo2) a = m2 + 1; else b = m2; }
      return a < arr.length && arr[a] <= hi2;
    };
    for (let d = 1; d <= st.D; d++) {
      if (!(m & (1 << d))) continue;
      if (((pack >> (2 * (d - 1))) & 3) >= st.cnt[d - 1]) continue;   // multiplicity spent
      const dv = st.pal[d - 1];
      if (clue) {
        if (usedIdx === (1 << K) - 1 && rlen === 0) continue;
        const target = run + dv;
        const hi2 = target + posW - (dv > 0 ? dv : 0);
        // with no negatives left, any extension adds at least the smallest
        // remaining positive value (the old distinct-digit lower bound)
        let mp = minPos;
        if (minPos === dv && st.cnt[d - 1] - ((pack >> (2 * (d - 1))) & 3) <= 1) {
          mp = Infinity;   // consuming the last copy of the minimum: find the next
          for (let k2 = 1; k2 <= st.pal.length; k2++) {
            if (k2 === d) continue;
            const left2 = st.cnt[k2 - 1] - ((pack >> (2 * (k2 - 1))) & 3);
            if (left2 > 0 && st.pal[k2 - 1] > 0 && st.pal[k2 - 1] < mp) mp = st.pal[k2 - 1];
          }
        }
        const lo2 = negW < 0 ? target + negW - (dv < 0 ? dv : 0) : target + (mp === Infinity ? 1e9 : mp);
        let reach = false;
        if (st.variants.asc) {
          for (let k = 0; k < K && !reach; k++) {
            if (usedIdx & (1 << k)) continue;
            reach = setReach(k, target, lo2, hi2);
          }
        } else if (nx < K) reach = setReach(nx, target, lo2, hi2);
        if (!reach) continue;
      }
      vals[p] = d;
      rec(p + 1, gi, run + dv, pack + (1 << (2 * (d - 1))), rlen + 1);
    }
  }

  rec(0, 0, 0, 0, 0);
  return !overflow;
}

// reject line fillings whose maximal shaded stretch has no blank-capable
// neighbour outside the line: a sealed pocket cannot join the shaded group
function makeShadedStretchFilter(st, clues, line) {
  if (!shadedBeyondLine(st, clues, line)) return null;
  const lineSet = new Set(line.cells);
  const n = line.cells.length;
  const escAt = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    for (const j of orthNeighbors(st, line.cells[p])) {
      if (!lineSet.has(j) && (st.cand[j] & 1)) { escAt[p] = 1; break; }
    }
  }
  return { escAt, fn: vals => {
    let p = 0;
    while (p < n) {
      if (vals[p] !== 0) { p++; continue; }
      let q = p, esc = false;
      while (q < n && vals[q] === 0) { if (escAt[q]) esc = true; q++; }
      if (!esc) return false;
      p = q;
    }
    return true;
  } };
}

function numbersBeyondLine(st, clues, line) {
  if (!st.variants.numConn) return false;
  const inLine = new Set(line.cells);
  for (let i = 0; i < st.R * st.C; i++) if ((st.cand[i] & 1) === 0 && !inLine.has(i)) return true;
  for (const other of eachSumsLine(st, clues)) {
    if (other.name === line.name || !other.clue || !other.clue.length) continue;
    if (other.kind === line.kind) return true;
    if (other.clue.length >= 2) return true;   // at most one group could live solely at the crossing
  }
  return false;
}

// Symmetric to Shaded escape: when numbers exist beyond this line, every
// separate number run in a proposed filling needs a number-capable neighbour
// outside the line through which it can join the one connected number area.
function makeNumberStretchFilter(st, clues, line) {
  if (!numbersBeyondLine(st, clues, line)) return null;
  const lineSet = new Set(line.cells), n = line.cells.length;
  const escAt = new Uint8Array(n);
  for (let p = 0; p < n; p++) for (const j of orthNeighbors(st, line.cells[p])) {
    if (!lineSet.has(j) && (st.cand[j] & ~1)) { escAt[p] = 1; break; }
  }
  return { escAt, fn: vals => {
    let p = 0;
    while (p < n) {
      if (vals[p] === 0) { p++; continue; }
      let q = p, esc = false;
      while (q < n && vals[q] !== 0) { if (escAt[q]) esc = true; q++; }
      if (!esc) return false;
      p = q;
    }
    return true;
  } };
}

// fingerprint-cached per-line assignment unions
function cachedLineUnion(st, clues, line, peekOnly) {
  if (!st.__lineCache) st.__lineCache = new Map();
  const sf = makeShadedStretchFilter(st, clues, line);
  const nf = makeNumberStretchFilter(st, clues, line);
  const rels = lineRelationData(st, line);
  const savedShapes = savedLineShapes(st, line);
  const shapeFn = (sf || nf || rels.length || savedShapes) ? vals => {
    if (sf && !sf.fn(vals)) return false;
    if (nf && !nf.fn(vals)) return false;
    if (rels.length || savedShapes) {
      let mask = 0;
      for (let p = 0; p < vals.length; p++) if (vals[p] !== 0) mask |= 1 << p;
      if (!relationMaskOk(mask, rels)) return false;
      if (savedShapes && !savedShapes.has(mask)) return false;
    }
    return true;
  } : null;
  let h = 2166136261 >>> 0;
  for (const i of line.cells) { h ^= st.cand[i]; h = Math.imul(h, 16777619) >>> 0; }
  for (const tok of line.clue || []) {
    for (const ch of String(tok)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
    h = Math.imul(h ^ 47, 16777619) >>> 0;
    for (const L of tokenLetters(tok)) { h ^= st.letterCand[L]; h = Math.imul(h, 16777619) >>> 0; }
  }
  if (st.alien) for (const b of baseList(st)) { h ^= b * 131; h = Math.imul(h, 16777619) >>> 0; }
  if (sf) for (let p = 0; p < sf.escAt.length; p++) { h ^= sf.escAt[p] + 7; h = Math.imul(h, 16777619) >>> 0; }
  if (nf) for (let p = 0; p < nf.escAt.length; p++) { h ^= nf.escAt[p] + 17; h = Math.imul(h, 16777619) >>> 0; }
  if (savedShapes) for (const m of savedShapes) { h ^= m * 257 + 29; h = Math.imul(h, 16777619) >>> 0; }
  for (const q of rels) { h ^= (q.pa + 1) * 31 + (q.pb + 1) * 131 + q.x.av * 7 + q.x.bv * 13; h = Math.imul(h, 16777619) >>> 0; }
  const key = line.kind + ':' + line.idx + ':' + (sf ? 'S' : 'P') + (nf ? 'N' : '') + (rels.length ? 'R' : '') + (savedShapes ? 'D' : '') + h;
  if (st.__lineCache.has(key)) return st.__lineCache.get(key);
  if (peekOnly) return null;   // surface already-computed conclusions only
  let res = null;
  {
    const G = (line.clue || []).length;
    const n2 = line.cells.length;
    const union = new Int32Array(n2);
    const gSums = Array.from({ length: G }, () => new Set());
    const deadBases = [];
    // under alien the letters (and every numeral) must be read in ONE base:
    // enumerate once per candidate base; a clued line with no completion in
    // some base rules that base out entirely
    const passes = st.alien ? baseList(st) : [10];
    let ok = true;
    // early stopping truncates gSums, whose completeness letter deductions
    // rely on — only lines whose clues carry no cipher letters may stop early
    const lettered = (line.clue || []).some(t => tokenLetters(t).length);
    let saturated = false;
    const checkSat = () => {
      if (lettered) return false;
      for (let p = 0; p < n2; p++) if (union[p] !== st.cand[line.cells[p]]) return false;
      return true;
    };
    for (const b of passes) {
      if (st.alien) st.__forceBase = b;
      let sols = 0;
      const okB = enumerateSumsLine(st, line, (vals, gs) => {
        sols++;
        for (let p = 0; p < vals.length; p++) union[p] |= 1 << vals[p];
        for (let g = 0; g < G; g++) gSums[g].add(gs[g]);
        // once the union matches the current masks everywhere it cannot grow:
        // this pass and later ones only need one solution each (they still
        // confirm the base is alive)
        if (saturated) return true;
        if ((sols & 63) === 0 && checkSat()) { saturated = true; return true; }
        return false;
      }, 3000000, shapeFn);
      if (st.alien) st.__forceBase = undefined;
      if (!okB) { ok = false; break; }
      if (st.alien && line.clue && line.clue.length && sols === 0) deadBases.push(b);
    }
    if (ok) res = { union, gSums, deadBases };
  }
  if (st.__lineCache.size > 3000) st.__lineCache.clear();
  st.__lineCache.set(key, res);
  return res;
}

/* ---------------- rules ---------------- */

// rule: digit uniqueness — a placed digit cannot repeat in its row or column
function ruleUniqueness(st, clues) {
  // a value fully used up in a line (its multiplicity reached by committed
  // cells) leaves every other cell of that line
  for (const line of eachSumsLine(st, clues)) {
    for (let k = 1; k <= st.pal.length; k++) {
      let committed = 0;
      for (const i of line.cells) { const d = committedDigit(st, i); if (d === k) committed++; }
      if (committed > st.cnt[k - 1]) {
        const v = st.pal[k - 1];
        const bad = line.cells.filter(i => committedDigit(st, i) === k);
        return { rule: 'Digit uniqueness', contradiction: true, cells: bad,
          text: line.name + ' contains ' + committed + ' committed ' + v + 's, but the value ' + v + ' is available only ' + st.cnt[k - 1] + ' time' + (st.cnt[k - 1] === 1 ? '' : 's') + ' per row or column. The position is contradictory.' };
      }
      if (committed < st.cnt[k - 1]) continue;
      const hits = line.cells.filter(i => committedDigit(st, i) !== k && (st.cand[i] & (1 << k)));
      if (!hits.length) continue;
      const v = st.pal[k - 1];
      return { rule: 'Digit uniqueness', cells: hits,
        text: line.name + ' already holds ' + (st.cnt[k - 1] === 1 ? 'a ' + v : st.cnt[k - 1] + ' ' + v + 's') + ' \u2014 the value ' + v + ' appears at most ' + (st.cnt[k - 1] === 1 ? 'once' : st.cnt[k - 1] + ' times') + ' per line, so ' + hits.map(i => rc(st, i)).join(', ') + ' cannot hold it.',
        apply() { for (const i of hits) filterCand(st, i, ~(1 << k)); } };
    }
  }
  return null;
}


// rule: sum bounds — each group's possible sums, capped because all the
// groups in a line share its distinct digits (their sums total at most
// 1+2+...+D), pin the decimal digits of the group's crypto letters
function ruleSumBounds(st, clues) {
  const maxTotal = 0 + st.maxTotal;
  for (const line of eachSumsLine(st, clues)) {
    if (!line.clue) continue;
    let hasLetters = false;
    for (const tok of line.clue) if (tokenLetters(tok).length) hasLetters = true;
    if (!hasLetters) continue;
    const sets = lineSumSets(st, line);
    for (let g = 0; g < line.clue.length; g++) {
      const p2 = tokenParse(line.clue[g], st);
      if (!p2.chars || !p2.chars.some(ch => ch.L !== undefined)) continue;
      if (!sets[g].size) return { rule: 'Sum bounds', contradiction: true, cells: line.cells.slice(),
        text: line.name + '\u2019s groups cannot all fit within the digit budget 1+2+\u2026+' + st.D + ' = ' + maxTotal + ' \u2014 the position is contradictory.' };
      const seen = p2.chars.map(() => 0);
      for (const s of sets[g]) accumulateSeen(st, p2, s, seen);
      const hits = [];
      for (let q = 0; q < p2.chars.length; q++) {
        const ch = p2.chars[q];
        if (ch.L === undefined) continue;
        const nm = st.letterCand[ch.L] & seen[q];
        if (nm === 0) return { rule: 'Sum bounds', contradiction: true, cells: [],
          text: 'Letter ' + String.fromCharCode(65 + ch.L) + ' has no digit compatible with ' + line.name.toLowerCase() + '\u2019s group \u201c' + tokenLabel(line.clue[g]) + '\u201d \u2014 the position is contradictory.' };
        if (nm !== st.letterCand[ch.L]) hits.push({ L: ch.L, nm });
      }
      if (!hits.length) continue;
      // explain the binding budget when it actually bit
      let others = 0, otherParts = [];
      for (let h = 0; h < line.clue.length; h++) if (h !== g) {
        let mn = Infinity; for (const v of lineSumSets(st, line)[h]) if (v < mn) mn = v;
        if (mn !== Infinity && mn > 0) { others += mn; otherParts.push(tokenLabel(line.clue[h]) + ' \u2265 ' + mn); }
      }
      const capTxt = others > 0
        ? 'the line\u2019s digits sum to at most ' + maxTotal + ' and its other groups need at least ' + others + ' (' + otherParts.join(', ') + '), so \u201c' + tokenLabel(line.clue[g]) + '\u201d is at most ' + (maxTotal - others)
        : 'no group can exceed ' + maxTotal + ', the sum of all digits 1\u2026' + st.D;
      const desc = hits.map(h2 => String.fromCharCode(65 + h2.L) + ' = ' + digitsOf2(h2.nm).join('/')).join('; ');
      return { rule: 'Sum bounds', cells: [],
        text: 'In ' + line.name.toLowerCase() + ', ' + capTxt + ' \u2014 so ' + desc + '.',
        apply() { for (const h2 of hits) filterLetter(st, h2.L, h2.nm); } };
    }
  }
  return null;
}

// rule: equal groups — the same letter token appearing k times in one line
// means k separate digit sets with the same sum (each value within its per-line multiplicity); feasibility and the
// line's length restrict that sum
function ruleEqualGroups(st, clues) {
  if (st.kd) return null;   // under Knapp daneben identical clues may differ (each is independently one off)
  for (const line of eachSumsLine(st, clues)) {
    if (!line.clue || line.clue.length < 2) continue;
    const byTok = new Map();
    for (let g = 0; g < line.clue.length; g++) {
      const tok = line.clue[g];
      if (typeof tok === 'number') continue;
      const s2 = String(tok).toUpperCase().trim();
      if (/[?]/.test(s2) || !/[A-Z]/.test(s2)) continue;   // value must be letter-determined
      if (!byTok.has(s2)) byTok.set(s2, []);
      byTok.get(s2).push(g);
    }
    for (const [tokStr, gs] of byTok) {
      const k = gs.length;
      if (k < 2) continue;
      const maxTotal = 0 + st.maxTotal;
      const set = allowedSums(st, tokStr, maxTotal);
      // other groups' minimal lengths (1 cell each at minimum) + gaps
      const otherGroups = line.clue.length - k;
      const budgetCells = line.cells.length - (line.clue.length - 1) - otherGroups;   // gaps + 1 cell per other group
      const bad = [];
      for (const v of set) {
        const minCells = disjointFeasible(st, v, k, null);
        if (minCells === null || minCells > budgetCells) bad.push(v);
      }
      if (!bad.length || bad.length === set.size && set.size === 0) continue;
      if (bad.length === set.size) return { rule: 'Equal groups', contradiction: true, cells: line.cells.slice(),
        text: line.name + ' repeats the group \u201c' + tokStr + '\u201d ' + k + ' times, but no value lets ' + k + ' separate groups of digits with that sum to fit \u2014 the position is contradictory.' };
      if (!bad.length) continue;
      // map the surviving sums back to letter digits
      const p2 = tokenParse(tokStr, st);
      const survivors = [...set].filter(v => !bad.includes(v));
      const seen = p2.chars.map(() => 0);
      for (const s of survivors) accumulateSeen(st, p2, s, seen);
      const hits = [];
      for (let q = 0; q < p2.chars.length; q++) {
        const ch = p2.chars[q];
        if (ch.L === undefined) continue;
        const nm = st.letterCand[ch.L] & seen[q];
        if (nm !== 0 && nm !== st.letterCand[ch.L]) hits.push({ L: ch.L, nm });
      }
      if (!hits.length) continue;
      const desc = hits.map(h2 => String.fromCharCode(65 + h2.L) + ' = ' + digitsOf2(h2.nm).join('/')).join('; ');
      return { rule: 'Equal groups', cells: [],
        text: line.name + ' repeats the group \u201c' + tokStr + '\u201d ' + k + ' times \u2014 that needs ' + k + ' separate digit groups with the same sum (each value within its per-line count), and with the other groups and gaps only sums ' + survivors.join('/') + ' leave enough room. So ' + desc + '.',
        apply() { for (const h2 of hits) filterLetter(st, h2.L, h2.nm); } };
    }
  }
  return null;
}

// active letters of the whole puzzle
function activeLetterIds(clues) {
  const out = [];
  for (const list of (clues.rows || []).concat(clues.cols || [])) if (list) for (const tok of list) for (const L of tokenLetters(tok)) if (!out.includes(L)) out.push(L);
  return out.sort((a, b) => a - b);
}

// rule: letter pairs — k letters confined to the same k digits exclude those
// digits from every other letter (naked subsets, sudoku-style)
function ruleLetterPairs(st, clues) {
  const act = activeLetterIds(clues);
  if (act.length < 3) return null;
  // naked subsets of any size, sudoku-style: k letters confined to the same
  // k digits use them all up, so those digits leave every other letter
  // (pairs, triples, ... up to a pointing sextuple and beyond)
  const idxs = act.filter(L => popc(st.letterCand[L]) >= 2).sort((a, b) => popc(st.letterCand[a]) - popc(st.letterCand[b]));
  const maxSize = Math.min(act.length - 1, 10);
  for (let size = 2; size <= maxSize; size++) {
    const pick = [];
    function rec(from, union) {
      if (pick.length === size) {
        if (popc(union) !== size) return null;
        const hits = [];
        for (const L of act) if (!pick.includes(L) && (st.letterCand[L] & union)) hits.push(L);
        if (!hits.length) return null;
        return { union, members: pick.slice(), hits };
      }
      for (let q = from; q < idxs.length; q++) {
        const L = idxs[q];
        if (popc(st.letterCand[L] | union) > size) continue;
        pick.push(L);
        const r2 = rec(q + 1, union | st.letterCand[L]);
        pick.pop();
        if (r2) return r2;
      }
      return null;
    }
    const found = rec(0, 0);
    if (found) {
      const names = found.members.map(L => String.fromCharCode(65 + L));
      const digs = digitsOf2(found.union);
      const nWord = { 2: 'pair uses both', 3: 'triple uses all three', 4: 'quadruple uses all four', 5: 'quintuple uses all five', 6: 'sextuple uses all six' }[size] || ('set of ' + size + ' uses all ' + size);
      return { rule: 'Letter subsets', cells: [],
        text: names.join(', ') + ' are confined to the digits ' + digs.join(', ') + ' between them \u2014 since every letter takes a different digit, this ' + nWord + ', and ' + found.hits.map(L => String.fromCharCode(65 + L)).join(', ') + ' cannot be ' + (digs.length === 2 ? 'either' : 'any of them') + '.',
        apply() { for (const L of found.hits) filterLetter(st, L, ~found.union); } };
    }
  }
  return null;
}

// exact joint feasibility of one line's groups: pairwise-disjoint digit
// subsets of 1..D realising each group's sum, within the line's cell budget
function lineJointFeasible(st, tokens, sets, n, requireVal, sizes) {
  if (st.alien && !st.__forceBase && st.baseCand && st.baseCand.size > 1) {
    // joint bindings must read every numeral in ONE base: try each candidate
    for (const b of baseList(st)) {
      st.__forceBase = b;
      const ok = lineJointFeasible(st, tokens, sets, n, requireVal, sizes);
      st.__forceBase = undefined;
      if (ok) return true;
    }
    return false;
  }
  if (st.variants.asc) return lineJointFeasibleAsc(st, tokens, sets, n, requireVal, sizes);
  const jb = baseList(st)[0];
  // groups sharing crypto letters have correlated sums: picking a value for a
  // group binds its letters (consistently, all letters distinct), so two 'G'
  // groups must take the SAME sum and 'GH' must agree with them, etc.
  const G = sets.length;
  const maxCells = n - (G - 1);
  const lists = sets.map(s2 => [...s2].sort((a, b) => a - b));
  const parsed = tokens.map(t => tokenParse(t, st));
  let ok = false;
  const subsBydum = new Map();
  function subsetsFor(v) {
    if (subsBydum.has(v)) return subsBydum.get(v);
    const out = [];
    (function gen(d, pack, sum, cnt) {
      if (d > st.D) return;
      if (st.pal[0] > 0 && sum >= v) return;   // positive-only overshoot prune
      gen(d + 1, pack, sum, cnt);
      const left = st.cnt[d - 1] - ((pack >> (2 * (d - 1))) & 3);
      if (left > 0) {
        const s2 = sum + st.pal[d - 1], p2 = pack + (1 << (2 * (d - 1)));
        if (s2 === v) out.push({ mask: p2, cnt: cnt + 1 });   // push in the take branch only
        gen(d, p2, s2, cnt + 1);
      }
    })(1, 0, 0, 0);
    subsBydum.set(v, out);
    return out;
  }
  const letterVal = new Int8Array(26).fill(-1);
  let digitTaken = 0;
  const uni = uniformPal(st);
  function bindDisp(g, dv) {
    const p2 = parsed[g];
    if (!p2.chars) return [];
    if (!dvSignOk(p2, dv)) return null;
    const ds = digitsOfValueB(Math.abs(dv), jb);
    if (ds.length !== p2.chars.length) return null;
    const bound = [];
    for (let q = 0; q < ds.length; q++) {
      const ch = p2.chars[q], d = ds[q];
      if (ch.d !== undefined) { if (ch.d !== d) { unbind(bound); return null; } }
      else if (ch.L !== undefined) {
        if (letterVal[ch.L] >= 0) { if (letterVal[ch.L] !== d) { unbind(bound); return null; } }
        else {
          if (digitTaken & (1 << d)) { unbind(bound); return null; }
          if (!(st.letterCand[ch.L] & (1 << d))) { unbind(bound); return null; }
          letterVal[ch.L] = d; digitTaken |= 1 << d; bound.push(ch.L);
        }
      }
    }
    return bound;
  }
  function unbind(bound) { for (const L of bound) { digitTaken &= ~(1 << letterVal[L]); letterVal[L] = -1; } }
  (function rec(g, used, cells) {
    if (ok) return;
    if (g === G) { ok = true; return; }
    for (const v of lists[g]) {
      if (requireVal && requireVal.g === g && requireVal.v !== v) continue;
      for (const dv of displayedOptions(st, v)) {
        const bound = bindDisp(g, dv);
        if (bound === null) continue;
        for (const sub of subsetsFor(v)) {
          if (uni) { if (sub.mask & used) continue; }
        else {
          let clash = false;
          for (let k2 = 1; k2 <= st.pal.length; k2++) {
            const a2 = (sub.mask >> (2 * (k2 - 1))) & 3, b2 = (used >> (2 * (k2 - 1))) & 3;
            if (a2 + b2 > st.cnt[k2 - 1]) { clash = true; break; }
          }
          if (clash) continue;
        }
        // packs compatible
          if (sizes && sub.cnt !== sizes[g]) continue;
          if (cells + sub.cnt > maxCells) continue;
          rec(g + 1, used + sub.mask, cells + sub.cnt);
          if (ok) break;
        }
        unbind(bound);
        if (ok) return;
      }
    }
  })(0, 0, 0);
  return ok;
}

// ascending-clue joint feasibility: tokens are ascending by index but map to spans in
// an unknown order; assign each token a value (ascending), a digit subset,
// and (when sizes are given) a distinct span slot of matching size
function lineJointFeasibleAsc(st, tokens, sets, n, requireVal, sizes) {
  if (st.alien && !st.__forceBase && st.baseCand && st.baseCand.size > 1) {
    for (const b of baseList(st)) {
      st.__forceBase = b;
      const ok = lineJointFeasibleAsc(st, tokens, sets, n, requireVal, sizes);
      st.__forceBase = undefined;
      if (ok) return true;
    }
    return false;
  }
  const jb = baseList(st)[0];
  const K = sets.length;
  const maxCells = n - (K - 1);
  const lists = sets.map(s2 => [...s2].sort((a, b) => a - b));
  const parsed = tokens.map(t => tokenParse(t, st));
  const letterVal = new Int8Array(26).fill(-1);
  let digitTaken = 0, ok = false;
  const subsMemo = new Map();
  const uni2 = uniformPal(st);
  function subsetsFor(v) {
    if (subsMemo.has(v)) return subsMemo.get(v);
    const out = [];
    (function gen(d, pack, sum, cnt) {
      if (d > st.D) return;
      if (st.pal[0] > 0 && sum >= v) return;   // positive-only overshoot prune
      gen(d + 1, pack, sum, cnt);
      const left = st.cnt[d - 1] - ((pack >> (2 * (d - 1))) & 3);
      if (left > 0) {
        const s2 = sum + st.pal[d - 1], p2 = pack + (1 << (2 * (d - 1)));
        if (s2 === v) out.push({ mask: p2, cnt: cnt + 1 });   // push in the take branch only
        gen(d, p2, s2, cnt + 1);
      }
    })(1, 0, 0, 0);
    subsMemo.set(v, out);
    return out;
  }
  function bindDisp(g, dv) {
    const p2 = parsed[g];
    if (!p2.chars) return [];
    if (!dvSignOk(p2, dv)) return null;
    const ds = digitsOfValueB(Math.abs(dv), jb);
    if (ds.length !== p2.chars.length) return null;
    const bound = [];
    const bail = () => { for (const L of bound) { digitTaken &= ~(1 << letterVal[L]); letterVal[L] = -1; } return null; };
    for (let q = 0; q < ds.length; q++) {
      const ch = p2.chars[q], d = ds[q];
      if (ch.d !== undefined) { if (ch.d !== d) return bail(); }
      else if (ch.L !== undefined) {
        if (letterVal[ch.L] >= 0) { if (letterVal[ch.L] !== d) return bail(); }
        else if ((digitTaken & (1 << d)) || !(st.letterCand[ch.L] & (1 << d))) return bail();
        else { letterVal[ch.L] = d; digitTaken |= 1 << d; bound.push(ch.L); }
      }
    }
    return bound;
  }
  const unbind = b => { for (const L of b) { digitTaken &= ~(1 << letterVal[L]); letterVal[L] = -1; } };
  (function rec(k, used, cells, spanUsed, prevV) {
    if (ok) return;
    if (k === K) { ok = true; return; }
    for (const v of lists[k]) {
      if (v < prevV) continue;   // ascending by token index
      if (requireVal && requireVal.g === k && requireVal.v !== v) continue;
      for (const dv of displayedOptions(st, v)) {
        const bound = bindDisp(k, dv);
        if (bound === null) continue;
        for (const sub of subsetsFor(v)) {
          if (uniformPal(st)) { if (sub.mask & used) continue; }
        else {
          let clash = false;
          for (let k2 = 1; k2 <= st.pal.length; k2++) {
            const a2 = (sub.mask >> (2 * (k2 - 1))) & 3, b2 = (used >> (2 * (k2 - 1))) & 3;
            if (a2 + b2 > st.cnt[k2 - 1]) { clash = true; break; }
          }
          if (clash) continue;
        }
        // packs compatible
          if (cells + sub.cnt > maxCells) continue;
          if (sizes) {
            // claim a span slot of exactly this size
            let placed = false;
            for (let sp = 0; sp < sizes.length && !placed; sp++) {
              if ((spanUsed & (1 << sp)) || sizes[sp] !== sub.cnt) continue;
              rec(k + 1, used + sub.mask, cells + sub.cnt, spanUsed | (1 << sp), v);
              placed = true;   // identical sizes are interchangeable
            }
          } else rec(k + 1, used + sub.mask, cells + sub.cnt, 0, v);
          if (ok) break;
        }
        unbind(bound);
        if (ok) return;
      }
    }
  })(0, 0, 0, 0, 0);
  return ok;
}

// rule: disjoint sums — all of a line's groups need pairwise-disjoint digit
// sets; sums that no joint assignment realises are impossible
function ruleDisjointSums(st, clues) {
  for (const line of eachSumsLine(st, clues)) {
    if (!line.clue || line.clue.length < 2) continue;
    let hasLetters = false;
    for (const tok of line.clue) if (tokenLetters(tok).length) hasLetters = true;
    if (!hasLetters) continue;
    const sets = lineSumSets(st, line);
    if (sets.some(s2 => !s2.size)) continue;   // Sum bounds reports that
    let prod = 1;
    for (const s2 of sets) prod *= s2.size;
    if (prod > 4000) continue;
    const n = line.cells.length;
    for (let g = 0; g < line.clue.length; g++) {
      const p2 = tokenParse(line.clue[g], st);
      if (!p2.chars || !p2.chars.some(ch => ch.L !== undefined)) continue;
      const surviving = new Set();
      for (const v of sets[g]) if (lineJointFeasible(st, line.clue, sets, n, { g, v })) surviving.add(v);
      if (!surviving.size) return { rule: 'Disjoint sums', contradiction: true, cells: line.cells.slice(),
        text: line.name + '\u2019s groups cannot all take pairwise-different digits at once \u2014 the position is contradictory.' };
      if (surviving.size === sets[g].size) continue;
      const seen = p2.chars.map(() => 0);
      for (const s of surviving) accumulateSeen(st, p2, s, seen);
      const hits = [];
      for (let q = 0; q < p2.chars.length; q++) {
        const ch = p2.chars[q];
        if (ch.L === undefined) continue;
        const nm = st.letterCand[ch.L] & seen[q];
        if (nm !== 0 && nm !== st.letterCand[ch.L]) hits.push({ L: ch.L, nm });
      }
      if (!hits.length) continue;
      const desc = hits.map(h2 => String.fromCharCode(65 + h2.L) + ' = ' + digitsOf2(h2.nm).join('/')).join('; ');
      return { rule: 'Disjoint sums', cells: [],
        text: line.name + '\u2019s ' + line.clue.length + ' groups (' + line.clue.map(tokenLabel).join(', ') + ') need digit sets sharing the line\u2019s value budget, all fitting in ' + n + ' cells with gaps between \u2014 for \u201c' + tokenLabel(line.clue[g]) + '\u201d only ' + [...surviving].join('/') + ' can be realised alongside the others. So ' + desc + '.',
        apply() { for (const h2 of hits) filterLetter(st, h2.L, h2.nm); } };
    }
  }
  return null;
}

// rule (Knapp daneben only): a decided span's off-by-one clue leaves two
// candidate sums of the same parity; a lone open cell is pinned to two values
function ruleKDOffByOne(st, clues) {
  if (!st.kd) return null;
  if (st.variants.asc) return null;   // needs the run-to-token mapping
  for (const line of eachSumsLine(st, clues)) {
    const ds = decidedSpans(st, line);
    if (!ds) continue;
    for (const sp of ds) {
      const p2 = tokenParse(sp.tok, st);
      if (st.alien) {
        if (baseList(st).length !== 1) continue;
        const v = tokenFixedValue(p2, baseList(st)[0]);
        if (v === null) continue;
        p2.exact = v;
      }
      if (p2.exact === undefined) continue;
      const open = sp.cells.filter(i => popc(st.cand[i]) > 1);
      if (open.length !== 1) continue;
      let fixed = 0;
      for (const i of sp.cells) { const dd = committedDigit(st, i); if (dd) fixed += st.pal[dd - 1]; }
      const t1 = p2.exact - 1 - fixed, t2 = p2.exact + 1 - fixed;
      let keep = 0;
      for (let k2 = 1; k2 <= st.pal.length; k2++) if (st.pal[k2 - 1] === t1 || st.pal[k2 - 1] === t2) keep |= 1 << k2;
      const i = open[0];
      const nm = st.cand[i] & keep & ~1;
      if (nm === 0) return { rule: 'KD off-by-one', contradiction: true, cells: [i],
        text: line.name + '\u2019s clue ' + p2.exact + ' is one off, so its group truly sums to ' + (p2.exact - 1) + ' or ' + (p2.exact + 1) + ' \u2014 but ' + rc(st, i) + ' can complete neither.' };
      if (nm === st.cand[i]) continue;
      return { rule: 'KD off-by-one', cells: [i],
        text: line.name + '\u2019s clue ' + p2.exact + ' is one off its true value \u2014 the group sums to ' + (p2.exact - 1) + ' or ' + (p2.exact + 1) + ' (same parity either way)' + (fixed ? ', and ' + fixed + ' is already placed' : '') + ', so ' + rc(st, i) + ' is ' + digitsOf(nm).join(' or ') + '.',
        apply() { filterCand(st, i, nm); } };
    }
  }
  return null;
}

/* ---------------- shape rules ---------------- */
// helpers over the whole grid
function orthNeighbors(st, i) {
  const r = (i / st.C) | 0, c = i % st.C, out = [];
  if (r > 0) out.push(i - st.C);
  if (r < st.R - 1) out.push(i + st.C);
  if (c > 0) out.push(i - 1);
  if (c < st.C - 1) out.push(i + 1);
  return out;
}

function shapeCan(st, i, used) { return used ? !!(st.cand[i] & ~1) : !!(st.cand[i] & 1); }
function shapeFixed(st, i, used) { return shapeCan(st, i, used) && !shapeCan(st, i, used ? 0 : 1); }
function relationKey(x) { return x.a + ':' + x.av + '>' + x.b + ':' + x.bv; }
function lineShapeKey(line) { return line.kind + ':' + line.idx; }
function savedLineShapes(st, line) {
  const a = st.lineShapeDomains && st.lineShapeDomains[lineShapeKey(line)];
  return a && a.length ? new Set(a) : null;
}
function hasShapeRelation(st, x) {
  const k = relationKey(x);
  return (st.shapeRelations || []).some(y => relationKey(y) === k);
}
function lineRelationData(st, line) {
  if (!st.shapeRelations || !st.shapeRelations.length) return [];
  const pos = new Map();
  for (let p = 0; p < line.cells.length; p++) pos.set(line.cells[p], p);
  const out = [];
  for (const x of st.shapeRelations) if (pos.has(x.a) && pos.has(x.b)) out.push({ x, pa: pos.get(x.a), pb: pos.get(x.b) });
  return out;
}
function relationMaskOk(mask, rels) {
  for (const q of rels) {
    const av = (mask >> q.pa) & 1, bv = (mask >> q.pb) & 1;
    if (av === q.x.av && bv !== q.x.bv) return false;
  }
  return true;
}

// Structural line patterns used by the human shape rules.  A set bit means a
// number cell.  This deliberately over-approximates per-cell digit placement
// (while checking exact group lengths, sums, digit availability, and existing
// shape implications): proving a property over this larger set is therefore
// safe, and keeps the explanation at the level of runs rather than brute force.
function collectLineShapes(st, line, cap) {
  const n = line.cells.length, G = line.clue ? line.clue.length : -1;
  if (G < 0) return null;
  const tokenSets = lineSumSets(st, line);
  if (tokenSets.some(s2 => s2.size === 0)) return { patterns: [], overflow: false };
  let spanSets = tokenSets;
  if (st.variants.asc) {
    const union = new Set();
    for (const s2 of tokenSets) for (const v of s2) union.add(v);
    spanSets = tokenSets.map(() => union);
  }
  const maxCells = st.cnt.reduce((a, b) => a + b, 0);
  const lenOpts = spanSets.map(set => {
    const out = [];
    for (let len = 1; len <= n && len <= maxCells; len++) {
      let any = false;
      for (const sum of set) if (comboFeasible(st, sum, len, (1 << (st.D + 1)) - 2)) { any = true; break; }
      if (any) out.push(len);
    }
    return out;
  });
  const rels = lineRelationData(st, line);
  const starts = new Int16Array(Math.max(1, G)), lens = new Int16Array(Math.max(1, G));
  const sizeFeas = new Map(), seen = new Set();
  let overflow = false, nodes = 0;
  function rec(g, from, mask) {
    if (overflow) return;
    if (++nodes > (cap || 60000)) { overflow = true; return; }
    if (g === G) {
      for (let p = from; p < n; p++) if (!(st.cand[line.cells[p]] & 1)) return;
      if (!relationMaskOk(mask, rels)) return;
      if (G) {
        const key = Array.from(lens.slice(0, G)).join(',');
        let ok = sizeFeas.get(key);
        if (ok === undefined) { ok = lineJointFeasible(st, line.clue, tokenSets, n, null, Array.from(lens.slice(0, G))); sizeFeas.set(key, ok); }
        if (!ok) return;
      }
      seen.add(mask);
      return;
    }
    for (const len of lenOpts[g]) {
      const minStart = from + (g ? 1 : 0);
      for (let s0 = minStart; s0 + len <= n; s0++) {
        let ok = true;
        for (let p = from; p < s0 && ok; p++) if (!(st.cand[line.cells[p]] & 1)) ok = false;
        for (let p = s0; p < s0 + len && ok; p++) if (!(st.cand[line.cells[p]] & ~1)) ok = false;
        if (!ok) continue;
        starts[g] = s0; lens[g] = len;
        let m2 = mask;
        for (let p = s0; p < s0 + len; p++) m2 |= 1 << p;
        rec(g + 1, s0 + len, m2);
      }
    }
  }
  rec(0, 0, 0);
  const saved = savedLineShapes(st, line);
  return { patterns: saved ? [...seen].filter(m => saved.has(m)) : [...seen], overflow, lenOpts };
}

// A stored implication is itself a human pencil mark.  Apply it (or its
// contrapositive) as soon as one endpoint is decided.
function ruleShapeRelation(st) {
  for (const x of st.shapeRelations || []) {
    if (shapeFixed(st, x.a, x.av)) {
      if (!shapeCan(st, x.b, x.bv)) return { rule: 'Shape relation', contradiction: true, cells: [x.a, x.b],
        text: x.reason + ' But ' + rc(st, x.a) + ' is ' + (x.av ? 'a number' : 'shaded') + ' while ' + rc(st, x.b) + ' cannot be ' + (x.bv ? 'a number' : 'shaded') + ', so the position is contradictory.' };
      if (!shapeFixed(st, x.b, x.bv)) return { rule: 'Shape relation', cells: [x.a, x.b],
        text: x.reason + ' Since ' + rc(st, x.a) + ' is now ' + (x.av ? 'a number' : 'shaded') + ', ' + rc(st, x.b) + ' is ' + (x.bv ? 'a number' : 'shaded') + '.',
        apply() { filterCand(st, x.b, x.bv ? ~1 : 1); } };
    }
    const opposite = x.bv ? 0 : 1;
    if (shapeFixed(st, x.b, opposite) && shapeCan(st, x.a, x.av)) {
      const keep = x.av ? 0 : 1;
      if (!shapeCan(st, x.a, keep)) return { rule: 'Shape relation', contradiction: true, cells: [x.a, x.b], text: x.reason + ' Its contrapositive is impossible here.' };
      if (!shapeFixed(st, x.a, keep)) return { rule: 'Shape relation', cells: [x.a, x.b],
        text: x.reason + ' Contrapositively, because ' + rc(st, x.b) + ' is ' + (opposite ? 'a number' : 'shaded') + ', ' + rc(st, x.a) + ' is ' + (keep ? 'a number' : 'shaded') + '.',
        apply() { filterCand(st, x.a, keep ? ~1 : 1); } };
    }
  }
  return null;
}

// General checkerboard/run interaction.  If every legal source-line pattern
// flanks a possible shaded cell with numbers, but the neighbouring line can
// never have a three-number run centred there, shading the source forces the
// facing cell shaded.  Otherwise a number there would force both neighbours
// to numbers to avoid the two checkerboards.
function ruleCheckerboardTransfer(st, clues) {
  const enabled = (st.variants.blankConn && st.variants.reach) || (st.variants.numConn && st.variants.blankReach);
  if (!enabled) return null;
  const rows = eachSumsLine(st, clues).filter(x => x.kind === 'row');
  const cols = eachSumsLine(st, clues).filter(x => x.kind === 'col');
  for (const family of [rows, cols]) {
    const cache = new Map();
    const shapes = line => {
      if (!cache.has(line.idx)) cache.set(line.idx, collectLineShapes(st, line));
      return cache.get(line.idx);
    };
    for (let q = 0; q + 1 < family.length; q++) for (const [source, target] of [[family[q], family[q + 1]], [family[q + 1], family[q]]]) {
      if (!source.clue || !target.clue) continue;
      const A = shapes(source), B = shapes(target);
      if (!A || !B || A.overflow || B.overflow || !A.patterns.length || !B.patterns.length) continue;
      const add = [];
      for (let p = 1; p + 1 < source.cells.length; p++) {
        const blankCases = A.patterns.filter(m => !(m & (1 << p)));
        if (!blankCases.length) continue;
        if (blankCases.some(m => !(m & (1 << (p - 1))) || !(m & (1 << (p + 1))))) continue;
        if (!B.patterns.some(m => m & (1 << p))) continue;
        if (B.patterns.some(m => (m & (7 << (p - 1))) === (7 << (p - 1)))) continue;
        const x = { a: source.cells[p], av: 0, b: target.cells[p], bv: 0 };
        if (!hasShapeRelation(st, x)) add.push(x);
      }
      if (!add.length) continue;
      const coords = add.map(x => rc(st, x.a));
      const targetCoords = add.map(x => rc(st, x.b));
      const why = source.name + '\u2019s legal group lengths make every possible shaded cell' + (add.length === 1 ? ' at ' + coords[0] : ' in ' + coords.join(', ')) + ' sit between two numbers. ' + target.name + '\u2019s ascending sums and distinct digits permit no three-number run centred opposite ' + (add.length === 1 ? 'that cell' : 'any of those cells') + '.';
      const reason = why + ' A number directly opposite such a shaded cell would force both of its neighbours to be numbers to avoid checkerboards, creating exactly that forbidden three-cell run.';
      for (const x of add) x.reason = reason;
      return { rule: 'Checkerboard transfer', cells: add.flatMap(x => [x.a, x.b]),
        text: reason + ' Therefore whenever ' + (add.length === 1 ? coords[0] + ' is shaded, ' + targetCoords[0] + ' is shaded too' : 'one of ' + coords.join(', ') + ' is shaded, the facing cell in ' + target.name.toLowerCase() + ' is shaded too') + '.',
        apply() { if (!st.shapeRelations) st.shapeRelations = []; for (const x of add) st.shapeRelations.push(x); st.__lineCache = new Map(); } };
    }
  }
  return null;
}

// Nonogram-style interaction between neighbouring line layouts.  A row
// layout which forms a checkerboard against every remaining layout of the
// next row is impossible (and likewise for columns).  Keeping the reduced
// layout list lets the ordinary line bounds and connectivity rules reuse this
// human pencil work on later steps instead of rediscovering it by trial.
function ruleAdjacentLineLayouts(st, clues) {
  const enabled = (st.variants.blankConn && st.variants.reach) || (st.variants.numConn && st.variants.blankReach);
  if (!enabled) return null;
  const lines = eachSumsLine(st, clues);
  function domain(line) {
    if (line.clue) {
      const sh = collectLineShapes(st, line, 200000);
      if (!sh || sh.overflow) return null;
      return sh.patterns;
    }
    const saved = savedLineShapes(st, line), out = [];
    for (let mask = 0; mask < (1 << line.cells.length); mask++) {
      if (saved && !saved.has(mask)) continue;
      let ok = true;
      for (let p = 0; p < line.cells.length && ok; p++) {
        const m = st.cand[line.cells[p]];
        if ((mask & (1 << p)) ? !(m & ~1) : !(m & 1)) ok = false;
      }
      if (ok) out.push(mask);
    }
    return out;
  }
  function compatible(a, b, n) {
    for (let p = 0; p + 1 < n; p++) {
      const x = (a >> p) & 3, y = (b >> p) & 3;
      if ((x === 1 && y === 2) || (x === 2 && y === 1)) return false;
    }
    return true;
  }
  for (const kind of ['row', 'col']) {
    const family = lines.filter(x => x.kind === kind);
    for (let q = 0; q + 1 < family.length; q++) {
      for (const [aLine, bLine] of [[family[q], family[q + 1]], [family[q + 1], family[q]]]) {
        const A = domain(aLine), B = domain(bLine);
        if (!A || !B || !A.length || !B.length) continue;
        const keep = A.filter(a => B.some(b => compatible(a, b, aLine.cells.length)));
        if (!keep.length) return { rule: 'Adjacent line layouts', contradiction: true, cells: aLine.cells.concat(bLine.cells),
          text: aLine.name + ' has no layout that avoids a checkerboard with any remaining layout of ' + bLine.name.toLowerCase() + '.' };
        if (keep.length === A.length) continue;
        let any = 0, all = (1 << aLine.cells.length) - 1;
        for (const mask of keep) { any |= mask; all &= mask; }
        const forced = [];
        for (let p = 0; p < aLine.cells.length; p++) {
          const i = aLine.cells[p], used = !!(all & (1 << p)), blank = !(any & (1 << p));
          if (used && (st.cand[i] & 1)) forced.push({ i, used: true });
          if (blank && (st.cand[i] & ~1)) forced.push({ i, used: false });
        }
        const removed = A.length - keep.length;
        // Do not spend a visible human step recording microscopic bookkeeping
        // such as one rejected layout out of 2048.  Small domains, a forced
        // cell, or a material (at least 5%) reduction are worth pencilling in.
        if (!forced.length && A.length > 32 && removed < Math.ceil(A.length * 0.05)) continue;
        return { rule: 'Adjacent line layouts', cells: aLine.cells.concat(bLine.cells),
          text: aLine.name + ' has ' + A.length + ' possible number/shaded layouts from its clue bounds. ' + removed + ' of them would make a checkerboard against every one of ' + bLine.name.toLowerCase() + '\u2019s ' + B.length + ' layouts, so only ' + keep.length + ' remain' + (forced.length ? '; their shared cells force ' + forced.map(x => rc(st, x.i) + ' ' + (x.used ? 'numbered' : 'shaded')).join(', ') : '') + '.',
          apply() {
            if (!st.lineShapeDomains) st.lineShapeDomains = {};
            st.lineShapeDomains[lineShapeKey(aLine)] = keep.slice();
            for (const x of forced) filterCand(st, x.i, x.used ? ~1 : 1);
            st.__lineCache = new Map();
          } };
      }
    }
  }
  return null;
}

// rule (shape): no 2x2 of shaded cells — three committed blanks force the fourth used
function ruleNo22Blank(st, clues) {
  if (!st.variants.no22blank) return null;
  for (let r = 0; r + 1 < st.R; r++) for (let c = 0; c + 1 < st.C; c++) {
    const cells = [r * st.C + c, r * st.C + c + 1, (r + 1) * st.C + c, (r + 1) * st.C + c + 1];
    const blanks = cells.filter(i => st.cand[i] === 1);
    if (blanks.length === 4) return { rule: 'No 2\u00d72 shaded', contradiction: true, cells,
      text: 'The blank cells ' + cells.map(i => rc(st, i)).join(', ') + ' form a 2\u00d72 of shaded cells \u2014 that is not allowed.' };
    if (blanks.length !== 3) continue;
    const open = cells.find(i => st.cand[i] !== 1);
    if (!(st.cand[open] & 1)) continue;
    return { rule: 'No 2\u00d72 shaded', cells: [open],
      text: 'Three cells of the 2\u00d72 at ' + rc(st, cells[0]) + ' are shaded; a 2\u00d72 of shaded cells is not allowed, so ' + rc(st, open) + ' holds a digit.',
      apply() { filterCand(st, open, ~1); } };
  }
  return null;
}

// rule (shape): no checkerboard — a 2x2 with one diagonal shaded and the other
// diagonal filled is impossible: the shaded path joining the two blanks, plus
// their corner touch, closes a loop that seals one filled cell off the edge
function ruleChecker(st, clues) {
  // the checkerboard ban needs one type orthogonally connected AND the other
  // type all touching the edge: the connected type's path plus the corner
  // touch closes a loop that seals one cell of the other type off the border
  const viaShaded = st.variants.blankConn && st.variants.reach;
  const viaNumbers = st.variants.numConn && st.variants.blankReach;
  if (!viaShaded && !viaNumbers) return null;
  const why = viaShaded
    ? 'the shaded cells\u2019 connection would seal a digit region off the edge'
    : 'the digit cells\u2019 connection would seal a shaded region off the edge';
  const isBlank = i => st.cand[i] === 1;
  const isUsed = i => (st.cand[i] & 1) === 0;
  for (let r = 0; r + 1 < st.R; r++) for (let c = 0; c + 1 < st.C; c++) {
    const a = r * st.C + c, b = a + 1, c2 = a + st.C, d = c2 + 1;
    for (const [p, q, u, v] of [[a, d, b, c2], [b, c2, a, d]]) {
      if (!isBlank(p) || !isBlank(q)) continue;
      if (isUsed(u) && isUsed(v)) {
        return { rule: 'Checkerboard', contradiction: true, cells: [a, b, c2, d],
          text: rc(st, p) + ', ' + rc(st, q) + ' are blank and ' + rc(st, u) + ', ' + rc(st, v) + ' hold digits \u2014 a checkerboard 2\u00d72 is impossible: ' + why + '.' };
      }
      for (const [w, x] of [[u, v], [v, u]]) {
        if (!isUsed(w)) continue;
        if (!(st.cand[x] & ~1) || !(st.cand[x] & 1)) continue;   // undecided both ways
        return { rule: 'Checkerboard', cells: [x],
          text: rc(st, p) + ' and ' + rc(st, q) + ' are blank diagonal neighbours and ' + rc(st, w) + ' holds a digit \u2014 a checkerboard 2\u00d72 is impossible (' + why + '), so ' + rc(st, x) + ' is blank.',
          apply() { filterCand(st, x, 1); } };
      }
    }
  }
  return null;
}

// rule (shape): no 2x2 of numbers — three digits in a square force the fourth blank
function ruleNo22Numbers(st, clues) {
  if (!st.variants.no22num) return null;
  for (let r = 0; r + 1 < st.R; r++) for (let c = 0; c + 1 < st.C; c++) {
    const cells = [r * st.C + c, r * st.C + c + 1, (r + 1) * st.C + c, (r + 1) * st.C + c + 1];
    const used = cells.filter(i => (st.cand[i] & 1) === 0);
    if (used.length === 4) return { rule: 'No 2\u00d72 numbers', contradiction: true, cells,
      text: 'The cells ' + cells.map(i => rc(st, i)).join(', ') + ' all hold digits \u2014 a 2\u00d72 of numbers is not allowed.' };
    if (used.length !== 3) continue;
    const open = cells.find(i => (st.cand[i] & 1) !== 0);
    if (popc(st.cand[open]) === 1) continue;
    return { rule: 'No 2\u00d72 numbers', cells: [open],
      text: 'Three cells of the 2\u00d72 at ' + rc(st, cells[0]) + ' hold digits; a 2\u00d72 of numbers is not allowed, so ' + rc(st, open) + ' is blank.',
      apply() { filterCand(st, open, 1); } };
  }
  return null;
}

// rule (shape): all numbers orthogonally connected — a cut cell between two
// digit regions must itself hold a digit
function ruleNumConnect(st, clues) {
  if (!st.variants.numConn) return null;
  const N = st.R * st.C;
  const committed = [];
  for (let i = 0; i < N; i++) if ((st.cand[i] & 1) === 0) committed.push(i);
  if (committed.length < 2) return null;
  const canUse = i => (st.cand[i] & ~1) !== 0;
  function reachable(block) {
    const seen = new Uint8Array(N);
    const stack = [committed[0]];
    seen[committed[0]] = 1;
    while (stack.length) {
      const i = stack.pop();
      for (const j of orthNeighbors(st, i)) if (!seen[j] && j !== block && canUse(j)) { seen[j] = 1; stack.push(j); }
    }
    return seen;
  }
  const base = reachable(-1);
  for (const i of committed) if (!base[i]) {
    return { rule: 'Numbers connected', contradiction: true, cells: [i],
      text: 'The digit at ' + rc(st, i) + ' cannot connect to the other digits \u2014 all numbers form one orthogonal group.' };
  }
  for (let i = 0; i < N; i++) {
    if ((st.cand[i] & 1) === 0 || !canUse(i)) continue;
    const seen = reachable(i);
    let cut = false;
    for (const j of committed) if (!seen[j]) { cut = true; break; }
    if (!cut) continue;
    return { rule: 'Numbers connected', cells: [i],
      text: 'Every connection between the digit regions runs through ' + rc(st, i) + ' \u2014 the numbers form one orthogonal group, so ' + rc(st, i) + ' holds a digit.',
      apply() { filterCand(st, i, ~1); } };
  }
  return null;
}

// rule (shape): all shaded cells are orthogonally connected — a lone cut cell on
// every path between two committed-blank regions must itself be blank
function ruleShadedConnect(st, clues) {
  if (!st.variants.blankConn) return null;
  const N = st.R * st.C;
  const committed = [];
  for (let i = 0; i < N; i++) if (st.cand[i] === 1) committed.push(i);
  if (committed.length < 2) return null;
  const canBlank = i => (st.cand[i] & 1) !== 0;
  function reachable(block) {
    const seen = new Uint8Array(N);
    const stack = [committed[0]];
    seen[committed[0]] = 1;
    while (stack.length) {
      const i = stack.pop();
      for (const j of orthNeighbors(st, i)) if (!seen[j] && j !== block && canBlank(j)) { seen[j] = 1; stack.push(j); }
    }
    return seen;
  }
  const base = reachable(-1);
  for (const i of committed) if (!base[i]) {
    return { rule: 'Shaded connected', contradiction: true, cells: [i],
      text: 'The blank at ' + rc(st, i) + ' cannot connect to the rest of the shaded cells \u2014 the position is contradictory.' };
  }
  // cut cells: undecided blank-capable cells whose loss disconnects the shading
  for (let i = 0; i < N; i++) {
    if (st.cand[i] === 1 || !canBlank(i)) continue;   // committed blanks are not deduction targets
    const seen = reachable(i);
    let cut = false;
    for (const j of committed) if (!seen[j]) { cut = true; break; }
    if (!cut) continue;
    return { rule: 'Shaded connected', cells: [i],
      text: 'Every path joining the shaded parts runs through ' + rc(st, i) + ' \u2014 the shaded cells form one connected group, so ' + rc(st, i) + ' is blank.',
      apply() { filterCand(st, i, 1); } };
  }
  return null;
}

// must this line contain at least one shaded cell? (>= 2 groups force a
// separator; a single group that cannot span every cell forces one too)
function lineMustBlank(st, line) {
  if (!line.clue) return false;
  if (line.clue.length >= 2) return true;
  if (line.clue.length === 0) return line.cells.length > 0;   // explicit empty line
  const n = line.cells.length;
  if (n > st.cnt.reduce((a, b) => a + b, 0)) return true;   // more cells than values
  for (const s of allowedSums(st, line.clue[0], st.maxTotal)) {
    if (comboFeasibleV(st, s, n, 0, 1)) return false;   // the group could fill the line
  }
  return true;
}

// rule (shape): the one connected shaded group must place a shaded cell in every line whose
// clue forces one, all connected - blank-capable pockets that cannot reach
// such a line hold digits; a lone bridge on every route must be shaded
function ruleShadedSpine(st, clues) {
  if (!st.variants.blankConn) return null;
  const N = st.R * st.C;
  const canBlank = i => (st.cand[i] & 1) !== 0;
  // terminal sets: committed blanks (singletons) + must-shaded lines
  const terminals = [];
  for (let i = 0; i < N; i++) if (st.cand[i] === 1) terminals.push({ cells: [i], why: rc(st, i) + '\u2019s committed blank' });
  const lineTerms = [];
  for (const line of eachSumsLine(st, clues)) {
    if (!lineMustBlank(st, line)) continue;
    const T = line.cells.filter(canBlank);
    if (!T.length) {
      return { rule: 'Shaded spine', contradiction: true, cells: line.cells.slice(),
        text: line.name + '\u2019s clue forces at least one shaded cell, but no cell of the line can still be shaded.' };
    }
    lineTerms.push({ cells: T, why: line.name.toLowerCase() + ' (its clue forces a shaded cell)' });
  }
  for (const t of lineTerms) terminals.push(t);
  if (!terminals.length) return null;   // even one forced-shaded line kills unreachable pockets
  // components of the blank-capable graph
  const comp = new Int32Array(N).fill(-1);
  let nComp = 0;
  for (let i = 0; i < N; i++) {
    if (!canBlank(i) || comp[i] >= 0) continue;
    const stack = [i];
    comp[i] = nComp;
    while (stack.length) {
      const x = stack.pop();
      for (const j of orthNeighbors(st, x)) if (canBlank(j) && comp[j] < 0) { comp[j] = nComp; stack.push(j); }
    }
    nComp++;
  }
  const hitsAll = c => terminals.every(t => t.cells.some(i => comp[i] === c));
  const okComps = [];
  for (let c = 0; c < nComp; c++) if (hitsAll(c)) okComps.push(c);
  if (!okComps.length) {
    return { rule: 'Shaded spine', contradiction: true, cells: [],
      text: 'No connected region of blank-capable cells can reach every line whose clue forces a shaded cell \u2014 the one connected shaded group cannot exist.' };
  }
  // (a) a blank-capable cell outside every viable component cannot be shaded
  const hits = [];
  for (let i = 0; i < N; i++) {
    if (!canBlank(i) || popc(st.cand[i]) === 1) continue;
    if (!okComps.includes(comp[i])) hits.push(i);
  }
  if (hits.length) {
    const missed = terminals.find(t => !t.cells.some(i2 => comp[i2] === comp[hits[0]]));
    return { rule: 'Shaded spine', cells: hits.slice(0, 12),
      text: 'Every shaded cell joins the one connected shaded group, which must reach ' + (missed ? missed.why : 'every clued line') + ' \u2014 but ' + hits.slice(0, 6).map(i2 => rc(st, i2)).join(', ') + (hits.length > 6 ? ', \u2026' : '') + ' sit' + (hits.length === 1 ? 's' : '') + ' in a pocket that cannot, so ' + (hits.length === 1 ? 'it holds a digit' : 'they hold digits') + '.',
      apply() { for (const i2 of hits) filterCand(st, i2, ~1); } };
  }
  // (b) cut cells: removing one undecided cell must not sever every viable route
  if (okComps.length === 1) {
    for (let x = 0; x < N; x++) {
      if (!canBlank(x) || popc(st.cand[x]) === 1 || comp[x] !== okComps[0]) continue;
      const seen = new Int32Array(N).fill(-1);
      let nc2 = 0;
      for (let i = 0; i < N; i++) {
        if (!canBlank(i) || i === x || seen[i] >= 0) continue;
        const stack = [i];
        seen[i] = nc2;
        while (stack.length) {
          const y = stack.pop();
          for (const j of orthNeighbors(st, y)) if (canBlank(j) && j !== x && seen[j] < 0) { seen[j] = nc2; stack.push(j); }
        }
        nc2++;
      }
      let any = false;
      for (let c = 0; c < nc2 && !any; c++) {
        let all = true;
        for (const t of terminals) { if (!t.cells.some(i2 => i2 !== x && seen[i2] === c)) { all = false; break; } }
        if (all) any = true;
      }
      if (!any) {
        return { rule: 'Shaded spine', cells: [x],
          text: 'Every route the connected shaded group could take between the lines that must hold shaded cells passes through ' + rc(st, x) + ' \u2014 so ' + rc(st, x) + ' is shaded.',
          apply() { filterCand(st, x, 1); } };
      }
    }
  }
  return null;
}

// Symmetric partner of Shaded spine: the one connected number area must meet
// every non-empty clued line.  Number-capable pockets that cannot meet all of
// those obligations are shaded; a lone articulation shared by every viable
// route is a number.  This is stronger than looking only at numbers already
// committed on the board.
function ruleNumbersSpine(st, clues) {
  if (!st.variants.numConn) return null;
  const N = st.R * st.C;
  const canUse = i => (st.cand[i] & ~1) !== 0;
  const terminals = [];
  for (let i = 0; i < N; i++) if ((st.cand[i] & 1) === 0) terminals.push({ cells: [i], why: rc(st, i) + '\u2019s committed number' });
  for (const line of eachSumsLine(st, clues)) {
    if (!line.clue || !line.clue.length) continue;
    const T = line.cells.filter(canUse);
    if (!T.length) return { rule: 'Numbers spine', contradiction: true, cells: line.cells.slice(),
      text: line.name + '\u2019s clue requires at least one number, but no cell in the line can hold one.' };
    terminals.push({ cells: T, why: line.name.toLowerCase() + ' (its clue requires numbers)' });
  }
  if (!terminals.length) return null;
  const comp = new Int32Array(N).fill(-1);
  let nComp = 0;
  for (let i = 0; i < N; i++) {
    if (!canUse(i) || comp[i] >= 0) continue;
    const stack = [i]; comp[i] = nComp;
    while (stack.length) {
      const x = stack.pop();
      for (const j of orthNeighbors(st, x)) if (canUse(j) && comp[j] < 0) { comp[j] = nComp; stack.push(j); }
    }
    nComp++;
  }
  const hitsAll = c => terminals.every(t => t.cells.some(i => comp[i] === c));
  const okComps = [];
  for (let c = 0; c < nComp; c++) if (hitsAll(c)) okComps.push(c);
  if (!okComps.length) return { rule: 'Numbers spine', contradiction: true, cells: [],
    text: 'No connected region of number-capable cells can meet every clued line and every number already placed.' };
  const outside = [];
  for (let i = 0; i < N; i++) if (canUse(i) && (st.cand[i] & 1) && !okComps.includes(comp[i])) outside.push(i);
  if (outside.length) {
    const missed = terminals.find(t => !t.cells.some(i => comp[i] === comp[outside[0]]));
    return { rule: 'Numbers spine', cells: outside.slice(0, 12),
      text: 'All numbers belong to one connected area, which must reach ' + (missed ? missed.why : 'every clued line') + '; ' + outside.slice(0, 6).map(i => rc(st, i)).join(', ') + (outside.length > 6 ? ', \u2026' : '') + ' lie in a pocket that cannot, so ' + (outside.length === 1 ? 'it is' : 'they are') + ' shaded.',
      apply() { for (const i of outside) filterCand(st, i, 1); } };
  }
  if (okComps.length === 1) {
    for (let x = 0; x < N; x++) {
      if (!canUse(x) || (st.cand[x] & 1) === 0 || comp[x] !== okComps[0]) continue;
      const seen = new Int32Array(N).fill(-1);
      let nc = 0;
      for (let i = 0; i < N; i++) {
        if (!canUse(i) || i === x || seen[i] >= 0) continue;
        const stack = [i]; seen[i] = nc;
        while (stack.length) {
          const y = stack.pop();
          for (const j of orthNeighbors(st, y)) if (canUse(j) && j !== x && seen[j] < 0) { seen[j] = nc; stack.push(j); }
        }
        nc++;
      }
      let any = false;
      for (let c = 0; c < nc && !any; c++) if (terminals.every(t => t.cells.some(i => i !== x && seen[i] === c))) any = true;
      if (!any) return { rule: 'Numbers spine', cells: [x],
        text: 'Every route by which the connected number area can meet the clued lines passes through ' + rc(st, x) + ', so it holds a number.',
        apply() { filterCand(st, x, ~1); } };
    }
  }
  return null;
}

// rule (shape): every group of digit cells touches the grid edge — a digit
// region whose only escape runs through one cell forces that cell used
function ruleNumbersReach(st, clues) {
  if (!st.variants.reach) return null;
  const N = st.R * st.C;
  const canUse = i => (st.cand[i] & ~1) !== 0;
  const onEdge = i => { const r = (i / st.C) | 0, c = i % st.C; return r === 0 || c === 0 || r === st.R - 1 || c === st.C - 1; };
  const committedUsed = [];
  for (let i = 0; i < N; i++) if ((st.cand[i] & 1) === 0) committedUsed.push(i);
  if (!committedUsed.length) return null;
  function escapes(from, block) {
    // can this used cell reach the edge through use-capable cells?
    const seen = new Uint8Array(N);
    const stack = [from];
    seen[from] = 1;
    if (onEdge(from) && from !== block) return true;
    while (stack.length) {
      const i = stack.pop();
      for (const j of orthNeighbors(st, i)) {
        if (seen[j] || j === block || !canUse(j)) continue;
        if (onEdge(j)) return true;
        seen[j] = 1; stack.push(j);
      }
    }
    return false;
  }
  for (const i of committedUsed) {
    if (!escapes(i, -1)) {
      return { rule: 'Numbers reach edge', contradiction: true, cells: [i],
        text: 'The digit region at ' + rc(st, i) + ' is sealed off from the edge \u2014 every group of digits must touch the grid\u2019s border.' };
    }
  }
  for (let j = 0; j < N; j++) {
    if (!canUse(j) || !(st.cand[j] & 1)) continue;   // must still allow blank, or there is nothing to deduce
    for (const i of committedUsed) {
      if (escapes(i, j)) continue;
      return { rule: 'Numbers reach edge', cells: [j],
        text: 'The digit region at ' + rc(st, i) + ' can only reach the grid\u2019s edge through ' + rc(st, j) + ' \u2014 digit groups may not be locked in by the shading, so ' + rc(st, j) + ' holds a digit.',
        apply() { filterCand(st, j, ~1); } };
    }
  }
  return null;
}

// rule (shape): every shaded group touches the grid's edge — a shaded
// region's last escape route to the border must stay shaded
function ruleBlankReach(st, clues) {
  if (!st.variants.blankReach) return null;
  const N = st.R * st.C;
  const canBlank = i => (st.cand[i] & 1) !== 0;
  const onEdge = i => { const r = (i / st.C) | 0, c = i % st.C; return r === 0 || c === 0 || r === st.R - 1 || c === st.C - 1; };
  const committedBlank = [];
  for (let i = 0; i < N; i++) if (st.cand[i] === 1) committedBlank.push(i);
  if (!committedBlank.length) return null;
  function escapes(from, block) {
    const seen = new Uint8Array(N);
    const stack = [from];
    seen[from] = 1;
    if (onEdge(from) && from !== block) return true;
    while (stack.length) {
      const i = stack.pop();
      for (const j of orthNeighbors(st, i)) {
        if (seen[j] || j === block || !canBlank(j)) continue;
        if (onEdge(j)) return true;
        seen[j] = 1; stack.push(j);
      }
    }
    return false;
  }
  for (const i of committedBlank) {
    if (!escapes(i, -1)) {
      return { rule: 'Shaded reach edge', contradiction: true, cells: [i],
        text: 'The shaded region at ' + rc(st, i) + ' is sealed off from the edge \u2014 every shaded group must touch the grid\u2019s border.' };
    }
  }
  for (let j = 0; j < N; j++) {
    if (!canBlank(j) || !(st.cand[j] & ~1)) continue;   // must be undecided both ways
    for (const i of committedBlank) {
      if (escapes(i, j)) continue;
      return { rule: 'Shaded reach edge', cells: [j],
        text: 'The shaded region at ' + rc(st, i) + ' can only reach the grid\u2019s edge through ' + rc(st, j) + ' \u2014 shaded groups may not be locked in, so ' + rc(st, j) + ' is blank.',
        apply() { filterCand(st, j, 1); } };
    }
  }
  return null;
}

// rule: every positive digit belongs to a group, so it cannot itself exceed
// the largest sum any group in its line may take.
function ruleSumCeiling(st, clues) {
  if (st.pal[0] <= 0) return null;
  for (const line of eachSumsLine(st, clues)) {
    if (!line.clue || !line.clue.length) continue;
    const capToks = st.variants.asc ? [line.clue[line.clue.length - 1]] : line.clue;
    let cap = -Infinity;
    for (const tok of capToks) for (const s of allowedSums(st, tok, st.maxTotal)) if (s > cap) cap = s;
    if (cap === -Infinity || cap >= st.maxTotal) continue;
    const hits = [];
    for (const i of line.cells) {
      let bad = 0;
      for (let d = 1; d <= st.D; d++) if ((st.cand[i] & (1 << d)) && st.pal[d - 1] > cap) bad |= 1 << d;
      if (bad) hits.push({ i, bad });
    }
    if (!hits.length) continue;
    return { rule: 'Sum ceiling', cells: hits.map(x => x.i),
      text: line.name + '\u2019s largest possible group sum is ' + cap + (line.clue.length > 1 && st.variants.asc ? ' (the clues are ascending, so the last clue caps every group)' : '') + '. A single digit already contributes its own value to its group, so ' + hits.slice(0, 6).map(x => rc(st, x.i) + ' loses ' + valuesOf(st, x.bad).join('/')).join('; ') + (hits.length > 6 ? '; and ' + (hits.length - 6) + ' more cells lose the same over-cap values' : '') + '.',
      apply() { for (const x of hits) filterCand(st, x.i, ~x.bad); } };
  }
  return null;
}

// rule: a committed run's sum plus any adjoining digit must stay within the
// clue's largest possible group sum (under ascending clues the last token's
// maximum caps every group) — neighbours of heavy runs shed big values
function ruleSumCap(st, clues) {
  if (st.pal[0] <= 0) return null;   // with negatives a later cell can bring a sum back down
  for (const line of eachSumsLine(st, clues)) {
    if (!line.clue || !line.clue.length) continue;
    // ascending clues: the last token bounds every group; otherwise any token might
    const capToks = st.variants.asc ? [line.clue[line.clue.length - 1]] : line.clue;
    let cap = -Infinity;
    for (const tok of capToks) { for (const s2 of allowedSums(st, tok, st.maxTotal)) if (s2 > cap) cap = s2; }
    if (cap === -Infinity || cap >= st.maxTotal) continue;
    // maximal committed-digit segments
    const n2 = line.cells.length;
    let p = 0;
    while (p < n2) {
      const d0 = committedDigit(st, line.cells[p]);
      if (!d0) { p++; continue; }
      let q = p, s = 0;
      while (q < n2) { const d = committedDigit(st, line.cells[q]); if (!d) break; s += st.pal[d - 1]; q++; }
      if (s > cap) {
        return { rule: 'Sum cap', contradiction: true, cells: line.cells.slice(p, q),
          text: line.name + '\u2019s digits ' + line.cells.slice(p, q).map(i => rc(st, i)).join('+') + ' already sum to ' + s + ', but no group of its clue can exceed ' + cap + '.' };
      }
      for (const side of [p - 1, q]) {
        if (side < 0 || side >= n2) continue;
        const i = line.cells[side];
        if (committedDigit(st, i) || st.cand[i] === 1) continue;
        let bad = 0;
        for (let k = 1; k <= st.D; k++) if ((st.cand[i] & (1 << k)) && s + st.pal[k - 1] > cap) bad |= 1 << k;
        if (!bad) continue;
        const keep = st.cand[i] & ~bad;
        return { rule: 'Sum cap', cells: [i],
          text: line.name + '\u2019s largest possible group sum is ' + cap + (line.clue.length > 1 && st.variants.asc ? ' (its clues are ascending, so the last one caps every group)' : '') + '; the run ' + line.cells.slice(p, q).map(i2 => rc(st, i2)).join('+') + ' = ' + s + ' would overflow it \u2014 ' + rc(st, i) + ' joined to it must be ' + (cap - s < st.pal[0] ? 'blank' : 'at most ' + (cap - s)) + ', so it keeps ' + (valuesOf(st, keep & ~1).join('/') || 'only blank') + ((keep & 1) ? ' or blank' : '') + '.',
          apply() { filterCand(st, i, keep); } };
      }
      p = q;
    }
  }
  return null;
}

// rule: full house — a line whose clue sums total 1+2+..+D must contain every digit
function ruleFullLine(st, clues) {
  if (st.kd) return null;   // displayed totals are off by one per group under Knapp daneben
  // with negatives or a placeable 0, omitting a zero-sum sub-multiset keeps the
  // total unchanged - "total = whole palette" no longer forces every value
  if (st.minTotal < 0 || st.pal.includes(0)) return null;
  const fullSum = st.maxTotal + st.minTotal;   // sum of the entire palette
  for (const line of eachSumsLine(st, clues)) {
    if (!line.clue) continue;
    const parsed = line.clue.map(t => tokenParse(t, st));
    let tot;
    if (st.alien) {
      // every candidate base must read the clue's total as the whole palette
      tot = null;
      let ok = true;
      for (const b of baseList(st)) {
        const vals = parsed.map(p => tokenFixedValue(p, b));
        if (vals.some(v => v === null)) { ok = false; break; }
        const t = vals.reduce((a, v) => a + v, 0);
        if (tot === null) tot = t;
        if (t !== fullSum) { ok = false; break; }
      }
      if (!ok || tot === null) continue;
    } else {
      if (parsed.some(p => p.exact === undefined)) continue;
      tot = parsed.reduce((a, p) => a + p.exact, 0);
    }
    if (tot !== fullSum) continue;
    for (let d = 1; d <= st.D; d++) {
      const need = st.cnt[d - 1];
      const homes = line.cells.filter(i => st.cand[i] & (1 << d));
      const v = st.pal[d - 1];
      if (homes.length < need) {
        return { rule: 'Full line', contradiction: true, cells: line.cells.slice(),
          text: line.name + '\u2019s sums total ' + tot + ' \u2014 the whole palette \u2014 so every value appears fully, but ' + v + ' needs ' + need + ' place' + (need > 1 ? 's' : '') + ' and has only ' + homes.length + '.' };
      }
      if (homes.length === need) {
        const hits = homes.filter(i => popc(st.cand[i]) > 1);
        if (!hits.length) continue;
        return { rule: 'Full line', cells: hits,
          text: line.name + '\u2019s sums total ' + tot + ' = the whole palette, so every value appears in it \u2014 and ' + v + ' fits only at ' + homes.map(i => rc(st, i)).join(', ') + '.',
          apply() { for (const i of hits) filterCand(st, i, 1 << d); } };
      }
    }
  }
  return null;
}

// rule: line placements — enumerate the group layouts (spans only) and keep
// what every layout shares: cells filled in all of them, cells blank in all
// does the shading certainly extend beyond this line? (another line's clue
// forces a shaded cell, or a blank is committed outside this line)
function shadedBeyondLine(st, clues, line) {
  if (!st.variants.blankConn) return false;
  const inLine = new Set(line.cells);
  for (let i = 0; i < st.R * st.C; i++) if (st.cand[i] === 1 && !inLine.has(i)) return true;
  for (const other of eachSumsLine(st, clues)) {
    if (other.name === line.name || !other.clue) continue;
    if (other.kind === line.kind) {
      // parallel lines share no cell: their forced separator lies outside
      if (other.clue.length >= 2) return true;
    } else {
      // a crossing line shares exactly one cell: one separator could sit
      // there, so only >= 2 forced separators guarantee one outside
      if (other.clue.length >= 3) return true;
    }
  }
  return false;
}

function ruleLinePlacements(st, clues) {
  for (const line of eachSumsLine(st, clues)) {
    if (!line.clue) continue;
    const n = line.cells.length;
    const alwaysFilled = new Int8Array(n).fill(1), alwaysBlank = new Int8Array(n).fill(1);
    let count = 0;
    // enumerate group spans: positions + lengths, respecting current masks
    const G = line.clue.length;
    const maxSum = 0 + st.maxTotal;
    const tokenSets = lineSumSets(st, line);   // budget-refined, per clue token
    const minGroupSums = tokenSets.map(set => { let m = Infinity; for (const v of set) if (v < m) m = v; return m; });
    const minLineTotal = minGroupSums.every(Number.isFinite) ? minGroupSums.reduce((a, b) => a + b, 0) : null;
    let minNumberCells = null;
    if (minLineTotal !== null && st.pal.every(v => v > 0)) {
      const descending = [];
      for (let k = 0; k < st.pal.length; k++) for (let q = 0; q < st.cnt[k]; q++) descending.push(st.pal[k]);
      descending.sort((a, b) => b - a);
      let total = 0;
      for (let q = 0; q < descending.length && total < minLineTotal; q++) { total += descending[q]; minNumberCells = q + 1; }
    }
    let sumSets = tokenSets;
    if (st.variants.asc) {
      // group order is unknown: every span may take any group's sums
      const union = new Set();
      for (const s2 of tokenSets) for (const v of s2) union.add(v);
      sumSets = tokenSets.map(() => union);
    }
    if (sumSets.some(s2 => s2.size === 0)) {
      return { rule: 'Line placements', contradiction: true, cells: line.cells.slice(),
        text: line.name + '\u2019s clue ' + line.clue.map(tokenLabel).join(', ') + ' admits no possible sum for one of its groups \u2014 the position is contradictory.' };
    }
    const lenOpts = sumSets.map(set => {
      const L = [];
      const capLen = st.cnt.reduce((a, b) => a + b, 0);
      for (let l = 1; l <= capLen && l <= n; l++) {
        let any = false;
        for (const s of set) if (comboFeasible(st, s, l, ((1 << (st.D + 1)) - 2))) { any = true; break; }
        if (any) L.push(l);
      }
      return L;
    });
    const spanStart = new Int32Array(G), spanLen = new Int32Array(G);
    const sizeFeas = new Map();
    const escapeGate = shadedBeyondLine(st, clues, line);
    const numberEscapeGate = numbersBeyondLine(st, clues, line);
    const relationGate = lineRelationData(st, line);
    const savedShapeGate = savedLineShapes(st, line);
    const lineSet = new Set(line.cells);
    const numberEscAt = new Uint8Array(n);
    if (numberEscapeGate) for (let p = 0; p < n; p++) for (const j of orthNeighbors(st, line.cells[p])) {
      if (!lineSet.has(j) && (st.cand[j] & ~1)) { numberEscAt[p] = 1; break; }
    }
    let escapeRejects = 0, numberEscapeRejects = 0, relationRejects = 0, savedShapeRejects = 0, singletonRejects = 0;
    const supportLayouts = [];
    function place(g, from) {
      if (count > 4000) return;
      if (g === G) {
        // trailing cells must allow blank
        let last = G ? spanStart[G - 1] + spanLen[G - 1] : 0;
        for (let p = last; p < n; p++) if (!(st.cand[line.cells[p]] & 1)) return;
        let shapeMask = 0;
        for (let g3 = 0; g3 < G; g3++) for (let p = spanStart[g3]; p < spanStart[g3] + spanLen[g3]; p++) shapeMask |= 1 << p;
        if (relationGate.length) {
          if (!relationMaskOk(shapeMask, relationGate)) { relationRejects++; return; }
        }
        if (savedShapeGate) {
          if (!savedShapeGate.has(shapeMask)) { savedShapeRejects++; return; }
        }
        // shaded escape: every maximal shaded stretch of this layout needs a
        // blank-capable neighbour outside the line, or it is a sealed pocket
        if (escapeGate) {
          const inG2 = new Int8Array(n);
          for (let g3 = 0; g3 < G; g3++) for (let p = spanStart[g3]; p < spanStart[g3] + spanLen[g3]; p++) inG2[p] = 1;
          let p = 0;
          while (p < n) {
            if (inG2[p]) { p++; continue; }
            let q = p, esc = false;
            while (q < n && !inG2[q]) {
              for (const j of orthNeighbors(st, line.cells[q])) {
                if (!lineSet.has(j) && (st.cand[j] & 1)) { esc = true; break; }
              }
              q++;
            }
            if (!esc) { escapeRejects++; return; }
            p = q;
          }
        }
        if (numberEscapeGate) {
          for (let g3 = 0; g3 < G; g3++) {
            let esc = false;
            for (let p = spanStart[g3]; p < spanStart[g3] + spanLen[g3]; p++) if (numberEscAt[p]) { esc = true; break; }
            if (!esc) { numberEscapeRejects++; return; }
          }
        }
        // spans' lengths must be jointly realisable: pairwise-disjoint digit
        // sets of exactly these sizes, letters bound consistently
        if (G > 0) {
          const key = spanLen.join(',');
          let feas = sizeFeas.get(key);
          if (feas === undefined) { feas = lineJointFeasible(st, line.clue, tokenSets, n, null, Array.from(spanLen)); sizeFeas.set(key, feas); }
          if (!feas) return;
        }
        // Group-length arithmetic normally uses the whole palette.  For a
        // proposed one-cell group we can also check the exact crossing cell:
        // it must still allow a digit whose value is one of this group's
        // possible sums.  This remains a deliberately local, necessary test;
        // longer groups stay over-approximated here.
        let rejection = null;
        for (let g3 = 0; g3 < G && !rejection; g3++) {
          if (spanLen[g3] !== 1) continue;
          const p = spanStart[g3], i = line.cells[p];
          let requiredMask = 0;
          for (let d = 1; d <= st.D; d++) if (sumSets[g3].has(st.pal[d - 1])) requiredMask |= 1 << d;
          if (requiredMask && !(st.cand[i] & requiredMask)) rejection = { p, i, requiredMask };
        }
        supportLayouts.push({ mask: shapeMask, rejection });
        if (rejection) { singletonRejects++; return; }
        count++;
        const inG = new Int8Array(n);
        for (let g2 = 0; g2 < G; g2++) for (let p = spanStart[g2]; p < spanStart[g2] + spanLen[g2]; p++) inG[p] = 1;
        for (let p = 0; p < n; p++) { if (inG[p]) alwaysBlank[p] = 0; else alwaysFilled[p] = 0; }
        return;
      }
      for (const l of lenOpts[g]) {
        const minStart = from + (g > 0 ? 1 : 0);   // >= 1 blank between groups
        for (let s0 = minStart; s0 + l <= n; s0++) {
          // EVERY cell between the previous group and this one is blank in
          // this arrangement, including the mandatory separator - check all
          let ok = true;
          for (let p = from; p < s0 && ok; p++) if (!(st.cand[line.cells[p]] & 1)) ok = false;
          if (!ok) continue;   // NOTE: cannot break: a non-blank cell blocks all later starts
          let ok2 = true;
          for (let p = s0; p < s0 + l && ok2; p++) if (!(st.cand[line.cells[p]] & ~1)) ok2 = false;
          if (!ok2) continue;
          spanStart[g] = s0; spanLen[g] = l;
          place(g + 1, s0 + l);
          if (count > 4000) return;
        }
      }
    }
    place(0, 0);
    if (count === 0) {
      const why = line.clue.map((tok, g2) => {
        const ls = lenOpts[g2];
        const ss = [...sumSets[g2]];
        return '\u201c' + tokenLabel(tok) + '\u201d = ' + (ss.length <= 4 ? ss.join('/') : ss[0] + '\u2026' + ss[ss.length - 1]) + (ls.length ? ' needing ' + (ls.length === 1 ? ls[0] : ls[0] + '\u2013' + ls[ls.length - 1]) + ' cell' + (ls.length === 1 && ls[0] === 1 ? '' : 's') : ' with no feasible length');
      }).join('; ');
      return { rule: singletonRejects ? 'Cross-line singleton' : (savedShapeRejects ? 'Line pattern cases' : (relationRejects ? 'Linked line bounds' : (numberEscapeRejects ? 'Numbers escape' : (escapeRejects ? 'Shaded escape' : 'Line placements')))), contradiction: true, cells: line.cells.slice(),
        text: 'No arrangement of ' + line.name.toLowerCase() + '\u2019s groups fits: ' + why + (singletonRejects ? ' \u2014 every remaining layout leaves a one-cell group at a crossing cell that cannot take any value allowed for that sum' : (relationRejects ? ' \u2014 each remaining layout breaks a previously proved shading relation in this line' : (numberEscapeRejects ? ' \u2014 every remaining layout stranded a number run from the connected number area' : (escapeRejects ? ' \u2014 every remaining layout left a shaded stretch sealed off from the rest of the shading' : ' \u2014 with the required gaps and the digits still possible in its cells, they cannot all be placed')))) + '.' };
    }
    if (count > 4000) continue;
    const mkFilled = [], mkBlank = [];
    for (let p = 0; p < n; p++) {
      if (alwaysFilled[p] && (st.cand[line.cells[p]] & 1)) mkFilled.push(p);
      if (alwaysBlank[p] && (st.cand[line.cells[p]] & ~1)) mkBlank.push(p);
    }
    if (!mkFilled.length && !mkBlank.length) continue;
    const lenTxt = line.clue.map((tok, g2) => {
      const ls = lenOpts[g2];
      const ss = [...sumSets[g2]];
      const sumTxt = ss.length === 1 ? ' = ' + ss[0] : (ss.length <= 3 ? ' = ' + ss.join('/') : '');
      return '\u201c' + tokenLabel(tok) + '\u201d' + sumTxt + ' is ' + (ls.length === 1 ? ls[0] + ' cell' + (ls[0] === 1 ? '' : 's') : ls[0] + '\u2013' + ls[ls.length - 1] + ' cells') + ' long';
    }).join(', ');
    let windowTxt = '';
    if (G === 1) {
      let a0 = 0, b0 = n - 1;
      while (a0 < n && !(st.cand[line.cells[a0]] & ~1)) a0++;
      while (b0 >= 0 && !(st.cand[line.cells[b0]] & ~1)) b0--;
      if (a0 > 0 || b0 < n - 1) windowTxt = ', and it must fit between ' + rc(st, line.cells[a0]) + ' and ' + rc(st, line.cells[b0]);
    }
    const bits = [];
    if (mkFilled.length) bits.push('wherever the group' + (G === 1 ? ' slides' : 's slide') + ', ' + mkFilled.map(p => rc(st, line.cells[p])).join(', ') + ' ' + (mkFilled.length === 1 ? 'is' : 'are') + ' covered');
    if (mkBlank.length) bits.push(mkBlank.map(p => rc(st, line.cells[p])).join(', ') + ' ' + (mkBlank.length === 1 ? 'is' : 'are') + ' out of reach and blank');
    let singletonTxt = '';
    for (const forcedP of mkFilled) {
      const opposed = supportLayouts.filter(x => !(x.mask & (1 << forcedP)));
      if (!opposed.length || opposed.some(x => !x.rejection)) continue;
      const first = opposed[0].rejection;
      if (opposed.some(x => x.rejection.i !== first.i || x.rejection.requiredMask !== first.requiredMask)) continue;
      const req = valuesOf(st, first.requiredMask);
      let crossingTxt = '';
      const rr = (first.i / st.C) | 0, cc = first.i % st.C;
      const crossing = eachSumsLine(st, clues).find(x => x.kind === (line.kind === 'row' ? 'col' : 'row') && x.idx === (line.kind === 'row' ? cc : rr));
      if (crossing && crossing.clue && crossing.clue.length) {
        const toks = st.variants.asc ? [crossing.clue[crossing.clue.length - 1]] : crossing.clue;
        let cap = -Infinity;
        for (const tok of toks) for (const s of allowedSums(st, tok, st.maxTotal)) if (s > cap) cap = s;
        if (req.length && req.every(v => v > cap)) crossingTxt = ' ' + crossing.name + '\u2019s largest possible group sum is ' + cap + ', so ' + rc(st, first.i) + ' cannot take ' + (req.length === 1 ? 'that ' + req[0] : req.join('/')) + '.';
      }
      if (!crossingTxt) crossingTxt = ' Those values have already been excluded from ' + rc(st, first.i) + ' by its crossing line.';
      singletonTxt = ' If ' + rc(st, line.cells[forcedP]) + ' were shaded, every remaining layout would leave ' + rc(st, first.i) + ' as a one-cell group. Such a group can only be ' + (req.length === 1 ? req[0] : req.join('/')) + '.' + crossingTxt;
      break;
    }
    const boundTxt = minLineTotal !== null && minNumberCells !== null
      ? ' The group sums total at least ' + minLineTotal + ' (' + minGroupSums.join('+') + '); with distinct values, reaching that total needs at least ' + minNumberCells + ' number cell' + (minNumberCells === 1 ? '' : 's') + ', while ' + G + ' groups need at least ' + Math.max(0, G - 1) + ' shaded separator' + (G === 2 ? '' : 's') + '.'
      : '';
    const relTxt = relationRejects ? ' The previously proved implication' + (relationGate.length === 1 ? ' ' + rc(st, relationGate[0].x.a) + ' ' + (relationGate[0].x.av ? 'number' : 'shaded') + ' \u21d2 ' + rc(st, relationGate[0].x.b) + ' ' + (relationGate[0].x.bv ? 'number' : 'shaded') : 's among cells in this line') + ' rules out the remaining incompatible layouts.' : '';
    return { rule: singletonTxt ? 'Cross-line singleton' : (savedShapeRejects ? 'Line pattern cases' : (relationRejects ? 'Linked line bounds' : (numberEscapeRejects ? 'Numbers escape' : (escapeRejects ? 'Shaded escape' : 'Line placements')))), cells: mkFilled.concat(mkBlank).map(p => line.cells[p]),
      text: (G === 0 ? line.name + '\u2019s clue is 0 \u2014 the line holds no digits at all: ' + bits.join('; ') + '.' : line.name + '\u2019s ' + G + ' group' + (G === 1 ? '' : 's') + ' (' + line.clue.map(tokenLabel).join(', ') + '): ' + lenTxt + windowTxt + boundTxt + relTxt + singletonTxt + (numberEscapeRejects && !relationRejects ? ' Layouts stranding a number run with no number-capable neighbour outside the line were discarded.' : (escapeRejects && !relationRejects ? ' Arrangements leaving a shaded stretch sealed off from the rest of the shading (no blank-capable neighbour outside the line) were discarded.' : '')) + ' Therefore ' + bits.join('; ') + '.'),
      apply() {
        for (const p of mkFilled) filterCand(st, line.cells[p], ~1);
        for (const p of mkBlank) filterCand(st, line.cells[p], 1);
      } };
  }
  return null;
}

// decided spans of one line: maximal committed-non-blank runs, delimited by
// committed blanks or edges, mapped to the clue groups when counts match
function decidedSpans(st, line) {
  if (!line.clue) return null;
  const n = line.cells.length;
  const runs = [];
  let p = 0;
  while (p < n) {
    if ((st.cand[line.cells[p]] & 1) === 0 && st.cand[line.cells[p]] !== 0) {
      let q = p;
      while (q < n && (st.cand[line.cells[q]] & 1) === 0) q++;
      const leftBlank = p === 0 || st.cand[line.cells[p - 1]] === 1;
      const rightBlank = q === n || st.cand[line.cells[q]] === 1;
      if (!leftBlank || !rightBlank) return null;   // some boundary undecided
      runs.push([p, q]);
      p = q;
    } else if (st.cand[line.cells[p]] === 1) p++;
    else return null;   // an undecided cell outside any committed run
  }
  if (runs.length !== line.clue.length) return null;
  // under ascending clues, runs cannot be mapped to indices - mark tok null so
  // callers reason with the union of all token sums instead
  if (st.variants.asc) return runs.map(([a, b]) => ({ a, b, tok: null, cells: line.cells.slice(a, b) }));
  return runs.map(([a, b], g) => ({ a, b, tok: line.clue[g], cells: line.cells.slice(a, b) }));
}

// rule: group combinations — a fully-delimited group's sum restricts its digit set
function ruleGroupCombos(st, clues) {
  for (const line of eachSumsLine(st, clues)) {
    if (!line.clue) continue;
    const n = line.cells.length;
    const maxSum = 0 + st.maxTotal;
    // find maximal runs of cells committed non-blank, delimited by committed blanks/edges
    const runs = [];
    let p = 0;
    while (p < n) {
      if ((st.cand[line.cells[p]] & 1) === 0) {
        let q = p;
        while (q < n && (st.cand[line.cells[q]] & 1) === 0) q++;
        const leftBlank = p === 0 || st.cand[line.cells[p - 1]] === 1;
        const rightBlank = q === n || st.cand[line.cells[q]] === 1;
        if (leftBlank && rightBlank) runs.push([p, q]);
        p = q;
      } else p++;
    }
    if (!runs.length) continue;
    // match runs to clue groups only when counts pin the correspondence:
    // all groups delimited -> runs.length === clue.length, in order
    if (runs.length !== line.clue.length) continue;
    // ascending clues: the run-to-token mapping is unknown, so each run may
    // take any token's sums (the asc-refined union)
    const ascUnion = st.variants.asc ? (() => { const u = new Set(); for (const s2 of lineSumSets(st, line)) for (const v of s2) u.add(v); return u; })() : null;
    for (let g = 0; g < runs.length; g++) {
      const [a, b] = runs[g], L = b - a;
      const sumSet = ascUnion || allowedSums(st, line.clue[g], maxSum);
      let fixedSum = 0, fixedPack = 0;
      const open = [];
      for (let q = a; q < b; q++) {
        const d = committedDigit(st, line.cells[q]);
        if (d) { fixedSum += st.pal[d - 1]; fixedPack += 1 << (2 * (d - 1)); } else open.push(q);
      }
      // committed cells elsewhere in the line consume multiplicity too
      for (let q = 0; q < line.cells.length; q++) {
        if (q >= a && q < b) continue;
        const d = committedDigit(st, line.cells[q]);
        if (d && ((fixedPack >> (2 * (d - 1))) & 3) < st.cnt[d - 1]) fixedPack += 1 << (2 * (d - 1));
      }
      if (!open.length) continue;
      const m = open.length;
      const elim = [];
      for (const q of open) {
        let bad = 0;
        for (let d = 1; d <= st.D; d++) {
          if (!(st.cand[line.cells[q]] & (1 << d))) continue;
          if (((fixedPack >> (2 * (d - 1))) & 3) >= st.cnt[d - 1]) { bad |= 1 << d; continue; }
          const avail = fixedPack + (1 << (2 * (d - 1)));
          let any = false;
          for (const s of sumSet) { const rem = s - fixedSum; if (comboFeasibleV(st, rem - valOf(st, d), m - 1, avail, 1)) { any = true; break; } }
          if (!any) bad |= 1 << d;
        }
        if (bad) elim.push({ q, bad });
      }
      if (!elim.length) continue;
      const sumsLabel = sumSet.size === 1 ? String([...sumSet][0]) : tokenLabel(line.clue[g]) + ' (' + (sumSet.size <= 6 ? [...sumSet].join('/') : sumSet.size + ' possible sums') + ')';
      const desc = elim.map(e => rc(st, line.cells[e.q]) + ' loses ' + digitsOf(e.bad).map(k2 => st.pal[k2 - 1]).join(', ')).join('; ');
      return { rule: 'Group combinations', cells: elim.map(e => line.cells[e.q]),
        text: line.name + '\u2019s group at ' + rc(st, line.cells[a]) + '\u2013' + rc(st, line.cells[b - 1]) + ' must sum to ' + sumsLabel + (fixedSum ? ' (already holding ' + fixedSum + ')' : '') + '; its remaining ' + m + ' cell' + (m === 1 ? '' : 's') + ' need distinct digits completing that \u2014 ' + desc + '.',
        apply() { for (const e of elim) filterCand(st, line.cells[e.q], ~e.bad); } };
    }
  }
  return null;
}

// rule: span algebra — decided row and column spans interlock over shared
// cells; enumerating the joint completions of one connected component (with
// crypto letters bound consistently across all its spans) narrows both the
// cells and the letters. This is the human \u201cadd the rows, subtract the
// columns\u201d technique.
function ruleSpanAlgebra(st, clues) {
  if (st.variants.asc) return null;   // needs the run-to-token mapping
  const maxSum = 0 + st.maxTotal;
  const spans = [];
  for (const line of eachSumsLine(st, clues)) {
    const ds = decidedSpans(st, line);
    if (!ds) continue;
    for (const sp of ds) {
      const open = sp.cells.filter(i => popc(st.cand[i]) > 1);
      if (!open.length) continue;
      let fixed = 0, fixedMask = 0;
      for (const i of sp.cells) { const d = committedDigit(st, i); if (d) { fixed += st.pal[d - 1]; fixedMask |= 1 << d; } }
      spans.push({ line, sp, open, fixed, fixedMask, sums: allowedSums(st, sp.tok, maxSum) });
    }
  }
  if (spans.length < 2) return null;
  // connected components over shared open cells
  const cellSpanIdx = new Map();
  spans.forEach((s2, k) => { for (const i of s2.open) { if (!cellSpanIdx.has(i)) cellSpanIdx.set(i, []); cellSpanIdx.get(i).push(k); } });
  const seen = new Array(spans.length).fill(false);
  for (let k0 = 0; k0 < spans.length; k0++) {
    if (seen[k0]) continue;
    const comp = [], stack = [k0];
    seen[k0] = true;
    while (stack.length) {
      const k = stack.pop();
      comp.push(k);
      for (const i of spans[k].open) for (const k2 of cellSpanIdx.get(i)) if (!seen[k2]) { seen[k2] = true; stack.push(k2); }
    }
    if (comp.length < 2) continue;
    const cells = [...new Set(comp.flatMap(k => spans[k].open))];
    if (cells.length > 8) continue;
    let prod = 1;
    for (const i of cells) prod *= popc(st.cand[i]) - ((st.cand[i] & 1) ? 1 : 0) + ((st.cand[i] & 1) ? 1 : 0);
    if (prod > 30000) continue;
    // joint enumeration: cell values from candidates (cells in a span are
    // non-blank), span sums in their sets with letters bound consistently
    const cellUnion = new Map(cells.map(i => [i, 0]));
    const letterUnion = new Int32Array(26);
    const activeL = [...new Set(comp.flatMap(k => tokenLetters(spans[k].sp.tok)))];
    const letterVal = new Int8Array(26).fill(-1);
    let digitTaken = 0, count = 0, overflow = false;
    const compSpans = comp.map(k => spans[k]);
    function checkSpans(assign, partial) {
      // recursive over the complete spans so KD's two displayed candidates can
      // branch per span; bindings accumulate into `partial` on success
      const complete = [];
      for (const s2 of compSpans) {
        let sum = s2.fixed, all = true;
        for (const i of s2.open) { if (assign.has(i)) sum += st.pal[assign.get(i) - 1]; else all = false; }
        if (all) complete.push({ s2, sum });
      }
      function tryBind(idx) {
        if (idx === complete.length) return true;
        const { s2, sum } = complete[idx];
        const p2 = tokenParse(s2.sp.tok, st);
        for (const dv of displayedOptions(st, sum)) {
          if (p2.exact !== undefined) { if (p2.exact !== dv) continue; if (tryBind(idx + 1)) return true; continue; }
          if (p2.any) { if (tryBind(idx + 1)) return true; continue; }
          if (!dvSignOk(p2, dv)) continue;
          const dsx = digitsOfValueB(Math.abs(dv), baseList(st)[0]);
          if (dsx.length !== p2.chars.length) continue;
          const bound = [];
          let ok2 = true;
          for (let q = 0; q < dsx.length && ok2; q++) {
            const ch = p2.chars[q], d = dsx[q];
            if (ch.d !== undefined) { if (ch.d !== d) ok2 = false; }
            else if (ch.L !== undefined) {
              if (letterVal[ch.L] >= 0) { if (letterVal[ch.L] !== d) ok2 = false; }
              else if ((digitTaken & (1 << d)) || !(st.letterCand[ch.L] & (1 << d))) ok2 = false;
              else { letterVal[ch.L] = d; digitTaken |= 1 << d; bound.push(ch.L); }
            }
          }
          if (ok2 && tryBind(idx + 1)) { partial.push(...bound); return true; }
          for (const L of bound) { digitTaken &= ~(1 << letterVal[L]); letterVal[L] = -1; }
        }
        return false;
      }
      return tryBind(0);
    }
    const assign = new Map();
    const saBases = st.alien ? baseList(st) : [10];
    for (const saB of saBases) {
    if (st.alien) st.__forceBase = saB;
    (function rec(idx) {
      if (overflow || count > 20000) { overflow = count > 20000; return; }
      if (idx === cells.length) {
        count++;
        for (const [i, v] of assign) cellUnion.set(i, cellUnion.get(i) | (1 << v));
        for (const L of activeL) if (letterVal[L] >= 0) letterUnion[L] |= 1 << letterVal[L];
        return;
      }
      const i = cells[idx];
      for (let d = 1; d <= st.D; d++) {
        if (!(st.cand[i] & (1 << d))) continue;
        // in-line multiplicity against committed cells and other comp cells
        const r = (i / st.C) | 0, c = i % st.C;
        let inRow = 0, inCol = 0;
        for (const [j, v] of assign) if (v === d) { if (((j / st.C) | 0) === r) inRow++; if ((j % st.C) === c) inCol++; }
        for (let c2 = 0; c2 < st.C; c2++) { const j = r * st.C + c2; if (j !== i && committedDigit(st, j) === d) inRow++; }
        for (let r2 = 0; r2 < st.R; r2++) { const j = r2 * st.C + c; if (j !== i && committedDigit(st, j) === d) inCol++; }
        if (inRow >= st.cnt[d - 1] || inCol >= st.cnt[d - 1]) continue;
        assign.set(i, d);
        const bound = [];
        if (checkSpans(assign, bound)) rec(idx + 1);
        for (const L of bound) { digitTaken &= ~(1 << letterVal[L]); letterVal[L] = -1; }
        assign.delete(i);
      }
    })(0);
    if (st.alien) st.__forceBase = undefined;
    }
    if (overflow || count === 0) {
      if (count === 0 && !overflow) return { rule: 'Span algebra', contradiction: true, cells,
        text: 'The interlocking groups over ' + cells.map(i => rc(st, i)).join(', ') + ' admit no joint completion \u2014 the position is contradictory.' };
      continue;
    }
    const cellHits = [], letterHits = [];
    for (const i of cells) { const nm = st.cand[i] & (cellUnion.get(i) | 0); if (nm !== st.cand[i] && nm !== 0) cellHits.push({ i, nm }); }
    for (const L of activeL) { const nm = st.letterCand[L] & letterUnion[L]; if (letterUnion[L] && nm !== st.letterCand[L] && nm !== 0) letterHits.push({ L, nm }); }
    if (!cellHits.length && !letterHits.length) continue;
    const spanDesc = compSpans.map(s2 => s2.line.name.toLowerCase() + '\u2019s \u201c' + tokenLabel(s2.sp.tok) + '\u201d (' + rc(st, s2.sp.cells[0]) + '\u2013' + rc(st, s2.sp.cells[s2.sp.cells.length - 1]) + ')').join(', ');
    const bits = [];
    if (letterHits.length) bits.push(letterHits.map(h2 => String.fromCharCode(65 + h2.L) + ' = ' + digitsOf2(h2.nm).join('/')).join('; '));
    if (cellHits.length) bits.push(cellHits.slice(0, 5).map(h2 => rc(st, h2.i) + ' = ' + digitsOf(h2.nm).map(k2 => st.pal[k2 - 1]).join('/')).join('; ') + (cellHits.length > 5 ? '; \u2026' : ''));
    return { rule: 'Span algebra', cells: cellHits.map(h2 => h2.i),
      text: 'The groups ' + spanDesc + ' interlock over the cells ' + cells.map(i => rc(st, i)).join(', ') + ' \u2014 summing the row groups must equal summing the column groups over the same cells. Every joint completion agrees: ' + bits.join('; ') + '.',
      apply() {
        for (const h2 of cellHits) filterCand(st, h2.i, h2.nm);
        for (const h2 of letterHits) filterLetter(st, h2.L, h2.nm);
      } };
  }
  return null;
}

// rule: line analysis — exact enumeration of one line's assignments
function ruleLineAnalysis(st, clues) {
  if (st.fastLadder) return null;
  for (const line of eachSumsLine(st, clues)) {
    if (!line.clue) continue;
    const res = cachedLineUnion(st, clues, line);
    if (!res) continue;
    if (st.alien && res.deadBases && res.deadBases.length) {
      const dead = res.deadBases.filter(b => st.baseCand.has(b));
      if (dead.length) {
        if (dead.length >= st.baseCand.size) return { rule: 'Base deduction', contradiction: true, cells: line.cells.slice(),
          text: 'No candidate base lets ' + line.name.toLowerCase() + ' be completed at all \u2014 the position is contradictory.' };
        const keep = new Set([...st.baseCand].filter(b => !dead.includes(b)));
        return { rule: 'Base deduction', cells: [],
          text: 'If the base were ' + dead.join(' or ') + ', ' + line.name.toLowerCase() + ' could not be completed at all (no arrangement matches its clue) \u2014 so the base is ' + [...keep].sort((a, b) => a - b).join('/') + '.',
          apply() { filterBase(st, keep); } };
      }
    }
    const union = res.union;
    const targets = [];
    for (let p = 0; p < line.cells.length; p++) {
      const i = line.cells[p];
      const nm = st.cand[i] & union[p];
      if (nm === 0) return { rule: 'Line analysis', contradiction: true, cells: [i],
        text: 'No way to complete ' + line.name.toLowerCase() + ' matches its clue at ' + rc(st, i) + ' \u2014 the position is contradictory.' };
      if (nm !== st.cand[i]) targets.push({ i, nm });
    }
    if (!targets.length) continue;
    const bits = targets.slice(0, 6).map(t => {
      const lost = st.cand[t.i] & ~t.nm;
      const parts = [];
      if (lost & 1) parts.push('blank');
      const ds = digitsOf(lost).map(k2 => st.pal[k2 - 1]); if (ds.length) parts.push(ds.join(', '));
      return rc(st, t.i) + ' loses ' + parts.join(' and ');
    });
    return { rule: 'Line analysis', cells: targets.map(t => t.i),
      text: 'Every way to fill ' + line.name.toLowerCase() + ' that meets its clue and the digits placed so far was checked, one line in isolation. In all of them: ' + bits.join('; ') + (targets.length > 6 ? '; and ' + (targets.length - 6) + ' more cells narrow' : '') + '.',
      apply() { for (const t of targets) filterCand(st, t.i, t.nm); } };
  }
  return null;
}

// rule: letter deduction — the sums a clue group can actually achieve, from
// exact line enumeration, pin the decimal digits its letters can stand for
function ruleLetterDeduction(st, clues) { return letterDeductionCore(st, clues, false); }
// zero-cost early pass: announce letter resolutions the moment a line's exact
// enumeration (already computed by Line analysis) pins them - never enumerates
function ruleLetterEcho(st, clues) { return letterDeductionCore(st, clues, true); }
function letterDeductionCore(st, clues, peekOnly) {
  if (st.fastLadder) return null;
  for (const line of eachSumsLine(st, clues)) {
    if (!line.clue) continue;
    let hasLetters = false;
    for (const tok of line.clue) if (tokenLetters(tok).length) hasLetters = true;
    if (!hasLetters) continue;
    const res = cachedLineUnion(st, clues, line, peekOnly);
    if (!res) continue;
    for (let g = 0; g < line.clue.length; g++) {
      const p2 = tokenParse(line.clue[g], st);
      if (!p2.chars || !p2.chars.some(ch => ch.L !== undefined)) continue;
      const sums = res.gSums[g];
      if (!sums.size) continue;
      // per character position: digits actually achieved
      const seen = p2.chars.map(() => 0);
      for (const s of sums) accumulateSeen(st, p2, s, seen);
      const hits = [];
      for (let q = 0; q < p2.chars.length; q++) {
        const ch = p2.chars[q];
        if (ch.L === undefined) continue;
        const nm = st.letterCand[ch.L] & seen[q];
        if (nm !== st.letterCand[ch.L] && nm !== 0) hits.push({ L: ch.L, nm });
        if (nm === 0) return { rule: 'Letter deduction', contradiction: true, cells: [],
          text: 'No achievable sum for ' + line.name.toLowerCase() + '\u2019s group \u201c' + tokenLabel(line.clue[g]) + '\u201d matches any remaining digit for letter ' + String.fromCharCode(65 + ch.L) + ' \u2014 the position is contradictory.' };
      }
      if (!hits.length) continue;
      const sumsTxt = sums.size <= 6 ? [...sums].join(', ') : sums.size + ' values';
      const desc = hits.map(h2 => String.fromCharCode(65 + h2.L) + ' = ' + digitsOf2(h2.nm).join('/')).join('; ');
      return { rule: 'Letter deduction', cells: [],
        text: line.name + '\u2019s group \u201c' + tokenLabel(line.clue[g]) + '\u201d can only reach ' + (sums.size === 1 ? 'the sum ' : 'sums ') + sumsTxt + ' given the current grid \u2014 so ' + desc + '.',
        apply() { for (const h2 of hits) filterLetter(st, h2.L, h2.nm); } };
    }
  }
  return null;
}
function digitsOf2(mask) { const a = []; for (let d = 0; d <= 30; d++) if (mask & (1 << d)) a.push(d); return a; }

// rule: letter uniqueness — two crypto letters never share a digit
function ruleLetterUniqueness(st, clues) {
  const active = [];
  for (const line of eachSumsLine(st, clues)) for (const tok of line.clue || []) for (const L of tokenLetters(tok)) if (!active.includes(L)) active.push(L);
  for (const L of active) {
    if (popc(st.letterCand[L]) !== 1) continue;
    const d = digitsOf2(st.letterCand[L])[0];
    const hits = active.filter(L2 => L2 !== L && (st.letterCand[L2] & (1 << d)));
    if (!hits.length) continue;
    return { rule: 'Letter uniqueness', cells: [],
      text: 'Letter ' + String.fromCharCode(65 + L) + ' stands for ' + d + ', and every crypto letter takes a different digit \u2014 ' + hits.map(L2 => String.fromCharCode(65 + L2)).join(', ') + ' cannot be ' + d + '.',
      apply() { for (const L2 of hits) filterLetter(st, L2, ~(1 << d)); } };
  }
  return null;
}

// rule: cell trial — hypothesise a value at a nearly-decided cell and follow
// the quick consequences; a contradiction eliminates it (chain shown)
function cellTrialCore(st, clues, fastTier) {
  if (st.noTrial) return null;
  const N = st.R * st.C;
  const big = st.R * st.C >= 100;
  // letter trials first: a cipher letter down to 2-3 digits is a natural
  // hypothesis, and a quick contradiction removes the digit for good
  const act = activeLetterIds(clues).filter(L => popc(st.letterCand[L]) >= 2 && popc(st.letterCand[L]) <= 4);
  act.sort((a, b) => popc(st.letterCand[a]) - popc(st.letterCand[b]));
  const hyps = [];
  for (const L of act) for (const d of digitsOf2(st.letterCand[L])) hyps.push({ L, d });
  const tierL = fastTier
    ? { fast: true, deadline: Date.now() + 3000, steps: 20, list: hyps }
    : { fast: false, deadline: Date.now() + (big ? 60000 : 8000), steps: 50, list: hyps };
  for (const { L, d } of tierL.list) {
    if (Date.now() > tierL.deadline) break;
    const res = ghostRun(st, clues, g => filterLetter(g, L, 1 << d), tierL.fast, tierL.steps);
    if (!res.dead || !res.chain.length) continue;
    const contra = res.chain[res.chain.length - 1];
    if (!contra.contradiction) continue;
    const name = String.fromCharCode(65 + L);
    return { rule: 'Letter trial', cells: [], chain: res.chain,
      chainIntro: 'Suppose letter ' + name + ' stood for ' + d + '. Then:',
      chainOutro: 'So ' + name + ' is <b>not ' + d + '</b>.',
      text: 'Suppose ' + name + ' stood for ' + d + ': it fails after ' + res.chain.length + ' step' + (res.chain.length === 1 ? '' : 's') + ' \u2014 ' + contra.text + ' So ' + name + ' is not ' + d + '.',
      apply() { filterLetter(st, L, ~(1 << d)); } };
  }
  const cands = [];
  for (let i = 0; i < N; i++) {
    const pc = popc(st.cand[i]);
    if (pc >= 2 && pc <= 3) cands.push(i);
  }
  cands.sort((a, b) => popc(st.cand[a]) - popc(st.cand[b]));
  const tier = fastTier
    ? { fast: true, deadline: Date.now() + (big ? 15000 : 3000), steps: 20, list: cands.slice(0, 80) }
    : { fast: false, deadline: Date.now() + (big ? 30000 : 8000), steps: 40, list: cands.slice(0, 24) };
  for (const i of tier.list) {
    if (Date.now() > tier.deadline) break;
    for (let v = 0; v <= st.D; v++) {
      if (!(st.cand[i] & (1 << v))) continue;
      const res = ghostRun(st, clues, g => filterCand(g, i, 1 << v), tier.fast, tier.steps);
      if (!res.dead || !res.chain.length) continue;
      const contra = res.chain[res.chain.length - 1];
      if (!contra.contradiction) continue;
      const what = v === 0 ? 'blank' : 'a ' + v;
      return { rule: 'Cell trial', cells: [i], chain: res.chain,
        chainIntro: 'Suppose ' + rc(st, i) + ' were ' + what + '. Then:',
        chainOutro: 'So ' + rc(st, i) + ' is <b>not ' + what + '</b>.',
        text: 'Suppose ' + rc(st, i) + ' were ' + what + ': it fails after ' + res.chain.length + ' step' + (res.chain.length === 1 ? '' : 's') + ' \u2014 ' + contra.text + ' So ' + rc(st, i) + ' is not ' + what + '.',
        apply() { filterCand(st, i, ~(1 << v)); } };
    }
  }
  return null;
}
function ruleCellTrialFast(st, clues) { return cellTrialCore(st, clues, true); }
function ruleCellTrialFull(st, clues) { return cellTrialCore(st, clues, false); }

// rule (alien): base bounds — arithmetic on the unknown base: every written
// digit is below it, distinct letters need distinct digits, a k-digit numeral
// is worth at least base^(k-1), and every clue must stay within the line's
// value budget under each surviving base
function ruleBaseBounds(st, clues) {
  if (!st.alien) return null;
  ensureBaseCand(st, clues);
  const bases = [...st.baseCand].sort((a, b) => a - b);
  if (!st.__baseNarrated) {
    // narrate the opening bounds once
    let maxDigit = 0, maxLen = 1;
    const letterSet = new Set();
    for (const list of (clues.rows || []).concat(clues.cols || [])) {
      if (!list) continue;
      for (const tok of list) {
        const p = tokenParse(tok, st);
        if (!p.chars) continue;
        maxLen = Math.max(maxLen, p.chars.length);
        for (const ch of p.chars) { if (ch.d !== undefined) maxDigit = Math.max(maxDigit, ch.d); if (ch.L !== undefined) letterSet.add(ch.L); }
      }
    }
    const lo = bases[0], hi = bases[bases.length - 1];
    const parts = [];
    if (letterSet.size >= 2) parts.push('the ' + letterSet.size + ' distinct letters need ' + letterSet.size + ' different digits, so the base is at least ' + letterSet.size);
    if (maxDigit + 1 > letterSet.size && maxDigit > 1) parts.push('the digit ' + maxDigit + ' appears, so the base is at least ' + (maxDigit + 1));
    if (maxLen >= 2) parts.push('a ' + maxLen + '-digit numeral is worth at least base' + (maxLen === 2 ? '' : '^' + (maxLen - 1)) + ', which must stay within the largest possible sum ' + (st.maxTotal + (st.kd ? 1 : 0)));
    parts.push('(bases beyond 31 are outside this solver\u2019s range)');
    return { rule: 'Base bounds', cells: [],
      text: 'The clues are written in an unknown number base: ' + parts.join('; ') + ' \u2014 the base is ' + (lo === hi ? lo : lo + '\u2013' + hi) + '.',
      apply() { st.__baseNarrated = true; } };
  }
  // self-healing floors: the syntactic bounds are re-derived from the CURRENT
  // clues, so a base range initialised before the clues were complete (or
  // loaded from elsewhere) still gets floored correctly, with narration
  {
    let maxDigit = 0, maxLen = 1;
    const letterSet = new Set();
    for (const list of (clues.rows || []).concat(clues.cols || [])) {
      if (!list) continue;
      for (const tok of list) {
        const p = tokenParse(tok, st);
        if (!p.chars) continue;
        maxLen = Math.max(maxLen, p.chars.length);
        for (const ch of p.chars) { if (ch.d !== undefined) maxDigit = Math.max(maxDigit, ch.d); if (ch.L !== undefined) letterSet.add(ch.L); }
      }
    }
    if (bases[0] < letterSet.size) {
      const keep = new Set(bases.filter(b => b >= letterSet.size));
      return { rule: 'Base bounds', cells: [],
        text: 'The ' + letterSet.size + ' distinct letters need ' + letterSet.size + ' different digits, all below the base \u2014 the base is at least ' + letterSet.size + '.',
        apply() { filterBase(st, keep); } };
    }
    if (bases[0] <= maxDigit) {
      const keep = new Set(bases.filter(b => b > maxDigit));
      return { rule: 'Base bounds', cells: [],
        text: 'The digit ' + maxDigit + ' appears in the clues, and every written digit is below the base \u2014 the base is at least ' + (maxDigit + 1) + '.',
        apply() { filterBase(st, keep); } };
    }
    const cap = st.maxTotal + (st.kd ? 1 : 0);
    if (maxLen >= 2 && Math.pow(bases[bases.length - 1], maxLen - 1) > cap) {
      const keep = new Set(bases.filter(b => Math.pow(b, maxLen - 1) <= cap));
      if (keep.size < bases.length) return { rule: 'Base bounds', cells: [],
        text: 'A ' + maxLen + '-digit numeral is worth at least base' + (maxLen === 2 ? '' : '^' + (maxLen - 1)) + ', which must stay within the largest possible sum ' + cap + ' \u2014 the base is at most ' + Math.max(...keep) + '.',
        apply() { filterBase(st, keep); } };
    }
  }
  // letters stand for digits below the base
  const maxB = bases[bases.length - 1];
  const capMask = maxB >= 31 ? 0x7FFFFFFF : (1 << maxB) - 1;
  for (const L of activeLetterIds(clues)) {
    if (st.letterCand[L] & ~capMask) {
      const lost = digitsOf2(st.letterCand[L] & ~capMask);
      return { rule: 'Base bounds', cells: [],
        text: 'The base is at most ' + maxB + ' and every letter stands for a digit below the base \u2014 ' + String.fromCharCode(65 + L) + ' cannot be ' + lost.join('/') + '.',
        apply() { filterLetter(st, L, capMask); } };
    }
    // a letter whose smallest remaining digit is k forces base > k
    const ds = digitsOf2(st.letterCand[L]);
    const minD = ds[0];
    if (bases[0] <= minD) {
      const keep = new Set(bases.filter(b => b > minD));
      return { rule: 'Base bounds', cells: [],
        text: 'Letter ' + String.fromCharCode(65 + L) + ' stands for a digit of at least ' + minD + ', and digits are below the base \u2014 the base is at least ' + (minD + 1) + '.',
        apply() { filterBase(st, keep); } };
    }
  }
  // per-base value budgets: under base b every token needs a possible sum;
  // all the bases the same line/token rules out fall in one step
  if (bases.length >= 2) {
    for (const b of bases) {
      st.__forceBase = b;
      let bad = null;
      for (const line of eachSumsLine(st, clues)) {
        if (!line.clue || !line.clue.length) continue;
        const sets = lineSumSets(st, line);
        const g = sets.findIndex(s2 => !s2.size);
        if (g >= 0) { bad = { line, g }; break; }
      }
      st.__forceBase = undefined;
      if (bad) {
        const dead = [b];
        for (const b2 of bases) {
          if (b2 === b) continue;
          st.__forceBase = b2;
          const sets2 = lineSumSets(st, bad.line);
          st.__forceBase = undefined;
          if (!sets2[bad.g].size) dead.push(b2);
        }
        dead.sort((a2, b2) => a2 - b2);
        const keep = new Set(bases.filter(b2 => !dead.includes(b2)));
        const deadTxt = dead.length === 1 ? String(dead[0]) : (dead.every((d2, q) => q === 0 || d2 === dead[q - 1] + 1) ? dead[0] + '\u2013' + dead[dead.length - 1] : dead.join('/'));
        return { rule: 'Base bounds', cells: [],
          text: 'If the base were ' + deadTxt + ', ' + bad.line.name.toLowerCase() + '\u2019s group \u201c' + tokenLabel(bad.line.clue[bad.g]) + '\u201d could take no possible sum within the line\u2019s budget \u2014 the base is ' + [...keep].sort((a2, b2) => a2 - b2).join('/') + '.',
          apply() { filterBase(st, keep); } };
      }
    }
  }
  return null;
}

// rule (alien): base trial — suppose the base were one of its candidates and
// follow the quick consequences; a contradiction removes that base
function baseTrialCore(st, clues, fastTier) {
  if (!st.alien || st.noTrial || !st.baseCand || st.baseCand.size < 2 || st.baseCand.size > 12) return null;
  const bases = [...st.baseCand].sort((a, b) => a - b);
  const big = st.R * st.C >= 100;
  const tier = fastTier
    ? { fast: true, deadline: Date.now() + 4000, steps: 16 }
    : { fast: false, deadline: Date.now() + (big ? 60000 : 8000), steps: 30 };
  for (const b of bases) {
    if (Date.now() > tier.deadline) break;
    const capMask = b >= 31 ? 0x7FFFFFFF : (1 << b) - 1;
    const res = ghostRun(st, clues, g => { filterBase(g, new Set([b])); for (const L of activeLetterIds(clues)) filterLetter(g, L, capMask); }, tier.fast, tier.steps);
    if (!res.dead || !res.chain.length) continue;
    const contra = res.chain[res.chain.length - 1];
    if (!contra.contradiction) continue;
    return { rule: 'Base trial', cells: [], chain: res.chain,
      chainIntro: 'Suppose the base were ' + b + '. Then:',
      chainOutro: 'So the base is <b>not ' + b + '</b>.',
      text: 'Suppose the base were ' + b + ': it fails after ' + res.chain.length + ' step' + (res.chain.length === 1 ? '' : 's') + ' \u2014 ' + contra.text + ' So the base is not ' + b + '.',
      apply() { filterBase(st, new Set(bases.filter(b2 => b2 !== b))); } };
  }
  return null;
}
function ruleBaseTrialFast(st, clues) { return baseTrialCore(st, clues, true); }
function ruleBaseTrialFull(st, clues) { return baseTrialCore(st, clues, false); }

// hypothesise on a clone and follow the ladder a few steps; returns the ghost,
// the narrated chain, and whether the hypothesis died in a contradiction
function ghostRun(st, clues, hyp, fast, maxSteps) {
  const g = cloneSumsState(st);
  g.fastLadder = fast; g.noTrial = true;
  // Keep each hypothetical branch's exact-line cache private.  Sharing was
  // logically safe, but on a large open grid dozens of abandoned branches
  // accumulated thousands of heavyweight line unions in the parent cache.
  // A private cache is released with the branch and makes repeated human
  // trials predictable instead of memory-spiky.
  g.__lineCache = new Map();
  try { hyp(g); } catch (e) { return { dead: true, chain: [], g: null }; }
  const chain = [];
  for (let k = 0; k < maxSteps; k++) {
    let mv = null;
    try { mv = takeSumsStep(g, clues); } catch (e) { break; }
    if (!mv) break;
    chain.push(mv);
    if (mv.contradiction) return { dead: true, chain, g };
  }
  return { dead: false, chain, g };
}

// undecided cells ordered the way a human scans: next to a committed blank
// first (where does this shaded region escape?), then next to a committed
// digit, then the rest — each class in reading order
function shadeTrialOrder(st, minPop) {
  const N = st.R * st.C;
  const frontierBlank = [], frontierDigit = [], rest = [];
  for (let i = 0; i < N; i++) {
    const m = st.cand[i];
    if (!(m & 1) || !(m & ~1)) continue;   // must be undecided both ways
    if (popc(m) < minPop) continue;
    let nearBlank = false, nearDigit = false;
    for (const j of orthNeighbors(st, i)) {
      if (st.cand[j] === 1) nearBlank = true;
      else if ((st.cand[j] & 1) === 0) nearDigit = true;
    }
    (nearBlank ? frontierBlank : nearDigit ? frontierDigit : rest).push(i);
  }
  return frontierBlank.concat(frontierDigit, rest);
}

// rule: shading trial — suppose an undecided cell held a digit (or was
// shaded blank) without fixing which digit; quick consequences; a
// contradiction decides the cell's shading (chain shown)
function shadeTrialCore(st, clues, fastTier) {
  if (st.noTrial) return null;
  // popc >= 4 leaves the nearly-decided cells to Cell trial's finer hypotheses
  const cells = shadeTrialOrder(st, 4);
  if (!cells.length) return null;
  const big = st.R * st.C >= 100;
  const tiers = fastTier
    ? [{ fast: true, deadline: Date.now() + (big ? 15000 : 4000), steps: big ? 24 : 16, list: cells }]
    : [{ fast: false, deadline: Date.now() + (big ? 30000 : 8000), steps: 24, list: cells.slice(0, 24) }];
  for (const tier of tiers) {
    for (const i of tier.list) {
      if (Date.now() > tier.deadline) break;
      for (const used of [true, false]) {
        const what = used ? 'held a digit' : 'were shaded blank';
        const res = ghostRun(st, clues, g => filterCand(g, i, used ? ~1 : 1), tier.fast, tier.steps);
        if (!res.dead || !res.chain.length) continue;
        const contra = res.chain[res.chain.length - 1];
        return { rule: 'Shading trial', cells: [i], chain: res.chain,
          chainIntro: 'Suppose ' + rc(st, i) + ' ' + what + '. Then:',
          chainOutro: 'So ' + rc(st, i) + ' is <b>' + (used ? 'shaded blank' : 'a digit') + '</b>.',
          text: 'Suppose ' + rc(st, i) + ' ' + what + ': it fails after ' + res.chain.length + ' step' + (res.chain.length === 1 ? '' : 's') + ' \u2014 ' + contra.text + ' So ' + rc(st, i) + ' ' + (used ? 'is shaded blank' : 'holds a digit') + '.',
          apply() { filterCand(st, i, used ? 1 : ~1); } };
      }
    }
  }
  return null;
}
function ruleShadeTrialFast(st, clues) { return shadeTrialCore(st, clues, true); }
function ruleShadeTrialFull(st, clues) { return shadeTrialCore(st, clues, false); }

// rule: case analysis — a binary split (a two-candidate cell, an undecided
// cell's shaded-vs-digit dichotomy, or a two-digit letter) is followed a few
// steps in BOTH cases; whatever every case agrees on is true outright.
// One case dying is the classic trial; both dying is a contradiction.
function caseMergeCore(st, clues, fastTier) {
  if (st.noTrial) return null;
  const N = st.R * st.C;
  const hyps = [];
  // two-candidate cells: the split is the two values themselves
  for (let i = 0; i < N; i++) {
    if (popc(st.cand[i]) !== 2) continue;
    const parts = [];
    if (st.cand[i] & 1) parts.push({ mask: 1, label: 'shaded blank' });
    for (const k of digitsOf(st.cand[i])) parts.push({ mask: 1 << k, label: 'a ' + st.pal[k - 1] });
    hyps.push({ kind: 'cell', i, parts, what: rc(st, i) + ' is either ' + parts[0].label + ' or ' + parts[1].label });
  }
  // undecided cells split shaded-vs-digit (frontier cells first)
  for (const i of shadeTrialOrder(st, 4)) {
    hyps.push({ kind: 'cell', i, parts: [{ mask: 1, label: 'shaded blank' }, { mask: ~1, label: 'a digit' }],
      what: rc(st, i) + ' is either shaded blank or holds a digit' });
  }
  // two-digit letters
  for (const L of activeLetterIds(clues)) {
    if (popc(st.letterCand[L]) !== 2) continue;
    const parts = digitsOf2(st.letterCand[L]).map(d => ({ mask: 1 << d, label: String(d) }));
    hyps.push({ kind: 'letter', L, parts, what: 'letter ' + String.fromCharCode(65 + L) + ' is either ' + parts[0].label + ' or ' + parts[1].label });
  }
  // a small set of candidate bases splits the same way (n cases)
  if (st.alien && st.baseCand && st.baseCand.size >= 2 && st.baseCand.size <= 5) {
    const bs = [...st.baseCand].sort((a, b) => a - b);
    hyps.push({ kind: 'base', parts: bs.map(b => ({ b, label: 'base ' + b })),
      what: 'the base is one of ' + bs.join('/') });
  }
  if (!hyps.length) return null;
  const big = st.R * st.C >= 100;
  const tiers = fastTier
    ? [{ fast: true, deadline: Date.now() + (big ? 30000 : 4000), steps: big ? 24 : 14, list: hyps }]
    : [{ fast: false, deadline: Date.now() + (big ? 30000 : 12000), steps: 20, list: hyps.slice(0, big ? 24 : hyps.length) }];
  for (const tier of tiers) {
    for (const h of tier.list) {
      if (Date.now() > tier.deadline) break;
      const apply = (g, part) => {
        if (h.kind === 'cell') return filterCand(g, h.i, part.mask);
        if (h.kind === 'letter') return filterLetter(g, h.L, part.mask);
        const capMask = part.b >= 31 ? 0x7FFFFFFF : (1 << part.b) - 1;
        filterBase(g, new Set([part.b]));
        for (const L of activeLetterIds(clues)) filterLetter(g, L, capMask);
      };
      const runs = h.parts.map(part => ghostRun(st, clues, g => apply(g, part), tier.fast, tier.steps));
      const alive = runs.map((r, q) => ({ r, q })).filter(x => !x.r.dead);
      const commit = part => {
        if (h.kind === 'cell') filterCand(st, h.i, part.mask);
        else if (h.kind === 'letter') filterLetter(st, h.L, part.mask);
        else filterBase(st, new Set([part.b]));
      };
      const who = h.kind === 'cell' ? rc(st, h.i) : h.kind === 'letter' ? 'letter ' + String.fromCharCode(65 + h.L) : 'the base';
      if (alive.length === 0) {
        return { rule: 'Case analysis', contradiction: true, cells: h.kind === 'cell' ? [h.i] : [],
          text: h.what + ', but every case fails \u2014 the position is contradictory.' };
      }
      if (alive.length === 1) {
        // classic trial: the sole survivor is committed
        const deadIdx = runs.findIndex(r => r.dead && r.chain.length);
        const live = h.parts[alive[0].q];
        if (deadIdx < 0) {
          return { rule: 'Case analysis', cells: h.kind === 'cell' ? [h.i] : [],
            text: h.what + ', but every other case is immediately impossible \u2014 so it is ' + live.label + '.',
            apply() { commit(live); } };
        }
        const dead = runs[deadIdx];
        const contra = dead.chain[dead.chain.length - 1];
        const others = h.parts.length > 2 ? ' (the other cases fail too)' : '';
        return { rule: 'Case analysis', cells: h.kind === 'cell' ? [h.i] : [], chain: dead.chain,
          chainIntro: 'Suppose ' + who + ' were ' + h.parts[deadIdx].label + '. Then:',
          chainOutro: 'So ' + who + ' is <b>' + live.label + '</b>' + others + '.',
          text: 'Suppose ' + who + ' were ' + h.parts[deadIdx].label + ': it fails after ' + dead.chain.length + ' step' + (dead.chain.length === 1 ? '' : 's') + ' \u2014 ' + contra.text + ' So ' + who + ' is ' + live.label + others + '.',
          apply() { commit(live); } };
      }
      if (alive.length < h.parts.length && h.kind === 'base') {
        // some bases die outright: eliminate them, keep the survivors' merge for later
        const deadParts = h.parts.filter((p, q) => runs[q].dead);
        const firstDead = runs.find(r => r.dead && r.chain.length);
        const keep = new Set(alive.map(x => h.parts[x.q].b));
        return { rule: 'Case analysis', cells: [], chain: firstDead ? firstDead.chain : undefined,
          chainIntro: firstDead ? 'Suppose the base were ' + deadParts[0].label.replace('base ', '') + '. Then:' : undefined,
          chainOutro: firstDead ? 'So the base is <b>' + [...keep].join('/') + '</b>.' : undefined,
          text: 'Trying each candidate base a few steps: base' + (deadParts.length > 1 ? 's' : '') + ' ' + deadParts.map(p => p.label.replace('base ', '')).join(', ') + ' fail' + (deadParts.length > 1 ? '' : 's') + ' \u2014 the base is ' + [...keep].join('/') + '.',
          apply() { filterBase(st, keep); } };
      }
      // all surviving cases: merge — keep only what every case still allows
      const cellHits = [], letterHits = [];
      const relationHits = [];
      let baseHit = null;
      for (let j = 0; j < N; j++) {
        let u = 0;
        for (const x of alive) u |= x.r.g.cand[j];
        const nm = st.cand[j] & u;
        if (nm !== st.cand[j] && nm !== 0) cellHits.push({ j, nm });
      }
      for (let L = 0; L < 26; L++) {
        let u = 0;
        for (const x of alive) u |= x.r.g.letterCand[L];
        const nm = st.letterCand[L] & u;
        if (nm !== st.letterCand[L] && nm !== 0) letterHits.push({ L, nm });
      }
      if (st.alien && st.baseCand) {
        const u = new Set();
        for (const x of alive) for (const b of x.r.g.baseCand || []) u.add(b);
        const keep = new Set([...st.baseCand].filter(b => u.has(b)));
        if (keep.size && keep.size < st.baseCand.size) baseHit = keep;
      }
      if (alive.length) {
        const common = new Map((alive[0].r.g.shapeRelations || []).map(x => [relationKey(x), x]));
        for (let q = 1; q < alive.length; q++) {
          const keys = new Set((alive[q].r.g.shapeRelations || []).map(relationKey));
          for (const k of [...common.keys()]) if (!keys.has(k)) common.delete(k);
        }
        for (const x of common.values()) if (!hasShapeRelation(st, x)) relationHits.push(Object.assign({}, x));
      }
      if (!cellHits.length && !letterHits.length && !baseHit && !relationHits.length) continue;
      const bits = [];
      if (cellHits.length) bits.push(cellHits.slice(0, 6).map(t => {
        const parts = [];
        if (t.nm & 1) parts.push('blank');
        const ds = digitsOf(t.nm).map(k2 => st.pal[k2 - 1]); if (ds.length) parts.push(ds.join('/'));
        return rc(st, t.j) + ' = ' + parts.join(' or ');
      }).join('; ') + (cellHits.length > 6 ? '; and ' + (cellHits.length - 6) + ' more cells' : ''));
      if (letterHits.length) bits.push(letterHits.map(t => String.fromCharCode(65 + t.L) + ' = ' + digitsOf2(t.nm).join('/')).join('; '));
      if (baseHit) bits.push('the base = ' + [...baseHit].sort((a, b) => a - b).join('/'));
      if (relationHits.length) bits.push(relationHits.slice(0, 8).map(x => rc(st, x.a) + ' ' + (x.av ? 'number' : 'shaded') + ' \u21d2 ' + rc(st, x.b) + ' ' + (x.bv ? 'number' : 'shaded')).join('; ') + (relationHits.length > 8 ? '; and ' + (relationHits.length - 8) + ' more shape implications' : ''));
      return { rule: 'Case analysis', cells: cellHits.map(t => t.j).concat(relationHits.flatMap(x => [x.a, x.b])),
        cases: h.parts.map((part, q) => ({ intro: 'Case ' + (q + 1) + ' \u2014 ' + (h.kind === 'cell' ? rc(st, h.i) : 'letter ' + String.fromCharCode(65 + h.L)) + ' is ' + part.label + ':', chain: runs[q].chain })),
        text: h.what + ' \u2014 following each case ' + Math.max(...runs.map(r => r.chain.length)) + ' steps at most, every case agrees: ' + bits.join('; ') + '.',
        apply() {
          for (const t of cellHits) filterCand(st, t.j, t.nm);
          for (const t of letterHits) filterLetter(st, t.L, t.nm);
          if (baseHit) filterBase(st, baseHit);
          if (!st.shapeRelations) st.shapeRelations = [];
          for (const x of relationHits) st.shapeRelations.push(x);
          if (relationHits.length) st.__lineCache = new Map();
        } };
    }
  }
  return null;
}

function ruleCaseMergeFast(st, clues) { return caseMergeCore(st, clues, true); }
function ruleCaseMergeFull(st, clues) { return caseMergeCore(st, clues, false); }

// When a line has only a genuinely small handful of legal number/shaded
// layouts, a human can list those layouts rather than guessing one cell at a
// time.  Follow each layout through the quick ladder, discard contradicted
// layouts, and retain cells or shape implications shared by every survivor.
function ruleLinePatternCases(st, clues) {
  if (st.noTrial) return null;
  const big = st.R * st.C >= 100;
  const deadline = Date.now() + (big ? 90000 : 8000);
  if (!st.__lineCaseMiss) st.__lineCaseMiss = new Set();
  const choices = [];
  for (const line of eachSumsLine(st, clues)) {
    if (!line.clue) continue;
    const sh = collectLineShapes(st, line);
    if (!sh || sh.overflow || sh.patterns.length < 2 || sh.patterns.length > 8) continue;
    choices.push({ line, patterns: sh.patterns });
  }
  choices.sort((a, b) => a.patterns.length - b.patterns.length);
  for (const choice of choices) {
    if (Date.now() > deadline) break;
    const { line, patterns } = choice;
    let fp = lineShapeKey(line) + '|' + patterns.join(',') + '|';
    for (const i of line.cells) fp += st.cand[i] + ',';
    if (st.__lineCaseMiss.has(fp)) continue;
    const runs = patterns.map(mask => ghostRun(st, clues, g => {
      for (let p = 0; p < line.cells.length; p++) filterCand(g, line.cells[p], (mask & (1 << p)) ? ~1 : 1);
      if (!g.lineShapeDomains) g.lineShapeDomains = {};
      g.lineShapeDomains[lineShapeKey(line)] = [mask];
    }, big ? false : true, big ? 20 : 18));
    const alive = runs.map((r, q) => ({ r, q })).filter(x => !x.r.dead);
    if (!alive.length) return { rule: 'Line pattern cases', contradiction: true, cells: line.cells.slice(),
      text: line.name + '\u2019s ' + patterns.length + ' remaining number/shaded layouts all lead to contradictions.' };
    const cellHits = [], inLine = new Set(line.cells);
    for (let i = 0; i < st.R * st.C; i++) {
      let union = 0;
      for (const x of alive) union |= x.r.g.cand[i];
      let nm = st.cand[i] & union;
      // A small set of layouts is a human argument about this line.  Away
      // from the line, retain only shared shading conclusions; importing a
      // far-away exact digit reached twenty ghost steps later is opaque and
      // can accidentally turn this bounded shape argument into a deep solve.
      if (!inLine.has(i) && nm && nm !== st.cand[i]) {
        if (!(nm & 1)) nm = st.cand[i] & ~1;
        else if (!(nm & ~1)) nm = st.cand[i] & 1;
        else nm = st.cand[i];
      }
      if (nm && nm !== st.cand[i]) cellHits.push({ i, nm });
    }
    const common = new Map((alive[0].r.g.shapeRelations || []).map(x => [relationKey(x), x]));
    for (let q = 1; q < alive.length; q++) {
      const keys = new Set((alive[q].r.g.shapeRelations || []).map(relationKey));
      for (const k of [...common.keys()]) if (!keys.has(k)) common.delete(k);
    }
    const relationHits = [...common.values()].filter(x => !hasShapeRelation(st, x)).map(x => Object.assign({}, x));
    const survivors = alive.map(x => patterns[x.q]);
    const deadCount = patterns.length - survivors.length;
    const old = st.lineShapeDomains && st.lineShapeDomains[lineShapeKey(line)];
    const domainNarrows = deadCount > 0 && (!old || survivors.length < old.length);
    if (!domainNarrows && !cellHits.length && !relationHits.length) { st.__lineCaseMiss.add(fp); continue; }
    const label = mask => Array.from({ length: line.cells.length }, (_, p) => mask & (1 << p) ? 'N' : '\u00b7').join('');
    const bits = [];
    if (deadCount) bits.push(deadCount + ' layout' + (deadCount === 1 ? '' : 's') + ' fail' + (deadCount === 1 ? 's' : '') + ', leaving ' + survivors.length);
    if (cellHits.length) bits.push(cellHits.slice(0, 6).map(t => {
      const opts = [];
      if (t.nm & 1) opts.push('shaded');
      const vals = valuesOf(st, t.nm & ~1);
      if (vals.length) opts.push(vals.join('/'));
      return rc(st, t.i) + ' keeps ' + opts.join(' or ');
    }).join('; '));
    if (relationHits.length) bits.push(relationHits.slice(0, 6).map(x => rc(st, x.a) + ' ' + (x.av ? 'number' : 'shaded') + ' \u21d2 ' + rc(st, x.b) + ' ' + (x.bv ? 'number' : 'shaded')).join('; '));
    return { rule: 'Line pattern cases', cells: line.cells.concat(cellHits.map(t => t.i)),
      cases: patterns.map((mask, q) => ({ intro: line.name + ' layout ' + label(mask) + ':', chain: runs[q].chain })),
      text: line.name + ' has only ' + patterns.length + ' legal number/shaded layouts after its clue bounds. Following each through the ordinary line, checkerboard, and connectivity rules: ' + bits.join('; ') + '.',
      apply() {
        if (!st.lineShapeDomains) st.lineShapeDomains = {};
        st.lineShapeDomains[lineShapeKey(line)] = survivors.slice();
        for (const t of cellHits) filterCand(st, t.i, t.nm);
        if (!st.shapeRelations) st.shapeRelations = [];
        for (const x of relationHits) st.shapeRelations.push(x);
        st.__lineCache = new Map();
      } };
  }
  return null;
}

// trial rules run cheapest hypotheses first: every quick (fast-ladder) sweep
// across all hypothesis kinds precedes any deep (full-ladder) sweep
const SUMS_RULES = [ruleUniqueness, ruleBaseBounds, ruleLetterUniqueness, ruleLetterPairs, ruleNo22Blank, ruleNo22Numbers, ruleChecker, ruleShapeRelation, ruleShadedConnect, ruleShadedSpine, ruleNumConnect, ruleNumbersSpine, ruleNumbersReach, ruleBlankReach, ruleSumCap, ruleSumBounds, ruleEqualGroups, ruleDisjointSums, ruleKDOffByOne, ruleFullLine, ruleLetterEcho, ruleLinePlacements, ruleCheckerboardTransfer, ruleSumCeiling, ruleAdjacentLineLayouts, ruleGroupCombos, ruleSpanAlgebra, ruleLineAnalysis, ruleLetterDeduction, ruleLinePatternCases, ruleShadeTrialFast, ruleCellTrialFast, ruleBaseTrialFast, ruleCaseMergeFast, ruleCaseMergeFull, ruleShadeTrialFull, ruleCellTrialFull, ruleBaseTrialFull];
const SUMS_FAST = [ruleUniqueness, ruleBaseBounds, ruleLetterUniqueness, ruleLetterPairs, ruleNo22Blank, ruleNo22Numbers, ruleChecker, ruleShapeRelation, ruleShadedConnect, ruleShadedSpine, ruleNumConnect, ruleNumbersSpine, ruleNumbersReach, ruleBlankReach, ruleSumCap, ruleSumBounds, ruleEqualGroups, ruleDisjointSums, ruleKDOffByOne, ruleFullLine, ruleLinePlacements, ruleCheckerboardTransfer, ruleSumCeiling, ruleAdjacentLineLayouts, ruleGroupCombos, ruleSpanAlgebra];

// per line and clue index, the group's sum where it is already exactly
// determined by committed cells and blanks (for UI display of resolved ?/#).
// Non-ascending: decided prefix/suffix runs map to indices from either end;
// ascending: only a fully decided line maps (sorted sums to sorted indices).
function resolvedClueSums(st, clues) {
  const out = { rows: (clues.rows || []).map(cl => cl ? cl.map(() => null) : null),
                cols: (clues.cols || []).map(cl => cl ? cl.map(() => null) : null) };
  for (const line of eachSumsLine(st, clues)) {
    if (!line.clue || !line.clue.length) continue;
    const slot = (line.kind === 'row' ? out.rows : out.cols)[line.idx];
    const cellState = line.cells.map(i => {
      const m2 = st.cand[i];
      if (m2 === 1) return { blank: true };
      const ds = digitsOf(m2);
      if (!(m2 & 1) && ds.length === 1) return { val: st.pal[ds[0] - 1] };
      return { open: true };
    });
    const fullyDecided = cellState.every(s2 => !s2.open);
    if (st.variants.asc) {
      if (!fullyDecided) continue;
      const sums = [];
      let run = 0, len = 0;
      for (const s2 of cellState) { if (s2.blank) { if (len) { sums.push(run); run = 0; len = 0; } } else { run += s2.val; len++; } }
      if (len) sums.push(run);
      if (sums.length !== line.clue.length) continue;
      sums.sort((a, b) => a - b);
      for (let k = 0; k < sums.length; k++) slot[k] = sums[k];
      continue;
    }
    // prefix: completed runs from the left while cells stay decided
    let gi = 0, run = 0, len = 0;
    for (const s2 of cellState) {
      if (s2.open) { gi = -1; break; }
      if (s2.blank) { if (len) { if (gi < line.clue.length) slot[gi] = run; gi++; run = 0; len = 0; } }
      else { run += s2.val; len++; }
    }
    if (gi >= 0 && len && gi < line.clue.length) slot[gi] = run;   // line fully decided, last run
    // suffix: completed runs from the right
    let gj = line.clue.length - 1; run = 0; len = 0;
    for (let p = cellState.length - 1; p >= 0; p--) {
      const s2 = cellState[p];
      if (s2.open) break;
      if (s2.blank) { if (len) { if (gj >= 0) slot[gj] = run; gj--; run = 0; len = 0; } }
      else { run += s2.val; len++; }
    }
  }
  return out;
}

function takeSumsStep(st, clues) {
  if (st.alien && !st.baseCand) ensureBaseCand(st, clues);
  const rules = st.fastLadder ? SUMS_FAST : SUMS_RULES;
  for (const rule of rules) {
    let mv = null;
    try { mv = rule(st, clues); } catch (e) {
      return { rule: 'Contradiction', contradiction: true, cells: e.cellIdx !== undefined ? [e.cellIdx] : [], text: e.message };
    }
    if (mv) {
      if (mv.apply && !mv.contradiction) {
        try { mv.apply(); } catch (e) {
          return { rule: mv.rule, contradiction: true, cells: e.cellIdx !== undefined ? [e.cellIdx] : mv.cells, text: mv.text + ' \u2014 but applying it fails: ' + e.message };
        }
      }
      return mv;
    }
  }
  return null;
}

function sumsComplete(st) {
  for (let i = 0; i < st.R * st.C; i++) if (popc(st.cand[i]) !== 1) return false;
  return true;
}

const SUMS_STRATEGIES = [
  { name: 'Digit uniqueness', desc: 'A placed digit cannot repeat in its row or column \u2014 eliminate it from every peer cell.' },
  { name: 'Sum cap', desc: 'No group can exceed the clue\u2019s largest possible sum (under ascending clues the last token caps every group) \u2014 a committed run near the cap sheds big values from the cells that would join it.' },
  { name: 'Sum ceiling', desc: 'A positive digit contributes at least its own value to its group, so no cell in a line can use a digit larger than that line\u2019s greatest possible group sum. With ascending clues, the last clue caps every group.' },
  { name: 'Sum bounds', desc: 'A group\u2019s possible sums are capped by the line\u2019s digit budget (all its groups share the distinct digits 1\u2026D, so their sums total at most 1+2+\u2026+D) \u2014 the surviving sums pin the group\u2019s crypto letters. A two-digit group\u2019s tens letter, for instance, can never exceed the budget\u2019s tens digit.' },
  { name: 'Letter subsets', desc: 'Any k crypto letters confined to the same k digits use them all up \u2014 those digits leave every other letter (naked pairs, triples, \u2026 sextuples, sudoku-style).' },
  { name: 'Equal groups', desc: 'The same letter token appearing k times in one line means k separate digit sets with the same sum (each value within its per-line multiplicity) \u2014 sums for which that many disjoint sets don\u2019t exist, or don\u2019t fit in the line with the gaps, are impossible.' },
  { name: 'Disjoint sums', desc: 'All of a line\u2019s groups need pairwise-disjoint sets of the digits 1\u2026D, fitting in the line with gaps \u2014 a group sum no joint assignment can realise alongside the others is impossible.' },
  { name: 'Full line', desc: 'A line whose clue sums total 1+2+\u2026+D contains every digit \u2014 a digit with one home left is placed.' },
  { name: 'Line placements', desc: 'The clue\u2019s groups can only be arranged in so many ways around the blanks and digits already placed \u2014 cells filled in every arrangement carry a digit; cells blank in every arrangement are blank.' },
  { name: 'Cross-line singleton', desc: 'A tentative shaded cell can leave a one-cell group in the remaining line layouts. If that singleton would need a value already excluded by its crossing line, the tentative cell must hold a number.' },
  { name: 'Group combinations', desc: 'A fully-delimited group\u2019s sum restricts which distinct digits its open cells can hold (killer-cage style) \u2014 impossible digits are eliminated.' },
  { name: 'Span algebra', desc: 'Decided row and column groups interlocking over shared cells: summing the rows must equal summing the columns over the same region (letters bound consistently) \u2014 joint completions pin cells and letters both.' },
  { name: 'Line analysis', desc: 'One line considered in isolation: every completion consistent with its clue and the current candidates is enumerated \u2014 values no completion uses are eliminated.' },
  { name: 'Letter deduction', desc: 'The sums a clue group can actually achieve pin the decimal digits its crypto letters can stand for \u2014 impossible digits are removed from the letter\u2019s candidates.' },
  { name: 'Letter uniqueness', desc: 'Every crypto letter stands for a different digit \u2014 a solved letter\u2019s digit is removed from all other letters.' },
  { name: 'Letter trial', desc: 'Suppose a nearly-decided cipher letter stood for one of its digits and follow the quick consequences \u2014 a contradiction removes that digit, chain shown.' },
  { name: 'No 2\u00d72 shaded', variant: 'no22blank', desc: 'No 2\u00d72 block of shaded cells \u2014 three blanks in a square force the fourth cell to hold a digit.' },
  { name: 'No 2\u00d72 numbers', variant: 'no22num', desc: 'No 2\u00d72 block of digit cells \u2014 three digits in a square force the fourth cell blank.' },
  { name: 'Checkerboard', variant: 'checker', desc: 'With shaded connected and numbers touching the edge, a 2\u00d72 with blanks on one diagonal and digits on the other is impossible \u2014 two diagonal blanks beside a digit force the fourth cell blank.' },
  { name: 'Checkerboard transfer', variant: 'checker', desc: 'Compare two neighbouring lines. If every possible shaded cell in one line is flanked by numbers, while the facing line cannot contain a three-number run there, that shaded cell forces the facing cell shaded: otherwise avoiding two checkerboards would create the forbidden run.' },
  { name: 'Adjacent line layouts', variant: 'checker', desc: 'Cross-check the remaining number/shaded layouts of neighbouring rows or columns. A layout that makes a checkerboard against every layout next to it is removed; shared cells of the survivors are fixed.' },
  { name: 'Shape relation', variant: 'checker', desc: 'A previously proved shaded/number implication is used directly (or contrapositively) as soon as one endpoint is decided.' },
  { name: 'Linked line bounds', variant: 'checker', desc: 'Ordinary clue min/max and group-length bounds are combined with proved shading implications that lie within the row or column; layouts breaking either are discarded.' },
  { name: 'Shaded connected', variant: 'blankConn', desc: 'All shaded cells form one orthogonally connected group \u2014 a cell that every connection between two shaded parts must pass through is itself blank.' },
  { name: 'Numbers connected', variant: 'numConn', desc: 'All digit cells form one orthogonally connected group \u2014 a cell that every connection between two digit regions must pass through holds a digit.' },
  { name: 'Numbers spine', variant: 'numConn', desc: 'The one connected number area must meet every non-empty clued row and column, not merely the numbers already placed. Number-capable pockets that cannot meet all of them are shaded; a lone bridge shared by every route is a number.' },
  { name: 'Numbers escape', variant: 'numConn', desc: 'Each separate number run in a line must join the one connected number area through a number-capable neighbour outside that line; layouts that strand a run are impossible.' },
  { name: 'Shaded escape', variant: 'blankConn', desc: 'A line\u2019s shaded cells come in stretches, and each stretch must join the connected shaded area through a blank-capable neighbour outside the line \u2014 arrangements that seal a stretch into a pocket are impossible.' },
  { name: 'Shaded spine', variant: 'blankConn', desc: 'The one connected shaded group must place a shaded cell in every line whose clue forces one \u2014 blank-capable pockets that cannot reach such a line hold digits, and a lone bridge on every route between them is shaded.' },
  { name: 'Shaded reach edge', variant: 'blankReach', desc: 'Every connected shaded group touches the grid\u2019s edge \u2014 a shaded region\u2019s last escape route to the border stays shaded.' },
  { name: 'Numbers reach edge', variant: 'reach', desc: 'Every connected group of digit cells touches the grid\u2019s edge \u2014 a digit region\u2019s last escape route to the border must hold digits.' },
  { name: 'Base bounds', variant: 'alien', desc: 'Arithmetic on the unknown base: every written digit is below it, distinct letters need distinct digits, a k-digit numeral is worth at least base^(k\u22121), and every clue must fit its line\u2019s value budget under each surviving base.' },
  { name: 'Base deduction', variant: 'alien', desc: 'A line enumerated in isolation under one candidate base: if no completion matches its clue in that base, the base is eliminated.' },
  { name: 'Base trial', variant: 'alien', desc: 'Suppose the base were one of its candidates and follow the quick consequences \u2014 a contradiction removes that base, chain shown.' },
  { name: 'KD off-by-one', variant: 'kd', desc: 'A clue is one off its true value, so a group truly sums to clue\u22121 or clue+1 \u2014 same parity either way; a decided group\u2019s last open cell is pinned to the two completing values.' },
  { name: 'Cell trial', desc: 'Suppose one nearly-decided cell held a particular value and follow the quick consequences \u2014 a contradiction eliminates it, chain shown.' },
  { name: 'Shading trial', desc: 'Suppose an undecided cell held a digit (or was shaded), without fixing which digit, and follow the quick consequences \u2014 a contradiction decides the cell\u2019s shading, chain shown.' },
  { name: 'Case analysis', desc: 'A binary split \u2014 a two-candidate cell, an undecided cell\u2019s shaded-vs-digit dichotomy, or a two-digit letter \u2014 is followed a few steps in both cases; whatever every case agrees on is true outright, both chains shown.' },
  { name: 'Line pattern cases', desc: 'When clue min/max leaves at most eight number/shaded layouts for a line, list those human-sized cases, follow each briefly, discard contradictions, and keep any cells or implications shared by every survivor.' },
];

const api = { makeSumsState, cloneSumsState, filterCand, filterLetter, filterBase, ensureBaseCand, baseList, numeralOf, takeSumsStep, sumsComplete, eachSumsLine, committedDigit, popc, digitsOf, digitsOf2: (m) => { const a = []; for (let d = 0; d <= 30; d++) if (m & (1 << d)) a.push(d); return a; }, tokenLetters, allowedSums, SUMS_STRATEGIES };
api.resolvedClueSums = resolvedClueSums;
if (typeof module !== 'undefined') module.exports = api;
else global.sums = api;
return api;
}
sumsStepperMain(typeof self !== 'undefined' ? self : this);
