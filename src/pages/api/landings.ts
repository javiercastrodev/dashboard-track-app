/**
 * API Route: GET /api/landings
 *
 * Retorna el listado completo de landings con su última actualización.
 * El frontend (dashboard) consume este endpoint para hidratar la tabla.
 *
 * @returns {object} 200 — { landings: Landing[], lastUpdated: string }
 * @returns {object} 500 — { error: string } si hay problemas de parseo
 *
 * @module api/landings
 */

import type { APIRoute } from 'astro';
import { getAllLandings } from '../../lib/landings';

export const GET: APIRoute = async () => {
  try {
    const data = await getAllLandings();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Error al cargar las landings' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
