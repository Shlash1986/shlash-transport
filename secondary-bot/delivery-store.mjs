import {readFile,writeFile,rename,rm,statfs,opendir,lstat} from 'node:fs/promises';

import {gzip,gunzip,constants} from 'node:zlib';
import {promisify} from 'node:util';
import {dirname,join} from 'node:path';

const compress=promisify(gzip);
const decompress=promisify(gunzip);

const CLEANUP_INTERVAL_MS=60*1000;
export const FREIGHT_RETENTION_MS=60*60*1000;

// The Railway volume survives restarts. Never persist credentials or media keys.
export async function createDeliveryStore(path,now=()=>Date.now()){
 let data={version:1,processed:{},freight:{},retries:{},outbox:{}};
 if(path){
  // A stopped writer can leave a partial temporary copy on the full volume.
  await rm(path+'.tmp',{force:true});
  const disk=await statfs(dirname(path)).catch(()=>null);
  if(disk)console.info('Delivery volume available MiB',Math.floor(disk.bavail*disk.bsize/1048576));
  if(disk && disk.bavail*disk.bsize<64*1048576 && path.startsWith('/data/')){
   const sizes={delivery:0,session:0,other:0};
   async function measure(folder){
    for await(const entry of await opendir(folder)){
     const child=join(folder,entry.name);
     if(entry.isDirectory())await measure(child);
     else if(entry.isFile()){
      const category=child===path?'delivery':child.includes('/wa-session-')?'session':'other';
      sizes[category]+=(await lstat(child)).size;
     }
    }
   }
   await measure('/data').catch(()=>{});
   console.info('Delivery volume file bytes',JSON.stringify(sizes));
  }
  try{
   const bytes=await readFile(path);
   const decoded=bytes[0]===0x1f && bytes[1]===0x8b ? await decompress(bytes) : bytes;
   const saved=JSON.parse(decoded.toString('utf8'));
   if(saved.version!==1||['processed','freight','retries','outbox'].some(k=>!saved[k]||typeof saved[k]!=='object'||Array.isArray(saved[k])))throw new Error('Invalid delivery state');
   data=saved;
  }catch(error){if(error.code!=='ENOENT')throw error;}
 }
 let writes=Promise.resolve();
 function save(){
  if(!path)return Promise.resolve();
  const task=writes.then(async()=>{const bytes=await compress(JSON.stringify(data),{level:constants.Z_BEST_SPEED});try{await writeFile(path+'.tmp',bytes,{mode:0o600});await rename(path+'.tmp',path);}catch(error){await rm(path+'.tmp',{force:true});if(error.code!=='ENOSPC')throw error;const previous=await lstat(path).catch(()=>null);if(!previous||previous.size<=bytes.length)throw error;/* Freight-only cache: reclaim its old blocks when atomic replacement cannot fit. Never touch auth files. */await rm(path,{force:true});await writeFile(path,bytes,{mode:0o600});console.warn('Freight cache compacted under disk pressure');}});
  writes=task.catch(()=>{});return task;
 }
 function prune(){
  const stamp=now();
  let changed=false;
  for(const bucket of ['processed','freight','retries','outbox']){
   for(const [key,value] of Object.entries(data[bucket])){
    const at=bucket==='retries' ? Number(value.message?.messageTimestamp)*1000 :
     bucket==='outbox' ? value.at : value;
    if(!(Number(at)>stamp-FREIGHT_RETENTION_MS)){
     delete data[bucket][key];
     changed=true;
    }
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
  setInterval(()=>{void cleanup();},CLEANUP_INTERVAL_MS).unref();
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