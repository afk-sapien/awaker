import test from 'node:test';
import assert from 'node:assert/strict';
import {lineupComparisons} from '../dist/lineup.js';
function fixture(){
 const players={a:{position:'RB',team:'A'},b:{position:'RB',team:'B'},c:{position:'WR',team:'C'},d:{position:'RB',team:'D'},ir:{position:'RB'},taxi:{position:'RB'}};
 const data={week:2,players,games:{A:{state:'pre'},B:{state:'pre'},C:{state:'pre'},D:{state:'pre'}},projections:{2:{a:{stats:{rec:10}},b:{stats:{rec:15}},c:{stats:{rec:20}},d:{stats:{rec:8}}}}};
 const league={roster_positions:['RB','FLEX','BN','IR'],mine:{roster_id:1,players:['a','b','c','d','ir','taxi'],starters:['a','c'],reserve:['ir'],taxi:['taxi']},matchups:[],scoring_settings:{rec:1}};
 return {data,league};
}
test('bench comparisons include every active bench player and each legal direct swap',()=>{
 const {data,league}=fixture(),r=lineupComparisons(data,league);
 assert.equal(r.baseline,30);assert.deepEqual(r.bench.map(p=>p.id),['b','d']);
 assert.deepEqual(r.bench[0].options.map(o=>[o.id,o.delta]),[['a',5],['c',-5]]);
 assert.deepEqual(r.bench[1].options.map(o=>o.delta),[-2,-12]);
 league.scoring_settings.rec=.5;assert.equal(lineupComparisons(data,league).bench[0].options[0].delta,2.5);
});
test('started bench players stay visible but cannot be swapped, and starter locks are respected',()=>{
 const {data,league}=fixture();data.games.A.state='in';data.games.B.state='post';
 const r=lineupComparisons(data,league);assert.equal(r.bench[0].reason,'Game started · locked');assert.deepEqual(r.bench[0].options,[]);
 assert.deepEqual(r.bench[1].options.map(o=>o.id),['c']);
});
test('missing projections remain unknown instead of inflating gains',()=>{
 const {data,league}=fixture();delete data.projections[2].a;delete data.projections[2].d;
 const r=lineupComparisons(data,league);assert.equal(r.baseline,null);assert.equal(r.bench[0].options.find(o=>o.id==='a').delta,null);
 assert.equal(r.bench[1].reason,'Projection unavailable');assert.equal(r.bench[1].projection,null);
});
test('a starter ruled out counts as the zero he will score, and an injured bench player cannot be recommended',()=>{
 const {data,league}=fixture();data.players.a.injury_status='Out';data.players.d.injury_status='IR';
 const r=lineupComparisons(data,league);assert.equal(r.baseline,20,'his 10 projected points are not coming');
 assert.equal(r.starters[0].projection,0);assert.equal(r.bench[0].options[0].delta,15,'benching him gains everything the replacement scores');
 assert.equal(r.bench[1].reason,'IR');
 data.players.a.injury_status='Questionable';assert.equal(lineupComparisons(data,league).baseline,30,'a questionable starter still might play');
});
test('empty slots contribute zero while negative and zero projections remain valid',()=>{
 const {data,league}=fixture();league.mine.starters=['0'];data.projections[2].b.stats.rec=-2;data.projections[2].d.stats.rec=0;
 const r=lineupComparisons(data,league);assert.equal(r.baseline,0);assert.equal(r.bench.find(p=>p.id==='b').options[0].delta,-2);assert.equal(r.bench.find(p=>p.id==='d').options[0].delta,0);
});
