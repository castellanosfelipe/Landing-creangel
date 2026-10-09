import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import yaml from 'yaml';
import {prepareConfigValidator} from './config-validator.mjs';
import {buildCms} from './build.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const prepared = await prepareConfigValidator();
const compiled = await build({
  absWorkingDir: root,
  stdin: {contents: `import {validateConfig} from 'decap-cms-core/dist/esm/constants/configSchema.js';globalThis.validateConfig=validateConfig;`, resolveDir: root},
  bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'silent', plugins: [prepared.plugin], metafile: true,
});
const context = vm.createContext({console: {error() {}}}, {codeGeneration: {strings: false, wasm: false}});
vm.runInContext(compiled.outputFiles[0].text, context);
const original = {exports: {}};
vm.runInNewContext(prepared.upstreamSource, {module: original, exports: original.exports, require, console: {error() {}}, crypto: {randomUUID: () => crypto.randomUUID()}});
const portal = yaml.parse(fs.readFileSync(path.join(root, 'public/admin/config.template.yml'), 'utf8').replaceAll('{{PUBLIC_SITE_URL}}', 'http://127.0.0.1:8785'));
const clone = value => JSON.parse(JSON.stringify(value));
function validate(value) {
  context.config = value;
  return vm.runInContext('validateConfig(config)', context);
}
function errors(validator, config) {
  try {validator(config); return [];} catch (error) {
    assert.ok(Array.isArray(error.errors), error.message);
    return Array.from(error.errors, item => ({keyword: item.keyword, instancePath: item.instancePath, message: item.message}));
  }
}

test('reproduces upstream CSP failure while the precompiled ES/EN configuration succeeds without eval', () => {
  assert.throws(() => vm.runInContext('new Function("return 1")()', context), /Code generation from strings disallowed/);
  const module = {exports: {}};
  const blocked = vm.createContext({module, exports: module.exports, require, console: {error() {}}, crypto: {randomUUID: () => crypto.randomUUID()}, config: clone(portal)}, {codeGeneration: {strings: false, wasm: false}});
  vm.runInContext(prepared.upstreamSource, blocked);
  assert.throws(() => vm.runInContext('module.exports.validateConfig(config)', blocked), /Code generation from strings disallowed/);
  const value = clone(portal), before = JSON.stringify(value);
  assert.doesNotThrow(() => validate(value));
  assert.equal(JSON.stringify(value), before);
  assert.equal(value.collections.length, 2);
});

test('keeps official validation and descriptive errors for malformed configuration', () => {
  const invalid = [];
  let value = clone(portal);delete value.backend;invalid.push(value);
  value = clone(portal);value.backend.name = 42;invalid.push(value);
  value = clone(portal);delete value.media_folder;invalid.push(value);
  value = clone(portal);value.collections = [];invalid.push(value);
  value = clone(portal);value.collections[0].fields[3].min = 'one';invalid.push(value);
  value = clone(portal);value.collections[0].fields[5].modes = ['invalid'];invalid.push(value);
  value = clone(portal);value.collections[0].fields.push({name: 'photo', widget: 'image', allow_multiple: 'yes'});invalid.push(value);
  value = clone(portal);value.collections[0].fields.push({name: 'code', widget: 'code', keys: {code: 42}});invalid.push(value);
  value = clone(portal);value.collections[0].fields.push({name: 'picture', widget: 'object', collapsed: 'yes', fields: [{name: 'image', widget: 'image'}]});invalid.push(value);
  value = clone(portal);value.collections[0].sortable_fields = [{field: 'id', default_sort: 'asc'}, {field: 'title', default_sort: 'desc'}];invalid.push(value);
  for (const config of invalid) {
    const actual = errors(validate, clone(config));
    assert.ok(actual.length);
    assert.deepEqual(actual, errors(original.exports.validateConfig, clone(config)));
  }
});

test('preserves uniqueness checks for collections, files and nested fields', () => {
  const invalid = [];
  let value = clone(portal);value.collections.push(clone(value.collections[0]));invalid.push(value);
  value = clone(portal);value.collections[0].fields.push(clone(value.collections[0].fields[0]));invalid.push(value);
  value = clone(portal);value.collections[0].fields.push({name: 'nested', widget: 'object', fields: [{name: 'same'}, {name: 'same'}]});invalid.push(value);
  value = clone(portal);value.collections = [{name: 'settings', label: 'Settings', files: [{name: 'same', file: 'a.md', fields: [{name: 'title'}]}, {name: 'same', file: 'b.md', fields: [{name: 'title'}]}]}];invalid.push(value);
  for (const config of invalid) {
    const actual = errors(validate, clone(config));
    assert.ok(actual.some(error => /names must be unique/.test(error.message)));
    assert.deepEqual(actual, errors(original.exports.validateConfig, clone(config)));
  }
});

test('accepts actual RegExp patterns under CSP and rejects invalid pattern values', () => {
  context.config = clone(portal);
  assert.doesNotThrow(() => vm.runInContext('config.collections[0].fields[0].pattern=[/^[a-z]+$/, "Lowercase"];validateConfig(config)', context));
  const value = clone(portal);value.collections[0].fields[0].pattern = [42, 'Invalid'];
  assert.deepEqual(errors(validate, value), errors(original.exports.validateConfig, value));
});

test('browser validation bundle has no AJV compiler or custom runtime code generation', () => {
  const inputs = Object.keys(compiled.metafile.inputs);
  assert.ok(inputs.some(name => /configSchema\.js$/.test(name)));
  assert.ok(!inputs.some(name => /ajv[/\\]dist[/\\]compile|ajv-keywords|ajv-errors/.test(name)));
  assert.doesNotMatch(compiled.outputFiles[0].text, /new Function|\beval\s*\(/);
});

test('production CMS build uses the standalone validator and retains all configured widgets', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-csp-regression-'));
  try {
    const result = await buildCms(directory);
    assert.equal(result.configValidation, 'build-time-standalone');
    assert.equal(result.validatorHash, prepared.hash);
    for (const widget of ['string', 'text', 'number', 'image', 'file', 'markdown', 'code', 'object']) assert.ok(result.modules.some(name => name.includes(`decap-cms-widget-${widget}/`)));
    assert.ok(!result.modules.some(name => /ajv[/\\]dist[/\\]compile|ajv-keywords|ajv-errors/.test(name)));
  } finally {fs.rmSync(directory, {recursive: true, force: true});}
});
