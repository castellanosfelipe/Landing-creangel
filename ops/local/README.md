# Ambiente local con cuentas propias

```sh
node ops/setup-secrets.mjs
docker compose -f compose.local.yaml up -d --build --remove-orphans --wait
```

- Portal: `http://127.0.0.1:8785/`.
- Inicio de sesión: `http://127.0.0.1:8785/admin/login.html`.
- Editor: `http://127.0.0.1:8785/admin/`.
- Usuarios/contraseña: `http://127.0.0.1:8785/admin/users/`.
- Publicación: `http://127.0.0.1:8785/local/status`.

Usuario inicial: `admin`; contraseña inicial: archivo privado `secrets/editor-admin-password`. Hay que cambiarla al acceder por primera vez. Si ya se cambió, utilizar la nueva contraseña; recrear los servicios no la restablece. Administradores gestionan usuarios desde el panel, editores no pueden crear ni alterar otras cuentas.

Volúmenes independientes `creangel-local_workspace`, `creangel-local_editor_data` y `creangel-local_releases` conservan contenido, cuentas y versiones. La migración del anterior proxy sin contraseña preserva documentos e imágenes, sustituye el panel y deshabilita `/cms-proxy/`. No requiere ninguna cuenta externa ni commits/push/webhooks. Guardar en Decap inicia la construcción y la publicación local; un fallo deja activa la versión anterior.

```sh
docker compose -f compose.local.yaml ps
docker compose -f compose.local.yaml logs --tail=80 editor builder
docker compose -f compose.local.yaml restart builder
docker compose -f compose.local.yaml down
```

`down` conserva volúmenes; **no usar `down -v`** para mantener cambios. Para recuperación de contraseña y copias consistentes, seguir el README principal con `-f compose.local.yaml` en los comandos. Cambiar `LOCAL_PORT` requiere un proyecto/volúmenes independientes porque el origen almacenado protege la configuración de sesiones.

Solo se expone `127.0.0.1:8785`. Robots y cabeceras locales impiden indexación. Este entorno usa HTTP por ser localhost; producción exige HTTPS y sus propias cuentas/volúmenes.
