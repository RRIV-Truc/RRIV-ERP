/**
 * Stage Configuration - Giai đoạn sản xuất, fields, labels, shifts, ovens
 * @module SanxuatStages
 */

const SanxuatStages = (function() {
  'use strict';

  // ==================== STAGE ORDER ====================
  const STAGE_ORDER = ['xulymu','taodong','canmu','taohat','say','epbanh','baogoi'];

  // Batch stages (hồ): steps 1-2 only, ends at taodong
  const BATCH_STAGE_ORDER = ['xulymu', 'taodong'];

  // Line record stages (phiếu DC): steps 3-7
  const LINE_STAGE_ORDER = ['canmu', 'taohat', 'say', 'epbanh', 'baogoi'];

  // ==================== DEFAULT STAGE LABELS ====================
  const DEFAULT_LABELS = {
    tiepnhan:'Tiếp Nhận', xulymu:'Xử Lý Mủ', taodong:'Tạo Đông',
    canmu:'Cán Mủ', taohat:'Băm Tinh & Xếp Hộc', say:'Sấy',
    epbanh:'Ép Bành', baogoi:'Bao Gói'
  };

  // SVR 10/20 (TCCS 102) - quy trình khác mủ nước
  const SVR1020_LABELS = {
    tiepnhan:'Tiếp nhận & PL', xulymu:'Trộn đều', taodong:'Không áp dụng',
    canmu:'Gia công CH 1', taohat:'Gia công CH 2', say:'Sấy',
    epbanh:'Cân & Ép bành', baogoi:'Bao gói & KL'
  };

  // Latex (TCCS 107) - quy trình ly tâm
  const LATEX_LABELS = {
    tiepnhan:'Tiếp nhận NL', xulymu:'Pha loãng & HC', taodong:'Lắng',
    canmu:'Ly tâm', taohat:'Hoàn chỉnh', say:'Bồn trung chuyển',
    epbanh:'Tồn trữ', baogoi:'Xuất hàng'
  };

  // ==================== STAGE FIELDS PER PRODUCT TYPE ====================

  // Standard SVR 3L/5/CV/L
  const STAGE_FIELDS = {
    tiepnhan: ['paramDRC','paramTSC','paramNH3','paramPH','paramLoaiMu','paramNgoaiQuan','paramPhanHangBD','paramGiongCay','paramMauSacMu','paramTGTiepNhan'],
    xulymu: ['paramKLHoThucTe','paramDRCTruoc','paramDRCSau','paramNuocPhaLoang','paramKLSauPhaLoang','paramNa2S2O5','paramMeshLoc','paramMooneyBanDau','paramHAS'],
    taodong: ['paramSoMuong','paramLoaiAxit','paramNongDoAxit','paramKLDungDichAxit','paramKLAxit','paramTGBatDauMuong','paramTGKetThucMuong','paramTGCanDuKien','paramKLBotDayHo'],
    canmu: ['paramDayCanKeo','paramKheCan1','paramKheCan2','paramKheCan3','paramDayTruocBam'],
    taohat: ['paramKichThuocHat','paramChieuSauBon','paramKLHoc','paramTGXepHoc','paramTGDeRao'],
    say: ['paramNhienLieu','paramNhietDoSay','paramSoThungSayDC','paramSoThungTrongLo','paramMooneySay','paramMooneyTarget','paramMauSacSay','paramKQSauSay'],
    epbanh: ['paramNhietDoNguoi','paramKhoiLuongBanh','paramKichThuocBanh','paramThoiGianEp','paramTyLeKiemTra'],
    baogoi: ['paramPhanHang','paramSoLuongBanh','paramViTriKho','paramGhiNhanStatus']
  };

  // SVR 10/20 (TCCS 102)
  const STAGE_FIELDS_102 = {
    tiepnhan: ['paramLoaiMu','paramNgoaiQuan','paramPhanHangBD','paramNguonTonTru'],
    xulymu: [],
    taodong: [],
    canmu: ['paramKheCan1','paramKheCan2','paramKheCan3','paramDayTruocBam'],
    taohat: ['paramKichThuocHat'],
    say: ['paramNhienLieu','paramNhietDoSay','paramSoThungSayDC','paramSoThungTrongLo'],
    epbanh: ['paramNhietDoNguoi','paramKhoiLuongBanh','paramKichThuocBanh','paramThoiGianEp','paramTyLeKiemTra'],
    baogoi: ['paramPhanHang','paramSoLuongBanh','paramViTriKho','paramGhiNhanStatus']
  };

  // Latex HA/LA (TCCS 107)
  const STAGE_FIELDS_107 = {
    tiepnhan: ['paramLoaiMu','paramNgoaiQuan','paramDRC','paramTSC','paramNH3','paramPH',
               'paramVFA_LT','paramMg_LT','paramTGTiepNhan_LT'],
    xulymu: ['paramKLHoThucTe','paramMeshLoc','paramDRCTruoc','paramDRCSau','paramNuocPhaLoang','paramKLSauPhaLoang',
             'paramNH3BoSung','paramMg_PL','paramDAHP','paramThoiGianKhuay'],
    taodong: ['paramThoiGianLang','paramNH3_Lang','paramVFA_Lang','paramMg_Lang'],
    canmu: ['paramMeshLocLT','paramThoiGianVS','paramDRC_LT','paramTSC_LT','paramHieuSuatLT'],
    taohat: ['paramMeshLocHC','paramNH3_HC','paramAmoniLaurat',
             'paramTMTD','paramZnO','paramThoiGianKhuay_HC'],
    say: ['paramSoBonTC','paramTSC_TC','paramDRC_TC','paramNH3_TC',
          'paramVFA_TC','paramKOH_TC','paramMST_TC','paramMg_TC'],
    epbanh: ['paramSoBonTT','paramNgaySinhNhat','paramTSC_TT','paramDRC_TT',
             'paramNH3_TT','paramVFA_TT','paramKOH_TT','paramMST_TT'],
    baogoi: ['paramThoiGianTonTru','paramCan','paramDongKet','paramCu','paramMn',
             'paramPhanHang','paramGhiNhanStatus']
  };

  // ==================== SHIFT CONFIG ====================
  const SHIFT_CONFIG = {
    tiepnhan: [
      { code: 'TN-A', name: 'Ca TN A', defaultStart: '', defaultEnd: '' },
      { code: 'TN-B', name: 'Ca TN B', defaultStart: '', defaultEnd: '' }
    ],
    sanxuat: [
      { code: 'SX-1', name: 'Ca SX 1', defaultStart: '06:00', defaultEnd: '14:00' },
      { code: 'SX-2', name: 'Ca SX 2', defaultStart: '14:00', defaultEnd: '22:00' },
      { code: 'SX-3', name: 'Ca SX 3', defaultStart: '22:00', defaultEnd: '06:00' }
    ]
  };

  const LONG_STAGES = ['taodong', 'say'];

  // ==================== OVEN CONFIG ====================
  const OVEN_CONFIG = {
    'A02': [
      { id: 'LO-MN1', name: 'Lò MN 1', line: 'Dây chuyền mủ nước 1', capacity: 24, waitingSlots: 4 },
      { id: 'LO-MN2', name: 'Lò MN 2', line: 'Dây chuyền mủ nước 2', capacity: 24, waitingSlots: 4 },
      { id: 'LO-MT', name: 'Lò mủ tạp', line: 'Dây chuyền mủ tạp', capacity: 24, waitingSlots: 4 }
    ],
    'A01': [
      { id: 'LO-1', name: 'Lò sấy 1', line: 'Dây chuyền 1', capacity: 24, waitingSlots: 4 }
    ]
  };

  // ==================== LINE GROUPS (for shift schedule) ====================
  const LINE_GROUPS = {
    'A02': [
      { id: 'muNuoc', name: 'M\u1EE7 N\u01B0\u1EDBc', desc: 'DC MN1 + DC MN2', ovens: ['LO-MN1', 'LO-MN2'] },
      { id: 'muTap', name: 'M\u1EE7 T\u1EA1p', desc: 'DC MT', ovens: ['LO-MT'] }
    ],
    'A01': [
      { id: 'muNuoc', name: 'M\u1EE7 N\u01B0\u1EDBc', desc: 'DC m\u1EE7 n\u01B0\u1EDBc', ovens: ['LO-1'] },
      { id: 'lyTam', name: 'Ly T\u00E2m', desc: 'DC ly t\u00E2m', ovens: [] }
    ]
  };

  // ==================== WORKSPACE CONFIG ====================
  const WORKSPACE_CONFIG = {
    'A02': [
      {
        id: 'muNuoc',
        name: 'M\u1EE7 N\u01B0\u1EDBc',
        icon: '\uD83D\uDEE2\uFE0F',
        lineGroup: 'muNuoc',
        showTanks: true,
        products: [
          { code: 'SVR3L', name: 'SVR 3L', tccs: '101' },
          { code: 'SVR5', name: 'SVR 5', tccs: '101' },
          { code: 'SVRCV40', name: 'SVR CV40', tccs: '103' },
          { code: 'SVRCV50', name: 'SVR CV50', tccs: '103' },
          { code: 'SVRCV60', name: 'SVR CV60', tccs: '103' },
          { code: 'SVRL', name: 'SVR L', tccs: '118' }
        ],
        stageLabels: null
      },
      {
        id: 'muTap',
        name: 'M\u1EE7 T\u1EA1p',
        icon: '\uD83D\uDCE6',
        lineGroup: 'muTap',
        showTanks: false,
        products: [
          { code: 'SVR10', name: 'SVR 10', tccs: '102' },
          { code: 'SVR20', name: 'SVR 20', tccs: '102' }
        ],
        stageLabels: SVR1020_LABELS
      }
    ],
    'A01': [
      {
        id: 'muNuoc',
        name: 'M\u1EE7 N\u01B0\u1EDBc',
        icon: '\uD83D\uDEE2\uFE0F',
        lineGroup: 'muNuoc',
        showTanks: true,
        products: [
          { code: 'SVR3L', name: 'SVR 3L', tccs: '101' },
          { code: 'SVR5', name: 'SVR 5', tccs: '101' },
          { code: 'SVRCV40', name: 'SVR CV40', tccs: '103' },
          { code: 'SVRCV50', name: 'SVR CV50', tccs: '103' },
          { code: 'SVRCV60', name: 'SVR CV60', tccs: '103' },
          { code: 'SVRL', name: 'SVR L', tccs: '118' }
        ],
        stageLabels: null
      },
      {
        id: 'lyTam',
        name: 'Ly T\u00E2m',
        icon: '\uD83E\uDDEA',
        lineGroup: 'lyTam',
        showTanks: true,
        products: [
          { code: 'LatexHA', name: 'Latex HA', tccs: '107' },
          { code: 'LatexLA', name: 'Latex LA', tccs: '107' }
        ],
        stageLabels: LATEX_LABELS
      }
    ]
  };

  // ==================== PRODUCTION DC LINES (per factory) ====================
  const PRODUCTION_DC_LINES = {
    'A02': [
      { id: 'MN1', name: 'DC M\u1EE7 N\u01B0\u1EDBc 1', lineGroup: 'muNuoc', ovenId: 'LO-MN1' },
      { id: 'MN2', name: 'DC M\u1EE7 N\u01B0\u1EDBc 2', lineGroup: 'muNuoc', ovenId: 'LO-MN2' },
      { id: 'MT', name: 'DC M\u1EE7 T\u1EA1p', lineGroup: 'muTap', ovenId: 'LO-MT' }
    ],
    'A01': [
      { id: 'DC1', name: 'D\u00E2y chuy\u1EC1n 1', lineGroup: 'muNuoc', ovenId: 'LO-1' }
    ]
  };

  // ==================== PRODUCTION LINES (legacy, kept for backward compat) ====================
  const PRODUCTION_LINES = {
    'A02': [
      { id:'all', name:'Tất cả', tccs:null, products:null, stageLabels:null },
      { id:'tccs101', name:'Mủ nước', tccs:'101', products:['SVR3L','SVR5'], stageLabels:null },
      { id:'tccs103', name:'Mủ CV', tccs:'103', products:['SVRCV40','SVRCV50','SVRCV60'], stageLabels:null },
      { id:'tccs118', name:'SVR L', tccs:'118', products:['SVRL'], stageLabels:null },
      { id:'tccs102', name:'Mủ phụ', tccs:'102', products:['SVR10','SVR20'], stageLabels:SVR1020_LABELS },
      { id:'rss', name:'RSS', tccs:null, products:['RSS'], stageLabels:null }
    ],
    'A01': [
      { id:'all', name:'Tất cả', tccs:null, products:null, stageLabels:null },
      { id:'tccs101', name:'Mủ nước', tccs:'101', products:['SVR3L','SVR5'], stageLabels:null },
      { id:'tccs103', name:'Mủ CV', tccs:'103', products:['SVRCV40','SVRCV50','SVRCV60'], stageLabels:null },
      { id:'tccs118', name:'SVR L', tccs:'118', products:['SVRL'], stageLabels:null },
      { id:'tccs107', name:'Latex', tccs:'107', products:['LatexHA','LatexLA'], stageLabels:LATEX_LABELS }
    ]
  };

  // ==================== GETTER FUNCTIONS ====================

  /**
   * Get fields for a stage + product combination
   */
  function getFieldsForStage(stage, product) {
    if (!product) return STAGE_FIELDS[stage] || [];
    if (product === 'LatexHA' || product === 'LatexLA') return STAGE_FIELDS_107[stage] || [];
    if (product === 'SVR10' || product === 'SVR20') return STAGE_FIELDS_102[stage] || [];
    return STAGE_FIELDS[stage] || [];
  }

  /**
   * Get stage label based on factory + production line (legacy)
   */
  function getStageLabel(stage, factoryId, productionLineId) {
    const lines = PRODUCTION_LINES[factoryId] || [];
    const line = lines.find(l => l.id === productionLineId);
    const labels = (line && line.stageLabels) || null;
    return labels ? (labels[stage] || DEFAULT_LABELS[stage]) : DEFAULT_LABELS[stage];
  }

  /**
   * Get stage label based on product code
   */
  function getStageLabelByProduct(stage, product) {
    if (!product) return DEFAULT_LABELS[stage] || stage;
    if (product === 'SVR10' || product === 'SVR20') return SVR1020_LABELS[stage] || DEFAULT_LABELS[stage];
    if (product === 'LatexHA' || product === 'LatexLA') return LATEX_LABELS[stage] || DEFAULT_LABELS[stage];
    return DEFAULT_LABELS[stage] || stage;
  }

  /**
   * Get shift group for a stage (tiepnhan or sanxuat)
   */
  function getShiftGroupForStage(stage) {
    const idx = STAGE_ORDER.indexOf(stage);
    return (idx >= 0 && idx <= 1) ? 'tiepnhan' : 'sanxuat';
  }

  /**
   * Check if stage is a long stage (spans multiple shifts)
   */
  function isLongStage(stage) {
    return LONG_STAGES.includes(stage);
  }

  /**
   * Get batch stage params (from stageData or techParams)
   */
  function getBatchStageParams(batch, stage) {
    if (batch.stageData && batch.stageData[stage] && batch.stageData[stage].params) {
      return batch.stageData[stage].params;
    }
    if (batch.processStage === stage && batch.techParams) return batch.techParams;
    return {};
  }

  /**
   * Get stage index (0-based)
   */
  function getStageIndex(stage) {
    return STAGE_ORDER.indexOf(stage);
  }

  /**
   * Get next stage
   */
  function getNextStage(stage) {
    const idx = STAGE_ORDER.indexOf(stage);
    return idx >= 0 && idx < STAGE_ORDER.length - 1 ? STAGE_ORDER[idx + 1] : null;
  }

  /**
   * Get previous stage
   */
  function getPrevStage(stage) {
    const idx = STAGE_ORDER.indexOf(stage);
    return idx > 0 ? STAGE_ORDER[idx - 1] : null;
  }

  /**
   * Check if a stage belongs to line records (steps 3-7)
   */
  function isLineStage(stage) {
    return LINE_STAGE_ORDER.indexOf(stage) !== -1;
  }

  /**
   * Check if a stage belongs to batches (steps 1-2)
   */
  function isBatchStage(stage) {
    return BATCH_STAGE_ORDER.indexOf(stage) !== -1;
  }

  /**
   * Get DC production lines for a factory
   */
  function getDCLinesForFactory(factoryId) {
    return PRODUCTION_DC_LINES[factoryId] || [];
  }

  /**
   * Get DC line config by ID
   */
  function getDCLineById(factoryId, lineId) {
    var lines = PRODUCTION_DC_LINES[factoryId] || [];
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].id === lineId) return lines[i];
    }
    return null;
  }

  /**
   * Get line group ID for an oven
   */
  function getLineGroupForOven(factoryId, ovenId) {
    var groups = LINE_GROUPS[factoryId] || [];
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].ovens.indexOf(ovenId) !== -1) return groups[i].id;
    }
    return groups.length > 0 ? groups[0].id : null;
  }

  return {
    STAGE_ORDER,
    BATCH_STAGE_ORDER,
    LINE_STAGE_ORDER,
    DEFAULT_LABELS, SVR1020_LABELS, LATEX_LABELS,
    STAGE_FIELDS, STAGE_FIELDS_102, STAGE_FIELDS_107,
    SHIFT_CONFIG, LONG_STAGES, OVEN_CONFIG,
    LINE_GROUPS,
    WORKSPACE_CONFIG,
    PRODUCTION_DC_LINES,
    PRODUCTION_LINES,
    getFieldsForStage,
    getStageLabel,
    getStageLabelByProduct,
    getShiftGroupForStage,
    isLongStage,
    getBatchStageParams,
    getStageIndex,
    getNextStage,
    getPrevStage,
    isLineStage,
    isBatchStage,
    getDCLinesForFactory,
    getDCLineById,
    getLineGroupForOven
  };
})();
