/**
 * Módulo de acceso a datos de landings.
 *
 * Dos modos de operación (mismo patrón que `src/lib/kv.ts`):
 * - **Producción (Vercel)**: lee desde Upstash Redis (key `landings_data`) cuando
 *   las env vars `UPSTASH_REDIS_REST_URL` o `KV_REST_API_URL` están presentes. Así
 *   el dashboard refleja cambios al instante, sin esperar un rebuild de Vercel.
 * - **Local**: usa `data/landings.json` como respaldo, para desarrollar sin Redis.
 *
 * El GitHub Action de polling escribe la misma key/archivo; acá solo leemos.
 *
 * @module landings
 */

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** Información del último deploy registrado para una landing */
export interface DeployInfo {
  commit: string;       // Hash completo del commit (se muestra abreviado)
  branch: string;       // Rama desde la que se deployó
  timestamp: string;    // ISO string del momento del deploy
  autor: string;        // Nombre del autor del commit
  /** Mensaje del commit (se obtiene de GitHub API durante el polling) */
  message?: string;
}

/**
 * Datos de una landing individual.
 *
 * Combina información de landing.config.json + cms-deploy.json.
 * Los campos de deploy y links son opcionales porque el GitHub Action
 * de polling aún puede estar poblando datos gradualmente.
 */
export interface Landing {
  slug: string;
  title: string;
  description?: string;
  url: string;
  lastChecked?: string;
  status?: string;
  /** URL al repositorio de GitHub */
  github?: string;
  /** URL al dashboard de Mosaic (CMS) */
  mosaic?: string;
  /** URL directa al CMS */
  cmsUrl?: string;
  /** URL al proyecto en Basecamp */
  basecamp?: string;
  /** Información del último deploy (null si nunca se deployó) */
  lastDeploy?: DeployInfo | null;
}

/** Estructura completa del archivo landings.json */
export interface LandingsData {
  landings: Landing[];
  lastUpdated: string;
}

// ---------------------------------------------------------------------------
// Lógica interna
// ---------------------------------------------------------------------------

/**
 * Determinación del modo, igual que `src/lib/kv.ts`.
 *
 * Soporta tanto los nombres nuevos de Upstash Redis como los legacy de Vercel KV:
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN  (nuevos)
 *   KV_REST_API_URL / KV_REST_API_TOKEN                  (legacy)
 * Si falta alguna, usamos el archivo local automáticamente.
 */
const REDIS_URL =
  (import.meta.env.UPSTASH_REDIS_REST_URL as string | undefined) ||
  (import.meta.env.KV_REST_API_URL as string | undefined);

const REDIS_TOKEN =
  (import.meta.env.UPSTASH_REDIS_REST_TOKEN as string | undefined) ||
  (import.meta.env.KV_REST_API_TOKEN as string | undefined);

const USE_REDIS = !!(REDIS_URL && REDIS_TOKEN);

/** Cliente Upstash Redis — lazy: solo se inicializa si estamos en modo Redis */
let redisClient: import('@upstash/redis').Redis | null = null;

/**
 * Retorna el cliente de Upstash Redis, cargándolo bajo demanda.
 * Evita que @upstash/redis valide env vars al importar el módulo.
 */
async function getRedis() {
  if (!redisClient) {
    const { Redis } = await import('@upstash/redis');
    redisClient = new Redis({ url: REDIS_URL!, token: REDIS_TOKEN! });
  }
  return redisClient;
}

/** Clave única en Redis donde el poll guarda el objeto LandingsData completo. */
const LANDINGS_KEY = 'landings_data';

/** Ruta absoluta al archivo JSON local. Solo se usa cuando NO hay Redis configurado. */
const DATA_FILE = path.resolve(process.cwd(), 'data', 'landings.json');

/** Lee el LandingsData desde el archivo local (modo dev). */
function readLocalLandings(): LandingsData {
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
 * Retorna todas las landings registradas.
 *
 * @returns {Promise<LandingsData>} Objeto con el array de landings y timestamp de la última actualización.
 *
 * Edge cases:
 * - Redis vacío o sin responder → array vacío (primera ejecución antes del primer poll).
 * - Archivo inexistente (modo local) → array vacío.
 * - Archivo es un array plano → lo envuelve en el formato esperado por retrocompatibilidad.
 */
export async function getAllLandings(): Promise<LandingsData> {
  if (USE_REDIS) {
    try {
      const redis = await getRedis();
      const data = await redis.get<LandingsData>(LANDINGS_KEY);
      return data ?? { landings: [], lastUpdated: new Date().toISOString() };
    } catch {
      return { landings: [], lastUpdated: new Date().toISOString() };
    }
  }

  // Modo local — archivo JSON
  return readLocalLandings();
}

/**
 * Busca una landing por su slug.
 *
 * @param slug - Identificador único de la landing (ej: "prepago-movil").
 * @returns La landing encontrada o `null` si no existe.
 *
 * Útil para la página de detalle `/landing/:slug`.
 */
export async function getLandingBySlug(slug: string): Promise<Landing | null> {
  const { landings } = await getAllLandings();
  return landings.find((l) => l.slug === slug) ?? null;
}
