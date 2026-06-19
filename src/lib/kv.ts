/**
 * Módulo de persistencia para suscripciones Web Push.
 *
 * Dos modos de operación:
 * - **Producción (Vercel)**: usa Upstash Redis (migrado desde Vercel KV) cuando
 *   las env vars `UPSTASH_REDIS_REST_URL` o `KV_REST_API_URL` están presentes.
 * - **Local**: usa `data/subscriptions.json` como respaldo, así podés probar
 *   todo el flujo de notificaciones sin necesidad de Redis.
 *
 * Cada suscripción es única por endpoint (dedup automático).
 *
 * @module kv
 */

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Determinación del modo
// ---------------------------------------------------------------------------

/**
 * `true` si estamos en Vercel (o las env vars de Redis están configuradas).
 *
 * Soporta tanto los nombres nuevos de Upstash Redis como los legacy de Vercel KV:
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN  (nuevos)
 *   KV_REST_API_URL / KV_REST_API_TOKEN                  (legacy)
 * Si falta alguna, usamos archivo local automáticamente.
 */
const REDIS_URL =
  (import.meta.env.UPSTASH_REDIS_REST_URL as string | undefined) ||
  (import.meta.env.KV_REST_API_URL as string | undefined);

const REDIS_TOKEN =
  (import.meta.env.UPSTASH_REDIS_REST_TOKEN as string | undefined) ||
  (import.meta.env.KV_REST_API_TOKEN as string | undefined);

const USE_REDIS = !!(REDIS_URL && REDIS_TOKEN);

/** Cliente Upstash Redis — lazy: solo se inicializa si estamos en modo Redis */
let redisClient: import('@upstash/redis').Redis | null = null;

/**
 * Retorna el cliente de Upstash Redis, cargándolo bajo demanda.
 * Esto evita que @upstash/redis valide env vars al importar el módulo.
 */
async function getRedis() {
  if (!redisClient) {
    const { Redis } = await import('@upstash/redis');
    redisClient = new Redis({ url: REDIS_URL!, token: REDIS_TOKEN! });
  }
  return redisClient;
}

/** Archivo local para desarrollo — solo se usa cuando NO hay Redis configurado */
const LOCAL_FILE = path.resolve(process.cwd(), 'data', 'subscriptions.json');

// ---------------------------------------------------------------------------
// Clave única en Redis
// ---------------------------------------------------------------------------
const SUBSCRIPTIONS_KEY = 'push_subscriptions';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** Par de llaves criptográficas que el navegador genera para la suscripción push. */
export interface PushSubscriptionKeys {
  auth: string;
  p256dh: string;
}

/** Estructura de una suscripción push tal como la envía el browser (PushSubscriptionJSON). */
export interface PushSubscriptionJSON {
  endpoint: string;
  keys: PushSubscriptionKeys;
}

// ---------------------------------------------------------------------------
// Helpers para modo local (archivo JSON)
// ---------------------------------------------------------------------------

function readLocalSubscriptions(): PushSubscriptionJSON[] {
  if (!fs.existsSync(LOCAL_FILE)) return [];
  try {
    const raw = fs.readFileSync(LOCAL_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeLocalSubscriptions(subs: PushSubscriptionJSON[]): void {
  fs.writeFileSync(LOCAL_FILE, JSON.stringify(subs, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Operaciones CRUD
// ---------------------------------------------------------------------------

/**
 * Guarda una nueva suscripción push si no existe ya (dedup por endpoint).
 *
 * @param subscription - Objeto PushSubscriptionJSON enviado por el navegador.
 *
 * Nota: Si el endpoint ya está registrado, la operación es un no-op.
 * Esto evita duplicados cuando un usuario abre múltiples pestañas.
 */
export async function saveSubscription(
  subscription: PushSubscriptionJSON
): Promise<void> {
  const subscriptions = await getAllSubscriptions();
  const exists = subscriptions.some((s) => s.endpoint === subscription.endpoint);

  if (!exists) {
    subscriptions.push(subscription);

    if (USE_REDIS) {
      const redis = await getRedis();
      await redis.set(SUBSCRIPTIONS_KEY, subscriptions);
    } else {
      writeLocalSubscriptions(subscriptions);
    }
  }
}

/**
 * Retorna todas las suscripciones activas.
 *
 * @returns Array de suscripciones, vacío si no hay ninguna o si el almacén no responde.
 */
export async function getAllSubscriptions(): Promise<PushSubscriptionJSON[]> {
  if (USE_REDIS) {
    try {
      const redis = await getRedis();
      const data = await redis.get<PushSubscriptionJSON[]>(SUBSCRIPTIONS_KEY);
      return data ?? [];
    } catch {
      return [];
    }
  }

  // Modo local — archivo JSON
  return readLocalSubscriptions();
}

/**
 * Elimina una suscripción por su endpoint.
 *
 * @param endpoint - URL única que identifica la suscripción (ej: "https://fcm.googleapis.com/...").
 *
 * Esta función se llama cuando:
 * - El usuario hace clic en "Desuscribirse".
 * - El endpoint devuelve 410 Gone al enviar una notificación (suscripción expirada).
 *
 * Es idempotente: si el endpoint no existe, no falla.
 */
export async function deleteSubscription(endpoint: string): Promise<void> {
  const subscriptions = await getAllSubscriptions();
  const filtered = subscriptions.filter((s) => s.endpoint !== endpoint);

  if (USE_REDIS) {
    const redis = await getRedis();
    await redis.set(SUBSCRIPTIONS_KEY, filtered);
  } else {
    writeLocalSubscriptions(filtered);
  }
}
