import {projected} from './engine.js';

export const defenseWeeks=start=>Array.from({length:Math.max(0,Math.min(5,19-start))},(_,i)=>start+i);
export function defenseTone(delta){
 if(!Number.isFinite(delta))return 'unknown';
 return delta>=3?'strong':delta>=1?'good':delta<=-3?'poor':delta<=-1?'weak':'neutral';
}
export function defenseOutlook({players,projections,schedules,weeks,scoring}){
 const ids=Object.keys(players).filter(id=>players[id].position==='DEF');
 return Object.fromEntries(weeks.map(week=>{
  const games=schedules[week],hasSchedule=!!games&&Object.keys(games).length>0;
  const rows=Object.fromEntries(ids.map(id=>{
   const team=players[id].team||id,bye=hasSchedule&&!games[team];
   return [id,{bye,points:bye?0:projected(projections[week]?.[id]?.stats,scoring)}];
  }));
  // Compare with every projected NFL defense playing this week, including
  // defenses rostered by other managers. Byes are not streamable matchups.
  const values=Object.values(rows).filter(r=>!r.bye&&Number.isFinite(r.points)).map(r=>r.points).sort((a,b)=>a-b);
  const middle=Math.floor(values.length/2),median=values.length?(values.length%2?values[middle]:(values[middle-1]+values[middle])/2):null;
  for(const row of Object.values(rows)){row.delta=!row.bye&&Number.isFinite(row.points)&&median!==null?row.points-median:null;row.tone=row.bye?'bye':defenseTone(row.delta)}
  return [week,{median,count:values.length,rows}];
 }));
}
