import * as api from '../api.js'
import {playerSignals,scoutFreeAgents,scoutingWeeks} from '../scouting.js'
import {S} from './state.js'
import {esc,fmt,injury,playerLink,signed} from './core.js'
import {render} from './render.js'

export const scoutingKey=()=>JSON.stringify([!!S.data.demo,S.data.user.user_id,S.data.nfl.season,S.data.week])
const SORTS={recentAverage:'Recent scoring',targetChange:'Target growth',carryChange:'Carry growth',gap:'Above projection'}
const number=n=>Number.isFinite(n)?fmt(n):'N/A'
const sample=(data,week)=>Object.fromEntries(Object.entries(data.players).filter(([,p])=>p.demoStats).map(([id,p])=>[id,{stats:{...p.demoStats,gp:1},team:p.team,week}]))

export async function loadScouting(){
 const key=scoutingKey()
 if(S.scoutingState?.key===key&&S.scoutingState.loading)return
 const data=S.data,weeks=scoutingWeeks(data.week)
 const state={key,loading:true,history:{},errors:[],weeks,loadedAt:null}
 S.scoutingState=state
 render()
 // Three concurrent requests keep this optional scan bounded.
 const pending=[...weeks]
 await Promise.all(Array.from({length:3},async()=>{
  while(pending.length){
   const week=pending.shift()
   try{state.history[week]=data.demo?sample(data,week):await api.stats(data.nfl.season,week,{force:true})}
   catch{state.errors.push(week)}
  }
 }))
 state.loading=false
 state.loadedAt=Date.now()
 if(S.scoutingState===state&&S.view==='waivers'&&scoutingKey()===key)render()
}

export function signalDetails(signals){
 const stat=(label,now,prior)=>`${label}: ${number(now.value)} (${now.games} games), previously ${number(prior.value)} (${prior.games} games)`
 return `<p class="muted small">${esc(stat('Targets / game',signals.targets,signals.priorTargets))}<br>${esc(stat('Carries / game',signals.carries,signals.priorCarries))}<br>Recent scoring minus projection: ${signals.gap===null?'N/A':signed(signals.gap)} points<br>Touchdown share of recent points: ${signals.tdShare===null?'N/A':fmt(signals.tdShare*100,0)+'%'}<br>${signals.flags.map(esc).join(' · ')||'No threshold flags'}</p>`
}

export function profileSignals(rows,scoring,beforeWeek,projection,position,pointKey=null){
 if(!['QB','RB','WR','TE'].includes(position))return ''
 const signals=playerSignals({rows,scoring,beforeWeek,projection,position,pointKey})
 return `<details class="data-details"><summary>Beyond projections · Experimental</summary><p>Last ${signals.recentWeeks.length} recorded games in the six prior weeks: ${signals.recentWeeks.length?signals.recentWeeks.map(w=>'W'+w).join(', '):'none'}. Recent scoring: ${number(signals.recentAverage)} points / game. Earlier games: ${number(signals.priorAverage)}.${signals.gap===null?'':` Recent scoring minus the selected week’s projection: ${signed(signals.gap)}.`}</p>${signalDetails(signals)}<p class="muted small">Current and future weeks are excluded. Missing stats stay unknown. These are review signals, not a new forecast. Check injuries, role changes and matchups before acting.</p></details>`
}

export function scoutingPanel(l){
 const state=S.scoutingState?.key===scoutingKey()?S.scoutingState:null
 const position=S.scoutingPosition||'WR'
 const sort=SORTS[S.scoutingSort]?S.scoutingSort:'recentAverage'
 const rows=state&&!state.loading&&!state.errors.length?scoutFreeAgents(S.data,l,state.history,{position,excluded:S.waiverExcluded.add,sort}):[]
 return `<section class="panel"><div class="section-bar"><h2>Beyond projections</h2><span class="pill">EXPERIMENTAL</span></div><p>Look for available players whose recent production or workload deserves a closer look. This scans beyond the projection shortlist.</p><div class="waiver-toolbar"><label>Position <select class="select" id="scouting-position">${['QB','RB','WR','TE'].map(p=>`<option value="${p}" ${p===position?'selected':''}>${p}</option>`).join('')}</select></label><label>Explore by <select class="select" id="scouting-sort">${Object.entries(SORTS).map(([key,label])=>`<option value="${key}" ${key===sort?'selected':''}>${label}</option>`).join('')}</select></label><button class="secondary" id="load-scouting" ${state?.loading?'disabled':''}>${state?.loading?'Loading recent stats…':state?'Refresh recent stats':'Explore recent performance'}</button></div>
 ${state?.loading?'<p role="status">Loading the six prior weeks…</p>':state?.errors.length?`<p role="status">Stats unavailable for week(s) ${state.errors.sort((a,b)=>a-b).join(', ')}. Refresh to retry. Research results are paused.</p>`:state?`<p class="muted small">${S.data.demo?'Illustrative sample stats. ':''}${state.weeks.length?`Weeks ${state.weeks[0]} to ${state.weeks.at(-1)}`:'No prior weeks available'} · Loaded ${esc(new Date(state.loadedAt).toLocaleTimeString())}. Showing ${Math.min(15,rows.length)} of ${rows.length} available ${position}s with recorded games, sorted by ${SORTS[sort].toLowerCase()}. Unknown values sort last. Pickup position filters apply.</p>${rows.length?`<div class="table-wrap"><table><thead><tr><th>PLAYER</th><th>RECENT PTS / GAME</th><th>THIS WEEK PROJ.</th><th>REVIEW SIGNALS</th></tr></thead><tbody>${rows.slice(0,15).map(r=>`<tr><td>${playerLink(r.id)}<div class="muted small">${esc(S.data.players[r.id].team||'FA')}${injury(S.data.players[r.id])}</div></td><td>${number(r.recentAverage)}<div class="muted small">${r.scoredGames} scored games · ${r.recentWeeks.map(w=>'W'+w).join(', ')}</div></td><td>${number(r.projection)}</td><td>${signalDetails(r)}</td></tr>`).join('')}</tbody></table></div>`:'<p>No recorded games match this position and your pickup filters.</p>'}`:''}
 <p class="muted small">Recent means up to three recorded games within the six prior weeks, compared with up to three earlier games in that window. Current week excluded. Missing games are not zeros. Recent scoring is not a future projection. These observations do not change recommendations or trigger alerts. ADP, routes and snap share are not available in this prototype.</p></section>`
}
