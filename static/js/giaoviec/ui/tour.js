// =============================================
// Onboarding Tour
// =============================================
var _tourSteps = [
  // === PH\u1EA6N 1: HEADER & NAVIGATION ===
  {
    target: '.app-header',
    title: '1. Thanh \u0111i\u1EC1u h\u01B0\u1EDBng ch\u00EDnh',
    desc: '<b>\uD83D\uDD14 Th\u00F4ng b\u00E1o:</b> Nh\u1EADn c\u1EA3nh b\u00E1o khi c\u00F3 vi\u1EC7c m\u1EDBi, qu\u00E1 h\u1EA1n ho\u1EB7c \u0111\u01B0\u1EE3c ph\u00EA duy\u1EC7t.<br><b>\uD83D\uDCC5 Vi\u1EC7c h\u00F4m nay:</b> Xem nhanh c\u00E1c vi\u1EC7c c\u1EA7n l\u00E0m trong ng\u00E0y.<br><b>\uD83D\udEA6 Vi\u1EC7c c\u1EA7n x\u1EED l\u00FD:</b> Nh\u1EEFng vi\u1EC7c \u0111ang ch\u1EDD b\u1EA1n ph\u1EA3n h\u1ED3i.<br><b>\u22EF Th\u00EAm:</b> T\u1ED5ng quan nhanh, c\u00E0i \u0111\u1EB7t, nh\u1EADt k\u00FD h\u1EC7 th\u1ED1ng.',
    pos: 'bottom'
  },
  {
    target: '.tabs',
    title: '2. Thanh tab ch\u1EE9c n\u0103ng',
    desc: '<b>\uD83D\uDCCA T\u1ED5ng Quan:</b> Dashboard th\u1ED1ng k\u00EA, bi\u1EC3u \u0111\u1ED3, c\u1EA3nh b\u00E1o s\u1EDBm.<br><b>\uD83D\uDCCB Giao Vi\u1EC7c:</b> T\u1EA1o, giao, theo d\u00F5i c\u00F4ng vi\u1EC7c.<br><b>\u2705 Vi\u1EC7c C\u1EE7a T\u00F4i:</b> C\u00E1c vi\u1EC7c \u0111\u01B0\u1EE3c giao cho b\u1EA1n.<br><b>\uD83C\uDFC6 KPI:</b> \u0110\u00E1nh gi\u00E1 hi\u1EC7u su\u1EA5t theo k\u1EF3.<br><b>\uD83D\uDCCA Ti\u1EBFn \u0111\u1ED9:</b> Gantt chart th\u1EDDi gian th\u1EF1c.<br><b>\uD83D\uDDC2 B\u1EA3ng vi\u1EC7c:</b> Kanban k\u00E9o th\u1EA3.<br><b>\uD83D\uDCC5 L\u1ECBch:</b> Xem c\u00F4ng vi\u1EC7c theo l\u1ECBch.',
    pos: 'bottom'
  },

  // === PH\u1EA6N 2: TAB GIAO VI\u1EC6C ===
  {
    target: '.toolbar-row-1',
    title: '3. T\u00ECm ki\u1EBFm & C\u00F4ng c\u1EE5',
    desc: '<b>\uD83D\uDD0D T\u00ECm ki\u1EBFm:</b> G\u00F5 t\u00EAn vi\u1EC7c \u2014 g\u1EE3i \u00FD hi\u1EC7n ngay khi g\u00F5 2+ k\u00FD t\u1EF1, b\u1EA5m v\u00E0o \u0111\u1EC3 m\u1EDF chi ti\u1EBFt.<br><b>\uD83C\uDFE2 \u0110\u01A1n v\u1ECB:</b> L\u1ECDc theo ph\u00F2ng ban c\u1EE5 th\u1EC3.<br><b>\uD83D\uDD0E L\u1ECDc n\u00E2ng cao:</b> L\u1ECDc theo ng\u00E0y, ng\u01B0\u1EDDi TH, \u01B0u ti\u00EAn, SLA.<br><b>\uD83D\uDCE5 Xu\u1EA5t:</b> In b\u00E1o c\u00E1o, xu\u1EA5t PDF/Excel/CSV.<br><b>+ T\u1EA1o c\u00F4ng vi\u1EC7c:</b> M\u1EDF form t\u1EA1o \u0111\u1EA7y \u0111\u1EE7 th\u00F4ng tin.',
    pos: 'bottom',
    before: function() { showTab('tasks'); }
  },
  {
    target: '#taskFilterChips',
    title: '4. L\u1ECDc nhanh theo tr\u1EA1ng th\u00E1i',
    desc: 'M\u1ED7i chip l\u00E0 m\u1ED9t tr\u1EA1ng th\u00E1i. <b>S\u1ED1 trong ngo\u1EB7c</b> cho bi\u1EBFt s\u1ED1 l\u01B0\u1EE3ng vi\u1EC7c.<br><br>\u2022 <b>Ch\u1EDD duy\u1EC7t:</b> Vi\u1EC7c m\u1EDBi t\u1EA1o, ch\u1EDD l\u00E3nh \u0111\u1EA1o ph\u00EA duy\u1EC7t.<br>\u2022 <b>\u0110ang l\u00E0m:</b> \u0110\u00E3 \u0111\u01B0\u1EE3c duy\u1EC7t v\u00E0 \u0111ang th\u1EF1c hi\u1EC7n.<br>\u2022 <b>Ch\u1EDD ph\u00EA duy\u1EC7t k\u1EBFt qu\u1EA3:</b> Ng\u01B0\u1EDDi TH \u0111\u00E3 b\u00E1o xong, ch\u1EDD duy\u1EC7t k\u1EBFt qu\u1EA3.<br>\u2022 <b>Xong:</b> Ho\u00E0n th\u00E0nh \u0111\u1EA7y \u0111\u1EE7.',
    pos: 'bottom'
  },
  {
    target: '.toolbar-controls',
    title: '5. T\u00F9y ch\u1EC9nh hi\u1EC3n th\u1ECB',
    desc: '<b>Lo\u1EA1i:</b> L\u1ECDc theo lo\u1EA1i vi\u1EC7c (Ch\u1EC9 \u0111\u1EA1o / Chuy\u00EAn m\u00F4n / \u0110\u1EC1 xu\u1EA5t / Ph\u1ED1i h\u1EE3p).<br><b>\u2630 \u25A4 \u25A6:</b> Chuy\u1EC3n d\u1EA1ng xem Th\u1EBB / G\u1ECDn / B\u1EA3ng.<br><b>S\u1EAFp x\u1EBFp:</b> Theo h\u1EA1n ch\u00F3t, \u01B0u ti\u00EAn, ti\u1EBFn \u0111\u1ED9, t\u00EAn...<br><b>Nh\u00F3m:</b> Nh\u00F3m theo tr\u1EA1ng th\u00E1i, ph\u00F2ng ban, ng\u01B0\u1EDDi TH.<br><b>\u2699\uFE0F SLA:</b> C\u1EA5u h\u00ECnh th\u1EDDi h\u1EA1n x\u1EED l\u00FD theo m\u1EE9c \u01B0u ti\u00EAn.<br><b>\uD83D\uDCBE L\u01B0u:</b> L\u01B0u b\u1ED9 l\u1ECDc hi\u1EC7n t\u1EA1i \u0111\u1EC3 d\u00F9ng l\u1EA1i.',
    pos: 'bottom'
  },
  {
    target: '#quickCreateBar',
    title: '6. T\u1EA1o nhanh c\u00F4ng vi\u1EC7c',
    desc: 'C\u00E1ch nhanh nh\u1EA5t \u0111\u1EC3 t\u1EA1o vi\u1EC7c m\u1EDBi:<br><br>\u2022 Nh\u1EADp t\u00EAn c\u00F4ng vi\u1EC7c v\u00E0o \u00F4 tr\u1ED1ng<br>\u2022 Ch\u1ECDn m\u1EE9c \u01B0u ti\u00EAn (B\u00ECnh th\u01B0\u1EDDng / Kh\u1EA9n c\u1EA5p / Kh\u00F4ng g\u1EA5p)<br>\u2022 Ch\u1ECDn \u0111\u01A1n v\u1ECB ph\u1EE5 tr\u00E1ch<br>\u2022 B\u1EA5m <b>T\u1EA1o</b> ho\u1EB7c nh\u1EA5n <b>Enter</b><br><br><i>Vi\u1EC7c s\u1EBD \u0111\u01B0\u1EE3c t\u1EA1o v\u1EDBi tr\u1EA1ng th\u00E1i "Ch\u1EDD duy\u1EC7t" v\u00E0 g\u1EEDi th\u00F4ng b\u00E1o cho l\u00E3nh \u0111\u1EA1o.</i>',
    pos: 'top'
  },
  {
    target: '#taskList',
    title: '7. Danh s\u00E1ch c\u00F4ng vi\u1EC7c',
    desc: '<b>C\u00E1ch \u0111\u1ECDc m\u1ED7i d\u00F2ng:</b><br>\u2022 <b>Thanh m\u00E0u b\u00EAn tr\u00E1i:</b> M\u1EE9c \u01B0u ti\u00EAn (\uD83D\uDD34 Kh\u1EA9n c\u1EA5p / \uD83D\uDFE0 B\u00ECnh th\u01B0\u1EDDng / \uD83D\uDD35 Kh\u00F4ng g\u1EA5p)<br>\u2022 <b>Avatar tr\u00F2n:</b> Ng\u01B0\u1EDDi th\u1EF1c hi\u1EC7n (hover xem t\u00EAn \u0111\u1EA7y \u0111\u1EE7)<br>\u2022 <b>Thanh ti\u1EBFn \u0111\u1ED9:</b> % ho\u00E0n th\u00E0nh hi\u1EC7n s\u1ED1 b\u00EAn c\u1EA1nh<br>\u2022 <b>Th\u1EDDi gian:</b> Hi\u1EC3n th\u1ECB "C\u00F2n 3 ng\u00E0y", "Qu\u00E1 h\u1EA1n 5 ng\u00E0y"<br>\u2022 <b>Badge m\u00E0u:</b> Tr\u1EA1ng th\u00E1i + Lo\u1EA1i vi\u1EC7c<br><br><b>Thao t\u00E1c:</b> B\u1EA5m \u0111\u1EC3 m\u1EDF chi ti\u1EBFt. Gi\u1EEF chu\u1ED9t 1 gi\u00E2y \u0111\u1EC3 xem preview. K\u00E9o th\u1EA3 \u0111\u1EC3 s\u1EAFp x\u1EBFp.',
    pos: 'top'
  },

  // === PH\u1EA6N 3: CHI TI\u1EBET C\u00D4NG VI\u1EC6C ===
  {
    target: '.fab-add',
    title: '8. N\u00FAt t\u1EA1o m\u1EDBi (+)',
    desc: 'N\u00FAt n\u1ED5i \u1EDF g\u00F3c ph\u1EA3i d\u01B0\u1EDBi \u2014 b\u1EA5m \u0111\u1EC3 t\u1EA1o c\u00F4ng vi\u1EC7c m\u1EDBi t\u1EEB <b>b\u1EA5t k\u1EF3 m\u00E0n h\u00ECnh n\u00E0o</b>.<br><br>Form t\u1EA1o bao g\u1ED3m: T\u00EAn vi\u1EC7c, m\u00F4 t\u1EA3, \u01B0u ti\u00EAn, \u0111\u01A1n v\u1ECB, ng\u01B0\u1EDDi TH, h\u1EA1n ch\u00F3t, lo\u1EA1i vi\u1EC7c, \u0111\u01A1n v\u1ECB ph\u1ED1i h\u1EE3p, file \u0111\u00EDnh k\u00E8m.',
    pos: 'top'
  },

  // === PH\u1EA6N 4: DASHBOARD ===
  {
    target: '.stat-grid',
    title: '9. Th\u1ED1ng k\u00EA t\u1ED5ng quan',
    desc: '4 \u00F4 th\u1ED1ng k\u00EA ch\u00EDnh:<br>\u2022 <b>T\u1ED5ng vi\u1EC7c:</b> T\u1EA5t c\u1EA3 c\u00F4ng vi\u1EC7c \u0111ang ho\u1EA1t \u0111\u1ED9ng<br>\u2022 <b>\u0110ang l\u00E0m:</b> Vi\u1EC7c \u0111ang th\u1EF1c hi\u1EC7n<br>\u2022 <b>Qu\u00E1 h\u1EA1n:</b> Vi\u1EC7c \u0111\u00E3 tr\u1EC5 deadline (c\u1EA7n ch\u00FA \u00FD!)<br>\u2022 <b>Ho\u00E0n th\u00E0nh:</b> Vi\u1EC7c \u0111\u00E3 xong',
    pos: 'bottom',
    before: function() { showTab('dashboard'); }
  },

  // === PH\u1EA6N 5: VI\u1EC6C C\u1EE6A T\u00D4I ===
  {
    target: '#tabMyTasks',
    title: '10. Vi\u1EC7c C\u1EE7a T\u00F4i',
    desc: 'Tab n\u00E0y ch\u1EC9 hi\u1EC3n <b>c\u00E1c vi\u1EC7c \u0111\u01B0\u1EE3c giao cho b\u1EA1n</b>.<br><br>\u2022 <b>Th\u1ED1ng k\u00EA c\u00E1 nh\u00E2n:</b> T\u1ED5ng vi\u1EC7c, \u0111ang l\u00E0m, qu\u00E1 h\u1EA1n, ho\u00E0n th\u00E0nh<br>\u2022 <b>Bi\u1EC3u \u0111\u1ED3 ti\u1EBFn \u0111\u1ED9:</b> Thanh progress cho t\u1EEBng vi\u1EC7c<br>\u2022 <b>L\u1ECDc nhanh:</b> T\u1EA5t c\u1EA3 / \u0110ang l\u00E0m / Ch\u1EDD PD / Xong<br><br>T\u1EEB \u0111\u00E2y b\u1EA1n c\u00F3 th\u1EC3 <b>b\u00E1o ho\u00E0n th\u00E0nh</b>, <b>c\u1EADp nh\u1EADt ti\u1EBFn \u0111\u1ED9</b>, <b>g\u1EEDi minh ch\u1EE9ng</b>.',
    pos: 'bottom'
  },

  // === PH\u1EA6N 6: QUY TR\u00CCNH DOANH NGHI\u1EC6P ===
  {
    target: '#tabKPI',
    title: '11. \u0110\u00E1nh gi\u00E1 KPI',
    desc: '<b>KPI t\u1EF1 \u0111\u1ED9ng</b> t\u00EDnh d\u1EF1a tr\u00EAn hi\u1EC7u su\u1EA5t c\u00F4ng vi\u1EC7c:<br><br>\u2022 <b>KPI theo ph\u00F2ng ban:</b> So s\u00E1nh hi\u1EC7u su\u1EA5t gi\u1EEFa c\u00E1c \u0111\u01A1n v\u1ECB<br>\u2022 <b>KPI c\u00E1 nh\u00E2n:</b> \u0110i\u1EC3m s\u1ED1 t\u1EEBng ng\u01B0\u1EDDi (A/B/C/D)<br>\u2022 <b>Tr\u1ECDng s\u1ED1 lo\u1EA1i vi\u1EC7c:</b> Ch\u1EC9 \u0111\u1EA1o c\u00F3 tr\u1ECDng s\u1ED1 cao h\u01A1n chuy\u00EAn m\u00F4n<br>\u2022 <b>K\u1EF3 \u0111\u00E1nh gi\u00E1:</b> Th\u00E1ng, qu\u00FD, n\u0103m ho\u1EB7c t\u00F9y ch\u1EC9nh',
    pos: 'bottom'
  },
  {
    target: '#tabKanban',
    title: '12. B\u1EA3ng vi\u1EC7c Kanban',
    desc: 'Hi\u1EC3n th\u1ECB c\u00F4ng vi\u1EC7c theo <b>c\u1ED9t tr\u1EA1ng th\u00E1i</b> (Ch\u1EDD duy\u1EC7t \u2192 \u0110ang l\u00E0m \u2192 Xong).<br><br>\u2022 <b>K\u00E9o th\u1EA3</b> card gi\u1EEFa c\u00E1c c\u1ED9t \u0111\u1EC3 \u0111\u1ED5i tr\u1EA1ng th\u00E1i<br>\u2022 Nh\u00ECn bao qu\u00E1t to\u00E0n b\u1ED9 vi\u1EC7c \u0111ang di\u1EC5n ra<br>\u2022 Ph\u00F9 h\u1EE3p cho h\u1ECDp giao ban, review ti\u1EBFn \u0111\u1ED9',
    pos: 'bottom'
  },

  // === PH\u1EA6N 7: M\u1EEOA V\u1EB6T ===
  {
    target: '.app-header',
    title: '13. M\u1EB9o s\u1EED d\u1EE5ng hi\u1EC7u qu\u1EA3',
    desc: '<b>\uD83D\uDCA1 M\u1EB9o hay:</b><br>\u2022 <b>Hover l\u00EAn task:</b> Xem preview nhanh kh\u00F4ng c\u1EA7n m\u1EDF<br>\u2022 <b>Click ph\u1EA3i:</b> Menu ng\u1EEF c\u1EA3nh nhanh<br>\u2022 <b>K\u00E9o th\u1EA3:</b> S\u1EAFp x\u1EBFp task trong danh s\u00E1ch<br>\u2022 <b>Badge s\u1ED1 tr\u00EAn tab:</b> B\u1EA5m v\u00E0o \u0111\u1EC3 xem danh s\u00E1ch vi\u1EC7c c\u1EA7n x\u1EED l\u00FD<br>\u2022 <b>Xu\u1EA5t b\u00E1o c\u00E1o:</b> In/PDF/Excel t\u1EEB n\u00FAt Xu\u1EA5t<br>\u2022 <b>Tr\u00ECnh chi\u1EBFu:</b> Ch\u1EBF \u0111\u1ED9 b\u00E1o c\u00E1o to\u00E0n m\u00E0n h\u00ECnh cho h\u1ECDp<br><br><i>B\u1EA1n c\u00F3 th\u1EC3 xem l\u1EA1i h\u01B0\u1EDBng d\u1EABn n\u00E0y b\u1EA5t c\u1EE9 l\u00FAc n\u00E0o t\u1EEB menu <b>\u22EF \u2192 \uD83D\uDCD6 H\u01B0\u1EDBng d\u1EABn s\u1EED d\u1EE5ng</b></i>',
    pos: 'bottom'
  }
];

var _tourCurrent = 0;
var _tourOverlay = null;
var _tourHighlight = null;
var _tourTooltip = null;

function startTour() {
  closeHeaderMore();
  _tourCurrent = 0;

  // Create overlay elements if not exist
  if (!document.getElementById('tourOverlay')) {
    var ov = document.createElement('div');
    ov.id = 'tourOverlay';
    ov.className = 'tour-overlay';
    ov.onclick = function(e) { if (e.target === ov) return; };

    var hl = document.createElement('div');
    hl.id = 'tourHighlight';
    hl.className = 'tour-highlight';

    var tt = document.createElement('div');
    tt.id = 'tourTooltip';
    tt.className = 'tour-tooltip';

    document.body.appendChild(ov);
    document.body.appendChild(hl);
    document.body.appendChild(tt);
  }
  _tourOverlay = document.getElementById('tourOverlay');
  _tourHighlight = document.getElementById('tourHighlight');
  _tourTooltip = document.getElementById('tourTooltip');

  _tourOverlay.classList.add('active');
  showTourStep(0);
}

function showTourStep(idx) {
  _tourCurrent = idx;
  var step = _tourSteps[idx];
  if (!step) { endTour(); return; }

  // Run before hook
  if (step.before) step.before();

  setTimeout(function() {
    var el = document.querySelector(step.target);
    if (!el || el.offsetParent === null) {
      // Target not visible, skip to next
      if (idx < _tourSteps.length - 1) showTourStep(idx + 1);
      else endTour();
      return;
    }

    var rect = el.getBoundingClientRect();
    var pad = 8;

    // Position highlight
    _tourHighlight.style.top = (rect.top - pad + window.scrollY) + 'px';
    _tourHighlight.style.left = (rect.left - pad) + 'px';
    _tourHighlight.style.width = (rect.width + pad * 2) + 'px';
    _tourHighlight.style.height = (rect.height + pad * 2) + 'px';
    _tourHighlight.style.display = 'block';

    // Scroll into view
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Progress dots
    var dots = _tourSteps.map(function(_, i) {
      var cls = i < idx ? 'done' : i === idx ? 'active' : '';
      return '<div class="tour-progress-dot ' + cls + '"></div>';
    }).join('');

    // Build tooltip
    _tourTooltip.innerHTML =
      '<div class="tour-tooltip-arrow ' + (step.pos === 'bottom' ? 'top' : 'bottom') + '"></div>' +
      '<div class="tour-title"><span class="tour-step-badge">' + (idx + 1) + '</span>' + step.title + '</div>' +
      '<div class="tour-desc">' + step.desc + '</div>' +
      '<div class="tour-progress">' + dots + '</div>' +
      '<div class="tour-actions">' +
        '<button class="tour-btn tour-btn-skip" onclick="endTour()">B\u1ECF qua</button>' +
        '<div style="display:flex;gap:6px;">' +
          (idx > 0 ? '<button class="tour-btn tour-btn-prev" onclick="showTourStep(' + (idx - 1) + ')">\u2190 Tr\u01B0\u1EDBc</button>' : '') +
          (idx < _tourSteps.length - 1
            ? '<button class="tour-btn tour-btn-next" onclick="showTourStep(' + (idx + 1) + ')">Ti\u1EBFp \u2192</button>'
            : '<button class="tour-btn tour-btn-next" onclick="endTour()">Ho\u00E0n t\u1EA5t \u2713</button>') +
        '</div>' +
      '</div>';

    // Position tooltip
    var ttW = 340;
    var ttLeft = Math.min(Math.max(rect.left, 16), window.innerWidth - ttW - 16);
    if (step.pos === 'bottom') {
      _tourTooltip.style.top = (rect.bottom + pad + 12 + window.scrollY) + 'px';
    } else {
      _tourTooltip.style.top = (rect.top - pad - 12 + window.scrollY - 200) + 'px';
    }
    _tourTooltip.style.left = ttLeft + 'px';
    _tourTooltip.style.display = 'block';
  }, 150);
}

function endTour() {
  if (_tourOverlay) _tourOverlay.classList.remove('active');
  if (_tourHighlight) _tourHighlight.style.display = 'none';
  if (_tourTooltip) _tourTooltip.style.display = 'none';
  localStorage.setItem('gv_tour_done', '1');
}

// Auto-start tour for first-time users (after data loads)
function checkAutoTour() {
  if (!localStorage.getItem('gv_tour_done')) {
    setTimeout(startTour, 2000);
  }
}

