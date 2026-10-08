import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {createEditorServer} from '../server.mjs';
import {hashPassword,verifyPassword,origin} from '../security.mjs';
import {Store} from '../store.mjs';

const initial='Initial-test-password-2026!';
const changed='Changed-test-password-2026!';
const editorInitial='Editor-test-password-2026!';
const editorChanged='Editor-changed-password-2026!';
// Synthetic challenges exercise authentication without solving real browser CAPTCHAs.
const captchaAnswer='AB234';
const captchaGenerator=()=>({answer:captchaAnswer,svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 80"><path d="M5 5L20 20"/></svg>'});
const documentPath='documentation/docs/overview.md';
const markdown='---\nid: overview\ntitle: Overview\ndescription: Product documentation\nsidebar_position: 1\nslug: /\n---\n\n# Overview\n\nOriginal content.\n';
async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'creangel-editor-test-'));
  await fs.mkdir(path.join(root,'documentation/docs'),{recursive:true});
  await fs.mkdir(path.join(root,'documentation/i18n/en/docusaurus-plugin-content-docs/current'),{recursive:true});
  await fs.mkdir(path.join(root,'public/multimedia/documentacion'),{recursive:true});
  await fs.writeFile(path.join(root,documentPath),markdown);
  await fs.writeFile(path.join(root,'initial-password'),initial);
  const config={origin:'http://127.0.0.1:8785',database:path.join(root,'data/accounts.sqlite'),contentRoot:root,adminUsername:'admin',passwordFile:path.join(root,'initial-password')};
  const {server,store}=await createEditorServer(config,{captchaGenerator});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});});
  async function request(url,{method='GET',data,session,headers={}}={}) {
    const response=await fetch(base+url,{method,headers:{...(data?{'Content-Type':'application/json',Origin:config.origin}:{}),...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrfToken}:{}),...headers},body:data?JSON.stringify(data):undefined});
    const body=await response.json();
    const cookies=response.headers.getSetCookie().map(value=>value.split(';')[0]);
    return {status:response.status,body,headers:response.headers,cookies,cookie:cookies.find(value=>/^creangel_session=.+/.test(value)),csrfToken:body.csrfToken};
  }
  async function challenge() {
    const result=await request('/api/captcha');
    assert.equal(result.status,200);
    return {...result,cookie:result.cookies.find(value=>/^creangel_captcha=.+/.test(value))};
  }
  async function login(username,password) {
    const captcha=await challenge();
    return request('/api/login',{method:'POST',data:{username,password,captchaAnswer},headers:{Cookie:captcha.cookie}});
  }
  async function readyAdmin() {
    const session=await login('admin',initial);assert.equal(session.status,200);
    const next=await request('/api/password',{method:'POST',session,data:{currentPassword:initial,newPassword:changed}});assert.equal(next.status,200);return next;
  }
  async function newEditor(admin) {
    const created=await request('/api/users',{method:'POST',session:admin,data:{username:'editor',displayName:'Editor local',role:'editor',password:editorInitial}});assert.equal(created.status,201);
    const session=await login('editor',editorInitial);
    const next=await request('/api/password',{method:'POST',session,data:{currentPassword:editorInitial,newPassword:editorChanged}});assert.equal(next.status,200);
    return {session:next,user:created.body.user};
  }
  return {root,store,config,base,request,challenge,login,readyAdmin,newEditor};
}

test('password hashing uses random salts and no plaintext; production origin requires HTTPS',async()=>{
  const first=await hashPassword(initial),second=await hashPassword(initial);
  assert.notEqual(first,second);assert.ok(!first.includes(initial));
  assert.equal(await verifyPassword(initial,first),true);
  assert.equal(await verifyPassword('wrong-password',first),false);
  await assert.rejects(hashPassword('short'),{status:400});
  assert.equal(origin('https://portal.creangel.com/'),'https://portal.creangel.com');
  assert.throws(()=>origin('http://portal.creangel.com'),{status:400});
});

test('CAPTCHA is required by the API, uses a private cookie and never reveals its answer',async t=>{
  const f=await fixture(t);
  const captcha=await f.challenge();
  assert.match(captcha.cookie,/^creangel_captcha=[A-Za-z0-9_-]{43}$/);
  assert.match(captcha.headers.get('set-cookie'),/Path=\/; HttpOnly; SameSite=Strict; Max-Age=300/);
  assert.equal(captcha.headers.get('cache-control'),'no-store');
  assert.ok(captcha.body.expiresAt>Date.now()&&captcha.body.expiresAt<=Date.now()+300000);
  assert.match(captcha.body.image,/^data:image\/png;base64,/);
  assert.ok(!JSON.stringify(captcha.body).includes(captchaAnswer));
  const image=Buffer.from(captcha.body.image.split(',')[1],'base64');
  assert.deepEqual(image.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));
  assert.ok(!image.includes(Buffer.from(captchaAnswer)));assert.ok(!image.includes(Buffer.from('<svg')));
  const post=(data,headers={})=>f.request('/api/login',{method:'POST',data:{username:'admin',password:initial,...data},headers});
  assert.equal((await post({})).status,400);
  assert.equal((await post({captchaAnswer})).status,400);
  assert.equal((await post({captchaAnswer:'WRONG'},{Cookie:captcha.cookie})).status,400);
  assert.equal((await post({captchaAnswer},{Cookie:captcha.cookie})).status,400);
  assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM sessions').get().n,0);
});

test('CAPTCHA refresh and each login consume the old challenge without losing the session cookie',async t=>{
  const f=await fixture(t);
  const old=await f.challenge();
  const fresh=await f.request('/api/captcha',{headers:{Cookie:old.cookie}});
  const cookie=fresh.cookies.find(value=>/^creangel_captcha=.+/.test(value));
  assert.equal(fresh.status,200);assert.notEqual(cookie,old.cookie);
  const post=(captchaCookie,data={})=>f.request('/api/login',{method:'POST',headers:{Cookie:captchaCookie},data:{username:'admin',password:initial,captchaAnswer,...data}});
  assert.equal((await post(old.cookie)).status,400);
  const accepted=await post(cookie,{captchaAnswer:' ab234 '});
  assert.equal(accepted.status,200);assert.match(accepted.cookie,/^creangel_session=/);
  assert.equal((await f.request('/api/session',{session:accepted})).status,200);
  assert.equal((await post(cookie)).status,400);
  const badPassword=await f.challenge();
  assert.equal((await post(badPassword.cookie,{password:'wrong-password'})).status,401);
  assert.equal((await post(badPassword.cookie)).status,400);
  const duplicate=await f.challenge();
  assert.equal((await post(duplicate.cookie+'; '+duplicate.cookie,{username:'cookie-probe'})).status,400);
});

test('anonymous access, wrong origins and missing CSRF cannot edit; initial password must change',async t=>{
  const f=await fixture(t);
  assert.equal((await f.request('/api/health')).status,200);
  assert.equal((await f.request('/api/users')).status,401);
  assert.equal((await f.request('/api/content',{method:'POST',data:{action:'info'}})).status,401);
  assert.equal((await f.request('/api/login',{method:'POST',data:{username:'admin',password:initial},headers:{Origin:'https://foreign.example'}})).status,403);
  const session=await f.login('admin',initial);
  assert.equal(session.body.user.mustChangePassword,true);
  assert.match(session.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
  assert.ok(!JSON.stringify(session.body).includes(initial));
  assert.equal((await f.request('/api/users',{session})).status,403);
  assert.equal((await f.request('/api/password',{method:'POST',session,data:{currentPassword:initial,newPassword:changed},headers:{'X-CSRF-Token':'wrong'}})).status,403);
  const next=await f.request('/api/password',{method:'POST',session,data:{currentPassword:initial,newPassword:changed}});
  assert.equal(next.status,200);assert.equal(next.body.user.mustChangePassword,false);
  assert.equal((await f.request('/api/session',{session})).status,401);
  assert.equal((await f.request('/api/content',{method:'POST',session:next,data:{action:'info'},headers:{Origin:'https://foreign.example'}})).status,403);
  assert.equal((await f.request('/api/content',{method:'POST',session:next,data:{action:'info'},headers:{'X-CSRF-Token':''}})).status,403);
});

test('administrator manages multiple local accounts; editor cannot manage users; revocation is immediate',async t=>{
  const f=await fixture(t),admin=await f.readyAdmin(),editor=await f.newEditor(admin);
  assert.equal((await f.request('/api/users',{session:editor.session})).status,403);
  assert.equal((await f.request('/api/users',{method:'POST',session:editor.session,data:{username:'intruder',role:'admin',password:changed}})).status,403);
  assert.equal((await f.request('/api/audit',{session:editor.session})).status,403);
  const users=await f.request('/api/users',{session:admin});assert.equal(users.body.users.length,2);
  assert.ok(!JSON.stringify(users.body).includes('password_hash'));
  assert.equal((await f.request('/api/users/'+admin.body.user.id,{method:'PATCH',session:admin,data:{active:false}})).status,409);
  assert.equal((await f.request('/api/users/'+admin.body.user.id,{method:'PATCH',session:admin,data:{role:'editor'}})).status,409);
  assert.equal((await f.request('/api/users/'+editor.user.id,{method:'PATCH',session:admin,data:{active:false}})).status,200);
  assert.equal((await f.request('/api/session',{session:editor.session})).status,401);
  assert.equal((await f.login('editor',editorChanged)).status,401);
  await f.request('/api/users/'+editor.user.id,{method:'PATCH',session:admin,data:{active:true}});
  const reactivated=await f.login('editor',editorChanged);assert.equal(reactivated.status,200);
  await f.request('/api/users/'+editor.user.id+'/password',{method:'POST',session:admin,data:{password:editorInitial}});
  assert.equal((await f.request('/api/session',{session:reactivated})).status,401);
  assert.equal((await f.login('editor',editorChanged)).status,401);
  assert.equal((await f.login('editor',editorInitial)).body.user.mustChangePassword,true);
  const events=await f.request('/api/audit',{session:admin});assert.ok(events.body.events.some(e=>e.action==='contraseña_restablecida'));
  assert.ok(!JSON.stringify(events.body).includes(editorInitial));
});

test('authorized editor can read/save only Markdown with stable URLs and safe images',async t=>{
  const f=await fixture(t),admin=await f.readyAdmin(),editor=await f.newEditor(admin);
  const content=(action,params)=>f.request('/api/content',{method:'POST',session:editor.session,data:{action,params}});
  assert.equal((await content('entriesByFolder',{folder:'documentation/docs',extension:'md'})).body[0].data,markdown);
  assert.equal((await content('getEntry',{path:'../secrets/password'})).status,400);
  assert.equal((await content('getEntry',{path:'public/index.html'})).status,403);
  assert.equal((await content('persistEntry',{dataFiles:[{path:documentPath,raw:markdown.replace('Original','Updated')}]})).status,200);
  assert.match(await fs.readFile(path.join(f.root,documentPath),'utf8'),/Updated content/);
  assert.equal((await content('persistEntry',{dataFiles:[{path:documentPath,raw:markdown.replace('slug: /','slug: /changed')}]})).status,409);
  assert.equal((await content('persistEntry',{dataFiles:[{path:documentPath,raw:markdown+'<script>alert(1)</script>'}]})).status,400);
  assert.equal((await content('persistEntry',{dataFiles:[{path:documentPath,raw:markdown+'[bad](javascript:alert(1))'}]})).status,400);
  assert.equal((await content('deleteFiles',{paths:[documentPath]})).status,403);
  const imagePath='public/multimedia/documentacion/example.png';
  assert.equal((await content('persistMedia',{asset:{path:imagePath,encoding:'base64',content:Buffer.from('<script>bad</script>').toString('base64')}})).status,400);
  const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8XcAAAAASUVORK5CYII=','base64');
  assert.equal((await content('persistMedia',{asset:{path:imagePath,encoding:'base64',content:image.toString('base64')}})).status,200);
  assert.equal((await content('getMedia',{mediaFolder:'public/multimedia/documentacion'})).body.length,1);
  await content('persistEntry',{dataFiles:[{path:documentPath,raw:markdown+'\n![Example](/multimedia/documentacion/example.png)\n'}]});
  assert.equal((await content('deleteFiles',{paths:[imagePath]})).status,409);
  await content('persistEntry',{dataFiles:[{path:documentPath,raw:markdown}]});
  assert.equal((await content('deleteFiles',{paths:[imagePath]})).status,200);
});

test('login throttling persists and credentials survive reopening the database',async t=>{
  const f=await fixture(t),admin=await f.readyAdmin();
  for(let i=0;i<6;i++)assert.equal((await f.login('admin','wrong-password')).status,401);
  const denied=await f.login('admin',changed);assert.equal(denied.status,429);assert.ok(Number(denied.headers.get('retry-after'))>0);
  const copy=path.join(f.root,'data/copy.sqlite');
  f.store.db.exec(`VACUUM INTO '${copy.replaceAll("'","''")}'`);
  const reopened=new Store(copy);
  try {
    assert.equal(reopened.users()[0].username,'admin');
    assert.equal(await verifyPassword(changed,reopened.byName('admin').password_hash),true);
    assert.equal(reopened.db.prepare('SELECT count(*) AS n FROM attempts').get().n,1);
    assert.ok(!JSON.stringify(reopened.users()).includes(changed));
    assert.equal(reopened.byName('admin').must_change,0);
  } finally {reopened.close();}
  assert.equal((await f.request('/api/logout',{method:'POST',session:admin,data:{}})).status,200);
  assert.equal((await f.request('/api/session',{session:admin})).status,401);
});

test('image validation happens before saving and a previously invalid draft can be repaired',async t=>{
  const f=await fixture(t),session=await f.readyAdmin();
  const content=(action,params)=>f.request('/api/content',{method:'POST',session,data:{action,params}});
  const save=(raw,assets=[])=>content('persistEntry',{dataFiles:[{path:documentPath,raw}],assets});
  const empty=await save(markdown+'\n![]()\n');
  assert.equal(empty.status,400);assert.match(empty.body.error,/imagen vacío/);
  assert.equal(await fs.readFile(path.join(f.root,documentPath),'utf8'),markdown);
  const missing=await save(markdown+'\n![Alt](/multimedia/documentacion/missing.png)\n');
  assert.equal(missing.status,400);assert.match(missing.body.error,/no existe/);
  assert.equal((await save(markdown+'\n![Remote](https://images.example.com/picture.png)\n')).status,400);
  assert.equal((await save(markdown+'\n![Private](http://127.0.0.1:8785/api/media/draft.png)\n')).status,400);
  const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8XcAAAAASUVORK5CYII=','base64');
  const asset={path:'public/multimedia/documentacion/draft.png',encoding:'base64',content:image.toString('base64')};
  assert.equal((await save(markdown+'\n![Alt](/multimedia/documentacion/draft.png "Title")\n',[asset])).status,200);
  assert.equal((await save(markdown+'\n![Alt](http://127.0.0.1:8785/multimedia/documentacion/draft.png)\n')).status,200);
  const media=await fetch(f.base+'/api/media/draft.png',{headers:{Cookie:session.cookie}});
  assert.equal(media.status,200);assert.equal(media.headers.get('content-type'),'image/png');
  assert.deepEqual(Buffer.from(await media.arrayBuffer()),image);
  assert.equal((await f.request('/api/media/draft.png')).status,401);
  assert.equal((await f.request('/api/media/missing.png',{session})).status,404);
  assert.equal((await content('getMediaFile',{path:asset.path})).body.content,asset.content);
  const duplicate={...asset,path:'public/multimedia/documentacion/duplicate.png'};
  assert.equal((await content('persistMedia',{asset:duplicate})).status,200);
  const library=(await content('getMedia',{mediaFolder:'public/multimedia/documentacion'})).body;
  assert.equal(library.length,2);assert.notEqual(library[0].id,library[1].id);
  await fs.writeFile(path.join(f.root,documentPath),markdown+'\n![]()\n');
  assert.equal((await save(markdown+'\n![Alt](/multimedia/documentacion/draft.png)\n')).status,200);
});

test('symlink escape is rejected even inside an authorized collection',async t=>{
  const f=await fixture(t),admin=await f.readyAdmin();
  const outside=path.join(f.root,'private.md');await fs.writeFile(outside,'private');
  try {await fs.symlink(outside,path.join(f.root,'documentation/docs/escape.md'));}
  catch(error){if(['EPERM','EACCES'].includes(error.code)){t.skip('Requires symlink permission; run on the Linux runtime image.');return;}throw error;}
  const result=await f.request('/api/content',{method:'POST',session:admin,data:{action:'getEntry',params:{path:'documentation/docs/escape.md'}}});
  assert.equal(result.status,403);assert.ok(!JSON.stringify(result.body).includes('private'));
});
