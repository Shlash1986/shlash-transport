import assert from 'node:assert/strict';
import test from 'node:test';
const keys=['AI_ENABLED','AI_PROVIDER','GROQ_API_KEY','GROQ_MODEL','OPENAI_API_KEY','OPENAI_MODEL'];
let sequence=0;
async function runtime(env={}){
 for(const key of keys)delete process.env[key];
 Object.assign(process.env,{AI_ENABLED:'true',...env});
 return import('./ai-runtime.mjs?case='+sequence++);
}
const freight='مطلوب شاحنة من حمص إلى العقبة';
const result={publish:true,kind:'load',from_city:'حمص',to_city:'العقبة',from_country:'سوريا',to_country:'الأردن',cargo_type:null,vehicle_type:'شاحنة',weight_tons:null,trucks_required:1,confidence:0.95};
const response=(value=result,finish='stop',refusal=null)=>({ok:true,json:async()=>({choices:[{finish_reason:finish,message:{content:JSON.stringify(value),refusal}}]})});
const groq={GROQ_API_KEY:'groq-test-key-not-real'};
let unexpectedRequests=0;
const noFetch=async()=>{unexpectedRequests++;throw Error('Unexpected network request');};

test('missing key, disabled AI, non-freight and invalid provider make no requests',async()=>{
 let ai=await runtime();
 assert.equal(ai.getAIStatus().status,'not_configured');assert.equal(ai.getAIStatus().provider,'groq');
 assert.equal(await ai.extractFreightAd(freight,{fetchImpl:noFetch}),null);
 ai=await runtime({...groq,AI_ENABLED:'false'});
 assert.equal(await ai.extractFreightAd(freight,{fetchImpl:noFetch}),null);assert.equal(ai.getAIStatus().status,'disabled');
 ai=await runtime(groq);assert.equal(await ai.extractFreightAd('السلام عليكم',{fetchImpl:noFetch}),null);
 ai=await runtime({...groq,AI_PROVIDER:'https://untrusted.example'});
 assert.equal(await ai.extractFreightAd(freight,{fetchImpl:noFetch}),null);assert.equal(ai.getAIStatus().status,'invalid_provider');
 assert.equal(unexpectedRequests,0);
});

test('Groq uses its own key, supported model and strict schema',async()=>{
 const ai=await runtime(groq);let called=false;
 assert.equal(ai.getAIStatus().status,'configured_unverified');
 assert.deepEqual(await ai.extractFreightAd(freight,{fetchImpl:async(url,options)=>{
  called=true;assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(options.headers.Authorization,'Bearer '+groq.GROQ_API_KEY);assert(options.signal instanceof AbortSignal);
  const body=JSON.parse(options.body);
  assert.equal(body.model,'openai/gpt-oss-120b');assert.equal(body.reasoning_effort,'low');
  assert.equal(body.max_completion_tokens,2048);assert(!('store' in body));assert(!('max_tokens' in body));
  assert.equal(body.response_format.json_schema.strict,true);
  const schema=body.response_format.json_schema.schema;
  assert.equal(schema.additionalProperties,false);assert.deepEqual(schema.required,Object.keys(schema.properties));
  assert(!('contact_phone' in schema.properties));return response();
 }}),result);
 assert(called);assert.equal(ai.getAIStatus().status,'ready');assert.equal(ai.getAIStatus().accepted,1);
 assert(!JSON.stringify(ai.getAIStatus()).includes(groq.GROQ_API_KEY));
});

test('phone numbers, contact links and emails are removed from provider input',async()=>{
 const ai=await runtime(groq);
 assert.deepEqual(await ai.extractFreightAd(freight+' 24 طن +963 999 123 456 ٠٩٩٩١٢٣٤٥٦ person@example.test https://wa.me/963999123456',{fetchImpl:async(url,options)=>{
  const text=JSON.parse(options.body).messages[1].content;
  assert(text.includes('24 طن'));assert(text.includes('حمص'));assert(text.includes('العقبة'));
  assert(!text.includes('999'));assert(!text.includes('٠٩٩٩'));assert(!text.includes('person@'));assert(!text.includes('wa.me'));
  return response();
 }}),result);
});

test('existing OpenAI installations preserve endpoint and request options',async()=>{
 const ai=await runtime({OPENAI_API_KEY:'openai-test-key',OPENAI_MODEL:'gpt-4o-mini'});
 assert.equal(ai.getAIStatus().provider,'openai');
 assert.deepEqual(await ai.extractFreightAd(freight,{fetchImpl:async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/chat/completions');
  assert.equal(options.headers.Authorization,'Bearer openai-test-key');
  const body=JSON.parse(options.body);assert.equal(body.model,'gpt-4o-mini');assert.equal(body.store,false);assert.equal(body.max_tokens,800);
  assert(!('reasoning_effort' in body));return response();
 }}),result);
});

test('explicit Groq selection never uses or falls back to OpenAI credentials',async()=>{
 let ai=await runtime({AI_PROVIDER:'groq',OPENAI_API_KEY:'openai-test-key'});
 assert.equal(ai.getAIStatus().status,'not_configured');
 assert.equal(await ai.extractFreightAd(freight,{fetchImpl:noFetch}),null);
 assert.equal(unexpectedRequests,0);
 ai=await runtime({...groq,AI_PROVIDER:'groq',OPENAI_API_KEY:'openai-test-key'});
 const urls=[];
 assert.equal(await ai.extractFreightAd(freight,{fetchImpl:async(url,options)=>{
  urls.push(url);assert.equal(options.headers.Authorization,'Bearer '+groq.GROQ_API_KEY);return {ok:false,status:503};
 }}),null);
 assert.deepEqual(urls,['https://api.groq.com/openai/v1/chat/completions']);assert.equal(ai.getAIStatus().status,'http_503');
});

test('cache prevents repeated inference and separates models',async()=>{
 const ai=await runtime(groq);let calls=0;
 const fetchImpl=async()=>{calls++;return response();};
 await ai.extractFreightAd(freight,{fetchImpl});await ai.extractFreightAd(freight,{fetchImpl});assert.equal(calls,1);
 process.env.GROQ_MODEL='openai/gpt-oss-20b';
 await ai.extractFreightAd(freight,{fetchImpl});assert.equal(calls,2);
});

test('429 respects retry-after without retrying or switching providers',async()=>{
 const ai=await runtime(groq),clock=Date.now;let now=clock();Date.now=()=>now;
 let calls=0;const fetchImpl=async()=>{calls++;return calls===1?{ok:false,status:429,headers:{get:()=> '120'}}:response();};
 try{
  assert.equal(await ai.extractFreightAd(freight,{fetchImpl}),null);
  now+=61000;assert.equal(await ai.extractFreightAd(freight,{fetchImpl}),null);assert.equal(calls,1);
  now+=60000;assert.deepEqual(await ai.extractFreightAd(freight,{fetchImpl}),result);assert.equal(calls,2);
 }finally{Date.now=clock;}
});

test('Groq burst cap returns control after two uncached requests',async()=>{
 const ai=await runtime(groq);let calls=0;const fetchImpl=async()=>{calls++;return response();};
 await ai.extractFreightAd(freight+' أ',{fetchImpl});await ai.extractFreightAd(freight+' ب',{fetchImpl});
 assert.equal(await ai.extractFreightAd(freight+' ج',{fetchImpl}),null);assert.equal(calls,2);
 assert.equal(ai.getAIStatus().status,'rate_limited');assert.equal(ai.getAIStatus().requests,2);
});

test('refusal, truncation, malformed fields and network failures fail closed',async()=>{
 for(const fetchImpl of [
  async()=>response(result,'stop','refused'),async()=>response(result,'length'),
  async()=>response({publish:true}),async()=>response({...result,confidence:1.5}),
  async()=>response({...result,trucks_required:'2'}),async()=>response({...result,from_country:'invented'}),
  async()=>response({...result,contact_phone:'invented'}),async()=>response({...result,weight_tons:-5}),
  async()=>({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'invalid JSON'}}]})}),
  async()=>{throw Error('timeout');},async()=>({ok:false,status:401})
 ]){
  const ai=await runtime(groq);assert.equal(await ai.extractFreightAd(freight,{fetchImpl}),null);assert.equal(ai.getAIStatus().accepted,0);
 }
});

test('available trucks may have no destination',async()=>{
 const ai=await runtime(groq),truck={...result,kind:'truck_available',to_city:null,to_country:null};
 assert.deepEqual(await ai.extractFreightAd('شاحنة فاضية بحمص',{fetchImpl:async()=>response(truck)}),truck);
});
