import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const dir=path.join(root,'secrets');
const runningAsRoot=process.platform!=='win32' && process.getuid?.()===0;
const createdDirectory=fs.mkdirSync(dir,{recursive:true,mode:0o700});
// Local Compose preserves host ownership. New entries belong to the same
// uid/gid as the services, so a Linux operator with uid 1000 can edit them.
if (runningAsRoot && createdDirectory) fs.chownSync(dir,1000,1000);
function createFile(file,value) {
  try { fs.writeFileSync(file,value,{mode:0o600,flag:'wx'}); }
  catch (error) { if (error.code==='EEXIST') return; throw error; }
  if (runningAsRoot) fs.chownSync(file,1000,1000);
}
for (const [name,value] of [['editor-admin-password',randomBytes(24).toString('base64url')+'\n'],['backup-key',randomBytes(32)]]) {
  const file=path.join(dir,name);
  createFile(file,value);
}
const environmentFile=path.join(root,'.env');
if (!fs.existsSync(environmentFile)) createFile(environmentFile,fs.readFileSync(path.join(root,'.env.example')));
console.log('Configuración preparada. Usuario inicial: INITIAL_ADMIN_USERNAME (admin por defecto). La contraseña está en secrets/editor-admin-password; no se imprime ni se incorpora a Git. Cambie la contraseña al iniciar sesión.');
