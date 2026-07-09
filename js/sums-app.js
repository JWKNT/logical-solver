/* Japanese Sums app: grid UI, clue entry, engine calls, and the step ladder. */
(function () {
'use strict';

let R = 8, C = 8, D = 6, G = 3;   // G = clue slots per line
let st = null;              // stepper state (candidate masks)
let clues = null;           // { rows: [...], cols: [...] } parsed
let worker = null;
let stepCounts = new Map();

const $ = id => document.getElementById(id);
const root = $('app-sums');
if (!root) return;

const workerUrl = URL.createObjectURL(new Blob(['(' + sumsWorkerMain.toString() + ')()'], { type: 'application/javascript' }));

function readSlotClue(prefix) {
  // per-slot boxes: numbers >= 1 in order, '?' = unknown-sum group, a single '0'
  // = explicitly empty line (zero groups); all boxes empty = unclued line
  const vals = [];
  for (let g = 0; g < G; g++) {
    const el = $(prefix + '_' + g);
    const t = (el ? el.value : '').trim();
    if (!t) continue;
    if (/^[0-9]+$/.test(t)) { const n = parseInt(t, 10); if (n >= 0) vals.push(n); }
    else if (/^[0-9A-Za-z?]+$/.test(t)) vals.push(t.toUpperCase());
  }
  if (!vals.length) return null;
  if (vals.length === 1 && vals[0] === 0) return [];
  return vals.filter(v => v !== 0 || typeof v === 'string');
}

function readClues() {
  const rows = [], cols = [];
  for (let r = 0; r < R; r++) rows.push(readSlotClue('sumsRow' + r));
  for (let c = 0; c < C; c++) cols.push(readSlotClue('sumsCol' + c));
  return { rows, cols };
}

function status(html) { $('sumsStatus').innerHTML = html; }

function buildGrid(keepClues) {
  const saved = {};
  if (keepClues) {
    document.querySelectorAll('#sumsGridWrap input').forEach(el => { if (el.value) saved[el.id] = el.value; });
  }
  R = Math.max(2, Math.min(12, parseInt($('sumsRows').value, 10) || 8));
  C = Math.max(2, Math.min(12, parseInt($('sumsCols').value, 10) || 8));
  D = Math.max(2, Math.min(9, parseInt($('sumsDigits').value, 10) || 6));
  G = Math.max(1, Math.min(6, parseInt($('sumsSlots').value, 10) || 3));
  st = sums.makeSumsState(R, C, D);
  stepCounts = new Map();
  const wrap = $('sumsGridWrap');
  const slotBox = (prefix, vertical) => {
    let h = '<div class="sums-slots' + (vertical ? ' v' : '') + '">';
    for (let g = 0; g < G; g++) h += '<input id="' + prefix + '_' + g + '" maxlength="3" spellcheck="false">';
    return h + '</div>';
  };
  let html = '<table class="sums-grid"><tr><td class="sums-corner"></td>';
  for (let c = 0; c < C; c++) html += '<td class="sums-clue-col">' + slotBox('sumsCol' + c, true) + '</td>';
  html += '</tr>';
  for (let r = 0; r < R; r++) {
    html += '<tr><td class="sums-clue-row">' + slotBox('sumsRow' + r, false) + '</td>';
    for (let c = 0; c < C; c++) html += '<td class="sums-cell" id="sumsCell' + (r * C + c) + '"></td>';
    html += '</tr>';
  }
  html += '</table>';
  wrap.innerHTML = html;
  for (const id in saved) { const el = $(id); if (el) el.value = saved[id]; }
  renderCells();
  renderLetters();
  buildStrategyPanel();
  status('Enter each line\u2019s group sums in the boxes, in reading order (one box per group; <code>?</code> = unknown sum; a single <code>0</code> = the line is entirely blank; all boxes empty = unclued line). Then <b>Solve</b>, <b>True candidates</b>, or <b>Take step</b>.');
}

function renderCells(hl) {
  const hlSet = new Set(hl || []);
  for (let i = 0; i < R * C; i++) {
    const td = $('sumsCell' + i);
    const m = st.cand[i];
    td.className = 'sums-cell' + (hlSet.has(i) ? ' hl' : '');
    if (m === 1) { td.className += ' shaded'; td.innerHTML = ''; continue; }
    const ds = sums.digitsOf(m);
    if (ds.length === 1 && !(m & 1)) { td.innerHTML = '<span class="sums-digit">' + ds[0] + '</span>'; continue; }
    if (!(m & 1)) td.className += ' used';   // certainly holds a digit
    const full = ((1 << (D + 1)) - 2) | 1;
    if (m === full) { td.innerHTML = ''; continue; }
    td.innerHTML = '<span class="sums-cands">' + (m & 1 ? '\u00b7' : '') + ds.join('') + '</span>';
  }
}

function activeLetters() {
  const set = new Set();
  const cl = clues || readClues();
  for (const list of cl.rows.concat(cl.cols)) if (list) for (const tok of list) for (const L of sums.tokenLetters(tok)) set.add(L);
  return [...set].sort((a, b) => a - b);
}
function renderLetters(engineCand) {
  const box = $('sumsLetters');
  const letters = activeLetters();
  if (!letters.length) { box.hidden = true; return; }
  box.hidden = false;
  let html = '<table class="crypto-table"><tr><th></th>';
  for (let d = 0; d <= 9; d++) html += '<th>' + d + '</th>';
  html += '</tr>';
  for (const L of letters) {
    const mask = engineCand ? engineCand[L] : st.letterCand[L];
    html += '<tr><td class="crypto-letter">' + String.fromCharCode(65 + L) + '</td>';
    for (let d = 0; d <= 9; d++) {
      const on = mask & (1 << d);
      const solo = on && sums.popc(mask) === 1;
      html += '<td class="crypto-digit' + (on ? (solo ? ' solo' : '') : ' off') + '">' + d + '</td>';
    }
    html += '</tr>';
  }
  box.innerHTML = html + '</table>';
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

$('sumsBuild').onclick = () => buildGrid(true);
$('sumsSolve').onclick = () => {
  clues = readClues();
  runWorker({ R, C, D, rowClues: clues.rows, colClues: clues.cols, mode: 'solve', timeLimit: (parseInt($('sumsTime').value, 10) || 10) * 1000 }, (res, ms) => {
    if (!res.firstSol) { status(res.timedOut ? '<span class="warn">No solution found within the time limit.</span>' : '<span class="bad">No solution exists.</span>'); return; }
    st = sums.makeSumsState(R, C, D);
    for (let i = 0; i < R * C; i++) st.cand[i] = 1 << res.firstSol[i];
    if (res.firstLetters) for (let L = 0; L < 26; L++) if (res.firstLetters[L] >= 0) st.letterCand[L] = 1 << res.firstLetters[L];
    renderCells();
    renderLetters();
    const letterTxt = (res.letterIds || []).filter(L => res.firstLetters[L] >= 0).map(L => String.fromCharCode(65 + L) + '=' + res.firstLetters[L]).join(', ');
    status('<span class="good">Solved</span> in ' + ms + ' ms (' + res.nodes.toLocaleString() + ' nodes).' + (letterTxt ? ' Letters: <b>' + letterTxt + '</b>.' : '') + (res.timedOut ? ' <span class="warn">(search truncated)</span>' : ''));
  }, 'Solving');
};
$('sumsCands').onclick = () => {
  clues = readClues();
  runWorker({ R, C, D, rowClues: clues.rows, colClues: clues.cols, mode: 'candidates', timeLimit: (parseInt($('sumsTime').value, 10) || 10) * 1000, maxSolutions: 1e9 }, (res, ms) => {
    if (!res.cand || res.solCount === 0) { status(res.timedOut ? '<span class="warn">Timed out before finding solutions.</span>' : '<span class="bad">No solution exists.</span>'); return; }
    if (!res.complete) {
      status('<span class="warn">Search truncated</span> after ' + res.solCount.toLocaleString() + ' solutions (' + ms + ' ms) \u2014 the grid is too underconstrained for exact candidates, so no marks were drawn (a partial union would be misleading). Add clues or raise the time limit.');
      return;
    }
    st = sums.makeSumsState(R, C, D);
    for (let i = 0; i < R * C; i++) st.cand[i] = res.cand[i];
    if (res.letterCand) for (const L of res.letterIds || []) if (res.letterCand[L]) st.letterCand[L] = res.letterCand[L];
    renderCells();
    renderLetters();
    status('<span class="good">True candidates</span> over <b>' + res.solCount.toLocaleString() + '</b> solution' + (res.solCount === 1 ? '' : 's') + ' \u2014 ' + ms + ' ms. Cells show every digit (and \u00b7 = possibly blank) that appears in some solution.');
  }, 'Enumerating solutions');
};
$('sumsStep').onclick = () => {
  clues = readClues();
  const mv = sums.takeSumsStep(st, clues);
  renderLetters();
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
$('sumsReset').onclick = () => { st = sums.makeSumsState(R, C, D); stepCounts = new Map(); renderCells(); renderLetters(); buildStrategyPanel(); status('Marks reset; clues kept.'); };
$('sumsClear').onclick = () => buildGrid();

buildGrid();
})();
