// user's symmetric A38 (true source image, July 2026), 14 rows x 13 cols.
// Machine-measured grid + crop-verified clue glyphs.
const R = 14, C = 13, kind = Array(R * C).fill('cell'), clues = {};
const at = (r, c) => (r - 1) * C + c - 1;
for (const [r, c] of [
  [2,3],[2,7],[2,11],
  [3,4],[3,10],
  [5,4],[5,10],
  [7,2],[7,12],
  [10,6],[10,7],[10,8],
  [11,6],[11,8],
  [13,3],[13,11],
]) kind[at(r, c)] = 'station';
kind[at(8, 7)] = 'start';
clues[at(4, 2)] = [1, 2];
clues[at(4, 7)] = [7];
clues[at(4, 12)] = [3];
clues[at(5, 7)] = [2, 7];
clues[at(6, 5)] = [5, 6, 7];
clues[at(6, 9)] = [3];
clues[at(8, 4)] = [3, 6];
clues[at(8, 10)] = [2, 3, 6];
clues[at(12, 5)] = [4, 7];
clues[at(12, 9)] = [5, 6];
for (const q of Object.keys(clues)) kind[q] = 'clue';
module.exports = { R, C, kind, clues };
