import { parentPort, workerData, threadId } from 'node:worker_threads';
import { Store } from './store';
import { World } from './world';
import { createApp } from './app';
const port=parentPort!;
const store=new Store(workerData.dir,workerData.limits);
const world=new World(store,workerData.mode);
// Internal routing shares production validation and command idempotency, without opening a socket.
const app=await createApp(world,{internal:true});await app.ready();
function publish(){port.postMessage({type:'snapshot',value:{player:{...world.snapshot(false),runtime:{simulation:'worker',threadId}},observer:{...world.snapshot(true),runtime:{simulation:'worker',threadId}}}});}
// Coalesce bursts of completed jobs; commands still publish their result immediately.
let scheduled:ReturnType<typeof setTimeout>|undefined;
world.onChange=()=>{if(!scheduled)scheduled=setTimeout(()=>{scheduled=undefined;publish();},100);};
const stream=setInterval(publish,500);publish();
let closing=false;
port.on('message',async message=>{
 try{
  if(message.type==='close'){
   closing=true;clearInterval(stream);if(scheduled)clearTimeout(scheduled);world.onChange=()=>{};const previousStatus=world.state.status;world.pause();
   // Let already-sent model calls settle against the single ledger owner before closing SQLite.
   while(world.active)await new Promise(resolve=>setTimeout(resolve,50));
   // Preserve the run flag; restart continues from the saved game clock.
   if(world.state.status==='paused_manual')world.state.status=previousStatus;
   await app.close();world.documents.project();store.close();port.postMessage({type:'reply',id:message.id,value:{ok:true}});return;
  }
  if(closing)throw new Error('模拟正在关闭');
  const {method,url,body}=message.value;
  const response=await app.inject({method,url,...body!==undefined?{payload:body}:{}});
  publish();port.postMessage({type:'reply',id:message.id,value:{status:response.statusCode,body:response.json()}});
 }catch(error){port.postMessage({type:'reply',id:message.id,error:(error as Error).message});}
});
