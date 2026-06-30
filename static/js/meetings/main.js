/* main.js — bootstrap app Phòng họp */
(function () {
  'use strict';

  var NS = window.PhonghopState;
  var SVC = window.PhonghopServices;
  var PERMS = window.PhonghopPerms;
  var db = null;

  function fmtDt(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch (_) { return iso; }
  }

  function statusBadge(st) {
    var map = {
      draft: 'Nháp', scheduled: 'Đã lên lịch', live: 'Đang họp',
      completed: 'Hoàn thành', cancelled: 'Đã hủy'
    };
    return map[st] || st;
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function canEditMeeting(m) {
    if (!PERMS.canCreateMeeting()) return false;
    var st = m.meeting_status || m.status || '';
    return st === 'scheduled' || st === 'draft' || st === 'live';
  }

  function openDetail(meetingId) {
    if (!window.MeetingDetail) return;
    window.MeetingDetail.open({
      meetingId: meetingId,
      rooms: NS.state.rooms,
      orgData: NS.state.orgDirectory,
      currentUser: NS.state.currentUser,
      reloadOrg: function () {
        return SVC.loadOrgDirectory(db).then(function (org) {
          NS.state.orgDirectory = org;
          return org;
        });
      },
      onUpdated: function () { refresh(); }
    });
  }

  function openEdit(meeting) {
    window.MeetingForm.open({
      meeting: meeting,
      rooms: NS.state.rooms,
      orgData: NS.state.orgDirectory,
      reloadOrg: function () {
        return SVC.loadOrgDirectory(db).then(function (org) {
          NS.state.orgDirectory = org;
          return org;
        });
      },
      onSaved: function () { refresh(); }
    });
  }

  function openRoom(meetingId) {
    if (!window.MeetingRoom) return;
    window.MeetingRoom.open({
      meetingId: meetingId,
      onClose: function () {
        resetViewAfterRoom();
        refresh();
      }
    });
  }

  function joinByCodeInput() {
    var input = document.getElementById('joinCodeInput');
    var code = input && input.value ? input.value.trim() : '';
    if (!code) {
      alert('Nhập mã cuộc họp (vd. MTG-2026-0001).');
      return;
    }
    if (!window.MeetingRoom) return;
    window.MeetingRoom.openByCode(code, {
      onClose: function () {
        resetViewAfterRoom();
        refresh();
      }
    }).catch(function (e) {
      alert(e.message || 'Không vào được phòng');
    });
  }

  function normalizeMeeting(m) {
    if (!m) return m;
    if (m.meeting_status && !m.status) m.status = m.meeting_status;
    if (m.meeting_id && !m.id) m.id = m.meeting_id;
    return m;
  }

  function renderList() {
    var el = document.getElementById('meetingsList');
    if (!el) return;
    if (!NS.state.meetings.length) {
      el.innerHTML = '<div class="ph-empty">Chưa có cuộc họp nào. Bấm <strong>Tạo cuộc họp</strong> để bắt đầu.</div>';
      return;
    }
    el.innerHTML = NS.state.meetings.map(function (raw) {
      var m = normalizeMeeting(raw);
      var id = m.id || m.meeting_id || '';
      var code = m.meeting_code || '';
      var title = m.title || '—';
      var st = m.meeting_status || m.status || '';
      var start = m.scheduled_start;
      var room = SVC.roomLabel(m, NS.state.rooms);
      var count = m.participant_count != null ? m.participant_count : '';
      var meta = [code, fmtDt(start)].filter(Boolean).join(' · ');
      if (room) meta += ' · ' + room;
      if (count !== '') meta += ' · ' + count + ' người mời';

      var actions = '';
      if (SVC.canJoinMeeting(m)) {
        actions += '<button type="button" class="ph-card-btn ph-card-btn-join" data-action="join" data-id="' + escapeHtml(id) + '">Vào phòng</button>';
      }
      actions += '<button type="button" class="ph-card-btn" data-action="detail" data-id="' + escapeHtml(id) + '">Chi tiết</button>';
      if (canEditMeeting(m)) {
        actions += '<button type="button" class="ph-card-btn ph-card-btn-accent" data-action="edit" data-id="' + escapeHtml(id) + '">Sửa</button>';
      }

      return '<article class="ph-card ph-card-clickable" data-id="' + escapeHtml(id) + '">' +
        '<div class="ph-card-head"><strong>' + escapeHtml(title) + '</strong>' +
        '<span class="ph-badge">' + escapeHtml(statusBadge(st)) + '</span></div>' +
        '<div class="ph-card-meta">' + escapeHtml(meta) + '</div>' +
        '<div class="ph-card-actions">' + actions + '</div></article>';
    }).join('');

    el.querySelectorAll('.ph-card-clickable').forEach(function (card) {
      card.addEventListener('click', function (e) {
        if (e.target.closest('.ph-card-btn')) return;
        var id = card.getAttribute('data-id');
        if (id) openDetail(id);
      });
    });

    el.querySelectorAll('.ph-card-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = btn.getAttribute('data-id');
        var action = btn.getAttribute('data-action');
        if (!id) return;
        if (action === 'detail') {
          openDetail(id);
        } else if (action === 'join') {
          openRoom(id);
        } else if (action === 'edit') {
          var meeting = NS.state.meetings.find(function (m) { return (m.id || m.meeting_id) === id; });
          if (meeting) openEdit(meeting);
        }
      });
    });
  }

  async function refresh() {
    NS.state.loading = true;
    try {
      NS.state.meetings = (await SVC.listMeetings(80)).map(normalizeMeeting);
      NS.state.rooms = await SVC.listRooms();
      renderList();
    } catch (e) {
      alert(e.message || 'Lỗi tải dữ liệu');
    } finally {
      NS.state.loading = false;
    }
  }

  function resetViewAfterRoom() {
    if (window.MeetingRoom && window.MeetingRoom.resetShell) {
      window.MeetingRoom.resetShell();
    } else {
      document.body.classList.remove('ph-room-active');
      var host = document.getElementById('meetingRoomHost');
      if (host) {
        host.innerHTML = '';
        host.classList.remove('ph-room-open');
      }
    }
  }

  function resumeFromCache() {
    resetViewAfterRoom();
    if (window.MeetingDetail && window.MeetingDetail.destroy) {
      window.MeetingDetail.destroy();
    }
    refresh();
  }

  function bindUi() {
    var btnCreate = document.getElementById('btnCreateMeeting');
    var btnRefresh = document.getElementById('btnRefresh');
    var btnHome = document.getElementById('btnHome');

    if (btnCreate) {
      btnCreate.addEventListener('click', async function () {
        if (!PERMS.canCreateMeeting()) {
          alert('Chỉ Manager hoặc Admin mới được tạo cuộc họp.');
          return;
        }
        await window.MeetingForm.open({
          rooms: NS.state.rooms,
          orgData: NS.state.orgDirectory,
          reloadOrg: function () {
            return SVC.loadOrgDirectory(db).then(function (org) {
              NS.state.orgDirectory = org;
              return org;
            });
          },
          onSaved: function () { refresh(); }
        });
      });
    }
    var btnJoin = document.getElementById('btnJoinByCode');
    var joinInput = document.getElementById('joinCodeInput');

    if (btnJoin) btnJoin.addEventListener('click', joinByCodeInput);
    if (joinInput) {
      joinInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); joinByCodeInput(); }
      });
    }
    if (btnRefresh) btnRefresh.addEventListener('click', refresh);
    if (btnHome) btnHome.addEventListener('click', function () { window.location.href = '/'; });

    var chip = document.getElementById('userChip');
    var u = NS.state.currentUser;
    if (chip && u) {
      var av = chip.querySelector('.avatar');
      var nm = chip.querySelector('.name');
      if (av) av.textContent = (u.hoTen || u.name || u.username || '?').charAt(0).toUpperCase();
      if (nm) nm.textContent = u.hoTen || u.name || u.username;
    }
  }

  async function bootstrap() {
    var authUser = await Auth.init();
    if (!authUser) {
      window.location.href = '/';
      return;
    }

    await Auth.loadUserProfile(authUser.username);
    var profile = Auth.getProfile() || authUser;
    NS.state.currentUser = Object.assign({}, authUser, profile);
    localStorage.setItem('currentUser', JSON.stringify(NS.state.currentUser));

    db = ErpDb.firestore();

    if (typeof Permissions !== 'undefined') {
      Permissions.initFromUserData(NS.state.currentUser);
      if (Permissions.loadRoleDefinitions) await Permissions.loadRoleDefinitions(db);
      Permissions.initFromUserData(NS.state.currentUser);
    }

    if (!PERMS.canAccessApp()) {
      alert('Bạn không có quyền truy cập ứng dụng Phòng họp.');
      window.location.href = '/';
      return;
    }

    NS.state.orgDirectory = await SVC.loadOrgDirectory(db);
    NS.state.employees = NS.state.orgDirectory.personnel.map(function (p) {
      return SVC.normalizeEmployee(p, p.id);
    }).filter(Boolean);

    if (!PERMS.canCreateMeeting()) {
      var btn = document.getElementById('btnCreateMeeting');
      if (btn) btn.style.display = 'none';
    }

    bindUi();
    await refresh();

    if (typeof RrivAppBar !== 'undefined' && RrivAppBar.refresh) RrivAppBar.refresh();
  }

  window.addEventListener('pagehide', function () {
    if (window.MeetingForm && window.MeetingForm.destroy) window.MeetingForm.destroy();
    if (window.MeetingDetail && window.MeetingDetail.destroy) window.MeetingDetail.destroy();
    if (window.MeetingRoom && window.MeetingRoom.destroy) window.MeetingRoom.destroy(true);
  });

  window.addEventListener('pageshow', function (e) {
    if (e.persisted) resumeFromCache();
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && NS.state.meetings.length) {
      resetViewAfterRoom();
      refresh();
    }
  });

  document.addEventListener('DOMContentLoaded', bootstrap);
})();
