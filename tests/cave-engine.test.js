const assert = require('assert');
const E = require('../js/cave-engine.js');

function brute(R, C, clues) {
  const N = R * C, out = [];
  const adj = i => {
    const r = (i / C) | 0, c = i % C, a = [];
    if (r) a.push(i - C); if (r + 1 < R) a.push(i + C);
    if (c) a.push(i - 1); if (c + 1 < C) a.push(i + 1);
    return a;
  };
  for (let mask = 0; mask < (1 << N); mask++) {
    const white = i => !!(mask & (1 << i));
    if (mask === (1 << N) - 1) continue; // a Cave must have outside cells
    if (Object.keys(clues).some(i => !white(+i))) continue;
    const whites = Array.from({ length: N }, (_, i) => i).filter(white);
    if (!whites.length) continue;
    let seen = new Set([whites[0]]), stack = [whites[0]];
    while (stack.length) for (const y of adj(stack.pop())) if (white(y) && !seen.has(y)) { seen.add(y); stack.push(y); }
    if (seen.size !== whites.length) continue;
    let outsideOK = true, done = new Set();
    for (let i = 0; i < N; i++) if (!white(i) && !done.has(i)) {
      let edge = false; stack = [i]; done.add(i);
      while (stack.length) {
        const x = stack.pop(), r = (x / C) | 0, c = x % C;
        if (!r || r === R - 1 || !c || c === C - 1) edge = true;
        for (const y of adj(x)) if (!white(y) && !done.has(y)) { done.add(y); stack.push(y); }
      }
      if (!edge) { outsideOK = false; break; }
    }
    if (!outsideOK) continue;
    let cluesOK = true;
    for (const [key, n] of Object.entries(clues)) {
      if (n === '?') continue;
      const q = +key, qr = (q / C) | 0, qc = q % C;
      let count = 1;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]])
        for (let r = qr + dr, c = qc + dc; r >= 0 && r < R && c >= 0 && c < C && white(r * C + c); r += dr, c += dc) count++;
      if (count !== n) { cluesOK = false; break; }
    }
    if (cluesOK) out.push(mask);
  }
  return out;
}

function bruteVariant(R, C, cfg) {
  const N = R * C, out = [], clues = cfg.clues || {};
  const adj = i => { const r = (i / C) | 0, c = i % C, a = []; if (r) a.push(i - C); if (r + 1 < R) a.push(i + C); if (c) a.push(i - 1); if (c + 1 < C) a.push(i + 1); return a; };
  for (let mask = 0; mask < (1 << N); mask++) {
    const white = i => !!(mask & (1 << i));
    if (!mask || mask === (1 << N) - 1) continue;
    const whites = Array.from({ length: N }, (_, i) => i).filter(white);
    let seen = new Set([whites[0]]), stack = [whites[0]];
    while (stack.length) for (const y of adj(stack.pop())) if (white(y) && !seen.has(y)) { seen.add(y); stack.push(y); }
    if (seen.size !== whites.length) continue;
    const compSize = new Map(); let outsideOK = true, done = new Set();
    for (let i = 0; i < N; i++) if (!white(i) && !done.has(i)) {
      let edge = false, comp = []; stack = [i]; done.add(i);
      while (stack.length) { const x = stack.pop(), r = (x / C) | 0, c = x % C; comp.push(x); if (!r || r === R - 1 || !c || c === C - 1) edge = true; for (const y of adj(x)) if (!white(y) && !done.has(y)) { done.add(y); stack.push(y); } }
      if (!edge) { outsideOK = false; break; }
      for (const x of comp) compSize.set(x, comp.length);
    }
    if (!outsideOK) continue;
    let localOK = true;
    for (let r = 0; r + 1 < R; r++) for (let c = 0; c + 1 < C; c++) {
      const b = [r * C + c, r * C + c + 1, (r + 1) * C + c, (r + 1) * C + c + 1], wc = b.filter(white).length;
      if ((cfg.no2x2Black && wc === 0) || (cfg.no2x2White && wc === 4)) localOK = false;
    }
    if (!localOK) continue;
    for (const [key, n] of Object.entries(clues)) {
      const q = +key;
      if (!cfg.twilight && !white(q)) { localOK = false; break; }
      if (n === '?') continue;
      if (cfg.twilight && !white(q)) { if (compSize.get(q) !== n) { localOK = false; break; } continue; }
      if (cfg.twilight && (n < 2 || n > R + C - 1)) { localOK = false; break; }
      const qr = (q / C) | 0, qc = q % C; let count = 1;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) for (let r = qr + dr, c = qc + dc; r >= 0 && r < R && c >= 0 && c < C && white(r * C + c); r += dr, c += dc) count++;
      if (count !== n) { localOK = false; break; }
    }
    if (localOK) out.push(mask);
  }
  return out;
}

for (const clues of [{ 4: 5 }, { 0: 2 }, { 0: 3, 4: 5 }, { 4: '?' }]) {
  const want = brute(3, 3, clues);
  const result = E.solve({ R: 3, C: 3, clues, maxSolutions: 1000, time: 5 }, 5);
  const got = result.solutions.map(sol => sol.reduce((m, v, i) => m + (v << i), 0)).sort((a, b) => a - b);
  assert(!result.timed && !result.capped, '3x3 comparison should enumerate exactly');
  assert.deepStrictEqual(got, want, 'SAT engine must equal independent brute force for ' + JSON.stringify(clues));
}

for (const cfg of [
  { clues: { 4: 5 }, no2x2Black: true },
  { clues: { 4: 5 }, no2x2White: true },
  { clues: { 4: 5 }, no2x2Black: true, no2x2White: true },
  { clues: { 0: 1 }, twilight: true },
  { clues: { 4: 5 }, twilight: true },
  { clues: { 0: 2, 8: 2 }, twilight: true },
  { clues: { 4: '?' }, twilight: true }
]) {
  const want = bruteVariant(3, 3, cfg);
  const result = E.solve({ R: 3, C: 3, ...cfg, maxSolutions: 1000, time: 5 }, 5);
  const got = result.solutions.map(sol => sol.reduce((m, v, i) => m + (v << i), 0)).sort((a, b) => a - b);
  assert(!result.timed && !result.capped, 'variant 3x3 comparison should enumerate exactly');
  assert.deepStrictEqual(got, want, 'variant engine must equal brute force for ' + JSON.stringify(cfg));
}

const sample = { R: 6, C: 6, clues: { 1: 3, 13: 2, 16: 3, 21: 11, 26: 3, 30: 3, 34: 2 }, maxSolutions: 2, time: 10 };
const solved = E.solve(sample, 10);
assert.strictEqual(solved.solutions.length, 1, 'the bundled puzz.link example should be unique');
assert(!solved.timed && !solved.capped);
const common = E.commonCells(solved.solutions);
assert.strictEqual(common.white.size + common.black.size, 36, 'all candidates of a unique Cave are fixed');

assert(E.validateConfig({ R: 3, C: 3, clues: { 0: 1 } }), 'Cave clue 1 is invalid');
assert(E.validateConfig({ R: 3, C: 3, clues: { 0: 6 } }), 'a clue above rows+columns-1 is invalid');
assert.strictEqual(E.validateConfig({ R: 3, C: 3, clues: { 0: 1 }, twilight: true }), null, 'Twilight allows a size-1 shaded component clue');
assert(E.validateConfig({ R: 3, C: 3, clues: { 0: 10 }, twilight: true }), 'Twilight clues cannot exceed the grid area');
assert.strictEqual(E.solve({ R: 3, C: 3, clues: { 0: 2, 4: 3 }, twilight: true, black: [0, 4], preprocess: false, maxSolutions: 1 }, 5).solutions.length, 0, 'diagonally touching unequal clues cannot both be shaded');
assert.strictEqual(E.solve({ R: 3, C: 3, clues: { 0: 3, 4: 3 }, twilight: true, black: [0, 4], preprocess: false, maxSolutions: 1 }, 5).solutions.length, 1, 'equal diagonal clues may share one shaded component');
console.log('Cave engine tests passed');
