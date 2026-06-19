/**
 * API Route: POST /api/test-notification
 *
 * Envía una notificación push de prueba al usuario actual.
 * Útil para que PMs y Area Chiefs verifiquen que las notificaciones
 * funcionan correctamente en su navegador.
 *
 * Requiere que el usuario ya tenga una suscripción activa guardada en KV.
 * Si no hay suscripciones, devuelve un error amigable.
 *
 * @returns {object} 200 — { sent: number }
 * @returns {object} 500 — { error: string }
 *
 * @module api/test-notification
 */

import type { APIRoute } from 'astro';
import { getAllSubscriptions } from '../../lib/kv';
import { sendPushNotifications } from '../../lib/push';

export const POST: APIRoute = async () => {
  try {
    const subs = await getAllSubscriptions();

    if (subs.length === 0) {
      return new Response(
        JSON.stringify({
          error: 'No hay suscripciones activas. Activá las notificaciones primero desde la página de Suscripción.',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const payload = JSON.stringify({
      title: '🔔 Notificación de prueba',
      body: 'Si estás viendo esto, las notificaciones push funcionan correctamente.',
      url: '/',
    });

    const result = await sendPushNotifications(subs, payload);

    if (result.successful.length > 0) {
      // Limpiar suscripciones expiradas
      for (const endpoint of result.gone) {
        const { deleteSubscription } = await import('../../lib/kv');
        await deleteSubscription(endpoint);
      }

      return new Response(
        JSON.stringify({
          sent: result.successful.length,
          message: 'Notificación de prueba enviada correctamente.',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({
        error: 'No se pudo enviar la notificación de prueba. Las suscripciones pueden haber expirado.',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch {
    return new Response(
      JSON.stringify({ error: 'Error al enviar la notificación de prueba.' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
