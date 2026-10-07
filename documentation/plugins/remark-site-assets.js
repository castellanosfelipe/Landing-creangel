const fs = require('node:fs/promises');
const path = require('node:path');
const {imageSizeFromFile} = require('image-size/fromFile');

const imageExtension = /\.(?:png|jpe?g|webp|avif|gif|svg|ico)$/i;
const normalizeIdentifier = value => String(value).replace(/[\t\n\r ]+/g, ' ').trim().toUpperCase();

// CMS media live at the marketing site's root, outside Docusaurus's base URL.
// Infer their intrinsic size before making URLs absolute: Docusaurus treats
// absolute URLs as remote images and otherwise does not infer their dimensions.
module.exports = function remarkSiteAssets({siteRoot, publicDirectory = path.resolve(__dirname, '../../public')}) {
  const origin = new URL(siteRoot).origin;
  function localImagePath(value) {
    if (typeof value !== 'string' || (!value.startsWith('/') && !/^https?:\/\//i.test(value))) return null;
    let url;
    try { url = new URL(value, origin); }
    catch { return null; }
    if (url.origin !== origin || url.username || url.password) return null;
    let relativePath;
    try { relativePath = decodeURIComponent(url.pathname.slice(1)); }
    catch { return null; }
    if (!imageExtension.test(relativePath) || relativePath.includes('\\') || relativePath.includes('\0') ||
        relativePath.split('/').some(part => !part || part === '..' || part.startsWith('.'))) return null;
    return relativePath;
  }

  async function imageDimensions(name) {
    const filename = path.join(publicDirectory, name);
    const [directory, info, resolved] = await Promise.all([
      fs.realpath(publicDirectory), fs.lstat(filename), fs.realpath(filename),
    ]);
    if (!info.isFile() || info.isSymbolicLink() || !resolved.startsWith(directory + path.sep)) {
      throw new Error(`La imagen /${name} no es un archivo local autorizado.`);
    }
    const dimensions = await imageSizeFromFile(resolved);
    let {width, height} = dimensions;
    if ([5, 6, 7, 8].includes(dimensions.orientation)) [width, height] = [height, width];
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      throw new Error(`La imagen /${name} no tiene dimensiones válidas.`);
    }
    return {width, height};
  }

  return async (tree) => {
    const definitions = new Map();
    const dimensions = new Map();
    function collectDefinitions(node) {
      if (node.type === 'definition') {
        const identifier = normalizeIdentifier(node.identifier);
        if (!definitions.has(identifier)) definitions.set(identifier, node.url);
      }
      for (const child of node.children || []) collectDefinitions(child);
    }
    collectDefinitions(tree);

    async function walk(node) {
      const imageURL = node.type === 'image' ? node.url : node.type === 'imageReference' ? definitions.get(normalizeIdentifier(node.identifier)) : null;
      const name = localImagePath(imageURL);
      if (name) {
        if (!dimensions.has(name)) dimensions.set(name, imageDimensions(name));
        const size = await dimensions.get(name);
        node.data = {...node.data, hProperties:{...node.data?.hProperties, ...size, loading:'lazy', decoding:'async'}};
      }
      if (['link', 'image', 'definition'].includes(node.type) &&
          typeof node.url === 'string' && node.url.startsWith('/') &&
          !node.url.startsWith('//')) {
        node.url = `${siteRoot}${node.url}`;
      }
      for (const child of node.children || []) await walk(child);
    }
    await walk(tree);
  };
};
