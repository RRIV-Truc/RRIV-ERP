/**
 * MeetingForm.js — form tạo/sửa cuộc họp (ModalForm + ParticipantTreePicker)
 */
(function () {
  'use strict';

  var _modal = null;
  var _treePicker = null;
  var _escapeHandler = null;
  var _rooms = [];
  var _orgData = { personnel: [], departments: [], teams: [] };
  var _onSaved = null;
  var _editMeeting = null;
  var _pendingParticipants = null;
  var _pendingHostId = '';
  var _pendingSecretaryId = '';
  var _folderDocs = [];
  var _sharedDocIds = {};
  var _browseParentId = null;
  var _browseBreadcrumb = [];
  var _libraryMeetingId = null;
  var _pendingUploads = [];
  var _sharedDocsMeetingId = null;

  function escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function meetingToFormData(m) {
    var mid = m.id || m.meeting_id;
    var start = m.scheduled_start ? new Date(m.scheduled_start) : new Date();
    var end = m.scheduled_end ? new Date(m.scheduled_end) : defaultEnd(start);
    return {
      id: mid,
      title: m.title || '',
      description: m.description || '',
      meeting_mode: m.meeting_mode || 'hybrid',
      platform_type: m.platform_type || 'internal',
      physical_room_id: m.physical_room_id || '',
      scheduled_start_date: toLocalInputValue(start).slice(0, 10),
      scheduled_start_time: toLocalInputValue(start).slice(11, 16),
      scheduled_end_date: toLocalInputValue(end).slice(0, 10),
      scheduled_end_time: toLocalInputValue(end).slice(11, 16)
    };
  }

  function participantOptionKey(p) {
    if (p.is_external) return 'ext:' + (p.external_email || p.external_name || '');
    return String(p.employee_id || p.username || '');
  }

  function participantsFromMeeting(m) {
    if (!m || !m.participants) return [];
    _pendingHostId = '';
    _pendingSecretaryId = '';
    (m.participants || []).forEach(function (p) {
      var role = (p.participant_role || '').toLowerCase();
      var key = p.is_external
        ? 'ext:' + (p.external_email || p.external_name || '')
        : String(p.employee_id || p.username || '');
      if (role === 'host') _pendingHostId = key;
      if (role === 'secretary') _pendingSecretaryId = key;
    });
    return m.participants.filter(function (p) {
      var role = (p.participant_role || '').toLowerCase();
      return role !== 'organizer';
    }).map(function (p) {
      if (p.is_external) {
        return {
          is_external: true,
          external_name: p.external_name || p.display_name || '',
          external_email: p.external_email || null,
          participant_role: (p.participant_role || 'participant').toLowerCase()
        };
      }
      return {
        employee_id: p.employee_id || null,
        username: p.username || null,
        participant_role: (p.participant_role || 'participant').toLowerCase(),
        is_external: false
      };
    });
  }

  function applyMeetingRoles(participants) {
    var hostId = (_pendingHostId || '').trim();
    var secId = (_pendingSecretaryId || '').trim();
    return (participants || []).map(function (p) {
      var key = participantOptionKey(p);
      var role = 'participant';
      if (hostId && key === hostId) role = 'host';
      else if (secId && key === secId) role = 'secretary';
      return Object.assign({}, p, { participant_role: role });
    });
  }

  function refreshRoleSelects() {
    var hostSel = document.getElementById('phRoleHostSelect');
    var secSel = document.getElementById('phRoleSecretarySelect');
    if (!hostSel || !secSel) return;

    var parts = getSelectedParticipants().filter(function (p) { return !p.is_external; });
    var opts = '<option value="">— Chưa chọn —</option>' + parts.map(function (p) {
      var key = participantOptionKey(p);
      var person = (_orgData.personnel || []).find(function (x) { return x.id === p.employee_id; });
      var label = person && person.full_name
        ? person.full_name
        : (p.username || p.employee_id || key);
      return '<option value="' + escHtml(key) + '">' + escHtml(label) + '</option>';
    }).join('');

    hostSel.innerHTML = opts;
    secSel.innerHTML = opts;
    if (_pendingHostId) hostSel.value = _pendingHostId;
    if (_pendingSecretaryId) secSel.value = _pendingSecretaryId;

    hostSel.onchange = function () { _pendingHostId = hostSel.value || ''; };
    secSel.onchange = function () {
      _pendingSecretaryId = secSel.value || '';
      if (_pendingSecretaryId && _pendingSecretaryId === _pendingHostId) {
        alert('Thư ký và Chủ trì phải là hai người khác nhau.');
        _pendingSecretaryId = '';
        secSel.value = '';
      }
    };
  }

  function toLocalInputValue(date) {
    var d = date instanceof Date ? date : new Date(date);
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function defaultEnd(start) {
    var d = new Date(start);
    d.setHours(d.getHours() + 1);
    return d;
  }

  function cleanupParticipantWidget() {
    if (_treePicker && _treePicker.destroy) {
      try { _treePicker.destroy(); } catch (_) { /* ignore */ }
    }
    _treePicker = null;
    var host = document.getElementById('phParticipantsHost');
    if (host) host.innerHTML = '';
  }

  function cleanupEscapeHandler() {
    if (_escapeHandler) {
      document.removeEventListener('keydown', _escapeHandler);
      _escapeHandler = null;
    }
  }

  function fullCleanup() {
    cleanupParticipantWidget();
    cleanupEscapeHandler();
    _onSaved = null;
    _pendingParticipants = null;
    _pendingUploads = [];
  }

  function renderParticipantPicker() {
    cleanupParticipantWidget();
    var host = document.getElementById('phParticipantsHost');
    if (!host || typeof ParticipantTreePicker === 'undefined') return;

    host.innerHTML =
      '<div id="phParticipantTreeHost"></div>' +
      '<div class="ph-meeting-roles" id="phMeetingRolesHost">' +
        '<p class="ph-detail-muted ph-meeting-roles-lead">' +
          'Chỉ định vai trò trong phiên (chọn trong danh sách đã tick tham dự):</p>' +
        '<div class="ph-meeting-roles-grid">' +
          '<label class="ph-meeting-role-field">Chủ trì phiên' +
            '<select id="phRoleHostSelect" class="ph-input"><option value="">— Chưa chọn —</option></select>' +
          '</label>' +
          '<label class="ph-meeting-role-field">Thư ký' +
            '<select id="phRoleSecretarySelect" class="ph-input"><option value="">— Chưa chọn —</option></select>' +
          '</label>' +
        '</div>' +
      '</div>';
    _treePicker = ParticipantTreePicker.create('phParticipantTreeHost', {
      orgData: _orgData,
      onChange: function () { refreshRoleSelects(); }
    });

    if (_treePicker && _pendingParticipants) {
      _treePicker.setParticipants(_pendingParticipants);
      _pendingParticipants = null;
    }
    refreshRoleSelects();
  }

  function getSelectedParticipants() {
    var hostSel = document.getElementById('phRoleHostSelect');
    var secSel = document.getElementById('phRoleSecretarySelect');
    if (hostSel) _pendingHostId = hostSel.value || '';
    if (secSel) _pendingSecretaryId = secSel.value || '';
    var base = [];
    if (_treePicker && _treePicker.getParticipants) {
      base = _treePicker.getParticipants();
    } else {
      base = _pendingParticipants || [];
    }
    return applyMeetingRoles(base);
  }

  function getSelectedSharedDocIds() {
    syncSharedDocIdsFromDom();
    return Object.keys(_sharedDocIds).filter(function (id) {
      return _sharedDocIds[id] && id.indexOf('__mg__') !== 0;
    });
  }

  function currentEditMeetingId() {
    if (!_editMeeting) return null;
    return _editMeeting.id || _editMeeting.meeting_id || null;
  }

  async function loadDocShareSection(meetingId) {
    _folderDocs = [];
    _sharedDocIds = {};
    _sharedDocsMeetingId = meetingId || null;
    _browseParentId = null;
    _browseBreadcrumb = [{ id: '', name: 'Kho tài liệu' }];
    _libraryMeetingId = null;
    if (!window.PhonghopServices.browseLibraryFolder) {
      renderDocShareHost(false);
      return;
    }
    try {
      await loadDocBrowseFolder(null, meetingId || null);
    } catch (e) {
      console.warn('[MeetingForm] browseLibraryFolder', e);
      renderDocShareHost(false, e.message || 'Không tải được kho tài liệu');
    }
  }

  async function loadDocBrowseFolder(parentId, meetingId) {
    var data = await window.PhonghopServices.browseLibraryFolder({
      parentId: parentId || null,
      meetingId: meetingId || currentEditMeetingId() || null
    });
    _folderDocs = data.documents || [];
    _browseParentId = parentId || null;
    _browseBreadcrumb = data.breadcrumb || [{ id: '', name: 'Kho tài liệu' }];
    _libraryMeetingId = data.library_meeting_id || null;
    (data.shared_document_ids || []).forEach(function (id) {
      if (id) _sharedDocIds[id] = true;
    });
    renderDocShareHost(true);
  }

  function syncSharedDocIdsFromDom() {
    document.querySelectorAll('#phDocShareHost .ph-doc-share-cb').forEach(function (cb) {
      var id = cb.value;
      if (!id || id.indexOf('__mg__') === 0) return;
      if (cb.checked) _sharedDocIds[id] = true;
      else delete _sharedDocIds[id];
    });
  }

  function bindDocShareCheckboxes(host) {
    host.querySelectorAll('.ph-doc-share-cb').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var id = cb.value;
        if (!id) return;
        if (cb.checked) _sharedDocIds[id] = true;
        else delete _sharedDocIds[id];
      });
    });
  }

  function bindDocShareToolbar(host) {
    var btnFolder = host.querySelector('#phFormDocNewFolder');
    if (btnFolder) {
      btnFolder.addEventListener('click', function () {
        var name = prompt('Tên thư mục mới:');
        if (!name || !name.trim()) return;
        window.PhonghopServices.createLibraryFolder(name.trim(), _browseParentId)
          .then(function () { return loadDocBrowseFolder(_browseParentId, currentEditMeetingId()); })
          .catch(function (e) { alert(e.message || 'Không tạo được thư mục'); });
      });
    }

    var fileInput = host.querySelector('#phFormDocFileInput');
    if (fileInput) {
      fileInput.addEventListener('change', function () {
        var files = fileInput.files;
        if (!files || !files.length) return;
        var uploads = [];
        for (var j = 0; j < files.length; j++) {
          uploads.push(
            window.PhonghopServices.uploadLibraryDocument(files[j], _browseParentId)
          );
        }
        fileInput.value = '';
        Promise.all(uploads)
          .then(function (docs) {
            docs.forEach(function (d) {
              if (d && d.id) _sharedDocIds[d.id] = true;
            });
            return loadDocBrowseFolder(_browseParentId, currentEditMeetingId());
          })
          .catch(function (e) { alert(e.message || 'Upload thất bại'); });
      });
    }
  }

  function bindDocShareExplorer(host) {
    host.querySelectorAll('.ph-doc-share-crumb').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var fid = btn.getAttribute('data-folder');
        loadDocBrowseFolder(fid || null, currentEditMeetingId()).catch(function (e) {
          alert(e.message);
        });
      });
    });

    host.querySelectorAll('.ph-doc-share-item[data-kind="folder"]').forEach(function (row) {
      row.addEventListener('dblclick', function (e) {
        if (e.target.closest('.ph-doc-share-cb')) return;
        var fid = row.getAttribute('data-id');
        if (!fid) return;
        loadDocBrowseFolder(fid, currentEditMeetingId()).catch(function (err) {
          alert(err.message);
        });
      });
    });

    host.querySelectorAll('.ph-doc-share-item[data-kind="folder"] .ph-doc-share-name').forEach(function (el) {
      el.title = 'Double-click để mở thư mục';
    });
  }

  async function flushPendingUploads() {
    return [];
  }

  function renderDocShareHost(enabled, errMsg) {
    var host = document.getElementById('phDocShareHost');
    if (!host) return;
    if (!enabled) {
      host.innerHTML =
        '<p class="ph-detail-muted ph-doc-share-hint ph-doc-share-error">' +
          escHtml(errMsg || 'Không tải được kho tài liệu — thử tải lại trang (Ctrl+F5).') +
          (errMsg ? '' : ' Nếu vừa cập nhật code, cần deploy/restart server.') +
        '</p>';
      return;
    }

    var toolbar =
      '<div class="ph-doc-share-toolbar">' +
        '<label class="ph-doc-share-upload-label">↑ Tải file lên kho' +
          '<input type="file" id="phFormDocFileInput" hidden multiple ' +
          'accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.txt,.csv">' +
        '</label>' +
        '<button type="button" class="ph-btn" id="phFormDocNewFolder">+ Thư mục mới</button>' +
      '</div>';

    var crumbs = (_browseBreadcrumb || [{ id: '', name: 'Kho tài liệu' }]).map(function (b, idx) {
      var sep = idx ? '<span class="ph-doc-share-crumb-sep">›</span>' : '';
      return sep + '<button type="button" class="ph-doc-share-crumb" data-folder="' +
        escHtml(b.id || '') + '">' + escHtml(b.name || 'Kho tài liệu') + '</button>';
    }).join('');

    var rows = '';
    if (_folderDocs.length) {
      rows = _folderDocs.map(function (d) {
        var icon = d.kind === 'folder' ? '📁' : '📄';
        var checked = _sharedDocIds[d.id] ? ' checked' : '';
        var hint = d.kind === 'folder'
          ? ' <span class="ph-detail-muted">(double-click mở · tick = chia sẻ cả thư mục)</span>'
          : '';
        return (
          '<div class="ph-doc-share-item" data-id="' + escHtml(d.id) + '" data-kind="' + escHtml(d.kind) + '">' +
            '<label class="ph-doc-share-row">' +
              '<input type="checkbox" class="ph-doc-share-cb" value="' + escHtml(d.id) + '"' + checked + ' />' +
              '<span class="ph-doc-share-icon">' + icon + '</span>' +
              '<span class="ph-doc-share-name">' + escHtml(d.name) + hint + '</span>' +
            '</label>' +
          '</div>'
        );
      }).join('');
    } else {
      rows = '<p class="ph-detail-muted ph-doc-share-empty">Thư mục trống — tải file hoặc tạo thư mục mới.</p>';
    }

    host.innerHTML =
      '<div class="ph-doc-share-box">' +
        '<p class="ph-detail-muted ph-doc-share-hint">' +
          'Duyệt <strong>Kho tài liệu</strong> như Windows Explorer: double-click thư mục để mở, ' +
          'tick file/thư mục để chia sẻ cho cuộc họp này. ' +
          '<strong>Đã chọn ' + Object.keys(_sharedDocIds).filter(function (k) { return _sharedDocIds[k]; }).length +
          ' mục</strong> (giữ nguyên khi đổi thư mục).' +
        '</p>' +
        toolbar +
        '<div class="ph-doc-share-breadcrumb">' + crumbs + '</div>' +
        '<div class="ph-doc-share-explorer">' + rows + '</div>' +
      '</div>';
    bindDocShareToolbar(host);
    bindDocShareExplorer(host);
    bindDocShareCheckboxes(host);
  }

  function buildFields() {
    var roomOpts = [{ value: '', label: '— Không chọn —' }].concat(
      _rooms.map(function (r) {
        return { value: r.id, label: (r.room_code || '') + ' — ' + (r.name || '') };
      })
    );

    var start = new Date();
    start.setMinutes(0, 0, 0);
    start.setHours(start.getHours() + 1);

    return [
      { key: 'title', label: 'Tiêu đề cuộc họp', type: 'text', required: true },
      { key: 'description', label: 'Mô tả', type: 'textarea' },
      {
        key: 'meeting_mode', label: 'Hình thức', type: 'select', required: true,
        options: [
          { value: 'hybrid', label: 'Kết hợp (tại chỗ + online)' },
          { value: 'in_person', label: 'Tại chỗ' },
          { value: 'online', label: 'Trực tuyến nội bộ' }
        ],
        defaultValue: 'hybrid'
      },
      {
        key: 'platform_type', label: 'Nền tảng', type: 'select',
        options: [{ value: 'internal', label: 'Nội bộ (Firebase Realtime)' }],
        defaultValue: 'internal'
      },
      {
        key: 'physical_room_id', label: 'Phòng vật lý', type: 'select',
        options: roomOpts
      },
      {
        key: 'scheduled_start_date', label: 'Ngày bắt đầu', type: 'date',
        required: true, defaultValue: toLocalInputValue(start).slice(0, 10)
      },
      {
        key: 'scheduled_start_time', label: 'Giờ bắt đầu', type: 'time',
        required: true, defaultValue: toLocalInputValue(start).slice(11, 16)
      },
      {
        key: 'scheduled_end_date', label: 'Ngày kết thúc', type: 'date',
        required: true, defaultValue: toLocalInputValue(defaultEnd(start)).slice(0, 10)
      },
      {
        key: 'scheduled_end_time', label: 'Giờ kết thúc', type: 'time',
        required: true, defaultValue: toLocalInputValue(defaultEnd(start)).slice(11, 16)
      },
      {
        key: '_participants', label: 'Người tham dự', type: 'custom', full: true,
        html: '<div id="phParticipantsHost" class="ph-participants-host"></div>'
      },
      {
        key: '_doc_share', label: 'Tài liệu họp', type: 'custom', full: true,
        html: '<div id="phDocShareHost" class="ph-doc-share-host"></div>'
      }
    ];
  }

  function ensureModal() {
    if (_modal) return _modal;
    if (typeof ModalForm === 'undefined') {
      console.error('[MeetingForm] ModalForm chưa được nạp');
      return null;
    }

    _modal = ModalForm.create('phMeetingFormModal', {
      title: { create: 'Tạo cuộc họp mới', edit: 'Sửa cuộc họp' },
      maxWidth: '860px',
      fields: buildFields(),
      onOpen: function (editData) {
        _pendingParticipants = [];
        _pendingHostId = '';
        _pendingSecretaryId = '';
        if (editData && editData.participants) {
          _pendingParticipants = participantsFromMeeting({ participants: editData.participants });
        } else if (_editMeeting) {
          _pendingParticipants = participantsFromMeeting(_editMeeting);
        }
        setTimeout(function () {
          renderParticipantPicker();
          var mid = (editData && editData.id) ||
            (_editMeeting && (_editMeeting.id || _editMeeting.meeting_id)) ||
            null;
          loadDocShareSection(mid);
        }, 80);
      },
      onClose: function () {
        fullCleanup();
      },
      onSave: async function (data, editId) {
        var mode = data.meeting_mode || 'hybrid';
        if (mode !== 'online' && !data.physical_room_id) {
          throw new Error('Cuộc họp tại chỗ/hybrid cần chọn phòng vật lý');
        }
        var startIso = new Date(data.scheduled_start_date + 'T' + data.scheduled_start_time).toISOString();
        var endIso = new Date(data.scheduled_end_date + 'T' + data.scheduled_end_time).toISOString();
        var payload = {
          title: data.title,
          description: data.description || null,
          meeting_mode: mode,
          platform_type: data.platform_type || 'internal',
          scheduled_start: startIso,
          scheduled_end: endIso,
          physical_room_id: data.physical_room_id || null,
          participants: getSelectedParticipants()
        };
        var sharedIds = getSelectedSharedDocIds();
        if (editId) {
          payload.shared_document_ids = sharedIds;
          meeting = await window.PhonghopServices.updateMeeting(editId, payload);
        } else {
          payload.status = 'scheduled';
          payload.shared_document_ids = sharedIds;
          meeting = await window.PhonghopServices.createMeeting(payload);
        }
        if (typeof _onSaved === 'function') _onSaved(meeting);
        _editMeeting = null;
        return meeting;
      }
    });

    return _modal;
  }

  window.MeetingForm = {
    /**
     * @param {{ rooms, orgData, employees, currentUser, onSaved, reloadOrg, meeting }} opts
     */
    open: async function (opts) {
      opts = opts || {};
      _rooms = opts.rooms || [];
      _orgData = opts.orgData || { personnel: [], departments: [], teams: [] };
      _onSaved = opts.onSaved || null;
      _editMeeting = opts.meeting || null;
      _pendingParticipants = null;

      if (typeof opts.reloadOrg === 'function') {
        try {
          _orgData = await opts.reloadOrg();
        } catch (e) {
          console.warn('[MeetingForm] reloadOrg', e);
        }
      }

      if (_editMeeting && (_editMeeting.id || _editMeeting.meeting_id) &&
          (!_editMeeting.participants || !_editMeeting.participants.length)) {
        try {
          var fetchId = _editMeeting.id || _editMeeting.meeting_id;
          _editMeeting = await window.PhonghopServices.getMeeting(fetchId);
        } catch (e) {
          console.warn('[MeetingForm] getMeeting', e);
        }
      }

      if (_modal && _modal.destroy) {
        fullCleanup();
        _modal.destroy();
        _modal = null;
      }

      var modal = ensureModal();
      if (!modal) return;

      if (_editMeeting && (_editMeeting.id || _editMeeting.meeting_id)) {
        if (!_editMeeting.id && _editMeeting.meeting_id) _editMeeting.id = _editMeeting.meeting_id;
        var formData = meetingToFormData(_editMeeting);
        formData.participants = _editMeeting.participants || [];
        modal.open(formData);
      } else {
        modal.open();
      }

      cleanupEscapeHandler();
      _escapeHandler = function (e) {
        if (e.key === 'Escape' && modal.isOpen && modal.isOpen()) {
          fullCleanup();
        }
      };
      document.addEventListener('keydown', _escapeHandler);
    },

    destroy: function () {
      fullCleanup();
      if (_modal && _modal.destroy) {
        _modal.destroy();
        _modal = null;
      }
    }
  };
})();
