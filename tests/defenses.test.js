import test from 'node:test';
import assert from 'node:assert/strict';
import {defenseWeeks,defenseTone,defenseOutlook,defenseAvailability} from '../dist/defenses.js';

test('planner covers five weeks including current week and stops at week 18',()=>{
 assert.deepEqual(defenseWeeks(2),[2,3,4,5,6]);assert.deepEqual(defenseWeeks(16),[16,17,18]);assert.deepEqual(defenseWeeks(18),[18]);
});
test('weekly median uses all projected defenses, league scoring, and excludes byes and missing projections',()=>{
 const players=Object.fromEntries(['A','B','C','D','E','F'].map(team=>[team,{position:'DEF',team}]));players.qb={position:'QB'};
 const projections={2:Object.fromEntries([['A',2],['B',4],['C',6],['D',12],['E',100],['qb',1000]].map(([id,sack])=>[id,{stats:{sack}}]))};
 const schedules={2:{A:{},B:{},C:{},D:{},F:{}}};
 const week=defenseOutlook({players,projections,schedules,weeks:[2],scoring:{sack:2}})[2];
 assert.equal(week.median,10);assert.equal(week.count,4);assert.equal(week.rows.C.delta,2);assert.equal(week.rows.C.tone,'good');
 assert.equal(week.rows.E.bye,true);assert.equal(week.rows.E.points,0);assert.equal(week.rows.E.delta,null);
 assert.equal(week.rows.F.points,null);assert.equal(week.rows.F.tone,'unknown');
});
test('each week has an independent baseline and missing schedules never imply a bye',()=>{
 const players={A:{position:'DEF',team:'A'},B:{position:'DEF',team:'B'},C:{position:'DEF',team:'C'}};
 const outlook=defenseOutlook({players,projections:{2:{A:{stats:{sack:2}}},3:{A:{stats:{sack:4}},B:{stats:{sack:6}},C:{stats:{sack:20}}}},schedules:{},weeks:[2,3,4],scoring:{sack:1}});
 assert.equal(outlook[2].median,2);assert.equal(outlook[3].median,6);assert.equal(outlook[4].median,null);assert.equal(outlook[4].rows.A.bye,false);assert.equal(outlook[4].rows.A.points,null);
});
test('color bands use point differences with symmetric thresholds',()=>{
 assert.deepEqual([-4,-3,-2,-1,0,.9,1,2,3,4,null].map(defenseTone),['poor','poor','weak','weak','neutral','neutral','good','good','strong','strong','unknown']);
});
test('defense ownership is league-specific and other teams or reserved defenses cannot enter rotations',()=>{
 const players=Object.fromEntries(['A','B','C','D','E','F'].map(id=>[id,{position:'DEF',active:true}]));
 players.retired={position:'DEF',active:false};players.qb={position:'QB'};
 const mine={roster_id:1,players:['A','D'],reserve:['D'],taxi:[]},other={roster_id:2,players:['B'],reserve:['E'],taxi:['F']};
 const availability=defenseAvailability({mine,rosters:[mine,other]},players);
 assert.equal(availability.A.status,'mine');assert.equal(availability.D.status,'mine');assert.equal(availability.D.canUse,false);
 assert.equal(availability.C.status,'available');
 for(const id of ['B','E','F']){assert.equal(availability[id].status,'other');assert.equal(availability[id].rosterId,2);assert.equal(availability[id].canUse,false)}
 assert.deepEqual(Object.keys(availability).filter(id=>availability[id].canUse),['A','C']);
 assert.equal(availability.retired,undefined);assert.equal(availability.qb,undefined);
 assert.equal(defenseAvailability({mine:other,rosters:[mine,other]},players).B.status,'mine');
});
