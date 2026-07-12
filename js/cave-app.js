(function () {
  const $ = id => document.getElementById(id);
  let R = 6, C = 6, clues = {}, state = {}, shown = null, stepNo = 0;
  let stepCounts = new Map(), history = [], auto = false, stepBusy = false;
  let solveWorker = null, stepWorker = null, stepSnapshotPending = false;

  const esc = s => String(s).replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
  function variants() {
    return { no2x2Black: $('caveNo22Black').checked, no2x2White: $('caveNo22White').checked, twilight: $('caveTwilight').checked };
  }
  function cfg(maxSolutions) {
    return { R, C, clues, time: +$('caveTime').value, maxSolutions: maxSolutions || 2, ...variants() };
  }
  function cloneState(s) { return { white: new Set(s.white || []), black: new Set(s.black || []) }; }
  function status(text, html) { if (html) $('caveStatus').innerHTML = text; else $('caveStatus').textContent = text; }

  function resetMarks(message, doRender) {
    stopAuto(); killStep(); killSolve();
    state = {}; shown = null; stepNo = 0; stepCounts = new Map(); history = [];
    updatePrev(); buildStrategies();
    if (message) status(message);
    if (doRender !== false) render();
  }

  function build(clear) {
    R = +$('caveRows').value; C = +$('caveCols').value;
    if (clear) clues = {};
    resetMarks(clear ? 'Grid resized; enter the Cave clues.' : null, true);
  }

  function editClue(i, raw) {
    raw = String(raw || '').trim();
    const twilight = $('caveTwilight').checked, min = twilight ? 1 : 2, max = twilight ? R * C : R + C - 1;
    if (raw.includes('?')) clues[i] = '?';
    else {
      const digits = raw.replace(/\D/g, '').slice(0, 3), n = +digits;
      if (digits && n >= min && n <= max) clues[i] = n;
      else delete clues[i];
    }
    resetMarks('Steps reset after editing the puzzle.', false);
  }

  function render() {
    const grid = $('caveGrid');
    grid.style.gridTemplateColumns = `repeat(${C}, 52px)`;
    grid.innerHTML = '';
    for (let i = 0; i < R * C; i++) {
      const cell = document.createElement('div');
      cell.className = 'cave-cell';
      const solved = shown ? shown[i] : null;
      if (solved === 0 || (state.black && state.black.has(i))) cell.classList.add('black');
      else if (solved === 1) cell.classList.add('solved-white');
      else if (state.white && state.white.has(i)) cell.classList.add('white');
      else if (state.white || state.black) cell.classList.add('unknown');
      if (Object.prototype.hasOwnProperty.call(clues, i)) cell.classList.add('clue');

      const input = document.createElement('span');
      input.className = 'cave-clue-entry'; input.contentEditable = 'true'; input.spellcheck = false;
      input.textContent = Object.prototype.hasOwnProperty.call(clues, i) ? clues[i] : '';
      input.setAttribute('aria-label', `Clue at row ${((i / C) | 0) + 1}, column ${i % C + 1}`);
      input.onkeydown = e => {
        if (e.key.length === 1 && !/[0-9?]/.test(e.key)) e.preventDefault();
        e.stopPropagation();
      };
      input.oninput = () => editClue(i, input.textContent);
      input.onblur = () => render();
      cell.append(input);
      grid.append(cell);
    }
  }

  function buildStrategies(active) {
    const list = $('caveStrats'); list.innerHTML = '';
    const make = i => {
      const t = CaveStepper.techniques[i];
      const li = document.createElement('li'), n = stepCounts.get(i) || 0;
      li.classList.toggle('active', i === active);
      li.innerHTML = `<b>${esc(t[0])}</b>${n ? `<span class="cnt">×${n}</span>` : ''}<div class="sdesc">${esc(t[1])}</div>`;
      return li;
    };
    const sections = CaveStepper.techniqueSections || [{ name: 'Core Cave', indices: CaveStepper.techniques.map((_, i) => i) }];
    for (const section of sections) {
      const enabled = !section.option || (section.option === 'twilight' ? $('caveTwilight').checked : $('caveNo22Black').checked || $('caveNo22White').checked);
      if (section.option || section.heading) {
        const bar = document.createElement('li');
        bar.className = 'variant-bar' + (enabled ? ' on' : '');
        bar.innerHTML = esc(section.name) + (section.option && !enabled ? ' <span class="voff">(off)</span>' : '');
        list.append(bar);
      }
      for (const i of section.indices) {
        const li = make(i);
        if (section.option && !enabled) li.classList.add('vdim');
        if (i === 7 && !$('caveNo22Black').checked) li.classList.add('vdim');
        if (i === 8 && !$('caveNo22White').checked) li.classList.add('vdim');
        list.append(li);
      }
    }
  }

  function killSolve() {
    if (solveWorker) { try { solveWorker.terminate(); } catch (_) {} solveWorker = null; }
  }
  function killStep() {
    if (stepWorker) { try { stepWorker.terminate(); } catch (_) {} stepWorker = null; }
    if (stepBusy) {
      stepBusy = false; $('caveStep').disabled = false;
      if (stepSnapshotPending && history.length) history.pop();
    }
    stepSnapshotPending = false; updatePrev();
  }

  function run(candidates) {
    stopAuto(); killStep(); killSolve(); shown = null;
    const config = cfg(candidates ? 5000 : 2);
    status(candidates ? 'Enumerating solutions and proving each cell’s true status…' : 'Solving the Cave and checking uniqueness…');
    const done = result => finishRun(result, candidates);
    if (window.CAVE_WORKER_SOURCE && window.Worker) {
      const url = URL.createObjectURL(new Blob([window.CAVE_WORKER_SOURCE], { type: 'text/javascript' }));
      const worker = new Worker(url); solveWorker = worker;
      worker.onmessage = e => { if (solveWorker === worker) solveWorker = null; worker.terminate(); URL.revokeObjectURL(url); done(e.data); };
      worker.onerror = e => { worker.terminate(); URL.revokeObjectURL(url); solveWorker = null; status('Solver worker failed: ' + e.message); };
      worker.postMessage(config);
    } else setTimeout(() => done(CaveEngine.solve(config, config.time)), 10);
  }

  function finishRun(result, candidates) {
    if (result.error) return status(`<span class="bad">${esc(result.error)}</span>`, true);
    if (!result.solutions.length) return status(result.timed ? '<span class="warn">No solution found within the time limit.</span> Raise the limit and try again.' : '<span class="bad">No solution exists.</span>', true);
    const exact = !result.timed && !result.capped;
    if (candidates && !exact) return status(`<span class="warn">At least ${result.solutions.length.toLocaleString()} solutions were found, but the complete set was not enumerated.</span> Exact true candidates cannot safely be shown; raise the time limit if it expired.`, true);
    if (candidates) {
      const common = CaveEngine.commonCells(result.solutions);
      state = { white: common.white, black: common.black }; shown = null;
      render();
      return status(`<span class="good">True candidates proved.</span> <b>${result.solutions.length.toLocaleString()}</b> solution${result.solutions.length === 1 ? '' : 's'} in total. ${result.solutions.length === 1 ? 'The puzzle is unique, so every cell is fixed.' : 'Unmarked cells differ between valid solutions.'}`, true);
    }
    shown = result.solutions[0]; state = {}; render();
    if (result.solutions.length === 1 && exact) status('<span class="good">Solved — the solution is unique.</span> The complete shading is shown.', true);
    else if (result.solutions.length > 1) status('<span class="good">Solved.</span> <span class="warn">Multiple solutions exist</span> — showing one. Use <b>True candidates</b> to see what every solution shares.', true);
    else status('<span class="good">Solved.</span> <span class="warn">Uniqueness was not proved within the limit.</span>', true);
  }

  function updatePrev() { $('cavePrev').disabled = !history.length || stepBusy; }
  function stopAuto() { auto = false; $('caveAuto').textContent = 'Full solve path'; }
  function statusStep(mv) {
    const box = $('caveStatus'); box.textContent = '';
    if (mv.tech != null) {
      stepNo++;
      const head = document.createElement('b');
      head.textContent = `Step ${stepNo} — ${(CaveStepper.techniques[mv.tech] || ['Deduction'])[0]}: `;
      box.append(head);
    }
    const addText = text => box.append(document.createTextNode(text || ''));
    const addChain = chain => {
      const ol = document.createElement('ol'); ol.className = 'chain';
      for (const move of (chain || []).slice(0, 30)) {
        const li = document.createElement('li'), b = document.createElement('b');
        b.textContent = `${(CaveStepper.techniques[move.tech] || ['Deduction'])[0]}: `;
        li.append(b, document.createTextNode(move.text || '')); ol.append(li);
      }
      if ((chain || []).length > 30) { const li = document.createElement('li'); li.textContent = `… ${(chain || []).length - 30} more consequences`; ol.append(li); }
      box.append(ol);
    };
    if (mv.chain) {
      addText(mv.chainIntro || mv.text); addChain(mv.chain); if (mv.chainOutro) addText(' ' + mv.chainOutro);
    } else if (mv.cases) {
      addText(mv.text);
      for (const cs of mv.cases) { const p = document.createElement('p'); p.textContent = cs.intro; box.append(p); addChain(cs.chain); }
    } else addText(mv.text || 'No deduction found.');
    if (mv.contradiction) { const s = document.createElement('span'); s.className = 'bad'; s.textContent = ' Contradiction — check the clues or marks.'; box.append(s); }
    else if (mv.complete) { const s = document.createElement('span'); s.className = 'good'; s.textContent = ' Solved!'; box.append(s); }
  }

  function takeStep() {
    if (stepBusy) return;
    killSolve(); shown = null;
    history.push({ state: cloneState(state), stepNo, counts: new Map(stepCounts) });
    if (history.length > 500) history.shift();
    stepSnapshotPending = true; stepBusy = true; $('caveStep').disabled = true; updatePrev();
    status('Thinking…');
    const config = cfg(2), source = window.CAVE_STEP_WORKER_SOURCE;
    const local = () => setTimeout(() => afterStep(CaveStepper.step(config, state)), 0);
    if (source && window.Worker) {
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      const worker = new Worker(url); stepWorker = worker;
      worker.onmessage = e => { state = e.data.state; worker.terminate(); URL.revokeObjectURL(url); stepWorker = null; afterStep(e.data.move); };
      worker.onerror = () => { worker.terminate(); URL.revokeObjectURL(url); stepWorker = null; local(); };
      worker.postMessage({ cfg: config, state });
    } else local();
  }

  function afterStep(mv) {
    stepBusy = false; stepSnapshotPending = false; $('caveStep').disabled = false;
    if (mv.tech == null && history.length) history.pop();
    if (mv.tech != null) stepCounts.set(mv.tech, (stepCounts.get(mv.tech) || 0) + 1);
    updatePrev(); buildStrategies(mv.tech == null ? -1 : mv.tech); render(); statusStep(mv);
    if (auto) {
      if (mv.tech != null && !mv.contradiction && !mv.complete) setTimeout(() => { if (auto) takeStep(); }, 180);
      else stopAuto();
    }
  }

  if (!window.CAVE_WORKER_SOURCE && window.fetch) Promise.all(['js/vendor/logic-solver.bundle.js', 'js/cave-engine.js', 'js/cave-stepper.js'].map(u => fetch(u).then(r => r.ok ? r.text() : Promise.reject())))
    .then(([logic, engine, stepper]) => { window.CAVE_WORKER_SOURCE = logic + '\n' + engine + '\n' + stepper + '\nonmessage=function(e){postMessage(CaveEngine.solve(e.data,e.data.time||10));};'; }).catch(() => {});
  if (!window.CAVE_STEP_WORKER_SOURCE && window.fetch) Promise.all(['js/vendor/logic-solver.bundle.js', 'js/cave-engine.js', 'js/cave-stepper.js'].map(u => fetch(u).then(r => r.ok ? r.text() : Promise.reject())))
    .then(([logic, engine, stepper]) => { window.CAVE_STEP_WORKER_SOURCE = logic + '\n' + engine + '\n' + stepper + '\nonmessage=function(e){var s=e.data.state;var m=CaveStepper.step(e.data.cfg,s);postMessage({move:m,state:s});};'; }).catch(() => {});

  $('caveBuild').onclick = () => build(true);
  $('caveClear').onclick = () => { clues = {}; resetMarks('All Cave clues cleared.', true); };
  $('caveReset').onclick = () => resetMarks('Marks reset; clues kept.', true);
  $('caveSolve').onclick = () => run(false);
  $('caveCands').onclick = () => run(true);
  $('caveStep').onclick = takeStep;
  $('cavePrev').onclick = () => {
    if (stepBusy || !history.length) return;
    stopAuto(); const h = history.pop(); state = h.state; stepNo = h.stepNo; stepCounts = h.counts; shown = null;
    updatePrev(); buildStrategies(); render(); status(`Reverted to before step ${stepNo + 1}.`);
  };
  $('caveAuto').onclick = () => { if (auto) return stopAuto(); auto = true; $('caveAuto').textContent = 'Stop'; takeStep(); };
  for (const id of ['caveNo22Black', 'caveNo22White', 'caveTwilight']) $(id).onchange = () => {
    resetMarks(`${id === 'caveTwilight' ? 'Twilight' : 'The 2×2 restriction'} is now ${$(id).checked ? 'on' : 'off'}; steps reset.`, true);
  };

  updatePrev(); buildStrategies(); render();
})();
