// libsignal logs entire SessionEntry objects, including private ratchet keys.
// Filter only those diagnostics; retain real decryption and connection errors.
export function installSafeLogging(target=console){
 const noisy=/^(?:Closing session:|Opening session:|Removing old closed session:|Session already closed|Closing open session in favor of incoming prekey bundle|Decrypted message with closed session\.)/;
 const originals={};
 for(const level of ['info','log','warn','error']){
  originals[level]=target[level];
  target[level]=function(...args){
   if(typeof args[0]==='string'&&noisy.test(args[0]))return;
   const safe=args.map(arg=>arg&&typeof arg==='object'&&('currentRatchet' in arg||'privKey' in arg||'rootKey' in arg)?'[session redacted]':arg);
   return originals[level].apply(target,safe);
  };
 }
 return ()=>{for(const level of Object.keys(originals))target[level]=originals[level];};
}
installSafeLogging();

// Baileys supports the Pino logger interface. Keep warn/error as single lines,
// and do not serialize arbitrary protocol objects containing session material.
export const socketLogger={level:'warn',child(){return this;},trace(){},debug(){},info(){},
 warn(...args){console.warn('WhatsApp warning',...args.filter(x=>typeof x==='string').map(x=>x.slice(0,300)));},
 error(...args){console.error('WhatsApp error',...args.filter(x=>typeof x==='string').map(x=>x.slice(0,300)));},
 fatal(...args){this.error(...args);}
};
