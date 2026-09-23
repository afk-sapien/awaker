// Connecting to Sleeper or the Awaker service, refreshing, and saving preferences.
import * as api from '../api.js';
import {defenseWeeks} from '../defenses.js';
import {S} from './state.js';
import {$,isLeagueView,isTradeView,toast} from './core.js';
import {ensureTradeOutlook} from './outlook.js';
import {ensureLeagueSeason} from './pages/league-outlook.js';
import {ensureSeasonPage} from './pages/season-review.js';
import {ensureWaiverOutlook} from './pages/waiver-wire.js';
import {observeScores} from './pages/watchroom.js';
import {render} from './render.js';

export function savePrefs(){Object.assign(S.prefs,{tradeMinGain:S.tradeMinGain,tradeMaxGap:S.tradeMaxGap,tradeEndWeek:S.tradeEndWeek,waiverExcluded:S.waiverExcluded,waiverUpgradesOnly:S.waiverUpgradesOnly,waiverHorizon:S.waiverHorizon,waiverEndWeek:S.waiverEndWeek,protectStarters:S.protectStarters,samePositionDrops:S.samePositionDrops,watchFilter:S.filter,showBench:S.bench,watchLeague:S.watchLeague,analysisLeague:S.leagueId,tradeOwnBias:S.penalty,requireBenefit:S.requireBenefit});try{localStorage.setItem('sunday-preferences',JSON.stringify({...S.prefs,pins:[...S.pins],disabled:S.data.demo?(S.prefs.disabled||[]):S.data.leagues.filter(l=>!l.enabled).map(l=>l.league_id)}))}catch{toast('Browser storage is unavailable; preferences will reset when you close this page.')}if(S.serviceMode&&!S.data.demo){
 // Read now, not when the timer fires: a refresh landing in between would put the server's own flags back and lose the change.
 const body=JSON.stringify({preferences:S.prefs,disabled:[...new Set([...(S.serviceSettings.disabled||[]).filter(id=>!S.data.leagues.some(l=>l.league_id===id)),...S.data.leagues.filter(l=>!l.enabled&&!l.inactive).map(l=>l.league_id)])]});
 clearTimeout(S.serviceSaveTimer);S.serviceSaveTimer=setTimeout(()=>fetch('/api/v1/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body}).then(r=>{if(!r.ok)throw Error()}).catch(()=>toast('Your change could not be saved to the Awaker service.')),400)}}
export async function connect(username){if(S.serviceMode){location.href='/integrations.html';return}const run=++S.connectRun,button=$('#connect-form button[type=submit]');button.disabled=true;button.textContent='Finding your leagues…';$('#connect-error').textContent='';try{const found=await api.discover(username),week=Math.max(1,Math.min(18,Number(found.nfl.week)||1));const [players,details]=await Promise.all([api.loadPlayers(),Promise.allSettled(found.leagues.map(l=>api.leagueDetails(l,found.user.user_id,week)))]);if(run!==S.connectRun)return;const leagues=details.filter(r=>r.status==='fulfilled').map(r=>({...r.value,enabled:!(S.prefs.disabled||[]).includes(r.value.league_id)&&r.value.status!=='complete'}));if(!leagues.length)throw Error('No leagues could be loaded. Please refresh and try again.');if(!leagues.some(l=>l.enabled))leagues.forEach(l=>l.enabled=true);S.data={user:found.user,nfl:found.nfl,week,players,leagues,projections:{},games:{},schedules:{},trends:[],updatedAt:Date.now(),demo:false,errors:details.flatMap((r,i)=>r.status==='rejected'?[`Could not load ${found.leagues[i].name}.`]:[])};S.leagueId=leagues.some(l=>l.league_id===S.prefs.analysisLeague&&l.enabled)?S.prefs.analysisLeague:leagues.find(l=>l.enabled).league_id;S.watchLeague=leagues.some(l=>l.league_id===S.prefs.watchLeague&&l.enabled)?S.prefs.watchLeague:'all';S.give=[];S.get=[];S.tradeManual=null;S.tradeSuggestions=null;S.prefs.username=found.user.username;savePrefs();$('#connect').close();observeScores();render();await refresh(true);if(isTradeView())ensureTradeOutlook();if(S.view==='waivers')ensureWaiverOutlook();toast(`Connected ${leagues.length} league${leagues.length===1?'':'s'}.`);}catch(e){if(run===S.connectRun){$('#connect-error').textContent=e.message;if(!$('#connect').open)toast('Could not reconnect: '+e.message);if(isTradeView())ensureTradeOutlook();if(S.view==='waivers')ensureWaiverOutlook();if(S.view==='season')ensureSeasonPage();if(isLeagueView())ensureLeagueSeason()}}finally{button.disabled=false;button.textContent='Find my leagues →';}}
export async function refresh(full=false,force=false){
 if(S.serviceMode){if(S.busy)return;S.busy=true;try{const held=!S.data.demo&&S.data.playersAt?S.data:null,response=await fetch((force?'/api/v1/refresh':'/api/v1/client')+(held?`?players=${encodeURIComponent(held.playersAt)}`:''),{method:force?'POST':'GET',signal:AbortSignal.timeout(90000)});if(response.status===401){location.replace('/integrations.html');return}if(!response.ok)throw Error('Could not refresh from the Awaker service. It will try again shortly.');const result=await response.json();
  // An unchanged directory is not sent again. Keeping the same object also keeps trade and waiver results, which are cached against it.
  if(!result.data.players&&held)result.data.players=held.players;S.data=result.data;S.serviceSettings=result.settings;if(!S.data.leagues.some(l=>l.league_id===S.leagueId))S.leagueId=S.data.leagues[0]?.league_id;observeScores()}catch(e){toast(e.message)}finally{S.busy=false;render();if(isTradeView()&&S.data.leagues.some(l=>l.enabled))ensureTradeOutlook();if(S.view==='waivers'&&S.data.leagues.some(l=>l.enabled))ensureWaiverOutlook();if(S.view==='season')ensureSeasonPage();if(isLeagueView())ensureLeagueSeason()}return}

 if(S.busy||S.data.demo){if(S.data.demo)toast('Demo scores are illustrative. Connect Sleeper for live updates.');return}
 S.busy=true;let again=false;try{render();const current=S.data,userId=S.data.user.user_id,week=S.data.week,season=S.data.nfl.season,weeks=defenseWeeks(week);
 const jobs=S.data.leagues.map((l,i)=>({type:'league',i,request:api.leagueDetails(l,userId,week,{force})}));
 jobs.push({type:'schedule',week,request:api.scoreboard(season,week,{force})});
 if(full){for(const w of weeks){jobs.push({type:'projection',week:w,request:api.projections(season,w,{force})});if(w!==week)jobs.push({type:'schedule',week:w,request:api.scoreboard(season,w,{ttl:3600000,force})})}jobs.push({type:'trends',request:api.trends({force})})}
 if(full)jobs.push({type:'players',request:api.loadPlayers()});
 // The account changed while this was in flight. The new account asked for a refresh and was turned away, so it gets one now.
 const results=await Promise.allSettled(jobs.map(j=>j.request));if(current!==S.data){again=true;return}
 const errors=[];let synced=false;
 results.forEach((result,i)=>{const job=jobs[i],ok=result.status==='fulfilled';
  if(job.type==='league'){if(ok){S.data.leagues[job.i]={...result.value,enabled:S.data.leagues[job.i].enabled};synced=true}else errors.push(`${S.data.leagues[job.i].name}: refresh failed; showing previous scores.`)}
  if(job.type==='schedule'){if(ok){S.data.schedules[job.week]=result.value;if(job.week===week)S.data.games=result.value}else{delete S.data.schedules[job.week];errors.push(`Week ${job.week} NFL schedule unavailable.${job.week===week?' Previous game status may be stale.':''}`)}}
  if(job.type==='projection'){if(ok)S.data.projections[job.week]=result.value;else{delete S.data.projections[job.week];errors.push(`Week ${job.week} projections unavailable.`)}}
  if(job.type==='trends'){if(ok)S.data.trends=result.value;else errors.push('Trending adds are unavailable.')}
  // Injuries and team changes arrive with the daily directory. It is free until its day is up, and an unchanged object keeps every cache keyed on it.
  if(job.type==='players'&&ok&&result.value!==S.data.players)S.data.players=result.value;
 });
 S.data.errors=errors;if(synced)S.data.updatedAt=Date.now();S.busy=false;observeScores();render();if(isTradeView())ensureTradeOutlook();if(S.view==='waivers')ensureWaiverOutlook();if(S.view==='season')ensureSeasonPage();if(isLeagueView())ensureLeagueSeason();
 }catch(e){console.error(e);toast('Could not refresh: '+e.message)}finally{if(S.busy){S.busy=false;if(!again)render()}if(again&&!S.data.demo)refresh(true)}
}
