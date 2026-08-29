/**
 * Backup Supabase — admin hub, lưu vào thư mục local (File System Access API).
 */
const RrivAdminBackup = (function () {
  'use strict';

  var IDB_NAME = 'rriv-admin';
  var IDB_STORE = 'handles';
  var IDB_KEY = 'backupDir';
  var DEFAULT_DIR_HINT = 'D:\\BackupSQL';

  function isGlobalAdminClient(user) {
    if (!user) return false;
    if (user.isSuperAdmin === true) return true;
    if (String(user.role || '').toLowerCase() === 'admin') return true;
    var roles = user.systemRoles || user.system_roles || [];
    for (var i = 0; i < roles.length; i++) {
      var n = String(roles[i] || '').toLowerCase().replace(/_/g, '');
      if (n === 'superadmin' || n === 'instituteexecutive') return true;
    }
    return false;
  }

  function currentUsername() {
    var u = (typeof RrivHub !== 'undefined' && RrivHub.getCurrentUser && RrivHub.getCurrentUser())
      || (typeof Auth !== 'undefined' && Auth.getUser && Auth.getUser());
    return u && u.username ? String(u.username).toLowerCase() : '';
  }

  function setPanelVisible(show) {
    var panel = document.getElementById('adminToolsPanel');
    if (!panel) return;
    panel.hidden = !show;
  }

  function checkEligibleOnServer(username) {
    if (!username) return Promise.resolve(false);
    return fetch('/api/admin/backup-eligible?username=' + encodeURIComponent(username), {
      headers: { 'X-RRIV-Username': username }
    }).then(function (res) {
      if (!res.ok) return false;
      return res.json().then(function (body) { return !!body.eligible; });
    }).catch(function () { return false; });
  }

  function openIdb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore(IDB_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function saveDirHandle(handle) {
    return openIdb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
        tx.oncomplete = function () { resolve(handle); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function loadDirHandle() {
    return openIdb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, 'readonly');
        var req = tx.objectStore(IDB_STORE).get(IDB_KEY);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function verifyDirPermission(handle) {
    if (!handle || !handle.queryPermission) return Promise.resolve(false);
    var opts = { mode: 'readwrite' };
    return handle.queryPermission(opts).then(function (state) {
      if (state === 'granted') return true;
      if (!handle.requestPermission) return false;
      return handle.requestPermission(opts).then(function (s) { return s === 'granted'; });
    });
  }

  function pickBackupDirectory() {
    if (!window.showDirectoryPicker) {
      return Promise.reject(new Error('Trình duyệt không hỗ trợ chọn thư mục. Dùng Chrome/Edge mới nhất.'));
    }
    return window.showDirectoryPicker({ mode: 'readwrite' }).then(saveDirHandle);
  }

  function ensureBackupDirectory(forcePick) {
    if (forcePick) return pickBackupDirectory();
    return loadDirHandle().then(function (handle) {
      if (!handle) return pickBackupDirectory();
      return verifyDirPermission(handle).then(function (ok) {
        if (ok) return handle;
        return pickBackupDirectory();
      });
    });
  }

  function writeToDirectory(handle, filename, blob) {
    return handle.getFileHandle(filename, { create: true }).then(function (fileHandle) {
      return fileHandle.createWritable().then(function (writable) {
        return writable.write(blob).then(function () {
          return writable.close();
        });
      });
    });
  }

  function downloadFallback(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function setStatus(text, busy) {
    var el = document.getElementById('adminBackupStatus');
    var btn = document.getElementById('btnAdminBackupDb');
    if (el) el.textContent = text || '';
    if (btn) {
      btn.disabled = !!busy;
      btn.setAttribute('aria-busy', busy ? 'true' : 'false');
    }
  }

  function bindButtons() {
    var btn = document.getElementById('btnAdminBackupDb');
    var pickBtn = document.getElementById('btnAdminPickBackupDir');
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', function () { runBackup(false); });
    }
    if (pickBtn && !pickBtn.dataset.bound) {
      pickBtn.dataset.bound = '1';
      pickBtn.addEventListener('click', chooseFolder);
    }
  }

  function refresh(user) {
    bindButtons();
    var username = (user && user.username) ? String(user.username).toLowerCase() : currentUsername();
    var clientOk = isGlobalAdminClient(user || (typeof RrivHub !== 'undefined' ? RrivHub.getCurrentUser() : null));
    if (clientOk) setPanelVisible(true);
    return checkEligibleOnServer(username).then(function (eligible) {
      setPanelVisible(!!eligible);
      return eligible;
    });
  }

  function chooseFolder() {
    setStatus('Đang mở hộp thoại chọn thư mục…', true);
    return pickBackupDirectory().then(function (handle) {
      setStatus('Đã chọn thư mục: ' + (handle.name || DEFAULT_DIR_HINT), false);
      return handle;
    }).catch(function (err) {
      setStatus('', false);
      alert('Không chọn được thư mục: ' + (err.message || err));
    });
  }

  function runBackup(forcePickFolder) {
    var username = currentUsername();
    if (!username) {
      alert('Vui lòng đăng nhập lại.');
      return Promise.resolve();
    }

    setStatus('Đang tạo backup từ Supabase…', true);

    return fetch('/api/admin/database-backup?username=' + encodeURIComponent(username), {
      method: 'POST',
      headers: {
        'X-RRIV-Username': username
      }
    }).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          throw new Error(body.message || ('HTTP ' + res.status));
        });
      }
      var serverPath = res.headers.get('X-Backup-Saved-Path') || '';
      var filename = res.headers.get('X-Backup-Filename')
        || ('rriv-data-' + new Date().toISOString().slice(0, 10) + '.sql.gz');
      return res.blob().then(function (blob) {
        return { blob: blob, filename: filename, serverPath: serverPath };
      });
    }).then(function (payload) {
      if (payload.serverPath) {
        setStatus('Đã lưu server: ' + payload.serverPath, false);
        return payload;
      }
      if (!window.showDirectoryPicker) {
        downloadFallback(payload.blob, payload.filename);
        setStatus('Đã tải file — kiểm tra thư mục Downloads.', false);
        return payload;
      }
      setStatus('Đang lưu vào thư mục bạn chọn…', true);
      return ensureBackupDirectory(!!forcePickFolder).then(function (handle) {
        return writeToDirectory(handle, payload.filename, payload.blob).then(function () {
          var label = handle.name ? (handle.name + '\\' + payload.filename) : payload.filename;
          setStatus('Đã lưu: ' + label, false);
          return payload;
        });
      }).catch(function () {
        downloadFallback(payload.blob, payload.filename);
        setStatus('Không ghi được thư mục — đã tải file về máy.', false);
        return payload;
      });
    }).catch(function (err) {
      setStatus('', false);
      alert('Backup thất bại: ' + (err.message || err));
    });
  }

  function init(user) {
    refresh(user);
  }

  return {
    isGlobalAdminClient: isGlobalAdminClient,
    init: init,
    refresh: refresh,
    runBackup: runBackup
  };
})();
