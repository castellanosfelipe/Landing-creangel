"""Verify combined commercial website, Docusaurus documentation and Decap admin."""
import argparse, json, re, sys, os
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit, unquote

class Page(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.refs=[]; self.ids=set(); self.base=None
        self.feed(text)
    def handle_starttag(self, tag, attrs):
        attrs=dict(attrs)
        if attrs.get('id'): self.ids.add(attrs['id'])
        if tag=='base': self.base=attrs.get('href'); return
        for name in ['href', 'src', 'poster']:
            if attrs.get(name): self.refs.append(attrs[name])

def verify(root, base):
    root=root.resolve()
    if os.name=='nt' and not str(root).startswith('\\\\?\\'):
        root=Path('\\\\?\\'+str(root))
    errors=[]; refs=0
    mandatory=['index.html','en/index.html','documentacion/index.html','documentacion/en/index.html','admin/index.html','admin/config.yml','admin/decap-cms.js','site-manifest.json']
    for name in mandatory:
        if not (root/name).is_file(): errors.append({'missing':name})
    parsed={p:Page(p.read_text('utf-8')) for p in root.rglob('*.html')}
    for p, page in parsed.items():
        route=p.relative_to(root).as_posix()
        if route.endswith('index.html'): route=route[:-10]
        context=urljoin(base+'/', route)
        if page.base: context=urljoin(context,page.base)
        for ref in page.refs:
            dest=urlsplit(urljoin(context,ref))
            if dest.scheme not in ['http','https'] or dest.netloc!=urlsplit(base).netloc: continue
            refs+=1
            relative=unquote(dest.path).lstrip('/')
            target=root/relative
            if target.is_dir(): target=target/'index.html'
            if not target.is_file(): errors.append({'file':str(p.relative_to(root)),'missing_link':ref})
            elif dest.fragment and target in parsed and unquote(dest.fragment) not in parsed[target].ids:
                errors.append({'file':str(p.relative_to(root)),'missing_fragment':ref})
    for name in ['.env','package.json','.git/config','admin/config.template.yml']:
        if (root/name).exists(): errors.append({'private_or_source_file':name})
    features=sum(p.read_text('utf-8').count('class="feature-item"') for p in root.glob('productos/*/index.html'))
    features+=sum(p.read_text('utf-8').count('class="feature-item"') for p in root.glob('plataforma/*/index.html'))
    if features!=1222: errors.append({'feature_count':features,'expected':1222})
    return {'passed':not errors,'html_pages':len(parsed),'internal_references':refs,'features_preserved':features,'errors':errors}

if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--root',type=Path,required=True); parser.add_argument('--base-url',required=True)
    args=parser.parse_args(); result=verify(args.root,args.base_url.rstrip('/'))
    print(json.dumps(result,ensure_ascii=False)); sys.exit(0 if result['passed'] else 1)
