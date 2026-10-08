window.CreangelAccount = (() => {
  let session=null;
  async function request(url,method='GET',data) {
    const headers={};
    if(method!=='GET') {headers['Content-Type']='application/json';if(session)headers['X-CSRF-Token']=session.csrfToken;}
    const response=await fetch(url,{method,headers,credentials:'same-origin',body:method==='GET'?undefined:JSON.stringify(data||{})});
    let result;try {result=await response.json();}catch {throw new Error('El servicio no está disponible. Intente nuevamente.');}
    if(!response.ok){const error=new Error(result.error||'No se pudo completar la operación.');error.status=response.status;throw error;}
    return result;
  }
  async function restore() {session=await request('/api/session');return session;}
  async function login(username,password,captchaAnswer) {session=await request('/api/login','POST',{username,password,captchaAnswer});return session;}
  async function password(currentPassword,newPassword) {session=await request('/api/password','POST',{currentPassword,newPassword});return session;}
  async function logout() {await request('/api/logout','POST');session=null;localStorage.removeItem('decap-cms-user');location.assign('/admin/login.html');}
  function loginURL(next='/admin/') {return '/admin/login.html?next='+encodeURIComponent(next);}
  return {request,restore,login,password,logout,loginURL,get session(){return session;}};
})();
