/**
 * TCCS Validator - Kiểm tra thông số kỹ thuật theo tiêu chuẩn TCCS
 * Tập trung toàn bộ logic validate cho 5 tiêu chuẩn: 101, 102, 103, 107 (HA/LA), 118
 * @module TCCSValidator
 * @depends TCCSSpecs, SanxuatStages, SanxuatParams
 */

const TCCSValidator = (function() {
  'use strict';

  // Short labels cho getTCCSSummary (hiển thị compact trên bảng)
  const SHORT_LABELS = {
    paramDRC:'DRC', paramPH:'pH', paramDRCSau:'DRC',
    paramSoMuong:'Mương', paramNongDoAxit:'Axit',
    paramTGBatDauMuong:'BĐ mương', paramTGKetThucMuong:'KT mương', paramTGCanDuKien:'TG cán',
    paramNhietDoSay:'T°', paramThoiGianSay:'TG',
    paramNhietDoNguoi:'T°nguội', paramKhoiLuongBanh:'KL', paramPhanHang:'Hạng',
    paramDayCanKeo:'Dày', paramKheCan1:'C1', paramKheCan2:'C2', paramKheCan3:'C3',
    paramKichThuocHat:'Hạt', paramKLHoc:'KL/hộc', paramTGXepHoc:'TG xếp', paramTGDeRao:'Ráo(h)',
    paramSoLuongBanh:'SL', paramNhienLieu:'NL',
    paramHAS:'HAS', paramDBD:'DBD', paramMooneyBanDau:'Mooney₀', paramMooneyDong:'Mooney₁',
    paramMooneySay:'Mooney₂', paramMooneyTarget:'CV', paramPPMooney:'PP', paramHASDong:'HAS₂',
    paramPhanHangBD:'Hạng BĐ', paramGiongCay:'Giống', paramMauSacMu:'Màu NL', paramTGTiepNhan:'TG nhận',
    paramMauSacSay:'Màu sấy', paramKQSauSay:'KQ sấy',
    paramNH3:'NH3', paramTSC:'TSC', paramLoaiMu:'Loại', paramNgoaiQuan:'NQ',
    // TCCS 107 Latex
    paramVFA_LT:'VFA', paramMg_LT:'Mg', paramTGTiepNhan_LT:'TG', paramNH3BoSung:'NH3+',
    paramMg_PL:'Mg', paramDAHP:'DAHP', paramThoiGianKhuay:'Khuấy', paramThoiGianLang:'Lắng',
    paramNH3_Lang:'NH3', paramVFA_Lang:'VFA', paramMg_Lang:'Mg', paramMeshLocLT:'Mesh',
    paramThoiGianVS:'VS', paramDRC_LT:'DRC', paramTSC_LT:'TSC', paramHieuSuatLT:'HS%',
    paramMeshLocHC:'Mesh', paramNH3_HC:'NH3', paramAmoniLaurat:'AL', paramTMTD:'TMTD',
    paramZnO:'ZnO', paramThoiGianKhuay_HC:'Khuấy', paramSoBonTC:'Bồn TC',
    paramTSC_TC:'TSC', paramDRC_TC:'DRC', paramNH3_TC:'NH3', paramVFA_TC:'VFA',
    paramKOH_TC:'KOH', paramMST_TC:'MST', paramMg_TC:'Mg', paramSoBonTT:'Bồn TT',
    paramNgaySinhNhat:'SN bồn', paramTSC_TT:'TSC', paramDRC_TT:'DRC', paramNH3_TT:'NH3',
    paramVFA_TT:'VFA', paramKOH_TT:'KOH', paramMST_TT:'MST', paramThoiGianTonTru:'TG tồn',
    paramCan:'Cặn', paramDongKet:'ĐK', paramCu:'Cu', paramMn:'Mn'
  };

  /**
   * Validate a single parameter value against TCCS spec
   * @param {string} paramId - Parameter field ID (e.g. 'paramDRC')
   * @param {number} value - Giá trị cần kiểm tra
   * @param {Object} spec - { min, max } từ TCCSSpecs
   * @returns {{ ok: boolean, message: string }}
   */
  function validateParam(paramId, value, spec) {
    if (!spec || value === null || value === undefined || value === '') {
      return { ok: true, message: '' };
    }
    const val = typeof value === 'number' ? value : parseFloat(value);
    if (isNaN(val)) return { ok: true, message: '' };

    const outMin = spec.min !== undefined && val < spec.min;
    const outMax = spec.max !== undefined && val > spec.max;

    if (outMin || outMax) {
      const label = SanxuatParams.getLabel(paramId);
      const specText = TCCSSpecs.getSpecText(spec);
      return { ok: false, message: label + ': ' + val + ' (chuẩn: ' + specText + ')' };
    }
    return { ok: true, message: '' };
  }

  /**
   * Validate all params of a stage for a product
   * @param {string} stage - Stage key (e.g. 'xulymu')
   * @param {Object} params - { paramId: value, ... }
   * @param {string} product - Product code (e.g. 'SVR3L')
   * @returns {{ ok: boolean, warnings: Array<{paramId, value, spec, message}>, count: number }}
   */
  function validateStage(stage, params, product) {
    const specsTable = TCCSSpecs.getForProduct(product);
    const stageSpecs = specsTable[stage] || {};
    const warnings = [];

    for (const [paramId, value] of Object.entries(params)) {
      if (paramId.startsWith('_') || paramId === 'channels') continue;
      const spec = stageSpecs[paramId];
      if (!spec) continue;
      const result = validateParam(paramId, value, spec);
      if (!result.ok) {
        warnings.push({ paramId, value, spec, message: result.message });
      }
    }

    return { ok: warnings.length === 0, warnings, count: warnings.length };
  }

  /**
   * Validate acid concentration based on acid type and product
   * @param {string} acidType - 'acetic' | 'formic'
   * @param {number} concentration - Nồng độ axit (%)
   * @param {string} product - Product code
   * @returns {{ ok: boolean, maxVal: number|null, acidName: string, tccsName: string, message: string }}
   */
  function validateAcidConcentration(acidType, concentration, product) {
    const specs = TCCSSpecs.getForProduct(product);
    const acidSpec = specs?.taodong?._acidSpec;
    const tccsName = TCCSSpecs.getName(product);

    if (!acidSpec || !acidType) {
      return { ok: true, maxVal: null, acidName: '', tccsName, message: '' };
    }

    const spec = acidSpec[acidType];
    if (!spec) return { ok: true, maxVal: null, acidName: acidType, tccsName, message: '' };

    const maxVal = spec.max;
    const acidName = acidType === 'acetic' ? 'Acetic (CH₃COOH)' : 'Formic (HCOOH)';

    if (concentration === null || concentration === undefined || isNaN(concentration)) {
      return { ok: true, maxVal, acidName, tccsName, message: acidName + ': ≤ ' + maxVal + '% theo ' + tccsName };
    }

    const ok = concentration <= maxVal;
    return {
      ok,
      maxVal,
      acidName,
      tccsName,
      message: ok
        ? acidName + ': ' + concentration + '% ≤ ' + maxVal + '% ✓'
        : acidName + ': ' + concentration + '% > ' + maxVal + '% VƯỢT CHUẨN'
    };
  }

  /**
   * Validate pH value for mương tạo đông
   * @param {number} phValue - Giá trị pH
   * @param {string} product - Product code
   * @returns {{ ok: boolean, min: number, max: number }}
   */
  function validateMuongPH(phValue, product) {
    if (phValue === null || phValue === undefined || isNaN(phValue)) {
      return { ok: true, min: 0, max: 0 };
    }

    let min = 5.2, max = 5.6;
    if (product === 'SVRL') { min = 5.5; max = 5.8; }
    else if (product && product.startsWith('SVRCV')) { min = 5.0; max = 5.6; }

    return { ok: phValue >= min && phValue <= max, min, max };
  }

  /**
   * Get pH spec range text for a product
   * @param {string} product - Product code
   * @returns {string} e.g. '5.2 - 5.6'
   */
  function getPHSpecText(product) {
    if (product === 'SVRL') return '5.5 - 5.8';
    if (product && product.startsWith('SVRCV')) return '5.0 - 5.6';
    return '5.2 - 5.6';
  }

  /**
   * Get drying temperature hint based on product and fuel
   * @param {string} product - Product code
   * @param {string} fuel - 'DO' | 'biomass' | ''
   * @returns {string} Hint text
   */
  function getDryTempHint(product, fuel) {
    const isSVR1020 = product === 'SVR10' || product === 'SVR20';
    const isSVRL = product === 'SVRL';
    const isCV = product && product.startsWith('SVRCV');

    if (isSVR1020) return 'TCCS 102: ≤ 120°C (tất cả nhiên liệu)';

    if (isSVRL) {
      if (fuel === 'DO') return 'TCCS 118: ≤ 115°C (DO) - SVR L yêu cầu nhiệt độ thấp hơn';
      if (fuel === 'biomass') return 'TCCS 118: ≤ 120°C (Biomass) - SVR L yêu cầu nhiệt độ thấp hơn';
      return 'SVR L - DO: ≤ 115°C | Biomass: ≤ 120°C';
    }

    if (isCV) {
      if (fuel === 'DO') return 'TCCS 103: ≤ 125°C (DO) / ≤ 130°C (PP Mooney)';
      if (fuel === 'biomass') return 'TCCS 103: ≤ 130°C (Biomass) / ≤ 135°C (PP Mooney)';
      return 'CV - DO: ≤ 125-130°C | Biomass: ≤ 130-135°C';
    }

    // Standard SVR 3L/5
    if (fuel === 'DO') return 'TCCS 101: ≤ 120°C (DO)';
    if (fuel === 'biomass') return 'TCCS 101: ≤ 125°C (Biomass)';
    return 'DO: ≤ 120°C | Biomass: ≤ 125°C';
  }

  /**
   * Generate TCCS summary HTML for a batch (dùng cho bảng danh sách)
   * @param {Object} batch - Batch object with techParams, processStage, product
   * @returns {string} HTML string with highlighted warnings
   */
  function getTCCSSummary(batch) {
    if (!batch.techParams || Object.keys(batch.techParams).length === 0) {
      return '<span style="color:#64748b">—</span>';
    }

    const product = batch.product || '';
    const specsTable = TCCSSpecs.getForProduct(product);
    const specs = specsTable[batch.processStage] || {};
    const parts = [];

    for (const [k, v] of Object.entries(batch.techParams)) {
      if (k.startsWith('_') || k === 'channels') continue;
      const label = SHORT_LABELS[k] || k.replace('param', '');
      const spec = specs[k];
      let warn = false;
      if (spec && typeof v === 'number') {
        warn = (spec.min !== undefined && v < spec.min) || (spec.max !== undefined && v > spec.max);
      }
      parts.push(warn
        ? '<span style="color:var(--danger)">' + label + ':' + v + '</span>'
        : label + ':' + v
      );
    }

    return parts.join(', ');
  }

  /**
   * Validate a full batch across all recorded stages
   * @param {Object} batch - Batch object with stageData
   * @returns {{ totalWarnings: number, stageResults: Object<string, {ok, warnings, count}> }}
   */
  function validateBatch(batch) {
    const product = batch.product || '';
    const stageResults = {};
    let totalWarnings = 0;

    if (batch.stageData) {
      for (const [stage, data] of Object.entries(batch.stageData)) {
        if (data && data.params) {
          const result = validateStage(stage, data.params, product);
          stageResults[stage] = result;
          totalWarnings += result.count;
        }
      }
    }

    // Also validate current stage techParams if not in stageData
    if (batch.processStage && batch.techParams) {
      if (!stageResults[batch.processStage]) {
        const result = validateStage(batch.processStage, batch.techParams, product);
        stageResults[batch.processStage] = result;
        totalWarnings += result.count;
      }
    }

    return { totalWarnings, stageResults };
  }

  return {
    SHORT_LABELS,
    validateParam,
    validateStage,
    validateAcidConcentration,
    validateMuongPH,
    getPHSpecText,
    getDryTempHint,
    getTCCSSummary,
    validateBatch
  };
})();
