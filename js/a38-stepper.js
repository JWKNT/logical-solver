(function(G){
    const techniques=[
    ['Cell degree','Every route cell has degree two. If only two edges remain, both are lines; after two lines, every other edge is excluded.'],
    ['Corner continuation','A corner or two-exit corridor must use both available segments.'],
    ['Direction propagation','At a completed cell, one incoming arrow forces its other segment outward, and one outgoing arrow forces the other inward.'],
    ['Premature loop','Do not close a smaller loop before every route cell has joined it.'],
    ['Opposite parallel directions','Adjacent parallel strands of a simple loop travel in opposite directions.'],
    ['Permit pattern','Rotate the numbered visit positions clockwise/counterclockwise around overlapping clues. Shared neighbours must agree on whether they grant a pass.'],
    ['Cyclic neighbour order','Visits around a number cell must remain strictly clockwise or strictly counterclockwise.'],
    ['Clue reach order','A number identifies the Nth neighbouring cell reached in the directed traversal.'],
    ['Pass chronology','A pass must be acquired before entering a gray cell; gray cells can never grant passes.'],
    ['Pass alternation','The traveller cannot hold two passes, so granting cells and gray cells alternate.'],
    ['Connectivity bridge','An edge that is the only remaining connection between route regions is forced; if a region has exactly two possible exits, a single loop uses both.'],
    ['Local contradiction','Try one undecided edge and propagate the visible human rules. If one choice reaches a contradiction, take the other.'],
    ['Case agreement','Compare the human-rule consequences of an edge being used or excluded. Any mark common to both cases is true without choosing a case.'],
    ['Permit count','The traveller starts and finishes empty-handed, so the number of distinct pass-acquisition cells equals the number of gray cells. Overlapping clues share one acquisition.'],
    ['Loop boundary parity','A closed loop crosses the boundary of every proper grid region an even number of times, and at least twice. A boundary with only two possible exits uses both.'],
    ['Forcing chain','Assume one local route choice, then split at one later two-way choice. If every continuation reaches a narrated human-rule contradiction, reject the original choice.'],
    ['Boundary orientation','Once one boundary segment is directed, the loop’s inside/outside orientation is known. Every other boundary segment must keep the grid interior on the same side.'],
    ['Ring degree','Within one cyclic rotation, a clue neighbour connects in-ring only to a rank-consecutive cell (the first/last pair and pass pairs never touch). Counting those edges against degree two kills rotations and forces segments.']
    ];
    const key=(a,b)=>a<b?a+'-'+b:b+'-'+a;
    function label(cfg,i){
        return `r${((i/cfg.C)|0)+1}c${i%cfg.C+1}`
    }
    function setup(state){
        state.lineEdges=state.lineEdges||new Set();
        state.offEdges=state.offEdges||new Set();
        state.forcedEdges=state.forcedEdges||new Set();
        state.offDirections=state.offDirections||new Set();
        state.permitCells=state.permitCells||new Set();
        state.noPermitCells=state.noPermitCells||new Set();
        state.permitOrdinals=state.permitOrdinals||new Map();
        state.patternRestrictions=state.patternRestrictions||new Map()
    }
    function neighbours(cfg,x){
        let r=(x/cfg.C)|0,c=x%cfg.C,a=[];
        for(const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1]]){
            let rr=r+dr,cc=c+dc;
            if(rr>=0&&rr<cfg.R&&cc>=0&&cc<cfg.C&&cfg.kind[rr*cfg.C+cc]!=='clue')a.push(rr*cfg.C+cc)
        }
        return a
    }
    function ringCells(cfg,q){
        const dirs=[[-1,0],[-1,1],[0,1],[1,1],[1,0],[1,-1],[0,-1],[-1,-1]],qr=(q/cfg.C)|0,qc=q%cfg.C,start=cfg.ignoreStart?cfg.kind.indexOf('start'):-1,out=[];
        for(const [dr,dc] of dirs){
            let r=qr+dr,c=qc+dc;
            if(r>=0&&r<cfg.R&&c>=0&&c<cfg.C&&cfg.kind[r*cfg.C+c]!=='clue'&&r*cfg.C+c!==start)out.push(r*cfg.C+c)
        }
        return out
    }
    function hasArrow(state,a,b){
        return state.forcedEdges.has(a+'>'+b)
    }
    function on(state,a,b){
        return state.lineEdges.has(key(a,b))||hasArrow(state,a,b)||hasArrow(state,b,a)
    }
    function addLine(state,a,b){
        state.lineEdges.add(key(a,b))
    }
    function rankDirection(cfg,pat,a,b){
        const ra=pat.ranks.get(a),rb=pat.ranks.get(b),m=pat.ranks.size,start=cfg.kind.indexOf('start');
        if(ra==null||rb==null)return null;
        if(Math.abs(ra-rb)===1)return ra<rb?a+'>'+b:b+'>'+a;
        if(ra===1&&a===start&&rb===m)return b+'>'+a;
        if(rb===1&&b===start&&ra===m)return a+'>'+b;
        return null;
        
    }
    function patternsOrderCompatible(order,chosen){
        for(let i=0;i<order.length;i++)for(let j=i+1;j<order.length;j++){
            const shared=order[i].ring.filter(x=>chosen[j].ranks.has(x));
            for(let a=0;a<shared.length;a++)for(let b=a+1;b<shared.length;b++){
                const x=shared[a],y=shared[b],di=Math.sign(chosen[i].ranks.get(x)-chosen[i].ranks.get(y)),dj=Math.sign(chosen[j].ranks.get(x)-chosen[j].ranks.get(y));
                if(di!==dj)return false;
                
            }
            
        }
        return true;
        
    }
    function patternEventsCompatible(cfg,state,assign,order,chosen,grantable){
        const nearClue=grantable||computeGrantable(cfg,state);
        const event=x=>cfg.kind[x]==='station'?-1:(state.permitCells.has(x)||assign.get(x)===true)?1:0;
        const mayHideEvent=x=>event(x)===0&&nearClue.has(x)&&assign.get(x)!==false&&!state.noPermitCells.has(x);
        // Walk each confirmed strand from every known event. A pattern is impossible
        // when the next possible event on that strand has the same type: two permits
        // would be acquired without a gray cell, or two gray cells would spend one pass.
        for(let start=0;start<cfg.R*cfg.C;start++)if(event(start))for(const first of neighbours(cfg,start))if(on(state,start,first)){
            let prev=start,cur=first,seen=new Set([start]);
            while(!seen.has(cur)){
                seen.add(cur);
                let t=event(cur);
                if(t){
                    if(t===event(start))return false;
                    break
                }
                if(mayHideEvent(cur))break;
                let next=neighbours(cfg,cur).filter(x=>x!==prev&&on(state,cur,x));
                if(next.length!==1)break;
                prev=cur;
                cur=next[0]
            }
            
        }
        // A confirmed edge joins consecutive visits in every clue ring containing
        // both endpoints, and any already-drawn arrow must agree with that order.
        for(let i=0;i<order.length;i++){
            const inf=order[i],pat=chosen[i];
            for(const a of inf.ring)for(const b of neighbours(cfg,a))if(a<b&&pat.ranks.has(b)&&on(state,a,b)){
                const dir=rankDirection(cfg,pat,a,b);
                if(!dir)return false;
                const [u,v]=dir.split('>').map(Number);
                if(hasArrow(state,v,u))return false;
                
            }
            
        }
        // Consecutive visits around a clue must also be connectable in the stated
        // direction without touching a different neighbour first.  Carry the pass
        // state through that potential corridor: a known/assigned permit picks one
        // up, a gray cell spends it, and an unresolved clue-neighbour may or may not
        // grant one.  This is a reachability check, not a route solve; it only rejects
        // a cyclic order when even the still-open grid cannot realise one interval.
        function afterEvent(x,held){
            if(cfg.kind[x]==='start')return held?[/* impossible */]:[false];
            const fixedPermit=state.permitCells.has(x)||assign.get(x)===true;
            const fixedNone=state.noPermitCells.has(x)||assign.get(x)===false||!nearClue.has(x);
            if(cfg.kind[x]==='station')return held?[false]:[];
            if(fixedPermit)return held?[]:[true];
            if(fixedNone)return [held];
            return held?[true]:[false,true];
            
        }
        function intervalPossible(inf,from,to){
            let starts=[];
            for(const before of [false,true])starts.push(...afterEvent(from,before));
            starts=[...new Set(starts)];
            if(!starts.length)return false;
            const forbidden=new Set(inf.ring.filter(x=>x!==to)),seen=new Set(),queue=[];
            for(const h of starts){
                const sig=from+'|'+(+h);
                seen.add(sig);
                queue.push([from,h])
            }
            while(queue.length){
                const [u,held]=queue.shift();
                for(const v of neighbours(cfg,u)){
                    if(state.offEdges.has(key(u,v))||state.offDirections.has(u+'>'+v)||hasArrow(state,v,u)||forbidden.has(v))continue;
                    const next=afterEvent(v,held);
                    for(const h of next){
                        if(v===to)return true;
                        const sig=v+'|'+(+h);
                        if(!seen.has(sig)){
                            seen.add(sig);
                            queue.push([v,h])
                        }
                        
                    }
                    
                }
                
            }
            return false;
            
        }
        for(let i=0;i<order.length;i++){
            const inf=order[i],pat=chosen[i],byRank=[...pat.ranks].sort((a,b)=>a[1]-b[1]).map(x=>x[0]);
            for(let n=0;n<byRank.length;n++)if(!intervalPossible(inf,byRank[n],byRank[(n+1)%byRank.length]))return false
        }
        return true;
        
    }
    // Strand order vs cyclic order: following confirmed arrows fixes the actual
    // traversal order of ring cells. A cyclic rotation that ranks them the other
    // way around is impossible. (If the confirmed strand passes the start between
    // two ring cells, the later cell is counted EARLIER, since counting begins at
    // the start.) This is the direct form of arguments like "r5c3 is the clue's
    // visit 1, so the route cannot reach another ring cell before it".
    function strandOrderStep(cfg,state){
        const start=cfg.kind.indexOf('start');
        const fOut=new Map();
        for(const d of state.forcedEdges){
            const [a,b]=d.split('>').map(Number);
            fOut.set(a,b)
        }
        if(!fOut.size)return null;
        for(const qs of Object.keys(cfg.clues)){
            const q=+qs,ring=ringCells(cfg,q),m=ring.length;
            if(!m)continue;
            const spec=clueSpec(cfg,q),nums=spec.nums;
            if(specBad(spec,m))continue;
            const current=state.patternRestrictions.get(q)||new Set(Array.from({length:m},(_,i)=>['1:'+i,'-1:'+i]).flat());
            if(!current.size)continue;
            // a pinned single rotation still yields contradictions below
            // physical order requirements from confirmed strands between ring mates
            const reqs=[];
            // {a,b,aFirst:boolean in counting order, via}
            for(const a of ring){
                let cur=a,steps=0,passedStart=false;
                while(fOut.has(cur)&&steps++<cfg.R*cfg.C){
                    cur=fOut.get(cur);
                    if(cur===a)break;
                    if(cur===start){
                        passedStart=true;
                        continue
                    }
                    if(ring.includes(cur)){
                        reqs.push({a,b:cur,aFirst:!passedStart});
                        break
                    }
                    
                }
                
            }
            if(!reqs.length)continue;
            const survivors=[];
            for(const sig of current){
                const [dStr,offStr]=sig.split(':');
                const d=+dStr,off=+offStr;
                const ranks=new Map();
                for(let n=1;n<=m;n++)ranks.set(ring[(off+d*(n-1)+m*3)%m],n);
                let ok=true;
                for(const r2 of reqs){
                    const ra=ranks.get(r2.a),rb=ranks.get(r2.b);
                    if(ra==null||rb==null)continue;
                    if((ra<rb)!==r2.aFirst){
                        ok=false;
                        break
                    }
                    
                }
                if(ok)survivors.push(sig);
                
            }
            if(!survivors.length){
                const r2=reqs[0];
                return {
                    tech:7,contradiction:true,text:`Following the confirmed arrows, ${label(cfg,r2.a)} is traversed ${r2.aFirst?'before':'after'} ${label(cfg,r2.b)}, but no remaining cyclic rotation around ${label(cfg,q)} ranks them that way.`
                };
                
            }
            if(survivors.length<current.size){
                const r2=reqs[0];
                state.patternRestrictions.set(q,new Set(survivors));
                return {
                    tech:7,text:`Following the confirmed arrows, ${label(cfg,r2.a)} is traversed ${r2.aFirst?'before':'after'} ${label(cfg,r2.b)}${r2.aFirst?'':' (the strand passes the start, so the count restarts)'} \u2014 rotations around ${label(cfg,q)} ranking them the other way are impossible; ${survivors.length} remain.`
                };
                
            }
            
        }
        return null;
        
    }
    // Two pass acquisitions can never be consecutive route cells (the second
    // pass would be picked up while still holding the first). A cyclic rotation
    // is therefore impossible when it forces that adjacency geometrically:
    // three granted ring cells in a straight line force the middle cell to use
    // one of its granted neighbours (its only exits are those two and one
    // outward cell), and a granted orthogonal pair is impossible outright when
    // either cell has fewer than two non-granted exits available.
    // which cells can still acquire a pass at all? A cell may grant only if some
    // surviving rotation of an adjacent clue ranks it at one of the clue's
    // numbers (respecting every mark placed so far). This is far tighter than
    // "any cell next to a clue" and lets chronology see through long corridors.
    // Ring degree analysis: within one cyclic rotation, a ring cell can connect
    // in-ring only to a rank-consecutive orthogonal neighbour (the wrap pair
    // visits 1 and m never connect directly for m>2, and two granted cells never
    // connect). Counting those usable ring edges plus the cell's outward exits
    // against the required degree two invalidates rotations and forces edges.
    // A route cell joined to the start by a confirmed line is the very first or
    // very last cell of the whole traversal (depending on the arrow), so inside
    // any clue ring its rank must be 1 or the ring size m — pinned to one of the
    // two once the segment is directed.
    // Walk each confirmed line chain leaving the start (unique continuation).
    // The loop traverses such a chain either first (leaving the start) or last
    // (returning to it), so the FIRST ring cell of any clue met along a chain is
    // that clue's first or last visit — pinned to one of the two by any arrow on
    // the chain. startChains returns [{cells:[...beyond start], dir}] where dir
    // is 1 (leaves the start), -1 (arrives), or 0 (undirected).
    function startChains(cfg,state){
        const start=cfg.kind.indexOf('start');
        if(start<0)return [];
        const out=[];
        for(const first of neighbours(cfg,start)){
            if(!on(state,start,first))continue;
            let dir=hasArrow(state,start,first)?1:hasArrow(state,first,start)?-1:0;
            const cells=[first];
            let prev=start,cur=first;
            while(true){
                const next=neighbours(cfg,cur).filter(y=>y!==prev&&on(state,cur,y));
                if(next.length!==1)break;
                if(!dir){
                    if(hasArrow(state,cur,next[0]))dir=1;
                    else if(hasArrow(state,next[0],cur))dir=-1
                }
                prev=cur;
                cur=next[0];
                cells.push(cur);
                if(cur===start){
                    cells.pop();
                    break
                }
                
            }
            out.push({cells,dir});
            
        }
        out.push({cells:[],dir:0});
        // the trivial chain: extensions directly at the start
        return out;
        
    }
    function startRankOk(cfg,state,ranks,m){
        const start=cfg.kind.indexOf('start');
        if(start<0)return true;
        for(const ch of startChains(cfg,state)){
            for(const x of ch.cells){
                if(!ranks.has(x))continue;
                const r=ranks.get(x);
                if(ch.dir===1){
                    if(r!==1)return false
                }
                else if(ch.dir===-1){
                    if(r!==m)return false
                }
                else if(r!==1&&r!==m)return false;
                break;
                // only the FIRST ring cell of this clue's ring on the chain is constrained
                
            }
            
        }
        return true;
        
    }
    function ringDegreeInfo(cfg,state,ring,ranks,yes){
        // Enumerate which sets of in-ring edges can coexist in this rotation.
        // Usable in-ring edges join rank-consecutive cells (never the visits-1/m
        // wrap for m>2, never two granted cells); proven lines among them are
        // mandatory. Each ring cell needs degree two from chosen in-ring edges
        // plus outward exits, and a run of in-ring edges may carry a second
        // granted cell only after a gray on the same run.
        const C=cfg.C,m=ring.length,ringSet=new Set(ring);
        const orth=x=>{
            const r=(x/C)|0,c=x%C,a=[];
            for(const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1]]){
                const rr=r+dr,cc=c+dc;
                if(rr>=0&&rr<cfg.R&&cc>=0&&cc<C&&cfg.kind[rr*C+cc]!=='clue')a.push(rr*C+cc)
            }
            return a
        };
        const edges=[],mandatory=[],outwardAvail=new Map(),outwardUsed=new Map();
        for(const x of ring){
            let avail=0,used=0;
            for(const u of orth(x)){
                if(state.offEdges&&state.offEdges.has(key(x,u)))continue;
                if(ringSet.has(u)){
                    if(u<x)continue;
                    const d=Math.abs(ranks.get(x)-ranks.get(u));
                    if(m>2&&d!==1)continue;
                    if(yes.has(x)&&yes.has(u))continue;
                    edges.push([x,u]);
                    if(on(state,x,u))mandatory.push(edges.length-1);
                    
                }else{
                    avail++;
                    if(on(state,x,u))used++
                }
                
            }
            outwardAvail.set(x,avail);
            outwardUsed.set(x,used);
            
        }
        const E=edges.length;
        if(E>14)return {
            edgeAlways:new Set(),edgeNever:new Set(),maxDegIn:new Map(ring.map(x=>[x,2])),outwardAvail,outwardUsed
        };
        let subsets=0;
        const usedCount=new Array(E).fill(0),maxDegIn=new Map(ring.map(x=>[x,0]));
        for(let mask=0;mask<(1<<E);mask++){
            let ok=true;
            for(const mi of mandatory)if(!(mask&(1<<mi))){
                ok=false;
                break
            }
            if(!ok)continue;
            const deg=new Map();
            for(let e=0;e<E&&ok;e++)if(mask&(1<<e)){
                const [a,b]=edges[e];
                deg.set(a,(deg.get(a)||0)+1);
                deg.set(b,(deg.get(b)||0)+1);
                if(deg.get(a)>2||deg.get(b)>2)ok=false
            }
            if(!ok)continue;
            for(const x of ring){
                const d=deg.get(x)||0;
                if(2-d<outwardUsed.get(x)||2-d>outwardAvail.get(x)){
                    ok=false;
                    break
                }
                
            }
            if(!ok)continue;
            const adj=new Map();
            for(let e=0;e<E;e++)if(mask&(1<<e)){
                const [a,b]=edges[e];
                if(!adj.has(a))adj.set(a,[]);
                if(!adj.has(b))adj.set(b,[]);
                adj.get(a).push(b);
                adj.get(b).push(a)
            }
            const seen=new Set();
            for(const x of ring){
                if(!ok)break;
                if(seen.has(x)||!(adj.get(x)||[]).length||(adj.get(x)||[]).length===2)continue;
                let run=[x],prev=-1,cur=x;
                seen.add(x);
                while(true){
                    const nxt=(adj.get(cur)||[]).filter(y=>y!==prev);
                    if(!nxt.length)break;
                    prev=cur;
                    cur=nxt[0];
                    run.push(cur);
                    seen.add(cur)
                }
                let lastEvent=0;
                for(const c2 of run){
                    if(yes.has(c2)){
                        if(lastEvent===1){
                            ok=false;
                            break
                        }
                        lastEvent=1
                    }else if(cfg.kind[c2]==='station')lastEvent=-1
                }
                
            }
            if(!ok)continue;
            subsets++;
            for(let e=0;e<E;e++)if(mask&(1<<e))usedCount[e]++;
            for(const x of ring)maxDegIn.set(x,Math.max(maxDegIn.get(x),deg.get(x)||0));
            
        }
        if(!subsets)return null;
        const edgeAlways=new Set(),edgeNever=new Set();
        for(let e=0;e<E;e++){
            if(usedCount[e]===subsets)edgeAlways.add(key(edges[e][0],edges[e][1]));
            if(!usedCount[e])edgeNever.add(key(edges[e][0],edges[e][1]))
        }
        return {
            edgeAlways,edgeNever,maxDegIn,outwardAvail,outwardUsed
        };
        
    }
    function computeGrantable(cfg,state){
        const out=new Set(),start=cfg.kind.indexOf('start');
        for(const qs of Object.keys(cfg.clues||{})){
            const q=+qs,ring=ringCells(cfg,q),m=ring.length;
            if(!m)continue;
            const spec=clueSpec(cfg,q),nums=spec.nums;
            if(specBad(spec,m)){
                for(const x of ring)out.add(x);
                continue
            }
            const current=state.patternRestrictions.get(q)||new Set(Array.from({length:m},(_,i)=>['1:'+i,'-1:'+i]).flat());
            for(const sig of current){
                const [dStr,offStr]=sig.split(':');
                const d=+dStr,off=+offStr;
                const ranks=new Map();
                for(let n=1;n<=m;n++)ranks.set(ring[(off+d*(n-1)+m*3)%m],n);
                if(ranks.has(start)&&ranks.get(start)!==1)continue;
                if(!startRankOk(cfg,state,ranks,m))continue;
                for(const yes of yesVariants(cfg,state,ring,ranks,spec)){
                    if(!grantsGeometryOk(cfg,yes))continue;
                    let ok=true;
                    for(const x of ring)if((((cfg.kind[x]==='station'||cfg.kind[x]==='start'||state.noPermitCells.has(x))&&yes.has(x))||(state.permitCells.has(x)&&!yes.has(x)))){
                        ok=false;
                        break
                    }
                    if(!ok)continue;
                    for(const x of yes)out.add(x);
                    
                }
                
            }
            
        }
        for(const x of state.permitCells)out.add(x);
        for(const x of state.noPermitCells)out.delete(x);
        return out;
        
    }
    // A clue entry '?' is one extra granting ordinal, distinct from the listed
    // numbers. clueSpec parses a clue; yesVariants expands one rotation into
    // every possible grant set (exactly one for plain clues, one per feasible
    // extra cell for a '?' clue, in ascending ordinal order).
    function clueSpec(cfg,q){
        const raw=Array.isArray(cfg.clues[q])?cfg.clues[q]:[cfg.clues[q]];
        return {
            nums:[...new Set(raw.filter(v=>v!=='?').map(Number))],wild:raw.filter(v=>v==='?').length
        }
        
    }
    function yesVariants(cfg,state,ring,ranks,spec){
        const base=new Set(ring.filter(x=>spec.nums.includes(ranks.get(x))));
        if(!spec.wild)return [base];
        const elig=[...ring].sort((a,b)=>ranks.get(a)-ranks.get(b)).filter(x=>
        !base.has(x)&&cfg.kind[x]!=='station'&&cfg.kind[x]!=='start'&&
        !(state&&state.noPermitCells&&state.noPermitCells.has(x)));
        if(elig.length<spec.wild)return [];
        const out=[],pick=[];
        (function rec(i){
            if(pick.length===spec.wild){
                const y=new Set(base);
                for(const x of pick)y.add(x);
                out.push(y);
                return
            }
            if(i>=elig.length||elig.length-i<spec.wild-pick.length)return;
            pick.push(elig[i]);
            rec(i+1);
            pick.pop();
            rec(i+1);
            })(0);
        return out;
        
    }
    function specBad(spec,m){
        return spec.nums.some(n=>n<1||n>m)||spec.nums.length+spec.wild>m
    }
    function grantsGeometryOk(cfg,yes){
        const C=cfg.C;
        const exits=x=>{
            const r=(x/C)|0,c=x%C,a=[];
            for(const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1]]){
                const rr=r+dr,cc=c+dc;
                if(rr>=0&&rr<cfg.R&&cc>=0&&cc<C&&cfg.kind[rr*C+cc]!=='clue')a.push(rr*C+cc)
            }
            return a
        };
        for(const x of yes)for(const y of exits(x)){
            if(!yes.has(y)||y<x)continue;
            // granted neighbours x,y: each needs two exits avoiding the other permit
            const okCell=z=>exits(z).filter(w=>!yes.has(w)).length>=2;
            if(!okCell(x)||!okCell(y))return false;
            
        }
        return true;
        
    }
    function globalPermitCountStep(cfg,state,options={}){
        const patCap=options.noTrial&&!options.deepGhost?4000:20000;
        const grantableSet=computeGrantable(cfg,state);
        const infos=[];
        for(const qs of Object.keys(cfg.clues)){
            const q=+qs,ring=ringCells(cfg,q),spec=clueSpec(cfg,q),nums=spec.nums,patterns=[];
            if(!specBad(spec,ring.length))for(const d of [1,-1])for(let off=0;off<ring.length;off++){
                const sig=d+':'+off,restriction=state.patternRestrictions.get(q);
                if(restriction&&!restriction.has(sig))continue;
                const ranks=new Map();
                for(let n=1;n<=ring.length;n++)ranks.set(ring[(off+d*(n-1)+ring.length*3)%ring.length],n);
                const start=cfg.kind.indexOf('start');
                if(ranks.has(start)&&ranks.get(start)!==1)continue;
                if(!startRankOk(cfg,state,ranks,ring.length))continue;
                for(const yes of yesVariants(cfg,state,ring,ranks,spec)){
                    let ok=grantsGeometryOk(cfg,yes);
                    for(const x of ring)if(((cfg.kind[x]==='station'||cfg.kind[x]==='start'||state.noPermitCells.has(x))&&yes.has(x))||(state.permitCells.has(x)&&!yes.has(x)))ok=false;
                    if(ok)patterns.push({yes,ranks,d})
                }
                
            }
            infos.push({q,ring,nums,patterns});
            
        }
        const comps=[],used=new Set();
        for(let root=0;root<infos.length;root++)if(!used.has(root)){
            const ids=[root],stack=[root];
            used.add(root);
            while(stack.length){
                const i=stack.pop();
                for(let j=0;j<infos.length;j++)if(!used.has(j)&&infos[i].ring.some(x=>infos[j].ring.includes(x))){
                    used.add(j);
                    ids.push(j);
                    stack.push(j)
                }
                
            }
            const order=ids.map(i=>infos[i]).sort((a,b)=>a.patterns.length-b.patterns.length),assign=new Map(),chosen=[],bySig=new Map();
            let capped=false;
            function rec(k){
                if(bySig.size>=patCap){
                    capped=true;
                    return
                }
                if(k===order.length){
                    if(!patternsOrderCompatible(order,chosen)||!patternEventsCompatible(cfg,state,assign,order,chosen,grantableSet))return;
                    const yes=[...assign].filter(([,v])=>v).map(([x])=>x).sort((a,b)=>a-b),sig=yes.join(',');
                    if(!bySig.has(sig))bySig.set(sig,new Set(yes));
                    return
                }
                const inf=order[k];
                for(const pat of inf.patterns){
                    const changed=[];
                    let ok=true;
                    for(const x of inf.ring){
                        const v=pat.yes.has(x);
                        if(assign.has(x)&&assign.get(x)!==v){
                            ok=false;
                            break
                        }
                        if(!assign.has(x)){
                            assign.set(x,v);
                            changed.push(x)
                        }
                        
                    }
                    if(ok){
                        chosen[k]=pat;
                        rec(k+1)
                    }
                    for(const x of changed)assign.delete(x);
                    if(capped)return
                }
                
            }
            rec(0);
            if(!bySig.size&&!capped)return {
                tech:13,contradiction:true,text:`No permit placement around ${order.map(x=>label(cfg,x.q)).join(', ')} respects the clue overlap and current route.`
            };
            if(capped)return null;
            comps.push({key:ids.map(i=>infos[i].q).sort((a,b)=>a-b).join(','),cells:new Set(order.flatMap(x=>x.ring)),assignments:[...bySig.values()]});
            
        }
        const target=cfg.kind.filter(x=>x==='station').length,counts=comps.map(c=>new Set(c.assignments.map(a=>a.size))),possible=new Set([0]);
        for(const cs of counts){
            const next=new Set();
            for(const a of possible)for(const b of cs)next.add(a+b);
            possible.clear();
            for(const x of next)possible.add(x)
        }
        if(!possible.has(target))return {
            tech:13,contradiction:true,text:`The clue patterns cannot produce exactly ${target} distinct permits for the ${target} gray cells.`
        };
        state.allowedPermitCounts=new Map();
        state.permitMapCases=[];
        for(let i=0;i<comps.length;i++){
            let others=new Set([0]);
            for(let j=0;j<comps.length;j++)if(j!==i){
                const next=new Set();
                for(const a of others)for(const b of counts[j])next.add(a+b);
                others=next
            }
            const allowed=new Set([...counts[i]].filter(c=>others.has(target-c)));
            state.allowedPermitCounts.set(comps[i].key,allowed);
            const valid=comps[i].assignments.filter(a=>allowed.has(a.size));
            state.permitMapCases.push(valid);
            for(const x of comps[i].cells){
                const n=valid.filter(a=>a.has(x)).length;
                if(n===valid.length&&!state.permitCells.has(x)){
                    state.permitCells.add(x);
                    return {
                        tech:13,text:`Exactly ${target} distinct permits are needed for the ${target} gray cells. Across every clue-component count that can reach that total, ${label(cfg,x)} is an acquisition cell.`
                    }
                    
                }
                if(n===0&&!state.noPermitCells.has(x)&&cfg.kind[x]!=='station'&&cfg.kind[x]!=='start'){
                    state.noPermitCells.add(x);
                    return {
                        tech:13,text:`Exactly ${target} distinct permits are needed for the ${target} gray cells. No clue-component count that can reach that total identifies ${label(cfg,x)}.`
                    }
                    
                }
                
            }
            
        }
        return null;
        
    }
    function permitPatternStep(cfg,state,options={}){
        const patCap=options.noTrial&&!options.deepGhost?4000:20000;
        const grantableSet=computeGrantable(cfg,state);
        const infos=[];
        for(const qs of Object.keys(cfg.clues)){
            const q=+qs,ring=ringCells(cfg,q),spec=clueSpec(cfg,q),nums=spec.nums,patterns=[];
            if(specBad(spec,ring.length)){
                infos.push({q,ring,nums,patterns});
                continue
            }
            for(const d of [1,-1])for(let off=0;off<ring.length;off++){
                const sig=d+':'+off,restriction=state.patternRestrictions.get(q);
                if(restriction&&!restriction.has(sig))continue;
                const ranks=new Map();
                for(let n=1;n<=ring.length;n++)ranks.set(ring[(off+d*(n-1)+ring.length*3)%ring.length],n);
                const start=cfg.kind.indexOf('start');
                if(ranks.has(start)&&ranks.get(start)!==1)continue;
                if(!startRankOk(cfg,state,ranks,ring.length))continue;
                for(const yes of yesVariants(cfg,state,ring,ranks,spec)){
                    let ok=grantsGeometryOk(cfg,yes);
                    for(const x of ring)if((((cfg.kind[x]==='station'||cfg.kind[x]==='start'||state.noPermitCells.has(x))&&yes.has(x))||(state.permitCells.has(x)&&!yes.has(x))))ok=false;
                    if(ok)patterns.push({yes,ranks,d,sig});
                    
                }
                
            }
            infos.push({q,ring,nums,patterns});
            
        }
        // Connected components of clues sharing at least one neighbouring cell.
        const used=new Set();
        for(let root=0;root<infos.length;root++)if(!used.has(root)){
            const ids=[root],stack=[root];
            used.add(root);
            while(stack.length){
                const i=stack.pop();
                for(let j=0;j<infos.length;j++)if(!used.has(j)&&infos[i].ring.some(x=>infos[j].ring.includes(x))){
                    used.add(j);
                    ids.push(j);
                    stack.push(j)
                }
                
            }
            const order=ids.map(i=>infos[i]).sort((a,b)=>a.patterns.length-b.patterns.length),allCells=new Set(order.flatMap(x=>x.ring)),assign=new Map(),chosen=[];
            let solutions=0,capped=false;
            const trueCount=new Map(),rankCounts=new Map(),edgeOrderCounts=new Map();
            function countRank(q,x,n){
                let qmap=rankCounts.get(q);
                if(!qmap)rankCounts.set(q,qmap=new Map());
                let xmap=qmap.get(x);
                if(!xmap)qmap.set(x,xmap=new Map());
                xmap.set(n,(xmap.get(n)||0)+1)
            }
            function rec(k){
                if(solutions>=patCap){
                    capped=true;
                    return
                }
                if(k===order.length){
                    if(!patternsOrderCompatible(order,chosen)||!patternEventsCompatible(cfg,state,assign,order,chosen,grantableSet))return;
                    const compKey=order.map(x=>x.q).sort((a,b)=>a-b).join(','),allowed=state.allowedPermitCounts&&state.allowedPermitCounts.get(compKey),permitCount=[...assign.values()].filter(Boolean).length;
                    if(allowed&&!allowed.has(permitCount))return;
                    solutions++;
                    for(const [x,v] of assign)if(v)trueCount.set(x,(trueCount.get(x)||0)+1);
                    for(let i=0;i<order.length;i++){
                        const inf=order[i],pat=chosen[i];
                        for(const [x,n] of pat.ranks)countRank(inf.q,x,n);
                        for(const a of inf.ring)for(const b of neighbours(cfg,a))if(a<b&&pat.ranks.has(b)){
                            const ek=inf.q+'|'+key(a,b),dir=rankDirection(cfg,pat,a,b);
                            let rec=edgeOrderCounts.get(ek);
                            if(!rec)edgeOrderCounts.set(ek,rec={a,b,dirs:new Map()});
                            if(dir)rec.dirs.set(dir,(rec.dirs.get(dir)||0)+1)
                        }
                        
                    }
                    return
                }
                const inf=order[k];
                for(const pat of inf.patterns){
                    const changed=[];
                    let ok=true;
                    for(const x of inf.ring){
                        const v=pat.yes.has(x);
                        if(assign.has(x)&&assign.get(x)!==v){
                            ok=false;
                            break
                        }
                        if(!assign.has(x)){
                            assign.set(x,v);
                            changed.push(x)
                        }
                        
                    }
                    if(ok){
                        chosen[k]=pat;
                        rec(k+1)
                    }
                    for(const x of changed)assign.delete(x);
                    if(capped)return
                }
                
            }
            rec(0);
            if(!solutions&&!capped)return {
                tech:5,contradiction:true,text:`The cyclic clue patterns around ${order.map(x=>label(cfg,x.q)).join(', ')} cannot agree with the confirmed route segments and pass chronology.`
            };
            if(capped)continue;
            const names=order.map(x=>`${label(cfg,x.q)} [${x.nums.join(',')}]`).join(', ');
            for(const x of allCells)if((trueCount.get(x)||0)===solutions&&!state.permitCells.has(x)){
                state.permitCells.add(x);
                return {
                    tech:5,text:`Consider every compatible cyclic placement around ${names}, including the confirmed route strands. Each placement identifies ${label(cfg,x)}, so the traveller obtains a pass there.`
                }
                
            }
            for(const x of allCells)if((trueCount.get(x)||0)===0&&!state.noPermitCells.has(x)&&cfg.kind[x]!=='station'&&cfg.kind[x]!=='start'){
                state.noPermitCells.add(x);
                return {
                    tech:5,text:`No cyclic placement around ${names} can identify ${label(cfg,x)} while respecting the confirmed route strands, so no pass is obtained there.`
                }
                
            }
            // Preserve exact ordinal labels when all remaining rotations agree. These
            // labels are general clue-relative visit positions, not puzzle coordinates.
            for(const inf of order){
                const qmap=rankCounts.get(inf.q)||new Map();
                for(const x of inf.ring)if(state.permitCells.has(x)){
                    const counts=qmap.get(x)||new Map(),fixed=[...counts].find(([,n])=>n===solutions);
                    if(!fixed)continue;
                    let byClue=state.permitOrdinals.get(x);
                    if(!byClue)state.permitOrdinals.set(x,byClue=new Map());
                    if(!byClue.has(inf.q)){
                        byClue.set(inf.q,fixed[0]);
                        return {
                            tech:7,text:`All remaining cyclic orders around ${label(cfg,inf.q)} place ${label(cfg,x)} at neighbouring visit ${fixed[0]}. Mark that ordinal on its pass circle.`
                        }
                        
                    }
                    
                }
                
            }
            // If two orthogonally adjacent ring cells are never consecutive in any
            // remaining visit order, their shared grid edge cannot be part of the loop.
            for(const [ek,rec] of edgeOrderCounts)if([...order].some(inf=>ek.startsWith(inf.q+'|'))){
                let total=0;
                for(const n of rec.dirs.values())total+=n;
                if(total===0&&!on(state,rec.a,rec.b)&&!state.offEdges.has(key(rec.a,rec.b))){
                    state.offEdges.add(key(rec.a,rec.b));
                    return {
                        tech:6,text:`In every remaining cyclic order around ${label(cfg,+ek.split('|')[0])}, ${label(cfg,rec.a)} and ${label(cfg,rec.b)} are nonconsecutive visits. Their shared edge is excluded.`
                    }
                    
                }
                
            }
            for(const [ek,rec] of edgeOrderCounts){
                for(const dir of [rec.a+'>'+rec.b,rec.b+'>'+rec.a])if(!rec.dirs.has(dir)&&!state.offDirections.has(dir)&&!state.offEdges.has(key(rec.a,rec.b))&&!hasArrow(state,rec.a,rec.b)&&!hasArrow(state,rec.b,rec.a)){
                    state.offDirections.add(dir);
                    const [a,b]=dir.split('>').map(Number);
                    return {
                        tech:7,text:`No remaining cyclic visit order around ${label(cfg,+ek.split('|')[0])} can traverse ${label(cfg,a)} → ${label(cfg,b)}. Mark that direction impossible; the undirected edge may still be used in reverse.`
                    }
                    
                }
                
            }
            // A confirmed segment between two ring cells inherits their common visit
            // direction whenever every remaining cyclic placement agrees.
            for(const [ek,rec] of edgeOrderCounts)if(on(state,rec.a,rec.b)&&rec.dirs.size===1){
                const [dir,n]=[...rec.dirs][0];
                if(n===solutions){
                    const [a,b]=dir.split('>').map(Number);
                    if(!hasArrow(state,a,b)&&!hasArrow(state,b,a)){
                        state.forcedEdges.add(dir);
                        return {
                            tech:7,text:`${label(cfg,rec.a)}–${label(cfg,rec.b)} joins consecutive neighbouring visits around ${label(cfg,+ek.split('|')[0])}. Every remaining cyclic order runs ${label(cfg,a)} → ${label(cfg,b)}.`
                        }
                        
                    }
                    
                }
                
            }
            
        }
        return null;
        
    }
    function localContradiction(cfg,state,assume,onValue){
        let lines=new Set(state.lineEdges),offs=new Set(state.offEdges);
        for(const d of state.forcedEdges){
            let [a,b]=d.split('>').map(Number);
            lines.add(key(a,b))
        }
        if(onValue)lines.add(assume);
        else offs.add(assume);
        const open=[];
        for(let i=0;i<cfg.R*cfg.C;i++)if(cfg.kind[i]!=='clue')open.push(i);
        let changed=true,loops=0;
        while(changed&&loops++<500){
            changed=false;
            for(const x of open){
                let ns=neighbours(cfg,x),a=ns.filter(y=>lines.has(key(x,y))),u=ns.filter(y=>!lines.has(key(x,y))&&!offs.has(key(x,y)));
                if(a.length>2||a.length+u.length<2)return 'a cell can no longer have degree two';
                if(a.length===2)for(const y of u){
                    offs.add(key(x,y));
                    changed=true
                }else if(a.length+u.length===2)for(const y of u){
                    lines.add(key(x,y));
                    changed=true
                }
                
            }
            // Confirmed degree-two component smaller than the grid is a sealed subloop.
            let seen=new Set();
            for(const root of open)if(!seen.has(root)){
                let q=[root],co=[];
                seen.add(root);
                while(q.length){
                    let x=q.pop();
                    co.push(x);
                    for(const y of neighbours(cfg,x))if(lines.has(key(x,y))&&!seen.has(y)){
                        seen.add(y);
                        q.push(y)
                    }
                    
                }
                if(co.length<open.length&&co.every(x=>neighbours(cfg,x).filter(y=>lines.has(key(x,y))).length===2))return 'it seals a smaller loop'
            }
            // The still-possible graph must stay connected.
            let reach=new Set([open[0]]),q=[open[0]];
            while(q.length){
                let x=q.pop();
                for(const y of neighbours(cfg,x))if(!offs.has(key(x,y))&&!reach.has(y)){
                    reach.add(y);
                    q.push(y)
                }
                
            }
            if(reach.size<open.length)return 'it disconnects the remaining route graph';
            
        }
        return null
    }
    function cloneState(state){
        const out={
            lineEdges:new Set(state.lineEdges),offEdges:new Set(state.offEdges),forcedEdges:new Set(state.forcedEdges),offDirections:new Set(state.offDirections),permitCells:new Set(state.permitCells),noPermitCells:new Set(state.noPermitCells),permitOrdinals:new Map(),patternRestrictions:new Map()
        };
        for(const [x,m] of state.permitOrdinals)out.permitOrdinals.set(x,new Map(m));
        for(const [q,s] of state.patternRestrictions)out.patternRestrictions.set(q,new Set(s));
        return out
    }
    function propagatedCase(cfg,state,k,value,quick=false,deep=false){
        const out=cloneState(state);
        if(value)out.lineEdges.add(k);
        else out.offEdges.add(k);
        const reasons=[];
        const cap=quick?120:240;
        for(let n=0;n<cap;n++){
            const mv=step(cfg,out,quick?{noTrial:true,quickTrial:true,deepGhost:deep}:{noTrial:true,deepGhost:deep});
            if(mv.contradiction){
                reasons.push(mv);
                return {
                    bad:mv.text,reasons,out
                }
                
            }
            if(mv.done)return {
                out,reasons
            };
            reasons.push(mv)
        }
        return {
            out,reasons,capped:true
        }
        
    }
    function propagatedDirectionCase(cfg,state,a,b,value,quick=false,deep=false){
        const out=cloneState(state);
        if(value){
            out.forcedEdges.add(a+'>'+b);
            out.lineEdges.add(key(a,b))
        }else out.offDirections.add(a+'>'+b);
        const reasons=[];
        const cap=quick?120:240;
        for(let n=0;n<cap;n++){
            const mv=step(cfg,out,quick?{noTrial:true,quickTrial:true,deepGhost:deep}:{noTrial:true,deepGhost:deep});
            if(mv.contradiction){
                reasons.push(mv);
                return {
                    bad:mv.text,reasons,out
                }
                
            }
            if(mv.done)return {
                out,reasons
            };
            reasons.push(mv)
        }
        return {
            out,reasons,capped:true
        }
        
    }
    function propagatedPermitCase(cfg,state,x,value,quick=false,deep=false){
        const out=cloneState(state);
        if(value)out.permitCells.add(x);
        else out.noPermitCells.add(x);
        const reasons=[];
        const cap=quick?120:240;
        for(let n=0;n<cap;n++){
            const mv=step(cfg,out,quick?{noTrial:true,quickTrial:true,deepGhost:deep}:{noTrial:true,deepGhost:deep});
            if(mv.contradiction){
                reasons.push(mv);
                return {
                    bad:mv.text,reasons,out
                }
                
            }
            if(mv.done)return {
                out,reasons
            };
            reasons.push(mv)
        }
        return {
            out,reasons,capped:true
        }
        
    }
    function propagatedPatternCase(cfg,state,q,sig,quick=false,deep=false){
        const out=cloneState(state);
        out.patternRestrictions.set(q,new Set([sig]));
        const reasons=[];
        const cap=quick?120:240;
        for(let n=0;n<cap;n++){
            const mv=step(cfg,out,quick?{noTrial:true,quickTrial:true,deepGhost:deep}:{noTrial:true,deepGhost:deep});
            if(mv.contradiction){
                reasons.push(mv);
                return {
                    bad:mv.text,reasons,out
                }
                
            }
            if(mv.done)return {
                out,reasons
            };
            reasons.push(mv)
        }
        return {
            out,reasons,capped:true
        }
        
    }
    function trialCandidates(cfg,state){
        const out=[];
        for(let a=0;a<cfg.R*cfg.C;a++)if(cfg.kind[a]!=='clue')for(const b of neighbours(cfg,a))if(a<b&&!on(state,a,b)&&!state.offEdges.has(key(a,b))){
            let score=0;
            for(const x of [a,b]){
                const used=neighbours(cfg,x).filter(y=>on(state,x,y)).length,unknown=neighbours(cfg,x).filter(y=>!on(state,x,y)&&!state.offEdges.has(key(x,y))).length;
                if(used===1&&unknown===2)score+=8;
                if(used)score+=3;
                if(state.permitCells.has(x)||cfg.kind[x]==='station')score+=5
            }
            out.push({e:[a,b],score})
        }
        return out.sort((x,y)=>y.score-x.score)
    }
    function proveBadBySplit(cfg,state,deadline,depth=1){
        const branch=r=>r.bad||(!r.capped&&depth>0&&proveBadBySplit(cfg,r.out,deadline,depth-1)?.summary);
        const near=new Set();
        for(const qs of Object.keys(cfg.clues))for(const x of ringCells(cfg,+qs))near.add(x);
        for(const x of [...near].filter(x=>cfg.kind[x]!=='station'&&cfg.kind[x]!=='start'&&!state.permitCells.has(x)&&!state.noPermitCells.has(x)).slice(0,6)){
            if(Date.now()>deadline)return null;
            const yes=propagatedPermitCase(cfg,state,x,true),whyYes=branch(yes),no=propagatedPermitCase(cfg,state,x,false),whyNo=branch(no);
            if(whyYes&&whyNo)return {
                summary:`At ${label(cfg,x)}, the permit case fails because ${whyYes}; the non-permit case fails because ${whyNo}.`
            }
            
        }
        for(const {e:[a,b]} of trialCandidates(cfg,state).slice(0,8)){
            if(Date.now()>deadline)return null;
            const k=key(a,b),yes=propagatedCase(cfg,state,k,true),whyYes=branch(yes),no=propagatedCase(cfg,state,k,false),whyNo=branch(no);
            if(whyYes&&whyNo)return {
                summary:`At ${label(cfg,a)}–${label(cfg,b)}, the line case fails because ${whyYes}; the excluded case fails because ${whyNo}.`
            }
            
        }
        return null;
        
    }
    function addSharedConclusion(state,a,b){
        let first=null,count=0;
        for(const [name,target] of [['lineEdges','line'],['offEdges','excluded edge'],['forcedEdges','direction'],['offDirections','impossible direction'],['permitCells','pass acquisition'],['noPermitCells','non-acquisition']])for(const x of a[name])if(b[name].has(x)&&!state[name].has(x)){
            state[name].add(x);
            if(!first)first={
                name,target,x
            };
            count++
        }
        if(first)first.count=count;
        return first;
        
    }
    function addCommonConclusion(state,cases){
        if(cases.length<2)return null;
        let first=null,count=0,vis=0;
        for(const [name,target] of [['lineEdges','line'],['offEdges','excluded edge'],['forcedEdges','direction'],['permitCells','pass acquisition'],['noPermitCells','non-acquisition'],['offDirections','impossible direction']])for(const x of cases[0][name])if(!state[name].has(x)&&cases.every(s=>s[name].has(x))){
            state[name].add(x);
            if(!first)first={
                name,target,x
            };
            count++;
            if(name!=='offDirections')vis++
        }
        if(first){
            first.count=count;
            first.vis=vis
        }
        return first
    }
    function stepOne(cfg,state,options={}){
        setup(state);
        const open=[];
        for(let i=0;i<cfg.R*cfg.C;i++)if(cfg.kind[i]!=='clue')open.push(i);
        // ===== 1. standard simple-loop logic =====
        // Degree contradictions and the simplest local fills/exclusions.
        for(const x of open){
            let ns=neighbours(cfg,x),ons=ns.filter(y=>on(state,x,y)),unk=ns.filter(y=>!on(state,x,y)&&!state.offEdges.has(key(x,y)));
            if(ons.length>2||ons.length+unk.length<2)return {
                tech:0,contradiction:true,text:`${label(cfg,x)} cannot have degree two with the current marks.`
            };
            if(ons.length===2&&unk.length){
                let y=unk[0];
                state.offEdges.add(key(x,y));
                return {
                    tech:0,text:`${label(cfg,x)} already has its two route segments, so ${label(cfg,x)}–${label(cfg,y)} is excluded.`
                }
                
            }
            if(ons.length+unk.length===2&&unk.length){
                let y=unk[0];
                addLine(state,x,y);
                let corner=ns.length===2;
                return {
                    tech:corner?1:0,text:`${label(cfg,x)} needs two route segments and has only ${ons.length+unk.length} available exits. Therefore ${label(cfg,x)}–${label(cfg,y)} is a line.`
                }
                
            }
            
        }
        // Ghost fast path: inside trial propagation, arrow bookkeeping fires before
        // the heavier permit machinery (the presented top-level order is unchanged).
        if(options.noTrial){
            for(const a of open)for(const b of neighbours(cfg,a))if(a<b&&!state.offEdges.has(key(a,b))&&state.offDirections.has(a+'>'+b)&&state.offDirections.has(b+'>'+a)){
                state.offEdges.add(key(a,b));
                return {
                    tech:2,text:`Both directions of ${label(cfg,a)}–${label(cfg,b)} are impossible, so the route cannot use that edge.`
                }
                
            }
            for(const d of [...state.forcedEdges]){
                const [a,b]=d.split('>').map(Number);
                for(const y of neighbours(cfg,a))if(y!==b&&!state.offDirections.has(a+'>'+y)){
                    state.offDirections.add(a+'>'+y);
                    return {
                        tech:2,text:`${label(cfg,a)} already has its outgoing arrow to ${label(cfg,b)}, so ${label(cfg,a)} → ${label(cfg,y)} is impossible.`
                    }
                    
                }
                for(const y of neighbours(cfg,b))if(y!==a&&!state.offDirections.has(y+'>'+b)){
                    state.offDirections.add(y+'>'+b);
                    return {
                        tech:2,text:`${label(cfg,b)} already has its incoming arrow from ${label(cfg,a)}, so ${label(cfg,y)} → ${label(cfg,b)} is impossible.`
                    }
                    
                }
                
            }
            for(const x of open){
                const ns=neighbours(cfg,x);
                for(const y of ns)if(on(state,x,y)){
                    if(state.offDirections.has(x+'>'+y)&&!hasArrow(state,y,x)&&!hasArrow(state,x,y)){
                        state.forcedEdges.add(y+'>'+x);
                        return {
                            tech:2,text:`The line ${label(cfg,x)}–${label(cfg,y)} cannot run ${label(cfg,x)} → ${label(cfg,y)}, so it must run ${label(cfg,y)} → ${label(cfg,x)}.`
                        }
                        
                    }
                    if(state.offDirections.has(y+'>'+x)&&!hasArrow(state,x,y)&&!hasArrow(state,y,x)){
                        state.forcedEdges.add(x+'>'+y);
                        return {
                            tech:2,text:`The line ${label(cfg,x)}–${label(cfg,y)} cannot run ${label(cfg,y)} → ${label(cfg,x)}, so it must run ${label(cfg,x)} → ${label(cfg,y)}.`
                        }
                        
                    }
                    
                }
                const outgoing=ns.filter(y=>!state.offEdges.has(key(x,y))&&!state.offDirections.has(x+'>'+y)&&!hasArrow(state,y,x)),incoming=ns.filter(y=>!state.offEdges.has(key(x,y))&&!state.offDirections.has(y+'>'+x)&&!hasArrow(state,x,y));
                if(!outgoing.length||!incoming.length)return {
                    tech:2,contradiction:true,text:`${label(cfg,x)} has no possible ${!outgoing.length?'outgoing':'incoming'} direction.`
                };
                if(outgoing.length===1&&!hasArrow(state,x,outgoing[0])){
                    state.forcedEdges.add(x+'>'+outgoing[0]);
                    return {
                        tech:2,text:`Every other outgoing direction from ${label(cfg,x)} is impossible, so ${label(cfg,x)} → ${label(cfg,outgoing[0])}.`
                    }
                    
                }
                if(incoming.length===1&&!hasArrow(state,incoming[0],x)){
                    state.forcedEdges.add(incoming[0]+'>'+x);
                    return {
                        tech:2,text:`Every other incoming direction to ${label(cfg,x)} is impossible, so ${label(cfg,incoming[0])} → ${label(cfg,x)}.`
                    }
                    
                }
                
            }
            // Once both undirected segments of a cell are known, propagate an arrow.
            for(const x of open){
                let ns=neighbours(cfg,x).filter(y=>on(state,x,y));
                if(ns.length!==2)continue;
                let incoming=ns.filter(y=>hasArrow(state,y,x)),outgoing=ns.filter(y=>hasArrow(state,x,y));
                if(incoming.length===1&&outgoing.length===0){
                    let y=ns.find(y=>!hasArrow(state,y,x));
                    state.forcedEdges.add(x+'>'+y);
                    return {
                        tech:2,text:`${label(cfg,x)} already has an incoming arrow from ${label(cfg,incoming[0])}. A directed loop has one way in and one way out, so ${label(cfg,x)} → ${label(cfg,y)}.`
                    }
                    
                }
                if(outgoing.length===1&&incoming.length===0){
                    let y=ns.find(y=>!hasArrow(state,x,y));
                    state.forcedEdges.add(y+'>'+x);
                    return {
                        tech:2,text:`${label(cfg,x)} already points out to ${label(cfg,outgoing[0])}. Its other segment must enter: ${label(cfg,y)} → ${label(cfg,x)}.`
                    }
                    
                }
                
            }
            // Adjacent confirmed parallel strands have opposite orientation.
            for(const d of state.forcedEdges){
                let [a,b]=d.split('>').map(Number),ar=(a/cfg.C)|0,ac=a%cfg.C,br=(b/cfg.C)|0,bc=b%cfg.C,shifts=ar===br?[[-1,0],[1,0]]:[[0,-1],[0,1]];
                for(const [dr,dc] of shifts){
                    let rr=ar+dr,cc=ac+dc,rr2=br+dr,cc2=bc+dc;
                    if(rr<0||rr2<0||cc<0||cc2<0||rr>=cfg.R||rr2>=cfg.R||cc>=cfg.C||cc2>=cfg.C)continue;
                    let aa=rr*cfg.C+cc,bb=rr2*cfg.C+cc2;
                    if(cfg.kind[aa]==='clue'||cfg.kind[bb]==='clue'||state.offEdges.has(key(aa,bb)))continue;
                    if(!state.offDirections.has(aa+'>'+bb)&&!hasArrow(state,bb,aa)){
                        state.offDirections.add(aa+'>'+bb);
                        return {
                            tech:4,text:`${label(cfg,a)} → ${label(cfg,b)} runs directly beside the parallel candidate ${label(cfg,aa)}–${label(cfg,bb)}. Two adjacent strands of one simple loop cannot run the same way, so ${label(cfg,aa)} → ${label(cfg,bb)} is impossible.`
                        }
                        
                    }
                    if(on(state,aa,bb)&&!hasArrow(state,aa,bb)&&!hasArrow(state,bb,aa)){
                        state.forcedEdges.add(bb+'>'+aa);
                        return {
                            tech:4,text:`${label(cfg,a)} → ${label(cfg,b)} runs parallel and directly beside ${label(cfg,aa)}–${label(cfg,bb)}. A simple directed loop uses opposite orientations there, so ${label(cfg,bb)} → ${label(cfg,aa)}.`
                        }
                        
                    }
                    
                }
                
            }
            
        }
        // A candidate edge joining vertices already connected by confirmed lines
        // would seal that component into a premature loop.
        const comp=new Map();
        let cid=0;
        for(const root of open)if(!comp.has(root)){
            cid++;
            let q=[root];
            comp.set(root,cid);
            while(q.length){
                let u=q.pop();
                for(const v of neighbours(cfg,u))if(on(state,u,v)&&!comp.has(v)){
                    comp.set(v,cid);
                    q.push(v)
                }
                
            }
            
        }
        let sizes=new Map();
        for(const v of comp.values())sizes.set(v,(sizes.get(v)||0)+1);
        for(const x of open)for(const y of neighbours(cfg,x))if(x<y&&!on(state,x,y)&&!state.offEdges.has(key(x,y))&&comp.get(x)===comp.get(y)&&sizes.get(comp.get(x))<open.length){
            state.offEdges.add(key(x,y));
            return {
                tech:3,text:`Adding ${label(cfg,x)}–${label(cfg,y)} would close a loop containing only ${sizes.get(comp.get(x))} of ${open.length} route cells. Exclude that edge.`
            }
            
        }
        // Potential-graph bridge test. This is graph connectivity, not solution search.
        const candidates=[];
        for(const x of open)for(const y of neighbours(cfg,x))if(x<y&&!on(state,x,y)&&!state.offEdges.has(key(x,y)))candidates.push([x,y]);
        // One-pass bridge computation (Tarjan low-links) over every non-excluded
        // edge: a candidate edge whose removal disconnects the graph must be a line.
        {
            const adj=new Map();
            const addAdj=(u,v)=>{
                let l=adj.get(u);
                if(!l)adj.set(u,l=[]);
                l.push(v)
            };
            for(const x of open)for(const y of neighbours(cfg,x))if(x<y&&!state.offEdges.has(key(x,y))){
                addAdj(x,y);
                addAdj(y,x)
            }
            const disc=new Map(),low=new Map(),bridges=new Set();
            let timer=0;
            for(const root of open)if(!disc.has(root)){
                const stack=[[root,-1,0]];
                while(stack.length){
                    const fr=stack[stack.length-1],[u,parent]=fr;
                    if(fr[2]===0){
                        disc.set(u,++timer);
                        low.set(u,timer)
                    }
                    const l=adj.get(u)||[];
                    if(fr[2]<l.length){
                        const v=l[fr[2]++];
                        if(v===parent&&!fr[3]){
                            fr[3]=true;
                            continue
                        }
                        if(disc.has(v)){
                            low.set(u,Math.min(low.get(u),disc.get(v)))
                        }
                        else stack.push([v,u,0]);
                        
                    }else{
                        stack.pop();
                        if(parent!==-1){
                            low.set(parent,Math.min(low.get(parent),low.get(u)));
                            if(low.get(u)>disc.get(parent))bridges.add(key(parent,u))
                        }
                        
                    }
                    
                }
                
            }
            for(const [a,b] of candidates)if(bridges.has(key(a,b))){
                addLine(state,a,b);
                return {
                    tech:10,text:`Without ${label(cfg,a)}–${label(cfg,b)}, the remaining possible route graph splits into separate regions. This bridge is a line.`
                }
                
            }
            
        }
        // ===== 2. permit / pass logic =====
        const startCell=cfg.kind.indexOf('start');
        for(const y of neighbours(cfg,startCell))if(cfg.kind[y]==='station'&&!state.offDirections.has(startCell+'>'+y)){
            state.offDirections.add(startCell+'>'+y);
            return {
                tech:8,text:`The traveller starts empty-handed, so the first move cannot enter gray ${label(cfg,y)}. Mark ${label(cfg,startCell)} → ${label(cfg,y)} impossible (the reverse direction may still close the loop).`
            }
            
        }
        // two proven pass acquisitions can never be consecutive on the route
        for(const x of state.permitCells)for(const y of neighbours(cfg,x))if(y>x&&state.permitCells.has(y)&&!state.offEdges.has(key(x,y))){
            state.offEdges.add(key(x,y));
            return {
                tech:9,text:`${label(cfg,x)} and ${label(cfg,y)} both acquire a pass. Travelling one directly into the other would pick up a second pass while still holding the first, so their shared edge is excluded.`
            }
            
        }
        // The loop traverses each confirmed start chain first or last, so the first
        // ring cell of a clue met along it must be that clue's visit 1 or m. This
        // both excludes prospective extensions whose ordinal candidates allow
        // neither, and directs the chain when only one of the two is possible.
        {
            const start=cfg.kind.indexOf('start');
            if(start>=0){
                const cands=ordinalCandidates(cfg,state);
                for(const ch of startChains(cfg,state)){
                    const seen=new Set();
                    // clues whose ring the chain already entered
                    for(const x of ch.cells)for(const qs of Object.keys(cfg.clues)){
                        const q=+qs;
                        if(!seen.has(q)&&ringCells(cfg,q).includes(x))seen.add(q)
                    }
                    const e=ch.cells.length?ch.cells[ch.cells.length-1]:start;
                    const prev=ch.cells.length>1?ch.cells[ch.cells.length-2]:start;
                    for(const y of neighbours(cfg,e)){
                        if(y===prev||on(state,e,y)||state.offEdges.has(key(e,y)))continue;
                        const byClue=cands.get(y);
                        if(!byClue)continue;
                        for(const [q,set] of byClue){
                            if(seen.has(q)||!set.size)continue;
                            const m=ringCells(cfg,q).length;
                            const canFirst=set.has(1),canLast=set.has(m);
                            if(!canFirst&&!canLast){
                                state.offEdges.add(key(e,y));
                                return {
                                    tech:7,text:`Extending the confirmed start chain through ${label(cfg,e)} to ${label(cfg,y)} would make ${label(cfg,y)} the chain's first cell around ${label(cfg,q)} \u2014 the traversal's very first or very last visit there (visit 1 or ${m}) \u2014 but it can only be visit ${[...set].sort((a,b)=>a-b).join('/')}. Exclude ${label(cfg,e)}\u2013${label(cfg,y)}.`
                                };
                                
                            }
                            if(ch.dir===1&&!canFirst&&!state.offDirections.has(e+'>'+y)){
                                state.offDirections.add(e+'>'+y);
                                return {
                                    tech:7,text:`The start chain leaves the start, so extending it to ${label(cfg,y)} would make ${label(cfg,y)} visit 1 around ${label(cfg,q)}, which its candidates forbid: ${label(cfg,e)} \u2192 ${label(cfg,y)} is impossible.`
                                }
                                
                            }
                            if(ch.dir===-1&&!canLast&&!state.offDirections.has(y+'>'+e)){
                                state.offDirections.add(y+'>'+e);
                                return {
                                    tech:7,text:`The start chain returns to the start, so reaching it from ${label(cfg,y)} would make ${label(cfg,y)} visit ${m} around ${label(cfg,q)}, which its candidates forbid: ${label(cfg,y)} \u2192 ${label(cfg,e)} is impossible.`
                                }
                                
                            }
                            if(!ch.dir){
                                if(!canFirst&&!state.offDirections.has(e+'>'+y)){
                                    state.offDirections.add(e+'>'+y);
                                    return {
                                        tech:7,text:`${label(cfg,y)} can never be visit 1 around ${label(cfg,q)}, so the start chain cannot leave the start through it: ${label(cfg,e)} \u2192 ${label(cfg,y)} is impossible.`
                                    }
                                    
                                }
                                if(!canLast&&!state.offDirections.has(y+'>'+e)){
                                    state.offDirections.add(y+'>'+e);
                                    return {
                                        tech:7,text:`${label(cfg,y)} can never be visit ${m} around ${label(cfg,q)}, so the start chain cannot return to the start through it: ${label(cfg,y)} \u2192 ${label(cfg,e)} is impossible.`
                                    }
                                    
                                }
                                
                            }
                            
                        }
                        
                    }
                    
                }
                
            }
            
        }
        // Ring degree: rotations whose neighbouring cells cannot all reach degree
        // two die; ring edges demanded (or refused) by every surviving rotation are
        // decided, and a cell that can never take two ring edges must use all of
        // its outward exits.
        {
            const start=cfg.kind.indexOf('start');
            for(const qs of Object.keys(cfg.clues)){
                const q=+qs,ring=ringCells(cfg,q),m=ring.length;
                if(!m)continue;
                const spec=clueSpec(cfg,q),nums=spec.nums;
                if(specBad(spec,m))continue;
                const current=state.patternRestrictions.get(q)||new Set(Array.from({length:m},(_,i)=>['1:'+i,'-1:'+i]).flat());
                if(!current.size)continue;
                const survivors=[];
                let always=null,never=null;
                const maxDeg=new Map(ring.map(x=>[x,0]));
                let oa=null,ou=null;
                for(const sig of current){
                    const [dStr,offStr]=sig.split(':');
                    const d=+dStr,off=+offStr;
                    const ranks=new Map();
                    for(let n=1;n<=m;n++)ranks.set(ring[(off+d*(n-1)+m*3)%m],n);
                    if(ranks.has(start)&&ranks.get(start)!==1)continue;
                    if(!startRankOk(cfg,state,ranks,m))continue;
                    let sigOk=false;
                    for(const yes of yesVariants(cfg,state,ring,ranks,spec)){
                        if(!grantsGeometryOk(cfg,yes))continue;
                        let ok=true;
                        for(const x of ring)if((((cfg.kind[x]==='station'||cfg.kind[x]==='start'||state.noPermitCells.has(x))&&yes.has(x))||(state.permitCells.has(x)&&!yes.has(x)))){
                            ok=false;
                            break
                        }
                        if(!ok)continue;
                        const info=ringDegreeInfo(cfg,state,ring,ranks,yes);
                        if(!info)continue;
                        sigOk=true;
                        if(always==null)always=new Set(info.edgeAlways);
                        else for(const k of [...always])if(!info.edgeAlways.has(k))always.delete(k);
                        if(never==null)never=new Set(info.edgeNever);
                        else for(const k of [...never])if(!info.edgeNever.has(k))never.delete(k);
                        for(const x of ring)maxDeg.set(x,Math.max(maxDeg.get(x),info.maxDegIn.get(x)||0));
                        oa=info.outwardAvail;
                        ou=info.outwardUsed;
                        
                    }
                    if(sigOk)survivors.push(sig);
                    
                }
                if(!survivors.length)return {
                    tech:17,contradiction:true,text:`No cyclic rotation around ${label(cfg,q)} can give every neighbouring cell its two route segments with legally spaced pass pickups.`
                };
                if(survivors.length<current.size){
                    state.patternRestrictions.set(q,new Set(survivors));
                    return {
                        tech:17,text:`Rotations around ${label(cfg,q)} that cannot give every neighbouring cell two usable segments (with a gray between pass pickups on any shared run) are impossible; ${survivors.length} remain.`
                    }
                    
                }
                if(never)for(const k of never){
                    if(!state.offEdges.has(k)){
                        const [a,b]=k.split('-').map(Number);
                        if(on(state,a,b))return {
                            tech:17,contradiction:true,text:`${label(cfg,a)}\u2013${label(cfg,b)} is a line, but no rotation around ${label(cfg,q)} can use it.`
                        };
                        state.offEdges.add(k);
                        return {
                            tech:17,text:`No rotation around ${label(cfg,q)} can traverse ${label(cfg,a)}\u2013${label(cfg,b)} (rank order, pass spacing, and cell degrees forbid it) \u2014 exclude the edge.`
                        }
                        
                    }
                    
                }
                if(always)for(const k of always){
                    const [a,b]=k.split('-').map(Number);
                    if(!on(state,a,b)&&!state.offEdges.has(k)){
                        addLine(state,a,b);
                        return {
                            tech:17,text:`Every remaining rotation around ${label(cfg,q)} needs ${label(cfg,a)}\u2013${label(cfg,b)} \u2014 it is a line.`
                        }
                        
                    }
                    
                }
                for(const x of ring){
                    const availLeft=(oa?oa.get(x):0)||0,usedNow=(ou?ou.get(x):0)||0;
                    if(availLeft&&maxDeg.get(x)<=2-availLeft&&availLeft>usedNow){
                        // x can never take enough ring edges: all its outward exits are lines
                        const C2=cfg.C,r2=(x/C2)|0,c2=x%C2;
                        for(const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1]]){
                            const rr=r2+dr,cc=c2+dc;
                            if(rr<0||rr>=cfg.R||cc<0||cc>=C2)continue;
                            const u=rr*C2+cc;
                            if(cfg.kind[u]==='clue'||ring.includes(u)||state.offEdges.has(key(x,u))||on(state,x,u))continue;
                            addLine(state,x,u);
                            return {
                                tech:17,text:`In every remaining rotation around ${label(cfg,q)}, ${label(cfg,x)} can use at most ${maxDeg.get(x)} ring segment${maxDeg.get(x)===1?'':'s'}, so it needs all of its outward exits \u2014 ${label(cfg,x)}\u2013${label(cfg,u)} is a line.`
                            }
                            
                        }
                        
                    }
                    
                }
                
            }
            
        }
        let orderMove=strandOrderStep(cfg,state);
        if(orderMove)return orderMove;
        // Consecutive events must alternate: permit, gray, permit, gray. Look through
        // already-confirmed, event-free strands as well as directly adjacent cells.
        // Only cells that can still actually acquire a pass (under some surviving
        // rotation of an adjacent clue) can hide an event.
        const nearClue=computeGrantable(cfg,state);
        // Carry the actual pass state forward from the directed start branch. At its
        // open endpoint, reject any candidate continuation whose already-directed
        // strand reaches the wrong next event. This is direct chronology, not trial.
        function advanceFromStart(x,held,counts,record){
            const hits=[];
            let ambiguous=false;
            for(const qs of Object.keys(cfg.clues)){
                const q=+qs;
                if(!ringCells(cfg,q).includes(x))continue;
                const rank=(counts.get(q)||0)+1;
                counts.set(q,rank);
                const spec=clueSpec(cfg,q);
                let grant;
                if(spec.nums.includes(rank))grant=true;
                else if(!spec.wild)grant=false;
                else if(cfg.kind[x]==='station'||cfg.kind[x]==='start')grant=false;
                else if(state.permitCells.has(x))grant=true;
                else if(state.noPermitCells.has(x))grant=false;
                else{
                    ambiguous=true;
                    grant=false
                }
                hits.push({q,rank,grant})
            }
            if(ambiguous)return {
                ambiguous:true,held,hits:[]
            };
            if(hits.length&&hits.some(h=>h.grant)!==hits.every(h=>h.grant))return {
                bad:`the adjacent clues disagree on whether ${label(cfg,x)} grants a permit at its current visit positions`
            };
            const grant=hits.some(h=>h.grant);
            if((cfg.kind[x]==='station'||cfg.kind[x]==='start')&&grant)return {
                bad:`${label(cfg,x)} would have to grant a permit even though ${cfg.kind[x]==='station'?'gray':'the start'} cells cannot`
            };
            // visit ranks must agree with everything already proven: a cell counted at
            // a granting position cannot be a proven non-acquisition (and vice versa),
            // and a pass circle with a fixed ordinal must be reached at that ordinal
            if(grant&&state.noPermitCells.has(x))return {
                bad:`${label(cfg,x)} would be a granting visit (${hits.filter(h=>h.grant).map(h=>`visit ${h.rank} of ${label(cfg,h.q)}`).join(', ')}), but it is proven to acquire no pass`
            };
            if(!grant&&hits.length&&state.permitCells.has(x))return {
                bad:`${label(cfg,x)} would be counted at ${hits.map(h=>`visit ${h.rank} of ${label(cfg,h.q)}`).join(', ')}, none of which grants \u2014 but the traveller is proven to obtain a pass there`
            };
            const byClue=state.permitOrdinals.get(x);
            if(byClue)for(const h of hits){
                const fixedN=byClue.get(h.q);
                if(fixedN!==undefined&&fixedN!==h.rank)return {
                    bad:`${label(cfg,x)} is the fixed visit ${fixedN} around ${label(cfg,h.q)}, but this route reaches it as visit ${h.rank}`
                }
                
            }
            if(record&&cfg.kind[x]!=='station'&&cfg.kind[x]!=='start'&&hits.length){
                if(grant&&!state.permitCells.has(x)){
                    state.permitCells.add(x);
                    return {
                        mark:true,grant,hits,held
                    }
                    
                }
                if(!grant&&!state.noPermitCells.has(x)&&!state.permitCells.has(x)){
                    state.noPermitCells.add(x);
                    return {
                        mark:true,grant,hits,held
                    }
                    
                }
                
            }
            if(grant){
                if(held)return {
                    bad:`a second permit is acquired at ${label(cfg,x)} before the first is spent`
                };
                held=true
            }
            if(cfg.kind[x]==='station'){
                if(!held)return {
                    bad:`gray ${label(cfg,x)} is reached while empty-handed`
                };
                held=false
            }
            return {
                held,hits,grant
            }
            
        }
        const startOut=cfg.kind.indexOf('start');
        if(startOut>=0){
            let cur=startOut,held=false,seen=new Set([cur]),counts=new Map(),startEvent=advanceFromStart(startOut,held,counts,false);
            if(startEvent.bad)return {
                tech:8,contradiction:true,text:startEvent.bad
            };
            while(true){
                const outs=neighbours(cfg,cur).filter(y=>hasArrow(state,cur,y));
                if(outs.length!==1)break;
                cur=outs[0];
                if(cur===startOut){
                    if(held)return {
                        tech:8,contradiction:true,text:`The directed loop returns to the start while still carrying a permit.`
                    };
                    break
                }
                if(seen.has(cur))break;
                seen.add(cur);
                const ev=advanceFromStart(cur,held,counts,true);
                if(ev.ambiguous)break;
                if(ev.bad)return {
                    tech:8,contradiction:true,text:`Following the directed route from the start, ${ev.bad}.`
                };
                if(ev.mark){
                    const positions=ev.hits.map(h=>`${label(cfg,h.q)} visit ${h.rank}`).join(', ');
                    return {
                        tech:7,text:`Following the confirmed directed route from the start reaches ${label(cfg,cur)} at ${positions}. It ${ev.grant?'does':'does not'} grant a permit, so mark it accordingly.`
                    }
                    
                }
                held=ev.held
            }
            if(cur!==startOut&&!neighbours(cfg,cur).some(y=>hasArrow(state,cur,y)))for(const y of neighbours(cfg,cur))if(!on(state,cur,y)&&!state.offEdges.has(key(cur,y))&&!state.offDirections.has(cur+'>'+y)){
                let z=y,h=held,walk=new Set([cur]),bad=null,branchCounts=new Map(counts);
                while(!walk.has(z)){
                    walk.add(z);
                    if(z===startOut){
                        if(h)bad='the loop would return to the start still carrying a permit';
                        break
                    }
                    const ev=advanceFromStart(z,h,branchCounts,false);
                    if(ev.ambiguous)break;
                    if(ev.bad){
                        bad=ev.bad;
                        break
                    }
                    h=ev.held;
                    const outs=neighbours(cfg,z).filter(w=>hasArrow(state,z,w));
                    if(outs.length!==1)break;
                    z=outs[0]
                }
                if(bad){
                    state.offDirections.add(cur+'>'+y);
                    let whole='';
                    if(state.offDirections.has(y+'>'+cur)){
                        state.offEdges.add(key(cur,y));
                        whole=' Both orientations are now impossible, so exclude the edge entirely.'
                    }
                    return {
                        tech:8,text:`Following the clue visit counts and current permit state from the start, continuing ${label(cfg,cur)} → ${label(cfg,y)} would mean ${bad}. That direction is impossible.${whole}`
                    }
                    
                }
                
            }
            
        }
        function visibleEventFrom(x){
            let prev=-1,cur=x,steps=0;
            while(steps++<open.length){
                if(cfg.kind[cur]==='station')return {
                    type:-1,cell:cur
                };
                if(state.permitCells.has(cur))return {
                    type:1,cell:cur
                };
                if(nearClue.has(cur)&&!state.noPermitCells.has(cur))return null;
                const next=neighbours(cfg,cur).filter(y=>y!==prev&&on(state,cur,y));
                if(next.length!==1)return null;
                prev=cur;
                cur=next[0]
            }
            return null
        }
        for(const a of open)for(const b of neighbours(cfg,a))if(a<b&&!on(state,a,b)&&!state.offEdges.has(key(a,b))){
            const ea=visibleEventFrom(a),eb=visibleEventFrom(b);
            if(!ea||!eb||ea.type!==eb.type||ea.cell===eb.cell)continue;
            state.offEdges.add(key(a,b));
            return {
                tech:9,text:`If ${label(cfg,a)}–${label(cfg,b)} joined the two confirmed strands, the next events would be ${label(cfg,ea.cell)} and ${label(cfg,eb.cell)}, both ${ea.type>0?'pass acquisitions':'gray cells'}. Exclude the edge: a ${ea.type>0?'gray cell must spend the first pass':'new pass must be obtained'} between them.`
            }
            
        }
        const start=cfg.kind.indexOf('start');
        if(start>=0)for(const first of neighbours(cfg,start))if(on(state,start,first)){
            let seq=[start,first],prev=start,cur=first,passedGrantable=false;
            while(!state.permitCells.has(cur)&&cfg.kind[cur]!=='station'){
                if(nearClue.has(cur))passedGrantable=true;
                let next=neighbours(cfg,cur).filter(x=>x!==prev&&on(state,cur,x));
                if(next.length!==1)break;
                prev=cur;
                cur=next[0];
                seq.push(cur)
            }
            let outward=state.permitCells.has(cur),inward=cfg.kind[cur]==='station'&&!passedGrantable;
            /* a cell that might still grant would change which event comes first, so the gray conclusion needs a grant-free chain; an acquisition stays first either way */if(!outward&&!inward)continue;
            let a=outward?seq[0]:seq[1],b=outward?seq[1]:seq[0];
            if(!hasArrow(state,a,b)&&!hasArrow(state,b,a)){
                state.forcedEdges.add(a+'>'+b);
                return {
                    tech:8,text:`Follow the confirmed chain from the empty-handed start to ${label(cfg,cur)}, the first ${passedGrantable?'':'possible '}event on this branch. It is ${outward?'a pass acquisition, so this branch leaves the start':'gray, so this branch must arrive back at the start'}. Therefore ${label(cfg,a)} → ${label(cfg,b)}.`
                }
                
            }
            
        }
        let countMove=globalPermitCountStep(cfg,state,options);
        if(countMove)return countMove;
        let permitMove=permitPatternStep(cfg,state,options);
        if(permitMove)return permitMove;
        // Combine the still-possible permit maps (not route solutions) and run the
        // one-bit pass inventory through the potential directed graph for each map.
        // Common permit facts and impossible directions are therefore consequences
        // of chronology alone, even while the geometric route is largely open.
        if((!options.noTrial||options.deepGhost)&&state.permitMapCases&&state.permitMapCases.length){
            const mapCap=options.noTrial&&!options.deepGhost?1500:6000;
            const narrCap=options.deep||options.deepGhost?6000:600;
            let maps=[new Set()],capped=false;
            for(const cases of state.permitMapCases){
                const next=[];
                for(const base of maps)for(const add of cases){
                    const u=new Set(base);
                    for(const x of add)u.add(x);
                    next.push(u);
                    if(next.length>mapCap){
                        capped=true;
                        break
                    }
                    
                }
                maps=next;
                if(capped)break
            }
            const target=cfg.kind.filter(x=>x==='station').length;
            if(!capped&&maps.length<=narrCap){
                maps=maps.filter(x=>x.size===target);
                const fOut=new Map(),fIn=new Map();
                for(const d of state.forcedEdges){
                    const [a,b]=d.split('>').map(Number);
                    fOut.set(a,b);
                    fIn.set(b,a)
                }
                const pArcs=[];
                for(const a of open)for(const b of neighbours(cfg,a))if(!state.offEdges.has(key(a,b))&&!state.offDirections.has(a+'>'+b)&&!hasArrow(state,b,a)&&(fOut.get(a)==null||fOut.get(a)===b)&&(fIn.get(b)==null||fIn.get(b)===a))pArcs.push([a,b]);
                const start=cfg.kind.indexOf('start'),possibleDirs=new Set(),viable=[],allPermitCells=new Set(state.permitMapCases.flatMap(x=>x.flatMap(s=>[...s])));
                for(const permits of maps){
                    const nextEvent=(x,h)=>cfg.kind[x]==='start'?(h?[]:[false]):cfg.kind[x]==='station'?(h?[false]:[]):permits.has(x)?(h?[]:[true]):[h],adj=Array.from({length:cfg.R*cfg.C*2},()=>[]),rev=Array.from({length:cfg.R*cfg.C*2},()=>[]);
                    for(const [a,b] of pArcs)for(const h of [false,true])for(const z of nextEvent(b,h)){
                        const u=a*2+(+h),v=b*2+(+z);
                        adj[u].push(v);
                        rev[v].push(u)
                    }
                    const reach=g=>{
                        const seen=new Set([start*2]),q=[start*2];
                        while(q.length){
                            const u=q.pop();
                            for(const v of g[u])if(!seen.has(v)){
                                seen.add(v);
                                q.push(v)
                            }
                            
                        }
                        return seen
                    },fw=reach(adj),bw=reach(rev);
                    if(open.some(x=>![x*2,x*2+1].some(v=>fw.has(v)&&bw.has(v))))continue;
                    viable.push(permits);
                    for(const [a,b] of pArcs)for(const h of [false,true])if(fw.has(a*2+(+h)))for(const z of nextEvent(b,h))if(bw.has(b*2+(+z)))possibleDirs.add(a+'>'+b)
                }
                if(!viable.length)return {
                    tech:8,contradiction:true,text:`No remaining permit map can carry the pass inventory around a directed cycle through every route cell.`
                };
                for(const x of allPermitCells){
                    const n=viable.filter(s=>s.has(x)).length;
                    if(n===viable.length&&!state.permitCells.has(x)){
                        state.permitCells.add(x);
                        return {
                            tech:8,text:`Whichever way the clues distribute the passes, carrying the inventory around the still-possible route always acquires one at ${label(cfg,x)} \u2014 mark it.`
                        }
                        
                    }
                    if(n===0&&!state.noPermitCells.has(x)&&cfg.kind[x]!=='station'&&cfg.kind[x]!=='start'){
                        state.noPermitCells.add(x);
                        return {
                            tech:8,text:`No way of distributing the passes lets the inventory be carried around the route with an acquisition at ${label(cfg,x)} \u2014 it acquires nothing.`
                        }
                        
                    }
                    
                }
                for(const [a,b] of pArcs)if(!possibleDirs.has(a+'>'+b)&&!state.offDirections.has(a+'>'+b)){
                    state.offDirections.add(a+'>'+b);
                    return {
                        tech:8,text:`However the clues distribute the passes, the inventory can never be carried through ${label(cfg,a)} → ${label(cfg,b)} on a loop through the start. Mark that direction impossible.`
                    }
                    
                }
                
            }
            
        }
        // ===== 3. directional logic =====
        for(const a of open)for(const b of neighbours(cfg,a))if(a<b&&!state.offEdges.has(key(a,b))&&state.offDirections.has(a+'>'+b)&&state.offDirections.has(b+'>'+a)){
            state.offEdges.add(key(a,b));
            return {
                tech:2,text:`Both directions of ${label(cfg,a)}–${label(cfg,b)} are impossible, so the route cannot use that edge.`
            }
            
        }
        // Directed degree: every route cell has one outgoing and one incoming arc.
        for(const d of [...state.forcedEdges]){
            const [a,b]=d.split('>').map(Number);
            for(const y of neighbours(cfg,a))if(y!==b&&!state.offDirections.has(a+'>'+y)){
                state.offDirections.add(a+'>'+y);
                return {
                    tech:2,text:`${label(cfg,a)} already has its outgoing arrow to ${label(cfg,b)}, so ${label(cfg,a)} → ${label(cfg,y)} is impossible.`
                }
                
            }
            for(const y of neighbours(cfg,b))if(y!==a&&!state.offDirections.has(y+'>'+b)){
                state.offDirections.add(y+'>'+b);
                return {
                    tech:2,text:`${label(cfg,b)} already has its incoming arrow from ${label(cfg,a)}, so ${label(cfg,y)} → ${label(cfg,b)} is impossible.`
                }
                
            }
            
        }
        for(const x of open){
            const ns=neighbours(cfg,x);
            for(const y of ns)if(on(state,x,y)){
                if(state.offDirections.has(x+'>'+y)&&!hasArrow(state,y,x)&&!hasArrow(state,x,y)){
                    state.forcedEdges.add(y+'>'+x);
                    return {
                        tech:2,text:`The line ${label(cfg,x)}–${label(cfg,y)} cannot run ${label(cfg,x)} → ${label(cfg,y)}, so it must run ${label(cfg,y)} → ${label(cfg,x)}.`
                    }
                    
                }
                if(state.offDirections.has(y+'>'+x)&&!hasArrow(state,x,y)&&!hasArrow(state,y,x)){
                    state.forcedEdges.add(x+'>'+y);
                    return {
                        tech:2,text:`The line ${label(cfg,x)}–${label(cfg,y)} cannot run ${label(cfg,y)} → ${label(cfg,x)}, so it must run ${label(cfg,x)} → ${label(cfg,y)}.`
                    }
                    
                }
                
            }
            const outgoing=ns.filter(y=>!state.offEdges.has(key(x,y))&&!state.offDirections.has(x+'>'+y)&&!hasArrow(state,y,x)),incoming=ns.filter(y=>!state.offEdges.has(key(x,y))&&!state.offDirections.has(y+'>'+x)&&!hasArrow(state,x,y));
            if(!outgoing.length||!incoming.length)return {
                tech:2,contradiction:true,text:`${label(cfg,x)} has no possible ${!outgoing.length?'outgoing':'incoming'} direction.`
            };
            if(outgoing.length===1&&!hasArrow(state,x,outgoing[0])){
                state.forcedEdges.add(x+'>'+outgoing[0]);
                return {
                    tech:2,text:`Every other outgoing direction from ${label(cfg,x)} is impossible, so ${label(cfg,x)} → ${label(cfg,outgoing[0])}.`
                }
                
            }
            if(incoming.length===1&&!hasArrow(state,incoming[0],x)){
                state.forcedEdges.add(incoming[0]+'>'+x);
                return {
                    tech:2,text:`Every other incoming direction to ${label(cfg,x)} is impossible, so ${label(cfg,incoming[0])} → ${label(cfg,x)}.`
                }
                
            }
            
        }
        // A directed edge along the outer boundary fixes whether the loop interior is
        // on its left or right. The unbounded side of that edge is necessarily the
        // exterior, so every boundary edge shares the same orientation convention.
        let insideLeft=null;
        function boundarySense(a,b){
            const ar=a/cfg.C|0,ac=a%cfg.C,br=b/cfg.C|0,bc=b%cfg.C;
            if(ar===0&&br===0)return bc<ac;
            if(ar===cfg.R-1&&br===cfg.R-1)return bc>ac;
            if(ac===0&&bc===0)return br>ar;
            if(ac===cfg.C-1&&bc===cfg.C-1)return br<ar;
            return null
        }
        for(const d of state.forcedEdges){
            const [a,b]=d.split('>').map(Number),s=boundarySense(a,b);
            if(s==null)continue;
            if(insideLeft!=null&&insideLeft!==s)return {
                tech:16,contradiction:true,text:`The directed boundary segments put the grid interior on inconsistent sides of the loop.`
            };
            insideLeft=s
        }
        if(insideLeft!=null){
            const pairs=[];
            for(let c=0;c+1<cfg.C;c++){
                pairs.push([c,c+1]);
                pairs.push([(cfg.R-1)*cfg.C+c,(cfg.R-1)*cfg.C+c+1])
            }
            for(let r=0;r+1<cfg.R;r++){
                pairs.push([r*cfg.C,(r+1)*cfg.C]);
                pairs.push([r*cfg.C+cfg.C-1,(r+1)*cfg.C+cfg.C-1])
            }
            for(const [a,b] of pairs){
                if(cfg.kind[a]==='clue'||cfg.kind[b]==='clue'||state.offEdges.has(key(a,b)))continue;
                const right=boundarySense(a,b),bad=(right===insideLeft?b+'>'+a:a+'>'+b);
                if(!state.offDirections.has(bad)&&!hasArrow(state,...bad.split('>').map(Number))){
                    state.offDirections.add(bad);
                    const [u,v]=bad.split('>').map(Number);
                    return {
                        tech:16,text:`The directed boundary fixes the loop’s interior side. Therefore boundary travel ${label(cfg,u)} → ${label(cfg,v)} would put the exterior on the wrong side, so that direction is impossible.`
                    }
                    
                }
                
            }
            
        }
        // Once both undirected segments of a cell are known, propagate an arrow.
        for(const x of open){
            let ns=neighbours(cfg,x).filter(y=>on(state,x,y));
            if(ns.length!==2)continue;
            let incoming=ns.filter(y=>hasArrow(state,y,x)),outgoing=ns.filter(y=>hasArrow(state,x,y));
            if(incoming.length===1&&outgoing.length===0){
                let y=ns.find(y=>!hasArrow(state,y,x));
                state.forcedEdges.add(x+'>'+y);
                return {
                    tech:2,text:`${label(cfg,x)} already has an incoming arrow from ${label(cfg,incoming[0])}. A directed loop has one way in and one way out, so ${label(cfg,x)} → ${label(cfg,y)}.`
                }
                
            }
            if(outgoing.length===1&&incoming.length===0){
                let y=ns.find(y=>!hasArrow(state,x,y));
                state.forcedEdges.add(y+'>'+x);
                return {
                    tech:2,text:`${label(cfg,x)} already points out to ${label(cfg,outgoing[0])}. Its other segment must enter: ${label(cfg,y)} → ${label(cfg,x)}.`
                }
                
            }
            
        }
        // Adjacent confirmed parallel strands have opposite orientation.
        for(const d of state.forcedEdges){
            let [a,b]=d.split('>').map(Number),ar=(a/cfg.C)|0,ac=a%cfg.C,br=(b/cfg.C)|0,bc=b%cfg.C,shifts=ar===br?[[-1,0],[1,0]]:[[0,-1],[0,1]];
            for(const [dr,dc] of shifts){
                let rr=ar+dr,cc=ac+dc,rr2=br+dr,cc2=bc+dc;
                if(rr<0||rr2<0||cc<0||cc2<0||rr>=cfg.R||rr2>=cfg.R||cc>=cfg.C||cc2>=cfg.C)continue;
                let aa=rr*cfg.C+cc,bb=rr2*cfg.C+cc2;
                if(cfg.kind[aa]==='clue'||cfg.kind[bb]==='clue'||state.offEdges.has(key(aa,bb)))continue;
                if(!state.offDirections.has(aa+'>'+bb)&&!hasArrow(state,bb,aa)){
                    state.offDirections.add(aa+'>'+bb);
                    return {
                        tech:4,text:`${label(cfg,a)} → ${label(cfg,b)} runs directly beside the parallel candidate ${label(cfg,aa)}–${label(cfg,bb)}. Two adjacent strands of one simple loop cannot run the same way, so ${label(cfg,aa)} → ${label(cfg,bb)} is impossible.`
                    }
                    
                }
                if(on(state,aa,bb)&&!hasArrow(state,aa,bb)&&!hasArrow(state,bb,aa)){
                    state.forcedEdges.add(bb+'>'+aa);
                    return {
                        tech:4,text:`${label(cfg,a)} → ${label(cfg,b)} runs parallel and directly beside ${label(cfg,aa)}–${label(cfg,bb)}. A simple directed loop uses opposite orientations there, so ${label(cfg,bb)} → ${label(cfg,aa)}.`
                    }
                    
                }
                
            }
            
        }
        // Directed connectivity is the arrow analogue of an undirected bridge.  A
        // directed Hamiltonian loop must remain strongly connected.  If deleting one
        // still-possible transition destroys that reachability, every completion
        // must use the transition (and therefore its underlying segment).
        const forcedOut=new Map(),forcedIn=new Map();
        for(const d of state.forcedEdges){
            const [a,b]=d.split('>').map(Number);
            forcedOut.set(a,b);
            forcedIn.set(b,a)
        }
        const arcs=[];
        for(const a of open)for(const b of neighbours(cfg,a))if(!state.offEdges.has(key(a,b))&&!state.offDirections.has(a+'>'+b)&&!hasArrow(state,b,a)&&(forcedOut.get(a)==null||forcedOut.get(a)===b)&&(forcedIn.get(b)==null||forcedIn.get(b)===a))arcs.push([a,b]);
        // Pass-state reachability over the potential directed graph.  This carries
        // only the one-bit inventory a human tracks (holding a permit or not), and
        // deliberately lets every unresolved clue-neighbour choose either status.
        // A direction that lies on no inventory-consistent cycle through the start
        // can never belong to the A38 loop.
        function eventStates(x,held){
            if(cfg.kind[x]==='start')return held?[]:[false];
            if(cfg.kind[x]==='station')return held?[false]:[];
            if(state.permitCells.has(x))return held?[]:[true];
            if(state.noPermitCells.has(x)||!nearClue.has(x))return [held];
            return held?[true]:[false,true]
        }
        const stateAdj=Array.from({length:cfg.R*cfg.C*2},()=>[]),stateRev=Array.from({length:cfg.R*cfg.C*2},()=>[]);
        for(const [a,b] of arcs)for(const held of [false,true])for(const next of eventStates(b,held)){
            const u=a*2+(+held),v=b*2+(+next);
            stateAdj[u].push(v);
            stateRev[v].push(u)
        }
        const startState=cfg.kind.indexOf('start')*2;
        function stateReach(graph){
            const seen=new Set([startState]),q=[startState];
            while(q.length){
                const u=q.pop();
                for(const v of graph[u])if(!seen.has(v)){
                    seen.add(v);
                    q.push(v)
                }
                
            }
            return seen
        }
        const fromStart=stateReach(stateAdj),toStart=stateReach(stateRev);
        for(const x of open)if(![x*2,x*2+1].some(v=>fromStart.has(v)&&toStart.has(v)))return {
            tech:8,contradiction:true,text:`No pass-state-consistent directed cycle through the start can include ${label(cfg,x)}.`
        };
        for(const [a,b] of arcs)if(!hasArrow(state,a,b)){
            let viable=false;
            for(const held of [false,true])if(fromStart.has(a*2+(+held)))for(const next of eventStates(b,held))if(toStart.has(b*2+(+next)))viable=true;
            if(!viable){
                state.offDirections.add(a+'>'+b);
                return {
                    tech:8,text:`Track whether the traveller is holding a permit through every still-possible directed corridor. No inventory-consistent cycle through the start can use ${label(cfg,a)} → ${label(cfg,b)}, so that direction is impossible.`
                }
                
            }
            
        }
        function stronglyConnected(skip=-1){
            const walk=reverse=>{
                const seen=new Set([open[0]]),q=[open[0]];
                while(q.length){
                    const u=q.pop();
                    for(let i=0;i<arcs.length;i++)if(i!==skip){
                        const a=reverse?arcs[i][1]:arcs[i][0],b=reverse?arcs[i][0]:arcs[i][1];
                        if(a===u&&!seen.has(b)){
                            seen.add(b);
                            q.push(b)
                        }
                        
                    }
                    
                }
                return seen.size===open.length
            };
            return walk(false)&&walk(true)
        }
        if(!stronglyConnected())return {
            tech:10,contradiction:true,text:`The remaining possible directions are not strongly connected, so they cannot contain one directed loop through every route cell.`
        };
        if(!options.noTrial||options.deepGhost)for(let i=0;i<arcs.length;i++){
            const [a,b]=arcs[i];
            if(hasArrow(state,a,b))continue;
            if(!stronglyConnected(i)){
                state.forcedEdges.add(a+'>'+b);
                addLine(state,a,b);
                return {
                    tech:10,text:`Without ${label(cfg,a)} → ${label(cfg,b)}, the remaining possible arrows are no longer strongly connected. A single directed loop must use that transition.`
                }
                
            }
            
        }
        // ===== heavier region scans (standard loop, second wave) =====
        // Two-edge cuts: remove one possible edge temporarily, then find bridges in
        // what remains. The removed edge and any resulting bridge are the only two
        // exits of some region, so a single loop must use both.
        const possible=[];
        for(const x of open)for(const y of neighbours(cfg,x))if(x<y&&!state.offEdges.has(key(x,y)))possible.push([x,y]);
        const adjIds=Array.from({length:cfg.R*cfg.C},()=>[]);
        possible.forEach(([a,b],i)=>{adjIds[a].push([b,i]);
            adjIds[b].push([a,i])});
        if(!options.noTrial)for(let skip=0;skip<possible.length;skip++){
            const tin=new Int32Array(cfg.R*cfg.C);
            tin.fill(-1);
            const low=new Int32Array(cfg.R*cfg.C);
            let timer=0,bridges=[];
            function dfs(u,parentEdge){
                tin[u]=low[u]=timer++;
                for(const [v,ei] of adjIds[u]){
                    if(ei===skip||ei===parentEdge)continue;
                    if(tin[v]>=0)low[u]=Math.min(low[u],tin[v]);
                    else{
                        dfs(v,ei);
                        low[u]=Math.min(low[u],low[v]);
                        if(low[v]>tin[u])bridges.push(ei)
                    }
                    
                }
                
            }
            dfs(open[0],-1);
            if(open.some(x=>tin[x]<0))continue;
            for(const bi of bridges)if(bi!==skip){
                const pair=[possible[skip],possible[bi]],unknown=pair.find(([a,b])=>!on(state,a,b));
                if(!unknown)continue;
                const [a,b]=unknown,[u,v]=pair[0]===unknown?pair[1]:pair[0];
                addLine(state,a,b);
                return {
                    tech:10,text:`The remaining route graph has a region whose only two exits are ${label(cfg,a)}–${label(cfg,b)} and ${label(cfg,u)}–${label(cfg,v)}. A single loop crosses that cut twice, so ${label(cfg,a)}–${label(cfg,b)} is a line.`
                }
                
            }
            
        }
        // Rectangular cut parity is the loop analogue of cell degree. It catches
        // two-exit pockets larger than one cell without searching for a route.
        if(!options.noTrial){
            const rects=[];
            for(let r1=0;r1<cfg.R;r1++)for(let r2=r1;r2<cfg.R;r2++)for(let c1=0;c1<cfg.C;c1++)for(let c2=c1;c2<cfg.C;c2++)rects.push([r1,r2,c1,c2]);
            rects.sort((a,b)=>(a[1]-a[0]+1)*(a[3]-a[2]+1)-(b[1]-b[0]+1)*(b[3]-b[2]+1));
            for(const [r1,r2,c1,c2] of rects){
                const inside=x=>{
                    const r=x/cfg.C|0,c=x%cfg.C;
                    return r>=r1&&r<=r2&&c>=c1&&c<=c2
                },members=open.filter(inside);
                if(!members.length||members.length===open.length)continue;
                const boundary=[];
                for(const a of members)for(const b of neighbours(cfg,a))if(!inside(b)&&!boundary.some(([u,v])=>key(u,v)===key(a,b)))boundary.push([a,b]);
                const possible=boundary.filter(([a,b])=>!state.offEdges.has(key(a,b))),used=possible.filter(([a,b])=>on(state,a,b)),unknown=possible.filter(([a,b])=>!on(state,a,b));
                if(possible.length<2)return {
                    tech:14,contradiction:true,text:`The region r${r1+1}–r${r2+1}, c${c1+1}–c${c2+1} has fewer than two possible loop crossings.`
                };
                if(possible.length===2&&unknown.length){
                    const [a,b]=unknown[0];
                    addLine(state,a,b);
                    return {
                        tech:14,text:`The region r${r1+1}–r${r2+1}, c${c1+1}–c${c2+1} has only two possible boundary crossings. A single loop must use both, so ${label(cfg,a)}–${label(cfg,b)} is a line.`
                    }
                    
                }
                if(unknown.length===1){
                    const [a,b]=unknown[0];
                    if(used.length%2){
                        addLine(state,a,b);
                        return {
                            tech:14,text:`The loop crosses the boundary of r${r1+1}–r${r2+1}, c${c1+1}–c${c2+1} an even number of times. With ${used.length} crossing${used.length===1?'':'s'} fixed, ${label(cfg,a)}–${label(cfg,b)} must also cross.`
                        }
                        
                    }
                    state.offEdges.add(key(a,b));
                    return {
                        tech:14,text:`The loop crosses every region boundary evenly. The region r${r1+1}–r${r2+1}, c${c1+1}–c${c2+1} already has ${used.length} fixed crossings, so exclude ${label(cfg,a)}–${label(cfg,b)}.`
                    }
                    
                }
                
            }
            
        }
        // Checkerboard balance strengthens even boundary parity.  Every internal
        // route segment joins opposite colours and cancels.  Consequently a region
        // with B black and W white route cells needs exactly 2(B-W) more used
        // boundary edges incident with black cells than with white cells.
        if(!options.noTrial)for(let r1=0;r1<cfg.R;r1++)for(let r2=r1;r2<cfg.R;r2++)for(let c1=0;c1<cfg.C;c1++)for(let c2=c1;c2<cfg.C;c2++){
            const inside=x=>{
                const r=x/cfg.C|0,c=x%cfg.C;
                return r>=r1&&r<=r2&&c>=c1&&c<=c2
            },members=open.filter(inside);
            if(!members.length||members.length===open.length)continue;
            let bal=0;
            for(const x of members)bal+=(((x/cfg.C|0)+x%cfg.C)&1)?-1:1;
            const boundary=[];
            for(const a of members)for(const b of neighbours(cfg,a))if(!inside(b)&&!boundary.some(([u,v])=>key(u,v)===key(a,b)))boundary.push([a,b]);
            const possible=boundary.filter(([a,b])=>!state.offEdges.has(key(a,b))),used=possible.filter(([a,b])=>on(state,a,b)),unknown=possible.filter(([a,b])=>!on(state,a,b));
            let usedDiff=0;
            for(const [a] of used)usedDiff+=(((a/cfg.C|0)+a%cfg.C)&1)?-1:1;
            const black=unknown.filter(([a])=>!(((a/cfg.C|0)+a%cfg.C)&1)),white=unknown.filter(([a])=>((a/cfg.C|0)+a%cfg.C)&1),need=2*bal-usedDiff;
            if(need>black.length||need< -white.length)return {
                tech:14,contradiction:true,text:`The checkerboard boundary balance of r${r1+1}–r${r2+1}, c${c1+1}–c${c2+1} cannot be met.`
            };
            for(const [a,b] of unknown){
                const sign=(((a/cfg.C|0)+a%cfg.C)&1)?-1:1,ub=black.length-(sign===1),uw=white.length-(sign===-1),without=need>=-uw&&need<=ub,withNeed=need-sign,withEdge=withNeed>=-uw&&withNeed<=ub;
                if(!without&&withEdge){
                    addLine(state,a,b);
                    return {
                        tech:14,text:`Checkerboard boundary balance for r${r1+1}–r${r2+1}, c${c1+1}–c${c2+1} requires ${label(cfg,a)}–${label(cfg,b)}: without it, the black/white crossing difference cannot reach ${2*bal}.`
                    }
                    
                }
                if(without&&!withEdge){
                    state.offEdges.add(key(a,b));
                    return {
                        tech:14,text:`Checkerboard boundary balance for r${r1+1}–r${r2+1}, c${c1+1}–c${c2+1} excludes ${label(cfg,a)}–${label(cfg,b)}: using it would make the required black/white crossing difference ${2*bal} impossible.`
                    }
                    
                }
                
            }
            
        }
        // ===== 4. chains / trials / bifurcations =====
        if(options.noTrial&&!options.quickTrial)return {
            done:true,text:'No direct deduction in this branch.'
        };
        const big=cfg.R*cfg.C>=100;
        const tb=options.trialBudget||(big?20000:6000);
        const advancedDeadline=Date.now()+tb;
        // Single-clue cyclic analysis: each case fixes one geometric rotation and
        // orientation, then uses only the direct rules above. This is the A38
        // analogue of single-line analysis in Japanese Sums.
        if(!options.quickTrial)
        for(const qs of Object.keys(cfg.clues)){
            if(Date.now()>advancedDeadline)break;
            const q=+qs,m=ringCells(cfg,q).length,current=state.patternRestrictions.get(q)||new Set(Array.from({length:m},(_,i)=>['1:'+i,'-1:'+i]).flat());
            if(current.size<=1)continue;
            const survivors=[],states=[];
            for(const sig of current){
                if(Date.now()>advancedDeadline)break;
                const c=propagatedPatternCase(cfg,state,q,sig,false,options.deep);
                if(!c.bad){
                    survivors.push(sig);
                    states.push(c.out)
                }
                
            }
            if(Date.now()>advancedDeadline)break;
            if(!survivors.length)return {
                tech:6,contradiction:true,text:`Every clockwise/counterclockwise rotation around ${label(cfg,q)} contradicts the current route and pass marks.`
            };
            if(survivors.length<current.size){
                const removed=[...current].find(x=>!survivors.includes(x));
                state.patternRestrictions.set(q,new Set(survivors));
                return {
                    tech:6,text:`Fix the cyclic visit order around ${label(cfg,q)} to rotation ${removed} and follow the direct human rules. It reaches a contradiction, so that rotation is eliminated; ${survivors.length} remain.`
                }
                
            }
            const shared=addCommonConclusion(state,states);
            if(shared){
                let where=shared.x;
                if(shared.name==='forcedEdges'||shared.name==='offDirections'){
                    let [u,v]=where.split('>').map(Number);
                    where=`${label(cfg,u)} → ${label(cfg,v)}`
                }else if(shared.name==='lineEdges'||shared.name==='offEdges'){
                    let [u,v]=where.split('-').map(Number);
                    where=`${label(cfg,u)}–${label(cfg,v)}`
                }else where=label(cfg,+where);
                const extra=shared.count>1?` and ${shared.count-1} further shared mark${shared.count===2?'':'s'} (${shared.vis} visible in total, the rest direction bookkeeping)`:'';
                return {
                    tech:6,text:`Check every remaining cyclic rotation around ${label(cfg,q)}. All ${survivors.length} cases force the ${shared.target} at ${where}${extra} \u2014 every mark the cases agree on is placed without choosing a rotation.`
                }
                
            }
            
        }
        for(const [a,b] of candidates){
            let k=key(a,b),whyOn=localContradiction(cfg,state,k,true);
            if(whyOn){
                state.offEdges.add(k);
                return {
                    tech:11,text:`Suppose ${label(cfg,a)}–${label(cfg,b)} were a line. Local degree/connectivity propagation shows ${whyOn}. Therefore that edge is excluded.`
                }
                
            }
            let whyOff=localContradiction(cfg,state,k,false);
            if(whyOff){
                addLine(state,a,b);
                return {
                    tech:11,text:`Suppose ${label(cfg,a)}–${label(cfg,b)} were excluded. Local degree/connectivity propagation shows ${whyOff}. Therefore it is a line.`
                }
                
            }
            
        }
        if(options.quickTrial)return {
            done:true,text:'No direct or one-edge deduction in this branch.'
        };
        // A bounded, foreground-only two-case comparison. It calls the same visible
        // human rules as Take step and never invokes the exact solver.
        const trialNearClue=new Set();
        for(const qs of Object.keys(cfg.clues))for(const x of ringCells(cfg,+qs))trialNearClue.add(x);
        const permitCases=[...trialNearClue].filter(x=>cfg.kind[x]!=='station'&&cfg.kind[x]!=='start'&&!state.permitCells.has(x)&&!state.noPermitCells.has(x)).sort((a,b)=>{const score=x=>Object.keys(cfg.clues).filter(q=>ringCells(cfg,+q).includes(x)).length*20+(neighbours(cfg,x).some(y=>on(state,x,y))?5:0)+neighbours(cfg,x).filter(y=>state.offEdges.has(key(x,y))).length;
            return score(b)-score(a)});
        const scored=candidates.map(e=>{const [a,b]=e;
            let s=(on(state,a,b)?20:0)+(state.permitCells.has(a)||state.permitCells.has(b)?8:0)+(cfg.kind[a]==='station'||cfg.kind[b]==='station'?8:0)+(trialNearClue.has(a)?3:0)+(trialNearClue.has(b)?3:0);
            for(const x of [a,b])if(neighbours(cfg,x).some(y=>on(state,x,y)))s+=4;
            return {
                e,s
            }
            }).sort((x,y)=>y.s-x.s);
        const caseDeadline=Date.now()+2*tb;
        const directed=[];
        for(const a of open)for(const b of neighbours(cfg,a))if(!state.offEdges.has(key(a,b))&&!state.offDirections.has(a+'>'+b)&&!hasArrow(state,a,b)&&!hasArrow(state,b,a)){
            let s=(on(state,a,b)?18:0)+(state.permitCells.has(a)||cfg.kind[a]==='station'?7:0)+(state.permitCells.has(b)||cfg.kind[b]==='station'?7:0)+(trialNearClue.has(a)?3:0)+(trialNearClue.has(b)?3:0);
            s+=neighbours(cfg,a).filter(x=>state.offDirections.has(a+'>'+x)||hasArrow(state,x,a)).length*3;
            s+=neighbours(cfg,b).filter(x=>state.offDirections.has(x+'>'+b)||hasArrow(state,b,x)).length*3;
            directed.push({a,b,s})
        }
        directed.sort((x,y)=>y.s-x.s);
        for(const {a,b} of directed){
            if(Date.now()>caseDeadline)break;
            const yes=propagatedDirectionCase(cfg,state,a,b,true,false,options.deep),no=propagatedDirectionCase(cfg,state,a,b,false,false,options.deep);
            if(yes.bad&&no.bad)return {
                tech:11,contradiction:true,text:`Both direction choices for ${label(cfg,a)} → ${label(cfg,b)} contradict the current human marks.`
            };
            if(yes.bad){
                state.offDirections.add(a+'>'+b);
                return {
                    tech:11,chain:yes.reasons,chainIntro:`Suppose the route ran ${label(cfg,a)} → ${label(cfg,b)}. Then:`,chainOutro:`So that direction is impossible.`,text:`Assume ${label(cfg,a)} → ${label(cfg,b)} and follow the human rules. After ${yes.reasons.length} consequence${yes.reasons.length===1?'':'s'}, ${yes.bad} Therefore that direction is impossible.`
                }
                
            }
            if(no.bad){
                state.forcedEdges.add(a+'>'+b);
                state.lineEdges.add(key(a,b));
                return {
                    tech:11,chain:no.reasons,chainIntro:`Suppose ${label(cfg,a)} → ${label(cfg,b)} were impossible. Then:`,chainOutro:`So the route must run that way.`,text:`Exclude ${label(cfg,a)} → ${label(cfg,b)} and follow the human rules. After ${no.reasons.length} consequence${no.reasons.length===1?'':'s'}, ${no.bad} Therefore the directed segment is forced.`
                }
                
            }
            if(!yes.capped&&!no.capped){
                const shared=addSharedConclusion(state,yes.out,no.out);
                if(shared){
                    let where=shared.x;
                    if(shared.name==='forcedEdges'||shared.name==='offDirections'){
                        let [u,v]=where.split('>').map(Number);
                        where=`${label(cfg,u)} → ${label(cfg,v)}`
                    }else if(shared.name==='lineEdges'||shared.name==='offEdges'){
                        let [u,v]=where.split('-').map(Number);
                        where=`${label(cfg,u)}–${label(cfg,v)}`
                    }else where=label(cfg,+where);
                    return {
                        tech:12,cases:[{intro:`Case 1 — ${label(cfg,a)} → ${label(cfg,b)} is used:`,chain:yes.reasons},{intro:`Case 2 — ${label(cfg,a)} → ${label(cfg,b)} is impossible:`,chain:no.reasons}],text:`Compare using and excluding ${label(cfg,a)} → ${label(cfg,b)}. Both human-rule chains share ${shared.count} consequence${shared.count===1?'':'s'}; mark them together, beginning with the ${shared.target} at ${where}.`
                    }
                    
                }
                
            }
            
        }
        for(const {e:[a,b]} of scored){
            if(Date.now()>caseDeadline)break;
            const k=key(a,b),yes=propagatedCase(cfg,state,k,true,false,options.deep),no=propagatedCase(cfg,state,k,false,false,options.deep);
            if(yes.bad&&no.bad)return {
                tech:11,contradiction:true,text:`Both choices for ${label(cfg,a)}–${label(cfg,b)} contradict the current human marks.`
            };
            if(yes.bad){
                state.offEdges.add(k);
                return {
                    tech:11,chain:yes.reasons,chainIntro:`Suppose ${label(cfg,a)}–${label(cfg,b)} were a line. Then:`,chainOutro:`So ${label(cfg,a)}–${label(cfg,b)} is excluded.`,text:`Assume ${label(cfg,a)}–${label(cfg,b)} is a line and follow the human rules. After ${yes.reasons.length} consequence${yes.reasons.length===1?'':'s'}, ${yes.bad} Therefore the edge is excluded.`
                }
                
            }
            if(no.bad){
                addLine(state,a,b);
                return {
                    tech:11,chain:no.reasons,chainIntro:`Suppose ${label(cfg,a)}–${label(cfg,b)} were excluded. Then:`,chainOutro:`So ${label(cfg,a)}–${label(cfg,b)} is a line.`,text:`Assume ${label(cfg,a)}–${label(cfg,b)} is excluded and follow the human rules. After ${no.reasons.length} consequence${no.reasons.length===1?'':'s'}, ${no.bad} Therefore the edge is a line.`
                }
                
            }
            if(!yes.capped&&!no.capped){
                const shared=addSharedConclusion(state,yes.out,no.out);
                if(shared){
                    let what=shared.target,where=shared.x;
                    if(shared.name==='forcedEdges'||shared.name==='offDirections'){
                        let [u,v]=where.split('>').map(Number);
                        where=`${label(cfg,u)} → ${label(cfg,v)}`
                    }else if(shared.name==='lineEdges'||shared.name==='offEdges'){
                        let [u,v]=where.split('-').map(Number);
                        where=`${label(cfg,u)}–${label(cfg,v)}`
                    }else where=label(cfg,+where);
                    return {
                        tech:12,cases:[{intro:`Case 1 — ${label(cfg,a)}–${label(cfg,b)} is a line:`,chain:yes.reasons},{intro:`Case 2 — ${label(cfg,a)}–${label(cfg,b)} is excluded:`,chain:no.reasons}],text:`Compare both cases for ${label(cfg,a)}–${label(cfg,b)}. Both human-rule chains force the ${what} at ${where}, so mark it without choosing either case.`
                    }
                    
                }
                
            }
            
        }
        for(const x of permitCases){
            if(Date.now()>caseDeadline)break;
            const yes=propagatedPermitCase(cfg,state,x,true,false,options.deep),no=propagatedPermitCase(cfg,state,x,false,false,options.deep);
            if(yes.bad&&no.bad)return {
                tech:5,contradiction:true,text:`Both permit states for ${label(cfg,x)} contradict the cyclic clues and current route.`
            };
            if(yes.bad){
                state.noPermitCells.add(x);
                return {
                    tech:5,chain:yes.reasons,chainIntro:`Suppose ${label(cfg,x)} granted a pass. Then:`,chainOutro:`So ${label(cfg,x)} does not grant a pass.`,text:`Assume ${label(cfg,x)} grants a pass and follow the cyclic-order and route rules. After ${yes.reasons.length} consequence${yes.reasons.length===1?'':'s'}, ${yes.bad} Therefore it cannot grant a pass.`
                }
                
            }
            if(no.bad){
                state.permitCells.add(x);
                return {
                    tech:5,chain:no.reasons,chainIntro:`Suppose ${label(cfg,x)} did not grant a pass. Then:`,chainOutro:`So the traveller obtains a pass at ${label(cfg,x)}.`,text:`Assume ${label(cfg,x)} does not grant a pass and follow the cyclic-order and route rules. After ${no.reasons.length} consequence${no.reasons.length===1?'':'s'}, ${no.bad} Therefore the traveller obtains a pass there.`
                }
                
            }
            if(!yes.capped&&!no.capped){
                const shared=addSharedConclusion(state,yes.out,no.out);
                if(shared){
                    let what=shared.target,where=shared.x;
                    if(shared.name==='forcedEdges'||shared.name==='offDirections'){
                        let [u,v]=where.split('>').map(Number);
                        where=`${label(cfg,u)} → ${label(cfg,v)}`
                    }else if(shared.name==='lineEdges'||shared.name==='offEdges'){
                        let [u,v]=where.split('-').map(Number);
                        where=`${label(cfg,u)}–${label(cfg,v)}`
                    }else where=label(cfg,+where);
                    return {
                        tech:12,cases:[{intro:`Case 1 — ${label(cfg,x)} grants a pass:`,chain:yes.reasons},{intro:`Case 2 — ${label(cfg,x)} does not grant a pass:`,chain:no.reasons}],text:`Compare the cases where ${label(cfg,x)} does and does not grant a pass. Both human-rule chains force the ${what} at ${where}, so mark it without choosing the permit case.`
                    }
                    
                }
                
            }
            
        }
        // Full-ladder tier, like the existing U-Bahn/Japanese Sums trials: allow a
        // one-edge local contradiction inside each narrated ghost, but no recursion.
        const fullDeadline=Date.now()+2*tb;
        for(const x of permitCases){
            if(Date.now()>fullDeadline)break;
            const yes=propagatedPermitCase(cfg,state,x,true,true,options.deep);
            if(yes.bad){
                state.noPermitCells.add(x);
                return {
                    tech:15,chain:yes.reasons,chainIntro:`Suppose ${label(cfg,x)} granted a pass. Then:`,chainOutro:`So ${label(cfg,x)} does not grant a pass.`,text:`The full human ladder refutes a pass at ${label(cfg,x)} after ${yes.reasons.length} narrated steps.`
                }
                
            }
            const no=propagatedPermitCase(cfg,state,x,false,true,options.deep);
            if(no.bad){
                state.permitCells.add(x);
                return {
                    tech:15,chain:no.reasons,chainIntro:`Suppose ${label(cfg,x)} did not grant a pass. Then:`,chainOutro:`So ${label(cfg,x)} grants a pass.`,text:`The full human ladder forces a pass at ${label(cfg,x)} after ${no.reasons.length} narrated steps.`
                }
                
            }
            if(!yes.capped&&!no.capped){
                const shared=addSharedConclusion(state,yes.out,no.out);
                if(shared){
                    let where=shared.x;
                    if(shared.name==='forcedEdges'||shared.name==='offDirections'){
                        let [u,v]=where.split('>').map(Number);
                        where=`${label(cfg,u)} → ${label(cfg,v)}`
                    }else if(shared.name==='lineEdges'||shared.name==='offEdges'){
                        let [u,v]=where.split('-').map(Number);
                        where=`${label(cfg,u)}–${label(cfg,v)}`
                    }else where=label(cfg,+where);
                    return {
                        tech:12,cases:[{intro:`Case 1 — ${label(cfg,x)} grants a pass:`,chain:yes.reasons},{intro:`Case 2 — ${label(cfg,x)} does not grant a pass:`,chain:no.reasons}],text:`Follow the full human ladder in both permit cases for ${label(cfg,x)}. Both force the ${shared.target} at ${where}, so mark it.`
                    }
                    
                }
                
            }
            
        }
        for(const {e:[a,b]} of scored){
            if(Date.now()>fullDeadline)break;
            const k=key(a,b),yes=propagatedCase(cfg,state,k,true,true,options.deep);
            if(yes.bad){
                state.offEdges.add(k);
                return {
                    tech:15,chain:yes.reasons,chainIntro:`Suppose ${label(cfg,a)}–${label(cfg,b)} were a line. Then:`,chainOutro:`So ${label(cfg,a)}–${label(cfg,b)} is excluded.`,text:`The full human ladder refutes ${label(cfg,a)}–${label(cfg,b)} as a line after ${yes.reasons.length} narrated steps.`
                }
                
            }
            const no=propagatedCase(cfg,state,k,false,true,options.deep);
            if(no.bad){
                addLine(state,a,b);
                return {
                    tech:15,chain:no.reasons,chainIntro:`Suppose ${label(cfg,a)}–${label(cfg,b)} were excluded. Then:`,chainOutro:`So ${label(cfg,a)}–${label(cfg,b)} is a line.`,text:`The full human ladder refutes excluding ${label(cfg,a)}–${label(cfg,b)} after ${no.reasons.length} narrated steps.`
                }
                
            }
            if(!yes.capped&&!no.capped){
                const shared=addSharedConclusion(state,yes.out,no.out);
                if(shared){
                    let where=shared.x;
                    if(shared.name==='forcedEdges'||shared.name==='offDirections'){
                        let [u,v]=where.split('>').map(Number);
                        where=`${label(cfg,u)} → ${label(cfg,v)}`
                    }else if(shared.name==='lineEdges'||shared.name==='offEdges'){
                        let [u,v]=where.split('-').map(Number);
                        where=`${label(cfg,u)}–${label(cfg,v)}`
                    }else where=label(cfg,+where);
                    return {
                        tech:12,cases:[{intro:`Case 1 — ${label(cfg,a)}–${label(cfg,b)} is a line:`,chain:yes.reasons},{intro:`Case 2 — ${label(cfg,a)}–${label(cfg,b)} is excluded:`,chain:no.reasons}],text:`Follow the full human ladder in both cases for ${label(cfg,a)}–${label(cfg,b)}. Both cases force the ${shared.target} at ${where}, so mark it without choosing the edge.`
                    }
                    
                }
                
            }
            
        }
        const patternFullDeadline=fullDeadline;
        for(const qs of Object.keys(cfg.clues)){
            if(Date.now()>patternFullDeadline)break;
            const q=+qs,m=ringCells(cfg,q).length,current=state.patternRestrictions.get(q)||new Set(Array.from({length:m},(_,i)=>['1:'+i,'-1:'+i]).flat());
            if(current.size<2||current.size>4)continue;
            const runs=[];
            for(const sig of current){
                if(Date.now()>patternFullDeadline)break;
                const run=propagatedPatternCase(cfg,state,q,sig,true,options.deep);
                runs.push({sig,run})
            }
            if(runs.length!==current.size)break;
            const alive=runs.filter(x=>!x.run.bad);
            if(!alive.length)return {
                tech:6,contradiction:true,text:`Every remaining cyclic order around ${label(cfg,q)} fails under the full human ladder.`
            };
            if(alive.length<runs.length){
                const dead=runs.find(x=>x.run.bad);
                state.patternRestrictions.set(q,new Set(alive.map(x=>x.sig)));
                return {
                    tech:15,chain:dead.run.reasons,chainIntro:`Suppose ${label(cfg,q)} used cyclic rotation ${dead.sig}. Then:`,chainOutro:`So that rotation is impossible; ${alive.length} remain.`,text:`The full human ladder eliminates cyclic rotation ${dead.sig} around ${label(cfg,q)}.`
                }
                
            }
            const shared=addCommonConclusion(state,alive.map(x=>x.run.out));
            if(shared){
                let where=shared.x;
                if(shared.name==='forcedEdges'||shared.name==='offDirections'){
                    let [u,v]=where.split('>').map(Number);
                    where=`${label(cfg,u)} → ${label(cfg,v)}`
                }else if(shared.name==='lineEdges'||shared.name==='offEdges'){
                    let [u,v]=where.split('-').map(Number);
                    where=`${label(cfg,u)}–${label(cfg,v)}`
                }else where=label(cfg,+where);
                return {
                    tech:12,cases:alive.map(x=>({intro:`Case — ${label(cfg,q)} uses rotation ${x.sig}:`,chain:x.run.reasons})),text:`Follow every remaining cyclic rotation around ${label(cfg,q)} with the full human ladder. All cases force the ${shared.target} at ${where}${shared.count>1?` and ${shared.count-1} further shared mark${shared.count===2?'':'s'} (${shared.vis} visible in total, the rest direction bookkeeping)`:''} \u2014 every agreed mark is placed.`
                }
                
            }
            
        }
        const forcingDeadline=fullDeadline;
        for(const {e:[a,b]} of trialCandidates(cfg,state).slice(0,64)){
            if(Date.now()>forcingDeadline)break;
            const k=key(a,b),yes=propagatedCase(cfg,state,k,true,false,options.deep);
            if(!yes.bad){
                const proof=proveBadBySplit(cfg,yes.out,forcingDeadline,3);
                if(proof){
                    state.offEdges.add(k);
                    return {
                        tech:15,text:`Suppose ${label(cfg,a)}–${label(cfg,b)} were a line. Following the human rules leaves a forcing net, but every branch fails: ${proof.summary} Therefore ${label(cfg,a)}–${label(cfg,b)} is excluded.`
                    }
                    
                }
                
            }
            const no=propagatedCase(cfg,state,k,false,false,options.deep);
            if(!no.bad){
                const proof=proveBadBySplit(cfg,no.out,forcingDeadline,3);
                if(proof){
                    addLine(state,a,b);
                    return {
                        tech:15,text:`Suppose ${label(cfg,a)}–${label(cfg,b)} were excluded. Following the human rules leaves a forcing net, but every branch fails: ${proof.summary} Therefore ${label(cfg,a)}–${label(cfg,b)} is a line.`
                    }
                    
                }
                
            }
            
        }
        if(open.every(x=>neighbours(cfg,x).filter(y=>on(state,x,y)).length===2)&&open.every(x=>neighbours(cfg,x).filter(y=>hasArrow(state,x,y)).length===1))return {
            done:true,complete:true,text:'Solved by the human deduction ladder: every route cell has one incoming and one outgoing segment, and all permit events alternate with gray cells.'
        };
        return {
            done:true,text:'No deduction found — the ladder is out of ideas here. Try True candidates for the engine’s view.'
        };
        
    }
    function stepResolve(cfg,state,options={}){
        const big=cfg.R*cfg.C>=100;
        const deepOpts={
            ...options,deep:true,trialBudget:big?80000:20000
        };
        let first,usedDeep=false;
        if(!options.noTrial&&!options.noEscalate&&(state.__deepStreak||0)>=2){
            // the normal trial tiers have failed twice in a row: run only the cheap
            // direct rules, then go straight to the deep tier
            first=stepOne(cfg,state,{...options,noTrial:true});
            if(first.done&&!first.complete){
                first=stepOne(cfg,state,deepOpts);
                usedDeep=true
            }
            
        }else{
            first=stepOne(cfg,state,options);
            if(first.done&&!first.complete&&!options.noTrial&&!options.noEscalate){
                // a genuine stall: one escalation pass with far deeper budgets and
                // uncapped ghost machinery, the way the other tabs' full tiers work
                first=stepOne(cfg,state,deepOpts);
                usedDeep=true;
                
            }
            
        }
        if(!options.noTrial&&!options.noEscalate)state.__deepStreak=(usedDeep&&first.tech!=null)?(state.__deepStreak||0)+1:(first.tech!=null&&!usedDeep?0:(state.__deepStreak||0));
        return first;
        // every deduction stands alone, one per click
        
    }
    // Routine direction bookkeeping (arrow continuations and impossible-direction
    // marks) is real logic but too small to stand as a step of its own: apply it
    // silently and attach it to the next substantive deduction.
    function stateSig(state){
        let pr=0;
        if(state.patternRestrictions)for(const v of state.patternRestrictions.values())pr+=v.size;
        let po=0;
        if(state.permitOrdinals)for(const v of state.permitOrdinals.values())po+=v.size;
        let pm=0;
        if(state.permitMapCases)for(const c of state.permitMapCases)pm+=(c&&(c.length!==undefined?c.length:(c.assignments?c.assignments.length:0)))||0;
        let ac=0;
        if(state.allowedPermitCounts)for(const v of state.allowedPermitCounts.values())ac+=(v&&v.size)||1;
        return [state.lineEdges?state.lineEdges.size:0,state.offEdges?state.offEdges.size:0,state.forcedEdges?state.forcedEdges.size:0,state.permitCells?state.permitCells.size:0,state.noPermitCells?state.noPermitCells.size:0,pr,po,pm,ac,state.permitMapCases?state.permitMapCases.length:0].join(',');
        
    }
    function step(cfg,state,options={}){
        if(options.noTrial||options.noBatch||options.noAbsorb)return stepResolve(cfg,state,options);
        let absorbed=0;
        for(let n=0;n<500;n++){
            const before=stateSig(state);
            const offBefore=state.offDirections?state.offDirections.size:0;
            const mv=stepResolve(cfg,state,options);
            if(mv.contradiction||mv.done||mv.tech==null){
                if(absorbed)mv.absorbed=absorbed;
                return mv
            }
            const onlyDirs=stateSig(state)===before&&(state.offDirections?state.offDirections.size:0)>offBefore;
            if(mv.tech===2||onlyDirs){
                absorbed++;
                continue
            }
            if(absorbed)mv.absorbed=absorbed;
            return mv;
            
        }
        return stepResolve(cfg,state,options);
        
    }
    // per-cell candidate visit ordinals (sudoku-style pencil marks): the union
    // of ranks over every still-surviving cyclic rotation of each clue
    function ordinalCandidates(cfg,state){
        const out=new Map();
        if(!state||!state.patternRestrictions)return out;
        for(const qs of Object.keys(cfg.clues||{})){
            const q=+qs,ring=ringCells(cfg,q),m=ring.length;
            if(!m)continue;
            const spec=clueSpec(cfg,q),nums=spec.nums;
            if(specBad(spec,m))continue;
            const current=state.patternRestrictions.get(q)||new Set(Array.from({length:m},(_,i)=>['1:'+i,'-1:'+i]).flat());
            const start=cfg.kind.indexOf('start');
            const perCell=new Map();
            for(const sig of current){
                const [dStr,offStr]=sig.split(':');
                const d=+dStr,off=+offStr;
                const ranks=new Map();
                for(let n=1;n<=m;n++)ranks.set(ring[(off+d*(n-1)+m*3)%m],n);
                if(ranks.has(start)&&ranks.get(start)!==1)continue;
                if(!startRankOk(cfg,state,ranks,m))continue;
                let anyVariant=false;
                for(const yes of yesVariants(cfg,state,ring,ranks,spec)){
                    if(!grantsGeometryOk(cfg,yes))continue;
                    let ok=true;
                    for(const x of ring)if((((cfg.kind[x]==='station'||cfg.kind[x]==='start'||(state.noPermitCells&&state.noPermitCells.has(x)))&&yes.has(x))||(state.permitCells&&state.permitCells.has(x)&&!yes.has(x))))ok=false;
                    if(!ok)continue;
                    anyVariant=true;
                    break;
                    
                }
                if(!anyVariant)continue;
                for(const [x,n] of ranks){
                    let byClue=perCell.get(x);
                    if(!byClue)perCell.set(x,byClue=new Set());
                    byClue.add(n)
                }
                
            }
            for(const [x,set] of perCell){
                let cell=out.get(x);
                if(!cell)out.set(x,cell=new Map());
                cell.set(q,set)
            }
            
        }
        return out;
        
    }
    const displayOrder=[0,1,3,10,14, 8,9,17,7,13,5, 16,4, 6,11,12,15];
    G.A38Stepper={
        techniques,step,ringCells,ordinalCandidates,displayOrder
    };
    if(typeof module!=='undefined')module.exports=G.A38Stepper;
    })(typeof globalThis!=='undefined'?globalThis:this);
