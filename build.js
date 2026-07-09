#!/usr/bin/env node
// Assemble the single-file distribution (dist/ubahn-solver.html) from the
// split sources. The single file is fully self-contained: open it directly
// in a browser, no server needed.
const fs = require('fs');
const read = f => fs.readFileSync(f, 'utf8');

let html = read('index.html');
const css = read('css/style.css');
const engine = read('js/engine.js');
let stepper = read('js/stepper.js');
const app = read('js/app.js');

// strip the node module guard from the stepper for inlining
const guard = stepper.indexOf("if (typeof module !== 'undefined')");
if (guard >= 0) stepper = stepper.slice(0, guard).trimEnd() + '\n';

html = html.replace('<link rel="stylesheet" href="css/style.css">', '<style>\n' + css + '</style>');
const sumsEngine = read('js/sums-engine.js');
let sumsStepper = read('js/sums-stepper.js');
const sumsApp = read('js/sums-app.js');
html = html.replace(
  '<script src="js/engine.js"></script>\n<script src="js/stepper.js"></script>\n<script src="js/app.js"></script>\n<script src="js/sums-engine.js"></script>\n<script src="js/sums-stepper.js"></script>\n<script src="js/sums-app.js"></script>',
  '<script>\n' + engine + '\n/* ================= stepper (human-rule deductions) ================= */\n' + stepper + '\n' + app + '\n/* ================= japanese sums ================= */\n' + sumsEngine + '\n' + sumsStepper + '\n' + sumsApp + '</script>'
);
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/ubahn-solver.html', html);
console.log('built dist/ubahn-solver.html (' + html.length + ' bytes)');
