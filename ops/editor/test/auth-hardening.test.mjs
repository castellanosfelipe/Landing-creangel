import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomBytes,scrypt as scryptCallback} from 'node:crypto';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {once} from 'node:events';
import {createEditorServer} from '../server.mjs';
import {Store} from '../store.mjs';
import {hashPassword,verifyPassword,upgradePasswordHash,digest} from '../security.mjs';
import {validateNewPassword} from '../password-policy.mjs';
import {base32,totp} from '../mfa.mjs';

const password=()=>randomBytes(24).toString('base64url');
const generator=()=>({answer:'AB234',svg:'<svg xmlns="http://www.w3.org/2000/svg" width="250" height="88"><path d="M0 0L10 10"/></svg>'});
async function fixture(t,{legacy=false,secure=false}={}) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'creangel-auth-hardening-'));
  const initial=legacy?'x'.repeat(12):password(),database=path.join(root,'editor.sqlite');
  await fs.mkdir(path.join(root,'documentation/docs'),{recursive:true});await fs.mkdir(path.join(root,'documentation/i18n/en/docusaurus-plugin-content-docs/current'),{recursive:true});await fs.mkdir(path.join(root,'public/multimedia/documentacion'),{recursive:true});
  await fs.writeFile(path.join(root,'password'),initial,{mode:0o600});
  if(legacy){const db=new DatabaseSync(database);const salt=randomBytes(16).toString('hex'),key=await promisify(scryptCallback)(initial,salt,64,{N:32768,r:8,p:1,maxmem:128*1024*1024});db.exec('CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,display_name TEXT NOT NULL,role TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,password_hash TEXT NOT NULL,must_change INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL); CREATE TABLE sessions(id_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,csrf TEXT NOT NULL,expires INTEGER NOT NULL);');db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run('00000000-0000-0000-0000-000000000001','audit_admin','Synthetic admin','admin',1,`scrypt$${salt}$${key.toString('hex')}`,0,new Date().toISOString());db.close();}
  let clock=Date.now();const config={origin:secure?'https://portal.creangel.com':'http://127.0.0.1:8785',database,contentRoot:root,adminUsername:'audit_admin',passwordFile:path.join(root,'password'),idleMinutes:30};
  const {server,store,mfa}=await createEditorServer(config,{captchaGenerator:generator,now:()=>clock});server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});});
  async function request(route,{method='GET',data,session,headers={}}={}) {const response=await fetch(url+route,{method,headers:{...(method!=='GET'?{'Content-Type':'application/json',Origin:config.origin}:{}),...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrfToken}:{}),...headers},body:method==='GET'?undefined:JSON.stringify(data||{})});const body=await response.json();return {status:response.status,body,headers:response.headers,cookie:response.headers.getSetCookie().find(cookie=>/^(?:__Host-creangel-session|creangel_session)=.+;/.test(cookie))?.split(';')[0],csrfToken:body.csrfToken};}
  async function login(value=initial){const challenge=await fetch(url+'/api/captcha');const cookie=challenge.headers.getSetCookie()[0].split(';')[0];return request('/api/login',{method:'POST',data:{username:'audit_admin',password:value,captchaAnswer:'AB234'},headers:{Cookie:cookie}});}
  async function enroll(){const pending=await login(),changed=password();const next=await request('/api/password',{method:'POST',session:pending,data:{currentPassword:initial,newPassword:changed}});assert.equal(next.status,200);const setup=await request('/api/mfa/setup',{method:'POST',session:next});assert.equal(setup.status,200);const verified=await request('/api/mfa/confirm',{method:'POST',session:next,data:{code:totp(setup.body.secret,clock)}});assert.equal(verified.status,200);return {session:verified,secret:setup.body.secret,codes:verified.body.recoveryCodes,password:changed,pending:next};}
  return {root,store,mfa,request,login,enroll,initial,advance:ms=>clock+=ms,time:()=>clock};
}

test('new passwords reject common/repeated/context keys and preserve strong passphrases',()=>{
  for(const value of ['A'.repeat(15),'password123456789','Creangel20262026!','audit_admin20262026!','abcdabcdabcdabcd'])assert.throws(()=>validateNewPassword(value,{username:'audit_admin'}),{status:400});
  assert.throws(()=>validateNewPassword('long-but-14chr'),{status:400});
  assert.throws(()=>validateNewPassword('😀😁😂😃😄😅😆😉'),{status:400});
  assert.throws(()=>validateNewPassword('😀'.repeat(15)),{status:400});
  assert.doesNotThrow(()=>validateNewPassword('Lluvia tranquila sobre montañas azules',{username:'audit_admin'}));
});
test('versioned KDF uses approved cost, accepts legacy credentials and constrains encoded parameters',async()=>{
  const value=password(),salt=randomBytes(16).toString('hex');const key=await promisify(scryptCallback)(value,salt,64,{N:32768,r:8,p:1,maxmem:128*1024*1024});const old=`scrypt$${salt}$${key.toString('hex')}`;
  assert.equal(await verifyPassword(value,old),true);const upgraded=await upgradePasswordHash(value,old);assert.match(upgraded,/^scrypt\$v2\$32768\$8\$3\$/);assert.equal(await verifyPassword(value,upgraded),true);assert.equal(await verifyPassword(value,upgraded.replace('$32768$','$999999999$')),false);assert.equal(await verifyPassword('wrong',upgraded),false);assert.notEqual(await hashPassword(value),upgraded);
});
test('RFC 6238 SHA-1 test vector and base32 interoperability',()=>{
  const secret=base32(Buffer.from('12345678901234567890'));assert.equal(secret,'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');assert.equal(totp(secret,59000,8),'94287082');assert.equal(totp(secret,1111111109000,8),'07081804');
});
test('account creation and password changes reject weak credentials without persistent effects',async t=>{
  const f=await fixture(t),a=await f.enroll(),before=f.store.byName('audit_admin').password_hash;
  for(const value of ['A'.repeat(15),'password123456789','Creangel20262026!']) {
    assert.equal((await f.request('/api/users',{method:'POST',session:a.session,data:{username:'blocked_fixture',displayName:'Fixture',role:'editor',password:value}})).status,400);
    assert.equal((await f.request('/api/password',{method:'POST',session:a.session,data:{currentPassword:a.password,newPassword:value}})).status,400);
  }
  assert.equal(f.store.users().length,1);assert.equal(f.store.byName('audit_admin').password_hash,before);assert.equal(await verifyPassword(a.password,before),true);
});
test('legacy database migration backs up, preserves account identity and upgrades only after valid login',async t=>{
  const f=await fixture(t,{legacy:true}),before=f.store.byName('audit_admin');assert.equal(before.must_change,0);assert.match(before.password_hash,/^scrypt\$[a-f0-9]{32}\$/);assert.equal((await fs.stat(f.root+'/editor.sqlite.pre-security-v2.sqlite')).isFile(),true);
  const pending=await f.login();assert.equal(pending.status,200);const after=f.store.byName('audit_admin');assert.equal(after.id,before.id);assert.equal(after.active,before.active);assert.equal(after.role,before.role);assert.equal(after.must_change,1);assert.match(after.password_hash,/^scrypt\$v2\$32768\$8\$3\$/);assert.equal(await verifyPassword(f.initial,after.password_hash),true);assert.equal((await f.request('/api/users',{session:pending})).status,403);
});
test('admin MFA enrollment is enforced, secrets encrypted, sessions rotated and OTP replay denied',async t=>{
  const f=await fixture(t),a=await f.enroll();assert.equal((await f.request('/api/users',{session:a.pending})).status,401);assert.equal((await f.request('/api/users',{session:a.session})).status,200);
  const row=f.store.db.prepare('SELECT * FROM mfa_secrets').get();assert.ok(!JSON.stringify(row).includes(a.secret));assert.equal(row.enabled,1);assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM mfa_recovery').get().n,10);assert.ok(!JSON.stringify(f.store.events()).includes(a.secret));
  const pending=await f.login(a.password);assert.equal(pending.body.mfa.verified,false);assert.equal((await f.request('/api/users',{session:pending})).status,403);assert.equal((await f.request('/api/mfa/verify',{method:'POST',session:pending,data:{code:totp(a.secret,f.time())}})).status,400);f.advance(30000);const completed=await f.request('/api/mfa/verify',{method:'POST',session:pending,data:{code:totp(a.secret,f.time())}});assert.equal(completed.status,200);assert.notEqual(completed.cookie,pending.cookie);assert.equal((await f.request('/api/session',{session:pending})).status,401);
});
test('recovery code is single use and requires the password-bound pending session',async t=>{
  const f=await fixture(t),a=await f.enroll(),pending=await f.login(a.password);const recovered=await f.request('/api/mfa/verify',{method:'POST',session:pending,data:{code:a.codes[0]}});assert.equal(recovered.status,200);assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM mfa_recovery').get().n,9);const again=await f.login(a.password);assert.equal((await f.request('/api/mfa/verify',{method:'POST',session:again,data:{code:a.codes[0]}})).status,400);assert.equal((await f.request('/api/mfa/verify',{method:'POST',data:{code:a.codes[1]}})).status,401);assert.ok(!JSON.stringify(f.store.events()).includes(a.codes[0]));
});
test('idle timeout cannot be extended by session/alert polling; critical mutation requires fresh password and MFA',async t=>{
  const f=await fixture(t),a=await f.enroll();f.advance(6*60000);const payload={username:'new_audit_editor',displayName:'Synthetic editor',role:'editor',password:password()};const denied=await f.request('/api/users',{method:'POST',session:a.session,data:payload});assert.equal(denied.status,403);assert.equal(denied.body.code,'reauth_required');assert.equal(f.store.users().length,1);
  const reconfirmed=await f.request('/api/reauth',{method:'POST',session:a.session,data:{password:a.password,code:totp(a.secret,f.time())}});assert.equal(reconfirmed.status,200);assert.equal((await f.request('/api/users',{method:'POST',session:a.session,data:payload})).status,201);
  const hash=digest(a.session.cookie.split('=')[1]),last=f.store.db.prepare('SELECT last_seen FROM sessions WHERE id_hash=?').get(hash).last_seen;f.advance(20*60000);assert.equal((await f.request('/api/session',{session:a.session})).status,200);assert.equal((await f.request('/api/alerts',{session:a.session})).status,200);assert.equal(f.store.db.prepare('SELECT last_seen FROM sessions WHERE id_hash=?').get(hash).last_seen,last);f.advance(10*60000);assert.equal((await f.request('/api/session',{session:a.session})).status,401);
});
test('MFA guessing has per-account budget across sessions',async t=>{
  const f=await fixture(t),a=await f.enroll(),pending=await f.login(a.password);for(let i=0;i<6;i++)assert.equal((await f.request('/api/mfa/verify',{method:'POST',session:pending,data:{code:'invalid'}})).status,400);const other=await f.login(a.password);assert.equal((await f.request('/api/mfa/verify',{method:'POST',session:other,data:{code:a.codes[0]}})).status,429);
});
test('denied CSRF, privileges, failed MFA and logout are audited with context but without credentials',async t=>{
  const f=await fixture(t),a=await f.enroll();await f.request('/api/users',{method:'POST',session:a.session,data:{},headers:{'X-CSRF-Token':'incorrect'}});const pending=await f.login(a.password);await f.request('/api/mfa/verify',{method:'POST',session:pending,data:{code:'invalid'}});await f.request('/api/logout',{method:'POST',session:a.session});const events=f.store.events();assert.ok(events.some(e=>e.action==='acceso_denegado'));assert.ok(events.some(e=>e.action==='mfa_fallido'));assert.ok(events.some(e=>e.action==='cierre_sesion'));assert.ok(events.some(e=>e.details.context?.ip==='127.0.0.1'&&e.details.context.correlationId));for(const value of [a.password,a.secret,...a.codes])assert.ok(!JSON.stringify(events).includes(value));
});
test('production sessions have Host-prefix, Secure, HttpOnly, SameSite and no Domain attribute',async t=>{
  const f=await fixture(t,{secure:true}),session=await f.login();assert.equal(session.status,200);assert.match(session.cookie,/^__Host-creangel-session=/);const cookie=session.headers.getSetCookie().find(value=>value.startsWith('__Host-creangel-session='));assert.match(cookie,/Path=\/; HttpOnly; SameSite=Strict/);assert.match(cookie,/; Secure$/);assert.doesNotMatch(cookie,/Domain=/);assert.equal((await f.request('/api/users',{session})).status,403);
});
test('content validation denials are audited without document content and malformed media URLs return 400',async t=>{
  const f=await fixture(t),a=await f.enroll();assert.equal((await f.request('/api/content',{method:'POST',session:a.session,data:{action:'persistMedia',params:{asset:{path:'public/multimedia/documentacion/invalid.png',encoding:'base64',content:'AAAA'}}}})).status,400);
  assert.equal((await f.request('/api/media/%ZZ',{session:a.session})).status,400);const event=f.store.events().find(item=>item.action==='contenido_rechazado');assert.ok(event);assert.equal(event.details.status,400);assert.ok(!JSON.stringify(event).includes('AAAA'));
});
