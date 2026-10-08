import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import YAML from 'yaml';
import {Scalar,YAMLMap} from 'yaml/types';
import {fromMarkdown} from 'mdast-util-from-markdown';
import {fail} from './security.mjs';
import {markdownImages} from './markdown-images.mjs';
const folders=['documentation/docs','documentation/i18n/en/docusaurus-plugin-content-docs/current'];
const media='public/multimedia/documentacion';
const imagePattern=/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:png|jpe?g|webp|avif|gif)$/i;
const sha=data=>createHash('sha256').update(data).digest('hex');
const types={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',avif:'image/avif',gif:'image/gif'};

export class Content {
  constructor(root,audit,siteOrigin='https://portal.creangel.com') {this.root=path.resolve(root);this.audit=audit;this.siteOrigin=new URL(siteOrigin).origin;this.chain=Promise.resolve();}
  async safe(name,kind='doc') {
    if(typeof name!=='string'||name.includes('\\')||name.includes('\0')||name.split('/').some(p=>p==='.'||p==='..'))fail(400,'Ruta inválida.');
    const valid=kind==='doc'?folders.some(folder=>name.startsWith(folder+'/')&&/^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(name.slice(folder.length+1))):name.startsWith(media+'/')&&imagePattern.test(name.slice(media.length+1));
    if(!valid)fail(403,'Solo se permite editar documentación e imágenes autorizadas.');
    const resolved=path.resolve(this.root,name);
    const realRoot=await fs.realpath(this.root);
    let current=this.root;
    for(const part of name.split('/')) {
      current=path.join(current,part);
      try {if((await fs.lstat(current)).isSymbolicLink())fail(403,'No se permiten enlaces simbólicos.');}
      catch(error) {if(error.code==='ENOENT')continue;throw error;}
    }
    const parent=await fs.realpath(path.dirname(resolved));
    if(parent!==realRoot&&!parent.startsWith(realRoot+path.sep))fail(403,'Ruta fuera del contenido autorizado.');
    return resolved;
  }
  metadata(raw,{validateBody=true}={}) {
    const front=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
    if(!front)fail(400,'El documento debe conservar sus metadatos iniciales.');
    // Decap serializes wrapped and multiline YAML. Inspect its syntax tree before
    // converting values so normal punctuation is accepted without allowing tags,
    // aliases, nested objects, duplicate fields or implicit non-string content.
    const document=YAML.parseDocument(front[1],{version:'1.2',schema:'core',customTags:[],prettyErrors:false});
    if(document.errors.length||document.warnings.length||!(document.contents instanceof YAMLMap)||document.contents.tag||document.anchors.getNames().length)fail(400,'Metadatos de documento inválidos.');
    const values=Object.create(null);
    for(const pair of document.contents.items) {
      const key=pair.key,value=pair.value;
      if(!(key instanceof Scalar)||key.tag||!(value instanceof Scalar)||value.tag||!['id','title','description','sidebar_position','slug'].includes(key.value)||Object.hasOwn(values,key.value))fail(400,'Metadatos de documento inválidos.');
      values[key.value]=value.value;
    }
    if(['id','title','description','slug'].some(key=>typeof values[key]!=='string'||!values[key].trim())||!Number.isSafeInteger(values.sidebar_position)||values.sidebar_position<1||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values.id)||!/^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*)?$/.test(values.slug))fail(400,'Identificador, ruta, título, descripción u orden inválido.');
    // The English site is published under /documentacion/en/. A Spanish route
    // beginning with /en would otherwise overwrite that locale's generated files.
    if(/^\/en(?:\/|$)/.test(values.slug))fail(400,'El prefijo /en está reservado para la versión en inglés. Elija otra ruta para el documento.');
    if(validateBody) {
      const body=raw.slice(front[0].length),examples=[];
      const unsafe=()=>fail(400,'Use texto Markdown; no se permite código ejecutable ni HTML.');
      function visit(node) {
        if(['code','inlineCode'].includes(node.type)){examples.push([node.position.start.offset,node.position.end.offset]);return;}
        if(node.type==='html'||(typeof node.url==='string'&&/^(?:javascript|data|vbscript):/i.test(node.url.replace(/[\u0000-\u0020]/g,''))))unsafe();
        for(const child of node.children||[])visit(child);
      }
      visit(fromMarkdown(body));
      let prose=body;
      for(const [start,end] of examples.sort((a,b)=>b[0]-a[0]))prose=prose.slice(0,start)+prose.slice(start,end).replace(/[^\r\n]/g,' ')+prose.slice(end);
      if(/(^|\n)\s*(?:import|export)\s/.test(prose))unsafe();
    }
    return values;
  }
  async validateRoute(name,next) {
    const folder=path.posix.dirname(name),basename=path.posix.basename(name);
    const documents=await Promise.all(folders.map(async directory=>{
      const entries=[];
      for(const other of await fs.readdir(path.join(this.root,directory))) {
        if(!/^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(other))continue;
        const filename=await this.safe(directory+'/'+other);
        entries.push([other,this.metadata(await fs.readFile(filename,'utf8'),{validateBody:false})]);
      }
      return new Map(entries);
    }));
    const [spanish,english]=documents;
    if(folder===folders[1]) {
      const original=spanish.get(basename);
      // Docusaurus discovers files in its default locale, then substitutes a
      // translation with the same filename. An English-only file is never built.
      if(!original)fail(409,'Cree primero el documento en español con el mismo identificador para poder publicar su traducción al inglés.');
      if(original.id!==next.id||original.slug!==next.slug)fail(409,'La traducción debe conservar el mismo identificador y ruta del documento en español.');
      english.set(basename,next);
    } else {
      const translation=english.get(basename);
      if(translation&&(translation.id!==next.id||translation.slug!==next.slug))fail(409,'El identificador y la ruta deben coincidir con la versión en inglés existente.');
      spanish.set(basename,next);
    }
    const unique=(entries,language)=>{
      const used=new Set();
      for(const entry of entries) {
        if(used.has(entry.slug))fail(409,`La ruta ya está usada por otro documento en ${language}. Elija una ruta diferente antes de guardar.`);
        used.add(entry.slug);
      }
    };
    unique(documents[folders.indexOf(folder)].values(),folder===folders[0]?'español':'inglés');
    // Untranslated Spanish files are also published in English. Include them
    // when checking routes so a new save cannot break the English build.
    unique([...spanish].map(([filename,entry])=>english.get(filename)||entry),'inglés');
  }
  async validateImages(raw,assets) {
    for(const url of markdownImages(raw)) {
      // Docusaurus handles relative documentation imports itself. Public URLs
      // must point to a real image in this portal so builds need no remote fetch.
      if(!url.startsWith('/')&&!/^[a-z][a-z0-9+.-]*:/i.test(url))continue;
      let target,name;try {target=new URL(url,this.siteOrigin);name=decodeURIComponent(target.pathname.slice(1));}catch {fail(400,'La dirección de la imagen es inválida.');}
      if(target.origin!==this.siteOrigin||target.username||target.password)fail(400,'Suba la imagen a la biblioteca de medios o use una URL de este sitio. Las imágenes externas no pueden prepararse para publicación local.');
      if(name.startsWith('api/media/'))fail(400,'La imagen tiene una dirección temporal. Selecciónela nuevamente desde la biblioteca de medios.');
      if(!name.startsWith('multimedia/documentacion/')) {
        if(!/\.(png|jpe?g|webp|avif|gif|svg|ico)$/i.test(name)||name.includes('\\')||name.includes('\0')||name.split('/').some(part=>!part||part.startsWith('.')))fail(400,'La dirección no corresponde a una imagen del portal.');
        const publicRoot=await fs.realpath(path.join(this.root,'public'));
        try {
          const filename=path.join(publicRoot,name),resolved=await fs.realpath(filename);
          if(!resolved.startsWith(publicRoot+path.sep)||!(await fs.lstat(filename)).isFile())fail(400,'La imagen no es un archivo público autorizado.');
        } catch(error) {if(error.code==='ENOENT')fail(400,'La imagen seleccionada no existe en el portal. Cárguela desde la biblioteca de medios.');throw error;}
        continue;
      }
      const imagePath='public/'+name;
      const filename=await this.safe(imagePath,'media');
      if(assets.some(asset=>asset.path===imagePath))continue;
      try {if(!(await fs.stat(filename)).isFile())fail(400,'La imagen seleccionada no es un archivo.');}
      catch(error) {if(error.code==='ENOENT')fail(400,'La imagen seleccionada no existe. Cárguela nuevamente desde la biblioteca de medios.');throw error;}
    }
  }
  async entry(name) {
    const filename=await this.safe(name);
    let data;try {data=await fs.readFile(filename,'utf8');}catch(error) {if(error.code==='ENOENT')fail(404,'Documento no encontrado.');throw error;}
    return {data,file:{id:sha(data),name:path.basename(name),path:name}};
  }
  async mediaFile(name) {
    const filename=await this.safe(name,'media');
    const bytes=await fs.readFile(filename);
    return {id:sha(Buffer.concat([Buffer.from(name+'\0'),bytes])),name:path.basename(name),path:name,encoding:'base64',content:bytes.toString('base64')};
  }
  mediaBytes(asset) {
    if(asset?.encoding!=='base64'||typeof asset.content!=='string'||asset.content.length>14*1024*1024||!/^[a-zA-Z0-9+/]*={0,2}$/.test(asset.content))fail(400,'Imagen inválida o mayor a 10 MB.');
    const bytes=Buffer.from(asset.content,'base64');
    if(!bytes.length||bytes.length>10*1024*1024)fail(413,'La imagen debe tener como máximo 10 MB.');
    const ext=path.extname(asset.path).slice(1).toLowerCase();
    const valid=(ext==='png'&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))||(['jpg','jpeg'].includes(ext)&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)||(ext==='gif'&&/^GIF8[79]a$/.test(bytes.subarray(0,6).toString()))||(ext==='webp'&&bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')||(ext==='avif'&&bytes.subarray(4,8).toString()==='ftyp'&&bytes.subarray(8,40).includes(Buffer.from('avif')));
    if(!valid)fail(400,'El contenido no corresponde a un formato de imagen permitido.');
    return bytes;
  }
  async atomic(filename,data) {
    const temporary=filename+'.'+randomUUID()+'.tmp';
    try {await fs.writeFile(temporary,data,{mode:0o600,flag:'wx'});await fs.rename(temporary,filename);}
    finally {await fs.rm(temporary,{force:true});}
  }
  async perform(action,params,user) {
    if(action==='info')return {type:'creangel_local',publish_modes:['simple']};
    if(action==='entriesByFolder') {
      if(!folders.includes(params.folder)||params.extension!=='md')fail(403,'Colección no autorizada.');
      const files=(await fs.readdir(path.join(this.root,params.folder))).filter(name=>/^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(name)).sort();
      return Promise.all(files.map(name=>this.entry(params.folder+'/'+name)));
    }
    if(action==='entriesByFiles')return Promise.all((params.files||[]).map(file=>this.entry(file.path||file)));
    if(action==='getEntry')return this.entry(params.path);
    if(action==='getMedia') {
      if(params.mediaFolder!==media)fail(403,'Carpeta de imágenes no autorizada.');
      return Promise.all((await fs.readdir(path.join(this.root,media))).filter(name=>imagePattern.test(name)).map(name=>this.mediaFile(media+'/'+name)));
    }
    if(action==='getMediaFile')return this.mediaFile(params.path);
    if(action==='getNotes')return {notes:[]};
    if(action==='getPRMetadata')return {metadata:null};
    if(action==='getDeployPreview')return null;
    if(action==='persistEntry') {
      const files=params.dataFiles;
      const assets=params.assets||[];
      if(!Array.isArray(files)||files.length!==1||!Array.isArray(assets)||assets.length>10)fail(400,'Guarde un documento a la vez.');
      const prepared=[];
      for(const file of files) {
        const filename=await this.safe(file.path);
        if(typeof file.raw!=='string'||Buffer.byteLength(file.raw)>1024*1024)fail(413,'Documento inválido o mayor a 1 MB.');
        const next=this.metadata(file.raw);
        if(path.basename(file.path,'.md')!==next.id)fail(400,'Conserve el identificador y nombre de archivo.');
        try {
          const previous=this.metadata(await fs.readFile(filename,'utf8'),{validateBody:false});
          if(previous.id!==next.id||previous.slug!==next.slug)fail(409,'No cambie el identificador ni la ruta de un documento existente.');
        } catch(error) {if(error.code!=='ENOENT')throw error;}
        await this.validateRoute(file.path,next);
        prepared.push({filename,data:file.raw,name:file.path});
      }
      for(const asset of assets)prepared.push({filename:await this.safe(asset.path,'media'),data:this.mediaBytes(asset),name:asset.path});
      for(const file of files)await this.validateImages(file.raw,assets);
      // Make uploaded assets available before the document can reference them.
      for(const file of prepared.slice(1))await this.atomic(file.filename,file.data);
      await this.atomic(prepared[0].filename,prepared[0].data);
      this.audit(user.username,'documento_guardado',prepared[0].name);
      return {};
    }
    if(action==='persistMedia') {
      const asset=params.asset;
      const filename=await this.safe(asset?.path,'media');
      await this.atomic(filename,this.mediaBytes(asset));
      this.audit(user.username,'imagen_guardada',asset.path);
      return this.mediaFile(asset.path);
    }
    if(action==='deleteFiles') {
      if(!Array.isArray(params.paths)||!params.paths.length||params.paths.length>10)fail(400,'Selección inválida.');
      const files=await Promise.all(params.paths.map(name=>this.safe(name,'media')));
      for(let i=0;i<files.length;i++) {
        // Keep referenced images; deleting one must not break the published documentation.
        const publicName='/multimedia/documentacion/'+path.basename(files[i]);
        for(const folder of folders)for(const name of await fs.readdir(path.join(this.root,folder))) {
          if(name.endsWith('.md')&&(await fs.readFile(path.join(this.root,folder,name),'utf8')).includes(publicName))fail(409,'La imagen está usada en un documento. Quite primero su referencia.');
        }
      }
      for(let i=0;i<files.length;i++){await fs.unlink(files[i]);this.audit(user.username,'imagen_eliminada',params.paths[i]);}
      return {};
    }
    fail(400,'Operación de contenido no disponible.');
  }
  request(action,params,user,authorize=()=>{}) {
    const operation=this.chain.then(()=>{authorize();return this.perform(action,params,user);});
    this.chain=operation.catch(()=>{});return operation;
  }
  async serve(name) {
    const filename=await this.safe(media+'/'+name,'media');
    try {return {bytes:await fs.readFile(filename),type:types[path.extname(name).slice(1).toLowerCase()]};}
    catch(error) {if(error.code==='ENOENT')fail(404,'Imagen no encontrada.');throw error;}
  }
}
