import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {once} from 'node:events';
import {Captcha,generateCaptcha} from '../captcha.mjs';
import {createEditorServer} from '../server.mjs';

const generator=()=>({answer:'AB234',svg:'<svg xmlns="http://www.w3.org/2000/svg" width="250" height="88"><path d="M1 1L20 20"/></svg>'});
function fixture(t) {
  const db=new DatabaseSync(':memory:');
  let clock=1000;
  const captcha=new Captcha(db,{generator,now:()=>clock});
  t.after(()=>db.close());
  return {captcha,db,advance:delta=>clock+=delta};
}

test('CAPTCHA images use randomized path glyphs without exposing their answer as text or metadata',()=>{
  const answers=new Set();
  for(let i=0;i<100;i++) {
    const {answer,svg}=generateCaptcha();answers.add(answer);
    assert.match(answer,/^[ABCDEFGHJKLMNPRTUVWXY2346789]{5}$/);
    assert.ok(svg.startsWith('<svg'));assert.ok(svg.endsWith('</svg>'));
    assert.match(svg,/viewBox="0 0 250 88"/);
    assert.ok(!svg.includes(answer));
    assert.doesNotMatch(svg,/<(?:text|script|foreignObject|image|use)\b|href=|onload=|font-family|data-answer/i);
    assert.equal((svg.match(/transform="/g)||[]).length,5);
    assert.ok(svg.length<20000);
  }
  assert.ok(answers.size>95);
});

test('issued challenges expose only PNG pixels and store hashed identifiers, solutions and bindings',async t=>{
  const {captcha,db}=fixture(t),challenge=await captcha.issue('browser-ip');
  assert.equal(challenge.expiresAt,301000);
  assert.match(challenge.id,/^[A-Za-z0-9_-]{43}$/);
  assert.match(challenge.image,/^data:image\/png;base64,/);
  const image=Buffer.from(challenge.image.split(',')[1],'base64');
  assert.deepEqual(image.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));
  assert.equal(image.readUInt32BE(16),500);assert.equal(image.readUInt32BE(20),176);
  assert.ok(!image.includes(Buffer.from('AB234')));assert.ok(!image.includes(Buffer.from('<svg')));
  const stored=JSON.stringify(db.prepare('SELECT * FROM captcha_challenges').get());
  assert.ok(!stored.includes('AB234'));assert.ok(!stored.includes(challenge.id));assert.ok(!stored.includes('browser-ip'));
  assert.equal(captcha.consume(challenge.id,' a b 2 3 4 ','browser-ip'),true);
  assert.throws(()=>captcha.consume(challenge.id,'AB234','browser-ip'),{status:400});
});

test('incorrect, absent, expired and differently bound answers consume their challenge once',async t=>{
  const {captcha,advance,db}=fixture(t);
  for(const answer of ['WRONG','',null,123,'AB234'.repeat(10)]) {
    const challenge=await captcha.issue('browser-ip');
    assert.throws(()=>captcha.consume(challenge.id,answer,'browser-ip'),{status:400});
    assert.throws(()=>captcha.consume(challenge.id,'AB234','browser-ip'),{status:400});
  }
  const changedBrowser=await captcha.issue('browser-ip');
  assert.throws(()=>captcha.consume(changedBrowser.id,'AB234','other-ip'),{status:400});
  assert.throws(()=>captcha.consume(changedBrowser.id,'AB234','browser-ip'),{status:400});
  const expired=await captcha.issue('browser-ip');advance(300000);
  assert.throws(()=>captcha.consume(expired.id,'AB234','browser-ip'),{status:400});
  assert.equal(db.prepare('SELECT count(*) AS n FROM captcha_challenges').get().n,0);
  assert.throws(()=>captcha.consume(undefined,'AB234','browser-ip'),{status:400});
  assert.throws(()=>captcha.consume('invalid-id','AB234','browser-ip'),{status:400});
});

test('refresh replaces a previous challenge; generation limits and expiry bound stored challenges',async t=>{
  const {captcha,advance,db}=fixture(t);
  let challenge=await captcha.issue('browser-ip');
  for(let i=1;i<20;i++) {
    const next=await captcha.issue('browser-ip',challenge.id);
    assert.throws(()=>captcha.consume(challenge.id,'AB234','browser-ip'),{status:400});
    challenge=next;
  }
  assert.equal(db.prepare('SELECT count(*) AS n FROM captcha_challenges').get().n,1);
  await assert.rejects(captcha.issue('browser-ip',challenge.id),error=>error.status===429&&error.retryAfter===60);
  // A rate-limited refresh leaves the already displayed challenge usable.
  assert.equal(captcha.consume(challenge.id,'AB234','browser-ip'),true);
  advance(60000);
  const next=await captcha.issue('browser-ip');assert.equal(next.expiresAt,361000);
  advance(300000);
  await captcha.issue('other-ip');
  assert.equal(db.prepare('SELECT count(*) AS n FROM captcha_challenges').get().n,1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM captcha_rates').get().n,1);
});

test('global resource caps refuse growth without affecting accounts or sessions',async t=>{
  const {captcha,db}=fixture(t);
  const insert=db.prepare('INSERT INTO captcha_challenges VALUES(?,?,?,?)');
  for(let i=0;i<5000;i++)insert.run(String(i),'hash','binding',301000);
  await assert.rejects(captcha.issue('browser-ip'),{status:503});
  assert.equal(db.prepare('SELECT count(*) AS n FROM captcha_challenges').get().n,5000);
});

test('concurrent image rendering stays bounded and cannot bypass the generation limit',async t=>{
  const {captcha,db}=fixture(t);
  const first=await Promise.allSettled(Array.from({length:30},()=>captcha.issue('browser-ip')));
  assert.equal(first.filter(result=>result.status==='fulfilled').length,8);
  assert.ok(first.filter(result=>result.status==='rejected').every(result=>result.reason.status===503));
  assert.equal(captcha.rendering,0);
  for(let i=8;i<20;i++)await captcha.issue('browser-ip');
  await assert.rejects(captcha.issue('browser-ip'),{status:429});
  assert.equal(db.prepare('SELECT count FROM captcha_rates').get().count,20);
});

test('a rendering failure leaves the previously displayed challenge valid',async t=>{
  const {captcha}=fixture(t);
  const first=await captcha.issue('browser-ip');
  captcha.generator=()=>({answer:'AB234',svg:'<svg invalid'});
  await assert.rejects(captcha.issue('browser-ip',first.id));
  assert.equal(captcha.rendering,0);
  assert.equal(captcha.consume(first.id,'AB234','browser-ip'),true);
});

test('anonymous login requests are bounded per client regardless of rotated usernames',async t=>{
  const {captcha,advance,db}=fixture(t);
  for(let i=0;i<60;i++)captcha.throttleLogin('browser-ip');
  assert.throws(()=>captcha.throttleLogin('browser-ip'),error=>error.status===429&&error.retryAfter===60);
  assert.doesNotThrow(()=>captcha.throttleLogin('other-ip'));
  // Generation uses a separate budget and recovers after the same one-minute window.
  await captcha.issue('browser-ip');
  advance(60000);assert.doesNotThrow(()=>captcha.throttleLogin('browser-ip'));
  assert.equal(db.prepare('SELECT count(*) AS n FROM captcha_rates').get().n,1);
});

test('production CAPTCHA uses secure cookies, origin checks and separate session cookies',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'creangel-captcha-'));
  const password='Captcha-test-password-2026!';
  await fs.writeFile(path.join(root,'initial-password'),password);
  const config={origin:'https://portal.creangel.com',database:path.join(root,'accounts.sqlite'),contentRoot:root,adminUsername:'admin',passwordFile:path.join(root,'initial-password')};
  const {server,store}=await createEditorServer(config,{captchaGenerator:generator});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base+'/api/captcha',{headers:{Origin:'https://foreign.example'}})).status,403);
  assert.equal((await fetch(base+'/api/captcha',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
  const challenge=await fetch(base+'/api/captcha');
  assert.equal(challenge.status,200);assert.equal(challenge.headers.get('cache-control'),'no-store');
  const payload=await challenge.json();assert.deepEqual(Object.keys(payload).sort(),['expiresAt','image']);
  const captchaCookie=challenge.headers.getSetCookie()[0];
  assert.match(captchaCookie,/^__Host-creangel-captcha=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=300; Secure$/);
  const response=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:config.origin,Cookie:captchaCookie.split(';')[0]},body:JSON.stringify({username:'admin',password,captchaAnswer:'AB234'})});
  assert.equal(response.status,200);
  const cookies=response.headers.getSetCookie();assert.equal(cookies.length,2);
  assert.ok(cookies.some(value=>value.startsWith('__Host-creangel-captcha=;')&&value.includes('Max-Age=0')));
  assert.ok(cookies.some(value=>/^__Host-creangel-session=[A-Za-z0-9_-]{43};/.test(value)&&value.endsWith('; Secure')));
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM sessions').get().n,1);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM captcha_challenges').get().n,0);
});
