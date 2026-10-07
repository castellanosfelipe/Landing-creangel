import {promises as fs} from 'node:fs';
import path from 'node:path';

export async function preparePublishedMedia(output) {
  const directory=path.join(output,'multimedia/documentacion');
  try {await fs.chmod(directory,0o755);}catch(error) {if(error.code==='ENOENT')return;throw error;}
  for(const entry of await fs.readdir(directory,{withFileTypes:true})) {
    // Only public CMS images receive public read permissions. The source,
    // accounts database, secrets and backups keep their private permissions.
    if(!entry.isFile()||!/^.+\.(png|jpe?g|webp|avif|gif)$/i.test(entry.name))throw new Error('Unexpected file in published documentation media.');
    await fs.chmod(path.join(directory,entry.name),0o644);
  }
}
