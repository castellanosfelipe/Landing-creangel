import {test} from 'node:test';
import assert from 'node:assert/strict';
import {contentProtocol} from '../../../public/admin/protocol-support.js';

test('Decap saves the opened revision and does not replace it with a background list refresh',async()=>{
  const sent=[];let id='a'.repeat(64);
  const protocol=contentProtocol(async value=>{sent.push(value);if(value.action==='getEntry')return {file:{path:'docs/a.md',id}};if(value.action==='entriesPage')return {items:[{file:{path:'docs/a.md',id}}],nextCursor:null};return {file:{path:'docs/a.md',id:'c'.repeat(64)}};});
  await protocol({action:'getEntry',params:{path:'docs/a.md'}});id='b'.repeat(64);
  await protocol({action:'entriesByFolder',params:{folder:'docs',extension:'md'}});
  await protocol({action:'persistEntry',params:{dataFiles:[{path:'docs/a.md',raw:'first save'}]}});
  assert.equal(sent.at(-1).params.dataFiles[0].baseRevision,'a'.repeat(64));
  await protocol({action:'persistEntry',params:{dataFiles:[{path:'docs/a.md',raw:'second save'}]}});
  assert.equal(sent.at(-1).params.dataFiles[0].baseRevision,'c'.repeat(64));
});
test('new documents send explicit null and conflicts retain the old revision',async()=>{
  const sent=[];const protocol=contentProtocol(async value=>{sent.push(value);if(value.action==='getEntry')return {file:{path:'docs/a.md',id:'a'.repeat(64)}};throw new Error('conflict');});
  await assert.rejects(protocol({action:'persistEntry',params:{dataFiles:[{path:'docs/new.md',raw:'new'}]}}));assert.equal(sent.at(-1).params.dataFiles[0].baseRevision,null);
  await protocol({action:'getEntry',params:{path:'docs/a.md'}});
  for(let i=0;i<2;i++){await assert.rejects(protocol({action:'persistEntry',params:{dataFiles:[{path:'docs/a.md',raw:'new'}]}}));assert.equal(sent.at(-1).params.dataFiles[0].baseRevision,'a'.repeat(64));}
});
test('media listing requests lightweight pages and rejects repeated cursors',async()=>{
  const sent=[];const protocol=contentProtocol(async value=>{sent.push(value);return {items:[{name:'one.png'}],nextCursor:value.params.cursor?null:'50'};});
  assert.equal((await protocol({action:'getMedia',params:{mediaFolder:'public/multimedia/documentacion'}})).length,2);
  assert.equal(sent[0].params.metadataOnly,true);assert.equal(sent[1].params.cursor,'50');
  const bad=contentProtocol(async()=>({items:[],nextCursor:'1'}));await assert.rejects(bad({action:'getMedia',params:{}}),/Paginación/);
});
