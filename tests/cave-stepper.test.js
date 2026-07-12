const assert = require('assert');
const E = require('../js/cave-engine.js'); // installs CaveEngine for exact trial
const S = require('../js/cave-stepper.js');

{
  const st = {}, mv = S.basicStep({ R: 3, C: 3, clues: { 4: 5 } }, st);
  assert.strictEqual(mv.tech, 0); assert(st.white.has(4));
}
{
  const st = { white: new Set([12]), black: new Set() };
  const mv = S.basicStep({ R: 5, C: 5, clues: { 12: 9 } }, st);
  assert.strictEqual(mv.tech, 1); assert.strictEqual(st.white.size, 2, 'sight-line bounds place one cell per step');
}
{
  const st = { white: new Set([3, 5]), black: new Set([1, 7]) };
  const mv = S.basicStep({ R: 3, C: 3, clues: {} }, st);
  assert.strictEqual(mv.tech, 2); assert(st.white.has(4), 'the sole cave bridge is unshaded');
}
{
  const st = { white: new Set([2, 5, 6, 7, 10, 12, 14, 15, 21]), black: new Set([8, 11, 22]) };
  const mv = S.basicStep({ R: 5, C: 5, clues: {} }, st);
  assert.strictEqual(mv.tech, 3); assert(st.black.has(16), 'the sole outside escape is shaded');
}
{
  const st = { white: new Set([0, 4]), black: new Set([1]) };
  const mv = S.basicStep({ R: 3, C: 3, clues: {} }, st);
  assert.strictEqual(mv.tech, 4); assert(st.white.has(3), 'a fourth cell prevents a checkerboard crossing');
}
{
  const st = { white: new Set([0, 1, 2]), black: new Set() };
  const mv = S.basicStep({ R: 2, C: 2, clues: {} }, st);
  assert.strictEqual(mv.tech, 5); assert(st.black.has(3));
}
{
  const st = { white: new Set(), black: new Set([0, 1, 2]) };
  const mv = S.basicStep({ R: 2, C: 2, clues: {}, no2x2Black: true }, st);
  assert.strictEqual(mv.tech, 7); assert(st.white.has(3), 'three shaded cells force the fourth unshaded');
}
{
  const st = { white: new Set([0, 1, 2]), black: new Set() };
  const mv = S.basicStep({ R: 2, C: 2, clues: {}, no2x2White: true }, st);
  assert.strictEqual(mv.tech, 8); assert(st.black.has(3), 'three unshaded cells force the fourth shaded');
}
{
  const st = { white: new Set(), black: new Set() };
  const mv = S.basicStep({ R: 3, C: 3, clues: { 0: 1 }, twilight: true }, st);
  assert.strictEqual(mv.tech, 9); assert(st.black.has(0), 'a size-1 Twilight clue cannot use the normal sight interpretation');
}
{
  const st = { white: new Set(), black: new Set([0]) };
  const mv = S.basicStep({ R: 3, C: 3, clues: { 0: 2, 4: 3 }, twilight: true }, st);
  assert.strictEqual(mv.tech, 16); assert(st.white.has(4), 'a diagonally touching unequal clue cannot share the shaded state');
}
{
  const st = { white: new Set(), black: new Set([0, 1]) };
  const mv = S.basicStep({ R: 3, C: 3, clues: { 0: 2, 1: 3 }, twilight: true }, st);
  assert.strictEqual(mv.tech, 16); assert(mv.contradiction, 'orthogonally touching unequal shaded clues contradict');
}
{
  const st = { white: new Set([1, 3, 5, 7]), black: new Set() };
  const mv = S.basicStep({ R: 3, C: 3, clues: { 4: 5 }, twilight: true }, st);
  assert.strictEqual(mv.tech, 9); assert(st.white.has(4), 'white barriers make the shaded size-5 interpretation impossible');
}
{
  const st = { white: new Set(), black: new Set([0, 1]) };
  const mv = S.basicStep({ R: 3, C: 3, clues: { 0: 2 }, twilight: true }, st);
  assert.strictEqual(mv.tech, 10); assert(st.white.size === 1, 'a completed Twilight shaded component closes its boundary');
}
{
  const cfg = { R: 5, C: 5, clues: { 4: 3, 5: 2, 6: 6 }, time: 5 };
  const st = {}; let mv;
  for (let k = 0; k < 100; k++) { mv = S.step(cfg, st, { noTrial: true }); if (mv.done || mv.contradiction) break; }
  assert(mv.done && !mv.complete, 'basic ladder should deliberately stop before the trial fixture is complete');
  mv = S.step(cfg, st);
  assert.strictEqual(mv.tech, 6); assert(!mv.contradiction, 'exact local contradiction should force the next cell');
}

// End-to-end regression and per-step soundness: every mark made by the human
// ladder agrees with the independently enumerated unique solution.
{
  const cfg = { R: 6, C: 6, clues: { 1: 3, 13: 2, 16: 3, 21: 11, 26: 3, 30: 3, 34: 2 }, time: 10 };
  const exact = E.solve({ ...cfg, maxSolutions: 2 }, 10);
  assert.strictEqual(exact.solutions.length, 1);
  const sol = exact.solutions[0], st = {}; let mv, steps = 0;
  for (; steps < 100; steps++) {
    mv = S.step(cfg, st);
    for (const i of st.white || []) assert.strictEqual(sol[i], 1, `step ${steps + 1} incorrectly unshaded ${i}`);
    for (const i of st.black || []) assert.strictEqual(sol[i], 0, `step ${steps + 1} incorrectly shaded ${i}`);
    if (mv.done || mv.contradiction) break;
  }
  assert(mv && mv.complete && !mv.contradiction, 'bundled Cave should solve by the deduction ladder');
  assert.strictEqual(st.white.size + st.black.size, 36);
}

// Unique Twilight regression: clue 2 is the ordinary sight clue; every clue 7
// is shaded and counts the same seven-cell outside component.
{
  const cfg = { R: 3, C: 3, clues: { 0: 2, 3: 7, 4: 7, 6: 7, 7: 7, 8: 7 }, twilight: true, time: 5 };
  const exact = E.solve({ ...cfg, maxSolutions: 2 }, 5);
  assert.strictEqual(exact.solutions.length, 1, 'Twilight fixture should be unique');
  const sol = exact.solutions[0], st = {}; let mv;
  for (let k = 0; k < 40; k++) {
    mv = S.step(cfg, st);
    for (const i of st.white || []) assert.strictEqual(sol[i], 1, 'Twilight ladder made an unsound white mark');
    for (const i of st.black || []) assert.strictEqual(sol[i], 0, 'Twilight ladder made an unsound black mark');
    if (mv.done || mv.contradiction) break;
  }
  assert(mv && mv.complete && !mv.contradiction, 'Twilight fixture should solve through its dedicated deductions');
}

console.log('Cave stepper deduction and soundness tests passed');

// Screenshot regression: this 10×10 Twilight puzzle used to stall before its
// first mark. The size-5 clue at r6c5 cannot reach an edge in five shaded
// cells because every shortest route ends at an incompatible clue. The full
// puzzle must then solve without the exhaustive-model fallback.
{
  const cfg = require('./cave-twilight-screenshot.js'), st = {};
  let mv = S.step(cfg, st, { noExact: true }), usedExact = false, usedEdge = false, usedChain = false, usedFork = false, usedCapacity = false, maxChain = 0;
  assert.strictEqual(mv.tech, 9); assert(st.white.has(54), 'r6c5 must be unshaded by size-bounded edge reach');
  mv = S.step(cfg, st, { noExact: true }); usedCapacity = mv.tech === 20;
  assert.strictEqual(mv.tech, 20); assert(/clue 9 at r7c3/.test(mv.text) && /at most 8 cells/.test(mv.text), 'linked sight capacity should replace the older cluster detour');
  for (let k = 2; k < 180 && !mv.done && !mv.contradiction; k++) {
    mv = S.step(cfg, st, { noExact: true });
    usedExact ||= mv.tech === 14; usedEdge ||= mv.tech === 11; usedChain ||= mv.tech === 6; usedFork ||= mv.tech === 13; usedCapacity ||= mv.tech === 20;
    maxChain = Math.max(maxChain, mv.chain ? mv.chain.length : 0, ...(mv.cases || []).map(cs => cs.chain.length));
  }
  assert(mv && mv.complete && !mv.contradiction, 'the screenshot Twilight puzzle should solve by the human ladder');
  assert(!usedExact && !usedFork && usedEdge && usedCapacity, 'solve must use linked sight capacity and edge reach, never deep bifurcation/exhaustive fallback');
  assert(maxChain <= 10, 'visible shading trials must remain short enough to be human-followable');
  assert.strictEqual(st.white.size + st.black.size, 100);
}

console.log('Cave screenshot Twilight regression passed');

// At this 16×16 screenshot position, four central clues are known white. A
// human distributes the single visible neighbour of r6c14=2 among its arms.
// The downward choice creates a size-3 edge component, whose closed boundary
// makes r9c13=5 see six cells. Therefore r7c14 is the shaded stopper.
{
  const cfg = require('./cave-twilight-16x16.js'), st = {};
  let mv;
  for (let k = 0; k < 4; k++) mv = S.step(cfg, st, { noTrial: true });
  assert.deepStrictEqual([...st.white].sort((a, b) => a - b), [84, 93, 120, 167], 'fixture must reproduce the four green screenshot clues');
  assert.strictEqual(st.black.size, 0);
  mv = S.step(cfg, st, { noTrial: true });
  assert.strictEqual(mv.tech, 20); assert(st.black.has(45), 'linked sight capacity should shade r3c14 before harder local cases');
  mv = S.step(cfg, st, { noTrial: true });
  assert.strictEqual(mv.tech, 17, 'the next move should use the general sight-line distribution rule');
  assert(st.black.has(109), 'r7c14 must be the shaded stopper');
  assert(/up 0, down 1, left 0, right 0/.test(mv.chainIntro), 'the rejected arm distribution must be stated concretely');
  assert(mv.chain && mv.chain.length <= 5, 'the proof must be grouped into a short human argument');
  assert(/already see 6 cells/.test(mv.chain[mv.chain.length - 1].text), 'the final clue overrun must be explicit');
}

console.log('Cave 16×16 sight-line distribution regression passed');

// Later in the same puzzle, shading r8c11 would create an alternating corner
// unless r8c10 were also shaded. Those two cells join the size-10 wall at
// r7c12 and leave it without an edge route, so the first assumption is false.
{
  const fixture = require('./cave-twilight-16x16.js');
  const cfg = { ...fixture };
  delete cfg.laterPosition;
  const st = {
    white: new Set(fixture.laterPosition.white),
    black: new Set(fixture.laterPosition.black)
  };
  let mv = S.basicStep(cfg, st);
  assert.strictEqual(mv.tech, 18, 'the local topology-to-edge implication should precede a roundabout sight trial');
  assert(st.white.has(122), 'r8c11 must be unshaded');
  assert(/force r8c10 shaded/.test(mv.chainIntro), 'the corner-topology consequence must be named');
  assert.strictEqual(mv.chain.length, 2, 'the explanation should contain only the topology implication and failed edge route');
  assert(/size-10 shaded wall at r7c12/.test(mv.chain[1].text) && /cannot reach the edge within its size 10/.test(mv.chain[1].text));
  mv = S.basicStep(cfg, st);
  assert.strictEqual(mv.tech, 19, 'different numbered walls separated by one cell should be handled directly');
  assert(st.white.has(61), 'r4c14 must remain between the size-9 and size-10 walls');
  assert(/size-9 wall containing r3c14/.test(mv.text) && /size-10 wall containing r7c12/.test(mv.text), 'both incompatible walls must be named');
}

console.log('Cave topology-assisted edge reach regression passed');

// In the more advanced screenshot, the 12 cannot fit twelve visible cells in
// any locally viable four-arm shape. The adjacent 8 then gives the same shaded
// stopper to its left whether read as a white sight clue or a black size clue.
{
  const fixture = require('./cave-twilight-16x16.js');
  const cfg = { ...fixture };
  delete cfg.laterPosition;
  delete cfg.advancedPosition;
  const st = {
    white: new Set(fixture.advancedPosition.white),
    black: new Set(fixture.advancedPosition.black)
  };
  let mv = S.basicStep(cfg, st);
  assert.strictEqual(mv.tech, 20, 'the 12 should be rejected by its human sight capacity');
  assert(st.black.has(87), 'r6c8 must be shaded');
  assert(/at most 11 cells/.test(mv.text) && /needs 12/.test(mv.text), 'the capacity explanation must use the human-visible counts');
  mv = S.basicStep(cfg, st);
  assert.strictEqual(mv.tech, 21, 'the 8 should use a dedicated Twilight colour agreement');
  assert(st.black.has(56), 'r4c9 is shaded under both readings of r4c10');
  assert.strictEqual(mv.cases.length, 2);
  assert(/already satisfied/.test(mv.cases[0].chain[0].text), 'the white reading should identify the shaded sight stopper');
  assert(/only one route short enough/.test(mv.cases[1].chain[0].text), 'the black reading should identify the common edge-route cell');
  mv = S.basicStep(cfg, st);
  assert.strictEqual(mv.tech, 4); assert(st.black.has(55), 'the neighboring checkerboard deduction should shade r4c8');
  mv = S.basicStep(cfg, st);
  assert.strictEqual(mv.tech, 22, 'a diagonally contacted oversized wall should reject the shaded clue reading');
  assert(st.white.has(22), 'r2c7 must be unshaded');
  assert(/wall at r3c8 diagonally/.test(mv.text) && /either r3c7 or r2c8/.test(mv.text), 'the forced diagonal bridge must be explained');
  assert(/at least 5, exceeding size 2/.test(mv.text), 'the minimum joined wall size must be counted explicitly');
}

console.log('Cave Twilight capacity and colour-agreement regression passed');

// Linked sight-capacity regression: if r3c14=9 extends upward or left into the
// 2 or 5, that encountered clue becomes white too and limits the same line.
// Across all four-arm arrangements the 9 can then see at most seven cells.
{
  const fixture = require('./cave-twilight-16x16.js');
  const cfg = { ...fixture };
  delete cfg.laterPosition;
  delete cfg.advancedPosition;
  delete cfg.linkedSightPosition;
  const st = {
    white: new Set(fixture.linkedSightPosition.white),
    black: new Set(fixture.linkedSightPosition.black)
  };
  const mv = S.basicStep(cfg, st);
  assert.strictEqual(mv.tech, 20, 'the 9 should use linked Twilight sight capacity');
  assert(st.black.has(45), 'r3c14 cannot be an unshaded 9 and must be shaded');
  assert(/at most 7 cells/.test(mv.text) && /needs 9/.test(mv.text));
  assert(/2 at r1c14/.test(mv.text) && /5 at r3c11/.test(mv.text), 'the encountered clues must be named');
  assert(/makes that encountered clue unshaded too/.test(mv.text), 'the shared-line restriction must be explained');
}

console.log('Cave linked Twilight sight-capacity regression passed');

// Regular 9×9 screenshot regression. Small, explicit arm distributions unlock
// the clue overlaps; ordinary bounds, escape, and checkerboard deductions then
// finish the puzzle without any shading trial.
{
  const cfg = require('./cave-regular-9x9.js');
  const exact = E.solve({ ...cfg, maxSolutions: 2 }, 10);
  assert.strictEqual(exact.solutions.length, 1, 'regular 9×9 fixture should be unique');
  const sol = exact.solutions[0], st = {};
  let mv, usedDistribution = false, usedTrial = false, maxCases = 0;
  for (let k = 0; k < 120; k++) {
    mv = S.step(cfg, st, { noTrial: true });
    usedDistribution ||= mv.tech === 17;
    usedTrial ||= mv.tech === 6;
    maxCases = Math.max(maxCases, (mv.cases || []).length);
    for (const i of st.white || []) assert.strictEqual(sol[i], 1, `regular 9×9 incorrectly unshaded ${i}`);
    for (const i of st.black || []) assert.strictEqual(sol[i], 0, `regular 9×9 incorrectly shaded ${i}`);
    if (mv.done || mv.contradiction) break;
  }
  assert(mv && mv.complete && !mv.contradiction, 'regular 9×9 should solve through the human ladder');
  assert(usedDistribution && !usedTrial, 'regular solve should use sight distributions and no cell trial');
  assert(maxCases <= 4, 'every narrated sight comparison should remain human-sized');
  assert.strictEqual(st.white.size + st.black.size, 81);
}

console.log('Cave regular 9×9 human-solve regression passed');
