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
import {ntfyPublisher} from '../server/ntfy.js';
import {createMcpHandler} from '../server/mcp.js';
import {createHttpServer} from '../server/http.js';
import {contracts,validate} from '../server/contracts.js';
import {demo} from '../dist/demo.js';
import {buildSeasonModel} from '../dist/trades.js';
import {findTradeIdeas,waiverRows} from '../dist/analysis.js';
const owner='a'.repeat(40),agent='b'.repeat(40);
function fixture(at=Date.now()){
 const d=demo();d.updatedAt=at;d.sources=[{name:'fixture',fetchedAt:at,maxAgeMs:3600000,sourceUpdatedAt:null}];
 d.outlook={weeks:[3,4],data:Object.fromEntries([3,4].map(w=>[w,{projections:d.projections[w],games:d.games}])),loadedAt:at,errors:[]};return d;
}
function harness(){let at=Date.parse('2026-09-18T07:59:00Z'),calls=0,ideas=[];const store=openStore(':memory:');let config=validateSettings({username:'example',timezone:'UTC',daily:{enabled:true,time:'08:00'},alerts:{trades:true,quietStart:'00:00',quietEnd:'00:00'}});
 const service={settings:()=>config,digest:async({period})=>({period,text:'Report',actions:[],demo:false}),trades:async()=>({season:'2026',week:2,complete:true,demo:false,ideas,generatedAt:at})};
 const deliveries=[],publish=async item=>{calls++;deliveries.push(structuredClone(item))};
 const worker=createWorker({store,service,publish,now:()=>at});
 return {store,service,worker,deliveries,get calls(){return calls},get at(){return at},set at(v){at=v},set ideas(v){ideas=v},set config(v){config=v},publish};
}
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
 const list=await handle({jsonrpc:'2.0',id:2,method:'tools/list'});assert.equal(list.result.tools.length,5);assert.ok(list.result.tools.every(t=>t.annotations.readOnlyHint));
 const bad=await handle({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'evaluate_trade',arguments:{}}});assert.equal(bad.error.code,-32602);
 const report=await handle({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'preview_digest',arguments:{period:'weekly'}}});assert.equal(report.result.structuredContent.period,'weekly');assert.deepEqual(calls,['digest']);
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
 const h=harness();h.config=validateSettings({username:'example',timezone:'UTC',alerts:{trades:true,quietStart:'00:00',quietEnd:'00:00'}});await h.worker.tick();
 h.ideas=[idea()];h.at+=900000;await h.worker.tick();assert.equal(h.calls,1);
 h.at+=900000;await h.worker.tick();assert.equal(h.calls,1);
 const prev=h.service.trades;h.service.trades=async()=>({...await prev(),complete:false,ideas:[idea(10)]});h.at+=7*3600000;await h.worker.tick();assert.equal(h.calls,1);
 h.service.trades=async()=>({...await prev(),demo:true,ideas:[idea(10)]});h.at+=900000;await h.worker.tick();assert.equal(h.calls,1);h.store.close();
});
test('failed pushes retry durably and expired opportunities are not delivered',async()=>{
 const h=harness();let attempts=0;const worker=createWorker({store:h.store,service:h.service,now:()=>h.at,publish:async()=>{attempts++;throw Error('offline')}});
 await worker.tick();h.at+=60000;await worker.tick();assert.equal(attempts,1);assert.equal(worker.status().outbox[0].status,'pending');
 await worker.tick();assert.equal(attempts,1);h.at+=120000;await worker.tick();assert.equal(attempts,2);
 h.at+=86400000;h.config=validateSettings({username:'example'});await worker.tick();assert.equal(worker.status().outbox[0].status,'expired');h.store.close();
});
test('ntfy keeps token in authorization, marks provider acceptance, and rejects insecure remote URL',async()=>{
 let sent;const publish=ntfyPublisher({NTFY_URL:'https://ntfy.example',NTFY_TOPIC:'private',NTFY_TOKEN:'secret'},async(...args)=>{sent=args;return {ok:true}});
 assert.deepEqual(await publish({type:'trade',title:'Trade',message:'Useful',url:'https://sunday.example/?view=trades'}),{accepted:true});assert.equal(sent[1].headers.Authorization,'Bearer secret');assert.equal(JSON.parse(sent[1].body).priority,4);assert.equal(sent[1].body.includes('secret'),false);
 assert.throws(()=>ntfyPublisher({NTFY_URL:'http://ntfy.example',NTFY_TOPIC:'x',NTFY_TOKEN:'secret'}));assert.equal(ntfyPublisher({}),null);
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
 const h=harness();h.config=validateSettings({username:'example',timezone:'UTC',alerts:{trades:true,quietStart:'00:00',quietEnd:'00:00'}});
 await h.worker.tick();h.ideas=[idea()];h.at+=900000;await h.worker.tick();assert.equal(h.calls,1);
 h.ideas=[];h.at+=900000;await h.worker.tick();h.ideas=[idea()];h.at+=900000;await h.worker.tick();assert.equal(h.calls,1);h.store.close();
});
test('preference-only changes preserve schedule occurrence state',()=>{
 const store=openStore(':memory:');let at=100;const s=createService({store,provider:async()=>fixture(),now:()=>at});s.saveSettings({username:'example',daily:{enabled:true}});const reset=store.get('scheduleReset');at=200;s.saveSettings({preferences:{tradeMinGain:3}});assert.equal(store.get('scheduleReset'),reset);assert.equal(store.get('eventReset'),200);store.close();
});
