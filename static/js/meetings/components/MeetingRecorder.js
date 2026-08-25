/**
 * MeetingRecorder.js — ghi âm phiên họp + ghi kết luận (STT trình duyệt / Whisper server)
 */
(function () {
  'use strict';

  var _meetingId = null;
  var _canRecord = false;
  var _recordings = [];
  var _mediaRecorder = null;
  var _mediaStream = null;
  var _chunks = [];
  var _recordingMode = null;
  var _startedAt = 0;
  var _timer = null;
  var _speech = null;
  var _speechText = '';
  var _speechInterim = '';
  var _uploading = false;

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function getHostEl() {
    return document.getElementById('phMeetingRecorderHost');
  }

  function fmtDuration(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function fmtSize(bytes) {
    bytes = Number(bytes) || 0;
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function speechSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  function getSpeechRecognition() {
    var Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    return Ctor ? new Ctor() : null;
  }

  function stopStream() {
    if (_mediaStream) {
      _mediaStream.getTracks().forEach(function (t) { t.stop(); });
      _mediaStream = null;
    }
  }

  function stopSpeech() {
    if (_speech) {
      try { _speech.stop(); } catch (_) { /* ignore */ }
      _speech = null;
    }
  }

  function clearTimer() {
    if (_timer) {
      clearInterval(_timer);
      _timer = null;
    }
  }

  function updateTimerUi() {
    var el = document.getElementById('phRecorderTimer');
    if (!el || !_startedAt) return;
    el.textContent = fmtDuration((Date.now() - _startedAt) / 1000);
  }

  function combinedSpeechText() {
    return (_speechText + ' ' + _speechInterim).trim();
  }

  function updateSpeechPreview() {
    var box = document.getElementById('phRecorderSpeechPreview');
    if (!box) return;
    var txt = combinedSpeechText();
    if (!txt) {
      box.hidden = true;
      box.textContent = '';
      return;
    }
    box.hidden = false;
    box.textContent = txt;
  }

  function setStatus(text, isError) {
    var el = document.getElementById('phRecorderStatus');
    if (!el) return;
    if (!text) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.textContent = text;
    el.classList.toggle('ph-recorder-status-err', !!isError);
  }

  function setBusy(busy, msg) {
    _uploading = busy;
    var host = getHostEl();
    if (!host) return;
    host.querySelectorAll('button').forEach(function (btn) {
      if (btn.id === 'phRecorderCopyLast') return;
      btn.disabled = !!busy || (_mediaRecorder && _mediaRecorder.state === 'recording');
    });
    if (busy && msg) setStatus(msg, false);
  }

  async function uploadBlob(blob, opts) {
    opts = opts || {};
    if (!window.PhonghopServices.uploadMeetingRecording) {
      throw new Error('Dịch vụ ghi âm chưa sẵn sàng');
    }
    return window.PhonghopServices.uploadMeetingRecording(_meetingId, blob, {
      type: opts.type || 'session',
      durationSec: opts.durationSec,
      transcript: opts.transcript || '',
      label: opts.label || '',
      mimeType: blob.type || 'audio/webm'
    });
  }

  async function finishRecording() {
    var mode = _recordingMode;
    var durationSec = _startedAt ? (Date.now() - _startedAt) / 1000 : 0;
    _recordingMode = null;
    _startedAt = 0;
    clearTimer();
    stopSpeech();

    var blob = _chunks.length
      ? new Blob(_chunks, { type: (_mediaRecorder && _mediaRecorder.mimeType) || 'audio/webm' })
      : null;
    _chunks = [];
    if (_mediaRecorder) {
      _mediaRecorder = null;
    }
    stopStream();
    render();

    if (!blob || !blob.size) {
      setStatus('Không có dữ liệu ghi âm', true);
      return;
    }

    var transcript = mode === 'conclusion' ? combinedSpeechText() : '';
    _speechText = '';
    _speechInterim = '';

    try {
      setBusy(true, mode === 'conclusion'
        ? 'Đang lưu kết luận và chuyển thành chữ…'
        : 'Đang tải file ghi âm lên server…');
      var saved = await uploadBlob(blob, {
        type: mode || 'session',
        durationSec: durationSec,
        transcript: transcript,
        label: mode === 'conclusion' ? 'Kết luận' : 'Ghi âm phiên họp'
      });
      if (window.PhonghopServices.showDocToast) {
        window.PhonghopServices.showDocToast(
          mode === 'conclusion'
            ? (saved.transcript
              ? 'Đã lưu kết luận — xem và copy bên dưới'
              : 'Đã lưu file ghi âm kết luận')
            : 'Đã lưu ghi âm phiên (' + fmtDuration(durationSec) + ')',
          7000
        );
      }
      if (window.MeetingRoom && window.MeetingRoom.refresh) {
        await window.MeetingRoom.refresh();
      }
      setStatus('');
    } catch (e) {
      setStatus(e.message || 'Không lưu được ghi âm', true);
    } finally {
      setBusy(false);
    }
  }

  async function startRecording(mode) {
    if (!_meetingId || !_canRecord || _mediaRecorder) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('Trình duyệt không hỗ trợ ghi âm — dùng Chrome hoặc Edge.');
      return;
    }

    try {
      _mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
    } catch (e) {
      alert('Không truy cập được micro — cho phép quyền micro rồi thử lại.');
      return;
    }

    _chunks = [];
    _recordingMode = mode;
    _startedAt = Date.now();
    _speechText = '';
    _speechInterim = '';

    var mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '');
    try {
      _mediaRecorder = mime
        ? new MediaRecorder(_mediaStream, { mimeType: mime, audioBitsPerSecond: 64000 })
        : new MediaRecorder(_mediaStream, { audioBitsPerSecond: 64000 });
    } catch (_) {
      _mediaRecorder = new MediaRecorder(_mediaStream);
    }

    _mediaRecorder.ondataavailable = function (ev) {
      if (ev.data && ev.data.size) _chunks.push(ev.data);
    };
    _mediaRecorder.onstop = function () {
      finishRecording();
    };
    _mediaRecorder.onerror = function () {
      setStatus('Lỗi ghi âm', true);
      stopSpeech();
      stopStream();
      _mediaRecorder = null;
      _recordingMode = null;
      render();
    };

    _mediaRecorder.start(5000);

    if (mode === 'conclusion' && speechSupported()) {
      _speech = getSpeechRecognition();
      if (_speech) {
        _speech.lang = 'vi-VN';
        _speech.continuous = true;
        _speech.interimResults = true;
        _speech.onresult = function (ev) {
          var interim = '';
          for (var i = ev.resultIndex; i < ev.results.length; i++) {
            var part = ev.results[i][0].transcript;
            if (ev.results[i].isFinal) {
              _speechText += part + ' ';
            } else {
              interim += part;
            }
          }
          _speechInterim = interim;
          updateSpeechPreview();
        };
        _speech.onerror = function () { /* vẫn có file audio */ };
        try { _speech.start(); } catch (_) { /* ignore */ }
      }
    }

    clearTimer();
    _timer = setInterval(updateTimerUi, 500);
    render();
    setStatus(
      mode === 'conclusion'
        ? 'Đang ghi kết luận — nói rõ vào micro. Bấm Dừng khi xong.'
        : 'Đang ghi âm phiên họp — Thư ký tổng hợp biên bản sau.',
      false
    );
  }

  function stopRecording() {
    if (!_mediaRecorder || _mediaRecorder.state === 'inactive') return;
    setBusy(true, 'Đang xử lý ghi âm…');
    try { _mediaRecorder.stop(); } catch (_) { finishRecording(); }
  }

  function buildRecordingsListHtml() {
    if (!_recordings.length) {
      return '<p class="ph-detail-muted ph-recorder-empty">Chưa có bản ghi âm nào trong phiên này.</p>';
    }
    return '<ul class="ph-recorder-list">' + _recordings.map(function (r) {
      var typeLabel = r.type === 'conclusion' ? 'Kết luận' : 'Phiên họp';
      var meta = typeLabel +
        (r.duration_sec ? ' · ' + fmtDuration(r.duration_sec) : '') +
        (r.size_bytes ? ' · ' + fmtSize(r.size_bytes) : '');
      var transcriptBlock = '';
      if (r.transcript) {
        transcriptBlock =
          '<pre class="ph-recorder-transcript" id="phRecTranscript_' + esc(r.id) + '">' +
            esc(r.transcript) + '</pre>' +
          '<button type="button" class="ph-btn ph-btn-sm ph-recorder-copy" data-rec-id="' +
            esc(r.id) + '">📋 Copy văn bản</button>';
      }
      return '<li class="ph-recorder-item">' +
        '<div class="ph-recorder-item-head">' +
          '<strong>' + esc(r.label || typeLabel) + '</strong>' +
          '<span class="ph-detail-muted">' + esc(meta) + '</span>' +
        '</div>' +
        '<div class="ph-recorder-item-actions">' +
          '<button type="button" class="ph-btn ph-btn-sm ph-recorder-dl" data-rec-id="' +
            esc(r.id) + '">⬇ Tải ghi âm</button>' +
        '</div>' +
        transcriptBlock +
      '</li>';
    }).join('') + '</ul>';
  }

  function bindEvents(host) {
    var startSession = host.querySelector('#phRecorderStartSession');
    var startConclusion = host.querySelector('#phRecorderStartConclusion');
    var stopBtn = host.querySelector('#phRecorderStop');
    if (startSession) {
      startSession.addEventListener('click', function () { startRecording('session'); });
    }
    if (startConclusion) {
      startConclusion.addEventListener('click', function () { startRecording('conclusion'); });
    }
    if (stopBtn) {
      stopBtn.addEventListener('click', stopRecording);
    }
    host.querySelectorAll('.ph-recorder-dl').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-rec-id');
        if (!id || !window.PhonghopServices.downloadMeetingRecording) return;
        btn.disabled = true;
        window.PhonghopServices.downloadMeetingRecording(_meetingId, id)
          .catch(function (e) { alert(e.message || 'Không tải được'); })
          .finally(function () { btn.disabled = false; });
      });
    });
    host.querySelectorAll('.ph-recorder-copy').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-rec-id');
        var pre = document.getElementById('phRecTranscript_' + id);
        if (!pre) return;
        navigator.clipboard.writeText(pre.textContent || '').then(function () {
          if (window.PhonghopServices.showDocToast) {
            window.PhonghopServices.showDocToast('Đã copy văn bản kết luận', 4000);
          }
        }).catch(function () {
          alert(pre.textContent);
        });
      });
    });
  }

  function render() {
    var host = getHostEl();
    if (!host || !_canRecord) return;

    var isRecording = !!(_mediaRecorder && _mediaRecorder.state === 'recording');
    var modeLabel = _recordingMode === 'conclusion' ? 'kết luận' : 'phiên họp';

    host.innerHTML =
      '<div class="ph-recorder-bar">' +
        '<div class="ph-recorder-header">' +
          '<h4 class="ph-recorder-title">Ghi âm biên bản</h4>' +
          '<p class="ph-detail-muted ph-recorder-lead">' +
            'Ghi âm toàn phiên để Thư ký tổng hợp biên bản sau. ' +
            'Riêng <strong>Kết luận</strong>: ghi ngắn + chuyển thành chữ ngay (miễn phí qua trình duyệt).' +
          '</p>' +
        '</div>' +
        (isRecording
          ? '<div class="ph-recorder-active">' +
              '<span class="ph-recorder-dot"></span>' +
              '<span>Đang ghi ' + esc(modeLabel) + ' — <strong id="phRecorderTimer">00:00</strong></span>' +
              '<button type="button" class="ph-btn ph-btn-danger ph-btn-sm" id="phRecorderStop">⏹ Dừng ghi</button>' +
            '</div>' +
            '<pre class="ph-recorder-speech-preview" id="phRecorderSpeechPreview" hidden></pre>'
          : '<div class="ph-recorder-actions">' +
              '<button type="button" class="ph-btn ph-btn-primary ph-btn-sm" id="phRecorderStartSession">' +
                '🎙 Ghi âm phiên họp</button>' +
              '<button type="button" class="ph-btn ph-btn-sm" id="phRecorderStartConclusion" title="Ghi ngắn lời kết luận">' +
                '📝 Ghi kết luận → chữ</button>' +
            '</div>') +
        '<p class="ph-recorder-status" id="phRecorderStatus" hidden></p>' +
        '<div class="ph-recorder-history">' +
          '<p class="ph-recorder-history-title">Bản ghi đã lưu</p>' +
          buildRecordingsListHtml() +
        '</div>' +
      '</div>';

    bindEvents(host);
    if (isRecording) updateTimerUi();
    updateSpeechPreview();
  }

  window.MeetingRecorder = {
    mount: function (meetingId, opts) {
      opts = opts || {};
      if (meetingId) _meetingId = meetingId;
      _canRecord = !!opts.canRecord;
      _recordings = opts.recordings || [];
      if (!_canRecord) {
        var host = getHostEl();
        if (host) host.innerHTML = '';
        return;
      }
      render();
    },

    syncFromRoom: function (meetingId, recordings, canRecord) {
      if (meetingId) _meetingId = meetingId;
      _canRecord = !!canRecord;
      _recordings = recordings || [];
      if (!_canRecord) {
        var host = getHostEl();
        if (host) host.innerHTML = '';
        return;
      }
      if (_mediaRecorder && _mediaRecorder.state === 'recording') return;
      if (_uploading) return;
      render();
    },

    isRecording: function () {
      return !!(_mediaRecorder && _mediaRecorder.state === 'recording');
    },

    cleanup: function () {
      if (_mediaRecorder && _mediaRecorder.state === 'recording') {
        try { _mediaRecorder.stop(); } catch (_) { /* ignore */ }
      }
      clearTimer();
      stopSpeech();
      stopStream();
      _mediaRecorder = null;
      _recordingMode = null;
      _meetingId = null;
      _canRecord = false;
      _recordings = [];
      var host = getHostEl();
      if (host) host.innerHTML = '';
    }
  };
})();
