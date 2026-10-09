import makeWASocket,{useMultiFileAuthState,DisconnectReason} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import {mkdir} from 'node:fs/promises';
import http from 'node:http';
const dir='/data/wa-session-secondary-repair-20261009';
await mkdir(dir,{recursive:true});
let qr='',status='starting';
async function connect(){
 const {state,saveCreds}=await useMultiFileAuthState(dir);
 const sock=makeWASocket({auth:state,printQRInTerminal:false,markOnlineOnConnect:false,syncFullHistory:false,getMessage:async()=>undefined});
 sock.ev.on('creds.update',saveCreds);
 sock.ev.on('connection.update',({connection,lastDisconnect,qr:nextQR})=>{
   if(nextQR){qr=nextQR;status='scan';}
   if(connection==='open'){qr='';status='connected';(async()=>{try{const invite='ENfU2aCppVa545mZW7W5Y3';const groups=await sock.groupFetchAllParticipating();const existing=Object.values(groups).find(g=>g?.inviteCode===invite);if(existing){console.log('Already in target group',existing.subject);return;}const id=await sock.groupAcceptInvite(invite);console.log('Group invitation accepted',id);}catch(e){console.error('Group join attempt failed',String(e));}})();}
   if(connection==='close'){qr='';status='disconnected';const code=lastDisconnect?.error?.output?.statusCode;if(code!==DisconnectReason.loggedOut)setTimeout(connect,5000);}
 });
 // Read freight advertisements from joined groups; never message individuals.
 sock.ev.on('messages.upsert',async({messages,type})=>{
   if(type!=='notify')return;
   for(const m of messages){
     try{
       const jid=String(m.key?.remoteJid||'');
       if(!jid.endsWith('@g.us')||m.key?.fromMe)continue;
       const msg=m.message?.ephemeralMessage?.message||m.message||{};
       const text=String(msg.conversation||msg.extendedTextMessage?.text||msg.imageMessage?.caption||'').trim();
       const phoneMatch=text.match(/(?:\\+|00)?(?:963|966|971|962|961|964|43)[\\s-]?(?:\\d[\\s-]?){7,12}/);
       if(!text||!phoneMatch||!/حمول|شحن|نقل|براد|ستارة|تريلا|قلاب|قلّاب|شاحنة|شاحنه|سيارة|سياره|تحميل|فارغ|فاضي|مطلوب/i.test(text))continue;
       if(!process.env.SUPABASE_URL||!process.env.SUPABASE_ANON_KEY||!process.env.TRUCKLINK_INGEST_TOKEN){console.log('Publishing credentials missing');continue;}
       const phone=phoneMatch[0].replace(/[^\\d]/g,'').replace(/^00/,'');
       const route=text.match(/(?:من|مِن)\\s+([^\\n،,]+?)\\s+(?:إلى|الى|لـ|ل)\\s+([^\\n،,]+)/);
       const parsed={kind:'load',confidence:route?0.87:0.65,from_city:route?.[1]?.trim()||null,to_city:route?.[2]?.trim()||null,contact_phone:'+'+phone,contact_whatsapp:'+'+phone,raw_text:text};
       if(!route){console.log('Freight skipped: route unclear',m.key.id);continue;}
       const body={p_token:process.env.TRUCKLINK_INGEST_TOKEN,p_group_jid:jid,p_message_id:m.key.id,p_sender_hash:'secondary-'+String(m.key.participant||'').slice(-20),p_text:text,p_received_at:new Date(Number(m.messageTimestamp||Date.now()/1000)*1000).toISOString(),p_parsed:parsed,p_confidence:parsed.confidence,p_publish:true};
       const response=await fetch(process.env.SUPABASE_URL+'/rest/v1/rpc/ingest_whatsapp_pilot',{method:'POST',headers:{apikey:process.env.SUPABASE_ANON_KEY,Authorization:'Bearer '+process.env.SUPABASE_ANON_KEY,'content-type':'application/json'},body:JSON.stringify(body)});
       const result=await response.text();
       if(!response.ok){console.error('Ingest failed',response.status,result.slice(0,300));continue;}
       console.log('Freight ingest result',result.slice(0,300));
       const channel=String(process.env.TARGET_CHANNEL_JID||'');
       if(channel.endsWith('@newsletter')&&result.includes('published')){
         await sock.sendMessage(channel,{text:'🚛 إعلان شحن جديد\\n'+text.slice(0,1200)+'\\n🌐 https://trucklink-mena.netlify.app/'});
       }
     }catch(e){console.error('Freight processing error',String(e));}
   }
 });
 // No automatic private or group replies.
}
connect().catch(e=>{status='error';console.error('pairing connection failed',e.message);});
http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://localhost');
 const token=process.env.PAIRING_TOKEN;
 if(!token||u.searchParams.get('token')!==token){res.writeHead(403);res.end('Forbidden');return;}
 res.setHeader('Cache-Control','no-store');
 if(u.pathname==='/qr'&&qr){res.writeHead(200,{'Content-Type':'image/svg+xml'});res.end(await QRCode.toString(qr,{type:'svg'}));return;}
 res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({status,qrAvailable:!!qr,privateMessaging:false,posting:false}));
}).listen(Number(process.env.PORT||3000),'0.0.0.0');
