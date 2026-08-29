/* services.js — API TBKL */
(function () {
  'use strict';

  var API = '/api/tbkl';

  function username() {
    var u = TbklPermissions.getUser();
    return u && u.username ? String(u.username).toLowerCase() : '';
  }

  function headers(json) {
    var h = { 'X-RRIV-Username': username() };
    if (json !== false) h['Content-Type'] = 'application/json';
    return h;
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

  function planTemplateUrl(meetingSeq) {
    var seq = meetingSeq || 1;
    return API + '/plan-template.xlsx?meeting_seq=' + encodeURIComponent(seq) +
      '&username=' + encodeURIComponent(username());
  }

  window.TbklServices = {
    username: username,
    planTemplateUrl: planTemplateUrl,
    getContext: function () { return apiFetch('/context'); },
    listCycles: function () { return apiFetch('/cycles'); },
    createCycle: function (payload) {
      return apiFetch('/cycles', { method: 'POST', body: JSON.stringify(payload || {}) });
    },
    createCycleFull: function (formData) {
      var url = API + '/cycles/create-full?username=' + encodeURIComponent(username());
      return fetch(url, {
        method: 'POST',
        headers: { 'X-RRIV-Username': username() },
        body: formData
      }).then(function (res) {
        return parseJson(res, 'Lỗi tạo cuộc họp').then(function (body) {
          if (!res.ok) {
            throw new Error(body.message || ('HTTP ' + res.status));
          }
          return body;
        });
      });
    },
    getConclusionPdfUrl: function (cycleId) {
      return apiFetch('/cycles/' + encodeURIComponent(cycleId) + '/conclusion-pdf');
    },
    parsePlanFile: function (file) {
      var fd = new FormData();
      fd.append('plan_workbook', file);
      var url = API + '/plan/parse?username=' + encodeURIComponent(username());
      return fetch(url, {
        method: 'POST',
        headers: { 'X-RRIV-Username': username() },
        body: fd
      }).then(function (res) {
        return parseJson(res, 'Lỗi đọc file kế hoạch').then(function (body) {
          if (!res.ok) throw new Error(body.message || ('HTTP ' + res.status));
          return body;
        });
      });
    },
    publishPlan: function (cycleId, plan, replace) {
      return apiFetch('/cycles/' + encodeURIComponent(cycleId) + '/plan/publish', {
        method: 'POST',
        body: JSON.stringify({ plan: plan, replace: !!replace })
      });
    },
    getDashboard: function (cycleId, unitOnly) {
      var path = '/cycles/' + encodeURIComponent(cycleId) + '/dashboard';
      if (unitOnly) path += '?unit_only=1';
      return apiFetch(path);
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
    confirmReport: function (taskId, payload) {
      return apiFetch('/tasks/' + encodeURIComponent(taskId) + '/confirm', {
        method: 'POST', body: JSON.stringify(payload || {})
      });
    },
    assessDirective: function (directiveId, payload) {
      return apiFetch('/directives/' + encodeURIComponent(directiveId) + '/assess', {
        method: 'POST', body: JSON.stringify(payload || {})
      });
    },
    confirmDirective: function (directiveId, payload) {
      return apiFetch('/directives/' + encodeURIComponent(directiveId) + '/confirm', {
        method: 'POST', body: JSON.stringify(payload || {})
      });
    },
    uploadCycleAttachments: function (cycleId, formData) {
      var url = API + '/cycles/' + encodeURIComponent(cycleId) + '/attachments?username=' +
        encodeURIComponent(username());
      return fetch(url, {
        method: 'POST',
        headers: { 'X-RRIV-Username': username() },
        body: formData
      }).then(function (res) {
        return parseJson(res, 'Lỗi cập nhật file').then(function (body) {
          if (!res.ok) throw new Error(body.message || ('HTTP ' + res.status));
          return body;
        });
      });
    },
    lockCycle: function (cycleId) {
      return apiFetch('/cycles/' + encodeURIComponent(cycleId) + '/lock', { method: 'POST', body: '{}' });
    },
    listSeeds: function () { return apiFetch('/seeds'); },
    importSeed: function (seedId, replace) {
      return apiFetch('/seeds/' + encodeURIComponent(seedId) + '/import', {
        method: 'POST',
        body: JSON.stringify({ replace: !!replace })
      });
    },
    loadDepartments: loadDepartments
  };
})();
