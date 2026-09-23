// The rest-of-season projections that trades, waivers and start/sit are built on, loaded once per week window.
import {lockedLineup as sharedLocks,usableValue as sharedValue} from '../analysis.js';
import * as api from '../api.js';
import {createMemo,identity,rosterKey} from '../cache.js';
import {createScoreTracker} from '../engine.js';
import {buildSeasonModel} from '../trades.js';
import {S} from './state.js';
import {$,isTradeView,league} from './core.js';
import {ensureLeagueSeason} from './pages/league-outlook.js';
import {render} from './render.js';

export const seasonModels=createMemo(8),waiverResults=createMemo(24),tradeResults=createMemo(24),lineupResults=createMemo(24);
export function tradeWeeks(){const start=Math.max(S.data.week,Number(S.data.nfl?.week)||S.data.week)+1,end=S.data.demo?Math.min(S.tradeEndWeek,4):S.tradeEndWeek;return Array.from({length:Math.max(0,end-start+1)},(_,i)=>start+i)}
export function seasonKey(){return `${S.data.demo?'demo':S.data.user.user_id}:${S.data.nfl?.season}:${tradeWeeks().join(',')}`}
export function currentOutlook(){return S.seasonState?.key===seasonKey()&&!S.seasonState.loading&&!S.seasonState.error?S.seasonState.outlook:null}
export function seasonModel(l=league()){
 const outlook=currentOutlook();if(!outlook||!outlook.weeks.length)return null;
 const key=JSON.stringify([seasonKey(),rosterKey(l),identity(S.data.players),identity(outlook)]);
 return seasonModels.get(key,()=>buildSeasonModel({league:l,players:S.data.players,outlook}));
}
export async function ensureTradeOutlook(force=false){
 ensureLeagueSeason();
 const key=seasonKey(),weeks=tradeWeeks();if(S.seasonState?.key===key&&!force&&(S.seasonState.loading||(!S.seasonState.error&&Date.now()-S.seasonState.outlook.loadedAt<3600000)))return S.seasonState.promise;
 const state={key,loading:true,error:null,outlook:null};S.seasonState=state;S.tradeRun++;S.tradeSuggestions=null;S.tradeManual=null;
 state.promise=(async()=>{try{
  if(!weeks.length)throw Error('No weeks remain in this trade window.');
  const outlook=S.data.demo?{weeks,data:Object.fromEntries(weeks.map(w=>[w,{projections:S.data.projections[w],games:S.data.games}])),loadedAt:Date.now(),errors:[]}:await api.tradeOutlook(S.data.nfl.season,weeks,(done,total)=>{if(S.seasonState===state&&$('#season-load-status'))$('#season-load-status').textContent=`Loading season outlook… ${done}/${total} weeks`},force);
  if(outlook.errors.length)throw Error(`Missing projections or schedules for week(s) ${outlook.errors.join(', ')}. Season recommendations are paused.`);
  state.outlook=outlook;
 }catch(e){state.error=e.message}finally{state.loading=false;if(S.seasonState===state&&isTradeView())render()}})();
 if(isTradeView())render();return state.promise;
}
export const trackScores=createScoreTracker();
export const scoreKey=(id,a)=>JSON.stringify([a.leagueId,a.side,id]);
export function lockedLineup(l){return sharedLocks(S.data,l)}
export function usableValue(id,l,lockedIds=[]){return sharedValue(S.data,l,id,lockedIds)}
