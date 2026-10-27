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
// A rate limit or a server hiccup is usually gone a moment later, so those are asked again twice,
// waiting as long as the service asks up to a cap. Any other refusal will not change. One deadline
// covers every attempt and the waits between them.
const RETRIES = 2, RETRY_CAP = 5000
function retryDelay(header, attempt) {
 const seconds = Number(header), date = Date.parse(header ?? '')
 const asked = header != null && header !== '' && Number.isFinite(seconds) ? seconds * 1000 : Number.isFinite(date) ? date - Date.now() : 500 * 2 ** attempt
 return Math.max(0, Math.min(RETRY_CAP, asked))
}
const pause = (ms, signal) => new Promise((resolve, reject) => {
 if (signal.aborted) return reject(signal.reason)
 const timer = setTimeout(resolve, ms)
 signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, {once: true})
})
export async function json(url) {
 const target = new URL(url)
 if (target.protocol !== 'https:' || target.username || target.password || !['https://api.sleeper.app', 'https://site.api.espn.com'].includes(target.origin)) throw Error('Unrecognized data provider.')
 const signal = AbortSignal.timeout(22000)
 for (let attempt = 0; ; attempt++) {
  let response
  try {
   response = await fetch(target.href, {redirect: 'error', credentials: 'omit', signal})
   if (response.ok) return await readJsonResponse(response)
  } catch (error) {
   // Fetch and interrupted response bodies can fail before an HTTP status exists.
   if (attempt < RETRIES && !signal.aborted && (error instanceof TypeError || error?.name === 'NetworkError')) {
    await pause(retryDelay(null, attempt), signal)
    continue
   }
   throw error
  }
  await response.body?.cancel()
  if (attempt < RETRIES && (response.status === 429 || response.status >= 500)) { await pause(retryDelay(response.headers.get('retry-after'), attempt), signal); continue }
  throw Error(`Data service returned ${response.status}. Please try again.`)
 }
}
export const sleeper=(path,options={})=>cache.get(BASE+path,()=>json(BASE+path),options);
// A slimmed directory written by scripts/slim-players.js and served from this origin, about 300 KB
// against 15 MB. Injury statuses and new signings go stale, so it is used only while it is as fresh
// as a live fetch would have been. An older, unreadable, foreign or short file is ignored and the
// full directory is fetched instead.
export const SLIM_PLAYERS='players.json',SLIM_MINIMUM=500;
export async function slimPlayerFile(){
 if(typeof location==='undefined'||!location?.href)return null;
 let url;try{url=new URL(SLIM_PLAYERS,location.href)}catch{return null}
 if(url.origin!==location.origin)return null;
 let response;try{response=await fetch(url.href,{redirect:'error',credentials:'omit',cache:'no-cache'})}catch{return null}
 if(!response.ok){try{await response.body?.cancel()}catch{}return null}
 try{
  const file=await readJsonResponse(response,8*1024*1024);
  const at=Date.parse(file?.generatedAt);
  if(!Number.isFinite(at)||Date.now()-at>24*HOUR)return null;
  const players=file.players;
  if(!players||typeof players!=='object'||Array.isArray(players))return null;
  // A directory this short is a truncated or unrelated file, and would hide most of the league.
  const ids=Object.keys(players);
  if(ids.length<SLIM_MINIMUM||ids.some(id=>!players[id]||typeof players[id]!=='object'))return null;
  return players;
 }catch{return null}
}
export function loadPlayers(options={}){return cache.get('directory',async()=>{
 // Reuse the directory saved by earlier versions of the app.
 if(!options.force){const legacy=await storage('players');if(legacy&&Date.now()-legacy.time<24*HOUR)return legacy.data}
 return await slimPlayerFile()||json(BASE+'/players/nfl');
},{ttl:24*HOUR,...options});}
// Player logs load only when opened, independently of dashboard refreshes.
export function playerHistory(playerId,season,options={}){
 if(!/^(?:\d+|[A-Z]{2,3})$/.test(String(playerId))||!/^\d{4}$/.test(String(season)))return Promise.reject(Error('Invalid player or season.'))
 return cache.get(`player-history:${playerId}:${season}`,async()=>{
  const data=await json(`https://api.sleeper.app/stats/nfl/player/${encodeURIComponent(playerId)}?season=${season}&season_type=regular&grouping=week`)
  if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(key=>!/^([1-9]|1[0-8])$/.test(key)))throw Error('Player stats unavailable.')
  const rows={}
  for(const [week,row] of Object.entries(data)){
   if(row===null)continue
   if(!row||typeof row!=='object'||!row.stats||typeof row.stats!=='object'||Array.isArray(row.stats))throw Error('Player stats unavailable.')
   rows[week]={week:Number(week),stats:Object.fromEntries(Object.entries(row.stats).filter(([,v])=>Number.isFinite(v))),team:row.team,opponent:row.opponent,date:row.date,away:row.is_away_team}
  }
  return rows
 },{ttl:10*MINUTE,...options})
}
export async function discover(username){const [user,nfl]=await Promise.all([sleeper('/user/'+encodeURIComponent(username.trim().toLowerCase()),{ttl:24*HOUR}),sleeper('/state/nfl',{ttl:5*MINUTE})]);
 if(!user?.user_id)throw Error('Sleeper username not found. Check the spelling and try again.');
 const leagues=await sleeper(`/user/${user.user_id}/leagues/nfl/${nfl.league_season||nfl.season}`,{ttl:10*MINUTE});
 if(!leagues?.length)throw Error(`No NFL leagues found for ${username} in ${nfl.league_season||nfl.season}.`);return {user,nfl,leagues};}
export async function leagueDetails(l,userId,week,options={}){
 const resource=async(tail,label,ttl)=>{
  try {
   const rows=await sleeper(`/league/${l.league_id}/${tail}`,{ttl,...options})
   if(!Array.isArray(rows)||rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw new SyntaxError('Invalid league response')
   return rows
  } catch(cause) {
   const status=/^Data service returned (\d{3})\./.exec(cause?.message||'')?.[1]
   const reason=status?`HTTP ${status}`:['TimeoutError','AbortError'].includes(cause?.name)?'request timed out':cause instanceof SyntaxError?'invalid response':cause instanceof TypeError||cause?.name==='NetworkError'?'network connection failed':'request failed'
   const error=new Error(`Sleeper ${label}: ${reason}. Try Refresh.`,{cause})
   error.code='LEAGUE_DATA'
   throw error
  }
 }
 const [rosters,users,matchups]=await Promise.all([
  resource('rosters','rosters',MINUTE),
  resource('users','managers',HOUR),
  resource(`matchups/${week}`,`week ${week} matchups`,30000)
 ])
 const mine=rosters.find(r=>r.owner_id===userId||(Array.isArray(r.co_owners)&&r.co_owners.includes(userId)))
 if(!mine){
  const error=new Error('No roster found for this Sleeper account. Check league membership and the configured username.')
  error.code='LEAGUE_DATA'
  throw error
 }
 return {...l,rosters,users,matchups,mine,enabled:l.status!=='complete',syncedAt:Date.now()}
}
const teamAlias=t=>({WSH:'WAS',WSN:'WAS',LA:'LAR',JAC:'JAX'}[t]||t);
export function scoreboard(season,week,options={}){return cache.get(`games:${season}:${week}`,async()=>{const d=await json(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${season}&seasontype=2&week=${week}&limit=100`);const games={};for(const e of d.events||[]){const c=e.competitions?.[0];if(!c)continue;for(const team of c.competitors||[]){const other=c.competitors.find(x=>x.id!==team.id);games[teamAlias(team.team.abbreviation)]={id:e.id,state:e.status.type.state,detail:e.status.type.shortDetail,start:e.date,opponent:teamAlias(other?.team?.abbreviation),home:team.homeAway==='home',score:team.score,oppScore:other?.score,channel:c.broadcasts?.flatMap(b=>b.names||[]).join(' / ')||null,period:e.status.period??null,clock:e.status.displayClock??null};}}return games;},{ttl:30000,...options});}
export function projections(season,week,options={}){return cache.get(`projections:${season}:${week}`,async()=>{
 const d=await json(`https://api.sleeper.app/projections/nfl/${season}/${week}?season_type=regular`);
 if(!Array.isArray(d))throw Error('Projection feed unavailable.');
 return Object.fromEntries(d.filter(r=>Object.keys(r.stats||{}).some(k=>!k.includes('adp'))).map(r=>[r.player_id,{stats:r.stats,team:r.team,opponent:r.opponent,updated_at:r.updated_at}]));
 },{ttl:HOUR,...options});}
// What actually happened in a week, in the same shape as projections. A week keeps changing until
// its last game is over, and stat corrections trail that, so results are held for a day only once the
// week's last kickoff is SETTLED ago: a copy fetched before that game ended is by then more than a
// day old, so it is never the one kept. Until then, and without a schedule, they last minutes.
const SETTLED=30*HOUR;
export async function stats(season,week,options={}){
 // The schedule only decides how long results are kept, so a slow ESPN is not allowed to hold them up.
 const games=await Promise.race([scoreboard(season,week,{ttl:HOUR}).catch(()=>null),new Promise(r=>setTimeout(r,3000,null))]),list=Object.values(games||{});
 const settled=list.length>0&&list.every(g=>g.state==='post')&&Date.now()-Math.max(...list.map(g=>Date.parse(g.start)))>SETTLED;
 return cache.get(`stats:${season}:${week}`,async()=>{
 const d=await json(`https://api.sleeper.app/stats/nfl/${season}/${week}?season_type=regular`);
 if(!Array.isArray(d))throw Error('Weekly results unavailable.');
 return Object.fromEntries(d.filter(r=>r.stats&&(r.stats.gp||r.stats.pts_ppr!==undefined||r.stats.pts_std!==undefined)).map(r=>[r.player_id,{stats:r.stats,team:r.team,opponent:r.opponent}]));
 },{ttl:settled?24*HOUR:10*MINUTE,...options});}
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
 const quiet=p=>p.catch(()=>null);
 const finished=games=>{const list=Object.values(games||{});return list.length>0&&list.every(g=>g.state==='post')};
 async function worker(){while(next<weeks.length){const week=weeks[next++];
  try{
   // Sleeper files a transaction under the week it cleared in, so a Tuesday waiver sits in the week
   // whose games are already over. Grading it needs this week's kickoff times, to tell which of its
   // players could still play, and the week after: its scores, and whether it has been played at all.
   const after=week+1,ahead=after<=18;
   const [matchups,moves,results,expected,games,nextGames,nextResults,nextMatchups]=await Promise.all([
    leagueWeek(leagueId,week,options),transactions(leagueId,week,options),
    stats(season,week,options),projections(season,week,options),
    quiet(scoreboard(season,week,{ttl:6*HOUR,...options})),
    ahead?quiet(scoreboard(season,after,{ttl:HOUR,...options})):null,
    ahead?quiet(stats(season,after,options)):null,
    ahead?quiet(leagueWeek(leagueId,after,options)):null]);
   if(!Array.isArray(matchups)||!matchups.length)throw Error(`Week ${week} was never played.`);
   data[week]={matchups,transactions:Array.isArray(moves)?moves:[],stats:results,projections:expected,games:games||null,
    next:ahead?{week:after,matchups:Array.isArray(nextMatchups)?nextMatchups:[],stats:nextResults||{},complete:finished(nextGames)}:null};
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
