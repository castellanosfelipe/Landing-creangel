import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ReleaseStore} from '../../storage/release-store.mjs';
const linux=process.platform!=='win32';
const html='<!doctype html><html><body>Verified content</body></html>';
async function valid(directory) {
  for(const name of ['index.html','en/index.html','documentacion/index.html','documentacion/en/index.html','admin/index.html']) {
    await fs.mkdir(path.dirname(path.join(directory,name)),{recursive:true});await fs.writeFile(path.join(directory,name),html);
  }
  await fs.writeFile(path.join(directory,'site-manifest.json'),JSON.stringify({version:'2.0'}));
}
test('failed or incomplete builds keep the current release; successful build activates atomically',{skip:!linux},async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'creangel-release-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const seed=path.join(root,'seed');await fs.mkdir(seed);await valid(seed);
  const store=new ReleaseStore(path.join(root,'releases'));assert.equal(await store.bootstrap(seed),true);
  assert.equal(await store.currentName(),'release-seed');
  await assert.rejects(store.publish(async directory=>{await valid(directory);throw new Error('Compilation failed');}),/Compilation failed/);
  assert.equal(await store.currentName(),'release-seed');
  await assert.rejects(store.publish(async directory=>{await fs.writeFile(path.join(directory,'index.html'),html);return {revision:'a'.repeat(40)};}));
  assert.equal(await store.currentName(),'release-seed');
  const next=await store.publish(async directory=>{await valid(directory);return {revision:'a'.repeat(40)};});
  assert.equal(await store.currentName(),next);
  assert.equal(await fs.readFile(path.join(store.root,'current/index.html'),'utf8'),html);
  assert.equal((await fs.readdir(store.root)).some(name=>name.startsWith('.stage-')),false);
  await store.activate('release-seed');assert.equal(await store.currentName(),'release-seed');
  await assert.rejects(store.activate('../private'),/Invalid release name/);
});
test('published output cannot include filesystem symlinks',{skip:!linux},async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'creangel-release-link-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const store=new ReleaseStore(path.join(root,'releases'));
  await assert.rejects(store.publish(async directory=>{await valid(directory);await fs.symlink('/etc/passwd',path.join(directory,'leak'));return {revision:'b'.repeat(40)};}),/symbolic links/);
  assert.equal(await store.currentName(),null);
});
