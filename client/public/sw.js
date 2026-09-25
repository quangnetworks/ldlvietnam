/* LDL Việt Nam — service worker: nhận thông báo đẩy (Web Push), hiện thông báo, cập nhật số trên biểu tượng ứng dụng. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'LDL Việt Nam';
  const tasks = [
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/logo-192.png',
      badge: '/logo-192.png',
      tag: data.tag || undefined,
      renotify: !!data.tag,
      data: { url: data.url || '/' },
    }),
  ];
  // Số chấm đỏ trên biểu tượng ứng dụng ở màn hình chính (iOS 16.4+, Android, desktop)
  if (typeof data.badge === 'number' && self.navigator.setAppBadge) {
    tasks.push((data.badge > 0 ? self.navigator.setAppBadge(data.badge) : self.navigator.clearAppBadge()).catch(() => {}));
  }
  event.waitUntil(Promise.all(tasks));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of list) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        client.postMessage({ type: 'open', url });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});

// Trình duyệt tự làm mới đăng ký đẩy (hết hạn / đổi khoá) → đăng ký lại và báo máy chủ (cookie phiên được gửi kèm)
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const options = event.oldSubscription ? event.oldSubscription.options : null;
    if (!options) return;
    const sub = await self.registration.pushManager.subscribe(options);
    await fetch('/api/push/subscribe', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub.toJSON()),
    });
  })());
});
