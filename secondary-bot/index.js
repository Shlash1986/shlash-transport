import {createChannelGroupRelay,isRelayText} from './channel-group-relay.mjs';
import {socketLogger} from './safe-logging.mjs';
import {createDeliveryStore} from './delivery-store.mjs';
import {createHash} from 'node:crypto';
import {createChannelReader,acceptsFreightSource,isChannelJid,channelMessageId} from './channel-reader.mjs';
import {extractFreightAd,getAIStatus,isFreightCandidate} from './ai-runtime.mjs';
import {createPriorityMessageQueue} from './priority-queue.mjs';
import {createBufferRecovery,definitelyUnsent} from './connection-recovery.mjs';
const ARABIC_DIGITS                        = { "٠":"0","١":"1","٢":"2","٣":"3","٤":"4","٥":"5","٦":"6","٧":"7","٨":"8","٩":"9","۰":"0","۱":"1","۲":"2","۳":"3","۴":"4","۵":"5","۶":"6","۷":"7","۸":"8","۹":"9" };
function normalize(input=""){ return String(input).replace(/[٠-٩۰-۹]/g,d=>ARABIC_DIGITS[d]||d).replace(/[ـ\u064B-\u065F\u0670]/g,"").replace(/ی/g,"ي").replace(/ک/g,"ك").replace(/ہ/g,"ه").replace(/[إأآ]/g,"ا").replace(/ى/g,"ي").replace(/ؤ/g,"و").replace(/ئ/g,"ي").replace(/\s+/g," ").trim(); }
const cityCountry = new Map               ();
function add(c       , cities         ){ for(const city of cities) cityCountry.set(normalize(city),c); }
add("سوريا",["دمشق","الشام","شام","عين عاروس","عين عروس","عين العروس","حلب","إدلب","ادلب","سرمدا","باب الهوى","معبر باب الهوى","باب السلامة","باب سلامة","باب سلامه","باب السلامه","باب السلام","معبر باب السلام","جرابلس","الباب","الرقة","الحسكة","القامشلي","تدمر","حمص","حماة","حماه","طرطوس","بانياس","دير الزور","ديرالزور","اليعربية","اليعروبية","ساحة التبادل اليعربية","ساحة تبادل اليعربية","التنف","البوكمال","تل أبيض","رأس العين","خان العسل","نصيب","معبر نصيب","الدرباسية","رميلان","منبج","عفرين","عدرا","القحطانية","تل تمر","تل حميس"]);
add("الأردن",["عمان","عمّان","جابر","معبر جابر","الرمثا","الزرقاء","العقبة","المعبر الشمالي","الشيخ حسين","سحاب","الأزرق","إربد","اربد"]);
add("العراق",["بغداد","البصرة","الموصل","موصل","أربيل","اربيل","كركوك","ربيعة","القائم","كبيسة","الوليد","طريبيل","زرباطية","سنجار","بيجي","النجف","تكريت","سامراء","دهوك","السماوة","الحلة"]);
add("السعودية",["الرياض","جدة","جده","الدمام","الجبيل","جبيل","جيزان","جازان","مكة","مكه","المدينة","المدينه","تبوك","خميس مشيط","القصيم","قصيم","سدير","صعبر","ينبع","الطائف","حائل","بريدة","بريده","عنيزة","عنيزه","الخبر","الاحساء","الأحساء","نجران","أبها","ابها","حفر الباطن","حفرالباطن","رنية","الخرمة","أمالا","امالا","طريق الخرج","رابغ","ميناء رابغ"]);
add("الإمارات",["دبي","أبوظبي","ابوظبي","الشارقة","الشارقه","العين"]);
add("لبنان",["بيروت","طرابلس لبنان","البقاع","شتورا"]);
add("عُمان",["مسقط","صلالة","صلاله"]);
add("الكويت",["الكويت"]); add("قطر",["الدوحة","الدوحه"]); add("البحرين",["المنامة","المنامه"]);
add("تركيا",["مرسين","غازي عنتاب","عنتاب","إسطنبول","اسطنبول","أورفا","اورفا","كيليس"]);

// Syrian freight hubs and common spelling used in dispatch messages.
add("سوريا",["حسيا","حسياء","سلوك"]);
add("السعودية",["ميناء جدة","المزاحمية","المزاحميه","جدة الخمرة","جده الخمره","جده ساحه بالخمره","جدة ساحة بالخمرة"]);
const trailers                   = [
  [/(?:سلطحة|سلطحه)/u,"سطحة"],
  [/(?:قاطره\s*(?:و)?مقطوره|قاطرة\s*(?:و)?مقطورة|قاطره\s+مقطوره|قاطرة\s+مقطورة)/u,"قاطرة مقطورة"],
  [/(?:راس\s*و?دنب|رأس\s*و?ذنب|راس\s*وذنب|رأس\s*وذنب)/u,"رأس وذنب"],
  [/(?:اورفليه|أورفليه|اورفليه|أورفلية|اورفلية|اوفليه|أوفليه|اورفلي|أورفلي)/u,"أورفليه"],
  [/(?:براد|برادات|ثلاجه|ثلاجة|reefer)/iu,"براد"],
  [/(?:بوكس\s*مبرد)/u,"بوكس مبرد"],
  [/(?:ستارات|ستاره|ستارة|ستايرر|ستاير|ستائر|اورفلية\s*ستارة)/u,"ستارة"],
  [/(?:سطحه|سطحة|سطحا|سطحات|سطحيه|سطحية|flatbed)/iu,"سطحة"],
  [/(?:كشف\s*جنب)/u,"كشف جنب"],
  [/(?:جوانب\s*الماني|جوانب\s*ألماني)/u,"جوانب ألماني"],
  [/(?:جوانب\s*عاليه|جوانب\s*عالية)/u,"جوانب عالية"],
  [/(?:جنابي|اجناب|أجناب|جناب|صينيه\s*جنابي|صينية\s*جنابي)/u,"جنابي"],
  [/(?:قاطرات)/u,"قاطرة"],
  [/(?:مقطورات|مقطوره|مقطورة)/u,"مقطورة"],
  [/(?:صواني)/u,"صواني"],
  [/(?:قلاب|قلابات|غلاب)/u,"قلاب"],
  [/(?:^|[^\p{L}])(?:لوبد(?:ات|ين)?|لوابد|لوايد)(?=$|[^\p{L}])/u,"لوبد"],
  [/(?:صهريج|صهاريج|تنك\s*مغلق|تنك)/u,"صهريج"],
  [/(?:صندوق|كونتر|حافظه|حافظة|مقفول)/u,"صندوق مغلق"],
  [/(?:تريلا|تريله|تريلة)/u,"تريلا"],
  [/(?:جوانب)/u,"جوانب"]
]

// Extended freight vocabulary for Arabic WhatsApp postings.
add("السعودية",["حايل","طريف","رابغ","رأس الخير","الخفجي","الوديعة","البطحاء","الحديثة","حالة عمار","ميناء جدة الإسلامي","ميناء الملك عبدالعزيز"]);
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
 [/(?:حاوية|حاويات|كونتينر|كونتينرات|كونتير|كونتيرات|كنتنر|كنتنرات|كونتنر|كونتنرات|container)/iu,"حاويات"],
 [/(?:سايلو|سيلو)/u,"سايلو"],
 [/(?:^|[^\p{L}])(?:دينا|دينة|دنه)(?=$|[^\p{L}])/u,"دينا"],
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

add("سوريا",["باب الهوا","باب الهوى","باب الهواء","معبر باب الهواء","نصيب","نصبيض"]);
add("سوريا",["حما"]);
add("سوريا",["لاذقيه","اللاذقيه"]);
add("السعودية",["العلا"]);
// Places in rejected freight ads; compound origins retain the specific loading village.
add("سوريا",["عزاز","العشارة","معرة مصرين","معره مصرين","شمارين","أعزاز شمارين","اعزاز شمارين"]);
add("السعودية",["عفيف","الخرج"]);
add("سوريا",["قحطانيه","قحطانية"]);
add("سوريا",["باب لهوى","باب لهوا","باب لهوي","باب الهوه","اليعروبيه","اليعربيه","سوق الصالحية بدير الزور"]);
trailers.unshift([/(?:^|[^\p{L}])ستار(?=$|[^\p{L}])/u,"ستارة"],[/(?:ستارتين)/u,"ستارة"],[/(?:سطحتين)/u,"سطحة"]);
trailers.unshift([/(?:^|[^\p{L}])تك(?=$|[^\p{L}])/u,"تك"],[/(?:^|[^\p{L}])انتر(?=$|[^\p{L}])/u,"انتر"]);
// Verified spellings from rejected dispatch messages.
add("سوريا",["سرمده","الدانا","دانا"]);
add("السعودية",["ميناء ينبع التجاري","ميناء نيوم","ملهم","الدوادمي","الدوادمى"]);
add("مصر",["القطامية","القطاميه","الإسكندرية","اسكندريه","مطار القاهرة","مطار القاهره","مطار القاهره قرية البضائع"]);
add("السعودية",["القصيم بريدة","القصيم بريده"]);
trailers.unshift([/(?:^|[^\p{L}])ستارا(?=$|[^\p{L}])/u,"ستارة"]);
function placeBoundary(text,index){
 // "باب" is a border/door word, never the Yemeni city "إب" with a ب prefix.
 if(index>0 && text.slice(index-1,index+2)==='باب' && (index+2===text.length||!/[\p{L}]/u.test(text[index+2])))return false;
 if(index===0||!/[\p{L}]/u.test(text[index-1]))return true;
 return /(?:^|[^\p{L}])(?:ب|ل|ع)$/u.test(text.slice(0,index));
}
function canonicalPlace(city){if(city==='القصيم بريدة'||city==='القصيم بريده')return 'بريدة';if(city==='باب الهواء'||city==='معبر باب الهواء')return 'باب الهوى';return ({'جده ساحه بالخمره':'جدة الخمرة','جدة ساحة بالخمرة':'جدة الخمرة','جده الخمره':'جدة الخمرة','المزاحميه':'المزاحمية','باب سلامة':'باب السلامة','باب سلامه':'باب السلامة','باب السلامه':'باب السلامة','الدوادمي':'الدوادمي','الدوادمى':'الدوادمي','سرمده':'سرمدا','دانا':'الدانا','حسيا':'حسياء','عزاز':'أعزاز','اعزاز':'أعزاز','موصل':'الموصل','حايل':'حائل','حما':'حماة','حماه':'حماة','لاذقيه':'اللاذقية','اللاذقيه':'اللاذقية','باب لهوى':'باب الهوى','باب لهوا':'باب الهوى','باب لهوي':'باب الهوى','باب الهوا':'باب الهوى','باب الهوي':'باب الهوى','باب الهوه':'باب الهوى','اليعروبيه':'اليعربية','اليعربيه':'اليعربية','اليعروبية':'اليعربية','نصبيض':'نصيب','قحطانيه':'القحطانية','قحطانية':'القحطانية','الشام':'دمشق','شام':'دمشق','جده':'جدة','حفرالباطن':'حفر الباطن','مكه':'مكة','المدينه':'المدينة','الاحساء':'الأحساء','ابها':'أبها'})[city]||city;}
// Expand the contracted destination prefix only for geographical matching:
// للباب -> لالباب, للشام -> لالشام. Keep the original advertisement intact.
function geographyText(text){return normalize(text).replace(/(^|[^\p{L}])علتنف(?=$|[^\p{L}])/gu,'$1على التنف').replace(/(^|[^\p{L}])قامشلي(?=$|[^\p{L}])/gu,'$1القامشلي').replace(/(^|[^\p{L}])بلقامشلي(?=$|[^\p{L}])/gu,'$1بالقامشلي').replace(/(^|[^\p{L}])بل(?:يعرب|يعروب)(?:ية|يه)(?=$|[^\p{L}])/gu,'$1باليعربية').replace(/(^|[^\p{L}])لل(?=[\p{L}])/gu,'$1لال');}
function freightPriority(text){
 const n=geographyText(text);
 if(/\b(?:syria|syrian|damascus|aleppo|homs|hama|tartus|latakia|idlib|qamishli)\b/iu.test(n))return 0;
 if(/(?:^|[^\p{L}])(?:ل|ب)?(?:سوريا|سورية|سوريه|سوري|السوريه|السورية|السوري)(?=$|[^\p{L}])/u.test(n))return 0;
 for(const [city,country] of cityCountry){
  if(country!=='سوريا')continue;
  let at=n.indexOf(city);
  while(at>=0){if(placeBoundary(n,at)&&(at+city.length===n.length||!/[\p{L}]/u.test(n[at+city.length])))return 0;at=n.indexOf(city,at+city.length);}
 }
 return 1;
}
const cargoWords=["مواد أولية","مواد اولية","مواد أوليه","مواد اوليه","انترلوك","مياه","اكياس جامبو","حمضيات","برتقال","ليمون","بطاطة","قطن","أقطان","اقطان","خيوط","طحين","اسمنت","إسمنت","اكلنكر","كلنكر","ملح","بندورة","طماطم","مجمدات","بيض","حديد","خشب","سكر","رز","أرز","بطاطا","بطاطس","فواكه","خضار","خضرة","حنطة","قمح","نخالة","تمور","معدات","أدوات صحية","جبنة","جبنه","فروج","دجاج","كولا","أغنام","اغنام","حاويات","خزانات","زيت","زيوت","رخام","بلاط","ورق","كرتون","أعلاف","اعلاف"];
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
const countryAliases=new Map([
 ['السعودية','السعودية'],['السعوديه','السعودية'],['المملكة العربية السعودية','السعودية'],
 ['قطر','قطر'],['الاردن','الأردن'],['سوريا','سوريا'],['العراق','العراق'],
 ['الامارات','الإمارات'],['الامارات العربية المتحدة','الإمارات'],['لبنان','لبنان'],
 ['سلطنة عمان','عُمان'],['الكويت','الكويت'],['البحرين','البحرين'],
 ['تركيا','تركيا'],['مصر','مصر'],['اليمن','اليمن']
]);
function explicitEndpoint(value){
 const n=normalize(value).replace(/^[\s،,:-]+|[\s،,:.-]+$/gu,'');
 if(countryAliases.has(n))return {city:'غير محددة',country:countryAliases.get(n)};
 if(cityCountry.has(n))return {city:canonicalPlace(n),country:cityCountry.get(n)};
 // A country qualifier is descriptive, not a third stop on the route.
 for(const [alias,country] of countryAliases){
  for(const suffix of [' '+alias,' في '+alias]){
   if(!n.endsWith(suffix))continue;
   const city=n.slice(0,-suffix.length).trim();
   if(cityCountry.get(city)===country)return {city:canonicalPlace(city),country};
  }
 }
 return null;
}
function routeLinesText(raw){
 return String(raw||'').replace(/\r?\n\s*(?=(?:الى|إلى|الي|الی)\s)/gu,' ').split(/\r?\n/).map(line=>line.replace(/(من\s+.+?)\s+لل([\p{L} ]+)(?=$)/u,'$1 إلى ال$2')).join('\n');
}
function explicitRoute(text){
 const routes=[];
 text=routeLinesText(text);
 for(const line of String(text||'').split(/[\r\n]+/u)){
  const n=normalize(line.replace(/[\p{S}\uFE0F*]/gu,' '));
  const match=n.match(/(?:^|[^\p{L}])من\s+(.+?)\s+(?:الى|الي|على|علي|باتجاه|ع)\s+(.+)$/u);
  if(!match)continue;
  const origin=match[1].replace(/^(?:الساحة|الساحه)\s+في\s+/u,'').replace(/\s+ساحة$/u,'');
  const from=explicitEndpoint(origin);
  const destination=match[2].split(/\s+(?:الحمولة|الحموله|حمولة|حموله|وزن|الوزن|للتواصل|رقم|هاتف|تحميل|ذهاب|طريق|عبر|ترانزيت|ساحة|ساحه)(?=\s|:|$)|[،,;]|\s+(?=[+\d])/u)[0].trim();
  const to=explicitEndpoint(destination);
  if(from&&to)routes.push({from_city:from.city,from_country:from.country,to_city:to.city,to_country:to.country});
 }
 if(routes.length===1)return routes[0];
 return null;
}
function labeledRoute(text){
 const fields={from:[],to:[]};
 for(const raw of String(text||'').split(/[\r\n]+/u)){
  const line=normalize(raw.replace(/[\p{S}\uFE0F*]/gu,' '));
  const m=line.match(/^(?:(?:مكان|موقع)\s+)?(التحميل|تحميل|التنزيل|تنزيل|التفريغ|تفريغ)\s*[:：-]\s*(.+)$/u);
  if(m)fields[/تحميل/u.test(m[1])?'from':'to'].push(explicitEndpoint(m[2]));
 }
 const present=fields.from.length||fields.to.length;
 if(!present)return undefined;
 if(fields.from.length!==1||fields.to.length!==1||!fields.from[0]||!fields.to[0])return null;
 const [from]=fields.from,[to]=fields.to;
 return {from_city:from.city,from_country:from.country,to_city:to.city,to_country:to.country};
}
// Dispatchers may name the delivery city before the loading city.
function reversedFreightRoute(text){
 const n=normalize(text);
 const m=n.match(/(?:^|[^\p{L}])(?:احمال|حمولات|حموله|حمولة|حمل|تحميل)\s+(?:الى|الي|على|علي|ع)\s+(.+?)\s+من\s+(.+)$/u);
 if(!m)return undefined;
 const to=explicitEndpoint(m[1]),from=explicitEndpoint(m[2].split(/\s+(?:للتواصل|هاتف|رقم)(?=\s|:)|\s+(?=[+\d])/u)[0]);
 if(!from||!to)return null;
 return {from_city:from.city,from_country:from.country,to_city:to.city,to_country:to.country};
}
function availableDestinationCountry(text){
 const m=normalize(text).match(/(?:^|[^\p{L}])(?:احمال|حمولات|حمل|حموله|حمولة)\s+(?:الى\s+|الي\s+|على\s+|علي\s+|ل)\s*([\p{L} ]+)$/u);
 const endpoint=m&&explicitEndpoint(m[1]);
 return endpoint?.city==='غير محددة'?endpoint.country:null;
}
// Keep a same-origin destination list in one ad, preserving the total truck count.
function multiDestinationRoute(text){
 const lines=String(text||'').split(/[\r\n]+/u).map(normalize).filter(Boolean);
 let from=null, destinations=[], collecting=false;
 for(const line of lines){
  const m=line.match(/(?:^|\s)(?:و)?من\s+(.+?)\s+(?:الى|الي|على|علي)\s*[:：]?\s*(.*)$/u);
  if(m){
   const origin=explicitEndpoint(m[1]);
   if(!origin||from&&(origin.city!==from.city||origin.country!==from.country))return null;
   from=origin;collecting=true;
   if(m[2]){const to=explicitEndpoint(m[2]);if(!to)return null;destinations.push(to);}
  }else if(collecting){
   const to=explicitEndpoint(line);
   if(to)destinations.push(to);
   else if(/^(?:الوزن|وزن|التواصل|للتواصل|التحميل|الحموله|الحمولة|\+?\d)/u.test(line))collecting=false;
   else return null;
  }
 }
 if(!from||destinations.length<2||destinations.length>8||!destinations.every(d=>d.country===destinations[0].country))return null;
 return {from_city:from.city,from_country:from.country,to_city:[...new Set(destinations.map(d=>d.city))].join(' / '),to_country:destinations[0].country};
}
// Read repeated origin-to-destination lines as one multi-stop freight request.
// Only accept fully known places; never guess an unknown destination.
function repeatedOriginRoute(text){
 const rows=String(text||'').split(/[\r\n]+/u).map(line=>normalize(line).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'').trim());
 const pairs=[];
 for(const line of rows){
  const m=line.match(/^من\s+(.+?)\s+(?:الى|الي)\s+(.+)$/u);
  if(!m)continue;
  const from=explicitEndpoint(m[1]),to=explicitEndpoint(m[2]);
  if(!from||!to)return null;
  pairs.push({from,to});
 }
 if(pairs.length<2||pairs.length>12)return null;
 const first=pairs[0];
 if(!pairs.every(p=>p.from.city===first.from.city&&p.from.country===first.from.country&&p.to.country===first.to.country))return null;
 return {from_city:first.from.city,from_country:first.from.country,to_city:[...new Set(pairs.map(p=>p.to.city))].join(' / '),to_country:first.to.country};
}
function countryOnlyDestinationRoute(text){
 const n=normalize(text);
 const match=n.match(/(?:^|\s)من\s+([^\n،,]{2,45}?)\s+(?:الى|الي|على|ع)\s+([^\n،,]{2,45})/u);
 if(!match)return null;
 const from=explicitEndpoint(match[1].trim());
 const destination=match[2].trim();
 const to=explicitEndpoint(destination);
 if(!from||!to||to.city!=='غير محددة')return null;
 return {from_city:from.city,from_country:from.country,to_city:'غير محددة',to_country:to.country};
}
// A loading label determines the origin even when the destination is written
// first. A crossing mentioned between them remains transit, not a second job.
// Return null on conflicting/unlabelled places so ordinary fallback cannot
// accidentally turn one of those places into the delivery destination.
function loadingTransitRoute(text){
 const n=geographyText(text);
 if(!/(?:^|[^\p{L}])(?:التحميل|تحميل)\s+من\s+/u.test(n)||!/(?:^|[^\p{L}])(?:معبر|عبر|طريق|مرورا)(?=$|[^\p{L}])/u.test(n))return undefined;
 const hits=[];
 for(const [city,country] of cityCountry){let idx=n.indexOf(city);while(idx>=0){
  if(placeBoundary(n,idx)&&(idx+city.length===n.length||!/[\p{L}]/u.test(n[idx+city.length])))hits.push({idx,city,country});
  idx=n.indexOf(city,idx+city.length);
 }}
 hits.sort((a,b)=>a.idx-b.idx||b.city.length-a.city.length);
 const places=[];for(const hit of hits)if(!places.some(p=>hit.idx>=p.idx&&hit.idx<p.idx+p.city.length))places.push(hit);
 const from=[],to=[],via=[];
 for(const place of places){
  const before=n.slice(0,place.idx);
  if(/(?:^|[^\p{L}])(?:التحميل|تحميل)\s+(?:من\s+)?$/u.test(before))from.push(place);
  else if(/(?:^|[^\p{L}])(?:عبر|عن\s+طريق|طريق|مرورا\s+(?:من|ب)|من\s+معبر)\s*(?:معبر\s+)?$/u.test(before)||place.city.startsWith('معبر ')&&/(?:^|[^\p{L}])من\s+$/u.test(before))via.push(place);
  else if(/(?:^|[^\p{L}])(?:الى|الي|على|علي|باتجاه)\s+$/u.test(before))to.push(place);
  else return null;
 }
 if(!via.length)return undefined;
 if(from.length!==1||to.length!==1)return null;
 if(canonicalPlace(from[0].city)===canonicalPlace(to[0].city))return null;
 return {from_city:canonicalPlace(from[0].city),from_country:from[0].country,to_city:canonicalPlace(to[0].city),to_country:to[0].country};
}
function route(text){
 const reversed=reversedFreightRoute(text);if(reversed!==undefined)return reversed;
 const transit=loadingTransitRoute(text);if(transit!==undefined)return transit;
 const countryOnly=countryOnlyDestinationRoute(text);if(countryOnly)return countryOnly;
 const labeled=labeledRoute(text);if(labeled!==undefined)return labeled;
 const repeated=repeatedOriginRoute(text);if(repeated)return repeated;
 const multiple=multiDestinationRoute(text);if(multiple)return multiple;
 const explicit=explicitRoute(text);if(explicit)return explicit;
 // Never let a return depot substitute for an unrecognized delivery city.
 if(/(?:ارجاع|إرجاع|اعادة|إعادة|الفارغ|return)/iu.test(text)&&/(?:^|[^\p{L}])من\s+.+?\s+(?:الى|إلى|الي)\s+/u.test(routeLinesText(text)))return null;
 const n=geographyText(text), hits=[];
 for(const [city] of cityCountry){let pos=n.indexOf(city);while(pos>=0){
  if(placeBoundary(n,pos)&&(pos+city.length===n.length||!/[\p{L}]/u.test(n[pos+city.length])))hits.push({idx:pos,city});
  pos=n.indexOf(city,pos+city.length);
 }}
 hits.sort((a,b)=>a.idx-b.idx||b.city.length-a.city.length);
 const picked=[];for(const h of hits){if(!picked.some(p=>h.idx>=p.idx&&h.idx<p.idx+p.city.length))picked.push(h);}
 const unique=picked.filter((h,i)=>picked.findIndex(p=>canonicalPlace(p.city)===canonicalPlace(h.city))===i);
 if(unique.length!==2)return null;
 return {from_city:canonicalPlace(unique[0].city),to_city:canonicalPlace(unique[1].city)};
}
function phone(text){
 // Preserve line boundaries: separate contact numbers must never be joined.
 for(const line of String(text||'').split(/[\r\n،,;]+/u)){
  const runs=normalize(line).match(/\+?\d[\d ()-]*\d/g)||[];
  for(const run of runs){
   const parts=run.match(/\+?\d+/g)||[];
   for(let i=0;i<parts.length;i++){
    let compact=parts[i];
    const digits=()=>compact.replace(/^\+/,'').replace(/^00/,'');
    if(digits().length<3&&!/^(?:\+|00|43$|90$|20$)/.test(compact))continue;
    const wholeNumber=digits().length>=9;
    for(let j=i+1;!wholeNumber&&j<parts.length;j++){
     if(parts[j].startsWith('+')||(digits().length>=9&&parts[j].length>=7)||digits().length+parts[j].length>15)break;
     compact+=parts[j];
    }
    if(digits().length>=9&&digits().length<=15)return compact.startsWith('+')?compact:compact.startsWith('00')?'+'+compact.slice(2):compact;
   }
  }
 }
 return null;
}
function contactFromJid(jid=""){
 const match=String(jid||'').match(/^(\d{9,15})(?::\d+)?@s\.whatsapp\.net$/);
 return match?'+'+match[1]:null;
}
const senderGroupCache=new Map();
function senderIdentity(jid){return String(jid||'').replace(/:\d+(?=@)/,'');}
async function resolveSenderPhone(sock,m){
 const key=m.key||{};
 const direct=key.fromMe
   ?[sock.user?.id,key.participantPn,key.participantAlt,key.participant,key.senderPn]
   :[key.participantPn,key.participantAlt,key.participant,key.senderPn];
 for(const value of direct){const phone=contactFromJid(value);if(phone)return phone;}
 const senderIds=new Set([key.participant,key.participantLid,key.senderLid].filter(Boolean).map(senderIdentity));
 if(!senderIds.size||!String(key.remoteJid||'').endsWith('@g.us'))return null;
 let cached=senderGroupCache.get(key.remoteJid);
 if(!cached||Date.now()-cached.at>5*60*1000){
  const pending=Promise.resolve().then(()=>sock.groupMetadata(key.remoteJid)).then(meta=>meta?.participants||[]).catch(()=>[]);
  cached={at:Date.now(),participants:pending};senderGroupCache.set(key.remoteJid,cached);
  if(senderGroupCache.size>100)senderGroupCache.delete(senderGroupCache.keys().next().value);
 }
 for(const participant of await cached.participants){
  if(![participant.id,participant.lid,participant.jid].some(id=>id&&senderIds.has(senderIdentity(id))))continue;
  const phone=contactFromJid(participant.phoneNumber)||contactFromJid(participant.jid)||contactFromJid(participant.id);
  if(phone)return phone;
 }
 return null;
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
function weight(text){const m=normalize(text).match(/(?:وزن\s*)?(\d+(?:[.,]\d+)?)\s*\/?\s*(?:طن|طون|تون)(?=$|[^\p{L}])/u);return m?Number(m[1].replace(",",".")):null;}
function count(text       ){
  const n=normalize(text);
  if(/(?:برادين|سيارتين|شاحنتين|سطحتين|ستارتين|قاطرتين|مقطورتين|تريلتين|قلابين|لوبدين)/u.test(n)) return 2;
  const words={تلت:3,ثلاث:3,ثلاثة:3,تلات:3,تلاتة:3,اربع:4,اربعة:4,خمس:5,خمسة:5,ست:6,ستة:6,سبع:7,سبعة:7,ثمان:8,ثمانية:8,تسع:9,تسعة:9,عشر:10,عشرة:10};
  const wordCount=n.match(/(?:^|[^\p{L}])(تلت|ثلاثة?|تلاتة?|اربعة?|خمسة?|ستة?|سبعة?|ثمانية|ثمان|تسعة?|عشرة?)\s+(?:برادات|سيارات|شاحنات|سطحات|ستائر|ستاير|قلابات|تريلات|لوابد|لوايد|لوبدات)(?=$|[^\p{L}])/u);
  if(wordCount)return words[wordCount[1]];
  const pats=[
    /(?:برادات|سطحات|شاحنات|سيارات|براد|ستارة|ستاره|شاحنة|سيارة|تريلا|سطحة)\s*(?:عدد)\s*(\d{1,3})(?!\d)/u,
    /(?:مطلوب|نحتاج|يلزم)\s*(?:عدد\s*)?(\d{1,3})\s*(?:سياره|سيارة|شاحنه|شاحنة|براد|برادات|ستاره|ستارة|ستاير|ستائر|سطحه|سطحة|سطحات|قلاب|قلابات|جوانب|جنابي|مقطوره|مقطورة|قاطره|قاطرة|تريلا|تريله|تريلة|اورفليه|أورفليه|لوبد|لوبدات|لوابد|لوايد|صهريج|صهاريج)/u,
    /(\d{1,3})\s*(?:سياره|سيارة|شاحنه|شاحنة|براد|برادات|ستاره|ستارة|ستاير|ستائر|سطحه|سطحة|سطحات|قلاب|قلابات|جوانب|جنابي|مقطوره|مقطورة|قاطره|قاطرة|تريلا|تريله|تريلة|اورفليه|أورفليه|لوبد|لوبدات|لوابد|لوايد|صهريج|صهاريج)/u
  ];
  for(const rx of pats){const m=n.match(rx);if(m)return Math.max(1,Math.min(100,Number(m[1])));}
  return 1;
}
function cargo(text){const n=normalize(text);for(const w of ['اسفنج','كريمة',...cargoWords])if(new RegExp('(?:^|[^\\p{L}])(?:ال)?'+normalize(w)+'(?=$|[^\\p{L}])','u').test(n))return /^مواد [اأ]ولي[ةه]$/u.test(w)?"مواد أولية":w==="بطاطة"?"بطاطا":w;return "حمولة غير محددة";}
function trainedFreightRoute(raw       ,available        ){
 const n=geographyText(raw);
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
 if(available&&places.length>2){
  let tail=n.slice(first.i+first.len).split(/\+?\d/u)[0].trim();
  tail=tail.replace(/^(?:اذا\s+)?(?:حدا|حد|يلي|الي|اللي)\s+(?:عندو|عنده)\s+(?:شي|حمل|حموله|حمولة)\s*/u,'');
  if(/^(?:الى|الي|على|علي|ل)/u.test(tail)){
   tail=tail.replace(/^(?:الى|الي|على|علي|ل)\s*/u,'');
   const destinations=[];
   while(tail){
    tail=tail.replace(/^(?:\s|،|,|\/|(?:الى|الي|على|علي|او)(?=\s)|و(?=\s))+/u,'');
    if(!tail)break;
    const city=[...cityCountry.keys()].sort((a,b)=>b.length-a.length).find(c=>tail.startsWith(c)&&(!tail[c.length]||!/[\p{L}]/u.test(tail[c.length])));
    if(!city){destinations.length=0;break;}
    destinations.push({city:canonicalPlace(city),country:cityCountry.get(city)});tail=tail.slice(city.length).trim();
   }
   if(destinations.length>1&&destinations.every(d=>d.country===destinations[0].country))return {from_city:canonicalPlace(first.city),from_country:first.country,to_city:[...new Set(destinations.map(d=>d.city))].join(' / '),to_country:destinations[0].country};
  }
 }
 if(second)return {from_city:canonicalPlace(first.city),to_city:canonicalPlace(second.city)};
 if(available)return {from_city:canonicalPlace(first.city),to_city:"غير محدد"};
 return null;
}
function colloquialAvailabilityArea(raw){
 const n=normalize(raw);
 // Adjacent towns after an availability location are an area, not a route.
 if(!/(?:العندو|اللي عندو|يلي عندو)\s+حمل/u.test(n))return null;
 if(/(?:الى|الي|على|باتجاه)/u.test(n))return null;
 if(/(?:بل|بال|في)\s*(?:دانا|الدانا)\s+(?:سرمده|سرمدا)(?=$|\s)/u.test(n))return {from_city:'الدانا / سرمدا',from_country:'سوريا',to_city:'غير محدد',to_country:null};
 return null;
}
function availableAreaRoute(raw){
 const n=geographyText(raw);
 if(!/(?:جميع|كافه|كافة|كل)\s+(?:المحافظات|المناطق)/u.test(n))return null;
 const m=n.match(/(?:فاضي(?:ة|ه)?|فارغ(?:ة|ه)?)\s*(?:ب|في\s+)([\p{L}\s+\/]+?)(?=\s+(?:الله|نقل|الى|الي|الا|على|لجميع|لكافة|لكافه|لكل)|$)/u);
 if(!m)return null;
 const places=m[1].trim().split(/\s*[+\/]\s*/u).map(explicitEndpoint);
 if(!places.length||places.length>3||places.some(p=>!p)||!places.every(p=>p.country===places[0].country))return null;
 return {from_city:places.map(p=>p.city).join(' / '),from_country:places[0].country,to_city:'غير محدد',to_country:places[0].country};
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
// Only explicit vehicle availability counts; fuel, cargo and advances may also be available.
function hasAvailableVehicle(raw){
 const n=normalize(raw);
 const vehicle='(?:شاحن(?:ة|ه|ات|تين)|سيار(?:ة|ه|ات|تين)|براد(?:ات|ين)?|تريل(?:ا|ة|ه|ات)|ستار(?:ة|ه|ا|تين)?|ستائر|ستاير|سطح(?:ة|ه|ات|تين)|قلاب(?:ات|ين)?|قاطر(?:ة|ه)|مقطور(?:ة|ه)|لوبد(?:ات|ين)?|لوابد|لوايد|صهريج|صهاريج|دينا|تك|انتر|بورتر|جنابي)';
 const state='(?:متوفر(?:ة|ه|ين)?|متاح(?:ة|ه)?|موجود(?:ة|ه|ين)?|جاهز(?:ة|ه|ين)?|فاضي(?:ة|ه|ين)?|فارغ(?:ة|ه|ين)?)';
 const gap='\\s*(?:عدد\\s*)?(?:\\d+\\s*)?(?:(?:هنداي|هيونداي|كيا|ايسوزو)\\s*)?';
 const seekingLoad=/(?:^|[^\p{L}])لعندو\s+شي(?=$|[^\p{L}])|(?:اللي|الي|يلي|العندو|ال?عنده|مين)\s*(?:عندو|عنده)?\s*(?:شي|شغل|حمل|حموله|حمولة)[\s\S]{0,50}(?:يخبر|يحكي|يتواصل)|(?:بدور|عم دور|ابحث|نبحث|بدنا|بدي)\s*(?:على|عن)?\s*(?:حمل|حموله|حمولة|شغل)|(?:الحواليه|الحواليو|اللي\s+حواليه|الي\s+حواليه)\s+شي/u.test(n);
 const explicitLoadSearch=/(?:^|[^\p{L}])(?:يلي|اللي|الي|مين)\s+(?:عندو|عنده)\s+(?:حمل|حموله|حمولة)(?=$|[^\p{L}])/u.test(n);
 const explicitVehicle=new RegExp('(?:^|[^\\p{L}])'+vehicle+'(?=$|[^\\p{L}])','u').test(n);
 const sale=/للبيع|للايجار|للإيجار|شراء|مطلوب\s*شراء/u.test(n);
 if(!sale&&trainedFreightRoute(raw,true)&&((seekingLoad&&explicitVehicle)||explicitLoadSearch))return true;
 return new RegExp('(?:^|[^\\p{L}])(?:'+state+gap+vehicle+'|'+vehicle+gap+state+'|(?:عندي|يوجد)'+gap+vehicle+')(?=$|[^\\p{L}]|ب(?=[\\p{L}]))','u').test(n);
}
// An ad may list several jobs. Extract the first complete loading clause,
// preserving the entire original in notes; never pair cities from different jobs.
function primaryFreightText(raw){
 const text=String(raw||'');
 const starts=[...text.matchAll(/(?:^|\s)(?:و)?تحميل\s+(?=[\p{L}])/gu)];
 if(starts.length<2)return text;
 const first=text.slice(0,starts[1].index).trim();
 return explicitRoute(first)?first:text;
}
// Interpret explicit English loading labels; keep return instructions in original notes.
function englishLabeledFreight(raw){
 const text=String(raw||'');
 const fromLabels=[...text.matchAll(/\bloading\s+location\s*:\s*([^\r\n]+)/gi)];
 const toLabels=[...text.matchAll(/\bunloading\s+location\s*:\s*([^\r\n]+)/gi)];
 const plain=text.trim().match(/^([a-z ]+?)\s+to\s+([a-z ]+)(?=\r?\n|$)/i);
 if((fromLabels.length!==1||toLabels.length!==1)&&!plain)return text;
 const cities={
  'rabigh port':'ميناء رابغ',rabigh:'رابغ',sharurah:'شرورة',sharourah:'شرورة',jeddah:'جدة',jedda:'جدة',riyadh:'الرياض','riyadh sulai':'الرياض',
  dammam:'الدمام',mecca:'مكة',makkah:'مكة',medina:'المدينة',madinah:'المدينة',
  dubai:'دبي','abu dhabi':'أبوظبي',doha:'الدوحة',kuwait:'الكويت',
  damascus:'دمشق',aleppo:'حلب',qamishli:'القامشلي',amman:'عمان',baghdad:'بغداد'
 };
 const city=value=>cities[value.toLowerCase().replace(/[📌📍]/gu,'').replace(/\s+/g,' ').trim()];
 const from=city(plain?plain[1]:fromLabels[0][1]),to=city(plain?plain[2]:toLabels[0][1]);
 if(!from||!to||/\b(?:for sale|truck sales)\b/i.test(text))return text;
 const weightMatch=text.match(/\b(?:weight\s*:\s*)?(\d+(?:\.\d+)?)\s*(?:tons?|tonnes?|mt)\b/i);
 return 'تحميل من '+from+' إلى '+to+'\n'+text+
  (/\bcontainers?\b/i.test(text)?'\nحاويات':'')+
  (weightMatch?'\nوزن '+weightMatch[1]+' طن':'');
}

function parse(rawText       ,fallbackContact            =null){
  const text=String(rawText||"").trim();
  const freightText=primaryFreightText(englishLabeledFreight(text));
  const n=normalize(freightText);
  const availabilityHint=hasAvailableVehicle(freightText);
  const vehicleRequest=/(?:مطلوب(?:ه|ة|ين)?|يلزم(?:نا|ني)?|لازم(?:نا|ني)|نحتاج|بدنا|بدي|نبي)\s*(?:عدد\s*)?(?:(?:\d+|تلت|ثلاثة?|تلاتة?|اربعة?|خمسة?)\s*)?(?:براد|سطح|ستار|ستاير|ستائر|شاحن|سيار|تريل|قلاب|قاطر|مقطور|لوبد)/u.test(n);
  const truckAvailable=!vehicleRequest&&availabilityHint;
  const rt=(truckAvailable?colloquialAvailabilityArea(freightText)||availableAreaRoute(freightText):null)||route(freightText)||(truckAvailable?trainedFreightRoute(freightText,true):null);
  const destinationCountry=truckAvailable&&availableDestinationCountry(freightText);
  if(rt&&destinationCountry&&(!rt.to_city||rt.to_city==='غير محدد')){rt.to_city=null;rt.to_country=destinationCountry;}
  if(rt?.from_city==='حما')rt.from_city='حماة';
  if(rt?.to_city==='حما')rt.to_city='حماة';
  const rawPh=phone(text);
  const tr=trailer(freightText);
  const wt=weight(freightText);
  const tc=count(freightText);
  const cg=cargo(freightText);
  let fc=rt?(rt.from_country||inferCountry(rt.from_city)):null;
  let toc=rt?(rt.to_country||inferCountry(rt.to_city)):null;
  const ph=normalizeContact(rawPh,fallbackContact,fc||toc);
  // Vehicle + named cargo + explicit route is also a load request without "مطلوب".
  const implicitLoadRequest=!availabilityHint&&Boolean(tr)&&cg!=="حمولة غير محددة"&&Boolean(explicitRoute(freightText));
  const wanted=implicitLoadRequest||vehicleRequest||/(?:بدنا|بدي|نبي|عايزين|عاوزين|سياره\s+تحمل|سيارة\s+تحمل|مطلوب|مطلوبه|مطلوبة|مطلوبين|نحتاج|يلزم|يلزمنا|يلزمنه|لازمنا|لازمني|لزمنا|بحاجه|بحاجة|نريد|تحميل|حموله|حمولة|حمل|تنقل|نقل|برادات\s+من|براد\s+من)/u.test(n);
  const hasVehicle=Boolean(tr)||/(?:براد|برادات|سيارات|سيارتين|سيارا(?=$|[^\p{L}])|سياره|سيارة|شاحنات|شاحنه|شاحنة|تريلا|قاطره|قاطرة|مقطوره|مقطورة|ستارتين|ستارة|ستاره|برادين|سطحتين)/u.test(n);
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
  const explicitCargoAd=Boolean(explicitRoute(freightText)&&/(?:حمولة|حموله)\s+(?:خفيفة|خفيفه|جاهزة|جاهزه)/u.test(n));
  if(explicitCargoAd&&ph)confidence=Math.max(confidence,0.9);
  const enoughFreightSignal=Boolean(tr||hasVehicle||availabilityHint||cg!=="حمولة غير محددة"||explicitCargoAd);
  const saleAd=/(?:للبيع|للايجار|للإيجار|مطلوب\s*شراء)/u.test(n);
  const publishable=Boolean(!saleAd&&enoughFreightSignal&&(truckAvailable||wanted)&&rt&&fc&&(toc||truckAvailable)&&ph&&(truckAvailable?confidence>=0.7:confidence>=0.86));
  return {kind:truckAvailable?"truck_available":wanted?"load":"unknown",publishable,confidence,reason:publishable?null:truckAvailable?"truck_availability_incomplete":!wanted?"not_a_freight_request":!rt?"route_missing":!fc||!toc?"country_inference_missing":!ph?"contact_number_missing":!enoughFreightSignal?"freight_details_missing":"confidence_below_threshold",load:rt?{transport_scope:!toc||fc===toc?"local":"international",load_mode:"FTL",from_country:fc,from_city:rt.from_city,to_country:toc,to_city:rt.to_city==="غير محدد"?null:rt.to_city,cargo_type:cg,weight_tons:wt,required_trailer_type:tr||"غير محدد",trucks_required:tc,contact_phone:ph,contact_whatsapp:ph,posted_on_behalf:true,notes:text.slice(0,1200),status:"open",load_kind:"cargo",ad_duration_days:1,contact_visibility:"registered"}:null};
}

// Presentation only: never change the parsed payload or infer missing details.
function formatChannelAd(parsed,rawText='',publication=null){
 const l=parsed.load||{},isTruck=parsed.kind==='truck_available';
 const known=value=>value&&!/غير محدد/u.test(String(value))?String(value).trim():'';
 const vehicle=known(l.required_trailer_type);
 const contact=l.contact_phone||l.contact_whatsapp||'';
 const clean=String(rawText).replace(/[٠-٩۰-۹]/g,d=>ARABIC_DIGITS[d]||d)
  .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,'')
  .replace(/https?:\/\/trucklink-mena\.netlify\.app\/?(?:[^\s]*)/giu,'')
  .replace(/\+?\d[\d ()-]{7,}\d/g,number=>normalizeContact(number,null,l.from_country)===contact?'':number)
  .replace(/(?:إعلان|اعلان)\s+شحن\s+جديد|شاحنة\s+متاحة(?:\s+على\s+TruckLink(?:\s+MENA)?)?/gu,'')
  .replace(/(?:السلام عليكم(?: ورحمة الله(?: وبركاته)?)?|وعليكم السلام)/gu,'')
  .replace(/(?:رقم التواصل|رقم الهاتف|للتواصل|هاتف|اتصال|واتساب|TruckLink MENA|شاحنات الشرق)\s*[:：]?\s*(?=$|\n)/gmu,'');
 const from=known(l.from_city)||known(l.from_country);
 let to=known(l.to_city)||known(l.to_country);
 // Preserve explicitly joined alternatives, such as "جابر ونصيب".
 const destinations=to?[to]:[];
 if(to){
  const n=normalize(clean),at=n.indexOf(normalize(to));
  let tail=at<0?'':n.slice(at+normalize(to).length);
  for(let i=0;i<8;i++){
   const join=tail.match(/^\s*(?:أو|او|و|\/|،)\s*/u);if(!join)break;
   tail=tail.slice(join[0].length);
   const next=[...cityCountry.keys()].sort((a,b)=>b.length-a.length).find(city=>tail.startsWith(city)&&(!tail[city.length]||!/[\p{L}]/u.test(tail[city.length])));
   if(!next)break;
   const city=canonicalPlace(next);if(!destinations.includes(city))destinations.push(city);
   tail=tail.slice(next.length);
  }
  to=destinations.join(' / ');
 }
 const lines=[isTruck?'🚚 شاحنة متاحة للتحميل':vehicle?'🚛 مطلوب '+vehicle:'🚛 طلب نقل',''];
 if(publication){
  const date=publication.day.split('-').reverse().join('/');
  lines.unshift('📅 '+date+' | إعلان اليوم '+publication.daily_number,'🔖 رقم الإعلان بالمنصة: '+publication.ad_number,'');
 }
 if(from)lines.push('📍 من: '+from);
 if(to)lines.push('🏁 إلى: '+to);
 if(isTruck&&vehicle)lines.push('🚛 النوع: '+vehicle);
 if(known(l.cargo_type))lines.push('📦 الحمولة: '+l.cargo_type);
 if(l.weight_tons>0)lines.push('⚖️ الوزن: '+l.weight_tons+' طن');
 if(l.trucks_required>1)lines.push('🔢 عدد الشاحنات: '+l.trucks_required);
 const represented=[from,...destinations,vehicle,known(l.cargo_type)].filter(Boolean);
 const details=[],seen=new Set();
 for(const raw of clean.split(/\r?\n/)){
  const line=raw.replace(/[🚛🚚📱📞🌐📍🏁*]/gu,'').replace(/^[\s:：،,|–-]+|[\s:：،,|–-]+$/gu,'').trim();
  if(!line)continue;
  let rest=normalize(line);
  for(const value of represented)rest=rest.split(normalize(value)).join(' ');
  rest=rest.replace(/(?:^|\s)(?:مطلوب|من|الي|الى|علي|على|باتجاه|متوفر|متاحة|متاح|فارغة|فارغ|فاضي|فاضية|عالفاضي|جاهزة|جاهز|للتحميل|التحميل|و|او)(?=\s|$)/gu,' ').replace(/[^\p{L}\p{N}]+/gu,'').trim();
  if(!rest)continue;
  const key=normalize(line);if(!seen.has(key)){seen.add(key);details.push(line);}
 }
 if(details.length)lines.push('','📝 التفاصيل:',...details);
 if(contact)lines.push('','📞 للتواصل:','\u200e'+contact+'\u200e');
 lines.push('','🌐 شاحنات الشرق','https://easttrucks.com/');
 return lines.join('\n');
}

// Split repeated requests before parsing. Share only a sole trailing contact,
// and expand only destinations explicitly separated by a route preposition.
function freightParts(raw,fallbackContact){
 const text=routeLinesText(String(raw||'').trim());
 const lines=text.split(/[\r\n]+/u).map(x=>x.trim()).filter(Boolean);
 // Independent route blocks keep their own counts/details and a shared contact.
 const blocks=lines.map((line,i)=>({i,route:explicitRoute(line)})).filter(x=>x.route);
 if(blocks.length>1&&blocks.length<=20&&!hasAvailableVehicle(text)){
  const header=lines.slice(0,blocks[0].i).join('\n');
  const nums=normalize(text).match(/(?:\+|00)?\d[\d ()-]{7,}\d/g)||[];
  const shared=nums.length===1?phone(nums[0]):nums.length===0?fallbackContact:null;
  if(shared&&/(?:مطلوب|تحميل|حمل|حمولة|حموله)/u.test(normalize(text))){
   return blocks.map((block,i)=>header+'\n'+lines.slice(block.i,blocks[i+1]?.i??lines.length).join('\n')+'\n'+shared);
  }
 }
 const jobs=lines.map((line,i)=>({line,i,route:explicitRoute('من '+line.replace(/^من\s+/u,''))})).filter(x=>x.route);
 if(jobs.length>1&&jobs.length<=20){
  const header=lines.slice(0,jobs[0].i).join(' ');
  const tail=lines.slice(jobs.at(-1).i+1).join('\n');
  if(/مطلوب/u.test(header)&&trailer(header)&&!phone(header)&&!jobs.some(x=>phone(x.line))){
   const shared=phone(tail)||fallbackContact;
   if(shared){
    const routeLines=lines.slice(jobs[0].i,jobs.at(-1).i+1);
    if(routeLines.some(line=>!jobs.some(j=>j.line===line)))return [text];
    return jobs.map(x=>header+'\nمن '+x.line.replace(/^من\s+/u,'')+'\n'+tail+(phone(tail)?'':'\n'+shared));
   }
  }
 }
 const starts=[...text.matchAll(/(?:^|[\s،,])(?:و)?مطلوب(?=\s)/gu)].map(m=>m.index);
 const chunks=starts.length>1?starts.map((start,i)=>text.slice(i===0?0:start,starts[i+1]??text.length).trim().replace(/^ومطلوب/u,'مطلوب')):[text];
 const numbers=normalize(text).match(/\+?\d[\d ()-]{7,}\d/g)||[];
 let shared=numbers.length===1&&normalize(text).endsWith(numbers[0])?numbers[0]:null;
 // A Yemeni mobile advertised by a Yemeni sender keeps +967 even on Saudi routes.
 if(shared&&/^7\d{8}$/.test(shared)&&/^\+967\d{9}$/.test(fallbackContact||''))shared='+967'+shared;
 const parts=[];
 for(const chunk of chunks){
  const own=phone(chunk);
  let contact=own||shared;
  if(contact&&/^7\d{8}$/.test(contact)&&/^\+967\d{9}$/.test(fallbackContact||''))contact='+967'+contact;
  const body=chunk.replace(/\+?\d[\d ()-]{7,}\d/gu,'').trim();
  const match=normalize(body).match(/(?:^|[^\p{L}])من\s+(.+?)\s+(?:على|علي|الى|الي)\s+(.+)$/u);
  const alternatives=match?match[2].split(/\s+(?:على|علي|الى|الي)\s+/u):[];
  if(match&&alternatives.length>1&&explicitEndpoint(match[1])&&alternatives.every(d=>explicitEndpoint(d))){
   for(const to of alternatives)parts.push(body.slice(0,body.indexOf('من'))+'من '+match[1]+' إلى '+to+(contact?'\n'+contact:''));
  }else if(chunks.length>1&&(shared||contact)){
   // Replace a local number with its grounded international form, retaining notes.
   parts.push(body+'\n'+(contact||shared));
  }else parts.push(chunk);
 }
 return parts.length<=20?parts:[text];
}

function validateAIParse(text,data,fallbackContact){
 if(/للبيع|للايجار|للإيجار|مطلوب\s*شراء/u.test(normalize(text)))return null;
 if(!data?.publish||!['load','truck_available'].includes(data.kind)||!Number.isFinite(data.confidence)||data.confidence<0.9||data.confidence>1)return null;
 if(data.kind==='truck_available'&&!hasAvailableVehicle(primaryFreightText(text)))return null;
 const n=geographyText(text),allowed=new Set([...cityCountry.values(),'مصر']);
 const place=(raw,country)=>{
  if(typeof raw!=='string'||!allowed.has(country))return null;
  const city=normalize(raw);if(city.length<2||city.length>70||!/^\p{L}[\p{L}\s-]+$/u.test(city))return null;
  let at=n.indexOf(city),mentioned=false;
  while(at>=0){if(placeBoundary(n,at)&&(at+city.length===n.length||!/[\p{L}]/u.test(n[at+city.length]))){mentioned=true;break;}at=n.indexOf(city,at+city.length);}
  if(!mentioned)return null;
  const known=cityCountry.get(city);if(known&&known!==country)return null;
  return {city:canonicalPlace(city),country};
 };
 const from=place(data.from_city,data.from_country),to=data.to_city==null?null:place(data.to_city,data.to_country);
 if(!from||(data.kind==='load'&&!to)||(data.to_city!=null&&!to))return null;
 const reversed=reversedFreightRoute(text);
 if(reversed===null)return null;
 const directed=reversed||explicitRoute(normalize(text));
 if(directed&&(from.city!==directed.from_city||from.country!==directed.from_country||to?.city!==directed.to_city||to?.country!==directed.to_country))return null;
 const contact=normalizeContact(phone(text),fallbackContact,from.country);
 if(!contact)return null;
 const literal=(value)=>typeof value==='string'&&value.length<=80&&normalize(text).includes(normalize(value))?value:null;
 const load={transport_scope:to&&from.country!==to.country?'international':'local',load_mode:'FTL',from_city:from.city,from_country:from.country,to_city:to?.city||null,to_country:to?.country||null,cargo_type:cargo(text)!=='حمولة غير محددة'?cargo(text):literal(data.cargo_type)||'حمولة غير محددة',required_trailer_type:trailer(text)||literal(data.vehicle_type)||'غير محدد',weight_tons:weight(text),trucks_required:count(text),contact_phone:contact,contact_whatsapp:contact,posted_on_behalf:true,notes:text.slice(0,1200),status:'open',load_kind:'cargo',ad_duration_days:1,contact_visibility:'registered'};
 return {kind:data.kind,publishable:true,confidence:data.confidence,reason:null,load,parser:'openai'};
}
import makeWASocket,{useMultiFileAuthState,DisconnectReason} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import http from 'node:http';

// Retry only explicit PostgreSQL transaction rollbacks; uncertain network outcomes
// must not be retried here because they may already have committed.
async function ingestFreight(rpc,body,{fetchImpl=fetch,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 for(let attempt=0;attempt<3;attempt++){
  const response=await fetchImpl(process.env.SUPABASE_URL+'/rest/v1/rpc/'+rpc,{method:'POST',signal:AbortSignal.timeout(20000),headers:{apikey:process.env.SUPABASE_ANON_KEY,Authorization:'Bearer '+process.env.SUPABASE_ANON_KEY,'content-type':'application/json'},body:JSON.stringify(body)});
  const result=await response.text();
  let code;try{code=JSON.parse(result).code;}catch{}
  if(!response.ok&&['57014','40001','40P01'].includes(code)&&attempt<2){
   console.warn('Ingest transaction retry',JSON.stringify({rpc,code,attempt:attempt+1}));
   await sleep(1000*(attempt+1));
   continue;
  }
  return {response,result};
 }
}

let numberedChannelQueue=Promise.resolve();
async function publicationNumber(adId,action='reserve',messageId=null){
 const response=await fetch(process.env.SUPABASE_URL+'/rest/v1/rpc/whatsapp_publication_number',{
  method:'POST',signal:AbortSignal.timeout(15000),
  headers:{apikey:process.env.SUPABASE_ANON_KEY,Authorization:'Bearer '+process.env.SUPABASE_ANON_KEY,'content-type':'application/json'},
  body:JSON.stringify({p_token:process.env.TRUCKLINK_INGEST_TOKEN,p_ad_id:adId,p_action:action,p_message_id:messageId})
 });
 if(!response.ok)throw new Error('Publication numbering HTTP '+response.status);
 return response.json();
}
function sendNumberedChannelAd(sock,channel,parsed,text,adId,sourceId){
 const task=numberedChannelQueue.then(async()=>{
  if(!adId)throw new Error('Published advertisement ID missing');
  let job=deliveryStore.data.outbox[adId];
  if(!job)job=await deliveryStore.put('outbox',adId,{channel,parsed,text,sourceId,at:Date.now(),status:'pending',next:0});
  if(job.status==='sent')return null;
  // A restart or uncertain send must not generate a second public message.
  if(job.status==='sending')throw new Error('Channel send outcome uncertain; review required');
  if(job.status==='receipt'){
   await publicationNumber(adId,'confirm',job.messageId);
   await deliveryStore.put('outbox',adId,{...job,status:'sent'});return null;
  }
  if(!channel.endsWith('@newsletter'))throw new Error('Channel unresolved');
  if(activeSocket!==sock||status!=='connected'||sock.ws?.isOpen===false)throw new Error('Channel waiting for active connection');
  let reference;
  for(let attempt=0;attempt<3;attempt++){
   reference=await publicationNumber(adId);
   if(reference.ready)break;
   await new Promise(resolve=>setTimeout(resolve,2000));
  }
  if(!reference?.ready)throw new Error('Publication numbering initialization pending');
  if(reference.already_sent){await deliveryStore.put('outbox',adId,{...job,status:'sent'});return null;}
  if(!Number.isSafeInteger(reference.ad_number)||reference.ad_number<3000||!Number.isInteger(reference.daily_number)||reference.daily_number<1||!/^\d{4}-\d{2}-\d{2}$/.test(reference.day))throw new Error('Invalid publication reference');
  if(activeSocket!==sock||status!=='connected'||sock.ws?.isOpen===false)throw new Error('Channel waiting for active connection');
  await deliveryStore.put('outbox',adId,{...job,status:'sending'});
  const channelText=formatChannelAd(parsed,text,reference);
  let sent;
  try{sent=await sock.sendMessage(channel,{text:channelText,linkPreview:null});}
  catch(error){
   if(definitelyUnsent(error))await deliveryStore.put('outbox',adId,{...job,status:'pending',next:Date.now()+30000});
   throw error;
  }
  if(!sent?.key?.id)throw new Error('Channel message ID missing; review required');
  job={...job,status:'receipt',messageId:sent.key.id};
  await deliveryStore.put('outbox',adId,job);
  await groupRelay.observeSent(channel,sent,channelText).catch(error=>console.warn('Group relay queue pending',String(error)));
  console.log('Channel publication sent',JSON.stringify({sourceId,messageId:sent.key.id,adId,ad_number:reference.ad_number}));
  for(let attempt=0;attempt<3;attempt++){
   try{await publicationNumber(adId,'confirm',sent.key.id);await deliveryStore.put('outbox',adId,{...job,status:'sent'});break;}
   catch(error){if(attempt===2)console.error('Channel receipt confirmation pending',JSON.stringify({adId,error:String(error)}));}
  }
  return sent;
 });
 numberedChannelQueue=task.catch(()=>{});
 return task;
}
// Restore the old runner's place learning, without importing its private replies
// or guessing missing endpoints. Existing curated entries always win.
let learnedPlaces=0,placeLearningStatus='pending';
async function learnPlacesFromPlatform(){
 if(!process.env.SUPABASE_URL||!process.env.SUPABASE_ANON_KEY){placeLearningStatus='not_configured';return;}
 const allowed=new Set([...cityCountry.values(),'مصر']);
 const candidates=new Map();
 try{
  {
   // Use the site's permitted public feed, selecting only geography fields.
   // Direct access to loads is restricted to owners and admins.
   const response=await fetch(process.env.SUPABASE_URL+'/rest/v1/rpc/get_load_feed_v6?limit_count=500&select=from_city,from_country,to_city,to_country',{signal:AbortSignal.timeout(10000),headers:{apikey:process.env.SUPABASE_ANON_KEY,Authorization:'Bearer '+process.env.SUPABASE_ANON_KEY}});
   if(!response.ok)throw new Error('HTTP '+response.status);
   const rows=await response.json();
   if(!Array.isArray(rows))throw new Error('Invalid place response');
   for(const row of rows)for(const [city,country] of [[row.from_city,row.from_country],[row.to_city,row.to_country]]){
    const name=normalize(city||'');
    if(!allowed.has(country)||name.length<3||name.length>45||!/^\p{L}[\p{L} ]+$/u.test(name)||/غير محدد|غير مذكور|حسب الاتصال|عدة مدن|جميع|محافظات|مطلوب|تحميل|حمول/u.test(name)||name.split(' ').length>5||cityCountry.has(name))continue;
    if(!candidates.has(name))candidates.set(name,new Set());
    candidates.get(name).add(country);
   }
  }
  for(const [city,countries] of candidates)if(countries.size===1){cityCountry.set(city,[...countries][0]);learnedPlaces++;}
  placeLearningStatus='ready';
  console.log('Legacy place learning restored',JSON.stringify({learnedPlaces,totalKnownPlaces:cityCountry.size}));
 }catch(e){placeLearningStatus='failed';console.warn('Place learning unavailable; using curated dictionary',String(e));}
}
function getText(message){
 let msg=message;
 for(let i=0;i<8&&msg;i++){
  const inner=msg.protocolMessage?.editedMessage||msg.editedMessage?.message||msg.ephemeralMessage?.message||msg.viewOnceMessage?.message||msg.viewOnceMessageV2?.message||msg.viewOnceMessageV2Extension?.message||msg.documentWithCaptionMessage?.message;
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
const deliveryStore=await createDeliveryStore(dir+'/delivery-state.json');
const groupRelay=await createChannelGroupRelay({path:dir+'/channel-group-relay.json'});
let qr='',status='starting';
let resolvedChannelJid='';
let groupCount=null,groupCheckError='';
let activeSocket=null;
let connectionRecovery=null;
const reconnectTimers=new Map();
const reconnectAttempts=new Map();
const replacementPhone=String(process.env.WA_REPLACEMENT_PHONE||'');
if(replacementPhone&&!/^[1-9][0-9]{8,14}$/.test(replacementPhone))throw new Error('Invalid replacement phone');
const replacementSession=String(process.env.WA_REPLACEMENT_SESSION||'');
if(replacementSession&&!/^[a-zA-Z0-9_-]{1,50}$/.test(replacementSession))throw new Error('Invalid replacement session name');
const replacementDir=replacementPhone?'/data/wa-session-'+replacementPhone+(replacementSession?'-'+replacementSession:''):null;
let pendingSocket=null,replacementQr='',replacementCode='',replacementStatus=replacementPhone?'starting':'not_requested',codeRequestedAt=0;
const messageDiagnostics={noText:0,duplicate:0,rejected:0,published:0,reasons:{},unsupportedTypes:{}};
let channelReaderStatus={enabled:true,status:'starting'};
let receivedChannelMessages=0;
let receivedGroupMessages=0,publishedLoads=0,publishedTrucks=0,publishedChannel=0,lastReceivedAt=null,lastPublishError='';
const processedMessages=new Map(Object.entries(deliveryStore.data.processed));
async function markProcessed(key){processedMessages.set(key,Date.now());await deliveryStore.put('processed',key,Date.now());if(processedMessages.size>5000)processedMessages.delete(processedMessages.keys().next().value);}

const publishedFreightTexts=new Map(Object.entries(deliveryStore.data.freight)),inFlightFreightTexts=new Set();
const recentMessages=new Map();
// Owner exclusions: original groups 1–9 plus replacement-account groups
// 1,2,3,5,6,7,10,13,15,17,22,27 from the verified 31-group list.
// Non-freight groups identified in the joined-group inventory on 2026-10-11.
const EXCLUDED_GROUPS=new Set(["120363429798229835@g.us","120363431163392943@g.us","120363402947027837@g.us","120363432040436430@g.us","120363285533629337@g.us","120363032467180231@g.us","120363390071970492@g.us","120363246703383152@g.us","120363430110878767@g.us","120363165708973439@g.us","120363258441959550@g.us","120363306190092623@g.us","120363433294574615@g.us","120363344974964509@g.us","120363423411014709@g.us","120363404559410103@g.us","120363404408158364@g.us","120363412699593606@g.us","4915780883324-1493381833@g.us","120363409325566982@g.us","120363364912181752@g.us","120363406171014799@g.us","120363408358449149@g.us","120363425579086719@g.us","905523903152-1583927147@g.us"]);
let monitoredGroupCount=null;
function rememberMessage(m){if(!m.message)return;const k=String(m.key?.remoteJid||'')+':'+String(m.key?.id||'');recentMessages.set(k,m.message);if(recentMessages.size>250)recentMessages.delete(recentMessages.keys().next().value);}

const CHANNEL_INVITE='0029Vb88HmiK0IBl4La1aC1Q';
const ownChannelJids=()=>['120363428757778414@newsletter',resolvedChannelJid,String(process.env.TARGET_CHANNEL_JID||'')];

const CHANNEL_BRAND_VERSION='easttrucks-20261010';
let channelBrand={status:'pending',version:CHANNEL_BRAND_VERSION};
let channelBrandAttempted=false;
async function syncChannelBrand(sock,metadata){
 if(channelBrandAttempted||!resolvedChannelJid.endsWith('@newsletter'))return;
 channelBrandAttempted=true;
 const receipt='/data/channel-brand-'+CHANNEL_BRAND_VERSION+'.json';
 try{const saved=JSON.parse(await readFile(receipt,'utf8'));if(saved.status==='verified'||saved.pictureSubmitted){channelBrand=saved;return;}}catch{}
 channelBrand={status:'updating',version:CHANNEL_BRAND_VERSION};
 try{
  const name='شاحنات الشرق';
  const description='منصة الحمولات والشاحنات في الشرق الأوسط\nنشر طلبات النقل والشاحنات المتاحة والتواصل المباشر.\nhttps://easttrucks.com/';
  const currentName=metadata?.thread_metadata?.name?.text||metadata?.name;
  if(currentName!==name)await sock.newsletterUpdateName(resolvedChannelJid,name);
  channelBrand.nameUpdated=true;
  const currentDescription=metadata?.thread_metadata?.description?.text||metadata?.description;
  if(currentDescription!==description)await sock.newsletterUpdateDescription(resolvedChannelJid,description);
  channelBrand.descriptionUpdated=true;
  const previousPicture=metadata?.thread_metadata?.picture?.id||metadata?.picture?.id;
  await sock.newsletterUpdatePicture(resolvedChannelJid,{url:'https://easttrucks.com/assets/easttrucks-logo.png'});
  channelBrand.pictureSubmitted=true;
  const verified=await sock.newsletterMetadata('invite',CHANNEL_INVITE);
  const verifiedName=verified?.thread_metadata?.name?.text||verified?.name;
  const verifiedDescription=verified?.thread_metadata?.description?.text||verified?.description;
  const pictureId=verified?.thread_metadata?.picture?.id||verified?.picture?.id;
  channelBrand.status=verifiedName===name&&verifiedDescription===description&&pictureId&&pictureId!==previousPicture?'verified':'pending_verification';
  channelBrand.at=new Date().toISOString();
  await writeFile(receipt,JSON.stringify(channelBrand));
  console.log('Channel brand update',JSON.stringify(channelBrand));
 }catch(error){channelBrand.status='failed';channelBrand.error=String(error).slice(0,200);console.error('Channel brand update failed',channelBrand.error);}
}

let groupRefreshInFlight=false;
let groupRefreshCooldownUntil=0;
let groupNextRefreshAt=0,groupRefreshAccount='';
const verifiedRequestedGroups=new Map();
async function verifyRequestedMembership(sock,info){
 try{
  const meta=await sock.groupMetadata(info.id);
  const selfIds=new Set([sock.user?.id,sock.user?.lid].filter(Boolean).map(senderIdentity));
  const selfPhone=contactFromJid(sock.user?.id);
  const member=(meta.participants||[]).some(p=>[p.id,p.lid,p.jid].some(id=>id&&(selfIds.has(senderIdentity(id))||(selfPhone&&contactFromJid(id)===selfPhone))));
  if(member){verifiedRequestedGroups.set(info.id,meta);console.log('Requested group membership verified',JSON.stringify({id:info.id,name:meta.subject||info.subject}));return true;}
  console.log('Requested group membership unconfirmed',JSON.stringify({id:info.id,name:info.subject}));
 }catch(e){console.log('Requested group membership check failed',JSON.stringify({id:info.id,name:info.subject,error:String(e)}));}
 return false;
}
async function refreshJoinedGroups(sock,joinRequested=false){
 if(activeSocket!==sock||groupRefreshInFlight||Date.now()<groupRefreshCooldownUntil)return;
 if(replacementPhone&&String(sock.user?.id||'').split('@')[0].split(':')[0]!==replacementPhone)return;
 const account=senderIdentity(sock.user?.id);
 if(groupRefreshAccount!==account){groupRefreshAccount=account;groupNextRefreshAt=0;}
 // groupFetchAllParticipating itself produces group events. Do not turn those
 // notifications into a minute-by-minute refresh loop, including on reconnect.
 if(Date.now()<groupNextRefreshAt)return;
 groupRefreshInFlight=true;
 groupNextRefreshAt=Date.now()+15*60*1000;
 try{
  let groups=await sock.groupFetchAllParticipating();
  if(joinRequested){
   const requested=['ENfU2aCppVa545mZW7W5Y3',...String(process.env.JOIN_GROUP_INVITES||'').split(',')].filter(code=>/^[A-Za-z0-9]{20,24}$/.test(code));
   for(const code of [...new Set(requested)].slice(0,6)){
    if(activeSocket!==sock)return;
    if(code==='ENfU2aCppVa545mZW7W5Y3'&&groups['120363431703780865@g.us'])continue;
    try{
     const info=await sock.groupGetInviteInfo(code);
     if(!info?.id?.endsWith('@g.us'))throw new Error('Invalid group metadata');
     console.log('Requested group identified',JSON.stringify({id:info.id,name:info.subject}));
     if(groups[info.id]){console.log('Requested group already joined',JSON.stringify({id:info.id,name:info.subject}));continue;}
     if(EXCLUDED_GROUPS.has(info.id)){console.log('Requested group excluded',info.id);continue;}
     if(await verifyRequestedMembership(sock,info))continue;
     try{await sock.groupAcceptInvite(code);console.log('Requested group join submitted',JSON.stringify({id:info.id,name:info.subject}));}
     catch(e){console.error('Requested group join response',JSON.stringify({id:info.id,name:info.subject,error:String(e)}));}
     await verifyRequestedMembership(sock,info);
    }catch(e){console.error('Requested group join failed',String(e));}
   }
   groups=await sock.groupFetchAllParticipating();
   for(const [id,meta] of verifiedRequestedGroups)if(!groups[id])groups[id]=meta;
  }
  if(activeSocket!==sock)return;
  groupCount=Object.keys(groups).length;monitoredGroupCount=Object.keys(groups).filter(jid=>!EXCLUDED_GROUPS.has(jid)).length;groupCheckError='';
  groupNextRefreshAt=Date.now()+12*60*60*1000;
  console.log('Group monitoring policy',JSON.stringify({excludedGroups:EXCLUDED_GROUPS.size,monitoredGroupCount}));
  if(process.env.BOT_LOG_LEVEL==='debug')console.log('Joined WhatsApp group names',JSON.stringify(Object.values(groups).map(g=>({name:g.subject||'بدون اسم',id:g.id}))));
 }catch(e){groupCheckError=String(e);if(/rate.overlimit|rate-overlimit|429/i.test(groupCheckError))groupRefreshCooldownUntil=Date.now()+60*60*1000;console.error('Group refresh failed',String(e));}
 finally{groupRefreshInFlight=false;}
}

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
   const sent=await sock.sendMessage(resolvedChannelJid,{text:task.text,linkPreview:null});
   if(!sent?.key?.id)throw new Error('No WhatsApp message ID returned');
   manualPublication={id:task.id,status:'sent',messageId:sent.key.id,at:new Date().toISOString()};
   await writeFile(receipt,JSON.stringify(manualPublication));
   await groupRelay.observeSent(resolvedChannelJid,sent,task.text).catch(error=>console.warn('Group relay queue pending',String(error)));
   publishedChannel++;
   console.log('Requested channel post sent',JSON.stringify({...manualPublication,channel:resolvedChannelJid}));
 }catch(e){
   manualPublication={id:task.id,status:'failed_or_unconfirmed',error:String(e),at:new Date().toISOString()};
   await writeFile(receipt,JSON.stringify(manualPublication));
   console.error('Requested channel post failed',JSON.stringify(manualPublication));
 }
}

async function connect(authDir=dir,candidate=false){
 if(reconnectTimers.has(authDir)){clearTimeout(reconnectTimers.get(authDir));reconnectTimers.delete(authDir);}
 const {state,saveCreds}=await useMultiFileAuthState(authDir);
 const sock=makeWASocket({logger:socketLogger,auth:state,printQRInTerminal:false,markOnlineOnConnect:false,syncFullHistory:false,shouldSyncHistoryMessage:()=>false,getMessage:async(key)=>recentMessages.get(String(key?.remoteJid||'')+':'+String(key?.id||''))});
 if(candidate)pendingSocket=sock;else activeSocket=sock;
 sock.ev.on('creds.update',saveCreds);
 const recovery=createBufferRecovery({sock,isActive:()=>activeSocket===sock&&status==='connected'});
 let recoveryTimer=null;
 const recoverBuffer=()=>{recovery.tick();if(activeSocket===sock&&status==='connected'){recoveryTimer=setTimeout(recoverBuffer,15000);recoveryTimer.unref?.();}};
 let groupRefreshTimer=null,periodicGroupTimer=null,channelReader=null,retryTimer=null,openedAt=0;
 const scheduleGroupRefresh=()=>{if(groupRefreshTimer)clearTimeout(groupRefreshTimer);groupRefreshTimer=setTimeout(()=>{groupRefreshTimer=null;void refreshJoinedGroups(sock);},60000);};
 const periodicRefresh=()=>{periodicGroupTimer=setTimeout(async()=>{if(activeSocket!==sock)return;await refreshJoinedGroups(sock);periodicRefresh();},12*60*60*1000);periodicGroupTimer.unref?.();};
 sock.ev.on('groups.upsert',scheduleGroupRefresh);
 sock.ev.on('groups.update',scheduleGroupRefresh);
 // Membership changes are handled by periodic refresh to avoid WhatsApp metadata rate limits.
 sock.ev.on('connection.update',({connection,lastDisconnect,qr:nextQR,receivedPendingNotifications})=>{
   if(receivedPendingNotifications!==undefined)recovery.pending(receivedPendingNotifications);
   if(nextQR){if(candidate){replacementQr=nextQR;replacementStatus='scan';}else{qr=nextQR;status='scan';}}
   if(connection==='open'){
    openedAt=Date.now();
    if(candidate){
      const linked=String(sock.user?.id||'').split('@')[0].split(':')[0];
      if(linked!==replacementPhone){replacementStatus='wrong_number';replacementQr='';replacementCode='';pendingSocket=null;sock.end(new Error('Unexpected account'));return;}
      const previous=activeSocket;
      activeSocket=sock;pendingSocket=sock;replacementStatus='connected';replacementQr='';replacementCode='';
      resolvedChannelJid='';if(senderIdentity(previous?.user?.id)!==senderIdentity(sock.user?.id)){groupCount=null;monitoredGroupCount=null;}
      if(previous&&previous!==sock)previous.end(new Error('Account replaced by owner'));
      console.log('Replacement WhatsApp account activated',JSON.stringify({last4:linked.slice(-4)}));
    }
    connectionRecovery=recovery.state;
    if(recoveryTimer)clearTimeout(recoveryTimer);recoveryTimer=setTimeout(recoverBuffer,15000);recoveryTimer.unref?.();
    if(periodicGroupTimer)clearTimeout(periodicGroupTimer);periodicRefresh();
    if(retryTimer)clearTimeout(retryTimer);retryTimer=setTimeout(retryPending,30000);retryTimer.unref?.();
    qr='';status='connected';if(!replacementPhone||candidate)groupRelay.connect(sock,()=>activeSocket===sock&&status==='connected');channelReaderStatus=channelReader.state;channelReader.start();(async()=>{try{const metadata=await sock.newsletterMetadata('invite',CHANNEL_INVITE);resolvedChannelJid=String(metadata?.id||'');console.log('TruckLink channel resolved',Boolean(resolvedChannelJid));void syncChannelBrand(sock,metadata);await publishRequestedChannelPost(sock);}catch(err){console.error('Channel resolution pending',String(err));}})();void refreshJoinedGroups(sock,true);}
   if(connection==='close'){
    if(recoveryTimer)clearTimeout(recoveryTimer);
    // Deliver already-decoded events to the durable inbox before discarding
    // this socket. The next socket's retry worker resumes these messages.
    sock.ev.flush?.();
    channelReader?.stop();groupRelay.disconnect(sock);
    if(groupRefreshTimer)clearTimeout(groupRefreshTimer);if(periodicGroupTimer)clearTimeout(periodicGroupTimer);if(retryTimer)clearTimeout(retryTimer);
    const code=lastDisconnect?.error?.output?.statusCode;
    const selected=activeSocket===sock,waiting=candidate&&pendingSocket===sock;
    if(selected){qr='';status='disconnected';}
    if(waiting){replacementQr='';replacementCode='';replacementStatus=code===DisconnectReason.loggedOut?'logged_out':'reconnecting';}
    console.warn('WhatsApp disconnected',code);
    if((selected||waiting)&&code!==DisconnectReason.loggedOut&&!reconnectTimers.has(authDir)){
      const attempts=openedAt&&Date.now()-openedAt>=60000?0:(reconnectAttempts.get(authDir)||0);
      reconnectAttempts.set(authDir,attempts+1);
      const delay=Math.min(300000,7000*2**Math.min(attempts,6));
      console.log('WhatsApp reconnect scheduled',JSON.stringify({delayMs:delay}));
      reconnectTimers.set(authDir,setTimeout(()=>{reconnectTimers.delete(authDir);connect(authDir,candidate).catch(e=>console.error('Reconnect error',String(e)));},delay));
    }
   }
 });
 // Read joined groups and followed channels through the same guarded publish path.
 const handleMessages=async({messages,type})=>{
   if(activeSocket!==sock)return false;
   if(type!=='notify'&&type!=='append')return;
   let completed=true;
   for(const m of messages){
     let freightKey=null,retryKey=null,messageCompleted=true;
     try{
       const jid=String(m.key?.remoteJid||'');
       if(ownChannelJids().includes(jid)){await groupRelay.accept(m).catch(error=>console.warn('Group relay event pending',String(error)));continue;}
       if(jid.endsWith('@g.us')&&isRelayText(getText(m.message)))continue;
       if(!acceptsFreightSource(jid,EXCLUDED_GROUPS,ownChannelJids()))continue;
       const fromChannel=isChannelJid(jid);
       if(fromChannel&&m.key?.fromMe)continue;
       const sourceMessageId=fromChannel?channelMessageId(m):m.key?.id;
       if(!sourceMessageId)continue;
       rememberMessage(m);
       if(!m.message)continue;
       const stamp=Number(m.messageTimestamp||0)*1000;
       if(fromChannel&&(!Number.isFinite(stamp)||stamp<=0||stamp>Date.now()+60000))continue;
       if(stamp && Date.now()-stamp>24*60*60*1000)continue;
       if(fromChannel)receivedChannelMessages++;else receivedGroupMessages++;lastReceivedAt=new Date().toISOString();
       if(process.env.BOT_LOG_LEVEL==='debug')console.log(fromChannel?'Channel message received':'Group message received',JSON.stringify({group:jid,id:sourceMessageId}));
       const originalText=getText(m.message);
       if(!originalText){messageDiagnostics.noText++;const kind=Object.keys(m.message).filter(k=>k!=='messageContextInfo').join(',').slice(0,100)||'empty';messageDiagnostics.unsupportedTypes[kind]=(messageDiagnostics.unsupportedTypes[kind]||0)+1;continue;}
       if(!process.env.SUPABASE_URL||!process.env.SUPABASE_ANON_KEY||!process.env.TRUCKLINK_INGEST_TOKEN){completed=false;console.log('Publishing credentials missing');continue;}
       retryKey=jid+':'+sourceMessageId;
       const previousRetry=deliveryStore.data.retries[retryKey];
       await deliveryStore.put('retries',retryKey,{message:{key:m.key,messageTimestamp:Number(m.messageTimestamp||Date.now()/1000),message:{conversation:originalText}},attempts:(previousRetry?.attempts||0)+1,next:Date.now()+Math.min(900000,30000*2**Math.min(previousRetry?.attempts||0,5))});
       const sender=fromChannel?'':m.key.fromMe?(sock.user?.id||m.key.participantAlt||m.key.participant||''):(m.key.participantAlt||m.key.participant||'');
       const senderPhone=fromChannel?null:contactFromJid(sender)||((isFreightCandidate(originalText)||hasAvailableVehicle(originalText)||parse(originalText).kind==='load')?await resolveSenderPhone(sock,m):null);
       const parts=freightParts(originalText,senderPhone);
       for(let partIndex=0;partIndex<parts.length;partIndex++){
       const text=parts[partIndex];
       const messageId=parts.length>1?sourceMessageId+':part:'+(partIndex+1):sourceMessageId;
       const cacheKey=jid+':'+messageId;
       if(processedMessages.has(cacheKey))continue;
       freightKey=null;
       try{
       const preliminary=parse(text,senderPhone);
       let finalParsed=preliminary;
       if(!finalParsed.publishable&&isFreightCandidate(text)&&(phone(text)||senderPhone||contactFromJid(sender))){
         let deferred=null;
         // A fresh Gulf message must not consume the next AI slot while Syrian
         // freight is already waiting for its retry timer after a quota limit.
         const syrianWaiting=freightPriority(text)>0&&Object.entries(deliveryStore.data.retries).some(([key,job])=>key!==retryKey&&job.aiDeferred&&Date.now()-Number(job.message.messageTimestamp)*1000<86400000&&freightPriority(getText(job.message.message))===0);
         if(syrianWaiting)deferred={reason:'syria_priority',retryAfterMs:30000};
         const ai=deferred?null:await extractFreightAd(text,{onDeferred:reason=>{deferred=reason;}});
         if(deferred){
           completed=false;messageCompleted=false;
           await deliveryStore.put('retries',retryKey,{...deliveryStore.data.retries[retryKey],aiDeferred:true,next:Date.now()+Math.max(30000,deferred.retryAfterMs)});
           console.log('AI freight deferred',JSON.stringify({id:messageId,priority:freightPriority(text)===0?'syria':'other',reason:deferred.reason}));
           continue;
         }
         const recovered=validateAIParse(text,ai,senderPhone||contactFromJid(sender));
         if(recovered){finalParsed=recovered;console.log('AI freight recovered',JSON.stringify({id:m.key.id,kind:recovered.kind}));}
       }
       if(!phone(text)&&preliminary.kind!=='unknown')console.log('Sender contact resolution',JSON.stringify({id:m.key.id,resolved:!!(senderPhone||contactFromJid(sender))}));
       const shouldPublish=finalParsed.publishable&&(finalParsed.kind!=='load'||finalParsed.confidence>=0.86);
       if(!shouldPublish){messageDiagnostics.rejected++;const reason=finalParsed.reason||'low_confidence';messageDiagnostics.reasons[reason]=(messageDiagnostics.reasons[reason]||0)+1;console.log('Freight skipped',JSON.stringify({id:m.key.id,kind:finalParsed.kind,reason:finalParsed.reason||'low_confidence'}));if(finalParsed.kind==='unknown')continue;}
       if(shouldPublish){
         const key=createHash('sha256').update(normalize(text).replace(/[\p{P}\p{S}\s]+/gu,' ').trim()+'|'+finalParsed.load.contact_phone).digest('hex');
         for(const [k,ts] of publishedFreightTexts)if(Date.now()-ts>24*60*60*1000)publishedFreightTexts.delete(k);
         if(publishedFreightTexts.has(key)||inFlightFreightTexts.has(key)){messageDiagnostics.duplicate++;console.log('Repeated forwarded freight skipped');continue;}
         freightKey=key;inFlightFreightTexts.add(key);
       }
       // Retain rejected freight for diagnosis via the existing authenticated RPC;
       // never publish it or send a clarification message to the individual.
       const isTruck=shouldPublish&&finalParsed.kind==='truck_available';
       const body={p_token:process.env.TRUCKLINK_INGEST_TOKEN,p_group_jid:jid,p_message_id:messageId,p_sender_hash:createHash('sha256').update(String(sender)).digest('hex').slice(0,24),p_text:text.slice(0,4000),p_received_at:new Date(Number(m.messageTimestamp||Date.now()/1000)*1000).toISOString(),p_parsed:finalParsed,p_confidence:finalParsed.confidence,p_publish:shouldPublish};
       if(isTruck)delete body.p_publish;
       const rpc=isTruck?'publish_whatsapp_truck_available':'ingest_whatsapp_pilot';
       const {response,result}=await ingestFreight(rpc,body);
       if(!response.ok){completed=false;messageCompleted=false;lastPublishError='Ingest HTTP '+response.status;console.error('Ingest failed',response.status,result.slice(0,300));continue;}
       const outcome=JSON.parse(result);
       console.log('Freight ingest result',JSON.stringify({id:messageId,...outcome}));
       const adId=outcome.published_load_id||outcome.published_truck_id;
       if(!shouldPublish||(outcome.duplicate===true&&!adId)){await markProcessed(cacheKey);continue;}
       if(outcome.published!==true&&!adId){console.warn('Freight rejected by server',JSON.stringify({id:messageId,reason:outcome.reason||'not_published'}));await markProcessed(cacheKey);continue;}
       if(!adId)throw new Error('Ingest success missing advertisement ID');
       const channel=String(resolvedChannelJid||process.env.TARGET_CHANNEL_JID||'');
       if(!deliveryStore.data.outbox[adId])await deliveryStore.put('outbox',adId,{channel,parsed:finalParsed,text:text.slice(0,1200),sourceId:messageId,at:Date.now(),status:'pending',next:0});
       if(outcome.published===true&&!outcome.duplicate)messageDiagnostics.published++;
       if(freightKey){publishedFreightTexts.set(freightKey,Date.now());await deliveryStore.put('freight',freightKey,Date.now());if(publishedFreightTexts.size>5000)publishedFreightTexts.delete(publishedFreightTexts.keys().next().value);}
       await markProcessed(cacheKey);
       if(outcome.published===true&&!outcome.duplicate){if(isTruck)publishedTrucks++;else publishedLoads++;}
       lastPublishError='';
       if(channel.endsWith('@newsletter')){
         const sent=await sendNumberedChannelAd(sock,channel,finalParsed,text.slice(0,1200),adId,messageId);
         if(sent?.key?.id)publishedChannel++;
       }else{lastPublishError='Channel unresolved';console.error(lastPublishError);}
       }catch(e){completed=false;messageCompleted=false;lastPublishError=String(e);console.error('Freight part error',JSON.stringify({id:messageId,error:String(e)}));}
       finally{if(freightKey)inFlightFreightTexts.delete(freightKey);freightKey=null;}
       }
     }catch(e){completed=false;messageCompleted=false;lastPublishError=String(e);console.error('Freight processing error',String(e));}
     finally{if(freightKey)inFlightFreightTexts.delete(freightKey);if(retryKey&&messageCompleted)await deliveryStore.remove('retries',retryKey);}
   }
   return completed;
 };
 // Serialize events to avoid processing a source message twice concurrently.
 const enqueueMessages=createPriorityMessageQueue({handleBatch:handleMessages,priority:m=>freightPriority(getText(m.message)),onError:error=>console.error('Message worker error',String(error))});
 const receiveMessages=async(batch)=>{
  if(replacementPhone&&String(sock.user?.id||'').split('@')[0].split(':')[0]!==replacementPhone)return false;
  if(batch.type!=='notify'&&batch.type!=='append')return true;
  for(const m of batch.messages||[]){
   const jid=String(m.key?.remoteJid||''),text=getText(m.message),stamp=Number(m.messageTimestamp||0)*1000;
   if(!text||!acceptsFreightSource(jid,EXCLUDED_GROUPS,ownChannelJids())||!Number.isFinite(stamp)||stamp<=0||stamp>Date.now()+60000||Date.now()-stamp>86400000)continue;
   if(jid.endsWith('@g.us')&&isRelayText(text))continue;
   if(isChannelJid(jid)&&m.key?.fromMe)continue;
   const id=isChannelJid(jid)?channelMessageId(m):m.key?.id;
   if(!id)continue;
   const key=jid+':'+id;
   if(!processedMessages.has(key)&&!deliveryStore.data.retries[key])await deliveryStore.put('retries',key,{message:{key:m.key,messageTimestamp:stamp/1000,message:{conversation:text}},attempts:0,next:Date.now()+30000});
  }
  return enqueueMessages(batch);
 };
 sock.ev.on('messages.upsert',batch=>receiveMessages(batch).catch(error=>{console.error('Durable inbox error',String(error));return false;}));
 const retryPending=async()=>{
  try{
   if(activeSocket===sock&&status==='connected'){
    const due=Object.entries(deliveryStore.data.retries).filter(([,job])=>job.next<=Date.now()).sort(([,a],[,b])=>freightPriority(getText(a.message.message))-freightPriority(getText(b.message.message))).slice(0,20);
    for(const [key,job] of due){
     if(Date.now()-Number(job.message.messageTimestamp)*1000>86400000){await deliveryStore.remove('retries',key);console.warn('Ingest retry expired',key);continue;}
     await enqueueMessages({type:'notify',messages:[job.message]});
    }
    for(const [adId,job] of Object.entries(deliveryStore.data.outbox).filter(([,j])=>['pending','receipt'].includes(j.status)&&j.next<=Date.now()).sort(([,a],[,b])=>freightPriority(a.text)-freightPriority(b.text)).slice(0,20)){
     if(Date.now()-job.at>86400000&&job.status==='pending'){await deliveryStore.put('outbox',adId,{...job,status:'expired'});continue;}
     try{const sent=await sendNumberedChannelAd(sock,String(resolvedChannelJid||process.env.TARGET_CHANNEL_JID||job.channel||''),job.parsed,job.text,adId,job.sourceId);if(sent?.key?.id)publishedChannel++;}
     catch(error){const current=deliveryStore.data.outbox[adId];await deliveryStore.put('outbox',adId,{...current,next:Date.now()+60000});console.warn('Channel delivery pending',JSON.stringify({adId,status:current.status,error:String(error).slice(0,160)}));}
    }
   }
  }catch(error){console.error('Delivery retry worker error',String(error));}
  finally{if(activeSocket===sock){retryTimer=setTimeout(retryPending,30000);retryTimer.unref?.();}}
 };
 retryTimer=setTimeout(retryPending,30000);retryTimer.unref?.();
 channelReader=createChannelReader({sock,isActive:()=>activeSocket===sock&&status==='connected',ownChannels:ownChannelJids,onMessages:receiveMessages,statePath:authDir+'/channel-reader.json'});
 // No automatic private replies. Own-channel copies go only to the owner's verified group.
}
async function startBot(){
 if(!replacementDir){await connect();return;}
 const {state}=await useMultiFileAuthState(replacementDir);
 const savedPhone=String(state.creds.me?.id||'').split('@')[0].split(':')[0];
 // Baileys logs in from creds.me; QR-paired sessions need not set registered.
 // Starting the legacy socket here can leave its login/pre-key request in
 // flight when the selected account opens and closes that old socket.
 if(savedPhone!==replacementPhone)await connect();
 await connect(replacementDir,true);
}
startBot().catch(e=>{status='error';console.error('pairing connection failed',e.message);});
http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/pair-new')){
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
  const access=process.env.PAIRING_MIGRATION_TOKEN;
  if(!access||u.searchParams.get('token')!==access||Date.now()>Number(process.env.PAIRING_MIGRATION_EXPIRES||0)){res.writeHead(403);res.end('Pairing link expired or invalid');return;}
  if(!replacementPhone){res.writeHead(409);res.end('No replacement requested');return;}
  if(req.method==='POST'){
   if(!pendingSocket||!replacementQr||replacementStatus==='connected'){res.writeHead(409);res.end('Pairing is not ready');return;}
   if(Date.now()-codeRequestedAt<60000){res.writeHead(429);res.end('Please wait before requesting another code');return;}
   codeRequestedAt=Date.now();replacementCode='';
   try{const code=String(await pendingSocket.requestPairingCode(replacementPhone)).replace(/[^A-Z0-9]/gi,'').toUpperCase();if(code.length!==8)throw new Error('Invalid pairing code');replacementCode=code;replacementStatus='code_ready';}
   catch{res.writeHead(502);res.end('Could not request pairing code; use QR or retry later');return;}
   res.writeHead(303,{Location:'/pair-new?token='+encodeURIComponent(access)});res.end();return;
  }
  if(u.pathname==='/pair-new/status'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({status:replacementStatus,phone:replacementPhone,code:replacementCode,qrAvailable:!!replacementQr}));return;}
  if(u.pathname==='/pair-new/qr'){if(!replacementQr||replacementCode){res.writeHead(409);res.end('QR unavailable');return;}res.writeHead(200,{'Content-Type':'image/svg+xml'});res.end(await QRCode.toString(replacementQr,{type:'svg'}));return;}
  const pairingUrl='/pair-new?token='+encodeURIComponent(access);
  const stateText=({starting:'جارٍ تجهيز الربط',scan:'جاهز لمسح الرمز',code_ready:'أدخل الكود في واتساب',connected:'تم ربط الرقم الجديد وإيقاف اتصال الرقم السابق',wrong_number:'تم مسح الرمز من رقم مختلف؛ لم يتم تفعيل الاستبدال',reconnecting:'جارٍ الاتصال',logged_out:'انتهت جلسة الربط'})[replacementStatus]||'جارٍ التجهيز';
  res.setHeader('Content-Security-Policy',"default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'");
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
  res.end(`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="10"><title>ربط واتساب TruckLink</title><style>body{font-family:system-ui;max-width:480px;margin:32px auto;padding:20px;text-align:center;background:#f3faf6;color:#173c2d}img{width:280px;max-width:90%}button{padding:14px;border:0;border-radius:8px;background:#147a51;color:white;font-size:18px}.code{font-size:36px;font-weight:bold;letter-spacing:4px}</style><h1>ربط واتساب TruckLink</h1><p dir="ltr">+${replacementPhone}</p><p>${stateText}</p>${replacementCode?`<p class="code" dir="ltr">${replacementCode.slice(0,4)}-${replacementCode.slice(4)}</p><p>واتساب ← الأجهزة المرتبطة ← ربط جهاز ← الربط برقم الهاتف، ثم أدخل الكود.</p>`:replacementQr?`<img alt="رمز ربط واتساب" src="/pair-new/qr?token=${encodeURIComponent(access)}"><p>امسح الرمز من واتساب الرقم الجديد ← الأجهزة المرتبطة ← ربط جهاز.</p><form method="post" action="${pairingUrl}"><button>الربط بكود على نفس الهاتف</button></form>`:''}<p>بعد الربط، يجب أن يكون الرقم الجديد عضوًا في مجموعات الشحن ومشرفًا في القناة.</p></html>`);return;
 }
 if(u.pathname==='/health'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({revision:'offline-recovery-20261020',connectionRecovery,freightPriority:'syria_first',groupRelay:groupRelay.snapshot(),delivery:deliveryStore.stats(),channelReader:channelReaderStatus,receivedChannelMessages,channelBrand,messageDiagnostics,ai:getAIStatus(),replacementStatus,ingestConnectionStatus,learnedPlaces,placeLearningStatus,knownPlaces:cityCountry.size,manualPublication,excludedGroups:EXCLUDED_GROUPS.size,monitoredGroupCount,status,privateMessaging:false,receivedGroupMessages,publishedLoads,publishedTrucks,publishedChannel,channelResolved:!!resolvedChannelJid,groupCount,lastReceivedAt}));return;}
 const token=process.env.PAIRING_TOKEN;
 if(!token||u.searchParams.get('token')!==token){res.writeHead(403);res.end('Forbidden');return;}
 res.setHeader('Cache-Control','no-store');
 if(u.pathname==='/qr'&&qr){res.writeHead(200,{'Content-Type':'image/svg+xml'});res.end(await QRCode.toString(qr,{type:'svg'}));return;}
 res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({revision:'account-migration-20261009',replacementStatus,ingestConnectionStatus,learnedPlaces,placeLearningStatus,knownPlaces:cityCountry.size,manualPublication,excludedGroups:EXCLUDED_GROUPS.size,monitoredGroupCount,receivedGroupMessages,publishedLoads,publishedTrucks,publishedChannel,lastReceivedAt,lastPublishError,status,qrAvailable:!!qr,privateMessaging:false,channelResolved:!!resolvedChannelJid,groupCount,groupCheckError,postingConfigured:!!(process.env.SUPABASE_URL&&process.env.TRUCKLINK_INGEST_TOKEN)}));
}).listen(Number(process.env.PORT||3000),'0.0.0.0');










