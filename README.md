# Creangel · Docusaurus, Decap CMS y Docker Compose

Portal bilingüe y documentación editable de IFINDIT, preparado para `https://portal.creangel.com`. GitHub almacena el contenido; construcción y publicación se ejecutan en el servidor propio. No hay workflows de GitHub Actions.

Se conservan las 120 páginas ES/EN, cinco productos, LakeHouse, Auth IAM, 1.222 características, diez casos, dieciocho artículos, multimedia, Jira y tablas de Colombia Compra Eficiente. Docusaurus añade ocho documentos en español y sus ocho versiones en inglés basados en el contenido existente. El CMS administra esta documentación y sus imágenes. El diseño comercial y sus diagramas se mantienen en código.

## Direcciones

| Dirección | Función |
|---|---|
| `/` y `/en/` | Portal comercial |
| `/documentacion/` | Documentación en español |
| `/documentacion/en/` | Documentación en inglés |
| `/admin/` | Decap CMS para editores autorizados |
| `/auth/callback` | Retorno OAuth GitHub |
| `/publish/webhook` | Notificaciones GitHub firmadas |

Cada editor necesita una cuenta incluida en `CMS_ALLOWED_USERS` y permiso de escritura sobre `CONTENT_REPOSITORY`. Conocer la dirección del panel no concede permisos. No se habilita edición abierta. Los textos ES/EN se mantienen por separado.

## Arquitectura

Compose configura Nginx, broker OAuth, publicador y Caddy HTTPS. Un servicio de inicialización instala la primera versión completa. Certificados, publicaciones y estado usan volúmenes persistentes. Solo el proxy expone puertos públicos; ningún servicio monta el socket de Docker.

El publicador verifica HMAC SHA-256, repositorio y rama, conserva los identificadores de entrega, serializa la cola y activa cada publicación mediante un enlace simbólico sustituido atómicamente. Si falla la construcción, mantiene la publicación anterior. Conserva cinco versiones y la semilla inicial. Los borradores de Decap usan ramas; publicar los incorpora a `main` y activa el webhook.

## Instalación en Linux

Requisitos: Docker Engine con Compose, dominio apuntando al servidor y puertos 80/443 disponibles. Git, Python y Node de construcción están en los contenedores.

1. Copiar o clonar el repositorio. Preparar configuración y secretos sin sobrescribir valores existentes:

```sh
docker run --rm -v "$PWD:/app" -w /app node:24-bookworm-slim node ops/setup-secrets.mjs
```

También sirve `node ops/setup-secrets.mjs` si existe Node 24. Crea `.env`, un secreto aleatorio de webhook y archivos vacíos para OAuth y token de lectura opcional. No inventa credenciales OAuth.

2. Crear una **GitHub OAuth App**:

   - Homepage URL: `https://portal.creangel.com`
   - Authorization callback URL: `https://portal.creangel.com/auth/callback`

   Guardar Client ID en `GITHUB_CLIENT_ID` de `.env` y Client Secret en `secrets/github-client-secret`. El broker usa alcance `public_repo` para el repositorio público actual. Un repositorio privado requiere adaptar ese alcance y proporcionar acceso de lectura al publicador.

3. Configurar `.env`:

```dotenv
PUBLIC_SITE_URL=https://portal.creangel.com
SITE_DOMAIN=portal.creangel.com
CONTENT_REPOSITORY=castellanosfelipe/Landing-creangel
CONTENT_BRANCH=main
CMS_ALLOWED_USERS=castellanosfelipe
GITHUB_CLIENT_ID=client-id-real
ACME_EMAIL=soluciones@creangel.com
```

   Para varios editores, añadir cuentas reales separadas por comas. Todas necesitan permiso de escritura. `secrets/github-read-token` puede quedar vacío para este repositorio público; para lectura privada se utiliza un token limitado al repositorio. Los secretos son archivos locales excluidos de Git. En Linux deben poder ser leídos por UID/GID 1000; el preparador ajusta su propietario cuando se ejecuta como root y mantiene permisos 0600.

4. Configurar **Settings → Webhooks → Add webhook** en el repositorio:

   - Payload URL: `https://portal.creangel.com/publish/webhook`
   - Content type: `application/json`
   - Secret: contenido de `secrets/github-webhook-secret`
   - Eventos: **Just the push event**
   - Verificación SSL habilitada.

5. Confirmar que esta versión del código esté en la rama configurada y arrancar:

```sh
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

El broker falla explícitamente si faltan credenciales. Caddy obtiene y renueva HTTPS cuando DNS, conectividad y puertos lo permiten. La semilla sirve la primera publicación sin esperar GitHub. El publicador se activa por push firmado o comando local; no reconstruye automáticamente en cada arranque.

## Proxy HTTPS existente

```sh
docker compose -f compose.yaml -f compose.external-proxy.yaml up -d --build
```

El override excluye Caddy y expone Nginx solo en `127.0.0.1:8080`. El proxy existente debe enviar el dominio público a esa dirección, incluyendo `/auth/` y `/publish/webhook`. OAuth conserva el origen HTTPS público.

## Uso y operación

Abrir `/admin/`, iniciar sesión con GitHub y elegir **Documentación · Español** o **Documentation · English**. Guardar el borrador y publicar cuando esté listo. El sitio cambia al terminar la construcción. Las traducciones nuevas deben conservar el nombre de archivo y ruta de su documento español. Las imágenes se guardan en `public/multimedia/documentacion` y se comparten entre idiomas. El panel no convierte HTML comercial ni componentes React en campos visuales.

```sh
docker compose logs --tail=100 publisher
docker compose exec publisher node cli.mjs list
docker compose exec publisher node cli.mjs publish
docker compose exec publisher node cli.mjs rollback release-YYYYMMDDHHMMSS-revision
docker compose up -d --no-deps auth
```

`rollback` está disponible solo desde el servidor. Publicación y recuperación comparten bloqueo. Los cambios editoriales no requieren reconstruir contenedores; los cambios de infraestructura sí. No ejecutar `docker compose down -v` si se quieren conservar certificados, publicaciones y estado.

Para añadir editores, concederles permiso de escritura en GitHub, incluirlos en `CMS_ALLOWED_USERS` y recrear `auth` con el comando anterior. Para retirar un editor, quitarlo también de los colaboradores del repositorio: cambiar la lista del broker no revoca por sí solo un token OAuth que ya se haya emitido. Después de actualizar contenedores con una publicación existente, ejecutar `publish` para construir la rama actual; la inicialización conserva la versión que ya estaba activa.

## Construcción local

```sh
npm ci --no-audit --no-fund
npm --prefix documentation ci --no-audit --no-fund
npm test
npm run build:production -- --output _site --base-url https://portal.creangel.com
python3 -m http.server 8080 --directory _site
```

Requiere Python 3 fuera de Docker; `PYTHON` permite indicar su ejecutable. La salida debe ser nueva o vacía. Primero se verifica la conservación comercial; después se añaden documentación/panel y se comprueban los enlaces de toda la distribución. Se conservan 70 rutas antiguas y 307 recursos históricos.

Las pruebas OAuth usan un proveedor simulado. Los tests del publicador cubren firmas, repetición, cola, bloqueo, activación y conservación ante fallos. Las pruebas de enlaces simbólicos necesitan Linux o permisos de creación en Windows. OAuth real y certificados requieren dominio y credenciales de producción.

## SEO y conservación del diseño

`ops/seo/metadata.json` define títulos y descripciones de las 114 páginas comerciales indexables. La construcción aplica sus metadatos y JSON-LD sin cambiar el cuerpo de las páginas. Los esquemas usan únicamente información existente; no agregan precios, reseñas, autores ni fechas de actualización ficticias. Docusaurus administra sus propios metadatos durante el renderizado y la navegación.

El sitemap de producción combina las 114 páginas comerciales con los 16 documentos ES/EN. El buscador interno, las páginas 404, la vacante histórica y el panel conservan `noindex`. El control SEO verifica canonical, hreflang recíprocos, metadatos, JSON-LD, imágenes, referencias locales y páginas huérfanas antes de activar una versión.

```sh
python3 ops/seo/check.py --root _site --base-url https://portal.creangel.com --report seo-validation.json
python3 ops/seo/generate-redirects.py --check
```

Las 70 rutas antiguas reciben redirecciones HTTP 301 en Nginx, con sus variantes con y sin barra final y parámetros conservados. Al modificar aliases en `.pages/config.json`, regenerar el mapa con `python3 ops/seo/generate-redirects.py` y reconstruir el servicio web. HTML usa `no-cache`; CSS/JS, imágenes y fuentes tienen caché separada. Los recursos sin nombres versionados no usan `immutable`.

Las imágenes responsive conservan los originales y sus dimensiones visibles. Para regenerar WebP y la imagen social con Sharp instalado:

```sh
node ops/seo/optimize-images.mjs --sharp-module /ruta/node_modules/sharp
```

Después de instalar en el servidor, verificar HTTPS, 301/404 y cabeceras con solicitudes reales, registrar el sitemap en Google Search Console y Bing Webmaster Tools y medir Core Web Vitals en producción. Las comprobaciones de construcción no sustituyen esas mediciones.

## Estructura

- `public/`: portal y plantilla del panel.
- `documentation/`: Docusaurus, Markdown ES/EN y estilos.
- `ops/`: construcción/verificación, servidores OAuth/publicador, Nginx/Caddy.
- `.pages/`: exportación y conservación de rutas; se reutilizan sus checks sin depender de Pages.
- `compose.yaml`, `Dockerfile`: instalación en servidor propio.
- `.env.example`: configuración pública de ejemplo.
- `.env`, `secrets/`, dependencias y compilaciones: excluidos del repositorio.

Referencias: [Docusaurus](https://docusaurus.io/docs/deployment), [Decap](https://decapcms.org/docs/github-backend/), [Compose](https://docs.docker.com/compose/), [webhooks](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).
