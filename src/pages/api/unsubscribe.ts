/**
 * API Route: POST /api/unsubscribe
 *
 * Elimina una suscripción Web Push de Vercel KV usando su endpoint como ID.
 * Se llama cuando el usuario hace clic en "Desuscribirse" en el dashboard.
 *
 * También lo usa internamente el módulo push.ts después de detectar
 * un endpoint 410 Gone (suscripción expirada o app desinstalada).
 *
 * @body {{ endpoint: string }} — URL única de la suscripción a eliminar
 * @returns {object} 200 — { success: true } (idempotente: si no existe, igual OK)
 * @returns {object} 400 — { error: string } si falta el endpoint
 *
 * @module api/unsubscribe
 */

import type { APIRoute } from 'astro';
import { deleteSubscription } from '../../lib/kv';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();

    if (!body.endpoint) {
      return new Response(
        JSON.stringify({ error: 'Falta el endpoint de la suscripción' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    await deleteSubscription(body.endpoint);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(
      JSON.stringify({ error: 'Cuerpo de solicitud inválido' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
