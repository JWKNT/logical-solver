'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'sums-app.js'), 'utf8');
const a38Src = fs.readFileSync(path.join(__dirname, '..', 'js', 'a38-app.js'), 'utf8');
const ubahnSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

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

assert.match(src, /const tableWidth = rowClueWidth \+ C \* 52/,
  'Japanese Sums gives its table an explicit width derived from square 52px cells');
assert.match(src, /<colgroup><col style="width:/,
  'Japanese Sums pins every table column instead of allowing the shared table rule to stretch cells');
assert.doesNotMatch(html, /<details[^>]*class="[^"]*strategies/,
  'deduction types are always visible rather than hidden in disclosure widgets');
assert.match(src, /td\.setAttribute\('aria-label', label\);\s*td\.title = label;/,
  'compact Japanese Sums marks expose their full candidate list');
assert.match(src, /role="img" aria-label="' \+ (?:baseLabel|letterLabel)/,
  'compact cipher boxes expose their complete values');
assert.match(a38Src, /Possible visit positions[\s\S]*m\.setAttribute\('aria-label',description\)/,
  'compact A38 ordinal marks expose their full candidate positions');
assert.match(ubahnSrc, /cancelBtn'\)\.style\.display = on \? 'inline-flex' : 'none'/,
  'the U-Bahn cancel control becomes visible while a worker is running');

console.log('ok: first-click Full solve path survives internal initialization; compact marks and cancellation remain available');
