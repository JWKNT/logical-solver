// Reference alien puzzles transcribed from the LMD screenshots.
// KNT 000CZ6 "Extraterrestrial Japanese Sums": 10x10, digits 1-9, unknown base,
// letters = digits 0..N-1, all distinct, no leading zeros.
// ibag 0001OX "Glueckwunsch von der ganzen Rasselbande (5)": 11x11, digits 1-9,
// clues in an unknown number system, equal letters equal digits.
module.exports = {
  knt: {
    R: 10, C: 10, D: 9,
    rows: [['E','X','T','R','A'], ['L','RT','E','I'], ['TX','TI'], null, ['TE','RR','E'],
           ['S','TR','I','A','L'], ['R','TT','TS'], ['X','A'], ['TS','I','I','TT'], ['I','S','I']],
    cols: [['X','TT','L'], ['TA','TE'], ['S','RS','L'], ['TR','X'], null,
           ['ST'], ['TE','X'], ['I','TL'], ['I','RL'], ['TL','TA','E']]
  },
  ibag: {
    R: 11, C: 11, D: 9,
    rows: [['GG','HJ'], ['D','GH'], ['B','D','HH'], ['HI','F'], ['F','F'], ['HB','B'],
           ['HH','D','HD'], ['D','B'], ['AC'], ['HI','B','B'], ['D','D','D','D']],
    cols: [['J','I','A','H','D','C'], ['HJ','HC','D'], ['A','A','B','B'], ['HE','HA','HA'], ['D','D','I'],
           ['AH'], ['B','C','F'], ['C','C','C','HB'], ['HG','HH','A','C','H'], ['HG','HJ','J'], ['F','I','HA']]
  }
};
