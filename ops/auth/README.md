# Autenticación de los editores autorizados

Broker OAuth para Decap CMS sin dependencias npm. Node.js 24; escucha en `0.0.0.0:3000` dentro de la red de Compose. El proxy publica `/auth/*` en el mismo dominio que el sitio. No publicar el puerto 3000 directamente.

## Variables

| Variable | Valor / propósito |
| --- | --- |
| `PUBLIC_SITE_URL` | Origen HTTPS sin ruta, por ejemplo `https://portal.creangel.com`. Por defecto ese mismo origen. |
| `GITHUB_CLIENT_ID` | Client ID de la aplicación OAuth registrada en GitHub. Obligatorio. |
| `GITHUB_CLIENT_SECRET_FILE` | Ruta del secreto montado, por ejemplo `/run/secrets/github_client_secret`. Obligatorio; no usar una variable con el secreto directamente. |
| `CMS_ALLOWED_USERS` | Lista de cuentas autorizadas separadas por comas; por defecto `castellanosfelipe`. Cada cuenta también debe tener permiso de escritura en GitHub. No habilita registro abierto. |
| `CONTENT_REPOSITORY` | Repositorio que debe devolver permiso `push`; por defecto `castellanosfelipe/Landing-creangel`. |

Registrar como URL de callback exactamente `PUBLIC_SITE_URL/auth/callback`, sin wildcard. La aplicación solicita `public_repo`: esta configuración está destinada al repositorio público de Creangel. No solicita acceso a repositorios privados ni permisos `workflow`.

Configurar Decap así, reemplazando el dominio por el definitivo:

```yaml
backend:
  name: github
  repo: castellanosfelipe/Landing-creangel
  branch: main
  base_url: https://portal.creangel.com
  auth_endpoint: auth/auth
site_domain: portal.creangel.com
```

`base_url` debe ser el **origen**, sin `/auth`: el cliente Decap compara `event.origin` con ese valor. `auth_endpoint` añade la ruta. El proxy no debe eliminar `/auth` al pasar las solicitudes al broker.

## Restricciones y protocolo

Una cookie opaca `__Host-creangel-oauth` utiliza `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/` y TTL de diez minutos. El estado y el verificador PKCE permanecen únicamente en memoria del broker. Un inicio de sesión reemplaza la sesión previa de ese navegador; el callback consume la sesión antes de intercambiar el código. Reiniciar el contenedor invalida accesos en curso.

Después del intercambio, el broker comprueba la identidad real mediante `/user`, su inclusión en `CMS_ALLOWED_USERS` y el permiso `push` sobre el repositorio configurado. Incluso otros colaboradores con permiso de escritura quedan rechazados si no figuran en la lista. El broker solicita la revocación del token rechazado antes de devolver el error.

El callback envía `authorizing:github` al origen configurado; espera ese mismo mensaje desde `window.opener` y el origen exacto antes de enviar `authorization:github:success:{"token":"…","provider":"github"}`. Los errores usan `authorization:github:error:{"message":"…"}`. Protocolo verificado contra [el cliente oficial de Decap](https://github.com/decaporg/decap-cms/blob/main/packages/decap-cms-lib-auth/src/netlify-auth.js).

Las respuestas llevan `Cache-Control: no-store`, CSP con nonce y protección contra iframes. No registrar consultas del callback, códigos, cookies, tokens ni secretos en el proxy. No establecer `Cross-Origin-Opener-Policy: same-origin` en el panel/callback: puede separar el popup OAuth de su opener.

El token autorizado debe llegar al navegador porque Decap lo utiliza para editar mediante la API de GitHub. Este broker restringe el ingreso desde el CMS; no sustituye los permisos del repositorio ni bloquea ediciones realizadas directamente por otros usuarios que ya tengan acceso a GitHub.

## Comprobación

```sh
node --test ops/auth/test/server.test.mjs
```

Las pruebas usan un proveedor HTTP local, sin credenciales ni llamadas reales a GitHub. Los endpoints productivos son constantes; ninguna variable permite redirigir las solicitudes OAuth a un host arbitrario.

[Flujo OAuth y PKCE de GitHub](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps), [backend GitHub de Decap](https://decapcms.org/docs/github-backend/).
