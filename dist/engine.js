export const SLOT_POSITIONS={FLEX:['RB','WR','TE'],SUPER_FLEX:['QB','RB','WR','TE'],REC_FLEX:['WR','TE'],WRRB_FLEX:['WR','RB'],IDP_FLEX:['DL','LB','DB'],IDP:['DL','LB','DB']};
export const activeSlots=l=>(l.roster_positions||[]).filter(p=>!['BN','IR','TAXI'].includes(p));
export function eligible(player,slot){return (player?.fantasy_positions||[player?.position]).some(p=>(SLOT_POSITIONS[slot]||[slot]).includes(p));}
export function projected(stats,scoring){if(!stats)return null;let found=false,sum=0;for(const [key,mult]of Object.entries(scoring||{})){if(Number.isFinite(stats[key])&&Number.isFinite(mult)){sum+=stats[key]*mult;found=true;}}return found?Math.round(sum*100)/100:null;}
export function optimize(ids,slots,players,value,locked={}){
 const fixed=new Set(Object.values(locked).filter(Boolean));const free=slots.map((s,i)=>({s,i})).filter(x=>!(x.i in locked));
 if(free.length>15)throw Error('Lineup optimization supports up to 15 unlocked starting slots.');
 let dp=new Map([[0,{sum:0,picks:{...locked}}]]);
 for(const id of [...new Set(ids)]){if(fixed.has(id)||!players[id])continue;const v=value(id);if(v===null||!Number.isFinite(v))continue;const next=new Map(dp);for(const [mask,row]of dp){for(let j=0;j<free.length;j++){if(mask&(1<<j)||!eligible(players[id],free[j].s))continue;const m=mask|(1<<j),sum=row.sum+v;if(!next.has(m)||sum>next.get(m).sum)next.set(m,{sum,picks:{...row.picks,[free[j].i]:id}})}}dp=next;}
 const target=(1<<free.length)-1;let best=dp.get(target);if(!best){let n=-1;for(const [mask,row]of dp){const count=mask.toString(2).replaceAll('0','').length;if(count>n||(count===n&&row.sum>best.sum)){best=row;n=count}}}
 let unknown=false,total=best.sum;for(const id of Object.values(locked)){if(!id)continue;const v=value(id);if(v===null)unknown=true;else total+=v;}
 return {ids:slots.map((_,i)=>best.picks[i]||null),total:Math.round(total*100)/100,complete:!!dp.get(target)&&!unknown};
}
export function availableIds(league,players){const owned=new Set((league.rosters||[]).flatMap(r=>[...(r.players||[]),...(r.reserve||[]),...(r.taxi||[])]));return Object.keys(players).filter(id=>!owned.has(id)&&players[id].active!==false);}
export const playableIds=r=>(r.players||[]).filter(id=>!(r.reserve||[]).includes(id)&&!(r.taxi||[]).includes(id));
export function aggregateWatch(leagues,players,games){const byId=new Map();for(const l of leagues){if(!l.enabled||!l.mine)continue;const m=l.matchups.find(m=>m.roster_id===l.mine.roster_id),opp=m?.matchup_id==null?null:l.matchups.find(x=>x.matchup_id===m.matchup_id&&x.roster_id!==m.roster_id);const sides=[{r:l.mine,m,side:'mine'},{r:l.rosters.find(r=>r.roster_id===opp?.roster_id),m:opp,side:'opponent'}];for(const {r,m,side}of sides){if(!r)continue;for(const id of (m?.players||r.players||[])){if(!players[id])continue;const starter=(m?.starters||r.starters||[]).includes(id);if(side==='opponent'&&!starter)continue;let p=byId.get(id);if(!p){p={id,player:players[id],game:games[players[id].team]||null,appearances:[]};byId.set(id,p)}p.appearances.push({leagueId:l.league_id,league:l.name,side,starter,points:Number.isFinite(m?.players_points?.[id])?m.players_points[id]:null});}}}return [...byId.values()];}
export function tradeResult({league,roster,partner,give,get,players,value,freeAgents=[],locked={}}){
 const a=playableIds(roster),b=playableIds(partner),slots=activeSlots(league);
 if(!give.length||!get.length||new Set([...give,...get]).size!==give.length+get.length||give.some(id=>!a.includes(id))||get.some(id=>!b.includes(id)))throw Error('Choose distinct players from each team.');
 const max=Math.max(a.length,b.length,league.roster_positions.length),afterA=a.filter(id=>!give.includes(id)).concat(get),afterB=b.filter(id=>!get.includes(id)).concat(give);
 const droppedA=[],droppedB=[],addedA=[],addedB=[];
 const adjust=(ids,baseLen,drops,adds)=>{while(ids.length>Math.max(baseLen,max)){const sorted=[...ids].sort((x,y)=>(value(x)??-999)-(value(y)??-999));const id=sorted.find(x=>!give.includes(x)&&!get.includes(x));if(!id)break;ids.splice(ids.indexOf(id),1);drops.push(id)}while(ids.length<baseLen){const before=optimize(ids,slots,players,value);const candidates=freeAgents.filter(id=>!ids.includes(id)&&!give.includes(id)&&!get.includes(id)&&!addedA.includes(id)&&!addedB.includes(id)).slice(0,18);let winner=null,gain=-Infinity;for(const id of candidates){const result=optimize([...ids,id],slots,players,value);const d=result.total-before.total;if(d>gain){gain=d;winner=id}}if(!winner)break;ids.push(winner);adds.push(winner)}};
 adjust(afterA,a.length,droppedA,addedA);adjust(afterB,b.length,droppedB,addedB);
 const beforeA=optimize(a,slots,players,value),beforeB=optimize(b,slots,players,value),newA=optimize(afterA,slots,players,value),newB=optimize(afterB,slots,players,value);
 return {gainA:newA.total-beforeA.total,gainB:newB.total-beforeB.total,beforeA,beforeB,newA,newB,droppedA,droppedB,addedA,addedB,complete:beforeA.complete&&beforeB.complete&&newA.complete&&newB.complete};
}
