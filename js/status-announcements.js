// Keep short solver updates live, without reading grids or full proof chains.
// The existing visible status remains available for reading at any length.
(() => {
  'use strict';
  if (!window.MutationObserver) return;

  const compact = (text, limit) => text.length <= limit ? text
    : text.slice(0, limit - 1).replace(/\s+\S*$/, '') + '…';

  function summary(source) {
    const text = source.textContent.replace(/\s+/g, ' ').trim();
    const step = text.match(/^(Step \d+\s*[—-]\s*[^:]+):/);
    if (step) {
      // A step may include dozens of consequences. Announce its named rule and
      // any final verdict, leaving the detailed explanation in the normal flow.
      const verdict = Array.from(source.children)
        .filter(child => child.matches('.good, .bad') && !child.textContent.trim().startsWith('Step '))
        .map(child => child.textContent.trim()).join(' ');
      return compact(step[1], 140) + '. ' + (verdict ? compact(verdict, 140) + ' ' : '') + 'Explanation below.';
    }
    if (text.length <= 320) return text;
    // Long cipher results can end with a search-limit warning. Do not let the
    // shortened summary turn a qualified result into an unqualified success.
    const warnings = [...new Set(Array.from(source.children)
      .filter(child => child.matches('.warn, .bad'))
      .map(child => child.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean))];
    const warning = compact(warnings.join(' '), 160);
    const body = warnings.reduce((rest, warning) => rest.replace(warning, ''), text).replace(/\s+/g, ' ').trim();
    const suffix = ' Full status below.';
    return [warning, compact(body, 320 - warning.length - suffix.length - 1)].filter(Boolean).join(' ') + suffix;
  }

  document.querySelectorAll('[data-status-source]').forEach(live => {
    const source = document.getElementById(live.dataset.statusSource);
    if (!source) return;
    let timer;
    new MutationObserver(() => {
      clearTimeout(timer);
      // Coalesce rapid full-path steps and worker progress, including a status
      // built through several DOM writes. Never announce an inactive puzzle.
      timer = setTimeout(() => {
        if (source.closest('[hidden]')) { live.textContent = ''; return; }
        const text = summary(source);
        if (live.textContent !== text) live.textContent = text;
      }, 500);
    }).observe(source, { childList: true, characterData: true, subtree: true });
  });
})();
