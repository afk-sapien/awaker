export const defaults={username:'',disabled:[],preferences:{},timezone:'America/Los_Angeles',daily:{enabled:false,time:'08:00'},weekly:{enabled:false,time:'08:00',day:2},alerts:{trades:false,waivers:false,minGain:3,waiverMinGain:3,improvement:2,cooldownHours:6,dailyCap:3,scanHours:6,quietStart:'22:00',quietEnd:'08:00'}};
export const scanIntervals=[1,3,6,12,24];
export function bad(message,status=400){return Object.assign(new Error(message),{status})}
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const time=v=>typeof v==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const strings=v=>Array.isArray(v)&&v.length<=300&&v.every(x=>typeof x==='string'&&x.length<=100);
export function preferences(input){
 if(!object(input))throw bad('Preferences must be an object.');
 const out={};
 for(const k of ['protectStarters','samePositionDrops','waiverUpgradesOnly','requireBenefit'])if(k in input){if(typeof input[k]!=='boolean')throw bad(`Invalid ${k}`);out[k]=input[k]}
 for(const [k,min,max]of [['tradeMinGain',0,10],['tradeMaxGap',0,1],['tradePenalty',0,1],['tradeOwnBias',0,1],['tradeEndWeek',17,18]])if(k in input){if(!Number.isFinite(input[k])||input[k]<min||input[k]>max||(k==='tradeEndWeek'&&!Number.isInteger(input[k])))throw bad(`Invalid ${k}`);out[k]=input[k]}
 for(const [key,sides]of [['tradeExcluded',['give','get']],['waiverExcluded',['add','drop']]])if(key in input){if(!object(input[key])||sides.some(s=>!strings(input[key][s])))throw bad(`Invalid ${key}`);out[key]=Object.fromEntries(sides.map(s=>[s,input[key][s]]))}
 if(out.tradeMinGain!==undefined&&![0,.5,1,2,3,5,10].includes(out.tradeMinGain))throw bad('Unsupported minimum gain.');
 if(out.tradeMaxGap!==undefined&&![.15,.25,.4,1].includes(out.tradeMaxGap))throw bad('Unsupported value gap.');
 if(input.waiverProtected){if(!object(input.waiverProtected)||Object.keys(input.waiverProtected).length>100||Object.values(input.waiverProtected).some(v=>!strings(v)))throw bad('Invalid protected players');out.waiverProtected=input.waiverProtected}
 return out;
}
export function validateSettings(input,previous=defaults){
 if(!object(input))throw bad('Settings must be an object.');
 const keys=Object.keys(defaults);if(Object.keys(input).some(k=>!keys.includes(k)))throw bad('Unknown settings field.');
 const s=structuredClone(previous);s.alerts={...defaults.alerts,...s.alerts};
 for(const key of ['username','disabled','timezone'])if(key in input)s[key]=input[key];
 if(typeof s.username!=='string'||!/^[-\w.]{0,60}$/.test(s.username))throw bad('Invalid Sleeper username.');
 if(!strings(s.disabled))throw bad('Invalid league exclusions.');
 if(typeof s.timezone!=='string'||s.timezone.length>100)throw bad('Invalid timezone.')
 try{new Intl.DateTimeFormat('en',{timeZone:s.timezone}).format()}catch{throw bad('Invalid timezone.')}
 if('preferences'in input)s.preferences=preferences(input.preferences);
 for(const key of ['daily','weekly'])if(key in input){if(!object(input[key])||Object.keys(input[key]).some(k=>!['enabled','time',...(key==='weekly'?['day']:[])].includes(k)))throw bad('Invalid schedule.');s[key]={...s[key],...input[key]}}
 for(const key of ['daily','weekly'])if(typeof s[key].enabled!=='boolean'||!time(s[key].time))throw bad('Invalid schedule time.');
 if(!Number.isInteger(s.weekly.day)||s.weekly.day<0||s.weekly.day>6)throw bad('Invalid weekday.');
 if ('alerts' in input) {
  if (!object(input.alerts) || Object.keys(input.alerts).some(k => !Object.hasOwn(defaults.alerts, k))) throw bad('Unknown alert setting.')
  s.alerts = {...s.alerts, ...input.alerts}
 }
 const a=s.alerts;
 if(typeof a.trades!=='boolean'||typeof a.waivers!=='boolean'||!time(a.quietStart)||!time(a.quietEnd))throw bad('Invalid alert settings.');
 for(const [key,min,max]of [['minGain',1,100],['waiverMinGain',.5,100],['improvement',.1,100],['cooldownHours',1,168],['dailyCap',1,20]])if(!Number.isFinite(a[key])||a[key]<min||a[key]>max)throw bad(`Invalid ${key}`);
 if(!Number.isInteger(a.dailyCap))throw bad('Daily cap must be a whole number.');
 if(!scanIntervals.includes(a.scanHours))throw bad('Unsupported scan interval.');
 return s;
}
