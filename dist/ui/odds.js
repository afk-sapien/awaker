// Playoff odds for a what-if roster, simulated in the background one at a time and remembered.
import {createMemo,identity,rosterKey} from '../cache.js';
import {tradeOdds} from '../league.js';
import {S} from './state.js';
import {isTradeView,league} from './core.js';
import {currentOutlook,seasonKey} from './outlook.js';
import {currentLeagueOutlook,leagueSeasonKey} from './pages/league-outlook.js';
import {render} from './render.js';

// What a roster move does to playoff odds. Each answer costs a simulation, so none is worked out while
// the page is being drawn: a card asks, shows a placeholder, and the page is drawn again when the
// answers are in. Answers are kept until rosters or projections change, not on every score update.
export const whatIfMemo=createMemo(400),whatIfQueue=new Map(),whatIfBaselines=createMemo(6),tradeHorizons=new WeakMap();
export function whatIf(key,compute){
 const hit=whatIfMemo.peek(key);if(hit!==undefined)return hit||null;
 // Questions about another league are dropped: the queue only ever holds the league on screen.
 const at=league()?.league_id;if(at!==S.whatIfLeague){whatIfQueue.clear();S.whatIfLeague=at}
 whatIfQueue.set(key,{compute,league:at});if(!S.whatIfBusy){S.whatIfBusy=true;setTimeout(runWhatIfs,0)}
 return undefined;
}
export async function runWhatIfs(){
 try{while(whatIfQueue.size){const [key,{compute,league:at}]=whatIfQueue.entries().next().value;whatIfQueue.delete(key);if(at!==league()?.league_id){whatIfQueue.clear();break}let found=null;try{found=compute()}catch{}whatIfMemo.set(key,found||false);await new Promise(done=>setTimeout(done,0))}}
 finally{S.whatIfBusy=false;if(isTradeView()||S.view==='waivers')render()}
}
export function oddsOutlook(){const l=league();if(!l||S.data.demo||S.leagueSeasonState?.key!==leagueSeasonKey(l))return null;try{return currentLeagueOutlook()}catch{return null}}
// Shown against the odds on the League outlook page, so the two pages never disagree.
export const oddsShown=(o,id,side)=>{const now=o.rows.find(x=>x.rosterId===id)?.odds.playoff??side.playoff[0],change=side.playoff[1]-side.playoff[0];return {now,after:Math.max(0,Math.min(1,now+change)),change}};
export const oddsChange=s=>{const points=Math.round(s.change*1000)/10;const fine=Math.round(s.now*100)===Math.round(s.after*100)&&points!==0,pct=v=>fine?(v*100).toFixed(1):Math.round(v*100);return `${pct(s.now)}% <span aria-hidden="true">→</span><span class="sr-only"> to </span> ${pct(s.after)}% <small class="${points>=.5?'gain':points<=-.5?'loss':'muted'}">${points>0?'+':''}${points.toFixed(1)}</small>`};
// A trade is rated over the same rest-of-season weeks it was judged on. undefined means still being worked out.
export function tradeOddsFor(r){
 const l=league(),outlook=currentOutlook(),o=oddsOutlook();if(!o||!outlook||!r.partnerId)return null;
 if(!tradeHorizons.has(outlook))tradeHorizons.set(outlook,{key:`${seasonKey()}:${identity(outlook)}`,projections:Object.fromEntries(outlook.weeks.map(w=>[w,outlook.data[w].projections])),weeks:outlook.weeks});
 const horizon=tradeHorizons.get(outlook),rosters=rosterKey(l);
 const found=whatIf(JSON.stringify(['trade',S.leagueSeasonState.key,rosters,horizon.key,r.partnerId,r.give,r.get,r.dropA,r.dropB]),()=>tradeOdds(o,r,{horizon,memo:(key,compute)=>whatIfBaselines.get(JSON.stringify([rosters,key]),compute)}));
 return found&&{mine:oddsShown(o,l.mine.roster_id,found.mine),partner:oddsShown(o,r.partnerId,found.partner)};
}
export function tradeOddsRow(r){
 const odds=tradeOddsFor(r);if(odds===null)return '';
 return `<div class="trade-points-label">Playoff odds</div><dl class="trade-metrics trade-odds">${[['You','mine'],['Them','partner']].map(([label,side])=>`<div><dt>${label}</dt><dd>${odds?oddsChange(odds[side]):'<small class="muted">Working it out…</small>'}</dd></div>`).join('')}</dl>`;
}
