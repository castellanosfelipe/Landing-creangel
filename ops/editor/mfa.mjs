import {randomBytes,createHmac,createCipheriv,createDecipheriv,timingSafeEqual} from 'node:crypto';
import {readFileSync,writeFileSync,chmodSync} from 'node:fs';
import path from 'node:path';
import {digest,fail} from './security.mjs';
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(bytes) {let bits=0,value=0,out='';for(const byte of bytes){value=(value<<8)|byte;bits+=8;while(bits>=5){out+=alphabet[(value>>>(bits-5))&31];bits-=5;}}if(bits)out+=alphabet[(value<<(5-bits))&31];return out;}
function decode(value) {let bits=0,buffer=0;const out=[];for(const char of value){const index=alphabet.indexOf(char);if(index<0)throw new Error('Invalid TOTP secret');buffer=(buffer<<5)|index;bits+=5;if(bits>=8){out.push((buffer>>>(bits-8))&255);bits-=8;}}return Buffer.from(out);}
export function totp(secret,time=Date.now(),digits=6) {const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(time/30000)));const hash=createHmac('sha1',decode(secret)).update(counter).digest();const offset=hash[hash.length-1]&15;return String((hash.readUInt32BE(offset)&0x7fffffff)%10**digits).padStart(digits,'0');}
export class Mfa {
  constructor(store,{now=()=>Date.now()}={}) {
    this.store=store;this.db=store.db;this.now=now;
    this.db.exec(`CREATE TABLE IF NOT EXISTS mfa_secrets(user_id TEXT PRIMARY KEY,encrypted TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,pending_session TEXT,pending_until INTEGER,last_counter INTEGER NOT NULL DEFAULT -1);
      CREATE TABLE IF NOT EXISTS mfa_recovery(user_id TEXT NOT NULL,code_hash TEXT NOT NULL,PRIMARY KEY(user_id,code_hash));`);
    const file=path.join(path.dirname(store.filename),'mfa.key');
    try{this.key=readFileSync(file);}catch(error){if(error.code!=='ENOENT')throw error;if(this.db.prepare('SELECT count(*) AS n FROM mfa_secrets').get().n)throw new Error('Missing MFA encryption key; restore it from the protected backup.');try{writeFileSync(file,randomBytes(32),{mode:0o600,flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}this.key=readFileSync(file);}
    if(this.key.length!==32)throw new Error('Invalid MFA encryption key');chmodSync(file,0o600);
  }
  encrypt(secret) {const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);const bytes=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64');}
  decrypt(value) {const bytes=Buffer.from(value,'base64');const cipher=createDecipheriv('aes-256-gcm',this.key,bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString('utf8');}
  enabled(userId) {return Boolean(this.db.prepare('SELECT enabled FROM mfa_secrets WHERE user_id=?').get(userId)?.enabled);}
  setup(userId,sessionHash,username) {
    if(this.enabled(userId))fail(409,'El segundo factor ya está configurado.');
    const existing=this.db.prepare('SELECT * FROM mfa_secrets WHERE user_id=?').get(userId);
    let secret;
    if(existing?.pending_session===sessionHash&&existing.pending_until>this.now())secret=this.decrypt(existing.encrypted);
    else {secret=base32(randomBytes(20));this.db.prepare('INSERT INTO mfa_secrets(user_id,encrypted,pending_session,pending_until) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET encrypted=excluded.encrypted,pending_session=excluded.pending_session,pending_until=excluded.pending_until,last_counter=-1').run(userId,this.encrypt(secret),sessionHash,this.now()+10*60*1000);}
    return {secret,uri:`otpauth://totp/${encodeURIComponent('Creangel:'+username)}?secret=${secret}&issuer=Creangel&algorithm=SHA1&digits=6&period=30`};
  }
  budget(userId) {const key=digest('mfa\0'+userId);this.db.prepare('DELETE FROM attempts WHERE until_at<?').run(this.now());const entry=this.db.prepare('SELECT * FROM attempts WHERE key=?').get(key);if(entry?.count>=6){const error=new Error('Demasiados códigos incorrectos. Espere diez minutos antes de volver a intentar.');error.status=429;error.retryAfter=Math.max(1,Math.ceil((entry.until_at-this.now())/1000));throw error;}return key;}
  failed(key) {this.db.prepare('INSERT INTO attempts(key,count,until_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key,this.now()+10*60*1000);fail(400,'El código de verificación no es válido o ya fue utilizado.');}
  counter(row,code) {
    if(typeof code!=='string'||!/^\d{6}$/.test(code))return null;
    for(const offset of [0,-1,1]) {const at=this.now()+offset*30000,counter=Math.floor(at/30000);if(counter<=row.last_counter)continue;const expected=totp(this.decrypt(row.encrypted),at);if(timingSafeEqual(Buffer.from(code),Buffer.from(expected)))return counter;}
    return null;
  }
  recovery(userId) {const codes=Array.from({length:10},()=>randomBytes(12).toString('hex').toUpperCase().match(/.{4}/g).join('-'));this.db.prepare('DELETE FROM mfa_recovery WHERE user_id=?').run(userId);const insert=this.db.prepare('INSERT INTO mfa_recovery VALUES(?,?)');for(const code of codes)insert.run(userId,digest(code.replaceAll('-','')));return codes;}
  confirm(userId,sessionHash,code) {
    const key=this.budget(userId),row=this.db.prepare('SELECT * FROM mfa_secrets WHERE user_id=?').get(userId);
    const counter=row&&!row.enabled&&row.pending_session===sessionHash&&row.pending_until>this.now()?this.counter(row,code):null;
    if(counter===null)this.failed(key);
    this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('UPDATE mfa_secrets SET enabled=1,pending_session=NULL,pending_until=NULL,last_counter=? WHERE user_id=?').run(counter,userId);const codes=this.recovery(userId);this.db.prepare('DELETE FROM attempts WHERE key=?').run(key);this.db.exec('COMMIT');return codes;}catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  verify(userId,code) {
    const key=this.budget(userId),row=this.db.prepare('SELECT * FROM mfa_secrets WHERE user_id=? AND enabled=1').get(userId);
    if(!row)this.failed(key);
    const counter=this.counter(row,code);
    if(counter!==null){const changed=this.db.prepare('UPDATE mfa_secrets SET last_counter=? WHERE user_id=? AND last_counter<?').run(counter,userId,counter);if(changed.changes!==1)this.failed(key);this.db.prepare('DELETE FROM attempts WHERE key=?').run(key);return 'totp';}
    const recovery=typeof code==='string'?code.toUpperCase().replace(/[\s-]/g,''):'';
    if(/^[A-F0-9]{24}$/.test(recovery)&&this.db.prepare('DELETE FROM mfa_recovery WHERE user_id=? AND code_hash=? RETURNING code_hash').get(userId,digest(recovery))){this.db.prepare('DELETE FROM attempts WHERE key=?').run(key);return 'recovery';}
    this.failed(key);
  }
}
