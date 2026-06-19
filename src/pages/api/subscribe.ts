/**
 * API Route: POST /api/subscribe
 *
 * Recibe una suscripción Web Push desde el navegador y la persiste en Vercel KV.
 * El frontend llama a este endpoint después de que el usuario otorga permiso
 * y el navegador genera el PushSubscription.
 *
 * @body {PushSubscriptionJSON} — endpoint, keys.auth, keys.p256dh
 * @returns {object} 200 — { success: true }
 * @returns {object} 400 — { error: string } si falta algún campo requerido
 *
 * @module api/subscribe
 */

import type { APIRoute } from 'astro';
import { saveSubscription } from '../../lib/kv';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();

    // Validación básica: los 3 campos que PushSubscriptionJSON requiere
    if (!body.endpoint || !body.keys?.auth || !body.keys?.p256dh) {
      return new Response(
        JSON.stringify({ error: 'Suscripción push inválida — faltan campos requeridos' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    await saveSubscription(body);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(
      JSON.stringify({ error: 'Servicio de suscripciones no disponible' }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
