import {bad} from './settings.js';
const id={type:'string',minLength:1,maxLength:100},league={leagueId:id},limit={type:'integer',minimum:1,maximum:50};
const schema=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
export const contracts=[
 {name:'get_status',path:'/status',method:'GET',description:'Read enabled leagues, matchups, tracked player and game status, and source freshness.',inputSchema:schema(league),call:'status'},
 {name:'find_trades',path:'/trades/search',method:'POST',description:'Find legal one-for-one remaining-season trade ideas using owner preferences. Does not submit trades.',inputSchema:schema({...league,limit,positions:{type:'array',items:id,minItems:1,maxItems:20,uniqueItems:true}}),call:'trades'},
 {name:'evaluate_trade',path:'/trades/evaluate',method:'POST',description:'Evaluate a player package and both managers’ weekly gains. Does not submit a trade.',inputSchema:schema({...league,partnerId:{type:'integer',minimum:1,maximum:1000},give:{type:'array',items:id,minItems:1,maxItems:15,uniqueItems:true},get:{type:'array',items:id,minItems:1,maxItems:15,uniqueItems:true}},['leagueId','partnerId','give','get']),call:'evaluate'},
 {name:'get_opportunities',path:'/opportunities',method:'GET',description:'Read legal lineup and waiver suggestions with protected players and league scoring.',inputSchema:schema(league),call:'opportunities'},
 {name:'preview_digest',path:'/digests/preview',method:'POST',description:'Preview a daily or weekly digest. This never sends a notification.',inputSchema:schema({period:{type:'string',enum:['daily','weekly']}}),call:'digest'}
];
export function validate(value,s,path='input'){
 const type=s.type,valid=type==='object'?value&&typeof value==='object'&&!Array.isArray(value):type==='array'?Array.isArray(value):type==='integer'?Number.isInteger(value):typeof value===type;
 if(!valid)throw bad(`${path} must be ${type}.`);
 if(s.enum&&!s.enum.includes(value))throw bad(`Invalid ${path}.`);
 if(type==='object'){
  if(Object.keys(value).some(k=>!(k in s.properties)))throw bad(`Unknown ${path} field.`);
  for(const key of s.required||[])if(!(key in value))throw bad(`Missing ${key}.`);
  for(const [key,v]of Object.entries(value))validate(v,s.properties[key],`${path}.${key}`);
 }
 if(type==='array'){
  if(value.length<(s.minItems||0)||value.length>(s.maxItems||100)||s.uniqueItems&&new Set(value).size!==value.length)throw bad(`Invalid ${path} length or duplicates.`);
  value.forEach(v=>validate(v,s.items,path));
 }
 if(type==='integer'&&(value<s.minimum||value>s.maximum))throw bad(`${path} out of range.`);
 if(type==='string'&&(value.length<(s.minLength||0)||value.length>(s.maxLength||1000)))throw bad(`${path} length out of range.`);
 return value;
}
