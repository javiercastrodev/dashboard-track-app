/**
 * API Route: POST /api/notify
 *
 * Endpoint protegido que el GitHub Action de polling invoca cuando detecta
 * cambios en las landings. Envía notificaciones push a todas las suscripciones
 * activas y limpia aquellas que hayan expirado (410 Gone / 404 Not Found).
 *
 * Seguridad:
 * - Requiere header `Authorization: Bearer <token>` donde <token> debe coincidir
 *   con la variable de entorno `NOTIFY_SECRET`.
 * - Si el token falta o es incorrecto → 401 { error: "No autorizado" }
 *
 * @body vacío (no requiere body)
 * @returns {object} 200 — { sent: number, failed: number }
 * @returns {object} 401 — { error: "No autorizado" }
 *
 * Uso típico desde GitHub Action:
 *   curl -X POST https://<vercel-app>/api/notify \
 *     -H "Authorization: Bearer $NOTIFY_SECRET"
 *
 * @module api/notify
 */

import type { APIRoute } from 'astro';
import { getAllSubscriptions, deleteSubscription } from '../../lib/kv';
import { sendPushNotifications } from '../../lib/push';

export const POST: APIRoute = async ({ request }) => {
  // ---------------------------------------------------------------------------
  // 1. Validación del token de autorización
  // ---------------------------------------------------------------------------
  const authHeader = request.headers.get('Authorization');
  const expectedSecret = process.env.NOTIFY_SECRET;

  if (!expectedSecret) {
    // Si no hay secret configurado en el entorno, rechazamos por seguridad.
    // Esto evita que el endpoint quede abierto accidentalmente.
    return new Response(
      JSON.stringify({ error: 'No autorizado' }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token || token !== expectedSecret) {
    return new Response(
      JSON.stringify({ error: 'No autorizado' }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // ---------------------------------------------------------------------------
  // 2. Cargar suscripciones activas
  // ---------------------------------------------------------------------------
  // Si no hay suscriptores, el resultado es { sent: 0, failed: 0 } sin errores.
  const subscriptions = await getAllSubscriptions();

  if (subscriptions.length === 0) {
    return new Response(
      JSON.stringify({ sent: 0, failed: 0 }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // ---------------------------------------------------------------------------
  // 3. Enviar notificaciones
  // ---------------------------------------------------------------------------
  // El payload es un JSON que el service worker va a recibir y mostrar.
  // El TTL de 300s (5 min) es el mismo que usa push.ts por defecto.
  const payload = JSON.stringify({
    title: '🔄 Landings actualizadas',
    body: 'Se detectaron cambios en las landings registradas.',
    url: '/',
    icon: '/favicon.svg',
  });

  const result = await sendPushNotifications(subscriptions, payload);

  // ---------------------------------------------------------------------------
  // 4. Limpiar suscripciones expiradas (410 Gone / 404 Not Found)
  // ---------------------------------------------------------------------------
  // sendPushNotifications devuelve los endpoints que respondieron con 410/404
  // en result.gone. Los eliminamos del KV para no reintentar en el próximo ciclo.
  for (const endpoint of result.gone) {
    await deleteSubscription(endpoint);
  }

  // ---------------------------------------------------------------------------
  // 5. Respuesta
  // ---------------------------------------------------------------------------
  return new Response(
    JSON.stringify({
      sent: result.successful.length,
      failed: result.failed.length,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
};
