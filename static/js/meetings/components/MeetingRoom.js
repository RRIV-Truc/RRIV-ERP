/**
 * MeetingRoom.js — phiên họp trong shell e-Cabinet (không fullscreen)
 */
(function () {
  'use strict';

  var _host = null;
  var _chatHost = null;
  var _meetingId = null;
  var _pollTimer = null;
  var _joined = false;
  var _onClose = null;
  var _destroying = false;
  var _shellReady = false;
  var _lastRoom = null;
  var _agendaStep = 1;
  var SESSION_STORE_KEY = 'phonghop_active_meeting';
  var _docsLoading = false;
  var _sessionDocsCache = null;

  function saveSessionStore() {
    if (!_meetingId || !_joined) return;
    try {
      sessionStorage.setItem(SESSION_STORE_KEY, JSON.stringify({
        meetingId: _meetingId,
        agendaStep: _agendaStep,
        ts: Date.now()
      }));
    } catch (_) { /* ignore */ }
  }

  function clearSessionStore() {
    try { sessionStorage.removeItem(SESSION_STORE_KEY); } catch (_) { /* ignore */ }
  }

  function rebindDom() {
    _host = document.getElementById('meetingRoomHost');
    _chatHost = document.getElementById('phCtxChatHost');
    return !!_host;
  }

  function resetRoomDom() {
    document.body.classList.remove('ph-room-active');
    document.body.classList.remove('ph-host-control-mode');
    var hostEl = document.getElementById('meetingRoomHost');
    if (hostEl) {
      hostEl.innerHTML = '';
      hostEl.classList.remove('ph-room-open');
      delete hostEl.dataset.agendaBound;
      delete hostEl.dataset.agendaStep;
    }
    _shellReady = false;
    _host = null;
    _chatHost = null;
  }

  function resetRoomShell() {
    resetRoomDom();
    _lastRoom = null;
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function fmtTime(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    } catch (_) { return ''; }
  }

  function destroy(skipOnClose) {
    if (_destroying) return;
    _destroying = true;

    if (_pollTimer) {
      clearInterval(_pollTimer);
      _pollTimer = null;
    }

    if (window.MeetingPresenter) {
      window.MeetingPresenter.cleanup();
    }
    if (window.MeetingScreenShare) {
      window.MeetingScreenShare.cleanup();
    }
    if (window.MeetingChat) {
      window.MeetingChat.cleanup();
    }

    var leavingId = _meetingId;
    var hadJoined = _joined;
    _joined = false;
    _meetingId = null;
    clearSessionStore();
    _sessionDocsCache = null;
    _docsLoading = false;

    resetRoomDom();

    if (window.PhonghopShell && window.PhonghopShell.leaveSession) {
      window.PhonghopShell.leaveSession();
    }

    var chatEl = document.getElementById('phCtxChatHost');
    if (chatEl) {
      chatEl.innerHTML = '<p class="ph-detail-muted">Chat nhóm hiển thị khi bạn vào phiên họp.</p>';
    }

    if (hadJoined && leavingId && !skipOnClose) {
      window.PhonghopServices.leaveRoom(leavingId).catch(function () { /* ignore */ });
    }

    if (!skipOnClose && typeof _onClose === 'function') {
      try { _onClose(); } catch (_) { /* ignore */ }
    }
    _onClose = null;
    _destroying = false;
  }

  function canEndMeeting() {
    return !!(window.PhonghopPerms && window.PhonghopPerms.canCreateMeeting());
  }

  function bindEndMeetingButton() {
    if (!_host || !canEndMeeting()) return;
    var btn = _host.querySelector('#phRoomEnd');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', endMeetingSession);
  }

  async function endMeetingSession() {
    if (!_meetingId) return;
    if (!confirm(
      'Kết thúc cuộc họp?\n\n' +
      '• Mọi người không vào phòng được nữa\n' +
      '• Tài liệu hot trên Firebase sẽ bị xóa\n' +
      '• Cuộc họp chuyển sang «Hoàn thành»'
    )) return;
    var btn = _host && _host.querySelector('#phRoomEnd');
    if (btn) btn.disabled = true;
    try {
      if (window.MeetingPresenter && window.MeetingPresenter.stop) {
        try { await window.MeetingPresenter.stop(); } catch (_) { /* ignore */ }
      }
      await window.PhonghopServices.endMeeting(_meetingId);
      if (window.PhonghopServices.showDocToast) {
        window.PhonghopServices.showDocToast('Đã kết thúc cuộc họp', 6000);
      }
      var onClose = _onClose;
      destroy();
      if (typeof onClose === 'function') onClose();
    } catch (e) {
      if (btn) btn.disabled = false;
      alert(e.message || 'Không kết thúc được cuộc họp');
    }
  }

  function bindLeaveButtons() {
    if (!_host) return;
    var btn = _host.querySelector('#phRoomLeave');
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', destroy);
    }
  }

  function buildPresenceHtml(attendees, raisedHands) {
    var list = attendees || [];
    var handUsers = {};
    (raisedHands && raisedHands.hands || []).forEach(function (h) {
      var u = (h.username || '').trim().toLowerCase();
      if (u) handUsers[u] = true;
    });
    if (!list.length) {
      return '<li class="ph-room-empty-inline">Chưa có người được mời</li>';
    }
    return list.map(function (p) {
      var online = !!p.online;
      var dotClass = online ? 'ph-presence-dot is-online' : 'ph-presence-dot is-offline';
      var statusText = online ? 'Online' : 'Offline';
      var u = (p.username || '').trim().toLowerCase();
      var handIcon = handUsers[u] ? ' <span class="ph-presence-hand" title="Đang giơ tay">✋</span>' : '';
      var roleTag = p.role_label && p.participant_role !== 'participant'
        ? ' <span class="ph-presence-role">' + esc(p.role_label) + '</span>'
        : '';
      return '<li class="ph-presence-row' + (online ? ' is-online' : ' is-offline') + '">' +
        '<span class="' + dotClass + '" title="' + esc(statusText) + '"></span>' +
        '<span class="ph-presence-name">' + esc(p.displayName || p.username) + roleTag + handIcon + '</span>' +
        '<span class="ph-presence-status">' + esc(statusText) + '</span></li>';
    }).join('');
  }

  function buildRaisedHandsHtml(room) {
    var rh = room.raised_hands || {};
    var hands = rh.hands || [];
    var canMod = !!(room.can_moderate);
    var mine = rh.mine;
    var btnLabel = mine ? '✋ Hạ tay' : '✋ Giơ tay xin phát biểu';
    var btnClass = mine ? 'ph-btn ph-btn-ghost ph-hand-btn is-raised' : 'ph-btn ph-btn-primary ph-hand-btn';

    var listHtml = '';
    if (canMod && hands.length) {
      listHtml = '<ul class="ph-raised-hands-list">' + hands.map(function (h) {
        return '<li class="ph-raised-hand-row">' +
          '<span class="ph-raised-hand-name">✋ ' + esc(h.display_name || h.username) + '</span>' +
          '<button type="button" class="ph-btn ph-btn-ghost ph-hand-lower-one" data-username="' +
            esc(h.username || '') + '">Hạ tay</button>' +
        '</li>';
      }).join('') + '</ul>' +
        '<button type="button" class="ph-btn ph-btn-ghost ph-hand-clear-all">Hạ tất cả (' + hands.length + ')</button>';
    } else if (hands.length) {
      listHtml = '<p class="ph-detail-muted ph-raised-hands-wait">' + hands.length +
        ' người đang giơ tay — chờ Chủ trì/Thư ký gọi phát biểu.</p>';
    } else {
      listHtml = '<p class="ph-detail-muted ph-raised-hands-wait">Chưa ai giơ tay.</p>';
    }

    return (
      '<div class="ph-raised-hands-block">' +
        '<button type="button" class="' + btnClass + '" id="phRaiseHandToggle">' + btnLabel + '</button>' +
        listHtml +
      '</div>'
    );
  }

  function bindRaisedHandDelegation() {
    if (!_host || _host.dataset.handBound) return;
    _host.dataset.handBound = '1';
    _host.addEventListener('click', function (e) {
      if (!_meetingId) return;
      var toggle = e.target.closest('#phRaiseHandToggle');
      if (toggle) {
        var rh = (_lastRoom && _lastRoom.raised_hands) || {};
        var p = rh.mine
          ? window.PhonghopServices.lowerHand(_meetingId)
          : window.PhonghopServices.raiseHand(_meetingId);
        p.then(function () { return refresh(); }).catch(function (err) { alert(err.message); });
        return;
      }
      var lowerBtn = e.target.closest('.ph-hand-lower-one');
      if (lowerBtn) {
        var target = lowerBtn.getAttribute('data-username');
        window.PhonghopServices.lowerHand(_meetingId, target)
          .then(function () { return refresh(); })
          .catch(function (err) { alert(err.message); });
        return;
      }
      var clearBtn = e.target.closest('.ph-hand-clear-all');
      if (clearBtn) {
        if (!confirm('Hạ tay tất cả đại biểu?')) return;
        window.PhonghopServices.clearRaisedHands(_meetingId)
          .then(function () { return refresh(); })
          .catch(function (err) { alert(err.message); });
      }
    });
  }

  function getAttendeesFromRoom(room) {
    if (room && room.attendees && room.attendees.length) return room.attendees;
    return (room && room.presence) ? room.presence.map(function (p) {
      return Object.assign({}, p, { online: true, role_label: '', participant_role: 'guest' });
    }) : [];
  }

  function agendaProgressPct(stepIndex, total) {
    return Math.round(((stepIndex + 0.5) / total) * 100);
  }

  function buildContentPhaseHtml(room) {
    return (
      '<div class="ph-content-phase">' +
        '<h3>Nội dung</h3>' +
        '<p class="ph-detail-muted">Chia sẻ màn hình (cửa sổ, tab trình duyệt, Word, Excel, PowerPoint, PDF…) — mọi người xem đồng bộ trong phiên họp.</p>' +
        '<div id="phScreenShareHost" class="ph-screen-share-host ph-screen-share-host-prominent">' +
          '<div class="ph-screen-share-bar ph-screen-share-bar-loading">' +
            '<p class="ph-detail-muted">Đang tải điều khiển chia sẻ màn hình…</p>' +
          '</div>' +
        '</div>' +
        '<div class="ph-session-doc-list" id="phSessionDocList"><p class="ph-detail-muted">Đang tải tài liệu…</p></div>' +
      '</div>'
    );
  }

  function ensureScreenShareUi(room) {
    if (!_meetingId || !_host || !window.MeetingScreenShare) return;
    var step = parseInt(_host.dataset.agendaStep, 10);
    if (step !== 1) return;
    if (!_host.querySelector('#phScreenShareHost')) return;
    if (window.MeetingScreenShare.hasToolbar && window.MeetingScreenShare.hasToolbar()) {
      return;
    }
    var r = room || _lastRoom || {};
    window.MeetingScreenShare.mountToolbar(_meetingId, {
      isHost: r.is_host,
      isSecretary: r.is_secretary,
      canModerate: r.can_moderate,
      canApproveShare: r.can_approve_share,
      requests: r.screen_share_requests
    });
  }

  function sessionDocsRenderKey(docs) {
    return (docs || []).map(function (d) {
      return String(d.id || '') + ':' + String(d.warm_status || '');
    }).join('|');
  }

  function loadSessionDocs(meetingId, retryCount) {
    if (!meetingId || !_host) return;
    if (_docsLoading) return;
    retryCount = retryCount || 0;

    var listEl = _host.querySelector('#phSessionDocList');
    if (!listEl) {
      if (retryCount < 2) {
        setTimeout(function () { loadSessionDocs(meetingId, retryCount + 1); }, 400);
      }
      return;
    }

    if (_sessionDocsCache && _sessionDocsCache.meetingId === meetingId && retryCount === 0) {
      renderSessionDocList(meetingId, _sessionDocsCache.docs, listEl);
      return;
    }

    _docsLoading = true;
    var uname = window.PhonghopServices.username && window.PhonghopServices.username();
    var url = '/api/meetings/' + encodeURIComponent(meetingId) +
      '/documents?flat=1&shared_only=1&skip_urls=1&username=' + encodeURIComponent(uname);

    fetch(url, { headers: { 'X-RRIV-Username': uname || '' } })
      .then(function (r) {
        return r.text().then(function (text) {
          var data = null;
          try { data = text ? JSON.parse(text) : null; } catch (_) {
            throw new Error('Phản hồi không hợp lệ (HTTP ' + r.status + ')');
          }
          if (!r.ok || !data || !data.success) {
            throw new Error((data && data.message) || ('HTTP ' + r.status));
          }
          return data;
        });
      })
      .then(function (data) {
        _docsLoading = false;
        if (!_host || !_host.querySelector('#phSessionDocList')) return;
        listEl = _host.querySelector('#phSessionDocList');
        var docs = (data.documents || []).filter(function (d) { return d.kind === 'file'; });
        if (!docs.length && _sessionDocsCache && _sessionDocsCache.meetingId === meetingId &&
            _sessionDocsCache.docs && _sessionDocsCache.docs.length) {
          renderSessionDocList(meetingId, _sessionDocsCache.docs, listEl);
          return;
        }
        _sessionDocsCache = { meetingId: meetingId, docs: docs };
        renderSessionDocList(meetingId, docs, listEl);
      })
      .catch(function (e) {
        _docsLoading = false;
        if (!_host) return;
        listEl = _host.querySelector('#phSessionDocList');
        if (!listEl) return;
        if (retryCount < 2) {
          listEl.innerHTML = '<p class="ph-detail-muted">Đang thử tải lại tài liệu…</p>';
          setTimeout(function () { loadSessionDocs(meetingId, retryCount + 1); }, 800 + retryCount * 700);
          return;
        }
        listEl.innerHTML = '<p class="ph-detail-muted ph-session-doc-err">Không tải được danh sách tài liệu.' +
          (e.message ? ' (' + esc(String(e.message).slice(0, 120)) + ')' : '') +
          ' <button type="button" class="ph-btn ph-btn-sm" id="phSessionDocRetry">Thử lại</button></p>';
        var retryBtn = listEl.querySelector('#phSessionDocRetry');
        if (retryBtn) {
          retryBtn.addEventListener('click', function () {
            _sessionDocsCache = null;
            listEl.innerHTML = '<p class="ph-detail-muted">Đang tải tài liệu…</p>';
            loadSessionDocs(meetingId, 0);
          });
        }
      });
  }

  function renderSessionDocList(meetingId, docs, listEl) {
    if (!listEl) return;
    var renderKey = sessionDocsRenderKey(docs);
    if (listEl.dataset.docsKey === renderKey && listEl.querySelector('.ph-session-files, .ph-session-doc-empty')) {
      return;
    }
    listEl.dataset.docsKey = renderKey;

    if (!docs.length) {
      listEl.innerHTML = '<p class="ph-detail-muted ph-session-doc-empty">Chưa có tài liệu được chia sẻ — Thư ký chọn ở <strong>Sửa cuộc họp → Tài liệu họp</strong> hoặc upload ở <strong>Kho tài liệu</strong>.</p>';
      return;
    }
    listEl.innerHTML = '<h4 class="ph-session-doc-heading">Tài liệu phiên họp</h4><ul class="ph-session-files">' + docs.map(function (d) {
          var label = (window.PhonghopServices && window.PhonghopServices.docOpenLabel)
            ? window.PhonghopServices.docOpenLabel(d.name, d.mime_type)
            : 'Mở';
          var hotBadge = d.warm_status === 'ready'
            ? ' <span class="ph-present-badge" title="Đã sync Firebase hot">⚡ Hot</span>'
            : (d.warm_status === 'warming'
              ? ' <span class="ph-present-badge ph-present-badge-alt">Đang sync…</span>'
              : '');
          return '<li class="ph-session-file-row">' +
            '<span>📄 ' + esc(d.name) + hotBadge + '</span> ' +
            '<button type="button" class="ph-btn ph-btn-sm ph-session-doc-open" data-id="' + esc(d.id) + '">' +
            esc(label) + '</button>' +
            '</li>';
        }).join('') + '</ul>';
        listEl.querySelectorAll('.ph-session-doc-open').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var id = btn.getAttribute('data-id');
            var doc = docs.find(function (d) { return d.id === id; });
            if (!doc || !window.PhonghopServices.openMeetingDocument) return;
            window.PhonghopServices.openMeetingDocument(meetingId, doc.id, {
              name: doc.name,
              mime: doc.mime_type
            }).catch(function (e) { alert(e.message || 'Không mở được tài liệu'); });
          });
        });
        if (window.PhonghopDocCache) {
          window.PhonghopDocCache.prefetchMeetingDocs(meetingId, docs).then(function (r) {
            if (r && r.ok > 0 && window.PhonghopServices && window.PhonghopServices.showDocToast) {
              window.PhonghopServices.showDocToast(
                'Đã cache ' + r.ok + ' tài liệu (IndexedDB) — mở lại tức thì, offline ngắn', 5000
              );
            }
          });
        }
        var needWarm = docs.some(function (d) {
          return d.warm_status === 'pending' || d.warm_status === 'failed';
        });
        if (needWarm && window.PhonghopServices && window.PhonghopServices.warmMeetingDocuments &&
            !listEl.dataset.warmRequested) {
          listEl.dataset.warmRequested = '1';
          window.PhonghopServices.warmMeetingDocuments(meetingId)
            .then(function () {
              _sessionDocsCache = null;
              listEl.dataset.docsKey = '';
              loadSessionDocs(meetingId, 0);
            })
            .catch(function () { listEl.dataset.warmRequested = ''; });
        }
  }

  function buildPhasePaneHtml(stepIndex, room) {
    if (stepIndex === 0) {
      return (
        '<div class="ph-content-phase">' +
          '<h3>Khai mạc</h3>' +
          '<p class="ph-detail-muted">Giới thiệu chương trình, điểm danh và phát biểu mở đầu.</p>' +
        '</div>'
      );
    }
    if (stepIndex === 1) return buildContentPhaseHtml(room);
    if (stepIndex === 2) {
      return (
        '<div class="ph-content-phase">' +
          '<h3>Thảo luận</h3>' +
          '<p class="ph-detail-muted">Trao đổi ý kiến về nội dung đã trình bày. Dùng <strong>Chat</strong> bên phải hoặc phát biểu trực tiếp.</p>' +
          '<div class="ph-doc-viewer ph-doc-viewer-session">' +
            '<div class="ph-doc-page ph-doc-page-compact">' +
              '<p>Ghi chú thảo luận, highlight tài liệu — tích hợp viewer đầy đủ ở bước <strong>Mở tài liệu</strong>.</p>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }
    if (stepIndex === 3) {
      return (
        '<div class="ph-content-phase">' +
          '<h3>Biểu quyết</h3>' +
          '<p class="ph-detail-muted">Bỏ phiếu điện tử theo từng nghị quyết (tính năng đang triển khai).</p>' +
        '</div>'
      );
    }
    return (
      '<div class="ph-content-phase">' +
        '<h3>Kết luận</h3>' +
        '<p class="ph-detail-muted">Tổng kết, giao nhiệm vụ và kết thúc phiên họp.</p>' +
        (canEndMeeting()
          ? '<div class="ph-content-actions">' +
              '<article class="ph-content-card">' +
                '<span class="ph-content-badge ph-content-badge-host">Chủ trì</span>' +
                '<h4>Kết thúc cuộc họp</h4>' +
                '<p>Sau khi tổng kết xong, bấm nút bên dưới để đóng phòng, xóa tài liệu hot Firebase và chuyển cuộc họp sang «Hoàn thành».</p>' +
                '<button type="button" class="ph-btn ph-btn-danger" id="phRoomEndConclude">Kết thúc cuộc họp</button>' +
              '</article>' +
            '</div>'
          : '<p class="ph-detail-muted">Chờ Chủ trì / Thư ký kết thúc cuộc họp.</p>') +
      '</div>'
    );
  }

  function setAgendaStep(stepIndex, room) {
    if (!_host) return;
    var steps = _host.querySelectorAll('.ph-agenda-step');
    var total = steps.length || 5;
    var idx = Math.max(0, Math.min(stepIndex, total - 1));
    _agendaStep = idx;
    saveSessionStore();
    steps.forEach(function (el, i) {
      el.classList.remove('is-done', 'is-active');
      if (i < idx) el.classList.add('is-done');
      else if (i === idx) el.classList.add('is-active');
    });
    var fill = _host.querySelector('.ph-agenda-progress-fill');
    if (fill) fill.style.width = agendaProgressPct(idx, total) + '%';
    var pane = _host.querySelector('#phSessionMainPane');
    if (pane) pane.innerHTML = buildPhasePaneHtml(idx, room || _lastRoom || {});
    if (idx === 1 && _meetingId) {
      ensureScreenShareUi(room || _lastRoom || {});
      loadSessionDocs(_meetingId);
    }
    if (idx === 4) {
      var endBtn = _host.querySelector('#phRoomEndConclude');
      if (endBtn && !endBtn.dataset.bound) {
        endBtn.dataset.bound = '1';
        endBtn.addEventListener('click', endMeetingSession);
      }
    }
    _host.dataset.agendaStep = String(idx);
  }

  function bindAgendaSteps(room) {
    if (!_host) return;
    if (!_host.dataset.agendaBound) {
      _host.dataset.agendaBound = '1';
      _host.querySelectorAll('.ph-agenda-step').forEach(function (step) {
        step.addEventListener('click', function () {
          var n = parseInt(step.getAttribute('data-step'), 10);
          if (!isNaN(n)) setAgendaStep(n, _lastRoom || room);
        });
      });
    }
    setAgendaStep(typeof _agendaStep === 'number' ? _agendaStep : 1, room);
  }

  function ensureShell(room) {
    if (_shellReady && _host) {
      var pane = _host.querySelector('#phSessionMainPane');
      if (pane && !pane.innerHTML.trim()) {
        setAgendaStep(typeof _agendaStep === 'number' ? _agendaStep : 1, room);
      }
      return;
    }

    _host.innerHTML =
      '<div class="ph-session-view">' +
        '<div class="ph-session-head">' +
          '<button type="button" class="ph-btn ph-btn-leave" id="phRoomLeave">← Rời phòng</button>' +
          (canEndMeeting()
            ? '<button type="button" class="ph-btn ph-btn-danger ph-btn-end-meeting" id="phRoomEnd">Kết thúc họp</button>'
            : '') +
          '<div class="ph-session-head-info">' +
            '<span class="ph-live-pill"><span class="ph-live-dot"></span> ĐANG HỌP</span>' +
            '<h1 id="phSessionTitle">' + esc(room.title || 'Cuộc họp') + '</h1>' +
            '<p id="phSessionMeta">' + esc(room.meeting_code || '') + '</p>' +
          '</div>' +
        '</div>' +
        '<div class="ph-agenda-bar">' +
          '<p class="ph-agenda-label">Chương trình họp</p>' +
          '<div class="ph-agenda-steps" id="phAgendaSteps">' +
            '<button type="button" class="ph-agenda-step is-done" data-step="0"><span>1</span>Khai mạc</button>' +
            '<button type="button" class="ph-agenda-step is-active" data-step="1"><span>2</span>Nội dung</button>' +
            '<button type="button" class="ph-agenda-step" data-step="2"><span>3</span>Thảo luận</button>' +
            '<button type="button" class="ph-agenda-step" data-step="3"><span>4</span>Biểu quyết</button>' +
            '<button type="button" class="ph-agenda-step" data-step="4"><span>5</span>Kết luận</button>' +
          '</div>' +
          '<div class="ph-agenda-progress"><div class="ph-agenda-progress-fill" style="width:30%"></div></div>' +
        '</div>' +
        '<div class="ph-session-grid">' +
          '<div class="ph-session-doc">' +
            '<div class="ph-doc-toolbar ph-doc-toolbar-compact">' +
              '<div class="ph-doc-tools">' +
                '<button type="button" class="ph-tool is-active" title="Chọn">↖</button>' +
                '<button type="button" class="ph-tool" title="Highlight">🖍</button>' +
                '<button type="button" class="ph-tool" title="Ghi chú">💬</button>' +
              '</div>' +
              '<span id="phSessionPaneLabel">Nội dung phiên họp</span>' +
            '</div>' +
            '<div class="ph-session-main-pane" id="phSessionMainPane"></div>' +
          '</div>' +
          '<aside class="ph-session-aside">' +
            '<div class="ph-session-aside-block">' +
              '<h3>Tham dự phiên (<span id="phRoomPresenceCount">' + (room.presence_count || 0) + '</span> online)</h3>' +
              '<ul class="ph-room-presence" id="phRoomPresence">' +
                buildPresenceHtml(room.attendees || room.presence || [], room.raised_hands) +
              '</ul>' +
            '</div>' +
            '<div class="ph-session-aside-block">' +
              '<h3>Giơ tay xin phát biểu</h3>' +
              '<div id="phRaisedHandsHost">' + buildRaisedHandsHtml(room) + '</div>' +
            '</div>' +
            '<div class="ph-session-aside-block ph-session-aside-hint">' +
              '<p class="ph-detail-muted">Chủ trì hoặc đại biểu (khi được duyệt) chia sẻ màn hình — mọi người xem đồng bộ trong phiên.</p>' +
            '</div>' +
          '</aside>' +
        '</div>' +
      '</div>';

    _shellReady = true;
    bindLeaveButtons();
    bindEndMeetingButton();
    bindAgendaSteps(room);
    bindRaisedHandDelegation();
  }

  function updateRoomParts(room) {
    _lastRoom = room;
    if (!_host) return;

    document.body.classList.toggle('ph-host-control-mode', !!(room.is_host || room.is_secretary) && _joined);

    ensureShell(room);

    var title = _host.querySelector('#phSessionTitle');
    var meta = _host.querySelector('#phSessionMeta');
    var attendees = getAttendeesFromRoom(room);
    var onlineCount = attendees.filter(function (a) { return a.online; }).length;
    if (title) title.textContent = room.title || 'Cuộc họp';
    if (meta) {
      meta.textContent = (room.meeting_code || '') + ' · ' + onlineCount + ' đang online';
    }

    var presCount = _host.querySelector('#phRoomPresenceCount');
    var presList = _host.querySelector('#phRoomPresence');
    if (presCount) presCount.textContent = String(onlineCount);
    if (presList) presList.innerHTML = buildPresenceHtml(attendees, room.raised_hands);

    var handsHost = _host.querySelector('#phRaisedHandsHost');
    if (handsHost) {
      handsHost.innerHTML = buildRaisedHandsHtml(room);
    }

    if (window.MeetingChat && _chatHost && _meetingId) {
      if (!_chatHost.querySelector('#phRoomChatList')) {
        window.MeetingChat.mount(_chatHost, _meetingId);
      }
      window.MeetingChat.syncFromRoom(room);
    }

    if (window.MeetingScreenShare && _meetingId) {
      ensureScreenShareUi(room);
      window.MeetingScreenShare.syncFromRoom(
        _meetingId,
        room.screen_share,
        room.screen_share_requests,
        room.is_host,
        {
          isHost: room.is_host,
          isSecretary: room.is_secretary,
          canModerate: room.can_moderate,
          canApproveShare: room.can_approve_share,
          presence: room.presence,
          attendees: room.attendees
        }
      );
    }

    var step = parseInt(_host.dataset.agendaStep, 10);
    if (step === 1 && _meetingId) {
      var docList = _host.querySelector('#phSessionDocList');
      if (docList && !_sessionDocsCache && !_docsLoading) {
        loadSessionDocs(_meetingId);
      }
    }
  }

  function restoreUi() {
    if (!_meetingId || !_joined) return Promise.resolve(false);
    if (!rebindDom()) return Promise.resolve(false);

    _host.classList.add('ph-room-open');
    document.body.classList.add('ph-in-session');
    document.body.classList.add('ph-room-active');

    if (window.PhonghopShell && window.PhonghopShell.showSessionView) {
      window.PhonghopShell.showSessionView();
    }

    if (_lastRoom) {
      _shellReady = false;
      renderRoom(_lastRoom);
      setAgendaStep(_agendaStep, _lastRoom);
    }

    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = setInterval(refresh, 2500);

    saveSessionStore();
    if (window.PhonghopShell && window.PhonghopShell.updateMeetingFloatBar) {
      window.PhonghopShell.updateMeetingFloatBar(false);
    }
    return refresh().then(function () { return true; });
  }

  function renderRoom(room) {
    updateRoomParts(room);
  }

  function refresh() {
    if (!_meetingId) return Promise.resolve();
    return window.PhonghopServices.getRoomState(_meetingId).then(function (room) {
      renderRoom(room);
    }).catch(function (e) {
      console.warn('[MeetingRoom] refresh', e.message);
    });
  }

  window.MeetingRoom = {
    open: async function (opts) {
      opts = opts || {};
      if (!opts.meetingId) return;

      if (_meetingId === opts.meetingId && _joined) {
        _onClose = opts.onClose || _onClose;
        return restoreUi();
      }

      _host = document.getElementById('meetingRoomHost');
      _chatHost = document.getElementById('phCtxChatHost');
      if (!_host) return;

      _onClose = opts.onClose || null;
      _meetingId = opts.meetingId;
      _joined = false;
      _shellReady = false;

      _host.classList.add('ph-room-open');
      _host.innerHTML = '<div class="ph-room-loading">Đang vào phòng…</div>';

      if (window.PhonghopShell && window.PhonghopShell.enterSession) {
        window.PhonghopShell.enterSession();
      }

      try {
        var room = await window.PhonghopServices.joinRoom(_meetingId);
        _joined = true;
        saveSessionStore();
        renderRoom(room);
        if (_pollTimer) clearInterval(_pollTimer);
        _pollTimer = setInterval(refresh, 2500);
      } catch (e) {
        _host.innerHTML =
          '<div class="ph-room-loading">' + esc(e.message || 'Không vào được phòng') +
          '<br><button type="button" class="ph-btn ph-btn-leave" id="phRoomErrClose">← Quay lại</button></div>';
        var btn = _host.querySelector('#phRoomErrClose');
        if (btn) btn.addEventListener('click', destroy);
      }
    },

    openByCode: async function (code, opts) {
      opts = opts || {};
      var meeting = await window.PhonghopServices.lookupMeetingByCode(code);
      if (!meeting || !meeting.id) throw new Error('Không tìm thấy cuộc họp');
      await window.MeetingRoom.open({ meetingId: meeting.id, onClose: opts.onClose });
    },

    destroy: destroy,
    resetShell: resetRoomShell,
    restoreUi: restoreUi,
    refresh: refresh,
    reloadSessionDocs: function () {
      if (!_meetingId) return;
      var listEl = _host && _host.querySelector('#phSessionDocList');
      if (!listEl) return;
      _sessionDocsCache = null;
      loadSessionDocs(_meetingId, 0);
    },
    isActive: function () { return !!_meetingId && _joined; },
    getMeetingId: function () { return _meetingId; },
    resumeStoredSession: function () {
      try {
        var raw = sessionStorage.getItem(SESSION_STORE_KEY);
        if (!raw) return Promise.resolve(false);
        var data = JSON.parse(raw);
        if (!data || !data.meetingId) return Promise.resolve(false);
        if (Date.now() - (data.ts || 0) > 86400000) {
          clearSessionStore();
          return Promise.resolve(false);
        }
        if (_meetingId === data.meetingId && _joined) {
          return restoreUi().then(function () { return true; });
        }
        _agendaStep = typeof data.agendaStep === 'number' ? data.agendaStep : 1;
        return window.MeetingRoom.open({
          meetingId: data.meetingId,
          onClose: function () {
            if (window.PhonghopShell && window.PhonghopShell.updateMeetingFloatBar) {
              window.PhonghopShell.updateMeetingFloatBar(false);
            }
          }
        }).then(function () { return true; });
      } catch (_) {
        return Promise.resolve(false);
      }
    }
  };

  /* Không destroy phiên khi chuyển tab — chỉ heartbeat khi tab ẩn */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') return;
    if (_meetingId && _joined && (!_host || !_host.querySelector('.ph-session-view'))) {
      restoreUi();
    }
  });
})();
