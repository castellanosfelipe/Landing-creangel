import {readFileSync} from 'node:fs';
import {Store} from './store.mjs';
const [command,username,flag,filename]=process.argv.slice(2);
if(command!=='reset-password'||flag!=='--password-file'||!filename)throw new Error('Uso: node cli.mjs reset-password usuario --password-file /ruta/privada');
const store=new Store(process.env.EDITOR_DATABASE||'/var/lib/editor/editor.sqlite');
try {
  const row=store.byName(username);if(!row)throw new Error('Usuario no encontrado.');
  await store.setPassword(row.id,readFileSync(filename,'utf8').trim(),true,'consola_del_servidor');
  console.log('Contraseña restablecida. Las sesiones anteriores fueron cerradas.');
} finally {store.close();}
