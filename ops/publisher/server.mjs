import { promises as fs } from 'node:fs';
import path from 'node:path';
import { configFromEnvironment, DeliveryLedger, PublicationLock, ReleaseStore, GitBuilder, PublishQueue, createWebhookServer } from './lib.mjs';

const config = configFromEnvironment();
const secret = (await fs.readFile(config.secretFile, 'utf8')).trim();
if (Buffer.byteLength(secret) < 32) throw new Error('Webhook secret must contain at least 32 bytes');
const releases = new ReleaseStore(config.releaseRoot, { keepReleases: config.keepReleases });
const lock = new PublicationLock(path.join(config.stateRoot, 'publish.lock'));
const builder = new GitBuilder(config);
await lock.run(() => releases.bootstrap(config.seedPath));
const queue = new PublishQueue({ filename: path.join(config.stateRoot, 'queue.json'), debounceMs: config.debounceMs,
  maxRetries: config.maxRetries, retryBaseMs: config.retryBaseMs, retryMaxMs: config.retryMaxMs,
  run: () => lock.run(() => releases.publish(stage => builder.build(stage))) });
await queue.restore();
if (config.startupPublish) await queue.enqueue();
const ledger = new DeliveryLedger(path.join(config.stateRoot, 'deliveries.json'));
const server = createWebhookServer({ config, secret, ledger, queue, releases });
server.listen(config.port, '0.0.0.0', () => console.info(`Publisher listening on ${config.port}`));
const shutdown = () => {
  queue.close();
  server.close();
  const wait = () => {
    if (queue.running) return setTimeout(wait, 250);
    process.exit(0);
  };
  wait();
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
