/**
 * doc-cache.js — cache tài liệu phiên họp trên thiết bị (IndexedDB + Cache API).
 *
 * Kiến trúc:
 *   Supabase (gốc) → Firebase (hot phiên) → IndexedDB (máy này, mở lại tức thì / offline ngắn)
 */
(function () {
  'use strict';

  var IDB_NAME = 'ph-meeting-doc-cache-v1';
  var IDB_STORE = 'blobs';
  var CACHE_PREFIX = 'ph-meeting-doc-v1-';
  var _blobUrls = {};

  function cacheName(meetingId) {
    return CACHE_PREFIX + String(meetingId || '');
  }

  function cacheKey(docId) {
    return 'doc:' + String(docId || '');
  }

  function idbKey(meetingId, docId) {
    return String(meetingId || '') + ':' + String(docId || '');
  }

  function hasCacheApi() {
    return typeof window.caches !== 'undefined';
  }

  function hasIndexedDB() {
    return typeof indexedDB !== 'undefined';
  }

  function openIdb() {
    return new Promise(function (resolve, reject) {
      if (!hasIndexedDB()) {
        reject(new Error('no indexedDB'));
        return;
      }
      var req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function (ev) {
        var db = ev.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('idb open failed')); };
    });
  }

  function idbGet(meetingId, docId) {
    return openIdb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, 'readonly');
        var req = tx.objectStore(IDB_STORE).get(idbKey(meetingId, docId));
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function idbPut(meetingId, docId, blob) {
    return openIdb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(blob, idbKey(meetingId, docId));
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function idbDeleteMeeting(meetingId) {
    if (!hasIndexedDB()) return Promise.resolve();
    return openIdb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var prefix = String(meetingId || '') + ':';
        var tx = db.transaction(IDB_STORE, 'readwrite');
        var store = tx.objectStore(IDB_STORE);
        var req = store.openCursor();
        req.onsuccess = function (ev) {
          var cursor = ev.target.result;
          if (cursor) {
            if (String(cursor.key).indexOf(prefix) === 0) {
              cursor.delete();
            }
            cursor.continue();
          }
        };
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  async function prefetchDoc(meetingId, docId, url, name) {
    if (!meetingId || !docId || !url) return false;
    if (!/^https?:\/\//i.test(url)) return false;

    try {
      var existing = await idbGet(meetingId, docId);
      if (existing) return true;
    } catch (_) { /* fallback network */ }

    try {
      var res = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) return false;
      var blob = await res.blob();
      if (hasIndexedDB()) {
        try {
          await idbPut(meetingId, docId, blob);
        } catch (e) {
          console.warn('[PhonghopDocCache] idb put', name || docId, e);
        }
      }
      if (hasCacheApi()) {
        try {
          var cache = await caches.open(cacheName(meetingId));
          await cache.put(cacheKey(docId), new Response(blob.slice()));
        } catch (_) { /* optional */ }
      }
      return true;
    } catch (e) {
      console.warn('[PhonghopDocCache] prefetch', name || docId, e);
      return false;
    }
  }

  async function prefetchMeetingDocs(meetingId, docs, onProgress) {
    if (!meetingId || !docs || !docs.length) return { ok: 0, fail: 0 };
    var files = docs.filter(function (d) {
      return d && d.kind === 'file' && d.download_url;
    });
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
    if (!meetingId || !docId) return null;
    var mapKey = meetingId + ':' + docId;
    if (_blobUrls[mapKey]) return _blobUrls[mapKey];

    try {
      var blob = await idbGet(meetingId, docId);
      if (blob) {
        var idbUrl = URL.createObjectURL(blob);
        _blobUrls[mapKey] = idbUrl;
        return idbUrl;
      }
    } catch (_) { /* try cache api */ }

    if (!hasCacheApi()) return null;
    try {
      var cache = await caches.open(cacheName(meetingId));
      var hit = await cache.match(cacheKey(docId));
      if (!hit) return null;
      var cachedBlob = await hit.blob();
      var url = URL.createObjectURL(cachedBlob);
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
    try {
      await idbDeleteMeeting(meetingId);
    } catch (e) {
      console.warn('[PhonghopDocCache] idb clear', e);
    }
    if (!hasCacheApi()) return;
    try {
      await caches.delete(cacheName(meetingId));
    } catch (e) {
      console.warn('[PhonghopDocCache] cache clear', e);
    }
  }

  window.PhonghopDocCache = {
    prefetchDoc: prefetchDoc,
    prefetchMeetingDocs: prefetchMeetingDocs,
    getCachedObjectUrl: getCachedObjectUrl,
    clearMeetingCache: clearMeetingCache
  };
})();
