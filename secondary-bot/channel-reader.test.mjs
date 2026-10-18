import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {proto} from '@whiskeysockets/baileys';
import {acceptsFreightSource,channelMessageId,subscribedChannels,decodeChannelMessages,fetchChannelMessages,createChannelReader} from './channel-reader.mjs';

const own='120363428757778414@newsletter',source='120363400017474686@newsletter';
const response=(timestamp,id='7')=>({tag:'iq',attrs:{},content:[{tag:'messages',attrs:{},content:[{tag:'message',attrs:{server_id:id,t:String(timestamp)},content:[{tag:'plaintext',attrs:{},content:proto.Message.encode({conversation:'مطلوب صندوق من معبر نصيب إلى دبي 5 طن +963941103399'}).finish()}]}]}]});
const quiet={info(){},warn(){}};
test('overlapping readers cannot collide on checkpoint temporary files; stopped readers do not ingest',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'easttrucks-reader-handoff-'));
 const path=join(dir,'reader.json');let release,started;
 const arrived=new Promise(resolve=>{started=resolve;});
 const pending=new Promise(resolve=>{release=resolve;});
 let deliveries=0;
 const options={isActive:()=>true,ownChannels:()=>[own],onMessages:async()=>{deliveries++;return true;},now:()=>2000000000000,listChannels:async()=>[{id:source}],statePath:path,log:quiet};
 const first=createChannelReader({...options,sock:{subscribeNewsletterUpdates:async()=>({duration:600}),query:async()=>{started();return pending;}}});
 const second=createChannelReader({...options,sock:{subscribeNewsletterUpdates:async()=>({duration:600}),query:async()=>response(2000000000)}});
 try{
  const running=first.tick();await arrived;first.stop();
  await second.tick();release(response(2000000000));await running;
  assert.equal(deliveries,1);assert.equal(second.state.errors,0);
  const checkpoint=JSON.parse(await readFile(path,'utf8'));assert.equal(checkpoint[source].since,2000000000);
  const third=createChannelReader({...options,sock:{subscribeNewsletterUpdates:async()=>({duration:600}),query:async()=>response(2000000000)}});
  const fourth=createChannelReader({...options,sock:{subscribeNewsletterUpdates:async()=>({duration:600}),query:async()=>response(2000000000)}});
  await Promise.all([third.tick(),fourth.tick()]);assert.equal(third.state.errors+fourth.state.errors,0);third.stop();fourth.stop();
 }finally{first.stop();second.stop();await rm(dir,{recursive:true,force:true});}
});
test('channel source, short server ID, protobuf text and own-channel isolation',()=>{
 assert(acceptsFreightSource(source,new Set(),[own]));
 assert(!acceptsFreightSource(own,new Set(),[own]));
 assert(!acceptsFreightSource('123@s.whatsapp.net',new Set(),[own]));
 assert(!acceptsFreightSource('123@g.us',new Set(['123@g.us']),[own]));
 assert.deepEqual(subscribedChannels({newsletters:[{id:source,thread_metadata:{name:{text:'شريف للنقل'}}}]}),[{id:source,name:'شريف للنقل'}]);
 const decoded=decodeChannelMessages(response(1234),source);
 assert.equal(decoded.length,1);assert.equal(decoded[0].messageTimestamp,1234);
 assert(decoded[0].message.conversation.includes('نصيب'));
 assert.equal(channelMessageId(decoded[0]),'channel:7');
 assert.equal(channelMessageId({key:{id:'7'}}),'channel:7');
 assert.equal(channelMessageId({key:{id:'ABC',server_id:'7'}}),'channel:7');
 assert.deepEqual(decodeChannelMessages({tag:'message',attrs:{id:'1',t:'1234'},content:[{tag:'reaction',attrs:{}}]},source),[]);
});

test('followed channels are read, own channel excluded, cursor persists and failed ingestion retries',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'easttrucks-channel-test-'));
 try{
  let clock=2000000000000,active=true,fail=false;
  const calls=[],batches=[];
  const sock={subscribeNewsletterUpdates:async jid=>{assert.equal(jid,source);return {duration:'600'};},query:async(node,timeout)=>{calls.push(node);assert.equal(timeout,15000);assert.equal(node.attrs.to,'s.whatsapp.net');assert.deepEqual(node.content[0],{tag:'messages',attrs:{type:'jid',jid:source,count:'100'}});return response(Math.floor(clock/1000),'7');}};
  const options={sock,isActive:()=>active,ownChannels:()=>[own],onMessages:async batch=>{batches.push(batch);return !fail;},statePath:join(directory,'state.json'),now:()=>clock,listChannels:async()=>[{id:own},{id:source,name:'شريف للنقل'}],log:quiet};
  const reader=createChannelReader(options);
  await reader.tick();
  assert.equal(reader.state.status,'active');assert.equal(reader.state.followed,2);assert.equal(reader.state.monitored,1);
  assert.equal(calls.length,1);assert.equal(batches.length,1);
  const before=JSON.parse(await readFile(options.statePath,'utf8'))[source].since;
  clock+=120000;fail=true;await reader.tick();
  assert.equal(reader.state.status,'degraded');assert.equal(JSON.parse(await readFile(options.statePath,'utf8'))[source].since,before);
  clock+=120000;fail=false;await reader.tick();
  assert.equal(reader.state.status,'active');
  reader.stop();const count=calls.length;await reader.tick();assert.equal(calls.length,count);
  clock+=120000;
  const previousQuery=sock.query;
  sock.query=async(...args)=>{await previousQuery(...args);return response(Math.floor((clock-120000)/1000),'8');};
  const restarted=createChannelReader(options);await restarted.tick();
  assert.equal(batches.at(-1).messages[0].key.id,'8');
  clock+=120000;sock.query=async(...args)=>{await previousQuery(...args);return response(Math.floor((clock-600000)/1000),'9');};
  const batchCount=batches.length;await restarted.tick();assert.equal(batches.length,batchCount);
  active=false;clock+=120000;const paused=calls.length;await restarted.tick();assert.equal(calls.length,paused);restarted.stop();
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('missing or malformed channel fetch replies fail rather than advancing checkpoints',async()=>{
 for(const result of [undefined,{tag:'iq',attrs:{},content:[]}]){
  await assert.rejects(()=>fetchChannelMessages({query:async()=>result},source),/checkpoint retained/);
 }
 const empty={tag:'iq',attrs:{},content:[{tag:'messages',attrs:{},content:[]}]};
 assert.deepEqual(await fetchChannelMessages({query:async()=>empty},source),empty);
 await assert.rejects(()=>fetchChannelMessages({query:async()=>{throw new Error('Timed Out');}},source),/Timed Out/);
});

test('discovery errors stay visible without breaking group reception or rapid retries',async()=>{
 let attempts=0;
 const reader=createChannelReader({sock:{},isActive:()=>true,ownChannels:()=>[own],onMessages:async()=>{},now:()=>2000000000000,listChannels:async()=>{attempts++;throw new Error('rate-overlimit');},log:quiet});
 await reader.tick();await reader.tick();
 assert.equal(attempts,1);assert.equal(reader.state.status,'degraded');assert.equal(reader.state.lastError,'rate-overlimit');reader.stop();
});

test('polling continues and reports degraded status when optional live subscriptions time out',async()=>{
 let polls=0;const reader=createChannelReader({liveSubscriptions:true,sock:{subscribeNewsletterUpdates:async()=>{throw new Error('Timed Out');},query:async()=>{polls++;return response(2000000000);}},isActive:()=>true,ownChannels:()=>[own],onMessages:async()=>true,now:()=>2000000000000,listChannels:async()=>[{id:source}],log:quiet});
 await reader.tick();assert.equal(polls,1);assert.equal(reader.state.status,'degraded');assert.equal(reader.state.lastError,'Timed Out');reader.stop();
});
test('a skipped retry interval does not hide a failed channel and retries back off',async()=>{
 let clock=2000000000000,polls=0,fail=true;
 const reader=createChannelReader({sock:{subscribeNewsletterUpdates:async()=>({duration:600}),query:async()=>{polls++;if(fail)throw new Error('Timed Out');return response(Math.floor(clock/1000));}},isActive:()=>true,ownChannels:()=>[own],onMessages:async()=>true,now:()=>clock,listChannels:async()=>[{id:source}],log:quiet});
 await reader.tick();assert.equal(reader.state.status,'degraded');clock+=30000;await reader.tick();assert.equal(reader.state.status,'degraded');assert.equal(polls,1);
 clock+=90000;await reader.tick();assert.equal(polls,2);clock+=120000;await reader.tick();assert.equal(polls,2);clock+=120000;fail=false;await reader.tick();assert.equal(polls,3);assert.equal(reader.state.status,'active');reader.stop();
});
