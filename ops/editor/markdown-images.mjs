import {fromMarkdown} from 'mdast-util-from-markdown';
import {fail} from './security.mjs';

// Parse Markdown rather than matching text: examples in code and escaped image
// syntax must remain valid documentation.
export function markdownImages(raw) {
  const body=raw.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,'');
  const tree=fromMarkdown(body),definitions=new Map(),images=[];
  function visit(node,callback) {
    callback(node);
    for(const child of node.children||[])visit(child,callback);
  }
  visit(tree,node=>{
    if(node.type==='definition'&&!definitions.has(node.identifier))definitions.set(node.identifier,node.url);
  });
  visit(tree,node=>{
    const url=node.type==='image'?node.url:node.type==='imageReference'?definitions.get(node.identifier):undefined;
    if(url===undefined)return;
    if(!url.trim())fail(400,'Hay un bloque de imagen vacío. Seleccione una imagen o quite el bloque antes de guardar.');
    if(/^(?:blob:|\/api\/media\/|public\/multimedia\/documentacion\/)/i.test(url))fail(400,'La imagen tiene una dirección temporal. Selecciónela nuevamente desde la biblioteca de medios.');
    images.push(url);
  });
  return images;
}
