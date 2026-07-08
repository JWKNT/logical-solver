/* ================= model ================= */
const CELL = 52;
const SHAPE_ICON = ['┼', '├', '─', '└', '·'];
const SHAPE_NAME = ['crosses ┼ (4-way)', 'branches ├ (3-way)', 'straights ─', 'turns └', 'empty cells · (unused; shaded cells count)'];

let R = 6, C = 6;
let blocked = [];        // [R][C] booleans
let rowClues = [];       // [R][4] int or null
let colClues = [];       // [C][4] int or null
let worker = null;

function freshModel(nR, nC) {
    const nb = [], nrc = [], ncc = [];
    for (let r = 0; r < nR; r++) {
        nb.push(new Array(nC).fill(false));
        nrc.push([null, null, null, null, null]);
    }
    for (let c = 0; c < nC; c++) ncc.push([null, null, null, null, null]);
    // preserve overlap from old model
    for (let r = 0; r < Math.min(nR, R); r++) {
        for (let c = 0; c < Math.min(nC, C); c++) nb[r][c] = blocked[r] ? !!blocked[r][c] : false;
        if (rowClues[r]) { nrc[r] = rowClues[r].slice(); while (nrc[r].length < 5) nrc[r].push(null); }
    }
    for (let c = 0; c < Math.min(nC, C); c++) if (colClues[c]) { ncc[c] = colClues[c].slice(); while (ncc[c].length < 5) ncc[c].push(null); }
    R = nR; C = nC; blocked = nb; rowClues = nrc; colClues = ncc;
}

/* ================= board / clue rendering ================= */
const $ = id => document.getElementById(id);
const svgNS = 'http://www.w3.org/2000/svg';

function buildClue(kind, idx, s) {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.inputMode = 'numeric';
    inp.maxLength = 2;
    inp.className = 'clue s' + s;
    inp.title = (kind === 'row' ? 'Row ' + (idx + 1) : 'Column ' + (idx + 1)) + ': number of ' + SHAPE_NAME[s];
    inp.setAttribute('aria-label', inp.title);
    const model = kind === 'row' ? rowClues : colClues;
    const v = model[idx][s];
    if (v !== null && v !== undefined) inp.value = v;
    inp.addEventListener('input', () => {
        const t = inp.value.replace(/[^0-9]/g, '');
        if (t !== inp.value) inp.value = t;
        (kind === 'row' ? rowClues : colClues)[idx][s] = t === '' ? null : parseInt(t, 10);
    });
    return inp;
}

function render() {
    document.documentElement.style.setProperty('--cell', CELL + 'px');
    // corner: shape icons on the diagonal — each labels its clue row (right) and clue column (below)
    const KEY_CLASS = ['key-cross', 'key-branch', 'key-straight', 'key-turn', 'key-empty'];
    // display order of the bands, outermost first: empty sits beyond the cross so the
    // classic four bands keep their positions next to the grid
    const BAND_ORDER = [4, 0, 1, 2, 3];
    const corner = $('cornerKey');
    corner.innerHTML = '';
    for (let rr = 0; rr < 5; rr++) for (let cc = 0; cc < 5; cc++) {
        const sp = document.createElement('span');
        if (rr === cc) {
            const s = BAND_ORDER[rr];
            sp.className = KEY_CLASS[s];
            sp.textContent = SHAPE_ICON[s];
            sp.title = SHAPE_NAME[s] + ' — counts go in this row (per column) and this column (per row)';
        } else sp.className = 'blank';
        corner.appendChild(sp);
    }
    // clue bands, traditional U-Bahn style: 4 rows above (one per shape, aligned to
    // grid columns) and 4 columns on the left (one per shape, aligned to grid rows)
    const colWrap = $('colClues'), rowWrap = $('rowClues');
    colWrap.innerHTML = ''; rowWrap.innerHTML = '';
    colWrap.style.gridTemplateColumns = 'repeat(' + C + ', ' + CELL + 'px)';
    colWrap.style.gridTemplateRows = 'repeat(5, var(--band))';
    for (const s of BAND_ORDER) for (let c = 0; c < C; c++) colWrap.appendChild(buildClue('col', c, s));
    rowWrap.style.gridTemplateColumns = 'repeat(5, var(--band))';
    rowWrap.style.gridTemplateRows = 'repeat(' + R + ', ' + CELL + 'px)';
    for (let r = 0; r < R; r++) for (const s of BAND_ORDER) rowWrap.appendChild(buildClue('row', r, s));

    const svg = $('boardSvg');
    svg.innerHTML = '';
    svg.setAttribute('width', C * CELL + 4);
    svg.setAttribute('height', R * CELL + 4);
    svg.setAttribute('viewBox', `-2 -2 ${C * CELL + 4} ${R * CELL + 4}`);

    const cellsLayer = document.createElementNS(svgNS, 'g');
    cellsLayer.id = 'cellsLayer';
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
        const rect = document.createElementNS(svgNS, 'rect');
        rect.setAttribute('x', c * CELL); rect.setAttribute('y', r * CELL);
        rect.setAttribute('width', CELL); rect.setAttribute('height', CELL);
        rect.setAttribute('class', 'cell');
        rect.dataset.r = r; rect.dataset.c = c;
        rect.setAttribute('stroke', 'var(--grid-line)');
        rect.setAttribute('stroke-width', '1');
        paintCell(rect);
        rect.addEventListener('click', () => {
            blocked[r][c] = !blocked[r][c];
            stepInvalidate();
            paintCell(rect);
            clearLines();
            setStatus('Cell (' + (r + 1) + ', ' + (c + 1) + ') ' + (blocked[r][c] ? 'shaded — the network can’t use it.' : 'unshaded.'));
        });
        cellsLayer.appendChild(rect);
    }
    svg.appendChild(cellsLayer);

    const border = document.createElementNS(svgNS, 'rect');
    border.setAttribute('x', 0); border.setAttribute('y', 0);
    border.setAttribute('width', C * CELL); border.setAttribute('height', R * CELL);
    border.setAttribute('fill', 'none');
    border.setAttribute('stroke', 'var(--ink)');
    border.setAttribute('stroke-width', '2.5');
    border.setAttribute('pointer-events', 'none');
    svg.appendChild(border);

    const lines = document.createElementNS(svgNS, 'g');
    lines.id = 'linesLayer';
    lines.setAttribute('pointer-events', 'none');
    svg.appendChild(lines);
}

function paintCell(rect, tint) {
    const r = +rect.dataset.r, c = +rect.dataset.c;
    rect.setAttribute('fill', blocked[r][c] ? 'var(--shaded)' : (tint || 'var(--board)'));
}
function eachCellRect(fn) {
    $('boardSvg').querySelectorAll('rect.cell').forEach(el => fn(el, +el.dataset.r, +el.dataset.c));
}
function clearLines() {
    $('linesLayer').innerHTML = '';
    eachCellRect(el => paintCell(el));
}

function addLine(layer, r1, c1, r2, c2, style) {
    const l = document.createElementNS(svgNS, 'line');
    l.setAttribute('x1', (c1 + 0.5) * CELL); l.setAttribute('y1', (r1 + 0.5) * CELL);
    l.setAttribute('x2', (c2 + 0.5) * CELL); l.setAttribute('y2', (r2 + 0.5) * CELL);
    for (const k in style) l.setAttribute(k, style[k]);
    layer.appendChild(l);
}
function addNeverX(layer, x, y, arm) {
    arm = arm || 4.5;
    for (const [dx1, dy1, dx2, dy2] of [[-arm, -arm, arm, arm], [-arm, arm, arm, -arm]]) {
        const l = document.createElementNS(svgNS, 'line');
        l.setAttribute('x1', x + dx1); l.setAttribute('y1', y + dy1);
        l.setAttribute('x2', x + dx2); l.setAttribute('y2', y + dy2);
        l.setAttribute('stroke', '#ADB4BD'); l.setAttribute('stroke-width', 2.2);
        l.setAttribute('stroke-linecap', 'round'); l.setAttribute('opacity', '0.9');
        layer.appendChild(l);
    }
}
const DEF_STYLE = { stroke: 'var(--line-def)', 'stroke-width': 9, 'stroke-linecap': 'round' };
const MAYBE_STYLE = { stroke: 'var(--line-maybe)', 'stroke-width': 4.5, 'stroke-linecap': 'round', 'stroke-dasharray': '2 8' };
const UNKNOWN_STYLE = { stroke: 'var(--line-unk)', 'stroke-width': 5.5, 'stroke-linecap': 'round', 'stroke-dasharray': '7 7', opacity: 0.85 };

function drawEdges(rightE, downE, style, layer) {
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
        const i = r * C + c;
        if (c < C - 1 && rightE[i]) addLine(layer, r, c, r, c + 1, style);
        if (r < R - 1 && downE[i]) addLine(layer, r, c, r + 1, c, style);
    }
}
function degreeAt(rightE, downE, r, c) {
    const i = r * C + c;
    return (c < C - 1 ? rightE[i] : 0) + (c > 0 ? rightE[i - 1] : 0) +
        (r < R - 1 ? downE[i] : 0) + (r > 0 ? downE[i - C] : 0);
}
function drawSolution(rightE, downE) {
    clearLines();
    const layer = $('linesLayer');
    drawEdges(rightE, downE, DEF_STYLE, layer);
    // interchange dots at branches and crossings, transit-map style
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
        if (degreeAt(rightE, downE, r, c) >= 3) {
            const dot = document.createElementNS(svgNS, 'circle');
            dot.setAttribute('cx', (c + 0.5) * CELL); dot.setAttribute('cy', (r + 0.5) * CELL);
            dot.setAttribute('r', 6);
            dot.setAttribute('fill', '#fff');
            dot.setAttribute('stroke', 'var(--line-def)');
            dot.setAttribute('stroke-width', 3);
            layer.appendChild(dot);
        }
    }
}
function drawCandidates(res) {
    clearLines();
    eachCellRect((el, r, c) => {
        if (!blocked[r][c] && res.stCell[r * C + c] === 2) paintCell(el, 'var(--tint-used)');
    });
    const layer = $('linesLayer');
    const N = R * C;
    const mR = new Uint8Array(N), mD = new Uint8Array(N);   // sometimes
    const uR = new Uint8Array(N), uD = new Uint8Array(N);   // undetermined (time limit)
    const dR = new Uint8Array(N), dD = new Uint8Array(N);   // always
    for (let i = 0; i < N; i++) {
        mR[i] = res.stR[i] === 1 ? 1 : 0; mD[i] = res.stD[i] === 1 ? 1 : 0;
        uR[i] = res.stR[i] === 3 ? 1 : 0; uD[i] = res.stD[i] === 3 ? 1 : 0;
        dR[i] = res.stR[i] === 2 ? 1 : 0; dD[i] = res.stD[i] === 2 ? 1 : 0;
    }
    drawEdges(mR, mD, MAYBE_STYLE, layer);
    drawEdges(uR, uD, UNKNOWN_STYLE, layer);
    drawEdges(dR, dD, DEF_STYLE, layer);
    // x-marks on segments proven to appear in NO solution (skip borders of shaded cells)
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
        const i = r * C + c;
        if (c < C - 1 && res.stR[i] === 0 && !blocked[r][c] && !blocked[r][c + 1]) addNeverX(layer, (c + 1) * CELL, (r + 0.5) * CELL);
        if (r < R - 1 && res.stD[i] === 0 && !blocked[r][c] && !blocked[r + 1][c]) addNeverX(layer, (c + 0.5) * CELL, (r + 1) * CELL);
    }
    // hollow dot on cells proven unused in every solution
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
        if (blocked[r][c] || res.stCell[r * C + c] !== 0) continue;
        const d = document.createElementNS(svgNS, 'circle');
        d.setAttribute('cx', (c + 0.5) * CELL); d.setAttribute('cy', (r + 0.5) * CELL);
        d.setAttribute('r', 4);
        d.setAttribute('fill', 'none');
        d.setAttribute('stroke', '#B9C0C8');
        d.setAttribute('stroke-width', 2);
        layer.appendChild(d);
    }
}

/* ================= status ================= */
function setStatus(html) { $('status').innerHTML = html; }
function fmtMs(ms) { return ms < 1000 ? ms + ' ms' : (ms / 1000).toFixed(1) + ' s'; }
function fmtN(n) { return n.toLocaleString('en-US'); }

/* ================= solving ================= */
const workerUrl = URL.createObjectURL(new Blob(['(' + workerMain.toString() + ')()'], { type: 'application/javascript' }));

function gatherConfig(mode, maxSolutions, randomize) {
    const rowClue = new Int32Array(R * 4).fill(-1);
    const colClue = new Int32Array(C * 4).fill(-1);
    const rowEmpty = new Array(R).fill(-1);
    const colEmpty = new Array(C).fill(-1);
    if (!randomize) { // random generation ignores clues
        for (let r = 0; r < R; r++) for (let s = 0; s < 4; s++) if (rowClues[r][s] !== null) rowClue[r * 4 + s] = rowClues[r][s];
        for (let c = 0; c < C; c++) for (let s = 0; s < 4; s++) if (colClues[c][s] !== null) colClue[c * 4 + s] = colClues[c][s];
        for (let r = 0; r < R; r++) if (rowClues[r][4] !== null && rowClues[r][4] !== undefined) rowEmpty[r] = rowClues[r][4];
        for (let c = 0; c < C; c++) if (colClues[c][4] !== null && colClues[c][4] !== undefined) colEmpty[c] = colClues[c][4];
    }
    const blk = new Uint8Array(R * C);
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (blocked[r][c]) blk[r * C + c] = 1;
    const secs = Math.max(1, Math.min(600, parseInt($('timeIn').value, 10) || 10));
    return { R, C, rowClue, colClue, rowEmpty, colEmpty, blocked: blk, mode, maxSolutions, randomize: !!randomize, timeLimit: secs * 1000 };
}

function setRunning(on, label) {
    ['solveBtn', 'candBtn', 'stepBtn', 'stepResetBtn', 'randomBtn', 'clearCluesBtn', 'resetBtn', 'rowsIn', 'colsIn'].forEach(id => $(id).disabled = on);
    $('cancelBtn').style.display = on ? '' : 'none';
    if (on) setStatus(label || 'Searching…');
}

function runWorker(cfg, onDone) {
    if (worker) worker.terminate();
    worker = new Worker(workerUrl);
    setRunning(true, 'Searching…');
    worker.onmessage = e => {
        const m = e.data;
        if (m.type === 'progress') {
            let label = m.label || 'Searching';
            if (m.extra && m.extra.total) {
                label += ' (' + m.extra.done + '/' + m.extra.total + (m.extra.pass > 1 ? ', pass ' + m.extra.pass : '') + ')';
            }
            setStatus(label + '… <span class="warn">' + fmtN(m.nodes) + '</span> nodes explored, ' + fmtMs(m.elapsed) + ' elapsed.');
        } else if (m.type === 'done') {
            setRunning(false);
            worker.terminate(); worker = null;
            onDone(m.res);
        } else if (m.type === 'error') {
            setRunning(false);
            worker.terminate(); worker = null;
            setStatus('<span class="bad">Solver error:</span> ' + m.message);
        }
    };
    worker.postMessage(cfg);
}

$('solveBtn').addEventListener('click', () => {
    runWorker(gatherConfig('solve', 2, false), res => {
        if (res.solCount === 0) {
            clearLines();
            setStatus(res.complete
                ? '<span class="bad">No solution.</span> These clues are contradictory. (search complete, ' + fmtN(res.nodes) + ' nodes, ' + fmtMs(res.elapsed) + ')'
                : '<span class="warn">No solution found within the time limit.</span> Raise the limit to keep searching. (' + fmtN(res.nodes) + ' nodes)');
            return;
        }
        drawSolution(res.firstR, res.firstD);
        if (res.solCount >= 2) {
            setStatus('<span class="good">Solved.</span> <span class="warn">Multiple solutions exist</span> — showing one of them. Use <b>True candidates</b> to count them all and see what they share. (' + fmtMs(res.elapsed) + ')');
        } else if (!res.timedOut) {
            setStatus('<span class="good">Solved — the solution is unique.</span> (' + fmtN(res.nodes) + ' nodes, ' + fmtMs(res.elapsed) + ')');
        } else {
            setStatus('<span class="good">Solved.</span> <span class="warn">Uniqueness not verified</span> — the time limit was reached while checking for a second solution.');
        }
    });
});

$('candBtn').addEventListener('click', () => {
    const cfg = gatherConfig('candidates', 0, false);
    // seed the exact search with quick human deductions: every proven border is
    // true in all solutions, so probes skip it and every search prunes on it
    try {
        const seedSt = makeStepState(R, C, blocked);
        seedSt.fastLadder = true;
        seedSt.noTrial = true;
        const seedClues = currentClues();
        const cap = Date.now() + Math.min(1500, cfg.timeLimit * 0.15);
        let mv2 = null, contra = false;
        while (Date.now() < cap && (mv2 = takeHumanStep(seedSt, seedClues))) {
            if (mv2.contradiction) { contra = true; break; }
        }
        if (!contra) { cfg.seedR = Array.from(seedSt.edgeR); cfg.seedD = Array.from(seedSt.edgeD); }
    } catch (err) { /* seeding is an optimisation only */ }
    runWorker(cfg, res => {
        if (res.solCount === 0) {
            clearLines();
            setStatus(res.complete
                ? '<span class="bad">No solution.</span> These clues are contradictory. (search complete, ' + fmtN(res.nodes) + ' nodes, ' + fmtMs(res.elapsed) + ')'
                : '<span class="warn">No solution found within the time limit.</span> Raise the limit to keep searching.');
            return;
        }
        drawCandidates(res);
        let countTxt;
        if (res.countExact) {
            countTxt = '<b>' + fmtN(res.solCount) + '</b> solution' + (res.solCount === 1 ? '' : 's') + ' in total.';
            if (res.solCount === 1) countTxt += ' The puzzle is unique, so the solid network <i>is</i> the solution.';
        } else if (res.countAttempted) {
            countTxt = 'At least <b>' + fmtN(res.solCount) + '</b> solutions (counting stopped at the time limit).';
        } else {
            countTxt = 'At least <b>' + fmtN(res.solCount) + '</b> distinct solutions seen; exact count skipped (not feasible within the time limit).';
        }
        if (!res.unresolved) {
            setStatus('<span class="good">Candidate map complete — every segment and cell proven.</span> ' +
                'Solid segments and tinted cells are in <b>every</b> solution (loose ends are normal: the rest of that piece varies); dashed segments are in some; × marks borders no solution ever crosses; ∘-dotted cells are used in none. ' +
                countTxt + ' (' + fmtN(res.nodes) + ' nodes, ' + fmtMs(res.elapsed) + ')');
        } else {
            setStatus('<span class="warn">Candidate map partially undetermined.</span> Solid and dashed segments, × marks, and dots are <b>proven</b>; ' +
                '<span style="color:var(--line-unk);font-weight:600;">amber</span> segments could not be decided before the time limit — raise it and re-run to resolve them. ' + countTxt);
        }
    });
});

$('randomBtn').addEventListener('click', () => {
    runWorker(gatherConfig('random', 1, true), res => {
        if (res.solCount === 0) {
            setStatus('<span class="bad">Couldn’t generate a network</span> — the shaded cells may make any loop impossible.');
            return;
        }
        // derive the complete clue set from the generated network
        for (let r = 0; r < R; r++) rowClues[r] = [0, 0, 0, 0, 0];
        for (let c = 0; c < C; c++) colClues[c] = [0, 0, 0, 0, 0];
        for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
            const i = r * C + c;
            const Rt = c < C - 1 ? res.firstR[i] : 0, L = c > 0 ? res.firstR[i - 1] : 0;
            const Dn = r < R - 1 ? res.firstD[i] : 0, U = r > 0 ? res.firstD[i - C] : 0;
            const deg = Rt + L + Dn + U;
            let s = -1;
            if (deg === 4) s = 0; else if (deg === 3) s = 1;
            else if (deg === 2) s = ((L && Rt) || (U && Dn)) ? 2 : 3;
            if (s >= 0) { rowClues[r][s]++; colClues[c][s]++; }
            else { rowClues[r][4]++; colClues[c][4]++; }
        }
        stepInvalidate();
        render();
        drawSolution(res.firstR, res.firstD);
        setStatus('<span class="good">Random puzzle generated</span> with its full clue set and the network it came from. ' +
            'Clear some clues and re-run <b>True candidates</b> to watch the space of solutions open up.');
    });
});

$('cancelBtn').addEventListener('click', () => {
    if (worker) { worker.terminate(); worker = null; }
    setRunning(false);
    setStatus('<span class="warn">Search cancelled.</span>');
});

$('clearCluesBtn').addEventListener('click', () => {
    for (let r = 0; r < R; r++) rowClues[r] = [null, null, null, null, null];
    for (let c = 0; c < C; c++) colClues[c] = [null, null, null, null, null];
    stepInvalidate();
    render();
    setStatus('Clues cleared.');
});

$('resetBtn').addEventListener('click', () => {
    const oldR = R, oldC = C;
    R = 0; C = 0; blocked = []; rowClues = []; colClues = [];
    freshModel(oldR, oldC);
    stepInvalidate();
    render();
    setStatus('Board reset.');
});

function onResize() {
    const nR = Math.max(2, Math.min(12, parseInt($('rowsIn').value, 10) || R));
    const nC = Math.max(2, Math.min(12, parseInt($('colsIn').value, 10) || C));
    $('rowsIn').value = nR; $('colsIn').value = nC;
    if (nR === R && nC === C) return;
    freshModel(nR, nC);
    stepInvalidate();
    render();
    setStatus('Grid resized to ' + R + ' × ' + C + '. Clues and shading in the overlapping area were kept.');
}
$('rowsIn').addEventListener('change', onResize);
$('colsIn').addEventListener('change', onResize);


/* ================= step-by-step UI ================= */
let stepSt = null, stepClues = null, stepCount = 0, stepDead = false;
function stepInvalidate() { stepSt = null; stepDead = false; stepCount = 0; resetStrategyMarks(); }
const CHAIN_SHOW = 20;      // steps of a refutation chain shown before truncating
function narrateAssumption(kind, index, provenVal) {
    // Replay the refuted assumption through the human rules on a scratch copy.
    const ghost = cloneStepState(stepSt);
    setEdge(ghost, kind, index, 1 - provenVal);
    const moves = [];
    for (let i = 0; i < 400; i++) {
        let mv = null;
        try { mv = takeHumanStep(ghost, stepClues); } catch (e) { return moves.length ? { moves, broke: true } : null; }
        if (!mv) return null;                      // human ladder can't finish this refutation
        moves.push(mv);
        if (mv.contradiction) return { moves, broke: false };
    }
    return null;
}
function formatChainList(moves) {
    const shown = moves.slice(0, CHAIN_SHOW);
    let out = '<ol class="chain">' +
        shown.map(m => '<li><b>' + m.rule + (m.contradiction ? ' — contradiction' : '') + ':</b> ' + m.text + '</li>').join('') +
        '</ol>';
    if (moves.length > CHAIN_SHOW) {
        const last = moves[moves.length - 1];
        out += 'Chain too long — ' + (moves.length - CHAIN_SHOW) + ' further step' + (moves.length - CHAIN_SHOW === 1 ? '' : 's') +
            ' omitted. It ends in <b>' + last.rule + ' — contradiction:</b> ' + last.text + '<br>';
    }
    return out;
}
function chainHtml(kind, index, provenVal, a, b) {
    const res = narrateAssumption(kind, index, provenVal);
    const assume = provenVal ? 'stayed empty' : 'carried a line';
    const conclude = provenVal ? 'must carry a line' : 'is never crossed';
    if (!res) {
        return 'Testing the border between ' + a + ' and ' + b + ' proves it ' + conclude +
            ' in every remaining solution. (The refutation lies deeper than the narrated rules can follow — no short human chain exists from this position.)';
    }
    const { moves, broke } = res;
    let out = 'Suppose the border between ' + a + ' and ' + b + ' ' + assume + '. Then:' + formatChainList(moves);
    if (moves.length <= CHAIN_SHOW && broke) {
        out += '… at which point the marks become inconsistent.<br>';
    }
    out += 'So the border between ' + a + ' and ' + b + ' <b>' + conclude + '</b> in every remaining solution.';
    return out;
}
const stratCounts = {};
function buildStrategyPanel() {
    const ol = $('stratList');
    ol.innerHTML = '';
    STRATEGIES.forEach((s, ix) => {
        const li = document.createElement('li');
        li.id = 'strat' + ix;
        li.innerHTML = '<b>' + s.name + '</b><span class="cnt" id="stratCnt' + ix + '"></span><br><span class="sdesc">' + s.desc + '</span>';
        ol.appendChild(li);
    });
}
function resetStrategyMarks() {
    for (const k in stratCounts) delete stratCounts[k];
    const ol = $('stratList');
    if (!ol) return;
    ol.querySelectorAll('li').forEach(li => li.classList.remove('active'));
    ol.querySelectorAll('.cnt').forEach(sp => { sp.textContent = ''; });
}
function markStrategy(name) {
    const ol = $('stratList');
    if (!ol) return;
    ol.querySelectorAll('li').forEach(li => li.classList.remove('active'));
    const ix = STRATEGIES.findIndex(s => s.name === name);
    if (ix < 0) return;
    stratCounts[name] = (stratCounts[name] || 0) + 1;
    $('strat' + ix).classList.add('active');
    $('stratCnt' + ix).textContent = '×' + stratCounts[name];
}
function currentClues() {
    return {
        row: rowClues.map(a => a.map(v => v === null ? -1 : v)),
        col: colClues.map(a => a.map(v => v === null ? -1 : v))
    };
}
function edgeCellNames(kind, i) {
    const r = (i / C) | 0, c = i - r * C;
    const nm = (rr, cc) => 'r' + (rr + 1) + 'c' + (cc + 1);
    return kind ? [nm(r, c), nm(r + 1, c)] : [nm(r, c), nm(r, c + 1)];
}
function drawStepState(move) {
    clearLines();
    const layer = $('linesLayer');
    // tint cells the network provably visits (their options exclude ·), matching
    // the candidates view; hollow-dot cells (provably empty) are handled by the marks
    eachCellRect((rect, r, c) => {
        const i = r * C + c;
        if (!blocked[r][c] && stepSt && stepSt.cellCfg[i] !== 0 && (stepSt.cellCfg[i] & 1) === 0) paintCell(rect, 'var(--tint-used)');
        else paintCell(rect);
    });
    if (move) {
        for (const i of (move.cells || [])) {
            const r = (i / C) | 0, c = i - r * C;
            const hl = document.createElementNS(svgNS, 'rect');
            hl.setAttribute('x', c * CELL + 2.5); hl.setAttribute('y', r * CELL + 2.5);
            hl.setAttribute('width', CELL - 5); hl.setAttribute('height', CELL - 5);
            hl.setAttribute('fill', 'none'); hl.setAttribute('stroke', 'var(--amber)');
            hl.setAttribute('stroke-width', 2.5); hl.setAttribute('rx', 5); hl.setAttribute('opacity', 0.85);
            layer.appendChild(hl);
        }
        for (const [kind, i] of (move.edges || [])) {
            const r = (i / C) | 0, c = i - r * C;
            const l = document.createElementNS(svgNS, 'line');
            l.setAttribute('x1', (c + 0.5) * CELL); l.setAttribute('y1', (r + 0.5) * CELL);
            l.setAttribute('x2', (c + 0.5 + (kind ? 0 : 1)) * CELL); l.setAttribute('y2', (r + 0.5 + (kind ? 1 : 0)) * CELL);
            l.setAttribute('stroke', 'var(--amber)'); l.setAttribute('stroke-width', 16);
            l.setAttribute('stroke-linecap', 'round'); l.setAttribute('opacity', 0.3);
            layer.appendChild(l);
        }
    }
    const N = R * C;
    const onR = new Uint8Array(N), onD = new Uint8Array(N);
    for (let i = 0; i < N; i++) { if (stepSt.edgeR[i] === 1) onR[i] = 1; if (stepSt.edgeD[i] === 1) onD[i] = 1; }
    drawEdges(onR, onD, DEF_STYLE, layer);
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
        const i = r * C + c;
        if (c < C - 1 && stepSt.edgeR[i] === 0 && !blocked[r][c] && !blocked[r][c + 1]) addNeverX(layer, (c + 1) * CELL, (r + 0.5) * CELL);
        if (r < R - 1 && stepSt.edgeD[i] === 0 && !blocked[r][c] && !blocked[r + 1][c]) addNeverX(layer, (c + 0.5) * CELL, (r + 1) * CELL);
    }
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
        const i = r * C + c;
        if (blocked[r][c]) continue;
        const letters = classLetters(stepSt, i);
        if (letters === '·' || letters === '·') {
            const d = document.createElementNS(svgNS, 'circle');
            d.setAttribute('cx', (c + 0.5) * CELL); d.setAttribute('cy', (r + 0.5) * CELL);
            d.setAttribute('r', 4); d.setAttribute('fill', 'none');
            d.setAttribute('stroke', '#B9C0C8'); d.setAttribute('stroke-width', 2);
            layer.appendChild(d);
            continue;
        }
        let n = 0, m = stepSt.cellCfg[i];
        while (m) { n += m & 1; m >>= 1; }
        if (n === 1 || letters.length >= 5) continue;   // decided pieces speak through their lines; untouched cells stay clean
        const t = document.createElementNS(svgNS, 'text');
        t.setAttribute('x', c * CELL + 4); t.setAttribute('y', r * CELL + 13);
        t.setAttribute('font-size', '10.5'); t.setAttribute('fill', '#8A94A0');
        t.setAttribute('font-family', 'Menlo, Consolas, monospace');
        t.textContent = letters;
        layer.appendChild(t);
    }
}
$('stepBtn').addEventListener('click', () => {
    if (!stepSt) { stepSt = makeStepState(R, C, blocked); stepClues = currentClues(); stepCount = 0; stepDead = false; }
    if (stepDead) {
        setStatus('<span class="bad">Contradiction already reached.</span> Fix the clues or press <b>Reset steps</b> to start over.');
        return;
    }
    if (isComplete(stepSt)) {
        drawStepState(null);
        setStatus('<span class="good">Grid fully determined</span> — this network is forced by the clues. Press <b>Reset steps</b> to start over.');
        return;
    }
    const move = takeHumanStep(stepSt, stepClues);
    if (move) {
        stepCount++;
        drawStepState(move);
        markStrategy(move.rule);
        if (move.contradiction) {
            stepDead = true;
            setStatus('<span class="bad">Step ' + stepCount + ' — contradiction:</span> ' + move.text);
            return;
        }
        const body = move.chain
            ? move.chainIntro + formatChainList(move.chain) + move.chainOutro
            : move.text;
        setStatus('Step ' + stepCount + ' — <b>' + move.rule + ':</b> ' + body +
            (isComplete(stepSt) ? ' <span class="good">Grid complete!</span>' : ''));
        return;
    }
    const cfg = gatherConfig('step', 0, false);
    cfg.fixR = stepSt.edgeR; cfg.fixD = stepSt.edgeD;
    runWorker(cfg, res => {
        if (res.result === 'fact') {
            const [a, b] = edgeCellNames(res.kind, res.index);
            const chain = chainHtml(res.kind, res.index, res.val, a, b);   // narrate against the pre-move state
            setEdge(stepSt, res.kind, res.index, res.val);
            stepCount++;
            markStrategy('Exhaustive analysis');
            drawStepState({ cells: [], edges: [[res.kind, res.index]] });
            setStatus('Step ' + stepCount + ' — <b>Exhaustive analysis:</b> no simpler rule applies here. ' + chain +
                (isComplete(stepSt) ? ' <span class="good">Grid complete!</span>' : ''));
        } else if (res.result === 'contradiction') {
            stepDead = true;
            drawStepState(null);
            setStatus('<span class="bad">Contradiction:</span> no valid network is consistent with these clues and the current marks.');
        } else if (res.result === 'none' && res.exhausted) {
            drawStepState(null);
            setStatus('<span class="warn">Nothing further can be forced:</span> every undecided border differs between solutions — the puzzle has multiple solutions from this position. Run <b>True candidates</b> to map them.');
        } else {
            drawStepState(null);
            setStatus('<span class="warn">No deduction found within the time limit.</span> Raise the limit and take the step again.');
        }
    });
});
$('stepResetBtn').addEventListener('click', () => {
    stepInvalidate();
    clearLines();
    setStatus('Step-by-step state cleared.');
});

/* init */
buildStrategyPanel();
freshModel(6, 6);
render();
