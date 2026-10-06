import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROCESS_INSTANCE = randomUUID();
const PROCESS_STARTED_AT = Date.now() - process.uptime() * 1000;
const RELEASE_PATTERN = /^release-(?:seed|\d{14}-[a-f0-9]{8,40})$/;
const REQUIRED_FILES = ['index.html', 'en/index.html', 'documentacion/index.html', 'documentacion/en/index.html', 'admin/index.html'];

export function configFromEnvironment(env = process.env) {
  const repository = env.CONTENT_REPOSITORY || 'castellanosfelipe/Landing-creangel';
  const branch = env.CONTENT_BRANCH || 'main';
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Invalid CONTENT_REPOSITORY');
  if (!/^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(branch) || branch.includes('..') || branch.includes('//') || branch.endsWith('/') || branch.endsWith('.lock')) throw new Error('Invalid CONTENT_BRANCH');
  const site = new URL(env.PUBLIC_SITE_URL || 'https://portal.creangel.com');
  if (!['https:', 'http:'].includes(site.protocol) || site.username || site.password || site.search || site.hash || site.pathname !== '/') throw new Error('PUBLIC_SITE_URL must be a clean HTTP(S) origin');
  const integer = (name, fallback, min, max) => {
    const value = Number(env[name] || fallback);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}`);
    return value;
  };
  return {
    repository, branch, siteUrl: site.origin,
    port: integer('PUBLISHER_PORT', 3001, 1, 65535),
    releaseRoot: path.resolve(env.RELEASE_ROOT || '/srv/releases'),
    stateRoot: path.resolve(env.PUBLISHER_STATE_ROOT || '/var/lib/publisher'),
    secretFile: env.GITHUB_WEBHOOK_SECRET_FILE || '/run/secrets/github_webhook_secret',
    tokenFile: env.GITHUB_READ_TOKEN_FILE || '',
    seedPath: env.PUBLISHER_SEED_PATH || '',
    startupPublish: env.PUBLISH_ON_STARTUP === 'true',
    debounceMs: integer('PUBLISH_DEBOUNCE_MS', 1500, 0, 10000),
    timeoutMs: integer('BUILD_TIMEOUT_SECONDS', 1200, 30, 7200) * 1000,
    keepReleases: integer('KEEP_RELEASES', 5, 2, 100),
    maxBodyBytes: 1024 * 1024,
  };
}

export async function writeJsonAtomically(filename, value) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  try { await fs.rename(temporary, filename); }
  finally { await fs.rm(temporary, { force: true }); }
}

export async function readJson(filename, fallback) {
  try { return JSON.parse(await fs.readFile(filename, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

export function signatureIsValid(body, signature, secret) {
  if (typeof signature !== 'string' || !/^sha256=[a-fA-F0-9]{64}$/.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'));
}

export class DeliveryLedger {
  constructor(filename, { limit = 5000, lifetimeMs = 7 * 86400000 } = {}) {
    this.filename = filename;
    this.limit = limit;
    this.lifetimeMs = lifetimeMs;
    this.chain = Promise.resolve();
  }
  async accept(deliveryId, beforeRecord = async () => {}) {
    const operation = this.chain.then(async () => {
      const stored = await readJson(this.filename, []);
      if (!Array.isArray(stored)) throw new Error('Invalid delivery ledger');
      const now = Date.now();
      const entries = stored.filter(item => item && typeof item.id === 'string' && Number.isFinite(item.at) && now - item.at < this.lifetimeMs);
      if (entries.some(item => item.id === deliveryId)) return false;
      // Persist queued work before deduplicating the delivery. A failed queue write can be retried.
      await beforeRecord();
      entries.push({ id: deliveryId, at: now });
      await writeJsonAtomically(this.filename, entries.slice(-this.limit));
      return true;
    });
    this.chain = operation.catch(() => {});
    return operation;
  }
}

export class PublicationLock {
  constructor(filename) { this.filename = filename; this.handle = null; }
  async identity(pid) {
    try {
      const data = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
      const fields = data.slice(data.lastIndexOf(')') + 2).split(/\s+/);
      const boot = (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
      return `${boot}:${fields[19]}`;
    } catch (error) {
      if (['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) return pid === process.pid ? PROCESS_INSTANCE : null;
      throw error;
    }
  }
  async acquire() {
    await fs.mkdir(path.dirname(this.filename), { recursive: true });
    try {
      this.handle = await fs.open(this.filename, 'wx', 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let existing;
      try { existing = await readJson(this.filename, null); }
      catch { throw new Error('A publication lock already exists'); }
      let live = true;
      if (existing && Number.isInteger(existing.pid) && existing.pid > 0) {
        try { process.kill(existing.pid, 0); } catch (check) { if (check.code === 'ESRCH') live = false; }
        if (live && existing.processIdentity) {
          const actual = await this.identity(existing.pid);
          if (actual && actual !== existing.processIdentity) live = false;
        } else if (live && existing.pid === process.pid && Date.parse(existing.createdAt) < PROCESS_STARTED_AT) {
          live = false;
        }
      }
      if (live) throw new Error('A publication or rollback is already running');
      await fs.unlink(this.filename);
      this.handle = await fs.open(this.filename, 'wx', 0o600);
    }
    await this.handle.writeFile(JSON.stringify({ pid: process.pid, processIdentity: await this.identity(process.pid), createdAt: new Date().toISOString() }));
  }
  async release() {
    if (this.handle) {
      await this.handle.close();
      this.handle = null;
      await fs.unlink(this.filename);
    }
  }
  async run(operation) {
    await this.acquire();
    try { return await operation(); } finally { await this.release(); }
  }
}

export class ReleaseStore {
  constructor(root, { requiredFiles = REQUIRED_FILES, keepReleases = 5, requireManifest = true } = {}) {
    this.root = path.resolve(root);
    this.requiredFiles = requiredFiles;
    this.keepReleases = keepReleases;
    this.requireManifest = requireManifest;
  }
  child(name) {
    if (!/^(?:release-(?:seed|\d{14}-[a-f0-9]{8,40})|\.stage-[a-f0-9-]+|\.current-[a-f0-9-]+)$/.test(name)) throw new Error('Invalid release path');
    const target = path.resolve(this.root, name);
    if (path.dirname(target) !== this.root) throw new Error('Release path escaped its root');
    return target;
  }
  async validate(directory) {
    const inspect = async location => {
      const stat = await fs.lstat(location);
      if (stat.isSymbolicLink()) throw new Error('Release output cannot contain symbolic links');
      if (stat.isDirectory()) {
        for (const item of await fs.readdir(location)) await inspect(path.join(location, item));
      } else if (!stat.isFile()) throw new Error('Unsupported release output entry');
    };
    await inspect(directory);
    for (const name of this.requiredFiles) {
      const filename = path.join(directory, name);
      const info = await fs.stat(filename);
      if (!info.isFile() || info.size < 20) throw new Error(`Missing or empty required output: ${name}`);
      const html = await fs.readFile(filename, 'utf8');
      if (!/<(?:!doctype\s+html|html)[\s>]/i.test(html)) throw new Error(`Invalid HTML output: ${name}`);
    }
    if (this.requireManifest) {
      const manifest = await readJson(path.join(directory, 'site-manifest.json'), null);
      if (!manifest || typeof manifest.version !== 'string' || !manifest.version) throw new Error('Missing or invalid production site manifest');
    }
  }
  async currentName() {
    try {
      const target = await fs.readlink(path.join(this.root, 'current'));
      if (!RELEASE_PATTERN.test(target)) throw new Error('Invalid active release link');
      return target;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async activate(name) {
    if (!RELEASE_PATTERN.test(name)) throw new Error('Invalid release name');
    await this.validate(this.child(name));
    const temporary = this.child(`.current-${randomUUID()}`);
    await fs.symlink(name, temporary, 'dir');
    try { await fs.rename(temporary, path.join(this.root, 'current')); }
    finally { await fs.rm(temporary, { force: true }); }
  }
  async publish(build) {
    await fs.mkdir(this.root, { recursive: true });
    const stage = this.child(`.stage-${randomUUID()}`);
    await fs.mkdir(stage);
    try {
      const metadata = await build(stage);
      if (!metadata || !/^[a-f0-9]{40}$/.test(metadata.commit)) throw new Error('Build did not return a valid commit');
      await this.validate(stage);
      const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
      let name = `release-${stamp}-${metadata.commit.slice(0, 12)}`;
      try { await fs.access(this.child(name)); name = `release-${stamp}-${randomUUID().replaceAll('-', '').slice(0, 12)}`; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await writeJsonAtomically(path.join(stage, '.publisher-release.json'), { commit: metadata.commit, publishedAt: new Date().toISOString() });
      await fs.rename(stage, this.child(name));
      await this.activate(name);
      // Retention cleanup is housekeeping; a cleanup failure does not undo a valid activation.
      try { await this.prune(); } catch { /* Keep extra old releases if pruning is unavailable. */ }
      return name;
    } finally { await fs.rm(stage, { recursive: true, force: true }); }
  }
  async bootstrap(seedPath) {
    await fs.mkdir(this.root, { recursive: true });
    if (await this.currentName()) return false;
    if (!seedPath) return false;
    await this.validate(seedPath);
    const seed = this.child('release-seed');
    const stage = this.child(`.stage-${randomUUID()}`);
    try {
      await fs.cp(seedPath, stage, { recursive: true, dereference: false });
      await this.validate(stage);
      await fs.rm(seed, { recursive: true, force: true });
      await fs.rename(stage, seed);
      await this.activate('release-seed');
    } finally { await fs.rm(stage, { recursive: true, force: true }); }
    return true;
  }
  async list() {
    await fs.mkdir(this.root, { recursive: true });
    const current = await this.currentName();
    const names = (await fs.readdir(this.root)).filter(name => RELEASE_PATTERN.test(name)).sort().reverse();
    const releases = [];
    for (const name of names) {
      const info = await fs.lstat(this.child(name));
      if (!info.isDirectory() || info.isSymbolicLink()) continue;
      releases.push({ name, current: name === current, ...(await readJson(path.join(this.child(name), '.publisher-release.json'), {})) });
    }
    return releases;
  }
  async prune() {
    const releases = await this.list();
    const keep = new Set(releases.slice(0, this.keepReleases).map(item => item.name));
    for (const item of releases) {
      if (item.current || keep.has(item.name) || item.name === 'release-seed') continue;
      await fs.rm(this.child(item.name), { recursive: true, force: true });
    }
  }
}

export function runCommand(command, args, { cwd, env = {}, timeoutMs = 1200000, capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const grouped = process.platform !== 'win32';
    const child = spawn(command, args, { cwd, env: { ...env }, shell: false, detached: grouped, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let timedOut = false;
    child.stdout.on('data', data => { if (capture && output.length < 8192) output += data.toString('utf8'); });
    // Child logs are deliberately not forwarded: credentials never enter public logs.
    child.stderr.resume();
    const kill = signal => { try { if (grouped && child.pid) process.kill(-child.pid, signal); else child.kill(signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
    const timer = setTimeout(() => { timedOut = true; kill('SIGTERM'); setTimeout(() => kill('SIGKILL'), 5000).unref(); }, timeoutMs);
    child.once('error', error => { clearTimeout(timer); reject(new Error(`Cannot start ${command}: ${error.code || 'unknown error'}`)); });
    child.once('close', code => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`${command} exceeded its time limit`));
      else if (code !== 0) reject(new Error(`${command} failed with exit code ${code}`));
      else resolve(output.trim());
    });
  });
}

export class GitBuilder {
  constructor(config, execute = runCommand) { this.config = config; this.execute = execute; }
  async build(output) {
    const config = this.config;
    const checkout = path.join(config.stateRoot, 'checkout');
    await fs.mkdir(config.stateRoot, { recursive: true });
    const environment = {
      PATH: process.env.PATH, HOME: path.join(config.stateRoot, 'home'),
      LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', CI: 'true',
      GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: '',
    };
    await fs.mkdir(environment.HOME, { recursive: true });
    if (config.tokenFile) {
      await fs.access(config.tokenFile);
      environment.GIT_ASKPASS = path.join(SOURCE_DIRECTORY, 'askpass.mjs');
      environment.GITHUB_READ_TOKEN_FILE = config.tokenFile;
    }
    const git = (args, capture = false) => this.execute('git', args, { cwd: config.stateRoot, env: environment, timeoutMs: config.timeoutMs, capture });
    const url = `https://github.com/${config.repository}.git`;
    let present = false;
    try { await fs.access(path.join(checkout, '.git')); present = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!present) await git(['clone', '--no-checkout', '--single-branch', '--branch', config.branch, url, checkout]);
    await git(['-C', checkout, 'remote', 'set-url', 'origin', url]);
    await git(['-C', checkout, 'fetch', '--prune', 'origin', config.branch]);
    const commit = await git(['-C', checkout, 'rev-parse', '--verify', 'FETCH_HEAD^{commit}'], true);
    if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid fetched revision');
    await git(['-C', checkout, 'reset', '--hard', commit]);
    await git(['-C', checkout, 'clean', '-ffdx']);
    const buildEnvironment = {
      PATH: process.env.PATH, HOME: environment.HOME, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8',
      CI: 'true', NODE_ENV: 'production', npm_config_cache: path.join(config.stateRoot, 'npm-cache'),
      PUBLIC_SITE_URL: config.siteUrl, CONTENT_REPOSITORY: config.repository,
      CONTENT_BRANCH: config.branch, CONTENT_REVISION: commit,
    };
    await this.execute('npm', ['ci', '--include=dev', '--no-audit', '--no-fund'], { cwd: checkout, env: buildEnvironment, timeoutMs: config.timeoutMs });
    await this.execute('npm', ['--prefix', 'documentation', 'ci', '--include=dev', '--no-audit', '--no-fund'], { cwd: checkout, env: buildEnvironment, timeoutMs: config.timeoutMs });
    await this.execute('npm', ['run', 'build:production', '--', '--output', output, '--base-url', config.siteUrl], { cwd: checkout, env: buildEnvironment, timeoutMs: config.timeoutMs });
    return { commit };
  }
}

export class PublishQueue {
  constructor({ filename, run, debounceMs = 1500, logger = console }) {
    this.filename = filename; this.run = run; this.debounceMs = debounceMs; this.logger = logger;
    this.pending = false; this.running = false; this.closed = false; this.timer = null; this.lastResult = null;
    this.serial = Promise.resolve();
  }
  async restore() {
    const state = await readJson(this.filename, {});
    if (state.pending) await this.enqueue();
  }
  async enqueue() {
    const operation = this.serial.then(async () => {
      this.pending = true;
      await writeJsonAtomically(this.filename, { pending: true });
      this.schedule();
    });
    this.serial = operation.catch(() => {});
    return operation;
  }
  schedule() {
    if (this.closed || this.running || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.drain().catch(() => this.logger.error('Unable to persist publication queue state'));
    }, this.debounceMs);
  }
  async drain() {
    if (this.closed || this.running || !this.pending) return;
    this.running = true;
    this.pending = false;
    try {
      // Persist the in-flight work as pending until it completes, so a restart can retry.
      const release = await this.run();
      this.lastResult = { status: 'success', finishedAt: new Date().toISOString() };
      this.logger.info(`Publication activated: ${release}`);
    } catch (error) {
      this.lastResult = { status: 'failed', finishedAt: new Date().toISOString() };
      this.logger.error(`Publication failed; previous release retained (${error.message})`);
    } finally {
      const finish = this.serial.then(async () => {
        try { await writeJsonAtomically(this.filename, { pending: this.pending }); }
        finally {
          this.running = false;
          if (this.pending) this.schedule();
        }
      });
      this.serial = finish.catch(() => {});
      await finish;
    }
  }
  close() { this.closed = true; clearTimeout(this.timer); }
  status() { return { building: this.running, pending: this.pending, lastResult: this.lastResult }; }
}

async function readBody(request, maximum) {
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > maximum) throw Object.assign(new Error('Payload too large'), { status: 413 });
  const chunks = []; let size = 0;
  for await (const data of request) {
    size += data.length;
    if (size > maximum) throw Object.assign(new Error('Payload too large'), { status: 413 });
    chunks.push(data);
  }
  return Buffer.concat(chunks);
}

export function createWebhookServer({ config, secret, ledger, queue, releases, logger = console }) {
  const reply = (response, status, value) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(JSON.stringify(value));
  };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://publisher');
      if (request.method === 'GET' && url.pathname === '/publish/health') {
        let ready = false;
        try { const name = await releases.currentName(); if (name) { const stat = await fs.stat(path.join(releases.child(name), 'index.html')); ready = stat.isFile(); } }
        catch { ready = false; }
        return reply(response, ready ? 200 : 503, { ready, ...queue.status() });
      }
      if (request.method !== 'POST' || url.pathname !== '/publish/webhook') return reply(response, 404, { error: 'Not found' });
      if (!(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return reply(response, 415, { error: 'JSON required' });
      const body = await readBody(request, config.maxBodyBytes);
      if (!signatureIsValid(body, request.headers['x-hub-signature-256'], secret)) return reply(response, 401, { error: 'Invalid signature' });
      let payload;
      try { payload = JSON.parse(body.toString('utf8')); } catch { return reply(response, 400, { error: 'Invalid JSON' }); }
      const delivery = request.headers['x-github-delivery'];
      if (typeof delivery !== 'string' || !/^[A-Za-z0-9-]{1,128}$/.test(delivery)) return reply(response, 400, { error: 'Invalid delivery identifier' });
      if (payload?.repository?.full_name !== config.repository) return reply(response, 403, { error: 'Repository not allowed' });
      const event = request.headers['x-github-event'];
      if (event !== 'push' && event !== 'ping') return reply(response, 200, { ignored: true });
      if (event === 'push' && (payload.ref !== `refs/heads/${config.branch}` || payload.deleted === true)) return reply(response, 200, { ignored: true });
      if (!(await ledger.accept(delivery, event === 'push' ? () => queue.enqueue() : undefined))) return reply(response, 200, { duplicate: true });
      if (event === 'ping') return reply(response, 200, { received: true });
      return reply(response, 202, { queued: true });
    } catch (error) {
      logger.error(`Webhook request failed (${error.status || 500})`);
      if (!response.headersSent && !response.destroyed) reply(response, error.status || 500, { error: error.status === 413 ? 'Payload too large' : 'Request failed' });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return server;
}
