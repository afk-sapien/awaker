import test from 'node:test'
import assert from 'node:assert/strict'
import {playerHistory} from '../dist/api.js'
import {historyModel,historyChart,playerDetailsHTML,playerSeasons} from '../dist/ui/player-details.js'
import {playerChip,playerLink} from '../dist/ui/core.js'
import {S} from '../dist/ui/state.js'
import {demo} from '../dist/demo.js'

test('player logs normalize weekly responses, cache by player and season, and reject bad feeds',async()=>{
 const original=globalThis.fetch
 const calls=[]
 let response={'1':{stats:{gp:1,rec:3,pts_ppr:9,bad:'bad'},opponent:'BUF',is_away_team:true},'2':null,'3':{stats:{gp:1,pts_ppr:0}}}
 globalThis.fetch=async url=>{calls.push(url)
 return Response.json(response)}
 try{
  const first=await playerHistory('4035',2099)
  assert.equal(first[1].stats.rec,3)
  assert.equal(first[1].stats.bad,undefined)
  assert.equal(first[1].away,true)
  assert.equal(first[2],undefined)
  assert.equal(first[3].stats.pts_ppr,0)
  assert.equal(await playerHistory('4035',2099),first)
  assert.equal(calls.length,1)
  await playerHistory('BUF',2099)
  await playerHistory('4035',2098)
  assert.equal(calls.length,3)
  await playerHistory('4035',2099,{force:true})
  assert.equal(calls.length,4)
  response={error:'unavailable'}
  await assert.rejects(playerHistory('4035',2099,{force:true}),/unavailable/)
  response=[]
  await assert.rejects(playerHistory('4035',2099,{force:true}),/unavailable/)
  await assert.rejects(playerHistory('../4035',2099),/Invalid/)
  assert.equal(calls.length,6)
 }finally{globalThis.fetch=original}
})

test('scoring keeps zero and negative games, excludes missing weeks, and supports league settings',()=>{
 const rows={1:{stats:{gp:1,rec:4,rec_yd:50,pts_ppr:9,pts_std:5}},2:{stats:{gp:1,rec:0,rec_yd:0,pts_ppr:0}},4:{stats:{gp:1,fum_lost:1,pts_ppr:-2}},5:{stats:{gp:0,pts_ppr:0}}}
 const model=historyModel(rows,{rec:.5,rec_yd:.1,fum_lost:-2})
 assert.equal(model.weeks.length,18)
 assert.deepEqual(model.scored.map(w=>w.points),[7,0,-2])
 assert.equal(model.total,5)
 assert.equal(model.average,5/3)
 assert.equal(model.weeks[2].points,null)
 assert.equal(model.weeks[4].points,null)
 assert.equal(historyModel(rows,{},'ppr').total,7)
 assert.equal(historyModel(rows,{},'standard').total,5)
 assert.equal(historyModel({},{}).total,null)
 assert.equal(historyModel(rows,{},'ppr',2020).weeks.length,17)
 assert.match(historyChart(model),/Week 4: -2.0 points/)
 assert.match(historyChart(model),/Week 3: No stats/)
})

test('profiles escape provider text and show clear loading, empty, and failure states',()=>{
 S.data=demo()
 const id='4984'
 S.data.players[id].full_name='<img src=x onerror=alert(1)>'
 const state={id,season:2026,mode:'league',leagueId:S.data.leagues[0].league_id,rows:{},loading:false,error:false}
 assert.deepEqual(playerSeasons(S.data),[2026,2025,2024,2023,2022])
 assert.match(playerDetailsHTML(state),/No stats for this season/)
 assert.match(playerDetailsHTML({...state,loading:true}),/Loading weekly stats/)
 assert.match(playerDetailsHTML({...state,error:true}),/Stats are unavailable right now/)
 const html=playerDetailsHTML({...state,rows:{1:{stats:{gp:1,pass_yd:200,pass_td:1},opponent:'<script>'}}})
 assert.match(html,/200/)
 assert.match(html,/Illustrative sample stats/)
 assert.match(html,/current scoring settings/)
 assert.match(html,/&lt;script&gt;/)
 assert.doesNotMatch(html,/<img src=x/)
 assert.match(playerChip(id),/data-player="4984"/)
 assert.doesNotMatch(playerChip(id),/<img src=x/)
 assert.equal(playerLink('0'),'Empty slot')
 assert.match(playerLink('unknown'),/data-player="unknown"/)
})

test('a delayed profile response cannot overwrite another season or a newly opened player',async()=>{
 const {openPlayer,bindPlayerDetails}=await import('../dist/ui/player-details.js')
 const oldDocument=globalThis.document
 const oldFetch=globalThis.fetch
 const requests=[]
 const listeners={}
 const trigger={isConnected:true,focus(){}}
 const close={focus(){}}
 const dialog={innerHTML:'',scrollTop:0,contains:()=>false,showModal(){this.open=true},addEventListener(type,fn){listeners[type]=fn}}
 globalThis.document={activeElement:null,querySelector:s=>s==='#player-dialog'?dialog:close,querySelectorAll:()=>[],getElementById:()=>null}
 globalThis.fetch=url=>new Promise(resolve=>requests.push({url,resolve}))
 const flush=()=>new Promise(resolve=>setImmediate(resolve))
 const reply=(request,points)=>request.resolve(Response.json({1:{stats:{gp:1,rec:points,pts_ppr:points}}}))
 try{
  S.data=demo()
  S.data.demo=false
  S.data.nfl.season='2090'
  S.leagueId=S.data.leagues[0].league_id
  S.view='lineup'
  bindPlayerDetails()
  openPlayer('4984',trigger)
  await flush()
  listeners.change({target:{id:'player-season',value:'2089'}})
  await flush()
  reply(requests[1],27)
  await flush()
  assert.match(dialog.innerHTML,/2089 regular season game log/)
  reply(requests[0],99)
  await flush()
  assert.match(dialog.innerHTML,/2089 regular season game log/)
  assert.doesNotMatch(dialog.innerHTML,/>99.0</)
  openPlayer('9509',trigger)
  await flush()
  listeners.close()
  openPlayer('4984',trigger)
  await flush()
  reply(requests[2],80)
  await flush()
  assert.match(dialog.innerHTML,/id="player-title">Josh Allen</)
  assert.doesNotMatch(dialog.innerHTML,/>80.0</)
 }finally{
  listeners.close?.()
  globalThis.fetch=oldFetch
  globalThis.document=oldDocument
 }
})
