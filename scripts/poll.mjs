#!/usr/bin/env node

/**
 * Script de polling: GitHub Action — NO ejecutar dentro de Astro/Vercel.
 *
 * Propósito:
 *   Enumera todos los repositorios de la org HV-DEV-HTML, busca el archivo
 *   `cms-deploy.json` en la raíz de cada uno, y sincroniza los datos en
 *   `data/landings.json`.
 *
 * Flujo:
 *   1. Conecta con GitHub API via Octokit (autenticado con GH_PAT).
 *   2. Obtiene TODOS los repos de la organización (con paginación).
 *   3. Para cada repo, intenta leer `cms-deploy.json` desde su rama default.
 *   4. Si existe: construye/actualiza la entrada correspondiente en landings.json.
 *   5. Si NO existe: skipea el repo (no es una landing, o aún no tiene el archivo).
 *   6. Si hubo cambios (nuevo deploy o nueva landing): invoca POST /api/notify.
 *   7. Escribe landings.json solo si los datos cambiaron (idempotencia).
 *
 * Idempotencia:
 *   - Si ningún `cms-deploy.json` cambió su commit, landings.json NO se reescribe.
 *   - Esto evita commits vacíos en el repo del dashboard.
 *
 * Variables de entorno requeridas:
 *   GH_PAT       — Token de GitHub con scope `repo` (lectura de repos privados).
 *   NOTIFY_URL   — URL base de la app en Vercel (ej: https://tracking.vercel.app).
 *   NOTIFY_SECRET— Secret compartido con /api/notify.
 *
 * @module scripts/poll
 */

import { Octokit } from 'octokit';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const ORG = 'HV-DEV-HTML';
const DEPLOY_FILENAME = 'cms-deploy.json';
const DATA_FILE = path.resolve(process.cwd(), 'data', 'landings.json');

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/**
 * Deriva el slug de una landing a partir del nombre del repo.
 *
 * Por defecto usa el nombre del repo tal cual. Si los repositorios usan
 * un prefijo común (ej: "landing-", "lp-"), se puede configurar acá.
 *
 * @param {string} repoName - Nombre del repositorio (ej: "prepago-movil").
 * @returns {string} Slug para la landing.
 *
 * Edge case: prefijos conocidos se eliminan automáticamente.
 */
function deriveSlug(repoName) {
  // Prefijos comunes a remover — ajustar según la convención real del equipo.
  const knownPrefixes = ['landing-', 'lp-', 'cms-', 'site-'];
  for (const prefix of knownPrefixes) {
    if (repoName.startsWith(prefix)) {
      return repoName.slice(prefix.length);
    }
  }
  return repoName;
}

/**
 * Convierte un slug (kebab-case) en un título legible.
 *
 * Ejemplo: "prepago-movil" → "Prepago Móvil"
 *
 * @param {string} slug - Slug en kebab-case.
 * @returns {string} Título humanizado.
 */
function humanizeTitle(slug) {
  return slug
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Obtiene la URL de producción de una landing.
 *
 * Intenta usar el homepage del repo (si está configurado en GitHub).
 * Si no, usa la URL del repo como fallback para que el dashboard
 * al menos tenga un link funcional.
 *
 * @param {object} repo - Objeto del repositorio desde la API de GitHub.
 * @returns {string} URL de la landing.
 */
function getLandingUrl(repo) {
  return repo.homepage || repo.html_url;
}

// ---------------------------------------------------------------------------
// Lógica principal
// ---------------------------------------------------------------------------

async function main() {
  const forceNotify = process.argv.includes('--notify');

  // -------------------------------------------------------------------------
  // Validar entorno
  // -------------------------------------------------------------------------
  const ghPat = process.env.GH_PAT;
  const notifyUrl = process.env.NOTIFY_URL;
  const notifySecret = process.env.NOTIFY_SECRET;

  if (!ghPat) {
    console.error('❌ Falta GH_PAT — no se puede autenticar con GitHub API');
    process.exit(1);
  }

  if (!notifyUrl || !notifySecret) {
    console.warn(
      '⚠️  Faltan NOTIFY_URL o NOTIFY_SECRET — las notificaciones no se enviarán.'
    );
  }

  // -------------------------------------------------------------------------
  // Inicializar Octokit
  // -------------------------------------------------------------------------
  const octokit = new Octokit({ auth: ghPat });

  console.log(`🔍 Escaneando repositorios de ${ORG}...`);

  // -------------------------------------------------------------------------
  // 1. Obtener TODOS los repos de la organización (con paginación automática)
  // -------------------------------------------------------------------------
  const repos = await octokit.paginate(octokit.rest.repos.listForOrg, {
    org: ORG,
    type: 'all',
    per_page: 100,
  });

  console.log(`📦 ${repos.length} repositorios encontrados en ${ORG}`);

  // -------------------------------------------------------------------------
  // 2. Leer landings.json existente (si existe)
  // -------------------------------------------------------------------------
  /** @type {{ landings: import('../src/lib/landings.ts').Landing[], lastUpdated: string }} */
  let existingData = { landings: [], lastUpdated: new Date().toISOString() };

  if (fs.existsSync(DATA_FILE)) {
    try {
      existingData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    } catch {
      console.warn('⚠️  landings.json corrupto — se empezará desde cero');
    }
  }

  // Mapa de slug → landing para búsqueda rápida
  /** @type {Map<string, import('../src/lib/landings.ts').Landing>} */
  const landingsMap = new Map(
    existingData.landings.map((l) => [l.slug, l])
  );

  // -------------------------------------------------------------------------
  // 3. Procesar cada repositorio
  // -------------------------------------------------------------------------
  /** @type {string[]} */
  const landingsEncontradas = [];

  for (const repo of repos) {
    try {
      // Intentar obtener cms-deploy.json de la rama default del repo
      const response = await octokit.rest.repos.getContent({
        owner: ORG,
        repo: repo.name,
        path: DEPLOY_FILENAME,
      });

      // La API devuelve el contenido en base64
      const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
      /** @type {{ commit: string, branch: string, timestamp: string, autor: string }} */
      const deployConfig = JSON.parse(content);

      // Validar que tenga los campos mínimos esperados
      if (!deployConfig.commit || !deployConfig.timestamp) {
        console.warn(`⚠️  ${repo.name}: cms-deploy.json inválido — se skipea`);
        continue;
      }

      const slug = deriveSlug(repo.name);
      landingsEncontradas.push(slug);

      const deployEntry = {
        commit: deployConfig.commit,
        branch: deployConfig.branch || 'main',
        timestamp: deployConfig.timestamp,
        autor: deployConfig.author || deployConfig.autor || 'Desconocido',
      };

      const existing = landingsMap.get(slug);

      if (existing) {
        // La landing ya existe — solo actualizar lastDeploy si el commit cambió
        if (existing.lastDeploy?.commit !== deployEntry.commit) {
          existing.lastDeploy = deployEntry;
          existing.lastChecked = new Date().toISOString();
          console.log(`🔄 ${slug}: nuevo deploy detectado (${deployEntry.commit.slice(0, 7)})`);
        } else {
          console.log(`✓ ${slug}: sin cambios`);
        }
      } else {
        // Nueva landing descubierta
        landingsMap.set(slug, {
          slug,
          title: humanizeTitle(slug),
          description: '',
          url: getLandingUrl(repo),
          lastChecked: new Date().toISOString(),
          status: 'active',
          github: repo.html_url,
          lastDeploy: deployEntry,
        });
        console.log(`✨ ${slug}: nueva landing agregada`);
      }
    } catch (err) {
      // 404 = el repo no tiene cms-deploy.json → no es una landing, se skipea.
      if (err.status === 404) {
        // Silencioso — la mayoría de los repos no serán landings
        continue;
      }

      // Otros errores (rate limit, network, etc) se reportan
      console.error(`⚠️  Error al procesar ${repo.name}: ${err.message}`);
    }
  }

  // -------------------------------------------------------------------------
  // 4. Detectar landings que ya no existen (repo eliminado o renombrado)
  // -------------------------------------------------------------------------
  // NO las eliminamos del archivo — podrían ser landings creadas manualmente
  // o con datos que no queremos perder. Simplemente se quedan con su último
  // estado conocido. Esto es intencional: es menos riesgoso que borrar datos
  // que después haya que recuperar.
  const landingsNoEncontradas = existingData.landings.filter(
    (l) => !landingsEncontradas.includes(l.slug)
  );
  if (landingsNoEncontradas.length > 0) {
    console.log(
      `💤 ${landingsNoEncontradas.length} landing(s) no encontradas en GitHub (se mantienen en el archivo)`
    );
  }

  // -------------------------------------------------------------------------
  // 5. Determinar si hubo cambios
  // -------------------------------------------------------------------------
  const nuevasLandings = Array.from(landingsMap.values());
  const huboCambios =
    JSON.stringify(existingData.landings) !== JSON.stringify(nuevasLandings);

  if (!huboCambios) {
    if (forceNotify) {
      console.log('ℹ️  Sin cambios — omitiendo escritura de landings.json');
      console.log('🔔 --notify activado — forzando envío de notificación igual');
    } else {
      console.log('ℹ️  Sin cambios — landings.json no se reescribe');
      return;
    }
  } else {
    // -------------------------------------------------------------------------
    // 6. Escribir landings.json actualizado
    // -------------------------------------------------------------------------
    const output = {
      landings: nuevasLandings,
      lastUpdated: new Date().toISOString(),
    };

    fs.writeFileSync(DATA_FILE, JSON.stringify(output, null, 2) + '\n');
    console.log(`✅ landings.json actualizado — ${nuevasLandings.length} landings`);
  }

  // -------------------------------------------------------------------------
  // 7. Enviar notificación (si las URLs están configuradas)
  // -------------------------------------------------------------------------
  if (notifyUrl && notifySecret) {
    try {
      const notifyApiUrl = notifyUrl.replace(/\/$/, '') + '/api/notify';
      const notifyResponse = await fetch(notifyApiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${notifySecret}`,
          'Content-Type': 'application/json',
        },
      });

      if (notifyResponse.ok) {
        /** @type {{ sent: number, failed: number }} */
        const notifyResult = await notifyResponse.json();
        console.log(
          `🔔 Notificación enviada — ${notifyResult.sent} exitosas, ${notifyResult.failed} fallidas`
        );
      } else {
        console.error(
          `❌ Error al notificar: HTTP ${notifyResponse.status} ${notifyResponse.statusText}`
        );
      }
    } catch (err) {
      console.error(`❌ Error de red al notificar: ${err.message}`);
    }
  } else {
    console.log('🔕 Notificaciones omitidas (faltan NOTIFY_URL o NOTIFY_SECRET)');
  }
}

// ---------------------------------------------------------------------------
// Punto de entrada
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error('❌ Error fatal:', err);
  process.exit(1);
});
