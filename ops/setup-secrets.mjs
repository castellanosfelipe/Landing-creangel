import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const dir=path.join(root,'secrets');
fs.mkdirSync(dir,{recursive:true,mode:0o700});
for (const [name,value] of [['github-client-secret',''],['github-webhook-secret',randomBytes(32).toString('hex')],['github-read-token','']]) {
  const file=path.join(dir,name);
  if (!fs.existsSync(file)) fs.writeFileSync(file,value,{mode:0o600,flag:'wx'});
  // Local Compose mounts preserve host ownership. Services run as uid/gid 1000.
  if (process.platform!=='win32' && process.getuid?.()===0) fs.chownSync(file,1000,1000);
}
if (!fs.existsSync(path.join(root,'.env'))) fs.copyFileSync(path.join(root,'.env.example'),path.join(root,'.env'));
console.log('Configuration files prepared without overwriting existing values. Fill GITHUB_CLIENT_ID in .env and the OAuth secret in secrets/github-client-secret.');
