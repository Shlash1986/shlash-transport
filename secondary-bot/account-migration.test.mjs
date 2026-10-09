import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const filename=process.argv[2]||'index.js';
const source=fs.readFileSync(filename,'utf8').replace(/^import .*;$/gm,'').replace('await mkdir(dir,{recursive:true});','').replace('await Promise.all([learnPlacesFromPlatform(),verifyIngestConnection()]);','').replace("startBot().catch(e=>{status='error';console.error('pairing connection failed',e.message);});",'');
async function setup(registered=false){
 const sockets=[],timers=[];let httpHandler;
 const ctx=vm.createContext({console,createHash,Map,Set,URL,Date,AbortSignal,encodeURIComponent,setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:()=>{},process:{env:{WA_REPLACEMENT_PHONE:'436605565676',PAIRING_MIGRATION_TOKEN:'test-link',PAIRING_MIGRATION_EXPIRES:'4102444800000'}},useMultiFileAuthState:async dir=>({state:{dir,creds:{registered:dir.endsWith('436605565676')&&registered,me:{id:'436605565676:4@s.whatsapp.net'}}},saveCreds:()=>{}}),makeWASocket:config=>{
 const handlers={};const sock={user:{id:config.auth.dir.endsWith('436605565676')?'436605565676:4@s.whatsapp.net':'4368120528715:4@s.whatsapp.net'},handlers,ev:{on:(key,fn)=>handlers[key]=fn},end:()=>{sock.ended=true;handlers['connection.update']({connection:'close',lastDisconnect:{error:{output:{statusCode:500}}}});},requestPairingCode:async phone=>{assert.equal(phone,'436605565676');return 'ABCD1234';},newsletterMetadata:async()=>({id:'123@newsletter'}),groupFetchAllParticipating:async()=>({'120363431703780865@g.us':{id:'120363431703780865@g.us',subject:'TruckLink MENA'}})};sockets.push(sock);return sock;
 },DisconnectReason:{loggedOut:401},http:{createServer:handler=>{httpHandler=handler;return {listen:()=>{}};}},QRCode:{toString:async()=>'<svg></svg>'}});
 await vm.runInContext('(async()=>{'+source+';await startBot();globalThis.snapshot=()=>({status,replacementStatus,active:activeSocket?.user.id});})()',ctx);
 const request=async(path,method='GET')=>{const res={headers:{},setHeader:(k,v)=>res.headers[k]=v,writeHead:(status,headers)=>{res.status=status;Object.assign(res.headers,headers);},end:body=>res.body=body};await httpHandler({url:path,method},res);return res;};
 return {sockets,timers,ctx,request};
}
const t=await setup();assert.equal(t.sockets.length,2);const [old,next]=t.sockets;
assert(t.ctx.snapshot().active.startsWith('4368120528715'));
next.handlers['connection.update']({qr:'qr-test'});
assert.equal((await t.request('/pair-new')).status,403);
assert.equal((await t.request('/pair-new/qr?token=test-link')).status,200);
assert.equal((await t.request('/pair-new?token=test-link','POST')).status,303);
assert.equal(JSON.parse((await t.request('/pair-new/status?token=test-link')).body).code,'ABCD1234');
assert.equal((await t.request('/pair-new?token=test-link','POST')).status,429);
next.handlers['connection.update']({connection:'open'});await new Promise(resolve=>setImmediate(resolve));
assert(old.ended);assert.equal(t.ctx.snapshot().replacementStatus,'connected');assert(t.ctx.snapshot().active.startsWith('436605565676'));assert.equal(t.timers.length,0);
const wrong=await setup();wrong.sockets[1].user.id='436600000000:4@s.whatsapp.net';wrong.sockets[1].handlers['connection.update']({connection:'open'});assert.equal(wrong.ctx.snapshot().replacementStatus,'wrong_number');assert(!wrong.sockets[0].ended);assert(wrong.sockets[1].ended);
const restart=await setup(true);assert.equal(restart.sockets.length,1);restart.sockets[0].handlers['connection.update']({connection:'open'});assert.equal(restart.ctx.snapshot().replacementStatus,'connected');
console.log('PASS: old account retained until pairing, protected QR/code, intended-number check, switch without logout/delete, restart on new session only');
