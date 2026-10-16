import {readFile,writeFile,rename} from 'node:fs/promises';
import {proto} from '@whiskeysockets/baileys';
import {executeWMexQuery} from '@whiskeysockets/baileys/lib/Socket/mex.js';

export const isChannelJid=jid=>/^[0-9]+@newsletter$/.test(String(jid||''));
export function acceptsFreightSource(jid,excludedGroups,ownChannels){
 if(String(jid).endsWith('@g.us'))return !excludedGroups.has(jid);
 return isChannelJid(jid)&&!ownChannels.includes(jid);
}
export function channelMessageId(message){
 const id=String(message.key?.server_id||message.server_id||message.key?.id||'');
 return id?'channel:'+id:null;
}
export async function fetchChannelMessages(sock,jid,count=100){
 // Current WA Web request shape; the legacy message_updates IQ times out.
 // WhiskeySockets/Baileys commit 5f1f1181d0a5534b4227b7619ac4dba5e5e76e92.
 // Fetch the latest page and apply timestamp checkpoints locally. `before`
 // and `after` are message cursors, not our Unix timestamp checkpoint.
 const response=await sock.query({tag:'iq',attrs:{type:'get',to:'s.whatsapp.net',xmlns:'newsletter'},content:[{tag:'messages',attrs:{type:'jid',jid,count:String(count)}}]},15000);
 if(!response||!Array.isArray(response.content)||!response.content.some(node=>node.tag==='messages'))throw new Error('Invalid channel messages response; checkpoint retained');
 return response;
}
export function subscribedChannels(value){
 const found=new Map();
 function visit(node,depth=0){
  if(!node||typeof node!=='object'||depth>8)return;
  if(isChannelJid(node.id)){
   const name=node.thread_metadata?.name?.text||node.name?.text||node.name||'';
   found.set(node.id,{id:node.id,name:typeof name==='string'?name.slice(0,120):''});
   return;
  }
  for(const item of Object.values(node))if(item&&typeof item==='object')visit(item,depth+1);
 }
 visit(value);
 return [...found.values()];
}
export function decodeChannelMessages(root,jid,decode=bytes=>proto.Message.decode(bytes)){
 const result=[];
 function visit(node,depth=0){
  if(!node||depth>8||typeof node!=='object')return;
  if(node.tag==='message'){
   const attrs=node.attrs||{};
   const plaintext=Array.isArray(node.content)?node.content.find(child=>child.tag==='plaintext'):null;
   const id=attrs.server_id||attrs.message_id||attrs.id;
   const timestamp=Number(attrs.t||attrs.timestamp);
   // Reactions, deleted posts, or incomplete records must never become adverts.
   if(plaintext?.content&&id&&Number.isFinite(timestamp)&&timestamp>0){
    const bytes=typeof plaintext.content==='string'?Buffer.from(plaintext.content,'binary'):Buffer.from(plaintext.content);
    result.push({key:{remoteJid:jid,id:String(id),server_id:String(id),fromMe:false},message:decode(bytes),messageTimestamp:timestamp});
   }
   return;
  }
  if(Array.isArray(node.content))for(const child of node.content)visit(child,depth+1);
 }
 visit(root);
 return result.sort((a,b)=>a.messageTimestamp-b.messageTimestamp);
}

// Only read the channels already followed by the connected WhatsApp account.
// The subscribed-list query is documented in WhiskeySockets/Baileys#1631.
// Initial activation starts now, so enabling the reader never republishes history.
export function createChannelReader({sock,isActive,ownChannels,onMessages,statePath,now=()=>Date.now(),listChannels,log=console}){
 const state={enabled:true,status:'starting',followed:0,monitored:0,lastDiscoveryAt:null,lastPollAt:null,received:0,errors:0,lastError:null};
 const sources=new Map();
 let checkpoints={},initialized=false,stopped=false,busy=false,timer=null,nextDiscovery=0,cooldownUntil=0,discoveryError=null;
 const list=listChannels||(()=>executeWMexQuery({},'6388546374527196','xwa2_newsletter_subscribed',sock.query,sock.generateMessageTag));
 const allowed=jid=>isChannelJid(jid)&&!ownChannels().includes(jid);
 const seconds=()=>Math.floor(now()/1000);
 async function save(){
  if(!statePath)return;
  await writeFile(statePath+'.tmp',JSON.stringify(checkpoints));
  await rename(statePath+'.tmp',statePath);
 }
 async function load(){
  if(initialized)return;
  initialized=true;
  if(!statePath)return;
  try{
   const data=JSON.parse(await readFile(statePath,'utf8'));
   for(const [jid,value] of Object.entries(data))if(allowed(jid)&&Number.isSafeInteger(value?.since)&&Number.isSafeInteger(value?.floor)&&value.since>0&&value.since<=seconds())checkpoints[jid]=value;
  }catch(error){if(error.code!=='ENOENT')log.warn('Channel checkpoints unavailable',error.message);}
 }
 function failure(error){
  state.errors++;state.status='degraded';state.lastError=String(error?.message||error).slice(0,180);
  log.warn('Channel reader error',state.lastError);
  if(/rate.overlimit|429/i.test(state.lastError))cooldownUntil=now()+60*60*1000;
 }
 async function tick(){
  if(stopped||busy||!isActive()||now()<cooldownUntil)return;
  busy=true;
  const errorsBefore=state.errors;
  try{
   await load();
   if(now()>=nextDiscovery){
    try{
    // Back off failed discovery independently from the ordinary group listener.
    nextDiscovery=now()+30*60*1000;
    const response=await list();
    if(!response||typeof response!=='object')throw new Error('Invalid subscribed channel list');
    const channels=subscribedChannels(response);
    if(!Array.isArray(response)&&Object.keys(response).length&&channels.length===0)throw new Error('Unrecognized subscribed channel list');
    const keep=new Set(channels.filter(c=>allowed(c.id)).map(c=>c.id));
    for(const jid of sources.keys())if(!keep.has(jid)){sources.delete(jid);delete checkpoints[jid];}
    for(const channel of channels){
     if(!allowed(channel.id))continue;
     if(!sources.has(channel.id))sources.set(channel.id,{...channel,subscribeAt:0,pollAt:0,failures:0,lastError:null});
     checkpoints[channel.id]??={since:seconds(),floor:seconds()};
    }
    state.followed=channels.length;state.monitored=sources.size;state.lastDiscoveryAt=new Date(now()).toISOString();
    log.info('Followed WhatsApp channels',JSON.stringify(channels.map(c=>({...c,monitored:allowed(c.id)}))));
    discoveryError=null;await save();
    }catch(error){discoveryError=String(error?.message||error);failure(error);}
   }
   for(const [jid,source] of sources){
    if(stopped||!isActive()||now()<cooldownUntil)break;
    if(!allowed(jid))continue;
    if(now()<source.pollAt)continue;
    try{
     if(now()>=source.subscribeAt){
      source.subscribeAt=now()+300000;
      try{
      const subscription=await sock.subscribeNewsletterUpdates(jid);
      const duration=Number(subscription?.duration);
      source.subscribeAt=now()+Math.max(60,Number.isFinite(duration)&&duration>0?duration-30:240)*1000;
      }catch(error){log.warn('Channel live subscription unavailable; polling continues',String(error?.message||error).slice(0,120));}
     }
     if(now()<source.pollAt)continue;
     source.pollAt=now()+120000;
     const checkpoint=checkpoints[jid];
     // A one-minute overlap handles delayed notifications; stable IDs deduplicate it.
     const since=Math.max(seconds()-86400,checkpoint.floor,checkpoint.since-60);
     const pollStarted=seconds();
     const response=await fetchChannelMessages(sock,jid,100);
     const messages=decodeChannelMessages(response,jid).filter(m=>m.messageTimestamp>=since&&m.messageTimestamp<=seconds()+60);
     if(messages.length>=100)throw new Error('Channel poll reached 100-message limit; checkpoint retained');
     if(messages.length){
      const ok=await onMessages({messages,type:'append'});
      if(ok===false)throw new Error('Channel ingestion incomplete; checkpoint retained');
      state.received+=messages.length;
     }
     checkpoint.since=pollStarted;
     source.failures=0;source.lastError=null;
     state.lastPollAt=new Date(now()).toISOString();
     await save();
    }catch(error){source.failures++;source.lastError=String(error?.message||error).slice(0,180);source.pollAt=now()+Math.min(900000,120000*2**Math.min(source.failures-1,3));failure(error);}
   }
   const outstanding=discoveryError||[...sources.values()].find(s=>s.lastError)?.lastError;
   state.status=outstanding?'degraded':'active';state.lastError=outstanding||null;
  }catch(error){failure(error);}
  finally{busy=false;}
 }
 return {
  state,tick,
  start(){if(stopped)return;void tick();if(!timer){timer=setInterval(()=>{void tick();},30000);timer.unref?.();}},
  stop(){stopped=true;if(timer)clearInterval(timer);timer=null;}
 };
}
