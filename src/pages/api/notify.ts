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
 * @body {object} Opcional. `{ changes: [{ slug: string, title: string }] }` — lista de landings
 *   que cambiaron. Si se provee, la notificación muestra los nombres específicos.
 * @returns {object} 200 — { sent: number, failed: number }
 * @returns {object} 401 — { error: "No autorizado" }
 *
 * Uso típico desde GitHub Action (con cambios específicos):
 *   curl -X POST https://<vercel-app>/api/notify \
 *     -H "Authorization: Bearer $NOTIFY_SECRET" \
 *     -H "Content-Type: application/json" \
 *     -d '{ "changes": [{ "slug": "prepago-movil", "title": "Prepago Móvil", "autor": "Javier Castro", "commit": "abc123f..." }] }'
 *
 * @module api/notify
 */

import type { APIRoute } from 'astro';
import { getAllSubscriptions, deleteSubscription } from '../../lib/kv';
import { sendPushNotifications } from '../../lib/push';

interface ChangeInfo {
  slug: string;
  title: string;
  autor?: string;   // Quién deployó
  commit?: string;  // SHA del commit
}

/**
 * Construye el título y cuerpo de la notificación según las landings cambiadas.
 *
 * - Si hay cambios específicos: los nombra (máximo 2, después "y N más").
 * - Para 1 cambio: incluye autor y SHA corto en el body.
 * - Si no hay cambios (--force-notify): mensaje genérico.
 *
 * @param changes - Lista de landings que cambiaron (slug, title, autor?, commit?).
 * @returns {{ title: string, body: string, url: string }}
 */
function buildNotification(changes: ChangeInfo[]) {
  const count = changes.length;

  if (count === 0) {
    return {
      title: '🔄 Landings actualizadas',
      body: 'Se detectaron cambios en las landings registradas.',
      url: '/',
    };
  }

  if (count === 1) {
    const c = changes[0];
    let body = `Nuevo deploy en ${c.title}`;
    if (c.autor) body += ` por ${c.autor}`;
    if (c.commit) body += ` (${c.commit.slice(0, 7)})`;
    body += '.';
    return {
      title: `🔄 ${c.title} se actualizó`,
      body,
      url: `/landing/${c.slug}`,
    };
  }

  if (count === 2) {
    return {
      title: `🔄 ${changes[0].title} y ${changes[1].title} se actualizaron`,
      body: `Se detectaron nuevos deploys en ${changes[0].title} y ${changes[1].title}.`,
      url: '/',
    };
  }

  // 3 o más: nombrar las primeras 2 + "y N más"
  const restas = count - 2;
  return {
    title: `🔄 ${changes[0].title}, ${changes[1].title} y ${restas} más`,
    body: `Se detectaron nuevos deploys en ${count} landings.`,
    url: '/',
  };
}

export const POST: APIRoute = async ({ request }) => {
  // ---------------------------------------------------------------------------
  // 1. Validación del token de autorización
  // ---------------------------------------------------------------------------
  const authHeader = request.headers.get('Authorization');
  const expectedSecret = import.meta.env.NOTIFY_SECRET as string | undefined;

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
  // 3. Leer cambios del body (opcional)
  // ---------------------------------------------------------------------------
  /** @type {ChangeInfo[]} */
  let changes: ChangeInfo[] = [];

  try {
    const body = await request.clone().json();
    if (Array.isArray(body.changes)) {
      changes = body.changes;
    }
  } catch {
    // Sin body o body inválido → notificación genérica
  }

  // ---------------------------------------------------------------------------
  // 4. Construir payload específico
  // ---------------------------------------------------------------------------
  const { title, body, url } = buildNotification(changes);

  const payload = JSON.stringify({
    title,
    body,
    url,
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: changes.length > 0 ? `landing-${changes[0].slug}` : 'landing-update',
  });

  console.log(`[notify] Notificación: "${title}" — ${changes.length} cambio(s)`);

  const result = await sendPushNotifications(subscriptions, payload);

  // ---------------------------------------------------------------------------
  // 5. Limpiar suscripciones expiradas (410 Gone / 404 Not Found)
  // ---------------------------------------------------------------------------
  // sendPushNotifications devuelve los endpoints que respondieron con 410/404
  // en result.gone. Los eliminamos del KV para no reintentar en el próximo ciclo.
  for (const endpoint of result.gone) {
    await deleteSubscription(endpoint);
  }

  // ---------------------------------------------------------------------------
  // 6. Respuesta
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
