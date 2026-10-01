"""Verify a running Compose deployment, including routes, headers and media."""
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urljoin, urlsplit
from urllib.request import build_opener, HTTPRedirectHandler, Request
import argparse
import gzip
import hashlib
import json

REPO = Path(__file__).resolve().parents[1]


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def verify(url, site_url, report_path=None):
    url, site_url = url.rstrip('/'), site_url.rstrip('/')
    config = json.loads((REPO / '.pages/config.json').read_text('utf-8'))
    opener = build_opener(NoRedirect)
    errors, checks = [], {}

    def request(route, headers=None):
        req = Request(url + quote(route, safe='/?=&'), headers=headers or {})
        try:
            response = opener.open(req, timeout=15)
        except HTTPError as response_error:
            response = response_error
        with response:
            return response.status, response.headers, response.read()

    def expect(condition, message):
        if not condition:
            errors.append(message)

    pages = 0
    for route in config['routes']:
        status, headers, body = request(route)
        expect(status == (404 if route == '/404.html' else 200), f'Página {route}: HTTP {status}')
        name = route.lstrip('/') + 'index.html' if route.endswith('/') else route.lstrip('/')
        original = (REPO / 'public' / name).read_text('utf-8')
        text = body.decode('utf-8')
        expect(text.partition('</head>')[2] == original.partition('</head>')[2], f'Contenido alterado: {route}')
        expect(f'<link rel="canonical" href="{site_url}{route}">' in text, f'Canonical incorrecto: {route}')
        policy = config['jira_csp'] if route == '/soporte/' else config['site_csp']
        expect(headers.get('Content-Security-Policy') == policy, f'CSP incorrecta: {route}')
        expect(headers.get('X-Content-Type-Options') == 'nosniff', f'Falta nosniff: {route}')
        expect(headers.get('X-Frame-Options') == 'SAMEORIGIN', f'Falta protección de iframe: {route}')
        expect('no-cache' in headers.get('Cache-Control', ''), f'HTML sin revalidación: {route}')
        pages += 1
    checks['canonical_pages'] = pages

    redirect_count = 0
    for category in ('pages', 'media'):
        for old, new in config['redirects'][category].items():
            routes = (old.rstrip('/'), old.rstrip('/') + '/') if category == 'pages' else (old,)
            for route in routes:
                query = '?origen=prueba&pagina=2'
                status, headers, body = request(route + query)
                destination = urlsplit(urljoin(url + '/', headers.get('Location', '')))
                expected = urlsplit(url + new + query)
                expect(status == 301, f'Alias sin HTTP 301: {route} ({status})')
                expect(destination.path == expected.path and destination.query == expected.query,
                       f'Alias o parámetros incorrectos: {route}')
                expect(not headers.get('Location', '').startswith('http'), f'Alias expone host o puerto interno: {route}')
                redirect_count += 1
    checks['http_redirect_variants_with_query'] = redirect_count

    assets = 0
    for source in sorted((REPO / 'public').rglob('*')):
        if not source.is_file() or source.suffix in {'.html', '.xml', '.txt'}:
            continue
        route = '/' + source.relative_to(REPO / 'public').as_posix()
        status, headers, body = request(route)
        expect(status == 200, f'Recurso sin HTTP 200: {route}')
        expect(hashlib.sha256(body).digest() == hashlib.sha256(source.read_bytes()).digest(), f'Recurso alterado: {route}')
        assets += 1
    checks['unchanged_assets'] = assets

    for route in ('/productos/ifindit-search', '/soporte'):
        status, headers, body = request(route)
        expect(status == 301 and headers.get('Location') == route + '/', f'Canonicalización sin slash: {route}')
    checks['directory_redirects_relative'] = 2

    for route in ('/ruta-inexistente/a/b/', '/assets/no-existe.css'):
        status, headers, body = request(route)
        expect(status == 404 and b'No encontramos esta p' in body, f'404 incorrecto: {route}')
        expect(headers.get('Content-Security-Policy') == config['site_csp'], f'404 sin CSP: {route}')
    for route in ('/.git/config', '/.env', '/.docker/nginx.conf', '/.pages/config.json', '/.htaccess'):
        status, headers, body = request(route)
        expect(status == 403, f'Archivo oculto accesible: {route}')
    for route in ('/Dockerfile', '/compose.yaml', '/README.md'):
        status, headers, body = request(route)
        expect(status == 404, f'Fuente de despliegue publicada: {route}')
    checks['error_and_private_path_checks'] = 10

    video = next((REPO / 'public/multimedia/videos').glob('*.mp4'))
    route = '/' + video.relative_to(REPO / 'public').as_posix()
    status, headers, body = request(route, {'Range': 'bytes=0-1023'})
    expect(status == 206 and body == video.read_bytes()[:1024], 'El video no admite Range 206')
    expect(headers.get('Content-Type') == 'video/mp4', 'MIME incorrecto del video')
    pdf = next((REPO / 'public').rglob('*.pdf'))
    status, headers, body = request('/' + pdf.relative_to(REPO / 'public').as_posix())
    expect(headers.get('Content-Type') == 'application/pdf', 'MIME incorrecto del PDF')
    status, headers, body = request('/assets/site.css')
    expect(headers.get('Content-Type', '').startswith('text/css'), 'MIME incorrecto de CSS')
    expect('max-age=86400' in headers.get('Cache-Control', ''), 'Caché incorrecta de CSS')
    expect('immutable' not in headers.get('Cache-Control', ''), 'Caché permanente con nombre estable')
    status, conditional, body = request('/assets/site.css', {'If-None-Match': headers.get('ETag', '')})
    expect(status == 304, 'ETag no revalida con HTTP 304')
    status, headers, body = request('/assets/site.js', {'Accept-Encoding': 'gzip'})
    expect(headers.get('Content-Encoding') == 'gzip', 'JavaScript no se comprime con gzip')
    if headers.get('Content-Encoding') == 'gzip':
        expect(gzip.decompress(body) == (REPO / 'public/assets/site.js').read_bytes(), 'Gzip altera JavaScript')
    checks['range_mime_cache_etag_gzip'] = True

    for route in ('/robots.txt', '/sitemap.xml'):
        status, headers, body = request(route)
        expect(status == 200 and site_url.encode() in body, f'SEO incorrecto: {route}')
    report = {'passed': not errors, 'errors': errors, 'url': url, 'site_url': site_url, 'checks': checks}
    if report_path:
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8080')
    parser.add_argument('--site-url', default='https://portal.creangel.com')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    try:
        result = verify(args.url, args.site_url, args.report)
    except (URLError, OSError, ValueError) as error:
        result = {'passed': False, 'errors': [str(error)], 'url': args.url, 'site_url': args.site_url}
        if args.report:
            args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(result, ensure_ascii=False))
    raise SystemExit(0 if result['passed'] else 1)
