import {activeSlots,playableIds,waiverDropReason,eligible,benchMove,BENCH_MARGIN,filledSlots,betterMove} from './engine.js';
import {futurePoints,seasonLineup} from './trades.js';

export function waiverWeeks(week,horizon,endWeek=17){
 if(horizon==='current')return [week];
 if(horizon==='next')return week<18?[week+1]:[];
 return Array.from({length:Math.max(0,endWeek-week)},(_,i)=>week+i+1);
}

// A pickup and its chosen drop are held for the entire window. Re-optimize each
// week's lineup, never invent a different drop or extra waiver move each week.
export function buildWaiverOutlook({league,players,outlook,protectedIds=[],starterIds=[],excludedDropPositions=[],samePosition=true}){
 const weeks=outlook.weeks,slots=activeSlots(league),roster=playableIds(league.mine),values={},totals={};
 for(const id of Object.keys(players)){
  values[id]=weeks.map(w=>futurePoints(id,outlook.data[w],players,league.scoring_settings));
  totals[id]=weeks.length&&values[id].every(Number.isFinite)?values[id].reduce((s,v)=>s+v,0):null;
 }
 const lineup=(ids,i)=>seasonLineup(ids,slots,players,id=>values[id]?.[i]??null);
 const before=weeks.map((_,i)=>lineup(roster,i)),capacity=league.roster_positions.filter(s=>!['IR','TAXI'].includes(s)).length;
 const safeDrops=roster.filter(id=>!waiverDropReason(id,{players,value:id=>totals[id],protectedIds,starterIds,excludedDropPositions}));
 return {totals,values,evaluate(id){
  if(!weeks.length||totals[id]===null||!Number.isFinite(totals[id])||['Out','IR','PUP','Suspended','Doubtful'].includes(players[id]?.injury_status))return {drop:null,gain:null,status:'unavailable'};
  const drops=roster.length<capacity?[null]:safeDrops.filter(drop=>!samePosition||(players[id]?.fantasy_positions||[players[id]?.position]).some(pos=>eligible(players[drop],pos)));
  if(!drops.length)return {drop:null,gain:null,status:'no_safe_drop'};
  let best=null;const spare=[];
  for(const drop of drops){
   const afterIds=roster.filter(p=>p!==drop).concat(id),after=weeks.map((_,i)=>lineup(afterIds,i));
   if(after.some((r,i)=>filledSlots(r)<filledSlots(before[i])))continue;
   const weekly=weeks.map((week,i)=>({week,gain:Math.round((after[i].total-before[i].total)*100)/100,starts:after[i].ids.includes(id)}));
   const gain=Math.round(weekly.reduce((sum,r)=>sum+r.gain,0)*100)/100;
   if(weekly.every(r=>r.gain>=0))spare.push(drop);
   // The bar scales with the window: a quarter point over ten weeks is noise, not an upgrade.
   if(gain>.25*weeks.length&&betterMove(gain,totals[drop]??0,best,.5*weeks.length))best={drop,gain,dropValue:totals[drop]??0,weekly,starts:weekly.filter(r=>r.starts).length,status:'upgrade'};
  }
  if(best){delete best.dropValue;return best}
  const shares=drop=>drop===null||(players[drop]?.fantasy_positions||[players[drop]?.position]).some(pos=>(players[id]?.fantasy_positions||[players[id]?.position]).includes(pos));
  return benchMove(id,spare,p=>totals[p],BENCH_MARGIN*weeks.length,shares)||{drop:null,gain:null,status:'no_gain'};
 }};
}
