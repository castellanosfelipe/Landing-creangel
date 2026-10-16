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


def product_navigation(scene, catalog, current, locale, prefix):
    """Make the seven existing map cards native links without changing artwork."""
    tag = lambda name: '{' + NAMESPACE + '}' + name
    footer = list(scene)[-1]
    if footer.tag != tag('g') or not any(
        node.tag == tag('rect') and node.get('width') == '1200' and node.get('height') == '196'
        for node in footer
    ):
        raise ValueError('Missing IFINDIT integration map.')
    names = {
        'Auth IAM': ('ifindit-auth-iam', 'IFINDIT Auth IAM'),
        'LakeHouse': ('ifindit-lakehouse', 'IFINDIT LAKEHOUSE'),
        'Clasificador de PQRS': ('ifindit-clasificador-pqrs', 'IFINDIT CLASIFICADOR DE PQRS'),
        'PQRS Classifier': ('ifindit-clasificador-pqrs', 'IFINDIT PQRS CLASSIFIER'),
        'Search': ('ifindit-search', 'IFINDIT SEARCH'),
        'Data Catalog': ('ifindit-data-catalog', 'IFINDIT DATA CATALOG'),
        'ChatGen': ('ifindit-chatgen', 'IFINDIT CHATGEN'),
        'Dashboard': ('ifindit-dashboard', 'IFINDIT DASHBOARD'),
    }
    children = list(footer)
    cards = {}
    for label in children:
        if label.tag != tag('text') or label.text not in names:
            continue
        slug, name = names[label.text]
        lx, ly = float(label.get('x')), float(label.get('y'))
        boxes = [node for node in children if node.tag == tag('rect')
                 and float(node.get('width', 0)) in (150, 184)
                 and float(node.get('height', 0)) == 40
                 and float(node.get('x', 0)) < lx < float(node.get('x', 0)) + float(node.get('width'))
                 and float(node.get('y', 0)) < ly < float(node.get('y', 0)) + 40]
        if len(boxes) != 1 or slug in cards:
            raise ValueError('Ambiguous integration card: ' + slug)
        box = boxes[0]
        x, y, width = float(box.get('x')), float(box.get('y')), float(box.get('width'))
        link = ET.Element(tag('a'), {
            'class': 'ifm-product-link', 'data-integration-product': slug,
            'href': prefix + ('en/' if locale == 'en' else '') + catalog[slug]['route'],
            'tabindex': '0', 'aria-label': ('Go to ' if locale == 'en' else 'Ver ') + name,
        })
        if slug == current:
            link.set('aria-current', 'page')
        box.set('class', 'ifm-product-link-base')
        label.set('class', 'ifm-product-link-label')
        parts = [box, label]
        for node in children:
            if node.tag == tag('rect') and node.get('width') == '5' and node.get('height') == '40' and node.get('x') == box.get('x') and node.get('y') == box.get('y'):
                parts.append(node)
            if node.tag == tag('g') and any(
                circle.tag == tag('circle') and x < float(circle.get('cx', 0)) < x + width
                and y < float(circle.get('cy', 0)) < y + 40 for circle in node
            ):
                parts.append(node)
        position = list(footer).index(box)
        for node in sorted(parts, key=children.index):
            footer.remove(node)
            link.append(node)
        footer.insert(position, link)
        cards[slug] = link
    if set(cards) != set(catalog):
        raise ValueError('The integration map must link all seven products.')
    # Keep the current-product badge attached to its card, above the connectors.
    badge = ET.SubElement(cards[current], tag('g'), {'class': 'ifm-product-link-badge', 'aria-hidden': 'true'})
    for node in list(footer):
        if (node.tag == tag('rect') and node.get('width') == '72' and node.get('height') == '20') or (node.tag == tag('text') and node.text in ('Está aquí', 'You are here')):
            footer.remove(node)
            badge.append(node)
    if len(badge) != 2:
        raise ValueError('Missing current-product badge.')
    footer.attrib.pop('aria-hidden', None)
    footer.set('class', 'ifm-product-map')
    footer.set('role', 'group')
    footer.set('aria-label', 'Explore IFINDIT products' if locale == 'en' else 'Explore los productos IFINDIT')
    for node in footer:
        if node.tag != tag('a'):
            node.set('aria-hidden', 'true')
    # An image role would hide the links. Keep its description and hide only
    # decorative artwork from assistive technology, leaving the map accessible.
    visual = ET.Element(tag('g'), {'aria-hidden': 'true', 'class': 'ifm-visual-scene'})
    first_visual = None
    for index, node in enumerate(list(scene)):
        if node is not footer and node.tag not in {tag('title'), tag('desc'), tag('defs')}:
            if first_visual is None:
                first_visual = index
            scene.remove(node)
            visual.append(node)
    scene.insert(first_visual if first_visual is not None else len(scene) - 1, visual)
    scene.set('role', 'group')
    title = scene.find(tag('title'))
    description = scene.find(tag('desc'))
    scene.set('aria-labelledby', title.get('id'))
    scene.set('aria-describedby', description.get('id'))


def svg_markup(path, poster, description, catalog, current, locale, prefix):
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
    product_navigation(scene, catalog, current, locale, prefix)
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
        for current, entry in catalog.items():
            route = ('en/' if english else '') + entry['route']
            page = PUBLIC / route / 'index.html'
            markup = page.read_text('utf-8')
            prefix = '../' * len(Path(route).parts)
            asset = 'assets/illustrations/' + ('en/' if english else '') + entry['asset']
            poster = prefix + asset.removesuffix('.svg') + '.png'
            scene = svg_markup(PUBLIC / asset, poster, entry['description'][locale], catalog, current, locale, prefix)
            title = html.escape(entry['title'][locale], quote=True)
            description = html.escape(entry['description'][locale])
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
                f'<div class="product-motion-canvas">{scene}</div>'
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
