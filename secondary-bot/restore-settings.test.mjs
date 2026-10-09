import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {isFreightCandidate} from './ai-runtime.mjs';
const filename=process.argv[2]||'index.js';
let source=fs.readFileSync(filename,'utf8').replace(/^import .*;$/gm,'').replace('await mkdir(dir,{recursive:true});','').replace("connect().catch(e=>{status='error';console.error('pairing connection failed',e.message);});",'').replace("startBot().catch(e=>{status='error';console.error('pairing connection failed',e.message);});",'');
const callbacks={},requests=[],sent=[];
let mode='success';
let aiCalls=0;
const sock={user:{id:'4368120528715:4@s.whatsapp.net'},groupMetadata:async()=>({participants:[{id:'99999999999999@lid',lid:'99999999999999@lid',jid:'963955111222@s.whatsapp.net'},{id:'88888888888888@lid',jid:'963955999888@s.whatsapp.net'}]}),ev:{on:(key,fn)=>callbacks[key]=fn},sendMessage:async(jid,payload)=>{assert(jid.endsWith('@newsletter'));sent.push({jid,payload});return {key:{id:'test-channel-id'}};}};
const context=vm.createContext({console,createHash,Map,Set,URL,Date,AbortSignal,setTimeout,clearTimeout,process:{env:{SUPABASE_URL:'https://example.test',SUPABASE_ANON_KEY:'test',TRUCKLINK_INGEST_TOKEN:'test',TARGET_CHANNEL_JID:'123@newsletter'}},useMultiFileAuthState:async()=>({state:{},saveCreds:()=>{}}),makeWASocket:config=>{assert.equal(config.shouldSyncHistoryMessage(),false);return sock;},http:{createServer:()=>({listen:()=>{}})},fetch:async(url,opts)=>{
 if(!opts.body){assert(url.includes('/rpc/get_load_feed_v6?'));assert(url.includes('select=from_city,from_country,to_city,to_country'));return {ok:true,json:async()=>[{from_city:'مدينة اختبار',from_country:'سوريا',to_city:'دبي',to_country:'الإمارات'},{from_city:'تضارب',from_country:'سوريا',to_city:'تضارب',to_country:'العراق'}]};}
 const body=JSON.parse(opts.body);
 if(body.p_message_id==='connection-probe'){assert.equal(body.p_text,'');assert.equal(body.p_publish,false);return {ok:false,status:400,json:async()=>({code:'P0001',message:'invalid_text'})};}
 requests.push({url,body});
 return {ok:mode!=='error',status:500,text:async()=>JSON.stringify(mode==='duplicate'?{duplicate:true,published:true}:{published:mode==='success'&&(body.p_publish===true||url.endsWith('publish_whatsapp_truck_available'))})};
}});
context.isFreightCandidate=isFreightCandidate;context.getAIStatus=()=>({status:'not_configured'});context.extractFreightAd=async()=>{aiCalls++;return null;};
await vm.runInContext('(async()=>{'+source+';await connect();globalThis.api={parse,getText,validateAIParse,cityCountry,getLearning:()=>({learnedPlaces,placeLearningStatus,ingestConnectionStatus})};})()',context);
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
const countryRoute=parse('مطلوب شاحنه من قطر الى الاردن','+436605565676');
assert(countryRoute.publishable);
assert.equal(countryRoute.load.from_country,'قطر');
assert.equal(countryRoute.load.to_country,'الأردن');
assert.equal(countryRoute.load.from_city,'غير محددة');
assert.equal(countryRoute.load.to_city,'غير محددة');
assert.equal(countryRoute.load.contact_phone,'+436605565676');
for(const [text,from,to] of [
 ['مطلوب شاحنة من قطر إلى دبي','قطر','الإمارات'],
 ['مطلوب شاحنة من عدن في اليمن إلى دبي','اليمن','الإمارات'],
 ['مطلوب شاحنة من دبي إلى الأردن الحمولة 3 طن','الإمارات','الأردن'],
 ['مطلوب شاحنة من سلطنة عمان إلى قطر','عُمان','قطر']
]){const parsed=parse(text,'+436605565676');assert(parsed.publishable,text);assert.equal(parsed.load.from_country,from);assert.equal(parsed.load.to_country,to);}
assert.equal(parse('مطلوب شاحنه من قطر الى الاردن').publishable,false);
assert.equal(parse('مطلوب شاحنه من قطر الى مكان مجهول','+436605565676').publishable,false);
assert.equal(parse('مطلوب شاحنه من عدان الى دبي','+436605565676').publishable,false);
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
const own=message('OWNAD001','مطلوب براد من دمشق إلى دبي');own.key.fromMe=true;own.key.participant='12345678901234@lid';await upsert([own]);assert.equal(sent.length,5);assert.equal(requests.at(-1).body.p_parsed.load.contact_phone,'+4368120528715');
const ownExcluded=message('OWNEXCLUDED',complete[0],'120363285533629337@g.us');ownExcluded.key.fromMe=true;await upsert([ownExcluded]);assert.equal(sent.length,5);
const privateOwn=message('OWNPRIVATE',complete[0],'12345678901234@lid');privateOwn.key.fromMe=true;await upsert([privateOwn]);assert.equal(sent.length,5);
const pn=message('PARTICIPANTPN','مطلوب براد من حلب إلى دبي');pn.key.participant='11111111111111@lid';pn.key.participantPn='963955222333@s.whatsapp.net';await upsert([pn]);assert.equal(sent.length,6);assert.equal(requests.at(-1).body.p_parsed.load.contact_phone,'+963955222333');
const senderPn=message('SENDERPN001','مطلوب براد من حلب إلى دبي');senderPn.key.participant='22222222222222@lid';senderPn.key.senderPn='963955333444@s.whatsapp.net';await upsert([senderPn]);assert.equal(sent.length,7);assert.equal(requests.at(-1).body.p_parsed.load.contact_phone,'+963955333444');
const lid=message('METADATALID','مطلوب براد من حلب إلى دبي');lid.key.participant='99999999999999@lid';await upsert([lid]);assert.equal(sent.length,8);assert.equal(requests.at(-1).body.p_parsed.load.contact_phone,'+963955111222');
const unknown=message('UNKNOWNLID','مطلوب براد من حلب إلى دبي');unknown.key.participant='77777777777777@lid';await upsert([unknown]);assert.equal(sent.length,8);assert.equal(requests.at(-1).body.p_publish,false);assert.equal(requests.at(-1).body.p_parsed.load.contact_phone,null);
const explicit=message('EXPLICITPHONE','مطلوب براد من حلب إلى دبي +963955777666');explicit.key.participant='99999999999999@lid';await upsert([explicit]);assert.equal(sent.length,9);assert.equal(requests.at(-1).body.p_parsed.load.contact_phone,'+963955777666');
const countryMessage=message('COUNTRYROUTE','مطلوب شاحنه من قطر الى الاردن');countryMessage.key.participant='11111111111111@lid';countryMessage.key.participantPn='436605565676@s.whatsapp.net';await upsert([countryMessage]);assert.equal(sent.length,10);assert.equal(requests.at(-1).body.p_publish,true);assert.equal(requests.at(-1).body.p_parsed.load.to_city,'غير محددة');assert(sent.at(-1).payload.text.includes('+436605565676'));
const screenshotCases=[
 {text:'السلام عليكم\nيلزمنا سطحة لتحميل اسفنج من طرطوس الي حلب',phone:'+963957774185',from:'طرطوس',to:'حلب',cargo:'اسفنج',trailer:'سطحة',count:1},
 {text:'السلام عليكم\nمطلوب سياره لتحميل الحنطة من سوق الصالحية بدير الزور للباب\nالتحميل الصبح\nقد ما بحقلك حمل\nوصل مكتب الدور عالسائق\nكل السيارات شغالة',phone:'+963986266492',from:'سوق الصالحية بدير الزور',to:'الباب',cargo:'حنطة',count:1},
 {text:'برادين من باب الهوى على جابر حمولة كريمة وزن 10 طون',phone:'+963996950218',from:'باب الهوى',to:'جابر',cargo:'كريمة',trailer:'براد',count:2,weight:10},
 {text:'مطلوب سطحة طول ١٣.٦٠ لتحميل من عدرا الى القامشلي\nالتحميل بكرا الصبح\nالحمل اسفنج\nمكتب الدور عل السائق',phone:'+963957774185',from:'عدرا',to:'القامشلي',cargo:'اسفنج',trailer:'سطحة',count:1},
 {text:'مطلوب سطحا من جده إلى الرياض.\nالتحميل الصباح',phone:'+966545799640',from:'جدة',to:'الرياض',trailer:'سطحة',count:1},
 {text:'مطلوب سياره لتحميل الطحين من ( منبج ) للشام ٣٥ طن التحميل هلق فورا',phone:'+963986266492',from:'منبج',to:'دمشق',cargo:'طحين',count:1,weight:35},
 {text:'السلام عليكم لازمني تلت برادات تحميل من باب الهوه لليعروبيه',phone:'+963981225154',from:'باب الهوى',to:'اليعربية',trailer:'براد',count:3},
 {text:'مطلوب برادات تحميل من باب الهوى إلى جابر',phone:'+963985884575',from:'باب الهوى',to:'جابر',trailer:'براد',count:1}
];
for(const [i,sample] of screenshotCases.entries()){
 const parsed=parse(sample.text,sample.phone);
 assert(parsed.publishable,JSON.stringify({sample,parsed}));assert.equal(parsed.kind,'load');
 assert.equal(parsed.load.from_city,sample.from);assert.equal(parsed.load.to_city,sample.to);
 assert.equal(parsed.load.contact_phone,sample.phone);assert.equal(parsed.load.trucks_required,sample.count);
 if(sample.cargo)assert.equal(parsed.load.cargo_type,sample.cargo);
 if(sample.trailer)assert.equal(parsed.load.required_trailer_type,sample.trailer);
 if(sample.weight)assert.equal(parsed.load.weight_tons,sample.weight);
 assert.equal(parsed.load.notes,sample.text);
 const msg=message('SCREENSHOT'+i,sample.text);msg.key.participant=sample.phone.slice(1)+'@s.whatsapp.net';
 await upsert([msg]);assert.equal(requests.at(-1).body.p_publish,true);assert.equal(sent.length,11+i);
}
assert.equal(parse('متوفر برادين فاضيين في سرمدا','+963955111222').kind,'truck_available');
assert.equal(parse('متوفر برادين فاضيين في سرمدا','+963955111222').load.trucks_required,2);
assert.equal(parse('برادين من باب الهوى على جابر','+963955111222').publishable,false);
assert.equal(parse('مطلوب شاحنة موديل 2014 تكون منافيخ عمامي خلفي الي عندو يخبرنه الله يرزقك الجميع','+963955111222').publishable,false);
assert.equal(parse('الله يرزقك الجميع').load,null);
assert.equal(getText({protocolMessage:{type:0}}),'');
for(const [legacy,canonical] of Object.entries({'حفرالباطن':'حفر الباطن','مكه':'مكة','المدينه':'المدينة','الاحساء':'الأحساء','ابها':'أبها'})){
 const p=parse('مطلوب شاحنة من '+legacy+' إلى دبي','+966500000001');assert(p.publishable);assert.equal(p.load.from_city,canonical);assert.equal(p.load.from_country,'السعودية');
}
console.log('PASS: all eight screenshot advertisements, country/city routes, sender phone, availability, exclusions and platform/channel gating');
const ad='شاحنة: حمص مكان الشحن؛ العقبة مكان التفريغ';
const aiResult={publish:true,kind:'load',confidence:0.95,from_city:'حمص',from_country:'سوريا',to_city:'العقبة',to_country:'الأردن',vehicle_type:'شاحنة',contact_phone:'+19999999999'};
assert.equal(context.api.validateAIParse(ad,aiResult,'+963900000001').load.contact_phone,'+963900000001');
assert.equal(context.api.validateAIParse(ad,aiResult,null),null);
assert.equal(context.api.validateAIParse(ad,{...aiResult,to_city:'دبي',to_country:'الإمارات'},'+963900000001'),null);
assert.equal(context.api.validateAIParse(ad,{...aiResult,confidence:0.6},'+963900000001'),null);
assert.equal(context.api.validateAIParse(ad,{...aiResult,from_country:'العراق'},'+963900000001'),null);
context.extractFreightAd=async()=>aiResult;
await upsert([message('AIRECOVERY1',ad)]);assert.equal(requests.at(-1).body.p_parsed.parser,'openai');assert.equal(sent.length,19);
const aiBefore=aiCalls;context.extractFreightAd=async()=>{aiCalls++;return aiResult;};
await upsert([message('AIPRIVATE',ad,'963900000001@s.whatsapp.net'),message('AIEXCLUDED',ad,'120363285533629337@g.us')]);assert.equal(aiCalls,aiBefore);assert.equal(sent.length,19);
console.log('PASS: AI fallback integration, contact provenance, route grounding and private/excluded isolation');
