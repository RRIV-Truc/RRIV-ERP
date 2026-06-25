/**
 * UI Components Module
 * Các component UI dùng chung cho toàn bộ ứng dụng
 * @module ui
 */

const UI = (function() {
  'use strict';

  // ==================== MODAL ====================

  /**
   * Hiển thị modal
   * @param {string} modalId - ID của modal element
   */
  function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('hidden');
      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';

      // Focus first input
      setTimeout(() => {
        const firstInput = modal.querySelector('input:not([type="hidden"]), select, textarea');
        if (firstInput) firstInput.focus();
      }, 100);
    }
  }

  /**
   * Ẩn modal
   * @param {string} modalId - ID của modal element
   */
  function hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
      document.body.style.overflow = '';
    }
  }

  /**
   * Tạo modal động
   * @param {Object} options
   * @returns {HTMLElement}
   */
  function createModal(options = {}) {
    const {
      id = 'dynamic-modal',
      title = '',
      content = '',
      size = 'md', // sm, md, lg
      closable = true,
      footer = null,
      onClose = null
    } = options;

    const sizeClass = {
      sm: 'max-width:400px',
      md: 'max-width:500px',
      lg: 'max-width:800px'
    }[size] || 'max-width:500px';

    const modal = document.createElement('div');
    modal.id = id;
    modal.className = 'modal-backdrop';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:1000;padding:20px';

    modal.innerHTML = `
      <div class="modal-content" style="background:#fff;border-radius:12px;${sizeClass};width:100%;max-height:90vh;overflow:hidden;animation:slideIn 0.3s ease">
        <div class="modal-header" style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #e5e7eb">
          <h3 style="font-size:18px;font-weight:600;color:#1f2937;margin:0">${Validation.sanitizeHTML(title)}</h3>
          ${closable ? `<button class="modal-close-btn" style="background:none;border:none;font-size:24px;color:#9ca3af;cursor:pointer;padding:4px">&times;</button>` : ''}
        </div>
        <div class="modal-body" style="padding:20px;overflow-y:auto;max-height:calc(90vh - 140px)">
          ${content}
        </div>
        ${footer ? `<div class="modal-footer" style="display:flex;justify-content:flex-end;gap:12px;padding:16px 20px;border-top:1px solid #e5e7eb;background:#f9fafb">${footer}</div>` : ''}
      </div>
    `;

    // Close handlers
    if (closable) {
      const closeBtn = modal.querySelector('.modal-close-btn');
      closeBtn.onclick = () => {
        closeModal(modal, onClose);
      };

      modal.onclick = (e) => {
        if (e.target === modal) {
          closeModal(modal, onClose);
        }
      };
    }

    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    return modal;
  }

  function closeModal(modal, onClose) {
    modal.remove();
    document.body.style.overflow = '';
    if (onClose) onClose();
  }

  /**
   * Confirm dialog
   * @param {string} message
   * @param {Object} options
   * @returns {Promise<boolean>}
   */
  function confirm(message, options = {}) {
    return new Promise((resolve) => {
      const {
        title = 'Xác nhận',
        confirmText = 'Đồng ý',
        cancelText = 'Hủy',
        type = 'warning' // warning, danger, info
      } = options;

      const colors = {
        warning: '#f59e0b',
        danger: '#ef4444',
        info: '#3b82f6'
      };

      const modal = createModal({
        title,
        content: `<p style="color:#4b5563;font-size:14px">${Validation.sanitizeHTML(message)}</p>`,
        size: 'sm',
        footer: `
          <button class="cancel-btn" style="padding:8px 16px;background:#f3f4f6;color:#374151;border:none;border-radius:6px;cursor:pointer">
            ${cancelText}
          </button>
          <button class="confirm-btn" style="padding:8px 16px;background:${colors[type]};color:#fff;border:none;border-radius:6px;cursor:pointer">
            ${confirmText}
          </button>
        `,
        onClose: () => resolve(false)
      });

      modal.querySelector('.cancel-btn').onclick = () => {
        closeModal(modal);
        resolve(false);
      };

      modal.querySelector('.confirm-btn').onclick = () => {
        closeModal(modal);
        resolve(true);
      };
    });
  }

  /**
   * Alert dialog
   * @param {string} message
   * @param {Object} options
   * @returns {Promise<void>}
   */
  function alert(message, options = {}) {
    return new Promise((resolve) => {
      const { title = 'Thông báo', buttonText = 'OK' } = options;

      const modal = createModal({
        title,
        content: `<p style="color:#4b5563;font-size:14px">${Validation.sanitizeHTML(message)}</p>`,
        size: 'sm',
        footer: `
          <button class="ok-btn" style="padding:8px 20px;background:#3b82f6;color:#fff;border:none;border-radius:6px;cursor:pointer">
            ${buttonText}
          </button>
        `,
        onClose: () => resolve()
      });

      modal.querySelector('.ok-btn').onclick = () => {
        closeModal(modal);
        resolve();
      };
    });
  }

  /**
   * Prompt dialog
   * @param {string} message
   * @param {Object} options
   * @returns {Promise<string|null>}
   */
  function prompt(message, options = {}) {
    return new Promise((resolve) => {
      const {
        title = 'Nhập liệu',
        defaultValue = '',
        placeholder = '',
        type = 'text'
      } = options;

      const modal = createModal({
        title,
        content: `
          <p style="color:#4b5563;font-size:14px;margin-bottom:12px">${Validation.sanitizeHTML(message)}</p>
          <input type="${type}" class="prompt-input" value="${Validation.sanitizeHTML(defaultValue)}" placeholder="${Validation.sanitizeHTML(placeholder)}"
            style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:14px">
        `,
        size: 'sm',
        footer: `
          <button class="cancel-btn" style="padding:8px 16px;background:#f3f4f6;color:#374151;border:none;border-radius:6px;cursor:pointer">Hủy</button>
          <button class="ok-btn" style="padding:8px 16px;background:#3b82f6;color:#fff;border:none;border-radius:6px;cursor:pointer">OK</button>
        `,
        onClose: () => resolve(null)
      });

      const input = modal.querySelector('.prompt-input');
      input.focus();
      input.select();

      input.onkeydown = (e) => {
        if (e.key === 'Enter') {
          closeModal(modal);
          resolve(input.value);
        }
      };

      modal.querySelector('.cancel-btn').onclick = () => {
        closeModal(modal);
        resolve(null);
      };

      modal.querySelector('.ok-btn').onclick = () => {
        closeModal(modal);
        resolve(input.value);
      };
    });
  }

  // ==================== LOADING ====================

  /**
   * Hiển thị loading overlay
   * @param {string} message
   * @param {string} containerId - ID container (null = fullscreen)
   * @returns {Function} Hide function
   */
  function showLoading(message = 'Đang xử lý...', containerId = null) {
    const id = 'loading-' + Date.now();
    const overlay = document.createElement('div');
    overlay.id = id;
    overlay.style.cssText = containerId
      ? 'position:absolute;inset:0;background:rgba(255,255,255,0.9);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:100'
      : 'position:fixed;inset:0;background:rgba(255,255,255,0.9);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999';

    overlay.innerHTML = `
      <div style="width:40px;height:40px;border:3px solid #e5e7eb;border-top-color:#3b82f6;border-radius:50%;animation:spin 0.8s linear infinite"></div>
      <p style="margin-top:16px;color:#4b5563;font-size:14px">${Validation.sanitizeHTML(message)}</p>
    `;

    const container = containerId ? document.getElementById(containerId) : document.body;
    if (containerId) {
      const el = document.getElementById(containerId);
      if (el) el.style.position = 'relative';
    }
    container.appendChild(overlay);

    return () => {
      const el = document.getElementById(id);
      if (el) el.remove();
    };
  }

  /**
   * Hiển thị loading button
   * @param {HTMLButtonElement} button
   * @param {boolean} loading
   */
  function setButtonLoading(button, loading) {
    if (!button) return;

    if (loading) {
      button.disabled = true;
      button.dataset.originalText = button.innerHTML;
      button.innerHTML = `
        <span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.8s linear infinite;margin-right:8px"></span>
        Đang xử lý...
      `;
    } else {
      button.disabled = false;
      if (button.dataset.originalText) {
        button.innerHTML = button.dataset.originalText;
      }
    }
  }

  // ==================== TABS ====================

  /**
   * Khởi tạo tabs
   * @param {string} containerId
   * @param {Function} onChange - Callback khi tab thay đổi
   */
  function initTabs(containerId, onChange = null) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const tabs = container.querySelectorAll('[data-tab]');
    const contents = container.querySelectorAll('[data-tab-content]');

    tabs.forEach(tab => {
      tab.onclick = () => {
        const tabId = tab.dataset.tab;

        // Update tab states
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        // Update content states
        contents.forEach(c => {
          if (c.dataset.tabContent === tabId) {
            c.classList.add('active');
            c.style.display = 'block';
          } else {
            c.classList.remove('active');
            c.style.display = 'none';
          }
        });

        if (onChange) onChange(tabId);
      };
    });
  }

  /**
   * Set active tab
   * @param {string} containerId
   * @param {string} tabId
   */
  function setActiveTab(containerId, tabId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const tab = container.querySelector(`[data-tab="${tabId}"]`);
    if (tab) tab.click();
  }

  // ==================== TABLE ====================

  /**
   * Render table với data
   * @param {string} containerId
   * @param {Object} options
   */
  function renderTable(containerId, options = {}) {
    const {
      columns = [],
      data = [],
      emptyMessage = 'Không có dữ liệu',
      onRowClick = null,
      selectable = false,
      pagination = null
    } = options;

    const container = document.getElementById(containerId);
    if (!container) return;

    if (data.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:40px;color:#6b7280">
          <div style="font-size:48px;margin-bottom:16px">📋</div>
          <p>${Validation.sanitizeHTML(emptyMessage)}</p>
        </div>
      `;
      return;
    }

    let html = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:14px">';

    // Header
    html += '<thead><tr style="background:#f9fafb">';
    if (selectable) {
      html += '<th style="padding:12px;text-align:center;width:40px"><input type="checkbox" class="select-all"></th>';
    }
    columns.forEach(col => {
      html += `<th style="padding:12px;text-align:left;font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb">${Validation.sanitizeHTML(col.label)}</th>`;
    });
    html += '</tr></thead>';

    // Body
    html += '<tbody>';
    data.forEach((row, index) => {
      const rowStyle = onRowClick ? 'cursor:pointer' : '';
      html += `<tr data-index="${index}" style="border-bottom:1px solid #f3f4f6;${rowStyle}" ${onRowClick ? 'class="clickable-row"' : ''}>`;

      if (selectable) {
        html += `<td style="padding:12px;text-align:center"><input type="checkbox" class="row-checkbox" data-id="${row.id || index}"></td>`;
      }

      columns.forEach(col => {
        let value = row[col.key];

        // Custom render
        if (col.render) {
          value = col.render(value, row, index);
        } else if (value === null || value === undefined) {
          value = '-';
        }

        html += `<td style="padding:12px;color:#4b5563">${value}</td>`;
      });

      html += '</tr>';
    });
    html += '</tbody></table></div>';

    // Pagination
    if (pagination) {
      html += renderPagination(pagination);
    }

    container.innerHTML = html;

    // Event handlers
    if (onRowClick) {
      container.querySelectorAll('.clickable-row').forEach(tr => {
        tr.onclick = (e) => {
          if (e.target.type !== 'checkbox') {
            const index = parseInt(tr.dataset.index);
            onRowClick(data[index], index);
          }
        };
        tr.onmouseenter = () => tr.style.backgroundColor = '#f9fafb';
        tr.onmouseleave = () => tr.style.backgroundColor = '';
      });
    }

    if (selectable) {
      const selectAll = container.querySelector('.select-all');
      const checkboxes = container.querySelectorAll('.row-checkbox');

      selectAll.onchange = () => {
        checkboxes.forEach(cb => cb.checked = selectAll.checked);
      };
    }
  }

  /**
   * Render pagination
   */
  function renderPagination(options) {
    const { currentPage, totalPages, onPageChange } = options;

    let html = '<div style="display:flex;justify-content:center;align-items:center;gap:8px;margin-top:16px;padding:16px">';

    html += `<button onclick="${onPageChange}(${currentPage - 1})" ${currentPage <= 1 ? 'disabled' : ''} style="padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;background:#fff;cursor:pointer">←</button>`;

    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
        html += `<button onclick="${onPageChange}(${i})" style="padding:8px 12px;border:1px solid ${i === currentPage ? '#3b82f6' : '#d1d5db'};border-radius:6px;background:${i === currentPage ? '#3b82f6' : '#fff'};color:${i === currentPage ? '#fff' : '#374151'};cursor:pointer">${i}</button>`;
      } else if (i === currentPage - 2 || i === currentPage + 2) {
        html += '<span style="padding:0 4px">...</span>';
      }
    }

    html += `<button onclick="${onPageChange}(${currentPage + 1})" ${currentPage >= totalPages ? 'disabled' : ''} style="padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;background:#fff;cursor:pointer">→</button>`;

    html += '</div>';
    return html;
  }

  // ==================== DROPDOWN ====================

  /**
   * Toggle dropdown
   * @param {string} dropdownId
   */
  function toggleDropdown(dropdownId) {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;

    const isOpen = dropdown.classList.contains('open');

    // Close all dropdowns
    document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));

    if (!isOpen) {
      dropdown.classList.add('open');

      // Close on click outside
      const closeHandler = (e) => {
        if (!dropdown.contains(e.target)) {
          dropdown.classList.remove('open');
          document.removeEventListener('click', closeHandler);
        }
      };
      setTimeout(() => document.addEventListener('click', closeHandler), 0);
    }
  }

  // ==================== FORM HELPERS ====================

  /**
   * Reset form
   * @param {string} formId
   */
  function resetForm(formId) {
    const form = document.getElementById(formId);
    if (form) {
      form.reset();
      Validation.clearFormErrors(formId);
    }
  }

  /**
   * Get form data as object
   * @param {string} formId
   * @returns {Object}
   */
  function getFormData(formId) {
    const form = document.getElementById(formId);
    if (!form) return {};

    const formData = new FormData(form);
    const data = {};

    formData.forEach((value, key) => {
      if (data[key]) {
        if (Array.isArray(data[key])) {
          data[key].push(value);
        } else {
          data[key] = [data[key], value];
        }
      } else {
        data[key] = value;
      }
    });

    return data;
  }

  /**
   * Set form data from object
   * @param {string} formId
   * @param {Object} data
   */
  function setFormData(formId, data) {
    const form = document.getElementById(formId);
    if (!form || !data) return;

    Object.entries(data).forEach(([key, value]) => {
      const input = form.elements[key];
      if (input) {
        if (input.type === 'checkbox') {
          input.checked = !!value;
        } else if (input.type === 'radio') {
          const radio = form.querySelector(`input[name="${key}"][value="${value}"]`);
          if (radio) radio.checked = true;
        } else {
          input.value = value || '';
        }
      }
    });
  }

  // ==================== TOOLTIP ====================

  /**
   * Tạo tooltip
   * @param {HTMLElement} element
   * @param {string} text
   * @param {string} position - top, bottom, left, right
   */
  function tooltip(element, text, position = 'top') {
    if (!element) return;

    let tooltipEl = null;

    element.onmouseenter = () => {
      tooltipEl = document.createElement('div');
      tooltipEl.className = 'ui-tooltip';
      tooltipEl.textContent = text;
      tooltipEl.style.cssText = `
        position:absolute;
        background:#1f2937;
        color:#fff;
        padding:6px 10px;
        border-radius:6px;
        font-size:12px;
        white-space:nowrap;
        z-index:9999;
        pointer-events:none;
      `;

      document.body.appendChild(tooltipEl);

      const rect = element.getBoundingClientRect();
      const tipRect = tooltipEl.getBoundingClientRect();

      let top, left;
      switch (position) {
        case 'top':
          top = rect.top - tipRect.height - 8;
          left = rect.left + (rect.width - tipRect.width) / 2;
          break;
        case 'bottom':
          top = rect.bottom + 8;
          left = rect.left + (rect.width - tipRect.width) / 2;
          break;
        case 'left':
          top = rect.top + (rect.height - tipRect.height) / 2;
          left = rect.left - tipRect.width - 8;
          break;
        case 'right':
          top = rect.top + (rect.height - tipRect.height) / 2;
          left = rect.right + 8;
          break;
      }

      tooltipEl.style.top = (top + window.scrollY) + 'px';
      tooltipEl.style.left = (left + window.scrollX) + 'px';
    };

    element.onmouseleave = () => {
      if (tooltipEl) {
        tooltipEl.remove();
        tooltipEl = null;
      }
    };
  }

  // ==================== PUBLIC API ====================
  return {
    // Modal
    showModal,
    hideModal,
    createModal,
    confirm,
    alert,
    prompt,

    // Loading
    showLoading,
    setButtonLoading,

    // Tabs
    initTabs,
    setActiveTab,

    // Table
    renderTable,

    // Dropdown
    toggleDropdown,

    // Form
    resetForm,
    getFormData,
    setFormData,

    // Tooltip
    tooltip
  };
})();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = UI;
}
