import test from 'node:test';
import assert from 'node:assert/strict';
import {seasonSoFar,rosterOutlook,ratings,weeklySpread,gameRemaining,winChance,liveWeek,simulate,leagueOutlook,leagueShape,pairings,teamName} from '../dist/league.js';

const P=(position,team)=>({position,fantasy_positions:[position],team});
const entry=(roster_id,matchup_id,points,extra={})=>({roster_id,matchup_id,points,...extra});
const four=(settings={})=>({league_id:'900001',settings:{playoff_teams:2,playoff_week_start:15,...settings},scoring_settings:{pts:1},roster_positions:['QB','BN'],
 rosters:[1,2,3,4].map(id=>({roster_id:id,owner_id:`u${id}`,players:[`qb${id}`],starters:[`qb${id}`]})),users:[{user_id:'u1',display_name:'ann',metadata:{team_name:'Aces'}},{user_id:'u2',display_name:'bo'}],mine:{roster_id:1},matchups:[]});
const players=Object.fromEntries([1,2,3,4].map(id=>[`qb${id}`,P('QB',`T${id}`)]));
const week=(n,scores)=>({week:n,matchups:[entry(1,1,scores[0],{starters:['qb1'],players_points:{qb1:scores[0]}}),entry(2,1,scores[1]),entry(3,2,scores[2]),entry(4,2,scores[3])]});

test('league shape reads the playoff field, byes and the median game',()=>{
 assert.deepEqual(leagueShape({rosters:Array(12).fill({}),settings:{playoff_teams:6,playoff_week_start:15,league_average_match:1}}),{teams:12,playoffTeams:6,byes:2,playoffStart:15,startWeek:1,medianGame:true,divisions:0});
 assert.equal(leagueShape({rosters:Array(10).fill({}),settings:{playoff_teams:4}}).byes,0);
 assert.deepEqual(pairings([entry(1,1,0),entry(2,1,0),entry(3,null,0)]),[[1,2]],'a team without a matchup has the week off');
 assert.deepEqual(teamName(four(),1),{team:'Aces',manager:'ann'});assert.deepEqual(teamName(four(),2),{team:'bo',manager:null});assert.equal(teamName(four(),4).team,'Team 4');
});

test('the season so far: records, all-play, luck, and weeks nobody scored in are skipped',()=>{
 const season=seasonSoFar({league:four(),players,weeks:[week(1,[100,90,120,110]),week(2,[80,70,60,130]),week(3,[0,0,0,0])]});
 assert.equal(season.games,2);assert.deepEqual(season.weeks.map(w=>w.week),[1,2]);
 const a=season.rows[1],c=season.rows[3];
 assert.deepEqual([a.wins,a.losses,a.pf,a.pa,a.average,a.high,a.low],[2,0,180,160,90,100,80]);
 assert.deepEqual([a.allPlayWins,a.allPlayLosses],[3,3]);
 assert.equal(a.luck,1,'two wins where the scores earned one against the whole league');
 assert.deepEqual([c.wins,c.losses,c.luck],[1,1,0]);
 assert.equal(a.byPosition.QB,90,'starter points are averaged by position');
 assert.deepEqual(a.scores.map(s=>s?.diff),[-5,-5,undefined]);
});

test('a median league adds a second result every week',()=>{
 const season=seasonSoFar({league:four({league_average_match:1}),players,weeks:[week(1,[100,90,120,110])]});
 assert.deepEqual([season.rows[1].wins,season.rows[1].losses],[1,1],'won the matchup, under the median');
 assert.deepEqual([season.rows[3].wins,season.rows[3].losses],[2,0]);assert.deepEqual([season.rows[2].wins,season.rows[2].losses],[0,2]);
});

test('roster outlook fields the best lineup each week, so a bye costs points',()=>{
 const league=four();league.rosters[0].players=['qb1','qb2x'];const all={...players,qb2x:P('QB','T9')};
 const projections={2:{qb1:{stats:{pts:20}},qb2x:{stats:{pts:12}},qb2:{stats:{pts:15}}},3:{qb2x:{stats:{pts:12}},qb2:{stats:{pts:15}}},4:{}};
 const outlook=rosterOutlook({league,players:all,projections,weeks:[2,3,4]});
 assert.deepEqual([outlook[1].points,outlook[1].byPosition.QB,outlook[1].weeks],[16,16,[2,3]]);assert.equal(outlook[2].points,15);assert.equal(outlook[3].points,0);
 assert.equal(rosterOutlook({league,players:all,projections:{},weeks:[2]})[1],null,'no projections, no outlook');
});

test('ratings lean on the roster early and on results later',()=>{
 const rows=games=>({rows:{1:{games,average:games?130:null,scores:[]},2:{games,average:games?100:null,scores:[]}}}),outlook={1:{points:100},2:{points:120}};
 assert.deepEqual(ratings({season:rows(0),outlook}),{1:100,2:120});
 const early=ratings({season:rows(1),outlook}),late=ratings({season:rows(12),outlook});
 assert.ok(early[1]<early[2],'one big week does not outweigh the roster');assert.ok(late[1]>late[2],'twelve weeks do');
 assert.equal(early[1]+early[2],230,'ratings stay centred on what the league actually scores');
 const blind=ratings({season:rows(4),outlook:{}});assert.ok(blind[1]>blind[2]&&blind[1]<130,'with no projections, results are pulled toward the average');
});

test('weekly spread starts from a prior and learns from repeated scores',()=>{
 const flat=s=>({rows:{1:{scores:s.map(points=>({points}))}}});
 assert.equal(weeklySpread({rows:{}}),24);
 assert.ok(weeklySpread(flat([100,100,100,100,100,100,100,100,100,100,100,100]))<weeklySpread(flat([100])));
 assert.ok(weeklySpread(flat([60,140,60,140,60,140,60,140,60,140,60,140]))>weeklySpread(flat([100])));
});

test('game clock and win chance',()=>{
 assert.deepEqual([{state:'pre'},{state:'post'},{state:'in',period:1,clock:'15:00'},{state:'in',period:3,clock:'7:30'},{state:'in',period:5,clock:'4:00'},{state:'in'}].map(gameRemaining),[1,0,1,.375,.02,.5]);
 assert.equal(winChance({mean:100,sd:10},{mean:100,sd:10}),.5);assert.equal(winChance({mean:101,sd:0},{mean:100,sd:0}),1);assert.equal(winChance({mean:100,sd:0},{mean:100,sd:0}),.5);
 const p=winChance({mean:110,sd:15},{mean:100,sd:15});assert.ok(p>.65&&p<.72,`about two in three, got ${p}`);
});

test('the live week adds projections only for football still to be played',()=>{
 const league={...four(),matchups:[entry(1,1,30,{starters:['qb1','0'],players_points:{qb1:30}}),entry(2,1,8,{starters:['qb2'],players_points:{qb2:8}}),entry(3,2,0,{starters:['qb3'],players_points:{}}),entry(4,2,22.5,{starters:['qb4'],players_points:{qb4:22.5}})]};
 const projections=Object.fromEntries([1,2,3,4].map(id=>[`qb${id}`,{stats:{pts:20}}]));
 const games={T1:{state:'post'},T2:{state:'in',period:2,clock:'15:00'},T3:{state:'pre'},T4:{state:'post'}};
 const live=liveWeek({league,players,projections,games,spread:20});
 assert.deepEqual([live.teams[1].mean,live.teams[1].sd,live.teams[1].share],[30,0,0]);
 assert.deepEqual([live.teams[2].mean,live.teams[2].share,live.teams[2].counts.live],[23,.75,1],'three quarters of 20 still to come');
 assert.deepEqual([live.teams[3].mean,live.teams[3].sd,live.teams[3].counts.pre],[20,20,1]);
 assert.equal(live.teams[1].top.id,'qb1');assert.equal(live.games.length,2);assert.ok(live.games[0].chance>.5);assert.equal(live.complete,false);assert.equal(live.started,true);
 const final=liveWeek({league,players,projections,games:{T1:{state:'post'},T2:{state:'post'},T3:{state:'post'},T4:{state:'post'}}});
 assert.equal(final.complete,true);assert.equal(final.games[0].chance,1);
 const blind=liveWeek({league,players,projections,games:{}});
 assert.equal(blind.complete,false,'with no NFL schedule the week is never called final');assert.equal(blind.known,false);assert.equal(blind.teams[3].share,1);
});

test('simulation: odds add up, the better team is favoured, and the same inputs give the same answer',()=>{
 const league=four(),rating={1:130,2:110,3:110,4:90},standing=Object.fromEntries([1,2,3,4].map(id=>[id,{wins:0,losses:0,ties:0,pf:0}]));
 const future=Array.from({length:12},(_,i)=>({week:i+2,pairs:i%2?[[1,2],[3,4]]:[[1,3],[2,4]]}));
 const odds=simulate({league,rating,standing,future,runs:3000,seed:7});
 const total=key=>Object.values(odds).reduce((s,o)=>s+o[key],0);
 assert.ok(Math.abs(total('playoff')-2)<1e-9,'two playoff spots');assert.ok(Math.abs(total('title')-1)<1e-9);assert.ok(Math.abs(total('topSeed')-1)<1e-9);
 assert.ok(odds[1].playoff>odds[2].playoff&&odds[2].playoff>odds[4].playoff);assert.ok(odds[1].playoff>.8&&odds[4].playoff<.2);
 assert.ok(Math.abs(odds[1].seeds.reduce((s,p)=>s+p,0)-1)<1e-9);assert.equal(odds[1].ifWin,null,'no game in progress, no swing');
 assert.deepEqual(simulate({league,rating,standing,future,runs:3000,seed:7}),odds);
});

test('simulation: a finished season is certain, and this week’s result moves the odds',()=>{
 const league=four(),rating={1:100,2:100,3:100,4:100};
 const done=simulate({league,rating,standing:{1:{wins:9,pf:1200},2:{wins:9,pf:1300},3:{wins:4,pf:1500},4:{wins:2,pf:900}},runs:200});
 assert.deepEqual([1,2,3,4].map(id=>done[id].playoff),[1,1,0,0]);assert.equal(done[2].topSeed,1,'points for breaks the tie');
 const standing=Object.fromEntries([1,2,3,4].map(id=>[id,{wins:5,losses:5,ties:0,pf:1000}]));
 const current={games:[{teams:[1,2]},{teams:[3,4]}],teams:Object.fromEntries([1,2,3,4].map(id=>[id,{mean:100,sd:20}]))};
 const odds=simulate({league,rating,standing,current,future:[{week:14,pairs:[[1,3],[2,4]]}],runs:4000,seed:3});
 assert.ok(odds[1].ifWin>odds[1].playoff&&odds[1].playoff>odds[1].ifLoss,'winning helps, losing hurts');
 const decided={...current,teams:{...current.teams,1:{mean:150,sd:0},2:{mean:90,sd:0}}};
 const locked=simulate({league,rating,standing,current:decided,future:[],runs:500,seed:3});
 assert.equal(locked[2].ifWin,null,'a result that never happens has no odds');assert.ok(locked[1].playoff>locked[2].playoff);
});

test('simulation: the median game and division winners change who gets in',()=>{
 const league=four({league_average_match:1}),rating={1:100,2:100,3:100,4:100},standing=Object.fromEntries([1,2,3,4].map(id=>[id,{wins:0,pf:0}]));
 const odds=simulate({league,rating,standing,future:[{week:2,pairs:[[1,2],[3,4]]}],runs:500,seed:2});
 assert.ok(Math.abs(Object.values(odds).reduce((s,o)=>s+o.wins,0)-4)<.2,'two matchup wins and two median wins a week');
 const split=simulate({league:four({divisions:2}),rating,standing:{1:{wins:9,pf:9,division:1},2:{wins:8,pf:8,division:1},3:{wins:2,pf:2,division:2},4:{wins:1,pf:1,division:2}},runs:50});
 assert.deepEqual([split[1].playoff,split[2].playoff,split[3].playoff],[1,0,1],'the weak division’s winner takes a seed');
});

test('league outlook ties it together, and closes a week only when every game is final',()=>{
 const league={...four(),matchups:[entry(1,1,140,{starters:['qb1'],players_points:{qb1:140}}),entry(2,1,90,{starters:['qb2'],players_points:{qb2:90}}),entry(3,2,100,{starters:['qb3'],players_points:{qb3:100}}),entry(4,2,95,{starters:['qb4'],players_points:{qb4:95}})]};
 const projections={2:Object.fromEntries([1,2,3,4].map(id=>[`qb${id}`,{stats:{pts:100+id}}])),3:Object.fromEntries([1,2,3,4].map(id=>[`qb${id}`,{stats:{pts:100+id}}]))};
 const future=[3,4,15].map(w=>({week:w,matchups:[entry(1,1,0),entry(3,1,0),entry(2,2,0),entry(4,2,0)]})),past=[week(1,[100,90,120,110])];
 const open=leagueOutlook({league,players,past,future,currentWeek:2,projections,games:{T1:{state:'pre'},T2:{state:'pre'},T3:{state:'pre'},T4:{state:'pre'}},runs:400});
 assert.deepEqual([open.games,open.current,open.closed,open.weeksLeft,open.scheduledGames],[1,true,false,3,6],'playoff weeks are not part of the race');
 assert.equal(open.rows.length,4);assert.ok(open.rows.every(r=>r.odds&&r.live&&r.roster));assert.equal(open.rows.find(r=>r.mine).rosterId,1);
 assert.deepEqual(open.projectedWeeks,[2,3]);
 let asked=0;const closed=leagueOutlook({league,players,past,future,currentWeek:2,projections,games:{T1:{state:'post'},T2:{state:'post'},T3:{state:'post'},T4:{state:'post'}},runs:400,rosterMemo:(weeks,compute)=>{asked++;return compute()}});
 assert.deepEqual([closed.games,closed.current,closed.closed,closed.weeksLeft],[2,false,true,2]);assert.equal(closed.rows.find(r=>r.rosterId===1).wins,2);assert.deepEqual(closed.projectedWeeks,[3]);assert.equal(asked,1);
 const playoffs=leagueOutlook({league,players,past,future:[],currentWeek:15,projections:{},games:{},runs:50});
 assert.deepEqual([playoffs.regular,playoffs.weeksLeft,playoffs.current],[false,0,false]);
});

import {positionRadar,depthSlots,depthChart,playerAverages} from '../dist/league.js';
test('team shapes are ratios to the league average on one capped scale',()=>{
 const row=(rosterId,QB,RB,WR)=>({rosterId,by:{QB,RB,WR,TE:0}}),rows=[row(1,30,40,20),row(2,10,40,40),{rosterId:3,by:null}];
 const radar=positionRadar(rows,r=>r.by);
 assert.deepEqual(radar.axes,[{position:'QB',average:20},{position:'RB',average:40},{position:'WR',average:30}],'a position nobody scores at is not an axis');
 assert.deepEqual(radar.teams.map(t=>t.ratios),[[1.5,1,.667],[.5,1,1.333]]);assert.deepEqual([radar.low,radar.high],[.5,1.5]);
 const wild=positionRadar([row(1,100,40,20),row(2,0,40,40)],r=>r.by);assert.deepEqual([wild.low,wild.high],[.4,1.6],'an outlier cannot stretch the scale past 160%');
 assert.equal(positionRadar([row(1,1,1,1)],r=>r.by),null,'one team has nobody to compare with');assert.equal(positionRadar([{rosterId:1,by:{QB:1,RB:1}},{rosterId:2,by:{QB:1,RB:1}}],r=>r.by),null,'two axes make no shape');
});
test('depth spots follow the lineup: a flex adds a back and a receiver, superflex a quarterback',()=>{
 const labels=roster_positions=>depthSlots({roster_positions}).map(c=>c.label).join(' ');
 assert.equal(labels(['QB','RB','RB','WR','WR','TE','FLEX','K','DEF','BN','IR']),'QB RB1 RB2 RB3 WR1 WR2 WR3 TE K DEF');
 assert.equal(labels(['QB','RB','WR','TE','SUPER_FLEX']),'QB1 QB2 RB1 RB2 WR1 WR2 TE');assert.equal(labels(['QB','RB','WR']),'QB RB WR');
});
test('depth chart ranks every team’s best players spot by spot',()=>{
 const players={q1:P('QB'),q2:P('QB'),r1:P('RB'),r2:P('RB'),r3:P('RB'),r4:P('RB'),taxi:P('RB')},value=id=>({q1:20,q2:25,r1:15,r2:9,r3:18,r4:null,taxi:30})[id];
 const league={roster_positions:['QB','RB','RB'],rosters:[{roster_id:1,players:['q1','r2','r1']},{roster_id:2,players:['q2','r3','r4','taxi'],taxi:['taxi']}]};
 const chart=depthChart({league,players,value});
 assert.deepEqual(chart.columns.map(c=>[c.label,c.average]),[['QB',22.5],['RB1',16.5],['RB2',9]]);
 assert.deepEqual(chart.cells[1].map(c=>c&&[c.id,c.rank,c.tone]),[['q1',2,'poor'],['r1',2,'poor'],['r2',1,'neutral']]);
 assert.deepEqual(chart.cells[2].map(c=>c&&c.id),['q2','r3',null],'no projection and the taxi squad do not count');
});
test('player averages skip the weeks a player did not score',()=>{
 assert.deepEqual(playerAverages([{matchups:[{players_points:{a:10,b:0}}]},{matchups:[{players_points:{a:20}},{players_points:{b:7,c:-1}}]}]),{a:15,b:7,c:-1});
});

import {tradeOdds} from '../dist/league.js';
test('a trade what-if moves both teams’ odds the way the rosters moved, and repeats exactly',()=>{
 const two=['qb1','qb2','qb3','qb4','bench1'],all={...players,bench1:P('QB','T9')};
 const league={...four(),matchups:[]};league.rosters=league.rosters.map(r=>({...r,players:r.roster_id===1?['qb1','bench1']:[`qb${r.roster_id}`]}));league.mine=league.rosters[0];
 const stats=Object.fromEntries(two.map((id,i)=>[id,{stats:{pts:[110,100,100,90,60][i]}}])),projections={2:stats,3:stats};
 const future=[2,3,4,5,6,7].map(w=>({week:w,matchups:w%2?[entry(1,1,0),entry(2,1,0),entry(3,2,0),entry(4,2,0)]:[entry(1,1,0),entry(3,1,0),entry(2,2,0),entry(4,2,0)]}));
 const o=leagueOutlook({league,players:all,past:[],future,currentWeek:1,projections,games:{},runs:500});
 assert.equal(JSON.stringify(o).includes('baselines'),false,'the what-if context is not serialised');
 const swap=tradeOdds(o,{partnerId:4,give:['qb1'],get:['qb4']},{runs:1500});
 assert.deepEqual(swap.mine.roster,[110,90]);assert.deepEqual(swap.partner.roster,[90,110]);
 assert.ok(swap.mine.playoff[1]<swap.mine.playoff[0]-.1,'giving away the best player costs odds');assert.ok(swap.partner.playoff[1]>swap.partner.playoff[0]+.1);
 assert.deepEqual(tradeOdds(o,{partnerId:4,give:['qb1'],get:['qb4']},{runs:1500}),swap,'same dice every time');
 const dropped=tradeOdds(o,{partnerId:4,give:['bench1'],get:['qb4'],dropA:['qb1']},{runs:1500});assert.deepEqual(dropped.mine.roster,[110,90],'a dropped player leaves the roster too');
 const horizon={key:'late',projections:{9:Object.fromEntries(two.map(id=>[id,{stats:{pts:100}}]))},weeks:[9]},level=tradeOdds(o,{partnerId:4,give:['qb1'],get:['qb4']},{runs:1500,horizon});
 assert.deepEqual(level.mine.roster,[100,100]);assert.ok(Math.abs(level.mine.playoff[1]-level.mine.playoff[0])<1e-9,'equal players over the trade’s own weeks change nothing');
 assert.equal(tradeOdds(o,{partnerId:99,give:['qb1'],get:['qb4']}),null);
 assert.equal(tradeOdds(leagueOutlook({league,players:all,past:[],future:[],currentWeek:15,projections,games:{},runs:50}),{partnerId:4,give:['qb1'],get:['qb4']}),null,'nothing to simulate once the regular season is over');
});
test('the depth chart knows each team’s best player who cannot start',()=>{
 const roster={q1:P('QB'),q2:P('QB'),q3:P('QB'),r1:P('RB')},value=id=>({q1:20,q2:17,q3:9,r1:12})[id];
 const chart=depthChart({league:{roster_positions:['QB','RB','FLEX'],rosters:[{roster_id:1,players:['q1','q3','q2','r1']},{roster_id:2,players:[]}]},players:roster,value});
 assert.equal(chart.spare[1].QB.id,'q2');assert.equal(chart.spare[1].RB,null,'one back and two running back spots leaves nobody spare');assert.equal(chart.spare[2].QB,null);
});

test('a week is final only when every starter’s game is over',()=>{
 const league={...four(),matchups:[entry(1,1,30,{starters:['qb1'],players_points:{qb1:30}}),entry(2,1,8,{starters:['qb2'],players_points:{qb2:8}}),entry(3,2,12,{starters:['qb3'],players_points:{qb3:12}}),entry(4,2,22,{starters:['qb4'],players_points:{qb4:22}})]};
 const over={T1:{state:'post'},T3:{state:'post'},T4:{state:'post'}},projections=Object.fromEntries([1,2,3,4].map(id=>[`qb${id}`,{stats:{pts:20}}]));
 const lastSeconds=liveWeek({league,players,projections,games:{...over,T2:{state:'in',period:4,clock:'0:08'}}});
 assert.equal(lastSeconds.complete,false,'eight seconds left is not final');assert.ok(lastSeconds.teams[2].sd>0);
 const unprojected=liveWeek({league,players,projections:{...projections,qb2:undefined},games:{...over,T2:{state:'in',period:1,clock:'12:00'}}});
 assert.equal(unprojected.complete,false);assert.ok(unprojected.teams[2].share>.5&&unprojected.teams[2].sd>0,'a live starter with no projection keeps the score uncertain');
});

import {matchupDetail} from '../dist/league.js';
test('a matchup opens into both lineups in slot order, with the bench and where each player is heading',()=>{
 const all={q:P('QB','A'),r:P('RB','B'),b1:P('RB','C'),ir:P('WR','D'),q2:P('QB','E'),r2:P('RB','F')};
 const league={scoring_settings:{pts:1},roster_positions:['QB','RB','FLEX','BN','IR'],rosters:[{roster_id:1,players:['q','r','b1','ir'],reserve:['ir']},{roster_id:2,players:['q2','r2']}],
  matchups:[{roster_id:1,matchup_id:1,points:30,starters:['q','r','0'],players:['q','r','b1','ir'],players_points:{q:20,r:10,b1:7,ir:0}},{roster_id:2,matchup_id:1,points:5,starters:['q2','r2','0'],players:['q2','r2'],players_points:{q2:5}}]};
 const projections=Object.fromEntries(Object.keys(all).map(id=>[id,{stats:{pts:16}}])),games={A:{state:'post'},B:{state:'in',period:3,clock:'15:00'},E:{state:'pre'},C:{state:'post'}};
 const {sides:[mine,theirs]}=matchupDetail({league,players:all,projections,games,rosterIds:[1,2]});
 assert.deepEqual(mine.starters.map(p=>[p.label,p.id,p.state,p.points,p.heading]),[['QB','q','done',20,20],['RB','r','live',10,18],['FLX',null,'empty',0,0]]);
 assert.deepEqual([mine.points,mine.heading,mine.projection,mine.benchPoints],[30,38,32,7]);
 assert.deepEqual(mine.bench.map(p=>[p.id,p.label]),[['b1','BN'],['ir','IR']],'injured reserve lists after the bench and does not count as bench points');
 assert.deepEqual(theirs.starters.map(p=>[p.id,p.state,p.heading]),[['q2','pre',21],['r2','bye',0],[null,'empty',0]]);
 assert.equal(matchupDetail({league,players:all,projections,games,rosterIds:[1,9]}),null);
});
