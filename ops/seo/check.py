"""Fail production builds for SEO regressions; emit a full canonical page inventory."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit, unquote
from xml.etree import ElementTree as ET
from collections import Counter, deque
import argparse, json, re, os

REPO = Path(__file__).resolve().parents[2]

class Page(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.meta={}; self.canonical=[]; self.alternates={}; self.refs=[]; self.links=[]
        self.title=''; self.h1=[]; self.main_count=0; self.capture=None; self.schemas=[]
        self.base=None; self.lang=None; self.head=False; self.images=[]
        self.feed(text)
    def handle_starttag(self,t,attrs):
        a=dict(attrs)
        if t=='head': self.head=True
        if t=='html': self.lang=a.get('lang')
        if t=='base': self.base=a.get('href')
        if t=='main': self.main_count+=1
        if t=='h1': self.h1.append(''); self.capture='h1'
        if t=='title' and self.head: self.capture='title'
        if t=='script' and a.get('type')=='application/ld+json': self.capture='schema'; self.schema_text=''
        if t=='meta': self.meta.setdefault(a.get('name') or a.get('property'),[]).append(a.get('content',''))
        if t=='link' and a.get('rel')=='canonical': self.canonical.append(a.get('href'))
        if t=='link' and a.get('rel')=='alternate': self.alternates[a.get('hreflang')]=a.get('href')
        if t=='a' and a.get('href'): self.links.append(a['href'])
        for k in ('href','src','poster'):
            if a.get(k) and t!='base': self.refs.append(a[k])
        if a.get('srcset'): self.refs.extend(x.strip().split()[0] for x in a['srcset'].split(','))
        if t=='img': self.images.append(a)
    def handle_data(self,data):
        if self.capture=='title': self.title+=data
        if self.capture=='h1': self.h1[-1]+=data
        if self.capture=='schema': self.schema_text+=data
    def handle_endtag(self,t):
        if t=='head': self.head=False
        if t==self.capture: self.capture=None
        if t=='script' and self.capture=='schema':
            try: self.schemas.append(json.loads(self.schema_text))
            except ValueError: self.schemas.append({'invalid_json':True})
            self.capture=None
    def value(self,key): return (self.meta.get(key) or [''])[0]

def nodes(page):
    return [n for schema in page.schemas for n in schema.get('@graph',[schema])]

def check(root, base):
    root=root.resolve(); base=base.rstrip('/')
    if os.name=='nt' and not str(root).startswith('\\\\?\\'): root=Path('\\\\?\\'+str(root))
    config=json.loads((REPO/'.pages/config.json').read_text('utf-8'))
    routes=list(config['routes'])
    for file in (root/'documentacion').rglob('*.html'):
        route='/'+file.relative_to(root).as_posix().removesuffix('index.html')
        if '/404' not in route: routes.append(route)
    parsed={}; errors=[]; inventory=[]; types=Counter(); graph={}; checked_refs=0
    for route in routes:
        name=route.lstrip('/')+'index.html' if route.endswith('/') else route.lstrip('/')
        p=root/name
        if not p.is_file(): errors.append({'route':route,'error':'missing_page'}); continue
        page=Page(p.read_text('utf-8')); parsed[route]=page
        expected=base+route; context=urljoin(expected,page.base) if page.base else expected
        if page.canonical!=[expected]: errors.append({'route':route,'error':'canonical','value':page.canonical})
        if len(page.h1)!=1 or page.main_count!=1: errors.append({'route':route,'error':'main_h1'})
        indexable='noindex' not in page.value('robots')
        for key in ('description','og:title','og:description','og:url','og:image','twitter:card','twitter:image',
                    'twitter:title','twitter:description','og:image:alt','og:image:width','og:image:height'):
            if len(page.meta.get(key,[]))!=1 or not page.value(key): errors.append({'route':route,'error':'metadata','key':key})
        if page.value('og:url')!=expected: errors.append({'route':route,'error':'og_url'})
        if not page.alternates: errors.append({'route':route,'error':'missing_hreflang'})
        for n in nodes(page):
            if n.get('invalid_json'): errors.append({'route':route,'error':'invalid_jsonld'})
            kind=n.get('@type')
            if kind in ('WebPage','ContactPage','AboutPage') and n.get('url')!=expected:
                errors.append({'route':route,'error':'schema_page_url','value':n.get('url')})
            for typ in kind if isinstance(kind,list) else [kind]:
                if typ: types[typ]+=1
            if any(k in n for k in ('aggregateRating','review','offers')): errors.append({'route':route,'error':'unsupported_commercial_schema'})
        if not any(n.get('@type')=='Organization' for n in nodes(page)): errors.append({'route':route,'error':'missing_organization'})
        if not any(n.get('@type') in ('WebPage','ContactPage','AboutPage') for n in nodes(page)): errors.append({'route':route,'error':'missing_webpage'})
        graph[route]=[]
        for ref in page.refs+[page.value('og:image'),page.value('twitter:image')]:
            dest=urlsplit(urljoin(context,ref))
            if dest.scheme not in ('http','https') or dest.netloc!=urlsplit(base).netloc: continue
            checked_refs+=1; target=root/unquote(dest.path).lstrip('/')
            if target.is_dir(): target=target/'index.html'
            if not target.is_file(): errors.append({'route':route,'error':'missing_resource','reference':ref})
        for link in page.links:
            dest=urlsplit(urljoin(context,link))
            if dest.netloc==urlsplit(base).netloc and dest.path in routes: graph[route].append(dest.path)
        for image in page.images:
            if 'alt' not in image or not image.get('width') or not image.get('height'):
                errors.append({'route':route,'error':'image_attributes','src':image.get('src')})
        inventory.append({'route':route,'url':expected,'language':page.lang,'title':page.title,'description':page.value('description'),
                          'title_chars':len(page.title),'description_chars':len(page.value('description')),
                          'robots':page.value('robots') or 'index,follow (default)','indexable':indexable,
                          'h1':page.h1,'schema_types':[n.get('@type') for n in nodes(page)],
                          'responsive_images':sum('srcset' in image for image in page.images)})
    indexable={row['url'] for row in inventory if row['indexable']}
    sitemap=ET.parse(root/'sitemap.xml').getroot()
    locations=[n.text for n in sitemap.iter('{http://www.sitemaps.org/schemas/sitemap/0.9}loc')]
    if set(locations)!=indexable or len(locations)!=len(set(locations)):
        errors.append({'error':'sitemap_indexable_mismatch','missing':sorted(indexable-set(locations)),'unexpected':sorted(set(locations)-indexable)})
    for value,count in Counter(row['title'] for row in inventory if row['indexable']).items():
        if count>1: errors.append({'error':'duplicate_title','value':value,'count':count})
    for row in inventory:
        route=row['route']; page=parsed[route]
        for code,dest in page.alternates.items():
            if code=='x-default': continue
            match=urlsplit(dest).path
            if match not in parsed: errors.append({'route':route,'error':'hreflang_target','target':dest}); continue
            if base+route not in parsed[match].alternates.values(): errors.append({'route':route,'error':'nonreciprocal_hreflang','target':dest})
    depth={'/':0}; queue=deque(['/'])
    while queue:
        current=queue.popleft()
        for target in graph.get(current,[]):
            if target not in depth: depth[target]=depth[current]+1; queue.append(target)
    for row in inventory: row['navigation_depth']=depth.get(row['route'])
    orphans=[r['route'] for r in inventory if r['indexable'] and r['navigation_depth'] is None]
    if orphans: errors.append({'error':'orphan_pages','routes':orphans})
    robots=(root/'robots.txt').read_text('utf-8')
    if 'Sitemap: '+base+'/sitemap.xml' not in robots: errors.append({'error':'robots_sitemap'})
    return {'passed':not errors,'canonical_pages':len(inventory),'indexable_pages':len(indexable),'sitemap_urls':len(locations),
            'internal_references':checked_refs,'orphan_pages':orphans,'max_navigation_depth':max(depth.values(),default=0),
            'jsonld_types':dict(types),'errors':errors,'pages':inventory}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--base-url',required=True);p.add_argument('--report',type=Path)
    a=p.parse_args();result=check(a.root,a.base_url)
    if a.report: a.report.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in result.items() if k!='pages'},ensure_ascii=False));raise SystemExit(0 if result['passed'] else 1)
