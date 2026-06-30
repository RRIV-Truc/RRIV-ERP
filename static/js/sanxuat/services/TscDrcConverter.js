/**
 * Tra cứu TSC% → DRC% từ bảng tsc_drc_conversion (nội suy tuyến tính).
 * Quy khô: fresh_kg × DRC% / 100
 * @module TscDrcConverter
 */
const TscDrcConverter = (function () {
  'use strict';

  var _curves = {}; // material_type → [{ tsc_pct, drc_pct }, ...]

  function _db() { return ErpDb.firestore(); }

  function _indexCurve(mt) {
    var pts = _curves[mt] || [];
    _curves['_' + mt + '_map'] = {};
    pts.forEach(function (p) {
      _curves['_' + mt + '_map'][p.tsc_pct.toFixed(1)] = p.drc_pct;
    });
  }

  async function load() {
    _curves = {};
    try {
      var snap = await _db().collection('tscDrcConversion').get();
      snap.forEach(function (doc) {
        var d = doc.data();
        if (d.active === false) return;
        var mt = d.material_type || 'latex';
        if (!_curves[mt]) _curves[mt] = [];
        _curves[mt].push({
          tsc_pct: parseFloat(d.tsc_pct),
          drc_pct: parseFloat(d.drc_pct)
        });
      });
    } catch (e) {
      console.warn('TscDrcConverter.load DB:', e.message);
    }

    if (!_curves.latex || !_curves.latex.length) {
      try {
        var res = await fetch('/static/data/tsc-drc-latex.json');
        if (res.ok) {
          var rows = await res.json();
          _curves.latex = rows.map(function (r) {
            return { tsc_pct: parseFloat(r.tsc), drc_pct: parseFloat(r.drc) };
          });
          console.info('TscDrcConverter: loaded latex table from static JSON');
        }
      } catch (e2) {
        console.warn('TscDrcConverter.load JSON:', e2.message);
      }
    }

    Object.keys(_curves).forEach(function (mt) {
      if (mt.charAt(0) === '_') return;
      _curves[mt].sort(function (a, b) { return a.tsc_pct - b.tsc_pct; });
      _indexCurve(mt);
    });
    return _curves;
  }

  /**
   * @param {string} materialType latex | coagulum | cord | other
   * @param {number} tscPct
   * @returns {number|null} DRC% hoặc null nếu chưa có bảng
   */
  function tscToDrc(materialType, tscPct) {
    var tsc = parseFloat(tscPct);
    if (isNaN(tsc) || tsc <= 0) return null;
    var mt = materialType || 'latex';
    var map = _curves['_' + mt + '_map'];
    if (map) {
      var key = tsc.toFixed(1);
      if (map[key] != null) return map[key];
    }
    var pts = _curves[mt] || _curves.latex || [];
    if (!pts.length) return null;

    if (tsc <= pts[0].tsc_pct) return pts[0].drc_pct;
    if (tsc >= pts[pts.length - 1].tsc_pct) return pts[pts.length - 1].drc_pct;

    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i];
      var b = pts[i + 1];
      if (tsc >= a.tsc_pct && tsc <= b.tsc_pct) {
        if (b.tsc_pct === a.tsc_pct) return a.drc_pct;
        var ratio = (tsc - a.tsc_pct) / (b.tsc_pct - a.tsc_pct);
        return parseFloat((a.drc_pct + ratio * (b.drc_pct - a.drc_pct)).toFixed(3));
      }
    }
    return null;
  }

  function dryKg(freshKg, drcPct) {
    var f = parseFloat(freshKg) || 0;
    var d = parseFloat(drcPct) || 0;
    if (f <= 0 || d <= 0) return 0;
    return parseFloat((f * d / 100).toFixed(3));
  }

  function hasTable(materialType) {
    var pts = _curves[materialType] || _curves.latex || [];
    return pts.length > 0;
  }

  function getCurves() {
    return _curves;
  }

  return {
    load: load,
    tscToDrc: tscToDrc,
    dryKg: dryKg,
    hasTable: hasTable,
    getCurves: getCurves
  };
})();
