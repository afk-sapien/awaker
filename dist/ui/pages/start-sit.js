// Start / sit: the best lineup against the one set, slot by slot.
import {activeSlots,optimize,playableIds} from '../../engine.js';
import {lineupComparisons} from '../../lineup.js';
import {S} from '../state.js';
import {analysisHeader,empty,esc,fmt,league,playerChip,pname,signed,value} from '../core.js';
import {lineupResults,lockedLineup,usableValue} from '../outlook.js';
import {weeklyAnalysisKey} from './waiver-wire.js';

export function lineup(){
 const l=league(),slots=activeSlots(l),{ids,locks}=lockedLineup(l),fixed=Object.values(locks),v=id=>usableValue(id,l,fixed);
 let best;try{best=lineupResults.get(JSON.stringify(weeklyAnalysisKey(l)),()=>optimize(playableIds(l.mine),slots,S.data.players,v,locks,ids))}catch(e){return analysisHeader('Start / sit','Compare your starters and bench, using this league’s scoring.')+empty(e.message)}
 const {starters,baseline,bench:benchPlayers}=lineupComparisons(S.data,l),complete=best.complete&&baseline!==null;
 const unknown=playableIds(l.mine).filter(id=>value(id,l)===null);
 // The page answers one question: should I change anything? Only slots where the answer is yes count as swaps.
 const swaps=slots.map((_,i)=>i).filter(i=>best.ids[i]&&best.ids[i]!==ids[i]&&!(i in locks)),open=slots.length-Object.keys(locks).length;
 const deltaLabel=n=>Number.isFinite(n)?`${signed(n)} pts`:'Unavailable';
 const deltaClass=n=>Number.isFinite(n)?n>0?'gain':n<0?'loss':'muted':'muted';
 const playerLabel=id=>!id||id==='0'?'Empty slot':pname(id);
 const playerInfo=id=>id&&id!=='0'?`<div class="small muted">${esc(S.data.players[id]?.team||'FA')} · ${esc(S.data.players[id]?.position||'Unknown')}${S.data.players[id]?.injury_status?` · ${esc(S.data.players[id].injury_status)}`:''}</div>`:'';
 const optionRow=option=>`<div class="bench-comparison"><span>${esc(option.slot)} · ${esc(playerLabel(option.id))}<span class="muted"> (${fmt(option.projection)} pts)</span></span><strong class="num ${deltaClass(option.delta)}">${deltaLabel(option.delta)}</strong></div>`;
 return analysisHeader('Start / sit','Compare your starters and bench, using this league’s scoring.')+`
 ${unknown.length?`<p class="data-alert">${unknown.length} rostered player(s) have no projection. Review them before following the optimizer.</p>`:''}
 <div class="panel decision lineup-summary verdict-${!complete?'unsure':swaps.length?'act':'set'}"><div><div class="eyebrow">${!complete?'PARTIAL ESTIMATE':swaps.length?'CHANGE YOUR LINEUP':'YOUR LINEUP IS SET'}</div><h2>${!complete?'Some slots have no projection':swaps.length?`${swaps.length} swap${swaps.length===1?'':'s'} worth <span class="gain">${deltaLabel(best.total-baseline)}</span>`:open?'Nothing on your bench projects higher':'Every game has started'}</h2><p class="muted small">${swaps.length?swaps.map(i=>`${esc(starters[i]?.slot||'')}: start ${esc(playerLabel(best.ids[i]))} over ${esc(playerLabel(ids[i]))}`).join(' · '):`${Object.keys(locks).length} of ${slots.length} slots are locked by games that have started.`}</p></div><div class="lineup-totals"><div><div class="big-number">${fmt(baseline)}</div><div class="muted small">current projection</div></div><div><div class="big-number">${best.complete?fmt(best.total):'—'}</div><div class="muted small">optimized projection</div></div></div></div>
 <div class="panel table-wrap"><table class="lineup-table"><thead><tr><th scope="col">SLOT</th><th scope="col">CURRENT STARTER</th><th scope="col">START INSTEAD</th><th scope="col">GAIN</th><th scope="col">DECISION</th></tr></thead><tbody>${starters.map(({slot,index:i,projection,locked:lock})=>{
  const id=best.ids[i],same=id===ids[i],points=id?value(id,l):null,delta=Number.isFinite(points)&&Number.isFinite(projection)?points-projection:null;
  const swap=!same&&!lock&&id;
  return `<tr class="${swap?'lineup-swap':lock?'lineup-locked':''}"><td><strong>${esc(slot)}</strong></td><td>${playerChip(ids[i],`${playerInfo(ids[i])}<div class="num small">${fmt(projection)} projected pts</div>`,'span')}</td><td>${swap?playerChip(id,`${playerInfo(id)}<div class="num small">${fmt(points)} projected pts</div>`):`<span class="muted small">${lock?'Game started':id?'No better option':'No projection'}</span>`}</td><td class="num ${swap?deltaClass(delta):'muted'}">${swap?deltaLabel(delta):'—'}</td><td><span class="pill ${swap?'live':lock?'locked':''}">${lock?'LOCKED':same?'KEEP':id?'SWAP IN':'NO PROJECTION'}</span></td></tr>`;
 }).join('')}</tbody></table></div>
 <div class="section-bar"><h2>Your bench <span class="count">${benchPlayers.length}</span></h2></div>
 <p class="muted small">Each difference is bench projection minus current starter projection. Positive means more expected points. Swaps are alternatives; don’t add their gains together.</p>
 <div class="lineup-bench">${benchPlayers.map(({id,projection,reason,options})=>`<article class="panel bench-player"><div class="bench-player-head">${playerChip(id,playerInfo(id),'h3')}<div class="bench-projection num"><strong>${fmt(projection)}</strong><span class="muted small">projected pts</span></div></div>${best.ids.includes(id)?'<p class="gain small">Recommended to start</p>':''}${reason?`<p class="muted small">${esc(reason)}</p>`:`<div class="small muted">Best direct swap · compared with</div>${optionRow(options[0])}${options.length>1?`<details class="bench-alternatives"><summary>Compare ${options.length-1} other eligible slot${options.length>2?'s':''}</summary>${options.slice(1).map(optionRow).join('')}</details>`:''}`}</article>`).join('')||'<p class="muted small">No bench players on this roster.</p>'}</div>
 <p class="muted small">Pregame estimates, not a live score forecast or betting spread. Bench comparisons replace one starter; the optimized lineup can also move players between flex slots. IR and taxi players are excluded. Make lineup changes in Sleeper.</p>${!S.data.demo?`<a class="secondary" href="https://sleeper.com/leagues/${esc(l.league_id)}/team" target="_blank" rel="noopener">Open league in Sleeper ↗</a>`:''}`;
}
