"""Generate and validate crawl files from the published canonical HTML."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, urljoin
from urllib.robotparser import RobotFileParser
from xml.etree import ElementTree as ET
from collections import Counter
import argparse, json, os, re
from robots_rules import allows as robots_allows

REPO = Path(__file__).resolve().parents[2]
NS = 'http://www.sitemaps.org/schemas/sitemap/0.9'
XHTML = 'http://www.w3.org/1999/xhtml'
ET.register_namespace('', NS)
ET.register_namespace('xhtml', XHTML)


class Page(HTMLParser):
    def __init__(self, markup):
        super().__init__(convert_charrefs=True)
        self.canonical = []; self.meta = {}; self.alternates = {}; self.refs = []; self.base = None
        self.feed(markup)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'base': self.base = a.get('href'); return
        if tag == 'meta':
            self.meta.setdefault(a.get('name', '').lower(), []).append(a.get('content', ''))
        if tag == 'link':
            rel = a.get('rel', '').lower().split()
            if 'canonical' in rel: self.canonical.append(a.get('href', ''))
            if 'alternate' in rel and a.get('hreflang'):
                code = a['hreflang']
                if code in self.alternates: raise ValueError('Duplicate hreflang: ' + code)
                self.alternates[code] = a.get('href', '')
        for key in ('href', 'src', 'poster'):
            if a.get(key): self.refs.append(a[key])
        if a.get('srcset'): self.refs.extend(item.strip().split()[0] for item in a['srcset'].split(','))


def is_indexable(page):
    directives = ','.join(value for name, values in page.meta.items()
                          if (name or '').lower() in ('robots', 'googlebot', 'bingbot')
                          for value in values).lower()
    return not ({'noindex', 'none'} & set(re.split(r'[\s,]+', directives)))


def fs_root(root):
    root = Path(root).resolve()
    if os.name == 'nt' and not str(root).startswith('\\\\?\\'):
        root = Path('\\\\?\\' + str(root))
    return root


def collect_pages(root, config=None):
    root = fs_root(root)
    if config is None: config = json.loads((REPO / '.pages/config.json').read_text('utf-8'))
    routes = set(config['routes'])
    for file in (root / 'documentacion').rglob('*.html'):
        routes.add('/' + file.relative_to(root).as_posix().removesuffix('index.html'))
    pages = {}
    for route in sorted(routes):
        file = root / (route.lstrip('/') + 'index.html' if route.endswith('/') else route.lstrip('/'))
        pages[route] = Page(file.read_text('utf-8'))
    return pages


def sitemap_text(pages, base):
    tree = ET.Element('{' + NS + '}urlset')
    for route, page in sorted(pages.items()):
        if not is_indexable(page): continue
        url = ET.SubElement(tree, '{' + NS + '}url')
        ET.SubElement(url, '{' + NS + '}loc').text = base + route
        for code, href in sorted(page.alternates.items()):
            ET.SubElement(url, '{' + XHTML + '}link',
                          {'rel': 'alternate', 'hreflang': code, 'href': href})
    ET.indent(tree, space='  ')
    return ET.tostring(tree, encoding='utf-8', xml_declaration=True).decode('utf-8') + '\n'


def canonical_errors(pages, base):
    errors = []
    indexable = {base + route: page for route, page in pages.items() if is_indexable(page)}
    for route, page in pages.items():
        if not is_indexable(page): continue
        url = base + route
        if page.canonical != [url]: errors.append({'error': 'sitemap_noncanonical', 'route': route})
        if not page.alternates or url not in page.alternates.values():
            errors.append({'error': 'sitemap_missing_self_alternate', 'route': route})
        for code, href in page.alternates.items():
            target = indexable.get(href)
            if not re.fullmatch(r'(?:[a-zA-Z]{2,3})(?:-[a-zA-Z0-9]{2,8})*|x-default', code):
                errors.append({'error': 'sitemap_hreflang_code', 'route': route, 'code': code})
            if target is None or target.alternates != page.alternates:
                errors.append({'error': 'sitemap_hreflang_target', 'route': route, 'target': href})
    return errors


def generate(root, base, config=None):
    root = fs_root(root); base = base.rstrip('/')
    origin = urlsplit(base)
    if origin.scheme not in ('http', 'https') or not origin.netloc or origin.path or origin.query or origin.fragment or origin.username or origin.password:
        raise ValueError('Use a complete site origin without a path or credentials.')
    pages = collect_pages(root, config)
    errors = canonical_errors(pages, base)
    if errors: raise ValueError(json.dumps(errors, ensure_ascii=False))
    (root / 'sitemap.xml').write_text(sitemap_text(pages, base), encoding='utf-8', newline='\n')
    # Keep Docusaurus' locale sitemaps consistent with the root sitemap.
    for prefix in ('/documentacion/', '/documentacion/en/'):
        subset = {route: page for route, page in pages.items() if route.startswith(prefix)
                  and (prefix.endswith('/en/') or not route.startswith('/documentacion/en/'))}
        directory = root / prefix.strip('/')
        if directory.is_dir():
            (directory / 'sitemap.xml').write_text(sitemap_text(subset, base), encoding='utf-8', newline='\n')
    robots = ('# Public pages and CSS, JavaScript and images remain crawlable.\n'
              'User-agent: *\n'
              'Disallow: /api/\nDisallow: /local/\nDisallow: /auth/\n'
              'Disallow: /publish/\nDisallow: /cms-proxy/\n\n'
              '# Login, internal search and error pages use noindex, not robots blocking.\n'
              'Sitemap: ' + base + '/sitemap.xml\n')
    (root / 'robots.txt').write_text(robots, encoding='utf-8', newline='\n')
    return {'sitemap_urls': sum(is_indexable(p) for p in pages.values()),
            'excluded_pages': sum(not is_indexable(p) for p in pages.values())}


def validate_sitemap(file, expected):
    errors = []
    try:
        sitemap = ET.parse(file).getroot()
        if sitemap.tag != '{' + NS + '}urlset': errors.append({'error': 'sitemap_root'})
        entries = sitemap.findall('{' + NS + '}url')
        locations = [node.findtext('{' + NS + '}loc') for node in entries]
        if Counter(locations) != Counter({url: 1 for url in expected}):
            errors.append({'error': 'sitemap_indexable_mismatch',
                           'missing': sorted(set(expected) - set(locations)),
                           'unexpected': sorted(set(locations) - set(expected), key=str),
                           'duplicates': [url for url, count in Counter(locations).items() if count > 1]})
        for entry, url in zip(entries, locations):
            links = entry.findall('{' + XHTML + '}link')
            alternates = {node.get('hreflang'): node.get('href') for node in links if node.get('rel') == 'alternate'}
            if url in expected and (alternates != expected[url].alternates or len(links) != len(alternates)):
                errors.append({'error': 'sitemap_hreflang_mismatch', 'url': url})
    except (OSError, ET.ParseError) as exc:
        errors.append({'error': 'invalid_sitemap', 'detail': str(exc)})
    for error in errors: error['sitemap'] = file.name if file.parent.name not in ('documentacion', 'en') else file.parent.name + '/' + file.name
    return errors


def validate(root, base, pages=None):
    root = fs_root(root); base = base.rstrip('/')
    if pages is None: pages = collect_pages(root)
    errors = canonical_errors(pages, base)
    expected = {base + route: page for route, page in pages.items() if is_indexable(page)}
    errors.extend(validate_sitemap(root / 'sitemap.xml', expected))
    for prefix in ('/documentacion/', '/documentacion/en/'):
        directory = root / prefix.strip('/')
        if directory.is_dir():
            subset = {url: page for url, page in expected.items() if url.startswith(base + prefix)
                      and (prefix.endswith('/en/') or not url.startswith(base + '/documentacion/en/'))}
            errors.extend(validate_sitemap(directory / 'sitemap.xml', subset))
    try:
        text = (root / 'robots.txt').read_text('utf-8')
        robots = RobotFileParser(); robots.parse(text.splitlines())
        if robots.site_maps() != [base + '/sitemap.xml']: errors.append({'error': 'robots_sitemap'})
        resources = set(expected)
        for route, page in pages.items():
            if not is_indexable(page): continue
            context = urljoin(base + route, page.base) if page.base else base + route
            for ref in page.refs:
                url = urljoin(context, ref)
                if urlsplit(url).netloc == urlsplit(base).netloc: resources.add(url)
        for agent in ('Googlebot', 'Bingbot', '*'):
            for url in sorted(resources):
                if not robots_allows(text, agent, url):
                    errors.append({'error': 'robots_blocks_indexable' if url in expected else 'robots_blocks_resource',
                                   'agent': agent, 'url': url})
    except OSError as exc:
        errors.append({'error': 'invalid_robots', 'detail': str(exc)})
    for folder in ('documentacion', 'admin'):
        for file in (root / folder).rglob('*.html'):
            if folder == 'admin' or '404' in file.relative_to(root).parts or file.name == '404.html':
                if is_indexable(Page(file.read_text('utf-8'))):
                    errors.append({'error': 'private_or_error_indexable', 'file': file.relative_to(root).as_posix()})
    return errors


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--base-url', required=True)
    args = parser.parse_args()
    result = generate(args.root, args.base_url)
    errors = validate(args.root, args.base_url)
    print(json.dumps({**result, 'passed': not errors, 'errors': errors}, ensure_ascii=False))
    raise SystemExit(1 if errors else 0)
