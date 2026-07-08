
// U-Bahn solver core v2.
// Exact true-candidate computation: per-edge and per-cell satisfiability tests
// instead of full enumeration, so results are exact even when the solution
// count is astronomical.
//
// Statuses: 0 = never (in no solution), 1 = sometimes, 2 = always, 3 = undetermined (time limit)

function makeEngine(cfg, post) {
  const R = cfg.R, C = cfg.C, N = R * C;
  const blocked = cfg.blocked;
  // internal stride-5 clue arrays: shapes 0..3 plus 4 = empty (unused cell; a
  // shaded cell counts as empty). Empty clues arrive via cfg.rowEmpty/colEmpty.
  const rowClue = new Int32Array(R * 5).fill(-1);
  const colClue = new Int32Array(C * 5).fill(-1);
  for (let r = 0; r < R; r++) {
    for (let s = 0; s < 4; s++) rowClue[r * 5 + s] = cfg.rowClue[r * 4 + s];
    rowClue[r * 5 + 4] = (cfg.rowEmpty && cfg.rowEmpty[r] !== undefined) ? cfg.rowEmpty[r] : -1;
  }
  for (let c = 0; c < C; c++) {
    for (let s = 0; s < 4; s++) colClue[c * 5 + s] = cfg.colClue[c * 4 + s];
    colClue[c * 5 + 4] = (cfg.colEmpty && cfg.colEmpty[c] !== undefined) ? cfg.colEmpty[c] : -1;
  }
  const globalDeadline = cfg.deadlineTs || (Date.now() + (cfg.timeLimit || 10000));

  const parent = new Int32Array(N);
  const compSize = new Int32Array(N);
  const pending = new Int32Array(N);
  const S = new Int32Array(3);
  const rowCount = new Int32Array(R * 5);
  const colCount = new Int32Array(C * 5);
  let totalDef = 0;   // piece clues only: S[2] gates network closure, and empty
  for (let i = 0; i < R * 5; i++) if (i % 5 !== 4 && rowClue[i] >= 0) totalDef += rowClue[i];   // cells are legally placed after the network closes
  for (let i = 0; i < C * 5; i++) if (i % 5 !== 4 && colClue[i] >= 0) totalDef += colClue[i];

  const rightE = new Uint8Array(N), downE = new Uint8Array(N);
  const tA = [], tI = [], tV = [];
  function set(a, i, v) { tA.push(a); tI.push(i); tV.push(a[i]); a[i] = v; }
  function find(x) { while (parent[x] !== x) x = parent[x]; return x; }
  function connect(pos, other) {
    let ra = find(pos), rb = find(other);
    if (ra === rb) { set(pending, ra, pending[ra] - 1); return ra; }
    if (compSize[ra] < compSize[rb]) { const t = ra; ra = rb; rb = t; }
    set(parent, rb, ra);
    set(compSize, ra, compSize[ra] + compSize[rb]);
    set(pending, ra, pending[ra] + pending[rb] - 1);
    set(S, 0, S[0] - 1);
    return ra;
  }

  let totalNodes = 0;
  let phaseLabel = '';
  let progressExtra = null;

  const OPT = [[0, 0], [1, 0], [0, 1], [1, 1]];

  // Find up to maxSolutions solutions under optional forced edges.
  // fR/fD: Int8Array with -1 (free) / 0 / 1, or null. onSol(rightE, downE) per solution.
  // opts: { deadline (ms timestamp, capped by global), randomize }
  // returns { solCount, complete, timedOut } — complete = search space exhausted
  function search(fR, fD, maxSolutions, onSol, opts) {
    const deadline = Math.min(globalDeadline, (opts && opts.deadline) || Infinity);
    const randomize = !!(opts && opts.randomize);
    for (let i = 0; i < N; i++) { parent[i] = i; compSize[i] = 1; pending[i] = 0; }
    S[0] = 0; S[1] = 0; S[2] = totalDef;
    rowCount.fill(0); colCount.fill(0);
    tA.length = 0; tI.length = 0; tV.length = 0;
    let solCount = 0, stop = false, timedOut = false;

    function rec(pos) {
      if (stop || timedOut) return;
      totalNodes++;
      if ((totalNodes & 16383) === 0) {
        if (Date.now() > deadline) { timedOut = true; return; }
        if (post) post({ type: 'progress', label: phaseLabel, nodes: totalNodes, extra: progressExtra });
      }
      if (pos === N) {
        if (S[0] === 1) {
          solCount++;
          if (onSol) onSol(rightE, downE);
          if (solCount >= maxSolutions) stop = true;
        }
        return;
      }
      const r = (pos / C) | 0, c = pos - r * C;
      const L = c > 0 ? rightE[pos - 1] : 0;
      const U = r > 0 ? downE[pos - C] : 0;
      const lastC = (c === C - 1), lastR = (r === R - 1);
      const frcR = fR ? fR[pos] : -1;
      const frcD = fD ? fD[pos] : -1;
      let order = OPT;
      if (randomize) {
        order = OPT.slice();
        for (let i = 3; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; const t = order[i]; order[i] = order[j]; order[j] = t; }
      }
      for (let oi = 0; oi < 4; oi++) {
        const Rt = order[oi][0], Dn = order[oi][1];
        if (Rt && lastC) continue;
        if (Dn && lastR) continue;
        if (frcR >= 0 && Rt !== frcR) continue;
        if (frcD >= 0 && Dn !== frcD) continue;
        const deg = L + U + Rt + Dn;
        if (deg === 1) continue;
        if (deg > 0 && (blocked[pos] || S[1])) continue;
        let shape = 4;   // 4 = empty (includes shaded cells)
        if (deg === 4) shape = 0;
        else if (deg === 3) shape = 1;
        else if (deg === 2) shape = ((L && Rt) || (U && Dn)) ? 2 : 3;
        {
          const rc = r * 5 + shape, cc = c * 5 + shape;
          if (rowClue[rc] >= 0 && rowCount[rc] + 1 > rowClue[rc]) continue;
          if (colClue[cc] >= 0 && colCount[cc] + 1 > colClue[cc]) continue;
        }
        const remRow = C - 1 - c, remCol = R - 1 - r;
        let defRow = 0, defCol = 0;
        for (let s = 0; s < 5; s++) {
          const rcl = rowClue[r * 5 + s];
          if (rcl >= 0) { const d = rcl - rowCount[r * 5 + s] - (s === shape ? 1 : 0); if (d > 0) defRow += d; }
          const ccl = colClue[c * 5 + s];
          if (ccl >= 0) { const d = ccl - colCount[c * 5 + s] - (s === shape ? 1 : 0); if (d > 0) defCol += d; }
        }
        if (defRow > remRow || defCol > remCol) continue;
        const mark = tA.length;
        let ok = true;
        {
          const rc = r * 5 + shape, cc = c * 5 + shape;
          set(rowCount, rc, rowCount[rc] + 1);
          set(colCount, cc, colCount[cc] + 1);
          if (shape < 4 && rowClue[rc] >= 0) set(S, 2, S[2] - 1);
          if (shape < 4 && colClue[cc] >= 0) set(S, 2, S[2] - 1);
        }
        if (deg > 0) {
          set(pending, pos, Rt + Dn);
          set(S, 0, S[0] + 1);
          let root = pos;
          if (L) root = connect(pos, pos - 1);
          if (U) root = connect(pos, pos - C);
          if (pending[root] === 0) {
            if (S[0] > 1) ok = false;
            else { set(S, 1, 1); if (S[2] > 0) ok = false; }
          }
        }
        if (ok) {
          rightE[pos] = Rt; downE[pos] = Dn;
          rec(pos + 1);
        }
        while (tA.length > mark) { const a = tA.pop(), i = tI.pop(), v = tV.pop(); a[i] = v; }
        if (stop || timedOut) return;
      }
    }
    rec(0);
    return { solCount, complete: !timedOut && !stop, timedOut };
  }

  return {
    search,
    setPhase(label, extra) { phaseLabel = label; progressExtra = extra || null; },
    nodes: () => totalNodes,
    timeLeft: () => globalDeadline - Date.now(),
    globalDeadline
  };
}

// ---- mode: solve / random ----
function runSolve(cfg, post) {
  const eng = makeEngine(cfg, post);
  eng.setPhase('Searching for a solution');
  let firstR = null, firstD = null;
  const max = cfg.mode === 'random' ? 1 : 2;
  const r = eng.search(null, null, max, (re, de) => { if (!firstR) { firstR = re.slice(); firstD = de.slice(); } },
    { randomize: !!cfg.randomize });
  return { solCount: r.solCount, timedOut: r.timedOut, complete: r.complete, nodes: eng.nodes(), firstR, firstD };
}

// ---- mode: true candidates (exact, per-edge satisfiability) ----
function runCandidates(cfg, post) {
  const R = cfg.R, C = cfg.C, N = R * C;
  const tStart = Date.now();
  const T = cfg.timeLimit || 10000;
  const deadlineTs = tStart + T;
  const countReserve = Math.min(1500, T * 0.12);
  const phaseDeadline = deadlineTs - countReserve;

  // shared progress label across all reflected engines
  const cur = { label: '', extra: null };
  const postWrap = post ? (m) => { m.label = cur.label; m.extra = cur.extra; post(m); } : null;
  function setPhase(label, extra) { cur.label = label; cur.extra = extra || null; }

  // ---- board reflections: bit0 = mirror columns, bit1 = mirror rows ----
  // Lets a probed segment sit near the start of the row-major scan so the
  // forced constraint prunes immediately, and diversifies restart searches.
  function tPos(k, i) { let r = (i / C) | 0, c = i - r * C; if (k & 1) c = C - 1 - c; if (k & 2) r = R - 1 - r; return r * C + c; }
  function tRightIdx(k, i) { let r = (i / C) | 0, c = i - r * C; if (k & 1) c = C - 2 - c; if (k & 2) r = R - 1 - r; return r * C + c; }
  function tDownIdx(k, i) { let r = (i / C) | 0, c = i - r * C; if (k & 1) c = C - 1 - c; if (k & 2) r = R - 2 - r; return r * C + c; }

  const spaces = [];
  function space(k) {
    if (spaces[k]) return spaces[k];
    let sc = cfg;
    if (k !== 0) {
      const rowClue = new Array(R * 4), colClue = new Array(C * 4);
      const rowEmpty = new Array(R).fill(-1), colEmpty = new Array(C).fill(-1);
      const blocked = new Uint8Array(N);
      for (let r = 0; r < R; r++) {
        const r2 = (k & 2) ? R - 1 - r : r;
        for (let s = 0; s < 4; s++) rowClue[r2 * 4 + s] = cfg.rowClue[r * 4 + s];
        if (cfg.rowEmpty) rowEmpty[r2] = cfg.rowEmpty[r];
      }
      for (let c = 0; c < C; c++) {
        const c2 = (k & 1) ? C - 1 - c : c;
        for (let s = 0; s < 4; s++) colClue[c2 * 4 + s] = cfg.colClue[c * 4 + s];
        if (cfg.colEmpty) colEmpty[c2] = cfg.colEmpty[c];
      }
      for (let i = 0; i < N; i++) blocked[tPos(k, i)] = cfg.blocked[i];
      sc = { R, C, rowClue, colClue, rowEmpty, colEmpty, blocked };
    }
    const fR = new Int8Array(N).fill(-1), fD = new Int8Array(N).fill(-1);
    if (cfg.seedR) for (let i = 0; i < N; i++) {
      const r = (i / C) | 0, c = i - r * C;
      if (c < C - 1 && cfg.seedR[i] >= 0) fR[tRightIdx(k, i)] = cfg.seedR[i];
      if (r < R - 1 && cfg.seedD && cfg.seedD[i] >= 0) fD[tDownIdx(k, i)] = cfg.seedD[i];
    }
    spaces[k] = {
      eng: makeEngine({ R, C, rowClue: sc.rowClue, colClue: sc.colClue, rowEmpty: sc.rowEmpty, colEmpty: sc.colEmpty, blocked: sc.blocked, deadlineTs }, postWrap),
      fR, fD
    };
    return spaces[k];
  }
  const eng = space(0).eng;
  function totalNodes() { let n = 0; for (const s of spaces) if (s) n += s.eng.nodes(); return n; }

  const stR = new Uint8Array(N).fill(3), stD = new Uint8Array(N).fill(3);
  const stCell = new Uint8Array(N).fill(3);
  if (cfg.seedR) for (let i = 0; i < N; i++) {
    const r = (i / C) | 0, c = i - r * C;
    if (c < C - 1 && cfg.seedR[i] >= 0) stR[i] = cfg.seedR[i] ? 2 : 0;
    if (r < R - 1 && cfg.seedD && cfg.seedD[i] >= 0) stD[i] = cfg.seedD[i] ? 2 : 0;
  }
  const onSomeR = new Uint8Array(N), offSomeR = new Uint8Array(N);
  const onSomeD = new Uint8Array(N), offSomeD = new Uint8Array(N);
  const usedSome = new Uint8Array(N), emptySome = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (i % C === C - 1) stR[i] = 0;                 // non-existent edges
    if (((i / C) | 0) === R - 1) stD[i] = 0;
  }

  let firstR = null, firstD = null;
  const seen = new Set();  // distinct harvested solutions (lower bound on count)
  function harvest(re, de) {
    if (!firstR) { firstR = re.slice(); firstD = de.slice(); }
    let h = '';
    for (let i = 0; i < N; i++) h += (re[i] ? (de[i] ? 'B' : 'R') : (de[i] ? 'D' : '.'));
    seen.add(h);
    for (let i = 0; i < N; i++) {
      const r = (i / C) | 0, c = i - r * C;
      if (c < C - 1) { if (re[i]) onSomeR[i] = 1; else offSomeR[i] = 1; }
      if (r < R - 1) { if (de[i]) onSomeD[i] = 1; else offSomeD[i] = 1; }
      const deg = (c < C - 1 ? re[i] : 0) + (c > 0 ? re[i - 1] : 0) + (r < R - 1 ? de[i] : 0) + (r > 0 ? de[i - C] : 0);
      if (deg > 0) usedSome[i] = 1; else emptySome[i] = 1;
    }
  }
  const harvesters = [harvest];
  function harvestVia(k) {
    if (harvesters[k]) return harvesters[k];
    return harvesters[k] = (re, de) => {
      const oR = new Uint8Array(N), oD = new Uint8Array(N);
      for (let i = 0; i < N; i++) {
        const r = (i / C) | 0, c = i - r * C;
        if (c < C - 1 && re[tRightIdx(k, i)]) oR[i] = 1;
        if (r < R - 1 && de[tDownIdx(k, i)]) oD[i] = 1;
      }
      harvest(oR, oD);
    };
  }

  // ---- phase 1: base solution via randomized restarts across reflections ----
  // Deterministic DFS has a heavy-tailed runtime; restarts tame it.
  setPhase('Finding a base solution');
  let baseState = 'timeout';
  {
    let slice = 120, attempt = 0;
    while (Date.now() < phaseDeadline) {
      const k = attempt % 4;
      const sp = space(k);
      const r = sp.eng.search(sp.fR, sp.fD, 1, harvestVia(k),
        { deadline: Math.min(phaseDeadline, Date.now() + slice), randomize: attempt > 0 });
      if (r.solCount > 0) { baseState = 'sat'; break; }
      if (r.complete) { baseState = 'unsat'; break; }   // fully exhausted: contradictory clues
      attempt++;
      if (attempt % 4 === 0) slice *= 1.7;
    }
  }
  const baseCost = Date.now() - tStart;
  if (baseState !== 'sat') {
    return { solCount: 0, timedOut: baseState === 'timeout', complete: baseState === 'unsat', nodes: totalNodes() };
  }

  // ---- phase 2: full enumeration attempt (only if the base came cheap) ----
  // Cheap exactly when probes are expensive (few solutions); if it completes,
  // every status plus the exact count falls out directly.
  let count = 1, countExact = false;
  if (baseCost < Math.min(600, T * 0.06)) {
    const enumDeadline = Math.min(phaseDeadline, Date.now() + T * 0.35);
    setPhase('Enumerating solutions');
    let c = 0;
    const r = eng.search(space(0).fR, space(0).fD, 2000000, (re, de) => { c++; harvest(re, de); }, { deadline: enumDeadline });
    if (r.complete) {
      for (let i = 0; i < N; i++) {
        const rr = (i / C) | 0, cc = i - rr * C;
        if (cc < C - 1) stR[i] = onSomeR[i] ? (offSomeR[i] ? 1 : 2) : 0;
        if (rr < R - 1) stD[i] = onSomeD[i] ? (offSomeD[i] ? 1 : 2) : 0;
        stCell[i] = cfg.blocked[i] ? 0 : (usedSome[i] ? (emptySome[i] ? 1 : 2) : 0);
      }
      return {
        solCount: c, countExact: true, countAttempted: true, unresolved: false,
        timedOut: false, nodes: totalNodes(), firstR, firstD, stR, stD, stCell
      };
    }
  }

  // ---- phase 3: diversified sampling (randomized restarts, all reflections) ----
  {
    const sampleDeadline = Math.min(phaseDeadline, Date.now() + (phaseDeadline - Date.now()) * 0.2);
    let samples = 0;
    while (Date.now() < sampleDeadline && samples < 48) {
      setPhase('Sampling solutions', { done: samples + 1, total: 48 });
      const k = samples % 4;
      const sp = space(k);
      sp.eng.search(sp.fR, sp.fD, 1, harvestVia(k), { deadline: Math.min(sampleDeadline, Date.now() + 150), randomize: true });
      samples++;
    }
  }

  // ---- phase 4: per-edge probes, reflected so the probe sits early in the scan ----
  function runEdgeTest(kind, i, slice) {
    const onSome = kind ? onSomeD : onSomeR, offSome = kind ? offSomeD : offSomeR;
    const st = kind ? stD : stR;
    if (st[i] !== 3) return true;   // seeded: proven before any probe
    if (onSome[i] && offSome[i]) { st[i] = 1; return true; }
    let bk = 0, bv = Infinity;
    for (let k = 0; k < 4; k++) {
      const v = kind ? tDownIdx(k, i) : tRightIdx(k, i);
      if (v < bv) { bv = v; bk = k; }
    }
    const sp = space(bk);
    const ti = kind ? tDownIdx(bk, i) : tRightIdx(bk, i);
    const f = kind ? sp.fD : sp.fR;
    const prev = f[ti];
    f[ti] = onSome[i] ? 0 : 1;   // probe the value not yet witnessed
    const r = sp.eng.search(sp.fR, sp.fD, 1, harvestVia(bk), { deadline: Date.now() + slice, randomize: true });
    f[ti] = prev;
    if (r.solCount > 0) { st[i] = 1; return true; }
    if (r.complete) { st[i] = onSome[i] ? 2 : 0; return true; }  // proven always / never
    return false;
  }
  const tests = [];
  for (let i = 0; i < N; i++) {
    if (i % C !== C - 1) tests.push([0, i]);
    if (((i / C) | 0) !== R - 1) tests.push([1, i]);
  }
  let queue = tests.slice(), passN = 0;
  while (queue.length && Date.now() < phaseDeadline && passN < 3) {
    passN++;
    const retry = [];
    for (let k = 0; k < queue.length; k++) {
      const left = phaseDeadline - Date.now();
      if (left <= 0) { retry.push(...queue.slice(k)); break; }
      setPhase('Testing segments', { done: tests.length - (queue.length - k) + 1, total: tests.length, pass: passN });
      const slice = Math.max(80, Math.min(left, (left / (queue.length - k)) * (passN + 1)));
      const [kind, i] = queue[k];
      if (!runEdgeTest(kind, i, slice)) retry.push(queue[k]);
    }
    queue = retry;
  }

  // ---- phase 5: per-cell "used in every solution?" probes ----
  const cellQueue = [];
  for (let i = 0; i < N; i++) {
    if (cfg.blocked[i]) { stCell[i] = 0; continue; }
    if (usedSome[i] && emptySome[i]) { stCell[i] = 1; continue; }
    if (usedSome[i]) cellQueue.push(i);
  }
  let done = 0;
  for (const i of cellQueue) {
    done++;
    if (usedSome[i] && emptySome[i]) { stCell[i] = 1; continue; } // resolved by a later harvest
    const left = phaseDeadline - Date.now();
    if (left <= 0) break;
    setPhase('Testing cells', { done, total: cellQueue.length });
    let bk = 0, bv = Infinity;
    for (let k = 0; k < 4; k++) { const v = tPos(k, i); if (v < bv) { bv = v; bk = k; } }
    const sp = space(bk);
    const ti = tPos(bk, i);
    const r0 = (ti / C) | 0, c0 = ti - r0 * C;
    const touched = [];
    if (c0 < C - 1) { touched.push([sp.fR, ti, sp.fR[ti]]); sp.fR[ti] = 0; }
    if (c0 > 0) { touched.push([sp.fR, ti - 1, sp.fR[ti - 1]]); sp.fR[ti - 1] = 0; }
    if (r0 < R - 1) { touched.push([sp.fD, ti, sp.fD[ti]]); sp.fD[ti] = 0; }
    if (r0 > 0) { touched.push([sp.fD, ti - C, sp.fD[ti - C]]); sp.fD[ti - C] = 0; }
    const slice = Math.max(80, Math.min(left, (left / (cellQueue.length - done + 1)) * 2));
    const r = sp.eng.search(sp.fR, sp.fD, 1, harvestVia(bk), { deadline: Date.now() + slice, randomize: true });
    for (const [a, j, v] of touched) a[j] = v;
    if (r.solCount > 0) stCell[i] = 1;
    else if (r.complete) stCell[i] = 2;
  }
  // cells never witnessed as used: usable only via an incident edge; any 'sometimes'
  // incident edge would have harvested a solution using this cell, so:
  for (let i = 0; i < N; i++) {
    if (stCell[i] !== 3 || usedSome[i]) continue;
    const r0 = (i / C) | 0, c0 = i - r0 * C;
    const inc = [];
    if (c0 < C - 1) inc.push(stR[i]);
    if (c0 > 0) inc.push(stR[i - 1]);
    if (r0 < R - 1) inc.push(stD[i]);
    if (r0 > 0) inc.push(stD[i - C]);
    stCell[i] = inc.some(s => s === 3) ? 3 : 0;
  }

  let unresolved = false;
  for (let i = 0; i < N; i++) if (stR[i] === 3 || stD[i] === 3 || stCell[i] === 3) { unresolved = true; break; }

  // ---- phase 6: exact count with whatever time remains ----
  // Only worthwhile if systematic search is viable (the base came cheap).
  count = seen.size;
  let countAttempted = false;
  if (deadlineTs - Date.now() > 50 && baseCost < Math.min(600, T * 0.06)) {
    countAttempted = true;
    setPhase('Counting solutions');
    let c2 = 0;
    const r = eng.search(null, null, 100000000, () => { c2++; }, {});
    if (r.complete) { count = c2; countExact = true; }
    else count = Math.max(count, c2);
  }

  return {
    solCount: count, countExact, countAttempted, unresolved,
    timedOut: deadlineTs - Date.now() <= 0,
    nodes: totalNodes(), firstR, firstD, stR, stD, stCell
  };
}

// ---- mode: step (exhaustive fallback for the step-by-step solver) ----
// Given the current pencil state as forced edges (cfg.fixR/fixD: Int8Array -1/0/1),
// prove exactly one new edge fact, or report contradiction / nothing-in-time.
function runStep(cfg, post) {
  const R = cfg.R, C = cfg.C, N = R * C;
  const tStart = Date.now();
  const T = cfg.timeLimit || 10000;
  const deadlineTs = tStart + T;
  const fixR = cfg.fixR, fixD = cfg.fixD;

  const cur = { label: '', extra: null };
  const postWrap = post ? (m) => { m.label = cur.label; m.extra = cur.extra; post(m); } : null;
  function setPhase(label, extra) { cur.label = label; cur.extra = extra || null; }

  function tPos(k, i) { let r = (i / C) | 0, c = i - r * C; if (k & 1) c = C - 1 - c; if (k & 2) r = R - 1 - r; return r * C + c; }
  function tRightIdx(k, i) { let r = (i / C) | 0, c = i - r * C; if (k & 1) c = C - 2 - c; if (k & 2) r = R - 1 - r; return r * C + c; }
  function tDownIdx(k, i) { let r = (i / C) | 0, c = i - r * C; if (k & 1) c = C - 1 - c; if (k & 2) r = R - 2 - r; return r * C + c; }

  const spaces = [];
  function space(k) {
    if (spaces[k]) return spaces[k];
    let sc = cfg;
    if (k !== 0) {
      const rowClue = new Array(R * 4), colClue = new Array(C * 4);
      const rowEmpty = new Array(R).fill(-1), colEmpty = new Array(C).fill(-1);
      const blocked = new Uint8Array(N);
      for (let r = 0; r < R; r++) {
        const r2 = (k & 2) ? R - 1 - r : r;
        for (let s = 0; s < 4; s++) rowClue[r2 * 4 + s] = cfg.rowClue[r * 4 + s];
        if (cfg.rowEmpty) rowEmpty[r2] = cfg.rowEmpty[r];
      }
      for (let c = 0; c < C; c++) {
        const c2 = (k & 1) ? C - 1 - c : c;
        for (let s = 0; s < 4; s++) colClue[c2 * 4 + s] = cfg.colClue[c * 4 + s];
        if (cfg.colEmpty) colEmpty[c2] = cfg.colEmpty[c];
      }
      for (let i = 0; i < N; i++) blocked[tPos(k, i)] = cfg.blocked[i];
      sc = { R, C, rowClue, colClue, rowEmpty, colEmpty, blocked };
    }
    const fR = new Int8Array(N).fill(-1), fD = new Int8Array(N).fill(-1);
    for (let i = 0; i < N; i++) {
      const r = (i / C) | 0, c = i - r * C;
      if (c < C - 1 && fixR[i] >= 0) fR[tRightIdx(k, i)] = fixR[i];
      if (r < R - 1 && fixD[i] >= 0) fD[tDownIdx(k, i)] = fixD[i];
    }
    spaces[k] = {
      eng: makeEngine({ R, C, rowClue: sc.rowClue, colClue: sc.colClue, rowEmpty: sc.rowEmpty, colEmpty: sc.colEmpty, blocked: sc.blocked, deadlineTs }, postWrap),
      fR, fD
    };
    return spaces[k];
  }
  function totalNodes() { let n = 0; for (const s of spaces) if (s) n += s.eng.nodes(); return n; }

  const onSomeR = new Uint8Array(N), offSomeR = new Uint8Array(N);
  const onSomeD = new Uint8Array(N), offSomeD = new Uint8Array(N);
  function harvest(re, de) {
    for (let i = 0; i < N; i++) {
      const r = (i / C) | 0, c = i - r * C;
      if (c < C - 1) { if (re[i]) onSomeR[i] = 1; else offSomeR[i] = 1; }
      if (r < R - 1) { if (de[i]) onSomeD[i] = 1; else offSomeD[i] = 1; }
    }
  }
  const harvesters = [harvest];
  function harvestVia(k) {
    if (harvesters[k]) return harvesters[k];
    return harvesters[k] = (re, de) => {
      const oR = new Uint8Array(N), oD = new Uint8Array(N);
      for (let i = 0; i < N; i++) {
        const r = (i / C) | 0, c = i - r * C;
        if (c < C - 1 && re[tRightIdx(k, i)]) oR[i] = 1;
        if (r < R - 1 && de[tDownIdx(k, i)]) oD[i] = 1;
      }
      harvest(oR, oD);
    };
  }

  // 1) is the current pencil state even satisfiable?
  setPhase('Checking current state');
  let sat = 'timeout';
  {
    let slice = 120, attempt = 0;
    while (Date.now() < deadlineTs) {
      const k = attempt % 4;
      const sp = space(k);
      const r = sp.eng.search(sp.fR, sp.fD, 1, harvestVia(k),
        { deadline: Math.min(deadlineTs, Date.now() + slice), randomize: attempt > 0 });
      if (r.solCount > 0) { sat = 'sat'; break; }
      if (r.complete) { sat = 'unsat'; break; }
      attempt++;
      if (attempt % 4 === 0) slice *= 1.7;
    }
  }
  if (sat === 'unsat') return { result: 'contradiction', nodes: totalNodes() };
  if (sat === 'timeout') return { result: 'timeout', nodes: totalNodes() };

  // 2) probe unknown edges, nearest-to-known-lines first
  const items = [];
  for (let i = 0; i < N; i++) {
    const r = (i / C) | 0, c = i - r * C;
    const near = (j) => {
      const rr = (j / C) | 0, cc = j - rr * C;
      let s = 0;
      if (cc < C - 1 && fixR[j] === 1) s++;
      if (cc > 0 && fixR[j - 1] === 1) s++;
      if (rr < R - 1 && fixD[j] === 1) s++;
      if (rr > 0 && fixD[j - C] === 1) s++;
      return s;
    };
    if (c < C - 1 && fixR[i] < 0) items.push([0, i, near(i) + near(i + 1)]);
    if (r < R - 1 && fixD[i] < 0) items.push([1, i, near(i) + near(i + C)]);
  }
  items.sort((a, b) => b[2] - a[2]);

  let pass = 0, queue = items;
  while (queue.length && Date.now() < deadlineTs && pass < 3) {
    pass++;
    const retry = [];
    for (let k2 = 0; k2 < queue.length; k2++) {
      const left = deadlineTs - Date.now();
      if (left <= 0) { break; }
      setPhase('Testing borders', { done: items.length - (queue.length - k2) + 1, total: items.length, pass });
      const [kind, i] = queue[k2];
      const onSome = kind ? onSomeD : onSomeR, offSome = kind ? offSomeD : offSomeR;
      if (onSome[i] && offSome[i]) continue;   // varies between solutions: not provable
      let bk = 0, bv = Infinity;
      for (let k = 0; k < 4; k++) {
        const v = kind ? tDownIdx(k, i) : tRightIdx(k, i);
        if (v < bv) { bv = v; bk = k; }
      }
      const sp = space(bk);
      const ti = kind ? tDownIdx(bk, i) : tRightIdx(bk, i);
      const f = kind ? sp.fD : sp.fR;
      const probeVal = onSome[i] ? 0 : 1;   // test the value not yet witnessed
      f[ti] = probeVal;
      const slice = Math.max(80, Math.min(left, (left / (queue.length - k2)) * (pass + 1)));
      const r = sp.eng.search(sp.fR, sp.fD, 1, harvestVia(bk), { deadline: Date.now() + slice, randomize: true });
      f[ti] = -1;
      if (r.solCount > 0) continue;                       // witnessed both ways
      if (r.complete) {
        return { result: 'fact', kind, index: i, val: probeVal ? 0 : 1, nodes: totalNodes() };
      }
      retry.push(queue[k2]);                              // slice ran out; try again later
    }
    queue = retry;
  }
  return { result: 'none', exhausted: queue.length === 0 && Date.now() < deadlineTs, nodes: totalNodes() };
}

function runAny(cfg, post) {
  if (cfg.mode === 'candidates') return runCandidates(cfg, post);
  if (cfg.mode === 'step') return runStep(cfg, post);
  return runSolve(cfg, post);
}


module.exports = { runAny, runSolve, runCandidates, runStep };
