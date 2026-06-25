/**
 * Line Record Processor - Phi\u1EBFu ghi nh\u1EADn s\u1EA3n xu\u1EA5t per DC/ca/ng\u00E0y
 * Manages productionLineRecords collection (Steps 3-7: canmu..baogoi)
 * @module LineRecordProcessor
 */

var LineRecordProcessor = (function() {
  'use strict';

  var COLLECTION = 'productionLineRecords';
  var LINE_STAGE_ORDER = ['canmu', 'taohat', 'say', 'epbanh', 'baogoi'];

  // ==================== LOAD ====================

  /**
   * Load line records from Firestore for a specific factory and date
   * @param {string} factoryId
   * @param {string} dateStr - YYYY-MM-DD
   * @param {Object} [filters] - Optional filters
   * @returns {Promise<Array>}
   */
  async function loadRecords(factoryId, dateStr, filters) {
    if (!factoryId) return [];
    try {
      var db = ErpDb.firestore();
      var query = db.collection(COLLECTION).where('factory', '==', factoryId);
      if (dateStr) {
        query = query.where('date', '==', dateStr);
      }
      var snapshot = await query.get();
      var records = [];
      snapshot.forEach(function(doc) {
        records.push(Object.assign({ id: doc.id }, doc.data()));
      });
      if (filters) {
        records = filterRecords(records, filters);
      }
      return records;
    } catch (e) {
      console.error('LineRecordProcessor.loadRecords error:', e);
      return [];
    }
  }

  // ==================== SAVE ====================

  /**
   * Save a line record (create or update)
   * @param {Object} data - Record data
   * @param {string|null} recordId - Existing record ID (null for new)
   * @param {Object} currentUser
   * @returns {Promise<string>} Record ID
   */
  async function saveRecord(data, recordId, currentUser) {
    var db = ErpDb.firestore();
    var userId = currentUser ? currentUser.id : null;
    data.updatedAt = ErpDb.firestore.FieldValue.serverTimestamp();
    data.updatedBy = userId;

    if (recordId) {
      await db.collection(COLLECTION).doc(recordId).update(data);
      return recordId;
    } else {
      data.createdAt = ErpDb.firestore.FieldValue.serverTimestamp();
      data.createdBy = userId;
      var docRef = await db.collection(COLLECTION).add(data);
      return docRef.id;
    }
  }

  // ==================== DELETE ====================

  async function deleteRecord(recordId) {
    if (!recordId) return;
    var db = ErpDb.firestore();
    await db.collection(COLLECTION).doc(recordId).delete();
  }

  // ==================== CODE GENERATION ====================

  /**
   * Generate record code: "MN1-SX1-20260214"
   * @param {string} line - Production line (MN1, MN2, MT)
   * @param {string} shift - Shift code (SX-1, SX-2, SX-3)
   * @param {string} dateStr - YYYY-MM-DD
   * @returns {string}
   */
  function generateRecordCode(line, shift, dateStr) {
    var datePart = (dateStr || '').replace(/-/g, '');
    var shiftPart = (shift || '').replace('-', '');
    return line + '-' + shiftPart + '-' + datePart;
  }

  // ==================== FILTER ====================

  /**
   * Filter records by various criteria
   * @param {Array} records
   * @param {Object} filters - { stage, line, shift, keyword }
   * @returns {Array}
   */
  function filterRecords(records, filters) {
    if (!records || !filters) return records || [];
    var filtered = records.slice();

    if (filters.stage) {
      var filterIdx = LINE_STAGE_ORDER.indexOf(filters.stage);
      filtered = filtered.filter(function(r) {
        var rIdx = LINE_STAGE_ORDER.indexOf(r.currentStage);
        var hasData = r.stageData && r.stageData[filters.stage];
        return rIdx >= filterIdx || hasData;
      });
    }
    if (filters.line) {
      filtered = filtered.filter(function(r) {
        return r.productionLine === filters.line;
      });
    }
    if (filters.shift) {
      filtered = filtered.filter(function(r) {
        return r.shift === filters.shift;
      });
    }
    if (filters.status) {
      filtered = filtered.filter(function(r) {
        return r.status === filters.status;
      });
    }
    if (filters.keyword) {
      var kw = filters.keyword.toLowerCase();
      filtered = filtered.filter(function(r) {
        return (r.recordCode || '').toLowerCase().indexOf(kw) !== -1 ||
               (r.productionLine || '').toLowerCase().indexOf(kw) !== -1;
      });
    }
    return filtered;
  }

  // ==================== AUTO-LINK MUONG TO BATCHES ====================

  /**
   * Auto-link muong numbers to production batches by searching taodong channel data
   * @param {Array<number>} muongNumbers - e.g. [1, 2, 3, 4, 5]
   * @param {string} dateStr - YYYY-MM-DD
   * @param {string} factoryId
   * @returns {Promise<Array>} linkedBatches: [{batchId, batchNo, muongs:[]}]
   */
  async function autoLinkMuongsToBatches(muongNumbers, dateStr, factoryId) {
    if (!muongNumbers || muongNumbers.length === 0 || !factoryId) return [];

    try {
      var db = ErpDb.firestore();
      // Query batches for this factory on the exact taodong date
      var allBatches = [];
      if (dateStr) {
        var snap = await db.collection('productionBatches')
          .where('factory', '==', factoryId)
          .where('date', '==', dateStr)
          .get();
        snap.forEach(function(doc) {
          allBatches.push(Object.assign({ id: doc.id }, doc.data()));
        });
      }

      // Fallback: try with Date objects (some batches may store date as Timestamp)
      if (allBatches.length === 0 && dateStr) {
        var snap2 = await db.collection('productionBatches')
          .where('factory', '==', factoryId)
          .get();
        snap2.forEach(function(doc) {
          var bd = doc.data();
          var bDate = bd.date;
          if (bDate && bDate.toDate) bDate = bDate.toDate();
          if (bDate instanceof Date) {
            var bDateStr = bDate.getFullYear() + '-' + String(bDate.getMonth() + 1).padStart(2, '0') + '-' + String(bDate.getDate()).padStart(2, '0');
            if (bDateStr === dateStr) {
              allBatches.push(Object.assign({ id: doc.id }, bd));
            }
          }
        });
      }

      // Build muong → batch mapping
      var muongSet = {};
      muongNumbers.forEach(function(m) { muongSet[m] = true; });

      var linkedMap = {}; // batchId → { batchId, batchNo, muongs: [] }

      allBatches.forEach(function(batch) {
        var channels = [];
        if (batch.stageData && batch.stageData.taodong && batch.stageData.taodong.params) {
          channels = batch.stageData.taodong.params.channels || [];
        } else if (batch.techParams && batch.techParams.channels) {
          channels = batch.techParams.channels;
        }

        channels.forEach(function(ch) {
          if (ch.muong && muongSet[ch.muong]) {
            if (!linkedMap[batch.id]) {
              linkedMap[batch.id] = {
                batchId: batch.id,
                batchNo: batch.batchNo || batch.id,
                muongs: []
              };
            }
            if (linkedMap[batch.id].muongs.indexOf(ch.muong) === -1) {
              linkedMap[batch.id].muongs.push(ch.muong);
            }
          }
        });
      });

      var result = [];
      for (var key in linkedMap) {
        if (linkedMap.hasOwnProperty(key)) {
          linkedMap[key].muongs.sort(function(a, b) { return a - b; });
          result.push(linkedMap[key]);
        }
      }
      return result;
    } catch (e) {
      console.warn('autoLinkMuongsToBatches error:', e.message);
      return [];
    }
  }

  // ==================== STAGE NAVIGATION ====================

  function getLineStageIndex(stage) {
    return LINE_STAGE_ORDER.indexOf(stage);
  }

  function getNextLineStage(stage) {
    var idx = LINE_STAGE_ORDER.indexOf(stage);
    if (idx < 0 || idx >= LINE_STAGE_ORDER.length - 1) return null;
    return LINE_STAGE_ORDER[idx + 1];
  }

  function getPrevLineStage(stage) {
    var idx = LINE_STAGE_ORDER.indexOf(stage);
    if (idx <= 0) return null;
    return LINE_STAGE_ORDER[idx - 1];
  }

  function isLineStage(stage) {
    return LINE_STAGE_ORDER.indexOf(stage) !== -1;
  }

  // ==================== ADVANCE / REVERT ====================

  /**
   * Advance a record to the next line stage
   * @param {string} recordId
   * @param {Object} record - Current record data
   * @param {Object} currentUser
   * @returns {Promise<string|null>} Next stage or null if completed
   */
  async function advanceRecord(recordId, record, currentUser) {
    var db = ErpDb.firestore();
    var userId = currentUser ? currentUser.id : null;
    var nextStage = getNextLineStage(record.currentStage);

    var updateData = {
      updatedAt: ErpDb.firestore.FieldValue.serverTimestamp(),
      updatedBy: userId
    };
    updateData['stageData.' + record.currentStage + '.completedAt'] = ErpDb.firestore.FieldValue.serverTimestamp();
    updateData['stageData.' + record.currentStage + '.completedBy'] = userId;
    updateData['stageData.' + record.currentStage + '.completedByName'] = currentUser ? (currentUser.hoTen || currentUser.name || '') : '';

    if (nextStage) {
      updateData.currentStage = nextStage;
    } else {
      // Last stage (baogoi) — complete the record
      updateData.status = 'completed';
    }

    await db.collection(COLLECTION).doc(recordId).update(updateData);
    return nextStage;
  }

  /**
   * Revert a record to the previous line stage
   */
  async function revertRecord(recordId, record, currentUser) {
    var db = ErpDb.firestore();
    var userId = currentUser ? currentUser.id : null;
    var prevStage = getPrevLineStage(record.currentStage);
    if (!prevStage) return null;

    var updateData = {
      currentStage: prevStage,
      updatedAt: ErpDb.firestore.FieldValue.serverTimestamp(),
      updatedBy: userId
    };
    // Reset status to processing if record was completed
    if (record.status === 'completed') {
      updateData.status = 'processing';
    }
    // Xóa stageData bước hiện tại để tránh dữ liệu cũ khi làm lại
    updateData['stageData.' + record.currentStage] = ErpDb.firestore.FieldValue.delete();

    await db.collection(COLLECTION).doc(recordId).update(updateData);
    return prevStage;
  }

  // ==================== STATS ====================

  function calculateStats(records) {
    if (!records || records.length === 0) {
      return { total: 0, processing: 0, completed: 0, byLine: {}, byStage: {} };
    }
    var stats = {
      total: records.length,
      processing: 0,
      completed: 0,
      byLine: {},
      byStage: {}
    };
    records.forEach(function(r) {
      if (r.status === 'completed') stats.completed++;
      else stats.processing++;

      var line = r.productionLine || 'unknown';
      if (!stats.byLine[line]) stats.byLine[line] = 0;
      stats.byLine[line]++;

      var stage = r.currentStage || 'unknown';
      if (!stats.byStage[stage]) stats.byStage[stage] = 0;
      stats.byStage[stage]++;
    });
    return stats;
  }

  // ==================== PUBLIC API ====================

  return {
    COLLECTION: COLLECTION,
    LINE_STAGE_ORDER: LINE_STAGE_ORDER,
    loadRecords: loadRecords,
    saveRecord: saveRecord,
    deleteRecord: deleteRecord,
    generateRecordCode: generateRecordCode,
    filterRecords: filterRecords,
    autoLinkMuongsToBatches: autoLinkMuongsToBatches,
    getLineStageIndex: getLineStageIndex,
    getNextLineStage: getNextLineStage,
    getPrevLineStage: getPrevLineStage,
    isLineStage: isLineStage,
    advanceRecord: advanceRecord,
    revertRecord: revertRecord,
    calculateStats: calculateStats
  };
})();
