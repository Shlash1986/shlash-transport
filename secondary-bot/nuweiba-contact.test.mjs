import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

// Evaluate the parser without starting the production WhatsApp socket.
const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const parser = source.slice(source.indexOf('const ARABIC_DIGITS'), source.indexOf('// Presentation only'));
const parse = runInNewContext(parser + '\nparse');

for (const city of ['دبي', 'الكويت']) {
  test(city + ' to Nuweiba with an Egyptian mobile', () => {
    const ad = parse('مطلوب براد ' + city + '\nحمل ناشف بدون تبريد\nطريق نويبع\n٠١٠١٢٣٤٥٦٧٨');
    assert.equal(ad.publishable, true);
    assert.equal(ad.load.to_country, 'مصر');
    assert.equal(ad.load.contact_phone, '+201012345678');
    assert.equal(ad.load.contact_whatsapp, ad.load.contact_phone);
  });
}
