import test from 'node:test';
import assert from 'node:assert/strict';
import {optimize} from '../dist/engine.js';
import {seasonLineup,futurePoints,buildSeasonModel,realismReasons} from '../dist/trades.js';

test('fast season lineups match exhaustive optimizer across flex, superflex, negative and missing scores',()=>{
 const players={a:{position:'QB'},b:{position:'QB'},c:{position:'RB'},d:{position:'RB'},e:{position:'WR'},f:{position:'TE'}};
 const ids=Object.keys(players);let seed=54;
 const random=()=>{seed=(seed*16807)%2147483647;return seed/2147483647};
 for(let i=0;i<80;i++){
  const values=Object.fromEntries(ids.map(id=>[id,random()<.1?null:Math.round((random()*40-5)*100)/100]));
  const slots=i%2?['QB','RB','WR','FLEX','SUPER_FLEX']:['RB','RB','WR','TE','FLEX'];
  const fast=seasonLineup(ids,slots,players,id=>values[id]),reference=optimize(ids,slots,players,id=>values[id]);
  assert(Math.abs(fast.total-reference.total)<.001);assert.equal(fast.complete,reference.complete);
 }
});
test('bye weeks require a loaded schedule, and missing projections never silently become zero',()=>{
 const players={a:{team:'BUF'},b:{team:'NYJ'}};
 assert.equal(futurePoints('a',null,players,{rec:1}),null);
 assert.equal(futurePoints('a',{projections:{},games:{NYJ:{}}},players,{rec:1}),0);
 assert.equal(futurePoints('b',{projections:{},games:{NYJ:{}}},players,{rec:1}),null);
 assert.equal(futurePoints('b',{projections:{b:{stats:{rec:5}}},games:{NYJ:{}}},players,{rec:1}),5);
});
function fixture(){
 const players=Object.fromEntries(['a','b','c','d','e','f','r','w'].map((id,i)=>[id,{position:['RB','WR','RB','WR','RB','WR','RB','WR'][i],team:'BUF'}]));
 const mine={roster_id:1,players:['a','b','c']},partner={roster_id:2,players:['d','e','f']};
 const league={mine,rosters:[mine,partner],roster_positions:['RB','WR','BN'],scoring_settings:{rec:1}};
 const points={3:{a:20,b:5,c:15,d:20,e:5,f:15,r:3,w:3},4:{a:20,b:5,c:10,d:20,e:5,f:8,r:3,w:3}};
 const outlook={weeks:[3,4],data:Object.fromEntries([3,4].map(week=>[week,{games:{BUF:{}},projections:Object.fromEntries(Object.entries(points[week]).map(([id,rec])=>[id,{stats:{rec}}]))}]))};
 return {players,league,outlook,partner};
}
test('season trades add each future week independently and explain benefits to both rosters',()=>{
 const f=fixture(),model=buildSeasonModel(f),r=model.evaluate(f.league.mine,f.partner,['c'],['f']);
 assert.equal(r.gainA,13);assert.equal(r.gainB,15);assert.deepEqual(r.weekly.map(w=>w.gainA),[10,3]);assert(r.complete);
 assert.equal(r.offeredValue,19);assert.equal(r.receivedValue,17);assert.deepEqual(realismReasons(r),[]);
});
test('season trades refuse missing future player projections and over-capacity packages',()=>{
 const f=fixture();delete f.outlook.data[4].projections.c;
 const model=buildSeasonModel(f);assert.equal(model.totals.c,null);
 assert.throws(()=>model.evaluate(f.league.mine,f.partner,['c'],['f']),/missing future projections/);
 const complete=fixture(),m=buildSeasonModel(complete);
 assert.throws(()=>m.evaluate(complete.league.mine,complete.partner,['c'],['d','f']),/roster drop/);
});
test('realism rejects tiny opponent gains and uneven value even with positive totals',()=>{
 const base={complete:true,weeks:15,gainA:60,gainB:9,valueGap:.1};
 assert(realismReasons(base).some(r=>r.startsWith('Their gain')));
 assert(realismReasons({...base,gainB:45,valueGap:.5}).some(r=>r.includes('value gap')));
 assert(realismReasons({...base,gainB:45,valueGap:null}).some(r=>r.includes('unavailable')));
 assert.deepEqual(realismReasons({...base,gainB:45}),[]);
});
test('season impact follows each league scoring and can reject incomplete baseline lineups',()=>{
 const f=fixture();f.league.scoring_settings.rec=.5;
 const r=buildSeasonModel(f).evaluate(f.league.mine,f.partner,['c'],['f']);assert.equal(r.gainA,6.5);
 f.league.roster_positions=['QB','RB','WR','BN'];
 const incomplete=buildSeasonModel(f).evaluate(f.league.mine,f.partner,['c'],['f']);assert.equal(incomplete.complete,false);assert(realismReasons(incomplete).some(r=>r.includes('starting slots')));
});
