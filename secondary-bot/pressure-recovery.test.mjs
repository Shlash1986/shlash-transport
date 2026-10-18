import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {createChannelReader} from './channel-reader.mjs';

const quiet={info(){},warn(){},log(){},error(){}};
const channels=Array.from({length:7},(_,i)=>({id:`12036340001747468${i}@newsletter`}));
const empty={tag:'iq',content:[{tag:'messages',content:[]}]};
test('bounded round-robin polling visits every channel without live-subscription traffic',async()=>{
 let clock=2000000000000,subscriptions=0;const polls=[];
 const reader=createChannelReader({sock:{query:async node=>{polls.push(node.content[0].attrs.jid);return empty;},subscribeNewsletterUpdates:async()=>{subscriptions++;}},isActive:()=>true,ownChannels:()=>[],onMessages:async()=>true,listChannels:async()=>channels,now:()=>clock,log:quiet});
 for(let i=0;i<4;i++){const before=polls.length;await reader.tick();assert(polls.length-before<=2);clock+=10000;}
 assert.deepEqual(polls,channels.map(c=>c.id));assert.equal(subscriptions,0);
 clock+=120000;await reader.tick();assert.deepEqual(polls.slice(-2),channels.slice(0,2).map(c=>c.id));reader.stop();
});
test('subscription rate limit pauses all subscriptions, polling continues, and reconnect keeps discovery/backoff',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'easttrucks-pressure-'));let clock=2000000000000,subscriptions=0,discoveries=0,polls=0;
 const options={liveSubscriptions:true,sock:{subscribeNewsletterUpdates:async()=>{subscriptions++;throw new Error('rate-overlimit');},query:async()=>{polls++;return empty;}},isActive:()=>true,ownChannels:()=>[],onMessages:async()=>true,listChannels:async()=>{discoveries++;return channels;},now:()=>clock,log:quiet,statePath:join(dir,'state.json')};
 try{
  const reader=createChannelReader(options);await reader.tick();assert.equal(subscriptions,1);assert.equal(polls,2);assert.equal(reader.state.status,'degraded');reader.stop();
  clock+=10000;const restarted=createChannelReader(options);await restarted.tick();assert.equal(subscriptions,1);assert.equal(discoveries,1);assert.equal(polls,4);assert.equal(restarted.state.lastError,'rate-overlimit');restarted.stop();
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('poll rate limits persist across reconnect and resume only after cooldown',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'easttrucks-poll-cooldown-'));let clock=2000000000000,polls=0,fail=true;
 const options={sock:{query:async()=>{polls++;if(fail)throw new Error('rate-overlimit');return empty;}},isActive:()=>true,ownChannels:()=>[],onMessages:async()=>true,listChannels:async()=>channels,now:()=>clock,log:quiet,statePath:join(dir,'state.json')};
 try{
  const reader=createChannelReader(options);await reader.tick();assert.equal(polls,1);reader.stop();
  const restarted=createChannelReader(options);clock+=60000;await restarted.tick();assert.equal(polls,1);assert.equal(restarted.state.status,'degraded');
  fail=false;clock+=3600000;await restarted.tick();assert.equal(polls,3);restarted.stop();
 }finally{await rm(dir,{recursive:true,force:true});}
});

const source=await readFile(new URL('./index.js',import.meta.url),'utf8');
const api=vm.runInNewContext(source.split('import makeWASocket,')[0].replace(/^import .*;$/gm,'')+';({parse,freightParts})');
test('actual rejected Qassim/Buraydah and colloquial Tanf adverts retain explicit endpoints',()=>{
 const qassim='مطلوب برادات تريلات\n18 درجة التبريد\nوزن نظامي\n📍 من القصيم بريدة ⬅️ الى الرياض\nشغل يومي مستمر';
 const p=api.parse(qassim,'+966500000001');assert(p.publishable,JSON.stringify(p));assert.equal(p.load.from_city,'بريدة');assert.equal(p.load.to_city,'الرياض');assert.equal(p.load.weight_tons,null);
 const text='السلام عليكم براد يحمل برتقال من باب لهوى علتنف تبادل';
 const t=api.parse(text,'+963900000001');assert(t.publishable,JSON.stringify(t));assert.equal(t.load.from_city,'باب الهوى');assert.equal(t.load.to_city,'التنف');assert.equal(t.load.notes,text);
 for(const text of ['مطلوب براد يحمل دبي رمان','شباب بدنا نطلع عل نصيب نحمل في حدا يعلمنا شو الوراق وكيف التسجيل','مطلوب براد من موقع غير معروف إلى الرياض'])assert.equal(api.parse(text,'+963900000001').publishable,false,text);
});
test('group refresh notifications and reconnect do not trigger metadata loops before twelve hours',async()=>{
 let clock=2000000000000,calls=0;
 const sock={user:{id:'test@s.whatsapp.net'},groupFetchAllParticipating:async()=>{calls++;return {'123@g.us':{id:'123@g.us'}};}};
 const code=source.slice(source.indexOf('let groupRefreshInFlight='),source.indexOf('let manualPublication='));
 const ctx=vm.createContext({activeSocket:sock,replacementPhone:'',senderIdentity:x=>x,EXCLUDED_GROUPS:new Set(),Date:{now:()=>clock},console:quiet,process:{env:{}},groupCount:0,monitoredGroupCount:0,groupCheckError:''});
 vm.runInContext(code+';globalThis.refresh=refreshJoinedGroups;',ctx);
 await ctx.refresh(sock);clock+=60000;await ctx.refresh(sock);await ctx.refresh(sock,true);assert.equal(calls,1);
 clock+=12*60*60*1000;await ctx.refresh(sock);assert.equal(calls,2);
});
