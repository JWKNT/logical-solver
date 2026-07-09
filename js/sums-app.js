/* Japanese Sums app: grid UI, clue entry, engine calls, and the step ladder. */
(function () {
'use strict';

let R = 6, C = 6, D = 5;
let st = null;              // stepper state (candidate masks)
let clues = null;           // { rows: [...], cols: [...] } parsed
let worker = null;
let stepCounts = new Map();

const $ = id => document.getElementById(id);
const root = $('app-sums');
if (!root) return;

const workerUrl = URL.createObjectURL(new Blob(['(' + sumsWorkerMain.toString() + ')()'], { type: 'application/javascript' }));

function parseClue(str) {
  const t = (str || '').trim();
  if (!t) return null;
  const parts = t.split(/[\s,;]+/).filter(Boolean);
  const out = [];
  for (const p of parts) {
    if (p === '?') out.push(-1);
    else { const n = parseInt(p, 10); if (isNaN(n) || n < 1) return null; out.push(n); }
  }
  return out.length ? out : null;
}

function readClues() {
  const rows = [], cols = [];
  for (let r = 0; r < R; r++) rows.push(parseClue($('sumsRow' + r).value));
  for (let c = 0; c < C; c++) cols.push(parseClue($('sumsCol' + c).value));
  return { rows, cols };
}

function status(html) { $('sumsStatus').innerHTML = html; }

function buildGrid() {
  R = Math.max(2, Math.min(12, parseInt($('sumsRows').value, 10) || 6));
  C = Math.max(2, Math.min(12, parseInt($('sumsCols').value, 10) || 6));
  D = Math.max(2, Math.min(9, parseInt($('sumsDigits').value, 10) || 5));
  st = sums.makeSumsState(R, C, D);
  stepCounts = new Map();
  const wrap = $('sumsGridWrap');
  let html = '<table class="sums-grid"><tr><td class="sums-corner"></td>';
  for (let c = 0; c < C; c++) html += '<td class="sums-clue-col"><input id="sumsCol' + c + '" placeholder="\u00b7" spellcheck="false"></td>';
  html += '</tr>';
  for (let r = 0; r < R; r++) {
    html += '<tr><td class="sums-clue-row"><input id="sumsRow' + r + '" placeholder="\u00b7" spellcheck="false"></td>';
    for (let c = 0; c < C; c++) html += '<td class="sums-cell" id="sumsCell' + (r * C + c) + '"></td>';
    html += '</tr>';
  }
  html += '</table>';
  wrap.innerHTML = html;
  renderCells();
  buildStrategyPanel();
  status('Enter the group sums for each row and column (space-separated, in order; <code>?</code> for an unknown sum; leave blank for an unclued line), then <b>Solve</b>, <b>True candidates</b>, or <b>Take step</b>.');
}

function renderCells(hl) {
  const hlSet = new Set(hl || []);
  for (let i = 0; i < R * C; i++) {
    const td = $('sumsCell' + i);
    const m = st.cand[i];
    td.className = 'sums-cell' + (hlSet.has(i) ? ' hl' : '');
    if (m === 1) { td.innerHTML = '<span class="sums-blank">\u00d7</span>'; continue; }
    const ds = sums.digitsOf(m);
    if (ds.length === 1 && !(m & 1)) { td.innerHTML = '<span class="sums-digit">' + ds[0] + '</span>'; continue; }
    const full = ((1 << (D + 1)) - 2) | 1;
    if (m === full) { td.innerHTML = ''; continue; }
    td.innerHTML = '<span class="sums-cands">' + (m & 1 ? '\u00b7' : '') + ds.join('') + '</span>';
  }
}

function buildStrategyPanel() {
  const ol = $('sumsStrats');
  ol.innerHTML = '';
  for (const s of sums.SUMS_STRATEGIES) {
    const li = document.createElement('li');
    li.id = 'sumsStrat-' + s.name.replace(/\W+/g, '-');
    const n = stepCounts.get(s.name) || 0;
    li.innerHTML = '<b>' + s.name + '</b>' + (n ? '<span class="cnt">\u00d7' + n + '</span>' : '') + '<div class="sdesc">' + s.desc + '</div>';
    ol.appendChild(li);
  }
}
function markStrategy(name) {
  buildStrategyPanel();
  const li = $('sumsStrat-' + name.replace(/\W+/g, '-'));
  if (li) li.classList.add('active');
}

function runWorker(cfg, onDone, progressLabel) {
  if (worker) worker.terminate();
  worker = new Worker(workerUrl);
  const t0 = Date.now();
  status(progressLabel + '\u2026');
  worker.onmessage = e => { worker.terminate(); worker = null; onDone(e.data, Date.now() - t0); };
  worker.postMessage(cfg);
}

function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

$('sumsBuild').onclick = buildGrid;
$('sumsSolve').onclick = () => {
  clues = readClues();
  runWorker({ R, C, D, rowClues: clues.rows, colClues: clues.cols, mode: 'solve', timeLimit: (parseInt($('sumsTime').value, 10) || 10) * 1000 }, (res, ms) => {
    if (!res.firstSol) { status(res.timedOut ? '<span class="warn">No solution found within the time limit.</span>' : '<span class="bad">No solution exists.</span>'); return; }
    st = sums.makeSumsState(R, C, D);
    for (let i = 0; i < R * C; i++) st.cand[i] = 1 << res.firstSol[i];
    renderCells();
    status('<span class="good">Solved</span> in ' + ms + ' ms (' + res.nodes.toLocaleString() + ' nodes).' + (res.timedOut ? ' <span class="warn">(search truncated)</span>' : ''));
  }, 'Solving');
};
$('sumsCands').onclick = () => {
  clues = readClues();
  runWorker({ R, C, D, rowClues: clues.rows, colClues: clues.cols, mode: 'candidates', timeLimit: (parseInt($('sumsTime').value, 10) || 10) * 1000, maxSolutions: 1e9 }, (res, ms) => {
    if (!res.cand || res.solCount === 0) { status(res.timedOut ? '<span class="warn">Timed out before finding solutions.</span>' : '<span class="bad">No solution exists.</span>'); return; }
    st = sums.makeSumsState(R, C, D);
    for (let i = 0; i < R * C; i++) st.cand[i] = res.cand[i];
    renderCells();
    status((res.complete ? '<span class="good">True candidates</span> over <b>' + res.solCount.toLocaleString() + '</b> solution' + (res.solCount === 1 ? '' : 's')
      : '<span class="warn">Partial candidates</span> (search truncated at ' + res.solCount.toLocaleString() + ' solutions)') + ' \u2014 ' + ms + ' ms. Cells show every digit (and \u00b7 = possibly blank) that appears in some solution.');
  }, 'Enumerating solutions');
};
$('sumsStep').onclick = () => {
  clues = readClues();
  const mv = sums.takeSumsStep(st, clues);
  if (!mv) { status('No deduction found \u2014 the ladder is out of ideas here. Try <b>True candidates</b> for the engine\u2019s view.'); return; }
  stepCounts.set(mv.rule, (stepCounts.get(mv.rule) || 0) + 1);
  markStrategy(mv.rule);
  let html = '<b>' + mv.rule + '</b>: ' + esc(mv.text);
  if (mv.chain && mv.chain.length) {
    html = '<b>' + mv.rule + '</b>: ' + esc(mv.chainIntro) + '<ol>' +
      mv.chain.map(m => '<li><b>' + m.rule + '</b>: ' + esc(m.text) + '</li>').join('') + '</ol>' + mv.chainOutro;
  }
  status(html + (mv.contradiction ? ' <span class="bad">Contradiction \u2014 check the clues.</span>' : ''));
  renderCells(mv.cells);
};
$('sumsReset').onclick = () => { st = sums.makeSumsState(R, C, D); stepCounts = new Map(); renderCells(); buildStrategyPanel(); status('Marks reset; clues kept.'); };
$('sumsClear').onclick = () => buildGrid();

buildGrid();
})();
