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

self.addEventListener('notificationclose', () => {});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('push', (event) => {
  let title = '📡 Tracking Dashboard';
  const options = {
    body: '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
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
 * Cierra la notificación y enfoca la pestaña existente con la URL del payload,
 * o abre una nueva si no hay ninguna. Si no hay URL específica, redirige al
 * dashboard principal.
 *
 * NOTA: client.navigate() fue removido intencionalmente — falla silenciosamente
 * en clientes no controlados y evita que openWindow() se ejecute como fallback.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const rawUrl = (event.notification.data && event.notification.data.url) || '/';
  const targetUrl = new URL(rawUrl, self.location.origin).href;

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url === targetUrl && 'focus' in client) {
            return client.focus();
          }
        }
        return clients.openWindow(targetUrl);
      })
  );
});
