# Creangel · Docker Compose y GitHub Pages

Sitio completo de Creangel, con 60 páginas, cinco productos IFINDIT, 1.222 características públicas, 10 casos, 18 artículos y la multimedia publicada. Mantiene el formulario Jira y las tablas de Colombia Compra Eficiente. El diseño y el contenido coinciden con la entrega de producción.

Repositorio: https://github.com/castellanosfelipe/Landing-creangel

URL prevista una vez publicado: https://castellanosfelipe.github.io/Landing-creangel/

## Despliegue con Docker Compose

Requiere Docker con contenedores Linux y Docker Compose v2. Desde la raíz del repositorio o del paquete Docker descomprimido:

```sh
docker compose up -d --build --wait
```

Abrir **http://localhost:8080/**. Un único servicio `web` sirve el sitio completo con Nginx; no requiere Python instalado en el servidor, base de datos ni volúmenes de contenido. Python se utiliza únicamente durante la construcción para generar y verificar el sitio. Los HTML visibles y los bytes de la multimedia se conservan.

La configuración predeterminada escucha en `127.0.0.1:8080` y usa `https://portal.creangel.com` para canonical, Open Graph, JSON-LD, sitemap y robots. Para cambiarla, copiar `.env.example` a `.env` y editar:

| Variable | Predeterminado | Uso |
| --- | --- | --- |
| `SITE_URL` | `https://portal.creangel.com` | Origen público completo, HTTP o HTTPS, sin subruta. Se aplica al construir. |
| `HTTP_PORT` | `8080` | Puerto del host. |
| `BIND_ADDRESS` | `127.0.0.1` | Dirección del host; `0.0.0.0` permite acceso directo desde otras máquinas. |
| `IMAGE_TAG` | `local` | Etiqueta de la imagen local para identificar una entrega. |

Después de cambiar contenido o `SITE_URL`, ejecutar de nuevo `docker compose up -d --build --wait`. Las variables no son secretos; `.env` se excluye de Git y del contexto Docker.

### Dominio de producción y HTTPS

El contenedor sirve HTTP en el puerto interno 8080. Para el hosting actual, mantener el certificado HTTPS y el proxy del hosting, apuntando a `http://127.0.0.1:8080`. El ejemplo `.docker/reverse-proxy.conf.example` incluye los bloques Nginx para `portal.creangel.com` y las rutas del certificado existente. Si el hosting utiliza otro proxy, configurar el mismo destino allí. No se instala ni renueva un certificado desde este contenedor.

Para otro dominio, cambiar `SITE_URL` en `.env`, reconstruir la imagen y configurar ese dominio y su certificado en el proxy. El despliegue Docker sirve las rutas desde la raíz del dominio. El prefijo `/Landing-creangel/` corresponde exclusivamente a GitHub Pages.

### Comprobación y operación

```sh
docker compose config --quiet
docker compose ps
docker compose exec -T web nginx -t
docker compose logs --tail 50 web
docker compose down
```

`--wait` espera a que el contenedor esté saludable. La comprobación de salud solicita la página inicial. Nginx se ejecuta sin root, con sistema de archivos de solo lectura, directorio temporal en memoria y registros rotados. Reinicia automáticamente tras una interrupción del servicio Docker, salvo que se detenga manualmente.

Para ejecutar la prueba HTTP completa desde una máquina con Python 3:

```sh
python3 .docker/verify.py --url http://127.0.0.1:8080 --site-url https://portal.creangel.com
```

Si se cambian el puerto o el dominio, pasar esos valores a la prueba. La verificación revisa las 60 páginas, 70 alias de página, 307 alias multimedia, bytes de los activos, cabeceras CSP, errores 404, archivos privados, rangos de video, MIME, caché, ETag y compresión. El workflow **Verificar despliegue Docker Compose** construye y arranca la misma configuración en cada push y conserva su informe HTTP.

Las redirecciones antiguas son HTTP 301 y conservan la query. `/soporte/` mantiene Jira y su política específica; `/ifinditsearch/`, `/ifinditanalytics/` y `/ifinditsearch/informationservices/` conservan las tablas CCE. No se aplica un fallback al inicio para URLs inexistentes. Los archivos Docker, las fuentes de construcción y `.env` quedan fuera del sitio servido.

Referencias: [Docker Compose](https://docs.docker.com/reference/compose-file/services/), [construcción de imágenes](https://docs.docker.com/reference/compose-file/build/), [cabeceras Nginx](https://nginx.org/en/docs/http/ngx_http_headers_module.html).

## Publicación en GitHub Pages

1. Subir el contenido del paquete a la raíz de este repositorio, incluidas las carpetas `.github/` y `.pages/`, y la carpeta `public/` completa. No subir el paquete de hosting anterior, el Excel privado ni la documentación interna.
2. En **Settings → Pages → Build and deployment → Source**, seleccionar **GitHub Actions**.
3. Ejecutar **Actions → Publicar Creangel en GitHub Pages → Run workflow** sobre la rama predeterminada, o hacer un nuevo push a esa rama. El flujo también se ejecuta automáticamente en futuros cambios a la rama predeterminada.
4. El despliegue muestra su URL real en el entorno `github-pages`. La URL, el prefijo del repositorio, los canónicos, Open Graph, JSON-LD, sitemap y robots se obtienen automáticamente de `actions/configure-pages`.

El workflow no necesita PAT ni secretos adicionales: utiliza los permisos de GitHub Actions para Pages. Los pasos de construcción comprueban enlaces, recursos, conservación del contenido y URLs históricas antes de publicar. Solo `_site/` se envía a Pages; `.pages/`, README y configuración de Actions quedan fuera del sitio público.

## Rutas conservadas

- Soporte: `/Landing-creangel/soporte/`.
- CCE Search: `/Landing-creangel/ifinditsearch/`.
- CCE Analytics: `/Landing-creangel/ifinditanalytics/`.
- CCE Information Services: `/Landing-creangel/ifinditsearch/informationservices/`.
- 70 rutas anteriores tienen HTML de compatibilidad con redirección de navegador y enlace alternativo. GitHub Pages no reproduce los HTTP 301 de Apache.
- 307 rutas históricas de imágenes, documentos y otros recursos se materializan con bytes idénticos al original. Los PDF y las imágenes siguen siendo archivos de su tipo.
- `404.html` utiliza el prefijo correcto; funciona incluso al abrir una URL inexistente en varios niveles.

Jira conserva su script y configuración originales. Los estilos y validaciones dentro del iframe pertenecen al proveedor. Se mantiene la CSP compatible con meta en cada HTML, con las dependencias del widget solo en soporte. Las cabeceras HTTP de Apache/Nginx no se configuran mediante GitHub Pages; por ello no se incluye `.htaccess` en esta distribución.

## Construcción local

Requiere Python 3; los scripts no necesitan paquetes externos. Ejecutar desde la raíz del repositorio:

```sh
python3 .pages/export.py --base-url https://castellanosfelipe.github.io/Landing-creangel/
python3 .pages/check.py --base-url https://castellanosfelipe.github.io/Landing-creangel/
python3 -m http.server 8080 --directory _site
```

El exportador requiere una carpeta de salida vacía para evitar contenido residual. Para otra compilación usar `--output` con una carpeta nueva y pasar la misma ruta a `check.py --site-root`. La visualización local en raíz permite revisar enlaces y contenido; para comprobar exactamente el prefijo y el 404, servir la compilación dentro de una carpeta `Landing-creangel/` y abrir esa ruta.

## Contenido editable

Los HTML, CSS, JavaScript, documentos e imágenes están en `public/`. Los cambios del sitio se hacen allí y se publican mediante el workflow. Los scripts de `.pages/` adaptan únicamente metadatos, políticas compatibles con Pages y rutas históricas; conservan el cuerpo visible de las 60 páginas y los bytes de los activos.

Referencias oficiales: [workflows para Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [404 personalizado](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-custom-404-page-for-your-github-pages-site), [límites de Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).
