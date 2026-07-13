const assert = require('assert');
const fs = require('fs');

const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
const app = fs.readFileSync(require.resolve('../js/cave-app.js'), 'utf8');

for (const file of ['engine', 'stepper', 'app']) {
  assert(html.includes(`js/cave-${file}.js?v=20260712-2`), `${file} must be cache-busted for split-source deployment`);
}
assert(app.includes('updatePrev(); render(); buildStrategies();'), 'initial Cave board rendering must precede the strategy panel');
assert(app.includes('if (!window.CaveStepper || !Array.isArray(window.CaveStepper.techniques))'), 'strategy rendering must tolerate a stale or delayed stepper');
assert(app.includes("'js/cave-engine.js?v=20260712-2'"), 'worker fetches must use the same Cave release');
assert(app.includes("'js/cave-stepper.js?v=20260712-2'"), 'step worker fetches must use the same Cave release');

console.log('Cave split-source deployment smoke test passed');
