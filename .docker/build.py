"""Build the static Docker artifact and HTTP configuration. Standard library only."""
from pathlib import Path
from urllib.parse import urlsplit
import argparse
import importlib
import json
import sys

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / '.pages'))
exporter = importlib.import_module('export')
checker = importlib.import_module('check')


def base_url(value):
    parsed = urlsplit(value)
    if (parsed.scheme not in {'http', 'https'} or not parsed.hostname
            or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in {'', '/'} or any(c.isspace() for c in value)):
        raise ValueError('SITE_URL debe ser un origen HTTP/HTTPS sin credenciales, ruta, query ni fragmento.')
    parsed.port  # Reject an invalid port before creating any output.
    return value.rstrip('/')


def nginx_string(value):
    if any(c in value for c in ('\n', '\r', '"', '\\', '$')):
        raise ValueError('Unsupported character in generated Nginx value.')
    return '"' + value + '"'


def server_config(config):
    return rf'''# Generated from .pages/config.json; do not edit the image directly.
map $uri $creangel_csp {{
    default {nginx_string(config['site_csp'])};
    ~^/soporte(?:/|$) {nginx_string(config['jira_csp'])};
}}

map $uri $creangel_cache {{
    default "no-cache";
    ~*\.(?:css|js|woff2?|eot|ttf|otf|png|jpe?g|webp|avif|gif|svg|ico|mp4|pdf)$ "public, max-age=86400";
}}

server {{
    listen 8080;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;
    autoindex off;
    absolute_redirect off;
    port_in_redirect off;

    add_header Cache-Control $creangel_cache always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    add_header Content-Security-Policy $creangel_csp always;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/javascript application/javascript application/json image/svg+xml application/xml;

    include /etc/nginx/conf.d/redirects.conf;
    error_page 404 /404.html;
    location = /404.html {{ internal; }}
    location ~ /\. {{ deny all; }}
    location ~* \.(?:css|js|woff2?|eot|ttf|otf|png|jpe?g|webp|avif|gif|svg|ico|mp4|pdf)$ {{
        try_files $uri =404;
    }}
    location / {{ try_files $uri $uri/ =404; }}
}}
'''


def redirects_config(config):
    lines = ['# HTTP 301 with the original query string.']
    for category in ('pages', 'media'):
        for old, new in sorted(config['redirects'][category].items()):
            exporter.target(Path('/site'), old)
            exporter.target(Path('/site'), new)
            variants = (old.rstrip('/'), old.rstrip('/') + '/') if category == 'pages' else (old,)
            for route in variants:
                lines.append(f'location = {nginx_string(route)} {{ return 301 {nginx_string(new)[:-1]}$is_args$args"; }}')
    return '\n'.join(lines) + '\n'


def build(url, output):
    url = base_url(url)
    output = exporter.fs(output)
    if output.exists() and any(output.iterdir()):
        raise ValueError('La salida debe estar vacía para evitar archivos residuales.')
    config = json.loads((REPO / '.pages/config.json').read_text('utf-8'))
    exported = exporter.export(REPO / 'public', output / 'site', url, config)
    checked = checker.check(REPO / 'public', output / 'site', url, config)
    if not checked['passed']:
        raise ValueError('La verificación del sitio falló: ' + json.dumps(checked['errors']))
    generated = output / 'config'
    generated.mkdir()
    (generated / 'default.conf').write_text(server_config(config), encoding='utf-8', newline='\n')
    (generated / 'redirects.conf').write_text(redirects_config(config), encoding='utf-8', newline='\n')
    report = {'passed': True, 'errors': [], 'base_url': url, 'content': checked,
              'export': exported, 'http_page_redirects': len(config['redirects']['pages']),
              'http_media_redirects': len(config['redirects']['media']),
              'http_security_headers': True, 'runtime': 'Nginx, non-root, HTTP 8080'}
    (output / 'build-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    build(args.base_url, args.output)
