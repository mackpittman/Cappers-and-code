// Cappers & Code service worker. It does one thing: show push alerts and open the app when one
// is tapped. There is no caching here, so every deploy is live on the next load.
self.addEventListener('install', function () {
  self.skipWaiting();
});
self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }
  var scope = self.registration.scope; // e.g. https://cappersandcode.com/app/
  var title = data.title || 'Cappers & Code';
  var options = {
    body: data.body || '',
    icon: scope + 'icons/icon-192.png',
    badge: scope + 'icons/icon-192.png',
    tag: data.tag || 'feed',
    renotify: true,
    data: { url: data.url || scope + 'feed' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clients) {
      for (var i = 0; i < clients.length; i++) {
        var c = clients[i];
        if ('focus' in c) {
          c.postMessage({ type: 'open', url: url });
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
