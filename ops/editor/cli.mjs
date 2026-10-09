import {readFileSync} from 'node:fs';
import {Store} from './store.mjs';
const [command,username,flag,filename]=process.argv.slice(2);
if(!['reset-password','reset-mfa','anonymize-disabled','security-status','prune-audit'].includes(command))throw new Error('Comandos: reset-password, reset-mfa, anonymize-disabled, security-status, prune-audit. Consulte README.');
if(command==='reset-password'&&(flag!=='--password-file'||!filename))throw new Error('Uso: cli.mjs reset-password usuario --password-file /ruta/privada');
if(['reset-mfa','anonymize-disabled'].includes(command)&&(flag!=='--confirm'||filename!==username))throw new Error('Confirme el nombre exacto con --confirm usuario.');
const store=new Store(process.env.EDITOR_DATABASE||'/var/lib/editor/editor.sqlite');
try {
  if(command==='security-status')console.log(JSON.stringify(store.security.status()));
  else if(command==='prune-audit'){store.security.prune(true);console.log('Retención de eventos aplicada.');}
  else{
    const row=store.byName(username);if(!row)throw new Error('Usuario no encontrado.');
    if(command==='reset-password'){
      await store.setPassword(row.id,readFileSync(filename,'utf8').trim(),true,'consola_del_servidor');
      console.log('Contraseña restablecida. Las sesiones anteriores fueron cerradas.');
    }else if(command==='reset-mfa'){
      store.db.exec('BEGIN IMMEDIATE');
      try{for(const table of ['mfa_secrets','mfa_recovery'])if(store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))store.db.prepare('DELETE FROM '+table+' WHERE user_id=?').run(row.id);store.revoke(row.id);store.audit('consola_del_servidor','mfa_restablecido',row.username);store.db.exec('COMMIT');}catch(error){store.db.exec('ROLLBACK');throw error;}
      console.log('Segundo factor restablecido. El siguiente acceso administrativo exige configurar uno nuevo.');
    }else {store.security.anonymizeDisabled(row.id,'consola_del_servidor');console.log('Cuenta desactivada anonimizada y sesiones revocadas.');}
  }
} finally {store.close();}
