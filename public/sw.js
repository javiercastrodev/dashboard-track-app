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
  console.log('SW push event received:', event.data?.text()?.slice(0, 100));

  let data = {};

  if (event.data) {
    try {
      data = event.data.json();
      console.log('SW parsed data:', JSON.stringify(data));
    } catch {
      data = { title: 'Notificación', body: event.data.text() };
    }
  }

  const title = data.title || '📡 Tracking Dashboard';
  const options = {
    body: data.body || '',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    data: { url: data.url || '/' },
    tag: data.tag || 'push-default',
    requireInteraction: true,
    silent: false,
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
      .then(() => console.log('SW notification shown successfully'))
      .catch((err) => console.error('SW showNotification error:', err))
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

  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (client.url === urlToOpen && 'focus' in client) {
            return client.focus();
          }
        }
        return clients.openWindow(urlToOpen);
      })
  );
});
