import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fromMarkdown} from 'mdast-util-from-markdown';

// Change visible branding, keeping route names, code examples and media intact.
export function renameLakehouseBrand(markdown) {
  const frontmatter = markdown.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0] || '';
  const rename = (text, prefix = '') => text.replace(
    /(?:[a-z][a-z\d+.-]*:\/\/|www\.|\.{0,2}\/)[^\s<>"'`]+|\blakehouse\b/gi,
    (brand, offset) => {
      if (brand.toLowerCase() !== 'lakehouse') return brand;
      return /IFINDIT\s+[*_~]*$/i.test(prefix + text.slice(0, offset)) ? 'LAKEHOUSE' : 'IFINDIT LAKEHOUSE';
    });
  const header = frontmatter.replace(/^(title|description):[^\r\n]*/gm, line => rename(line));
  const body = markdown.slice(frontmatter.length), changes = [];
  const visit = node => {
    if (node.type === 'text') {
      const start = node.position.start.offset, end = node.position.end.offset;
      const original = body.slice(start, end), updated = rename(original, body.slice(0, start));
      if (updated !== original) changes.push({start, end, updated});
    }
    for (const child of node.children || []) visit(child);
  };
  visit(fromMarkdown(body));
  let updated = body;
  for (const change of changes.sort((a, b) => b.start - a.start))
    updated = updated.slice(0, change.start) + change.updated + updated.slice(change.end);
  return header + updated;
}

export async function upgradeDocumentationBrand(workspace) {
  let count = 0;
  for (const relative of ['documentation/docs', 'documentation/i18n/en/docusaurus-plugin-content-docs/current']) {
    const directory = path.join(workspace, relative);
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Directorio de documentación inválido.');
    for (const name of await fs.readdir(directory)) {
      if (!name.endsWith('.md')) continue;
      const filename = path.join(directory, name), info = await fs.lstat(filename);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('Documento inválido.');
      const original = await fs.readFile(filename, 'utf8'), updated = renameLakehouseBrand(original);
      if (updated === original) continue;
      const temporary = filename + '.' + randomUUID() + '.tmp';
      try {
        await fs.writeFile(temporary, updated, {flag:'wx', mode:info.mode & 0o777});
        await fs.rename(temporary, filename);
        count++;
      } finally { await fs.rm(temporary, {force:true}); }
    }
  }
  return count;
}
