(function(){
const $=id=>document.getElementById(id);let R=6,C=6,kind=[],clues={},shown=null,state={},tool='cell',stepCounts=new Map(),stepNo=0,runMax=2;
function build(clear=true){R=+$('a38Rows').value;C=+$('a38Cols').value;if(clear){a38Hist=[];if(typeof stopA38Auto==='function')stopA38Auto();if($('a38Prev'))$('a38Prev').disabled=true;kind=Array(R*C).fill('cell');clues={};shown=null;state={};stepCounts=new Map();stepNo=0;buildStrategyPanel()}render()}
function setTool(t){tool=t;document.querySelectorAll('.a38-tools button').forEach(b=>b.classList.toggle('active',b.dataset.tool===t))}
function paint(i){let next=kind[i]===tool?'cell':tool;if(kind[i]==='clue')delete clues[i];if(next==='start')for(let j=0;j<kind.length;j++)if(kind[j]==='start')kind[j]='cell';kind[i]=next;if(next==='clue')clues[i]=[];reset();render();if(next==='clue'){const inp=$('a38Grid').children[i]&&$('a38Grid').children[i].querySelector('.a38-clue-entry');if(inp)inp.focus()}}
function render(){let g=$('a38Grid');g.style.gridTemplateColumns=`repeat(${C},52px)`;g.innerHTML='';
 const resolvedByClue=new Map();if(state.permitOrdinals)for(const [x,m] of state.permitOrdinals)for(const [q,n] of m){if(!resolvedByClue.has(q))resolvedByClue.set(q,new Set());resolvedByClue.get(q).add(n)}
 const ordCands=(state.lineEdges&&A38Stepper.ordinalCandidates)?A38Stepper.ordinalCandidates(cfg(),state):null;
 for(let i=0;i<R*C;i++){let d=document.createElement('div');d.className='a38-cell '+kind[i]+((state.forcedCells&&state.forcedCells.has(i))?' forced':'')+((state.permitCells&&state.permitCells.has(i))?' has-permit':'');
  if(kind[i]==='clue'){let inp=document.createElement('span');inp.className='a38-clue-entry';inp.contentEditable='true';inp.spellcheck=false;inp.textContent=(clues[i]||[]).join(' ');inp.setAttribute('aria-label',`Numbers at row ${((i/C)|0)+1}, column ${i%C+1}`);inp.onclick=e=>{if(tool!=='clue'||(clues[i]||[]).length)e.stopPropagation()};inp.onkeydown=e=>{if(e.key.length===1&&!/[1-8? ,]/.test(e.key))e.preventDefault();if((e.key==='Backspace'||e.key==='Delete')&&!(inp.textContent||'').trim()){e.preventDefault();delete clues[i];kind[i]='cell';reset();render();return}e.stopPropagation()};inp.oninput=()=>{let toks=(inp.textContent.match(/[1-8?]/g)||[]);let nums=[...new Set(toks.filter(t=>t!=='?').map(Number))].sort((a,b)=>a-b);const wilds=Math.min(toks.filter(t=>t==='?').length,8-nums.length);for(let w=0;w<wilds;w++)nums.push('?');clues[i]=nums;shown=null;state={};status(nums.length?`Number cell contains ${nums.join(', ')}${wilds?` (each \u201c?\u201d = one more granting position with an unknown number, all distinct)`:''}.`:'Type numbers from 1 to 8, or ? marks for extra unknown granting positions.');};inp.onblur=()=>{setTimeout(render,0)};d.append(inp);
    const entries=clues[i]||[];
    if(entries.length>=1&&entries.length<=4){
      const listed=entries.filter(v=>v!=='?');
      const wilds=entries.length-listed.length;
      let extras=[];
      if(wilds&&resolvedByClue.has(i))extras=[...resolvedByClue.get(i)].filter(n=>!listed.includes(n)).sort((a,b)=>a-b).slice(0,wilds);
      const toks=listed.map(v=>({t:String(v)}));
      for(let w=0;w<wilds;w++)toks.push(w<extras.length?{t:String(extras[w]),red:true}:{t:'?'});
      const POS={1:[[50,50]],2:[[30,27],[70,73]],3:[[50,26],[29,74],[71,74]],4:[[50,24],[25,50],[75,50],[50,76]]};
      const lay=document.createElement('span');lay.className='a38-clue-layout';lay.setAttribute('aria-hidden','true');
      toks.forEach((tk,j)=>{const sp=document.createElement('span');sp.textContent=tk.t;if(tk.red){sp.className='a38-clue-resolved';sp.title='Resolved \u201c?\u201d (lowest number that works)'}const [px,py]=POS[toks.length][j];sp.style.left=px+'%';sp.style.top=py+'%';lay.append(sp)});
      inp.classList.add('fancy');
      d.append(lay);
    }}
  else if(kind[i]==='start')d.setAttribute('aria-label','Starting cell');if(state.noPermitCells&&state.noPermitCells.has(i)){let m=document.createElement('span');m.className='a38-no-permit-mark';m.textContent='×';m.title='No pass obtained here';d.append(m)}
  if(ordCands&&ordCands.has(i)&&!(state.permitCells&&state.permitCells.has(i))){const per=ordCands.get(i);const txts=[...per].slice(0,2).map(([q,set])=>[...set].sort((a,b)=>a-b).join('')).filter(t=>t.length);if(txts.length){let m=document.createElement('span');m.className='a38-ordinal-cands';m.textContent=txts.join('\u00b7');m.title='Possible visit positions around the adjacent number cell'+(per.size>1?'s':'');d.append(m)}}
  d.onclick=()=>paint(i);g.append(d)}drawRoute()}
function edgeKey(a,b){return a+'>'+b}
function drawRoute(){let svg=$('a38Svg'),canvas=$('a38Canvas'),W=C*52+4,H=R*52+4;canvas.style.width=W+'px';canvas.style.height=H+'px';svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.innerHTML='';
 let edges=[];if(shown)for(let p=0;p<shown.length;p++)edges.push([shown[p],shown[(p+1)%shown.length],'route']);if(state.lineEdges)for(const k of state.lineEdges){let [a,b]=k.split('-').map(Number);edges.push([a,b,'line'])}if(state.forcedEdges)for(const k of state.forcedEdges){let [a,b]=k.split('>').map(Number);edges=edges.filter(e=>!((e[0]===a&&e[1]===b)||(e[0]===b&&e[1]===a)));edges.push([a,b,'forced'])}
 for(const [a,b,type] of edges){let ar=(a/C)|0,ac=a%C,br=(b/C)|0,bc=b%C,x1=ac*52+28,y1=ar*52+28,x2=bc*52+28,y2=br*52+28;let l=document.createElementNS('http://www.w3.org/2000/svg','line');l.setAttribute('x1',x1);l.setAttribute('y1',y1);l.setAttribute('x2',x2);l.setAttribute('y2',y2);l.setAttribute('class',type==='line'?'a38-line-edge':type==='forced'?'a38-forced-edge':'a38-route-edge');svg.append(l);if(type!=='line'){let mx=(x1+x2)/2,my=(y1+y2)/2,dx=Math.sign(x2-x1),dy=Math.sign(y2-y1),pts;if(dx>0)pts=[[mx-6,my-6],[mx+1,my],[mx-6,my+6]];else if(dx<0)pts=[[mx+6,my-6],[mx-1,my],[mx+6,my+6]];else if(dy>0)pts=[[mx-6,my-6],[mx,my+1],[mx+6,my-6]];else pts=[[mx-6,my+6],[mx,my-1],[mx+6,my+6]];let ch=document.createElementNS('http://www.w3.org/2000/svg','polyline');ch.setAttribute('points',pts.map(p=>p.join(',')).join(' '));ch.setAttribute('class','a38-chevron');svg.append(ch)}}if(state.offEdges)for(const k of state.offEdges){let [a,b]=k.split('-').map(Number),ar=(a/C)|0,ac=a%C,br=(b/C)|0,bc=b%C,mx=(ac+bc)*26+28,my=(ar+br)*26+28;for(const s of [-1,1]){let l=document.createElementNS('http://www.w3.org/2000/svg','line');l.setAttribute('x1',mx-5);l.setAttribute('y1',my+s*5);l.setAttribute('x2',mx+5);l.setAttribute('y2',my-s*5);l.setAttribute('class','a38-off-edge');svg.append(l)}}
 if(state.permitCells)for(const i of state.permitCells){const cx=(i%C)*52+28,cy=((i/C)|0)*52+28,byClue=state.permitOrdinals&&state.permitOrdinals.get(i),vals=byClue?[...new Set(byClue.values())].sort((a,b)=>a-b):[],txt=vals.join('\u00b7');
  const g=document.createElementNS('http://www.w3.org/2000/svg','g');g.setAttribute('class','a38-permit-g');
  const wide=txt.length>2,w=wide?txt.length*7+12:26;
  const shp=document.createElementNS('http://www.w3.org/2000/svg',wide?'rect':'circle');
  if(wide){shp.setAttribute('x',cx-w/2);shp.setAttribute('y',cy-13);shp.setAttribute('width',w);shp.setAttribute('height',26);shp.setAttribute('rx',13)}else{shp.setAttribute('cx',cx);shp.setAttribute('cy',cy);shp.setAttribute('r',13)}
  shp.setAttribute('class','a38-permit-disc');
  const tt=document.createElementNS('http://www.w3.org/2000/svg','title');tt.textContent=byClue?'Pass obtained here; '+[...byClue].map(([q,n])=>`visit ${n} around r${((q/C)|0)+1}c${q%C+1}`).join(', '):'Pass obtained here';
  g.append(shp);
  if(txt){const t=document.createElementNS('http://www.w3.org/2000/svg','text');t.setAttribute('x',cx);t.setAttribute('y',cy+4);t.setAttribute('class','a38-permit-num');t.textContent=txt;g.append(t)}
  g.append(tt);svg.append(g)}

}
function cfg(){return {R,C,kind,clues,time:+$('a38Time').value,maxSolutions:runMax}}
function buildStrategyPanel(active=-1){$('a38Strats').innerHTML='';const order=A38Stepper.displayOrder||A38Stepper.techniques.map((_,i)=>i);for(const i of order){const x=A38Stepper.techniques[i];let li=document.createElement('li'),n=stepCounts.get(i)||0;li.classList.toggle('active',i===active);li.innerHTML=`<b>${x[0]}</b>${n?`<span class="cnt">×${n}</span>`:''}<div class="sdesc">${x[1]}</div>`;$('a38Strats').append(li)}}
function reset(){a38Hist=[];if(typeof stopA38Auto==='function')stopA38Auto();if($('a38Prev'))$('a38Prev').disabled=true;shown=null;state={};stepCounts=new Map();stepNo=0;buildStrategyPanel();status('Steps reset after editing the puzzle.')}
function resetSteps(){a38Hist=[];if(typeof stopA38Auto==='function')stopA38Auto();if($('a38Prev'))$('a38Prev').disabled=true;shown=null;state={};stepCounts=new Map();stepNo=0;buildStrategyPanel();status('Marks reset; clues kept.');render()}
function search(done){killStepThinking();killSolveThinking();status('Solving the directed route and proving uniqueness…');if(window.A38_WORKER_SOURCE&&window.Worker){let u=URL.createObjectURL(new Blob([window.A38_WORKER_SOURCE],{type:'text/javascript'})),w=new Worker(u);solveWorker=w;w.onmessage=e=>{if(solveWorker===w)solveWorker=null;w.terminate();URL.revokeObjectURL(u);done(e.data)};w.onerror=e=>{w.terminate();URL.revokeObjectURL(u);status('Solver worker failed: '+e.message)};w.postMessage(cfg())}else setTimeout(()=>done(A38Engine.solve(cfg(),+$('a38Time').value)),20)}
function finishRun(r,cands){if(r.error)return statusHTML('<span class="bad">'+esc(r.error)+'</span>');if(!r.solutions.length)return statusHTML(r.timed?'<span class="warn">No solution found within the time limit.</span> Raise the limit and try again.':'<span class="bad">No solution exists.</span>');
 if(cands&&(r.timed||r.capped))return statusHTML('<span class="warn">The complete solution set was not enumerated</span> \u2014 exact directed candidates cannot safely be shown. Raise the time limit.');if(cands){state.forcedEdges=A38Engine.commonDirectedEdges(r.solutions);state.forcedCells=new Set([...state.forcedEdges].flatMap(k=>k.split('>').map(Number)));
  // permits acquired in EVERY solution get a disc; the number shows only when
  // the ordinal agrees across all solutions
  {let cells=null,ords=null;const c2=cfg();
   for(const p of r.solutions){const info=A38Engine.permitInfo(p,c2);
     if(cells===null){cells=new Set(info.cells);ords=new Map([...info.ordinals].map(([x,m])=>[x,new Map(m)]))}
     else{for(const x of [...cells])if(!info.cells.has(x))cells.delete(x);
          for(const [x,m] of [...ords]){const im=info.ordinals.get(x);if(!im){ords.delete(x);continue}for(const [q,n] of [...m])if(im.get(q)!==n)m.delete(q);if(!m.size)ords.delete(x)}}}
   cells=cells||new Set();ords=ords||new Map();
   for(const x of [...ords.keys()])if(!cells.has(x))ords.delete(x);
   state.permitCells=cells;state.permitOrdinals=ords;}
  shown=null}else{shown=r.solutions[0];let info=A38Engine.permitInfo(shown,cfg());state={permitCells:info.cells,permitOrdinals:info.ordinals}}render();statusHTML((r.solutions.length===1&&!r.capped&&!r.timed?'<span class="good">Solved \u2014 the solution is unique.</span> ':r.solutions.length===1?'<span class="good">Solved.</span> <span class="warn">Uniqueness not verified \u2014 the time limit was reached.</span> ':'<span class="good">Solved.</span> <span class="warn">'+r.solutions.length+(r.capped?'+':'')+' directed solutions exist'+(r.timed?' (search timed out)':'')+'.</span> ')+(cands?'Blue arrows occur in every solution; permit circles mark cells that acquire a pass in every solution (numbered when the visit position is the same each time).':'The directed route and all acquired permits are shown.'))}
function run(cands){runMax=cands?2000:2;search(r=>finishRun(r,cands))}
function status(s){$('a38Status').textContent=s}
function statusHTML(s){$('a38Status').innerHTML=s}
const esc=t=>String(t).replace(/[&<>]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[ch]));
function statusStep(x){const box=$('a38Status');box.textContent='';
 if(x.tech!=null){stepNo++;const h=document.createElement('b');h.textContent='Step '+stepNo+' \u2014 '+(A38Stepper.techniques[x.tech]||['Deduction'])[0]+': ';box.append(h)}const follow=x.absorbed?` (Plus ${x.absorbed} routine direction bookkeeping mark${x.absorbed===1?'':'s'} placed along the way.)`:'';const decorate=()=>{if(x.contradiction){const sp=document.createElement('span');sp.className='bad';sp.textContent=' Contradiction \u2014 check the clues.';box.append(sp)}else if(x.complete){const sp=document.createElement('span');sp.className='good';sp.textContent=' Solved!';box.append(sp)}};
 if(!x.chain&&!x.cases){box.append(document.createTextNode((x.error||x.text)+follow));decorate();return}const addText=s=>box.append(document.createTextNode(s)),addChain=chain=>{let ol=document.createElement('ol');ol.className='chain';for(const mv of (chain||[]).slice(0,24)){let li=document.createElement('li'),b=document.createElement('b');b.textContent=(A38Stepper.techniques[mv.tech]||['Deduction'])[0]+': ';li.append(b,document.createTextNode(mv.text));ol.append(li)}if((chain||[]).length>24){let li=document.createElement('li');li.textContent=`… ${(chain||[]).length-24} more consequences`;ol.append(li)}box.append(ol)};if(x.chain){addText(x.chainIntro||x.text);addChain(x.chain);addText(x.chainOutro?' '+x.chainOutro:'')}else{addText(x.text);for(const cs of x.cases){let p=document.createElement('p');p.textContent=cs.intro;box.append(p);addChain(cs.chain)}}if(follow)addText(follow);decorate()}
if(!window.A38_WORKER_SOURCE&&window.fetch)Promise.all(['js/vendor/logic-solver.bundle.js','js/a38-engine.js'].map(u=>fetch(u).then(r=>r.ok?r.text():Promise.reject()))).then(([ls,eng])=>{window.A38_WORKER_SOURCE=ls+'\n'+eng+'\nonmessage=function(e){postMessage(A38Engine.solve(e.data,e.data.time||10));};'}).catch(()=>{});
if(!window.A38_STEP_WORKER_SOURCE&&window.fetch)fetch('js/a38-stepper.js').then(r=>r.ok?r.text():Promise.reject()).then(src=>{window.A38_STEP_WORKER_SOURCE=src+'\nonmessage=function(e){var st=e.data.state;var x=A38Stepper.step(e.data.cfg,st);postMessage({x:x,state:st});};'}).catch(()=>{});
let stepWorker=null,stepBusy=false,a38Hist=[],a38Auto=false,solveWorker=null,stepSnapshotPending=false;
function killStepThinking(){
 if(stepWorker){try{stepWorker.terminate()}catch(e){}stepWorker=null}
 if(stepBusy){stepBusy=false;$('a38Step').disabled=false;
   if(stepSnapshotPending&&a38Hist.length)a38Hist.pop();   // the aborted step never applied
 }
 stepSnapshotPending=false;
 stopA38Auto();updatePrev();
}
function killSolveThinking(){
 if(solveWorker){try{solveWorker.terminate()}catch(e){}solveWorker=null}
}
function cloneA38State(o){return {lineEdges:new Set(o.lineEdges||[]),offEdges:new Set(o.offEdges||[]),forcedEdges:new Set(o.forcedEdges||[]),offDirections:new Set(o.offDirections||[]),permitCells:new Set(o.permitCells||[]),noPermitCells:new Set(o.noPermitCells||[]),permitOrdinals:new Map([...(o.permitOrdinals||new Map())].map(([x,m])=>[x,new Map(m)])),patternRestrictions:new Map([...(o.patternRestrictions||new Map())].map(([q,s2])=>[q,new Set(s2)]))}}
function updatePrev(){$('a38Prev').disabled=!a38Hist.length}
function stopA38Auto(){a38Auto=false;$('a38Auto').textContent='Full solve path'}
function takeStep(){
 if(stepBusy)return;
 killSolveThinking();
 shown=null;
 a38Hist.push({state:state.lineEdges?cloneA38State(state):{},stepNo,counts:new Map(stepCounts)});if(a38Hist.length>500)a38Hist.shift();stepSnapshotPending=true;
 const runLocal=()=>setTimeout(()=>{let x=A38Stepper.step(cfg(),state);afterStep(x)},0);
 const src=window.A38_STEP_WORKER_SOURCE;
 stepBusy=true;$('a38Step').disabled=true;status('Thinking\u2026 (deeper deductions can take a little while)');
 if(src&&window.Worker){
   if(!stepWorker){const u=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));stepWorker=new Worker(u);stepWorker.onmessage=e=>{state=e.data.state;afterStep(e.data.x)};stepWorker.onerror=e=>{stepWorker=null;stepBusy=false;$('a38Step').disabled=false;runLocal()}}
   try{stepWorker.postMessage({cfg:cfg(),state})}catch(err){stepWorker=null;runLocal()}
 }else runLocal();
}
function afterStep(x){stepBusy=false;stepSnapshotPending=false;$('a38Step').disabled=false;
 if(x.tech==null&&!x.absorbed&&a38Hist.length)a38Hist.pop();   // nothing changed: drop the snapshot
 updatePrev();
 statusStep(x);if(x.tech!=null)stepCounts.set(x.tech,(stepCounts.get(x.tech)||0)+1);buildStrategyPanel(x.tech==null?-1:x.tech);render();
 if(a38Auto){if(x.tech!=null&&!x.contradiction&&!x.complete)setTimeout(()=>{if(a38Auto)takeStep()},250);else stopA38Auto()}}
document.querySelectorAll('.a38-tools button').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));$('a38Build').onclick=()=>build(true);$('a38Clear').onclick=()=>build(true);$('a38Reset').onclick=resetSteps;$('a38Solve').onclick=()=>run(false);$('a38Cands').onclick=()=>run(true);$('a38Step').onclick=takeStep;
$('a38Prev').onclick=()=>{if(stepBusy||!a38Hist.length)return;stopA38Auto();const h=a38Hist.pop();state=h.state;stepNo=h.stepNo;stepCounts=h.counts;shown=null;updatePrev();buildStrategyPanel();render();status('Reverted to before step '+(stepNo+1)+'.')};
$('a38Auto').onclick=()=>{if(a38Auto)return stopA38Auto();a38Auto=true;$('a38Auto').textContent='Stop';if(!stepBusy)takeStep()};
updatePrev();
buildStrategyPanel();setTool('cell');build(true);
})();
