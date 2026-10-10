import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('./index.js',import.meta.url),'utf8').split("import makeWASocket,")[0].replace(/^import .*;$/gm,'');
const api=vm.runInNewContext(source+';({parse,formatChannelAd,validateAIParse})');
const contact='+9647838814014';
const screenshot='تحميل اكلنكر من كبيسة إلى حما\nوتحميل اسمنت من بغداد الى حلب الرقة حما\nمازوت ابيض متوفر سعر البرميل 125 دولار\nسلف موجوده\nتفضل خاص اقطعلكم';
const parsed=api.parse(screenshot,contact);
assert.equal(parsed.kind,'load');
assert.equal(parsed.publishable,true);
assert.equal(parsed.load.from_city,'كبيسة');
assert.equal(parsed.load.to_city,'حماة');
assert.equal(parsed.load.from_country,'العراق');
assert.equal(parsed.load.to_country,'سوريا');
assert.equal(parsed.load.cargo_type,'اكلنكر');
assert.equal(parsed.load.notes,screenshot);
const formatted=api.formatChannelAd(parsed,screenshot);
assert(formatted.startsWith('🚛 طلب نقل'));
assert(formatted.includes('🏁 إلى: حماة'));
assert(!formatted.includes('شاحنة متاحة'));
for(const extra of ['مازوت ابيض متوفر','سلف موجودة','الحمولة جاهزة','اسمنت متوفر','السعر متاح']){
 const p=api.parse('تحميل كلنكر من كبيسة إلى حماة\n'+extra,contact);
 assert.equal(p.kind,'load',extra);assert(p.publishable,extra);
}
for(const text of ['متوفر براد فاضي بسرمدا','براد متاح من حلب إلى دمشق','عندي شاحنة في الرياض','متوفر برادين فاضيين في سرمدا']){
 const p=api.parse(text,contact);assert.equal(p.kind,'truck_available',text);assert(p.publishable,text);
}
assert.equal(api.parse('مطلوب براد من حلب إلى دمشق مازوت متوفر',contact).kind,'load');
const ambiguous=api.parse('تحميل اسمنت من بغداد الى حلب الرقة حما',contact);
assert.equal(ambiguous.kind,'load');assert.equal(ambiguous.publishable,false);
const fuelOnly=api.parse('مازوت متوفر في كبيسة',contact);
assert.notEqual(fuelOnly.kind,'truck_available');assert.equal(fuelOnly.publishable,false);
assert.equal(api.validateAIParse(screenshot,{publish:true,kind:'truck_available',confidence:0.99,from_city:'كبيسة',from_country:'العراق',to_city:'بغداد',to_country:'العراق'},contact),null);
console.log('PASS: screenshot, cargo availability, vehicle availability, multiple routes, channel heading and AI guard');
