import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {externalizeDocumentationScripts} from './documentation-csp.mjs';

test('documentation keeps script order and JSON-LD while eliminating executable inline code', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-csp-'));
  try {
    const file = path.join(dir, 'index.html');
    fs.writeFileSync(file, '<head><script id="theme">window.theme="light";</script><script type="application/ld+json">{"name":"Creangel"}</script><script defer src="/main.js"></script></head>');
    externalizeDocumentationScripts(dir);
    const html = fs.readFileSync(file, 'utf8');
    assert.match(html, /<script id="theme" src="\/documentacion\/assets\/js\/bootstrap-[0-9a-f]+\.js"><\/script>/);
    assert.ok(html.indexOf('id="theme"') < html.indexOf('application/ld+json'));
    assert.match(html, /<script type="application\/ld\+json">\{"name":"Creangel"\}<\/script>/);
    assert.match(html, /<script defer src="\/main.js"><\/script>/);
    const [asset] = fs.readdirSync(path.join(dir, 'assets/js'));
    assert.equal(fs.readFileSync(path.join(dir, 'assets/js', asset), 'utf8'), 'window.theme="light";');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
test('documentation moves inline presentation to equivalent external CSS classes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-csp-'));
  try {
    const file = path.join(dir, 'index.html');
    fs.writeFileSync(file, '<head></head><body><svg class="logo" style="width:auto"></svg><div style="display: none;"></div></body>');
    externalizeDocumentationScripts(dir);
    const html = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(html, /\sstyle=/);
    assert.match(html, /class="logo csp-style-[a-f0-9]+"/);
    assert.match(html, /<div class="csp-style-[a-f0-9]+">/);
    const [asset] = fs.readdirSync(path.join(dir, 'assets/css'));
    assert.match(fs.readFileSync(path.join(dir, 'assets/css', asset), 'utf8'), /width:auto/);
    assert.match(fs.readFileSync(path.join(dir, 'assets/css', asset), 'utf8'), /display: none;/);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
