import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, lstatSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Actor, DocumentView, WorldState } from '../shared/types';
import { dayOf, timeOf } from '../shared/types';
import { Store } from './store';

const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export const documentKinds=['persona','secret','notes','today'] as const;
export class Documents {
  stable=new Map<string,string>();
  constructor(private store:Store,private world:()=>WorldState,private changed:(a:Actor,kind:string,body:string)=>void){this.initialize();}
  private file(actorId:string,kind:string){return join(this.store.dir,'editable',actorId,`${kind}.md`);}
  private wrapped(id:string,revision:number,body:string){return `---\ndocument_id: ${id}\nbase_revision: ${revision}\n---\n${body}\n`;}
  initialize(){
    for(const a of this.world().actors){
      mkdirSync(join(this.store.dir,'editable',a.id),{recursive:true});
      for(const kind of documentKinds){
        const id=`${a.id}:${kind}`;let row=this.row(id);
        if(!row){const body=kind==='persona'?a.persona:kind==='secret'?a.secret.core:kind==='today'?`第 ${dayOf(this.world().clock)} 天的补充记忆。仅当日进入短期上下文。`:'这里可写入你为这个角色补充的长期设定。保存后仅该角色知道。';const text=this.wrapped(id,1,body);this.store.db.prepare('INSERT INTO documents(id,revision,text,hash) VALUES (?,?,?,?)').run(id,1,text,hash(text));row=this.row(id)!;}
        const file=this.file(a.id,kind);if(!existsSync(file))writeFileSync(file,row.text,{mode:0o600});
      }
    }
  }
  restoreFromWorld(){
    // Preserve external edits for manual merging, then publish fresh document revisions.
    for(const a of this.world().actors)for(const kind of documentKinds){
      const id=`${a.id}:${kind}`,r=this.row(id)!,file=this.file(a.id,kind);
      if(lstatSync(file).isSymbolicLink())throw new Error('编辑目录不接受符号链接');
      if(existsSync(file)&&hash(readFileSync(file,'utf8'))!==r.hash){const dir=join(this.store.dir,'document-backups');mkdirSync(dir,{recursive:true});writeFileSync(join(dir,`${a.id}-${kind}-${Date.now()}.md`),readFileSync(file),{mode:0o600});}
      const body=kind==='persona'?a.persona:kind==='secret'?a.secret.core:kind==='notes'?(a.longTermNotes??'尚无补充长期设定。'):(a.dailyNotes?.day===dayOf(this.world().clock)?a.dailyNotes.text:'尚无当日补充记忆。');
      const text=this.wrapped(id,r.revision+1,body);
      this.store.db.prepare('UPDATE documents SET revision=?,text=?,hash=?,error=NULL,imported=? WHERE id=?').run(r.revision+1,text,hash(text),new Date().toISOString(),id);this.atomic(file,text);
      const dir=join(this.store.dir,'memories',a.id);if(existsSync(dir))for(const name of readdirSync(dir))if(/^day-\d+\.md$/.test(name))unlinkSync(join(dir,name));
    }
    this.stable.clear();this.project();
  }
  private row(id:string){return this.store.db.prepare('SELECT * FROM documents WHERE id=?').get(id) as {id:string;revision:number;text:string;hash:string;error:string|null;imported:string|null}|undefined;}
  list(actorId:string):DocumentView[]{return documentKinds.map(kind=>{const r=this.row(`${actorId}:${kind}`);if(!r)throw new Error('文档不存在');return {id:r.id,actorId,revision:r.revision,text:r.text,file:this.file(actorId,kind),error:r.error??undefined,imported:r.imported??undefined};});}
  errors(){return (this.store.db.prepare('SELECT id,error FROM documents WHERE error IS NOT NULL').all() as unknown as {id:string;error:string}[]).map(r=>`${r.id}: ${r.error}`);}
  import(id:string,text:string,expectedRevision:number,external=false){
    const [actorId,kind]=id.split(':');const actor=this.world().actors.find(a=>a.id===actorId);
    if(!actor||!documentKinds.includes(kind as any))throw new Error('未知文档');
    if(text.length>16000)throw new Error('文档最多 16000 个字符');
    const r=this.row(id)!;
    if(expectedRevision!==r.revision)throw new Error('版本冲突：先载入最新版本，再合并你的修改');
    const header=text.match(/^---\r?\ndocument_id: ([^\r\n]+)\r?\nbase_revision: (\d+)\r?\n---\r?\n([\s\S]*)$/);
    if(!header||header[1]!==id||Number(header[2])!==expectedRevision)throw new Error('请保留 document_id 与 base_revision 头部，或重新载入文档');
    const body=header[3].trim();if(!body)throw new Error('文档内容不能为空');
    const file=this.file(actorId,kind);
    if(lstatSync(file).isSymbolicLink())throw new Error('编辑目录不接受符号链接');
    // Do not overwrite an external editor's unsaved-to-server changes with a stale UI buffer.
    const disk=readFileSync(file,'utf8');
    if(!external&&hash(disk)!==r.hash)throw new Error('外部文件有尚未载入的修改，请先立即载入');
    const revision=r.revision+1;const next=this.wrapped(id,revision,body);
    this.changed(actor,kind,body);
    this.store.db.prepare('UPDATE documents SET revision=?,text=?,hash=?,error=NULL,imported=? WHERE id=?').run(revision,next,hash(next),new Date().toISOString(),id);
    this.store.save(this.world());
    this.atomic(file,next);return this.list(actorId);
  }
  scan(immediate=false){
    for(const a of this.world().actors)for(const kind of documentKinds){
      const id=`${a.id}:${kind}`,file=this.file(a.id,kind),r=this.row(id)!;
      try{
        if(!existsSync(file))continue;if(lstatSync(file).isSymbolicLink())throw new Error('不接受符号链接');
        const text=readFileSync(file,'utf8'),digest=hash(text);if(digest===r.hash){this.stable.delete(id);continue;}
        if(!immediate&&this.stable.get(id)!==digest){this.stable.set(id,digest);continue;}
        const revision=Number(text.match(/base_revision: (\d+)/)?.[1]);
        this.import(id,text,revision,true);this.stable.delete(id);
      }catch(e){this.store.db.prepare('UPDATE documents SET error=? WHERE id=?').run((e as Error).message,id);}
    }
    this.project();
  }
  project(){
    for(const a of this.world().actors){
      const dir=join(this.store.dir,'memories',a.id);mkdirSync(dir,{recursive:true});
      const groups=new Map<number,string[]>();
      for(const m of a.memories){const lines=groups.get(m.day)??[];lines.push(`## ${timeOf(m.minute)} · ${m.kind}\n- 来源：${m.source}\n- 事件：${m.id}\n\n${m.text}\n`);groups.set(m.day,lines);}
      for(const [day,lines]of groups)this.atomic(join(dir,`day-${String(day).padStart(4,'0')}.md`),`# ${a.name} · 第 ${day} 天\n\n${lines.join('\n')}`);
      this.atomic(join(dir,'long-term.md'),`# ${a.name} · 长期记忆\n\n${a.memories.filter(m=>m.important||m.kind==='reflection').map(m=>`## 第 ${m.day} 天 · ${m.id}\n${m.text}\n来源：${m.source}`).join('\n\n')}\n\n当前游戏日：${dayOf(this.world().clock)}\n`);
    }
  }
  private atomic(file:string,text:string){const tmp=`${file}.tmp`;writeFileSync(tmp,text,{mode:0o600});renameSync(tmp,file);}
}
