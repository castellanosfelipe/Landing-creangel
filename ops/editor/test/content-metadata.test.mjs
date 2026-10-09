import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import YAML from 'yaml';
import {Content} from '../content.mjs';

const fields={id:'overview',title:'Overview',description:'Product documentation',sidebar_position:1,slug:'/'};
const document=(values=fields,body='Original content.\n')=>'---\n'+YAML.stringify(values)+'---\n\n'+body;
const content=new Content('.',()=>{});
const docsRequire=createRequire(new URL('../../../documentation/package.json',import.meta.url));
const {readVersionDocs}=docsRequire('@docusaurus/plugin-content-docs/lib/docs.js');

test('Decap YAML wrapping, multiline content and normal punctuation preserve all metadata',()=>{
  const descriptions=[
    'Documentación para configurar una plataforma completa y gestionar la información que necesitan los usuarios y equipos de trabajo para realizar sus actividades de forma eficiente y colaborativa.',
    'Primera línea de la descripción.\nSegunda línea de la descripción.',
    'Auth & IAM: roles [RBAC], permisos * y políticas. ¡Comience aquí!',
  ];
  for(const title of [
    'Introducción y configuración de Auth & IAM',
    '¿Qué significa [RBAC]?',
    '¡Bienvenido!',
    'Introducción: cómo configurar los productos y servicios de la plataforma IFINDIT para la búsqueda empresarial y la analítica de datos',
    'Primera línea\nSegunda línea',
  ])for(const description of descriptions) {
    const values={...fields,title,description};
    assert.deepEqual({...content.metadata(document(values))},values);
  }
});

test('metadata rejects unsupported YAML structures, tags, aliases and invalid scalar types',()=>{
  const base=YAML.stringify(fields);
  for(const front of [
    base+'title: Repeated title\n',
    base+'unknown: Field\n',
    base.replace('title: Overview','title: &title Overview'),
    base.replace('title: Overview','title: &title Overview').replace('description: Product documentation','description: *title'),
    base.replace('title: Overview','title: !custom Overview'),
    base.replace('title: Overview','title: !!str Overview'),
    base.replace('title: Overview','!!str title: Overview'),
    '!!map\n'+base,
    '[one, two]\n',
    'Plain string\n',
    base.replace('title: Overview','title: {nested: Object}'),
    base.replace('title: Overview','title: [one, two]'),
    base.replace('title: Overview','title: null'),
    base.replace('title: Overview','title: true'),
    base.replace('title: Overview','title: 123'),
    base.replace('title: Overview','title: "  "'),
    base.replace('description: Product documentation\n',''),
    base.replace('sidebar_position: 1','sidebar_position: .inf'),
    base.replace('sidebar_position: 1','sidebar_position: .nan'),
    base.replace('sidebar_position: 1','sidebar_position: -1'),
    base.replace('sidebar_position: 1','sidebar_position: 0'),
    base.replace('sidebar_position: 1','sidebar_position: 1.5'),
    base.replace('sidebar_position: 1','sidebar_position: "1"'),
    base.replace('sidebar_position: 1','sidebar_position: 9007199254740992'),
    base.replace('slug: /','slug: //other.example'),
  ])assert.throws(()=>content.metadata('---\n'+front+'---\nText'),{status:400},front);
});

test('metadata reserves the English locale prefix without blocking other routes',()=>{
  for(const slug of ['/en','/en/guide','/en/productos/ifindit-search']) {
    assert.throws(()=>content.metadata(document({...fields,slug})),error=>error.status===400&&/reservado para la versión en inglés/.test(error.message));
  }
  for(const slug of ['/','/engineering','/guides/en'])assert.equal(content.metadata(document({...fields,slug})).slug,slug);
});

test('Markdown inline and block examples remain editable while HTML and unsafe links are rejected',()=>{
  for(const body of [
    'Use `<example>` and `javascript:example()` as text examples.',
    '```html\n<script>alert(1)</script>\n```\n',
    '````js\nimport example from "./example";\nexport const html = "<script>";\n````\n',
    '~~~md\n[unsafe](javascript:example())\n~~~\n',
    '    <script>an indented example</script>\n',
    'An autolink <https://portal.creangel.com/> and [website](https://portal.creangel.com/).',
    'Escaped \\<script> is literal text. The javascript: URL scheme is not allowed in links.',
  ])assert.doesNotThrow(()=>content.metadata(document(fields,body)),body);
  for(const body of [
    '<script>alert(1)</script>',
    '<img src="x" onerror="alert(1)">',
    '<!-- hidden HTML -->',
    '[unsafe](javascript:alert)',
    '[unsafe](java&#x73;cript:alert)',
    '![unsafe](data:image/png;base64,AA)',
    '[unsafe][ref]\n\n[ref]: vbscript:example',
    'import example from "./example";',
    'export const x = 1;',
    '`<example>`\n\n<script>alert(1)</script>',
  ])assert.throws(()=>content.metadata(document(fields,body)),{status:400},body);
});

test('duplicate document routes fail before writing; translations share routes and stable URLs remain enforced',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'creangel-route-validation-'));
  t.after(async()=>{
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'creangel-route-validation-'));
    await fs.rm(root,{recursive:true,force:true});
  });
  const es='documentation/docs',en='documentation/i18n/en/docusaurus-plugin-content-docs/current';
  await fs.mkdir(path.join(root,es),{recursive:true});
  await fs.mkdir(path.join(root,en),{recursive:true});
  await fs.mkdir(path.join(root,'public/multimedia/documentacion'),{recursive:true});
  const audit=[];
  const service=new Content(root,(...event)=>audit.push(event));
  const save=async(folder,values,body)=>{
    const name=folder+'/'+values.id+'.md';let baseRevision=null;
    try {baseRevision=(await service.entry(name)).file.id;}catch(error) {if(error.status!==404)throw error;}
    return service.request('persistEntry',{dataFiles:[{path:name,raw:document(values,body),baseRevision}]},{username:'test-editor'});
  };
  await save(es,fields);
  const collision={...fields,id:'another'};
  await assert.rejects(save(es,collision),error=>error.status===409&&/ruta ya está usada/.test(error.message));
  await assert.rejects(fs.stat(path.join(root,es,'another.md')),{code:'ENOENT'});
  assert.equal(audit.length,1);
  await save(en,fields);
  await save(es,{...collision,slug:'/another'});
  await save(en,{...collision,slug:'/another'});
  const revised={...fields,title:'Auth & IAM',description:'Primera línea\nSegunda línea'};
  const raw=document(revised,'Use `<example>` as a literal example.');
  await save(es,revised,'Use `<example>` as a literal example.');
  assert.equal(await fs.readFile(path.join(root,es,'overview.md'),'utf8'),raw);
  await assert.rejects(save(es,{...fields,slug:'/changed'}),{status:409});
  assert.equal(await fs.readFile(path.join(root,es,'overview.md'),'utf8'),raw);
});

test('English documents must match a Spanish original; effective English fallback routes stay unique',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'creangel-translation-validation-'));
  t.after(async()=>{
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'creangel-translation-validation-'));
    await fs.rm(root,{recursive:true,force:true});
  });
  const es='documentation/docs',en='documentation/i18n/en/docusaurus-plugin-content-docs/current';
  await fs.mkdir(path.join(root,es),{recursive:true});
  await fs.mkdir(path.join(root,en),{recursive:true});
  await fs.mkdir(path.join(root,'public/multimedia/documentacion'),{recursive:true});
  const audit=[];
  const service=new Content(root,(...event)=>audit.push(event));
  const save=async(folder,values)=>{
    const name=folder+'/'+values.id+'.md';let baseRevision=null;
    try {baseRevision=(await service.entry(name)).file.id;}catch(error) {if(error.status!==404)throw error;}
    return service.request('persistEntry',{dataFiles:[{path:name,raw:document(values),baseRevision}]},{username:'test-editor'});
  };
  const original={...fields,id:'guide',slug:'/guides/guide'};
  await assert.rejects(save(en,original),error=>error.status===409&&/primero el documento en español/.test(error.message));
  await assert.rejects(fs.stat(path.join(root,en,'guide.md')),{code:'ENOENT'});
  assert.equal(audit.length,0);
  await save(es,original);
  await assert.rejects(save(en,{...original,slug:'/english-only-route'}),error=>error.status===409&&/mismo identificador y ruta/.test(error.message));
  await assert.rejects(fs.stat(path.join(root,en,'guide.md')),{code:'ENOENT'});
  await save(en,{...original,title:'English guide'});

  // A legacy translation may have a different route; new Spanish fallback
  // content must not duplicate that route in the resulting English site.
  const legacy={...fields,id:'legacy',slug:'/spanish-legacy'};
  await fs.writeFile(path.join(root,es,'legacy.md'),document(legacy));
  await fs.writeFile(path.join(root,en,'legacy.md'),document({...legacy,slug:'/occupied-in-english'}));
  const addition={...fields,id:'addition',slug:'/occupied-in-english'};
  await assert.rejects(save(es,addition),error=>error.status===409&&/ruta ya está usada.*inglés/.test(error.message));
  await assert.rejects(fs.stat(path.join(root,es,'addition.md')),{code:'ENOENT'});
  await save(es,{...addition,slug:'/untranslated'});
  assert.equal(audit.length,3);
});

test('installed Docusaurus discovers Spanish filenames and uses English translations or Spanish fallback',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'creangel-docs-locale-discovery-'));
  t.after(async()=>{
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'creangel-docs-locale-discovery-'));
    await fs.rm(root,{recursive:true,force:true});
  });
  const contentPath=path.join(root,'es'),contentPathLocalized=path.join(root,'en');
  await fs.mkdir(contentPath);await fs.mkdir(contentPathLocalized);
  await fs.writeFile(path.join(contentPath,'overview.md'),document(fields,'Contenido original.'));
  await fs.writeFile(path.join(contentPath,'fallback.md'),document({...fields,id:'fallback',slug:'/fallback'},'Sin traducción.'));
  await fs.writeFile(path.join(contentPathLocalized,'overview.md'),document(fields,'Translated content.'));
  await fs.writeFile(path.join(contentPathLocalized,'english-only.md'),document({...fields,id:'english-only',slug:'/english-only'},'Not discovered.'));
  const docs=await readVersionDocs({contentPath,contentPathLocalized},{include:['**/*.md'],exclude:[]});
  assert.deepEqual(docs.map(doc=>doc.source).sort(),['fallback.md','overview.md']);
  assert.match(docs.find(doc=>doc.source==='overview.md').content,/Translated content/);
  assert.match(docs.find(doc=>doc.source==='fallback.md').content,/Sin traducción/);
});
