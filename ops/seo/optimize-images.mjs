#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

// Sharp is supplied by the caller; the site runtime does not depend on it.
const require = createRequire(import.meta.url);
const option = name => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const sharp = require(option('--sharp-module') || 'sharp');
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const publicRoot = path.join(repository, 'public');
const reportPath = path.resolve(option('--report') || path.join(repository, '../seo-20261006/content/responsive-results.json'));
const checksum = data => crypto.createHash('sha256').update(data).digest('hex');
const imageOptions = {quality: 90, alphaQuality: 100, effort: 6};
const productsSizes = '(min-width: 1200px) 300px, (max-width: 399px) calc(100vw - 40px), 360px';
const homeSizes = '(max-width: 600px) calc(39.13vw - 21.91px), (max-width: 850px) calc(42.86vw - 37.71px), (max-width: 1120px) calc(40.91vw - 39.27px), (max-width: 1376px) calc(40.91vw - 65.45px), 498px';
const gallerySizes = '(max-width: 600px) calc(100vw - 90px), (max-width: 850px) calc(50vw - 98px), (max-width: 1120px) calc(33.333vw - 92.667px), (max-width: 1376px) calc(33.333vw - 103.333px), 355px';
const sources = [
  {source: 'assets/productos/ifindit-search.jpeg', name: 'ifindit-search', widths: [300, 360, 600, 720, 1080], sizes: productsSizes},
  {source: 'assets/productos/ifindit-dashboard.jpeg', name: 'ifindit-dashboard', widths: [300, 360, 600, 720, 1080], sizes: productsSizes},
  {source: 'assets/productos/ifindit-data-catalog.jpeg', name: 'ifindit-data-catalog', widths: [300, 360, 600, 720, 1080], sizes: productsSizes},
  {source: 'media/act-0008.webp', name: 'creangel-home', widths: [240, 360, 600, 720, 1080], sizes: homeSizes},
];

async function filesBelow(directory) {
  const entries = await fs.readdir(directory, {withFileTypes: true});
  const nested = await Promise.all(entries.map(entry => entry.isDirectory() ? filesBelow(path.join(directory, entry.name)) : [path.join(directory, entry.name)]));
  return nested.flat().sort();
}

function bodyWithoutResponsiveAttributes(html) {
  return (html.match(/<body\b[\s\S]*$/i)?.[0] || html).replace(/<img\b[^>]*>/gi, tag => tag.replace(/\s+(?:srcset|sizes)="[^"]*"/gi, ''));
}

async function pixelComparison(sourceBuffer, derivative, width) {
  const reference = await sharp(sourceBuffer).resize({width, withoutEnlargement: true}).ensureAlpha().raw().toBuffer();
  const decoded = await sharp(derivative).ensureAlpha().raw().toBuffer();
  if (reference.length !== decoded.length) throw new Error('Decoded dimensions differ from the reference resize');
  let error = 0;
  let maximum = 0;
  for (let offset = 0; offset < reference.length; offset += 4) {
    for (let channel = 0; channel < 4; channel++) {
      // Premultiplied RGB avoids treating invisible color as a visible difference.
      const left = channel < 3 ? reference[offset + channel] * reference[offset + 3] / 255 : reference[offset + 3];
      const right = channel < 3 ? decoded[offset + channel] * decoded[offset + 3] / 255 : decoded[offset + 3];
      const delta = Math.abs(left - right);
      error += delta * delta;
      maximum = Math.max(maximum, delta);
    }
  }
  const rmse = Math.sqrt(error / reference.length);
  return {premultiplied_rgba_rmse_255: Number(rmse.toFixed(4)), psnr_db: rmse ? Number((20 * Math.log10(255 / rmse)).toFixed(2)) : null, maximum_channel_error_255: Number(maximum.toFixed(3))};
}

await fs.mkdir(path.join(publicRoot, 'media/responsive'), {recursive: true});
const results = [];
for (const source of sources) {
  const input = await fs.readFile(path.join(publicRoot, source.source));
  source.originalHash = checksum(input);
  const metadata = await sharp(input).metadata();
  source.variants = [];
  for (const width of source.widths) {
    const destination = `media/responsive/${source.name}-${width}.webp`;
    const output = await sharp(input).resize({width, withoutEnlargement: true}).webp(imageOptions).toBuffer();
    const actual = await sharp(output).metadata();
    await fs.writeFile(path.join(publicRoot, destination), output);
    const variant = {path: destination, width: actual.width, height: actual.height, bytes: output.length, sha256: checksum(output), reduction_percent_vs_original: Number((100 * (1 - output.length / input.length)).toFixed(2)), comparison_at_same_resolution: await pixelComparison(input, output, width)};
    source.variants.push(variant);
  }
  results.push({source: source.source, source_bytes: input.length, source_width: metadata.width, source_height: metadata.height, source_sha256: source.originalHash, variants: source.variants});
}

const sourceByPath = new Map(sources.map(source => [source.source, source]));
const modifiedPages = [];
let imageCount = 0;
const htmlFiles = (await filesBelow(publicRoot)).filter(filename => filename.endsWith('.html'));
for (const filename of htmlFiles) {
  const before = await fs.readFile(filename, 'utf8');
  const relativePage = path.relative(publicRoot, filename).replaceAll(path.sep, '/');
  const pageUrl = new URL(relativePage, 'https://portal.creangel.com/');
  const baseMatch = before.match(/<base\b[^>]*\bhref="([^"]*)"/i);
  const base = baseMatch ? new URL(baseMatch[1], pageUrl) : pageUrl;
  let count = 0;
  const after = before.replace(/<img\b[^>]*>/gi, tag => {
    const src = tag.match(/\bsrc="([^"]*)"/i)?.[1];
    if (!src) return tag;
    const resolved = new URL(src, base);
    if (resolved.origin !== pageUrl.origin) return tag;
    const source = sourceByPath.get(decodeURIComponent(resolved.pathname).slice(1));
    if (!source) return tag;
    const prefix = path.posix.relative(path.posix.dirname(relativePage), 'media/responsive');
    const srcset = source.variants.map(variant => `${prefix}/${path.posix.basename(variant.path)} ${variant.width}w`).join(', ');
    const sizes = source.name === 'creangel-home' && /(?:^|\/)recursos\/multimedia\//.test(relativePage) ? gallerySizes : source.sizes;
    const clean = tag.replace(/\s+(?:srcset|sizes)="[^"]*"/gi, '');
    count++;
    return clean.replace(/\s*\/?>(?=$)/, ending => ` srcset="${srcset}" sizes="${sizes}"${ending}`);
  });
  const beforeBodyHash = checksum(bodyWithoutResponsiveAttributes(before));
  const afterBodyHash = checksum(bodyWithoutResponsiveAttributes(after));
  if (beforeBodyHash !== afterBodyHash) throw new Error(`Unexpected body change: ${relativePage}`);
  if (before !== after) await fs.writeFile(filename, after);
  if (count) modifiedPages.push({page: relativePage, images: count, body_sha256_without_srcset_sizes_before: beforeBodyHash, body_sha256_without_srcset_sizes_after: afterBodyHash, body_preserved: true});
  imageCount += count;
}
for (const source of sources) {
  if (checksum(await fs.readFile(path.join(publicRoot, source.source))) !== source.originalHash) throw new Error(`Original image changed: ${source.source}`);
}

// A vector brand card is rasterized only for sharing previews, not inserted in the UI.
const logo = (await fs.readFile(path.join(publicRoot, 'assets/logo-creangel.png'))).toString('base64');
const socialSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#f3f6f9"/><rect x="0" y="0" width="1200" height="14" fill="#ffd42a"/><rect x="0" y="14" width="1200" height="24" fill="#0b4c82"/><image href="data:image/png;base64,${logo}" x="80" y="90" width="326.4" height="80.4"/><rect x="80" y="237" width="76" height="8" fill="#ffd42a"/><text x="76" y="389" font-family="Arial, sans-serif" font-size="126" font-weight="700" letter-spacing="-3" fill="#0b4c82">IFINDIT</text><text x="82" y="468" font-family="Arial, sans-serif" font-size="38" fill="#0b4c82">Creangel</text><circle cx="1060" cy="453" r="109" fill="none" stroke="#0b4c82" stroke-width="20"/><circle cx="1060" cy="453" r="57" fill="#ffd42a"/><path d="M1117 518l71 69" fill="none" stroke="#0b4c82" stroke-width="20" stroke-linecap="round"/><rect x="0" y="606" width="1200" height="24" fill="#0b4c82"/></svg>`;
const socialOutput = await sharp(Buffer.from(socialSvg)).png({compressionLevel: 9}).toBuffer();
const socialMetadata = await sharp(socialOutput).metadata();
await fs.writeFile(path.join(publicRoot, 'assets/og-creangel.png'), socialOutput);
const report = {
  generator: 'ops/seo/optimize-images.mjs',
  sharp_version: sharp.versions.sharp,
  vips_version: sharp.versions.vips,
  webp_options: imageOptions,
  sources: results,
  affected_html_files: modifiedPages.length,
  affected_img_elements: imageCount,
  preserved_originals: true,
  modified_pages: modifiedPages,
  social_card: {path: 'assets/og-creangel.png', width: socialMetadata.width, height: socialMetadata.height, bytes: socialOutput.length, sha256: checksum(socialOutput)},
};
await fs.mkdir(path.dirname(reportPath), {recursive: true});
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({sharp: report.sharp_version, images: imageCount, pages: modifiedPages.length, derivatives: results.reduce((sum, result) => sum + result.variants.length, 0), social_card: report.social_card, report: reportPath}));
