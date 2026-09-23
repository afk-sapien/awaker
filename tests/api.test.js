import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../dist/api.js';

test('league refresh reuses unchanged resources, isolates leagues/weeks, and manual refresh bypasses caches',async()=>{
 const original=globalThis.fetch,originalNow=Date.now;let clock=100000,calls=[];Date.now=()=>clock;
 globalThis.fetch = async url => {
  calls.push(url)
  return Response.json(url.endsWith('/rosters') ? [{roster_id:1,owner_id:'me'}] : [])
 }
 try{
  const l={league_id:'cache-test'};
  await Promise.all([api.leagueDetails(l,'me',2),api.leagueDetails(l,'me',2)]);assert.equal(calls.length,3);
  await api.leagueDetails(l,'me',2);assert.equal(calls.length,3);
  clock+=45000;await api.leagueDetails(l,'me',2);assert.equal(calls.length,4);assert.match(calls.at(-1),/matchups\/2$/);
  clock+=45000;await api.leagueDetails(l,'me',2);assert.equal(calls.length,6);
  await api.leagueDetails(l,'me',3);assert.equal(calls.length,7);assert.match(calls.at(-1),/matchups\/3$/);
  await api.leagueDetails(l,'me',3,{force:true});assert.equal(calls.length,10);
  await api.leagueDetails({league_id:'other'},'me',3);assert.equal(calls.length,13);
 }finally{globalThis.fetch=original;Date.now=originalNow}
});
test('projection cache keeps useful stats, reuses results, and honors forced refresh',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++
 return Response.json([{player_id:'a',stats:{rec:5},team:'BUF',opponent:'NYJ',player:{large:'unused'}},{player_id:'b',stats:{adp:9}}])
 }
 try{const first=await api.projections(2099,2);assert.equal(first.a.stats.rec,5);assert.equal(first.a.opponent,'NYJ');assert.equal(first.a.player,undefined);assert.equal(first.b,undefined);
  assert.equal(await api.projections(2099,2),first);assert.equal(calls,1);
  await api.projections(2099,2,{force:true});assert.equal(calls,2);
 }finally{globalThis.fetch=original}
});
test('a rate limit or server error is asked again a bounded number of times, any other refusal is not',async()=>{
 const original=globalThis.fetch;let calls=0,script=[];
 globalThis.fetch=async()=>{calls++;const status=script.shift()??200;return status===200?Response.json([{player_id:'a',stats:{rec:1}}]):new Response('busy',{status,headers:{'retry-after':'0'}})};
 try{
  script=[503,429];assert.equal((await api.projections(2097,1)).a.stats.rec,1);assert.equal(calls,3,'two retries, then success');
  calls=0;script=[500,502,503];await assert.rejects(api.projections(2097,2),/returned 503/);assert.equal(calls,3,'gives up after two retries');
  calls=0;script=[404];await assert.rejects(api.projections(2097,3),/returned 404/);assert.equal(calls,1,'a 404 will not change');
 }finally{globalThis.fetch=original}
});
test('the week being played is refetched within minutes, a week long settled is held for a day',async()=>{
 const original=globalThis.fetch,originalNow=Date.now;let clock=Date.parse('2026-09-28T03:00:00Z'),calls=[],state='in';Date.now=()=>clock;
 const event=start=>({id:'1',date:start,status:{type:{state,shortDetail:''}},competitions:[{competitors:[{id:'a',team:{abbreviation:'BUF'},homeAway:'home'},{id:'b',team:{abbreviation:'MIA'},homeAway:'away'}]}]});
 globalThis.fetch=async url=>{if(url.includes('scoreboard'))return Response.json({events:[event('2026-09-29T00:15:00Z')]});calls.push(url);return Response.json([{player_id:'a',stats:{gp:1,pts_ppr:calls.length}}])};
 try{
  // Sunday night: Monday's game has not been played, so Sunday's numbers must not stand for a day.
  assert.equal((await api.stats(2096,4)).a.stats.pts_ppr,1);
  clock+=11*60000;assert.equal((await api.stats(2096,4)).a.stats.pts_ppr,2,'refetched after ten minutes');
  // Two days after the last kickoff the week is over and corrected, and one fetch serves the day.
  clock=Date.parse('2026-10-01T12:00:00Z');state='post';
  assert.equal((await api.stats(2096,4,{force:true})).a.stats.pts_ppr,3);
  clock+=6*3600000;assert.equal((await api.stats(2096,4)).a.stats.pts_ppr,3,'a settled week is not fetched again');
 }finally{globalThis.fetch=original;Date.now=originalNow}
});
