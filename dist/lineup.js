import {activeSlots,eligible,playableIds,projected,ruledOut} from './engine.js';
import {lockedLineup,unavailable} from './analysis.js';

// Compare pregame projections on the same scoring basis. An empty slot contributes zero, and so does a starter
// ruled out before his game, so benching him is measured against nothing. Missing projections remain unknown.
export function lineupComparisons(data,league){
 const slots=activeSlots(league),{ids,locks}=lockedLineup(data,league);
 const projection=id=>!id||id==='0'||ruledOut(data.players[id])&&(data.games[data.players[id].team]?.state??'pre')==='pre'?0:projected(data.projections[data.week]?.[id]?.stats,league.scoring_settings);
 const starters=slots.map((slot,index)=>({slot,index,id:ids[index],projection:projection(ids[index]),locked:index in locks}));
 const baseline=starters.every(s=>Number.isFinite(s.projection))?Math.round(starters.reduce((sum,s)=>sum+s.projection,0)*100)/100:null;
 const bench=playableIds(league.mine).filter(id=>!ids.includes(id)).map(id=>{
  const player=data.players[id],game=data.games[player?.team],points=projection(id);
  const reason=!player?'Player details unavailable':game&&game.state!=='pre'?'Game started · locked':unavailable.includes(player.injury_status)?player.injury_status:!Number.isFinite(points)?'Projection unavailable':null;
  const options=reason?[]:starters.filter(s=>!s.locked&&eligible(player,s.slot)).map(s=>({...s,delta:Number.isFinite(s.projection)?Math.round((points-s.projection)*100)/100:null})).sort((a,b)=>(b.delta??-Infinity)-(a.delta??-Infinity)||a.index-b.index);
  return {id,projection:points,reason:reason||(options.length?null:'No unlocked eligible slot'),options};
 });
 return {starters,baseline,bench};
}
