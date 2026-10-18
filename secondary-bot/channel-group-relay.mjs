import {createHash} from 'node:crypto';
import {createDeliveryStore} from './delivery-store.mjs';
import {createChannelReader} from './channel-reader.mjs';

export const RELAY_CHANNEL='120363428757778414@newsletter';
export const RELAY_GROUP_INVITE='ENfU2aCppVa545mZW7W5Y3';
// This exact invite-to-JID mapping is also used by refreshJoinedGroups in
// index.js. Verify existing membership, not admission through an invite link.
export const RELAY_GROUP='120363431703780865@g.us';
export const RELAY_LINKS={
 site:'https://easttrucks.com/',
 channel:'https://whatsapp.com/channel/0029Vb88HmiK0IBl4La1aC1Q',
 group:'https://chat.whatsapp.com/'+RELAY_GROUP_INVITE
};
const DAY=86400000;
export function isRelayText(text){return Object.values(RELAY_LINKS).every(link=>String(text||'').includes(link));}
export function formatGroupRelay(text){
 const body=String(text||'').trim();
 const links=[['🌐 منصة شاحنات الشرق',RELAY_LINKS.site],['👥 قروب شاحنات الشرق',RELAY_LINKS.group],['📢 قناة الحمولات',RELAY_LINKS.channel]];
 return [body,...links.filter(([,url])=>!body.includes(url)).map(([label,url])=>label+'\n'+url)].join('\n\n');
}
function messageText(message){
 let content=message;
 for(let i=0;i<8&&content;i++){
  // Edits and deletions must not create a second public post.
  if(content.protocolMessage||content.editedMessage)return '';
  const inner=content.ephemeralMessage?.message||content.viewOnceMessage?.message||content.viewOnceMessageV2?.message;
  if(!inner)break;
  content=inner;
 }
 return String(content?.conversation||content?.extendedTextMessage?.text||content?.imageMessage?.caption||content?.videoMessage?.caption||content?.documentMessage?.caption||'').trim();
}
const identity=jid=>String(jid||'').replace(/:\d+@/,'@');

// Dedicated, durable queue: failures here never block publishing on the platform
// or channel. No old posts are imported on initial activation, and an uncertain
// WhatsApp send is held for review instead of being blindly sent a second time.
export async function createChannelGroupRelay({path,now=()=>Date.now(),log=console,readerFactory=createChannelReader,enabled=process.env.CHANNEL_GROUP_RELAY_ENABLED==='true'}={}){
 // Group forwarding is opt-in. Channel/platform publication stays independent.
 // Return before opening the durable queue so old pending posts cannot resume.
 if(!enabled)return {
  accept:async()=>false,observeSent:async()=>false,
  connect(){},disconnect(){},drain:async()=>{},
  snapshot:()=>({enabled:false,status:'disabled',groupResolved:false,groupName:null,lastSentAt:null,lastError:null,unsupported:0,since:null,pending:0,sent:0,uncertain:0,reader:null})
 };
 const store=await createDeliveryStore(path,now);
 if(!Number.isFinite(store.data.relaySince)){store.data.relaySince=Math.floor(now()/1000)*1000;await store.save();}
 let sock=null,isActive=()=>false,reader=null,timer=null,group=null,verifyAt=0,cooldownUntil=0;
 let work=Promise.resolve();
 const state={enabled:true,status:'waiting',groupResolved:false,groupName:null,lastSentAt:null,lastError:null,unsupported:0};
 const serial=fn=>{const task=work.then(fn);work=task.catch(()=>{});return task;};
 const active=()=>sock&&isActive();
 function failure(error){state.lastError=String(error?.message||error).slice(0,180);state.status='blocked';log.warn('Channel group relay pending',state.lastError);}
 async function resolveGroup(){
  if(group&&now()<verifyAt)return group;
  const current=sock;
  const metadata=await current.groupMetadata(RELAY_GROUP);
  if(metadata?.id!==RELAY_GROUP||metadata.isCommunity)throw new Error('Target must be the configured message group');
  const self=new Set([current.user?.id,current.user?.lid].filter(Boolean).map(identity));
  const member=(metadata.participants||[]).find(p=>[p.id,p.lid,p.jid,p.phoneNumber].some(id=>self.has(identity(id))));
  if(!member)throw new Error('Bot is not a member of the target group');
  if(metadata.announce&&!member.admin)throw new Error('Target group requires bot administrator permission');
  if(current!==sock||!active())throw new Error('Connection changed during group verification');
  group={id:metadata.id};verifyAt=now()+5*60*1000;
  state.groupResolved=true;state.groupName=metadata.subject||null;
  log.info('Channel group relay target verified',JSON.stringify({id:group.id,name:state.groupName}));
  return group;
 }
 async function drain(){
  return serial(async()=>{
   if(!active()||now()<cooldownUntil)return;
   try{
    const target=await resolveGroup();
    state.status='active';state.lastError=null;
    for(const [key,job] of Object.entries(store.data.outbox).filter(([,j])=>j.status==='pending').slice(0,10)){
     if(!active())return;
     if(now()-job.at>DAY){await store.put('outbox',key,{...job,status:'expired'});continue;}
     await store.put('outbox',key,{...job,status:'sending',group:target.id});
     const current=sock;
     const sent=await current.sendMessage(target.id,{text:formatGroupRelay(job.text),linkPreview:null});
     if(!sent?.key?.id)throw new Error('Group send outcome uncertain: missing message ID');
     await store.put('outbox',key,{...job,status:'sent',group:target.id,messageId:sent.key.id});
     state.lastSentAt=new Date(now()).toISOString();
     log.info('Channel group relay sent',JSON.stringify({sourceId:job.sourceId,messageId:sent.key.id,group:target.id}));
    }
   }catch(error){
    group=null;state.groupResolved=false;cooldownUntil=now()+(/rate.overlimit|429/i.test(String(error))?60*60*1000:60000);failure(error);
   }
  });
 }
 async function accept(message){
  if(message.key?.remoteJid!==RELAY_CHANNEL)return false;
  const stamp=Number(message.messageTimestamp)*1000;
  if(!Number.isFinite(stamp)||stamp<Math.max(store.data.relaySince,now()-DAY)||stamp>now()+60000)return false;
  const text=messageText(message.message);
  if(!text){state.unsupported++;return false;}
  const sourceId=String(message.key?.server_id||message.server_id||message.key?.id||'');
  if(!sourceId)return false;
  const accepted=await serial(async()=>{
   const fingerprint=createHash('sha256').update(text.replace(/\s+/gu,' ').trim()).digest('hex');
   const previous=store.data.outbox[fingerprint];
   if(store.data.processed[sourceId]||previous&&(['pending','sending'].includes(previous.status)||now()-previous.at<=DAY))return false;
   await store.put('outbox',fingerprint,{at:stamp,text,sourceId,status:'pending'});
   await store.put('processed',sourceId,now());
   return true;
  });
  if(accepted)void drain().catch(failure);
  return accepted;
 }
 function disconnect(current){
  if(current!==sock)return;
  reader?.stop();reader=null;if(timer)clearInterval(timer);timer=null;
  sock=null;group=null;state.groupResolved=false;state.status='disconnected';
 }
 function connect(current,check){
  if(sock)disconnect(sock);
  sock=current;isActive=check;verifyAt=0;cooldownUntil=0;state.status='starting';
  reader=readerFactory({sock:current,isActive:()=>sock===current&&active(),ownChannels:()=>[],listChannels:async()=>[{id:RELAY_CHANNEL,name:'شاحنات الشرق'}],onMessages:async({messages})=>{for(const m of messages)await accept(m);return true;},statePath:path?path+'.reader':null,initialSince:Math.floor(store.data.relaySince/1000),now,log});
  reader.start();void drain().catch(failure);
  timer=setInterval(()=>{void drain().catch(failure);},30000);timer.unref?.();
 }
 return {accept,connect,disconnect,drain,
  observeSent:async(channel,sent,text)=>accept({key:{remoteJid:channel,id:sent.key.id},message:{conversation:text},messageTimestamp:Math.floor(now()/1000)}),
  snapshot(){const jobs=Object.values(store.data.outbox);return {...state,since:new Date(store.data.relaySince).toISOString(),pending:jobs.filter(j=>j.status==='pending').length,sent:jobs.filter(j=>j.status==='sent').length,uncertain:jobs.filter(j=>j.status==='sending').length,reader:reader?.state||null};}
 };
}
