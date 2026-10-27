import test from 'node:test'
import assert from 'node:assert/strict'
import {playerSignals,scoutFreeAgents,scoutingWeeks} from '../dist/scouting.js'

const scoring={rec:1,rec_yd:.1,rec_td:6,rush_yd:.1,rush_td:6}
const row=(targets,points=10,td=0)=>({stats:{gp:1,rec_tgt:targets,rush_att:0,rec:0,rec_yd:points*10,rec_td:td,rush_td:0}})

test('research excludes the current week and compares recent workloads without inventing a forecast',()=>{
 const rows=Object.fromEntries([2,3,4,8,9,10,99].map((n,i)=>[i+1,row(n)]))
 const r=playerSignals({rows,scoring,beforeWeek:7,projection:4,position:'WR'})
 assert.deepEqual(r.recentWeeks,[4,5,6])
 assert.deepEqual(r.priorWeeks,[1,2,3])
 assert.equal(r.targets.value,9)
 assert.equal(r.targetChange,6)
 assert.equal(r.gap,6)
 assert.ok(r.flags.includes('Targets rising'))
 assert.ok(r.flags.includes('Recent scoring above projection'))
 assert.equal(r.recentAverage,10)
 assert.deepEqual(scoutingWeeks(7),[1,2,3,4,5,6])
 assert.deepEqual(scoutingWeeks(1),[])
 assert.deepEqual(scoutingWeeks(19),[13,14,15,16,17,18])
})

test('byes, missing data and zero games are distinct, with explicit small samples',()=>{
 const rows={1:row(0,0),2:{stats:{gp:0,rec:0}},4:row(5,5),5:{stats:{gp:1,rec:0,rec_yd:0}}}
 const r=playerSignals({rows,scoring,beforeWeek:6,position:'WR'})
 assert.deepEqual(r.recentWeeks,[1,4,5])
 assert.equal(r.recentAverage,5/3)
 assert.equal(r.targets.games,2)
 assert.equal(r.targets.value,2.5)
 assert.equal(r.targetChange,null)
 assert.equal(r.gap,null)
 assert.equal(r.tdShare,null)
 assert.ok(r.flags.includes('Small sample'))
 assert.ok(r.flags.includes('Target data incomplete'))
 assert.ok(r.flags.includes('Projection unavailable'))
 assert.equal(playerSignals({rows:{},scoring}).recentAverage,null)
 assert.equal(playerSignals({rows:{1:row(0,-2)},scoring}).recentAverage,null,'old weeks fall outside the default window')
 assert.equal(playerSignals({rows:{1:row(0,-2)},scoring,beforeWeek:2}).recentAverage,-2)
})

test('touchdown dependence uses league weights and does not silently fill absent touchdown fields',()=>{
 const rows={4:row(5,2,2),5:row(5,2,2)}
 const r=playerSignals({rows,scoring,beforeWeek:6,projection:5})
 assert.equal(r.tdShare,12/14)
 assert.ok(r.flags.includes('Touchdown dependent'))
 const missing=structuredClone(rows)
 delete missing[4].stats.rush_td
 assert.equal(playerSignals({rows:missing,scoring,beforeWeek:6}).tdShare,null)
 assert.equal(playerSignals({rows,scoring:{...scoring,rec_td:1},beforeWeek:6}).tdShare,.5)
})

test('waiver research includes unprojected players and excludes all owned or ineligible players',()=>{
 const players=Object.fromEntries(['low','missing','owned','ir','taxi','inactive','other'].map(id=>[id,{position:id==='other'?'QB':'WR',active:id!=='inactive'}]))
 const data={week:3,players,projections:{3:{low:{stats:{rec_yd:10}}}}}
 const league={scoring_settings:scoring,roster_positions:['WR','BN'],rosters:[{players:['owned'],reserve:['ir'],taxi:['taxi']}]}
 const history=Object.fromEntries([1,2].map(week=>[week,Object.fromEntries(Object.keys(players).map(id=>[id,row(8,id==='missing'?20:10)]))]))
 const rows=scoutFreeAgents(data,league,history)
 assert.deepEqual(rows.map(r=>r.id),['missing','low'])
 assert.equal(rows[0].projection,null)
 assert.equal(rows[1].gap,9)
 assert.deepEqual(scoutFreeAgents(data,league,history,{excluded:['WR']}),[])
})

test('workload comparisons require complete coverage and named scoring modes keep provider totals',()=>{
 const rows=Object.fromEntries([2,3,4,8,9,10].map((n,i)=>[i+1,row(n)]))
 delete rows[4].stats.rec_tgt
 assert.equal(playerSignals({rows,scoring,beforeWeek:7}).targetChange,null)
 rows[5].stats.pts_ppr=17
 rows[6].stats.pts_ppr=19
 const r=playerSignals({rows,scoring,beforeWeek:7,pointKey:'pts_ppr'})
 assert.equal(r.recentAverage,18)
 assert.equal(r.scoredGames,2)
})

test('workload discovery can surface a lower-scoring player ahead of a touchdown spike',()=>{
 const players={role:{position:'WR'},spike:{position:'WR'},unknown:{position:'WR'}}
 const data={week:7,players,projections:{7:{}}}
 const league={scoring_settings:scoring,roster_positions:['WR'],rosters:[]}
 const history=Object.fromEntries([1,2,3,4,5,6].map(week=>[week,{role:row(week<4?2:9,5),spike:row(3,25),unknown:{stats:{gp:1,rec_yd:300}}}]))
 const rows=scoutFreeAgents(data,league,history,{sort:'targetChange'})
 assert.deepEqual(rows.map(r=>r.id),['role','spike','unknown'])
 assert.equal(rows[0].targetChange,7)
 assert.equal(rows[0].recentAverage,5)
})
