// =============================================================
// MOBILE ENHANCEMENTS
// =============================================================

// --- Phase 2: Mobile Header Menu ---
// Removed — header already has "⋯" (headerMoreBtn) with all actions

// --- Phase 3: Bottom Nav Sync ---
(function patchShowTabForBottomNav() {
  if (typeof showTab !== 'function') return;
  var _origShowTab = showTab;
  showTab = function(tabName) {
    _origShowTab(tabName);
    // Sync bottom nav active state
    document.querySelectorAll('.bnav-item[data-tab]').forEach(function(el) {
      el.classList.toggle('active', el.getAttribute('data-tab') === tabName);
    });
    // If tab is in drawer (not in bottom nav), highlight "more" button
    var directTabs = ['dashboard', 'tasks', 'mytasks', 'kanban'];
    var moreBtn = document.querySelector('.bnav-more');
    if (moreBtn) {
      moreBtn.classList.toggle('active', directTabs.indexOf(tabName) === -1);
    }
  };
})();

function toggleMobileTabDrawer() {
  var drawer = document.getElementById('mobileTabDrawer');
  var bg = document.getElementById('mobileTabDrawerBg');
  if (drawer) drawer.classList.toggle('show');
  if (bg) bg.classList.toggle('show');
}
function closeMobileTabDrawer() {
  var drawer = document.getElementById('mobileTabDrawer');
  var bg = document.getElementById('mobileTabDrawerBg');
  if (drawer) drawer.classList.remove('show');
  if (bg) bg.classList.remove('show');
}

// --- Phase 7: Sidebar Swipe-to-Close + Overlay ---
(function initSidebarMobile() {
  var sidebar = document.querySelector('.status-sidebar');
  if (!sidebar) return;

  var startX = 0, currentX = 0, swiping = false;

  sidebar.addEventListener('touchstart', function(e) {
    startX = e.touches[0].clientX;
    currentX = startX;
    swiping = true;
  }, { passive: true });

  sidebar.addEventListener('touchmove', function(e) {
    if (!swiping) return;
    currentX = e.touches[0].clientX;
    var dx = currentX - startX;
    if (dx > 0) {
      sidebar.style.transform = 'translateX(' + dx + 'px)';
    }
  }, { passive: true });

  sidebar.addEventListener('touchend', function() {
    if (!swiping) return;
    swiping = false;
    var dx = currentX - startX;
    if (dx > 80 && typeof toggleStatusSidebar === 'function') {
      toggleStatusSidebar();
    }
    sidebar.style.transform = '';
    startX = 0;
    currentX = 0;
  }, { passive: true });

  // Patch toggle to manage overlay
  if (typeof toggleStatusSidebar === 'function') {
    var _origToggle = toggleStatusSidebar;
    toggleStatusSidebar = function() {
      _origToggle();
      if (window.innerWidth <= 768) {
        var isOpen = sidebar.classList.contains('open');
        var overlay = document.getElementById('sidebarOverlay');
        if (!overlay) {
          overlay = document.createElement('div');
          overlay.id = 'sidebarOverlay';
          overlay.className = 'sidebar-overlay';
          overlay.onclick = function() { toggleStatusSidebar(); };
          document.body.appendChild(overlay);
        }
        overlay.classList.toggle('show', isOpen);
      }
    };
  }
})();

// --- Phase 13-TASK: Task toolbar overflow menu for mobile ---
var _toolbarMenuCloseHandler = null;
function _removeToolbarMenu() {
  var m = document.getElementById('taskToolbarMenu');
  if (m) m.remove();
  if (_toolbarMenuCloseHandler) {
    document.removeEventListener('click', _toolbarMenuCloseHandler);
    _toolbarMenuCloseHandler = null;
  }
}
function toggleTaskToolbarMenu() {
  var existing = document.getElementById('taskToolbarMenu');
  if (existing) { _removeToolbarMenu(); return; }
  var menu = document.createElement('div');
  menu.id = 'taskToolbarMenu';
  menu.style.cssText = 'position:fixed;bottom:70px;left:10px;right:10px;background:var(--card);border:1px solid var(--border);border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.4);z-index:500;padding:8px;';
  var items = [
    { icon: '\uD83D\uDDA8\uFE0F', label: 'In', fn: 'printReport()' },
    { icon: '\uD83D\uDCC4', label: 'Xu\u1EA5t PDF', fn: 'openPDFReport()' },
    { icon: '\uD83D\uDCE5', label: 'Xu\u1EA5t Excel', fn: 'exportTasksExcel()' },
    { icon: '\uD83D\uDCE5', label: 'Xu\u1EA5t CSV', fn: 'exportTasksCSV()' },
    { icon: '\uD83D\uDCCB', label: 'Sao ch\u00E9p', fn: 'exportTasksClipboard()' }
  ];
  var html = '';
  items.forEach(function(a) {
    html += '<button style="display:flex;align-items:center;gap:10px;width:100%;padding:12px 14px;border:none;background:none;color:var(--text-secondary);font-size:15px;border-radius:8px;cursor:pointer;text-align:left;" onclick="' + a.fn + ';_removeToolbarMenu();">' + a.icon + ' ' + a.label + '</button>';
  });
  menu.innerHTML = html;
  document.body.appendChild(menu);
  // Close on outside click
  setTimeout(function() {
    _toolbarMenuCloseHandler = function(e) {
      var m = document.getElementById('taskToolbarMenu');
      if (!m || !m.contains(e.target)) { _removeToolbarMenu(); }
    };
    document.addEventListener('click', _toolbarMenuCloseHandler);
  }, 50);
}

// --- Phase 13: Resize listener for orientation change ---
(function initResizeHandler() {
  var _resizeTimer;
  window.addEventListener('resize', function() {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(function() {
      var isMobile = window.innerWidth <= 768;
      var bottomNav = document.getElementById('mobileBottomNav');
      var tabs = document.querySelector('.tabs');
      if (bottomNav) bottomNav.style.display = isMobile ? '' : 'none';
      if (tabs) tabs.style.display = isMobile ? 'none' : '';
      // Close dropdowns/panels that may be positioned wrong after resize
      var ddPanels = document.querySelectorAll('.ms-dropdown-panel.open');
      ddPanels.forEach(function(p) { p.classList.remove('open'); });
    }, 150);
  });
})();
