import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {proto} from '@whiskeysockets/baileys';
import {acceptsFreightSource,channelMessageId,subscribedChannels,decodeChannelMessages,createChannelReader} from './channel-reader.mjs';

const own='120363428757778414@newsletter',source='120363400017474686@newsletter';
const response=(timestamp,id='7')=>({tag:'iq',attrs:{},content:[{tag:'message_updates',attrs:{},content:[{tag:'message',attrs:{server_id:id,t:String(timestamp)},content:[{tag:'plaintext',attrs:{},content:proto.Message.encode({conversation:'مطلوب صندوق من معبر نصيب إلى دبي 5 طن +963941103399'}).finish()}]}]}]});
const quiet={info(){},warn(){}};
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
  const sock={subscribeNewsletterUpdates:async jid=>{assert.equal(jid,source);return {duration:'600'};},newsletterFetchMessages:async(jid,count,since)=>{calls.push({jid,count,since});return response(Math.floor(clock/1000),'7');}};
  const options={sock,isActive:()=>active,ownChannels:()=>[own],onMessages:async batch=>{batches.push(batch);return !fail;},statePath:join(directory,'state.json'),now:()=>clock,listChannels:async()=>[{id:own},{id:source,name:'شريف للنقل'}],log:quiet};
  const reader=createChannelReader(options);
  await reader.tick();
  assert.equal(reader.state.status,'active');assert.equal(reader.state.followed,2);assert.equal(reader.state.monitored,1);
  assert.equal(calls[0].since,clock/1000);assert.equal(batches.length,1);
  const before=JSON.parse(await readFile(options.statePath,'utf8'))[source].since;
  clock+=120000;fail=true;await reader.tick();
  assert.equal(reader.state.status,'degraded');assert.equal(JSON.parse(await readFile(options.statePath,'utf8'))[source].since,before);
  clock+=120000;fail=false;await reader.tick();
  assert.equal(reader.state.status,'active');
  reader.stop();const count=calls.length;await reader.tick();assert.equal(calls.length,count);
  clock+=120000;const restarted=createChannelReader(options);await restarted.tick();
  assert.equal(calls.at(-1).since,Math.floor((clock-120000)/1000)-60);
  active=false;clock+=120000;const paused=calls.length;await restarted.tick();assert.equal(calls.length,paused);restarted.stop();
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('discovery errors stay visible without breaking group reception or rapid retries',async()=>{
 let attempts=0;
 const reader=createChannelReader({sock:{},isActive:()=>true,ownChannels:()=>[own],onMessages:async()=>{},now:()=>2000000000000,listChannels:async()=>{attempts++;throw new Error('rate-overlimit');},log:quiet});
 await reader.tick();await reader.tick();
 assert.equal(attempts,1);assert.equal(reader.state.status,'degraded');assert.equal(reader.state.lastError,'rate-overlimit');reader.stop();
});
