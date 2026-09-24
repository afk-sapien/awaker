// Auto trades and the trade builder.
import {shopPlayer,acquirePlayer,findTradeIdeas} from '../../analysis.js';
import {identity} from '../../cache.js';
import {playableIds,tradeCandidateIds} from '../../engine.js';
import {teamName} from '../../league.js';
import {tradeGains,realismReasons,tradeScore,compareTradeIdeas} from '../../trades.js';
import {S} from '../state.js';
import {$,empty,esc,fmt,league,leagueOptions,ordinal,pageHead,playerChip,pname,signed,toast} from '../core.js';
import {oddsOutlook,tradeOddsFor,tradeOddsRow} from '../odds.js';
import {seasonKey,seasonModel,tradeResults,tradeWeeks} from '../outlook.js';
import {currentLeagueOutlook} from './league-outlook.js';
import {protectedPlayers} from './waiver-wire.js';
import {render} from '../render.js';

// Shopping one player: who would take him, and what comes back.
// One question drives the page: what are you looking for, and who is it about. 'shop' sends one of
// mine out, 'get' brings one of theirs in, 'position' filters the general search, 'any' is the search.
export const ASKS={any:'any trade',shop:'a deal for one of my players',get:'a way to get someone',position:'a way to get a position'};
export const tradeCandidates=(roster,side)=>tradeCandidateIds(playableIds(roster),S.data.players,S.tradeExcluded[side]);
export function tradeFilters(l){
 const positions=[...new Set(['QB','RB','WR','TE','K','DEF',...l.rosters.flatMap(r=>playableIds(r).flatMap(id=>[S.data.players[id]?.position,...(S.data.players[id]?.fantasy_positions||[])]).filter(Boolean))])];
 return `<div class="trade-position-filters"><p class="muted small">Positions apply to auto trades and the builder.</p>${[['give','You send'],['get','You receive']].map(([side,label])=>`<fieldset class="position-group"><legend>${label}</legend><div class="position-options">${positions.map(position=>`<label class="position-choice"><input id="trade-${side}-${esc(position)}" type="checkbox" data-trade-position="${side}" value="${esc(position)}" ${S.tradeExcluded[side].includes(position)?'':'checked'}><span>${esc(position)}</span></label>`).join('')}</div></fieldset>`).join('')}</div>`;
}
export function partners(l){return l.rosters.filter(r=>r.roster_id!==l.mine.roster_id)}
export function partnerName(l,r){return teamName(l,r.roster_id).team}
export function tradeInput(l){const partner=partners(l).find(r=>String(r.roster_id)===S.partnerId)||partners(l)[0];if(partner)S.partnerId=String(partner.roster_id);return partner;}
export function tradeEval(l,p,giveIds,getIds){const model=seasonModel(l);if(!model)throw Error('Load the season outlook before analyzing a trade.');return model.assessWaivers(model.evaluate(l.mine,p,giveIds,getIds,{autoDrop:true,protectedA:protectedPlayers(l)}),l.mine,p,{protectedA:protectedPlayers(l)})}
export function tradeSearchStatus(search){
 if(!search)return '';
 const d=search.diagnostics;
 return `<details class="data-details trade-search-status"><summary>${search.ideas.length} offers · Search details${search.truncated?' · search limit reached':''}</summary><p>${search.checked} offers checked${d.packages?`, ${d.packages} of them two-for-one packages picked from ${d.packageCandidates} candidates`:''}. ${d.offeredPlayers} eligible players to send across ${d.partners} partners. ${d.incomplete} lacked a complete projection. ${d.noMutualBenefit} did not improve both teams by more than 0.25 season points. ${d.waiverRejected||0} were matched or beaten by a pickup. ${d.belowMinimum} fell below your weekly minimum after pickups; ${d.valueFiltered} exceeded your value limit (these counts can overlap).</p>${search.nearMisses?.length?`<h3>Excluded offers</h3>${search.nearMisses.map(r=>`<p><strong>${esc(r.give.map(pname).join(' + '))} → ${esc(r.get.map(pname).join(' + '))}</strong> · ${esc(r.partner)}<br>You ${signed(r.gainA/r.weeks)}/week · Them ${signed(r.gainB/r.weeks)}/week<br>${r.filterReasons.map(esc).join(' · ')}${[r.waiverA,r.waiverB].some(w=>w?.add)?`<br>Pickup alternatives: ${[r.waiverA,r.waiverB].map((w,i)=>w?.add?`${i===0?'You':'Them'}: ${esc(pname(w.add))} (${signed(w.gain)} season points${w.drop?`, drop ${esc(pname(w.drop))}`:''})`:'').filter(Boolean).join(' · ')}`:''}</p>`).join('')}`:''}</details>`;
}
export function tradeFitExplanation(r){
 if(r.give.length!==1||r.get.length!==1||r.weekly.some(w=>w.outgoingStarts===undefined))return '';
 const count=key=>r.weekly.filter(w=>w[key]).length;
 return `<h4>Projected starts</h4><div class="table-wrap"><table><thead><tr><th scope="col">Roster</th><th scope="col">Outgoing player</th><th scope="col">Incoming player</th></tr></thead><tbody><tr><th scope="row">Yours</th><td>${count('outgoingStarts')} / ${r.weeks}</td><td>${count('incomingStarts')} / ${r.weeks}</td></tr><tr><th scope="row">Theirs</th><td>${count('partnerOutgoingStarts')} / ${r.weeks}</td><td>${count('partnerStarts')} / ${r.weeks}</td></tr></tbody></table></div>`;
}
export function tradeWaiverDetails(r){
 if(!r.waiverA||!r.waiverB)return '';
 const sides=[r.waiverA,r.waiverB],gains=tradeGains(r);
 return `<h4>Free-agent alternatives</h4><div class="table-wrap"><table><thead><tr><th scope="col">Without trading</th><th scope="col">You</th><th scope="col">Them</th></tr></thead><tbody><tr><th scope="row">Pick up</th>${sides.map(w=>`<td>${w.add?esc(pname(w.add)):w.status==='unknown'?'Unknown':'None found'}</td>`).join('')}</tr><tr><th scope="row">Drop</th>${sides.map(w=>`<td>${w.drop?esc(pname(w.drop)):w.add?'Open spot':'—'}</td>`).join('')}</tr><tr><th scope="row">Pickup gain</th>${sides.map(w=>`<td>${w.status==='unknown'?'Unknown':signed(w.gain)}</td>`).join('')}</tr><tr><th scope="row">Trade advantage</th><td>${r.waiverA.status==='unknown'?'Unknown':signed(gains.a)}</td><td>${r.waiverB.status==='unknown'?'Unknown':signed(gains.b)}</td></tr></tbody></table></div><p>Season points. Each alternative keeps the outgoing trade player and uses one fixed pickup and bench drop. Current starters and your protected players are kept.</p><p>Checks the top five projected free agents per incoming position plus weekly leaders, with complete forecasts. Waiver priority, claim costs, and future availability are not modeled.${sides.some(w=>w.missing)?' Players with incomplete forecasts are excluded.':''}${sides.some(w=>w.status==='unknown')?' Missing waiver forecasts leave that team’s ranking unadjusted.':''}</p>`;
}
export function tradeSummary(r,shopping=false,place=null){
 // Shopping a player looks past your usual minimums on purpose, so those limits are not flagged.
 const reasons=shopping?[]:realismReasons(r,{minGain:S.tradeMinGain,maxGap:S.tradeMaxGap});
 const flags=[...([r.waiverA,r.waiverB].some(w=>w?.status==='unknown')?['Limited waiver data']:[]),...([r.waiverA,r.waiverB].some(w=>w?.gain>0)?['Pickup alternative']:[]),...(r.valueGap>.4?['Large value gap']:[]),...(Math.abs(r.gainB)<.01?['Neutral for partner']:Math.min(r.gainA,r.gainB)>=0&&Math.min(r.gainA,r.gainB)/r.weeks<1?['Small weekly gain']:[]),...(reasons.length?['Outside your limits']:[])];
 const players=ids=>ids.map(id=>playerChip(id,`<span class="muted">${esc([S.data.players[id]?.position,S.data.players[id]?.team].filter(Boolean).join(' · '))}</span>`,'h3')).join('');
 const key=JSON.stringify([r.partnerId||r.partner,r.give,r.get]);
 return `<article class="panel trade-offer" tabindex="-1" aria-label="${esc(r.give.map(pname).join(' + '))} for ${esc(r.get.map(pname).join(' + '))}"><header class="trade-offer-header"><strong>${place?`<span class="trade-place">#${place}</span> `:''}${esc(r.partner||'Selected partner')}</strong><span>Weeks ${r.weekly[0].week}–${r.weekly.at(-1).week}</span></header><div class="trade-exchange"><div><span class="trade-label">You send</span>${players(r.give)}</div><span class="trade-arrow" aria-hidden="true">⇄</span><div><span class="trade-label">You receive</span>${players(r.get)}</div></div>${r.dropA?.length||r.dropB?.length?`<p class="trade-drops">${[r.dropA?.length?`You would drop ${esc(r.dropA.map(pname).join(' and '))} to make room.`:'',r.dropB?.length?`They would need to drop someone, likely ${esc(r.dropB.map(pname).join(' and '))}.`:''].filter(Boolean).join(' ')}</p>`:''}<div class="trade-points-label">Projected season gain</div><dl class="trade-metrics">${[['You',r.gainA],['Them',r.gainB],['Combined',r.gainA+r.gainB]].map(([label,value])=>`<div><dt>${label}</dt><dd class="${value>0?'gain':value<0?'loss':''}">${signed(value)}</dd></div>`).join('')}</dl>${tradeOddsRow(r)}${flags.length?`<div class="trade-flags">${flags.map(f=>`<span>${f}</span>`).join('')}</div>`:''}<details class="trade-breakdown" data-trade-detail="${esc(key)}"><summary>Trade details</summary><div class="trade-detail-body"><dl class="trade-detail-metrics"><div><dt>Ranking score</dt><dd>${fmt(tradeScore(r,S.penalty))}</dd></div><div><dt>Value gap</dt><dd>${r.valueGap===null?'Unavailable':fmt(r.valueGap*100)+'%'}</dd></div></dl><p>Score = your advantage over pickups + ${Math.round((1-S.penalty)*100)}% of theirs.</p>${tradeWaiverDetails(r)}${reasons.length?`<p class="attention">${reasons.map(esc).join(' · ')}</p>`:''}${flags.includes('Small weekly gain')?'<p>At least one team gains less than 1 point per week.</p>':''}${flags.includes('Neutral for partner')?'<p>Their projected lineup does not improve.</p>':''}${tradeFitExplanation(r)}<h4>Weekly gain</h4><div class="table-wrap"><table><thead><tr><th scope="col">Week</th><th scope="col">You</th><th scope="col">Them</th><th scope="col">Combined</th></tr></thead><tbody>${r.weekly.map(w=>`<tr><th scope="row">${w.week}</th><td>${signed(w.gainA)}</td><td>${signed(w.gainB)}</td><td>${signed(w.gainA+w.gainB)}</td></tr>`).join('')}</tbody><tfoot><tr><th scope="row">Average</th><td>${signed(r.gainA/r.weeks)}</td><td>${signed(r.gainB/r.weeks)}</td><td>${signed((r.gainA+r.gainB)/r.weeks)}</td></tr></tfoot></table></div><h4>Player value</h4><dl class="trade-detail-metrics"><div><dt>You send</dt><dd>${fmt(r.offeredValue)}</dd></div><div><dt>You receive</dt><dd>${fmt(r.receivedValue)}</dd></div></dl><p>Projected points above available replacements. This is not a market price or acceptance estimate.</p></div></details></article>`;
}
export const rivalHolds=(l,id)=>l.rosters.some(r=>r.roster_id!==l.mine.roster_id&&[...(r.players||[]),...(r.reserve||[]),...(r.taxi||[])].includes(id));
// Shopping one player and going after one player are the same page with the arrow reversed, so the
// waiting and the staleness are handled once and only the answer differs.
export function askView(l,model){
 if(!model)return empty('Load the season outlook first','Weighing one player takes every week that is left.');
 const going=S.tradeAsk==='get';
 const r=S.shopResult?.playerId===S.shopId&&S.shopResult.model===model&&S.shopResult.mode===S.tradeAsk?S.shopResult:null;
 const weeks=model.weeks.length||1;
 if(!r){
  // The answer belongs to one season model. A new league, week window, roster or outlook makes a new
  // model, so the search starts again instead of waiting on an answer that will never match.
  if(!(going?rivalHolds(l,S.shopId):playableIds(l.mine).includes(S.shopId))){setTimeout(()=>askFor('any',''),0);return ''}
  if(S.shopSearching!==model)setTimeout(()=>{if(S.shopId&&S.shopSearching!==seasonModel(league()))askFor(S.tradeAsk,S.shopId)},0);
  return `<div class="empty" role="status"><h3>${going?`Working out what ${esc(pname(S.shopId))} would cost…`:`Asking around about ${esc(pname(S.shopId))}…`}</h3><p>${going?'Comparing everyone you could send for him.':'Checking what every other team could send back.'}</p><button class="secondary" id="shop-clear">Back to all trades</button></div>`;
 }
 return (going?getSummary:shopSummary)(l,r,weeks);
}
export function askHead(r,extra){
 return `<div class="shop-head">${playerChip(r.playerId,`<span class="muted">${esc([S.data.players[r.playerId]?.position,S.data.players[r.playerId]?.team].filter(Boolean).join(' · '))}</span>`,'h3')}<dl class="trade-detail-metrics">${extra}</dl></div>`;
}
export function shopSummary(l,r,weeks){
 const takers=r.market.filter(m=>m.interest>.25),value=Number.isFinite(r.value)?r.value/weeks:null;
 const verdict=!takers.length?'Nobody’s lineup improves with him, so there is no real market. If you are done with him, the waiver wire is the better exit.':value!==null&&value<.5?'A few teams could use him, but he is about as good as a free agent, so expect depth in return, not a starter.':`${takers.length} ${takers.length===1?'team':'teams'} would start him. That is your leverage: ask the ones he helps most.`;
 return `<div class="panel shop-summary">${askHead(r,`<div><dt>Projected</dt><dd>${fmt(Number.isFinite(r.total)?r.total/weeks:null)} / wk</dd></div><div><dt>Above a free agent</dt><dd>${value===null?'Unknown':fmt(value)+' / wk'}</dd></div><div><dt>Teams he helps</dt><dd>${takers.length} of ${r.market.length}</dd></div>`)}<p>${verdict}</p>${takers.length?`<div class="table-wrap"><table><thead><tr><th scope="col">Team</th><th scope="col">He adds to their lineup</th><th scope="col">Offers that work</th></tr></thead><tbody>${takers.slice(0,6).map(m=>`<tr><th scope="row">${esc(m.partner)}</th><td class="gain">${signed(m.interest/weeks)} / wk</td><td>${m.offers}</td></tr>`).join('')}</tbody></table></div>`:''}<button class="secondary" id="shop-clear">Back to all trades</button></div>${r.offers.length?`<p class="trade-results-label">Best ${r.offers.length} ${r.offers.length===1?'return':'returns'} for ${esc(pname(r.playerId))} · the other team gains in every one · a negative number for you is the price of moving him</p>`+r.offers.map(o=>tradeSummary(o,true)).join(''):takers.length?empty('No single player works as a return','Try a package in the Trade builder.'):''}`;
}
// Going after him: the owner has to gain or there is no conversation, and what he adds to my lineup
// is a separate question from whether anyone on my roster is worth his while.
export function getSummary(l,r,weeks){
 const lift=Number.isFinite(r.lift)?r.lift/weeks:null,value=Number.isFinite(r.value)?r.value/weeks:null;
 // Offers are ranked by what is left for me, so the first one is the cheapest there is. If even that
 // one loses me points, saying "3 ways to get him" without saying so would be the good news it isn't.
 const price=r.offers.length?tradeGains(r.offers[0]).a/weeks:null;
 const verdict=r.best===null?`Nothing on your roster can be compared with him, so there is no read on the price.`
  :r.best<=.25?`Nobody you could send improves ${esc(r.owner)}’s lineup, so a one-for-one will not tempt them. A package in the Trade builder, or a player they are thin at, is the way in.`
  :!r.offers.length?`${esc(r.owner)} would listen, but nothing single works for both of you once pickups are counted.`
  :price!==null&&price<0?`${esc(r.owner)} would listen, but every way to get him costs you more than he adds: the cheapest is still ${signed(price)} / wk for you. He comes cheaper inside a bigger package, or not at all.`
  :lift!==null&&lift<.5?`${esc(r.owner)} would listen, though he barely improves your lineup — check the returns below are worth the player going the other way.`
  :`${esc(r.owner)} would listen. The offers below all leave them better off, which is why they would answer; the cheapest one is the place to start.`;
 return `<div class="panel shop-summary">${askHead(r,`<div><dt>Projected</dt><dd>${fmt(Number.isFinite(r.total)?r.total/weeks:null)} / wk</dd></div><div><dt>Adds to your lineup</dt><dd>${lift===null?'Unknown':signed(lift)+' / wk'}</dd></div><div><dt>Owned by</dt><dd class="tile-text">${esc(r.owner)}</dd></div>`)}<p>${verdict}</p><button class="secondary" id="shop-clear">Back to all trades</button></div>${r.offers.length?`<p class="trade-results-label">${r.offers.length} ${r.offers.length===1?'way':'ways'} to get ${esc(pname(r.playerId))} · ${esc(r.owner)} gains in every one · ${price!==null&&price<0?'all of them cost you points, cheapest first':'ranked by what is left for you'}</p>`+r.offers.map(o=>tradeSummary(o,true)).join(''):''}`;
}
// mode 'position' only filters the general search, so it never runs a search of its own.
export async function askFor(mode,id){
 S.tradeAsk=ASKS[mode]?mode:'any';S.shopId='';S.shopResult=null;S.shopSearching=null;S.tradeTarget=null;const run=++S.shopRun;
 if(S.tradeAsk==='position'){S.tradeTarget=id||null;S.tradeVisible=5;render();if(id&&seasonModel(league()))suggestTrades();return}
 if(S.tradeAsk==='any'||!id){render();return}
 S.shopId=id;
 const l=league(),model=seasonModel(l);S.shopSearching=model;render();if(!model)return;
 await new Promise(r=>setTimeout(r,20));
 try{const search=S.tradeAsk==='get'?acquirePlayer:shopPlayer;
  const result=await search(S.data,l,model,id,{tradeExcluded:S.tradeExcluded,waiverProtected:S.prefs.waiverProtected},{cancelled:()=>run!==S.shopRun||league()?.league_id!==l.league_id});
  if(result.cancelled||run!==S.shopRun)return;S.shopResult={...result,mode:S.tradeAsk,model};render();
 }catch(e){toast(e.message);S.shopId='';S.tradeAsk='any';render()}
}
// The bias toward your gain decides which packages make the shortlist, so it belongs in the key.
export function tradeResultKey(l,model){return JSON.stringify([identity(model),S.penalty,S.tradeExcluded,S.tradeMinGain,S.tradeMaxGap,protectedPlayers(l),partners(l).map(p=>[p.roster_id,partnerName(l,p)])])}
export const atPosition=(id,position)=>(S.data.players[id]?.fantasy_positions||[S.data.players[id]?.position]).includes(position);
export const targeted=ideas=>ideas&&S.tradeTarget?ideas.filter(r=>r.get.some(id=>atPosition(id,S.tradeTarget))):ideas;
// How the list is ordered. The numbers sorted on are the ones printed on each card.
export const TRADE_SORTS={score:['Best for both','your gain over pickups plus most of theirs'],mine:['Most points for me','your projected season gain'],theirs:['Most points for them','their projected season gain, the offers most likely to be accepted'],combined:['Most combined points','both teams’ projected season gain'],odds:['Biggest lift to my playoff odds','the change in your playoff odds']};
// Asking for every offer's odds queues them; the list keeps its usual order until they are all in.
// Each answer is a simulation, so only the best offers by the usual ranking (at least those on screen) are asked about.
export const ODDS_POOL=20,oddsPool=ideas=>[...(targeted(ideas)||[])].sort((a,b)=>compareTradeIdeas(a,b,S.penalty)).slice(0,Math.max(S.tradeVisible,ODDS_POOL));
export const oddsPending=ideas=>S.tradeSort==='odds'&&oddsPool(ideas).map(r=>tradeOddsFor(r)).includes(undefined);
export const oddsLift=r=>tradeOddsFor(r)?.mine.change??-Infinity;
export function rankTrades(ideas){
 if(!ideas)return null;
 const order=(list,sort)=>{const by={mine:r=>r.gainA,theirs:r=>r.gainB,combined:r=>r.gainA+r.gainB,odds:oddsLift}[sort];return [...list].sort((a,b)=>(by?by(b)-by(a):0)||compareTradeIdeas(a,b,S.penalty))};
 if(S.tradeSort!=='odds')return order(targeted(ideas),S.tradeSort).slice(0,S.tradeVisible);
 const ranked=order(targeted(ideas),'score'),pool=oddsPool(ideas);
 return (oddsPending(ideas)?ranked:[...order(pool,'odds'),...ranked.slice(pool.length)]).slice(0,S.tradeVisible);
}
export function tradeTargetBanner(l){
 if(!S.tradeTarget)return '';
 let o=null;try{o=currentLeagueOutlook()}catch{}
 const chart=o?.depth.roster||o?.depth.season,clear='<button class="inline-btn" data-depth-clear>Show every trade</button>',off=S.tradeExcluded.get.includes(S.tradeTarget)?` ${esc(S.tradeTarget)} is switched off under Filters & ranking, so nothing will come back until it is on.`:'';
 if(!chart)return `<div class="note trade-target" role="status"><strong>Looking for a ${esc(S.tradeTarget)}.</strong>${off} ${clear}</div>`;
 const name=id=>o.rows.find(r=>r.rosterId===id)?.team,short=c=>`${pname(c.id)} ${fmt(c.points)}`,mine=l.mine.roster_id,columns=chart.columns.map((c,i)=>({...c,i})),spots=columns.filter(c=>c.position===S.tradeTarget);
 // An upgrade is anyone better than the last player I have to start there.
 const last=spots.at(-1),weakest=last?chart.cells[mine][last.i]:null,bar=weakest?.points??0;
 const spares=l.rosters.filter(r=>r.roster_id!==mine).map(r=>({id:r.roster_id,cell:chart.spare[r.roster_id]?.[S.tradeTarget]})).filter(x=>x.cell&&x.cell.points>bar).sort((a,b)=>b.cell.points-a.cell.points).slice(0,4);
 const offer=columns.map(c=>({c,cell:chart.cells[mine][c.i]})).filter(x=>x.cell&&x.c.position!==S.tradeTarget&&x.cell.rank/x.cell.of<=.34).sort((a,b)=>a.cell.rank/a.cell.of-b.cell.rank/b.cell.of).slice(0,3);
 return `<div class="note trade-target" role="status"><p><strong>Looking for a ${esc(S.tradeTarget)}.</strong> ${weakest?`Your ${spots.length>1?esc(last.label):'starter'} is ${esc(short(weakest))} a game, ${ordinal(weakest.rank)} of ${weakest.of}.`:`You have nobody to start at ${esc(last?.label||S.tradeTarget)}.`}${off}</p><p>${spares.length?`Sitting on someone better than that: ${spares.map(x=>`${esc(name(x.id))} (${esc(short(x.cell))})`).join(', ')}.`:'No team has a spare one better than yours, so it would cost a starter.'} ${offer.length?`You have the most to offer at ${offer.map(x=>`${esc(x.c.label)} (${ordinal(x.cell.rank)})`).join(', ')}.`:''}</p>${clear}</div>`;
}
export function tradePageHeader(title,description,l,model,weeks,state){
 const status=state?.loading?'Loading projections…':state?.error?esc(state.error):model?`Weeks ${weeks[0]}–${weeks.at(-1)}`:'Projections not loaded';
 return pageHead(title,description,`<select class="select" aria-label="Analysis league" id="analysis-league">${leagueOptions(l.league_id)}</select>`)+`<div class="season-status trade-season-status"><details class="data-details"><summary><span id="season-load-status">${status}</span> · Projection details</summary><p>Trades start next week. Lineups use each week's Sleeper projections, league scoring, and bye weeks. Missing weeks pause analysis. Injuries and role changes remain uncertain; scoring bonuses may be incomplete.</p><p>This season only: no dynasty value or draft picks. Ranking compares the trade with a no-trade pickup for each team. Player values are projection estimates, not market prices.${S.data.demo?' Demo uses sample weeks 3–4.':''}</p></details><button class="secondary" id="load-trade-season" ${state?.loading?'disabled':''}>${state?.loading?'Loading…':model?'Refresh outlook':'Load outlook'}</button></div>${l.settings?.type===2?'<p class="data-alert">Dynasty league · This season only</p>':''}`;
}
// One row that reads as a sentence: what you are looking for, who it is about, and the button.
export function tradeAskRow(l,model){
 const off=!model?'disabled':'';
 // shop and get run the moment a player is chosen, so the button repeats that search rather than
 // kicking off the general one, whose results this view would only hide.
 const needs=S.tradeAsk==='shop'||S.tradeAsk==='get',chosen=!!S.shopId;
 const byName=(a,b)=>pname(a).localeCompare(pname(b));
 const option=(id,extra='')=>`<option value="${esc(id)}" ${id===S.shopId?'selected':''}>${esc(pname(id))}${extra}</option>`;
 let subject='';
 if(S.tradeAsk==='shop')subject=`<select class="select" id="trade-subject" ${off}><option value="">Choose one of your players…</option>${playableIds(l.mine).filter(id=>S.data.players[id]).sort(byName).map(id=>option(id,` · ${esc(S.data.players[id].position||'')}`)).join('')}</select>`;
 if(S.tradeAsk==='get'){
  // Grouped by team, because wanting a player usually starts with knowing who has him.
  const rivals=l.rosters.filter(r=>r.roster_id!==l.mine.roster_id);
  subject=`<select class="select" id="trade-subject" ${off}><option value="">Choose a player to go after…</option>${rivals.map(r=>{
   const ids=playableIds(r).filter(id=>S.data.players[id]).sort(byName);
   return ids.length?`<optgroup label="${esc(teamName(l,r.roster_id).team)}">${ids.map(id=>option(id,` · ${esc(S.data.players[id].position||'')}`)).join('')}</optgroup>`:'';
  }).join('')}</select>`;
 }
 if(S.tradeAsk==='position')subject=`<select class="select" id="trade-subject" ${off}><option value="">Choose a position…</option>${['QB','RB','WR','TE','K','DEF'].map(p=>`<option value="${p}" ${p===S.tradeTarget?'selected':''}>${p}</option>`).join('')}</select>`;
 return `<div class="panel trade-ask"><div class="trade-ask-row"><label>Looking for <select class="select" id="trade-ask" ${off}>${Object.entries(ASKS).map(([k,v])=>`<option value="${k}" ${S.tradeAsk===k?'selected':''}>${v}</option>`).join('')}</select></label>${subject}<button class="primary" id="suggest-trades" ${off||(needs&&!chosen)?'disabled':''}>${needs?'Search again →':'Find trades →'}</button></div><details id="trade-settings" class="trade-settings"><summary>Search settings</summary><div class="trade-settings-body">${tradeFilters(l)}<div class="trade-realism"><label>Minimum gain over pickups <select class="select" id="trade-min-gain">${[0,.5,1,2,3,5,10].map(n=>`<option value="${n}" ${n===S.tradeMinGain?'selected':''}>${n} points / week</option>`).join('')}</select></label><label>Player-value balance <select class="select" id="trade-max-gap">${[[1,'No limit'],[.15,'15% · strict'],[.25,'25% · balanced'],[.4,'40% · flexible']].map(([n,label])=>`<option value="${n}" ${n===S.tradeMaxGap?'selected':''}>${label}</option>`).join('')}</select></label><label>Season ends <select class="select" id="trade-end-week">${[17,18].map(n=>`<option value="${n}" ${n===S.tradeEndWeek?'selected':''}>Week ${n}</option>`).join('')}</select></label></div><div class="trade-controls"><label for="penalty">Bias toward your gain <strong id="penalty-label">${Math.round(S.penalty*100)}%</strong></label><input id="penalty" type="range" min="0" max="100" step="5" value="${S.penalty*100}"></div><p class="muted small">0% favors combined gain. 100% favors your gain. Both teams must beat their pickup alternatives.</p><button class="secondary" id="trade-fit-defaults">Reset trade settings</button><p class="muted small trade-save-note">Settings save automatically.</p></div></details></div>`;
}
export function trades(){
 const l=league(),model=seasonModel(l),weeks=tradeWeeks(),state=S.seasonState?.key===seasonKey()?S.seasonState:null;
 const search=model?tradeResults.peek(tradeResultKey(l,model)):null;
 const listKey=search?JSON.stringify([tradeResultKey(l,model),S.penalty]):null;
 if(listKey!==S.tradeListKey){S.tradeListKey=listKey;S.tradeVisible=5}
 S.tradeSuggestions=rankTrades(search?.ideas);
 return tradePageHeader('Auto trades','More points for both teams.',l,model,weeks,state)+`${tradeAskRow(l,model)}${S.shopId?'':tradeTargetBanner(l)}${S.shopId?askView(l,model):tradeSearchStatus(search)}${S.shopId||S.tradeSuggestions===null?'':S.tradeSuggestions.length?`<div class="trade-sort"><p class="trade-results-label">${oddsPending(search.ideas)?'<span id="trade-odds-progress" role="status">Working out playoff odds…</span>':`Showing the top ${S.tradeSuggestions.length} of ${targeted(search.ideas).length} offers${S.tradeTarget?` that bring back a ${esc(S.tradeTarget)}`:''}, ranked by ${TRADE_SORTS[S.tradeSort][1]}${S.tradeSort==='odds'&&targeted(search.ideas).length>oddsPool(search.ideas).length?` among the ${oddsPool(search.ideas).length} best overall`:''}.`}</p><label>Sort by <select class="select" id="trade-sort">${Object.entries(TRADE_SORTS).filter(([id])=>id!=='odds'||oddsOutlook()).map(([id,[label]])=>`<option value="${id}" ${S.tradeSort===id?'selected':''}>${label}</option>`).join('')}</select></label></div>`+S.tradeSuggestions.map((r,i)=>tradeSummary(r,false,i+1)).join('')+`<div class="trade-pagination">${S.tradeSuggestions.length<targeted(search.ideas).length?`<button class="secondary" id="more-trades">Show ${Math.min(5,targeted(search.ideas).length-S.tradeSuggestions.length)} more ${targeted(search.ideas).length-S.tradeSuggestions.length===1?'offer':'offers'}</button>`:'<span>All offers shown</span>'}</div>`:S.tradeTarget&&search.ideas.length?empty(`No offers bring back a ${S.tradeTarget}`,'Nothing that helps both teams returns one. Show every trade to see what else is on the table.'):search.diagnostics.waiverRejected>0&&search.diagnostics.waiverRejected===search.diagnostics.mutual?empty('Pickups beat these trades','Open Search details to see the available alternatives.'):empty('No offers match these settings','Broaden your filters or review search details.')}`;
}
export function tradeBuilder(){
 const l=league(),p=tradeInput(l),model=seasonModel(l),weeks=tradeWeeks(),state=S.seasonState?.key===seasonKey()?S.seasonState:null;
 if(S.tradeManual&&S.tradeManual.model!==model)S.tradeManual=null;
 return tradePageHeader('Trade builder','Choose a package and compare its remaining-season impact.',l,model,weeks,state)+`<details class="data-details" id="builder-filters"><summary>Player filters & season window</summary>${tradeFilters(l)}<label class="checkline">Season ends <select class="select" id="trade-end-week">${[17,18].map(n=>`<option value="${n}" ${n===S.tradeEndWeek?'selected':''}>Week ${n}</option>`).join('')}</select></label></details><div class="section-bar"><h2>Choose your trading partner</h2><select class="select" id="trade-partner" aria-label="Trade partner">${partners(l).map(r=>`<option value="${r.roster_id}" ${String(r.roster_id)===S.partnerId?'selected':''}>${esc(partnerName(l,r))}</option>`).join('')}</select></div><p class="muted small">Player totals cover weeks ${weeks[0]||'—'}–${weeks.at(-1)||'—'}. Uneven packages are fine: the team left over its limit drops its least useful player.</p>${p?`<div class="split">${[[l.mine,'You send',S.give,'give'],[p,'You receive',S.get,'get']].map(([r,title,selected,type])=>`<div class="panel"><h3>${title}</h3><div class="trade-picks">${tradeCandidates(r,type).map(id=>`<label class="list-choice"><span class="checkline"><input type="checkbox" data-trade="${type}" value="${esc(id)}" ${selected.includes(id)?'checked':''}>${playerChip(id,'','span')}</span><span class="muted small">${esc(S.data.players[id]?.position)} · ${fmt(model?.totals[id])}</span></label>`).join('')||'<p class="muted small">No players match these position filters.</p>'}</div></div>`).join('')}</div><button class="primary" id="analyze-trade" ${!model?'disabled':''}>Analyze season impact</button>${S.tradeManual?`<div style="margin-top:20px">${tradeSummary(S.tradeManual)}</div>`:''}`:empty('No trading partners found')}`;
}
export async function suggestTrades(){
 const l=league(),model=seasonModel(l);if(!model){toast('Load the season outlook first.');return}
 const resultKey=tradeResultKey(l,model),cached=tradeResults.peek(resultKey);if(cached){S.tradeSuggestions=rankTrades(cached.ideas);render();return}
 const run=++S.tradeRun,key=seasonKey(),btn=$('#suggest-trades');if(btn){btn.disabled=true;btn.textContent='Comparing the season…'}
 await new Promise(r=>setTimeout(r,20));
 try{const result=await findTradeIdeas(S.data,l,model,{tradeExcluded:S.tradeExcluded,tradeMinGain:S.tradeMinGain,tradeMaxGap:S.tradeMaxGap,tradeOwnBias:S.penalty,waiverProtected:S.prefs.waiverProtected},{limit:10000,cancelled:()=>run!==S.tradeRun||seasonKey()!==key||league()?.league_id!==l.league_id||seasonModel(league())!==model||tradeResultKey(league(),model)!==resultKey});
  if(result.cancelled)return;const ideas=result.ideas;
  tradeResults.set(resultKey,result);S.tradeSuggestions=rankTrades(ideas);render();
 }catch(e){toast(e.message);render()}
}
