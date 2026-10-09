import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deserializeEditorMedia,sourceMediaPath} from '../../../public/admin/media-support.js';
test('lightweight media listing preserves authenticated URL without allocating file content',()=>{
  const item={path:'public/multimedia/documentacion/selection.png',name:'selection.png',id:'revision',size:100,encoding:'url',url:'/api/media/selection.png'};
  const result=deserializeEditorMedia(item);assert.equal(result.displayURL,item.url);assert.equal(result.file,undefined);assert.equal(result.size,100);
  for(const url of ['https://foreign.example/selection.png','/api/media/other.png','javascript:void(0)'])assert.throws(()=>deserializeEditorMedia({...item,url}));
  assert.throws(()=>deserializeEditorMedia({...item,size:11*1024*1024}));assert.throws(()=>deserializeEditorMedia({...item,path:'public/other/selection.png'}));
});
test('selected image becomes a typed local File and supersedes cached content safely',()=>{
  const item={path:'public/multimedia/documentacion/selected.png',name:'selected.png',id:'one',encoding:'base64',content:Buffer.from('synthetic image').toString('base64')};
  const first=deserializeEditorMedia(item);assert.equal(first.file.type,'image/png');assert.equal(first.file.size,15);assert.equal(deserializeEditorMedia(item),first);
  const second=deserializeEditorMedia({...item,id:'two',content:Buffer.from('other').toString('base64')});assert.notEqual(second.url,first.url);assert.equal(second.file.size,5);
  assert.equal(sourceMediaPath('/multimedia/documentacion/selected.png'),item.path);
});
