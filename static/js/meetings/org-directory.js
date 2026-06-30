/* org-directory.js — cây tổ chức Viện (logic tương tự nhansu/tree.js) */
(function () {
  'use strict';

  var ROOT_LABEL = 'Viện NC Cao su VN';

  var LEGACY_DEPT_KEYS = {
    'dl-1': ['vien-01'],
    'dl-5': ['vien-03'],
    'dl-6': ['vien-02', 'vien-04'],
    'dl-2': ['vien-05'],
    'dl-3': ['vien-06', 'vien-08', 'vien-09', 'vien-10'],
    'dl-4': ['vien-07']
  };

  function esc(t) {
    if (t === null || t === undefined) return '';
    return String(t).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function sortByOrder(arr) {
    return arr.slice().sort(function (a, b) {
      var oa = (a.order != null ? a.order : 999);
      var ob = (b.order != null ? b.order : 999);
      if (oa !== ob) return oa - ob;
      return String(a.label || a.name || '').localeCompare(String(b.label || b.name || ''), 'vi');
    });
  }

  function deptById(departments, id) {
    if (!id) return null;
    return departments.find(function (d) { return d.id === id || d.name === id; }) || null;
  }

  function teamById(teams, id) {
    if (!id) return null;
    return teams.find(function (t) { return t.id === id || t.name === id; }) || null;
  }

  function personInDept(p, deptId, departments) {
    if (!p || !deptId) return false;
    if (p.department === deptId) return true;
    var d = deptById(departments, p.department);
    if (d && d.id === deptId) return true;
    return (p.concurrentPositions || []).some(function (cp) {
      var dn = deptById(departments, cp.departmentName);
      return cp.departmentId === deptId || (dn && dn.id === deptId);
    });
  }

  function personInTeam(p, teamId, teams) {
    if (!p || !teamId) return false;
    if (p.team === teamId) return true;
    var t = teamById(teams, p.team);
    return t && t.id === teamId;
  }

  var STANDARD_POSITIONS = [
    { id: 'pos-giam-doc', name: 'Giám đốc', level: 1 },
    { id: 'pos-pho-giam-doc', name: 'Phó giám đốc', level: 2 },
    { id: 'pos-truong-phong', name: 'Trưởng phòng', level: 3 },
    { id: 'pos-pho-phong', name: 'Phó phòng', level: 4 },
    { id: 'pos-phu-trach', name: 'Phụ trách bộ phận', level: 5 },
    { id: 'pos-nhan-vien', name: 'Nhân viên', level: 6 }
  ];

  var SYSTEM_ROLE_LEVEL = {
    Super_Admin: 1,
    Institute_Executive: 2,
    Department_Head: 3,
    Operations_Specialist: 5,
    Technical_Staff: 6,
    Staff_Viewer: 7
  };

  var SYSTEM_ROLE_ID_LEVEL = {
    '1': 1,
    '2': 2,
    '3': 3,
    '4': 5,
    '5': 6,
    '6': 7
  };

  function normPosKey(s) {
    return String(s || '').trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function buildPositionCatalog(positions) {
    var byKey = {};
    function add(entry) {
      if (!entry) return;
      var name = String(entry.name || entry.id || '').trim();
      if (!name) return;
      var id = String(entry.id || name).trim();
      var key = normPosKey(id) || normPosKey(name);
      if (!key || byKey[key]) return;
      byKey[key] = { id: id, name: name, level: entry.level != null ? entry.level : 50 };
    }
    STANDARD_POSITIONS.forEach(add);
    (positions || []).forEach(add);
    return byKey;
  }

  function positionRawForDept(person, deptId, departments) {
    if (!person) return '';
    var cps = person.concurrentPositions || [];
    var i;
    for (i = 0; i < cps.length; i++) {
      var cp = cps[i];
      if (cp.departmentId === deptId) {
        return cp.positionName || cp.positionId || '';
      }
      var dn = deptById(departments, cp.departmentName);
      if (dn && dn.id === deptId) {
        return cp.positionName || cp.positionId || '';
      }
      if ((LEGACY_DEPT_KEYS[deptId] || []).indexOf(cp.departmentId) >= 0) {
        return cp.positionName || cp.positionId || '';
      }
    }
    return person.position || person.positionName || person.position_name || '';
  }

  function inferLevelFromTitle(raw) {
    var k = normPosKey(raw);
    if (!k) return 50;
    if (/giam\s*doc|giamdoc|director/.test(k) && !/pho/.test(k)) return 1;
    if (/pho\s*giam|phogiam|vice\s*director/.test(k)) return 2;
    if (/truong\s*phong|truongphong|head\s*of/.test(k) && !/pho/.test(k)) return 3;
    if (/pho\s*phong|phophong|deputy\s*head/.test(k)) return 4;
    if (/phu\s*trach|phutrach/.test(k)) return 5;
    if (/to\s*truong|totruong|team\s*lead/.test(k)) return 5;
    if (/chuyen\s*vi|chuyenvi|specialist/.test(k)) return 6;
    if (/ncv|ktv|nghien\s*cuu|researcher|technician/.test(k)) return 7;
    if (/nhan\s*vien|nhanvien|staff/.test(k)) return 8;
    return 50;
  }

  function positionLevel(raw, catalog) {
    if (!raw) return 50;
    var key = normPosKey(raw);
    if (catalog[key]) return catalog[key].level;
    var idKey = normPosKey(String(raw).replace(/\s+/g, '-'));
    if (catalog[idKey]) return catalog[idKey].level;
    var names = Object.keys(catalog);
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      if (key.indexOf(n) >= 0 || n.indexOf(key) >= 0) return catalog[n].level;
    }
    return inferLevelFromTitle(raw);
  }

  function systemRoleLevel(person, systemRoles) {
    var rid = person.systemRoleId
      || (person.metadata && (person.metadata.systemRoleId || person.metadata.system_role_id))
      || '';
    if (rid && SYSTEM_ROLE_ID_LEVEL[String(rid)] != null) {
      return SYSTEM_ROLE_ID_LEVEL[String(rid)];
    }
    if (systemRoles && rid) {
      var row = systemRoles.find(function (r) { return String(r.id) === String(rid); });
      if (row && SYSTEM_ROLE_LEVEL[row.role_name] != null) {
        return SYSTEM_ROLE_LEVEL[row.role_name];
      }
    }
    return 50;
  }

  function leadershipRank(person, deptId, orgData) {
    var catalog = buildPositionCatalog((orgData && orgData.positions) || []);
    var departments = (orgData && orgData.departments) || [];
    var posRaw = positionRawForDept(person, deptId, departments);
    var posLvl = positionLevel(posRaw, catalog);
    var roleLvl = systemRoleLevel(person, orgData && orgData.systemRoles);
    return Math.min(posLvl, roleLvl);
  }

  function positionLabelForDept(person, deptId, orgData) {
    var raw = positionRawForDept(person, deptId, (orgData && orgData.departments) || []);
    if (!raw) return '';
    var catalog = buildPositionCatalog((orgData && orgData.positions) || []);
    var key = normPosKey(raw);
    if (catalog[key]) return catalog[key].name;
    return String(raw);
  }

  function personName(p) {
    return (p.hoTen || p.fullName || p.full_name || p.name || p.username || '').trim();
  }

  function effOrder(person, deptId) {
    if (!person || !deptId) return person && person.listStt != null ? Number(person.listStt) : 999;
    var m = person.orderByDept || {};
    var keys = [deptId].concat(LEGACY_DEPT_KEYS[deptId] || []);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (m[k] !== undefined && m[k] !== null && m[k] !== '') return Number(m[k]);
    }
    if (person.listStt !== undefined && person.listStt !== null && person.listStt !== '') {
      return Number(person.listStt);
    }
    var cps = person.concurrentPositions || [];
    for (var j = 0; j < cps.length; j++) {
      var cp = cps[j];
      if (cp.departmentId === deptId || (LEGACY_DEPT_KEYS[deptId] || []).indexOf(cp.departmentId) >= 0) {
        if (cp.order !== undefined && cp.order !== null && cp.order !== '') return Number(cp.order);
      }
    }
    return 999;
  }

  function sortPeople(list, deptId, orgData) {
    return list.slice().sort(function (a, b) {
      var ctx = deptId || a.department;
      var oa = effOrder(a, ctx);
      var ob = effOrder(b, ctx);
      var aHasOrder = oa !== 999;
      var bHasOrder = ob !== 999;

      if (aHasOrder && bHasOrder && oa !== ob) return oa - ob;
      if (aHasOrder && !bHasOrder) return -1;
      if (!aHasOrder && bHasOrder) return 1;

      var la = leadershipRank(a, ctx, orgData);
      var lb = leadershipRank(b, ctx, orgData);
      if (la !== lb) return la - lb;

      if (aHasOrder && bHasOrder) return oa - ob;

      return personName(a).localeCompare(personName(b), 'vi');
    });
  }

  function deptIcon(d) {
    var t = String(d.dept_type || (d.metadata && d.metadata.dept_type) || '').toLowerCase();
    if (t.indexOf('ban') >= 0) return '🏛️';
    if (t.indexOf('trung') >= 0) return '🔬';
    return '🏢';
  }

  function buildOrgTree(orgData) {
    var personnel = (orgData.personnel || []).filter(function (p) { return !p.disabled; });
    var depts = orgData.departments || [];
    var teams = orgData.teams || [];

    function buildDeptNode(d) {
      var deptTeams = sortByOrder(
        teams.filter(function (t) { return t.department === d.id && !(t.metadata && t.metadata.retired); })
      );
      var childNodes = deptTeams.map(function (t) {
        var members = sortPeople(
          personnel.filter(function (p) { return personInTeam(p, t.id, teams); }),
          d.id,
          orgData
        );
        return {
          type: 'team',
          id: t.id,
          label: t.name,
          icon: '👥',
          order: t.order != null ? t.order : 999,
          deptId: d.id,
          children: members.map(function (p) { return personNode(p, d.id); })
        };
      });

      var noTeam = sortPeople(
        personnel.filter(function (p) {
          return personInDept(p, d.id, depts) && !p.team;
        }),
        d.id,
        orgData
      );

      if (noTeam.length > 0) {
        if (deptTeams.length > 0 && d.id !== 'dl-3') {
          childNodes.push({
            type: 'group',
            id: 'unteamed_' + d.id,
            label: 'Trực thuộc phòng',
            icon: '👤',
            order: 0,
            deptId: d.id,
            children: noTeam.map(function (p) { return personNode(p, d.id); })
          });
        } else {
          noTeam.forEach(function (p) {
            childNodes.push(personNode(p, d.id));
          });
        }
      }

      return {
        type: 'department',
        id: d.id,
        label: d.name,
        icon: deptIcon(d),
        order: d.order != null ? d.order : (d.metadata && d.metadata.order != null ? d.metadata.order : 999),
        children: sortByOrder(childNodes)
      };
    }

    function personNode(p, deptId) {
      var posLabel = positionLabelForDept(p, deptId, orgData);
      return {
        type: 'person',
        id: p.id,
        label: personName(p),
        icon: leadershipRank(p, deptId, orgData) <= 4 ? '⭐' : '👤',
        person: p,
        deptId: deptId,
        meta: [posLabel, p.employeeCode || p.code].filter(Boolean).join(' · ')
      };
    }

    return {
      type: 'root',
      id: 'root',
      label: ROOT_LABEL,
      icon: '🌿',
      children: sortByOrder(depts.map(buildDeptNode))
    };
  }

  function collectPersonIds(node, out) {
    out = out || [];
    if (!node) return out;
    if (node.type === 'person' && node.id) out.push(node.id);
    (node.children || []).forEach(function (c) { collectPersonIds(c, out); });
    return out;
  }

  function findPersonNode(tree, personId) {
    var found = null;
    function walk(n) {
      if (found) return;
      if (n.type === 'person' && n.id === personId) { found = n; return; }
      (n.children || []).forEach(walk);
    }
    walk(tree);
    return found;
  }

  window.PhonghopOrg = {
    ROOT_LABEL: ROOT_LABEL,
    esc: esc,
    sortByOrder: sortByOrder,
    personInDept: personInDept,
    personInTeam: personInTeam,
    personName: personName,
    buildOrgTree: buildOrgTree,
    collectPersonIds: collectPersonIds,
    findPersonNode: findPersonNode
  };
})();
