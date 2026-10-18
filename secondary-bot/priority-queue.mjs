// Finish the current message, then prefer Syrian freight among waiting messages.
// Keep arrival order within each priority and resolve a batch only after all its jobs.
export function createPriorityMessageQueue({handleBatch,priority,onError=()=>{}}){
 const waiting=[];let running=false,sequence=0;
 async function drain(){
  try{
   while(waiting.length){
    waiting.sort((a,b)=>a.rank-b.rank||a.sequence-b.sequence);
    const job=waiting.shift();
    try{if(await handleBatch({type:job.type,messages:[job.message]})===false)job.batch.ok=false;}
    catch(error){job.batch.ok=false;onError(error);}
    finally{if(--job.batch.remaining===0)job.batch.resolve(job.batch.ok);}
   }
  }finally{running=false;}
 }
 return ({messages=[],type})=>new Promise(resolve=>{
  if(!messages.length){resolve(true);return;}
  const batch={remaining:messages.length,ok:true,resolve};
  for(const message of messages)waiting.push({message,type,rank:priority(message),sequence:sequence++,batch});
  if(!running){running=true;queueMicrotask(drain);}
 });
}
