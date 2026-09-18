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
