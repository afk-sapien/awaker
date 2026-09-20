import {activeSlots,eligible,projected,optimize,availableIds,playableIds,tradeCandidateIds,waiverMove} from './engine.js';
import {realismReasons,compareTradeIdeas,tradeGains} from './trades.js';
import {buildWaiverOutlook} from './waivers.js';
export const unavailable=['Out','IR','Suspended','PUP','Doubtful'];
export function lockedLineup(data,league){
 const ids=league.matchups.find(m=>m.roster_id===league.mine.roster_id)?.starters||league.mine.starters||[],locks={};
 ids.forEach((id,i)=>{const g=data.games[data.players[id]?.team];if(id&&id!=='0'&&g&&g.state!=='pre')locks[i]=id});
 return {ids,locks};
}
export function usableValue(data,league,id,locked=[]){
 const p=data.players[id],g=data.games[p?.team];
 if(!locked.includes(id)&&(unavailable.includes(p?.injury_status)||g&&g.state!=='pre'))return null;
 return projected(data.projections[data.week]?.[id]?.stats,league.scoring_settings);
}
// The best few at every position. One list by raw points filled up with quarterbacks and defenses and
// never evaluated the tight end who would have started.
const shortlist=(ids,players,score,each=8)=>{const seen={};return [...ids].sort((a,b)=>score(b)-score(a)).filter(id=>{const pos=players[id]?.position||'?';seen[pos]=(seen[pos]||0)+1;return seen[pos]<=each})};
const moveRank=r=>r.gain??(r.status==='bench'?r.benchGain-500:-999);
export function waiverRows(data,league,prefs={}){
 const excluded=prefs.waiverExcluded||{add:['K'],drop:[]},slots=activeSlots(league),trending=new Map(data.trends.map(t=>[t.player_id,t.count]));
 const free=tradeCandidateIds(availableIds(league,data.players),data.players,excluded.add).filter(id=>slots.some(slot=>eligible(data.players[id],slot)));
 const roster=playableIds(league.mine),{ids,locks}=lockedLineup(data,league),fixed=Object.values(locks),values=new Map();
 const value=id=>{if(!values.has(id))values.set(id,usableValue(data,league,id,fixed));return values.get(id)};
 const projection=id=>projected(data.projections[data.week]?.[id]?.stats,league.scoring_settings);
 const baseline=optimize(roster,slots,data.players,value,locks);
 const candidates=[...new Set([...free.filter(id=>trending.has(id)).sort((a,b)=>trending.get(b)-trending.get(a)).slice(0,30),...shortlist(free.filter(id=>projection(id)!==null),data.players,projection)])];
 return candidates.map(id=>({id,count:trending.get(id)||0,projection:projection(id),...waiverMove({id,roster,slots,players:data.players,value,locked:locks,protectedIds:prefs.waiverProtected?.[`${data.user.user_id}:${league.league_id}`]||[],starterIds:prefs.protectStarters!==false?ids:[],capacity:league.roster_positions.filter(s=>!['IR','TAXI'].includes(s)).length,samePosition:prefs.samePositionDrops!==false,excludedDropPositions:excluded.drop,baseline})})).sort((a,b)=>moveRank(b)-moveRank(a)||b.count-a.count).slice(0,25);
}
// The same pickup and drop held across a window of future weeks. Used by the waiver view and by
// background alerts, so both rank a pickup the same way.
export function futureWaiverRows(data,league,outlook,prefs={}){
 const excluded=prefs.waiverExcluded||{add:['K'],drop:[]},slots=activeSlots(league),trending=new Map(data.trends.map(t=>[t.player_id,t.count]));
 const model=buildWaiverOutlook({league,players:data.players,outlook,protectedIds:prefs.waiverProtected?.[`${data.user.user_id}:${league.league_id}`]||[],starterIds:prefs.protectStarters!==false?lockedLineup(data,league).ids:[],excludedDropPositions:excluded.drop,samePosition:prefs.samePositionDrops!==false});
 const free=tradeCandidateIds(availableIds(league,data.players),data.players,excluded.add).filter(id=>slots.some(slot=>eligible(data.players[id],slot)));
 const candidates=[...new Set([...free.filter(id=>trending.has(id)).sort((a,b)=>trending.get(b)-trending.get(a)).slice(0,30),...shortlist(free.filter(id=>model.totals[id]>0),data.players,id=>model.totals[id])])];
 return candidates.map(id=>({id,count:trending.get(id)||0,projection:model.totals[id],...model.evaluate(id)})).sort((a,b)=>moveRank(b)-moveRank(a)||b.count-a.count).slice(0,25);
}
export async function findTradeIdeas(data,league,model,prefs={}, {limit=20,maxPairs=10000,cancelled=()=>false}={}){
 const excluded=prefs.tradeExcluded||{give:['DEF'],get:['DEF']},minGain=prefs.tradeMinGain??0,maxGap=prefs.tradeMaxGap??1,bias=prefs.tradeOwnBias??.15;
 // Evaluate roster impact before value balance. A useful bench player can have
 // zero value above the single best free agent while still fixing another team.
 const candidate=(roster,side)=>tradeCandidateIds(playableIds(roster),data.players,excluded[side]).filter(id=>Number.isFinite(model.totals[id])&&model.totals[id]>0&&!unavailable.includes(data.players[id]?.injury_status));
 const own=candidate(league.mine,'give'),ideas=[],nearMisses=[],diagnostics={offeredPlayers:own.length,partners:0,incomplete:0,noMutualBenefit:0,waiverRejected:0,belowMinimum:0,valueFiltered:0,mutual:0};let checked=0,truncated=false;
 outer:for(const partner of league.rosters.filter(r=>r.roster_id!==league.mine.roster_id)){
  const incoming=candidate(partner,'get');if(incoming.length)diagnostics.partners++;
  for(const a of own)for(const b of incoming){
   if(cancelled())return {ideas:[],truncated:true,cancelled:true};
   if(checked>=maxPairs){truncated=true;break outer}checked++;
   if(checked%50===0)await new Promise(r=>setTimeout(r,0));
   let result;try{result=model.evaluate(league.mine,partner,[a],[b])}catch{diagnostics.incomplete++;continue}
   if(!result.complete){diagnostics.incomplete++;continue}
   // Even with a zero weekly minimum, both teams must gain > 0.25 season
   // points: neutral offers give the other manager no projected incentive.
   if(result.gainA<=.25||result.gainB<=.25){diagnostics.noMutualBenefit++;continue}
   if(model.assessWaivers)result=model.assessWaivers(result,league.mine,partner,{protectedA:prefs.waiverProtected?.[`${data.user?.user_id}:${league.league_id}`]||[]});
   const gains=tradeGains(result);
   diagnostics.mutual++;
   const user=(league.users||[]).find(u=>u.user_id===partner.owner_id),offer={...result,partnerId:partner.roster_id,partner:user?.metadata?.team_name||user?.display_name||`Team ${partner.roster_id}`};
   if(gains.a<=.25||gains.b<=.25){
    diagnostics.waiverRejected++;
    nearMisses.push({...offer,filterReasons:[gains.a<=.25?'Your pickup alternative is as good or better.':'Their pickup alternative is as good or better.']});continue;
   }
   const below=gains.a/result.weeks+1e-8<minGain||gains.b/result.weeks+1e-8<minGain;
   const valueBlocked=maxGap<1&&(result.valueGap===null||result.valueGap>maxGap);
   if(below)diagnostics.belowMinimum++;if(valueBlocked)diagnostics.valueFiltered++;
   if(!below&&!valueBlocked)ideas.push(offer);
   else nearMisses.push({...offer,filterReasons:realismReasons(result,{minGain,maxGap})});
  }
 }
 const rank=(a,b)=>compareTradeIdeas(a,b,bias);
 ideas.sort(rank);nearMisses.sort(rank);
 return {ideas:ideas.slice(0,limit),nearMisses:nearMisses.slice(0,3),diagnostics,truncated,checked};
}
// Shopping one player: what would each other team give for him, and do they even want him? Unlike the
// trade search this does not require the trade to help you. Moving a player you are done with can cost
// a little, and the page shows that honestly. The other team must still gain, or they have no reason to say yes.
export async function shopPlayer(data,league,model,playerId,prefs={}, {perPartner=3,limit=12,cancelled=()=>false}={}){
 const excluded=prefs.tradeExcluded||{give:['DEF'],get:['DEF']},offers=[],market=[];let checked=0;
 const name=partner=>{const user=(league.users||[]).find(u=>u.user_id===partner.owner_id);return user?.metadata?.team_name||user?.display_name||`Team ${partner.roster_id}`};
 for(const partner of league.rosters.filter(r=>r.roster_id!==league.mine.roster_id)){
  const incoming=tradeCandidateIds(playableIds(partner),data.players,excluded.get).filter(id=>Number.isFinite(model.totals[id])&&model.totals[id]>0&&!unavailable.includes(data.players[id]?.injury_status));
  const found=[];let interest=null;
  for(const b of incoming){
   if(cancelled())return {cancelled:true};
   if(++checked%40===0)await new Promise(r=>setTimeout(r,0));
   let result;try{result=model.evaluate(league.mine,partner,[playerId],[b])}catch{continue}
   if(!result.complete)continue;
   // How much he helps them is judged against the player they would miss least.
   interest=Math.max(interest??-Infinity,result.gainB);
   if(result.gainB<=.25)continue;
   if(model.assessWaivers)result=model.assessWaivers(result,league.mine,partner,{protectedA:prefs.waiverProtected?.[`${data.user?.user_id}:${league.league_id}`]||[]});
   found.push({...result,partnerId:partner.roster_id,partner:name(partner)});
  }
  if(interest!==null)market.push({partnerId:partner.roster_id,partner:name(partner),interest,offers:found.length});
  offers.push(...found.sort((a,b)=>tradeGains(b).a-tradeGains(a).a).slice(0,perPartner));
 }
 offers.sort((a,b)=>tradeGains(b).a-tradeGains(a).a);
 return {playerId,offers:offers.slice(0,limit),market:market.sort((a,b)=>b.interest-a.interest),value:model.valueAboveReplacement?.[playerId]??null,total:model.totals[playerId]??null,weeks:model.weeks?.length??null};
}
