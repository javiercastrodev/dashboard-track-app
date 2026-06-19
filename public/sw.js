/**
 * Service Worker para Tracking Dashboard.
 *
 * Este archivo debe estar en /public para que Astro lo sirva sin procesar,
 * ya que el Service Worker debe estar en el scope raíz del sitio para poder
 * interceptar todas las URLs (incluyendo las API routes).
 *
 * @module sw
 */

/**
 * Evento: push
 *
 * Se dispara cuando el servidor envía una notificación push al navegador.
 * El payload es un JSON con: { title, body, icon, url }.
 *
 * Si no se puede parsear el payload, muestra el texto crudo como fallback.
 */
self.addEventListener('push', (event) => {
  let data = {};

  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { title: 'Notificación', body: event.data.text() };
    }
  }

  const title = data.title || 'Tracking Dashboard';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icon.png',
    badge: data.badge || '/badge.png',
    data: data.url ? { url: data.url } : null,
  };

  event.waitUntil(self.registration.showNotification(title, options));
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
