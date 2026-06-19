/**
 * Módulo de persistencia para suscripciones Web Push.
 *
 * Usa Vercel KV (Redis) para almacenar los objetos PushSubscription que el
 * navegador envía al suscribirse. Cada suscripción es única por endpoint.
 *
 * @module kv
 */

import { kv } from '@vercel/kv';

// ---------------------------------------------------------------------------
// Clave única en Redis — todo el conjunto de suscripciones vive bajo esta key.
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
    await kv.set(SUBSCRIPTIONS_KEY, JSON.stringify(subscriptions));
  }
}

/**
 * Retorna todas las suscripciones activas.
 *
 * @returns Array de suscripciones, vacío si no hay ninguna o si KV no responde.
 *
 * Edge cases:
 * - KV caído → retorna array vacío (degradación graceful, el dashboard sigue andando).
 * - Sin suscripciones → array vacío.
 */
export async function getAllSubscriptions(): Promise<PushSubscriptionJSON[]> {
  try {
    const data = await kv.get<string>(SUBSCRIPTIONS_KEY);
    if (!data) return [];
    return typeof data === 'string' ? JSON.parse(data) : data;
  } catch {
    return [];
  }
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
  await kv.set(SUBSCRIPTIONS_KEY, JSON.stringify(filtered));
}
