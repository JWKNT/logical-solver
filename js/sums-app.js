/* Japanese Sums app: grid UI, clue entry, engine calls, and the step ladder. */
(function () {
'use strict';

let R = 8, C = 8, D = 6, G = 3;   // G = clue slots per line
let VALUES = null;   // custom value palette (null = digits 1..D)
function parseValues() {
  const txt = $('sumsValues').value.trim();
  if (!txt) return null;
  const parts = txt.split(/[,;\s]+/).filter(Boolean);
  const vals = [];
  for (const p of parts) {
    const v = parseInt(p, 10);
    if (!Number.isInteger(v) || String(v) !== p.replace(/^\+/, '')) return { error: '\u201c' + p + '\u201d is not a whole number' };
    vals.push(v);
  }
  if (new Set(vals).size > 15) return { error: 'at most 15 distinct values' };
  const byVal = new Map();
  for (const v of vals) byVal.set(v, (byVal.get(v) || 0) + 1);
  for (const [v, c2] of byVal) if (c2 > 3) return { error: 'a value can repeat at most 3 times (' + v + ' appears ' + c2 + '\u00d7)' };
  if (byVal.has(0)) return { error: '0 cannot be a placeable value (blank cells are the zeros)' };
  return { values: vals };
}
let st = null;              // stepper state (candidate masks)
let clues = null;           // { rows: [...], cols: [...] } parsed
let worker = null;
let stepCounts = new Map();
let stepNo = 0;

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
    const t = (el ? (el.dataset.orig !== undefined ? el.dataset.orig : el.value) : '').trim();
    if (!t) continue;
    if (/^[0-9]+$/.test(t)) { const n = parseInt(t, 10); if (n >= 0) vals.push(n); }
    else if (/^[0-9A-Za-z?#]+$/.test(t)) vals.push(t.toUpperCase());
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
    document.querySelectorAll('#sumsGridWrap input').forEach(el => {
      const orig = el.dataset.orig !== undefined ? el.dataset.orig : el.value;
      if (orig) saved[el.id] = orig;
    });
  }
  R = Math.max(2, Math.min(12, parseInt($('sumsRows').value, 10) || 8));
  C = Math.max(2, Math.min(12, parseInt($('sumsCols').value, 10) || 8));
  D = Math.max(2, Math.min(9, parseInt($('sumsDigits').value, 10) || 6));
  G = Math.max(1, Math.min(6, parseInt($('sumsSlots').value, 10) || 3));
  const pv = parseValues();
  VALUES = pv && !pv.error ? pv.values : null;
  st = sums.makeSumsState(R, C, D, VALUES || undefined);
  st.kd = $('sumsKD').checked;
  Object.assign(st.variants, readVariants());
  stepCounts = new Map();
  stepNo = 0;
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
  for (const id in saved) { const el = $(id); if (el) { el.value = saved[id]; el.dataset.orig = saved[id]; } }
  document.querySelectorAll('#sumsGridWrap .sums-slots input').forEach(el => {
    el.addEventListener('focus', () => slotFocus(el));
    el.addEventListener('blur', () => slotBlur(el));
  });
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
    const ds = sums.digitsOf(m).map(k => st.pal[k - 1]);
    if (ds.length === 1 && !(m & 1)) { td.innerHTML = '<span class="sums-digit">' + ds[0] + '</span>'; continue; }
    if (!(m & 1)) td.className += ' used';   // certainly holds a digit
    const full = ((1 << (st.D + 1)) - 2) | 1;
    if (m === full) { td.innerHTML = ''; continue; }
    const plain = st.pal.every((v, q) => v === q + 1) && st.pal.length <= 9;
    td.innerHTML = '<span class="sums-cands">' + (m & 1 ? '\u00b7' : '') + ds.join(plain ? '' : ' ') + '</span>';
  }
}

function solvedLetterMap() {
  const map = {};
  for (const L of activeLetters()) {
    const ds = sums.digitsOf2(st.letterCand[L]);
    if (ds.length === 1) map[String.fromCharCode(65 + L)] = String(ds[0]);
  }
  return map;
}
function refreshClueDisplays() {
  const map = solvedLetterMap();
  document.querySelectorAll('#sumsGridWrap .sums-slots input').forEach(el => {
    if (document.activeElement === el) return;
    const orig = el.dataset.orig !== undefined ? el.dataset.orig : el.value;
    if (el.dataset.orig === undefined && el.value) el.dataset.orig = el.value;
    if (!orig) { el.classList.remove('resolved'); return; }
    let out = '', subbed = false;
    for (const ch of orig.toUpperCase()) {
      if (map[ch] !== undefined) { out += map[ch]; subbed = true; }
      else out += ch;
    }
    if (subbed) { el.value = out; el.classList.add('resolved'); }
    else { el.value = orig; el.classList.remove('resolved'); }
  });
}
function slotFocus(el) { if (el.dataset.orig !== undefined) { el.value = el.dataset.orig; el.classList.remove('resolved'); } }
function slotBlur(el) { el.dataset.orig = el.value; refreshClueDisplays(); }

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
  let html = '<div class="crypto-boxes">';
  for (const L of letters) {
    const mask = engineCand ? engineCand[L] : st.letterCand[L];
    const ds = sums.digitsOf2(mask);
    html += '<div class="crypto-box"><div class="crypto-box-letter">' + String.fromCharCode(65 + L) + '</div>';
    if (ds.length === 1) html += '<div class="crypto-box-solved">' + ds[0] + '</div>';
    else {
      html += '<div class="crypto-box-marks">';
      for (let d = 0; d <= 9; d++) html += '<span class="' + ((mask & (1 << d)) ? '' : 'off') + '">' + d + '</span>';
      html += '</div>';
    }
    html += '</div>';
  }
  box.innerHTML = html + '</div>';
  refreshClueDisplays();
}

function buildStrategyPanel() {
  const ol = $('sumsStrats');
  ol.innerHTML = '';
  const mk = s => {
    const li = document.createElement('li');
    li.id = 'sumsStrat-' + s.name.replace(/\W+/g, '-');
    const n = stepCounts.get(s.name) || 0;
    li.innerHTML = '<b>' + s.name + '</b>' + (n ? '<span class="cnt">\u00d7' + n + '</span>' : '') + '<div class="sdesc">' + s.desc + '</div>';
    return li;
  };
  for (const s of sums.SUMS_STRATEGIES.filter(s2 => !s2.variant)) ol.appendChild(mk(s));
  const vs = readVariants();
  const ruleOn = key => key === 'checker' ? (vs.blankConn && vs.reach) : !!vs[key];
  const shapeRules = sums.SUMS_STRATEGIES.filter(s2 => s2.variant && s2.variant !== 'kd');
  if (shapeRules.length) {
    const anyOn = shapeRules.some(s2 => ruleOn(s2.variant));
    const bar = document.createElement('li');
    bar.className = 'variant-bar' + (anyOn ? ' on' : '');
    bar.innerHTML = 'Shape & order' + (anyOn ? '' : ' <span class="voff">(off)</span>');
    ol.appendChild(bar);
    for (const s of shapeRules) { const li = mk(s); if (!ruleOn(s.variant)) li.className = 'vdim'; ol.appendChild(li); }
  }
  const kdRules = sums.SUMS_STRATEGIES.filter(s2 => s2.variant === 'kd');
  if (kdRules.length) {
    const on = $('sumsKD').checked;
    const bar = document.createElement('li');
    bar.className = 'variant-bar' + (on ? ' on' : '');
    bar.innerHTML = 'Knapp daneben' + (on ? '' : ' <span class="voff">(off)</span>');
    ol.appendChild(bar);
    for (const s of kdRules) { const li = mk(s); if (!on) li.className = 'vdim'; ol.appendChild(li); }
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
  runWorker({ R, C, D, kd: $('sumsKD').checked, variants: readVariants(), values: VALUES || undefined, rowClues: clues.rows, colClues: clues.cols, mode: 'solve', timeLimit: (parseInt($('sumsTime').value, 10) || 10) * 1000 }, (res, ms) => {
    if (!res.firstSol) { status(res.timedOut ? '<span class="warn">No solution found within the time limit.</span>' : '<span class="bad">No solution exists.</span>'); return; }
    st = sums.makeSumsState(R, C, D, VALUES || undefined);
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
  runWorker({ R, C, D, kd: $('sumsKD').checked, variants: readVariants(), values: VALUES || undefined, rowClues: clues.rows, colClues: clues.cols, mode: 'candidates', timeLimit: (parseInt($('sumsTime').value, 10) || 10) * 1000, maxSolutions: 1e9 }, (res, ms) => {
    if (!res.cand || res.solCount === 0) { status(res.timedOut ? '<span class="warn">Timed out before finding solutions.</span>' : '<span class="bad">No solution exists.</span>'); return; }
    if (!res.complete) {
      status('<span class="warn">Search truncated</span> after ' + res.solCount.toLocaleString() + ' solutions (' + ms + ' ms) \u2014 the grid is too underconstrained for exact candidates, so no marks were drawn (a partial union would be misleading). Add clues or raise the time limit.');
      return;
    }
    st = sums.makeSumsState(R, C, D, VALUES || undefined);
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
  if (!mv) {
    if (sums.sumsComplete(st)) { status('<span class="good">Solved!</span> Every cell holds a digit or is shaded blank.'); renderCells(); return; }
    status('No deduction found \u2014 the ladder is out of ideas here. Try <b>True candidates</b> for the engine\u2019s view.');
    return;
  }
  stepNo++;
  stepCounts.set(mv.rule, (stepCounts.get(mv.rule) || 0) + 1);
  markStrategy(mv.rule);
  const head = 'Step ' + stepNo + ' \u2014 <b>' + mv.rule + '</b>: ';
  let html = head + esc(mv.text);
  if (mv.chain && mv.chain.length) {
    html = head + esc(mv.chainIntro) + '<ol>' +
      mv.chain.map(m => '<li><b>' + m.rule + '</b>: ' + esc(m.text) + '</li>').join('') + '</ol>' + mv.chainOutro;
  }
  const done = sums.sumsComplete(st);
  status(html + (mv.contradiction ? ' <span class="bad">Contradiction \u2014 check the clues.</span>' : '') + (done ? '<br><span class="good">Solved!</span> Every cell holds a digit or is shaded blank.' : ''));
  renderCells(mv.cells);
};
$('sumsReset').onclick = () => { st = sums.makeSumsState(R, C, D, VALUES || undefined); st.kd = $('sumsKD').checked; Object.assign(st.variants, readVariants()); stepCounts = new Map(); stepNo = 0; renderCells(); renderLetters(); buildStrategyPanel(); status('Marks reset; clues kept.'); };
$('sumsClear').onclick = () => buildGrid();

const VARIANT_BOXES = [
  ['sumsVNumConn', 'numConn'], ['sumsVBlankConn', 'blankConn'],
  ['sumsVNo22Num', 'no22num'], ['sumsVNo22Blank', 'no22blank'],
  ['sumsVAsc', 'asc'], ['sumsVReach', 'reach'],
];
function readVariants() {
  const out = {};
  for (const [id, key] of VARIANT_BOXES) out[key] = $(id).checked;
  return out;
}
function variantChanged(msg) {
  st = sums.makeSumsState(R, C, D, VALUES || undefined);
  st.kd = $('sumsKD').checked;
  Object.assign(st.variants, readVariants());
  stepCounts = new Map(); stepNo = 0;
  renderCells(); renderLetters(); buildStrategyPanel();
  status(msg + ' Marks reset.');
}
$('sumsKD').addEventListener('change', () => variantChanged($('sumsKD').checked
  ? '<b>Knapp daneben</b> on: every clue is one off its true value (a 10 is really 9 or 11).'
  : 'Knapp daneben off: clues are exact again.'));
for (const [id] of VARIANT_BOXES) $(id).addEventListener('change', () => variantChanged('Shape/order rules updated.'));

$('sumsValues').addEventListener('change', () => {
  const pv2 = parseValues();
  if (pv2 && pv2.error) { status('Custom values: ' + pv2.error); return; }
  buildGrid(true);
  status(pv2 ? 'Custom values <b>' + pv2.values.join(', ') + '</b> \u2014 each row/column may use each value up to its listed multiplicity. Marks reset, clues kept.'
             : 'Standard digits 1\u2026' + D + ' restored. Marks reset, clues kept.');
});

buildGrid();
})();
