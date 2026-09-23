import test from 'node:test';
import assert from 'node:assert/strict';
import {optimize,projected,aggregateWatch,availableIds,tradeCandidateIds,createScoreTracker,waiverDropReason,waiverMove,ruledOut,UNAVAILABLE} from '../dist/engine.js';
const p={q:{position:'QB'},a:{position:'RB'},b:{position:'RB'},w:{position:'WR'},t:{position:'TE'},x:{position:'WR'}};
const scores={q:20,a:15,b:12,w:19,t:8,x:16};
test('optimizer assigns unique players to legal flex slots',()=>{const r=optimize(Object.keys(p),['QB','RB','WR','FLEX'],p,id=>scores[id]);assert.equal(r.total,70);assert.equal(new Set(r.ids).size,4);assert.equal(r.ids[0],'q');assert.equal(r.ids[1],'a');assert(r.complete)});
test('started slots remain locked even when another player projects better',()=>{const r=optimize(Object.keys(p),['QB','RB','WR','FLEX'],p,id=>scores[id],{3:'t'});assert.equal(r.ids[3],'t');assert.equal(r.total,62)});
test('missing projection is not represented as zero',()=>{assert.equal(projected(null,{rec:1}),null);assert.equal(projected({unrelated:1},{rec:1}),null);const r=optimize(['q','a'],['QB','RB','WR'],p,id=>scores[id]);assert.equal(r.complete,false);assert.equal(r.ids[2],null)});
test('same player scores differently with each league scoring system',()=>{assert.equal(projected({rec:6,rec_yd:100},{rec:1,rec_yd:.1}),16);assert.equal(projected({rec:6,rec_yd:100},{rec:.5,rec_yd:.1}),13)});
test('watchroom deduplicates ownership and opposing exposure across leagues',()=>{const players={w:{position:'WR',team:'BUF'}};const leagues=[1,2].map(i=>({league_id:String(i),name:'League '+i,enabled:true,mine:{roster_id:1,players:i===1?['w']:[],starters:i===1?['w']:[]},rosters:[{roster_id:2,players:i===2?['w']:[],starters:i===2?['w']:[]}],matchups:[{roster_id:1,matchup_id:1,players:i===1?['w']:[],starters:i===1?['w']:[],players_points:{w:16}},{roster_id:2,matchup_id:1,players:i===2?['w']:[],starters:i===2?['w']:[],players_points:{w:13}}]}));const a=aggregateWatch(leagues,players,{});assert.equal(a.length,1);assert.deepEqual(a[0].appearances.map(a=>a.points),[16,13]);assert.deepEqual(a[0].appearances.map(a=>a.side),['mine','opponent'])});
test('waivers exclude active, reserve, and taxi rostered players',()=>{assert.deepEqual(availableIds({rosters:[{players:['q'],reserve:['a'],taxi:['b']}]},p),['w','t','x'])});
test('negative projections still fill mandatory legal lineup positions',()=>{const r=optimize(['q'],['QB'],p,()=>-2);assert.equal(r.total,-2);assert(r.complete)});

test('start/sit preserves existing RB1/RB2 and WR1/WR2 order',()=>{
 const current=['b','a','x','w'];
 const result=optimize(['a','b','w','x'],['RB','RB','WR','WR'],p,id=>scores[id],{},current);
 assert.deepEqual(result.ids,current);
 assert.equal(result.total,62);
});
test('a real upgrade replaces only the weaker RB, not the other RB slot',()=>{
 const players={...p,c:{position:'RB'}},points={...scores,c:18};
 const result=optimize(['a','b','c'],['RB','RB'],players,id=>points[id],{},['b','a']);
 assert.deepEqual(result.ids,['c','a']);
 assert.equal(result.total,33);
});
test('equal projected points preserve current starters over bench alternatives',()=>{
 const result=optimize(['a','b'],['RB'],p,()=>10,{},['b']);
 assert.deepEqual(result.ids,['b']);
});
test('an unchanged starting group does not get shuffled between RB and FLEX',()=>{
 const result=optimize(['a','b','w'],['RB','WR','FLEX'],p,id=>scores[id],{},['b','w','a']);
 assert.deepEqual(result.ids,['b','w','a']);
});
test('necessary flex moves still permit a real upgrade without moving a locked slot',()=>{
 const points={...scores,b:25};
 const result=optimize(['q','a','b','w'],['QB','RB','FLEX'],p,id=>points[id],{0:'q'},['q','a','b']);
 assert.deepEqual(result.ids,['q','b','w']);
 assert.equal(result.total,64);
});

test('trade filters independently limit outgoing and incoming positions',()=>{
 const roster=['q','a','w','t'];
 assert.deepEqual(tradeCandidateIds(roster,p,['QB','TE']),['a','w']);
 assert.deepEqual(tradeCandidateIds(roster,p,['RB','WR']),['q','t']);
 assert.deepEqual(roster,['q','a','w','t']);
});
test('trade filters handle all positions excluded, missing players and multi-position players',()=>{
 assert.deepEqual(tradeCandidateIds(Object.keys(p),p,['QB','RB','WR','TE']),[]);
 assert.deepEqual(tradeCandidateIds(['missing','t'],p,[]),['t']);
 const players={...p,dual:{position:'WR',fantasy_positions:['WR','TE']}};
 assert.deepEqual(tradeCandidateIds(['dual','w'],players,['TE']),['w']);
});

const watchScores=(ppr,half)=>[{id:'w',appearances:[{leagueId:'one',side:'mine',points:ppr},{leagueId:'two',side:'opponent',points:half}]}];
test('score highlights start after a baseline and respect each league scoring',()=>{
 const observe=createScoreTracker();
 assert.deepEqual(observe(watchScores(10,8),'2026:2'),[]);
 assert.deepEqual(observe(watchScores(10,8),'2026:2'),[]);
 const changes=observe(watchScores(17,14.5),'2026:2');
 assert.deepEqual(changes.map(e=>[e.leagueId,e.side,e.delta]),[['one','mine',7],['two','opponent',6.5]]);
 assert.deepEqual(observe(watchScores(17,14.5),'2026:2'),[]);
});
test('score tracker distinguishes corrections, missing data, and new weeks',()=>{
 const observe=createScoreTracker();
 observe(watchScores(10,null),'2026:2');
 assert.deepEqual(observe(watchScores(null,4),'2026:2'),[]);
 assert.equal(observe(watchScores(9,4),'2026:2')[0].delta,-1);
 assert.deepEqual(observe(watchScores(21,15),'2026:3'),[]);
 assert.deepEqual(observe(watchScores(21,15),'other-account:2026:3'),[]);
});
test('projections and floating point noise do not generate score alerts',()=>{
 const observe=createScoreTracker();
 observe(watchScores(.1,0),'week');
 assert.deepEqual(observe(watchScores(.10000000001,0),'week'),[]);
 assert.deepEqual(observe([{id:'watch',appearances:[{leagueId:'one',side:'watch',points:20,prediction:true}]}],'week'),[]);
 assert.deepEqual(observe([{id:'watch',appearances:[{leagueId:'one',side:'watch',points:30,prediction:true}]}],'week'),[]);
});

test('waiver drops protect unknown projections, unavailable players, locks and starters',()=>{
 const players={...p,bowers:{position:'TE'},out:{position:'RB',injury_status:'Out'}};
 const value=id=>({a:15,b:12,t:8,bowers:null,out:0})[id];
 const options={players,value,protectedIds:['a'],starterIds:['t'],lockedIds:['b']};
 assert.equal(waiverDropReason('bowers',options),'No usable weekly projection');
 assert.equal(waiverDropReason('out',options),'Unavailable this week');
 assert.equal(waiverDropReason('a',options),'Never drop');
 assert.equal(waiverDropReason('t',options),'Current starter');
 assert.equal(waiverDropReason('b',options),'Game started');
});
test('missing Bowers projection never becomes an eligible drop to upgrade another TE',()=>{
 const players={...p,bowers:{position:'TE'},newTE:{position:'TE'}};
 const values={...scores,bowers:null,newTE:12};
 const result=waiverMove({id:'newTE',roster:['a','t','bowers'],slots:['RB','TE'],players,value:id=>values[id],starterIds:['a','t'],capacity:3});
 assert.equal(result.status,'no_safe_drop');assert.equal(result.drop,null);assert.equal(result.gain,null);
});
test('waivers honor never-drop protection even when starters and position restrictions are relaxed',()=>{
 const players={...p,newTE:{position:'TE'}};
 const values={...scores,newTE:12};
 const result=waiverMove({id:'newTE',roster:['a','t'],slots:['RB','TE'],players,value:id=>values[id],protectedIds:['t'],samePosition:false,capacity:2});
 assert.equal(result.drop,null);assert.notEqual(result.status,'upgrade');
});
test('kicker pickups do not drop a skill player when same-position protection is enabled',()=>{
 const players={...p,k:{position:'K'},newK:{position:'K'}};
 const values={...scores,k:3,newK:10};
 const options={id:'newK',roster:['a','t','b','k'],slots:['RB','TE','K'],players,value:id=>values[id],starterIds:['a','t','k'],capacity:4};
 assert.equal(waiverMove(options).status,'no_safe_drop');
 const relaxed=waiverMove({...options,samePosition:false});
 assert.equal(relaxed.drop,'b');assert.equal(relaxed.gain,7);
});
test('no-gain pickups never receive a suggested drop, real same-position upgrades do',()=>{
 const players={...p,newRB:{position:'RB'}};
 const options={id:'newRB',roster:['a','b','t'],slots:['RB','TE'],players,starterIds:['a','t'],capacity:3};
 assert.equal(waiverMove({...options,value:id=>({...scores,newRB:10})[id]}).status,'no_gain');
 const upgrade=waiverMove({...options,value:id=>({...scores,newRB:20})[id]});
 assert.equal(upgrade.drop,'b');assert.equal(upgrade.gain,5);
 const open=waiverMove({...options,capacity:4,value:id=>({...scores,newRB:20})[id]});
 assert.equal(open.drop,null);assert.equal(open.status,'upgrade');
});
test('waiver drop exclusions are independent of pickup positions and never force an excluded drop',()=>{
 const players={...p,newRB:{position:'RB'}},values={...scores,newRB:20};
 const options={id:'newRB',roster:['a','b','t'],slots:['RB','TE'],players,value:id=>values[id],starterIds:['a','t'],capacity:3,samePosition:false};
 assert.equal(waiverMove({...options,excludedDropPositions:['TE','QB','K']}).drop,'b');
 const blocked=waiverMove({...options,excludedDropPositions:['RB']});
 assert.equal(blocked.status,'no_safe_drop');assert.equal(blocked.drop,null);
 assert.equal(waiverDropReason('b',{players,value:options.value,excludedDropPositions:['RB']}),'Drop position excluded');
 // Drop filters do not block an add when there is an empty roster spot.
 const open=waiverMove({...options,capacity:4,excludedDropPositions:['RB','TE']});
 assert.equal(open.status,'upgrade');assert.equal(open.drop,null);
});
test('everything except kickers still includes other positions and excludes multi-position kickers',()=>{
 const players={qb:{position:'QB'},rb:{position:'RB'},te:{position:'TE'},k:{position:'K'},def:{position:'DEF'},lb:{position:'LB'},multi:{position:'WR',fantasy_positions:['WR','K']}};
 assert.deepEqual(tradeCandidateIds(Object.keys(players),players,['K']),['qb','rb','te','def','lb']);
 assert.equal(waiverDropReason('multi',{players,value:()=>10,excludedDropPositions:['K']}),'Drop position excluded');
});
test('a coarse 50-plus projection bucket still scores where a league splits 50-59 from 60-plus',()=>{
 // Sleeper projects one fgm_50p; nearly every league scores fgm_50_59 and fgm_60p separately, and
 // without the fallback the whole category scored nothing and every kicker projected ~1.4 light.
 const scoring={fgm_50_59:5,fgm_60p:6,xpm:1};
 assert.equal(projected({fgm_50p:.32,xpm:2.79},scoring),4.39);
 // A finished week itemises the real buckets, so the fallback must never double count.
 assert.equal(projected({fgm_50_59:1,fgm_60p:1,fgm_50p:2,xpm:3},scoring),14);
 assert.equal(projected({fgm_50p:1},{fgm_40_49:4}),null,'it fills only the bucket it belongs to');
});
test('a 60-yard make with no 50-59 key on the line scores once, as a 60-yard make',()=>{
 const scoring={fgm_50_59:5,fgm_60p:6};
 assert.equal(projected({fgm_60p:1,fgm_50p:1},scoring),6);
 assert.equal(projected({fgm_60p:1,fgm_50p:3},scoring),16,'the other two long makes are 50-59s');
 assert.equal(projected({fgm_60p:.1,fgm_50p:.4},scoring),2.1,'a projection that splits out 60-plus is not double counted either');
 assert.equal(projected({fgm_60p:1,fgm_50p:1},{fgm_50_59:5}),5,'a league without a 60-plus category keeps every long make in 50-59');
});
test('an 18-starter IDP lineup is set in full, and a tie keeps the player already in the slot',()=>{
 const slots=['QB','RB','RB','WR','WR','WR','TE','FLEX','FLEX','K','DEF','DL','DL','LB','LB','DB','DB','IDP_FLEX'];
 const players={},points={};let n=0;
 for(const [pos,count]of Object.entries({QB:2,RB:4,WR:5,TE:2,K:1,DEF:1,DL:3,LB:3,DB:3}))for(let i=0;i<count;i++){const id=`${pos}${i}`;players[id]={position:pos};points[id]=20-i*3+(n++%3)}
 const ids=Object.keys(players),best=optimize(ids,slots,players,id=>points[id]);
 assert.ok(best.complete);assert.equal(new Set(best.ids).size,18);
 assert.ok(best.ids.every((id,i)=>players[id].position===slots[i]||['FLEX','IDP_FLEX'].includes(slots[i])));
 // The best 18 by position, worked out by hand: every position's top players, then the flex picks.
 const top=(pos,k)=>ids.filter(id=>players[id].position===pos).map(id=>points[id]).sort((a,b)=>b-a).slice(0,k);
 const flex=[...top('RB',4).slice(2),...top('WR',5).slice(3),...top('TE',2).slice(1)].sort((a,b)=>b-a).slice(0,2),idp=[...top('DL',3).slice(2),...top('LB',3).slice(2),...top('DB',3).slice(2)].sort((a,b)=>b-a)[0];
 const hand=[...top('QB',1),...top('RB',2),...top('WR',3),...top('TE',1),...top('K',1),...top('DEF',1),...top('DL',2),...top('LB',2),...top('DB',2),...flex,idp].reduce((a,b)=>a+b,0);
 assert.equal(best.total,Math.round(hand*100)/100);
 const even={...points,DL2:points.DL1};
 const current=[...best.ids];current[slots.indexOf('DL')+1]='DL2';
 assert.equal(optimize(ids,slots,players,id=>even[id],{},current).ids[slots.indexOf('DL')+1],'DL2','an equal backup already starting stays put');
 const locked=optimize(ids,slots,players,id=>points[id],{0:'QB1'});
 assert.equal(locked.ids[0],'QB1');assert.ok(locked.complete);assert.equal(locked.total,Math.round((best.total-points.QB0+points.QB1)*100)/100);
});

test('one list of statuses: ruled out is Out, IR, PUP and suspended; unavailable adds Doubtful',()=>{
 for(const status of ['Out','IR','PUP','Sus','Suspended'])assert.ok(ruledOut({injury_status:status})&&UNAVAILABLE.includes(status),status);
 for(const status of ['Doubtful'])assert.ok(!ruledOut({injury_status:status})&&UNAVAILABLE.includes(status),status);
 for(const status of ['Questionable',undefined])assert.ok(!ruledOut({injury_status:status})&&!UNAVAILABLE.includes(status),String(status));
});
