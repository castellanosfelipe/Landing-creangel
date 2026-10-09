import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../store.mjs';
test('security migration revokes legacy sessions and preserves existing identities and password hashes',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'security-migration-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file=path.join(root,'editor.sqlite'),db=new DatabaseSync(file);
  db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,display_name TEXT NOT NULL,role TEXT NOT NULL,active INTEGER,password_hash TEXT,must_change INTEGER,created_at TEXT); CREATE TABLE sessions(id_hash TEXT PRIMARY KEY,user_id TEXT,csrf TEXT,expires INTEGER); INSERT INTO users VALUES('original-id','synthetic','Original account','admin',1,'original-hash',0,'2026-10-01'); INSERT INTO sessions VALUES('old-session','original-id','old-csrf',9999999999999);");db.close();
  const store=new Store(file);assert.equal(store.byName('synthetic').id,'original-id');assert.equal(store.byName('synthetic').password_hash,'original-hash');assert.equal(store.db.prepare('SELECT count(*) n FROM sessions').get().n,0);store.close();assert.ok(await fs.stat(file+'.pre-security-v2.sqlite'));
});
