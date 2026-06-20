/**
 * Helpers de formateo de fechas para el dashboard.
 *
 * Los timestamps se almacenan en UTC (ISO 8601 vía `toISOString()`), pero deben
 * mostrarse al usuario en la zona horaria de Perú (America/Lima, UTC-5).
 * Centralizar el formateo acá garantiza que toda fecha visible use la misma zona.
 *
 * @module lib/dates
 */

const TIME_ZONE = 'America/Lima';
const LOCALE = 'es-PE';

/**
 * Formatea un timestamp en formato completo (fecha + hora) en hora de Lima.
 *
 * Acepta un string ISO o un objeto Date (para el caso "ahora").
 * Si el valor no se puede parsear, devuelve el string crudo como fallback.
 *
 * Ej: "2026-06-19T19:23:55.385Z" → "19/6/2026, 14:23:55"
 */
export function formatTimestamp(input: string | Date): string {
  try {
    const date = typeof input === 'string' ? new Date(input) : input;
    return date.toLocaleString(LOCALE, { timeZone: TIME_ZONE });
  } catch {
    return typeof input === 'string' ? input : input.toISOString();
  }
}

/**
 * Formatea la fecha de un deploy en formato corto (día mes año, hora:min) en hora de Lima.
 *
 * Ej: "2026-06-19T19:23:55.385Z" → "19 jun 2026, 14:23"
 */
export function formatDeployDate(input: string | Date): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  return date.toLocaleDateString(LOCALE, {
    timeZone: TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
