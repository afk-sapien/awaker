// The owner's own corrections, from the adapter outwards.
//
// The second half is the one that matters: a single record on a single player has to move the
// lineup, the start and sit call, the waiver row and the trade model together, and every one of
// those numbers has to come back on its own when the record expires or is removed. That is the
// whole claim of one adapter, so it is asserted on one fixture with numbers worked by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import {NO_OVERRIDES,adjust,adjustedBy,createOverrides,describePoints,expired,fingerprint,normalise,normalisePoints} from '../dist/overrides.js';
import {lineupComparisons} from '../dist/lineup.js';
import {usableValue,waiverRows} from '../dist/analysis.js';
import {buildSeasonModel} from '../dist/trades.js';

const record=extra=>({player:'star',source:'owner',at:1,...extra});
const lensOf=(records,extra={})=>createOverrides({overrides:records,...extra});

test('a stored record is trusted in shape only, and anything the wrong type is dropped',()=>{
 assert.equal(normalise(null),null);assert.equal(normalise({}),null);assert.equal(normalise({player:'  '}),null);
 const r=normalise({player:' 7 ',status:'Sprained',bodyPart:'Knee',rosterStatus:'Nope',note:'  seen limping  ',season:1999,from:0,until:40,points:{multiplier:'x',delta:9000},source:'hacker'},{now:5});
 assert.equal(r.player,'7');assert.equal(r.status,null);assert.equal(r.bodyPart,'Knee');assert.equal(r.rosterStatus,null);
 assert.equal(r.note,'seen limping');assert.equal(r.season,null);assert.equal(r.from,null);assert.equal(r.until,null);
 assert.deepEqual(r.points,{delta:100});assert.equal(r.source,'owner');assert.equal(r.at,5);
 // Healthy is the word that clears a designation, so it cannot carry a body part with it.
 assert.equal(normalise({player:'a',status:'Healthy',bodyPart:'Knee'}).bodyPart,null);
 // An until before its from would be a window that can never be open, so it closes on its from.
 assert.equal(normalise({player:'a',from:6,until:3}).until,6);
 // An agent may own a record later, and validating the shape now means no stored record needs
 // migrating when one does.
 assert.equal(normalise({player:'a',source:'agent:news watcher'}).source,'agent:news watcher');
 assert.equal(normalisePoints({multiplier:null,delta:null}),null);assert.equal(normalisePoints(7),null);
 assert.deepEqual(normalisePoints({multiplier:9,delta:-500}),{multiplier:5,delta:-100});
 // A multiplier of zero is a real answer and has to survive a blank field being read as null.
 assert.deepEqual(normalisePoints({multiplier:0}),{multiplier:0});
});

test('a correction multiplies before it adds, and ruling a player out leaves no number at all',()=>{
 const half=normalise(record({points:{multiplier:.5,delta:-1}}));
 assert.equal(adjust(12,half),5);assert.equal(describePoints(half.points),'×0.5 then -1');
 assert.equal(adjust(12,null),12);
 // A record that only carries a designation or a note leaves Sleeper's number where it was.
 assert.equal(adjust(12,normalise(record({note:'thumb'}))),12);
 // Out is the absence of an answer, not zero: zero is a number a complete lineup can be built on.
 assert.equal(adjust(12,normalise(record({status:'Out'}))),null);
 assert.equal(adjust(12,normalise(record({status:'Questionable'}))),12);
 assert.equal(adjust(null,normalise(record({points:{multiplier:.5}}))),null);
 const shown=adjustedBy(12,half);
 assert.equal(shown.original,12);assert.equal(shown.points,5);assert.equal(shown.changed,true);
 assert.equal(adjustedBy(12,null).changed,false);
});

test('a record outside its window is inert, and stays stored for the owner who wrote it',()=>{
 const mid=normalise(record({from:4,until:6,points:{delta:3}}));
 assert.equal(expired(mid,{week:3}),true);assert.equal(expired(mid,{week:4}),false);
 assert.equal(expired(mid,{week:6}),false);assert.equal(expired(mid,{week:7}),true);
 // No until is a correction to a player's standing rather than to one week, so it never expires.
 assert.equal(expired(normalise(record({from:4})),{week:40}),false);
 const lens=lensOf([mid]);
 assert.equal(lens.list.length,1);assert.equal(lens.find('star',3),null);assert.equal(lens.find('star',5).from,4);
 assert.equal(lens.count(3),0);assert.equal(lens.count(5),1);
 assert.equal(lens.project(10,'star',3),10);assert.equal(lens.project(10,'star',5),13);
});

test('the fingerprint moves when any stored field moves, including one no reader looks at',()=>{
 const base=[normalise(record({points:{delta:1}}))];
 assert.equal(fingerprint([]),'none');assert.equal(NO_OVERRIDES.fingerprint,'none');
 assert.equal(fingerprint(base),fingerprint([...base]));
 assert.notEqual(fingerprint(base),fingerprint([normalise(record({points:{delta:1},note:'a word'}))]));
 assert.notEqual(fingerprint(base),fingerprint([normalise(record({points:{delta:1},at:2}))]));
 // Order of writes is not a change to what is stored, so the key is taken over a sorted canonical
 // form: two tabs saving the same two records must land on the same cached numbers.
 const two=[normalise(record({points:{delta:1}})),normalise({player:'other',at:2,points:{delta:2}})];
 assert.equal(fingerprint(two),fingerprint([...two].reverse()));
});

test('a league named on a record is invisible elsewhere, and a season mismatch drops it',()=>{
 const forOne=normalise(record({league:'L1',points:{delta:5}}));
 assert.equal(lensOf([forOne],{league:'L1'}).any,true);
 assert.equal(lensOf([forOne],{league:'L2'}).any,false);
 // Including the league-agnostic lens the dashboard builds: a claim about one league does not leak
 // through the shared lens into every other league.
 assert.equal(lensOf([forOne]).any,false);
 // A season is a fact about when the record was written, so a view that forgot to say what year it
 // is still sees the correction, and a different year does not.
 const dated=normalise(record({season:2026,points:{delta:5}}));
 assert.equal(lensOf([dated]).any,true);
 assert.equal(lensOf([dated],{season:2026}).any,true);
 assert.equal(lensOf([dated],{season:2025}).any,false);
 // Two records on one player cannot come from the editor, which edits in place, but a second agent
 // or a hand-edited store can produce them. The narrower scope wins, then the newer write.
 const pair=[record({league:'L1',note:'narrow',at:1}),record({note:'wide',at:9})];
 assert.equal(lensOf(pair,{league:'L1'}).find('star',2).note,'narrow');
 assert.equal(lensOf([record({note:'old',at:1}),record({note:'new',at:9})]).find('star',2).note,'new');
});

test('only the overridden rows are patched, and the directory Sleeper sent is left alone',()=>{
 const map={star:{injury_status:'Questionable',injury_body_part:'Ankle',status:'Active'},depth:{status:'Active'}};
 const lens=lensOf([record({status:'Out',bodyPart:'Hamstring',rosterStatus:'Injured Reserve'})]);
 const patched=lens.players(map,2);
 assert.equal(patched.star.injury_status,'Out');assert.equal(patched.star.injury_body_part,'Hamstring');
 assert.equal(patched.star.status,'Injured Reserve');assert.equal(patched.star.override.player,'star');
 assert.equal(map.star.injury_status,'Questionable');assert.equal(patched.depth,map.depth);
 // Asked for again, the same object comes back: the pool runs to thousands of rows and the lineup
 // code asks for it inside loops.
 assert.equal(lens.players(map,2),patched);
 // Healthy clears the designation Sleeper is still carrying.
 assert.equal(lensOf([record({status:'Healthy'})]).players(map,2).star.injury_status,null);
 // A record that moves only the number has nothing to patch, so the directory passes straight back.
 assert.equal(lensOf([record({points:{delta:2}})]).players(map,2),map);
 assert.equal(NO_OVERRIDES.players(map,2),map);
});

// One roster, one free agent, one trade partner, and one week of projections worked by hand:
// QB 20, the starting WR 12, the WR behind him 10, the free agent 11, the partner's WR 14.
function fixture(){
 const P=(position,team)=>({position,fantasy_positions:[position],team,active:true});
 const players={qb:P('QB','BUF'),star:P('WR','BUF'),depth:P('WR','BUF'),fa:P('WR','KC'),theirs:P('WR','DAL')};
 const points=rec=>({stats:{rec}});
 const projections={qb:points(20),star:points(12),depth:points(10),fa:points(11),theirs:points(14)};
 const games=Object.fromEntries(['BUF','KC','DAL'].map(team=>[team,{state:'pre'}]));
 const mine={roster_id:1,players:['qb','star','depth'],starters:['qb','star'],reserve:[],taxi:[]};
 const partner={roster_id:2,players:['theirs'],starters:['theirs'],reserve:[],taxi:[]};
 const league={league_id:'L',roster_positions:['QB','WR','BN'],scoring_settings:{rec:1},rosters:[mine,partner],mine,matchups:[]};
 const outlook={weeks:[2,3],data:{2:{projections,games},3:{projections,games}}};
 return {players,projections,games,league,mine,partner,outlook};
}
// Every number the owner can see on one player, read the way the pages read them: tier 1 takes the
// lens off the data object, so attaching one is the whole of what a correction does.
function readAll(records){
 const f=fixture(),overrides=createOverrides({overrides:records});
 const data={week:2,nfl:{week:2,season:2026},user:{user_id:'u'},players:f.players,projections:{2:f.projections,3:f.projections},games:f.games,trends:[]};
 Object.defineProperty(data,'overrides',{value:overrides,enumerable:false});
 const lineup=lineupComparisons(data,f.league);
 const row=waiverRows(data,f.league,{}).find(r=>r.id==='fa');
 const model=buildSeasonModel({league:f.league,players:f.players,outlook:f.outlook,overrides});
 let trade=null;
 try{trade=model.evaluate(f.mine,f.partner,['star'],['theirs'])}catch{trade=null}
 return {
  baseline:lineup.baseline,
  swap:lineup.bench.find(b=>b.id==='depth').options.find(o=>o.slot==='WR').delta,
  startSit:usableValue(data,f.league,'star'),
  waiver:row?{status:row.status,gain:row.gain,drop:row.drop}:null,
  season:model.totals.star,
  gain:trade?trade.gainA:null,
  fingerprint:overrides.fingerprint
 };
}

test('one correction moves the lineup, the start and sit call, the waiver row and the trade model',()=>{
 const sleeper=readAll([]);
 assert.deepEqual(sleeper,{baseline:32,swap:-2,startSit:12,waiver:{status:'bench',gain:null,drop:'depth'},season:24,gain:4,fingerprint:'none'});
 // Half the projection on the starting WR. Every one of these numbers is a different module.
 const halved=readAll([record({points:{multiplier:.5}})]);
 assert.equal(halved.baseline,26);
 // The start and sit call turns over: the man on the bench is now worth four points more.
 assert.equal(halved.swap,4);assert.equal(halved.startSit,6);
 // The free agent was not worth a roster spot at 11 against 12, and is at 11 against 10.
 assert.deepEqual(halved.waiver,{status:'upgrade',gain:1,drop:'depth'});
 // Two weeks of outlook, so the season total halves with the week, and the offer to trade him away
 // improves by exactly what the correction took off.
 assert.equal(halved.season,12);assert.equal(halved.gain,8);
 assert.notEqual(halved.fingerprint,'none');
 // Ruling him out is not a projection of zero: the lineup loses the slot rather than filling it
 // with a zero, and the season model has no estimate to offer at all.
 const out=readAll([record({status:'Out',bodyPart:'Hamstring'})]);
 assert.equal(out.baseline,20);assert.equal(out.startSit,null);assert.equal(out.swap,10);
 assert.equal(out.season,null);assert.equal(out.gain,null);
});

test('and every one of them comes back when the correction expires or is removed',()=>{
 const sleeper=readAll([]);
 // The window is in the past, so the record is inert in week 2 while staying stored.
 const expired=readAll([record({points:{multiplier:.5},until:1})]);
 assert.deepEqual({...expired,fingerprint:'none'},sleeper);
 // The window has not opened yet.
 const later=readAll([record({points:{multiplier:.5},from:5,until:6})]);
 assert.deepEqual({...later,fingerprint:'none'},sleeper);
 // And removed is the empty store the page starts from.
 assert.deepEqual(readAll([]),sleeper);
 // A correction on another player leaves this one's numbers where Sleeper had them.
 const elsewhere=readAll([{player:'theirs',source:'owner',at:1,points:{multiplier:.5}}]);
 assert.equal(elsewhere.baseline,32);assert.equal(elsewhere.startSit,12);
 // The expired record is still in the store, so the editor can show it and the owner can bring it
 // back, and the fingerprint still names it: a key cannot go stale behind a window closing.
 const lens=lensOf([record({points:{multiplier:.5},until:1})]);
 assert.equal(lens.list.length,1);assert.equal(lens.count(2),0);assert.notEqual(lens.fingerprint,'none');
});
