/* services.js — API phonghop */
(function () {
  'use strict';

  var API = '/api/meetings';
  var ROOMS_API = '/api/meeting-rooms';

  function username() {
    var u = window.PhonghopState && window.PhonghopState.state.currentUser;
    if (u && u.username) return u.username;
    try {
      var c = JSON.parse(localStorage.getItem('currentUser') || 'null');
      return c && c.username ? c.username : '';
    } catch (_) { return ''; }
  }

  function headers() {
    return {
      'Content-Type': 'application/json',
      'X-RRIV-Username': username()
    };
  }

  function uploadHeaders() {
    return { 'X-RRIV-Username': username() };
  }

  async function parseJsonResponse(res, fallbackMsg) {
    var text = await res.text();
    try {
      return JSON.parse(text);
    } catch (_) {
      throw new Error(fallbackMsg || 'Phản hồi server không hợp lệ');
    }
  }

  function normalizeEmployee(doc, docId) {
    var x = doc || {};
    var status = String(x.employment_status || x.employmentStatus || x.status || 'active').toLowerCase();
    if (status === 'resigned' || status === 'terminated' || status === 'inactive') return null;
    if (x.disabled === true || x.account_locked === true) return null;

    var id = String(x.id || docId || '');
    if (!id) return null;

    var fullName = (
      x.full_name || x.fullName || x.hoTen || x.ho_ten || x.name || x.username || ''
    ).trim();
    if (!fullName) return null;

    return {
      id: id,
      employeeId: id,
      employeeCode: String(x.employee_code || x.employeeCode || x.code || '').trim(),
      username: String(x.username || '').trim().toLowerCase(),
      fullName: fullName,
      department: String(x.department_name || x.department || '').trim(),
      departmentId: String(x.department_id || x.departmentId || '').trim(),
      email: String(x.company_email || x.email || x.personal_email || '').trim().toLowerCase()
    };
  }

  async function listMeetings(limit) {
    var url = API + '?limit=' + (limit || 50) + '&username=' + encodeURIComponent(username());
    var res = await fetch(url, { headers: headers() });
    var body = await parseJsonResponse(
      res,
      'Không đọc được danh sách cuộc họp (server trả HTML — thử restart Flask hoặc đăng nhập lại)'
    );
    if (!res.ok) {
      var msg = body.message;
      if (typeof msg !== 'string') msg = JSON.stringify(msg);
      throw new Error(msg || ('Lỗi tải danh sách họp (HTTP ' + res.status + ')'));
    }
    return body.meetings || [];
  }

  async function listRooms() {
    var res = await fetch(ROOMS_API + '?username=' + encodeURIComponent(username()), { headers: headers() });
    var body = await parseJsonResponse(res, 'Không đọc được danh sách phòng họp');
    if (!res.ok) throw new Error(body.message || 'Lỗi tải phòng họp');
    return body.rooms || [];
  }

  async function createMeeting(payload) {
    var body = Object.assign({ username: username() }, payload);
    var res = await fetch(API, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body)
    });
    var data = await res.json();
    if (!res.ok) {
      var msg = data.message;
      if (Array.isArray(msg)) msg = msg.map(function (e) { return e.msg || JSON.stringify(e); }).join('; ');
      throw new Error(msg || 'Không tạo được cuộc họp');
    }
    return data.meeting;
  }

  async function getMeeting(meetingId) {
    var url = API + '/' + encodeURIComponent(meetingId) + '?username=' + encodeURIComponent(username());
    var res = await fetch(url, { headers: headers() });
    var data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Không tải được cuộc họp');
    return data.meeting;
  }

  async function updateMeeting(meetingId, payload) {
    var body = Object.assign({ username: username() }, payload);
    var res = await fetch(API + '/' + encodeURIComponent(meetingId), {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify(body)
    });
    var data = await res.json();
    if (!res.ok) {
      var msg = data.message;
      if (Array.isArray(msg)) msg = msg.map(function (e) { return e.msg || JSON.stringify(e); }).join('; ');
      throw new Error(msg || 'Không cập nhật được cuộc họp');
    }
    return data.meeting;
  }

  async function getDocumentShares(meetingId) {
    if (meetingId) {
      var url = API + '/' + encodeURIComponent(meetingId) + '/documents/shares?username=' +
        encodeURIComponent(username());
      var res = await fetch(url, { headers: headers() });
      var data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Không tải được tài liệu chia sẻ');
      return data;
    }
    return getLibraryDocumentTree(null);
  }

  async function getLibraryDocumentTree(meetingId) {
    return browseLibraryFolder({ meetingId: meetingId, parentId: null });
  }

  async function browseLibraryFolder(opts) {
    opts = opts || {};
    var params = ['username=' + encodeURIComponent(username())];
    if (opts.parentId) params.push('parent_id=' + encodeURIComponent(opts.parentId));
    if (opts.meetingId) params.push('meeting_id=' + encodeURIComponent(opts.meetingId));
    var url = API + '/documents/library/browse?' + params.join('&');
    var res = await fetch(url, { headers: headers() });
    var data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Không tải được kho tài liệu');
    return data;
  }

  async function uploadLibraryDocument(file, parentId) {
    var fd = new FormData();
    fd.append('file', file);
    if (parentId) fd.append('parent_id', parentId);
    var url = API + '/documents/library/upload?username=' + encodeURIComponent(username());
    var res = await fetch(url, { method: 'POST', headers: uploadHeaders(), body: fd });
    var data = await parseJsonResponse(res, 'Upload thất bại — kiểm tra server đã restart chưa');
    if (!res.ok) throw new Error(data.message || 'Upload thất bại');
    return data.document || data;
  }

  async function createLibraryFolder(name, parentId) {
    var url = API + '/documents/library/folder?username=' + encodeURIComponent(username());
    var res = await fetch(url, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers()),
      body: JSON.stringify({ name: name, parent_id: parentId || null })
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Không tạo được thư mục');
    return data.document || data;
  }

  async function uploadMeetingDocument(meetingId, file, parentId) {
    var fd = new FormData();
    fd.append('file', file);
    if (parentId) fd.append('parent_id', parentId);
    var url = API + '/' + encodeURIComponent(meetingId) + '/documents/upload?username=' +
      encodeURIComponent(username());
    var res = await fetch(url, { method: 'POST', headers: uploadHeaders(), body: fd });
    var data = await parseJsonResponse(res, 'Upload thất bại');
    if (!res.ok) throw new Error(data.message || 'Upload thất bại');
    return data.document || data;
  }

  async function createMeetingDocFolder(meetingId, name, parentId) {
    var url = API + '/' + encodeURIComponent(meetingId) + '/documents/folder?username=' +
      encodeURIComponent(username());
    var res = await fetch(url, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers()),
      body: JSON.stringify({ name: name, parent_id: parentId || null })
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Không tạo được thư mục');
    return data.document || data;
  }

  async function setDocumentShares(meetingId, documentIds) {
    var url = API + '/' + encodeURIComponent(meetingId) + '/documents/shares?username=' +
      encodeURIComponent(username());
    var res = await fetch(url, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ document_ids: documentIds || [] })
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Không lưu được tài liệu chia sẻ');
    if (data.warm_result && showDocToast) {
      var wr = data.warm_result;
      if (wr.skipped) {
        showDocToast('Đã lưu tài liệu chia sẻ', 4000);
      } else {
        var msg = 'Đã sync hot Firebase: ' + (wr.warmed || 0) + ' file';
        if (wr.failed) msg += ' (' + wr.failed + ' lỗi — kiểm tra FIREBASE_STORAGE_BUCKET)';
        showDocToast(msg, 7000);
      }
    }
    return data;
  }

  function ensureDocViewerModal() {
    var el = document.getElementById('phDocViewerModal');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'phDocViewerModal';
    el.className = 'ph-doc-viewer-modal';
    el.hidden = true;
    el.innerHTML =
      '<div class="ph-doc-viewer-backdrop" data-close="1"></div>' +
      '<div class="ph-doc-viewer-panel">' +
        '<div class="ph-doc-viewer-head">' +
          '<strong id="phDocViewerTitle">Tài liệu</strong>' +
          '<button type="button" class="ph-btn" id="phDocViewerDownload">Tải về / Mở app</button>' +
          '<button type="button" class="ph-btn" id="phDocViewerClose">Đóng</button>' +
        '</div>' +
        '<iframe id="phDocViewerFrame" title="Xem tài liệu" class="ph-doc-viewer-frame"></iframe>' +
      '</div>';
    document.body.appendChild(el);
    el.querySelector('[data-close]').addEventListener('click', function () {
      closeDocViewer();
    });
    el.querySelector('#phDocViewerClose').addEventListener('click', function () {
      closeDocViewer();
    });
    return el;
  }

  var _viewerBlobUrl = null;
  var _viewerDownloadName = 'document';

  function closeDocViewer() {
    var el = document.getElementById('phDocViewerModal');
    if (!el) return;
    el.hidden = true;
    var frame = el.querySelector('#phDocViewerFrame');
    if (frame) frame.removeAttribute('src');
    if (_viewerBlobUrl) {
      URL.revokeObjectURL(_viewerBlobUrl);
      _viewerBlobUrl = null;
    }
  }

  var OFFICE_EXT_MIME = {
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  };

  function fileExt(name) {
    var n = String(name || '');
    var i = n.lastIndexOf('.');
    return i >= 0 ? n.slice(i).toLowerCase() : '';
  }

  function mimeFromFilename(name, fallback) {
    var ext = fileExt(name);
    if (OFFICE_EXT_MIME[ext]) return OFFICE_EXT_MIME[ext];
    if (ext === '.pdf') return 'application/pdf';
    return fallback || 'application/octet-stream';
  }

  function isPdfDoc(name, mime) {
    if (fileExt(name) === '.pdf') return true;
    return String(mime || '').toLowerCase().indexOf('pdf') >= 0;
  }

  function isOfficeDoc(name, mime) {
    if (OFFICE_EXT_MIME[fileExt(name)]) return true;
    var m = String(mime || '').toLowerCase();
    return m.indexOf('word') >= 0 || m.indexOf('excel') >= 0 ||
      m.indexOf('spreadsheet') >= 0 || m.indexOf('powerpoint') >= 0 ||
      m.indexOf('presentation') >= 0 || m.indexOf('msword') >= 0 ||
      m.indexOf('ms-excel') >= 0 || m.indexOf('ms-powerpoint') >= 0;
  }

  function isMobileDevice() {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  }

  function buildDocDownloadUrl(meetingId, docId, disposition) {
    var url = API + '/' + encodeURIComponent(meetingId) + '/documents/' +
      encodeURIComponent(docId) + '/download?username=' + encodeURIComponent(username());
    if (disposition) url += '&disposition=' + encodeURIComponent(disposition);
    return url;
  }

  function absoluteDownloadUrl(meetingId, docId, disposition) {
    return window.location.origin + buildDocDownloadUrl(meetingId, docId, disposition);
  }

  function isLocalOrHttpUrl(absUrl) {
    try {
      var u = new URL(absUrl);
      var host = (u.hostname || '').toLowerCase();
      if (u.protocol === 'http:') return true;
      return host === 'localhost' || host === '127.0.0.1' ||
        host.startsWith('192.168.') || host.startsWith('10.') || host.endsWith('.local');
    } catch (_) {
      return true;
    }
  }

  function canUseOfficeShellUrl(absUrl) {
    if (isLocalOrHttpUrl(absUrl)) return false;
    try {
      return new URL(absUrl).protocol === 'https:';
    } catch (_) {
      return false;
    }
  }

  function officeShellUrl(name, absUrl) {
    var protoMap = {
      '.doc': 'ms-word', '.docx': 'ms-word',
      '.xls': 'ms-excel', '.xlsx': 'ms-excel',
      '.ppt': 'ms-powerpoint', '.pptx': 'ms-powerpoint'
    };
    var proto = protoMap[fileExt(name)];
    if (!proto || !absUrl) return null;
    return proto + ':ofv|u|' + absUrl;
  }

  function showDocToast(message, durationMs) {
    var el = document.getElementById('phDocToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'phDocToast';
      el.className = 'ph-doc-toast';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.hidden = false;
    clearTimeout(showDocToast._timer);
    showDocToast._timer = setTimeout(function () {
      el.hidden = true;
    }, durationMs || 8000);
  }

  function officeAppName(name) {
    var ext = fileExt(name);
    if (ext === '.doc' || ext === '.docx') return 'Word';
    if (ext === '.xls' || ext === '.xlsx') return 'Excel';
    if (ext === '.ppt' || ext === '.pptx') return 'PowerPoint';
    return 'ứng dụng tương ứng';
  }

  function triggerIframeDownload(absUrl) {
    var iframe = document.getElementById('phDocDownloadFrame');
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id = 'phDocDownloadFrame';
      iframe.setAttribute('aria-hidden', 'true');
      iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
      document.body.appendChild(iframe);
    }
    iframe.src = absUrl;
  }

  function triggerDirectDownload(absUrl, name) {
    triggerIframeDownload(absUrl);
    var a = document.createElement('a');
    a.href = absUrl;
    if (name) a.setAttribute('download', name);
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function downloadBlobToDisk(blob, name, mime) {
    var correctMime = mimeFromFilename(name, mime || blob.type);
    var finalBlob = blob;
    if (blob.type !== correctMime && correctMime !== 'application/octet-stream') {
      finalBlob = new Blob([blob], { type: correctMime });
    }
    triggerFileDownload(finalBlob, name, correctMime);
  }

  function openExternalDownload(url, name) {
    var a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    if (name) a.setAttribute('download', name);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function fetchDownloadLink(meetingId, docId, inline) {
    var cached = window.PhonghopDocCache &&
      window.PhonghopDocCache.getCachedObjectUrl(meetingId, docId);
    if (cached) {
      return cached.then(function (blobUrl) {
        if (blobUrl) {
          return { url: blobUrl, direct: true, cached: true };
        }
        return fetchDownloadLinkFromApi(meetingId, docId, inline);
      });
    }
    return fetchDownloadLinkFromApi(meetingId, docId, inline);
  }

  function fetchDownloadLinkFromApi(meetingId, docId, inline) {
    var url = API + '/' + encodeURIComponent(meetingId) + '/documents/' +
      encodeURIComponent(docId) + '/download-link?username=' + encodeURIComponent(username());
    if (inline) url += '&disposition=inline';
    return fetch(url, { headers: { 'X-RRIV-Username': username() || '' } })
      .then(function (r) {
        return r.json().then(function (b) { return { ok: r.ok, b: b }; });
      })
      .then(function (x) {
        if (!x.ok || !x.b.success) {
          throw new Error(x.b.message || 'Không lấy được link tải');
        }
        var link = x.b.link;
        if (link && link.url && link.direct && window.PhonghopDocCache) {
          window.PhonghopDocCache.prefetchDoc(meetingId, docId, link.url, link.name);
        }
        return link;
      });
  }

  function downloadOfficeDesktop(meetingId, docId, name, mime, presetUrl) {
    showDocToast('Đang mở ' + name + '…');
    if (presetUrl) {
      openExternalDownload(presetUrl, name);
      showDocToast(
        'File đang tải trực tiếp từ Supabase. Xem thanh tải trình duyệt (Ctrl+J).',
        8000
      );
      return Promise.resolve();
    }
    return fetchDownloadLink(meetingId, docId, false).then(function (link) {
      openExternalDownload(link.url, link.name || name);
      showDocToast(
        'File đang tải trực tiếp từ Supabase. Xem thanh tải trình duyệt (Ctrl+J).',
        8000
      );
    });
  }

  function tryLaunchOfficeApp(name, absUrl) {
    var shell = officeShellUrl(name, absUrl);
    if (!shell) return false;
    try {
      var iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = shell;
      document.body.appendChild(iframe);
      setTimeout(function () {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 4000);
      return true;
    } catch (e) {
      console.warn('[PhonghopServices] office shell', e);
      return false;
    }
  }

  function triggerFileDownload(blob, name, mime) {
    var blobUrl = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = blobUrl;
    a.download = name || 'document';
    a.type = mime || blob.type || 'application/octet-stream';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 120000);
  }

  async function fetchDocBlob(meetingId, docId, name, mime, disposition) {
    var url = buildDocDownloadUrl(meetingId, docId, disposition);
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 300000) : null;
    try {
      var res = await fetch(url, {
        headers: { 'X-RRIV-Username': username() || '' },
        signal: controller ? controller.signal : undefined
      });
      if (!res.ok) {
        var err = {};
        try { err = await res.json(); } catch (_) { /* ignore */ }
        throw new Error(err.message || ('Không tải được tài liệu (HTTP ' + res.status + ')'));
      }
      var buf = await res.arrayBuffer();
      var correctMime = mimeFromFilename(name, mime || res.headers.get('Content-Type') || '');
      return new Blob([buf], { type: correctMime });
    } catch (e) {
      if (e && e.name === 'AbortError') {
        throw new Error('Tải file quá lâu — thử lại hoặc kiểm tra kết nối mạng');
      }
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function openOfficeWithNativeApp(meetingId, docId, name, mime, presetUrl) {
    var sharing = window.MeetingScreenShare &&
      window.MeetingScreenShare.isLocalSharing &&
      window.MeetingScreenShare.isLocalSharing();
    if (sharing) {
      showDocToast(
        'Đang chia sẻ màn hình: sau khi Word mở, chuyển sang cửa sổ Word (Alt+Tab). ' +
        'Nếu không thấy Word trong khung chia sẻ, bấm «Dừng chia sẻ» → «Chia sẻ màn hình» lại và chọn cửa sổ Word.',
        12000
      );
    }

    if (!isMobileDevice()) {
      return downloadOfficeDesktop(meetingId, docId, name, mime, presetUrl).then(function () {
        if (sharing) {
          showDocToast('Mở Word → Alt+Tab sang Word để mọi người thấy nội dung.', 8000);
        }
      });
    }

    return (async function () {
      var correctMime = mimeFromFilename(name, mime);
      var blob = await fetchDocBlob(meetingId, docId, name, mime, 'attachment');
      if (blob.type !== correctMime && correctMime !== 'application/octet-stream') {
        blob = new Blob([await blob.arrayBuffer()], { type: correctMime });
      }

      if (typeof File !== 'undefined' && navigator.share) {
        try {
          var shareFile = new File([blob], name, { type: correctMime });
          if (navigator.canShare && navigator.canShare({ files: [shareFile] })) {
            await navigator.share({ files: [shareFile], title: name });
            return;
          }
        } catch (e) {
          if (e && e.name === 'AbortError') return;
          console.warn('[PhonghopServices] native share', e);
        }
      }

      triggerFileDownload(blob, name, correctMime);
      alert(
        'File đã tải về. Mở thư mục Tải về hoặc chạm thông báo tải file → chọn Word / Excel / PowerPoint.'
      );
    })();
  }

  function openPdfInViewer(meetingId, docId, name, presetUrl) {
    if (presetUrl) {
      closeDocViewer();
      var modal = ensureDocViewerModal();
      modal.querySelector('#phDocViewerTitle').textContent = name;
      var frame = modal.querySelector('#phDocViewerFrame');
      frame.removeAttribute('src');
      frame.src = presetUrl;
      modal.querySelector('#phDocViewerDownload').onclick = function () {
        openExternalDownload(presetUrl, name);
      };
      modal.hidden = false;
      return;
    }
    closeDocViewer();
    var loadingModal = ensureDocViewerModal();
    loadingModal.querySelector('#phDocViewerTitle').textContent = name;
    loadingModal.querySelector('#phDocViewerFrame').src = 'about:blank';
    loadingModal.hidden = false;
    showDocToast('Đang mở ' + name + '…');
    fetchDownloadLink(meetingId, docId, true).then(function (link) {
      if (!link || !link.url) {
        throw new Error('Không lấy được link xem PDF');
      }
      openPdfInViewer(meetingId, docId, name, link.url);
    }).catch(function (e) {
      closeDocViewer();
      alert(e.message || 'Không mở được PDF. Kiểm tra tài liệu trên Supabase Storage.');
    });
  }

  function openMeetingDocument(meetingId, docId, opts) {
    opts = opts || {};
    var name = opts.name || 'document';
    var mime = opts.mime || '';
    var presetUrl = opts.download_url || null;

    if (isPdfDoc(name, mime) && !opts.download && opts.viewer !== false) {
      openPdfInViewer(meetingId, docId, name, presetUrl);
      return Promise.resolve();
    }
    if (isOfficeDoc(name, mime)) {
      return openOfficeWithNativeApp(meetingId, docId, name, mime, presetUrl);
    }
    if (!isMobileDevice()) {
      if (presetUrl) {
        openExternalDownload(presetUrl, name);
        return Promise.resolve();
      }
      return fetchDownloadLink(meetingId, docId, false).then(function (link) {
        openExternalDownload(link.url, link.name || name);
      });
    }
    showDocToast('Đang tải ' + name + '…');
    return fetchDocBlob(meetingId, docId, name, mime, 'attachment')
      .then(function (blob) {
        downloadBlobToDisk(blob, name, mime);
        showDocToast('Đã tải xong ' + name + '.', 6000);
      });
  }

  function docOpenLabel(name, mime) {
    if (isPdfDoc(name, mime)) return 'Xem PDF';
    if (isOfficeDoc(name, mime)) {
      if (window.MeetingScreenShare && window.MeetingScreenShare.isLocalSharing &&
          window.MeetingScreenShare.isLocalSharing()) {
        return 'Tải & mở Word';
      }
      return 'Mở';
    }
    return 'Mở';
  }

  async function cancelMeeting(meetingId) {
    return updateMeeting(meetingId, { status: 'cancelled' });
  }

  async function deleteMeeting(meetingId) {
    var url = API + '/' + encodeURIComponent(meetingId) + '?username=' + encodeURIComponent(username());
    var res = await fetch(url, {
      method: 'DELETE',
      headers: headers()
    });
    var data = await res.json();
    if (!res.ok) {
      var msg = data.message;
      if (Array.isArray(msg)) msg = msg.map(function (e) { return e.msg || JSON.stringify(e); }).join('; ');
      throw new Error(msg || 'Không xóa được cuộc họp');
    }
    return true;
  }

  async function lookupMeetingByCode(code) {
    var url = API + '/lookup?code=' + encodeURIComponent(code) + '&username=' + encodeURIComponent(username());
    var res = await fetch(url, { headers: headers() });
    var data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Không tìm thấy cuộc họp');
    return data.meeting;
  }

  async function joinRoom(meetingId) {
    var res = await fetch(API + '/' + encodeURIComponent(meetingId) + '/room/join', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ username: username() })
    });
    var data = await parseMeetingApiResponse(
      res,
      'Không vào được phòng họp (server trả HTML — kiểm tra Firebase trên Render)'
    );
    return data.room;
  }

  async function warmMeetingDocuments(meetingId) {
    var res = await fetch(
      API + '/' + encodeURIComponent(meetingId) + '/documents/warm?username=' +
        encodeURIComponent(username()),
      { method: 'POST', headers: headers(), body: '{}' }
    );
    var data = await parseMeetingApiResponse(res, 'Không sync được tài liệu hot');
    return data.result;
  }

  async function endMeeting(meetingId) {
    var res = await fetch(
      API + '/' + encodeURIComponent(meetingId) + '/sync?username=' +
        encodeURIComponent(username()),
      {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ sync_type: 'meeting_end', username: username() })
      }
    );
    var data = await parseMeetingApiResponse(res, 'Không kết thúc được cuộc họp');
    return data.result;
  }

  async function leaveRoom(meetingId) {
    if (window.PhonghopDocCache && meetingId) {
      await window.PhonghopDocCache.clearMeetingCache(meetingId);
    }
    var res = await fetch(API + '/' + encodeURIComponent(meetingId) + '/room/leave', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ username: username() })
    });
    var data = await parseMeetingApiResponse(res, 'Lỗi rời phòng');
    return data.result;
  }

  async function getRoomState(meetingId) {
    var url = API + '/' + encodeURIComponent(meetingId) + '/room?username=' + encodeURIComponent(username());
    var res = await fetch(url, { headers: headers() });
    var data = await parseMeetingApiResponse(res, 'Không tải phòng họp');
    return data.room;
  }

  async function sendRoomChat(meetingId, message) {
    var res = await fetch(API + '/' + encodeURIComponent(meetingId) + '/room/chat', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ username: username(), message: message })
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Không gửi được tin nhắn');
    return data.message;
  }

  function localDayMs(isoOrDate) {
    var d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
    if (isNaN(d.getTime())) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  /** Cuộc họp «đã qua» khi sang ngày hôm sau (VN) so với ngày lên lịch — trừ khi đang live. */
  function isMeetingPastByDay(m) {
    if (!m) return false;
    var st = (m.status || m.meeting_status || '').toLowerCase();
    if (st === 'live') return false;
    var startIso = m.scheduled_start || m.scheduledStart;
    if (!startIso) return false;
    var meetingDay = localDayMs(startIso);
    if (meetingDay == null) return false;
    return localDayMs(new Date()) > meetingDay;
  }

  function canJoinMeeting(m) {
    if (!m) return false;
    var st = (m.status || m.meeting_status || '').toLowerCase();
    if (st === 'completed' || st === 'cancelled') return false;
    if (st !== 'scheduled' && st !== 'live' && st !== 'draft') return false;
    if (st !== 'live' && isMeetingPastByDay(m)) return false;
    var platform = String(m.platform_type || 'internal').toLowerCase();
    if (platform === 'internal') return true;
    return !!m.firebase_room_id;
  }

  function roomLabel(meeting, rooms) {
    if (!meeting) return '';
    if (meeting.room_code || meeting.room_name) {
      return [meeting.room_code, meeting.room_name].filter(Boolean).join(' — ');
    }
    var rid = meeting.physical_room_id;
    if (!rid || !rooms) return '';
    var r = rooms.find(function (x) { return x.id === rid; });
    return r ? [r.room_code, r.name].filter(Boolean).join(' — ') : '';
  }

  function modeLabel(mode) {
    var map = { hybrid: 'Kết hợp', in_person: 'Tại chỗ', online: 'Trực tuyến' };
    return map[mode] || mode || '—';
  }

  async function loadEmployees(db) {
    var org = await loadOrgDirectory(db);
    return org.personnel.map(function (p) {
      return normalizeEmployee(p, p.id);
    }).filter(Boolean);
  }

  function isInstitutePersonnel(p) {
    var meta = p.metadata || {};
    if (meta.hr_scope === 'production_kh') return false;
    var code = String(p.employeeCode || p.employee_code || p.code || '').toUpperCase();
    if (/^LK-KH-/.test(code)) return false;
    var wg = p.workGroupId || p.work_group_id || '';
    if (wg === 'wg-lk-kh') return false;
    var pos = String(p.position || p.positionName || p.position_name || '').toLowerCase();
    if (/khoán hộ/.test(pos)) return false;
    return true;
  }

  async function loadOrgDirectory(db) {
    if (!db || !db.collection) {
      return { personnel: [], departments: [], teams: [], positions: [], systemRoles: [] };
    }
    try {
      var posSnap = await db.collection('employeePositions').get().catch(function () {
        return { docs: [] };
      });
      var positionsMap = {};
      posSnap.docs.forEach(function (doc) {
        var data = doc.data();
        var userId = data.userId;
        if (!positionsMap[userId]) positionsMap[userId] = [];
        positionsMap[userId].push({
          id: doc.id,
          departmentId: data.departmentId,
          departmentName: data.departmentName,
          positionId: data.positionId,
          positionName: data.positionName,
          isPrimary: data.isPrimary,
          assignmentType: data.assignmentType,
          order: data.order
        });
      });

      var results = await Promise.all([
        db.collection('categoryPersonnel').get(),
        db.collection('categoryDepartments').orderBy('name').get().catch(function () {
          return db.collection('categoryDepartments').get();
        }),
        db.collection('categoryTeams').orderBy('name').get().catch(function () {
          return db.collection('categoryTeams').get();
        }),
        db.collection('categoryPositions').orderBy('name').get().catch(function () {
          return db.collection('categoryPositions').get().catch(function () { return { docs: [] }; });
        }),
        fetch('/api/system-roles').then(function (r) { return r.json(); }).catch(function () { return {}; })
      ]);

      var personnel = results[0].docs.map(function (d) {
        var data = d.data();
        var meta = data.metadata || {};
        return Object.assign({}, data, {
          id: d.id,
          hoTen: data.hoTen || data.name || data.full_name || '',
          employeeCode: data.employeeCode || data.code || data.employee_code || '',
          position: data.position || data.positionName || data.position_name || '',
          positionName: data.positionName || data.position_name || data.position || '',
          orderByDept: data.orderByDept || meta.orderByDept || {},
          listStt: data.listStt != null ? data.listStt : meta.listStt,
          disabled: data.disabled != null ? data.disabled : (data.status === 'inactive' || data.status === 'resigned'),
          concurrentPositions: positionsMap[d.id] || [],
          systemRoleId: meta.systemRoleId || meta.system_role_id || data.systemRoleId || null,
          metadata: meta
        });
      }).filter(isInstitutePersonnel);

      var departments = window.PhonghopOrg.filterDepartments(
        results[1].docs.map(function (d) {
          return Object.assign({ id: d.id }, d.data());
        })
      );

      var teams = results[2].docs.map(function (d) {
        return Object.assign({ id: d.id }, d.data());
      }).filter(function (t) { return !(t.metadata && t.metadata.retired); });

      window.PhonghopOrg.normalizePersonnelDepts(personnel, departments);

      var positions = (results[3].docs || []).map(function (d) {
        return Object.assign({ id: d.id }, d.data());
      });

      var systemRolesBody = results[4] || {};
      var systemRoles = systemRolesBody.roles || [
        { id: 1, role_name: 'Super_Admin' },
        { id: 2, role_name: 'Institute_Executive' },
        { id: 3, role_name: 'Department_Head' },
        { id: 4, role_name: 'Operations_Specialist' },
        { id: 5, role_name: 'Technical_Staff' },
        { id: 6, role_name: 'Staff_Viewer' }
      ];

      personnel.sort(function (a, b) {
        return (a.hoTen || '').localeCompare(b.hoTen || '', 'vi');
      });

      return {
        personnel: personnel,
        departments: departments,
        teams: teams,
        positions: positions,
        systemRoles: systemRoles
      };
    } catch (e) {
      console.warn('[PhonghopServices] loadOrgDirectory', e.message);
      return { personnel: [], departments: [], teams: [], positions: [], systemRoles: [] };
    }
  }

  function findEmployeeByToken(employees, token) {
    if (!token) return null;
    var t = String(token).trim().toLowerCase();
    var tUpper = t.toUpperCase();
    return employees.find(function (e) {
      return e.username === t
        || e.email === t
        || (e.employeeCode && e.employeeCode.toUpperCase() === tUpper)
        || e.id === token;
    }) || null;
  }

  function isPresentableDoc(name, mime) {
    if (isPdfDoc(name, mime)) return true;
    var ext = fileExt(name);
    return ext === '.ppt' || ext === '.pptx';
  }

  async function getPresentationInfo(meetingId, docId) {
    var res = await fetch(
      API + '/' + encodeURIComponent(meetingId) + '/documents/' +
        encodeURIComponent(docId) + '/presentation-info?username=' +
        encodeURIComponent(username()),
      { headers: headers() }
    );
    var data = await parseMeetingApiResponse(res, 'Không đọc được thông tin trình chiếu');
    return data.presentation;
  }

  async function parseMeetingApiResponse(res, fallbackMsg) {
    var text = await res.text();
    var data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (_) {
        if (/^\s*</.test(text)) {
          throw new Error(
            (fallbackMsg || 'Lỗi API') + ' (HTTP ' + res.status + '). Restart Flask và xem log terminal.'
          );
        }
        throw new Error(text.slice(0, 240) || fallbackMsg || 'Lỗi API');
      }
    }
    if (!res.ok) {
      var msg = data && data.message;
      if (Array.isArray(msg)) {
        msg = msg.map(function (e) { return e.msg || JSON.stringify(e); }).join('; ');
      }
      throw new Error(msg || fallbackMsg || 'Lỗi API');
    }
    return data || {};
  }

  async function preparePresentation(meetingId, docId) {
    var res = await fetch(
      API + '/' + encodeURIComponent(meetingId) + '/room/presentation/prepare?username=' +
        encodeURIComponent(username()),
      {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ doc_id: docId, username: username() })
      }
    );
    var data = await parseMeetingApiResponse(res, 'Không chuẩn bị được slide');
    return data.presentation;
  }

  async function startPresentation(meetingId, payload) {
    var res = await fetch(
      API + '/' + encodeURIComponent(meetingId) + '/room/presentation/start?username=' +
        encodeURIComponent(username()),
      {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(Object.assign({ username: username() }, payload))
      }
    );
    var data = await parseMeetingApiResponse(res, 'Không bắt đầu trình chiếu');
    return data.presentation;
  }

  async function updatePresentationSlide(meetingId, slideIndex, slideCount) {
    var body = { slide_index: slideIndex, username: username() };
    if (slideCount != null && slideCount >= 1) {
      body.slide_count = slideCount;
    }
    var res = await fetch(
      API + '/' + encodeURIComponent(meetingId) + '/room/presentation/slide?username=' +
        encodeURIComponent(username()),
      {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify(body)
      }
    );
    var data = await parseMeetingApiResponse(res, 'Không đổi slide');
    return data.presentation;
  }

  async function stopPresentation(meetingId) {
    var res = await fetch(
      API + '/' + encodeURIComponent(meetingId) + '/room/presentation/stop?username=' +
        encodeURIComponent(username()),
      {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ username: username() })
      }
    );
    var data = await parseMeetingApiResponse(res, 'Không dừng trình chiếu');
    return data.result;
  }

  async function startScreenShare(meetingId) {
    var res = await fetch(
      API + '/' + encodeURIComponent(meetingId) + '/room/screen-share/start',
      { method: 'POST', headers: headers(), body: '{}' }
    );
    var data = await parseMeetingApiResponse(res, 'Không bắt đầu được chia sẻ màn hình');
    return data.screen_share;
  }

  async function requestScreenShare(meetingId) {
    var res = await fetch(
      API + '/' + encodeURIComponent(meetingId) + '/room/screen-share/request',
      { method: 'POST', headers: headers(), body: '{}' }
    );
    var data = await parseMeetingApiResponse(res, 'Không gửi được yêu cầu chia sẻ');
    return data.request;
  }

  async function approveScreenShareRequest(meetingId, requestId) {
    var res = await fetch(
      API + '/' + encodeURIComponent(meetingId) + '/room/screen-share/request/' +
        encodeURIComponent(requestId) + '/approve',
      { method: 'POST', headers: headers(), body: '{}' }
    );
    var data = await parseMeetingApiResponse(res, 'Không duyệt được yêu cầu');
    return data.request;
  }

  async function denyScreenShareRequest(meetingId, requestId) {
    var res = await fetch(
      API + '/' + encodeURIComponent(meetingId) + '/room/screen-share/request/' +
        encodeURIComponent(requestId) + '/deny',
      { method: 'POST', headers: headers(), body: '{}' }
    );
    var data = await parseMeetingApiResponse(res, 'Không từ chối được yêu cầu');
    return data.request;
  }

  async function stopScreenShare(meetingId, force) {
    var res = await fetch(
      API + '/' + encodeURIComponent(meetingId) + '/room/screen-share/stop',
      {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ force: !!force })
      }
    );
    return parseMeetingApiResponse(res, 'Không dừng được chia sẻ màn hình');
  }

  async function postScreenShareSignal(meetingId, type, payload, toUsername) {
    var res = await fetch(
      API + '/' + encodeURIComponent(meetingId) + '/room/screen-share/signal',
      {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          type: type,
          payload: payload,
          to_username: toUsername || null
        })
      }
    );
    var data = await parseMeetingApiResponse(res, 'Không gửi được tín hiệu WebRTC');
    return data.signal;
  }

  async function fetchScreenShareSignals(meetingId, since) {
    var url = API + '/' + encodeURIComponent(meetingId) + '/room/screen-share/signals?username=' +
      encodeURIComponent(username());
    if (since) url += '&since=' + encodeURIComponent(since);
    var res = await fetch(url, { headers: headers() });
    var data = await parseMeetingApiResponse(res, 'Không đọc được tín hiệu WebRTC');
    return data.signals || [];
  }

  window.PhonghopServices = {
    listMeetings: listMeetings,
    listRooms: listRooms,
    createMeeting: createMeeting,
    getMeeting: getMeeting,
    updateMeeting: updateMeeting,
    getDocumentShares: getDocumentShares,
    getLibraryDocumentTree: getLibraryDocumentTree,
    browseLibraryFolder: browseLibraryFolder,
    uploadLibraryDocument: uploadLibraryDocument,
    createLibraryFolder: createLibraryFolder,
    uploadMeetingDocument: uploadMeetingDocument,
    createMeetingDocFolder: createMeetingDocFolder,
    setDocumentShares: setDocumentShares,
    openMeetingDocument: openMeetingDocument,
    closeDocViewer: closeDocViewer,
    docOpenLabel: docOpenLabel,
    isPdfDoc: isPdfDoc,
    isOfficeDoc: isOfficeDoc,
    cancelMeeting: cancelMeeting,
    deleteMeeting: deleteMeeting,
    lookupMeetingByCode: lookupMeetingByCode,
    joinRoom: joinRoom,
    leaveRoom: leaveRoom,
    getRoomState: getRoomState,
    sendRoomChat: sendRoomChat,
    canJoinMeeting: canJoinMeeting,
    isMeetingPastByDay: isMeetingPastByDay,
    loadEmployees: loadEmployees,
    loadOrgDirectory: loadOrgDirectory,
    normalizeEmployee: normalizeEmployee,
    findEmployeeByToken: findEmployeeByToken,
    roomLabel: roomLabel,
    modeLabel: modeLabel,
    username: username,
    showDocToast: showDocToast,
    isPresentableDoc: isPresentableDoc,
    preparePresentation: preparePresentation,
    getPresentationInfo: getPresentationInfo,
    startPresentation: startPresentation,
    updatePresentationSlide: updatePresentationSlide,
    stopPresentation: stopPresentation,
    startScreenShare: startScreenShare,
    requestScreenShare: requestScreenShare,
    approveScreenShareRequest: approveScreenShareRequest,
    denyScreenShareRequest: denyScreenShareRequest,
    stopScreenShare: stopScreenShare,
    postScreenShareSignal: postScreenShareSignal,
    fetchScreenShareSignals: fetchScreenShareSignals,
    warmMeetingDocuments: warmMeetingDocuments,
    endMeeting: endMeeting,
    fetchDownloadLink: fetchDownloadLink
  };
})();
