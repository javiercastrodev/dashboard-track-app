/**
 * Módulo de envío de notificaciones Web Push.
 *
 * Usa el protocolo Web Push (RFC 8030) con VAPID para autenticar el servidor
 * ante los navegadores. Depende de las variables de entorno VAPID_*.
 *
 * @module push
 */

import webpush from 'web-push';

// ---------------------------------------------------------------------------
// Configuración VAPID
// ---------------------------------------------------------------------------
// VAPID (Voluntary Application Server Identification) permite al navegador
// verificar que el servidor que envía la notificación es el mismo que generó
// las llaves. Sin VAPID, los navegadores rechazan las notificaciones push.
//
// Cómo generar las llaves:
//   npx web-push generate-vapid-keys
//
// Las llaves VAN en las env vars del proyecto en Vercel. No se hardcodean.
// ---------------------------------------------------------------------------

const VAPID_SUBJECT =
  process.env.VAPID_SUBJECT ?? 'mailto:admin@tracking-dashboard.dev';
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? '';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** Estructura de una suscripción push (compatible con PushSubscriptionJSON de la Web Push API). */
export interface PushSubscriptionJSON {
  endpoint: string;
  keys: {
    auth: string;
    p256dh: string;
  };
}

/** Resultado del envío masivo de notificaciones. */
export interface PushResult {
  successful: string[]; // Endpoints que recibieron la notificación OK
  failed: string[];     // Endpoints que fallaron (timeout, error temporal)
  gone: string[];       // Endpoints 410 Gone — hay que eliminarlos del KV
}

// ---------------------------------------------------------------------------
// Función principal
// ---------------------------------------------------------------------------

/**
 * Envía una notificación push a una lista de suscripciones.
 *
 * @param subscriptions - Array de suscripciones activas.
 * @param payload - String JSON con el contenido de la notificación (title, body, url, icon).
 * @returns PushResult con el detalle de envíos exitosos, fallidos y expirados.
 *
 * Comportamiento:
 * - Las suscripciones con estado 410 Gone o 404 se reportan en `gone[]` para que
 *   el caller las elimine del KV (suscripción expirada o desinstalada).
 * - Los errores temporales (timeout, 429) se reportan en `failed[]` pero NO se eliminan.
 * - Cada suscripción tiene un TTL de 300s en el push service. Si el browser está offline,
 *   la notificación se entrega cuando vuelva (máximo 5 min de ventana).
 *
 * Uso típico:
 * ```ts
 * const subs = await getAllSubscriptions();
 * const result = await sendPushNotifications(subs, JSON.stringify(payload));
 * for (const endpoint of result.gone) {
 *   await deleteSubscription(endpoint);
 * }
 * ```
 */
export async function sendPushNotifications(
  subscriptions: PushSubscriptionJSON[],
  payload: string
): Promise<PushResult> {
  const result: PushResult = {
    successful: [],
    failed: [],
    gone: [],
  };

  const results = await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          sub as webpush.PushSubscription,
          payload,
          { TTL: 300 }
        );
        result.successful.push(sub.endpoint);
      } catch (err: unknown) {
        const wpErr = err as webpush.WebPushError;
        if (wpErr.statusCode === 410 || wpErr.statusCode === 404) {
          result.gone.push(sub.endpoint);
        } else {
          result.failed.push(sub.endpoint);
        }
      }
    })
  );

  return result;
}
