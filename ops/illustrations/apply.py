"""Install the supplied, localized SVG scenes without changing product content."""
from pathlib import Path
from xml.etree import ElementTree as ET
import hashlib
import html
import json
import re

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / 'public'
NAMESPACE = 'http://www.w3.org/2000/svg'
ET.register_namespace('', NAMESPACE)
START = '<!-- product-motion:start -->'
END = '<!-- product-motion:end -->'


def svg_markup(path, poster, description):
    scene = ET.parse(path).getroot()
    ids = {element.get('id') for element in scene.iter() if element.get('id')}
    for element in scene.iter():
        tag = element.tag.rsplit('}', 1)[-1]
        if tag in {'script', 'style', 'foreignObject', 'animate', 'animateTransform', 'set', 'image'}:
            raise ValueError(f'Unsupported SVG element: {path.name}: {tag}')
        for name, value in element.attrib.items():
            if name.lower().startswith('on') or name == 'style':
                raise ValueError(f'Inline SVG executable/style attribute: {path.name}: {name}')
            if name.rsplit('}', 1)[-1] == 'href' and not value.startswith('#'):
                raise ValueError(f'External SVG reference: {path.name}')
            for reference in re.findall(r'url\(\s*[\'"]?([^\)\'"\s]+)', value):
                if not reference.startswith('#') or reference[1:] not in ids:
                    raise ValueError(f'Invalid SVG paint reference: {path.name}: {reference}')
    scene.set('data-motion-poster', poster)
    scene.set('data-motion-poster-alt', description)
    scene.set('focusable', 'false')
    return ET.tostring(scene, encoding='unicode', short_empty_elements=True)


def apply():
    catalog = json.loads((ROOT / 'ops/illustrations/catalog.json').read_text('utf-8'))
    versions = {
        name: hashlib.sha256((PUBLIC / 'assets' / name).read_bytes()).hexdigest()[:12]
        for name in ['illustration-motion.css', 'illustration-motion.js']
    }
    count = 0
    for locale in ['es', 'en']:
        english = locale == 'en'
        for entry in catalog.values():
            route = ('en/' if english else '') + entry['route']
            page = PUBLIC / route / 'index.html'
            markup = page.read_text('utf-8')
            prefix = '../' * len(Path(route).parts)
            asset = 'assets/illustrations/' + ('en/' if english else '') + entry['asset']
            poster = prefix + asset.removesuffix('.svg') + '.png'
            scene = svg_markup(PUBLIC / asset, poster, entry['description'][locale])
            title = html.escape(entry['title'][locale], quote=True)
            description = html.escape(entry['description'][locale])
            caption = html.escape(entry['caption'][locale])
            eyebrow = 'Explore how it works' if english else 'Conozca cómo funciona'
            pause = 'Pause animation' if english else 'Pausar animación'
            expand = 'Enlarge illustration' if english else 'Ampliar ilustración'
            block = (
                START + '<section class="section product-motion-section" aria-labelledby="illustration-heading">'
                '<div class="wrap"><div class="product-motion-heading"><div>'
                f'<p class="eyebrow">{eyebrow}</p><h2 id="illustration-heading">{title}</h2>'
                f'<p>{description}</p></div><div class="product-motion-controls" hidden>'
                f'<button type="button" data-motion-toggle aria-pressed="false">{pause}</button>'
                f'<button type="button" data-motion-expand>{expand}</button></div></div>'
                f'<figure class="product-motion" data-motion-illustration data-motion-title="{title}">'
                f'<div class="product-motion-canvas">{scene}</div><figcaption>{caption}</figcaption>'
                '</figure></div></section>' + END
            )
            # Retire only the superseded hero artwork; the wheel, copy and catalogue stay intact.
            markup = re.sub(r'<!-- product-illustration:start -->.*?<!-- product-illustration:end -->', '', markup, flags=re.S)
            markup = markup.replace('hero hero-product-illustration hero-product-wheel', 'hero hero-product-wheel')
            markup = re.sub(re.escape(START) + r'.*?' + re.escape(END), '', markup, flags=re.S)
            hero = re.search(r'<section\b[^>]*class="[^"]*\bhero\b[^"]*".*?</section>', markup, re.S)
            if not hero:
                raise ValueError('Missing product introduction: ' + route)
            markup = markup[:hero.end()] + block + markup[hero.end():]
            for name in versions:
                tag = 'link' if name.endswith('.css') else 'script'
                pattern = rf'<{tag}\b[^>]*(?:href|src)="[^"]*/{re.escape(name)}(?:\?[^"]*)?"[^>]*>'
                if tag == 'script':
                    pattern += r'</script>'
                markup = re.sub(pattern, '', markup)
            resources = (
                f'<link rel="stylesheet" href="{prefix}assets/illustration-motion.css?v={versions["illustration-motion.css"]}">'
                f'<script defer src="{prefix}assets/illustration-motion.js?v={versions["illustration-motion.js"]}"></script>'
            )
            markup = markup.replace('</head>', resources + '</head>', 1)
            page.write_text(markup, encoding='utf-8', newline='\n')
            count += 1
    print(json.dumps({'localized_product_pages': count, 'scenes': len(catalog)}))


if __name__ == '__main__':
    apply()
