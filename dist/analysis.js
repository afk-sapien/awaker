import {activeSlots,eligible,projected,optimize,availableIds,playableIds,tradeCandidateIds,waiverMove} from './engine.js';
import {realismReasons,compareTradeIdeas,tradeGains} from './trades.js';
import {teamName} from './league.js';
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
 // Shortlisted by what a player can still score this week. By raw projection, players whose games are
 // over fill every spot from Sunday night on and the Monday pickup that would help is never looked at.
 const candidates=[...new Set([...free.filter(id=>trending.has(id)).sort((a,b)=>trending.get(b)-trending.get(a)).slice(0,30),...shortlist(free.filter(id=>value(id)!==null),data.players,value)])];
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
export async function findTradeIdeas(data,league,model,prefs={}, {limit=20,maxPairs=10000,maxPackages=1000,packages=true,cancelled=()=>false}={}){
 const excluded=prefs.tradeExcluded||{give:['DEF'],get:['DEF']},minGain=prefs.tradeMinGain??0,maxGap=prefs.tradeMaxGap??1,bias=prefs.tradeOwnBias??.15;
 // Evaluate roster impact before value balance. A useful bench player can have
 // zero value above the single best free agent while still fixing another team.
 const candidate=(roster,side)=>tradeCandidateIds(playableIds(roster),data.players,excluded[side]).filter(id=>Number.isFinite(model.totals[id])&&model.totals[id]>0&&!unavailable.includes(data.players[id]?.injury_status));
 const own=candidate(league.mine,'give'),ideas=[],nearMisses=[],diagnostics={offeredPlayers:own.length,partners:0,incomplete:0,noMutualBenefit:0,waiverRejected:0,belowMinimum:0,valueFiltered:0,mutual:0,packages:0};let checked=0,truncated=false;
 const protectedA=prefs.waiverProtected?.[`${data.user?.user_id}:${league.league_id}`]||[],singles=new Map();
 // Judges one evaluated offer the same way whatever its size. Returns true when it is listed.
 const consider=(result,partner)=>{
  if(!result.complete){diagnostics.incomplete++;return false}
  // Even with a zero weekly minimum, both teams must gain > 0.25 season
  // points: neutral offers give the other manager no projected incentive.
  if(result.gainA<=.25||result.gainB<=.25){diagnostics.noMutualBenefit++;return false}
  if(model.assessWaivers)result=model.assessWaivers(result,league.mine,partner,{protectedA});
  const gains=tradeGains(result);
  diagnostics.mutual++;
  const offer={...result,partnerId:partner.roster_id,partner:teamName(league,partner.roster_id).team};
  if(gains.a<=.25||gains.b<=.25){
   diagnostics.waiverRejected++;
   nearMisses.push({...offer,filterReasons:[gains.a<=.25?'Your pickup alternative is as good or better.':'Their pickup alternative is as good or better.']});return false;
  }
  const below=gains.a/result.weeks+1e-8<minGain||gains.b/result.weeks+1e-8<minGain;
  const valueBlocked=maxGap<1&&(result.valueGap===null||result.valueGap>maxGap);
  if(below)diagnostics.belowMinimum++;if(valueBlocked)diagnostics.valueFiltered++;
  if(!below&&!valueBlocked){ideas.push(offer);return true}
  nearMisses.push({...offer,filterReasons:realismReasons(result,{minGain,maxGap})});return false;
 };
 outer:for(const partner of league.rosters.filter(r=>r.roster_id!==league.mine.roster_id)){
  const incoming=candidate(partner,'get');if(incoming.length)diagnostics.partners++;
  for(const a of own)for(const b of incoming){
   if(cancelled())return {ideas:[],truncated:true,cancelled:true};
   if(checked>=maxPairs){truncated=true;break outer}checked++;
   if(checked%50===0)await new Promise(r=>setTimeout(r,0));
   let result;try{result=model.evaluate(league.mine,partner,[a],[b])}catch{diagnostics.incomplete++;continue}
   const listed=consider(result,partner);
   if(result.complete)singles.set(`${partner.roster_id}:${a}:${b}`,{gainA:result.gainA,gainB:result.gainB,listed});
  }
 }
 // Two for one, either way. Sending a second player can only cost the sender, so a package is worth
 // trying only when the side sending two already gains from each swap on its own. What the second
 // player buys is the other side's yes. Swaps that are listed by themselves need no sweetener.
 // The sender's smaller single gain caps what the package can be worth to him, so the most
 // promising packages are tried first and the long tail is never evaluated.
 if(packages&&!truncated){
  const queue=[],single=(partner,a,b)=>singles.get(`${partner.roster_id}:${a}:${b}`),floor=Math.max(.25,minGain*(model.weeks?.length||1));
  for(const partner of league.rosters.filter(r=>r.roster_id!==league.mine.roster_id)){
   // Guessing what a player adds sets lineups too, so this loop yields like the search does.
   if(cancelled())return {ideas:[],truncated:true,cancelled:true};
   await new Promise(r=>setTimeout(r,0));
   const incoming=candidate(partner,'get');
   // The receiver's side is guessed as the better single swap plus what the other player adds to his lineups alone.
   const extra=(roster,id)=>model.addValue?model.addValue(roster,id):0;
   const add=(give,get,[p,x],[q,y],sender,receiver,roster)=>{const mine=Math.min(x[sender],y[sender]),theirs=Math.max(x[receiver]+extra(roster,q),y[receiver]+extra(roster,p));queue.push({partner,give,get,promise:sender==='gainA'?mine+(1-bias)*theirs:theirs+(1-bias)*mine})};
   for(const b of incoming){const able=own.map(a=>[a,single(partner,a,b)]).filter(([,s])=>s&&!s.listed&&s.gainA>floor);for(let i=0;i<able.length;i++)for(let k=i+1;k<able.length;k++)add([able[i][0],able[k][0]],[b],able[i],able[k],'gainA','gainB',partner)}
   for(const a of own){const able=incoming.map(b=>[b,single(partner,a,b)]).filter(([,s])=>s&&!s.listed&&s.gainB>floor);for(let i=0;i<able.length;i++)for(let k=i+1;k<able.length;k++)add([a],[able[i][0],able[k][0]],able[i],able[k],'gainB','gainA',league.mine)}
  }
  diagnostics.packageCandidates=queue.length;
  queue.sort((x,y)=>y.promise-x.promise);
  const found=new Map();let tried=0;
  for(const {partner,give,get} of queue.slice(0,maxPackages)){
   if(cancelled())return {ideas:[],truncated:true,cancelled:true};
   checked++;diagnostics.packages++;if(++tried%25===0)await new Promise(r=>setTimeout(r,0));
   let result;try{result=model.evaluate(league.mine,partner,give,get,{autoDrop:true,protectedA})}catch{diagnostics.incomplete++;continue}
   if(!consider(result,partner))continue;
   // The same deal with a different throw-in is one idea, not five. The best version stays.
   const offer=ideas.pop(),key=`${partner.roster_id}:${give.length===1?`give:${give[0]}`:`get:${get[0]}`}`,held=found.get(key);
   if(!held||compareTradeIdeas(offer,held,bias)<0)found.set(key,offer);
  }
  ideas.push(...found.values());
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
 const name=partner=>teamName(league,partner.roster_id).team;
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
// Going after one player: what would it take to prise him off the team that has him. The mirror of
// shopPlayer. Only his owner can sell, so this compares every player of mine against him one for one.
// Their gain stops being a sanity check and becomes the price: it has to be positive or they have no
// reason to answer, and the cheapest offer that clears it is the one to open with.
export async function acquirePlayer(data,league,model,playerId,prefs={},{limit=12,cancelled=()=>false}={}){
 const excluded=prefs.tradeExcluded||{give:['DEF'],get:['DEF']};
 const held=r=>[...(r.players||[]),...(r.reserve||[]),...(r.taxi||[])];
 const owner=(league.rosters||[]).find(r=>r.roster_id!==league.mine.roster_id&&held(r).includes(playerId));
 if(!owner)throw Error('He is not on another roster in this league.');
 // Trades are valued on the rosters that can start, so a parked player has nothing to compare.
 if((owner.reserve||[]).includes(playerId))throw Error('He is on their injured reserve, so there is no trade to value until he is activated.');
 if((owner.taxi||[]).includes(playerId))throw Error('He is on their taxi squad, so there is no trade to value until he is promoted.');
 const outgoing=tradeCandidateIds(playableIds(league.mine),data.players,excluded.give)
  .filter(id=>Number.isFinite(model.totals[id])&&model.totals[id]>0&&!unavailable.includes(data.players[id]?.injury_status));
 const offers=[];let lift=null,best=null,checked=0;
 for(const b of outgoing){
  if(cancelled())return {cancelled:true};
  if(++checked%40===0)await new Promise(r=>setTimeout(r,0));
  let result;try{result=model.evaluate(league.mine,owner,[b],[playerId])}catch{continue}
  if(!result.complete)continue;
  // The most he could add here, and the most any one player of mine does for them. The second is
  // what decides whether there is a deal at all, whatever he would be worth to me.
  lift=Math.max(lift??-Infinity,result.gainA);best=Math.max(best??-Infinity,result.gainB);
  if(result.gainB<=.25)continue;
  if(model.assessWaivers)result=model.assessWaivers(result,league.mine,owner,{protectedA:prefs.waiverProtected?.[`${data.user?.user_id}:${league.league_id}`]||[]});
  offers.push({...result,partnerId:owner.roster_id,partner:teamName(league,owner.roster_id).team});
 }
 offers.sort((a,b)=>tradeGains(b).a-tradeGains(a).a);
 return {playerId,ownerId:owner.roster_id,owner:teamName(league,owner.roster_id).team,offers:offers.slice(0,limit),
  lift,best,considered:outgoing.length,value:model.valueAboveReplacement?.[playerId]??null,
  total:model.totals[playerId]??null,weeks:model.weeks?.length??null};
}
