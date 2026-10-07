// Match only the editor's image directory. Public Markdown URLs stay unchanged;
// Decap receives a source path when resolving previews so it can find draft assets.
const sourceFolder = 'public/multimedia/documentacion/';
const publicFolder = '/multimedia/documentacion/';
const imageName = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:png|jpe?g|webp|avif|gif)$/i;
const mimeTypes = {png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp', avif:'image/avif', gif:'image/gif'};
const assetResolvers = new WeakMap();
const mediaCache = new Map();

export function sourceMediaPath(value) {
  if (typeof value !== 'string') return value;
  const folder = value.startsWith(publicFolder) ? publicFolder : value.startsWith(sourceFolder) ? sourceFolder : null;
  if (!folder) return value;
  const name = value.slice(folder.length);
  return imageName.test(name) ? sourceFolder + name : value;
}

export function resolveEditorAsset(getAsset) {
  if (assetResolvers.has(getAsset)) return assetResolvers.get(getAsset);
  const resolver = (value, field) => getAsset(sourceMediaPath(value), field);
  assetResolvers.set(getAsset, resolver);
  return resolver;
}

export function deserializeEditorMedia(asset) {
  const {id, name, path, encoding, content} = asset;
  if (!path.startsWith(sourceFolder) || !imageName.test(path.slice(sourceFolder.length)) || path.slice(sourceFolder.length) !== name || encoding !== 'base64') {
    throw new Error('La respuesta de la imagen no contiene una ruta autorizada.');
  }
  const cached = mediaCache.get(path);
  if (cached && cached.id === id) return cached;
  const binary = atob(content);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  const type = mimeTypes[name.split('.').pop().toLowerCase()];
  const file = new File([bytes], name, {type});
  const url = URL.createObjectURL(file);
  const result = {id, name, path, file, size:file.size, url, displayURL:url};
  // Release superseded content; unchanged files reuse their existing preview URL.
  if (cached) URL.revokeObjectURL(cached.url);
  mediaCache.set(path, result);
  return result;
}

export function installImagePreviews(CMS) {
  const imageComponent = CMS.getEditorComponents().get('image');
  if (imageComponent) {
    CMS.registerEditorComponent({
      ...imageComponent,
      fields:imageComponent.fields.toJS(),
      toPreview:(data, getAsset, fields) => data.image
        ? imageComponent.toPreview(data, resolveEditorAsset(getAsset), fields)
        : '<p>Seleccione una imagen para ver la vista previa.</p>',
    });
  }
  const imageWidget = CMS.getWidget('image');
  if (imageWidget?.control?.prototype?.render) {
    const {control:Control, preview, ...settings} = imageWidget;
    class SourceAwareImageControl extends Control {
      render() {
        // Delegate to Decap's installed React control, including its event handlers.
        // Only asset resolution differs; field values and saved Markdown stay public.
        const original = this.props;
        this.props = {...original, getAsset:resolveEditorAsset(original.getAsset)};
        try { return super.render(); }
        finally { this.props = original; }
      }
    }
    CMS.registerWidget({...settings, name:'image', controlComponent:SourceAwareImageControl, previewComponent:preview});
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    for (const media of mediaCache.values()) URL.revokeObjectURL(media.url);
    mediaCache.clear();
  });
}
