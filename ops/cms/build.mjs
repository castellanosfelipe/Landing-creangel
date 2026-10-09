import {build} from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {prepareConfigValidator, CMS_WIDGETS} from './config-validator.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export async function buildCms(admin) {
  const outfile = path.join(admin, 'decap-cms.js');
  const configValidator = await prepareConfigValidator();
  const result = await build({
    absWorkingDir: root,
    entryPoints: ['ops/cms/entry.js'],
    outfile,
    bundle: true,
    minify: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    mainFields: ['browser', 'module', 'main'],
    define: {'process.env.NODE_ENV': '"production"'},
    metafile: true,
    logLevel: 'warning',
    plugins: [configValidator.plugin, {name: 'browser-filesystem', setup(builder) {
      // gray-matter exposes optional Node-only file helpers; the editor only
      // uses its in-memory frontmatter parser, as in Decap's upstream bundle.
      builder.onResolve({filter: /^fs$/}, () => ({path: 'fs', namespace: 'browser-filesystem'}));
      builder.onLoad({filter: /.*/, namespace: 'browser-filesystem'}, () => ({contents: 'export default {};', loader: 'js'}));
    }}],
  });
  const modules = Object.keys(result.metafile.inputs).sort();
  if (modules.some(name => /(?:@platejs|decap-cms-widget-richtext)[/\\]/.test(name))) throw new Error('Unused richtext/Plate dependency in CMS bundle.');
  if (modules.some(name => /(?:ajv[/\\]dist[/\\]compile|ajv-keywords|ajv-errors)[/\\]/.test(name))) throw new Error('Runtime JSON schema compilation must not enter the browser CMS bundle.');
  return {
    sha256: createHash('sha256').update(fs.readFileSync(outfile)).digest('hex'),
    modules,
    widgets: CMS_WIDGETS,
    configValidation: 'build-time-standalone',
    validatorHash: configValidator.hash,
  };
}
