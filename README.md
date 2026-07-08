# U-Bahn Solver

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

## Layout

```
index.html        page markup
css/style.css     styling
js/engine.js      the search engine (runs in a Web Worker)
js/stepper.js     the human-rule deduction ladder (also a Node module)
js/app.js         UI, model, board rendering
tests/            soundness, symmetry, and engine batteries
build.js          assembles dist/ubahn-solver.html
```

## Tests

```
cd tests
node soundness.test.js   # every human step validated against enumerated solution sets
node symmetry.test.js    # all rules verified invariant under transpose/mirror
node engine.test.js      # engine vs brute-force on small boards
```
