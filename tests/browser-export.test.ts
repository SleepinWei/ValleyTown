import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createWorld } from '../server/seed';
import { BrowserStore, validateTownData } from '../engine/browser-store';

test('read-only legacy export preserves unpriced costs and interrupted reservations',()=>{
  const dir=mkdtempSync(join(tmpdir(),'valleytown-export-'));
  try {
    const db=new DatabaseSync(join(dir,'valleytown.sqlite'));
    db.exec('CREATE TABLE world(id INTEGER PRIMARY KEY,json TEXT);CREATE TABLE calls(id TEXT PRIMARY KEY,provider TEXT,purpose TEXT,model TEXT,status TEXT,input INTEGER,output INTEGER,reserved INTEGER,latency INTEGER,created INTEGER,error TEXT)');
    db.prepare('INSERT INTO world VALUES(1,?)').run(JSON.stringify(createWorld('demo')));
    db.prepare('INSERT INTO calls VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('legacy','DeepSeek','test','test','pending',100,20,1000,0,1,null);db.close();
    const original=readFileSync(join(dir,'valleytown.sqlite'));
    const destination=join(dir,'new','save.json');
    execFileSync(process.execPath,['--import','tsx','scripts/export-browser-save.ts',dir,destination],{stdio:'pipe'});
    const store=new BrowserStore(validateTownData(JSON.parse(readFileSync(destination,'utf8'))));
    assert.equal(store.call('legacy').status,'unknown');
    assert.equal(store.call('legacy').cost_nano,360000);
    assert.equal(store.call('legacy').reserved_nano,8000000);
    assert.equal(store.usage().pools.DeepSeek.legacyCalls,1);
    assert.equal(store.load()!.actors.length,24);
    assert.deepEqual(readFileSync(join(dir,'valleytown.sqlite')),original);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
