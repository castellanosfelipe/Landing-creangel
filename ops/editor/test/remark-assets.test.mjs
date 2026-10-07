import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {test} from 'node:test';

const documentationRequire = createRequire(new URL('../../../documentation/package.json', import.meta.url));
const plugin = documentationRequire('./plugins/remark-site-assets.js');
const {fromMarkdown} = await import(pathToFileURL(documentationRequire.resolve('mdast-util-from-markdown')));
const {evaluate} = await import(pathToFileURL(documentationRequire.resolve('@mdx-js/mdx')));
const runtime = documentationRequire('react/jsx-runtime');
const React = documentationRequire('react');
const {renderToStaticMarkup} = documentationRequire('react-dom/server');
const transformImage = documentationRequire('@docusaurus/mdx-loader/lib/remark/transformImage').default;
const siteDirectory = path.dirname(documentationRequire.resolve('./package.json'));
const publicDirectory = path.resolve(siteDirectory, '../public');
const siteRoot = 'http://127.0.0.1:8785';
const markdown = '![Icon](/assets/favicon-32.png "PNG")\n\n![Tablero][reference]\n\n[reference]: /assets/productos/ifindit-dashboard.jpeg\n\n```md\n![Example](/assets/missing-in-code.png)\n```\n\n`![inline](/assets/missing-in-inline-code.png)`';

test('documentation image dimensions survive MDX, Docusaurus and rendered HTML', async () => {
  const filePath = path.join(siteDirectory, 'docs/image-regression-fixture.md');
  const compiled = await evaluate({value:markdown, path:filePath, data:{compilerName:'server'}}, {
    ...runtime, format:'md',
    remarkPlugins:[
      [plugin, {siteRoot, publicDirectory}],
      [transformImage, {siteDir:siteDirectory, staticDirs:[], onBrokenMarkdownImages:'throw'}],
    ],
  });
  const html = renderToStaticMarkup(React.createElement(compiled.default));
  assert.match(html, /<img[^>]*width="32"[^>]*height="32"[^>]*loading="lazy"[^>]*decoding="async"/);
  assert.match(html, /<img[^>]*width="1448"[^>]*height="1086"[^>]*loading="lazy"[^>]*decoding="async"/);
  assert.equal((html.match(/<img /g) || []).length, 2);
  assert.match(html, /missing-in-code\.png/);
  assert.match(html, /missing-in-inline-code\.png/);
});

test('documentation asset rewriting leaves remote and doc-relative images native', async () => {
  const tree = fromMarkdown('![Remote](https://example.invalid/image.png)\n\n![Relative](doc-image.png)\n\n[Inicio](/)');
  await plugin({siteRoot, publicDirectory})(tree);
  const remote = tree.children[0].children[0];
  const relative = tree.children[1].children[0];
  assert.equal(remote.url, 'https://example.invalid/image.png');
  assert.equal(relative.url, 'doc-image.png');
  assert.equal(remote.data, undefined);
  assert.equal(relative.data, undefined);
  assert.equal(tree.children[2].children[0].url, siteRoot + '/');
});

test('a missing own image fails before the documentation can publish', async () => {
  await assert.rejects(plugin({siteRoot, publicDirectory})(fromMarkdown('![Missing](/assets/missing-regression-fixture.png)')), error => error.code === 'ENOENT');
});
