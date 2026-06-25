/**
 * StatsCards - Reusable summary/statistics cards grid component
 * Renders a responsive grid of stat cards with value, label, sub-text, and variant
 *
 * @module StatsCards
 *
 * Usage:
 *   const stats = StatsCards.create('myStatsContainer', {
 *     cards: [
 *       { id: 'total', label: 'Tổng Cộng', variant: 'success', icon: '📊' },
 *       { id: 'pending', label: 'Chờ Xử Lý', variant: 'warning' },
 *       { id: 'danger', label: 'Cảnh Báo', variant: 'danger' },
 *       { id: 'info', label: 'Thông Tin', variant: 'info', sub: 'Chi tiết...' }
 *     ]
 *   });
 *
 *   // Update values
 *   stats.update({ total: 42, pending: 5, danger: 1, info: '100 kg' });
 *   // Or update individual
 *   stats.setValue('total', 42, 'cập nhật lúc 10:30');
 */

const StatsCards = (function() {
  'use strict';

  const CSS_STYLES = `
    .sc-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 15px;
      margin-bottom: 20px;
    }
    .sc-card {
      background: linear-gradient(135deg, rgba(34,197,94,0.1) 0%, rgba(34,197,94,0.05) 100%);
      padding: 18px 16px;
      border-radius: 15px;
      text-align: center;
      border: 1px solid rgba(34,197,94,0.2);
      transition: transform 0.15s, box-shadow 0.15s;
    }
    .sc-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    .sc-card.sc-warning {
      background: linear-gradient(135deg, rgba(245,158,11,0.15) 0%, rgba(245,158,11,0.05) 100%);
      border-color: rgba(245,158,11,0.3);
    }
    .sc-card.sc-danger {
      background: linear-gradient(135deg, rgba(239,68,68,0.15) 0%, rgba(239,68,68,0.05) 100%);
      border-color: rgba(239,68,68,0.3);
    }
    .sc-card.sc-success {
      background: linear-gradient(135deg, rgba(34,197,94,0.15) 0%, rgba(34,197,94,0.05) 100%);
      border-color: rgba(34,197,94,0.3);
    }
    .sc-card.sc-info {
      background: linear-gradient(135deg, rgba(59,130,246,0.15) 0%, rgba(59,130,246,0.05) 100%);
      border-color: rgba(59,130,246,0.3);
    }
    .sc-card.sc-accent {
      background: linear-gradient(135deg, rgba(139,92,246,0.15) 0%, rgba(139,92,246,0.05) 100%);
      border-color: rgba(139,92,246,0.3);
    }
    .sc-icon { font-size: 20px; margin-bottom: 4px; }
    .sc-value {
      font-size: 26px; font-weight: 700; margin-bottom: 4px;
      color: var(--accent, #8b5cf6);
    }
    .sc-card.sc-warning .sc-value { color: var(--warning, #f59e0b); }
    .sc-card.sc-danger .sc-value { color: var(--danger, #ef4444); }
    .sc-card.sc-success .sc-value { color: var(--success, #22c55e); }
    .sc-card.sc-info .sc-value { color: var(--info, #3b82f6); }
    .sc-card.sc-accent .sc-value { color: var(--accent, #8b5cf6); }
    .sc-label {
      color: var(--text-secondary, #94a3b8);
      font-size: 12px; line-height: 1.3;
    }
    .sc-sub {
      font-size: 11px; color: var(--text-muted, #64748b);
      margin-top: 3px;
    }
    .sc-clickable { cursor: pointer; }
    .sc-clickable:active { transform: translateY(0); }
  `;

  let stylesInjected = false;
  const instances = {};

  function _injectStyles() {
    if (stylesInjected) return;
    var style = document.createElement('style');
    style.id = 'statscards-styles';
    style.textContent = CSS_STYLES;
    document.head.appendChild(style);
    stylesInjected = true;
  }

  function _formatValue(val) {
    if (val === null || val === undefined) return '0';
    if (typeof val === 'number') {
      return window.formatNumber ? window.formatNumber(val) : val.toLocaleString('vi-VN');
    }
    return String(val);
  }

  /**
   * Create a StatsCards instance
   * @param {string} containerId - DOM container ID
   * @param {Object} options
   * @param {Array} options.cards - Card definitions:
   *   { id, label, variant ('success'|'warning'|'danger'|'info'|'accent'), icon, sub, onClick, format }
   * @param {string} [options.gridCols] - Custom grid-template-columns CSS
   * @returns {Object} StatsCards instance
   */
  function create(containerId, options) {
    _injectStyles();
    options = options || {};

    var container = document.getElementById(containerId);
    if (!container) {
      console.error('StatsCards: Container #' + containerId + ' not found');
      return null;
    }

    var cards = options.cards || [];
    var gridCols = options.gridCols || '';

    // Build DOM
    function buildDOM() {
      var gridStyle = gridCols ? ' style="grid-template-columns:' + gridCols + '"' : '';
      var html = '<div class="sc-grid"' + gridStyle + '>';

      cards.forEach(function(card) {
        var variantCls = card.variant ? ' sc-' + card.variant : '';
        var clickCls = card.onClick ? ' sc-clickable' : '';
        html += '<div class="sc-card' + variantCls + clickCls + '" data-card-id="' + card.id + '">';
        if (card.icon) {
          html += '<div class="sc-icon">' + card.icon + '</div>';
        }
        html += '<div class="sc-value" id="' + containerId + '_val_' + card.id + '">0</div>';
        html += '<div class="sc-label">' + card.label + '</div>';
        html += '<div class="sc-sub" id="' + containerId + '_sub_' + card.id + '">' + (card.sub || '') + '</div>';
        html += '</div>';
      });

      html += '</div>';
      container.innerHTML = html;

      // Bind click events
      cards.forEach(function(card) {
        if (card.onClick) {
          var el = container.querySelector('[data-card-id="' + card.id + '"]');
          if (el) el.addEventListener('click', function() { card.onClick(card.id); });
        }
      });
    }

    buildDOM();

    var instance = {
      /**
       * Update all card values at once
       * @param {Object} values - { cardId: value, ... }
       * @param {Object} [subs] - { cardId: subText, ... }
       */
      update: function(values, subs) {
        values = values || {};
        subs = subs || {};
        cards.forEach(function(card) {
          if (values[card.id] !== undefined) {
            var valEl = document.getElementById(containerId + '_val_' + card.id);
            if (valEl) {
              var val = values[card.id];
              valEl.textContent = card.format ? card.format(val) : _formatValue(val);
            }
          }
          if (subs[card.id] !== undefined) {
            var subEl = document.getElementById(containerId + '_sub_' + card.id);
            if (subEl) subEl.textContent = subs[card.id];
          }
        });
      },

      /**
       * Set single card value
       * @param {string} cardId
       * @param {*} value
       * @param {string} [sub] - Optional sub text
       */
      setValue: function(cardId, value, sub) {
        var card = cards.find(function(c) { return c.id === cardId; });
        var valEl = document.getElementById(containerId + '_val_' + cardId);
        if (valEl) {
          valEl.textContent = card && card.format ? card.format(value) : _formatValue(value);
        }
        if (sub !== undefined) {
          var subEl = document.getElementById(containerId + '_sub_' + cardId);
          if (subEl) subEl.textContent = sub;
        }
      },

      /**
       * Set sub text for a card
       * @param {string} cardId
       * @param {string} text
       */
      setSub: function(cardId, text) {
        var subEl = document.getElementById(containerId + '_sub_' + cardId);
        if (subEl) subEl.textContent = text;
      },

      /**
       * Set sub HTML for a card
       * @param {string} cardId
       * @param {string} html
       */
      setSubHtml: function(cardId, html) {
        var subEl = document.getElementById(containerId + '_sub_' + cardId);
        if (subEl) subEl.innerHTML = html;
      },

      /**
       * Change card variant dynamically
       * @param {string} cardId
       * @param {string} variant - 'success'|'warning'|'danger'|'info'|'accent'
       */
      setVariant: function(cardId, variant) {
        var el = container.querySelector('[data-card-id="' + cardId + '"]');
        if (el) {
          el.classList.remove('sc-success', 'sc-warning', 'sc-danger', 'sc-info', 'sc-accent');
          if (variant) el.classList.add('sc-' + variant);
        }
      },

      /**
       * Show/hide a card
       * @param {string} cardId
       * @param {boolean} visible
       */
      toggleCard: function(cardId, visible) {
        var el = container.querySelector('[data-card-id="' + cardId + '"]');
        if (el) el.style.display = visible ? '' : 'none';
      },

      /**
       * Rebuild with new card definitions
       * @param {Array} newCards
       */
      setCards: function(newCards) {
        cards = newCards || [];
        buildDOM();
      },

      /**
       * Destroy instance
       */
      destroy: function() {
        container.innerHTML = '';
        delete instances[containerId];
      }
    };

    instances[containerId] = instance;
    return instance;
  }

  function getInstance(containerId) {
    return instances[containerId] || null;
  }

  return {
    create: create,
    getInstance: getInstance
  };
})();
