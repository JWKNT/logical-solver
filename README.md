# Logical Solvers

Three puzzle solvers with shared machinery: an engine (exact search + solution
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

The **Alien** variant writes every clue in one unknown number base (2–31)
that the solver must determine: a *base* box beside the cipher tracks the
candidates, whittled down like a crypto letter (Base bounds, Base deduction,
Base trial, and base case-analysis, all narrated). Letters stand for digits
0…base−1, so a letter can be worth 10 or more; a clue digit needing two
decimal characters is entered dot-separated (`11.3` = the numeral [11][3]).
The suite's reference puzzles — KNT's *Extraterrestrial Japanese Sums*
(base 11, X=10) and ibag's *Glückwunsch von der ganzen Rasselbande (5)*
(base 13, B=11, F=12) — are solved end to end by the ladder and
engine-verified in `tests/sums-soundness.test.js`.

## A38

Build a directed Hamiltonian loop through all non-clue cells, with number clues
placing permits by chronological neighbour order and stations consuming them.
The tab includes exact solution search/counting, candidate display, one-step
explanations, and an A38-specific human-technique ladder.

`node tests/sums-soundness.test.js` runs scenario regressions plus randomized
engine-vs-ladder batteries (`--scenarios` or `--battery` runs one half; the
full default run takes roughly half an hour).

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
js/a38-engine.js    A38 directed-loop and permit search
js/a38-stepper.js   A38 named human-rule ladder
js/a38-app.js       A38 UI and board editor
js/vendor/logic-solver.bundle.js  Browser SAT runtime (MIT; license alongside)
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
