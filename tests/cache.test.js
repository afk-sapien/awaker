import test from 'node:test';
import assert from 'node:assert/strict';
import {createResourceCache,createMemo,rosterKey} from '../dist/cache.js';

test('concurrent requests share one load, memory hits reuse it, and expiry reloads',async()=>{
 let clock=100,calls=0,release;const cache=createResourceCache({now:()=>clock});
 const loader=()=>{calls++;return new Promise(resolve=>release=resolve)};
 const a=cache.get('week:2',loader,{ttl:30}),b=cache.get('week:2',loader,{ttl:30});
 assert.equal(a,b);await Promise.resolve();release({score:12});
 assert.deepEqual(await a,{score:12});assert.equal(await cache.get('week:2',loader,{ttl:30}),await b);assert.equal(calls,1);
 clock=130;assert.equal(await cache.get('week:2',()=>++calls,{ttl:30}),2);
});
test('persistent cache survives a new instance; forced refresh replaces saved data',async()=>{
 const disk=new Map(),options={read:async k=>disk.get(k),write:async(k,v)=>disk.set(k,v),now:()=>100};
 await createResourceCache(options).get('projections:2026:2',async()=>42,{ttl:1000});
 const next=createResourceCache(options);
 assert.equal(await next.get('projections:2026:2',()=>assert.fail('network called'),{ttl:1000}),42);
 assert.equal(await next.get('projections:2026:2',async()=>43,{ttl:1000,force:true}),43);
 assert.equal(disk.get('projections:2026:2').value,43);
 assert.equal(await next.get('projections:2026:3',async()=>99,{ttl:1000}),99);
});
test('failed loads are retried, expired data is not silently served, storage failure is harmless',async()=>{
 let clock=0;const cache=createResourceCache({now:()=>clock,read:async()=>{throw Error('blocked')},write:async()=>{throw Error('quota')}});
 await cache.get('live',async()=>10,{ttl:30});clock=31;
 await assert.rejects(cache.get('live',async()=>{throw Error('offline')},{ttl:30}),/offline/);
 assert.equal(await cache.get('live',async()=>20,{ttl:30}),20);
});
test('a forced refresh joins an already running fetch instead of duplicating it',async()=>{
 let release,calls=0;const cache=createResourceCache();
 const a=cache.get('live',()=>{calls++;return new Promise(r=>release=r)},{persist:false});
 const b=cache.get('live',()=>assert.fail('duplicate'),{force:true});release(7);
 assert.equal(await a,7);assert.equal(await b,7);assert.equal(calls,1);
});
test('memory is bounded and recently used entries survive eviction',async()=>{
 const cache=createResourceCache({maxEntries:2});let calls=0;
 const get=key=>cache.get(key,()=>++calls,{persist:false});
 await get('a');await get('b');await get('a');await get('c');assert.equal(await get('a'),1);assert.equal(await get('b'),4);
});
test('manual refresh arriving during a disk read bypasses that saved response',async()=>{
 let release,calls=0;const cache=createResourceCache({now:()=>100,read:()=>new Promise(r=>release=r)});
 const a=cache.get('live',async()=>{calls++;return 'fresh'});
 const b=cache.get('live',()=>assert.fail('duplicate loader'),{force:true});
 release({at:90,value:'saved'});assert.equal(await a,'fresh');assert.equal(await b,'fresh');assert.equal(calls,1);
});
test('computed results reuse each league, include empty results, and evict old entries',()=>{
 const memo=createMemo(2);const empty=[];
 assert.equal(memo.get('league-a',()=>empty),empty);memo.get('league-b',()=>[1]);
 assert.equal(memo.get('league-a',()=>assert.fail('recomputed')),empty);
 memo.set('league-c',[2]);assert.equal(memo.peek('league-b'),undefined);
 assert.equal(memo.peek('league-a'),empty);
});
test('score-only refreshes preserve season models; roster, scoring, reserve, slots and league changes invalidate',()=>{
 const league={league_id:'a',mine:{roster_id:1},roster_positions:['QB','RB','BN'],scoring_settings:{rec:1},rosters:[{roster_id:1,players:['a','b'],reserve:[],taxi:[]}]};
 const key=rosterKey(league),copy=()=>structuredClone(league);
 const live=copy();live.syncedAt=999;live.rosters[0].starters=['b'];live.rosters[0].points=12;live.matchups=[{points:99}];assert.equal(rosterKey(live),key);
 for(const mutate of [l=>l.league_id='b',l=>l.mine.roster_id=2,l=>l.rosters[0].players.push('c'),l=>l.rosters[0].reserve.push('a'),l=>l.rosters[0].taxi.push('b'),l=>l.scoring_settings.rec=.5,l=>l.roster_positions.push('FLEX')]){const changed=copy();mutate(changed);assert.notEqual(rosterKey(changed),key)}
});
test('a three-league session stays in memory: two hundred entries are all still there',async()=>{
 const cache=createResourceCache();let calls=0;
 for(let i=0;i<200;i++)await cache.get(`k${i}`,async()=>++calls,{persist:false});
 assert.equal(await cache.get('k0',()=>assert.fail('evicted'),{persist:false}),1);
});
