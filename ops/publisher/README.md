# Publicador en el servidor

Este servicio recibe los cambios de contenido desde un webhook de GitHub, construye el sitio en el servidor y activa una versión completa mediante un enlace simbólico relativo. No usa GitHub Actions, SSH remoto ni el socket de Docker.

## Variables

| Variable | Valor predeterminado | Función |
| --- | --- | --- |
| `CONTENT_REPOSITORY` | `castellanosfelipe/Landing-creangel` | Repositorio autorizado, formato `propietario/repositorio`. |
| `CONTENT_BRANCH` | `main` | Única rama que puede iniciar una publicación. |
| `PUBLIC_SITE_URL` | `https://portal.creangel.com` | Origen público sin rutas, credenciales ni parámetros. |
| `GITHUB_WEBHOOK_SECRET_FILE` | `/run/secrets/github_webhook_secret` | Archivo con un secreto aleatorio de al menos 32 bytes, igual al configurado en GitHub. |
| `GITHUB_READ_TOKEN_FILE` | vacío | Archivo de token de lectura para un repositorio privado. El repositorio público no requiere token. |
| `RELEASE_ROOT` | `/srv/releases` | Volumen compartido con el servidor web. |
| `PUBLISHER_STATE_ROOT` | `/var/lib/publisher` | Volumen persistente de caché Git/npm, cola e identificadores de entrega. |
| `PUBLISH_ON_STARTUP` | `false` | `true` sincroniza con Git al iniciar; habilitar después de subir esta implementación al repositorio. |
| `PUBLISH_DEBOUNCE_MS` | `1500` | Agrupa cambios próximos en una sola construcción. |
| `PUBLISH_MAX_RETRIES` | `3` | Reintentos después del intento inicial: hasta cuatro intentos en total. `0` desactiva el reintento automático. |
| `PUBLISH_RETRY_BASE_SECONDS` | `5` | Espera inicial entre intentos fallidos, duplicada en cada reintento. |
| `PUBLISH_RETRY_MAX_SECONDS` | `60` | Tope de la espera entre reintentos; debe ser mayor o igual a la espera inicial. |
| `BUILD_TIMEOUT_SECONDS` | `1200` | Límite por comando de descarga, instalación o construcción. |
| `KEEP_RELEASES` | `5` | Conserva las últimas versiones, la versión activa y la inicial. |
| `PUBLISHER_PORT` | `3001` | Puerto interno del servicio. |
| `PUBLISHER_SEED_PATH` | vacío | Fuente inicial, utilizada únicamente por `bootstrap.mjs` o inicialización explícita. |

El contenedor ejecuta Node con UID/GID `1000`. El volumen de versiones debe permitir escritura a ese usuario; el servidor web solo necesita lectura. El contenedor inicializador prepara la propiedad del volumen antes de arrancar el publicador.

## Webhook

En el repositorio autorizado, configurar un webhook para eventos **push** con tipo `application/json`, URL `https://DOMINIO/publish/webhook` y el secreto montado en el servicio. El evento **ping** se verifica y responde sin construir. El servicio comprueba la firma HMAC SHA-256 del cuerpo original, el repositorio y la rama; ignora ramas ajenas y elimina entregas repetidas durante siete días, hasta un máximo de 5.000 identificadores.

Un cambio aceptado devuelve `202`. La cola persiste antes de registrar la entrega, recupera trabajo pendiente tras un reinicio y ejecuta como máximo una construcción. Durante una construcción, los nuevos cambios quedan agrupados para una siguiente sincronización con la última revisión de la rama. El commit recibido en el payload nunca se ejecuta directamente.

Un error transitorio conserva el lote pendiente y programa hasta tres reintentos después del intento inicial, con esperas predeterminadas de 5, 10 y 20 segundos. El lote, el número de fallos y la hora del siguiente intento quedan persistidos: reiniciar conserva la espera y los intentos restantes. Al agotar los intentos, una redelivery firmada de ese lote puede encolarlo nuevamente. Las entregas pendientes, en construcción o ya publicadas continúan deduplicadas; una publicación posterior de la rama sustituye el lote fallido anterior. El resultado `retrying` y `nextRetryAt` aparecen en el estado local de salud. El reintento no cambia la versión pública hasta completar y validar una construcción.

## Construcción y activación

La secuencia fija es:

1. Descargar la rama autorizada mediante Git HTTPS sin solicitudes interactivas.
2. Restaurar un checkout limpio de la revisión descargada.
3. Ejecutar `npm ci --include=dev --no-audit --no-fund` en la raíz y en `documentation`.
4. Ejecutar `npm run build:production -- --output DIRECTORIO_TEMPORAL --base-url ORIGEN_PUBLICO`.
5. Comprobar HTML principal, español e inglés, documentación en ambos idiomas, panel CMS y `site-manifest.json`.
6. Rechazar enlaces simbólicos en la salida y activar `current` mediante una sustitución atómica.

Git recibe el token mediante `GIT_ASKPASS`, nunca mediante argumentos, URL o logs. Los procesos npm no reciben variables de autenticación Git. Los comandos se ejecutan sin shell y su salida no se expone en los logs. El contenido del repositorio incluye código de construcción: únicamente el administrador autorizado debe tener permisos para cambiarlo.

Si la descarga, instalación, construcción o validación falla, la versión anterior continúa disponible. Un error de limpieza conserva versiones adicionales. El servicio registra un resultado básico y una fase de error sin secretos. `GET /publish/health` devuelve disponibilidad y estado de cola, no configuración privada.

## Operación local

Estos comandos requieren acceso al servidor o al contenedor y no tienen equivalente HTTP:

```sh
docker compose exec publisher node /app/cli.mjs publish
docker compose exec publisher node /app/cli.mjs list
docker compose exec publisher node /app/cli.mjs rollback release-AAAAMMDDHHMMSS-COMMIT
```

La publicación y el rollback comparten un bloqueo. Sus metadatos completos se instalan mediante un hardlink exclusivo para evitar un archivo de bloqueo truncado si el proceso se interrumpe. El bloqueo identifica la instancia del proceso, por lo que se recupera cuando un contenedor reinicia reutilizando el PID. La recuperación se serializa para impedir que dos procesos eliminen el bloqueo nuevo del otro. Un bloqueo inválido de una versión anterior, o un archivo `publish.lock.recovery` dejado por una recuperación interrumpida, se conserva y requiere inspección local con el publicador detenido; no se elimina un bloqueo cuyo propietario pueda seguir vivo. Un rollback activa únicamente una versión existente que supera la validación.

La inicialización se realiza con `node /app/bootstrap.mjs` y `PUBLISHER_SEED_PATH=/opt/seed`. Si existe `current`, conserva la versión instalada; si no, copia y valida el paquete inicial antes de activarlo como `release-seed`.

## Pruebas

```sh
node --test ops/publisher/test/*.test.mjs
docker run --rm --mount type=bind,source="$PWD",target=/workspace,readonly --workdir /workspace node:24-bookworm-slim node --test ops/publisher/test/*.test.mjs
```

La suite cubre firmas alteradas, repositorio/rama, límites de cuerpo, duplicados persistentes, fallo de escritura de cola, concurrencia, reintentos acotados y recuperación de su espera, redelivery después de agotamiento, recuperación de PID, adquisición y recuperación simultánea del bloqueo, publicación, conservación de la versión anterior y aislamiento de credenciales. Las pruebas de enlaces simbólicos se ejecutan completas en Linux; Windows sin privilegios de enlaces simbólicos informa esas dos pruebas como omitidas.
