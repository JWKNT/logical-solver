// Japanese Sums human-rule stepper: named deduction rules, simplest first,
// each returning a prose explanation. Mirrors the U-Bahn stepper design.
//
// State: cand[i] bitmask — bit 0 = the cell is blank, bits 1..D = digits.
(function (global) {
'use strict';

function makeSumsState(R, C, D) {
  const full = ((1 << (D + 1)) - 2) | 1;
  return { R, C, D, cand: new Int32Array(R * C).fill(full), fastLadder: false, noTrial: false };
}
function cloneSumsState(st) {
  return { R: st.R, C: st.C, D: st.D, cand: Int32Array.from(st.cand), fastLadder: st.fastLadder, noTrial: st.noTrial,
    __lineCache: st.__lineCache };
}
function popc(m) { let c = 0; while (m) { c += m & 1; m >>>= 1; } return c; }
function rc(st, i) { return 'r' + (((i / st.C) | 0) + 1) + 'c' + ((i % st.C) + 1); }
function digitsOf(mask) { const a = []; for (let d = 1; d < 31; d++) if (mask & (1 << d)) a.push(d); return a; }
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
const comboMemo = new Map();
function comboFeasible(s, len, avail) {
  if (len === 0) return s === 0;
  if (s <= 0) return false;
  const key = s * 4096 + len * 512 + avail;
  if (comboMemo.has(key)) return comboMemo.get(key);
  let ok = false;
  for (let d = 1; d < 31 && !ok; d++) {
    if (!(avail & (1 << d)) || d > s) continue;
    if (comboFeasible(s - d, len - 1, avail & ~((1 << (d + 1)) - 1))) ok = true;   // pick ascending to dedupe
  }
  comboMemo.set(key, ok);
  return ok;
}

// enumerate all assignments of one line consistent with the clue, the current
// candidate masks, and in-line distinctness; call onSolution(values[]) each time.
// Returns false on node-budget overflow.
function enumerateSumsLine(st, line, onSolution, nodeCap) {
  const n = line.cells.length;
  const clue = line.clue;
  const vals = new Int8Array(n);
  let nodes = 0, overflow = false;
  const cap = nodeCap || 400000;
  function rec(p, gi, run, mask) {
    if (overflow) return;
    if (++nodes > cap) { overflow = true; return; }
    if (p === n) {
      let g2 = gi;
      if (run > 0) {
        if (clue && (g2 >= clue.length || (clue[g2] >= 0 && clue[g2] !== run))) return;
        g2++;
      }
      if (clue && g2 !== clue.length) return;
      onSolution(vals);
      return;
    }
    const m = st.cand[line.cells[p]];
    // blank
    if (m & 1) {
      if (run > 0) {
        if (!clue || (gi < clue.length && (clue[gi] < 0 || clue[gi] === run))) { vals[p] = 0; rec(p + 1, gi + 1, 0, mask); }
      } else { vals[p] = 0; rec(p + 1, gi, 0, mask); }
    }
    // digits
    for (let d = 1; d <= st.D; d++) {
      if (!(m & (1 << d)) || (mask & (1 << d))) continue;
      if (clue) {
        if (gi >= clue.length) continue;
        const t = clue[gi];
        if (t >= 0) {
          if (run + d > t) continue;
          // remaining sum must stay feasible with distinct unused digits
          if (run + d < t && !comboFeasibleUB(t - run - d, ~(mask | (1 << d)) & ((1 << (st.D + 1)) - 2))) continue;
        }
      }
      vals[p] = d;
      rec(p + 1, gi, run + d, mask | (1 << d));
    }
  }
  function comboFeasibleUB(s, avail) {   // any number of distinct digits: s <= sum(avail) and s >= min avail
    let tot = 0, mn = 99;
    for (let d = 1; d <= st.D; d++) if (avail & (1 << d)) { tot += d; if (d < mn) mn = d; }
    return s <= tot && (s === 0 || s >= mn);
  }
  rec(0, 0, 0, 0);
  return !overflow;
}

// fingerprint-cached per-line assignment unions
function cachedLineUnion(st, clues, line) {
  if (!st.__lineCache) st.__lineCache = new Map();
  let h = 2166136261 >>> 0;
  for (const i of line.cells) { h ^= st.cand[i]; h = Math.imul(h, 16777619) >>> 0; }
  const key = line.kind + ':' + line.idx + ':' + h;
  if (st.__lineCache.has(key)) return st.__lineCache.get(key);
  let prod = 1;
  for (const i of line.cells) { prod *= Math.max(1, popc(st.cand[i])); if (prod > 5e7) break; }
  let res = null;
  if (prod <= 5e7) {
    const union = new Int32Array(line.cells.length);
    const ok = enumerateSumsLine(st, line, vals => { for (let p = 0; p < vals.length; p++) union[p] |= 1 << vals[p]; }, 300000);
    if (ok) res = union;
  }
  if (st.__lineCache.size > 3000) st.__lineCache.clear();
  st.__lineCache.set(key, res);
  return res;
}

/* ---------------- rules ---------------- */

// rule: digit uniqueness — a placed digit cannot repeat in its row or column
function ruleUniqueness(st, clues) {
  for (let i = 0; i < st.R * st.C; i++) {
    const d = committedDigit(st, i);
    if (!d) continue;
    const r = (i / st.C) | 0, c = i % st.C;
    const hits = [];
    for (let c2 = 0; c2 < st.C; c2++) { const j = r * st.C + c2; if (j !== i && (st.cand[j] & (1 << d))) hits.push(j); }
    for (let r2 = 0; r2 < st.R; r2++) { const j = r2 * st.C + c; if (j !== i && (st.cand[j] & (1 << d))) hits.push(j); }
    if (!hits.length) continue;
    return { rule: 'Digit uniqueness', cells: hits,
      text: rc(st, i) + ' is a ' + d + ', so no other cell of row ' + (r + 1) + ' or column ' + (c + 1) + ' can hold a ' + d + ' (' + hits.map(j => rc(st, j)).join(', ') + ').',
      apply() { for (const j of hits) filterCand(st, j, ~(1 << d)); } };
  }
  return null;
}

// rule: full house — a line whose clue sums total 1+2+..+D must contain every digit
function ruleFullLine(st, clues) {
  const fullSum = st.D * (st.D + 1) / 2;
  for (const line of eachSumsLine(st, clues)) {
    if (!line.clue || line.clue.some(s => s < 0)) continue;
    const tot = line.clue.reduce((a, b) => a + b, 0);
    if (tot !== fullSum) continue;
    for (let d = 1; d <= st.D; d++) {
      const homes = line.cells.filter(i => st.cand[i] & (1 << d));
      if (homes.length === 1 && popc(st.cand[homes[0]]) > 1) {
        return { rule: 'Full line', cells: homes,
          text: line.name + '\u2019s sums total ' + tot + ' = 1+2+\u2026+' + st.D + ', so every digit appears in it \u2014 and ' + d + ' fits only at ' + rc(st, homes[0]) + '.',
          apply() { filterCand(st, homes[0], 1 << d); } };
      }
      if (homes.length === 0) {
        return { rule: 'Full line', contradiction: true, cells: line.cells.slice(),
          text: line.name + '\u2019s sums total ' + tot + ', so every digit must appear \u2014 but ' + d + ' has no place left.' };
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
    const lenOpts = line.clue.map(s => {
      const L = [];
      for (let l = 1; l <= st.D && l <= n; l++) {
        if (s < 0) { L.push(l); continue; }
        if (comboFeasible(s, l, ((1 << (st.D + 1)) - 2))) L.push(l);
      }
      return L;
    });
    const spanStart = new Int32Array(G), spanLen = new Int32Array(G);
    function place(g, from) {
      if (count > 4000) return;
      if (g === G) {
        for (let p = spanStart[G - 1] === undefined ? 0 : 0; p < n; p++) {}
        // trailing cells must allow blank
        let last = G ? spanStart[G - 1] + spanLen[G - 1] : 0;
        for (let p = last; p < n; p++) if (!(st.cand[line.cells[p]] & 1)) return;
        count++;
        const inG = new Int8Array(n);
        for (let g2 = 0; g2 < G; g2++) for (let p = spanStart[g2]; p < spanStart[g2] + spanLen[g2]; p++) inG[p] = 1;
        for (let p = 0; p < n; p++) { if (inG[p]) alwaysBlank[p] = 0; else alwaysFilled[p] = 0; }
        return;
      }
      for (const l of lenOpts[g]) {
        for (let s0 = from; s0 + l <= n; s0++) {
          // gap cells before the group must allow blank
          let ok = true;
          for (let p = from; p < s0 && ok; p++) if (!(st.cand[line.cells[p]] & 1)) ok = false;
          if (!ok) continue;   // NOTE: cannot break: a non-blank cell blocks all later starts
          let ok2 = true;
          for (let p = s0; p < s0 + l && ok2; p++) if (!(st.cand[line.cells[p]] & ~1)) ok2 = false;
          if (!ok2) continue;
          spanStart[g] = s0; spanLen[g] = l;
          place(g + 1, s0 + l + 1);
          if (count > 4000) return;
        }
      }
    }
    place(0, 0);
    if (count === 0) {
      return { rule: 'Line placements', contradiction: true, cells: line.cells.slice(),
        text: 'No arrangement of ' + line.name.toLowerCase() + '\u2019s groups fits the current grid \u2014 the position is contradictory.' };
    }
    if (count > 4000) continue;
    const mkFilled = [], mkBlank = [];
    for (let p = 0; p < n; p++) {
      if (alwaysFilled[p] && (st.cand[line.cells[p]] & 1)) mkFilled.push(p);
      if (alwaysBlank[p] && (st.cand[line.cells[p]] & ~1)) mkBlank.push(p);
    }
    if (!mkFilled.length && !mkBlank.length) continue;
    const bits = [];
    if (mkFilled.length) bits.push(mkFilled.map(p => rc(st, line.cells[p])).join(', ') + ' carr' + (mkFilled.length === 1 ? 'ies' : 'y') + ' a digit in every arrangement');
    if (mkBlank.length) bits.push(mkBlank.map(p => rc(st, line.cells[p])).join(', ') + ' ' + (mkBlank.length === 1 ? 'is' : 'are') + ' blank in every arrangement');
    return { rule: 'Line placements', cells: mkFilled.concat(mkBlank).map(p => line.cells[p]),
      text: (G === 0 ? line.name + '’s clue is 0 — the line holds no digits at all: ' + bits.join('; ') + '.' : line.name + '\u2019s ' + G + ' group' + (G === 1 ? '' : 's') + ' (' + line.clue.map(s => s < 0 ? '?' : s).join(', ') + ') can only be arranged in so many ways given the blanks and digits already placed \u2014 ' + bits.join('; ') + '.'),
      apply() {
        for (const p of mkFilled) filterCand(st, line.cells[p], ~1);
        for (const p of mkBlank) filterCand(st, line.cells[p], 1);
      } };
  }
  return null;
}

// rule: group combinations — a fully-delimited group's sum restricts its digit set
function ruleGroupCombos(st, clues) {
  for (const line of eachSumsLine(st, clues)) {
    if (!line.clue || line.clue.some(s => s < 0)) continue;
    const n = line.cells.length;
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
      const [a, b] = runs[g], L = b - a, s = line.clue[g];
      // committed digits inside
      let fixedSum = 0, fixedMask = 0;
      const open = [];
      for (let q = a; q < b; q++) {
        const d = committedDigit(st, line.cells[q]);
        if (d) { fixedSum += d; fixedMask |= 1 << d; } else open.push(q);
      }
      if (!open.length) continue;
      const rem = s - fixedSum, m = open.length;
      // allowed digits: d such that rem - d is feasible with m-1 distinct others
      const elim = [];
      for (const q of open) {
        let bad = 0;
        for (let d = 1; d <= st.D; d++) {
          if (!(st.cand[line.cells[q]] & (1 << d))) continue;
          const avail = ~(fixedMask | (1 << d)) & ((1 << (st.D + 1)) - 2);
          if (d > rem || !comboFeasible(rem - d, m - 1, avail)) bad |= 1 << d;
        }
        if (bad) elim.push({ q, bad });
      }
      if (!elim.length) continue;
      const desc = elim.map(e => rc(st, line.cells[e.q]) + ' loses ' + digitsOf(e.bad).join(', ')).join('; ');
      return { rule: 'Group combinations', cells: elim.map(e => line.cells[e.q]),
        text: line.name + '\u2019s group at ' + rc(st, line.cells[a]) + '\u2013' + rc(st, line.cells[b - 1]) + ' must sum to ' + s + (fixedSum ? ' (already holding ' + fixedSum + ')' : '') + '; the remaining ' + m + ' cell' + (m === 1 ? '' : 's') + ' need distinct digits summing to ' + rem + ' \u2014 ' + desc + '.',
        apply() { for (const e of elim) filterCand(st, line.cells[e.q], ~e.bad); } };
    }
  }
  return null;
}

// rule: line analysis — exact enumeration of one line's assignments
function ruleLineAnalysis(st, clues) {
  if (st.fastLadder) return null;
  for (const line of eachSumsLine(st, clues)) {
    if (!line.clue) continue;
    const union = cachedLineUnion(st, clues, line);
    if (!union) continue;
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

// rule: cell trial — hypothesise a value at a nearly-decided cell and follow
// the quick consequences; a contradiction eliminates it (chain shown)
function ruleCellTrial(st, clues) {
  if (st.noTrial) return null;
  const N = st.R * st.C;
  const cands = [];
  for (let i = 0; i < N; i++) {
    const pc = popc(st.cand[i]);
    if (pc >= 2 && pc <= 3) cands.push(i);
  }
  cands.sort((a, b) => popc(st.cand[a]) - popc(st.cand[b]));
  const deadline = Date.now() + 2000;
  for (const i of cands.slice(0, 40)) {
    if (Date.now() > deadline) break;
    for (let v = 0; v <= st.D; v++) {
      if (!(st.cand[i] & (1 << v))) continue;
      const ghost = cloneSumsState(st);
      ghost.fastLadder = true; ghost.noTrial = true;
      ghost.__lineCache = undefined;
      try { filterCand(ghost, i, 1 << v); } catch (e) { continue; }
      const chain = [];
      let contra = null;
      for (let k = 0; k < 25 && !contra; k++) {
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
  return null;
}

const SUMS_RULES = [ruleUniqueness, ruleFullLine, ruleLinePlacements, ruleGroupCombos, ruleLineAnalysis, ruleCellTrial];
const SUMS_FAST = [ruleUniqueness, ruleFullLine, ruleLinePlacements, ruleGroupCombos];

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
  { name: 'Full line', desc: 'A line whose clue sums total 1+2+\u2026+D contains every digit \u2014 a digit with one home left is placed.' },
  { name: 'Line placements', desc: 'The clue\u2019s groups can only be arranged in so many ways around the blanks and digits already placed \u2014 cells filled in every arrangement carry a digit; cells blank in every arrangement are blank.' },
  { name: 'Group combinations', desc: 'A fully-delimited group\u2019s sum restricts which distinct digits its open cells can hold (killer-cage style) \u2014 impossible digits are eliminated.' },
  { name: 'Line analysis', desc: 'One line considered in isolation: every completion consistent with its clue and the current candidates is enumerated \u2014 values no completion uses are eliminated.' },
  { name: 'Cell trial', desc: 'Suppose one nearly-decided cell held a particular value and follow the quick consequences \u2014 a contradiction eliminates it, chain shown.' },
];

const api = { makeSumsState, cloneSumsState, filterCand, takeSumsStep, sumsComplete, eachSumsLine, committedDigit, popc, digitsOf, SUMS_STRATEGIES };
if (typeof module !== 'undefined') module.exports = api;
else global.sums = api;
})(typeof self !== 'undefined' ? self : this);
