# Tracking Dashboard

Dashboard público que centraliza el estado de deploy de todas las landings del org HV-DEV-HTML. Construido con Astro SSR, desplegado en Vercel.

## Stack

| Capa        | Tecnología                          |
| ----------- | ----------------------------------- |
| Framework   | Astro 6 (SSR, server output)        |
| UI          | Tailwind CSS v4, vanilla JS         |
| Adapter     | Vercel (`@astrojs/vercel`)          |
| Persistencia| Vercel KV (Upstash Redis) / JSON local |
| Push        | Web Push API + `web-push` + VAPID   |
| GitHub API  | Octokit                             |
| Automación  | GitHub Actions (polling cron)       |

## Primeros pasos

### 1. Clonar e instalar

```bash
pnpm install
```

### 2. Variables de entorno

Copiar `.env.example` a `.env` y completar:

```bash
cp .env.example .env
```

| Variable              | Obligatoria | Descripción                                          |
| --------------------- | ----------- | ---------------------------------------------------- |
| `PUBLIC_VAPID_KEY`    | ✅          | Clave VAPID pública (cliente — prefijo PUBLIC_)      |
| `VAPID_PUBLIC_KEY`    | ✅          | Clave VAPID pública (server)                         |
| `VAPID_PRIVATE_KEY`   | ✅          | Clave VAPID privada                                  |
| `VAPID_SUBJECT`       | ✅          | Mailto de contacto (`mailto:tu@email.com`)           |
| `NOTIFY_SECRET`       | ✅          | Token secreto para POST /api/notify                  |
| `NOTIFY_URL`          | ✅          | URL base del sitio (local: `http://localhost:4321`)   |
| `GH_PAT`              | ✅          | GitHub Personal Access Token con acceso al org       |
| `KV_URL`              | ❌ (local)  | URL de Upstash Redis (comentar para desarrollo local) |
| `KV_REST_TOKEN`       | ❌ (local)  | Token REST de Upstash                                |
| `KV_REST_API_URL`     | ❌ (local)  | URL REST de Upstash                                  |

> **Astro 6**: las variables de entorno se leen con `import.meta.env`, no con `process.env`. Las variables con prefijo `PUBLIC_` se exponen al cliente.

### 3. Generar llaves VAPID

```bash
npx web-push generate-vapid-keys --json
```

Agregar los valores a `.env` tanto como `PUBLIC_VAPID_KEY` (cliente) como `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` (servidor). Ambas claves públicas DEBEN ser el mismo valor.

### 4. Desarrollo local

```bash
pnpm dev
```

Abrir `http://localhost:4321`.

### 5. Probar notificaciones push

En otra terminal:

```bash
pnpm poll:notify
```

El servidor envía una notificación a todos los suscriptores. Verifica que el Service Worker esté activo (Chrome Dev Tools → Application → Service Workers).

#### Debugging de push

- **Chrome Dev Tools "Push" button**: solo testea el handler del SW, **bypassea FCM**. Útil para probar la lógica del SW pero no el envío completo.
- **`chrome://gcm-internals/`**: herramienta definitiva. Si un push llega a Chrome, aparece en el Receive Message Log. Si no aparece, FCM nunca lo entregó.
- **SW logs**: Dev Tools → Console → dropdown "top" → seleccionar `sw.js`.
- **Reset completo**: si después de varios ciclos de debug las notificaciones no llegan, ir a Dev Tools → Application → **Clear site data** → re-suscribirse.

## Scripts disponibles

| Comando             | Descripción                                         |
| ------------------- | --------------------------------------------------- |
| `pnpm dev`          | Servidor de desarrollo Astro                        |
| `pnpm build`        | Build de producción                                 |
| `pnpm preview`      | Vista previa del build local                        |
| `pnpm poll`         | Ejecuta el poll manualmente (sin notificar)         |
| `pnpm poll:notify`  | Ejecuta el poll y fuerza notificación push          |

## Arquitectura

### Rutas

| Ruta                    | Descripción                                          |
| ----------------------- | ---------------------------------------------------- |
| `/`                     | Listado principal de landings                        |
| `/landing/[slug]`       | Detalle de una landing                               |
| `/subscribe`            | Página de suscripción a notificaciones               |
| `POST /api/landings`    | Lista todas las landings (JSON)                      |
| `POST /api/subscribe`   | Guarda suscripción push                              |
| `POST /api/unsubscribe` | Elimina suscripción push                             |
| `POST /api/notify`      | Envía push a todos los suscriptores (protegido)      |
| `GET /api/test-notification` | Envía push de prueba                            |

### API de notificaciones

`POST /api/notify` requiere header `Authorization: Bearer <NOTIFY_SECRET>`. Flujo:

1. Valida el token
2. Carga suscripciones activas desde KV (o `data/subscriptions.json` en local)
3. Envía push con `web-push` (TTL: 300s, content encoding: aes128gcm)
4. Limpia suscripciones expiradas (410 Gone)

### Service Worker

`public/sw.js` — maneja eventos `push` y `notificationclick`:

- `push`: recibe el payload JSON, muestra notificación con `showNotification()`
- `notificationclick`: cierra la notificación y abre/enfoca la URL indicada
- `install`: llama a `self.skipWaiting()` para activar el SW inmediatamente
- `activate`: llama a `clients.claim()` para controlar todos los clients

### Automación (GitHub Actions)

`.github/workflows/poll-landings.yml` — workflow programado que:

1. Cada 30 minutos consulta los repos del org HV-DEV-HTML
2. Compara `cms-deploy.json` entre cada repo y el caché local
3. Si hay cambios, actualiza `data/landings.json` y hace commit + push
4. Notifica a los suscriptores vía `POST /api/notify`

Las variables de entorno se pasan como secrets de GitHub Action:

| Secret           | Fuente                 |
| ---------------- | ---------------------- |
| `NOTIFY_URL`     | Variable del workflow  |
| `NOTIFY_SECRET`  | Secret del repo        |
| `GH_PAT`         | Secret del repo        |

### Persistencia

- **Local**: `data/subscriptions.json` (archivo JSON plano)
- **Producción**: Vercel KV (Upstash Redis)

El módulo `src/lib/kv.ts` auto-detecta: si `KV_URL` está definida usa `@vercel/kv`, si no usa el archivo local.

## Consideraciones técnicas

### VAPID y renovación de suscripciones

- Chrome renueva silenciosamente los registros GCM. Si después de debuggear mucho las notificaciones dejan de llegar, hacer **clear site data** completo.
- Al cambiar las llaves VAPID, los usuarios deben desuscribirse (click en "Desuscribirse") y volver a suscribirse.

### Tailwind CSS v4

Usa `@import "tailwindcss"` y `@custom-variant dark` en lugar de las directivas `@tailwind` de v3. Ver `src/styles/global.css`.

### Modo oscuro

Toggle con persistencia en `localStorage`. El tema se aplica via clase `dark` en `<html>`. Componente: `ThemeToggle.astro`.
