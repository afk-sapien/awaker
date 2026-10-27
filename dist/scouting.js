import {activeSlots,availableIds,eligible,projected,tradeCandidateIds} from './engine.js'

const average=values=>values.length?values.reduce((sum,n)=>sum+n,0)/values.length:null
const played=stats=>stats&&stats.gp!==0&&(stats.gp>0||['pts_ppr','pts_std','pts_half_ppr'].some(key=>Number.isFinite(stats[key])))
const metric=(rows,key)=>{
 const values=rows.map(row=>row.stats[key]).filter(Number.isFinite)
 return {value:average(values),games:values.length}
}

export function scoutingWeeks(week){
 const end=Math.min(18,Math.max(0,Number(week)-1))
 return Array.from({length:Math.min(6,end)},(_,i)=>end-Math.min(6,end)+i+1)
}

// Descriptive evidence only. These thresholds have not been calibrated as forecasts.
export function playerSignals({rows={},scoring={},beforeWeek=19,projection=null,position,pointKey=null}){
 const games=Object.entries(rows).map(([week,row])=>({...row,week:Number(week)}))
  .filter(row=>row.week>=Math.max(1,beforeWeek-6)&&row.week<beforeWeek&&played(row.stats))
  .sort((a,b)=>a.week-b.week)
 const recent=games.slice(-3),prior=games.slice(0,-3).slice(-3)
 const points=group=>group.map(row=>pointKey?row.stats[pointKey]:projected(row.stats,scoring)).filter(Number.isFinite)
 const recentPoints=points(recent),priorPoints=points(prior)
 const recentAverage=average(recentPoints),priorAverage=average(priorPoints)
 const targets=metric(recent,'rec_tgt'),priorTargets=metric(prior,'rec_tgt')
 const carries=metric(recent,'rush_att'),priorCarries=metric(prior,'rush_att')
 const change=(now,then)=>now.games>=2&&then.games>=2&&now.games===recent.length&&then.games===prior.length?now.value-then.value:null
 const targetChange=change(targets,priorTargets),carryChange=change(carries,priorCarries)
 const gap=recentPoints.length>=2&&Number.isFinite(projection)?recentAverage-projection:null
 const touchdownKeys=['pass_td','rec_td','rush_td'].filter(key=>Number.isFinite(scoring[key])&&scoring[key]!==0)
 const tdKnown=recent.length>0&&touchdownKeys.length>0&&recent.every(row=>touchdownKeys.every(key=>Number.isFinite(row.stats[key])))
 const tdPoints=tdKnown?recent.reduce((sum,row)=>sum+touchdownKeys.reduce((n,key)=>n+row.stats[key]*scoring[key],0),0):null
 const total=recentPoints.reduce((sum,n)=>sum+n,0)
 const tdShare=tdKnown&&recentPoints.length===recent.length&&total>0?tdPoints/total:null
 const flags=[]
 if(gap!==null&&gap>=3)flags.push('Recent scoring above projection')
 if(targetChange!==null&&targetChange>=2)flags.push('Targets rising')
 if(carryChange!==null&&carryChange>=3)flags.push('Carries rising')
 if(targetChange!==null&&targetChange<=-2)flags.push('Targets falling')
 if(carryChange!==null&&carryChange<=-3)flags.push('Carries falling')
 if(tdShare!==null&&tdShare>=.4)flags.push('Touchdown dependent')
 if(recent.length<3||prior.length<2)flags.push('Small sample')
 if(!Number.isFinite(projection))flags.push('Projection unavailable')
 if(['RB','WR','TE'].includes(position)&&(targets.games<recent.length||priorTargets.games<prior.length))flags.push('Target data incomplete')
 if(['RB','QB'].includes(position)&&(carries.games<recent.length||priorCarries.games<prior.length))flags.push('Carry data incomplete')
 return {games:games.length,recentWeeks:recent.map(row=>row.week),priorWeeks:prior.map(row=>row.week),recentAverage,priorAverage,scoredGames:recentPoints.length,targets,priorTargets,carries,priorCarries,targetChange,carryChange,gap,tdShare,flags}
}

// Scan the entire available pool, including players without a usable projection.
export function scoutFreeAgents(data,league,history,{position='WR',excluded=[],sort='recentAverage'}={}){
 const slots=activeSlots(league)
 const key=['recentAverage','targetChange','carryChange','gap'].includes(sort)?sort:'recentAverage'
 return tradeCandidateIds(availableIds(league,data.players),data.players,excluded)
  .filter(id=>data.players[id].position===position&&slots.some(slot=>eligible(data.players[id],slot)))
  .map(id=>{
   const rows=Object.fromEntries(Object.entries(history).map(([week,players])=>[week,players[id]]).filter(([,row])=>row))
   const projection=projected(data.projections[data.week]?.[id]?.stats,league.scoring_settings)
   return {id,projection,...playerSignals({rows,scoring:league.scoring_settings,beforeWeek:data.week,projection,position})}
  }).filter(row=>row.games>0)
  .sort((a,b)=>(b[key]??-Infinity)-(a[key]??-Infinity)||(b.recentAverage??-Infinity)-(a.recentAverage??-Infinity)||a.id.localeCompare(b.id))
}
