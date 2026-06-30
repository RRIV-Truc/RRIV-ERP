/**
 * PWA RRIV ERP — cài đặt từ hub, đăng ký Service Worker chung.
 */
var RrivPWA = (function () {
  'use strict';

  var deferredPrompt = null;
  var swReady = false;
  var promptWaiters = [];

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  }

  function isAndroid() {
    return /Android/i.test(navigator.userAgent);
  }

  function hideInstallBanner() {
    var banner = document.getElementById('installAppBanner');
    if (banner) banner.style.display = 'none';
  }

  function showInstallBanner() {
    if (isStandalone()) {
      hideInstallBanner();
      return;
    }
    var banner = document.getElementById('installAppBanner');
    if (banner) banner.style.display = 'flex';
  }

  function setBannerLoading(loading) {
    var banner = document.getElementById('installAppBanner');
    if (!banner) return;
    banner.setAttribute('aria-busy', loading ? 'true' : 'false');
    banner.style.opacity = loading ? '0.75' : '1';
    banner.style.pointerEvents = loading ? 'none' : 'auto';
    var label = banner.querySelector('.install-app-text strong');
    if (label) {
      label.textContent = loading ? 'Đang chuẩn bị cài đặt...' : 'Cài đặt App lên điện thoại';
    }
  }

  function closeOverlay(id) {
    var el = document.getElementById(id);
    if (el) el.remove();
  }

  function showModal(id, title, bodyHtml, primaryLabel) {
    closeOverlay(id);
    var overlay = document.createElement('div');
    overlay.id = id;
    overlay.className = 'rriv-pwa-overlay';
    overlay.innerHTML =
      '<div class="rriv-pwa-card" role="dialog" aria-modal="true" aria-labelledby="' + id + '-title">' +
      '<h3 id="' + id + '-title">' + title + '</h3>' +
      '<div class="rriv-pwa-body">' + bodyHtml + '</div>' +
      '<button type="button" class="rriv-pwa-primary">' + (primaryLabel || 'Đã hiểu') + '</button>' +
      '</div>';
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeOverlay(id);
    });
    overlay.querySelector('.rriv-pwa-primary').addEventListener('click', function () {
      closeOverlay(id);
    });
    document.body.appendChild(overlay);
    return overlay;
  }

  function showIOSHint() {
    showModal(
      'rrivPwaIosHint',
      'Thêm RRIV ERP vào Màn hình chính',
      '<ol class="rriv-pwa-steps">' +
      '<li>Mở trang này bằng <strong>Safari</strong> (không dùng Chrome/Facebook).</li>' +
      '<li>Nhấn nút <strong>Chia sẻ</strong> ở thanh dưới màn hình.</li>' +
      '<li>Chọn <strong>Thêm vào Màn hình chính</strong>.</li>' +
      '<li>Nhấn <strong>Thêm</strong> để hoàn tất.</li>' +
      '</ol>'
    );
  }

  function showManualInstallHint() {
    if (isAndroid()) {
      showModal(
        'rrivPwaAndroidHint',
        'Cài RRIV ERP trên Android',
        '<ol class="rriv-pwa-steps">' +
        '<li>Nhấn menu <strong>⋮</strong> góc trên phải Chrome.</li>' +
        '<li>Chọn <strong>Cài đặt ứng dụng</strong> hoặc <strong>Thêm vào Màn hình chính</strong>.</li>' +
        '<li>Nhấn <strong>Cài đặt</strong> để xác nhận.</li>' +
        '</ol>' +
        '<p class="rriv-pwa-note">Nếu không thấy mục trên, hãy tải lại trang sau khi đăng nhập rồi bấm lại nút cài đặt.</p>'
      );
      return;
    }
    showModal(
      'rrivPwaDesktopHint',
      'Cài RRIV ERP trên máy tính',
      '<ol class="rriv-pwa-steps">' +
      '<li>Trên Chrome/Edge: nhấn biểu tượng <strong>⊕ Cài đặt</strong> trên thanh địa chỉ, hoặc</li>' +
      '<li>Menu <strong>⋮</strong> → <strong>Cài đặt RRIV ERP</strong> / <strong>Install app</strong>.</li>' +
      '</ol>' +
      '<p class="rriv-pwa-note">Ứng dụng sẽ mở như phần mềm độc lập, không cần tab trình duyệt.</p>'
    );
  }

  function captureDeferredPrompt(e) {
    e.preventDefault();
    deferredPrompt = e;
    showInstallBanner();
    promptWaiters.splice(0).forEach(function (resolve) { resolve(e); });
  }

  window.addEventListener('beforeinstallprompt', captureDeferredPrompt);

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    hideInstallBanner();
    showModal(
      'rrivPwaInstalled',
      'Đã cài đặt thành công',
      '<p>RRIV ERP đã được thêm vào thiết bị. Mở từ biểu tượng trên Màn hình chính hoặc menu ứng dụng.</p>',
      'Tuyệt vời'
    );
  });

  function waitForPrompt(ms) {
    if (deferredPrompt) return Promise.resolve(deferredPrompt);
    return new Promise(function (resolve) {
      var timer = setTimeout(function () { resolve(null); }, ms);
      promptWaiters.push(function (ev) {
        clearTimeout(timer);
        resolve(ev);
      });
    });
  }

  function notifyUpdate(registration) {
    registration.addEventListener('updatefound', function () {
      var worker = registration.installing;
      if (!worker) return;
      worker.addEventListener('statechange', function () {
        if (worker.state !== 'installed' || !navigator.serviceWorker.controller) return;
        showModal(
          'rrivPwaUpdate',
          'Có bản cập nhật mới',
          '<p>Phiên bản mới của RRIV ERP đã sẵn sàng. Tải lại để dùng bản mới nhất.</p>',
          'Tải lại ngay'
        );
        var btn = document.querySelector('#rrivPwaUpdate .rriv-pwa-primary');
        if (btn) {
          btn.addEventListener('click', function () {
            worker.postMessage({ type: 'SKIP_WAITING' });
            window.location.reload();
          });
        }
        if (typeof showToast === 'function') {
          showToast('Có bản cập nhật RRIV. Tải lại trang để áp dụng.', 'info');
        }
      });
    });
  }

  function register() {
    if (!('serviceWorker' in navigator)) return Promise.resolve(null);
    if (swReady) return navigator.serviceWorker.ready;
    return navigator.serviceWorker.register('/sw-erp.js', { scope: '/' })
      .then(function (reg) {
        swReady = true;
        notifyUpdate(reg);
        return navigator.serviceWorker.ready;
      })
      .catch(function (err) {
        console.warn('RrivPWA SW:', err.message || err);
        return null;
      });
  }

  async function install() {
    if (isStandalone()) {
      showModal(
        'rrivPwaAlready',
        'Ứng dụng đã được cài',
        '<p>Bạn đang dùng RRIV ERP ở chế độ ứng dụng (PWA).</p>'
      );
      return false;
    }

    setBannerLoading(true);
    try {
      await register();

      if (isIOS()) {
        showIOSHint();
        return false;
      }

      var promptEvent = deferredPrompt || await waitForPrompt(2000);

      if (promptEvent) {
        await promptEvent.prompt();
        var choice = await promptEvent.userChoice;
        deferredPrompt = null;
        if (choice.outcome === 'accepted') {
          hideInstallBanner();
          return true;
        }
        showManualInstallHint();
        return false;
      }

      showManualInstallHint();
      return false;
    } catch (err) {
      console.warn('RrivPWA install:', err);
      showManualInstallHint();
      return false;
    } finally {
      setBannerLoading(false);
    }
  }

  function init() {
    if (isStandalone()) {
      hideInstallBanner();
    } else {
      showInstallBanner();
    }
    register();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.installPWA = function (event) {
    if (event && event.preventDefault) event.preventDefault();
    return install();
  };

  return {
    install: install,
    register: register,
    isStandalone: isStandalone,
    isIOS: isIOS,
    showInstallBanner: showInstallBanner,
    hideInstallBanner: hideInstallBanner
  };
})();
