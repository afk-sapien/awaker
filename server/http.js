import {createServer} from 'node:http';
import {timingSafeEqual,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {contracts,validate} from './contracts.js';
import {bad} from './settings.js';
const equal=(a,b)=>typeof a==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function createHttpServer({service,worker,publish,adminToken,agentToken,publicUrl,dist,now=Date.now}){
 if(!adminToken||adminToken.length<32||!agentToken||agentToken.length<32||equal(adminToken,agentToken))throw Error('Set distinct SUNDAY_ADMIN_TOKEN and SUNDAY_AGENT_TOKEN of at least 32 characters.');
 const origin=new URL(publicUrl).origin,sessions=new Map(),rates=new Map();let testAt=0;
 const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value))};
 async function body(req){let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>65536)throw bad('Request too large.',413)}try{return JSON.parse(raw||'{}')}catch{throw bad('Invalid JSON.')}}
 function role(req){const bearer=req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):'';if(equal(bearer,adminToken))return 'admin';if(equal(bearer,agentToken))return 'agent';const cookie=req.headers.cookie?.split('; ').find(c=>c.startsWith('sunday_session='))?.slice(15),session=sessions.get(cookie);if(session&&session>now())return 'admin';return null}
 const server=createServer(async(req,res)=>{
  try{
   if(req.headers.host!==new URL(publicUrl).host)throw bad('Unrecognized host.',403);
   if(req.headers.origin&&req.headers.origin!==origin)throw bad('Unrecognized origin.',403);
   const url=new URL(req.url,publicUrl),path=url.pathname;
   if(path.startsWith('/api/')){
    const ip=req.socket.remoteAddress,window=Math.floor(now()/60000),r=rates.get(ip)||{window,count:0};if(r.window!==window){r.window=window;r.count=0}if(++r.count>120)throw bad('Too many requests.',429);if(rates.size>1000)rates.clear();rates.set(ip,r);
    if(path==='/api/v1/session'&&req.method==='POST'){
     if(req.headers.origin!==origin)throw bad('Same-origin login required.',403);
     const b=await body(req);if(!equal(b.token,adminToken))throw bad('Invalid owner token.',401);
     for(const [key,until]of sessions)if(until<now())sessions.delete(key);if(sessions.size>=100)sessions.delete(sessions.keys().next().value);
     const token=randomBytes(32).toString('hex');sessions.set(token,now()+8*3600000);res.setHeader('Set-Cookie',`sunday_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${origin.startsWith('https:')?'; Secure':''}`);json(res,200,{connected:true});return;
    }
    const auth=role(req);if(!auth)throw bad('Authorization required.',401);
    if(!req.headers.authorization&&req.method!=='GET'&&req.headers.origin!==origin)throw bad('Same-origin request required.',403);
    const contract=contracts.find(c=>path===`/api/v1${c.path}`&&req.method===c.method);
    if(contract){const input=validate(req.method==='GET'?Object.fromEntries(url.searchParams):await body(req),contract.inputSchema);json(res,200,await service[contract.call](input));return}
    if(auth!=='admin')throw bad('Owner access required.',403);
    if(path==='/api/v1/session'&&req.method==='DELETE'){const token=req.headers.cookie?.split('; ').find(c=>c.startsWith('sunday_session='))?.slice(15);sessions.delete(token);res.setHeader('Set-Cookie','sunday_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');json(res,200,{connected:false});return}
    if(path==='/api/v1/settings'&&req.method==='GET'){json(res,200,{settings:service.settings(),worker:worker.status()});return}
    if(path==='/api/v1/settings'&&req.method==='PUT'){json(res,200,{settings:service.saveSettings(await body(req))});return}
    if(path==='/api/v1/client'&&req.method==='GET'){json(res,200,await service.client());return}
    if(path==='/api/v1/refresh'&&req.method==='POST'){json(res,200,await service.client(true));return}
    if(path==='/api/v1/notifications/test'&&req.method==='POST'){
     if(!publish)throw bad('Configure ntfy credentials on the server first.',409);
     if(now()-testAt<60000)throw bad('Wait one minute between test messages.',429);testAt=now();
     await publish({type:'test',title:'Sunday notification test',message:'Your Sunday notification connection is working.',url:`${publicUrl}/integrations.html`});json(res,200,{accepted:true,deviceDelivery:'unconfirmed'});return;
    }
    throw bad('Endpoint not found.',404);
   }
   if(!['GET','HEAD'].includes(req.method))throw bad('Method not allowed.',405);
   const filename=resolve(dist,'.'+decodeURIComponent(path==='/'?'/index.html':path));
   if(!filename.startsWith(resolve(dist)+'/'))throw bad('Not found.',404);
   const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
   if(!types[extname(filename)])throw bad('Not found.',404);
   let file;try{file=await readFile(filename)}catch{throw bad('Not found.',404)}
   res.writeHead(200,{'Content-Type':types[extname(filename)],'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY'});res.end(req.method==='HEAD'?undefined:file);
  }catch(e){json(res,e.status||500,{error:e.status?e.message:'Service request failed. Check provider availability or server configuration.'})}
 });
 server.requestTimeout=30000;server.headersTimeout=15000;return server;
}
