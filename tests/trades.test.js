import test from 'node:test';
import assert from 'node:assert/strict';
import {optimize} from '../dist/engine.js';
import {seasonLineup,futurePoints,buildSeasonModel,realismReasons,tradeScore,compareTradeIdeas} from '../dist/trades.js';
import {findTradeIdeas} from '../dist/analysis.js';
import {preferences} from '../server/settings.js';

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
test('auto trades find complementary bench RB/WR swaps and explain starter usage',async()=>{
 const f=fixture(),model=buildSeasonModel(f),result=await findTradeIdeas({players:f.players},f.league,model,{tradeMinGain:0,tradeMaxGap:1},{limit:100});
 const swap=result.ideas.find(r=>r.give[0]==='c'&&r.get[0]==='f');assert(swap);
 assert.equal(swap.gainA,13);assert.equal(swap.gainB,15);
 assert(swap.weekly.every(w=>w.outgoingStarts===0&&w.partnerOutgoingStarts===0&&w.incomingStarts===1&&w.partnerStarts===1));
 assert(result.checked>0);assert(result.diagnostics.mutual>0);
});
test('replacement value is an optional check, not an early veto of roster-fit trades',async()=>{
 const f=fixture();for(const w of f.outlook.weeks)f.outlook.data[w].projections.w.stats.rec=50;
 const model=buildSeasonModel(f);assert.equal(model.valueAboveReplacement.f,0);
 const open=await findTradeIdeas({players:f.players},f.league,model,{tradeMinGain:0,tradeMaxGap:1},{limit:100});
 assert(open.ideas.some(r=>r.give[0]==='c'&&r.get[0]==='f'));
 const strict=await findTradeIdeas({players:f.players},f.league,model,{tradeMinGain:0,tradeMaxGap:.25},{limit:100});
 assert(!strict.ideas.some(r=>r.give[0]==='c'&&r.get[0]==='f'));assert(strict.diagnostics.valueFiltered>0);assert(strict.nearMisses.length>0);
});
test('zero minimum still requires positive season gains for both teams',async()=>{
 const league={mine:{roster_id:1,players:['a']},rosters:[{roster_id:1,players:['a']},{roster_id:2,players:['b']}],users:[]};
 const data={players:{a:{position:'WR'},b:{position:'RB'}}};
 const model={totals:{a:100,b:100},evaluate:()=>({complete:true,weeks:10,gainA:5,gainB:0,valueGap:null,give:['a'],get:['b']})};
 assert.equal((await findTradeIdeas(data,league,model)).ideas.length,0);
 model.evaluate=()=>({complete:true,weeks:10,gainA:5,gainB:.5,valueGap:null});
 assert.equal((await findTradeIdeas(data,league,model)).ideas.length,1);
 model.evaluate=()=>({complete:true,weeks:10,gainA:5,gainB:-1,valueGap:.1});
 assert.equal((await findTradeIdeas(data,league,model)).ideas.length,0);
 model.evaluate=()=>({complete:true,weeks:10,gainA:0,gainB:0,valueGap:.1});
 assert.equal((await findTradeIdeas(data,league,model)).ideas.length,0);
});
test('strict gain diagnostics, position exclusions, cancellation and pair limits remain effective',async()=>{
 const f=fixture(),model=buildSeasonModel(f),data={players:f.players};
 const high=await findTradeIdeas(data,f.league,model,{tradeMinGain:10,tradeMaxGap:1});assert.equal(high.ideas.length,0);assert(high.diagnostics.belowMinimum>0);assert(high.nearMisses.length>0);
 const filtered=await findTradeIdeas(data,f.league,model,{tradeExcluded:{give:['RB','WR'],get:[]}});assert.equal(filtered.checked,0);assert.equal(filtered.diagnostics.offeredPlayers,0);
 const cancelled=await findTradeIdeas(data,f.league,model,{}, {cancelled:()=>true});assert(cancelled.cancelled);
 const capped=await findTradeIdeas(data,f.league,model,{}, {maxPairs:1});assert.equal(capped.checked,1);assert(capped.truncated);
});
test('service and UI accept zero/half-point minimums and informational value balance',()=>{
 assert.deepEqual(preferences({tradeMinGain:0,tradeMaxGap:1}),{tradeMinGain:0,tradeMaxGap:1});
 assert.equal(preferences({tradeMinGain:.5}).tradeMinGain,.5);
 assert.throws(()=>preferences({tradeMinGain:-1}));
});

test('combined-gain ranking rewards both teams, with an adjustable modest preference for your gain',()=>{
 const selfish={gainA:40,gainB:1},mutual={gainA:30,gainB:25};
 assert.equal(tradeScore(mutual,0),55);
 assert.equal(tradeScore(mutual,.15),51.25);
 assert.equal([selfish,mutual].sort((a,b)=>compareTradeIdeas(a,b))[0],mutual);
 assert.equal([selfish,mutual].sort((a,b)=>compareTradeIdeas(a,b,1))[0],selfish);
 const yours={gainA:30,gainB:20},theirs={gainA:20,gainB:30};
 assert.equal(tradeScore(yours,0),tradeScore(theirs,0));
 assert(tradeScore(yours,.15)>tradeScore(theirs,.15));
 assert(tradeScore({gainA:30,gainB:25},.15)>tradeScore(yours,.15));
});
test('auto trades rank by combined benefit before applying the result limit',async()=>{
 const mine={roster_id:1,players:['a']},partner={roster_id:2,players:['b','c']};
 const league={mine,rosters:[mine,partner],users:[]};
 const data={players:{a:{position:'WR'},b:{position:'RB'},c:{position:'RB'}}};
 const model={totals:{a:100,b:100,c:100},evaluate:(_a,_b,give,get)=>({complete:true,weeks:10,gainA:get[0]==='b'?40:30,gainB:get[0]==='b'?1:25,valueGap:.1,give,get})};
 const best=async prefs=>(await findTradeIdeas(data,league,model,prefs,{limit:1})).ideas[0].get[0];
 assert.equal(await best({}), 'c');
 assert.equal(await best({tradeOwnBias:0}), 'c');
 assert.equal(await best({tradeOwnBias:1}), 'b');
 assert.equal(await best({tradePenalty:1}), 'c');
 assert.equal(preferences({tradeOwnBias:.15}).tradeOwnBias,.15);
 assert.throws(()=>preferences({tradeOwnBias:1.1}));
});

function waiverFixture(){
 const points={starter:25,send:22,weak:3,mineBench:0,partnerQb:5,get:15,backup:8,partnerBench:0,freeQb:21,freeRb:2};
 const players=Object.fromEntries(Object.keys(points).map(id=>[id,{position:['starter','send','partnerQb','freeQb'].includes(id)?'QB':'RB',team:'BUF'}]));
 const mine={roster_id:1,players:['starter','weak','send','mineBench'],starters:['starter','weak']};
 const partner={roster_id:2,players:['partnerQb','get','backup','partnerBench'],starters:['partnerQb','get']};
 const league={league_id:'test',mine,rosters:[mine,partner],roster_positions:['QB','RB','BN','BN'],scoring_settings:{rec:1}};
 const outlook={weeks:[3,4],data:Object.fromEntries([3,4].map(w=>[w,{games:{BUF:{}},projections:Object.fromEntries(Object.entries(points).map(([id,rec])=>[id,{stats:{rec}}]))}]))};
 return {players,league,outlook,partner};
}
test('a nearly equivalent free QB removes the incentive to surrender a scarce RB',async()=>{
 const f=waiverFixture(),m=buildSeasonModel(f),raw=m.evaluate(f.league.mine,f.partner,['send'],['get']);
 assert.equal(raw.gainA,24);assert.equal(raw.gainB,20);
 const r=m.assessWaivers(raw,f.league.mine,f.partner);
 assert.equal(r.waiverB.add,'freeQb');assert.equal(r.waiverB.drop,'partnerBench');
 assert.equal(r.waiverB.gain,32);assert.equal(r.adjustedGainB,-12);assert.equal(r.adjustedGainA,24);
 assert(r.offeredValue<r.receivedValue);assert(tradeScore(r)<tradeScore(raw));
 const search=await findTradeIdeas({players:f.players},f.league,m,{}, {limit:1000});
 assert(!search.ideas.some(r=>r.give[0]==='send'&&r.get[0]==='get'));assert(search.diagnostics.waiverRejected>0);
});
test('scarce quarterbacks remain valid and league ownership includes reserve and taxi',async()=>{
 for(const location of ['players','reserve','taxi']){
  const f=waiverFixture();f.league.rosters.push({roster_id:3,[location]:['freeQb']});
  const m=buildSeasonModel(f),search=await findTradeIdeas({players:f.players},f.league,m,{}, {limit:1000});
  const r=search.ideas.find(r=>r.give[0]==='send'&&r.get[0]==='get');assert(r,location);assert.equal(r.waiverB.gain,0);assert.equal(r.adjustedGainB,20);
 }
});
test('pickup alternatives keep trade assets, starters and protected bench players',()=>{
 const f=waiverFixture(),m=buildSeasonModel(f),raw=m.evaluate(f.league.mine,f.partner,['send'],['get']);
 const r=m.assessWaivers(raw,f.league.mine,f.partner,{protectedB:['backup','partnerBench']});
 assert.equal(r.waiverB.add,null);assert.equal(r.adjustedGainB,raw.gainB);
 // An open spot can be used without inventing a drop.
 const open=waiverFixture();open.partner.players=open.partner.players.filter(id=>id!=='partnerBench');
 const model=buildSeasonModel(open),result=model.assessWaivers(model.evaluate(open.league.mine,open.partner,['send'],['get']),open.league.mine,open.partner);
 assert.equal(result.waiverB.add,'freeQb');assert.equal(result.waiverB.drop,null);
});
test('alternatives use a single season pickup, not a different weekly free agent',()=>{
 const f=waiverFixture();f.players.freeQb2={position:'QB',team:'BUF'};
 f.outlook.data[3].projections.freeQb.stats.rec=30;f.outlook.data[4].projections.freeQb.stats.rec=0;
 f.outlook.data[3].projections.freeQb2={stats:{rec:0}};f.outlook.data[4].projections.freeQb2={stats:{rec:30}};
 const m=buildSeasonModel(f),r=m.assessWaivers(m.evaluate(f.league.mine,f.partner,['send'],['get']),f.league.mine,f.partner);
 assert.equal(r.waiverB.gain,25);assert(['freeQb','freeQb2'].includes(r.waiverB.add));
});
test('injured and incomplete free agents are excluded; unknown forecasts remain explicit',()=>{
 for(const status of ['Out','IR','Suspended']){
  const f=waiverFixture();f.players.freeQb.injury_status=status;
  const m=buildSeasonModel(f),r=m.assessWaivers(m.evaluate(f.league.mine,f.partner,['send'],['get']),f.league.mine,f.partner);
  assert.equal(r.waiverB.add,null);
 }
 const f=waiverFixture();delete f.outlook.data[4].projections.freeQb;
 const m=buildSeasonModel(f),r=m.assessWaivers(m.evaluate(f.league.mine,f.partner,['send'],['get']),f.league.mine,f.partner);
 assert.equal(r.waiverB.status,'unknown');assert.equal(r.waiverB.missing,1);assert.equal(r.waiverB.add,null);
});

test('the outgoing trade player cannot be the drop in the no-trade alternative',()=>{
 const f=waiverFixture(),m=buildSeasonModel(f);
 const first=m.assessWaivers(m.evaluate(f.league.mine,f.partner,['send'],['get']),f.league.mine,f.partner);
 assert.equal(first.waiverB.drop,'partnerBench');
 const keepBench=m.assessWaivers(m.evaluate(f.league.mine,f.partner,['send'],['partnerBench']),f.league.mine,f.partner);
 assert.equal(keepBench.waiverB.drop,'backup');
});
