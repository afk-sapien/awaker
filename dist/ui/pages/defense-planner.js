// Defense planner: streaming defenses by matchup.
import {defenseWeeks,defenseOutlook,defenseAvailability} from '../../defenses.js';
import {activeSlots} from '../../engine.js';
import {S} from '../state.js';
import {analysisHeader,empty,esc,fmt,league,pname,signed} from '../core.js';
import {partnerName} from './trade-finder.js';

export function defenses(){
 const l=league();if(!activeSlots(l).includes('DEF'))return analysisHeader('Defense planner','Five weeks of matchups, compared with the weekly median.')+empty('This league does not start team defenses','Select a league with a DEF slot.');
 const availability=defenseAvailability(l,S.data.players),weeks=defenseWeeks(S.data.week);
 const outlook=defenseOutlook({players:S.data.players,projections:S.data.projections,schedules:S.data.schedules,weeks,scoring:l.scoring_settings});
 const rank=Object.keys(availability).map(id=>({id,vals:weeks.map(w=>outlook[w].rows[id]?.points??null)})).sort((a,b)=>b.vals.reduce((s,v)=>s+(v??0),0)-a.vals.reduce((s,v)=>s+(v??0),0));
 const usable=rank.filter(r=>availability[r.id].canUse);
 // The question is who to play each week, so every week gets an answer: the best of mine, and a pickup when one clearly beats it.
 const best=(list,i)=>list.filter(r=>r.vals[i]!==null).sort((a,b)=>b.vals[i]-a.vals[i])[0],mineRows=usable.filter(r=>availability[r.id].status==='mine'),freeRows=usable.filter(r=>availability[r.id].status==='available');
 const plan=weeks.map((week,i)=>{const own=best(mineRows,i),free=best(freeRows,i),gain=free&&own?free.vals[i]-own.vals[i]:free?free.vals[i]:0,stream=!!free&&(!own||gain>=1);return {week,own,free,gain,stream,pick:stream?free:own,i}});
 // Mine, then the ones I could add, then the ones I cannot have.
 const order={mine:0,available:1,other:2};rank.sort((a,b)=>order[availability[a.id].status]-order[availability[b.id].status]);
 let bestPair=null;
 for(const a of usable)for(const b of usable){if(a.id>=b.id||[...a.vals,...b.vals].some(x=>x===null))continue;const total=a.vals.reduce((s,v,i)=>s+Math.max(v,b.vals[i]),0);if(!bestPair||total>bestPair.total)bestPair={a,b,total}}
 const bestSingle=usable.filter(r=>r.vals.every(v=>v!==null)).sort((a,b)=>b.vals.reduce((s,v)=>s+v,0)-a.vals.reduce((s,v)=>s+v,0))[0];
 return analysisHeader('Defense planner',`Who to play each week through week ${weeks.at(-1)}: yours first, then the ones you could add.`)+`${bestPair&&bestSingle?`<div class="panel decision"><div><div class="eyebrow">BEST TWO-DEFENSE ROTATION · ${weeks.length} WEEKS</div><h2>${esc(bestPair.a.id)} + ${esc(bestPair.b.id)}</h2><p class="muted small">${weeks.map((w,i)=>`Week ${w}: ${esc(bestPair.a.vals[i]>=bestPair.b.vals[i]?bestPair.a.id:bestPair.b.id)}`).join(' · ')}</p></div><div><div class="big-number gain">${signed(bestPair.total-bestSingle.vals.reduce((s,v)=>s+v,0))}</div><div class="muted small">over best single defense</div></div></div>`:`<p class="data-alert">${S.busy?'Loading the five-week outlook…':`A rotation needs projections for all ${weeks.length} weeks. Available weeks are shown below.`}</p>`}
 <div class="defense-plan">${plan.map(p=>`<div class="defense-plan-week ${p.stream?'stream':''}"><div class="eyebrow">WEEK ${p.week}</div>${p.pick?`<strong>${esc(p.pick.id)} <span class="num">${fmt(p.pick.vals[p.i])}</span></strong><span class="small ${p.stream?'gain':'muted'}">${p.stream?(p.own?`Pick up · ${signed(p.gain)} over ${esc(p.own.id)}`:'Pick up · you have none'):p.free&&p.gain>0?`Keep yours · ${esc(p.free.id)} is only ${signed(p.gain)}`:'Keep yours · nothing better is free'}</span>`:'<strong class="muted">—</strong><span class="small muted">No projection yet</span>'}</div>`).join('')}</div>
 <div class="defense-legend" aria-label="Defense availability colors"><span>Team names</span><span class="defense-owner-available">Available</span><span class="defense-owner-other">Rostered elsewhere</span><span class="defense-owner-mine defense-your-team">Your team</span></div>
 <div class="defense-legend" aria-label="Defense projection color scale"><span>Points vs weekly median</span>${[['poor','−3 or less'],['weak','−3 to −1'],['neutral','Within 1'],['good','+1 to +3'],['strong','+3 or more']].map(([tone,label])=>`<span class="defense-key defense-${tone}">${label}</span>`).join('')}</div>
 <div class="panel table-wrap defense-table-wrap"><table class="week-table defense-table"><thead><tr><th scope="col">DEFENSE</th>${weeks.map(w=>`<th scope="col">WEEK ${w}<span class="defense-median">Median ${fmt(outlook[w].median)}</span><span class="defense-sample">${outlook[w].count} defenses</span></th>`).join('')}</tr></thead><tbody>${rank.map(r=>`<tr class="defense-row-${availability[r.id].status}"><th scope="row" class="defense-owner-${availability[r.id].status}" title="${esc(availability[r.id].status==='other'?partnerName(l,l.rosters.find(owner=>owner.roster_id===availability[r.id].rosterId)):'')}"><span class="defense-name">${esc(pname(r.id))}</span><span class="defense-team">${esc(r.id)}</span><span class="defense-ownership ${availability[r.id].status==='mine'?'defense-your-team':''}">${({mine:'Your team',other:'Rostered elsewhere',available:'Available'})[availability[r.id].status]}</span></th>${weeks.map(w=>{
 const cell=outlook[w].rows[r.id],p=S.data.projections[w]?.[r.id],g=S.data.schedules[w]?.[S.data.players[r.id]?.team||r.id];
 const delta=cell.delta===null?'No projection':Math.abs(cell.delta)<.05?'At median':`${fmt(Math.abs(cell.delta))} ${cell.delta>0?'above':'below'} median`;
 return `<td class="defense-cell defense-${cell.tone}"><strong>${cell.bye?'BYE':fmt(cell.points)}</strong><div class="defense-opponent">${cell.bye?'No game':g?`${g.home?'vs':'@'} ${esc(g.opponent)}`:p?.opponent?'vs '+esc(p.opponent):'Schedule unavailable'}</div><div class="defense-delta">${cell.bye?'Not in median':delta}</div></td>`;
 }).join('')}</tr>`).join('')}</tbody></table></div>
 <p class="muted small">Each median uses all NFL defenses with a projection that week, including other teams’ rostered defenses, scored for this league. Byes are excluded; unavailable projections stay uncolored. Green is above median, orange is below.</p>
 <details class="data-details"><summary>Rotation & roster costs</summary><p>Rotations use only your active-roster defenses and available pickups; defenses rostered elsewhere are shown for comparison only. A second defense costs a bench spot. Rotation gain does not subtract drop value, waiver costs, or pickup restrictions. Confirm those costs before making a move.</p></details>`;
}
