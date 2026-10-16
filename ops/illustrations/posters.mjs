// Static previews represent the same localized artwork in social cards.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const catalog = JSON.parse(await fs.readFile(path.join(root, 'ops/illustrations/catalog.json'), 'utf8'));
for (const locale of ['', 'en']) {
  for (const entry of Object.values(catalog)) {
    const svg = path.join(root, 'public/assets/illustrations', locale, entry.asset);
    const png = svg.replace(/\.svg$/, '.png');
    await sharp(svg).png({compressionLevel: 9, palette: true, colours: 256}).toFile(png);
  }
}
console.log('Generated 14 localized, static social previews.');
