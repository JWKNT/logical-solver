// Logic Masters 0002GK: tuace's original "A 38" (2016), 10x10 — identified
// from the user's screenshot; also the UI-progress regression puzzle. The
// 2016 rules ignore a start cell adjacent to a clue ring, but no clue here
// neighbours the start, so the flag is moot for this grid.
const R=10,C=10,kind=Array(R*C).fill('cell'),clues={};
const at=(r,c)=>(r-1)*C+c-1;
for(const [r,c] of [[1,8],[2,4],[2,10],[5,2],[7,9],[8,1],[10,7]])kind[at(r,c)]='station';
kind[at(6,1)]='start';
for(const [r,c,ns] of [[4,2,[1,4,5]],[4,8,[3,7]],[8,3,[8]],[9,6,[5]]]){kind[at(r,c)]='clue';clues[at(r,c)]=ns}
const solution=[50,60,61,62,52,53,43,42,32,33,34,44,45,46,47,57,58,68,67,77,76,75,65,66,56,55,54,64,63,73,74,84,83,82,81,71,70,80,90,91,92,93,94,95,96,86,87,97,98,99,89,88,78,79,69,59,49,48,38,39,29,19,9,8,18,28,27,26,36,35,25,15,16,17,7,6,5,4,14,24,23,22,21,11,12,13,3,2,1,0,10,20,30,40,41,51];
module.exports={R,C,kind,clues,at,solution};
