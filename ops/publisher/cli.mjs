import path from 'node:path';
import { configFromEnvironment, PublicationLock, ReleaseStore, GitBuilder } from './lib.mjs';

const config = configFromEnvironment();
const releases = new ReleaseStore(config.releaseRoot, { keepReleases: config.keepReleases });
const lock = new PublicationLock(path.join(config.stateRoot, 'publish.lock'));
const [command, name, ...extra] = process.argv.slice(2);
try {
  if (extra.length) throw new Error('Unexpected arguments');
  if (command === 'list' && !name) console.log(JSON.stringify(await releases.list(), null, 2));
  else if (command === 'publish' && !name) {
    const builder = new GitBuilder(config);
    console.log(await lock.run(() => releases.publish(stage => builder.build(stage))));
  } else if (command === 'rollback' && name) {
    await lock.run(() => releases.activate(name));
    console.log(`Activated ${name}`);
  } else throw new Error('Usage: node cli.mjs publish | list | rollback <release-name>');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
