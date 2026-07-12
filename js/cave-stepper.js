/* Human-style Cave deduction ladder. Each call changes at most one cell. */
(function (G) {
  const techniques = [
    ['Number cell', 'Every numbered cell lies inside the cave, so it is unshaded.'],
    ['Sight-line bounds', 'A clue counts itself plus the consecutive unshaded cells visible in its row and column. Minimum and maximum arm lengths force cells.'],
    ['Cave connectivity', 'All unshaded cells form one orthogonally connected cave. A separating cell must stay unshaded.'],
    ['Outside escape', 'Every shaded component must be able to reach the edge of the grid. A unique escape cell must be shaded.'],
    ['No checkerboard', 'A 2×2 block cannot alternate shaded and unshaded like a checkerboard; the cave boundary would cross itself.'],
    ['Shaded cell exists', 'The boundary loop must enclose a proper cave, so at least one grid cell is shaded.'],
    ['Shading trial', 'Suppose one undecided cell is shaded or unshaded and follow the visible human rules. A narrated contradiction forces the other shading state.'],
    ['No 2×2 shaded', 'When three cells of a 2×2 block are shaded, the fourth must be unshaded.'],
    ['No 2×2 unshaded', 'When three cells of a 2×2 block are unshaded, the fourth must be shaded.'],
    ['Twilight clue colour', 'A Twilight number must work either as an unshaded sight clue or as the size of its shaded component. If one interpretation is impossible, the other is forced.'],
    ['Twilight region size', 'A shaded Twilight clue fixes the size of its orthogonally connected shaded component. Minimum, maximum, and cut-cell counts force its boundary.'],
    ['Twilight edge reach', 'A shaded Twilight component must reach the grid edge within its numbered size. Different-sized clue cells block the route; cells shared by every short-enough route are shaded.'],
    ['Case agreement', 'Follow both colours of one cell through the human ladder. Any cell both cases colour the same way is forced without choosing a case.'],
    ['Forcing bifurcation', 'Assume one colour, then split a later undecided cell both ways. If both continuations contradict, the original assumption is false.'],
    ['Exhaustive cell test', 'As a final fallback, test one cell against the complete exact model after the narrated human chains are exhausted.'],
    ['Twilight clue cluster', 'List the few shading patterns for a small orthogonally adjacent clue cluster, reject patterns by immediate clue and edge checks, and keep what every local pattern shares.'],
    ['Unequal neighboring clues', 'Orthogonally or diagonally touching clues with different values cannot both be shaded: they would either join one component or create a checkerboard crossing.'],
    ['Sight-line distribution', 'For a confirmed unshaded clue, distribute its required visible cells among the four arms. Each arm ends at a shaded stopper; a locally impossible distribution is eliminated.'],
    ['Checkerboard-assisted edge reach', 'If shading a cell forces another shaded cell to avoid a checkerboard, check the enlarged numbered wall immediately. If it can no longer reach the edge within its clue size, the first cell is unshaded.'],
    ['Different wall separation', 'An unshaded cell must separate two shaded components carrying different size clues; shading it would merge incompatible walls.'],
    ['Twilight sight capacity', 'Test the four sight arms of an undecided Twilight clue. If the unshaded interpretation cannot reach its number, the clue is shaded.'],
    ['Twilight colour agreement', 'Read an undecided Twilight clue once as an unshaded sight clue and once as a shaded size clue. A cell forced the same way in both readings is decided.'],
    ['Diagonal wall contact', 'Diagonally touching shaded cells must join through one of their shared-corner cells to avoid a checkerboard. A size clue that would thereby join an already-too-large wall is unshaded.']
  ];
  const techniqueSections = [
    { name: 'Core Cave', indices: [0, 1, 2, 3, 4, 5, 17] },
    { name: '2×2 restrictions', indices: [7, 8], option: 'twoByTwo' },
    { name: 'Twilight', indices: [9, 20, 10, 11, 16, 19, 22, 18, 21, 15], option: 'twilight' },
    { name: 'Shading trials', indices: [6, 12], heading: true }
  ];
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  const label = (cfg, i) => `r${((i / cfg.C) | 0) + 1}c${i % cfg.C + 1}`;
  function cluesOf(cfg) {
    const out = {};
    for (const [k, v] of Object.entries(cfg.clues || {})) out[+k] = (v === '?' || v === -1) ? '?' : +v;
    return out;
  }
  function setup(state) {
    state.white = state.white || new Set();
    state.black = state.black || new Set();
  }
  function cloneState(state) {
    return { white: new Set(state.white || []), black: new Set(state.black || []) };
  }
  function colour(state, i) { return state.white.has(i) ? 1 : state.black.has(i) ? -1 : 0; }
  function mark(state, i, white) {
    const own = white ? state.white : state.black, other = white ? state.black : state.white;
    if (other.has(i)) return false;
    own.add(i);
    return true;
  }
  function neighbours(cfg, i) {
    const r = (i / cfg.C) | 0, c = i % cfg.C, out = [];
    for (const [dr, dc] of dirs) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < cfg.R && cc >= 0 && cc < cfg.C) out.push(rr * cfg.C + cc);
    }
    return out;
  }
  function ray(cfg, q, dr, dc) {
    const out = [], qr = (q / cfg.C) | 0, qc = q % cfg.C;
    for (let r = qr + dr, c = qc + dc; r >= 0 && r < cfg.R && c >= 0 && c < cfg.C; r += dr, c += dc) out.push(r * cfg.C + c);
    return out;
  }
  function flood(cfg, starts, allowed) {
    const seen = new Set(), stack = [];
    for (const s of starts) if (allowed(s) && !seen.has(s)) { seen.add(s); stack.push(s); }
    while (stack.length) {
      const x = stack.pop();
      for (const y of neighbours(cfg, x)) if (allowed(y) && !seen.has(y)) { seen.add(y); stack.push(y); }
    }
    return seen;
  }
  function boundaryCells(cfg) {
    const out = [];
    for (let i = 0; i < cfg.R * cfg.C; i++) {
      const r = (i / cfg.C) | 0, c = i % cfg.C;
      if (!r || r === cfg.R - 1 || !c || c === cfg.C - 1) out.push(i);
    }
    return out;
  }

  function clueStep(cfg, state) {
    const clues = cluesOf(cfg);
    for (const q of cfg.twilight ? [] : Object.keys(clues).map(Number)) {
      if (state.black.has(q)) return { tech: 0, contradiction: true, text: `${label(cfg, q)} is numbered, so it cannot be shaded.` };
      if (!state.white.has(q)) {
        state.white.add(q);
        return { tech: 0, text: `${label(cfg, q)} contains a clue, so it is part of the unshaded cave.` };
      }
    }
    for (const [qs, n] of Object.entries(clues)) {
      if (n === '?') continue;
      const q = +qs;
      if (cfg.twilight && !state.white.has(q)) continue;
      const rays = dirs.map(d => ray(cfg, q, d[0], d[1])), lo = [], hi = [];
      for (const cells of rays) {
        let l = 0, h = 0;
        while (l < cells.length && state.white.has(cells[l])) l++;
        while (h < cells.length && !state.black.has(cells[h])) h++;
        lo.push(l); hi.push(h);
      }
      const need = n - 1, min = lo.reduce((a, b) => a + b, 0), max = hi.reduce((a, b) => a + b, 0);
      if (need < min || need > max) return { tech: 1, contradiction: true, text: `Clue ${n} at ${label(cfg, q)} can currently see between ${min + 1} and ${max + 1} cells.` };
      for (let d = 0; d < 4; d++) {
        const otherMax = max - hi[d], forced = Math.max(lo[d], need - otherMax);
        if (forced > hi[d]) return { tech: 1, contradiction: true, text: `Clue ${n} at ${label(cfg, q)} has no possible length in one direction.` };
        for (let k = lo[d]; k < forced; k++) if (!state.white.has(rays[d][k])) {
          state.white.add(rays[d][k]);
          return { tech: 1, text: `Clue ${n} at ${label(cfg, q)} needs at least ${forced} visible cell${forced === 1 ? '' : 's'} in this direction, so ${label(cfg, rays[d][k])} is unshaded.` };
        }
        const otherMin = min - lo[d], allowed = Math.min(hi[d], need - otherMin);
        // Only the first cell after the known-white prefix can be made black;
        // a farther white cell could be hidden behind an earlier black one.
        if (allowed === lo[d] && lo[d] < rays[d].length && !state.black.has(rays[d][lo[d]])) {
          const x = rays[d][lo[d]];
          if (state.white.has(x)) return { tech: 1, contradiction: true, text: `Clue ${n} at ${label(cfg, q)} would see too many cells through ${label(cfg, x)}.` };
          state.black.add(x);
          return { tech: 1, text: `Clue ${n} at ${label(cfg, q)} already has all ${need} required visible cells accounted for, so ${label(cfg, x)} stops this sight line and is shaded.` };
        }
      }
    }
    return null;
  }

  function sightFeasible(cfg, state, q, n) {
    if (n < 2 || n > cfg.R + cfg.C - 1) return false;
    const rays = dirs.map(d => ray(cfg, q, d[0], d[1]));
    let min = 1, max = 1;
    for (const cells of rays) {
      let lo = 0, hi = 0;
      while (lo < cells.length && state.white.has(cells[lo])) lo++;
      while (hi < cells.length && !state.black.has(cells[hi])) hi++;
      min += lo; max += hi;
    }
    return n >= min && n <= max;
  }

  function clueStepAt(cfg, state, q, n) {
    if (!state.white.has(q)) return null;
    const rays = dirs.map(d => ray(cfg, q, d[0], d[1])), lo = [], hi = [];
    for (const cells of rays) {
      let l = 0, h = 0;
      while (l < cells.length && state.white.has(cells[l])) l++;
      while (h < cells.length && !state.black.has(cells[h])) h++;
      lo.push(l); hi.push(h);
    }
    const need = n - 1, min = lo.reduce((a, b) => a + b, 0), max = hi.reduce((a, b) => a + b, 0);
    if (need < min || need > max) return { tech: 1, contradiction: true, text: `Clue ${n} at ${label(cfg, q)} can see at most ${max + 1} and at least ${min + 1} cells.` };
    for (let d = 0; d < 4; d++) {
      const forced = Math.max(lo[d], need - (max - hi[d]));
      for (let k = lo[d]; k < forced; k++) if (!state.white.has(rays[d][k])) {
        state.white.add(rays[d][k]);
        return { tech: 1, text: `As an unshaded ${n}, ${label(cfg, q)} needs ${label(cfg, rays[d][k])} unshaded in this sight arm.` };
      }
      const allowed = Math.min(hi[d], need - (min - lo[d]));
      if (allowed === lo[d] && lo[d] < rays[d].length && !state.black.has(rays[d][lo[d]])) {
        const x = rays[d][lo[d]];
        if (state.white.has(x)) return { tech: 1, contradiction: true, text: `The unshaded ${n} at ${label(cfg, q)} would see too many cells through ${label(cfg, x)}.` };
        state.black.add(x);
        return { tech: 1, text: `The unshaded ${n} at ${label(cfg, q)} is already satisfied, so ${label(cfg, x)} is the shaded stopper for this sight arm.` };
      }
    }
    return null;
  }

  function unequalNeighbourStep(cfg, state) {
    if (!cfg.twilight) return null;
    const clues = cluesOf(cfg), numbered = Object.keys(clues).map(Number).filter(q => clues[q] !== '?');
    for (let a = 0; a < numbered.length; a++) for (let b = a + 1; b < numbered.length; b++) {
      const x = numbered[a], y = numbered[b], dr = Math.abs(((x / cfg.C) | 0) - ((y / cfg.C) | 0)), dc = Math.abs(x % cfg.C - y % cfg.C);
      if (Math.max(dr, dc) !== 1 || clues[x] === clues[y]) continue;
      const xb = state.black.has(x), yb = state.black.has(y);
      const why = dr && dc ? 'If their two shared-corner cells were both unshaded, the four cells would make a checkerboard crossing; shading either one instead joins the two clues into one component.' : 'Orthogonally adjacent shaded cells belong to the same component.';
      if (xb && yb) return { tech: 16, contradiction: true, text: `${label(cfg, x)} has clue ${clues[x]} and ${label(cfg, y)} has clue ${clues[y]}, yet both are shaded. ${why}` };
      if (xb && !colour(state, y)) {
        state.white.add(y);
        return { tech: 16, text: `${label(cfg, x)} is a shaded ${clues[x]}. The touching clue ${clues[y]} at ${label(cfg, y)} cannot also be shaded: ${why} Therefore ${label(cfg, y)} is unshaded.` };
      }
      if (yb && !colour(state, x)) {
        state.white.add(x);
        return { tech: 16, text: `${label(cfg, y)} is a shaded ${clues[y]}. The touching clue ${clues[x]} at ${label(cfg, x)} cannot also be shaded: ${why} Therefore ${label(cfg, x)} is unshaded.` };
      }
    }
    return null;
  }

  function componentFrom(cfg, q, allowed) { return flood(cfg, [q], allowed); }
  function componentClueConflict(cfg, state, comp, n, q) {
    const clues = cluesOf(cfg);
    for (const x of comp) if (x !== q && state.black.has(x) && clues[x] !== undefined && clues[x] !== '?' && clues[x] !== n) return x;
    return -1;
  }

  function edgePathInfo(cfg, state, q, n, omitted) {
    const clues = cluesOf(cfg), blocked = x => x === omitted || state.white.has(x) || (x !== q && clues[x] !== undefined && clues[x] !== '?' && clues[x] !== n);
    if (blocked(q)) return { min: Infinity, known: new Set() };
    const known = componentFrom(cfg, q, x => !blocked(x) && (state.black.has(x) || x === q));
    const dist = new Int32Array(cfg.R * cfg.C); dist.fill(-1);
    const queue = [];
    for (const x of known) { dist[x] = known.size; queue.push(x); }
    let best = Infinity;
    for (let at = 0; at < queue.length; at++) {
      const x = queue[at], r = (x / cfg.C) | 0, c = x % cfg.C, d = dist[x];
      if (!r || r === cfg.R - 1 || !c || c === cfg.C - 1) best = Math.min(best, d);
      if (d >= Math.min(best, n + 1)) continue;
      for (const y of neighbours(cfg, x)) if (dist[y] < 0 && !blocked(y)) {
        dist[y] = d + (known.has(y) ? 0 : 1);
        queue.push(y);
      }
    }
    return { min: best, known };
  }

  function twilightClueStep(cfg, state) {
    if (!cfg.twilight) return null;
    const clues = cluesOf(cfg);
    for (const [key, n] of Object.entries(clues)) {
      if (n === '?') continue;
      const q = +key;
      if (colour(state, q)) continue;
      const whiteOK = sightFeasible(cfg, state, q, n);
      const known = componentFrom(cfg, q, x => state.black.has(x) || x === q);
      const possible = componentFrom(cfg, q, x => !state.white.has(x));
      const edge = edgePathInfo(cfg, state, q, n);
      const blackOK = known.size <= n && possible.size >= n && edge.min <= n && componentClueConflict(cfg, state, known, n, q) < 0;
      if (!whiteOK && !blackOK) return { tech: 9, contradiction: true, text: `Twilight clue ${n} at ${label(cfg, q)} can be neither a valid sight clue nor a shaded region-size clue.` };
      if (!whiteOK || !blackOK) {
        const white = !blackOK;
        mark(state, q, white);
        return { tech: 9, text: `Twilight clue ${n} at ${label(cfg, q)} cannot work as a ${white ? 'shaded region-size' : 'normal unshaded sight'} clue, so it is ${white ? 'unshaded' : 'shaded'}.` };
      }
    }
    return null;
  }

  function twilightRegionStep(cfg, state) {
    if (!cfg.twilight) return null;
    const clues = cluesOf(cfg);
    for (const [key, n] of Object.entries(clues)) {
      if (n === '?' || !state.black.has(+key)) continue;
      const q = +key, known = componentFrom(cfg, q, x => state.black.has(x));
      const possible = componentFrom(cfg, q, x => !state.white.has(x));
      const conflict = componentClueConflict(cfg, state, known, n, q);
      if (conflict >= 0) return { tech: 10, contradiction: true, text: `The same shaded component contains Twilight clues ${n} at ${label(cfg, q)} and ${clues[conflict]} at ${label(cfg, conflict)}, so it cannot have both sizes.` };
      if (known.size > n) return { tech: 10, contradiction: true, text: `The shaded component at Twilight clue ${n} in ${label(cfg, q)} already contains ${known.size} cells, which is too many.` };
      if (possible.size < n) return { tech: 10, contradiction: true, text: `The shaded component at Twilight clue ${n} in ${label(cfg, q)} can reach at most ${possible.size} cells, which is too few.` };
      if (known.size === n) {
        for (const a of known) for (const x of neighbours(cfg, a)) if (!colour(state, x)) {
          state.white.add(x);
          return { tech: 10, text: `The shaded component of clue ${n} at ${label(cfg, q)} already contains ${n} cells, so boundary cell ${label(cfg, x)} is unshaded.` };
        }
      }
      if (possible.size === n) for (const x of possible) if (!colour(state, x)) {
        state.black.add(x);
        return { tech: 10, text: `Clue ${n} at ${label(cfg, q)} can reach only ${n} possible shaded cells, so ${label(cfg, x)} belongs to that component and is shaded.` };
      }
      for (const x of possible) if (!colour(state, x)) {
        const without = componentFrom(cfg, q, y => y !== x && !state.white.has(y));
        if (without.size < n) {
          state.black.add(x);
          return { tech: 10, text: `Without ${label(cfg, x)}, the shaded component at clue ${n} could contain at most ${without.size} cells, so ${label(cfg, x)} is shaded.` };
        }
        const withCell = componentFrom(cfg, q, y => state.black.has(y) || y === x);
        if (withCell.has(x) && withCell.size > n) {
          state.white.add(x);
          return { tech: 10, text: `Shading ${label(cfg, x)} would join at least ${withCell.size} cells to the size-${n} component at ${label(cfg, q)}, so it is unshaded.` };
        }
      }
    }
    return null;
  }

  function twilightEdgeStep(cfg, state) {
    if (!cfg.twilight) return null;
    const clues = cluesOf(cfg);
    for (const [key, n] of Object.entries(clues)) {
      if (n === '?' || !state.black.has(+key)) continue;
      const q = +key, info = edgePathInfo(cfg, state, q, n);
      if (info.min > n) return { tech: 11, contradiction: true, text: `The size-${n} shaded component at ${label(cfg, q)} needs at least ${info.min === Infinity ? 'an impossible number of' : info.min} cells to reach the grid edge without crossing an incompatible clue.` };
      for (let x = 0; x < cfg.R * cfg.C; x++) if (!colour(state, x)) {
        const after = edgePathInfo(cfg, state, q, n, x);
        if (after.min > n) {
          state.black.add(x);
          return { tech: 11, text: `Every route by which the size-${n} shaded component at ${label(cfg, q)} can reach the edge in at most ${n} cells passes through ${label(cfg, x)}, so that cell is shaded.` };
        }
      }
    }
    return null;
  }

  function edgeStepAt(cfg, state, q, n) {
    if (!state.black.has(q)) return null;
    const info = edgePathInfo(cfg, state, q, n);
    if (info.min > n) return { tech: 11, contradiction: true, text: `The shaded size-${n} wall at ${label(cfg, q)} cannot reach the grid edge within ${n} cells.` };
    for (let x = 0; x < cfg.R * cfg.C; x++) if (!colour(state, x)) {
      const after = edgePathInfo(cfg, state, q, n, x);
      if (after.min > n) {
        state.black.add(x);
        return { tech: 11, text: `The shaded size-${n} wall at ${label(cfg, q)} can reach the edge within ${n} cells only through ${label(cfg, x)}, so that cell is shaded.` };
      }
    }
    return null;
  }

  function twoByTwoStep(cfg, state) {
    if (!cfg.no2x2Black && !cfg.no2x2White) return null;
    for (let r = 0; r + 1 < cfg.R; r++) for (let c = 0; c + 1 < cfg.C; c++) {
      const cells = [r * cfg.C + c, r * cfg.C + c + 1, (r + 1) * cfg.C + c, (r + 1) * cfg.C + c + 1];
      for (const spec of cfg.no2x2Black ? [{ value: -1, tech: 7, word: 'shaded' }] : []) {
        const match = cells.filter(x => colour(state, x) === spec.value), unknown = cells.filter(x => !colour(state, x));
        if (match.length === 4) return { tech: spec.tech, contradiction: true, text: `The block at r${r + 1}–${r + 2}, c${c + 1}–${c + 2} is entirely ${spec.word}.` };
        if (match.length === 3 && unknown.length === 1) { state.white.add(unknown[0]); return { tech: spec.tech, text: `Three cells of this 2×2 block are shaded, so ${label(cfg, unknown[0])} is unshaded.` }; }
      }
      for (const spec of cfg.no2x2White ? [{ value: 1, tech: 8, word: 'unshaded' }] : []) {
        const match = cells.filter(x => colour(state, x) === spec.value), unknown = cells.filter(x => !colour(state, x));
        if (match.length === 4) return { tech: spec.tech, contradiction: true, text: `The block at r${r + 1}–${r + 2}, c${c + 1}–${c + 2} is entirely ${spec.word}.` };
        if (match.length === 3 && unknown.length === 1) { state.black.add(unknown[0]); return { tech: spec.tech, text: `Three cells of this 2×2 block are unshaded, so ${label(cfg, unknown[0])} is shaded.` }; }
      }
    }
    return null;
  }

  function checkerBlockStep(cfg, state, r, c) {
    const cells = [r * cfg.C + c, r * cfg.C + c + 1, (r + 1) * cfg.C + c, (r + 1) * cfg.C + c + 1];
    for (const want of [[1, -1, -1, 1], [-1, 1, 1, -1]]) {
      let unknown = -1, bad = false;
      for (let k = 0; k < 4; k++) {
        const got = colour(state, cells[k]);
        if (!got) { if (unknown >= 0) { bad = true; break; } unknown = k; }
        else if (got !== want[k]) { bad = true; break; }
      }
      if (bad) continue;
      if (unknown < 0) return { tech: 4, contradiction: true, text: `The four cells at r${r + 1}–${r + 2}, c${c + 1}–${c + 2} form a shaded–unshaded checkerboard, which would make the cave boundary cross itself.` };
      const x = cells[unknown], white = want[unknown] === -1;
      mark(state, x, white);
      return { tech: 4, text: `${label(cfg, x)} must be ${white ? 'unshaded' : 'shaded'} to avoid a shaded–unshaded checkerboard in this 2×2 block.` };
    }
    return null;
  }

  function checkerStep(cfg, state) {
    for (let r = 0; r + 1 < cfg.R; r++) for (let c = 0; c + 1 < cfg.C; c++) {
      const mv = checkerBlockStep(cfg, state, r, c);
      if (mv) return mv;
    }
    return null;
  }

  function checkerAroundShadedClueStep(cfg, state) {
    const clues = cluesOf(cfg), seen = new Set();
    for (const key of Object.keys(clues)) {
      const q = +key;
      if (!state.black.has(q)) continue;
      const qr = (q / cfg.C) | 0, qc = q % cfg.C;
      for (const r of [qr - 1, qr]) for (const c of [qc - 1, qc]) {
        if (r < 0 || c < 0 || r + 1 >= cfg.R || c + 1 >= cfg.C) continue;
        const id = r * cfg.C + c;
        if (seen.has(id)) continue;
        seen.add(id);
        const mv = checkerBlockStep(cfg, state, r, c);
        if (mv) return mv;
      }
    }
    return null;
  }

  function localCheckerConsequences(cfg, state, start) {
    const queue = [start], moves = [], changedBlack = [];
    for (let at = 0; at < queue.length && moves.length < 8; at++) {
      const q = queue[at], qr = (q / cfg.C) | 0, qc = q % cfg.C;
      for (const r of [qr - 1, qr]) for (const c of [qc - 1, qc]) {
        if (r < 0 || c < 0 || r + 1 >= cfg.R || c + 1 >= cfg.C) continue;
        const beforeWhite = new Set(state.white), beforeBlack = new Set(state.black);
        const mv = checkerBlockStep(cfg, state, r, c);
        if (!mv) continue;
        moves.push(mv);
        if (mv.contradiction) return { moves, contradiction: true, changedBlack };
        let changed = -1, becameBlack = false;
        for (const x of state.white) if (!beforeWhite.has(x)) { changed = x; break; }
        if (changed < 0) for (const x of state.black) if (!beforeBlack.has(x)) { changed = x; becameBlack = true; break; }
        if (changed >= 0) {
          queue.push(changed);
          if (becameBlack) changedBlack.push(changed);
        }
      }
    }
    return { moves, contradiction: false, changedBlack };
  }

  function topologyEdgeStep(cfg, state) {
    if (!cfg.twilight) return null;
    const clues = cluesOf(cfg), N = cfg.R * cfg.C;
    for (let x = 0; x < N; x++) {
      if (colour(state, x)) continue;
      const ghost = cloneState(state);
      ghost.black.add(x);
      const local = localCheckerConsequences(cfg, ghost, x);
      if (!local.changedBlack.length && !local.contradiction) continue;
      if (local.contradiction) {
        state.white.add(x);
        return {
          tech: 18,
          chainIntro: `Suppose ${label(cfg, x)} were shaded. Then:`,
          chain: local.moves,
          chainOutro: `So ${label(cfg, x)} is unshaded.`,
          text: `Shading ${label(cfg, x)} immediately creates an impossible checkerboard chain, so it is unshaded.`
        };
      }
      for (const [key, n] of Object.entries(clues)) {
        const q = +key;
        if (n === '?' || !ghost.black.has(q)) continue;
        const info = edgePathInfo(cfg, ghost, q, n);
        if (info.min <= n) continue;
        const joined = local.changedBlack.map(i => label(cfg, i)).join(', ');
        const edgeFailure = info.min === Infinity
          ? `It would have no route through the remaining available cells to the grid edge, so it cannot reach the edge within its size ${n}.`
          : `It would need at least ${info.min} cells to reach the grid edge, exceeding its size ${n}.`;
        state.white.add(x);
        return {
          tech: 18,
          chainIntro: `Suppose ${label(cfg, x)} were shaded. Avoiding a checkerboard would then force ${joined} shaded:`,
          chain: local.moves.concat({
            tech: 11,
            contradiction: true,
            text: `Those cells join the size-${n} shaded wall at ${label(cfg, q)}. ${edgeFailure}`
          }),
          chainOutro: `Therefore ${label(cfg, x)} is unshaded.`,
          text: `Shading ${label(cfg, x)} would force another shaded cell to avoid a checkerboard, enlarging the size-${n} wall at ${label(cfg, q)} beyond any edge-reaching route. Therefore it is unshaded.`
        };
      }
    }
    return null;
  }

  function differentWallSeparationStep(cfg, state) {
    if (!cfg.twilight) return null;
    const clues = cluesOf(cfg), N = cfg.R * cfg.C, componentId = new Int32Array(N);
    componentId.fill(-1);
    const components = [];
    for (let start = 0; start < N; start++) {
      if (!state.black.has(start) || componentId[start] >= 0) continue;
      const cells = componentFrom(cfg, start, x => state.black.has(x)), id = components.length;
      const numbered = [];
      for (const x of cells) {
        componentId[x] = id;
        if (clues[x] !== undefined && clues[x] !== '?') numbered.push({ cell: x, value: clues[x] });
      }
      components.push({ cells, numbered });
    }
    for (let x = 0; x < N; x++) {
      if (colour(state, x)) continue;
      const touching = [...new Set(neighbours(cfg, x).map(y => componentId[y]).filter(id => id >= 0))];
      for (let a = 0; a < touching.length; a++) for (let b = a + 1; b < touching.length; b++) {
        const left = components[touching[a]].numbered, right = components[touching[b]].numbered;
        for (const p of left) for (const q of right) {
          if (p.value === q.value) continue;
          state.white.add(x);
          return {
            tech: 19,
            text: `${label(cfg, x)} touches the shaded size-${p.value} wall containing ${label(cfg, p.cell)} and the shaded size-${q.value} wall containing ${label(cfg, q.cell)}. If it were shaded, those orthogonally connected walls would become one component with two different required sizes. Therefore ${label(cfg, x)} is unshaded.`
          };
        }
      }
    }
    return null;
  }

  function diagonalWallContactStep(cfg, state) {
    if (!cfg.twilight) return null;
    const clues = cluesOf(cfg), N = cfg.R * cfg.C;
    for (const q of Object.keys(clues).map(Number)) {
      const n = clues[q];
      if (n === '?' || colour(state, q)) continue;
      const qr = (q / cfg.C) | 0, qc = q % cfg.C;
      for (const dr of [-1, 1]) for (const dc of [-1, 1]) {
        const r = qr + dr, c = qc + dc;
        if (r < 0 || r >= cfg.R || c < 0 || c >= cfg.C) continue;
        const y = r * cfg.C + c;
        if (!state.black.has(y)) continue;
        const wall = componentFrom(cfg, y, x => state.black.has(x));
        const shared = [(qr + dr) * cfg.C + qc, qr * cfg.C + qc + dc];
        const existingBridge = shared.find(x => state.black.has(x));
        const minimum = wall.size + 1 + (existingBridge === undefined ? 1 : 0);
        if (minimum <= n) continue;
        state.white.add(q);
        const bridgeText = existingBridge === undefined
          ? `To avoid a checkerboard, either ${label(cfg, shared[0])} or ${label(cfg, shared[1])} would also have to be shaded, joining the two diagonal walls.`
          : `${label(cfg, existingBridge)} is already the shaded bridge joining those diagonal cells.`;
        return {
          tech: 22,
          text: `Suppose clue ${n} at ${label(cfg, q)} were shaded. It would touch the shaded wall at ${label(cfg, y)} diagonally. ${bridgeText} That wall already has ${wall.size} shaded cell${wall.size === 1 ? '' : 's'}; with the clue${existingBridge === undefined ? ' and required bridge' : ''}, the joined wall would contain at least ${minimum}, exceeding size ${n}. Therefore ${label(cfg, q)} is unshaded.`
        };
      }
    }
    return null;
  }

  function connectivityStep(cfg, state) {
    const N = cfg.R * cfg.C, whites = [...state.white];
    if (!whites.length) return null;
    const root = whites[0], possible = x => !state.black.has(x), reach = flood(cfg, [root], possible);
    for (const w of whites) if (!reach.has(w)) return { tech: 2, contradiction: true, text: `${label(cfg, w)} cannot connect to the rest of the unshaded cave.` };
    for (let x = 0; x < N; x++) if (!colour(state, x) && !reach.has(x)) {
      state.black.add(x);
      return { tech: 2, text: `${label(cfg, x)} cannot possibly connect to the known unshaded cave, so it is shaded.` };
    }
    for (let x = 0; x < N; x++) if (!colour(state, x)) {
      const without = flood(cfg, [root], y => y !== x && !state.black.has(y));
      if (whites.some(w => !without.has(w))) {
        state.white.add(x);
        return { tech: 2, text: `${label(cfg, x)} is the only remaining connection between known parts of the cave, so it is unshaded.` };
      }
    }
    return null;
  }

  function outsideStep(cfg, state) {
    const N = cfg.R * cfg.C, edge = boundaryCells(cfg), blacks = [...state.black];
    const possible = x => !state.white.has(x), reach = flood(cfg, edge, possible);
    for (const b of blacks) if (!reach.has(b)) return { tech: 3, contradiction: true, text: `The shaded cell ${label(cfg, b)} has been sealed away from the edge of the grid.` };
    for (let x = 0; x < N; x++) if (!colour(state, x) && !reach.has(x)) {
      state.white.add(x);
      return { tech: 3, text: `If ${label(cfg, x)} were shaded it could not reach the outside edge, so it is unshaded.` };
    }
    for (let x = 0; x < N; x++) if (!colour(state, x)) {
      const without = flood(cfg, edge.filter(e => e !== x), y => y !== x && !state.white.has(y));
      if (blacks.some(b => !without.has(b))) {
        state.black.add(x);
        return { tech: 3, text: `${label(cfg, x)} is the only remaining escape from a shaded region to the grid edge, so it is shaded.` };
      }
    }
    return null;
  }

  function blackExistsStep(cfg, state) {
    if (state.black.size) return null;
    const unknown = [];
    for (let i = 0; i < cfg.R * cfg.C; i++) if (!state.white.has(i)) unknown.push(i);
    if (!unknown.length) return { tech: 5, contradiction: true, text: 'Every cell is unshaded, so there is no boundary loop around a proper cave.' };
    if (unknown.length === 1) {
      state.black.add(unknown[0]);
      return { tech: 5, text: `${label(cfg, unknown[0])} is the last cell that can be shaded; the Cave must contain at least one shaded cell.` };
    }
    return null;
  }

  function primitiveStep(cfg, state) {
    setup(state);
    for (const fn of [clueStep, twoByTwoStep, unequalNeighbourStep, twilightClueStep, twilightRegionStep, twilightEdgeStep, checkerStep, connectivityStep, outsideStep, blackExistsStep]) {
      const mv = fn(cfg, state);
      if (mv) return mv;
    }
    return null;
  }

  function armDistributions(total, caps, at, prefix, out, limit) {
    if (out.length > limit) return;
    if (at === 3) {
      if (total <= caps[at]) out.push(prefix.concat(total));
      return;
    }
    for (let n = 0; n <= Math.min(total, caps[at]); n++) armDistributions(total - n, caps, at + 1, prefix.concat(n), out, limit);
  }

  function armDescription(lengths) {
    const names = ['up', 'down', 'left', 'right'];
    return names.map((name, d) => `${name} ${lengths[d]}`).join(', ');
  }

  function sightTotalSurvives(cfg, state, q, total, limit) {
    const rays = dirs.map(d => ray(cfg, q, d[0], d[1])), distributions = [];
    armDistributions(total, rays.map(cells => cells.length), 0, [], distributions, limit);
    if (distributions.length > limit) return null;
    const localClues = { ...(cfg.clues || {}), [q]: total + 1 }, localCfg = { ...cfg, clues: localClues };
    for (const lengths of distributions) {
      const ghost = cloneState(state), linked = new Set([q]);
      ghost.white.add(q);
      let bad = false;
      for (let d = 0; d < 4 && !bad; d++) {
        for (let k = 0; k < lengths[d]; k++) {
          const x = rays[d][k];
          if (ghost.black.has(x)) { bad = true; break; }
          ghost.white.add(x);
          if (localClues[x] !== undefined && localClues[x] !== '?') linked.add(x);
        }
        if (!bad && lengths[d] < rays[d].length) {
          const x = rays[d][lengths[d]];
          if (ghost.white.has(x)) bad = true;
          else ghost.black.add(x);
        }
      }
      if (bad) continue;
      for (let k = 0; k < 12 && !bad; k++) {
        let changed = false;
        for (const p of [...linked]) {
          if (!ghost.white.has(p) || localClues[p] === undefined || localClues[p] === '?') continue;
          const beforeWhite = ghost.white.size, beforeBlack = ghost.black.size;
          const mv = clueStepAt(localCfg, ghost, p, localClues[p]);
          if (mv && mv.contradiction) { bad = true; break; }
          if (ghost.white.size !== beforeWhite || ghost.black.size !== beforeBlack) {
            changed = true;
            for (const x of ghost.white) if (localClues[x] !== undefined && localClues[x] !== '?') linked.add(x);
          }
        }
        if (!changed) break;
      }
      if (!bad) return true;
    }
    return false;
  }

  function twilightSightCapacityStep(cfg, state) {
    if (!cfg.twilight) return null;
    const clues = cluesOf(cfg), numeric = Object.keys(clues).map(Number).filter(q => clues[q] !== '?');
    const candidates = numeric
      .filter(q => !colour(state, q))
      .sort((a, b) => clues[b] - clues[a] || a - b);
    for (const q of candidates) {
      const target = clues[q] - 1, exact = sightTotalSurvives(cfg, state, q, target, 600);
      if (exact !== false) continue;
      let maximum = 0;
      for (let total = target - 1; total >= 0; total--) {
        const survives = sightTotalSurvives(cfg, state, q, total, 600);
        if (survives === null) { maximum = -1; break; }
        if (survives) { maximum = total + 1; break; }
      }
      if (maximum < 0) continue;
      const linked = [];
      for (const [dr, dc] of dirs) {
        const cells = ray(cfg, q, dr, dc);
        for (let distance = 0; distance < Math.min(cells.length, target); distance++) {
          const x = cells[distance];
          if (state.black.has(x)) break;
          if (clues[x] !== undefined && clues[x] !== '?') { linked.push(x); break; }
        }
      }
      state.black.add(q);
      const linkedText = linked.length
        ? ` Any sight arm reaching ${linked.map(x => `the ${clues[x]} at ${label(cfg, x)}`).join(' or ')} makes that encountered clue unshaded too, so its own sight count restricts the shared line.`
        : '';
      return {
        tech: 20,
        text: `If clue ${clues[q]} at ${label(cfg, q)} were unshaded, its four sight arms could show at most ${maximum} cells including the clue.${linkedText} It needs ${clues[q]}, so the unshaded reading is impossible and ${label(cfg, q)} is shaded.`
      };
    }
    return null;
  }

  function shortClueColourCase(cfg, state, q, n, white) {
    const ghost = cloneState(state), reasons = [];
    mark(ghost, q, white);
    for (let k = 0; k < 8; k++) {
      const mv = white ? clueStepAt(cfg, ghost, q, n) : edgeStepAt(cfg, ghost, q, n);
      if (!mv) break;
      reasons.push(mv);
      if (mv.contradiction) return { state: ghost, reasons, bad: true };
    }
    return { state: ghost, reasons, bad: false };
  }

  function twilightColourAgreementStep(cfg, state) {
    if (!cfg.twilight) return null;
    const clues = cluesOf(cfg);
    for (const q of Object.keys(clues).map(Number)) {
      if (clues[q] === '?' || colour(state, q)) continue;
      const whiteCase = shortClueColourCase(cfg, state, q, clues[q], true), blackCase = shortClueColourCase(cfg, state, q, clues[q], false);
      if (whiteCase.bad || blackCase.bad) continue;
      const nearby = [];
      for (let distance = 1; distance < Math.max(cfg.R, cfg.C); distance++) for (const [dr, dc] of dirs) {
        const r = ((q / cfg.C) | 0) + dr * distance, c = q % cfg.C + dc * distance;
        if (r >= 0 && r < cfg.R && c >= 0 && c < cfg.C) nearby.push(r * cfg.C + c);
      }
      for (const x of nearby) {
        if (colour(state, x)) continue;
        const white = whiteCase.state.white.has(x) && blackCase.state.white.has(x);
        const black = whiteCase.state.black.has(x) && blackCase.state.black.has(x);
        if (!white && !black) continue;
        mark(state, x, white);
        const blackChain = blackCase.reasons.length && blackCase.reasons.every(mv => mv.tech === 11 && !mv.contradiction)
          ? [{ tech: 11, text: `As a shaded size-${clues[q]} clue, ${label(cfg, q)} has only one route short enough to reach the grid edge; that route passes through ${label(cfg, x)}, so ${label(cfg, x)} is shaded.` }]
          : blackCase.reasons;
        return {
          tech: 21,
          cases: [
            { intro: `If clue ${clues[q]} at ${label(cfg, q)} is an unshaded sight clue:`, chain: whiteCase.reasons },
            { intro: `If clue ${clues[q]} at ${label(cfg, q)} is a shaded size clue:`, chain: blackChain }
          ],
          text: `Both readings of Twilight clue ${clues[q]} at ${label(cfg, q)} make ${label(cfg, x)} ${white ? 'unshaded' : 'shaded'}. Therefore that common result is forced.`
        };
      }
    }
    return null;
  }

  function sightProofPrimitive(cfg, state) {
    // Finish the geometry created by a sight pattern before moving to another
    // clue. Humans naturally draw the forced edge route and close its boundary
    // as one idea; the normal one-cell scan order can interleave distractions.
    for (const fn of [twilightEdgeStep, twilightRegionStep, unequalNeighbourStep, checkerAroundShadedClueStep, clueStep, checkerStep, twoByTwoStep, twilightClueStep, connectivityStep, outsideStep, blackExistsStep]) {
      const mv = fn(cfg, state);
      if (mv) return mv;
    }
    return null;
  }

  function compressProof(reasons) {
    const out = [];
    for (const mv of reasons) {
      const previous = out[out.length - 1];
      const clue = String(mv.text || '').match(/(?:Clue|clue) \d+ at (r\d+c\d+)/);
      const group = `${mv.tech}:${clue ? clue[1] : ''}`;
      if (previous && previous.group === group && !previous.contradiction) {
        previous.text += ` ${mv.text}`;
        previous.contradiction = !!mv.contradiction;
      } else out.push({ tech: mv.tech, text: mv.text, contradiction: !!mv.contradiction, group });
    }
    return out.map(({ group, ...mv }) => mv);
  }

  function visibleOverrun(cfg, state) {
    const clues = cluesOf(cfg);
    for (const [key, n] of Object.entries(clues)) {
      const q = +key;
      if (n === '?' || !state.white.has(q)) continue;
      const visible = [q];
      for (const [dr, dc] of dirs) {
        const cells = ray(cfg, q, dr, dc);
        for (const x of cells) {
          if (!state.white.has(x)) break;
          visible.push(x);
        }
      }
      if (visible.length > n) return `Clue ${n} at ${label(cfg, q)} would already see ${visible.length} cells (${visible.map(x => label(cfg, x)).join(', ')}), which is too many.`;
    }
    return null;
  }

  function sightPatternStep(cfg, state) {
    const clues = cluesOf(cfg), N = cfg.R * cfg.C;
    for (const [key, n] of Object.entries(clues)) {
      const q = +key;
      if (n === '?' || !state.white.has(q)) continue;
      const rays = dirs.map(d => ray(cfg, q, d[0], d[1])), distributions = [];
      armDistributions(n - 1, rays.map(cells => cells.length), 0, [], distributions, 120);
      // A large list is not a useful human step. Leave it to overlapping bounds
      // or a later, smaller local situation instead of presenting bulk search.
      if (!distributions.length || distributions.length > 120) continue;
      const patterns = [];
      for (const lengths of distributions) {
        const ghost = cloneState(state), initialWhite = [], initialBlack = [];
        let bad = false;
        for (let d = 0; d < 4; d++) {
          for (let k = 0; k < lengths[d]; k++) {
            const x = rays[d][k];
            if (ghost.black.has(x)) { bad = true; break; }
            if (!ghost.white.has(x)) initialWhite.push(x);
            ghost.white.add(x);
          }
          if (bad) break;
          if (lengths[d] < rays[d].length) {
            const x = rays[d][lengths[d]];
            if (ghost.white.has(x)) { bad = true; break; }
            if (!ghost.black.has(x)) initialBlack.push(x);
            ghost.black.add(x);
          }
        }
        const reasons = [];
        if (!bad) for (let k = 0; k < 36; k++) {
          const mv = sightProofPrimitive(cfg, ghost);
          if (!mv) break;
          if (mv.contradiction && mv.tech === 1) mv.text = visibleOverrun(cfg, ghost) || mv.text;
          reasons.push(mv);
          if (mv.contradiction) { bad = true; break; }
        }
        patterns.push({ lengths, state: ghost, initialWhite, initialBlack, reasons, bad });
      }
      const survivors = patterns.filter(p => !p.bad);
      if (!survivors.length) return { tech: 17, contradiction: true, text: `No distribution of the ${n - 1} cells beyond clue ${n} at ${label(cfg, q)} among its four sight-line arms survives the visible Cave rules.` };
      const order = [];
      for (let distance = 1; distance < Math.max(cfg.R, cfg.C); distance++) for (let d = 0; d < 4; d++) if (rays[d][distance - 1] !== undefined) order.push(rays[d][distance - 1]);
      for (let x = 0; x < N; x++) if (!order.includes(x)) order.push(x);
      for (const x of order) {
        if (colour(state, x)) continue;
        const white = survivors.every(p => p.state.white.has(x)), black = survivors.every(p => p.state.black.has(x));
        if (!white && !black) continue;
        const opposite = patterns.filter(p => {
          const initial = white ? p.initialBlack.includes(x) : p.initialWhite.includes(x);
          return initial;
        });
        // Only expose a conclusion when its contrary has a short, concrete list
        // of arm distributions. This keeps the rule explanatory and human-sized.
        if (!opposite.length || opposite.length > 4 || opposite.some(p => !p.bad)) continue;
        mark(state, x, white);
        const wanted = white ? 'unshaded' : 'shaded', contrary = white ? 'shaded' : 'unshaded';
        const makeIntro = p => {
          const whites = p.initialWhite.map(i => label(cfg, i)).join(', ') || 'none';
          const blacks = p.initialBlack.map(i => label(cfg, i)).join(', ') || 'none';
          return `If ${label(cfg, x)} were ${contrary}, clue ${n} at ${label(cfg, q)} would need the arm distribution ${armDescription(p.lengths)}. Its visible arm cells would be ${whites}, with shaded stoppers at ${blacks}:`;
        };
        if (opposite.length === 1) return {
          tech: 17,
          chainIntro: makeIntro(opposite[0]),
          chain: compressProof(opposite[0].reasons),
          chainOutro: `That distribution is impossible. Every remaining sight-line distribution makes ${label(cfg, x)} ${wanted}.`,
          text: `The only sight-line distribution that could make ${label(cfg, x)} ${contrary} contradicts the visible Cave rules, so it is ${wanted}.`
        };
        return {
          tech: 17,
          cases: opposite.map((p, i) => ({ intro: `Contrary distribution ${i + 1}: ${makeIntro(p)}`, chain: compressProof(p.reasons) })),
          text: `Each of the ${opposite.length} sight-line distributions that could make ${label(cfg, x)} ${contrary} leads to a narrated contradiction. Therefore ${label(cfg, x)} is ${wanted}.`
        };
      }
    }
    return null;
  }

  function directStep(cfg, state) {
    return primitiveStep(cfg, state) || twilightSightCapacityStep(cfg, state) || topologyEdgeStep(cfg, state) || differentWallSeparationStep(cfg, state) || twilightColourAgreementStep(cfg, state) || diagonalWallContactStep(cfg, state) || sightPatternStep(cfg, state);
  }

  function clueClusters(cfg) {
    const clues = cluesOf(cfg), numeric = new Set(Object.keys(clues).map(Number).filter(q => clues[q] !== '?')), seen = new Set(), out = [];
    for (const start of numeric) if (!seen.has(start)) {
      const comp = [], stack = [start]; seen.add(start);
      while (stack.length) {
        const q = stack.pop(); comp.push(q);
        for (const x of neighbours(cfg, q)) if (numeric.has(x) && !seen.has(x)) { seen.add(x); stack.push(x); }
      }
      if (comp.length >= 2 && comp.length <= 6) out.push(comp.sort((a, b) => a - b));
    }
    return out.sort((a, b) => b.length - a.length || a[0] - b[0]);
  }

  function clusterPattern(cfg, cluster, st) {
    return cluster.map(q => `${label(cfg, q)}=${st.white.has(q) ? 'unshaded' : st.black.has(q) ? 'shaded' : '?'}`).join(', ');
  }

  function inlineReason(text) {
    return String(text || '').replace(/[.]+$/, '').replace(/^The /, 'the ').replace(/^Twilight /, 'twilight ').replace(/^Clue /, 'clue ');
  }

  function explainClusterOpposite(cfg, state, cluster, x, forcedWhite) {
    const oppositeWhite = !forcedWhite, assumed = cloneState(state), prefix = [];
    mark(assumed, x, oppositeWhite);
    for (let n = 0; n < 12; n++) {
      const mv = primitiveStep(cfg, assumed);
      if (!mv) break;
      prefix.push(mv);
      if (mv.contradiction) {
        return `Assume ${label(cfg, x)} were ${oppositeWhite ? 'unshaded' : 'shaded'}. ${prefix.map(m => m.text).join(' ')} Therefore ${label(cfg, x)} is ${forcedWhite ? 'unshaded' : 'shaded'}.`;
      }
    }
    const remaining = cluster.filter(q => !colour(assumed, q));
    if (remaining.length > 6) return null;
    const cases = [];
    for (let mask = 0; mask < (1 << remaining.length); mask++) {
      const ghost = cloneState(assumed);
      for (let k = 0; k < remaining.length; k++) mark(ghost, remaining[k], !!(mask & (1 << k)));
      const start = cloneState(ghost), reasons = [];
      let bad = false;
      for (let n = 0; n < 24; n++) {
        const mv = primitiveStep(cfg, ghost);
        if (!mv) break;
        reasons.push(mv);
        if (mv.contradiction) { bad = true; break; }
      }
      if (!bad) return null;
      cases.push({ start, why: reasons[reasons.length - 1] });
    }
    const intro = `Assume ${label(cfg, x)} were ${oppositeWhite ? 'unshaded' : 'shaded'}.`;
    const immediate = prefix.length ? ` Immediate deductions give: ${prefix.slice(0, 4).map(m => m.text).join(' ')}${prefix.length > 4 ? ` (${prefix.length - 4} further immediate marks follow.)` : ''}` : '';
    let caseText;
    if (cases.length <= 4) {
      caseText = ` The remaining clue colors give ${cases.length} local case${cases.length === 1 ? '' : 's'}: ` + cases.map((cs, i) => `case ${i + 1} (${clusterPattern(cfg, cluster, cs.start)}) fails because ${inlineReason(cs.why.text)}`).join('; ') + '.';
    } else {
      const groups = new Map();
      for (const cs of cases) {
        const key = cs.why.tech;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(cs);
      }
      caseText = ` All ${cases.length} remaining local colorings fail: ` + [...groups].map(([tech, list]) => `${list.length} by ${(techniques[tech] || ['a direct rule'])[0]} (for example, ${inlineReason(list[0].why.text)})`).join('; ') + '.';
    }
    return `${intro}${immediate}${caseText} Therefore the opposite assumption is impossible, and ${label(cfg, x)} is ${forcedWhite ? 'unshaded' : 'shaded'}.`;
  }

  function clueClusterStep(cfg, state) {
    if (!cfg.twilight) return null;
    const clues = cluesOf(cfg);
    for (const cluster of clueClusters(cfg)) {
      const undecided = cluster.filter(q => !colour(state, q));
      if (!undecided.length || undecided.length > 6) continue;
      const survivors = [], rejected = [];
      for (let mask = 0; mask < (1 << undecided.length); mask++) {
        const ghost = cloneState(state), reasons = [];
        for (let k = 0; k < undecided.length; k++) mark(ghost, undecided[k], !!(mask & (1 << k)));
        let bad = false;
        for (let n = 0; n < 24; n++) {
          const mv = primitiveStep(cfg, ghost);
          if (!mv) break;
          reasons.push(mv);
          if (mv.contradiction) { bad = true; break; }
        }
        if (!bad) survivors.push({ state: ghost, reasons, mask });
        else rejected.push({ state: ghost, reasons, mask, why: reasons[reasons.length - 1] });
      }
      const name = cluster.map(q => clues[q]).join('–');
      if (!survivors.length) return { tech: 15, contradiction: true, text: `Every immediate shading pattern for the adjacent Twilight clue cluster ${name} contradicts a clue or edge-reach rule.` };
      const near = x => cluster.some(q => Math.abs(((q / cfg.C) | 0) - ((x / cfg.C) | 0)) + Math.abs(q % cfg.C - x % cfg.C) <= 3);
      const order = undecided.concat(Array.from({ length: cfg.R * cfg.C }, (_, i) => i).filter(x => !undecided.includes(x) && !colour(state, x) && near(x)));
      for (const x of order) {
        const white = survivors.every(s => s.state.white.has(x)), black = survivors.every(s => s.state.black.has(x));
        if (!white && !black) continue;
        const proof = explainClusterOpposite(cfg, state, cluster, x, white);
        mark(state, x, white);
        if (proof) return { tech: 15, text: proof };
        const patternText = survivors.length === 1 ? `The surviving clue-color pattern is ${clusterPattern(cfg, cluster, survivors[0].state)}.` : `The ${survivors.length} surviving clue-color patterns all agree.`;
        let rejection = '';
        if (rejected.length) {
          const closest = rejected.sort((a, b) => b.reasons.length - a.reasons.length)[0];
          rejection = ` A competing pattern (${clusterPattern(cfg, cluster, closest.state)}) fails because ${closest.why.text.replace(/^The /, 'the ')}`;
        }
        return { tech: 15, text: `${patternText}${rejection} Therefore ${label(cfg, x)} is ${white ? 'unshaded' : 'shaded'}.` };
      }
    }
    return null;
  }

  function basicStep(cfg, state) {
    const direct = directStep(cfg, state);
    return direct || clueClusterStep(cfg, state);
  }

  function trialCandidates(cfg, state) {
    const clues = cluesOf(cfg), out = [];
    for (let x = 0; x < cfg.R * cfg.C; x++) if (!colour(state, x)) {
      const r = (x / cfg.C) | 0, c = x % cfg.C;
      let score = (clues[x] !== undefined ? 100 : 0) + neighbours(cfg, x).filter(y => colour(state, y)).length * 12;
      if (!r || r === cfg.R - 1 || !c || c === cfg.C - 1) score += 3;
      out.push({ x, score });
    }
    return out.sort((a, b) => b.score - a.score || a.x - b.x).map(e => e.x);
  }

  function propagateHuman(cfg, start, budget) {
    const ghost = cloneState(start), reasons = [];
    for (let k = 0; k < budget; k++) {
      const mv = basicStep(cfg, ghost);
      if (!mv) return { state: ghost, reasons, bad: false };
      reasons.push(mv);
      if (mv.contradiction) return { state: ghost, reasons, bad: true, why: mv.text };
    }
    return { state: ghost, reasons, bad: false, capped: true };
  }

  function assumedRun(cfg, state, x, white, budget) {
    const start = cloneState(state); mark(start, x, white);
    return propagateHuman(cfg, start, budget);
  }

  function commonConclusion(cfg, original, a, b) {
    for (const x of trialCandidates(cfg, original)) {
      if (a.white.has(x) && b.white.has(x)) return { x, white: true };
      if (a.black.has(x) && b.black.has(x)) return { x, white: false };
    }
    return null;
  }

  function humanTrials(cfg, state, options) {
    const budget = options && options.deep ? 100 : 10;
    const candidates = trialCandidates(cfg, state).slice(0, options && options.deep ? 100 : 45), records = [];
    for (const x of candidates) {
      const white = assumedRun(cfg, state, x, true, budget), black = assumedRun(cfg, state, x, false, budget);
      if (white.bad && black.bad) return { tech: 6, contradiction: true, text: `Both colours of ${label(cfg, x)} produce human-rule contradictions.` };
      if (white.bad || black.bad) {
        const dead = white.bad ? white : black, forcedWhite = black.bad;
        mark(state, x, forcedWhite);
        return {
          tech: 6, chain: dead.reasons,
          chainIntro: `Suppose ${label(cfg, x)} were ${forcedWhite ? 'shaded' : 'unshaded'}. Then:`,
          chainOutro: `So ${label(cfg, x)} is ${forcedWhite ? 'unshaded' : 'shaded'}.`,
          text: `A human-rule chain contradicts ${label(cfg, x)} being ${forcedWhite ? 'shaded' : 'unshaded'}, so the other colour is forced.`
        };
      }
      records.push({ x, white, black });
    }
    for (const rec of records) {
      const shared = commonConclusion(cfg, state, rec.white.state, rec.black.state);
      if (!shared) continue;
      mark(state, shared.x, shared.white);
      return {
        tech: 12,
        cases: [
          { intro: `Case 1 — ${label(cfg, rec.x)} is unshaded:`, chain: rec.white.reasons },
          { intro: `Case 2 — ${label(cfg, rec.x)} is shaded:`, chain: rec.black.reasons }
        ],
        text: `Whether ${label(cfg, rec.x)} is unshaded or shaded, both human-rule chains make ${label(cfg, shared.x)} ${shared.white ? 'unshaded' : 'shaded'}, so that common conclusion is forced.`
      };
    }
    return null;
  }

  function forcingBifurcation(cfg, state, options) {
    const outerCandidates = trialCandidates(cfg, state).slice(0, options && options.deep ? 30 : 12), budget = options && options.deep ? 80 : 35;
    for (const x of outerCandidates) for (const white of [true, false]) {
      const outer = assumedRun(cfg, state, x, white, budget);
      if (outer.bad) continue;
      for (const y of trialCandidates(cfg, outer.state).slice(0, options && options.deep ? 35 : 14)) {
        const a = assumedRun(cfg, outer.state, y, true, budget), b = assumedRun(cfg, outer.state, y, false, budget);
        if (!a.bad || !b.bad) continue;
        mark(state, x, !white);
        const prefix = outer.reasons;
        return {
          tech: 13,
          cases: [
            { intro: `Under the assumption that ${label(cfg, x)} is ${white ? 'unshaded' : 'shaded'}, case 1 — ${label(cfg, y)} is unshaded:`, chain: prefix.concat(a.reasons) },
            { intro: `Under the same assumption, case 2 — ${label(cfg, y)} is shaded:`, chain: prefix.concat(b.reasons) }
          ],
          text: `Assume ${label(cfg, x)} is ${white ? 'unshaded' : 'shaded'}. The later cell ${label(cfg, y)} must have one of two colours, but both continuations contradict the human rules. Therefore ${label(cfg, x)} is ${white ? 'shaded' : 'unshaded'}.`
        };
      }
    }
    return null;
  }

  function exhaustiveTrial(cfg, state) {
    if (!G.CaveEngine || !G.CaveEngine.solve) return null;
    const N = cfg.R * cfg.C;
    for (let x = 0; x < N; x++) if (!colour(state, x)) {
      const base = { ...cfg, white: [...state.white], black: [...state.black], maxSolutions: 1, time: Math.max(1, Math.min(+(cfg.time || 10), 15)) };
      const asWhite = G.CaveEngine.solve({ ...base, white: base.white.concat(x) }, base.time);
      const asBlack = G.CaveEngine.solve({ ...base, black: base.black.concat(x) }, base.time);
      if (asWhite.error || asBlack.error || asWhite.timed || asBlack.timed) continue;
      const wOK = asWhite.solutions.length > 0, bOK = asBlack.solutions.length > 0;
      if (!wOK && !bOK) return { tech: 14, contradiction: true, text: `Neither colour for ${label(cfg, x)} can lead to a valid Cave.` };
      if (!wOK || !bOK) {
        const white = !bOK;
        mark(state, x, white);
        return { tech: 14, text: `The complete exact model has no solution with ${label(cfg, x)} ${white ? 'shaded' : 'unshaded'}, so ${label(cfg, x)} is ${white ? 'unshaded' : 'shaded'}.` };
      }
    }
    return null;
  }

  function completeStatus(cfg, state) {
    const N = cfg.R * cfg.C;
    if (state.white.size + state.black.size < N) return null;
    // With a full colouring, the basic checks report every violation.
    const probe = cloneState(state), bad = basicStep(cfg, probe);
    if (bad && bad.contradiction) return bad;
    return { done: true, complete: true, text: `Every cell is decided; the cave is connected, every shaded region reaches the edge, and all ${cfg.twilight ? 'Twilight and ' : ''}active clue and 2×2 rules are satisfied.` };
  }

  function step(cfg, state, options) {
    setup(state);
    const mv = basicStep(cfg, state);
    if (mv) return mv;
    const complete = completeStatus(cfg, state);
    if (complete) return complete;
    if (!(options && options.noTrial)) {
      const trial = humanTrials(cfg, state, options);
      if (trial) return trial;
      // Deep bifurcation and exact cell tests are diagnostic-only. The visible
      // human ladder deliberately stops and asks for a better rule instead.
      if (options && options.allowBifurcation) {
        const fork = forcingBifurcation(cfg, state, options);
        if (fork) return fork;
      }
      if (options && options.allowExact && !options.noExact) {
        const exact = exhaustiveTrial(cfg, state);
        if (exact) return exact;
      }
    }
    return { done: true, complete: false, text: 'No further quick human deduction was found. The ladder stops here rather than escalating to a deep bifurcation; this position needs a stronger general human rule.' };
  }

  G.CaveStepper = { techniques, techniqueSections, step, cloneState, basicStep, directStep, colour };
  if (typeof module !== 'undefined') module.exports = G.CaveStepper;
})(typeof globalThis !== 'undefined' ? globalThis : this);
