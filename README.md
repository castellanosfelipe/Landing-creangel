# Creangel · GitHub Pages

Sitio completo de Creangel, con 60 páginas en español y sus 60 versiones en inglés, cinco productos IFINDIT, 1.222 características públicas, 10 casos, 18 artículos y la multimedia publicada. Mantiene el formulario Jira y las tablas de Colombia Compra Eficiente. El diseño y el contenido coinciden con la entrega de producción.

Repositorio: https://github.com/castellanosfelipe/Landing-creangel

URL prevista una vez publicado: https://castellanosfelipe.github.io/Landing-creangel/

## Publicación en GitHub Pages

1. Subir el contenido del paquete a la raíz de este repositorio, incluidas las carpetas `.github/` y `.pages/`, y la carpeta `public/` completa. No subir el paquete de hosting anterior, el Excel privado ni la documentación interna.
2. En **Settings → Pages → Build and deployment → Source**, seleccionar **GitHub Actions**.
3. Ejecutar **Actions → Publicar Creangel en GitHub Pages → Run workflow** sobre la rama predeterminada, o hacer un nuevo push a esa rama. El flujo también se ejecuta automáticamente en futuros cambios a la rama predeterminada.
4. El despliegue muestra su URL real en el entorno `github-pages-production`. La URL, el prefijo del repositorio, los canónicos, Open Graph, JSON-LD, sitemap y robots se obtienen automáticamente de `actions/configure-pages`.

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

Los HTML, CSS, JavaScript, documentos e imágenes están en `public/`. Los cambios del sitio se hacen allí y se publican mediante el workflow. Los scripts de `.pages/` adaptan únicamente metadatos, políticas compatibles con Pages y rutas históricas; conservan el cuerpo visible de las 120 páginas y los bytes de los activos.

Referencias oficiales: [workflows para Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [404 personalizado](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-custom-404-page-for-your-github-pages-site), [límites de Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).

## Idiomas ES/EN

El selector ES/EN de la barra superior abre la misma página en el idioma elegido. El español conserva sus rutas; el inglés utiliza `/en/` delante de ellas. Los enlaces internos, diagramas, buscadores, paginación, textos accesibles y metadatos tienen versión inglesa. La navegación conserva el idioma, y el selector conserva los parámetros de búsqueda y el fragmento cuando JavaScript está disponible. Los enlaces del selector también funcionan sin JavaScript.

Los archivos multimedia se comparten entre idiomas. Los documentos descargables, el texto dentro de las imágenes y la interfaz externa de Jira conservan su idioma original. Los números de parte, límites de licencias, datos de contacto e identificadores se conservan.

Las traducciones se guardan en `.pages/i18n/en.json`; no hay dependencia de servicios de traducción durante las visitas. Para actualizar contenido, editar el HTML español y añadir o revisar su traducción en ese catálogo. Regenerar antes de exportar:

```sh
python3 .pages/localize.py
python3 .pages/export.py --base-url https://castellanosfelipe.github.io/Landing-creangel/
python3 .pages/check.py --base-url https://castellanosfelipe.github.io/Landing-creangel/
```

`localize.py` conserva los ejemplos de código, genera las páginas inglesas y sus diagramas traducidos, actualiza los enlaces entre idiomas y el sitemap bilingüe. La comprobación de Pages valida las 120 páginas canónicas y la correspondencia de idiomas.

## Estructura depurada

- `public/`: 120 páginas canónicas ES/EN y sus recursos multimedia, estilos, JavaScript, robots y sitemap.
- `.pages/`: exportador, verificador, configuración de rutas y mantenimiento de las traducciones.
- `.github/workflows/pages.yml`: único workflow de publicación, con Ubuntu 24.04 fijado.
- README y configuración de Git: instrucciones y control de archivos.

Las 70 redirecciones históricas se generan durante la exportación desde `.pages/config.json`. Sus HTML no se guardan duplicados en `public/`. Los 307 recursos con rutas históricas también se materializan durante la exportación. Los paquetes, informes privados, capturas de trabajo, modelos y hojas de origen quedan fuera del repositorio.

Las comparaciones de un commit muestran diferencias de código. `404.html` es la página de error personalizada; su presencia no indica un fallo de publicación. Si Actions muestra “The job was not acquired by Runner of type hosted even after multiple attempts”, el trabajo no obtuvo un ejecutor y no llegó a ejecutar el sitio ni la construcción. La imagen fijada evita los avisos de migración de `ubuntu-latest`; no garantiza resolver una incidencia del servicio de GitHub.
