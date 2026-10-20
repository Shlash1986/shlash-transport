// Baileys 6.7.24 asks for only one offline_batch (100 items). If the server
// waits for the next request, merely flushing ev cannot deliver newer traffic.
// Continue the existing protocol only after an observed preview and a quiet
// batch. Stop on the real completion marker, inactivity, disconnect or a cap.
// Upstream report: WhiskeySockets/Baileys#2810, comment 6134825123.
export function createOfflineDrain({sock,isActive,now=Date.now,log=console,idleMs=5000,maxRequests=50,maxEmptyRequests=2,maxDurationMs=600000}){
 const state={status:'awaiting_preview',previewCount:null,receivedNodes:0,messageNodes:0,offlineNodes:0,requests:0,emptyRequests:0,lastNodeAt:null,lastRequestAt:null,completedAt:null,lastError:null};
 let previewAt=null,lastActivity=0,lastRequestCount=null,busy=false,closed=false;
 const listeners=[];
 function on(name,fn){if(sock.ws?.on){sock.ws.on(name,fn);listeners.push([name,fn]);}}
 function preview(node){
  if(closed||state.status==='complete')return;
  if(previewAt===null){previewAt=now();lastActivity=now();state.status='draining';}
  const child=Array.isArray(node?.content)?node.content.find(x=>x.tag==='offline_preview'):null;
  const count=Number(child?.attrs?.count);
  if(Number.isSafeInteger(count)&&count>=0)state.previewCount=count;
 }
 function observe(node){
  if(closed||state.status!=='draining')return;
  state.receivedNodes++;if(node?.tag==='message')state.messageNodes++;
  if(node?.attrs?.offline!==undefined)state.offlineNodes++;
  lastActivity=now();state.lastNodeAt=new Date(lastActivity).toISOString();
 }
 function complete(){
  if(closed||state.status==='complete')return;
  state.status='complete';state.completedAt=new Date(now()).toISOString();
  log.info('WhatsApp offline sync completed',JSON.stringify({receivedNodes:state.receivedNodes,messageNodes:state.messageNodes,extraBatches:state.requests}));
 }
 on('CB:ib,,offline_preview',preview);
 on('CB:ib,,offline',complete);
 for(const tag of ['message','notification','receipt','call'])on('CB:'+tag,observe);
 return {state,
  complete,
  async tick(){
   if(closed||busy||!isActive()||sock.ws?.isOpen===false||state.status!=='draining')return;
   if(now()-previewAt>=maxDurationMs||state.requests>=maxRequests){state.status='limit_reached';return;}
   if(now()-lastActivity<idleMs)return;
   if(lastRequestCount!==null&&state.receivedNodes===lastRequestCount){
    state.emptyRequests++;
    if(state.emptyRequests>=maxEmptyRequests){state.status='stalled';log.warn('WhatsApp offline sync stalled',JSON.stringify({requests:state.requests,receivedNodes:state.receivedNodes}));return;}
   }else state.emptyRequests=0;
   busy=true;state.requests++;lastRequestCount=state.receivedNodes;lastActivity=now();state.lastRequestAt=new Date(now()).toISOString();
   try{
    await sock.sendNode({tag:'ib',attrs:{},content:[{tag:'offline_batch',attrs:{count:'100'}}]});
    log.info('WhatsApp next offline batch requested',JSON.stringify({request:state.requests,receivedNodes:state.receivedNodes}));
   }catch(error){
    if(!closed&&state.status!=='complete'){state.status='request_failed';state.lastError=String(error?.message||error).slice(0,120);}
    log.warn('WhatsApp offline batch request failed');
   }finally{busy=false;}
  },
  stop(){closed=true;if(state.status!=='complete')state.status='disconnected';for(const [name,fn] of listeners)sock.ws?.off?.(name,fn);}
 };
}
