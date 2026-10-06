import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHmac } from 'node:crypto';
import { configFromEnvironment, DeliveryLedger, PublicationLock, ReleaseStore, GitBuilder, PublishQueue, createWebhookServer, readJson, signatureIsValid, runCommand } from '../lib.mjs';

const silent = { info() {}, error() {} };
const secret = 'a-test-webhook-secret-with-more-than-32-bytes';
const commit = 'a'.repeat(40);
const html = '<!doctype html><html lang="es"><body>Valid production output</body></html>';
const required = ['index.html', 'en/index.html', 'documentacion/index.html', 'documentacion/en/index.html', 'admin/index.html'];
async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'creangel-publisher-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}
async function output(directory, marker = '') {
  for (const file of required) {
    await fs.mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await fs.writeFile(path.join(directory, file), html + marker);
  }
  await fs.writeFile(path.join(directory, 'site-manifest.json'), JSON.stringify({ version: '1', pages: 120 }));
}
async function canCreateSymlinks(t, directory) {
  const probe = path.join(directory, 'symlink-probe');
  try { await fs.symlink(directory, probe, 'dir'); await fs.unlink(probe); return true; }
  catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') {
      t.skip('Relative symlink activation requires Linux or Windows developer-mode privilege; run this suite in the publisher container');
      return false;
    }
    throw error;
  }
}
function sign(body) { return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`; }
async function api(t, maximum = 1024 * 1024) {
  const directory = await temporary(t);
  const store = new ReleaseStore(path.join(directory, 'releases'));
  const calls = [];
  const queue = { async enqueue() { calls.push('publish'); }, status() { return { building: false, pending: false, lastResult: null }; } };
  const config = { repository: 'castellanosfelipe/Landing-creangel', branch: 'main', maxBodyBytes: maximum };
  const server = createWebhookServer({ config, secret, ledger: new DeliveryLedger(path.join(directory, 'deliveries.json')), queue, releases: store, logger: silent });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async ({ payload = { repository: { full_name: config.repository }, ref: 'refs/heads/main' }, id = 'delivery-1', event = 'push', signature, raw, contentType = 'application/json' } = {}) => {
    const body = raw ?? JSON.stringify(payload);
    const response = await fetch(`${origin}/publish/webhook`, { method: 'POST', headers: { 'Content-Type': contentType, 'X-Hub-Signature-256': signature ?? sign(body), 'X-GitHub-Delivery': id, 'X-GitHub-Event': event }, body });
    return { status: response.status, body: await response.json() };
  };
  return { request, calls, origin, directory, store };
}

test('GitHub official HMAC example and malformed signatures', () => {
  assert.equal(signatureIsValid(Buffer.from('Hello, World!'), 'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17', "It's a Secret to Everybody"), true);
  for (const value of [undefined, '', 'sha1=123', 'sha256=123', `sha256=${'0'.repeat(64)}`]) assert.equal(signatureIsValid(Buffer.from('payload'), value, secret), false);
});

test('webhook rejects tampering, foreign repository and invalid payloads', async t => {
  const fixture = await api(t);
  assert.equal((await fixture.request({ signature: `sha256=${'0'.repeat(64)}` })).status, 401);
  assert.equal((await fixture.request({ payload: { repository: { full_name: 'other/repository' }, ref: 'refs/heads/main' } })).status, 403);
  assert.equal((await fixture.request({ raw: '{broken' })).status, 400);
  assert.equal((await fixture.request({ id: '../delivery' })).status, 400);
  assert.equal((await fixture.request({ contentType: 'text/plain' })).status, 415);
  assert.deepEqual(fixture.calls, []);
});

test('only configured branch publishes; ping is authenticated and does not build', async t => {
  const fixture = await api(t);
  const repository = { full_name: 'castellanosfelipe/Landing-creangel' };
  assert.deepEqual(await fixture.request({ id: 'other-branch', payload: { repository, ref: 'refs/heads/feature' } }), { status: 200, body: { ignored: true } });
  assert.deepEqual(await fixture.request({ id: 'deleted', payload: { repository, ref: 'refs/heads/main', deleted: true } }), { status: 200, body: { ignored: true } });
  assert.deepEqual(await fixture.request({ id: 'ping', event: 'ping', payload: { repository } }), { status: 200, body: { received: true } });
  assert.deepEqual(fixture.calls, []);
  assert.deepEqual(await fixture.request({ id: 'accepted' }), { status: 202, body: { queued: true } });
  assert.deepEqual(await fixture.request({ id: 'accepted' }), { status: 200, body: { duplicate: true } });
  assert.equal(fixture.calls.length, 1);
  assert.equal(await new DeliveryLedger(path.join(fixture.directory, 'deliveries.json')).accept('accepted'), false);
});

test('request body limit and safe health endpoint', async t => {
  const fixture = await api(t, 200);
  assert.equal((await fixture.request({ raw: JSON.stringify({ large: 'x'.repeat(1000) }) })).status, 413);
  const health = await fetch(`${fixture.origin}/publish/health`);
  assert.equal(health.status, 503);
  const body = await health.text();
  assert.equal(body.includes(secret), false);
  assert.equal(body.includes(fixture.directory), false);
  assert.equal((await fetch(`${fixture.origin}/publish/rollback`)).status, 404);
});

test('delivery ledger serializes simultaneous duplicates and stays bounded', async t => {
  const directory = await temporary(t);
  const filename = path.join(directory, 'ledger.json');
  const ledger = new DeliveryLedger(filename, { limit: 3 });
  assert.deepEqual(await Promise.all([ledger.accept('one'), ledger.accept('one')]), [true, false]);
  for (const id of ['two', 'three', 'four']) await ledger.accept(id);
  assert.deepEqual((await readJson(filename)).map(item => item.id), ['two', 'three', 'four']);
});

test('failed queue persistence does not discard a retried delivery', async t => {
  const directory = await temporary(t);
  const ledger = new DeliveryLedger(path.join(directory, 'ledger.json'));
  await assert.rejects(ledger.accept('retry-me', async () => { throw new Error('disk full'); }), /disk full/);
  let saved = false;
  assert.equal(await ledger.accept('retry-me', async () => { saved = true; }), true);
  assert.equal(saved, true);
  assert.equal(await ledger.accept('retry-me'), false);
});

test('queue coalesces requests and never runs builds concurrently', async t => {
  const directory = await temporary(t);
  let active = 0; let maximum = 0; let runs = 0; let releaseFirst;
  const first = new Promise(resolve => { releaseFirst = resolve; });
  const queue = new PublishQueue({ filename: path.join(directory, 'queue.json'), debounceMs: 10000, logger: silent, run: async () => {
    active++; maximum = Math.max(maximum, active); runs++;
    if (runs === 1) await first;
    active--; return `release-${runs}`;
  } });
  t.after(() => queue.close());
  await Promise.all(Array.from({ length: 20 }, () => queue.enqueue()));
  clearTimeout(queue.timer); queue.timer = null;
  const building = queue.drain();
  await Promise.all(Array.from({ length: 20 }, () => queue.enqueue()));
  assert.equal(queue.running, true);
  assert.equal(queue.pending, true);
  releaseFirst(); await building;
  clearTimeout(queue.timer); queue.timer = null;
  await queue.drain();
  assert.equal(runs, 2);
  assert.equal(maximum, 1);
  assert.deepEqual(await readJson(path.join(directory, 'queue.json')), { pending: false });
});

test('pending queue restores after restart and records failure safely', async t => {
  const directory = await temporary(t);
  const filename = path.join(directory, 'queue.json');
  await fs.writeFile(filename, JSON.stringify({ pending: true }));
  const queue = new PublishQueue({ filename, debounceMs: 10000, logger: silent, run: async () => { throw new Error('build failed'); } });
  t.after(() => queue.close());
  await queue.restore();
  clearTimeout(queue.timer); queue.timer = null;
  assert.equal(queue.pending, true);
  await queue.drain();
  assert.equal(queue.status().lastResult.status, 'failed');
  assert.deepEqual(await readJson(filename), { pending: false });
});

test('publication activates a relative link atomically and failure retains old release', async t => {
  const directory = await temporary(t);
  if (!(await canCreateSymlinks(t, directory))) return;
  const seed = path.join(directory, 'seed');
  await output(seed, 'seed');
  const store = new ReleaseStore(path.join(directory, 'releases'));
  await store.bootstrap(seed);
  assert.equal(await store.currentName(), 'release-seed');
  const name = await store.publish(async stage => { await output(stage, 'new release'); return { commit }; });
  assert.equal(await fs.readlink(path.join(store.root, 'current')), name);
  assert.equal(path.isAbsolute(await fs.readlink(path.join(store.root, 'current'))), false);
  assert.equal((await fs.readFile(path.join(store.root, 'current', 'index.html'), 'utf8')).endsWith('new release'), true);
  await assert.rejects(store.publish(async stage => { await fs.writeFile(path.join(stage, 'index.html'), 'partial'); throw new Error('mocked build failed'); }), /mocked build failed/);
  assert.equal(await store.currentName(), name);
  await assert.rejects(store.publish(async stage => { await fs.writeFile(path.join(stage, 'index.html'), html); return { commit }; }));
  assert.equal(await store.currentName(), name);
  assert.equal((await fs.readdir(store.root)).some(item => item.startsWith('.stage-')), false);
  await store.activate('release-seed');
  assert.equal(await store.currentName(), 'release-seed');
  await assert.rejects(store.activate('../outside'), /Invalid release name/);
  assert.equal(await store.bootstrap(seed), false);
});

test('stage validation rejects missing manifest', async t => {
  const directory = await temporary(t);
  const stage = path.join(directory, 'stage');
  const store = new ReleaseStore(path.join(directory, 'releases'));
  await output(stage);
  await fs.unlink(path.join(stage, 'site-manifest.json'));
  await assert.rejects(store.validate(stage), /manifest/);
});

test('stage validation rejects symbolic links', async t => {
  const directory = await temporary(t);
  if (!(await canCreateSymlinks(t, directory))) return;
  const stage = path.join(directory, 'stage');
  const store = new ReleaseStore(path.join(directory, 'releases'));
  await output(stage);
  await fs.symlink(path.join(stage, 'index.html'), path.join(stage, 'unexpected-link'));
  await assert.rejects(store.validate(stage), /symbolic links/);
});

test('publication lock prevents CLI rollback during an active build', async t => {
  const directory = await temporary(t);
  const filename = path.join(directory, 'publish.lock');
  const first = new PublicationLock(filename); const second = new PublicationLock(filename);
  await first.acquire();
  await assert.rejects(second.acquire(), /already running/);
  await first.release();
  await second.acquire();
  await second.release();
});

test('publication lock recovers after a container restart reuses the same PID', async t => {
  const directory = await temporary(t);
  const filename = path.join(directory, 'publish.lock');
  await fs.writeFile(filename, JSON.stringify({ pid: process.pid, processIdentity: 'previous-container-process', createdAt: new Date(Date.now() - 86400000).toISOString() }));
  const lock = new PublicationLock(filename);
  await lock.acquire();
  assert.notEqual((await readJson(filename)).processIdentity, 'previous-container-process');
  await lock.release();
});

test('Git builder uses fixed argument arrays and withholds Git credentials from npm', async t => {
  const directory = await temporary(t);
  const tokenFile = path.join(directory, 'read-token');
  await fs.writeFile(tokenFile, 'a-sensitive-read-only-token');
  const config = configFromEnvironment({ PUBLISHER_STATE_ROOT: directory, RELEASE_ROOT: path.join(directory, 'releases'), GITHUB_READ_TOKEN_FILE: tokenFile });
  const commands = [];
  const execute = async (command, args, options) => { commands.push({ command, args, ...options }); return args.includes('rev-parse') ? commit : ''; };
  const builder = new GitBuilder(config, execute);
  const stage = path.join(directory, 'stage');
  assert.deepEqual(await builder.build(stage), { commit });
  const npm = commands.filter(item => item.command === 'npm');
  assert.deepEqual(npm.map(item => item.args), [
    ['ci', '--include=dev', '--no-audit', '--no-fund'],
    ['--prefix', 'documentation', 'ci', '--include=dev', '--no-audit', '--no-fund'],
    ['run', 'build:production', '--', '--output', stage, '--base-url', 'https://portal.creangel.com'],
  ]);
  assert.equal(npm.some(item => 'GITHUB_READ_TOKEN_FILE' in item.env), false);
  assert.equal(npm.every(item => item.env.CONTENT_REVISION === commit && item.env.CONTENT_REPOSITORY === config.repository && item.env.CONTENT_BRANCH === config.branch), true);
  assert.equal(commands.filter(item => item.command === 'git').every(item => item.env.GIT_TERMINAL_PROMPT === '0'), true);
  assert.equal(JSON.stringify(commands).includes('a-sensitive-read-only-token'), false);
});

test('configuration rejects repository/ref injection and credential-bearing site URLs', () => {
  for (const values of [ { CONTENT_REPOSITORY: 'owner/repo;evil' }, { CONTENT_BRANCH: '--upload-pack=bad' }, { CONTENT_BRANCH: 'foo/../bar' }, { PUBLIC_SITE_URL: 'https://secret:token@example.com' }, { PUBLIC_SITE_URL: 'https://example.com/path' } ]) assert.throws(() => configFromEnvironment(values));
});

test('command failure logs only phase and code, never child output', async () => {
  await assert.rejects(runCommand(process.execPath, ['-e', 'console.error("secret-token"); process.exit(7)'], { env: {}, timeoutMs: 1000 }), error => error.message.includes('7') && !error.message.includes('secret-token'));
});
