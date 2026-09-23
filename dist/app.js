// Awaker starts here: ask whether a service is running, read preferences, then draw. Everything else
// lives in ui/: state.js holds what the page remembers, render.js draws it, events.js reacts to it, and
// each page has its own module in ui/pages/.
import {demo} from './demo.js';
import {aggregateWatch} from './engine.js';
import {getTheme,applyTheme} from './themes.js';
import {S} from './ui/state.js';
import {$,isLeagueView,isTradeView,nav,pname} from './ui/core.js';
import {readPreferences,applyPreferences} from './ui/preferences.js';
import {ensureTradeOutlook} from './ui/outlook.js';
import {ensureLeagueSeason} from './ui/pages/league-outlook.js';
import {ensureSeasonPage} from './ui/pages/season-review.js';
import {ensureWaiverOutlook} from './ui/pages/waiver-wire.js';
import {observeScores} from './ui/pages/watchroom.js';
import {rememberPage,render} from './ui/render.js';
import {connect,refresh} from './ui/session.js';
import {bindEvents} from './ui/events.js';

S.data=demo();
try{const response=await fetch('/api/v1/settings',{signal:AbortSignal.timeout(15000)});if(response.status===401){location.replace('/integrations.html');await new Promise(()=>{})}if(response.ok){S.serviceSettings=(await response.json()).settings;S.serviceMode=true}}catch{}
let stored=null;try{stored=localStorage.getItem('sunday-preferences')}catch{}
applyPreferences(readPreferences(stored,S.serviceMode?S.serviceSettings:null));
try{S.themeId=getTheme(localStorage.getItem('sunday-theme')).id}catch{}
applyTheme(S.themeId);
bindEvents();

const route=new URLSearchParams(location.search);let savedPage;try{savedPage=localStorage.getItem('sunday-page')}catch{}
const pages=nav.map(([id])=>id).filter(id=>id!=='notifications');
if(route.get('view')==='notifications'){location.replace('/integrations.html');await new Promise(()=>{})}
if(pages.includes(route.get('view')))S.view=route.get('view');else if(pages.includes(savedPage))S.view=savedPage;
if(route.get('league')){S.leagueId=route.get('league');S.prefs.analysisLeague=S.leagueId}
rememberPage();
observeScores();render();
if(S.serviceMode&&S.prefs.username){refresh(true)}else if(S.prefs.username){$('#username').value=S.prefs.username;connect(S.prefs.username)}else{if(isTradeView())ensureTradeOutlook();if(S.view==='waivers')ensureWaiverOutlook();if(S.view==='season')ensureSeasonPage();if(isLeagueView())ensureLeagueSeason()}
if(document.modelContext?.registerTool){try{document.modelContext.registerTool({name:'read_awaker_watchroom',description:'Read tracked fantasy players, league-specific points, and game status currently available in Awaker.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute(input){if(Object.keys(input||{}).length)throw Error('This tool takes no arguments.');return {demo:S.data.demo,week:S.data.week,updatedAt:S.data.updatedAt,players:aggregateWatch(S.data.leagues,S.data.players,S.data.games).map(p=>({name:pname(p.id),number:p.player.number,team:p.player.team,status:p.game?.state||'unknown',leagues:p.appearances}))}}})}catch{}}
