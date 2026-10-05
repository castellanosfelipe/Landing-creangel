"""Check a Pages artifact: links, SEO, preservation and historical resources."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit, unquote
import argparse, hashlib, json, re
from export import fs, target


class Page(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.refs=[]; self.ids=set(); self.base=None; self.canonical=None
        self.lang=None; self.alternates={}; self.languages={}; self.language_switches=0
        self.feed(text)
    def handle_starttag(self, tag, attrs):
        values=dict(attrs)
        if tag=='html':self.lang=values.get('lang')
        if tag=='link' and values.get('rel')=='alternate':self.alternates[values.get('hreflang')]=values.get('href')
        if tag=='nav' and 'language-switch' in values.get('class','').split():self.language_switches+=1
        if tag=='a' and values.get('data-language'):self.languages[values['data-language']]=values.get('href')
        if values.get('id'):self.ids.add(values['id'])
        if tag=='base':self.base=values.get('href')
        if tag=='link' and values.get('rel')=='canonical':self.canonical=values.get('href')
        for name in ['href','src','poster','data-src']:
            if values.get(name) and tag!='base':self.refs.append(values[name])
        if values.get('srcset'):
            self.refs.extend(v.strip().split()[0] for v in values['srcset'].split(','))


def check(source, root, base_url, config):
    source, root=fs(source),fs(root)
    base_url=base_url.rstrip('/')+'/'
    base=urlsplit(base_url); parsed={};errors=[];count=0
    origin_changed=config['source_origin'].rstrip('/')+'/' != base_url
    for file in root.rglob('*.html'):
        parsed[file]=Page(file.read_text('utf-8'))
    for file, page in parsed.items():
        rel=file.relative_to(root).as_posix()
        route=rel.removesuffix('index.html') if rel.endswith('index.html') else rel
        url=urljoin(base_url,route)
        context=urljoin(url,page.base) if page.base else url
        for ref in page.refs:
            if ref.startswith(('data:','blob:','mailto:','tel:')):continue
            dest=urlsplit(urljoin(context,ref))
            if dest.netloc!=base.netloc or dest.scheme!=base.scheme:continue
            count+=1
            if not dest.path.startswith(base.path):
                errors.append({'code':'outside_prefix','file':rel,'reference':ref});continue
            relative=unquote(dest.path[len(base.path):])
            candidate=root/relative
            if candidate.is_dir():candidate=candidate/'index.html'
            if not candidate.is_file():
                errors.append({'code':'missing_target','file':rel,'reference':ref});continue
            if dest.fragment and candidate in parsed and unquote(dest.fragment) not in parsed[candidate].ids:
                errors.append({'code':'missing_fragment','file':rel,'reference':ref})
        if not page.canonical or not page.canonical.startswith(base_url):
            errors.append({'code':'canonical','file':rel})
    preserved=0
    for route in config['routes']:
        name=route.lstrip('/')+'index.html' if route.endswith('/') else route.lstrip('/')
        before=(source/name).read_text('utf-8').partition('</head>')[2]
        after=(root/name).read_text('utf-8').partition('</head>')[2]
        if before!=after:errors.append({'code':'body_changed','file':name})
        else:preserved+=1
        if origin_changed and config['source_origin']+'/' in (root/name).read_text('utf-8').partition('</head>')[0]:
            errors.append({'code':'old_metadata_origin','file':name})
        if config.get('localization'):
            page=parsed[root/name]
            english=route.startswith('/en/')
            spanish=route.removeprefix('/en') if english else route
            expected_lang='en' if english else 'es-CO'
            if page.lang!=expected_lang or page.language_switches!=1 or set(page.languages)!={'es','en'}:
                errors.append({'code':'language_controls','file':name})
            expected_alternates={'es-CO':base_url.rstrip('/')+spanish,
                                 'en':base_url.rstrip('/')+'/en'+spanish,
                                 'x-default':base_url.rstrip('/')+spanish}
            if page.alternates!=expected_alternates:errors.append({'code':'hreflang','file':name})
            context=urljoin(base_url.rstrip('/')+route,page.base) if page.base else base_url.rstrip('/')+route
            for code,href in page.languages.items():
                expected=base_url.rstrip('/')+('/en'+spanish if code=='en' else spanish)
                if urljoin(context,href)!=expected:errors.append({'code':'language_counterpart','file':name,'language':code})
    asset_count=0
    for file in source.rglob('*'):
        if file.is_file() and file.suffix not in {'.html','.xml','.txt'} and file.name!='.htaccess':
            copy=root/file.relative_to(source)
            if not copy.exists() or file.read_bytes()!=copy.read_bytes():
                errors.append({'code':'asset_changed','file':file.relative_to(source).as_posix()})
            asset_count+=1
    for old,new in config['redirects']['media'].items():
        if target(root,old).read_bytes()!=target(source,new).read_bytes():
            errors.append({'code':'historical_media_changed','path':old})
    for old,new in config['redirects']['pages'].items():
        file=target(root,old+'index.html')
        if file not in parsed or parsed[file].canonical!=base_url.rstrip('/')+new:
            errors.append({'code':'historical_page_missing','path':old})
    for name in ['sitemap.xml','robots.txt']:
        if origin_changed and config['source_origin']+'/' in (root/name).read_text('utf-8'):
            errors.append({'code':'old_metadata_origin','file':name})
    if parsed[root/'404.html'].base!=base.path:
        errors.append({'code':'404_base'})
    if not (root/'.nojekyll').exists() or (root/'.htaccess').exists():
        errors.append({'code':'pages_distribution_files'})
    report={'passed':not errors,'base_url':base_url,'html_files':len(parsed),'references_checked':count,
            'exact_bodies_preserved':preserved,'unchanged_assets':asset_count,
            'historical_media_files':len(config['redirects']['media']),
            'historical_page_aliases':len(config['redirects']['pages']),
            'bilingual_pages':len(config['routes']) if config.get('localization') else 0,'errors':errors}
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,default=Path('public'))
    parser.add_argument('--site-root',type=Path,default=Path('_site'))
    parser.add_argument('--base-url',required=True)
    parser.add_argument('--config',type=Path,default=Path(__file__).with_name('config.json'))
    parser.add_argument('--report',type=Path)
    args=parser.parse_args()
    report=check(args.source,args.site_root,args.base_url,json.loads(args.config.read_text('utf-8')))
    if args.report:args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2),'utf-8')
    print(json.dumps(report,ensure_ascii=False));raise SystemExit(0 if report['passed'] else 1)
