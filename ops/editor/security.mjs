import {randomBytes, scrypt, timingSafeEqual, createHash} from 'node:crypto';
import {promisify} from 'node:util';
const derive=promisify(scrypt);
export const token=()=>randomBytes(32).toString('base64url');
export const digest=value=>createHash('sha256').update(value).digest('hex');
export function fail(status,message) {const error=new Error(message);error.status=status;throw error;}
export function passwordRules(value) {
  if(typeof value!=='string'||value.length<12||value.length>128) fail(400,'La contraseña debe tener entre 12 y 128 caracteres.');
}
export async function hashPassword(value) {
  passwordRules(value);
  const salt=randomBytes(16).toString('hex');
  const key=await derive(value,salt,64,{N:32768,r:8,p:1,maxmem:128*1024*1024});
  return `scrypt$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(value,stored) {
  if(typeof value!=='string'||value.length>128)return false;
  const [,salt,hex]=stored.split('$');
  const key=await derive(value,salt,64,{N:32768,r:8,p:1,maxmem:128*1024*1024});
  const expected=Buffer.from(hex,'hex');
  return expected.length===key.length&&timingSafeEqual(expected,key);
}
export function origin(value) {
  const site=new URL(value);
  if(site.protocol!=='https:'&&!(site.protocol==='http:'&&['127.0.0.1','localhost'].includes(site.hostname))) fail(400,'Use HTTPS o un origen local de pruebas.');
  if(site.pathname!=='/'||site.username||site.password||site.search||site.hash)fail(400,'El origen del portal no es válido.');
  return site.origin;
}
