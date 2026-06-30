/**
 * Lưu tạm tab Sản lượng CN khi không có mạng (IndexedDB + hàng đợi đồng bộ).
 * @module FieldHarvestOffline
 */
const FieldHarvestOffline = (function () {
  'use strict';

  var DB_NAME = 'rriv-field-harvest';
  var DB_VERSION = 1;
  var dbPromise = null;

  function isOnline() {
    return typeof navigator === 'undefined' || navigator.onLine !== false;
  }

  function _openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error('Trình duyệt không hỗ trợ IndexedDB'));
        return;
      }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = function () { reject(req.error); };
      req.onsuccess = function () { resolve(req.result); };
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('cache')) {
          db.createObjectStore('cache', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('syncQueue')) {
          db.createObjectStore('syncQueue', { keyPath: 'id' });
        }
      };
    });
    return dbPromise;
  }

  function _tx(storeName, mode) {
    return _openDb().then(function (db) {
      return db.transaction(storeName, mode).objectStore(storeName);
    });
  }

  function cachePut(key, value) {
    return _tx('cache', 'readwrite').then(function (store) {
      return new Promise(function (resolve, reject) {
        var req = store.put({ key: key, value: value, updatedAt: new Date().toISOString() });
        req.onsuccess = function () { resolve(); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function cacheGet(key) {
    return _tx('cache', 'readonly').then(function (store) {
      return new Promise(function (resolve, reject) {
        var req = store.get(key);
        req.onsuccess = function () {
          resolve(req.result ? req.result.value : null);
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function _uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'fh-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
  }

  function enqueue(item) {
    var row = Object.assign({ id: _uuid(), createdAt: new Date().toISOString() }, item);
    return _tx('syncQueue', 'readwrite').then(function (store) {
      return new Promise(function (resolve, reject) {
        var req = store.put(row);
        req.onsuccess = function () { resolve(row.id); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function getQueue() {
    return _tx('syncQueue', 'readonly').then(function (store) {
      return new Promise(function (resolve, reject) {
        var req = store.getAll();
        req.onsuccess = function () {
          var rows = req.result || [];
          rows.sort(function (a, b) {
            return String(a.createdAt).localeCompare(String(b.createdAt));
          });
          resolve(rows);
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function removeFromQueue(id) {
    return _tx('syncQueue', 'readwrite').then(function (store) {
      return new Promise(function (resolve, reject) {
        var req = store.delete(id);
        req.onsuccess = function () { resolve(); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function queueCount() {
    return getQueue().then(function (q) { return q.length; });
  }

  var WORKERS_ALL_KEY = 'workers:all';
  var META_KEY = 'meta';

  function assignmentsKey(date) { return 'assignments:' + date; }
  function weighingsKey(date) { return 'weighings:' + date; }

  function setMeta(patch) {
    return cacheGet(META_KEY).then(function (prev) {
      var meta = Object.assign({}, prev || {}, patch, { updatedAt: new Date().toISOString() });
      return cachePut(META_KEY, meta);
    });
  }

  function getMeta() {
    return cacheGet(META_KEY).then(function (v) { return v || {}; });
  }

  /** Gỡ mục cũ cùng loại + section (tránh trùng khi lưu offline nhiều lần). */
  function enqueueDeduped(item, dedupeKey) {
    return getQueue().then(function (rows) {
      var filtered = rows.filter(function (r) {
        return r.dedupeKey !== dedupeKey;
      });
      return _tx('syncQueue', 'readwrite').then(function (store) {
        return new Promise(function (resolve, reject) {
          var pending = [];
          rows.forEach(function (r) {
            if (r.dedupeKey === dedupeKey) pending.push(r.id);
          });
          var chain = Promise.resolve();
          pending.forEach(function (id) {
            chain = chain.then(function () {
              return new Promise(function (res, rej) {
                var req = store.delete(id);
                req.onsuccess = function () { res(); };
                req.onerror = function () { rej(req.error); };
              });
            });
          });
          chain.then(function () {
            var row = Object.assign({ id: _uuid(), createdAt: new Date().toISOString(), dedupeKey: dedupeKey }, item);
            var putReq = store.put(row);
            putReq.onsuccess = function () { resolve(row.id); };
            putReq.onerror = function () { reject(putReq.error); };
          }).catch(reject);
        });
      });
    });
  }

  function saveAssignmentsForDate(date, rows) {
    return cachePut(assignmentsKey(date), rows);
  }

  function getAssignmentsForDate(date) {
    return cacheGet(assignmentsKey(date)).then(function (v) { return v || []; });
  }

  function clearAssignmentsForDate(date) {
    return cachePut(assignmentsKey(date), []);
  }

  /** Xóa mọi bản sao phân công (khi đổi schema / cần tải lại từ server). */
  function clearAllAssignmentCaches() {
    return _openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('cache', 'readwrite');
        var store = tx.objectStore('cache');
        var req = store.getAll();
        req.onsuccess = function () {
          var rows = req.result || [];
          rows.forEach(function (row) {
            if (row && String(row.key).indexOf('assignments:') === 0) store.delete(row.key);
          });
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function () { reject(tx.error); };
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function saveWeighingsForDate(date, rows) {
    return cachePut(weighingsKey(date), rows);
  }

  function getWeighingsForDate(date) {
    return cacheGet(weighingsKey(date)).then(function (v) { return v || []; });
  }

  function saveMasterBundle(bundle) {
    var jobs = [];
    if (bundle.sections) jobs.push(cachePut('sections', bundle.sections));
    if (bundle.workers) jobs.push(cachePut(WORKERS_ALL_KEY, bundle.workers));
    if (bundle.teams) jobs.push(cachePut('teams', bundle.teams));
    if (bundle.tscTable) jobs.push(cachePut('tscTable', bundle.tscTable));
    jobs.push(setMeta({ lastMasterCache: new Date().toISOString() }));
    return Promise.all(jobs);
  }

  function init() {
    return _openDb();
  }

  return {
    init: init,
    isOnline: isOnline,
    cachePut: cachePut,
    cacheGet: cacheGet,
    enqueue: enqueue,
    enqueueDeduped: enqueueDeduped,
    getQueue: getQueue,
    removeFromQueue: removeFromQueue,
    queueCount: queueCount,
    saveAssignmentsForDate: saveAssignmentsForDate,
    getAssignmentsForDate: getAssignmentsForDate,
    clearAssignmentsForDate: clearAssignmentsForDate,
    clearAllAssignmentCaches: clearAllAssignmentCaches,
    saveWeighingsForDate: saveWeighingsForDate,
    getWeighingsForDate: getWeighingsForDate,
    saveMasterBundle: saveMasterBundle,
    getMeta: getMeta,
    setMeta: setMeta,
    WORKERS_ALL_KEY: WORKERS_ALL_KEY
  };
})();
