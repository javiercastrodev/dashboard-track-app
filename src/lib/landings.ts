/**
 * Módulo de acceso a datos de landings.
 *
 * Fuente única de verdad: `data/landings.json`, un archivo JSON versionado en git.
 * El GitHub Action de polling lo actualiza automáticamente; acá solo lo leemos.
 *
 * @module landings
 */

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** Datos de una landing individual, combinados desde landing.config.json + cms-deploy.json */
export interface Landing {
  slug: string;
  title: string;
  description?: string;
  url: string;
  lastChecked?: string;
  status?: string;
}

/** Estructura completa del archivo landings.json */
export interface LandingsData {
  landings: Landing[];
  lastUpdated: string;
}

// ---------------------------------------------------------------------------
// Lógica interna
// ---------------------------------------------------------------------------

/** Ruta absoluta al archivo JSON centralizado. Se resuelve contra el CWD del proceso (Vercel o local). */
const DATA_FILE = path.resolve(process.cwd(), 'data', 'landings.json');

/**
 * Retorna todas las landings registradas.
 *
 * @returns {LandingsData} Objeto con el array de landings y timestamp de la última actualización.
 *
 * Edge cases:
 * - Archivo inexistente → array vacío (primera ejecución antes del primer poll).
 * - Archivo es un array plano → lo envuelve en el formato esperado por retrocompatibilidad.
 * - JSON malformado → lanza error que la API route convierte en 500.
 */
export function getAllLandings(): LandingsData {
  if (!fs.existsSync(DATA_FILE)) {
    return { landings: [], lastUpdated: new Date().toISOString() };
  }

  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      return { landings: parsed, lastUpdated: new Date().toISOString() };
    }

    return parsed as LandingsData;
  } catch {
    throw new Error('Error al parsear landings.json — posible JSON corrupto');
  }
}

/**
 * Busca una landing por su slug.
 *
 * @param slug - Identificador único de la landing (ej: "prepago-movil").
 * @returns La landing encontrada o `null` si no existe.
 *
 * Útil para la página de detalle `/landing/:slug`.
 */
export function getLandingBySlug(slug: string): Landing | null {
  const { landings } = getAllLandings();
  return landings.find((l) => l.slug === slug) ?? null;
}
