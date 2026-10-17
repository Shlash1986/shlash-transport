import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDeliveryStore} from './delivery-store.mjs';
import {installSafeLogging} from './safe-logging.mjs';
const source=fs.readFileSync(new URL('./index.js',import.meta.url),'utf8');
const api=vm.runInNewContext(source.split('import makeWASocket,')[0].replace(/^import .*;$/gm,'')+';({parse,freightParts})');
const phone='+966562161133';
test('actual Jeddah-Sharurah message accepts container spelling without inventing weight or price fields',()=>{
 const text='السلام عليكم ورحمة الله وبركاته\nمن ميناء جدة الى شرورة\nذهاب وعوده\nالتحميل بكرة ان شاءالله\nكونتيرات ٤٠ قدم\nاوزان اقل من ٣٠\nالاجار ٨٠٠٠';
 const p=api.parse(text,phone);
 assert.equal(p.publishable,true);assert.equal(p.kind,'load');assert.equal(p.load.from_city,'ميناء جدة');assert.equal(p.load.to_city,'شرورة');assert.equal(p.load.required_trailer_type,'حاويات');assert.equal(p.load.weight_tons,null);assert.equal(p.load.notes,text);
 for(const name of ['كونتينرات','كونتيرات','كنتنر','كونتنر'])assert(api.parse('تحميل '+name+' من جدة إلى شرورة',phone).publishable,name);
});
test('delivery destination takes priority over the empty-container return depot',()=>{
 const p=api.parse('مطلوب سطحات من ميناء جدة إلى المزاحمية، حاوية 40 قدم، وزن 20 طن أو أقل، مع إرجاع الحاوية الفارغة إلى ساحة في جدة.',phone);
 assert(p.publishable);assert.equal(p.load.to_city,'المزاحمية');assert.equal(p.load.from_city,'ميناء جدة');
 assert.equal(api.parse('مطلوب حاوية من ميناء جدة إلى مدينة مجهولة، مع إرجاع الفارغ إلى جدة',phone).publishable,false);
 assert(!p.load.required_trailer_type.includes('دينا'));
});
test('Arabic written with Urdu characters is understood',()=>{
 const p=api.parse('السلام عليكم\nکیف الحال یا شباب\nمطلوب ستایرر\nمن جدہ الی الریاض\n26 طن میاہ',phone);
 assert(p.publishable);assert.equal(p.load.from_city,'جدة');assert.equal(p.load.to_city,'الرياض');assert.equal(p.load.weight_tons,26);assert.equal(p.load.required_trailer_type,'ستارة');
});
test('two loading jobs retain separate destinations and trailer counts',()=>{
 for(const [raw,from,destinations,counts] of [
 ['مطلوب ستاير\nمياه وزن نظامي\nمن جده للرياض\nمن جده للدمام','جدة',['الرياض','الدمام'],[1,1]],
 ['السلام عليكم\nتحميل غدا الجمعة\nمن جده ساحه بالخمره\nالى الدمام\nكنتنر وزن نظامي 26\nحديد وزن نظامي 26\nوايضآ\nمن جده الخمره الى الرياض ساحه\nحديد وير ملفوف وزن نظامي\nخشب وزن نظامي\n0550495662','جدة الخمرة',['الدمام','الرياض'],[1,1]],
 ['مطلوب 2 سطحه او جوانب المانى من صعبر الى الرياض\nمطلوب 4 سطحه او جوانب المانى من صعبر الى الخرج\nالتحميل السبت\n0506965053','صعبر',['الرياض','الخرج'],[2,4]]
 ]){
  const parts=api.freightParts(raw,phone);assert.equal(parts.length,2,raw);
  parts.forEach((part,i)=>{const p=api.parse(part,phone);assert(p.publishable,JSON.stringify({part,p}));assert.equal(p.load.from_city,from);assert.equal(p.load.to_city,destinations[i]);assert.equal(p.load.trucks_required,counts[i]);});
 }
});
test('delivery journal survives restart, prunes only old dedupe entries, and retains pending jobs',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'easttrucks-delivery-'));const path=join(folder,'state.json');
 try{
  const store=await createDeliveryStore(path,()=>2000000000000);
  await Promise.all([store.put('processed','one',2000000000000),store.put('freight','two',2000000000000),store.put('outbox','ad',{at:2000000000000,status:'pending'})]);
  await store.put('retries','source',{message:{key:{id:'source'},messageTimestamp:2000000000,message:{conversation:'text'}},next:0});
  const fresh=await createDeliveryStore(path,()=>2000000000001);
  assert.equal(fresh.data.processed.one,2000000000000);assert.equal(fresh.stats().pendingChannel,1);assert.equal(fresh.stats().pendingIngest,1);
  const later=await createDeliveryStore(path,()=>2000000000000+86400001);assert.equal(later.data.processed.one,undefined);assert(later.data.outbox.ad);
  assert(!String(await readFile(path)).includes('p_token'));
 }finally{await rm(folder,{recursive:true,force:true});}
});
test('session logging never exposes key material but preserves operational failures',()=>{
 const calls=[];const fake=Object.fromEntries(['info','log','warn','error'].map(k=>[k,(...a)=>calls.push(a)]));
 const restore=installSafeLogging(fake);fake.info('Closing session:',{currentRatchet:{privKey:'secret'}});fake.info('Removing old closed session:',{rootKey:'secret'});fake.warn('Closing open session in favor of incoming prekey bundle');fake.error('real failure',{privKey:'secret'});
 assert.equal(calls.length,1);assert.equal(calls[0][0],'real failure');assert(!JSON.stringify(calls).includes('secret'));restore();
});
test('failed numbering retries safely; successful send with failed receipt never resends; uncertain send stays blocked',async()=>{
 const code=source.slice(source.indexOf('let numberedChannelQueue='),source.indexOf('// Restore the old runner'));
 const store=await createDeliveryStore(null);let numberFails=true,receiptFails=false,uncertain=false,sends=0;
 const context=vm.createContext({groupRelay:{observeSent:async()=>{}},deliveryStore:store,console,setTimeout,Date,AbortSignal,formatChannelAd:()=>'<ad>',process:{env:{}},fetch:async(url,opt)=>{
  const b=JSON.parse(opt.body);
  if(b.p_action==='reserve'&&numberFails)throw new Error('timeout before send');
  if(b.p_action==='confirm'&&receiptFails)throw new Error('receipt outage');
  return {ok:true,json:async()=>({ready:true,ad_number:6000,daily_number:10,day:'2026-10-16',already_sent:false})};
 }});
 vm.runInContext(code+';globalThis.send=sendNumberedChannelAd',context);
 const sock={sendMessage:async()=>{sends++;if(uncertain)throw new Error('ack lost');return {key:{id:'confirmed-message'}};}};
 await assert.rejects(()=>context.send(sock,'123@newsletter',{},'text','ad-one','source-one'));
 assert.equal(store.data.outbox['ad-one'].status,'pending');assert.equal(sends,0);
 numberFails=false;receiptFails=true;await context.send(sock,'123@newsletter',{},'text','ad-one','source-one');assert.equal(sends,1);assert.equal(store.data.outbox['ad-one'].status,'receipt');
 receiptFails=false;await context.send(sock,'123@newsletter',{},'text','ad-one','source-one');assert.equal(sends,1);assert.equal(store.data.outbox['ad-one'].status,'sent');
 uncertain=true;await assert.rejects(()=>context.send(sock,'123@newsletter',{},'text','ad-two','source-two'));assert.equal(sends,2);assert.equal(store.stats().uncertainChannel,1);
 await assert.rejects(()=>context.send(sock,'123@newsletter',{},'text','ad-two','source-two'),/uncertain/);assert.equal(sends,2);
});
