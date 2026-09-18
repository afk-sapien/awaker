import {activeSlots,playableIds,waiverDropReason,eligible} from './engine.js';
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
  if(!weeks.length||totals[id]===null||!Number.isFinite(totals[id])||before.some(r=>!r.complete)||['Out','IR','PUP','Suspended','Doubtful'].includes(players[id]?.injury_status))return {drop:null,gain:null,status:'unavailable'};
  const drops=roster.length<capacity?[null]:safeDrops.filter(drop=>!samePosition||(players[id]?.fantasy_positions||[players[id]?.position]).some(pos=>eligible(players[drop],pos)));
  if(!drops.length)return {drop:null,gain:null,status:'no_safe_drop'};
  let best=null;
  for(const drop of drops){
   const afterIds=roster.filter(p=>p!==drop).concat(id),after=weeks.map((_,i)=>lineup(afterIds,i));
   if(after.some(r=>!r.complete))continue;
   const weekly=weeks.map((week,i)=>({week,gain:Math.round((after[i].total-before[i].total)*100)/100,starts:after[i].ids.includes(id)}));
   const gain=Math.round(weekly.reduce((sum,r)=>sum+r.gain,0)*100)/100;
   if(gain>.25&&(!best||gain>best.gain||gain===best.gain&&(totals[drop]??0)<(totals[best.drop]??0)))best={drop,gain,weekly,starts:weekly.filter(r=>r.starts).length,status:'upgrade'};
  }
  return best||{drop:null,gain:null,status:'no_gain'};
 }};
}
