import test from 'node:test';
import assert from 'node:assert/strict';
import {seasonReview,pointsAllowed,matchup,verdict,tone} from '../dist/season.js';

const P=(position,team)=>({position,fantasy_positions:[position],team});
const line=(pts,opponent,gp=1)=>({stats:{pts,gp},opponent});
const scoring={pts:1};

test('cells compare what was scored with what was projected, and a week off is not a zero',()=>{
 const players={rb:P('RB','BUF'),wr:P('WR','KC')};
 const league={scoring_settings:scoring,mine:{players:['rb','wr'],starters:['rb'],reserve:[]}};
 const weeks=[{week:1,stats:{rb:line(20,'NYJ'),wr:line(4,'DEN')},projections:{rb:line(12,'NYJ'),wr:line(10,'DEN')}},
  {week:2,stats:{wr:line(3,'LV')},projections:{rb:line(13,'MIA'),wr:line(9,'LV')}}];
 const {rows,weeks:listed}=seasonReview({league,players,weeks,currentWeek:3});
 assert.deepEqual(listed,[1,2]);
 const rb=rows.find(r=>r.id==='rb'),wr=rows.find(r=>r.id==='wr');
 assert.deepEqual(rb.cells.map(c=>c.diff),[8,null],'the missed week is left out');
 assert.deepEqual([rb.games,rb.total,rb.diff,rb.average,rb.starter],[1,20,8,8,true]);
 assert.deepEqual([wr.games,wr.diff,wr.average],[2,-12,-6]);assert.equal(wr.verdict.label,'Under-performing');
 assert.equal(rb.verdict.label,'Too early');assert.equal(rows[0].id,'rb','running backs list before receivers');
});
test('color steps and matchup thirds',()=>{
 assert.deepEqual([-6,-3,0,3,6,null].map(tone),['poor','weak','neutral','good','strong','none']);
 assert.equal(matchup({rank:2,of:32,average:9}).label,'Tough');assert.equal(matchup({rank:30,of:32,average:30}).label,'Easy');
 assert.equal(matchup({rank:16,of:32,average:18}).label,'Average');assert.equal(matchup({rank:1,of:4,average:9}),null,'too few teams to rank');
});
test('points allowed rank defenses by what each position scored against them, per game',()=>{
 const teams=['A','B','C','D','E','F','G','H'],players=Object.fromEntries(teams.map((t,i)=>[`rb${i}`,P('RB',t)]));
 const week=n=>({week:n,stats:Object.fromEntries(teams.map((t,i)=>[`rb${i}`,line(10+i*2,teams[(i+1)%8])]))});
 const table=pointsAllowed([week(1),week(2)],players,scoring);
 assert.deepEqual([table.B.RB.rank,table.B.RB.average,table.B.RB.of],[1,10,8]);assert.equal(table.A.RB.rank,8);
});
test('the read weighs form against the road ahead',()=>{
 const hard=[{matchup:{label:'Tough'}},{matchup:{label:'Tough'}},{matchup:{label:'Easy'}}],soft=[{matchup:{label:'Easy'}},{matchup:{label:'Easy'}}];
 assert.equal(verdict({games:3,average:-4,upcoming:hard}).label,'Shop or sit');
 assert.equal(verdict({games:3,average:-4,upcoming:soft}).label,'Under-performing');
 assert.equal(verdict({games:3,average:4,upcoming:hard}).label,'Sell high?');
 assert.equal(verdict({games:3,average:4,upcoming:soft}).label,'Rolling');
 assert.equal(verdict({games:3,average:.5,upcoming:[]}).label,'As expected');
});
