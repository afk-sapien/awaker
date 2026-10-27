import {playerHistory} from '../api.js'
import {projected} from '../engine.js'
import {S} from './state.js'
import {$,esc,fmt,injury,league,pname,playerPortrait} from './core.js'
import {profileSignals} from './scouting.js'

const STANDARD={rec_yd:.1,rec_td:6,rush_yd:.1,rush_td:6,pass_yd:.04,pass_td:4,pass_int:-2,fum_lost:-2,sack:1,int:2,fum_rec:2,def_td:6,pts_allow_14_20:1}
const FIELDS={
 QB:[['pass_yd','Pass yards'],['pass_td','Pass TD'],['pass_int','INT'],['rush_yd','Rush yards'],['rush_td','Rush TD']],
 RB:[['rush_att','Carries'],['rush_yd','Rush yards'],['rush_td','Rush TD'],['rec_tgt','Targets'],['rec','Rec'],['rec_yd','Rec yards'],['rec_td','Rec TD']],
 WR:[['rec_tgt','Targets'],['rec','Rec'],['rec_yd','Rec yards'],['rec_td','Rec TD'],['rush_yd','Rush yards']],
 TE:[['rec_tgt','Targets'],['rec','Rec'],['rec_yd','Rec yards'],['rec_td','Rec TD']],
 K:[['fgm','FG made'],['fga','FG att'],['fgm_50p','50+ FG'],['xpm','XP made']],
 DEF:[['sack','Sacks'],['int','INT'],['fum_rec','Fum rec'],['def_td','TD'],['pts_allow','Pts allowed'],['yds_allow','Yds allowed']]
}
let current=null
let opener=null
let openerId=null
let openerIndex=0

export function playerSeasons(data){
 const year=Number(data.nfl?.season)||new Date().getFullYear()
 return Array.from({length:Math.min(5,Math.max(1,year-2016))},(_,i)=>year-i)
}
export function historyModel(rows,scoring,mode='league',season=2026){
 const weeks=Array.from({length:season>=2021?18:17},(_,i)=>{
  const row=rows?.[i+1]
  const stats=row?.stats
  const played=!!stats&&stats.gp!==0&&(stats.gp>0||['pts_ppr','pts_std','pts_half_ppr'].some(k=>Number.isFinite(stats[k])))
  const key={ppr:'pts_ppr',half:'pts_half_ppr',standard:'pts_std'}[mode]
  const points=played?(key?(Number.isFinite(stats[key])?stats[key]:null):projected(stats,scoring)):null
  return {...row,week:i+1,played,points}
 })
 const scored=weeks.filter(w=>Number.isFinite(w.points))
 const total=scored.reduce((sum,w)=>sum+w.points,0)
 return {weeks,scored,total:scored.length?total:null,average:scored.length?total/scored.length:null,best:scored.length?Math.max(...scored.map(w=>w.points)):null}
}

function sampleHistory(id,season){
 const p=S.data.players[id]
 if(!p?.demoStats)return {}
 const end=season===playerSeasons(S.data)[0]?S.data.week:18
 return Object.fromEntries(Array.from({length:end},(_,i)=>{
  const week=i+1
  if(week===8)return [week,null]
  const stats={...p.demoStats,gp:1}
  for(const key of ['rec_yd','rush_yd','pass_yd'])if(stats[key])stats[key]=Math.round(stats[key]*(.65+(week%5)*.15))
  stats.pts_std=projected(stats,STANDARD)??0
  stats.pts_half_ppr=stats.pts_std+(stats.rec||0)*.5
  stats.pts_ppr=stats.pts_std+(stats.rec||0)
  return [week,{week,stats,team:p.team,opponent:S.data.games[p.team]?.opponent}]
 }).filter(([,row])=>row))
}

export function historyChart(model){
 const max=Math.max(1,...model.scored.map(w=>Math.abs(w.points)))
 const labelY=model.scored.some(w=>w.points<0)?205:128
 const bars=model.weeks.map(w=>{
  const x=12+(w.week-1)*32
  const available=Number.isFinite(w.points)
  const height=available?Math.abs(w.points)/max*75:0
  return `<g><title>Week ${w.week}: ${available?fmt(w.points)+' points':'No stats'}</title>${available?`<rect x="${x}" y="${w.points<0?100:100-height}" width="21" height="${Math.max(2,height)}" rx="3" fill="${w.points<0?'var(--orange)':'var(--green)'}"/><text x="${x+10}" y="${w.points<0?115+height:92-height}" text-anchor="middle">${fmt(w.points)}</text>`:`<text x="${x+10}" y="92" text-anchor="middle">·</text>`}<text x="${x+10}" y="${labelY}" text-anchor="middle">${w.week}</text></g>`
 }).join('')
 return `<div class="player-chart"><svg viewBox="0 0 595 ${labelY+13}" role="img" aria-label="Weekly fantasy points. Exact scores are in the game log below."><path d="M8 100H589" stroke="var(--line)"/>${bars}</svg></div>`
}

export function playerDetailsHTML(state){
 const {id,season,rows,loading,error,mode,leagueId}=state
 const player=S.data.players[id]||{}
 const l=S.data.leagues.find(l=>l.league_id===leagueId)
 const name=pname(id)
 const seasons=playerSeasons(S.data)
 const model=historyModel(rows,l?.scoring_settings,mode,season)
 const fields=FIELDS[player.position]||FIELDS.WR
 const label=mode==='league'?l?.name||'League scoring':({ppr:'PPR',half:'Half PPR',standard:'Standard'})[mode]
 const enabled=S.data.leagues.filter(l=>l.enabled)
 const search=`https://www.google.com/search?q=${encodeURIComponent(name+' NFL fantasy stats news')}`
 const source=S.data.demo?'Illustrative sample stats':'Sleeper regular season stats'
 const number=n=>Number.isFinite(n)?fmt(n):'N/A'
 const content=loading?'<p class="empty" role="status">Loading weekly stats…</p>':error?'<div class="empty" role="status"><h3>Stats are unavailable right now</h3><p>Try again, or use the links below for more stats and news.</p><button type="button" class="secondary" id="player-retry">Try again</button></div>':!model.weeks.some(w=>w.played)?'<div class="empty" role="status"><h3>No stats for this season</h3><p>Sleeper has no recorded games for this player yet. Try another season or the links below.</p></div>':`
  <dl class="player-totals">${[['Fantasy points',number(model.total)],['Points / game',number(model.average)],['Best week',number(model.best)],['Games with scores',String(model.scored.length)]].map(([label,value])=>`<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>
  ${profileSignals(rows,mode==='league'?l?.scoring_settings:{...STANDARD,rec:mode==='ppr'?1:mode==='half'?.5:0},season===Number(S.data.nfl.season)?S.data.week:19,season===Number(S.data.nfl.season)?projected(S.data.projections[S.data.week]?.[id]?.stats,mode==='league'?l?.scoring_settings:{...STANDARD,rec:mode==='ppr'?1:mode==='half'?.5:0}):null,player.position,({ppr:'pts_ppr',half:'pts_half_ppr',standard:'pts_std'})[mode])}
  <h3>Weekly fantasy points</h3>${historyChart(model)}
  <p class="muted small">${esc(label)}${mode==='league'?'. Calculated using this league’s current scoring settings. Historical settings and commissioner overrides are not included.':'. Sleeper’s scoring totals.'} Games in progress may be incomplete. Missing scores are excluded from averages.</p>
  <div class="table-wrap player-game-log" tabindex="0" role="region" aria-label="Weekly player stats"><table><caption>${season} regular season game log</caption><thead><tr><th scope="col">Week</th><th scope="col">Opponent</th><th scope="col">Points</th>${fields.map(([,label])=>`<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${model.weeks.map(w=>`<tr><th scope="row">${w.week}</th><td>${w.opponent?`${w.away===true?'@ ':w.away===false?'vs ':''}${esc(w.opponent)}`:'N/A'}</td><td class="num"><strong>${w.played?number(w.points):'<span class="muted small">No stats</span>'}</strong></td>${fields.map(([key])=>`<td class="num">${w.played?(Number.isFinite(w.stats[key])?fmt(w.stats[key],Number.isInteger(w.stats[key])?0:1):'N/A'):'N/A'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
  <p class="muted small">No stats can mean a bye, no appearance, a future game, or missing data. N/A means that value was not provided.</p>`
 return `<div class="player-dialog-top"><span class="eyebrow">PLAYER PROFILE</span><button type="button" class="secondary" id="player-close" autofocus>Close</button></div>
 <div class="player-profile-heading">${playerPortrait(id,player)}<div><h2 id="player-title">${esc(name)}</h2><p class="muted">${esc(player.team||'FA')} · ${esc(player.position||'Player')}${injury(player)}</p></div></div>
 <div class="player-controls"><label>Season<select class="select" id="player-season">${seasons.map(y=>`<option value="${y}" ${y===season?'selected':''}>${y}</option>`).join('')}</select></label><label>Scoring<select class="select" id="player-scoring">${enabled.map(l=>`<option value="league:${esc(l.league_id)}" ${mode==='league'&&l.league_id===leagueId?'selected':''}>${esc(l.name)}</option>`).join('')}${[['ppr','PPR'],['half','Half PPR'],['standard','Standard']].map(([key,label])=>`<option value="${key}" ${mode===key?'selected':''}>${label}</option>`).join('')}</select></label></div>
 <p class="muted small">${source} · ${season}${S.data.demo?' · Not actual player results':''}</p>
 <section aria-busy="${loading}">${content}</section><div class="player-external"><a class="secondary" href="${search}" target="_blank" rel="noopener noreferrer">Find ${esc(name)} stats & news ↗</a><a href="https://sleeper.com/nfl/players" target="_blank" rel="noopener noreferrer">Sleeper player directory ↗</a></div>`
}

function draw(){
 if(!current)return
 const dialog=$('#player-dialog')
 const focused=dialog.contains(document.activeElement)?document.activeElement.id:null
 const scroll=dialog.scrollTop
 dialog.innerHTML=playerDetailsHTML(current)
 if(focused)document.getElementById(focused)?.focus({preventScroll:true})
 dialog.scrollTop=scroll
}
async function load(force=false){
 const state=current
 state.loading=true
 state.error=false
 state.rows=null
 draw()
 try{
  const rows=S.data.demo?sampleHistory(state.id,state.season):await playerHistory(state.id,state.season,{force})
  if(current!==state)return
  state.rows=rows
 }catch{
  if(current!==state)return
  state.error=true
 }
 if(current===state){
  state.loading=false
  draw()
 }
}
export function openPlayer(id,trigger){
 if(!id||id==='0')return
 const l=S.view==='watch'&&S.watchLeague!=='all'?S.data.leagues.find(l=>l.league_id===S.watchLeague):league()
 opener=trigger
 openerId=id
 openerIndex=[...document.querySelectorAll('[data-player]')].filter(el=>el.dataset.player===id).indexOf(trigger)
 current={id,season:playerSeasons(S.data)[0],mode:l?'league':'ppr',leagueId:l?.league_id,rows:null,loading:true,error:false}
 draw()
 $('#player-dialog').showModal()
 $('#player-close').focus()
 load()
}
export function bindPlayerDetails(){
 const dialog=$('#player-dialog')
 dialog.addEventListener('close',()=>{
  current=null
  const replacement=[...document.querySelectorAll('[data-player]')].filter(el=>el.dataset.player===openerId)
  const target=opener?.isConnected?opener:replacement[openerIndex]||replacement[0]
  target?.focus({preventScroll:true})
 })
 dialog.addEventListener('click',event=>{
  if(event.target.closest('#player-close'))dialog.close()
  if(event.target.closest('#player-retry'))load(true)
  if(event.target===dialog){const r=dialog.getBoundingClientRect()
   if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close()
  }
 })
 dialog.addEventListener('change',event=>{
  if(!current)return
  if(event.target.id==='player-season'){
   current={...current,season:Number(event.target.value)}
   load()
  }
  if(event.target.id==='player-scoring'){
   const selected=event.target.value
   current.mode=selected.startsWith('league:')?'league':selected
   if(current.mode==='league')current.leagueId=selected.slice(7)
   draw()
  }
 })
}
