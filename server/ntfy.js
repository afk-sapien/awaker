import {bad} from './settings.js';
export const defaultServer='https://ntfy.sh';
// A topic is required, the server defaults to ntfy.sh, and a token is only needed for
// access-controlled topics. On a public server the topic name is the only secret.
export function validateNtfy({url,topic,token}={}){
 let parsed;try{parsed=new URL(typeof url==='string'&&url.trim()?url.trim():defaultServer)}catch{throw bad('Invalid ntfy URL.')}
 if(url!==undefined&&url!==null&&typeof url!=='string'||parsed.username||parsed.password||parsed.search||parsed.hash||!['http:','https:'].includes(parsed.protocol))throw bad('Invalid ntfy URL.');
 if(parsed.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname))throw bad('ntfy requires HTTPS except on loopback.');
 if(typeof topic!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(topic))throw bad('Invalid ntfy topic.');
 if(token!==undefined&&token!==null&&token!==''&&(typeof token!=='string'||!/^[\x21-\x7e]{1,300}$/.test(token)))throw bad('Invalid ntfy token.');
 return {url:parsed.href.replace(/\/$/,''),topic,token:token||''};
}
async function send(config,item,fetcher){
 let result;
 try{result=await fetcher(new URL(config.url),{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{...(config.token?{Authorization:`Bearer ${config.token}`}:{}),'Content-Type':'application/json'},body:JSON.stringify({topic:config.topic,title:item.title,message:item.message.slice(0,3000),priority:item.type==='alert'?4:3,click:item.url})})}
 catch{throw Error('Could not reach the ntfy server.')}
 if(!result.ok)throw Error(`ntfy rejected delivery (${result.status}).${[401,403].includes(result.status)?' This topic needs a valid access token.':''}`);
 return {accepted:true};
}
// Settings saved in the browser win over NTFY_URL, NTFY_TOPIC and NTFY_TOKEN, and every
// delivery reads the current ones, so a change applies without a restart. The token is
// write-only: describe() is the only view of this state that leaves the server.
export function createNtfy({store,env=process.env,fetcher=fetch}){
 const fallback=env.NTFY_TOPIC?validateNtfy({url:env.NTFY_URL,topic:env.NTFY_TOPIC,token:env.NTFY_TOKEN}):null;
 const current=()=>store.get('ntfy')||fallback;
 const describe=()=>{const c=current();return {configured:!!c,source:store.get('ntfy')?'saved':fallback?'environment':'none',url:c?.url||defaultServer,topic:c?.topic||'',tokenSet:!!c?.token,subscribeUrl:c?`${c.url}/${c.topic}`:null}};
 return {
  configured:()=>!!current(),describe,
  // An omitted token keeps the current one, unless the server changes: a saved token is never forwarded to another host.
  save(input){
   if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['url','topic','token'].includes(k)))throw bad('Unknown notification setting.');
   const previous=current(),next=validateNtfy(input);
   if(!Object.hasOwn(input,'token')&&previous?.url===next.url)next.token=previous.token;
   store.set('ntfy',next);return describe();
  },
  reset(){store.set('ntfy',null);return describe()},
  async publish(item){const c=current();if(!c)throw Error('ntfy is not configured.');return send(c,item,fetcher)}
 };
}
