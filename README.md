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

Desactivar una cuenta, cambiar su rol o restablecer su contraseña revoca sus sesiones. Las sesiones expiran a las ocho horas o tras 30 minutos de inactividad; los sondeos automáticos no prolongan el acceso. Usan cookies HttpOnly y SameSite Strict, con Secure en producción HTTPS. Las contraseñas nuevas tienen 15–128 caracteres, admiten frases largas y rechazan claves comunes, repetidas o relacionadas con la cuenta. Se almacenan con scrypt N=32768, r=8, p=3, sal individual y parámetros versionados. Las credenciales anteriores siguen verificándose y actualizan su hash al acceder; las débiles requieren cambio. No se guardan contraseñas ni tokens de sesión en el navegador. Las escrituras exigen sesión, origen autorizado y token CSRF. Se limitan los intentos de acceso fallidos.

Los administradores deben configurar un segundo factor **TOTP local** después de cambiar la contraseña inicial. Introducir la clave mostrada en una aplicación autenticadora y confirmar su código; no se envía a proveedores externos. Guardar los diez códigos de recuperación en un gestor privado: solo se muestran al generarlos y cada uno sirve una vez. La clave TOTP se cifra con AES-256-GCM; `editor_data/mfa.key` debe conservarse junto a la base de datos. Altas, bajas, cambios de rol, restablecimientos y renovación de recuperación exigen reconfirmar contraseña y segundo factor cuando han pasado cinco minutos. La actualización de seguridad cierra las sesiones anteriores y conserva cuentas y contenido.

Los rechazos, cierres de sesión y operaciones sensibles generan eventos con IP, fecha e identificador de solicitud, sin contraseñas, códigos ni claves. Las alertas aparecen en **Administrar usuarios** y en la salida JSON de los servicios. Docker conserva esta segunda salida fuera del proceso del CMS, con rotación de diez archivos de 10 MB por servicio; su protección depende del acceso al host. Los eventos SQLite se retienen 90 días y las alertas 30 días, configurables en `.env`. Además, se conservan como máximo 50.000 eventos recientes (con limpieza cada cien escrituras) y 1.000 alertas para limitar crecimiento ante abuso. No se eliminan usuarios automáticamente.

El inicio de sesión también exige escribir los cinco caracteres de una imagen CAPTCHA generada por el propio servidor. Se puede solicitar **Otro código** si no es legible. Cada desafío vence a los cinco minutos, queda vinculado al navegador y se consume al intentar acceder; el servidor verifica la respuesta antes de comprobar la contraseña. La imagen se renueva tras un intento fallido. No se usan Google reCAPTCHA, cuentas externas ni claves de un proveedor. Este control complementa los límites de intentos y no cambia las cuentas o contraseñas existentes.

## Instalación en producción

Requisitos: servidor Linux con Docker Engine y Compose, dominio apuntando al servidor y puertos 80/443 disponibles. La instalación inicial necesita descargar imágenes y dependencias; el funcionamiento posterior del editor/publicador no requiere acceso a un proveedor Git.

Copiar el proyecto al servidor y preparar la contraseña y `.env` sin sobrescribir entradas existentes:

```sh
docker run --rm -v "$PWD:/app" -w /app node:24-bookworm-slim node ops/setup-secrets.mjs
```

También sirve `node ops/setup-secrets.mjs` con Node 24. Los archivos nuevos `.env`, `secrets/editor-admin-password` y `secrets/backup-key` usan permisos 0600, directorio 0700 y UID/GID 1000 en Linux. No incluirlos en el repositorio ni en la imagen Docker. La clave de backup tiene 32 bytes aleatorios y debe guardarse también en un lugar privado separado del servidor. Completar `.env`:

```dotenv
PUBLIC_SITE_URL=https://portal.creangel.com
SITE_DOMAIN=portal.creangel.com
ACME_EMAIL=soluciones@creangel.com
INITIAL_ADMIN_USERNAME=admin
EDITOR_ADMIN_PASSWORD_PATH=./secrets/editor-admin-password
BACKUP_KEY_PATH=./secrets/backup-key
EDITOR_IDLE_MINUTES=30
AUDIT_RETENTION_DAYS=90
ALERT_RETENTION_DAYS=30
BACKUP_RETENTION_DAYS=30
BACKUP_INTERVAL_HOURS=24
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

Los documentos no pueden cambiar su ruta existente ni incluir HTML/MDX ejecutable. Se permiten signos habituales en títulos, descripciones multilínea y ejemplos de código Markdown. Cada guardado comprueba la revisión que se abrió; si otro editor la cambió, devuelve un conflicto y solicita recargar, conservando el archivo actual. Las imágenes admiten PNG, JPEG, WebP, AVIF y GIF, hasta 10 MB. Se decodifican por completo antes de guardarlas, se normalizan y se eliminan EXIF/XMP/IPTC; se rechazan imágenes dañadas, más de 8192 píxeles por lado, 32 fotogramas o 32 millones de píxeles acumulados. Se bloquea eliminar imágenes todavía referenciadas, incluidas rutas codificadas, relativas autorizadas y referencias Markdown.

La biblioteca se consulta en páginas ligeras y obtiene los bytes de una imagen al seleccionarla. Límites por instalación: 1000 imágenes/512 MiB, 2000 documentos/64 MiB, reserva de disco de 64 MiB y 16 solicitudes de contenido en cola/32 MiB. Se informa cuando se alcanza un límite; no se truncan resultados ni se guardan archivos parcialmente. La API y Nginx limitan tamaño, conexiones y peticiones. Los contenedores de operación usan usuarios sin privilegios, raíz de solo lectura, límites de recursos y ninguna capacidad Linux. `init` dispone solo de las capacidades necesarias para preparar propietarios de los volúmenes.

Para insertar una imagen: abrir el documento, usar **+ → Image → Elige una imagen → Subir nuevo**, confirmar la selección, completar el texto alternativo y publicar. La miniatura y la vista previa muestran también imágenes todavía no publicadas. El servidor detecta bloques de imagen vacíos antes de guardar y solicita seleccionar una imagen o quitar el bloque. La construcción calcula las dimensiones de las imágenes del portal; los originales conservan permisos privados y las copias publicadas se preparan para su lectura por Nginx.

```sh
docker compose logs --tail=100 builder
docker compose restart builder
docker compose exec builder node -e "fetch('http://127.0.0.1:8082/status').then(r=>r.json()).then(console.log)"
```

Servicios: `init` prepara/migra volúmenes; `editor` administra cuentas y contenido; `builder` construye/publica; `web` sirve Nginx; `proxy` proporciona HTTPS y `backup` prepara copias cifradas sin acceso a la red. Ninguno monta el socket Docker. La actualización de infraestructura preserva documentos, imágenes y cuentas existentes:

```sh
docker compose up -d --build --remove-orphans --wait
```

## Persistencia, copia y recuperación

Volúmenes: `workspace` guarda los documentos e imágenes editados; `editor_data` guarda SQLite (cuentas, sesiones, auditoría y clave MFA); `releases` guarda publicaciones, cinco versiones recientes y semilla; `backup_data` guarda copias cifradas; Caddy conserva certificados en sus volúmenes. **No ejecutar `down -v`** si se desean conservar estos datos. Copiar solo el repositorio no copia cambios editoriales ni cuentas.

`backup` crea una copia cada 24 horas y retiene 30 días por defecto. Incluye documentos ES/EN, medios, un snapshot SQLite consistente y `mfa.key`. Verifica que el contenido no cambie durante la copia y cifra el archivo completo con AES-256-GCM. Un fallo conserva copias anteriores, genera una alerta en los logs y reintenta en cinco minutos. Se recomienda copiar los archivos `.cmsbak` a almacenamiento externo privado: un volumen del mismo servidor no protege frente a pérdida del host. No se copia código ni publicaciones reconstruibles.

```sh
docker compose exec backup node /app/ops/backup/service.mjs --once
docker compose logs --tail=50 backup
docker compose run --rm --no-deps backup node /app/ops/backup/service.mjs restore /var/lib/backups/backup-NOMBRE.cmsbak /var/lib/backups/restauracion-nueva
```

La restauración solo admite un directorio que aún no exista. Comprueba autenticidad, rutas, hashes de todos los archivos e integridad SQLite antes de crear `restauracion-nueva`. Su estructura es `content/` (carpetas editoriales) y `accounts/` (`editor.sqlite`, `mfa.key`); cierra sesiones históricas y no reactiva una configuración MFA incompleta. Tras verificarla, detener los servicios y transferir esos archivos a **volúmenes de un proyecto independiente**, con propietarios 1000:1000 y permisos privados, y construir el sitio. Mantener el origen correcto. La restauración no sustituye automáticamente datos ni publicaciones. Para bibliotecas cercanas al máximo, aumentar temporalmente memoria/tmpfs del contenedor restaurador a 2 GiB. Guardar la clave de backup por separado: perderla impide recuperar los archivos.

Si se pierde la contraseña de todos los administradores, un operador con acceso al servidor puede preparar un **nuevo archivo privado** y restablecerla. No colocar la contraseña en argumentos de comandos:

```sh
docker compose exec -T editor sh -c 'umask 077; cat > /tmp/creangel-recovery-password' < /ruta/privada/nueva-contrasena
docker compose exec editor node /app/ops/editor/cli.mjs reset-password admin --password-file /tmp/creangel-recovery-password
docker compose exec editor rm /tmp/creangel-recovery-password
```

Estos comandos se ejecutan en el shell del servidor Linux. La transferencia por entrada estándar permite escribir en el tmpfs privado aunque la raíz del contenedor sea de solo lectura. El siguiente acceso exige cambiarla y revoca sesiones anteriores. Si el nombre inicial fue distinto, sustituir `admin` por ese nombre. Este comando no se expone por HTTP.

Si se pierde también el autenticador y todos los códigos de recuperación, el operador del servidor puede restablecer **solo el segundo factor**; el siguiente acceso requiere la contraseña y enrolar TOTP nuevamente:

```sh
docker compose exec editor node /app/ops/editor/cli.mjs reset-mfa admin --confirm admin
docker compose exec editor node /app/ops/editor/cli.mjs security-status
docker compose exec editor node /app/ops/editor/cli.mjs prune-audit
docker compose exec editor node /app/ops/editor/cli.mjs anonymize-disabled usuario-inactivo --confirm usuario-inactivo
```

Anonimizar exige que la cuenta esté desactivada. Elimina sesiones, segundo factor y códigos de recuperación, sustituye su identificación en registros SQLite y genera un evento. Los backups y logs del host anteriores conservan su propia retención; la función no los modifica.

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
npm run test:dependencies
npm run test:cms
npm run build:production -- --output _site --base-url https://portal.creangel.com
```

Fuera de Docker se requieren Node 24 y Python 3 (`PYTHON` permite indicar su ejecutable). Las pruebas verifican CAPTCHA (caducidad, uso único, vinculación al navegador y validación en el servidor), autenticación, CSRF, roles, revocación, persistencia, rutas autorizadas y conservación de la publicación ante fallos. Un servidor HTTP estático sirve las páginas exportadas pero no sustituye la API de edición.

El CMS se recompila desde los módulos realmente configurados de Decap; conserva edición visual Slate, Markdown, imágenes y código, y excluye proveedores externos y el widget Plate no utilizado. El validador del esquema oficial de configuración se genera durante la construcción, incluidos los esquemas de los widgets registrados; el navegador ejecuta funciones ya preparadas, sin compilar código con `eval` o `new Function`. Los hashes del esquema revisado detienen la construcción si cambia Decap y requiere revisión. Las pruebas de CMS reproducen el fallo anterior con la generación dinámica bloqueada y verifican la configuración ES/EN, errores descriptivos y equivalencia con el validador original. Los scripts y estilos estáticos de Docusaurus se externalizan para aplicar CSP sin scripts inline ni `eval`. La vista previa del CMS permite únicamente marcos del mismo origen.

La dependencia `braces@3.0.3` no dispone de una versión upstream corregida para su aviso de recursión: se mantiene visible en `npm audit` de documentación y recibe un parche reproducible, verificado por hashes, que limita profundidad del parser y recorrido AST. `npm ci` aplica el parche y las pruebas ejercitan su protección. No se oculta el aviso ni se considera una actualización oficial; revisar y sustituir el parche cuando upstream publique una corrección. Los demás avisos encontrados se eliminan mediante actualización o retirada de módulos no utilizados. La validación local no certifica DNS/HTTPS, cifrado de discos, vigilancia o controles de acceso del servidor de producción.

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
