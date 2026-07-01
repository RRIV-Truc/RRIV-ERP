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

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function fmtTime(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    } catch (_) { return ''; }
  }

  function resetRoomShell() {
    document.body.classList.remove('ph-room-active');
    _shellReady = false;
    _lastRoom = null;
    if (_host) {
      _host.innerHTML = '';
      _host.classList.remove('ph-room-open');
    }
    if (_chatHost) {
      _chatHost.innerHTML = '<p class="ph-detail-muted">Chat nhóm hiển thị khi bạn vào phiên họp.</p>';
    }
    if (window.PhonghopShell && window.PhonghopShell.leaveSession) {
      window.PhonghopShell.leaveSession();
    }
    _host = null;
    _chatHost = null;
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

    var leavingId = _meetingId;
    var hadJoined = _joined;
    _joined = false;
    _meetingId = null;

    resetRoomShell();

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

  function buildChatHtml(chat) {
    if (!chat.length) {
      return '<div class="ph-room-empty">Chưa có tin nhắn. Chào mọi người!</div>';
    }
    var uname = window.PhonghopServices.username && window.PhonghopServices.username();
    return chat.map(function (m) {
      var mine = m.username === uname;
      return '<div class="ph-room-msg' + (mine ? ' mine' : '') + '">' +
        '<div class="ph-room-msg-head"><strong>' + esc(m.displayName || m.username) + '</strong>' +
        '<span>' + esc(fmtTime(m.at)) + '</span></div>' +
        '<div class="ph-room-msg-text">' + esc(m.text) + '</div></div>';
    }).join('');
  }

  function buildPresenceHtml(presence) {
    if (!presence.length) {
      return '<li class="ph-room-empty-inline">Chưa có ai online</li>';
    }
    return presence.map(function (p) {
      return '<li>' + esc(p.displayName || p.username) + '</li>';
    }).join('');
  }

  function agendaProgressPct(stepIndex, total) {
    return Math.round(((stepIndex + 0.5) / total) * 100);
  }

  function buildContentPhaseHtml(room) {
    return (
      '<div class="ph-content-phase">' +
        '<h3>Nội dung</h3>' +
        '<p class="ph-detail-muted">Tài liệu đã sync hot — mở file bên dưới hoặc trình chiếu slide lên màn hình lớn.</p>' +
        '<div id="phPresenterHost"></div>' +
        '<div id="phPresentFollow" hidden></div>' +
        '<div class="ph-session-doc-list" id="phSessionDocList"><p class="ph-detail-muted">Đang tải tài liệu…</p></div>' +
      '</div>'
    );
  }

  function loadSessionDocs(meetingId) {
    if (!meetingId || !_host) return;
    var listEl = _host.querySelector('#phSessionDocList');
    if (!listEl) return;
    var uname = window.PhonghopServices.username && window.PhonghopServices.username();
    var url = '/api/meetings/' + encodeURIComponent(meetingId) +
      '/documents?flat=1&shared_only=1&username=' + encodeURIComponent(uname);
    fetch(url, { headers: { 'X-RRIV-Username': uname || '' } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.success) throw new Error(data.message || 'Lỗi');
        var docs = (data.documents || []).filter(function (d) { return d.kind === 'file'; });
        if (!docs.length) {
          listEl.innerHTML = '<p class="ph-detail-muted">Chưa có tài liệu được chia sẻ — Thư ký chọn ở <strong>Sửa cuộc họp → Tài liệu họp</strong> hoặc upload ở <strong>Kho tài liệu</strong>.</p>';
          return;
        }
        listEl.innerHTML = '<ul class="ph-session-files">' + docs.map(function (d) {
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
        if (window.MeetingPresenter) {
          window.MeetingPresenter.setMeetingId(meetingId);
          window.MeetingPresenter.mountIdle(docs);
        }
        if (window.PhonghopDocCache) {
          window.PhonghopDocCache.prefetchMeetingDocs(meetingId, docs).then(function (r) {
            if (r && r.ok > 0 && window.PhonghopServices && window.PhonghopServices.showDocToast) {
              window.PhonghopServices.showDocToast(
                'Đã cache ' + r.ok + ' tài liệu trên máy này — mở lại sẽ nhanh hơn', 5000
              );
            }
          });
        }
        var needWarm = docs.some(function (d) {
          return d.warm_status === 'pending' || d.warm_status === 'failed';
        });
        if (needWarm && window.PhonghopServices && window.PhonghopServices.warmMeetingDocuments &&
            window.PhonghopPerms && window.PhonghopPerms.canCreateMeeting()) {
          window.PhonghopServices.warmMeetingDocuments(meetingId)
            .then(function () { loadSessionDocs(meetingId); })
            .catch(function () { /* ignore */ });
        }
      })
      .catch(function () {
        listEl.innerHTML = '<p class="ph-detail-muted">Không tải được danh sách tài liệu.</p>';
      });
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
    steps.forEach(function (el, i) {
      el.classList.remove('is-done', 'is-active');
      if (i < idx) el.classList.add('is-done');
      else if (i === idx) el.classList.add('is-active');
    });
    var fill = _host.querySelector('.ph-agenda-progress-fill');
    if (fill) fill.style.width = agendaProgressPct(idx, total) + '%';
    var pane = _host.querySelector('#phSessionMainPane');
    if (pane) pane.innerHTML = buildPhasePaneHtml(idx, room || _lastRoom || {});
    if (idx === 1 && _meetingId) loadSessionDocs(_meetingId);
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
    if (!_host || _host.dataset.agendaBound) return;
    _host.dataset.agendaBound = '1';
    _host.querySelectorAll('.ph-agenda-step').forEach(function (step) {
      step.addEventListener('click', function () {
        var n = parseInt(step.getAttribute('data-step'), 10);
        if (!isNaN(n)) setAgendaStep(n, _lastRoom || room);
      });
    });
    setAgendaStep(1, room);
  }

  function ensureShell(room) {
    if (_shellReady && _host) return;

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
              '<h3>Đang online (<span id="phRoomPresenceCount">' + (room.presence_count || 0) + '</span>)</h3>' +
              '<ul class="ph-room-presence" id="phRoomPresence">' + buildPresenceHtml(room.presence || []) + '</ul>' +
            '</div>' +
            '<div class="ph-session-aside-block ph-session-aside-hint">' +
              '<p class="ph-detail-muted">Chủ trì: trình chiếu slide · Đại biểu: theo dõi slide hoặc mở tài liệu riêng.</p>' +
            '</div>' +
          '</aside>' +
        '</div>' +
      '</div>';

    _shellReady = true;
    bindLeaveButtons();
    bindEndMeetingButton();
    bindAgendaSteps(room);
  }

  function ensureChatShell() {
    if (!_chatHost) return;
    if (_chatHost.querySelector('#phRoomChatList')) return;

    _chatHost.innerHTML =
      '<div class="ph-ctx-chat-inner">' +
        '<div class="ph-room-chat ph-ctx-chat-list" id="phRoomChatList"></div>' +
        '<footer class="ph-room-footer ph-ctx-chat-footer">' +
          '<input type="text" id="phRoomChatInput" placeholder="Nhập tin nhắn…" maxlength="4000" autocomplete="off">' +
          '<button type="button" class="ph-btn ph-btn-primary" id="phRoomSend">Gửi</button>' +
        '</footer>' +
      '</div>';

    var sendBtn = _chatHost.querySelector('#phRoomSend');
    var input = _chatHost.querySelector('#phRoomChatInput');
    function sendChat() {
      if (!input || !_meetingId) return;
      var text = input.value.trim();
      if (!text) return;
      input.value = '';
      window.PhonghopServices.sendRoomChat(_meetingId, text).then(function () {
        return refresh();
      }).catch(function (e) {
        alert(e.message || 'Không gửi được tin nhắn');
      });
    }
    if (sendBtn) sendBtn.addEventListener('click', sendChat);
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); sendChat(); }
      });
    }
  }

  function updateRoomParts(room) {
    _lastRoom = room;
    if (!_host) return;

    ensureShell(room);

    var title = _host.querySelector('#phSessionTitle');
    var meta = _host.querySelector('#phSessionMeta');
    if (title) title.textContent = room.title || 'Cuộc họp';
    if (meta) {
      meta.textContent = (room.meeting_code || '') + ' · ' + (room.presence_count || 0) + ' đang online';
    }

    var presCount = _host.querySelector('#phRoomPresenceCount');
    var presList = _host.querySelector('#phRoomPresence');
    if (presCount) presCount.textContent = String(room.presence_count || 0);
    if (presList) presList.innerHTML = buildPresenceHtml(room.presence || []);

    ensureChatShell();
    var chatList = _chatHost && _chatHost.querySelector('#phRoomChatList');
    if (chatList) {
      var atBottom = chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight < 48;
      chatList.innerHTML = buildChatHtml(room.chat || []);
      if (atBottom) chatList.scrollTop = chatList.scrollHeight;
    }

    if (window.MeetingPresenter && _meetingId) {
      window.MeetingPresenter.setMeetingId(_meetingId);
      window.MeetingPresenter.syncFromRoom(_meetingId, room.presentation);
    }
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
    isActive: function () { return !!_meetingId && _joined; }
  };

  window.addEventListener('pagehide', function () {
    destroy(true);
  });
})();
