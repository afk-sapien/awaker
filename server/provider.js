import {defenseWeeks} from '../dist/defenses.js';
import * as api from '../dist/api.js';
// The dashboard reads a handful of fields for a few thousand relevant players. Sleeper's directory is
// about 15 MB of everyone who ever played, and it used to ride along on every 45 second refresh.
const FIELDS=['full_name','first_name','last_name','position','fantasy_positions','team','number','injury_status','active'];
const FANTASY=new Set(['QB','RB','WR','TE','K','DEF']);
const slimCache=new WeakMap();
export function slimPlayers(players,leagues=[]){
 if(!slimCache.has(players)){
  const base={};
  for(const [id,p]of Object.entries(players)){
   if(!p||!(FANTASY.has(p.position)||(p.fantasy_positions||[]).some(x=>FANTASY.has(x)))||(p.active===false&&!p.team))continue;
   base[id]=Object.fromEntries(FIELDS.filter(k=>p[k]!==undefined&&p[k]!==null).map(k=>[k,p[k]]));
  }
  slimCache.set(players,base);
 }
 // Anyone on a roster is kept even if Sleeper calls him inactive, so names never go missing.
 const out={...slimCache.get(players)};
 for(const l of leagues)for(const r of l.rosters||[])for(const id of [...(r.players||[]),...(r.reserve||[]),...(r.taxi||[])])if(!out[id]&&players[id])out[id]=Object.fromEntries(FIELDS.filter(k=>players[id][k]!=null).map(k=>[k,players[id][k]]));
 return out;
}
export function createProvider(store){
 api.setPersistence((key,value)=>value===undefined?store.get(`cache:${key}`):store.set(`cache:${key}`,value));
 return async(settings,{outlook=false,force=false}={})=>{
  const found=await api.discover(settings.username),week=Math.max(1,Math.min(18,Number(found.nfl.week)||1)),season=found.nfl.season;
  // Leagues that are switched off or not drafted yet stay listed, so they can be switched back on,
  // but they are never analysed and cannot hold up the leagues that are in season.
  const leagues=found.leagues.filter(l=>l.status!=='complete');
  const sources=[],errors=[],now=Date.now();
  const source=(name,key,ttl)=>{const at=store.at(`cache:${key}`);sources.push({name,fetchedAt:at,sourceUpdatedAt:null,maxAgeMs:ttl,stale:!at||now-at>ttl})};
  const directory=await api.loadPlayers();source('players','directory',86400000);
  const jobs=await Promise.allSettled(leagues.map(l=>api.leagueDetails(l,found.user.user_id,week,{force})));
  const details=jobs.flatMap((r,i)=>{if(r.status==='rejected'){errors.push(`League ${leagues[i].league_id} unavailable`);return []}for(const [tail,ttl]of [['rosters',900000],['users',3600000],[`matchups/${week}`,900000]])source(`${leagues[i].league_id}/${tail}`,`https://api.sleeper.app/v1/league/${leagues[i].league_id}/${tail}`,ttl);return [{...r.value,enabled:r.value.enabled&&!settings.disabled.includes(r.value.league_id)&&!['pre_draft','drafting'].includes(r.value.status),inactive:['pre_draft','drafting'].includes(r.value.status)?'Not drafted yet':null}]});
  const players=slimPlayers(directory,details);
  const data={user:found.user,nfl:found.nfl,week,players,leagues:details,projections:{},games:{},schedules:{},trends:[],updatedAt:now,playersAt:store.at('cache:directory'),demo:false,errors,notes:[],sources};
  const jobsExtra=defenseWeeks(week).flatMap(w=>[{name:`schedule/${w}`,key:`games:${season}:${w}`,ttl:w===week?900000:3600000,week:w,type:'schedule',run:api.scoreboard(season,w,{force,ttl:w===week?30000:3600000})},{name:`projections/${w}`,key:`projections:${season}:${w}`,ttl:3600000,week:w,type:'projection',run:api.projections(season,w,{force})}]);
  jobsExtra.push({name:'trends',key:'https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=24&limit=100',ttl:900000,type:'trends',run:api.trends({force})});
  const results=await Promise.allSettled(jobsExtra.map(j=>j.run));
  results.forEach((r,i)=>{const j=jobsExtra[i];if(r.status==='rejected'){errors.push(`${j.name} unavailable`);return}source(j.name,j.key,j.ttl);if(j.type==='schedule'){data.schedules[j.week]=r.value;if(j.week===week)data.games=r.value}if(j.type==='projection'){data.projections[j.week]=r.value;const times=Object.values(r.value).map(p=>Number(p.updated_at)).filter(Number.isFinite);if(times.length)sources.at(-1).sourceUpdatedAt=Math.max(...times)}if(j.type==='trends')data.trends=r.value});
  const projectedKeys=new Set(Object.values(data.projections[week]||{}).flatMap(p=>Object.keys(p.stats||{})));
  // Rare-event scoring such as long field goals and points-allowed tiers is never itemised in
  // projections. Nearly every league has some, so it is a footnote and must not pause analysis.
  for(const league of details){const missing=Object.entries(league.scoring_settings||{}).filter(([key,value])=>value!==0&&!projectedKeys.has(key)).map(([key])=>key);if(missing.length)data.notes.push(`${league.name}: not projected ${missing.join(', ')}`)}
  if(outlook){const end=Math.max(settings.preferences.tradeEndWeek||17,settings.preferences.waiverEndWeek||17),weeks=Array.from({length:Math.max(0,end-week)},(_,i)=>week+1+i);data.outlook=await api.tradeOutlook(season,weeks);for(const w of weeks)source(`outlook/${w}`,`outlook:${season}:${w}`,3600000);if(data.outlook.errors.length)errors.push(`Future weeks unavailable: ${data.outlook.errors.join(', ')}`)}
  return data;
 };
}
