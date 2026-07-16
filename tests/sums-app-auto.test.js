'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'sums-app.js'), 'utf8');

assert.match(src, /function markStepStale\(keepAuto\).*if \(!keepAuto\) stopSumsAuto\(\)/s,
  'stale worker snapshots stop auto mode unless explicitly preserved');

const firstStep = src.match(/if \(stepNo === 0 && !stFromEngine\) \{[\s\S]*?\n  \}/);
assert(firstStep, 'first-step initialization block exists');
assert.match(firstStep[0], /markStepStale\(sumsAuto\)/,
  'the first Take-step preserves an already-running Full solve path');

for (const externalReset of [
  /stFromEngine = true;\s*markStepStale\(\)/,
  /sumsReset[^\n]*markStepStale\(\)/,
  /function variantChanged[\s\S]*?markStepStale\(\)/
]) assert.match(src, externalReset, 'external state changes still stop Full solve path');

console.log('ok: first-click Full solve path survives internal initialization; external resets still stop it');
