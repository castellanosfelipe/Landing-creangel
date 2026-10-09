import {randomBytes, scrypt, timingSafeEqual, createHash} from 'node:crypto';
import {promisify} from 'node:util';
const derive=promisify(scrypt);
const cost={N:32768,r:8,p:3,maxmem:128*1024*1024};
export const token=()=>randomBytes(32).toString('base64url');
export const digest=value=>createHash('sha256').update(value).digest('hex');
export function fail(status,message) {const error=new Error(message);error.status=status;throw error;}
export function passwordRules(value) {
  if(typeof value!=='string'||[...value].length<15||[...value].length>128) fail(400,'La contraseña debe tener entre 15 y 128 caracteres.');
}
async function encode(value) {
  const salt=randomBytes(16).toString('hex');
  const key=await derive(value,salt,64,cost);
  return `scrypt$v2$${cost.N}$${cost.r}$${cost.p}$${salt}$${key.toString('hex')}`;
}
export async function hashPassword(value) {passwordRules(value);return encode(value);}
export const needsPasswordUpgrade=stored=>typeof stored==='string'&&!stored.startsWith('scrypt$v2$32768$8$3$');
// Only used after successful verification, preserving legacy credentials even
// when their length predates today's creation policy.
export async function upgradePasswordHash(value,stored) {
  if(!needsPasswordUpgrade(stored))return stored;
  if(!(await verifyPassword(value,stored)))fail(401,'Credencial no válida.');
  return encode(value);
}
export async function verifyPassword(value,stored) {
  if(typeof value!=='string'||value.length>256||typeof stored!=='string')return false;
  const parts=stored.split('$');let salt,hex,parameters;
  if(parts.length===3&&parts[0]==='scrypt') {[,salt,hex]=parts;parameters={...cost,p:1};}
  else if(parts.length===7&&parts[0]==='scrypt'&&parts[1]==='v2'&&parts[2]==='32768'&&parts[3]==='8'&&parts[4]==='3') {salt=parts[5];hex=parts[6];parameters=cost;}
  else return false;
  if(!/^[a-f0-9]{32}$/.test(salt)||!/^[a-f0-9]{128}$/.test(hex))return false;
  const key=await derive(value,salt,64,parameters);
  // Legacy verification retains its original KDF output while spending the
  // remaining work budget; migrating accounts should not expose a cheaper
  // password-check path than nonexistent/new accounts.
  if(parts.length===3)await derive(value,salt,64,{...cost,p:2});
  const expected=Buffer.from(hex,'hex');
  return expected.length===key.length&&timingSafeEqual(expected,key);
}
export function origin(value) {
  const site=new URL(value);
  if(site.protocol!=='https:'&&!(site.protocol==='http:'&&['127.0.0.1','localhost'].includes(site.hostname))) fail(400,'Use HTTPS o un origen local de pruebas.');
  if(site.pathname!=='/'||site.username||site.password||site.search||site.hash)fail(400,'El origen del portal no es válido.');
  return site.origin;
}
