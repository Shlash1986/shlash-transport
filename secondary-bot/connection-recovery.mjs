// History sync is disabled for this bot. Baileys 6.7.24 can hold its initial
// event buffer forever when WA omits the offline-batch completion notification.
// Release only an observed, sustained buffer; never restart or delete auth.
export function createBufferRecovery({sock,isActive,now=Date.now,log=console,graceMs=60000}){
 const state={buffering:false,bufferedSince:null,recoveries:0,lastRecoveryAt:null,pendingNotifications:false};
 let since=null;
 return {state,
  pending(value){state.pendingNotifications=Boolean(value);},
  tick(){
   if(!isActive()){since=null;state.buffering=false;state.bufferedSince=null;return;}
   state.buffering=Boolean(sock.ev.isBuffering?.());
   if(!state.buffering){since=null;state.bufferedSince=null;return;}
   since??=now();state.bufferedSince=new Date(since).toISOString();
   if(now()-since<graceMs)return;
   if(sock.ev.flush?.()){
    state.recoveries++;state.lastRecoveryAt=new Date(now()).toISOString();
    log.warn('WhatsApp buffered events recovered',JSON.stringify({waitMs:now()-since,pendingNotifications:state.pendingNotifications}));
   }
   since=null;state.buffering=Boolean(sock.ev.isBuffering?.());state.bufferedSince=null;
  }
 };
}

// In the pinned Baileys version this exact throw occurs before encodeFrame and
// ws.send. A timeout, callback error or missing receipt is NOT safe to resend.
export function definitelyUnsent(error){
 return error?.message==='Connection Closed'&&error?.output?.statusCode===428&&
  /at sendRawMessage \([^\n]*\/Socket\/socket\.js:\d+:\d+\)/.test(String(error.stack||''));
}
