# Creangel · GitHub Pages

Sitio completo de Creangel, con 62 páginas, cinco productos IFINDIT, 1.222 características públicas, 12 casos, 18 artículos y toda la multimedia disponible. Mantiene el formulario Jira y las tablas de Colombia Compra Eficiente. El diseño y el contenido coinciden con la entrega de producción.

Repositorio: https://github.com/castellanosfelipe/Landing-creangel

URL prevista una vez publicado: https://castellanosfelipe.github.io/Landing-creangel/

## Publicación

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

Los HTML, CSS, JavaScript, documentos e imágenes están en `public/`. Los cambios del sitio se hacen allí y se publican mediante el workflow. Los scripts de `.pages/` adaptan únicamente metadatos, políticas compatibles con Pages y rutas históricas; conservan el cuerpo visible de las 62 páginas y los bytes de los activos.

Referencias oficiales: [workflows para Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [404 personalizado](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-custom-404-page-for-your-github-pages-site), [límites de Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).
