/**
 * MeetingDocs.js — Kho tài liệu phiên họp (Cold Supabase → warm Firebase)
 */
(function () {
  'use strict';

  var _meetingId = null;
  var _parentId = null;
  var _canManage = false;
  var _sharedOnly = false;
  var _sharedOnlyMode = false;
  var _meetings = [];
  var _lastDocs = [];
  var _dragDocId = null;

  function canDragDrop() {
    return _canManage && !_sharedOnlyMode;
  }

  function moveDocument(docId, targetParentId) {
    return fetch(
      apiBase() + '/' + encodeURIComponent(docId) + '/move?username=' +
        encodeURIComponent(window.PhonghopServices.username()),
      {
        method: 'PATCH',
        headers: Object.assign({ 'Content-Type': 'application/json' }, hdrs()),
        body: JSON.stringify({ parent_id: targetParentId || null })
      }
    ).then(function (r) {
      return r.json().then(function (b) { return { ok: r.ok, b: b }; });
    }).then(function (x) {
      if (!x.ok) throw new Error(x.b.message || 'Không di chuyển được');
      return loadList();
    });
  }

  function uploadFileToFolder(file, parentId) {
    var fd = new FormData();
    fd.append('file', file);
    if (parentId) fd.append('parent_id', parentId);
    return fetch(apiBase() + '/upload?username=' + encodeURIComponent(window.PhonghopServices.username()), {
      method: 'POST',
      headers: hdrs(),
      body: fd
    }).then(function (r) {
      return r.json().then(function (b) { return { ok: r.ok, b: b }; });
    }).then(function (x) {
      if (!x.ok) throw new Error(x.b.message || 'Upload thất bại');
      return loadList();
    });
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function fmtSize(n) {
    var b = Number(n) || 0;
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(1) + ' MB';
  }

  function warmLabel(st) {
    var map = {
      pending: 'Chờ sync', warming: 'Đang sync', ready: 'Sẵn sàng hot',
      failed: 'Lỗi sync', archived: 'Đã lưu', purged: 'Đã xóa hot'
    };
    return map[st] || st || '—';
  }

  function apiBase() {
    return '/api/meetings/' + encodeURIComponent(_meetingId) + '/documents';
  }

  function hdrs() {
    return window.PhonghopServices && window.PhonghopServices.username
      ? { 'X-RRIV-Username': window.PhonghopServices.username() }
      : {};
  }

  async function loadList() {
    if (!_meetingId) return;
    var params = [];
    if (_parentId) params.push('parent_id=' + encodeURIComponent(_parentId));
    if (_sharedOnlyMode) params.push('shared_only=1');
    params.push('username=' + encodeURIComponent(window.PhonghopServices.username()));
    var qs = '?' + params.join('&');
    var res = await fetch(apiBase() + qs, { headers: hdrs() });
    var data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Không tải được tài liệu');
    _canManage = !!data.can_manage;
    _sharedOnly = !!data.shared_only;
    render(data.documents || [], data.breadcrumb || []);
  }

  function openDocLabel(d) {
    if (window.PhonghopServices && window.PhonghopServices.docOpenLabel) {
      return window.PhonghopServices.docOpenLabel(d.name, d.mime_type);
    }
    return 'Mở';
  }

  function openDoc(d, btn) {
    if (!window.PhonghopServices || !window.PhonghopServices.openMeetingDocument) {
      alert('Không mở được tài liệu — tải lại trang.');
      return;
    }
    var label = openDocLabel(d);
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Đang tải…';
    }
    var resetTimer = setTimeout(function () {
      if (btn) {
        btn.disabled = false;
        btn.textContent = label;
      }
    }, 5000);
    var done = function () {
      clearTimeout(resetTimer);
      if (btn) {
        btn.disabled = false;
        btn.textContent = label;
      }
    };
    var p = window.PhonghopServices.openMeetingDocument(_meetingId, d.id, {
      name: d.name,
      mime: d.mime_type,
      download_url: d.download_url || null
    });
    if (!p || typeof p.then !== 'function') {
      done();
      return;
    }
    p.catch(function (e) {
      alert(e.message || 'Không mở được tài liệu');
    }).finally(done);
  }

  function render(docs, breadcrumb) {
    _lastDocs = docs || [];
    var host = document.getElementById('phDocsHost');
    if (!host) return;

    var meetingOpts = _meetings.map(function (m) {
      var sel = m.id === _meetingId ? ' selected' : '';
      var label = [m.meeting_code, m.title].filter(Boolean).join(' — ');
      return '<option value="' + esc(m.id) + '"' + sel + '>' + esc(label) + '</option>';
    }).join('');

    var crumbs = '<button type="button" class="ph-docs-crumb" data-folder="">📂 Gốc</button>';
    breadcrumb.forEach(function (b) {
      crumbs += '<span class="ph-docs-crumb-sep">/</span>' +
        '<button type="button" class="ph-docs-crumb" data-folder="' + esc(b.id) + '">' + esc(b.name) + '</button>';
    });

    var rows = docs.length ? docs.map(function (d) {
      var icon = d.kind === 'folder' ? '📁' : '📄';
      var meta = d.kind === 'file'
        ? (fmtSize(d.file_size) + ' · ' + warmLabel(d.warm_status))
        : 'Thư mục';
      var acts = '';
      if (d.kind === 'folder') {
        acts = '<button type="button" class="ph-card-btn ph-docs-open" data-id="' + esc(d.id) + '">Mở</button>';
      } else {
        acts = '<button type="button" class="ph-card-btn ph-docs-view" data-id="' + esc(d.id) + '">' +
          esc(openDocLabel(d)) + '</button>';
      }
      if (_canManage) {
        acts += ' <button type="button" class="ph-card-btn ph-card-btn-danger ph-docs-del" data-id="' +
          esc(d.id) + '" data-kind="' + esc(d.kind) + '">Xóa</button>';
      }
      var dragCls = canDragDrop() ? ' ph-docs-row-draggable' : '';
      var dropCls = (canDragDrop() && d.kind === 'folder') ? ' ph-docs-drop-target' : '';
      return (
        '<div class="ph-docs-row' + (d.kind === 'folder' ? ' ph-docs-row-folder' : '') +
          dragCls + dropCls + '" data-id="' + esc(d.id) + '" data-kind="' + esc(d.kind) + '"' +
          (canDragDrop() ? ' draggable="true"' : '') + '>' +
          '<span class="ph-docs-icon">' + icon + '</span>' +
          '<div class="ph-docs-info"><strong>' + esc(d.name) + '</strong><span>' + esc(meta) + '</span></div>' +
          '<div class="ph-docs-actions">' + acts + '</div>' +
        '</div>'
      );
    }).join('') : '<p class="ph-empty">Chưa có tài liệu trong thư mục này.</p>';

    var toolbar = (_canManage && !_sharedOnlyMode)
      ? (
        '<div class="ph-docs-toolbar">' +
          '<button type="button" class="ph-btn" id="phDocsNewFolder">+ Thư mục mới</button>' +
          '<label class="ph-btn ph-btn-primary ph-docs-upload-label">' +
            '↑ Tải lên tài liệu' +
            '<input type="file" id="phDocsFileInput" hidden accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.txt,.csv">' +
          '</label>' +
          '<button type="button" class="ph-btn" id="phDocsWarm" title="Đồng bộ sang Firebase (hot)">⟳ Sync hot</button>' +
          '<span class="ph-docs-dnd-hint">Kéo thả file/thư mục vào thư mục đích · thả file từ máy vào thư mục để upload</span>' +
        '</div>'
      )
      : (_sharedOnlyMode
        ? '<p class="ph-detail-muted ph-docs-readonly">Chế độ xem phiên họp — không upload tại đây. Quản lý file ở menu <strong>Kho tài liệu</strong> (ngoài phiên).</p>'
        : '<p class="ph-detail-muted ph-docs-readonly">Chỉ xem — Thư ký / Chủ trì mới upload và tạo thư mục.</p>');

    var shareNote = _sharedOnlyMode
      ? '<p class="ph-detail-muted ph-docs-share-note">Trong phiên họp chỉ hiển thị tài liệu đã tick ở <strong>Sửa cuộc họp → Tài liệu họp</strong>.</p>'
      : (_sharedOnly && !_canManage
        ? '<p class="ph-detail-muted ph-docs-share-note">Chỉ hiển thị tài liệu đã được chia sẻ cho cuộc họp.</p>'
        : (_canManage
          ? '<p class="ph-detail-muted ph-docs-share-note">Tick chọn tài liệu chia sẻ trong <strong>Sửa cuộc họp → Tài liệu họp</strong>.</p>'
          : ''));

    host.innerHTML =
      '<div class="ph-docs-shell">' +
        '<div class="ph-docs-meeting-pick">' +
          '<label>Cuộc họp</label>' +
          '<select id="phDocsMeetingSelect" class="ph-input">' + meetingOpts + '</select>' +
        '</div>' +
        shareNote +
        toolbar +
        '<div class="ph-docs-breadcrumb">' + crumbs + '</div>' +
        '<div class="ph-docs-list' + (canDragDrop() ? ' ph-docs-list-droppable' : '') + '">' + rows + '</div>' +
        '<p class="ph-detail-muted ph-docs-foot">Lưu chính: Supabase · Phiên họp: Firebase (tự sync khi upload)</p>' +
      '</div>';

    bindEvents(host);
    if (canDragDrop()) bindDragDrop(host);
  }

  function bindDragDrop(host) {
    var listEl = host.querySelector('.ph-docs-list');

    function clearDropHighlight() {
      host.querySelectorAll('.is-drop-over').forEach(function (el) {
        el.classList.remove('is-drop-over');
      });
    }

    function acceptDrop(targetFolderId, e) {
      e.preventDefault();
      e.stopPropagation();
      clearDropHighlight();

      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) {
        var uploads = [];
        for (var i = 0; i < files.length; i++) uploads.push(uploadFileToFolder(files[i], targetFolderId));
        Promise.all(uploads).catch(function (err) { alert(err.message); });
        return;
      }

      var docId = _dragDocId || (e.dataTransfer && e.dataTransfer.getData('text/ph-doc-id'));
      if (!docId) return;
      if (targetFolderId && docId === targetFolderId) return;
      moveDocument(docId, targetFolderId).catch(function (err) { alert(err.message); });
    }

    host.querySelectorAll('.ph-docs-row-draggable').forEach(function (row) {
      row.addEventListener('dragstart', function (e) {
        _dragDocId = row.getAttribute('data-id');
        row.classList.add('is-dragging');
        if (e.dataTransfer) {
          e.dataTransfer.setData('text/ph-doc-id', _dragDocId || '');
          e.dataTransfer.effectAllowed = 'move';
        }
      });
      row.addEventListener('dragend', function () {
        _dragDocId = null;
        row.classList.remove('is-dragging');
        clearDropHighlight();
      });
    });

    host.querySelectorAll('.ph-docs-drop-target').forEach(function (folder) {
      folder.addEventListener('dragover', function (e) {
        if (_dragDocId === folder.getAttribute('data-id')) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        folder.classList.add('is-drop-over');
      });
      folder.addEventListener('dragleave', function () {
        folder.classList.remove('is-drop-over');
      });
      folder.addEventListener('drop', function (e) {
        acceptDrop(folder.getAttribute('data-id'), e);
      });
    });

    host.querySelectorAll('.ph-docs-crumb').forEach(function (crumb) {
      crumb.addEventListener('dragover', function (e) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        crumb.classList.add('is-drop-over');
      });
      crumb.addEventListener('dragleave', function () {
        crumb.classList.remove('is-drop-over');
      });
      crumb.addEventListener('drop', function (e) {
        var folderId = crumb.getAttribute('data-folder') || null;
        acceptDrop(folderId, e);
      });
    });

    if (listEl) {
      listEl.addEventListener('dragover', function (e) {
        if (!e.dataTransfer || (!e.dataTransfer.files.length && !_dragDocId)) return;
        e.preventDefault();
        listEl.classList.add('is-drop-over');
      });
      listEl.addEventListener('dragleave', function (e) {
        if (e.target === listEl) listEl.classList.remove('is-drop-over');
      });
      listEl.addEventListener('drop', function (e) {
        listEl.classList.remove('is-drop-over');
        if (e.target.closest('.ph-docs-drop-target') || e.target.closest('.ph-docs-crumb')) return;
        acceptDrop(_parentId || null, e);
      });
    }
  }

  function bindEvents(host) {
    var sel = host.querySelector('#phDocsMeetingSelect');
    if (sel) {
      sel.addEventListener('change', function () {
        _meetingId = sel.value;
        _parentId = null;
        loadList().catch(function (e) { alert(e.message); });
      });
    }

    host.querySelectorAll('.ph-docs-crumb').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var f = btn.getAttribute('data-folder');
        _parentId = f || null;
        loadList().catch(function (e) { alert(e.message); });
      });
    });

    host.querySelectorAll('.ph-docs-open, .ph-docs-row-folder').forEach(function (el) {
      el.addEventListener('click', function (e) {
        if (e.target.closest('.ph-docs-del') || e.target.closest('.ph-docs-view')) {
          return;
        }
        if (e.target.closest('.ph-docs-open')) {
          e.stopPropagation();
          _parentId = e.target.closest('.ph-docs-open').getAttribute('data-id');
          loadList().catch(function (err) { alert(err.message); });
          return;
        }
        if (el.classList.contains('ph-docs-row-folder')) {
          _parentId = el.getAttribute('data-id');
          loadList().catch(function (err) { alert(err.message); });
        }
      });
    });

    function docById(id) {
      return _lastDocs.find(function (d) { return d.id === id; });
    }

    host.querySelectorAll('.ph-docs-view').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var d = docById(btn.getAttribute('data-id'));
        if (d) openDoc(d, btn);
      });
    });

    host.querySelectorAll('.ph-docs-del').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = btn.getAttribute('data-id');
        var kind = btn.getAttribute('data-kind');
        var msg = kind === 'folder' ? 'Xóa thư mục này?' : 'Xóa tài liệu này?';
        if (!confirm(msg)) return;
        fetch(apiBase() + '/' + encodeURIComponent(id) + '?username=' +
          encodeURIComponent(window.PhonghopServices.username()), {
          method: 'DELETE',
          headers: hdrs()
        }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, b: b }; }); })
          .then(function (x) {
            if (!x.ok) throw new Error(x.b.message || 'Không xóa được');
            return loadList();
          })
          .catch(function (err) { alert(err.message); });
      });
    });

    var btnFolder = host.querySelector('#phDocsNewFolder');
    if (btnFolder) {
      btnFolder.addEventListener('click', function () {
        var name = prompt('Tên thư mục mới:');
        if (!name || !name.trim()) return;
        fetch(apiBase() + '/folder?username=' + encodeURIComponent(window.PhonghopServices.username()), {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, hdrs()),
          body: JSON.stringify({ name: name.trim(), parent_id: _parentId })
        }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, b: b }; }); })
          .then(function (x) {
            if (!x.ok) throw new Error(x.b.message || 'Không tạo được thư mục');
            return loadList();
          })
          .catch(function (e) { alert(e.message); });
      });
    }

    var fileInput = host.querySelector('#phDocsFileInput');
    if (fileInput) {
      fileInput.addEventListener('change', function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file) return;
        var fd = new FormData();
        fd.append('file', file);
        if (_parentId) fd.append('parent_id', _parentId);
        fetch(apiBase() + '/upload?username=' + encodeURIComponent(window.PhonghopServices.username()), {
          method: 'POST',
          headers: hdrs(),
          body: fd
        }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, b: b }; }); })
          .then(function (x) {
            fileInput.value = '';
            if (!x.ok) throw new Error(x.b.message || 'Upload thất bại');
            return loadList();
          })
          .catch(function (e) { alert(e.message); fileInput.value = ''; });
      });
    }

    var btnWarm = host.querySelector('#phDocsWarm');
    if (btnWarm) {
      btnWarm.addEventListener('click', function () {
        btnWarm.disabled = true;
        fetch(apiBase() + '/warm?username=' + encodeURIComponent(window.PhonghopServices.username()), {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, hdrs()),
          body: '{}'
        }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, b: b }; }); })
          .then(function (x) {
            btnWarm.disabled = false;
            if (!x.ok) throw new Error(x.b.message || 'Sync thất bại');
            alert('Đã sync hot: ' + (x.b.result && x.b.result.warmed != null ? x.b.result.warmed : 0) + ' file');
            return loadList();
          })
          .catch(function (e) { btnWarm.disabled = false; alert(e.message); });
      });
    }
  }

  async function refresh(meetingId, opts) {
    opts = opts || {};
    if (opts.sharedOnly != null) {
      _sharedOnlyMode = !!opts.sharedOnly;
    } else {
      _sharedOnlyMode = document.body.classList.contains('ph-in-session');
    }

    _meetings = (window.PhonghopState && window.PhonghopState.state.meetings) || [];
    if (meetingId) _meetingId = meetingId;
    if (!_meetingId && _meetings.length) _meetingId = _meetings[0].id || _meetings[0].meeting_id;
    _parentId = null;
    if (!_meetingId) {
      var host = document.getElementById('phDocsHost');
      if (host) host.innerHTML = '<p class="ph-empty">Chưa có cuộc họp — tạo cuộc họp trước khi thêm tài liệu.</p>';
      return;
    }
    await loadList();
  }

  window.MeetingDocs = {
    refresh: refresh,
    setMeeting: function (id, opts) {
      opts = opts || {};
      _meetingId = id;
      _parentId = null;
      if (opts.sharedOnly != null) _sharedOnlyMode = !!opts.sharedOnly;
      return refresh(id, opts);
    }
  };
})();
