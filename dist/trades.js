import {activeSlots,eligible,playableIds,availableIds,projected,assign} from './engine.js';

// Rectangular assignment (Hungarian algorithm): maximize a legal lineup without
// enumerating every slot subset for every trade and every remaining week.
export function seasonLineup(ids,slots,players,value){
 const roster=[...new Set(ids)].filter(id=>players[id]&&Number.isFinite(value(id)));
 const n=slots.length,m=roster.length+n,blocked=1e6;
 if(!n)return {total:0,ids:[],complete:true};
 const cost=slots.map(slot=>Array.from({length:m},(_,j)=>j>=roster.length?blocked/2:eligible(players[roster[j]],slot)?-value(roster[j]):blocked));
 const picks=Array(n).fill(null);
 assign(cost).forEach((j,i)=>{if(j>=0&&j<roster.length&&cost[i][j]<blocked/2)picks[i]=roster[j]});
 return {ids:picks,total:picks.reduce((sum,id)=>sum+(id?value(id):0),0),complete:picks.every(Boolean)};
}

const OUT=['Out','IR','Doubtful','PUP','Sus','Suspended'];
// A week counts as published once Sleeper projects a real slate for it; before that a missing row says nothing.
const published=new WeakMap(),isPublished=p=>{if(!published.has(p))published.set(p,Object.keys(p).length>=100);return published.get(p)};
export function futurePoints(id,week,players,scoring){
 if(!week?.projections||!week?.games)return null;
 const player=players[id],row=week.projections[id],team=row?.team||player?.team;
 if(!team)return null;
 // A bye is zero only when a successfully loaded schedule confirms no team game.
 if(!week.games[team])return 0;
 // Sleeper often drops the projection of a player ruled out, so for him a missing row in a published week is
 // the zero he will score. Anyone else missing a week, or anyone in a week not yet projected, stays unknown.
 const points=projected(row?.stats,scoring);
 return points===null&&OUT.includes(player?.injury_status)&&isPublished(week.projections)?0:points;
}

export function buildSeasonModel({league,players,outlook}){
 const slots=activeSlots(league),weeks=outlook.weeks,values={},totals={},replacement={},valueAboveReplacement={};
 const allIds=Object.keys(players),free=availableIds(league,players);
 for(const week of weeks){const d=outlook.data[week];values[week]=Object.fromEntries(allIds.map(id=>[id,futurePoints(id,d,players,league.scoring_settings)]));
  const byPosition={};
  for(const id of free){const p=players[id],v=values[week][id];if(!Number.isFinite(v)||['Out','IR','PUP','Suspended','Doubtful'].includes(p.injury_status))continue;
   for(const pos of p.fantasy_positions||[p.position])byPosition[pos]=Math.max(byPosition[pos]??0,v);
  }
  replacement[week]=byPosition;
 }
 for(const id of allIds){const vals=weeks.map(w=>values[w][id]);totals[id]=vals.every(Number.isFinite)?vals.reduce((a,b)=>a+b,0):null;
  // Replacement levels are keyed by fantasy position, which differs from position for IDP players.
  const level=w=>Math.min(...(players[id].fantasy_positions||[players[id].position]).map(pos=>replacement[w][pos]).filter(Number.isFinite));
  valueAboveReplacement[id]=totals[id]!==null&&weeks.every(w=>Number.isFinite(level(w)))?weeks.reduce((sum,w)=>sum+Math.max(0,values[w][id]-level(w)),0):null;
 }
 const baseline=new Map();
 const lineup=(ids,w)=>seasonLineup(ids,slots,players,id=>values[w][id]);
 function before(roster){const key=roster.roster_id;if(!baseline.has(key))baseline.set(key,weeks.map(w=>lineup(playableIds(roster),w)));return baseline.get(key)}
 // What one more player would add to a roster's lineups over the window, ignoring the roster limit.
 const additions=new Map();
 function addValue(roster,id){const key=`${roster.roster_id}:${id}`;if(!additions.has(key)){const base=before(roster),ids=playableIds(roster).concat(id);additions.set(key,Number.isFinite(totals[id])?weeks.reduce((sum,w,i)=>sum+lineup(ids,w).total-base[i].total,0):0)}return additions.get(key)}
 // autoDrop lets a team that ends up over its roster limit cut players to fit, which an uneven package needs.
 function evaluate(roster,partner,give,get,{autoDrop=false,protectedA=[],protectedB=[]}={}){
  const a=playableIds(roster),b=playableIds(partner);
  if(!give.length||!get.length||new Set([...give,...get]).size!==give.length+get.length||give.some(id=>!a.includes(id))||get.some(id=>!b.includes(id)))throw Error('Choose distinct players from each team.');
  if([...give,...get].some(id=>totals[id]===null||totals[id]===undefined))throw Error('A traded player is missing future projections. No season estimate is available for this offer.');
  const newA=a.filter(id=>!give.includes(id)).concat(get),newB=b.filter(id=>!get.includes(id)).concat(give);
  const capacity=league.roster_positions.filter(s=>!['IR','TAXI'].includes(s)).length;
  const overA=newA.length-Math.max(capacity,a.length),overB=newB.length-Math.max(capacity,b.length);
  if((overA>0||overB>0)&&!autoDrop)throw Error('This package needs a roster drop. Use equal-size packages or free a roster spot first.');
  // Someone who starts in no week is a free cut. Failing that the weakest players go and the lineups are set again.
  const fit=(ids,over,incoming,kept)=>{
   const full=weeks.map(w=>lineup(ids,w));if(over<=0)return {lineups:full,drops:[]};
   const starts=new Set(full.flatMap(l=>l.ids)),able=ids.filter(id=>!incoming.includes(id)&&!kept.includes(id)&&Number.isFinite(totals[id])).sort((x,y)=>totals[x]-totals[y]);
   if(able.length<over)throw Error('This package needs a roster drop, and no one on the roster can be cut.');
   const idle=able.filter(id=>!starts.has(id));if(idle.length>=over)return {lineups:full,drops:idle.slice(0,over)};
   // Everyone left starts somewhere. The cheapest cut is whoever's starts are worth least, which is
   // rarely the lowest season total: that is usually the kicker. For a single cut the few cheapest
   // are tried for real, since a replacement may cover most of what is lost.
   const cost=id=>weeks.reduce((sum,w,i)=>sum+(full[i].ids.includes(id)?values[w][id]||0:0),0),cheapest=[...able].sort((x,y)=>cost(x)-cost(y)||totals[x]-totals[y]);
   const without=drops=>{const rest=ids.filter(id=>!drops.includes(id)),lineups=weeks.map(w=>lineup(rest,w));return {drops,lineups,filled:lineups.filter(l=>l.complete).length,total:lineups.reduce((s,l)=>s+l.total,0)}};
   const tries=over===1?cheapest.slice(0,3).map(id=>without([id])):[without(cheapest.slice(0,over))];
   return tries.sort((x,y)=>y.filled-x.filled||y.total-x.total)[0];
  };
  const fitA=fit(newA,overA,get,protectedA),fitB=fit(newB,overB,give,protectedB);
  const beforeA=before(roster),beforeB=before(partner);
  const weekly=weeks.map((week,i)=>{const afterA=fitA.lineups[i],afterB=fitB.lineups[i];return {week,gainA:afterA.total-beforeA[i].total,gainB:afterB.total-beforeB[i].total,complete:beforeA[i].complete&&beforeB[i].complete&&afterA.complete&&afterB.complete,incomingStarts:afterA.ids.filter(id=>get.includes(id)).length,partnerStarts:afterB.ids.filter(id=>give.includes(id)).length,outgoingStarts:beforeA[i].ids.filter(id=>give.includes(id)).length,partnerOutgoingStarts:beforeB[i].ids.filter(id=>get.includes(id)).length}});
  const sumValue=ids=>ids.some(id=>valueAboveReplacement[id]===null)?null:ids.reduce((sum,id)=>sum+valueAboveReplacement[id],0);
  const offeredValue=sumValue(give),receivedValue=sumValue(get),largest=Math.max(offeredValue??0,receivedValue??0);
  // Two players who are both no better than a free agent are an even swap, not an unknown one.
  const valueGap=offeredValue===null||receivedValue===null?null:largest<=0?0:Math.abs(offeredValue-receivedValue)/largest;
  return {give,get,dropA:fitA.drops,dropB:fitB.drops,weekly,gainA:weekly.reduce((s,r)=>s+r.gainA,0),gainB:weekly.reduce((s,r)=>s+r.gainB,0),complete:weekly.every(r=>r.complete),offeredValue,receivedValue,valueGap,weeks:weeks.length};
 }
 // Cache fixed pickup/drop plans per roster and incoming position. Trades are
 // compared with a no-trade alternative, never credited with an assumed pickup.
 const waiverPlans=new Map();
 function pickupAlternative(roster,incoming,keep,protectedIds=[]){
  const positions=[...new Set(incoming.flatMap(id=>players[id].fantasy_positions||[players[id].position]))].sort();
  const key=JSON.stringify([roster.roster_id,positions,[...protectedIds].sort()]);
  if(!waiverPlans.has(key)){
   const ids=playableIds(roster),base=before(roster),protectedSet=new Set([...protectedIds,...(roster.starters||base[0].ids)]);
   const pool=free.filter(id=>!['Out','IR','PUP','Suspended','Doubtful'].includes(players[id].injury_status)&&(players[id].fantasy_positions||[players[id].position]).some(pos=>positions.includes(pos))&&slots.some(slot=>eligible(players[id],slot)));
   const covered=pool.filter(id=>Number.isFinite(totals[id]));
   const shortlist=new Set();
   for(const pos of positions){
    const same=covered.filter(id=>(players[id].fantasy_positions||[players[id].position]).includes(pos));
    same.sort((a,b)=>totals[b]-totals[a]);same.slice(0,5).forEach(id=>shortlist.add(id));
    for(const week of weeks){const best=same.reduce((best,id)=>best===null||values[week][id]>values[week][best]?id:best,null);if(best)shortlist.add(best)}
   }
   const capacity=league.roster_positions.filter(s=>!['IR','TAXI'].includes(s)).length;
   const drops=ids.length<capacity?[null]:ids.filter(id=>!protectedSet.has(id)&&Number.isFinite(totals[id]));
   const plans=[];
   for(const add of shortlist)for(const drop of drops){
    const afterIds=ids.filter(id=>id!==drop).concat(add),after=weeks.map(w=>lineup(afterIds,w));
    if(!base.every(w=>w.complete)||!after.every(w=>w.complete))continue;
    const gain=after.reduce((sum,w,i)=>sum+w.total-base[i].total,0);
    if(gain>0)plans.push({add,drop,gain});
   }
   plans.sort((a,b)=>b.gain-a.gain||(totals[a.drop]??0)-(totals[b.drop]??0));
   waiverPlans.set(key,{plans,checked:shortlist.size,missing:pool.length-covered.length,status:pool.length&&!covered.length?'unknown':'checked'});
  }
  const {plans,...coverage}=waiverPlans.get(key),best=plans.find(plan=>!keep.includes(plan.drop));
  return {...coverage,...(best||{add:null,drop:null,gain:0})};
 }
 function assessWaivers(result,roster,partner,{protectedA=[],protectedB=[]}={}){
  if(!result.complete)return result;
  const waiverA=pickupAlternative(roster,result.get,result.give,protectedA),waiverB=pickupAlternative(partner,result.give,result.get,protectedB);
  return {...result,waiverA,waiverB,adjustedGainA:result.gainA-waiverA.gain,adjustedGainB:result.gainB-waiverB.gain};
 }
 return {weeks,totals,valueAboveReplacement,evaluate,assessWaivers,addValue};
}

export function realismReasons(result,{minGain=2,maxGap=.25}={}){
 const reasons=[];
 if(!result.complete)reasons.push('Some starting slots have no projection');
 const gains=tradeGains(result);
 if(gains.a/result.weeks<minGain)reasons.push(`Your gain${result.waiverA?' over pickups':''} is below ${minGain} points/week`);
 if(gains.b/result.weeks<minGain)reasons.push(`Their gain${result.waiverB?' over pickups':''} is below ${minGain} points/week`);
 // A limit of 1 turns this heuristic into information rather than a gate.
 if(maxGap<1){if(result.valueGap===null)reasons.push('Replacement value is unavailable');
 else if(result.valueGap>maxGap)reasons.push(`Player value gap exceeds ${Math.round(maxGap*100)}%`);}
 return reasons;
}

// Both gains count positively; a modest discount on the partner's gain favors you.
export function tradeGains(result){return {a:result.adjustedGainA??result.gainA,b:result.adjustedGainB??result.gainB}}
export function tradeScore(result,bias=.15){
 const weight=Number.isFinite(bias)?Math.max(0,Math.min(1,bias)):.15;
 const gains=tradeGains(result);
 return gains.a+(1-weight)*gains.b;
}
export function compareTradeIdeas(a,b,bias=.15){
 return tradeScore(b,bias)-tradeScore(a,bias)||tradeGains(b).a-tradeGains(a).a;
}
