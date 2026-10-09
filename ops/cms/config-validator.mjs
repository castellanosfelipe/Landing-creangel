import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import Ajv from 'ajv';
import standaloneCode from 'ajv/dist/standalone/index.js';
import codegen from 'ajv/dist/compile/codegen/index.js';
import code from 'ajv/dist/compile/codegen/code.js';
import keywords from 'ajv-keywords';
import ajvErrors from 'ajv-errors';
import cmsDeepEqual from 'fast-deep-equal';

const root = path.resolve(import.meta.dirname, '../..');
const {_} = codegen;
const {_Code} = code;
const require = createRequire(import.meta.url);
export const CMS_WIDGETS = ['string', 'text', 'number', 'image', 'file', 'markdown', 'code', 'object'];
const upstreamSignatures = {
  'constants/configSchema.js': '46312f42b2b6e2252b9ac1cec4f37b31521e8700ae61e00a958c8e5952ca635d',
  'lib/i18n.js': '47b0fa4fd8afd3e2ed6232491fb403d6d3d8fbce12b349b2797d04b6abd195cf',
  'formats/formats.js': '1690f7c710a8ddaea416421ac4e022c2e17fcb337e62697f62ebd1b38f4a60bf',
};
const digest = value => createHash('sha256').update(value).digest('hex');
function reviewedSource(relative) {
  const source = fs.readFileSync(path.join(root, 'node_modules/decap-cms-core/dist/esm', relative), 'utf8').replace(/\r\n/g, '\n');
  if (digest(source) !== upstreamSignatures[relative]) throw new Error(`Review CSP config validation for changed Decap source: ${relative}`);
  return source;
}

// The upstream keyword uses a runtime compile closure, which AJV cannot export
// as standalone code. This is its scalar/deep-equality algorithm as a regular
// function declaration, emitted into the bundle at build time.
function uniqueProperties(data, keys, scalar) {
  if (data.length <= 1) return true;
  for (let k = 0; k < keys.length; k++) {
    const key = keys[k];
    if (scalar[k]) {
      const hash = {};
      for (const x of data) {
        if (!x || typeof x !== 'object') continue;
        let p = x[key];
        if (p && typeof p === 'object') continue;
        if (typeof p === 'string') p = '"' + p;
        if (hash[p]) return false;
        hash[p] = true;
      }
    } else {
      for (let i = data.length; i--;) {
        const x = data[i];
        if (!x || typeof x !== 'object') continue;
        for (let j = i; j--;) {
          const y = data[j];
          if (y && typeof y === 'object' && cmsDeepEqual(x[key], y[key])) return false;
        }
      }
    }
  }
  return true;
}
function standaloneKeywords(ajv) {
  ajv.addKeyword({
    keyword: 'uniqueItemProperties', type: 'array', schemaType: 'array',
    metaSchema: {type: 'array', items: {type: 'string'}},
    code(cxt) {
      const scalar = cxt.schema.map(key => {
        const type = cxt.parentSchema.items?.properties?.[key]?.type;
        return Array.isArray(type) ? !type.includes('object') && !type.includes('array') : ['number', 'integer', 'string', 'boolean', 'null'].includes(type);
      });
      const helper = cxt.gen.scopeValue('func', {ref: uniqueProperties, code: new _Code(`(${uniqueProperties.toString()})`)});
      cxt.fail(_`!${helper}(${cxt.data}, ${cxt.schemaCode}, ${new _Code(JSON.stringify(scalar))})`);
    },
  });
  ajv.addKeyword({
    keyword: 'instanceof', schemaType: ['string', 'array'],
    metaSchema: {anyOf: [{type: 'string'}, {type: 'array', items: {type: 'string'}}]},
    code(cxt) {
      const constructors = Array.isArray(cxt.schema) ? cxt.schema : [cxt.schema];
      if (constructors.some(name => !['Object', 'Array', 'Function', 'Number', 'String', 'Date', 'RegExp', 'Promise'].includes(name))) throw new Error('Unsupported standalone instanceof constructor.');
      const condition = constructors.length ? codegen.or(...constructors.map(name => _`${cxt.data} instanceof ${new _Code(name)}`)) : new _Code('false');
      cxt.fail(_`!(${condition})`);
    },
  });
  keywords(ajv, ['select', 'prohibited']);
  ajvErrors(ajv);
}

export async function prepareConfigValidator() {
  const original = reviewedSource('constants/configSchema.js');
  reviewedSource('lib/i18n.js');
  reviewedSource('formats/formats.js');
  const entry = fs.readFileSync(path.join(root, 'ops/cms/entry.js'), 'utf8');
  const importedWidgets = [...entry.matchAll(/from ['"]decap-cms-widget-([a-z]+)['"]/g)].map(match => match[1]);
  if (JSON.stringify(importedWidgets) !== JSON.stringify(CMS_WIDGETS)) throw new Error('Review precompiled validator for changed registered CMS widgets.');
  const widgets = [{name: 'unknown', schema: {}}, ...CMS_WIDGETS.map(name => {
    const filename = path.join(root, `node_modules/decap-cms-widget-${name}/dist/esm/schema.js`);
    // Decap's registerWidget defaults missing schemas to {}.
    const schema = fs.existsSync(filename) ? vm.runInNewContext(fs.readFileSync(filename, 'utf8').replace(/^export default /, '(').replace(/;\s*$/, ')'), {}, {timeout: 1000}) : {};
    return {name, schema};
  })];
  const support = {
    '../lib/registry': `export const getWidgets = () => ${JSON.stringify(widgets)};`,
    '../lib/i18n': `export const I18N_STRUCTURE = {MULTIPLE_FOLDERS:'multiple_folders',MULTIPLE_FILES:'multiple_files',SINGLE_FILE:'single_file'};export const I18N_FIELD = {TRANSLATE:'translate',DUPLICATE:'duplicate',NONE:'none'};`,
    '../formats/formats': `export const frontmatterFormats = ['yaml-frontmatter','toml-frontmatter','json-frontmatter'];export const extensionFormatters = {yml:null,yaml:null,toml:null,json:null,md:null,markdown:null,html:null};`,
  };
  // Obtain the official schema and original validator without importing any UI.
  // Generation happens in Node during the build, never in an editor's browser.
  const upstream = await build({
    absWorkingDir: root,
    stdin: {contents: original + '\nexport {getConfigSchema};', resolveDir: path.join(root, 'node_modules/decap-cms-core/dist/esm/constants'), sourcefile: 'configSchema.js', loader: 'js'},
    platform: 'node', format: 'cjs', bundle: true, write: false, logLevel: 'silent',
    plugins: [{name: 'config-schema-only', setup(builder) {
      builder.onResolve({filter: /^\.\.\/(?:lib\/(?:registry|i18n)|formats\/formats)$/}, args => ({path: args.path, namespace: 'config-schema-only'}));
      builder.onLoad({filter: /.*/, namespace: 'config-schema-only'}, args => ({contents: support[args.path], loader: 'js'}));
    }}],
  });
  const upstreamSource = upstream.outputFiles[0].text;
  const module = {exports: {}};
  let id = 0;
  vm.runInNewContext(upstreamSource, {module, exports: module.exports, require, console, crypto: {randomUUID: () => `cms-schema-${++id}`}}, {timeout: 5000});
  const schema = module.exports.getConfigSchema();
  const ajv = new Ajv({allErrors: true, $data: true, strict: false, code: {source: true, esm: true}});
  standaloneKeywords(ajv);
  const generated = standaloneCode(ajv, ajv.compile(schema));
  const runtimeBlock = `  const ajv = new AJV({\n    allErrors: true,\n    $data: true,\n    strict: false\n  });\n  uniqueItemProperties(ajv);\n  select(ajv);\n  instanceOf(ajv);\n  prohibited(ajv);\n  ajvErrors(ajv);\n  const valid = ajv.validate(getConfigSchema(), config);`;
  let runtime = original.slice(original.indexOf('class ConfigError extends Error'));
  if (!runtime.includes(runtimeBlock) || !runtime.includes('ajv.errors.map')) throw new Error('Unexpected Decap config validation body.');
  runtime = runtime.replace(runtimeBlock, '  const valid = validate(config);').replace('ajv.errors.map', 'validate.errors.map');
  const source = `// Generated from the reviewed Decap schema at build time.\nimport cmsDeepEqual from 'fast-deep-equal';\n${generated}\n${runtime}`;
  const plugin = {name: 'standalone-cms-config', setup(builder) {
    builder.onLoad({filter: /[\\/]decap-cms-core[\\/]dist[\\/]esm[\\/]constants[\\/]configSchema\.js$/}, args => {
      if (digest(fs.readFileSync(args.path, 'utf8').replace(/\r\n/g, '\n')) !== upstreamSignatures['constants/configSchema.js']) throw new Error('Unexpected Decap schema module.');
      return {contents: source, loader: 'js', resolveDir: root};
    });
  }};
  return {plugin, source, hash: digest(source), upstreamSource, schema, widgets, upstreamHash: digest(original)};
}
