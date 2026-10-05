"""Build the English counterpart of every Spanish page from a saved catalogue.

Standard library only. No translation service or model runs on the website.
Original media and external integrations are shared between both languages.
"""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit, urlunsplit
import argparse, hashlib, html, json, posixpath, re
import xml.etree.ElementTree as ET
from export import fs, write

TRANSLATABLE = {'alt', 'aria-label', 'aria-description', 'placeholder', 'title',
    'data-title', 'data-alt', 'data-category-name', 'data-search-description', 'data-search'}
METADATA = {'description', 'og:title', 'og:description', 'twitter:title', 'twitter:description'}
NORMAL = lambda value: re.sub(r'\s+', ' ', value).strip()

class Localizer(HTMLParser):
    def __init__(self, text, route, context):
        super().__init__(convert_charrefs=True)
        self.source, self.route, self.context = text, route, context
        self.lines = [0]
        self.lines += [match.end() for match in re.finditer('\n', text)]
        self.changes, self.stack = [], []
    def position_offset(self):
        line, column = self.getpos()
        return self.lines[line-1] + column
    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag in ('script','style','pre','code'): self.stack.append((tag, values))
        raw = self.get_starttag_text()
        def replace(match):
            key, quote, encoded = match.group(1).lower(), match.group(2), match.group(3)
            value = html.unescape(encoded)
            if key in TRANSLATABLE:
                value = self.context.translate(value)
            elif key == 'content' and tag == 'meta':
                if values.get('name',values.get('property')) in METADATA:
                    value = self.context.translate(value)
                elif values.get('property') == 'og:locale': value = 'en_US'
                elif values.get('property') == 'og:url': value = self.context.origin + '/en' + self.route
            elif tag == 'html' and key == 'lang': value = 'en'
            elif tag == 'link' and values.get('rel') == 'canonical' and key == 'href':
                value = self.context.origin + '/en' + self.route
            elif key in ('href','src','poster','data-src') and tag != 'base':
                value = self.context.link(value, self.route)
            elif key == 'srcset':
                value = ', '.join(self.context.link(x.strip().split()[0],self.route) +
                                  (' '+x.strip().split()[1] if len(x.strip().split())>1 else '')
                                  for x in value.split(','))
            return match.group(1)+'='+quote+html.escape(value,quote=True)+quote
        changed = re.sub(r'([\w:-]+)\s*=\s*([\"\'])(.*?)\2', replace, raw, flags=re.S)
        if changed != raw: self.changes.append((self.position_offset(),len(raw),changed))
    def handle_startendtag(self, tag, attrs): self.handle_starttag(tag, attrs)
    def handle_endtag(self, tag):
        if self.stack and self.stack[-1][0] == tag: self.stack.pop()
    def handle_data(self, data):
        if self.stack:
            tag, values = self.stack[-1]
            if tag == 'script' and values.get('type') == 'application/ld+json':
                record = json.loads(data)
                for key in ('name','description'):
                    if key in record: record[key] = self.context.translate(record[key])
                record['inLanguage'] = 'en'
                record['url'] = self.context.origin + '/en' + self.route
                changed = json.dumps(record,ensure_ascii=False).replace('<','\\u003c')
            elif values.get('id') == 'searchIndex':
                # Filled from the completed English pages, including full feature descriptions.
                changed = data
            else: return
        else:
            value = NORMAL(html.unescape(data))
            if not value: return
            changed = data[:len(data)-len(data.lstrip())] + html.escape(self.context.translate(value)) + data[len(data.rstrip()):]
        start=self.position_offset()
        end=self.source.find('<',start)
        if end<0:end=len(self.source)
        raw=self.source[start:end]
        if changed != raw: self.changes.append((start,len(raw),changed))
    def handle_entityref(self,name): pass
    def handle_charref(self,name): pass
    def result(self):
        result = self.source
        for offset,length,value in sorted(self.changes,reverse=True):
            result = result[:offset]+value+result[offset+length:]
        return result

class PageText(HTMLParser):
    def __init__(self,text):
        super().__init__(convert_charrefs=True)
        self.in_main,self.skip,self.parts= False,0,[]
        self.feed(text)
    def handle_starttag(self,tag,attrs):
        if tag == 'main': self.in_main=True
        if tag in ('style','script'):self.skip+=1
        if self.in_main:
            values=dict(attrs)
            if values.get('data-search-description'):self.parts.append(values['data-search-description'])
    def handle_endtag(self,tag):
        if tag == 'main': self.in_main=False
        if tag in ('style','script'):self.skip-=1
    def handle_data(self,data):
        if self.in_main and not self.skip and NORMAL(data):self.parts.append(NORMAL(data))

class Context:
    def __init__(self,config,catalog):
        self.origin=config['source_origin'].rstrip('/')
        self.routes=set(config.get('localization',{}).get('spanish_routes',config['routes']))
        self.aliases=config['redirects']['pages']
        self.catalog=catalog
    def translate(self,value):
        key=NORMAL(value)
        if not key or not re.search('[A-Za-zÁÉÍÓÚÑáéíóúñ]',key):return key
        if key not in self.catalog:raise ValueError('Missing English translation: '+key[:160])
        return self.catalog[key]
    def link(self,href,route):
        if not href or href.startswith(('#','data:','mailto:','tel:','blob:')):return href
        parsed=urlsplit(urljoin(self.origin+route,href))
        if parsed.netloc!=urlsplit(self.origin).netloc:return href
        path=parsed.path
        canonical=path.removesuffix('index.html') if path.endswith('/index.html') else path
        if canonical not in self.routes and canonical+'/' in self.routes:canonical+='/'
        canonical=self.aliases.get(canonical,canonical)
        if canonical in self.routes:path='/en'+canonical
        if path in ('/diagramas/ifindit-platform.svg','/diagramas/ifindit-platform-mobile.svg'):
            path='/en'+path
        current='/' if route=='/404.html' else '/en'+route
        relative=posixpath.relpath(path,posixpath.dirname(current.rstrip('/')+'/index.html') if current.endswith('/') else posixpath.dirname(current))
        if path.endswith('/') and not relative.endswith('/'):relative+='/'
        if relative=='./':relative='./'
        return urlunsplit(('', '', relative, parsed.query, parsed.fragment))

def counterpart(route,language):return '/en'+route if language=='en' else route

def switch(route,language):
    current='/' if route=='/404.html' else counterpart(route,language)
    directory=current if current.endswith('/') else posixpath.dirname(current)+'/'
    links=[]
    for code,label in (('es','ES'),('en','EN')):
        dest=counterpart(route,code)
        href=posixpath.relpath(dest,directory)
        if dest.endswith('/') and not href.endswith('/'):href+='/'
        if language=='en': aria='View this page in '+('Spanish' if code=='es' else 'English')
        else:aria='Ver esta página en '+('español' if code=='es' else 'inglés')
        links.append('<a href="'+href+'" lang="'+code+'" hreflang="'+('es-CO' if code=='es' else 'en')+'" data-language="'+code+'" aria-label="'+aria+'"'+(' aria-current="page"' if code==language else '')+'>'+label+'</a>')
    return '<nav class="language-switch" aria-label="'+('Language' if language=='en' else 'Idioma')+'">'+links[0]+'<span aria-hidden="true">/</span>'+links[1]+'</nav>'

def clean_page(text):
    text=re.sub(r'<nav class="language-switch".*?</nav>','',text,flags=re.S)
    return re.sub(r'<link rel="alternate" hreflang="(?:es-CO|en|x-default)" href="[^"]*">','',text)

def decorate(text,route,language,origin,versions):
    alternatives=''.join('<link rel="alternate" hreflang="'+code+'" href="'+origin+dest+'">'
        for code,dest in (('es-CO',route),('en','/en'+route),('x-default',route)))
    text=text.replace('</head>',alternatives+'</head>',1)
    needle='<button class="mobile-toggle"'
    assert text.count(needle)==1
    text=text.replace(needle,switch(route,language)+needle,1)
    for name,token in versions.items():
        text=re.sub(r'('+re.escape(name)+r'\?v=)[0-9a-f]{12}',lambda m:m[1]+token,text)
    return text

def localize(public,config_path,catalog_path):
    public=fs(public)
    config=json.loads(config_path.read_text('utf-8'))
    catalog=json.loads(catalog_path.read_text('utf-8'))['translations']
    context=Context(config,catalog)
    routes=config.get('localization',{}).get('spanish_routes',config['routes'])
    versions={name:hashlib.sha256((public/name).read_bytes()).hexdigest()[:12]
              for name in ('assets/site.css','assets/site.js')}
    generated={}
    for route in routes:
        filename=route.lstrip('/')+'index.html' if route.endswith('/') else route.lstrip('/')
        text=clean_page((public/filename).read_text('utf-8'))
        parser=Localizer(text,route,context);parser.feed(text)
        generated[route]=decorate(parser.result(),route,'en',context.origin,versions)
        write(public/filename,decorate(text,route,'es',context.origin,versions))
    search=json.loads(re.search(r'<script id="searchIndex" type="application/json">(.*?)</script>',generated['/buscar/'],re.S)[1])
    for row in search:
        original=urlsplit(urljoin(context.origin+'/buscar/',row['href'])).path
        row.update({key:context.translate(row[key]) for key in ('title','description','type')})
        row['href']=context.link(row['href'],'/buscar/')
        row['keywords']=' '.join(PageText(generated[original]).parts)
    encoded=json.dumps(search,ensure_ascii=False).replace('<','\\u003c')
    generated['/buscar/']=re.sub(r'(<script id="searchIndex" type="application/json">).*?(</script>)',lambda m:m[1]+encoded+m[2],generated['/buscar/'],flags=re.S)
    for route,text in generated.items():
        filename='en/'+(route.lstrip('/')+'index.html' if route.endswith('/') else route.lstrip('/'))
        write(public/filename,text)
    for svg in (public/'diagramas').glob('*.svg'):
        text=svg.read_text('utf-8');parser=Localizer(text,'/',context);parser.feed(text)
        write(public/'en/diagramas'/svg.name,parser.result())
    NS='http://www.sitemaps.org/schemas/sitemap/0.9';XHTML='http://www.w3.org/1999/xhtml'
    ET.register_namespace('',NS);ET.register_namespace('xhtml',XHTML)
    sitemap=ET.parse(public/'sitemap.xml').getroot()
    base_entries=[item for item in sitemap if '/en/' not in item.find('{'+NS+'}loc').text]
    result=ET.Element('{'+NS+'}urlset')
    for item in base_entries:
        route=item.find('{'+NS+'}loc').text.removeprefix(context.origin)
        for localized in (route,'/en'+route):
            entry=ET.SubElement(result,'{'+NS+'}url')
            ET.SubElement(entry,'{'+NS+'}loc').text=context.origin+localized
            for code,alternate in (('es-CO',route),('en','/en'+route),('x-default',route)):
                ET.SubElement(entry,'{'+XHTML+'}link',{'rel':'alternate','hreflang':code,'href':context.origin+alternate})
    write(public/'sitemap.xml',ET.tostring(result,encoding='unicode',xml_declaration=True))
    config['localization']={'default_language':'es','languages':['es-CO','en'],'english_prefix':'/en/','spanish_routes':routes}
    config['routes']=routes+['/en'+route for route in routes]
    config_path.write_text(json.dumps(config,ensure_ascii=False,indent=2)+'\n','utf-8',newline='\n')
    return {'spanish_pages':len(routes),'english_pages':len(generated),'language_switches':len(routes)*2,'english_diagrams':2}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,default=Path('public'))
    args=parser.parse_args()
    print(json.dumps(localize(args.source,Path(__file__).with_name('config.json'),Path(__file__).parent/'i18n/en.json')))
