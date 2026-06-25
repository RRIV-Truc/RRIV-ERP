/**
 * SearchableSelect - Component dropdown c\u00f3 t\u00ecm ki\u1ebfm
 * S\u1eed d\u1ee5ng cho t\u1ea5t c\u1ea3 c\u00e1c app trong h\u1ec7 th\u1ed1ng
 *
 * Usage:
 * 1. Include CSS: <link rel="stylesheet" href="js/components/searchable-select.css">
 * 2. Include JS: <script src="js/components/searchable-select.js"></script>
 * 3. Call: SearchableSelect.create(containerId, options)
 */

const SearchableSelect = (function() {
  'use strict';

  // CSS styles (will be injected once)
  const CSS_STYLES = `
    .ss-container {
      position: relative;
      width: 100%;
    }

    .ss-input {
      width: 100%;
      padding: 10px 35px 10px 12px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-size: 14px;
      background: white;
      cursor: pointer;
      text-overflow: ellipsis;
      white-space: nowrap;
      overflow: hidden;
      box-sizing: border-box;
    }

    .ss-input:focus {
      outline: none;
      border-color: #8b5cf6;
      box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1);
    }

    .ss-input::placeholder {
      color: #94a3b8;
    }

    .ss-input.ss-disabled {
      background: #f1f5f9;
      cursor: not-allowed;
      color: #94a3b8;
    }

    .ss-arrow {
      position: absolute;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      pointer-events: none;
      color: #64748b;
      transition: transform 0.2s;
      font-size: 10px;
    }

    .ss-container.ss-open .ss-arrow {
      transform: translateY(-50%) rotate(180deg);
    }

    .ss-dropdown {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      max-height: 280px;
      overflow: hidden;
      z-index: 9999;
      display: none;
      margin-top: 4px;
    }

    .ss-container.ss-open .ss-dropdown {
      display: flex;
      flex-direction: column;
    }

    .ss-search-box {
      padding: 8px;
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
      flex-shrink: 0;
    }

    .ss-search-input {
      width: 100%;
      padding: 8px 12px;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      font-size: 13px;
      box-sizing: border-box;
    }

    .ss-search-input:focus {
      outline: none;
      border-color: #8b5cf6;
    }

    .ss-options {
      overflow-y: auto;
      flex: 1;
      max-height: 220px;
    }

    .ss-option {
      padding: 10px 12px;
      cursor: pointer;
      font-size: 14px;
      transition: background 0.15s;
      border-bottom: 1px solid #f1f5f9;
    }

    .ss-option:last-child {
      border-bottom: none;
    }

    .ss-option:hover {
      background: #f1f5f9;
    }

    .ss-option.ss-selected {
      background: #8b5cf6;
      color: white;
    }

    .ss-option.ss-highlighted {
      background: #ede9fe;
    }

    .ss-option-subtitle {
      font-size: 11px;
      color: #94a3b8;
      margin-top: 2px;
    }

    .ss-option.ss-selected .ss-option-subtitle {
      color: rgba(255,255,255,0.8);
    }

    .ss-empty {
      padding: 20px;
      text-align: center;
      color: #94a3b8;
      font-size: 13px;
    }

    .ss-loading {
      padding: 20px;
      text-align: center;
      color: #64748b;
      font-size: 13px;
    }

    .ss-clear-btn {
      position: absolute;
      right: 30px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      padding: 4px;
      font-size: 14px;
      display: none;
    }

    .ss-container.ss-has-value .ss-clear-btn {
      display: block;
    }

    .ss-clear-btn:hover {
      color: #ef4444;
    }
  `;

  let stylesInjected = false;
  const instances = {};

  // Inject CSS once
  function injectStyles() {
    if (stylesInjected) return;
    const style = document.createElement('style');
    style.id = 'searchable-select-styles';
    style.textContent = CSS_STYLES;
    document.head.appendChild(style);
    stylesInjected = true;
  }

  // Remove Vietnamese diacritics for search
  function removeDiacritics(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  /**
   * Create a searchable select
   * @param {string} containerId - ID of container element
   * @param {Object} options - Configuration options
   * @param {string} options.placeholder - Placeholder text
   * @param {string} options.searchPlaceholder - Search input placeholder
   * @param {boolean} options.allowClear - Show clear button
   * @param {boolean} options.disabled - Disabled state
   * @param {Function} options.onSelect - Callback when option selected (value, text, data)
   * @param {Function} options.onChange - Callback when value changes
   * @param {Function} options.onClear - Callback when cleared
   * @returns {Object} Instance with methods
   */
  function create(containerId, options = {}) {
    injectStyles();

    const container = document.getElementById(containerId);
    if (!container) {
      console.error(`SearchableSelect: Container #${containerId} not found`);
      return null;
    }

    // Default options
    const config = {
      placeholder: options.placeholder || '-- Ch\u1ecdn --',
      searchPlaceholder: options.searchPlaceholder || '\ud83d\udd0d G\u00f5 \u0111\u1ec3 t\u00ecm ki\u1ebfm...',
      allowClear: options.allowClear !== false,
      disabled: options.disabled || false,
      onSelect: options.onSelect || null,
      onChange: options.onChange || null,
      onClear: options.onClear || null
    };

    // State
    let data = [];
    let selectedValue = null;
    let selectedText = '';
    let selectedData = null;
    let isOpen = false;
    let highlightedIndex = -1;

    // Create DOM structure
    container.innerHTML = `
      <div class="ss-container${config.disabled ? ' ss-disabled' : ''}">
        <input type="text" class="ss-input${config.disabled ? ' ss-disabled' : ''}"
               placeholder="${config.placeholder}" readonly ${config.disabled ? 'disabled' : ''}>
        ${config.allowClear ? '<button type="button" class="ss-clear-btn" title="X\u00f3a">\u00d7</button>' : ''}
        <span class="ss-arrow">\u25bc</span>
        <input type="hidden" class="ss-value">
        <div class="ss-dropdown">
          <div class="ss-search-box">
            <input type="text" class="ss-search-input" placeholder="${config.searchPlaceholder}">
          </div>
          <div class="ss-options"></div>
        </div>
      </div>
    `;

    // Get elements
    const wrapper = container.querySelector('.ss-container');
    const input = container.querySelector('.ss-input');
    const hidden = container.querySelector('.ss-value');
    const dropdown = container.querySelector('.ss-dropdown');
    const searchInput = container.querySelector('.ss-search-input');
    const optionsContainer = container.querySelector('.ss-options');
    const clearBtn = container.querySelector('.ss-clear-btn');

    // Event handlers
    function open() {
      if (config.disabled) return;
      isOpen = true;
      wrapper.classList.add('ss-open');
      searchInput.value = '';
      searchInput.focus();
      filterOptions('');
      highlightedIndex = -1;
    }

    function close() {
      isOpen = false;
      wrapper.classList.remove('ss-open');
      highlightedIndex = -1;
    }

    function toggle() {
      if (isOpen) close();
      else open();
    }

    function selectOption(value, text, optionData) {
      selectedValue = value;
      selectedText = text;
      selectedData = optionData;
      hidden.value = value || '';
      input.value = text || '';

      // Update selected state
      optionsContainer.querySelectorAll('.ss-option').forEach(opt => {
        opt.classList.toggle('ss-selected', opt.dataset.value === value);
      });

      // Update has-value class
      wrapper.classList.toggle('ss-has-value', !!value);

      close();

      if (config.onSelect) config.onSelect(value, text, optionData);
      if (config.onChange) config.onChange(value, text, optionData);
    }

    function clear() {
      selectOption(null, '', null);
      input.value = '';
      input.placeholder = config.placeholder;
      if (config.onClear) config.onClear();
    }

    function filterOptions(query) {
      const normalizedQuery = removeDiacritics(query.trim());
      let visibleCount = 0;
      let firstVisible = null;

      optionsContainer.querySelectorAll('.ss-option').forEach((opt, index) => {
        const text = opt.dataset.searchText || opt.textContent;
        const normalizedText = removeDiacritics(text);

        if (!normalizedQuery || normalizedText.includes(normalizedQuery)) {
          opt.style.display = '';
          visibleCount++;
          if (!firstVisible) firstVisible = opt;
        } else {
          opt.style.display = 'none';
        }
      });

      // Show/hide empty message
      let emptyMsg = optionsContainer.querySelector('.ss-empty');
      if (visibleCount === 0) {
        if (!emptyMsg) {
          emptyMsg = document.createElement('div');
          emptyMsg.className = 'ss-empty';
          emptyMsg.textContent = 'Kh\u00f4ng t\u00ecm th\u1ea5y k\u1ebft qu\u1ea3';
          optionsContainer.appendChild(emptyMsg);
        }
        emptyMsg.style.display = '';
      } else if (emptyMsg) {
        emptyMsg.style.display = 'none';
      }
    }

    function renderOptions() {
      optionsContainer.innerHTML = '';

      if (data.length === 0) {
        optionsContainer.innerHTML = '<div class="ss-empty">Kh\u00f4ng c\u00f3 d\u1eef li\u1ec7u</div>';
        return;
      }

      data.forEach((item, index) => {
        const opt = document.createElement('div');
        opt.className = 'ss-option';
        opt.dataset.value = item.value;
        opt.dataset.index = index;
        opt.dataset.searchText = item.searchText || item.text;

        if (item.subtitle) {
          opt.innerHTML = `
            <div>${item.text}</div>
            <div class="ss-option-subtitle">${item.subtitle}</div>
          `;
        } else {
          opt.textContent = item.text;
        }

        if (item.value === selectedValue) {
          opt.classList.add('ss-selected');
        }

        optionsContainer.appendChild(opt);
      });
    }

    // Bind events
    input.addEventListener('click', (e) => {
      e.stopPropagation();
      toggle();
    });

    searchInput.addEventListener('input', (e) => {
      filterOptions(e.target.value);
    });

    searchInput.addEventListener('keydown', (e) => {
      const visibleOptions = Array.from(optionsContainer.querySelectorAll('.ss-option')).filter(opt => opt.style.display !== 'none');

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        highlightedIndex = Math.min(highlightedIndex + 1, visibleOptions.length - 1);
        updateHighlight(visibleOptions);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlightedIndex = Math.max(highlightedIndex - 1, 0);
        updateHighlight(visibleOptions);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (highlightedIndex >= 0 && visibleOptions[highlightedIndex]) {
          const opt = visibleOptions[highlightedIndex];
          const idx = parseInt(opt.dataset.index);
          selectOption(data[idx].value, data[idx].text, data[idx]);
        }
      } else if (e.key === 'Escape') {
        close();
        input.focus();
      }
    });

    function updateHighlight(visibleOptions) {
      optionsContainer.querySelectorAll('.ss-option').forEach(opt => opt.classList.remove('ss-highlighted'));
      if (highlightedIndex >= 0 && visibleOptions[highlightedIndex]) {
        visibleOptions[highlightedIndex].classList.add('ss-highlighted');
        visibleOptions[highlightedIndex].scrollIntoView({ block: 'nearest' });
      }
    }

    optionsContainer.addEventListener('click', (e) => {
      const opt = e.target.closest('.ss-option');
      if (opt) {
        const idx = parseInt(opt.dataset.index);
        selectOption(data[idx].value, data[idx].text, data[idx]);
      }
    });

    dropdown.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        clear();
      });
    }

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!container.contains(e.target)) {
        close();
      }
    });

    // Public API
    const instance = {
      /**
       * Set options data
       * @param {Array} items - Array of {value, text, subtitle?, searchText?}
       */
      setData(items) {
        data = items || [];
        renderOptions();

        // Re-select if value exists in new data
        if (selectedValue) {
          const found = data.find(d => d.value === selectedValue);
          if (!found) {
            clear();
          }
        }
      },

      /**
       * Get current value
       */
      getValue() {
        return selectedValue;
      },

      /**
       * Get current text
       */
      getText() {
        return selectedText;
      },

      /**
       * Get selected data object
       */
      getSelectedData() {
        return selectedData;
      },

      /**
       * Set value programmatically
       * @param {string} value
       */
      setValue(value) {
        const item = data.find(d => d.value === value);
        if (item) {
          selectOption(item.value, item.text, item);
        } else {
          clear();
        }
      },

      /**
       * Clear selection
       */
      clear() {
        clear();
      },

      /**
       * Enable/disable
       * @param {boolean} disabled
       */
      setDisabled(disabled) {
        config.disabled = disabled;
        wrapper.classList.toggle('ss-disabled', disabled);
        input.classList.toggle('ss-disabled', disabled);
        input.disabled = disabled;
        if (disabled) close();
      },

      /**
       * Destroy instance
       */
      destroy() {
        container.innerHTML = '';
        delete instances[containerId];
      },

      /**
       * Open dropdown
       */
      open() {
        open();
      },

      /**
       * Close dropdown
       */
      close() {
        close();
      },

      /**
       * Update placeholder
       * @param {string} text
       */
      setPlaceholder(text) {
        config.placeholder = text;
        if (!selectedValue) {
          input.placeholder = text;
        }
      }
    };

    instances[containerId] = instance;
    return instance;
  }

  /**
   * Get existing instance by container ID
   * @param {string} containerId
   */
  function getInstance(containerId) {
    return instances[containerId] || null;
  }

  /**
   * Create from existing select element
   * @param {string} selectId - ID of select element to replace
   * @param {Object} options - Same as create()
   */
  function fromSelect(selectId, options = {}) {
    const select = document.getElementById(selectId);
    if (!select || select.tagName !== 'SELECT') {
      console.error(`SearchableSelect: Select #${selectId} not found`);
      return null;
    }

    // Create container
    const container = document.createElement('div');
    container.id = selectId + '_ss';
    select.parentNode.insertBefore(container, select);
    select.style.display = 'none';

    // Extract options from select
    const data = Array.from(select.options)
      .filter(opt => opt.value)
      .map(opt => ({
        value: opt.value,
        text: opt.textContent
      }));

    // Create instance
    const instance = create(container.id, {
      ...options,
      placeholder: select.options[0]?.textContent || options.placeholder,
      onSelect: (value, text, itemData) => {
        select.value = value;
        select.dispatchEvent(new Event('change'));
        if (options.onSelect) options.onSelect(value, text, itemData);
      }
    });

    instance.setData(data);

    // Set initial value if any
    if (select.value) {
      instance.setValue(select.value);
    }

    return instance;
  }

  // Public API
  return {
    create,
    getInstance,
    fromSelect
  };
})();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SearchableSelect;
}
