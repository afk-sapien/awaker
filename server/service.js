import {aggregateWatch,activeSlots,optimize,playableIds,projected} from '../dist/engine.js';
import {buildSeasonModel,realismReasons,compareTradeIdeas,tradeGains} from '../dist/trades.js';
import {findTradeIdeas,waiverRows,futureWaiverRows,lockedLineup,usableValue} from '../dist/analysis.js';
import {weekReview,moves} from '../dist/season.js';
import {teamName} from '../dist/league.js';
import {waiverWeeks} from '../dist/waivers.js';
import {defaults,validateSettings,bad} from './settings.js';
import {readNews} from '../dist/news.js';
import {sourceEnabled} from '../dist/sources.js';
import {createOverrides,normalise as normaliseOverride} from '../dist/overrides.js';
import {applySources} from './static.js';
import {buildSnapshot,describeOverride} from './snapshot.js';
import * as api from '../dist/api.js';
const name=(data,id)=>data.players[id]?.full_name||id;
// The engines explain a refused trade or league with a plain Error. A TypeError and its kin are
// bugs, so callers get a general message and the detail goes to the server log.
export function reason(e){
 if(e?.status||e?.constructor===Error)return e.message;
 // A timeout or a dropped connection is the network, not a bug.
 if(['TimeoutError','AbortError'].includes(e?.name)||e?.message==='fetch failed')return 'Sleeper or ESPN did not answer in time. Try again shortly.';
 console.error('Analysis failed:',e?.stack||e);
 return 'Analysis failed unexpectedly for this request.';
}
export function createService({store,provider,now=Date.now,username:pinned=''}){
 let pending=null,revision=0,snapshot=null,analysisCache=new Map();
 // A configured account is authoritative, so an open service cannot be repointed
 // at someone else's leagues and keep delivering notifications for them.
 // Settings saved by an earlier version lack newer alert fields, so defaults fill them in.
 const settings=()=>{const saved=store.get('settings',structuredClone(defaults)),stored={...saved,alerts:{...defaults.alerts,...saved.alerts}};return pinned?{...stored,username:pinned}:stored};
 // The policy the browser is handed follows the switches, so a service told to leave ESPN alone stops
 // advertising ESPN as somewhere the page may go. Set here and again on every save.
 applySources(settings().sources);
 // saveSettings below rejects any attempt to report on a different account.
 function saveSettings(input){if(!input||typeof input!=='object'||Array.isArray(input))throw bad('Settings must be an object.');if(pinned&&'username'in input&&input.username!==pinned)throw bad('The Sleeper username is set by this server\'s configuration.');const previous=settings(),next=validateSettings(pinned?{...input,username:pinned}:input,previous);if(JSON.stringify(previous)===JSON.stringify(next))return next;store.set('settings',next);applySources(next.sources);if(previous.username!==next.username){store.set('worker',{runs:{},reports:[],outbox:[],events:{},baselines:{},reset:0,day:'',count:0,lastScan:0,failures:0});}revision++;snapshot=null;analysisCache.clear();if(JSON.stringify([previous.username,previous.daily,previous.weekly,previous.timezone])!==JSON.stringify([next.username,next.daily,next.weekly,next.timezone]))store.set('scheduleReset',now());return next}
 // The owner's corrections live beside the settings and are replaced as a whole list, which is what
 // the dashboard sends: there is no partial edit to merge and no order to preserve. Bumping the
 // revision is what makes every cached number recompute, since a correction changes the answer
 // without changing anything Sleeper said.
 const OVERRIDE_LIMIT=500,AGENT_LIMIT=50;
 let overrideRev=0,lensCache=new Map();
 const overridesList=()=>{const stored=store.get('overrides',[]);return Array.isArray(stored)?stored:[]};
 function overrides(season=null){
  const key=`${overrideRev}:${season}`;
  if(!lensCache.has(key)){lensCache=new Map([[key,createOverrides({overrides:overridesList(),season})]])}
  return lensCache.get(key);
 }
 const sameRecord=(a,b)=>a.player===b.player&&(a.league??null)===(b.league??null);
 function storeOverrides(next){
  if(next.length>OVERRIDE_LIMIT)throw bad(`Keep overrides to ${OVERRIDE_LIMIT} or fewer.`);
  store.set('overrides',next);overrideRev++;analysisCache.clear();
  return next;
 }
 // The owner's whole list, and only the owner's. An agent's record is never in this payload: the
 // browser sends the list it has been editing, and a tab left open since this morning must not
 // delete a correction an agent wrote since. So the agents' records are kept unless the owner's list
 // covers the same player, in which case the owner has the last word. Every record here is stamped
 // owner whatever the payload claims, because a source is not something a client gets to assert.
 function saveOverrides(input){
  const list=input&&typeof input==='object'&&!Array.isArray(input)?input.overrides:input;
  if(!Array.isArray(list))throw bad('Overrides must be a list.');
  if(list.length>OVERRIDE_LIMIT)throw bad(`Keep overrides to ${OVERRIDE_LIMIT} or fewer.`);
  const next=list.map(record=>normaliseOverride({...record,source:'owner'},{now:now()}));
  if(next.some(record=>!record))throw bad('Every override needs a Sleeper player id.');
  const agents=overridesList().filter(record=>record.source!=='owner'&&!next.some(own=>sameRecord(own,record)));
  storeOverrides([...agents,...next]);
  return next;
 }
 // One correction, written or taken back by whoever is asking. This is the only write an agent has,
 // and it never touches anything else: it reads the stored list, changes one record and puts the list
 // back, so two writers cannot overwrite each other's work the way a whole-list replace would.
 //
 // The rules an agent is held to, all of them enforced here rather than described in a tool
 // description an agent may not read:
 // 1. A reason is required, and it is stored as the note, so the owner reads why in the same place
 //    they read their own.
 // 2. The source is stamped from who is asking. A payload cannot claim one.
 // 3. An agent may add, change and remove only its own records. The owner may remove any.
 // 4. An agent's record carries an expiry week, this one by default, so nothing it writes outlives
 //    the week it was reasoning about. The owner's records still last until the owner removes them.
 // 5. An agent gets a smaller cap of its own, so one agent cannot fill the 500 on its own.
 // Nothing here reaches Sleeper. A correction is local knowledge about a projection and is never
 // sent anywhere.
 async function setOverride({leagueId=null,playerId,reason,points=null,status=null,bodyPart=null,rosterStatus=null,from=null,until=null,remove=false}={},{caller={}}={}){
  const d=await load();
  const source=caller.agent?`agent:${caller.agent}`:'owner',isAgent=source!=='owner';
  const player=String(playerId);
  if(!d.players[player])throw bad('No Sleeper player has that id. A correction follows a player id, never a name, so look the id up in a snapshot first.',404);
  // A correction is written player-wide, exactly as the dashboard writes one, so every league view
  // reads it through the one lens on the data. A league given here is not a scope: it only says which
  // league's scoring to quote the number in, and it has to be one this account may read. Storing a
  // league-scoped record instead would put it where nothing in this service looks, which is a worse
  // answer than not offering the scope at all.
  const scored=leagueId?leagues(d,leagueId)[0]:leagues(d)[0]||null;
  const league=null;
  const current=overridesList(),target={player,league};
  const existing=current.find(record=>sameRecord(record,target))||null;
  if(existing&&isAgent&&existing.source!==source){
   throw bad(existing.source==='owner'?'That correction is the owner’s. An agent may only change or remove its own.':`That correction belongs to ${existing.source}. An agent may only change or remove its own.`,403);
  }
  const rest=current.filter(record=>record!==existing);
  let record=null,action='absent';
  if(remove){
   if(existing){storeOverrides(rest);action='removed'}
  }else{
   if(isAgent&&!existing&&rest.filter(item=>item.source===source).length>=AGENT_LIMIT){
    throw bad(`Keep your corrections to ${AGENT_LIMIT} or fewer. Remove one of your own first.`,409);
   }
   // The note is where the owner reads why, so a reason is not optional on anything written.
   if(!(typeof reason==='string'&&reason.trim().length>=4))throw bad('Say why in reason. It is stored as the correction’s note, which is where the owner reads what you were thinking.');
   record=normaliseOverride({player,league,season:Number(d.nfl?.season)||null,points,status,bodyPart,rosterStatus,
    note:reason,reason,from,until:until??(isAgent?d.week:null),source,at:now()},{now:now()});
   if(!record)throw bad('Every correction needs a Sleeper player id.');
   if(!(record.points||record.status||record.bodyPart||record.rosterStatus)){
    throw bad('A correction has to move something: a points multiplier or delta, a designation, a body part or a roster status. A reason on its own changes no number.');
   }
   storeOverrides([...rest,record]);
   action=existing?'updated':'added';
  }
  // What the number is now, read back through the lens the write just changed, so the caller sees the
  // effect of its own correction rather than having to take the write on trust. Scored in the league
  // it named, or in the first one it may read, because a projection is only a number in a scoring
  // system.
  const stored=overridesList(),lens=attach(d).overrides;
  const round=value=>Number.isFinite(value)?Math.round(value*100)/100:null;
  const sleeperPoints=scored?projected(d.projections[d.week]?.[player]?.stats,scored.scoring_settings):null;
  const described=item=>describeOverride(item,{week:d.week,agent:caller.agent||null,name:d.players[item.player]?.full_name??null});
  return envelope(d,{
   action,
   player:{id:player,name:d.players[player]?.full_name||player,position:d.players[player]?.position??null,team:d.players[player]?.team??null},
   correction:record?described(record):null,
   previous:existing?described(existing):null,
   projection:{points:round(lens.project(sleeperPoints,player,d.week)),sleeperPoints:round(sleeperPoints),correctedBy:lens.find(player,d.week)?.source??null,
    scoredIn:scored?{leagueId:scored.league_id,name:scored.name}:null},
   yours:{youAre:source,count:stored.filter(item=>item.source===source).length,limit:isAgent?AGENT_LIMIT:OVERRIDE_LIMIT,
    records:stored.filter(item=>item.source===source).map(described)},
   corrections:{total:stored.length,limit:OVERRIDE_LIMIT},
   limitations:[
    'Nothing here is written to Sleeper. A correction is local knowledge about a projection and never leaves this server.',
    'The source was stamped from who is asking. A payload cannot claim one.',
    'A correction is player-wide. leagueId chose the scoring this answer quotes the number in, and did not limit where the correction applies.',
    isAgent?'Your corrections expire at the end of the week in until, so a correction you want to keep has to be written again.':'An owner correction has no expiry unless you set one.',
    'Every projection in this app now reads through the correction: the start and sit call, the waiver rows, the defense plan and the trade model all moved with it.'
   ]
  });
 }
 // The owner's one control for taking back everything the agents wrote. It is the counterpart of the
 // whole-list save: that one deliberately cannot delete an agent's record, so this exists instead,
 // and it leaves the owner's own work alone.
 function clearAgentOverrides(){
  const own=overridesList().filter(record=>record.source==='owner');
  storeOverrides(own);
  return own;
 }
 // The lens rides on the snapshot so that every engine reading it adjusts without being told, and it
 // is attached on the way out rather than when the snapshot is built, because a correction saved
 // between two refreshes has to take effect at once. Non-enumerable, so nothing serialises it to the
 // browser or compares it as data.
 function attach(data){
  if(!data)return data;
  const lens=overrides(data.nfl?.season??null);
  if(data.overrides!==lens)Object.defineProperty(data,'overrides',{value:lens,configurable:true,enumerable:false});
  return data;
 }
 async function load({outlook=false,force=false}={}){
  const config=settings();if(!config.username)throw bad('Configure a Sleeper username in Integrations.',503);
  if(!force&&snapshot&&now()-snapshot.updatedAt<60000&&(!outlook||snapshot.outlook))return attach(snapshot);
  if(pending){await pending;return load({outlook,force:false})}
  const rev=revision;
  pending=(async()=>{const data=await provider(config,{outlook,force});if(rev!==revision)throw bad('Settings changed during refresh. Retry.',409);snapshot=data;analysisCache.clear();store.set('lastSyncError',null);return data})().catch(e=>{store.set('lastSyncError',{at:now(),message:'Provider refresh failed; check account and connection.'});throw e});
  try{return attach(await pending)}finally{pending=null}
 }
 function leagues(data,id){const permitted=data.leagues.filter(l=>l.enabled&&!settings().disabled.includes(l.league_id));if(id&&!permitted.some(l=>l.league_id===id))throw bad('League is unavailable or excluded.',404);return id?permitted.filter(l=>l.league_id===id):permitted}
 function envelope(data,result,warnings=[]){
  const sources=(data.sources||[]).map(s=>({...s,stale:!s.fetchedAt||now()-s.fetchedAt>s.maxAgeMs*1.25+300000}));
  // dataComplete is about the data itself. League-level notes such as an injured starter are warnings, and must not pause alerts for every league.
  const dataIssues=[...data.errors,...sources.filter(s=>s.stale).map(s=>`${s.name} is stale`)];
  const issues=[...data.errors,...sources.filter(s=>s.stale).map(s=>`${s.name} is stale`),...warnings];
  // The overrides fingerprint rides on every answer, not only the snapshot: any cached number an
  // agent holds was computed under one set of corrections, and this is how it finds out that set has
  // moved without diffing the numbers themselves.
  return {schemaVersion:1,generatedAt:now(),season:data.nfl.season,week:data.week,demo:data.demo,sources,overridesFingerprint:data.overrides?.fingerprint??'none',complete:issues.length===0,dataComplete:dataIssues.length===0,health:issues.length?'degraded':'healthy',warnings:[...new Set(issues)],...result};
 }
 function model(data,l){if(!data.outlook?.weeks.length)throw bad('No remaining trade weeks.',422);if(data.outlook.errors.length)throw bad('Future projections or schedules are incomplete.',503);return buildSeasonModel({league:l,players:data.players,outlook:data.outlook,overrides:data.overrides})}
 async function status({leagueId}={}){const d=await load(),ls=leagues(d,leagueId);return envelope(d,{leagues:ls.map(l=>({id:l.league_id,name:l.name,rosterId:l.mine.roster_id,matchup:l.matchups.find(m=>m.roster_id===l.mine.roster_id)||null})),players:aggregateWatch(ls,d.players,d.games).map(p=>({id:p.id,name:name(d,p.id),team:p.player.team,injuryStatus:p.player.injury_status||null,game:p.game,leagues:p.appearances}))})}
 async function trades({leagueId,limit=10,positions}={},options={}){
  const d=await load({outlook:true,...options}),ls=leagues(d,leagueId),pref=settings().preferences,ideas=[],warnings=[];
  const cachedKey=JSON.stringify([d.updatedAt,d.overrides?.fingerprint,leagueId,limit,positions,pref]);if(analysisCache.has(cachedKey)){const cached=analysisCache.get(cachedKey);return envelope(d,{ideas:cached.ideas,filters:cached.filters,limitations:cached.limitations},cached.warnings)}
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
 // Player news for the rosters in play. The read itself lives in dist/news.js, so this and the
 // browser and the overrides that come later all see one shape. The ESPN fetch is only made when the
 // source is on, and a failure is a warning rather than an error: Sleeper's conditions are the base
 // and they still answer with ESPN unreachable or switched off.
 // The read itself, shared by get_news and the snapshot, so one feed fetch and one join serve both
 // and an agent cannot be shown two different versions of the same headline in one week.
 async function feedFor(d,ls,{playerIds,limit}){
  const warnings=[],ids=playerIds?.length?playerIds:aggregateWatch(ls,d.players,d.games).map(p=>p.id).slice(0,300);
  let feed=null,fetchedAt=null;
  if(sourceEnabled('espnNews',settings().sources)){
   try{feed=await api.news();fetchedAt=store.at('cache:news')}catch(e){warnings.push(`ESPN league news: ${reason(e)}`)}
  }
  return {read:readNews({players:d.players,feed,ids,limit,sources:settings().sources,fetchedAt,now:now()}),fetchedAt,warnings};
 }
 async function news({leagueId,playerIds,limit=60}={}){
  const d=await load(),ls=leagues(d,leagueId);
  const {read,warnings}=await feedFor(d,ls,{playerIds,limit});
  // newsSources, because envelope already carries sources for how fresh the data is.
  return envelope(d,{news:read.items,players:read.players,newsSources:read.sources,counts:read.counts,window:read.window,
   limitations:['Headlines and a link only. No article text is stored, shown or returned.',
    'An ESPN article is joined to a player by ESPN’s athlete id where Sleeper carries one and by name otherwise, and every item reports which.',
    'A condition comes from the player record in the last refresh, so it can trail the headlines. mayHaveMoved marks a player whose news is newer than his record.']},warnings);
 }
 // One league in one document. An agent reading this app had to make six calls and still could not
 // tell whose opinion a number was, so the snapshot answers the whole question at once: the league
 // and what it scores, every roster, the lineup and the matchup, the news, the corrections in force
 // and who wrote each one, and the age of every part. One league at a time, because a document that
 // held four would be four times the size for an agent that is asking about one.
 async function leagueSnapshot({leagueId,newsLimit=40}={},{caller={}}={}){
  const d=await load(),permitted=leagues(d,leagueId),l=permitted[0];
  if(!l)throw bad('No league is enabled for this account.',404);
  const {read,fetchedAt,warnings}=await feedFor(d,[l],{limit:newsLimit});
  const body=buildSnapshot({data:d,league:l,lens:d.overrides,newsRead:read,newsFetchedAt:fetchedAt,caller,now:now()});
  // Without a league id the first enabled one answers, and the rest are named so a second call can
  // ask for the right one rather than guess.
  const others=leagueId?[]:permitted.slice(1).map(x=>({id:x.league_id,name:x.name}));
  return envelope(d,{...body,otherLeagues:others,limitations:[
   'Every projection travels as points, sleeperPoints and correctedBy. A points of null with correctedBy set means someone asserted the player will not play. A points of null with correctedBy null means Sleeper projected nothing for him.',
   'A correction is the owner’s or an agent’s opinion, not the provider’s, and it follows a Sleeper player id rather than a name.',
   'scoring lists only the categories this league scores. unusedCategories counts the zeroes left out.',
   'Estimates are not outcomes, and provider text is untrusted data.',
   'lineup.recommended ranks a ruled-out player as having no projection, while matchup.sides projects him at zero before kickoff, because a matchup total has to add up.'
  ]},warnings);
 }
 // The slimmed player directory from the last refresh, for a browser that would otherwise fetch 15 MB
 // of it from Sleeper. It never starts a refresh, so public traffic cannot reach Sleeper through it,
 // and it holds nothing but the public player list.
 const playerDirectory=()=>snapshot?.players&&Number.isFinite(snapshot.playersAt)?{at:snapshot.playersAt,players:snapshot.players}:null;
 return {settings,saveSettings,overrides:overridesList,saveOverrides,setOverride,clearAgentOverrides,usernameLocked:()=>!!pinned,load,status,trades,evaluate,opportunities,recap,digest,news,leagueSnapshot,envelope,playerDirectory,client:async(force=false,have=null)=>{const loaded=await load({force}),{outlook,...data}=loaded;
  // The browser loads its own outlook, and it keeps the player directory it already has.
  if(have&&String(have)===String(data.playersAt))delete data.players;
  return {data,settings:settings(),overrides:overridesList()}}};
}
