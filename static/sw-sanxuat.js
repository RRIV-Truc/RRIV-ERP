/**
 * Service Worker — cache shell Sản xuất + tab Sản lượng CN (mở lại khi không có mạng).
 */
var CACHE = 'rriv-sanxuat-v27';
var SHELL = [
  '/',
  '/sanxuat',
  '/static/js/utils/config.js',
  '/static/js/services/SupabaseService.js',
  '/static/js/services/FirestoreService.js',
  '/static/js/services/CRUDService.js',
  '/static/js/services/ErpDb.js',
  '/static/js/modules/auth.js',
  '/static/js/utils/permissions.js',
  '/static/js/utils/validation.js',
  '/static/js/utils/errorHandler.js',
  '/static/js/rriv-app-bar.js',
  '/static/css/rriv-app-bar.css',
  '/static/css/app-layout.css',
  '/static/css/app-components.css',
  '/static/css/app-sanxuat.css',
  '/static/js/sanxuat/services/TscDrcConverter.js',
  '/static/js/sanxuat/services/FieldHarvestOffline.js',
  '/static/js/sanxuat/tabs/delivery.js?v=38',
  '/static/js/sanxuat/tabs/field-harvest.js?v=59',
  '/static/manifest.json',
  '/static/icon-192.png',
  '/static/icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(SHELL).catch(function () { /* partial ok */ });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k.indexOf('rriv-sanxuat-') === 0 && k !== CACHE;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  var isApi = url.pathname.indexOf('/api/') === 0;
  if (isApi) return;

  var isSanxuatPage = url.pathname === '/sanxuat' || url.pathname.indexOf('/sanxuat') === 0;
  var isStatic = url.pathname.indexOf('/static/') === 0;

  if (!isSanxuatPage && !isStatic) return;

  var isTabJs = url.pathname.indexOf('/static/js/sanxuat/tabs/') === 0;

  event.respondWith(
    (isTabJs ? fetch(req) : Promise.resolve(null)).catch(function () { return null; }).then(function (networkRes) {
      if (networkRes && networkRes.status === 200) {
        var clone = networkRes.clone();
        caches.open(CACHE).then(function (c) { c.put(req, clone); });
        return networkRes;
      }
      return caches.match(req).then(function (cached) {
        if (cached) return cached;
        if (networkRes) return networkRes;
        return fetch(req).then(function (res) {
          if (res && res.status === 200 && (isStatic || isSanxuatPage)) {
            var c2 = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, c2); });
          }
          return res;
        }).catch(function () {
          if (isSanxuatPage) {
            return caches.match('/sanxuat').then(function (p) {
              return p || caches.match('/');
            });
          }
          return cached;
        });
      });
    })
  );
});
