'use strict';

const sortedUnique = values => [...new Set(values)].sort((a, b) => a - b);

// Record retained deduction facts, not caches, prose, or collection ordering.
// Some useful steps only add a shape implication or narrow a line's layouts;
// cell/letter masks alone therefore cannot detect whether a step made progress.
function sumsProgressSnapshot(st) {
  return JSON.stringify({
    cand: Array.from(st.cand),
    letterCand: Array.from(st.letterCand),
    baseCand: st.baseCand ? sortedUnique(st.baseCand) : null,
    shapeRelations: [...new Set((st.shapeRelations || []).map(x =>
      JSON.stringify([x.a, x.av, x.b, x.bv])))].sort(),
    lineShapeDomains: Object.entries(st.lineShapeDomains || {})
      // The stepper treats a missing or empty saved domain as unrestricted.
      .filter(([, values]) => values && values.length)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, values]) => [key, sortedUnique(values)])
  });
}

module.exports = { sumsProgressSnapshot };
