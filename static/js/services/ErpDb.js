/**
 * ErpDb — lớp truy cập dữ liệu Supabase (API Flask /api/data/*)
 * Thay thế ErpDb.firestore() / ErpDb.auth() trong mã Phước Hòa.
 */
const ErpDb = (function () {
  'use strict';

  const FieldValue = {
    serverTimestamp: () => new Date().toISOString(),
    arrayUnion: (...elements) => ({ __op: 'arrayUnion', elements }),
    arrayRemove: (...elements) => ({ __op: 'arrayRemove', elements }),
    increment: (n) => ({ __op: 'increment', value: n }),
    delete: () => ({ __op: 'delete' })
  };

  const Timestamp = {
    fromDate: (date) => (date instanceof Date ? date : new Date(date)),
    now: () => new Date()
  };

  function getStoredUser() {
    try {
      return JSON.parse(localStorage.getItem('currentUser') || 'null');
    } catch {
      return null;
    }
  }

  function buildCollectionPath(parts) {
    return parts.filter(Boolean).join('/');
  }

  function makeDocSnap(id, data, exists) {
    return {
      id,
      exists: !!exists,
      data: () => (exists ? { ...data } : undefined),
      get: (field) => (exists ? data[field] : undefined)
    };
  }

  function makeQuerySnap(docs) {
    return {
      empty: docs.length === 0,
      size: docs.length,
      docs: docs.map((d) => makeDocSnap(d.id, d, true)),
      forEach: (fn) => docs.forEach((d) => fn(makeDocSnap(d.id, d, true)))
    };
  }

  class DocumentReference {
    constructor(pathParts, id) {
      this._parts = [...pathParts];
      this.id = id;
    }

    collection(name) {
      return new CollectionReference([...this._parts, this.id, name]);
    }

    async get() {
      const coll = buildCollectionPath(this._parts);
      const data = await FirestoreService.getDoc(coll, this.id);
      return makeDocSnap(this.id, data || {}, !!data);
    }

    set(data, options) {
      return this._write('set', data, options);
    }

    update(data) {
      return this._write('update', data);
    }

    delete() {
      return FirestoreService.deleteDoc(buildCollectionPath(this._parts), this.id);
    }

    onSnapshot(onNext, onError) {
      const coll = buildCollectionPath(this._parts);
      return FirestoreService.subscribeDoc(coll, this.id, (doc, err) => {
        if (err) { if (onError) onError(err); return; }
        onNext(doc ? makeDocSnap(doc.id, doc, true) : makeDocSnap(this.id, {}, false));
      });
    }

    async _write(mode, data, options) {
      const coll = buildCollectionPath(this._parts);
      if (mode === 'set') {
        if (options?.merge) await FirestoreService.upsertDoc(coll, this.id, data);
        else await FirestoreService.createDoc(coll, data, this.id);
      } else {
        await FirestoreService.updateDoc(coll, this.id, data);
      }
    }
  }

  class CollectionReference {
    constructor(pathParts) {
      this._parts = pathParts;
      this._wheres = [];
      this._orderBy = null;
      this._orderDir = 'desc';
      this._limit = null;
    }

    doc(id) {
      return new DocumentReference(this._parts, id || crypto.randomUUID?.() || String(Date.now()));
    }

    where(field, op, value) {
      const q = new CollectionReference(this._parts);
      q._wheres = [...this._wheres, [field, op, value]];
      q._orderBy = this._orderBy;
      q._orderDir = this._orderDir;
      q._limit = this._limit;
      return q;
    }

    orderBy(field, dir) {
      const q = new CollectionReference(this._parts);
      q._wheres = [...this._wheres];
      q._orderBy = field;
      q._orderDir = dir || 'desc';
      q._limit = this._limit;
      return q;
    }

    limit(n) {
      const q = new CollectionReference(this._parts);
      q._wheres = [...this._wheres];
      q._orderBy = this._orderBy;
      q._orderDir = this._orderDir;
      q._limit = n;
      return q;
    }

    async get() {
      const docs = await FirestoreService.getDocs(buildCollectionPath(this._parts), {
        where: this._wheres,
        orderBy: this._orderBy || undefined,
        orderDir: this._orderDir,
        limit: this._limit || undefined
      });
      return makeQuerySnap(docs);
    }

    async add(data) {
      const id = await FirestoreService.createDoc(buildCollectionPath(this._parts), data);
      return new DocumentReference(this._parts, id);
    }

    onSnapshot(onNext, onError) {
      return FirestoreService.subscribeCollection(
        buildCollectionPath(this._parts),
        { where: this._wheres, orderBy: this._orderBy, orderDir: this._orderDir, limit: this._limit },
        (docs, err) => {
          if (err) { if (onError) onError(err); return; }
          onNext(makeQuerySnap(docs || []));
        }
      );
    }
  }

  class FirestoreDatabase {
    collection(name) { return new CollectionReference([name]); }
    batch() {
      const ops = [];
      return {
        set(ref, data) { ops.push({ type: 'create', collection: buildCollectionPath(ref._parts), docId: ref.id, data }); },
        update(ref, data) { ops.push({ type: 'update', collection: buildCollectionPath(ref._parts), docId: ref.id, data }); },
        delete(ref) { ops.push({ type: 'delete', collection: buildCollectionPath(ref._parts), docId: ref.id }); },
        commit: () => FirestoreService.batchWrite(ops)
      };
    }
  }

  const _apps = {};
  const _defaultDb = new FirestoreDatabase();
  const _auth = createAuth();

  function getAuthUser() {
    if (typeof Auth !== 'undefined' && typeof Auth.restoreSession === 'function') {
      const session = Auth.restoreSession();
      if (session) return session;
    }
    return getStoredUser();
  }

  function createAuth() {
    const listeners = [];
    const user = getAuthUser();
    const authUser = user ? {
      uid: user.id || user.uid || user.username,
      email: user.email || `${user.username}@rriv.org.vn`,
      displayName: user.name || user.hoTen || user.username,
      role: user.role,
      systemRoles: user.systemRoles,
      isSuperAdmin: user.isSuperAdmin,
      appRolesCache: user.appRolesCache,
      getIdToken: async () => 'rriv-session'
    } : null;

    return {
      currentUser: authUser,
      onAuthStateChanged(cb) {
        listeners.push(cb);
        setTimeout(() => cb(authUser), 0);
        return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); };
      },
      setPersistence: () => Promise.resolve(),
      signInWithEmailAndPassword: () => {
        window.location.href = '/';
        return Promise.reject(new Error('Đăng nhập tại trang chủ RRIV'));
      },
      signOut: () => {
        if (typeof Auth !== 'undefined') Auth.logout();
        else window.location.href = '/';
        return Promise.resolve();
      }
    };
  }

  function authFn() { return _auth; }
  authFn.Auth = { Persistence: { LOCAL: 'local', SESSION: 'session', NONE: 'none' } };

  function initializeApp(config, name) {
    const app = { name: name || '[DEFAULT]', options: config || {} };
    _apps[app.name] = app;
    return app;
  }

  function app(name) {
    return _apps[name || '[DEFAULT]'] || { options: {} };
  }

  function firestore() { return _defaultDb; }
  firestore.FieldValue = FieldValue;
  firestore.Timestamp = Timestamp;

  function storage() {
    return {
      ref: () => ({
        put: async (file) => ({ ref: { getDownloadURL: async () => URL.createObjectURL(file) } }),
        getDownloadURL: async () => ''
      })
    };
  }

  function messaging() {
    return { getToken: async () => null, onMessage: () => () => {} };
  }

  function httpsCallable(name) {
    return async (data) => {
      const res = await fetch(`/api/functions/${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data || {})
      });
      const body = await res.json().catch(() => ({}));
      return { data: body };
    };
  }

  return {
    initializeApp, app, auth: authFn, firestore, storage, messaging, httpsCallable,
    FieldValue, Timestamp
  };
})();
