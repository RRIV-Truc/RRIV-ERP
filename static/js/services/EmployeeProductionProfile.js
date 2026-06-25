/**
 * Gán Tổ SX + nhóm CN/KH + mã NV trên bảng employee (dùng cho Sản lượng CN).
 * @module EmployeeProductionProfile
 */
const EmployeeProductionProfile = (function () {
  'use strict';

  var _teamsCache = null;
  var _groupsCache = null;

  function _db() { return ErpDb.firestore(); }

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  function _parseMeta(team) {
    var meta = team && team.metadata;
    if (!meta) return {};
    if (typeof meta === 'object') return meta;
    try { return JSON.parse(meta); } catch (e) { return {}; }
  }

  async function loadProductionTeams() {
    if (_teamsCache) return _teamsCache.slice();
    var snap = await _db().collection('categoryTeams').get();
    _teamsCache = snap.docs.map(function (d) {
      return Object.assign({ id: d.id }, d.data());
    });
    _teamsCache.sort(function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''), 'vi');
    });
    return _teamsCache.slice();
  }

  async function loadWorkGroups(teamId) {
    if (!_groupsCache) {
      var snap = await _db().collection('workGroups').get();
      _groupsCache = snap.docs.map(function (d) {
        return Object.assign({ id: d.id }, d.data());
      });
    }
    var list = _groupsCache;
    if (teamId) {
      list = list.filter(function (g) { return String(g.team_id) === String(teamId); });
    }
    return list.slice().sort(function (a, b) {
      return (a.sort_order || 0) - (b.sort_order || 0);
    });
  }

  function positionNameForWorkGroup(group) {
    if (!group) return '';
    var code = String(group.code || '').toUpperCase();
    if (code === 'KH') return 'Khoán hộ';
    if (code === 'CN') return 'CN cạo mủ';
    return group.name || '';
  }

  async function getEmployeeProductionFields(employeeId) {
    if (!employeeId) return {};
    try {
      var doc = await _db().collection('employee').doc(employeeId).get();
      return (doc && doc.data && doc.data()) || {};
    } catch (e) {
      return {};
    }
  }

  async function applyProfile(employeeId, opts) {
    if (!employeeId) return;
    opts = opts || {};
    var teamId = String(opts.teamId || '').trim();
    var workGroupId = String(opts.workGroupId || '').trim();
    var employeeCode = String(opts.employeeCode || '').trim();

    var teams = await loadProductionTeams();
    var team = teams.find(function (t) { return t.id === teamId; });
    var groups = await loadWorkGroups(teamId);
    var group = groups.find(function (g) { return g.id === workGroupId; });
    var meta = _parseMeta(team);

    var patch = {};

    if (teamId && team) {
      patch.team_id = teamId;
      patch.team_name = team.name || teamId;
      if (meta.department_id) patch.department_id = meta.department_id;
      if (team.department) patch.department_name = team.department;
    } else if (!teamId) {
      patch.team_id = null;
      patch.team_name = null;
      patch.work_group_id = null;
    }

    if (workGroupId && group) {
      patch.work_group_id = workGroupId;
      var pos = positionNameForWorkGroup(group);
      if (pos) patch.position_name = pos;
    } else if (teamId && !workGroupId) {
      patch.work_group_id = null;
    }

    if (employeeCode) patch.employee_code = employeeCode;

    if (!Object.keys(patch).length) return;
    await _db().collection('employee').doc(employeeId).set(patch, { merge: true });
  }

  function teamOptionsHtml(teams, selectedId) {
    var html = '<option value="">— Không gán tổ SX —</option>';
    (teams || []).forEach(function (t) {
      var sel = t.id === selectedId ? ' selected' : '';
      html += '<option value="' + _esc(t.id) + '"' + sel + '>' + _esc(t.name || t.id) + '</option>';
    });
    return html;
  }

  function workGroupOptionsHtml(groups, selectedId) {
    var html = '<option value="">— Chọn nhóm —</option>';
    (groups || []).forEach(function (g) {
      var sel = g.id === selectedId ? ' selected' : '';
      var label = (g.code ? g.code + ' — ' : '') + (g.name || g.id);
      html += '<option value="' + _esc(g.id) + '"' + sel + '>' + _esc(label) + '</option>';
    });
    return html;
  }

  async function fillWorkGroupSelect(selectEl, teamId, selectedGroupId) {
    if (!selectEl) return;
    var groups = await loadWorkGroups(teamId);
    selectEl.innerHTML = workGroupOptionsHtml(groups, selectedGroupId || '');
  }

  return {
    loadProductionTeams: loadProductionTeams,
    loadWorkGroups: loadWorkGroups,
    getEmployeeProductionFields: getEmployeeProductionFields,
    applyProfile: applyProfile,
    positionNameForWorkGroup: positionNameForWorkGroup,
    teamOptionsHtml: teamOptionsHtml,
    workGroupOptionsHtml: workGroupOptionsHtml,
    fillWorkGroupSelect: fillWorkGroupSelect
  };
})();
