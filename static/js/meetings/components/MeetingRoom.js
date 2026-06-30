/**
 * MeetingRoom.js — vào phòng họp online (chat + danh sách online)
 */
(function () {
  'use strict';

  var _host = null;
  var _meetingId = null;
  var _pollTimer = null;
  var _joined = false;
  var _onClose = null;
  var _destroying = false;

  function resetRoomShell() {
    document.body.classList.remove('ph-room-active');
    var host = document.getElementById('meetingRoomHost');
    if (host) {
      host.innerHTML = '';
      host.classList.remove('ph-room-open');
    }
    _host = host || null;
  }

  function destroy(skipOnClose) {
    if (_destroying) return;
    _destroying = true;

    if (_pollTimer) {
      clearInterval(_pollTimer);
      _pollTimer = null;
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

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function fmtTime(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    } catch (_) { return ''; }
  }

  function renderRoom(room) {
    if (!_host) return;
    var chat = room.chat || [];
    var presence = room.presence || [];

    var chatHtml = chat.length
      ? chat.map(function (m) {
        var mine = m.username === (window.PhonghopServices.username && window.PhonghopServices.username());
        return '<div class="ph-room-msg' + (mine ? ' mine' : '') + '">' +
          '<div class="ph-room-msg-head"><strong>' + esc(m.displayName || m.username) + '</strong>' +
          '<span>' + esc(fmtTime(m.at)) + '</span></div>' +
          '<div class="ph-room-msg-text">' + esc(m.text) + '</div></div>';
      }).join('')
      : '<div class="ph-room-empty">Chưa có tin nhắn. Chào mọi người!</div>';

    var presHtml = presence.length
      ? presence.map(function (p) {
        return '<li>' + esc(p.displayName || p.username) + '</li>';
      }).join('')
      : '<li class="ph-room-empty-inline">Chưa có ai online</li>';

    _host.innerHTML =
      '<div class="ph-room-shell">' +
        '<header class="ph-room-header">' +
          '<button type="button" class="ph-room-back" id="phRoomLeave" title="Rời phòng">← Rời phòng</button>' +
          '<div class="ph-room-title">' +
            '<h2>' + esc(room.title || 'Cuộc họp') + '</h2>' +
            '<p>' + esc(room.meeting_code || '') + ' · ' + (room.presence_count || 0) + ' đang online</p>' +
          '</div>' +
        '</header>' +
        '<div class="ph-room-body">' +
          '<div class="ph-room-chat" id="phRoomChatList">' + chatHtml + '</div>' +
          '<aside class="ph-room-side">' +
            '<h3>Đang online</h3>' +
            '<ul class="ph-room-presence">' + presHtml + '</ul>' +
          '</aside>' +
        '</div>' +
        '<footer class="ph-room-footer">' +
          '<input type="text" id="phRoomChatInput" placeholder="Nhập tin nhắn..." maxlength="4000" autocomplete="off">' +
          '<button type="button" class="ph-btn ph-btn-primary" id="phRoomSend">Gửi</button>' +
        '</footer>' +
      '</div>';

    var list = _host.querySelector('#phRoomChatList');
    if (list) list.scrollTop = list.scrollHeight;

    var leaveBtn = _host.querySelector('#phRoomLeave');
    if (leaveBtn) leaveBtn.addEventListener('click', destroy);

    var sendBtn = _host.querySelector('#phRoomSend');
    var input = _host.querySelector('#phRoomChatInput');
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
      input.focus();
    }
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
    /**
     * @param {{ meetingId, onClose }} opts
     */
    open: async function (opts) {
      opts = opts || {};
      if (!opts.meetingId) return;

      _host = document.getElementById('meetingRoomHost');
      if (!_host) return;

      _onClose = opts.onClose || null;
      _meetingId = opts.meetingId;
      _joined = false;

      _host.classList.add('ph-room-open');
      document.body.classList.add('ph-room-active');
      _host.innerHTML = '<div class="ph-room-loading">Đang vào phòng...</div>';

      try {
        var room = await window.PhonghopServices.joinRoom(_meetingId);
        _joined = true;
        renderRoom(room);
        if (_pollTimer) clearInterval(_pollTimer);
        _pollTimer = setInterval(refresh, 2500);
      } catch (e) {
        _host.innerHTML = '<div class="ph-room-loading">' + esc(e.message || 'Không vào được phòng') +
          '<br><button type="button" class="ph-btn" id="phRoomErrClose">Đóng</button></div>';
        var btn = _host.querySelector('#phRoomErrClose');
        if (btn) btn.addEventListener('click', destroy);
      }
    },

    /**
     * Tra mã MTG-... rồi vào phòng
     */
    openByCode: async function (code, opts) {
      opts = opts || {};
      var meeting = await window.PhonghopServices.lookupMeetingByCode(code);
      if (!meeting || !meeting.id) throw new Error('Không tìm thấy cuộc họp');
      await window.MeetingRoom.open({ meetingId: meeting.id, onClose: opts.onClose });
    },

    destroy: destroy,
    resetShell: resetRoomShell
  };

  window.addEventListener('pagehide', function () {
    destroy(true);
  });
})();
