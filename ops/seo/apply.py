"""Apply grounded metadata and JSON-LD without changing page bodies or layout."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit
import argparse, html, json, re, os

REPO = Path(__file__).resolve().parents[2]

class Page(HTMLParser):
    def __init__(self, markup):
        super().__init__(convert_charrefs=True)
        self.meta = {}; self.title = ''; self.h1 = ''; self.capture = None
        self.canonical = None; self.images = []; self.main = False; self.head = False; self.lang = 'es-CO'
        self.feed(markup)
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'head': self.head = True
        if tag == 'html': self.lang = attrs.get('lang', self.lang)
        if tag == 'main': self.main = True
        if (tag == 'h1' or tag == 'title' and self.head) and not self.capture: self.capture = tag
        if tag == 'meta': self.meta[attrs.get('name') or attrs.get('property')] = attrs.get('content', '')
        if tag == 'link' and attrs.get('rel') == 'canonical': self.canonical = attrs.get('href')
        if tag == 'img' and self.main: self.images.append(attrs)
    def handle_data(self, data):
        if self.capture == 'title': self.title += data
        if self.capture == 'h1': self.h1 += data
    def handle_endtag(self, tag):
        if tag == self.capture: self.capture = None
        if tag == 'head': self.head = False
        if tag == 'main': self.main = False

def location(root, route):
    return root / (route.lstrip('/') + 'index.html' if route.endswith('/') else route.lstrip('/'))

def set_meta(head, key, value, property=False):
    attr = 'property' if property else 'name'
    head = re.sub(r'<meta\b(?=[^>]*\b' + attr + r'=["\']' + re.escape(key) + r'["\'])[^>]*>', '', head, flags=re.I)
    return head + '<meta ' + attr + '="' + key + '" content="' + html.escape(str(value), quote=True) + '">'

def organization(base):
    return {'@type': 'Organization', '@id': base + '/#organization', 'name': 'Creangel Ltda.',
            'url': base + '/', 'logo': {'@type': 'ImageObject', 'url': base + '/assets/logo-creangel.png'},
            'email': 'soluciones@creangel.com', 'telephone': '+57 601 221 8097',
            'address': {'@type': 'PostalAddress', 'streetAddress': 'Carrera 36ª #54-44',
                        'addressLocality': 'Bogotá', 'addressCountry': 'CO'}}

def social_image(page, url, base):
    for image in page.images:
        if '/assets/productos/' in urljoin(url, image.get('src', '')):
            return {'url': urljoin(url, image['src']), 'alt': image.get('alt', ''),
                    'width': int(image['width']), 'height': int(image['height']), 'type': 'image/jpeg'}
    return {'url': base + '/assets/og-creangel.png', 'alt': 'Creangel · IFINDIT',
            'width': 1200, 'height': 630, 'type': 'image/png'}

def graph(page, route, url, base, title, description, names, image, markup):
    english = route.startswith('/en/') or route.startswith('/documentacion/en/')
    spanish = route.removeprefix('/en') if route.startswith('/en/') else route
    lang = 'en' if english else 'es-CO'
    doc = route.startswith('/documentacion/')
    kind = 'WebPage'
    if spanish == '/contacto/': kind = 'ContactPage'
    if spanish == '/empresa/quienes-somos/': kind = 'AboutPage'
    web = {'@type': kind, '@id': url + '#webpage', 'url': url, 'name': title,
           'description': description, 'inLanguage': lang, 'isPartOf': {'@id': base + '/#website'},
           'publisher': {'@id': base + '/#organization'},
           'primaryImageOfPage': {'@type': 'ImageObject', 'url': image['url'],
                                  'width': image['width'], 'height': image['height']}}
    nodes = [organization(base), {'@type': 'WebSite', '@id': base + '/#website', 'url': base + '/',
             'name': 'Creangel · IFINDIT', 'inLanguage': ['es-CO', 'en'], 'publisher': {'@id': base + '/#organization'}}, web]
    home = ('/documentacion/en/' if english else '/documentacion/') if doc else ('/en/' if english else '/')
    ancestors = [home]
    parts = route.strip('/').split('/')
    for depth in range(1, len(parts)):
        parent = '/' + '/'.join(parts[:depth]) + '/'
        if parent in names and parent != home and (not doc or parent.startswith(home)):
            ancestors.append(parent)
    if route != home:
        ancestors.append(route)
        items = [{'@type': 'ListItem', 'position': i + 1,
                  'name': names.get(path) or page.h1 or title, 'item': base + path}
                 for i, path in enumerate(dict.fromkeys(ancestors))]
        nodes.append({'@type': 'BreadcrumbList', '@id': url + '#breadcrumb', 'itemListElement': items})
        web['breadcrumb'] = {'@id': url + '#breadcrumb'}
    software = re.fullmatch(r'/(?:productos/ifindit-[a-z-]+|plataforma/(?:lakehouse|auth-iam))/', spanish)
    if software and not doc:
        app_id = base + spanish + '#software'
        nodes.append({'@type': 'SoftwareApplication', '@id': app_id, 'name': page.h1,
                      'url': url, 'description': description, 'applicationCategory': 'BusinessApplication',
                      'publisher': {'@id': base + '/#organization'}, 'inLanguage': lang})
        web['mainEntity'] = {'@id': app_id}
    elif spanish.startswith('/soluciones/') and spanish != '/soluciones/':
        service_id = base + spanish + '#service'
        nodes.append({'@type': 'Service', '@id': service_id, 'name': page.h1, 'description': description,
                      'url': url, 'provider': {'@id': base + '/#organization'}})
        web['mainEntity'] = {'@id': service_id}
    elif re.fullmatch(r'/(?:en/)?recursos/articulos/[^/]+/', route) or doc:
        article_id = url + '#article'
        article = {'@type': 'TechArticle' if doc else 'Article', '@id': article_id, 'headline': page.h1,
                   'description': description, 'inLanguage': lang, 'mainEntityOfPage': {'@id': url + '#webpage'},
                   'publisher': {'@id': base + '/#organization'}, 'image': image['url']}
        published = re.search(r'(?:Publicado el|Published on)\s+(\d{4}-\d{2}-\d{2})', markup)
        if published: article['datePublished'] = published[1]
        nodes.append(article); web['mainEntity'] = {'@id': article_id}
    return {'@context': 'https://schema.org', '@graph': nodes}

def apply(root, base, include_docs=False):
    root = root.resolve(); base = base.rstrip('/')
    if os.name == 'nt' and not str(root).startswith('\\\\?\\'): root = Path('\\\\?\\' + str(root))
    origin = urlsplit(base)
    loopback = origin.scheme == 'http' and origin.hostname in ('localhost', '127.0.0.1')
    if (origin.scheme != 'https' and not loopback) or origin.path not in ('', '/') or origin.query or origin.fragment or origin.username or origin.password:
        raise ValueError('SEO origin must be HTTPS (or local HTTP) without a path or credentials.')
    configured = json.loads((REPO / 'ops/seo/metadata.json').read_text('utf-8'))
    overrides = {row['route']: row for row in configured}
    routes = json.loads((REPO / '.pages/config.json').read_text('utf-8'))['routes']
    if include_docs:
        for file in (root / 'documentacion').rglob('*.html'):
            route = '/' + file.relative_to(root).as_posix().removesuffix('index.html')
            if '/404' not in route: routes.append(route)
    names = {}
    for route in routes:
        file = location(root, route)
        if file.exists(): names[route] = Page(file.read_text('utf-8')).h1
    changed = []
    for route in routes:
        file = location(root, route)
        if not file.is_file(): raise ValueError('Missing canonical page ' + route)
        markup = file.read_text('utf-8'); head, boundary, body = markup.partition('</head>')
        if not boundary: raise ValueError('Missing head in ' + route)
        page = Page(markup); item = overrides.get(route, {})
        title = item.get('title_proposed', page.title).strip()
        description = item.get('meta_proposed', page.meta.get('description', '')).strip()
        url = base + route
        image = social_image(page, url, base)
        head = re.sub(r'<title>.*?</title>', '<title>' + html.escape(title) + '</title>', head, flags=re.S)
        for key, value in [('description', description), ('twitter:card', 'summary_large_image'),
                           ('twitter:title', title), ('twitter:description', description),
                           ('twitter:image', image['url']), ('twitter:image:alt', image['alt'])]:
            head = set_meta(head, key, value)
        og_type = 'article' if re.fullmatch(r'/(?:en/)?recursos/articulos/[^/]+/', route) else 'website'
        for key, value in [('og:title', title), ('og:description', description), ('og:url', url),
                           ('og:type', og_type), ('og:site_name', 'Creangel'), ('og:image', image['url']),
                           ('og:image:alt', image['alt']), ('og:image:width', image['width']),
                           ('og:image:height', image['height']), ('og:image:type', image['type'])]:
            head = set_meta(head, key, value, property=True)
        # Article dates come only from the visible migrated publication credit.
        published = re.search(r'(?:Publicado el|Published on)\s+(\d{4}-\d{2}-\d{2})', body)
        if og_type == 'article' and published: head = set_meta(head, 'article:published_time', published[1], property=True)
        head = re.sub(r'<script\b[^>]*type=["\']application/ld\+json["\'][^>]*>.*?</script>', '', head, flags=re.S | re.I)
        data = graph(page, route, url, base, title, description, names, image, markup)
        head += '<script type="application/ld+json">' + json.dumps(data, ensure_ascii=False).replace('<', '\\u003c') + '</script>'
        after = head + boundary + body
        if after != markup:
            file.write_text(after, encoding='utf-8', newline='')
            changed.append(route)
        assert after.partition('</head>')[2] == body, 'SEO must not change body/layout'
    return {'pages_processed': len(routes), 'pages_changed': len(changed), 'body_changes': 0}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--root', type=Path, default=REPO / 'public')
    parser.add_argument('--base-url', default='https://portal.creangel.com'); parser.add_argument('--include-docs', action='store_true')
    args = parser.parse_args(); print(json.dumps(apply(args.root, args.base_url, args.include_docs)))
