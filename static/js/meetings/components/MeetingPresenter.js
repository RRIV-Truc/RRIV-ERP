/**
 * MeetingPresenter.js — trình chiếu dual-screen (app + cửa sổ màn chiếu)
 */
(function () {
  'use strict';

  var _meetingId = null;
  var _prep = null;
  var _active = false;
  var _slideIndex = 0;
  var _slideCount = 0;
  var _screenWin = null;
  var _pdfDoc = null;
  var _pdfUrl = '';
  var _pptxSlides = null;
  var _sessionDocs = [];
  var _keyBound = false;
  var _starting = false;

  function sameUser(a, b) {
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  }

  function setLoading(msg) {
    var host = getHostEl();
    if (!host) return;
    host.innerHTML = '<div class="ph-present-loading"><p class="ph-detail-muted">' +
      esc(msg) + '</p><div class="ph-present-spinner"></div></div>';
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function canPresent() {
    return !!(window.PhonghopPerms && window.PhonghopPerms.canCreateMeeting());
  }

  function isPresentableDoc(name, mime) {
    if (window.PhonghopServices && window.PhonghopServices.isPresentableDoc) {
      return window.PhonghopServices.isPresentableDoc(name, mime);
    }
    var n = String(name || '').toLowerCase();
    return /\.(pdf|ppt|pptx)$/.test(n);
  }

  function isPdfDoc(name, mime) {
    return window.PhonghopServices && window.PhonghopServices.isPdfDoc
      ? window.PhonghopServices.isPdfDoc(name, mime)
      : /\.pdf$/i.test(String(name || ''));
  }

  function authHeaders() {
    var uname = window.PhonghopServices.username && window.PhonghopServices.username();
    return { 'X-RRIV-Username': uname || '' };
  }

  function downloadUrlForDoc(docId, inline) {
    var uname = window.PhonghopServices.username && window.PhonghopServices.username();
    var url = '/api/meetings/' + encodeURIComponent(_meetingId) +
      '/documents/' + encodeURIComponent(docId) +
      '/download?username=' + encodeURIComponent(uname || '') +
      '&presentation=1';
    if (inline !== false) url += '&disposition=inline';
    return url;
  }

  async function fetchPresentationBlob(url) {
    var res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) {
      var detail = '';
      try {
        var err = await res.json();
        detail = err.message ? ': ' + err.message : '';
      } catch (_) { /* ignore */ }
      throw new Error('Không tải được tài liệu trình chiếu' + detail + ' (' + res.status + ')');
    }
    return res.arrayBuffer();
  }

  async function loadPptxSlides(prep) {
    if (!window.PhonghopPptxSlides) {
      throw new Error('Thiếu pptx-slides.js — tải lại trang (Ctrl+F5)');
    }
    var parsed = await window.PhonghopPptxSlides.parseFromUrl(
      prep.download_url,
      authHeaders(),
      _meetingId,
      prep.doc_id
    );
    _pptxSlides = parsed.slides || [];
    return _pptxSlides.length;
  }

  function pptxSlideDataUrl(index) {
    if (_pptxSlides && _pptxSlides[index] && _pptxSlides[index].dataUrl) {
      return _pptxSlides[index].dataUrl;
    }
    if (window.PhonghopPptxSlides && _prep && _prep.doc_id) {
      return window.PhonghopPptxSlides.getSlideDataUrl(_meetingId, _prep.doc_id, index);
    }
    return null;
  }

  function findPdfSibling(docName) {
    var stem = String(docName || '').replace(/\.(pptx|ppt)$/i, '').toLowerCase();
    if (!stem) return null;
    return (_sessionDocs || []).find(function (d) {
      if (d.kind !== 'file' || !isPdfDoc(d.name, d.mime_type)) return false;
      var pdfStem = String(d.name || '').replace(/\.pdf$/i, '').toLowerCase();
      return pdfStem === stem || pdfStem.indexOf(stem) >= 0 || stem.indexOf(pdfStem) >= 0;
    }) || null;
  }

  function loadPdfJs() {
    return new Promise(function (resolve, reject) {
      if (window.pdfjsLib) {
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
          pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }
        resolve(pdfjsLib);
        return;
      }
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      s.onload = function () {
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        resolve(pdfjsLib);
      };
      s.onerror = function () { reject(new Error('Không tải được PDF.js')); };
      document.head.appendChild(s);
    });
  }

  function mapPdfError(err) {
    var msg = String((err && err.message) || err || '');
    if (/disconnected|network|fetch|aborted|timeout/i.test(msg)) {
      return 'Mất kết nối khi tải PDF — restart Flask, đợi 1–2 phút (file lớn) rồi thử lại';
    }
    return msg || 'Không đọc được PDF';
  }

  async function loadPdfDoc(url, isDirect) {
    var pdfjs = await loadPdfJs();
    if (!url) throw new Error('Thiếu link tải PDF');
    if (_pdfDoc && _pdfUrl === url) return _pdfDoc;
    var opts = {
      url: url,
      disableRange: true,
      disableStream: false
    };
    if (!isDirect) {
      opts.httpHeaders = authHeaders();
      opts.withCredentials = false;
    }
    try {
      var timeoutMs = isDirect ? 90000 : 180000;
      var doc = await Promise.race([
        pdfjs.getDocument(opts).promise,
        new Promise(function (_, reject) {
          setTimeout(function () {
            reject(new Error('Timeout tải PDF — thử lại hoặc dùng chế độ iframe'));
          }, timeoutMs);
        })
      ]);
      _pdfDoc = doc;
      _pdfUrl = url;
      return doc;
    } catch (err) {
      throw new Error(mapPdfError(err));
    }
  }

  function pdfIframeSrc(url, pageIndex) {
    if (!url) return '';
    var base = url.split('#')[0];
    return base + '#page=' + (pageIndex + 1);
  }

  async function resolvePdfPresentationUrl(docId) {
    try {
      var link = await window.PhonghopServices.fetchDownloadLink(_meetingId, docId, true);
      if (link && link.url) {
        return { url: link.url, direct: !!link.direct };
      }
    } catch (e) {
      console.warn('[MeetingPresenter] fetchDownloadLink', e);
    }
    return { url: downloadUrlForDoc(docId, true), direct: false };
  }

  function isDirectPdfUrl(url) {
    return /^https?:\/\//i.test(String(url || ''));
  }

  async function refreshPdfSlideCount() {
    if (!_prep || _prep.format !== 'pdf' || !_prep.download_url) return;
    try {
      var doc = await loadPdfDoc(_prep.download_url, !!_prep.direct);
      if (!doc || !doc.numPages) return;
      _slideCount = doc.numPages;
      var countEl = document.querySelector('.ph-presenter-count');
      if (countEl) {
        countEl.textContent = (_slideIndex + 1) + ' / ' + _slideCount;
      }
      if (_meetingId) {
        await window.PhonghopServices.updatePresentationSlide(
          _meetingId, _slideIndex, _slideCount
        );
      }
    } catch (e) {
      console.warn('[MeetingPresenter] refreshPdfSlideCount', e);
    }
  }

  function presentScreenUrl() {
    var uname = window.PhonghopServices.username && window.PhonghopServices.username();
    return '/phonghop/present?meeting=' + encodeURIComponent(_meetingId) +
      '&username=' + encodeURIComponent(uname || '');
  }

  function openScreenWindow() {
    if (_screenWin && !_screenWin.closed) {
      _screenWin.focus();
      return _screenWin;
    }
    _screenWin = window.open(
      presentScreenUrl(),
      'phMeetingPresent',
      'width=1280,height=720,menubar=no,toolbar=no,location=no,status=no'
    );
    if (!_screenWin) {
      alert('Trình duyệt chặn cửa sổ mới. Cho phép popup rồi bấm «Màn chiếu» lại.');
    }
    return _screenWin;
  }

  function closeScreenWindow() {
    if (_screenWin && !_screenWin.closed) {
      try { _screenWin.close(); } catch (_) { /* ignore */ }
    }
    _screenWin = null;
  }

  function getHostEl() {
    return document.getElementById('phPresenterHost');
  }

  function renderHostControls() {
    var host = getHostEl();
    if (!host) return;
    if (!_active) {
      host.innerHTML = '';
      return;
    }
    host.innerHTML =
      '<div class="ph-presenter-bar">' +
        '<div class="ph-presenter-info">' +
          '<strong>Đang chiếu:</strong> ' + esc(_prep && _prep.doc_name) +
          ' <span class="ph-presenter-count">' + (_slideIndex + 1) + ' / ' + _slideCount + '</span>' +
        '</div>' +
        '<div class="ph-presenter-actions">' +
          '<button type="button" class="ph-btn ph-btn-sm" id="phPresentPrev" title="Slide trước">◀ Trước</button>' +
          '<button type="button" class="ph-btn ph-btn-sm" id="phPresentNext" title="Slide sau">Sau ▶</button>' +
          '<button type="button" class="ph-btn ph-btn-sm ph-btn-primary" id="phPresentScreen" title="Mở cửa sổ màn chiếu">🖥 Màn chiếu</button>' +
          '<button type="button" class="ph-btn ph-btn-sm ph-btn-danger" id="phPresentStop">Dừng chiếu</button>' +
        '</div>' +
        '<p class="ph-detail-muted ph-presenter-hint">Kéo cửa sổ «Màn chiếu» sang TV/máy chiếu → bấm <strong>F11</strong>. App giữ nguyên trên laptop.</p>' +
        '<div class="ph-presenter-preview" id="phPresentPreview"></div>' +
      '</div>';

    host.querySelector('#phPresentPrev').addEventListener('click', function () {
      window.MeetingPresenter.prevSlide();
    });
    host.querySelector('#phPresentNext').addEventListener('click', function () {
      window.MeetingPresenter.nextSlide();
    });
    host.querySelector('#phPresentScreen').addEventListener('click', function () {
      openScreenWindow();
    });
    host.querySelector('#phPresentStop').addEventListener('click', function () {
      window.MeetingPresenter.stop();
    });
    renderPreview();
  }

  async function renderPreview() {
    var box = document.getElementById('phPresentPreview');
    if (!box || !_active || !_prep) return;
    box.innerHTML = '<p class="ph-detail-muted">Đang tải xem trước…</p>';
    try {
      if (_prep.format === 'pdf') {
        if (_prep.pdf_iframe || (_prep.direct && _prep.download_url) || isDirectPdfUrl(_prep.download_url)) {
          box.innerHTML = '<iframe class="ph-presenter-preview-iframe" title="PDF" src="' +
            esc(pdfIframeSrc(_prep.download_url, _slideIndex)) + '"></iframe>';
          return;
        }
        if (!_pdfDoc || _pdfUrl !== _prep.download_url) {
          await loadPdfDoc(_prep.download_url, !!_prep.direct);
        }
        var page = await _pdfDoc.getPage(_slideIndex + 1);
        var viewport = page.getViewport({ scale: 1 });
        var scale = Math.min(640 / viewport.width, 360 / viewport.height);
        var vp = page.getViewport({ scale: scale });
        var canvas = document.createElement('canvas');
        canvas.className = 'ph-presenter-preview-canvas';
        canvas.width = vp.width;
        canvas.height = vp.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        box.innerHTML = '';
        box.appendChild(canvas);
        return;
      }
      if (_prep.format === 'pptx') {
        var dataUrl = pptxSlideDataUrl(_slideIndex);
        if (!dataUrl) throw new Error('Không đọc được slide PowerPoint');
        box.innerHTML = '<img class="ph-presenter-preview-img" alt="" src="' + esc(dataUrl) + '">';
        return;
      }
      var uname = window.PhonghopServices.username && window.PhonghopServices.username();
      var src = _prep.slides_base_url + '/' + _slideIndex +
        '?username=' + encodeURIComponent(uname || '');
      box.innerHTML = '<img class="ph-presenter-preview-img" alt="" src="' + esc(src) + '">';
    } catch (e) {
      box.innerHTML = '<p class="ph-detail-muted">' + esc(e.message || 'Không xem trước được') + '</p>';
    }
  }

  function bindKeyboard() {
    if (_keyBound) return;
    _keyBound = true;
    document.addEventListener('keydown', function (e) {
      if (!_active) return;
      var tag = (e.target && e.target.tagName) || '';
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        window.MeetingPresenter.nextSlide();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        window.MeetingPresenter.prevSlide();
      }
    });
  }

  async function syncSlide(index, slideCount) {
    _slideIndex = Math.max(0, Math.min(index, Math.max(_slideCount, 1) - 1));
    renderHostControls();
    if (!_meetingId) return;
    await window.PhonghopServices.updatePresentationSlide(
      _meetingId, _slideIndex, slideCount != null ? slideCount : undefined
    );
  }

  async function renderFollowPdf(presentation, slideIndex) {
    var box = document.getElementById('phPresentFollowPdf');
    if (!box || !presentation || !presentation.doc_id) return;
    var url = presentation.download_url || downloadUrlForDoc(presentation.doc_id, true);
    var useIframe = presentation.pdf_iframe || presentation.direct || isDirectPdfUrl(url);
    if (useIframe) {
      box.innerHTML = '<iframe class="ph-present-follow-iframe" title="PDF" src="' +
        esc(pdfIframeSrc(url, slideIndex)) + '"></iframe>';
      return;
    }
    box.innerHTML = '<p class="ph-detail-muted">Đang tải slide…</p>';
    try {
      if (!_pdfDoc || _pdfUrl !== url) {
        await loadPdfDoc(url, false);
      }
      var page = await _pdfDoc.getPage(slideIndex + 1);
      var viewport = page.getViewport({ scale: 1 });
      var scale = Math.min(720 / viewport.width, 405 / viewport.height);
      var vp = page.getViewport({ scale: scale });
      var canvas = document.createElement('canvas');
      canvas.className = 'ph-present-follow-canvas';
      canvas.width = vp.width;
      canvas.height = vp.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      box.innerHTML = '';
      box.appendChild(canvas);
    } catch (e) {
      box.innerHTML = '<iframe class="ph-present-follow-iframe" title="PDF" src="' +
        esc(pdfIframeSrc(url, slideIndex)) + '"></iframe>';
    }
  }

  function buildPickerHtml(docs) {
    _sessionDocs = docs || [];
    var items = (_sessionDocs || []).filter(function (d) {
      return d.kind === 'file' && isPresentableDoc(d.name, d.mime_type);
    });
    items.sort(function (a, b) {
      var ap = isPdfDoc(a.name, a.mime_type) ? 0 : 1;
      var bp = isPdfDoc(b.name, b.mime_type) ? 0 : 1;
      return ap - bp || String(a.name).localeCompare(String(b.name), 'vi');
    });
    if (!items.length) {
      return '<p class="ph-detail-muted">Chưa có PDF/PowerPoint được chia sẻ. Thư ký tick tài liệu ở <strong>Sửa cuộc họp</strong>.</p>';
    }
    return '<ul class="ph-present-picker">' + items.map(function (d) {
      var pdf = isPdfDoc(d.name, d.mime_type);
      var badge = pdf
        ? ' <span class="ph-present-badge">Khuyên dùng</span>'
        : ' <span class="ph-present-badge ph-present-badge-alt">PPTX</span>';
      return '<li><button type="button" class="ph-btn ph-btn-block ph-present-pick" data-id="' +
        esc(d.id) + '" data-name="' + esc(d.name) + '">' +
        (pdf ? '📄 ' : '📊 ') + esc(d.name) + badge + '</button></li>';
    }).join('') + '</ul>';
  }

  function showPicker(docs) {
    var host = getHostEl();
    if (!host) return;
    host.innerHTML =
      '<div class="ph-present-picker-wrap">' +
        '<p class="ph-detail-muted">Chọn file để trình chiếu lên màn hình lớn. Laptop giữ giao diện app.</p>' +
        buildPickerHtml(docs) +
      '</div>';
    host.querySelectorAll('.ph-present-pick').forEach(function (btn) {
      btn.addEventListener('click', function () {
        window.MeetingPresenter.start(btn.getAttribute('data-id'), btn.getAttribute('data-name'));
      });
    });
  }

  window.MeetingPresenter = {
    canPresent: canPresent,

    mountIdle: function (docs) {
      if (!canPresent()) return;
      var host = getHostEl();
      if (!host) return;
      if (_active) {
        renderHostControls();
        return;
      }
      host.innerHTML =
        '<div class="ph-content-actions">' +
          '<article class="ph-content-card">' +
            '<span class="ph-content-badge ph-content-badge-host">Chủ trì</span>' +
            '<h4>Chia sẻ màn hình / PowerPoint</h4>' +
            '<p>Trình chiếu slide lên TV/máy chiếu — app giữ điều khiển trên laptop.</p>' +
            '<button type="button" class="ph-btn ph-btn-primary" id="phPresentStart">Chia sẻ slide</button>' +
          '</article>' +
        '</div>';
      var startBtn = host.querySelector('#phPresentStart');
      if (startBtn) {
        startBtn.addEventListener('click', function () {
          showPicker(docs);
        });
      }
    },

    followPresentation: function (presentation) {
      var host = document.getElementById('phPresentFollow');
      if (!host) return;
      if (!presentation || !presentation.active) {
        host.innerHTML = '';
        host.hidden = true;
        return;
      }
      host.hidden = false;
      var uname = window.PhonghopServices.username && window.PhonghopServices.username();
      var idx = presentation.slide_index || 0;
      var html =
        '<div class="ph-present-follow">' +
          '<p class="ph-present-follow-label">🎬 ' + esc(presentation.doc_name) +
          ' · slide ' + (idx + 1) + '/' + (presentation.slide_count || '?') +
          ' · ' + esc(presentation.presenter_name || '') + '</p>';
      if (presentation.mode === 'images') {
        var base = presentation.slides_base_url ||
          ('/api/meetings/' + encodeURIComponent(_meetingId || '') +
            '/documents/' + encodeURIComponent(presentation.doc_id) + '/slides');
        html += '<img class="ph-present-follow-img" alt="" src="' +
          esc(base + '/' + idx + '?username=' + encodeURIComponent(uname || '')) + '">';
      } else if (presentation.mode === 'pptx') {
        var pptxUrl = window.PhonghopPptxSlides &&
          window.PhonghopPptxSlides.getSlideDataUrl(_meetingId, presentation.doc_id, idx);
        if (pptxUrl) {
          html += '<img class="ph-present-follow-img" alt="" src="' + esc(pptxUrl) + '">';
        } else {
          html += '<p class="ph-detail-muted">Đang tải slide PowerPoint…</p>';
        }
      } else if (presentation.mode === 'pdf') {
        html += '<div class="ph-present-follow-pdf" id="phPresentFollowPdf"></div>';
      } else {
        html += '<p class="ph-detail-muted">Xem slide trên màn chiếu phòng hoặc mở tab «Màn chiếu».</p>';
      }
      html += '</div>';
      host.innerHTML = html;
      if (presentation.mode === 'pdf') {
        renderFollowPdf(presentation, idx);
      } else if (presentation.mode === 'pptx' && window.PhonghopPptxSlides &&
          !window.PhonghopPptxSlides.getSlideDataUrl(_meetingId, presentation.doc_id, idx)) {
        var dl = presentation.download_url || downloadUrlForDoc(presentation.doc_id);
        window.PhonghopPptxSlides.parseFromUrl(
          dl, authHeaders(), _meetingId, presentation.doc_id
        ).then(function () {
          window.MeetingPresenter.followPresentation(presentation);
        }).catch(function () { /* ignore */ });
      }
    },

    syncFromRoom: function (meetingId, presentation) {
      _meetingId = meetingId || _meetingId;
      if (_starting) return;
      if (!presentation || !presentation.active) {
        if (!_active && !canPresent()) {
          this.followPresentation(null);
        }
        return;
      }
      var uname = window.PhonghopServices.username && window.PhonghopServices.username();
      if (canPresent() && sameUser(presentation.presenter_username, uname)) {
        _active = true;
        _prep = {
          format: presentation.mode,
          doc_id: presentation.doc_id,
          doc_name: presentation.doc_name,
          download_url: presentation.download_url,
          slides_base_url: presentation.slides_base_url,
          direct: presentation.direct,
          pdf_iframe: presentation.pdf_iframe
        };
        _slideIndex = presentation.slide_index || 0;
        _slideCount = presentation.slide_count || 0;
        renderHostControls();
        var followHost = document.getElementById('phPresentFollow');
        if (followHost) { followHost.innerHTML = ''; followHost.hidden = true; }
      } else {
        this.followPresentation(presentation);
      }
    },

    start: async function (docId, docName) {
      if (!canPresent()) {
        alert('Bạn không có quyền trình chiếu (cần vai trò Chủ trì / Thư ký).');
        return;
      }
      if (!_meetingId) {
        alert('Chưa vào phiên họp — không trình chiếu được.');
        return;
      }
      var host = getHostEl();
      _starting = true;
      setLoading('Đang chuẩn bị trình chiếu…');
      try {
        if (isPdfDoc(docName)) {
          setLoading('Đang kết nối PDF…');
          var info = await window.PhonghopServices.getPresentationInfo(_meetingId, docId);
          _prep = info;
          _prep.doc_id = docId;
          _prep.doc_name = docName || _prep.doc_name;
          var resolved = await resolvePdfPresentationUrl(docId);
          if (resolved.url) {
            _prep.download_url = resolved.url;
            _prep.direct = resolved.direct;
          }
          if (!_prep.download_url) {
            _prep.download_url = downloadUrlForDoc(docId, true);
          }
          if (_prep.direct || isDirectPdfUrl(_prep.download_url)) {
            _prep.pdf_iframe = true;
            _slideCount = 999;
          } else {
            await loadPdfDoc(_prep.download_url, false);
            _slideCount = _pdfDoc.numPages;
          }
        } else {
          setLoading('Đang đọc PowerPoint…');
          _prep = await window.PhonghopServices.preparePresentation(_meetingId, docId);
          _prep.doc_id = docId;
          _prep.doc_name = docName || _prep.doc_name;
          if (_prep.format === 'pptx' && !_prep.download_url) {
            _prep.download_url = downloadUrlForDoc(docId, false);
          }
          if (_prep.format === 'pptx') {
            _slideCount = await loadPptxSlides(_prep);
          } else {
            _slideCount = parseInt(_prep.slide_count, 10) || 0;
          }
        }

        if (_slideCount < 1) throw new Error('Tài liệu không có slide');

        setLoading('Đang đồng bộ phòng họp…');
        await window.PhonghopServices.startPresentation(_meetingId, {
          doc_id: docId,
          doc_name: _prep.doc_name,
          slide_count: _slideCount,
          mode: _prep.format,
          download_url: _prep.download_url || '',
          direct: !!_prep.direct,
          pdf_iframe: !!_prep.pdf_iframe
        });

        _active = true;
        _slideIndex = 0;
        bindKeyboard();
        renderHostControls();
        openScreenWindow();

        if (_prep.format === 'pdf' && _prep.pdf_iframe) {
          refreshPdfSlideCount();
        }

        if (window.PhonghopServices.showDocToast) {
          window.PhonghopServices.showDocToast(
            'Đang chiếu — bấm «Màn chiếu» nếu chưa thấy cửa sổ popup', 6000
          );
        }
      } catch (e) {
        var pdfSibling = findPdfSibling(docName);
        if (host) {
          var extra = pdfSibling
            ? '<button type="button" class="ph-btn ph-btn-primary" id="phPresentUsePdf">Trình chiếu bản PDF: ' +
              esc(pdfSibling.name) + '</button><br>'
            : '';
          host.innerHTML = '<p class="ph-detail-muted ph-present-error">' +
            esc(e.message || 'Không trình chiếu được') + '</p>' + extra +
            '<button type="button" class="ph-btn" id="phPresentRetry">Thử lại</button>';
          var usePdf = host.querySelector('#phPresentUsePdf');
          if (usePdf) {
            usePdf.addEventListener('click', function () {
              window.MeetingPresenter.start(pdfSibling.id, pdfSibling.name);
            });
          }
          var retry = host.querySelector('#phPresentRetry');
          if (retry) {
            retry.addEventListener('click', function () {
              window.MeetingPresenter.mountIdle(_sessionDocs);
            });
          }
        }
      } finally {
        _starting = false;
      }
    },

    nextSlide: function () {
      if (!_active || _slideIndex >= _slideCount - 1) return;
      syncSlide(_slideIndex + 1);
    },

    prevSlide: function () {
      if (!_active || _slideIndex <= 0) return;
      syncSlide(_slideIndex - 1);
    },

    stop: async function () {
      if (!_meetingId) return;
      try {
        await window.PhonghopServices.stopPresentation(_meetingId);
      } catch (_) { /* ignore */ }
      _active = false;
      _prep = null;
      _pdfDoc = null;
      _pptxSlides = null;
      closeScreenWindow();
      var host = getHostEl();
      if (host) host.innerHTML = '<p class="ph-detail-muted">Đã dừng trình chiếu.</p>';
    },

    setMeetingId: function (id) {
      _meetingId = id;
    },

    cleanup: function () {
      if (_active) {
        this.stop();
      } else {
        closeScreenWindow();
      }
    }
  };
})();
