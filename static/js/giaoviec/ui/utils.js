// =============================================
// Utilities
// =============================================
function openModal(id) {
  var el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function closeModal(id) {
  var el = document.getElementById(id);
  if (el) el.classList.remove('active');
}

function showToast(message, type) {
  type = type || 'success';
  var toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(function() { toast.remove(); }, 3500);
}

// =============================================
// Custom Confirm / Alert Dialog
// =============================================
function customConfirm(message, options) {
  options = options || {};
  var title = options.title || 'Xác nhận';
  var okText = options.okText || 'Đồng ý';
  var cancelText = options.cancelText || 'Hủy';
  var icon = options.icon || '❓';
  var danger = options.danger || false;

  return new Promise(function(resolve) {
    var overlay = document.createElement('div');
    overlay.className = 'custom-dialog-overlay';
    overlay.innerHTML =
      '<div class="custom-dialog">' +
        '<div class="custom-dialog-icon">' + icon + '</div>' +
        '<div class="custom-dialog-title">' + title + '</div>' +
        '<div class="custom-dialog-msg">' + message + '</div>' +
        '<div class="custom-dialog-btns">' +
          '<button class="custom-dialog-btn cancel">' + cancelText + '</button>' +
          '<button class="custom-dialog-btn ok' + (danger ? ' danger' : '') + '">' + okText + '</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    requestAnimationFrame(function() { overlay.classList.add('show'); });

    function close(result) {
      overlay.classList.remove('show');
      setTimeout(function() { overlay.remove(); }, 200);
      resolve(result);
    }

    overlay.querySelector('.cancel').onclick = function() { close(false); };
    overlay.querySelector('.ok').onclick = function() { close(true); };
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) close(false);
    });
  });
}

function customAlert(message, options) {
  options = options || {};
  var title = options.title || 'Thông báo';
  var icon = options.icon || 'ℹ️';

  return new Promise(function(resolve) {
    var overlay = document.createElement('div');
    overlay.className = 'custom-dialog-overlay';
    overlay.innerHTML =
      '<div class="custom-dialog">' +
        '<div class="custom-dialog-icon">' + icon + '</div>' +
        '<div class="custom-dialog-title">' + title + '</div>' +
        '<div class="custom-dialog-msg">' + message + '</div>' +
        '<div class="custom-dialog-btns">' +
          '<button class="custom-dialog-btn ok" style="border:none;">OK</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    requestAnimationFrame(function() { overlay.classList.add('show'); });

    function close() {
      overlay.classList.remove('show');
      setTimeout(function() { overlay.remove(); }, 200);
      resolve();
    }

    overlay.querySelector('.ok').onclick = close;
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) close();
    });
  });
}

// =============================================
// Searchable Select Component
// =============================================
function removeDiacritics(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u0111/g, 'd').replace(/\u0110/g, 'D');
}

function closeAllSearchableSelects() {
  document.querySelectorAll('.ss-dropdown').forEach(function(dd) { dd.style.display = 'none'; });
  document.querySelectorAll('.ss-display.open').forEach(function(d) { d.classList.remove('open'); });
}

function initSearchableSelect(container, onChangeCallback) {
  var hiddenInput = container.querySelector('input[type="hidden"]');
  var display = container.querySelector('.ss-display');
  var dropdown = container.querySelector('.ss-dropdown');
  var searchInput = container.querySelector('.ss-search input');
  var optionEls = container.querySelectorAll('.ss-option');
  var emptyEl = container.querySelector('.ss-empty');
  var highlighted = -1;

  function open() {
    closeAllSearchableSelects();
    dropdown.style.display = 'flex';
    display.classList.add('open');
    // Position dropdown below the display using fixed coords
    var rect = display.getBoundingClientRect();
    dropdown.style.left = rect.left + 'px';
    dropdown.style.top = (rect.bottom + 4) + 'px';
    dropdown.style.width = rect.width + 'px';
    searchInput.value = '';
    filterOptions('');
    setTimeout(function() { searchInput.focus(); }, 30);
  }
  function close() {
    dropdown.style.display = 'none';
    display.classList.remove('open');
    highlighted = -1;
    optionEls.forEach(function(o) { o.classList.remove('highlighted'); });
  }
  function selectOption(el) {
    var val = el.getAttribute('data-value');
    hiddenInput.value = val;
    display.querySelector('span').textContent = el.textContent;
    optionEls.forEach(function(o) { o.classList.remove('selected'); });
    el.classList.add('selected');
    close();
    if (onChangeCallback) onChangeCallback(val);
  }
  function filterOptions(q) {
    var qNorm = removeDiacritics(q.toLowerCase().trim());
    var visibleCount = 0;
    optionEls.forEach(function(o) {
      var label = o.textContent || '';
      var labelNorm = removeDiacritics(label.toLowerCase());
      if (!qNorm || labelNorm.indexOf(qNorm) !== -1) {
        o.classList.remove('hidden');
        visibleCount++;
      } else {
        o.classList.add('hidden');
      }
    });
    if (emptyEl) emptyEl.style.display = visibleCount === 0 ? 'block' : 'none';
    highlighted = -1;
  }
  function getVisibleOptions() {
    return Array.prototype.filter.call(optionEls, function(o) { return !o.classList.contains('hidden'); });
  }

  display.addEventListener('click', function(e) {
    e.stopPropagation();
    if (dropdown.style.display === 'flex') close(); else open();
  });
  searchInput.addEventListener('input', function() { filterOptions(this.value); });
  searchInput.addEventListener('keydown', function(e) {
    var visible = getVisibleOptions();
    if (e.key === 'ArrowDown') { e.preventDefault(); highlighted = Math.min(highlighted + 1, visible.length - 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlighted = Math.max(highlighted - 1, 0); }
    else if (e.key === 'Enter') { e.preventDefault(); if (highlighted >= 0 && visible[highlighted]) selectOption(visible[highlighted]); return; }
    else if (e.key === 'Escape') { close(); return; }
    visible.forEach(function(o, i) { o.classList.toggle('highlighted', i === highlighted); });
    if (highlighted >= 0 && visible[highlighted]) visible[highlighted].scrollIntoView({ block: 'nearest' });
  });
  optionEls.forEach(function(o) {
    o.addEventListener('click', function(e) { e.stopPropagation(); selectOption(o); });
  });
  document.addEventListener('click', function handler(e) {
    if (!container.contains(e.target)) close();
  });
  dropdown.style.display = 'none';
}

function buildSearchableSelectHtml(id, options, selectedValue) {
  var selectedLabel = '';
  options.forEach(function(opt) { if (opt.value === (selectedValue || '')) selectedLabel = opt.label; });
  if (!selectedLabel && options.length > 0) selectedLabel = options[0].label;

  var html = '<div class="ss-wrap" id="ssWrap_' + id + '">';
  html += '<input type="hidden" id="' + id + '" value="' + (selectedValue || (options.length > 0 ? options[0].value : '')) + '">';
  html += '<div class="ss-display"><span>' + (selectedLabel || '-- Ch\u1ECDn --') + '</span></div>';
  html += '<div class="ss-dropdown">';
  html += '<div class="ss-search"><input type="text" placeholder="T\u00ECm ki\u1EBFm..." autocomplete="off"></div>';
  html += '<div class="ss-options">';
  options.forEach(function(opt) {
    var cls = opt.value === (selectedValue || '') ? ' selected' : '';
    html += '<div class="ss-option' + cls + '" data-value="' + escapeHtml(opt.value) + '">' + escapeHtml(opt.label) + '</div>';
  });
  html += '</div>';
  html += '<div class="ss-empty" style="display:none;">Kh\u00F4ng t\u00ECm th\u1EA5y</div>';
  html += '</div></div>';
  return html;
}

// =============================================
// Input Modal (thay thế prompt())
// =============================================
// config: { title, fields: [{name, label, type, value, placeholder, required, options:[{value,label}]}], confirmText, cancelText }
// Returns Promise<object|null> — object with field values, or null if cancelled
function showInputModal(config) {
  return new Promise(function(resolve) {
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.style.zIndex = '300';

    var fieldsHtml = '';
    (config.fields || []).forEach(function(f) {
      fieldsHtml += '<div class="im-field">';
      if (f.label) fieldsHtml += '<label>' + f.label + '</label>';
      if (f.type === 'textarea') {
        fieldsHtml += '<textarea id="im_' + f.name + '" placeholder="' + (f.placeholder || '') + '">' + (f.value || '') + '</textarea>';
      } else if (f.type === 'select' && f.searchable) {
        fieldsHtml += buildSearchableSelectHtml('im_' + f.name, f.options || [], f.value || '');
      } else if (f.type === 'select') {
        fieldsHtml += '<select id="im_' + f.name + '">';
        (f.options || []).forEach(function(opt) {
          var sel = opt.value === (f.value || '') ? ' selected' : '';
          fieldsHtml += '<option value="' + escapeHtml(opt.value) + '"' + sel + '>' + escapeHtml(opt.label) + '</option>';
        });
        fieldsHtml += '</select>';
      } else if (f.type === 'number') {
        fieldsHtml += '<input type="number" id="im_' + f.name + '" value="' + (f.value || '') + '" placeholder="' + (f.placeholder || '') + '" step="' + (f.step || 'any') + '" min="' + (f.min !== undefined ? f.min : '') + '" max="' + (f.max !== undefined ? f.max : '') + '">';
      } else {
        fieldsHtml += '<input type="text" id="im_' + f.name + '" value="' + (f.value || '') + '" placeholder="' + (f.placeholder || '') + '">';
      }
      fieldsHtml += '</div>';
    });

    var html = '<div class="modal input-modal">' +
      '<div class="modal-header"><h2>' + (config.title || 'Nhập thông tin') + '</h2><button class="modal-close" id="imClose">&times;</button></div>' +
      '<div class="modal-body">' + fieldsHtml +
      '<div class="im-actions">' +
      '<button class="btn btn-outline" id="imCancel">' + (config.cancelText || 'Hủy') + '</button>' +
      '<button class="btn btn-primary" id="imConfirm">' + (config.confirmText || 'Xác nhận') + '</button>' +
      '</div></div></div>';

    overlay.innerHTML = html;
    document.body.appendChild(overlay);

    // Init searchable selects
    overlay.querySelectorAll('.ss-wrap').forEach(function(wrap) { initSearchableSelect(wrap); });

    // Focus first field
    var firstField = overlay.querySelector('input, textarea, .ss-display');
    if (firstField) setTimeout(function() { firstField.focus(); }, 50);

    function getValues() {
      var values = {};
      (config.fields || []).forEach(function(f) {
        var el = document.getElementById('im_' + f.name);
        values[f.name] = el ? el.value : '';
      });
      return values;
    }

    function close(result) {
      overlay.remove();
      resolve(result);
    }

    overlay.querySelector('#imConfirm').onclick = function() {
      var values = getValues();
      // Check required fields
      var valid = true;
      (config.fields || []).forEach(function(f) {
        if (f.required && !values[f.name].trim()) {
          var el = document.getElementById('im_' + f.name);
          if (el) { el.style.borderColor = 'var(--danger)'; el.focus(); }
          valid = false;
        }
      });
      if (!valid) return;
      close(values);
    };

    overlay.querySelector('#imCancel').onclick = function() { close(null); };
    overlay.querySelector('#imClose').onclick = function() { close(null); };
    overlay.addEventListener('click', function(e) { if (e.target === overlay) close(null); });

    // Enter to submit (for single-field forms without textarea)
    var hasTextarea = (config.fields || []).some(function(f) { return f.type === 'textarea'; });
    if (!hasTextarea) {
      overlay.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { overlay.querySelector('#imConfirm').click(); }
        if (e.key === 'Escape') { close(null); }
      });
    } else {
      overlay.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') { close(null); }
      });
    }
  });
}

function formatDate(d) {
  if (!d) return '';
  return String(d.getDate()).padStart(2, '0') + '/' +
         String(d.getMonth() + 1).padStart(2, '0') + '/' +
         d.getFullYear();
}

function formatDateTime(d) {
  if (!d) return '';
  return formatDate(d) + ' ' +
         String(d.getHours()).padStart(2, '0') + ':' +
         String(d.getMinutes()).padStart(2, '0');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// =============================================
// File Upload to Firebase Storage
// =============================================
function getFileCategory(file) {
  var imageTypes = Config.STORAGE.allowedTypes.image;
  var docTypes = Config.STORAGE.allowedTypes.document;
  if (imageTypes.indexOf(file.type) !== -1) return 'image';
  if (docTypes.indexOf(file.type) !== -1) return 'document';
  return null;
}

function validateFile(file) {
  var category = getFileCategory(file);
  if (!category) {
    return 'Lo\u1EA1i file kh\u00F4ng \u0111\u01B0\u1EE3c h\u1ED7 tr\u1EE3. Ch\u1EC9 ch\u1EA5p nh\u1EADn \u1EA3nh (JPG/PNG/GIF/WebP) v\u00E0 t\u00E0i li\u1EC7u (PDF/DOC/DOCX/XLS/XLSX)';
  }
  var maxSize = Config.STORAGE.maxFileSize[category];
  if (file.size > maxSize) {
    var maxMB = Math.round(maxSize / (1024 * 1024));
    return 'File qu\u00E1 l\u1EDBn. T\u1ED1i \u0111a ' + maxMB + 'MB cho ' + category;
  }
  return null;
}

function uploadFileToStorage(file, storagePath, progressCallback) {
  return new Promise(function(resolve, reject) {
    var storageRef = storage.ref(storagePath);
    var uploadTask = storageRef.put(file);
    uploadTask.on('state_changed',
      function(snapshot) {
        var progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
        if (progressCallback) progressCallback(progress);
      },
      function(error) { reject(error); },
      function() {
        uploadTask.snapshot.ref.getDownloadURL().then(function(downloadURL) {
          resolve(downloadURL);
        }).catch(function(err) { reject(err); });
      }
    );
  });
}

function getFileIcon(fileName, fileType) {
  if (!fileName && !fileType) return '\uD83D\uDCCE';
  var name = (fileName || '').toLowerCase();
  var type = (fileType || '').toLowerCase();
  if (type.indexOf('image') !== -1 || name.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i)) return '\uD83D\uDDBC\uFE0F';
  if (type.indexOf('pdf') !== -1 || name.match(/\.pdf$/i)) return '\uD83D\uDCD5';
  if (type.indexOf('sheet') !== -1 || type.indexOf('excel') !== -1 || name.match(/\.(xlsx?|csv)$/i)) return '\uD83D\uDCCA';
  if (type.indexOf('word') !== -1 || type.indexOf('document') !== -1 || name.match(/\.(docx?|txt)$/i)) return '\uD83D\uDCC4';
  return '\uD83D\uDCCE';
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getStatusLabel(status) {
  var labels = {
    draft: 'Nháp',
    pending_approval: 'Chờ duyệt',
    approved: 'Đã duyệt',
    in_progress: 'Đang thực hiện',
    review: 'Ch\u1EDD ph\u00EA duy\u1EC7t k\u1EBFt qu\u1EA3',
    completed: 'Hoàn thành',
    rejected: 'Từ chối',
    revision: 'Cần soạn lại',
    cancelled: 'Đã hủy',
    archived: 'Lưu trữ'
  };
  return labels[status] || status;
}
