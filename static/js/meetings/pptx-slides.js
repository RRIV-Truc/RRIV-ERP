/**
 * pptx-slides.js — đọc PPTX trong trình duyệt (không cần LibreOffice trên server)
 */
(function (global) {
  'use strict';

  var _jszipPromise = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + src + '"]')) {
        resolve();
        return;
      }
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Không tải được ' + src)); };
      document.head.appendChild(s);
    });
  }

  function ensureJSZip() {
    if (global.JSZip) return Promise.resolve(global.JSZip);
    if (!_jszipPromise) {
      _jszipPromise = loadScript(
        'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'
      ).then(function () {
        if (!global.JSZip) throw new Error('JSZip không khả dụng');
        return global.JSZip;
      });
    }
    return _jszipPromise;
  }

  function emuToPx(emu) {
    return Math.max(1, Math.round(Number(emu || 0) / 9525));
  }

  function parseXml(text) {
    return new DOMParser().parseFromString(text, 'application/xml');
  }

  function collectRels(relsXml) {
    var map = {};
    var doc = parseXml(relsXml);
    var nodes = doc.getElementsByTagName('Relationship');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      map[el.getAttribute('Id')] = el.getAttribute('Target');
    }
    return map;
  }

  function blobToImage(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('Không đọc được ảnh slide'));
      };
      img.src = url;
    });
  }

  function resolveMediaPath(target) {
    var t = String(target || '').replace(/^\.\.\//, '');
    if (t.indexOf('ppt/') !== 0) t = 'ppt/' + t.replace(/^\//, '');
    return t;
  }

  function extractSlideText(slideXml) {
    var doc = parseXml(slideXml);
    var parts = [];
    var nodes = doc.getElementsByTagNameNS('*', 't');
    for (var i = 0; i < nodes.length; i++) {
      var txt = (nodes[i].textContent || '').trim();
      if (txt) parts.push(txt);
    }
    return parts.join('\n');
  }

  async function mediaFromSlide(zip, rels) {
    var out = [];
    var keys = Object.keys(rels);
    for (var i = 0; i < keys.length; i++) {
      var target = resolveMediaPath(rels[keys[i]]);
      if (target.indexOf('/media/') < 0 && target.indexOf('\\media\\') < 0) continue;
      var file = zip.file(target);
      if (!file) continue;
      out.push(await file.async('blob'));
    }
    return out;
  }

  async function renderSlideToCanvas(zip, slideXml, relsXml, width, height) {
    var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    var rels = collectRels(relsXml);
    var blobs = await mediaFromSlide(zip, rels);

    if (!blobs.length) {
      var text = extractSlideText(slideXml);
      ctx.fillStyle = '#0f172a';
      ctx.font = '24px system-ui, sans-serif';
      var lines = (text || 'Slide').split('\n');
      var y = 64;
      for (var li = 0; li < lines.length && li < 12; li++) {
        ctx.fillText(lines[li].slice(0, 80), 48, y, width - 96);
        y += 34;
      }
      return canvas;
    }

    var gap = 8;
    var cellH = Math.floor((height - gap * (blobs.length - 1)) / blobs.length);
    for (var bi = 0; bi < blobs.length; bi++) {
      var img = await blobToImage(blobs[bi]);
      var scale = Math.min(width / img.width, cellH / img.height);
      var w = img.width * scale;
      var h = img.height * scale;
      var x = (width - w) / 2;
      var y0 = bi * (cellH + gap) + (cellH - h) / 2;
      ctx.drawImage(img, x, y0, w, h);
    }
    return canvas;
  }

  async function parsePptx(buffer) {
    var JSZip = await ensureJSZip();
    var zip = await JSZip.loadAsync(buffer);
    var presFile = zip.file('ppt/presentation.xml');
    if (!presFile) throw new Error('File PowerPoint không hợp lệ');

    var presXml = await presFile.async('text');
    var pres = parseXml(presXml);
    var szList = pres.getElementsByTagNameNS('*', 'sldSz');
    var sz = szList.length ? szList[0] : null;
    var width = sz ? emuToPx(sz.getAttribute('cx')) : 960;
    var height = sz ? emuToPx(sz.getAttribute('cy')) : 540;

    var slidePaths = Object.keys(zip.files).filter(function (f) {
      return /^ppt\/slides\/slide\d+\.xml$/i.test(f);
    }).sort(function (a, b) {
      return parseInt(a.match(/(\d+)/)[1], 10) - parseInt(b.match(/(\d+)/)[1], 10);
    });

    if (!slidePaths.length) throw new Error('PowerPoint không có slide');

    var slides = [];
    for (var si = 0; si < slidePaths.length; si++) {
      var path = slidePaths[si];
      var num = path.match(/(\d+)/)[1];
      var relsPath = 'ppt/slides/_rels/slide' + num + '.xml.rels';
      var slideXml = await zip.file(path).async('text');
      var relsFile = zip.file(relsPath);
      var relsXml = relsFile
        ? await relsFile.async('text')
        : '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
      var canvas = await renderSlideToCanvas(zip, slideXml, relsXml, width, height);
      slides.push({
        index: si,
        dataUrl: canvas.toDataURL('image/jpeg', 0.92),
        width: width,
        height: height
      });
    }

    return { slides: slides, slideCount: slides.length, width: width, height: height };
  }

  function cacheKey(meetingId, docId) {
    return 'ph_pptx_cache_' + meetingId + '_' + docId;
  }

  function saveCache(meetingId, docId, parsed) {
    try {
      sessionStorage.setItem(cacheKey(meetingId, docId), JSON.stringify({
        slideCount: parsed.slideCount,
        slides: parsed.slides.map(function (s) { return s.dataUrl; })
      }));
    } catch (_) { /* quota */ }
  }

  function loadCache(meetingId, docId) {
    try {
      var raw = sessionStorage.getItem(cacheKey(meetingId, docId));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  global.PhonghopPptxSlides = {
    parse: parsePptx,

    parseFromUrl: async function (url, headers, meetingId, docId) {
      if (meetingId && docId) {
        var cached = loadCache(meetingId, docId);
        if (cached && cached.slides && cached.slides.length) {
          return {
            slides: cached.slides.map(function (dataUrl, index) {
              return { index: index, dataUrl: dataUrl };
            }),
            slideCount: cached.slideCount
          };
        }
      }
      var res = await fetch(url, { headers: headers || {} });
      if (!res.ok) throw new Error('Không tải được PowerPoint');
      var parsed = await parsePptx(await res.arrayBuffer());
      if (meetingId && docId) saveCache(meetingId, docId, parsed);
      return parsed;
    },

    getSlideDataUrl: function (meetingId, docId, index) {
      var cached = loadCache(meetingId, docId);
      if (!cached || !cached.slides) return null;
      return cached.slides[index] || null;
    },

    clearCache: function (meetingId, docId) {
      try { sessionStorage.removeItem(cacheKey(meetingId, docId)); } catch (_) {}
    }
  };
})(window);
