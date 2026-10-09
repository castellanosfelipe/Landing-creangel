import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {build} from 'esbuild';

const root = path.resolve(import.meta.dirname, '../..');
const compiled = await build({
  absWorkingDir: root,
  stdin: {
    contents: `
      import './ops/cms/entry.js';
      import ObjectWidget from 'decap-cms-widget-object';
      import ImageWidget from 'decap-cms-widget-image';
      import StringWidget from 'decap-cms-widget-string';
      import {resolveWidget} from 'decap-cms-core/dist/esm/lib/registry.js';
      globalThis.regression = {CMS: window.CMS, ObjectWidget, ImageWidget, StringWidget, resolveWidget};
    `,
    resolveDir: root,
    sourcefile: 'image-widget-regression.js',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'iife',
  mainFields: ['module', 'main'],
  define: {'process.env.NODE_ENV': '"production"'},
  logLevel: 'silent',
  plugins: [{name: 'headless-widget-registration', setup(builder) {
    // Keep the actual entry point, registry, widgets and image component. Only
    // bypass application boot and CodeMirror's unrelated DOM initialization.
    builder.onResolve({filter: /^decap-cms-core$/}, () => ({path: 'core-registry', namespace: 'headless-widget-registration'}));
    builder.onResolve({filter: /^decap-cms-widget-code$/}, () => ({path: 'code-dom-only', namespace: 'headless-widget-registration'}));
    builder.onLoad({filter: /.*/, namespace: 'headless-widget-registration'}, args => ({
      contents: args.path === 'core-registry'
        ? `
          import registry from 'decap-cms-core/dist/esm/lib/registry.js';
          export const DecapCmsCore = {...registry, registerWidget(widgets, ...args) {
            const selected = globalThis.omitObject && Array.isArray(widgets)
              ? widgets.filter(widget => widget.name !== 'object') : widgets;
            return registry.registerWidget(selected, ...args);
          }};
        `
        : `const controlComponent = function CodeDomOnlyTestDouble() {}; export default {Widget: () => ({name: 'code', controlComponent})};`,
      resolveDir: root,
      loader: 'js',
    }));
  }}],
});

function registeredEditor({omitObject = false} = {}) {
  const navigator = {platform: 'Linux', userAgent: 'Node widget registration regression'};
  const context = vm.createContext({
    window: {navigator}, navigator, omitObject, console,
    require: createRequire(import.meta.url), process: {cwd: () => root},
    setTimeout, clearTimeout, setImmediate, queueMicrotask, Buffer, URL, TextEncoder, TextDecoder,
  }, {codeGeneration: {strings: false, wasm: false}});
  vm.runInContext('global = globalThis; self = globalThis;', context);
  vm.runInContext(compiled.outputFiles[0].text, context, {timeout: 10000});
  return context.regression;
}

test('registered Markdown image uses the official object control and resolves image, alt and title controls', () => {
  const {CMS, ObjectWidget, ImageWidget, StringWidget, resolveWidget} = registeredEditor();
  const image = CMS.getEditorComponents().get('image');
  assert.ok(image, 'The image toolbar component must be registered.');
  assert.equal(image.widget, 'object', 'Image fields need their compound object container.');
  assert.equal(resolveWidget(image.widget).control, ObjectWidget.controlComponent);
  assert.equal(resolveWidget(image.widget).preview, ObjectWidget.previewComponent);
  const fields = image.fields.toArray();
  assert.deepEqual(Array.from(fields, field => field.get('name')), ['image', 'alt', 'title']);
  for (const field of fields) {
    const expected = field.get('name') === 'image' ? ImageWidget : StringWidget;
    assert.equal(resolveWidget(field.get('widget')).control, expected.controlComponent);
  }
});

test('omitting object reproduces the missing-control fallback for the actual registered image component', () => {
  const {CMS, resolveWidget} = registeredEditor({omitObject: true});
  const image = CMS.getEditorComponents().get('image');
  function MissingControl() {}
  CMS.registerWidget('unknown', MissingControl);
  assert.equal(CMS.getWidget('object'), undefined);
  assert.equal(resolveWidget(image.widget).control, MissingControl);
  const corrected = registeredEditor();
  assert.notEqual(corrected.resolveWidget(image.widget).control, MissingControl);
});

test('registered image preserves public media URL, alt and title across Markdown serialization and previews', () => {
  const {CMS} = registeredEditor();
  const image = CMS.getEditorComponents().get('image');
  const data = {image: '/multimedia/documentacion/example.webp', alt: 'Diagrama de datos', title: 'Información compartida'};
  const markdown = image.toBlock(data);
  assert.equal(markdown, '![Diagrama de datos](/multimedia/documentacion/example.webp "Información compartida")');
  const parsed = image.fromBlock(markdown.match(image.pattern));
  assert.deepEqual({...parsed}, data);
  assert.equal(image.toBlock(parsed), markdown);
  const requested = [];
  const preview = image.toPreview(parsed, (value, field) => {
    requested.push({value, name: field.get('name')});
    return '/api/media/example.webp';
  }, image.fields);
  assert.deepEqual(requested, [{value: data.image, name: 'image'}]);
  assert.equal(preview.type, 'img');
  assert.equal(preview.props.src, '/api/media/example.webp');
  assert.equal(preview.props.alt, data.alt);
  assert.equal(preview.props.title, data.title);
});
