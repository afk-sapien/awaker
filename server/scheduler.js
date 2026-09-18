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
export function createWorker({store,service,publish=null,now=Date.now,publicUrl='http://127.0.0.1:4173'}){
 let running=false;
 const initial=()=>({runs:{},reports:[],outbox:[],events:{},baselined:false,reset:0,day:'',count:0,lastScan:0,failures:0});
 const link=(view,leagueId)=>`${publicUrl}/?view=${view}${leagueId?`&league=${encodeURIComponent(leagueId)}`:''}`;
 const eventKey=t=>JSON.stringify([t.leagueId,t.partnerId,t.give,t.get]);
 async function tick(){
  if(running)return;running=true;
  try{
   const settings=service.settings(),revision=JSON.stringify(settings),state=store.get('worker',initial()),at=now();
   if(!settings.username)return;
   const reset=store.get('scheduleReset',0);
   if(state.reset!==reset){state.reset=reset;state.baselined=false;state.events={};state.outbox=state.outbox.map(o=>o.status==='pending'?{...o,status:'cancelled'}:o);state.runs=Object.fromEntries(['daily','weekly'].filter(p=>settings[p].enabled).map(p=>[p,occurrence(reset,settings[p],settings.timezone,p)]));state.lastScan=0}
   if(state.eventReset!==store.get('eventReset',0)){state.eventReset=store.get('eventReset',0);state.baselined=false;state.events={};state.lastScan=0;state.outbox=state.outbox.map(o=>o.type==='trade'&&o.status==='pending'?{...o,status:'cancelled'}:o)}
   const save=()=>{if(JSON.stringify(service.settings())!==revision)throw Error('Settings changed; worker will retry.');state.reports=state.reports.slice(0,50);state.outbox=state.outbox.slice(-100);store.set('worker',state)};
   for(const period of ['daily','weekly']){
    const config=settings[period];if(!config.enabled)continue;
    const key=occurrence(at,config,settings.timezone,period);
    if(!state.runs[period]){state.runs[period]=key;continue}
    if(state.runs[period]>=key)continue;
    const report=await service.digest({period});
    state.runs[period]=key;
    const entry={...report,id:key,createdAt:at,delivery:publish&&!report.demo?'pending':'archived'};state.reports.unshift(entry);
    if(publish&&!report.demo)state.outbox.push({id:key,type:'digest',title:`Sunday ${period} report`,message:report.text,url:link('settings'),status:'pending',attempts:0,nextAttempt:at,expiresAt:at+86400000});
    save();
   }
   const day=localParts(at,settings.timezone).date;if(state.day!==day){state.day=day;state.count=0}
   if(settings.alerts.trades&&at-state.lastScan>=900000){
    const result=await service.trades({limit:50});state.lastScan=at;
    if(result.complete&&!result.demo){
     const fresh=Object.fromEntries(Object.entries(state.events).filter(([,v])=>at-(v.lastSeen||0)<7*86400000).map(([k,v])=>[k,{...v,active:false}])),scope=`${result.season}:${result.week}`,baseline=state.baselined&&state.scope===scope;
     for(const t of result.ideas.filter(t=>t.gain>=settings.alerts.minGain)){
      const key=eventKey(t),previous=state.events[key],qualified=!previous?.active||t.gain-previous.notifiedGain>=settings.alerts.improvement;
      fresh[key]={active:true,lastSeen:at,gain:t.gain,notifiedGain:previous?.notifiedGain??t.gain,lastSent:previous?.lastSent||0};
      if(baseline&&qualified&&!quiet(at,settings)&&at-(previous?.lastSent||0)>=settings.alerts.cooldownHours*3600000&&state.count<settings.alerts.dailyCap&&publish){
       const id=`trade:${scope}:${key}:${at}`;
       state.outbox.push({id,type:'trade',event:key,idea:t,scope,title:'New trade opportunity',message:`${t.league}: ${t.send.join(' + ')} for ${t.receive.join(' + ')}. Projected +${t.gain.toFixed(1)} points/week; partner +${(t.gainB/t.weeks).toFixed(1)}. Updated ${new Date(result.generatedAt).toISOString()}.`,url:link('trades',t.leagueId),status:'pending',attempts:0,nextAttempt:at,expiresAt:at+6*3600000});
       fresh[key].lastSent=at;fresh[key].notifiedGain=t.gain;state.count++;
      }else if(baseline&&qualified){fresh[key].notifiedGain=previous?.notifiedGain??0}
     }
     state.events=Object.fromEntries(Object.entries(fresh).sort((a,b)=>b[1].lastSeen-a[1].lastSeen).slice(0,500));state.baselined=true;state.scope=scope;
    }
    save();
   }
   for(const item of state.outbox.filter(o=>o.status==='pending'&&o.nextAttempt<=at)){
    if(item.expiresAt<=at){item.status='expired';const report=state.reports.find(r=>r.id===item.id);if(report)report.delivery='expired';continue}
    if(item.type==='trade'){
     if(!settings.alerts.trades){item.status='cancelled';continue}
     if(quiet(at,settings))continue;
     try{
      const check=await service.trades({leagueId:item.idea.leagueId,limit:50},{force:true});
      const match=check.ideas.find(t=>eventKey(t)===item.event);
      if(!check.complete||check.demo||`${check.season}:${check.week}`!==item.scope||!match||match.gain<settings.alerts.minGain){item.status='expired';continue}
      item.message=`${match.league}: ${match.send.join(' + ')} for ${match.receive.join(' + ')}. Projected +${match.gain.toFixed(1)} points/week; partner +${(match.gainB/match.weeks).toFixed(1)}. Updated ${new Date(check.generatedAt).toISOString()}.`;
     }catch{item.status='expired';continue}
    }
    if(JSON.stringify(service.settings())!==revision)throw Error('Settings changed before delivery');
    try{await publish(item);item.status='accepted';item.acceptedAt=now();item.error=null;const report=state.reports.find(r=>r.id===item.id);if(report)report.delivery='accepted'}catch{item.attempts++;item.error='Notification provider did not confirm acceptance.';item.status=item.attempts>=5?'failed':'pending';item.nextAttempt=at+Math.min(3600000,60000*2**item.attempts);const report=state.reports.find(r=>r.id===item.id);if(report)report.delivery=item.status}
    save();
   }
   state.failures=0;state.lastRun=at;state.lastError=null;save();
  }catch(e){const s=store.get('worker',initial());s.failures++;s.lastError={at:now(),message:'Background run failed. Check data availability and service configuration.'};store.set('worker',s)}finally{running=false}
 }
 function status(){const s=store.get('worker',initial()),config=service.settings();return {...s,events:undefined,outbox:s.outbox.map(({idea,...o})=>o),nextDaily:nextRun(now(),config.daily,config.timezone,'daily'),nextWeekly:nextRun(now(),config.weekly,config.timezone,'weekly'),ntfyConfigured:!!publish,injuryAlertsAvailable:false}}
 return {tick,status};
}
