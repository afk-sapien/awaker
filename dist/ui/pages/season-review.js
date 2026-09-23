// Season review: the week in review and every finished week against its projection.
import * as api from '../../api.js';
import {teamName} from '../../league.js';
import {weekReview,moves as weekMoves,seasonReview,tone as seasonTone} from '../../season.js';
import {S} from '../state.js';
import {$,analysisHeader,empty,esc,fmt,injury,league,playerChip,pname,signed} from '../core.js';
import {render} from '../render.js';

export function finishedWeeks(){const done=Object.values(S.data.games||{}).length&&Object.values(S.data.games).every(g=>g.state==='post');return Array.from({length:Math.max(0,S.data.week-(done?0:1))},(_,i)=>i+1)}
export function seasonReviewKey(){return JSON.stringify([S.data.demo?'demo':S.data.user.user_id,S.data.nfl?.season,finishedWeeks()])}
// Both halves of the Season review page load together and share a refresh.
export function ensureSeasonPage(force=false){ensureSeasonReview(force);ensureRecap(force)}
export async function ensureSeasonReview(force=false){
 const key=seasonReviewKey(),weeks=finishedWeeks();
 if(S.seasonReviewState?.key===key&&!force&&(S.seasonReviewState.loading||S.seasonReviewState.weeks))return;
 const state={key,loading:true,weeks:null,error:null,done:0,total:weeks.length};S.seasonReviewState=state;if(S.view==='season')render();
 try{
  if(S.data.demo)throw Error('The season review needs real results. Connect Sleeper to see it.');
  if(!weeks.length)throw Error('No week has finished yet. Come back after the first games.');
  const loaded=[];
  for(const week of weeks){const [stats,projections]=await Promise.all([api.stats(S.data.nfl.season,week,{force}),api.projections(S.data.nfl.season,week)]);loaded.push({week,stats,projections});state.done++;if(S.seasonReviewState===state&&$('#season-progress'))$('#season-progress').textContent=`Loading week ${state.done} of ${state.total}…`}
  state.weeks=loaded;
 }catch(e){state.error=e.message}finally{state.loading=false;if(S.seasonReviewState===state&&S.view==='season')render()}
}
export function recapTarget(){const weeks=finishedWeeks();return weeks.includes(S.recapWeek)?S.recapWeek:weeks.at(-1)??null}
export function recapKey(l=league()){return JSON.stringify([S.data.demo?'demo':S.data.user.user_id,S.data.nfl?.season,l?.league_id,recapTarget()])}
export async function ensureRecap(force=false){
 const l=league();if(!l)return;const key=recapKey(l),week=recapTarget();
 if(S.recapState?.key===key&&!force&&(S.recapState.loading||S.recapState.review))return;
 const state={key,loading:true,review:null,moves:null,error:null};S.recapState=state;if(S.view==='season')render();
 try{
  if(!week)throw Error('No week has finished yet. Come back after the first games.');
  // The demo has one week of sample scores and no transactions, which is enough to show the shape.
  const history=S.data.demo?{data:{[week]:{matchups:l.matchups,transactions:[],stats:{},projections:S.data.projections[S.data.week]||{}}}}
   :await api.leagueHistory(S.data.nfl.season,l.league_id,[week],{force});
  if(!history.data[week])throw Error(`Week ${week} could not be loaded. Try again in a moment.`);
  const {matchups,transactions,stats,projections,games=null,next=null}=history.data[week];
  state.review=weekReview({league:l,players:S.data.players,week,matchups,projections});
  state.moves=weekMoves({league:l,players:S.data.players,week,transactions,matchups,stats,games,next});
 }catch(e){state.error=e.message}finally{state.loading=false;if(S.recapState===state&&S.view==='season')render()}
}
export const CALL_TONES={avoidable:'poor','toss-up':'neutral',defensible:'good'},MOVE_TONES={backfired:'poor','unused bid':'weak',stashed:'neutral',neutral:'neutral','paid off':'strong'};
// 'not played yet' and 'unknown' are deliberately absent: no color, because there is no verdict.
export const toneClass=(map,label)=>map[label]?` defense-${map[label]}`:'';
export function weekInReview(l){
 const week=recapTarget(),weeks=finishedWeeks(),state=S.recapState?.key===recapKey(l)?S.recapState:null;
 const options=(weeks.length?[...weeks].reverse():[S.data.week]).map(w=>`<option value="${w}" ${w===week?'selected':''}>Week ${w}</option>`).join('');
 const bar=`<div class="waiver-toolbar recap-bar"><label>Review <select class="select" id="recap-week" ${weeks.length<2?'disabled':''}>${options}</select></label><span class="muted small">${esc(l.name)}${S.data.demo?' · Sample data':''}</span><button class="secondary" id="refresh-recap" ${state?.loading?'disabled':''}>${state?.loading?'Loading…':'Refresh week'}</button></div>`;
 const head=`<h2>Week in review</h2>${bar}`;
 if(!state||state.loading)return head+`<div class="empty" role="status"><h3 id="recap-progress">Loading week ${week??''}…</h3><p>Finished weeks never change, so this is kept on this device.</p></div>`;
 if(state.error)return head+empty(state.error);
 const {review,moves:made}=state,mine=review.rows.find(r=>r.rosterId===l.mine.roster_id),s=review.summary;
 if(!mine?.played)return head+empty(`Your team had no matchup in week ${week}.`,'Pick another week above.');
 const tile=(label,value,note,tone='')=>`<div class="league-tile tile-${tone}"><div class="eyebrow">${label}</div><strong>${value}</strong><span class="muted small">${note}</span></div>`;
 // left is hindsight; cost is the part that was knowable at kickoff. Keeping them in separate tiles is
 // the whole point of the page: one is the football gods, the other is a decision.
 const calls=mine.cost<-.05?tile('YOUR CALLS COST',signed(mine.cost),'vs the advised lineup','bad')
  :mine.cost>.05?tile('YOUR CALLS GAINED',signed(mine.cost),'vs the advised lineup','good')
  :tile('YOUR CALLS','Even','You set the advised lineup');
 const named=id=>id==null?'—':teamName(l,id).team;
 const tiles=`<div class="league-tiles">${tile('YOUR WEEK',`${fmt(mine.points)}<small> vs ${fmt(mine.against)}</small>`,mine.result===null?'No opponent this week':`${mine.result==='win'?'Won':mine.result==='loss'?'Lost':'Tied'} vs ${esc(named(mine.opponentId))}`,mine.result==='win'?'good':mine.result==='loss'?'bad':'')}
  ${tile('LEFT ON YOUR BENCH',fmt(mine.left),'Best lineup, in hindsight',mine.left>0?'bad':'good')}
  ${calls}${tile('THE LEAGUE LEFT BEHIND',fmt(s.leftOnBench),`Across ${s.teams} team${s.teams===1?'':'s'}`)}</div>`;
 const swung=mine.swung?`<p class="data-alert">You lost by ${fmt(Math.abs(mine.margin))} with ${fmt(mine.left)} sitting on your bench.</p>`:'';
 const call=d=>d.played===null?`Left a slot empty · ${esc(pname(d.sat))} sat`:`Started ${esc(pname(d.played))} over ${esc(pname(d.sat))}`;
 const decisions=mine.decisions.length?`<div class="panel table-wrap"><table class="week-table"><thead><tr><th scope="col">YOUR CALL</th><th scope="col">POINTS MISSED</th><th scope="col">PROJECTED EDGE</th><th scope="col">VERDICT</th></tr></thead><tbody>${mine.decisions.map(d=>`<tr><th scope="row">${call(d)}</th><td class="num loss">${fmt(d.gained)}</td><td class="num ${d.foreseen===null?'muted':''}">${d.foreseen===null?'no projection':signed(d.foreseen)}</td><td><span class="pill${toneClass(CALL_TONES,d.label)}" title="${d.label==='avoidable'?'The projections favored the player who sat, so this was knowable before kickoff.':d.label==='defensible'?'The projections favored the player you started. This one was bad luck.':d.label==='toss-up'?'Inside a point either way before kickoff.':'One of the two had no projection, so there is no verdict.'}">${esc(d.label)}</span></td></tr>`).join('')}</tbody></table></div>`
  :`<p class="muted">Your lineup was the best one available. Nothing was left behind.</p>`;
 const played=review.rows.filter(r=>r.played).sort((a,b)=>b.points-a.points);
 const table=`<div class="panel table-wrap defense-table-wrap"><table class="week-table"><thead><tr><th scope="col">TEAM</th><th scope="col">RESULT</th><th scope="col">POINTS</th><th scope="col">LEFT ON BENCH</th><th scope="col">THE CALLS</th></tr></thead><tbody>${played.map(r=>{
  const own=r.rosterId===l.mine.roster_id,who=teamName(l,r.rosterId);
  return `<tr><th scope="row">${own?'<strong>':''}${esc(who.team)}${own?'</strong>':''}${who.manager?`<div class="muted small">${esc(who.manager)}</div>`:''}</th>
  <td class="${r.result==='win'?'gain':r.result==='loss'?'loss':'muted'}">${r.result===null?'—':`${r.result==='win'?'W':r.result==='loss'?'L':'T'} ${signed(r.margin)}`}<div class="muted small">${r.opponentId==null?'':'vs '+esc(named(r.opponentId))}</div></td>
  <td class="num"><strong>${fmt(r.points)}</strong></td><td class="num ${r.left>0?'loss':'muted'}">${fmt(r.left)}</td>
  <td class="num ${r.cost<-.05?'loss':r.cost>.05?'gain':'muted'}">${signed(r.cost)}${r.complete?'':'<div class="muted small">partial</div>'}</td></tr>`;
 }).join('')}</tbody></table></div>
 <p class="muted small">${s.closest?`Closest game: ${fmt(s.closest.margin)} points. ${s.widest?`Widest: ${fmt(s.widest.margin)}. `:''}`:''}League average ${fmt(s.average)}, high ${fmt(s.high)}, low ${fmt(s.low)}.</p>`;
 const moveRow=r=>{
  const side=(list,verb)=>list.length?`${verb} ${list.map(p=>esc(pname(p.id))).join(' + ')}`:'';
  const sentence=s=>s.charAt(0).toUpperCase()+s.slice(1);
  const who=[...new Set((r.rosterIds||[]).map(id=>teamName(l,id).team))].map(esc).join(' ⇄ ');
  const detail=r.type==='trade'?r.sides.map(x=>`${esc(teamName(l,x.rosterId).team)} ${x.net===null?'—':signed(x.net)}`).join(' · ')
   :sentence([side(r.adds,'added'),side(r.drops,'dropped')].filter(Boolean).join(', '));
  // A claim that cleared after the last kickoff is for the week after, so it is scored on that week.
  const impact=r.type==='trade'?'—':!r.played?'—':r.net===null?'—':signed(r.net);
  const tone=r.type==='trade'||!r.played||r.net===null?'muted':r.net<-.05?'loss':r.net>.05?'gain':'muted';
  return `<tr><th scope="row">${detail||'—'}${r.bid?`<div class="muted small">$${r.bid} of FAAB</div>`:''}</th><td>${who}</td><td class="num ${tone}">${impact}<div class="muted small">week ${r.forWeek}</div></td><td>${r.label?`<span class="pill${toneClass(MOVE_TONES,r.label)}">${esc(r.label)}</span>`:'<span class="muted small">one week says little</span>'}</td></tr>`;
 };
 const pending=made.summary.pending;
 const wire=made.rows.length?`<div class="panel table-wrap"><table class="week-table"><thead><tr><th scope="col">MOVE</th><th scope="col">TEAM</th><th scope="col">POINTS</th><th scope="col">VERDICT</th></tr></thead><tbody>${made.rows.map(moveRow).join('')}</tbody></table></div>
  <p class="muted small">${made.summary.count} move${made.summary.count===1?'':'s'} cleared${made.summary.trades?`, ${made.summary.trades} of them trade${made.summary.trades===1?'':'s'}`:''}${made.summary.spent?`, $${fmt(made.summary.spent,0)} of FAAB spent`:''}. Waivers run after the week's last game, so a move is judged on the week it could first affect${pending?`; ${pending} of these are waiting on games that have not been played`:''}.</p>`
  :'<p class="muted">Nobody touched their roster this week.</p>';
 return head+tiles+swung+`<h3>The calls that were there to be made</h3>${decisions}<h3>Every team</h3>${table}<h3>The wire</h3>${wire}
 <details class="data-details"><summary>How this is judged</summary><p><strong>Left on bench</strong> is the gap to the best lineup that roster could have fielded, known only afterwards. It mixes bad luck with bad decisions, so on its own it is not a verdict on anybody.</p><p><strong>The calls</strong> is the gap to the lineup Sleeper's projections advised before kickoff, scored with what actually happened. A negative number means going against the projections cost points; a positive one means the manager out-picked them. A start/sit is only called <em>avoidable</em> when the projections favored the player who sat by more than a point — otherwise nobody could have known, and it belongs with the luck.</p><p>Moves are graded on the week they were made and nothing more. A stashed player who scored nothing is not yet a mistake, and one week cannot say who won a trade, which is why trades get both sides and no verdict.</p></details>`;
}
export function season(){
 const l=league(),state=S.seasonReviewState?.key===seasonReviewKey()?S.seasonReviewState:null,head=analysisHeader('Season review','Every finished week against what was projected, and how hard the road ahead is.')+(l?weekInReview(l):'')+'<h2>Your players, week by week</h2>';
 if(!state||state.loading)return head+`<div class="empty" role="status"><h3 id="season-progress">Loading the season so far…</h3><p>Finished weeks are kept on this device, so this is quick next time.</p></div>`;
 if(state.error)return head+empty(state.error);
 const review=seasonReview({league:l,players:S.data.players,weeks:state.weeks,schedules:S.data.schedules,currentWeek:S.data.week});
 const cell=c=>c.actual===null&&c.expected===null?'<td class="defense-cell season-cell muted">—</td>':`<td class="defense-cell season-cell defense-${seasonTone(c.diff)}" title="${c.diff===null?'Did not play':`${signed(c.diff)} against a projection of ${fmt(c.expected)}`}"><strong>${c.actual===null?'—':fmt(c.actual)}</strong><div class="small">${c.diff===null?(c.actual===null?'did not play':'no projection'):`proj ${fmt(c.expected)}`}</div>${c.opponent?`<div class="small muted">${esc(c.opponent)}</div>`:''}</td>`;
 const next=u=>`<span class="season-next ${u.matchup?`defense-${u.matchup.tone}`:''}" title="${u.matchup?`${esc(u.opponent)} allow the ${u.matchup.rank}${['th','st','nd','rd'][u.matchup.rank%10>3||Math.floor(u.matchup.rank/10)===1?0:u.matchup.rank%10]} fewest points to his position (${fmt(u.matchup.average)} a game)`:'Not enough games to rank this matchup'}">W${u.week} ${u.opponent?esc(u.opponent):'bye'}${u.matchup?` · ${esc(u.matchup.label)}`:''}</span>`;
 const played=review.rows.filter(r=>r.games&&r.starter),sorted=[...played].sort((a,b)=>b.diff-a.diff),team=played.reduce((sum,r)=>sum+r.diff,0),up=sorted[0],down=sorted.at(-1);
 const tile=(label,value,note,tone='')=>`<div class="league-tile tile-${tone}"><div class="eyebrow">${label}</div><strong>${value}</strong><span class="muted small">${note}</span></div>`;
 const summary=played.length?`<div class="league-tiles">${tile('YOUR STARTERS AGAINST PROJECTION',signed(team),`Over ${review.weeks.length} finished week${review.weeks.length===1?'':'s'}`,team>=0?'good':'bad')}${up&&up.diff>0?tile('CARRYING YOU',`<span class="tile-text">${esc(pname(up.id))}</span>`,`${signed(up.diff)} against projection`,'good'):''}${down&&down.diff<0&&down!==up?tile('LETTING YOU DOWN',`<span class="tile-text">${esc(pname(down.id))}</span>`,`${signed(down.diff)} against projection`,'bad'):''}${tile('WORTH A LOOK',String(review.rows.filter(r=>['Shop or sit','Sell high?'].includes(r.verdict.label)).length),'Players flagged to shop or sell below')}</div>`:'';
 return head+summary+`<div class="defense-legend" aria-label="Points against projection"><span>Points against projection</span>${[['poor','−5 or worse'],['weak','−5 to −2'],['neutral','Within 2'],['good','+2 to +5'],['strong','+5 or more']].map(([t,label])=>`<span class="defense-key defense-${t}">${label}</span>`).join('')}</div>
 <div class="panel table-wrap defense-table-wrap"><table class="week-table season-table"><thead><tr><th scope="col">PLAYER</th>${review.weeks.map(w=>`<th scope="col">WEEK ${w}</th>`).join('')}<th scope="col">TOTAL</th><th scope="col">VS PROJ.</th><th scope="col">NEXT UP</th><th scope="col">READ</th></tr></thead><tbody>${review.rows.map(r=>`<tr><th scope="row" class="season-player">${playerChip(r.id,`<div class="muted small">${esc(S.data.players[r.id]?.team||'FA')} · ${esc(r.position||'')}${r.starter?'':' · bench'}${injury(S.data.players[r.id])}</div>`)}</th>${r.cells.map(cell).join('')}<td class="num"><strong>${fmt(r.total)}</strong></td><td class="num ${r.diff>0?'gain':r.diff<0?'loss':'muted'}">${r.games?`${signed(r.diff)}<div class="small muted">${signed(r.average)} / game</div>`:'—'}</td><td class="season-upcoming">${r.upcoming.map(next).join('')||'<span class="muted small">—</span>'}</td><td><span class="pill season-read defense-${r.verdict.tone}" title="${esc(r.verdict.note)}">${esc(r.verdict.label)}</span>${['Shop or sit','Under-performing','Sell high?'].includes(r.verdict.label)?`<button class="link-like" data-shop="${esc(r.id)}">See offers →</button>`:''}</td></tr>`).join('')}</tbody></table></div>
 <details class="data-details"><summary>How to read this</summary><p>Each cell is what he scored in your league’s scoring, colored by how far that was from Sleeper’s projection for that week. Weeks he did not play are left out of the averages. Next up ranks each coming opponent by the fantasy points it has allowed to his position this season: Tough is the stingiest third, Easy the most generous third. The read combines the two and needs at least two games. It is a prompt to look closer, not a verdict. Early in the season a few games say very little.</p></details>`;
}
