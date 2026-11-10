// Where the owner's corrections are kept in the browser, and the one lens the whole page reads them
// through.
//
// This module holds no markup on purpose. Everything that draws an override is in
// dist/ui/override-editor.js, which imports this; this imports only the state and the tier one
// adapter, so core.js can read the lens without a cycle.
//
// The lens is attached to S.data rather than passed down. S.data is the one object already threaded
// into every engine, and a correction has to take effect without a provider refresh, so syncOverrides
// runs at the top of each render and replaces the lens whenever the list or the season moved. It is
// defined non-enumerable, so the spread that builds the service payload and every identity() check
// over the data ignore it.
import {createOverrides} from '../overrides.js';
import {S} from './state.js';

export const STORAGE_KEY='sunday-overrides';
// Stored records are trusted in shape only. normalise() in the adapter drops bad fields, so a list
// that is not a list is the only thing to guard here.
export function readOverrides(raw){
 if(!raw)return [];
 try{const parsed=JSON.parse(raw);return Array.isArray(parsed)?parsed:[]}catch{return []}
}
let cached=null,cachedKey='';
export function lens(){
 const key=`${S.overridesRev}:${S.data?.nfl?.season??''}`;
 if(!cached||cachedKey!==key){cached=createOverrides({overrides:S.overrides||[],season:S.data?.nfl?.season??null});cachedKey=key}
 return cached;
}
export function syncOverrides(){
 const o=lens();
 if(S.data&&S.data.overrides!==o)Object.defineProperty(S.data,'overrides',{value:o,configurable:true,enumerable:false});
 return o;
}
// Every cache key for a derived number carries this. It is not folded into seasonKey() or
// leagueSeasonKey(), which decide whether the loaded outlook and schedule are still the right ones:
// a correction must not throw away a season of fetched weeks.
export const overrideStamp=()=>lens().fingerprint;
export const overrideFor=(id,week=S.data?.week)=>lens().find(id,week);
export const activeOverrides=(week=S.data?.week)=>lens().active(week);
export const overrideCount=(week=S.data?.week)=>lens().count(week);
// The player row as the engines see it: Sleeper's, with the owner's designation written over it.
export const overridden=(id,week=S.data?.week)=>lens().player(S.data.players,id,week)||S.data.players[id];

// Results computed from a projection and then held in page state, rather than in a memo keyed on the
// stamp. They have to go when a correction lands, or the page would show a number the override has
// already moved.
function dropDerived(){S.tradeSuggestions=null;S.shopResult=null}

// The whole list is replaced at once, exactly as the preferences are saved: there is no partial edit
// to merge and the service validates what it is sent. localStorage is written first so a static host
// and a service both keep working, and the service call is what makes the corrections visible to the
// digest, the alerts and an agent.
export function writeOverrides(list){
 S.overrides=list;S.overridesRev=(S.overridesRev||0)+1;cached=null;dropDerived();syncOverrides();
 let warning=null;
 try{localStorage.setItem(STORAGE_KEY,JSON.stringify(list))}catch{warning='Browser storage is unavailable; this override will be lost when you close the page.'}
 if(!S.serviceMode||S.data?.demo)return Promise.resolve(warning);
 return fetch('/api/v1/overrides',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({overrides:list})})
  .then(r=>{if(!r.ok)throw Error();return warning})
  .catch(()=>'Your override was applied here but could not be saved to the Awaker service.');
}
// One record per player, so editing in place is the normal path and two records can never disagree.
export function setOverride(record){
 if(!record?.player)return Promise.resolve('That override has no player.');
 const kept=(S.overrides||[]).filter(r=>String(r.player)!==String(record.player));
 return writeOverrides([...kept,{...record,player:String(record.player),at:Date.now()}]);
}
export function removeOverride(id){
 return writeOverrides((S.overrides||[]).filter(r=>String(r.player)!==String(id)));
}
export function clearOverrides(){return writeOverrides([])}
