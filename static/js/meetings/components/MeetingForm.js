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

  function meetingToFormData(m) {
    var start = m.scheduled_start ? new Date(m.scheduled_start) : new Date();
    var end = m.scheduled_end ? new Date(m.scheduled_end) : defaultEnd(start);
    return {
      id: m.id,
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

  function participantsFromMeeting(m) {
    if (!m || !m.participants) return [];
    return m.participants.filter(function (p) {
      return p.participant_role !== 'organizer';
    }).map(function (p) {
      if (p.is_external) {
        return {
          is_external: true,
          external_name: p.external_name || p.display_name || '',
          external_email: p.external_email || null,
          participant_role: 'participant'
        };
      }
      return {
        employee_id: p.employee_id || null,
        username: p.username || null,
        participant_role: p.participant_role || 'participant',
        is_external: false
      };
    });
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
  }

  function renderParticipantPicker() {
    cleanupParticipantWidget();
    var host = document.getElementById('phParticipantsHost');
    if (!host || typeof ParticipantTreePicker === 'undefined') return;

    host.innerHTML = '<div id="phParticipantTreeHost"></div>';
    _treePicker = ParticipantTreePicker.create('phParticipantTreeHost', {
      orgData: _orgData,
      onChange: function () { /* tags render inside picker */ }
    });

    if (_treePicker && _pendingParticipants) {
      _treePicker.setParticipants(_pendingParticipants);
      _pendingParticipants = null;
    }
  }

  function getSelectedParticipants() {
    if (_treePicker && _treePicker.getParticipants) {
      return _treePicker.getParticipants();
    }
    return _pendingParticipants || [];
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
        if (editData && editData.participants) {
          _pendingParticipants = participantsFromMeeting({ participants: editData.participants });
        } else if (_editMeeting) {
          _pendingParticipants = participantsFromMeeting(_editMeeting);
        }
        setTimeout(renderParticipantPicker, 80);
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
        var meeting;
        if (editId) {
          meeting = await window.PhonghopServices.updateMeeting(editId, payload);
        } else {
          payload.status = 'scheduled';
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

      if (_editMeeting && _editMeeting.id && (!_editMeeting.participants || !_editMeeting.participants.length)) {
        try {
          _editMeeting = await window.PhonghopServices.getMeeting(_editMeeting.id);
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

      if (_editMeeting && _editMeeting.id) {
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
