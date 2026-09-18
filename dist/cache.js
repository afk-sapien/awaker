// Successful responses only. In-flight work is shared, including disk reads.
export function createResourceCache({read=async()=>null,write=async()=>{},now=()=>Date.now(),maxEntries=96}={}){
 const memory=new Map(),pending=new Map();
 const remember=(key,entry)=>{memory.delete(key);memory.set(key,entry);while(memory.size>maxEntries)memory.delete(memory.keys().next().value)};
 const fresh=(entry,ttl)=>entry&&now()>=entry.at&&now()-entry.at<ttl;
 return {
  get(key,loader,{ttl=60000,force=false,persist=true}={}){
   if(pending.has(key)){const flight=pending.get(key);if(force)flight.force=true;return flight.promise}
   const hit=memory.get(key);
   if(!force&&fresh(hit,ttl)){remember(key,hit);return Promise.resolve(hit.value)}
   const flight={force,promise:null};
   const task=(async()=>{
    if(!flight.force&&persist){let saved;try{saved=await read(key)}catch{}
     if(!flight.force&&fresh(saved,ttl)){remember(key,saved);return saved.value}
    }
    const value=await loader(),entry={at:now(),value};remember(key,entry);
    if(persist)try{await write(key,entry)}catch{}
    return value;
   })();
   flight.promise=task;pending.set(key,flight);
   task.then(()=>pending.delete(key),()=>pending.delete(key));
   return task;
  }
 };
}

export function createMemo(limit=16){
 const entries=new Map();
 const set=(key,value)=>{entries.delete(key);entries.set(key,value);while(entries.size>limit)entries.delete(entries.keys().next().value);return value};
 return {set,peek:key=>entries.has(key)?set(key,entries.get(key)):undefined,
  get:(key,compute)=>entries.has(key)?set(key,entries.get(key)):set(key,compute())};
}
const identities=new WeakMap();let nextIdentity=0;
export function identity(value){if(!value||typeof value!=='object')return String(value);if(!identities.has(value))identities.set(value,++nextIdentity);return identities.get(value)}

// Score/clock updates must not invalidate season analysis. Actual roster,
// reserve/taxi, scoring, and slot changes must invalidate it for each league.
export function rosterKey(league){return JSON.stringify([league.league_id,league.mine?.roster_id,league.roster_positions,league.scoring_settings,
 league.rosters.map(r=>[r.roster_id,r.players,r.reserve,r.taxi])])}
