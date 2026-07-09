// Japanese Sums human-rule stepper: named deduction rules, simplest first,
// each returning a prose explanation. Mirrors the U-Bahn stepper design.
//
// State: cand[i] bitmask — bit 0 = the cell is blank, bits 1..D = digits.
(function (global) {
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
    letterCand: new Int32Array(26).fill(1023),   // digits 0-9 per crypto letter
    kd: false,   // Knapp daneben: every clue is one off its true value
    variants: { numConn: false, blankConn: false, no22num: false, no22blank: false, asc: false, reach: false },
    fastLadder: false, noTrial: false };
}
function cloneSumsState(st) {
  return { R: st.R, C: st.C, D: st.D, pal: st.pal, cnt: st.cnt, maxTotal: st.maxTotal, minTotal: st.minTotal,
    cand: Int32Array.from(st.cand),
    letterCand: Int32Array.from(st.letterCand), kd: st.kd, variants: Object.assign({}, st.variants),
    fastLadder: st.fastLadder, noTrial: st.noTrial, __lineCache: st.__lineCache };
}
function filterLetter(st, L, keepMask) {
  const nm = st.letterCand[L] & keepMask;
  if (nm === 0) { const e = new Error('no digit left for letter ' + String.fromCharCode(65 + L)); throw e; }
  st.letterCand[L] = nm;
}
// token -> the set of sums it can currently take (an OVERAPPROXIMATION for
// letter tokens: per-character candidate masks, intra-token repeats honoured)
function tokenParse(tok) {
  if (typeof tok === 'number') return { exact: tok };
  let s = String(tok).toUpperCase().trim();
  let neg = false;
  if (s[0] === '-') { neg = true; s = s.slice(1); }
  if (/^[0-9]+$/.test(s)) return { exact: (neg ? -1 : 1) * parseInt(s, 10) };
  const chars = [];
  for (const ch of s) {
    if (ch >= '0' && ch <= '9') chars.push({ d: ch.charCodeAt(0) - 48 });
    else if (ch === '#') return { any: true };
    else if (ch === '?') chars.push({ q: true });
    else if (ch >= 'A' && ch <= 'Z') chars.push({ L: ch.charCodeAt(0) - 65 });
  }
  if (!chars.length) return { any: true };
  return { chars, neg };
}
function tokenLetters(tok) {
  const p = tokenParse(tok);
  if (!p.chars) return [];
  const out = [];
  for (const ch of p.chars) if (ch.L !== undefined && !out.includes(ch.L)) out.push(ch.L);
  return out;
}
// does displayed value v match the parsed token against current letter cands?
function displayedMatch(st, p, v) {
  if (p.exact !== undefined) return v === p.exact;
  if (p.any) return true;
  if (p.neg) { if (v > 0) return false; v = -v; }
  else if (v < 0) return false;
  const n = p.chars.length;
  const lo = n === 1 ? 0 : Math.pow(10, n - 1);   // a 1-char clue may display 0 (KD)
  if (v < lo || v > Math.pow(10, n) - 1) return false;
  const ds = String(v).split('').map(Number);
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
// displayed values a TRUE sum s can show: s itself normally; s-1 and s+1 in KD
function displayedOptions(st, s) { return st.kd ? [s - 1, s + 1].filter(v => v >= 0) : [s]; }   // displayed 0 = true sum 1
const DS_CACHE = new Map();
function digitsOfValue(v) {
  let a = DS_CACHE.get(v);
  if (!a) { a = String(Math.abs(v)).split('').map(Number); if (DS_CACHE.size < 20000) DS_CACHE.set(v, a); }
  return a;
}

function allowedSums(st, tok, maxSum) {
  const p = tokenParse(tok);
  const out = new Set();
  const lo2 = Math.min(1, st.minTotal);
  for (let s = lo2; s <= maxSum; s++) {
    if (s === 0) continue;   // a group has at least one cell; sum 0 only via exact cancellation
    for (const v of displayedOptions(st, s)) if (displayedMatch(st, p, v)) { out.add(s); break; }
  }
  // a zero-sum group (exact cancellation) is only expressible as '#' or a literal 0
  if (st.minTotal < 0 && (p.any || p.exact === 0)) out.add(0);
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
      packRec(s2 + 1, used + sub.pack, leftG - 1, total + sub.cnt);
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
    if (!displayedMatch(st, p, v)) continue;
    const ds = digitsOfValue(v);
    if (ds.length !== seen.length) continue;
    for (let q = 0; q < ds.length; q++) seen[q] |= 1 << ds[q];
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
function enumerateSumsLine(st, line, onSolution, nodeCap) {
  const n = line.cells.length;
  const maxSum0 = 0 + st.maxTotal;
  const clue = line.clue ? line.clue.map(tok => allowedSums(st, tok, maxSum0)) : null;
  const clueMax = clue ? clue.map(set => { let m = 0; for (const v of set) if (v > m) m = v; return m; }) : null;
  const parsedToks = line.clue ? line.clue.map(tokenParse) : null;
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
    const ds = digitsOfValue(v);
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

// fingerprint-cached per-line assignment unions
function cachedLineUnion(st, clues, line) {
  if (!st.__lineCache) st.__lineCache = new Map();
  let h = 2166136261 >>> 0;
  for (const i of line.cells) { h ^= st.cand[i]; h = Math.imul(h, 16777619) >>> 0; }
  for (const tok of line.clue || []) for (const L of tokenLetters(tok)) { h ^= st.letterCand[L]; h = Math.imul(h, 16777619) >>> 0; }
  const key = line.kind + ':' + line.idx + ':' + h;
  if (st.__lineCache.has(key)) return st.__lineCache.get(key);
  let res = null;
  {
    const G = (line.clue || []).length;
    const n2 = line.cells.length;
    const union = new Int32Array(n2);
    const gSums = Array.from({ length: G }, () => new Set());
    let sols = 0;
    const ok = enumerateSumsLine(st, line, (vals, gs) => {
      for (let p = 0; p < vals.length; p++) union[p] |= 1 << vals[p];
      for (let g = 0; g < G; g++) gSums[g].add(gs[g]);
      // saturation: once the union matches the current masks everywhere and
      // every group has shown several sums, nothing further can be learned
      if ((++sols & 255) === 0) {
        for (let p = 0; p < n2; p++) if (union[p] !== st.cand[line.cells[p]]) return false;
        return true;
      }
      return false;
    }, 3000000);
    if (ok) res = { union, gSums };
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
      const p2 = tokenParse(line.clue[g]);
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
// means k pairwise-disjoint digit sets with the same sum; feasibility and the
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
        text: line.name + ' repeats the group \u201c' + tokStr + '\u201d ' + k + ' times, but no value allows ' + k + ' disjoint sets of digits with that sum to fit \u2014 the position is contradictory.' };
      if (!bad.length) continue;
      // map the surviving sums back to letter digits
      const p2 = tokenParse(tokStr);
      const survivors = [...set].filter(v => !bad.includes(v));
      const seen = p2.chars.map(() => 0);
      for (const s of survivors) {
        const ds = String(s).padStart(p2.chars.length, '0').split('').map(Number);
        if (ds.length === p2.chars.length) for (let q = 0; q < ds.length; q++) seen[q] |= 1 << ds[q];
      }
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
        text: line.name + ' repeats the group \u201c' + tokStr + '\u201d ' + k + ' times \u2014 that needs ' + k + ' disjoint sets of digits with the same sum, and with the other groups and gaps only sums ' + survivors.join('/') + ' leave enough room. So ' + desc + '.',
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
  const idxs = act.filter(L => popc(st.letterCand[L]) >= 2 && popc(st.letterCand[L]) <= 3);
  for (let size = 2; size <= 3; size++) {
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
        if ((st.letterCand[L] & ~union) && popc(st.letterCand[L] | union) > size) continue;
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
      return { rule: 'Letter pairs', cells: [],
        text: names.join(', ') + ' are confined to the digits ' + digs.join(', ') + ' between them \u2014 since every letter takes a different digit, ' + (size === 2 ? 'this pair uses both' : 'this triple uses all three') + ', and ' + found.hits.map(L => String.fromCharCode(65 + L)).join(', ') + ' cannot be ' + (digs.length === 2 ? 'either' : 'any of them') + '.',
        apply() { for (const L of found.hits) filterLetter(st, L, ~found.union); } };
    }
  }
  return null;
}

// exact joint feasibility of one line's groups: pairwise-disjoint digit
// subsets of 1..D realising each group's sum, within the line's cell budget
function lineJointFeasible(st, tokens, sets, n, requireVal, sizes) {
  if (st.variants.asc) return lineJointFeasibleCoral(st, tokens, sets, n, requireVal, sizes);
  // groups sharing crypto letters have correlated sums: picking a value for a
  // group binds its letters (consistently, all letters distinct), so two 'G'
  // groups must take the SAME sum and 'GH' must agree with them, etc.
  const G = sets.length;
  const maxCells = n - (G - 1);
  const lists = sets.map(s2 => [...s2].sort((a, b) => a - b));
  const parsed = tokens.map(tokenParse);
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
    const ds = digitsOfValue(dv);
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

// coral joint feasibility: tokens are ascending by index but map to spans in
// an unknown order; assign each token a value (ascending), a digit subset,
// and (when sizes are given) a distinct span slot of matching size
function lineJointFeasibleCoral(st, tokens, sets, n, requireVal, sizes) {
  const K = sets.length;
  const maxCells = n - (K - 1);
  const lists = sets.map(s2 => [...s2].sort((a, b) => a - b));
  const parsed = tokens.map(tokenParse);
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
    const ds = digitsOfValue(dv);
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
      const p2 = tokenParse(line.clue[g]);
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
        text: line.name + '\u2019s ' + line.clue.length + ' groups (' + line.clue.map(tokenLabel).join(', ') + ') need pairwise-disjoint sets of the digits 1\u2026' + st.D + ', all fitting in ' + n + ' cells with gaps between \u2014 for \u201c' + tokenLabel(line.clue[g]) + '\u201d only ' + [...surviving].join('/') + ' can be realised alongside the others. So ' + desc + '.',
        apply() { for (const h2 of hits) filterLetter(st, h2.L, h2.nm); } };
    }
  }
  return null;
}

// rule (Knapp daneben only): a decided span's off-by-one clue leaves two
// candidate sums of the same parity; a lone open cell is pinned to two values
function ruleKDOffByOne(st, clues) {
  if (!st.kd) return null;
  for (const line of eachSumsLine(st, clues)) {
    const ds = decidedSpans(st, line);
    if (!ds) continue;
    for (const sp of ds) {
      const p2 = tokenParse(sp.tok);
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

/* ---------------- coral rules ---------------- */
// helpers over the whole grid
function coralNeighbors(st, i) {
  const r = (i / st.C) | 0, c = i % st.C, out = [];
  if (r > 0) out.push(i - st.C);
  if (r < st.R - 1) out.push(i + st.C);
  if (c > 0) out.push(i - 1);
  if (c < st.C - 1) out.push(i + 1);
  return out;
}

// rule (coral): no 2x2 of blanks — three committed blanks force the fourth used
function ruleCoral2x2(st, clues) {
  if (!st.variants.no22blank) return null;
  for (let r = 0; r + 1 < st.R; r++) for (let c = 0; c + 1 < st.C; c++) {
    const cells = [r * st.C + c, r * st.C + c + 1, (r + 1) * st.C + c, (r + 1) * st.C + c + 1];
    const blanks = cells.filter(i => st.cand[i] === 1);
    if (blanks.length === 4) return { rule: 'Coral 2\u00d72', contradiction: true, cells,
      text: 'The blank cells ' + cells.map(i => rc(st, i)).join(', ') + ' form a 2\u00d72 \u2014 the coral may not contain one.' };
    if (blanks.length !== 3) continue;
    const open = cells.find(i => st.cand[i] !== 1);
    if (!(st.cand[open] & 1)) continue;
    return { rule: 'Coral 2\u00d72', cells: [open],
      text: 'Three cells of the 2\u00d72 at ' + rc(st, cells[0]) + ' are blank; the coral may not contain a 2\u00d72 of blanks, so ' + rc(st, open) + ' holds a digit.',
      apply() { filterCand(st, open, ~1); } };
  }
  return null;
}

// rule (coral): no checkerboard — a 2x2 with one diagonal blank and the other
// diagonal filled is impossible: the coral path joining the two blanks, plus
// their corner touch, closes a loop that seals one filled cell off the edge
function ruleCoralChecker(st, clues) {
  if (!(st.variants.blankConn && st.variants.reach)) return null;
  const isBlank = i => st.cand[i] === 1;
  const isUsed = i => (st.cand[i] & 1) === 0;
  for (let r = 0; r + 1 < st.R; r++) for (let c = 0; c + 1 < st.C; c++) {
    const a = r * st.C + c, b = a + 1, c2 = a + st.C, d = c2 + 1;
    for (const [p, q, u, v] of [[a, d, b, c2], [b, c2, a, d]]) {
      if (!isBlank(p) || !isBlank(q)) continue;
      if (isUsed(u) && isUsed(v)) {
        return { rule: 'Coral checkerboard', contradiction: true, cells: [a, b, c2, d],
          text: rc(st, p) + ', ' + rc(st, q) + ' are blank and ' + rc(st, u) + ', ' + rc(st, v) + ' hold digits \u2014 a checkerboard 2\u00d72 is impossible in a coral (the blanks\u2019 connection would seal one digit region off the edge).' };
      }
      for (const [w, x] of [[u, v], [v, u]]) {
        if (!isUsed(w)) continue;
        if (!(st.cand[x] & ~1) || !(st.cand[x] & 1)) continue;   // undecided both ways
        return { rule: 'Coral checkerboard', cells: [x],
          text: rc(st, p) + ' and ' + rc(st, q) + ' are blank diagonal neighbours and ' + rc(st, w) + ' holds a digit \u2014 a checkerboard 2\u00d72 is impossible in a coral, so ' + rc(st, x) + ' is blank.',
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
      for (const j of coralNeighbors(st, i)) if (!seen[j] && j !== block && canUse(j)) { seen[j] = 1; stack.push(j); }
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

// rule (coral): all blanks are orthogonally connected — a lone cut cell on
// every path between two committed-blank regions must itself be blank
function ruleCoralConnect(st, clues) {
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
      for (const j of coralNeighbors(st, i)) if (!seen[j] && j !== block && canBlank(j)) { seen[j] = 1; stack.push(j); }
    }
    return seen;
  }
  const base = reachable(-1);
  for (const i of committed) if (!base[i]) {
    return { rule: 'Coral connectivity', contradiction: true, cells: [i],
      text: 'The blank at ' + rc(st, i) + ' cannot connect to the rest of the coral \u2014 the position is contradictory.' };
  }
  // cut cells: undecided blank-capable cells whose loss disconnects the coral
  for (let i = 0; i < N; i++) {
    if (st.cand[i] === 1 || !canBlank(i)) continue;   // committed blanks are not deduction targets
    const seen = reachable(i);
    let cut = false;
    for (const j of committed) if (!seen[j]) { cut = true; break; }
    if (!cut) continue;
    return { rule: 'Coral connectivity', cells: [i],
      text: 'Every path joining the coral\u2019s parts runs through ' + rc(st, i) + ' \u2014 the coral is one connected group of blanks, so ' + rc(st, i) + ' is blank.',
      apply() { filterCand(st, i, 1); } };
  }
  return null;
}

// rule (coral): every group of digit cells touches the grid edge — a digit
// region whose only escape runs through one cell forces that cell used
function ruleCoralReach(st, clues) {
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
      for (const j of coralNeighbors(st, i)) {
        if (seen[j] || j === block || !canUse(j)) continue;
        if (onEdge(j)) return true;
        seen[j] = 1; stack.push(j);
      }
    }
    return false;
  }
  for (const i of committedUsed) {
    if (!escapes(i, -1)) {
      return { rule: 'Coral reach', contradiction: true, cells: [i],
        text: 'The digit region at ' + rc(st, i) + ' is sealed off from the edge \u2014 every group of digits must touch the grid\u2019s border.' };
    }
  }
  for (let j = 0; j < N; j++) {
    if (!canUse(j) || !(st.cand[j] & 1)) continue;   // must still allow blank, or there is nothing to deduce
    for (const i of committedUsed) {
      if (escapes(i, j)) continue;
      return { rule: 'Coral reach', cells: [j],
        text: 'The digit region at ' + rc(st, i) + ' can only reach the grid\u2019s edge through ' + rc(st, j) + ' \u2014 digit groups may not be locked in by the coral, so ' + rc(st, j) + ' holds a digit.',
        apply() { filterCand(st, j, ~1); } };
    }
  }
  return null;
}

// rule: full house — a line whose clue sums total 1+2+..+D must contain every digit
function ruleFullLine(st, clues) {
  if (st.kd) return null;   // displayed totals are off by one per group under Knapp daneben
  const fullSum = st.maxTotal + st.minTotal;   // sum of the entire palette
  for (const line of eachSumsLine(st, clues)) {
    if (!line.clue) continue;
    const parsed = line.clue.map(tokenParse);
    if (parsed.some(p => p.exact === undefined)) continue;
    const tot = parsed.reduce((a, p) => a + p.exact, 0);
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
    function place(g, from) {
      if (count > 4000) return;
      if (g === G) {
        // trailing cells must allow blank
        let last = G ? spanStart[G - 1] + spanLen[G - 1] : 0;
        for (let p = last; p < n; p++) if (!(st.cand[line.cells[p]] & 1)) return;
        // spans' lengths must be jointly realisable: pairwise-disjoint digit
        // sets of exactly these sizes, letters bound consistently
        if (G > 0) {
          const key = spanLen.join(',');
          let feas = sizeFeas.get(key);
          if (feas === undefined) { feas = lineJointFeasible(st, line.clue, tokenSets, n, null, Array.from(spanLen)); sizeFeas.set(key, feas); }
          if (!feas) return;
        }
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
      return { rule: 'Line placements', contradiction: true, cells: line.cells.slice(),
        text: 'No arrangement of ' + line.name.toLowerCase() + '\u2019s groups fits: ' + why + ' \u2014 with the required gaps and the digits still possible in its cells, they cannot all be placed.' };
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
    return { rule: 'Line placements', cells: mkFilled.concat(mkBlank).map(p => line.cells[p]),
      text: (G === 0 ? line.name + '\u2019s clue is 0 \u2014 the line holds no digits at all: ' + bits.join('; ') + '.' : line.name + '\u2019s ' + G + ' group' + (G === 1 ? '' : 's') + ' (' + line.clue.map(tokenLabel).join(', ') + '): ' + lenTxt + windowTxt + ' \u2014 ' + bits.join('; ') + '.'),
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
  if (st.variants.asc) return null;   // group order unknown: runs cannot be mapped to clue indices
  return runs.map(([a, b], g) => ({ a, b, tok: line.clue[g], cells: line.cells.slice(a, b) }));
}

// rule: group combinations — a fully-delimited group's sum restricts its digit set
function ruleGroupCombos(st, clues) {
  if (st.variants.asc) return null;   // runs cannot be matched to clue groups in order
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
    for (let g = 0; g < runs.length; g++) {
      const [a, b] = runs[g], L = b - a;
      const sumSet = allowedSums(st, line.clue[g], maxSum);
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
      const desc = elim.map(e => rc(st, line.cells[e.q]) + ' loses ' + digitsOf(e.bad).join(', ')).join('; ');
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
        const p2 = tokenParse(s2.sp.tok);
        for (const dv of displayedOptions(st, sum)) {
          if (p2.exact !== undefined) { if (p2.exact !== dv) continue; if (tryBind(idx + 1)) return true; continue; }
          if (p2.any) { if (dv >= 1 && tryBind(idx + 1)) return true; continue; }
          const dsx = String(dv).split('').map(Number);
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
    if (cellHits.length) bits.push(cellHits.slice(0, 5).map(h2 => rc(st, h2.i) + ' = ' + digitsOf(h2.nm).join('/')).join('; ') + (cellHits.length > 5 ? '; \u2026' : ''));
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
      const ds = digitsOf(lost); if (ds.length) parts.push(ds.join(', '));
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
function ruleLetterDeduction(st, clues) {
  if (st.fastLadder) return null;
  for (const line of eachSumsLine(st, clues)) {
    if (!line.clue) continue;
    let hasLetters = false;
    for (const tok of line.clue) if (tokenLetters(tok).length) hasLetters = true;
    if (!hasLetters) continue;
    const res = cachedLineUnion(st, clues, line);
    if (!res) continue;
    for (let g = 0; g < line.clue.length; g++) {
      const p2 = tokenParse(line.clue[g]);
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
function digitsOf2(mask) { const a = []; for (let d = 0; d <= 9; d++) if (mask & (1 << d)) a.push(d); return a; }

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
function ruleCellTrial(st, clues) {
  if (st.noTrial) return null;
  const N = st.R * st.C;
  // letter trials first: a cipher letter down to 2-3 digits is a natural
  // hypothesis, and a quick contradiction removes the digit for good
  const act = activeLetterIds(clues).filter(L => popc(st.letterCand[L]) >= 2 && popc(st.letterCand[L]) <= 4);
  act.sort((a, b) => popc(st.letterCand[a]) - popc(st.letterCand[b]));
  // two tiers: a cheap fast-ladder sweep over every hypothesis, then full
  // ghosts (line analysis included) with a budget that scales to the grid
  const hyps = [];
  for (const L of act) for (const d of digitsOf2(st.letterCand[L])) hyps.push({ L, d });
  const big = st.R * st.C > 100 || st.D >= 8;
  const tiers = [
    { fast: true, deadline: Date.now() + 3000, steps: 20, list: hyps },
    { fast: false, deadline: Date.now() + (big ? 60000 : 8000), steps: 50, list: hyps },
  ];
  for (const tier of tiers) {
    for (const { L, d } of tier.list) {
      if (Date.now() > tier.deadline) break;
      const ghost = cloneSumsState(st);
      ghost.fastLadder = tier.fast; ghost.noTrial = true; ghost.__lineCache = undefined;
      try { filterLetter(ghost, L, 1 << d); } catch (e) { continue; }
      const chain = [];
      let contra = null;
      for (let k = 0; k < tier.steps && !contra; k++) {
        let mv = null;
        try { mv = takeSumsStep(ghost, clues); } catch (e) { break; }
        if (!mv) break;
        chain.push(mv);
        if (mv.contradiction) contra = mv;
      }
      if (contra) {
        const name = String.fromCharCode(65 + L);
        return { rule: 'Letter trial', cells: [], chain,
          chainIntro: 'Suppose letter ' + name + ' stood for ' + d + '. Then:',
          chainOutro: 'So ' + name + ' is <b>not ' + d + '</b>.',
          text: 'Suppose ' + name + ' stood for ' + d + ': it fails after ' + chain.length + ' step' + (chain.length === 1 ? '' : 's') + ' \u2014 ' + contra.text + ' So ' + name + ' is not ' + d + '.',
          apply() { filterLetter(st, L, ~(1 << d)); } };
      }
    }
  }
  const cands = [];
  for (let i = 0; i < N; i++) {
    const pc = popc(st.cand[i]);
    if (pc >= 2 && pc <= 3) cands.push(i);
  }
  cands.sort((a, b) => popc(st.cand[a]) - popc(st.cand[b]));
  const big2 = st.R * st.C > 100 || st.D >= 8;
  const tiers2 = [
    { fast: true, deadline: Date.now() + 3000, steps: 20, list: cands.slice(0, 80) },
    { fast: false, deadline: Date.now() + (big2 ? 90000 : 8000), steps: 50, list: cands.slice(0, 24) },
  ];
  for (const tier of tiers2) {
  for (const i of tier.list) {
    if (Date.now() > tier.deadline) break;
    for (let v = 0; v <= st.D; v++) {
      if (!(st.cand[i] & (1 << v))) continue;
      const ghost = cloneSumsState(st);
      ghost.fastLadder = tier.fast; ghost.noTrial = true;
      ghost.__lineCache = undefined;
      try { filterCand(ghost, i, 1 << v); } catch (e) { continue; }
      const chain = [];
      let contra = null;
      for (let k = 0; k < tier.steps && !contra; k++) {
        let mv = null;
        try { mv = takeSumsStep(ghost, clues); } catch (e) { break; }
        if (!mv) break;
        chain.push(mv);
        if (mv.contradiction) contra = mv;
      }
      if (contra) {
        const what = v === 0 ? 'blank' : 'a ' + v;
        return { rule: 'Cell trial', cells: [i], chain,
          chainIntro: 'Suppose ' + rc(st, i) + ' were ' + what + '. Then:',
          chainOutro: 'So ' + rc(st, i) + ' is <b>not ' + what + '</b>.',
          text: 'Suppose ' + rc(st, i) + ' were ' + what + ': it fails after ' + chain.length + ' step' + (chain.length === 1 ? '' : 's') + ' \u2014 ' + contra.text + ' So ' + rc(st, i) + ' is not ' + what + '.',
          apply() { filterCand(st, i, ~(1 << v)); } };
      }
    }
  }
  }
  return null;
}

const SUMS_RULES = [ruleUniqueness, ruleLetterUniqueness, ruleLetterPairs, ruleCoral2x2, ruleNo22Numbers, ruleCoralChecker, ruleCoralConnect, ruleNumConnect, ruleCoralReach, ruleSumBounds, ruleEqualGroups, ruleDisjointSums, ruleKDOffByOne, ruleFullLine, ruleLinePlacements, ruleGroupCombos, ruleSpanAlgebra, ruleLineAnalysis, ruleLetterDeduction, ruleCellTrial];
const SUMS_FAST = [ruleUniqueness, ruleLetterUniqueness, ruleLetterPairs, ruleCoral2x2, ruleNo22Numbers, ruleCoralChecker, ruleCoralConnect, ruleNumConnect, ruleCoralReach, ruleSumBounds, ruleEqualGroups, ruleDisjointSums, ruleKDOffByOne, ruleFullLine, ruleLinePlacements, ruleGroupCombos, ruleSpanAlgebra];

function takeSumsStep(st, clues) {
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
  { name: 'Sum bounds', desc: 'A group\u2019s possible sums are capped by the line\u2019s digit budget (all its groups share the distinct digits 1\u2026D, so their sums total at most 1+2+\u2026+D) \u2014 the surviving sums pin the group\u2019s crypto letters. A two-digit group\u2019s tens letter, for instance, can never exceed the budget\u2019s tens digit.' },
  { name: 'Letter pairs', desc: 'Two (or three) crypto letters confined to the same two (or three) digits use them all up \u2014 those digits leave every other letter (naked pairs, sudoku-style).' },
  { name: 'Equal groups', desc: 'The same letter token appearing k times in one line means k pairwise-disjoint digit sets with the same sum \u2014 sums for which that many disjoint sets don\u2019t exist, or don\u2019t fit in the line with the gaps, are impossible.' },
  { name: 'Disjoint sums', desc: 'All of a line\u2019s groups need pairwise-disjoint sets of the digits 1\u2026D, fitting in the line with gaps \u2014 a group sum no joint assignment can realise alongside the others is impossible.' },
  { name: 'Full line', desc: 'A line whose clue sums total 1+2+\u2026+D contains every digit \u2014 a digit with one home left is placed.' },
  { name: 'Line placements', desc: 'The clue\u2019s groups can only be arranged in so many ways around the blanks and digits already placed \u2014 cells filled in every arrangement carry a digit; cells blank in every arrangement are blank.' },
  { name: 'Group combinations', desc: 'A fully-delimited group\u2019s sum restricts which distinct digits its open cells can hold (killer-cage style) \u2014 impossible digits are eliminated.' },
  { name: 'Span algebra', desc: 'Decided row and column groups interlocking over shared cells: summing the rows must equal summing the columns over the same region (letters bound consistently) \u2014 joint completions pin cells and letters both.' },
  { name: 'Line analysis', desc: 'One line considered in isolation: every completion consistent with its clue and the current candidates is enumerated \u2014 values no completion uses are eliminated.' },
  { name: 'Letter deduction', desc: 'The sums a clue group can actually achieve pin the decimal digits its crypto letters can stand for \u2014 impossible digits are removed from the letter\u2019s candidates.' },
  { name: 'Letter uniqueness', desc: 'Every crypto letter stands for a different digit \u2014 a solved letter\u2019s digit is removed from all other letters.' },
  { name: 'Letter trial', desc: 'Suppose a nearly-decided cipher letter stood for one of its digits and follow the quick consequences \u2014 a contradiction removes that digit, chain shown.' },
  { name: 'Coral 2\u00d72', variant: 'no22blank', desc: 'No 2\u00d72 block of shaded cells \u2014 three blanks in a square force the fourth cell to hold a digit.' },
  { name: 'No 2\u00d72 numbers', variant: 'no22num', desc: 'No 2\u00d72 block of digit cells \u2014 three digits in a square force the fourth cell blank.' },
  { name: 'Coral checkerboard', variant: 'checker', desc: 'With shaded connected and numbers touching the edge, a 2\u00d72 with blanks on one diagonal and digits on the other is impossible \u2014 two diagonal blanks beside a digit force the fourth cell blank.' },
  { name: 'Coral connectivity', variant: 'blankConn', desc: 'All shaded cells form one orthogonally connected group \u2014 a cell that every connection between two shaded parts must pass through is itself blank.' },
  { name: 'Numbers connected', variant: 'numConn', desc: 'All digit cells form one orthogonally connected group \u2014 a cell that every connection between two digit regions must pass through holds a digit.' },
  { name: 'Coral reach', variant: 'reach', desc: 'Every connected group of digit cells touches the grid\u2019s edge \u2014 a digit region\u2019s last escape route to the border must hold digits.' },
  { name: 'KD off-by-one', variant: 'kd', desc: 'A clue is one off its true value, so a group truly sums to clue\u22121 or clue+1 \u2014 same parity either way; a decided group\u2019s last open cell is pinned to the two completing values.' },
  { name: 'Cell trial', desc: 'Suppose one nearly-decided cell held a particular value and follow the quick consequences \u2014 a contradiction eliminates it, chain shown.' },
];

const api = { makeSumsState, cloneSumsState, filterCand, filterLetter, takeSumsStep, sumsComplete, eachSumsLine, committedDigit, popc, digitsOf, digitsOf2: (m) => { const a = []; for (let d = 0; d <= 9; d++) if (m & (1 << d)) a.push(d); return a; }, tokenLetters, allowedSums, SUMS_STRATEGIES };
if (typeof module !== 'undefined') module.exports = api;
else global.sums = api;
})(typeof self !== 'undefined' ? self : this);
