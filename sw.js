// Service Worker for Fire Detector
// Enables background notifications

self.addEventListener('install', event => {
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('push', event => {
    const data = event.data ? event.data.json() : {};
    event.waitUntil(
        self.registration.showNotification(data.title || '🔥 Fire Alert', {
            body: data.body || 'Fire or blast detected!',
            icon: 'https://cdn-icons-png.flaticon.com/512/785/785116.png',
            badge: 'https://cdn-icons-png.flaticon.com/512/785/785116.png',
            requireInteraction: true,
            vibrate: [500, 200, 500]
        })
    );
});
