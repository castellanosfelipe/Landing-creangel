(() => {
  const account=window.CreangelAccount;
  const loginForm=document.querySelector('#login-form'),passwordForm=document.querySelector('#password-form'),message=document.querySelector('#message');
  const nextValue=new URLSearchParams(location.search).get('next');
  const next=['/admin/','/admin/users/'].includes(nextValue)?nextValue:'/admin/';
  let initialPassword='';
  function ready(session) {
    if(session.user.mustChangePassword) {
      loginForm.hidden=true;passwordForm.hidden=false;
      document.querySelector('#heading').textContent='Elija su contraseña';
      document.querySelector('#intro').textContent='Cambie la contraseña inicial antes de continuar.';
      passwordForm.elements.password.focus();
    } else {
      // Decap keeps public identity metadata only; the session credential remains HttpOnly.
      localStorage.setItem('decap-cms-user',JSON.stringify({...session.user,name:session.user.displayName,login:session.user.username,backendName:'creangel-local'}));
      location.replace(next);
    }
  }
  function show(error) {message.textContent=error.message;message.className='error';}
  loginForm.addEventListener('submit',async event=>{
    event.preventDefault();const button=loginForm.querySelector('button');button.disabled=true;message.textContent='';
    try {initialPassword=loginForm.elements.password.value;ready(await account.login(loginForm.elements.username.value,initialPassword));loginForm.elements.password.value='';}
    catch(error){initialPassword='';show(error);}finally{button.disabled=false;}
  });
  passwordForm.addEventListener('submit',async event=>{
    event.preventDefault();message.textContent='';const button=passwordForm.querySelector('button');button.disabled=true;
    try {
      if(passwordForm.elements.password.value!==passwordForm.elements.confirmation.value)throw new Error('Las contraseñas no coinciden.');
      if(!initialPassword){loginForm.hidden=false;passwordForm.hidden=true;throw new Error('Inicie sesión de nuevo para cambiar su contraseña inicial.');}
      const session=await account.password(initialPassword,passwordForm.elements.password.value);
      initialPassword='';passwordForm.reset();ready(session);
    }catch(error){show(error);}finally{button.disabled=false;}
  });
  account.restore().then(session=>{if(!session.user.mustChangePassword)ready(session);}).catch(()=>{});
})();
