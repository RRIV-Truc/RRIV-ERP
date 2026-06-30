/* services.js — API phonghop */
(function () {
  'use strict';

  var API = '/api/meetings';
  var ROOMS_API = '/api/meeting-rooms';

  function username() {
    var u = window.PhonghopState && window.PhonghopState.state.currentUser;
    if (u && u.username) return u.username;
    try {
      var c = JSON.parse(localStorage.getItem('currentUser') || 'null');
      return c && c.username ? c.username : '';
    } catch (_) { return ''; }
  }

  function headers() {
    return {
      'Content-Type': 'application/json',
      'X-RRIV-Username': username()
    };
  }

  function normalizeEmployee(doc, docId) {
    var x = doc || {};
    var status = String(x.employment_status || x.employmentStatus || x.status || 'active').toLowerCase();
    if (status === 'resigned' || status === 'terminated' || status === 'inactive') return null;
    if (x.disabled === true || x.account_locked === true) return null;

    var id = String(x.id || docId || '');
    if (!id) return null;

    var fullName = (
      x.full_name || x.fullName || x.hoTen || x.ho_ten || x.name || x.username || ''
    ).trim();
    if (!fullName) return null;

    return {
      id: id,
      employeeId: id,
      employeeCode: String(x.employee_code || x.employeeCode || x.code || '').trim(),
      username: String(x.username || '').trim().toLowerCase(),
      fullName: fullName,
      department: String(x.department_name || x.department || '').trim(),
      departmentId: String(x.department_id || x.departmentId || '').trim(),
      email: String(x.company_email || x.email || x.personal_email || '').trim().toLowerCase()
    };
  }

  async function listMeetings(limit) {
    var url = API + '?limit=' + (limit || 50) + '&username=' + encodeURIComponent(username());
    var res = await fetch(url, { headers: headers() });
    var body = await res.json();
    if (!res.ok) throw new Error(body.message || 'Lỗi tải danh sách họp');
    return body.meetings || [];
  }

  async function listRooms() {
    var res = await fetch(ROOMS_API + '?username=' + encodeURIComponent(username()), { headers: headers() });
    var body = await res.json();
    if (!res.ok) throw new Error(body.message || 'Lỗi tải phòng họp');
    return body.rooms || [];
  }

  async function createMeeting(payload) {
    var body = Object.assign({ username: username() }, payload);
    var res = await fetch(API, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body)
    });
    var data = await res.json();
    if (!res.ok) {
      var msg = data.message;
      if (Array.isArray(msg)) msg = msg.map(function (e) { return e.msg || JSON.stringify(e); }).join('; ');
      throw new Error(msg || 'Không tạo được cuộc họp');
    }
    return data.meeting;
  }

  async function getMeeting(meetingId) {
    var url = API + '/' + encodeURIComponent(meetingId) + '?username=' + encodeURIComponent(username());
    var res = await fetch(url, { headers: headers() });
    var data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Không tải được cuộc họp');
    return data.meeting;
  }

  async function updateMeeting(meetingId, payload) {
    var body = Object.assign({ username: username() }, payload);
    var res = await fetch(API + '/' + encodeURIComponent(meetingId), {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify(body)
    });
    var data = await res.json();
    if (!res.ok) {
      var msg = data.message;
      if (Array.isArray(msg)) msg = msg.map(function (e) { return e.msg || JSON.stringify(e); }).join('; ');
      throw new Error(msg || 'Không cập nhật được cuộc họp');
    }
    return data.meeting;
  }

  async function cancelMeeting(meetingId) {
    return updateMeeting(meetingId, { status: 'cancelled' });
  }

  async function lookupMeetingByCode(code) {
    var url = API + '/lookup?code=' + encodeURIComponent(code) + '&username=' + encodeURIComponent(username());
    var res = await fetch(url, { headers: headers() });
    var data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Không tìm thấy cuộc họp');
    return data.meeting;
  }

  async function joinRoom(meetingId) {
    var res = await fetch(API + '/' + encodeURIComponent(meetingId) + '/room/join', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ username: username() })
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Không vào được phòng');
    return data.room;
  }

  async function leaveRoom(meetingId) {
    var res = await fetch(API + '/' + encodeURIComponent(meetingId) + '/room/leave', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ username: username() })
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Lỗi rời phòng');
    return data.result;
  }

  async function getRoomState(meetingId) {
    var url = API + '/' + encodeURIComponent(meetingId) + '/room?username=' + encodeURIComponent(username());
    var res = await fetch(url, { headers: headers() });
    var data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Không tải phòng họp');
    return data.room;
  }

  async function sendRoomChat(meetingId, message) {
    var res = await fetch(API + '/' + encodeURIComponent(meetingId) + '/room/chat', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ username: username(), message: message })
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Không gửi được tin nhắn');
    return data.message;
  }

  function canJoinMeeting(m) {
    if (!m) return false;
    var st = (m.status || m.meeting_status || '').toLowerCase();
    return (st === 'scheduled' || st === 'live' || st === 'draft') && !!m.firebase_room_id;
  }

  function roomLabel(meeting, rooms) {
    if (!meeting) return '';
    if (meeting.room_code || meeting.room_name) {
      return [meeting.room_code, meeting.room_name].filter(Boolean).join(' — ');
    }
    var rid = meeting.physical_room_id;
    if (!rid || !rooms) return '';
    var r = rooms.find(function (x) { return x.id === rid; });
    return r ? [r.room_code, r.name].filter(Boolean).join(' — ') : '';
  }

  function modeLabel(mode) {
    var map = { hybrid: 'Kết hợp', in_person: 'Tại chỗ', online: 'Trực tuyến' };
    return map[mode] || mode || '—';
  }

  async function loadEmployees(db) {
    var org = await loadOrgDirectory(db);
    return org.personnel.map(function (p) {
      return normalizeEmployee(p, p.id);
    }).filter(Boolean);
  }

  function isInstitutePersonnel(p) {
    var meta = p.metadata || {};
    if (meta.hr_scope === 'production_kh') return false;
    var code = String(p.employeeCode || p.employee_code || p.code || '').toUpperCase();
    if (/^LK-KH-/.test(code)) return false;
    var wg = p.workGroupId || p.work_group_id || '';
    if (wg === 'wg-lk-kh') return false;
    var pos = String(p.position || p.positionName || p.position_name || '').toLowerCase();
    if (/khoán hộ/.test(pos)) return false;
    return true;
  }

  async function loadOrgDirectory(db) {
    if (!db || !db.collection) {
      return { personnel: [], departments: [], teams: [], positions: [], systemRoles: [] };
    }
    try {
      var posSnap = await db.collection('employeePositions').get().catch(function () {
        return { docs: [] };
      });
      var positionsMap = {};
      posSnap.docs.forEach(function (doc) {
        var data = doc.data();
        var userId = data.userId;
        if (!positionsMap[userId]) positionsMap[userId] = [];
        positionsMap[userId].push({
          id: doc.id,
          departmentId: data.departmentId,
          departmentName: data.departmentName,
          positionId: data.positionId,
          positionName: data.positionName,
          isPrimary: data.isPrimary,
          assignmentType: data.assignmentType,
          order: data.order
        });
      });

      var results = await Promise.all([
        db.collection('categoryPersonnel').get(),
        db.collection('categoryDepartments').orderBy('name').get().catch(function () {
          return db.collection('categoryDepartments').get();
        }),
        db.collection('categoryTeams').orderBy('name').get().catch(function () {
          return db.collection('categoryTeams').get();
        }),
        db.collection('categoryPositions').orderBy('name').get().catch(function () {
          return db.collection('categoryPositions').get().catch(function () { return { docs: [] }; });
        }),
        fetch('/api/system-roles').then(function (r) { return r.json(); }).catch(function () { return {}; })
      ]);

      var personnel = results[0].docs.map(function (d) {
        var data = d.data();
        var meta = data.metadata || {};
        return Object.assign({}, data, {
          id: d.id,
          hoTen: data.hoTen || data.name || data.full_name || '',
          employeeCode: data.employeeCode || data.code || '',
          disabled: data.disabled != null ? data.disabled : (data.status === 'inactive' || data.status === 'resigned'),
          concurrentPositions: positionsMap[d.id] || [],
          systemRoleId: meta.systemRoleId || meta.system_role_id || data.systemRoleId || null
        });
      }).filter(isInstitutePersonnel);

      var departments = results[1].docs.map(function (d) {
        return Object.assign({ id: d.id }, d.data());
      });

      var teams = results[2].docs.map(function (d) {
        return Object.assign({ id: d.id }, d.data());
      }).filter(function (t) { return !(t.metadata && t.metadata.retired); });

      var positions = (results[3].docs || []).map(function (d) {
        return Object.assign({ id: d.id }, d.data());
      });

      var systemRolesBody = results[4] || {};
      var systemRoles = systemRolesBody.roles || [
        { id: 1, role_name: 'Super_Admin' },
        { id: 2, role_name: 'Institute_Executive' },
        { id: 3, role_name: 'Department_Head' },
        { id: 4, role_name: 'Operations_Specialist' },
        { id: 5, role_name: 'Technical_Staff' },
        { id: 6, role_name: 'Staff_Viewer' }
      ];

      personnel.sort(function (a, b) {
        return (a.hoTen || '').localeCompare(b.hoTen || '', 'vi');
      });

      return {
        personnel: personnel,
        departments: departments,
        teams: teams,
        positions: positions,
        systemRoles: systemRoles
      };
    } catch (e) {
      console.warn('[PhonghopServices] loadOrgDirectory', e.message);
      return { personnel: [], departments: [], teams: [], positions: [], systemRoles: [] };
    }
  }

  function findEmployeeByToken(employees, token) {
    if (!token) return null;
    var t = String(token).trim().toLowerCase();
    var tUpper = t.toUpperCase();
    return employees.find(function (e) {
      return e.username === t
        || e.email === t
        || (e.employeeCode && e.employeeCode.toUpperCase() === tUpper)
        || e.id === token;
    }) || null;
  }

  window.PhonghopServices = {
    listMeetings: listMeetings,
    listRooms: listRooms,
    createMeeting: createMeeting,
    getMeeting: getMeeting,
    updateMeeting: updateMeeting,
    cancelMeeting: cancelMeeting,
    lookupMeetingByCode: lookupMeetingByCode,
    joinRoom: joinRoom,
    leaveRoom: leaveRoom,
    getRoomState: getRoomState,
    sendRoomChat: sendRoomChat,
    canJoinMeeting: canJoinMeeting,
    loadEmployees: loadEmployees,
    loadOrgDirectory: loadOrgDirectory,
    normalizeEmployee: normalizeEmployee,
    findEmployeeByToken: findEmployeeByToken,
    roomLabel: roomLabel,
    modeLabel: modeLabel,
    username: username
  };
})();
