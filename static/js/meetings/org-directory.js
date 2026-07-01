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

  /** ID phòng cũ → phòng chuẩn hiện hành (sau gộp/đổi tên). */
  var LEGACY_DEPT_MERGE = {
    'vien-01': 'dl-1',
    'vien-02': 'dl-6',
    'vien-03': 'dl-5',
    'vien-04': 'dl-6',
    'vien-05': 'dl-2',
    'vien-06': 'dl-3',
    'vien-07': 'dl-4',
    'vien-08': 'dl-3',
    'vien-09': 'dl-3',
    'vien-10': 'dl-3'
  };

  /** Tên phòng cũ (lower) → id chuẩn — sau đổi tên 30/06/2026. */
  var OLD_DEPT_NAME_TO_ID = {
    'phòng kế hoạch và khoa học - công nghệ': 'dl-5',
    'phòng khoa học - công nghệ': 'dl-5',
    'phòng khoa học công nghệ': 'dl-5',
    'phòng quản trị nhân sự - hành chính': 'dl-6',
    'phòng tài chính kế toán': 'dl-6',
    'phòng tài chính - kế toán': 'dl-6',
    'phòng quản trị tài chính kế toán': 'dl-6',
    'phòng quản trị - tài chính kế toán': 'dl-6'
  };

  function deptDisplayName(d) {
    return String(d.name || d.ten || d.tenPhongBan || d.ten_phong_ban || '').trim();
  }

  function isRetiredDeptName(name) {
    var lower = String(name || '').trim().toLowerCase();
    if (!lower) return false;
    if (lower.indexOf('kế hoạch') >= 0 && lower.indexOf('khoa học') >= 0) return true;
    if (lower.indexOf('quản trị') >= 0 && lower.indexOf('nhân sự') >= 0) return true;
    if (/tài chính/.test(lower) && /kế toán/.test(lower) && lower.indexOf('quản trị') < 0) return true;
    return false;
  }

  function filterDepartments(depts) {
    var list = (depts || []).filter(function (d) {
      return d.active !== false && !(d.metadata && d.metadata.retired);
    });
    var idSet = {};
    list.forEach(function (d) { idSet[d.id] = true; });

    return list.filter(function (d) {
      var canonical = LEGACY_DEPT_MERGE[d.id];
      if (canonical && idSet[canonical]) return false;
      if (isRetiredDeptName(deptDisplayName(d)) && d.id !== 'dl-5' && d.id !== 'dl-6') return false;
      return true;
    });
  }

  function resolveDeptId(raw, depts) {
    if (!raw) return '';
    var s = String(raw).trim();
    if (!s) return '';
    var hit = depts.find(function (d) { return d.id === s; });
    if (hit) return hit.id;
    hit = depts.find(function (d) { return deptDisplayName(d) === s; });
    if (hit) return hit.id;
    var lower = s.toLowerCase();
    if (OLD_DEPT_NAME_TO_ID[lower]) return OLD_DEPT_NAME_TO_ID[lower];
    if (LEGACY_DEPT_MERGE[s] && depts.some(function (d) { return d.id === LEGACY_DEPT_MERGE[s]; })) {
      return LEGACY_DEPT_MERGE[s];
    }
    return s;
  }

  function normalizePersonnelDepts(personnel, depts) {
    (personnel || []).forEach(function (p) {
      p.department = resolveDeptId(p.department || p.departmentId || p.department_name, depts);
      (p.concurrentPositions || []).forEach(function (cp) {
        if (!cp.departmentId && cp.departmentName) {
          cp.departmentId = resolveDeptId(cp.departmentName, depts);
        } else if (cp.departmentId) {
          cp.departmentId = resolveDeptId(cp.departmentId, depts);
        }
        if (cp.departmentName && OLD_DEPT_NAME_TO_ID[String(cp.departmentName).trim().toLowerCase()]) {
          var canon = depts.find(function (d) {
            return d.id === OLD_DEPT_NAME_TO_ID[String(cp.departmentName).trim().toLowerCase()];
          });
          if (canon) cp.departmentName = deptDisplayName(canon);
        }
      });
    });
  }

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
      .replace(/\u0111/g, 'd').replace(/\u0110/g, 'D')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function isDeputyTitle(k) {
    return /(?:^|\s)pho\s+(?:giam|truong|chanh)|(?:^|\s)pgd\b|phogiam|phophong|phogiamdoc|vice\s*director/.test(k);
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
    var meta = person.metadata || {};
    return person.position || person.positionName || person.position_name
      || person.chucVu || person.chuc_vu || meta.position || meta.position_name || '';
  }

  function orderByDeptMap(person) {
    if (!person) return {};
    if (person.orderByDept && typeof person.orderByDept === 'object') return person.orderByDept;
    var meta = person.metadata || {};
    return meta.orderByDept || {};
  }

  function listSttValue(person) {
    if (!person) return null;
    if (person.listStt !== undefined && person.listStt !== null && person.listStt !== '') {
      return Number(person.listStt);
    }
    var meta = person.metadata || {};
    if (meta.listStt !== undefined && meta.listStt !== null && meta.listStt !== '') {
      return Number(meta.listStt);
    }
    return null;
  }

  function inferLevelFromTitle(raw) {
    var k = normPosKey(raw);
    if (!k) return 50;
    if (/^gd\b|\bgd\s/.test(k)) return 1;
    if (/^pgd\b|\bpgd\s/.test(k)) return 2;
    if (/pho\s*giam|phogiam|vice\s*director|pgd/.test(k)) return 2;
    if (/giam\s*doc|giamdoc|director/.test(k) && !isDeputyTitle(k)) return 1;
    if (/chanh\s*van|chanhvan|vien\s*truong/.test(k) && !isDeputyTitle(k)) return 1;
    if (/pho\s*chanh|phochanh/.test(k)) return 2;
    if (/pho\s*truong\s*phong|phophong|(?:^|\s)pho\s+phong/.test(k)) return 4;
    if (/ke\s*toan\s*truong|ketoantruong/.test(k)) return 3;
    if (/truong\s*phong|truongphong|head\s*of/.test(k) && !isDeputyTitle(k)) return 3;
    if (/phu\s*trach|phutrach/.test(k)) return 5;
    if (/to\s*truong|totruong|team\s*lead/.test(k)) return 5;
    if (/chuyen\s*vi|chuyenvi|specialist/.test(k)) return 6;
    if (/cao\s*dang|caodang/.test(k)) return 7;
    if (/\bncv\b|\bktv\b|researcher|technician/.test(k)) return 7;
    if (/nhan\s*vien|nhanvien|staff/.test(k)) return 8;
    return 50;
  }

  function primaryPositionRaw(person) {
    var meta = person.metadata || {};
    return person.position || person.positionName || person.position_name
      || person.chucVu || person.chuc_vu || meta.position || meta.position_name || '';
  }

  function allPositionRawsForLeadership(person, deptId, departments) {
    var seen = {};
    var raws = [];
    function add(raw) {
      var s = String(raw || '').trim();
      if (!s || seen[s]) return;
      seen[s] = true;
      raws.push(s);
    }
    add(primaryPositionRaw(person));
    add(positionRawForDept(person, deptId, departments));
    (person.concurrentPositions || []).forEach(function (cp) {
      add(cp.positionName || cp.positionId);
    });
    return raws;
  }

  function personSortOrder(person, deptId, orgData) {
    var rank = leadershipRank(person, deptId, orgData);
    var ord = effOrder(person, deptId);
    return rank * 10000 + (ord === 999 ? 9999 : ord);
  }

  function positionLevel(raw, catalog) {
    if (!raw) return 50;
    var inferred = inferLevelFromTitle(raw);
    if (inferred < 50) return inferred;
    var key = normPosKey(raw);
    if (catalog[key]) return catalog[key].level;
    var idKey = normPosKey(String(raw).replace(/\s+/g, '-'));
    if (catalog[idKey]) return catalog[idKey].level;
    return 50;
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
    var raws = allPositionRawsForLeadership(person, deptId, departments);
    var posLvl = 50;
    var i;
    for (i = 0; i < raws.length; i++) {
      posLvl = Math.min(posLvl, positionLevel(raws[i], catalog));
    }
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
    if (!person || !deptId) {
      var ls = listSttValue(person);
      return ls != null ? ls : 999;
    }
    var m = orderByDeptMap(person);
    var keys = [deptId].concat(LEGACY_DEPT_KEYS[deptId] || []);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (m[k] !== undefined && m[k] !== null && m[k] !== '') return Number(m[k]);
    }
    var ls2 = listSttValue(person);
    if (ls2 != null) return ls2;
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

      var la = leadershipRank(a, ctx, orgData);
      var lb = leadershipRank(b, ctx, orgData);
      if (la !== lb) return la - lb;

      var oa = effOrder(a, ctx);
      var ob = effOrder(b, ctx);
      if (oa !== ob) return oa - ob;

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

    function buildDeptNode(d) {
      /* Một danh sách thống nhất / đơn vị — lãnh đạo luôn trên cùng (mọi TT, phòng, ban). */
      var allInDept = sortPeople(
        personnel.filter(function (p) { return personInDept(p, d.id, depts); }),
        d.id,
        orgData
      );

      return {
        type: 'department',
        id: d.id,
        label: d.name,
        icon: deptIcon(d),
        order: d.order != null ? d.order : (d.metadata && d.metadata.order != null ? d.metadata.order : 999),
        children: allInDept.map(function (p) { return personNode(p, d.id); })
      };
    }

    function personNode(p, deptId) {
      var posLabel = positionLabelForDept(p, deptId, orgData);
      var rank = leadershipRank(p, deptId, orgData);
      return {
        type: 'person',
        id: p.id,
        label: personName(p),
        icon: rank <= 4 ? '⭐' : '👤',
        order: personSortOrder(p, deptId, orgData),
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
    filterDepartments: filterDepartments,
    normalizePersonnelDepts: normalizePersonnelDepts,
    buildOrgTree: buildOrgTree,
    collectPersonIds: collectPersonIds,
    findPersonNode: findPersonNode
  };
})();
