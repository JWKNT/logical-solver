# Logical Solvers

Two puzzle solvers with shared machinery: an engine (exact search + solution
counting + true candidates) and a human-rule stepper (a ladder of named
deductions, simplest first, each with a prose explanation).

## U-Bahn

A solver, stepper, and setter for U-Bahn puzzles (the [wooferzfg](https://wooferzfg.me/) genre):
draw one connected loop-free-nowhere network — no dead ends — where outside clues count the
shape each visited cell takes in that row or column (cross, branch, straight, turn, and
optionally the number of empty cells).

* **Solve** — engine search with exact solution counting.
* **True candidates** — every border's status across all solutions.
* **Take step** — a ladder of ~36 named human deduction rules, simplest first,
  each with a full prose explanation (trial steps show their complete
  contradiction chains).

## Running

The split sources need a static server because the page loads three scripts:

```
python3 -m http.server     # then open http://localhost:8000/
```

Or build the fully self-contained single file, which opens directly from disk:

```
node build.js              # writes dist/ubahn-solver.html
```

## Japanese Sums

Place digits 1..D in some cells; a digit appears at most once per row and per
column; clues list, in order, the sums of the consecutive digit groups in each
line (`?` = unknown sum, blank = unclued line). Same feature set: Solve, True
candidates, and a Take-step ladder (digit uniqueness, full lines, group
placements, killer-style group combinations, exact line analysis, and
hypothesis steps with narrated chains: cell trials, shading trials — is this
cell a digit or shaded? — and case analysis, which follows a binary split a
few steps in both cases and keeps whatever every case agrees on). Switch apps
with the tabs in the header.

## Layout

```
index.html        page markup
css/style.css     styling
js/engine.js        U-Bahn search engine (runs in a Web Worker)
js/stepper.js       U-Bahn human-rule ladder (also a Node module)
js/app.js           U-Bahn UI, model, board rendering
js/sums-engine.js   Japanese Sums engine (worker + Node module)
js/sums-stepper.js  Japanese Sums human-rule ladder
js/sums-app.js      Japanese Sums UI
tests/            soundness, symmetry, and engine batteries
build.js          assembles dist/ubahn-solver.html
```

## Tests

```
cd tests
node soundness.test.js        # U-Bahn: every human step validated against enumerated solution sets
node symmetry.test.js         # U-Bahn: all rules invariant under transpose/mirror
node engine.test.js           # U-Bahn: engine vs brute-force on small boards
node sums-engine.test.js      # Sums: engine vs brute-force solution counts
node sums-soundness.test.js   # Sums: every step validated against enumerated solution sets
```
