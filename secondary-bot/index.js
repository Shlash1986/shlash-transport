import {createHash} from 'node:crypto';
const ARABIC_DIGITS                        = { "٠":"0","١":"1","٢":"2","٣":"3","٤":"4","٥":"5","٦":"6","٧":"7","٨":"8","٩":"9","۰":"0","۱":"1","۲":"2","۳":"3","۴":"4","۵":"5","۶":"6","۷":"7","۸":"8","۹":"9" };
function normalize(input=""){ return String(input).replace(/[٠-٩۰-۹]/g,d=>ARABIC_DIGITS[d]||d).replace(/ـ/g,"").replace(/[إأآ]/g,"ا").replace(/ى/g,"ي").replace(/ؤ/g,"و").replace(/ئ/g,"ي").replace(/\s+/g," ").trim(); }
const cityCountry = new Map               ();
function add(c       , cities         ){ for(const city of cities) cityCountry.set(normalize(city),c); }
add("سوريا",["دمشق","الشام","حلب","إدلب","ادلب","سرمدا","باب الهوى","معبر باب الهوى","باب السلامة","باب السلام","معبر باب السلام","جرابلس","الباب","الرقة","الحسكة","القامشلي","تدمر","حمص","حماة","حماه","طرطوس","بانياس","دير الزور","ديرالزور","اليعربية","اليعروبية","ساحة التبادل اليعربية","ساحة تبادل اليعربية","التنف","البوكمال","تل أبيض","رأس العين","خان العسل","نصيب","معبر نصيب","الدرباسية","رميلان","منبج","عفرين","عدرا","القحطانية","تل تمر","تل حميس"]);
add("الأردن",["عمان","عمّان","جابر","معبر جابر","الرمثا","الزرقاء","العقبة","المعبر الشمالي","الشيخ حسين","سحاب","الأزرق","إربد","اربد"]);
add("العراق",["بغداد","البصرة","الموصل","أربيل","اربيل","كركوك","ربيعة","القائم","كبيسة","الوليد","طريبيل","زرباطية","سنجار","بيجي","النجف","تكريت","سامراء","دهوك","السماوة","الحلة"]);
add("السعودية",["الرياض","جدة","جده","الدمام","الجبيل","جبيل","جيزان","جازان","مكة","مكه","المدينة","المدينه","تبوك","خميس مشيط","القصيم","قصيم","سدير","صعبر","ينبع","الطائف","حائل","بريدة","بريده","عنيزة","عنيزه","الخبر","الاحساء","الأحساء","نجران","أبها","ابها","حفر الباطن","حفرالباطن"]);
add("الإمارات",["دبي","أبوظبي","ابوظبي","الشارقة","الشارقه","العين"]);
add("لبنان",["بيروت","طرابلس لبنان","البقاع","شتورا"]);
add("عُمان",["مسقط","صلالة","صلاله"]);
add("الكويت",["الكويت"]); add("قطر",["الدوحة","الدوحه"]); add("البحرين",["المنامة","المنامه"]);
add("تركيا",["مرسين","غازي عنتاب","عنتاب","إسطنبول","اسطنبول","أورفا","اورفا","كيليس"]);

const trailers                   = [
  [/(?:قاطره\s*(?:و)?مقطوره|قاطرة\s*(?:و)?مقطورة|قاطره\s+مقطوره|قاطرة\s+مقطورة)/u,"قاطرة مقطورة"],
  [/(?:راس\s*و?دنب|رأس\s*و?ذنب|راس\s*وذنب|رأس\s*وذنب)/u,"رأس وذنب"],
  [/(?:اورفليه|أورفليه|اورفليه|أورفلية|اورفلية|اوفليه|أوفليه|اورفلي|أورفلي)/u,"أورفليه"],
  [/(?:براد|برادات|ثلاجه|ثلاجة|reefer)/iu,"براد"],
  [/(?:بوكس\s*مبرد)/u,"بوكس مبرد"],
  [/(?:ستاره|ستارة|ستاير|ستائر|اورفلية\s*ستارة)/u,"ستارة"],
  [/(?:سطحه|سطحة|سطحات|سطحيه|سطحية|flatbed)/iu,"سطحة"],
  [/(?:كشف\s*جنب)/u,"كشف جنب"],
  [/(?:جوانب\s*الماني|جوانب\s*ألماني)/u,"جوانب ألماني"],
  [/(?:جوانب\s*عاليه|جوانب\s*عالية)/u,"جوانب عالية"],
  [/(?:جنابي|اجناب|أجناب|جناب|صينيه\s*جنابي|صينية\s*جنابي)/u,"جنابي"],
  [/(?:مقطوره|مقطورة)/u,"مقطورة"],
  [/(?:قلاب|قلابات|غلاب)/u,"قلاب"],
  [/(?:لوبد|لوبدات)/u,"لوبد"],
  [/(?:صهريج|صهاريج|تنك\s*مغلق|تنك)/u,"صهريج"],
  [/(?:صندوق|كونتر|حافظه|حافظة|مقفول)/u,"صندوق مغلق"],
  [/(?:تريلا|تريله|تريلة)/u,"تريلا"],
  [/(?:جوانب)/u,"جوانب"]
]

// Extended freight vocabulary for Arabic WhatsApp postings.
add("السعودية",["حايل","رابغ","رأس الخير","الخفجي","الوديعة","البطحاء","الحديثة","حالة عمار","ميناء جدة الإسلامي","ميناء الملك عبدالعزيز"]);
add("سوريا",["اللاذقية","ميناء اللاذقية","ميناء طرطوس","جديدة يابوس","كسب","الراعي","جوسية"]);
add("الأردن",["العمري","المدورة","الكرامة","ميناء العقبة"]);
add("العراق",["سفوان","الشلامجة","المنذرية","إبراهيم الخليل","أم قصر","ميناء الفاو"]);
add("الإمارات",["عجمان","رأس الخيمة","الفجيرة","أم القيوين","جبل علي","ميناء جبل علي","ميناء خليفة","الغويفات"]);
add("عُمان",["صحار","ميناء صحار","الدقم","ميناء الدقم","الوجاجة","البريمي"]);
add("الكويت",["الشويخ","العبدلي","النويصيب"]);
add("قطر",["ميناء حمد","أبو سمرة"]);
add("البحرين",["ميناء خليفة بن سلمان","جسر الملك فهد"]);
add("لبنان",["ميناء بيروت","ميناء طرابلس","المصنع"]);
trailers.unshift(
 [/(?:نقل\s*(?:مواشي|اغنام|غنم|ابقار)|ناقل(?:ة|ه)?\s*(?:مواشي|اغنام|غنم))/u,"ناقلة مواشي"],
 [/(?:صهريج\s*(?:وقود|ديزل|بنزين))/u,"صهريج وقود"],
 [/(?:صهريج\s*(?:مياه|ماء)|وايت\s*(?:مياه|ماء))/u,"صهريج مياه"],
 [/(?:ناقلة\s*سيارات|حاملة\s*سيارات)/u,"ناقلة سيارات"],
 [/(?:حاوية|حاويات|كونتينر|container)/iu,"حاويات"],
 [/(?:سايلو|سيلو)/u,"سايلو"],
 [/(?:دينا|دينة|دنه)/u,"دينا"],
 [/(?:ونش|كرين)/u,"ونش"],
 [/(?:براد\s*تجميد|فريزر)/u,"براد تجميد"],
 [/(?:صاره|صارة)/u,"صارة"]
);

// Extended Arabic freight geography: unambiguous transport hubs and border points.
add("اليمن",["صنعاء","عدن","ميناء عدن","الحديدة","ميناء الحديدة","المكلا","سيئون","تعز","إب","مأرب","الوديعة اليمن","شحن اليمن","صرفيت"]);
add("السعودية",["الطائف","عرعر","القريات","سكاكا","الجوف","بيشة","وادي الدواسر","شرورة","جازان","الخفجي","النعيرية","رأس تنورة","ميناء الملك فهد الصناعي","ميناء ضباء","ميناء جازان"]);
add("الإمارات",["مصفح","مدينة خليفة الصناعية","كيزاد","خورفكان","ميناء خورفكان","ميناء راشد","ميناء الفجيرة","ميناء صقر"]);
add("سوريا",["درعا","السويداء","القنيطرة","ريف دمشق","صافيتا","جبلة","مصياف","سلمية","السلمية","القصير","النبك","يبرود","دوما","داريا","معرة النعمان","أريحا إدلب","جسر الشغور","سراقب","أعزاز","اعزاز","تل رفعت","عين العرب","كوباني","الميادين","المالكية","ديريك"]);
add("العراق",["الأنبار","الرمادي","الفلوجة","الديوانية","الناصرية","العمارة","الكوت","بعقوبة","السليمانية","حلبجة","زاخو","إبراهيم الخليل","صفوان","المنفذ الحدودي طريبيل"]);
add("الأردن",["المفرق","معان","الكرك","الطفيلة","جرش","عجلون","مادبا","السلط","الأغوار","ميناء الحاويات العقبة"]);
add("لبنان",["صيدا","صور","زحلة","بعلبك","النبطية","جونية","جبيل لبنان","عكار","بشري"]);
add("عُمان",["نزوى","صور عمان","البريمي","عبري","صحار الصناعية","ميناء صلالة"]);
add("الكويت",["الجهراء","الأحمدي","الفحيحيل","ميناء الشعيبة","ميناء مبارك الكبير"]);
add("قطر",["الريان","الوكرة","الخور","راس لفان","رأس لفان","مسيعيد","ميناء الرويس"]);
add("البحرين",["المحرق","الرفاع","سترة","الحد","ميناء سلمان"]);


// Eastern Mediterranean and Gulf freight corridor place aliases.
add("تركيا",["أنقرة","انقرة","أضنة","اضنة","هاتاي","أنطاكيا","انطاكيا","الريحانية","ريحانلي","جيلان بينار","أقجة قلعة","اقجة قلعة","أونجوبينار","اونجوبينار","جوبان بي","نصيبين","ماردين","ديار بكر","شانلي أورفا","شانلي اورفا","كهرمان مرعش","مرعش","عثمانية","عثمانيه","إسكندرون","اسكندرون","ميناء إسكندرون","ميناء مرسين","طرسوس","قونية","قونيا","بورصة","إزمير","ازمير","غازيانتپ","كركميش","جرابلس الحدود","معبر جلوة غوزو","جلوة غوزو","جيلوه غوزو"]);
add("سوريا",["باب الهوى","باب السلامة","الراعي","جرابلس","تل أبيض","رأس العين","نصيب","جديدة يابوس","الدبوسية","جوسية","التنف","البوكمال","اليعربية","ربيعة السورية","كسب","الحمام","أبو الزندين","ساحة التبادل","السويداء","القنيطرة","درعا","اللاذقية","طرطوس","حمص","حماة","دير الزور","الرقة","الحسكة","القامشلي"]);
add("الأردن",["جابر","العمري","الكرامة","المدورة","الدرة الأردنية","وادي عربة","جسر الشيخ حسين","معبر جابر","معبر العمري","معبر الكرامة","ميناء العقبة"]);
add("العراق",["القائم","طريبيل","الوليد","ربيعة","صفوان","سفوان","عرعر العراقي","الشلامجة","المنذرية","زرباطية","إبراهيم الخليل","ميناء أم قصر","ميناء الفاو","خور الزبير"]);
add("السعودية",["حايل","حائل","الحديثة","العمري السعودي","البطحاء","سلوى","جسر الملك فهد السعودي","الخفجي","الرقعي","جديدة عرعر","حالة عمار","الدرة السعودية","الوديعة السعودية","ميناء جدة الإسلامي","ميناء الملك عبدالعزيز","ميناء ينبع","ميناء ضباء","مدينة الملك عبدالله الاقتصادية","رابغ"]);
add("الإمارات",["الغويفات","البطحاء الإماراتية","حتا","الوجاجة الإماراتية","خطمة ملاحة","ميناء جبل علي","ميناء خليفة","ميناء خورفكان","ميناء الفجيرة","كيزاد","مصفح"]);
add("عُمان",["الوجاجة","حفيت","خطم الشكلة","خطمة ملاحة","وادي الجزي","الربع الخالي","ميناء صحار","ميناء صلالة","ميناء الدقم","البريمي","صحار","نزوى"]);
add("الكويت",["العبدلي","النويصيب","السالمي","ميناء الشويخ","ميناء الشعيبة"]);
add("قطر",["أبو سمرة","ابو سمرة","ميناء حمد","مسيعيد","راس لفان"]);
add("البحرين",["جسر الملك فهد","ميناء خليفة بن سلمان","ميناء سلمان","سترة"]);
add("اليمن",["الوديعة اليمن","شحن اليمن","صرفيت","ميناء عدن","ميناء الحديدة","ميناء المكلا","سيئون","مأرب","تعز","إب","صنعاء","عدن"]);

add("سوريا",["باب الهوا","باب الهوى","نصيب","نصبيض"]);
add("سوريا",["قحطانيه","قحطانية"]);
trailers.unshift([/(?:ستارتين)/u,"ستارة"],[/(?:سطحتين)/u,"سطحة"]);
function placeBoundary(text,index){
 if(index===0||!/[\p{L}]/u.test(text[index-1]))return true;
 return /(?:^|[^\p{L}])(?:ب|ل|ع)$/u.test(text.slice(0,index));
}
function canonicalPlace(city){return ({'باب الهوا':'باب الهوى','نصبيض':'نصيب','قحطانيه':'القحطانية','قحطانية':'القحطانية','الشام':'دمشق'})[city]||city;}
const cargoWords=["قطن","أقطان","اقطان","خيوط","طحين","اسمنت","إسمنت","اكلنكر","كلنكر","ملح","بندورة","طماطم","مجمدات","بيض","حديد","خشب","سكر","رز","أرز","بطاطا","بطاطس","فواكه","خضار","خضرة","حنطة","قمح","نخالة","تمور","معدات","أدوات صحية","جبنة","جبنه","فروج","دجاج","كولا","أغنام","اغنام","حاويات","خزانات","زيت","زيوت","رخام","بلاط","ورق","كرتون","أعلاف","اعلاف"];
function cleanPlace(s=""){return s.replace(/^(?:مطلوب|مطلوبه|نحتاج|تحميل|حموله|حمولة|سياره|سيارة|شاحنه|شاحنة|براد|ستاره|ستارة|سطحه|سطحة|قلاب|\d+)\s+/u,"").replace(/\s+(?:وزن|حموله|حمولة|تحميل|مطلوب|يوجد|متوفر|سلفه|سلفة|السعر|للتواصل|اتصال).*$/u,"").replace(/[،,.;:]+$/g,"").trim();}
function editDistance(a       ,b       ){
  const m=a.length,n=b.length;
  const dp=Array.from({length:n+1},(_,i)=>i);
  for(let i=1;i<=m;i++){
    let prev=dp[0]; dp[0]=i;
    for(let j=1;j<=n;j++){
      const cur=dp[j];
      dp[j]=Math.min(dp[j]+1,dp[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));
      prev=cur;
    }
  }
  return dp[n];
}
function inferCountry(place=""){
  const n=normalize(place).replace(/[^\p{L}\p{N}\s]/gu,"").trim();
  if(cityCountry.has(n)) return cityCountry.get(n)||null;
  for(const [city,country] of cityCountry){ if(n.includes(city)||city.includes(n)) return country; }
  let bestCountry=null,best=99;
  for(const [city,country] of cityCountry){
    const maxLen=Math.max(n.length,city.length);
    if(Math.abs(n.length-city.length)>2)continue;
    const d=editDistance(n,city);
    const allowed=maxLen>=8?2:1;
    if(d<=allowed&&d<best){best=d;bestCountry=country;}
  }
  return bestCountry;
}
function colloquialCottonRoute(text       ){
  const n=normalize(text);
  // Example: "سياره تحمل قطن من قحطانيه يلا تل ابيض"
  const m=n.match(/(?:سياره|سيارة|شاحنه|شاحنة)\s+(?:تحمل|تشيل|تنقل|للتحميل)\s+[^\\n]{0,55}?\\bمن\s*([\p{L} ]{2,35}?)\s+(?:يلا|الى|الي|لـ|ل)\s*([\p{L} ]{2,35})(?=$|[،,.\\n])/u);
  if(!m)return null;
  const from=cleanPlace(m[1]),to=cleanPlace(m[2]);
  return from&&to?{from_city:from,to_city:to}:null;
}
function route(text){
 const n=normalize(text), hits=[];
 for(const [city] of cityCountry){let pos=n.indexOf(city);while(pos>=0){
  if(placeBoundary(n,pos)&&(pos+city.length===n.length||!/[\p{L}]/u.test(n[pos+city.length])))hits.push({idx:pos,city});
  pos=n.indexOf(city,pos+city.length);
 }}
 hits.sort((a,b)=>a.idx-b.idx||b.city.length-a.city.length);
 const picked=[];for(const h of hits){if(!picked.some(p=>h.idx>=p.idx&&h.idx<p.idx+p.city.length))picked.push(h);}
 const unique=picked.filter((h,i)=>picked.findIndex(p=>p.city===h.city)===i);
 if(unique.length!==2)return null;
 return {from_city:canonicalPlace(unique[0].city),to_city:canonicalPlace(unique[1].city)};
}
function phone(text       ){const m=normalize(text).match(/(?:\+|00)?\d[\d\s-]{7,18}\d/g)||[];for(const raw of m){const compact=raw.replace(/[\s-]/g,"");const digits=compact.replace(/^\+/,"").replace(/^00/,"");if(digits.length>=9&&digits.length<=15)return compact.startsWith("+")?compact:compact.startsWith("00")?"+"+compact.slice(2):compact;}return null;}
function contactFromJid(jid=""){
  const raw=String(jid||"");
  if(!raw || raw.includes("@lid")) return null;
  const user=(raw.split("@")[0]||"").split(":")[0].replace(/\D/g,"");
  if(user.length<9 || user.length>15) return null;
  return "+"+user;
}
function normalizeContact(raw            ,fallback            ,country            ){
  const dial    ={"السعودية":"966","سوريا":"963","الأردن":"962","العراق":"964","الإمارات":"971","لبنان":"961","عُمان":"968","الكويت":"965","قطر":"974","البحرين":"973","تركيا":"90","مصر":"20","اليمن":"967"};
  const cc=country?dial[country]:null;
  const format=(value            )=>{
    if(!value)return null;
    let s=String(value).replace(/[\s()-]/g,"");
    if(s.startsWith("00"))s="+"+s.slice(2);
    if(s.startsWith("+"))return s;
    const digits=s.replace(/\D/g,"");
    if(cc){
      if(digits.startsWith(cc))return "+"+digits;
      if(digits.startsWith("0"))return "+"+cc+digits.replace(/^0+/,"");
      if(digits.length<=10)return "+"+cc+digits;
    }
    return digits.length>=11?"+"+digits:digits;
  };
  const rawFormatted=format(raw);
  const fallbackFormatted=format(fallback);
  if(!rawFormatted)return fallbackFormatted;
  if(fallbackFormatted){
    const rd=rawFormatted.replace(/\D/g,"");
    const fd=fallbackFormatted.replace(/\D/g,"");
    const local=rd.replace(/^0+/,"");
    if(fd.endsWith(local))return fallbackFormatted;
  }
  return rawFormatted;
}
function trailer(text       ){
  const n=normalize(text);
  const found      =[];
  for(const [re,label] of trailers){
    const m=n.match(re);
    if(m)found.push({idx:m.index??99999,label,len:m[0].length});
  }
  found.sort((a,b)=>a.idx-b.idx || b.len-a.len);
  const labels         =[];
  for(const f of found){
    if(f.label==="جوانب" && found.some(x=>x.label==="جوانب ألماني"||x.label==="جوانب عالية"))continue;
    if(!labels.includes(f.label))labels.push(f.label);
  }
  return labels.length?labels.join(" أو "):null;
}
function weight(text){const m=normalize(text).match(/(?:وزن\s*)?(\d+(?:[.,]\d+)?)\s*(?:طن|طون|تون)(?=$|[^\p{L}])/u);return m?Number(m[1].replace(",",".")):null;}
function count(text       ){
  const n=normalize(text);
  if(/(?:برادين|سيارتين|شاحنتين|سطحتين|ستارتين|قاطرتين|مقطورتين|تريلتين|قلابين|لوبدين)/u.test(n)) return 2;
  const pats=[
    /(?:براد|ستارة|ستاره|شاحنة|سيارة|تريلا|سطحة)\s*(?:عدد)\s*(\d{1,3})(?!\d)/u,
    /(?:مطلوب|نحتاج|يلزم)\s*(?:عدد\s*)?(\d{1,3})\s*(?:سياره|سيارة|شاحنه|شاحنة|براد|برادات|ستاره|ستارة|ستاير|ستائر|سطحه|سطحة|سطحات|قلاب|قلابات|جوانب|جنابي|مقطوره|مقطورة|قاطره|قاطرة|تريلا|تريله|تريلة|اورفليه|أورفليه|لوبد|لوبدات|صهريج|صهاريج)/u,
    /(\d{1,3})\s*(?:سياره|سيارة|شاحنه|شاحنة|براد|برادات|ستاره|ستارة|ستاير|ستائر|سطحه|سطحة|سطحات|قلاب|قلابات|جوانب|جنابي|مقطوره|مقطورة|قاطره|قاطرة|تريلا|تريله|تريلة|اورفليه|أورفليه|لوبد|لوبدات|صهريج|صهاريج)/u
  ];
  for(const rx of pats){const m=n.match(rx);if(m)return Math.max(1,Math.min(100,Number(m[1])));}
  return 1;
}
function cargo(text       ){const n=normalize(text);for(const w of cargoWords)if(n.includes(normalize(w)))return w;return "حمولة غير محددة";}
function trainedFreightRoute(raw       ,available        ){
 const n=normalize(raw);
 const matches      =[];
 for(const [city,country] of cityCountry){
  let start=0;
  while(start<n.length){const i=n.indexOf(city,start);if(i<0)break;
   const left=placeBoundary(n,i);const right=i+city.length===n.length||/[^\p{L}]/u.test(n[i+city.length]);
   if(left&&right)matches.push({city,country,i,len:city.length});start=i+city.length;
  }
 }
 matches.sort((a,b)=>a.i-b.i||b.len-a.len);
 const places      =[];
 for(const m of matches)if(!places.some(p=>m.i>=p.i&&m.i<p.i+p.len))places.push(m);
 if(!places.length)return null;
 const first=places[0],second=places.find(x=>x.i>first.i+first.len);
 if(second)return {from_city:canonicalPlace(first.city),to_city:canonicalPlace(second.city)};
 if(available)return {from_city:canonicalPlace(first.city),to_city:"غير محدد"};
 return null;
}
function availabilityRoute(raw       ){
  const n=normalize(raw);
  const origin=n.match(/(?:في|بال|من|عندي في)\s*(الشام|دمشق|حلب|ادلب|القامشلي|حمص|الرياض|جدة|الدمام)(?=\s|$|،|,)/u)?.[1];
  if(!origin)return null;
  const candidates=n.match(/(?:ناح|ناحية|باتجاه|الى|الي|على|لـ)\s*(ادلب|حلب|دمشق|الشام|حمص|الرياض|جدة|الدمام)/gu)||[];
  const destination=candidates.map(x=>x.match(/(ادلب|حلب|دمشق|الشام|حمص|الرياض|جدة|الدمام)$/u)?.[1]).filter(Boolean).find(x=>x!==origin);
  // Keep all alternative destinations in the original notes; use the first explicit option.
  if(!destination)return {from_city:origin==="الشام"?"دمشق":origin,to_city:"غير محدد"};
  return {from_city:origin==="الشام"?"دمشق":origin,to_city:destination==="الشام"?"دمشق":destination};
}
function parse(rawText       ,fallbackContact            =null){
  const text=String(rawText||"").trim();
  const n=normalize(text);
  const availabilityHint=/(?:فاضي|فاضية|فارغ|متاح|متوفر|موجود|جاهز|جاهزة|ستارتين|برادين|سطحتين|شاحنتين|سيارتين|(?:في|عندي|يوجد)\s+(?:\d+\s*)?(?:ستارة|ستاره|ستائر|سيارة|سيارات|شاحنة|براد|سطحة))/u.test(n);
  const vehicleRequest=/(?:مطلوب(?:ه|ة|ين)?|يلزم(?:نا)?|نحتاج|بدنا|بدي|نبي)\s*(?:عدد\s*)?(?:\d+\s*)?(?:براد|سطح|ستار|ستاير|ستائر|شاحن|سيار|تريل|قلاب|قاطر|مقطور|لوبد)/u.test(n);
  const truckAvailable=!vehicleRequest&&(availabilityHint||/(?:طالع|طالعه|جاهز|جاهزه)\s+(?:من|في|بال|بعد)/u.test(n));
  const rt=route(text)||(truckAvailable?trainedFreightRoute(text,true):null);
  const rawPh=phone(text);
  const tr=trailer(text);
  const wt=weight(text);
  const tc=count(text);
  const cg=cargo(text);
  let fc=rt?inferCountry(rt.from_city):null;
  let toc=rt?inferCountry(rt.to_city):null;
  const ph=normalizeContact(rawPh,fallbackContact,fc||toc);
  const wanted=/(?:بدنا|بدي|نبي|عايزين|عاوزين|سياره\s+تحمل|سيارة\s+تحمل|مطلوب|مطلوبه|مطلوبة|مطلوبين|نحتاج|يلزم|يلزمنا|يلزمنه|لازمنا|لزمنا|بحاجه|بحاجة|نريد|تحميل|حموله|حمولة|حمل|تنقل|نقل|برادات\s+من|براد\s+من)/u.test(n);
  const hasVehicle=Boolean(tr)||/(?:براد|برادات|سيارات|سياره|سيارة|شاحنات|شاحنه|شاحنة|تريلا|قاطره|قاطرة|مقطوره|مقطورة|ستارتين|ستارة|ستاره|برادين|سطحتين)/u.test(n);
  let confidence=0;
  if(rt)confidence+=0.42;
  if(fc&&(toc||availabilityHint))confidence+=0.18;
  if(ph)confidence+=0.16;
  if(tr||hasVehicle)confidence+=0.09;
  if(wt)confidence+=0.04;
  if(tc>1)confidence+=0.03;
  if(cg!=="حمولة غير محددة")confidence+=0.04;
  if(wanted)confidence+=0.06;
  confidence=Math.min(0.99,Number(confidence.toFixed(2)));
  const enoughFreightSignal=Boolean(tr||hasVehicle||cg!=="حمولة غير محددة");
  const publishable=Boolean(enoughFreightSignal&&(truckAvailable||wanted)&&rt&&fc&&(toc||truckAvailable)&&ph&&(truckAvailable?confidence>=0.7:confidence>=0.86));
  return {kind:truckAvailable?"truck_available":wanted?"load":"unknown",publishable,confidence,reason:publishable?null:truckAvailable?"truck_availability_incomplete":!wanted?"not_a_freight_request":!rt?"route_missing":!fc||!toc?"country_inference_missing":!ph?"contact_number_missing":!enoughFreightSignal?"freight_details_missing":"confidence_below_threshold",load:rt?{transport_scope:fc===toc?"local":"international",load_mode:"FTL",from_country:fc,from_city:rt.from_city,to_country:toc,to_city:rt.to_city==="غير محدد"?null:rt.to_city,cargo_type:cg,weight_tons:wt,required_trailer_type:tr||"غير محدد",trucks_required:tc,contact_phone:ph,contact_whatsapp:ph,posted_on_behalf:true,notes:text.slice(0,1200),status:"open",load_kind:"cargo",ad_duration_days:1,contact_visibility:"registered"}:null};
}

import makeWASocket,{useMultiFileAuthState,DisconnectReason} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import http from 'node:http';
// Restore the old runner's place learning, without importing its private replies
// or guessing missing endpoints. Existing curated entries always win.
let learnedPlaces=0,placeLearningStatus='pending';
async function learnPlacesFromPlatform(){
 if(!process.env.SUPABASE_URL||!process.env.SUPABASE_ANON_KEY){placeLearningStatus='not_configured';return;}
 const allowed=new Set([...cityCountry.values(),'مصر']);
 const candidates=new Map();
 try{
  for(let offset=0;offset<2000;offset+=1000){
   const response=await fetch(process.env.SUPABASE_URL+'/rest/v1/loads?select=from_city,from_country,to_city,to_country&order=published_at.desc&limit=1000&offset='+offset,{signal:AbortSignal.timeout(10000),headers:{apikey:process.env.SUPABASE_ANON_KEY,Authorization:'Bearer '+process.env.SUPABASE_ANON_KEY}});
   if(!response.ok)throw new Error('HTTP '+response.status);
   const rows=await response.json();
   if(!Array.isArray(rows))throw new Error('Invalid place response');
   for(const row of rows)for(const [city,country] of [[row.from_city,row.from_country],[row.to_city,row.to_country]]){
    const name=normalize(city||'');
    if(!allowed.has(country)||name.length<3||name.length>45||!/^\p{L}[\p{L} ]+$/u.test(name)||/غير محدد|غير مذكور|حسب الاتصال|عدة مدن|جميع|محافظات|مطلوب|تحميل|حمول/u.test(name)||name.split(' ').length>5||cityCountry.has(name))continue;
    if(!candidates.has(name))candidates.set(name,new Set());
    candidates.get(name).add(country);
   }
   if(rows.length<1000)break;
  }
  for(const [city,countries] of candidates)if(countries.size===1){cityCountry.set(city,[...countries][0]);learnedPlaces++;}
  placeLearningStatus='ready';
  console.log('Legacy place learning restored',JSON.stringify({learnedPlaces,totalKnownPlaces:cityCountry.size}));
 }catch(e){placeLearningStatus='failed';console.warn('Place learning unavailable; using curated dictionary',String(e));}
}
function getText(message){
 let msg=message;
 for(let i=0;i<8&&msg;i++){
  const inner=msg.ephemeralMessage?.message||msg.viewOnceMessage?.message||msg.viewOnceMessageV2?.message||msg.viewOnceMessageV2Extension?.message||msg.documentWithCaptionMessage?.message;
  if(!inner)break;
  msg=inner;
 }
 return String(msg?.conversation||msg?.extendedTextMessage?.text||msg?.imageMessage?.caption||msg?.videoMessage?.caption||msg?.documentMessage?.caption||'').trim();
}
let ingestConnectionStatus='pending';
async function verifyIngestConnection(){
 if(!process.env.SUPABASE_URL||!process.env.SUPABASE_ANON_KEY||!process.env.TRUCKLINK_INGEST_TOKEN){ingestConnectionStatus='not_configured';return;}
 try{
  // The existing RPC validates credentials before invalid_text, and rejects
  // an empty text before any INSERT. This probe cannot publish or store an ad.
  const response=await fetch(process.env.SUPABASE_URL+'/rest/v1/rpc/ingest_whatsapp_pilot',{method:'POST',signal:AbortSignal.timeout(10000),headers:{apikey:process.env.SUPABASE_ANON_KEY,Authorization:'Bearer '+process.env.SUPABASE_ANON_KEY,'content-type':'application/json'},body:JSON.stringify({p_token:process.env.TRUCKLINK_INGEST_TOKEN,p_group_jid:'120363431703780865@g.us',p_message_id:'connection-probe',p_sender_hash:'connection-probe',p_text:'',p_received_at:new Date().toISOString(),p_parsed:{publishable:false},p_confidence:0,p_publish:false})});
  const result=await response.json();
  ingestConnectionStatus=result.code==='P0001'&&result.message==='invalid_text'?'ready':result.message==='unauthorized'?'ingest_token_rejected':'gateway_or_rpc_error';
  console.log('Ingest connection check',JSON.stringify({status:ingestConnectionStatus,httpStatus:response.status}));
 }catch{ingestConnectionStatus='unavailable';console.warn('Ingest connection check unavailable');}
}
await Promise.all([learnPlacesFromPlatform(),verifyIngestConnection()]);
const dir='/data/wa-session-secondary';
await mkdir(dir,{recursive:true});
let qr='',status='starting';
let resolvedChannelJid='';
let groupCount=null,groupCheckError='';
let activeSocket=null,reconnectTimer=null;
let receivedGroupMessages=0,publishedLoads=0,publishedTrucks=0,publishedChannel=0,lastReceivedAt=null,lastPublishError='';
const processedMessages=new Map();
const publishedFreightTexts=new Map(),inFlightFreightTexts=new Set();
const recentMessages=new Map();
// Groups 1–9 excluded by the owner: exchange rates and personal business, not freight.
const EXCLUDED_GROUPS=new Set(["120363285533629337@g.us","120363032467180231@g.us","120363390071970492@g.us","120363246703383152@g.us","120363430110878767@g.us","120363165708973439@g.us","120363258441959550@g.us","120363306190092623@g.us","120363433294574615@g.us"]);
let monitoredGroupCount=null;
function rememberMessage(m){if(!m.message)return;const k=String(m.key?.remoteJid||'')+':'+String(m.key?.id||'');recentMessages.set(k,m.message);if(recentMessages.size>250)recentMessages.delete(recentMessages.keys().next().value);}

const CHANNEL_INVITE='0029Vb88HmiK0IBl4La1aC1Q';

let manualPublication={status:'none'};
async function publishRequestedChannelPost(sock){
 const raw=process.env.MANUAL_CHANNEL_POST;
 if(!raw)return;
 let task;
 try{task=JSON.parse(raw);}catch{console.error('Manual channel post invalid JSON');return;}
 if(!/^[a-zA-Z0-9_-]{5,100}$/.test(task.id||'')||typeof task.text!=='string'||!task.text.trim()||task.text.length>4000||task.channelInvite!==CHANNEL_INVITE){console.error('Manual channel post invalid task');return;}
 if(!resolvedChannelJid.endsWith('@newsletter'))return;
 const receipt='/data/manual-channel-post-'+task.id+'.json';
 try{await writeFile(receipt,JSON.stringify({id:task.id,status:'sending',at:new Date().toISOString()}),{flag:'wx'});}
 catch(e){if(e.code==='EEXIST'){try{manualPublication=JSON.parse(await readFile(receipt,'utf8'));}catch{}return;}throw e;}
 manualPublication={id:task.id,status:'sending'};
 try{
   const sent=await sock.sendMessage(resolvedChannelJid,{text:task.text});
   if(!sent?.key?.id)throw new Error('No WhatsApp message ID returned');
   manualPublication={id:task.id,status:'sent',messageId:sent.key.id,at:new Date().toISOString()};
   await writeFile(receipt,JSON.stringify(manualPublication));
   publishedChannel++;
   console.log('Requested channel post sent',JSON.stringify({...manualPublication,channel:resolvedChannelJid}));
 }catch(e){
   manualPublication={id:task.id,status:'failed_or_unconfirmed',error:String(e),at:new Date().toISOString()};
   await writeFile(receipt,JSON.stringify(manualPublication));
   console.error('Requested channel post failed',JSON.stringify(manualPublication));
 }
}

async function connect(){
 if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null;}
 const {state,saveCreds}=await useMultiFileAuthState(dir);
 const sock=makeWASocket({auth:state,printQRInTerminal:false,markOnlineOnConnect:false,syncFullHistory:false,shouldSyncHistoryMessage:()=>false,getMessage:async(key)=>recentMessages.get(String(key?.remoteJid||'')+':'+String(key?.id||''))});
 activeSocket=sock;
 sock.ev.on('creds.update',saveCreds);
 sock.ev.on('connection.update',({connection,lastDisconnect,qr:nextQR})=>{
   if(nextQR){qr=nextQR;status='scan';}
   if(connection==='open'){qr='';status='connected';(async()=>{try{const metadata=await sock.newsletterMetadata('invite',CHANNEL_INVITE);resolvedChannelJid=String(metadata?.id||'');console.log('TruckLink channel resolved',Boolean(resolvedChannelJid));await publishRequestedChannelPost(sock);}catch(err){console.error('Channel resolution pending',String(err));}})();(async()=>{try{const invite='ENfU2aCppVa545mZW7W5Y3';const groups=await sock.groupFetchAllParticipating();groupCount=Object.keys(groups).length;monitoredGroupCount=Object.keys(groups).filter(jid=>!EXCLUDED_GROUPS.has(jid)).length;console.log('Group monitoring policy',JSON.stringify({excludedGroups:EXCLUDED_GROUPS.size,monitoredGroupCount}));groupCheckError='';console.log('Joined WhatsApp group count',groupCount);console.log('Joined WhatsApp group names',JSON.stringify(Object.values(groups).map(g=>({name:g.subject||'بدون اسم',id:g.id}))));const existing=Object.values(groups).find(g=>g?.inviteCode===invite||g.id==='120363431703780865@g.us');if(existing){console.log('Already in target group',existing.subject);return;}const id=await sock.groupAcceptInvite(invite);console.log('Group invitation accepted',id);}catch(e){groupCheckError=String(e);console.error('Group join attempt failed',String(e));}})();}
   if(connection==='close'){qr='';status='disconnected';const code=lastDisconnect?.error?.output?.statusCode;console.warn('WhatsApp disconnected',code);if(activeSocket===sock&&code!==DisconnectReason.loggedOut&&!reconnectTimer){reconnectTimer=setTimeout(()=>{reconnectTimer=null;connect().catch(e=>console.error('Reconnect error',String(e)));},7000);}}
 });
 // Read freight advertisements from joined groups; never message individuals.
 sock.ev.on('messages.upsert',async({messages,type})=>{
   if(type!=='notify'&&type!=='append')return;
   for(const m of messages){
     let freightKey=null;
     try{
       const jid=String(m.key?.remoteJid||'');
       if(!jid.endsWith('@g.us')||m.key?.fromMe||EXCLUDED_GROUPS.has(jid))continue;
       rememberMessage(m);
       if(!m.message)continue;
       const stamp=Number(m.messageTimestamp||0)*1000;
       if(stamp && Date.now()-stamp>24*60*60*1000)continue;
       const cacheKey=jid+':'+m.key.id;
       if(processedMessages.has(cacheKey))continue;
       receivedGroupMessages++;lastReceivedAt=new Date().toISOString();
       console.log('Group message received',JSON.stringify({group:jid,id:m.key.id}));
       const text=getText(m.message);
       if(!text)continue;
       if(!process.env.SUPABASE_URL||!process.env.SUPABASE_ANON_KEY||!process.env.TRUCKLINK_INGEST_TOKEN){console.log('Publishing credentials missing');continue;}
       const sender=m.key.participantAlt||m.key.participant||'';
       const finalParsed=parse(text,contactFromJid(sender));
       const shouldPublish=finalParsed.publishable&&(finalParsed.kind!=='load'||finalParsed.confidence>=0.86);
       if(!shouldPublish){console.log('Freight skipped',JSON.stringify({id:m.key.id,kind:finalParsed.kind,reason:finalParsed.reason||'low_confidence'}));if(finalParsed.kind==='unknown')continue;}
       if(shouldPublish){
         const key=createHash('sha256').update(normalize(text).replace(/[\p{P}\p{S}\s]+/gu,' ').trim()+'|'+finalParsed.load.contact_phone).digest('hex');
         for(const [k,ts] of publishedFreightTexts)if(Date.now()-ts>24*60*60*1000)publishedFreightTexts.delete(k);
         if(publishedFreightTexts.has(key)||inFlightFreightTexts.has(key)){console.log('Repeated forwarded freight skipped');continue;}
         freightKey=key;inFlightFreightTexts.add(key);
       }
       // Retain rejected freight for diagnosis via the existing authenticated RPC;
       // never publish it or send a clarification message to the individual.
       const isTruck=shouldPublish&&finalParsed.kind==='truck_available';
       const body={p_token:process.env.TRUCKLINK_INGEST_TOKEN,p_group_jid:jid,p_message_id:m.key.id,p_sender_hash:createHash('sha256').update(String(sender)).digest('hex').slice(0,24),p_text:text.slice(0,4000),p_received_at:new Date(Number(m.messageTimestamp||Date.now()/1000)*1000).toISOString(),p_parsed:finalParsed,p_confidence:finalParsed.confidence,p_publish:shouldPublish};
       if(isTruck)delete body.p_publish;
       const rpc=isTruck?'publish_whatsapp_truck_available':'ingest_whatsapp_pilot';
       const response=await fetch(process.env.SUPABASE_URL+'/rest/v1/rpc/'+rpc,{method:'POST',signal:AbortSignal.timeout(20000),headers:{apikey:process.env.SUPABASE_ANON_KEY,Authorization:'Bearer '+process.env.SUPABASE_ANON_KEY,'content-type':'application/json'},body:JSON.stringify(body)});
       const result=await response.text();
       if(!response.ok){lastPublishError='Ingest HTTP '+response.status;console.error('Ingest failed',response.status,result.slice(0,300));continue;}
       const outcome=JSON.parse(result);
       console.log('Freight ingest result',JSON.stringify({id:m.key.id,...outcome}));
       if(!shouldPublish||outcome.duplicate===true){processedMessages.set(cacheKey,Date.now());if(processedMessages.size>5000)processedMessages.delete(processedMessages.keys().next().value);continue;}
       if(outcome.published!==true)continue;
       if(freightKey){publishedFreightTexts.set(freightKey,Date.now());if(publishedFreightTexts.size>5000)publishedFreightTexts.delete(publishedFreightTexts.keys().next().value);}
       processedMessages.set(cacheKey,Date.now());
       if(processedMessages.size>5000)processedMessages.delete(processedMessages.keys().next().value);
       if(isTruck)publishedTrucks++;else publishedLoads++;
       lastPublishError='';
       const channel=String(resolvedChannelJid||process.env.TARGET_CHANNEL_JID||'');
       if(channel.endsWith('@newsletter')){
         const sent=await sock.sendMessage(channel,{text:(isTruck?'🚛 شاحنة متاحة':'🚛 إعلان شحن جديد')+'\n'+text.slice(0,1200)+'\n📱 '+finalParsed.load.contact_phone+'\n🌐 https://trucklink-mena.netlify.app/'});
         if(sent?.key?.id){publishedChannel++;console.log('Channel publication sent',JSON.stringify({sourceId:m.key.id,channel,messageId:sent.key.id}));}
       }else{lastPublishError='Channel unresolved';console.error(lastPublishError);}
     }catch(e){lastPublishError=String(e);console.error('Freight processing error',String(e));}
     finally{if(freightKey)inFlightFreightTexts.delete(freightKey);}
   }
 });
 // No automatic private or group replies.
}
connect().catch(e=>{status='error';console.error('pairing connection failed',e.message);});
http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/health'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({revision:'supabase-connection-fix-20261009',ingestConnectionStatus,learnedPlaces,placeLearningStatus,knownPlaces:cityCountry.size,manualPublication,excludedGroups:EXCLUDED_GROUPS.size,monitoredGroupCount,status,privateMessaging:false,receivedGroupMessages,publishedLoads,publishedTrucks,publishedChannel,channelResolved:!!resolvedChannelJid,groupCount,lastReceivedAt}));return;}
 const token=process.env.PAIRING_TOKEN;
 if(!token||u.searchParams.get('token')!==token){res.writeHead(403);res.end('Forbidden');return;}
 res.setHeader('Cache-Control','no-store');
 if(u.pathname==='/qr'&&qr){res.writeHead(200,{'Content-Type':'image/svg+xml'});res.end(await QRCode.toString(qr,{type:'svg'}));return;}
 res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({revision:'supabase-connection-fix-20261009',ingestConnectionStatus,learnedPlaces,placeLearningStatus,knownPlaces:cityCountry.size,manualPublication,excludedGroups:EXCLUDED_GROUPS.size,monitoredGroupCount,receivedGroupMessages,publishedLoads,publishedTrucks,publishedChannel,lastReceivedAt,lastPublishError,status,qrAvailable:!!qr,privateMessaging:false,channelResolved:!!resolvedChannelJid,groupCount,groupCheckError,postingConfigured:!!(process.env.SUPABASE_URL&&process.env.TRUCKLINK_INGEST_TOKEN)}));
}).listen(Number(process.env.PORT||3000),'0.0.0.0');


