/**
 * join.js — deep link nội bộ /app/phonghop/join?code=MTG-...
 */
(function () {
  'use strict';

  var JOIN_PATH = '/app/phonghop/join';

  function normalizeMeetingCode(raw) {
    var s = String(raw || '').trim().toUpperCase();
    if (!s) return '';
    if (/^MTG-\d{4}-\d+$/.test(s)) return s;
    var m = s.match(/MTG[- ]?\d{4}[- ]?\d+/);
    if (m) return m[0].replace(/\s+/g, '-');
    return s;
  }

  function getCodeFromUrl(location) {
    var loc = location || window.location;
    var params = new URLSearchParams(loc.search || '');
    var code = params.get('code') || params.get('join') || params.get('m');
    return normalizeMeetingCode(code);
  }

  function isJoinLandingPage(location) {
    var path = (location || window.location).pathname || '';
    return path === JOIN_PATH || path === '/phonghop/join';
  }

  function isLocalOnlyHostname(hostname) {
    return /^localhost$|^127\.0\.0\.1$/i.test(String(hostname || '').trim());
  }

  /** URL gốc cho link/QR — ưu tiên PUBLIC_BASE_URL hoặc IP LAN từ server, không dùng 127.0.0.1. */
  function getPublicOrigin() {
    var meta = document.querySelector('meta[name="erp-public-origin"]');
    if (meta && meta.content && meta.content.trim()) {
      return meta.content.trim().replace(/\/$/, '');
    }
    var host = (window.location.hostname || '').toLowerCase();
    if (isLocalOnlyHostname(host)) {
      var lanMeta = document.querySelector('meta[name="erp-lan-origin"]');
      if (lanMeta && lanMeta.content && lanMeta.content.trim()) {
        return lanMeta.content.trim().replace(/\/$/, '');
      }
    }
    return (window.location.origin || '').replace(/\/$/, '');
  }

  function getJoinUrlHint(joinUrl) {
    try {
      var u = new URL(joinUrl || getPublicOrigin());
      if (isLocalOnlyHostname(u.hostname)) {
        return 'Link đang dùng localhost — điện thoại không mở được. ' +
          'Thêm PUBLIC_BASE_URL trong .env hoặc mở ERP bằng IP mạng (vd. http://192.168.x.x:8080).';
      }
      if (/^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[0-1])\./.test(u.hostname)) {
        return 'Quét QR trên điện thoại cùng WiFi với máy chủ ERP.';
      }
    } catch (_) { /* ignore */ }
    return 'Quét bằng camera điện thoại — không dùng cho khách ngoài chưa có tài khoản ERP.';
  }

  function buildJoinUrl(meetingCode, origin) {
    var code = normalizeMeetingCode(meetingCode);
    if (!code) return '';
    var base = (origin || getPublicOrigin()).replace(/\/$/, '');
    return base + JOIN_PATH + '?code=' + encodeURIComponent(code);
  }

  function getSafeReturnUrl(raw) {
    var ret = String(raw || '').trim();
    if (!ret || !ret.startsWith('/') || ret.startsWith('//')) return null;
    return ret;
  }

  function buildReturnToCurrentPage() {
    return window.location.pathname + window.location.search;
  }

  function redirectToLoginWithReturn() {
    var ret = encodeURIComponent(buildReturnToCurrentPage());
    window.location.href = '/?return=' + ret;
  }

  function cleanJoinQueryFromHistory() {
    try {
      if (isJoinLandingPage()) {
        history.replaceState({}, '', '/app/phonghop');
        return;
      }
      var u = new URL(window.location.href);
      if (u.searchParams.has('code') || u.searchParams.has('join') || u.searchParams.has('m')) {
        u.searchParams.delete('code');
        u.searchParams.delete('join');
        u.searchParams.delete('m');
        var qs = u.searchParams.toString();
        history.replaceState({}, '', u.pathname + (qs ? '?' + qs : ''));
      }
    } catch (_) { /* ignore */ }
  }

  function renderQr(target, url, opts) {
    opts = opts || {};
    if (!target || !url) return Promise.resolve(false);

    var QR = typeof window !== 'undefined' ? window.QRCode : null;
    if (!QR || typeof QR.toDataURL !== 'function') {
      target.innerHTML = '<p class="ph-detail-muted ph-qr-fallback">Không tải được thư viện QR. Vui lòng dùng link phía trên.</p>';
      return Promise.resolve(false);
    }

    var size = opts.width || 200;
    var options = {
      width: size,
      margin: opts.margin != null ? opts.margin : 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#0f172a', light: '#ffffff' }
    };

    return QR.toDataURL(url, options).then(function (dataUrl) {
      target.innerHTML = '';
      var img = document.createElement('img');
      img.src = dataUrl;
      img.alt = 'QR tham gia cuộc họp';
      img.className = 'ph-qr-image';
      img.width = size;
      img.height = size;
      target.appendChild(img);
      return true;
    }).catch(function (err) {
      console.warn('[PhonghopJoin] renderQr', err);
      target.innerHTML = '<p class="ph-detail-muted ph-qr-fallback">Không tạo được mã QR. Sao chép link phía trên.</p>';
      return false;
    });
  }

  /**
   * Tra mã → kiểm tra quyền (API) → mở phòng nếu được mời.
   */
  async function enterByCode(code, handlers) {
    handlers = handlers || {};
    var normalized = normalizeMeetingCode(code);
    if (!normalized) {
      var errEmpty = new Error('Thiếu mã cuộc họp (MTG-2026-xxxx).');
      if (handlers.onError) handlers.onError(errEmpty);
      throw errEmpty;
    }
    var SVC = window.PhonghopServices;
    if (!SVC || !SVC.lookupMeetingByCode) {
      var errSvc = new Error('Dịch vụ phòng họp chưa sẵn sàng.');
      if (handlers.onError) handlers.onError(errSvc);
      throw errSvc;
    }
    try {
      var meeting = await SVC.lookupMeetingByCode(normalized);
      if (!meeting || !meeting.id) {
        var err404 = new Error('Không tìm thấy cuộc họp ' + normalized + '.');
        if (handlers.onError) handlers.onError(err404);
        throw err404;
      }
      if (handlers.onFound) handlers.onFound(meeting);
      if (handlers.openRoom !== false && window.MeetingRoom && window.MeetingRoom.open) {
        await window.MeetingRoom.open({
          meetingId: meeting.id,
          onClose: handlers.onClose || null
        });
      }
      if (handlers.onSuccess) handlers.onSuccess(meeting);
      return meeting;
    } catch (e) {
      var msg = e.message || String(e);
      if (/403|quyền|permission|không có quyền/i.test(msg)) {
        msg = 'Bạn không nằm trong danh sách mời cuộc họp ' + normalized +
          '.\n\nLiên hệ chủ trì để được thêm vào danh sách tham dự.';
      }
      var err = new Error(msg);
      if (handlers.onError) handlers.onError(err);
      throw err;
    }
  }

  window.PhonghopJoin = {
    JOIN_PATH: JOIN_PATH,
    normalizeMeetingCode: normalizeMeetingCode,
    getCodeFromUrl: getCodeFromUrl,
    isJoinLandingPage: isJoinLandingPage,
    getPublicOrigin: getPublicOrigin,
    getJoinUrlHint: getJoinUrlHint,
    isLocalOnlyHostname: isLocalOnlyHostname,
    buildJoinUrl: buildJoinUrl,
    getSafeReturnUrl: getSafeReturnUrl,
    buildReturnToCurrentPage: buildReturnToCurrentPage,
    redirectToLoginWithReturn: redirectToLoginWithReturn,
    cleanJoinQueryFromHistory: cleanJoinQueryFromHistory,
    renderQr: renderQr,
    enterByCode: enterByCode
  };
})();
