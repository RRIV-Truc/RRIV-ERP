/**
 * Factory Configuration - Cấu hình nhà máy RRIV
 * @module SanxuatFactories
 */

const SanxuatFactories = (function() {
  'use strict';

  const FACTORY_CONFIG = {
    'A02': {
      name: 'Xưởng cao su tờ', shortName: 'Xưởng cao su tờ',
      products: ['SVR3L','SVR5','SVRCV40','SVRCV50','SVRCV60','SVRL','SVR10','SVR20','RSS'],
      plantations: ['LAI UYÊN','NHÀ NAI','TẦN HƯNG'],
      plantationCodes: ['LU','NN','TH'], zenDvcs: 'A02'
    },
    'A01': {
      name: 'Nhà máy Bố Lá - Ly Tâm', shortName: 'Bố Lá',
      products: ['SVR3L','SVR5','SVRCV40','SVRCV50','SVRCV60','SVRL','LatexHA','LatexLA'],
      plantations: ['BỐ LÁ','HỘI NGHĨA','HƯNG HÒA'],
      plantationCodes: ['BL','HN','HH'], zenDvcs: 'A01'
    }
  };

  function getName(factoryId) {
    return FACTORY_CONFIG[factoryId]?.name || factoryId || 'Chưa chọn NM';
  }

  function getShortName(factoryId) {
    return FACTORY_CONFIG[factoryId]?.shortName || factoryId || '';
  }

  function getProducts(factoryId) {
    return FACTORY_CONFIG[factoryId]?.products || [];
  }

  function getPlantations(factoryId) {
    return FACTORY_CONFIG[factoryId]?.plantations || [];
  }

  function getPlantationCodes(factoryId) {
    return FACTORY_CONFIG[factoryId]?.plantationCodes || [];
  }

  function getZenDvcs(factoryId) {
    return FACTORY_CONFIG[factoryId]?.zenDvcs || factoryId;
  }

  function getAllFactoryIds() {
    return Object.keys(FACTORY_CONFIG);
  }

  function getConfig(factoryId) {
    return FACTORY_CONFIG[factoryId] || null;
  }

  return {
    FACTORY_CONFIG,
    getName,
    getShortName,
    getProducts,
    getPlantations,
    getPlantationCodes,
    getZenDvcs,
    getAllFactoryIds,
    getConfig
  };
})();
