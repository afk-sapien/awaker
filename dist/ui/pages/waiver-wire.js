// Waiver wire: pickups for this week, next week or the season, and which players are protected from drops.
import {futureWaiverRows as sharedFutureWaivers,waiverRows as sharedWaivers} from '../../analysis.js';
import * as api from '../../api.js';
import {createMemo,identity,rosterKey} from '../../cache.js';
import {waiverDropReason,SLOT_POSITIONS,activeSlots} from '../../engine.js';
import {rosterOdds} from '../../league.js';
import {waiverWeeks} from '../../waivers.js';
import {S} from '../state.js';
import {empty,esc,fmt,league,leagueOptions,pageHead,playerChip,pname,signed,value} from '../core.js';
import {oddsChange,oddsOutlook,oddsShown,whatIf} from '../odds.js';
import {lockedLineup,waiverResults} from '../outlook.js';
import {ensureLeagueSeason,leagueSeasonKey,projectionStamp} from './league-outlook.js';
import {render} from '../render.js';

export const waiverPositions=['QB','RB','WR','TE','K','DEF'];
export const waiverOutlooks=createMemo(4);
export function protectionKey(l){return `${S.data.demo?'demo':S.data.user.user_id}:${l.league_id}`}
export function protectedPlayers(l){return S.prefs.waiverProtected?.[protectionKey(l)]||[]}
export function waiverProtectionControls(l){
 const {ids,locks}=lockedLineup(l),protectedIds=protectedPlayers(l),roster=[...new Set([...(l.mine.players||[]),...(l.mine.reserve||[]),...(l.mine.taxi||[])])];
 return `<details class="waiver-protection"><summary>Never drop · ${protectedIds.filter(id=>roster.includes(id)).length} protected player(s)</summary><p class="muted small">Check players to keep. Saved separately for each league.</p><div class="protected-roster">${roster.map(id=>{
  const reason=waiverDropReason(id,{players:S.data.players,value:id=>value(id,l),protectedIds,starterIds:S.protectStarters?ids:[],lockedIds:Object.values(locks),excludedDropPositions:S.waiverExcluded.drop});
  return `<label class="list-choice"><span class="checkline"><input type="checkbox" id="protect-${esc(id)}" data-protect-player="${esc(id)}" ${protectedIds.includes(id)?'checked':''}>${esc(pname(id))}</span><span class="muted small">${esc(S.data.players[id]?.position||'')} · ${esc(reason||'Eligible bench player')}</span></label>`;
 }).join('')}</div></details>`;
}
export function weeklyAnalysisKey(l){return [S.data.user.user_id,S.data.nfl?.season,S.data.week,rosterKey(l),identity(S.data.players),identity(S.data.projections[S.data.week]),
 lockedLineup(l),Object.entries(S.data.games).map(([team,g])=>[team,g.state])];}
export function waiverWindow(){return waiverWeeks(S.data.week,S.waiverHorizon,S.data.demo?Math.min(S.waiverEndWeek,6):S.waiverEndWeek)}
export function waiverKey(){return JSON.stringify([S.data.user.user_id,S.data.nfl?.season,waiverWindow()])}
export async function ensureWaiverOutlook(force=false){
 if(S.waiverHorizon==='current')return;
 const key=waiverKey(),weeks=waiverWindow();
 if(S.waiverState?.key===key&&!force&&(S.waiverState.loading||S.waiverState.outlook&&Date.now()-S.waiverState.outlook.loadedAt<3600000))return;
 const cached=waiverOutlooks.peek(key);
 if(!force&&cached&&Date.now()-cached.loadedAt<3600000){S.waiverState={key,outlook:cached};if(S.view==='waivers')render();return}
 const state={key,loading:true,outlook:null,error:null};S.waiverState=state;if(S.view==='waivers')render();
 try{
  if(!weeks.length)throw Error('No future weeks remain in this window.');
  const outlook=S.data.demo?{weeks,data:Object.fromEntries(weeks.map(w=>[w,{projections:S.data.projections[w],games:S.data.schedules[w]}])),loadedAt:Date.now(),errors:[]}:await api.tradeOutlook(S.data.nfl.season,weeks,()=>{},force);
  if(outlook.errors.length)throw Error(`Missing projections or schedules for week(s) ${outlook.errors.join(', ')}. Recommendations are paused.`);
  state.outlook=outlook;waiverOutlooks.set(key,outlook);
 }catch(e){state.error=e.message}finally{state.loading=false;if(S.waiverState===state&&S.view==='waivers')render()}
}
export function waiverRows(){
 const l=league(),future=S.waiverHorizon!=='current',outlook=S.waiverState?.key===waiverKey()?S.waiverState.outlook:null;
 if(future&&!outlook)return [];
 const key=JSON.stringify([...weeklyAnalysisKey(l),S.waiverHorizon,identity(outlook),identity(S.data.trends),S.waiverExcluded,protectedPlayers(l),S.protectStarters,S.samePositionDrops]);
 return waiverResults.get(key,()=>future?futureWaiverRows(l,outlook):computeWaiverRows());
}
export function futureWaiverRows(l,outlook){return sharedFutureWaivers(S.data,l,outlook,{...S.prefs,waiverExcluded:S.waiverExcluded,protectStarters:S.protectStarters,samePositionDrops:S.samePositionDrops,waiverProtected:{[`${S.data.user?.user_id}:${l.league_id}`]:protectedPlayers(l)}})}
export function computeWaiverRows(){try{return sharedWaivers(S.data,league(),{...S.prefs,waiverExcluded:S.waiverExcluded,protectStarters:S.protectStarters,samePositionDrops:S.samePositionDrops})}catch{return []}}
export function waiverFilterPositions(l){
 const slots=activeSlots(l);
 return [...new Set([...waiverPositions,...slots.flatMap(slot=>SLOT_POSITIONS[slot]||[slot])])];
}
export function waiverFilters(l){const positions=waiverFilterPositions(l);
 return `<div class="waiver-position-filters">${[['add','Pick up'],['drop','May drop']].map(([side,label])=>{
 const excluded=S.waiverExcluded[side];
 return `<fieldset class="position-group waiver-position-group"><legend>${label}</legend><div class="waiver-position-options"><div class="position-options">${positions.map(p=>`<label class="position-choice"><input type="checkbox" id="waiver-${side}-${esc(p)}" data-waiver-position="${side}" value="${esc(p)}" ${excluded.includes(p)?'':'checked'}><span>${esc(p)}</span></label>`).join('')}</div></div></fieldset>`;
 }).join('')}</div>`;
}
// What a pickup and its drop do to my playoff odds, rated over the same weeks as the League outlook page.
// The outlook is captured when the question is asked, so an answer is always about the league it is stored under.
export function waiverOddsContext(l){const o=oddsOutlook();return o&&{o,stem:JSON.stringify(['waiver',S.leagueSeasonState.key,rosterKey(l),Object.entries(S.data.projections).map(([w,rows])=>[w,projectionStamp(rows)])])}}
export function waiverOdds(l,r,ctx){
 if(!ctx||!['upgrade','bench'].includes(r.status))return null;
 const {o,stem}=ctx,mine=l.mine.roster_id,found=whatIf(stem+JSON.stringify([r.id,r.drop]),()=>rosterOdds(o,[{rosterId:mine,add:[r.id],remove:r.drop?[r.drop]:[]}]));
 return found&&oddsShown(o,mine,found[mine]);
}
export function waivers(){
 // The odds need the league's season, which this page does not otherwise load. Asked for once, never from a failed state.
 if(!S.data.demo&&league()&&S.leagueSeasonState?.key!==leagueSeasonKey())setTimeout(ensureLeagueSeason,0);
 const l=league(),weeks=waiverWindow(),future=S.waiverHorizon!=='current',state=S.waiverState?.key===waiverKey()?S.waiverState:null;
 const ready=!future||!!state?.outlook,rows=ready?waiverRows().filter(r=>!S.waiverUpgradesOnly||r.status==='upgrade'):[],oddsCtx=ready?waiverOddsContext(l):null;
 const range=weeks.length?(weeks.length===1?`Week ${weeks[0]}`:`Weeks ${weeks[0]}–${weeks.at(-1)}`):'No remaining weeks';
 const summary=[S.waiverExcluded.add.length?`Pickups: no ${S.waiverExcluded.add.join(', ')}`:'Pickups: all',S.waiverExcluded.drop.length?`Drops: no ${S.waiverExcluded.drop.join(', ')}`:'Drops: all',S.waiverUpgradesOnly?'Upgrades only':null].filter(Boolean).join(' · ');
 return pageHead('Waiver wire','Find help now, next week, or for the season ahead.',`<select class="select" aria-label="Analysis league" id="analysis-league">${leagueOptions(l.league_id)}</select>`)+`
 <div class="waiver-toolbar"><label>Plan for <select class="select" id="waiver-horizon"><option value="current" ${S.waiverHorizon==='current'?'selected':''}>This week</option><option value="next" ${S.waiverHorizon==='next'?'selected':''}>Next week</option><option value="season" ${S.waiverHorizon==='season'?'selected':''}>Rest of season</option></select></label><span class="muted small">${range}${S.data.demo?' · Sample data':''}</span><button class="secondary" id="refresh-waiver" ${state?.loading||S.busy?'disabled':''}>Refresh outlook</button></div>
 <details class="panel waiver-controls waiver-settings" id="waiver-settings"><summary>Filters & protections <span>${esc(summary)} · Saved</span></summary><div class="waiver-settings-body">${waiverFilters(l)}<div class="waiver-rules"><label class="checkline"><input type="checkbox" id="waiver-upgrades-only" ${S.waiverUpgradesOnly?'checked':''}>Only show lineup upgrades</label><label class="checkline"><input type="checkbox" id="protect-starters" ${S.protectStarters?'checked':''}>Protect current starters</label><label class="checkline"><input type="checkbox" id="same-position-drops" ${S.samePositionDrops?'checked':''}>Only drop the same position</label><label class="checkline">Season ends <select class="select" id="waiver-end-week">${[17,18].map(w=>`<option value="${w}" ${S.waiverEndWeek===w?'selected':''}>Week ${w}</option>`).join('')}</select></label></div>${waiverProtectionControls(l)}</div></details>
 ${ready&&rows.length?(top=>top?`<div class="panel decision lineup-summary verdict-act"><div><div class="eyebrow">BEST MOVE ${esc(range.toUpperCase())}</div><h2>Add ${esc(pname(top.id))}${top.drop?`, drop ${esc(pname(top.drop))}`:''}</h2><p class="muted small">${esc(S.data.players[top.id]?.position||'')} · ${esc(S.data.players[top.id]?.team||'FA')} · starts for you${rows.filter(r=>r.status==='upgrade').length>1?` · ${rows.filter(r=>r.status==='upgrade').length-1} more upgrade${rows.filter(r=>r.status==='upgrade').length===2?'':'s'} below`:''}</p></div><div><div class="big-number gain">${signed(top.gain)}</div><div class="muted small">${weeks.length>1?'lineup points over the window':'lineup points'}</div></div></div>`:`<div class="panel decision lineup-summary verdict-set"><div><div class="eyebrow">NO PICKUP IMPROVES YOUR LINEUP ${esc(range.toUpperCase())}</div><h2>You are set</h2><p class="muted small">${rows.some(r=>r.status==='bench')?'There are bench upgrades below if you want depth.':'Nothing available would start for you or clearly beat your bench.'}</p></div></div>`)(rows.find(r=>r.status==='upgrade'&&r.gain>0)):''}
 ${!ready?`<div class="empty" role="status"><h3>${state?.error?esc(state.error):'Loading waiver outlook…'}</h3><p>${state?.error?'Use Refresh outlook to retry.':'Loading weekly projections and bye weeks. Saved filters still apply.'}</p></div>`:`<div class="panel table-wrap waiver-table"><table><thead><tr><th>PLAYER</th><th>ADDS / 24H</th><th>${weeks.length>1?'TOTAL PROJ.':'PROJ.'}</th><th>${weeks.length>1?'TOTAL LINEUP GAIN':'LINEUP GAIN'}</th><th>SUGGESTED MOVE</th>${oddsCtx?'<th title="Your playoff odds with this pickup and drop, from the League outlook simulation">PLAYOFF ODDS</th>':''}<th></th></tr></thead><tbody>${rows.map(r=>`<tr class="waiver-${r.status==='upgrade'?'upgrade':r.status==='bench'?'bench':'none'}"><td>${playerChip(r.id,`<div class="muted small">${esc(S.data.players[r.id].team||'FA')} · ${esc(S.data.players[r.id].position)}${S.data.players[r.id].injury_status?' · '+esc(S.data.players[r.id].injury_status):''}</div>`)}</td><td>${r.count?r.count.toLocaleString():'—'}</td><td>${fmt(r.projection)}</td><td class="${r.gain>0?'gain':'muted'}">${r.gain===null?'—':signed(r.gain)}${r.weekly&&weeks.length>1?`<details class="waiver-weekly"><summary>${signed(r.gain/weeks.length)}/wk · ${r.starts} starts</summary>${r.weekly.map(w=>`<div>W${w.week}: ${signed(w.gain)}${w.starts?' · starts':''}</div>`).join('')}</details>`:''}</td><td>${r.status==='upgrade'?(r.drop?`Drop ${esc(pname(r.drop))}`:'Add to open roster spot'):r.status==='bench'?`<span class="pill">BENCH</span> ${r.drop?`Drop ${esc(pname(r.drop))}`:'Add to open roster spot'}<div class="muted small">${r.drop?`Projects ${signed(r.benchGain/weeks.length)}${weeks.length>1?'/wk':''} more than him`:`Projects ${fmt(r.benchGain/weeks.length)}${weeks.length>1?'/wk':''}`} · would not start</div>`:`<span class="muted small">${({unavailable:'Insufficient projections',no_safe_drop:'No eligible drop',no_gain:'No lineup upgrade'})[r.status]}</span>`}</td>${oddsCtx?`<td class="waiver-odds">${(odds=>odds===undefined?'<span class="muted small">Working it out…</span>':odds?oddsChange(odds):'<span class="muted">—</span>')(waiverOdds(l,r,oddsCtx))}</td>`:''}<td><button class="pin ${S.pins.has(r.id)?'on':''}" data-pin="${esc(r.id)}" aria-label="Watch ${esc(pname(r.id))}">${S.pins.has(r.id)?'★':'☆'}</button></td></tr>`).join('')}</tbody></table>${!rows.length?empty(S.waiverUpgradesOnly?'No lineup upgrades match':'No available players match','Adjust Filters & protections to broaden your search.'):''}</div>`}
 <details class="data-details"><summary>How ${range.toLowerCase()} recommendations work</summary><p>${future?'Each week gets its own optimized lineup using that week’s projections and bye schedule. The same pickup and drop are held throughout the selected window. Current game locks do not apply to future lineups.':'Uses this week’s optimized lineup, with started games locked.'} Lineup improvements come first. A BENCH move is a player who would not start but projects at least a point a week above a bench player your lineup never needs. Never-drop, starter and position protections still apply. Missing projections never make a player disposable. Uses available league scoring stats; projected bonuses may be incomplete. Future injuries and role changes are uncertain; estimates do not include keeper or dynasty value.${S.data.demo?' Demo future projections end in week 6.':''}</p><p>${l.settings?.waiver_budget?`${Math.max(0,l.settings.waiver_budget-(l.mine.settings?.waiver_budget_used||0))} of ${l.settings.waiver_budget} waiver budget remaining.`:''} Global adds are from Sleeper. Check waiver timing before making a move.</p></details>`;
}
