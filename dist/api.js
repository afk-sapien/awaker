import {readJsonResponse} from './network.js'
import {createResourceCache} from './cache.js';
const BASE='https://api.sleeper.app/v1',MINUTE=60000,HOUR=60*MINUTE;
let persistence;
export function setPersistence(adapter){persistence=adapter}
// Storage failure is non-fatal; the same cache still works in memory.
function storage(key,value){if(persistence)return Promise.resolve(persistence(key,value));return new Promise(resolve=>{
 if(typeof indexedDB==='undefined'){resolve(null);return}
 let request;try{request=indexedDB.open('sunday-cache',1)}catch{resolve(null);return}
 request.onupgradeneeded=()=>request.result.createObjectStore('data');
 request.onerror=()=>resolve(null);request.onblocked=()=>resolve(null);
 request.onsuccess=()=>{const db=request.result;let result=null;
  try{const tx=db.transaction('data',value===undefined?'readonly':'readwrite'),store=tx.objectStore('data');
   const op=value===undefined?store.get(key):store.put(value,key);
   op.onsuccess=()=>{result=op.result};tx.oncomplete=()=>{db.close();resolve(result)};
   tx.onerror=tx.onabort=()=>{db.close();resolve(null)};
  }catch{db.close();resolve(null)}
 };
});}
const cache=createResourceCache({read:key=>storage(key),write:(key,value)=>storage(key,value)});
export async function json(url) {
 const target = new URL(url)
 if (target.protocol !== 'https:' || target.username || target.password || !['https://api.sleeper.app', 'https://site.api.espn.com'].includes(target.origin)) throw Error('Unrecognized data provider.')
 const response = await fetch(target.href, {redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(22000)})
 if (!response.ok) {
  await response.body?.cancel()
  throw Error(`Data service returned ${response.status}. Please try again.`)
 }
 return readJsonResponse(response)
}
export const sleeper=(path,options={})=>cache.get(BASE+path,()=>json(BASE+path),options);
export function loadPlayers(options={}){return cache.get('directory',async()=>{
 // Reuse the directory saved by earlier versions of the app.
 if(!options.force){const legacy=await storage('players');if(legacy&&Date.now()-legacy.time<24*HOUR)return legacy.data}
 return json(BASE+'/players/nfl');
},{ttl:24*HOUR,...options});}
export async function discover(username){const [user,nfl]=await Promise.all([sleeper('/user/'+encodeURIComponent(username.trim().toLowerCase()),{ttl:24*HOUR}),sleeper('/state/nfl',{ttl:5*MINUTE})]);
 if(!user?.user_id)throw Error('Sleeper username not found. Check the spelling and try again.');
 const leagues=await sleeper(`/user/${user.user_id}/leagues/nfl/${nfl.league_season||nfl.season}`,{ttl:10*MINUTE});
 if(!leagues?.length)throw Error(`No NFL leagues found for ${username} in ${nfl.league_season||nfl.season}.`);return {user,nfl,leagues};}
export async function leagueDetails(l,userId,week,options={}){const [rosters,users,matchups]=await Promise.all([
 sleeper(`/league/${l.league_id}/rosters`,{ttl:MINUTE,...options}),
 sleeper(`/league/${l.league_id}/users`,{ttl:HOUR,...options}),
 sleeper(`/league/${l.league_id}/matchups/${week}`,{ttl:30000,...options})]);
 const mine=rosters.find(r=>r.owner_id===userId||(r.co_owners||[]).includes(userId));if(!mine)throw Error('No roster found for this user.');
 return {...l,rosters,users,matchups,mine,enabled:l.status!=='complete',syncedAt:Date.now()};}
const teamAlias=t=>({WSH:'WAS',WSN:'WAS',LA:'LAR',JAC:'JAX'}[t]||t);
export function scoreboard(season,week,options={}){return cache.get(`games:${season}:${week}`,async()=>{const d=await json(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${season}&seasontype=2&week=${week}&limit=100`);const games={};for(const e of d.events||[]){const c=e.competitions?.[0];if(!c)continue;for(const team of c.competitors||[]){const other=c.competitors.find(x=>x.id!==team.id);games[teamAlias(team.team.abbreviation)]={id:e.id,state:e.status.type.state,detail:e.status.type.shortDetail,start:e.date,opponent:teamAlias(other?.team?.abbreviation),home:team.homeAway==='home',score:team.score,oppScore:other?.score,channel:c.broadcasts?.flatMap(b=>b.names||[]).join(' / ')||null,period:e.status.period??null,clock:e.status.displayClock??null};}}return games;},{ttl:30000,...options});}
export function projections(season,week,options={}){return cache.get(`projections:${season}:${week}`,async()=>{
 const d=await json(`https://api.sleeper.app/projections/nfl/${season}/${week}?season_type=regular`);
 if(!Array.isArray(d))throw Error('Projection feed unavailable.');
 return Object.fromEntries(d.filter(r=>Object.keys(r.stats||{}).some(k=>!k.includes('adp'))).map(r=>[r.player_id,{stats:r.stats,team:r.team,opponent:r.opponent,updated_at:r.updated_at}]));
 },{ttl:HOUR,...options});}
// What actually happened in a week, in the same shape as projections. Finished weeks never change.
export function stats(season,week,options={}){return cache.get(`stats:${season}:${week}`,async()=>{
 const d=await json(`https://api.sleeper.app/stats/nfl/${season}/${week}?season_type=regular`);
 if(!Array.isArray(d))throw Error('Weekly results unavailable.');
 return Object.fromEntries(d.filter(r=>r.stats&&(r.stats.gp||r.stats.pts_ppr!==undefined||r.stats.pts_std!==undefined)).map(r=>[r.player_id,{stats:r.stats,team:r.team,opponent:r.opponent}]));
 },{ttl:24*HOUR,...options});}
// One week of a league's matchups. Finished weeks hold the scores; weeks ahead hold only who plays whom.
export function leagueWeek(leagueId,week,options={}){return sleeper(`/league/${leagueId}/matchups/${week}`,{ttl:6*HOUR,...options});}
export function trends(options={}){return sleeper('/players/nfl/trending/add?lookback_hours=24&limit=100',{ttl:15*MINUTE,...options});}
// Every add, drop, waiver claim and trade a league processed in one week. The current week is still
// being written to; finished weeks are settled, which is all the recap ever asks for.
export function transactions(leagueId,week,options={}){return sleeper(`/league/${leagueId}/transactions/${week}`,{ttl:6*HOUR,...options});}

// Finished weeks for one league: who was started and what they scored, what was projected of them,
// and the moves made that week. Only the recap needs this, so it is fetched on demand.
export async function leagueHistory(season,leagueId,weeks,options={}){
 const data={},errors=[];let next=0;
 async function worker(){while(next<weeks.length){const week=weeks[next++];
  try{
   const [matchups,moves,results,expected]=await Promise.all([
    leagueWeek(leagueId,week,options),transactions(leagueId,week,options),
    stats(season,week,options),projections(season,week,options)]);
   if(!Array.isArray(matchups)||!matchups.length)throw Error(`Week ${week} was never played.`);
   data[week]={matchups,transactions:Array.isArray(moves)?moves:[],stats:results,projections:expected};
  }catch{errors.push(week)}
 }}
 await Promise.all(Array.from({length:3},worker));
 return {season,leagueId,weeks,data,errors,loadedAt:Date.now()};
}

export async function tradeOutlook(season,weeks,onProgress=()=>{},force=false){
 const data={},errors=[];let done=0,next=0;
 async function worker(){while(next<weeks.length){const week=weeks[next++];
  try{data[week]=await cache.get(`outlook:${season}:${week}`,async()=>{
   if(!force){const legacy=await storage(`trade-outlook:${season}:${week}`);if(legacy&&Date.now()-legacy.at<HOUR)return legacy.data}
   const [rows,games]=await Promise.all([projections(season,week,{force}),scoreboard(season,week,{ttl:HOUR,force})]);
   if(!Object.keys(games).length||!Object.keys(rows).length)throw Error('Season data unavailable');
   return {projections:rows,games};
  },{ttl:HOUR,force});}catch{errors.push(week)}
  onProgress(++done,weeks.length);
 }}
 await Promise.all(Array.from({length:3},worker));
 return {season,weeks,data,errors,loadedAt:Date.now()};
}
