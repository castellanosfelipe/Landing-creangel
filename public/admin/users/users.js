(async()=>{
  const account=window.CreangelAccount,message=document.querySelector('#message');
  let session,users=[],target=null;
  const show=(text,error=false)=>{message.textContent=text;message.className='status '+(error?'error':'success');};
  const login=()=>location.replace(account.loginURL('/admin/users/'));
  const showError=(error,form)=>{
    if(error.status===401){login();return;}
    show(error.message,true);
    const local=form?.querySelector('.status');
    if(local){local.textContent=error.message;local.className='status error';}
  };
  const cell=(row,text)=>{const td=document.createElement('td');td.textContent=text;row.append(td);return td;};
  const actions={inicio_sesion:'Inicio de sesión',cierre_sesion:'Cierre de sesión',sesion_inactividad:'Sesión cerrada por inactividad',inicio_fallido:'Intento de acceso fallido',captcha_fallido:'Verificación CAPTCHA fallida',acceso_denegado:'Acceso denegado',limite_solicitudes:'Límite de solicitudes',error_interno:'Error interno',mfa_activado:'Segundo factor activado',mfa_verificado:'Segundo factor verificado',mfa_recuperacion_usada:'Código de recuperación usado',mfa_fallido:'Verificación de segundo factor fallida',identidad_reconfirmada:'Identidad confirmada',reauth_fallido:'Confirmación de identidad fallida',usuario_creado:'Usuario creado',usuario_actualizado:'Usuario actualizado',contraseña_restablecida:'Contraseña restablecida',contraseña_cambiada:'Contraseña cambiada',documento_guardado:'Documento guardado',imagen_guardada:'Imagen guardada',imagen_eliminada:'Imagen eliminada'};
  async function refresh() {
    if(session.user.role!=='admin')return;
    const results=await Promise.all([account.request('/api/users'),account.request('/api/audit'),account.request('/api/alerts')]);users=results[0].users;
    const currentUser=users.find(user=>user.id===session.user.id);
    if(currentUser){session.user=currentUser;document.querySelector('#identity').textContent=currentUser.displayName;}
    const body=document.querySelector('#users');body.replaceChildren();
    for(const user of users){const tr=document.createElement('tr');cell(tr,user.username);cell(tr,user.displayName);cell(tr,user.role==='admin'?'Administrador':'Editor');cell(tr,user.active?'Activo':'Desactivado');const td=cell(tr,'');const wrap=document.createElement('div');wrap.className='actions';
      for(const [action,label] of [['edit','Editar'],['reset','Restablecer contraseña'],['active',user.active?'Desactivar':'Activar']]){const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.id=user.id;button.dataset.action=action;button.className=action==='active'&&user.active?'danger':'secondary';if(user.id===session.user.id&&action!=='edit'){button.disabled=true;button.title=action==='reset'?'Use el formulario Cambiar mi contraseña.':'No puede desactivar su propia cuenta.';}wrap.append(button);}td.append(wrap);body.append(tr);}
    const audit=document.querySelector('#audit');audit.replaceChildren();for(const event of results[1].events){const tr=document.createElement('tr');cell(tr,new Date(event.timestamp).toLocaleString('es-CO'));cell(tr,event.actorUsername);cell(tr,actions[event.action]||event.action);cell(tr,event.targetUsername);audit.append(tr);}
    const alerts=document.querySelector('#alerts');alerts.replaceChildren();for(const alert of results[2].alerts){const tr=document.createElement('tr');cell(tr,new Date(alert.lastAt).toLocaleString('es-CO'));cell(tr,alert.summary);cell(tr,alert.actor);cell(tr,String(alert.occurrences));const td=cell(tr,alert.acknowledgedAt?'Revisada':'');if(!alert.acknowledgedAt){const button=document.createElement('button');button.type='button';button.textContent='Marcar revisada';button.dataset.alert=alert.id;button.className='secondary';td.append(button);}alerts.append(tr);}
  }
  try{session=await account.restore();if(session.user.mustChangePassword||(session.mfa?.required&&!session.mfa.verified)){location.replace(account.loginURL('/admin/users/'));return;}}
  catch{location.replace(account.loginURL('/admin/users/'));return;}
  document.querySelector('#identity').textContent=session.user.displayName;
  document.querySelector('#notice').textContent=session.user.role==='admin'?'Las cuentas se administran desde este portal.':'Puede editar contenido y cambiar su contraseña. La administración de otros usuarios está reservada a los administradores.';
  if(session.user.role==='admin')document.querySelector('#management').hidden=false;
  else document.querySelector('h1').textContent='Mi cuenta';
  document.querySelector('#logout').addEventListener('click',()=>account.logout().catch(showError));
  document.querySelector('#alerts').addEventListener('click',async event=>{const button=event.target.closest('button[data-alert]');if(!button)return;button.disabled=true;try{await account.request('/api/alerts/'+button.dataset.alert+'/ack','POST');show('Alerta marcada como revisada.');await refresh();}catch(error){showError(error);}finally{button.disabled=false;}});
  if(session.user.role==='admin')document.querySelector('#mfa-recovery-section').hidden=false;
  document.querySelector('#renew-recovery').addEventListener('click',async()=>{try{if(!await account.confirmIdentity())return;const result=await account.request('/api/mfa/recovery','POST');document.querySelector('#recovery-output').textContent=result.recoveryCodes.join('\n');document.querySelector('#recovery-notice').hidden=false;show('Guarde los códigos. Los anteriores dejaron de funcionar.');}catch(error){showError(error);}});
  document.querySelector('#clear-recovery').addEventListener('click',()=>{document.querySelector('#recovery-output').textContent='';document.querySelector('#recovery-notice').hidden=true;});
  async function submit(form,operation,success) {const button=form.querySelector('[type=submit]');button.disabled=true;try{await operation();form.reset();show(success);await refresh();}catch(error){showError(error,form);}finally{button.disabled=false;}}
  document.querySelector('#create-form').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;submit(form,()=>account.request('/api/users','POST',Object.fromEntries(new FormData(form))),'Usuario creado. Entregue la contraseña inicial a su destinatario.');});
  document.querySelector('#users').addEventListener('click',async event=>{const button=event.target.closest('button[data-id]');if(!button||button.disabled)return;target=users.find(user=>user.id===button.dataset.id);if(!target)return;
    if(button.dataset.action==='active'){if(target.active&&!confirm(`¿Desactivar la cuenta ${target.username}? Se cerrarán sus sesiones.`))return;try{await account.request('/api/users/'+target.id,'PATCH',{active:!target.active});show('Estado del usuario actualizado.');await refresh();}catch(error){showError(error);}return;}
    const dialog=document.querySelector(button.dataset.action==='edit'?'#edit-dialog':'#reset-dialog');dialog.querySelector('form').reset();dialog.querySelector('.status').textContent='';
    if(button.dataset.action==='edit'){document.querySelector('#edit-name').textContent=target.username;dialog.querySelector('[name=displayName]').value=target.displayName;const role=dialog.querySelector('[name=role]');role.value=target.role;role.disabled=target.id===session.user.id;document.querySelector('#edit-role-hint').hidden=!role.disabled;}
    else document.querySelector('#reset-name').textContent=target.username;dialog.showModal();
  });
  document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
  document.querySelector('#edit-form').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;submit(form,async()=>{await account.request('/api/users/'+target.id,'PATCH',Object.fromEntries(new FormData(form)));form.closest('dialog').close();},'Usuario actualizado.');});
  document.querySelector('#reset-form').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;submit(form,async()=>{await account.request('/api/users/'+target.id+'/password','POST',{password:form.elements.password.value});form.closest('dialog').close();},'Contraseña restablecida. Las sesiones anteriores fueron cerradas.');});
  document.querySelector('#own-password').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;submit(form,async()=>{if(form.elements.newPassword.value!==form.elements.confirmation.value)throw new Error('Las contraseñas no coinciden.');session=await account.password(form.elements.currentPassword.value,form.elements.newPassword.value);},'Su contraseña fue actualizada.');});
  await refresh().catch(showError);
})();
