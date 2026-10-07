import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {preparePublishedMedia} from './storage/published-media.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
}
const base = new URL(arg('--base-url', process.env.PUBLIC_SITE_URL || 'https://portal.creangel.com'));
if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname))) throw new Error('Production requires HTTPS.');
if (base.pathname !== '/' || base.search || base.hash || base.username || base.password) throw new Error('PUBLIC_SITE_URL must be a site origin.');
const siteURL = base.origin;
const output = path.resolve(arg('--output', path.join(root, '_site')));
if (output === root || output.startsWith(path.join(root, 'public') + path.sep)) throw new Error('Unsafe output directory.');
if (fs.existsSync(output) && fs.readdirSync(output).length) throw new Error('Output directory must be empty.');
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const npmCli=process.env.npm_execpath || path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
function run(exe, args, cwd = root, env = {}) {
  const r = spawnSync(exe, args, {cwd, stdio: 'inherit', env: {...process.env, ...env}, shell: false});
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${path.basename(exe)} failed with exit ${r.status}`);
}

// Verify the existing website before adding generated documentation and admin.
run(python, ['ops/seo/generate-redirects.py', '--check']);
run(python, ['.pages/export.py', '--output', output, '--base-url', siteURL]);
await preparePublishedMedia(output);
run(python, ['.pages/check.py', '--site-root', output, '--base-url', siteURL]);
run(python, ['ops/seo/apply.py', '--root', output, '--base-url', siteURL]);
run(process.execPath, [npmCli, 'run', 'build'], path.join(root, 'documentation'), {PUBLIC_SITE_URL: siteURL});
fs.cpSync(path.join(root, 'documentation/build'), path.join(output, 'documentacion'), {recursive: true});
// Docusaurus locale alternates use /404/ while its error pages are emitted as 404.html.
for (const locale of ['', 'en/']) {
  const directory=path.join(output,'documentacion',locale);
  const alias=path.join(directory,'404','index.html');
  fs.mkdirSync(path.dirname(alias),{recursive:true});
  fs.copyFileSync(path.join(directory,'404.html'),alias);
}
const admin = path.join(output, 'admin');
fs.mkdirSync(admin, {recursive: true});
for (const name of ['index.html', 'admin.css', 'account.js', 'account.css', 'login.html', 'login.js', 'local-backend.js', 'media-support.js']) {
  const src = path.join(root, 'public/admin', name);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(admin, name));
}
fs.cpSync(path.join(root,'public/admin/users'),path.join(admin,'users'),{recursive:true});
fs.copyFileSync(path.join(root, 'node_modules/decap-cms/dist/decap-cms.js'), path.join(admin, 'decap-cms.js'));
let config = fs.readFileSync(path.join(root, 'public/admin/config.template.yml'), 'utf8');
config = config.replaceAll('{{PUBLIC_SITE_URL}}',siteURL);
if (config.includes('name: github') || config.includes('local_backend:') || config.includes('auth_endpoint:')) throw new Error('The CMS must use portal-owned editor accounts.');
fs.writeFileSync(path.join(admin, 'config.yml'), config);
fs.rmSync(path.join(admin, 'config.template.yml'), {force: true});

const siteConfig = JSON.parse(fs.readFileSync(path.join(root, '.pages/config.json'), 'utf8'));
for (const route of siteConfig.routes) {
  const name = route.endsWith('/') ? route.slice(1) + 'index.html' : route.slice(1);
  const file = path.join(output, name);
  const english = route.startsWith('/en/');
  let html = fs.readFileSync(file, 'utf8');
  // Keep the commercial website intact and expose the new documentation.
  const label = english ? 'Documentation' : 'Documentación';
  const href = english ? '/documentacion/en/' : '/documentacion/';
  html = html.replace(/(<a href="[^"]*recursos\/">)(Resources|Recursos)(<\/a>)/g, `<a href="${href}">${label}</a>$1$2$3`);
  fs.writeFileSync(file, html);
}
// Each Docusaurus locale emits its own sitemap. Include both language trees.
const docsEntries = ['', 'en'].flatMap(locale => {
  const sitemap = path.join(output, 'documentacion', locale, 'sitemap.xml');
  return fs.existsSync(sitemap) ? fs.readFileSync(sitemap, 'utf8').match(/<url>.*?<\/url>/gs) || [] : [];
});
const sitemap = path.join(output, 'sitemap.xml');
fs.writeFileSync(sitemap, fs.readFileSync(sitemap, 'utf8').replace('</urlset>', docsEntries.join('') + '</urlset>'));
const manifest = {
  schema: 2, version: '2.0.0', site_url: siteURL,
  commercial_pages: siteConfig.routes.length,
  documentation_locales: ['es', 'en'],
  publisher: 'server-local-content', authentication:'portal-accounts', cms: 'Decap CMS', documentation: 'Docusaurus',
  content_revision: process.env.CONTENT_REVISION || null,
  source_fingerprint: createHash('sha256').update(fs.readFileSync(path.join(root, 'package-lock.json'))).digest('hex')
};
fs.writeFileSync(path.join(output, 'site-manifest.json'), JSON.stringify(manifest, null, 2));
run(python, ['ops/verify-site.py', '--root', output, '--base-url', siteURL]);
run(python, ['ops/seo/check.py', '--root', output, '--base-url', siteURL]);
console.log(`Production site ready: ${output}`);
