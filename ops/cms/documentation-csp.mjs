import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

// Docusaurus emits its theme setup and base-URL diagnostic inline. Preserve
// their parser order, but move executable code to same-origin assets so the
// documentation can use script-src 'self' without unsafe-inline or eval.
export function externalizeDocumentationScripts(directory) {
  const assets = path.join(directory, 'assets', 'js');
  fs.mkdirSync(assets, {recursive: true});
  function visit(location) {
    for (const item of fs.readdirSync(location, {withFileTypes: true})) {
      const file = path.join(location, item.name);
      if (item.isDirectory()) visit(file);
      else if (item.name.endsWith('.html')) {
        let html = fs.readFileSync(file, 'utf8').replace(/<script([^>]*)>([\s\S]*?)<\/script>/gi, (whole, attrs, body) => {
          if (/\bsrc\s*=/.test(attrs) || /\btype\s*=\s*["'](?:application\/ld\+json|application\/json)["']/i.test(attrs) || !body.trim()) return whole;
          const name = `bootstrap-${createHash('sha256').update(body).digest('hex').slice(0, 24)}.js`;
          fs.writeFileSync(path.join(assets, name), body);
          return `<script${attrs} src="/documentacion/assets/js/${name}"></script>`;
        });
        const styles = new Map();
        html = html.replace(/<[a-z][^>]*\sstyle="([^"]*)"[^>]*>/gi, (tag, declaration) => {
          const className = `csp-style-${createHash('sha256').update(declaration).digest('hex').slice(0, 16)}`;
          styles.set(className, declaration.replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&amp;', '&'));
          let replacement = tag.replace(/\sstyle="[^"]*"/i, '');
          replacement = /\sclass="[^"]*"/i.test(replacement)
            ? replacement.replace(/\sclass="([^"]*)"/i, ` class="$1 ${className}"`)
            : replacement.replace(/\s*\/?>(?=$)/, ` class="${className}"$&`);
          return replacement;
        });
        if (styles.size) {
          const css = [...styles].map(([name, value]) => `.${name}{${value}}`).join('\n');
          const name = `styles-${createHash('sha256').update(css).digest('hex').slice(0, 24)}.css`;
          const cssDir = path.join(directory, 'assets', 'css');
          fs.mkdirSync(cssDir, {recursive: true});
          fs.writeFileSync(path.join(cssDir, name), css);
          html = html.replace('</head>', `<link rel="stylesheet" href="/documentacion/assets/css/${name}"></head>`);
        }
        fs.writeFileSync(file, html);
      }
    }
  }
  visit(directory);
}
