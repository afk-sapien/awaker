// Shared pieces every page draws with: escaping, number formats, icons, navigation and page chrome.
import {projected,ruledOut} from '../engine.js';
import {S} from './state.js';

export const icon=(name)=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${({watch:'<rect x="3" y="4" width="18" height="14" rx="2"/><path d="m8 22 4-4 4 4M8 10h8M12 6v8"/>',waivers:'<path d="m3 17 6-6 4 3 8-10M15 4h6v6"/>',lineup:'<path d="M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1"/>',trades:'<path d="M3 7h18m-5-5 5 5-5 5M21 17H3m5-5-5 5 5 5"/>','trade-builder':'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 12h8m-4-4v8"/>',defenses:'<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6z"/>',season:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',scoreboard:'<rect x="3" y="3" width="18" height="7" rx="1.5"/><rect x="3" y="14" width="18" height="7" rx="1.5"/><path d="M7 6.5h6M7 17.5h4"/>',league:'<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3"/>',notifications:'<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 21a2 2 0 0 0 4 0"/>',settings:'<path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="2" fill="currentColor"/><circle cx="16" cy="12" r="2" fill="currentColor"/><circle cx="10" cy="18" r="2" fill="currentColor"/>'})[name]}</svg>`;
export const nav=[['watch','Awaker watchroom'],['scoreboard','Around the league'],['waivers','Waiver wire'],['lineup','Start / sit'],['trades','Auto trades'],['trade-builder','Trade builder'],['defenses','Defense planner'],['season','Season review'],['league','League outlook'],['notifications','Notifications'],['settings','My leagues']];
export const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),fmt=(n,d=1)=>Number.isFinite(n)?(Math.abs(n)<Math.pow(10,-d)/2?0:n).toFixed(d):'—',signed=n=>`${n>0?'+':''}${fmt(n)}`;
export const colors=['#aebee8','#e4ba6f','#82b9a7','#b89bc7','#92b9da'];
export const teamColors={CIN:'#d96527',BUF:'#2761a4',ATL:'#a3434c',MIN:'#7460a3',LV:'#64747a',DET:'#2980a4',KC:'#b94340',PHI:'#27675c',BAL:'#70659c',SF:'#ab4744',DAL:'#4b7195',NYJ:'#387565',GB:'#376c51',LAR:'#3876bb',HOU:'#365e79',MIA:'#298e92'};
// Stored preferences are only trusted in shape: anything the wrong type is dropped so a bad save cannot stop the page from starting.
export const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
export const isTradeView=()=>S.view==='trades'||S.view==='trade-builder';
// The toast is a live region that is always in the page (empty when idle), so screen readers hear each new message.
export function toast(t){$('#toast').textContent=t;clearTimeout(toast.t);toast.t=setTimeout(()=>$('#toast').textContent='',4500)}
export const league=()=>S.data.leagues.find(l=>l.league_id===S.leagueId&&l.enabled)||S.data.leagues.find(l=>l.enabled);
export const pname=id=>S.data.players[id]?.full_name||[S.data.players[id]?.first_name,S.data.players[id]?.last_name].filter(Boolean).join(' ')||id||'Empty slot';
// Before his game in the current NFL week, a player ruled out projects the zero he will score, not whatever Sleeper
// still lists for him. Once it has kicked off the pregame projection is history, and other weeks are not his status's to decide.
export function value(id,l=league(),w=S.data.week){const p=S.data.players[id];if(w===(S.data.nfl?.week??S.data.week)&&ruledOut(p)&&(S.data.games?.[p.team]?.state??'pre')==='pre')return 0;return projected(S.data.projections[w]?.[id]?.stats,l?.scoring_settings)}
export const scoring=l=>l.scoring_settings?.rec===1?'PPR':l.scoring_settings?.rec===.5?'HALF PPR':l.scoring_settings?.rec===0||!l.scoring_settings?.rec?'STANDARD':'CUSTOM';
export function leagueOptions(selected=S.leagueId,all=false){return (all?'<option value="all">All leagues</option>':'')+S.data.leagues.filter(l=>l.enabled).map(l=>`<option value="${esc(l.league_id)}" ${selected===l.league_id?'selected':''}>${esc(l.name)}</option>`).join('')}
export function empty(title,body=''){return `<div class="empty"><h3>${esc(title)}</h3>${body?`<p>${esc(body)}</p>`:''}</div>`}
export function pageHead(title,desc,actions=''){return `<div class="page-head"><div><div class="eyebrow">${S.data.demo?'EXPLORE THE DEMO':esc(S.data.user.username)+'’S PLAYBOOK'} · WEEK ${S.data.week}</div><h1>${title}</h1><p>${desc}</p></div>${actions}</div>`}
export function projectionNote(){
 const l=league(),available=Object.keys(S.data.projections[S.data.week]||{}).length;let missing=[];
 if(l){const keys=new Set(Object.values(S.data.projections[S.data.week]||{}).flatMap(p=>Object.keys(p.stats||{})));missing=Object.entries(l.scoring_settings||{}).filter(([k,v])=>v!==0&&!keys.has(k)).map(([k])=>k)}
 if(!available)return '<p class="data-alert" role="status">Projections unavailable this week. Recommendations are paused; scores and rosters still work.</p>';
 return `<details class="data-details"><summary>${S.data.demo?'Sample projections':'Sleeper projections'} · Scoring details</summary><p>${S.data.demo?'Sample projections for exploring the prototype.':'Estimates use this league’s scoring. Sleeper projection access is experimental; projected bonuses may be incomplete.'}${missing.length?` Rare scoring that projections leave out: ${esc(missing.join(', '))}.`:''}</p></details>`;
}
export function analysisHeader(title,desc){return pageHead(title,desc,`<select class="select" aria-label="Analysis league" id="analysis-league">${leagueOptions(league()?.league_id)}</select>`)+projectionNote()}
export function playerPortrait(id,p,compact=false){
 // A defense has no face, so it wears its team's logo. Both fall back to initials if the image fails.
 const defense=p.position==='DEF',photoId=defense?(p.team?`logo-${p.team}`:null):S.data.demo?p.photo_id:id;
 const initials=defense?(p.team||'DEF'):pname(id).split(/\s+/).map(n=>n[0]).slice(0,2).join('');
 const photo=photoId&&!failedHeadshots.has(String(photoId));
 const src=defense?`https://sleepercdn.com/images/team_logos/nfl/${encodeURIComponent(String(p.team).toLowerCase())}.png`:`https://sleepercdn.com/content/nfl/players/${encodeURIComponent(photoId)}.jpg`;
 return `<div class="player-portrait${compact?' compact':''}"><span class="photo-fallback" aria-hidden="true">${esc(initials)}</span>${photo?`<img class="player-headshot${defense?' team-logo':''}" src="${src}" alt="${compact?'':`${esc(pname(id))} ${defense?'logo':'headshot'}`}" width="80" height="80" loading="lazy" decoding="async" data-photo-id="${esc(photoId)}">`:''}<span class="jersey" title="${defense?'Team defense':'Jersey number'}">${esc(p.number??(defense?'D':'—'))}</span></div>`;
}
// Face, jersey number and name for lists and tables. The name beside it labels the photo, so the image is decorative.
export function playerChip(id,detail='',heading='strong'){
 const p=id&&id!=='0'?S.data.players[id]:null;
 if(!p)return `<${heading}>${esc(!id||id==='0'?'Empty slot':pname(id))}</${heading}>${detail}`;
 return `<div class="player-chip" style="--team:${teamColors[p.team]||'#567587'}">${playerPortrait(id,p,true)}<div class="player-chip-text"><${heading}>${esc(pname(id))}</${heading}>${detail}</div></div>`;
}
export const failedHeadshots=new Set();
export const isLeagueView=()=>S.view==='league'||S.view==='scoreboard';
export const POSITION_COLORS={QB:'#2a78d6',RB:'#eb6834',WR:'#1baf7a',TE:'#eda100',K:'#e87ba4',DEF:'#4a3aa7',Other:'#8b989c'};
export const chance=(p,o)=>!Number.isFinite(p)?'—':o.weeksLeft&&p>.995?'>99%':o.weeksLeft&&p<.005?'<1%':`${Math.round(p*100)}%`;
export const record=r=>`${r.wins}-${r.losses}${r.ties?`-${r.ties}`:''}`;
export const ordinal=n=>`${n}${['th','st','nd','rd'][n%10>3||Math.floor(n/10)%10===1?0:n%10]}`;
export const teamCell=(r,note='')=>`<th scope="row" class="team-cell ${r.mine?'mine':''}"><strong>${esc(r.team)}</strong>${r.mine?' <span class="pill you">YOU</span>':''}<div class="muted small">${[r.manager?esc(r.manager):'',note].filter(Boolean).join(' · ')}</div></th>`;
export const oddsBar=(p,o,label)=>`<div class="odds" title="${esc(label)}"><span class="odds-track"><i style="width:${Math.round(p*100)}%"></i></span><strong>${chance(p,o)}</strong></div>`;
// An injury designation, colored by how likely he is to play: red when ruled out, orange when doubtful, yellow when questionable.
export function injury(player){const status=player?.injury_status;if(!status)return '';const tone=ruledOut(player)?'out':status==='Doubtful'?'doubtful':status==='Questionable'?'questionable':'other';return ` · <span class="injury injury-${tone}">${esc(status)}</span>`}
