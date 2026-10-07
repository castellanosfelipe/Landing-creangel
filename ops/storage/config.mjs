import {createHash} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {origin} from '../editor/security.mjs';
export const siteOrigin=()=>origin(process.env.PUBLIC_SITE_URL||'https://portal.creangel.com');
export const isLocal=value=>new URL(value).protocol==='http:';
export async function configureSite(directory,site) {
  const config=await fs.readFile(path.join(directory,'admin/config.yml'),'utf8');
  if(!config.includes('name: creangel-local')||config.includes('local_backend:')||config.includes('name: github'))throw new Error('El panel debe usar las cuentas locales del portal.');
  if(isLocal(site))await fs.writeFile(path.join(directory,'robots.txt'),'User-agent: *\nDisallow: /\n');
}
export async function sourceFingerprint(root) {
  const hash=createHash('sha1');
  async function visit(relative) {
    let stat;try{stat=await fs.lstat(path.join(root,relative));}catch(error){if(error.code==='ENOENT')return;throw error;}
    if(stat.isSymbolicLink())throw new Error('No se permiten enlaces simbólicos en el contenido.');
    hash.update(relative+'\0');
    if(stat.isFile())hash.update(await fs.readFile(path.join(root,relative)));
    else if(stat.isDirectory())for(const name of (await fs.readdir(path.join(root,relative))).sort())await visit(path.posix.join(relative,name));
    hash.update('\0');
  }
  for(const name of ['documentation/docs','documentation/i18n/en/docusaurus-plugin-content-docs/current','public/multimedia/documentacion','public/admin','ops/build.mjs','ops/storage/published-media.mjs','package.json','package-lock.json','documentation/docusaurus.config.js','documentation/plugins','documentation/src','documentation/package.json','documentation/package-lock.json','.portal-site-code'])await visit(name);
  return hash.digest('hex');
}
