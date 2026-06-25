/**
 * TCCS Specifications - Tiêu chuẩn kỹ thuật cao su RRIV
 * 5 tiêu chuẩn: TCCS 101, 102, 103, 107 (HA/LA), 118
 * @module TCCSSpecs
 */

const TCCSSpecs = (function() {
  'use strict';

  // TCCS 101:2025 (SVR 3L/5)
  const SPECS_101 = {
    tiepnhan: { paramDRC: {min:28} },
    xulymu: { paramDRCSau: {min:20, max:28}, paramNa2S2O5: {min:1.0, max:1.5, unit:'kg/t'}, paramMeshLoc: {min:40, max:40} },
    taodong: { _acidSpec: {acetic:{max:3}, formic:{max:2}}, _phSpec: {min:5.2, max:5.6} },
    canmu: { paramDayCanKeo: {min:50, max:70}, paramKheCan1: {min:4, max:6}, paramKheCan2: {min:1, max:3}, paramKheCan3: {min:0.4, max:0.6}, paramDayTruocBam: {max:8} },
    taohat: { paramKichThuocHat: {min:5, max:8}, paramChieuSauBon: {min:50, max:60}, paramTGDeRao: {min:2} },
    say: { paramNhietDoSay: {max:125}, paramThoiGianSay: {min:3, max:4} },
    epbanh: { paramNhietDoNguoi: {min:45, max:50}, paramTyLeKiemTra: {min:10} },
    baogoi: {}
  };

  // TCCS 103:2025 (SVR CV40/50/60)
  const SPECS_103 = {
    tiepnhan: { paramDRC: {min:28} },
    xulymu: { paramDRCSau: {min:20, max:28}, paramNa2S2O5: {min:1.0, max:1.5, unit:'kg/t'}, paramMeshLoc: {min:40, max:40}, paramHAS: {min:1.3, max:1.7} },
    taodong: { _acidSpec: {acetic:{max:2}, formic:{max:1}}, _phSpec: {min:5.0, max:5.6} },
    canmu: { paramDayCanKeo: {min:50, max:70}, paramKheCan1: {min:4, max:6}, paramKheCan2: {min:1, max:3}, paramKheCan3: {min:0.4, max:0.6}, paramDayTruocBam: {max:8} },
    taohat: { paramKichThuocHat: {min:5, max:8}, paramChieuSauBon: {min:50, max:60}, paramTGDeRao: {min:2} },
    say: { paramNhietDoSay: {max:135}, paramThoiGianSay: {min:3, max:4} },
    epbanh: { paramNhietDoNguoi: {min:45, max:50}, paramTyLeKiemTra: {min:10} },
    baogoi: {}
  };

  // TCCS 118:2023 (SVR L)
  const SPECS_118 = {
    tiepnhan: { paramDRC: {min:20}, paramNH3: {max:0.03}, paramPH: {min:6.5, max:8.0} },
    xulymu: { paramDRCSau: {min:20, max:28}, paramNa2S2O5: {min:0.8, max:1.2, unit:'kg/t'}, paramMeshLoc: {min:40, max:40} },
    taodong: { _acidSpec: {acetic:{max:3}, formic:{max:2}}, _phSpec: {min:5.5, max:5.8} },
    canmu: { paramDayCanKeo: {min:50, max:70}, paramKheCan1: {min:4, max:6}, paramKheCan2: {min:1, max:3}, paramKheCan3: {min:0.4, max:0.6}, paramDayTruocBam: {max:8} },
    taohat: { paramKichThuocHat: {min:5, max:8}, paramChieuSauBon: {min:50, max:60}, paramTGDeRao: {min:2} },
    say: { paramNhietDoSay: {max:120}, paramThoiGianSay: {min:3, max:3.5} },
    epbanh: { paramNhietDoNguoi: {min:45, max:50}, paramTyLeKiemTra: {min:10} },
    baogoi: {}
  };

  // TCCS 102:2015 (SVR 10/20 từ mủ phụ)
  const SPECS_102 = {
    tiepnhan: {},
    xulymu: {},
    taodong: {},
    canmu: { paramKheCan1:{min:4,max:6}, paramKheCan2:{min:1.5,max:2.5}, paramKheCan3:{min:0.3,max:0.7} },
    taohat: { paramKichThuocHat:{min:5,max:8} },
    say: { paramNhietDoSay:{max:120} },
    epbanh: { paramNhietDoNguoi:{min:45,max:50}, paramKhoiLuongBanh:{min:33,max:35.2}, paramTyLeKiemTra:{min:10} },
    baogoi: {}
  };

  // TCCS 107:2020 (Latex HA)
  const SPECS_107_HA = {
    tiepnhan: { paramDRC:{min:20}, paramNH3:{min:0.2}, paramVFA_LT:{max:0.05}, paramPH:{min:9} },
    xulymu: { paramDRCSau:{min:23,max:30}, paramNH3BoSung:{min:0.4,max:0.5}, paramMeshLoc:{min:60} },
    taodong: { paramThoiGianLang:{min:10}, paramVFA_Lang:{max:0.05} },
    canmu: { paramMeshLocLT:{min:40} },
    taohat: { paramNH3_HC:{min:0.65,max:0.7}, paramAmoniLaurat:{max:0.02}, paramMeshLocHC:{min:30} },
    say: {}, epbanh: {}, baogoi: {}
  };

  // TCCS 107:2020 (Latex LA)
  const SPECS_107_LA = {
    tiepnhan: { paramDRC:{min:20}, paramNH3:{min:0.2}, paramVFA_LT:{max:0.05}, paramPH:{min:9} },
    xulymu: { paramDRCSau:{min:23,max:30}, paramNH3BoSung:{min:0.3,max:0.4}, paramMeshLoc:{min:60} },
    taodong: { paramThoiGianLang:{min:10}, paramVFA_Lang:{max:0.05} },
    canmu: { paramMeshLocLT:{min:40} },
    taohat: { paramNH3_HC:{max:0.29}, paramTMTD:{max:0.0125}, paramZnO:{max:0.0125},
              paramAmoniLaurat:{max:0.05}, paramMeshLocHC:{min:30} },
    say: {}, epbanh: {}, baogoi: {}
  };

  // === Override storage ===
  var _overrides = {};

  function _productToCode(product) {
    if (!product) return '101';
    if (product === 'LatexHA') return '107HA';
    if (product === 'LatexLA') return '107LA';
    if (product === 'SVRL') return '118';
    if (product === 'SVR10' || product === 'SVR20') return '102';
    if (product.startsWith('SVRCV')) return '103';
    return '101';
  }

  function _deepMergeSpecs(base, override) {
    if (!override) return base;
    var result = {};
    Object.keys(base).forEach(function(stageKey) {
      result[stageKey] = Object.assign({}, base[stageKey]);
      if (override[stageKey]) {
        Object.keys(override[stageKey]).forEach(function(paramKey) {
          result[stageKey][paramKey] = Object.assign({}, result[stageKey][paramKey] || {}, override[stageKey][paramKey]);
        });
      }
    });
    return result;
  }

  /**
   * Apply overrides from Firestore (admin_tccs_overrides)
   * @param {Object} overrides - { '101': { specs: {...} }, '103': { specs: {...} }, ... }
   */
  function applyOverrides(overrides) {
    _overrides = overrides || {};
  }

  /**
   * Get TCCS specs for a product (with overrides applied)
   * @param {string} product - Product code
   * @returns {Object} Specs object with stage keys
   */
  function getForProduct(product) {
    var base;
    if (!product) base = SPECS_101;
    else if (product === 'LatexHA') base = SPECS_107_HA;
    else if (product === 'LatexLA') base = SPECS_107_LA;
    else if (product === 'SVRL') base = SPECS_118;
    else if (product === 'SVR10' || product === 'SVR20') base = SPECS_102;
    else if (product.startsWith('SVRCV')) base = SPECS_103;
    else base = SPECS_101;

    var code = _productToCode(product);
    var ov = _overrides[code];
    if (ov && ov.specs) return _deepMergeSpecs(base, ov.specs);
    return base;
  }

  /**
   * Get TCCS standard name
   * @param {string} product - Product code
   * @returns {string} e.g. 'TCCS 101:2025'
   */
  function getName(product) {
    if (!product) return 'TCCS 101';
    if (product === 'LatexHA' || product === 'LatexLA') return 'TCCS 107:2020';
    if (product === 'SVRL') return 'TCCS 118:2023';
    if (product === 'SVR10' || product === 'SVR20') return 'TCCS 102:2015';
    if (product.startsWith('SVRCV')) return 'TCCS 103:2025';
    return 'TCCS 101:2025';
  }

  /**
   * Format spec as readable text
   * @param {Object} spec - { min, max }
   * @returns {string} e.g. '5.2 – 5.6'
   */
  function getSpecText(spec) {
    if (!spec) return '—';
    if (spec.min !== undefined && spec.max !== undefined) return `${spec.min} – ${spec.max}`;
    if (spec.min !== undefined) return `≥ ${spec.min}`;
    if (spec.max !== undefined) return `≤ ${spec.max}`;
    return '—';
  }

  /**
   * Check product type helpers
   */
  function isLatex(product) { return product === 'LatexHA' || product === 'LatexLA'; }
  function isCV(product) { return product && product.startsWith('SVRCV'); }
  function isSVRL(product) { return product === 'SVRL'; }
  function isSVR1020(product) { return product === 'SVR10' || product === 'SVR20'; }

  return {
    SPECS_101, SPECS_103, SPECS_118, SPECS_102, SPECS_107_HA, SPECS_107_LA,
    getForProduct,
    getName,
    getSpecText,
    applyOverrides,
    isLatex, isCV, isSVRL, isSVR1020
  };
})();
