import makeWASocket,{useMultiFileAuthState,DisconnectReason} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import {mkdir} from 'node:fs/promises';
import http from 'node:http';
const dir='/data/wa-session-secondary';
await mkdir(dir,{recursive:true});
let qr='',status='starting';
async function connect(){
 const {state,saveCreds}=await useMultiFileAuthState(dir);
 const sock=makeWASocket({auth:state,printQRInTerminal:false,markOnlineOnConnect:false,syncFullHistory:false});
 sock.ev.on('creds.update',saveCreds);
 sock.ev.on('connection.update',({connection,lastDisconnect,qr:nextQR})=>{
   if(nextQR){qr=nextQR;status='scan';}
   if(connection==='open'){qr='';status='connected';}
   if(connection==='close'){qr='';status='disconnected';const code=lastDisconnect?.error?.output?.statusCode;if(code!==DisconnectReason.loggedOut)setTimeout(connect,5000);}
 });
 // Pairing only. No private messages, group reading or outgoing messages.
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
