// Writing a correction down, and the one place every correction can be read and removed.
//
// The store is dist/ui/overrides.js, which holds no markup on purpose so that core.js can read the
// lens without a cycle. Everything that draws an override lives here instead: the form for one
// player, the list of all of them, and the picker, which has to find one man in the whole Sleeper
// directory rather than in a roster.
//
// Nothing here applies a correction. The form hands a record to the store, the store hands it to the
// tier one adapter, and every number on the page moves because it was read through the adapter in the
// first place. That is why saving redraws the whole page rather than patching the numbers it knows
// about.
import {suspectStats} from '../engine.js';
import {ROSTER_STATUSES,STATUSES,describePoints} from '../overrides.js';
import {S} from './state.js';
import {esc,fmt,league,pname,sleeperValue,toast,value} from './core.js';
import {activeOverrides,lens,removeOverride,setOverride,writeOverrides} from './overrides.js';
import {render} from './render.js';

const RESULTS=12;
const dialog=()=>document.querySelector('#override-dialog');
const field=id=>dialog()?.querySelector(`#${id}`);
// A blank box means "leave this alone", which is not the same as zero: a multiplier of zero is the
// owner saying this man scores nothing, and has to survive the read.
const number=input=>{const text=String(input??'').trim();if(!text)return null;const value=Number(text);return Number.isFinite(value)?value:null};
const weekOptions=(selected,label)=>`<option value="">${esc(label)}</option>`+Array.from({length:18},(_,i)=>i+1).map(week=>`<option value="${week}" ${week===selected?'selected':''}>Week ${week}</option>`).join('');
const windowText=record=>record.from==null&&record.until==null?'In force until you remove it'
 :record.from!=null&&record.until!=null?`Weeks ${record.from} to ${record.until}`
 :record.from!=null?`From week ${record.from} on`:`Through week ${record.until}`;
export function describeRecord(record){
 return [record.points?`projection ${describePoints(record.points)}`:'',record.status?`status ${record.status}`:'',record.bodyPart||'',
  record.rosterStatus?`roster ${record.rosterStatus}`:'',record.note||''].filter(Boolean).join(' · ')||'no change';
}

// What Sleeper said and what the page now uses, the two numbers side by side, for one player this
// week. Written here once and read by the list, the form and the profile, so no corner of the app can
// show an adjusted figure without its original.
export function comparison(id,l=league(),w=S.data?.week){
 const original=sleeperValue(id,l,w),now=value(id,l,w);
 return {original,now,changed:now!==original,
  text:`Sleeper ${fmt(original)} → ${now===null?'no projection':fmt(now)}`};
}

// Sleeper's projection row for a player can be arithmetically impossible: more receiving first downs
// than catches. Those rows are flagged rather than corrected, because the right number is not
// knowable from the row, and the flag sits where the owner can act on it.
export function suspectNote(id,l=league(),w=S.data?.week){
 const found=suspectStats(S.data?.projections?.[w]?.[id]?.stats,l?.scoring_settings);
 if(!found.length)return null;
 return `Sleeper’s week ${w} row for this player is not possible: ${found.map(s=>`${s.reason} (${fmt(s.value,0)} vs ${fmt(s.ceiling,0)})`).join(', ')}. The projection it scores may be too high.`;
}

// The picker. With nothing typed it offers the rosters the owner actually manages, because a
// correction is nearly always about one of his own players, and a search runs over the whole
// directory: 2747 rosterable players on a real account, so it shows the first handful of matches and
// counts the rest rather than drawing a list nobody can read.
export function pickerMatches(query=S.overrideQuery,limit=RESULTS){
 const text=String(query||'').trim().toLowerCase();
 const players=S.data?.players||{};
 if(!text){
  const mine=[...new Set(S.data?.leagues?.filter(l=>l.enabled).flatMap(l=>[...(l.mine?.players||[]),...(l.mine?.reserve||[])])||[])]
   .filter(id=>players[id]).sort((a,b)=>pname(a).localeCompare(pname(b)));
  return {ids:mine.slice(0,limit),total:mine.length,scope:'roster'};
 }
 const found=[];let total=0;
 for(const [id,player] of Object.entries(players)){
  if(!player||!player.position)continue;
  if(!`${pname(id)} ${player.team||''} ${player.position||''}`.toLowerCase().includes(text))continue;
  total++;
  if(found.length<limit)found.push(id);
 }
 return {ids:found,total,scope:'search'};
}
export function pickerHTML(){
 const {ids,total,scope}=pickerMatches();
 if(!ids.length)return `<li class="muted small">${scope==='search'?'No player in the Sleeper directory matches that.':'No players on your rosters yet. Search the directory above.'}</li>`;
 return ids.map(id=>{
  const p=S.data.players[id]||{};
  return `<li><button type="button" class="override-result" data-override-open="${esc(id)}"><strong>${esc(pname(id))}</strong><span class="muted small">${esc(p.team||'FA')} · ${esc(p.position||'')}${lens().find(id,S.data.week)?' · already corrected':''}</span></button></li>`;
 }).join('')+(total>ids.length?`<li class="muted small">${total-ids.length} more match. Type a little more of the name.</li>`:'');
}

// The block on a player profile: the correction in force on him if there is one, the two numbers, the
// flag on an impossible projection row, and the offer to write a correction. Remove is not offered
// here, only in the editor, because the handler for it lives on the dialog.
export function overrideBlockHTML(id,l=league(),w=S.data?.week){
 const record=lens().find(id,w),numbers=comparison(id,l,w),suspect=suspectNote(id,l,w);
 return `<div class="override-block">${record?`<p class="small"><span class="adjusted" aria-hidden="true">✎</span> Your correction: ${esc(describeRecord(record))}. <span class="muted">${esc(windowText(record))}.</span></p><p class="num small">${esc(numbers.text)} <span class="muted">this week</span></p>`:''}${suspect?`<p class="data-alert">${esc(suspect)}</p>`:''}<button type="button" class="secondary" data-override-open="${esc(id)}">${record?'Edit your correction':'Add a correction'}</button></div>`;
}

// The list. Every stored record, not only the ones in force this week, because a record outside its
// window is inert rather than gone and the owner has to be able to see and remove it.
export function overrideListHTML(){
 const week=S.data?.week,records=lens().list,inForce=new Set(activeOverrides(week).map(r=>r.player));
 const confirming=S.overrideEditor?.confirming;
 return `<div class="override-top"><div><span class="eyebrow">YOUR CORRECTIONS</span><h2 id="override-title">${records.length?`${records.length} correction${records.length===1?'':'s'} on file`:'No corrections yet'}</h2></div><button type="button" class="secondary" id="override-dialog-close">Close</button></div>
 <p class="muted small">A correction follows the Sleeper player id, never a name, and every projection the app reads passes through it: the start and sit call, the waiver rows, the defense plan and the trade model all move together. Finished weeks are graded against what was projected before kickoff, so a correction written today never rewrites a past decision.</p>
 ${records.length?`<ul class="override-list">${records.map(record=>{
  const live=inForce.has(record.player),numbers=comparison(record.player);
  return `<li class="override-row ${live?'':'override-inert'}"><div class="override-row-main"><strong>${esc(pname(record.player))}</strong> <span class="muted small">${esc(S.data.players[record.player]?.team||'FA')} · ${esc(S.data.players[record.player]?.position||'')}</span>
   <div class="small">${esc(describeRecord(record))}</div>
   <div class="muted small">${esc(windowText(record))}${live?'':' · not in force in week '+week}${record.source==='owner'?'':' · '+esc(record.source)}</div>
   <div class="muted small num">${live?esc(numbers.text):'Sleeper '+fmt(numbers.original)}</div></div>
   <div class="override-row-actions"><button type="button" class="secondary" data-override-open="${esc(record.player)}">Edit</button><button type="button" class="secondary" data-override-remove="${esc(record.player)}">Remove</button></div></li>`;
 }).join('')}</ul>
 <button type="button" class="secondary ${confirming?'disconnect':''}" id="override-clear">${confirming?'Remove all of them · confirm':'Remove all corrections'}</button>`:'<p class="muted small">Nothing is being adjusted. Every number on the page is Sleeper’s own.</p>'}
 <div class="override-picker"><label for="override-search">Add a correction</label>
 <input id="override-search" class="search" type="search" value="${esc(S.overrideQuery||'')}" placeholder="Search every Sleeper player…" autocomplete="off" spellcheck="false">
 <ul class="override-results" id="override-results">${pickerHTML()}</ul></div>`;
}

// The form. One record per player, so opening it on a player who already has one edits that record
// rather than adding a second.
export function overrideFormHTML(id){
 const record=lens().find(id,S.data?.week)||lens().list.find(r=>r.player===String(id))||null;
 const p=S.data?.players?.[id]||{},numbers=comparison(id),suspect=suspectNote(id);
 const points=record?.points||{};
 return `<div class="override-top"><div><span class="eyebrow">${record?'EDIT YOUR CORRECTION':'ADD A CORRECTION'}</span><h2 id="override-title">${esc(pname(id))}</h2><p class="muted small">${esc(p.team||'FA')} · ${esc(p.position||'Player')} · Sleeper id ${esc(id)}</p></div><button type="button" class="secondary" id="override-dialog-close">Close</button></div>
 <p class="override-compare num">${esc(numbers.text)} <span class="muted small">this week, ${esc(league()?.name||'league scoring')}</span></p>
 ${suspect?`<p class="data-alert">${esc(suspect)}</p>`:''}
 <div class="override-form">
  <fieldset><legend>Projected points</legend>
   <label for="override-multiplier">Multiply by<input id="override-multiplier" class="search" type="number" step="0.05" min="0" max="5" inputmode="decimal" value="${points.multiplier??''}" placeholder="1"></label>
   <label for="override-delta">Then add<input id="override-delta" class="search" type="number" step="0.1" min="-100" max="100" inputmode="decimal" value="${points.delta??''}" placeholder="0"></label>
   <p class="muted small">The multiplier runs first, then the points are added, so halving a projection and taking a point off it means what it reads like. Leave both blank to change only the designation or the note.</p>
  </fieldset>
  <fieldset><legend>Condition</legend>
   <label for="override-status">Designation<select class="select" id="override-status"><option value="">Leave as Sleeper has it</option>${STATUSES.map(s=>`<option value="${esc(s)}" ${record?.status===s?'selected':''}>${esc(s==='Healthy'?'Healthy · clear a stale designation':s)}</option>`).join('')}</select></label>
   <label for="override-body">Body part<input id="override-body" class="search" type="text" maxlength="40" value="${esc(record?.bodyPart||'')}" placeholder="Hamstring"></label>
   <label for="override-roster">Roster status<select class="select" id="override-roster"><option value="">Leave as Sleeper has it</option>${ROSTER_STATUSES.map(s=>`<option value="${esc(s)}" ${record?.rosterStatus===s?'selected':''}>${esc(s)}</option>`).join('')}</select></label>
   <p class="muted small">Out, IR, PUP and Sus withhold the projection instead of promising a zero: the owner is saying there is no number, which can make a lineup read as incomplete. Sleeper has no practice report in the player record, so there is no practice line to correct.</p>
  </fieldset>
  <fieldset><legend>Note and window</legend>
   <label for="override-note">Note<textarea id="override-note" class="search" maxlength="400" rows="2" placeholder="Why you know better than the projection">${esc(record?.note||'')}</textarea></label>
   <label for="override-from">From<select class="select" id="override-from">${weekOptions(record?.from??null,'Any week')}</select></label>
   <label for="override-until">Until<select class="select" id="override-until">${weekOptions(record?.until??null,'No end week')}</select></label>
   <p class="muted small">Weeks are inclusive. Outside its window a correction is inert and the page goes back to Sleeper’s number, and it stays on file so you can put it back.</p>
  </fieldset>
 </div>
 <div class="actions"><button type="button" class="secondary" id="override-back">Back to the list</button>${record?`<button type="button" class="secondary" data-override-remove="${esc(id)}">Remove</button>`:''}<button type="button" class="primary" id="override-save">${record?'Save the change':'Apply this correction'}</button></div>`;
}

export function overrideEditorHTML(){
 const state=S.overrideEditor;
 return state?.view==='edit'&&state.id?overrideFormHTML(state.id):overrideListHTML();
}
// On the My leagues page, so the list is reachable without a number on screen to click.
export function overridesPanelHTML(){
 const week=S.data?.week,records=lens().list,live=activeOverrides(week).length;
 return `<div class="panel"><div class="section-bar"><div><h3>Your corrections</h3><p class="muted small">${records.length?`${records.length} on file · ${live} in force in week ${week}`:'None. Every number on the page is Sleeper’s own.'}</p></div><button type="button" class="secondary" data-override-manage>${records.length?'See and remove them':'Add a correction'}</button></div><p class="muted small">A correction moves every number the app works out from a projection, and says so wherever it shows one. It is kept in this browser${S.serviceMode?' and in the Awaker service, where the digest and the alerts read it too':''}.</p></div>`;
}

export function drawOverrideDialog(){const el=dialog();if(el&&S.overrideEditor)el.innerHTML=overrideEditorHTML()}
function show(){
 const el=dialog();if(!el)return;
 drawOverrideDialog();
 if(!el.open)el.showModal();
 (el.querySelector('#override-multiplier')||el.querySelector('#override-search')||el.querySelector('#override-dialog-close'))?.focus();
}
export function openOverrideEditor(id){S.overrideEditor={id:String(id),view:'edit'};show()}
export function openOverrideManager(){S.overrideEditor={id:null,view:'list'};S.overrideQuery='';show()}

// The store applies the record before its save to the service has come back, so the page is redrawn
// at once and the warning, if there is one, arrives as a toast behind it.
function announce(promise,message){promise.then(warning=>toast(warning||message))}
function save(){
 const id=S.overrideEditor?.id;
 if(!id)return;
 const record={player:id,
  points:{multiplier:number(field('override-multiplier')?.value),delta:number(field('override-delta')?.value)},
  status:field('override-status')?.value||null,
  bodyPart:field('override-body')?.value?.trim()||null,
  rosterStatus:field('override-roster')?.value||null,
  note:field('override-note')?.value?.trim()||null,
  from:number(field('override-from')?.value),
  until:number(field('override-until')?.value),
  source:'owner'};
 const moves=record.points.multiplier!=null||record.points.delta!=null;
 if(!moves&&!record.status&&!record.bodyPart&&!record.rosterStatus&&!record.note){toast('Nothing to change yet. Move the projection, set a designation, or write a note.');return}
 const name=pname(id),promise=setOverride(record);
 S.overrideEditor={id:null,view:'list'};
 drawOverrideDialog();render();
 announce(promise,`${name} is corrected. Every projection on the page now reads through it.`);
}
function remove(id){
 const name=pname(id),promise=removeOverride(id);
 S.overrideEditor={id:null,view:'list'};
 drawOverrideDialog();render();
 announce(promise,`Correction removed. ${name} is back to Sleeper’s own number.`);
}
export function bindOverrideEditor(){
 // Openers are anywhere on the page, including inside the player profile dialog, so they are caught
 // at the document rather than wired by each page that offers one.
 document.addEventListener('click',event=>{
  const opener=event.target.closest?.('[data-override-open]');
  if(opener){event.preventDefault();openOverrideEditor(opener.dataset.overrideOpen);return}
  if(event.target.closest?.('[data-override-manage]')){event.preventDefault();openOverrideManager()}
 });
 const el=dialog();
 if(!el)return;
 el.addEventListener('click',event=>{
  const t=event.target;
  if(t.closest('#override-dialog-close')){el.close();return}
  if(t.closest('#override-save')){save();return}
  const gone=t.closest('[data-override-remove]');
  if(gone){remove(gone.dataset.overrideRemove);return}
  if(t.closest('#override-back')){S.overrideEditor={id:null,view:'list'};drawOverrideDialog();el.querySelector('#override-search')?.focus();return}
  if(t.closest('#override-clear')){
   // Removing every correction at once is asked twice, because the records are the owner's own work
   // and nothing else on the page can put them back.
   if(!S.overrideEditor?.confirming){S.overrideEditor={...S.overrideEditor,confirming:true};drawOverrideDialog();el.querySelector('#override-clear')?.focus();return}
   const promise=writeOverrides([]);
   S.overrideEditor={id:null,view:'list'};
   drawOverrideDialog();render();
   announce(promise,'Every correction is removed. The page is back to Sleeper’s numbers.');
  }
 });
 el.addEventListener('input',event=>{
  if(event.target.id!=='override-search')return;
  S.overrideQuery=event.target.value;
  const list=el.querySelector('#override-results');
  if(list)list.innerHTML=pickerHTML();
 });
 el.addEventListener('close',()=>{S.overrideEditor=null});
}
