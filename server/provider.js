import {defenseWeeks} from '../dist/defenses.js';
import * as api from '../dist/api.js';
export function createProvider(store){
 api.setPersistence((key,value)=>value===undefined?store.get(`cache:${key}`):store.set(`cache:${key}`,value));
 return async(settings,{outlook=false,force=false}={})=>{
  const found=await api.discover(settings.username),week=Math.max(1,Math.min(18,Number(found.nfl.week)||1)),season=found.nfl.season;
  const leagues=found.leagues.filter(l=>!settings.disabled.includes(l.league_id)&&l.status!=='complete');
  const sources=[],errors=[],now=Date.now();
  const source=(name,key,ttl)=>{const at=store.get(`cache:${key}`)?.at||null;sources.push({name,fetchedAt:at,sourceUpdatedAt:null,maxAgeMs:ttl,stale:!at||now-at>ttl})};
  const players=await api.loadPlayers();source('players','directory',86400000);
  const jobs=await Promise.allSettled(leagues.map(l=>api.leagueDetails(l,found.user.user_id,week,{force})));
  const details=jobs.flatMap((r,i)=>{if(r.status==='rejected'){errors.push(`League ${leagues[i].league_id} unavailable`);return []}for(const [tail,ttl]of [['rosters',900000],['users',3600000],[`matchups/${week}`,900000]])source(`${leagues[i].league_id}/${tail}`,`https://api.sleeper.app/v1/league/${leagues[i].league_id}/${tail}`,ttl);return [r.value]});
  const data={user:found.user,nfl:found.nfl,week,players,leagues:details,projections:{},games:{},schedules:{},trends:[],updatedAt:now,demo:false,errors,sources};
  const jobsExtra=defenseWeeks(week).flatMap(w=>[{name:`schedule/${w}`,key:`games:${season}:${w}`,ttl:w===week?900000:3600000,week:w,type:'schedule',run:api.scoreboard(season,w,{force,ttl:w===week?30000:3600000})},{name:`projections/${w}`,key:`projections:${season}:${w}`,ttl:3600000,week:w,type:'projection',run:api.projections(season,w,{force})}]);
  jobsExtra.push({name:'trends',key:'https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=24&limit=100',ttl:900000,type:'trends',run:api.trends({force})});
  const results=await Promise.allSettled(jobsExtra.map(j=>j.run));
  results.forEach((r,i)=>{const j=jobsExtra[i];if(r.status==='rejected'){errors.push(`${j.name} unavailable`);return}source(j.name,j.key,j.ttl);if(j.type==='schedule'){data.schedules[j.week]=r.value;if(j.week===week)data.games=r.value}if(j.type==='projection'){data.projections[j.week]=r.value;const times=Object.values(r.value).map(p=>Number(p.updated_at)).filter(Number.isFinite);if(times.length)sources.at(-1).sourceUpdatedAt=Math.max(...times)}if(j.type==='trends')data.trends=r.value});
  const projectedKeys=new Set(Object.values(data.projections[week]||{}).flatMap(p=>Object.keys(p.stats||{})));
  for(const league of details){const missing=Object.entries(league.scoring_settings||{}).filter(([key,value])=>value!==0&&!projectedKeys.has(key)).map(([key])=>key);if(missing.length)errors.push(`${league.name}: unmodeled scoring ${missing.join(', ')}`)}
  if(outlook){const end=settings.preferences.tradeEndWeek||17,weeks=Array.from({length:Math.max(0,end-week)},(_,i)=>week+1+i);data.outlook=await api.tradeOutlook(season,weeks);for(const w of weeks)source(`outlook/${w}`,`outlook:${season}:${w}`,3600000);if(data.outlook.errors.length)errors.push(`Future weeks unavailable: ${data.outlook.errors.join(', ')}`)}
  return data;
 };
}
