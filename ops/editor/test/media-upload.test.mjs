import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {editorAssetBase64} from '../../../public/admin/media-support.js';

const root = path.resolve(import.meta.dirname, '../../..');
const sourceFolder = 'public/multimedia/documentacion/';
const bytes = length => Uint8Array.from({length}, (_, index) => index % 256);
const base64 = value => Buffer.from(value).toString('base64');

test('local File and Blob uploads preserve every binary byte across encoding chunks', async () => {
  for (const length of [1, 256, 32768, 32769, 65537, 200000]) {
    const content = bytes(length);
    for (const fileObj of [new Blob([content]), new File([content], 'binary.png', {type: 'image/png'})]) {
      let fallbackCalls = 0;
      const asset = {fileObj, toBase64() {
        fallbackCalls++;
        throw new TypeError('Fetching a blob URL is blocked by connect-src.');
      }};
      assert.equal(await editorAssetBase64(asset), base64(content), `binary length ${length}`);
      assert.equal(fallbackCalls, 0, 'The local file must never invoke Decap’s URL fetch.');
    }
  }
});

test('a revoked preview URL does not prevent reading its File, including an empty Blob', async () => {
  const content = Uint8Array.of(0, 255, 128, 195, 169, 10, 0);
  const fileObj = new File([content], 'revoked.png', {type: 'image/png'});
  const url = URL.createObjectURL(fileObj);
  URL.revokeObjectURL(url);
  let fallbackCalls = 0;
  const toBase64 = () => {
    fallbackCalls++;
    throw new TypeError('The blob URL is no longer available.');
  };
  assert.equal(await editorAssetBase64({fileObj, url, toBase64}), base64(content));
  assert.equal(await editorAssetBase64({fileObj: new Blob([]), toBase64}), '');
  assert.equal(fallbackCalls, 0);
});

test('URL-only assets retain the original fallback method and its receiver', async () => {
  const asset = {
    path: sourceFolder + 'remote.png',
    url: '/api/media/remote.png',
    calls: 0,
    async toBase64() {
      assert.equal(this, asset);
      assert.equal(this.url, '/api/media/remote.png');
      this.calls++;
      return 'AP+A';
    },
  };
  assert.equal(await editorAssetBase64(asset), 'AP+A');
  assert.equal(asset.calls, 1);
});

test('oversized native files are rejected before reading bytes or invoking the URL fallback', async () => {
  let reads = 0;
  let fallbackCalls = 0;
  class OversizedFile extends File {
    get size() { return 10 * 1024 * 1024 + 1; }
    async arrayBuffer() { reads++; return super.arrayBuffer(); }
  }
  await assert.rejects(editorAssetBase64({
    fileObj: new OversizedFile([], 'oversized.png'),
    toBase64() { fallbackCalls++; throw new Error('Blocked fetch'); },
  }), /máximo 10 MB/);
  assert.equal(reads, 0);
  assert.equal(fallbackCalls, 0);
});

// Exercise the installed backend and AssetProxy together with our actual boot
// script. The only replaced Decap module is its unrelated authentication UI.
const localBackendSource = await readFile(path.join(root, 'public/admin/local-backend.js'), 'utf8');
assert.ok(localBackendSource.trimStart().startsWith('(async()=>{'));
const compiled = await build({
  absWorkingDir: root,
  stdin: {
    contents: `
      import ProxyBackend from 'decap-cms-backend-proxy/dist/esm/implementation.js';
      import AssetProxy from 'decap-cms-core/dist/esm/valueObjects/AssetProxy.js';
      globalThis.uploadHarness = {ProxyBackend, AssetProxy};
      globalThis.boot = ${localBackendSource}
    `,
    resolveDir: path.join(root, 'public/admin'),
    sourcefile: 'media-upload-regression.js',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'iife',
  mainFields: ['module', 'main'],
  define: {'process.env.NODE_ENV': '"production"'},
  logLevel: 'silent',
  plugins: [{name: 'headless-proxy-authentication', setup(builder) {
    builder.onResolve({filter: /^\.\/AuthenticationPage$/}, args => {
      if (args.importer.replaceAll('\\', '/').endsWith('/decap-cms-backend-proxy/dist/esm/implementation.js')) {
        return {path: 'AuthenticationPage', namespace: 'headless-proxy-authentication'};
      }
    });
    builder.onLoad({filter: /.*/, namespace: 'headless-proxy-authentication'}, () => ({
      contents: 'export default function AuthenticationPage() {}', loader: 'js',
    }));
  }}],
});

async function bootEditor(t) {
  const sent = [];
  const fetches = [];
  const redirects = [];
  const previewURLs = [];
  const configuration = {
    backend: {name: 'creangel-local', branch: 'editorial-preview', cms_label_prefix: 'portal/'},
    media_folder: sourceFolder.slice(0, -1),
  };
  const backendOptions = {initialWorkflowStatus: 'draft'};
  const registered = new Map();
  const node = () => ({setAttribute() {}, append() {}, prepend() {}});
  const rootNode = node();
  const session = {user: {username: 'test-editor', displayName: 'Test Editor', role: 'editor', mustChangePassword: false}};
  let context;
  let backend;
  const window = {
    URL: {
      createObjectURL(file) { const url = URL.createObjectURL(file); previewURLs.push(url); return url; },
      revokeObjectURL: URL.revokeObjectURL,
    },
    navigator: {userAgent: 'Node upload regression', platform: 'Linux'},
    addEventListener() {},
    CreangelAccount: {
      async restore() { return session; },
      loginURL() { return '/admin/login/'; },
      async request(url, method, payload) {
        assert.equal(url, '/api/content');
        assert.equal(method, 'POST');
        sent.push(JSON.parse(JSON.stringify(payload)));
        if (payload.action === 'getEntry') return {file: {path: payload.params.path, id: 'a'.repeat(64)}};
        if (payload.action === 'persistEntry') return {file: {path: payload.params.dataFiles[0].path, id: 'b'.repeat(64)}};
        if (payload.action === 'persistMedia') {
          const {asset} = payload.params;
          return {...asset, name: asset.path.slice(sourceFolder.length), id: 'media-revision'};
        }
        throw new Error(`Unexpected content action: ${payload.action}`);
      },
    },
  };
  const CMS = {
    getBackend(name) {
      assert.equal(name, 'proxy');
      return {init(config, options) {
        assert.equal(config.backend.proxy_url, '/api/content');
        assert.equal(options, backendOptions);
        return new context.uploadHarness.ProxyBackend(config, options);
      }};
    },
    registerBackend(name, implementation) { registered.set(name, implementation); },
    getEditorComponents() { return new Map(); },
    getWidget() { return undefined; },
    init() { backend = new (registered.get('creangel-local'))(configuration, backendOptions); },
  };
  context = vm.createContext({
    window, navigator: window.navigator, CMS, console, Blob, File, URL, btoa, atob,
    TextEncoder, TextDecoder, Buffer, require: createRequire(import.meta.url),
    document: {createElement: node, body: node(), querySelector: () => rootNode},
    localStorage: {setItem() {}},
    location: {replace: value => redirects.push(value), assign: value => redirects.push(value)},
    setInterval() {}, clearInterval() {}, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      fetches.push({url, options});
      if (url === '/local/status') return {ok: true, json: async () => ({state: 'idle'})};
      throw new TypeError(`Blocked by connect-src: ${url}`);
    },
  }, {codeGeneration: {strings: false, wasm: false}});
  vm.runInContext('global = globalThis; self = globalThis;', context);
  vm.runInContext(compiled.outputFiles[0].text, context, {timeout: 10000});
  await context.boot;
  assert.equal(rootNode.textContent, undefined, 'Editor boot must finish without an error.');
  assert.deepEqual(redirects, []);
  assert.ok(backend instanceof context.uploadHarness.ProxyBackend, 'Use the actual installed ProxyBackend.');
  assert.deepEqual(fetches.map(value => value.url), ['/local/status']);
  t.after(() => { for (const url of previewURLs) URL.revokeObjectURL(url); });
  return {backend, AssetProxy: context.uploadHarness.AssetProxy, sent, fetches};
}

test('media-library uploads read the real Decap File despite a blocked and revoked preview URL', async t => {
  const {backend, AssetProxy, sent, fetches} = await bootEditor(t);
  const content = bytes(65537);
  const file = new File([content], 'media-library.png', {type: 'image/png'});
  const asset = new AssetProxy({file, path: sourceFolder + file.name});
  // This reproduces the installed serializer's blocked fetch before testing our
  // replacement against the same real AssetProxy, with its preview revoked.
  await assert.rejects(asset.toBase64(), /Blocked by connect-src: blob:/);
  URL.revokeObjectURL(asset.url);
  const before = fetches.length;
  const result = await backend.persistMedia(asset, {commitMessage: 'Add media library image'});
  assert.equal(fetches.length, before, 'A file upload must not issue another blob fetch.');
  assert.deepEqual(sent, [{
    action: 'persistMedia',
    params: {
      asset: {path: sourceFolder + file.name, content: base64(content), encoding: 'base64'},
      options: {commitMessage: 'Add media library image'},
    },
  }]);
  assert.equal(result.path, asset.path);
  assert.equal(result.id, 'media-revision');
  assert.equal(result.file.type, 'image/png');
  assert.deepEqual(Buffer.from(await result.file.arrayBuffer()), Buffer.from(content));
  URL.revokeObjectURL(result.url);
});

test('draft uploads retain installed proxy branch, workflow status, save options, source paths and revision', async t => {
  const {backend, AssetProxy, sent, fetches} = await bootEditor(t);
  const content = bytes(32769);
  const file = new File([content], 'draft.png', {type: 'image/png'});
  const asset = new AssetProxy({file, path: sourceFolder + file.name});
  const originalToBase64 = asset.toBase64;
  URL.revokeObjectURL(asset.url);
  const dataPath = 'public/documentacion/draft.md';
  await backend.getEntry(dataPath);
  const dataFiles = [{path: dataPath, raw: '![Draft](/multimedia/documentacion/draft.png)'}];
  const entry = {dataFiles, assets: [asset]};
  const options = {status: 'pending_review', commitMessage: 'Save entry image', newEntry: false, collectionName: 'documentation', slug: 'draft'};
  const originalOptions = {...options};
  await backend.persistEntry(entry, options);
  assert.deepEqual(sent.at(-1), {
    action: 'persistEntry',
    params: {
      branch: 'editorial-preview',
      dataFiles: [{...dataFiles[0], baseRevision: 'a'.repeat(64)}],
      assets: [{path: asset.path, content: base64(content), encoding: 'base64'}],
      options,
      cmsLabelPrefix: 'portal/',
    },
  });
  assert.equal(asset.toBase64, originalToBase64, 'Draft serialization must not replace the original asset method.');
  assert.equal(entry.assets[0], asset);
  assert.deepEqual(dataFiles, [{path: dataPath, raw: '![Draft](/multimedia/documentacion/draft.png)'}]);
  assert.deepEqual(options, originalOptions);
  assert.deepEqual(fetches.map(value => value.url), ['/local/status']);

  await backend.persistEntry(entry, {commitMessage: 'Use default workflow status', newEntry: false});
  assert.equal(sent.at(-1).params.options.status, 'draft');
  assert.equal(sent.at(-1).params.options.commitMessage, 'Use default workflow status');
  assert.equal(sent.at(-1).params.options.newEntry, false);
  assert.equal(sent.at(-1).params.dataFiles[0].baseRevision, 'b'.repeat(64));
});

for (const route of ['persistMedia', 'persistEntry']) {
  for (const failure of ['file read', 'URL fallback', 'oversized file']) {
    test(`${route} rejects a failed ${failure} before any content API write`, async t => {
      const {backend, AssetProxy, sent, fetches} = await bootEditor(t);
      let reads = 0;
      let fallbacks = 0;
      const readError = new Error('Native file read failed');
      class UnreadableFile extends File {
        async arrayBuffer() { reads++; throw readError; }
      }
      class OversizedFile extends File {
        get size() { return 10 * 1024 * 1024 + 1; }
        async arrayBuffer() { reads++; return super.arrayBuffer(); }
      }
      const file = failure === 'file read' ? new UnreadableFile([bytes(8)], 'failed.png')
        : failure === 'oversized file' ? new OversizedFile([], 'failed.png') : undefined;
      const asset = new AssetProxy({file, url: file ? undefined : 'blob:unreadable-url', path: sourceFolder + 'failed.png'});
      if (file) asset.toBase64 = () => { fallbacks++; throw new Error('Unexpected URL fallback'); };
      const operation = route === 'persistMedia'
        ? backend.persistMedia(asset, {commitMessage: 'Upload failed image'})
        : backend.persistEntry({
          dataFiles: [{path: 'public/documentacion/failed.md', raw: 'Draft with two images'}],
          assets: [new AssetProxy({file: new File([bytes(8)], 'good.png'), path: sourceFolder + 'good.png'}), asset],
        }, {commitMessage: 'Save failed draft', newEntry: true});
      await assert.rejects(operation, failure === 'file read' ? error => error === readError
        : failure === 'oversized file' ? /máximo 10 MB/ : /Blocked by connect-src: blob:unreadable-url/);
      assert.deepEqual(sent, [], 'Serialization failure must prevent the entire content request.');
      assert.equal(reads, failure === 'file read' ? 1 : 0);
      assert.equal(fallbacks, 0);
      assert.deepEqual(fetches.map(value => value.url), failure === 'URL fallback'
        ? ['/local/status', 'blob:unreadable-url'] : ['/local/status']);
    });
  }
}
