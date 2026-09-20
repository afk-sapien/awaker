import {projected} from './engine.js';

// How a player has done against what was expected of him, week by week, and how hard the next
// few opponents are for his position. Everything uses the league's own scoring.
export const TONES=[[-5,'poor'],[-2,'weak'],[2,'neutral'],[5,'good'],[Infinity,'strong']];
export const tone=diff=>Number.isFinite(diff)?TONES.find(([limit])=>diff<limit)[1]:'none';
const POSITIONS=['QB','RB','WR','TE','K','DEF'];
const round=n=>Math.round(n*100)/100;

// Fantasy points each defense has allowed to each position per game, ranked 1 (stingiest) to 32.
export function pointsAllowed(weeks,players,scoring){
 const totals={},games={};
 for(const {stats} of weeks){
  const seen=new Set();
  for(const [id,row]of Object.entries(stats||{})){
   const position=players[id]?.position;if(!POSITIONS.includes(position)||position==='DEF'||!row.opponent)continue;
   const points=projected(row.stats,scoring);if(!Number.isFinite(points))continue;
   const key=`${row.opponent}:${position}`;totals[key]=(totals[key]||0)+points;
   if(!seen.has(`${row.opponent}:${position}`)){seen.add(`${row.opponent}:${position}`);games[key]=(games[key]||0)+1}
  }
 }
 const table={};
 for(const position of POSITIONS){
  const rows=Object.keys(totals).filter(k=>k.endsWith(':'+position)).map(k=>({team:k.split(':')[0],average:totals[k]/games[k]})).sort((a,b)=>a.average-b.average);
  rows.forEach((row,i)=>{(table[row.team]||={})[position]={average:round(row.average),rank:i+1,of:rows.length}});
 }
 return table;
}

// rank 1 allows the fewest points, so a high rank is a soft matchup.
export function matchup(entry){
 if(!entry||entry.of<8)return null;
 const share=entry.rank/entry.of;
 return {...entry,label:share<=1/3?'Tough':share>2/3?'Easy':'Average',tone:share<=1/3?'weak':share>2/3?'good':'neutral'};
}

export function verdict(row){
 if(row.games<2)return {label:'Too early',tone:'neutral',note:'Fewer than two games to judge.'};
 const hard=row.upcoming.filter(u=>u.matchup?.label==='Tough').length,soft=row.upcoming.filter(u=>u.matchup?.label==='Easy').length;
 if(row.average<=-2)return hard>soft?{label:'Shop or sit',tone:'poor',note:'Below projection, and the next opponents are tough on his position.'}:{label:'Under-performing',tone:'weak',note:'Below projection. Soft matchups ahead may be the time to sell, or to give him one more start.'};
 if(row.average>=2)return hard>soft?{label:'Sell high?',tone:'good',note:'Beating projection, but tough opponents are coming. His value may never be higher.'}:{label:'Rolling',tone:'strong',note:'Beating projection with a friendly schedule. Keep starting him.'};
 return {label:'As expected',tone:'neutral',note:'Scoring about what was projected.'};
}

// weeks: [{week, stats, projections}] for finished weeks, oldest first.
// schedules: {week: {TEAM: {opponent}}} for the weeks ahead.
export function seasonReview({league,players,weeks,schedules={},currentWeek,ahead=3}){
 const scoring=league.scoring_settings,allowed=pointsAllowed(weeks,players,scoring);
 const starters=new Set(league.mine.starters||[]),ids=[...new Set([...(league.mine.players||[]),...(league.mine.reserve||[])])].filter(id=>players[id]);
 const rows=ids.map(id=>{
  const player=players[id];
  const cells=weeks.map(({week,stats,projections})=>{
   const played=stats?.[id],actual=played?projected(played.stats,scoring):null,expected=projected(projections?.[id]?.stats,scoring);
   // No stat line in a finished week means a bye, an injury or a healthy scratch. It is not a zero.
   const counted=Number.isFinite(actual)&&Number.isFinite(expected)&&(played.stats?.gp??1)>0;
   return {week,actual:Number.isFinite(actual)?round(actual):null,expected:Number.isFinite(expected)?round(expected):null,diff:counted?round(actual-expected):null,opponent:played?.opponent||projections?.[id]?.opponent||null};
  });
  const counted=cells.filter(c=>c.diff!==null),total=round(cells.reduce((s,c)=>s+(c.actual||0),0)),expectedTotal=round(counted.reduce((s,c)=>s+c.expected,0));
  const upcoming=Array.from({length:ahead},(_,i)=>currentWeek+i).map(week=>{const opponent=schedules[week]?.[player.team]?.opponent||null;return {week,opponent,matchup:opponent?matchup(allowed[opponent]?.[player.position]):null}}).filter(u=>schedules[u.week]);
  const row={id,position:player.position,starter:starters.has(id),cells,games:counted.length,total,expectedTotal,diff:round(counted.reduce((s,c)=>s+c.diff,0)),average:counted.length?round(counted.reduce((s,c)=>s+c.diff,0)/counted.length):null,upcoming};
  return {...row,verdict:verdict(row)};
 });
 const order=id=>{const i=POSITIONS.indexOf(id);return i<0?99:i};
 return {weeks:weeks.map(w=>w.week),rows:rows.sort((a,b)=>order(a.position)-order(b.position)||b.total-a.total),allowed};
}
