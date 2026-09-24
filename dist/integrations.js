import {getTheme,applyTheme} from './themes.js';
try{applyTheme(getTheme(localStorage.getItem('sunday-theme')).id)}catch{}
const $=id=>document.getElementById(id);let config,worker,push;
const icons={watch:'<rect x="3" y="4" width="18" height="14" rx="2"/><path d="m8 22 4-4 4 4M8 10h8M12 6v8"/>',waivers:'<path d="m3 17 6-6 4 3 8-10M15 4h6v6"/>',lineup:'<path d="M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1"/>',trades:'<path d="M3 7h18m-5-5 5 5-5 5M21 17H3m5-5-5 5 5 5"/>','trade-builder':'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 12h8m-4-4v8"/>',defenses:'<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6z"/>',season:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',scoreboard:'<rect x="3" y="3" width="18" height="7" rx="1.5"/><rect x="3" y="14" width="18" height="7" rx="1.5"/><path d="M7 6.5h6M7 17.5h4"/>',league:'<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3"/>',notifications:'<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 21a2 2 0 0 0 4 0"/>',settings:'<path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="2" fill="currentColor"/><circle cx="16" cy="12" r="2" fill="currentColor"/><circle cx="10" cy="18" r="2" fill="currentColor"/>'};
// The same playbook as the dashboard, as links because this is its own page.
$('side-nav').innerHTML=[['watch','Awaker watchroom'],['scoreboard','Around the league'],['waivers','Waiver wire'],['lineup','Start / sit'],['trades','Auto trades'],['trade-builder','Trade builder'],['defenses','Defense planner'],['season','Season review'],['league','League outlook'],['notifications','Notifications'],['settings','My leagues']].map(([id,label])=>`<a class="nav-btn ${id==='notifications'?'active':''}" ${id==='notifications'?'aria-current="page" href="/integrations.html"':`href="/?view=${id}"`}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons[id]}</svg>${label}</a>`).join('');
function notice(text,error=false,saved=false){$('notice').textContent=text;$('notice').classList.toggle('error',error);$('notice').classList.toggle('saved',saved);$('page-notice').textContent=text;$('page-notice').hidden=!text||!$('connected').hidden}
async function api(path,method='GET',body){const response=await fetch('/api/v1'+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});let data;try{data=await response.json()}catch{throw Error('The background service is not running, so nothing can be scheduled.')}if(response.status===401){$('login-panel').hidden=false;$('connected').hidden=true;throw Error(path==='/session'&&data.error?data.error:'Sign in with your owner token.')}if(!response.ok)throw Error(data.error||'Request failed.');return data}
const date=at=>at?new Date(at).toLocaleString([], {timeZone:config.timezone,weekday:'short',hour:'numeric',minute:'2-digit'}):'Off';
const textFields=new Set(['quiet-start','quiet-end','trade-horizon','waiver-horizon']);
const alertFields=[['bench-min-gain','benchMinGain'],['trade-horizon','tradeHorizon'],['waiver-horizon','waiverHorizon'],['scan-hours','scanHours'],['min-gain','minGain'],['waiver-min-gain','waiverMinGain'],['improvement','improvement'],['cooldown','cooldownHours'],['daily-cap','dailyCap'],['quiet-start','quietStart'],['quiet-end','quietEnd']];
function fill(){
 $('username-setting').textContent=config.username;$('account-pill').textContent=config.username;$('account-pill').hidden=!config.username;$('timezone').value=config.timezone;
 for(const period of ['daily','weekly']){$(period+'-enabled').checked=config[period].enabled;$(period+'-time').value=config[period].time}$('weekly-day').value=config.weekly.day;
 $('trade-alerts').checked=config.alerts.trades;$('bench-alerts').checked=config.alerts.bench;$('waiver-alerts').checked=config.alerts.waivers;for(const [id,key]of alertFields)$(id).value=config.alerts[key];
}
const subscribeUrl=()=>`${$('ntfy-url').value.trim().replace(/\/$/,'')||'https://ntfy.sh'}/${$('ntfy-topic').value.trim()}`;
function subscribe(){const topic=$('ntfy-topic').value.trim();$('ntfy-subscribe').hidden=!topic;$('ntfy-subscribe-url').textContent=topic?subscribeUrl():''}
function phone(){
 $('ntfy-url').value=push.url;$('ntfy-topic').value=push.topic;$('ntfy-token').value='';$('ntfy-clear-token').checked=false;$('ntfy-clear-row').hidden=!push.tokenSet;$('ntfy-token').placeholder=push.tokenSet?'A token is saved. Leave blank to keep it.':'Not needed on ntfy.sh';
 $('ntfy-reset').hidden=push.source!=='saved';$('test').disabled=!push.configured;subscribe();
 $('status-phone').textContent=push.configured?push.subscribeUrl.replace(/^https?:\/\//,''):'Not set up';$('status-phone').parentElement.classList.toggle('ok',push.configured);
 $('status-phone-note').textContent=push.configured?(push.source==='environment'?'From this server’s environment':push.tokenSet?'Using a saved access token':'Ready'):'Alerts and summaries are only saved here';
}
const kindText={trade:['trade','trades'],waiver:['pickup','pickups']},held={quiet:'Held for quiet hours',cap:'Daily limit reached, waiting',ntfy:'Set up your phone to receive it'};
function status(){
 const scan=worker.scan,on=config.alerts.trades||config.alerts.waivers||config.alerts.bench;$('scan-found').replaceChildren();$('scan').disabled=!on;
 $('status-next').textContent=on?date(worker.nextScan):'Off';$('status-next-note').textContent=on?'':'Turn on an alert below';
 if(!scan||!on){$('status-last').textContent=on?'Not yet':'Off';$('status-last-note').textContent=on?'The first check only records what already exists':'';return}
 $('status-last').textContent=date(scan.at);
 const found=Object.entries(scan.kinds).map(([kind,r])=>r.skipped?`${kindText[kind][1]} skipped, data incomplete`:`${r.found} ${kindText[kind][r.found===1?0:1]}`).join(' · ');
 const first=Object.values(scan.kinds).some(r=>r.baseline);
 $('status-last-note').textContent=`${found}. ${scan.sent?`Sent ${scan.sent} new.`:scan.held?held[scan.held]+'.':first?'Recorded as the starting point.':'Nothing new.'}`;
 for(const line of scan.top||[]){const li=document.createElement('li');li.textContent=line;$('scan-found').append(li)}
}
// Every push the worker queued, newest first, readable here without the phone. Expired and
// cancelled ones never left the server, so they are not shown. Open entries stay open on refresh.
const stamp=at=>new Date(at).toLocaleString([], {timeZone:config.timezone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const sentState={pending:'Sending',failed:'Not delivered'};let sentShown=10;
// Links carry the server's public address, which may not be the one this page was opened on.
const here=url=>{try{const u=new URL(url);return u.pathname+u.search}catch{return '/'}};
function sent(){
 const open=new Set([...$('sent-list').querySelectorAll('details[open]')].map(d=>d.dataset.id)),items=worker.outbox.filter(o=>o.status in sentState||o.status==='accepted').reverse();
 $('sent-list').replaceChildren();$('sent-more').hidden=items.length<=sentShown;
 if(!items.length)$('sent-list').textContent=push.configured?'Nothing sent yet.':'Nothing sent yet. Set up your phone below to start receiving notifications.';
 for(const item of items.slice(0,sentShown)){
  const d=document.createElement('details'),summary=document.createElement('summary'),title=document.createElement('strong'),when=document.createElement('span'),pre=document.createElement('pre'),a=document.createElement('a');
  d.dataset.id=item.id;d.open=open.has(item.id);title.textContent=item.title;when.className='muted small';when.textContent=stamp(item.acceptedAt||item.createdAt||item.nextAttempt);summary.append(title,when);
  if(item.status!=='accepted'){const tag=document.createElement('span');tag.className=`tag ${item.status}`;tag.textContent=item.error&&item.status==='pending'?'Retrying':sentState[item.status];summary.append(tag)}
  pre.textContent=item.message;a.href=here(item.url);a.textContent='Open in Awaker';d.append(summary,pre,a);$('sent-list').append(d);
 }
}
function activity(){
 status();sent();
 $('worker-status').textContent=worker.lastError?`${worker.lastError.message} Last tried ${date(worker.lastError.at)}.`:`Running. Last pass ${date(worker.lastRun)}. Next daily ${date(worker.nextDaily)}, next weekly ${date(worker.nextWeekly)}.`;
 $('reports').replaceChildren();
 for(const report of worker.reports){const d=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');summary.textContent=`${report.period[0].toUpperCase()+report.period.slice(1)} summary · ${date(report.createdAt)} · ${report.delivery}`;pre.textContent=report.text;d.append(summary,pre);$('reports').append(d)}
}
async function load(){const result=await api('/settings');config=result.settings;worker=result.worker;push=result.notifications;fill();phone();activity();$('login-panel').hidden=true;$('connected').hidden=false;$('logout').hidden=!result.authRequired;if(config.username){try{const {data}=await api('/client');const on=data.leagues.filter(l=>l.enabled&&!config.disabled.includes(l.league_id));$('league-list').textContent=on.length?on.map(l=>l.name).join(' · '):'No leagues are turned on.'}catch{}}}
$('login').addEventListener('submit',async e=>{e.preventDefault();const button=e.currentTarget.querySelector('button');if(button.disabled)return;button.disabled=true;try{await api('/session','POST',{token:$('owner-token').value});$('owner-token').value='';await load();notice('')}catch(e){notice(e.message,true)}finally{button.disabled=false}});
// Every change saves itself, so there is no Save button and nothing to forget. Phone fields save
// once the topic is valid, and everything else saves as one settings update.
const phoneFields=new Set(['ntfy-url','ntfy-topic','ntfy-token','ntfy-clear-token']);let saving=Promise.resolve();const timers=new Map();
async function savePhone(){
 const topic=$('ntfy-topic').value.trim(),url=$('ntfy-url').value.trim(),token=$('ntfy-token').value,clear=$('ntfy-clear-token').checked;
 if(!topic)return notice(push.source==='saved'?'Use “Turn off phone notifications” to remove the topic.':'Add a topic to get notifications on your phone.');
 if(!$('ntfy-topic').checkValidity()||!$('ntfy-url').checkValidity())return notice('Topics use letters, digits, hyphens and underscores. The server is a web address.',true);
 const next={url,topic};if(token)next.token=token;else if(clear)next.token='';
 push=(await api('/notifications','PUT',next)).notifications;worker.ntfyConfigured=push.configured;phone();notice('Saved. Subscribe to the topic in the ntfy app, then send a test.',false,true);
}
async function saveSettings(){
 const form=$('settings-form'),invalid=[...form.querySelectorAll(':invalid')].find(el=>!phoneFields.has(el.id));
 if(invalid){invalid.closest('details')?.setAttribute('open','');invalid.reportValidity();return notice('Fix the highlighted value to save.',true)}
 const alerts={trades:$('trade-alerts').checked,waivers:$('waiver-alerts').checked,bench:$('bench-alerts').checked};for(const [id,key]of alertFields)alerts[key]=textFields.has(id)?$(id).value:Number($(id).value);
 const result=await api('/settings','PUT',{timezone:$('timezone').value.trim(),daily:{enabled:$('daily-enabled').checked,time:$('daily-time').value},weekly:{enabled:$('weekly-enabled').checked,time:$('weekly-time').value,day:Number($('weekly-day').value)},alerts});
 config=result.settings;worker=(await api('/settings')).worker;activity();notice('Saved',false,true);
}
$('settings-form').addEventListener('submit',e=>e.preventDefault());
$('settings-form').addEventListener('change',e=>{const task=phoneFields.has(e.target.id)?savePhone:saveSettings;clearTimeout(timers.get(task));timers.set(task,setTimeout(()=>{notice('Saving…');saving=saving.then(task).catch(error=>notice(error.message,true))},250))});
for(const [id,period]of [['preview','daily'],['preview-weekly','weekly']])$(id).addEventListener('click',async()=>{$(id).disabled=true;notice('Writing the preview…');try{const report=await api('/digests/preview','POST',{period});$('preview-content').hidden=false;$('preview-content').textContent=report.text;notice('Preview ready. Nothing was sent.')}catch(e){notice(e.message,true)}finally{$(id).disabled=false}});
$('ntfy-generate').addEventListener('click',()=>{const bytes=crypto.getRandomValues(new Uint8Array(12));$('ntfy-topic').value='awaker-'+btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_');subscribe();$('ntfy-topic').dispatchEvent(new Event('change',{bubbles:true}))});
for(const id of ['ntfy-url','ntfy-topic'])$(id).addEventListener('input',subscribe);
$('ntfy-reset').addEventListener('click',async()=>{try{push=(await api('/notifications','DELETE')).notifications;phone();notice(push.configured?'Removed. Using this server’s environment again.':'Phone notifications are off.')}catch(e){notice(e.message,true)}});
$('test').addEventListener('click',async()=>{$('test').disabled=true;try{await api('/notifications/test','POST',{});notice('Test sent. Check your phone.')}catch(e){notice(`Test failed: ${e.message}`,true)}finally{$('test').disabled=!push.configured}});
$('scan').addEventListener('click',async()=>{$('scan').disabled=true;notice('Checking trades and waivers. This can take a minute…');try{worker=(await api('/scan','POST',{})).worker;activity();notice(worker.lastError?worker.lastError.message:'Check finished.',!!worker.lastError)}catch(e){notice(e.message,true)}finally{$('scan').disabled=false}});
$('sent-more').addEventListener('click',()=>{sentShown+=20;sent()});
const refresh=async(quiet=false)=>{try{worker=(await api('/settings')).worker;activity()}catch(e){if(!quiet)notice(e.message,true)}};
$('sent-reload').addEventListener('click',()=>refresh());
// New pushes show up while the page is open, without a reload. Hidden tabs and sign-in screens skip the poll.
setInterval(()=>{if(!document.hidden&&worker&&!$('connected').hidden)refresh(true)},60000);
$('reload').addEventListener('click',()=>refresh());
$('logout').addEventListener('click',async()=>{try{await api('/session','DELETE');location.reload()}catch(e){notice(e.message,true)}});
load().catch(e=>notice(e.message,true));
