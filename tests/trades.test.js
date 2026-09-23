import test from 'node:test';
import assert from 'node:assert/strict';
import {optimize} from '../dist/engine.js';
import {seasonLineup,futurePoints,buildSeasonModel,realismReasons,tradeScore,compareTradeIdeas} from '../dist/trades.js';
import {findTradeIdeas,acquirePlayer} from '../dist/analysis.js';
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
test('an injured star missing one week keeps his season value, and that week is his zero',()=>{
 const f=fixture();f.players.c.injury_status='Out';delete f.outlook.data[4].projections.c;
 const model=buildSeasonModel(f);assert.equal(model.totals.c,15,'15 in week 3, nothing while he is out');
 const r=model.evaluate(f.league.mine,f.partner,['c'],['f']);assert.deepEqual(r.weekly.map(w=>w.gainA),[10,3]);
 const healthy=fixture();delete healthy.outlook.data[4].projections.c;
 assert.equal(buildSeasonModel(healthy).totals.c,null,'a healthy player with a missing week is still unknown');
 const players={a:{team:'BUF',injury_status:'IR'}};
 assert.equal(futurePoints('a',{projections:{},games:{NYJ:{}}},players,{rec:1}),0,'a bye is still a bye');
 assert.equal(futurePoints('a',{projections:{},games:{BUF:{}}},players,{rec:1}),0);
 assert.equal(futurePoints('a',{projections:{},games:{BUF:{}}},{a:{team:'BUF',injury_status:'Questionable'}},{rec:1}),null,'questionable is not ruled out');
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
// A star for two starters: neither single swap helps the star's owner, the package does.
function packageFixture(flip=false){
 const position={a1:'RB',a2:'WR',a3:'RB',x1:'RB',x2:'WR',S:'RB',p2:'WR',p3:'RB',p4:'WR',p5:'RB'},points={a1:12,a2:12,a3:11,x1:9,x2:1,S:18,p2:4,p3:3,p4:1,p5:1};
 const players=Object.fromEntries(Object.keys(position).map(id=>[id,{position:position[id],team:'BUF'}]));
 const deep={roster_id:1,owner_id:'deep',players:['a1','a2','a3','x1','x2']},star={roster_id:2,owner_id:'star',players:['S','p2','p3','p4','p5']},[mine,partner]=flip?[star,deep]:[deep,star];
 const league={league_id:'L',mine,rosters:[mine,partner],roster_positions:['RB','WR','FLEX','BN','BN'],scoring_settings:{rec:1}};
 const outlook={weeks:[3,4],data:Object.fromEntries([3,4].map(week=>[week,{games:{BUF:{}},projections:Object.fromEntries(Object.entries(points).map(([id,rec])=>[id,{stats:{rec}}]))}]))};
 return {players,league,outlook,partner};
}
test('an uneven package cuts a player who never starts, and respects protected players',()=>{
 const f=packageFixture(),m=buildSeasonModel(f);
 assert.throws(()=>m.evaluate(f.league.mine,f.partner,['a1','a3'],['S']),/roster drop/,'callers must ask for drops');
 const r=m.evaluate(f.league.mine,f.partner,['a1','a3'],['S'],{autoDrop:true});
 assert.deepEqual([r.gainA,r.gainB,r.complete],[8,4,true]);assert.deepEqual([r.dropA,r.dropB],[[],['p4']]);
 assert.deepEqual(m.evaluate(f.league.mine,f.partner,['a1','a3'],['S'],{autoDrop:true,protectedB:['p4']}).dropB,['p5']);
 const even=m.evaluate(f.league.mine,f.partner,['a1'],['S'],{autoDrop:true});assert.deepEqual([even.dropA,even.dropB],[[],[]]);
 assert.equal(m.addValue(f.partner,'a1'),18,'a 12 point back replaces a 3 point flex for two weeks');assert.equal(m.addValue(f.league.mine,'p4'),0);
});
test('when everyone left would start, the weakest player is cut and the lineups are set again',()=>{
 const f=packageFixture();f.league.roster_positions=['RB','WR','FLEX','FLEX','FLEX'];
 const m=buildSeasonModel(f),r=m.evaluate(f.league.mine,f.partner,['a1','a3'],['S'],{autoDrop:true});
 assert.equal(r.dropB.length,1);assert(['p4','p5'].includes(r.dropB[0]),'one of the two one-point players sits in every week, so he goes');
 const other=r.dropB[0]==='p4'?'p5':'p4',forced=m.evaluate(f.league.mine,f.partner,['a1','a3'],['S'],{autoDrop:true,protectedB:r.dropB});
 assert.deepEqual(forced.dropB,[other],'with the idle player protected, the weakest starter is cut');assert.equal(forced.gainB,r.gainB);assert.equal(r.gainB,2*(12+11-18-1));
 assert.throws(()=>m.evaluate(f.league.mine,f.partner,['a1','a3'],['S'],{autoDrop:true,protectedB:['p2','p3','p4','p5']}),/no one on the roster can be cut/);
});
test('the search packages two players when no single swap works for both sides',async()=>{
 const f=packageFixture(),data={players:f.players,user:{user_id:'u'}},m=buildSeasonModel(f);
 const singles=await findTradeIdeas(data,f.league,m,{}, {packages:false});assert.equal(singles.ideas.length,0);assert.equal(singles.diagnostics.packages,0);
 const found=await findTradeIdeas(data,f.league,m,{});
 assert.deepEqual(found.ideas.map(i=>[i.give,i.get,i.dropB]),[[['a1','a3'],['S'],['p4']]]);assert.equal(found.diagnostics.packages,found.diagnostics.packageCandidates);assert(found.diagnostics.packages>=3,'at least the three ways to pair the players who gain alone');
 assert.equal(found.checked,singles.checked+found.diagnostics.packages);
 assert.equal((await findTradeIdeas(data,f.league,m,{}, {maxPackages:0})).ideas.length,0);
 assert((await findTradeIdeas(data,f.league,m,{tradeMinGain:3})).ideas.length===0,'the weekly minimum still applies');
});
test('two for one works in the other direction, and my protected players are never the drop',async()=>{
 const f=packageFixture(true),data={players:f.players,user:{user_id:'u'}},m=buildSeasonModel(f);
 const found=await findTradeIdeas(data,f.league,m,{});
 assert.deepEqual(found.ideas.map(i=>[i.give,i.get,i.dropA,i.dropB]),[[['S'],['a1','a3'],['p4'],[]]]);
 const kept=await findTradeIdeas(data,f.league,m,{waiverProtected:{'u:L':['p4']}});assert.deepEqual(kept.ideas[0].dropA,['p5']);
});
test('one deal with different throw-ins is listed once, in its best version',async()=>{
 const f=packageFixture();f.players.x3={position:'RB',team:'BUF'};f.league.mine.players.push('x3');f.league.roster_positions.push('BN');
 for(const week of [3,4])f.outlook.data[week].projections.x3={stats:{rec:10.5}};
 const found=await findTradeIdeas({players:f.players,user:{user_id:'u'}},f.league,buildSeasonModel(f),{});
 assert(found.diagnostics.mutual>1,'several packages work');assert.equal(found.ideas.length,1);assert.deepEqual(found.ideas[0].get,['S']);
});
test('a forced cut is the cheapest player to lose, not the lowest season total',()=>{
 // Nobody on the receiving roster is idle: the bench receiver covers a bye. The kicker has the lowest total and must not be the cut.
 const position={w1:'WR',w2:'WR',k1:'K',r1:'RB',x1:'RB',x2:'WR',s1:'RB',x3:'WR',k2:'K'},players=Object.fromEntries(Object.keys(position).map(id=>[id,{position:position[id],team:id==='w1'?'BYE':'BUF'}]));
 const mine={roster_id:1,players:['r1','w1','k1','w2']},partner={roster_id:2,players:['s1','x1','x2','x3','k2']};
 const league={mine,rosters:[mine,partner],roster_positions:['RB','WR','K','BN'],scoring_settings:{rec:1}};
 const points={r1:6,w1:14,w2:12,k1:8,x1:12,x2:11,s1:20,x3:5,k2:7};
 const outlook={weeks:[3,4],data:{3:{games:{BUF:{},BYE:{}},projections:Object.fromEntries(Object.entries(points).map(([id,rec])=>[id,{stats:{rec}}]))},4:{games:{BUF:{}},projections:Object.fromEntries(Object.entries(points).filter(([id])=>id!=='w1').map(([id,rec])=>[id,{stats:{rec}}]))}}};
 const m=buildSeasonModel({league,players,outlook}),r=m.evaluate(mine,partner,['r1'],['x1','x2'],{autoDrop:true});
 assert.deepEqual(r.dropA,['w2'],'season totals say the bye-week receiver (14) or the kicker (16); losing the backup (24) costs least');assert.equal(r.complete,true);assert.ok(r.gainA>0,`an upgrade at running back and a better bye cover should help, got ${r.gainA}`);
});

// Going after a player is the trade search with the arrow reversed: the owner's gain stops being a
// sanity check and becomes the price, so an offer that leaves them flat is not an offer at all.
test('going after a player keeps only offers his owner would take, best for me first',async()=>{
 const f=fixture(),model=buildSeasonModel(f),data={players:f.players};
 const r=await acquirePlayer(data,f.league,model,'f',{},{});
 assert.deepEqual([r.ownerId,r.owner,r.considered],[2,'Team 2',3]);
 // Sending b for f leaves the owner exactly where they were, so they would never answer it.
 assert.deepEqual(r.offers.map(o=>[o.give[0],o.gainA,o.gainB]),[['c',13,15],['a',-2,30]]);
 assert(r.offers.every(o=>o.gainB>.25),'every offer has to leave them better off');
 assert.deepEqual([r.total,r.weeks],[23,2],'his projection and the window come back with him');
});
test('what a player would add is a different question from whether anyone can pay for him',async()=>{
 const f=fixture(),model=buildSeasonModel(f),data={players:f.players};
 const r=await acquirePlayer(data,f.league,model,'d',{},{});
 // Sending b would add the most to my lineup, but it guts theirs, so it is never on the table.
 assert.equal(r.lift,30,'the most he could add here, whoever goes the other way');
 assert.deepEqual(r.offers.map(o=>[o.give[0],o.gainA]),[['a',15]],'the only one they would take is worth less to me than that');
 assert.equal(r.best,13,'the most any single player of mine does for them');
});
test('a player who improves nothing still reports a price, and one of my own is refused',async()=>{
 const f=fixture(),model=buildSeasonModel(f),data={players:f.players};
 const r=await acquirePlayer(data,f.league,model,'e',{},{});
 assert.equal(r.lift,0,'he does not improve my lineup whoever goes the other way');
 assert.deepEqual(r.offers.map(o=>o.gainA),[0,-15],'still ranked by what is left for me, so the cheapest is first');
 await assert.rejects(()=>acquirePlayer(data,f.league,model,'a',{},{}),/not on another roster/);
});
test('going after a player respects exclusions, injuries, the limit and cancellation',async()=>{
 const f=fixture(),model=buildSeasonModel(f),data={players:f.players};
 const narrowed=await acquirePlayer(data,f.league,model,'f',{tradeExcluded:{give:['RB'],get:[]}},{});
 assert.deepEqual([narrowed.considered,narrowed.offers.length],[1,0],'only the receiver is left to send, and he does not tempt them');
 const hurt=fixture();hurt.players.c.injury_status='Out';
 const without=await acquirePlayer({players:hurt.players},hurt.league,buildSeasonModel(hurt),'f',{},{});
 assert.deepEqual(without.offers.map(o=>o.give[0]),['a'],'a player who cannot play is not currency');
 assert.equal((await acquirePlayer(data,f.league,model,'f',{},{limit:1})).offers.length,1);
 assert.deepEqual(await acquirePlayer(data,f.league,model,'f',{},{cancelled:()=>true}),{cancelled:true});
});
test('going after a player parked on injured reserve or the taxi squad says why there is no offer',async()=>{
 const f=fixture();f.partner.players.push('r','w');f.partner.reserve=['r'];f.partner.taxi=['w'];
 const model=buildSeasonModel(f),data={players:f.players};
 await assert.rejects(()=>acquirePlayer(data,f.league,model,'r',{},{}),/injured reserve/);
 await assert.rejects(()=>acquirePlayer(data,f.league,model,'w',{},{}),/taxi squad/);
});
