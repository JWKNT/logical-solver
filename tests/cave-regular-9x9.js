// Regular 9×9 Cave supplied in the 2026-07-12 screenshot.
const C = 9;
const rows = {
  1: { 7: 5 },
  2: { 2: 5, 6: 5, 8: 6 },
  3: { 1: 5, 5: 4, 9: 6 },
  4: { 2: 5 },
  5: { 3: 6, 7: 5 },
  6: { 8: 6 },
  7: { 1: 7, 5: 6, 9: 6 },
  8: { 2: 6, 4: 5, 8: 7 },
  9: { 3: 6, 7: 5 }
};
const clues = {};
for (const [r, cells] of Object.entries(rows)) for (const [c, n] of Object.entries(cells)) clues[(+r - 1) * C + (+c - 1)] = n;

module.exports = { R: 9, C, clues, twilight: false, no2x2Black: false, no2x2White: false, time: 10 };
