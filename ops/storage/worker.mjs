import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {ReleaseStore, readJson, writeJsonAtomically} from './release-store.mjs';
import {siteOrigin,configureSite,sourceFingerprint,isLocal} from './config.mjs';

const origin=siteOrigin();
const workspace = '/workspace';
const stateFile = path.join(workspace, '.portal-builder-state.json');
const store = new ReleaseStore('/srv/releases');
let state = await readJson(stateFile, {});
state = {...state, state:'ready', activeRelease:await store.currentName()};
let stopped = false;
let child = null;
let lastAttempt = null;

function build(directory) {
  return new Promise((resolve,reject) => {
    child = spawn('npm', ['run','build:production','--','--output',directory,'--base-url',origin], {
      cwd:workspace, env:{...process.env, PUBLIC_SITE_URL:origin}, stdio:'inherit', detached:true
    });
    const timeout = setTimeout(() => {
      if (child?.pid) process.kill(-child.pid,'SIGTERM');
    }, 1200000);
    child.once('error', error => {clearTimeout(timeout); child=null; reject(error);});
    child.once('exit', (code,signal) => {
      clearTimeout(timeout); child=null;
      if (code === 0) resolve(); else reject(new Error(`La construcción falló (${signal || code}). Check builder logs; the previous release remains active.`));
    });
  });
}

const server = createServer((request,response) => {
  response.setHeader('Cache-Control','no-store');
  response.setHeader('Content-Type','application/json; charset=utf-8');
  if (request.method !== 'GET' || request.url !== '/status') {
    response.writeHead(404); response.end('{"error":"not_found"}'); return;
  }
  response.end(JSON.stringify({...state, origin, sandbox:isLocal(origin), remotePublication:false}));
});
server.listen(8082,'0.0.0.0');

async function save() { await writeJsonAtomically(stateFile,state); }
async function loop() {
  while (!stopped) {
    try {
      const fingerprint = await sourceFingerprint(workspace);
      if (fingerprint === state.publishedFingerprint && state.state === 'failed') {
        lastAttempt = null;
        state = {...state,state:'ready',lastError:null};
        await save();
      }
      if (fingerprint !== state.publishedFingerprint && fingerprint !== lastAttempt) {
        // Debounce saves and wait until the same document snapshot is stable.
        await new Promise(resolve=>setTimeout(resolve,2000));
        if (fingerprint !== await sourceFingerprint(workspace)) continue;
        lastAttempt = fingerprint;
        state = {...state,state:'building',lastError:null,startedAt:new Date().toISOString()};
        await save();
        const release = await store.publish(async directory => {
          await build(directory);
          // A save during compilation must not publish a mixture of two snapshots.
          if (fingerprint !== await sourceFingerprint(workspace)) throw new Error('Content changed during compilation; a new build will follow.');
          await configureSite(directory,origin);
          return {revision:fingerprint};
        });
        state = {...state,state:'ready',activeRelease:release,publishedFingerprint:fingerprint,lastError:null,finishedAt:new Date().toISOString()};
        await save();
        console.log(`Publicación activada: ${release}`);
      }
    } catch (error) {
      state = {...state,state:'failed',lastError:error.message,finishedAt:new Date().toISOString()};
      await save();
      console.error(error.message);
    }
    if (!stopped) await new Promise(resolve=>setTimeout(resolve,1500));
  }
}
function shutdown() {
  stopped = true;
  if (child?.pid) process.kill(-child.pid,'SIGTERM');
  server.close();
}
process.once('SIGTERM',shutdown);
process.once('SIGINT',shutdown);
await loop();
