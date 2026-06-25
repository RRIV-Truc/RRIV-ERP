/**
 * Sanxuat Calculations - Các công thức tính toán sản xuất cao su
 * Tách biệt logic tính toán thuần túy (pure functions) khỏi DOM
 * @module SanxuatCalculations
 * @depends TCCSSpecs
 */

const SanxuatCalculations = (function() {
  'use strict';

  /**
   * Tính DAHP từ Mg (TCCS 107 Đ8.6)
   * DAHP = Mg × 5.43
   * @param {number} mg - Hàm lượng Mg (%)
   * @returns {{ value: number, formula: string }}
   */
  function calcDAHP(mg) {
    if (!mg || mg <= 0) return { value: 0, formula: '' };
    const result = mg * 5.43;
    return {
      value: parseFloat(result.toFixed(2)),
      formula: 'DAHP = ' + mg + ' × 5.43 = ' + result.toFixed(2) + ' (TCCS 107 Đ8.6)'
    };
  }

  /**
   * Tính DRC pha loãng: W × DRC1 = (W + Vnước) × DRC2
   * Giải cho biến còn thiếu dựa trên changed field
   * @param {Object} params
   * @param {number} params.weight - Khối lượng NL đầu vào (kg)
   * @param {number|null} params.drcBefore - DRC trước pha loãng (%)
   * @param {number|null} params.drcAfter - DRC sau pha loãng (%)
   * @param {number|null} params.water - Lượng nước pha loãng (L)
   * @param {string} params.changed - Field thay đổi: 'truoc' | 'sau' | 'nuoc'
   * @returns {{ drcBefore: number|null, drcAfter: number|null, water: number|null, formula: string }}
   */
  function calcDilution({ weight, drcBefore, drcAfter, water, changed }) {
    const W = weight || 0;
    const drc1 = drcBefore;
    const drc2 = drcAfter;
    const nuoc = water;

    const has1 = drc1 !== null && !isNaN(drc1) && drc1 > 0;
    const has2 = drc2 !== null && !isNaN(drc2) && drc2 > 0;
    const hasN = nuoc !== null && !isNaN(nuoc) && nuoc >= 0;

    const result = { drcBefore: null, drcAfter: null, water: null, formula: '' };

    if (W <= 0) {
      result.formula = 'Nhập NL Đầu Vào (kg) trước để tự tính';
      return result;
    }

    const fmt = function(n) { return n.toLocaleString('vi-VN'); };

    if (changed === 'truoc' || changed === 'sau') {
      if (has1 && has2) {
        // Tính nước: V = W × (DRC1/DRC2 - 1)
        const v = W * (drc1 / drc2 - 1);
        if (v >= 0) {
          result.water = parseFloat(v.toFixed(1));
          result.formula = 'V = ' + fmt(W) + ' x (' + drc1 + '/' + drc2 + ' - 1) = ' + v.toFixed(1) + ' L';
        }
      } else if (changed === 'truoc' && has1 && !has2 && hasN) {
        // Tính DRC sau: DRC2 = DRC1 × W / (W + V)
        const d2 = W * drc1 / (W + nuoc);
        result.drcAfter = parseFloat(d2.toFixed(1));
        result.formula = 'DRC sau = ' + drc1 + ' x ' + fmt(W) + ' / (' + fmt(W) + ' + ' + nuoc + ') = ' + d2.toFixed(1) + '%';
      } else if (changed === 'sau' && !has1 && has2 && hasN) {
        // Tính DRC trước: DRC1 = DRC2 × (W + V) / W
        const d1 = drc2 * (W + nuoc) / W;
        result.drcBefore = parseFloat(d1.toFixed(1));
        result.formula = 'DRC trước = ' + drc2 + ' x (' + fmt(W) + ' + ' + nuoc + ') / ' + fmt(W) + ' = ' + d1.toFixed(1) + '%';
      }
    } else if (changed === 'nuoc') {
      if (has1 && hasN) {
        const d2 = W * drc1 / (W + nuoc);
        result.drcAfter = parseFloat(d2.toFixed(1));
        result.formula = 'DRC sau = ' + drc1 + ' x ' + fmt(W) + ' / (' + fmt(W) + ' + ' + nuoc + ') = ' + d2.toFixed(1) + '%';
      } else if (has2 && hasN) {
        const d1 = drc2 * (W + nuoc) / W;
        result.drcBefore = parseFloat(d1.toFixed(1));
        result.formula = 'DRC trước = ' + drc2 + ' x (' + fmt(W) + ' + ' + nuoc + ') / ' + fmt(W) + ' = ' + d1.toFixed(1) + '%';
      }
    }

    return result;
  }

  /**
   * Tính Na₂S₂O₅: liều lượng × Q.khô (tấn)
   * @param {number} weight - Khối lượng NL đầu vào (kg)
   * @param {number} drcAfter - DRC sau pha loãng (%)
   * @param {string} product - Product code
   * @returns {{ value: number, formula: string }}
   */
  function calcNa2S2O5(weight, drcAfter, product) {
    if (!weight || weight <= 0 || !drcAfter || drcAfter <= 0) {
      return { value: 0, formula: 'Cần nhập NL Đầu Vào + DRC sau trước' };
    }

    const dryTon = weight * drcAfter / 100 / 1000; // tấn mủ khô
    const rate = (product === 'SVRL') ? 1.0 : 1.2; // kg/tấn khô
    const result = dryTon * rate;

    const fmt = function(n) { return n.toLocaleString('vi-VN'); };
    const formula = 'Q.khô = ' + fmt(weight) + ' x ' + drcAfter + '% = ' +
      (weight * drcAfter / 100).toFixed(0) + ' kg = ' +
      dryTon.toFixed(3) + ' tấn × ' + rate + ' kg/t = ' + result.toFixed(2) + ' kg';

    return { value: parseFloat(result.toFixed(2)), formula };
  }

  /**
   * Mask input thành HH:MM 24h
   * @param {string} rawValue - Giá trị nhập vào
   * @returns {{ formatted: string, valid: boolean }}
   */
  function maskTime24(rawValue) {
    let v = (rawValue || '').replace(/[^0-9]/g, '');

    // Auto-correct invalid hours: first digit 3-9 → prefix "0"
    if (v.length >= 1 && parseInt(v[0]) > 2) {
      v = '0' + v;
    }
    // Clamp hour to 23
    if (v.length >= 2) {
      var hh = parseInt(v.slice(0, 2));
      if (hh > 23) v = '23' + v.slice(2);
    }
    // Clamp minutes to 59
    if (v.length >= 4) {
      var mm = parseInt(v.slice(2, 4));
      if (mm > 59) v = v.slice(0, 2) + '59';
    }

    if (v.length >= 3) v = v.slice(0, 2) + ':' + v.slice(2, 4);
    const formatted = v.slice(0, 5);

    let valid = false;
    if (formatted.length === 5) {
      var hhF = parseInt(formatted.slice(0, 2));
      var mmF = parseInt(formatted.slice(3, 5));
      valid = hhF <= 23 && mmF <= 59;
    }

    return { formatted, valid };
  }

  /**
   * Collect muong pH data from channels array
   * @param {Array} channels - Array of { muong, phDau, phGiua, phCuoi }
   * @param {string} product - Product code
   * @returns {{ channels: Array, avgPH: number|null, warnings: number }}
   */
  function analyzeMuongPH(channels, product) {
    if (!channels || !Array.isArray(channels)) {
      return { channels: [], avgPH: null, warnings: 0 };
    }

    let totalPH = 0;
    let phCount = 0;
    let warnings = 0;

    let min = 5.2, max = 5.6;
    if (product === 'SVRL') { min = 5.5; max = 5.8; }
    else if (product && product.startsWith('SVRCV')) { min = 5.0; max = 5.6; }

    const analyzed = channels.map(function(ch) {
      const values = [ch.phDau, ch.phGiua, ch.phCuoi].filter(function(v) {
        return v !== null && v !== undefined && !isNaN(v);
      });
      const chWarnings = values.filter(function(v) { return v < min || v > max; }).length;
      warnings += chWarnings;

      values.forEach(function(v) { totalPH += v; phCount++; });

      return {
        muong: ch.muong,
        phDau: ch.phDau,
        phGiua: ch.phGiua,
        phCuoi: ch.phCuoi,
        warnings: chWarnings
      };
    });

    return {
      channels: analyzed,
      avgPH: phCount > 0 ? parseFloat((totalPH / phCount).toFixed(2)) : null,
      warnings
    };
  }

  /**
   * Tính hiệu suất ly tâm (TCCS 107)
   * HS = (DRC_LT × TSC_NL) / (DRC_NL × TSC_LT) × 100
   * @param {number} drcLT - DRC ly tâm (%)
   * @param {number} tscNL - TSC nguyên liệu (%)
   * @param {number} drcNL - DRC nguyên liệu (%)
   * @param {number} tscLT - TSC ly tâm (%)
   * @returns {{ value: number, formula: string }}
   */
  function calcLatexEfficiency(drcLT, tscNL, drcNL, tscLT) {
    if (!drcLT || !tscNL || !drcNL || !tscLT || drcNL === 0 || tscLT === 0) {
      return { value: 0, formula: '' };
    }
    const result = (drcLT * tscNL) / (drcNL * tscLT) * 100;
    return {
      value: parseFloat(result.toFixed(1)),
      formula: 'HS = (' + drcLT + ' × ' + tscNL + ') / (' + drcNL + ' × ' + tscLT + ') × 100 = ' + result.toFixed(1) + '%'
    };
  }

  /**
   * Format number with Vietnamese locale
   * @param {number} n
   * @returns {string}
   */
  function formatNumber(n) {
    if (n === null || n === undefined) return '—';
    return n.toLocaleString('vi-VN');
  }

  return {
    calcDAHP,
    calcDilution,
    calcNa2S2O5,
    maskTime24,
    analyzeMuongPH,
    calcLatexEfficiency,
    formatNumber
  };
})();
