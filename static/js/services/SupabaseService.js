/**
 * SupabaseService — thay FirestoreService, gọi Flask API /api/data/*
 * API tương thích FirestoreService để tái sử dụng CRUDService và module Phước Hòa.
 */
const SupabaseService = (function () {
  'use strict';

  const API_BASE = '/api/data';

  function getCurrentUser() {
    try {
      const raw = localStorage.getItem('currentUser');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function getCurrentUserId() {
    const u = getCurrentUser();
    return u?.id || u?.uid || null;
  }

  function getCurrentUserEmail() {
    const u = getCurrentUser();
    return u?.email || u?.username || null;
  }

  async function apiFetch(path, options = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.message || body.error || `HTTP ${res.status}`);
    }
    return body;
  }

  async function getDoc(collection, docId) {
    const result = await apiFetch(`${API_BASE}/${encodeURIComponent(collection)}/${encodeURIComponent(docId)}`);
    return result.data ?? null;
  }

  async function getDocs(collection, options = {}) {
    const result = await apiFetch(`${API_BASE}/${encodeURIComponent(collection)}/query`, {
      method: 'POST',
      body: JSON.stringify({
        where: options.where || [],
        orderBy: options.orderBy,
        orderDir: options.orderDir || 'desc',
        limit: options.limit
      })
    });
    let docs = result.data || [];
    if (options.factory) {
      docs = docs.filter(d => !d.factory || d.factory === options.factory);
    }
    return docs;
  }

  async function createDoc(collection, data, docId) {
    const result = await apiFetch(`${API_BASE}/${encodeURIComponent(collection)}`, {
      method: 'POST',
      body: JSON.stringify({ data, id: docId || null })
    });
    return result.id;
  }

  async function updateDoc(collection, docId, data) {
    await apiFetch(`${API_BASE}/${encodeURIComponent(collection)}/${encodeURIComponent(docId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ data })
    });
  }

  async function deleteDoc(collection, docId) {
    await apiFetch(`${API_BASE}/${encodeURIComponent(collection)}/${encodeURIComponent(docId)}`, {
      method: 'DELETE'
    });
  }

  async function upsertDoc(collection, docId, data) {
    const existing = await getDoc(collection, docId);
    if (existing) {
      await updateDoc(collection, docId, data);
    } else {
      await createDoc(collection, data, docId);
    }
    return docId;
  }

  async function batchWrite(operations) {
    await apiFetch(`${API_BASE}/batch`, {
      method: 'POST',
      body: JSON.stringify({ operations })
    });
  }

  function subscribeDoc(collection, docId, callback) {
    let active = true;
    const poll = async () => {
      if (!active) return;
      try {
        const doc = await getDoc(collection, docId);
        callback(doc, null);
      } catch (err) {
        callback(null, err);
      }
      if (active) setTimeout(poll, 5000);
    };
    poll();
    return () => { active = false; };
  }

  function subscribeCollection(collection, options, callback) {
    let active = true;
    const poll = async () => {
      if (!active) return;
      try {
        const docs = await getDocs(collection, options);
        callback(docs, null);
      } catch (err) {
        callback([], err);
      }
      if (active) setTimeout(poll, 8000);
    };
    poll();
    return () => { active = false; };
  }

  async function queryByDate(collection, dateField, dateValue, extraOptions = {}) {
    return getDocs(collection, {
      ...extraOptions,
      where: [...(extraOptions.where || []), [dateField, '==', dateValue]]
    });
  }

  async function countDocs(collection, options = {}) {
    const docs = await getDocs(collection, options);
    return docs.length;
  }

  function serverTimestamp() {
    return new Date().toISOString();
  }

  function arrayUnion(...elements) {
    return { __op: 'arrayUnion', elements };
  }

  function arrayRemove(...elements) {
    return { __op: 'arrayRemove', elements };
  }

  function increment(n) {
    return { __op: 'increment', value: n };
  }

  return {
    getDoc,
    getDocs,
    createDoc,
    updateDoc,
    deleteDoc,
    upsertDoc,
    batchWrite,
    subscribeDoc,
    subscribeCollection,
    queryByDate,
    countDocs,
    serverTimestamp,
    arrayUnion,
    arrayRemove,
    increment,
    getCurrentUserId,
    getCurrentUserEmail,
    getDb: () => null,
    getAuth: () => null
  };
})();
