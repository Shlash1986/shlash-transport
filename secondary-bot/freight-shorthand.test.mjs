import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import {isFreightCandidate} from './ai-runtime.mjs';
import {createPriorityMessageQueue} from './priority-queue.mjs';
import {createDeliveryStore} from './delivery-store.mjs';
const source=fs.readFileSync(new URL('./index.js',import.meta.url),'utf8');
const parserSource=source.split('import makeWASocket,')[0].replace(/^import .*;$/gm,'');
const api=vm.runInNewContext(parserSource+';({parse,validateAIParse,freightPriority})');
const contact='+966500000001';
const examples=[
 ['٢لوبد من تبوك ع حايل','تبوك','حايل','السعودية','السعودية','لوبد',2],
 ['قطعه من حايل ع\nخميس مشيط','حايل','خميس مشيط','السعودية','السعودية',null,1],
 ['لوايد من طريف ع\nالرياض','طريف','الرياض','السعودية','السعودية','لوايد',1],
 ['السلام عليكم عندي\nاحمال على طرطوس\nمن موصل','موصل','طرطوس','العراق','سوريا',null,1]
];
const result=([,from_city,to_city,from_country,to_country,vehicle_type,trucks_required])=>({publish:true,kind:'load',from_city,to_city,from_country,to_country,vehicle_type,trucks_required,cargo_type:null,weight_tons:null,confidence:0.95});

test('screenshot shorthand reaches AI and validated output preserves direction, counts and missing fields',async()=>{
 for(let i=0;i<examples.length;i++){
  const example=examples[i],text=example[0];
  assert(isFreightCandidate(text),text);
  const original={AI_ENABLED:process.env.AI_ENABLED,AI_PROVIDER:process.env.AI_PROVIDER};
  process.env.AI_ENABLED='true';process.env.AI_PROVIDER='groq';
  try{
   const {extractFreightAd}=await import('./ai-runtime.mjs?shorthand='+i);
   let calls=0;
   const ai=await extractFreightAd(text,{apiKey:'test-key',fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result(example))}}]})};}});
   assert.equal(calls,1);
   const parsed=api.validateAIParse(text,ai,contact);
   assert(parsed?.publishable,text);
   assert.equal(parsed.load.from_city,example[1]==='موصل'?'الموصل':example[1]==='حايل'?'حائل':example[1]);
   assert.equal(parsed.load.to_city,example[2]==='حايل'?'حائل':example[2]);
   assert.equal(parsed.load.from_country,example[3]);assert.equal(parsed.load.to_country,example[4]);
   assert.equal(parsed.load.trucks_required,example[6]);assert.equal(parsed.load.weight_tons,null);
   assert.equal(parsed.load.required_trailer_type,example[5]?'لوبد':'غير محدد');
   assert.equal(parsed.load.contact_phone,contact);assert.equal(parsed.load.notes,text);
   assert.equal(api.validateAIParse(text,{...ai,publish:false},contact),null);
   assert.equal(api.validateAIParse(text,{...ai,confidence:0.7},contact),null);
  }finally{for(const [key,value] of Object.entries(original))if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
});

test('aliases, dual and plural lowbeds preserve availability and quantities',()=>{
 for(const word of ['لوبد','لوبدات','لوابد','لوايد','لوبدين'])assert(isFreightCandidate(word+' من حلب إلى الرياض'));
 for(const text of ['٣ لوابد من حلب إلى دمشق','ثلاث لوايد من حلب إلى دمشق'])assert.equal(api.parse(text,contact).load.trucks_required,3);
 const available=api.parse('لوابد فاضية في طريف',contact);
 assert.equal(available.kind,'truck_available');assert(available.publishable);assert.equal(available.load.required_trailer_type,'لوبد');
 for(const text of ['قطعة','قطعة غيار للبيع','قطعة من قلبي','سلامتك','احمالات','انا في حايل وخميس مشيط'])assert.equal(isFreightCandidate(text),false,text);
 const lowbed=examples[0];
 assert.equal(api.validateAIParse('للبيع '+lowbed[0],result(lowbed),contact),null);
 assert.equal(api.validateAIParse(lowbed[0],{...result(lowbed),from_city:'حايل',to_city:'تبوك'},contact),null);
 const reversed=examples[3];
 assert.equal(api.validateAIParse(reversed[0],{...result(reversed),from_city:'طرطوس',from_country:'سوريا',to_city:'موصل',to_country:'العراق'},contact),null);
 assert.equal(api.validateAIParse('احمال على طرطوس من مكان مجهول',{...result(reversed),from_city:'مكان مجهول'},contact),null);
});

test('Syrian plated trucks in Dubai keep Dubai as origin and Syria as destination country',()=>{
 const text='موجود سطحه\nوموجودبراد نمره\nسوريه في دبي الي\nعنده احمال لسوريا';
 const p=api.parse(text,'+962700000001');
 assert(p.publishable);assert.equal(p.kind,'truck_available');
 assert.equal(p.load.from_city,'دبي');assert.equal(p.load.from_country,'الإمارات');
 assert.equal(p.load.to_country,'سوريا');assert.equal(p.load.to_city,null);
 assert.equal(p.load.transport_scope,'international');assert.equal(p.load.required_trailer_type,'سطحة أو براد');
 assert.equal(p.load.notes,text);
 assert.equal(api.parse('موجود براد نمرة سورية في دبي',contact).load.to_country,null);
});

test('Syria gets first priority for domestic, inbound, outbound and Syrian trucks abroad',()=>{
 for(const text of ['حمولة من حلب إلى دمشق','براد من الشام إلى دبي','احمال على طرطوس من موصل','موجود سطحه نمرة سوريه في دبي','قطعة من الرياض لسوريا','انتر فاضي بسرمدا'])assert.equal(api.freightPriority(text),0,text);
 for(const text of ['٢ لوبد من تبوك ع حايل','قطعه من حايل ع خميس مشيط','براد من الرياض إلى دبي','قطعة من بغداد إلى الكويت'])assert.equal(api.freightPriority(text),1,text);
});

test('queued Syrian messages overtake other waiting batches without interrupting the current message',async()=>{
 const order=[];let unblock,started;
 const firstStarted=new Promise(resolve=>{started=resolve;});
 const block=new Promise(resolve=>{unblock=resolve;});
 const enqueue=createPriorityMessageQueue({priority:m=>m.rank,handleBatch:async({messages:[message]})=>{order.push(message.id);if(message.id==='current'){started();await block;}return message.id!=='deferred';}});
 const first=enqueue({type:'notify',messages:[{id:'current',rank:1}]});await firstStarted;
 const ordinary=enqueue({type:'notify',messages:[{id:'gulf1',rank:1},{id:'gulf2',rank:1}]});
 const syrian=enqueue({type:'notify',messages:[{id:'syria1',rank:0},{id:'deferred',rank:0}]});
 unblock();assert.deepEqual(await Promise.all([first,ordinary,syrian]),[true,true,false]);
 assert.deepEqual(order,['current','syria1','deferred','gulf1','gulf2']);
});

test('AI quota deferral remains in the delivery store without marking or publishing the message',async()=>{
 const deliveryStore=await createDeliveryStore(null),sock={};
 const ctx=vm.createContext({console:{log(){},warn(){},error(){}},Date,process:{env:{SUPABASE_URL:'test',SUPABASE_ANON_KEY:'test',TRUCKLINK_INGEST_TOKEN:'test'}},
  sock,activeSocket:sock,deliveryStore,ownChannelJids:()=>[],isRelayText:()=>false,acceptsFreightSource:()=>true,EXCLUDED_GROUPS:new Set(),isChannelJid:()=>false,rememberMessage(){},
  getText:m=>m.conversation,receivedGroupMessages:0,receivedChannelMessages:0,lastReceivedAt:null,processedMessages:new Set(),isFreightCandidate,
  extractFreightAd:async(text,{onDeferred})=>{onDeferred({reason:'rate_limited',retryAfterMs:60000});return null;},
  markProcessed:()=>{throw Error('Deferred message must not be marked');},ingestFreight:()=>{throw Error('Deferred message must not be published');}
 });
 vm.runInContext(parserSource+'\n'+source.slice(source.indexOf('const handleMessages=async'),source.indexOf(' // Serialize events'))+';globalThis.handle=handleMessages;',ctx);
 const message={key:{id:'quota-test',remoteJid:'test@g.us',participant:'966500000001@s.whatsapp.net'},messageTimestamp:Math.floor(Date.now()/1000),message:{conversation:examples[0][0]}};
 assert.equal(await ctx.handle({type:'notify',messages:[message]}),false);
 const retained=deliveryStore.data.retries['test@g.us:quota-test'];
 assert(retained);assert.equal(retained.message.message.conversation,examples[0][0]);
 assert(retained.next>Date.now()+50000);assert.equal(Object.keys(deliveryStore.data.processed).length,0);
 assert.equal(retained.aiDeferred,true);
 // A due Syrian retry reserves the next inference opportunity, even if a fresh
 // non-Syrian message reaches the worker before the periodic retry timer fires.
 await deliveryStore.put('retries','syrian-pending',{aiDeferred:true,next:Date.now()+30000,message:{...message,message:{conversation:examples[3][0]}}});
 let lowerPriorityCalls=0;ctx.extractFreightAd=async()=>{lowerPriorityCalls++;return null;};
 assert.equal(await ctx.handle({type:'notify',messages:[{...message,key:{...message.key,id:'gulf-after-syria'}}]}),false);
 assert.equal(lowerPriorityCalls,0);
 assert(deliveryStore.data.retries['test@g.us:gulf-after-syria'].aiDeferred);
});
