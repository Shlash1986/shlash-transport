import {readFile,writeFile,rename} from 'node:fs/promises';

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
  for(const name of ['processed','freight'])for(const [key,at] of Object.entries(data[name]))if(now()-at>86400000)delete data[name][key];
  for(const [key,job] of Object.entries(data.outbox))if(job.status==='sent'&&now()-job.at>86400000)delete data.outbox[key];
 }
 prune();
 return {data,save,
  async put(bucket,key,value){data[bucket][key]=value;prune();await save();return value;},
  async remove(bucket,key){delete data[bucket][key];await save();},
  stats(){const jobs=Object.values(data.outbox);return {pendingIngest:Object.keys(data.retries).length,pendingChannel:jobs.filter(j=>j.status==='pending'||j.status==='receipt').length,uncertainChannel:jobs.filter(j=>j.status==='sending').length,failedChannel:jobs.filter(j=>j.status==='expired').length};}
 };
}
