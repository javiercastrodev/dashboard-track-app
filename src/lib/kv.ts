/**
 * Módulo de persistencia para suscripciones Web Push.
 *
 * Dos modos de operación:
 * - **Producción (Vercel)**: usa Vercel KV (Redis) cuando la env var `KV_URL` está presente.
 * - **Local**: usa `data/subscriptions.json` como respaldo, así podés probar
 *   todo el flujo de notificaciones sin necesidad de Vercel KV.
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
 * `true` si estamos en Vercel (o las env vars de KV están configuradas).
 * 
 * Para usar Vercel KV se requieren las 3 variables:
 *   KV_URL, KV_REST_API_URL, KV_REST_API_TOKEN
 * Si falta alguna, usamos archivo local automáticamente.
 */
const USE_VERCEL_KV = !!(
  (import.meta.env.KV_URL as string | undefined) &&
  (import.meta.env.KV_REST_API_URL as string | undefined) &&
  (import.meta.env.KV_REST_API_TOKEN as string | undefined)
);

/** Cliente Vercel KV — lazy: solo se inicializa si estamos en modo Vercel KV */
let kvClient: Awaited<typeof import('@vercel/kv')>['kv'] | null = null;

/**
 * Retorna el cliente de Vercel KV, cargándolo bajo demanda.
 * Esto evita que @vercel/kv valide env vars al importar el módulo.
 */
async function getKv() {
  if (!kvClient) {
    kvClient = (await import('@vercel/kv')).kv;
  }
  return kvClient;
}

/** Archivo local para desarrollo — solo se usa cuando NO hay KV_URL */
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

    if (USE_VERCEL_KV) {
      const kv = await getKv();
      await kv.set(SUBSCRIPTIONS_KEY, JSON.stringify(subscriptions));
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
  if (USE_VERCEL_KV) {
    try {
      const kv = await getKv();
      const data = await kv.get<string>(SUBSCRIPTIONS_KEY);
      if (!data) return [];
      return typeof data === 'string' ? JSON.parse(data) : data;
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

  if (USE_VERCEL_KV) {
    const kv = await getKv();
    await kv.set(SUBSCRIPTIONS_KEY, JSON.stringify(filtered));
  } else {
    writeLocalSubscriptions(filtered);
  }
}
