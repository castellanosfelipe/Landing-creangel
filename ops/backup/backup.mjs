import {promises as fs,createReadStream,createWriteStream} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomBytes,randomUUID,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {spawn} from 'node:child_process';
import {DatabaseSync,backup} from 'node:sqlite';

const magic=Buffer.from('CREANGEL-BACKUP-1\n');
const roots=['documentation/docs','documentation/i18n/en/docusaurus-plugin-content-docs/current','public/multimedia/documentacion'];
async function keyFrom(file){const key=await fs.readFile(file);if(key.length!==32)throw new Error('La clave de backup debe tener exactamente 32 bytes.');return key;}
function childExit(child){return new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('No se pudo preparar el archivo de backup.')));});}
async function command(args){const child=spawn('tar',args,{stdio:['ignore','pipe','pipe']});const finished=childExit(child);let result='',error='';child.stdout.on('data',value=>{result+=value;if(result.length>4*1024*1024)child.kill();});child.stderr.on('data',value=>{error+=value;if(error.length>65536)child.kill();});await finished;return result;}
async function inventory(dir){
  const result=[];let bytes=0;
  async function walk(relative){
    const filename=path.join(dir,relative),info=await fs.lstat(filename);
    if(info.isSymbolicLink()||(!info.isFile()&&!info.isDirectory()))throw new Error('El backup solo admite archivos y carpetas normales.');
    if(info.isDirectory()){for(const name of (await fs.readdir(filename)).sort())await walk(path.posix.join(relative,name));return;}
    bytes+=info.size;if(result.length>=5000||bytes>1024*1024*1024)throw new Error('Se excedió el límite de backup.');
    const hash=createHash('sha256');for await(const chunk of createReadStream(filename))hash.update(chunk);
    result.push({path:relative,size:info.size,sha256:hash.digest('hex')});
  }
  await walk('');return result;
}
async function copyContent(source,stage){
  for(const relative of roots){
    const origin=path.join(source,relative),target=path.join(stage,'content',relative);
    await fs.mkdir(target,{recursive:true,mode:0o700});
    async function copy(src,dst){
      for(const entry of await fs.readdir(src,{withFileTypes:true})){
        const filename=path.join(src,entry.name),destination=path.join(dst,entry.name),info=await fs.lstat(filename);
        if(info.isSymbolicLink()||(!info.isFile()&&!info.isDirectory()))throw new Error('El contenido contiene un enlace o archivo no autorizado.');
        if(info.isDirectory()){await fs.mkdir(destination,{mode:0o700});await copy(filename,destination);}
        else {await fs.copyFile(filename,destination);await fs.chmod(destination,0o600);}
      }
    }
    await copy(origin,target);
  }
}
export async function databaseSnapshot(database,destination){
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'creangel-db-snapshot-'));await fs.chmod(temporary,0o700);
  async function versions(){const result=[];for(const suffix of ['', '-wal'])try{const file=database+suffix,hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);result.push([suffix,hash.digest('hex')]);}catch(error){if(error.code!=='ENOENT'||suffix==='')throw error;}return result;}
  try{
    const copy=path.join(temporary,'editor.sqlite');let stable=false;
    for(let attempt=0;attempt<3;attempt++){
      const before=await versions();await fs.rm(copy+'-wal',{force:true});
      try{for(const [suffix] of before){await fs.copyFile(database+suffix,copy+suffix);await fs.chmod(copy+suffix,0o600);}}catch(error){if(error.code==='ENOENT')continue;throw error;}
      const after=await versions();const captured=[];
      for(const [suffix] of before){const hash=createHash('sha256');for await(const chunk of createReadStream(copy+suffix))hash.update(chunk);captured.push([suffix,hash.digest('hex')]);}
      if(JSON.stringify(before)===JSON.stringify(after)&&JSON.stringify(before)===JSON.stringify(captured)){stable=true;break;}
    }
    if(!stable)throw new Error('La base de datos cambió durante el backup. Reintente.');
    // A WAL-mode SQLite reader may need to create SHM even for a read-only
    // connection. Open a private stable copy, never a writable source mount.
    const db=new DatabaseSync(copy);
    try{if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Snapshot SQLite inválido.');await backup(db,destination);}finally{db.close();}
    await fs.chmod(destination,0o600);
  }finally{await fs.rm(temporary,{recursive:true,force:true});}
}
export async function createBackup({source,database,keyFile,directory}){
  source=path.resolve(source);directory=path.resolve(directory);
  const key=await keyFrom(keyFile),stage=await fs.mkdtemp(path.join(os.tmpdir(),'creangel-backup-'));
  await fs.chmod(stage,0o700);await fs.mkdir(directory,{recursive:true,mode:0o700});
  const filename=path.join(directory,'backup-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID()+'.cmsbak'),temporary=filename+'.tmp';
  try{
    // Retry a changing source instead of publishing a mixed document/media copy.
    let stable=false;
    for(let attempt=0;attempt<3;attempt++){
      const before=[];for(const relative of roots)before.push([relative,await inventory(path.join(source,relative))]);
      await fs.rm(path.join(stage,'content'),{recursive:true,force:true});await copyContent(source,stage);
      const after=[];for(const relative of roots)after.push([relative,await inventory(path.join(source,relative))]);
      const copied=[];for(const relative of roots)copied.push([relative,await inventory(path.join(stage,'content',relative))]);
      if(JSON.stringify(before)===JSON.stringify(after)&&JSON.stringify(before)===JSON.stringify(copied)){stable=true;break;}
    }
    if(!stable)throw new Error('El contenido cambió durante el backup; se conserva la copia anterior.');
    await fs.mkdir(path.join(stage,'accounts'),{mode:0o700});
    await databaseSnapshot(database,path.join(stage,'accounts/editor.sqlite'));
    const mfaKey=path.join(path.dirname(database),'mfa.key');
    try{if((await fs.lstat(mfaKey)).isSymbolicLink()||(await fs.stat(mfaKey)).size!==32)throw new Error('Clave MFA inválida.');await fs.copyFile(mfaKey,path.join(stage,'accounts/mfa.key'));await fs.chmod(path.join(stage,'accounts/mfa.key'),0o600);}catch(error){
      if(error.code!=='ENOENT')throw error;
      const check=new DatabaseSync(path.join(stage,'accounts/editor.sqlite'),{readOnly:true});
      try{if(check.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='mfa_secrets'").get()&&check.prepare('SELECT count(*) n FROM mfa_secrets').get().n)throw new Error('Falta la clave MFA necesaria para restaurar las cuentas.');}finally{check.close();}
    }
    const manifest={format:1,createdAt:new Date().toISOString(),files:await inventory(stage)};
    await fs.writeFile(path.join(stage,'manifest.json'),JSON.stringify(manifest),{mode:0o600});
    const iv=randomBytes(12),header=Buffer.concat([magic,iv]),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(header);
    await fs.writeFile(temporary,header,{mode:0o600,flag:'wx'});
    const tar=spawn('tar',['-C',stage,'-czf','-','.'],{stdio:['ignore','pipe','ignore']}),finished=childExit(tar);
    try{await Promise.all([pipeline(tar.stdout,cipher,createWriteStream(temporary,{flags:'a',mode:0o600})),finished]);}catch(error){tar.kill();throw error;}
    await fs.appendFile(temporary,cipher.getAuthTag());await fs.rename(temporary,filename);
    return {filename,createdAt:manifest.createdAt,files:manifest.files.length,bytes:(await fs.stat(filename)).size};
  }finally{await fs.rm(temporary,{force:true});await fs.rm(stage,{recursive:true,force:true});key.fill(0);}
}
export async function restoreBackup({filename,keyFile,destination}){
  destination=path.resolve(destination);
  try{await fs.lstat(destination);throw new Error('Restaure en un directorio nuevo que todavía no exista.');}catch(error){if(error.code!=='ENOENT')throw error;}
  const key=await keyFrom(keyFile),stage=await fs.mkdtemp(path.join(os.tmpdir(),'creangel-restore-'));await fs.chmod(stage,0o700);
  const archive=path.join(stage,'verified.tar.gz'),extract=path.join(stage,'restored');
  try{
    const info=await fs.stat(filename);if(info.size<=magic.length+28||info.size>1024*1024*1024)throw new Error('Backup inválido.');
    const handle=await fs.open(filename,'r'),header=Buffer.alloc(magic.length+12),tag=Buffer.alloc(16);
    try{await handle.read(header,0,header.length,0);await handle.read(tag,0,16,info.size-16);}finally{await handle.close();}
    if(!header.subarray(0,magic.length).equals(magic))throw new Error('Formato de backup inválido.');
    const decipher=createDecipheriv('aes-256-gcm',key,header.subarray(magic.length));decipher.setAAD(header);decipher.setAuthTag(tag);
    // Authentication must finish before any archived path is extracted.
    await pipeline(createReadStream(filename,{start:header.length,end:info.size-17}),decipher,createWriteStream(archive,{mode:0o600,flags:'wx'}));
    const entries=(await command(['-tf',archive])).trim().split(/\r?\n/);
    if(entries.length>6000||entries.some(name=>name.includes('\\')||/[\u0000-\u001f]/.test(name)||name.startsWith('/')||name.split('/').some(part=>part==='..')||!/^\.\/(?:accounts(?:\/|$)|content(?:\/|$)|manifest\.json$|$)/.test(name)))throw new Error('Rutas no autorizadas en el backup.');
    const verbose=(await command(['-tvf',archive])).trim().split(/\r?\n/);if(verbose.some(line=>!/^[-d]/.test(line)))throw new Error('No se permiten enlaces en el backup.');
    await fs.mkdir(extract,{mode:0o700});await command(['-C',extract,'-xf',archive]);
    const manifest=JSON.parse(await fs.readFile(path.join(extract,'manifest.json'),'utf8'));
    if(manifest.format!==1||!Array.isArray(manifest.files))throw new Error('Manifiesto de backup inválido.');
    const actual=(await inventory(extract)).filter(file=>file.path!=='manifest.json');
    if(JSON.stringify(actual)!==JSON.stringify(manifest.files))throw new Error('El contenido restaurado no coincide con el manifiesto.');
    const restoredDb=new DatabaseSync(path.join(extract,'accounts/editor.sqlite'));
    try{
      if(restoredDb.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('La base de datos restaurada no supera la validación.');
      // Restoring accounts must never revive sessions, attempt counters or a
      // partially enrolled second factor from the historical snapshot.
      for(const table of ['sessions','attempts','security_counters'])if(restoredDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))restoredDb.exec('DELETE FROM '+table);
      if(restoredDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='mfa_secrets'").get())restoredDb.exec('DELETE FROM mfa_secrets WHERE enabled=0');
      restoredDb.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    }finally{restoredDb.close();}
    await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700});await fs.cp(extract,destination,{recursive:true,errorOnExist:true,force:false});
    return {destination,files:actual.length,createdAt:manifest.createdAt};
  }finally{await fs.rm(stage,{recursive:true,force:true});key.fill(0);}
}
export async function pruneBackups(directory,days=30){
  if(!Number.isInteger(days)||days<7||days>3650)throw new Error('Retención de backups inválida.');
  const root=path.resolve(directory),cutoff=Date.now()-days*86400000;
  for(const entry of await fs.readdir(root,{withFileTypes:true})){if(!entry.isFile()||!/^backup-[a-zA-Z0-9-]+\.cmsbak$/.test(entry.name))continue;const file=path.join(root,entry.name);if((await fs.stat(file)).mtimeMs<cutoff)await fs.unlink(file);}
}
