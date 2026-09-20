import test from 'node:test';
import assert from 'node:assert/strict';
import {waiverWeeks,buildWaiverOutlook} from '../dist/waivers.js';

function fixture(){
 const players=Object.fromEntries(['a','b','burst','steady'].map(id=>[id,{position:'RB',team:id==='burst'?'NYJ':'BUF'}]));
 const league={roster_positions:['RB','BN'],scoring_settings:{rush_yd:1},mine:{players:['a','b'],reserve:[],taxi:[]}};
 const week=(values,games)=>({games,projections:Object.fromEntries(Object.entries(values).map(([id,rush_yd])=>[id,{stats:{rush_yd}}]))});
 const outlook={weeks:[3,4],data:{3:week({a:10,b:1,burst:20,steady:16},{BUF:{},NYJ:{}}),4:week({a:10,b:1,steady:16},{BUF:{}})}};
 return {players,league,outlook,starterIds:['a']};
}
test('waiver windows distinguish this week, next week and the remaining season',()=>{
 assert.deepEqual(waiverWeeks(2,'current'),[2]);assert.deepEqual(waiverWeeks(2,'next'),[3]);
 assert.equal(waiverWeeks(2,'season').length,15);assert.equal(waiverWeeks(2,'season').at(-1),17);
 assert.deepEqual(waiverWeeks(17,'season',18),[18]);assert.deepEqual(waiverWeeks(18,'next'),[]);assert.deepEqual(waiverWeeks(18,'season'),[]);
});
test('next-week leader can lose to a season pickup after accounting for bye weeks',()=>{
 const f=fixture(),season=buildWaiverOutlook(f),next=buildWaiverOutlook({...f,outlook:{...f.outlook,weeks:[3]}});
 assert.equal(next.evaluate('burst').gain,10);assert.equal(next.evaluate('steady').gain,6);
 assert.equal(season.evaluate('burst').gain,10);assert.equal(season.evaluate('steady').gain,12);
 assert.equal(season.evaluate('burst').starts,1);assert.equal(season.evaluate('steady').starts,2);
 assert.equal(season.evaluate('steady').drop,'b');assert.equal(season.totals.steady,32);
});
test('one chosen drop persists across all weeks, never switching drops to inflate gains',()=>{
 const f=fixture();f.starterIds=[];
 f.outlook.data[3].projections.a.stats.rush_yd=20;f.outlook.data[4].projections.b.stats.rush_yd=20;
 f.outlook.data[4].projections.a.stats.rush_yd=1;
 const result=buildWaiverOutlook(f).evaluate('steady');
 assert.equal(result.status,'no_gain');assert.equal(result.drop,null);
});
test('future pickup analysis preserves all drop protections and permits open roster spots',()=>{
 const f=fixture();
 assert.equal(buildWaiverOutlook({...f,protectedIds:['b']}).evaluate('steady').status,'no_safe_drop');
 assert.equal(buildWaiverOutlook({...f,excludedDropPositions:['RB']}).evaluate('steady').status,'no_safe_drop');
 delete f.outlook.data[4].projections.b;
 assert.equal(buildWaiverOutlook(f).evaluate('steady').status,'no_safe_drop');
 f.league.roster_positions.push('BN');
 const open=buildWaiverOutlook(f).evaluate('steady');assert.equal(open.drop,null);assert.equal(open.gain,12);
});
test('missing candidate data pauses advice rather than treating an unknown week as zero',()=>{
 const f=fixture();delete f.outlook.data[4].projections.steady;
 assert.equal(buildWaiverOutlook(f).evaluate('steady').status,'unavailable');
 delete f.outlook.data[4];assert.equal(buildWaiverOutlook(f).evaluate('burst').status,'unavailable');
});
test('a pickup that would not start is a bench upgrade only over a bench player the lineup never needs',()=>{
 const players=Object.fromEntries(['star','scrub','stash','meh'].map(id=>[id,{position:'RB',team:'BUF'}]));
 const league={roster_positions:['RB','BN'],scoring_settings:{rush_yd:1},mine:{players:['star','scrub'],reserve:[],taxi:[]}};
 const week=values=>({games:{BUF:{}},projections:Object.fromEntries(Object.entries(values).map(([id,rush_yd])=>[id,{stats:{rush_yd}}]))});
 const outlook={weeks:[3,4],data:{3:week({star:20,scrub:4,stash:9,meh:4.5}),4:week({star:20,scrub:4,stash:9,meh:4.5})}};
 const model=buildWaiverOutlook({league,players,outlook,starterIds:['star']});
 assert.deepEqual(model.evaluate('stash'),{drop:'scrub',gain:null,benchGain:10,status:'bench'});
 assert.equal(model.evaluate('meh').status,'no_gain','half a point a week is not worth a move');
 // With a bye for the star in week 4 the scrub starts once, so dropping him for depth is a real lineup move instead.
 outlook.data[4]=week({scrub:4,stash:9,meh:4.5});
 const covered=buildWaiverOutlook({league,players,outlook,starterIds:['star']}).evaluate('stash');
 assert.equal(covered.status,'upgrade');assert.equal(covered.gain,5);
});
test('a starting slot nobody can fill does not hide the pickup that would fill it',async()=>{
 const {waiverRows,futureWaiverRows}=await import('../dist/analysis.js');
 const P=(position,team,extra={})=>({position,fantasy_positions:[position],team,active:true,...extra});
 const players={qb:P('QB','BUF'),rb:P('RB','BUF'),te:P('TE','LV',{injury_status:'Out'}),wrb:P('WR','KC'),faTE:P('TE','DAL'),faTE2:P('TE','NYJ')};
 const stats=v=>({stats:{pts:v}}),proj={qb:stats(20),rb:stats(15),te:stats(9),wrb:stats(6),faTE:stats(11),faTE2:stats(7)};
 const games=Object.fromEntries(['BUF','LV','KC','DAL','NYJ'].map(t=>[t,{state:'pre'}]));
 const mine={roster_id:1,players:['qb','rb','te','wrb'],starters:['qb','rb','te'],reserve:[],taxi:[]};
 const league={league_id:'L',roster_positions:['QB','RB','TE','BN'],scoring_settings:{pts:1},rosters:[mine],mine,matchups:[]};
 const data={week:2,user:{user_id:'u'},players,projections:{2:proj},games,trends:[]};
 const now=waiverRows(data,league,{samePositionDrops:false});
 assert.deepEqual(now.filter(r=>r.id==='faTE').map(r=>[r.status,r.gain]),[['upgrade',11]]);
 const future={...proj};delete future.te;const outlook={weeks:[3,4],data:{3:{projections:future,games},4:{projections:future,games}}};
 assert.deepEqual(futureWaiverRows(data,league,outlook,{samePositionDrops:false}).filter(r=>r.id==='faTE').map(r=>[r.status,r.gain]),[['upgrade',22]]);
});
test('bench upgrades compare like with like, and a near-tie drops the weaker player',async()=>{
 const {waiverMove}=await import('../dist/engine.js');
 const P=position=>({position,fantasy_positions:[position],team:'BUF'});
 const players={qb:P('QB'),rb:P('RB'),cuff:P('RB'),qb2:P('QB'),rb9:P('RB')},values={qb:20,rb:15,cuff:4,qb2:15,rb9:7};
 const base={roster:['qb','rb','cuff'],slots:['QB','RB'],players,value:id=>values[id],capacity:3,samePosition:false};
 assert.equal(waiverMove({...base,id:'qb2'}).status,'no_gain','a second quarterback is not an upgrade on a running back handcuff');
 assert.deepEqual(waiverMove({...base,id:'rb9'}),{drop:'cuff',gain:null,benchGain:3,status:'bench'});
});
test('this week’s shortlist is built from what players can still score, not from games already played',async()=>{
 const {waiverRows}=await import('../dist/analysis.js');
 const P=(position,team)=>({position,fantasy_positions:[position],team,active:true}),players={mine:P('WR','MON'),late:P('WR','MON')},projections={mine:{stats:{rec:4}},late:{stats:{rec:9}}};
 // Eight free agents who out-project the Monday receiver and whose games are over.
 for(let i=0;i<8;i++){players[`sun${i}`]=P('WR','SUN');projections[`sun${i}`]={stats:{rec:10+i}}}
 const league={league_id:'L',scoring_settings:{rec:1},roster_positions:['WR','BN'],mine:{roster_id:1,players:['mine'],starters:['mine']},rosters:[{roster_id:1,players:['mine']}],matchups:[]};
 const data={week:2,user:{user_id:'u'},players,projections:{2:projections},games:{SUN:{state:'post'},MON:{state:'pre'}},trends:[]};
 const rows=waiverRows(data,league,{waiverExcluded:{add:[],drop:[]},protectStarters:false});
 const late=rows.find(r=>r.id==='late');assert.ok(late,'the player who can still help is looked at');assert.deepEqual([late.status,late.gain,late.drop],['upgrade',5,null]);assert.equal(rows[0].id,'late');
});
