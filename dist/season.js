import {projected,optimize,activeSlots,eligible} from './engine.js';

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

// A start/sit is only a mistake if the projections favoured the bench player before kickoff. The rest
// is hindsight, and a recap that cannot tell the two apart is just blaming people for the weather.
export const DECISIONS=[[-1,'defensible'],[1,'toss-up'],[Infinity,'avoidable']];
export const decisionLabel=foreseen=>Number.isFinite(foreseen)?DECISIONS.find(([limit])=>foreseen<limit)[1]:'unknown';

// One finished week of one league, every roster. players_points carries the league's own scoring,
// including the rare-event categories projections never itemise, so it is the authority on what
// was scored; the matchup payload also holds each roster as it stood that week, not as it stands now.
export function weekReview({league,players,week,matchups=[],projections={}}){
 const scoring=league.scoring_settings,slots=activeSlots(league);
 const expected=id=>projected(projections[id]?.stats,scoring);
 const rows=(league.rosters||[]).map(roster=>{
  const m=matchups.find(x=>x.roster_id===roster.roster_id);
  if(!m)return {rosterId:roster.roster_id,played:false,decisions:[]};
  // Sleeper's starters array is one entry per starting slot, in the same order as the slots, and an
  // unfilled slot is a '0' holding its place. Keep it aligned for anything that reasons about slots,
  // and flattened only for sums and membership.
  const lineup=(m.starters||[]).map(id=>id&&id!=='0'?id:null);
  const starters=lineup.filter(Boolean),owned=[...new Set([...(m.players||[]),...starters])].filter(id=>players[id]);
  const got=id=>{const v=Number(m.players_points?.[id]);return Number.isFinite(v)?v:null};
  const sum=ids=>round(ids.reduce((t,id)=>t+(got(id)||0),0)),started=sum(starters);
  // Two counterfactuals: the most this roster could have scored, and what the lineup the projections
  // advised would have scored. The gap to the first is luck; the gap to the second was knowable.
  const best=optimize(owned,slots,players,got,{},lineup),advised=optimize(owned,slots,players,expected,{},lineup);
  const chosen=new Set(best.ids.filter(Boolean));
  // Both lineups are indexed by slot, so a change is read slot by slot and the two players are
  // always ones who could have held the same place. Pairing them by points instead would explain,
  // with a straight face, that a receiver should have started ahead of a quarterback.
  const spare=starters.filter(id=>!chosen.has(id));
  const decisions=best.ids.map((id,slot)=>({id,slot})).filter(x=>x.id&&!starters.includes(x.id)).map(({id,slot})=>{
   // Whoever held that slot, if he really lost his place rather than moving to another one. Failing
   // that, any benched starter eligible for it. Failing that, the slot was simply left empty, which
   // is measured against the nothing it scored.
   const held=spare.indexOf(lineup[slot]);
   const at=held>=0?held:spare.findIndex(other=>eligible(players[other],slots[slot]));
   const out=at>=0?spare.splice(at,1)[0]:null,pair=[expected(id),out?expected(out):0];
   const foreseen=pair.every(Number.isFinite)?round(pair[0]-pair[1]):null;
   return {sat:id,played:out,gained:round((got(id)||0)-(out?(got(out)||0):0)),foreseen,label:decisionLabel(foreseen)};
  }).sort((a,b)=>b.gained-a.gained);
  const opponent=m.matchup_id==null?null:matchups.find(x=>x.matchup_id===m.matchup_id&&x.roster_id!==m.roster_id)||null;
  const points=round(Number(m.custom_points??m.points)||0),against=opponent?round(Number(opponent.custom_points??opponent.points)||0):null;
  const left=round(best.total-started),followed=sum(advised.ids.filter(Boolean));
  return {rosterId:roster.roster_id,played:true,points,against,opponentId:opponent?.roster_id??null,
   result:against===null?null:points>against?'win':points<against?'loss':'tie',margin:against===null?null:round(points-against),
   started,best:best.total,left,advised:followed,cost:round(started-followed),
   complete:best.complete&&advised.complete,starters,bestLineup:best.ids,decisions,
   // Losing by less than the bench was holding is the line a recap wants to open with.
   swung:against!==null&&points<against&&left>against-points};
 });
 const played=rows.filter(r=>r.played),scores=played.map(r=>r.points);
 const games=played.filter(r=>r.opponentId!==null&&r.rosterId<r.opponentId).map(r=>({rosterId:r.rosterId,opponentId:r.opponentId,margin:Math.abs(r.margin),total:round(r.points+r.against)}));
 return {week,rows,summary:{teams:scores.length,average:scores.length?round(scores.reduce((a,b)=>a+b,0)/scores.length):null,
  high:scores.length?Math.max(...scores):null,low:scores.length?Math.min(...scores):null,
  closest:games.length?games.reduce((a,b)=>b.margin<a.margin?b:a):null,widest:games.length?games.reduce((a,b)=>b.margin>a.margin?b:a):null,
  leftOnBench:round(played.reduce((t,r)=>t+(r.left||0),0))}};
}

// Spending on someone who never entered a lineup, or cutting someone who then outscored his
// replacement, are the moves worth revisiting. The rest is roster upkeep.
export const moveLabel=({adds,net,bid,complete=true})=>{
 if(!complete)return 'not played yet';
 if(adds.length&&adds.every(a=>!a.started))return bid?'unused bid':'stashed';
 if(!Number.isFinite(net))return 'unknown';
 return net<=-3?'backfired':net>=3?'paid off':'neutral';
};

// Waiver claims, free agents and trades, graded by what the players involved scored in the week the
// move could first affect. A player's points only count for a move made before his own game kicked
// off: Sleeper files a transaction under the week it cleared in, so a Tuesday claim sits in a week
// already over, and even a Sunday evening pickup cannot take credit for the afternoon games. Points
// that were already on the board when the move cleared belong to the week after. A week's verdict,
// never a season's. games is that week's kickoff times by NFL team; without it nothing is reweighted.
export function moves({league,players,week,transactions=[],matchups=[],stats={},games=null,next=null}){
 const scoring=league.scoring_settings;
 const kickoff=id=>{const at=Date.parse(games?.[players[id]?.team||id]?.start??'');return Number.isFinite(at)?at:null};
 // No kickoff for him, or no timestamp on the move, means no reason to move him off this week.
 const ahead=(id,at)=>{const k=kickoff(id);return k===null||at===null?true:at<k};
 const view=(weekNumber,rosters,lines,complete)=>{
  const points=new Map(),started=new Set();
  for(const m of rosters||[]){
   for(const [id,value]of Object.entries(m.players_points||{})){const v=Number(value);if(Number.isFinite(v)&&!points.has(id))points.set(id,v)}
   for(const id of m.starters||[])if(id&&id!=='0')started.add(id);
  }
  // Someone dropped and left unrostered has no players_points line anywhere, but he still has a stat line.
  return {week:weekNumber,complete,scored:id=>points.has(id)?points.get(id):projected(lines?.[id]?.stats,scoring),started:id=>started.has(id)};
 };
 const during=view(week,matchups,stats,true),unknown={week:week+1,complete:false,scored:()=>null,started:()=>false};
 const upcoming=next?view(next.week,next.matchups,next.stats,!!next.complete):unknown;
 const total=list=>{const known=list.map(s=>s.points).filter(Number.isFinite);return known.length?round(known.reduce((a,b)=>a+b,0)):null};
 const rows=transactions.filter(t=>t?.status==='complete'&&['waiver','free_agent','trade'].includes(t.type)).map(t=>{
  const raw=Number(t.created),at=Number.isFinite(raw)?raw:null;
  const side=(id,rosterId)=>{
   const scope=ahead(id,at)?during:upcoming;
   return {id,rosterId,forWeek:scope.week,points:scope.complete?scope.scored(id):null,started:scope.complete&&scope.started(id),position:players[id]?.position||null};
  };
  const adds=Object.entries(t.adds||{}).map(([id,rosterId])=>side(id,rosterId)),drops=Object.entries(t.drops||{}).map(([id,rosterId])=>side(id,rosterId));
  const involved=[...adds,...drops];
  // One move can straddle two weeks - a Sunday night claim on a player who has played and one who
  // has not - so it is only graded once every player in it has a week on the board.
  const played=involved.every(p=>p.forWeek===during.week||upcoming.complete);
  const forWeek=!involved.length||involved.some(p=>p.forWeek===during.week)?during.week:upcoming.week;
  const bid=Number(t.settings?.waiver_bid),gained=total(adds),lost=total(drops);
  const net=!played||(gained===null&&lost===null)?null:round((gained||0)-(lost||0));
  const row={type:t.type,week,forWeek,played,at,rosterIds:t.roster_ids||[],bid:Number.isFinite(bid)?bid:null,adds,drops,net};
  // A trade has no single verdict, so each manager gets their own side of it.
  return t.type==='trade'?{...row,sides:(t.roster_ids||[]).map(rosterId=>{
   const received=adds.filter(a=>a.rosterId===rosterId),sent=drops.filter(d=>d.rosterId===rosterId);
   const [inPoints,outPoints]=[total(received),total(sent)];
   return {rosterId,received:received.map(p=>p.id),sent:sent.map(p=>p.id),net:!played||(inPoints===null&&outPoints===null)?null:round((inPoints||0)-(outPoints||0))};
  })}:{...row,label:moveLabel({adds,net,bid:Number.isFinite(bid)?bid:null,complete:played})};
 });
 const claims=rows.filter(r=>r.type!=='trade'&&Number.isFinite(r.net));
 return {week,rows,summary:{count:rows.length,trades:rows.filter(r=>r.type==='trade').length,
  pending:rows.filter(r=>!r.played).length,spent:round(rows.reduce((t,r)=>t+(r.bid||0),0)),
  best:claims.length?claims.reduce((a,b)=>b.net>a.net?b:a):null}};
}
