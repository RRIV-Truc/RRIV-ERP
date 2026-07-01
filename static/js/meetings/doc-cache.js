/**
 * doc-cache.js — cache tài liệu phiên họp trên máy trình chiếu (Cache API).
 * Sau khi tải lần đầu, mở PDF/PPTX lại từ ổ cứng — không cần mạng.
 */
(function () {
  'use strict';

  var CACHE_PREFIX = 'ph-meeting-doc-v1-';
  var _blobUrls = {};

  function cacheName(meetingId) {
    return CACHE_PREFIX + String(meetingId || '');
  }

  function cacheKey(docId) {
    return 'doc:' + String(docId || '');
  }

  function hasCacheApi() {
    return typeof window.caches !== 'undefined';
  }

  async function prefetchDoc(meetingId, docId, url, name) {
    if (!hasCacheApi() || !meetingId || !docId || !url) return false;
    if (!/^https?:\/\//i.test(url)) return false;
    try {
      var cache = await caches.open(cacheName(meetingId));
      var hit = await cache.match(cacheKey(docId));
      if (hit) return true;
      var res = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) return false;
      await cache.put(cacheKey(docId), res.clone());
      return true;
    } catch (e) {
      console.warn('[PhonghopDocCache] prefetch', name || docId, e);
      return false;
    }
  }

  async function prefetchMeetingDocs(meetingId, docs, onProgress) {
    if (!hasCacheApi() || !meetingId || !docs || !docs.length) return { ok: 0, fail: 0 };
    var files = docs.filter(function (d) { return d && d.kind === 'file' && d.download_url; });
    var ok = 0;
    var fail = 0;
    for (var i = 0; i < files.length; i++) {
      var d = files[i];
      var done = await prefetchDoc(meetingId, d.id, d.download_url, d.name);
      if (done) ok += 1;
      else fail += 1;
      if (onProgress) onProgress(i + 1, files.length, d);
    }
    return { ok: ok, fail: fail, total: files.length };
  }

  async function getCachedObjectUrl(meetingId, docId) {
    if (!hasCacheApi() || !meetingId || !docId) return null;
    var mapKey = meetingId + ':' + docId;
    if (_blobUrls[mapKey]) return _blobUrls[mapKey];
    try {
      var cache = await caches.open(cacheName(meetingId));
      var hit = await cache.match(cacheKey(docId));
      if (!hit) return null;
      var blob = await hit.blob();
      var url = URL.createObjectURL(blob);
      _blobUrls[mapKey] = url;
      return url;
    } catch (e) {
      console.warn('[PhonghopDocCache] read', docId, e);
      return null;
    }
  }

  async function clearMeetingCache(meetingId) {
    if (!meetingId) return;
    Object.keys(_blobUrls).forEach(function (k) {
      if (k.indexOf(String(meetingId) + ':') === 0) {
        try { URL.revokeObjectURL(_blobUrls[k]); } catch (_) { /* ignore */ }
        delete _blobUrls[k];
      }
    });
    if (!hasCacheApi()) return;
    try {
      await caches.delete(cacheName(meetingId));
    } catch (e) {
      console.warn('[PhonghopDocCache] clear', e);
    }
  }

  window.PhonghopDocCache = {
    prefetchDoc: prefetchDoc,
    prefetchMeetingDocs: prefetchMeetingDocs,
    getCachedObjectUrl: getCachedObjectUrl,
    clearMeetingCache: clearMeetingCache
  };
})();
