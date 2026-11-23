import {readFile,writeFile,rename} from 'node:fs/promises';

const SIX_HOURS=6*60*60*1000;
const DAY=24*60*60*1000;

// The Railway volume survives restarts. Never persist credentials or media keys.
export async function createDeliveryStore(path,now=()=>Date.now()){
 let data={version:1,processed:{},freight:{},retries:{},outbox:{}};
 if(path){
  try{
   const saved=JSON.parse(await readFile(path,'utf8'));
   if(saved.version!==1||['processed','freight','retries','outbox'].some(k=>!saved[k]||typeof saved[k]!=='object'||Array.isArray(saved[k])))throw new Error('Invalid delivery state');
   data=saved;
  }catch(error){if(error.code!=='ENOENT')throw error;}
 }
 let writes=Promise.resolve();
 function save(){
  if(!path)return Promise.resolve();
  const task=writes.then(async()=>{await writeFile(path+'.tmp',JSON.stringify(data),{mode:0o600});await rename(path+'.tmp',path);});
  writes=task.catch(()=>{});return task;
 }
 function prune(){
  const stamp=now();
  let changed=false;
  // Retain only identifiers for the full WhatsApp replay window.
  for(const name of ['processed','freight']){
   for(const [key,at] of Object.entries(data[name])){
    if(stamp-at>=DAY){delete data[name][key];changed=true;}
   }
  }
  for(const [key,job] of Object.entries(data.outbox)){
   if(job.status!=='sent'&&job.status!=='expired')continue;
   const age=stamp-(job.completedAt??job.at);
   if(age>=DAY){delete data.outbox[key];changed=true;}
   else if(age>=SIX_HOURS&&!job.compacted){
    data.outbox[key]={at:job.at,completedAt:job.completedAt??job.at,status:job.status,compacted:true};
    changed=true;
   }
  }
  return changed;
 }
 let cleanupPending=false;
 async function cleanup(){
  cleanupPending=prune()||cleanupPending;
  if(cleanupPending){
   try{await save();cleanupPending=false;}
   catch(error){console.warn('Delivery cleanup pending',error.code||error.message);}
  }
 }
 if(path){
  await cleanup();
  setInterval(()=>{void cleanup();},60000).unref();
 }
 return {data,save,
  async put(bucket,key,value){
   if(bucket==='outbox'&&(value.status==='sent'||value.status==='expired')){
    value={...value,completedAt:data.outbox[key]?.completedAt??now()};
   }
   data[bucket][key]=value;prune();await save();return value;
  },
  async remove(bucket,key){delete data[bucket][key];await save();},
  stats(){const jobs=Object.values(data.outbox);return {pendingIngest:Object.keys(data.retries).length,pendingChannel:jobs.filter(j=>j.status==='pending'||j.status==='receipt').length,uncertainChannel:jobs.filter(j=>j.status==='sending').length,failedChannel:jobs.filter(j=>j.status==='expired').length};}
 };
}
