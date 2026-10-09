import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {Store,publicUser} from './store.mjs';
import {Content} from './content.mjs';
import {Captcha} from './captcha.mjs';
import {Mfa} from './mfa.mjs';
import {randomUUID} from 'node:crypto';
import {withAuditContext} from './security-operations.mjs';
import {validateNewPassword} from './password-policy.mjs';
import {token,digest,origin,fail,hashPassword,verifyPassword,upgradePasswordHash} from './security.mjs';

export function configuration(env=process.env) {
  return {origin:origin(env.PUBLIC_SITE_URL||'https://portal.creangel.com'),database:env.EDITOR_DATABASE||'/var/lib/editor/editor.sqlite',contentRoot:env.CONTENT_ROOT||'/workspace',adminUsername:env.INITIAL_ADMIN_USERNAME||'admin',passwordFile:env.INITIAL_ADMIN_PASSWORD_FILE,port:Number(env.EDITOR_PORT||8081),idleMinutes:Math.max(5,Math.min(60,Number(env.EDITOR_IDLE_MINUTES)||30))};
}
export async function createEditorServer(config,{captchaGenerator,now=()=>Date.now()}={}) {
  const store=new Store(config.database);
  await store.bootstrap(config.adminUsername,config.passwordFile);
  const content=new Content(config.contentRoot,store.audit.bind(store),config.origin);
  const cookieName=config.origin.startsWith('https:')?'__Host-creangel-session':'creangel_session';
  const captchaCookieName=config.origin.startsWith('https:')?'__Host-creangel-captcha':'creangel_captcha';
  const captcha=new Captcha(store.db,{generator:captchaGenerator});
  const mfa=new Mfa(store,{now});
  const dummy=await hashPassword(token());
  const hours=8*3600;
  const idleMs=(config.idleMinutes||30)*60*1000;
  function identity(row,record) {return {user:publicUser(row),csrfToken:record.csrf,mfa:{required:row.role==='admin',setupRequired:row.role==='admin'&&!mfa.enabled(row.id),verified:row.role!=='admin'||Boolean(record.mfa_verified)},reauthenticatedUntil:record.reauth_until};}
  function appendCookie(response,value) {
    const existing=response.getHeader('Set-Cookie');
    response.setHeader('Set-Cookie',[...(Array.isArray(existing)?existing:existing?[existing]:[]),value]);
  }
  function cookie(response,value,age=hours) {
    appendCookie(response,`${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${config.origin.startsWith('https:')?'; Secure':''}`);
  }
  function captchaCookie(response,value,age=300) {
    appendCookie(response,`${captchaCookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${config.origin.startsWith('https:')?'; Secure':''}`);
  }
  function challengeId(request) {
    const matches=(request.headers.cookie||'').split(';').map(part=>part.trim()).filter(part=>part.startsWith(captchaCookieName+'='));
    return matches.length===1?matches[0].slice(captchaCookieName.length+1):undefined;
  }
  function clientBinding(request) {
    return String(request.headers['x-real-ip']||request.socket.remoteAddress);
  }
  function startSession(response,row,{verified=false,reauthUntil=0}={}) {
    const id=token(),csrfToken=token();
    const at=now(),pending=row.role==='admin'&&!verified;
    store.db.prepare('DELETE FROM sessions WHERE expires<?').run(at);
    store.db.prepare('INSERT INTO sessions(id_hash,user_id,csrf,expires,last_seen,mfa_verified,authenticated_at,reauth_until) VALUES(?,?,?,?,?,?,?,?)').run(digest(id),row.id,csrfToken,at+(pending?10*60*1000:hours*1000),at,Number(verified),at,reauthUntil);
    cookie(response,id);
    return identity(row,store.db.prepare('SELECT * FROM sessions WHERE id_hash=?').get(digest(id)));
  }
  function session(request) {
    const cookies=(request.headers.cookie||'').split(';').map(part=>part.trim()).filter(part=>part.startsWith(cookieName+'='));
    if(cookies.length!==1)fail(401,'Inicie sesión para continuar.');
    const id=cookies[0].slice(cookieName.length+1);
    if(!/^[A-Za-z0-9_-]{43}$/.test(id))fail(401,'La sesión no es válida.');
    const record=store.db.prepare('SELECT * FROM sessions WHERE id_hash=? AND expires>?').get(digest(id),now());
    const row=record&&store.row(record.user_id);
    if(!record||!row?.active)fail(401,'La sesión venció o la cuenta está desactivada.');
    if(now()-record.last_seen>=idleMs){store.db.prepare('DELETE FROM sessions WHERE id_hash=?').run(record.id_hash);store.audit(row.username,'sesion_inactividad',row.username);fail(401,'La sesión terminó por inactividad. Inicie sesión nuevamente.');}
    return {record,row};
  }
  function ready(request) {const current=session(request);if(current.row.must_change)fail(403,'Cambie su contraseña inicial antes de editar.');if(current.row.role==='admin'&&(!mfa.enabled(current.row.id)||!current.record.mfa_verified)){const error=new Error('Complete el segundo factor para continuar.');error.status=403;error.code='mfa_required';throw error;}return current;}
  function fresh(request) {const current=ready(request);if(current.record.reauth_until<now()){const error=new Error('Confirme su identidad antes de realizar esta operación.');error.status=403;error.code='reauth_required';throw error;}return current;}
  const reply=(response,status,value)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});response.end(JSON.stringify(value));};
  async function body(request,max=16384) {
    if(!(request.headers['content-type']||'').toLowerCase().startsWith('application/json'))fail(415,'Se requiere una solicitud JSON.');
    if(request.headers.origin!==config.origin)fail(403,'Origen de solicitud no autorizado.');
    const parts=[];let size=0;
    for await(const part of request){size+=part.length;if(size>max)fail(413,'La solicitud es demasiado grande.');parts.push(part);}
    try {const parsed=JSON.parse(Buffer.concat(parts).toString('utf8'));if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error();return parsed;}catch {fail(400,'Solicitud inválida.');}
  }
  function throttleKey(request,username) {return digest(`${clientBinding(request)}\0${username}`);}
  async function login(request,response) {
    const values=await body(request);
    const username=String(values.username||'').trim().toLowerCase().slice(0,64);
    const key=throttleKey(request,username);
    const at=now();
    const challenge=challengeId(request);
    captchaCookie(response,'',0);
    // Bound anonymous requests too; rotating usernames must not flood the audit/database.
    try {captcha.throttleLogin(clientBinding(request));}
    catch(error){captcha.invalidate(challenge);throw error;}
    store.db.prepare('DELETE FROM attempts WHERE until_at<?').run(at);
    const prior=store.db.prepare('SELECT * FROM attempts WHERE key=?').get(key);
    if(prior?.count>=6){captcha.invalidate(challenge);response.setHeader('Retry-After',Math.ceil((prior.until_at-at)/1000));fail(429,'Demasiados intentos. Espere unos minutos antes de volver a intentar.');}
    function failedAttempt(action='inicio_fallido') {
      store.db.prepare('INSERT INTO attempts(key,count,until_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key,at+10*60*1000);
      store.audit('acceso',action,username);
    }
    try {captcha.consume(challenge,values.captchaAnswer,clientBinding(request));}
    catch(error) {if(error.status===400)failedAttempt('captcha_fallido');throw error;}
    const row=store.byName(username);
    const correct=await verifyPassword(values.password,row?.active?row.password_hash:dummy);
    if(!row||!row.active||!correct) {
      failedAttempt();
      fail(401,'Usuario o contraseña incorrectos.');
    }
    const upgraded=await upgradePasswordHash(values.password,row.password_hash);
    // Recheck the identity after the asynchronous KDF; concurrent resets or
    // revocation must not resurrect credentials that were valid before hashing.
    const current=store.row(row.id);
    if(!current?.active||current.password_hash!==row.password_hash){failedAttempt();fail(401,'Usuario o contraseña incorrectos.');}
    if(upgraded!==row.password_hash){store.db.prepare('UPDATE users SET password_hash=? WHERE id=? AND password_hash=?').run(upgraded,row.id,row.password_hash);store.audit(row.username,'contraseña_hash_actualizado',row.username);}
    try{validateNewPassword(values.password,{username:row.username,displayName:row.display_name});}catch{store.db.prepare('UPDATE users SET must_change=1 WHERE id=?').run(row.id);}
    store.db.prepare('DELETE FROM attempts WHERE key=?').run(key);
    store.audit(row.username,'credencial_verificada',row.username);
    if(row.role!=='admin')store.audit(row.username,'inicio_sesion',row.username);
    return reply(response,200,startSession(response,store.row(row.id)));
  }
  function auditContext(request,response) {const correlationId=randomUUID();response.setHeader('X-Request-ID',correlationId);return {ip:clientBinding(request),correlationId,userAgent:String(request.headers['user-agent']||'').slice(0,240)};}
  const server=createServer({maxHeaderSize:16384},(request,response)=>withAuditContext(auditContext(request,response),async()=>{
    // Polling endpoints and denied operations must not keep an unattended
    // account alive. Touch only after a successful user operation completes.
    response.once('finish',()=>{
      const pathname=String(request.url).split('?')[0];
      if(response.statusCode<200||response.statusCode>=300||pathname==='/api/session'||pathname==='/api/alerts'||pathname==='/api/health'||pathname==='/api/captcha')return;
      const cookies=(request.headers.cookie||'').split(';').map(value=>value.trim()).filter(value=>value.startsWith(cookieName+'='));
      if(cookies.length===1&&/^[A-Za-z0-9_-]{43}$/.test(cookies[0].slice(cookieName.length+1)))store.db.prepare('UPDATE sessions SET last_seen=? WHERE id_hash=? AND expires>?').run(now(),digest(cookies[0].slice(cookieName.length+1)),now());
    });
    response.setHeader('Cache-Control','no-store');
    response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Referrer-Policy','no-referrer');
    try {
      const url=new URL(request.url,config.origin);
      if(url.origin!==config.origin)fail(400,'Solicitud inválida.');
      if(request.method==='GET'&&url.pathname==='/api/health')return reply(response,200,{status:'ok'});
      if(request.method==='GET'&&url.pathname==='/api/captcha') {
        if((request.headers.origin&&request.headers.origin!==config.origin)||request.headers['sec-fetch-site']==='cross-site')fail(403,'Origen de solicitud no autorizado.');
        const {id,image,expiresAt}=await captcha.issue(clientBinding(request),challengeId(request));
        captchaCookie(response,id);
        return reply(response,200,{image,expiresAt});
      }
      if(request.method==='POST'&&url.pathname==='/api/login')return await login(request,response);
      const {record,row}=session(request);
      if(request.method==='GET'&&url.pathname==='/api/session')return reply(response,200,identity(row,record));
      if(!['GET','POST','PATCH'].includes(request.method))fail(405,'Método no disponible.');
      let values={};
      if(request.method!=='GET') {
        if(request.headers['x-csrf-token']!==record.csrf)fail(403,'La sesión de edición no es válida. Recargue la página.');
        values=await body(request,url.pathname==='/api/content'?15*1024*1024:16384);
      }
      if(request.method==='POST'&&url.pathname==='/api/logout') {
        store.db.prepare('DELETE FROM sessions WHERE id_hash=?').run(record.id_hash);cookie(response,'',0);
        store.audit(row.username,'cierre_sesion',row.username);
        return reply(response,200,{ok:true});
      }
      if(request.method==='POST'&&url.pathname==='/api/password') {
        if(!row.must_change)fresh(request);
        if(!(await verifyPassword(values.currentPassword,row.password_hash)))fail(400,'La contraseña actual no es correcta.');
        if(await verifyPassword(values.newPassword,row.password_hash))fail(400,'Elija una contraseña diferente a la actual.');
        await store.setPassword(row.id,values.newPassword,false,row.username,()=>session(request));
        return reply(response,200,startSession(response,store.row(row.id),{verified:Boolean(record.mfa_verified),reauthUntil:now()+5*60*1000}));
      }
      if(row.must_change)fail(403,'Cambie su contraseña inicial antes de editar.');
      if(request.method==='POST'&&url.pathname==='/api/mfa/setup') {
        if(row.role!=='admin')fail(403,'El segundo factor administrativo no aplica a esta cuenta.');
        const result=mfa.setup(row.id,record.id_hash,row.username);store.audit(row.username,'mfa_configuracion_iniciada',row.username);return reply(response,200,result);
      }
      if(request.method==='POST'&&url.pathname==='/api/mfa/confirm') {
        if(row.role!=='admin')fail(403,'Operación no autorizada.');
        const recoveryCodes=mfa.confirm(row.id,record.id_hash,values.code);store.revoke(row.id);store.audit(row.username,'mfa_activado',row.username);store.audit(row.username,'inicio_sesion',row.username);
        return reply(response,200,{...startSession(response,row,{verified:true,reauthUntil:now()+5*60*1000}),recoveryCodes});
      }
      if(request.method==='POST'&&url.pathname==='/api/mfa/verify') {
        if(row.role!=='admin'||record.mfa_verified)fail(403,'Operación no autorizada.');
        const method=mfa.verify(row.id,values.code);store.db.prepare('DELETE FROM sessions WHERE id_hash=?').run(record.id_hash);store.audit(row.username,method==='recovery'?'mfa_recuperacion_usada':'mfa_verificado',row.username);store.audit(row.username,'inicio_sesion',row.username);
        return reply(response,200,startSession(response,row,{verified:true,reauthUntil:now()+5*60*1000}));
      }
      ready(request);
      if(request.method==='POST'&&url.pathname==='/api/reauth') {
        const key=digest('reauth\0'+row.id),entry=store.db.prepare('SELECT * FROM attempts WHERE key=? AND until_at>?').get(key,now());
        if(entry?.count>=6)fail(429,'Demasiados intentos. Espere diez minutos.');
        if(!(await verifyPassword(values.password,row.password_hash))){store.db.prepare('INSERT INTO attempts(key,count,until_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1,until_at=excluded.until_at').run(key,now()+10*60*1000);store.audit(row.username,'reauth_fallido',row.username);fail(400,'No se pudo verificar su identidad.');}
        ready(request);
        if(row.role==='admin'){const method=mfa.verify(row.id,values.code);store.audit(row.username,method==='recovery'?'mfa_recuperacion_usada':'mfa_verificado',row.username);}
        store.db.prepare('DELETE FROM attempts WHERE key=?').run(key);store.db.prepare('UPDATE sessions SET reauth_until=? WHERE id_hash=?').run(now()+5*60*1000,record.id_hash);store.audit(row.username,'identidad_reconfirmada',row.username);
        return reply(response,200,identity(row,store.db.prepare('SELECT * FROM sessions WHERE id_hash=?').get(record.id_hash)));
      }
      if(request.method==='POST'&&url.pathname==='/api/mfa/recovery') {fresh(request);if(row.role!=='admin')fail(403,'Operación no autorizada.');store.audit(row.username,'mfa_recuperacion_renovada',row.username);return reply(response,200,{recoveryCodes:mfa.recovery(row.id)});}
      if(request.method==='POST'&&url.pathname==='/api/content') {
        // Recheck after asynchronous password hashing/user management in other requests.
        if(!store.row(row.id)?.active)fail(401,'La cuenta fue desactivada.');
        return reply(response,200,await content.request(values.action,values.params||{},row,()=>ready(request)));
      }
      if(request.method==='GET'&&url.pathname.startsWith('/api/media/')) {
        let name;try{name=decodeURIComponent(url.pathname.slice('/api/media/'.length));}catch{fail(400,'Dirección de imagen inválida.');}
        const result=await content.serve(name);
        response.writeHead(200,{'Content-Type':result.type,'Content-Length':result.bytes.length});return response.end(result.bytes);
      }
      if(url.pathname==='/api/users'||url.pathname.startsWith('/api/users/')||url.pathname==='/api/audit'||url.pathname==='/api/alerts'||url.pathname.startsWith('/api/alerts/')) {
        if(row.role!=='admin')fail(403,'Solo un administrador puede gestionar usuarios.');
        const authorizeAdmin=()=>{const current=fresh(request).row;if(current.role!=='admin')fail(403,'Solo un administrador puede gestionar usuarios.');};
        if(request.method==='GET'&&url.pathname==='/api/users')return reply(response,200,{users:store.users()});
        if(request.method==='GET'&&url.pathname==='/api/audit')return reply(response,200,{events:store.events()});
        if(request.method==='GET'&&url.pathname==='/api/alerts')return reply(response,200,{alerts:store.security.alerts()});
        const alert=/^\/api\/alerts\/([a-f0-9-]{36})\/ack$/.exec(url.pathname);
        if(alert&&request.method==='POST'){authorizeAdmin();store.security.acknowledge(alert[1],row.username);return reply(response,200,{ok:true});}
        if(request.method!=='GET')authorizeAdmin();
        if(request.method==='POST'&&url.pathname==='/api/users')return reply(response,201,{user:await store.add(values,row.username,authorizeAdmin)});
        const match=/^\/api\/users\/([a-f0-9-]{36})(\/password)?$/.exec(url.pathname);
        if(match&&request.method==='PATCH'&&!match[2])return reply(response,200,{user:store.update(match[1],values,row)});
        if(match&&request.method==='POST'&&match[2])return reply(response,200,{user:await store.setPassword(match[1],values.password,true,row.username,authorizeAdmin)});
      }
      fail(404,'Operación no encontrada.');
    } catch(error) {
      if(error.status===401||error.status===403||error.status===429||!error.status||request.url.startsWith('/api/mfa/')||request.url==='/api/content'||(error.status===400&&request.url==='/api/password')) {
        let actor='anonimo';try{actor=session(request).row.username;}catch{}
        store.audit(actor,[401,403].includes(error.status)?'acceso_denegado':error.status===429?'limite_solicitudes':request.url.startsWith('/api/mfa/')?'mfa_fallido':request.url==='/api/password'?'contraseña_cambio_fallido':request.url==='/api/content'?'contenido_rechazado':'error_interno','',{method:request.method,path:String(request.url).split('?')[0].slice(0,240),status:error.status||500});
      }
      if(error.retryAfter)response.setHeader('Retry-After',error.retryAfter);
      if(!response.headersSent)reply(response,error.status||500,{error:error.status?error.message:'No se pudo completar la operación.',...(error.code?{code:error.code}:{})});
      else response.end();
    }
  }));
  server.requestTimeout=30000;server.headersTimeout=15000;server.keepAliveTimeout=5000;
  server.on('close',()=>store.close());
  return {server,store,mfa};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const config=configuration();
  const {server}=await createEditorServer(config);
  server.listen(config.port,'0.0.0.0',()=>console.log('Administración de editores disponible.'));
  const stop=()=>{server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),10000).unref();};
  process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
