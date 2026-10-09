(async()=>{
  const account=window.CreangelAccount;
  try {
    const session=await account.restore();
    if(session.user.mustChangePassword||(session.mfa?.required&&!session.mfa.verified)){location.replace(account.loginURL());return;}
    const user={...session.user,name:session.user.displayName,login:session.user.username,backendName:'creangel-local'};
    localStorage.setItem('decap-cms-user',JSON.stringify(user));
    const proxyFactory=CMS.getBackend('proxy');
    if(!proxyFactory)throw new Error('No se pudo preparar el editor.');
    const mediaSupport=await import('./media-support.js');
    const {contentProtocol}=await import('./protocol-support.js');
    class PortalBackend {
      constructor(config,options) {
        const implementation=proxyFactory.init({...config,backend:{...config.backend,proxy_url:'/api/content'}},options);
        implementation.authenticate=async()=>{const result=await account.restore();if(result.user.mustChangePassword||(result.mfa?.required&&!result.mfa.verified)){location.assign(account.loginURL());throw new Error('Complete la verificación de su cuenta para continuar.');}return {...result.user,name:result.user.displayName,login:result.user.username};};
        implementation.restoreUser=implementation.authenticate;
        implementation.logout=async()=>account.logout();
        implementation.request=contentProtocol(async payload=>{
          try{return await account.request('/api/content','POST',payload);}
          catch(error){if(error.status===401||error.code==='mfa_required')location.assign(account.loginURL());throw error;}
        });
        // The proxy protocol returns source paths and base64 bytes. Keep those
        // paths for Decap's draft AssetProxy cache and supply a typed local File.
        implementation.getMedia=async(mediaFolder=config.media_folder)=>
          (await implementation.request({action:'getMedia',params:{mediaFolder}})).map(mediaSupport.deserializeEditorMedia);
        implementation.getMediaFile=async path=>
          mediaSupport.deserializeEditorMedia(await implementation.request({action:'getMediaFile',params:{path:mediaSupport.sourceMediaPath(path)}}));
        implementation.persistMedia=async(assetProxy,options={})=>
          mediaSupport.deserializeEditorMedia(await implementation.request({action:'persistMedia',params:{asset:{path:assetProxy.path,content:await assetProxy.toBase64(),encoding:'base64'},options:{commitMessage:options.commitMessage}}}));
        return implementation;
      }
    }
    CMS.registerBackend('creangel-local',PortalBackend);
    mediaSupport.installImagePreviews(CMS);
    CMS.init();
    const controls=document.createElement('nav');controls.className='account-shortcuts';controls.setAttribute('aria-label','Cuenta del editor');
    const link=document.createElement('a');link.href='/admin/users/';link.textContent=session.user.role==='admin'?'Administrar usuarios':'Mi cuenta';controls.append(link);document.body.append(controls);
    const publishing=document.createElement('span');publishing.setAttribute('role','status');publishing.setAttribute('aria-live','polite');controls.prepend(publishing);
    async function publishingStatus(){try{const response=await fetch('/local/status',{credentials:'same-origin'});if(!response.ok)throw new Error();const result=await response.json();publishing.textContent=result.state==='building'?'Publicando cambios…':result.state==='failed'?'La publicación falló; se conserva la versión anterior.':'Sitio actualizado';}catch{publishing.textContent='Estado de publicación no disponible';}}
    await publishingStatus();setInterval(publishingStatus,5000);
  } catch(error) {
    if(error.status===401||error.code==='mfa_required'){location.replace(account.loginURL());return;}
    document.querySelector('#nc-root').textContent=error.message;
  }
})();
