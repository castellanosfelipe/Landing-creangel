import assert from 'node:assert/strict';
import {test} from 'node:test';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {renameLakehouseBrand, upgradeDocumentationBrand} from './documentation-brand.mjs';

test('updates visible brand while preserving identifiers, URLs, images and code', () => {
  const original = [
    '---', 'id: "lakehouse"', 'title: "LakeHouse"',
    'description: "LakeHouse para análisis."', 'slug: "/plataforma/lakehouse"', '---',
    '# lakehouse', '', '[Ver LakeHouse](/plataforma/LakeHouse/#lakehouse-0013)',
    '', '![Imagen del equipo](/multimedia/documentacion/imagen.jpeg "LakeHouse")',
    '', '`LakeHouse`', '', '```sql', 'SELECT * FROM LakeHouse;', '```',
    '', 'IFINDIT LAKEHOUSE ya está actualizado.'
  ].join('\n');
  const expected = original.replace('title: "LakeHouse"', 'title: "IFINDIT LAKEHOUSE"')
    .replace('description: "LakeHouse', 'description: "IFINDIT LAKEHOUSE')
    .replace('# lakehouse', '# IFINDIT LAKEHOUSE')
    .replace('[Ver LakeHouse]', '[Ver IFINDIT LAKEHOUSE]');
  assert.equal(renameLakehouseBrand(original), expected);
  assert.equal(renameLakehouseBrand(expected), expected);
});

test('preserves visible URLs and does not repeat an existing IFINDIT prefix', () => {
  const urls = 'Ver <https://example.com/lakehouse/?name=LakeHouse>. URL: https://lakehouse.example.com/?product=lakehouse y /plataforma/lakehouse/.';
  assert.equal(renameLakehouseBrand(urls), urls);
  const formatted = 'IFINDIT **LakeHouse**, IFINDIT _lakehouse_ e IFINDIT LakeHouse.';
  const expected = 'IFINDIT **LAKEHOUSE**, IFINDIT _LAKEHOUSE_ e IFINDIT LAKEHOUSE.';
  assert.equal(renameLakehouseBrand(formatted), expected);
  assert.equal(renameLakehouseBrand(expected), expected);
});

test('upgrades both persisted languages without replacing editor content', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'creangel-brand-'));
  try {
    for (const relative of ['documentation/docs', 'documentation/i18n/en/docusaurus-plugin-content-docs/current']) {
      await fs.mkdir(path.join(directory, relative), {recursive:true});
      await fs.writeFile(path.join(directory, relative, 'lakehouse.md'),
        '---\ntitle: "LakeHouse"\nid: "lakehouse"\n---\n\nTexto del editor.\n\n![Foto](/multimedia/documentacion/foto.jpeg)\n');
    }
    assert.equal(await upgradeDocumentationBrand(directory), 2);
    assert.equal(await upgradeDocumentationBrand(directory), 0);
    const document = await fs.readFile(path.join(directory, 'documentation/docs/lakehouse.md'), 'utf8');
    assert.match(document, /title: "IFINDIT LAKEHOUSE"/);
    assert.match(document, /Texto del editor\./);
    assert.match(document, /!\[Foto\]\(\/multimedia\/documentacion\/foto\.jpeg\)/);
    assert.match(document, /id: "lakehouse"/);
  } finally {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep + 'creangel-brand-'));
    await fs.rm(directory, {recursive:true, force:true});
  }
});
