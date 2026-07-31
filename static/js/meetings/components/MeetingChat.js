/**
 * MeetingChat.js — chat phiên họp (công khai / chủ trì / riêng tư)
 */
(function () {
  'use strict';

  var _host = null;
  var _meetingId = null;
  var _lastRoom = null;
  var _chatTarget = 'all';
  var _chatSeeded = false;
  var _seenMsgIds = {};
  var _unreadPrivate = {};

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function fmtTime(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    } catch (_) { return ''; }
  }

  function myUsername() {
    var fn = window.PhonghopServices && window.PhonghopServices.username;
    return fn ? String(fn() || '').trim().toLowerCase() : '';
  }

  function channelLabel(channel) {
    var c = (channel || 'all').toLowerCase();
    if (c === 'hosts') return '→ Chủ trì & Thư ký';
    if (c === 'private') return 'Riêng tư';
    return 'Công khai';
  }

  function filterMessages(chat, target) {
    var list = chat || [];
    var uname = myUsername();
    if (target === 'all') {
      return list.filter(function (m) {
        var ch = (m.channel || 'all').toLowerCase();
        return ch === 'all' || ch === '';
      });
    }
    if (target === 'hosts') {
      return list.filter(function (m) { return (m.channel || '').toLowerCase() === 'hosts'; });
    }
    if (target.indexOf('user:') === 0) {
      var peer = target.slice(5).toLowerCase();
      var myEmp = myEmployeeId();
      return list.filter(function (m) {
        if ((m.channel || '').toLowerCase() !== 'private') return false;
        var from = (m.username || '').trim().toLowerCase();
        var to = (m.toUsername || '').trim().toLowerCase();
        if ((from === uname && to === peer) || (from === peer && to === uname)) return true;
        if (!myEmp) return false;
        var toEmp = String(m.toEmployeeId || m.to_employee_id || '');
        var fromEmp = String(m.employeeId || m.employee_id || '');
        return (from === peer && toEmp === myEmp) || (to === peer && fromEmp === myEmp);
      });
    }
    return list;
  }

  function msgKey(m) {
    if (m && m.id) return String(m.id);
    return String(m && m.at || '') + '|' + String(m && m.username || '') + '|' +
      String(m && m.text || '').slice(0, 48);
  }

  function clearUnreadForTarget(target) {
    if (target && target.indexOf('user:') === 0) {
      delete _unreadPrivate[target.slice(5).toLowerCase()];
    }
  }

  function myEmployeeId() {
    var u = window.PhonghopState && window.PhonghopState.state.currentUser;
    if (u && u.employee_id) return String(u.employee_id);
    if (u && u.employeeId) return String(u.employeeId);
    try {
      var c = JSON.parse(localStorage.getItem('currentUser') || 'null');
      if (c && (c.employee_id || c.employeeId)) return String(c.employee_id || c.employeeId);
    } catch (_) { /* ignore */ }
    return '';
  }

  function isPrivateMessageForMe(m) {
    if ((m.channel || '').toLowerCase() !== 'private') return false;
    var uname = myUsername();
    var myEmp = myEmployeeId();
    var from = (m.username || '').trim().toLowerCase();
    var to = (m.toUsername || '').trim().toLowerCase();
    if (from === uname) return false;
    if (to === uname) return true;
    if (myEmp) {
      var toEmp = String(m.toEmployeeId || m.to_employee_id || '');
      if (toEmp && toEmp === myEmp) return true;
    }
    return false;
  }

  function incomingPrivatePeer(m) {
    return (m.username || '').trim().toLowerCase();
  }

  /** Lần đầu mở chat: vẫn chuyển sang hộp thoại riêng nếu đã có tin gửi tới mình. */
  function seedInitialChat(chat) {
    var switchPeer = null;
    (chat || []).forEach(function (m) {
      var key = msgKey(m);
      _seenMsgIds[key] = true;
      if (!isPrivateMessageForMe(m)) return;
      var from = incomingPrivatePeer(m);
      if (!from) return;
      if (_chatTarget !== 'user:' + from) {
        _unreadPrivate[from] = (_unreadPrivate[from] || 0) + 1;
      }
      switchPeer = from;
    });
    return switchPeer;
  }

  /** Phát hiện tin riêng mới gửi tới mình; trả về username người gửi để tự chuyển tab. */
  function processNewMessages(chat) {
    var switchPeer = null;
    (chat || []).forEach(function (m) {
      var key = msgKey(m);
      if (_seenMsgIds[key]) return;
      _seenMsgIds[key] = true;
      if (!isPrivateMessageForMe(m)) return;
      var from = incomingPrivatePeer(m);
      if (!from) return;
      if (_chatTarget !== 'user:' + from) {
        _unreadPrivate[from] = (_unreadPrivate[from] || 0) + 1;
      }
      switchPeer = from;
    });
    return switchPeer;
  }

  function peerLabelFromChat(chat, peer) {
    var label = peer;
    (chat || []).forEach(function (m) {
      var from = (m.username || '').trim().toLowerCase();
      var to = (m.toUsername || '').trim().toLowerCase();
      if (from === peer && m.displayName) label = m.displayName;
      if (to === peer && m.toDisplayName) label = m.toDisplayName;
    });
    return label;
  }

  function buildUnreadBanner() {
    var peers = Object.keys(_unreadPrivate);
    if (!peers.length || _chatTarget !== 'all') return '';
    var total = peers.reduce(function (n, p) { return n + (_unreadPrivate[p] || 0); }, 0);
    return '<div class="ph-chat-unread-banner" data-peer="' + esc(peers[0]) + '">' +
      '💬 Bạn có ' + total + ' tin nhắn riêng — bấm để xem</div>';
  }

  function buildTargetOptions(room) {
    var uname = myUsername();
    var opts = [
      { value: 'all', label: '🌐 Mọi người (công khai)' }
    ];
    if (!room.is_host && !room.is_secretary) {
      opts.push({ value: 'hosts', label: '👔 Gửi Chủ trì & Thư ký' });
    }
    var attendees = room.attendees || [];
    var privAdded = {};
    function addPrivateOption(u, displayName, online) {
      if (!u || u === uname || privAdded[u]) return;
      privAdded[u] = true;
      var name = displayName || u;
      var onlineTxt = online === false ? ' (offline)' : (online === true ? '' : '');
      var unread = _unreadPrivate[u] || 0;
      var badge = unread ? ' • ' + unread + ' mới' : '';
      opts.push({ value: 'user:' + u, label: '💬 Riêng: ' + name + onlineTxt + badge });
    }
    attendees.forEach(function (a) {
      addPrivateOption(
        (a.username || '').trim().toLowerCase(),
        a.displayName,
        a.online
      );
    });
    (_lastRoom && _lastRoom.chat || []).forEach(function (m) {
      if ((m.channel || '').toLowerCase() !== 'private') return;
      var from = (m.username || '').trim().toLowerCase();
      var to = (m.toUsername || '').trim().toLowerCase();
      if (from && from !== uname) {
        addPrivateOption(from, m.displayName || from, undefined);
      }
      if (to && to !== uname) {
        addPrivateOption(to, m.toDisplayName || to, undefined);
      }
    });
    Object.keys(_unreadPrivate).forEach(function (peer) {
      addPrivateOption(peer, peerLabelFromChat(_lastRoom && _lastRoom.chat, peer), undefined);
    });
    return opts;
  }

  function buildChatHtml(messages, target) {
    var filtered = filterMessages(messages, target);
    if (!filtered.length) {
      var emptyBanner = buildUnreadBanner();
      if (target === 'all') {
        return emptyBanner + '<div class="ph-room-empty">Chưa có tin công khai. Chào mọi người!</div>';
      }
      if (target === 'hosts') {
        return '<div class="ph-room-empty">Chưa có tin gửi Chủ trì & Thư ký.</div>';
      }
      return '<div class="ph-room-empty">Chưa có tin nhắn riêng trong cuộc trò chuyện này.</div>';
    }
    var uname = myUsername();
    var banner = buildUnreadBanner();
    var body = filtered.map(function (m) {
      var mine = (m.username || '').trim().toLowerCase() === uname;
      var ch = (m.channel || 'all').toLowerCase();
      var meta = '';
      if (ch === 'private') {
        var peer = mine ? (m.toDisplayName || m.toUsername) : (m.displayName || m.username);
        meta = mine ? ('→ ' + esc(peer)) : ('← ' + esc(m.displayName || m.username));
      } else if (ch === 'hosts') {
        meta = channelLabel('hosts');
      }
      return '<div class="ph-room-msg' + (mine ? ' mine' : '') + '">' +
        '<div class="ph-room-msg-head">' +
          '<strong>' + esc(m.displayName || m.username) + '</strong>' +
          (meta ? '<span class="ph-room-msg-channel">' + meta + '</span>' : '') +
          '<span>' + esc(fmtTime(m.at)) + '</span>' +
        '</div>' +
        '<div class="ph-room-msg-text">' + esc(m.text) + '</div>' +
      '</div>';
    }).join('');
    return banner + body;
  }

  function updateTargetSelect(room) {
    var sel = _host && _host.querySelector('#phChatTargetSelect');
    if (!sel) return;
    var prev = _chatTarget;
    var opts = buildTargetOptions(room);
    var html = opts.map(function (o) {
      return '<option value="' + esc(o.value) + '">' + esc(o.label) + '</option>';
    }).join('');
    sel.innerHTML = html;
    var valid = opts.some(function (o) { return o.value === prev; });
    if (!valid && prev.indexOf('user:') === 0) {
      var peer = prev.slice(5);
      opts.push({
        value: prev,
        label: '💬 Riêng: ' + peerLabelFromChat(_lastRoom && _lastRoom.chat, peer)
      });
      valid = true;
    }
    _chatTarget = valid ? prev : 'all';
    sel.value = _chatTarget;
    updatePlaceholder();
  }

  function updatePlaceholder() {
    var input = _host && _host.querySelector('#phRoomChatInput');
    if (!input) return;
    if (_chatTarget === 'all') {
      input.placeholder = 'Nhập tin nhắn cho mọi người…';
    } else if (_chatTarget === 'hosts') {
      input.placeholder = 'Nhắn riêng Chủ trì & Thư ký…';
    } else if (_chatTarget.indexOf('user:') === 0) {
      input.placeholder = 'Nhắn riêng người này…';
    } else {
      input.placeholder = 'Nhập tin nhắn…';
    }
  }

  function sendChat() {
    if (!_host || !_meetingId) return;
    var input = _host.querySelector('#phRoomChatInput');
    if (!input) return;
    var text = input.value.trim();
    if (!text) return;

    var payload = { message: text, channel: 'all' };
    if (_chatTarget === 'hosts') {
      payload.channel = 'hosts';
    } else if (_chatTarget.indexOf('user:') === 0) {
      payload.channel = 'private';
      payload.to_username = _chatTarget.slice(5);
    }

    input.value = '';
    window.PhonghopServices.sendRoomChat(_meetingId, payload).then(function () {
      if (window.MeetingRoom && window.MeetingRoom.refresh) {
        window.MeetingRoom.refresh();
      }
    }).catch(function (e) {
      alert(e.message || 'Không gửi được tin nhắn');
    });
  }

  function bindEvents() {
    if (!_host || _host.dataset.chatBound) return;
    _host.dataset.chatBound = '1';

    var sendBtn = _host.querySelector('#phRoomSend');
    var input = _host.querySelector('#phRoomChatInput');
    var sel = _host.querySelector('#phChatTargetSelect');

    if (sendBtn) sendBtn.addEventListener('click', sendChat);
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); sendChat(); }
      });
    }
    if (sel) {
      sel.addEventListener('change', function () {
        _chatTarget = sel.value || 'all';
        clearUnreadForTarget(_chatTarget);
        updatePlaceholder();
        if (_lastRoom) renderMessages(_lastRoom);
      });
    }

    if (_host) {
      _host.addEventListener('click', function (e) {
        var banner = e.target && e.target.closest ? e.target.closest('.ph-chat-unread-banner') : null;
        if (!banner) return;
        var peer = banner.getAttribute('data-peer');
        if (!peer) return;
        _chatTarget = 'user:' + peer.toLowerCase();
        clearUnreadForTarget(_chatTarget);
        var selEl = _host.querySelector('#phChatTargetSelect');
        if (selEl) selEl.value = _chatTarget;
        updatePlaceholder();
        if (_lastRoom) renderMessages(_lastRoom);
      });
    }
  }

  function ensureShell() {
    if (!_host) return;
    if (_host.querySelector('#phRoomChatList')) return;

    _host.innerHTML =
      '<div class="ph-ctx-chat-inner">' +
        '<label class="ph-chat-target-label">' +
          'Gửi đến' +
          '<select id="phChatTargetSelect" class="ph-input ph-chat-target-select">' +
            '<option value="all">🌐 Mọi người (công khai)</option>' +
          '</select>' +
        '</label>' +
        '<div class="ph-room-chat ph-ctx-chat-list" id="phRoomChatList"></div>' +
        '<footer class="ph-room-footer ph-ctx-chat-footer">' +
          '<input type="text" id="phRoomChatInput" placeholder="Nhập tin nhắn…" maxlength="4000" autocomplete="off">' +
          '<button type="button" class="ph-btn ph-btn-primary" id="phRoomSend">Gửi</button>' +
        '</footer>' +
      '</div>';

    bindEvents();
  }

  function renderMessages(room) {
    var chatList = _host && _host.querySelector('#phRoomChatList');
    if (!chatList) return;
    var atBottom = chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight < 48;
    chatList.innerHTML = buildChatHtml(room.chat || [], _chatTarget);
    if (atBottom) chatList.scrollTop = chatList.scrollHeight;
  }

  window.MeetingChat = {
    mount: function (hostEl, meetingId) {
      _host = hostEl;
      _meetingId = meetingId;
      _chatTarget = 'all';
      _chatSeeded = false;
      _seenMsgIds = {};
      _unreadPrivate = {};
      ensureShell();
    },

    syncFromRoom: function (room) {
      _lastRoom = room;
      if (!_host) return;
      ensureShell();

      var chat = (room || {}).chat || [];
      var switchPeer = _chatSeeded ? processNewMessages(chat) : seedInitialChat(chat);
      _chatSeeded = true;
      if (switchPeer) {
        var peerTarget = 'user:' + switchPeer;
        if (_chatTarget === 'all' || _chatTarget === 'hosts' || _chatTarget !== peerTarget) {
          _chatTarget = peerTarget;
          clearUnreadForTarget(_chatTarget);
        }
      }

      updateTargetSelect(room || {});
      var selEl = _host.querySelector('#phChatTargetSelect');
      if (selEl) selEl.value = _chatTarget;
      updatePlaceholder();
      renderMessages(room || {});
    },

    cleanup: function () {
      if (_host) {
        delete _host.dataset.chatBound;
        _host.innerHTML = '<p class="ph-detail-muted">Chat hiển thị khi bạn vào phiên họp.</p>';
      }
      _host = null;
      _meetingId = null;
      _lastRoom = null;
      _chatTarget = 'all';
      _chatSeeded = false;
      _seenMsgIds = {};
      _unreadPrivate = {};
    }
  };
})();
