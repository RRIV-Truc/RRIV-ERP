/**
 * ModalForm - Reusable modal form component
 * Auto-populate, collect, validate, and save data
 * Supports text, number, date, select, textarea, checkbox, custom HTML
 *
 * @module ModalForm
 *
 * Usage:
 *   const modal = ModalForm.create('gardenModal', {
 *     title: { create: 'Thêm Vườn Cây', edit: 'Sửa Vườn Cây' },
 *     maxWidth: '600px',
 *     fields: [
 *       { key: 'code', label: 'Mã Vườn', type: 'text', required: true, autoGenerate: 'VC' },
 *       { key: 'area', label: 'Diện Tích (ha)', type: 'number', required: true, step: 0.01 },
 *       { key: 'status', label: 'Trạng Thái', type: 'select', options: [
 *         { value: 'active', label: 'Hoạt Động' }, { value: 'inactive', label: 'Ngừng' }
 *       ]},
 *       { key: 'notes', label: 'Ghi Chú', type: 'textarea' }
 *     ],
 *     onSave: async (data, id) => { ... },
 *     onClose: () => { ... }
 *   });
 *
 *   // Open for create
 *   modal.open();
 *   // Open for edit
 *   modal.open(existingDataObject);
 */

const ModalForm = (function() {
  'use strict';

  const CSS_STYLES = `
    .mf-overlay {
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.6); z-index: 9998;
      display: none; align-items: center; justify-content: center;
      padding: 20px; backdrop-filter: blur(4px);
    }
    .mf-overlay.active { display: flex; }
    .mf-modal {
      background: var(--card-bg, #1e293b); border-radius: 16px;
      width: 100%; max-height: 90vh; display: flex; flex-direction: column;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5); border: 1px solid var(--border, #334155);
    }
    .mf-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px 20px; border-bottom: 1px solid var(--border, #334155);
    }
    .mf-header h3 { margin: 0; font-size: 16px; color: var(--text, #e2e8f0); }
    .mf-close {
      background: none; border: none; font-size: 20px; cursor: pointer;
      color: var(--text-muted, #64748b); padding: 4px 8px; border-radius: 6px;
      line-height: 1;
    }
    .mf-close:hover { background: rgba(239,68,68,0.2); color: var(--danger, #ef4444); }
    .mf-body {
      padding: 20px; overflow-y: auto; flex: 1;
    }
    .mf-footer {
      display: flex; justify-content: flex-end; gap: 10px;
      padding: 14px 20px; border-top: 1px solid var(--border, #334155);
    }
    .mf-btn {
      padding: 8px 20px; border-radius: 8px; font-size: 13px;
      border: none; cursor: pointer; font-weight: 500;
    }
    .mf-btn-cancel {
      background: var(--card-bg, #1e293b); color: var(--text, #e2e8f0);
      border: 1px solid var(--border, #334155);
    }
    .mf-btn-cancel:hover { background: var(--hover, #334155); }
    .mf-btn-save { background: var(--accent, #8b5cf6); color: #fff; }
    .mf-btn-save:hover { opacity: 0.9; }
    .mf-btn-save:disabled { opacity: 0.5; cursor: not-allowed; }

    .mf-form-row {
      margin-bottom: 14px;
    }
    .mf-form-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
    }
    .mf-form-grid .mf-full { grid-column: 1 / -1; }
    .mf-label {
      display: block; font-size: 12px; font-weight: 600;
      color: var(--text-muted, #94a3b8); margin-bottom: 4px;
      text-transform: uppercase; letter-spacing: 0.3px;
    }
    .mf-required::after {
      content: ' *'; color: var(--danger, #ef4444);
    }
    .mf-input, .mf-select, .mf-textarea {
      width: 100%; padding: 9px 12px; border-radius: 8px;
      border: 1px solid var(--border, #334155);
      background: var(--bg, #0f172a); color: var(--text, #e2e8f0);
      font-size: 13px; box-sizing: border-box; transition: border-color 0.2s;
    }
    .mf-input:focus, .mf-select:focus, .mf-textarea:focus {
      outline: none; border-color: var(--accent, #8b5cf6);
      box-shadow: 0 0 0 3px rgba(139,92,246,0.1);
    }
    .mf-input.mf-error, .mf-select.mf-error, .mf-textarea.mf-error {
      border-color: var(--danger, #ef4444);
    }
    .mf-input.param-warning { border-color: var(--warning, #f59e0b); background: rgba(245,158,11,0.05); }
    .mf-input.param-ok { border-color: var(--success, #22c55e); }
    .mf-textarea { min-height: 60px; resize: vertical; }
    .mf-hint {
      font-size: 11px; color: var(--text-muted, #64748b); margin-top: 3px;
    }
    .mf-error-msg {
      font-size: 11px; color: var(--danger, #ef4444); margin-top: 3px; display: none;
    }
    .mf-section {
      font-size: 13px; font-weight: 600; color: var(--accent, #8b5cf6);
      margin: 16px 0 10px; padding-bottom: 6px;
      border-bottom: 1px solid var(--border, #334155);
    }
    .mf-section:first-child { margin-top: 0; }
    .mf-checkbox-row {
      display: flex; align-items: center; gap: 8px; padding: 6px 0;
    }
    .mf-checkbox-row input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--accent, #8b5cf6); }
    .mf-checkbox-label { font-size: 13px; color: var(--text, #e2e8f0); }
    .mf-custom-slot { margin: 8px 0; }
    .mf-readonly {
      opacity: 0.7; cursor: not-allowed;
    }
  `;

  let stylesInjected = false;
  const instances = {};

  function _injectStyles() {
    if (stylesInjected) return;
    var style = document.createElement('style');
    style.id = 'modalform-styles';
    style.textContent = CSS_STYLES;
    document.head.appendChild(style);
    stylesInjected = true;
  }

  function _showToast(msg, type) {
    if (window.showToast) window.showToast(msg, type);
    else console.log('[' + type + '] ' + msg);
  }

  function _generateCode(prefix) {
    if (window.generateCode) return window.generateCode(prefix);
    var now = new Date();
    var d = now.toISOString().slice(0, 10).replace(/-/g, '');
    return prefix + '-' + d + '-' + String(Math.floor(Math.random() * 999) + 1).padStart(3, '0');
  }

  /**
   * Create a ModalForm instance
   * @param {string} containerId - Container element ID (or will create new if not found)
   * @param {Object} options
   * @returns {Object} ModalForm instance
   */
  function create(containerId, options) {
    _injectStyles();
    options = options || {};

    var container = document.getElementById(containerId);
    var createdContainer = false;
    if (!container) {
      container = document.createElement('div');
      container.id = containerId;
      document.body.appendChild(container);
      createdContainer = true;
    }

    // === Config ===
    var titleConfig = options.title || { create: 'Thêm Mới', edit: 'Chỉnh Sửa' };
    var maxWidth = options.maxWidth || '600px';
    var fields = options.fields || [];
    var onSave = options.onSave || null;
    var onClose = options.onClose || null;
    var onOpen = options.onOpen || null;
    var onChange = options.onChange || null;
    var saveLabel = options.saveLabel || 'Lưu';
    var cancelLabel = options.cancelLabel || 'Hủy';
    var idField = options.idField || 'id';
    var useGrid = options.useGrid !== false;
    var customBodyHtml = options.customBodyHtml || null;
    var footerExtra = options.footerExtra || null;

    // === State ===
    var isOpen = false;
    var editId = null;
    var editData = null;
    var saving = false;

    // === Build DOM ===
    function buildDOM() {
      var html = '<div class="mf-overlay" id="' + containerId + '_overlay">' +
        '<div class="mf-modal" style="max-width:' + maxWidth + '">' +
        '<div class="mf-header">' +
        '<h3 class="mf-title"></h3>' +
        '<button class="mf-close" type="button">&times;</button>' +
        '</div>' +
        '<div class="mf-body">';

      if (customBodyHtml) {
        html += '<div class="mf-custom-slot">' + customBodyHtml + '</div>';
      }

      if (useGrid && fields.length > 0) {
        html += '<div class="mf-form-grid">';
      }

      fields.forEach(function(field) {
        if (field.type === 'section') {
          // Close grid, add section, re-open grid
          if (useGrid) html += '</div>';
          html += '<div class="mf-section">' + field.label + '</div>';
          if (useGrid) html += '<div class="mf-form-grid">';
          return;
        }

        if (field.type === 'custom') {
          var fullCls = (useGrid && field.full !== false) ? ' mf-full' : '';
          html += '<div class="mf-form-row' + fullCls + '">' +
            (field.html || '') + '</div>';
          return;
        }

        if (field.type === 'hidden') {
          html += '<input type="hidden" id="' + _fieldId(field) + '">';
          return;
        }

        var fullCls = '';
        if (useGrid) {
          fullCls = field.full ? ' mf-full' : '';
        }

        html += '<div class="mf-form-row' + fullCls + '">';
        html += '<label class="mf-label' + (field.required ? ' mf-required' : '') + '" for="' + _fieldId(field) + '">' + field.label + '</label>';

        html += _buildFieldInput(field);

        if (field.hint) {
          html += '<div class="mf-hint">' + field.hint + '</div>';
        }
        html += '<div class="mf-error-msg" id="' + _fieldId(field) + '_error"></div>';
        html += '</div>';
      });

      if (useGrid && fields.length > 0) {
        html += '</div>'; // close form-grid
      }

      html += '</div>'; // close mf-body

      // Footer
      html += '<div class="mf-footer">';
      if (footerExtra) html += '<div style="flex:1">' + footerExtra + '</div>';
      html += '<button class="mf-btn mf-btn-cancel" type="button">' + cancelLabel + '</button>';
      html += '<button class="mf-btn mf-btn-save" type="button">' + saveLabel + '</button>';
      html += '</div>';

      html += '</div></div>'; // close mf-modal + mf-overlay
      container.innerHTML = html;

      bindEvents();
    }

    function _fieldId(field) {
      return containerId + '_' + field.key;
    }

    function _buildFieldInput(field) {
      var fid = _fieldId(field);
      var readonlyAttr = field.readonly ? ' readonly class="mf-input mf-readonly"' : ' class="mf-input"';
      var disabledAttr = field.disabled ? ' disabled' : '';
      var placeholderAttr = field.placeholder ? ' placeholder="' + field.placeholder + '"' : '';

      switch (field.type) {
        case 'number':
          var step = field.step ? ' step="' + field.step + '"' : '';
          var min = field.min !== undefined ? ' min="' + field.min + '"' : '';
          var max = field.max !== undefined ? ' max="' + field.max + '"' : '';
          return '<input type="number" id="' + fid + '"' + readonlyAttr + disabledAttr + placeholderAttr + step + min + max + '>';

        case 'date':
          return '<input type="date" id="' + fid + '" class="mf-input"' + disabledAttr + '>';

        case 'time':
          return '<input type="time" id="' + fid + '" class="mf-input"' + disabledAttr + '>';

        case 'select':
          var html = '<select id="' + fid + '" class="mf-select"' + disabledAttr + '>';
          if (field.placeholder) {
            html += '<option value="">' + field.placeholder + '</option>';
          }
          (field.options || []).forEach(function(opt) {
            if (opt.group) {
              html += '<optgroup label="' + opt.group + '">';
              (opt.items || []).forEach(function(item) {
                html += '<option value="' + item.value + '">' + item.label + '</option>';
              });
              html += '</optgroup>';
            } else {
              html += '<option value="' + opt.value + '">' + opt.label + '</option>';
            }
          });
          html += '</select>';
          return html;

        case 'textarea':
          var rows = field.rows || 3;
          return '<textarea id="' + fid + '" class="mf-textarea" rows="' + rows + '"' + disabledAttr + placeholderAttr + '></textarea>';

        case 'checkbox':
          return '<div class="mf-checkbox-row">' +
            '<input type="checkbox" id="' + fid + '"' + disabledAttr + '>' +
            '<label class="mf-checkbox-label" for="' + fid + '">' + (field.checkboxLabel || field.label) + '</label>' +
            '</div>';

        default: // text
          return '<input type="text" id="' + fid + '"' + readonlyAttr + disabledAttr + placeholderAttr + '>';
      }
    }

    function bindEvents() {
      var overlay = container.querySelector('.mf-overlay');
      var closeBtn = container.querySelector('.mf-close');
      var cancelBtn = container.querySelector('.mf-btn-cancel');
      var saveBtn = container.querySelector('.mf-btn-save');

      if (closeBtn) closeBtn.addEventListener('click', close);
      if (cancelBtn) cancelBtn.addEventListener('click', close);

      // Click overlay to close
      if (overlay) {
        overlay.addEventListener('click', function(e) {
          if (e.target === overlay) close();
        });
      }

      // Escape key
      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && isOpen) close();
      });

      if (saveBtn) {
        saveBtn.addEventListener('click', function() {
          doSave();
        });
      }

      // Field onChange callbacks
      if (onChange) {
        fields.forEach(function(field) {
          if (field.type === 'section' || field.type === 'custom' || field.type === 'hidden') return;
          var el = document.getElementById(_fieldId(field));
          if (el) {
            var eventType = (field.type === 'select' || field.type === 'checkbox') ? 'change' : 'input';
            el.addEventListener(eventType, function() {
              onChange(field.key, getFieldValue(field), collectData());
            });
          }
        });
      }

      // Individual field onChange
      fields.forEach(function(field) {
        if (field.onChange) {
          var el = document.getElementById(_fieldId(field));
          if (el) {
            var eventType = (field.type === 'select' || field.type === 'checkbox') ? 'change' : 'input';
            el.addEventListener(eventType, function() {
              field.onChange(getFieldValue(field), collectData(), instance);
            });
          }
        }
      });
    }

    // === Open/Close ===

    function open(data) {
      editData = data || null;
      editId = data ? (data[idField] || null) : null;

      // Set title
      var titleEl = container.querySelector('.mf-title');
      if (titleEl) {
        titleEl.textContent = editId
          ? (typeof titleConfig.edit === 'function' ? titleConfig.edit(data) : titleConfig.edit)
          : (typeof titleConfig.create === 'function' ? titleConfig.create() : titleConfig.create);
      }

      // Populate fields
      fields.forEach(function(field) {
        if (field.type === 'section' || field.type === 'custom') return;
        var el = document.getElementById(_fieldId(field));
        if (!el) return;

        // Clear error state
        el.classList.remove('mf-error', 'param-warning', 'param-ok');
        var errEl = document.getElementById(_fieldId(field) + '_error');
        if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

        if (editData) {
          // Edit mode: populate from data
          var val = editData[field.key];
          setFieldValue(field, val);
        } else {
          // Create mode: set defaults
          if (field.autoGenerate) {
            el.value = _generateCode(field.autoGenerate);
          } else if (field.defaultValue !== undefined) {
            setFieldValue(field, field.defaultValue);
          } else if (field.type === 'checkbox') {
            el.checked = false;
          } else {
            el.value = '';
          }
        }
      });

      // Show overlay
      var overlay = container.querySelector('.mf-overlay');
      if (overlay) overlay.classList.add('active');
      isOpen = true;

      if (onOpen) onOpen(editData, editId, instance);
    }

    function close() {
      var overlay = container.querySelector('.mf-overlay');
      if (overlay) overlay.classList.remove('active');
      isOpen = false;
      editId = null;
      editData = null;
      saving = false;

      // Re-enable save button
      var saveBtn = container.querySelector('.mf-btn-save');
      if (saveBtn) saveBtn.disabled = false;

      if (onClose) onClose();
    }

    // === Field Value Helpers ===

    function getFieldValue(field) {
      var el = document.getElementById(_fieldId(field));
      if (!el) return undefined;

      switch (field.type) {
        case 'number':
          return el.value !== '' ? parseFloat(el.value) : null;
        case 'checkbox':
          return el.checked;
        case 'date':
          return el.value || null;
        default:
          return el.value;
      }
    }

    function setFieldValue(field, val) {
      var el = document.getElementById(_fieldId(field));
      if (!el) return;

      if (field.type === 'checkbox') {
        el.checked = !!val;
      } else if (field.type === 'date' && val) {
        // Handle Firestore Timestamp
        if (val.toDate) {
          el.value = val.toDate().toISOString().slice(0, 10);
        } else if (val instanceof Date) {
          el.value = val.toISOString().slice(0, 10);
        } else {
          el.value = String(val).slice(0, 10);
        }
      } else {
        el.value = val !== null && val !== undefined ? val : '';
      }
    }

    // === Data Collection ===

    function collectData() {
      var data = {};
      fields.forEach(function(field) {
        if (field.type === 'section' || field.type === 'custom') return;
        if (field.exclude) return;
        data[field.key] = getFieldValue(field);
      });
      return data;
    }

    // === Validation ===

    function validate() {
      var valid = true;
      var firstError = null;

      fields.forEach(function(field) {
        if (field.type === 'section' || field.type === 'custom' || field.type === 'hidden') return;
        var el = document.getElementById(_fieldId(field));
        var errEl = document.getElementById(_fieldId(field) + '_error');
        if (!el) return;

        el.classList.remove('mf-error');
        if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

        var val = getFieldValue(field);

        // Required check
        if (field.required) {
          var empty = (val === null || val === undefined || val === '' ||
            (field.type === 'number' && isNaN(val)));
          if (empty) {
            el.classList.add('mf-error');
            if (errEl) { errEl.textContent = field.label + ' là bắt buộc'; errEl.style.display = 'block'; }
            valid = false;
            if (!firstError) firstError = el;
            return;
          }
        }

        // Custom validate function
        if (field.validate && val !== null && val !== '') {
          var result = field.validate(val, collectData());
          if (result !== true && result) {
            el.classList.add('mf-error');
            if (errEl) { errEl.textContent = result; errEl.style.display = 'block'; }
            valid = false;
            if (!firstError) firstError = el;
          }
        }

        // Min/Max for numbers
        if (field.type === 'number' && val !== null && !isNaN(val)) {
          if (field.min !== undefined && val < field.min) {
            el.classList.add('mf-error');
            if (errEl) { errEl.textContent = 'Giá trị tối thiểu: ' + field.min; errEl.style.display = 'block'; }
            valid = false;
            if (!firstError) firstError = el;
          }
          if (field.max !== undefined && val > field.max) {
            el.classList.add('mf-error');
            if (errEl) { errEl.textContent = 'Giá trị tối đa: ' + field.max; errEl.style.display = 'block'; }
            valid = false;
            if (!firstError) firstError = el;
          }
        }
      });

      if (!valid && firstError) {
        firstError.focus();
      }

      return valid;
    }

    // === Save ===

    async function doSave() {
      if (saving) return;
      if (!validate()) return;

      var data = collectData();
      saving = true;
      var saveBtn = container.querySelector('.mf-btn-save');
      if (saveBtn) saveBtn.disabled = true;

      try {
        if (onSave) {
          await onSave(data, editId, editData);
        }
        close();
      } catch (error) {
        console.error('ModalForm save error:', error);
        _showToast('Lỗi lưu dữ liệu: ' + error.message, 'error');
        saving = false;
        if (saveBtn) saveBtn.disabled = false;
      }
    }

    // === Initialize ===
    buildDOM();

    // === Public API ===
    var instance = {
      /**
       * Open the modal (null = create, object = edit)
       * @param {Object|null} data
       */
      open: open,

      /**
       * Close the modal
       */
      close: close,

      /**
       * Check if modal is open
       * @returns {boolean}
       */
      isOpen: function() { return isOpen; },

      /**
       * Get current edit ID
       * @returns {string|null}
       */
      getEditId: function() { return editId; },

      /**
       * Get current edit data
       * @returns {Object|null}
       */
      getEditData: function() { return editData; },

      /**
       * Collect form data
       * @returns {Object}
       */
      collectData: collectData,

      /**
       * Validate form
       * @returns {boolean}
       */
      validate: validate,

      /**
       * Get value of specific field
       * @param {string} key
       * @returns {*}
       */
      getFieldValue: function(key) {
        var field = fields.find(function(f) { return f.key === key; });
        return field ? getFieldValue(field) : undefined;
      },

      /**
       * Set value of specific field
       * @param {string} key
       * @param {*} val
       */
      setFieldValue: function(key, val) {
        var field = fields.find(function(f) { return f.key === key; });
        if (field) setFieldValue(field, val);
      },

      /**
       * Get DOM element for a field
       * @param {string} key
       * @returns {HTMLElement|null}
       */
      getFieldElement: function(key) {
        return document.getElementById(containerId + '_' + key);
      },

      /**
       * Show/hide a field
       * @param {string} key
       * @param {boolean} visible
       */
      toggleField: function(key, visible) {
        var el = document.getElementById(containerId + '_' + key);
        if (el) {
          var row = el.closest('.mf-form-row');
          if (row) row.style.display = visible ? '' : 'none';
        }
      },

      /**
       * Enable/disable a field
       * @param {string} key
       * @param {boolean} disabled
       */
      setFieldDisabled: function(key, disabled) {
        var el = document.getElementById(containerId + '_' + key);
        if (el) {
          el.disabled = disabled;
          el.classList.toggle('mf-readonly', disabled);
        }
      },

      /**
       * Update select options dynamically
       * @param {string} key
       * @param {Array} newOptions - [{value, label}]
       */
      setFieldOptions: function(key, newOptions) {
        var el = document.getElementById(containerId + '_' + key);
        if (!el || el.tagName !== 'SELECT') return;
        var currentVal = el.value;
        var field = fields.find(function(f) { return f.key === key; });
        var html = '';
        if (field && field.placeholder) {
          html += '<option value="">' + field.placeholder + '</option>';
        }
        (newOptions || []).forEach(function(opt) {
          html += '<option value="' + opt.value + '">' + opt.label + '</option>';
        });
        el.innerHTML = html;
        el.value = currentVal;
      },

      /**
       * Set error message on field
       * @param {string} key
       * @param {string} message
       */
      setFieldError: function(key, message) {
        var el = document.getElementById(containerId + '_' + key);
        var errEl = document.getElementById(containerId + '_' + key + '_error');
        if (el) el.classList.toggle('mf-error', !!message);
        if (errEl) {
          errEl.textContent = message || '';
          errEl.style.display = message ? 'block' : 'none';
        }
      },

      /**
       * Set TCCS validation state on field (warning/ok)
       * @param {string} key
       * @param {boolean} isOk
       */
      setFieldTCCS: function(key, isOk) {
        var el = document.getElementById(containerId + '_' + key);
        if (!el) return;
        el.classList.remove('param-warning', 'param-ok');
        if (isOk === true) el.classList.add('param-ok');
        else if (isOk === false) el.classList.add('param-warning');
      },

      /**
       * Get the overlay DOM element
       * @returns {HTMLElement}
       */
      getOverlay: function() {
        return container.querySelector('.mf-overlay');
      },

      /**
       * Get the modal body DOM element (for injecting custom HTML)
       * @returns {HTMLElement}
       */
      getBody: function() {
        return container.querySelector('.mf-body');
      },

      /**
       * Destroy instance
       */
      destroy: function() {
        container.innerHTML = '';
        if (createdContainer && container.parentNode) {
          container.parentNode.removeChild(container);
        }
        delete instances[containerId];
      }
    };

    instances[containerId] = instance;
    return instance;
  }

  /**
   * Get existing instance
   * @param {string} containerId
   * @returns {Object|null}
   */
  function getInstance(containerId) {
    return instances[containerId] || null;
  }

  return {
    create: create,
    getInstance: getInstance
  };
})();
