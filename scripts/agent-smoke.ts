import 'dotenv/config';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { Store } from '../server/store';
import { World } from '../server/world';
import { ModelGateway } from '../server/models';
// Stop the server or pause it with all requests settled before using this script.
const ledger=new Store(resolve(process.env.DATA_DIR||'data'),Number(process.env.TOKEN_LIMIT)||5e6);
const dir=mkdtempSync(join(tmpdir(),'valleytown-agent-'));const store=new Store(dir);const world=new World(store,'live');
world.gateway=new ModelGateway(ledger,()=>world.state.status==='running_live',()=>world.pause('paused_token_limit'));
const before=ledger.usage().used;const report:Record<string,unknown>={at:new Date().toISOString(),scope:'一个角色的一次宏观规划、行动判断、三步对话与反思；临时世界，实际消耗写入主账本'};
try{
 world.resume();const a=world.actor('gardener');
 if(!process.argv.includes('--dialogue')){await world.plan(a);report.plan=a.plan;await world.chooseAction(a);report.action=world.state.decisions[0];}
 Object.assign(world.state.player,{x:a.x,y:a.y});const c=world.startConversation('player',a.id);
 world.sendMessage(c.id,'你好，我刚搬来。你今天想完成什么？有什么我可以帮忙的吗？');
 while(world.active)await new Promise(r=>setTimeout(r,50));
 report.dialogue=c.messages;report.decisions=world.state.decisions;assert.equal(c.messages.length,2,'NPC must reply to the player');
 await world.reflect(a,1);report.reflection=a.memories.at(-1)?.text;
 const recent=ledger.usage().recent.filter(c=>c.created>=Date.parse(report.at as string));
 report.calls=recent;report.tokens=ledger.usage().used-before;assert.ok(recent.some(c=>c.purpose==='speech-check'&&c.status==='complete'));
 console.log(JSON.stringify(report,null,2));
}catch(e){report.error=(e as Error).message;process.exitCode=1;console.log(JSON.stringify(report,null,2));}
finally{world.pause();report.totalUsage=ledger.usage();mkdirSync('output',{recursive:true});writeFileSync('output/agent-smoke.json',JSON.stringify(report,null,2));store.close();ledger.close();rmSync(dir,{recursive:true,force:true});}
