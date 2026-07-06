/* main.js — Phòng họp e-Cabinet */
(function () {
  'use strict';

  var NS = window.PhonghopState;
  var SVC = window.PhonghopServices;
  var PERMS = window.PhonghopPerms;
  var db = null;
  var listFilter = { dash: 'live', calendar: 'upcoming' };
  var searchQuery = '';

  function fmtDt(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('vi-VN', {
        hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric'
      });
    } catch (_) { return iso; }
  }

  function statusBadge(st, m) {
    var s = (st || '').toLowerCase();
    if ((s === 'scheduled' || s === 'draft') && m && SVC.isMeetingPastByDay(m)) {
      return 'Quá hạn';
    }
    var map = {
      draft: 'Nháp', scheduled: 'Đã lên lịch', live: 'Đang họp',
      completed: 'Hoàn thành', cancelled: 'Đã hủy'
    };
    return map[s] || st;
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function normalizeMeeting(m) {
    if (!m) return m;
    if (m.meeting_status && !m.status) m.status = m.meeting_status;
    if (m.meeting_id && !m.id) m.id = m.meeting_id;
    return m;
  }

  function meetingBucket(m) {
    var st = (m.meeting_status || m.status || '').toLowerCase();
    if (st === 'live') return 'live';
    if (st === 'completed' || st === 'cancelled') return 'past';
    if (SVC.isMeetingPastByDay(m)) return 'past';
    return 'upcoming';
  }

  function filterMeetings(list, bucket) {
    return list.filter(function (raw) {
      var m = normalizeMeeting(raw);
      if (searchQuery) {
        var q = searchQuery.toLowerCase();
        var hay = [m.title, m.meeting_code, m.description].join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return meetingBucket(m) === bucket;
    });
  }

  function canEditMeeting(m) {
    if (!PERMS.canCreateMeeting()) return false;
    var st = m.meeting_status || m.status || '';
    return st === 'scheduled' || st === 'draft' || st === 'live';
  }

  function canDeleteMeeting() {
    return PERMS.canDeleteMeeting && PERMS.canDeleteMeeting();
  }

  async function confirmDeleteMeeting(m) {
    var id = m.id || m.meeting_id;
    if (!id) return;
    var st = (m.meeting_status || m.status || '').toLowerCase();
    var label = [m.meeting_code, m.title].filter(Boolean).join(' — ');
    var msg = 'Xóa vĩnh viễn cuộc họp "' + label + '"?\n\nDữ liệu sẽ không khôi phục được.';
    if (st === 'live') msg = 'Cuộc họp đang diễn ra.\n\n' + msg;
    if (!confirm(msg)) return;
    try {
      await SVC.deleteMeeting(id);
      await refresh();
    } catch (e) {
      alert(e.message || 'Không xóa được cuộc họp');
    }
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
    if (!window.MeetingForm || !window.MeetingForm.open) {
      alert('Không mở được form sửa — tải lại trang (Ctrl+F5).');
      return;
    }
    var m = normalizeMeeting(Object.assign({}, meeting || {}));
    if (!m.id && m.meeting_id) m.id = m.meeting_id;
    if (!m.id) {
      alert('Không xác định được cuộc họp cần sửa.');
      return;
    }
    window.MeetingForm.open({
      meeting: m,
      rooms: NS.state.rooms,
      orgData: NS.state.orgDirectory,
      reloadOrg: function () {
        if (!db) return Promise.resolve(NS.state.orgDirectory || { personnel: [], departments: [], teams: [] });
        return SVC.loadOrgDirectory(db).then(function (org) {
          NS.state.orgDirectory = org;
          return org;
        });
      },
      onSaved: function () { refresh(); }
    }).catch(function (e) {
      alert(e.message || 'Không mở được form sửa cuộc họp');
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

  function renderCard(m) {
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
    if (canDeleteMeeting()) {
      actions += '<button type="button" class="ph-card-btn ph-card-btn-danger" data-action="delete" data-id="' + escapeHtml(id) + '">Xóa</button>';
    }

    return '<article class="ph-card ph-card-clickable" data-id="' + escapeHtml(id) + '">' +
      '<div class="ph-card-head"><strong>' + escapeHtml(title) + '</strong>' +
      '<span class="ph-badge">' + escapeHtml(statusBadge(st, m)) + '</span></div>' +
      '<div class="ph-card-meta">' + escapeHtml(meta) + '</div>' +
      '<div class="ph-card-actions">' + actions + '</div></article>';
  }

  function bindListEvents(el) {
    if (!el) return;
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
        if (action === 'detail') openDetail(id);
        else if (action === 'join') openRoom(id);
        else if (action === 'edit') {
          var meeting = NS.state.meetings.find(function (m) { return (m.id || m.meeting_id) === id; });
          if (meeting) openEdit(meeting);
        } else if (action === 'delete') {
          var toDelete = NS.state.meetings.find(function (m) { return (m.id || m.meeting_id) === id; });
          if (toDelete) confirmDeleteMeeting(toDelete);
        }
      });
    });
  }

  function renderInto(el, bucket) {
    if (!el) return;
    var items = filterMeetings(NS.state.meetings, bucket);
    if (!items.length) {
      var labels = { live: 'Không có cuộc họp đang diễn ra.', upcoming: 'Chưa có cuộc họp sắp tới.', past: 'Chưa có cuộc họp đã kết thúc.' };
      el.innerHTML = '<div class="ph-empty">' + (labels[bucket] || 'Chưa có cuộc họp.') +
        (PERMS.canCreateMeeting() && bucket !== 'past' ? ' Bấm <strong>Tạo cuộc họp</strong>.' : '') + '</div>';
      return;
    }
    el.innerHTML = items.map(function (raw) { return renderCard(normalizeMeeting(raw)); }).join('');
    bindListEvents(el);
  }

  function updateWidgets() {
    var all = NS.state.meetings.map(normalizeMeeting);
    var live = all.filter(function (m) { return meetingBucket(m) === 'live'; }).length;
    var upcoming = all.filter(function (m) { return meetingBucket(m) === 'upcoming'; }).length;
    var past = all.filter(function (m) { return meetingBucket(m) === 'past'; }).length;
    var set = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = String(v); };
    set('phWLive', live);
    set('phWUpcoming', upcoming);
    set('phWPast', past);
  }

  function renderList() {
    renderInto(document.getElementById('meetingsList'), listFilter.dash);
    renderInto(document.getElementById('meetingsListFull'), listFilter.calendar);
    updateWidgets();
  }

  function showListError(msg) {
    var html = '<div class="ph-empty ph-empty-err">' + escapeHtml(msg || 'Lỗi tải dữ liệu') +
      ' <button type="button" class="ph-btn ph-btn-sm" id="phListRetry">Thử lại</button></div>';
    ['meetingsList', 'meetingsListFull'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = html;
    });
    var retry = document.getElementById('phListRetry');
    if (retry) retry.addEventListener('click', function () { refresh(); });
  }

  async function refresh() {
    NS.state.loading = true;
    try {
      NS.state.meetings = (await SVC.listMeetings(80)).map(normalizeMeeting);
      try {
        NS.state.rooms = await SVC.listRooms();
      } catch (roomErr) {
        console.warn('[phonghop] listRooms', roomErr);
        NS.state.rooms = NS.state.rooms || [];
      }
      renderList();
    } catch (e) {
      console.error('[phonghop] refresh', e);
      showListError(e.message || 'Lỗi tải dữ liệu');
    } finally {
      NS.state.loading = false;
    }
  }

  function resetViewAfterRoom() {
    if (window.MeetingRoom && window.MeetingRoom.resetShell) {
      window.MeetingRoom.resetShell();
    }
    document.body.classList.remove('ph-in-session');
    document.body.classList.remove('ph-room-active');
    updateMeetingFloatBar(false);
  }

  function resumeFromCache() {
    if (window.MeetingRoom && window.MeetingRoom.isActive && window.MeetingRoom.isActive()) {
      window.MeetingRoom.restoreUi && window.MeetingRoom.restoreUi();
      return;
    }
    if (window.MeetingRoom && window.MeetingRoom.resumeStoredSession) {
      window.MeetingRoom.resumeStoredSession().then(function (ok) {
        if (!ok) refresh();
      });
      return;
    }
    refresh();
  }

  function switchViewSilent(viewId) {
    document.querySelectorAll('.ph-nav-item').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-view') === viewId);
    });
    document.querySelectorAll('.ph-view').forEach(function (v) {
      v.classList.toggle('is-visible', v.getAttribute('data-view') === viewId);
    });
  }

  function isSessionViewVisible() {
    var el = document.querySelector('.ph-view.is-visible[data-view="session"]');
    return !!el;
  }

  function updateMeetingFloatBar(show) {
    var bar = document.getElementById('phMeetingFloatBar');
    if (!bar) return;
    var inMeeting = window.MeetingRoom && window.MeetingRoom.isActive && window.MeetingRoom.isActive();
    var visible = show != null ? show : (inMeeting && !isSessionViewVisible());
    bar.hidden = !visible;
    if (visible && inMeeting) {
      var titleEl = bar.querySelector('.ph-meeting-float-title');
      if (titleEl && window.MeetingRoom.getMeetingId) {
        titleEl.textContent = 'Đang trong phiên họp';
      }
    }
  }

  function switchView(viewId) {
    var inMeeting = window.MeetingRoom && window.MeetingRoom.isActive && window.MeetingRoom.isActive();

    if (viewId === 'session') {
      if (inMeeting && window.MeetingRoom.restoreUi) {
        window.MeetingRoom.restoreUi();
      }
      switchViewSilent('session');
      if (document.body.classList.contains('ph-in-session')) {
        focusContextTab('chat');
      }
      updateMeetingFloatBar(false);
      return;
    }

    if (inMeeting) {
      switchViewSilent(viewId);
      updateMeetingFloatBar(true);
      return;
    }

    switchViewSilent(viewId);
    updateMeetingFloatBar(false);
    if (viewId === 'documents' && window.MeetingDocs) {
      window.MeetingDocs.refresh().catch(function (e) {
        console.warn('[Phonghop] MeetingDocs', e.message);
      });
    }
    var sidebar = document.getElementById('phSidebar');
    if (sidebar) sidebar.classList.remove('is-open');
  }

  function focusContextTab(tabId) {
    document.querySelectorAll('.ph-ctx-tab').forEach(function (tab) {
      var on = tab.getAttribute('data-ctx') === tabId;
      tab.classList.toggle('is-active', on);
    });
    document.querySelectorAll('.ph-ctx-panel').forEach(function (p) {
      p.classList.toggle('is-visible', p.getAttribute('data-ctx-panel') === tabId);
    });
    var ctx = document.getElementById('phContext');
    if (ctx) ctx.classList.add('is-open');
  }

  var viewBeforeSession = 'dashboard';

  window.PhonghopShell = {
    switchView: switchView,
    switchViewSilent: switchViewSilent,
    showSessionView: function () {
      switchViewSilent('session');
      document.querySelectorAll('.ph-nav-item').forEach(function (btn) {
        btn.classList.toggle('is-active', btn.getAttribute('data-view') === 'session');
      });
      focusContextTab('chat');
      updateMeetingFloatBar(false);
    },
    updateMeetingFloatBar: updateMeetingFloatBar,
    getViewBeforeSession: function () { return viewBeforeSession || 'dashboard'; },
    openDocumentsForMeeting: function (meetingId, opts) {
      opts = opts || {};
      var inSession = opts.fromSession != null
        ? !!opts.fromSession
        : document.body.classList.contains('ph-in-session');
      if (window.MeetingDocs && meetingId) {
        window.MeetingDocs.setMeeting(meetingId, { sharedOnly: inSession });
      }
      switchView('documents');
    },
    enterSession: function () {
      viewBeforeSession = document.querySelector('.ph-view.is-visible');
      viewBeforeSession = viewBeforeSession ? viewBeforeSession.getAttribute('data-view') : 'dashboard';
      if (viewBeforeSession === 'session') viewBeforeSession = 'dashboard';
      switchViewSilent('session');
      focusContextTab('chat');
      document.body.classList.add('ph-in-session');
      document.body.classList.add('ph-room-active');
      updateMeetingFloatBar(false);
    },
    leaveSession: function () {
      document.body.classList.remove('ph-in-session');
      document.body.classList.remove('ph-room-active');
      switchViewSilent(viewBeforeSession || 'dashboard');
      updateMeetingFloatBar(false);
    }
  };

  function bindTabs(container, groupKey) {
    if (!container) return;
    container.querySelectorAll('.ph-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        container.querySelectorAll('.ph-tab').forEach(function (t) { t.classList.remove('is-active'); });
        tab.classList.add('is-active');
        listFilter[groupKey] = tab.getAttribute('data-filter') || 'upcoming';
        renderList();
      });
    });
  }

  function bindShell() {
    document.querySelectorAll('.ph-nav-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchView(btn.getAttribute('data-view'));
      });
    });

    var toggle = document.getElementById('phSidebarToggle');
    if (toggle) {
      toggle.addEventListener('click', function () {
        document.getElementById('phSidebar').classList.toggle('is-open');
      });
    }

    bindTabs(document.querySelector('[data-tabs="dash"]'), 'dash');
    bindTabs(document.querySelector('[data-tabs="calendar"]'), 'calendar');

    var search = document.getElementById('phSearchInput');
    if (search) {
      search.addEventListener('input', function () {
        searchQuery = search.value.trim();
        renderList();
      });
    }

    document.querySelectorAll('.ph-ctx-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        var id = tab.getAttribute('data-ctx');
        document.querySelectorAll('.ph-ctx-tab').forEach(function (t) { t.classList.remove('is-active'); });
        tab.classList.add('is-active');
        document.querySelectorAll('.ph-ctx-panel').forEach(function (p) {
          p.classList.toggle('is-visible', p.getAttribute('data-ctx-panel') === id);
        });
      });
    });

    var fab = document.getElementById('phFabContext');
    var ctx = document.getElementById('phContext');
    var ctxClose = document.getElementById('phContextClose');
    if (fab && ctx) fab.addEventListener('click', function () { ctx.classList.add('is-open'); });
    if (ctxClose && ctx) ctxClose.addEventListener('click', function () { ctx.classList.remove('is-open'); });

    document.querySelectorAll('.ph-doc-tools').forEach(function (bar) {
      bar.querySelectorAll('.ph-tool').forEach(function (tool) {
        tool.addEventListener('click', function () {
          bar.querySelectorAll('.ph-tool').forEach(function (t) { t.classList.remove('is-active'); });
          tool.classList.add('is-active');
        });
      });
    });

    var today = document.getElementById('phTodayLabel');
    if (today) {
      today.textContent = new Date().toLocaleDateString('vi-VN', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      });
    }
  }

  function openCreateForm() {
    if (!PERMS.canCreateMeeting()) {
      alert('Chỉ Manager hoặc Admin mới được tạo cuộc họp.');
      return;
    }
    return window.MeetingForm.open({
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

  function bindUi() {
    ['btnCreateMeeting', 'btnCreateMeeting2'].forEach(function (id) {
      var btn = document.getElementById(id);
      if (btn) btn.addEventListener('click', function () { openCreateForm(); });
    });
    ['btnRefresh', 'btnRefresh2'].forEach(function (id) {
      var btn = document.getElementById(id);
      if (btn) btn.addEventListener('click', refresh);
    });

    var btnJoin = document.getElementById('btnJoinByCode');
    var joinInput = document.getElementById('joinCodeInput');
    if (btnJoin) btnJoin.addEventListener('click', joinByCodeInput);
    if (joinInput) {
      joinInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); joinByCodeInput(); }
      });
    }

    var btnHome = document.getElementById('btnHome');
    if (btnHome) btnHome.addEventListener('click', function () { window.location.href = '/'; });

    var chip = document.getElementById('userChip');
    var u = NS.state.currentUser;
    if (chip && u) {
      var av = chip.querySelector('.avatar');
      var nm = chip.querySelector('.name');
      if (av) av.textContent = (u.hoTen || u.name || u.username || '?').charAt(0).toUpperCase();
      if (nm) nm.textContent = u.hoTen || u.name || u.username;
    }

    var permsEl = document.getElementById('phSettingsPerms');
    if (permsEl) {
      var parts = [];
      if (PERMS.canCreateMeeting()) parts.push('Tạo/sửa cuộc họp');
      if (PERMS.canDeleteMeeting && PERMS.canDeleteMeeting()) parts.push('Xóa cuộc họp');
      parts.push('Tham gia cuộc họp được mời');
      permsEl.textContent = parts.length ? parts.join(' · ') : 'Xem và tham gia cuộc họp được mời';
    }

    if (!PERMS.canCreateMeeting()) {
      ['btnCreateMeeting', 'btnCreateMeeting2'].forEach(function (id) {
        var b = document.getElementById(id);
        if (b) b.style.display = 'none';
      });
    }
  }

  async function bootstrap() {
    var joinCode = window.PhonghopJoin && window.PhonghopJoin.getCodeFromUrl();

    var authUser = await Auth.init();
    if (!authUser) {
      if (joinCode && window.PhonghopJoin) {
        window.PhonghopJoin.redirectToLoginWithReturn();
        return;
      }
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

    bindShell();
    bindUi();

    var floatReturn = document.getElementById('phMeetingFloatReturn');
    if (floatReturn) {
      floatReturn.addEventListener('click', function () {
        switchView('session');
      });
    }

    await refresh();

    if (typeof RrivAppBar !== 'undefined' && RrivAppBar.refresh) RrivAppBar.refresh();

    if (joinCode && window.PhonghopJoin) {
      try {
        await window.PhonghopJoin.enterByCode(joinCode, {
          onClose: function () {
            resetViewAfterRoom();
            refresh();
          },
          onError: function (e) {
            alert(e.message || 'Không vào được phòng họp');
          }
        });
      } catch (_) { /* onError */ }
      window.PhonghopJoin.cleanJoinQueryFromHistory();
    } else if (window.MeetingRoom && window.MeetingRoom.resumeStoredSession) {
      var resumed = await window.MeetingRoom.resumeStoredSession();
      if (resumed) {
        if (window.PhonghopShell && window.PhonghopShell.showSessionView) {
          window.PhonghopShell.showSessionView();
        }
      }
    }
  }

  window.addEventListener('pagehide', function () {
    if (window.MeetingForm && window.MeetingForm.destroy) window.MeetingForm.destroy();
    if (window.MeetingDetail && window.MeetingDetail.destroy) window.MeetingDetail.destroy();
    if (window.MeetingRoom && window.MeetingRoom.isActive && window.MeetingRoom.isActive()) {
      var mid = window.MeetingRoom.getMeetingId && window.MeetingRoom.getMeetingId();
      if (mid && window.PhonghopServices && window.PhonghopServices.leaveRoom) {
        window.PhonghopServices.leaveRoom(mid).catch(function () { /* ignore */ });
      }
    }
  });

  window.addEventListener('pageshow', function (e) {
    if (e.persisted) resumeFromCache();
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (window.MeetingRoom && window.MeetingRoom.isActive && window.MeetingRoom.isActive()) {
      if (window.MeetingRoom.restoreUi) window.MeetingRoom.restoreUi();
      updateMeetingFloatBar(!isSessionViewVisible());
      return;
    }
    if (NS.state.meetings.length) refresh();
  });

  if (typeof Auth !== 'undefined' && Auth.onAuthStateChange) {
    Auth.onAuthStateChange(function (user) {
      if (!user && window.MeetingRoom && window.MeetingRoom.isActive && window.MeetingRoom.isActive()) {
        window.MeetingRoom.destroy(true);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', bootstrap);
})();
