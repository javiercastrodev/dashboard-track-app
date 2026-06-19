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

Las llaves VAPID se generan **una sola vez de forma local** y se usan en todos los ambientes (local, preview, producción). Son un par de llaves asimétricas como SSH — el navegador las usa para verificar que el servidor que envía el push es el mismo que autorizó durante la suscripción.

```bash
npx web-push generate-vapid-keys --json
```

Esto devuelve un objeto con `publicKey` y `privateKey`.

Configurar **las mismas llaves** en tres lugares:

| Variable              | Dónde va               | Valor                        |
| --------------------- | ---------------------- | ---------------------------- |
| `PUBLIC_VAPID_KEY`    | `.env` + Vercel env    | `publicKey` generada         |
| `VAPID_PUBLIC_KEY`    | `.env` + Vercel env    | `publicKey` generada (LA MISMA) |
| `VAPID_PRIVATE_KEY`   | `.env` + Vercel env    | `privateKey` generada        |

> **Importante**: `PUBLIC_VAPID_KEY` y `VAPID_PUBLIC_KEY` deben tener EXACTAMENTE el mismo valor. La primera se expone al cliente (prefijo `PUBLIC_`), la segunda se usa del lado servidor. Si no coinciden, FCM acepta el push pero Chrome nunca lo muestra (ver sección [Deploy en Vercel → Troubleshooting](#8-troubleshooting)).

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

## Deploy en Vercel

### 1. Proyecto en Vercel

- Importar el repositorio desde Vercel
- **Framework Preset**: Astro (se auto-detecta)
- **Build Command**: `astro build` (por defecto)
- **Output Directory**: `dist`
- **Node Version**: 20+
- **Package Manager**: `pnpm` (Vercel lo detecta por el `pnpm-lock.yaml`)

No requiere `vercel.json` — el adapter `@astrojs/vercel` configura todo automáticamente.

### 2. Variables de entorno en Vercel

Agregar TODAS las variables de `.env.example` como **Environment Variables** en el proyecto de Vercel:

| Variable              | Dónde crearla                   |
| --------------------- | ------------------------------- |
| `PUBLIC_VAPID_KEY`    | Production + Preview            |
| `VAPID_PUBLIC_KEY`    | Production + Preview            |
| `VAPID_PRIVATE_KEY`   | Production + Preview            |
| `VAPID_SUBJECT`       | Production + Preview            |
| `NOTIFY_SECRET`       | Production + Preview            |
| `NOTIFY_URL`          | `https://tudominio.com` (producción) / `https://preview.vercel.app` (preview) |
| `GH_PAT`              | Sólo Production                 |
| `KV_URL`              | Production + Preview            |
| `KV_REST_TOKEN`       | Production + Preview            |
| `KV_REST_API_URL`     | Production + Preview            |

> **NOTIFY_URL** debe apuntar a la URL del deploy correspondiente (producción o preview). Es la URL que usa el GitHub Action para llamar a `/api/notify`.

### 3. Vercel KV (Upstash Redis)

El proyecto usa persistencia para las suscripciones push:

1. Ir a **Storage** en el dashboard de Vercel
2. Crear una base **KV** (Upstash Redis)
3. Vercel inyecta automáticamente `KV_URL`, `KV_REST_TOKEN` y `KV_REST_API_URL` como variables de entorno
4. No hace falta copiarlas manualmente — Vercel las agrega solas al proyecto vinculado

En desarrollo local, las variables KV deben estar comentadas en `.env` para que el módulo `src/lib/kv.ts` caiga al fallback de `data/subscriptions.json`.

### 4. Dominio personalizado

- Ir a **Project Settings → Domains**
- Agregar el dominio (ej: `tracking.claro.com.pe`)
- Seguir las instrucciones de DNS (CNAME apuntando a `cname.vercel-dns.com`)

### 5. Autenticación de notificaciones push

Las notificaciones push requieren **HTTPS** obligatoriamente. Los preview deployments de Vercel (`.vercel.app`) ya incluyen HTTPS, al igual que los dominios personalizados con certificado automático.

### 6. Sincronizar secrets con GitHub Actions

El workflow `.github/workflows/poll-landings.yml` necesita estas variables como **GitHub Actions secrets**:

```bash
gh secret set NOTIFY_SECRET --repo HV-DEV-HTML/tracking-dashboard
gh secret set GH_PAT --repo HV-DEV-HTML/tracking-dashboard
gh variable set NOTIFY_URL --repo HV-DEV-HTML/tracking-dashboard
```

O desde la UI: **Settings → Secrets and variables → Actions**.

### 7. Verificar el deploy

```bash
# Build local para validar
pnpm build

# Probar que el endpoint de notificaciones responde
curl -X POST https://tudominio.vercel.app/api/notify \
  -H "Authorization: Bearer $NOTIFY_SECRET"
```

### 8. Troubleshooting

| Síntoma                     | Causa probable                          | Solución                              |
| --------------------------- | --------------------------------------- | ------------------------------------- |
| Build falla                 | Node version incorrecta                 | En Vercel, fijar Node 20+ en Settings |
| 401 en `/api/notify`        | `NOTIFY_SECRET` no coincide             | Verificar variable en Vercel vs GHA   |
| Push no llega al browser    | `PUBLIC_VAPID_KEY` y `VAPID_PUBLIC_KEY` no coinciden | Ambas deben tener el mismo valor. Si se cambiaron, los usuarios deben desuscribirse y volver a suscribirse |
| KV vacío o error 503        | KV_URL no está configurada              | Conectar storage KV en Vercel          |
| Las landing no se actualizan| GH_PAT sin acceso o expirado           | Regenerar token en GitHub             |

## Consideraciones técnicas

### VAPID y renovación de suscripciones

- Chrome renueva silenciosamente los registros GCM. Si después de debuggear mucho las notificaciones dejan de llegar, hacer **clear site data** completo.
- Al cambiar las llaves VAPID, los usuarios deben desuscribirse (click en "Desuscribirse") y volver a suscribirse.

### Tailwind CSS v4

Usa `@import "tailwindcss"` y `@custom-variant dark` en lugar de las directivas `@tailwind` de v3. Ver `src/styles/global.css`.

### Modo oscuro

Toggle con persistencia en `localStorage`. El tema se aplica via clase `dark` en `<html>`. Componente: `ThemeToggle.astro`.
