import {fail} from './security.mjs';
// Local blocklist; no password or prefix is sent to an external service.
const blocked=new Set(['password','passwrd','passwordpassword','contraseña','contrasena','contrasenacontrasena','administrator','administrador','admin','adminadmin','adminadminadmin','root','rootroot','login','letmein','letmeinletmein','welcome','welcomewelcome','bienvenido','bienvenidobienvenido','qwerty','qwertyqwerty','qwertyuiop','qwertyuiopasdfghjkl','qazwsxedcrfvtgb','asdfghjkl','iloveyou','changeme','changemechangeme','secret','secretsecret','test','testing','default','123456789012345','1234567890123456','123456789123456789','987654321098765','000000000000000','111111111111111']);
const canonical=value=>value.normalize('NFKC').toLocaleLowerCase('en-US').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
export function validateNewPassword(value,{username='',displayName=''}={}) {
  if(typeof value!=='string'||[...value].length<15||[...value].length>128)fail(400,'La contraseña debe tener entre 15 y 128 caracteres.');
  const normalized=canonical(value),letters=normalized.replace(/[0-9]/g,'');
  const full=value.normalize('NFKC').toLocaleLowerCase('en-US');
  const context=[username,displayName,'creangel','ifindit','portalcreangel'].map(canonical).filter(word=>word.length>=3);
  if(blocked.has(normalized)||blocked.has(letters)||/^(.)\1+$/u.test(full)||/^(.{1,4})\1{3,}$/u.test(full)||/^(.)\1+$/.test(normalized)||/^(.{1,4})\1{3,}$/.test(normalized)||context.some(word=>letters===word.replace(/[0-9]/g,'')))fail(400,'Elija una contraseña menos previsible. Evite claves comunes, repeticiones y el nombre de la cuenta o del portal. Puede usar una frase larga.');
}
