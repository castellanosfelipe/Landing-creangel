window.CreangelAccount = (() => {
  let session=null;
  let reauthentication=null;
  async function confirmIdentity() {
    if(reauthentication)return reauthentication;
    reauthentication=new Promise(resolve=>{
      const dialog=document.createElement('dialog'),form=document.createElement('form'),heading=document.createElement('h2'),notice=document.createElement('p'),status=document.createElement('p');
      heading.textContent='Confirme su identidad';notice.textContent='La confirmación protege los cambios de cuentas y contraseñas. Es válida durante cinco minutos.';status.setAttribute('role','status');status.className='status';
      const passwordLabel=document.createElement('label'),password=document.createElement('input');passwordLabel.textContent='Contraseña actual';password.type='password';password.autocomplete='current-password';password.required=true;password.maxLength=128;passwordLabel.append(password);
      const codeLabel=document.createElement('label'),code=document.createElement('input');codeLabel.textContent='Código de su aplicación o código de recuperación';code.autocomplete='one-time-code';code.required=session?.user.role==='admin';code.maxLength=40;codeLabel.append(code);codeLabel.hidden=!code.required;
      const actions=document.createElement('div'),submit=document.createElement('button'),cancel=document.createElement('button');actions.className='inline-actions';submit.type='submit';submit.textContent='Confirmar';cancel.type='button';cancel.className='secondary';cancel.textContent='Cancelar';actions.append(submit,cancel);
      form.append(heading,notice,passwordLabel,codeLabel,actions,status);dialog.append(form);document.body.append(dialog);
      let finished=false;function close(confirmed){if(finished)return;finished=true;form.reset();dialog.close();dialog.remove();resolve(confirmed);}
      cancel.addEventListener('click',()=>close(false));dialog.addEventListener('cancel',event=>{event.preventDefault();close(false);});
      form.addEventListener('submit',async event=>{event.preventDefault();submit.disabled=true;status.textContent='';try{session=await request('/api/reauth','POST',{password:password.value,code:code.value},false);close(true);}catch(error){status.textContent=error.message;status.className='status error';password.value='';code.value='';if(error.status===401)location.assign(loginURL());}finally{submit.disabled=false;}});
      dialog.showModal();password.focus();
    });
    try{return await reauthentication;}finally{reauthentication=null;}
  }
  async function request(url,method='GET',data,retry=true) {
    const headers={};
    if(method!=='GET') {headers['Content-Type']='application/json';if(session)headers['X-CSRF-Token']=session.csrfToken;}
    const response=await fetch(url,{method,headers,credentials:'same-origin',body:method==='GET'?undefined:JSON.stringify(data||{})});
    let result;try {result=await response.json();}catch {throw new Error('El servicio no está disponible. Intente nuevamente.');}
    if(!response.ok){
      if(result.code==='reauth_required'&&retry&&await confirmIdentity())return request(url,method,data,false);
      if(result.code==='mfa_required')location.assign(loginURL(location.pathname.startsWith('/admin/users')?'/admin/users/':'/admin/'));
      const error=new Error(result.error||'No se pudo completar la operación.');error.status=response.status;error.code=result.code;throw error;
    }
    return result;
  }
  async function restore() {session=await request('/api/session');return session;}
  async function login(username,password,captchaAnswer) {session=await request('/api/login','POST',{username,password,captchaAnswer});return session;}
  async function password(currentPassword,newPassword) {session=await request('/api/password','POST',{currentPassword,newPassword});return session;}
  async function mfaVerify(code,setup=false) {session=await request(setup?'/api/mfa/confirm':'/api/mfa/verify','POST',{code});return session;}
  async function logout() {await request('/api/logout','POST');session=null;localStorage.removeItem('decap-cms-user');location.assign('/admin/login.html');}
  function loginURL(next='/admin/') {return '/admin/login.html?next='+encodeURIComponent(next);}
  return {request,restore,login,password,mfaVerify,confirmIdentity,logout,loginURL,get session(){return session;}};
})();
