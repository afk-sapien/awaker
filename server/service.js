import {aggregateWatch,activeSlots,optimize,playableIds} from '../dist/engine.js';
import {buildSeasonModel,realismReasons,compareTradeIdeas,tradeGains} from '../dist/trades.js';
import {findTradeIdeas,waiverRows,futureWaiverRows,lockedLineup,usableValue} from '../dist/analysis.js';
import {weekReview,moves} from '../dist/season.js';
import {teamName} from '../dist/league.js';
import {waiverWeeks} from '../dist/waivers.js';
import {defaults,validateSettings,bad} from './settings.js';
const name=(data,id)=>data.players[id]?.full_name||id;
// The engines explain a refused trade or league with a plain Error. A TypeError and its kin are
// bugs, so callers get a general message and the detail goes to the server log.
export function reason(e){
 if(e?.status||e?.constructor===Error)return e.message;
 console.error('Analysis failed:',e?.stack||e);
 return 'Analysis failed unexpectedly for this request.';
}
export function createService({store,provider,now=Date.now,username:pinned=''}){
 let pending=null,revision=0,snapshot=null,analysisCache=new Map();
 // A configured account is authoritative, so an open service cannot be repointed
 // at someone else's leagues and keep delivering notifications for them.
 // Settings saved by an earlier version lack newer alert fields, so defaults fill them in.
 const settings=()=>{const saved=store.get('settings',structuredClone(defaults)),stored={...saved,alerts:{...defaults.alerts,...saved.alerts}};return pinned?{...stored,username:pinned}:stored};
 // saveSettings below rejects any attempt to report on a different account.
 function saveSettings(input){if(!input||typeof input!=='object'||Array.isArray(input))throw bad('Settings must be an object.');if(pinned&&'username'in input&&input.username!==pinned)throw bad('The Sleeper username is set by this server\'s configuration.');const previous=settings(),next=validateSettings(pinned?{...input,username:pinned}:input,previous);if(JSON.stringify(previous)===JSON.stringify(next))return next;store.set('settings',next);if(previous.username!==next.username){store.set('worker',{runs:{},reports:[],outbox:[],events:{},baselines:{},reset:0,day:'',count:0,lastScan:0,failures:0});}revision++;snapshot=null;analysisCache.clear();if(JSON.stringify([previous.username,previous.daily,previous.weekly,previous.timezone])!==JSON.stringify([next.username,next.daily,next.weekly,next.timezone]))store.set('scheduleReset',now());return next}
 async function load({outlook=false,force=false}={}){
  const config=settings();if(!config.username)throw bad('Configure a Sleeper username in Integrations.',503);
  if(!force&&snapshot&&now()-snapshot.updatedAt<60000&&(!outlook||snapshot.outlook))return snapshot;
  if(pending){await pending;return load({outlook,force:false})}
  const rev=revision;
  pending=(async()=>{const data=await provider(config,{outlook,force});if(rev!==revision)throw bad('Settings changed during refresh. Retry.',409);snapshot=data;analysisCache.clear();store.set('lastSyncError',null);return data})().catch(e=>{store.set('lastSyncError',{at:now(),message:'Provider refresh failed; check account and connection.'});throw e});
  try{return await pending}finally{pending=null}
 }
 function leagues(data,id){const permitted=data.leagues.filter(l=>l.enabled&&!settings().disabled.includes(l.league_id));if(id&&!permitted.some(l=>l.league_id===id))throw bad('League is unavailable or excluded.',404);return id?permitted.filter(l=>l.league_id===id):permitted}
 function envelope(data,result,warnings=[]){
  const sources=(data.sources||[]).map(s=>({...s,stale:!s.fetchedAt||now()-s.fetchedAt>s.maxAgeMs*1.25+300000}));
  // dataComplete is about the data itself. League-level notes such as an injured starter are warnings, and must not pause alerts for every league.
  const dataIssues=[...data.errors,...sources.filter(s=>s.stale).map(s=>`${s.name} is stale`)];
  const issues=[...data.errors,...sources.filter(s=>s.stale).map(s=>`${s.name} is stale`),...warnings];
  return {schemaVersion:1,generatedAt:now(),season:data.nfl.season,week:data.week,demo:data.demo,sources,complete:issues.length===0,dataComplete:dataIssues.length===0,health:issues.length?'degraded':'healthy',warnings:[...new Set(issues)],...result};
 }
 function model(data,l){if(!data.outlook?.weeks.length)throw bad('No remaining trade weeks.',422);if(data.outlook.errors.length)throw bad('Future projections or schedules are incomplete.',503);return buildSeasonModel({league:l,players:data.players,outlook:data.outlook})}
 async function status({leagueId}={}){const d=await load(),ls=leagues(d,leagueId);return envelope(d,{leagues:ls.map(l=>({id:l.league_id,name:l.name,rosterId:l.mine.roster_id,matchup:l.matchups.find(m=>m.roster_id===l.mine.roster_id)||null})),players:aggregateWatch(ls,d.players,d.games).map(p=>({id:p.id,name:name(d,p.id),team:p.player.team,injuryStatus:p.player.injury_status||null,game:p.game,leagues:p.appearances}))})}
 async function trades({leagueId,limit=10,positions}={},options={}){
  const d=await load({outlook:true,...options}),ls=leagues(d,leagueId),pref=settings().preferences,ideas=[],warnings=[];
  const cachedKey=JSON.stringify([d.updatedAt,leagueId,limit,positions,pref]);if(analysisCache.has(cachedKey)){const cached=analysisCache.get(cachedKey);return envelope(d,{ideas:cached.ideas,filters:cached.filters,limitations:cached.limitations},cached.warnings)}
  for(const l of ls){try{const result=await findTradeIdeas(d,l,model(d,l),pref,{limit:positions?10000:limit});if(result.truncated)warnings.push(`${l.name}: search capped at 10000 pairs`);ideas.push(...result.ideas.filter(r=>!positions||r.get.some(id=>(d.players[id]?.fantasy_positions||[d.players[id]?.position]).some(p=>positions.includes(p)))).map(r=>({...r,type:'trade',leagueId:l.league_id,league:l.name,gain:tradeGains(r).a/r.weeks,send:r.give.map(id=>name(d,id)),receive:r.get.map(id=>name(d,id)),drop:(r.dropA||[]).map(id=>name(d,id))})))}catch(e){warnings.push(`${l.name}: ${reason(e)}`)}}
  ideas.sort((a,b)=>compareTradeIdeas(a,b,pref.tradeOwnBias??.15));
  const result=envelope(d,{ideas:ideas.slice(0,limit),filters:pref,limitations:['Expected-point estimates; no acceptance probabilities, draft picks, or dynasty valuation.']},warnings);
  if(analysisCache.size>30)analysisCache.clear();analysisCache.set(cachedKey,result);return result;
 }
 async function evaluate({leagueId,partnerId,give,get}){
  const d=await load({outlook:true}),l=leagues(d,leagueId)[0],p=l.rosters.find(r=>String(r.roster_id)===String(partnerId)&&r.roster_id!==l.mine.roster_id);if(!p)throw bad('Unknown trade partner.');
  try{const season=model(d,l),pref=settings().preferences,result=season.assessWaivers(season.evaluate(l.mine,p,give,get,{autoDrop:true,protectedA:pref.waiverProtected?.[`${d.user.user_id}:${l.league_id}`]||[]}),l.mine,p,{protectedA:pref.waiverProtected?.[`${d.user.user_id}:${l.league_id}`]||[]});return envelope(d,{result,filters:pref,realismWarnings:realismReasons(result,{minGain:pref.tradeMinGain??0,maxGap:pref.tradeMaxGap??1})},result.complete?[]:['Incomplete starting-lineup projections.'])}catch(e){throw bad(reason(e),e.status||(e?.constructor===Error?422:500))}
 }
 // horizon 'current' ranks pickups for this week. 'next' and 'season' hold one pickup and drop across
 // future weeks, as the waiver view does, and report the gain per week so one threshold fits all three.
 async function opportunities({leagueId,horizon='current'}={},options={}){
  const future=horizon!=='current',d=await load({...options,outlook:future}),results=[],warnings=[],prefs=settings().preferences;
  const weeks=future?waiverWeeks(d.week,horizon,prefs.waiverEndWeek||17).filter(w=>d.outlook?.weeks.includes(w)):[d.week];
  if(future&&(!weeks.length||d.outlook.errors.length))return envelope(d,{opportunities:[],horizon,weeks},[weeks.length?'Future projections or schedules are incomplete.':'No future weeks remain for waiver alerts.']);
  for(const l of leagues(d,leagueId)){try{
   const {ids,locks}=lockedLineup(d,l),value=id=>usableValue(d,l,id,Object.values(locks)),best=optimize(playableIds(l.mine),activeSlots(l),d.players,value,locks,ids);
   const complete=best.complete,gain=Number.isFinite(best.total)?best.total-ids.reduce((sum,id)=>sum+(value(id)||0),0):null;
   if(!complete)warnings.push(`${l.name}: a starting slot has nobody available to fill it`);
   results.push({leagueId:l.league_id,league:l.name,lineup:{...best,current:ids,gain,complete},waivers:(future?futureWaiverRows(d,l,{...d.outlook,weeks},prefs):waiverRows(d,l,prefs)).map(r=>({...r,perWeek:r.gain===null?null:r.gain/weeks.length,benchPerWeek:r.status==='bench'?r.benchGain/weeks.length:null,name:name(d,r.id),dropName:r.drop?name(d,r.drop):null}))});
  }catch(e){warnings.push(`${l.name}: ${reason(e)}`)}}
  return envelope(d,{opportunities:results,horizon,weeks},warnings);
 }
 // A finished week, judged twice: against the most the roster could have scored, and against the
 // lineup the projections advised at kickoff. Only the second gap was a decision anyone could have
 // made differently, and keeping them apart is what stops a recap from being hindsight with a grudge.
 async function recap({leagueId,week}={}){
  const d=await load(),ls=leagues(d,leagueId),warnings=[],recaps=[];
  const target=week??d.week-1;
  if(target<1)throw bad('No week has finished yet this season.',422);
  if(target>d.week)throw bad(`Week ${target} has not been played yet.`,422);
  if(typeof provider.history!=='function')throw bad('This server cannot read past weeks.',503);
  if(target===d.week)warnings.push(`Week ${target} may still be in progress.`);
  for(const l of ls){
   try{
    const history=await provider.history(d.nfl.season,l.league_id,[target]);
    if(!history.data[target])throw bad(`week ${target} is unavailable`,503);
    const {matchups,transactions,stats,projections,games=null,next=null}=history.data[target];
    const review=weekReview({league:l,players:d.players,week:target,matchups,projections});
    const made=moves({league:l,players:d.players,week:target,transactions,matchups,stats,games,next});
    const team=id=>teamName(l,id),named=p=>({...p,name:name(d,p.id),team:team(p.rosterId)});
    const rows=review.rows.map(r=>({...r,team:team(r.rosterId),opponent:r.opponentId==null?null:team(r.opponentId),
     decisions:r.decisions.map(x=>({...x,satName:name(d,x.sat),playedName:name(d,x.played)}))}));
    // Lineups stay as ids and share one name table, rather than repeating names twelve rosters over.
    const ids=new Set(review.rows.flatMap(r=>[...(r.starters||[]),...(r.bestLineup||[])]).filter(Boolean));
    const moveRows=made.rows.map(r=>({...r,adds:r.adds.map(named),drops:r.drops.map(named),teams:(r.rosterIds||[]).map(team)}));
    // The pick of the week is one of the rows, so it has to be the named copy and not the raw one.
    const best=made.summary.best?moveRows[made.rows.indexOf(made.summary.best)]??null:null;
    recaps.push({leagueId:l.league_id,league:l.name,rosterId:l.mine.roster_id,team:team(l.mine.roster_id),
     summary:review.summary,rows,moves:{...made,rows:moveRows,summary:{...made.summary,best}},
     names:Object.fromEntries([...ids].map(id=>[id,name(d,id)]))});
   }catch(e){warnings.push(`${l.name}: ${reason(e)}`)}
  }
  return envelope(d,{recapWeek:target,recaps,limitations:['Graded on one week of results; a stash can look bad and age well.',
   'A move that cleared after the week’s last kickoff is judged on the week it could first affect, and stays ungraded until those games are played.']},warnings);
 }
 async function digest({period='daily'}={}){
  const [state,opps,trade]=await Promise.all([status(),opportunities(),trades({limit:3})]);
  const actions=[...opps.opportunities.flatMap(l=>[...(l.lineup.complete&&l.lineup.gain>.25?[{type:'lineup',leagueId:l.leagueId,league:l.league,gain:l.lineup.gain,text:`${l.league}: lineup changes project +${l.lineup.gain.toFixed(1)} points this week.`}]:[]),...l.waivers.filter(w=>w.status==='upgrade').slice(0,1).map(w=>({type:'waiver',leagueId:l.leagueId,league:l.league,gain:w.gain,text:`${l.league}: add ${w.name}${w.dropName?`, drop ${w.dropName}`:''}; projected +${w.gain.toFixed(1)} points this week.`}))]),...trade.ideas.map(t=>({...t,text:`${t.league}: ${t.send.join(' + ')} for ${t.receive.join(' + ')}; projected +${t.gain.toFixed(1)} points/week (partner +${(t.gainB/t.weeks).toFixed(1)}).`}))].sort((a,b)=>b.gain-a.gain).slice(0,3);
  const warnings=[...new Set([...state.warnings,...opps.warnings,...trade.warnings])],previous=store.get('worker',{}).reports?.find(r=>r.period===period&&(r.delivery==='accepted'||r.delivery==='archived'));
  const changed=actions.filter(a=>!previous?.actions.some(p=>p.text===a.text));
  const text=[`Awaker ${period} report · Week ${state.week}${state.demo?' · SAMPLE DATA':''}`,state.leagues.map(l=>`${l.name}: ${Number.isFinite(l.matchup?.points)?l.matchup.points.toFixed(1):'unavailable'} matchup points`).join('\n'),...actions.map(a=>a.text),changed.length?`${changed.length} new or changed recommendation(s).`:'No material changes.',warnings.length?`Data limitations: ${warnings.join('; ')}`:'Projections are estimates.'].filter(Boolean).join('\n');
  const complete=state.complete&&opps.complete&&trade.complete,sources=[...new Map([...state.sources,...opps.sources,...trade.sources].map(s=>[s.name,s])).values()];
  return {...state,generatedAt:now(),sources,complete,health:complete?'healthy':'degraded',warnings,period,actions,changes:changed.length,text};
 }
 return {settings,saveSettings,usernameLocked:()=>!!pinned,load,status,trades,evaluate,opportunities,recap,digest,envelope,client:async(force=false,have=null)=>{const loaded=await load({force}),{outlook,...data}=loaded;
  // The browser loads its own outlook, and it keeps the player directory it already has.
  if(have&&String(have)===String(data.playersAt))delete data.players;
  return {data,settings:settings()}}};
}
