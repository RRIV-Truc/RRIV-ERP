/**
 * MeetingDetail.js — xem chi tiết, sửa, hủy cuộc họp
 */
(function () {
  'use strict';

  var _overlay = null;
  var _meeting = null;
  var _opts = null;

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function fmtDt(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('vi-VN', {
        weekday: 'short', hour: '2-digit', minute: '2-digit',
        day: '2-digit', month: '2-digit', year: 'numeric'
      });
    } catch (_) { return iso; }
  }

  function statusLabel(st) {
    var map = {
      draft: 'Nháp', scheduled: 'Đã lên lịch', live: 'Đang họp',
      completed: 'Hoàn thành', cancelled: 'Đã hủy'
    };
    return map[st] || st || '—';
  }

  function roleLabel(role) {
    var map = { organizer: 'Chủ trì', host: 'Điều phối', participant: 'Tham dự', observer: 'Quan sát' };
    return map[role] || role || '';
  }

  function closeOverlay() {
    if (_overlay && _overlay.parentNode) _overlay.parentNode.removeChild(_overlay);
    _overlay = null;
    _meeting = null;
  }

  function destroy() {
    closeOverlay();
    _opts = null;
  }

  function copyText(text) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        alert('Đã sao chép vào clipboard.');
      }).catch(function () {
        prompt('Sao chép thủ công:', text);
      });
    } else {
      prompt('Sao chép thủ công:', text);
    }
  }

  function canManage() {
    return window.PhonghopPerms && window.PhonghopPerms.canCreateMeeting();
  }

  function isEditable(m) {
    var st = m.status || m.meeting_status || '';
    return canManage() && (st === 'scheduled' || st === 'draft' || st === 'live');
  }

  function renderParticipants(parts) {
    if (!parts || !parts.length) {
      return '<p class="ph-detail-muted">Chưa có người được mời.</p>';
    }
    return '<ul class="ph-detail-part-list">' + parts.map(function (p) {
      var name = p.display_name || p.username || p.external_name || p.employee_id || '—';
      var metaParts = [roleLabel(p.participant_role)];
      if (p.is_external) metaParts.unshift('Ngoài viện');
      if (p.employee_code) metaParts.push(p.employee_code);
      if (p.department_name) metaParts.push(p.department_name);
      if (p.external_email) metaParts.push(p.external_email);
      var meta = metaParts.filter(Boolean).join(' · ');
      return '<li><strong>' + escapeHtml(name) + '</strong>' +
        (meta ? '<span>' + escapeHtml(meta) + '</span>' : '') + '</li>';
    }).join('') + '</ul>';
  }

  function buildShareText(m) {
    var J = window.PhonghopJoin;
    var SVC = window.PhonghopServices;
    var room = SVC.roomLabel(m, (_opts && _opts.rooms) || []);
    var code = m.meeting_code || '';
    var joinUrl = J && J.buildJoinUrl ? J.buildJoinUrl(code) : '';
    var lines = [
      'Cuộc họp: ' + (m.title || ''),
      'Mã cuộc họp: ' + (code || '—'),
      'Thời gian: ' + fmtDt(m.scheduled_start) + ' → ' + fmtDt(m.scheduled_end),
      'Hình thức: ' + SVC.modeLabel(m.meeting_mode)
    ];
    if (room) lines.push('Phòng: ' + room);
    lines.push('');
    if (joinUrl) {
      lines.push('Link tham gia (nhân viên Viện — cần đăng nhập ERP):');
      lines.push(joinUrl);
      lines.push('');
    }
    lines.push('Hoặc: mở app Phòng Họp → nhập mã ' + code + ' → Vào phòng.');
    lines.push('Chỉ người được mời mới vào được (kể cả khi biết mã).');
    return lines.join('\n');
  }

  function renderJoinShareBlock(m) {
    var J = window.PhonghopJoin;
    var code = m.meeting_code || '';
    if (!code || !J || !J.buildJoinUrl) return '';
    var st = m.status || m.meeting_status || '';
    if (st === 'cancelled' || st === 'completed') return '';
    var joinUrl = J.buildJoinUrl(code);
    var hint = J.getJoinUrlHint ? J.getJoinUrlHint(joinUrl) : '';
    var hintClass = J.isLocalOnlyHostname && joinUrl
      ? (function () {
          try {
            return J.isLocalOnlyHostname(new URL(joinUrl).hostname) ? ' ph-detail-warn' : '';
          } catch (_) { return ''; }
        })()
      : '';
    return (
      '<div class="ph-detail-block ph-detail-join-share">' +
        '<span class="ph-detail-label">Link & QR tham gia (nội bộ)</span>' +
        '<p class="ph-detail-muted ph-detail-help">Gửi cho nhân viên Viện đã được mời. ' +
        'Mở link hoặc quét QR → đăng nhập ERP (nếu chưa) → vào phòng.</p>' +
        '<div class="ph-join-link-row">' +
          '<input type="text" class="ph-join-url-input" id="phDetailJoinUrl" readonly value="' + escapeHtml(joinUrl) + '">' +
          '<button type="button" class="ph-btn" id="phDetailCopyLink">Sao chép link</button>' +
        '</div>' +
        '<div class="ph-qr-wrap" id="phDetailQrHost">' +
          '<span class="ph-detail-muted">Đang tạo mã QR…</span>' +
        '</div>' +
        '<p class="ph-detail-muted ph-detail-help ph-qr-caption' + hintClass + '">' + escapeHtml(hint) + '</p>' +
      '</div>'
    );
  }

  function renderBody(m) {
    var SVC = window.PhonghopServices;
    var room = SVC.roomLabel(m, (_opts && _opts.rooms) || []);
    var mode = SVC.modeLabel(m.meeting_mode);
    var st = m.status || m.meeting_status || '';
    var code = m.meeting_code || m.id || '';
    var count = m.participant_count != null ? m.participant_count : ((m.participants || []).length);
    var fbId = m.firebase_room_id || '';
    var onlineBlock = fbId
      ? ('<p class="ph-detail-muted ph-detail-help">ID phòng online (kỹ thuật, dùng nội bộ hệ thống):</p>' +
         '<code class="ph-code">' + escapeHtml(fbId) + '</code>' +
         '<p class="ph-detail-muted ph-detail-help">Đây <strong>không</strong> phải mã tra cứu. ' +
         'Khi gửi cho đồng nghiệp, dùng <strong>Mã cuộc họp ' + escapeHtml(code) + '</strong> ở trên.</p>')
      : '<p class="ph-detail-muted">Phòng online sẽ được tạo khi bắt đầu họp trực tuyến.</p>';

    var steps = '';
    if (st === 'scheduled' || st === 'draft' || st === 'live') {
      steps =
        '<div class="ph-detail-steps">' +
          '<h4>Bước tiếp theo</h4>' +
          '<ol>' +
            '<li>Kiểm tra danh sách người mời và thông tin phòng bên dưới.</li>' +
            '<li>Nếu cần thay đổi, bấm <strong>Sửa cuộc họp</strong>.</li>' +
            '<li>Bấm <strong>Vào phòng họp</strong> hoặc dùng <strong>Link / QR</strong> bên dưới (mã ' + escapeHtml(code) + ').</li>' +
            '<li>Ở màn chính: nhập mã vào ô <strong>Vào bằng mã</strong> (sau khi đăng nhập).</li>' +
          '</ol>' +
        '</div>';
    } else if (st === 'cancelled') {
      steps = '<div class="ph-detail-steps ph-detail-steps-muted"><p>Cuộc họp đã bị hủy.</p></div>';
    } else if (st === 'completed') {
      steps = '<div class="ph-detail-steps ph-detail-steps-muted"><p>Cuộc họp đã kết thúc.</p></div>';
    }

    var actions = '';
    var canJoin = SVC.canJoinMeeting(m) && fbId;
    if (canJoin) {
      actions += '<button type="button" class="ph-btn ph-btn-primary" id="phDetailJoin">Vào phòng họp</button>';
    }
    if (isEditable(m)) {
      actions +=
        '<button type="button" class="ph-btn" id="phDetailEdit">Sửa cuộc họp</button>' +
        '<button type="button" class="ph-btn ph-btn-danger" id="phDetailCancel">Hủy cuộc họp</button>';
    }
    actions += '<button type="button" class="ph-btn" id="phDetailCopyShare">Chia sẻ thông tin họp</button>';
    actions += '<button type="button" class="ph-btn" id="phDetailDocs">Kho tài liệu</button>';
    if (canManage()) {
      actions += '<button type="button" class="ph-btn ph-btn-danger" id="phDetailDelete">Xóa vĩnh viễn</button>';
    }
    if (fbId && canManage()) {
      actions += '<button type="button" class="ph-btn ph-btn-ghost" id="phDetailCopyFb" title="ID kỹ thuật Firebase">Sao chép ID kỹ thuật</button>';
    }

    return (
      '<div class="ph-detail-head">' +
        '<div><h2>' + escapeHtml(m.title || '—') + '</h2>' +
        '<p class="ph-detail-code">' + escapeHtml(code) + '</p></div>' +
        '<span class="ph-badge">' + escapeHtml(statusLabel(st)) + '</span>' +
      '</div>' +
      '<div class="ph-detail-grid">' +
        '<div><span class="ph-detail-label">Thời gian</span>' +
        '<p>' + escapeHtml(fmtDt(m.scheduled_start)) + ' → ' + escapeHtml(fmtDt(m.scheduled_end)) + '</p></div>' +
        '<div><span class="ph-detail-label">Hình thức</span><p>' + escapeHtml(mode) + '</p></div>' +
        (room ? '<div><span class="ph-detail-label">Phòng vật lý</span><p>' + escapeHtml(room) + '</p></div>' : '') +
        '<div><span class="ph-detail-label">Mã cuộc họp</span><p><strong>' + escapeHtml(code) + '</strong></p></div>' +
        '<div><span class="ph-detail-label">Người mời</span><p>' + count + ' người</p></div>' +
        '<div class="ph-detail-full"><span class="ph-detail-label">Phòng online</span>' + onlineBlock + '</div>' +
      '</div>' +
      (m.description
        ? '<div class="ph-detail-block"><span class="ph-detail-label">Mô tả</span><p>' + escapeHtml(m.description) + '</p></div>'
        : '') +
      '<div class="ph-detail-block">' +
        '<span class="ph-detail-label">Danh sách tham dự</span>' +
        renderParticipants(m.participants || []) +
      '</div>' +
      renderJoinShareBlock(m) +
      steps +
      '<div class="ph-detail-actions">' + actions +
        '<button type="button" class="ph-btn" id="phDetailClose">Đóng</button>' +
      '</div>'
    );
  }

  function bindActions() {
    if (!_overlay || !_meeting) return;
    var closeBtn = _overlay.querySelector('#phDetailClose');
    var editBtn = _overlay.querySelector('#phDetailEdit');
    var cancelBtn = _overlay.querySelector('#phDetailCancel');
    var deleteBtn = _overlay.querySelector('#phDetailDelete');
    var joinBtn = _overlay.querySelector('#phDetailJoin');
    var copyShareBtn = _overlay.querySelector('#phDetailCopyShare');
    var docsBtn = _overlay.querySelector('#phDetailDocs');
    var copyLinkBtn = _overlay.querySelector('#phDetailCopyLink');
    var copyBtn = _overlay.querySelector('#phDetailCopyFb');
    var xBtn = _overlay.querySelector('.ph-detail-x');

    function close() { destroy(); }

    if (closeBtn) closeBtn.addEventListener('click', close);
    if (xBtn) xBtn.addEventListener('click', close);
    _overlay.addEventListener('click', function (e) {
      if (e.target === _overlay) close();
    });

    if (joinBtn) {
      joinBtn.addEventListener('click', function () {
        var mid = _meeting.id;
        var onUpdated = _opts && _opts.onUpdated;
        destroy();
        if (window.MeetingRoom) {
          window.MeetingRoom.open({
            meetingId: mid,
            onClose: function () {
              if (typeof onUpdated === 'function') onUpdated();
            }
          });
        }
      });
    }

    if (copyShareBtn) {
      copyShareBtn.addEventListener('click', function () {
        copyText(buildShareText(_meeting));
      });
    }

    if (docsBtn) {
      docsBtn.addEventListener('click', function () {
        var mid = _meeting.id;
        destroy();
        if (window.PhonghopShell && window.PhonghopShell.openDocumentsForMeeting) {
          window.PhonghopShell.openDocumentsForMeeting(mid);
        }
      });
    }

    if (copyLinkBtn) {
      copyLinkBtn.addEventListener('click', function () {
        var inp = _overlay.querySelector('#phDetailJoinUrl');
        copyText(inp ? inp.value : '');
      });
    }

    var qrHost = _overlay.querySelector('#phDetailQrHost');
    if (qrHost && window.PhonghopJoin && _meeting.meeting_code) {
      window.PhonghopJoin.renderQr(qrHost, window.PhonghopJoin.buildJoinUrl(_meeting.meeting_code));
    }

    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        copyText(_meeting.firebase_room_id || '');
      });
    }

    if (editBtn) {
      editBtn.addEventListener('click', async function () {
        var m = _meeting;
        var opts = _opts;
        destroy();
        if (window.MeetingForm && window.MeetingForm.open) {
          await window.MeetingForm.open({
            meeting: m,
            rooms: opts.rooms,
            orgData: opts.orgData,
            reloadOrg: opts.reloadOrg,
            onSaved: opts.onUpdated
          });
        }
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', async function () {
        if (!confirm('Hủy cuộc họp "' + (_meeting.title || '') + '"? Hành động này không thể hoàn tác.')) return;
        try {
          var onUpdated = _opts && _opts.onUpdated;
          await window.PhonghopServices.cancelMeeting(_meeting.id);
          destroy();
          if (typeof onUpdated === 'function') onUpdated();
        } catch (e) {
          alert(e.message || 'Không hủy được cuộc họp');
        }
      });
    }

    if (deleteBtn) {
      deleteBtn.addEventListener('click', async function () {
        var st = (_meeting.status || _meeting.meeting_status || '').toLowerCase();
        var label = [_meeting.meeting_code, _meeting.title].filter(Boolean).join(' — ');
        var msg = 'Xóa vĩnh viễn cuộc họp "' + label + '"?\n\nDữ liệu sẽ không khôi phục được.';
        if (st === 'live') msg = 'Cuộc họp đang diễn ra.\n\n' + msg;
        if (!confirm(msg)) return;
        try {
          var onUpdated = _opts && _opts.onUpdated;
          await window.PhonghopServices.deleteMeeting(_meeting.id);
          destroy();
          if (typeof onUpdated === 'function') onUpdated();
        } catch (e) {
          alert(e.message || 'Không xóa được cuộc họp');
        }
      });
    }
  }

  function showLoading() {
    closeOverlay();
    _overlay = document.createElement('div');
    _overlay.className = 'ph-detail-overlay';
    _overlay.innerHTML =
      '<div class="ph-detail-modal">' +
        '<button type="button" class="ph-detail-x" aria-label="Đóng">&times;</button>' +
        '<div class="ph-detail-loading">Đang tải...</div>' +
      '</div>';
    document.body.appendChild(_overlay);
    _overlay.querySelector('.ph-detail-x').addEventListener('click', destroy);
    _overlay.addEventListener('click', function (e) {
      if (e.target === _overlay) destroy();
    });
  }

  function showMeeting(m) {
    _meeting = m;
    if (!_overlay) {
      _overlay = document.createElement('div');
      _overlay.className = 'ph-detail-overlay';
      document.body.appendChild(_overlay);
    }
    _overlay.innerHTML =
      '<div class="ph-detail-modal">' +
        '<button type="button" class="ph-detail-x" aria-label="Đóng">&times;</button>' +
        '<div class="ph-detail-body">' + renderBody(m) + '</div>' +
      '</div>';
    bindActions();
  }

  window.MeetingDetail = {
    /**
     * @param {{ meetingId, rooms, employees, currentUser, reloadEmployees, onUpdated }} opts
     */
    open: async function (opts) {
      opts = opts || {};
      _opts = opts;
      if (!opts.meetingId) return;

      showLoading();
      try {
        var meeting = await window.PhonghopServices.getMeeting(opts.meetingId);
        showMeeting(meeting);
      } catch (e) {
        destroy();
        alert(e.message || 'Không tải được chi tiết cuộc họp');
      }
    },

    destroy: destroy
  };
})();
