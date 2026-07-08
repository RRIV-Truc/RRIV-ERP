/* sanxuat-dialog.js — custom confirm/alert */
(function() {
  var _resolve = null;
  var dlg = document.getElementById('customDialog');
  var backdrop = document.getElementById('customDialogBackdrop');

  function _show(opts) {
    var icon = document.getElementById('customDialogIcon');
    var title = document.getElementById('customDialogTitle');
    var msg = document.getElementById('customDialogMsg');
    var actions = document.getElementById('customDialogActions');

    var isDanger = opts.danger || /xóa|xoá|xóa toàn bộ/i.test(opts.message || '');
    var isConfirm = opts.type === 'confirm';

    // Icon
    if (isDanger) {
      icon.style.background = 'rgba(239,68,68,0.1)';
      icon.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';
    } else {
      icon.style.background = 'rgba(0,104,255,0.1)';
      icon.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0068FF" stroke-width="2"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';
    }

    title.textContent = opts.title || (isDanger ? 'Xác nhận' : (isConfirm ? 'Xác nhận' : 'Thông báo'));
    msg.textContent = opts.message || '';

    var html = '';
    if (isConfirm) {
      html += '<button class="dlg-cancel" onclick="window._dlgResolve(false)">Hủy</button>';
      html += '<button class="' + (isDanger ? 'dlg-danger' : 'dlg-ok') + '" onclick="window._dlgResolve(true)">' + (isDanger ? 'Xóa' : 'Đồng ý') + '</button>';
    } else {
      html += '<button class="dlg-ok" onclick="window._dlgResolve(true)">OK</button>';
    }
    actions.innerHTML = html;

    dlg.style.display = 'flex';
  }

  function _hide() {
    dlg.style.display = 'none';
  }

  window._dlgResolve = function(val) {
    _hide();
    if (_resolve) { var r = _resolve; _resolve = null; r(val); }
  };

  backdrop.addEventListener('click', function() { window._dlgResolve(false); });

  // Override native confirm
  var _nativeConfirm = window.confirm;
  window.confirm = function(message) {
    // Return a "thenable" that also works synchronously via blocking pattern
    // Since we can't truly block, we use async approach
    // But most code uses: if (!(await showConfirm(...))) return;
    // So we need synchronous behavior - fall back to showing dialog and returning promise
    // Unfortunately, true async confirm requires refactoring all callers
    // Instead, we show the custom UI but still use native for sync flow
    return _nativeConfirm.call(window, message);
  };

  // Async confirm that can be used by new code
  window.showConfirm = function(message, title) {
    return new Promise(function(resolve) {
      _resolve = resolve;
      _show({ type: 'confirm', message: message, title: title || '' });
    });
  };

  window.showAlert = function(message, title) {
    return new Promise(function(resolve) {
      _resolve = resolve;
      _show({ type: 'alert', message: message, title: title || '' });
    });
  };
})();
