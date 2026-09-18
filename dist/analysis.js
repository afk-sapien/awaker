import {activeSlots,eligible,projected,optimize,availableIds,playableIds,tradeCandidateIds,waiverMove} from './engine.js';
import {realismReasons} from './trades.js';
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
export function waiverRows(data,league,prefs={}){
 const excluded=prefs.waiverExcluded||{add:['K'],drop:[]},slots=activeSlots(league),trending=new Map(data.trends.map(t=>[t.player_id,t.count]));
 const free=tradeCandidateIds(availableIds(league,data.players),data.players,excluded.add).filter(id=>slots.some(slot=>eligible(data.players[id],slot)));
 const roster=playableIds(league.mine),{ids,locks}=lockedLineup(data,league),fixed=Object.values(locks),values=new Map();
 const value=id=>{if(!values.has(id))values.set(id,usableValue(data,league,id,fixed));return values.get(id)};
 const projection=id=>projected(data.projections[data.week]?.[id]?.stats,league.scoring_settings);
 const baseline=optimize(roster,slots,data.players,value,locks);
 const candidates=[...new Set([...free.filter(id=>trending.has(id)).sort((a,b)=>trending.get(b)-trending.get(a)).slice(0,30),...free.filter(id=>projection(id)!==null).sort((a,b)=>projection(b)-projection(a)).slice(0,25)])];
 return candidates.map(id=>({id,count:trending.get(id)||0,projection:projection(id),...waiverMove({id,roster,slots,players:data.players,value,locked:locks,protectedIds:prefs.waiverProtected?.[`${data.user.user_id}:${league.league_id}`]||[],starterIds:prefs.protectStarters!==false?ids:[],capacity:league.roster_positions.filter(s=>!['IR','TAXI'].includes(s)).length,samePosition:prefs.samePositionDrops!==false,excludedDropPositions:excluded.drop,baseline})})).sort((a,b)=>(b.gain??-999)-(a.gain??-999)||b.count-a.count).slice(0,20);
}
export async function findTradeIdeas(data,league,model,prefs={}, {limit=20,maxPairs=10000,cancelled=()=>false}={}){
 const excluded=prefs.tradeExcluded||{give:['DEF'],get:['DEF']},minGain=prefs.tradeMinGain??2,maxGap=prefs.tradeMaxGap??.25,penalty=prefs.tradePenalty??.15;
 const candidate=(roster,side)=>tradeCandidateIds(playableIds(roster),data.players,excluded[side]).filter(id=>model.totals[id]!=null&&model.valueAboveReplacement[id]>0&&!unavailable.includes(data.players[id]?.injury_status));
 const own=candidate(league.mine,'give'),ideas=[];let checked=0,truncated=false;
 outer:for(const partner of league.rosters.filter(r=>r.roster_id!==league.mine.roster_id)){
  for(const a of own)for(const b of candidate(partner,'get')){
   if(cancelled())return {ideas:[],truncated:true,cancelled:true};
   if(checked++>=maxPairs){truncated=true;break outer}
   if(checked%100===0)await new Promise(r=>setTimeout(r,0));
   const va=model.valueAboveReplacement[a],vb=model.valueAboveReplacement[b];if(Math.abs(va-vb)/Math.max(va,vb)>maxGap)continue;
   const result=model.evaluate(league.mine,partner,[a],[b]);
   if(!realismReasons(result,{minGain,maxGap}).length){const user=league.users.find(u=>u.user_id===partner.owner_id);ideas.push({...result,partnerId:partner.roster_id,partner:user?.metadata?.team_name||user?.display_name||`Team ${partner.roster_id}`})}
  }
 }
 ideas.sort((a,b)=>(b.gainA-penalty*Math.max(0,b.gainB))-(a.gainA-penalty*Math.max(0,a.gainB)));
 return {ideas:ideas.slice(0,limit),truncated,checked};
}
