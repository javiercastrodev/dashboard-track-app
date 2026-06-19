/**
 * Service Worker para Tracking Dashboard.
 *
 * Este archivo debe estar en /public para que Astro lo sirva sin procesar,
 * ya que el Service Worker debe estar en el scope raíz del sitio para poder
 * interceptar todas las URLs del dashboard.
 *
 * @module sw
 */

/**
 * Evento: push
 *
 * Se dispara cuando el servidor envía una notificación push al navegador,
 * incluso si la pestaña del dashboard está cerrada.
 *
 * El payload es un JSON con: { title, body, icon, url }.
 * - title: título de la notificación (ej: "Prepago Móvil actualizada")
 * - body: texto del cuerpo (ej: "Nuevo deploy por Javier Castro")
 * - icon: ícono que se muestra en la notificación
 * - url: URL a abrir cuando el usuario hace clic
 *
 * Si no se puede parsear el payload, muestra el texto crudo como fallback
 * para no perder la notificación.
 */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('push', (event) => {
  let title = '📡 Tracking Dashboard';
  const options = {
    body: '',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    data: { url: '/' },
    tag: 'push-default',
    requireInteraction: true,
    silent: false,
  };

  if (event.data) {
    try {
      const data = event.data.json();
      title = data.title || title;
      options.body = data.body || '';
      options.data = { url: data.url || '/' };
      options.tag = data.tag || options.tag;
    } catch {
      options.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

/**
 * Evento: notificationclick
 *
 * Se dispara cuando el usuario hace clic en la notificación.
 * Cierra la notificación y abre (o enfoca) la URL que venía en el payload.
 * Si no hay URL específica, redirige al dashboard principal.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    (async () => {
      try {
        const base = self.location.origin;
        const path = (event.notification.data && event.notification.data.url) || '/';
        const targetUrl = new URL(path, base).href;

        const windowClients = await clients.matchAll({
          type: 'window',
          includeUncontrolled: true,
        });

        // Buscar pestaña abierta en el mismo pathname
        for (const client of windowClients) {
          try {
            const clientPath = new URL(client.url).pathname;
            if (clientPath === new URL(targetUrl).pathname && 'focus' in client) {
              await client.focus();
              return;
            }
          } catch {
            continue;
          }
        }

        // Si no hay pestaña, abrir una nueva
        await clients.openWindow(targetUrl);
      } catch {
        // Si todo falla, al menos abrir el dashboard
        await clients.openWindow('/');
      }
    })()
  );
});
