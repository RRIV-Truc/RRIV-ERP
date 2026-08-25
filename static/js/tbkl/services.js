/* services.js — API TBKL */
(function () {
  'use strict';

  var API = '/api/tbkl';

  function username() {
    var u = TbklPermissions.getUser();
    return u && u.username ? String(u.username).toLowerCase() : '';
  }

  function headers() {
    return {
      'Content-Type': 'application/json',
      'X-RRIV-Username': username()
    };
  }

  async function parseJson(res, fallback) {
    var text = await res.text();
    try { return JSON.parse(text); } catch (_) {
      throw new Error(fallback || 'Phản hồi server không hợp lệ');
    }
  }

  async function apiFetch(path, opts) {
    opts = opts || {};
    var url = API + path;
    if (url.indexOf('username=') < 0) {
      url += (url.indexOf('?') >= 0 ? '&' : '?') + 'username=' + encodeURIComponent(username());
    }
    var res = await fetch(url, Object.assign({ headers: headers() }, opts));
    var body = await parseJson(res, 'Lỗi kết nối TBKL');
    if (!res.ok) {
      var msg = body.message;
      if (typeof msg !== 'string') msg = JSON.stringify(msg);
      throw new Error(msg || ('HTTP ' + res.status));
    }
    return body;
  }

  async function loadDepartments() {
    if (typeof ErpDb === 'undefined') return [];
    var snap = await ErpDb.firestore().collection('categoryDepartments').get();
    var list = [];
    snap.forEach(function (doc) {
      var d = doc.data() || {};
      list.push({
        id: doc.id,
        name: d.name || d.department_name || doc.id
      });
    });
    list.sort(function (a, b) { return a.name.localeCompare(b.name, 'vi'); });
    return list;
  }

  window.TbklServices = {
    username: username,
    getContext: function () { return apiFetch('/context'); },
    listCycles: function () { return apiFetch('/cycles'); },
    createCycle: function (payload) {
      return apiFetch('/cycles', { method: 'POST', body: JSON.stringify(payload || {}) });
    },
    getDashboard: function (cycleId) {
      return apiFetch('/cycles/' + encodeURIComponent(cycleId) + '/dashboard');
    },
    createDirective: function (cycleId, payload) {
      return apiFetch('/cycles/' + encodeURIComponent(cycleId) + '/directives', {
        method: 'POST', body: JSON.stringify(payload || {})
      });
    },
    createTask: function (directiveId, payload) {
      return apiFetch('/directives/' + encodeURIComponent(directiveId) + '/tasks', {
        method: 'POST', body: JSON.stringify(payload || {})
      });
    },
    submitReport: function (taskId, payload) {
      return apiFetch('/tasks/' + encodeURIComponent(taskId) + '/reports', {
        method: 'POST', body: JSON.stringify(payload || {})
      });
    },
    lockCycle: function (cycleId) {
      return apiFetch('/cycles/' + encodeURIComponent(cycleId) + '/lock', { method: 'POST', body: '{}' });
    },
    loadDepartments: loadDepartments
  };
})();
