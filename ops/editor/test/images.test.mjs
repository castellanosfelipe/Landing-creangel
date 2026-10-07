import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {markdownImages} from '../markdown-images.mjs';
import {preparePublishedMedia} from '../../storage/published-media.mjs';
import {sourceFingerprint} from '../../storage/config.mjs';

test('empty image blocks and temporary preview URLs fail with a useful error',()=>{
  for(const markdown of ['![]()','![Alt](   )','![Alt](<> "Title")','![a\\]b]()','![[nested]]()','![Alt][ref]\n\n[ref]: <>']) {
    assert.throws(()=>markdownImages(markdown),error=>error.status===400&&/imagen vacío/.test(error.message),markdown);
  }
  for(const url of ['blob:http://127.0.0.1/draft','/api/media/example.png','public/multimedia/documentacion/example.png']) {
    assert.throws(()=>markdownImages(`![Alt](${url})`),{status:400});
  }
});

test('Markdown examples are not images; real images preserve public URLs and titles',()=>{
  assert.deepEqual(markdownImages('```md\n![]()\n```\n\n`![]()`\n\n\\![]()\n\n    ![]()'),[]);
  assert.deepEqual(markdownImages('![Descripción](/multimedia/documentacion/example.png "Título")\n\n![Referencia][photo]\n\n[photo]: https://example.com/photo.jpg'),['/multimedia/documentacion/example.png','https://example.com/photo.jpg']);
});

test('published CMS images become readable by Nginx while source files stay private',async t=>{
  if(process.platform==='win32'){t.skip('POSIX permissions are verified on the Linux runtime.');return;}
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'creangel-image-permissions-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const source=path.join(root,'source/example.png'),output=path.join(root,'output'),published=path.join(output,'multimedia/documentacion/example.png');
  await fs.mkdir(path.dirname(source),{recursive:true});
  await fs.mkdir(path.dirname(published),{recursive:true});
  await fs.writeFile(source,'image',{mode:0o600});
  await fs.copyFile(source,published);
  assert.equal((await fs.stat(published)).mode&0o777,0o600);
  await preparePublishedMedia(output);
  assert.equal((await fs.stat(published)).mode&0o777,0o644);
  assert.equal((await fs.stat(source)).mode&0o777,0o600);
});

test('changing a documentation build plugin triggers publication after an upgrade',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'creangel-image-build-upgrade-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const plugin=path.join(root,'documentation/plugins/remark-site-assets.js');
  await fs.mkdir(path.dirname(plugin),{recursive:true});
  await fs.writeFile(plugin,'version one');
  const first=await sourceFingerprint(root);
  await fs.writeFile(plugin,'version two with image dimensions');
  assert.notEqual(await sourceFingerprint(root),first);
});
