(async()=>{
  const account=window.CreangelAccount,message=document.querySelector('#message');
  let session,users=[],target=null;
  const show=(text,error=false)=>{message.textContent=text;message.className='status '+(error?'error':'success');};
  const cell=(row,text)=>{const td=document.createElement('td');td.textContent=text;row.append(td);return td;};
  const actions={inicio_sesion:'Inicio de sesión',inicio_fallido:'Intento de acceso fallido',usuario_creado:'Usuario creado',usuario_actualizado:'Usuario actualizado',contraseña_restablecida:'Contraseña restablecida',contraseña_cambiada:'Contraseña cambiada',documento_guardado:'Documento guardado',imagen_guardada:'Imagen guardada',imagen_eliminada:'Imagen eliminada'};
  async function refresh() {
    if(session.user.role!=='admin')return;
    const results=await Promise.all([account.request('/api/users'),account.request('/api/audit')]);users=results[0].users;
    const body=document.querySelector('#users');body.replaceChildren();
    for(const user of users){const tr=document.createElement('tr');cell(tr,user.username);cell(tr,user.displayName);cell(tr,user.role==='admin'?'Administrador':'Editor');cell(tr,user.active?'Activo':'Desactivado');const td=cell(tr,'');const wrap=document.createElement('div');wrap.className='actions';
      for(const [action,label] of [['edit','Editar'],['reset','Restablecer contraseña'],['active',user.active?'Desactivar':'Activar']]){const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.id=user.id;button.dataset.action=action;button.className=action==='active'&&user.active?'danger':'secondary';if(action==='active'&&user.id===session.user.id)button.disabled=true;wrap.append(button);}td.append(wrap);body.append(tr);}
    const audit=document.querySelector('#audit');audit.replaceChildren();for(const event of results[1].events){const tr=document.createElement('tr');cell(tr,new Date(event.timestamp).toLocaleString('es-CO'));cell(tr,event.actorUsername);cell(tr,actions[event.action]||event.action);cell(tr,event.targetUsername);audit.append(tr);}
  }
  try{session=await account.restore();if(session.user.mustChangePassword){location.replace(account.loginURL('/admin/users/'));return;}}
  catch{location.replace(account.loginURL('/admin/users/'));return;}
  document.querySelector('#identity').textContent=session.user.displayName;
  document.querySelector('#notice').textContent=session.user.role==='admin'?'Las cuentas se administran desde este portal.':'Puede editar contenido y cambiar su contraseña. La administración de otros usuarios está reservada a los administradores.';
  if(session.user.role==='admin')document.querySelector('#management').hidden=false;
  else document.querySelector('h1').textContent='Mi cuenta';
  document.querySelector('#logout').addEventListener('click',()=>account.logout().catch(error=>show(error.message,true)));
  async function submit(form,operation,success) {const button=form.querySelector('[type=submit]');button.disabled=true;try{await operation();form.reset();show(success);await refresh();}catch(error){show(error.message,true);const local=form.querySelector('.status');if(local){local.textContent=error.message;local.className='status error';}}finally{button.disabled=false;}}
  document.querySelector('#create-form').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;submit(form,()=>account.request('/api/users','POST',Object.fromEntries(new FormData(form))),'Usuario creado. Entregue la contraseña inicial a su destinatario.');});
  document.querySelector('#users').addEventListener('click',async event=>{const button=event.target.closest('button[data-id]');if(!button)return;target=users.find(user=>user.id===button.dataset.id);if(!target)return;
    if(button.dataset.action==='active'){if(target.active&&!confirm(`¿Desactivar la cuenta ${target.username}? Se cerrarán sus sesiones.`))return;try{await account.request('/api/users/'+target.id,'PATCH',{active:!target.active});show('Estado del usuario actualizado.');await refresh();}catch(error){show(error.message,true);}return;}
    const dialog=document.querySelector(button.dataset.action==='edit'?'#edit-dialog':'#reset-dialog');dialog.querySelector('form').reset();dialog.querySelector('.status').textContent='';
    if(button.dataset.action==='edit'){document.querySelector('#edit-name').textContent=target.username;dialog.querySelector('[name=displayName]').value=target.displayName;dialog.querySelector('[name=role]').value=target.role;}
    else document.querySelector('#reset-name').textContent=target.username;dialog.showModal();
  });
  document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
  document.querySelector('#edit-form').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;submit(form,async()=>{await account.request('/api/users/'+target.id,'PATCH',Object.fromEntries(new FormData(form)));form.closest('dialog').close();},'Usuario actualizado.');});
  document.querySelector('#reset-form').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;submit(form,async()=>{await account.request('/api/users/'+target.id+'/password','POST',{password:form.elements.password.value});form.closest('dialog').close();},'Contraseña restablecida. Las sesiones anteriores fueron cerradas.');});
  document.querySelector('#own-password').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;submit(form,async()=>{if(form.elements.newPassword.value!==form.elements.confirmation.value)throw new Error('Las contraseñas no coinciden.');session=await account.password(form.elements.currentPassword.value,form.elements.newPassword.value);},'Su contraseña fue actualizada.');});
  await refresh().catch(error=>show(error.message,true));
})();
