// Symmetry battery: the human-rule fixpoint must commute with the grid's
// symmetries. For each random puzzle we run the stepper to fixpoint on the
// original and on its transpose / column-mirror / row-mirror, map the results
// back, and require the identical set of determined borders (same values,
// same unknowns) and the same contradiction verdict.
const { runSolve } = require('./engine-node.js');
const ST = require('../js/stepper.js');

const blank = n => new Array(n).fill(-1);

function shapeOf(R, C, rE, dE, r, c) {
  const i = r * C + c;
  const Rt = c < C - 1 ? rE[i] : 0, L = c > 0 ? rE[i - 1] : 0;
  const Dn = r < R - 1 ? dE[i] : 0, U = r > 0 ? dE[i - C] : 0;
  const deg = Rt + L + Dn + U;
  if (deg === 4) return 0;
  if (deg === 3) return 1;
  if (deg === 2) return ((L && Rt) || (U && Dn)) ? 2 : 3;
  return -1;
}

function randomPuzzle(R, C, rng, seedEdges) {
  const N = R * C;
  const gen = runSolve({ R, C, rowClue: blank(4 * R), colClue: blank(4 * C), blocked: new Uint8Array(N), mode: 'random', randomize: true, timeLimit: 5000 }, null);
  const row = Array.from({ length: R }, () => [0, 0, 0, 0]);
  const col = Array.from({ length: C }, () => [0, 0, 0, 0]);
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const s = shapeOf(R, C, gen.firstR, gen.firstD, r, c);
    if (s >= 0) { row[r][s]++; col[c][s]++; }
  }
  // fifth slot: empty-cell clues, sometimes given
  for (let r = 0; r < R; r++) { let e = 0; for (let c = 0; c < C; c++) if (shapeOf(R, C, gen.firstR, gen.firstD, r, c) < 0) e++; row[r].push(rng() < 0.5 ? e : -1); }
  for (let c = 0; c < C; c++) { let e = 0; for (let r = 0; r < R; r++) if (shapeOf(R, C, gen.firstR, gen.firstD, r, c) < 0) e++; col[c].push(rng() < 0.5 ? e : -1); }
  // randomly blank some clues to exercise derived-clue and partial-info paths
  for (let r = 0; r < R; r++) for (let s = 0; s < 4; s++) if (rng() < 0.35) row[r][s] = -1;
  for (let c = 0; c < C; c++) for (let s = 0; s < 4; s++) if (rng() < 0.35) col[c][s] = -1;
  // optionally pre-draw a handful of borders straight from the solution, so the
  // fixpoints start mid-solve (this exercises direction-sensitive rules hardest)
  const seeds = [];
  if (seedEdges) {
    for (let k = 0; k < seedEdges; k++) {
      const r = (rng() * R) | 0, c = (rng() * C) | 0;
      if (rng() < 0.5 && c < C - 1) seeds.push({ kind: 0, r, c, val: gen.firstR[r * C + c] });
      else if (r < R - 1) seeds.push({ kind: 1, r, c, val: gen.firstD[r * C + c] });
    }
  }
  return { clues: { row, col }, seeds };
}

// ---- transforms: clues + final-state mapping back to original coordinates ----
const T = {
  transpose: {
    dims: (R, C) => [C, R],
    clues: cl => ({ row: cl.col.map(c => c.slice()), col: cl.row.map(r => r.slice()) }),
    // value of original edgeR[r*C+c] in the transformed state
    edgeR: (st2, R, C, r, c) => st2.edgeD[c * R + r],
    edgeD: (st2, R, C, r, c) => st2.edgeR[c * R + r]
  },
  mirrorC: {
    dims: (R, C) => [R, C],
    clues: cl => ({ row: cl.row.map(r => r.slice()), col: cl.col.slice().reverse().map(c => c.slice()) }),
    edgeR: (st2, R, C, r, c) => st2.edgeR[r * C + (C - 2 - c)],
    edgeD: (st2, R, C, r, c) => st2.edgeD[r * C + (C - 1 - c)]
  },
  mirrorR: {
    dims: (R, C) => [R, C],
    clues: cl => ({ row: cl.row.slice().reverse().map(r => r.slice()), col: cl.col.map(c => c.slice()) }),
    edgeR: (st2, R, C, r, c) => st2.edgeR[(R - 1 - r) * C + c],
    edgeD: (st2, R, C, r, c) => st2.edgeD[(R - 2 - r) * C + c]
  }
};

function fixpoint(R, C, clues, seeds) {
  const st = ST.makeStepState(R, C, Array.from({ length: R }, () => new Array(C).fill(false)));
  if (seeds) for (const s of seeds) {
    const cur = s.kind ? st.edgeD[s.idx] : st.edgeR[s.idx];
    if (cur === -1) ST.setEdge(st, s.kind, s.idx, s.val);
  }
  for (let k = 0; k < 3000; k++) {
    let mv;
    try { mv = ST.takeHumanStep(st, clues); } catch (e) { return { st, verdict: 'error:' + e.message }; }
    if (!mv) return { st, verdict: 'fix' };
    if (mv.contradiction) return { st, verdict: 'contradiction' };
  }
  return { st, verdict: 'overrun' };
}

let fails = 0, checked = 0;
let seed = 1234567;
const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

// index of a seed border in the transformed grid (reusing the read-mappers as
// index calculators would be circular; write them directly per transform)
const seedIndex = {
  transpose: (R, C, s) => s.kind === 0 ? { kind: 1, idx: s.c * R + s.r } : { kind: 0, idx: s.c * R + s.r },
  mirrorC: (R, C, s) => s.kind === 0 ? { kind: 0, idx: s.r * C + (C - 2 - s.c) } : { kind: 1, idx: s.r * C + (C - 1 - s.c) },
  mirrorR: (R, C, s) => s.kind === 0 ? { kind: 0, idx: (R - 1 - s.r) * C + s.c } : { kind: 1, idx: (R - 2 - s.r) * C + s.c }
};

const sizes = [[5, 5], [4, 6], [6, 4], [6, 6], [3, 7]];
for (let trial = 0; trial < 24; trial++) {
  const [R, C] = sizes[trial % sizes.length];
  const nSeeds = trial < 12 ? 0 : 3 + ((rng() * 5) | 0);
  const { clues, seeds } = randomPuzzle(R, C, rng, nSeeds);
  const baseSeeds = seeds.map(s => ({ kind: s.kind, idx: s.r * C + s.c, val: s.val }));
  const base = fixpoint(R, C, clues, baseSeeds);
  for (const name of Object.keys(T)) {
    const tr = T[name];
    const [R2, C2] = tr.dims(R, C);
    const trSeeds = seeds.map(s => { const m = seedIndex[name](R, C, s); return { kind: m.kind, idx: m.idx, val: s.val }; });
    const res2 = fixpoint(R2, C2, tr.clues(clues), trSeeds);
    checked++;
    if (base.verdict !== res2.verdict) {
      console.log('FAIL [' + name + '] verdict mismatch on trial ' + trial + ' (' + R + 'x' + C + '): ' + base.verdict + ' vs ' + res2.verdict);
      fails++;
      continue;
    }
    if (base.verdict !== 'fix') continue;
    let bad = null;
    for (let r = 0; r < R && !bad; r++) for (let c = 0; c < C && !bad; c++) {
      if (c < C - 1) {
        const v1 = base.st.edgeR[r * C + c], v2 = tr.edgeR(res2.st, R, C, r, c);
        if (v1 !== v2) bad = ['edgeR', r, c, v1, v2];
      }
      if (r < R - 1) {
        const v1 = base.st.edgeD[r * C + c], v2 = tr.edgeD(res2.st, R, C, r, c);
        if (v1 !== v2) bad = ['edgeD', r, c, v1, v2];
      }
    }
    if (bad) {
      console.log('FAIL [' + name + '] trial ' + trial + ' (' + R + 'x' + C + '): ' + bad[0] + ' at r' + (bad[1] + 1) + 'c' + (bad[2] + 1) + ': base=' + bad[3] + ' vs mapped=' + bad[4]);
      fails++;
    }
  }
}
console.log(checked + ' symmetry comparisons run');
console.log(fails === 0 ? 'ALL SYMMETRY TESTS PASSED' : fails + ' SYMMETRY FAILURES');
process.exit(fails ? 1 : 0);
