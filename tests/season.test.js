import test from 'node:test';
import assert from 'node:assert/strict';
import {seasonReview,pointsAllowed,matchup,verdict,tone,weekReview,moves,decisionLabel} from '../dist/season.js';

const P=(position,team)=>({position,fantasy_positions:[position],team});
const line=(pts,opponent,gp=1)=>({stats:{pts,gp},opponent});
const scoring={pts:1};

test('cells compare what was scored with what was projected, and a week off is not a zero',()=>{
 const players={rb:P('RB','BUF'),wr:P('WR','KC')};
 const league={scoring_settings:scoring,mine:{players:['rb','wr'],starters:['rb'],reserve:[]}};
 const weeks=[{week:1,stats:{rb:line(20,'NYJ'),wr:line(4,'DEN')},projections:{rb:line(12,'NYJ'),wr:line(10,'DEN')}},
  {week:2,stats:{wr:line(3,'LV')},projections:{rb:line(13,'MIA'),wr:line(9,'LV')}}];
 const {rows,weeks:listed}=seasonReview({league,players,weeks,currentWeek:3});
 assert.deepEqual(listed,[1,2]);
 const rb=rows.find(r=>r.id==='rb'),wr=rows.find(r=>r.id==='wr');
 assert.deepEqual(rb.cells.map(c=>c.diff),[8,null],'the missed week is left out');
 assert.deepEqual([rb.games,rb.total,rb.diff,rb.average,rb.starter],[1,20,8,8,true]);
 assert.deepEqual([wr.games,wr.diff,wr.average],[2,-12,-6]);assert.equal(wr.verdict.label,'Under-performing');
 assert.equal(rb.verdict.label,'Too early');assert.equal(rows[0].id,'rb','running backs list before receivers');
});
test('color steps and matchup thirds',()=>{
 assert.deepEqual([-6,-3,0,3,6,null].map(tone),['poor','weak','neutral','good','strong','none']);
 assert.equal(matchup({rank:2,of:32,average:9}).label,'Tough');assert.equal(matchup({rank:30,of:32,average:30}).label,'Easy');
 assert.equal(matchup({rank:16,of:32,average:18}).label,'Average');assert.equal(matchup({rank:1,of:4,average:9}),null,'too few teams to rank');
});
test('points allowed rank defenses by what each position scored against them, per game',()=>{
 const teams=['A','B','C','D','E','F','G','H'],players=Object.fromEntries(teams.map((t,i)=>[`rb${i}`,P('RB',t)]));
 const week=n=>({week:n,stats:Object.fromEntries(teams.map((t,i)=>[`rb${i}`,line(10+i*2,teams[(i+1)%8])]))});
 const table=pointsAllowed([week(1),week(2)],players,scoring);
 assert.deepEqual([table.B.RB.rank,table.B.RB.average,table.B.RB.of],[1,10,8]);assert.equal(table.A.RB.rank,8);
});
test('the read weighs form against the road ahead',()=>{
 const hard=[{matchup:{label:'Tough'}},{matchup:{label:'Tough'}},{matchup:{label:'Easy'}}],soft=[{matchup:{label:'Easy'}},{matchup:{label:'Easy'}}];
 assert.equal(verdict({games:3,average:-4,upcoming:hard}).label,'Shop or sit');
 assert.equal(verdict({games:3,average:-4,upcoming:soft}).label,'Under-performing');
 assert.equal(verdict({games:3,average:4,upcoming:hard}).label,'Sell high?');
 assert.equal(verdict({games:3,average:4,upcoming:soft}).label,'Rolling');
 assert.equal(verdict({games:3,average:.5,upcoming:[]}).label,'As expected');
});

const recapLeague={scoring_settings:scoring,roster_positions:['RB','FLEX','BN'],rosters:[{roster_id:1},{roster_id:2}],mine:{roster_id:1}};
const recapPlayers={rb1:P('RB','BUF'),rb2:P('RB','KC'),wr1:P('WR','SF'),rb3:P('RB','DAL'),wr2:P('WR','NYJ')};
const recapWeek=[
 {roster_id:1,matchup_id:1,starters:['rb1','wr1'],players:['rb1','wr1','rb2'],players_points:{rb1:5,wr1:6,rb2:20},points:11},
 {roster_id:2,matchup_id:1,starters:['rb3','wr2'],players:['rb3','wr2'],players_points:{rb3:10,wr2:8},points:18}];
const project=map=>Object.fromEntries(Object.entries(map).map(([id,pts])=>[id,{stats:{pts,gp:1}}]));

test('a week separates what the bench was holding from what the manager could have known',()=>{
 // Projections said start rb1 over rb2, and rb2 went off anyway: 15 left on the bench, nothing to answer for.
 const followed=weekReview({league:recapLeague,players:recapPlayers,week:4,matchups:recapWeek,projections:project({rb1:12,wr1:9,rb2:4,rb3:10,wr2:7})});
 const mine=followed.rows.find(r=>r.rosterId===1);
 assert.deepEqual([mine.started,mine.best,mine.left],[11,26,15],'the hindsight lineup plays rb2 and wr1');
 assert.equal(mine.cost,0,'the lineup that was set is the lineup the projections advised');
 assert.deepEqual([mine.result,mine.margin,mine.swung],['loss',-7,true],'lost by less than the bench was holding');
 assert.deepEqual(mine.decisions.map(d=>[d.sat,d.played,d.gained,d.foreseen,d.label]),[['rb2','rb1',15,-8,'defensible']]);

 // Same week, same result, but now the projections favoured the player left on the bench.
 const ignored=weekReview({league:recapLeague,players:recapPlayers,week:4,matchups:recapWeek,projections:project({rb1:6,wr1:9,rb2:15,rb3:10,wr2:7})});
 const same=ignored.rows.find(r=>r.rosterId===1);
 assert.deepEqual([same.left,same.cost],[15,-15],'ignoring the projections is what cost the points');
 assert.equal(same.decisions[0].label,'avoidable');
 assert.deepEqual([same.summary,ignored.summary.high,ignored.summary.low,ignored.summary.closest.margin],[undefined,18,11,7]);
 assert.equal(ignored.summary.leftOnBench,15,'roster 2 had nobody on the bench to regret');
});
test('a start/sit is only graded when both players were projected',()=>{
 assert.deepEqual([-4,0,4,null].map(decisionLabel),['defensible','toss-up','avoidable','unknown']);
 const blind=weekReview({league:recapLeague,players:recapPlayers,week:4,matchups:recapWeek,projections:project({wr1:9})});
 const mine=blind.rows.find(r=>r.rosterId===1);
 assert.deepEqual([mine.decisions[0].foreseen,mine.decisions[0].label],[null,'unknown']);
 assert.equal(mine.complete,false,'a lineup that cannot be fully projected says so');
});
test('a roster that did not play that week is reported, not counted',()=>{
 const {rows,summary}=weekReview({league:recapLeague,players:recapPlayers,week:4,matchups:[recapWeek[0]],projections:{}});
 assert.deepEqual(rows.find(r=>r.rosterId===2),{rosterId:2,played:false,decisions:[]});
 assert.deepEqual([summary.teams,rows[0].result,rows[0].opponentId],[1,null,null],'nobody to play means no result');
});
test('a starting slot left empty is charged against the manager, not written off as bad luck',()=>{
 // Only one starter was set, so the FLEX went empty: rb2 filling it is nobody's misfortune.
 const short=[{roster_id:1,matchup_id:1,starters:['rb1'],players:['rb1','wr1','rb2'],players_points:{rb1:5,wr1:6,rb2:20},points:5},
  {roster_id:2,matchup_id:1,starters:['rb3','wr2'],players:['rb3','wr2'],players_points:{rb3:10,wr2:8},points:18}];
 const {rows}=weekReview({league:recapLeague,players:recapPlayers,week:4,matchups:short,projections:project({rb1:12,wr1:9,rb2:4,rb3:10,wr2:7})});
 const mine=rows.find(r=>r.rosterId===1);
 assert.deepEqual([mine.started,mine.best,mine.left],[5,26,21]);
 // The biggest gain answers for the starter who was actually benched; what is left over fills the empty slot.
 assert.deepEqual(mine.decisions.map(d=>[d.sat,d.played,d.gained,d.foreseen,d.label]),
  [['rb2','rb1',15,-8,'defensible'],['wr1',null,6,9,'avoidable']],'an empty slot is measured against the zero it scored');
});
test('moves are graded on the week they were made, and a dropped player still has a stat line',()=>{
 const players={...recapPlayers,wrX:P('WR','LAR'),rbY:P('RB','MIA'),teZ:P('TE','PHI')};
 const matchups=[{roster_id:1,matchup_id:1,starters:['rb1','wrX'],players:['rb1','wrX'],players_points:{rb1:5,wrX:2},points:7},
  {roster_id:2,matchup_id:1,starters:['rb3','wr2'],players:['rb3','wr2','teZ'],players_points:{rb3:10,wr2:8,teZ:0},points:18}];
 const transactions=[
  {type:'waiver',status:'complete',roster_ids:[1],adds:{wrX:1},drops:{rbY:1},settings:{waiver_bid:23},created:1},
  {type:'free_agent',status:'complete',roster_ids:[2],adds:{teZ:2},drops:null,created:2},
  {type:'waiver',status:'failed',roster_ids:[2],adds:{rbY:2},settings:{waiver_bid:99},created:3},
  {type:'trade',status:'complete',roster_ids:[1,2],adds:{rb3:1,rb1:2},drops:{rb3:2,rb1:1},created:4}];
 // rbY was dropped and left unrostered, so only the week's stat line says what the cut cost.
 const {rows,summary}=moves({league:recapLeague,players,week:4,transactions,matchups,stats:{rbY:{stats:{pts:14,gp:1}}}});
 assert.equal(rows.length,3,'a failed claim never happened');
 assert.deepEqual([rows[0].bid,rows[0].adds[0].points,rows[0].drops[0].points,rows[0].net,rows[0].label],[23,2,14,-12,'backfired']);
 assert.equal(rows[1].label,'stashed','picked up and never started');
 assert.deepEqual(rows[2].sides,[{rosterId:1,received:['rb3'],sent:['rb1'],net:5},{rosterId:2,received:['rb1'],sent:['rb3'],net:-5}]);
 assert.equal(rows[2].label,undefined,'a trade has no single verdict');
 assert.deepEqual([summary.count,summary.trades,summary.spent,summary.best.net],[3,1,23,0]);
});

// Waivers clear after the week's last game, so Sleeper files a move for next week under this one,
// and even a Sunday evening pickup cannot claim the afternoon's points.
const sunday=Date.parse('2026-09-27T17:00:00Z'),monday=Date.parse('2026-09-28T20:15:00Z');
const kickoffs={LAR:{start:new Date(sunday).toISOString()},MIA:{start:new Date(monday).toISOString()}};
const claim=(at,bid,adds={wrX:1})=>({type:'waiver',status:'complete',roster_ids:[1],adds,settings:{waiver_bid:bid},created:at});
const thisWeek=[{roster_id:1,matchup_id:1,starters:['rb1'],players:['rb1','wrX','rbM'],players_points:{rb1:5,wrX:3,rbM:8},points:5}];
const nextWeek=[{roster_id:1,matchup_id:1,starters:['wrX'],players:['wrX'],players_points:{wrX:21},points:21}];
const timedPlayers={...recapPlayers,wrX:P('WR','LAR'),rbM:P('RB','MIA')};
const timing=(transactions,next={week:5,matchups:nextWeek,stats:{},complete:true})=>
 moves({league:recapLeague,players:timedPlayers,week:4,matchups:thisWeek,stats:{},games:kickoffs,next,transactions});

test('a move only claims the points of players whose game had not kicked off yet',()=>{
 const {rows}=timing([claim(sunday-3600000,9),claim(sunday+3600000,9)]);
 assert.deepEqual([rows[0].forWeek,rows[0].net,rows[0].label],[4,3,'unused bid'],'claimed before kickoff, so his week counts');
 assert.deepEqual([rows[1].forWeek,rows[1].net,rows[1].label],[5,21,'paid off'],'claimed after it, so the credit waits for the week he could play');
});
test('a move straddling two weeks waits for the later one',()=>{
 // Claimed after the Rams kicked off but before Miami did: one player has played, the other has not.
 const both=[claim(sunday+3600000,9,{wrX:1,rbM:1})];
 assert.deepEqual(timing(both).rows[0].adds.map(a=>a.forWeek),[5,4],'each player is placed on his own week');
 const pending=timing(both,{week:5,matchups:[],stats:{},complete:false}).rows[0];
 assert.deepEqual([pending.played,pending.net,pending.label],[false,null,'not played yet'],'ungraded until every player has a week on the board');
});
test('a move for a week nobody has played yet is reported without a verdict',()=>{
 const {rows,summary}=timing([claim(sunday+3600000,40)],{week:5,matchups:[],stats:{},complete:false});
 assert.deepEqual([rows[0].forWeek,rows[0].played,rows[0].net,rows[0].label],[5,false,null,'not played yet']);
 assert.deepEqual([rows[0].adds[0].points,summary.pending,summary.spent],[null,1,40],'$40 spent is known; what it bought is not');
 assert.equal(summary.best,null,'nothing to crown when nothing has been played');
});
test('without kickoff times every move stays on its own week',()=>{
 const {rows,summary}=moves({league:recapLeague,players:timedPlayers,week:4,matchups:thisWeek,stats:{},
  transactions:[claim(sunday+86400000,9)]});
 assert.deepEqual([rows[0].forWeek,rows[0].played,summary.pending],[4,true,0]);
});
