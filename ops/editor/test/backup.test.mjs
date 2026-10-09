import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createBackup,restoreBackup,pruneBackups} from '../../backup/backup.mjs';
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'backup-regression-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const source=path.join(root,'workspace');for(const name of ['documentation/docs','documentation/i18n/en/docusaurus-plugin-content-docs/current','public/multimedia/documentacion'])await fs.mkdir(path.join(source,name),{recursive:true});
  await fs.writeFile(path.join(source,'documentation/docs/intro.md'),'Private synthetic text');await fs.writeFile(path.join(source,'public/multimedia/documentacion/example.png'),randomBytes(128));
  const database=path.join(root,'editor.sqlite'),db=new DatabaseSync(database);db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT); INSERT INTO users(name) VALUES('synthetic-editor')");db.close();
  await fs.writeFile(path.join(root,'mfa.key'),randomBytes(32));const keyFile=path.join(root,'backup.key');await fs.writeFile(keyFile,randomBytes(32));
  return {root,source,database,keyFile,directory:path.join(root,'backups')};
}
test('encrypted snapshot restores content, media, database and MFA key to a separate directory',async t=>{
  const f=await fixture(t),created=await createBackup(f),ciphertext=await fs.readFile(created.filename);
  assert.ok(!ciphertext.includes(Buffer.from('Private synthetic text')));assert.ok(!ciphertext.includes(Buffer.from('synthetic-editor')));
  const destination=path.join(f.root,'restored');const result=await restoreBackup({...f,filename:created.filename,destination});assert.equal(result.files,4);
  assert.equal(await fs.readFile(path.join(destination,'content/documentation/docs/intro.md'),'utf8'),'Private synthetic text');
  assert.deepEqual(await fs.readFile(path.join(destination,'accounts/mfa.key')),await fs.readFile(path.join(f.root,'mfa.key')));
  const db=new DatabaseSync(path.join(destination,'accounts/editor.sqlite'),{readOnly:true});assert.equal(db.prepare('SELECT count(*) n FROM users').get().n,1);db.close();
  await assert.rejects(restoreBackup({...f,filename:created.filename,destination}),/directorio nuevo/);
});
test('wrong key and tampering never extract or activate content',async t=>{
  const f=await fixture(t),created=await createBackup(f),wrong=path.join(f.root,'wrong.key');await fs.writeFile(wrong,randomBytes(32));const destination=path.join(f.root,'restored');
  await assert.rejects(restoreBackup({...f,keyFile:wrong,filename:created.filename,destination}));
  const bytes=await fs.readFile(created.filename);bytes[bytes.length-1]^=1;await fs.writeFile(created.filename,bytes);
  await assert.rejects(restoreBackup({...f,filename:created.filename,destination}));await assert.rejects(fs.stat(destination),{code:'ENOENT'});
});
test('retention removes only expired encrypted backups and leaves recent copies and unrelated files',async t=>{
  const f=await fixture(t),created=await createBackup(f),old=path.join(f.directory,'backup-old.cmsbak'),other=path.join(f.directory,'operator.txt');await fs.copyFile(created.filename,old);await fs.writeFile(other,'retain');const date=new Date(Date.now()-31*86400000);await fs.utimes(old,date,date);
  await pruneBackups(f.directory,30);await assert.rejects(fs.stat(old),{code:'ENOENT'});assert.ok(await fs.stat(created.filename));assert.ok(await fs.stat(other));
});
test('WAL-mode source can be snapshotted without writing into its directory and historical sessions are revoked on restore',async t=>{
  const f=await fixture(t),db=new DatabaseSync(f.database);db.exec("PRAGMA journal_mode=WAL; CREATE TABLE sessions(id TEXT); INSERT INTO sessions VALUES('historical-session');");
  const before=await fs.readFile(f.database);let created;try{created=await createBackup(f);assert.deepEqual(await fs.readFile(f.database),before);}finally{db.close();}
  const destination=path.join(f.root,'restored');await restoreBackup({...f,filename:created.filename,destination});const restored=new DatabaseSync(path.join(destination,'accounts/editor.sqlite'));assert.equal(restored.prepare('SELECT count(*) n FROM sessions').get().n,0);assert.equal(restored.prepare('SELECT count(*) n FROM users').get().n,1);restored.close();
});
test('backup fails closed if enrolled MFA accounts cannot be restored without their key',async t=>{
  const f=await fixture(t),db=new DatabaseSync(f.database);db.exec("CREATE TABLE mfa_secrets(user_id TEXT,encrypted TEXT); INSERT INTO mfa_secrets VALUES('id','ciphertext');");db.close();await fs.unlink(path.join(f.root,'mfa.key'));
  await assert.rejects(createBackup(f),/Falta la clave MFA/);assert.equal((await fs.readdir(f.directory)).length,0);
});
