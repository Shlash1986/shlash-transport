import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createChannelGroupRelay,formatGroupRelay,isRelayText,RELAY_CHANNEL,RELAY_LINKS,RELAY_GROUP} from './channel-group-relay.mjs';
import {createChannelReader} from './channel-reader.mjs';
import {proto} from '@whiskeysockets/baileys';

const BASE=2000000000000;
const BODY='مطلوب براد من حلب إلى دمشق\n+963955111222';
const group='120363431703780865@g.us',user='123:4@s.whatsapp.net';
const quiet={info(){},warn(){}};
const stubReader=()=>({state:{status:'test'},start(){},stop(){}});
const message=(id,text=BODY,stamp=BASE)=>({key:{remoteJid:RELAY_CHANNEL,id},message:{conversation:text},messageTimestamp:stamp/1000});
async function setup({path=null,clock=()=>BASE,member=true,admin=false,announce=false,send}={}){
 const sent=[];
 const sock={user:{id:user},groupGetInviteInfo:async()=>{throw new Error('growth-locked');},groupMetadata:async jid=>{assert.equal(jid,RELAY_GROUP);return {id:group,subject:'شاحنات الشرق',announce,participants:member?[{id:'123@s.whatsapp.net',admin:admin?'admin':null}]:[]};},sendMessage:async(jid,payload)=>{sent.push({jid,payload});return send?send():{key:{id:'group-'+sent.length}};}};
 const relay=await createChannelGroupRelay({path,now:clock,log:quiet,readerFactory:stubReader,enabled:true});
 relay.connect(sock,()=>true);await relay.drain();
 return {relay,sock,sent,stop:()=>relay.disconnect(sock)};
}
test('links added once while preserving route and original contact',()=>{
 const output=formatGroupRelay(BODY+'\n'+RELAY_LINKS.site);
 for(const link of Object.values(RELAY_LINKS))assert.equal(output.split(link).length-1,1);
 assert(output.startsWith(BODY));assert(isRelayText(output));assert.equal(formatGroupRelay(output),output);
 assert(!isRelayText(BODY+'\n'+RELAY_LINKS.site));
});
test('group forwarding defaults off: no new messages or persisted pending jobs are sent',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'easttrucks-relay-disabled-'));
 const path=join(dir,'relay.json');
 try{
  const previous=await setup({path,member:false});
  await previous.relay.accept(message('pending'));await previous.relay.drain();previous.stop();
  const before=await readFile(path,'utf8');
  assert.equal(previous.relay.snapshot().pending,1);
  const relay=await createChannelGroupRelay({path,now:()=>BASE+120000,readerFactory:()=>{throw new Error('Disabled relay must not start a reader');}});
  const sock={groupMetadata:async()=>{throw new Error('Disabled relay must not inspect groups');},sendMessage:async()=>{throw new Error('Disabled relay must not send');}};
  relay.connect(sock,()=>true);
  assert.equal(await relay.accept(message('new')),false);
  assert.equal(await relay.observeSent(RELAY_CHANNEL,{key:{id:'channel-published'}},BODY),false);
  await relay.drain();relay.disconnect(sock);
  assert.equal(relay.snapshot().enabled,false);assert.equal(relay.snapshot().status,'disabled');
  assert.equal(await readFile(path,'utf8'),before);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('only new posts from the specified channel, once across realtime, send acknowledgment and polling IDs',async()=>{
 const t=await setup();
 try{
  await t.relay.accept(message('old',BODY,BASE-1000));
  await t.relay.accept({...message('other'),key:{remoteJid:'999@newsletter',id:'other'}});
  await t.relay.accept({...message('group'),key:{remoteJid:group,id:'group'}});
  assert.equal(t.sent.length,0);
  await Promise.all([t.relay.accept(message('live')),t.relay.accept(message('server-123')),t.relay.observeSent(RELAY_CHANNEL,{key:{id:'live'}},BODY)]);
  await t.relay.drain();assert.equal(t.sent.length,1);assert.equal(t.sent[0].jid,group);assert(isRelayText(t.sent[0].payload.text));
  await t.relay.accept(message('manual','تنبيه: الطريق مفتوح اليوم'));await t.relay.drain();assert.equal(t.sent.length,2);
  await t.relay.accept({...message('edit'),message:{protocolMessage:{editedMessage:{conversation:BODY+' تعديل'}}}});await t.relay.drain();assert.equal(t.sent.length,2);
 }finally{t.stop();}
});
test('no group messages without membership or required administrator permission; queued for later',async()=>{
 for(const options of [{member:false},{announce:true,admin:false}]){
  const t=await setup(options);
  try{await t.relay.accept(message('one'));await t.relay.drain();assert.equal(t.sent.length,0);assert.equal(t.relay.snapshot().pending,1);assert.equal(t.relay.snapshot().status,'blocked');}finally{t.stop();}
 }
 const t=await setup({announce:true,admin:true});
 try{await t.relay.accept(message('one'));await t.relay.drain();assert.equal(t.sent.length,1);}finally{t.stop();}
});
test('successful and uncertain sends survive restart without duplicates; pending jobs resume',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'easttrucks-relay-'));
 try{
  for(const mode of ['sent','uncertain','pending']){
   const path=join(dir,mode+'.json');
   const first=await setup({path,member:mode!=='pending',send:mode==='uncertain'?async()=>{throw new Error('ack lost');}:undefined});
   await first.relay.accept(message('original'));await first.relay.drain();first.stop();
   const second=await setup({path,clock:()=>BASE+120000});
   try{
    await second.relay.accept(message('polled-server-id'));await second.relay.drain();
    assert.equal(second.sent.length,mode==='pending'?1:0,mode);
    assert.equal(second.relay.snapshot().uncertain,mode==='uncertain'?1:0);
    const saved=await readFile(path,'utf8');assert(!saved.includes('mediaKey'));assert(!saved.includes('credentials'));
   }finally{second.stop();}
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('own-channel polling recovers a new manual post after restart and retains checkpoint on failure',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'easttrucks-own-reader-'));
 const received=[];let fail=true;
 const response={tag:'iq',attrs:{},content:[{tag:'messages',attrs:{},content:[{tag:'message',attrs:{server_id:'33',t:String((BASE+1000)/1000)},content:[{tag:'plaintext',attrs:{},content:proto.Message.encode({conversation:'منشور يدوي جديد'}).finish()}]}]}]};
 const reader=createChannelReader({sock:{subscribeNewsletterUpdates:async()=>({duration:300}),query:async()=>response},isActive:()=>true,ownChannels:()=>[],listChannels:async()=>[{id:RELAY_CHANNEL}],onMessages:async batch=>{if(fail)return false;received.push(...batch.messages);return true;},statePath:join(dir,'reader.json'),initialSince:BASE/1000,now:()=>BASE+120000,log:quiet});
 try{await reader.tick();assert.equal(received.length,0);assert.equal(reader.state.status,'degraded');const saved=JSON.parse(await readFile(join(dir,'reader.json'),'utf8'));assert.equal(saved[RELAY_CHANNEL].since,BASE/1000);}finally{reader.stop();}
 let clock=BASE+180000;
 const retry=createChannelReader({sock:{subscribeNewsletterUpdates:async()=>({duration:300}),query:async()=>response},isActive:()=>true,ownChannels:()=>[],listChannels:async()=>[{id:RELAY_CHANNEL}],onMessages:async batch=>{received.push(...batch.messages);return true;},statePath:join(dir,'reader.json'),initialSince:BASE/1000,now:()=>clock,log:quiet});
 try{await retry.tick();assert.equal(received.length,0,'restart must retain the failed poll retry deadline');clock=BASE+240000;await retry.tick();assert.equal(received.length,1);assert.equal(received[0].message.conversation,'منشور يدوي جديد');}finally{retry.stop();await rm(dir,{recursive:true,force:true});}
});
