// Logic Masters 0002GL: tuace's "A 38 II" (2016), 12x12 — transcribed from
// the user's screenshot and engine-verified unique. The 2016 rules make clue
// rings ignore an adjacent start cell (ignoreStart), though no clue here
// neighbours the start; counting runs from the start around the loop.
const R = 12, C = 12, kind = Array(R * C).fill('cell'), clues = {};
const at = (r, c) => (r - 1) * C + c - 1;
for (const [r, c] of [[1,2],[2,7],[3,2],[3,11],[5,7],[5,11],[7,5],[9,7],[10,4],[11,3],[12,2],[12,8]]) kind[at(r, c)] = 'station';
kind[at(7, 6)] = 'start';
clues[at(3, 10)] = [7];
clues[at(5, 5)] = [1, 4, 5, 8];
clues[at(6, 8)] = [3, 4, 5];
clues[at(8, 3)] = [1, 2];
clues[at(8, 10)] = [5];
clues[at(11, 6)] = [7, 8];
for (const q of Object.keys(clues)) kind[q] = 'clue';
module.exports = { R, C, kind, clues, ignoreStart: true };
