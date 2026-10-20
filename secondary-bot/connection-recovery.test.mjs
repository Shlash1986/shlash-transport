import test from 'node:test';
import assert from 'node:assert/strict';
import {makeEventBuffer} from '@whiskeysockets/baileys';
import {createBufferRecovery,definitelyUnsent} from './connection-recovery.mjs';
import {createDeliveryStore} from './delivery-store.mjs';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {acceptsFreightSource,isChannelJid,channelMessageId} from './channel-reader.mjs';
const quiet={warn(){},debug(){},trace(){}};
test('actual Baileys event buffer releases a stuck offline batch once after grace',()=>{
 let time=1000,active=true;const ev=makeEventBuffer(quiet),seen=[];
 ev.on('messages.upsert',v=>seen.push(...v.messages));ev.buffer();
 const recovery=createBufferRecovery({sock:{ev},isActive:()=>active,now:()=>time,log:quiet});
 recovery.tick();ev.emit('messages.upsert',{type:'append',messages:[{key:{id:'a',remoteJid:'123@g.us'},messageTimestamp:1,message:{conversation:'freight'}}]});
 time+=59999;recovery.tick();assert.equal(seen.length,0);
 time++;recovery.tick();assert.equal(seen.length,1);assert.equal(recovery.state.recoveries,1);
 time+=90000;recovery.tick();assert.equal(seen.length,1);
 ev.buffer();active=false;recovery.tick();time+=90000;recovery.tick();assert.equal(ev.isBuffering(),true);
});
test('ordinary short buffers and disconnected sockets are not forced',()=>{
 let time=0,buffered=true,flushed=0;
 const recovery=createBufferRecovery({sock:{ev:{isBuffering:()=>buffered,flush:()=>{flushed++;}}},isActive:()=>true,now:()=>time,log:quiet});
 recovery.tick();time=20000;buffered=false;recovery.tick();time=80000;buffered=true;recovery.tick();assert.equal(flushed,0);
});
test('only the pinned pre-write Connection Closed throw is classified unsent',()=>{
 const error=Object.assign(new Error('Connection Closed'),{output:{statusCode:428}});
 error.stack='Error: Connection Closed\n    at sendRawMessage (file:///app/node_modules/@whiskeysockets/baileys/lib/Socket/socket.js:56:19)';
 assert(definitelyUnsent(error));
 assert(!definitelyUnsent(new Error('Connection Closed')));
 assert(!definitelyUnsent({...error,stack:'at waitForMessage (/Socket/socket.js:118:1)'}));
 assert(!definitelyUnsent({...error,message:'Timed Out'}));
});
const source=await readFile(new URL('./index.js',import.meta.url),'utf8');
test('decoded messages are durable before an obsolete socket drops its queue',async()=>{
 const store=await createDeliveryStore(null);let queued=0;
 const ctx=vm.createContext({replacementPhone:'',sock:{},getText:m=>m?.conversation||'',acceptsFreightSource,isChannelJid,channelMessageId,isRelayText:()=>false,EXCLUDED_GROUPS:new Set(['9@g.us']),ownChannelJids:()=>['1@newsletter'],Date,processedMessages:new Map(),deliveryStore:store,enqueueMessages:async()=>{queued++;assert.equal(Object.keys(store.data.retries).length,2);return false;}});
 const start=source.indexOf(' const receiveMessages=async');
 vm.runInContext(source.slice(start,source.indexOf(" sock.ev.on('messages.upsert'",start))+';globalThis.receive=receiveMessages;',ctx);
 const m=(id,jid)=>({key:{id,remoteJid:jid},messageTimestamp:Math.floor(Date.now()/1000),message:{conversation:'freight'}});
 const result=await ctx.receive({type:'append',messages:[m('a','2@g.us'),m('b','3@newsletter'),m('c','1@newsletter'),m('d','9@g.us'),m('e','4@s.whatsapp.net')]});
 assert.equal(result,false);assert.equal(queued,1);assert.deepEqual(Object.keys(store.data.retries).sort(),['2@g.us:a','3@newsletter:channel:b']);
});
test('disconnect during numbering leaves pending; pre-write rejection retries; ambiguous send never retries',async()=>{
 const store=await createDeliveryStore(null);let sends=0,drop=false,sendError=null;
 const sock={ws:{isOpen:true},sendMessage:async()=>{sends++;if(sendError)throw sendError;return {key:{id:'msg'}};}};
 const ctx=vm.createContext({activeSocket:sock,status:'connected',definitelyUnsent,deliveryStore:store,groupRelay:{observeSent:async()=>{}},console,setTimeout,Date,AbortSignal,formatChannelAd:()=>'<ad>',process:{env:{}},fetch:async()=>{if(drop)sock.ws.isOpen=false;return {ok:true,json:async()=>({ready:true,ad_number:8000,daily_number:1,day:'2026-10-20'})};}});
 vm.runInContext(source.slice(source.indexOf('let numberedChannelQueue='),source.indexOf('// Restore the old runner'))+';globalThis.send=sendNumberedChannelAd;',ctx);
 drop=true;await assert.rejects(()=>ctx.send(sock,'123@newsletter',{},'text','a','source'));assert.equal(sends,0);assert.equal(store.data.outbox.a.status,'pending');
 drop=false;sock.ws.isOpen=true;sendError=Object.assign(new Error('Connection Closed'),{output:{statusCode:428},stack:'Error\n at sendRawMessage (file:///app/node_modules/@whiskeysockets/baileys/lib/Socket/socket.js:56:19)'});
 await assert.rejects(()=>ctx.send(sock,'123@newsletter',{},'text','a','source'));assert.equal(store.data.outbox.a.status,'pending');
 sendError=null;await ctx.send(sock,'123@newsletter',{},'text','a','source');assert.equal(store.data.outbox.a.status,'sent');assert.equal(sends,2);
 sendError=new Error('Timed Out');await assert.rejects(()=>ctx.send(sock,'123@newsletter',{},'text','b','source'));assert.equal(store.data.outbox.b.status,'sending');
 await assert.rejects(()=>ctx.send(sock,'123@newsletter',{},'text','b','source'));assert.equal(sends,3);
});
