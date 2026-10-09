import {createBackup,restoreBackup,pruneBackups} from './backup.mjs';
const options={source:process.env.BACKUP_SOURCE||'/workspace',database:process.env.BACKUP_DATABASE||'/var/lib/editor/editor.sqlite',directory:process.env.BACKUP_DIRECTORY||'/var/lib/backups',keyFile:process.env.BACKUP_KEY_FILE||'/run/secrets/backup_key'};
if(process.argv[2]==='restore'){
  if(!process.argv[3]||!process.argv[4])throw new Error('Uso: service.mjs restore archivo.cmsbak /directorio/nuevo');
  console.log(JSON.stringify({type:'cms_backup_restored',...await restoreBackup({...options,filename:process.argv[3],destination:process.argv[4]})}));
}else {
  const hours=Number(process.env.BACKUP_INTERVAL_HOURS||24),retention=Number(process.env.BACKUP_RETENTION_DAYS||30);
  if(!Number.isInteger(hours)||hours<1||hours>168)throw new Error('Intervalo de backup inválido.');
  const once=process.argv.includes('--once');
  let stop=false;process.once('SIGTERM',()=>{stop=true;});process.once('SIGINT',()=>{stop=true;});
  do{
    let failed=false;
    try{const result=await createBackup(options);await pruneBackups(options.directory,retention);console.log(JSON.stringify({type:'cms_backup_success',...result}));}
    catch(error){failed=true;console.error(JSON.stringify({type:'cms_security_alert',kind:'backup_failed',message:'No se pudo completar la copia de seguridad. Se conserva el backup anterior.'}));if(once){process.exitCode=1;break;}}
    if(once)break;
    const next=Date.now()+(failed?Math.min(hours*3600000,5*60000):hours*3600000);while(!stop&&Date.now()<next)await new Promise(resolve=>setTimeout(resolve,1000));
  }while(!stop);
}
