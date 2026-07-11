// tuace A38 (2018, from the user's screenshot; author's starting hints in
// the accompanying comment use Z<row>S<col> coordinates that cross-check this
// transcription: gray Z6S3, clue Z6S4=[6], central clue Z6S6=[1,8], start Z8S6).
// 11x11. No clue ring touches the start, so the 2016 ignore-start rule is moot.
const R = 11, C = 11, kind = Array(R * C).fill('cell'), clues = {};
const at = (r, c) => (r - 1) * C + c - 1;
for (const [r, c] of [[1,10],[2,3],[2,6],[4,6],[4,10],[6,3],[6,10],[7,8],[10,3],[10,6],[11,7]]) kind[at(r, c)] = 'station';
kind[at(8, 6)] = 'start';
clues[at(2, 5)] = [1, 8];
clues[at(3, 8)] = [1, 8];
clues[at(4, 2)] = [6];
clues[at(6, 4)] = [6];
clues[at(6, 6)] = [1, 8];
clues[at(6, 8)] = [6];
clues[at(8, 9)] = [6];
clues[at(9, 4)] = [1, 8];
clues[at(9, 9)] = [6];
for (const q of Object.keys(clues)) kind[q] = 'clue';
module.exports = { R, C, kind, clues };
