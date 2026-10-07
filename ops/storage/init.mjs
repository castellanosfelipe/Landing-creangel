import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ReleaseStore,readJson,writeJsonAtomically} from './release-store.mjs';
import {siteOrigin,configureSite,sourceFingerprint} from './config.mjs';
const origin=siteOrigin(),workspace='/workspace',releases='/srv/releases',data='/var/lib/editor';
for(const dir of [workspace,releases,data])await fs.mkdir(dir,{recursive:true});
const marker=path.join(workspace,'.portal-workspace.json');
const prior=await readJson(marker,await readJson(path.join(workspace,'.local-sandbox.json'),null));
if(prior&&prior.origin!==origin)throw new Error('Conserve el origen de este volumen o cree un proyecto Compose independiente.');
if(!prior)await fs.cp('/app',workspace,{recursive:true});
else {
  // Upgrade server/build/admin code while preserving all locally edited documents and media.
  for(const name of ['ops','.pages','public','package.json','package-lock.json','documentation/plugins','documentation/src','documentation/docusaurus.config.js','documentation/package.json','documentation/package-lock.json']) {
    await fs.cp(path.join('/app',name),path.join(workspace,name),{
      recursive:true,
      filter:source=>source!=='/app/public/multimedia/documentacion'&&!source.startsWith('/app/public/multimedia/documentacion/')
    });
  }
}
// Dependencies belong to the immutable runtime image. Old copies in a persistent
// workspace must not override the versions installed by this Docker build.
for(const relative of ['node_modules','documentation/node_modules']) {
  const target=path.resolve(workspace,relative),source=path.resolve('/app',relative);
  if(!target.startsWith(workspace+path.sep)||!target.endsWith(path.sep+'node_modules'))throw new Error('Ruta de dependencias inválida.');
  await fs.rm(target,{recursive:true,force:true});
  await fs.symlink(source,target,'dir');
}
// Hash immutable site sources once per deployment, rather than reading all
// commercial assets on every editor polling cycle.
const codeHash=createHash('sha256');
async function sourceCode(relative) {
  if(relative==='public/multimedia/documentacion')return;
  const filename=path.join('/app',relative),stat=await fs.lstat(filename);
  if(stat.isSymbolicLink())throw new Error('No se permiten enlaces simbólicos en los archivos del sitio.');
  codeHash.update(relative+'\0');
  if(stat.isFile())codeHash.update(await fs.readFile(filename));
  else for(const name of (await fs.readdir(filename)).sort())await sourceCode(path.posix.join(relative,name));
  codeHash.update('\0');
}
for(const relative of ['.pages','public'])await sourceCode(relative);
await fs.writeFile(path.join(workspace,'.portal-site-code'),codeHash.digest('hex')+'\n',{mode:0o600});
// Retire the previous provider integration from the immutable operations directory.
for(const relative of ['ops/auth','ops/publisher','ops/seed.mjs','ops/local/config.mjs','ops/local/init.mjs','ops/local/worker.mjs','ops/local/health.mjs','ops/local/package.json','ops/local/package-lock.json']) {
  const target=path.resolve(workspace,relative);
  if(!target.startsWith(path.resolve(workspace,'ops')+path.sep))throw new Error('Ruta de migración inválida.');
  await fs.rm(target,{recursive:true,force:true});
}
await fs.mkdir(path.join(workspace,'public/multimedia/documentacion'),{recursive:true});
await writeJsonAtomically(marker,{origin,createdAt:prior?.createdAt||new Date().toISOString()});
const store=new ReleaseStore(releases);
if(!(await store.currentName())) {
  await fs.cp('/opt/site','/tmp/portal-seed',{recursive:true});
  await configureSite('/tmp/portal-seed',origin);await store.bootstrap('/tmp/portal-seed');
  await writeJsonAtomically(path.join(workspace,'.portal-builder-state.json'),{publishedFingerprint:await sourceFingerprint(workspace),activeRelease:'release-seed',state:'ready',lastError:null});
} else {
  // Close the old password-free test panel immediately, without changing public page content.
  await fs.cp('/opt/site/admin',path.join(releases,'current/admin'),{recursive:true});
}
async function own(dir) {
  await fs.chown(dir,1000,1000);
  for(const entry of await fs.readdir(dir,{withFileTypes:true})) {
    const filename=path.join(dir,entry.name);
    if(entry.isDirectory())await own(filename);else if(!entry.isSymbolicLink())await fs.chown(filename,1000,1000);
  }
}
for(const dir of [workspace,releases,data])await own(dir);
console.log('Contenido persistente preparado. Los documentos y usuarios existentes se conservan.');
