const $=id=>document.getElementById(id);let config,worker,push;
function notice(text){$('notice').textContent=text}
async function api(path,method='GET',body){const response=await fetch('/api/v1'+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});let data;try{data=await response.json()}catch{throw Error('Background service unavailable. Start npm run service; static hosting cannot run scheduled updates.')}if(response.status===401){$('login-panel').hidden=false;$('connected').hidden=true;throw Error('Sign in with your owner token.')}if(!response.ok)throw Error(data.error||'Request failed.');return data}
const date=at=>at?new Date(at).toLocaleString([], {timeZone:config.timezone}):'Off';
function fill(){
 $('username-setting').textContent=config.username;$('excluded').value=config.disabled.join(', ');$('timezone').value=config.timezone;
 for(const period of ['daily','weekly']){$(period+'-enabled').checked=config[period].enabled;$(period+'-time').value=config[period].time}$('weekly-day').value=config.weekly.day;
 $('trade-alerts').checked=config.alerts.trades;$('waiver-alerts').checked=config.alerts.waivers;for(const [id,key]of [['scan-hours','scanHours'],['min-gain','minGain'],['waiver-min-gain','waiverMinGain'],['improvement','improvement'],['cooldown','cooldownHours'],['daily-cap','dailyCap'],['quiet-start','quietStart'],['quiet-end','quietEnd']])$(id).value=config.alerts[key];
}
const subscribeUrl=()=>`${$('ntfy-url').value.trim().replace(/\/$/,'')||'https://ntfy.sh'}/${$('ntfy-topic').value.trim()}`;
function subscribe(){$('ntfy-subscribe').textContent=$('ntfy-topic').value.trim()?`Subscribe on your phone: ${subscribeUrl()}`:''}
function notifications(){
 $('ntfy-url').value=push.url;$('ntfy-topic').value=push.topic;$('ntfy-token').value='';$('ntfy-clear-token').checked=false;$('ntfy-clear-token').parentElement.hidden=!push.tokenSet;$('ntfy-token').placeholder=push.tokenSet?'A token is saved. Leave blank to keep it.':'Not needed on ntfy.sh';
 $('ntfy-status').textContent=push.configured?`Notifications go to ${push.subscribeUrl}${push.tokenSet?' using a saved access token':''}${push.source==='environment'?', from this server’s environment. Saving here takes over.':'.'}`:'Notifications are off. Scheduled reports are still archived here.';
 $('test').disabled=!push.configured;$('ntfy-reset').hidden=push.source!=='saved';subscribe();
}
const kindText={trade:['trade','trades'],waiver:['waiver pickup','waiver pickups']},held={quiet:'Quiet hours are holding the notification until they end.',cap:'Today’s notification limit is reached, so it waits for the next scan.',ntfy:'Set up phone notifications to have it sent.'};
function scanSummary(){
 const scan=worker.scan,on=config.alerts.trades||config.alerts.waivers;$('scan-found').replaceChildren();$('scan').disabled=!on;
 if(!on){$('scan-status').textContent='Opportunity scans are off. Turn on trade or waiver alerts above.';return}
 if(!scan){$('scan-status').textContent=`No scan yet. Next scan: ${date(worker.nextScan)}.`;return}
 const parts=Object.entries(scan.kinds).map(([kind,r])=>r.skipped?`${kindText[kind][1]} skipped because data was incomplete${r.warning?` (${r.warning})`:''}`:`${r.found} ${kindText[kind][r.found===1?0:1]} over your threshold, ${r.baseline?'recorded as the starting point':`${r.fresh} new`}`);
 $('scan-status').textContent=`Last scan ${date(scan.at)}${scan.manual?' (manual)':''}: ${parts.join('; ')}. ${scan.sent?`Sent one notification covering ${scan.sent}.`:scan.held?held[scan.held]:'Nothing new to send.'} Next scan: ${date(worker.nextScan)}.`;
 for(const line of scan.top||[]){const li=document.createElement('li');li.textContent=line;$('scan-found').append(li)}
}
function activity(){
 scanSummary();
 $('schedule-status').textContent=`Next daily: ${date(worker.nextDaily)} · Next weekly: ${date(worker.nextWeekly)} (${config.timezone})`;
 $('worker-status').textContent=worker.lastError?`${worker.lastError.message} Last attempted ${date(worker.lastError.at)}.`:`Last background run: ${date(worker.lastRun)}. Schedules are checked every minute.`;
 $('delivery-status').replaceChildren();for(const item of worker.outbox.slice(-5).reverse()){const p=document.createElement('p');p.textContent=`${item.title}: ${item.status}${item.error?' · '+item.error:''}`;$('delivery-status').append(p)}
 $('reports').replaceChildren();if(!worker.reports.length)$('reports').textContent='No reports yet. Enable a schedule or preview a report above.';
 for(const report of worker.reports){const d=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');summary.textContent=`${report.period} · ${date(report.createdAt)} · ${report.delivery}`;pre.textContent=report.text;d.append(summary,pre);$('reports').append(d)}
}
async function load(){const result=await api('/settings');config=result.settings;worker=result.worker;push=result.notifications;fill();notifications();activity();$('login-panel').hidden=true;$('connected').hidden=false;$('logout').hidden=!result.authRequired;notice(result.authRequired?'Connected. Save changes to update your background service.':'Save changes to update your background service.');if(config.username){try{const {data}=await api('/client');$('league-list').textContent=data.leagues.map(l=>`${l.name}: ${l.league_id}`).join(' · ')}catch(e){notice(e.message)}}}
$('login').addEventListener('submit',async e=>{e.preventDefault();try{await api('/session','POST',{token:$('owner-token').value});$('owner-token').value='';await load()}catch(e){notice(e.message)}});
$('settings-form').addEventListener('submit',async e=>{e.preventDefault();$('save').disabled=true;try{
 const next={...config,username:config.username,disabled:$('excluded').value.split(',').map(x=>x.trim()).filter(Boolean),timezone:$('timezone').value.trim(),daily:{enabled:$('daily-enabled').checked,time:$('daily-time').value},weekly:{enabled:$('weekly-enabled').checked,time:$('weekly-time').value,day:Number($('weekly-day').value)},alerts:{trades:$('trade-alerts').checked,waivers:$('waiver-alerts').checked,scanHours:Number($('scan-hours').value),minGain:Number($('min-gain').value),waiverMinGain:Number($('waiver-min-gain').value),improvement:Number($('improvement').value),cooldownHours:Number($('cooldown').value),dailyCap:Number($('daily-cap').value),quietStart:$('quiet-start').value,quietEnd:$('quiet-end').value}};
 await api('/settings','PUT',next);await load();notice('Settings saved. Your schedules work while the browser is closed.');
 }catch(e){notice(e.message)}finally{$('save').disabled=false}});
$('import').addEventListener('click',()=>{try{const p=JSON.parse(localStorage.getItem('sunday-preferences')||'{}');if(!p.username)throw Error('No connected Sleeper account is saved in this browser.');config.disabled=p.disabled||[];config.preferences=Object.fromEntries(['tradeMinGain','tradeMaxGap','tradeEndWeek','tradePenalty','tradeExcluded','waiverExcluded','waiverProtected','protectStarters','samePositionDrops','waiverUpgradesOnly','requireBenefit'].filter(k=>k in p).map(k=>[k,p[k]]));if(!config.preferences.waiverExcluded&&p.waiverIncluded)config.preferences.waiverExcluded={add:['QB','RB','WR','TE','K','DEF'].filter(x=>!p.waiverIncluded.includes(x)),drop:[]};fill();notice('Analysis preferences imported. Save settings to apply them.')}catch(e){notice(e.message)}});
for(const [id,period]of [['preview','daily'],['preview-weekly','weekly']])$(id).addEventListener('click',async()=>{$(id).disabled=true;notice('Loading report data…');try{const report=await api('/digests/preview','POST',{period});$('preview-content').hidden=false;$('preview-content').textContent=report.text;notice('Preview ready. No notification was sent.')}catch(e){notice(e.message)}finally{$(id).disabled=false}});
$('ntfy-generate').addEventListener('click',()=>{const bytes=crypto.getRandomValues(new Uint8Array(12));$('ntfy-topic').value='awaker-'+btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_');subscribe();notice('Topic generated. Save notifications, then subscribe to it in the ntfy app.')});
for(const id of ['ntfy-url','ntfy-topic'])$(id).addEventListener('input',subscribe);
$('ntfy-form').addEventListener('submit',async e=>{e.preventDefault();$('ntfy-save').disabled=true;try{
 const next={url:$('ntfy-url').value.trim(),topic:$('ntfy-topic').value.trim()};if($('ntfy-token').value)next.token=$('ntfy-token').value;else if($('ntfy-clear-token').checked)next.token='';
 push=(await api('/notifications','PUT',next)).notifications;worker.ntfyConfigured=push.configured;notifications();notice(`Notifications saved. Subscribe to ${push.subscribeUrl} on your phone, then send a test.`);
 }catch(e){notice(e.message)}finally{$('ntfy-save').disabled=false}});
$('ntfy-reset').addEventListener('click',async()=>{try{push=(await api('/notifications','DELETE')).notifications;notifications();notice(push.configured?'Saved settings removed. Using this server’s environment again.':'Notifications turned off.')}catch(e){notice(e.message)}});
$('test').addEventListener('click',async()=>{$('test').disabled=true;try{await api('/notifications/test','POST',{});notice(`ntfy accepted the test notification for ${push.subscribeUrl}. It uses your saved settings. Check your subscribed device.`)}catch(e){notice(`Test failed: ${e.message}`)}finally{$('test').disabled=false}});
$('scan').addEventListener('click',async()=>{$('scan').disabled=true;notice('Scanning trades and waivers. This can take a minute…');try{worker=(await api('/scan','POST',{})).worker;activity();notice(worker.lastError?worker.lastError.message:'Scan finished.')}catch(e){notice(e.message)}finally{$('scan').disabled=false}});
$('reload').addEventListener('click',async()=>{try{const result=await api('/settings');worker=result.worker;activity();notice('Activity refreshed.')}catch(e){notice(e.message)}});
$('logout').addEventListener('click',async()=>{try{await api('/session','DELETE');location.reload()}catch(e){notice(e.message)}});
load().catch(e=>notice(e.message));
