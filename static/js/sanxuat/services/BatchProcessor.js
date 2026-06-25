/**
 * Batch Processor - Xử lý logic nghiệp vụ lô sản xuất
 * Load, Save, Delete, Filter, Export batches
 * @module BatchProcessor
 * @depends FirestoreService, CRUDService, ExportService, TCCSSpecs, SanxuatStages, SanxuatParams, TCCSValidator
 */

const BatchProcessor = (function() {
  'use strict';

  const COLLECTION = 'productionBatches';
  const BLENDING_COLLECTION = 'blendingBatches';

  // ==================== LOAD ====================

  /**
   * Load batches from Firestore, filtered by factory
   * @param {string} factoryId - Factory ID (e.g. 'A02')
   * @param {number} [limit=100] - Max records
   * @returns {Promise<Array>} Array of batch objects
   */
  async function loadBatches(factoryId, limit) {
    limit = limit || 100;
    try {
      const db = ErpDb.firestore();
      const snapshot = await db.collection(COLLECTION)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();

      return snapshot.docs
        .map(function(doc) { return Object.assign({ id: doc.id }, doc.data()); })
        .filter(function(d) { return !d.factory || d.factory === factoryId; });
    } catch (error) {
      console.error('BatchProcessor.loadBatches error:', error);
      throw error;
    }
  }

  /**
   * Load blending tanks for a specific date
   * @param {string} dateStr - Date string (YYYY-MM-DD)
   * @param {string} factoryId - Factory ID
   * @returns {Promise<Array>} Array of tank objects
   */
  async function loadBlendingTanks(dateStr, factoryId) {
    if (!dateStr) return [];
    try {
      const db = ErpDb.firestore();
      const snapshot = await db.collection(BLENDING_COLLECTION)
        .where('date', '==', dateStr)
        .orderBy('batchCode', 'asc')
        .get();

      return snapshot.docs
        .map(function(doc) { return Object.assign({ id: doc.id }, doc.data()); })
        .filter(function(d) { return !d.factory || d.factory === factoryId; });
    } catch (error) {
      console.warn('BatchProcessor.loadBlendingTanks error:', error.message);
      return [];
    }
  }

  // ==================== SAVE ====================

  /**
   * Save a batch (create or update)
   * @param {Object} batchData - Batch data
   * @param {string|null} batchId - Existing batch ID (null for new)
   * @param {Object} currentUser - Current user object { id }
   * @returns {Promise<string>} Batch ID
   */
  async function saveBatch(batchData, batchId, currentUser) {
    const db = ErpDb.firestore();
    const userId = currentUser?.id || null;

    // Build stageData entry
    var stageEntry = {
      params: batchData.techParams || {},
      updatedAt: new Date().toISOString(),
      updatedBy: userId
    };
    if (batchData.shiftData) Object.assign(stageEntry, batchData.shiftData);
    if (batchData.ovenData) Object.assign(stageEntry, batchData.ovenData);

    var data = {
      batchNo: batchData.batchNo,
      date: batchData.date instanceof Date ? batchData.date : new Date(batchData.date),
      product: batchData.product,
      processStage: batchData.processStage,
      inputWeight: batchData.inputWeight || 0,
      outputWeight: batchData.outputWeight || 0,
      status: batchData.status || 'processing',
      notes: batchData.notes || '',
      techParams: batchData.techParams || {},
      sourceTankId: batchData.sourceTankId || null,
      sourceTankCode: batchData.sourceTankCode || '',
      sourceTankNo: batchData.sourceTankNo || null,
      factory: batchData.factory,
      updatedAt: ErpDb.firestore.FieldValue.serverTimestamp(),
      updatedBy: userId
    };
    data['stageData.' + batchData.processStage] = stageEntry;

    try {
      if (batchId) {
        await db.collection(COLLECTION).doc(batchId).update(data);
        return batchId;
      } else {
        data.createdAt = ErpDb.firestore.FieldValue.serverTimestamp();
        data.createdBy = userId;
        var docRef = await db.collection(COLLECTION).add(data);
        return docRef.id;
      }
    } catch (error) {
      console.error('BatchProcessor.saveBatch error:', error);
      throw error;
    }
  }

  // ==================== DELETE ====================

  /**
   * Delete a batch
   * @param {string} batchId
   * @returns {Promise<void>}
   */
  async function deleteBatch(batchId) {
    try {
      var db = ErpDb.firestore();
      await db.collection(COLLECTION).doc(batchId).delete();
    } catch (error) {
      console.error('BatchProcessor.deleteBatch error:', error);
      throw error;
    }
  }

  // ==================== FILTER ====================

  /**
   * Filter batches by multiple criteria
   * @param {Array} batches - All batches
   * @param {Object} filters
   * @param {string} [filters.productionLineId] - Production line filter
   * @param {string} [filters.factoryId] - Factory ID for line lookup
   * @param {string} [filters.keyword] - Search keyword (batchNo, product)
   * @param {string} [filters.status] - Status filter
   * @param {string} [filters.stage] - Stage filter
   * @param {string} [filters.date] - Date filter (YYYY-MM-DD)
   * @param {number} [filters.tankNo] - Selected tank number
   * @returns {Array} Filtered batches
   */
  function filterBatches(batches, filters) {
    if (!batches || !filters) return batches || [];
    var filtered = batches.slice();

    // Filter by specific product
    if (filters.product) {
      filtered = filtered.filter(function(b) { return b.product === filters.product; });
    }

    // Filter by production line (legacy, used when no specific product)
    if (!filters.product && filters.productionLineId && filters.productionLineId !== 'all' && filters.factoryId) {
      var lines = SanxuatStages.PRODUCTION_LINES[filters.factoryId] || [];
      var line = lines.find(function(l) { return l.id === filters.productionLineId; });
      if (line && line.products) {
        filtered = filtered.filter(function(b) { return line.products.includes(b.product); });
      }
    }

    // Filter by keyword
    if (filters.keyword) {
      var kw = filters.keyword.toLowerCase();
      filtered = filtered.filter(function(b) {
        return (b.batchNo || '').toLowerCase().indexOf(kw) !== -1 ||
               (b.product || '').toLowerCase().indexOf(kw) !== -1;
      });
    }

    // Filter by status
    if (filters.status) {
      filtered = filtered.filter(function(b) { return b.status === filters.status; });
    }

    // Filter by stage
    if (filters.stage) {
      filtered = filtered.filter(function(b) {
        return b.processStage === filters.stage;
      });
    }

    // Filter by date
    if (filters.date) {
      filtered = filtered.filter(function(b) {
        var d = b.date?.toDate ? b.date.toDate() : new Date(b.date);
        return d.toISOString().slice(0, 10) === filters.date;
      });
    }

    // Filter by tank
    if (filters.tankNo) {
      filtered = filtered.filter(function(b) { return b.sourceTankNo === filters.tankNo; });
    }

    return filtered;
  }

  // ==================== STATS ====================

  /**
   * Calculate batch statistics
   * @param {Array} batches
   * @returns {Object} Stats summary
   */
  function calculateStats(batches) {
    if (!batches || batches.length === 0) {
      return { total: 0, processing: 0, completed: 0, totalInput: 0, totalOutput: 0, avgEfficiency: 0, byProduct: {}, byStage: {} };
    }

    var stats = {
      total: batches.length,
      processing: 0,
      completed: 0,
      totalInput: 0,
      totalOutput: 0,
      avgEfficiency: 0,
      byProduct: {},
      byStage: {}
    };

    var effSum = 0;
    var effCount = 0;

    batches.forEach(function(b) {
      if (b.status === 'completed') stats.completed++;
      else stats.processing++;

      stats.totalInput += (b.inputWeight || 0);
      stats.totalOutput += (b.outputWeight || 0);

      if (b.inputWeight > 0) {
        effSum += (b.outputWeight || 0) / b.inputWeight * 100;
        effCount++;
      }

      // By product
      var prod = b.product || 'Khác';
      if (!stats.byProduct[prod]) stats.byProduct[prod] = 0;
      stats.byProduct[prod]++;

      // By stage
      var stage = b.processStage || 'unknown';
      if (!stats.byStage[stage]) stats.byStage[stage] = 0;
      stats.byStage[stage]++;
    });

    stats.avgEfficiency = effCount > 0 ? parseFloat((effSum / effCount).toFixed(1)) : 0;

    return stats;
  }

  // ==================== EXPORT ====================

  /**
   * Build export data array from batches
   * @param {Array} batches
   * @param {string} factoryId
   * @returns {Array<Object>} Rows for Excel export
   */
  function buildExportData(batches, factoryId) {
    return batches.map(function(b) {
      var row = {
        'Số Lô': b.batchNo,
        'Ngày': formatDateSimple(b.date),
        'Sản Phẩm': b.product,
        'Công Đoạn': SanxuatStages.getStageLabel(b.processStage, factoryId, 'all'),
        'NL Đầu Vào (kg)': b.inputWeight,
        'Sản Lượng (kg)': b.outputWeight,
        'Hiệu Suất (%)': b.inputWeight > 0 ? ((b.outputWeight || 0) / b.inputWeight * 100).toFixed(1) : 0,
        'Trạng Thái': b.status === 'completed' ? 'Hoàn thành' : 'Đang xử lý',
        'Ghi Chú': b.notes
      };

      // Add tech params
      if (b.techParams) {
        Object.entries(b.techParams).forEach(function(entry) {
          var k = entry[0], v = entry[1];
          if (typeof v !== 'object') {
            row[SanxuatParams.getLabel(k)] = v;
          }
        });
      }

      // Oven data
      var sd = b.stageData?.say;
      if (sd?.ovenId) {
        var ovens = SanxuatStages.OVEN_CONFIG[factoryId] || [];
        var oven = ovens.find(function(o) { return o.id === sd.ovenId; });
        row['Lò sấy'] = oven ? oven.name : sd.ovenId;
      }
      if (sd?.trolleyDrying) {
        row['Thùng sấy'] = sd.trolleyDrying.map(function(t) {
          return '#' + t.trolleyNo + '(' + (t.timeIn || '') + '-' + (t.timeOut || '') + ')';
        }).join(', ');
      }
      if (sd?.tempLog && sd.tempLog.length > 0) {
        var b1 = sd.tempLog.filter(function(t) { return t.burner1 != null; }).map(function(t) { return t.burner1; });
        var b2 = sd.tempLog.filter(function(t) { return t.burner2 != null; }).map(function(t) { return t.burner2; });
        if (b1.length > 0) row['Nhiệt ĐĐ1(°C)'] = Math.min.apply(null, b1) + '–' + Math.max.apply(null, b1);
        if (b2.length > 0) row['Nhiệt ĐĐ2(°C)'] = Math.min.apply(null, b2) + '–' + Math.max.apply(null, b2);
      }

      return row;
    });
  }

  // ==================== STAGE OPERATIONS ====================

  /**
   * Get active product from production line
   * @param {string} factoryId
   * @param {string} productionLineId
   * @returns {string|null}
   */
  function getActiveProduct(factoryId, productionLineId) {
    var lines = SanxuatStages.PRODUCTION_LINES[factoryId] || [];
    var line = lines.find(function(l) { return l.id === productionLineId; });
    return (line && line.products) ? line.products[0] : null;
  }

  /**
   * Calculate efficiency percentage
   * @param {number} inputWeight
   * @param {number} outputWeight
   * @returns {string} e.g. '85.3'
   */
  function calcEfficiency(inputWeight, outputWeight) {
    if (!inputWeight || inputWeight <= 0) return '0';
    return ((outputWeight || 0) / inputWeight * 100).toFixed(1);
  }

  /**
   * Generate a batch code prefix
   * @param {string} prefix - e.g. 'LO'
   * @returns {string} e.g. 'LO-20260212-001'
   */
  function generateBatchCode(prefix) {
    var now = new Date();
    var dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    var rand = String(Math.floor(Math.random() * 999) + 1).padStart(3, '0');
    return (prefix || 'LO') + '-' + dateStr + '-' + rand;
  }

  // ==================== HELPERS ====================

  function formatDateSimple(date) {
    if (!date) return '';
    var d = date.toDate ? date.toDate() : new Date(date);
    return d.toLocaleDateString('vi-VN');
  }

  return {
    loadBatches: loadBatches,
    loadBlendingTanks: loadBlendingTanks,
    saveBatch: saveBatch,
    deleteBatch: deleteBatch,
    filterBatches: filterBatches,
    calculateStats: calculateStats,
    buildExportData: buildExportData,
    getActiveProduct: getActiveProduct,
    calcEfficiency: calcEfficiency,
    generateBatchCode: generateBatchCode
  };
})();
