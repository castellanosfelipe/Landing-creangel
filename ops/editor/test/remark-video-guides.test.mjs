import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {test} from 'node:test';

const documentationRequire = createRequire(new URL('../../../documentation/package.json', import.meta.url));
const plugin = documentationRequire('./plugins/remark-video-guides.js');
const {fromMarkdown} = await import(pathToFileURL(documentationRequire.resolve('mdast-util-from-markdown')));
const {evaluate} = await import(pathToFileURL(documentationRequire.resolve('@mdx-js/mdx')));
const runtime = documentationRequire('react/jsx-runtime');
const React = documentationRequire('react');
const {renderToStaticMarkup} = documentationRequire('react-dom/server');
const videoId = 'YTSzPdvoj70';
const playlistUrl = `https://www.youtube.com/watch?v=${videoId}&list=PL-guides&index=1`;

test('explicit standalone video links create a safe player and keep the original fallback', () => {
  for (const url of [playlistUrl, `https://youtube.com/watch?v=${videoId}`, `https://youtu.be/${videoId}?t=30`]) {
    const tree = fromMarkdown(`[Video: Autenticación e identidad](${url})`);
    const original = tree.children[0];
    const snapshot = structuredClone(original);
    plugin()(tree);
    assert.equal(tree.children.length, 2);
    assert.equal(tree.children[1], original);
    assert.deepEqual(original, snapshot);
    const iframe = tree.children[0];
    assert.equal(iframe.type, 'paragraph');
    assert.deepEqual(iframe.children, []);
    assert.equal(iframe.data.hName, 'iframe');
    assert.deepEqual(iframe.data.hProperties, {
      src: `https://www.youtube-nocookie.com/embed/${videoId}?rel=0`,
      title: 'Autenticación e identidad',
      loading: 'lazy',
      width: 560,
      height: 315,
      className: ['documentation-video'],
      allowFullScreen: true,
      allow: 'encrypted-media; picture-in-picture; fullscreen',
      referrerPolicy: 'strict-origin-when-cross-origin',
    });
  }
});

test('unsafe hosts, protocols, credentials, paths and IDs remain ordinary links', () => {
  const rejected = [
    `http://www.youtube.com/watch?v=${videoId}`,
    `//www.youtube.com/watch?v=${videoId}`,
    `https://www.youtube.com.evil.test/watch?v=${videoId}`,
    `https://youtube.com@evil.test/watch?v=${videoId}`,
    `https://user:secret@www.youtube.com/watch?v=${videoId}`,
    `https://www.youtube.com:8443/watch?v=${videoId}`,
    `https://www.youtube.com./watch?v=${videoId}`,
    `https://www.youtube.com/embed/${videoId}`,
    `https://www.youtube-nocookie.com/embed/${videoId}`,
    `https://www.youtube.com/other/../watch?v=${videoId}`,
    `https://www.youtube.com/watch?v=${videoId}&v=5mVgCq1XYEw`,
    `https://www.youtube.com/watch?v=${videoId}x`,
    `https://www.youtube.com/watch?v=${videoId.slice(1)}`,
    'https://www.youtube.com/watch?v=YT%53zPdvoj70',
    `https://www.youtube.com/watch?%76=${videoId}`,
    'https://www.youtube.com/watch?v=bad%22%3E%3Cscript%3E',
    `https://www.youtube.com/watch?video=${videoId}`,
    `https://youtu.be/${videoId}/extra`,
    `https://youtu.be/other/../${videoId}`,
    `https://youtu.be/${videoId}%2F`,
    `https:\\www.youtube.com/watch?v=${videoId}`,
    `https://www.youtube.com/watch?v=${videoId}\n`,
    `https://www.youtube.com/watch?v=${videoId}\u0001`,
    `https://www.youtube.com/watch?v=${videoId}\u001f`,
    'javascript:alert(1)',
  ];
  for (const url of rejected) {
    const tree = fromMarkdown(`[Video: Guía](https://www.youtube.com/watch?v=${videoId})`);
    tree.children[0].children[0].url = url;
    const snapshot = structuredClone(tree);
    plugin()(tree);
    assert.deepEqual(tree, snapshot, url);
  }
});

test('ordinary links, prose, multiple links and code are unchanged', () => {
  const tree = fromMarkdown([
    `[Guía](${playlistUrl})`,
    `[video: Guía](${playlistUrl})`,
    `[Video:](${playlistUrl})`,
    `Mira [Video: Guía](${playlistUrl}).`,
    `[Video: Uno](${playlistUrl}) [Video: Dos](${playlistUrl})`,
    '`[Video: Guía](' + playlistUrl + ')`',
    '```md\n[Video: Guía](' + playlistUrl + ')\n```',
  ].join('\n\n'));
  const snapshot = structuredClone(tree);
  plugin()(tree);
  assert.deepEqual(tree, snapshot);
});

test('the real Markdown renderer emits an escaped iframe and preserves playlist fallback', async () => {
  const markdown = `[Video: Guía &quot;segura&quot; &lt;img src=x onerror=alert(1)&gt;](${playlistUrl})`;
  const tree = fromMarkdown(markdown);
  plugin()(tree);
  assert.equal(tree.children.some(node => node.type === 'html' || node.type.startsWith('mdx')), false);

  const compiled = await evaluate(markdown, {
    ...runtime,
    format: 'md',
    remarkPlugins: [plugin],
  });
  const html = renderToStaticMarkup(React.createElement(compiled.default));
  assert.equal((html.match(/<iframe /g) || []).length, 1);
  assert.match(html, /src="https:\/\/www\.youtube-nocookie\.com\/embed\/YTSzPdvoj70\?rel=0"/);
  assert.match(html, /title="Guía &quot;segura&quot; &lt;img src=x onerror=alert\(1\)&gt;"/);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /width="560" height="315"/);
  assert.match(html, /class="documentation-video"/);
  assert.match(html, /allowFullScreen=""/);
  assert.match(html, /allow="encrypted-media; picture-in-picture; fullscreen"/);
  assert.match(html, /referrerPolicy="strict-origin-when-cross-origin"/);
  assert.match(html, /<\/iframe>\n<p><a href="https:\/\/www\.youtube\.com\/watch\?v=YTSzPdvoj70&amp;list=PL-guides&amp;index=1"/);
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('<script'), false);
});
