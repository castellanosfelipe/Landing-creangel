import {randomUUID} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
const RELEASE_PATTERN=/^release-(?:seed|\d{14}-[a-f0-9]{8,40})$/;
const REQUIRED_FILES=['index.html','en/index.html','documentacion/index.html','documentacion/en/index.html','admin/index.html'];
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
      if (!metadata || !/^[a-f0-9]{40}$/.test(metadata.revision)) throw new Error('Build did not return a valid content revision');
      await this.validate(stage);
      const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
      let name = `release-${stamp}-${metadata.revision.slice(0, 12)}`;
      try { await fs.access(this.child(name)); name = `release-${stamp}-${randomUUID().replaceAll('-', '').slice(0, 12)}`; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await writeJsonAtomically(path.join(stage, '.release.json'), { revision: metadata.revision, publishedAt: new Date().toISOString() });
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
      releases.push({ name, current: name === current, ...(await readJson(path.join(this.child(name), '.release.json'), {})) });
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
