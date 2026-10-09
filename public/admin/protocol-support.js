// Decap's proxy drops the revision when serializing a save. Carry the version
// obtained when the document was opened, without refreshing it before a write.
export function contentProtocol(send) {
  const revisions=new Map();
  function remember(value,overwrite=false){
    for(const entry of Array.isArray(value)?value:[value])if(entry?.file?.path&&entry.file.id&&(overwrite||!revisions.has(entry.file.path)))revisions.set(entry.file.path,entry.file.id);
    return value;
  }
  async function pages(action,params){
    const items=[],seen=new Set();let cursor,size=0;
    do {
      const result=await send({action,params:{...params,limit:action==='entriesPage'?100:50,...(cursor!==undefined?{cursor}:{})}});
      if(!Array.isArray(result.items))throw new Error('Respuesta de colección inválida. Recargue el editor.');
      size+=JSON.stringify(result.items).length;
      if(size>80*1024*1024||items.length+result.items.length>2000)throw new Error('La colección supera el límite de lectura del editor. Consulte al administrador.');
      items.push(...result.items);remember(result.items);cursor=result.nextCursor;
      if(cursor!==null){if(typeof cursor!=='string'||seen.has(cursor)||seen.size>=100)throw new Error('Paginación inválida. Recargue el editor.');seen.add(cursor);}
    }while(cursor!==null);
    return items;
  }
  return async payload=>{
    if(payload.action==='entriesByFolder')return pages('entriesPage',payload.params);
    if(payload.action==='getMedia')return pages('getMediaPage',{...payload.params,metadataOnly:true});
    let request=payload;
    if(payload.action==='persistEntry'){
      request={...payload,params:{...payload.params,dataFiles:payload.params.dataFiles.map(file=>({...file,baseRevision:revisions.has(file.path)?revisions.get(file.path):null}))}};
    }
    const result=await send(request);
    if(['getEntry','entriesByFiles','persistEntry'].includes(payload.action))remember(result,true);
    if(payload.action==='deleteEntry')revisions.delete(payload.params.path);
    return result;
  };
}
