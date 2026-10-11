import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {isFreightCandidate} from './ai-runtime.mjs';
const source=fs.readFileSync(new URL('./index.js',import.meta.url),'utf8').split('import makeWASocket,')[0].replace(/^import .*;$/gm,'');
const api=vm.runInNewContext(source+';({parse,resolveSenderPhone,contactFromJid,validateAIParse})');
const cases=[
 ['مطلوب سيارة تحمل\nكياس ملح من\nالعشارة لمعرة مصرين','+963986266492','load','العشارة','معرة مصرين',null],
 ['🚛 مطلوب سطحات\n📍 التحميل: الدمام\n📍 التنزيل: عفيف\n⚖️ الحمولة: حديد تيوبات\n💰 الدفع: تحويل بعد التنزيل و تصوير الفاتورة فقط\n⚖️ الوزن: 23/ طن','+966501003744','load','الدمام','عفيف',23],
 ['سلام عليكم\nلازمنا تك بيشيل ١٠ طن\nمن اعزاز شمارين على حلب','+963951762710','load','اعزاز شمارين','حلب',10],
 ['سلام عليكم ورحمة الله\nبراد فاضي بشام اذا حدا عندو شي لحلب او إدلب او اللاذقية','+963932610925','truck_available','دمشق','حلب / ادلب / اللاذقية',null],
 ['براد مجمدات من باب الهوى إلى جابر','+963985884575','load','باب الهوى','جابر',null],
 ['مطلوب سطحة\nالتنزيل: عفيف\nالتحميل: الدمام\nحديد 23 طن','+966501003744','load','الدمام','عفيف',23]
];
for(const [text,contact,kind,from,to,weight] of cases){
 const p=api.parse(text,contact);
 assert.equal(p.publishable,true,JSON.stringify({text,p}));
 assert.equal(p.kind,kind);assert.equal(p.load.from_city,from);assert.equal(p.load.to_city,to);
 assert.equal(p.load.weight_tons,weight);assert.equal(p.load.contact_phone,contact);
 assert.equal(p.load.notes,text);
}
for(const text of [
 'مطلوب سطحة\nالتحميل: الدمام\nالتنزيل: عفيف أو حلب',
 'مطلوب سطحة\nالتحميل: الدمام\nالتحميل: الرياض\nالتنزيل: عفيف',
 'مطلوب سطحة\nالتحميل: موقع غير معروف\nالتنزيل: عفيف',
 'براد مجمدات للبيع من باب الهوى إلى جابر',
 'سلام عليكم ورحمة الله',
 'مطلوب تك بيشيل 10 طن'
])assert.equal(api.parse(text,'+963951762710').publishable,false,text);
assert.equal(api.parse(cases[2][0]).publishable,false);
assert.equal(isFreightCandidate(cases[2][0]),true);
assert.equal(isFreightCandidate('سلامتك'),false);
assert.equal(api.contactFromJid('123456789012345@lid'),null);
const msg={key:{remoteJid:'test@g.us',participant:'123456789012345@lid'}};
const sock={groupMetadata:async()=>({participants:[
 {id:'999999999999999@lid',phoneNumber:'963900000000@s.whatsapp.net'},
 {id:'123456789012345@lid',phoneNumber:'963951762710@s.whatsapp.net'}
]})};
assert.equal(await api.resolveSenderPhone(sock,msg),'+963951762710');
assert.equal(await api.resolveSenderPhone(sock,{key:{remoteJid:'test@g.us',participant:'888888888888888@lid'}}),null);
console.log('PASS: 6 freight cases, ambiguous routes, sales, missing contacts, sender identity and colloquial candidate');
