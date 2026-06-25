/**
 * API RRIV — gọi Flask backend thay Cloud Functions Firebase
 */
const API = (function () {
  'use strict';

  const BASE = '/api/functions';

  async function call(name, data = {}) {
    const res = await fetch(`${BASE}/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || body.error || `HTTP ${res.status}`);
    return body;
  }

  return { call, BASE };
})();
