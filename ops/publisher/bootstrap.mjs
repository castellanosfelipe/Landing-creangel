import { configFromEnvironment, ReleaseStore } from './lib.mjs';

// Container initialization only. Never exposed by the HTTP service.
const config = configFromEnvironment();
if (!config.seedPath) throw new Error('PUBLISHER_SEED_PATH is required for initialization');
const store = new ReleaseStore(config.releaseRoot, { keepReleases: config.keepReleases });
const activated = await store.bootstrap(config.seedPath);
console.info(activated ? 'Initial production release activated' : 'Existing production release preserved');
