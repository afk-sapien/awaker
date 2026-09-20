import {bad} from './settings.js';
const formatters=new Map();
export function localParts(at,zone){
 if(!formatters.has(zone))formatters.set(zone,new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}));
 const p=Object.fromEntries(formatters.get(zone).formatToParts(at).map(p=>[p.type,p.value]));
 return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`};
}
export function occurrence(at,schedule,zone,period){
 const {date,time}=localParts(at,zone),day=new Date(`${date}T12:00:00Z`);let back=time<schedule.time?1:0;
 if(period==='weekly'){back=(day.getUTCDay()-schedule.day+7)%7;if(back===0&&time<schedule.time)back=7}
 day.setUTCDate(day.getUTCDate()-back);return `${period}:${day.toISOString().slice(0,10)}:${schedule.time}:${zone}`;
}
export function nextRun(at,schedule,zone,period){
 if(!schedule.enabled)return null;
 const current=occurrence(at,schedule,zone,period);for(let t=Math.floor(at/60000)*60000+60000;t<at+8*86400000;t+=60000)if(occurrence(t,schedule,zone,period)>current)return t;
 return null;
}
export function quiet(at,settings){const t=localParts(at,settings.timezone).time,{quietStart:a,quietEnd:b}=settings.alerts;return a===b?false:a<b?t>=a&&t<b:t>=a||t<b}
// Each alert kind reads its own toggle and threshold, and links to its own view.
// Bench upgrades ride on the waiver scan, so either switch turns that scan on.
const alertOn=(settings,kind)=>kind==='waiver'?settings.alerts.waivers||settings.alerts.bench:settings.alerts[kinds[kind].on];
const kinds={trade:{on:'trades',min:'minGain',view:'trades'},waiver:{on:'waivers',min:'waiverMinGain',view:'waivers'}};
const eventKey=t=>JSON.stringify([t.leagueId,t.partnerId,t.give,t.get]);
const count=(n,one)=>`${n} ${one}${n===1?'':'s'}`;
export function createWorker({store,service,ntfy=null,publish=null,now=Date.now,publicUrl='http://127.0.0.1:4173'}){
 let running=false,manual=false,forced=false;
 // The destination is read at delivery time, so a change in Settings needs no restart.
 const notifier=ntfy||{configured:()=>!!publish,publish};
 const initial=()=>({runs:{},reports:[],outbox:[],events:{},baselines:{},reset:0,day:'',count:0,lastScan:0,failures:0});
 const link=(view,leagueId)=>`${publicUrl}/?view=${view}${leagueId?`&league=${encodeURIComponent(leagueId)}`:''}`;
 // Waiver rows come from the same engine as the waiver view. Several pickups that cost the
 // same drop are one decision, so only the best add for each drop counts as an opportunity.
 async function candidates(kind,settings,query={},options={}){
  const result=kind==='trade'?await service.trades({...query,limit:50},options):await service.opportunities({...query,horizon:settings.alerts.waiverHorizon},options),drops=new Set();
  // A trade is always searched over the rest of the season. "Next week" judges it by its first week alone.
  const nextWeek=settings.alerts.tradeHorizon==='next',tradeGain=t=>nextWeek?t.weekly?.[0]?.gainA??0:t.gain,span=result.weeks?.length>1?`points/week over weeks ${result.weeks[0]}–${result.weeks.at(-1)}`:result.horizon&&result.horizon!=='current'?`points in week ${result.weeks?.[0]}`:'points this week';
  const items=kind==='trade'?result.ideas.map(t=>({kind,key:eventKey(t),leagueId:t.leagueId,gain:tradeGain(t),line:`${t.league}: ${t.send.join(' + ')} for ${t.receive.join(' + ')}. Projected +${tradeGain(t).toFixed(1)} ${nextWeek?`points in week ${t.weekly?.[0]?.week}`:'points/week'}; partner +${(nextWeek?t.weekly?.[0]?.gainB??0:t.gainB/t.weeks).toFixed(1)}.`}))
   :result.opportunities.flatMap(l=>{
    const free=w=>!drops.has(`${l.leagueId}:${w.drop}`)&&drops.add(`${l.leagueId}:${w.drop}`);
    const starters=(settings.alerts.waivers?l.waivers:[]).filter(w=>w.status==='upgrade'&&free(w)).map(w=>({kind,key:JSON.stringify(['waiver',l.leagueId,w.id,w.drop]),leagueId:l.leagueId,gain:w.perWeek??w.gain,line:`${l.league}: add ${w.name}${w.dropName?`, drop ${w.dropName}`:''}. Projected +${(w.perWeek??w.gain).toFixed(1)} ${span}.`}));
    // Bench moves have their own bar, and only the best one per league is worth a push.
    const bench=settings.alerts.bench?l.waivers.filter(w=>w.status==='bench'&&w.benchPerWeek>=settings.alerts.benchMinGain&&free(w)).slice(0,1).map(w=>({kind,bench:true,key:JSON.stringify(['bench',l.leagueId,w.id,w.drop]),leagueId:l.leagueId,gain:w.benchPerWeek,line:`${l.league}: bench upgrade, add ${w.name}${w.dropName?` over ${w.dropName}`:''}. Projects +${w.benchPerWeek.toFixed(1)} more ${span}; would not start.`})):[];
    return [...starters,...bench];
   });
  return {ok:(result.dataComplete??result.complete)&&!result.demo,scope:`${result.season}:${result.week}`,generatedAt:result.generatedAt,warning:result.warnings?.[0]||null,items:items.filter(i=>i.bench||i.gain>=settings.alerts[kinds[kind].min])};
 }
 // One push per scan: a single opportunity reads as before, several become a short digest.
 function compose(items,generatedAt){
  const sorted=[...items].sort((a,b)=>b.gain-a.gain),trades=items.filter(i=>i.kind==='trade').length,waivers=items.length-trades,top=sorted[0];
  const same=items.every(i=>i.kind===top.kind),view=kinds[top.kind].view;
  return {title:items.length===1?(trades?'New trade opportunity':'New waiver pickup'):`Awaker: ${[trades&&count(trades,'trade'),waivers&&count(waivers,'waiver pickup')].filter(Boolean).join(', ')}`,
   message:[...sorted.slice(0,5).map(i=>i.line),...(sorted.length>5?[`+${sorted.length-5} more in Awaker.`]:[]),`Updated ${new Date(generatedAt).toISOString()}.`].join(items.length===1?' ':'\n'),
   url:link(view,same&&items.every(i=>i.leagueId===top.leagueId)||!same?top.leagueId:'')};
 }
 async function tick(){
  if(running)return;running=true;
  try{
   const settings=service.settings(),revision=JSON.stringify(settings),state=store.get('worker',initial()),loaded=JSON.stringify(state),at=now();
   if(!settings.username)return;
   // A failed run waits 2, 4, 8 … up to 60 minutes, so an outage is not polled every minute.
   if(!manual&&at<(state.retryAt||0))return;
   // State written before waiver alerts existed tracked one trade baseline.
   state.baselines??=state.baselined&&state.scope?{trade:state.scope}:{};
   const reset=store.get('scheduleReset',0);
   if(state.reset!==reset){state.reset=reset;state.baselines={};state.events={};state.outbox=state.outbox.map(o=>o.status==='pending'?{...o,status:'cancelled'}:o);state.runs=Object.fromEntries(['daily','weekly'].filter(p=>settings[p].enabled).map(p=>[p,occurrence(reset,settings[p],settings.timezone,p)]));state.lastScan=0}
   if(state.eventReset!==store.get('eventReset',0)){state.eventReset=store.get('eventReset',0);state.baselines={};state.events={};state.lastScan=0;state.outbox=state.outbox.map(o=>['alert','trade'].includes(o.type)&&o.status==='pending'?{...o,status:'cancelled'}:o)}
   const save=()=>{if(JSON.stringify(service.settings())!==revision)throw Error('Settings changed; worker will retry.');state.reports=state.reports.slice(0,50);state.outbox=state.outbox.slice(-100);store.set('worker',state)};
   for(const period of ['daily','weekly']){
    const config=settings[period];if(!config.enabled)continue;
    const key=occurrence(at,config,settings.timezone,period);
    if(!state.runs[period]){state.runs[period]=key;continue}
    if(state.runs[period]>=key)continue;
    const report=await service.digest({period});
    state.runs[period]=key;
    const send=notifier.configured()&&!report.demo,entry={id:key,period,createdAt:at,demo:report.demo,delivery:send?'pending':'archived',text:report.text,actions:(report.actions||[]).map(a=>({text:a.text}))};state.reports.unshift(entry);
    if(send)state.outbox.push({id:key,type:'digest',title:`Awaker ${period} report`,message:report.text,url:link('settings'),status:'pending',attempts:0,nextAttempt:at,expiresAt:at+86400000});
    save();
   }
   const day=localParts(at,settings.timezone).date;if(state.day!==day){state.day=day;state.count=0}
   const enabled=Object.keys(kinds).filter(kind=>alertOn(settings,kind));
   // A scan held back by quiet hours runs again as soon as they end, rather than a full interval later.
   if(enabled.length&&(manual||at-state.lastScan>=settings.alerts.scanHours*3600000||state.deferred&&!quiet(at,settings))){
    const fresh=Object.fromEntries(Object.entries(state.events).filter(([,v])=>at-(v.lastSeen||0)<7*86400000).map(([k,v])=>[k,{...v}])),picked=[],found=[],scan={at,manual,sent:0,held:null,kinds:{}};
    let generatedAt=at;state.lastScan=at;state.deferred=false;
    for(const kind of enabled){
     const result=await candidates(kind,settings);
     if(!result.ok){scan.kinds[kind]={skipped:true,warning:result.warning};continue}
     for(const v of Object.values(fresh))if((v.kind||'trade')===kind)v.active=false;
     // Only the very first scan is silent. A new week keeps its baseline, because waiver pickups
     // matter most right after the week turns and each opportunity is already sent once per key.
     const baseline=state.baselines[kind]!=null;let fresher=0;generatedAt=result.generatedAt||at;
     for(const c of result.items){
      const previous=state.events[c.key],qualified=!previous||previous.deferred||!previous.lastSent&&!previous.active||c.gain-previous.notifiedGain>=settings.alerts.improvement;
      fresh[c.key]={kind,active:true,lastSeen:at,gain:c.gain,notifiedGain:previous?.notifiedGain??c.gain,lastSent:previous?.lastSent||0};
      if(!baseline||!qualified)continue;
      if(at-(previous?.lastSent||0)<settings.alerts.cooldownHours*3600000)continue;
      fresher++;
      const held=quiet(at,settings)?'quiet':state.count>=settings.alerts.dailyCap?'cap':!notifier.configured()?'ntfy':null;
      if(held){fresh[c.key].deferred=true;scan.held??=held;continue}
      picked.push({...c,scope:result.scope});
     }
     state.baselines[kind]=result.scope;found.push(...result.items);
     scan.kinds[kind]={found:result.items.length,fresh:fresher,baseline:!baseline};
    }
    if(picked.length){
     state.outbox.push({id:`alert:${at}`,type:'alert',items:picked,...compose(picked,generatedAt),status:'pending',attempts:0,nextAttempt:at,expiresAt:at+6*3600000});
     for(const c of picked)Object.assign(fresh[c.key],{lastSent:at,notifiedGain:c.gain});
     state.count++;scan.sent=picked.length;
    }
    if(enabled.every(kind=>scan.kinds[kind]?.skipped))state.lastScan=at-settings.alerts.scanHours*3600000+900000;
    scan.top=found.sort((a,b)=>b.gain-a.gain).slice(0,3).map(i=>i.line);state.deferred=scan.held==='quiet';state.scan=scan;
    state.events=Object.fromEntries(Object.entries(fresh).sort((a,b)=>b[1].lastSeen-a[1].lastSeen).slice(0,500));
    save();
   }
   // Marked as sent when queued, so a push that never arrives must hand its opportunities back.
   const release=item=>{for(const i of item.items||[])if(state.events[i.key])state.events[i.key].deferred=true};
   for(const item of state.outbox.filter(o=>o.status==='pending'&&o.nextAttempt<=at)){
    if(item.expiresAt<=at){item.status='expired';release(item);const report=state.reports.find(r=>r.id===item.id);if(report)report.delivery='expired';continue}
    // Alerts queued by an earlier version cannot be rechecked in this format.
    if(item.type==='trade'){item.status='expired';continue}
    if(item.type==='alert'){
     if(quiet(at,settings))continue;
     // Recheck every league behind the digest and keep only what still qualifies.
     const kept=[];let generatedAt=at,unchecked=false;
     for(const kind of enabled)for(const leagueId of new Set(item.items.filter(i=>i.kind===kind).map(i=>i.leagueId))){
      try{
       const check=await candidates(kind,settings,{leagueId},forced?{}:{force:true});forced=true;
       if(!check.ok)unchecked=true;
       if(check.ok){generatedAt=check.generatedAt||at;kept.push(...check.items.filter(c=>item.items.some(i=>i.key===c.key&&i.scope===check.scope)).map(c=>({...c,scope:check.scope})))}
      }catch{unchecked=true}
     }
     // A recheck that could not run proves nothing. Try again shortly instead of discarding the alert.
     if(unchecked){item.nextAttempt=at+300000;continue}
     if(!kept.length){item.status=enabled.length?'expired':'cancelled';release(item);continue}
     Object.assign(item,{items:kept},compose(kept,generatedAt));
    }
    if(JSON.stringify(service.settings())!==revision)throw Error('Settings changed before delivery');
    if(!notifier.configured())continue;
    try{await notifier.publish(item);item.status='accepted';item.acceptedAt=now();item.error=null;const report=state.reports.find(r=>r.id===item.id);if(report)report.delivery='accepted'}catch{item.attempts++;item.error='Notification provider did not confirm acceptance.';item.status=item.attempts>=5?'failed':'pending';if(item.status==='failed')release(item);item.nextAttempt=at+Math.min(3600000,60000*2**item.attempts);const report=state.reports.find(r=>r.id===item.id);if(report)report.delivery=item.status}
    save();
   }
   state.failures=0;state.retryAt=0;state.lastError=null;if(JSON.stringify(state)!==loaded)save();store.set('workerLastRun',at);
  }catch(e){if(/^Settings changed/.test(e?.message||''))return;const s=store.get('worker',initial());s.failures++;s.retryAt=now()+Math.min(3600000,60000*2**Math.min(s.failures,6));s.lastError={at:now(),message:'Background run failed. Check data availability and service configuration.'};store.set('worker',s)}finally{running=false;forced=false}
 }
 // Runs the same scan the schedule would, right now. Baseline, quiet hours and the daily cap still apply.
 async function scan(){
  const alerts=service.settings().alerts;
  if(!alerts.trades&&!alerts.waivers&&!alerts.bench)throw bad('Turn on trade or waiver alerts, save, then scan.',409);
  if(running)throw bad('A background run is in progress. Try again in a moment.',409);
  manual=true;try{await tick()}finally{manual=false}
  return status();
 }
 function status(){const s=store.get('worker',initial()),config=service.settings(),on=config.alerts.trades||config.alerts.waivers||config.alerts.bench;return {...s,lastRun:store.get('workerLastRun',s.lastRun),events:undefined,outbox:s.outbox.map(({idea,items,...o})=>o),nextDaily:nextRun(now(),config.daily,config.timezone,'daily'),nextWeekly:nextRun(now(),config.weekly,config.timezone,'weekly'),nextScan:on?(s.lastScan||now())+(s.lastScan?config.alerts.scanHours*3600000:0):null,ntfyConfigured:notifier.configured(),injuryAlertsAvailable:false}}
 return {tick,scan,status};
}
