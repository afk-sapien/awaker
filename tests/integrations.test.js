import {spawn} from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {openStore} from '../server/store.js';
import {createService} from '../server/service.js';
import {validateSettings,defaults} from '../server/settings.js';
import {createWorker,occurrence,nextRun,quiet} from '../server/scheduler.js';
import {createNtfy,validateNtfy} from '../server/ntfy.js';
import {createMcpHandler} from '../server/mcp.js';
import {createHttpServer} from '../server/http.js';
import {contracts,validate} from '../server/contracts.js';
import {demo} from '../dist/demo.js';
import {buildSeasonModel} from '../dist/trades.js';
import {findTradeIdeas,waiverRows,futureWaiverRows} from '../dist/analysis.js';
const owner='a'.repeat(40),agent='b'.repeat(40);
function fixture(at=Date.now()){
 const d=demo();d.updatedAt=at;d.sources=[{name:'fixture',fetchedAt:at,maxAgeMs:3600000,sourceUpdatedAt:null}];
 d.outlook={weeks:[3,4],data:Object.fromEntries([3,4].map(w=>[w,{projections:d.projections[w],games:d.games}])),loadedAt:at,errors:[]};return d;
}
function harness(){let at=Date.parse('2026-09-18T07:59:00Z'),calls=0,ideas=[],waivers=[];const store=openStore(':memory:');let config=validateSettings({username:'example',timezone:'UTC',daily:{enabled:true,time:'08:00'},alerts:{trades:true,scanHours:1,quietStart:'00:00',quietEnd:'00:00'}});
 const service={settings:()=>config,opportunities:async()=>({season:'2026',week:2,complete:true,demo:false,warnings:[],generatedAt:at,opportunities:[{leagueId:'1',league:'League',waivers}]}),digest:async({period})=>({period,text:'Report',actions:[],demo:false}),trades:async()=>({season:'2026',week:2,complete:true,demo:false,ideas,generatedAt:at})};
 const deliveries=[],publish=async item=>{calls++;deliveries.push(structuredClone(item))};
 const worker=createWorker({store,service,publish,now:()=>at});
 return {store,service,worker,deliveries,get calls(){return calls},get at(){return at},set at(v){at=v},set ideas(v){ideas=v},set waivers(v){waivers=v},set config(v){config=v},publish};
}
const hour=3600000,alerting=(alerts={})=>validateSettings({username:'example',timezone:'UTC',alerts:{trades:true,scanHours:1,quietStart:'00:00',quietEnd:'00:00',...alerts}});
const pickup=(gain=4,id='w1',drop='d1')=>({id,drop,gain,status:'upgrade',name:id.toUpperCase(),dropName:drop?.toUpperCase()});
const idea=(gain=4)=>({leagueId:'1',league:'League',partnerId:2,give:['a'],get:['b'],send:['A'],receive:['B'],gain,gainA:gain*5,gainB:15,weeks:5});

test('settings reject invalid schedules, preserve disabled defaults, and only import supported preferences',()=>{
 assert.equal(defaults.daily.enabled,false);assert.equal(defaults.alerts.trades,false);
 assert.throws(()=>validateSettings({timezone:'not/a/zone'}));assert.throws(()=>validateSettings({daily:{time:'25:01'}}));assert.throws(()=>validateSettings({alerts:{dailyCap:2.5}}));
 assert.equal(validateSettings({preferences:{username:'ignored',tradeMinGain:3}}).preferences.username,undefined);
 for(const c of contracts)assert.throws(()=>validate({unexpected:true},c.inputSchema));
 assert.throws(()=>validate({leagueId:'1',partnerId:2,give:['a','a'],get:['b']},contracts[2].inputSchema));
});
test('SQLite persists committed state across restart and rolls back failed transaction',()=>{
 const dir=mkdtempSync(join(tmpdir(),'sunday-store-'));try{let s=openStore(join(dir,'test.sqlite'));s.set('state',{a:1});assert.throws(()=>s.transaction(()=>{s.set('state',{a:2});throw Error()}));s.close();s=openStore(join(dir,'test.sqlite'));assert.deepEqual(s.get('state'),{a:1});s.close()}finally{rmSync(dir,{recursive:true})}
});
test('agent service reuses UI calculations, prevents excluded leagues, and marks stale data',async()=>{
 const store=openStore(':memory:');let at=Date.now();const data=fixture(at),service=createService({store,provider:async()=>data,now:()=>at});service.saveSettings({username:'example'});
 const result=await service.trades({leagueId:data.leagues[0].league_id});
 const expected=await findTradeIdeas(data,data.leagues[0],buildSeasonModel({league:data.leagues[0],players:data.players,outlook:data.outlook}),{}, {limit:10});
 assert.deepEqual(result.ideas.map(r=>r.give),expected.ideas.map(r=>r.give));
 const opp=await service.opportunities({leagueId:data.leagues[0].league_id});assert.deepEqual(opp.opportunities[0].waivers.map(w=>[w.id,w.gain,w.drop]),waiverRows(data,data.leagues[0]).map(w=>[w.id,w.gain,w.drop]));
 await assert.rejects(service.status({leagueId:'secret'}),/unavailable or excluded/);
 service.saveSettings({disabled:[data.leagues[0].league_id]});await assert.rejects(service.status({leagueId:data.leagues[0].league_id}),/excluded/);
 at+=7200000;assert.equal((await service.status()).complete,false);store.close();
});
test('MCP negotiates, validates tools, and preview calls cannot send notifications',async()=>{
 const calls=[],handle=createMcpHandler({call:async(c,input)=>{calls.push(c.call);return {period:input.period||'daily'}}});
 assert.equal((await handle({jsonrpc:'2.0',id:0,method:'tools/list'})).error.code,-32000);
 const init=await handle({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',clientInfo:{name:'test',version:'1'},capabilities:{}}});assert.equal(init.result.protocolVersion,'2025-11-25');
 assert.equal(await handle({jsonrpc:'2.0',method:'notifications/initialized'}),null);
 // Named rather than counted: a tool that reaches an agent unnoticed is the failure worth catching.
 const list=await handle({jsonrpc:'2.0',id:2,method:'tools/list'});assert.ok(list.result.tools.every(t=>t.annotations.readOnlyHint));
 assert.deepEqual(list.result.tools.map(t=>t.name),['get_status','find_trades','evaluate_trade','get_opportunities','preview_digest','get_recap']);
 const bad=await handle({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'evaluate_trade',arguments:{}}});assert.equal(bad.error.code,-32602);
 const report=await handle({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'preview_digest',arguments:{period:'weekly'}}});assert.equal(report.result.structuredContent.period,'weekly');assert.deepEqual(calls,['digest']);
});
test('the recap grades a finished week and degrades to a warning when a past week cannot be read',async()=>{
 const store=openStore(':memory:'),at=Date.now(),data=fixture(at),league=data.leagues[0];
 const provider=async()=>data;
 provider.history=async(season,leagueId,weeks)=>({season,leagueId,weeks,errors:[],data:{1:{matchups:league.matchups,
  transactions:[{type:'waiver',status:'complete',roster_ids:[1],adds:{'99901':1},drops:{'4035':1},settings:{waiver_bid:12},created:1}],
  stats:{},projections:data.projections[2]}}});
 const service=createService({store,provider,now:()=>at});service.saveSettings({username:'example'});
 const result=await service.recap({leagueId:league.league_id});
 assert.equal(result.recapWeek,1,'defaults to the week that just finished');
 const mine=result.recaps[0].rows.find(r=>r.rosterId===1);
 assert.ok(mine.best>=mine.started,'the hindsight lineup is never worse than the one that was set');
 assert.equal(mine.left,Math.round((mine.best-mine.started)*100)/100);
 assert.ok(mine.decisions.every(d=>d.satName&&(d.played===null||d.playedName)),'a decision names the players it is about');
 assert.equal(result.recaps[0].names[league.mine.starters[0]],'Josh Allen','lineups resolve through the name table');
 const claim=result.recaps[0].moves.rows[0];
 assert.deepEqual([claim.bid,claim.adds[0].name,claim.drops[0].name,claim.label],[12,'Jordan Mason','George Kittle','unused bid']);
 // The pick of the week is read straight out of the summary, so it has to carry names like any other row.
 assert.equal(result.recaps[0].moves.summary.best.adds[0].name,'Jordan Mason');
 await assert.rejects(service.recap({week:9}),/has not been played/);
 store.close();
});
test('a server that cannot read past weeks says so instead of inventing a recap',async()=>{
 const store=openStore(':memory:'),service=createService({store,provider:async()=>fixture()});service.saveSettings({username:'example'});
 await assert.rejects(service.recap({}),/cannot read past weeks/);store.close();
});
test('HTTP isolates agent and owner access, rejects hostile origins, and supports owner cookie login',async()=>{
 const store=openStore(':memory:'),service=createService({store,provider:async()=>fixture()});service.saveSettings({username:'example'});
 const worker=createWorker({store,service});const port=18473,base=`http://127.0.0.1:${port}`,server=createHttpServer({service,worker,adminToken:owner,agentToken:agent,publicUrl:base,dist:resolve('dist')});
 await new Promise(r=>server.listen(port,'127.0.0.1',r));
 try{
  assert.equal((await fetch(base+'/api/v1/status')).status,401);
  assert.equal((await fetch(base+'/api/v1/settings',{headers:{Authorization:`Bearer ${agent}`}})).status,403);
  assert.equal((await fetch(base+'/api/v1/status',{headers:{Authorization:`Bearer ${agent}`,Origin:'https://evil.example'}})).status,403);
  assert.equal((await fetch(base+'/api/v1/status?leagueId=secret',{headers:{Authorization:`Bearer ${agent}`}})).status,404);
  assert.equal((await fetch(base+'/api/v1/status',{headers:{Authorization:`Bearer ${agent}`}})).status,200);
  const login=await fetch(base+'/api/v1/session',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({token:owner})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(base+'/api/v1/settings',{headers:{Cookie:cookie}})).status,200);
  assert.equal((await fetch(base+'/api/v1/settings',{method:'PUT',headers:{Cookie:cookie},body:'{}'})).status,403);
  const update=await fetch(base+'/api/v1/settings',{method:'PUT',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({daily:{enabled:true,time:'09:00'}})});assert.equal(update.status,200);
  assert.equal((await fetch(base+'/integrations.html')).status,200);
  const messages=[{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',clientInfo:{name:'smoke',version:'1'},capabilities:{}}},{jsonrpc:'2.0',method:'notifications/initialized'},{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'get_status',arguments:{}}}];
  const child=spawn(process.execPath,['server/mcp.js'],{env:{...process.env,SUNDAY_API_URL:base,SUNDAY_AGENT_TOKEN:agent},stdio:['pipe','pipe','pipe']});let output='',err='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>err+=b);child.stdin.end(messages.map(m=>JSON.stringify(m)).join('\n')+'\n');
  const code=await new Promise((resolve,reject)=>{child.on('exit',resolve);child.on('error',reject)});assert.equal(code,0,err);const replies=output.trim().split('\n').map(s=>JSON.parse(s));assert.equal(replies.length,2);assert.equal(replies[1].result.structuredContent.schemaVersion,1);assert.equal(replies[1].result.structuredContent.leagues.length,3);

 }finally{await new Promise(r=>server.close(r));store.close()}
});
test('daily digest persists occurrence across worker restart and coalesces missed dates',async()=>{
 const h=harness();await h.worker.tick();assert.equal(h.calls,0);h.at+=60000;await h.worker.tick();assert.equal(h.calls,1);
 const restarted=createWorker({store:h.store,service:h.service,publish:h.publish,now:()=>h.at});await restarted.tick();assert.equal(h.calls,1);
 h.at+=3*86400000;await restarted.tick();assert.equal(h.calls,2);assert.equal(restarted.status().reports.length,2);h.store.close();
});
test('DST repeated hour has one occurrence; skipped time runs after transition; weekly day is local',()=>{
 const s={enabled:true,time:'01:30'};assert.equal(occurrence(Date.parse('2026-11-01T08:45:00Z'),s,'America/Los_Angeles','daily'),occurrence(Date.parse('2026-11-01T09:45:00Z'),s,'America/Los_Angeles','daily'));
 assert.equal(nextRun(Date.parse('2026-03-08T09:59:00Z'),{enabled:true,time:'02:30'},'America/Los_Angeles','daily'),Date.parse('2026-03-08T10:00:00Z'));
 const weekly={enabled:true,time:'08:00',day:2};assert.match(occurrence(Date.parse('2026-09-22T16:00:00Z'),weekly,'America/Los_Angeles','weekly'),/2026-09-22/);
 assert.equal(quiet(Date.parse('2026-09-18T23:00:00Z'),validateSettings({timezone:'UTC'})),true);
});
test('event baseline stays quiet, a new opportunity alerts once, and stale/demo data do not alert',async()=>{
 const h=harness();h.config=alerting();await h.worker.tick();
 h.ideas=[idea()];h.at+=900000;await h.worker.tick();assert.equal(h.calls,0,'a scan is not due before the interval');
 h.at+=hour;await h.worker.tick();assert.equal(h.calls,1);assert.equal(h.deliveries[0].title,'New trade opportunity');assert.match(h.deliveries[0].message,/^League: A for B\. Projected \+4\.0 points\/week; partner \+3\.0\. Updated /);
 h.at+=hour;await h.worker.tick();assert.equal(h.calls,1);
 const prev=h.service.trades;h.service.trades=async()=>({...await prev(),complete:false,ideas:[idea(10)]});h.at+=7*3600000;await h.worker.tick();assert.equal(h.calls,1);
 h.service.trades=async()=>({...await prev(),demo:true,ideas:[idea(10)]});h.at+=hour;await h.worker.tick();assert.equal(h.calls,1);h.store.close();
});
test('failed pushes retry durably and expired opportunities are not delivered',async()=>{
 const h=harness();let attempts=0;const worker=createWorker({store:h.store,service:h.service,now:()=>h.at,publish:async()=>{attempts++;throw Error('offline')}});
 await worker.tick();h.at+=60000;await worker.tick();assert.equal(attempts,1);assert.equal(worker.status().outbox[0].status,'pending');
 await worker.tick();assert.equal(attempts,1);h.at+=120000;await worker.tick();assert.equal(attempts,2);
 h.at+=86400000;h.config=validateSettings({username:'example'});await worker.tick();assert.equal(worker.status().outbox[0].status,'expired');h.store.close();
});
test('ntfy keeps token in authorization, marks provider acceptance, and rejects insecure remote URL',async()=>{
 let sent;const store=openStore(':memory:'),fetcher=async(...args)=>{sent=args;return {ok:true}};
 const ntfy=createNtfy({store,env:{NTFY_URL:'https://ntfy.example',NTFY_TOPIC:'private',NTFY_TOKEN:'secret'},fetcher});
 assert.deepEqual(await ntfy.publish({type:'alert',title:'Trade',message:'Useful',url:'https://sunday.example/?view=trades'}),{accepted:true});assert.equal(sent[1].headers.Authorization,'Bearer secret');assert.equal(JSON.parse(sent[1].body).priority,4);assert.equal(sent[1].body.includes('secret'),false);
 assert.throws(()=>createNtfy({store,env:{NTFY_URL:'http://ntfy.example',NTFY_TOPIC:'x',NTFY_TOKEN:'secret'}}),/HTTPS/);assert.equal(createNtfy({store,env:{}}).configured(),false);
 await assert.rejects(createNtfy({store,env:{}}).publish({title:'x',message:'y'}),/not configured/);store.close();
});
test('ntfy needs only a topic: the server defaults to ntfy.sh and the token is optional in the environment and in saved settings',async()=>{
 let sent;const store=openStore(':memory:'),fetcher=async(...args)=>{sent=args;return {ok:true}};
 const ntfy=createNtfy({store,env:{NTFY_TOPIC:'from-env'},fetcher});
 assert.deepEqual(ntfy.describe(),{configured:true,source:'environment',url:'https://ntfy.sh',topic:'from-env',tokenSet:false,subscribeUrl:'https://ntfy.sh/from-env'});
 await ntfy.publish({type:'test',title:'T',message:'M',url:'u'});assert.equal(sent[0].href,'https://ntfy.sh/');assert.equal('Authorization'in sent[1].headers,false);assert.equal(JSON.parse(sent[1].body).topic,'from-env');
 // Saved settings win over the environment and apply to the very next delivery.
 assert.equal(ntfy.save({url:'https://push.example/',topic:'awaker-abc_123',token:'tk_secret'}).source,'saved');
 await ntfy.publish({type:'test',title:'T',message:'M',url:'u'});assert.equal(sent[0].href,'https://push.example/');assert.equal(sent[1].headers.Authorization,'Bearer tk_secret');assert.equal(JSON.parse(sent[1].body).topic,'awaker-abc_123');
 // They survive a restart, and forgetting them falls back to the environment.
 const restarted=createNtfy({store,env:{NTFY_TOPIC:'from-env'},fetcher});assert.equal(restarted.describe().topic,'awaker-abc_123');assert.equal(restarted.reset().topic,'from-env');
 assert.equal(createNtfy({store,env:{NTFY_URL:'https://ntfy.example',NTFY_TOKEN:'orphan'}}).configured(),false);store.close();
});
test('the ntfy token is write-only, kept when omitted, cleared on request, and never sent to a different server',()=>{
 const store=openStore(':memory:'),ntfy=createNtfy({store,env:{}});
 const saved=ntfy.save({topic:'topic-1',token:'tk_secret'});assert.deepEqual(saved,{configured:true,source:'saved',url:'https://ntfy.sh',topic:'topic-1',tokenSet:true,subscribeUrl:'https://ntfy.sh/topic-1'});
 assert.equal(JSON.stringify([saved,ntfy.describe()]).includes('tk_secret'),false);
 assert.equal(ntfy.save({topic:'topic-2'}).tokenSet,true);assert.equal(store.get('ntfy').token,'tk_secret');
 assert.equal(ntfy.save({url:'https://other.example',topic:'topic-2'}).tokenSet,false,'a changed server drops the token');
 ntfy.save({url:'https://other.example',topic:'topic-2',token:'tk_other'});assert.equal(ntfy.save({url:'https://other.example',topic:'topic-2',token:''}).tokenSet,false);
 // An environment token follows the same rule once settings are saved in the browser.
 const env={NTFY_URL:'https://ntfy.example',NTFY_TOPIC:'t',NTFY_TOKEN:'env_secret'},second=openStore(':memory:');
 assert.equal(createNtfy({store:second,env}).save({url:'https://ntfy.example',topic:'renamed'}).tokenSet,true);second.set('ntfy',null);
 assert.equal(createNtfy({store:second,env}).save({url:'https://elsewhere.example',topic:'renamed'}).tokenSet,false);assert.equal(second.get('ntfy').token,'');
 store.close();second.close();
});
test('ntfy settings keep the URL and topic safety rules',()=>{
 for(const url of ['http://ntfy.example','ftp://ntfy.example','https://user:pass@ntfy.example','https://ntfy.example/?x=1','https://ntfy.example/#x','not a url',12])assert.throws(()=>validateNtfy({url,topic:'ok'}),/ntfy/,String(url));
 for(const topic of ['','has space','a/b','x'.repeat(101),undefined,5])assert.throws(()=>validateNtfy({topic}),/topic/);
 for(const token of ['has space','x'.repeat(301),5,'naïve'])assert.throws(()=>validateNtfy({topic:'ok',token}),/token/);
 assert.equal(validateNtfy({url:'http://127.0.0.1:8080',topic:'ok'}).url,'http://127.0.0.1:8080');assert.equal(validateNtfy({url:'',topic:'ok'}).url,'https://ntfy.sh');
 const store=openStore(':memory:'),ntfy=createNtfy({store,env:{}});
 for(const input of [null,[],{topic:'ok',extra:1},JSON.parse('{"topic":"ok","__proto__":{}}')])assert.throws(()=>ntfy.save(input),/Unknown notification setting/);
 assert.equal(ntfy.configured(),false);store.close();
});
test('the worker resolves the ntfy destination at delivery time, so saving it needs no restart',async()=>{
 const h=harness(),sent=[],ntfy=createNtfy({store:h.store,env:{},fetcher:async(url,options)=>{sent.push([url.href,JSON.parse(options.body).topic]);return {ok:true}}});
 const worker=createWorker({store:h.store,service:h.service,ntfy,now:()=>h.at});
 assert.equal(worker.status().ntfyConfigured,false);await worker.tick();h.at+=60000;await worker.tick();assert.equal(sent.length,0);assert.equal(worker.status().reports[0].delivery,'archived');
 ntfy.save({topic:'first'});assert.equal(worker.status().ntfyConfigured,true);h.at+=86400000;await worker.tick();assert.deepEqual(sent.at(-1),['https://ntfy.sh/','first']);
 ntfy.save({url:'https://push.example',topic:'second'});h.at+=86400000;await worker.tick();assert.deepEqual(sent.at(-1),['https://push.example/','second']);assert.equal(JSON.stringify(worker.status()).includes('second'),false);h.store.close();
});
test('settings accept the supported scan intervals and separate trade and waiver thresholds',()=>{
 assert.deepEqual([defaults.alerts.scanHours,defaults.alerts.waivers,defaults.alerts.waiverMinGain],[6,false,3]);
 for(const scanHours of [1,3,6,12,24])assert.equal(validateSettings({alerts:{scanHours}}).alerts.scanHours,scanHours);
 for(const scanHours of [0,2,.25,48,'6'])assert.throws(()=>validateSettings({alerts:{scanHours}}),/scan interval/);
 assert.throws(()=>validateSettings({alerts:{waivers:'yes'}}));assert.throws(()=>validateSettings({alerts:{waiverMinGain:0}}),/waiverMinGain/);
 // Settings saved before these fields existed pick up the defaults instead of failing validation.
 const {waivers,waiverMinGain,scanHours,...old}=defaults.alerts,upgraded=validateSettings({timezone:'UTC'},{...defaults,alerts:old});assert.deepEqual(upgraded.alerts,defaults.alerts);
 const store=openStore(':memory:');store.set('settings',{...defaults,username:'example',alerts:{...old,trades:true}});const service=createService({store,provider:async()=>fixture()});
 assert.equal(service.settings().alerts.scanHours,6);assert.equal(service.saveSettings({alerts:{waivers:true}}).alerts.trades,true);store.close();
});
test('scans follow the configured interval and report when the next one is due',async()=>{
 const h=harness();let scans=0;const prev=h.service.trades;h.service.trades=async(...a)=>{scans++;return prev(...a)};h.config=alerting({scanHours:6});
 await h.worker.tick();assert.equal(scans,1);assert.equal(h.worker.status().nextScan,h.at+6*hour);
 h.at+=5*hour;await h.worker.tick();assert.equal(scans,1);h.at+=hour;await h.worker.tick();assert.equal(scans,2);
 assert.deepEqual(h.worker.status().scan.kinds,{trade:{found:0,fresh:0,baseline:false}});
 h.config=validateSettings({username:'example',timezone:'UTC'});assert.equal(h.worker.status().nextScan,null);h.store.close();
});
test('waiver alerts baseline quietly, alert once per add and drop, and re-alert only on improvement',async()=>{
 const h=harness();h.config=alerting({trades:false,waivers:true,waiverMinGain:2});h.waivers=[pickup(5,'old')];
 await h.worker.tick();assert.equal(h.calls,0);assert.deepEqual(h.worker.status().scan.kinds.waiver,{found:1,fresh:0,baseline:true});
 // Below the waiver threshold, and a worse add for a drop that is already covered, are not opportunities.
 h.waivers=[pickup(5,'old'),pickup(4,'new','d2'),pickup(3.5,'alt','d2'),pickup(1.5,'weak','d3'),{...pickup(9,'none','d4'),status:'no_gain'}];h.at+=hour;await h.worker.tick();
 assert.equal(h.calls,1);assert.equal(h.deliveries[0].title,'New waiver pickup');assert.match(h.deliveries[0].message,/^League: add NEW, drop D2\. Projected \+4\.0 points this week\. Updated /);assert.match(h.deliveries[0].url,/\?view=waivers&league=1$/);
 h.at+=7*hour;await h.worker.tick();assert.equal(h.calls,1);
 h.waivers=[pickup(5,'old'),pickup(5,'new','d2')];h.at+=7*hour;await h.worker.tick();assert.equal(h.calls,1,'+1 is below the improvement threshold');
 h.waivers=[pickup(5,'old'),pickup(6.5,'new','d2')];h.at+=7*hour;await h.worker.tick();assert.equal(h.calls,2);
 // The same add with a different drop is its own opportunity.
 h.waivers=[pickup(5,'old'),pickup(6.5,'new','d2'),pickup(4,'new','d9')];h.at+=hour;await h.worker.tick();assert.equal(h.calls,3);assert.match(h.deliveries[2].message,/drop D9/);h.store.close();
});
test('incomplete waiver data does not disturb trade alerts or the waiver baseline',async()=>{
 const h=harness();h.config=alerting({waivers:true});h.waivers=[pickup(5)];await h.worker.tick();
 const prev=h.service.opportunities;h.service.opportunities=async()=>({...await prev(),complete:false,warnings:['League: incomplete lineup projections']});
 h.ideas=[idea()];h.at+=hour;await h.worker.tick();assert.equal(h.calls,1);assert.equal(h.deliveries[0].title,'New trade opportunity');
 assert.deepEqual(h.worker.status().scan.kinds.waiver,{skipped:true,warning:'League: incomplete lineup projections'});
 h.service.opportunities=prev;h.at+=hour;await h.worker.tick();assert.equal(h.calls,1,'the pickup seen before the outage is still not new');h.store.close();
});
test('several new opportunities in one scan become a single digest push',async()=>{
 const h=harness();h.config=alerting({waivers:true});await h.worker.tick();
 h.ideas=[idea(4),{...idea(7),partnerId:3,send:['C'],receive:['D']}];h.waivers=[pickup(5)];h.at+=hour;await h.worker.tick();
 assert.equal(h.calls,1);const push=h.deliveries[0];assert.equal(push.title,'Awaker: 2 trades, 1 waiver pickup');assert.equal(push.type,'alert');
 assert.deepEqual(push.message.split('\n').map(l=>l.slice(0,22)),['League: C for D. Proje','League: add W1, drop D','League: A for B. Proje','Updated 2026-09-18T08:']);
 assert.match(push.url,/\?view=trades&league=1$/);assert.equal(h.worker.status().scan.sent,3);assert.equal(h.worker.status().outbox[0].items,undefined);
 // Six or more keep the body short, and a digest counts once against the daily cap.
 h.waivers=[pickup(5),...Array.from({length:7},(_,i)=>pickup(3+i/10,`p${i}`,`q${i}`))];h.at+=hour;await h.worker.tick();
 assert.equal(h.calls,2);assert.equal(h.deliveries[1].title,'Awaker: 7 waiver pickups');assert.match(h.deliveries[1].message,/\+2 more in Awaker\./);assert.match(h.deliveries[1].url,/\?view=waivers&league=1$/);
 assert.equal(h.store.get('worker').count,2);h.store.close();
});
test('quiet hours hold a digest until they end and the daily cap defers to the next day',async()=>{
 const h=harness();h.config=alerting({waivers:true,quietStart:'09:30',quietEnd:'11:15',dailyCap:1,scanHours:6});await h.worker.tick();
 h.at=Date.parse('2026-09-18T10:00:00Z');h.store.set('worker',{...h.store.get('worker'),lastScan:0});h.ideas=[idea()];await h.worker.tick();
 assert.equal(h.calls,0);assert.equal(h.worker.status().scan.held,'quiet');
 // No scan is due for hours, but the held opportunity goes out in the first minute after quiet hours.
 h.at=Date.parse('2026-09-18T11:14:00Z');await h.worker.tick();assert.equal(h.calls,0);
 h.at=Date.parse('2026-09-18T11:15:00Z');await h.worker.tick();assert.equal(h.calls,1);
 h.waivers=[pickup(6)];h.at+=6*hour;await h.worker.tick();assert.equal(h.calls,1);assert.equal(h.worker.status().scan.held,'cap');
 h.at=Date.parse('2026-09-19T00:30:00Z');await h.worker.tick();assert.equal(h.calls,2);assert.equal(h.deliveries[1].title,'New waiver pickup');h.store.close();
});
test('a queued digest is rechecked before delivery and drops what no longer qualifies',async()=>{
 const h=harness();let online=false;const sent=[],worker=createWorker({store:h.store,service:h.service,now:()=>h.at,publish:async item=>{if(!online)throw Error('offline');sent.push(structuredClone(item))}});
 h.config=alerting({waivers:true});await worker.tick();h.ideas=[idea()];h.waivers=[pickup(5)];h.at+=hour;await worker.tick();assert.equal(worker.status().outbox[0].status,'pending');
 h.ideas=[];online=true;h.at+=120000;await worker.tick();assert.equal(sent.length,1);assert.equal(sent[0].title,'New waiver pickup');assert.equal(sent[0].items.length,1);
 online=false;h.waivers=[pickup(5),pickup(6,'late','d5')];h.at+=hour;await worker.tick();h.waivers=[];online=true;h.at+=120000;await worker.tick();
 assert.equal(sent.length,1);assert.equal(worker.status().outbox.at(-1).status,'expired');h.store.close();
});
test('scan now runs immediately, keeps the baseline rule, and refuses when alerts are off',async()=>{
 const h=harness();h.config=alerting();h.ideas=[idea()];
 let status=await h.worker.scan();assert.equal(status.scan.manual,true);assert.deepEqual(status.scan.kinds.trade,{found:1,fresh:0,baseline:true});assert.equal(h.calls,0);assert.deepEqual(status.scan.top,['League: A for B. Projected +4.0 points/week; partner +3.0.']);
 h.ideas=[idea(),{...idea(6),partnerId:3}];h.at+=60000;status=await h.worker.scan();assert.equal(status.scan.sent,1);assert.equal(h.calls,1);assert.equal(status.nextScan,h.at+hour);
 h.config=validateSettings({username:'example',timezone:'UTC'});await assert.rejects(h.worker.scan(),e=>e.status===409);h.store.close();
});
test('notification settings, test sends and scan now work over HTTP without exposing the token',async t=>{
 const store=openStore(':memory:'),service=createService({store,provider:async()=>({...fixture(),demo:false}),username:'example'});let reply={ok:true,status:200},at=Date.now();const sent=[];
 const ntfy=createNtfy({store,env:{NTFY_TOPIC:'env-topic',NTFY_TOKEN:'env_secret'},fetcher:async(url,options)=>{sent.push(options);if(!reply)throw Error('offline');return reply}}),worker=createWorker({store,service,ntfy});
 const base='http://127.0.0.1:18474',server=createHttpServer({service,worker,ntfy,adminToken:owner,agentToken:agent,publicUrl:base,dist:resolve('dist'),now:()=>at});
 await new Promise(r=>server.listen(18474,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(()=>{store.close();r()})));
 const call=(path,method='GET',body,token=owner)=>fetch(base+'/api/v1'+path,{method,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body&&JSON.stringify(body)});
 let response=await call('/settings'),text=await response.text();assert.equal(JSON.parse(text).notifications.source,'environment');assert.equal(JSON.parse(text).notifications.tokenSet,true);assert.equal(text.includes('env_secret'),false);
 // Only the owner may change or use the destination, and browsers must be same-origin.
 for(const [path,method]of [['/notifications','PUT'],['/notifications','DELETE'],['/notifications/test','POST'],['/scan','POST']]){
  assert.equal((await call(path,method,{topic:'x'},agent)).status,403);assert.equal((await call(path,method,{topic:'x'},'wrong')).status,401);
  assert.equal((await fetch(base+'/api/v1'+path,{method,headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'})).status,403);
 }
 assert.equal((await call('/notifications','PUT',{topic:'bad topic'})).status,400);assert.equal((await call('/notifications','PUT',{url:'http://ntfy.example',topic:'ok'})).status,400);
 response=await call('/notifications','PUT',{topic:'awaker-Abc123_-',token:'tk_browser'});text=await response.text();assert.equal(response.status,200);assert.equal(text.includes('tk_browser'),false);
 assert.deepEqual(JSON.parse(text).notifications,{configured:true,source:'saved',url:'https://ntfy.sh',topic:'awaker-Abc123_-',tokenSet:true,subscribeUrl:'https://ntfy.sh/awaker-Abc123_-'});
 response=await call('/notifications/test','POST',{});assert.deepEqual(await response.json(),{accepted:true,deviceDelivery:'unconfirmed'});assert.equal(sent.at(-1).headers.Authorization,'Bearer tk_browser');assert.equal(JSON.parse(sent.at(-1).body).topic,'awaker-Abc123_-');
 assert.equal((await call('/notifications/test','POST',{})).status,429);
 at+=10000;reply={ok:false,status:403};response=await call('/notifications/test','POST',{});assert.equal(response.status,502);assert.match((await response.json()).error,/rejected delivery \(403\).*access token/);
 at+=10000;reply=null;response=await call('/notifications/test','POST',{});assert.equal(response.status,502);assert.match((await response.json()).error,/Could not reach/);
 for(const path of ['/settings','/digests/preview']){text=await (await call(path,path==='/settings'?'GET':'POST',path==='/settings'?undefined:{})).text();assert.equal(/tk_browser|env_secret/.test(text),false)}
 assert.equal((await call('/scan','POST',{})).status,409);
 assert.equal((await call('/settings','PUT',{alerts:{waivers:true}})).status,200);response=await call('/scan','POST',{});assert.equal(response.status,200);
 const scanned=(await response.json()).worker;assert.equal(scanned.scan.manual,true);assert.equal(scanned.scan.kinds.waiver.baseline,true);assert.equal(scanned.events,undefined);
 assert.equal((await (await call('/notifications','DELETE')).json()).notifications.topic,'env-topic');
 at+=10000;store.set('ntfy',null);const off=createNtfy({store,env:{}});assert.equal(off.configured(),false);
});
test('fall-back clock rollback does not replay yesterday’s digest or schedule the repeated hour',async()=>{
 const h=harness();h.config=validateSettings({username:'example',timezone:'America/Los_Angeles',daily:{enabled:true,time:'01:30'}});
 h.at=Date.parse('2026-11-01T08:29:00Z');await h.worker.tick();h.at+=60000;await h.worker.tick();assert.equal(h.calls,1);
 h.at=Date.parse('2026-11-01T09:15:00Z');await h.worker.tick();assert.equal(h.calls,1);
 h.at=Date.parse('2026-11-01T09:45:00Z');await h.worker.tick();assert.equal(h.calls,1);
 assert.equal(nextRun(Date.parse('2026-11-01T08:45:00Z'),{enabled:true,time:'01:30'},'America/Los_Angeles','daily'),Date.parse('2026-11-02T09:30:00Z'));h.store.close();
});
test('enabling just before a boundary delivers the first due report',async()=>{
 const h=harness();h.store.set('scheduleReset',h.at);h.at+=60000;await h.worker.tick();assert.equal(h.calls,1);h.store.close();
});
test('opportunities that disappear and return still honor cooldown',async()=>{
 const h=harness();h.config=alerting();
 await h.worker.tick();h.ideas=[idea()];h.at+=hour;await h.worker.tick();assert.equal(h.calls,1);
 h.ideas=[];h.at+=hour;await h.worker.tick();h.ideas=[idea()];h.at+=hour;await h.worker.tick();assert.equal(h.calls,1);h.store.close();
});
test('preference-only changes preserve schedule state and the alert baseline',()=>{
 const store=openStore(':memory:');let at=100;const s=createService({store,provider:async()=>fixture(),now:()=>at});s.saveSettings({username:'example',daily:{enabled:true}});const reset=store.get('scheduleReset');at=200;s.saveSettings({preferences:{tradeMinGain:3}});assert.equal(store.get('scheduleReset'),reset);assert.equal(store.get('eventReset',0),0,'changing a filter or threshold must not silently swallow everything that now qualifies');store.close();
});
test('alert horizons validate, and the waiver horizon reaches the same engine as the waiver view',async()=>{
 assert.deepEqual([defaults.alerts.tradeHorizon,defaults.alerts.waiverHorizon],['season','current']);
 assert.equal(validateSettings({alerts:{tradeHorizon:'next',waiverHorizon:'season'}}).alerts.waiverHorizon,'season');
 for(const alerts of [{tradeHorizon:'current'},{waiverHorizon:'month'}])assert.throws(()=>validateSettings({alerts}),/horizon/);
 const store=openStore(':memory:'),at=Date.now(),data=fixture(at),service=createService({store,provider:async()=>data,now:()=>at});service.saveSettings({username:'example'});
 const league=data.leagues[0],weeks=data.outlook.weeks,season=await service.opportunities({leagueId:league.league_id,horizon:'season'});
 const expected=futureWaiverRows(data,league,data.outlook,{});
 assert.deepEqual(season.weeks,weeks);assert.deepEqual(season.opportunities[0].waivers.map(w=>[w.id,w.gain,w.drop]),expected.map(w=>[w.id,w.gain,w.drop]));
 for(const row of season.opportunities[0].waivers)assert.equal(row.perWeek,row.gain===null?null:row.gain/weeks.length);
 const next=await service.opportunities({leagueId:league.league_id,horizon:'next'});assert.deepEqual(next.weeks,[data.week+1]);
 assert.deepEqual((await service.opportunities({leagueId:league.league_id})).weeks,[data.week]);store.close();
});
test('alerts judge trades by their first week and pickups per week when asked to',async()=>{
 const h=harness(),weekly=[{week:3,gainA:6,gainB:2},{week:4,gainA:1,gainB:1}],seen=[];
 h.service.opportunities=async query=>{seen.push(query.horizon);return {season:'2026',week:2,complete:true,demo:false,warnings:[],generatedAt:h.at,horizon:query.horizon,weeks:[3,4,5,6],opportunities:[{leagueId:'1',league:'League',waivers:[{...pickup(12,'new','d2'),perWeek:3}]}]}};
 // 2.0 a week over the season misses a 3 point bar, but the same trade is worth 6 next week.
 h.config=alerting({trades:true,waivers:true,minGain:3,waiverMinGain:2.5,tradeHorizon:'next',waiverHorizon:'season'});h.ideas=[{...idea(2),weekly}];
 await h.worker.tick();assert.deepEqual(h.worker.status().scan.kinds,{trade:{found:1,fresh:0,baseline:true},waiver:{found:1,fresh:0,baseline:true}});assert.ok(seen.includes('season'));
 h.ideas=[{...idea(2),weekly,give:['c'],send:['C']}];h.at+=hour;await h.worker.tick();
 assert.equal(h.calls,1);assert.match(h.deliveries[0].message,/C for B\. Projected \+6\.0 points in week 3; partner \+2\.0\./);
 h.config=alerting({trades:true,waivers:false,minGain:3,tradeHorizon:'season'});h.ideas=[{...idea(2),weekly,give:['e'],send:['E']}];h.at+=hour;await h.worker.tick();h.at+=hour;await h.worker.tick();
 assert.equal(h.calls,1,'2.0 a week stays below the bar over the season');h.store.close();
});
test('bench upgrades alert only when asked, above their own bar, and never reuse a drop a starter pickup took',async()=>{
 const h=harness(),bench=(perWeek,id,drop)=>({...pickup(null,id,drop),gain:null,status:'bench',benchGain:perWeek,benchPerWeek:perWeek});
 assert.deepEqual([defaults.alerts.bench,defaults.alerts.benchMinGain],[false,3]);assert.throws(()=>validateSettings({alerts:{benchMinGain:0}}),/bench/);
 h.config=alerting({trades:false,waivers:true,waiverMinGain:2});h.waivers=[];await h.worker.tick();
 h.waivers=[bench(6,'stash','d1')];h.at+=hour;await h.worker.tick();assert.equal(h.calls,0,'bench alerts are off by default');
 h.config=alerting({trades:false,waivers:true,waiverMinGain:2,bench:true,benchMinGain:4});h.waivers=[];await h.worker.tick();
 h.waivers=[pickup(5,'starter','d1'),bench(9,'taken','d1'),bench(6,'stash','d2'),bench(5,'second','d3'),bench(3,'weak','d4')];h.at+=hour;await h.worker.tick();
 assert.equal(h.calls,1);assert.equal(h.deliveries[0].title,'Awaker: 2 waiver pickups');
 assert.match(h.deliveries[0].message,/add STARTER, drop D1/);assert.match(h.deliveries[0].message,/bench upgrade, add STASH over D2\. Projects \+6\.0 more points this week; would not start\./);
 assert.doesNotMatch(h.deliveries[0].message,/TAKEN|SECOND|WEAK/);h.store.close();
});
test('scoring that projections never itemise is a footnote, not an error that pauses alerts',async()=>{
 const source=(await import('node:fs')).readFileSync(new URL('../server/provider.js',import.meta.url),'utf8');
 assert.match(source,/data\.notes\.push\(/);assert.doesNotMatch(source,/errors\.push\(`\$\{league\.name\}/);
 // The envelope only degrades on errors, so notes never mark a scan incomplete.
 const store=openStore(':memory:'),at=Date.now(),data={...fixture(at),notes:['League: not projected fgm_50_59']},service=createService({store,provider:async()=>data,now:()=>at});service.saveSettings({username:'example'});
 const result=await service.opportunities();assert.equal(result.complete,true);assert.deepEqual(result.warnings,[]);store.close();
});
test('a new week keeps alerting: pickups found right after the week turns are sent, and old ones are not repeated',async()=>{
 const h=harness();let week=2;h.service.opportunities=async()=>({season:'2026',week,complete:true,demo:false,warnings:[],generatedAt:h.at,opportunities:[{leagueId:'1',league:'League',waivers:h.rows}]});
 h.config=alerting({trades:false,waivers:true,waiverMinGain:2});h.rows=[pickup(5,'old')];await h.worker.tick();assert.equal(h.calls,0,'the first scan ever is the silent starting point');
 week=3;h.rows=[pickup(5,'old'),pickup(6,'tuesday','d2')];h.at+=hour;await h.worker.tick();
 assert.equal(h.calls,1);assert.match(h.deliveries[0].message,/add TUESDAY/);assert.doesNotMatch(h.deliveries[0].message,/OLD/);h.store.close();
});
test('a failed background run backs off instead of retrying every minute, and Scan now still works',async()=>{
 const h=harness();let attempts=0,down=true;h.service.opportunities=async()=>{attempts++;if(down)throw Error('provider down');return {season:'2026',week:2,complete:true,demo:false,warnings:[],generatedAt:h.at,opportunities:[]}};
 h.config=alerting({trades:false,waivers:true});await h.worker.tick();assert.equal(attempts,1);assert.equal(h.worker.status().failures,1);
 h.at+=60000;await h.worker.tick();assert.equal(attempts,1,'one minute later is inside the two minute backoff');
 h.at+=90000;await h.worker.tick();assert.equal(attempts,2);assert.equal(h.worker.status().failures,2);
 down=false;await h.worker.scan();assert.equal(attempts,3,'a manual scan ignores the backoff');assert.equal(h.worker.status().failures,0);h.store.close();
});
test('one league with an injured starter or no draft does not pause alerts for the others',async()=>{
 const store=openStore(':memory:'),at=Date.now(),data=fixture(at),league=data.leagues[0];
 data.players[league.mine.starters.find(id=>id!=='0')].injury_status='Out';
 const service=createService({store,provider:async()=>data,now:()=>at});service.saveSettings({username:'example'});
 const result=await service.opportunities();
 assert.equal(result.dataComplete,true,'the data is fine, only a lineup has a hole');assert.ok(result.opportunities.length>=1);
 assert.ok(Number.isFinite(result.opportunities[0].lineup.gain),'an unavailable starter counts as zero, not as unknown');store.close();
});
test('an alert that never reaches the phone is offered again, and a flapping opportunity is not repeated',async()=>{
 const h=harness();h.config=alerting({trades:false,waivers:true,waiverMinGain:2,cooldownHours:1});h.waivers=[];await h.worker.tick();
 let down=true;const original=h.publish;h.worker=createWorker({store:h.store,service:h.service,publish:async item=>{if(down)throw Error('offline');return original(item)},now:()=>h.at});
 h.waivers=[pickup(5,'gem','d2')];h.at+=hour;await h.worker.tick();
 for(let i=0;i<4;i++){h.at+=20*60000;await h.worker.tick()}
 assert.equal(h.worker.status().outbox.at(-1).status,'failed','five attempts over about half an hour');assert.equal(h.calls,0);
 down=false;h.at+=hour;await h.worker.tick();assert.equal(h.calls,1,'the next scan sends it once the connection is back');
 // Dropping under the bar and coming back is not news.
 for(let i=0;i<4;i++){h.waivers=i%2?[pickup(5,'gem','d2')]:[];h.at+=2*hour;await h.worker.tick()}
 assert.equal(h.calls,1);h.store.close();
});
test('bench alerts scan without waiver alerts, and saved reports stay small',async()=>{
 const h=harness(),bench=(perWeek,id,drop)=>({...pickup(null,id,drop),gain:null,status:'bench',benchGain:perWeek,benchPerWeek:perWeek});
 h.config=alerting({trades:false,waivers:false,bench:true,benchMinGain:2});h.waivers=[];await h.worker.tick();
 h.waivers=[pickup(9,'starter','d1'),bench(4,'stash','d2')];h.at+=hour;await h.worker.tick();
 assert.equal(h.calls,1);assert.match(h.deliveries[0].message,/bench upgrade, add STASH/);assert.doesNotMatch(h.deliveries[0].message,/STARTER/);
 h.service.digest=async({period})=>({period,text:'Report',actions:[{text:'a',huge:'x'.repeat(50000)}],demo:false,leagues:['x'.repeat(50000)]});
 h.config=alerting({trades:false,waivers:false});h.at=Date.parse('2026-09-19T08:01:00Z');await h.worker.tick();
 assert.ok(JSON.stringify(h.store.get('worker').reports).length<2000);h.store.close();
});
test('shopping a player lists who wants him and what comes back, without requiring that it helps you',async()=>{
 const {shopPlayer}=await import('../dist/analysis.js');
 const data=fixture(Date.now()),league=data.leagues[0],model=buildSeasonModel({league,players:data.players,outlook:data.outlook});
 const mine=league.mine.players.filter(id=>Number.isFinite(model.totals[id])&&model.totals[id]>0).sort((a,b)=>model.totals[b]-model.totals[a]);
 const star=await shopPlayer(data,league,model,mine[0]);
 assert.equal(star.playerId,mine[0]);assert.ok(star.market.length>0,'every other team is asked');
 assert.deepEqual(star.market.map(m=>m.interest),[...star.market.map(m=>m.interest)].sort((a,b)=>b-a),'teams he helps most come first');
 for(const offer of star.offers){assert.deepEqual(offer.give,[mine[0]]);assert.ok(offer.gainB>.25,'the other team always gains');assert.ok(offer.partner)}
 const perPartner={};for(const o of star.offers)perPartner[o.partnerId]=(perPartner[o.partnerId]||0)+1;
 assert.ok(Object.values(perPartner).every(n=>n<=3));
 assert.equal((await shopPlayer(data,league,model,mine[0],{}, {cancelled:()=>true})).cancelled,true);
});
test('an alert whose delivery failed is sent once the cooldown ends, even when scans run more often than the cooldown',async()=>{
 const h=harness();let online=false,sent=0;h.config=alerting({scanHours:3,cooldownHours:6});
 const worker=createWorker({store:h.store,service:h.service,now:()=>h.at,publish:async()=>{if(!online)throw Error('offline');sent++}});
 await worker.tick();h.ideas=[idea()];
 // The first scan with the idea is three hours in. ntfy stays down until the push has used all five tries and given up.
 for(let minutes=0;minutes<=14*60;minutes+=20){if(minutes>=5*60+20)online=true;h.at+=20*60000;await worker.tick()}
 assert.equal(sent,1,'owed alerts survive the scans in between');h.store.close();
});
