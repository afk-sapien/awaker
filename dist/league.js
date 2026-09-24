import {projected,activeSlots,playableIds,SLOT_POSITIONS,ruledOut} from './engine.js';
import {seasonLineup} from './trades.js';

// The whole league at once: what every team has scored, what every roster projects to score,
// how this week is going, and a simulation of the rest of the schedule for playoff odds.
export const POSITIONS=['QB','RB','WR','TE','K','DEF','Other'];
const round=(n,d=2)=>Math.round(n*10**d)/10**d;
const mean=list=>list.length?list.reduce((s,n)=>s+n,0)/list.length:0;
export const median=list=>{const sorted=[...list].sort((a,b)=>a-b),mid=sorted.length/2;return !sorted.length?0:sorted.length%2?sorted[Math.floor(mid)]:(sorted[mid-1]+sorted[mid])/2};
export const score=m=>Number(m?.custom_points??m?.points)||0;
const bucket=(players,id)=>POSITIONS.includes(players[id]?.position)?players[id].position:'Other';

export function teamName(league,rosterId){
 const roster=(league.rosters||[]).find(r=>r.roster_id===rosterId),user=(league.users||[]).find(u=>u.user_id===roster?.owner_id);
 return {team:user?.metadata?.team_name||user?.display_name||`Team ${rosterId}`,manager:user?.metadata?.team_name?user.display_name:null};
}
// Teams without a matchup_id have the week off.
export function pairings(matchups){
 const groups=new Map();
 for(const m of matchups||[])if(m.matchup_id!=null)groups.set(m.matchup_id,[...(groups.get(m.matchup_id)||[]),m.roster_id]);
 return [...groups.values()].filter(g=>g.length===2);
}
export function leagueShape(league){
 const teams=(league.rosters||[]).length,s=league.settings||{};
 const playoffTeams=Math.max(1,Math.min(teams,Number(s.playoff_teams)||Math.min(6,Math.floor(teams/2))));
 let size=1;while(size<playoffTeams)size*=2;
 return {teams,playoffTeams,byes:size-playoffTeams,playoffStart:Number(s.playoff_week_start)||15,startWeek:Number(s.start_week)||1,medianGame:s.league_average_match===1,divisions:Number(s.divisions)||0};
}

// weeks: [{week, matchups}] for finished weeks, oldest first. A week nobody scored in is skipped.
export function seasonSoFar({league,players,weeks}){
 const {medianGame}=leagueShape(league),ids=league.rosters.map(r=>r.roster_id);
 const rows=Object.fromEntries(ids.map(id=>[id,{rosterId:id,wins:0,losses:0,ties:0,h2hWins:0,h2hTies:0,pf:0,pa:0,allPlayWins:0,allPlayLosses:0,expectedWins:0,games:0,scores:[],byPosition:Object.fromEntries(POSITIONS.map(p=>[p,0]))}]));
 const counted=[];
 for(const {week,matchups} of weeks){
  const byId=new Map((matchups||[]).map(m=>[m.roster_id,m]));
  if(![...byId.values()].some(m=>score(m)>0)){for(const id of ids)rows[id].scores.push(null);continue}
  const scores=ids.filter(id=>byId.has(id)).map(id=>score(byId.get(id))),average=mean(scores),sorted=[...scores].sort((a,b)=>a-b);
  counted.push({week,average:round(average),high:sorted.at(-1),low:sorted[0]});
  const line=median(scores);
  for(const id of ids){
   const row=rows[id],m=byId.get(id);if(!m){row.scores.push(null);continue}
   const mine=score(m);row.scores.push({week,points:round(mine),diff:round(mine-average)});row.pf+=mine;row.games++;
   const beaten=scores.filter(s=>s<mine).length,level=scores.filter(s=>s===mine).length-1;
   row.allPlayWins+=beaten;row.allPlayLosses+=scores.length-1-beaten-level;
   if(scores.length>1)row.expectedWins+=(beaten+level/2)/(scores.length-1);
   if(medianGame){if(mine>line)row.wins++;else if(mine<line)row.losses++;else row.ties++}
   for(const p of m.starters||[])if(players[p])row.byPosition[bucket(players,p)]+=Number(m.players_points?.[p])||0;
  }
  for(const [a,b] of pairings(matchups)){
   const x=score(byId.get(a)),y=score(byId.get(b));rows[a].pa+=y;rows[b].pa+=x;
   if(x===y){rows[a].ties++;rows[b].ties++;rows[a].h2hTies++;rows[b].h2hTies++}else{const [w,l]=x>y?[a,b]:[b,a];rows[w].wins++;rows[w].h2hWins++;rows[l].losses++}
  }
 }
 for(const row of Object.values(rows)){
  const played=row.scores.filter(Boolean).map(s=>s.points);
  Object.assign(row,{pf:round(row.pf),pa:round(row.pa),average:row.games?round(row.pf/row.games):null,high:played.length?Math.max(...played):null,low:played.length?Math.min(...played):null,
   // Luck is head-to-head wins against the wins the same scores earn against the whole league.
   expectedWins:round(row.expectedWins),luck:round(row.h2hWins+row.h2hTies/2-row.expectedWins),
   byPosition:Object.fromEntries(POSITIONS.map(p=>[p,row.games?round(row.byPosition[p]/row.games):0]))});
 }
 return {rows,weeks:counted,games:counted.length};
}

// The best lineup each roster can field, averaged over the weeks that have projections, so byes count.
export function rosterOutlook({league,players,projections,weeks}){
 const slots=activeSlots(league),usable=weeks.filter(w=>Object.keys(projections[w]||{}).length),out={};
 for(const roster of league.rosters){
  const byPosition=Object.fromEntries(POSITIONS.map(p=>[p,0]));let total=0;
  for(const week of usable){
   const value=id=>projected(projections[week][id]?.stats,league.scoring_settings);
   const lineup=seasonLineup(playableIds(roster),slots,players,value);
   total+=lineup.total;for(const id of lineup.ids)if(id)byPosition[bucket(players,id)]+=value(id)||0;
  }
  out[roster.roster_id]=usable.length?{points:round(total/usable.length),byPosition:Object.fromEntries(POSITIONS.map(p=>[p,round(byPosition[p]/usable.length)])),weeks:usable}:null;
 }
 return out;
}

// Each team's points by position against the league average, for a radar chart. 1 is average.
// The scale is the same on every axis. It stops at 40% and 160% so one wild kicker week cannot
// flatten the positions that matter; anything beyond is drawn at the edge.
export function positionRadar(rows,pick){
 const teams=rows.filter(r=>pick(r)),axes=POSITIONS.map(position=>({position,average:round(mean(teams.map(r=>pick(r)[position]||0)))})).filter(a=>a.average>0);
 if(teams.length<2||axes.length<3)return null;
 const shaped=teams.map(r=>({rosterId:r.rosterId,values:axes.map(a=>pick(r)[a.position]||0),ratios:axes.map(a=>round((pick(r)[a.position]||0)/a.average,3))}));
 const reach=Math.min(.6,Math.max(.3,...shaped.flatMap(t=>t.ratios.map(v=>Math.abs(v-1)))));
 return {axes,teams:shaped,low:round(1-reach,3),high:round(1+reach,3)};
}
// How many of each position a lineup can use: its own slots, plus one for a flex it can fill.
export function depthSlots(league){
 const slots=activeSlots(league),out=[];
 for(const position of ['QB','RB','WR','TE','K','DEF']){
  const own=slots.filter(s=>s===position).length,flex=slots.some(s=>SLOT_POSITIONS[s]?.includes(position))&&(position==='QB'?slots.includes('SUPER_FLEX'):position!=='TE');
  for(let i=1;i<=own+(own&&flex?1:0);i++)out.push({position,depth:i,label:`${position}${own+(flex?1:0)>1?i:''}`});
 }
 return out;
}
// Every roster's best player at each of those spots and where he ranks in the league.
// value(id) is points a week, or null when there is nothing to go on.
export function depthChart({league,players,value}){
 const columns=depthSlots(league),cells={},spare={},spots={};for(const c of columns)spots[c.position]=Math.max(spots[c.position]||0,c.depth);
 for(const roster of league.rosters){
  const byPosition={};
  for(const id of (roster.players||[]).filter(id=>players[id]&&!(roster.taxi||[]).includes(id)&&!(roster.reserve||[]).includes(id))){const v=value(id);if(Number.isFinite(v))(byPosition[players[id].position]||=[]).push({id,points:round(v)})}
  for(const list of Object.values(byPosition))list.sort((a,b)=>b.points-a.points);
  cells[roster.roster_id]=columns.map(c=>byPosition[c.position]?.[c.depth-1]||null);
  // The best player who cannot start: what a team could give up at each position.
  spare[roster.roster_id]=Object.fromEntries(Object.keys(spots).map(position=>[position,byPosition[position]?.[spots[position]]||null]));
 }
 columns.forEach((column,i)=>{
  const ranked=league.rosters.map(r=>cells[r.roster_id][i]).filter(Boolean).sort((a,b)=>b.points-a.points);
  column.average=ranked.length?round(mean(ranked.map(c=>c.points))):null;
  ranked.forEach((cell,place)=>{cell.rank=place+1;cell.of=ranked.length;const share=ranked.length>1?place/(ranked.length-1):.5;cell.tone=share<=.2?'strong':share<=.4?'good':share<.6?'neutral':share<.8?'weak':'poor'});
 });
 return {columns,cells,spare};
}
// Points a game for every player, from the weeks he was on someone's roster and scored.
export function playerAverages(weeks){
 const sums={};
 for(const {matchups} of weeks)for(const m of matchups||[])for(const [id,points]of Object.entries(m.players_points||{})){if(!Number.isFinite(points)||points===0)continue;const row=sums[id]||={total:0,games:0};row.total+=points;row.games++}
 return Object.fromEntries(Object.entries(sums).map(([id,r])=>[id,round(r.total/r.games)]));
}

// One team's scores swing about 25 points a week, so a few results say little about how good it is.
// Results earn weight as they pile up: equal to the roster projection after OBSERVED_HALF games.
export const OBSERVED_HALF=8,RATING_SPREAD=8;
export function weeklySpread(season){
 const all=Object.values(season.rows).flatMap(r=>r.scores.filter(Boolean).map(s=>s.points));
 const prior=all.length?Math.max(12,mean(all)*.2):24;let squares=0,count=0;
 for(const row of Object.values(season.rows)){const played=row.scores.filter(Boolean).map(s=>s.points);if(played.length<2)continue;const m=mean(played);squares+=played.reduce((s,p)=>s+(p-m)**2,0);count+=played.length-1}
 return round(Math.sqrt((prior**2*10+squares)/(10+count)));
}
export function ratings({season,outlook}){
 const ids=Object.keys(season.rows).map(Number),seen=ids.filter(id=>season.rows[id].games),planned=ids.filter(id=>outlook?.[id]);
 const seenMean=mean(seen.map(id=>season.rows[id].average)),plannedMean=mean(planned.map(id=>outlook[id].points)),base=seen.length?seenMean:plannedMean;
 return Object.fromEntries(ids.map(id=>{
  const games=season.rows[id].games,weight=planned.length?games/(games+OBSERVED_HALF):games/(games+OBSERVED_HALF/2);
  const observed=games?season.rows[id].average-seenMean:0,roster=outlook?.[id]?outlook[id].points-plannedMean:0;
  return [id,round(base+weight*observed+(planned.length?(1-weight)*roster:0))];
 }));
}

// Share of a game still to play, from ESPN's period and clock.
export function gameRemaining(game){
 if(!game||game.state==='post')return 0;if(game.state==='pre')return 1;
 const period=Number(game.period),clock=/^(\d+):(\d+)/.exec(game.clock||'');
 if(!period||!clock)return .5;
 if(period>4)return .02;
 return Math.max(0,Math.min(1,((4-period)*15+Number(clock[1])+Number(clock[2])/60)/60));
}
const erf=x=>{const t=1/(1+.3275911*Math.abs(x)),y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*Math.exp(-x*x);return x<0?-y:y};
export function winChance(a,b){
 const spread=Math.hypot(a.sd,b.sd);if(a.mean===b.mean)return .5;if(spread<1e-9)return a.mean>b.mean?1:0;
 return .5*(1+erf((a.mean-b.mean)/spread/Math.SQRT2));
}
// This week for every team: points so far, where the score is heading, and how much is still to play.
// current: this is the NFL's current week, the only one today's injury designations decide.
export function liveWeek({league,players,projections={},games={},spread=24,current=true}){
 // Without the NFL schedule nobody can be called finished: a starter with points is taken as halfway, the rest as yet to play.
 const teams={},known=Object.keys(games).length>0;
 for(const m of league.matchups||[]){
  let open=0,planned=0,remaining=0;const counts={pre:0,live:0,done:0};let top=null;
  const starters=(m.starters||[]).filter(id=>players[id]);
  for(const id of starters){
   const points=Number(m.players_points?.[id])||0,game=games[players[id].team],left=known?(game?gameRemaining(game):0):points?.5:1,plan=current&&ruledOut(players[id])&&(!game||game.state==='pre')?0:Math.max(0,projected(projections[id]?.stats,league.scoring_settings)||0);
   counts[!known?(points?'live':'pre'):!game||game.state==='post'?'done':game.state==='pre'?'pre':'live']++;
   planned+=plan;open+=plan*left;remaining+=left;
   if(points>0&&(!top||points>top.points))top={id,points};
  }
  // A starter with no projection still has football to play, so he keeps the score uncertain.
  const points=score(m),share=planned>0&&(open>0||!remaining)?open/planned:starters.length?remaining/starters.length:0;
  // Bonuses and corrections live in the team total, so the projection builds on it, not on the starters' sum.
  teams[m.roster_id]={rosterId:m.roster_id,matchupId:m.matchup_id,points:round(points),mean:round(points+open),sd:round(spread*Math.sqrt(Math.max(0,Math.min(1,share)))),share:round(share,4),counts,top};
 }
 const games_=pairings(league.matchups).map(([a,b])=>({teams:[a,b],chance:round(winChance(teams[a],teams[b]),4),margin:round(Math.abs(teams[a].mean-teams[b].mean))}));
 const list=Object.values(teams);
 return {teams,games:games_,known,started:list.some(t=>t.points!==0||t.counts.live||t.counts.done),// Final means every starter's game is over, not that little projection is left.
  complete:known&&list.length>0&&list.some(t=>t.points>0)&&list.every(t=>!t.counts.live&&!t.counts.pre)};
}

// Both lineups of one matchup, slot by slot, the way Sleeper lays a matchup out: starters in lineup
// order, then the bench, each with points so far, the pregame projection and where he is heading.
export const SLOT_LABELS={FLEX:'FLX',SUPER_FLEX:'SF',REC_FLEX:'W/T',WRRB_FLEX:'W/R',IDP_FLEX:'IDP'};
export function matchupDetail({league,players,projections={},games={},rosterIds,current=true}){
 const slots=activeSlots(league),known=Object.keys(games).length>0;
 const line=(m,id)=>{
  if(!id||id==='0'||!players[id])return {id:null,points:0,projection:null,heading:0,state:'empty',game:null};
  const points=Number(m.players_points?.[id])||0,game=games[players[id].team]||null,projection=current&&ruledOut(players[id])&&(!game||game.state==='pre')?0:projected(projections[id]?.stats,league.scoring_settings);
  const state=!known?'unknown':!game?'bye':game.state==='post'?'done':game.state==='pre'?'pre':'live',left=state==='pre'||state==='unknown'?1:state==='live'?gameRemaining(game):0;
  return {id,points:round(points),projection:Number.isFinite(projection)?round(projection):null,heading:round(points+Math.max(0,projection||0)*left),state,game};
 };
 const sides=rosterIds.map(rosterId=>{
  const m=(league.matchups||[]).find(x=>x.roster_id===rosterId),roster=(league.rosters||[]).find(r=>r.roster_id===rosterId);if(!m)return null;
  const starting=m.starters||[],reserve=new Set(roster?.reserve||[]),taxi=new Set(roster?.taxi||[]),parked=id=>reserve.has(id)?'IR':taxi.has(id)?'TAXI':'BN';
  const starters=slots.map((slot,i)=>({slot,label:SLOT_LABELS[slot]||slot,...line(m,starting[i])}));
  const bench=(m.players||roster?.players||[]).filter(id=>!starting.includes(id)&&players[id]).map(id=>({slot:parked(id),label:parked(id),...line(m,id)})).sort((a,b)=>(a.slot!=='BN')-(b.slot!=='BN')||b.points-a.points||(b.projection||0)-(a.projection||0));
  return {rosterId,points:round(score(m)),heading:round(score(m)+starters.reduce((s,p)=>s+p.heading-p.points,0)),projection:round(starters.reduce((s,p)=>s+(p.projection||0),0)),starters,bench,benchPoints:round(bench.filter(p=>p.slot==='BN').reduce((s,p)=>s+p.points,0))};
 });
 return sides.includes(null)?null:{slots,sides};
}

function random(seed){let a=seed>>>0;const next=()=>{a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
 let spare=null;return ()=>{if(spare!==null){const s=spare;spare=null;return s}let u;do u=next();while(u<1e-12);const r=Math.sqrt(-2*Math.log(u)),angle=2*Math.PI*next();spare=r*Math.sin(angle);return r*Math.cos(angle)}}
// Seed order for a bracket of 2, 4, 8, 16: 1 meets the lowest seed, and 1 and 2 can only meet in the final.
const bracketOrder=size=>{let order=[1];while(order.length<size)order=order.flatMap(s=>[s,order.length*2+1-s]);return order};

// Plays out the rest of the regular season many times. Every run draws how good each team really is
// around its rating, so early in the year the odds stay humble, then draws each remaining score.
// standing: {rosterId: {wins, losses, ties, pf, division?}}. current: {games, teams} from liveWeek, or null.
// future: [{week, pairs}]. Seeding is by record, then points for; division winners seed first.
export function simulate({league,rating,standing,current=null,future=[],spread=24,ratingSpread=RATING_SPREAD,runs=4000,seed=1}){
 const shape=leagueShape(league),ids=Object.keys(rating).map(Number),n=ids.length,at=new Map(ids.map((id,i)=>[id,i])),normal=random(seed);
 const tally=()=>new Float64Array(n),out={playoff:tally(),bye:tally(),top:tally(),title:tally(),wins:tally(),seed:tally(),winRuns:tally(),winMade:tally(),lossRuns:tally(),lossMade:tally()};
 const seeds=ids.map(()=>new Float64Array(n)),divisionOf=ids.map(id=>shape.divisions?Number(standing[id]?.division)||0:0);
 const weeks=[...(current?[{pairs:current.games.map(g=>g.teams),live:current.teams}]:[]),...future];
 const order=bracketOrder(shape.playoffTeams+shape.byes);
 const wins=new Float64Array(n),pf=new Float64Array(n),truth=new Float64Array(n),points=new Float64Array(n),result=new Int8Array(n);
 for(let run=0;run<runs;run++){
  for(let i=0;i<n;i++){const s=standing[ids[i]]||{};wins[i]=(s.wins||0)+(s.ties||0)/2;pf[i]=s.pf||0;truth[i]=rating[ids[i]]+normal()*ratingSpread;result[i]=0}
  weeks.forEach((week,w)=>{
   const playing=[];
   for(const pair of week.pairs){
    const [a,b]=pair.map(id=>at.get(id));if(a===undefined||b===undefined)continue;
    for(const i of [a,b]){const live=week.live?.[ids[i]];points[i]=live?live.mean+normal()*live.sd:truth[i]+normal()*spread;pf[i]+=points[i];playing.push(i)}
    if(points[a]===points[b]){wins[a]+=.5;wins[b]+=.5}else{const won=points[a]>points[b]?a:b;wins[won]++;if(w===0&&current){result[won]=1;result[won===a?b:a]=-1}}
   }
   if(shape.medianGame&&playing.length>1){const line=median(playing.map(i=>points[i]));for(const i of playing)wins[i]+=points[i]>line?1:points[i]===line?.5:0}
  });
  const ranked=[...ids.keys()].sort((a,b)=>wins[b]-wins[a]||pf[b]-pf[a]);
  if(shape.divisions){const champs=new Set();for(const i of ranked)if(divisionOf[i]&&![...champs].some(c=>divisionOf[c]===divisionOf[i]))champs.add(i);ranked.sort((a,b)=>champs.has(b)-champs.has(a))}
  ranked.forEach((i,place)=>{seeds[i][place]++;out.seed[i]+=place+1;out.wins[i]+=wins[i];
   const made=place<shape.playoffTeams;if(made)out.playoff[i]++;if(place<shape.byes)out.bye[i]++;if(place===0)out.top[i]++;
   if(result[i]===1){out.winRuns[i]++;if(made)out.winMade[i]++}if(result[i]===-1){out.lossRuns[i]++;if(made)out.lossMade[i]++}});
  let field=order.map(s=>s<=shape.playoffTeams?ranked[s-1]:null);
  while(field.length>1){const next=[];for(let g=0;g<field.length;g+=2){const [a,b]=[field[g],field[g+1]];next.push(a===null?b:b===null?a:truth[a]+normal()*spread>=truth[b]+normal()*spread?a:b)}field=next}
  if(field[0]!==null&&field[0]!==undefined)out.title[field[0]]++;
 }
 return Object.fromEntries(ids.map((id,i)=>[id,{playoff:out.playoff[i]/runs,bye:out.bye[i]/runs,topSeed:out.top[i]/runs,title:out.title[i]/runs,wins:round(out.wins[i]/runs,1),seed:round(out.seed[i]/runs,1),seeds:[...seeds[i]].map(c=>c/runs),
  ifWin:out.winRuns[i]>=runs*.02?out.winMade[i]/out.winRuns[i]:null,ifLoss:out.lossRuns[i]>=runs*.02?out.lossMade[i]/out.lossRuns[i]:null}]));
}

// past: [{week, matchups}] before the current week. future: [{week, matchups}] after it, scores empty.
export function leagueOutlook({league,players,past=[],future=[],currentWeek,isNflWeek=true,projections={},games={},runs=4000,rosterMemo=(weeks,compute)=>compute()}){
 const shape=leagueShape(league),regular=currentWeek<shape.playoffStart;
 const first=seasonSoFar({league,players,weeks:past}),live=liveWeek({league,players,projections:projections[currentWeek],games,spread:weeklySpread(first),current:isNflWeek});
 // Once every game is final the current week is a result like any other.
 const closed=regular&&live.complete,finished=closed?[...past,{week:currentWeek,matchups:league.matchups}]:past,season=closed?seasonSoFar({league,players,weeks:finished}):first;
 const spread=weeklySpread(season),ahead=Object.keys(projections).map(Number).filter(w=>w>=currentWeek+(closed?1:0)&&w<=18).sort((a,b)=>a-b);
 const outlook=rosterMemo(ahead,()=>rosterOutlook({league,players,projections,weeks:ahead})),rating=ratings({season,outlook});
// Depth charts: what each player has scored a game, and what he projects to score in the weeks he plays.
 const scored=playerAverages(finished);
 const planned=id=>{const list=ahead.map(w=>projected(projections[w]?.[id]?.stats,league.scoring_settings)).filter(Number.isFinite);return list.length?mean(list):null};
 const depth={season:season.games?depthChart({league,players,value:id=>scored[id]??null}):null,roster:ahead.length?depthChart({league,players,value:planned}):null};
 const schedule=future.filter(w=>w.week>currentWeek&&w.week<shape.playoffStart).map(w=>({week:w.week,pairs:pairings(w.matchups)}));
 const current=regular&&!closed&&live.games.length?live:null;
 const standing=Object.fromEntries(league.rosters.map(r=>[r.roster_id,{...season.rows[r.roster_id],division:r.settings?.division}]));
 const ratingSpread=round(Math.sqrt(1/(season.games/spread**2+1/RATING_SPREAD**2)));
 const seed=Number(String(league.league_id).slice(-6))||1,odds=simulate({league,rating,standing,current,future:schedule,spread,ratingSpread,runs,seed});
 const opponents=Object.fromEntries(league.rosters.map(r=>[r.roster_id,[]]));
 for(const pairs of [...(current?[current.games.map(g=>g.teams)]:[]),...schedule.map(w=>w.pairs)])for(const [a,b] of pairs){opponents[a]?.push(b);opponents[b]?.push(a)}
 const rows=league.rosters.map(r=>{const id=r.roster_id;return {rosterId:id,mine:id===league.mine?.roster_id,...teamName(league,id),...season.rows[id],rating:rating[id],roster:outlook[id],odds:odds[id],live:live.teams[id]||null,
  schedule:opponents[id].length?round(mean(opponents[id].map(o=>rating[o]))):null,gamesLeft:opponents[id].length}});
 const by=(key,pick)=>[...rows].sort((a,b)=>pick(b)-pick(a)).forEach((row,i)=>{row[key]=i+1});
 by('powerRank',r=>r.rating);by('seasonRank',r=>r.average??-1);by('rosterRank',r=>r.roster?.points??-1);by('scheduleRank',r=>-(r.schedule??Infinity));
 rows.sort((a,b)=>b.odds.playoff-a.odds.playoff||b.wins+b.ties/2-(a.wins+a.ties/2)||b.pf-a.pf||b.rating-a.rating);
 // What a what-if needs to replay the season with different rosters. Kept off the enumerable result so it is never serialised.
 const result={shape,rows,depth,weeks:season.weeks,games:season.games,live,current:!!current,closed,regular,spread,weeksLeft:schedule.length+(current?1:0),scheduledGames:schedule.reduce((n,w)=>n+w.pairs.length,current?current.games.length:0),projectedWeeks:ahead,runs};
 Object.defineProperty(result,'context',{value:{league,players,projections,ahead,season,outlook,standing,current,schedule,spread,ratingSpread,seed,baselines:new Map()}});
 return result;
}

// Playoff and title odds before and after rosters change: a trade, a pickup, a drop. Only the changed
// rosters are rated again, and both seasons are played with the same random numbers, so the difference
// is the move and not the dice. This week's live scores stay as they are: the lineups are already set.
// changes: [{rosterId, add, remove}]. horizon: {key, projections, weeks} rates every roster over other
// weeks than the page's own, such as the rest of the season a trade was judged on.
export function rosterOdds(result,changes,{runs=2000,horizon=null,memo=(key,compute)=>compute()}={}){
 const c=result?.context;if(!c||!result.regular||!result.weeksLeft)return null;
 const key=`${runs}:${horizon?.key??'near'}`,projections=horizon?.projections||c.projections,weeks=horizon?.weeks||c.ahead;
 const play=outlook=>simulate({league:c.league,rating:ratings({season:c.season,outlook}),standing:c.standing,current:c.current,future:c.schedule,spread:c.spread,ratingSpread:c.ratingSpread,runs,seed:c.seed});
 // Rating every roster over the horizon does not depend on live scores, so the caller may keep it.
 if(!c.baselines.has(key)){const outlook=horizon?memo(horizon.key,()=>rosterOutlook({league:c.league,players:c.players,projections,weeks})):c.outlook;c.baselines.set(key,{outlook,odds:play(outlook)})}
 const base=c.baselines.get(key),rosters=changes.map(({rosterId,add=[],remove=[]})=>{const roster=c.league.rosters.find(r=>r.roster_id===rosterId);return roster&&base.outlook[rosterId]?{...roster,players:(roster.players||[]).filter(id=>!remove.includes(id)).concat(add)}:null});
 if(!rosters.length||rosters.includes(null))return null;
 const moved=rosterOutlook({league:{...c.league,rosters},players:c.players,projections,weeks}),after=play({...base.outlook,...moved});
 return Object.fromEntries(changes.map(({rosterId:id})=>[id,{playoff:[base.odds[id].playoff,after[id].playoff],title:[base.odds[id].title,after[id].title],roster:[base.outlook[id].points,moved[id].points]}]));
}
export function tradeOdds(result,{partnerId,give,get,dropA=[],dropB=[]},options){
 const mine=result?.context?.league.mine?.roster_id,odds=rosterOdds(result,[{rosterId:mine,add:get,remove:[...give,...dropA]},{rosterId:partnerId,add:give,remove:[...get,...dropB]}],options);
 return odds&&{mine:odds[mine],partner:odds[partnerId]};
}

