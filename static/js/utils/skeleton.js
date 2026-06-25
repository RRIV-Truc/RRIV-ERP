/**
 * Skeleton Loading Module
 * Tạo skeleton placeholders cho loading states
 * @module skeleton
 */

const Skeleton = (function() {
  'use strict';

  // ==================== TEMPLATES ====================

  const TEMPLATES = {
    // Text skeleton
    text: (lines = 3, widths = [100, 80, 60]) => {
      return widths.slice(0, lines).map(w =>
        `<div class="skeleton skeleton-text" style="width: ${w}%"></div>`
      ).join('');
    },

    // Avatar skeleton
    avatar: (size = 'md') => {
      const sizes = { sm: '32px', md: '48px', lg: '64px', xl: '96px' };
      return `<div class="skeleton skeleton-avatar" style="width: ${sizes[size]}; height: ${sizes[size]}"></div>`;
    },

    // Image skeleton
    image: (aspectRatio = '16/9') => {
      return `<div class="skeleton skeleton-image" style="aspect-ratio: ${aspectRatio}"></div>`;
    },

    // Button skeleton
    button: (width = '120px') => {
      return `<div class="skeleton skeleton-button" style="width: ${width}"></div>`;
    },

    // Card skeleton
    card: () => `
      <div class="skeleton-card">
        <div class="skeleton skeleton-image" style="aspect-ratio: 16/9"></div>
        <div class="skeleton-card-body">
          <div class="skeleton skeleton-text" style="width: 80%"></div>
          <div class="skeleton skeleton-text" style="width: 100%"></div>
          <div class="skeleton skeleton-text" style="width: 60%"></div>
        </div>
      </div>
    `,

    // Table row skeleton
    tableRow: (cols = 5) => {
      const cells = Array(cols).fill('')
        .map(() => `<td><div class="skeleton skeleton-text" style="width: ${60 + Math.random() * 40}%"></div></td>`)
        .join('');
      return `<tr class="skeleton-row">${cells}</tr>`;
    },

    // Table skeleton
    table: (rows = 5, cols = 5) => {
      const headerCells = Array(cols).fill('')
        .map(() => `<th><div class="skeleton skeleton-text" style="width: 70%"></div></th>`)
        .join('');
      const bodyRows = Array(rows).fill('')
        .map(() => TEMPLATES.tableRow(cols))
        .join('');

      return `
        <table class="skeleton-table">
          <thead><tr>${headerCells}</tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
      `;
    },

    // List item skeleton
    listItem: () => `
      <div class="skeleton-list-item">
        <div class="skeleton skeleton-avatar" style="width: 40px; height: 40px"></div>
        <div class="skeleton-list-item-content">
          <div class="skeleton skeleton-text" style="width: 60%"></div>
          <div class="skeleton skeleton-text" style="width: 80%"></div>
        </div>
      </div>
    `,

    // List skeleton
    list: (items = 5) => {
      return Array(items).fill('')
        .map(() => TEMPLATES.listItem())
        .join('');
    },

    // Form skeleton
    form: (fields = 4) => {
      return Array(fields).fill('').map(() => `
        <div class="skeleton-form-group">
          <div class="skeleton skeleton-text" style="width: 30%; height: 14px; margin-bottom: 8px"></div>
          <div class="skeleton skeleton-input"></div>
        </div>
      `).join('') + `
        <div class="skeleton-form-actions">
          <div class="skeleton skeleton-button" style="width: 100px"></div>
          <div class="skeleton skeleton-button" style="width: 80px"></div>
        </div>
      `;
    },

    // Stats card skeleton
    statsCard: () => `
      <div class="skeleton-stats-card">
        <div class="skeleton skeleton-text" style="width: 50%; height: 14px"></div>
        <div class="skeleton skeleton-text" style="width: 40%; height: 32px; margin-top: 8px"></div>
        <div class="skeleton skeleton-text" style="width: 60%; height: 12px; margin-top: 8px"></div>
      </div>
    `,

    // Dashboard skeleton
    dashboard: () => `
      <div class="skeleton-dashboard">
        <div class="skeleton-dashboard-stats">
          ${Array(4).fill('').map(() => TEMPLATES.statsCard()).join('')}
        </div>
        <div class="skeleton-dashboard-main">
          <div class="skeleton-dashboard-chart">
            <div class="skeleton skeleton-text" style="width: 30%; height: 20px; margin-bottom: 16px"></div>
            <div class="skeleton skeleton-image" style="aspect-ratio: 2/1"></div>
          </div>
          <div class="skeleton-dashboard-table">
            <div class="skeleton skeleton-text" style="width: 25%; height: 20px; margin-bottom: 16px"></div>
            ${TEMPLATES.table(5, 4)}
          </div>
        </div>
      </div>
    `,

    // Personnel profile skeleton
    profile: () => `
      <div class="skeleton-profile">
        <div class="skeleton-profile-header">
          <div class="skeleton skeleton-avatar" style="width: 120px; height: 120px"></div>
          <div class="skeleton-profile-info">
            <div class="skeleton skeleton-text" style="width: 200px; height: 24px"></div>
            <div class="skeleton skeleton-text" style="width: 150px; height: 16px; margin-top: 8px"></div>
            <div class="skeleton skeleton-text" style="width: 180px; height: 14px; margin-top: 8px"></div>
          </div>
        </div>
        <div class="skeleton-profile-body">
          ${TEMPLATES.form(6)}
        </div>
      </div>
    `,

    // Notification item skeleton
    notification: () => `
      <div class="skeleton-notification">
        <div class="skeleton skeleton-avatar" style="width: 36px; height: 36px"></div>
        <div class="skeleton-notification-content">
          <div class="skeleton skeleton-text" style="width: 90%"></div>
          <div class="skeleton skeleton-text" style="width: 60%"></div>
          <div class="skeleton skeleton-text" style="width: 30%; height: 12px; margin-top: 4px"></div>
        </div>
      </div>
    `,

    // Calendar skeleton
    calendar: () => {
      const days = Array(35).fill('')
        .map(() => `<div class="skeleton-calendar-day"><div class="skeleton" style="width: 24px; height: 24px; border-radius: 50%"></div></div>`)
        .join('');
      return `
        <div class="skeleton-calendar">
          <div class="skeleton-calendar-header">
            <div class="skeleton skeleton-button" style="width: 32px; height: 32px"></div>
            <div class="skeleton skeleton-text" style="width: 150px; height: 20px"></div>
            <div class="skeleton skeleton-button" style="width: 32px; height: 32px"></div>
          </div>
          <div class="skeleton-calendar-weekdays">
            ${Array(7).fill('').map(() => `<div class="skeleton skeleton-text" style="width: 30px; height: 14px"></div>`).join('')}
          </div>
          <div class="skeleton-calendar-days">${days}</div>
        </div>
      `;
    }
  };

  // ==================== CSS STYLES ====================

  const STYLES = `
    /* Base skeleton */
    .skeleton {
      background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
      background-size: 200% 100%;
      animation: skeleton-shimmer 1.5s infinite;
      border-radius: 4px;
    }

    @keyframes skeleton-shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    /* Skeleton text */
    .skeleton-text {
      height: 16px;
      margin-bottom: 8px;
    }

    .skeleton-text:last-child {
      margin-bottom: 0;
    }

    /* Skeleton avatar */
    .skeleton-avatar {
      border-radius: 50%;
      flex-shrink: 0;
    }

    /* Skeleton image */
    .skeleton-image {
      width: 100%;
      min-height: 100px;
      border-radius: 8px;
    }

    /* Skeleton button */
    .skeleton-button {
      height: 36px;
      border-radius: 6px;
    }

    /* Skeleton input */
    .skeleton-input {
      height: 40px;
      border-radius: 6px;
    }

    /* Skeleton card */
    .skeleton-card {
      background: white;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }

    .skeleton-card-body {
      padding: 16px;
    }

    /* Skeleton table */
    .skeleton-table {
      width: 100%;
      border-collapse: collapse;
    }

    .skeleton-table th,
    .skeleton-table td {
      padding: 12px;
      border-bottom: 1px solid #f0f0f0;
    }

    .skeleton-row {
      animation: skeleton-row-fade 1.5s infinite;
    }

    .skeleton-row:nth-child(odd) {
      animation-delay: 0.1s;
    }

    @keyframes skeleton-row-fade {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }

    /* Skeleton list */
    .skeleton-list-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      border-bottom: 1px solid #f0f0f0;
    }

    .skeleton-list-item-content {
      flex: 1;
    }

    /* Skeleton form */
    .skeleton-form-group {
      margin-bottom: 16px;
    }

    .skeleton-form-actions {
      display: flex;
      gap: 12px;
      margin-top: 24px;
    }

    /* Skeleton stats card */
    .skeleton-stats-card {
      background: white;
      padding: 20px;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }

    /* Skeleton dashboard */
    .skeleton-dashboard-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }

    .skeleton-dashboard-main {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
    }

    .skeleton-dashboard-chart,
    .skeleton-dashboard-table {
      background: white;
      padding: 20px;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }

    @media (max-width: 768px) {
      .skeleton-dashboard-main {
        grid-template-columns: 1fr;
      }
    }

    /* Skeleton profile */
    .skeleton-profile {
      background: white;
      padding: 24px;
      border-radius: 12px;
    }

    .skeleton-profile-header {
      display: flex;
      gap: 20px;
      margin-bottom: 24px;
      padding-bottom: 24px;
      border-bottom: 1px solid #f0f0f0;
    }

    .skeleton-profile-info {
      flex: 1;
    }

    /* Skeleton notification */
    .skeleton-notification {
      display: flex;
      gap: 12px;
      padding: 12px;
      border-bottom: 1px solid #f0f0f0;
    }

    .skeleton-notification-content {
      flex: 1;
    }

    /* Skeleton calendar */
    .skeleton-calendar {
      background: white;
      padding: 16px;
      border-radius: 12px;
    }

    .skeleton-calendar-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }

    .skeleton-calendar-weekdays {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 4px;
      margin-bottom: 8px;
      text-align: center;
    }

    .skeleton-calendar-days {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 4px;
    }

    .skeleton-calendar-day {
      display: flex;
      justify-content: center;
      padding: 8px;
    }

    /* Pulse variant */
    .skeleton.skeleton-pulse {
      animation: skeleton-pulse 1.5s ease-in-out infinite;
    }

    @keyframes skeleton-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    /* Wave variant */
    .skeleton.skeleton-wave {
      background: linear-gradient(90deg,
        #f0f0f0 0%,
        #e8e8e8 20%,
        #f0f0f0 40%,
        #f0f0f0 100%
      );
      background-size: 200% 100%;
      animation: skeleton-wave 1.2s linear infinite;
    }

    @keyframes skeleton-wave {
      0% { background-position: 100% 0; }
      100% { background-position: -100% 0; }
    }

    /* Dark mode */
    @media (prefers-color-scheme: dark) {
      .skeleton {
        background: linear-gradient(90deg, #2a2a2a 25%, #3a3a3a 50%, #2a2a2a 75%);
        background-size: 200% 100%;
      }

      .skeleton-card,
      .skeleton-stats-card,
      .skeleton-dashboard-chart,
      .skeleton-dashboard-table,
      .skeleton-profile,
      .skeleton-calendar {
        background: #1a1a1a;
      }

      .skeleton-list-item,
      .skeleton-notification,
      .skeleton-profile-header {
        border-color: #333;
      }
    }
  `;

  // ==================== CORE FUNCTIONS ====================

  let stylesInjected = false;

  /**
   * Inject skeleton styles
   */
  function injectStyles() {
    if (stylesInjected) return;

    const style = document.createElement('style');
    style.id = 'skeleton-styles';
    style.textContent = STYLES;
    document.head.appendChild(style);
    stylesInjected = true;
  }

  /**
   * Create skeleton element
   * @param {string} template - Template name or custom HTML
   * @param {Object} options - Options
   * @returns {HTMLElement}
   */
  function create(template, options = {}) {
    injectStyles();

    const {
      variant = 'shimmer', // shimmer, pulse, wave
      count = 1,
      wrapper = 'div',
      wrapperClass = ''
    } = options;

    // Get template HTML
    let html = '';
    if (typeof template === 'function') {
      html = template(options);
    } else if (TEMPLATES[template]) {
      html = TEMPLATES[template](options.lines, options.widths);
    } else {
      html = template;
    }

    // Repeat if count > 1
    if (count > 1) {
      html = Array(count).fill(html).join('');
    }

    // Apply variant
    if (variant !== 'shimmer') {
      html = html.replace(/class="skeleton/g, `class="skeleton skeleton-${variant}`);
    }

    // Create wrapper element
    const container = document.createElement(wrapper);
    if (wrapperClass) {
      container.className = wrapperClass;
    }
    container.innerHTML = html;

    return container;
  }

  /**
   * Show skeleton in element
   * @param {HTMLElement|string} element - Target element or selector
   * @param {string} template - Template name
   * @param {Object} options - Options
   */
  function show(element, template = 'text', options = {}) {
    const target = typeof element === 'string'
      ? document.querySelector(element)
      : element;

    if (!target) return null;

    // Save original content
    target.dataset.originalContent = target.innerHTML;
    target.dataset.skeletonActive = 'true';

    // Create and insert skeleton
    const skeleton = create(template, options);
    target.innerHTML = '';
    target.appendChild(skeleton);

    return skeleton;
  }

  /**
   * Hide skeleton and restore content
   * @param {HTMLElement|string} element - Target element or selector
   * @param {string} newContent - Optional new content to show
   */
  function hide(element, newContent = null) {
    const target = typeof element === 'string'
      ? document.querySelector(element)
      : element;

    if (!target || target.dataset.skeletonActive !== 'true') return;

    // Restore or set new content
    if (newContent !== null) {
      target.innerHTML = newContent;
    } else if (target.dataset.originalContent) {
      target.innerHTML = target.dataset.originalContent;
    }

    delete target.dataset.originalContent;
    delete target.dataset.skeletonActive;
  }

  /**
   * Replace skeleton with content smoothly
   * @param {HTMLElement|string} element - Target element
   * @param {string|HTMLElement} content - New content
   * @param {Object} options - Animation options
   */
  function replace(element, content, options = {}) {
    const {
      animation = 'fade', // fade, slide, none
      duration = 300
    } = options;

    const target = typeof element === 'string'
      ? document.querySelector(element)
      : element;

    if (!target) return;

    if (animation === 'none') {
      if (typeof content === 'string') {
        target.innerHTML = content;
      } else {
        target.innerHTML = '';
        target.appendChild(content);
      }
      delete target.dataset.originalContent;
      delete target.dataset.skeletonActive;
      return;
    }

    // Fade out skeleton
    target.style.transition = `opacity ${duration / 2}ms ease`;
    target.style.opacity = '0';

    setTimeout(() => {
      // Replace content
      if (typeof content === 'string') {
        target.innerHTML = content;
      } else {
        target.innerHTML = '';
        target.appendChild(content);
      }

      // Fade in content
      target.style.opacity = '1';

      setTimeout(() => {
        target.style.transition = '';
        delete target.dataset.originalContent;
        delete target.dataset.skeletonActive;
      }, duration / 2);
    }, duration / 2);
  }

  /**
   * Show multiple skeletons
   * @param {Object} config - Map of selector to template
   */
  function showMultiple(config) {
    Object.entries(config).forEach(([selector, template]) => {
      const options = typeof template === 'object' ? template : { template };
      show(selector, options.template || 'text', options);
    });
  }

  /**
   * Hide multiple skeletons
   * @param {string[]} selectors - Array of selectors
   */
  function hideMultiple(selectors) {
    selectors.forEach(selector => hide(selector));
  }

  /**
   * Wrap async function with skeleton loading
   * @param {HTMLElement|string} element - Target element
   * @param {Function} asyncFn - Async function to execute
   * @param {string} template - Skeleton template
   * @param {Object} options - Options
   */
  async function wrap(element, asyncFn, template = 'text', options = {}) {
    show(element, template, options);

    try {
      const result = await asyncFn();

      if (options.renderResult) {
        const content = options.renderResult(result);
        replace(element, content, { animation: options.animation });
      } else {
        hide(element);
      }

      return result;
    } catch (error) {
      hide(element);
      throw error;
    }
  }

  // ==================== PUBLIC API ====================

  // Initialize styles on load
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', injectStyles);
    } else {
      injectStyles();
    }
  }

  return {
    // Core
    create,
    show,
    hide,
    replace,

    // Batch operations
    showMultiple,
    hideMultiple,

    // Async wrapper
    wrap,

    // Templates
    templates: TEMPLATES,

    // Inject styles manually
    injectStyles
  };
})();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Skeleton;
}
