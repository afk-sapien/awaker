export function ntfyPublisher(env=process.env,fetcher=fetch){
 if(!env.NTFY_URL&&!env.NTFY_TOPIC&&!env.NTFY_TOKEN)return null;
 if(!env.NTFY_URL||!env.NTFY_TOPIC||!env.NTFY_TOKEN)throw Error('Set NTFY_URL, NTFY_TOPIC, and NTFY_TOKEN together.');
 const url=new URL(env.NTFY_URL);
 if(url.username||url.password||url.search||url.hash||!['http:','https:'].includes(url.protocol))throw Error('Invalid ntfy URL.');
 if(url.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('ntfy requires HTTPS except on loopback.');
 if(!/^[A-Za-z0-9_-]{1,100}$/.test(env.NTFY_TOPIC))throw Error('Invalid ntfy topic.');
 return async item=>{
  const result=await fetcher(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${env.NTFY_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({topic:env.NTFY_TOPIC,title:item.title,message:item.message.slice(0,3000),priority:item.type==='trade'?4:3,click:item.url})});
  if(!result.ok)throw Error(`ntfy rejected delivery (${result.status}).`);
  return {accepted:true};
 };
}
