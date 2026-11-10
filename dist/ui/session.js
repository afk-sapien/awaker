// Connecting to Sleeper or the Awaker service, refreshing, and saving preferences.
import * as api from '../api.js';
import {defenseWeeks} from '../defenses.js';
import {S} from './state.js';
import {$,gameStatusEnabled,isLeagueView,isTradeView,named,toast} from './core.js';
import {ensureTradeOutlook} from './outlook.js';
import {ensureLeagueSeason} from './pages/league-outlook.js';
import {ensureSeasonPage} from './pages/season-review.js';
import {syncOverrides} from './overrides.js';
import {ensureWaiverOutlook} from './pages/waiver-wire.js';
import {observeScores} from './pages/watchroom.js';
import {render} from './render.js';

export function savePrefs(){Object.assign(S.prefs,{tradeMinGain:S.tradeMinGain,tradeMaxGap:S.tradeMaxGap,tradeEndWeek:S.tradeEndWeek,waiverExcluded:S.waiverExcluded,waiverUpgradesOnly:S.waiverUpgradesOnly,waiverHorizon:S.waiverHorizon,waiverEndWeek:S.waiverEndWeek,protectStarters:S.protectStarters,samePositionDrops:S.samePositionDrops,watchFilter:S.filter,showBench:S.bench,watchLeague:S.watchLeague,analysisLeague:S.leagueId,tradeOwnBias:S.penalty,requireBenefit:S.requireBenefit});try{localStorage.setItem('sunday-preferences',JSON.stringify({...S.prefs,pins:[...S.pins],disabled:S.data.demo?(S.prefs.disabled||[]):S.data.leagues.filter(l=>!l.enabled).map(l=>l.league_id)}))}catch{toast('Browser storage is unavailable; preferences will reset when you close this page.')}if(S.serviceMode&&!S.data.demo){
 // Read now, not when the timer fires: a refresh landing in between would put the server's own flags back and lose the change.
 const body=JSON.stringify({preferences:S.prefs,disabled:[...new Set([...(S.serviceSettings.disabled||[]).filter(id=>!S.data.leagues.some(l=>l.league_id===id)),...S.data.leagues.filter(l=>!l.enabled&&!l.inactive).map(l=>l.league_id)])]});
 clearTimeout(S.serviceSaveTimer);S.serviceSaveTimer=setTimeout(()=>fetch('/api/v1/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body}).then(r=>{if(!r.ok)throw Error()}).catch(()=>toast(named('Your change could not be saved to the Awaker service.'))),400)}}
export async function connect(username){if(S.serviceMode){location.href='/integrations.html';return}const run=++S.connectRun,button=$('#connect-form button[type=submit]');button.disabled=true;button.textContent='Finding your leagues…';$('#connect-error').textContent='';try{const found=await api.discover(username),week=Math.max(1,Math.min(18,Number(found.nfl.week)||1));const [players,details]=await Promise.all([api.loadPlayers(),Promise.allSettled(found.leagues.map(l=>api.leagueDetails(l,found.user.user_id,week)))]);if(run!==S.connectRun)return;const leagues=details.filter(r=>r.status==='fulfilled').map(r=>({...r.value,enabled:!(S.prefs.disabled||[]).includes(r.value.league_id)&&r.value.status!=='complete'}));if(!leagues.length)throw Error('No leagues could be loaded. Please refresh and try again.');if(!leagues.some(l=>l.enabled))leagues.forEach(l=>l.enabled=true);S.data={user:found.user,nfl:found.nfl,week,players,leagues,projections:{},games:{},schedules:{},trends:[],updatedAt:Date.now(),demo:false,errors:details.flatMap((r,i)=>r.status==='rejected'?[`Could not load ${found.leagues[i].name}.`]:[])};S.leagueId=leagues.some(l=>l.league_id===S.prefs.analysisLeague&&l.enabled)?S.prefs.analysisLeague:leagues.find(l=>l.enabled).league_id;S.watchLeague=leagues.some(l=>l.league_id===S.prefs.watchLeague&&l.enabled)?S.prefs.watchLeague:'all';S.give=[];S.get=[];S.tradeManual=null;S.tradeSuggestions=null;S.prefs.username=found.user.username;savePrefs();$('#connect').close();observeScores();render();await refresh(true);if(isTradeView())ensureTradeOutlook();if(S.view==='waivers')ensureWaiverOutlook();toast(`Connected ${leagues.length} league${leagues.length===1?'':'s'}.`);}catch(e){if(run===S.connectRun){$('#connect-error').textContent=e.message;if(!$('#connect').open)toast('Could not reconnect: '+e.message);if(isTradeView())ensureTradeOutlook();if(S.view==='waivers')ensureWaiverOutlook();if(S.view==='season')ensureSeasonPage();if(isLeagueView())ensureLeagueSeason()}}finally{button.disabled=false;button.textContent='Find my leagues →';}}
export async function refresh(full=false,force=false){
 if(S.serviceMode){if(S.busy)return;S.busy=true;try{const held=!S.data.demo&&S.data.playersAt?S.data:null,response=await fetch((force?'/api/v1/refresh':'/api/v1/client')+(held?`?players=${encodeURIComponent(held.playersAt)}`:''),{method:force?'POST':'GET',signal:AbortSignal.timeout(90000)});if(response.status===401){location.replace('/integrations.html');return}if(!response.ok)throw Error(named('Could not refresh from the Awaker service. It will try again shortly.'));const result=await response.json();
  // An unchanged directory is not sent again. Keeping the same object also keeps trade and waiver results, which are cached against it.
  if(!result.data.players&&held)result.data.players=held.players;S.data=result.data;S.serviceSettings=result.settings;
  // The service's copy of the owner's corrections is the authority once there is a service, so a
  // second browser sees what the first one wrote and the digest and the dashboard agree.
  if(Array.isArray(result.overrides)){S.overrides=result.overrides;S.overridesRev++}
  syncOverrides();if(!S.data.leagues.some(l=>l.league_id===S.leagueId))S.leagueId=S.data.leagues[0]?.league_id;observeScores()}catch(e){toast(e.message)}finally{S.busy=false;render();if(isTradeView()&&S.data.leagues.some(l=>l.enabled))ensureTradeOutlook();if(S.view==='waivers'&&S.data.leagues.some(l=>l.enabled))ensureWaiverOutlook();if(S.view==='season')ensureSeasonPage();if(isLeagueView())ensureLeagueSeason()}return}

 if(S.busy||S.data.demo){if(S.data.demo)toast('Demo scores are illustrative. Connect Sleeper for live updates.');return}
 S.busy=true;let again=false;try{render();const current=S.data,userId=S.data.user.user_id,week=S.data.week,season=S.data.nfl.season,weeks=defenseWeeks(week);
 // Read once per refresh and told to api, so that nothing anywhere reaches ESPN for game status
 // while a deployment has it switched off.
 const gameStatus=gameStatusEnabled();api.allowGameStatus(gameStatus);
 const jobs=S.data.leagues.map((l,i)=>({type:'league',i,request:api.leagueDetails(l,userId,week,{force})}));
 if(gameStatus)jobs.push({type:'schedule',week,request:api.scoreboard(season,week,{force})});
 // Only this week's games are asked for here. The four weeks after it are read by the defense planner
 // and the season review alone, both of which have to be opened, so ensureFutureWeeks below fetches
 // them when one of them is: four requests that every load used to make for a page most people never
 // open. The projections are a different matter and stay, because the trade, waiver and league pages
 // compute from all five as soon as they are drawn.
 if(full){for(const w of weeks)jobs.push({type:'projection',week:w,request:api.projections(season,w,{force})});jobs.push({type:'trends',request:api.trends({force})})}
 if(full)jobs.push({type:'players',request:api.loadPlayers()});
 // The account changed while this was in flight. The new account asked for a refresh and was turned away, so it gets one now.
 const results=await Promise.allSettled(jobs.map(j=>j.request));if(current!==S.data){again=true;return}
 const errors=[];let synced=false;
 results.forEach((result,i)=>{const job=jobs[i],ok=result.status==='fulfilled';
  if(job.type==='league'){if(ok){S.data.leagues[job.i]={...result.value,enabled:S.data.leagues[job.i].enabled};synced=true}else errors.push(`${S.data.leagues[job.i].name}: refresh failed; showing previous scores.`)}
  if(job.type==='schedule'){if(ok){S.data.schedules[job.week]=result.value;if(job.week===week)S.data.games=result.value}else{delete S.data.schedules[job.week];errors.push(`Week ${job.week} NFL schedule unavailable.${job.week===week?' Previous game status may be stale.':''}`)}}
  // Sleeper names each player's team and that week's opponent, so with ESPN switched off the
  // pairings and the byes still arrive, from the feed the projections were already in. games is left
  // alone: nothing in a projection says whether a game has started, and games is what says that.
  if(job.type==='projection'){if(ok){S.data.projections[job.week]=result.value;if(!gameStatus)S.data.schedules[job.week]=api.weekSchedule(result.value)}else{delete S.data.projections[job.week];if(!gameStatus)delete S.data.schedules[job.week];errors.push(`Week ${job.week} projections unavailable.`)}}
  if(job.type==='trends'){if(ok)S.data.trends=result.value;else errors.push('Trending adds are unavailable.')}
  // Injuries and team changes arrive with the daily directory. It is free until its day is up, and an unchanged object keeps every cache keyed on it.
  if(job.type==='players'&&ok&&result.value!==S.data.players)S.data.players=result.value;
 });
 S.data.errors=errors;if(synced)S.data.updatedAt=Date.now();S.busy=false;observeScores();render();if(isTradeView())ensureTradeOutlook();if(S.view==='waivers')ensureWaiverOutlook();if(S.view==='season')ensureSeasonPage();if(isLeagueView())ensureLeagueSeason();if(needsFutureWeeks())ensureFutureWeeks();
 }catch(e){console.error(e);toast('Could not refresh: '+e.message)}finally{if(S.busy){S.busy=false;if(!again)render()}if(again&&!S.data.demo)refresh(true)}
}

// The two views that read the weeks after this one: the defense planner's matchups and byes, and the
// next three opponents in the season review. Everything else in the app either asks only about this
// week or computes from the projections, which are fetched for all five weeks either way.
export const needsFutureWeeks=()=>['defenses','season'].includes(S.view);
// So the four future weeks are fetched when one of those views is opened, not on every load. Held
// for an hour by the cache, like any other schedule, so moving between the two views costs nothing.
//
// Nothing is fetched with game status switched off: the pairings are then taken from the projections
// during the refresh instead. Nor in service mode, where the service has no view to wait for and
// fetches all five itself, nor for the demo, whose weeks are invented.
let futureWeeks=null;
export function ensureFutureWeeks(force=false){
 if(S.serviceMode||S.data.demo||!gameStatusEnabled())return Promise.resolve();
 const current=S.data,week=S.data.week,season=S.data.nfl.season,weeks=defenseWeeks(week).filter(w=>w!==week);
 if(!weeks.length)return Promise.resolve();
 if(!force&&futureWeeks?.data===current&&futureWeeks.week===week)return futureWeeks.pending;
 const pending=Promise.allSettled(weeks.map(w=>api.scoreboard(season,w,{ttl:3600000,force}))).then(results=>{
  if(current!==S.data)return;
  let got=false;
  results.forEach((result,i)=>{if(result.status==='fulfilled'&&Object.keys(result.value).length){S.data.schedules[weeks[i]]=result.value;got=true}});
  // A week that could not be fetched is left absent rather than empty, which is what every reader of
  // schedules already treats as nothing known: the defense planner says so in the cell and no bye is
  // implied anywhere.
  if(got)render();
 }).catch(()=>{});
 futureWeeks={data:current,week,pending};
 return pending;
}
