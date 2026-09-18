import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../dist/api.js';

test('league refresh reuses unchanged resources, isolates leagues/weeks, and manual refresh bypasses caches',async()=>{
 const original=globalThis.fetch,originalNow=Date.now;let clock=100000,calls=[];Date.now=()=>clock;
 globalThis.fetch=async url=>{calls.push(url);return {ok:true,json:async()=>url.endsWith('/rosters')?[{roster_id:1,owner_id:'me'}]:[]}};
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
 globalThis.fetch=async()=>({ok:true,json:async()=>{calls++;return [{player_id:'a',stats:{rec:5},team:'BUF',opponent:'NYJ',player:{large:'unused'}},{player_id:'b',stats:{adp:9}}]}});
 try{const first=await api.projections(2099,2);assert.equal(first.a.stats.rec,5);assert.equal(first.a.opponent,'NYJ');assert.equal(first.a.player,undefined);assert.equal(first.b,undefined);
  assert.equal(await api.projections(2099,2),first);assert.equal(calls,1);
  await api.projections(2099,2,{force:true});assert.equal(calls,2);
 }finally{globalThis.fetch=original}
});
