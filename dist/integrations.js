const $=id=>document.getElementById(id);let config,worker,push;
const icons={watch:'<rect x="3" y="4" width="18" height="14" rx="2"/><path d="m8 22 4-4 4 4M8 10h8M12 6v8"/>',waivers:'<path d="m3 17 6-6 4 3 8-10M15 4h6v6"/>',lineup:'<path d="M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1"/>',trades:'<path d="M3 7h18m-5-5 5 5-5 5M21 17H3m5-5-5 5 5 5"/>','trade-builder':'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 12h8m-4-4v8"/>',defenses:'<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6z"/>',notifications:'<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 21a2 2 0 0 0 4 0"/>',settings:'<path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="2" fill="currentColor"/><circle cx="16" cy="12" r="2" fill="currentColor"/><circle cx="10" cy="18" r="2" fill="currentColor"/>'};
// The same playbook as the dashboard, as links because this is its own page.
$('side-nav').innerHTML=[['watch','Awaker watchroom'],['waivers','Waiver wire'],['lineup','Start / sit'],['trades','Auto trades'],['trade-builder','Trade builder'],['defenses','Defense planner'],['notifications','Notifications'],['settings','My leagues']].map(([id,label])=>`<a class="nav-btn ${id==='notifications'?'active':''}" ${id==='notifications'?'aria-current="page" href="/integrations.html"':`href="/?view=${id}"`}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons[id]}</svg>${label}</a>`).join('');
function notice(text,error=false){$('notice').textContent=text;$('notice').classList.toggle('error',error);$('page-notice').textContent=text;$('page-notice').hidden=!text||!$('connected').hidden}
async function api(path,method='GET',body){const response=await fetch('/api/v1'+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});let data;try{data=await response.json()}catch{throw Error('The background service is not running, so nothing can be scheduled.')}if(response.status===401){$('login-panel').hidden=false;$('connected').hidden=true;throw Error('Sign in with your owner token.')}if(!response.ok)throw Error(data.error||'Request failed.');return data}
const date=at=>at?new Date(at).toLocaleString([], {timeZone:config.timezone,weekday:'short',hour:'numeric',minute:'2-digit'}):'Off';
const alertFields=[['scan-hours','scanHours'],['min-gain','minGain'],['waiver-min-gain','waiverMinGain'],['improvement','improvement'],['cooldown','cooldownHours'],['daily-cap','dailyCap'],['quiet-start','quietStart'],['quiet-end','quietEnd']];
function fill(){
 $('username-setting').textContent=config.username;$('account-pill').textContent=config.username;$('account-pill').hidden=!config.username;$('excluded').value=config.disabled.join(', ');$('timezone').value=config.timezone;
 for(const period of ['daily','weekly']){$(period+'-enabled').checked=config[period].enabled;$(period+'-time').value=config[period].time}$('weekly-day').value=config.weekly.day;
 $('trade-alerts').checked=config.alerts.trades;$('waiver-alerts').checked=config.alerts.waivers;for(const [id,key]of alertFields)$(id).value=config.alerts[key];
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
 const scan=worker.scan,on=config.alerts.trades||config.alerts.waivers;$('scan-found').replaceChildren();$('scan').disabled=!on;
 $('status-next').textContent=on?date(worker.nextScan):'Off';$('status-next-note').textContent=on?'':'Turn on an alert below';
 if(!scan||!on){$('status-last').textContent=on?'Not yet':'Off';$('status-last-note').textContent=on?'The first check only records what already exists':'';return}
 $('status-last').textContent=date(scan.at);
 const found=Object.entries(scan.kinds).map(([kind,r])=>r.skipped?`${kindText[kind][1]} skipped, data incomplete`:`${r.found} ${kindText[kind][r.found===1?0:1]}`).join(' · ');
 const first=Object.values(scan.kinds).some(r=>r.baseline);
 $('status-last-note').textContent=`${found}. ${scan.sent?`Sent ${scan.sent} new.`:scan.held?held[scan.held]+'.':first?'Recorded as the starting point.':'Nothing new.'}`;
 for(const line of scan.top||[]){const li=document.createElement('li');li.textContent=line;$('scan-found').append(li)}
}
function activity(){
 status();
 $('worker-status').textContent=worker.lastError?`${worker.lastError.message} Last tried ${date(worker.lastError.at)}.`:`Running. Last pass ${date(worker.lastRun)}. Next daily ${date(worker.nextDaily)}, next weekly ${date(worker.nextWeekly)}.`;
 $('delivery-status').replaceChildren();for(const item of worker.outbox.slice(-5).reverse()){const p=document.createElement('p'),title=document.createElement('span'),state=document.createElement('span');title.textContent=item.title;state.className='state';state.textContent=item.error?`${item.status} · ${item.error}`:item.status;p.append(title,state);$('delivery-status').append(p)}
 $('reports').replaceChildren();
 for(const report of worker.reports){const d=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');summary.textContent=`${report.period[0].toUpperCase()+report.period.slice(1)} summary · ${date(report.createdAt)} · ${report.delivery}`;pre.textContent=report.text;d.append(summary,pre);$('reports').append(d)}
 if(!worker.outbox.length&&!worker.reports.length)$('delivery-status').textContent='Nothing sent yet.';
}
async function load(){const result=await api('/settings');config=result.settings;worker=result.worker;push=result.notifications;fill();phone();activity();$('login-panel').hidden=true;$('connected').hidden=false;$('logout').hidden=!result.authRequired;if(config.username){try{const {data}=await api('/client');$('league-list').textContent=data.leagues.map(l=>`${l.name}: ${l.league_id}`).join(' · ')}catch{}}}
$('login').addEventListener('submit',async e=>{e.preventDefault();try{await api('/session','POST',{token:$('owner-token').value});$('owner-token').value='';await load();notice('')}catch(e){notice(e.message,true)}});
// One Save: phone settings go first so a failed address never leaves alerts pointing nowhere new.
$('settings-form').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget;
 if(!form.checkValidity()){form.querySelectorAll('details').forEach(d=>{if(d.querySelector(':invalid'))d.open=true});form.reportValidity();return}
 $('save').disabled=true;notice('Saving…');try{
 const topic=$('ntfy-topic').value.trim(),url=$('ntfy-url').value.trim(),token=$('ntfy-token').value,clear=$('ntfy-clear-token').checked;
 if(topic&&(topic!==push.topic||(url||'https://ntfy.sh').replace(/\/$/,'')!==push.url||token||clear||push.source!=='saved')){const next={url,topic};if(token)next.token=token;else if(clear)next.token='';push=(await api('/notifications','PUT',next)).notifications}
 const alerts={trades:$('trade-alerts').checked,waivers:$('waiver-alerts').checked};for(const [id,key]of alertFields)alerts[key]=id.startsWith('quiet')?$(id).value:Number($(id).value);
 await api('/settings','PUT',{...config,disabled:$('excluded').value.split(',').map(x=>x.trim()).filter(Boolean),timezone:$('timezone').value.trim(),daily:{enabled:$('daily-enabled').checked,time:$('daily-time').value},weekly:{enabled:$('weekly-enabled').checked,time:$('weekly-time').value,day:Number($('weekly-day').value)},alerts});
 await load();notice(push.configured?'Saved. Awaker keeps working while this page is closed.':'Saved. Add a topic above to get these on your phone.');
 }catch(e){notice(e.message,true)}finally{$('save').disabled=false}});
$('import').addEventListener('click',()=>{try{const p=JSON.parse(localStorage.getItem('sunday-preferences')||'{}');config.disabled=p.disabled||config.disabled;config.preferences=Object.fromEntries(['tradeMinGain','tradeMaxGap','tradeEndWeek','tradePenalty','tradeExcluded','waiverExcluded','waiverProtected','protectStarters','samePositionDrops','waiverUpgradesOnly','requireBenefit'].filter(k=>k in p).map(k=>[k,p[k]]));if(!config.preferences.waiverExcluded&&p.waiverIncluded)config.preferences.waiverExcluded={add:['QB','RB','WR','TE','K','DEF'].filter(x=>!p.waiverIncluded.includes(x)),drop:[]};fill();notice('Filters copied from this browser. Save changes to use them.')}catch(e){notice(e.message,true)}});
for(const [id,period]of [['preview','daily'],['preview-weekly','weekly']])$(id).addEventListener('click',async()=>{$(id).disabled=true;notice('Writing the preview…');try{const report=await api('/digests/preview','POST',{period});$('preview-content').hidden=false;$('preview-content').textContent=report.text;notice('Preview ready. Nothing was sent.')}catch(e){notice(e.message,true)}finally{$(id).disabled=false}});
$('ntfy-generate').addEventListener('click',()=>{const bytes=crypto.getRandomValues(new Uint8Array(12));$('ntfy-topic').value='awaker-'+btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_');subscribe();notice('New topic ready. Save changes, then subscribe to it in the ntfy app.')});
for(const id of ['ntfy-url','ntfy-topic'])$(id).addEventListener('input',subscribe);
$('ntfy-reset').addEventListener('click',async()=>{try{push=(await api('/notifications','DELETE')).notifications;phone();notice(push.configured?'Removed. Using this server’s environment again.':'Phone notifications are off.')}catch(e){notice(e.message,true)}});
$('test').addEventListener('click',async()=>{$('test').disabled=true;try{await api('/notifications/test','POST',{});notice('Test sent. Check your phone.')}catch(e){notice(`Test failed: ${e.message}`,true)}finally{$('test').disabled=!push.configured}});
$('scan').addEventListener('click',async()=>{$('scan').disabled=true;notice('Checking trades and waivers. This can take a minute…');try{worker=(await api('/scan','POST',{})).worker;activity();notice(worker.lastError?worker.lastError.message:'Check finished.',!!worker.lastError)}catch(e){notice(e.message,true)}finally{$('scan').disabled=false}});
$('reload').addEventListener('click',async()=>{try{worker=(await api('/settings')).worker;activity()}catch(e){notice(e.message,true)}});
$('logout').addEventListener('click',async()=>{try{await api('/session','DELETE');location.reload()}catch(e){notice(e.message,true)}});
load().catch(e=>notice(e.message,true));
