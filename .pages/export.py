"""Export the audited static site for GitHub Pages. Standard library only."""
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit, quote
import argparse, hashlib, html, json, os, posixpath, re, shutil


def fs(path):
    path = Path(path).resolve()
    if os.name == 'nt' and not str(path).startswith('\\\\?\\'):
        return Path('\\\\?\\' + str(path))
    return path


def target(root, route):
    parts = PurePosixPath(route.lstrip('/')).parts
    if not parts or any(p in {'.', '..'} or '\\' in p or ':' in p for p in parts):
        raise ValueError('Invalid site path: ' + route)
    return root.joinpath(*parts)


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8')


def public_url(base, route):
    return base + quote(route, safe='/')


def meta_policy(policy):
    # These directives require an HTTP response header and have no meta support.
    return '; '.join(p.strip() for p in policy.split(';')
                     if p.strip() and not p.strip().startswith(('frame-ancestors', 'report-uri', 'sandbox')))


def export(source, output, base_url, config):
    base_url = base_url.rstrip('/')
    parsed = urlsplit(base_url)
    if parsed.scheme not in {'https', 'http'} or not parsed.netloc or parsed.query or parsed.fragment:
        raise ValueError('Pass a complete base URL without query or fragment.')
    source, output = fs(source), fs(output)
    if output == source or source in output.parents or output in source.parents:
        raise ValueError('Source and output must be separate directories.')
    if output.exists() and any(output.iterdir()):
        raise ValueError('Output must be empty; choose a new output directory.')
    output.mkdir(parents=True, exist_ok=True)
    for file in source.rglob('*'):
        if not file.is_file() or file.name in {'.htaccess', 'CNAME'}:
            continue
        if file.is_symlink():
            raise ValueError('Symlinks are not supported: ' + str(file))
        dest = output / file.relative_to(source)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(file, dest)

    origin = config['source_origin'].rstrip('/')
    base_path = parsed.path.rstrip('/') + '/'
    for file in output.rglob('*.html'):
        text = file.read_text('utf-8')
        head, boundary, body = text.partition('</head>')
        if not boundary:
            raise ValueError('HTML without head: ' + str(file))
        # Absolute URLs occur only in metadata; preserve the exact visible body.
        head = head.replace(origin + '/', base_url + '/')
        head = head.replace('<base href="/">', '<base href="' + html.escape(base_path, quote=True) + '">')
        relative = file.relative_to(output).as_posix()
        policy = config['jira_csp'] if relative == 'soporte/index.html' else config['site_csp']
        security = '<meta http-equiv="Content-Security-Policy" content="' + html.escape(meta_policy(policy), quote=True) + '"><meta name="referrer" content="strict-origin-when-cross-origin">'
        head = head.replace('<meta charset="utf-8">', '<meta charset="utf-8">' + security, 1)
        write(file, head + boundary + body)

    for old, new in config['redirects']['pages'].items():
        page_file = target(source, new + 'index.html')
        text = page_file.read_text('utf-8')
        title = re.search(r'<title>(.*?)</title>', text, re.S)[1]
        description = re.search(r'<meta name="description" content="(.*?)">', text, re.S)[1]
        label = title.removesuffix(' | Creangel')
        href = posixpath.relpath(new.lstrip('/') or '.', old.strip('/') or '.')
        if not href.endswith('/'):
            href += '/'
        markup = ('<!doctype html><html lang="es-CO"><head><meta charset="utf-8">'
                  '<meta http-equiv="Content-Security-Policy" content="' + html.escape(meta_policy(config['site_csp']), quote=True) + '">'
                  '<meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + '</title>'
                  '<meta name="description" content="' + description + '"><meta name="robots" content="noindex,follow">'
                  '<link rel="canonical" href="' + html.escape(public_url(base_url, new), quote=True) + '">'
                  '<meta http-equiv="refresh" content="0;url=' + html.escape(href, quote=True) + '"></head>'
                  '<body><h1>' + label + '</h1><p><a href="' + html.escape(href, quote=True) + '">Continuar a la página</a></p></body></html>')
        write(target(output, old + 'index.html'), markup)

    for old, new in config['redirects']['media'].items():
        src, dest = target(source, new), target(output, old)
        if dest.exists() and dest.read_bytes() != src.read_bytes():
            raise ValueError('Historical resource collision: ' + old)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
    for name in ['sitemap.xml', 'robots.txt']:
        write(output / name, (source / name).read_text('utf-8').replace(origin + '/', base_url + '/'))
    write(output / '.nojekyll', '')
    files = [f for f in output.rglob('*') if f.is_file()]
    total = sum(f.stat().st_size for f in files)
    if total >= 1_000_000_000 or any(f.stat().st_size >= 100_000_000 for f in files):
        raise ValueError('Export exceeds the distribution size budget.')
    report = {'base_url':base_url, 'canonical_pages':len(config['routes']),
              'page_aliases':len(config['redirects']['pages']),
              'historical_media_files':len(config['redirects']['media']),
              'files':len(files), 'bytes':total, 'largest_file_bytes':max(f.stat().st_size for f in files),
              'page_alias_behavior':'Static HTML refresh and fallback link; not HTTP 301.',
              'custom_response_headers':False, 'meta_csp':True}
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('public'))
    parser.add_argument('--output', type=Path, default=Path('_site'))
    parser.add_argument('--base-url', required=True)
    parser.add_argument('--config', type=Path, default=Path(__file__).with_name('config.json'))
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    report = export(args.source, args.output, args.base_url, json.loads(args.config.read_text('utf-8')))
    if args.report:
        write(args.report, json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps(report, ensure_ascii=False))
