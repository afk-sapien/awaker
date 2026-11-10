// The owner's own corrections to what Sleeper says, applied in exactly one place.
//
// Sleeper's projection is a guess, and sometimes the owner knows better: a snap count that fell off a
// cliff, a beat writer's report that has not reached any feed, a designation Sleeper has not posted
// yet. An override records that knowledge and every projection the app reads passes through
// project() on its way out, so one correction moves the lineup, the start and sit calls, the waiver
// rows, the defense plan and the trade model together instead of one of them.
//
// Four rules hold the whole thing up.
//
// 1. An override targets a Sleeper player id, never a name. A headline that names a player may
//    suggest an override, and the news join will offer one, but only an id can be its subject. Names
//    are not unique, are spelled differently by every provider, and are the one key that can quietly
//    point a correction at the wrong man.
// 2. One adapter. adjust() is the only code that moves a number, so a correction cannot be applied
//    twice by two callers who both knew about it. Nothing outside this module reads the points field.
// 3. The original survives. adjusted() returns Sleeper's number alongside the adjusted one and the
//    record that moved it, so every adjusted figure on the page can show what it was and why.
// 4. A window, not a forever. from and until are weeks, inclusive, and a record outside its window
//    is inert rather than quietly going on being true. It stays stored, because the owner wrote it
//    and may want it back, and reads as expired everywhere.
//
// Ruling a player out sets his projection to null, not zero. Zero is a real answer that a complete
// lineup can be built around. Null is the absence of one, which is what the owner is asserting, and
// it can legitimately make a lineup read as incomplete.
import {RULED_OUT} from './engine.js'

// Sleeper's own vocabulary, so that ruledOut, UNAVAILABLE, the injury pill and the news condition all
// honour an override with no further plumbing. Healthy is the one word that is not Sleeper's: it
// clears a designation the owner believes is stale.
export const STATUSES=['Healthy',...RULED_OUT,'Doubtful','Questionable']
export const ROSTER_STATUSES=['Active','Inactive','Injured Reserve','Non Football Injury','Physically Unable to Perform','Practice Squad','Suspended']
export const SOURCES=['owner']
const MAX_WEEK=18
const text=(value,max)=>typeof value==='string'&&value.trim()?value.trim().slice(0,max):null
const week=value=>Number.isInteger(value)&&value>=1&&value<=MAX_WEEK?value:null
const round=value=>Math.round(value*100)/100
const clamp=(value,low,high)=>Number.isFinite(value)?round(Math.min(high,Math.max(low,value))):null
// An agent may own an override later, so agent:<name> validates now and no stored record needs
// migrating when it does.
const source=value=>{const s=text(value,60);return s&&(SOURCES.includes(s)||/^agent:[\w .-]{1,40}$/.test(s))?s:'owner'}

export function normalisePoints(input){
 if(!input||typeof input!=='object')return null
 const multiplier=clamp(input.multiplier,0,5),delta=clamp(input.delta,-100,100)
 if(multiplier==null&&delta==null)return null
 return {...(multiplier==null?{}:{multiplier}),...(delta==null?{}:{delta})}
}
// Stored records are trusted in shape only, exactly as preferences are: anything the wrong type is
// dropped so that one bad save cannot stop the page from starting or poison a projection.
export function normalise(input,{now=Date.now()}={}){
 if(!input||typeof input!=='object')return null
 const player=text(input.player,100)
 if(!player)return null
 const status=STATUSES.includes(input.status)?input.status:null
 const from=week(input.from),until=week(input.until)
 return {
  player,
  league:text(input.league,100),
  season:Number.isInteger(input.season)&&input.season>=2000&&input.season<=2100?input.season:null,
  points:normalisePoints(input.points),
  status,
  bodyPart:status==='Healthy'?null:text(input.bodyPart,40),
  rosterStatus:ROSTER_STATUSES.includes(input.rosterStatus)?input.rosterStatus:null,
  note:text(input.note,400),
  reason:text(input.reason,200),
  from,
  until:until!=null&&from!=null&&until<from?from:until,
  source:source(input.source),
  at:Number.isFinite(input.at)&&input.at>0?input.at:now
 }
}
// The window has passed, or has not started. A record with no until never expires, which is the right
// default for a correction to a player's standing rather than to one week's projection.
export function expired(record,{week:w}={}){
 if(!record||!Number.isInteger(w))return false
 return (record.until!=null&&w>record.until)||(record.from!=null&&w<record.from)
}
export function describePoints(points){
 if(!points)return ''
 const parts=[]
 if(points.multiplier!=null)parts.push(`×${points.multiplier}`)
 if(points.delta!=null)parts.push(`${points.delta>0?'+':''}${points.delta}`)
 return parts.join(' then ')
}
// Multiplier first, then delta, so that halving a projection and taking a point off it means what it
// reads like. A record that only changes a designation or carries a note leaves the number alone.
export function adjust(points,record){
 if(!record)return points
 if(record.status&&RULED_OUT.includes(record.status))return null
 if(!record.points||!Number.isFinite(points))return points
 let value=points
 if(record.points.multiplier!=null)value*=record.points.multiplier
 if(record.points.delta!=null)value+=record.points.delta
 return round(value)
}
export function adjustedBy(points,record){
 const next=adjust(points,record)
 return {points:next,original:points,override:record||null,changed:!!record&&next!==points}
}
const fnv=string=>{let h=2166136261;for(let i=0;i<string.length;i++){h^=string.charCodeAt(i);h=Math.imul(h,16777619)}return (h>>>0).toString(36)}
// Everything that caches a derived number folds this into its key. It has to move when any stored
// field moves, so it is taken over the whole record rather than over the fields this module happens
// to read today.
export function fingerprint(list){
 if(!list?.length)return 'none'
 const canonical=[...list].map(r=>JSON.stringify([r.player,r.league,r.season,r.points,r.status,r.bodyPart,r.rosterStatus,r.note,r.reason,r.from,r.until,r.source,r.at])).sort().join('|')
 return `${list.length}.${fnv(canonical)}`
}

// A lens over one league and season.
//
// The two scopes are deliberately not symmetrical. A season is a fact about when the record was
// written, so a mismatch drops it and a lens with no season of its own accepts anything: the owner
// should not lose a correction because a view forgot to say what year it is. A league is a claim
// about where the record applies, so it is strict in both directions. A record naming a league is
// invisible to a lens that does not name that league, including the league-agnostic lens the
// dashboard builds. The UI only ever writes league:null, player-wide, which is why one lens can sit
// on the data object and serve every league view. A league-scoped record can only come from an agent
// or a hand-edited store, and the strict reading is the safe one: it shows up where it was aimed and
// nowhere else, rather than leaking into every other league through the shared lens.
export function createOverrides({overrides=[],season=null,league=null,now=Date.now()}={}){
 const all=(Array.isArray(overrides)?overrides:[]).map(record=>normalise(record,{now})).filter(Boolean)
 const mine=all.filter(r=>(r.season==null||season==null||r.season===season)&&(r.league==null||r.league===league))
 const held=new Map()
 for(const record of mine)held.set(record.player,[...(held.get(record.player)||[]),record])
 // Two records on one player in one week should not happen from the UI, which edits in place, but a
 // second agent or a hand-edited store can produce it. The narrower scope wins, then the newer write.
 const pick=records=>records.sort((a,b)=>(b.league?1:0)-(a.league?1:0)||b.at-a.at)[0]||null
 const find=(id,w)=>{
  const records=held.get(String(id))
  if(!records)return null
  const live=Number.isInteger(w)?records.filter(r=>!expired(r,{week:w})):records
  return pick(live)
 }
 const print=fingerprint(all),patched=new WeakMap()
 return {
  list:all,
  scoped:mine,
  any:mine.length>0,
  fingerprint:print,
  find,
  active(w){return mine.filter(r=>!expired(r,{week:w}))},
  count(w){return new Set(this.active(w).map(r=>r.player)).size},
  project(points,id,w){return adjust(points,find(id,w))},
  adjusted(points,id,w){return adjustedBy(points,find(id,w))},
  // Status, body part and roster status are applied by patching the player rows they belong to, so
  // ruledOut, UNAVAILABLE, the injury pill and the news condition all follow an override without
  // knowing this module exists. Only the overridden ids are copied, and the raw directory is left
  // alone so the page can always show what Sleeper said. The result is memoized per directory and
  // week, because the pool runs to a few thousand rows and the lineup code asks for it in loops.
  players(map,w){
   if(!map||!mine.length)return map
   let byWeek=patched.get(map)
   if(!byWeek)patched.set(map,byWeek=new Map())
   const key=Number.isInteger(w)?w:'all'
   if(!byWeek.has(key)){
    const ids=[...held.keys()].filter(id=>{const r=find(id,w);return !!r&&!!(r.status||r.bodyPart||r.rosterStatus)&&!!map[id]})
    if(!ids.length)byWeek.set(key,map)
    else{
     const out={...map}
     for(const id of ids){
      const record=find(id,w),base=map[id],healthy=record.status==='Healthy'
      out[id]={...base,
       injury_status:record.status?(healthy?null:record.status):base.injury_status,
       injury_body_part:record.bodyPart??(healthy?null:base.injury_body_part),
       status:record.rosterStatus||base.status,
       override:record}
     }
     byWeek.set(key,out)
    }
   }
   return byWeek.get(key)
  },
  player(map,id,w){return this.players(map,w)?.[id]}
 }
}
// The default every call site falls back to, so a caller that knows nothing about overrides reads
// Sleeper's numbers unchanged and nothing has to be threaded through to be correct.
export const NO_OVERRIDES=createOverrides()
export const lensFor=data=>data?.overrides||NO_OVERRIDES
