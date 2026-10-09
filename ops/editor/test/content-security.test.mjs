import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {Content} from '../content.mjs';

const es='documentation/docs',en='documentation/i18n/en/docusaurus-plugin-content-docs/current',media='public/multimedia/documentacion';
const actor={username:'synthetic-editor'};
const raw=(id='guide',body='Initial text.')=>`---\nid: ${id}\ntitle: Fixture\ndescription: Disposable documentation\nsidebar_position: 1\nslug: /${id}\n---\n\n${body}\n`;
async function fixture(t,limits={}) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'creangel-content-security-'));
  for(const folder of [es,en,media])await fs.mkdir(path.join(root,folder),{recursive:true});
  t.after(async()=>{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'creangel-content-security-'));await fs.rm(root,{recursive:true,force:true});});
  const audit=[];
  const content=new Content(root,(...event)=>audit.push(event),'http://127.0.0.1:8785',{minFreeBytes:0,...limits});
  const png=await sharp({create:{width:2,height:2,channels:4,background:'#123456'}}).png().toBuffer();
  const upload=(name,bytes=png)=>content.request('persistMedia',{asset:{path:media+'/'+name,encoding:'base64',content:bytes.toString('base64')}},actor);
  const save=(id,body,baseRevision)=>content.request('persistEntry',{dataFiles:[{path:es+'/'+id+'.md',raw:raw(id,body),baseRevision}]},actor);
  return {root,content,audit,png,upload,save};
}

test('optimistic document revisions prevent stale saves and duplicate creation without losing changes',async t=>{
  const f=await fixture(t);
  const created=await f.save('guide','Initial text.',null);
  const initial=await f.content.request('getEntry',{path:es+'/guide.md'},actor);
  assert.equal(created.file.id,initial.file.id);
  const first=await f.save('guide','First editor change.',initial.file.id);
  assert.notEqual(first.file.id,initial.file.id);
  await assert.rejects(f.save('guide','Stale second change.',initial.file.id),{status:409});
  await assert.rejects(f.save('guide','Blind overwrite.',undefined),{status:428});
  await assert.rejects(f.save('guide','Duplicate creation.',null),{status:409});
  assert.match(await fs.readFile(path.join(f.root,es,'guide.md'),'utf8'),/First editor change/);
  const second=await f.save('guide','Reloaded second change.',first.file.id);
  assert.notEqual(second.file.id,first.file.id);
  assert.equal(f.audit.filter(event=>event[1]==='documento_guardado').length,3);
});

test('queued saves from the same base accept one and reject the other',async t=>{
  const f=await fixture(t);
  const created=await f.save('guide','Initial text.',null);
  const results=await Promise.allSettled([f.save('guide','First queued change.',created.file.id),f.save('guide','Second queued change.',created.file.id)]);
  assert.equal(results[0].status,'fulfilled');
  assert.equal(results[1].status,'rejected');assert.equal(results[1].reason.status,409);
  assert.match(await fs.readFile(path.join(f.root,es,'guide.md'),'utf8'),/First queued change/);
});

test('corrupt images are rejected before standalone upload or document-and-asset persistence',async t=>{
  const f=await fixture(t);
  const original=await f.save('guide','Original document.',null);
  const corrupt=f.png.subarray(0,8);
  await assert.rejects(f.upload('corrupt.png',corrupt),{status:400});
  const asset={path:media+'/corrupt.png',encoding:'base64',content:corrupt.toString('base64')};
  await assert.rejects(f.content.request('persistEntry',{dataFiles:[{path:es+'/guide.md',raw:raw('guide','![Example](/multimedia/documentacion/corrupt.png)'),baseRevision:original.file.id}],assets:[asset]},actor),{status:400});
  await assert.rejects(fs.stat(path.join(f.root,media,'corrupt.png')),{code:'ENOENT'});
  assert.match(await fs.readFile(path.join(f.root,es,'guide.md'),'utf8'),/Original document/);
  assert.equal(f.audit.length,1);
});

test('allowed formats decode and normalize; JPEG EXIF is removed and canonical bytes define media revisions',async t=>{
  const f=await fixture(t);
  for(const format of ['png','jpeg','webp','gif','avif']) {
    let image=sharp({create:{width:2,height:2,channels:3,background:'#123456'}});
    if(format==='jpeg')image=image.withExif({IFD0:{Copyright:'Synthetic test metadata'}});
    const input=await image.toFormat(format).toBuffer();
    const result=await f.upload('image.'+format,input);
    const stored=Buffer.from(result.content,'base64');
    const info=await sharp(stored).metadata();
    assert.equal(info.width,2);assert.equal(info.height,2);assert.equal(info.exif,undefined);
    assert.equal(result.id,(await f.content.mediaFile(media+'/image.'+format)).id);
    assert.equal(result.content,(await f.content.mediaFile(media+'/image.'+format)).content);
  }
});

test('small images exceeding configured dimensions or pixel limits fail before storage',async t=>{
  const dimensions=await fixture(t,{imageDimension:1});
  await assert.rejects(dimensions.upload('too-wide.png'),{status:400});
  assert.deepEqual(await fs.readdir(path.join(dimensions.root,media)),[]);
  const pixels=await fixture(t,{imagePixels:3});
  await assert.rejects(pixels.upload('too-many-pixels.png'),{status:400});
  assert.deepEqual(await fs.readdir(path.join(pixels.root,media)),[]);
});

test('one canonical URL parser protects normal, encoded, absolute, relative and reference-style image links',async t=>{
  const f=await fixture(t);
  await f.upload('encoded.png');
  let revision=null;
  for(const url of ['/multimedia/documentacion/encoded.png','/multimedia/documentacion/%65ncoded.png','http://127.0.0.1:8785/multimedia/documentacion/%65ncoded.png?example=1#image','../../public/multimedia/documentacion/%65ncoded.png']) {
    const saved=await f.save('guide',`![Synthetic](${url})`,revision);revision=saved.file.id;
    await assert.rejects(f.content.request('deleteFiles',{paths:[media+'/encoded.png']},actor),{status:409});
    assert.ok((await fs.stat(path.join(f.root,media,'encoded.png'))).isFile());
  }
  const ref=await f.save('guide','![Synthetic][picture]\n\n[picture]: /multimedia/documentacion/%65ncoded.png',revision);
  await assert.rejects(f.content.request('deleteFiles',{paths:[media+'/encoded.png']},actor),{status:409});
  await f.save('guide','Removed image reference.',ref.file.id);
  await f.content.request('deleteFiles',{paths:[media+'/encoded.png']},actor);
  await assert.rejects(fs.stat(path.join(f.root,media,'encoded.png')),{code:'ENOENT'});
});

test('document-relative images cannot import files outside the public asset directory',async t=>{
  const f=await fixture(t);
  await f.upload('safe.png');
  for(const url of ['../missing.png','../../private.png','../../../public/multimedia/documentacion/safe.png','..%2f..%2f..%2fpublic/multimedia/documentacion/safe.png']) {
    await assert.rejects(f.save('guide',`![Synthetic](${url})`,null),{status:400});
    await assert.rejects(fs.stat(path.join(f.root,es,'guide.md')),{code:'ENOENT'});
  }
  const stored=await f.save('guide','![Synthetic](../../public/multimedia/documentacion/%73afe.png?test=1#picture)',null);
  assert.ok(stored.file.id);
  await assert.rejects(f.content.request('deleteFiles',{paths:[media+'/safe.png']},actor),{status:409});
});

test('documentation and media lists paginate without silent truncation or large legacy responses',async t=>{
  const f=await fixture(t,{pageItems:2});
  await f.save('alpha','A.',null);await f.save('beta','B.',null);await f.save('gamma','C.',null);
  const first=await f.content.request('entriesPage',{folder:es,extension:'md',limit:2},actor);
  assert.deepEqual(first.items.map(entry=>entry.file.name),['alpha.md','beta.md']);assert.equal(first.nextCursor,'2');
  const last=await f.content.request('entriesPage',{folder:es,extension:'md',limit:2,cursor:first.nextCursor},actor);
  assert.deepEqual(last.items.map(entry=>entry.file.name),['gamma.md']);assert.equal(last.nextCursor,null);
  await assert.rejects(f.content.request('entriesByFolder',{folder:es,extension:'md',limit:2},actor),{status:413});
  await assert.rejects(f.content.request('entriesPage',{folder:es,extension:'md',limit:3},actor),{status:400});
  await assert.rejects(f.content.request('entriesPage',{folder:es,extension:'md',cursor:-1,limit:2},actor),{status:400});
  for(const name of ['alpha.png','beta.png','gamma.png'])await f.upload(name);
  const mediaFirst=await f.content.request('getMediaPage',{mediaFolder:media,limit:2},actor);
  assert.equal(mediaFirst.items.length,2);assert.equal(mediaFirst.nextCursor,'2');
  const mediaLast=await f.content.request('getMediaPage',{mediaFolder:media,limit:2,cursor:mediaFirst.nextCursor},actor);
  assert.equal(mediaLast.items.length,1);assert.equal(mediaLast.nextCursor,null);
  await assert.rejects(f.content.request('getMedia',{mediaFolder:media,limit:2},actor),{status:413});
});

test('page byte budgets return continuation and do not read beyond configured limits',async t=>{
  const f=await fixture(t,{documentPageBytes:1500,mediaPageBytes:1300});
  await f.save('alpha','A.',null);await f.save('beta','B.',null);
  const first=await f.content.request('entriesPage',{folder:es,extension:'md'},actor);
  assert.equal(first.items.length,1);assert.equal(first.nextCursor,'1');
  await f.upload('alpha.png');await f.upload('beta.png');
  const page=await f.content.request('getMediaPage',{mediaFolder:media},actor);
  assert.equal(page.items.length,1);assert.equal(page.nextCursor,'1');
});

test('media metadata pages keep canonical revisions and authenticated URLs without returning image bytes',async t=>{
  const f=await fixture(t);
  const uploaded=await f.upload('lightweight.png');
  const page=await f.content.request('getMediaPage',{mediaFolder:media,metadataOnly:true,limit:1},actor);
  assert.equal(page.nextCursor,null);assert.equal(page.items.length,1);
  const item=page.items[0];
  assert.equal(item.id,uploaded.id);assert.equal(item.encoding,'url');assert.equal(item.url,'/api/media/lightweight.png');
  assert.equal(item.size,Buffer.from(uploaded.content,'base64').length);
  assert.equal(item.content,undefined);
  assert.equal((await f.content.request('getMediaFile',{path:item.path},actor)).content,uploaded.content);
  await assert.rejects(f.content.request('getMediaPage',{mediaFolder:media,metadataOnly:'true'},actor),{status:400});
});

test('storage quotas reject new files before any write and allow an existing document to remain intact',async t=>{
  const f=await fixture(t,{mediaFiles:1,documentFiles:1});
  await f.upload('first.png');
  await assert.rejects(f.upload('second.png'),{status:507});
  assert.deepEqual(await fs.readdir(path.join(f.root,media)),['first.png']);
  const original=await f.save('first','Original.',null);
  await assert.rejects(f.save('second','Not stored.',null),{status:507});
  assert.deepEqual(await fs.readdir(path.join(f.root,es)),['first.md']);
  await f.save('first','Updated original.',original.file.id);
  const byteQuota=await fixture(t,{mediaBytes:1});
  await assert.rejects(byteQuota.upload('too-many-bytes.png'),{status:507});
  assert.deepEqual(await fs.readdir(path.join(byteQuota.root,media)),[]);
});

test('request queues have bounded counts/bytes and recover after a rejected request',async t=>{
  const f=await fixture(t,{pendingRequests:1,pendingBytes:64});
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const original=f.content.perform.bind(f.content);
  f.content.perform=async(...args)=>{await gate;return original(...args);};
  const first=f.content.request('info',{},actor);
  await assert.rejects(f.content.request('info',{},actor),error=>error.status===429&&error.retryAfter===5);
  release();assert.equal((await first).type,'creangel_local');
  f.content.perform=original;
  await assert.rejects(f.content.request('persistMedia',{asset:{content:'x'.repeat(65)}},actor),{status:429});
  await assert.rejects(f.content.request('info',{unrecognized:'x'.repeat(65)},actor),{status:429});
  assert.equal((await f.content.request('info',{},actor)).type,'creangel_local');
  assert.equal(f.content.pendingRequests,0);assert.equal(f.content.pendingBytes,0);
});

test('authorization is rechecked after image preparation and before committing files',async t=>{
  const f=await fixture(t);
  let checks=0;
  const authorize=()=>{checks++;if(checks===2){const error=new Error('Synthetic revoked session');error.status=401;throw error;}};
  await assert.rejects(f.content.request('persistMedia',{asset:{path:media+'/revoked.png',encoding:'base64',content:f.png.toString('base64')}},actor,authorize),{status:401});
  assert.equal(checks,2);assert.deepEqual(await fs.readdir(path.join(f.root,media)),[]);assert.deepEqual(f.audit,[]);
});

test('symlink documents and upload targets never escape their authorized storage directories',async t=>{
  const f=await fixture(t);
  const privateDocument=path.join(f.root,'synthetic-private.md'),privateImage=path.join(f.root,'synthetic-private.png');
  await fs.writeFile(privateDocument,'Synthetic private marker');await fs.writeFile(privateImage,f.png);
  try {
    await fs.symlink(privateDocument,path.join(f.root,es,'escape.md'));
    await fs.symlink(privateImage,path.join(f.root,media,'escape.png'));
  } catch(error) {if(['EPERM','EACCES'].includes(error.code)){t.skip('Run in Linux runtime to verify symlinks');return;}throw error;}
  await assert.rejects(f.content.request('getEntry',{path:es+'/escape.md'},actor),{status:403});
  await assert.rejects(f.upload('escape.png'),{status:403});
  assert.equal(await fs.readFile(privateDocument,'utf8'),'Synthetic private marker');
  assert.deepEqual(await fs.readFile(privateImage),f.png);
  assert.deepEqual(f.audit,[]);
});
