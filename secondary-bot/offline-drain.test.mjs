import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createOfflineDrain} from './offline-drain.mjs';

function fixture(options={}){
 let clock=100000,active=true;
 const ws=new EventEmitter();ws.isOpen=true;
 const sent=[];
 const sock={ws,sendNode:async node=>{sent.push(node);}};
 const drain=createOfflineDrain({sock,isActive:()=>active,now:()=>clock,log:{info(){},warn(){}},...options});
 return {ws,sock,sent,drain,advance(ms=5000){clock+=ms;},active(value){active=value;},
  preview(count=350){ws.emit('CB:ib,,offline_preview',{tag:'ib',attrs:{},content:[{tag:'offline_preview',attrs:{count:String(count)}}]});},
  message(){ws.emit('CB:message',{tag:'message',attrs:{offline:'0'}});},
  complete(){ws.emit('CB:ib,,offline',{tag:'ib',attrs:{},content:[{tag:'offline',attrs:{count:'0'}}]});}};
}

test('continues multiple quiet offline batches and stops at the server completion marker',async()=>{
 const f=fixture();f.advance();await f.drain.tick();assert.equal(f.sent.length,0);
 f.preview();f.message();f.advance(4999);await f.drain.tick();assert.equal(f.sent.length,0);
 f.advance(1);await f.drain.tick();assert.equal(f.sent.length,1);
 assert.deepEqual(f.sent[0],{tag:'ib',attrs:{},content:[{tag:'offline_batch',attrs:{count:'100'}}]});
 f.message();f.advance();await f.drain.tick();assert.equal(f.sent.length,2);
 f.message();f.complete();f.advance(600000);await f.drain.tick();
 assert.equal(f.sent.length,2);assert.equal(f.drain.state.status,'complete');
 assert.equal(f.drain.state.previewCount,350);assert.equal(f.drain.state.offlineNodes,3);
 assert.ok(f.drain.state.completedAt);
});

test('empty responses stop bounded retries instead of repeatedly sending requests',async()=>{
 const f=fixture();f.preview();
 for(let i=0;i<10;i++){f.advance();await f.drain.tick();}
 assert.equal(f.sent.length,2);assert.equal(f.drain.state.status,'stalled');
});

test('activity and duration caps bound a server that never completes',async()=>{
 const f=fixture({maxRequests:3});f.preview();
 for(let i=0;i<5;i++){f.message();f.advance();await f.drain.tick();}
 assert.equal(f.sent.length,3);assert.equal(f.drain.state.status,'limit_reached');
 const g=fixture({maxDurationMs:10000});g.preview();g.advance(10000);await g.drain.tick();
 assert.equal(g.sent.length,0);assert.equal(g.drain.state.status,'limit_reached');
});

test('inactive, disconnected and closed sockets never request batches',async()=>{
 const f=fixture();f.preview();f.advance();f.active(false);await f.drain.tick();
 f.active(true);f.ws.isOpen=false;await f.drain.tick();assert.equal(f.sent.length,0);
 f.ws.isOpen=true;f.drain.stop();assert.equal(f.ws.eventNames().length,0);
 await f.drain.tick();assert.equal(f.sent.length,0);assert.equal(f.drain.state.status,'disconnected');
});

test('pending sends cannot overlap and completion during a send stays complete',async()=>{
 const f=fixture();let finish;
 f.sock.sendNode=node=>{f.sent.push(node);return new Promise(resolve=>{finish=resolve;});};
 f.preview();f.advance();const pending=f.drain.tick();f.advance();await f.drain.tick();
 assert.equal(f.sent.length,1);f.complete();finish();await pending;
 await f.drain.tick();assert.equal(f.sent.length,1);assert.equal(f.drain.state.status,'complete');
});

test('a failed request ends retries for that connection',async()=>{
 const f=fixture();f.sock.sendNode=async()=>{throw new Error('Connection Closed');};
 f.preview();f.advance();await f.drain.tick();f.advance();await f.drain.tick();
 assert.equal(f.drain.state.requests,1);assert.equal(f.drain.state.status,'request_failed');
 assert.equal(f.drain.state.lastError,'Connection Closed');
});
