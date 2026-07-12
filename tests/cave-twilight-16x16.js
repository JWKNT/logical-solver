// Transcription of the 16×16 Twilight position supplied on 2026-07-12.
// The four white cells are exactly the deductions visible in the screenshot.
const C = 16;
const rows = {
  1: { 14: 2, 15: 3 },
  2: { 1: 4, 3: 4, 7: 2, 12: 2 },
  3: { 2: 4, 5: 7, 11: 5, 14: 9 },
  4: { 7: 9, 10: 8 },
  5: { 1: 3 },
  6: { 5: 3, 8: 12, 14: 2 },
  7: { 4: 7, 10: 9, 12: 10 },
  8: { 9: 6, 14: 3 },
  9: { 1: 3, 13: 5, 15: 5 },
  10: { 1: 2, 14: 3 },
  11: { 8: 6, 10: 7, 12: 9, 15: 5 },
  12: { 7: 9 },
  13: { 2: 2, 16: 4 },
  14: { 6: 4, 14: 3 },
  15: { 2: 7, 6: 4, 8: 2 },
  16: { 14: 2 }
};
const clues = {};
for (const [r, cells] of Object.entries(rows)) for (const [c, n] of Object.entries(cells)) clues[(+r - 1) * C + (+c - 1)] = n;

const cells = rows => Object.entries(rows).flatMap(([r, cols]) => cols.map(c => (+r - 1) * C + c - 1));
const laterPosition = {
  white: cells({
    1: [14], 3: [11], 6: [5, 14, 15], 7: [15, 16],
    8: [9, 13, 14, 15], 9: [11, 12, 13], 10: [11, 13, 14, 15],
    11: [8, 11, 15, 16], 12: [11, 13, 14, 15],
    13: [11, 13, 14, 15, 16], 14: [11, 13],
    15: [11, 13, 14, 15, 16], 16: [11, 13, 16]
  }),
  black: cells({
    3: [14], 5: [13, 14], 6: [13, 16], 7: [12, 13, 14],
    8: [12, 16], 9: [10, 14, 15, 16], 10: [12, 16],
    11: [12, 13, 14], 12: [12, 16], 13: [12],
    14: [12, 14, 15, 16], 15: [12], 16: [12, 14, 15]
  })
};
const advancedPosition = {
  white: [...new Set(laterPosition.white.concat(cells({
    1: [9], 2: [9, 11, 12, 14, 15], 3: [9, 10, 15, 16],
    4: [11, 12, 13, 14, 15, 16], 5: [12], 6: [11, 12],
    7: [11], 8: [11]
  })))],
  black: [...new Set(laterPosition.black.concat(cells({
    1: [10, 11, 12, 13, 15, 16], 2: [10, 13, 16],
    3: [8, 12, 13], 5: [10, 11, 15, 16]
  })))]
};
const linkedSightPosition = {
  white: laterPosition.white.filter(x => ![13, 42].includes(x)),
  black: [...new Set(laterPosition.black.filter(x => x !== 45).concat([85, 87]))]
};

module.exports = {
  R: 16,
  C,
  clues,
  twilight: true,
  no2x2Black: false,
  no2x2White: false,
  time: 10,
  laterPosition,
  advancedPosition,
  linkedSightPosition
};
