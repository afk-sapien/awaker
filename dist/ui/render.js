// Drawing: one render() for the whole page, keeping focus and open sections across redraws, and the page in the URL.
import {S} from './state.js';
import {badge} from './unread.js';
import {$,empty,esc,icon,nav} from './core.js';
import {defenses} from './pages/defense-planner.js';
import {leagueOutlookPage} from './pages/league-outlook.js';
import {scoreboardPage} from './pages/scoreboard.js';
import {season} from './pages/season-review.js';
import {settings} from './pages/settings.js';
import {lineup} from './pages/start-sit.js';
import {tradeBuilder,trades} from './pages/trade-finder.js';
import {waivers} from './pages/waiver-wire.js';
import {watchroom} from './pages/watchroom.js';

// Drawing replaces the whole page, so focus and open sections are found again by id, their data-* attributes or, for sections, their classes.
export function uiKey(el){if(!el||!el.closest?.('#app'))return null;if(el.tagName==='SUMMARY'){const d=uiKey(el.parentElement);return d&&{sel:d.sel+'>summary',i:d.i}}const sel=el.id?`#${CSS.escape(el.id)}`:[...el.attributes].some(a=>a.name.startsWith('data-'))?el.tagName.toLowerCase()+[...el.attributes].filter(a=>a.name.startsWith('data-')).map(a=>`[${a.name}="${CSS.escape(a.value)}"]`).join(''):el.tagName==='DETAILS'&&el.classList.length?'details.'+[...el.classList].map(c=>CSS.escape(c)).join('.'):null;return sel&&{sel,i:[...document.querySelectorAll(sel)].indexOf(el)}}
export function uiFind(k){if(!k)return null;const all=document.querySelectorAll(k.sel);return all[k.i]||all[0]||null}
export function page(){try{return ({watch:watchroom,waivers:waivers,lineup:lineup,trades:trades,'trade-builder':tradeBuilder,defenses:defenses,season:season,league:leagueOutlookPage,scoreboard:scoreboardPage,settings:settings})[S.view]()}catch(e){console.error(e);return empty('This page could not be drawn','Something in the latest data could not be shown. Try another page, or refresh.')}}
// The demo drawn while real leagues load says nothing about a saved filter, so it is only checked against real ones.
export function render(){if(!S.data.demo&&S.watchLeague!=='all'&&!S.data.leagues.some(l=>l.league_id===S.watchLeague&&l.enabled))S.watchLeague='all';
 const active=document.activeElement,focusAt=uiKey(active),sel=active?.selectionStart,openDetails=[...document.querySelectorAll('#app details[open]')].map(uiKey).filter(Boolean),openTrades=new Set([...document.querySelectorAll('[data-trade-detail][open]')].map(el=>el.dataset.tradeDetail));
 document.body.classList.toggle('focus',S.focus&&S.view==='watch');document.body.classList.toggle('watch-view',S.view==='watch');
 $('#app').innerHTML=`<aside class="sidebar"><div class="brand">awaker<em>／</em><small>HQ</small></div><div class="nav-label">YOUR PLAYBOOK</div><nav aria-label="Main navigation">${nav.filter(([id])=>id!=='notifications'||S.serviceMode).map(([id,label])=>`<button class="nav-btn ${S.view===id?'active':''}" data-nav="${id}" ${S.view===id?'aria-current="page"':''}>${icon(id)}${label}${id==='notifications'?badge(S.unread):''}</button>`).join('')}</nav><div class="sidebar-bottom"><p>Less switching.<br>More football.</p><button class="nav-btn" data-nav="settings">${icon('settings')}${S.data.leagues.filter(l=>l.enabled).length} leagues connected</button></div></aside><main class="main"><header class="topbar"><div class="mobile-brand">awaker／</div><div class="crumb">Fantasy football <span style="margin:0 10px">/</span> <strong>${nav.find(x=>x[0]===S.view)[1]}</strong></div><div class="top-actions"><button class="secondary theme-trigger" id="open-theme" aria-haspopup="dialog" aria-controls="theme-dialog"><span class="theme-swatch" aria-hidden="true"></span>Theme</button><span class="pill ${S.data.demo?'demo':''}">${S.data.demo?'DEMO MODE':'SLEEPER CONNECTED'}</span><button class="primary" data-connect>${S.data.demo?'Connect Sleeper ↗':esc(S.data.user.username)}</button></div></header><div class="content">${S.data.errors.length?`<div class="note warn" role="status">${S.data.errors.map(esc).join(' · ')}</div>`:''}${S.view!=='settings'&&!S.data.leagues.some(l=>l.enabled)?empty('No leagues selected','Open My leagues to include a league in your dashboard.'):page()}<footer class="status-footer"><span>${S.data.demo?'Illustrative demo · sample scores':`Updated ${new Date(S.data.updatedAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit',second:'2-digit'})} · refreshes every 45 seconds while visible`}</span><span><a href="https://docs.sleeper.com/" target="_blank" rel="noopener">Sleeper data & trends</a> · NFL game status: ESPN</span></footer></div></main>`;
 // Sections are matched partly by position, so they are only reopened on the page they were opened on.
 if(S.drawnView===S.view)for(const k of openDetails){const el=uiFind(k);if(el)el.open=true}S.drawnView=S.view;
 document.querySelectorAll('[data-trade-detail]').forEach(el=>{el.open=openTrades.has(el.dataset.tradeDetail)});
 // A button redrawn as disabled while it works cannot take focus, so focus waits and returns once it is enabled again.
 const want=focusAt&&!active.isConnected?focusAt:S.pendingFocus&&(!document.activeElement||document.activeElement===document.body)?S.pendingFocus:null;S.pendingFocus=null;
 if(want){const el=uiFind(want);if(el?.disabled)S.pendingFocus=want;else if(el){el.focus({preventScroll:true});if(want===focusAt&&typeof sel==='number'&&el.setSelectionRange){try{el.setSelectionRange(sel,sel)}catch{}}}}
}
export function rememberPage(){
 try{localStorage.setItem('sunday-page',S.view)}catch{}
 const url=new URL(location.href);url.searchParams.set('view',S.view);url.searchParams.delete('league');history.replaceState(history.state,'',url);
}
