import fs from 'node:fs';
import path from 'node:path';
import {ReleaseStore} from '/opt/publisher/lib.mjs';
const root='/srv/releases';
fs.mkdirSync(root,{recursive:true,mode:0o755});
fs.chownSync(root,1000,1000);
if (!fs.existsSync(path.join(root,'current'))) {
  const store=new ReleaseStore(root);
  await store.bootstrap('/opt/seed');
  const dest=path.join(root,'release-seed');
  function own(directory) {
    fs.chownSync(directory,1000,1000);
    for (const entry of fs.readdirSync(directory,{withFileTypes:true})) {
      const file=path.join(directory,entry.name);
      if (entry.isDirectory()) own(file); else fs.chownSync(file,1000,1000);
    }
  }
  own(dest);
  console.log('Initial production release installed.');
} else console.log('Existing active release preserved.');
