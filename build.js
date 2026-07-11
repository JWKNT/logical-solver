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
const a38Engine = read('js/a38-engine.js'), a38Stepper = read('js/a38-stepper.js'), a38App = read('js/a38-app.js');
const logicSolver = read('js/vendor/logic-solver.bundle.js');
const a38Worker = logicSolver + '\n' + a38Engine + '\nonmessage=function(e){postMessage(A38Engine.solve(e.data,e.data.time||10));};';
const a38StepWorker = a38Stepper + '\nonmessage=function(e){var st=e.data.state;var x=A38Stepper.step(e.data.cfg,st);postMessage({x:x,state:st});};';
html = html.replace(
  '<script src="js/engine.js"></script>\n<script src="js/stepper.js"></script>\n<script src="js/app.js"></script>\n<script src="js/sums-engine.js"></script>\n<script src="js/sums-stepper.js"></script>\n<script src="js/sums-app.js"></script>\n<script src="js/vendor/logic-solver.bundle.js"></script>\n<script src="js/a38-engine.js"></script>\n<script src="js/a38-stepper.js"></script>\n<script src="js/a38-app.js"></script>',
  () => '<script>\n' + engine + '\n/* ================= stepper (human-rule deductions) ================= */\n' + stepper + '\n' + app + '\n/* ================= japanese sums ================= */\n' + sumsEngine + '\n' + sumsStepper + '\n' + sumsApp + '\n/* ================= A38 SAT ================= */\n' + logicSolver + '\n' + a38Engine + '\nwindow.A38_WORKER_SOURCE=' + JSON.stringify(a38Worker) + ';\nwindow.A38_STEP_WORKER_SOURCE=' + JSON.stringify(a38StepWorker) + ';\n' + a38Stepper + '\n' + a38App + '</script>'
);
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/ubahn-solver.html', html);
console.log('built dist/ubahn-solver.html (' + html.length + ' bytes)');
