import test from 'node:test'
import assert from 'node:assert/strict'
import {waiverMove} from '../dist/engine.js'
import {buildWaiverOutlook} from '../dist/waivers.js'
import {waiverRows,futureWaiverRows} from '../dist/analysis.js'

function fixture(){
 const players=Object.fromEntries(['starter','weak','chosen','pickup'].map(id=>[id,{position:'RB',team:'BUF'}]))
 const values={starter:20,weak:1,chosen:5,pickup:25}
 const roster=['starter','weak','chosen']
 const league={league_id:'L',scoring_settings:{rush_yd:1},roster_positions:['RB','BN','BN'],mine:{players:roster,starters:['starter'],roster_id:1},matchups:[]}
 league.rosters=[league.mine]
 const week={games:{BUF:{state:'pre'}},projections:Object.fromEntries(Object.entries(values).map(([id,rush_yd])=>[id,{stats:{rush_yd}}]))}
 const outlook={weeks:[3,4],data:{3:week,4:week}}
 const data={players,week:3,user:{user_id:'u'},trends:[],games:week.games,projections:{3:week.projections}}
 const current={roster,slots:['RB'],players,value:id=>values[id]??null,capacity:3,starterIds:['starter'],id:'pickup'}
 return {players,values,league,outlook,data,current}
}

test('a selected drop is honored in both horizons, including with an open slot',()=>{
 const f=fixture()
 assert.equal(waiverMove(f.current).drop,'weak')
 assert.equal(waiverMove({...f.current,dropId:'chosen'}).drop,'chosen')
 assert.equal(waiverMove({...f.current,dropId:'chosen',capacity:4}).drop,'chosen')
 assert.equal(waiverMove({...f.current,capacity:4}).drop,null)
 f.league.roster_positions.push('BN')
 assert.equal(buildWaiverOutlook({...f,dropId:'chosen'}).evaluate('pickup').drop,'chosen')
 assert.equal(buildWaiverOutlook(f).evaluate('pickup').drop,null)
 const prefs={waiverDropId:'chosen'}
 assert.equal(waiverRows(f.data,f.league,prefs)[0].drop,'chosen')
 assert.equal(futureWaiverRows(f.data,f.league,f.outlook,prefs)[0].drop,'chosen')
})

test('selection never falls back to another player when protected, locked, unknown or outside the active roster',()=>{
 const f=fixture()
 for(const opts of [{protectedIds:['chosen']},{starterIds:['chosen']},{excludedDropPositions:['RB']},{locked:{0:'chosen'}},{dropId:'not-owned'},{value:id=>id==='chosen'?null:f.values[id]}]){
  assert.equal(waiverMove({...f.current,dropId:'chosen',...opts}).status,'no_safe_drop')
 }
 for(const opts of [{protectedIds:['chosen']},{starterIds:['chosen']},{excludedDropPositions:['RB']},{dropId:'not-owned'}]){
  assert.equal(buildWaiverOutlook({...f,dropId:'chosen',...opts}).evaluate('pickup').status,'no_safe_drop')
 }
 delete f.outlook.data[3].projections.chosen
 assert.equal(buildWaiverOutlook({...f,dropId:'chosen'}).evaluate('pickup').status,'no_safe_drop')
})

test('a forced replacement that makes the lineup worse is not recommended',()=>{
 const f=fixture()
 f.values.pickup=10
 f.outlook.data[3].projections.pickup.stats.rush_yd=10
 assert.equal(waiverMove({...f.current,starterIds:[],dropId:'starter'}).status,'no_gain')
 assert.equal(buildWaiverOutlook({...f,dropId:'starter'}).evaluate('pickup').status,'no_gain')
})
