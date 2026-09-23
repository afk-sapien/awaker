// Saved preferences: read from this browser, and from the service when there is one, then spread into
// the page state. They are only trusted in shape: anything the wrong type is dropped so a bad save cannot
// stop the page from starting.
import {S} from './state.js';
import {plain} from './core.js';
import {waiverPositions} from './pages/waiver-wire.js';
import {TRADE_SORTS} from './pages/trade-finder.js';

export function readPreferences(stored,service=null){
 let prefs;try{prefs=JSON.parse(stored||'{}')}catch{}
 if(!plain(prefs))prefs={};
 if(service)prefs={...prefs,...(plain(service.preferences)?service.preferences:{}),username:service.username,disabled:service.disabled};
 for(const k of ['pins','disabled','waiverIncluded'])if(!Array.isArray(prefs[k]))delete prefs[k];
 for(const k of ['waiverExcluded','tradeExcluded','waiverProtected'])if(!plain(prefs[k]))delete prefs[k];
 for(const k of ['username','watchLeague','analysisLeague'])if(prefs[k]!=null&&typeof prefs[k]!=='string')delete prefs[k];
 if(prefs.waiverProtected)for(const [k,v] of Object.entries(prefs.waiverProtected))if(!Array.isArray(v))delete prefs.waiverProtected[k];
 return prefs;
}

export function applyPreferences(prefs){
 S.prefs=prefs;
 S.pins=new Set(prefs.pins||[]);
 S.watchRole=['both','mine','opponent'].includes(prefs.watchRole)?prefs.watchRole:'mine';
 S.waiverExcluded={add:Array.isArray(prefs.waiverExcluded?.add)?prefs.waiverExcluded.add:Array.isArray(prefs.waiverIncluded)?waiverPositions.filter(p=>!prefs.waiverIncluded.includes(p)):['K'],drop:Array.isArray(prefs.waiverExcluded?.drop)?prefs.waiverExcluded.drop:[]};
 S.waiverUpgradesOnly=prefs.waiverUpgradesOnly===true;S.waiverHorizon=['current','next','season'].includes(prefs.waiverHorizon)?prefs.waiverHorizon:'next';S.waiverEndWeek=prefs.waiverEndWeek===18?18:17;
 S.protectStarters=prefs.protectStarters!==false;S.samePositionDrops=prefs.samePositionDrops!==false;
 S.filter=['auto','all','live','upcoming','done','pinned'].includes(prefs.watchFilter)?prefs.watchFilter:'auto';
 // Bench players show unless switched off. The older "bench" preference defaulted to hidden and is no longer read.
 S.bench=prefs.showBench!==false;
 S.watchLeague=prefs.watchLeague||'all';
 S.leagueId=prefs.analysisLeague||S.leagueId;
 S.penalty=Number.isFinite(prefs.tradeOwnBias)?Math.max(0,Math.min(1,prefs.tradeOwnBias)):.15;
 S.requireBenefit=prefs.requireBenefit!==false;
 S.tradeExcluded={give:Array.isArray(prefs.tradeExcluded?.give)?prefs.tradeExcluded.give:['DEF'],get:Array.isArray(prefs.tradeExcluded?.get)?prefs.tradeExcluded.get:['DEF']};
 S.tradeMinGain=Number.isFinite(prefs.tradeMinGain)?Math.max(0,Math.min(10,prefs.tradeMinGain)):0;
 S.tradeMaxGap=[.15,.25,.4,1].includes(prefs.tradeMaxGap)?prefs.tradeMaxGap:1;S.tradeEndWeek=[17,18].includes(prefs.tradeEndWeek)?prefs.tradeEndWeek:17;
 S.tradeSort=TRADE_SORTS[prefs.tradeSort]?prefs.tradeSort:'score';
 S.leagueBasis=prefs.leagueBasis==='roster'?'roster':'season';
}
