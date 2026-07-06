/**
 * MeetingScreenShare.js — chia sẻ màn hình (duyệt chủ trì + WebRTC)
 */
(function () {
  'use strict';

  var ICE_SERVERS = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      {
        urls: [
          'turn:openrelay.metered.ca:80',
          'turn:openrelay.metered.ca:443',
          'turn:openrelay.metered.ca:443?transport=tcp'
        ],
        username: 'openrelayproject',
        credential: 'openrelayproject'
      }
    ],
    iceCandidatePoolSize: 4
  };

  var _meetingId = null;
  var _localStream = null;
  var _remoteStream = null;
  var _sharing = false;
  var _viewerMode = false;
  var _sharerUsername = '';
  var _signalSince = '';
  var _signalTimer = null;
  var _peers = {};
  var _processedSignalIds = {};
  var _isHost = false;
  var _isSecretary = false;
  var _canModerate = false;
  var _canApproveShare = false;
  var _myRequest = null;
  var _pendingHost = [];
  var _lastMineStatus = '';
  var _lastShareSyncKey = '';
  var _lastRequestsKey = '';
  var _viewerJoinSent = false;
  var _viewerRetryTimer = null;
  var _activeShareRemote = null;
  var _projectorMode = false;
  var _projectorVideo = null;
  var _projectorPoll = null;
  var _projectorWin = null;
  var _lastRolesKey = '';
  var _shareInactiveSince = 0;
  var SHARE_INACTIVE_GRACE_MS = 10000;
  var _pendingIce = {};
  var _viewerRetryCount = 0;
  var _lastOfferAt = {};
  var _lastPresence = [];
  var _lastAttendees = [];
  var _viewerConnectSince = 0;
  var _mirrorTimer = null;
  var _mirrorBroadcast = null;
  var _canvasMirrorRaf = 0;

  function username() {
    return window.PhonghopServices && window.PhonghopServices.username
      ? window.PhonghopServices.username()
      : '';
  }

  function viewerIdentity() {
    return _projectorMode ? peerKey(username()) + '__tv' : username();
  }

  function signalTargetForMe(msg) {
    var toUser = peerKey(msg.toUsername || msg.to_username || '');
    if (!toUser) return true;
    if (_projectorMode) return toUser === peerKey(username()) + '__tv';
    return toUser === peerKey(username());
  }

  function viewerKeyFromSignal(fromUser, payload) {
    if (payload && payload.viewerId) return peerKey(payload.viewerId);
    return peerKey(fromUser);
  }

  function peerConnectionBusy(pc) {
    if (!pc) return false;
    return pc.connectionState === 'connected' ||
      pc.connectionState === 'connecting' ||
      pc.connectionState === 'checking';
  }

  function sameUser(a, b) {
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function isHostRole(roomIsHost) {
    return !!roomIsHost;
  }

  function applySessionRoles(roomIsHost, opts) {
    opts = opts || {};
    _isHost = !!(opts.isHost !== undefined ? opts.isHost : roomIsHost);
    _isSecretary = !!opts.isSecretary;
    _canModerate = !!(opts.canModerate || _isHost || _isSecretary);
    if (opts.canApproveShare !== undefined) {
      _canApproveShare = !!opts.canApproveShare;
    } else {
      _canApproveShare = _isHost || _isSecretary;
    }
    if (_isHost || _isSecretary) {
      _canApproveShare = true;
    }
  }

  function rolesSyncKey() {
    return (_isHost ? 'H' : '') + (_isSecretary ? 'S' : '') + (_canApproveShare ? 'A' : '') +
      (_canModerate ? 'M' : '');
  }

  function hasToolbar() {
    if (_projectorMode) return !!_projectorVideo;
    var host = getHostEl();
    return !!(host && host.querySelector('.ph-screen-share-bar') &&
      !host.querySelector('.ph-screen-share-bar-loading'));
  }

  function getHostEl() {
    return document.getElementById('phScreenShareHost');
  }

  function getVideoEl() {
    if (_projectorVideo) return _projectorVideo;
    var host = getHostEl();
    return host ? host.querySelector('#phScreenShareVideo') : null;
  }

  function getStageEl() {
    if (_projectorMode) {
      return document.querySelector('.ph-screen-projector-root');
    }
    return document.getElementById('phScreenShareStage');
  }

  function shareSyncKey(screenShare) {
    if (!screenShare || !screenShare.active) return 'off';
    return 'on|' + (screenShare.sharer_username || '');
  }

  function requestsSyncKey(requests) {
    if (!requests) return '';
    var mine = requests.mine || {};
    var pending = (requests.pending || []).map(function (r) {
      return r.id + ':' + r.status;
    }).join(',');
    return pending + '|' + (mine.id || '') + ':' + (mine.status || '');
  }

  function stopLocalStream() {
    if (_localStream) {
      _localStream.getTracks().forEach(function (t) { t.stop(); });
      _localStream = null;
    }
  }

  function peerKey(name) {
    return String(name || '').trim().toLowerCase();
  }

  function signalFromUser(msg) {
    return msg.fromUsername || msg.from_username || '';
  }

  function queueIce(key, candidate) {
    if (!key || !candidate) return;
    if (!_pendingIce[key]) _pendingIce[key] = [];
    _pendingIce[key].push(candidate);
  }

  async function flushPendingIce(key, pc) {
    var list = _pendingIce[key] || [];
    _pendingIce[key] = [];
    for (var i = 0; i < list.length; i++) {
      try {
        await pc.addIceCandidate(list[i]);
      } catch (e) {
        console.warn('[MeetingScreenShare] flushPendingIce', e.message || e);
      }
    }
  }

  async function addIceCandidateSafe(pc, key, payload) {
    if (!pc || !payload) return;
    var candidate = iceFromPayload(payload);
    if (!candidate || !candidate.candidate) return;
    if (!pc.remoteDescription || !pc.remoteDescription.type) {
      queueIce(key, candidate);
      return;
    }
    try {
      await pc.addIceCandidate(candidate);
    } catch (e) {
      queueIce(key, candidate);
    }
  }

  function resetViewerPeer(sharerUsername) {
    var key = peerKey(sharerUsername);
    if (_peers[key]) {
      try { _peers[key].close(); } catch (_) { /* ignore */ }
      delete _peers[key];
    }
    delete _pendingIce[key];
  }

  function closeAllPeers() {
    Object.keys(_peers).forEach(function (key) {
      try { _peers[key].close(); } catch (_) { /* ignore */ }
    });
    _peers = {};
    _pendingIce = {};
  }

  function stopSignalPoll() {
    if (_signalTimer) {
      clearInterval(_signalTimer);
      _signalTimer = null;
    }
  }

  function stopViewerRetry() {
    if (_viewerRetryTimer) {
      clearInterval(_viewerRetryTimer);
      _viewerRetryTimer = null;
    }
  }

  function startViewerRetry() {
    stopViewerRetry();
    _viewerRetryCount = 0;
    _viewerRetryTimer = setInterval(function () {
      if (!_viewerMode || _sharing || _remoteStream || !_sharerUsername) {
        stopViewerRetry();
        return;
      }
      _viewerRetryCount += 1;
      if (_viewerRetryCount % 3 === 0) {
        resetViewerPeer(_sharerUsername);
        ensurePeer(_sharerUsername, true);
      }
      sendViewerJoin();
    }, 2500);
  }

  function collectOnlineUsernames(presence, attendees) {
    var map = {};
    (presence || []).forEach(function (p) {
      if (p && p.username) map[peerKey(p.username)] = p.username;
    });
    (attendees || []).forEach(function (a) {
      if (a && a.online && a.username) map[peerKey(a.username)] = a.username;
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  async function ensureOffersForOnlineViewers(presence, attendees) {
    if (!_sharing || !_localStream) return;
    var viewers = collectOnlineUsernames(presence, attendees);
    var targets = [];
    viewers.forEach(function (viewerUser) {
      if (sameUser(viewerUser, username())) return;
      targets.push(viewerUser);
      targets.push(peerKey(viewerUser) + '__tv');
    });
    var now = Date.now();
    for (var i = 0; i < targets.length; i++) {
      var viewerUser = targets[i];
      var key = peerKey(viewerUser);
      var pc = _peers[key];
      if (peerConnectionBusy(pc)) continue;
      if (_lastOfferAt[key] && now - _lastOfferAt[key] < 2800) continue;
      _lastOfferAt[key] = now;
      await createOfferForViewer(viewerUser);
    }
  }

  function storeRoomPresence(roleOpts) {
    roleOpts = roleOpts || {};
    if (roleOpts.presence) _lastPresence = roleOpts.presence;
    if (roleOpts.attendees) _lastAttendees = roleOpts.attendees;
  }

  function markSignal(id) {
    if (!id) return;
    _processedSignalIds[id] = true;
    var keys = Object.keys(_processedSignalIds);
    if (keys.length > 300) {
      keys.slice(0, keys.length - 200).forEach(function (k) {
        delete _processedSignalIds[k];
      });
    }
  }

  function attachVideoStream() {
    var video = getVideoEl();
    if (!video) return;
    if (_sharing && _localStream) {
      if (video.srcObject !== _localStream) {
        video.srcObject = _localStream;
      }
      video.muted = true;
      video.hidden = false;
      var ph = document.getElementById('phScreenSharePlaceholder');
      if (ph) ph.hidden = true;
      video.play().catch(function () { /* ignore */ });
      return;
    }
    if (_viewerMode && _remoteStream) {
      if (video.srcObject !== _remoteStream) {
        video.srcObject = _remoteStream;
      }
      video.muted = true;
      video.hidden = false;
      var ph2 = document.getElementById('phScreenSharePlaceholder');
      if (ph2) ph2.hidden = true;
      video.play().catch(function () { /* ignore */ });
      return;
    }
    if (!_sharing && !_viewerMode) {
      video.srcObject = null;
      video.hidden = true;
    }
    syncStageOverlay();
    if (_projectorMode) updateProjectorStatus(_activeShareRemote);
    else pingProjectorMirror();
  }

  function hasVisibleStream() {
    if (_projectorMode) {
      if (_canvasMirrorRaf) return true;
      if (_projectorVideo && _projectorVideo.srcObject) {
        var tracks = _projectorVideo.srcObject.getVideoTracks();
        if (tracks.length && tracks[0].readyState === 'live') return true;
      }
    }
    return !!(_sharing && _localStream) || !!(_viewerMode && _remoteStream);
  }

  function getDisplayStreamRef() {
    if (_sharing && _localStream) return _localStream;
    if (_remoteStream) return _remoteStream;
    if (!_projectorMode) {
      try {
        var v = document.getElementById('phScreenShareVideo');
        if (v && v.srcObject && v.srcObject.getVideoTracks().length) return v.srcObject;
      } catch (_) { /* ignore */ }
    }
    return null;
  }

  function getOpenerShareVideo() {
    if (!window.opener || window.opener.closed) return null;
    try {
      return window.opener.document.getElementById('phScreenShareVideo');
    } catch (_) {
      return null;
    }
  }

  function resolveStreamFromOpener() {
    var srcV = getOpenerShareVideo();
    if (srcV && srcV.srcObject && srcV.srcObject.getVideoTracks().length) {
      var t = srcV.srcObject.getVideoTracks()[0];
      if (t.readyState === 'live') return srcV.srcObject;
    }
    try {
      if (window.opener && !window.opener.closed && window.opener.MeetingScreenShare) {
        return window.opener.MeetingScreenShare.getDisplayStream();
      }
    } catch (_) { /* ignore */ }
    return null;
  }

  function stopCanvasMirror() {
    if (_canvasMirrorRaf) {
      cancelAnimationFrame(_canvasMirrorRaf);
      _canvasMirrorRaf = 0;
    }
    var c = document.getElementById('phProjectorMirrorCanvas');
    if (c) c.remove();
    if (_projectorVideo) _projectorVideo.hidden = false;
  }

  function applyStreamToProjector(stream) {
    if (!stream || !stream.getVideoTracks().length) return false;
    var video = _projectorVideo;
    if (!video) return false;
    stopCanvasMirror();
    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }
    video.muted = true;
    video.hidden = false;
    video.play().catch(function () { /* ignore */ });
    return true;
  }

  function startCanvasMirrorFromOpener() {
    var srcV = getOpenerShareVideo();
    if (!srcV || srcV.readyState < 2 || !srcV.videoWidth) return false;
    stopCanvasMirror();
    var canvas = document.createElement('canvas');
    canvas.id = 'phProjectorMirrorCanvas';
    canvas.className = 'ph-screen-projector-video';
    canvas.width = srcV.videoWidth;
    canvas.height = srcV.videoHeight;
    var root = document.getElementById('phScreenProjectorRoot');
    if (_projectorVideo) {
      _projectorVideo.hidden = true;
      _projectorVideo.srcObject = null;
    }
    if (root) root.insertBefore(canvas, root.firstChild);

    function frame() {
      if (!_projectorMode || !window.opener || window.opener.closed) {
        stopCanvasMirror();
        return;
      }
      try {
        var s = getOpenerShareVideo();
        if (!s || s.readyState < 2 || !s.videoWidth) {
          _canvasMirrorRaf = requestAnimationFrame(frame);
          return;
        }
        if (canvas.width !== s.videoWidth) {
          canvas.width = s.videoWidth;
          canvas.height = s.videoHeight;
        }
        canvas.getContext('2d').drawImage(s, 0, 0);
      } catch (_) { /* ignore */ }
      _canvasMirrorRaf = requestAnimationFrame(frame);
    }
    _canvasMirrorRaf = requestAnimationFrame(frame);
    return true;
  }

  /** TV = mirror nội dung video đang hiện trên laptop (cùng Chrome) */
  function mirrorStreamFromOpener() {
    if (!window.opener || window.opener.closed) return false;
    var stream = resolveStreamFromOpener();
    if (stream && applyStreamToProjector(stream)) return true;
    return startCanvasMirrorFromOpener();
  }

  function pingProjectorMirror() {
    if (_projectorMode || !_meetingId) return;
    try {
      if (!_mirrorBroadcast) {
        _mirrorBroadcast = new BroadcastChannel('ph-screen-mirror-' + _meetingId);
      }
      _mirrorBroadcast.postMessage({ type: 'sync' });
    } catch (_) { /* ignore */ }
    if (_projectorWin && !_projectorWin.closed) {
      try {
        _projectorWin.postMessage({ type: 'ph-mirror-pull' }, window.location.origin);
      } catch (_) { /* ignore */ }
    }
  }

  function showProjectorWaiting(activeShare) {
    if (!_projectorMode || hasVisibleStream()) return;
    var st = document.getElementById('phScreenProjectorStatus');
    if (!st) return;
    st.hidden = false;
    if (!window.opener || window.opener.closed) {
      st.textContent = 'Bấm «Màn chiếu TV» từ tab phiên họp (giữ tab laptop mở).';
      return;
    }
    if (!activeShare || !activeShare.active) {
      st.textContent = 'Đang chờ ai đó chia sẻ màn hình trong phiên…';
      return;
    }
    st.textContent = 'Đang đồng bộ từ màn hình laptop…';
  }

  function startMirrorPoll() {
    if (_mirrorTimer) return;
    _mirrorTimer = setInterval(function () {
      if (!_projectorMode) return;
      if (mirrorStreamFromOpener()) {
        updateProjectorStatus(_activeShareRemote);
        syncStageOverlay();
      }
    }, 400);
  }

  function stopMirrorPoll() {
    if (_mirrorTimer) {
      clearInterval(_mirrorTimer);
      _mirrorTimer = null;
    }
  }

  function bindProjectorMirrorChannel(meetingId) {
    try {
      var bc = new BroadcastChannel('ph-screen-mirror-' + meetingId);
      bc.onmessage = function () {
        if (mirrorStreamFromOpener()) {
          updateProjectorStatus(_activeShareRemote);
          syncStageOverlay();
        }
      };
      window.addEventListener('message', function (ev) {
        if (ev.origin !== window.location.origin) return;
        if (!ev.data || ev.data.type !== 'ph-mirror-pull') return;
        if (mirrorStreamFromOpener()) {
          updateProjectorStatus(_activeShareRemote);
          syncStageOverlay();
        }
      });
    } catch (_) { /* ignore */ }
  }

  function syncStageOverlay() {
    var stage = getStageEl();
    if (!stage) return;
    var on = hasVisibleStream();
    stage.classList.toggle('has-stream', on);
    var pfs = document.getElementById('phScreenProjectorFullscreen');
    if (pfs) pfs.hidden = !on;
  }

  function toggleStageFullscreen() {
    var stage = getStageEl();
    if (!stage) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(function () { /* ignore */ });
      return;
    }
    var req = stage.requestFullscreen();
    if (req && req.catch) {
      req.catch(function () {
        var video = getVideoEl();
        if (video && video.requestFullscreen) video.requestFullscreen();
      });
    }
  }

  function projectorUrl() {
    return '/phonghop/screen?meeting=' + encodeURIComponent(_meetingId || '') +
      '&username=' + encodeURIComponent(username());
  }

  function pauseLocalViewerForProjector() {
    /* Giữ kết nối trên laptop — TV dùng viewerId riêng (__tv) */
  }

  function openProjectorWindow() {
    if (!_meetingId) return;
    if (_projectorWin && !_projectorWin.closed) {
      _projectorWin.focus();
      return _projectorWin;
    }
    _projectorWin = window.open(
      projectorUrl(),
      'phMeetingScreen',
      'width=1280,height=720,menubar=no,toolbar=no,location=no,status=no'
    );
    if (!_projectorWin) {
      alert('Trình duyệt chặn cửa sổ mới. Cho phép popup rồi bấm «Màn chiếu TV» lại.');
      return null;
    }
    var watchClose = setInterval(function () {
      if (!_projectorWin || _projectorWin.closed) {
        clearInterval(watchClose);
        _projectorWin = null;
        if (_activeShareRemote && _activeShareRemote.active && !_sharing && !_projectorMode) {
          joinAsViewer(_activeShareRemote);
        }
      }
    }, 1500);
    return _projectorWin;
  }

  function closeProjectorWindow() {
    if (_projectorWin && !_projectorWin.closed) {
      try { _projectorWin.close(); } catch (_) { /* ignore */ }
    }
    _projectorWin = null;
  }

  function updateProjectorStatus(activeShare) {
    if (!_projectorMode) return;
    var st = document.getElementById('phScreenProjectorStatus');
    var video = _projectorVideo;
    if (!st) return;
    if (hasVisibleStream()) {
      st.hidden = true;
      if (video) {
        video.hidden = false;
        var fsBtn = document.getElementById('phScreenProjectorFullscreen');
        if (fsBtn) fsBtn.hidden = false;
      }
      var root = document.querySelector('.ph-screen-projector-root');
      if (root) root.classList.add('has-stream');
      return;
    }
    var rootOff = document.querySelector('.ph-screen-projector-root');
    if (rootOff) rootOff.classList.remove('has-stream');
    st.hidden = false;
    if (video) {
      video.hidden = true;
      video.srcObject = null;
    }
    if (!activeShare || !activeShare.active) {
      st.textContent = 'Đang chờ ai đó chia sẻ màn hình trong phiên…';
    } else {
      st.textContent = 'Đang kết nối từ ' +
        (activeShare.sharer_name || activeShare.sharer_username) + '…';
    }
  }

  function buildHostTvHint() {
    if (!_canModerate || _projectorMode) return '';
    return '<p class="ph-screen-share-host-hint ph-detail-muted">' +
      '<strong>Chế độ 2 màn hình:</strong> Bấm «Màn chiếu TV» → kéo cửa sổ sang TV/máy chiếu (HDMI) → ' +
      '<kbd>F11</kbd>. Laptop giữ chat, duyệt chia sẻ và điều khiển phiên.</p>';
  }

  function buildExtraActions(activeShare) {
    var html = '';
    if (!_projectorMode) {
      html += '<button type="button" class="ph-btn ph-btn-sm ph-screen-share-fs-action" ' +
        'id="phScreenShareFullscreen" title="Toàn màn hình (Esc thoát)">⛶ Toàn màn hình</button>';
    }
    if (_canModerate && !_projectorMode) {
      html += '<button type="button" class="ph-btn ph-btn-sm ph-btn-primary" ' +
        'id="phScreenShareTv" title="Cửa sổ riêng kéo sang TV">🖥 Màn chiếu TV</button>';
    }
    return html;
  }

  function setViewerStatus(text, isError) {
    var el = document.getElementById('phScreenShareViewerStatus');
    if (!el) return;
    if (!text) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.textContent = text;
    el.classList.toggle('ph-screen-share-viewer-err', !!isError);
  }

  async function apiSignal(type, payload, toUsername) {
    if (!_meetingId || !window.PhonghopServices.postScreenShareSignal) return null;
    return window.PhonghopServices.postScreenShareSignal(_meetingId, type, payload, toUsername);
  }

  async function pollSignals() {
    if (!_meetingId || !window.PhonghopServices.fetchScreenShareSignals) return;
    try {
      var signals = await window.PhonghopServices.fetchScreenShareSignals(_meetingId, _signalSince);
      for (var i = 0; i < signals.length; i++) {
        var msg = signals[i];
        if (!msg || !msg.id || _processedSignalIds[msg.id]) continue;
        if (!signalTargetForMe(msg)) continue;
        markSignal(msg.id);
        if (msg.at && msg.at > _signalSince) _signalSince = msg.at;
        await handleSignal(msg);
      }
      if (_sharing && _localStream) {
        await ensureOffersForOnlineViewers(_lastPresence, _lastAttendees);
      }
    } catch (e) {
      console.warn('[MeetingScreenShare] pollSignals', e.message || e);
    }
  }

  function startSignalPoll() {
    stopSignalPoll();
    _signalTimer = setInterval(pollSignals, 700);
    pollSignals();
  }

  function iceFromPayload(payload) {
    if (!payload) return null;
    var raw = Object.assign({}, payload);
    delete raw.viewerId;
    if (raw.candidate && typeof raw.candidate === 'object') {
      return new RTCIceCandidate(raw.candidate);
    }
    return new RTCIceCandidate({
      candidate: raw.candidate,
      sdpMid: raw.sdpMid,
      sdpMLineIndex: raw.sdpMLineIndex
    });
  }

  function bindPeerTracks(pc, remoteUsername) {
    pc.ontrack = function (ev) {
      if (!ev.streams || !ev.streams[0]) return;
      _remoteStream = ev.streams[0];
      attachVideoStream();
      setViewerStatus('');
    };
  }

  function ensurePeer(remoteUsername, asViewer) {
    var key = peerKey(remoteUsername);
    if (_peers[key]) return _peers[key];

    var pc = new RTCPeerConnection(ICE_SERVERS);
    _peers[key] = pc;

    if (_localStream && !asViewer) {
      _localStream.getTracks().forEach(function (track) {
        pc.addTrack(track, _localStream);
      });
    }

    if (asViewer) {
      pc.ontrack = function (ev) {
        var stream = (ev.streams && ev.streams[0]) || null;
        if (!stream && ev.track) {
          stream = new MediaStream([ev.track]);
        }
        if (!stream) return;
        _remoteStream = stream;
        attachVideoStream();
        setViewerStatus('');
        stopViewerRetry();
        _viewerConnectSince = 0;
        updateViewerPlaceholder(_activeShareRemote);
        if (_projectorMode) updateProjectorStatus(_activeShareRemote);
        syncStageOverlay();
      };
    }

    pc.onicecandidate = function (ev) {
      if (!ev.candidate) return;
      var c = ev.candidate.toJSON ? ev.candidate.toJSON() : {
        candidate: ev.candidate.candidate,
        sdpMid: ev.candidate.sdpMid,
        sdpMLineIndex: ev.candidate.sdpMLineIndex
      };
      if (asViewer) c.viewerId = viewerIdentity();
      apiSignal('ice', c, remoteUsername);
    };

    pc.onconnectionstatechange = function () {
      var st = pc.connectionState;
      if (st === 'connected') {
        setViewerStatus('');
      } else if (st === 'failed') {
        setViewerStatus('Mất kết nối video — đang thử lại…', true);
        _viewerJoinSent = false;
        if (_viewerMode && _sharerUsername) {
          setTimeout(function () { sendViewerJoin(); }, 1200);
        }
      } else if (st === 'closed') {
        delete _peers[key];
      }
    };

    return pc;
  }

  async function createOfferForViewer(viewerUsername) {
    if (!_sharing || !_localStream) return;
    var key = peerKey(viewerUsername);
    var existing = _peers[key];
    if (existing) {
      if (existing.connectionState === 'connected') return;
      try { existing.close(); } catch (_) { /* ignore */ }
      delete _peers[key];
      delete _pendingIce[key];
    }
    var pc = ensurePeer(viewerUsername, false);
    try {
      var offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await apiSignal('offer', { sdp: offer.sdp, type: offer.type }, viewerUsername);
    } catch (e) {
      console.warn('[MeetingScreenShare] createOffer', e);
    }
  }

  async function handleSignal(msg) {
    var fromUser = signalFromUser(msg);
    var type = msg.type;
    var payload = msg.payload || {};

    if (type === 'join' && _sharing) {
      var viewerUser = (payload && payload.viewer) ? payload.viewer : fromUser;
      if (viewerUser && !sameUser(viewerUser, username())) {
        await createOfferForViewer(viewerUser);
      }
      return;
    }

    if (_sharing) {
      if (type === 'answer' && !sameUser(fromUser, username())) {
        var vk = viewerKeyFromSignal(fromUser, payload);
        var pcA = _peers[vk];
        if (pcA && payload.sdp) {
          await pcA.setRemoteDescription(new RTCSessionDescription(payload));
          await flushPendingIce(vk, pcA);
        }
        return;
      }
      if (type === 'ice' && !sameUser(fromUser, username())) {
        var vkI = viewerKeyFromSignal(fromUser, payload);
        var pcI = _peers[vkI];
        if (pcI) {
          await addIceCandidateSafe(pcI, vkI, payload);
        }
        return;
      }
    }

    if (_viewerMode && sameUser(_sharerUsername, fromUser)) {
      if (type === 'offer' && payload.sdp) {
        var peerK = peerKey(fromUser);
        var existing = _peers[peerK];
        if (existing && existing.signalingState !== 'stable') {
          try { existing.close(); } catch (_) { /* ignore */ }
          delete _peers[peerK];
          delete _pendingIce[peerK];
        }
        var pcV = ensurePeer(fromUser, true);
        await pcV.setRemoteDescription(new RTCSessionDescription(payload));
        await flushPendingIce(peerK, pcV);
        var answer = await pcV.createAnswer();
        await pcV.setLocalDescription(answer);
        await apiSignal('answer', {
          sdp: answer.sdp,
          type: answer.type,
          viewerId: viewerIdentity()
        }, fromUser);
        return;
      }
      if (type === 'ice' && payload.candidate) {
        var pcVi = _peers[peerKey(fromUser)];
        if (!pcVi) pcVi = ensurePeer(fromUser, true);
        await addIceCandidateSafe(pcVi, peerKey(fromUser), payload);
      }
    }
  }

  function buildHostApprovalHtml() {
    if (!_canApproveShare || !_pendingHost.length) return '';
    var someoneSharing = _activeShareRemote && _activeShareRemote.active;
    var hint = someoneSharing
      ? '<p class="ph-screen-share-queue-hint ph-detail-muted">' +
        'Chọn người trong hàng chờ để chuyển màn hình — người đang phát sẽ bị dừng.</p>'
      : '';
    var approveLabel = someoneSharing ? 'Chuyển sang phát' : 'Cho phép';
    return '<div class="ph-screen-share-approvals">' +
      '<p class="ph-screen-share-queue-title">Danh sách chờ chia sẻ (' + _pendingHost.length + ')</p>' +
      hint +
      _pendingHost.map(function (req) {
        return '<div class="ph-screen-share-approval-card" data-req-id="' + esc(req.id) + '">' +
          '<p><strong>' + esc(req.requester_name || req.requester_username) + '</strong> muốn chia sẻ màn hình</p>' +
          '<div class="ph-screen-share-approval-actions">' +
            '<button type="button" class="ph-btn ph-btn-primary ph-btn-sm ph-share-approve" data-id="' +
              esc(req.id) + '">' + approveLabel + '</button>' +
            '<button type="button" class="ph-btn ph-btn-sm ph-share-deny" data-id="' +
              esc(req.id) + '">Từ chối</button>' +
          '</div></div>';
      }).join('') +
      '</div>';
  }

  function buildParticipantActions(activeShare) {
    var mine = activeShare && sameUser(activeShare.sharer_username, username());
    var someoneElse = activeShare && activeShare.active && !mine;

    if (mine && activeShare && activeShare.active && !_sharing) {
      return '<span class="ph-screen-share-status ph-screen-share-wait">' +
        '⚠ Mất luồng video — bấm «Tiếp tục chia sẻ» để mọi người xem lại</span>' +
        '<button type="button" class="ph-btn ph-btn-primary ph-btn-sm" id="phScreenShareResume">' +
        '🖥 Tiếp tục chia sẻ</button>' +
        '<button type="button" class="ph-btn ph-btn-danger ph-btn-sm" id="phScreenShareStopOrphan">' +
        'Dừng phát</button>' + buildExtraActions(activeShare);
    }

    if (_sharing) {
      return '<button type="button" class="ph-btn ph-btn-danger ph-btn-sm" id="phScreenShareStop">' +
        '⏹ Dừng chia sẻ</button>' + buildExtraActions(activeShare);
    }

    if (someoneElse) {
      var html = '<span class="ph-screen-share-status">' +
        esc(activeShare.sharer_name || activeShare.sharer_username) +
        ' đang chia sẻ màn hình</span>';
      if (_canModerate) {
        html += '<button type="button" class="ph-btn ph-btn-danger ph-btn-sm" id="phScreenShareStopRemote">' +
          '⏹ Dừng chia sẻ</button>';
      }
      if (_canApproveShare) {
        html += '<button type="button" class="ph-btn ph-btn-primary ph-btn-sm" id="phScreenShareStart">' +
          '🖥 Chia sẻ màn hình của tôi</button>';
      }
      return html + buildExtraActions(activeShare);
    }

    if (_canApproveShare) {
      return '<button type="button" class="ph-btn ph-btn-primary ph-btn-sm" id="phScreenShareStart">' +
        '🖥 Chia sẻ màn hình</button>' + buildExtraActions(activeShare);
    }

    if (!_canApproveShare) {
      var st = (_myRequest && _myRequest.status) ? _myRequest.status.toLowerCase() : '';
      if (st === 'pending') {
        return '<span class="ph-screen-share-status ph-screen-share-wait">' +
          '⏳ Đang chờ chủ trì duyệt yêu cầu chia sẻ…</span>';
      }
      if (st === 'approved') {
        return '<button type="button" class="ph-btn ph-btn-primary ph-btn-sm" id="phScreenShareStartApproved">' +
          '🖥 Bắt đầu chia sẻ (đã được duyệt)</button>' + buildExtraActions(activeShare);
      }
      if (st === 'denied') {
        return '<span class="ph-screen-share-status ph-screen-share-denied">Chủ trì đã từ chối. </span>' +
          '<button type="button" class="ph-btn ph-btn-sm" id="phScreenShareRequest">Xin chia sẻ lại</button>' +
          buildExtraActions(activeShare);
      }
      return '<button type="button" class="ph-btn ph-btn-sm" id="phScreenShareRequest">' +
        '🙋 Xin chia sẻ màn hình</button>' + buildExtraActions(activeShare);
    }

    return buildExtraActions(activeShare);
  }

  function bindToolbarEvents(host) {
    var startBtn = host.querySelector('#phScreenShareStart');
    var startApprovedBtn = host.querySelector('#phScreenShareStartApproved');
    var requestBtn = host.querySelector('#phScreenShareRequest');
    var stopBtn = host.querySelector('#phScreenShareStop');
    var stopRemoteBtn = host.querySelector('#phScreenShareStopRemote');
    var resumeBtn = host.querySelector('#phScreenShareResume');
    var stopOrphanBtn = host.querySelector('#phScreenShareStopOrphan');
    var fsBtn = host.querySelector('#phScreenShareFullscreen');
    var tvBtn = host.querySelector('#phScreenShareTv');
    if (startBtn) startBtn.addEventListener('click', startShare);
    if (startApprovedBtn) startApprovedBtn.addEventListener('click', startShare);
    if (requestBtn) requestBtn.addEventListener('click', requestShare);
    if (stopBtn) stopBtn.addEventListener('click', stopShare);
    if (stopRemoteBtn) stopRemoteBtn.addEventListener('click', stopRemoteShare);
    if (resumeBtn) resumeBtn.addEventListener('click', startShare);
    if (stopOrphanBtn) stopOrphanBtn.addEventListener('click', stopOrphanShare);
    if (fsBtn && !fsBtn.dataset.bound) {
      fsBtn.dataset.bound = '1';
      fsBtn.addEventListener('click', toggleStageFullscreen);
    }
    if (tvBtn && !tvBtn.dataset.bound) {
      tvBtn.dataset.bound = '1';
      tvBtn.addEventListener('click', openProjectorWindow);
    }
    host.querySelectorAll('.ph-share-approve').forEach(function (btn) {
      btn.addEventListener('click', function () {
        approveRequest(btn.getAttribute('data-id'));
      });
    });
    host.querySelectorAll('.ph-share-deny').forEach(function (btn) {
      btn.addEventListener('click', function () {
        denyRequest(btn.getAttribute('data-id'));
      });
    });
  }

  function updateViewerPlaceholder(activeShare) {
    var ph = document.getElementById('phScreenSharePlaceholder');
    if (!ph) return;
    var someoneElse = activeShare && activeShare.active &&
      !sameUser(activeShare.sharer_username, username());
    if (_sharing) {
      ph.textContent = 'Đang chia sẻ màn hình của bạn — chọn cửa sổ Word/Excel khi bắt đầu share.';
      ph.hidden = true;
      return;
    }
    if (someoneElse) {
      var waitSec = _viewerConnectSince ? Math.floor((Date.now() - _viewerConnectSince) / 1000) : 0;
      if (!_remoteStream && waitSec > 12) {
        ph.textContent = 'Chưa nhận được video — yêu cầu ' +
          (activeShare.sharer_name || activeShare.sharer_username) +
          ' bấm «Tiếp tục chia sẻ» hoặc chia sẻ lại.';
      } else {
        ph.textContent = 'Đang kết nối video từ ' +
          (activeShare.sharer_name || activeShare.sharer_username) + '…';
      }
      ph.hidden = !!_remoteStream;
      return;
    }
    ph.hidden = false;
  }

  function updateToolbarParts(activeShare) {
    if (_projectorMode) return false;
    var host = getHostEl();
    if (!host) return false;

    var bar = host.querySelector('.ph-screen-share-bar');
    if (!bar || !host.querySelector('#phScreenShareVideo')) return false;

    _activeShareRemote = activeShare;

    var approvals = host.querySelector('.ph-screen-share-approvals');
    var approvalsHtml = buildHostApprovalHtml();
    if (approvalsHtml) {
      if (approvals) {
        approvals.outerHTML = approvalsHtml;
      } else {
        bar.insertAdjacentHTML('afterbegin', approvalsHtml);
      }
    } else if (approvals) {
      approvals.remove();
    }

    var actions = host.querySelector('.ph-screen-share-actions');
    if (actions) {
      actions.innerHTML = buildParticipantActions(activeShare);
    }

    bindToolbarEvents(host);
    bindStageOverlayEvents(host);
    updateViewerPlaceholder(activeShare);
    attachVideoStream();
    return true;
  }

  function buildStageInnerHtml(activeShare) {
    return '<video id="phScreenShareVideo" class="ph-screen-share-video" autoplay playsinline muted></video>' +
      '<button type="button" class="ph-screen-share-fs-btn" id="phScreenShareFullscreenOverlay" ' +
        'title="Toàn màn hình (Esc thoát)" aria-label="Toàn màn hình">⛶</button>' +
      '<p class="ph-detail-muted ph-screen-share-placeholder" id="phScreenSharePlaceholder">' +
        (_sharing
          ? 'Đang chia sẻ màn hình của bạn…'
          : (_viewerMode
            ? 'Đang kết nối video từ người chia sẻ…'
            : 'Chưa có ai chia sẻ — bấm nút phía trên để bắt đầu hoặc xin phép.')) +
      '</p>' +
      '<p class="ph-screen-share-viewer-status" id="phScreenShareViewerStatus" hidden></p>';
  }

  function bindStageOverlayEvents(host) {
    var overlayFs = host.querySelector('#phScreenShareFullscreenOverlay');
    if (overlayFs && !overlayFs.dataset.bound) {
      overlayFs.dataset.bound = '1';
      overlayFs.addEventListener('click', toggleStageFullscreen);
    }
  }

  function ensureToolbarVisible(activeShare) {
    var host = getHostEl();
    if (!host) return;
    if (!hasToolbar()) {
      renderToolbar(activeShare, true);
    }
  }

  function patchRolesIfNeeded(activeShare) {
    var rk = rolesSyncKey();
    if (rk === _lastRolesKey) return;
    _lastRolesKey = rk;
    if (hasToolbar()) {
      updateToolbarParts(activeShare || _activeShareRemote);
    }
  }

  function renderToolbar(activeShare, forceFull) {
    if (_projectorMode) return;
    var host = getHostEl();
    if (!host) return;

    if (activeShare !== undefined) {
      _activeShareRemote = activeShare;
    }

    if (!forceFull && updateToolbarParts(activeShare)) {
      return;
    }

    host.innerHTML =
      '<div class="ph-screen-share-bar ph-screen-share-bar-prominent">' +
        '<div class="ph-screen-share-header">' +
          '<h4 class="ph-screen-share-title">Chia sẻ màn hình</h4>' +
          '<p class="ph-detail-muted ph-screen-share-lead">' +
            'Chọn cửa sổ hoặc màn hình (Word, Excel, PowerPoint, PDF, trình duyệt…). ' +
            (_canApproveShare
              ? 'Chủ trì / thư ký chia sẻ trực tiếp; có thể duyệt đại biểu xin chia sẻ.'
              : 'Bấm «Xin chia sẻ màn hình» và chờ chủ trì / thư ký duyệt.') +
          '</p>' +
          buildHostTvHint() +
        '</div>' +
        buildHostApprovalHtml() +
        '<div class="ph-screen-share-actions">' + buildParticipantActions(activeShare) + '</div>' +
        '<div class="ph-screen-share-stage" id="phScreenShareStage">' +
          buildStageInnerHtml(activeShare) +
        '</div>' +
      '</div>';

    bindToolbarEvents(host);
    bindStageOverlayEvents(host);
    attachVideoStream();
  }

  async function requestShare() {
    if (!_meetingId) return;
    try {
      _myRequest = await window.PhonghopServices.requestScreenShare(_meetingId);
      _lastRequestsKey = '';
      renderToolbar(null, true);
      if (window.PhonghopServices.showDocToast) {
        window.PhonghopServices.showDocToast(
          'Đã gửi yêu cầu — chờ chủ trì / thư ký duyệt', 7000
        );
      }
    } catch (e) {
      alert(e.message || 'Không gửi được yêu cầu');
    }
  }

  async function approveRequest(requestId) {
    if (!_meetingId || !requestId) return;
    try {
      var hadActive = _activeShareRemote && _activeShareRemote.active;
      await window.PhonghopServices.approveScreenShareRequest(_meetingId, requestId);
      _lastRequestsKey = '';
      if (window.PhonghopServices.showDocToast) {
        window.PhonghopServices.showDocToast(
          hadActive
            ? 'Đã chuyển quyền chia sẻ — đại biểu được duyệt có thể bắt đầu phát'
            : 'Đã cho phép chia sẻ màn hình',
          6000
        );
      }
      if (window.MeetingRoom && window.MeetingRoom.refresh) {
        window.MeetingRoom.refresh();
      }
    } catch (e) {
      alert(e.message || 'Không duyệt được');
    }
  }

  async function denyRequest(requestId) {
    if (!_meetingId || !requestId) return;
    try {
      await window.PhonghopServices.denyScreenShareRequest(_meetingId, requestId);
      _lastRequestsKey = '';
      if (window.PhonghopServices.showDocToast) {
        window.PhonghopServices.showDocToast('Đã từ chối yêu cầu chia sẻ', 5000);
      }
      if (window.MeetingRoom && window.MeetingRoom.refresh) {
        window.MeetingRoom.refresh();
      }
    } catch (e) {
      alert(e.message || 'Không từ chối được');
    }
  }

  function canStartShareWithoutApproval() {
    if (_canApproveShare) return true;
    var st = (_myRequest && _myRequest.status) ? _myRequest.status.toLowerCase() : '';
    if (st === 'approved') return true;
    if (_activeShareRemote && _activeShareRemote.active &&
        sameUser(_activeShareRemote.sharer_username, username())) {
      return true;
    }
    return false;
  }

  async function startShare() {
    if (!_meetingId) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      alert('Trình duyệt không hỗ trợ chia sẻ màn hình. Dùng Chrome hoặc Edge mới nhất.');
      return;
    }

    if (!canStartShareWithoutApproval()) {
      alert('Chủ trì / thư ký chưa cho phép — bấm «Xin chia sẻ màn hình» và chờ duyệt.');
      return;
    }

    var isResume = !_sharing && _activeShareRemote && _activeShareRemote.active &&
      sameUser(_activeShareRemote.sharer_username, username());

    try {
      var stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 },
        audio: false
      });

      await window.PhonghopServices.startScreenShare(_meetingId);

      _localStream = stream;
      _sharing = true;
      _viewerMode = false;
      _remoteStream = null;
      _sharerUsername = username();
      _myRequest = null;
      _lastMineStatus = '';
      _processedSignalIds = {};
      _signalSince = '';
      _lastShareSyncKey = 'on|' + username();

      stream.getVideoTracks()[0].addEventListener('ended', function () {
        stopShare();
      });

      renderToolbar({ active: true, sharer_username: username() }, true);
      attachVideoStream();
      startSignalPoll();
      pollSignals();
      ensureOffersForOnlineViewers(_lastPresence, _lastAttendees);

      if (window.PhonghopServices.showDocToast) {
        window.PhonghopServices.showDocToast(
          isResume
            ? 'Đã khôi phục chia sẻ màn hình — mọi người sẽ thấy lại sau vài giây.'
            : 'Đang chia sẻ — chọn cửa sổ ứng dụng hoặc màn hình bạn muốn mọi người xem.',
          9000
        );
      }
    } catch (e) {
      stopLocalStream();
      _sharing = false;
      if (e && e.name !== 'NotAllowedError') {
        alert(e.message || 'Không bắt đầu được chia sẻ màn hình');
      }
    }
  }

  async function stopOrphanShare() {
    if (!_meetingId) return;
    try {
      await window.PhonghopServices.stopScreenShare(_meetingId, false);
      _lastShareSyncKey = 'off';
      renderToolbar(null, true);
      if (window.MeetingRoom && window.MeetingRoom.refresh) {
        window.MeetingRoom.refresh();
      }
    } catch (e) {
      alert(e.message || 'Không dừng được phát');
    }
  }

  async function stopRemoteShare() {
    if (!_meetingId || !_canModerate) return;
    try {
      await window.PhonghopServices.stopScreenShare(_meetingId, true);
      stopSignalPoll();
      stopViewerRetry();
      closeAllPeers();
      stopLocalStream();
      _remoteStream = null;
      _sharing = false;
      _viewerMode = false;
      _sharerUsername = '';
      _viewerJoinSent = false;
      _lastShareSyncKey = 'off';
      _activeShareRemote = null;
      renderToolbar(null, true);
      setViewerStatus('');
      if (window.PhonghopServices.showDocToast) {
        window.PhonghopServices.showDocToast('Đã dừng chia sẻ màn hình', 5000);
      }
      if (window.MeetingRoom && window.MeetingRoom.refresh) {
        window.MeetingRoom.refresh();
      }
    } catch (e) {
      alert(e.message || 'Không dừng được chia sẻ');
    }
  }

  async function stopShare() {
    stopSignalPoll();
    stopViewerRetry();
    closeAllPeers();
    stopLocalStream();
    _remoteStream = null;
    _sharing = false;
    _viewerMode = false;
    _sharerUsername = '';
    _viewerJoinSent = false;
    _lastShareSyncKey = 'off';

    if (_meetingId && window.PhonghopServices.stopScreenShare) {
      try {
        await window.PhonghopServices.stopScreenShare(_meetingId, false);
      } catch (_) { /* ignore */ }
    }

    renderToolbar(null, true);
    setViewerStatus('');
  }

  async function sendViewerJoin() {
    if (!_viewerMode || !_sharerUsername || _sharing) return;
    try {
      await apiSignal('join', {
        viewer: viewerIdentity(),
        sharer: _sharerUsername
      }, null);
      _viewerJoinSent = true;
      var label = _sharerUsername;
      if (_projectorMode) label += ' (màn chiếu TV)';
      setViewerStatus('Đang kết nối video từ ' + label + '…');
    } catch (e) {
      setViewerStatus('Lỗi kết nối — thử lại…', true);
    }
  }

  async function joinAsViewer(share) {
    if (!share || !share.active || !_meetingId) return;
    if (sameUser(share.sharer_username, username())) return;
    if (_sharing) return;

    var sharerChanged = !sameUser(_sharerUsername, share.sharer_username);
    if (sharerChanged || !_viewerMode) {
      closeAllPeers();
      _remoteStream = null;
      _viewerJoinSent = false;
      _viewerRetryCount = 0;
    }

    _viewerMode = true;
    _sharerUsername = share.sharer_username;
    _lastShareSyncKey = shareSyncKey(share);
    if (!_viewerConnectSince || sharerChanged) _viewerConnectSince = Date.now();

    if (!_signalTimer || sharerChanged) {
      _processedSignalIds = {};
      _signalSince = '';
      startSignalPoll();
    }

    updateViewerPlaceholder(share);
    if (!_projectorMode) {
      updateToolbarParts(share);
    } else {
      updateProjectorStatus(share);
    }

    if (!_remoteStream) {
      resetViewerPeer(share.sharer_username);
      ensurePeer(share.sharer_username, true);
      await sendViewerJoin();
      startViewerRetry();
    }
  }

  function handleRequestStateChange(requests) {
    if (!requests) return;
    _pendingHost = requests.pending || [];
    _myRequest = requests.mine || null;

    var st = (_myRequest && _myRequest.status) ? _myRequest.status.toLowerCase() : '';
    if (st && st !== _lastMineStatus && !_canApproveShare) {
      if (st === 'approved' && _lastMineStatus === 'pending') {
        if (window.PhonghopServices.showDocToast) {
          window.PhonghopServices.showDocToast(
            'Chủ trì đã cho phép — bấm «Bắt đầu chia sẻ»', 8000
          );
        }
      }
      if (st === 'denied' && _lastMineStatus === 'pending') {
        if (window.PhonghopServices.showDocToast) {
          window.PhonghopServices.showDocToast('Chủ trì đã từ chối yêu cầu chia sẻ', 7000);
        }
      }
      _lastMineStatus = st;
    }
    if (!st) _lastMineStatus = '';
  }

  function cleanupProjector() {
    stopMirrorPoll();
    stopCanvasMirror();
    if (_projectorPoll) {
      clearInterval(_projectorPoll);
      _projectorPoll = null;
    }
  }

  function cleanup() {
    var wasProjector = _projectorMode;
    stopSignalPoll();
    stopViewerRetry();
    closeAllPeers();
    stopLocalStream();
    _remoteStream = null;
    _sharing = false;
    _viewerMode = false;
    _sharerUsername = '';
    _viewerJoinSent = false;
    _processedSignalIds = {};
    if (_projectorPoll) {
      clearInterval(_projectorPoll);
      _projectorPoll = null;
    }
    if (!wasProjector) {
      _meetingId = null;
      _myRequest = null;
      _pendingHost = [];
      _lastMineStatus = '';
    _lastShareSyncKey = '';
    _lastRequestsKey = '';
    _lastRolesKey = '';
    _shareInactiveSince = 0;
      closeProjectorWindow();
      var host = getHostEl();
      if (host) host.innerHTML = '';
    }
    _projectorMode = false;
    _projectorVideo = null;
  }

  window.MeetingScreenShare = {
    setMeetingId: function (id) {
      _meetingId = id;
    },

    mountToolbar: function (meetingId, opts) {
      if (meetingId) _meetingId = meetingId;
      opts = opts || {};
      applySessionRoles(opts.isHost, opts);
      _lastRolesKey = rolesSyncKey();
      if (opts.requests) handleRequestStateChange(opts.requests);
      if (!hasToolbar()) {
        renderToolbar(null, true);
      } else {
        updateToolbarParts(_activeShareRemote);
      }
    },

    syncFromRoom: function (meetingId, screenShare, requests, roomIsHost, roleOpts) {
      if (meetingId) _meetingId = meetingId;
      applySessionRoles(roomIsHost, roleOpts || {});
      storeRoomPresence(roleOpts || {});

      if (!hasToolbar()) {
        ensureToolbarVisible(screenShare);
      } else {
        patchRolesIfNeeded(screenShare);
      }

      var reqKey = requestsSyncKey(requests);
      var reqChanged = reqKey !== _lastRequestsKey;
      if (reqChanged) {
        _lastRequestsKey = reqKey;
        handleRequestStateChange(requests);
        if (hasToolbar()) updateToolbarParts(screenShare || _activeShareRemote);
      }

      var sk = shareSyncKey(screenShare);
      var shareChanged = sk !== _lastShareSyncKey;
      var shareActive = !!(screenShare && screenShare.active);

      if (!shareActive) {
        if (_sharing) {
          _lastShareSyncKey = sk;
          stopSignalPoll();
          stopViewerRetry();
          closeAllPeers();
          stopLocalStream();
          _sharing = false;
          _viewerMode = false;
          _sharerUsername = '';
          _viewerJoinSent = false;
          _remoteStream = null;
          _activeShareRemote = null;
          _lastOfferAt = {};
          renderToolbar(null, true);
          setViewerStatus('');
          if (window.PhonghopServices.showDocToast) {
            window.PhonghopServices.showDocToast('Chia sẻ màn hình đã được dừng', 5000);
          }
          return;
        }
        if (_viewerMode && (_remoteStream || _sharerUsername)) {
          if (!_shareInactiveSince) _shareInactiveSince = Date.now();
          if (Date.now() - _shareInactiveSince < SHARE_INACTIVE_GRACE_MS) {
            attachVideoStream();
            return;
          }
        }
        _shareInactiveSince = 0;

        if (_viewerMode) {
          _lastShareSyncKey = 'off';
          _viewerMode = false;
          _sharerUsername = '';
          _viewerJoinSent = false;
          _remoteStream = null;
          _activeShareRemote = null;
          stopViewerRetry();
          stopSignalPoll();
          closeAllPeers();
          attachVideoStream();
        } else {
          _lastShareSyncKey = 'off';
        }
        if (!_sharing && hasToolbar() && (shareChanged || reqChanged)) {
          updateToolbarParts(null);
        }
        if (_projectorMode) updateProjectorStatus(null);
        return;
      }

      _shareInactiveSince = 0;

      if (sameUser(screenShare.sharer_username, username())) {
        _lastShareSyncKey = sk;
        _activeShareRemote = screenShare;
        if (!_sharing || !_localStream) {
          if (hasToolbar()) updateToolbarParts(screenShare);
          else renderToolbar(screenShare, true);
          return;
        }
        if (!_signalTimer) {
          _processedSignalIds = {};
          _signalSince = '';
          startSignalPoll();
        }
        if (shareChanged || reqChanged) {
          updateToolbarParts(screenShare);
        }
        attachVideoStream();
        ensureOffersForOnlineViewers(_lastPresence, _lastAttendees);
        return;
      }

      _lastShareSyncKey = sk;
      _activeShareRemote = screenShare;
      if (shareChanged || reqChanged || !_remoteStream) {
        if (hasToolbar()) updateToolbarParts(screenShare);
      }
      if (_projectorMode && mirrorStreamFromOpener()) {
        updateProjectorStatus(screenShare);
        syncStageOverlay();
        return;
      }
      if (_projectorMode) {
        showProjectorWaiting(screenShare);
        return;
      }
      joinAsViewer(screenShare);
    },

    hasToolbar: hasToolbar,

    isLocalSharing: function () {
      return _sharing;
    },

    isRemoteShareActive: function () {
      return _viewerMode && !!_sharerUsername;
    },

    cleanup: cleanup,
    stopShare: stopShare,
    stopRemoteShare: stopRemoteShare,
    openProjectorWindow: openProjectorWindow,
    closeProjectorWindow: closeProjectorWindow,
    toggleStageFullscreen: toggleStageFullscreen,
    getDisplayStream: getDisplayStreamRef,

    initProjector: function (meetingId) {
      if (!meetingId || !window.PhonghopServices) return;
      _projectorMode = true;
      _meetingId = meetingId;
      _isHost = false;
      _projectorVideo = document.getElementById('phScreenProjectorVideo');
      updateProjectorStatus(null);
      bindProjectorMirrorChannel(meetingId);

      var overlayFs = document.getElementById('phScreenProjectorFullscreen');
      if (overlayFs) {
        overlayFs.addEventListener('click', toggleStageFullscreen);
      }
      var video = _projectorVideo;
      if (video) {
        video.addEventListener('dblclick', toggleStageFullscreen);
      }

      function syncProjectorFromLaptop(activeShare) {
        if (mirrorStreamFromOpener()) {
          updateProjectorStatus(activeShare);
          syncStageOverlay();
          return true;
        }
        showProjectorWaiting(activeShare);
        return false;
      }

      mirrorStreamFromOpener();
      startMirrorPoll();

      function pollRoom() {
        if (syncProjectorFromLaptop(_activeShareRemote)) return;
        window.PhonghopServices.getRoomState(meetingId).then(function (room) {
          _activeShareRemote = room.screen_share;
          syncProjectorFromLaptop(room.screen_share);
        }).catch(function (e) {
          console.warn('[MeetingScreenShare] projector poll', e.message || e);
          showProjectorWaiting(_activeShareRemote);
        });
      }

      pollRoom();
      _projectorPoll = setInterval(pollRoom, 1500);

      window.addEventListener('beforeunload', function () {
        stopMirrorPoll();
        stopCanvasMirror();
        cleanupProjector();
      });
    }
  };
})();
