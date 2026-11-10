import test from 'node:test';
import assert from 'node:assert/strict';

// The dashboard's pages are functions of one state object that return HTML, so they can be drawn here
// without a browser. Only the handful of browser objects they touch are stood in for.
const node=()=>({innerHTML:'',textContent:'',value:'',hidden:false,style:{},dataset:{},classList:{toggle(){},add(){},remove(){},contains:()=>false},setAttribute(){},removeAttribute(){},focus(){},addEventListener(){},querySelector:()=>null,querySelectorAll:()=>[]});
const app=node();
globalThis.localStorage={getItem:()=>null,setItem(){}};
globalThis.document={activeElement:null,hidden:false,querySelector:s=>s==='#app'?app:null,querySelectorAll:()=>[],body:{classList:{toggle(){}}},documentElement:{style:{setProperty(){}}},addEventListener(){}};
globalThis.location={search:'',href:'http://127.0.0.1/'};globalThis.history={replaceState(){}};globalThis.window={scrollTo(){}};

const {S}=await import('../dist/ui/state.js');
const {demo}=await import('../dist/demo.js');
const {readPreferences,applyPreferences}=await import('../dist/ui/preferences.js');
const {render}=await import('../dist/ui/render.js');
const {ensureTradeOutlook}=await import('../dist/ui/outlook.js');
const {ensureWaiverOutlook}=await import('../dist/ui/pages/waiver-wire.js');
const {ensureSeasonPage}=await import('../dist/ui/pages/season-review.js');
const {ensureLeagueSeason}=await import('../dist/ui/pages/league-outlook.js');

const PAGES={watch:'Awaker watchroom',scoreboard:'Around the league',waivers:'Waiver wire',lineup:'Start / sit',trades:'Auto trades','trade-builder':'Trade builder',defenses:'Defense planner',season:'Season review',league:'League outlook',settings:'My leagues'};
const LOADS={trades:ensureTradeOutlook,'trade-builder':ensureTradeOutlook,waivers:ensureWaiverOutlook,season:ensureSeasonPage,league:ensureLeagueSeason,scoreboard:ensureLeagueSeason};
function start(data=demo()){for(const k of Object.keys(S))if(k.endsWith('State'))S[k]=null;S.data=data;applyPreferences(readPreferences(null))}
async function draw(view){S.view=view;render();const before=app.innerHTML;if(LOADS[view]){await LOADS[view]();await new Promise(done=>setTimeout(done,50));render()}return {before,after:app.innerHTML}}

test('every page draws from the demo, before and after its data loads',async()=>{
 start();
 for(const [view,title] of Object.entries(PAGES)){
  const {before,after}=await draw(view);
  for(const html of [before,after]){assert.match(html,new RegExp(`<h1[^>]*>${title.replace('/','\\/')}`),view);assert.doesNotMatch(html,/could not be drawn/,view)}
 }
 assert.match((await draw('trade-builder')).after,/Analyze season impact/);
 assert.match((await draw('waivers')).after,/data-waiver-position/);
});

test('names from Sleeper are escaped on every page',async()=>{
 const hostile='<img src=x onerror=alert(1)>',data=demo();
 for(const l of data.leagues){l.name=hostile+l.name;for(const u of l.users||[])u.display_name=hostile}
 for(const p of Object.values(data.players)){p.full_name=hostile+p.full_name;p.first_name=hostile}
 start(data);
 for(const view of Object.keys(PAGES)){const {before,after}=await draw(view);for(const html of [before,after])assert.ok(!html.includes('<img src=x'),`${view} printed a name as HTML`)}
});

test('saved preferences are trusted in shape only, and a broken save starts clean',()=>{
 for(const broken of ['null','[]','"text"','{not json',undefined])assert.deepEqual(readPreferences(broken),{},String(broken));
 const prefs=readPreferences(JSON.stringify({pins:'4035',disabled:[1],username:7,watchLeague:'L1',waiverProtected:{a:['1'],b:'2'},tradeExcluded:[],tradeMinGain:3}));
 assert.deepEqual(prefs,{disabled:[1],watchLeague:'L1',waiverProtected:{a:['1']},tradeMinGain:3});
 start();applyPreferences(readPreferences(JSON.stringify({waiverIncluded:['QB','RB'],tradeMaxGap:9,tradeSort:'nonsense',watchRole:'both'})));
 assert.deepEqual(S.waiverExcluded,{add:['WR','TE','K','DEF'],drop:[]},'the older waiverIncluded list still reads');
 assert.equal(S.tradeMaxGap,1);assert.equal(S.tradeSort,'score');assert.equal(S.watchRole,'both');
});

test('the service decides the account and leagues; the browser keeps everything else',()=>{
 const prefs=readPreferences(JSON.stringify({username:'someone-else',disabled:['x'],showBench:false,tradeMinGain:2}),{username:'owner',disabled:['L2'],preferences:{tradeMinGain:4}});
 assert.equal(prefs.username,'owner');assert.deepEqual(prefs.disabled,['L2']);assert.equal(prefs.tradeMinGain,4);assert.equal(prefs.showBench,false);
});

test('injury designations are colored by how likely he is to play, and a player ruled out projects zero this week',async()=>{
 const {injury,value}=await import('../dist/ui/core.js');
 assert.equal(injury({}),'');
 for(const [status,tone] of [['Out','out'],['IR','out'],['Sus','out'],['PUP','out'],['Doubtful','doubtful'],['Questionable','questionable'],['NA','other']])assert.match(injury({injury_status:status}),new RegExp(`class="injury injury-${tone}">${status}<`),status);
 const data=demo();start(data);
 const league=data.leagues.find(l=>l.enabled),id=league.mine.starters.find(id=>Number(value(id,league))>0),next=data.week+1;
 data.players[id].injury_status='Out';const team=data.players[id].team,game=data.games[team];
 data.games[team]={...game,state:'pre'};assert.equal(value(id,league),0,'before kickoff this week, he scores nothing');
 data.games[team]={...game,state:'in'};assert.ok(value(id,league)>0,'once his game is on, the pregame projection stands');
 data.games[team]={...game,state:'pre'};
 if(data.projections[next]?.[id])assert.ok(value(id,league,next)>0,'a later week is not decided by today’s status');
 S.data.nfl={...S.data.nfl,week:S.data.week+1};assert.ok(value(id,league)>0,'on a week other than the NFL’s current one, today’s status decides nothing');S.data.nfl={...S.data.nfl,week:S.data.week};
 S.filter='all';const {before}=await draw('watch');assert.ok(before.includes('class="injury injury-out">Out<'),'his card carries the red badge');
});
test('the Notifications count starts at zero in a new browser, then counts pushes delivered since the last visit',async()=>{
 const {unread,markSeen,badge}=await import('../dist/ui/unread.js'),saved=globalThis.localStorage,kept={};
 globalThis.localStorage={getItem:k=>kept[k]??null,setItem:(k,v)=>{kept[k]=v}};
 try{
  const worker={outbox:[{status:'accepted',acceptedAt:300},{status:'accepted',acceptedAt:100},{status:'failed'},{status:'pending'}]};
  assert.equal(unread(worker),0,'a first visit does not count the whole history');
  markSeen(200);assert.equal(unread(worker),1);assert.equal(unread(null),0);
  assert.match(badge(3),/>3</);assert.match(badge(150),/>99\+</);assert.equal(badge(0),'');
 }finally{globalThis.localStorage=saved}
});

test('selected player decisions stay scoped and compare trades with the same future window',async()=>{
 const {selectedWaiverDrop,protectionKey,waiverRows}=await import('../dist/ui/pages/waiver-wire.js')
 const {askFor}=await import('../dist/ui/pages/trade-finder.js')
 start()
 const l=S.data.leagues[0]
 S.leagueId=l.league_id
 S.waiverHorizon='next'
 S.waiverDropSelection={key:protectionKey(l),id:'8155'}
 assert.equal(selectedWaiverDrop(l),'8155')
 assert.equal(selectedWaiverDrop(S.data.leagues[1]),null)
 const html=(await draw('waivers')).after
 assert.match(html,/Find trade returns/)
 assert.match(html,/Beyond projections/)
 assert.ok(waiverRows().filter(r=>r.status==='upgrade'||r.status==='bench').every(r=>r.drop==='8155'))
 await draw('trades')
 await askFor('shop','8155')
 assert.match(app.innerHTML,/Keep, replace, or trade/)
 assert.match(app.innerHTML,/Same weeks 3 to 4/)
 assert.match(app.innerHTML,/LINEUP GAIN \/ WEEK/)
 l.mine.players=l.mine.players.filter(id=>id!=='8155')
 assert.equal(selectedWaiverDrop(l),null)
 S.waiverDropSelection=null
})

test('research failures pause partial results and an old week cannot appear as current research',async()=>{
 const {scoutingKey,scoutingPanel,loadScouting}=await import('../dist/ui/scouting.js')
 start()
 const l=S.data.leagues[0]
 S.view='waivers'
 await loadScouting()
 assert.match(scoutingPanel(l),/Illustrative sample stats/)
 assert.match(scoutingPanel(l),/Small sample/)
 S.scoutingState.errors=[1]
 assert.match(scoutingPanel(l),/Research results are paused/)
 assert.doesNotMatch(scoutingPanel(l),/<table>/)
 const previousKey=scoutingKey()
 S.data.week=3
 assert.notEqual(scoutingKey(),previousKey)
 assert.match(scoutingPanel(l),/Explore recent performance/)
 assert.doesNotMatch(scoutingPanel(l),/Research results are paused/)
})

test('opening research reuses the stored weekly results and only the refresh refetches them',async()=>{
 const {loadScouting}=await import('../dist/ui/scouting.js')
 const api=await import('../dist/api.js')
 const original=globalThis.fetch
 const calls=[]
 const weekly=()=>calls.filter(u=>u.includes('/stats/nfl/')).length
 globalThis.fetch=async url=>{
  calls.push(String(url))
  return Response.json(String(url).includes('/stats/nfl/')?[{player_id:'4984',stats:{gp:1,pts_ppr:12}}]:{})
 }
 try{
  start()
  S.data.demo=false
  S.data.nfl.season='2099'
  S.data.week=4
  S.view='waivers'
  for(const week of [1,2,3])await api.stats('2099',week)
  const warmed=weekly()
  assert.equal(warmed,3)
  await loadScouting()
  assert.equal(weekly(),warmed,'the first load reads the weeks already held')
  assert.deepEqual(Object.keys(S.scoutingState.history),['1','2','3'])
  assert.deepEqual(S.scoutingState.errors,[])
  await loadScouting()
  assert.equal(weekly(),warmed+3,'the refresh retries every week against Sleeper')
 }finally{globalThis.fetch=original}
})

test('a host can rename the app and add footer links, and nothing else about the page moves',async()=>{
 const {DEFAULT_SITE,siteConfig}=await import('../dist/site.js');
 start();
 const plain=(await draw('watch')).before;
 assert.match(plain,/<div class="brand">awaker<em>/,'the default name is the one in the page today');
 try{
  S.site=siteConfig({name:'WideAwake',links:[{label:'About',href:'/about'},{label:'Blog',href:'https://example.com/blog'},{label:'Bad',href:'javascript:alert(1)'}]});
  const html=(await draw('watch')).before;
  assert.match(html,/<div class="brand">wideawake<em>/,'the sidebar wordmark stays lower case');
  assert.match(html,/<div class="mobile-brand">wideawake／<\/div>/);
  assert.match(html,/<span class="site-link"><a href="\/about">About<\/a><\/span>/,'a page on this site opens in this tab');
  assert.match(html,/<span class="site-link"><a href="https:\/\/example.com\/blog" target="_blank" rel="noopener">Blog<\/a><\/span>/);
  assert.ok(!html.includes('javascript:'),'a link the config could not vouch for is never drawn');
  assert.ok(!html.includes('>Bad<'));
  assert.match(html,/docs.sleeper.com/,'the data credits stay in the footer');
  assert.match(html,/NFL game status: ESPN/);
  // The name is the name of the app everywhere it is read, not only on the wordmark.
  assert.ok(!/awaker/i.test(html),'no page the dashboard draws still says the old name');
  assert.match(html,/<h1[^>]*>WideAwake watchroom/,'the page heading');
  assert.match(html,/data-nav="watch"[^>]*>.*?WideAwake watchroom/s,'the nav label');
  assert.match(html,/<strong>WideAwake watchroom<\/strong>/,'the breadcrumb');
  const {themePicker}=await import('../dist/ui/theme.js');
  const fields={'#theme-team':node(),'#theme-preview-name':node(),'#theme-status':node()};
  const before=globalThis.document.querySelector;
  globalThis.document.querySelector=s=>fields[s]||before(s);
  try{themePicker()}finally{globalThis.document.querySelector=before}
  assert.match(fields['#theme-team'].innerHTML,/>WideAwake original</,'and the theme named after the app');
  assert.equal(fields['#theme-preview-name'].textContent,'WideAwake original');
  const named=siteConfig({name:'Sunday <b>HQ</b> & Co',links:[{label:'<img src=x onerror=alert(1)>',href:'/x'}]});
  S.site=named;
  const escaped=(await draw('watch')).before;
  assert.ok(!escaped.includes('<b>HQ</b>')&&!escaped.includes('<img src=x'),'a name or label from a file is printed, not run');
 }finally{S.site=DEFAULT_SITE}
 assert.equal((await draw('watch')).before,plain,'and a host that configured nothing sees the page it had');
})

// One sizing decision for every view: the controls that were smaller than 24px are brought up to
// 24px on a phone, and the footer credit joins the row of footer links instead of sitting inside a
// sentence. Written against the stylesheet rather than a browser, so the rule cannot be dropped
// while the pages still draw.
test('the small controls are a 24px target at phone width, and the credit is a footer link',async()=>{
 const {readFileSync}=await import('node:fs');
 const css=readFileSync(new URL('../dist/styles.css',import.meta.url),'utf8');
 const touch='@media(max-width:760px),(pointer:coarse)';
 const block=css.slice(css.indexOf(`${touch}{\n .inline-btn`));
 assert.ok(block.startsWith(touch),'the touch-target block is still there to read');
 const rules=block.slice(0,block.indexOf('\n}'));
 assert.match(rules,/\.inline-btn,\.link-external\{[^}]*min-height:24px/,'the two inline controls, which were 16px of text');
 assert.match(rules,/summary\{min-height:24px\}/,'a disclosure row');
 assert.match(rules,/input\{min-width:24px;min-height:24px\}/,'and the checkboxes, which were 13px');
 assert.match(rules,/input\[type=range\]\{min-height:24px\}/,'and the trade slider, which was a 16px track');
 assert.match(css,new RegExp(`${touch.replace(/[()]/g,'\\$&')}\\{\\.adjusted\\{[^}]*min-height:24px;min-width:24px`),'the correction mark, which was 7 by 11 pixels');
 assert.match(css,new RegExp(`${touch.replace(/[()]/g,'\\$&')}\\{\\.status-footer \\.site-link a\\{[^}]*min-height:34px`),'and the footer links, the credit among them');
 const {render}=await import('../dist/ui/render.js');
 start();S.view='watch';render();
 assert.match(app.innerHTML,/<span class="site-link"><a href="https:\/\/docs.sleeper.com\/"[^>]*>Sleeper data &amp; trends<\/a><\/span>/,'the credit is a link in that row, so it takes that height');
})

// A host that switched game status off has no kickoff, quarter, clock or score, and still has who
// plays whom from Sleeper. Every page that read ESPN has to say which of those it lost, and none of
// them may keep the credit or the claim.
test('with game status switched off the pages name the opponent and claim no clock',async()=>{
 const {DEFAULT_SITE,siteConfig}=await import('../dist/site.js');
 const {gameStatusEnabled}=await import('../dist/ui/core.js');
 // Game status off is what the provider leaves behind: no games at all, and the pairings Sleeper
 // named in the projections, which carry an opponent and nothing else.
 const data=demo();
 data.games={};
 // A team Sleeper named no opponent for is simply absent, which is how a derived schedule says bye.
 data.schedules=Object.fromEntries(Object.entries(data.schedules).map(([w,teams])=>[w,Object.fromEntries(Object.entries(teams).filter(([team])=>team!=='KC').map(([team,g])=>[team,{opponent:g.opponent,source:'sleeper'}]))]));
 start(data);
 try{
  S.site=siteConfig({sources:{espnScoreboard:false}});
  assert.equal(gameStatusEnabled(),false);
  const watch=(await draw('watch')).before;
  assert.ok(!watch.includes('NFL game status: ESPN'),'the footer stops crediting a source it is not reading');
  assert.ok(!/ESPN/.test(watch),'and no page says ESPN at all');
  assert.match(watch,/class="game-status ">SCHEDULED</,'a player with an opponent has a game, just no clock');
  assert.doesNotMatch(watch,/NO GAME/,'nobody is told his game is off because the switch is');
  assert.doesNotMatch(watch,/Schedule unavailable/);
  assert.match(watch,/Kickoff time comes from NFL game status, which is off for this site/);
  assert.match((await draw('settings')).before,/NFL game status is switched off for this site, so no kickoff time, quarter or clock is shown\. Who plays whom, and who is on bye, still comes from Sleeper\./);
  assert.match((await draw('scoreboard')).after,/NFL game status is switched off for this site, so which starters have finished is a guess/);
  const defenses=(await draw('defenses')).after;
  assert.match(defenses,/<div class="defense-opponent">[A-Z]{2,3}<\/div>/,'the planner names the opponent without guessing which side is at home');
  assert.doesNotMatch(defenses,/defense-opponent">(vs|@) /);
  assert.match(defenses,/<div class="defense-opponent">No game<\/div>/,'and a bye is still a bye');
 }finally{S.site=DEFAULT_SITE}
 // Switched back on, the same data draws the page it drew before, so the switch is the only thing
 // the pages read it through.
 start();
 assert.match((await draw('watch')).before,/NFL game status: ESPN/);
})

test('a correction says so on the number it moved, and the manage view can take it back',async()=>{
 const {lens,removeOverride,setOverride}=await import('../dist/ui/overrides.js');
 const {fmt,sleeperValue,value}=await import('../dist/ui/core.js');
 const {comparison,overrideBlockHTML,overrideFormHTML,overrideListHTML,overridesPanelHTML,pickerMatches}=await import('../dist/ui/override-editor.js');
 start();
 const l=S.data.leagues.find(x=>x.enabled);S.leagueId=l.league_id;
 const id=l.mine.starters.find(i=>Number(sleeperValue(i,l))>0),sleeper=sleeperValue(id,l);
 try{
  await setOverride({player:id,points:{multiplier:.5},note:'his snap count fell off a cliff',source:'owner'});
  assert.equal(value(id,l),Math.round(sleeper*50)/100,'the one adapter moved the number the page reads');
  assert.equal(sleeperValue(id,l),sleeper,'and Sleeper’s own number is still there to show');
  assert.equal(comparison(id,l).changed,true);
  assert.match(comparison(id,l).text,/^Sleeper /);
  // Every page says a correction is in these numbers, and the start and sit page marks the number
  // itself, since that is where the owner reads one player against another.
  const page=(await draw('lineup')).after;
  assert.match(page,/correction of your own is in these numbers/);
  assert.match(page,/data-override-manage/);
  assert.match(page,/class="adjusted"/);
  // The mark is a control, not a decoration: it opens the corrections it is talking about, it says
  // what it is for a reader who cannot hover, and Sleeper's own number is printed next to it rather
  // than hidden in a tooltip, because a phone never shows one.
  assert.match(page,new RegExp(`<button type="button" class="adjusted" data-override-open="${id}"`));
  assert.match(page,new RegExp(`aria-label="Your correction: ×0.5 · his snap count fell off a cliff. Sleeper projected ${fmt(sleeper)}. Open corrections."`),'the label is the whole sentence a tooltip would have shown');
  assert.match(page,new RegExp(`<span class="adjusted-was">was ${fmt(sleeper)}</span>`));
  // The profile offers the edit, the form opens on the record that is already there, and the list
  // shows it with what it moved.
  assert.match(overrideBlockHTML(id,l),/Your correction: projection ×0.5/);
  assert.match(overrideBlockHTML(id,l),new RegExp(`data-override-open="${id}"`));
  assert.match(overrideFormHTML(id),/EDIT YOUR CORRECTION/);
  assert.match(overrideFormHTML(id),/value="0.5"/);
  assert.match(overrideListHTML(),/1 correction on file/);
  assert.match(overrideListHTML(),/his snap count fell off a cliff/);
  assert.match(overridesPanelHTML(),/1 on file · 1 in force/);
  // The picker offers the owner's own players with nothing typed, and caps a search of the whole
  // directory rather than drawing a list nobody can read.
  const roster=pickerMatches('');
  assert.equal(roster.scope,'roster');assert.ok(roster.ids.length<=12);
  assert.ok(pickerMatches('',500).ids.includes(id),'every player the owner holds is reachable');
  const found=pickerMatches('a');
  assert.equal(found.scope,'search');assert.ok(found.ids.length<=12);assert.ok(found.total>=found.ids.length);
  assert.deepEqual(pickerMatches('zzzzqqq').ids,[]);
  // Removing it puts every number back, and the page stops claiming anything was adjusted.
  await removeOverride(id);
  assert.equal(value(id,l),sleeper);assert.equal(lens().list.length,0);
  const plain=(await draw('lineup')).after;
  assert.doesNotMatch(plain,/correction of your own/);
  assert.doesNotMatch(plain,/class="adjusted"/);
 }finally{await removeOverride(id)}
})

// An agent's correction is somebody else's reasoning sitting on the owner's numbers, so the page has
// to say whose it is, say why they wrote it, and never let the owner's editor put their own name on
// it. The two sections and the two clear controls are the whole point: one hand's work cannot be
// thrown out by a control meant for the other's.
test('an agent’s correction is shown apart from the owner’s, with its reason and its own controls',async()=>{
 const {agentRecords,clearAgentOverrides,clearOverrides,isOwn,lens,ownRecords,writeOverrides}=await import('../dist/ui/overrides.js');
 const {overrideBlockHTML,overrideFormHTML,overrideListHTML,overridesPanelHTML}=await import('../dist/ui/override-editor.js');
 start();
 const l=S.data.leagues.find(x=>x.enabled);S.leagueId=l.league_id;
 const [mine,theirs]=l.mine.starters;
 try{
  await writeOverrides([
   {player:mine,points:{multiplier:.5},note:'he is on a snap count',source:'owner',at:1},
   {player:theirs,points:{delta:-4},note:'beat writer says he is limited',reason:'beat writer says he is limited',source:'agent:scout',until:S.data.week,at:2}
  ]);
  assert.deepEqual([ownRecords().length,agentRecords().length,isOwn({source:'agent:scout'})],[1,1,false]);
  const list=overrideListHTML();
  assert.match(list,/2 corrections on file/);
  assert.match(list,/>YOURS</,'the owner’s own work is its own section');
  assert.match(list,/>WRITTEN BY AN AGENT</);
  assert.match(list,/agent:scout/);
  assert.match(list,/Reason given: beat writer says he is limited/);
  assert.match(list,new RegExp(`data-agent-remove="${theirs}"`));
  assert.match(list,new RegExp(`data-override-open="${mine}"`));
  // The agent's section offers one action, Remove. Editing it in place would file the agent's
  // reasoning under the owner's name, so the only way to disagree with it is to take it back or write
  // your own, which the picker below still offers on that same player.
  const agentSection=list.slice(list.indexOf('WRITTEN BY AN AGENT'),list.indexOf('override-picker'));
  assert.match(agentSection,new RegExp(`data-agent-remove="${theirs}"`));
  assert.doesNotMatch(agentSection,/data-override-open=/,'the owner’s editor never opens on an agent’s record');
  assert.match(list,/id="override-clear-agents"/,'one control removes every agent correction at once');
  assert.match(list,/id="override-clear"/);
  // The profile names whose correction moved the number, and the form offers to write the owner's own
  // rather than editing the agent's under the owner's name.
  assert.match(overrideBlockHTML(theirs,l),/Correction by agent:scout/);
  assert.match(overrideBlockHTML(theirs,l),/Reason given: beat writer/);
  assert.match(overrideFormHTML(theirs),/ADD A CORRECTION/);
  assert.match(overrideFormHTML(theirs),/scout has a correction on this player/);
  assert.doesNotMatch(overrideFormHTML(theirs),/value="-4"/,'and never prefills from it');
  assert.match(overrideFormHTML(mine),/EDIT YOUR CORRECTION/);
  assert.match(overridesPanelHTML(),/2 on file · 2 in force in week 2 · 1 written by an agent/);
  // Clearing the owner's corrections leaves the agent's standing, which is the whole reason there are
  // two controls.
  await clearOverrides();
  assert.deepEqual(lens().list.map(r=>r.source),['agent:scout']);
  await clearAgentOverrides();
  assert.deepEqual(lens().list,[]);
 }finally{await writeOverrides([])}
})
