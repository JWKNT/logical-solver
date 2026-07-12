/* Exact Cave solver. A solution is an array whose entries are 1 for cave
   (unshaded) and 0 for outside (shaded). */
(function (G) {
  if (!G.Logic && typeof require !== 'undefined') {
    try { G.Logic = require('./vendor/logic-solver.bundle.js'); } catch (_) {}
  }

  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const whiteVar = i => `cave_w_${i}`;

  function neighbours(R, C, i) {
    const r = (i / C) | 0, c = i % C, out = [];
    for (const [dr, dc] of dirs) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < R && cc >= 0 && cc < C) out.push(rr * C + cc);
    }
    return out;
  }

  function normalizeClues(cfg) {
    const out = {};
    for (const [key, raw] of Object.entries(cfg.clues || {})) {
      if (raw === '?' || raw === -1) out[+key] = '?';
      else if (raw !== '' && raw != null && Number.isFinite(+raw)) out[+key] = +raw;
    }
    return out;
  }

  function validateConfig(cfg) {
    const R = +cfg.R, C = +cfg.C, clues = normalizeClues(cfg);
    if (!Number.isInteger(R) || !Number.isInteger(C) || R < 2 || C < 2) return 'Rows and columns must both be at least 2.';
    const min = cfg.twilight ? 1 : 2, max = cfg.twilight ? R * C : R + C - 1;
    for (const [key, n] of Object.entries(clues)) {
      const i = +key;
      if (i < 0 || i >= R * C) return 'A clue lies outside the grid.';
      if (n !== '?' && (!Number.isInteger(n) || n < min || n > max)) return `The clue at r${((i / C) | 0) + 1}c${i % C + 1} must be ${min}–${max}, or ?.`;
    }
    return null;
  }

  function makeSolver(cfg) {
    const error = validateConfig(cfg);
    if (error) return { error };
    const L = G.Logic;
    if (!L) return { error: 'The exact solver library is not available.' };
    const R = +cfg.R, C = +cfg.C, N = R * C, clues = normalizeClues(cfg), S = new L.Solver();
    const bits = Math.max(1, Math.ceil(Math.log2(N + 1)));
    const wrank = Array.from({ length: N }, (_, i) => L.variableBits(`cave_wr_${i}`, bits));
    const brank = Array.from({ length: N }, (_, i) => L.variableBits(`cave_br_${i}`, bits));
    const broot = Array.from({ length: N }, (_, i) => L.variableBits(`cave_broot_${i}`, bits));
    const zero = L.constantBits(0), isZero = b => L.equalBits(b, zero);

    // Ordinary numbered cells are in the cave. Twilight clues may instead be
    // shaded component-size clues. Fixed marks are SAT assumptions.
    if (!cfg.twilight) for (const key of Object.keys(clues)) S.require(whiteVar(+key));
    for (const i of cfg.white || cfg.forcedWhite || []) S.require(whiteVar(+i));
    for (const i of cfg.black || cfg.forcedBlack || []) S.forbid(whiteVar(+i));

    // A Cave has a boundary loop, so at least one cell is outside/shaded.
    S.require(L.or(Array.from({ length: N }, (_, i) => L.not(whiteVar(i)))));

    // Optional local restrictions.
    for (let r = 0; r + 1 < R; r++) for (let c = 0; c + 1 < C; c++) {
      const block = [r * C + c, r * C + c + 1, (r + 1) * C + c, (r + 1) * C + c + 1];
      if (cfg.no2x2Black) S.require(L.or(block.map(whiteVar)));
      if (cfg.no2x2White) S.require(L.or(block.map(i => L.not(whiteVar(i)))));
    }

    // Unequal Twilight clues that touch orthogonally or diagonally cannot both
    // be shaded. Orthogonal cells would share a component; diagonal cells must
    // either join through a corner neighbour or form a forbidden checkerboard.
    if (cfg.twilight) {
      const numbered = Object.keys(clues).map(Number).filter(q => clues[q] !== '?');
      for (let a = 0; a < numbered.length; a++) for (let b = a + 1; b < numbered.length; b++) {
        const x = numbered[a], y = numbered[b], dr = Math.abs(((x / C) | 0) - ((y / C) | 0)), dc = Math.abs(x % C - y % C);
        if (Math.max(dr, dc) === 1 && clues[x] !== clues[y]) S.forbid(L.and(L.not(whiteVar(x)), L.not(whiteVar(y))));
      }
    }

    // Every clue counts the uninterrupted white cells seen in four directions,
    // including the clue cell. Cumulative visibility booleans make this linear.
    for (const [key, value] of Object.entries(clues)) {
      if (value === '?') continue;
      const q = +key, qr = (q / C) | 0, qc = q % C, visible = [];
      dirs.forEach(([dr, dc], d) => {
        let prev = null, step = 1;
        for (let r = qr + dr, c = qc + dc; r >= 0 && r < R && c >= 0 && c < C; r += dr, c += dc, step++) {
          const i = r * C + c, v = `cave_vis_${q}_${d}_${step}`;
          const condition = prev ? L.and(prev, whiteVar(i)) : whiteVar(i);
          S.require(L.equiv(v, condition));
          visible.push(v);
          prev = v;
        }
      });
      const sight = L.equalBits(L.sum(visible), L.constantBits(value - 1));
      if (cfg.twilight) {
        // Values outside the ordinary Cave clue range can only take the shaded
        // interpretation in Twilight.
        if (value < 2 || value > R + C - 1) S.forbid(whiteVar(q));
        else S.require(L.implies(whiteVar(q), sight));
      } else S.require(sight);
    }

    // Twilight: shared component-root IDs let each shaded clue count exactly
    // the cells in its own shaded component without building a separate
    // reachability network for every clue.
    if (cfg.twilight) for (const [key, value] of Object.entries(clues)) {
      if (value === '?') continue;
      const q = +key;
      const members = Array.from({ length: N }, (_, i) => L.and(L.not(whiteVar(i)), L.equalBits(broot[i], broot[q])));
      S.require(L.implies(L.not(whiteVar(q)), L.equalBits(L.sum(members), L.constantBits(value))));
    }

    // Connected white area: ranks strictly decrease toward one white root.
    // A clue is a convenient fixed root; clue-less boards choose one explicitly.
    const clueCells = Object.keys(clues).map(Number);
    if (clueCells.length && !cfg.twilight) {
      const root = clueCells[0];
      S.require(isZero(wrank[root]));
      for (let i = 0; i < N; i++) if (i !== root) {
        const lower = neighbours(R, C, i).map(j => L.and(whiteVar(j), L.lessThan(wrank[j], wrank[i])));
        S.require(L.implies(whiteVar(i), L.and(L.not(isZero(wrank[i])), L.or(lower))));
      }
    } else {
      const roots = Array.from({ length: N }, (_, i) => `cave_root_${i}`);
      S.require(L.exactlyOne(roots));
      for (let i = 0; i < N; i++) {
        S.require(L.implies(roots[i], L.and(whiteVar(i), isZero(wrank[i]))));
        const lower = neighbours(R, C, i).map(j => L.and(whiteVar(j), L.lessThan(wrank[j], wrank[i])));
        S.require(L.implies(whiteVar(i), L.or(roots[i], L.and(L.not(isZero(wrank[i])), L.or(lower)))));
      }
    }

    // Every black component chooses exactly one boundary root. Root IDs are
    // equal across adjacent black cells, and ranks strictly decrease to the
    // chosen root. This both proves outside reach and supports Twilight counts.
    const rootFlag = i => `cave_broot_flag_${i}`;
    for (let i = 0; i < N; i++) {
      const r = (i / C) | 0, c = i % C, boundary = !r || r === R - 1 || !c || c === C - 1;
      const lower = neighbours(R, C, i).map(j => L.and(L.not(whiteVar(j)), L.lessThan(brank[j], brank[i])));
      const descend = L.and(L.not(isZero(brank[i])), L.or(lower));
      if (boundary) {
        const root = L.and(rootFlag(i), isZero(brank[i]), L.equalBits(broot[i], L.constantBits(i)));
        S.require(L.implies(rootFlag(i), L.not(whiteVar(i))));
        S.require(L.implies(L.not(whiteVar(i)), L.or(root, descend)));
      } else S.require(L.implies(L.not(whiteVar(i)), descend));
      for (const j of neighbours(R, C, i)) if (i < j) {
        S.require(L.implies(L.and(L.not(whiteVar(i)), L.not(whiteVar(j))), L.equalBits(broot[i], broot[j])));
      }
    }
    return { S, L, R, C, N, clues };
  }

  function solve(cfg, limit) {
    // Twilight benefits enormously from the same sound human deductions used
    // by Take step. Seed the exact model with those forced marks first; chains
    // run with noExact, so this never recurses into the SAT engine.
    let work = cfg;
    if (cfg.twilight && cfg.preprocess !== false && !(cfg.white || cfg.black || cfg.forcedWhite || cfg.forcedBlack)) {
      if (!G.CaveStepper && typeof require !== 'undefined') {
        try { G.CaveStepper = require('./cave-stepper.js'); } catch (_) {}
      }
      if (G.CaveStepper) {
        const state = {};
        for (let k = 0; k < cfg.R * cfg.C * 2; k++) {
          const mv = G.CaveStepper.step(cfg, state, { noExact: true });
          if (mv.contradiction) return { solutions: [], timed: false, capped: false };
          if (mv.done) break;
        }
        work = { ...cfg, white: [...(state.white || [])], black: [...(state.black || [])] };
      }
    }
    const made = makeSolver(work);
    if (made.error) return { error: made.error, solutions: [], timed: false, capped: false };
    const { S, L, N } = made, max = Math.max(1, +(cfg.maxSolutions || 2000));
    const until = Date.now() + Math.max(0.01, +(limit || cfg.time || 10)) * 1000;
    const solutions = [];
    let timed = false, capped = false;
    for (let k = 0; k < max; k++) {
      if (Date.now() > until) { timed = true; break; }
      const model = S.solve();
      if (!model) break;
      const tv = new Set(model.getTrueVars()), sol = Array.from({ length: N }, (_, i) => tv.has(whiteVar(i)) ? 1 : 0);
      solutions.push(sol);
      S.forbid(L.and(sol.map((v, i) => v ? whiteVar(i) : L.not(whiteVar(i)))));
    }
    if (solutions.length === max && Date.now() <= until) {
      const extra = S.solve();
      capped = !!extra;
    }
    return { solutions, timed, capped };
  }

  function commonCells(solutions) {
    const white = new Set(), black = new Set();
    if (!solutions.length) return { white, black };
    for (let i = 0; i < solutions[0].length; i++) {
      if (solutions.every(s => s[i] === 1)) white.add(i);
      else if (solutions.every(s => s[i] === 0)) black.add(i);
    }
    return { white, black };
  }

  G.CaveEngine = { solve, commonCells, validateConfig, normalizeClues, neighbours };
  if (typeof module !== 'undefined') module.exports = G.CaveEngine;
})(typeof globalThis !== 'undefined' ? globalThis : this);
