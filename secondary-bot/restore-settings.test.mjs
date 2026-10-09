import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const filename=process.argv[2]||'index.js';
let source=fs.readFileSync(filename,'utf8').replace(/^import .*;$/gm,'').replace('await mkdir(dir,{recursive:true});','').replace("connect().catch(e=>{status='error';console.error('pairing connection failed',e.message);});",'');
const callbacks={},requests=[],sent=[];
let mode='success';
const sock={ev:{on:(key,fn)=>callbacks[key]=fn},sendMessage:async(jid,payload)=>{assert(jid.endsWith('@newsletter'));sent.push({jid,payload});return {key:{id:'test-channel-id'}};}};
const context=vm.createContext({console,createHash,Map,Set,URL,Date,AbortSignal,setTimeout,clearTimeout,process:{env:{SUPABASE_URL:'https://example.test',SUPABASE_ANON_KEY:'test',TRUCKLINK_INGEST_TOKEN:'test',TARGET_CHANNEL_JID:'123@newsletter'}},useMultiFileAuthState:async()=>({state:{},saveCreds:()=>{}}),makeWASocket:config=>{assert.equal(config.shouldSyncHistoryMessage(),false);return sock;},http:{createServer:()=>({listen:()=>{}})},fetch:async(url,opts)=>{
 if(!opts.body){assert(url.includes('/rpc/get_load_feed_v6?'));assert(url.includes('select=from_city,from_country,to_city,to_country'));return {ok:true,json:async()=>[{from_city:'مدينة اختبار',from_country:'سوريا',to_city:'دبي',to_country:'الإمارات'},{from_city:'تضارب',from_country:'سوريا',to_city:'تضارب',to_country:'العراق'}]};}
 const body=JSON.parse(opts.body);
 if(body.p_message_id==='connection-probe'){assert.equal(body.p_text,'');assert.equal(body.p_publish,false);return {ok:false,status:400,json:async()=>({code:'P0001',message:'invalid_text'})};}
 requests.push({url,body});
 return {ok:mode!=='error',status:500,text:async()=>JSON.stringify(mode==='duplicate'?{duplicate:true,published:true}:{published:mode==='success'&&(body.p_publish===true||url.endsWith('publish_whatsapp_truck_available'))})};
}});
await vm.runInContext('(async()=>{'+source+';await connect();globalThis.api={parse,getText,cityCountry,getLearning:()=>({learnedPlaces,placeLearningStatus,ingestConnectionStatus})};})()',context);
const {parse,getText}=context.api;
assert.equal(context.api.getLearning().learnedPlaces,1);
assert.equal(context.api.getLearning().placeLearningStatus,'ready');
assert.equal(context.api.getLearning().ingestConnectionStatus,'ready');
assert(!context.api.cityCountry.has('تضارب'));
const complete=['مطلوب براد من باب الهوا إلى دبي\n+963957910793','مطلوب شاحنة من ينبع إلى الدمام\n+4368120528715','سياره تحمل قطن من قحطانيه يلا تل ابيض\n+963957910793','مطلوب ستارة عدد 2 من حلب عنصيب الحمولة 3 طون\n+905392142652','مطلوب ستارتين من حلب إلى نصبيض\n+963957910793','مطلوب براد من مدينة اختبار إلى دبي\n+963957910793'];
for(const text of complete){const p=parse(text);assert.equal(p.kind,'load',text);assert(p.publishable,text);assert(p.confidence>=0.86);assert(p.load.from_country&&p.load.to_country);}
assert.equal(parse(complete[3]).load.weight_tons,3);
assert.equal(parse(complete[3]).load.trucks_required,2);
assert.equal(parse(complete[4]).load.to_city,'نصيب');
for(const text of ['مطلوب ستارة عدد 2 الحمولة 3 طون عنصيب +905392142652','مطلوب ستارتين إلى نصيب +905392142652','سعر الدولار في دمشق وحلب 0982835244'])assert.equal(parse(text).publishable,false,text);
const truck=parse('متوفر براد فاضي بسرمدا +963957910793');assert.equal(truck.kind,'truck_available');assert(truck.publishable);assert.equal(truck.load.to_city,null);
assert.equal(getText({ephemeralMessage:{message:{documentWithCaptionMessage:{message:{documentMessage:{caption:'caption'}}}}}}),'caption');
assert.equal(getText({videoMessage:{caption:'video'}}),'video');
const message=(id,text,jid='123@g.us')=>({key:{id,remoteJid:jid,participant:'963957910793@s.whatsapp.net'},messageTimestamp:Math.floor(Date.now()/1000),message:{conversation:text}});
const upsert=messages=>callbacks['messages.upsert']({type:'notify',messages});
await upsert([message('LOAD001',complete[0])]);assert.equal(sent.length,1);assert.equal(requests[0].body.p_parsed.load.to_country,'الإمارات');
await upsert([message('LOAD001',complete[0])]);assert.equal(requests.length,1);
await upsert([message('PRIVATE1',complete[0],'963999999999@s.whatsapp.net'),message('EXCLUDED1',complete[0],'120363285533629337@g.us')]);assert.equal(requests.length,1);
await upsert([message('INCOMPLETE1','مطلوب ستارة عدد 2 الحمولة 3 طون عنصيب +905392142652')]);assert.equal(requests.at(-1).body.p_publish,false);assert.equal(sent.length,1);
await upsert([message('INCOMPLETE1','مطلوب ستارة عدد 2 الحمولة 3 طون عنصيب +905392142652')]);assert.equal(requests.length,2);
await upsert([message('TRUCK001','متوفر براد فاضي بسرمدا +963957910793')]);assert(requests.at(-1).url.endsWith('publish_whatsapp_truck_available'));assert(!('p_publish' in requests.at(-1).body));assert.equal(sent.length,2);
await upsert([message('FORWARD01',complete[0],'456@g.us')]);assert.equal(requests.length,3);assert.equal(sent.length,2);
mode='duplicate';await upsert([message('DUPE001',complete[2])]);assert.equal(sent.length,2);
mode='error';await upsert([message('ERROR001',complete[3])]);assert.equal(sent.length,2);
mode='success';await upsert([message('ERROR001',complete[3])]);assert.equal(sent.length,3);
const video=message('VIDEO001','');video.message={videoMessage:{caption:complete[1]}};await upsert([video]);assert.equal(sent.length,4);
console.log('PASS: restored place learning, complete routes, dual request classification, weight/count, missing-origin rejection, captions, private/excluded groups, RPC and channel gating');
