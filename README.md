# Creangel · Portal y administración local de editores

Portal bilingüe y documentación de IFINDIT para `https://portal.creangel.com`. Docusaurus construye la documentación; Decap proporciona el editor visual. Las cuentas, contraseñas, documentos, imágenes y publicaciones se gestionan en el servidor propio. No se requieren cuentas externas, OAuth, repositorios remotos, webhooks ni GitHub Actions para operar o publicar.

Se conservan las 120 páginas comerciales ES/EN, cinco productos, LakeHouse, Auth IAM, 1.222 características, diez casos, dieciocho artículos, multimedia, Jira, tablas de Colombia Compra Eficiente y las rutas históricas. El CMS administra los ocho documentos ES y sus ocho versiones EN, más sus imágenes. El diseño comercial y los diagramas permanecen en código.

## Acceso y usuarios

| Dirección | Función |
|---|---|
| `/` y `/en/` | Portal comercial |
| `/documentacion/` y `/documentacion/en/` | Documentación ES/EN |
| `/admin/login.html` | Inicio de sesión con usuario, contraseña y CAPTCHA local |
| `/admin/` | Editor de documentación e imágenes |
| `/admin/users/` | Administración de usuarios y contraseña propia |
| `/local/status` | Estado de la última construcción, sin credenciales |

El administrador inicial se llama `admin`, salvo que se cambie `INITIAL_ADMIN_USERNAME` antes del primer arranque. Su contraseña aleatoria se prepara en `secrets/editor-admin-password`, fuera del control de versiones. Debe cambiarse en el primer acceso. Después de ese cambio, el archivo de preparación deja de ser la contraseña de la cuenta; conservar la contraseña nueva en un gestor seguro.

Desde **Administrar usuarios**, un administrador puede crear varios editores o administradores, cambiar nombre y rol, desactivar/reactivar cuentas, restablecer contraseñas y consultar los últimos 100 eventos. Cada contraseña inicial o restablecida debe cambiarse al acceder. No existe autorregistro público. Los editores solo pueden editar documentación/imágenes y cambiar su propia contraseña; la API también aplica estos permisos. Se impide desactivar o degradar la propia cuenta administradora o el último administrador activo.

Desactivar una cuenta, cambiar su rol o restablecer su contraseña revoca sus sesiones. Las sesiones expiran a las ocho horas, usan cookies HttpOnly y SameSite Strict, con Secure en producción HTTPS. Las contraseñas se almacenan con scrypt y sal individual; no se guardan contraseñas ni tokens de sesión en el navegador. Las escrituras exigen sesión, origen autorizado y token CSRF. Se limitan los intentos de acceso fallidos.

El inicio de sesión también exige escribir los cinco caracteres de una imagen CAPTCHA generada por el propio servidor. Se puede solicitar **Otro código** si no es legible. Cada desafío vence a los cinco minutos, queda vinculado al navegador y se consume al intentar acceder; el servidor verifica la respuesta antes de comprobar la contraseña. La imagen se renueva tras un intento fallido. No se usan Google reCAPTCHA, cuentas externas ni claves de un proveedor. Este control complementa los límites de intentos y no cambia las cuentas o contraseñas existentes.

## Instalación en producción

Requisitos: servidor Linux con Docker Engine y Compose, dominio apuntando al servidor y puertos 80/443 disponibles. La instalación inicial necesita descargar imágenes y dependencias; el funcionamiento posterior del editor/publicador no requiere acceso a un proveedor Git.

Copiar el proyecto al servidor y preparar la contraseña y `.env` sin sobrescribir entradas existentes:

```sh
docker run --rm -v "$PWD:/app" -w /app node:24-bookworm-slim node ops/setup-secrets.mjs
```

También sirve `node ops/setup-secrets.mjs` con Node 24. Los archivos nuevos `.env` y `secrets/editor-admin-password` usan permisos 0600, directorio 0700 y UID/GID 1000 en Linux. No incluirlos en el repositorio ni en la imagen Docker. Completar `.env`:

```dotenv
PUBLIC_SITE_URL=https://portal.creangel.com
SITE_DOMAIN=portal.creangel.com
ACME_EMAIL=soluciones@creangel.com
INITIAL_ADMIN_USERNAME=admin
EDITOR_ADMIN_PASSWORD_PATH=./secrets/editor-admin-password
HTTP_PORT=80
HTTPS_PORT=443
```

```sh
docker compose config --quiet
docker compose up -d --build --wait
docker compose ps
```

Abrir `https://portal.creangel.com/admin/login.html`, acceder y sustituir la contraseña inicial. Autorizar cada editor desde `/admin/users/`; no se modifica `.env` ni se recrean contenedores para altas/bajas de usuarios. Caddy obtiene y renueva HTTPS cuando DNS y conectividad están listos.

Si ya existe proxy HTTPS:

```sh
docker compose -f compose.yaml -f compose.external-proxy.yaml up -d --build --wait
```

El override omite Caddy y expone Nginx únicamente en `127.0.0.1:8080`. El proxy existente debe enviar **todas** las rutas, incluida `/api/`, al mismo sitio y sobrescribir `X-Real-IP` con la IP del cliente (en Nginx: `proxy_set_header X-Real-IP $remote_addr;`). Así, los límites de acceso y CAPTCHA se aplican por cliente, en lugar de compartir la IP del proxy. No reenviar esta cabecera suministrada por el visitante ni exponer el puerto privado de `web` públicamente. Caddy ya realiza esta sustitución en la configuración incluida. Mantener `PUBLIC_SITE_URL` igual al origen HTTPS que usa el navegador; no permitir CORS abierto. Los puertos de editor y constructor no se exponen al host.

## Publicación

**Editar en Decap → guardar en el volumen local → construir y validar → activar una nueva versión.** El constructor detecta cambios estables, genera el portal y la documentación ES/EN y verifica conservación comercial, rutas, enlaces y SEO. Un enlace simbólico se sustituye atómicamente cuando todo pasa. Una construcción fallida conserva el sitio anterior; corregir el documento y guardar provoca un nuevo intento. Reiniciar `builder` reintenta un fallo sin cambios.

No hay borradores remotos ni ramas editoriales: **Guardar** inicia la publicación directa. Para crear una traducción inglesa, crear primero el documento en español y conservar el mismo identificador y ruta en ambas colecciones. El editor rechaza rutas duplicadas y el prefijo reservado `/en` antes de guardar. **Ver publicación** abre la página del documento en su idioma; esperar a que el estado indique **Sitio actualizado** para consultar la versión recién guardada.

Los documentos no pueden cambiar su ruta existente ni incluir HTML/MDX ejecutable. Se permiten signos habituales en títulos, descripciones multilínea y ejemplos de código Markdown. Las imágenes admiten PNG, JPEG, WebP, AVIF y GIF, hasta 10 MB. Se bloquea eliminar imágenes todavía referenciadas por documentos.

Para insertar una imagen: abrir el documento, usar **+ → Image → Elige una imagen → Subir nuevo**, confirmar la selección, completar el texto alternativo y publicar. La miniatura y la vista previa muestran también imágenes todavía no publicadas. El servidor detecta bloques de imagen vacíos antes de guardar y solicita seleccionar una imagen o quitar el bloque. La construcción calcula las dimensiones de las imágenes del portal; los originales conservan permisos privados y las copias publicadas se preparan para su lectura por Nginx.

```sh
docker compose logs --tail=100 builder
docker compose restart builder
docker compose exec builder node -e "fetch('http://127.0.0.1:8082/status').then(r=>r.json()).then(console.log)"
```

Servicios: `init` prepara/migra volúmenes; `editor` administra cuentas y contenido; `builder` construye/publica; `web` sirve Nginx; `proxy` proporciona HTTPS. Ninguno monta el socket Docker. La actualización de infraestructura preserva documentos, imágenes y cuentas existentes:

```sh
docker compose up -d --build --remove-orphans --wait
```

## Persistencia, copia y recuperación

Volúmenes: `workspace` guarda los documentos e imágenes editados; `editor_data` guarda SQLite (cuentas, sesiones, auditoría); `releases` guarda publicaciones, cinco versiones recientes y semilla; Caddy conserva certificados en sus volúmenes. **No ejecutar `down -v`** si se desean conservar estos datos. Copiar solo el repositorio no copia cambios editoriales ni cuentas.

Para una copia consistente, detener `editor` y `builder`, respaldar `workspace`, `editor_data` y `releases` completos con los archivos WAL/SHM si existen, y volver a iniciar esos dos servicios. Guardar las copias cifradas y verificar una restauración en un proyecto Compose independiente. Al restaurar, detener los servicios antes de sustituir volúmenes y conservar el mismo dominio configurado; no reutilizar el volumen de pruebas en producción.

Si se pierde la contraseña de todos los administradores, un operador con acceso al servidor puede preparar un **nuevo archivo privado** y restablecerla. No colocar la contraseña en argumentos de comandos:

```sh
docker compose cp /ruta/privada/nueva-contrasena editor:/tmp/creangel-recovery-password
docker compose exec editor node /app/ops/editor/cli.mjs reset-password admin --password-file /tmp/creangel-recovery-password
docker compose exec editor rm /tmp/creangel-recovery-password
```

El siguiente acceso exige cambiarla y revoca sesiones anteriores. Si el nombre inicial fue distinto, sustituir `admin` por ese nombre. Este comando no se expone por HTTP.

## Pruebas locales

```sh
node ops/setup-secrets.mjs
docker compose -f compose.local.yaml up -d --build --remove-orphans --wait
```

Abrir `http://127.0.0.1:8785/` y `/admin/login.html`. Usa los mismos usuarios propios y restricciones que producción, con SQLite y contenido en volúmenes separados. Solo se expone a localhost; todas las páginas locales tienen noindex y robots bloquea rastreo. [Operación local](ops/local/README.md).

```sh
npm ci --no-audit --no-fund
npm --prefix documentation ci --no-audit --no-fund
npm test
npm run build:production -- --output _site --base-url https://portal.creangel.com
```

Fuera de Docker se requieren Node 24 y Python 3 (`PYTHON` permite indicar su ejecutable). Las pruebas verifican CAPTCHA (caducidad, uso único, vinculación al navegador y validación en el servidor), autenticación, CSRF, roles, revocación, persistencia, rutas autorizadas y conservación de la publicación ante fallos. Un servidor HTTP estático sirve las páginas exportadas pero no sustituye la API de edición.

## SEO y diseño

`ops/seo/metadata.json` define títulos y descripciones comerciales. La construcción aplica metadatos y JSON-LD sin cambiar el cuerpo visual. Docusaurus gestiona sus metadatos y navegación. El sitemap combina 114 páginas comerciales indexables con 16 documentos ES/EN. Buscador, 404, vacante histórica y panel mantienen noindex. Se comprueban canonical, hreflang recíproco, metadatos, imágenes, referencias y páginas huérfanas antes de activar una versión.

```sh
python3 ops/seo/check.py --root _site --base-url https://portal.creangel.com --report seo-validation.json
python3 ops/seo/generate-redirects.py --check
```

Nginx mantiene redirecciones HTTP 301 para 70 rutas antiguas y variantes. HTML usa no-cache en producción; recursos tienen caché separada. Core Web Vitals, HTTPS y registro del sitemap se verifican después en el dominio real.

## Código

- `public/`: portal y editor visual.
- `documentation/`: Docusaurus y documentos ES/EN.
- `ops/editor/`: autenticación, cuentas y contenido local, recuperación y pruebas.
- `ops/storage/`: inicialización, construcción y publicaciones persistentes.
- `ops/seo/`, `.pages/`: verificación y conservación de rutas/diseño.
- `compose*.yaml`, `Dockerfile`, `ops/nginx.conf`, `ops/Caddyfile`: despliegue.
- `.env`, `secrets/`, dependencias, SQLite y compilaciones: datos privados excluidos del control de versiones.
