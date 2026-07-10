// Alien Japanese Sums: the clues' number base is unknown (2..31) and must be
// determined by the solver. Scenarios, randomized batteries vs engine truth,
// and the two reference puzzles (KNT 000CZ6, ibag 0001OX) as full regressions.
// optional args: --scenarios (skip batteries/references) or --battery
const E = require('../js/sums-engine.js');
const S = require('../js/sums-stepper.js');
const REF = require('./alien-puzzles.js');
const ARGS = process.argv.slice(2);
const RUN_SCENARIOS = !ARGS.includes('--battery');
const RUN_BATTERY = !ARGS.includes('--scenarios');
let fails = 0;

if (RUN_SCENARIOS) {
{
  // base bounds: '222' needs base >= 3 (digit 2) and 2b^2+2b+2 <= 45 -> b <= 4
  const st = S.makeSumsState(2, 9, 9);
  st.alien = true;
  const clues = { rows: [['222'], null], cols: Array(9).fill(null) };
  const mv = S.takeSumsStep(st, clues);
  let k = 0;
  while (k++ < 6 && st.baseCand.size > 2) { const m2 = S.takeSumsStep(st, clues); if (!m2 || m2.contradiction) break; }
  const bs = [...st.baseCand].sort((a, b) => a - b).join(',');
  if (!mv || mv.rule !== 'Base bounds' || bs !== '3,4') { console.log('FAIL: 222 base bounds (' + (mv && mv.rule) + ', bases=' + bs + ')'); fails++; }
  else console.log('ok: "Base bounds": 222 admits only bases 3 and 4 (digit floor + value budget) \u2014 ' + mv.text.slice(0, 110));
}
{
  // alien letters range up to base-1, not 9 (the pristine-mask regression):
  // with a 2-digit numeral 'AB' and nothing else, bases run high and both
  // letters must keep candidate digits of 10 and above
  const st = S.makeSumsState(2, 9, 9);
  st.alien = true;
  S.ensureBaseCand(st, { rows: [['AB'], null], cols: Array(9).fill(null) });
  const aMax = Math.max(...S.digitsOf2(st.letterCand[0]));
  if (aMax < 10) { console.log('FAIL: alien letter mask capped at ' + aMax + ' (must exceed 9)'); fails++; }
  else console.log('ok: alien cipher letters range 0..' + aMax + ' (beyond decimal digits)');
}
{
  // tiny alien end-to-end: grid [[1,2,3],[3,#,2]] in base 4; the ladder must
  // pin the base and the fill; the engine must agree exactly
  const clues = { rows: [['12'], [3, 2]], cols: [['10'], [2], ['11']] };
  const st = S.makeSumsState(2, 3, 3);
  st.alien = true;
  let mv, k = 0, contra = false;
  while (k++ < 40 && (mv = S.takeSumsStep(st, clues))) if (mv.contradiction) { contra = true; break; }
  const want = [1, 2, 3, 3, 0, 2];
  const valAt = i => st.cand[i] === 1 ? 0 : S.digitsOf(st.cand[i])[0];
  const okGrid = S.sumsComplete(st) && want.every((v, i) => valAt(i) === v);
  const eng = E.runAny({ R: 2, C: 3, D: 3, alien: true, rowClues: clues.rows, colClues: clues.cols, mode: 'candidates', timeLimit: 20000, maxSolutions: 1e9 });
  const okEng = eng.complete && eng.solCount === 1 && eng.bases.length === 1 && eng.bases[0] === 4;
  if (contra || !okGrid || ![...st.baseCand].every(b => b === 4) || !okEng) {
    console.log('FAIL: tiny alien end-to-end (contra=' + contra + ', grid=' + okGrid + ', base=' + [...st.baseCand] + ', eng=' + JSON.stringify({ s: eng.solCount, b: eng.bases }) + ')'); fails++;
  } else console.log('ok: tiny alien puzzle pinned to base 4 by the ladder; engine agrees (1 solution, base 4)');
}
{
  // self-healing floor: a base range initialised too wide (e.g. before the
  // clues were typed) is re-floored from the current clues, narrated
  const P = REF.knt;
  const st = S.makeSumsState(P.R, P.C, P.D);
  st.alien = true;
  st.baseCand = new Set(Array.from({ length: 30 }, (_, i) => i + 2));
  for (let L = 0; L < 26; L++) st.letterCand[L] = 0x7FFFFFFF;
  st.__baseNarrated = true;
  const mv = S.takeSumsStep(st, { rows: P.rows, cols: P.cols });
  const ok = mv && mv.rule === 'Base bounds' && /distinct letters need 8 different digits/.test(mv.text) && Math.min(...st.baseCand) >= 8;
  if (!ok) { console.log('FAIL: self-healing base floor (' + (mv && mv.text.slice(0, 120)) + ')'); fails++; }
  else console.log('ok: self-healing floor \u2014 a too-wide base range is re-floored by the 8 distinct letters, narrated');
}
}

if (RUN_BATTERY) {
// ---- randomized battery: engine truth vs stepper (cells, letters, AND bases) ----
function randGrid(R, C, D) {
  const g = new Int8Array(R * C);
  const rm = new Int32Array(R), cm = new Int32Array(C);
  for (let i = 0; i < R * C; i++) {
    const r = (i / C) | 0, c = i % C;
    const opts = [0, 0];
    for (let v = 1; v <= D; v++) if (!(rm[r] & (1 << v)) && !(cm[c] & (1 << v))) opts.push(v);
    const v = opts[(Math.random() * opts.length) | 0];
    g[i] = v;
    if (v) { rm[r] |= 1 << v; cm[c] |= 1 << v; }
  }
  return g;
}
function numeral(v, b) {
  const ds = []; let x = v;
  while (x > 0) { ds.unshift(x % b); x = (x / b) | 0; }
  if (!ds.length) ds.push(0);
  return ds.some(d => d > 9) ? ds.join('.') : ds.join('');
}
let puzzles = 0, steps = 0, solved = 0, cryptoN = 0;
const t00 = Date.now();
while (puzzles < 14 && Date.now() - t00 < 300000) {
  const R = 4, C = 4 + ((Math.random() * 2) | 0), D = 4 + ((Math.random() * 4) | 0);
  const base = 3 + ((Math.random() * 8) | 0);   // 3..10
  const g = randGrid(R, C, D);
  const mk = (n, len, get) => { const out = []; for (let a = 0; a < n; a++) { const cl = []; let run = 0; for (let bx = 0; bx < len; bx++) { const v = get(a, bx); if (v) run += v; else if (run) { cl.push(numeral(run, base)); run = 0; } } if (run) cl.push(numeral(run, base)); out.push(Math.random() < 0.12 ? null : cl); } return out; };
  const clues = { rows: mk(R, C, (r, c) => g[r * C + c]), cols: mk(C, R, (c, r) => g[r * C + c]) };
  // most puzzles crypto-substitute clue digits with letters
  if (puzzles % 3 !== 0) {
    cryptoN++;
    const seen = new Set();
    for (const cl of clues.rows.concat(clues.cols)) if (cl) for (const t of cl) for (const ch of String(t)) if (/[0-9]/.test(ch)) seen.add(ch);
    const pool = [...seen];
    const nSub = Math.min(pool.length, 2 + ((Math.random() * 2) | 0));
    const chosen = [];
    while (chosen.length < nSub && pool.length) chosen.push(pool.splice((Math.random() * pool.length) | 0, 1)[0]);
    const LET = ['A', 'B', 'C'];
    const sub = tok => String(tok).split('.').map(f => f.split('').map(ch => { const k = chosen.indexOf(ch); return k >= 0 ? LET[k] : ch; }).join('')).join('.');
    clues.rows = clues.rows.map(cl => cl && cl.map(sub));
    clues.cols = clues.cols.map(cl => cl && cl.map(sub));
  }
  const eng = E.runAny({ R, C, D, alien: true, rowClues: clues.rows, colClues: clues.cols, mode: 'candidates', timeLimit: 20000, maxSolutions: 1e9 });
  if (!eng.complete || eng.solCount === 0) continue;
  puzzles++;
  const st = S.makeSumsState(R, C, D);
  st.alien = true;
  let mv, k = 0;
  const hashState = () => { let h = 2166136261 >>> 0; for (let i = 0; i < st.cand.length; i++) { h ^= st.cand[i]; h = Math.imul(h, 16777619) >>> 0; } for (let L = 0; L < 26; L++) { h ^= st.letterCand[L]; h = Math.imul(h, 16777619) >>> 0; } for (const b of (st.baseCand || [])) { h ^= b * 131; h = Math.imul(h, 16777619) >>> 0; } h ^= st.__baseNarrated ? 99 : 0; return h; };
  let prevHash = hashState();
  while (k++ < 500 && (mv = S.takeSumsStep(st, clues))) {
    steps++;
    if (!mv.contradiction) {
      const h2 = hashState();
      if (h2 === prevHash) { console.log('FAIL: no-op alien step [' + mv.rule + ']: ' + mv.text.slice(0, 140)); fails++; break; }
      prevHash = h2;
    }
    if (mv.contradiction) { console.log('FAIL: contradiction on solvable alien:', mv.text.slice(0, 140)); console.log('  REPRO:', JSON.stringify({ R, C, D, base, rows: clues.rows, cols: clues.cols })); fails++; break; }
    let bad = false;
    for (let i = 0; i < R * C && !bad; i++) if (eng.cand[i] & ~st.cand[i]) bad = 'cell ' + i;
    for (let L = 0; L < 26 && !bad; L++) if (eng.letterCand[L] & ~st.letterCand[L]) bad = 'letter ' + String.fromCharCode(65 + L);
    if (!bad && st.baseCand) for (const b of eng.bases) if (!st.baseCand.has(b)) { bad = 'base ' + b; break; }
    if (bad) {
      console.log('FAIL: unsound alien elim (' + bad + ') [' + mv.rule + ']:', mv.text.slice(0, 180));
      console.log('  REPRO:', JSON.stringify({ R, C, D, base, rows: clues.rows, cols: clues.cols }));
      fails++; break;
    }
  }
  if (S.sumsComplete(st)) solved++;
}
console.log((fails ? 'FAILURES so far' : 'ok') + ': alien battery on ' + puzzles + ' random puzzles (' + cryptoN + ' crypto) \u2014 ' + steps + ' steps, ' + solved + ' fully solved, zero unsound cell/letter/base eliminations');

// ---- reference puzzle regressions ----
function runRef(name, P, wantBase, wantLetters, budgetSteps) {
  const clues = { rows: P.rows, cols: P.cols };
  const st = S.makeSumsState(P.R, P.C, P.D);
  st.alien = true;
  const t0 = Date.now();
  let mv, k = 0, contra = false, sawBounds = false, sawDeduction = false, badChain = 0;
  const counts = {};
  while (k++ < budgetSteps && (mv = S.takeSumsStep(st, clues))) {
    counts[mv.rule] = (counts[mv.rule] || 0) + 1;
    if (mv.rule === 'Base bounds') sawBounds = true;
    if (mv.rule === 'Base deduction' || mv.rule === 'Base trial') sawDeduction = true;
    if ((mv.chain && (!mv.chain.length || !mv.chain[mv.chain.length - 1].contradiction)) && !mv.cases) badChain++;
    if (mv.contradiction) { contra = true; break; }
  }
  let ok = !contra && S.sumsComplete(st) && st.baseCand.size === 1 && [...st.baseCand][0] === wantBase && sawBounds && sawDeduction && !badChain;
  for (const [name2, d] of Object.entries(wantLetters)) {
    const L = name2.charCodeAt(0) - 65;
    if (S.digitsOf2(st.letterCand[L]).join(',') !== String(d)) ok = false;
  }
  if (ok) {
    const eng = E.runAny({ R: P.R, C: P.C, D: P.D, base: wantBase, rowClues: P.rows, colClues: P.cols,
      candMask: Array.from(st.cand), mode: 'count', timeLimit: 120000, maxSolutions: 5 });
    if (eng.solCount !== 1) { ok = false; console.log('  engine rejects the ' + name + ' fill (' + eng.solCount + ')'); }
  }
  if (!ok) { console.log('FAIL: ' + name + ' (complete=' + S.sumsComplete(st) + ', contra=' + contra + ', base=' + [...(st.baseCand || [])] + ', bounds=' + sawBounds + ', deduction=' + sawDeduction + ', badChain=' + badChain + ', steps=' + (k - 1) + ')'); fails++; }
  else console.log('ok: ' + name + ' fully solved in ' + (k - 1) + ' steps \u2014 base ' + wantBase + ' determined logically, letters ' + Object.entries(wantLetters).map(([n2, d]) => n2 + '=' + d).join(' ') + ', fill engine-confirmed, ' + ((Date.now() - t0) / 1000).toFixed(0) + 's');
}
// KNT 000CZ6: base 11, X is the two-decimal-digit alien digit 10
runRef('KNT "Extraterrestrial Japanese Sums" (10x10)', REF.knt, 11,
  { A: 8, E: 4, I: 7, L: 6, R: 2, S: 3, T: 1, X: 10 }, 800);
// ibag 0001OX: base 13, B=11 and F=12 exceed the decimal digits
runRef('ibag "Rasselbande (5)" alien crypto (11x11)', REF.ibag, 13,
  { A: 3, B: 11, C: 6, D: 9, E: 0, F: 12, G: 2, H: 1, I: 7, J: 4 }, 800);
}

console.log(fails ? fails + ' FAILURES' : 'ALL SUMS ALIEN TESTS PASSED');
process.exit(fails ? 1 : 0);
