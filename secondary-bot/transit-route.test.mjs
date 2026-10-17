import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('./index.js',import.meta.url),'utf8');
const api=vm.runInNewContext(source.split('import makeWASocket,')[0].replace(/^import .*;$/gm,'')+';({parse,freightParts})');
const contact='+4592453472';
const latest='السلام وعليكم مطلوب سطحه او ستارة تحمل مواد اولية من باب الهواء الي جابر جاهز يتواصل معي\n+45 92 45 34 72';
const earlier='مطلوب 5برادات يحملو بطاطا على بغداد. من معبر التنف تحميل من حلب جاهز يرفع معلوماتو';

test('actual channel post canonicalizes Bab al-Hawa spelling and keeps the advertised contact',()=>{
 const parts=api.freightParts(latest,null);assert.equal(parts.length,1);
 const p=api.parse(parts[0]);
 assert.equal(p.publishable,true);assert.equal(p.load.from_city,'باب الهوى');assert.equal(p.load.to_city,'جابر');
 assert.equal(p.load.from_country,'سوريا');assert.equal(p.load.to_country,'الأردن');
 assert.equal(p.load.contact_phone,contact);assert.equal(p.load.cargo_type,'مواد أولية');
 assert.equal(p.load.notes,latest);
 for(const spelling of ['باب الهواء','معبر باب الهواء','باب الهوا','باب الهوى']){
  const q=api.parse('مطلوب ستارة من '+spelling+' إلى جابر',contact);
  assert(q.publishable,spelling);assert.equal(q.load.from_city,'باب الهوى');
 }
});

test('destination-first post preserves Aleppo origin, Baghdad destination, five reefers and transit notes',()=>{
 const parts=api.freightParts(earlier,contact);assert.equal(parts.length,1);
 const p=api.parse(parts[0],contact);
 assert(p.publishable,JSON.stringify(p));assert.equal(p.load.from_city,'حلب');assert.equal(p.load.to_city,'بغداد');
 assert.equal(p.load.from_country,'سوريا');assert.equal(p.load.to_country,'العراق');
 assert.equal(p.load.trucks_required,5);assert.equal(p.load.required_trailer_type,'براد');assert.equal(p.load.cargo_type,'بطاطا');
 assert.equal(p.load.weight_tons,null);assert(p.load.notes.includes('معبر التنف'));
 const missingContact=api.parse(earlier);
 assert.equal(missingContact.publishable,false);assert.equal(missingContact.reason,'contact_number_missing');
 assert.equal(missingContact.load.contact_phone,null);
});

test('explicit transit never changes either end of the route, regardless of clause order',()=>{
 for(const text of [
  'مطلوب براد تحميل من حلب إلى بغداد عبر معبر التنف',
  'مطلوب براد إلى بغداد عبر التنف تحميل من حلب',
  'مطلوب براد على بغداد طريق التنف تحميل من حلب',
  'مطلوب براد على بغداد من معبر جابر تحميل من حلب',
  'مطلوب براد على بغداد.\nمن معبر التنف\nتحميل من حلب'
 ]){
  const p=api.parse(text,contact);assert(p.publishable,JSON.stringify({text,p}));
  assert.equal(p.load.from_city,'حلب');assert.equal(p.load.to_city,'بغداد');assert.equal(p.load.notes,text);
 }
});

test('conflicting origins, destinations and an unknown endpoint stay unpublished',()=>{
 for(const text of [
  'مطلوب برادات على بغداد من معبر التنف تحميل من حلب أو حمص',
  'مطلوب برادات على بغداد أو الموصل من معبر التنف تحميل من حلب',
  'مطلوب برادات على مدينة مجهولة من معبر التنف تحميل من حلب',
  'مطلوب برادات على بغداد من معبر التنف تحميل من مكان مجهول'
 ])assert.equal(api.parse(text,contact).publishable,false,text);
});

test('border crossings can still be actual origins or delivery destinations',()=>{
 for(const [text,from,to] of [
  ['مطلوب براد تحميل من حلب إلى التنف','حلب','التنف'],
  ['مطلوب ستارة تحميل من باب الهوى إلى معبر جابر','باب الهوى','معبر جابر'],
  ['مطلوب براد من معبر جابر إلى بغداد','معبر جابر','بغداد']
 ]){
  const p=api.parse(text,contact);assert(p.publishable,JSON.stringify({text,p}));
  assert.equal(p.load.from_city,from);assert.equal(p.load.to_city,to);
 }
});
