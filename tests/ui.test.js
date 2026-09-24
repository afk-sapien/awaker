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
