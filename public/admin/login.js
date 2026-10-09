(() => {
  const account=window.CreangelAccount;
  const loginForm=document.querySelector('#login-form'),passwordForm=document.querySelector('#password-form'),message=document.querySelector('#message');
  const mfaForm=document.querySelector('#mfa-form'),recoveryPanel=document.querySelector('#recovery-panel');
  let setupMfa=false;
  const captchaPanel=document.querySelector('#captcha-panel'),captchaImage=document.querySelector('#captcha-image'),captchaRefresh=document.querySelector('#captcha-refresh'),captchaStatus=document.querySelector('#captcha-status');
  const loginButton=loginForm.querySelector('button[type="submit"]');
  const nextValue=new URLSearchParams(location.search).get('next');
  const next=['/admin/','/admin/users/'].includes(nextValue)?nextValue:'/admin/';
  let initialPassword='',captchaReady=false,captchaLoading=true,loggingIn=false,captchaTimer,captchaExpiresAt=0;
  function updateButtons() {loginButton.disabled=!captchaReady||captchaLoading||loggingIn;captchaRefresh.disabled=captchaLoading||loggingIn;loginForm.elements.captchaAnswer.disabled=captchaLoading||loggingIn;}
  function stopCaptchaTimer() {clearTimeout(captchaTimer);captchaTimer=undefined;}
  function scheduleCaptchaExpiry() {
    stopCaptchaTimer();
    captchaTimer=setTimeout(()=>refreshCaptcha('El código anterior venció. Escriba el nuevo código.'),Math.max(0,captchaExpiresAt-Date.now()));
  }
  async function ready(session) {
    stopCaptchaTimer();
    loginForm.hidden=true;passwordForm.hidden=true;mfaForm.hidden=true;recoveryPanel.hidden=true;
    if(session.user.mustChangePassword) {
      loginForm.hidden=true;passwordForm.hidden=false;
      document.querySelector('#heading').textContent='Elija su contraseña';
      document.querySelector('#intro').textContent='Cambie la contraseña inicial antes de continuar.';
      passwordForm.elements.password.focus();
    } else if(session.mfa?.required&&!session.mfa.verified) {
      initialPassword='';setupMfa=session.mfa.setupRequired;mfaForm.hidden=false;
      document.querySelector('#heading').textContent=setupMfa?'Proteja su cuenta':'Verificación en dos pasos';
      document.querySelector('#intro').textContent=setupMfa?'Configure su segundo factor para administrar el portal.':'Confirme el acceso con su aplicación de autenticación.';
      document.querySelector('#mfa-setup').hidden=!setupMfa;
      if(setupMfa){const setup=await account.request('/api/mfa/setup','POST');document.querySelector('#mfa-secret').value=setup.secret;}
      mfaForm.elements.code.focus();
    } else if(session.recoveryCodes?.length) {
      initialPassword='';document.querySelector('#mfa-secret').value='';recoveryPanel.hidden=false;
      document.querySelector('#heading').textContent='Segundo factor configurado';document.querySelector('#intro').textContent='Guarde los códigos antes de continuar.';
      document.querySelector('#recovery-codes').textContent=session.recoveryCodes.join('\n');
    } else {
      initialPassword='';
      // Decap keeps public identity metadata only; the session credential remains HttpOnly.
      localStorage.setItem('decap-cms-user',JSON.stringify({...session.user,name:session.user.displayName,login:session.user.username,backendName:'creangel-local'}));
      location.replace(next);
    }
  }
  function show(error) {message.textContent=error.message;message.className='error';}
  async function refreshCaptcha(notice='',discard=false) {
    const previousIsValid=!discard&&captchaReady&&captchaExpiresAt>Date.now();
    stopCaptchaTimer();captchaLoading=true;updateButtons();
    if(!previousIsValid){captchaReady=false;captchaExpiresAt=0;loginForm.elements.captchaAnswer.value='';captchaImage.hidden=true;}
    captchaPanel.setAttribute('aria-busy','true');captchaStatus.className='hint captcha-status';
    captchaStatus.textContent='Preparando el código de verificación…';
    try {
      const challenge=await account.request('/api/captcha');
      const remaining=Number(challenge.expiresAt)-Date.now();
      if(typeof challenge.image!=='string'||!challenge.image.startsWith('data:image/png;base64,')||!Number.isFinite(remaining)||remaining<=0)throw new Error('No se pudo cargar el código. Genere otro código para continuar.');
      captchaImage.src=challenge.image;captchaImage.hidden=false;captchaReady=true;captchaExpiresAt=Number(challenge.expiresAt);
      loginForm.elements.captchaAnswer.value='';
      captchaStatus.textContent=notice;
      scheduleCaptchaExpiry();
    } catch(error) {
      if(previousIsValid&&captchaExpiresAt>Date.now()) {
        scheduleCaptchaExpiry();
        captchaStatus.textContent=error.message+' Puede seguir usando el código mostrado mientras no venza.';
      } else {captchaReady=false;captchaExpiresAt=0;captchaImage.hidden=true;captchaStatus.textContent=error.message;}
      captchaStatus.className='hint captcha-status error';
    } finally {
      captchaLoading=false;captchaPanel.setAttribute('aria-busy','false');updateButtons();
    }
  }
  captchaImage.addEventListener('error',()=>{
    stopCaptchaTimer();captchaReady=false;captchaExpiresAt=0;updateButtons();captchaImage.hidden=true;
    captchaStatus.textContent='No se pudo mostrar la imagen. Genere otro código para continuar.';captchaStatus.className='hint captcha-status error';
  });
  captchaRefresh.addEventListener('click',()=>refreshCaptcha('Se generó un nuevo código.'));
  loginForm.addEventListener('submit',async event=>{
    event.preventDefault();
    if(!captchaReady||captchaLoading||loggingIn){show(new Error('Espere a que se cargue el código de verificación.'));return;}
    loggingIn=true;stopCaptchaTimer();updateButtons();message.textContent='';
    try {
      initialPassword=loginForm.elements.password.value;
      const session=await account.login(loginForm.elements.username.value,initialPassword,loginForm.elements.captchaAnswer.value);
      loginForm.elements.password.value='';await ready(session);
    } catch(error) {
      initialPassword='';show(error);loggingIn=false;
      await refreshCaptcha('Escriba el nuevo código para volver a intentarlo.',true);
    } finally {loggingIn=false;updateButtons();}
  });
  passwordForm.addEventListener('submit',async event=>{
    event.preventDefault();message.textContent='';const button=passwordForm.querySelector('button[type="submit"]');button.disabled=true;
    try {
      if(passwordForm.elements.password.value!==passwordForm.elements.confirmation.value)throw new Error('Las contraseñas no coinciden.');
      if(!initialPassword){
        loginForm.hidden=false;passwordForm.hidden=true;
        document.querySelector('#heading').textContent='Acceso de editores';
        document.querySelector('#intro').textContent='Ingrese con la cuenta asignada por el administrador del portal.';
        await refreshCaptcha();throw new Error('Inicie sesión de nuevo para cambiar su contraseña inicial.');
      }
      const session=await account.password(initialPassword,passwordForm.elements.password.value);
      initialPassword='';passwordForm.reset();await ready(session);
    }catch(error){show(error);}finally{button.disabled=false;}
  });
  mfaForm.addEventListener('submit',async event=>{event.preventDefault();const button=mfaForm.querySelector('[type=submit]');button.disabled=true;message.textContent='';try{const result=await account.mfaVerify(mfaForm.elements.code.value,setupMfa);mfaForm.reset();await ready(result);}catch(error){show(error);mfaForm.elements.code.value='';if(error.status===401)location.replace(account.loginURL(next));}finally{button.disabled=false;}});
  document.querySelector('#mfa-cancel').addEventListener('click',()=>account.logout().catch(show));
  document.querySelector('#copy-mfa-secret').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(document.querySelector('#mfa-secret').value);message.textContent='Clave copiada. Péguela en su aplicación de autenticación.';message.className='success';}catch{show(new Error('Seleccione y copie la clave manualmente.'));}});
  document.querySelector('#recovery-continue').addEventListener('click',()=>{document.querySelector('#recovery-codes').textContent='';const result={...account.session};delete result.recoveryCodes;ready(result).catch(show);});
  account.restore().then(async session=>{if(!session.user.mustChangePassword)await ready(session);else await refreshCaptcha();}).catch(error=>{if(error.status!==401)show(error);refreshCaptcha();});
})();
