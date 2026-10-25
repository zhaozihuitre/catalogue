// 早期版本曾以 PWA 方式安装。现已改为普通网页服务：
// 已安装过的设备会拉取到这个"自毁"版本，清空缓存、注销自身并刷新页面。
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((c) => c.navigate(c.url));
    })(),
  );
});
