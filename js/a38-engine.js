/* Exact A38 search. Paths are arrays beginning at the start; reverse directions
   are distinct because permit/station chronology is directional. */
(function(G){
function solveSAT(cfg,maxSolutions,limit){
 const until=Date.now()+(limit||10)*1000;
 const L=G.Logic,R=cfg.R,C=cfg.C,N=R*C,kind=cfg.kind,clues=cfg.clues||{},start=kind.indexOf('start'),cells=[];for(let i=0;i<N;i++)if(kind[i]!=='clue')cells.push(i);const M=cells.length,S=new L.Solver(),B={},edge=(x,y)=>`e_${x}_${y}`,permit=x=>`permit_${x}`,held=x=>`held_${x}`;
 const adj=x=>{let r=x/C|0,c=x%C,a=[];if(r)a.push(x-C);if(r+1<R)a.push(x+C);if(c)a.push(x-1);if(c+1<C)a.push(x+1);return a.filter(y=>kind[y]!=='clue')};
 const inRing=x=>kind[x]!=='clue'&&!(cfg.ignoreStart&&x===start);   // A 38 I/II: clue counting skips an adjacent start
 // Human degree propagation before SAT: border/corner cells and corridors
 // force undirected edges; saturated cells exclude their other edges.
 const uk=(a,b)=>a<b?a+'_'+b:b+'_'+a,ust=new Map();for(const x of cells)for(const y of adj(x))ust.set(uk(x,y),-1);let changed=true;while(changed){changed=false;for(const x of cells){let es=adj(x).map(y=>uk(x,y)),on=es.filter(k=>ust.get(k)===1),un=es.filter(k=>ust.get(k)<0);if(on.length===2)for(const k of un){ust.set(k,0);changed=true}else if(on.length+un.length===2)for(const k of un){ust.set(k,1);changed=true}}}
 for(const x of cells){B[x]=L.variableBits(`pos_${x}`,8);S.require(L.lessThan(B[x],L.constantBits(M)));S.require(L.exactlyOne(adj(x).map(y=>edge(x,y))));S.require(L.exactlyOne(adj(x).map(y=>edge(y,x))))}S.require(L.equalBits(B[start],L.constantBits(0)));for(let a=0;a<M;a++)for(let b=a+1;b<M;b++)S.forbid(L.equalBits(B[cells[a]],B[cells[b]]));
 for(const [k,v] of ust){let [a,b]=k.split('_').map(Number);if(v===1)S.require(L.or(edge(a,b),edge(b,a)));else if(v===0){S.forbid(edge(a,b));S.forbid(edge(b,a))}}
 for(const x of cells)for(const y of adj(x))if(y!==start)S.require(L.implies(edge(x,y),L.equalBits(B[y],L.sum(B[x],L.constantBits(1)))));
 const ids={},ringDirs=[[-1,0],[-1,1],[0,1],[1,1],[1,0],[1,-1],[0,-1],[-1,-1]];for(const x of cells)ids[x]=[];for(const qs of Object.keys(clues)){let q=+qs,raw=Array.isArray(clues[q])?clues[q]:[clues[q]],nums=raw.filter(v=>v!=='?').map(Number),wild=raw.some(v=>v==='?'),qr=q/C|0,qc=q%C,ns=[];for(const [dr,dc] of ringDirs){let r=qr+dr,c=qc+dc;if(r>=0&&r<R&&c>=0&&c<C&&inRing(r*C+c))ns.push(r*C+c)}const listed={};for(const x of ns){let before=ns.filter(y=>y!==x).map(y=>L.lessThan(B[y],B[x])),rank=L.sum(L.constantBits(1),before);listed[x]=nums.length?L.or(nums.map(n=>L.equalBits(rank,L.constantBits(+n)))):L.FALSE}const wildN=raw.filter(v=>v==='?').length;if(wildN){const exs=ns.filter(x=>kind[x]!=='station'&&x!==start).map(x=>`ex_${q}_${x}`);if(exs.length<wildN)S.require(L.FALSE);else if(wildN===1)S.require(L.exactlyOne(exs));else S.require(L.equalBits(L.sum(exs),L.constantBits(wildN)));for(const x of ns){if(kind[x]!=='station'&&x!==start)S.require(L.implies(`ex_${q}_${x}`,L.not(listed[x])));ids[x].push(kind[x]!=='station'&&x!==start?L.or(listed[x],`ex_${q}_${x}`):listed[x])}}else for(const x of ns)ids[x].push(listed[x]);let cyclic=[];for(const d of [1,-1])for(let off=0;off<ns.length;off++){let seq=Array.from({length:ns.length},(_,i)=>ns[(off+d*i+ns.length*3)%ns.length]),inc=[];for(let i=0;i+1<seq.length;i++)inc.push(L.lessThan(B[seq[i]],B[seq[i+1]]));cyclic.push(L.and(inc))}if(cyclic.length)S.require(L.or(cyclic))}
 for(const x of cells){if(ids[x].length)for(const id of ids[x])S.require(L.equiv(permit(x),id));else S.forbid(permit(x));if(kind[x]==='station'||x===start)S.forbid(permit(x))}S.forbid(held(start));
 for(const x of cells)for(const y of adj(x)){let e=edge(x,y);if(kind[y]==='station')S.require(L.implies(e,L.and(held(x),L.not(held(y)))));else{S.require(L.implies(L.and(e,permit(y)),L.and(L.not(held(x)),held(y))));S.require(L.implies(L.and(e,L.not(permit(y))),L.equiv(held(y),held(x))))}}
 const out=[];let timed=false;for(let z=0;z<(maxSolutions||2000);z++){if(Date.now()>until){timed=true;break}let sol=S.solve();if(!sol)break;let tv=new Set(sol.getTrueVars()),p=[start];while(p.length<M){let x=p[p.length-1],y=adj(x).find(v=>tv.has(edge(x,v)));if(y===start||y===undefined)break;p.push(y)}if(p.length!==M)break;out.push(p);S.forbid(L.and(p.map((x,i)=>edge(x,p[(i+1)%M]))))}return {solutions:out,timed,capped:out.length===(maxSolutions||2000)};
}
function solve(cfg,limit){
 if(G.Logic)return solveSAT(cfg,cfg.maxSolutions||2000,limit||cfg.time);
 const R=cfg.R,C=cfg.C,N=R*C,kind=cfg.kind,clues=cfg.clues||{}, start=kind.indexOf('start');
 const open=[]; for(let i=0;i<N;i++)if(kind[i]!=='clue')open.push(i);
 const adj=Array.from({length:N},(_,i)=>{let r=(i/C)|0,c=i%C,a=[];if(r)a.push(i-C);if(r+1<R)a.push(i+C);if(c)a.push(i-1);if(c+1<C)a.push(i+1);return a.filter(j=>kind[j]!=='clue')});
 const until=Date.now()+(limit||10)*1000, sols=[], seen=new Uint8Array(N), path=[start]; let timed=false,capped=false;
 const inRing=x=>kind[x]!=='clue'&&!(cfg.ignoreStart&&x===start);
 const clueIds=Object.keys(clues).map(Number), clueRaw=clueIds.map(q=>Array.isArray(clues[q])?clues[q]:[clues[q]]), clueNums=clueRaw.map(raw=>new Set(raw.filter(v=>v!=='?').map(Number))), clueWild=clueRaw.map(raw=>raw.filter(v=>v==='?').length), anyWild=clueWild.some(Boolean);
 const nearClues=Array.from({length:N},()=>[]),ringPos=clueIds.map(()=>new Map()),ringSize=new Uint8Array(clueIds.length),visitSeq=clueIds.map(()=>[]);for(let k=0;k<clueIds.length;k++){let q=clueIds[k],qr=(q/C)|0,qc=q%C,ring=[];for(const [dr,dc] of [[-1,0],[-1,1],[0,1],[1,1],[1,0],[1,-1],[0,-1],[-1,-1]]){let r=qr+dr,c=qc+dc;if(r>=0&&r<R&&c>=0&&c<C&&inRing(r*C+c))ring.push(r*C+c)}ringSize[k]=ring.length;ring.forEach((x,j)=>{nearClues[x].push(k);ringPos[k].set(x,j)})}
 const clueSeen=new Uint8Array(clueIds.length);
 function valid(p){
   let identified=new Map();
   const wildChoices=[];
   for(let ci=0;ci<clueIds.length;ci++){let q=clueIds[ci],nums=clueNums[ci],ns=p.filter(x=>Math.abs(((x/C)|0)-((q/C)|0))<=1&&Math.abs(x%C-q%C)<=1&&inRing(x));if([...nums].some(n=>n<1||n>ns.length))return false;
     if(clueWild[ci]&&nums.size+clueWild[ci]>ns.length)return false;   // no room for the extras
     for(let j=0;j<ns.length;j++){let cell=ns[j],yes=nums.has(j+1);
       if(yes){if(identified.get(cell)===false)return false;identified.set(cell,true)}
       else if(!clueWild[ci]){if(identified.get(cell)===true)return false;identified.set(cell,false)}}
     if(clueWild[ci])wildChoices.push({k:clueWild[ci],cands:ns.filter((cell,j)=>!nums.has(j+1)&&kind[cell]!=='station'&&cell!==start)});
   }
   for(const [cell,y] of identified)if(y&&kind[cell]==='station')return false;
   const mech=permits=>{let held=false,used=0;
     for(let t=1;t<=p.length;t++){let x=p[t%p.length];if(permits.has(x)){if(held)return false;held=true}if(kind[x]==='station'){if(!held)return false;held=false;used++}}
     return !held&&used===kind.filter(x=>x==='station').length};
   const basePermits=new Set([...identified].filter(x=>x[1]).map(x=>x[0]));
   if(!wildChoices.length)return mech(basePermits);
   // each ? clue contributes exactly one extra grant among its candidates; a
   // candidate already granting (via another clue) must BE the extra, and no
   // other granting cell may hide in the candidate set
   const rec=(ci2,permits)=>{
     if(ci2===wildChoices.length){
       // completeness: within every ?-clue's candidate set, exactly its k
       // chosen cells may grant (any other granting cell would be an
       // unlisted number)
       for(const wc of wildChoices)if(wc.cands.filter(c2=>permits.has(c2)).length!==wc.k)return false;
       return mech(permits);
     }
     const {k,cands}=wildChoices[ci2];
     const forced=cands.filter(c2=>permits.has(c2));
     if(forced.length>k)return false;
     const free=cands.filter(c2=>!permits.has(c2)&&identified.get(c2)!==false);
     const need=k-forced.length;
     if(need>free.length)return false;
     const pick=[];
     const sub=(i)=>{
       if(pick.length===need){const p2=new Set(permits);for(const c2 of pick)p2.add(c2);return rec(ci2+1,p2)}
       if(i>=free.length||free.length-i<need-pick.length)return false;
       pick.push(free[i]);if(sub(i+1))return true;pick.pop();return sub(i+1);
     };
     return sub(0)};
   return rec(0,basePermits);
 }
 function viable(v){
   // Every unvisited cell still needs two possible incident edges. Previously
   // visited interior cells are unavailable; only the live endpoint and start remain.
   for(const u of open)if(!seen[u]){let n=0;for(const w of adj[u])if(!seen[w]||w===v||w===start)n++;if(n<2)return false}
   // The remaining cells must be reachable from the live endpoint.
   let left=open.length-path.length;if(!left)return true;let stack=adj[v].filter(x=>!seen[x]),got=0,mark=new Uint8Array(N);for(const x of stack)mark[x]=1;while(stack.length){let u=stack.pop();got++;for(const w of adj[u])if(!seen[w]&&!mark[w]){mark[w]=1;stack.push(w)}}if(got!==left)return false;
   return true;
 }
 function cyclicOK(seq,m,dir){let travel=0;for(let i=1;i<seq.length;i++){let d=dir>0?(seq[i]-seq[i-1]+m)%m:(seq[i-1]-seq[i]+m)%m;if(!d)return false;travel+=d;if(travel>=m)return false}return true}
 function enter(x,held){let grant=null,done=[];for(const k of nearClues[x]){clueSeen[k]++;visitSeq[k].push(ringPos[k].get(x));done.push(k);if(!cyclicOK(visitSeq[k],ringSize[k],1)&&!cyclicOK(visitSeq[k],ringSize[k],-1))return {ok:false,next:held,touched:done};if(!anyWild){let hit=clueNums[k].has(clueSeen[k]);if(grant!==null&&grant!==hit)return {ok:false,next:held,touched:done};grant=hit}}if(anyWild)return {ok:true,next:held,touched:done};grant=!!grant;
   let next=held,ok=true;if(kind[x]==='station'){if(grant||!held)ok=false;else next=false}else if(grant){if(held||x===start)ok=false;else next=true}return {ok,next,touched:done};}
 function leave(rec){for(const k of rec.touched){clueSeen[k]--;visitSeq[k].pop()}}
 function dfs(v,held){if(Date.now()>until){timed=true;return}if(sols.length>=2000){capped=true;return}
   if(path.length===open.length){if(adj[v].includes(start)&&valid(path))sols.push(path.slice());return}
   let ns=adj[v].filter(x=>!seen[x]);if(path.length===1&&cfg.fixedFirst!==undefined)ns=ns.filter(x=>x===cfg.fixedFirst);
   // If an unvisited cell has exactly two remaining neighbours and one is the
   // live endpoint, that edge is mandatory now.
   ns.sort((a,b)=>adj[a].filter(x=>!seen[x]).length-adj[b].filter(x=>!seen[x]).length);
   for(const x of ns){let rec=enter(x,held);if(!rec.ok){leave(rec);continue}seen[x]=1;path.push(x);if(viable(x))dfs(x,rec.next);path.pop();seen[x]=0;leave(rec);if(timed)return}
 }
 if(start<0)return {error:'Place exactly one starting circle.'}; if(kind.filter(x=>x==='start').length!==1)return {error:'Place exactly one starting circle.'};
 if(Object.values(clues).some(v=>Array.isArray(v)&&v.length===0))return {error:'Every number cell must contain at least one number from 1 to 8.'};
 let first=enter(start,false);if(!first.ok){leave(first);return {solutions:[],timed:false,capped:false}}seen[start]=1;dfs(start,false);leave(first);return {solutions:sols,timed,capped};
}
function directedEdges(p){const s=new Set();for(let i=0;i<p.length;i++)s.add(p[i]+'>'+p[(i+1)%p.length]);return s}
function commonDirectedEdges(sols){if(!sols.length)return new Set();let out=directedEdges(sols[0]);for(let i=1;i<sols.length;i++){let e=directedEdges(sols[i]);for(const k of out)if(!e.has(k))out.delete(k)}return out}
function permitInfo(path,cfg){
 // Resolve each clue against the (start-rotated) path. A '?' entry is one
 // extra granting ordinal distinct from the listed numbers; it resolves to
 // the lowest ordinal that keeps every clue and the pass mechanics feasible.
 const cells=new Set(),ordinals=new Map(),C=cfg.C,clues=cfg.clues||{},kind=cfg.kind||[];
 const start=kind.indexOf?kind.indexOf('start'):-1;
 const specs=[];
 for(const qs of Object.keys(clues)){
   const q=+qs,qr=q/C|0,qc=q%C,raw=Array.isArray(clues[q])?clues[q]:[clues[q]];
   const nums=raw.filter(v=>v!=='?').map(Number),wild=raw.filter(v=>v==='?').length;
   const near=path.filter(x=>Math.abs((x/C|0)-qr)<=1&&Math.abs(x%C-qc)<=1);
   specs.push({q,nums,wild,near});
 }
 const identified=new Map();
 for(const sp of specs)for(let j=0;j<sp.near.length;j++){
   const cell=sp.near[j],yes=sp.nums.includes(j+1);
   if(yes)identified.set(cell,true);
   else if(!sp.wild&&identified.get(cell)!==true)identified.set(cell,identified.get(cell)||false);
 }
 const base=new Set([...identified].filter(e=>e[1]).map(e=>e[0]));
 const mech=permits=>{let held=false,used=0,stations=0;for(const x of path)if(kind[x]==='station')stations++;
   for(let t=1;t<=path.length;t++){const x=path[t%path.length];if(permits.has(x)){if(held)return false;held=true}if(kind[x]==='station'){if(!held)return false;held=false;used++}}
   return !held&&used===stations};
 const wilds=specs.filter(sp=>sp.wild).map(sp=>({sp,k:sp.wild,cands:sp.near.map((cell,j)=>({cell,ord:j+1})).filter(o=>!sp.nums.includes(o.ord)&&kind[o.cell]!=='station'&&o.cell!==start&&identified.get(o.cell)!==false)}));
 let chosen=null;
 const rec=(ci2,permits,acc)=>{
   if(ci2===wilds.length){
     for(const w of wilds)if(w.cands.filter(o=>permits.has(o.cell)).length!==w.k)return false;
     if(!mech(permits))return false;chosen=acc.slice();return true;
   }
   const w=wilds[ci2];
   const forced=w.cands.filter(o=>permits.has(o.cell));
   if(forced.length>w.k)return false;
   const free=w.cands.filter(o=>!permits.has(o.cell));
   const need=w.k-forced.length;
   if(need>free.length)return false;
   const pick=[];
   const sub=i=>{   // ascending ordinal = lexicographically lowest resolution
     if(pick.length===need){const p2=new Set(permits);for(const o of pick)p2.add(o.cell);return rec(ci2+1,p2,acc.concat(pick))}
     if(i>=free.length||free.length-i<need-pick.length)return false;
     pick.push(free[i]);if(sub(i+1))return true;pick.pop();return sub(i+1);
   };
   return sub(0);
 };
 if(wilds.length)rec(0,base,[]);
 const permits=new Set(base);
 if(chosen)for(const o of chosen)permits.add(o.cell);
 for(const sp of specs)for(let j=0;j<sp.near.length;j++){
   const cell=sp.near[j];
   if(!permits.has(cell))continue;
   cells.add(cell);
   let byClue=ordinals.get(cell);if(!byClue)ordinals.set(cell,byClue=new Map());
   byClue.set(sp.q,j+1);
 }
 return {cells,ordinals};
}
G.A38Engine={solve,directedEdges,commonDirectedEdges,permitInfo}; if(typeof module!=='undefined')module.exports=G.A38Engine;
})(typeof globalThis!=='undefined'?globalThis:this);
