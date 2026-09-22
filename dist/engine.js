export const SLOT_POSITIONS={FLEX:['RB','WR','TE'],SUPER_FLEX:['QB','RB','WR','TE'],REC_FLEX:['WR','TE'],WRRB_FLEX:['WR','RB'],IDP_FLEX:['DL','LB','DB'],IDP:['DL','LB','DB']};
export const activeSlots=l=>(l.roster_positions||[]).filter(p=>!['BN','IR','TAXI'].includes(p));
export function eligible(player,slot){return (player?.fantasy_positions||[player?.position]).some(p=>(SLOT_POSITIONS[slot]||[slot]).includes(p));}
// Sleeper's projections bucket 50+ field goals as one fgm_50p, while almost every league scores
// fgm_50_59 and fgm_60p separately. That left the whole category unscored and every kicker projected
// about a point and a half light. Only consulted when the league's own key is missing from the stat
// line: finished weeks itemise the real buckets, so this never touches a scored week.
export const STAT_FALLBACKS={fgm_50_59:['fgm_50p']};
export function projected(stats,scoring){if(!stats)return null;let found=false,sum=0;for(const [key,mult]of Object.entries(scoring||{})){let value=stats[key];if(!Number.isFinite(value))for(const alt of STAT_FALLBACKS[key]||[])if(Number.isFinite(stats[alt])){value=stats[alt];break}if(Number.isFinite(value)&&Number.isFinite(mult)){sum+=value*mult;found=true;}}return found?Math.round(sum*100)/100:null;}
export function optimize(ids,slots,players,value,locked={},preferred=[]){
 // On equal projected points, retain as many existing slot assignments as possible.
 // This avoids meaningless RB/WR ordering changes while allowing necessary flex moves.
 const better=(candidate,current)=>!current||candidate.sum>current.sum+1e-9||(Math.abs(candidate.sum-current.sum)<=1e-9&&candidate.kept>current.kept);
 const fixed=new Set(Object.values(locked).filter(Boolean));const free=slots.map((s,i)=>({s,i})).filter(x=>!(x.i in locked));
 if(free.length>15)throw Error('Lineup optimization supports up to 15 unlocked starting slots.');
 let dp=new Map([[0,{sum:0,kept:0,picks:{...locked}}]]);
 for(const id of [...new Set(ids)]){if(fixed.has(id)||!players[id])continue;const v=value(id);if(v===null||!Number.isFinite(v))continue;const next=new Map(dp);for(const [mask,row]of dp){for(let j=0;j<free.length;j++){if(mask&(1<<j)||!eligible(players[id],free[j].s))continue;const m=mask|(1<<j),candidate={sum:row.sum+v,kept:row.kept+(preferred[free[j].i]===id?1:0),picks:{...row.picks,[free[j].i]:id}};if(better(candidate,next.get(m)))next.set(m,candidate)}}dp=next;}
 const target=(1<<free.length)-1;let best=dp.get(target);if(!best){let n=-1;for(const [mask,row]of dp){const count=mask.toString(2).replaceAll('0','').length;if(count>n||(count===n&&better(row,best))){best=row;n=count}}}
 let unknown=false,total=best.sum;for(const id of Object.values(locked)){if(!id)continue;const v=value(id);if(v===null)unknown=true;else total+=v;}
 return {ids:slots.map((_,i)=>best.picks[i]||null),total:Math.round(total*100)/100,complete:!!dp.get(target)&&!unknown};
}
export function availableIds(league,players){const owned=new Set((league.rosters||[]).flatMap(r=>[...(r.players||[]),...(r.reserve||[]),...(r.taxi||[])]));return Object.keys(players).filter(id=>!owned.has(id)&&players[id].active!==false);}
export const playableIds=r=>(r.players||[]).filter(id=>!(r.reserve||[]).includes(id)&&!(r.taxi||[]).includes(id));
export function waiverDropReason(id,{players,value,protectedIds=[],starterIds=[],lockedIds=[],excludedDropPositions=[]}){
 if(protectedIds.includes(id))return 'Never drop';
 if(lockedIds.includes(id))return 'Game started';
 if(starterIds.includes(id))return 'Current starter';
 if(!players[id])return 'Player information unavailable';
 if([players[id].position,...(players[id].fantasy_positions||[])].some(p=>excludedDropPositions.includes(p)))return 'Drop position excluded';
 if(['Out','IR','Suspended','PUP','Doubtful'].includes(players[id].injury_status))return 'Unavailable this week';
 const projection=value(id);
 if(!Number.isFinite(projection)||projection<=0)return 'No usable weekly projection';
 return null;
}
// A pickup that would not start can still beat the weakest bench player who may be dropped.
// Callers pass only drops that cost the starting lineup nothing in any week.
// margin is in the same unit as value: points for one week, or the total across a window.
export const BENCH_MARGIN=1;
export const filledSlots=lineup=>lineup.ids.filter(Boolean).length;
// A larger lineup gain wins, but gains this close are a wash, and then the weaker player is the one to drop.
export const betterMove=(gain,dropValue,best,tolerance)=>!best||gain>best.gain+tolerance||(gain>=best.gain-tolerance&&dropValue<best.dropValue);
export function benchMove(id,drops,value,margin=BENCH_MARGIN,samePosition=()=>true){
 const mine=value(id);if(!Number.isFinite(mine)||mine<=0)return null;
 if(drops.includes(null))return {drop:null,gain:null,benchGain:Math.round(mine*100)/100,status:'bench'};
 // Raw points only compare like with like. A second quarterback always out-projects a running back handcuff.
 const weakest=drops.filter(d=>Number.isFinite(value(d))&&samePosition(d)).sort((a,b)=>value(a)-value(b))[0];
 if(weakest===undefined)return null;
 const benchGain=Math.round((mine-value(weakest))*100)/100;
 return benchGain>=margin?{drop:weakest,gain:null,benchGain,status:'bench'}:null;
}
export function waiverMove({id,roster,slots,players,value,locked={},protectedIds=[],starterIds=[],excludedDropPositions=[],capacity,samePosition=true,baseline}){
 const before=baseline||optimize(roster,slots,players,value,locked);
 // A slot nobody can fill, such as an injured only tight end, is exactly when a pickup matters, so an
 // incomplete lineup is compared as it stands instead of hiding every candidate.
 if(!Number.isFinite(value(id)))return {drop:null,gain:null,status:'unavailable'};
 const lockedIds=Object.values(locked);
 const drops=roster.length<capacity?[null]:roster.filter(drop=>!waiverDropReason(drop,{players,value,protectedIds,starterIds,lockedIds,excludedDropPositions})&&(!samePosition||(players[drop]?.fantasy_positions||[players[drop]?.position]).some(pos=>(players[id]?.fantasy_positions||[players[id]?.position]).includes(pos))));
 if(!drops.length)return {drop:null,gain:null,status:'no_safe_drop'};
 let best=null;const spare=[],shares=drop=>(players[drop]?.fantasy_positions||[players[drop]?.position]).some(pos=>(players[id]?.fantasy_positions||[players[id]?.position]).includes(pos));
 for(const drop of drops){
  const after=optimize(roster.filter(p=>p!==drop).concat(id),slots,players,value,locked);
  if(filledSlots(after)<filledSlots(before))continue;
  const gain=Math.round((after.total-before.total)*100)/100,dropValue=drop===null?0:value(drop)??0;
  if(gain>=0)spare.push(drop);
  if(gain>.25&&betterMove(gain,dropValue,best,.5))best={drop,gain,dropValue,status:'upgrade'};
 }
 if(best)delete best.dropValue;
 return best||benchMove(id,spare,value,BENCH_MARGIN,d=>d===null||shares(d))||{drop:null,gain:null,status:'no_gain'};
}
export function tradeCandidateIds(ids,players,excluded=[]){
 const blocked=new Set(excluded);
 return ids.filter(id=>{
  const p=players[id];
  return p&&![p.position,...(p.fantasy_positions||[])].some(position=>blocked.has(position));
 });
}
export function createScoreTracker(){
 let scope=null,previous=new Map();
 return (players,nextScope)=>{
  if(scope!==nextScope){scope=nextScope;previous=new Map()}
  const changes=[];
  for(const player of players)for(const a of player.appearances){
   if(a.prediction||!Number.isFinite(a.points))continue;
   const key=JSON.stringify([a.leagueId,a.side,player.id]),before=previous.get(key);
   const delta=Math.round((a.points-before)*100)/100;
   if(Number.isFinite(before)&&Math.abs(delta)>=.01)changes.push({...a,id:player.id,delta});
   previous.set(key,a.points);
  }
  return changes;
 };
}
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
