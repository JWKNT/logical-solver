// Japanese Sums engine vs an independent brute force on small random grids.
const E = require('../js/sums-engine.js');

function randGrid(R, C, D) {
  // random valid grid by greedy fill with restarts
  for (let attempt = 0; attempt < 400; attempt++) {
    const g = new Int8Array(R * C);
    const rm = new Int32Array(R), cm = new Int32Array(C);
    let ok = true;
    for (let i = 0; i < R * C && ok; i++) {
      const r = (i / C) | 0, c = i % C;
      const opts = [0];
      for (let v = 1; v <= D; v++) if (!(rm[r] & (1 << v)) && !(cm[c] & (1 << v))) opts.push(v);
      const v = opts[(Math.random() * opts.length) | 0];
      g[i] = v;
      if (v) { rm[r] |= 1 << v; cm[c] |= 1 << v; }
    }
    if (ok) return g;
  }
  return null;
}
function cluesOf(g, R, C, D) {
  const rows = [], cols = [];
  for (let r = 0; r < R; r++) {
    const cl = []; let run = 0;
    for (let c = 0; c < C; c++) { const v = g[r * C + c]; if (v) run += v; else if (run) { cl.push(run); run = 0; } }
    if (run) cl.push(run);
    rows.push(cl);
  }
  for (let c = 0; c < C; c++) {
    const cl = []; let run = 0;
    for (let r = 0; r < R; r++) { const v = g[r * C + c]; if (v) run += v; else if (run) { cl.push(run); run = 0; } }
    if (run) cl.push(run);
    cols.push(cl);
  }
  return { rows, cols };
}
// brute: distinctness-pruned enumeration with full clue verification at the end
function brute(R, C, D, rowClues, colClues) {
  const g = new Int8Array(R * C);
  const rm = new Int32Array(R), cm = new Int32Array(C);
  let count = 0;
  function lineOk(cells, cl) {
    let gi = 0, run = 0;
    for (const v of cells) {
      if (v) run += v;
      else if (run) { if (cl && (gi >= cl.length || (cl[gi] >= 0 && cl[gi] !== run))) return false; gi++; run = 0; }
    }
    if (run) { if (cl && (gi >= cl.length || (cl[gi] >= 0 && cl[gi] !== run))) return false; gi++; }
    return !cl || gi === cl.length;
  }
  function rec(i) {
    if (i === R * C) {
      for (let r = 0; r < R; r++) if (!lineOk(g.slice(r * C, r * C + C), rowClues[r])) return;
      for (let c = 0; c < C; c++) { const col = []; for (let r = 0; r < R; r++) col.push(g[r * C + c]); if (!lineOk(col, colClues[c])) return; }
      count++;
      return;
    }
    const r = (i / C) | 0, c = i % C;
    g[i] = 0; rec(i + 1);
    for (let v = 1; v <= D; v++) {
      if ((rm[r] & (1 << v)) || (cm[c] & (1 << v))) continue;
      g[i] = v; rm[r] |= 1 << v; cm[c] |= 1 << v;
      rec(i + 1);
      rm[r] &= ~(1 << v); cm[c] &= ~(1 << v);
    }
    g[i] = 0;
  }
  rec(0);
  return count;
}

let fails = 0;
for (let t = 0; t < 40; t++) {
  const R = 3 + ((Math.random() * 2) | 0), C = 3, D = 3 + ((Math.random() * 2) | 0);
  const g = randGrid(R, C, D);
  const { rows, cols } = cluesOf(g, R, C, D);
  // drop some clues to unclued to vary
  const rowClues = rows.map(cl => Math.random() < 0.15 ? null : cl);
  const colClues = cols.map(cl => Math.random() < 0.15 ? null : cl);
  const bruteN = brute(R, C, D, rowClues, colClues);
  const eng = E.runAny({ R, C, D, rowClues, colClues, mode: 'count', timeLimit: 10000, maxSolutions: 1e9 });
  if (!eng.complete || eng.solCount !== bruteN) {
    console.log('FAIL:', R + 'x' + C, 'D=' + D, 'brute=' + bruteN, 'engine=' + eng.solCount, 'complete=' + eng.complete);
    fails++;
  }
  if (bruteN < 1) { console.log('FAIL: generated puzzle has no solutions?!'); fails++; }
}
// Knapp daneben: every clue is one off; brute checks |clue - run| == 1
function bruteKD(R, C, D, rowClues, colClues) {
  const g = new Int8Array(R * C);
  const rm = new Int32Array(R), cm = new Int32Array(C);
  let count = 0;
  function lineOk(cells, cl) {
    let gi = 0, run = 0;
    const close = () => { if (cl && (gi >= cl.length || (cl[gi] >= 0 && Math.abs(cl[gi] - run) !== 1))) return false; gi++; run = 0; return true; };
    for (const v of cells) {
      if (v) run += v;
      else if (run) { if (!close()) return false; }
    }
    if (run) { if (!close()) return false; }
    return !cl || gi === cl.length;
  }
  function rec(i) {
    if (i === R * C) {
      for (let r = 0; r < R; r++) if (!lineOk(g.slice(r * C, r * C + C), rowClues[r])) return;
      for (let c = 0; c < C; c++) { const col = []; for (let r = 0; r < R; r++) col.push(g[r * C + c]); if (!lineOk(col, colClues[c])) return; }
      count++;
      return;
    }
    const r = (i / C) | 0, c = i % C;
    g[i] = 0; rec(i + 1);
    for (let v = 1; v <= D; v++) {
      if ((rm[r] & (1 << v)) || (cm[c] & (1 << v))) continue;
      g[i] = v; rm[r] |= 1 << v; cm[c] |= 1 << v;
      rec(i + 1);
      rm[r] &= ~(1 << v); cm[c] &= ~(1 << v);
    }
    g[i] = 0;
  }
  rec(0);
  return count;
}
for (let t = 0; t < 14; t++) {
  const R = 3, C = 3 + ((Math.random() * 2) | 0), D = 3 + ((Math.random() * 2) | 0);
  const g = randGrid(R, C, D);
  const { rows, cols } = cluesOf(g, R, C, D);
  // shift every clue by +-1 to make a KD puzzle (displayed = true +- 1)
  const shift = cl => cl.map(v => Math.random() < 0.5 && v > 1 ? v - 1 : v + 1);
  const rowClues = rows.map(cl => Math.random() < 0.15 ? null : shift(cl));
  const colClues = cols.map(cl => Math.random() < 0.15 ? null : shift(cl));
  const bruteN = bruteKD(R, C, D, rowClues, colClues);
  const eng = E.runAny({ R, C, D, rowClues, colClues, kd: true, mode: 'count', timeLimit: 15000, maxSolutions: 1e9 });
  if (!eng.complete || eng.solCount !== bruteN) { console.log('KD FAIL:', R + 'x' + C, 'D=' + D, 'brute=' + bruteN, 'engine=' + eng.solCount); fails++; }
  if (bruteN < 1) { console.log('KD FAIL: generated puzzle unsolvable?!'); fails++; }
}
// KD + crypto: letters bind to the DISPLAYED (off-by-one) value
for (let t = 0; t < 6; t++) {
  const R = 3, C = 3, D = 3 + ((Math.random() * 2) | 0);
  const g = randGrid(R, C, D);
  const { rows, cols } = cluesOf(g, R, C, D);
  const shift = cl => cl.map(v => Math.random() < 0.5 && v > 1 ? v - 1 : v + 1);
  const rows2 = rows.map(shift), cols2 = cols.map(shift);
  const digitsSeen = new Set();
  for (const cl of rows2.concat(cols2)) for (const v of cl) for (const ch of String(v)) digitsSeen.add(+ch);
  const pool = [...digitsSeen];
  const chosen = [pool[(Math.random() * pool.length) | 0]];
  const sub = v => String(v).split('').map(ch => +ch === chosen[0] ? 'A' : ch).join('');
  const rowClues = rows2.map(cl => cl.map(sub));
  const colClues = cols2.map(cl => cl.map(sub));
  let bruteN = 0;
  for (let d = 0; d <= 9; d++) {
    const unsub = tok => { const s = String(tok).split('').map(ch => ch === 'A' ? String(d) : ch).join(''); const v = parseInt(s, 10); return String(v).length !== String(tok).length ? NaN : v; };
    const rcl = rowClues.map(cl => cl.map(unsub));
    const ccl = colClues.map(cl => cl.map(unsub));
    if (rcl.some(cl => cl.some(isNaN)) || ccl.some(cl => cl.some(isNaN))) continue;
    bruteN += bruteKD(R, C, D, rcl, ccl);
  }
  const eng = E.runAny({ R, C, D, rowClues, colClues, kd: true, mode: 'count', timeLimit: 15000, maxSolutions: 1e9 });
  if (!eng.complete || eng.solCount !== bruteN) { console.log('KD CRYPTO FAIL: brute=' + bruteN, 'engine=' + eng.solCount); fails++; }
}

// crypto letters: substitute letters into some clue digits and compare against
// a brute that tries every distinct letter->digit assignment
for (let t = 0; t < 12; t++) {
  const R = 3, C = 3 + ((Math.random() * 2) | 0), D = 3 + ((Math.random() * 2) | 0);
  const g = randGrid(R, C, D);
  const { rows, cols } = cluesOf(g, R, C, D);
  // pick up to 2 digits that appear in the clue values and letter them
  const digitsSeen = new Set();
  for (const cl of rows.concat(cols)) for (const v of cl) for (const ch of String(v)) digitsSeen.add(+ch);
  const pool = [...digitsSeen];
  const nL = Math.min(pool.length, 1 + ((Math.random() * 2) | 0));
  const chosen = [];
  while (chosen.length < nL && pool.length) chosen.push(pool.splice((Math.random() * pool.length) | 0, 1)[0]);
  const LET = ['A', 'B'];
  const sub = v => String(v).split('').map(ch => { const k = chosen.indexOf(+ch); return k >= 0 ? LET[k] : ch; }).join('');
  const rowClues = rows.map(cl => cl.map(sub));
  const colClues = cols.map(cl => cl.map(sub));
  // brute over assignments: distinct digits 0-9 for each letter
  let bruteN = 0;
  const assign = new Array(nL).fill(0);
  function tryAssign(k) {
    if (k === nL) {
      const unsub = tok => { let out = ''; for (const ch of tok) { const li = LET.indexOf(ch); out += li >= 0 ? String(assign[li]) : ch; } return parseInt(out, 10); };
      const rcl = rowClues.map(cl => cl.map(tok => { const v = unsub(tok); return (String(v).length !== tok.length) ? NaN : v; }));
      const ccl = colClues.map(cl => cl.map(tok => { const v = unsub(tok); return (String(v).length !== tok.length) ? NaN : v; }));
      if (rcl.some(cl => cl.some(isNaN)) || ccl.some(cl => cl.some(isNaN))) return;   // leading zero created a shorter number
      for (const cl of rcl.concat(ccl)) for (const v of cl) if (isNaN(v)) return;
      bruteN += brute(R, C, D, rcl, ccl);
      return;
    }
    for (let d = 0; d <= 9; d++) {
      if (assign.slice(0, k).includes(d)) continue;
      assign[k] = d;
      tryAssign(k + 1);
    }
  }
  tryAssign(0);
  const eng = E.runAny({ R, C, D, rowClues, colClues, mode: 'count', timeLimit: 15000, maxSolutions: 1e9 });
  if (!eng.complete || eng.solCount !== bruteN) {
    console.log('CRYPTO FAIL:', R + 'x' + C, 'D=' + D, 'letters=' + nL, 'brute=' + bruteN, 'engine=' + eng.solCount);
    fails++;
  }
}
// shape variants: clues ascending (unordered), shaded connected, no 2x2 shaded, filled
// components touch the edge
function shapeOk(g, R, C) {
  const N = R * C;
  let start = -1, blanks = 0;
  for (let i = 0; i < N; i++) if (g[i] === 0) { blanks++; if (start < 0) start = i; }
  for (let r = 0; r + 1 < R; r++) for (let c = 0; c + 1 < C; c++) {
    if (g[r * C + c] === 0 && g[r * C + c + 1] === 0 && g[(r + 1) * C + c] === 0 && g[(r + 1) * C + c + 1] === 0) return false;
  }
  if (blanks > 0) {
    const seen = new Uint8Array(N); const st2 = [start]; seen[start] = 1; let cnt = 0;
    while (st2.length) { const i = st2.pop(); cnt++; const r = (i / C) | 0, c = i % C;
      for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1]]) { const r2 = r + dr, c2 = c + dc;
        if (r2 < 0 || r2 >= R || c2 < 0 || c2 >= C) continue; const j = r2 * C + c2;
        if (!seen[j] && g[j] === 0) { seen[j] = 1; st2.push(j); } } }
    if (cnt !== blanks) return false;
  }
  const seenF = new Uint8Array(N); const stF = [];
  for (let i = 0; i < N; i++) { const r = (i / C) | 0, c = i % C;
    if (g[i] > 0 && (r === 0 || c === 0 || r === R - 1 || c === C - 1)) { seenF[i] = 1; stF.push(i); } }
  while (stF.length) { const i = stF.pop(); const r = (i / C) | 0, c = i % C;
    for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1]]) { const r2 = r + dr, c2 = c + dc;
      if (r2 < 0 || r2 >= R || c2 < 0 || c2 >= C) continue; const j = r2 * C + c2;
      if (!seenF[j] && g[j] > 0) { seenF[j] = 1; stF.push(j); } } }
  for (let i = 0; i < N; i++) if (g[i] > 0 && !seenF[i]) return false;
  return true;
}
function bruteShaped(R, C, D, rowClues, colClues) {
  const g = new Int8Array(R * C);
  const rm = new Int32Array(R), cm = new Int32Array(C);
  let count = 0;
  function lineOk(cells, cl) {
    const sums = []; let run = 0;
    for (const v of cells) { if (v) run += v; else if (run) { sums.push(run); run = 0; } }
    if (run) sums.push(run);
    if (!cl) return true;
    if (sums.length !== cl.length) return false;
    sums.sort((a, b) => a - b);
    for (let k = 0; k < cl.length; k++) if (cl[k] >= 0 && cl[k] !== sums[k]) return false;
    for (let k = 1; k < sums.length; k++) if (sums[k] < sums[k - 1]) return false;
    return true;
  }
  function rec(i) {
    if (i === R * C) {
      for (let r = 0; r < R; r++) if (!lineOk(g.slice(r * C, (r + 1) * C), rowClues[r])) return;
      for (let c = 0; c < C; c++) { const col = []; for (let r = 0; r < R; r++) col.push(g[r * C + c]); if (!lineOk(col, colClues[c])) return; }
      if (!shapeOk(g, R, C)) return;
      count++;
      return;
    }
    const r = (i / C) | 0, c = i % C;
    g[i] = 0; rec(i + 1);
    for (let v = 1; v <= D; v++) {
      if ((rm[r] & (1 << v)) || (cm[c] & (1 << v))) continue;
      g[i] = v; rm[r] |= 1 << v; cm[c] |= 1 << v;
      rec(i + 1);
      rm[r] &= ~(1 << v); cm[c] &= ~(1 << v);
    }
    g[i] = 0;
  }
  rec(0);
  return count;
}
for (let t = 0; t < 20; t++) {
  const R = 3 + ((Math.random() * 2) | 0), C = 3, D = 3 + ((Math.random() * 2) | 0);
  // generate a shape-legal grid by rejection
  let g = null;
  for (let a = 0; a < 3000; a++) { const cand2 = randGrid(R, C, D); if (shapeOk(cand2, R, C)) { g = cand2; break; } }
  if (!g) continue;
  const { rows, cols } = cluesOf(g, R, C, D);
  // sort clues ascending; replace some values with '?' (still ascending as patterns)
  const asc = cl => { const s = [...cl].sort((a, b) => a - b); return s.map(v => Math.random() < 0.3 ? '?'.repeat(String(v).length) : v); };
  const rowClues = rows.map(cl => Math.random() < 0.2 ? null : asc(cl));
  const colClues = cols.map(cl => Math.random() < 0.2 ? null : asc(cl));
  // brute understands numbers and full-wildcard patterns of matching length
  const toB = cl => cl && cl.map(t => typeof t === 'number' ? t : -1 - (String(t).length - 1));
  // encode: -1 = 1-digit ?, -2 = 2-digit ?? (value 10..)
  const bcl = cl => cl && cl.map(t => typeof t === 'number' ? t : (String(t).length === 1 ? -1 : -2));
  function lineOkPattern(sums, cl) { return null; }
  // simpler: run brute with a matcher closure
  function bruteShaped2(rowCl, colCl) {
    const match = (cl, sums) => {
      if (!cl) return true;
      if (sums.length !== cl.length) return false;
      const s2 = [...sums].sort((a, b) => a - b);
      for (let k = 1; k < s2.length; k++) if (s2[k] < s2[k - 1]) return false;
      for (let k = 0; k < cl.length; k++) {
        const t = cl[k];
        if (typeof t === 'number') { if (t !== s2[k]) return false; }
        else if (String(s2[k]).length !== String(t).length) return false;
      }
      return true;
    };
    const g2 = new Int8Array(R * C);
    const rm = new Int32Array(R), cm = new Int32Array(C);
    let count = 0;
    function sumsOf(cells) { const out = []; let run = 0; for (const v of cells) { if (v) run += v; else if (run) { out.push(run); run = 0; } } if (run) out.push(run); return out; }
    function rec(i) {
      if (i === R * C) {
        for (let r = 0; r < R; r++) if (!match(rowCl[r], sumsOf(g2.slice(r * C, (r + 1) * C)))) return;
        for (let c = 0; c < C; c++) { const col = []; for (let r = 0; r < R; r++) col.push(g2[r * C + c]); if (!match(colCl[c], sumsOf(col))) return; }
        if (!shapeOk(g2, R, C)) return;
        count++;
        return;
      }
      const r = (i / C) | 0, c = i % C;
      g2[i] = 0; rec(i + 1);
      for (let v = 1; v <= D; v++) {
        if ((rm[r] & (1 << v)) || (cm[c] & (1 << v))) continue;
        g2[i] = v; rm[r] |= 1 << v; cm[c] |= 1 << v;
        rec(i + 1);
        rm[r] &= ~(1 << v); cm[c] &= ~(1 << v);
      }
      g2[i] = 0;
    }
    rec(0);
    return count;
  }
  const bruteN = bruteShaped2(rowClues, colClues);
  const eng = E.runAny({ R, C, D, variants: { blankConn: true, no22blank: true, asc: true, reach: true }, rowClues, colClues, mode: 'count', timeLimit: 15000, maxSolutions: 1e9 });
  if (!eng.complete || eng.solCount !== bruteN) {
    console.log('SHAPE FAIL:', R + 'x' + C, 'D=' + D, 'rows=', JSON.stringify(rowClues), 'cols=', JSON.stringify(colClues), 'brute=' + bruteN, 'engine=' + eng.solCount);
    fails++;
  }
  if (bruteN < 1) { console.log('SHAPE FAIL: generated puzzle unsolvable'); fails++; }
}
// custom value palettes: arbitrary values (negative/double-digit) with
// per-line multiplicities; grid stores palette indices, sums use values
function brutePalette(R, C, pal, cnt, rowClues, colClues) {
  const M = pal.length;
  const g = new Int8Array(R * C);   // 0 = blank, k = palette index
  const rc2 = Array.from({ length: R }, () => new Int8Array(M));
  const cc2 = Array.from({ length: C }, () => new Int8Array(M));
  let count = 0;
  function lineOk(cells, cl) {
    const sums = []; let run = 0, len = 0;
    for (const k of cells) {
      if (k) { run += pal[k - 1]; len++; }
      else if (len) { sums.push(run); run = 0; len = 0; }
    }
    if (len) sums.push(run);
    if (!cl) return true;
    if (sums.length !== cl.length) return false;
    for (let q = 0; q < cl.length; q++) if (cl[q] !== sums[q]) return false;
    return true;
  }
  function rec(i) {
    if (i === R * C) {
      for (let r = 0; r < R; r++) if (!lineOk(g.slice(r * C, (r + 1) * C), rowClues[r])) return;
      for (let c = 0; c < C; c++) { const col = []; for (let r = 0; r < R; r++) col.push(g[r * C + c]); if (!lineOk(col, colClues[c])) return; }
      count++;
      return;
    }
    const r = (i / C) | 0, c = i % C;
    g[i] = 0; rec(i + 1);
    for (let k = 1; k <= M; k++) {
      if (rc2[r][k - 1] >= cnt[k - 1] || cc2[c][k - 1] >= cnt[k - 1]) continue;
      g[i] = k; rc2[r][k - 1]++; cc2[c][k - 1]++;
      rec(i + 1);
      rc2[r][k - 1]--; cc2[c][k - 1]--;
    }
    g[i] = 0;
  }
  rec(0);
  return count;
}
for (let t = 0; t < 16; t++) {
  const R = 3, C = 3, useNeg = t % 2 === 0;
  // random palette: 3 distinct values, one may repeat
  const poolBase = useNeg ? [-3, -2, -1, 1, 2, 4, 5, 7, 12] : [1, 2, 3, 5, 6, 9, 11];
  const pool = [...poolBase].sort(() => Math.random() - 0.5).slice(0, 3).sort((a, b) => a - b);
  const values = [...pool];
  if (Math.random() < 0.7) values.push(pool[(Math.random() * pool.length) | 0]);   // a double
  const byVal = new Map();
  for (const v of values) byVal.set(v, (byVal.get(v) || 0) + 1);
  const pal = [...byVal.keys()].sort((a, b) => a - b);
  const cnt = pal.map(v => byVal.get(v));
  const M = pal.length;
  // random legal grid
  const g = new Int8Array(R * C);
  const rc2 = Array.from({ length: R }, () => new Int8Array(M));
  const cc2 = Array.from({ length: C }, () => new Int8Array(M));
  for (let i = 0; i < R * C; i++) {
    const r = (i / C) | 0, c = i % C;
    const opts = [0, 0];
    for (let k = 1; k <= M; k++) if (rc2[r][k - 1] < cnt[k - 1] && cc2[c][k - 1] < cnt[k - 1]) opts.push(k);
    const k = opts[(Math.random() * opts.length) | 0];
    g[i] = k;
    if (k) { rc2[r][k - 1]++; cc2[c][k - 1]++; }
  }
  const mkClues = (get, n, len) => {
    const out = [];
    for (let a = 0; a < n; a++) {
      const cl = []; let run = 0, ln = 0;
      for (let b = 0; b < len; b++) { const k = get(a, b); if (k) { run += pal[k - 1]; ln++; } else if (ln) { cl.push(run); run = 0; ln = 0; } }
      if (ln) cl.push(run);
      out.push(Math.random() < 0.2 ? null : cl);
    }
    return out;
  };
  const rowClues = mkClues((r, c) => g[r * C + c], R, C);
  const colClues = mkClues((c, r) => g[r * C + c], C, R);
  const bruteN = brutePalette(R, C, pal, cnt, rowClues, colClues);
  const eng = E.runAny({ R, C, values, rowClues, colClues, mode: 'count', timeLimit: 15000, maxSolutions: 1e9 });
  if (!eng.complete || eng.solCount !== bruteN) {
    console.log('PALETTE FAIL: values=[' + values.join(',') + '] rows=' + JSON.stringify(rowClues) + ' cols=' + JSON.stringify(colClues) + ' brute=' + bruteN + ' engine=' + eng.solCount);
    fails++;
  }
  if (bruteN < 1) { console.log('PALETTE FAIL: unsolvable generated puzzle'); fails++; }
}
// custom value palettes: multiplicities, negatives, zero/negative group sums
function brutePal(R, C, values, rowClues, colClues) {
  const byVal = new Map();
  for (const v of values) byVal.set(v, (byVal.get(v) || 0) + 1);
  const pal = [...byVal.keys()].sort((a, b) => a - b);
  const cnt = pal.map(v => byVal.get(v));
  const M = pal.length;
  const g = new Int8Array(R * C);   // 0 blank, k = palette index
  const rUse = Array.from({ length: R }, () => new Int8Array(M));
  const cUse = Array.from({ length: C }, () => new Int8Array(M));
  let count = 0;
  function lineOk(cells, cl) {
    const sums = []; let run = 0, len = 0;
    for (const k of cells) {
      if (k) { run += pal[k - 1]; len++; }
      else if (len) { sums.push(run); run = 0; len = 0; }
    }
    if (len) sums.push(run);
    if (!cl) return true;
    if (sums.length !== cl.length) return false;
    for (let q = 0; q < cl.length; q++) if (cl[q] !== sums[q]) return false;
    return true;
  }
  function rec(i) {
    if (i === R * C) {
      for (let r = 0; r < R; r++) if (!lineOk(g.slice(r * C, (r + 1) * C), rowClues[r])) return;
      for (let c = 0; c < C; c++) { const col = []; for (let r = 0; r < R; r++) col.push(g[r * C + c]); if (!lineOk(col, colClues[c])) return; }
      count++;
      return;
    }
    const r = (i / C) | 0, c = i % C;
    g[i] = 0; rec(i + 1);
    for (let k = 1; k <= M; k++) {
      if (rUse[r][k - 1] >= cnt[k - 1] || cUse[c][k - 1] >= cnt[k - 1]) continue;
      g[i] = k; rUse[r][k - 1]++; cUse[c][k - 1]++;
      rec(i + 1);
      rUse[r][k - 1]--; cUse[c][k - 1]--;
    }
    g[i] = 0;
  }
  rec(0);
  return count;
}
const palettes = [
  [1, 2, 2, 3],           // a doubled value
  [1, 2, 3, 4, 5, 5],     // doubled high value
  [-2, 1, 3, 4],          // a negative (zero/negative sums possible)
  [-3, -1, 2, 5, 5],      // negatives + double
  [10, 11, 12],           // double-digit values
  [-1, 0, 2, 3],          // a placeable zero (used cell, adds nothing)
];
for (let t = 0; t < 15; t++) {
  const values = palettes[t % palettes.length];
  const byVal = new Map();
  for (const v of values) byVal.set(v, (byVal.get(v) || 0) + 1);
  const pal = [...byVal.keys()].sort((a, b) => a - b);
  const cnt = pal.map(v => byVal.get(v));
  const R = 3, C = 3;
  // random grid respecting the palette
  const g = new Int8Array(R * C);
  const rUse = Array.from({ length: R }, () => new Int8Array(pal.length));
  const cUse = Array.from({ length: C }, () => new Int8Array(pal.length));
  for (let i = 0; i < R * C; i++) {
    const r = (i / C) | 0, c = i % C;
    const opts = [0, 0];
    for (let k = 1; k <= pal.length; k++) if (rUse[r][k - 1] < cnt[k - 1] && cUse[c][k - 1] < cnt[k - 1]) opts.push(k);
    const k = opts[(Math.random() * opts.length) | 0];
    g[i] = k;
    if (k) { rUse[r][k - 1]++; cUse[c][k - 1]++; }
  }
  const lineClue = cells => {
    const sums = []; let run = 0, len = 0;
    for (const k of cells) { if (k) { run += pal[k - 1]; len++; } else if (len) { sums.push(run); run = 0; len = 0; } }
    if (len) sums.push(run);
    return sums;
  };
  const rowClues = [], colClues = [];
  for (let r = 0; r < R; r++) rowClues.push(Math.random() < 0.15 ? null : lineClue(g.slice(r * C, (r + 1) * C)));
  for (let c = 0; c < C; c++) { const col = []; for (let r = 0; r < R; r++) col.push(g[r * C + c]); colClues.push(Math.random() < 0.15 ? null : lineClue(col)); }
  const bruteN = brutePal(R, C, values, rowClues, colClues);
  const eng = E.runAny({ R, C, values, rowClues, colClues, mode: 'count', timeLimit: 15000, maxSolutions: 1e9 });
  if (!eng.complete || eng.solCount !== bruteN) {
    console.log('PALETTE FAIL: values=' + JSON.stringify(values), 'rows=' + JSON.stringify(rowClues), 'cols=' + JSON.stringify(colClues), 'brute=' + bruteN, 'engine=' + eng.solCount);
    fails++;
  }
  if (bruteN < 1) { console.log('PALETTE FAIL: generated puzzle unsolvable'); fails++; }
}
// blankReach: every shaded component touches the edge
function blankReachOk(g, R, C) {
  const N = R * C;
  const seen = new Uint8Array(N); const st2 = [];
  for (let i = 0; i < N; i++) { const r = (i / C) | 0, c = i % C;
    if (g[i] === 0 && (r === 0 || c === 0 || r === R - 1 || c === C - 1)) { seen[i] = 1; st2.push(i); } }
  while (st2.length) { const i = st2.pop(); const r = (i / C) | 0, c = i % C;
    for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1]]) { const r2 = r + dr, c2 = c + dc;
      if (r2 < 0 || r2 >= R || c2 < 0 || c2 >= C) continue; const j = r2 * C + c2;
      if (!seen[j] && g[j] === 0) { seen[j] = 1; st2.push(j); } } }
  for (let i = 0; i < N; i++) if (g[i] === 0 && !seen[i]) return false;
  return true;
}
for (let t = 0; t < 8; t++) {
  const R = 4, C = 3, D = 3;
  const g = randGrid(R, C, D);
  const { rows, cols } = cluesOf(g, R, C, D);
  const rowClues = rows.map(cl => Math.random() < 0.3 ? null : cl);
  const colClues = cols.map(cl => Math.random() < 0.3 ? null : cl);
  // brute with the flag
  let bruteN = 0;
  const g2 = new Int8Array(R * C);
  const rm = new Int32Array(R), cm = new Int32Array(C);
  const sumsOf = cells => { const out = []; let run = 0; for (const v of cells) { if (v) run += v; else if (run) { out.push(run); run = 0; } } if (run) out.push(run); return out; };
  const match = (cl, sums) => !cl || (sums.length === cl.length && sums.every((s, q) => s === cl[q]));
  (function rec(i) {
    if (i === R * C) {
      for (let r = 0; r < R; r++) if (!match(rowClues[r], sumsOf(g2.slice(r * C, (r + 1) * C)))) return;
      for (let c = 0; c < C; c++) { const col = []; for (let r = 0; r < R; r++) col.push(g2[r * C + c]); if (!match(colClues[c], sumsOf(col))) return; }
      if (!blankReachOk(g2, R, C)) return;
      bruteN++;
      return;
    }
    const r = (i / C) | 0, c = i % C;
    g2[i] = 0; rec(i + 1);
    for (let v = 1; v <= D; v++) {
      if ((rm[r] & (1 << v)) || (cm[c] & (1 << v))) continue;
      g2[i] = v; rm[r] |= 1 << v; cm[c] |= 1 << v; rec(i + 1); rm[r] &= ~(1 << v); cm[c] &= ~(1 << v);
    }
    g2[i] = 0;
  })(0);
  const eng = E.runAny({ R, C, D, variants: { blankReach: true }, rowClues, colClues, mode: 'count', timeLimit: 10000, maxSolutions: 1e9 });
  if (!eng.complete || eng.solCount !== bruteN) { console.log('BLANKREACH FAIL: brute=' + bruteN, 'engine=' + eng.solCount); fails++; }
}
console.log(fails ? fails + ' FAILURES' : 'ALL SUMS ENGINE TESTS PASSED');
process.exit(fails ? 1 : 0);
