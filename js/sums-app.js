/* Japanese Sums app: grid UI, clue entry, engine calls, and the step ladder. */
(function () {
'use strict';

let R = 8, C = 8, D = 6, G = 3;   // G = clue slots per line
let VALUES = null;   // custom value palette (null = digits 1..D)
function parseValues() {
  if (!$('sumsCustomVals').checked) return null;   // Digits 1..D mode
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
  // 0 is a legal placeable value: the cell is used and adds nothing to its group's sum
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

// the Take-step ladder runs in a persistent worker so heavy deductions never
// freeze the page; the worker owns the stepping state (and its line cache)
// between steps, and the main thread mirrors it for rendering
const stepWorkerUrl = URL.createObjectURL(new Blob([
  sumsStepperMain.toString() + '\n(' + function () {
    const api = sumsStepperMain(self);
    let wst = null;
    self.onmessage = e => {
      const m = e.data;
      if (m.cmd === 'load') {
        wst = api.makeSumsState(m.R, m.C, m.D, m.values || undefined);
        wst.kd = m.kd; wst.alien = m.alien;
        Object.assign(wst.variants, m.variants);
        if (m.cand) wst.cand.set(m.cand);
        if (m.letterCand) wst.letterCand.set(m.letterCand);
        if (m.baseCand) wst.baseCand = new Set(m.baseCand);
        if (m.baseNarrated) wst.__baseNarrated = true;
        return;
      }
      if (m.cmd === 'step') {
        let mv = null;
        try { mv = api.takeSumsStep(wst, m.clues); }
        catch (err) { mv = { rule: 'Error', text: String((err && err.message) || err), contradiction: true }; }
        const lite = mv && {
          rule: mv.rule, text: mv.text, cells: mv.cells || [], contradiction: !!mv.contradiction,
          chainIntro: mv.chainIntro, chainOutro: mv.chainOutro,
          chain: mv.chain && mv.chain.map(x => ({ rule: x.rule, text: x.text, contradiction: !!x.contradiction })),
          cases: mv.cases && mv.cases.map(c => ({ intro: c.intro, chain: (c.chain || []).map(x => ({ rule: x.rule, text: x.text })) })),
        };
        self.postMessage({ mv: lite,
          state: { cand: Array.from(wst.cand), letterCand: Array.from(wst.letterCand), baseCand: wst.baseCand ? [...wst.baseCand] : null, baseNarrated: !!wst.__baseNarrated },
          complete: api.sumsComplete(wst) });
      }
    };
  }.toString() + ')()'
], { type: 'application/javascript' }));
let stepWorker = null;
let stepBusy = false;
let stepStale = true;   // main-thread st changed: the worker must reload it before stepping
function markStepStale() { stepStale = true; }
function stepWorkerLoadMsg() {
  return { cmd: 'load', R, C, D, values: VALUES || undefined, kd: st.kd, alien: st.alien,
    variants: st.variants, cand: Array.from(st.cand), letterCand: Array.from(st.letterCand),
    baseCand: st.baseCand ? [...st.baseCand] : null, baseNarrated: !!st.__baseNarrated };
}

function readSlotClue(prefix) {
  // per-slot boxes: numbers >= 1 in order, '?' = unknown-sum group, a single '0'
  // = explicitly empty line (zero groups); all boxes empty = unclued line
  const vals = [];
  for (let g = 0; g < G; g++) {
    const el = $(prefix + '_' + g);
    const t = (el ? (el.dataset.orig !== undefined ? el.dataset.orig : el.value) : '').trim();
    if (!t) continue;
    if (/^-?[0-9]+$/.test(t)) vals.push(parseInt(t, 10));
    else if ($('sumsAlien').checked && /^[0-9A-Za-z?#.]+$/.test(t)) vals.push(t.toUpperCase());
    else if (/^-?[0-9A-Za-z?#]+$/.test(t)) vals.push(t.toUpperCase());
  }
  if (!vals.length) return null;
  // with a palette admitting zero-sum groups (a 0 value or negatives), 0 is a
  // real clue; otherwise the classic shortcut: a lone 0 = explicitly empty line
  const zeroSumPossible = VALUES && (VALUES.includes(0) || VALUES.some(v => v < 0));
  if (!zeroSumPossible) {
    if (vals.length === 1 && vals[0] === 0) return [];
    return vals.filter(v => v !== 0 || typeof v === 'string');
  }
  return vals;
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
  R = Math.max(2, Math.min(16, parseInt($('sumsRows').value, 10) || 8));
  C = Math.max(2, Math.min(16, parseInt($('sumsCols').value, 10) || 8));
  D = Math.max(2, Math.min(9, parseInt($('sumsDigits').value, 10) || 6));
  G = Math.max(1, Math.min(8, parseInt($('sumsSlots').value, 10) || 3));
  const pv = parseValues();
  VALUES = pv && !pv.error ? pv.values : null;
  const customOn = $('sumsCustomVals').checked;
  $('sumsValuesWrap').hidden = !customOn;
  $('sumsDigits').closest('label').style.display = customOn ? 'none' : '';
  st = sums.makeSumsState(R, C, D, VALUES || undefined);
  st.kd = $('sumsKD').checked;
  st.alien = $('sumsAlien').checked;
  Object.assign(st.variants, readVariants());
  stepCounts = new Map();
  stepNo = 0;
  const wrap = $('sumsGridWrap');
  const slotBox = (prefix, vertical) => {
    let h = '<div class="sums-slots' + (vertical ? ' v' : '') + '">';
    const ml = $('sumsAlien').checked ? 12 : 3;   // alien numerals may use '.'-separated digits
    for (let g = 0; g < G; g++) h += '<input id="' + prefix + '_' + g + '" maxlength="' + ml + '" spellcheck="false" autocomplete="off">';
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
    // typing is the single source of truth: the canonical clue follows every
    // keystroke, so a substituted display can never be mistaken for input
    el.addEventListener('input', () => { el.dataset.orig = el.value; el.classList.remove('resolved'); });
  });
  markStepStale();
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
  const alien = $('sumsAlien').checked;
  const pinnedBase = alien && st.baseCand && st.baseCand.size === 1 ? [...st.baseCand][0] : (alien ? null : 10);
  const resolved = sums.resolvedClueSums(st, readClues());
  const origOf = el2 => (el2 ? (el2.dataset.orig !== undefined ? el2.dataset.orig : el2.value) : '').trim();
  document.querySelectorAll('#sumsGridWrap .sums-slots input').forEach(el => {
    if (document.activeElement === el) return;
    const orig = el.dataset.orig !== undefined ? el.dataset.orig : el.value;
    if (el.dataset.orig === undefined && el.value) {
      // a page restored by the browser may refill values with old substituted
      // displays; never adopt a value while it carries the resolved styling
      if (el.classList.contains('resolved')) { el.value = ''; return; }
      el.dataset.orig = el.value;
    }
    if (!orig) { el.classList.remove('resolved'); return; }
    // a fully determined ?/# (or any unknown-bearing) token shows its true sum
    const m2 = el.id.match(/^sums(Row|Col)(\d+)_(\d+)$/);
    if (m2 && /[?#]/.test(orig)) {
      const kind = m2[1] === 'Row' ? 'rows' : 'cols';
      const li = +m2[2], slotNo = +m2[3];
      let tokIdx = 0;
      for (let g = 0; g < slotNo; g++) if (origOf($('sums' + m2[1] + li + '_' + g))) tokIdx++;
      const arr = resolved[kind][li];
      if (arr && arr[tokIdx] !== null && arr[tokIdx] !== undefined && pinnedBase) {
        el.value = pinnedBase === 10 ? String(arr[tokIdx]) : sums.numeralOf(arr[tokIdx], pinnedBase);
        el.classList.add('resolved');
        return;
      }
    }
    // substitute solved cipher letters; alien digits of 10+ force dotted form
    const fields = alien && orig.includes('.') ? orig.toUpperCase().split('.') : orig.toUpperCase().split('');
    let subbed = false, anyWide = false;
    const outF = fields.map(f => {
      if (map[f] !== undefined) { subbed = true; if (+map[f] >= 10) anyWide = true; return map[f]; }
      if (/^[0-9]+$/.test(f) && +f >= 10) anyWide = true;
      return f;
    });
    if (subbed) { el.value = anyWide ? outF.join('.') : outF.join(''); el.classList.add('resolved'); }
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
function renderLetters(engineCand, engineBases) {
  const box = $('sumsLetters');
  const letters = activeLetters();
  const alien = $('sumsAlien').checked;
  if (!letters.length && !alien) { box.hidden = true; return; }
  box.hidden = false;
  let html = '<div class="crypto-boxes">';
  if (alien) {
    // the base box: candidates like a cipher letter, solved when pinned
    if (st.alien && !st.baseCand) sums.ensureBaseCand(st, clues || readClues());
    const bs = engineBases ? engineBases : (st.baseCand ? [...st.baseCand].sort((x, y) => x - y) : []);
    html += '<div class="crypto-box"><div class="crypto-box-letter">base</div>';
    if (bs.length === 1) html += '<div class="crypto-box-solved">' + bs[0] + '</div>';
    else if (!bs.length) html += '<div class="crypto-box-solved">?</div>';
    else {
      html += '<div class="crypto-box-marks">';
      const lo = bs[0], hi = bs[bs.length - 1];
      for (let b = lo; b <= hi; b++) html += '<span class="' + (bs.includes(b) ? '' : 'off') + '">' + b + '</span>';
      html += '</div>';
    }
    html += '</div>';
  }
  const maxD = alien && st.baseCand && st.baseCand.size ? Math.max(...st.baseCand) - 1 : 9;
  for (const L of letters) {
    const mask = engineCand ? engineCand[L] : st.letterCand[L];
    const ds = sums.digitsOf2(mask);
    html += '<div class="crypto-box"><div class="crypto-box-letter">' + String.fromCharCode(65 + L) + '</div>';
    if (ds.length === 1) html += '<div class="crypto-box-solved">' + ds[0] + '</div>';
    else {
      html += '<div class="crypto-box-marks">';
      for (let d = 0; d <= maxD; d++) html += '<span class="' + ((mask & (1 << d)) ? '' : 'off') + '">' + d + '</span>';
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
  const ruleOn = key => key === 'checker' ? ((vs.blankConn && vs.reach) || (vs.numConn && vs.blankReach)) : !!vs[key];
  const shapeRules = sums.SUMS_STRATEGIES.filter(s2 => s2.variant && s2.variant !== 'kd' && s2.variant !== 'alien');
  if (shapeRules.length) {
    const anyOn = shapeRules.some(s2 => ruleOn(s2.variant));
    const bar = document.createElement('li');
    bar.className = 'variant-bar' + (anyOn ? ' on' : '');
    bar.innerHTML = 'Shape & order' + (anyOn ? '' : ' <span class="voff">(off)</span>');
    ol.appendChild(bar);
    for (const s of shapeRules) { const li = mk(s); if (!ruleOn(s.variant)) li.className = 'vdim'; ol.appendChild(li); }
  }
  const alienRules = sums.SUMS_STRATEGIES.filter(s2 => s2.variant === 'alien');
  if (alienRules.length) {
    const on = $('sumsAlien').checked;
    const bar = document.createElement('li');
    bar.className = 'variant-bar' + (on ? ' on' : '');
    bar.innerHTML = 'Alien' + (on ? '' : ' <span class="voff">(off)</span>');
    ol.appendChild(bar);
    for (const s of alienRules) { const li = mk(s); if (!on) li.className = 'vdim'; ol.appendChild(li); }
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
  runWorker({ R, C, D, kd: $('sumsKD').checked, alien: $('sumsAlien').checked, variants: readVariants(), values: VALUES || undefined, rowClues: clues.rows, colClues: clues.cols, mode: 'solve', timeLimit: (parseInt($('sumsTime').value, 10) || 10) * 1000 }, (res, ms) => {
    if (!res.firstSol) { status(res.timedOut ? '<span class="warn">No solution found within the time limit.</span>' : '<span class="bad">No solution exists.</span>'); return; }
    st = sums.makeSumsState(R, C, D, VALUES || undefined);
    st.alien = $('sumsAlien').checked;
    if (st.alien && res.base) st.baseCand = new Set([res.base]);
    for (let i = 0; i < R * C; i++) st.cand[i] = 1 << res.firstSol[i];
    if (res.firstLetters) for (let L = 0; L < 26; L++) if (res.firstLetters[L] >= 0) st.letterCand[L] = 1 << res.firstLetters[L];
    markStepStale();
    renderCells();
    renderLetters();
    const letterTxt = (res.letterIds || []).filter(L => res.firstLetters[L] >= 0).map(L => String.fromCharCode(65 + L) + '=' + res.firstLetters[L]).join(', ');
    status('<span class="good">Solved</span> in ' + ms + ' ms (' + res.nodes.toLocaleString() + ' nodes).' + (res.base ? ' Base: <b>' + res.base + '</b>.' : '') + (letterTxt ? ' Letters: <b>' + letterTxt + '</b>.' : '') + (res.timedOut ? ' <span class="warn">(search truncated)</span>' : ''));
  }, 'Solving');
};
$('sumsCands').onclick = () => {
  clues = readClues();
  runWorker({ R, C, D, kd: $('sumsKD').checked, alien: $('sumsAlien').checked, variants: readVariants(), values: VALUES || undefined, rowClues: clues.rows, colClues: clues.cols, mode: 'candidates', timeLimit: (parseInt($('sumsTime').value, 10) || 10) * 1000, maxSolutions: 1e9 }, (res, ms) => {
    if (!res.cand || res.solCount === 0) { status(res.timedOut ? '<span class="warn">Timed out before finding solutions.</span>' : '<span class="bad">No solution exists.</span>'); return; }
    if (!res.complete) {
      status('<span class="warn">Search truncated</span> after ' + res.solCount.toLocaleString() + ' solutions (' + ms + ' ms) \u2014 the grid is too underconstrained for exact candidates, so no marks were drawn (a partial union would be misleading). Add clues or raise the time limit.');
      return;
    }
    st = sums.makeSumsState(R, C, D, VALUES || undefined);
    st.alien = $('sumsAlien').checked;
    if (st.alien && res.bases && res.bases.length) st.baseCand = new Set(res.bases);
    for (let i = 0; i < R * C; i++) st.cand[i] = res.cand[i];
    if (res.letterCand) for (const L of res.letterIds || []) if (res.letterCand[L]) st.letterCand[L] = res.letterCand[L];
    markStepStale();
    renderCells();
    renderLetters(null, st.alien && res.bases ? res.bases : null);
    status('<span class="good">True candidates</span> over <b>' + res.solCount.toLocaleString() + '</b> solution' + (res.solCount === 1 ? '' : 's') + ' \u2014 ' + ms + ' ms. Cells show every digit (and \u00b7 = possibly blank) that appears in some solution.' + (st.alien && res.bases ? ' Feasible base' + (res.bases.length === 1 ? '' : 's') + ': <b>' + res.bases.join(', ') + '</b>.' : ''));
  }, 'Enumerating solutions');
};
$('sumsStep').onclick = () => {
  if (stepBusy) return;
  clues = readClues();
  if (!stepWorker) {
    stepWorker = new Worker(stepWorkerUrl);
    stepWorker.onmessage = onStepReply;
    stepWorker.onerror = err => { stepBusy = false; $('sumsStep').disabled = false; status('<span class="bad">Step worker error:</span> ' + esc(String(err.message || err))); };
    stepStale = true;
  }
  if (stepStale) { stepWorker.postMessage(stepWorkerLoadMsg()); stepStale = false; }
  stepBusy = true;
  $('sumsStep').disabled = true;
  status('Thinking\u2026 (deeper deductions can take a little while)');
  stepWorker.postMessage({ cmd: 'step', clues });
};
function onStepReply(e) {
  stepBusy = false;
  $('sumsStep').disabled = false;
  const { mv, state, complete } = e.data;
  // mirror the worker's state for rendering and the other tools
  st.cand.set(state.cand);
  st.letterCand.set(state.letterCand);
  st.baseCand = state.baseCand ? new Set(state.baseCand) : null;
  if (state.baseNarrated) st.__baseNarrated = true;
  renderLetters();
  if (!mv) {
    if (complete) { status('<span class="good">Solved!</span> Every cell holds a digit or is shaded blank.'); renderCells(); return; }
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
  } else if (mv.cases && mv.cases.length) {
    html = head + esc(mv.text) + mv.cases.map(cs => '<br>' + esc(cs.intro) + (cs.chain.length
      ? '<ol>' + cs.chain.map(m => '<li><b>' + m.rule + '</b>: ' + esc(m.text) + '</li>').join('') + '</ol>'
      : ' (nothing further follows quickly.)')).join('');
  }
  status(html + (mv.contradiction ? ' <span class="bad">Contradiction \u2014 check the clues.</span>' : '') + (complete ? '<br><span class="good">Solved!</span> Every cell holds a digit or is shaded blank.' : ''));
  renderCells(mv.cells);
}
$('sumsReset').onclick = () => { st = sums.makeSumsState(R, C, D, VALUES || undefined); st.kd = $('sumsKD').checked; st.alien = $('sumsAlien').checked; Object.assign(st.variants, readVariants()); stepCounts = new Map(); stepNo = 0; markStepStale(); renderCells(); renderLetters(); buildStrategyPanel(); status('Marks reset; clues kept.'); };
$('sumsClear').onclick = () => buildGrid();

const VARIANT_BOXES = [
  ['sumsVNumConn', 'numConn'], ['sumsVBlankConn', 'blankConn'],
  ['sumsVNo22Num', 'no22num'], ['sumsVNo22Blank', 'no22blank'],
  ['sumsVAsc', 'asc'], ['sumsVReach', 'reach'], ['sumsVBlankReach', 'blankReach'],
];
function readVariants() {
  const out = {};
  for (const [id, key] of VARIANT_BOXES) out[key] = $(id).checked;
  return out;
}
function variantChanged(msg) {
  st = sums.makeSumsState(R, C, D, VALUES || undefined);
  st.kd = $('sumsKD').checked;
  st.alien = $('sumsAlien').checked;
  Object.assign(st.variants, readVariants());
  stepCounts = new Map(); stepNo = 0;
  markStepStale();
  renderCells(); renderLetters(); buildStrategyPanel();
  status(msg + ' Marks reset.');
}
$('sumsAlien').addEventListener('change', () => {
  buildGrid(true);
  status($('sumsAlien').checked
    ? '<b>Alien</b> on: the clues\u2019 number base is unknown (2\u201331) \u2014 digits and cipher letters are read in that base. Write a two-decimal-character base digit with dots (<code>11.3</code>). Marks reset, clues kept.'
    : 'Alien off: clues are decimal again. Marks reset, clues kept.');
});
$('sumsKD').addEventListener('change', () => variantChanged($('sumsKD').checked
  ? '<b>Knapp daneben</b> on: every clue is one off its true value (a 10 is really 9 or 11).'
  : 'Knapp daneben off: clues are exact again.'));
for (const [id] of VARIANT_BOXES) $(id).addEventListener('change', () => variantChanged('Shape/order rules updated.'));

$('sumsCustomVals').addEventListener('change', () => {
  buildGrid(true);
  status($('sumsCustomVals').checked
    ? 'Custom values mode: enter a comma-separated palette (the Digits box is replaced). Marks reset, clues kept.'
    : 'Standard digits 1\u2026' + D + ' mode. Marks reset, clues kept.');
});
$('sumsValues').addEventListener('change', () => {
  const pv2 = parseValues();
  if (pv2 && pv2.error) { status('Custom values: ' + pv2.error); return; }
  buildGrid(true);
  status(pv2 ? 'Custom values <b>' + pv2.values.join(', ') + '</b> \u2014 each row/column may use each value up to its listed multiplicity. Marks reset, clues kept.'
             : 'Standard digits 1\u2026' + D + ' restored. Marks reset, clues kept.');
});

buildGrid();
})();
