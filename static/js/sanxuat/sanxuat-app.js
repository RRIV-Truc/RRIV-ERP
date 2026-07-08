/* sanxuat-app.js — shell ứng dụng Sản xuất */
// ============================================
// FIREBASE CONFIGURATION
// ============================================
const erpDbConfig = {
  apiKey: "AIzaSyBCpPDhOKofImy_K8xiV2Mhut_3gbdB1vY",
  authDomain: "rriv-erp.firebaseapp.com",
  projectId: "rriv-erp",
  storageBucket: "rriv-erp.firebasestorage.app",
  messagingSenderId: "1024381876052",
  appId: "1:1024381876052:web:150ee86fc411bd14733ac1"
};

ErpDb.initializeApp(erpDbConfig);
const auth = ErpDb.auth();
const db = ErpDb.firestore();
const storage = ErpDb.storage();

// ============================================
// STATE
// ============================================
let currentUser = null;
var gardens = [];      // var (not let) so modules can sync via window.gardens
var deliveries = [];   // var for cross-tab access
let receipts = [];
var batches = [];      // var - shared between MES and Quality
let tests = [];
let warehouseItems = [];

// ============================================
// MULTI-FACTORY CONFIGURATION
// ============================================
var FACTORY_CONFIG = {
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
let currentFactory = null;

function getFactoryName() { return SanxuatFactories.getName(currentFactory); }
function getFactoryShortName() { return SanxuatFactories.getShortName(currentFactory); }
function getFactoryProducts() { return SanxuatFactories.getProducts(currentFactory); }

function initFactorySelector() {
  let factories = [];
  try {
    const scopes = Permissions.getAppScopes('sanxuat');
    factories = scopes.factories || [];
  } catch(e) { console.warn('Permissions not loaded:', e.message); }
  // Backward compat: user cũ chưa có scope → default A02
  if (factories.length === 0) factories = ['A02'];
  // '*' = admin, all factories
  if (factories.includes('*')) factories = Object.keys(FACTORY_CONFIG);

  const select = document.getElementById('factorySelect');
  const container = document.getElementById('factorySelector');
  select.innerHTML = factories.map(f => {
    const cfg = FACTORY_CONFIG[f];
    return `<option value="${f}">${f} - ${cfg ? cfg.shortName : f}</option>`;
  }).join('');

  // Restore from sessionStorage or default to first
  const saved = sessionStorage.getItem('currentFactory');
  if (saved && factories.includes(saved)) {
    select.value = saved;
  } else {
    select.value = factories[0];
  }
  container.style.display = factories.length > 1 ? 'block' : 'none';
  currentFactory = select.value;
  sessionStorage.setItem('currentFactory', currentFactory);
  updateFactoryUI();
}

function switchFactory(factoryId) {
  if (!FACTORY_CONFIG[factoryId]) return;
  currentFactory = factoryId;
  window.currentFactory = factoryId; // Sync for Tab modules
  _sxShiftsCache = null; // Invalidate shift cache on factory change
  sessionStorage.setItem('currentFactory', factoryId);
  updateFactoryUI();
  // Reload active tab data
  const activeTab = document.querySelector('.tab.active');
  const tabIndex = activeTab ? [...document.querySelectorAll('.tab')].indexOf(activeTab) : 0;
  showTab(tabIndex);
}

function updateFactoryUI() {
  // Cập nhật Tab 2 header
  const tab2Label = document.getElementById('tab2FactoryLabel');
  if (tab2Label) tab2Label.textContent = `— ${getFactoryName()} (${currentFactory})`;
  // Filter products
  filterProductsByFactory();
  // Reset workspace tabs
  if (typeof TabMES !== 'undefined') {
    TabMES.initWorkspaceTabs();
  } else {
    currentProductionLine = 'all';
  }
}

function filterProductsByFactory() {
  const select = document.getElementById('batchProduct');
  if (!select || !currentFactory) return;
  const allowed = getFactoryProducts();
  if (allowed.length === 0) return;
  Array.from(select.querySelectorAll('option')).forEach(opt => {
    if (!opt.value) return;
    const show = allowed.includes(opt.value);
    opt.style.display = show ? '' : 'none';
    opt.disabled = !show;
  });
}

// TCCS 101:2025 - Thông số kỹ thuật chuẩn cho validate
// TCCS 101:2025 (SVR 3L/5) - Thông số kỹ thuật chuẩn
const TCCS_SPECS_101 = {
  tiepnhan: { paramDRC: {min:28} },
  xulymu: { paramDRCSau: {min:20, max:28}, paramNa2S2O5: {min:1.0, max:1.5, unit:'kg/t'}, paramMeshLoc: {min:40, max:40} },
  taodong: { _acidSpec: {acetic:{max:3}, formic:{max:2}}, _phSpec: {min:5.2, max:5.6} },
  canmu: { paramDayCanKeo: {min:50, max:70}, paramKheCan1: {min:4, max:6}, paramKheCan2: {min:1, max:3}, paramKheCan3: {min:0.4, max:0.6}, paramDayTruocBam: {max:8} },
  taohat: { paramKichThuocHat: {min:5, max:8}, paramChieuSauBon: {min:50, max:60}, paramTGDeRao: {min:2} },
  say: { paramNhietDoSay: {max:125} },
  epbanh: { paramNhietDoNguoi: {min:45, max:50}, paramTyLeKiemTra: {min:10} },
  baogoi: {}
};

// TCCS 103:2025 (SVR CV40/50/60) - Thông số khác biệt
const TCCS_SPECS_103 = {
  tiepnhan: { paramDRC: {min:28} },
  xulymu: { paramDRCSau: {min:20, max:28}, paramNa2S2O5: {min:1.0, max:1.5, unit:'kg/t'}, paramMeshLoc: {min:40, max:40}, paramHAS: {min:1.3, max:1.7} },
  taodong: { _acidSpec: {acetic:{max:2}, formic:{max:1}}, _phSpec: {min:5.0, max:5.6} },
  canmu: { paramDayCanKeo: {min:50, max:70}, paramKheCan1: {min:4, max:6}, paramKheCan2: {min:1, max:3}, paramKheCan3: {min:0.4, max:0.6}, paramDayTruocBam: {max:8} },
  taohat: { paramKichThuocHat: {min:5, max:8}, paramChieuSauBon: {min:50, max:60}, paramTGDeRao: {min:2} },
  say: { paramNhietDoSay: {max:135} },
  epbanh: { paramNhietDoNguoi: {min:45, max:50}, paramTyLeKiemTra: {min:10} },
  baogoi: {}
};

// TCCS 118:2023 (SVR L) - Thông số khác biệt
const TCCS_SPECS_118 = {
  tiepnhan: { paramDRC: {min:20}, paramNH3: {max:0.03}, paramPH: {min:6.5, max:8.0} },
  xulymu: { paramDRCSau: {min:20, max:28}, paramNa2S2O5: {min:0.8, max:1.2, unit:'kg/t'}, paramMeshLoc: {min:40, max:40} },
  taodong: { _acidSpec: {acetic:{max:3}, formic:{max:2}}, _phSpec: {min:5.5, max:5.8} },
  canmu: { paramDayCanKeo: {min:50, max:70}, paramKheCan1: {min:4, max:6}, paramKheCan2: {min:1, max:3}, paramKheCan3: {min:0.4, max:0.6}, paramDayTruocBam: {max:8} },
  taohat: { paramKichThuocHat: {min:5, max:8}, paramChieuSauBon: {min:50, max:60}, paramTGDeRao: {min:2} },
  say: { paramNhietDoSay: {max:120} },
  epbanh: { paramNhietDoNguoi: {min:45, max:50}, paramTyLeKiemTra: {min:10} },
  baogoi: {}
};

// TCCS 102:2015 (SVR 10/SVR 20 từ mủ phụ) - Thông số khác biệt
const TCCS_SPECS_102 = {
  tiepnhan: {},
  xulymu: {},
  taodong: {},
  canmu: { paramKheCan1:{min:4,max:6}, paramKheCan2:{min:1.5,max:2.5}, paramKheCan3:{min:0.3,max:0.7} },
  taohat: { paramKichThuocHat:{min:5,max:8} },
  say: { paramNhietDoSay:{max:120} },
  epbanh: { paramNhietDoNguoi:{min:45,max:50}, paramKhoiLuongBanh:{min:33,max:35.2}, paramTyLeKiemTra:{min:10} },
  baogoi: {}
};

function getTCCSSpecs() { return TCCSSpecs.getForProduct(document.getElementById('batchProduct')?.value || ''); }
function isProductCV() { return TCCSSpecs.isCV(document.getElementById('batchProduct')?.value || ''); }
function isProductSVRL() { return TCCSSpecs.isSVRL(document.getElementById('batchProduct')?.value || ''); }
function isProductSVR10_20() { return TCCSSpecs.isSVR1020(document.getElementById('batchProduct')?.value || ''); }

// Tên giai đoạn cho SVR 10/20 (TCCS 102) - quy trình khác mủ nước
const SVR1020_STAGE_LABELS = {
  tiepnhan:'Tiếp nhận & PL', xulymu:'Trộn đều', taodong:'Không áp dụng',
  canmu:'Gia công CH 1', taohat:'Gia công CH 2', say:'Sấy',
  epbanh:'Cân & Ép bành', baogoi:'Bao gói & KL'
};

// SVR 10/20 - Danh sách fields theo stage (khác mủ nước)
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

// Danh sách field IDs cho từng stage (bao gồm cả trường CV)
const STAGE_FIELDS = {
  tiepnhan: ['paramDRC','paramTSC','paramNH3','paramPH','paramLoaiMu','paramNgoaiQuan','paramPhanHangBD','paramGiongCay','paramMauSacMu','paramTGTiepNhan'],
  xulymu: ['paramKLHoThucTe','paramDRCTruoc','paramDRCSau','paramNuocPhaLoang','paramKLSauPhaLoang','paramPHTruocPL','paramPHSauPL','paramNa2S2O5','paramMeshLoc','paramMooneyBanDau','paramHAS','paramLoaiHCCatMach','paramKLHCCatMach'],
  taodong: ['paramKLPhaLoang_TD','paramKLMoiMuong','paramSoMuong','paramLoaiAxit','paramNongDoAxit','paramKLDungDichAxit','paramKLAxit','paramTGBatDauMuong','paramTGKetThucMuong','paramTGCanDuKien','paramKLBotDayHo'],
  canmu: ['paramDayCanKeo','paramKheCan1','paramKheCan2','paramKheCan3','paramDayTruocBam'],
  taohat: ['paramKichThuocHat','paramChieuSauBon','paramKLHoc','paramTGXepHoc','paramTGDeRao'],
  say: ['paramNhienLieu','paramNhietDoSay','paramSoThungSayDC','paramSoThungTrongLo','paramMooneySay','paramMooneyTarget','paramMauSacSay','paramKQSauSay'],
  epbanh: ['paramNhietDoNguoi','paramKhoiLuongBanh','paramKichThuocBanh','paramThoiGianEp','paramTyLeKiemTra'],
  baogoi: ['paramPhanHang','paramSoLuongBanh','paramViTriKho','paramGhiNhanStatus']
};

// === TCCS 107:2020 - Latex cô đặc bằng phương pháp ly tâm ===
function isProductLatex() { return TCCSSpecs.isLatex(document.getElementById('batchProduct')?.value || ''); }

const LATEX_STAGE_LABELS = {
  tiepnhan:'Tiếp nhận NL', xulymu:'Pha loãng & HC', taodong:'Lắng',
  canmu:'Ly tâm', taohat:'Hoàn chỉnh', say:'Bồn trung chuyển',
  epbanh:'Tồn trữ', baogoi:'Xuất hàng'
};

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

const TCCS_SPECS_107_HA = {
  tiepnhan: { paramDRC:{min:20}, paramNH3:{min:0.2}, paramVFA_LT:{max:0.05}, paramPH:{min:9} },
  xulymu: { paramDRCSau:{min:23,max:30}, paramNH3BoSung:{min:0.4,max:0.5}, paramMeshLoc:{min:60} },
  taodong: { paramThoiGianLang:{min:10}, paramVFA_Lang:{max:0.05} },
  canmu: { paramMeshLocLT:{min:40} },
  taohat: { paramNH3_HC:{min:0.65,max:0.7}, paramAmoniLaurat:{max:0.02}, paramMeshLocHC:{min:30} },
  say: {}, epbanh: {}, baogoi: {}
};

const TCCS_SPECS_107_LA = {
  tiepnhan: { paramDRC:{min:20}, paramNH3:{min:0.2}, paramVFA_LT:{max:0.05}, paramPH:{min:9} },
  xulymu: { paramDRCSau:{min:23,max:30}, paramNH3BoSung:{min:0.3,max:0.4}, paramMeshLoc:{min:60} },
  taodong: { paramThoiGianLang:{min:10}, paramVFA_Lang:{max:0.05} },
  canmu: { paramMeshLocLT:{min:40} },
  taohat: { paramNH3_HC:{max:0.29}, paramTMTD:{max:0.0125}, paramZnO:{max:0.0125},
            paramAmoniLaurat:{max:0.05}, paramMeshLocHC:{min:30} },
  say: {}, epbanh: {}, baogoi: {}
};

// Dây chuyền sản xuất theo nhà máy
const PRODUCTION_LINES = {
  'A02': [
    { id:'all', name:'Tất cả', tccs:null, products:null, stageLabels:null },
    { id:'tccs101', name:'Mủ nước', tccs:'101', products:['SVR3L','SVR5'], stageLabels:null },
    { id:'tccs103', name:'Mủ CV', tccs:'103', products:['SVRCV40','SVRCV50','SVRCV60'], stageLabels:null },
    { id:'tccs118', name:'SVR L', tccs:'118', products:['SVRL'], stageLabels:null },
    { id:'tccs102', name:'Mủ phụ', tccs:'102', products:['SVR10','SVR20'], stageLabels:SVR1020_STAGE_LABELS },
    { id:'rss', name:'RSS', tccs:null, products:['RSS'], stageLabels:null }
  ],
  'A01': [
    { id:'all', name:'Tất cả', tccs:null, products:null, stageLabels:null },
    { id:'tccs101', name:'Mủ nước', tccs:'101', products:['SVR3L','SVR5'], stageLabels:null },
    { id:'tccs103', name:'Mủ CV', tccs:'103', products:['SVRCV40','SVRCV50','SVRCV60'], stageLabels:null },
    { id:'tccs118', name:'SVR L', tccs:'118', products:['SVRL'], stageLabels:null },
    { id:'tccs107', name:'Latex', tccs:'107', products:['LatexHA','LatexLA'], stageLabels:LATEX_STAGE_LABELS }
  ]
};

let currentProductionLine = 'all';
let mesTankData = [];
let selectedMESTank = null;
let currentStage = 'xulymu';

const STAGE_ORDER = ['xulymu','taodong','canmu','taohat','say','epbanh','baogoi'];

// === SHIFT CONFIG (Ca sản xuất) ===
const SHIFT_CONFIG = {
  tiepnhan: [
    { code: 'TN-A', name: 'Ca TN A' },
    { code: 'TN-B', name: 'Ca TN B' },
  ],
  sanxuat: [
    { code: 'SX-1', name: 'Ca SX 1' },
    { code: 'SX-2', name: 'Ca SX 2' },
    { code: 'SX-3', name: 'Ca SX 3' },
  ]
};
var _sxShiftsCache = null;
function _getSXShiftsCached() { return _sxShiftsCache || SHIFT_CONFIG.sanxuat || []; }
const LONG_STAGES = ['taodong', 'say'];
function getShiftGroupForStage(stage) {
  const idx = STAGE_ORDER.indexOf(stage);
  return (idx >= 0 && idx <= 1) ? 'tiepnhan' : 'sanxuat';
}

// === OVEN CONFIG (Lò sấy theo nhà máy & dây chuyền) ===
const OVEN_CONFIG = {
  'A02': [
    { id: 'LO-MN1', name: 'Lò MN 1', line: 'Dây chuyền mủ nước 1' },
    { id: 'LO-MN2', name: 'Lò MN 2', line: 'Dây chuyền mủ nước 2' },
    { id: 'LO-MT', name: 'Lò mủ tạp', line: 'Dây chuyền mủ tạp' },
  ],
  'A01': [
    { id: 'LO-1', name: 'Lò sấy 1', line: 'Dây chuyền 1' },
  ]
};

const PARAM_LABELS = {
  paramDRC:'DRC (%)', paramTSC:'TSC (%)', paramNH3:'NH₃ (%)', paramPH:'pH',
  paramLoaiMu:'Loại mủ', paramNgoaiQuan:'Ngoại quan',
  paramKLHoThucTe:'KL hồ thực tế (kg)', paramDRCTruoc:'DRC trước pha loãng (%)', paramDRCSau:'DRC sau pha loãng (%)',
  paramPHTruocPL:'pH trước pha loãng', paramPHSauPL:'pH sau pha loãng',
  paramLoaiHCCatMach:'Loại HC cắt mạch', paramKLHCCatMach:'Lượng HC cắt mạch (kg)',
  paramNuocPhaLoang:'Nước pha loãng (L)', paramKLSauPhaLoang:'KL sau pha loãng (kg)', paramNa2S2O5:'Na₂S₂O₅ (kg)', paramMeshLoc:'Mesh lọc',
  paramKLPhaLoang_TD:'KL pha loãng (kg)', paramKLMoiMuong:'KL mỗi mương (kg)',
  paramSoMuong:'Số mương tạo đông', paramLoaiAxit:'Loại axit', paramNongDoAxit:'Nồng độ axit pha (%)', paramKLDungDichAxit:'KL dung dịch axit (kg)', paramKLAxit:'KL axit gốc (kg)',
  paramTGBatDauMuong:'TG bắt đầu xuống mương', paramTGKetThucMuong:'TG kết thúc xuống mương', paramTGCanDuKien:'TG cán dự kiến',
  paramDayCanKeo:'Dày cán kéo (mm)', paramKheCan1:'Khe cán 1 (mm)',
  paramKheCan2:'Khe cán 2 (mm)', paramKheCan3:'Khe cán 3 (mm)', paramDayTruocBam:'Dày trước bằm (mm)',
  paramKichThuocHat:'Kích thước hạt (mm)', paramChieuSauBon:'Chiều sâu bồn (cm)',
  paramKLHoc:'KL mỗi hộc (kg)', paramTGXepHoc:'TG xếp hộc xong', paramTGDeRao:'TG để ráo (h)',
  paramNhienLieu:'Nhiên liệu', paramNhietDoSay:'Nhiệt độ sấy (°C)',
  paramSoThungSayDC:'Thùng sấy DC', paramSoThungTrongLo:'Thùng trong lò',
  paramNhietDoNguoi:'Nhiệt độ nguội (°C)', paramKhoiLuongBanh:'KL bành (kg)',
  paramKichThuocBanh:'Kích thước bành (mm)', paramThoiGianEp:'TG ép (s)', paramTyLeKiemTra:'Tỷ lệ KT (%)',
  paramPhanHang:'Phân hạng', paramSoLuongBanh:'Số lượng bành', paramViTriKho:'Vị trí kho', paramGhiNhanStatus:'Ghi nhãn',
  paramKLBotDayHo:'KL mủ bọt+đáy (kg)',
  paramHAS:'HAS (kg/tấn)', paramMooneyBanDau:'Mooney BĐ', paramHASDong:'HAS đông (kg)',
  paramMooneyDong:'Mooney đông', paramMooneySay:'Mooney sấy', paramMooneyTarget:'Mooney mục tiêu',
  paramPPMooney:'PP giảm Mooney', paramDBD:'DBD (kg)',
  paramPhanHangBD:'Phân hạng BĐ', paramGiongCay:'Giống cây', paramMauSacMu:'Màu sắc mủ',
  paramTGTiepNhan:'TG tiếp nhận', paramMauSacSay:'Màu sắc sấy', paramKQSauSay:'KQ sau sấy',
  paramNguonTonTru:'Nguồn tồn trữ',
  paramVFA_LT:'VFA (%)', paramMg_LT:'Mg (%)', paramTGTiepNhan_LT:'TG từ cạo (h)',
  paramNH3BoSung:'NH₃ bổ sung (%)', paramMg_PL:'Mg trước xử lý (%)', paramDAHP:'DAHP (kg)', paramThoiGianKhuay:'TG khuấy (ph)',
  paramThoiGianLang:'TG lắng (h)', paramNH3_Lang:'NH₃ trước ly tâm (%)',
  paramVFA_Lang:'VFA trước ly tâm (%)', paramMg_Lang:'Mg trước ly tâm (%)',
  paramMeshLocLT:'Mesh lọc LT', paramThoiGianVS:'Chu kỳ VS (h)',
  paramDRC_LT:'DRC ly tâm (%)', paramTSC_LT:'TSC ly tâm (%)', paramHieuSuatLT:'Hiệu suất LT (%)',
  paramMeshLocHC:'Mesh lọc HC', paramNH3_HC:'NH₃ hoàn chỉnh (%)',
  paramAmoniLaurat:'Amoni laurat (%)', paramTMTD:'TMTD (%)', paramZnO:'ZnO (%)', paramThoiGianKhuay_HC:'TG khuấy HC (ph)',
  paramSoBonTC:'Bồn trung chuyển', paramTSC_TC:'TSC TC (%)', paramDRC_TC:'DRC TC (%)',
  paramNH3_TC:'NH₃ TC (%)', paramVFA_TC:'VFA TC (%)', paramKOH_TC:'KOH TC (%)',
  paramMST_TC:'MST TC (%)', paramMg_TC:'Mg TC (%)',
  paramSoBonTT:'Bồn tồn trữ', paramNgaySinhNhat:'Ngày sinh bồn',
  paramTSC_TT:'TSC TT (%)', paramDRC_TT:'DRC TT (%)', paramNH3_TT:'NH₃ TT (%)',
  paramVFA_TT:'VFA TT (%)', paramKOH_TT:'KOH TT (%)', paramMST_TT:'MST TT (%)',
  paramThoiGianTonTru:'TG tồn trữ (ngày)', paramCan:'Cặn (%)', paramDongKet:'Đông kết (%)',
  paramCu:'Cu (ppm)', paramMn:'Mn (ppm)'
};

function getActiveProduct() {
  if (typeof currentProduct !== 'undefined' && currentProduct) return currentProduct;
  const lines = PRODUCTION_LINES[currentFactory] || [];
  const line = lines.find(l => l.id === currentProductionLine);
  return (line && line.products) ? line.products[0] : null;
}

function getSpecsForProduct(product) { return TCCSSpecs.getForProduct(product); }
function getFieldsForStage(stage, product) { return SanxuatStages.getFieldsForStage(stage, product); }
function getTCCSName(product) { return TCCSSpecs.getName(product); }
function getStageLabel(stage) {
  if (typeof currentProduct !== 'undefined' && currentProduct) return SanxuatStages.getStageLabelByProduct(stage, currentProduct);
  return SanxuatStages.getStageLabel(stage, currentFactory, currentProductionLine);
}

function getSpecText(spec) {
  if (!spec) return '—';
  if (spec.min !== undefined && spec.max !== undefined) return `${spec.min} – ${spec.max}`;
  if (spec.min !== undefined) return `≥ ${spec.min}`;
  if (spec.max !== undefined) return `≤ ${spec.max}`;
  return '—';
}

function getBatchStageParams(batch, stage) { return SanxuatStages.getBatchStageParams(batch, stage); }

function getFilteredBatchesForStep() {
  var filtered = batches;
  // Filter by specific product (new workspace model)
  if (typeof currentProduct !== 'undefined' && currentProduct) {
    filtered = filtered.filter(function(b) { return b.product === currentProduct; });
  } else if (typeof currentWorkspace !== 'undefined' && currentWorkspace && typeof SanxuatStages !== 'undefined' && SanxuatStages.WORKSPACE_CONFIG) {
    // Filter by workspace products when no specific product selected
    var wsConfig = (SanxuatStages.WORKSPACE_CONFIG[currentFactory] || []).find(function(ws) { return ws.id === currentWorkspace; });
    if (wsConfig && wsConfig.products) {
      var wsCodes = wsConfig.products.map(function(p) { return p.code; });
      filtered = filtered.filter(function(b) { return wsCodes.indexOf(b.product) !== -1; });
    }
  } else {
    // Legacy: filter by production line
    var lines = PRODUCTION_LINES[currentFactory] || [];
    var line = lines.find(function(l) { return l.id === currentProductionLine; });
    if (currentProductionLine !== 'all' && line && line.products) {
      filtered = filtered.filter(function(b) { return line.products.indexOf(b.product) !== -1; });
    }
  }
  var mesDate = document.getElementById('mesDate')?.value || '';
  if (mesDate) {
    filtered = filtered.filter(function(b) {
      var d = b.date?.toDate ? b.date.toDate() : new Date(b.date);
      return d.toISOString().slice(0, 10) === mesDate;
    });
  }
  var keyword = (document.getElementById('batchSearch')?.value || '').toLowerCase();
  if (keyword) {
    filtered = filtered.filter(function(b) {
      return (b.batchNo || '').toLowerCase().indexOf(keyword) !== -1 ||
             (b.product || '').toLowerCase().indexOf(keyword) !== -1;
    });
  }
  return filtered;
}

// Auto-calculate DAHP — delegates to SanxuatCalculations
function calcDAHP() {
  const mg = parseFloat(document.getElementById('paramMg_PL')?.value) || 0;
  const dahpEl = document.getElementById('paramDAHP');
  if (dahpEl && mg > 0) {
    const r = SanxuatCalculations.calcDAHP(mg);
    dahpEl.value = r.value;
    dahpEl.title = r.formula;
  }
}

// Auto-calc DRC pha loang — delegates to SanxuatCalculations
function calcDilution(changed) {
  const drc1El = document.getElementById('paramDRCTruoc');
  const drc2El = document.getElementById('paramDRCSau');
  const nuocEl = document.getElementById('paramNuocPhaLoang');
  const hintEl = document.getElementById('dilutionHint');
  const klHoEl = document.getElementById('paramKLHoThucTe');
  // Ưu tiên KL hồ thực tế, nếu chưa nhập thì dùng KL đầu vào (từ hồ phối liệu)
  var W = parseFloat(klHoEl?.value) || 0;
  if (W <= 0) W = parseFloat(document.getElementById('batchInputWeight')?.value) || 0;
  const r = SanxuatCalculations.calcDilution({
    weight: W,
    drcBefore: parseFloat(drc1El?.value),
    drcAfter: parseFloat(drc2El?.value),
    water: parseFloat(nuocEl?.value),
    changed: changed
  });
  if (r.water !== null && nuocEl) nuocEl.value = r.water;
  if (r.drcAfter !== null && drc2El) { drc2El.value = r.drcAfter; validateTCCSField(drc2El); }
  if (r.drcBefore !== null && drc1El) drc1El.value = r.drcBefore;
  if (hintEl && r.formula) hintEl.textContent = r.formula;
  else if (hintEl && W <= 0) hintEl.textContent = r.formula || '';
  // Auto-calc KL sau pha loãng = KL hồ thực tế + nước
  var klEl = document.getElementById('paramKLSauPhaLoang');
  if (klEl) {
    var nuoc = parseFloat(nuocEl?.value) || 0;
    klEl.value = (W > 0 && nuoc > 0) ? (W + nuoc).toFixed(1) : '';
  }
}

// Auto-calc Na2S2O5 — delegates to SanxuatCalculations
function calcNa2S2O5() {
  var W = parseFloat(document.getElementById('paramKLHoThucTe')?.value) || 0;
  if (W <= 0) W = parseFloat(document.getElementById('batchInputWeight')?.value) || 0;
  const drc2 = parseFloat(document.getElementById('paramDRCSau')?.value) || 0;
  const el = document.getElementById('paramNa2S2O5');
  const hint = document.getElementById('na2s2o5Hint');
  const product = document.getElementById('batchProduct')?.value || '';
  const r = SanxuatCalculations.calcNa2S2O5(W, drc2, product);
  if (r.value > 0) {
    if (el) el.value = r.value.toFixed(2);
    if (el) validateTCCSField(el);
  }
  if (hint) hint.textContent = r.formula;
}

// Auto-calc HAS = Q.Khô (tấn) × 1.5
function calcHAS() {
  var W = parseFloat(document.getElementById('paramKLHoThucTe')?.value) || 0;
  if (W <= 0) W = parseFloat(document.getElementById('batchInputWeight')?.value) || 0;
  var drc = parseFloat(document.getElementById('paramDRCSau')?.value) || 0;
  if (drc <= 0) drc = parseFloat(document.getElementById('paramDRCTruoc')?.value) || 0;
  var el = document.getElementById('paramHAS');
  var hint = document.getElementById('hasHint');
  if (W <= 0 || drc <= 0) {
    if (hint) hint.textContent = 'Nhập KL hồ và DRC trước';
    return;
  }
  var quyKho = W * drc / 100;
  var has = quyKho * 1.5 / 1000;
  if (el) el.value = has.toFixed(2);
  if (hint) hint.textContent = 'Q.Khô = ' + quyKho.toFixed(1) + ' kg × 1.5/tấn = ' + has.toFixed(2) + ' kg';
}

// === Phân bổ mương: KL pha loãng / KL mỗi mương / Số mương ===
function calcMuongDistribution(changed) {
  var klEl = document.getElementById('paramKLPhaLoang_TD');
  var perEl = document.getElementById('paramKLMoiMuong');
  var soEl = document.getElementById('paramSoMuong');
  var hintEl = document.getElementById('muongDistHint');
  var kl = parseFloat(klEl?.value) || 0;
  var per = parseFloat(perEl?.value) || 0;
  var so = parseInt(soEl?.value) || 0;
  // KL hiệu dụng = tổng - bọt/đáy hồ
  var klBotDay = parseFloat(document.getElementById('paramKLBotDayHo')?.value) || 0;
  var klHieuDung = kl - klBotDay;

  if (changed === 'kl' || changed === 'muong') {
    if (klHieuDung > 0 && per > 0) {
      var raw = klHieuDung / per;
      var rounded = Math.ceil(raw);
      soEl.value = rounded;
      _updateMuongHint(hintEl, klHieuDung, per, rounded, klBotDay);
      generateMuongRows();
    }
  } else if (changed === 'so') {
    if (per > 0 && so > 0) {
      klEl.value = (per * so + klBotDay).toFixed(1);
      _updateMuongHint(hintEl, per * so, per, so, klBotDay);
    } else if (klHieuDung > 0 && so > 0) {
      perEl.value = (klHieuDung / so).toFixed(1);
      hintEl.textContent = so + ' m\u01B0\u01A1ng \u00D7 ' + formatNumber(Math.round(klHieuDung / so * 10) / 10) + ' kg';
    }
  }
}

function _updateMuongHint(hintEl, klHieuDung, per, so, klBotDay) {
  if (!hintEl) return;
  var lastMuong = klHieuDung - per * (so - 1);
  var prefix = klBotDay > 0 ? 'Tr\u1eeb b\u1ecdt/\u0111\u00e1y ' + formatNumber(klBotDay) + ' kg \u2192 ' : '';
  if (Math.abs(lastMuong - per) < 0.1) {
    hintEl.textContent = prefix + so + ' m\u01B0\u01A1ng \u00D7 ' + formatNumber(per) + ' kg';
  } else {
    hintEl.textContent = prefix + (so - 1) + ' m\u01B0\u01A1ng \u00D7 ' + formatNumber(per) + ' kg + m\u01B0\u01A1ng cu\u1ed1i ' + formatNumber(Math.round(lastMuong * 10) / 10) + ' kg';
  }
}

// Auto-fill KL pha loãng from xulymu when opening tạo đông
function prefillKLPhaLoang(batchId) {
  var b = (window.batches || []).find(function(x) { return x.id === batchId; });
  if (!b) return;
  var klEl = document.getElementById('paramKLPhaLoang_TD');
  if (!klEl || klEl.value) return; // don't overwrite if already has value
  // Tìm KL sau pha loãng từ nhiều nguồn
  var xlParams = b.stageData?.xulymu?.params || {};
  var klSauPL = parseFloat(xlParams.paramKLSauPhaLoang) || 0;
  // Fallback: tính từ KL hồ thực tế + nước pha loãng
  if (!klSauPL) {
    var klHo = parseFloat(xlParams.paramKLHoThucTe) || 0;
    var nuoc = parseFloat(xlParams.paramNuocPhaLoang) || 0;
    if (klHo > 0 && nuoc > 0) klSauPL = klHo + nuoc;
  }
  // Fallback: từ techParams (backward compat)
  if (!klSauPL) {
    klSauPL = parseFloat(b.techParams?.paramKLSauPhaLoang) || 0;
  }
  // Fallback: từ inputWeight (KL xe nạp)
  if (!klSauPL && b.inputWeight > 0) {
    klSauPL = b.inputWeight;
  }
  if (klSauPL) {
    klEl.value = klSauPL;
    var hint = document.getElementById('klPhaLoangHint');
    if (hint) hint.textContent = 'Lấy từ bước XL mủ: ' + formatNumber(klSauPL) + ' kg';
  }
}

// Hiện TG kết thúc XL mủ và validate TG tạo đông
function showXulymuEndTime(batchId) {
  var hint = document.getElementById('taodongTimeHint');
  if (!hint) return;
  var b = (window.batches || []).find(function(x) { return x.id === batchId; });
  if (!b) return;
  var xlData = b.stageData?.xulymu || {};
  // Ưu tiên: stageTimeEnd (nhập tay) → completedAt (tự động khi chuyển bước)
  var xlEnd = xlData.stageTimeEnd || '';
  var xlLabel = 'nh\u1EADp tay';
  if (!xlEnd && xlData.completedAt) {
    var ts = xlData.completedAt;
    if (ts.toDate) ts = ts.toDate();
    else if (typeof ts === 'string') ts = new Date(ts);
    if (ts instanceof Date && !isNaN(ts)) {
      xlEnd = String(ts.getHours()).padStart(2, '0') + ':' + String(ts.getMinutes()).padStart(2, '0');
      xlLabel = 'x\u00E1c nh\u1EADn chuy\u1EC3n b\u01B0\u1EDBc';
    }
  }
  hint.dataset.xlEnd = xlEnd;
  if (xlEnd) {
    hint.innerHTML = 'XL m\u1EE7 k\u1EBFt th\u00FAc: <b style="color:#22c55e">' + xlEnd + '</b> <span style="font-size:12px">(' + xlLabel + ')</span>';
  } else {
    hint.textContent = 'Th\u1EDDi gian b\u1EAFt \u0111\u1EA7u r\u00F3t m\u1EE7 (24h)';
  }
}

function validateTaodongTime() {
  var hint = document.getElementById('taodongTimeHint');
  var startEl = document.getElementById('paramTGBatDauMuong');
  if (!hint || !startEl) return;
  var xlEnd = hint.dataset?.xlEnd || '';
  var startVal = startEl.value || '';
  if (!xlEnd || !startVal || startVal.length < 5) {
    startEl.style.borderColor = '';
    if (xlEnd) {
      hint.innerHTML = 'XL m\u1EE7 k\u1EBFt th\u00FAc: <b style="color:#22c55e">' + xlEnd + '</b>';
    }
    return;
  }
  if (startVal < xlEnd) {
    startEl.style.borderColor = '#ef4444';
    hint.innerHTML = '<span style="color:#ef4444">Kh\u00F4ng \u0111\u01B0\u1EE3c tr\u01B0\u1EDBc ' + xlEnd + ' (KT x\u1EED l\u00FD m\u1EE7)</span>';
  } else {
    startEl.style.borderColor = '';
    hint.innerHTML = 'XL m\u1EE7 k\u1EBFt th\u00FAc: <b style="color:#22c55e">' + xlEnd + '</b>';
  }
}

// Tính KL quy khô khi user sửa KL tươi
function calcKLQuyKho(i) {
  var klTuoi = parseFloat(document.getElementById('klTuoi_' + i)?.value) || 0;
  var batchId = document.getElementById('batchId')?.value || '';
  var bData = (window.batches || []).find(function(x) { return x.id === batchId; });
  var drcSau = parseFloat(bData?.stageData?.xulymu?.params?.paramDRCSau)
    || parseFloat(bData?.techParams?.paramDRCSau) || 0;
  var khoEl = document.getElementById('klKho_' + i);
  if (khoEl) khoEl.value = (klTuoi > 0 && drcSau > 0) ? (klTuoi * drcSau / 100).toFixed(1) : '';
}

// === Bổ sung mủ từ hồ khác cho mương cuối ===
function toggleBoSung() {
  var form = document.getElementById('boSungForm');
  var toggle = document.getElementById('boSungToggle');
  if (!form) return;
  form.style.display = '';
  if (toggle) toggle.style.display = 'none';
  populateBoSungDropdown();
}

function populateBoSungDropdown() {
  var sel = document.getElementById('boSungBatchId');
  if (!sel) return;
  var currentBatchId = document.getElementById('batchId')?.value || '';
  var currentDate = document.getElementById('batchDate')?.value || '';
  var factory = typeof _factory === 'function' ? _factory() : '';
  var opts = '<option value="">-- Ch\u1ecdn h\u1ed3 --</option>';
  (window.batches || []).forEach(function(b) {
    if (b.id === currentBatchId) return;
    if (factory && b.factory && b.factory !== factory) return;
    if (currentDate && b.date && b.date !== currentDate) return;
    var label = (b.batchNo || b.id) + ' (' + (b.product || '') + ', ' + formatNumber(b.inputWeight || 0) + ' kg)';
    opts += '<option value="' + b.id + '" data-batchno="' + (b.batchNo || '') + '">' + label + '</option>';
  });
  sel.innerHTML = opts;
}

function onBoSungBatchChange() {
  // No-op for now, batch selection is stored via the select value
}

function calcBoSung() {
  var n = parseInt(document.getElementById('paramSoMuong')?.value) || 0;
  if (n <= 0) return;
  var klGoc = parseFloat(document.getElementById('boSungKLGoc')?.value) || 0;
  var klBS = parseFloat(document.getElementById('boSungKL')?.value) || 0;
  var total = klGoc + klBS;
  var klTuoiEl = document.getElementById('klTuoi_' + n);
  if (klTuoiEl) { klTuoiEl.value = total.toFixed(1); calcKLQuyKho(n); }
  var hint = document.getElementById('boSungHint');
  if (hint && klBS > 0) {
    hint.textContent = 'G\u1ed1c: ' + formatNumber(klGoc) + ' + BS: ' + formatNumber(klBS) + ' = ' + formatNumber(total) + ' kg';
  } else if (hint) {
    hint.textContent = '';
  }
}

function clearBoSung() {
  var form = document.getElementById('boSungForm');
  var toggle = document.getElementById('boSungToggle');
  if (form) form.style.display = 'none';
  if (toggle) toggle.style.display = '';
  var sel = document.getElementById('boSungBatchId');
  var kl = document.getElementById('boSungKL');
  if (sel) sel.value = '';
  if (kl) kl.value = '';
  // Restore KL tươi mương cuối về giá trị gốc
  var n = parseInt(document.getElementById('paramSoMuong')?.value) || 0;
  var klGoc = parseFloat(document.getElementById('boSungKLGoc')?.value) || 0;
  var klTuoiEl = document.getElementById('klTuoi_' + n);
  if (klTuoiEl && klGoc > 0) { klTuoiEl.value = klGoc.toFixed(1); calcKLQuyKho(n); }
  var hint = document.getElementById('boSungHint');
  if (hint) hint.textContent = '';
}

// Khi thay đổi KL mủ bọt/đáy → tính lại phân mương (trừ bọt/đáy khỏi tổng trước khi chia mương)
function calcBotDayHo() {
  var klBotDay = parseFloat(document.getElementById('paramKLBotDayHo')?.value) || 0;
  var hint = document.getElementById('botDayHoHint');
  if (hint) {
    if (klBotDay > 0) {
      hint.textContent = 'Tr\u1eeb ' + formatNumber(klBotDay) + ' kg m\u1ee7 b\u1ecdt/\u0111\u00e1y kh\u1ecfi t\u1ed5ng KL tr\u01b0\u1edbc khi chia m\u01b0\u01a1ng';
    } else {
      hint.textContent = 'L\u01b0\u1ee3ng m\u1ee7 b\u1ecdt v\u00e0 \u0111\u00e1y h\u1ed3 sinh ra t\u1eeb h\u1ed3 n\u00e0y \u2014 t\u1ef1 tr\u1eeb kh\u1ecfi t\u1ed5ng KL';
    }
  }
  // Tính lại số mương và phân bổ dựa trên KL hiệu dụng (tổng - bọt/đáy)
  calcMuongDistribution('kl');
}

// === Bảng pH mương tạo đông (dynamic) ===
function generateMuongRows() {
  const n = parseInt(document.getElementById('paramSoMuong')?.value) || 0;
  const container = document.getElementById('muongPHContainer');
  if (!container) return;
  if (n <= 0 || n > 90) { container.innerHTML = ''; return; }

  // Lấy spec pH cho hint
  const product = document.getElementById('batchProduct')?.value || '';
  const svrl = product === 'SVRL';
  const cv = product && product.startsWith('SVRCV');
  let phSpec = '5.2 - 5.6';
  if (svrl) phSpec = '5.5 - 5.8';
  else if (cv) phSpec = '5.0 - 5.6';

  // Lưu giá trị pH và mương số hiện tại để khôi phục (không lưu klTuoi/klKho vì cần tính lại)
  const oldValues = {};
  container.querySelectorAll('input').forEach(inp => {
    if (inp.value && !inp.id.startsWith('klTuoi_') && !inp.id.startsWith('klKho_') && !inp.id.startsWith('boSung')) oldValues[inp.id] = inp.value;
  });
  // Lưu trạng thái bổ sung
  var oldBoSung = {
    batchId: document.getElementById('boSungBatchId')?.value || '',
    kl: document.getElementById('boSungKL')?.value || ''
  };

  // Lấy KL pha loãng và DRC sau pha loãng để tính KL tươi/quy khô
  const klPhaLoang = parseFloat(document.getElementById('paramKLPhaLoang_TD')?.value) || 0;
  const batchId = document.getElementById('batchId')?.value || '';
  const bData = (window.batches || []).find(function(x) { return x.id === batchId; });
  const drcSau = parseFloat(bData?.stageData?.xulymu?.params?.paramDRCSau)
    || parseFloat(bData?.techParams?.paramDRCSau) || 0;

  let html = '<div class="stage-params-title" style="margin-top:12px;font-size:13px;">pH tạo đông — ' + n + ' mương (3 điểm đo)</div>';
  html += '<table class="muong-ph-table"><thead><tr>';
  html += '<th style="width:80px;">Mương số</th><th>pH đầu mương</th><th>pH giữa mương</th><th>pH cuối mương</th>';
  html += '<th style="width:100px;">KL tươi (kg)</th><th style="width:100px;">KL quy khô (kg)</th>';
  html += '</tr></thead><tbody>';
  const klMoiMuong = parseFloat(document.getElementById('paramKLMoiMuong')?.value) || 0;
  const klBotDay = parseFloat(document.getElementById('paramKLBotDayHo')?.value) || 0;
  for (let i = 1; i <= n; i++) {
    // KL tươi: trừ bọt/đáy khỏi tổng trước → chia đều, mương cuối = phần dư
    var klTuoi = '';
    var klHieuDung = klPhaLoang - klBotDay;
    if (klHieuDung > 0 && klMoiMuong > 0 && n > 0) {
      if (i < n) {
        klTuoi = klMoiMuong.toFixed(1);
      } else {
        var remainder = klHieuDung - klMoiMuong * (n - 1);
        klTuoi = remainder.toFixed(1);
      }
    }
    var klKho = (klTuoi && drcSau > 0) ? (parseFloat(klTuoi) * drcSau / 100).toFixed(1) : '';
    html += '<tr>';
    html += '<td style="padding:4px 6px;"><input type="number" id="muongNo_' + i + '" min="1" max="90" step="1" value="' + i + '" style="width:55px;text-align:center;font-weight:600;" oninput="validateMuongDuplicate()"></td>';
    html += '<td><input type="number" id="phDau_' + i + '" step="0.01" placeholder="' + phSpec + '" oninput="validateMuongPH(this)"></td>';
    html += '<td><input type="number" id="phGiua_' + i + '" step="0.01" placeholder="' + phSpec + '" oninput="validateMuongPH(this)"></td>';
    html += '<td><input type="number" id="phCuoi_' + i + '" step="0.01" placeholder="' + phSpec + '" oninput="validateMuongPH(this)"></td>';
    html += '<td><input type="number" id="klTuoi_' + i + '" step="0.1" value="' + klTuoi + '" oninput="calcKLQuyKho(' + i + ')" style="text-align:right;"></td>';
    html += '<td><input type="number" id="klKho_' + i + '" step="0.1" value="' + klKho + '" readonly style="text-align:right;opacity:0.8;cursor:default;"></td>';
    html += '</tr>';
  }
  html += '</tbody></table>';
  html += '<div id="muongDuplicateWarning" style="display:none;margin-top:6px;padding:6px 10px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.4);border-radius:6px;color:#ef4444;font-size:12px;font-weight:500;"></div>';

  // Bổ sung mủ cho mương cuối (dựa trên KL hiệu dụng = tổng - bọt/đáy)
  var klHD = klPhaLoang - klBotDay;
  var klGocCuoi = (klHD > 0 && klMoiMuong > 0 && n > 0) ? (klHD - klMoiMuong * (n - 1)) : 0;
  var canBoSung = klGocCuoi > 0 && klGocCuoi < klMoiMuong - 0.1;
  html += '<div id="boSungContainer" style="margin-top:8px;">';
  if (canBoSung) {
    html += '<div id="boSungToggle"><button type="button" onclick="toggleBoSung()" style="font-size:12px;color:var(--accent);cursor:pointer;background:none;border:none;padding:2px 0;text-decoration:underline;">+ B\u1ed5 sung m\u1ee7 t\u1eeb h\u1ed3 kh\u00e1c cho m\u01b0\u01a1ng ' + n + '</button></div>';
  }
  html += '<div id="boSungForm" style="display:none;margin-top:6px;padding:8px 12px;background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.25);border-radius:8px;">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">';
  html += '<span style="font-size:12px;font-weight:600;color:var(--text-secondary);">B\u1ed5 sung m\u1ee7 cho m\u01b0\u01a1ng ' + n + '</span>';
  html += '<button type="button" onclick="clearBoSung()" style="font-size:12px;padding:2px 8px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);border-radius:4px;color:#ef4444;cursor:pointer;">X\u00f3a BS</button>';
  html += '</div>';
  html += '<div style="display:flex;gap:10px;align-items:flex-end;">';
  html += '<div style="flex:2;"><label style="font-size:12px;color:var(--text-secondary);">H\u1ed3 b\u1ed5 sung</label>';
  html += '<select id="boSungBatchId" onchange="onBoSungBatchChange()" style="width:100%;font-size:12px;padding:4px 6px;background:var(--bg-primary);color:var(--text-primary);border:1px solid var(--border-color);border-radius:4px;"><option value="">-- Ch\u1ecdn h\u1ed3 --</option></select></div>';
  html += '<div style="flex:1;"><label style="font-size:12px;color:var(--text-secondary);">KL b\u1ed5 sung (kg)</label>';
  html += '<input type="number" id="boSungKL" step="0.1" oninput="calcBoSung()" style="width:100%;font-size:12px;text-align:right;padding:4px 6px;"></div>';
  html += '</div>';
  html += '<input type="hidden" id="boSungKLGoc" value="' + (canBoSung ? klGocCuoi.toFixed(1) : '') + '">';
  html += '<div id="boSungHint" class="param-hint" style="margin-top:4px;"></div>';
  html += '</div>';
  html += '</div>';

  html += '<div class="param-hint" style="margin-top:4px;">Chu\u1ea9n TCCS: pH ' + phSpec + (drcSau > 0 ? ' \u00b7 DRC sau pha lo\u00e3ng: ' + drcSau + '%' : '') + '</div>';
  container.innerHTML = html;

  // Khôi phục giá trị cũ
  for (const [id, val] of Object.entries(oldValues)) {
    const el = document.getElementById(id);
    if (el) { el.value = val; if (id.startsWith('ph')) validateMuongPH(el); }
  }

  // Khôi phục boSung nếu có
  if (oldBoSung && (oldBoSung.batchId || oldBoSung.kl)) {
    var bsForm = document.getElementById('boSungForm');
    var bsToggle = document.getElementById('boSungToggle');
    if (bsForm) { bsForm.style.display = ''; populateBoSungDropdown(); }
    if (bsToggle) bsToggle.style.display = 'none';
    var bsId = document.getElementById('boSungBatchId');
    var bsKL = document.getElementById('boSungKL');
    if (bsId && oldBoSung.batchId) bsId.value = oldBoSung.batchId;
    if (bsKL && oldBoSung.kl) { bsKL.value = oldBoSung.kl; calcBoSung(); }
  }

  // Validate duplicates after rendering
  setTimeout(validateMuongDuplicate, 50);
}

/**
 * Check for duplicate mương numbers:
 * 1) Within current batch (same mương number entered twice)
 * 2) Across other batches on the same day
 * Show red warning but still allow saving.
 */
function validateMuongDuplicate() {
  const n = parseInt(document.getElementById('paramSoMuong')?.value) || 0;
  const warningEl = document.getElementById('muongDuplicateWarning');
  if (!warningEl || n <= 0) { if (warningEl) warningEl.style.display = 'none'; return; }

  // Collect current batch's mương numbers
  const currentMuongs = [];
  for (let i = 1; i <= n; i++) {
    const val = parseInt(document.getElementById('muongNo_' + i)?.value);
    if (val) currentMuongs.push({ idx: i, muong: val });
  }

  // Collect used mương numbers from OTHER batches on the same day
  const currentBatchId = document.getElementById('batchId')?.value || '';
  const batchDate = document.getElementById('batchDate')?.value || '';
  const usedByOther = {}; // muongNo → batchNo
  if (typeof batches !== 'undefined' && batches.length > 0) {
    batches.forEach(function(b) {
      if (b.id === currentBatchId) return;
      // Normalize date for comparison (handle both string and Timestamp)
      var bd = b.date;
      if (bd && bd.toDate) bd = bd.toDate();
      if (bd instanceof Date) {
        bd = bd.getFullYear() + '-' + String(bd.getMonth() + 1).padStart(2, '0') + '-' + String(bd.getDate()).padStart(2, '0');
      }
      if (batchDate && bd !== batchDate) return;
      var channels = (b.stageData && b.stageData.taodong && b.stageData.taodong.params && b.stageData.taodong.params.channels)
                   || (b.techParams && b.techParams.channels) || [];
      channels.forEach(function(ch) {
        if (ch.muong) usedByOther[ch.muong] = b.batchNo || b.id;
      });
    });
  }

  // Check duplicates within current batch
  const seen = {};
  const internalDups = new Set();
  currentMuongs.forEach(function(item) {
    if (seen[item.muong]) { internalDups.add(item.muong); }
    seen[item.muong] = true;
  });

  // Check duplicates with other batches
  const crossDups = {}; // muongNo → batchNo
  currentMuongs.forEach(function(item) {
    if (usedByOther[item.muong]) crossDups[item.muong] = usedByOther[item.muong];
  });

  // Apply styling to inputs
  for (let i = 1; i <= n; i++) {
    const el = document.getElementById('muongNo_' + i);
    if (!el) continue;
    const val = parseInt(el.value);
    const isDup = internalDups.has(val) || crossDups[val];
    el.style.border = isDup ? '2px solid #ef4444' : '';
    el.style.background = isDup ? 'rgba(239,68,68,0.15)' : '';
    el.style.color = isDup ? '#ef4444' : '';
  }

  // Build warning message
  var warnings = [];
  if (internalDups.size > 0) {
    warnings.push('Trùng trong hồ: mương ' + Array.from(internalDups).join(', '));
  }
  var crossKeys = Object.keys(crossDups);
  if (crossKeys.length > 0) {
    var details = crossKeys.map(function(m) { return 'mương ' + m + ' (' + crossDups[m] + ')'; });
    warnings.push('Trùng với hồ khác: ' + details.join(', '));
  }

  if (warnings.length > 0) {
    warningEl.innerHTML = '⚠️ ' + warnings.join(' · ');
    warningEl.style.display = 'block';
  } else {
    warningEl.style.display = 'none';
  }
}

function validateMuongPH(el) {
  const val = parseFloat(el.value);
  if (isNaN(val)) { el.className = ''; return; }
  const product = document.getElementById('batchProduct')?.value || '';
  const r = TCCSValidator.validateMuongPH(val, product);
  el.className = r.ok ? 'ph-ok' : 'ph-warn';
}

function maskTime24(el) {
  const r = SanxuatCalculations.maskTime24(el.value);
  el.value = r.formatted;
  if (r.formatted.length === 5) {
    el.classList.toggle('param-warning', !r.valid);
    el.classList.toggle('param-ok', r.valid);
  } else {
    el.classList.remove('param-warning', 'param-ok');
  }
}

function validateAcidConcentration() {
  const acidType = document.getElementById('paramLoaiAxit')?.value || '';
  const el = document.getElementById('paramNongDoAxit');
  const hint = document.getElementById('acidConcHint');
  if (!el) return;
  const product = document.getElementById('batchProduct')?.value || '';
  const val = parseFloat(el.value);
  const r = TCCSValidator.validateAcidConcentration(acidType, isNaN(val) ? null : val, product);
  if (!r.maxVal) {
    if (hint) hint.textContent = acidType ? 'Chọn sản phẩm để xem giới hạn' : 'Chọn loại axit để xem giới hạn TCCS';
    el.placeholder = '...';
    el.classList.remove('param-warning', 'param-ok');
    return;
  }
  el.placeholder = '≤ ' + r.maxVal + '%';
  if (hint) hint.textContent = r.acidName + ': ≤ ' + r.maxVal + '% theo ' + r.tccsName;
  if (isNaN(val) || el.value === '') {
    el.classList.remove('param-warning', 'param-ok');
  } else {
    el.classList.toggle('param-ok', r.ok);
    el.classList.toggle('param-warning', !r.ok);
  }
}

// Tính KL axit gốc = KL dung dịch × (nồng độ pha / nồng độ gốc)
function calcAxitGoc() {
  var acidType = document.getElementById('paramLoaiAxit')?.value || '';
  var nongDoPha = parseFloat(document.getElementById('paramNongDoAxit')?.value) || 0;
  var klDungDich = parseFloat(document.getElementById('paramKLDungDichAxit')?.value) || 0;
  var klGocEl = document.getElementById('paramKLAxit');
  var hintEl = document.getElementById('klAxitHint');
  if (!klGocEl) return;
  // Nồng độ gốc theo loại axit
  var nongDoGoc = acidType === 'acetic' ? 98 : (acidType === 'formic' ? 85 : 0);
  if (nongDoPha <= 0 || klDungDich <= 0 || nongDoGoc <= 0) {
    klGocEl.value = '';
    if (hintEl) hintEl.textContent = '= KL dung d\u1ECBch \u00D7 n\u1ED3ng \u0111\u1ED9 pha / n\u1ED3ng \u0111\u1ED9 g\u1ED1c';
    return;
  }
  var klGoc = klDungDich * nongDoPha / nongDoGoc;
  klGocEl.value = klGoc.toFixed(2);
  var acidName = acidType === 'acetic' ? 'Acetic' : 'Formic';
  if (hintEl) hintEl.textContent = klDungDich + ' kg \u00D7 ' + nongDoPha + '% / ' + nongDoGoc + '% (' + acidName + ') = ' + klGoc.toFixed(2) + ' kg';
}

function collectMuongData() {
  const n = parseInt(document.getElementById('paramSoMuong')?.value) || 0;
  const channels = [];
  for (let i = 1; i <= n; i++) {
    const muongNo = parseInt(document.getElementById('muongNo_' + i)?.value) || i;
    const phDau = parseFloat(document.getElementById('phDau_' + i)?.value) || null;
    const phGiua = parseFloat(document.getElementById('phGiua_' + i)?.value) || null;
    const phCuoi = parseFloat(document.getElementById('phCuoi_' + i)?.value) || null;
    const klTuoi = parseFloat(document.getElementById('klTuoi_' + i)?.value) || null;
    const klKho = parseFloat(document.getElementById('klKho_' + i)?.value) || null;
    var ch = { muong: muongNo, phDau, phGiua, phCuoi, klTuoi, klKho };
    // Mương cuối: thu thập thông tin bổ sung nếu có
    if (i === n) {
      var bsSel = document.getElementById('boSungBatchId');
      var bsKL = parseFloat(document.getElementById('boSungKL')?.value) || 0;
      if (bsSel && bsSel.value && bsKL > 0) {
        var opt = bsSel.options[bsSel.selectedIndex];
        ch.boSung = {
          batchId: bsSel.value,
          batchNo: opt ? (opt.getAttribute('data-batchno') || '') : '',
          kl: bsKL
        };
      }
    }
    channels.push(ch);
  }
  return channels;
}

function loadMuongData(channels) {
  if (!channels || !Array.isArray(channels)) return;
  const el = document.getElementById('paramSoMuong');
  if (el) { el.value = channels.length; generateMuongRows(); }
  channels.forEach((ch, idx) => {
    const i = idx + 1;
    const m = document.getElementById('muongNo_' + i);
    const d = document.getElementById('phDau_' + i);
    const g = document.getElementById('phGiua_' + i);
    const c = document.getElementById('phCuoi_' + i);
    const kt = document.getElementById('klTuoi_' + i);
    const kk = document.getElementById('klKho_' + i);
    if (m && ch.muong != null) m.value = ch.muong;
    if (d && ch.phDau != null) { d.value = ch.phDau; validateMuongPH(d); }
    if (g && ch.phGiua != null) { g.value = ch.phGiua; validateMuongPH(g); }
    if (c && ch.phCuoi != null) { c.value = ch.phCuoi; validateMuongPH(c); }
    if (kt && ch.klTuoi != null) kt.value = ch.klTuoi;
    if (kk && ch.klKho != null) kk.value = ch.klKho;
    // Mương cuối: restore bổ sung nếu có
    if (i === channels.length && ch.boSung && ch.boSung.batchId) {
      var form = document.getElementById('boSungForm');
      var toggle = document.getElementById('boSungToggle');
      if (form) { form.style.display = ''; populateBoSungDropdown(); }
      if (toggle) toggle.style.display = 'none';
      var bsSel = document.getElementById('boSungBatchId');
      var bsKL = document.getElementById('boSungKL');
      if (bsSel) bsSel.value = ch.boSung.batchId;
      if (bsKL) { bsKL.value = ch.boSung.kl; calcBoSung(); }
    }
  });
  // Validate mương duplicates after loading
  setTimeout(validateMuongDuplicate, 50);
}

// === TG cán thực tế theo từng mương (Bước 4: Cán Mủ) ===
function generateCanmuMuongRows(batchId) {
  const container = document.getElementById('canmuMuongContainer');
  if (!container) return;
  const batch = batches.find(b => b.id === batchId);

  // Use channels from taodong stage data
  let channels = [];
  if (batch?.stageData?.taodong?.params?.channels) {
    channels = batch.stageData.taodong.params.channels;
  } else if (batch?.techParams?.channels) {
    channels = batch.techParams.channels;
  }
  if (channels.length === 0) {
    container.innerHTML = '<div class="param-hint" style="margin-top:8px;">Kh\u00F4ng c\u00F3 d\u1EEF li\u1EC7u m\u01B0\u01A1ng t\u1EEB b\u01B0\u1EDBc T\u1EA1o \u0110\u00F4ng</div>';
    return;
  }
  var dcLabel = '';
  let html = '<div class="stage-params-title" style="margin-top:12px;font-size:13px;">TG c\u00E1n th\u1EF1c t\u1EBF theo m\u01B0\u01A1ng (' + channels.length + ' m\u01B0\u01A1ng' + dcLabel + ')</div>';
  html += '<table class="muong-ph-table"><thead><tr>';
  html += '<th style="width:100px;">M\u01B0\u01A1ng</th><th>TG b\u1EAFt \u0111\u1EA7u c\u00E1n</th><th>TG k\u1EBFt th\u00FAc c\u00E1n</th>';
  html += '</tr></thead><tbody>';
  channels.forEach((ch, idx) => {
    html += '<tr>';
    html += '<td style="font-weight:600;">M\u01B0\u01A1ng ' + ch.muong + '</td>';
    html += '<td><input type="text" id="canBD_' + idx + '" maxlength="5" placeholder="HH:MM" oninput="maskTime24(this)" style="text-align:center;"></td>';
    html += '<td><input type="text" id="canKT_' + idx + '" maxlength="5" placeholder="HH:MM" oninput="maskTime24(this)" style="text-align:center;"></td>';
    html += '</tr>';
  });
  html += '</tbody></table>';
  html += '<div class="param-hint" style="margin-top:4px;">Nh\u1EADp TG b\u1EAFt \u0111\u1EA7u v\u00E0 k\u1EBFt th\u00FAc c\u00E1n th\u1EF1c t\u1EBF cho t\u1EEBng m\u01B0\u01A1ng (24h)</div>';
  container.innerHTML = html;
  container.dataset.channelCount = channels.length;
  container.dataset.muongOrder = JSON.stringify(channels.map(function(ch) { return ch.muong; }));
}

function _isValidTime24(s) {
  if (!s || s.length !== 5) return false;
  var hh = parseInt(s.slice(0, 2)), mm = parseInt(s.slice(3, 5));
  return s[2] === ':' && hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}

function collectCanmuMuongData() {
  const container = document.getElementById('canmuMuongContainer');
  const n = parseInt(container?.dataset?.channelCount) || 0;
  if (n === 0) return null;
  var muongOrder = [];
  try { muongOrder = JSON.parse(container.dataset.muongOrder || '[]'); } catch(e) {}
  const canmuChannels = [];
  for (let i = 0; i < n; i++) {
    var bdRaw = document.getElementById('canBD_' + i)?.value || null;
    var ktRaw = document.getElementById('canKT_' + i)?.value || null;
    // Only keep valid HH:MM values
    var bd = (bdRaw && _isValidTime24(bdRaw)) ? bdRaw : null;
    var kt = (ktRaw && _isValidTime24(ktRaw)) ? ktRaw : null;
    if (bd || kt) canmuChannels.push({ idx: i, muong: muongOrder[i] || (i + 1), tgBatDau: bd, tgKetThuc: kt });
  }
  return canmuChannels.length > 0 ? canmuChannels : null;
}

function loadCanmuMuongData(canmuChannels) {
  if (!canmuChannels || !Array.isArray(canmuChannels)) return;
  canmuChannels.forEach(ch => {
    const bd = document.getElementById('canBD_' + ch.idx);
    const kt = document.getElementById('canKT_' + ch.idx);
    if (bd && ch.tgBatDau) bd.value = ch.tgBatDau;
    if (kt && ch.tgKetThuc) kt.value = ch.tgKetThuc;
  });
}

// === SHIFT SELECTOR (Ca sản xuất) ===
async function renderShiftSelector(stage) {
  const container = document.getElementById('shiftSelectorContainer');
  if (!container) return;
  if (!stage) { container.innerHTML = ''; return; }

  // For 'say' stage: shift is derived from per-trolley data
  if (stage === 'say') {
    container.innerHTML = '<div style="background:var(--bg-tertiary);border-radius:8px;padding:8px 12px;">' +
      '<div style="font-size:12px;color:var(--text-muted);">⚠ Ca sản xuất công đoạn Sấy được tự động xác định từ dữ liệu thùng sấy bên dưới.</div></div>';
    return;
  }

  const group = getShiftGroupForStage(stage);
  // Nhóm tiếp nhận: ghi nhận thời gian thực hiện thay vì chọn ca
  // taodong: dùng paramTGBatDauMuong/paramTGKetThucMuong trong phần thông số → không cần time inputs riêng
  if (group === 'tiepnhan') {
    if (stage === 'taodong') {
      container.innerHTML = '';
      return;
    }
    var now = new Date();
    var hhmm = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
    var stageLabel = getStageLabel(stage);
    var tnHtml = '<div style="background:var(--bg-tertiary);border-radius:8px;padding:10px 12px;">';
    tnHtml += '<div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px;">Thời gian thực hiện — ' + stageLabel + '</div>';
    tnHtml += '<div class="form-row">';
    tnHtml += '<div class="form-group"><label>B\u1EAFt \u0111\u1EA7u</label><input type="text" id="stageTimeStart" class="form-control time24" placeholder="HH:MM" maxlength="5" oninput="formatTimeInput(this)" onblur="validateStageTimeRange()" style="text-align:center;" value="' + hhmm + '"></div>';
    tnHtml += '<div class="form-group"><label>K\u1EBFt th\u00FAc</label><input type="text" id="stageTimeEnd" class="form-control time24" placeholder="HH:MM" maxlength="5" oninput="formatTimeInput(this)" onblur="validateStageTimeRange()" style="text-align:center;" value=""></div>';
    tnHtml += '</div></div>';
    container.innerHTML = tnHtml;
    return;
  }
  // Lấy danh sách ca từ admin catalog (nếu có), fallback sang SHIFT_CONFIG
  var shifts;
  if (group === 'sanxuat' && typeof _getSXShiftsFromAdmin === 'function') {
    shifts = await _getSXShiftsFromAdmin();
  } else {
    shifts = SHIFT_CONFIG[group] || [];
  }
  const groupLabel = 'Ca sản xuất';
  const isLong = LONG_STAGES.includes(stage);
  let html = '<div style="background:var(--bg-tertiary);border-radius:8px;padding:10px 12px;">';
  html += '<div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px;">' + groupLabel + '</div>';
  html += '<div class="form-row">';
  if (isLong) {
    html += '<div class="form-group"><label>Ca vào (bắt đầu)</label><select id="shiftIn"><option value="">-- Chọn ca --</option>';
    shifts.forEach(function(s) { html += '<option value="' + s.code + '">' + s.name + '</option>'; });
    html += '</select></div>';
    html += '<div class="form-group"><label>Ca ra (kết thúc)</label><select id="shiftOut"><option value="">-- Chọn ca --</option>';
    shifts.forEach(function(s) { html += '<option value="' + s.code + '">' + s.name + '</option>'; });
    html += '</select></div>';
  } else {
    html += '<div class="form-group"><label>' + groupLabel + '</label><select id="shiftCode"><option value="">-- Chọn ca --</option>';
    shifts.forEach(function(s) { html += '<option value="' + s.code + '">' + s.name + '</option>'; });
    html += '</select></div>';
    html += '<div class="form-group"></div>';
  }
  html += '</div></div>';
  container.innerHTML = html;
}

function _validateTimeRange(startEl, endEl) {
  if (!startEl || !endEl) return;
  var s = startEl.value, e = endEl.value;
  if (!s || !e || !/^\d{2}:\d{2}$/.test(s) || !/^\d{2}:\d{2}$/.test(e)) {
    endEl.style.borderColor = '';
    return;
  }
  var sp = s.split(':'), ep = e.split(':');
  var sMins = parseInt(sp[0]) * 60 + parseInt(sp[1]);
  var eMins = parseInt(ep[0]) * 60 + parseInt(ep[1]);
  if (eMins <= sMins) {
    endEl.style.borderColor = '#f97316';
    showToast('Gi\u1EDD k\u1EBFt th\u00FAc (' + e + ') tr\u01B0\u1EDBc gi\u1EDD b\u1EAFt \u0111\u1EA7u (' + s + ')', 'warning');
  } else {
    endEl.style.borderColor = '';
  }
}
function validateStageTimeRange() {
  _validateTimeRange(document.getElementById('stageTimeStart'), document.getElementById('stageTimeEnd'));
}
function validateMuongTimeRange() {
  _validateTimeRange(document.getElementById('paramTGBatDauMuong'), document.getElementById('paramTGKetThucMuong'));
}
function validateOvenTimeSequence() {
  var s = document.getElementById('ovenStartTime');
  var r = document.getElementById('ovenReadyTime');
  var t = document.getElementById('ovenShutdownTime');
  _validateTimeRange(s, r);
  _validateTimeRange(r, t);
}
function validateTrolleyTimeRange(idx) {
  // Skip validation for overnight trolleys (timeIn is from previous day)
  var row = document.getElementById('dtrow_' + idx);
  if (row && row.dataset.overnight === 'true') return;
  _validateTimeRange(document.getElementById('dtIn_' + idx), document.getElementById('dtOut_' + idx));
}
function validateDeliveryTimeRange() {
  _validateTimeRange(document.getElementById('deliveryTappingTime'), document.getElementById('deliveryCollectionTime'));
}
function validateSchedTimeRange(rowId) {
  _validateTimeRange(document.getElementById('schedStart_' + rowId), document.getElementById('schedEnd_' + rowId));
}

function collectShiftData(stage) {
  const isLong = LONG_STAGES.includes(stage);
  const group = getShiftGroupForStage(stage);

  // For 'say': derive batch-level shift from trolley data
  if (stage === 'say') {
    return _deriveSayShiftFromTrolleys();
  }

  // Nhóm tiếp nhận: ghi nhận thời gian thực hiện
  if (group === 'tiepnhan') {
    if (stage === 'taodong') {
      // Tạo đông: thời gian thực hiện = TG bắt đầu/kết thúc xuống mương
      var startMuong = document.getElementById('paramTGBatDauMuong')?.value || '';
      var endMuong = document.getElementById('paramTGKetThucMuong')?.value || '';
      return { stageTimeStart: startMuong, stageTimeEnd: endMuong };
    }
    var startTime = document.getElementById('stageTimeStart')?.value || '';
    var endTime = document.getElementById('stageTimeEnd')?.value || '';
    return { stageTimeStart: startTime, stageTimeEnd: endTime };
  }

  // Read shift data directly from select elements (populated from admin or fallback)
  function _getShiftFromSelect(selectId) {
    var el = document.getElementById(selectId);
    if (!el || !el.value) return null;
    var opt = el.options[el.selectedIndex];
    return { code: el.value, name: opt ? opt.textContent : el.value };
  }

  if (isLong) {
    return { shiftIn: _getShiftFromSelect('shiftIn'), shiftOut: _getShiftFromSelect('shiftOut') };
  } else {
    return { shift: _getShiftFromSelect('shiftCode') };
  }
}

function loadShiftData(stageDataObj, stage) {
  if (!stageDataObj) return;
  // For 'say': shift data loaded into trolley rows by loadOvenData
  if (stage === 'say') return;
  const group = getShiftGroupForStage(stage);
  // Nhóm tiếp nhận: load thời gian thực hiện
  if (group === 'tiepnhan') {
    if (stage === 'taodong') return; // taodong: thời gian nằm trong params (paramTGBatDauMuong/paramTGKetThucMuong)
    var startEl = document.getElementById('stageTimeStart');
    var endEl = document.getElementById('stageTimeEnd');
    if (startEl && stageDataObj.stageTimeStart) startEl.value = stageDataObj.stageTimeStart;
    if (endEl && stageDataObj.stageTimeEnd) endEl.value = stageDataObj.stageTimeEnd;
    return;
  }
  const isLong = LONG_STAGES.includes(stage);
  if (isLong) {
    const inEl = document.getElementById('shiftIn');
    const outEl = document.getElementById('shiftOut');
    if (inEl && stageDataObj.shiftIn?.code) inEl.value = stageDataObj.shiftIn.code;
    if (outEl && stageDataObj.shiftOut?.code) outEl.value = stageDataObj.shiftOut.code;
  } else {
    const el = document.getElementById('shiftCode');
    if (el && stageDataObj.shift?.code) el.value = stageDataObj.shift.code;
  }
}

// === TROLLEY MAPPING (Thùng sấy 1-28 → Hộc → Mương) ===
let currentEditingBatchId = null;
let _trolleyRowCounter = 0;
var _occupiedTrolleys = []; // Trolleys currently in oven (no timeOut)

// Get trolleys currently drying in ovens (across all line records for this factory)
function getOccupiedTrolleys() {
  var occupied = [];
  var allRecs = window.lineRecords || [];
  allRecs.forEach(function(rec) {
    if (!rec.stageData || !rec.stageData.say) return;
    var td = rec.stageData.say.trolleyDrying || rec.stageData.say.params?.trolleyDrying;
    if (!td || !Array.isArray(td)) return;
    td.forEach(function(t) {
      if (t.trolleyNo && t.timeIn && !t.timeOut) {
        occupied.push(t.trolleyNo);
      }
    });
  });
  _occupiedTrolleys = occupied;
  return occupied;
}

// Get trolley numbers already selected in other rows of the current form
function getSelectedTrolleysInForm(excludeIdx) {
  var selected = [];
  var tbody = document.getElementById('trolleyMappingBody');
  if (!tbody) return selected;
  tbody.querySelectorAll('select[id^="tThung_"]').forEach(function(sel) {
    var rowIdx = parseInt(sel.id.replace('tThung_', ''));
    if (rowIdx !== excludeIdx && sel.value) {
      selected.push(parseInt(sel.value));
    }
  });
  return selected;
}

function getTrolleyOptions(currentVal, rowIdx) {
  var occupied = _occupiedTrolleys;
  var inForm = getSelectedTrolleysInForm(rowIdx);
  var maxTrolleys = 28;
  var html = '<option value="">--</option>';
  for (var i = 1; i <= maxTrolleys; i++) {
    var inOven = occupied.indexOf(i) !== -1;
    var inOtherRow = inForm.indexOf(i) !== -1;
    if (i === currentVal || (!inOven && !inOtherRow)) {
      html += '<option value="' + i + '"' + (i === currentVal ? ' selected' : '') + '>' + i + '</option>';
    }
  }
  return html;
}

function onTrolleySelectChange() {
  // Refresh all trolley dropdowns to update available options
  var tbody = document.getElementById('trolleyMappingBody');
  if (!tbody) return;
  tbody.querySelectorAll('select[id^="tThung_"]').forEach(function(sel) {
    var rowIdx = parseInt(sel.id.replace('tThung_', ''));
    var currentVal = parseInt(sel.value) || 0;
    sel.innerHTML = getTrolleyOptions(currentVal, rowIdx);
  });
}

function getTrolleyMuongOptions() {
  // Read checked muongs from checkboxes (source of truth)
  var container = document.getElementById('lineRecordMuongsContainer');
  if (container) {
    var checked = [];
    container.querySelectorAll('input[type=checkbox]:checked').forEach(function(cb) {
      checked.push(parseInt(cb.value));
    });
    if (checked.length > 0) {
      var html = '<option value="">-- M\u01B0\u01A1ng --</option>';
      checked.sort(function(a, b) { return a - b; });
      checked.forEach(function(m) { html += '<option value="' + m + '">M\u01B0\u01A1ng ' + m + '</option>'; });
      return html;
    }
  }
  // Fallback: batch mode (for hồ records without muong checkboxes)
  var batch = batches.find(function(b) { return b.id === currentEditingBatchId; });
  var channels = batch?.stageData?.taodong?.params?.channels || batch?.techParams?.channels || [];
  var html2 = '<option value="">-- M\u01B0\u01A1ng --</option>';
  channels.forEach(function(ch) { html2 += '<option value="' + ch.muong + '">M\u01B0\u01A1ng ' + ch.muong + '</option>'; });
  return html2;
}

function addTrolleyRow(trolleyNo, fromBox, toBox, muongNo, xhTime) {
  const tbody = document.getElementById('trolleyMappingBody');
  if (!tbody) return;
  const idx = _trolleyRowCounter++;
  const muongOpts = getTrolleyMuongOptions();
  const trolleyOpts = getTrolleyOptions(trolleyNo || 0, idx);
  let html = '<tr id="trow_' + idx + '">';
  html += '<td><select id="tThung_' + idx + '" onchange="onTrolleySelectChange()" style="width:90px;text-align:center;">' + trolleyOpts + '</select></td>';
  html += '<td><input type="number" id="tFrom_' + idx + '" min="1" step="1" placeholder="T\u1EA5t c\u1EA3" value="' + (fromBox || '') + '"></td>';
  html += '<td><input type="number" id="tTo_' + idx + '" min="1" step="1" placeholder="T\u1EA5t c\u1EA3" value="' + (toBox || '') + '"></td>';
  html += '<td><select id="tMuong_' + idx + '" onchange="updateXepHocTime()">' + muongOpts + '</select></td>';
  html += '<td><input type="text" id="tXH_' + idx + '" class="time24" value="' + (xhTime || '') + '" placeholder="HH:MM" maxlength="5" oninput="formatTimeInput(this)" style="text-align:center;font-size:12px;"></td>';
  html += '<td><button type="button" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:16px;" onclick="removeTrolleyRow(' + idx + ')">×</button></td>';
  html += '</tr>';
  tbody.insertAdjacentHTML('beforeend', html);
  if (muongNo) {
    const sel = document.getElementById('tMuong_' + idx);
    if (sel) sel.value = muongNo;
  }
  // Refresh other dropdowns to hide newly selected trolley
  onTrolleySelectChange();
}

function removeTrolleyRow(idx) {
  const row = document.getElementById('trow_' + idx);
  if (row) row.remove();
  onTrolleySelectChange(); // Refresh available trolleys
  updateXepHocTime();
}

function initTrolleyTable() {
  const tbody = document.getElementById('trolleyMappingBody');
  if (tbody) tbody.innerHTML = '';
  _trolleyRowCounter = 0;
  getOccupiedTrolleys(); // Refresh occupied trolleys from sấy step
}

function updateXepHocTime() {
  const batch = batches.find(function(b) { return b.id === currentEditingBatchId; });
  var canmuChannels = [];
  var taodongChannels = [];

  if (batch) {
    canmuChannels = batch?.stageData?.canmu?.params?.canmuChannels || batch?.techParams?.canmuChannels || [];
    taodongChannels = batch?.stageData?.taodong?.params?.channels || batch?.techParams?.channels || [];
  }

  // canmu is step 3 (line record) — fallback to current line record
  if (canmuChannels.length === 0) {
    var recId = (document.getElementById('lineRecordId') || {}).value || '';
    var rec = recId ? (window.lineRecords || []).find(function(r) { return r.id === recId; }) : null;
    if (rec) {
      canmuChannels = rec?.stageData?.canmu?.params?.canmuChannels || [];
    }
    // taodong is step 2 (on batch) — try from batchId reference on line record
    if (taodongChannels.length === 0 && rec && rec.batchId) {
      var refBatch = batches.find(function(b) { return b.id === rec.batchId; });
      if (refBatch) taodongChannels = refBatch?.stageData?.taodong?.params?.channels || [];
    }
  }

  if (canmuChannels.length === 0) return;

  // Build muongNo → tgBatDau map
  var muongTimeMap = {};
  canmuChannels.forEach(function(cc) {
    var mNo = cc.muong || (cc.idx + 1);
    if (cc.tgBatDau && (!muongTimeMap[mNo] || cc.tgBatDau < muongTimeMap[mNo])) {
      muongTimeMap[mNo] = cc.tgBatDau;
    }
  });

  // Fill per-row XH time (only if currently empty)
  var rows = document.querySelectorAll('#trolleyMappingBody tr');
  rows.forEach(function(row) {
    var muongSel = row.querySelector('select[id^="tMuong_"]');
    var xhInput = row.querySelector('input[id^="tXH_"]');
    if (!muongSel || !xhInput) return;
    var mNo = parseInt(muongSel.value);
    if (mNo && muongTimeMap[mNo] && !xhInput.value) {
      xhInput.value = muongTimeMap[mNo];
    }
  });

  // Also update summary paramTGXepHoc
  var earliest = null;
  rows.forEach(function(row) {
    var xhInput = row.querySelector('input[id^="tXH_"]');
    if (xhInput && xhInput.value && /^\d{2}:\d{2}$/.test(xhInput.value)) {
      if (!earliest || xhInput.value < earliest) earliest = xhInput.value;
    }
  });
  var el = document.getElementById('paramTGXepHoc');
  if (el) el.value = earliest || '';
}

function collectTrolleyData() {
  const tbody = document.getElementById('trolleyMappingBody');
  if (!tbody) return null;
  const rows = tbody.querySelectorAll('tr');
  if (rows.length === 0) return null;
  const mappings = [];
  rows.forEach(function(row) {
    var thungSel = row.querySelector('select[id^="tThung_"]');
    var fromInput = row.querySelector('input[id^="tFrom_"]');
    var toInput = row.querySelector('input[id^="tTo_"]');
    var muongSel = row.querySelector('select[id^="tMuong_"]');
    var xhInput = row.querySelector('input[id^="tXH_"]');
    var trolleyNo = parseInt(thungSel?.value) || null;
    var fromBox = parseInt(fromInput?.value) || null;
    var toBox = parseInt(toInput?.value) || null;
    var muongNo = parseInt(muongSel?.value) || null;
    var xhTime = xhInput?.value || '';
    if (trolleyNo || fromBox || toBox || muongNo) {
      var entry = { trolleyNo: trolleyNo, fromBox: fromBox, toBox: toBox, muongNo: muongNo };
      if (xhTime) entry.xhTime = xhTime;
      mappings.push(entry);
    }
  });
  return mappings.length > 0 ? mappings : null;
}

function loadTrolleyData(data) {
  if (!data || !Array.isArray(data)) return;
  initTrolleyTable();
  // Flatten old format if needed
  var flatRows = [];
  if (data.length > 0 && data[0].boxMappings) {
    data.forEach(function(trolley) {
      (trolley.boxMappings || []).forEach(function(m) {
        flatRows.push({trolleyNo: trolley.trolleyNo, fromBox: m.fromBox, toBox: m.toBox, muongNo: m.muongNo});
      });
    });
  } else {
    flatRows = data;
  }
  // Filter out trolley rows with muongs not belonging to this record
  var validMuongs = _getCheckedMuongSet();
  if (validMuongs.size > 0) {
    flatRows = flatRows.filter(function(r) { return !r.muongNo || validMuongs.has(r.muongNo); });
  }
  flatRows.forEach(function(m) {
    addTrolleyRow(m.trolleyNo, m.fromBox, m.toBox, m.muongNo, m.xhTime || '');
  });
  updateXepHocTime();
}

function _getCheckedMuongSet() {
  var muongs = new Set();
  var container = document.getElementById('lineRecordMuongsContainer');
  if (container) {
    container.querySelectorAll('input[type=checkbox]:checked').forEach(function(cb) {
      muongs.add(parseInt(cb.value));
    });
  }
  return muongs;
}

// === OVEN DRYING & TEMPERATURE LOG (Bước 6 - Sấy) ===
let _dryTrolleyCounter = 0;
let _tempRowCounter = 0;
var _currentOvernightFrom = null; // { recordId, date } — set by loadOvenData for overnight records

function initOvenSelect() {
  const sel = document.getElementById('ovenSelect');
  if (!sel) return;
  const ovens = OVEN_CONFIG[currentFactory] || [];
  const dcLines = SanxuatStages.getDCLinesForFactory(currentFactory);
  const currentDC = (document.getElementById('lineRecordDCLine') || {}).value || '';
  const dcCfg = dcLines.find(function(d) { return d.id === currentDC; });

  // Auto-select oven based on DC line
  var displayEl = document.getElementById('ovenNameDisplay');
  if (dcCfg && dcCfg.ovenId) {
    var oven = ovens.find(function(o) { return o.id === dcCfg.ovenId; });
    sel.innerHTML = '<option value="' + dcCfg.ovenId + '">' + (oven ? oven.name : dcCfg.ovenId) + '</option>';
    sel.value = dcCfg.ovenId;
    if (displayEl) displayEl.textContent = '\uD83D\uDD25 ' + (oven ? oven.name : dcCfg.ovenId);
    // Sync capacity
    if (oven) {
      var capEl = document.getElementById('paramSoThungTrongLo');
      if (capEl && !capEl.dataset.userSet) { capEl.value = oven.capacity || 24; updateTrolleyWaitingCount(); }
    }
  } else {
    // Fallback: show dropdown if no mapping
    sel.style.display = '';
    sel.innerHTML = '<option value="">-- Ch\u1ECDn l\u00F2 --</option>';
    ovens.forEach(function(o) {
      sel.innerHTML += '<option value="' + o.id + '">' + o.name + ' (' + o.line + ')</option>';
    });
    if (displayEl) displayEl.style.display = 'none';
    sel.onchange = function() {
      var ov = ovens.find(function(o) { return o.id === sel.value; });
      if (ov) {
        var capEl = document.getElementById('paramSoThungTrongLo');
        if (capEl) { capEl.value = ov.capacity || 24; updateTrolleyWaitingCount(); }
      }
    };
  }
  // Show transfer section and reset
  var transferSec = document.getElementById('transferTrolleySection');
  if (transferSec) {
    transferSec.style.display = '';
    _acceptedTransferTrolleys = [];
    refreshTransferableTrolleys();
  }
}

function _getTrolleyB5Data() {
  var trolleys = null;
  var canmuChannels = null;
  var taodongChannels = null;
  var batch = batches.find(function(b) { return b.id === currentEditingBatchId; });
  if (batch) {
    trolleys = batch?.stageData?.taohat?.params?.trolleys || batch?.techParams?.trolleys;
    canmuChannels = batch?.stageData?.canmu?.params?.canmuChannels || [];
    taodongChannels = batch?.stageData?.taodong?.params?.channels || [];
  } else {
    var recId = (document.getElementById('lineRecordId') || {}).value || '';
    var rec = recId ? (window.lineRecords || []).find(function(r) { return r.id === recId; }) : null;
    if (rec) {
      trolleys = rec?.stageData?.taohat?.params?.trolleys || [];
      canmuChannels = rec?.stageData?.canmu?.params?.canmuChannels || [];
      // taodong is on batch (step 2)
      if (rec.batchId) {
        var refBatch = batches.find(function(b) { return b.id === rec.batchId; });
        if (refBatch) taodongChannels = refBatch?.stageData?.taodong?.params?.channels || [];
      }
    }
  }
  if (!trolleys || trolleys.length === 0) return { trolleyMap: {}, xhTimeMap: {} };
  var trolleyMap = {};
  if (trolleys[0]?.boxMappings) {
    trolleys.forEach(function(t) { if (t.trolleyNo) { if (!trolleyMap[t.trolleyNo]) trolleyMap[t.trolleyNo] = []; (t.boxMappings||[]).forEach(function(m) { if (m.muongNo && trolleyMap[t.trolleyNo].indexOf(m.muongNo) === -1) trolleyMap[t.trolleyNo].push(m.muongNo); }); } });
  } else {
    trolleys.forEach(function(t) { if (t.trolleyNo) { if (!trolleyMap[t.trolleyNo]) trolleyMap[t.trolleyNo] = []; if (t.muongNo && trolleyMap[t.trolleyNo].indexOf(t.muongNo) === -1) trolleyMap[t.trolleyNo].push(t.muongNo); } });
  }
  // Build per-trolley XH time: saved xhTime has priority, fallback to canmu tgBatDau
  var xhTimeMap = {};
  // 1. Read saved xhTime from trolley data
  trolleys.forEach(function(t) {
    if (t.trolleyNo && t.xhTime) xhTimeMap[t.trolleyNo] = t.xhTime;
  });
  // 2. Fallback: compute from canmu tgBatDau for trolleys without saved xhTime
  if (canmuChannels && canmuChannels.length > 0) {
    var muongTimeMap = {};
    canmuChannels.forEach(function(cc) {
      var mNo = cc.muong || (cc.idx || 0) + 1;
      if (cc.tgBatDau && (!muongTimeMap[mNo] || cc.tgBatDau < muongTimeMap[mNo])) {
        muongTimeMap[mNo] = cc.tgBatDau;
      }
    });
    Object.keys(trolleyMap).forEach(function(tNo) {
      if (xhTimeMap[tNo]) return; // already have saved value
      var muongs = trolleyMap[tNo];
      var earliest = null;
      muongs.forEach(function(m) {
        if (muongTimeMap[m] && (!earliest || muongTimeMap[m] < earliest)) earliest = muongTimeMap[m];
      });
      if (earliest) xhTimeMap[tNo] = earliest;
    });
  }
  return { trolleyMap: trolleyMap, xhTimeMap: xhTimeMap };
}

// Track trolleys accepted from other DC lines in the current form
var _acceptedTransferTrolleys = []; // [{trolleyNo, fromDCLine, fromRecordId, muongs, xhTime}]

/**
 * Find trolleys from OTHER line records (same date, same factory)
 * that were created at tạo hạt but NOT yet in any oven
 */
function getTransferableTrolleys() {
  var currentRecordId = (document.getElementById('lineRecordId') || {}).value || '';
  var prodDate = (document.getElementById('lineRecordProductionDate') || {}).value || '';
  var factory = window.currentFactory;
  if (!prodDate || !factory) return [];

  // Collect all trolleys already in ovens across ALL records
  var inOven = {};
  (window.lineRecords || []).forEach(function(rec) {
    var td = rec.stageData && rec.stageData.say && rec.stageData.say.trolleyDrying;
    if (!td || !Array.isArray(td)) return;
    td.forEach(function(t) { if (t.trolleyNo) inOven[t.trolleyNo] = true; });
  });

  // Collect trolleys already in current form's drying table
  document.querySelectorAll('#dryingTrolleyBody select[id^="dtThung_"]').forEach(function(sel) {
    var v = parseInt(sel.value);
    if (v) inOven[v] = true;
  });

  var result = [];
  (window.lineRecords || []).forEach(function(rec) {
    if (rec.id === currentRecordId) return;
    if (rec.factory !== factory) return;
    if (rec.date !== prodDate) return;

    // Get trolleys from tạo hạt step
    var trolleys = rec.stageData && rec.stageData.taohat && rec.stageData.taohat.params && rec.stageData.taohat.params.trolleys;
    if (!trolleys || !Array.isArray(trolleys)) return;

    var dcLineName = rec.productionLine || '?';

    // Build per-trolley muong map and xhTime map from source record
    var srcTrolleyMap = {};
    var srcXhTimeMap = {};
    trolleys.forEach(function(t) {
      if (!t.trolleyNo) return;
      var muongs = [];
      if (t.boxMappings) {
        t.boxMappings.forEach(function(m) { if (m.muongNo && muongs.indexOf(m.muongNo) === -1) muongs.push(m.muongNo); });
      } else if (t.muongNo) {
        muongs.push(t.muongNo);
      }
      srcTrolleyMap[t.trolleyNo] = muongs;
      if (t.xhTime) srcXhTimeMap[t.trolleyNo] = t.xhTime;
    });
    // Fallback: compute xhTime from canmu tgBatDau for trolleys without saved xhTime
    var canmuCh = rec.stageData && rec.stageData.canmu && rec.stageData.canmu.params && rec.stageData.canmu.params.canmuChannels;
    if (canmuCh && canmuCh.length > 0) {
      var muongTimeMap = {};
      canmuCh.forEach(function(cc) {
        var mNo = cc.muong || (cc.idx || 0) + 1;
        if (cc.tgBatDau && (!muongTimeMap[mNo] || cc.tgBatDau < muongTimeMap[mNo])) muongTimeMap[mNo] = cc.tgBatDau;
      });
      Object.keys(srcTrolleyMap).forEach(function(tNo) {
        if (srcXhTimeMap[tNo]) return;
        var muongs = srcTrolleyMap[tNo];
        var earliest = null;
        muongs.forEach(function(m) { if (muongTimeMap[m] && (!earliest || muongTimeMap[m] < earliest)) earliest = muongTimeMap[m]; });
        if (earliest) srcXhTimeMap[tNo] = earliest;
      });
    }

    trolleys.forEach(function(t) {
      if (!t.trolleyNo) return;
      if (inOven[t.trolleyNo]) return; // already in an oven somewhere

      result.push({
        trolleyNo: t.trolleyNo,
        fromDCLine: dcLineName,
        fromRecordId: rec.id,
        muongs: srcTrolleyMap[t.trolleyNo] || [],
        xhTime: srcXhTimeMap[t.trolleyNo] || ''
      });
    });
  });

  return result;
}

function getDryingTrolleyOptions() {
  var data = _getTrolleyB5Data();
  var nos = Object.keys(data.trolleyMap).map(Number).sort(function(a, b) { return a - b; });

  // Include accepted transfer trolleys
  _acceptedTransferTrolleys.forEach(function(t) {
    if (nos.indexOf(t.trolleyNo) === -1) nos.push(t.trolleyNo);
  });
  nos.sort(function(a, b) { return a - b; });

  if (nos.length === 0) return '<option value="">-- Ch\u01B0a c\u00F3 th\u00F9ng --</option>';
  var html = '<option value="">-- Ch\u1ECDn --</option>';
  nos.forEach(function(tNo) {
    var isTransfer = _acceptedTransferTrolleys.some(function(t) { return t.trolleyNo === tNo; });
    var label = '#' + tNo + (isTransfer ? ' \u2190' : '');
    html += '<option value="' + tNo + '">' + label + '</option>';
  });
  return html;
}

function onDryingTrolleyChange(idx) {
  var sel = document.getElementById('dtThung_' + idx);
  var muongCell = document.getElementById('dtMuong_' + idx);
  var xhCell = document.getElementById('dtXH_' + idx);
  if (!sel) return;
  var tNo = parseInt(sel.value);
  var data = _getTrolleyB5Data();

  // Check own batch trolleys first
  if (tNo && data.trolleyMap[tNo]) {
    var muongs = data.trolleyMap[tNo];
    muongCell.textContent = muongs.length > 0 ? 'M' + muongs.join(', M') : '\u2014';
    xhCell.textContent = (data.xhTimeMap && data.xhTimeMap[tNo]) || '\u2014';
    return;
  }

  // Check transfer trolleys
  var transfer = _acceptedTransferTrolleys.find(function(t) { return t.trolleyNo === tNo; });
  if (transfer) {
    var mText = transfer.muongs.length > 0 ? 'M' + transfer.muongs.join(', M') : '\u2014';
    muongCell.innerHTML = mText + ' <span style="font-size:12px;color:var(--primary);">(\u2190' + transfer.fromDCLine + ')</span>';
    xhCell.textContent = transfer.xhTime || '\u2014';
    return;
  }

  muongCell.textContent = '\u2014';
  xhCell.textContent = '\u2014';
}

function autoPopulateDryingTrolleys() {
  // Try batch first, then line record linked batches
  var trolleys = null;
  var batch = batches.find(function(b) { return b.id === currentEditingBatchId; });
  if (batch) {
    trolleys = batch?.stageData?.taohat?.params?.trolleys || batch?.techParams?.trolleys;
  } else {
    // Line record: trolley data is in rec.stageData.taohat (steps 3-7 are on line records)
    var recId = (document.getElementById('lineRecordId') || {}).value || '';
    var rec = recId ? (window.lineRecords || []).find(function(r) { return r.id === recId; }) : null;
    if (rec) {
      trolleys = rec?.stageData?.taohat?.params?.trolleys || [];
    }
  }
  if (!trolleys || trolleys.length === 0) { showToast('Ch\u01B0a c\u00F3 d\u1EEF li\u1EC7u th\u00F9ng s\u1EA5y t\u1EEB B\u01B0\u1EDBc 5', 'warning'); return; }

  // Check trolleys already in OTHER DC lines' ovens (to prevent duplicates)
  var currentRecordId = (document.getElementById('lineRecordId') || {}).value || '';
  var inOtherOvens = {};
  (window.lineRecords || []).forEach(function(rec) {
    if (rec.id === currentRecordId) return;
    var td = rec.stageData && rec.stageData.say && rec.stageData.say.trolleyDrying;
    if (!td || !Array.isArray(td)) return;
    td.forEach(function(t) { if (t.trolleyNo) inOtherOvens[t.trolleyNo] = rec.productionLine || '?'; });
  });

  // Lấy danh sách thùng đã có trong bảng (giữ nguyên dữ liệu cũ)
  var existingTrolleys = {};
  document.querySelectorAll('#dryingTrolleyBody tr').forEach(function(row) {
    var sel = row.querySelector('select');
    if (sel && sel.value) existingTrolleys[parseInt(sel.value)] = true;
  });

  const trolleyNos = [];
  if (trolleys[0]?.boxMappings) {
    trolleys.forEach(function(t) { if (t.trolleyNo && trolleyNos.indexOf(t.trolleyNo) === -1) trolleyNos.push(t.trolleyNo); });
  } else {
    trolleys.forEach(function(t) { if (t.trolleyNo && trolleyNos.indexOf(t.trolleyNo) === -1) trolleyNos.push(t.trolleyNo); });
  }
  trolleyNos.sort(function(a, b) { return a - b; });
  var skipped = [];
  var addedCount = 0;
  trolleyNos.forEach(function(tNo) {
    if (existingTrolleys[tNo]) return; // đã có trong bảng → bỏ qua
    if (inOtherOvens[tNo]) {
      skipped.push('#' + tNo + ' (\u0111ang s\u1EA5y t\u1EA1i ' + inOtherOvens[tNo] + ')');
    } else {
      addDryingTrolleyRow(tNo);
      addedCount++;
    }
  });
  var existCount = Object.keys(existingTrolleys).length;
  if (addedCount === 0 && skipped.length === 0) {
    showToast('T\u1EA5t c\u1EA3 ' + existCount + ' th\u00F9ng \u0111\u00E3 c\u00F3 trong b\u1EA3ng', 'info');
  } else if (skipped.length > 0) {
    showToast('Th\u00EAm ' + addedCount + ' th\u00F9ng m\u1EDBi. B\u1ECF qua ' + skipped.length + ' th\u00F9ng DC kh\u00E1c: ' + skipped.join(', '), 'warning');
  } else {
    showToast('Th\u00EAm ' + addedCount + ' th\u00F9ng m\u1EDBi (gi\u1EEF nguy\u00EAn ' + existCount + ' th\u00F9ng c\u0169)');
  }
}

function refreshTransferableTrolleys() {
  var container = document.getElementById('transferTrolleyList');
  if (!container) return;
  var available = getTransferableTrolleys();
  if (available.length === 0) {
    container.innerHTML = '<div style="padding:4px 0;color:var(--text-muted);font-size:12px;">Kh\u00F4ng c\u00F3 th\u00F9ng t\u1EEB DC kh\u00E1c</div>';
    return;
  }
  var html = '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;">';
  available.forEach(function(t) {
    var mText = t.muongs.length > 0 ? 'M' + t.muongs.join(',M') : '';
    html += '<div style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;background:var(--bg-tertiary);border:1px solid var(--border);border-radius:6px;font-size:12px;">';
    html += '<strong>#' + t.trolleyNo + '</strong>';
    html += '<span style="color:var(--text-muted);">t\u1EEB ' + t.fromDCLine + (mText ? ' \u00B7 ' + mText : '') + '</span>';
    html += '<button type="button" onclick="acceptTransferTrolley(' + t.trolleyNo + ',\'' + t.fromRecordId + '\',\'' + t.fromDCLine + '\')" style="font-size:12px;padding:2px 8px;border-radius:4px;border:1px solid rgba(34,197,94,0.4);background:rgba(34,197,94,0.1);color:#22c55e;cursor:pointer;font-weight:600;">Nh\u1EADn</button>';
    html += '</div>';
  });
  html += '</div>';
  container.innerHTML = html;
}

function acceptTransferTrolley(trolleyNo, fromRecordId, fromDCLine) {
  // Find full info from available trolleys
  var available = getTransferableTrolleys();
  var info = available.find(function(t) { return t.trolleyNo === trolleyNo && t.fromRecordId === fromRecordId; });
  if (!info) { showToast('Th\u00F9ng kh\u00F4ng c\u00F2n kh\u1EA3 d\u1EE5ng', 'warning'); return; }

  // Add to accepted list
  _acceptedTransferTrolleys.push(info);

  // Add drying row for this trolley
  addDryingTrolleyRow(trolleyNo);

  // Update the row's muong and XH display to show transfer origin
  var rows = document.querySelectorAll('#dryingTrolleyBody tr');
  var lastRow = rows[rows.length - 1];
  if (lastRow) {
    var rowIdx = lastRow.id.replace('dtrow_', '');
    // Muong cell
    var muongCell = document.getElementById('dtMuong_' + rowIdx);
    if (muongCell) {
      var mText = info.muongs.length > 0 ? 'M' + info.muongs.join(', M') : '\u2014';
      muongCell.innerHTML = mText + ' <span style="font-size:12px;color:var(--primary);">(\u2190' + fromDCLine + ')</span>';
    }
    // XH cell
    var xhCell = document.getElementById('dtXH_' + rowIdx);
    if (xhCell && info.xhTime) {
      xhCell.textContent = info.xhTime;
    }
    // Mark row as transfer
    lastRow.dataset.transferFrom = fromRecordId;
    lastRow.dataset.transferDCLine = fromDCLine;
  }

  showToast('Nh\u1EADn th\u00F9ng #' + trolleyNo + ' t\u1EEB ' + fromDCLine, 'success');
  refreshTransferableTrolleys(); // Refresh list
}

function addDryingTrolleyRow(trolleyNo, timeIn, timeOut, shiftInData, shiftOutData, exitConfirmed, overnight) {
  const tbody = document.getElementById('dryingTrolleyBody');
  if (!tbody) return;
  const idx = _dryTrolleyCounter++;
  const opts = getDryingTrolleyOptions();
  const data = _getTrolleyB5Data();
  let muongText = '—', xhText = (trolleyNo && data.xhTimeMap && data.xhTimeMap[trolleyNo]) || '—';
  if (trolleyNo && data.trolleyMap[trolleyNo]) {
    var m = data.trolleyMap[trolleyNo];
    if (m.length > 0) muongText = 'M' + m.join(', M');
  }
  // Fallback: check _acceptedTransferTrolleys for transferred trolleys' muong/XH
  if (trolleyNo && (muongText === '—' || xhText === '—')) {
    var transferInfo = _acceptedTransferTrolleys.find(function(t) { return t.trolleyNo === trolleyNo; });
    if (transferInfo) {
      if (muongText === '—' && transferInfo.muongs && transferInfo.muongs.length > 0) {
        muongText = 'M' + transferInfo.muongs.join(', M');
      }
      if (xhText === '—' && transferInfo.xhTime) {
        xhText = transferInfo.xhTime;
      }
    }
  }
  var confirmedCls = exitConfirmed ? ' confirmed' : '';
  var readonlyAttr = exitConfirmed ? ' readonly style="background:rgba(16,185,129,0.1);border-color:var(--success);"' : '';
  let html = '<tr id="dtrow_' + idx + '">';
  html += '<td style="background:var(--bg-tertiary);font-weight:600;color:var(--text-secondary);"><select id="dtThung_' + idx + '" onchange="onDryingTrolleyChange(' + idx + ')" style="width:100%;">' + opts + '</select></td>';
  html += '<td id="dtMuong_' + idx + '" style="font-size:12px;color:var(--text-secondary);white-space:nowrap;">' + muongText + '</td>';
  html += '<td id="dtXH_' + idx + '" style="font-size:12px;color:var(--text-secondary);white-space:nowrap;">' + (trolleyNo ? xhText : '\u2014') + '</td>';
  html += '<td><input type="text" id="dtIn_' + idx + '" class="time24" value="' + (timeIn || '') + '" placeholder="HH:MM" maxlength="5" oninput="formatTimeInput(this)" onblur="handleDryingTimeBlur(' + idx + ',\'in\')"></td>';
  html += '<td id="dtShiftInCell_' + idx + '">' + _renderTrolleyShiftCell(idx, 'in', shiftInData) + '</td>';
  html += '<td><div class="dt-out-cell">';
  html += '<input type="text" id="dtOut_' + idx + '" class="time24" value="' + (timeOut || '') + '" placeholder="HH:MM" maxlength="5" oninput="formatTimeInput(this)" onblur="handleDryingTimeBlur(' + idx + ',\'out\')"' + readonlyAttr + '>';
  html += '<button type="button" id="dtConfirm_' + idx + '" class="trolley-confirm-btn' + confirmedCls + '" onclick="confirmTrolleyExit(' + idx + ')" title="X\u00e1c nh\u1eadn \u0111\u00e3 ra l\u00f2">\u2713</button>';
  html += '</div></td>';
  html += '<td id="dtShiftOutCell_' + idx + '">' + _renderTrolleyShiftCell(idx, 'out', shiftOutData) + '</td>';
  html += '<td id="dtHeat_' + idx + '" class="trolley-heat-cell" style="text-align:center;white-space:nowrap;font-size:12px;">\u2014</td>';
  html += '<td><button type="button" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:16px;" onclick="removeDryingTrolleyRow(' + idx + ')">×</button></td>';
  html += '</tr>';
  tbody.insertAdjacentHTML('beforeend', html);
  if (trolleyNo) {
    var sel = document.getElementById('dtThung_' + idx);
    if (sel) {
      // Ensure option exists (for overnight records without B5 data)
      if (!sel.querySelector('option[value="' + trolleyNo + '"]')) {
        var opt = document.createElement('option');
        opt.value = trolleyNo;
        opt.textContent = '#' + trolleyNo;
        sel.appendChild(opt);
      }
      sel.value = trolleyNo;
    }
  }
  if (exitConfirmed) {
    var row = document.getElementById('dtrow_' + idx);
    if (row) row.dataset.exitConfirmed = 'true';
  }
  if (overnight) {
    var oRow = document.getElementById('dtrow_' + idx);
    if (oRow) { oRow.dataset.overnight = 'true'; oRow.classList.add('trolley-overnight'); }
  }
  // Always re-resolve shifts from current schedule (handles overnight detection)
  if (timeIn) try { onTrolleyTimeChange(idx, 'in'); } catch(e) {}
  if (timeOut) try { onTrolleyTimeChange(idx, 'out'); } catch(e) {}
}

function removeDryingTrolleyRow(idx) {
  const row = document.getElementById('dtrow_' + idx);
  if (row) row.remove();
}

function confirmTrolleyExit(idx) {
  var row = document.getElementById('dtrow_' + idx);
  var btn = document.getElementById('dtConfirm_' + idx);
  var outInput = document.getElementById('dtOut_' + idx);
  if (!row || !btn) return;

  var isConfirmed = row.dataset.exitConfirmed === 'true';

  if (!isConfirmed) {
    if (!outInput || !outInput.value || !/^\d{2}:\d{2}$/.test(outInput.value)) {
      showToast('Nh\u1EADp gi\u1EDD ra tr\u01B0\u1EDBc khi x\u00E1c nh\u1EADn', 'error');
      return;
    }
    row.dataset.exitConfirmed = 'true';
    btn.classList.add('confirmed');
    if (outInput) {
      outInput.readOnly = true;
      outInput.style.background = 'rgba(16,185,129,0.1)';
      outInput.style.borderColor = 'var(--success)';
    }
  } else {
    delete row.dataset.exitConfirmed;
    btn.classList.remove('confirmed');
    if (outInput) {
      outInput.readOnly = false;
      outInput.style.background = '';
      outInput.style.borderColor = '';
    }
  }
}

function formatTimeInput(el) {
  var v = el.value.replace(/[^\d]/g, '');
  if (v.length > 4) v = v.substring(0, 4);
  if (v.length >= 3) {
    el.value = v.substring(0, 2) + ':' + v.substring(2);
  } else {
    el.value = v;
  }
}

/**
 * Auto-fill "Vào lò" (entry times) for trolleys based on exit interval.
 * Trolley 1 = base time, Trolley 2 = base + interval, Trolley 3 = base + 2*interval...
 * Confirmed trolleys (✓) are skipped — their entry time is locked.
 */
function autoFillEntryTimes() {
  var interval = parseInt((document.getElementById('ovenExitInterval') || {}).value) || 0;
  if (interval <= 0) return;

  var rows = document.querySelectorAll('#dryingTrolleyBody tr');
  if (!rows || rows.length === 0) return;

  // Find first trolley with a valid entry time as base
  var baseMins = null;
  var baseRowIndex = -1;
  for (var i = 0; i < rows.length; i++) {
    var rowId = rows[i].id.replace('dtrow_', '');
    var inInput = document.getElementById('dtIn_' + rowId);
    if (inInput && /^\d{2}:\d{2}$/.test(inInput.value)) {
      baseMins = timeToMinutes(inInput.value);
      baseRowIndex = i;
      break;
    }
  }
  if (baseMins === null) return;

  // Fill subsequent trolleys
  for (var j = baseRowIndex + 1; j < rows.length; j++) {
    var row = rows[j];
    var rowId = row.id.replace('dtrow_', '');

    // Skip confirmed trolleys — entry time locked
    if (row.dataset.exitConfirmed === 'true') continue;

    var inInput = document.getElementById('dtIn_' + rowId);
    if (!inInput) continue;

    var newMins = baseMins + interval * (j - baseRowIndex);
    var hh = String(Math.floor(newMins / 60) % 24).padStart(2, '0');
    var mm = String(newMins % 60).padStart(2, '0');
    inInput.value = hh + ':' + mm;

    // Trigger shift resolution + heat calc
    try { onTrolleyTimeChange(parseInt(rowId), 'in'); } catch(e) {}
    try { updateTrolleyHeat(parseInt(rowId)); } catch(e) {}
  }
  try { updateOvenSummary(); } catch(e) {}
}

function generateTempTimeSlots() {
  var ovenStart = (document.getElementById('ovenStartTime') || {}).value || '';
  var ovenShutdown = (document.getElementById('ovenShutdownTime') || {}).value || '';
  if (!/^\d{2}:\d{2}$/.test(ovenStart) || !/^\d{2}:\d{2}$/.test(ovenShutdown)) {
    showToast('Nh\u1EADp gi\u1EDD m\u1EDF l\u00F2 v\u00E0 gi\u1EDD t\u1EAFt l\u00F2 tr\u01B0\u1EDBc \u0111\u1EC3 t\u1EF1 sinh d\u00F2ng nhi\u1EC7t \u0111\u1ED9', 'warning');
    return;
  }
  var startMins = _ovenTimeToMins(ovenStart);
  var endMins = _ovenTimeToMins(ovenShutdown);
  if (startMins === null || endMins === null || endMins <= startMins) {
    showToast('Gi\u1EDD m\u1EDF l\u00F2 ph\u1EA3i tr\u01B0\u1EDBc gi\u1EDD t\u1EAFt l\u00F2', 'warning');
    return;
  }
  const tbody = document.getElementById('tempLogBody');
  if (tbody) tbody.innerHTML = '';
  _tempRowCounter = 0;
  var count = 0;
  for (var mins = startMins; mins <= endMins; mins += 10) {
    var hh = String(Math.floor(mins / 60) % 24).padStart(2, '0');
    var mm = String(mins % 60).padStart(2, '0');
    addTempRow(hh + ':' + mm);
    count++;
  }
  var duration = endMins - startMins;
  var dH = Math.floor(duration / 60);
  var dM = duration % 60;
  showToast('\u0110\u00E3 t\u1EA1o ' + count + ' d\u00F2ng nhi\u1EC7t \u0111\u1ED9 (' + dH + 'h' + (dM > 0 ? dM + 'm' : '') + ' t\u1EEB ' + ovenStart + ' \u0111\u1EBFn ' + ovenShutdown + ')');
}

function addTempRow(time, burner1, burner2) {
  const tbody = document.getElementById('tempLogBody');
  if (!tbody) return;
  const idx = _tempRowCounter++;
  let html = '<tr id="tmprow_' + idx + '">';
  html += '<td><input type="text" id="tmpTime_' + idx + '" class="time24" value="' + (time || '') + '" placeholder="HH:MM" maxlength="5" oninput="formatTimeInput(this)" style="text-align:center;"></td>';
  html += '<td><input type="number" id="tmpB1_' + idx + '" step="0.1" placeholder="°C" value="' + (burner1 != null ? burner1 : '') + '" onchange="checkTempRange(this)"></td>';
  html += '<td><input type="number" id="tmpB2_' + idx + '" step="0.1" placeholder="°C" value="' + (burner2 != null ? burner2 : '') + '" onchange="checkTempRange(this)"></td>';
  html += '<td><button type="button" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:16px;" onclick="removeTempRow(' + idx + ')">×</button></td>';
  html += '</tr>';
  tbody.insertAdjacentHTML('beforeend', html);
}

function removeTempRow(idx) {
  const row = document.getElementById('tmprow_' + idx);
  if (row) row.remove();
}

function checkTempRange(input) {
  const val = parseFloat(input.value);
  if (isNaN(val)) { input.classList.remove('param-warning','param-ok'); return; }
  const fuel = document.getElementById('paramNhienLieu')?.value;
  const maxTemp = fuel === 'biomass' ? 125 : 120;
  input.classList.toggle('param-warning', val > maxTemp);
  input.classList.toggle('param-ok', val <= maxTemp);
}

// ==================== SHIFT RESOLUTION (Per-Trolley) ====================
var _cachedLineSchedules = null;  // { muNuoc: [...], muTap: [...] }
var _cachedNextDaySchedules = null;  // { muNuoc: [...], muTap: [...] }

// ==================== SHIFT-BASED ACCESS CONTROL ====================
var _userShiftCodeCache = undefined;
var _userShiftCodeCacheUserId = null;
var _currentShiftAccess = null;

/**
 * Get current user's production shift code from their department.
 * Returns shift code (e.g. "CSX1") if user belongs to a ca_sx department.
 * Returns null if user is not a ca_sx member (management, admin, etc.).
 */
async function getUserShiftCode() {
  var user = window.currentUser;
  if (!user) return null;
  if (_userShiftCodeCacheUserId === (user.id || '') && _userShiftCodeCache !== undefined) {
    return _userShiftCodeCache;
  }
  _userShiftCodeCacheUserId = user.id || '';
  if (!user.department) { _userShiftCodeCache = null; return null; }
  try {
    var doc = await ErpDb.firestore().collection('categoryDepartments').doc(user.department).get();
    if (doc.exists) {
      var data = doc.data();
      if (data.type === 'ca_sx') {
        _userShiftCodeCache = data.code || null;
        return _userShiftCodeCache;
      }
    }
  } catch (e) { console.warn('[ShiftAuth] Error:', e); }
  _userShiftCodeCache = null;
  return null;
}

/**
 * Get DC lines the user is allowed to work on based on shift schedule.
 */
function getUserAllowedDCLines(userShiftCode) {
  if (!userShiftCode || !_cachedLineSchedules) return [];
  var allowedGroups = [];
  Object.keys(_cachedLineSchedules).forEach(function(groupId) {
    var shifts = _cachedLineSchedules[groupId] || [];
    if (shifts.some(function(s) { return s.code === userShiftCode && s.active !== false; })) {
      allowedGroups.push(groupId);
    }
  });
  var factory = window.currentFactory;
  var allDC = SanxuatStages.getDCLinesForFactory(factory);
  return allDC.filter(function(dc) { return allowedGroups.indexOf(dc.lineGroup) !== -1; }).map(function(dc) { return dc.id; });
}

/**
 * Check if current user can create/edit line records.
 * Admin, supervisor, and non-ca_sx users bypass restrictions.
 * @returns {Promise<{allowed:boolean, shiftCode:string|null, allowedDCLines:string[], reason:string}>}
 */
async function canUserAccessLineRecord() {
  // Admin/supervisor bypass
  if (typeof Permissions !== 'undefined' && (Permissions.isGlobalAdmin() || Permissions.hasAnyAppRole('sanxuat', ['admin', 'supervisor']))) {
    return { allowed: true, shiftCode: null, allowedDCLines: [], reason: 'admin' };
  }
  var shiftCode = await getUserShiftCode();
  // Non-ca_sx users (management, etc.) → bypass like admin
  if (shiftCode === null) {
    return { allowed: true, shiftCode: null, allowedDCLines: [], reason: 'admin' };
  }
  // User belongs to a ca_sx → check schedule
  if (!_cachedLineSchedules) {
    return { allowed: false, shiftCode: shiftCode, allowedDCLines: [], reason: 'Ch\u01B0a c\u00F3 l\u1ECBch ca cho ng\u00E0y n\u00E0y. Vui l\u00F2ng l\u01B0u l\u1ECBch ca tr\u01B0\u1EDBc.' };
  }
  var dcLines = getUserAllowedDCLines(shiftCode);
  if (dcLines.length === 0) {
    return { allowed: false, shiftCode: shiftCode, allowedDCLines: [], reason: 'Ca c\u1EE7a b\u1EA1n kh\u00F4ng \u0111\u01B0\u1EE3c ph\u00E2n c\u00F4ng trong l\u1ECBch ng\u00E0y n\u00E0y' };
  }
  return { allowed: true, shiftCode: shiftCode, allowedDCLines: dcLines, reason: 'shift' };
}

async function _refreshShiftAccess() {
  _currentShiftAccess = await canUserAccessLineRecord();
  // Re-render dashboard so buttons reflect updated access
  if (typeof renderStepDashboard === 'function' && typeof TabMES !== 'undefined') {
    renderStepDashboard(TabMES.getCurrentStage ? TabMES.getCurrentStage() : 'canmu');
  }
}

function timeToMinutes(timeStr) {
  if (!timeStr || !/^([01]\d|2[0-3]):[0-5]\d$/.test(timeStr)) return null;
  var parts = timeStr.split(':');
  return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

function resolveShiftFromTime(time, schedule) {
  if (!time || !schedule || schedule.length === 0) return null;
  var mins = timeToMinutes(time);
  if (mins === null) return null;
  for (var i = 0; i < schedule.length; i++) {
    var s = schedule[i];
    var start = timeToMinutes(s.startTime);
    var end = timeToMinutes(s.endTime);
    if (start === null || end === null) continue;
    if (start < end) {
      if (mins >= start && mins < end) return { code: s.code, name: s.name };
    } else {
      // Overnight shift (e.g. 22:00-06:00)
      if (mins >= start || mins < end) return { code: s.code, name: s.name };
    }
  }
  return null;
}

function getScheduleForOven(ovenId) {
  if (!_cachedLineSchedules) return null;
  var groupId = SanxuatStages.getLineGroupForOven(currentFactory, ovenId);
  if (!groupId) return null;
  var schedule = _cachedLineSchedules[groupId];
  return schedule && schedule.length > 0 ? schedule : null;
}

function _getNextDayScheduleForOven(ovenId) {
  if (!_cachedNextDaySchedules) return null;
  var groupId = SanxuatStages.getLineGroupForOven(currentFactory, ovenId);
  if (!groupId) return null;
  var schedule = _cachedNextDaySchedules[groupId];
  return schedule && schedule.length > 0 ? schedule : null;
}

function _getNextDateStr(dateStr) {
  var d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function _getPrevDateStr(dateStr) {
  var d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function _buildShiftSelect(id, selectedCode) {
  var shifts = _getSXShiftsCached();
  var h = '<select id="' + id + '" class="trolley-shift-select">';
  h += '<option value="">\u2013</option>';
  shifts.forEach(function(s) {
    h += '<option value="' + s.code + '"' + (s.code === selectedCode ? ' selected' : '') + '>' + s.name + '</option>';
  });
  h += '</select>';
  return h;
}

function _renderTrolleyShiftCell(rowIdx, direction, shiftData) {
  var prefix = direction === 'in' ? 'dtShiftIn' : 'dtShiftOut';
  if (shiftData && shiftData.code) {
    var resolvedDot = shiftData.resolved ? '<span class="trolley-shift-resolved" title="T\u1EF1 \u0111\u1ED9ng">\u25CF</span> ' : '';
    var nextDayIcon = shiftData.fromNextDay ? '<span class="trolley-shift-nextday" title="Ca theo l\u1ECBch ng\u00E0y k\u1EBF ti\u1EBFp">\u2600</span>' : '';
    return '<div class="trolley-shift-display" id="' + prefix + 'Display_' + rowIdx + '" onclick="toggleTrolleyShiftEdit(' + rowIdx + ',\'' + direction + '\')" title="B\u1EA5m \u0111\u1EC3 thay \u0111\u1ED5i">' +
      resolvedDot + '<span class="trolley-shift-badge">' + shiftData.name + '</span>' + nextDayIcon +
      '<input type="hidden" id="' + prefix + '_' + rowIdx + '" value="' + shiftData.code + '">' +
      '<input type="hidden" id="' + prefix + 'NextDay_' + rowIdx + '" value="' + (shiftData.fromNextDay ? '1' : '') + '">' +
      '</div>';
  }
  return _buildShiftSelect(prefix + '_' + rowIdx, '');
}

// Wrapper cho onblur — mỗi bước chạy trong try-catch riêng
function handleDryingTimeBlur(rowIdx, direction) {
  try { onTrolleyTimeChange(rowIdx, direction); } catch(e) { console.error('onTrolleyTimeChange error:', e); }
  try { updateTrolleyHeat(rowIdx); } catch(e) {}
  try { updateOvenSummary(); } catch(e) {}
  try { validateTrolleyTimeRange(rowIdx); } catch(e) {}
  // Auto-fill entry times for subsequent trolleys when "Vào lò" changes
  if (direction === 'in') {
    try { autoFillEntryTimes(); } catch(e) {}
  }
}

function _getScheduleEndTime(schedule) {
  if (!schedule || schedule.length === 0) return null;
  var maxEnd = null;
  for (var i = 0; i < schedule.length; i++) {
    var end = timeToMinutes(schedule[i].endTime);
    if (end !== null && (maxEnd === null || end > maxEnd)) maxEnd = end;
  }
  return maxEnd;
}

function onTrolleyTimeChange(rowIdx, direction) {
  var timeId = direction === 'in' ? 'dtIn_' + rowIdx : 'dtOut_' + rowIdx;
  var timeInput = document.getElementById(timeId);
  var timeVal = (timeInput || {}).value || '';
  var ovenId = (document.getElementById('ovenSelect') || {}).value || '';
  var schedule = getScheduleForOven(ovenId);
  if (!schedule || !/^\d{2}:\d{2}$/.test(timeVal)) return;

  // Overnight trolleys' entry time: still resolve shift but skip validation
  var _trolleyRow = document.getElementById('dtrow_' + rowIdx);
  var _isOvernight = _trolleyRow && _trolleyRow.dataset.overnight === 'true';
  if (_isOvernight && direction === 'in') {
    // If saved shift data already rendered (display div exists), keep it
    var existingDisplay = document.getElementById('dtShiftInDisplay_' + rowIdx);
    if (!existingDisplay) {
      // No saved shift — resolve from current schedule as fallback
      var resolved = resolveShiftFromTime(timeVal, schedule);
      if (resolved) {
        var cell = document.getElementById('dtShiftInCell_' + rowIdx);
        if (cell) cell.innerHTML = _renderTrolleyShiftCell(rowIdx, direction, { code: resolved.code, name: resolved.name, resolved: true });
      }
    }
    return; // Skip validation — entry time is from yesterday
  }

  // Chỉ resolve theo lịch ca của ngày hiện tại — không dùng lịch ngày kế
  var resolved = resolveShiftFromTime(timeVal, schedule);

  // Validate giờ ra lò: phải nằm trong lịch ca ngày hiện tại
  if (direction === 'out' && !resolved) {
    var endMins = _getScheduleEndTime(schedule);
    var endTimeStr = endMins != null ? _ovenMinsToTime(endMins) : '';
    var msg = 'Gi\u1EDD ra l\u00F2 ' + timeVal + ' n\u1EB1m ngo\u00E0i l\u1ECBch ca s\u1EA3n xu\u1EA5t';
    if (endTimeStr) msg += ' (ca cu\u1ED1i k\u1EBFt th\u00FAc l\u00FAc ' + endTimeStr + ')';
    showToast(msg, 'error');
    if (timeInput) {
      timeInput.value = '';
      timeInput.style.borderColor = 'var(--danger)';
      setTimeout(function() { timeInput.style.borderColor = ''; }, 3000);
    }
    return;
  }

  var prefix = direction === 'in' ? 'dtShiftIn' : 'dtShiftOut';
  var cell = document.getElementById(prefix + 'Cell_' + rowIdx);
  var shiftData = resolved ? { code: resolved.code, name: resolved.name, resolved: true } : null;
  if (cell) {
    cell.innerHTML = _renderTrolleyShiftCell(rowIdx, direction, shiftData);
  }
}

function _resolveAllTrolleyShifts() {
  var rows = document.querySelectorAll('#dryingTrolleyBody tr');
  if (!rows || rows.length === 0) return;
  rows.forEach(function(row) {
    var rowId = parseInt(row.id.replace('dtrow_', ''));
    if (isNaN(rowId)) return;
    try { onTrolleyTimeChange(rowId, 'in'); } catch(e) {}
    try { onTrolleyTimeChange(rowId, 'out'); } catch(e) {}
  });
}

function _updateTrolleyOvernightStatus(rowIdx, isOvernight) {
  var row = document.getElementById('dtrow_' + rowIdx);
  if (!row) return;
  if (isOvernight) {
    row.dataset.overnight = 'true';
    row.classList.add('trolley-overnight');
  } else {
    delete row.dataset.overnight;
    row.classList.remove('trolley-overnight');
  }
  _updateOvernightBadge(rowIdx, isOvernight);
  _updateOvernightSummary();
}

function _updateOvernightBadge(rowIdx, isOvernight) {
  var cell = document.getElementById('dtHeat_' + rowIdx);
  if (!cell) return;
  var existing = cell.querySelector('.heat-badge.overnight');
  if (existing) existing.remove();
  if (isOvernight) {
    var badge = document.createElement('div');
    badge.className = 'heat-badge overnight';
    badge.textContent = 'QN';
    badge.title = 'Qua ng\u00E0y \u2014 th\u00F9ng n\u1EB1m l\u1EA1i trong l\u00F2 qua ng\u00E0y';
    cell.appendChild(badge);
  }
}

function _updateOvernightSummary() {
  var container = document.getElementById('overnightTrolleySummary');
  if (!container) return;
  var rows = document.querySelectorAll('#dryingTrolleyBody tr[data-overnight="true"]');
  if (rows.length === 0) { container.style.display = 'none'; return; }
  var nums = [];
  rows.forEach(function(r) { var s = r.querySelector('select'); if (s && s.value) nums.push('T' + s.value); });
  var hasNextSchedule = _cachedNextDaySchedules && Object.keys(_cachedNextDaySchedules).some(function(k) {
    return _cachedNextDaySchedules[k] && _cachedNextDaySchedules[k].length > 0;
  });
  var msg = '<strong>\u26A0 Qua ng\u00E0y:</strong> ' + rows.length + ' th\u00F9ng (' + nums.join(', ') + ')';
  if (hasNextSchedule) {
    msg += ' \u2014 ca ra theo l\u1ECBch ng\u00E0y k\u1EBF ti\u1EBFp';
  } else {
    msg += ' \u2014 <span style="color:#ef4444;">ch\u01B0a c\u00F3 l\u1ECBch ng\u00E0y k\u1EBF ti\u1EBFp, vui l\u00F2ng t\u1EA1o l\u1ECBch ca</span>';
  }
  container.style.display = '';
  container.innerHTML = msg;
}

// ==================== OVEN CYCLE & HEAT EXPOSURE ====================

function updateTrolleyWaitingCount() {
  var total = parseInt((document.getElementById('paramSoThungSayDC') || {}).value) || 0;
  var inOven = parseInt((document.getElementById('paramSoThungTrongLo') || {}).value) || 0;
  var waiting = Math.max(0, total - inOven);
  var hint = document.getElementById('trolleyWaitingHint');
  if (hint) hint.textContent = 'Th\u00F9ng ch\u1EDD v\u00E0o l\u00F2: ' + waiting;
}

function _ovenTimeToMins(str) {
  if (!str || !/^\d{2}:\d{2}$/.test(str)) return null;
  var p = str.split(':');
  return parseInt(p[0]) * 60 + parseInt(p[1]);
}

function _ovenMinsToTime(mins) {
  if (mins === null || mins === undefined) return '';
  mins = ((mins % 1440) + 1440) % 1440;
  return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
}

function _ovenFormatDuration(mins) {
  if (mins === null || mins === undefined || isNaN(mins)) return '\u2014';
  var h = Math.floor(mins / 60);
  var m = mins % 60;
  if (h > 0) return h + 'h ' + m + 'm';
  return m + 'm';
}

function getTrolleyHeatInfo(rowIdx) {
  var timeIn = (document.getElementById('dtIn_' + rowIdx) || {}).value || '';
  var timeOut = (document.getElementById('dtOut_' + rowIdx) || {}).value || '';
  var ovenStart = (document.getElementById('ovenStartTime') || {}).value || '';
  var ovenReady = (document.getElementById('ovenReadyTime') || {}).value || '';
  var ovenShutdown = (document.getElementById('ovenShutdownTime') || {}).value || '';

  var result = { duration: null, status: 'normal', badges: [] };
  if (!timeIn && !timeOut) return result;

  var inMins = _ovenTimeToMins(timeIn);
  var outMins = _ovenTimeToMins(timeOut);
  var startMins = _ovenTimeToMins(ovenStart);
  var readyMins = _ovenTimeToMins(ovenReady);
  var shutdownMins = _ovenTimeToMins(ovenShutdown);

  // Heat start = max(timeIn, ovenStartTime)
  var heatStart = inMins;
  if (startMins !== null && inMins !== null && inMins < startMins) {
    heatStart = startMins;
  }

  // Heat end = timeOut, or ovenShutdownTime if no exit
  var heatEnd = outMins;
  if (outMins === null && shutdownMins !== null) {
    heatEnd = shutdownMins;
    result.status = 'shutdown';
    result.badges.push('N\u1EB1m l\u1EA1i l\u00F2');
  }

  // Warmup detection: timeIn < ovenReadyTime
  if (readyMins !== null && inMins !== null && inMins < readyMins) {
    result.badges.push('Ch\u1ECBu nhi\u1EC7t K\u0110');
    if (result.status === 'shutdown') result.status = 'both';
    else result.status = 'warmup';
  }

  // Shutdown detection: no timeOut, or still in oven at shutdown
  if (shutdownMins !== null && outMins === null) {
    if (result.badges.indexOf('N\u1EB1m l\u1EA1i l\u00F2') === -1) result.badges.push('N\u1EB1m l\u1EA1i l\u00F2');
    if (result.status === 'warmup') result.status = 'both';
    else if (result.status === 'normal') result.status = 'shutdown';
  }

  // Calculate duration
  // For overnight trolleys: heat = (timeIn → yesterday's shutdown) + (today's ovenStart → timeOut)
  var _row = document.getElementById('dtrow_' + rowIdx);
  var _isOvernight = _row && _row.dataset.overnight === 'true';
  if (_isOvernight && inMins !== null && outMins !== null && shutdownMins !== null && startMins !== null) {
    // Yesterday: from entry to shutdown
    var d1 = shutdownMins - inMins;
    if (d1 < 0) d1 += 1440;
    // Today: from oven start to exit
    var d2 = outMins - startMins;
    if (d2 < 0) d2 = 0;
    result.duration = d1 + d2;
    result.badges.push('Qua \u0111\u00EAm');
  } else if (_isOvernight && inMins !== null && shutdownMins !== null && outMins === null) {
    // Still in oven today, show yesterday's heat + today so far
    var d1 = shutdownMins - inMins;
    if (d1 < 0) d1 += 1440;
    var d2 = heatEnd !== null && startMins !== null ? (heatEnd - startMins) : 0;
    if (d2 < 0) d2 = 0;
    result.duration = d1 + d2;
    result.badges.push('Qua \u0111\u00EAm');
  } else if (heatStart !== null && heatEnd !== null) {
    var dur = heatEnd - heatStart;
    if (dur < 0) dur += 1440;
    result.duration = dur;
  } else if (inMins !== null && outMins !== null) {
    // Fallback: simple timeOut - timeIn
    var dur = outMins - inMins;
    if (dur < 0) dur += 1440;
    result.duration = dur;
  }

  return result;
}

function updateTrolleyHeat(rowIdx) {
  var cell = document.getElementById('dtHeat_' + rowIdx);
  if (!cell) return;
  var info = getTrolleyHeatInfo(rowIdx);

  if (info.duration === null) { cell.innerHTML = '\u2014'; cell.className = 'trolley-heat-cell'; return; }

  var text = _ovenFormatDuration(info.duration);
  var cls = 'trolley-heat-cell';
  var badgeHtml = '';

  if (info.status === 'warmup') {
    cls += ' heat-warmup';
    badgeHtml = '<div class="heat-badge warmup">K\u0110</div>';
  } else if (info.status === 'shutdown') {
    cls += ' heat-shutdown';
    badgeHtml = '<div class="heat-badge shutdown">TL</div>';
  } else if (info.status === 'both') {
    cls += ' heat-both';
    badgeHtml = '<div class="heat-badge both">K\u0110+TL</div>';
  }

  cell.className = cls;
  cell.innerHTML = '<span class="heat-duration">' + text + '</span>' + badgeHtml;
  cell.title = info.badges.join(' \u00B7 ');

  // Preserve overnight badge if row is marked overnight
  var row = document.getElementById('dtrow_' + rowIdx);
  if (row && row.dataset.overnight === 'true') _updateOvernightBadge(rowIdx, true);
}

function updateAllTrolleyHeat() {
  document.querySelectorAll('#dryingTrolleyBody tr').forEach(function(row) {
    var rowId = row.id.replace('dtrow_', '');
    updateTrolleyHeat(parseInt(rowId));
  });
}

// Auto-fill giờ ra lò = giờ vào lò của thùng + (tổng số thùng × chu kỳ)
// Không vượt quá giờ kết thúc ca cuối trong ngày
function autoFillExitTimes() {
  var interval = parseInt((document.getElementById('ovenExitInterval') || {}).value) || 0;
  if (interval <= 0) return;

  var rows = document.querySelectorAll('#dryingTrolleyBody tr');
  if (!rows || rows.length === 0) return;
  var totalTrolleys = parseInt((document.getElementById('paramSoThungTrongLo') || {}).value) || parseInt((document.getElementById('paramSoThungSayDC') || {}).value) || rows.length;
  var dryingTime = totalTrolleys * interval; // tổng thời gian sấy = số thùng trong lò × chu kỳ

  // Lấy giờ kết thúc ca cuối từ lịch sản xuất
  var ovenId = (document.getElementById('ovenSelect') || {}).value || '';
  var schedule = getScheduleForOven(ovenId);
  var scheduleEndMins = _getScheduleEndTime(schedule);

  var overflowCount = 0;
  for (var j = 0; j < rows.length; j++) {
    var row = rows[j];
    var rowId = row.id.replace('dtrow_', '');

    // Bỏ qua thùng đã xác nhận ra lò
    if (row.dataset.exitConfirmed === 'true') continue;

    var outInput = document.getElementById('dtOut_' + rowId);
    var inInput = document.getElementById('dtIn_' + rowId);
    if (!outInput || !inInput) continue;

    var inMins = timeToMinutes(inInput.value);
    if (inMins === null) continue;

    // Ra lò = giờ vào lò + (tổng số thùng × chu kỳ)
    var exitMins = inMins + dryingTime;

    // Nếu vượt quá giờ kết thúc ca → để trống (trong lò)
    if (scheduleEndMins !== null && exitMins > scheduleEndMins) {
      outInput.value = '';
      overflowCount++;
    } else {
      var hh = String(Math.floor(exitMins / 60) % 24).padStart(2, '0');
      var mm = String(exitMins % 60).padStart(2, '0');
      outInput.value = hh + ':' + mm;
    }

    try { onTrolleyTimeChange(parseInt(rowId), 'out'); } catch(e) {}
    try { updateTrolleyHeat(parseInt(rowId)); } catch(e) {}
  }

  var endTimeStr = scheduleEndMins !== null ? _ovenMinsToTime(scheduleEndMins) : '';
  if (overflowCount > 0) {
    showToast(overflowCount + ' th\u00F9ng v\u01B0\u1EE3t qu\u00E1 ca SX (' + endTimeStr + ') \u2192 gi\u1EEF trong l\u00F2', 'warning');
  } else {
    showToast('\u0110\u00E3 t\u00EDnh gi\u1EDD ra l\u00F2 cho ' + rows.length + ' th\u00F9ng (chu k\u1EF3 ' + interval + ' ph\u00FAt)', 'success');
  }
  try { updateOvenSummary(); } catch(e) {}
}

function updateOvenSummary() {
  var startMins = _ovenTimeToMins((document.getElementById('ovenStartTime') || {}).value || '');
  var readyMins = _ovenTimeToMins((document.getElementById('ovenReadyTime') || {}).value || '');
  var shutdownMins = _ovenTimeToMins((document.getElementById('ovenShutdownTime') || {}).value || '');

  // Warmup duration
  var warmupEl = document.getElementById('ovenWarmupSummary');
  if (warmupEl) {
    if (startMins !== null && readyMins !== null) {
      var wDur = readyMins - startMins;
      if (wDur < 0) wDur += 1440;
      warmupEl.textContent = 'TG kh\u1EDFi \u0111\u1ED9ng: ' + _ovenFormatDuration(wDur);
    } else {
      warmupEl.textContent = '';
    }
  }

  // Post-last-exit duration
  var postEl = document.getElementById('ovenPostLastSummary');
  if (postEl) {
    if (shutdownMins !== null) {
      // Find last (max) timeOut in table
      var lastMins = null;
      document.querySelectorAll('#dryingTrolleyBody tr').forEach(function(row) {
        var rowId = row.id.replace('dtrow_', '');
        var t = _ovenTimeToMins((document.getElementById('dtOut_' + rowId) || {}).value || '');
        if (t !== null && (lastMins === null || t > lastMins)) lastMins = t;
      });
      if (lastMins !== null) {
        var pDur = shutdownMins - lastMins;
        if (pDur < 0) pDur += 1440;
        postEl.textContent = 'TG ch\u1EA1y sau th\u00F9ng cu\u1ED1i: ' + _ovenFormatDuration(pDur);
      } else {
        postEl.textContent = '';
      }
    } else {
      postEl.textContent = '';
    }
  }
}

// Compute heat summary from saved stageData.say (for batch card display)
function getOvenHeatSummaryFromData(sd) {
  var result = { warmupCount: 0, shutdownCount: 0, minHeat: null, maxHeat: null };
  if (!sd || !sd.trolleyDrying || sd.trolleyDrying.length === 0) return result;
  var startMins = _ovenTimeToMins(sd.ovenStartTime || '');
  var readyMins = _ovenTimeToMins(sd.ovenReadyTime || '');
  var shutdownMins = _ovenTimeToMins(sd.ovenShutdownTime || '');

  sd.trolleyDrying.forEach(function(td) {
    var inMins = _ovenTimeToMins(td.timeIn || '');
    var outMins = _ovenTimeToMins(td.timeOut || '');
    if (inMins === null) return;

    // Detect warmup trolley
    var isWarmup = (readyMins !== null && inMins < readyMins);
    // Detect shutdown trolley
    var isShutdown = (shutdownMins !== null && (outMins === null || outMins > shutdownMins));
    if (isWarmup) result.warmupCount++;
    if (isShutdown) result.shutdownCount++;

    // Calculate heat duration
    var heatStart = inMins;
    if (startMins !== null && inMins < startMins) heatStart = startMins;
    var heatEnd = outMins;
    if (heatEnd === null && shutdownMins !== null) heatEnd = shutdownMins;
    if (heatStart !== null && heatEnd !== null) {
      var dur = heatEnd - heatStart;
      if (dur < 0) dur += 1440;
      if (result.minHeat === null || dur < result.minHeat) result.minHeat = dur;
      if (result.maxHeat === null || dur > result.maxHeat) result.maxHeat = dur;
    }
  });
  return result;
}

// ==================== END OVEN CYCLE ====================

function toggleTrolleyShiftEdit(rowIdx, direction) {
  var prefix = direction === 'in' ? 'dtShiftIn' : 'dtShiftOut';
  var cell = document.getElementById(prefix + 'Cell_' + rowIdx);
  var hidden = document.getElementById(prefix + '_' + rowIdx);
  var currentCode = hidden ? hidden.value : '';
  if (cell) cell.innerHTML = _buildShiftSelect(prefix + '_' + rowIdx, currentCode);
}

function _deriveSayShiftFromTrolleys() {
  var rows = document.querySelectorAll('#dryingTrolleyBody tr');
  if (rows.length === 0) return {};
  var earliestIn = null, latestOut = null;
  var shiftInCode = null, shiftOutCode = null;
  rows.forEach(function(row) {
    var rowId = row.id.replace('dtrow_', '');
    var tIn = (document.getElementById('dtIn_' + rowId) || {}).value || '';
    var tOut = (document.getElementById('dtOut_' + rowId) || {}).value || '';
    var sIn = (document.getElementById('dtShiftIn_' + rowId) || {}).value || '';
    var sOut = (document.getElementById('dtShiftOut_' + rowId) || {}).value || '';
    if (tIn && (!earliestIn || tIn < earliestIn)) { earliestIn = tIn; shiftInCode = sIn; }
    if (tOut && (!latestOut || tOut > latestOut)) { latestOut = tOut; shiftOutCode = sOut; }
  });
  var shifts = _getSXShiftsCached();
  var shiftIn = shiftInCode ? (shifts.find(function(s) { return s.code === shiftInCode; }) || null) : null;
  var shiftOut = shiftOutCode ? (shifts.find(function(s) { return s.code === shiftOutCode; }) || null) : null;
  return { shiftIn: shiftIn, shiftOut: shiftOut };
}

// ==================== DAILY SHIFT SCHEDULE ====================

/**
 * Get SX shifts from Admin departments (type "ca_sx"), fallback to SHIFT_CONFIG.
 * Strategy: TabAdmin → direct Firestore query → hardcoded fallback.
 */
async function _getSXShiftsFromAdmin() {
  var factory = window.currentFactory;

  // 1) Try via TabAdmin (uses parent-child hierarchy)
  if (typeof TabAdmin !== 'undefined' && factory) {
    try {
      var caSXDepts = await TabAdmin.getDepartmentsByType('ca_sx');
      if (caSXDepts && caSXDepts.length > 0) {
        _sxShiftsCache = caSXDepts.map(function(d) { return { code: d.code || d.id, name: d.name }; });
        return _sxShiftsCache;
      }
    } catch (e) { console.warn('[ShiftSelector] TabAdmin error:', e); }
  }

  // 2) Direct Firestore fallback (bypasses TabAdmin parent-child filtering)
  if (factory && typeof ErpDb !== 'undefined') {
    try {
      var snap = await ErpDb.firestore().collection('categoryDepartments')
        .where('type', '==', 'ca_sx')
        .get();
      var shifts = [];
      snap.forEach(function(doc) {
        var d = doc.data();
        if (d.factory === factory) {
          shifts.push({ code: d.code || doc.id, name: d.name });
        }
      });
      if (shifts.length > 0) { _sxShiftsCache = shifts; return _sxShiftsCache; }
    } catch (e2) { console.warn('[ShiftSelector] Firestore fallback error:', e2); }
  }

  // 3) Hardcoded fallback
  return SHIFT_CONFIG.sanxuat || [];
}

async function renderDailyShiftSchedule(dateStr) {
  var panel = document.getElementById('dailyShiftSchedulePanel');
  if (!panel) return;
  if (!dateStr) { panel.style.display = 'none'; return; }
  panel.style.display = '';

  // Determine effective stage: if line record form is open, use its stage
  var picker = document.getElementById('scheduleDatePicker');
  var effectiveStage = currentStage;
  var lineRecordStageEl = document.getElementById('batchStage');
  var lineRecordFormOpen = document.getElementById('lineRecordFields');
  if (lineRecordFormOpen && lineRecordFormOpen.style.display !== 'none' && lineRecordStageEl) {
    effectiveStage = lineRecordStageEl.value || currentStage;
  }
  var isBatchStage = (effectiveStage === 'xulymu' || effectiveStage === 'taodong');
  var defaultDate;
  if (isBatchStage) {
    var nextDate = new Date(dateStr + 'T00:00:00');
    nextDate.setDate(nextDate.getDate() + 1);
    defaultDate = nextDate.getFullYear() + '-' + String(nextDate.getMonth() + 1).padStart(2, '0') + '-' + String(nextDate.getDate()).padStart(2, '0');
  } else {
    defaultDate = dateStr;
  }
  // Only set default if mesDate changed (not if user manually picked a schedule date)
  if (picker && picker.dataset.mesDate !== dateStr) {
    picker.value = defaultDate;
    picker.dataset.mesDate = dateStr;
  }
  var prodDateStr = picker ? picker.value : defaultDate;

  await _loadScheduleForDate(prodDateStr);

  // Sync visibility of history/stats panel
  var histPanel = document.getElementById('shiftHistoryStatsPanel');
  if (histPanel) histPanel.style.display = dateStr ? '' : 'none';
}

function onScheduleDateChange() {
  // User manually changed the schedule date picker — reload schedule for that date
  var picker = document.getElementById('scheduleDatePicker');
  if (!picker || !picker.value) return;
  var panel = document.getElementById('dailyShiftSchedulePanel');
  if (panel) panel.dataset.prodDate = picker.value;
  // Reload schedule content without resetting the picker (keep mesDate marker)
  _loadScheduleForDate(picker.value);
}

async function _loadScheduleForDate(prodDateStr) {
  var panel = document.getElementById('dailyShiftSchedulePanel');
  if (!panel) return;
  panel.dataset.prodDate = prodDateStr;

  var lineGroups = SanxuatStages.LINE_GROUPS[currentFactory] || [];
  var sxShifts = await _getSXShiftsFromAdmin();
  var docId = currentFactory + '_' + prodDateStr;
  var existing = null;
  try {
    var doc = await db.collection('shiftSchedules').doc(docId).get();
    if (doc.exists) existing = doc.data();
  } catch (e) { /* ignore */ }

  var savedLineSchedules = null;
  if (existing && existing.lineSchedules) {
    savedLineSchedules = existing.lineSchedules;
  } else if (existing && existing.shifts) {
    savedLineSchedules = {};
    lineGroups.forEach(function(g) { savedLineSchedules[g.id] = existing.shifts; });
  }

  _cachedLineSchedules = {};
  if (savedLineSchedules) {
    Object.keys(savedLineSchedules).forEach(function(gId) {
      _cachedLineSchedules[gId] = (savedLineSchedules[gId] || []).filter(function(s) {
        return s.active !== false && s.startTime && s.endTime;
      });
    });
  }

  var container = document.getElementById('shiftScheduleContent');
  if (!container) return;
  var html = '';
  lineGroups.forEach(function(group) {
    html += '<div class="schedule-group-header">' + group.name + ' <span class="schedule-group-desc">(' + group.desc + ')</span></div>';
    sxShifts.forEach(function(s, idx) {
      var saved = savedLineSchedules && savedLineSchedules[group.id] ? savedLineSchedules[group.id].find(function(x) { return x.code === s.code; }) : null;
      var startVal = saved && saved.startTime ? saved.startTime : (s.defaultStart || '');
      var endVal = saved && saved.endTime ? saved.endTime : (s.defaultEnd || '');
      var active = saved ? saved.active !== false : (startVal !== '' && endVal !== '');
      var rowId = group.id + '_' + idx;
      var inactiveClass = active ? '' : ' inactive';
      var disabledAttr = active ? '' : ' disabled';
      var visStyle = active ? '' : ' style="visibility:hidden;"';
      html += '<div class="schedule-shift-row' + inactiveClass + '" id="schedRow_' + rowId + '">';
      html += '<input type="checkbox" id="schedActive_' + rowId + '"' + (active ? ' checked' : '') + ' onchange="onScheduleShiftToggle(\'' + group.id + '\',' + idx + ')">';
      html += '<span class="shift-name">' + s.name + '</span>';
      html += '<input type="text" id="schedStart_' + rowId + '" class="time24" value="' + startVal + '" placeholder="HH:MM" maxlength="5" oninput="formatTimeInput(this)" onblur="validateSchedTimeRange(\'' + rowId + '\')"' + disabledAttr + visStyle + '>';
      html += '<span class="arrow">&rarr;</span>';
      html += '<input type="text" id="schedEnd_' + rowId + '" class="time24" value="' + endVal + '" placeholder="HH:MM" maxlength="5" oninput="formatTimeInput(this)" onblur="validateSchedTimeRange(\'' + rowId + '\')"' + disabledAttr + visStyle + '>';
      html += '</div>';
    });
  });
  container.innerHTML = html;

  var statusEl = document.getElementById('scheduleStatus');
  if (statusEl) {
    if (existing) {
      statusEl.className = 'schedule-status-saved';
      statusEl.textContent = '\u2713 \u0110\u00E3 l\u01B0u l\u1ECBch ca cho ng\u00E0y n\u00E0y';
    } else {
      statusEl.className = 'schedule-status-empty';
      statusEl.textContent = 'Ch\u01B0a c\u00F3 l\u1ECBch ca. Nh\u1EADp v\u00E0 l\u01B0u \u0111\u1EC3 t\u1EF1 \u0111\u1ED9ng g\u00E1n ca cho th\u00F9ng s\u1EA5y.';
    }
  }

  if (typeof _refreshShiftAccess === 'function') _refreshShiftAccess();

  // Pre-load next day's schedule for overnight detection
  await _loadNextDaySchedule(prodDateStr);

  // Re-resolve trolley shifts with updated schedule
  try { _resolveAllTrolleyShifts(); } catch(e) {}
}

async function _loadNextDaySchedule(currentDateStr) {
  var nextDateStr = _getNextDateStr(currentDateStr);
  var docId = currentFactory + '_' + nextDateStr;
  _cachedNextDaySchedules = {};
  try {
    var doc = await db.collection('shiftSchedules').doc(docId).get();
    if (doc.exists) {
      var data = doc.data();
      var lineSchedules = data.lineSchedules || {};
      if (!data.lineSchedules && data.shifts) {
        var lineGroups = SanxuatStages.LINE_GROUPS[currentFactory] || [];
        lineGroups.forEach(function(g) { lineSchedules[g.id] = data.shifts; });
      }
      Object.keys(lineSchedules).forEach(function(gId) {
        _cachedNextDaySchedules[gId] = (lineSchedules[gId] || []).filter(function(s) {
          return s.active !== false && s.startTime && s.endTime;
        });
      });
    }
  } catch (e) { /* silent — next-day schedule optional */ }
}

async function saveDailyShiftSchedule() {
  // Use the date from the schedule date picker
  var picker = document.getElementById('scheduleDatePicker');
  var prodDateStr = picker ? picker.value : null;
  if (!prodDateStr) return;

  var lineGroups = SanxuatStages.LINE_GROUPS[currentFactory] || [];
  var sxShifts = await _getSXShiftsFromAdmin();

  var lineSchedules = {};
  var docId = currentFactory + '_' + prodDateStr;
  try {
    var existDoc = await db.collection('shiftSchedules').doc(docId).get();
    if (existDoc.exists && existDoc.data().lineSchedules) {
      lineSchedules = existDoc.data().lineSchedules;
    }
  } catch (e) { /* use empty */ }

  var hasError = false;

  lineGroups.forEach(function(group) {
    var firstRowId = group.id + '_0';
    if (!document.getElementById('schedActive_' + firstRowId)) return;
    var groupShifts = [];
    sxShifts.forEach(function(s, idx) {
      var rowId = group.id + '_' + idx;
      var activeCb = document.getElementById('schedActive_' + rowId);
      var active = activeCb ? activeCb.checked : true;
      if (active) {
        var start = (document.getElementById('schedStart_' + rowId) || {}).value || '';
        var end = (document.getElementById('schedEnd_' + rowId) || {}).value || '';
        if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
          hasError = true;
        }
        groupShifts.push({ code: s.code, name: s.name, startTime: start, endTime: end, active: true });
      } else {
        groupShifts.push({ code: s.code, name: s.name, active: false });
      }
    });
    lineSchedules[group.id] = groupShifts;
  });

  if (hasError) {
    showToast('Vui l\u00F2ng nh\u1EADp \u0111\u1EA7y \u0111\u1EE7 gi\u1EDD cho c\u00E1c ca \u0111ang ho\u1EA1t \u0111\u1ED9ng', 'warning');
    return;
  }

  try {
    var docData = {
      factory: currentFactory, date: prodDateStr,
      lineSchedules: lineSchedules,
      updatedBy: currentUser?.id || null,
      updatedAt: ErpDb.firestore.FieldValue.serverTimestamp()
    };
    await db.collection('shiftSchedules').doc(docId).set(docData, { merge: true });

    // Update cache
    _cachedLineSchedules = {};
    Object.keys(lineSchedules).forEach(function(gId) {
      _cachedLineSchedules[gId] = lineSchedules[gId].filter(function(s) {
        return s.active !== false && s.startTime && s.endTime;
      });
    });

    showToast('\u0110\u00E3 l\u01B0u l\u1ECBch ca ng\u00E0y ' + formatDateVN(prodDateStr) + '!', 'success');
    await _loadScheduleForDate(prodDateStr);
  } catch (e) {
    showToast('L\u1ED7i l\u01B0u l\u1ECBch ca: ' + e.message, 'error');
  }
}

function onScheduleShiftToggle(groupId, shiftIdx) {
  var rowId = groupId + '_' + shiftIdx;
  var cb = document.getElementById('schedActive_' + rowId);
  var startEl = document.getElementById('schedStart_' + rowId);
  var endEl = document.getElementById('schedEnd_' + rowId);
  var rowEl = document.getElementById('schedRow_' + rowId);
  if (!cb) return;
  var active = cb.checked;
  if (startEl) { startEl.disabled = !active; startEl.style.visibility = active ? '' : 'hidden'; }
  if (endEl) { endEl.disabled = !active; endEl.style.visibility = active ? '' : 'hidden'; }
  if (rowEl) rowEl.classList.toggle('inactive', !active);
}

// ==================== SHIFT HISTORY & STATS ====================

function switchShiftSubTab(tab) {
  var histPanel = document.getElementById('shiftHistoryPanel');
  var statsPanel = document.getElementById('shiftStatsPanel');
  if (!histPanel || !statsPanel) return;
  histPanel.style.display = tab === 'history' ? '' : 'none';
  statsPanel.style.display = tab === 'stats' ? '' : 'none';
  document.querySelectorAll('.shift-sub-tab').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.subtab === tab);
  });
  if (tab === 'stats') loadShiftStats();
}

function shiftHistoryPrev() {
  var input = document.getElementById('shiftHistoryDate');
  if (!input || !input.value) return;
  var d = new Date(input.value + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  input.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  loadShiftHistory();
}

function shiftHistoryNext() {
  var input = document.getElementById('shiftHistoryDate');
  if (!input || !input.value) return;
  var d = new Date(input.value + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  input.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  loadShiftHistory();
}

async function loadShiftHistory() {
  var dateInput = document.getElementById('shiftHistoryDate');
  var container = document.getElementById('shiftHistoryContent');
  if (!dateInput || !container) return;
  var dateStr = dateInput.value;
  if (!dateStr) { container.innerHTML = ''; return; }

  var factory = window.currentFactory;
  var docId = factory + '_' + dateStr;
  container.innerHTML = '<span style="color:var(--text-muted);font-size:12px;">\u0110ang t\u1EA3i...</span>';

  try {
    var doc = await db.collection('shiftSchedules').doc(docId).get();
    if (!doc.exists) {
      container.innerHTML = '<div style="font-size:12px;color:var(--warning);padding:4px 0;">Kh\u00F4ng c\u00F3 l\u1ECBch ca cho ng\u00E0y ' + formatDateVN(dateStr) + '</div>';
      return;
    }
    var data = doc.data();
    var lineGroups = SanxuatStages.LINE_GROUPS[factory] || [];
    // Backward compat
    var lineSchedules = data.lineSchedules || {};
    if (!data.lineSchedules && data.shifts) {
      lineGroups.forEach(function(g) { lineSchedules[g.id] = data.shifts; });
    }

    var html = '<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;">';
    html += 'Ng\u00E0y: <strong style="color:var(--accent);">' + formatDateVN(dateStr) + '</strong>';
    if (data.updatedByName || data.updatedBy) html += ' \u00B7 C\u1EADp nh\u1EADt: ' + (data.updatedByName || data.updatedBy);
    html += '</div>';

    lineGroups.forEach(function(group) {
      var shifts = lineSchedules[group.id] || [];
      html += '<div class="schedule-group-header">' + group.name + ' <span class="schedule-group-desc">(' + group.desc + ')</span></div>';
      if (shifts.length === 0) {
        html += '<div style="font-size:12px;color:var(--text-muted);padding:2px 0;">\u2014</div>';
        return;
      }
      shifts.forEach(function(s) {
        var isActive = s.active !== false;
        html += '<div class="schedule-shift-row' + (isActive ? '' : ' inactive') + '">';
        html += '<span style="font-size:12px;">' + (isActive ? '\u2705' : '\u274C') + '</span> ';
        html += '<span class="shift-name">' + s.name + '</span>';
        if (isActive && s.startTime && s.endTime) {
          html += '<span style="font-size:12px;color:var(--info);">' + s.startTime + '</span>';
          html += '<span class="arrow"> \u2192 </span>';
          html += '<span style="font-size:12px;color:var(--info);">' + s.endTime + '</span>';
        }
        html += '</div>';
      });
    });

    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = '<span style="color:var(--danger);font-size:12px;">L\u1ED7i: ' + e.message + '</span>';
  }
}

async function loadShiftStats() {
  var monthInput = document.getElementById('shiftStatsMonth');
  var container = document.getElementById('shiftStatsContent');
  if (!monthInput || !container) return;

  if (!monthInput.value) {
    var now = new Date();
    monthInput.value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  }

  var parts = monthInput.value.split('-');
  var year = parseInt(parts[0]);
  var month = parseInt(parts[1]);
  var factory = window.currentFactory;
  var daysInMonth = new Date(year, month, 0).getDate();

  var startDate = year + '-' + String(month).padStart(2, '0') + '-01';
  var endDate = year + '-' + String(month).padStart(2, '0') + '-' + String(daysInMonth).padStart(2, '0');
  var startDocId = factory + '_' + startDate;
  var endDocId = factory + '_' + endDate + '\uf8ff';

  container.innerHTML = '<span style="color:var(--text-muted);font-size:12px;">\u0110ang t\u1EA3i th\u1ED1ng k\u00EA...</span>';

  try {
    var snap = await db.collection('shiftSchedules')
      .where(ErpDb.firestore.FieldPath.documentId(), '>=', startDocId)
      .where(ErpDb.firestore.FieldPath.documentId(), '<=', endDocId)
      .get();

    var schedulesByDate = {};
    snap.forEach(function(doc) {
      var data = doc.data();
      if (data.date) schedulesByDate[data.date] = data;
    });

    renderShiftStatsTable(year, month, daysInMonth, schedulesByDate, container);
  } catch (e) {
    container.innerHTML = '<span style="color:var(--danger);font-size:12px;">L\u1ED7i: ' + e.message + '</span>';
  }
}

function renderShiftStatsTable(year, month, daysInMonth, schedulesByDate, container) {
  var factory = window.currentFactory;
  var lineGroups = SanxuatStages.LINE_GROUPS[factory] || [];

  // Collect all unique shift codes
  var allShiftCodes = [];
  var seenCodes = {};
  Object.keys(schedulesByDate).forEach(function(date) {
    var ls = schedulesByDate[date].lineSchedules || {};
    Object.keys(ls).forEach(function(gId) {
      (ls[gId] || []).forEach(function(s) {
        if (!seenCodes[s.code]) { seenCodes[s.code] = true; allShiftCodes.push({ code: s.code, name: s.name }); }
      });
    });
  });
  allShiftCodes.sort(function(a, b) { return a.code.localeCompare(b.code); });

  // Compute stats
  var shiftDayCounts = {};
  var shiftTimeRanges = {};
  allShiftCodes.forEach(function(s) { shiftDayCounts[s.code] = 0; shiftTimeRanges[s.code] = {}; });

  var savedCount = Object.keys(schedulesByDate).length;
  for (var day = 1; day <= daysInMonth; day++) {
    var dateStr = year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    var sched = schedulesByDate[dateStr];
    if (!sched) continue;
    var ls = sched.lineSchedules || {};
    var dayActive = {};
    Object.keys(ls).forEach(function(gId) {
      (ls[gId] || []).forEach(function(s) {
        if (s.active !== false && s.startTime && s.endTime) {
          dayActive[s.code] = true;
          var range = s.startTime + '\u2013' + s.endTime;
          shiftTimeRanges[s.code][range] = (shiftTimeRanges[s.code][range] || 0) + 1;
        }
      });
    });
    Object.keys(dayActive).forEach(function(code) { shiftDayCounts[code]++; });
  }

  var html = '';

  // Summary cards
  html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">';
  html += '<div style="background:var(--bg-primary);border-radius:6px;padding:6px 10px;border:1px solid var(--border-color);">';
  html += '<div style="font-size:12px;color:var(--text-muted);">Ng\u00E0y c\u00F3 l\u1ECBch ca</div>';
  html += '<div style="font-size:16px;font-weight:700;color:var(--accent);">' + savedCount + '/' + daysInMonth + '</div>';
  html += '</div>';
  allShiftCodes.forEach(function(s) {
    html += '<div style="background:var(--bg-primary);border-radius:6px;padding:6px 10px;border:1px solid var(--border-color);">';
    html += '<div style="font-size:12px;color:var(--text-muted);">' + s.name + '</div>';
    html += '<div style="font-size:16px;font-weight:700;color:var(--info);">' + shiftDayCounts[s.code] + ' ng\u00E0y</div>';
    var ranges = shiftTimeRanges[s.code];
    var topRange = '', topCount = 0;
    Object.keys(ranges).forEach(function(r) { if (ranges[r] > topCount) { topCount = ranges[r]; topRange = r; } });
    if (topRange) html += '<div style="font-size:12px;color:var(--text-muted);">' + topRange + ' (' + topCount + ')</div>';
    html += '</div>';
  });
  html += '</div>';

  if (allShiftCodes.length === 0) {
    html += '<div style="font-size:12px;color:var(--text-muted);padding:4px 0;">Kh\u00F4ng c\u00F3 d\u1EEF li\u1EC7u l\u1ECBch ca trong th\u00E1ng n\u00E0y</div>';
    container.innerHTML = html;
    return;
  }

  // Calendar table
  html += '<div style="overflow-x:auto;max-height:400px;overflow-y:auto;">';
  html += '<table class="shift-stats-table">';
  html += '<thead><tr><th style="width:60px;position:sticky;left:0;z-index:2;background:var(--bg-secondary);">Ng\u00E0y</th>';
  lineGroups.forEach(function(group) {
    allShiftCodes.forEach(function(s) {
      html += '<th>' + group.name.substring(0, 6) + '<br>' + s.name + '</th>';
    });
  });
  html += '</tr></thead><tbody>';

  for (var day = 1; day <= daysInMonth; day++) {
    var dateStr = year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    var sched = schedulesByDate[dateStr];
    var dow = new Date(year, month - 1, day).getDay();
    var isWeekend = dow === 0 || dow === 6;
    var rowBg = isWeekend ? 'background:rgba(99,102,241,0.05);' : '';

    html += '<tr style="' + rowBg + '">';
    html += '<td style="font-weight:600;white-space:nowrap;position:sticky;left:0;background:' + (isWeekend ? 'rgba(99,102,241,0.08)' : 'var(--bg-tertiary)') + ';z-index:1;">';
    html += String(day).padStart(2, '0') + '/' + String(month).padStart(2, '0');
    if (isWeekend) html += ' <span style="color:var(--danger);font-size:12px;">' + (dow === 0 ? 'CN' : 'T7') + '</span>';
    html += '</td>';

    lineGroups.forEach(function(group) {
      var ls = sched && sched.lineSchedules ? sched.lineSchedules[group.id] || [] : [];
      allShiftCodes.forEach(function(shiftDef) {
        var found = null;
        for (var k = 0; k < ls.length; k++) { if (ls[k].code === shiftDef.code) { found = ls[k]; break; } }

        if (!sched) {
          html += '<td class="shift-cell-empty">-</td>';
        } else if (!found || found.active === false) {
          html += '<td class="shift-cell-off">\u2014</td>';
        } else {
          html += '<td class="shift-cell-on"><span style="font-size:12px;">' + found.startTime + '</span><br><span style="font-size:12px;">' + found.endTime + '</span></td>';
        }
      });
    });
    html += '</tr>';
  }

  html += '</tbody></table></div>';
  container.innerHTML = html;
}

function collectOvenData() {
  const stage = document.getElementById('batchStage')?.value;
  if (stage !== 'say') return {};
  const ovenId = document.getElementById('ovenSelect')?.value || '';
  const trolleyDrying = [];
  var _b5Cache = _getTrolleyB5Data();
  document.querySelectorAll('#dryingTrolleyBody tr').forEach(function(row) {
    const rowId = row.id.replace('dtrow_', '');
    const sel = row.querySelector('select');
    const tInputs = row.querySelectorAll('input.time24');
    const trolleyNo = parseInt(sel?.value) || null;
    const timeIn = tInputs[0]?.value || '';
    const timeOut = tInputs[1]?.value || '';
    if (trolleyNo) {
      var entry = { trolleyNo: trolleyNo, timeIn: timeIn, timeOut: timeOut };
      if (row.dataset.exitConfirmed === 'true') entry.exitConfirmed = true;
      // Per-trolley shift data
      var sInEl = document.getElementById('dtShiftIn_' + rowId);
      var sOutEl = document.getElementById('dtShiftOut_' + rowId);
      var sInCode = sInEl ? sInEl.value : '';
      var sOutCode = sOutEl ? sOutEl.value : '';
      var shifts = _getSXShiftsCached();
      if (sInCode) {
        var sIn = shifts.find(function(s) { return s.code === sInCode; });
        if (sIn) entry.shiftIn = { code: sIn.code, name: sIn.name, resolved: !!document.getElementById('dtShiftInDisplay_' + rowId) };
      }
      if (sOutCode) {
        var sOut = shifts.find(function(s) { return s.code === sOutCode; });
        if (sOut) entry.shiftOut = { code: sOut.code, name: sOut.name, resolved: !!document.getElementById('dtShiftOutDisplay_' + rowId) };
      }
      // Overnight flag
      if (row.dataset.overnight === 'true') {
        entry.overnight = true;
        if (entry.shiftOut) {
          var ndEl = document.getElementById('dtShiftOutNextDay_' + rowId);
          if (ndEl && ndEl.value === '1') entry.shiftOut.fromNextDay = true;
        }
      }
      // Transfer info: mark trolleys received from other DC lines
      if (row.dataset.transferFrom) {
        entry.transferred = true;
        entry.fromRecordId = row.dataset.transferFrom;
        entry.fromDCLine = row.dataset.transferDCLine || '';
      }
      // Shift handover: which shift exited this trolley
      if (row.dataset.exitedByShift) {
        entry.exitedByShift = row.dataset.exitedByShift;
      }
      // Muong and XH data (important for overnight transfer persistence)
      if (_b5Cache.trolleyMap && _b5Cache.trolleyMap[trolleyNo] && _b5Cache.trolleyMap[trolleyNo].length > 0) {
        entry.muongNos = _b5Cache.trolleyMap[trolleyNo];
      }
      if (_b5Cache.xhTimeMap && _b5Cache.xhTimeMap[trolleyNo]) {
        entry.xhTime = _b5Cache.xhTimeMap[trolleyNo];
      }
      // Fallback: read from cell if B5 data unavailable (overnight records)
      if (!entry.muongNos) {
        var mCell = document.getElementById('dtMuong_' + rowId);
        if (mCell && mCell.textContent && mCell.textContent !== '\u2014' && mCell.textContent !== '—') {
          var mMatches = mCell.textContent.match(/M(\d+)/g);
          if (mMatches) entry.muongNos = mMatches.map(function(m) { return parseInt(m.replace('M', '')); });
        }
      }
      if (!entry.xhTime) {
        var xCell = document.getElementById('dtXH_' + rowId);
        if (xCell && xCell.textContent && xCell.textContent !== '\u2014' && xCell.textContent !== '—') {
          entry.xhTime = xCell.textContent.trim();
        }
      }
      trolleyDrying.push(entry);
    }
  });
  const tempLog = [];
  document.querySelectorAll('#tempLogBody tr').forEach(function(row) {
    const inputs = row.querySelectorAll('input');
    if (inputs.length >= 3) {
      const time = inputs[0].value || '';
      const b1 = inputs[1].value !== '' ? parseFloat(inputs[1].value) : null;
      const b2 = inputs[2].value !== '' ? parseFloat(inputs[2].value) : null;
      if (time) tempLog.push({ time: time, burner1: b1, burner2: b2 });
    }
  });
  return {
    ovenId: ovenId || null,
    exitInterval: parseInt(document.getElementById('ovenExitInterval')?.value) || null,
    ovenStartTime: document.getElementById('ovenStartTime')?.value || null,
    ovenReadyTime: document.getElementById('ovenReadyTime')?.value || null,
    ovenShutdownTime: document.getElementById('ovenShutdownTime')?.value || null,
    trolleyDrying: trolleyDrying.length > 0 ? trolleyDrying : null,
    tempLog: tempLog.length > 0 ? tempLog : null,
    shiftHandovers: _shiftHandovers.length > 0 ? _shiftHandovers : null
  };
}

async function loadOvenData(stageDataObj) {
  if (!stageDataObj) return;

  // Store overnight source info for chart rendering
  _currentOvernightFrom = stageDataObj.overnightFrom || null;

  // 1. Xác định ovenId và ngày
  var ovenId = stageDataObj.ovenId || (document.getElementById('ovenSelect') || {}).value || '';
  var dateStr = (document.getElementById('lineRecordProductionDate') || {}).value || '';

  // 2. Đọc dữ liệu chia sẻ từ ovenDailyOps (source of truth)
  var sharedOps = null;
  if (ovenId && dateStr) {
    sharedOps = await _loadOvenDailyOps(ovenId, dateStr);
  }

  // 3. Fill oven operation fields — shared ops có ưu tiên cao hơn
  var opsSource = sharedOps || stageDataObj;
  if (ovenId) {
    var sel = document.getElementById('ovenSelect');
    if (sel) sel.value = ovenId;
  }
  ['exitInterval', 'ovenStartTime', 'ovenReadyTime', 'ovenShutdownTime'].forEach(function(field) {
    var input = document.getElementById(field === 'exitInterval' ? 'ovenExitInterval' : field);
    if (input && opsSource[field] != null) input.value = opsSource[field];
  });

  // 4. Fill tempLog from shared source (nếu có)
  var tempSource = sharedOps ? sharedOps.tempLog : stageDataObj.tempLog;
  if (tempSource && Array.isArray(tempSource) && tempSource.length > 0) {
    var tempBody = document.getElementById('tempLogBody');
    if (tempBody) { tempBody.innerHTML = ''; _tempRowCounter = 0; }
    tempSource.forEach(function(tl) { addTempRow(tl.time, tl.burner1, tl.burner2); });
  }

  // 5. Hiện badge "đồng bộ" nếu có shared data
  _showOvenSyncBadge(sharedOps);

  // 6. Trolley data luôn từ record riêng
  if (stageDataObj.trolleyDrying && Array.isArray(stageDataObj.trolleyDrying)) {
    const tbody = document.getElementById('dryingTrolleyBody');
    if (tbody) tbody.innerHTML = '';
    _dryTrolleyCounter = 0;
    _acceptedTransferTrolleys = []; // Reset transfer list

    // Pre-build muong/XH lookup from source record (for overnight records without own taohat)
    var _overnightSrcB5 = { trolleyMap: {}, xhTimeMap: {} };
    if (stageDataObj.overnightFrom && stageDataObj.overnightFrom.recordId) {
      var _srcRecId = stageDataObj.overnightFrom.recordId;
      // Try memory first, then Firestore
      var _srcRec = (window.lineRecords || []).find(function(r) { return r.id === _srcRecId; });
      if (!_srcRec) {
        try {
          var _srcDoc = await ErpDb.firestore().collection('productionLineRecords').doc(_srcRecId).get();
          if (_srcDoc.exists) _srcRec = Object.assign({ id: _srcDoc.id }, _srcDoc.data());
        } catch (e) { console.warn('[loadOvenData] Overnight source lookup error:', e); }
      }
      if (_srcRec) {
        // Extract trolley muong/XH from taohat
        var _srcTaohat = _srcRec.stageData && _srcRec.stageData.taohat && _srcRec.stageData.taohat.params;
        if (_srcTaohat && _srcTaohat.trolleys) {
          _srcTaohat.trolleys.forEach(function(st) {
            if (!st.trolleyNo) return;
            var muongs = [];
            if (st.boxMappings) {
              st.boxMappings.forEach(function(m) { if (m.muongNo && muongs.indexOf(m.muongNo) === -1) muongs.push(m.muongNo); });
            } else if (st.muongNo) {
              muongs.push(st.muongNo);
            }
            _overnightSrcB5.trolleyMap[st.trolleyNo] = muongs;
            if (st.xhTime) _overnightSrcB5.xhTimeMap[st.trolleyNo] = st.xhTime;
          });
        }
        // Fallback XH from canmu
        var _srcCanmu = _srcRec.stageData && _srcRec.stageData.canmu && _srcRec.stageData.canmu.params && _srcRec.stageData.canmu.params.canmuChannels;
        if (_srcCanmu && _srcCanmu.length > 0) {
          var _muongTime = {};
          _srcCanmu.forEach(function(cc) {
            var mNo = cc.muong || (cc.idx || 0) + 1;
            if (cc.tgBatDau && (!_muongTime[mNo] || cc.tgBatDau < _muongTime[mNo])) _muongTime[mNo] = cc.tgBatDau;
          });
          Object.keys(_overnightSrcB5.trolleyMap).forEach(function(tNo) {
            if (_overnightSrcB5.xhTimeMap[tNo]) return;
            var muongs = _overnightSrcB5.trolleyMap[tNo];
            var earliest = null;
            muongs.forEach(function(m) { if (_muongTime[m] && (!earliest || _muongTime[m] < earliest)) earliest = _muongTime[m]; });
            if (earliest) _overnightSrcB5.xhTimeMap[tNo] = earliest;
          });
        }
        // Also extract from say.trolleyDrying of source (for transferred trolleys' muong/XH)
        var _srcSay = _srcRec.stageData && _srcRec.stageData.say;
        if (_srcSay && _srcSay.trolleyDrying) {
          // Collect unique fromRecordIds for transferred trolleys that still need muong/XH
          var _transferSrcIds = {};
          _srcSay.trolleyDrying.forEach(function(st) {
            if (!st.trolleyNo) return;
            // Try stored muongNos/xhTime first
            if (st.muongNos && st.muongNos.length > 0 && !_overnightSrcB5.trolleyMap[st.trolleyNo]) {
              _overnightSrcB5.trolleyMap[st.trolleyNo] = st.muongNos;
            }
            if (st.xhTime && !_overnightSrcB5.xhTimeMap[st.trolleyNo]) {
              _overnightSrcB5.xhTimeMap[st.trolleyNo] = st.xhTime;
            }
            // Track transferred trolleys that still need lookup
            if (st.transferred && st.fromRecordId && !_overnightSrcB5.trolleyMap[st.trolleyNo]) {
              if (!_transferSrcIds[st.fromRecordId]) _transferSrcIds[st.fromRecordId] = [];
              _transferSrcIds[st.fromRecordId].push(st.trolleyNo);
            }
          });
          // Fetch transfer source records from Firestore for remaining trolleys
          var _tSrcKeys = Object.keys(_transferSrcIds);
          for (var _ti = 0; _ti < _tSrcKeys.length; _ti++) {
            var _tSrcId = _tSrcKeys[_ti];
            var _tSrcTrolleys = _transferSrcIds[_tSrcId];
            try {
              var _tSrcRec = (window.lineRecords || []).find(function(r) { return r.id === _tSrcId; });
              if (!_tSrcRec) {
                var _tSrcDoc = await ErpDb.firestore().collection('productionLineRecords').doc(_tSrcId).get();
                if (_tSrcDoc.exists) _tSrcRec = Object.assign({ id: _tSrcDoc.id }, _tSrcDoc.data());
              }
              if (_tSrcRec && _tSrcRec.stageData && _tSrcRec.stageData.taohat && _tSrcRec.stageData.taohat.params) {
                var _tSrcB5 = _tSrcRec.stageData.taohat.params.trolleys || [];
                // Also get canmu for XH fallback
                var _tSrcCanmu = _tSrcRec.stageData.canmu && _tSrcRec.stageData.canmu.params && _tSrcRec.stageData.canmu.params.canmuChannels || [];
                var _tMuongTimeMap = {};
                _tSrcCanmu.forEach(function(cc) {
                  var mNo = cc.muong || (cc.idx || 0) + 1;
                  if (cc.tgBatDau && (!_tMuongTimeMap[mNo] || cc.tgBatDau < _tMuongTimeMap[mNo])) _tMuongTimeMap[mNo] = cc.tgBatDau;
                });
                _tSrcB5.forEach(function(bt) {
                  if (!bt.trolleyNo || _tSrcTrolleys.indexOf(bt.trolleyNo) === -1) return;
                  var muongs = [];
                  if (bt.boxMappings) {
                    bt.boxMappings.forEach(function(m) { if (m.muongNo && muongs.indexOf(m.muongNo) === -1) muongs.push(m.muongNo); });
                  } else if (bt.muongNo) {
                    muongs.push(bt.muongNo);
                  }
                  if (muongs.length > 0) _overnightSrcB5.trolleyMap[bt.trolleyNo] = muongs;
                  // XH: saved → canmu fallback
                  var xh = bt.xhTime || '';
                  if (!xh && muongs.length > 0) {
                    var earliest = null;
                    muongs.forEach(function(m) { if (_tMuongTimeMap[m] && (!earliest || _tMuongTimeMap[m] < earliest)) earliest = _tMuongTimeMap[m]; });
                    if (earliest) xh = earliest;
                  }
                  if (xh) _overnightSrcB5.xhTimeMap[bt.trolleyNo] = xh;
                });
              }
            } catch (e) { console.warn('[loadOvenData] Transfer source lookup error:', e); }
          }
        }
      }
    }

    stageDataObj.trolleyDrying.forEach(function(td) {
      // Restore transfer trolleys to accepted list (with muong/XH data)
      if (td.transferred) {
        var _tMuongs = td.muongNos || [];
        var _tXhTime = td.xhTime || '';
        // Fallback 1: overnight source B5 data (already loaded from Firestore above)
        if (_tMuongs.length === 0 && _overnightSrcB5.trolleyMap[td.trolleyNo]) {
          _tMuongs = _overnightSrcB5.trolleyMap[td.trolleyNo];
        }
        if (!_tXhTime && _overnightSrcB5.xhTimeMap[td.trolleyNo]) {
          _tXhTime = _overnightSrcB5.xhTimeMap[td.trolleyNo];
        }
        // Fallback 2: look up from source record in memory
        if (_tMuongs.length === 0 && td.fromRecordId) {
          var srcRec = (window.lineRecords || []).find(function(r) { return r.id === td.fromRecordId; });
          if (srcRec) {
            var srcTrolleys = srcRec.stageData && srcRec.stageData.taohat && srcRec.stageData.taohat.params && srcRec.stageData.taohat.params.trolleys;
            if (srcTrolleys) {
              var srcT = srcTrolleys.find(function(st) { return st.trolleyNo === td.trolleyNo; });
              if (srcT) {
                if (srcT.boxMappings) {
                  srcT.boxMappings.forEach(function(m) { if (m.muongNo && _tMuongs.indexOf(m.muongNo) === -1) _tMuongs.push(m.muongNo); });
                } else if (srcT.muongNo) {
                  _tMuongs.push(srcT.muongNo);
                }
                if (!_tXhTime && srcT.xhTime) _tXhTime = srcT.xhTime;
              }
            }
          }
        }
        _acceptedTransferTrolleys.push({
          trolleyNo: td.trolleyNo,
          fromDCLine: td.fromDCLine || '',
          fromRecordId: td.fromRecordId || '',
          muongs: _tMuongs,
          xhTime: _tXhTime
        });
      }
      addDryingTrolleyRow(td.trolleyNo, td.timeIn, td.timeOut, td.shiftIn || null, td.shiftOut || null, td.exitConfirmed || false, td.overnight || false);
      // Restore transfer and shift handover data attributes on row
      var rows = tbody.querySelectorAll('tr');
      var lastRow = rows[rows.length - 1];
      if (lastRow) {
        var rowIdx = lastRow.id.replace('dtrow_', '');
        // Restore muong/XH: try stored data → overnight source record → display stays "—"
        var _restoreMuongs = td.muongNos || [];
        var _restoreXh = td.xhTime || '';
        // Fallback: overnight source record B5 data
        if (_restoreMuongs.length === 0 && _overnightSrcB5.trolleyMap[td.trolleyNo]) {
          _restoreMuongs = _overnightSrcB5.trolleyMap[td.trolleyNo];
        }
        if (!_restoreXh && _overnightSrcB5.xhTimeMap[td.trolleyNo]) {
          _restoreXh = _overnightSrcB5.xhTimeMap[td.trolleyNo];
        }
        if (_restoreMuongs.length > 0) {
          var muongCell = document.getElementById('dtMuong_' + rowIdx);
          if (muongCell && (muongCell.textContent === '\u2014' || muongCell.textContent === '—')) {
            muongCell.textContent = 'M' + _restoreMuongs.join(', M');
          }
        }
        if (_restoreXh) {
          var xhCell = document.getElementById('dtXH_' + rowIdx);
          if (xhCell && (xhCell.textContent === '\u2014' || xhCell.textContent === '—')) {
            xhCell.textContent = _restoreXh;
          }
        }
        if (td.transferred) {
          lastRow.dataset.transferFrom = td.fromRecordId || '';
          lastRow.dataset.transferDCLine = td.fromDCLine || '';
          var muongCell2 = lastRow.querySelector('td:nth-child(2)');
          if (muongCell2) {
            muongCell2.innerHTML = muongCell2.textContent + ' <span style="font-size:12px;color:var(--primary);">(\u2190' + (td.fromDCLine || '') + ')</span>';
          }
        }
        // Restore exitedByShift
        if (td.exitedByShift) {
          lastRow.dataset.exitedByShift = td.exitedByShift;
        }
      }
    });
  }
  // Update heat info and oven summary after restoring all data
  if (typeof updateAllTrolleyHeat === 'function') updateAllTrolleyHeat();
  if (typeof updateOvenSummary === 'function') updateOvenSummary();

  // Force load schedule for production date (NOT scheduleDatePicker which may show next day)
  var schedDate = (document.getElementById('lineRecordProductionDate') || {}).value || '';
  if (schedDate) {
    try {
      await _loadScheduleForDate(schedDate);
      // Also sync the schedule date picker to match production date
      var picker = document.getElementById('scheduleDatePicker');
      if (picker) picker.value = schedDate;
    } catch(e) {}
  }

  // 7. Restore shift handover data
  _shiftHandovers = (stageDataObj.shiftHandovers && Array.isArray(stageDataObj.shiftHandovers)) ? stageDataObj.shiftHandovers : [];
  // Render shift handover bar and apply trolley filtering
  await _renderShiftHandoverBar();
  await _filterTrolleysByShift();
}

// Đọc dữ liệu vận hành lò chia sẻ từ Firestore
async function _loadOvenDailyOps(ovenId, dateStr) {
  if (!ovenId || !dateStr) return null;
  try {
    var docId = ovenId + '_' + dateStr;
    var doc = await ErpDb.firestore().collection('ovenDailyOps').doc(docId).get();
    return doc.exists ? doc.data() : null;
  } catch (e) {
    console.warn('[OvenDailyOps] Load error:', e);
    return null;
  }
}

/**
 * Load previous day's oven data for overnight chart rendering.
 * Tries ovenDailyOps first, then falls back to source line record's stageData.say.
 */
async function _loadPrevDayOvenData(ovenId, currentDateStr, overnightFrom) {
  var prevDate = _getPrevDateStr(currentDateStr);

  // 1. Try ovenDailyOps with prev date
  var ops = null;
  if (ovenId && prevDate) {
    try { ops = await _loadOvenDailyOps(ovenId, prevDate); } catch(e) {}
  }
  if (ops && ops.tempLog && ops.tempLog.length > 0) return ops;

  // 2. Try source record from overnightFrom (by recordId)
  var srcRec = null;
  if (overnightFrom && overnightFrom.recordId) {
    srcRec = (window.lineRecords || []).find(function(r) { return r.id === overnightFrom.recordId; });
    if (!srcRec) {
      try {
        var srcDoc = await ErpDb.firestore().collection('productionLineRecords').doc(overnightFrom.recordId).get();
        if (srcDoc.exists) srcRec = Object.assign({ id: srcDoc.id }, srcDoc.data());
      } catch(e) {}
    }
  }

  // 3. Fallback: query prev day's line record (same factory + DC line + prev date)
  if (!srcRec) {
    var factory = window.currentFactory;
    var dcLine = (document.getElementById('lineRecordDCLine') || {}).value || '';
    if (factory && dcLine && prevDate) {
      // Try memory first
      srcRec = (window.lineRecords || []).find(function(r) {
        return r.factory === factory && r.productionLine === dcLine && r.date === prevDate;
      });
      if (!srcRec) {
        try {
          var q = await ErpDb.firestore().collection('productionLineRecords')
            .where('factory', '==', factory)
            .where('productionLine', '==', dcLine)
            .where('date', '==', prevDate)
            .limit(1).get();
          if (!q.empty) srcRec = Object.assign({ id: q.docs[0].id }, q.docs[0].data());
        } catch(e) {}
      }
    }
  }

  // Extract tempLog + oven times from source record's stageData.say
  if (srcRec) {
    var sayData = srcRec.stageData && srcRec.stageData.say;
    if (sayData && sayData.tempLog && sayData.tempLog.length > 0) {
      return {
        ovenStartTime: sayData.ovenStartTime || null,
        ovenReadyTime: sayData.ovenReadyTime || null,
        ovenShutdownTime: sayData.ovenShutdownTime || null,
        tempLog: sayData.tempLog
      };
    }
  }
  return null;
}

// Lưu dữ liệu vận hành lò chia sẻ vào Firestore (upsert)
async function _saveOvenDailyOps(ovenId, dateStr, data, currentUser) {
  if (!ovenId || !dateStr) return;
  var docId = ovenId + '_' + dateStr;
  var payload = {
    factoryId: window.currentFactory,
    ovenId: ovenId,
    date: dateStr,
    ovenStartTime: data.ovenStartTime || null,
    ovenReadyTime: data.ovenReadyTime || null,
    ovenShutdownTime: data.ovenShutdownTime || null,
    exitInterval: data.exitInterval || null,
    tempLog: data.tempLog || [],
    updatedAt: ErpDb.firestore.FieldValue.serverTimestamp(),
    updatedBy: currentUser ? currentUser.id : null,
    updatedByName: currentUser ? (currentUser.hoTen || currentUser.name || '') : ''
  };
  await ErpDb.firestore().collection('ovenDailyOps').doc(docId).set(payload, { merge: true });
}

// Hiện badge đồng bộ lò sấy
function _showOvenSyncBadge(sharedOps) {
  var badge = document.getElementById('ovenSyncBadge');
  if (!badge) return;
  if (sharedOps && sharedOps.updatedByName) {
    badge.innerHTML = '\u26A1 D\u1EEF li\u1EC7u chia s\u1EBB \u00B7 C\u1EADp nh\u1EADt b\u1EDFi ' + sharedOps.updatedByName;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

function clearOvenSection() {
  const dtBody = document.getElementById('dryingTrolleyBody');
  if (dtBody) dtBody.innerHTML = '';
  _dryTrolleyCounter = 0;
  const tlBody = document.getElementById('tempLogBody');
  if (tlBody) tlBody.innerHTML = '';
  _tempRowCounter = 0;
  const ovenSel = document.getElementById('ovenSelect');
  if (ovenSel) ovenSel.value = '';
  // Clear oven operation fields
  ['ovenExitInterval', 'ovenStartTime', 'ovenReadyTime', 'ovenShutdownTime'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  var summaryEl = document.getElementById('ovenSummaryInfo');
  if (summaryEl) summaryEl.innerHTML = '';
  // Hide sync badge
  var syncBadge = document.getElementById('ovenSyncBadge');
  if (syncBadge) syncBadge.style.display = 'none';
  // Hide transfer section
  var transferSec = document.getElementById('transferTrolleySection');
  if (transferSec) transferSec.style.display = 'none';
  _acceptedTransferTrolleys = [];
  // Reset shift handover state
  _shiftHandovers = [];
  var shBar = document.getElementById('shiftHandoverBar');
  if (shBar) shBar.style.display = 'none';
}

// ==================== OVEN TEMPERATURE CHART ====================
var _ovenChartInstances = [];

var TROLLEY_BAND_COLORS = [
  { bg: 'rgba(99,102,241,0.13)', border: 'rgba(99,102,241,0.6)', label: '#6366f1' },
  { bg: 'rgba(34,197,94,0.13)', border: 'rgba(34,197,94,0.6)', label: '#22c55e' },
  { bg: 'rgba(236,72,153,0.13)', border: 'rgba(236,72,153,0.6)', label: '#ec4899' },
  { bg: 'rgba(14,165,233,0.13)', border: 'rgba(14,165,233,0.6)', label: '#0ea5e9' },
  { bg: 'rgba(168,85,247,0.13)', border: 'rgba(168,85,247,0.6)', label: '#a855f7' },
  { bg: 'rgba(245,158,11,0.13)', border: 'rgba(245,158,11,0.6)', label: '#f59e0b' },
  { bg: 'rgba(239,68,68,0.13)', border: 'rgba(239,68,68,0.6)', label: '#ef4444' },
  { bg: 'rgba(20,184,166,0.13)', border: 'rgba(20,184,166,0.6)', label: '#14b8a6' },
];

function _destroyOvenCharts() {
  _ovenChartInstances.forEach(function(c) { try { c.destroy(); } catch(e) {} });
  _ovenChartInstances = [];
  if (_perTrolleyChartInstance) {
    try { _perTrolleyChartInstance.destroy(); } catch(e) {}
    _perTrolleyChartInstance = null;
  }
  _ovenChartData = null;
}

function openOvenChartModal() {
  var modal = document.getElementById('ovenChartModal');
  if (modal) modal.classList.add('active');
}

function closeOvenChartModal() {
  var modal = document.getElementById('ovenChartModal');
  if (modal) modal.classList.remove('active');
  _destroyOvenCharts();
}

function _collectTempChartData() {
  var tempLog = [];
  document.querySelectorAll('#tempLogBody tr').forEach(function(row) {
    var inputs = row.querySelectorAll('input');
    if (inputs.length < 3) return;
    var time = (inputs[0].value || '').trim();
    if (!/^\d{2}:\d{2}$/.test(time)) return;
    var b1 = inputs[1].value !== '' ? parseFloat(inputs[1].value) : null;
    var b2 = inputs[2].value !== '' ? parseFloat(inputs[2].value) : null;
    var mins = _ovenTimeToMins(time);
    tempLog.push({ time: time, mins: mins, b1: b1, b2: b2 });
  });
  tempLog.sort(function(a, b) { return a.mins - b.mins; });

  var trolleys = [];
  document.querySelectorAll('#dryingTrolleyBody tr').forEach(function(row) {
    var sel = row.querySelector('select');
    var trolleyNo = sel ? parseInt(sel.value) : null;
    if (!trolleyNo) return;
    var tInputs = row.querySelectorAll('input.time24');
    var timeIn = tInputs[0] ? tInputs[0].value : '';
    var timeOut = tInputs[1] ? tInputs[1].value : '';
    if (!/^\d{2}:\d{2}$/.test(timeIn)) return;
    var isOvernight = row.dataset.overnight === 'true';
    trolleys.push({
      trolleyNo: trolleyNo,
      timeIn: timeIn,
      timeOut: /^\d{2}:\d{2}$/.test(timeOut) ? timeOut : null,
      inMins: _ovenTimeToMins(timeIn),
      outMins: /^\d{2}:\d{2}$/.test(timeOut) ? _ovenTimeToMins(timeOut) : null,
      isOvernight: isOvernight
    });
  });

  var ovenStart = _ovenTimeToMins((document.getElementById('ovenStartTime') || {}).value || '');
  var ovenReady = _ovenTimeToMins((document.getElementById('ovenReadyTime') || {}).value || '');
  var ovenShutdown = _ovenTimeToMins((document.getElementById('ovenShutdownTime') || {}).value || '');
  var ovenId = (document.getElementById('ovenSelect') || {}).value || '';
  var dateStr = (document.getElementById('lineRecordProductionDate') || {}).value || '';

  // Get overnightFrom: try global var first, then current record in memory
  var overnightFrom = _currentOvernightFrom;
  if (!overnightFrom) {
    var recId = (document.getElementById('lineRecordId') || {}).value || '';
    if (recId) {
      var rec = (window.lineRecords || []).find(function(r) { return r.id === recId; });
      if (rec && rec.stageData && rec.stageData.say && rec.stageData.say.overnightFrom) {
        overnightFrom = rec.stageData.say.overnightFrom;
      }
    }
  }

  return {
    tempLog: tempLog,
    trolleys: trolleys,
    sameDayTrolleys: trolleys.filter(function(t) { return !t.isOvernight; }),
    overnightTrolleys: trolleys.filter(function(t) { return t.isOvernight; }),
    ovenStart: ovenStart,
    ovenReady: ovenReady,
    ovenShutdown: ovenShutdown,
    ovenId: ovenId,
    dateStr: dateStr,
    overnightFrom: overnightFrom
  };
}

// Chart.js custom plugin for oven vertical lines and trolley bands
var ovenChartAnnotationPlugin = {
  id: 'ovenAnnotations',
  beforeDraw: function(chart) {
    var meta = chart.options.plugins.ovenAnnotations;
    if (!meta) return;
    var ctx = chart.ctx;
    var xScale = chart.scales.x;
    var yScale = chart.scales.y;
    var chartArea = chart.chartArea;

    // Draw trolley bands (legacy support)
    if (meta.bands && meta.bands.length > 0) {
      meta.bands.forEach(function(band) {
        var xStart = xScale.getPixelForValue(band.startIdx);
        var xEnd = xScale.getPixelForValue(band.endIdx);
        if (xEnd < xStart) return;
        ctx.save();
        ctx.fillStyle = band.bg;
        ctx.fillRect(xStart, chartArea.top, xEnd - xStart, chartArea.bottom - chartArea.top);
        ctx.restore();
      });
    }

    // Draw trolley markers (vào/ra lò nhẹ nhàng)
    if (meta.trolleyMarkers) {
      meta.trolleyMarkers.forEach(function(m) {
        // Vào lò: tam giác xanh nhỏ ở dưới trục X
        if (m.inIdx != null) {
          var xIn = xScale.getPixelForValue(m.inIdx);
          ctx.save();
          ctx.strokeStyle = 'rgba(34,197,94,0.3)';
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 3]);
          ctx.beginPath(); ctx.moveTo(xIn, chartArea.top); ctx.lineTo(xIn, chartArea.bottom); ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }
        // Ra lò: đường đứt nhạt
        if (m.outIdx != null) {
          var xOut = xScale.getPixelForValue(m.outIdx);
          ctx.save();
          ctx.strokeStyle = 'rgba(239,68,68,0.2)';
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 3]);
          ctx.beginPath(); ctx.moveTo(xOut, chartArea.top); ctx.lineTo(xOut, chartArea.bottom); ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }
      });
    }

    // Draw oven timing vertical lines (mở lò / đạt nhiệt / tắt lò)
    if (meta.vLines) {
      meta.vLines.forEach(function(vl) {
        if (vl.idx == null) return;
        var x = xScale.getPixelForValue(vl.idx);
        ctx.save();
        ctx.strokeStyle = vl.color;
        ctx.lineWidth = 2;
        ctx.setLineDash(vl.dash || [6, 4]);
        ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
        ctx.setLineDash([]);
        // Label badge
        var textW = ctx.measureText(vl.label).width + 10;
        ctx.fillStyle = vl.color;
        ctx.beginPath();
        var rx = x - textW / 2, ry = chartArea.bottom + 4, rw = textW, rh = 16, rr = 4;
        ctx.moveTo(rx + rr, ry); ctx.lineTo(rx + rw - rr, ry); ctx.quadraticCurveTo(rx + rw, ry, rx + rw, ry + rr);
        ctx.lineTo(rx + rw, ry + rh - rr); ctx.quadraticCurveTo(rx + rw, ry + rh, rx + rw - rr, ry + rh);
        ctx.lineTo(rx + rr, ry + rh); ctx.quadraticCurveTo(rx, ry + rh, rx, ry + rh - rr);
        ctx.lineTo(rx, ry + rr); ctx.quadraticCurveTo(rx, ry, rx + rr, ry); ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = '600 9px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(vl.label, x, ry + rh / 2);
        ctx.restore();
      });
    }
  }
};

function _findClosestIdx(tempLog, targetMins) {
  if (!tempLog || tempLog.length === 0 || targetMins == null) return null;
  var bestIdx = 0, bestDiff = Math.abs(tempLog[0].mins - targetMins);
  for (var i = 1; i < tempLog.length; i++) {
    var diff = Math.abs(tempLog[i].mins - targetMins);
    if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
  }
  return bestIdx;
}

function _renderCombinedChart(canvasId, data) {
  var canvas = document.getElementById(canvasId);
  if (!canvas) return;
  var wrap = canvas.parentElement;

  if (data.tempLog.length === 0) {
    wrap.innerHTML = '<div class="oven-chart-no-data">Ch\u01B0a c\u00F3 d\u1EEF li\u1EC7u nhi\u1EC7t \u0111\u1ED9</div>';
    return;
  }

  // Build full timeline from oven start to oven shutdown
  var firstMins = data.tempLog[0].mins;
  var lastMins = data.tempLog[data.tempLog.length - 1].mins;
  var rangeStart = data.ovenStart != null ? Math.min(data.ovenStart, firstMins) : firstMins;
  var rangeEnd = data.ovenShutdown != null ? Math.max(data.ovenShutdown, lastMins) : lastMins;
  var timeline = _buildFullTimeline(data.tempLog, rangeStart, rangeEnd);

  var labels = timeline.map(function(t) { return t.time; });
  var b1Data = timeline.map(function(t) { return t.b1; });
  var b2Data = timeline.map(function(t) { return t.b2; });

  // Build trolley time markers (không dùng band nữa, chỉ đánh dấu vào/ra)
  var trolleyMarkers = [];
  data.sameDayTrolleys.forEach(function(t) {
    trolleyMarkers.push({
      inIdx: _findClosestIdx(timeline, t.inMins),
      outIdx: t.outMins != null ? _findClosestIdx(timeline, t.outMins) : null,
      trolleyNo: t.trolleyNo
    });
  });

  // Build oven timing vertical lines
  var vLines = [];
  if (data.ovenStart != null) vLines.push({ idx: _findClosestIdx(timeline, data.ovenStart), color: '#22c55e', label: 'M\u1EDF l\u00F2', dash: [6, 4] });
  if (data.ovenReady != null) vLines.push({ idx: _findClosestIdx(timeline, data.ovenReady), color: '#0068FF', label: '\u0110\u1EA1t nhi\u1EC7t', dash: [6, 4] });
  if (data.ovenShutdown != null) vLines.push({ idx: _findClosestIdx(timeline, data.ovenShutdown), color: '#ef4444', label: 'T\u1EAFt l\u00F2', dash: [6, 4] });

  // Gradient fill cho đường nhiệt
  var ctx = canvas.getContext('2d');
  var gradB1 = ctx.createLinearGradient(0, 0, 0, 340);
  gradB1.addColorStop(0, 'rgba(249,115,22,0.25)');
  gradB1.addColorStop(1, 'rgba(249,115,22,0.02)');
  var gradB2 = ctx.createLinearGradient(0, 0, 0, 340);
  gradB2.addColorStop(0, 'rgba(59,130,246,0.2)');
  gradB2.addColorStop(1, 'rgba(59,130,246,0.02)');

  var chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: '\u0110\u1EA7u \u0111\u1ED1t 1 (\u00B0C)',
          data: b1Data,
          borderColor: '#f97316',
          backgroundColor: gradB1,
          borderWidth: 2.5,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: '#f97316',
          pointHoverBorderColor: '#fff',
          pointHoverBorderWidth: 2,
          tension: 0.4,
          fill: true,
          spanGaps: true
        },
        {
          label: '\u0110\u1EA7u \u0111\u1ED1t 2 (\u00B0C)',
          data: b2Data,
          borderColor: '#3b82f6',
          backgroundColor: gradB2,
          borderWidth: 2.5,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: '#3b82f6',
          pointHoverBorderColor: '#fff',
          pointHoverBorderWidth: 2,
          tension: 0.4,
          fill: true,
          spanGaps: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          align: 'end',
          labels: {
            color: '#475569', font: { size: 11, weight: '500' },
            usePointStyle: true, pointStyle: 'circle', pointStyleWidth: 8,
            padding: 16, boxWidth: 8, boxHeight: 8
          }
        },
        tooltip: {
          backgroundColor: '#fff',
          titleColor: '#111',
          bodyColor: '#333',
          titleFont: { size: 12, weight: '600' },
          bodyFont: { size: 12 },
          borderColor: '#e2e8f0',
          borderWidth: 1,
          padding: { top: 10, bottom: 10, left: 14, right: 14 },
          cornerRadius: 10,
          boxPadding: 6,
          displayColors: true,
          callbacks: {
            title: function(tooltipItems) { return tooltipItems[0].label; },
            afterBody: function(tooltipItems) {
              var idx = tooltipItems[0].dataIndex;
              var active = [];
              trolleyMarkers.forEach(function(m) {
                if (m.inIdx === idx) active.push('#' + m.trolleyNo + ' v\u00E0o l\u00F2');
                if (m.outIdx === idx) active.push('#' + m.trolleyNo + ' ra l\u00F2');
              });
              return active.length > 0 ? ['\u2014\u2014\u2014\u2014\u2014\u2014\u2014'].concat(active) : [];
            }
          }
        },
        ovenAnnotations: { bands: [], vLines: vLines, trolleyMarkers: trolleyMarkers }
      },
      scales: {
        x: {
          ticks: { color: '#94a3b8', font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 20 },
          grid: { color: 'rgba(0,0,0,0.04)', drawTicks: false },
          border: { color: 'rgba(0,0,0,0.08)' }
        },
        y: {
          beginAtZero: false, grace: '10%',
          ticks: { color: '#94a3b8', font: { size: 10 }, callback: function(v) { return v + '\u00B0'; }, padding: 8 },
          grid: { color: 'rgba(0,0,0,0.04)', drawTicks: false },
          border: { display: false }
        }
      }
    },
    plugins: [ovenChartAnnotationPlugin]
  });
  _ovenChartInstances.push(chart);
}

async function _renderQNCharts(containerId, data) {
  var container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  if (data.overnightTrolleys.length === 0) return;

  // Fetch PREVIOUS day's oven data (ovenDailyOps → source record fallback)
  var prevDayData = await _loadPrevDayOvenData(data.ovenId, data.dateStr, data.overnightFrom);

  var prevDayTempLog = [];
  var prevDayShutdown = null;
  if (prevDayData && prevDayData.tempLog && Array.isArray(prevDayData.tempLog)) {
    prevDayData.tempLog.forEach(function(tl) {
      if (tl.time && /^\d{2}:\d{2}$/.test(tl.time)) {
        prevDayTempLog.push({ time: tl.time, mins: _ovenTimeToMins(tl.time), b1: tl.burner1 != null ? tl.burner1 : null, b2: tl.burner2 != null ? tl.burner2 : null });
      }
    });
    prevDayTempLog.sort(function(a, b) { return a.mins - b.mins; });
    if (prevDayData.ovenShutdownTime) prevDayShutdown = _ovenTimeToMins(prevDayData.ovenShutdownTime);
  }

  data.overnightTrolleys.forEach(function(trolley, tIdx) {
    var wrapDiv = document.createElement('div');
    wrapDiv.className = 'oven-qn-chart-wrap';

    var title = document.createElement('div');
    title.className = 'oven-qn-chart-title';
    title.innerHTML = 'Th\u00F9ng #' + trolley.trolleyNo +
      ' <span class="heat-badge overnight">QN</span>' +
      ' <span style="font-size:12px;color:var(--text-muted);">' + trolley.timeIn + ' \u2192 ' +
      (prevDayShutdown != null ? _ovenMinsToTime(prevDayShutdown) : '?') +
      ' + ' + (data.ovenStart != null ? _ovenMinsToTime(data.ovenStart) : '?') +
      ' \u2192 ' + (trolley.timeOut || '?') + '</span>';
    wrapDiv.appendChild(title);

    var canvasWrap = document.createElement('div');
    canvasWrap.style.cssText = 'position:relative;height:240px;';
    var canvas = document.createElement('canvas');
    canvas.id = 'ovenChartQN_' + tIdx;
    canvasWrap.appendChild(canvas);
    wrapDiv.appendChild(canvasWrap);
    container.appendChild(wrapDiv);

    // Build combined temp data: D1 (prev day: entry→shutdown) + gap + D2 (today: start→exit)
    var chartLabels = [];
    var chartB1 = [];
    var chartB2 = [];
    var gapIdx = null;

    // D1: previous day's temp from trolley entry to shutdown
    if (prevDayTempLog.length > 0) {
      var d1End = prevDayShutdown != null ? prevDayShutdown : (prevDayTempLog.length > 0 ? prevDayTempLog[prevDayTempLog.length - 1].mins : null);
      prevDayTempLog.forEach(function(tl) {
        if (tl.mins >= trolley.inMins && (d1End == null || tl.mins <= d1End)) {
          chartLabels.push('D1 ' + tl.time);
          chartB1.push(tl.b1);
          chartB2.push(tl.b2);
        }
      });
    }

    // D2: current day's temp from oven start to trolley exit
    var d2Start = data.ovenStart != null ? data.ovenStart : 0;
    var d2End = trolley.outMins != null ? trolley.outMins : (data.tempLog.length > 0 ? data.tempLog[data.tempLog.length - 1].mins : 1440);
    var d2Entries = data.tempLog.filter(function(tl) { return tl.mins >= d2Start && tl.mins <= d2End; });

    // Gap marker between D1 and D2
    if (chartLabels.length > 0 && d2Entries.length > 0) {
      gapIdx = chartLabels.length;
      chartLabels.push('\u23F8 L\u00F2 t\u1EAFt');
      chartB1.push(null);
      chartB2.push(null);
    }

    d2Entries.forEach(function(tl) {
      chartLabels.push('D2 ' + tl.time);
      chartB1.push(tl.b1);
      chartB2.push(tl.b2);
    });

    if (chartLabels.length === 0) {
      canvasWrap.innerHTML = '<div class="oven-chart-no-data">Ch\u01B0a c\u00F3 d\u1EEF li\u1EC7u nhi\u1EC7t \u0111\u1ED9</div>';
      return;
    }

    // Info message if no prev-day data
    if (prevDayTempLog.length === 0) {
      var info = document.createElement('div');
      info.style.cssText = 'font-size:12px;color:var(--text-muted);margin-top:4px;padding:4px 8px;background:rgba(99,102,241,0.06);border-radius:4px;';
      info.textContent = 'Ch\u01B0a c\u00F3 d\u1EEF li\u1EC7u nhi\u1EC7t ng\u00E0y tr\u01B0\u1EDBc \u2014 ch\u1EC9 hi\u1EC3n ph\u1EA7n ng\u00E0y hi\u1EC7n t\u1EA1i';
      wrapDiv.appendChild(info);
    }

    // Vertical lines for QN chart
    var qnVLines = [];
    // D1: Entry time marker
    if (chartLabels.length > 0 && prevDayTempLog.length > 0) {
      qnVLines.push({ idx: 0, color: '#22c55e', label: 'V\u00E0o l\u00F2', dash: [4, 3] });
    }
    // D1: Shutdown marker (last D1 point)
    if (gapIdx != null) qnVLines.push({ idx: gapIdx - 1, color: '#ef4444', label: 'T\u1EAFt l\u00F2 D1', dash: [4, 3] });
    // D2: start
    if (gapIdx != null && chartLabels.length > gapIdx + 1) qnVLines.push({ idx: gapIdx + 1, color: '#22c55e', label: 'M\u1EDF l\u00F2 D2', dash: [4, 3] });
    // D2: Exit marker
    if (trolley.outMins != null) qnVLines.push({ idx: chartLabels.length - 1, color: '#f97316', label: 'Ra l\u00F2', dash: [4, 3] });

    var qnChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: chartLabels,
        datasets: [
          {
            label: '\u0110\u01101 (\u00B0C)',
            data: chartB1,
            borderColor: '#f97316',
            borderWidth: 2,
            pointRadius: 2,
            tension: 0.3,
            fill: false,
            spanGaps: false
          },
          {
            label: '\u0110\u01102 (\u00B0C)',
            data: chartB2,
            borderColor: '#3b82f6',
            borderWidth: 2,
            pointRadius: 2,
            tension: 0.3,
            fill: false,
            spanGaps: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            labels: { color: '#94a3b8', font: { size: 10 }, usePointStyle: true, pointStyle: 'line' }
          },
          tooltip: {
            backgroundColor: 'rgba(15,23,42,0.95)',
            titleColor: '#e2e8f0',
            bodyColor: '#cbd5e1',
            borderColor: 'rgba(249,115,22,0.3)',
            borderWidth: 1
          },
          ovenAnnotations: { bands: [], vLines: qnVLines }
        },
        scales: {
          x: {
            ticks: { color: '#64748b', font: { size: 9 }, maxRotation: 45 },
            grid: { color: 'rgba(148,163,184,0.08)' }
          },
          y: {
            beginAtZero: false,
            ticks: { color: '#64748b', font: { size: 10 }, callback: function(v) { return v + '\u00B0C'; } },
            grid: { color: 'rgba(148,163,184,0.08)' }
          }
        }
      },
      plugins: [ovenChartAnnotationPlugin]
    });
    _ovenChartInstances.push(qnChart);
  });
}

// Store chart data globally for per-trolley re-render
var _ovenChartData = null;
var _perTrolleyChartInstance = null;

/**
 * Per-trolley chart annotation plugin — draws vLines at TOP of chart (staggered) to avoid overlap.
 */
var perTrolleyAnnotationPlugin = {
  id: 'perTrolleyAnnotations',
  afterDraw: function(chart) {
    var meta = chart.options.plugins.perTrolleyAnnotations;
    if (!meta) return;
    var ctx = chart.ctx;
    var xScale = chart.scales.x;
    var area = chart.chartArea;

    // Draw vLines with staggered TOP labels
    if (meta.vLines) {
      meta.vLines.forEach(function(vl, i) {
        if (vl.idx == null) return;
        var x = xScale.getPixelForValue(vl.idx);
        ctx.save();
        ctx.strokeStyle = vl.color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash(vl.dash || [6, 4]);
        ctx.beginPath(); ctx.moveTo(x, area.top); ctx.lineTo(x, area.bottom); ctx.stroke();
        ctx.setLineDash([]);
        // Staggered label at top: alternate y position
        var yOff = area.top - 6 - (i % 2) * 12;
        ctx.fillStyle = vl.color;
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(vl.label, x, yOff);
        ctx.restore();
      });
    }

    // Gap marker for overnight
    if (meta.gapLabel) {
      var gl = meta.gapLabel;
      if (gl.startIdx != null && gl.endIdx != null) {
        var x1 = xScale.getPixelForValue(gl.startIdx);
        var x2 = xScale.getPixelForValue(gl.endIdx);
        ctx.save();
        ctx.fillStyle = 'rgba(148,163,184,0.06)';
        ctx.fillRect(x1, area.top, x2 - x1, area.bottom - area.top);
        ctx.fillStyle = '#64748b';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(gl.text, (x1 + x2) / 2, (area.top + area.bottom) / 2);
        ctx.restore();
      }
    }
  }
};

/**
 * Render per-trolley chart.
 * Same-day: temp from entry → exit only.
 * Overnight: D1 (entry → shutdown) + gap + D2 (oven start → exit), fetches D2 data from Firestore.
 */
async function _renderSelectedTrolleyChart() {
  var sel = document.getElementById('ovenChartTrolleySelect');
  var wrap = document.getElementById('ovenChartPerTrolleyWrap');
  var info = document.getElementById('ovenChartTrolleyInfo');
  if (!sel || !wrap || !_ovenChartData) return;

  var trolleyNo = parseInt(sel.value);
  var qnSection = document.getElementById('ovenChartQNSection');
  if (!trolleyNo) {
    wrap.innerHTML = '<div class="oven-chart-no-data">Ch\u1ECDn th\u00F9ng \u0111\u1EC3 xem bi\u1EC3u \u0111\u1ED3</div>';
    if (info) info.textContent = '';
    // Show QN section when no trolley selected
    if (qnSection && _ovenChartData && _ovenChartData.overnightTrolleys.length > 0) qnSection.style.display = '';
    return;
  }
  // Hide QN section when a specific trolley is selected (per-trolley chart already shows it)
  if (qnSection) qnSection.style.display = 'none';

  var data = _ovenChartData;
  var trolley = data.trolleys.find(function(t) { return t.trolleyNo === trolleyNo; });
  if (!trolley) return;

  // Destroy previous
  if (_perTrolleyChartInstance) { _perTrolleyChartInstance.destroy(); _perTrolleyChartInstance = null; }

  var startMins = trolley.inMins;
  var endMins = trolley.outMins;

  if (trolley.isOvernight) {
    await _renderOvernightTrolleyChart(wrap, info, data, trolley);
  } else {
    _renderSameDayTrolleyChart(wrap, info, data, trolley);
  }
}

function _calcTempStats(logEntries, fromMins, toMins) {
  var filtered = logEntries.filter(function(t) { return t.mins >= fromMins && t.mins <= toMins; });
  var sumB1 = 0, cntB1 = 0, maxB1 = null, sumB2 = 0, cntB2 = 0, maxB2 = null;
  filtered.forEach(function(t) {
    if (t.b1 != null) { sumB1 += t.b1; cntB1++; if (maxB1 === null || t.b1 > maxB1) maxB1 = t.b1; }
    if (t.b2 != null) { sumB2 += t.b2; cntB2++; if (maxB2 === null || t.b2 > maxB2) maxB2 = t.b2; }
  });
  return {
    avgB1: cntB1 > 0 ? Math.round(sumB1 / cntB1 * 10) / 10 : null, maxB1: maxB1,
    avgB2: cntB2 > 0 ? Math.round(sumB2 / cntB2 * 10) / 10 : null, maxB2: maxB2
  };
}

function _buildPerTrolleyChart(canvas, labels, b1Data, b2Data, vLines, subtitle, gapLabel) {
  return new Chart(canvas, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: '\u0110\u01101 (\u00B0C)', data: b1Data,
          borderColor: '#f97316', backgroundColor: 'rgba(249,115,22,0.08)',
          borderWidth: 2, pointRadius: 2, pointHoverRadius: 4, tension: 0.3, fill: true, spanGaps: true
        },
        {
          label: '\u0110\u01102 (\u00B0C)', data: b2Data,
          borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.05)',
          borderWidth: 2, pointRadius: 2, pointHoverRadius: 4, tension: 0.3, fill: true, spanGaps: true
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 30 } },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#94a3b8', font: { size: 11 }, usePointStyle: true, pointStyle: 'line' } },
        subtitle: {
          display: subtitle && subtitle.length > 0,
          text: subtitle ? subtitle.join('  |  ') : '',
          color: '#94a3b8', font: { size: 11 }, padding: { bottom: 4 }
        },
        tooltip: {
          backgroundColor: 'rgba(15,23,42,0.95)', titleColor: '#e2e8f0', bodyColor: '#cbd5e1',
          borderColor: 'rgba(249,115,22,0.3)', borderWidth: 1
        },
        perTrolleyAnnotations: { vLines: vLines, gapLabel: gapLabel || null }
      },
      scales: {
        x: { ticks: { color: '#64748b', font: { size: 9 }, maxRotation: 45, autoSkip: true, maxTicksLimit: 20 }, grid: { color: 'rgba(148,163,184,0.08)' } },
        y: { beginAtZero: false, grace: '5%', ticks: { color: '#64748b', font: { size: 10 }, callback: function(v) { return v + '\u00B0C'; } }, grid: { color: 'rgba(148,163,184,0.08)' } }
      }
    },
    plugins: [perTrolleyAnnotationPlugin]
  });
}

/**
 * Build a full timeline from startMins to endMins at 10-min intervals,
 * mapping temp log data onto matching slots. Slots without data get null.
 */
function _buildFullTimeline(tempLog, startMins, endMins) {
  if (!tempLog || tempLog.length === 0) return [];

  // Dùng thời gian thực từ tempLog thay vì slot chẵn
  // Kết hợp: các mốc thời gian thực + điểm start/end nếu chưa có
  var pointSet = {};
  tempLog.forEach(function(t) {
    if (t.mins >= startMins && t.mins <= endMins) {
      pointSet[t.mins] = { b1: t.b1, b2: t.b2 };
    }
  });

  // Thêm start/end nếu chưa có (dùng nearest neighbor)
  if (!pointSet[startMins]) pointSet[startMins] = _nearestTemp(tempLog, startMins);
  if (!pointSet[endMins]) pointSet[endMins] = _nearestTemp(tempLog, endMins);

  // Nếu không có dữ liệu trong range, tạo slot chẵn và map nearest
  var keys = Object.keys(pointSet).map(Number).sort(function(a, b) { return a - b; });
  if (keys.length < 2) {
    // Fallback: slot chẵn 10 phút
    var slotStart = Math.floor(startMins / 10) * 10;
    var slotEnd = Math.ceil(endMins / 10) * 10;
    keys = [];
    for (var m = slotStart; m <= slotEnd; m += 10) {
      keys.push(m);
      if (!pointSet[m]) pointSet[m] = _nearestTemp(tempLog, m);
    }
  }

  var timeline = [];
  keys.forEach(function(m) {
    var hh = String(Math.floor(m / 60) % 24).padStart(2, '0');
    var mm = String(m % 60).padStart(2, '0');
    var td = pointSet[m] || { b1: null, b2: null };
    timeline.push({ time: hh + ':' + mm, mins: m, b1: td.b1, b2: td.b2 });
  });
  return timeline;
}

function _nearestTemp(tempLog, targetMins) {
  if (!tempLog || tempLog.length === 0) return { b1: null, b2: null };
  var best = tempLog[0], bestDiff = Math.abs(tempLog[0].mins - targetMins);
  for (var i = 1; i < tempLog.length; i++) {
    var diff = Math.abs(tempLog[i].mins - targetMins);
    if (diff < bestDiff) { bestDiff = diff; best = tempLog[i]; }
  }
  // Chỉ dùng nếu cách không quá 15 phút
  if (bestDiff > 15) return { b1: null, b2: null };
  return { b1: best.b1, b2: best.b2 };
}

/**
 * Same-day trolley: show full timeline from entry → exit.
 * Generates 10-min slots, maps temp data where available.
 */
function _renderSameDayTrolleyChart(wrap, infoEl, data, trolley) {
  var startMins = trolley.inMins;
  var endMins = trolley.outMins != null ? trolley.outMins : (data.tempLog.length > 0 ? data.tempLog[data.tempLog.length - 1].mins : startMins + 60);

  // Build full timeline from entry to exit
  var timeline = _buildFullTimeline(data.tempLog, startMins, endMins);

  if (timeline.length === 0) {
    wrap.innerHTML = '<div class="oven-chart-no-data">Kh\u00F4ng c\u00F3 d\u1EEF li\u1EC7u</div>';
    return;
  }

  // Info text
  var dur = trolley.outMins != null ? (trolley.outMins - startMins) : null;
  var infoText = 'V\u00E0o: ' + trolley.timeIn;
  if (trolley.timeOut) infoText += '  \u2192  Ra: ' + trolley.timeOut;
  if (dur != null) infoText += '  (' + Math.floor(dur / 60) + 'h ' + (dur % 60) + 'm)';
  if (infoEl) infoEl.textContent = infoText;

  // Temp stats (only where data exists)
  var stats = _calcTempStats(data.tempLog, startMins, endMins);
  var subtitle = [];
  if (stats.avgB1 != null) subtitle.push('\u0110\u01101: TB ' + stats.avgB1 + '\u00B0C, Max ' + stats.maxB1 + '\u00B0C');
  if (stats.avgB2 != null) subtitle.push('\u0110\u01102: TB ' + stats.avgB2 + '\u00B0C, Max ' + stats.maxB2 + '\u00B0C');

  // Reset canvas
  wrap.innerHTML = '<canvas id="ovenChartPerTrolley"></canvas>';
  var canvas = document.getElementById('ovenChartPerTrolley');
  if (!canvas) return;

  var labels = timeline.map(function(t) { return t.time; });
  var b1 = timeline.map(function(t) { return t.b1; });
  var b2 = timeline.map(function(t) { return t.b2; });

  // Vertical lines
  var vLines = [];
  vLines.push({ idx: _findClosestIdx(timeline, startMins), color: '#a855f7', label: 'V\u00E0o ' + trolley.timeIn, dash: [2, 2] });
  if (trolley.outMins != null) {
    vLines.push({ idx: _findClosestIdx(timeline, trolley.outMins), color: '#ec4899', label: 'Ra ' + trolley.timeOut, dash: [2, 2] });
  }
  if (data.ovenReady != null && data.ovenReady >= startMins && data.ovenReady <= endMins) {
    vLines.push({ idx: _findClosestIdx(timeline, data.ovenReady), color: '#3b82f6', label: '\u0110\u1EA1t nhi\u1EC7t', dash: [6, 4] });
  }
  if (data.ovenShutdown != null && data.ovenShutdown >= startMins && data.ovenShutdown <= endMins) {
    vLines.push({ idx: _findClosestIdx(timeline, data.ovenShutdown), color: '#ef4444', label: 'T\u1EAFt l\u00F2', dash: [6, 4] });
  }

  _perTrolleyChartInstance = _buildPerTrolleyChart(canvas, labels, b1, b2, vLines, subtitle, null);
}

/**
 * Overnight trolley: D1 (entry → shutdown on prev day) + gap + D2 (oven start → exit on current day).
 * Fetches D1 (previous day) temp data from ovenDailyOps; D2 is the current record's data.
 */
async function _renderOvernightTrolleyChart(wrap, infoEl, data, trolley) {
  var entryMins = trolley.inMins;
  var exitMins = trolley.outMins;

  // Info
  if (infoEl) infoEl.textContent = 'Th\u00F9ng qua \u0111\u00EAm \u00B7 V\u00E0o: ' + trolley.timeIn + (trolley.timeOut ? '  \u2192  Ra: ' + trolley.timeOut : ' (ch\u01B0a ra l\u00F2)');

  // D1: fetch PREVIOUS day's oven data (ovenDailyOps → source record fallback)
  var d1Ops = await _loadPrevDayOvenData(data.ovenId, data.dateStr, data.overnightFrom);

  var d1Log = [];
  var d1Shutdown = null;
  if (d1Ops) {
    d1Shutdown = _ovenTimeToMins(d1Ops.ovenShutdownTime || '');
    var d1End = d1Shutdown != null ? d1Shutdown + 5 : 1440;
    var d1Start = entryMins > 0 ? entryMins - 5 : 0;
    if (d1Ops.tempLog && Array.isArray(d1Ops.tempLog)) {
      d1Ops.tempLog.forEach(function(tl) {
        var mins = _ovenTimeToMins(tl.time || '');
        if (mins != null && mins >= d1Start && mins <= d1End) {
          d1Log.push({ time: tl.time, mins: mins, b1: tl.burner1, b2: tl.burner2 });
        }
      });
      d1Log.sort(function(a, b) { return a.mins - b.mins; });
    }
  }

  // D2: current day's data (from oven start to exit)
  var d2OvenStart = data.ovenStart;
  var d2End = exitMins != null ? exitMins + 5 : (data.ovenShutdown != null ? data.ovenShutdown + 5 : (data.tempLog.length > 0 ? data.tempLog[data.tempLog.length - 1].mins + 5 : 600));
  var d2Start = d2OvenStart != null ? d2OvenStart - 5 : 0;
  var d2Log = data.tempLog.filter(function(t) { return t.mins >= d2Start && t.mins <= d2End; });

  // Combine: D1 labels → gap → D2 labels
  var labels = [], b1Arr = [], b2Arr = [];
  d1Log.forEach(function(t) {
    labels.push('D1 ' + t.time);
    b1Arr.push(t.b1);
    b2Arr.push(t.b2);
  });

  var gapLabel = null;
  if (d1Log.length > 0 && d2Log.length > 0) {
    // Add gap entry (null data point)
    var gapStartIdx = labels.length;
    labels.push('\u2014');
    b1Arr.push(null);
    b2Arr.push(null);
    var gapEndIdx = labels.length - 1;
    gapLabel = { startIdx: gapStartIdx, endIdx: gapEndIdx, text: 'Qua \u0111\u00EAm' };
  }

  d2Log.forEach(function(t) {
    labels.push('D2 ' + t.time);
    b1Arr.push(t.b1);
    b2Arr.push(t.b2);
  });

  if (labels.length === 0) {
    wrap.innerHTML = '<div class="oven-chart-no-data">Kh\u00F4ng c\u00F3 d\u1EEF li\u1EC7u nhi\u1EC7t</div>';
    return;
  }

  // Stats: combine D1 + D2
  var allLog = d1Log.concat(d2Log);
  var sumB1 = 0, cntB1 = 0, maxB1 = null, sumB2 = 0, cntB2 = 0, maxB2 = null;
  allLog.forEach(function(t) {
    if (t.b1 != null) { sumB1 += t.b1; cntB1++; if (maxB1 === null || t.b1 > maxB1) maxB1 = t.b1; }
    if (t.b2 != null) { sumB2 += t.b2; cntB2++; if (maxB2 === null || t.b2 > maxB2) maxB2 = t.b2; }
  });
  var subtitle = [];
  if (cntB1 > 0) subtitle.push('\u0110\u01101: TB ' + (Math.round(sumB1 / cntB1 * 10) / 10) + '\u00B0C, Max ' + maxB1 + '\u00B0C');
  if (cntB2 > 0) subtitle.push('\u0110\u01102: TB ' + (Math.round(sumB2 / cntB2 * 10) / 10) + '\u00B0C, Max ' + maxB2 + '\u00B0C');

  // Reset canvas
  wrap.innerHTML = '<canvas id="ovenChartPerTrolley"></canvas>';
  var canvas = document.getElementById('ovenChartPerTrolley');
  if (!canvas) return;

  // Vertical lines
  var vLines = [];
  var d1Offset = 0; // D1 entries start at index 0
  var d2Offset = d1Log.length + (gapLabel ? 1 : 0); // D2 entries start after D1 + gap

  // D1: entry
  if (d1Log.length > 0) {
    vLines.push({ idx: d1Offset + _findClosestIdx(d1Log, entryMins), color: '#a855f7', label: 'V\u00E0o ' + trolley.timeIn, dash: [2, 2] });
  }
  // D1: shutdown
  if (d1Shutdown != null && d1Log.length > 0) {
    vLines.push({ idx: d1Offset + _findClosestIdx(d1Log, d1Shutdown), color: '#ef4444', label: 'T\u1EAFt l\u00F2 D1', dash: [6, 4] });
  }
  // D2: oven start
  if (d2OvenStart != null && d2Log.length > 0) {
    vLines.push({ idx: d2Offset + _findClosestIdx(d2Log, d2OvenStart), color: '#22c55e', label: 'M\u1EDF l\u00F2 D2', dash: [6, 4] });
  }
  // D2: exit
  if (exitMins != null && d2Log.length > 0) {
    vLines.push({ idx: d2Offset + _findClosestIdx(d2Log, exitMins), color: '#ec4899', label: 'Ra ' + trolley.timeOut, dash: [2, 2] });
  }

  _perTrolleyChartInstance = _buildPerTrolleyChart(canvas, labels, b1Arr, b2Arr, vLines, subtitle, gapLabel);
}

async function openOvenTempChart() {
  var data = _collectTempChartData();

  if (data.tempLog.length === 0 && data.trolleys.length === 0) {
    showToast('Ch\u01B0a c\u00F3 d\u1EEF li\u1EC7u nhi\u1EC7t \u0111\u1ED9 ho\u1EB7c th\u00F9ng s\u1EA5y', 'warning');
    return;
  }

  _destroyOvenCharts();
  _ovenChartData = data;

  // Reset canvas
  var combWrap = document.getElementById('ovenChartCombinedWrap');
  if (combWrap) combWrap.innerHTML = '<canvas id="ovenChartCombined"></canvas>';

  openOvenChartModal();

  // Render combined chart
  _renderCombinedChart('ovenChartCombined', data);

  // Populate per-trolley dropdown (only trolleys that have entered the oven)
  var trolleySelect = document.getElementById('ovenChartTrolleySelect');
  if (trolleySelect) {
    var opts = '<option value="">-- Ch\u1ECDn th\u00F9ng --</option>';
    data.trolleys.forEach(function(t) {
      var label = 'Th\u00F9ng #' + t.trolleyNo + ' (' + t.timeIn;
      if (t.timeOut) label += ' \u2192 ' + t.timeOut;
      label += ')';
      opts += '<option value="' + t.trolleyNo + '">' + label + '</option>';
    });
    trolleySelect.innerHTML = opts;
  }
  // Reset per-trolley chart
  var ptWrap = document.getElementById('ovenChartPerTrolleyWrap');
  if (ptWrap) ptWrap.innerHTML = '<div class="oven-chart-no-data">Ch\u1ECDn th\u00F9ng \u0111\u1EC3 xem bi\u1EC3u \u0111\u1ED3 nhi\u1EC7t ri\u00EAng</div>';

  // Render QN section
  var qnSection = document.getElementById('ovenChartQNSection');
  if (data.overnightTrolleys.length > 0) {
    if (qnSection) qnSection.style.display = '';
    await _renderQNCharts('ovenChartQNContainer', data);
  } else {
    if (qnSection) qnSection.style.display = 'none';
  }
}

// Mở biểu đồ nhiệt từ dashboard card (không cần modal sấy đang mở)
async function openOvenTempChartFromRecord(recordId) {
  var rec = (window.lineRecords || []).find(function(r) { return r.id === recordId; });
  if (!rec || !rec.stageData || !rec.stageData.say) {
    showToast('Kh\u00F4ng c\u00F3 d\u1EEF li\u1EC7u s\u1EA5y', 'warning');
    return;
  }
  var sd = rec.stageData.say;

  // Build tempLog from record data
  var tempLog = [];
  (sd.tempLog || []).forEach(function(tl) {
    if (tl.time && /^\d{2}:\d{2}$/.test(tl.time)) {
      tempLog.push({ time: tl.time, mins: _ovenTimeToMins(tl.time), b1: tl.burner1 != null ? tl.burner1 : null, b2: tl.burner2 != null ? tl.burner2 : null });
    }
  });
  tempLog.sort(function(a, b) { return a.mins - b.mins; });

  // Build trolleys
  var trolleys = [];
  (sd.trolleyDrying || []).forEach(function(t) {
    if (!t.trolleyNo) return;
    var timeIn = t.timeIn || '';
    var timeOut = t.timeOut || '';
    if (!/^\d{2}:\d{2}$/.test(timeIn)) return;
    trolleys.push({
      trolleyNo: t.trolleyNo,
      timeIn: timeIn,
      timeOut: /^\d{2}:\d{2}$/.test(timeOut) ? timeOut : null,
      inMins: _ovenTimeToMins(timeIn),
      outMins: /^\d{2}:\d{2}$/.test(timeOut) ? _ovenTimeToMins(timeOut) : null,
      isOvernight: t.overnight === true
    });
  });

  var data = {
    tempLog: tempLog,
    trolleys: trolleys,
    sameDayTrolleys: trolleys.filter(function(t) { return !t.isOvernight; }),
    overnightTrolleys: trolleys.filter(function(t) { return t.isOvernight; }),
    ovenStart: sd.ovenStartTime ? _ovenTimeToMins(sd.ovenStartTime) : null,
    ovenReady: sd.ovenReadyTime ? _ovenTimeToMins(sd.ovenReadyTime) : null,
    ovenShutdown: sd.ovenShutdownTime ? _ovenTimeToMins(sd.ovenShutdownTime) : null,
    ovenId: sd.ovenId || '',
    dateStr: rec.date || '',
    overnightFrom: sd.overnightFrom || null
  };

  if (data.tempLog.length === 0 && data.trolleys.length === 0) {
    showToast('Ch\u01B0a c\u00F3 d\u1EEF li\u1EC7u nhi\u1EC7t \u0111\u1ED9', 'warning');
    return;
  }

  _destroyOvenCharts();
  _ovenChartData = data;

  var combWrap = document.getElementById('ovenChartCombinedWrap');
  if (combWrap) combWrap.innerHTML = '<canvas id="ovenChartCombined"></canvas>';

  openOvenChartModal();
  _renderCombinedChart('ovenChartCombined', data);

  var trolleySelect = document.getElementById('ovenChartTrolleySelect');
  if (trolleySelect) {
    var opts = '<option value="">-- Ch\u1ECDn th\u00F9ng --</option>';
    data.trolleys.forEach(function(t) {
      var label = 'Th\u00F9ng #' + t.trolleyNo + ' (' + t.timeIn + (t.timeOut ? ' \u2192 ' + t.timeOut : '') + ')';
      opts += '<option value="' + t.trolleyNo + '">' + label + '</option>';
    });
    trolleySelect.innerHTML = opts;
  }
  var ptWrap = document.getElementById('ovenChartPerTrolleyWrap');
  if (ptWrap) ptWrap.innerHTML = '<div class="oven-chart-no-data">Ch\u1ECDn th\u00F9ng \u0111\u1EC3 xem bi\u1EC3u \u0111\u1ED3</div>';

  var qnSection = document.getElementById('ovenChartQNSection');
  if (data.overnightTrolleys.length > 0) {
    if (qnSection) qnSection.style.display = '';
    await _renderQNCharts('ovenChartQNContainer', data);
  } else {
    if (qnSection) qnSection.style.display = 'none';
  }
}

// ==================== SHIFT HANDOVER (Bàn giao ca sấy) ====================
var _shiftHandovers = []; // Array of handover records loaded from Firestore

/**
 * Get current shift handover state by reading shiftHandovers array.
 * Returns: { myShift, lastEndedShift, lastEndAction, needsAcceptance, isMyShiftEnded, isAdmin }
 */
async function _getShiftHandoverState() {
  var myShift = await getUserShiftCode();
  var isAdmin = !myShift; // null = admin/supervisor/non-ca_sx

  var lastEndAction = null;
  var lastAcceptAction = null;
  for (var i = _shiftHandovers.length - 1; i >= 0; i--) {
    if (!lastEndAction && _shiftHandovers[i].action === 'end_shift') lastEndAction = _shiftHandovers[i];
    if (!lastAcceptAction && _shiftHandovers[i].action === 'accept_shift') lastAcceptAction = _shiftHandovers[i];
    if (lastEndAction && lastAcceptAction) break;
  }

  // Ca trước đã kết thúc nhưng chưa ai tiếp nhận?
  var needsAcceptance = false;
  if (lastEndAction) {
    // Nếu chưa có accept sau end, hoặc accept cũ hơn end → cần tiếp nhận
    if (!lastAcceptAction || new Date(lastAcceptAction.at) < new Date(lastEndAction.at)) {
      needsAcceptance = true;
    }
  }

  // Ca hiện tại đã kết thúc chưa?
  var isMyShiftEnded = false;
  if (myShift && lastEndAction && lastEndAction.shiftCode === myShift) {
    // Kiểm tra: sau end_shift này, ca này đã tiếp nhận lại chưa?
    if (!lastAcceptAction || new Date(lastAcceptAction.at) < new Date(lastEndAction.at)) {
      isMyShiftEnded = true;
    }
  }

  return {
    myShift: myShift,
    isAdmin: isAdmin,
    lastEndAction: lastEndAction,
    lastAcceptAction: lastAcceptAction,
    needsAcceptance: needsAcceptance,
    isMyShiftEnded: isMyShiftEnded
  };
}

/**
 * Render shift handover bar UI.
 */
async function _renderShiftHandoverBar() {
  var bar = document.getElementById('shiftHandoverBar');
  if (!bar) return;

  var state = await _getShiftHandoverState();
  var infoEl = document.getElementById('shiftHandoverInfo');
  var actionsEl = document.getElementById('shiftHandoverActions');
  var historyEl = document.getElementById('shiftHandoverHistory');

  var shifts = _getSXShiftsCached();
  var myShiftName = '';
  if (state.myShift) {
    var found = shifts.find(function(s) { return s.code === state.myShift; });
    myShiftName = found ? found.name : state.myShift;
  }

  var user = window.currentUser;
  var userName = user ? (user.hoTen || user.name || '') : '';

  // Build info
  var infoHtml = '';
  if (state.isAdmin) {
    infoHtml = '<span class="shift-badge active">Qu\u1EA3n l\u00FD</span> <span>' + userName + '</span>';
  } else if (state.isMyShiftEnded) {
    infoHtml = '<span class="shift-badge ended">' + myShiftName + '</span> <span>' + userName + ' \u00B7 \u0110\u00E3 k\u1EBFt th\u00FAc ca</span>';
  } else if (state.needsAcceptance && state.lastEndAction && state.lastEndAction.shiftCode !== state.myShift) {
    infoHtml = '<span class="shift-badge waiting">' + myShiftName + '</span> <span>' + userName + ' \u00B7 Ch\u01B0a ti\u1EBFp nh\u1EADn</span>';
  } else {
    infoHtml = '<span class="shift-badge active">' + myShiftName + '</span> <span>' + userName + '</span>';
  }
  if (infoEl) infoEl.innerHTML = infoHtml;

  // Build action buttons
  var actHtml = '';
  if (state.isAdmin) {
    // Admin: shift selector + end/accept buttons + toggle
    var adminShiftOpts = '<option value="">-- Ch\u1ECDn ca --</option>';
    shifts.forEach(function(s) { adminShiftOpts += '<option value="' + s.code + '">' + s.name + '</option>'; });
    actHtml += '<select id="adminShiftSelect" style="font-size:12px;padding:3px 6px;border-radius:4px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text-primary);">' + adminShiftOpts + '</select>';
    actHtml += '<button class="shift-handover-btn end" onclick="endShift()">K\u1EBFt th\u00FAc ca</button>';
    actHtml += '<button class="shift-handover-btn accept" onclick="acceptShift()">Ti\u1EBFp nh\u1EADn ca</button>';
    actHtml += '<button class="shift-handover-btn toggle" onclick="_toggleShowAllShifts()" title="Hi\u1EC3n/\u1EA9n th\u00F9ng c\u1EE7a t\u1EA5t c\u1EA3 ca">T\u1EA5t c\u1EA3 ca</button>';
  } else {
    if (state.needsAcceptance && state.lastEndAction && state.lastEndAction.shiftCode !== state.myShift && !state.isMyShiftEnded) {
      // Ca trước đã kết thúc, ca này chưa tiếp nhận
      actHtml += '<button class="shift-handover-btn accept" onclick="acceptShift()">Ti\u1EBFp nh\u1EADn ca</button>';
    }
    if (!state.isMyShiftEnded) {
      actHtml += '<button class="shift-handover-btn end" onclick="endShift()">K\u1EBFt th\u00FAc ca</button>';
    }
  }
  // History toggle
  if (_shiftHandovers.length > 0) {
    actHtml += '<button class="shift-handover-btn toggle" onclick="_toggleShiftHistory()" style="font-size:12px;padding:3px 8px;">LS</button>';
  }
  if (actionsEl) actionsEl.innerHTML = actHtml;

  // Build history
  if (historyEl && _shiftHandovers.length > 0) {
    var hHtml = '<div style="font-weight:600;margin-bottom:4px;">L\u1ECBch s\u1EED b\u00E0n giao:</div>';
    _shiftHandovers.forEach(function(h) {
      var icon = h.action === 'end_shift' ? '\u23F9' : '\u25B6';
      var label = h.action === 'end_shift' ? 'K\u1EBFt th\u00FAc' : 'Ti\u1EBFp nh\u1EADn';
      var shiftInfo = shifts.find(function(s) { return s.code === h.shiftCode; });
      var shiftName = shiftInfo ? shiftInfo.name : h.shiftCode;
      var time = h.at ? new Date(h.at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '';
      hHtml += '<div style="margin:2px 0;">' + icon + ' ' + label + ' <b>' + shiftName + '</b> \u00B7 ' + (h.userName || '') + ' \u00B7 ' + time;
      if (h.action === 'end_shift' && h.trolleysExited) {
        hHtml += ' \u00B7 ' + h.trolleysExited.length + ' th\u00F9ng ra l\u00F2';
      }
      if (h.action === 'end_shift' && h.trolleysInOven) {
        hHtml += ', ' + h.trolleysInOven.length + ' th\u00F9ng c\u00F2n trong l\u00F2';
      }
      hHtml += '</div>';
    });
    historyEl.innerHTML = hHtml;
  }

  bar.style.display = '';
}

function _toggleShiftHistory() {
  var el = document.getElementById('shiftHandoverHistory');
  if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
}

var _showAllShifts = false;
function _toggleShowAllShifts() {
  _showAllShifts = !_showAllShifts;
  _filterTrolleysByShift();
}

/**
 * End current shift: mark exited trolleys, lock them, auto-save.
 */
async function endShift() {
  var myShift = await getUserShiftCode();
  // Admin: read from dropdown
  if (!myShift) {
    var adminSel = document.getElementById('adminShiftSelect');
    myShift = adminSel ? adminSel.value : '';
  }
  if (!myShift) {
    showToast('Vui l\u00F2ng ch\u1ECDn ca s\u1EA3n xu\u1EA5t c\u1EA7n k\u1EBFt th\u00FAc', 'warning');
    return;
  }

  // Confirm
  var shifts = _getSXShiftsCached();
  var shiftInfo = shifts.find(function(s) { return s.code === myShift; });
  var shiftName = shiftInfo ? shiftInfo.name : myShift;
  if (!(await showConfirm('X\u00E1c nh\u1EADn k\u1EBFt th\u00FAc ' + shiftName + '?\n\nC\u00E1c th\u00F9ng \u0111\u00E3 ra l\u00F2 s\u1EBD b\u1ECB kh\u00F3a.\nCa ti\u1EBFp theo s\u1EBD th\u1EA5y c\u00E1c th\u00F9ng c\u00F2n trong l\u00F2.'))) return;

  var user = window.currentUser;
  var userName = user ? (user.hoTen || user.name || '') : '';

  // Scan trolleys: which have exited (timeOut filled), which are still in oven
  var trolleysExited = [];
  var trolleysInOven = [];
  var rows = document.querySelectorAll('#dryingTrolleyBody tr');
  rows.forEach(function(row) {
    var rowId = row.id.replace('dtrow_', '');
    var sel = row.querySelector('select');
    var trolleyNo = parseInt(sel ? sel.value : '') || null;
    if (!trolleyNo) return;
    var tInputs = row.querySelectorAll('input.time24');
    var timeOut = tInputs[1] ? tInputs[1].value : '';
    if (timeOut) {
      trolleysExited.push(trolleyNo);
      // Mark this trolley as exited by current shift
      row.dataset.exitedByShift = myShift;
    } else {
      trolleysInOven.push(trolleyNo);
    }
  });

  // Create handover record
  var handoverRecord = {
    action: 'end_shift',
    shiftCode: myShift,
    userId: user ? user.id : null,
    userName: userName,
    at: new Date().toISOString(),
    trolleysExited: trolleysExited,
    trolleysInOven: trolleysInOven
  };
  _shiftHandovers.push(handoverRecord);

  // Auto-save: trigger the save function (keep modal open)
  try {
    window._shiftHandoverSaving = true;
    await TabMES.saveLineRecord();
    window._shiftHandoverSaving = false;
    showToast('\u0110\u00E3 k\u1EBFt th\u00FAc ' + shiftName + '. ' + trolleysExited.length + ' th\u00F9ng ra l\u00F2, ' + trolleysInOven.length + ' th\u00F9ng c\u00F2n trong l\u00F2.', 'success');
  } catch (e) {
    window._shiftHandoverSaving = false;
    console.error('endShift save error:', e);
    showToast('L\u1ED7i l\u01B0u phi\u1EBFu khi k\u1EBFt th\u00FAc ca', 'error');
    // Rollback handover record
    _shiftHandovers.pop();
    return;
  }

  // Lock exited trolleys (make readonly)
  _lockExitedTrolleys();

  // Re-render handover bar
  await _renderShiftHandoverBar();

  // Check if this is the last shift of the day → overnight transfer
  await _checkOvernightTransfer(myShift, trolleysInOven);
}

/**
 * Accept shift: record acceptance, filter trolley display.
 */
async function acceptShift() {
  var myShift = await getUserShiftCode();
  // Admin: read from dropdown
  if (!myShift) {
    var adminSel = document.getElementById('adminShiftSelect');
    myShift = adminSel ? adminSel.value : '';
  }
  if (!myShift) {
    showToast('Vui l\u00F2ng ch\u1ECDn ca s\u1EA3n xu\u1EA5t c\u1EA7n ti\u1EBFp nh\u1EADn', 'warning');
    return;
  }

  // Check: ca trước đã kết thúc chưa?
  var state = await _getShiftHandoverState();
  if (!state.needsAcceptance) {
    showToast('Kh\u00F4ng c\u00F3 ca n\u00E0o c\u1EA7n ti\u1EBFp nh\u1EADn', 'warning');
    return;
  }

  var user = window.currentUser;
  var userName = user ? (user.hoTen || user.name || '') : '';

  // Count trolleys still in oven
  var inOvenCount = 0;
  document.querySelectorAll('#dryingTrolleyBody tr').forEach(function(row) {
    var sel = row.querySelector('select');
    var trolleyNo = parseInt(sel ? sel.value : '') || null;
    if (!trolleyNo) return;
    var tInputs = row.querySelectorAll('input.time24');
    var timeOut = tInputs[1] ? tInputs[1].value : '';
    if (!timeOut) inOvenCount++;
  });

  var handoverRecord = {
    action: 'accept_shift',
    shiftCode: myShift,
    userId: user ? user.id : null,
    userName: userName,
    at: new Date().toISOString()
  };
  _shiftHandovers.push(handoverRecord);

  // Auto-save (keep modal open)
  try {
    window._shiftHandoverSaving = true;
    await TabMES.saveLineRecord();
    window._shiftHandoverSaving = false;
    showToast('\u0110\u00E3 ti\u1EBFp nh\u1EADn ca. ' + inOvenCount + ' th\u00F9ng c\u00F2n trong l\u00F2.', 'success');
  } catch (e) {
    window._shiftHandoverSaving = false;
    console.error('acceptShift save error:', e);
    showToast('L\u1ED7i l\u01B0u khi ti\u1EBFp nh\u1EADn ca', 'error');
    _shiftHandovers.pop();
    return;
  }

  // Filter trolley display
  _filterTrolleysByShift();

  // Re-render handover bar
  await _renderShiftHandoverBar();
}

/**
 * Filter trolley rows by shift visibility.
 * - Hide trolleys exited by other shifts
 * - Show (readonly) trolleys exited by current shift
 * - Show (editable) trolleys still in oven
 * - Admin sees all (with shift labels)
 */
async function _filterTrolleysByShift() {
  var myShift = await getUserShiftCode();
  var isAdmin = !myShift;
  var rows = document.querySelectorAll('#dryingTrolleyBody tr');

  rows.forEach(function(row) {
    var exitedBy = row.dataset.exitedByShift || '';

    // Remove previous classes
    row.classList.remove('trolley-row-hidden-shift', 'trolley-row-other-shift');

    if (isAdmin || _showAllShifts) {
      // Admin or "show all" mode: show everything, dim other shifts' exited trolleys
      if (exitedBy) {
        // Add shift label
        _addShiftLabel(row, exitedBy);
      }
      return;
    }

    if (exitedBy) {
      if (exitedBy === myShift) {
        // Trolley exited by my shift → show but readonly
        _addShiftLabel(row, exitedBy);
        _setTrolleyRowReadonly(row, true);
      } else {
        // Trolley exited by other shift → hide
        row.classList.add('trolley-row-hidden-shift');
      }
    }
    // No exitedBy → still in oven, fully visible and editable
  });

  if (typeof updateOvenSummary === 'function') updateOvenSummary();
}

function _addShiftLabel(row, shiftCode) {
  // Avoid duplicate labels
  var existing = row.querySelector('.trolley-shift-label');
  if (existing) existing.remove();
  var shifts = _getSXShiftsCached();
  var shiftInfo = shifts.find(function(s) { return s.code === shiftCode; });
  var label = shiftInfo ? shiftInfo.name : shiftCode;
  var firstTd = row.querySelector('td');
  if (firstTd) {
    var span = document.createElement('span');
    span.className = 'trolley-shift-label';
    span.textContent = label;
    firstTd.appendChild(span);
  }
}

function _setTrolleyRowReadonly(row, readonly) {
  var inputs = row.querySelectorAll('input, select');
  inputs.forEach(function(inp) {
    if (readonly) {
      inp.setAttribute('readonly', 'readonly');
      inp.setAttribute('disabled', 'disabled');
    } else {
      inp.removeAttribute('readonly');
      inp.removeAttribute('disabled');
    }
  });
}

function _lockExitedTrolleys() {
  var rows = document.querySelectorAll('#dryingTrolleyBody tr');
  rows.forEach(function(row) {
    if (row.dataset.exitedByShift) {
      _setTrolleyRowReadonly(row, true);
    }
  });
}

/**
 * Check if current shift is the last shift of the day.
 * If trolleys remain in oven, create next day's DC record.
 */
async function _checkOvernightTransfer(myShift, trolleysInOven) {
  if (!trolleysInOven || trolleysInOven.length === 0) return;

  // Get schedule to find last shift
  var ovenId = (document.getElementById('ovenSelect') || {}).value || '';
  var schedule = getScheduleForOven(ovenId);
  if (!schedule || schedule.length === 0) return;

  // Find last shift = shift with latest endTime
  var lastShiftCode = null;
  var maxEnd = -1;
  for (var i = 0; i < schedule.length; i++) {
    if (schedule[i].active === false) continue;
    var end = timeToMinutes(schedule[i].endTime);
    if (end !== null && end > maxEnd) {
      maxEnd = end;
      lastShiftCode = schedule[i].code;
    }
  }

  // Not the last shift → skip
  if (myShift !== lastShiftCode) return;

  // This is the last shift and trolleys are still in oven → prompt for overnight transfer
  if (!(await showConfirm(trolleysInOven.length + ' th\u00F9ng c\u00F2n trong l\u00F2 s\u1EBD \u0111\u01B0\u1EE3c chuy\u1EC3n sang phi\u1EBFu ng\u00E0y m\u1EDBi. Ti\u1EBFp t\u1EE5c?'))) return;

  await _createOvernightTransferRecord(trolleysInOven);
}

/**
 * Create a new DC record for the next day with remaining trolleys.
 */
async function _createOvernightTransferRecord(trolleysInOven) {
  var dateStr = (document.getElementById('lineRecordProductionDate') || {}).value || '';
  var dcLine = (document.getElementById('lineRecordDCLine') || {}).value || '';
  var ovenId = (document.getElementById('ovenSelect') || {}).value || '';
  var recordId = (document.getElementById('lineRecordId') || {}).value || '';

  if (!dateStr || !dcLine) {
    showToast('Kh\u00F4ng \u0111\u1EE7 th\u00F4ng tin \u0111\u1EC3 t\u1EA1o phi\u1EBFu ng\u00E0y m\u1EDBi', 'error');
    return;
  }

  var nextDate = _getNextDateStr(dateStr);
  var user = window.currentUser;
  var factory = window.currentFactory;

  // Get current record's linkedBatches and muongNumbers for traceability
  var currentRec = recordId ? (window.lineRecords || []).find(function(r) { return r.id === recordId; }) : null;
  var srcLinkedBatches = currentRec ? (currentRec.linkedBatches || []) : [];
  var srcMuongNumbers = currentRec ? (currentRec.muongNumbers || []) : [];

  // Collect trolley data for those still in oven (full info: muong, XH, shift, transfer)
  var trolleyDrying = [];
  var b5Data = _getTrolleyB5Data();
  document.querySelectorAll('#dryingTrolleyBody tr').forEach(function(row) {
    var rowId = row.id.replace('dtrow_', '');
    var sel = row.querySelector('select');
    var trolleyNo = parseInt(sel ? sel.value : '') || null;
    if (!trolleyNo || trolleysInOven.indexOf(trolleyNo) === -1) return;
    var tInputs = row.querySelectorAll('input.time24');
    var timeIn = tInputs[0] ? tInputs[0].value : '';
    // Collect muong and XH info — try B5 data first
    var muongNos = (b5Data.trolleyMap && b5Data.trolleyMap[trolleyNo]) || [];
    var xhTime = (b5Data.xhTimeMap && b5Data.xhTimeMap[trolleyNo]) || '';
    // Fallback: read from _acceptedTransferTrolleys (for transferred trolleys)
    if (muongNos.length === 0 || !xhTime) {
      var tInfo = _acceptedTransferTrolleys.find(function(t) { return t.trolleyNo === trolleyNo; });
      if (tInfo) {
        if (muongNos.length === 0 && tInfo.muongs && tInfo.muongs.length > 0) muongNos = tInfo.muongs;
        if (!xhTime && tInfo.xhTime) xhTime = tInfo.xhTime;
      }
    }
    // Fallback: read from displayed cells (most reliable — handles all sources)
    if (muongNos.length === 0) {
      var mCell = document.getElementById('dtMuong_' + rowId);
      if (mCell && mCell.textContent && mCell.textContent !== '\u2014' && mCell.textContent !== '—') {
        var mMatches = mCell.textContent.match(/M(\d+)/g);
        if (mMatches) muongNos = mMatches.map(function(m) { return parseInt(m.replace('M', '')); });
      }
    }
    if (!xhTime) {
      var xCell = document.getElementById('dtXH_' + rowId);
      if (xCell && xCell.textContent && xCell.textContent !== '\u2014' && xCell.textContent !== '—') {
        xhTime = xCell.textContent.trim();
      }
    }
    // Collect shift info
    var sInEl = document.getElementById('dtShiftIn_' + rowId);
    var sInCode = sInEl ? sInEl.value : '';
    var shifts = _getSXShiftsCached();
    var shiftIn = null;
    if (sInCode) {
      var sIn = shifts.find(function(s) { return s.code === sInCode; });
      if (sIn) shiftIn = { code: sIn.code, name: sIn.name };
    }
    var entry = {
      trolleyNo: trolleyNo,
      timeIn: timeIn,
      timeOut: '',
      overnight: true,
      muongNos: muongNos,
      xhTime: xhTime
    };
    if (shiftIn) entry.shiftIn = shiftIn;
    // Preserve transfer info
    if (row.dataset.transferFrom) {
      entry.transferred = true;
      entry.fromRecordId = row.dataset.transferFrom;
      entry.fromDCLine = row.dataset.transferDCLine || '';
    }
    trolleyDrying.push(entry);
  });

  if (trolleyDrying.length === 0) return;

  // Check if next day record already exists for this DC line
  try {
    var existingQuery = await ErpDb.firestore().collection('productionLineRecords')
      .where('factory', '==', factory)
      .where('productionLine', '==', dcLine)
      .where('date', '==', nextDate)
      .where('currentStage', '==', 'say')
      .limit(1)
      .get();

    if (!existingQuery.empty) {
      // Merge trolleys into existing record
      var existingDoc = existingQuery.docs[0];
      var existingData = existingDoc.data();
      var existingSay = (existingData.stageData || {}).say || {};
      var existingTrolleys = existingSay.trolleyDrying || [];
      var existingNos = existingTrolleys.map(function(t) { return t.trolleyNo; });

      // Only add trolleys that don't already exist
      var newTrolleys = trolleyDrying.filter(function(t) { return existingNos.indexOf(t.trolleyNo) === -1; });
      if (newTrolleys.length > 0) {
        var mergedTrolleys = existingTrolleys.concat(newTrolleys);
        await ErpDb.firestore().collection('productionLineRecords').doc(existingDoc.id).update({
          'stageData.say.trolleyDrying': mergedTrolleys,
          'stageData.say.overnightFrom': { recordId: recordId, date: dateStr },
          updatedAt: ErpDb.firestore.FieldValue.serverTimestamp()
        });
        showToast('\u0110\u00E3 chuy\u1EC3n ' + newTrolleys.length + ' th\u00F9ng sang phi\u1EBFu ng\u00E0y ' + nextDate, 'success');
      } else {
        showToast('C\u00E1c th\u00F9ng \u0111\u00E3 c\u00F3 trong phi\u1EBFu ng\u00E0y ' + nextDate, 'info');
      }
    } else {
      // Create new record for next day
      var ws = typeof getActiveWorkspace === 'function' ? getActiveWorkspace() : null;
      var newRecordData = {
        productionLine: dcLine,
        date: nextDate,
        shift: '', // Will be set when next shift accepts
        factory: factory,
        lineGroup: ws ? ws.lineGroup : 'muNuoc',
        muongNumbers: srcMuongNumbers,
        linkedBatches: srcLinkedBatches,
        currentStage: 'say',
        status: 'processing',
        stageData: {
          say: {
            ovenId: ovenId,
            trolleyDrying: trolleyDrying,
            overnightFrom: { recordId: recordId, date: dateStr },
            updatedAt: new Date().toISOString(),
            updatedBy: user ? user.id : null,
            updatedByName: user ? (user.hoTen || user.name || '') : ''
          }
        },
        timeline: [{
          action: 'overnight_transfer',
          stage: 'say',
          at: new Date().toISOString(),
          userId: user ? user.id : null,
          userName: user ? (user.hoTen || user.name || '') : '',
          details: { fromRecordId: recordId, fromDate: dateStr, trolleyCount: trolleyDrying.length }
        }],
        createdAt: ErpDb.firestore.FieldValue.serverTimestamp(),
        createdBy: user ? user.id : null,
        createdByName: user ? (user.hoTen || user.name || '') : ''
      };

      // Generate record code
      if (typeof LineRecordProcessor !== 'undefined' && LineRecordProcessor.generateRecordCode) {
        newRecordData.recordCode = LineRecordProcessor.generateRecordCode(dcLine, '', nextDate);
      }

      await ErpDb.firestore().collection('productionLineRecords').add(newRecordData);
      showToast('\u0110\u00E3 t\u1EA1o phi\u1EBFu ng\u00E0y ' + nextDate + ' v\u1EDBi ' + trolleyDrying.length + ' th\u00F9ng qua \u0111\u00EAm', 'success');
    }
  } catch (e) {
    console.error('Overnight transfer error:', e);
    showToast('L\u1ED7i chuy\u1EC3n th\u00F9ng sang ng\u00E0y m\u1EDBi: ' + e.message, 'error');
  }
}

// Map state
let gardenMap = null;
let mapPlots = [];
let plotLayers = {};
let currentMapLayer = 'satellite';

// Squad colors for map legend
// Bảng màu cho Đội Sản Xuất (giống app-vuoncay, tự động gán theo thứ tự)
const TEAM_FILL_COLORS = [
  '#22c55e', // green
  '#3b82f6', // blue
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
  '#6366f1', // indigo
  '#84cc16', // lime
  '#ef4444', // red
  '#a855f7', // purple
];

// Cache màu theo tên đội (giống app-vuoncay)
const squadColorMap = {};

// Lấy màu cho đội - tự động gán màu mới nếu chưa có
function getSquadColor(squadName) {
  if (!squadName || squadName === '-' || squadName === '') return '#64748b'; // gray

  // Normalize team name
  const normalizedName = String(squadName).toUpperCase().trim();

  // Return cached color if exists
  if (squadColorMap[normalizedName]) {
    return squadColorMap[normalizedName];
  }

  // Assign new color based on number of existing teams
  const existingTeams = Object.keys(squadColorMap).length;
  const colorIndex = existingTeams % TEAM_FILL_COLORS.length;
  squadColorMap[normalizedName] = TEAM_FILL_COLORS[colorIndex];

  return squadColorMap[normalizedName];
}

// ============================================
// HELPER FUNCTIONS
// ============================================
function showToast(message, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 4000);
}

function formatDate(date) {
  if (!date) return '';
  const d = date.toDate ? date.toDate() : new Date(date);
  return d.toLocaleDateString('vi-VN');
}

/** Convert "yyyy-mm-dd" string to "dd/mm/yyyy" for display */
function formatDateVN(str) {
  if (!str) return '';
  var parts = str.split('-');
  if (parts.length !== 3) return str;
  return parts[2] + '/' + parts[1] + '/' + parts[0];
}

function formatNumber(num) {
  if (!num) return '0';
  return Number(num).toLocaleString('vi-VN');
}

function generateCode(prefix, refDate) {
  var base = new Date();
  if (refDate) {
    var parsed = new Date(String(refDate).slice(0, 10) + 'T12:00:00');
    if (!isNaN(parsed.getTime())) base = parsed;
  }
  const y = base.getFullYear().toString().slice(-2);
  const m = String(base.getMonth() + 1).padStart(2, '0');
  const d = String(base.getDate()).padStart(2, '0');
  const r = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}${y}${m}${d}${r}`;
}

function goBack() {
  window.location.href = 'index.html';
}

// ============================================
// TAB NAVIGATION
// ============================================
function showTab(index) {
  // Stop real-time listeners when leaving Reception tab
  if (typeof TabReception !== 'undefined' && TabReception.stopReceiptListeners) TabReception.stopReceiptListeners();

  // Update tab buttons
  document.querySelectorAll('.tab').forEach((tab, i) => {
    tab.classList.toggle('active', i === index);
  });

  // Update content cards
  document.querySelectorAll('.content-card').forEach((card, i) => {
    card.classList.toggle('active', i === index);
  });

  // Delegate to Tab modules when available, fallback to inline functions
  switch(index) {
    case 0:
      if (typeof TabGardens !== 'undefined') { TabGardens.loadGardens(); }
      else { loadGardens(); }
      setTimeout(() => {
        if (typeof TabGardens !== 'undefined' && TabGardens.initGardenMap) {
          TabGardens.initGardenMap();
        } else if (gardenMap) {
          gardenMap.invalidateSize();
        } else {
          initGardenMap();
        }
      }, 100);
      break;
    case 1:
      if (typeof TabFieldHarvest !== 'undefined') { TabFieldHarvest.init(); }
      break;
    case 2:
      if (typeof TabDelivery !== 'undefined') { TabDelivery.loadDeliveries(); }
      else { loadDeliveries(); }
      break;
    case 3:
      if (typeof TabReception !== 'undefined') { TabReception.init(); }
      else { loadFactoryReceipts(); }
      break;
    case 4:
      if (typeof TabMES !== 'undefined') { TabMES.init(); }
      else { loadBatches(); initProductionLineSelector(); initMESDate(); }
      break;
    case 5:
      if (typeof TabQuality !== 'undefined') { TabQuality.loadTests(); }
      else { loadTests(); }
      break;
    case 6:
      if (typeof TabWarehouse !== 'undefined') { TabWarehouse.loadWarehouse(); }
      else { loadWarehouse(); }
      break;
    case 7:
      if (typeof TabAdmin !== 'undefined') TabAdmin.init();
      break;
  }
}

// ============================================
// MAP FUNCTIONS
// ============================================
    function initGardenMap() { TabGardens.initGardenMap(); }


    function toggleMapLayer(t) { TabGardens.toggleMapLayer(t); }

    function loadMapPlots() { TabGardens.loadMapPlots(); }






    function fitMapBounds() { TabGardens.fitMapBounds(); }

    function toggleGardenMapFullscreen() { TabGardens.toggleMapFullscreen(); }

// ============================================
// TAB 0: GARDENS & EUDR
// ============================================
    function loadGardens() { TabGardens.loadGardens(); }




    function searchGardens() { TabGardens.searchGardens(); }

    function filterGardens() { TabGardens.filterGardens(); }

    function openGardenModal(id) { TabGardens.openGardenModal(id); }

    function closeGardenModal() { TabGardens.closeGardenModal(); }

    function editGarden(id) { TabGardens.editGarden(id); }

    function saveGarden() { TabGardens.saveGarden(); }

    function deleteGarden(id) { TabGardens.deleteGarden(id); }

    function exportGardens() { TabGardens.exportGardens(); }

// ============================================
// TAB 1: GIAO NHẬN MỦ (TCCS 111:2023)
// ============================================
async function loadDeliveries() {
  // Load gardens for dropdown (từ localStorage hoặc mapPlots)
  if (gardens.length === 0) {
    // Thử load từ localStorage trước
    try {
      const savedGardens = localStorage.getItem('rubberGardens');
      if (savedGardens) {
        gardens = JSON.parse(savedGardens);
      }
    } catch (e) { /* ignore */ }

    // Nếu vẫn trống, thử Firestore (có thể fail)
    if (gardens.length === 0) {
      try {
        const gardensSnap = await db.collection('rubberGardens').get();
        gardens = gardensSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        localStorage.setItem('rubberGardens', JSON.stringify(gardens));
      } catch (e) {
        console.warn('Firestore gardens error:', e.message);
      }
    }
  }

  // Populate garden/squad dropdown từ mapPlots nếu có
  const gardenSelect = document.getElementById('deliveryGardenId');
  if (gardenSelect) {
    // Lấy danh sách Đội SX từ mapPlots
    const squads = [...new Set(mapPlots.map(p => p.squad).filter(s => s))].sort();
    if (squads.length > 0) {
      gardenSelect.innerHTML = '<option value="">-- Chọn Đội SX --</option>' +
        squads.map(s => `<option value="${s}">Đội ${s}</option>`).join('');
    } else if (gardens.length > 0) {
      gardenSelect.innerHTML = '<option value="">-- Chọn vườn/đội --</option>' +
        gardens.map(g => `<option value="${g.id}">${g.code} - ${g.ownerName}</option>`).join('');
    }
  }

  // Load deliveries từ localStorage trước
  try {
    const savedDeliveries = localStorage.getItem('rubberDeliveries');
    if (savedDeliveries) {
      deliveries = JSON.parse(savedDeliveries);
      console.log('📦 Loaded', deliveries.length, 'deliveries from localStorage');
    }
  } catch (e) { /* ignore */ }

  // Thử load từ Firestore (có thể fail do permission)
  try {
    const snapshot = await db.collection('rubberDeliveries')
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();

    deliveries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    localStorage.setItem('rubberDeliveries', JSON.stringify(deliveries));
    console.log('☁️ Loaded', deliveries.length, 'deliveries from Firestore');
  } catch (error) {
    console.warn('Firestore deliveries error:', error.message);
    // Đã có dữ liệu từ localStorage, không cần báo lỗi
  }

  renderDeliveries();
  updateDeliveryStats();
  updateDeliveryTimeline();
}

function renderDeliveries(data) { TabDelivery.renderDeliveries(data); }

function formatDateTime(date) {
  if (!date) return '';
  const d = date.toDate ? date.toDate() : new Date(date);
  return d.toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function getMaterialTypeText(type) {
  const map = {
    'latex': 'Mủ nước',
    'coagulum': 'Mủ đông'
  };
  return map[type] || type || 'Mủ nước';
}

function getTimeWarning(delivery) {
  if (!delivery.tappingTime) return '<span class="time-ok">--</span>';

  const tappingTime = delivery.tappingTime.toDate ? delivery.tappingTime.toDate() : new Date(delivery.tappingTime);
  const now = new Date();
  const hours = (now - tappingTime) / (1000 * 60 * 60);

  // TCCS 111:2023: Mủ nước ≤8h cho latex/RSS, ≤10h cho SVR
  const maxHours = delivery.productType === 'svr' ? 10 : 8;

  if (hours > maxHours) {
    return `<span class="time-warning critical">⚠️ ${hours.toFixed(1)}h (Quá ${maxHours}h)</span>`;
  } else if (hours > maxHours * 0.75) {
    return `<span class="time-warning warning">⏰ ${hours.toFixed(1)}h</span>`;
  } else {
    return `<span class="time-ok">✓ ${hours.toFixed(1)}h</span>`;
  }
}

function getDeliveryStatusBadge(status) {
  const map = {
    'pending': '<span class="status-badge pending">Chờ nghiệm thu</span>',
    'in_transit': '<span class="status-badge processing">Đang vận chuyển</span>',
    'received': '<span class="status-badge compliant">Đã tiếp nhận</span>'
  };
  return map[status] || map['pending'];
}

function updateDeliveryStats() {
  if (typeof TabDelivery !== 'undefined' && TabDelivery.updateDeliveryStats) TabDelivery.updateDeliveryStats();
}

function updateDeliveryTimeline() {
  // Update timeline step counts
  const pendingCount = deliveries.filter(d => d.status === 'pending').length;
  const transitCount = deliveries.filter(d => d.status === 'in_transit').length;
  const receivedCount = deliveries.filter(d => d.status === 'received').length;

  // Highlight active step
  document.querySelectorAll('.timeline-step').forEach((step, index) => {
    step.classList.remove('active', 'completed');
  });
}



function openDeliveryModal(id) { TabDelivery.openDeliveryModal(id); }



function closeDeliveryModal() { TabDelivery.closeDeliveryModal(); }

function editDelivery(id) {
  openDeliveryModal(id);
}

function toggleMaterialFields(type) {
  if (typeof TabDelivery !== 'undefined') TabDelivery.toggleMaterialFields(type);
}

function calculateDeliveryDry() {
  if (typeof TabDelivery !== 'undefined') TabDelivery.calculateDeliveryDry();
}

// === TCCS 111 - Bảo quản NH3 & Latex cô đặc ===
function updateNH3Hints() {
  const season = document.getElementById('deliverySeasonType')?.value;
  const purpose = document.getElementById('deliveryLatexPurpose')?.value;
  const hint = document.getElementById('nh3ConcHint');
  if (hint) hint.textContent = season === 'rainy' ? 'Mùa mưa: NH₃ ~5% (m/m)' : 'Mùa khô: NH₃ ~3% (m/m)';
  // Update NH3 acceptance placeholder
  const nh3Field = document.getElementById('deliveryLatexNH3');
  if (nh3Field) nh3Field.placeholder = purpose === 'concentrate' ? '≤ 0.3% (Latex cô đặc)' : '≤ 0.03% (SVR/RSS)';
  // Toggle latex concentrate fields
  const concFields = document.getElementById('latexConcentrateFields');
  if (concFields) concFields.style.display = purpose === 'concentrate' ? 'block' : 'none';
  // Update pH placeholder for concentrate
  const phField = document.getElementById('deliveryLatexPH');
  if (phField) phField.placeholder = purpose === 'concentrate' ? '≥ 9.0 (Bảng 9.8)' : '6.5-8.0 (Bảng 9.6)';
}

function validateNH3Dosage(input) {
  const val = parseFloat(input.value);
  input.classList.toggle('param-warning', val > 10);
  input.classList.toggle('param-ok', val > 0 && val <= 10);
}

function validateConcentrateGrade() {
  const drc = parseFloat(document.getElementById('deliveryLatexDRC')?.value) || 0;
  const nh3 = parseFloat(document.getElementById('deliveryLatexNH3')?.value) || 0;
  const vfa = parseFloat(document.getElementById('deliveryVFA')?.value) || 0;
  const ph = parseFloat(document.getElementById('deliveryLatexPH')?.value) || 0;
  const gradeSelect = document.getElementById('deliveryConcentrateGrade');
  // Bảng 9.8 criteria
  if (drc >= 23 && nh3 <= 0.3 && vfa < 0.04 && ph >= 9) gradeSelect.value = 'grade1';
  else if (drc >= 20 && nh3 <= 0.2 && vfa < 0.05 && ph >= 9) gradeSelect.value = 'grade2';
  else gradeSelect.value = 'grade3';
  // Visual validation
  const c = document.getElementById('concentrateValidation');
  if (!c) return;
  const badge = (ok, warn) => ok ? 'background:rgba(34,197,94,0.15);color:#16a34a;' : (warn ? 'background:rgba(245,158,11,0.15);color:#d97706;' : 'background:rgba(239,68,68,0.15);color:#dc2626;');
  c.innerHTML = `
    <div style="padding:8px;border-radius:8px;text-align:center;${badge(drc>=23,drc>=20)}"><div style="font-size:12px;">DRC</div><strong>${drc}%</strong><div style="font-size:12px;">L1:≥23 L2:≥20</div></div>
    <div style="padding:8px;border-radius:8px;text-align:center;${badge(nh3<=0.2,nh3<=0.3)}"><div style="font-size:12px;">NH₃</div><strong>${nh3}%</strong><div style="font-size:12px;">L1:≤0.3 L2:≤0.2</div></div>
    <div style="padding:8px;border-radius:8px;text-align:center;${badge(vfa<0.04,vfa<0.05)}"><div style="font-size:12px;">VFA</div><strong>${vfa}</strong><div style="font-size:12px;">L1:&lt;0.04 L2:&lt;0.05</div></div>
    <div style="padding:8px;border-radius:8px;text-align:center;${badge(ph>=9,false)}"><div style="font-size:12px;">pH</div><strong>${ph}</strong><div style="font-size:12px;">≥ 9.0</div></div>
  `;
}

// === TCCS 111 Điều 12 - Tiêu chí mủ đông ===
const COAG_QUALITY_111 = {
  block: { l1:'Trắng/vàng, không lẫn tạp chất nhìn thấy (cây, đất, sợi bao)', l2:'Màu xâm, có lẫn ít tạp chất' },
  cup: { l1:'Trắng vàng/nâu đen theo giống cây, không lẫn tạp chất', l2:'Có lẫn ít tạp chất' },
  scrap: { l1:'Vàng/nâu đen, không lẫn tạp chất nhìn thấy', l2:'Có lẫn ít tạp chất' },
  misc: { l1:'Vàng/nâu đen, không lẫn tạp chất nhìn thấy', l2:'Có lẫn tạp chất' },
  earth: { l1:'Mủ rơi trên mặt đất - xử lý ngoại lệ', l2:'Xử lý ngoại lệ' }
};
function updateCoagQualityHint() {
  const ct = document.getElementById('deliveryCoagType')?.value || 'block';
  const c = document.getElementById('coagQualityCriteria');
  if (!c) return;
  const q = COAG_QUALITY_111[ct];
  if (!q) { c.innerHTML = ''; return; }
  c.innerHTML = `
    <div style="padding:8px;border-radius:8px;background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);">
      <div style="font-size:12px;font-weight:700;color:#16a34a;margin-bottom:4px;">Loại 1</div>
      <div style="font-size:12px;">${q.l1}</div>
    </div>
    <div style="padding:8px;border-radius:8px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);">
      <div style="font-size:12px;font-weight:700;color:#d97706;margin-bottom:4px;">Loại 2</div>
      <div style="font-size:12px;">${q.l2}</div>
    </div>
  `;
}

async function saveDelivery() { await TabDelivery.saveDelivery(); }

async function deleteDelivery(id) { await TabDelivery.deleteDelivery(id); }

function exportDeliveries() {
  if (deliveries.length === 0) {
    showToast('Không có dữ liệu để xuất', 'warning');
    return;
  }

  const data = deliveries.map(d => ({
    'Số Phiếu': d.deliveryNo,
    'Ngày': formatDate(d.tappingTime),
    'Mã Vườn/Đội': d.gardenCode,
    'Phiên Cạo': d.tappingSession || '',
    'Lô Thu Hoạch': d.plotNames?.join(', ') || '',
    'EUDR Compliant': d.eudrCompliant ? 'Có' : 'Không',
    'Loại SP': d.productType === 'latex_rss' ? 'Latex/RSS' : (d.productType === 'svr' ? 'SVR' : 'Latex Concentrate'),
    'Loại Mủ': getMaterialTypeText(d.materialType),
    'TL Thô (kg)': d.grossWeight,
    'DRC (%)': d.drcPercent,
    'TL Quy Khô (kg)': d.dryWeight,
    'Biển Số Xe': d.vehicleNo,
    'Niêm Phong': d.sealStatus === 'sealed' ? 'Còn nguyên' : (d.sealStatus === 'unsealed' ? 'Đã mở' : 'Bị hỏng'),
    'Trạng Thái': d.status === 'received' ? 'Đã tiếp nhận' : (d.status === 'in_transit' ? 'Đang vận chuyển' : 'Chờ nghiệm thu'),
    'Người Giao': d.deliveryPerson,
    'Người Nhận': d.receivePerson || d.deliveryReceivePerson || '',
    'Ghi Chú': d.notes
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Giao Nhận Mủ');
  XLSX.writeFile(wb, `GiaoNhanMu_${new Date().toISOString().slice(0,10)}.xlsx`);
  showToast('Đã xuất file Excel!');
}

// Delivery plot helpers — logic in TabDelivery module
function onDeliveryGardenChange() {
  if (typeof TabDelivery !== 'undefined') TabDelivery.onDeliveryGardenChange();
}
function onTappingSessionChange() {
  if (typeof TabDelivery !== 'undefined') TabDelivery.onTappingSessionChange();
}
function onPlotCheckboxChange(checkbox) {
  if (typeof TabDelivery !== 'undefined') TabDelivery.onPlotCheckboxChange(checkbox);
}
function selectAllPlots() {
  if (typeof TabDelivery !== 'undefined') TabDelivery.selectAllPlots();
}
function deselectAllPlots() {
  if (typeof TabDelivery !== 'undefined') TabDelivery.deselectAllPlots();
}
function getSelectedPlotIds() {
  return typeof TabDelivery !== 'undefined' ? TabDelivery.getSelectedPlotIds() : [];
}
function getSelectedPlotNames() {
  return typeof TabDelivery !== 'undefined' ? TabDelivery.getSelectedPlotNames() : [];
}

// ============================================
// TAB 2: TIẾP NHẬN NL - NHÀ MÁY CHẾ BIẾN
// ============================================

// Factory unit mapping - now from FACTORY_CONFIG
// Use FACTORY_CONFIG[currentFactory].plantations / plantationCodes instead

var factoryReceipts = [];
var blendingBatches = [];
var miscStorageLogs = [];
let currentSubTab = 0;

// Sub-tab navigation
function showSubTab(index) {
  currentSubTab = index;
  document.querySelectorAll('.sub-tab').forEach((t, i) => t.classList.toggle('active', i === index));
  document.querySelectorAll('.sub-content').forEach((c, i) => c.classList.toggle('active', i === index));
  if (index === 0) loadFactoryReceipts();
  else if (index === 1) loadBlendingBatches();
  else if (index === 2) loadMiscStorage();
  else if (index === 3) loadCoagStorage();
  else if (index === 4) { initDiscrepancyMonths(); loadDiscrepancyData(); }
}

// ---- SUB-TAB A: Sản lượng xe ----

async function loadFactoryReceipts() { await TabReception.loadFactoryReceipts(); }

async function renderFactoryReceiptTable() {
  const tbody = document.getElementById('factoryReceiptBody');
  const tfoot = document.getElementById('factoryReceiptFoot');

  if (factoryReceipts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="14" style="text-align:center;color:#000;">Chưa có dữ liệu</td></tr>';
    tfoot.innerHTML = '';
    return;
  }

  // Build mapping: receiptNo → blending batch info
  var batchMap = new Map();
  try {
    var selectedDate = document.getElementById('factoryReceiptDate').value;
    if (selectedDate && currentFactory) {
      var snapshot = await db.collection('blendingBatches')
        .where('date', '==', selectedDate)
        .where('factory', '==', currentFactory)
        .get();
      snapshot.forEach(function(doc) {
        var b = doc.data();
        if (b.sourceReceipts && b.sourceReceipts.length > 0) {
          b.sourceReceipts.forEach(function(rn) {
            batchMap.set(rn, { tankNo: b.tankNo, sequence: b.sequence || 1, batchCode: b.batchCode || '' });
          });
        }
      });
    }
  } catch (e) { /* ignore - blending data not critical */ }

  const fmtCell = (v) => v ? formatNumber(v) : '';
  const fmtDrc = (v) => v ? v.toFixed(2) : '';

  tbody.innerHTML = factoryReceipts.map((r, idx) => {
    const sourceBadge = r.source === 'ZEN'
      ? '<span class="status-badge processing">ZEN</span>'
      : '<span class="status-badge pending">Tay</span>';
    var bInfo = batchMap.get(r.id) || batchMap.get(r.receiptNo);
    var blendCell = bInfo
      ? `<span class="status-badge compliant">H${bInfo.tankNo}/L${bInfo.sequence}</span>`
      : '';

    return `<tr>
      <td>${idx + 1}</td>
      <td>${r.vehicleNo || '-'}</td>
      <td>${r.plantation}</td>
      <td style="background:rgba(59,130,246,0.04);">${fmtCell(r.muNuoc)}</td>
      <td style="background:rgba(59,130,246,0.04);">${fmtDrc(r.drcPercent)}</td>
      <td style="background:rgba(59,130,246,0.04);"><strong>${fmtCell(r.qkMuNuoc)}</strong></td>
      <td style="background:rgba(245,158,11,0.04);">${fmtCell(r.muChen)}</td>
      <td style="background:rgba(245,158,11,0.04);"><strong>${fmtCell(r.qkMuChen)}</strong></td>
      <td style="background:rgba(168,85,247,0.04);">${fmtCell(r.muDay)}</td>
      <td style="background:rgba(168,85,247,0.04);"><strong>${fmtCell(r.qkMuDay)}</strong></td>
      <td style="background:rgba(34,197,94,0.04);">${fmtCell(r.muDong)}</td>
      <td style="background:rgba(34,197,94,0.04);"><strong>${fmtCell(r.qkMuDong)}</strong></td>
      <td><strong style="color:#f59e0b;">${fmtCell(r.tongQKho)}</strong></td>
      <td>${sourceBadge}</td>
      <td>${blendCell}</td>
    </tr>`;
  }).join('');

  // Total row
  const totals = factoryReceipts.reduce((acc, r) => {
    acc.muNuoc += r.muNuoc || 0;
    acc.qkMuNuoc += r.qkMuNuoc || 0;
    acc.muChen += r.muChen || 0;
    acc.qkMuChen += r.qkMuChen || 0;
    acc.muDay += r.muDay || 0;
    acc.qkMuDay += r.qkMuDay || 0;
    acc.muDong += r.muDong || 0;
    acc.qkMuDong += r.qkMuDong || 0;
    acc.tongQKho += r.tongQKho || 0;
    return acc;
  }, { muNuoc:0, qkMuNuoc:0, muChen:0, qkMuChen:0, muDay:0, qkMuDay:0, muDong:0, qkMuDong:0, tongQKho:0 });

  tfoot.innerHTML = `<tr style="background:linear-gradient(135deg,var(--accent),var(--accent-hover));color:#fff;font-weight:700;">
    <td colspan="3">TỔNG (${factoryReceipts.length} xe)</td>
    <td>${formatNumber(totals.muNuoc)}</td>
    <td>-</td>
    <td>${formatNumber(totals.qkMuNuoc)}</td>
    <td>${formatNumber(totals.muChen)}</td>
    <td>${formatNumber(totals.qkMuChen)}</td>
    <td>${formatNumber(totals.muDay)}</td>
    <td>${formatNumber(totals.qkMuDay)}</td>
    <td>${formatNumber(totals.muDong)}</td>
    <td>${formatNumber(totals.qkMuDong)}</td>
    <td>${formatNumber(totals.tongQKho)}</td>
    <td colspan="2"></td>
  </tr>`;
}

function updateFactoryReceiptStats() {
  const totals = factoryReceipts.reduce((acc, r) => {
    acc.muNuoc += r.muNuoc || 0;
    acc.muChen += r.muChen || 0;
    acc.muDay += r.muDay || 0;
    acc.muDong += r.muDong || 0;
    acc.tongQKho += r.tongQKho || 0;
    return acc;
  }, { muNuoc:0, muChen:0, muDay:0, muDong:0, tongQKho:0 });

  document.getElementById('totalVehicles').textContent = factoryReceipts.length;
  document.getElementById('totalLatexWeight').textContent = formatNumber(totals.muNuoc);
  document.getElementById('totalMiscWeight').textContent = formatNumber(totals.muChen + totals.muDay + totals.muDong);
  document.getElementById('totalDryWeightReceipt').textContent = formatNumber(totals.tongQKho);
  renderFactoryValidation();
}

function renderFactoryValidation() {
  const panel = document.getElementById('tccs111ValidationPanel');
  const grid = document.getElementById('factoryValidationGrid');
  if (!panel || !grid) return;
  // Lấy xe có DRC mủ nước > 0
  const latexRecs = factoryReceipts.filter(r => r.muNuoc > 0 && r.drcMuNuoc > 0);
  if (latexRecs.length === 0) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  const avgDRC = latexRecs.reduce((s,r) => s + r.drcMuNuoc, 0) / latexRecs.length;
  const below20 = latexRecs.filter(r => r.drcMuNuoc < 20).length;
  const badge = (ok) => ok
    ? 'background:rgba(34,197,94,0.15);color:#16a34a;border:1px solid rgba(34,197,94,0.3);'
    : 'background:rgba(239,68,68,0.15);color:#dc2626;border:1px solid rgba(239,68,68,0.3);';
  grid.innerHTML = `
    <div style="padding:10px;border-radius:8px;text-align:center;${badge(avgDRC >= 20)}">
      <div style="font-size:12px;">DRC TB</div><strong style="font-size:18px;">${avgDRC.toFixed(1)}%</strong>
      <div style="font-size:12px;">TCCS 111: ≥ 20%</div>
    </div>
    <div style="padding:10px;border-radius:8px;text-align:center;${badge(below20 === 0)}">
      <div style="font-size:12px;">Xe DRC &lt; 20%</div><strong style="font-size:18px;">${below20}</strong>
      <div style="font-size:12px;">Phải = 0 (Bảng 9.6)</div>
    </div>
    <div style="padding:10px;border-radius:8px;text-align:center;background:rgba(99,102,241,0.1);color:#6366f1;border:1px solid rgba(99,102,241,0.2);">
      <div style="font-size:12px;">Tổng Xe MN</div><strong style="font-size:18px;">${latexRecs.length}</strong>
      <div style="font-size:12px;">Mủ nước hôm nay</div>
    </div>
    <div style="padding:10px;border-radius:8px;text-align:center;background:rgba(99,102,241,0.1);color:#6366f1;border:1px solid rgba(99,102,241,0.2);">
      <div style="font-size:12px;">Tổng Xe</div><strong style="font-size:18px;">${factoryReceipts.length}</strong>
      <div style="font-size:12px;">Tất cả loại</div>
    </div>
  `;
}

// ---- ZEN SYNC ----

function openFactoryZenSync() {
  const modal = document.getElementById('factoryZenModal');
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth() + 1;
  document.getElementById('factoryZenDateFrom').value = `${y}-${String(m).padStart(2,'0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  document.getElementById('factoryZenDateTo').value = `${y}-${String(m).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
  document.getElementById('factoryZenDvcs').value = currentFactory || 'A02';
  const desc = document.getElementById('zenModalDesc');
  if (desc) desc.textContent = `Lấy dữ liệu phiếu cân từ hệ thống ZEN cho ${getFactoryName()}`;
  document.getElementById('factoryZenStatus').style.display = 'none';
  modal.classList.add('active');
}

function closeFactoryZenSync() {
  document.getElementById('factoryZenModal').classList.remove('active');
}

function showFactoryZenStatus(msg, type) {
  const el = document.getElementById('factoryZenStatus');
  const colors = {
    info: { bg: 'rgba(59,130,246,0.15)', text: '#60a5fa', border: 'rgba(59,130,246,0.3)' },
    success: { bg: 'rgba(34,197,94,0.15)', text: '#4ade80', border: 'rgba(34,197,94,0.3)' },
    error: { bg: 'rgba(239,68,68,0.15)', text: '#f87171', border: 'rgba(239,68,68,0.3)' },
    loading: { bg: 'rgba(245,158,11,0.15)', text: '#fbbf24', border: 'rgba(245,158,11,0.3)' }
  };
  const c = colors[type] || colors.info;
  el.style.display = 'block';
  el.style.background = c.bg;
  el.style.color = c.text;
  el.style.border = `1px solid ${c.border}`;
  el.innerHTML = msg;
}

async function syncFactoryZenData() { await TabReception.syncFactoryZenData(); }

// ---- MANUAL RECEIPT (Phiếu cân thủ công) ----

function openManualReceiptModal(id = null) {
  document.getElementById('manualReceiptTitle').textContent = id ? 'Sửa Phiếu Cân' : 'Thêm Phiếu Cân Thủ Công';
  document.getElementById('manualReceiptId').value = id || '';

  if (id) {
    const r = factoryReceipts.find(x => x.id === id);
    if (r) {
      document.getElementById('mrReceiptNo').value = r.receiptNo || '';
      document.getElementById('mrDate').value = document.getElementById('factoryReceiptDate').value;
      document.getElementById('mrVehicle').value = r.vehicleNo || '';
      document.getElementById('mrPlantation').value = r.plantation || '';
      document.getElementById('mrMaterialType').value = r.materialType || 'latex';
      document.getElementById('mrGrossWeight').value = r.grossWeight || '';
      document.getElementById('mrTareWeight').value = r.tareWeight || '';
      document.getElementById('mrNetWeight').value = r.netWeight || '';
      document.getElementById('mrDRC').value = r.drcPercent || '';
      toggleMiscSubType();
    }
  } else {
    document.getElementById('mrReceiptNo').value = generateCode('PC');
    document.getElementById('mrDate').value = document.getElementById('factoryReceiptDate').value || new Date().toISOString().slice(0, 10);
    document.getElementById('mrVehicle').value = '';
    document.getElementById('mrPlantation').value = '';
    document.getElementById('mrMaterialType').value = 'latex';
    document.getElementById('mrGrossWeight').value = '';
    document.getElementById('mrTareWeight').value = '';
    document.getElementById('mrNetWeight').value = '';
    document.getElementById('mrDRC').value = '';
    document.getElementById('mrDrcResult').style.display = 'none';
    toggleMiscSubType();
  }

  document.getElementById('manualReceiptModal').classList.add('active');
}

function closeManualReceiptModal() {
  document.getElementById('manualReceiptModal').classList.remove('active');
}

function editManualReceipt(id) { openManualReceiptModal(id); }

async function deleteManualReceipt(id) {
  if (!(await showConfirm('Bạn có chắc muốn xóa phiếu này?'))) return;
  try { await db.collection('factoryReceipts').doc(id).delete(); } catch (e) { console.warn(e.message); }
  showToast('Đã xóa!');
  loadFactoryReceipts();
}

function toggleMiscSubType() {
  const type = document.getElementById('mrMaterialType').value;
  document.getElementById('mrMiscSubTypeGroup').style.display = type === 'misc' ? '' : 'none';
}

function calcManualNet() {
  const gross = parseFloat(document.getElementById('mrGrossWeight').value) || 0;
  const tare = parseFloat(document.getElementById('mrTareWeight').value) || 0;
  document.getElementById('mrNetWeight').value = (gross - tare).toFixed(1);
  calcManualDry();
}

function calcManualDry() {
  const net = parseFloat(document.getElementById('mrNetWeight').value) || 0;
  const drc = parseFloat(document.getElementById('mrDRC').value) || 0;
  const dry = (net * drc / 100).toFixed(1);
  document.getElementById('mrDryDisplay').textContent = formatNumber(dry) + ' kg';
  document.getElementById('mrDrcResult').style.display = drc > 0 ? 'block' : 'none';
}

async function saveManualReceipt() {
  const id = document.getElementById('manualReceiptId').value;
  const receiptNo = document.getElementById('mrReceiptNo').value.trim();
  const date = document.getElementById('mrDate').value;
  const vehicleNo = document.getElementById('mrVehicle').value.trim();
  const plantation = document.getElementById('mrPlantation').value;
  const materialType = document.getElementById('mrMaterialType').value;
  const miscSubType = document.getElementById('mrMiscSubType')?.value || '';
  const grossWeight = parseFloat(document.getElementById('mrGrossWeight').value) || 0;
  const tareWeight = parseFloat(document.getElementById('mrTareWeight').value) || 0;
  const netWeight = parseFloat(document.getElementById('mrNetWeight').value) || 0;
  const drcPercent = parseFloat(document.getElementById('mrDRC').value) || 0;
  const dryWeight = netWeight * drcPercent / 100;

  if (!receiptNo || !date || !vehicleNo || !plantation) {
    showToast('Vui lòng nhập đầy đủ thông tin bắt buộc', 'error');
    return;
  }

  const data = {
    receiptNo, date, vehicleNo, plantation, factory: currentFactory,
    materialType, miscSubType: materialType === 'misc' ? miscSubType : '',
    grossWeight, tareWeight, netWeight, drcPercent,
    dryWeight: parseFloat(dryWeight.toFixed(2)),
    source: 'MANUAL', status: 'weighed', assignedTo: '',
    updatedAt: ErpDb.firestore.FieldValue.serverTimestamp(),
    updatedBy: currentUser?.id || null
  };

  try {
    if (id) {
      await db.collection('factoryReceipts').doc(id).update(data);
      showToast('Cập nhật thành công!');
    } else {
      data.createdAt = ErpDb.firestore.FieldValue.serverTimestamp();
      data.createdBy = currentUser?.id || null;
      await db.collection('factoryReceipts').add(data);
      showToast('Tạo phiếu thành công!');
    }
  } catch (error) {
    console.warn('Save error:', error.message);
    showToast('Đã lưu offline!', 'warning');
  }

  closeManualReceiptModal();
  loadFactoryReceipts();
}

function exportFactoryReceipts() { TabReception.exportFactoryReceipts(); }

// ---- SUB-TAB B: Hồ Phối Liệu ----

async function loadBlendingBatches() { await TabReception.loadBlendingBatches(); }

function renderTankCards() {
  for (let i = 1; i <= 4; i++) {
    const card = document.getElementById(`tankCard${i}`);
    const tankBatches = blendingBatches.filter(b => b.tankNo === i);
    const activeBatch = tankBatches.find(b => b.status === 'filling' || b.status === 'full' || b.status === 'processing');

    // Remove old action button if any
    const oldBtn = card.querySelector('.tank-action-btn');
    if (oldBtn) oldBtn.remove();

    if (activeBatch) {
      card.className = `tank-card ${activeBatch.status}`;
      card.querySelector('.tank-weight').innerHTML = `${formatNumber(activeBatch.totalWeight || 0)} <small>kg</small>`;
      const statusText = { filling: 'Đang nạp', full: 'Đầy', processing: 'Đang xử lý', done: 'Hoàn thành' };
      card.querySelector('.tank-status').textContent = statusText[activeBatch.status] || activeBatch.status;

      // Add quick action button - chỉ "Đóng Hồ" khi filling; các bước sau chỉ hiển thị trạng thái (thao tác ở MES)
      if (activeBatch.status === 'filling') {
        const actionBtn = `<button class="tank-action-btn btn-close-tank" onclick="event.stopPropagation();quickChangeTankStatus('${activeBatch.id}','full')">Đóng Hồ</button>`;
        card.insertAdjacentHTML('beforeend', actionBtn);
      }
    } else {
      card.className = 'tank-card empty';
      card.querySelector('.tank-weight').innerHTML = '0 <small>kg</small>';
      card.querySelector('.tank-status').textContent = 'Trống';
    }
  }
}

async function quickChangeTankStatus(batchId, newStatus) {
  const statusNames = { full: 'Đầy', processing: 'Đang xử lý', done: 'Hoàn thành' };
  const confirmMsg = {
    full: 'Đóng hồ? Sau khi đóng sẽ không nạp thêm xe.',
    processing: 'Bắt đầu phối liệu cho hồ này?',
    done: 'Xác nhận hồ đã hoàn thành phối liệu?'
  };
  if (!(await showConfirm(confirmMsg[newStatus] || `Chuyển sang ${statusNames[newStatus]}?`))) return;

  try {
    await db.collection('blendingBatches').doc(batchId).update({
      status: newStatus,
      updatedAt: ErpDb.firestore.FieldValue.serverTimestamp()
    });
    showToast(`Đã chuyển sang: ${statusNames[newStatus]}`, 'success');
    loadBlendingBatches();
  } catch (error) {
    console.error('Quick status change error:', error);
    showToast('Lỗi cập nhật: ' + error.message, 'error');
  }
}

function renderBlendingBatchTable() {
  const tbody = document.getElementById('blendingBatchBody');
  if (blendingBatches.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#000;">Chưa có batch</td></tr>';
    return;
  }

  const statusText = { empty: 'Trống', filling: 'Đang nạp', full: 'Đầy', processing: 'Đang xử lý', done: 'Hoàn thành' };
  const statusClass = { empty: 'pending', filling: 'processing', full: 'pending', processing: 'processing', done: 'compliant' };

  tbody.innerHTML = blendingBatches.map(b => `<tr>
    <td><strong>${b.batchCode}</strong></td>
    <td>Hồ ${b.tankNo}</td>
    <td>${b.sequence || 1}</td>
    <td>${(b.sourceReceipts || []).length} xe</td>
    <td>${formatNumber(b.totalWeight || 0)}</td>
    <td>${b.avgDRC ? b.avgDRC.toFixed(1) + '%' : '-'}</td>
    <td><strong>${formatNumber(b.totalDryWeight || 0)}</strong></td>
    <td><span class="status-badge ${statusClass[b.status] || 'pending'}">${statusText[b.status] || b.status}</span></td>
    <td>
      <div class="action-btns" style="flex-wrap:wrap;gap:4px;">
        ${b.status === 'filling' ? `<button class="tank-action-btn btn-close-tank" style="margin:0;padding:3px 8px;font-size:12px;" onclick="quickChangeTankStatus('${b.id}','full')" title="Đóng hồ">Đóng Hồ</button>` : ''}
        <button class="action-btn edit" onclick="editBlendingBatch('${b.id}')" title="Sửa">✏️</button>
        <button class="action-btn delete" onclick="deleteBlendingBatch('${b.id}')" title="Xóa">🗑️</button>
      </div>
    </td>
  </tr>`).join('');
}

async function generateBatchCode(tankNo, dateStr) {
  const date = dateStr || document.getElementById('bbDate').value || document.getElementById('blendingDate').value || new Date().toISOString().slice(0, 10);
  const parts = date.split('-'); // YYYY-MM-DD
  const dd = parts[2];
  const mm = parts[1];
  const yy = parts[0].slice(2);

  // Find next sequence for this tank on this date
  // Match both old format H1-YYMMDD-NN and new format H1/NN/DD/MM/YY
  let maxSeq = 0;
  const oldPrefix = `H${tankNo}-${yy}${mm}${dd}`;
  const newPrefix = `H${tankNo}/`;
  const dateSuffix = `/${dd}/${mm}/${yy}`;
  blendingBatches.forEach(b => {
    if (!b.batchCode) return;
    if (b.batchCode.startsWith(oldPrefix)) {
      const seq = parseInt(b.batchCode.split('-').pop()) || 0;
      if (seq > maxSeq) maxSeq = seq;
    }
    if (b.batchCode.startsWith(newPrefix) && b.batchCode.endsWith(dateSuffix)) {
      const seq = parseInt(b.batchCode.split('/')[1]) || 0;
      if (seq > maxSeq) maxSeq = seq;
    }
  });

  const seq = String(maxSeq + 1).padStart(2, '0');
  return { code: `H${tankNo}/${seq}/${dd}/${mm}/${yy}`, sequence: maxSeq + 1 };
}

async function previewBatchCode() {
  const tankNo = document.getElementById('bbTankNo').value;
  const dateStr = document.getElementById('bbDate').value;
  const result = await generateBatchCode(tankNo, dateStr);
  document.getElementById('bbBatchCode').value = result.code;
  document.getElementById('bbSequence').value = `Lần ${result.sequence}`;
}

function openBlendingBatchModal(id) { TabReception.openBlendingBatchModal(id); }

async function renderAvailableLatexReceipts(batchId) {
  const container = document.getElementById('bbAvailableReceipts');
  const batch = batchId ? blendingBatches.find(b => b.id === batchId) : null;
  const assignedIds = batch?.sourceReceipts || [];

  // Collect doc IDs assigned to OTHER tanks (not the one being edited)
  const assignedElsewhere = new Map(); // docId → tankNo
  blendingBatches.forEach(b => {
    if (b.id === batchId) return; // skip current batch
    if (b.sourceReceipts && b.sourceReceipts.length > 0) {
      b.sourceReceipts.forEach(rn => {
        assignedElsewhere.set(rn, b.tankNo || '?');
      });
    }
  });

  // Load vehicles for the date selected in modal
  const selectedDate = document.getElementById('bbDate').value;
  if (!selectedDate) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:10px;">Chọn ngày để xem xe.</p>';
    return;
  }

  container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:10px;">Đang tải dữ liệu xe...</p>';

  try {
    const snapshot = await db.collection('harvestData')
      .where('importDate', '==', selectedDate)
      .get();

    const seenSoCt = new Set();
    const available = [];

    snapshot.forEach(doc => {
      const d = doc.data();
      if (d.source === 'ZEN_PURCHASE') return;
      const zenDvcs = (d.zenDvcs || '').toUpperCase();
      if (zenDvcs !== currentFactory && zenDvcs !== 'ALL') return;

      const soCt = d.soCt || doc.id;
      if (seenSoCt.has(soCt)) return;
      seenSoCt.add(soCt);

      const muNuoc = d.muNuoc || 0;
      if (muNuoc <= 0) return; // Only vehicles with mủ nước

      available.push({
        id: doc.id,
        receiptNo: `ZEN-${selectedDate.replace(/-/g, '')}-${available.length + 1}`,
        vehicleNo: d.soXe || d.vehicleNo || '-',
        plantation: d.donVi || '',
        muNuoc: muNuoc,
        drcPercent: d.drc || 0,
        qkMuNuoc: d.qkMuNuoc || 0
      });
    });

    // Filter out vehicles already assigned to other tanks (by doc ID, with receiptNo fallback)
    const showable = available.filter(r => !assignedElsewhere.has(r.id) && !assignedElsewhere.has(r.receiptNo));

    if (showable.length === 0 && available.length > 0) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:10px;">T\u1EA5t c\u1EA3 ' + available.length + ' xe \u0111\u00E3 \u0111\u01B0\u1EE3c ph\u00E2n b\u1ED5 v\u00E0o h\u1ED3 kh\u00E1c.</p>';
      return;
    }
    if (showable.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:10px;">Kh\u00F4ng c\u00F3 xe m\u1EE7 n\u01B0\u1EDBc ng\u00E0y ' + formatDateVN(selectedDate) + '. H\u00E3y \u0111\u1ED3ng b\u1ED9 ZEN tr\u01B0\u1EDBc.</p>';
      return;
    }

    // Header row
    let html = `<div style="display:grid;grid-template-columns:30px 1fr 1fr 100px 70px;gap:4px;padding:8px 10px;background:var(--bg-tertiary);font-size:12px;font-weight:700;color:var(--text-secondary);border-bottom:1px solid var(--border-color);position:sticky;top:0;">
      <span></span><span>S\u1ED1 Xe</span><span>N\u00F4ng Tr\u01B0\u1EDDng</span><span style="text-align:right;">M\u1EE7 n\u01B0\u1EDBc</span><span style="text-align:right;">DRC</span>
    </div>`;

    html += showable.map(r => {
      const checked = (assignedIds.includes(r.id) || assignedIds.includes(r.receiptNo)) ? 'checked' : '';
      return `<label style="display:grid;grid-template-columns:30px 1fr 1fr 100px 70px;gap:4px;align-items:center;padding:8px 10px;border-bottom:1px solid var(--border-color);cursor:pointer;font-size:13px;color:var(--text-primary);">
        <input type="checkbox" class="bb-receipt-check" value="${r.id}" data-weight="${r.muNuoc}" data-drc="${r.drcPercent}" data-dry="${r.qkMuNuoc}" ${checked} onchange="updateBatchTotals()">
        <span style="font-weight:600;">${r.vehicleNo}</span>
        <span style="color:var(--text-secondary);">${r.plantation}</span>
        <span style="text-align:right;color:var(--accent);">${formatNumber(r.muNuoc)} kg</span>
        <span style="text-align:right;color:var(--info);">${r.drcPercent ? r.drcPercent.toFixed(1) + '%' : '-'}</span>
      </label>`;
    }).join('');

    container.innerHTML = html;
  } catch (error) {
    console.warn('Load latex receipts error:', error.message);
    container.innerHTML = '<p style="color:#ef4444;font-size:13px;padding:10px;">L\u1ED7i t\u1EA3i d\u1EEF li\u1EC7u: ' + error.message + '</p>';
  }
}

function updateBatchTotals() {
  const checks = document.querySelectorAll('.bb-receipt-check:checked');
  let totalWeight = 0, totalDry = 0, drcSum = 0, drcWeight = 0;
  checks.forEach(c => {
    const w = parseFloat(c.dataset.weight) || 0;
    const drc = parseFloat(c.dataset.drc) || 0;
    const dry = parseFloat(c.dataset.dry) || 0;
    totalWeight += w;
    totalDry += dry;
    drcSum += drc * w;
    drcWeight += w;
  });
  const avgDrc = drcWeight > 0 ? drcSum / drcWeight : 0;
  document.getElementById('bbTotalWeight').textContent = formatNumber(totalWeight) + ' kg';
  document.getElementById('bbAvgDRC').textContent = avgDrc.toFixed(1) + '%';
  document.getElementById('bbTotalDry').textContent = formatNumber(totalDry) + ' kg';
}

function closeBlendingBatchModal() {
  document.getElementById('blendingBatchModal').classList.remove('active');
}

function editBlendingBatch(id) { openBlendingBatchModal(id); }

async function deleteBlendingBatch(id) { await TabReception.deleteBlendingBatch(id); }

async function saveBlendingBatch() { await TabReception.saveBlendingBatch(); }

// ---- SUB-TAB C: Ngăn Mủ Tạp ----

async function loadMiscStorage() { await TabReception.loadMiscStorage(); }

function renderCompartmentCards() {
  var grid = document.getElementById('compartmentGrid');
  var compStatus = window.miscCompartmentStatus || {};
  var typeText = { dong: '\u0110\u00F4ng', chen: 'Ch\u00E9n', day: 'D\u00E2y', dam: 'D\u0103m', dat: '\u0110\u1EA5t', tanthu: 'T.Thu' };
  var typeColor = { dong: '#22c55e', chen: '#f59e0b', day: '#a855f7', dam: '#94a3b8', dat: '#78716c', tanthu: '#64748b' };
  var targetText = { SVR10: 'SVR 10', SVR20: 'SVR 20', ngoaile: 'Ngo\u1EA1i l\u1EC7' };
  var statusText = { filling: '\u0110ang nh\u1EADp', full: '\u0110\u00E3 \u0111\u1EA7y', processing: '\u0110ang CB' };
  var html = '';

  for (var i = 1; i <= 10; i++) {
    var name = 'N' + i;
    var cs = compStatus[name] || null;
    var status = cs ? cs.status : 'empty';
    var logs = miscStorageLogs.filter(function(l) { return l.compartment === name; });
    var totalWeight = 0, totalDry = 0;
    var uniqueVehicles = {};
    var byType = {};

    logs.forEach(function(l) {
      totalWeight += l.weight || 0;
      totalDry += l.dryWeight || 0;
      var receipts = l.sourceReceipts || (l.sourceReceipt ? l.sourceReceipt.split(', ') : []);
      receipts.forEach(function(rn) { if (rn) uniqueVehicles[rn] = true; });
      var t = l.miscType || 'dong';
      if (!byType[t]) byType[t] = { weight: 0, dry: 0, receipts: {} };
      byType[t].weight += l.weight || 0;
      byType[t].dry += l.dryWeight || 0;
      receipts.forEach(function(rn) { if (rn) byType[t].receipts[rn] = true; });
    });
    var totalVehicles = Object.keys(uniqueVehicles).length;

    // Infer status from logs if no document exists
    var hasStock = totalWeight > 0;
    if (hasStock && status === 'empty') status = 'filling';

    var avgDRC = totalWeight > 0 && totalDry > 0 ? (totalDry / totalWeight * 100).toFixed(1) : null;
    var targets = [];
    logs.forEach(function(l) { if (l.targetProduct && targets.indexOf(l.targetProduct) === -1) targets.push(l.targetProduct); });

    if (hasStock) {
      var typeRows = '';
      var typeKeys = Object.keys(byType);
      typeKeys.sort(function(a, b) { return byType[b].weight - byType[a].weight; });
      typeKeys.forEach(function(t) {
        var d = byType[t];
        typeRows += '<div class="comp-type-row">' +
          '<span class="comp-type-dot" style="background:' + (typeColor[t] || '#64748b') + ';"></span>' +
          '<span class="comp-type-name">' + (typeText[t] || t) + '</span>' +
          '<span class="comp-type-weight">' + formatNumber(d.weight) + '</span>' +
          '<span class="comp-type-vehicles">' + Object.keys(d.receipts).length + ' xe</span>' +
          '</div>';
      });

      // Status badge
      var statusBadge = '<span class="comp-status ' + status + '">' + (statusText[status] || status) + '</span>';

      // Dates + aging days
      var datesHtml = '';
      if (cs && cs.startDate) {
        var agingDays = Math.floor((new Date() - new Date(cs.startDate)) / 86400000);
        datesHtml = '<div class="comp-dates">B\u0110: ' + formatDate(cs.startDate);
        if (cs.fullDate) datesHtml += ' &middot; \u0110\u1EA7y: ' + formatDate(cs.fullDate);
        datesHtml += '</div>';
        if (status === 'full' || status === 'processing') {
          var agingColor = agingDays >= 21 ? '#16a34a' : agingDays >= 14 ? '#d97706' : '#64748b';
          datesHtml += '<div class="comp-aging" style="font-size:12px;font-weight:700;color:' + agingColor + ';">\u0168: ' + agingDays + ' ng\u00E0y</div>';
        }
      }

      // Action buttons
      var actionsHtml = '<div class="comp-actions" onclick="event.stopPropagation();">';
      if (status === 'filling') {
        actionsHtml += '<button class="comp-action-btn btn-mark-full" onclick="markCompartmentFull(\'' + name + '\')">\u0110\u00E1nh d\u1EA5u \u0111\u1EA7y</button>';
      } else if (status === 'full') {
        actionsHtml += '<button class="comp-action-btn btn-reopen" onclick="reopenCompartment(\'' + name + '\')">M\u1EDF l\u1EA1i</button>';
        actionsHtml += '<button class="comp-action-btn btn-clear" onclick="clearCompartment(\'' + name + '\')">X\u00F3a ng\u0103n</button>';
      } else if (status === 'processing') {
        actionsHtml += '<span style="font-size:12px;color:var(--text-muted);">\u0110ang ch\u1EBF bi\u1EBFn...</span>';
      }
      actionsHtml += '</div>';

      html += '<div class="compartment-card ' + status + '" onclick="showCompartmentDetail(\'' + name + '\')" style="cursor:pointer;">' +
        '<div class="comp-header">' +
          '<span class="comp-name">' + name + '</span>' +
          statusBadge +
        '</div>' +
        '<div class="comp-badge-line">' + totalVehicles + ' xe \u00B7 ' + logs.length + ' l\u1EA7n</div>' +
        '<div class="comp-weight">' + formatNumber(Math.round(totalWeight * 100) / 100) + ' <small>kg</small></div>' +
        '<div class="comp-dry">' +
          '<span>QK ' + formatNumber(Math.round(totalDry * 100) / 100) + ' kg</span>' +
          (avgDRC ? '<span class="comp-drc">DRC ' + avgDRC + '%</span>' : '') +
        '</div>' +
        datesHtml +
        '<div class="comp-types">' + typeRows + '</div>' +
        (targets.length > 0 ? '<div class="comp-target">\u2192 ' + targets.map(function(t) { return targetText[t] || t; }).join(', ') + '</div>' : '') +
        actionsHtml +
        '</div>';
    } else {
      html += '<div class="compartment-card empty">' +
        '<div class="comp-header"><span class="comp-name">' + name + '</span></div>' +
        '<div class="comp-empty">Tr\u1ED1ng</div>' +
        '</div>';
    }
  }

  grid.innerHTML = html;
}

function renderMiscStorageTable() {
  var tbody = document.getElementById('miscStorageBody');
  var dateInput = document.getElementById('miscStorageDate');
  var filterDate = dateInput ? dateInput.value : '';

  // Filter logs by selected date for the table
  var filtered = miscStorageLogs;
  if (filterDate) {
    filtered = miscStorageLogs.filter(function(l) { return l.date === filterDate; });
  }

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#000;">Ch\u01B0a c\u00F3 d\u1EEF li\u1EC7u' + (filterDate ? ' ng\u00E0y n\u00E0y' : '') + '</td></tr>';
    return;
  }

  var typeText = { dong: 'M\u1EE7 \u0110\u00F4ng', chen: 'M\u1EE7 Ch\u00E9n', day: 'M\u1EE7 D\u00E2y', dam: 'M\u1EE7 D\u0103m', dat: 'M\u1EE7 \u0110\u1EA5t', tanthu: 'T\u1EADn Thu' };
  var targetText = { SVR10: 'SVR 10', SVR20: 'SVR 20', ngoaile: 'Ngo\u1EA1i l\u1EC7' };

  tbody.innerHTML = filtered.map(function(l) {
    return '<tr>' +
    '<td><strong>' + l.compartment + '</strong></td>' +
    '<td>' + formatDate(l.date) + '</td>' +
    '<td>' + (l.vehicleNo || l.sourceReceipt || '-') + '</td>' +
    '<td>' + (typeText[l.miscType] || l.miscType) + '</td>' +
    '<td>' + formatNumber(l.weight || 0) + '</td>' +
    '<td>' + (l.drcPercent ? l.drcPercent.toFixed(1) + '%' : '-') + '</td>' +
    '<td><strong>' + formatNumber(l.dryWeight || 0) + '</strong></td>' +
    '<td>' + (l.targetProduct ? (targetText[l.targetProduct] || l.targetProduct) : '-') + '</td>' +
    '<td><div class="action-btns">' +
      '<button class="action-btn delete" onclick="deleteMiscLog(\'' + l.id + '\')" title="X\u00F3a">\uD83D\uDDD1\uFE0F</button>' +
    '</div></td></tr>';
  }).join('');
}

async function openMiscStorageModal() {
  document.getElementById('miscStorageId').value = '';
  document.getElementById('msCompartment').value = '';
  document.getElementById('msMiscType').value = 'dong';
  document.getElementById('msWeight').value = '';
  document.getElementById('msDRC').value = '';
  document.getElementById('msDryWeight').value = '';
  document.getElementById('msTargetProduct').value = '';
  updateMiscTargetProduct();

  // Disable compartments that are full or processing
  var msCompartment = document.getElementById('msCompartment');
  var compStatus = window.miscCompartmentStatus || {};
  for (var j = 0; j < msCompartment.options.length; j++) {
    var opt = msCompartment.options[j];
    if (!opt.value) continue;
    var cs = compStatus[opt.value];
    if (cs && (cs.status === 'full' || cs.status === 'processing')) {
      opt.disabled = true;
      opt.textContent = opt.value + ' (\u0111\u00E3 \u0111\u1EA7y)';
    } else {
      opt.disabled = false;
      opt.textContent = opt.value;
    }
  }

  // Show modal immediately with loading state
  var container = document.getElementById('msAvailableReceipts');
  container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:12px;text-align:center;">\u0110ang t\u1EA3i danh s\u00E1ch xe...</p>';
  document.getElementById('miscStorageModal').classList.add('active');

  // Load vehicles directly from harvestData (independent of tab "S\u1EA3n L\u01B0\u1EE3ng Xe")
  var msDate = document.getElementById('miscStorageDate').value || new Date().toISOString().slice(0, 10);
  await loadMiscVehicles(msDate);
}

async function loadMiscVehicles(dateStr) {
  var container = document.getElementById('msAvailableReceipts');
  try {
    var snapshot = await db.collection('harvestData')
      .where('importDate', '==', dateStr)
      .get();

    var seenSoCt = new Set();
    var vehicles = [];
    snapshot.forEach(function(doc) {
      var d = doc.data();
      if (d.source === 'ZEN_PURCHASE') return;
      var zenDvcs = (d.zenDvcs || '').toUpperCase();
      if (zenDvcs !== currentFactory && zenDvcs !== 'ALL') return;
      var soCt = d.soCt || doc.id;
      if (seenSoCt.has(soCt)) return;
      seenSoCt.add(soCt);
      vehicles.push({
        receiptNo: d.soCt || doc.id,
        vehicleNo: d.vehicleNo || d.soXe || '',
        plantation: d.plantation || d.nongTruong || '',
        muChen: d.muChen || 0, qkMuChen: d.qkMuChen || 0,
        muDay: d.muDay || 0, qkMuDay: d.qkMuDay || 0,
        muDong: d.muDong || 0, qkMuDong: d.qkMuDong || 0
      });
    });

    var available = vehicles.filter(function(r) {
      return (r.muChen > 0 || r.muDay > 0 || r.muDong > 0);
    });

    renderMiscVehicleList(container, available, dateStr);
  } catch (e) {
    console.warn('Load misc vehicles error:', e.message);
    container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:12px;">L\u1ED7i t\u1EA3i d\u1EEF li\u1EC7u: ' + e.message + '</p>';
  }
}

function renderMiscVehicleList(container, available, dateStr) {
  var gridCols = '28px minmax(70px,1fr) minmax(70px,1fr) 1fr 0.7fr 1fr 1fr 0.7fr 1fr 1fr 0.7fr 1fr 1.1fr';

  // Build map of receipts already entered per column: { receiptNo: { dong: 'N1', chen: 'N3' } }
  var usedMap = {};
  var colMapLookup = { dong: 'dong', chen: 'chen', day: 'day', dam: 'dong', dat: 'dong', tanthu: 'dong' };
  (window.miscStorageLogs || []).forEach(function(log) {
    var col = colMapLookup[log.miscType] || 'dong';
    var receipts = log.sourceReceipts || (log.sourceReceipt ? log.sourceReceipt.split(', ') : []);
    receipts.forEach(function(rn) {
      if (!rn) return;
      if (!usedMap[rn]) usedMap[rn] = {};
      usedMap[rn][col] = log.compartment || '?';
    });
  });

  if (available.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:12px;">Kh\u00F4ng c\u00F3 xe m\u1EE7 t\u1EA1p ng\u00E0y ' + formatDate(dateStr) + '. H\u00E3y \u0111\u1ED3ng b\u1ED9 ZEN tr\u01B0\u1EDBc.</p>';
  } else {
    // Sticky header with date picker
    var html = '<div style="position:sticky;top:0;z-index:2;background:var(--bg-tertiary);">';
    // Date selector row
    html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid var(--border-color);font-size:12px;color:var(--text-secondary);">' +
      '<span>Ng\u00E0y xe:</span>' +
      '<input type="date" id="msVehicleDate" value="' + dateStr + '" onchange="loadMiscVehicles(this.value)" style="font-size:12px;padding:2px 6px;border-radius:4px;border:1px solid var(--border-color);background:var(--bg-primary);color:var(--text-primary);">' +
      '<span style="margin-left:auto;font-weight:600;">' + available.length + ' xe c\u00F3 m\u1EE7 t\u1EA1p</span></div>';
    // Group header row
    html += '<div style="display:grid;grid-template-columns:' + gridCols + ';gap:2px;padding:6px 8px 2px;font-size:12px;font-weight:700;color:var(--text-secondary);">' +
      '<span></span><span></span><span></span>' +
      '<span style="grid-column:span 3;text-align:center;color:#f59e0b;border-bottom:2px solid #f59e0b;padding-bottom:2px;" data-misc-col="chen">M\u1EE7 Ch\u00E9n</span>' +
      '<span style="grid-column:span 3;text-align:center;color:#a855f7;border-bottom:2px solid #a855f7;padding-bottom:2px;" data-misc-col="day">M\u1EE7 D\u00E2y</span>' +
      '<span style="grid-column:span 3;text-align:center;color:#22c55e;border-bottom:2px solid #22c55e;padding-bottom:2px;" data-misc-col="dong">M\u1EE7 \u0110\u00F4ng</span>' +
      '<span style="text-align:right;">\u03A3</span></div>';
    // Sub header row
    html += '<div style="display:grid;grid-template-columns:' + gridCols + ';gap:2px;padding:2px 8px 4px;font-size:12px;color:var(--text-muted);border-bottom:1px solid var(--border-color);">' +
      '<span><input type="checkbox" id="msSelectAll" onchange="toggleMiscSelectAll(this)" style="width:14px;height:14px;accent-color:var(--accent);cursor:pointer;"></span><span>S\u1ED1 Xe</span><span>N.Tr\u01B0\u1EDDng</span>' +
      '<span style="text-align:right;" data-misc-col="chen">T\u01B0\u01A1i</span><span style="text-align:right;" data-misc-col="chen">DRC</span><span style="text-align:right;" data-misc-col="chen">QK</span>' +
      '<span style="text-align:right;" data-misc-col="day">T\u01B0\u01A1i</span><span style="text-align:right;" data-misc-col="day">DRC</span><span style="text-align:right;" data-misc-col="day">QK</span>' +
      '<span style="text-align:right;" data-misc-col="dong">T\u01B0\u01A1i</span><span style="text-align:right;" data-misc-col="dong">DRC</span><span style="text-align:right;" data-misc-col="dong">QK</span>' +
      '<span style="text-align:right;">QK</span></div>';
    html += '</div>';

    // Data rows
    available.forEach(function(r) {
      var used = usedMap[r.receiptNo] || {};
      var chenUsed = used.chen || null;
      var dayUsed = used.day || null;
      var dongUsed = used.dong || null;

      var chenDRC = r.muChen > 0 && r.qkMuChen > 0 ? (r.qkMuChen / r.muChen * 100).toFixed(1) : '-';
      var dayDRC = r.muDay > 0 && r.qkMuDay > 0 ? (r.qkMuDay / r.muDay * 100).toFixed(1) : '-';
      var dongDRC = r.muDong > 0 && r.qkMuDong > 0 ? (r.qkMuDong / r.muDong * 100).toFixed(1) : '-';
      var totalQK = (r.qkMuChen || 0) + (r.qkMuDay || 0) + (r.qkMuDong || 0);
      var dim = 'color:var(--text-muted);';
      var usedStyle = 'text-decoration:line-through;opacity:0.4;';

      // Helper to render value with used badge
      function val(v, color, col) {
        var isUsed = used[col];
        if (v <= 0) return '-';
        if (isUsed) return '<span style="' + usedStyle + '">' + formatNumber(v) + '</span><span class="ms-used-badge">' + isUsed + '</span>';
        return formatNumber(v);
      }
      function valDRC(drc, color, col) {
        var isUsed = used[col];
        if (drc === '-') return '-';
        if (isUsed) return '<span style="' + usedStyle + '">' + drc + '</span>';
        return drc;
      }

      // Determine effective amounts (0 if already used)
      var effChen = chenUsed ? 0 : (r.muChen || 0);
      var effDay = dayUsed ? 0 : (r.muDay || 0);
      var effDong = dongUsed ? 0 : (r.muDong || 0);
      var effQkChen = chenUsed ? 0 : (r.qkMuChen || 0);
      var effQkDay = dayUsed ? 0 : (r.qkMuDay || 0);
      var effQkDong = dongUsed ? 0 : (r.qkMuDong || 0);

      html += '<label class="ms-vehicle-row" style="display:grid;grid-template-columns:' + gridCols + ';gap:2px;align-items:center;padding:6px 8px;border-bottom:1px solid var(--border-color);cursor:pointer;font-size:12px;color:var(--text-primary);">' +
        '<input type="checkbox" class="ms-receipt-check" value="' + r.receiptNo + '" ' +
        'data-vehicle="' + (r.vehicleNo || '-') + '" data-plantation="' + (r.plantation || '') + '" ' +
        'data-chen="' + effChen + '" data-qkchen="' + effQkChen + '" ' +
        'data-day="' + effDay + '" data-qkday="' + effQkDay + '" ' +
        'data-dong="' + effDong + '" data-qkdong="' + effQkDong + '" ' +
        'data-used-chen="' + (chenUsed || '') + '" data-used-day="' + (dayUsed || '') + '" data-used-dong="' + (dongUsed || '') + '" ' +
        'onchange="updateMiscTotals()">' +
        '<span style="font-weight:600;font-size:12px;">' + (r.vehicleNo || '-') + '</span>' +
        '<span style="color:var(--text-secondary);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (r.plantation || '') + '</span>' +
        '<span style="text-align:right;' + (r.muChen > 0 ? (chenUsed ? usedStyle : 'color:#f59e0b;') : dim) + '" data-misc-col="chen">' + val(r.muChen, '#f59e0b', 'chen') + '</span>' +
        '<span style="text-align:right;font-size:12px;' + (r.muChen > 0 ? (chenUsed ? usedStyle : 'color:#f59e0b;') : dim) + '" data-misc-col="chen">' + valDRC(chenDRC, '#f59e0b', 'chen') + '</span>' +
        '<span style="text-align:right;font-weight:600;' + (r.qkMuChen > 0 ? (chenUsed ? usedStyle : 'color:#f59e0b;') : dim) + '" data-misc-col="chen">' + val(r.qkMuChen, '#f59e0b', 'chen') + '</span>' +
        '<span style="text-align:right;' + (r.muDay > 0 ? (dayUsed ? usedStyle : 'color:#a855f7;') : dim) + '" data-misc-col="day">' + val(r.muDay, '#a855f7', 'day') + '</span>' +
        '<span style="text-align:right;font-size:12px;' + (r.muDay > 0 ? (dayUsed ? usedStyle : 'color:#a855f7;') : dim) + '" data-misc-col="day">' + valDRC(dayDRC, '#a855f7', 'day') + '</span>' +
        '<span style="text-align:right;font-weight:600;' + (r.qkMuDay > 0 ? (dayUsed ? usedStyle : 'color:#a855f7;') : dim) + '" data-misc-col="day">' + val(r.qkMuDay, '#a855f7', 'day') + '</span>' +
        '<span style="text-align:right;' + (r.muDong > 0 ? (dongUsed ? usedStyle : 'color:#22c55e;') : dim) + '" data-misc-col="dong">' + val(r.muDong, '#22c55e', 'dong') + '</span>' +
        '<span style="text-align:right;font-size:12px;' + (r.muDong > 0 ? (dongUsed ? usedStyle : 'color:#22c55e;') : dim) + '" data-misc-col="dong">' + valDRC(dongDRC, '#22c55e', 'dong') + '</span>' +
        '<span style="text-align:right;font-weight:600;' + (r.qkMuDong > 0 ? (dongUsed ? usedStyle : 'color:#22c55e;') : dim) + '" data-misc-col="dong">' + val(r.qkMuDong, '#22c55e', 'dong') + '</span>' +
        '<span style="text-align:right;font-weight:700;">' + (totalQK > 0 ? formatNumber(totalQK) : '-') + '</span>' +
        '</label>';
    });
    container.innerHTML = html;
  }

  setTimeout(function() { updateMiscVehicleHighlight(); }, 50);
}

function updateMiscTotals() {
  var miscType = document.getElementById('msMiscType').value;
  var colMap = { dong: 'dong', chen: 'chen', day: 'day', dam: 'dong', dat: 'dong', tanthu: 'dong' };
  var col = colMap[miscType] || 'dong';
  var checks = document.querySelectorAll('.ms-receipt-check:checked');
  var totalWeight = 0, totalDry = 0;
  checks.forEach(function(c) {
    totalWeight += parseFloat(c.dataset[col]) || 0;
    totalDry += parseFloat(c.dataset['qk' + col]) || 0;
  });
  document.getElementById('msWeight').value = totalWeight ? Math.round(totalWeight * 100) / 100 : '';
  document.getElementById('msDRC').value = totalWeight > 0 && totalDry > 0 ? (totalDry / totalWeight * 100).toFixed(1) : '';
  document.getElementById('msDryWeight').value = totalDry ? Math.round(totalDry * 100) / 100 : '';
}

function toggleMiscSelectAll(master) {
  var checks = document.querySelectorAll('.ms-receipt-check');
  checks.forEach(function(c) { if (!c.disabled) c.checked = master.checked; });
  updateMiscTotals();
}

function updateMiscVehicleHighlight() {
  var miscType = document.getElementById('msMiscType').value;
  var colMap = { dong: 'dong', chen: 'chen', day: 'day', dam: 'dong', dat: 'dong', tanthu: 'dong' };
  var activeCol = colMap[miscType] || 'dong';
  document.querySelectorAll('#msAvailableReceipts [data-misc-col]').forEach(function(el) {
    var col = el.getAttribute('data-misc-col');
    el.style.opacity = (col === activeCol) ? '1' : '0.4';
  });
  // Disable checkboxes where active column is already used
  document.querySelectorAll('.ms-receipt-check').forEach(function(cb) {
    var usedComp = cb.dataset['used' + activeCol.charAt(0).toUpperCase() + activeCol.slice(1)] || cb.dataset['used-' + activeCol] || '';
    // Check data-used-chen, data-used-day, data-used-dong
    usedComp = cb.getAttribute('data-used-' + activeCol) || '';
    if (usedComp) {
      cb.disabled = true;
      cb.checked = false;
      cb.closest('label').style.opacity = '0.5';
      cb.closest('label').style.cursor = 'not-allowed';
    } else {
      cb.disabled = false;
      cb.closest('label').style.opacity = '';
      cb.closest('label').style.cursor = 'pointer';
    }
  });
  // Re-compute totals from checked vehicles
  updateMiscTotals();
}

function updateMiscDryWeight() {
  var w = parseFloat(document.getElementById('msWeight').value) || 0;
  var drc = parseFloat(document.getElementById('msDRC').value) || 0;
  document.getElementById('msDryWeight').value = w > 0 && drc > 0 ? (w * drc / 100).toFixed(1) : '';
}

function closeMiscStorageModal() {
  document.getElementById('miscStorageModal').classList.remove('active');
}

async function deleteMiscLog(id) {
  if (!(await showConfirm('X\u00F3a b\u1EA3n ghi n\u00E0y?'))) return;
  try {
    var log = miscStorageLogs.find(function(l) { return l.id === id; });
    await db.collection('miscStorageLogs').doc(id).delete();
    // Decrement compartment totals
    if (log && log.compartment) {
      await db.collection('miscCompartments').doc(log.compartment).update({
        totalWeight: ErpDb.firestore.FieldValue.increment(-(log.weight || 0)),
        totalDry: ErpDb.firestore.FieldValue.increment(-(log.dryWeight || 0)),
        updatedAt: ErpDb.firestore.FieldValue.serverTimestamp()
      }).catch(function() {});
    }
  } catch (e) { console.warn(e.message); }
  showToast('\u0110\u00E3 x\u00F3a!');
  loadMiscStorage();
}

async function saveMiscStorage() {
  var compartment = document.getElementById('msCompartment').value;
  var miscType = document.getElementById('msMiscType').value;
  var weight = parseFloat(document.getElementById('msWeight').value) || 0;
  var drcPercent = parseFloat(document.getElementById('msDRC').value) || 0;
  var date = document.getElementById('miscStorageDate').value || new Date().toISOString().slice(0, 10);

  if (!compartment || !weight) {
    showToast('Vui l\u00F2ng ch\u1ECDn ng\u0103n v\u00E0 nh\u1EADp tr\u1ECDng l\u01B0\u1EE3ng', 'error');
    return;
  }

  // Check compartment status — block if full or processing
  var compStatus = (window.miscCompartmentStatus || {})[compartment];
  if (compStatus && (compStatus.status === 'full' || compStatus.status === 'processing')) {
    showToast('Ng\u0103n ' + compartment + ' \u0111\u00E3 \u0111\u1EA7y, kh\u00F4ng th\u1EC3 nh\u1EADp th\u00EAm!', 'error');
    return;
  }

  // Collect all checked vehicles
  var checks = document.querySelectorAll('.ms-receipt-check:checked');
  var sourceReceipts = [];
  var vehicleNos = [];
  checks.forEach(function(c) {
    sourceReceipts.push(c.value);
    vehicleNos.push(c.dataset.vehicle || '');
  });
  var sourceReceipt = sourceReceipts.join(', ');
  var vehicleNo = vehicleNos.join(', ');

  var targetProduct = document.getElementById('msTargetProduct') ? document.getElementById('msTargetProduct').value : '';
  var dryWeight = parseFloat(document.getElementById('msDryWeight').value) || parseFloat((weight * drcPercent / 100).toFixed(2));
  var data = {
    compartment: compartment, date: date, sourceReceipt: sourceReceipt, sourceReceipts: sourceReceipts,
    miscType: miscType, weight: weight, drcPercent: drcPercent, dryWeight: dryWeight,
    vehicleNo: vehicleNo, vehicleNos: vehicleNos,
    targetProduct: targetProduct,
    factory: currentFactory,
    createdAt: ErpDb.firestore.FieldValue.serverTimestamp(),
    createdBy: currentUser ? currentUser.id : null
  };

  try {
    await db.collection('miscStorageLogs').add(data);

    // Update compartment status document
    var compRef = db.collection('miscCompartments').doc(compartment);
    if (!compStatus) {
      await compRef.set({
        status: 'filling', startDate: date,
        fullDate: null,
        totalWeight: weight, totalDry: dryWeight,
        factory: currentFactory,
        updatedAt: ErpDb.firestore.FieldValue.serverTimestamp(),
        updatedBy: currentUser ? currentUser.id : null
      });
    } else {
      await compRef.update({
        totalWeight: ErpDb.firestore.FieldValue.increment(weight),
        totalDry: ErpDb.firestore.FieldValue.increment(dryWeight),
        updatedAt: ErpDb.firestore.FieldValue.serverTimestamp(),
        updatedBy: currentUser ? currentUser.id : null
      });
    }

    showToast('\u0110\u00E3 l\u01B0u!');
  } catch (error) {
    console.warn('Save misc error:', error.message);
    showToast('\u0110\u00E3 l\u01B0u offline!', 'warning');
  }

  closeMiscStorageModal();
  loadMiscStorage();
}

function updateMiscTargetProduct() {
  const miscType = document.getElementById('msMiscType').value;
  const target = document.getElementById('msTargetProduct');
  const hint = document.getElementById('msTargetHint');
  if (!target) return;
  const autoMap = { dong:'SVR10', chen:'SVR10', day:'SVR20', dam:'ngoaile', dat:'ngoaile', tanthu:'' };
  target.value = autoMap[miscType] || '';
  if (hint) {
    const labels = { dong:'Mủ đông → SVR 10', chen:'Mủ chén → SVR 10', day:'Mủ dây → SVR 20', dam:'Mủ dăm → Ngoại lệ', dat:'Mủ đất → Ngoại lệ', tanthu:'Tận thu - xác định theo chất lượng' };
    hint.textContent = labels[miscType] || 'TCCS 102 Điều 4';
  }
}

async function markCompartmentFull(name) {
  if (!(await showConfirm('\u0110\u00E1nh d\u1EA5u ng\u0103n ' + name + ' \u0111\u00E3 \u0111\u1EA7y?'))) return;
  try {
    await db.collection('miscCompartments').doc(name).update({
      status: 'full',
      fullDate: new Date().toISOString().slice(0, 10),
      updatedAt: ErpDb.firestore.FieldValue.serverTimestamp(),
      updatedBy: currentUser ? currentUser.id : null
    });
    showToast('Ng\u0103n ' + name + ' \u0111\u00E3 \u0111\u00E1nh d\u1EA5u \u0111\u1EA7y!');
  } catch (e) {
    showToast('L\u1ED7i: ' + e.message, 'error');
  }
  loadMiscStorage();
}

async function reopenCompartment(name) {
  if (!(await showConfirm('M\u1EDF l\u1EA1i ng\u0103n ' + name + ' \u0111\u1EC3 nh\u1EADp th\u00EAm?'))) return;
  try {
    await db.collection('miscCompartments').doc(name).update({
      status: 'filling',
      fullDate: null,
      updatedAt: ErpDb.firestore.FieldValue.serverTimestamp(),
      updatedBy: currentUser ? currentUser.id : null
    });
    showToast('Ng\u0103n ' + name + ' \u0111\u00E3 m\u1EDF l\u1EA1i!');
  } catch (e) {
    showToast('L\u1ED7i: ' + e.message, 'error');
  }
  loadMiscStorage();
}

async function clearCompartment(name) {
  if (!(await showConfirm('X\u00F3a to\u00E0n b\u1ED9 d\u1EEF li\u1EC7u ng\u0103n ' + name + '? H\u00E0nh \u0111\u1ED9ng n\u00E0y kh\u00F4ng th\u1EC3 ho\u00E0n t\u00E1c.'))) return;
  try {
    var snapshot = await db.collection('miscStorageLogs')
      .where('compartment', '==', name)
      .where('factory', '==', currentFactory)
      .get();
    var batch = db.batch();
    snapshot.docs.forEach(function(doc) { batch.delete(doc.ref); });
    await batch.commit();
    await db.collection('miscCompartments').doc(name).delete();
    showToast('\u0110\u00E3 x\u00F3a ng\u0103n ' + name + '!');
  } catch (e) {
    showToast('L\u1ED7i: ' + e.message, 'error');
  }
  loadMiscStorage();
}

// ---- Compartment Detail Modal ----
function showCompartmentDetail(name) {
  var compStatus = (window.miscCompartmentStatus || {})[name];
  var status = compStatus ? compStatus.status : 'empty';
  var logs = miscStorageLogs.filter(function(l) { return l.compartment === name; });

  // Header color by status
  var headerEl = document.getElementById('compDetailHeader');
  var colors = { filling: '#3b82f6,#2563eb', full: '#f59e0b,#d97706', processing: '#a855f7,#7c3aed' };
  headerEl.style.background = 'linear-gradient(135deg,' + (colors[status] || '#64748b,#475569') + ')';

  var statusText = { empty: 'Tr\u1ED1ng', filling: '\u0110ang nh\u1EADp', full: '\u0110\u00E3 \u0111\u1EA7y', processing: '\u0110ang CB' };
  document.getElementById('compDetailTitle').textContent = 'Ng\u0103n ' + name + ' \u2014 ' + (statusText[status] || status);

  // Summary
  var totalW = 0, totalD = 0, detailUniqueVehicles = {};
  logs.forEach(function(l) {
    totalW += l.weight || 0; totalD += l.dryWeight || 0;
    var receipts = l.sourceReceipts || (l.sourceReceipt ? l.sourceReceipt.split(', ') : []);
    receipts.forEach(function(rn) { if (rn) detailUniqueVehicles[rn] = true; });
  });
  var avgDRC = totalW > 0 && totalD > 0 ? (totalD / totalW * 100).toFixed(1) : '-';
  var summaryHtml = '<div class="comp-detail-stat"><span class="comp-detail-label">S\u1ED1 xe</span><span class="comp-detail-value">' + Object.keys(detailUniqueVehicles).length + '</span></div>' +
    '<div class="comp-detail-stat"><span class="comp-detail-label">S\u1ED1 l\u1EA7n nh\u1EADp</span><span class="comp-detail-value">' + logs.length + '</span></div>' +
    '<div class="comp-detail-stat"><span class="comp-detail-label">T\u1ED5ng TL</span><span class="comp-detail-value">' + formatNumber(Math.round(totalW * 100) / 100) + ' kg</span></div>' +
    '<div class="comp-detail-stat"><span class="comp-detail-label">T\u1ED5ng QK</span><span class="comp-detail-value">' + formatNumber(Math.round(totalD * 100) / 100) + ' kg</span></div>' +
    '<div class="comp-detail-stat"><span class="comp-detail-label">DRC TB</span><span class="comp-detail-value">' + avgDRC + '%</span></div>';
  if (compStatus && compStatus.startDate) {
    summaryHtml += '<div class="comp-detail-stat"><span class="comp-detail-label">B\u0110</span><span class="comp-detail-value">' + formatDate(compStatus.startDate) + '</span></div>';
  }
  if (compStatus && compStatus.fullDate) {
    summaryHtml += '<div class="comp-detail-stat"><span class="comp-detail-label">\u0110\u1EA7y</span><span class="comp-detail-value">' + formatDate(compStatus.fullDate) + '</span></div>';
  }
  if (compStatus && compStatus.startDate && (status === 'full' || status === 'processing')) {
    var agingDays = Math.floor((new Date() - new Date(compStatus.startDate)) / 86400000);
    var agingColor = agingDays >= 21 ? '#16a34a' : agingDays >= 14 ? '#d97706' : '#ef4444';
    summaryHtml += '<div class="comp-detail-stat"><span class="comp-detail-label">\u0168</span><span class="comp-detail-value" style="color:' + agingColor + ';">' + agingDays + ' ng\u00E0y</span></div>';
  }
  document.getElementById('compDetailSummary').innerHTML = summaryHtml;

  // Logs table
  var typeText = { dong: '\u0110\u00F4ng', chen: 'Ch\u00E9n', day: 'D\u00E2y', dam: 'D\u0103m', dat: '\u0110\u1EA5t', tanthu: 'T.Thu' };
  var targetText = { SVR10: 'SVR 10', SVR20: 'SVR 20', ngoaile: 'NL' };
  var tbody = document.getElementById('compDetailBody');

  if (logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#000;">Ch\u01B0a c\u00F3 d\u1EEF li\u1EC7u</td></tr>';
  } else {
    // Sort by date desc
    logs.sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); });
    tbody.innerHTML = logs.map(function(l) {
      return '<tr>' +
        '<td>' + formatDate(l.date) + '</td>' +
        '<td>' + (l.vehicleNo || l.sourceReceipt || '-') + '</td>' +
        '<td>' + (typeText[l.miscType] || l.miscType) + '</td>' +
        '<td>' + formatNumber(l.weight || 0) + '</td>' +
        '<td>' + (l.drcPercent ? l.drcPercent.toFixed(1) + '%' : '-') + '</td>' +
        '<td><strong>' + formatNumber(l.dryWeight || 0) + '</strong></td>' +
        '<td>' + (l.targetProduct ? (targetText[l.targetProduct] || l.targetProduct) : '-') + '</td>' +
        '<td><div class="action-btns">' +
          '<button class="action-btn edit" onclick="editMiscLog(\'' + l.id + '\')" title="S\u1EEDa">\u270F\uFE0F</button>' +
          '<button class="action-btn delete" onclick="deleteMiscLogFromDetail(\'' + l.id + '\',\'' + name + '\')" title="X\u00F3a">\uD83D\uDDD1\uFE0F</button>' +
        '</div></td></tr>';
    }).join('');
  }

  // Footer actions
  var footerHtml = '<button class="btn btn-secondary" onclick="closeCompDetail()">\u0110\u00F3ng</button>';
  if (status === 'filling') {
    footerHtml += '<button class="btn" style="background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;" onclick="closeCompDetail();markCompartmentFull(\'' + name + '\')">\u0110\u00E1nh d\u1EA5u \u0111\u1EA7y</button>';
  } else if (status === 'full') {
    footerHtml += '<button class="btn" style="background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;" onclick="closeCompDetail();reopenCompartment(\'' + name + '\')">M\u1EDF l\u1EA1i</button>';
    footerHtml += '<button class="btn" style="background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;" onclick="closeCompDetail();clearCompartment(\'' + name + '\')">X\u00F3a ng\u0103n</button>';
  }
  document.getElementById('compDetailFooter').innerHTML = footerHtml;

  document.getElementById('compDetailModal').classList.add('active');
}

function closeCompDetail() {
  document.getElementById('compDetailModal').classList.remove('active');
}

async function deleteMiscLogFromDetail(id, compName) {
  if (!(await showConfirm('X\u00F3a b\u1EA3n ghi n\u00E0y?'))) return;
  try {
    var log = miscStorageLogs.find(function(l) { return l.id === id; });
    await db.collection('miscStorageLogs').doc(id).delete();
    if (log && log.compartment) {
      await db.collection('miscCompartments').doc(log.compartment).update({
        totalWeight: ErpDb.firestore.FieldValue.increment(-(log.weight || 0)),
        totalDry: ErpDb.firestore.FieldValue.increment(-(log.dryWeight || 0)),
        updatedAt: ErpDb.firestore.FieldValue.serverTimestamp()
      }).catch(function() {});
    }
  } catch (e) { console.warn(e.message); }
  showToast('\u0110\u00E3 x\u00F3a!');
  await loadMiscStorage();
  showCompartmentDetail(compName);
}

function editMiscLog(id) {
  var log = miscStorageLogs.find(function(l) { return l.id === id; });
  if (!log) return;

  // Show inline edit row
  var tbody = document.getElementById('compDetailBody');
  var rows = tbody.querySelectorAll('tr');
  for (var i = 0; i < rows.length; i++) {
    var editBtn = rows[i].querySelector('.action-btn.edit');
    if (editBtn && editBtn.getAttribute('onclick').indexOf(id) !== -1) {
      var typeText = { dong: '\u0110\u00F4ng', chen: 'Ch\u00E9n', day: 'D\u00E2y', dam: 'D\u0103m', dat: '\u0110\u1EA5t', tanthu: 'T.Thu' };
      var typeOptions = '';
      ['dong','chen','day','dam','dat','tanthu'].forEach(function(t) {
        typeOptions += '<option value="' + t + '"' + (t === log.miscType ? ' selected' : '') + '>' + (typeText[t] || t) + '</option>';
      });
      var targetOptions = '<option value="">--</option><option value="SVR10"' + (log.targetProduct === 'SVR10' ? ' selected' : '') + '>SVR10</option>' +
        '<option value="SVR20"' + (log.targetProduct === 'SVR20' ? ' selected' : '') + '>SVR20</option>' +
        '<option value="ngoaile"' + (log.targetProduct === 'ngoaile' ? ' selected' : '') + '>NL</option>';

      rows[i].innerHTML = '<td><input type="date" id="editLogDate" value="' + (log.date || '') + '" style="width:110px;font-size:12px;"></td>' +
        '<td style="font-size:12px;color:var(--text-muted);">' + (log.vehicleNo || '-') + '</td>' +
        '<td><select id="editLogType" style="font-size:12px;">' + typeOptions + '</select></td>' +
        '<td><input type="number" id="editLogWeight" value="' + (log.weight || '') + '" step="0.1" style="width:70px;font-size:12px;" oninput="recalcEditDry()"></td>' +
        '<td><input type="number" id="editLogDRC" value="' + (log.drcPercent || '') + '" step="0.1" style="width:55px;font-size:12px;" oninput="recalcEditDry()"></td>' +
        '<td><input type="number" id="editLogDry" value="' + (log.dryWeight || '') + '" step="0.1" style="width:70px;font-size:12px;" readonly></td>' +
        '<td><select id="editLogTarget" style="font-size:12px;">' + targetOptions + '</select></td>' +
        '<td><div class="action-btns">' +
          '<button class="action-btn" onclick="saveEditMiscLog(\'' + id + '\',\'' + log.compartment + '\')" title="L\u01B0u" style="background:#22c55e;color:#fff;">\u2714</button>' +
          '<button class="action-btn" onclick="showCompartmentDetail(\'' + log.compartment + '\')" title="H\u1EE7y" style="background:#64748b;color:#fff;">\u2716</button>' +
        '</div></td>';
      break;
    }
  }
}

function recalcEditDry() {
  var w = parseFloat(document.getElementById('editLogWeight').value) || 0;
  var drc = parseFloat(document.getElementById('editLogDRC').value) || 0;
  document.getElementById('editLogDry').value = w > 0 && drc > 0 ? (w * drc / 100).toFixed(1) : '';
}

async function saveEditMiscLog(id, compName) {
  var oldLog = miscStorageLogs.find(function(l) { return l.id === id; });
  if (!oldLog) return;

  var newWeight = parseFloat(document.getElementById('editLogWeight').value) || 0;
  var newDRC = parseFloat(document.getElementById('editLogDRC').value) || 0;
  var newDry = parseFloat(document.getElementById('editLogDry').value) || parseFloat((newWeight * newDRC / 100).toFixed(2));
  var newDate = document.getElementById('editLogDate').value;
  var newType = document.getElementById('editLogType').value;
  var newTarget = document.getElementById('editLogTarget').value;

  if (!newWeight) { showToast('Vui l\u00F2ng nh\u1EADp tr\u1ECDng l\u01B0\u1EE3ng', 'error'); return; }

  try {
    await db.collection('miscStorageLogs').doc(id).update({
      date: newDate, miscType: newType, weight: newWeight,
      drcPercent: newDRC, dryWeight: newDry, targetProduct: newTarget,
      updatedAt: ErpDb.firestore.FieldValue.serverTimestamp(),
      updatedBy: currentUser ? currentUser.id : null
    });

    // Adjust compartment totals (delta)
    var deltaW = newWeight - (oldLog.weight || 0);
    var deltaD = newDry - (oldLog.dryWeight || 0);
    if (deltaW !== 0 || deltaD !== 0) {
      await db.collection('miscCompartments').doc(compName).update({
        totalWeight: ErpDb.firestore.FieldValue.increment(deltaW),
        totalDry: ErpDb.firestore.FieldValue.increment(deltaD),
        updatedAt: ErpDb.firestore.FieldValue.serverTimestamp()
      }).catch(function() {});
    }

    showToast('\u0110\u00E3 c\u1EADp nh\u1EADt!');
  } catch (e) {
    showToast('L\u1ED7i: ' + e.message, 'error');
  }
  await loadMiscStorage();
  showCompartmentDetail(compName);
}

// ---- SUB-TAB D: Sai Lệch DRC (TCCS 111 Chương 4) ----

function initDiscrepancyMonths() {
  const select = document.getElementById('discrepancyMonth');
  if (!select) return;
  const now = new Date();
  let html = '<option value="">-- Chọn tháng --</option>';
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = d.toISOString().slice(0,7);
    const label = `Tháng ${d.getMonth()+1}/${d.getFullYear()}`;
    html += `<option value="${val}">${label}</option>`;
  }
  select.innerHTML = html;
}

async function loadDiscrepancyData() { await TabReception.loadDiscrepancyData(); }

function calculateMonthlyDiscrepancy() {
  const month = document.getElementById('discrepancyMonth')?.value;
  if (!month) { showToast('Vui lòng chọn tháng', 'warning'); return; }
  loadDiscrepancyData();
  showToast('Đã tính bình quân tháng ' + month);
}

function exportDiscrepancy() {
  const tbody = document.getElementById('discrepancyBody');
  if (!tbody || tbody.rows.length === 0) { showToast('Không có dữ liệu', 'warning'); return; }
  showToast('Xuất Excel sai lệch DRC - sử dụng chức năng Tính Bình Quân trước', 'info');
}

// ============================================
// TAB 2 (Legacy): MATERIAL RECEIPTS
// ============================================
async function loadReceipts() {
  // Load gardens từ localStorage nếu chưa có
  if (gardens.length === 0) {
    try {
      const saved = localStorage.getItem('rubberGardens');
      if (saved) gardens = JSON.parse(saved);
    } catch (e) { /* ignore */ }

    if (gardens.length === 0) {
      try {
        const gardensSnap = await db.collection('rubberGardens').get();
        gardens = gardensSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        localStorage.setItem('rubberGardens', JSON.stringify(gardens));
      } catch (e) {
        console.warn('Firestore gardens error:', e.message);
      }
    }
  }

  // Populate garden dropdown từ mapPlots squads hoặc gardens
  const gardenSelect = document.getElementById('receiptGardenId');
  const squads = [...new Set(mapPlots.map(p => p.squad).filter(s => s))].sort();
  if (squads.length > 0) {
    gardenSelect.innerHTML = '<option value="">-- Chọn Đội SX --</option>' +
      squads.map(s => `<option value="${s}">Đội ${s}</option>`).join('');
  } else if (gardens.length > 0) {
    gardenSelect.innerHTML = '<option value="">-- Chọn vườn cây --</option>' +
      gardens.map(g => `<option value="${g.id}">${g.code} - ${g.ownerName}</option>`).join('');
  }

  // Load receipts từ localStorage trước
  try {
    const savedReceipts = localStorage.getItem('materialReceipts');
    if (savedReceipts) {
      receipts = JSON.parse(savedReceipts);
      console.log('📦 Loaded', receipts.length, 'receipts from localStorage');
    }
  } catch (e) { /* ignore */ }

  // Thử load từ Firestore
  try {
    const snapshot = await db.collection('materialReceipts')
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();

    receipts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    localStorage.setItem('materialReceipts', JSON.stringify(receipts));
    console.log('☁️ Loaded', receipts.length, 'receipts from Firestore');
  } catch (error) {
    console.warn('Firestore receipts error:', error.message);
  }

  renderReceipts();
  updateReceiptStats();
}

function renderReceipts(data = receipts) {
  const tbody = document.getElementById('receiptsTableBody');

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#000;">Chưa có phiếu nhập nào</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(r => `
    <tr>
      <td><strong>${r.receiptNo || ''}</strong></td>
      <td>${formatDate(r.date)}</td>
      <td>${r.gardenCode || ''}</td>
      <td>${r.vehicleNo || ''}</td>
      <td>${formatNumber(r.grossWeight)}</td>
      <td>${formatNumber(r.tareWeight)}</td>
      <td>${formatNumber(r.netWeight)}</td>
      <td><strong>${r.drcPercent || 0}%</strong></td>
      <td><strong>${formatNumber(r.dryWeight)} kg</strong></td>
      <td>
        <div class="action-btns">
          <button class="action-btn edit" onclick="editReceipt('${r.id}')" title="Sửa">✏️</button>
          <button class="action-btn delete" onclick="deleteReceipt('${r.id}')" title="Xóa">🗑️</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function updateReceiptStats() {
  const today = new Date().toISOString().slice(0, 10);
  const todayReceipts = receipts.filter(r => {
    const d = r.date?.toDate ? r.date.toDate() : new Date(r.date);
    return d.toISOString().slice(0, 10) === today;
  });

  document.getElementById('todayReceipts').textContent = todayReceipts.length;
  document.getElementById('todayGrossWeight').textContent = formatNumber(todayReceipts.reduce((sum, r) => sum + (r.netWeight || 0), 0));
  document.getElementById('todayDryWeight').textContent = formatNumber(todayReceipts.reduce((sum, r) => sum + (r.dryWeight || 0), 0));

  const avgDrc = todayReceipts.length > 0
    ? (todayReceipts.reduce((sum, r) => sum + (r.drcPercent || 0), 0) / todayReceipts.length).toFixed(1)
    : 0;
  document.getElementById('avgDRC').textContent = avgDrc + '%';
}

function searchReceipts() {
  const keyword = document.getElementById('receiptSearch').value.toLowerCase();
  const filtered = receipts.filter(r =>
    (r.receiptNo || '').toLowerCase().includes(keyword) ||
    (r.vehicleNo || '').toLowerCase().includes(keyword) ||
    (r.gardenCode || '').toLowerCase().includes(keyword)
  );
  renderReceipts(filtered);
}

function filterReceipts() {
  const dateFilter = document.getElementById('receiptDateFilter').value;
  if (!dateFilter) {
    renderReceipts();
    return;
  }

  const filtered = receipts.filter(r => {
    const d = r.date?.toDate ? r.date.toDate() : new Date(r.date);
    return d.toISOString().slice(0, 10) === dateFilter;
  });
  renderReceipts(filtered);
}

function openReceiptModal(id = null) {
  document.getElementById('receiptModalTitle').textContent = id ? 'Chỉnh Sửa Phiếu Nhập' : 'Tạo Phiếu Nhập Nguyên Liệu';
  document.getElementById('receiptId').value = id || '';

  if (id) {
    const r = receipts.find(x => x.id === id);
    if (r) {
      document.getElementById('receiptNo').value = r.receiptNo || '';
      document.getElementById('receiptDate').value = r.date?.toDate ? r.date.toDate().toISOString().slice(0,10) : r.date;
      document.getElementById('receiptGardenId').value = r.gardenId || '';
      document.getElementById('receiptVehicle').value = r.vehicleNo || '';
      document.getElementById('receiptGrossWeight').value = r.grossWeight || '';
      document.getElementById('receiptTareWeight').value = r.tareWeight || '';
      document.getElementById('receiptNetWeight').value = r.netWeight || '';
      document.getElementById('receiptDRC').value = r.drcPercent || '';
      calculateDryWeight();
    }
  } else {
    document.getElementById('receiptNo').value = generateCode('PN');
    document.getElementById('receiptDate').value = new Date().toISOString().slice(0,10);
    document.getElementById('receiptGardenId').value = '';
    document.getElementById('receiptVehicle').value = '';
    document.getElementById('receiptGrossWeight').value = '';
    document.getElementById('receiptTareWeight').value = '';
    document.getElementById('receiptNetWeight').value = '';
    document.getElementById('receiptDRC').value = '';
    document.getElementById('drcResult').style.display = 'none';
  }

  document.getElementById('receiptModal').classList.add('active');
}

function closeReceiptModal() {
  document.getElementById('receiptModal').classList.remove('active');
}

function editReceipt(id) {
  openReceiptModal(id);
}

function calculateNetWeight() {
  const gross = parseFloat(document.getElementById('receiptGrossWeight').value) || 0;
  const tare = parseFloat(document.getElementById('receiptTareWeight').value) || 0;
  document.getElementById('receiptNetWeight').value = (gross - tare).toFixed(1);
  calculateDryWeight();
}

function calculateDryWeight() {
  const net = parseFloat(document.getElementById('receiptNetWeight').value) || 0;
  const drc = parseFloat(document.getElementById('receiptDRC').value) || 0;
  const dryWeight = (net * drc / 100).toFixed(1);

  document.getElementById('dryWeightDisplay').textContent = formatNumber(dryWeight) + ' kg';
  document.getElementById('drcResult').style.display = drc > 0 ? 'block' : 'none';
}

async function saveReceipt() {
  const id = document.getElementById('receiptId').value;
  const receiptNo = document.getElementById('receiptNo').value.trim();
  const date = document.getElementById('receiptDate').value;
  const gardenId = document.getElementById('receiptGardenId').value;
  const vehicleNo = document.getElementById('receiptVehicle').value.trim();
  const grossWeight = parseFloat(document.getElementById('receiptGrossWeight').value) || 0;
  const tareWeight = parseFloat(document.getElementById('receiptTareWeight').value) || 0;
  const netWeight = parseFloat(document.getElementById('receiptNetWeight').value) || 0;
  const drcPercent = parseFloat(document.getElementById('receiptDRC').value) || 0;
  const dryWeight = netWeight * drcPercent / 100;

  if (!receiptNo || !date || !gardenId || !grossWeight || !tareWeight || !drcPercent) {
    showToast('Vui lòng nhập đầy đủ thông tin bắt buộc', 'error');
    return;
  }

  const garden = gardens.find(g => g.id === gardenId);

  const data = {
    receiptNo,
    date: new Date(date),
    gardenId,
    gardenCode: garden?.code || '',
    vehicleNo,
    grossWeight,
    tareWeight,
    netWeight,
    drcPercent,
    dryWeight: parseFloat(dryWeight.toFixed(2)),
    updatedAt: ErpDb.firestore.FieldValue.serverTimestamp(),
    updatedBy: currentUser?.id || null
  };

  // Chuẩn bị data cho localStorage
  const localData = {
    receiptNo,
    date: new Date(date).toISOString(),
    gardenId,
    gardenCode: garden?.code || gardenId,
    vehicleNo,
    grossWeight,
    tareWeight,
    netWeight,
    drcPercent,
    dryWeight: parseFloat(dryWeight.toFixed(2)),
    updatedAt: new Date().toISOString()
  };

  try {
    if (id) {
      await db.collection('materialReceipts').doc(id).update(data);
      showToast('Cập nhật thành công!');
    } else {
      data.createdAt = ErpDb.firestore.FieldValue.serverTimestamp();
      data.createdBy = currentUser?.id || null;
      const docRef = await db.collection('materialReceipts').add(data);
      localData.id = docRef.id;
      showToast('Tạo phiếu thành công!');
    }
  } catch (error) {
    console.warn('Firestore save error, saving locally:', error.message);
    if (id) {
      const idx = receipts.findIndex(r => r.id === id);
      if (idx >= 0) {
        receipts[idx] = { ...receipts[idx], ...localData };
      }
    } else {
      localData.id = 'local_' + Date.now();
      localData.createdAt = new Date().toISOString();
      receipts.unshift(localData);
    }
    localStorage.setItem('materialReceipts', JSON.stringify(receipts));
    showToast('Đã lưu offline!');
  }

  closeReceiptModal();
  loadReceipts();
}

async function deleteReceipt(id) {
  if (!(await showConfirm('Bạn có chắc muốn xóa phiếu này?'))) return;

  try {
    await db.collection('materialReceipts').doc(id).delete();
  } catch (error) {
    console.warn('Firestore delete error:', error.message);
  }

  receipts = receipts.filter(r => r.id !== id);
  localStorage.setItem('materialReceipts', JSON.stringify(receipts));
  showToast('Đã xóa!');
  loadReceipts();
}

function exportReceipts() {
  if (receipts.length === 0) {
    showToast('Không có dữ liệu để xuất', 'warning');
    return;
  }

  const data = receipts.map(r => ({
    'Số Phiếu': r.receiptNo,
    'Ngày': formatDate(r.date),
    'Mã Vườn': r.gardenCode,
    'Biển Số Xe': r.vehicleNo,
    'TL Cân Vào (kg)': r.grossWeight,
    'TL Cân Ra (kg)': r.tareWeight,
    'TL Ròng (kg)': r.netWeight,
    'DRC (%)': r.drcPercent,
    'TL Khô (kg)': r.dryWeight
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Phiếu Nhập');
  XLSX.writeFile(wb, `PhieuNhap_${new Date().toISOString().slice(0,10)}.xlsx`);
  showToast('Đã xuất file Excel!');
}

// ============================================
// TAB 3: PRODUCTION BATCHES (MES)
// ============================================
async function loadBatches() {
  try {
    const snapshot = await db.collection('productionBatches')
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();

    batches = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(d => !d.factory || d.factory === currentFactory);
    renderBatches();
    updateBatchStats();
    renderStepDashboard(currentStage);
  } catch (error) {
    console.error('Error loading batches:', error);
    showToast('Lỗi tải dữ liệu lô sản xuất', 'error');
  }
}

function renderBatches(data = batches) {
  const tbody = document.getElementById('batchesTableBody');

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;color:#000;">Chưa có lô sản xuất nào</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(b => {
    const efficiency = b.inputWeight > 0 ? ((b.outputWeight || 0) / b.inputWeight * 100).toFixed(1) : 0;
    const tccsInfo = getTCCSSummary(b);
    return `
      <tr>
        <td><strong>${b.batchNo || ''}</strong></td>
        <td>${formatDate(b.date)}</td>
        <td>${b.product || ''}</td>
        <td>${b.sourceTankCode || '-'}</td>
        <td>${getStageText(b.processStage, b.product)}</td>
        <td style="font-size:12px;max-width:180px;white-space:normal">${tccsInfo}</td>
        <td>${formatNumber(b.inputWeight)}</td>
        <td>${formatNumber(b.outputWeight)}</td>
        <td>${efficiency}%</td>
        <td>
          <span class="status-badge ${b.status || 'processing'}">${b.status === 'completed' ? 'Hoàn thành' : 'Đang xử lý'}</span>
        </td>
        <td>
          <div class="action-btns">
            <button class="action-btn edit" onclick="editBatch('${b.id}')" title="Sửa">✏️</button>
            <button class="action-btn delete" onclick="deleteBatch('${b.id}')" title="Xóa">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function getTCCSSummary(b) {
  if (!b.techParams || Object.keys(b.techParams).length === 0) return '<span style="color:#000">—</span>';
  const shortLabels = {
    paramDRC:'DRC', paramPH:'pH', paramDRCSau:'DRC', paramPHTruocPL:'pH trước', paramPHSauPL:'pH sau',
    paramLoaiHCCatMach:'HC cắt mạch', paramKLHCCatMach:'KL HC',
    paramSoMuong:'Mương', paramNongDoAxit:'Axit',
    paramTGBatDauMuong:'BĐ mương', paramTGKetThucMuong:'KT mương', paramTGCanDuKien:'TG cán',
    paramNhietDoSay:'T°', paramSoThungSayDC:'Thùng DC', paramSoThungTrongLo:'Trong lò',
    paramNhietDoNguoi:'T°nguội', paramKhoiLuongBanh:'KL', paramPhanHang:'Hạng',
    paramDayCanKeo:'Dày', paramKheCan1:'C1', paramKheCan2:'C2', paramKheCan3:'C3',
    paramKichThuocHat:'Hạt', paramKLHoc:'KL/hộc', paramTGXepHoc:'TG xếp', paramTGDeRao:'Ráo(h)',
    paramSoLuongBanh:'SL', paramNhienLieu:'NL',
    paramHAS:'HAS', paramDBD:'DBD', paramMooneyBanDau:'Mooney₀', paramMooneyDong:'Mooney₁',
    paramMooneySay:'Mooney₂', paramMooneyTarget:'CV', paramPPMooney:'PP', paramHASDong:'HAS₂',
    paramPhanHangBD:'Hạng BĐ', paramGiongCay:'Giống', paramMauSacMu:'Màu NL', paramTGTiepNhan:'TG nhận',
    paramMauSacSay:'Màu sấy', paramKQSauSay:'KQ sấy',
    paramNH3:'NH3', paramTSC:'TSC', paramLoaiMu:'Loại', paramNgoaiQuan:'NQ',
    // TCCS 107 Latex params
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
  const parts = [];
  const product = b.product || '';
  const isSVRL = product === 'SVRL';
  const isCV = product.startsWith('SVRCV');
  const isSVR1020 = product === 'SVR10' || product === 'SVR20';
  const isLatex = product === 'LatexHA' || product === 'LatexLA';
  const specsTable = isLatex ? (product === 'LatexHA' ? TCCS_SPECS_107_HA : TCCS_SPECS_107_LA) :
    (isSVRL ? TCCS_SPECS_118 : (isCV ? TCCS_SPECS_103 : (isSVR1020 ? TCCS_SPECS_102 : TCCS_SPECS_101)));
  const specs = specsTable[b.processStage] || {};
  for (const [k,v] of Object.entries(b.techParams)) {
    const label = shortLabels[k] || k.replace('param','');
    const spec = specs[k];
    let warn = false;
    if (spec && typeof v === 'number') {
      warn = (spec.min !== undefined && v < spec.min) || (spec.max !== undefined && v > spec.max);
    }
    parts.push(warn ? `<span style="color:var(--danger)">${label}:${v}</span>` : `${label}:${v}`);
  }
  return parts.join(', ');
}

function getStageText(stage, product) {
  if (product === 'LatexHA' || product === 'LatexLA') return LATEX_STAGE_LABELS[stage] || stage;
  if (product === 'SVR10' || product === 'SVR20') return SVR1020_STAGE_LABELS[stage] || stage;
  const map = {
    'tiepnhan': 'Tiếp nhận',
    'xulymu': 'Xử lý mủ',
    'taodong': 'Tạo đông',
    'canmu': 'Cán kéo/mủ',
    'taohat': 'Tạo hạt',
    'say': 'Sấy',
    'epbanh': 'Ép bành',
    'baogoi': 'Bao gói/Kho',
    // backward compat for old data
    'locdanh': 'Lọc/Đánh',
    'canlan': 'Cán/Lăn',
    'ep': 'Ép bành'
  };
  return map[stage] || stage;
}

// === TCCS Stage Params Functions ===
function toggleStageParams() {
  const stage = document.getElementById('batchStage').value;
  document.querySelectorAll('.stage-params-group').forEach(g => g.classList.remove('active'));
  const group = document.getElementById('params_' + stage);
  if (group) group.classList.add('active');
  renderShiftSelector(stage);
  if (stage === 'say') { initOvenSelect(); clearOvenSection(); }
}

function validateTCCSField(input) {
  const stage = document.getElementById('batchStage').value;
  const specs = getTCCSSpecs()[stage];
  if (!specs) return;
  const fieldId = input.id;
  const spec = specs[fieldId];
  if (!spec) { input.classList.remove('param-warning','param-ok'); return; }
  var val = parseFloat(input.value);
  if (isNaN(val) || input.value === '') { input.classList.remove('param-warning','param-ok'); return; }
  // Spec đơn vị kg/tấn: quy đổi giá trị thực (kg) về kg/tấn khô trước khi so sánh
  if (spec.unit === 'kg/t') {
    var W = parseFloat(document.getElementById('paramKLHoThucTe')?.value) || 0;
    if (W <= 0) W = parseFloat(document.getElementById('batchInputWeight')?.value) || 0;
    var drc = parseFloat(document.getElementById('paramDRCSau')?.value) || 0;
    if (drc <= 0) drc = parseFloat(document.getElementById('paramDRCTruoc')?.value) || 0;
    if (W > 0 && drc > 0) {
      var quyKhoTan = W * drc / 100 / 1000;
      if (quyKhoTan > 0) val = val / quyKhoTan;
    }
  }
  const outOfSpec = (spec.min !== undefined && val < spec.min) || (spec.max !== undefined && val > spec.max);
  input.classList.toggle('param-warning', outOfSpec);
  input.classList.toggle('param-ok', !outOfSpec);
}

function updateDryTempHint() {
  const fuel = document.getElementById('paramNhienLieu').value;
  const hint = document.getElementById('dryTempHint');
  const cv = isProductCV();
  const svrl = isProductSVRL();
  const svr1020 = isProductSVR10_20();
  if (svr1020) {
    hint.textContent = 'TCCS 102: ≤ 120°C (tất cả nhiên liệu)';
  } else if (svrl) {
    if (fuel === 'DO') hint.textContent = 'TCCS 118: ≤ 115°C (DO) - SVR L yêu cầu nhiệt độ thấp hơn';
    else if (fuel === 'biomass') hint.textContent = 'TCCS 118: ≤ 120°C (Biomass) - SVR L yêu cầu nhiệt độ thấp hơn';
    else hint.textContent = 'SVR L - DO: ≤ 115°C | Biomass: ≤ 120°C';
  } else if (cv) {
    if (fuel === 'DO') hint.textContent = 'TCCS 103: ≤ 125°C (DO) / ≤ 130°C (PP Mooney)';
    else if (fuel === 'biomass') hint.textContent = 'TCCS 103: ≤ 130°C (Biomass) / ≤ 135°C (PP Mooney)';
    else hint.textContent = 'CV - DO: ≤ 125-130°C | Biomass: ≤ 130-135°C';
  } else {
    if (fuel === 'DO') hint.textContent = 'TCCS 101: ≤ 120°C (DO)';
    else if (fuel === 'biomass') hint.textContent = 'TCCS 101: ≤ 125°C (Biomass)';
    else hint.textContent = 'DO: ≤ 120°C | Biomass: ≤ 125°C';
  }
}

// Khi thay đổi sản phẩm: hiện/ẩn trường CV, cập nhật hints
function onProductChange() {
  const cv = isProductCV();
  const svrl = isProductSVRL();
  const svr1020 = isProductSVR10_20();
  const latex = isProductLatex();
  const product = document.getElementById('batchProduct').value;
  // Cập nhật TCCS badge
  const tccsBadge = document.getElementById('batchTCCSBadge');
  if (tccsBadge) {
    if (latex) tccsBadge.textContent = 'TCCS 107:2020';
    else if (svr1020) tccsBadge.textContent = 'TCCS 102:2015';
    else if (svrl) tccsBadge.textContent = 'TCCS 118:2023';
    else if (cv) tccsBadge.textContent = 'TCCS 103:2025';
    else tccsBadge.textContent = 'TCCS 101:2025';
  }
  // Hiện/ẩn các trường CV
  ['cvFields_xulymu','cvFields_taodong','cvFields_canmu','cvFields_say'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = cv ? 'block' : 'none';
  });
  // Hiện/ẩn các trường SVR L
  ['svrlFields_tiepnhan','svrlFields_say'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = svrl ? 'block' : 'none';
  });
  // Hiện/ẩn các trường SVR 10/20
  ['svr1020Fields_tiepnhan','svr1020Fields_canmu','svr1020_taodong_notice'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = svr1020 ? 'block' : 'none';
  });
  // Hiện/ẩn các trường Latex (TCCS 107)
  ['latexFields_tiepnhan','latexFields_xulymu','latexFields_taodong','latexFields_canmu',
   'latexFields_taohat','latexFields_say','latexFields_epbanh','latexFields_baogoi'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = latex ? 'block' : 'none';
  });
  // LA-TZ preservatives (TMTD + ZnO) chỉ hiện khi chọn LA
  const laPreserv = document.getElementById('latexLA_preservatives');
  if (laPreserv) laPreserv.style.display = (product === 'LatexLA') ? 'block' : 'none';
  // Cập nhật hints cho NH₃ và amoni laurat theo HA/LA
  if (latex) {
    const nh3HCHint = document.getElementById('hintNH3_HC');
    const alHint = document.getElementById('hintAmoniLaurat');
    const nh3BSHint = document.getElementById('hintNH3BoSung');
    if (product === 'LatexHA') {
      if (nh3HCHint) nh3HCHint.textContent = 'HA: 0.65 - 0.70% (Đ10.2.1). Tốc độ nạp 0.5-1 kg/phút';
      if (alHint) alHint.textContent = 'HA: max 0.02% trên KL latex (Đ10.3.1). Không dùng TMTD';
      if (nh3BSHint) nh3BSHint.textContent = 'HA: 0.40 - 0.50% trên KL latex (Đ8.4)';
    } else {
      if (nh3HCHint) nh3HCHint.textContent = 'LA: max 0.29% (Đ10.2.2). Tốc độ nạp 0.5-1 kg/phút';
      if (alHint) alHint.textContent = 'LA: max 0.05% trên KL latex (Đ10.3.1)';
      if (nh3BSHint) nh3BSHint.textContent = 'LA: 0.30 - 0.40% trên KL latex (Đ8.4)';
    }
  }
  // Cập nhật stage labels
  const stageSelect = document.getElementById('batchStage');
  if (stageSelect) {
    const opts = stageSelect.options;
    if (latex) {
      opts[0].text = '1 - Pha loãng & HC';    opts[1].text = '2 - Lắng';
      opts[2].text = '3 - Ly tâm';            opts[3].text = '4 - Hoàn chỉnh';
      opts[4].text = '5 - Bồn trung chuyển';  opts[5].text = '6 - Tồn trữ';
      opts[6].text = '7 - Xuất hàng';
    } else if (svr1020) {
      opts[0].text = '1 - Trộn đều';          opts[1].text = '2 - Không áp dụng';
      opts[2].text = '3 - Gia công CH 1';     opts[3].text = '4 - Gia công CH 2';
      opts[4].text = '5 - Sấy';               opts[5].text = '6 - Cân & Ép bành';
      opts[6].text = '7 - Bao gói & KL';
    } else {
      opts[0].text = '1 - Xử lý mủ';         opts[1].text = '2 - Tạo đông';
      opts[2].text = '3 - Cán kéo/mủ';        opts[3].text = '4 - Tạo hạt';
      opts[4].text = '5 - Sấy';               opts[5].text = '6 - Ép bành';
      opts[6].text = '7 - Bao gói/Kho';
    }
  }
  // Cập nhật paramLoaiMu theo loại sản phẩm
  const loaiMu = document.getElementById('paramLoaiMu');
  if (loaiMu) {
    if (latex) {
      loaiMu.innerHTML = '<option value="">-- Chọn --</option><option value="loai1">Loại 1 (DRC≥23%, VFA≤0.04, pH≥9)</option><option value="loai2">Loại 2 (DRC≥20%, VFA≤0.05, pH≥9)</option><option value="loai3">Loại 3 (Xử lý theo hướng dẫn)</option>';
    } else if (svr1020) {
      loaiMu.innerHTML = '<option value="">-- Chọn --</option><option value="dong_chen">Loại 1: Mủ đông + Mủ chén (→ SVR 10)</option><option value="day">Loại 2: Mủ dây (→ SVR 20)</option><option value="dam_dat">Loại 3: Mủ dăm + Mủ đất (→ Ngoại lệ)</option>';
    } else {
      loaiMu.innerHTML = '<option value="">-- Chọn --</option><option value="latex">Mủ nước (Field Latex)</option><option value="coagulum">Mủ đông</option>';
    }
  }
  // Cập nhật Mooney target theo sản phẩm
  const targetEl = document.getElementById('paramMooneyTarget');
  if (targetEl) {
    if (product === 'SVRCV40') targetEl.value = 40;
    else if (product === 'SVRCV50') targetEl.value = 50;
    else if (product === 'SVRCV60') targetEl.value = 60;
    else targetEl.value = '';
  }
  // Cập nhật hint nhiệt độ sấy
  updateDryTempHint();
  // Cập nhật bảng pH mương động khi đổi sản phẩm
  generateMuongRows();
  // Cập nhật hint nồng độ axit
  const axitHint = document.getElementById('paramNongDoAxit')?.parentElement?.querySelector('.param-hint');
  if (axitHint) {
    if (svrl) axitHint.textContent = 'TCCS 118: Acetic ≤ 3% | Formic ≤ 2%';
    else if (cv) axitHint.textContent = 'TCCS 103: Acetic ≤ 2% | Formic ≤ 1%';
    else axitHint.textContent = 'TCCS 101: Acetic ≤ 3% | Formic ≤ 2%';
  }
  // Validate lại nồng độ axit khi đổi sản phẩm
  validateAcidConcentration();
  // (DRC đánh đông đã loại bỏ - dùng DRC sau pha loãng từ bước 2)
  // Cập nhật hint NH3 cho tiếp nhận
  const nh3Hint = document.getElementById('paramNH3')?.parentElement?.querySelector('.param-hint');
  if (nh3Hint) {
    if (latex) nh3Hint.textContent = 'TCCS 107: Loại 1 ≥0.3% | Loại 2 ≥0.2% (Đ5, Bảng 1)';
    else if (svrl) nh3Hint.textContent = 'TCCS 118: ≤ 0.03% (rất nghiêm ngặt)';
    else nh3Hint.textContent = 'Hàm lượng NH3 trong mủ nước';
  }
  // Cập nhật hint khối lượng bành cho SVR 10/20
  const klBanhHint = document.getElementById('paramKhoiLuongBanh')?.parentElement?.querySelector('.param-hint');
  if (klBanhHint) {
    if (svr1020) klBanhHint.textContent = 'TCCS 102: 33.33 kg hoặc 35 kg (±0.5%)';
    else klBanhHint.textContent = 'Khối lượng mỗi bành cao su';
  }
  // Cập nhật phân hạng options
  const phanHang = document.getElementById('paramPhanHang');
  if (phanHang) {
    const curVal = phanHang.value;
    if (latex) {
      phanHang.innerHTML = '<option value="">-- Chọn --</option><option value="LatexHA">Latex HA</option><option value="LatexLA">Latex LA-TZ</option><option value="LatexLA_other">Latex LA (khác)</option>';
    } else if (svr1020) {
      phanHang.innerHTML = '<option value="">-- Chọn --</option><option value="SVR10">SVR 10</option><option value="SVR20">SVR 20</option><option value="khac">Khác (ngoại lệ)</option>';
    } else if (svrl) {
      phanHang.innerHTML = '<option value="">-- Chọn --</option><option value="SVRL">SVR L</option><option value="SVR3L">SVR 3L (hạ hạng)</option><option value="SVR5">SVR 5 (hạ hạng)</option><option value="khac">Khác</option>';
    } else if (cv) {
      phanHang.innerHTML = '<option value="">-- Chọn --</option><option value="SVRCV40">SVR CV40</option><option value="SVRCV50">SVR CV50</option><option value="SVRCV60">SVR CV60</option><option value="khac">Khác</option>';
    } else {
      phanHang.innerHTML = '<option value="">-- Chọn --</option><option value="SVR3L">SVR 3L</option><option value="SVR5">SVR 5</option><option value="SVR10">SVR 10</option><option value="SVR20">SVR 20</option><option value="khac">Khác</option>';
    }
    phanHang.value = curVal;
  }
  // Re-toggle stage params để ẩn/hiện đúng fields
  toggleStageParams();
  // Reload source tank dropdown theo sản phẩm
  populateBatchSourceTank('');
}

function collectStageParams() {
  const stage = document.getElementById('batchStage').value;
  const latex = isProductLatex();
  const svr1020 = isProductSVR10_20();
  const fields = (latex ? STAGE_FIELDS_107[stage] : (svr1020 ? STAGE_FIELDS_102[stage] : STAGE_FIELDS[stage])) || [];
  const params = {};
  fields.forEach(fid => {
    const el = document.getElementById(fid);
    if (!el) return;
    const val = el.value.trim();
    if (val !== '') {
      params[fid] = el.type === 'number' ? (parseFloat(val) || 0) : val;
    }
  });
  // Thu thập dữ liệu pH mương động cho bước Tạo Đông
  if (stage === 'taodong') {
    const channels = collectMuongData();
    if (channels.length > 0) params.channels = channels;
  }
  // Thu thập TG cán thực tế theo mương cho bước Cán Mủ
  if (stage === 'canmu') {
    const canmuChannels = collectCanmuMuongData();
    if (canmuChannels) params.canmuChannels = canmuChannels;
  }
  // Thu thập trolley mapping cho bước Tạo Hạt
  if (stage === 'taohat') {
    const trolleys = collectTrolleyData();
    if (trolleys) {
      // Validate no duplicate trolley numbers
      var trolleyNos = trolleys.map(function(t) { return t.trolleyNo; }).filter(Boolean);
      var dupTrolley = trolleyNos.find(function(n, i) { return trolleyNos.indexOf(n) !== i; });
      if (dupTrolley) {
        showToast('Th\u00F9ng s\u1EA5y #' + dupTrolley + ' b\u1ECB tr\u00F9ng. M\u1ED7i th\u00F9ng ch\u1EC9 \u0111\u01B0\u1EE3c d\u00F9ng 1 l\u1EA7n.', 'error');
        return null;
      }
      params.trolleys = trolleys;
    }
  }
  return params;
}

function populateStageParams(techParams, stage) {
  // Reset all param fields first
  const allFields = [...new Set([...Object.values(STAGE_FIELDS).flat(), ...Object.values(STAGE_FIELDS_102).flat(), ...Object.values(STAGE_FIELDS_107).flat()])];
  allFields.forEach(fid => {
    const el = document.getElementById(fid);
    if (el) { el.value = ''; el.classList.remove('param-warning','param-ok'); }
  });
  // Restore defaults after reset
  var meshEl = document.getElementById('paramMeshLoc');
  if (meshEl) meshEl.value = '40';
  var dcEl = document.getElementById('paramSoThungSayDC');
  if (dcEl) dcEl.value = '28';
  var loEl = document.getElementById('paramSoThungTrongLo');
  if (loEl) loEl.value = '24';
  if (!techParams || !stage) return;
  const product = document.getElementById('batchProduct')?.value || '';
  const latex = product === 'LatexHA' || product === 'LatexLA';
  const svr1020 = product === 'SVR10' || product === 'SVR20';
  const fields = (latex ? STAGE_FIELDS_107[stage] : (svr1020 ? STAGE_FIELDS_102[stage] : STAGE_FIELDS[stage])) || [];
  fields.forEach(fid => {
    const el = document.getElementById(fid);
    if (el && techParams[fid] !== undefined) {
      el.value = techParams[fid];
      if (el.type === 'number') validateTCCSField(el);
    }
  });
  // Load dữ liệu pH mương động cho bước Tạo Đông
  if (stage === 'taodong' && techParams.channels) {
    loadMuongData(techParams.channels);
  }
  // Load trolley data cho bước Tạo Hạt
  if (stage === 'taohat' && techParams.trolleys) {
    loadTrolleyData(techParams.trolleys);
  }
  // Update trolley waiting count hint cho bước Sấy
  if (stage === 'say' && typeof updateTrolleyWaitingCount === 'function') {
    updateTrolleyWaitingCount();
  }
}

function updateBatchStats() {
  applyBatchFilters();
}

// === Production Line Selector Functions ===
function initProductionLineSelector() {
  if (typeof TabMES !== 'undefined') { TabMES.initWorkspaceTabs(); return; }
  // Legacy fallback
  var container = document.getElementById('workspaceTabs') || document.getElementById('productionLineSelector');
  if (!container || !currentFactory) return;
  var lines = PRODUCTION_LINES[currentFactory] || [];
  if (lines.length === 0) { container.style.display = 'none'; return; }
  container.style.display = '';
  container.innerHTML = lines.map(function(line) {
    var tccsLabel = line.tccs ? '<span class="pill-tccs">(' + line.tccs + ')</span>' : '';
    return '<div class="production-line-pill ' + (line.id === currentProductionLine ? 'active' : '') +
      '" onclick="selectProductionLine(\'' + line.id + '\')">' + line.name + tccsLabel + '</div>';
  }).join('');
}

function selectProductionLine(lineId) {
  if (typeof TabMES !== 'undefined') { TabMES.selectProductionLine(lineId); return; }
  currentProductionLine = lineId;
  updateStageChipLabels();
  var mesDate = document.getElementById('mesDate')?.value;
  if (mesDate) loadMESTanks(mesDate);
  selectedMESTank = null;
  applyBatchFilters();
  renderStepDashboard(currentStage);
}

function updateStageChipLabels() {
  var product = (typeof currentProduct !== 'undefined') ? currentProduct : '';
  SanxuatStages.STAGE_ORDER.forEach(function(stage) {
    var chip = document.querySelector('.process-stage[onclick*="\'' + stage + '\'"]');
    if (!chip) return;
    var label;
    if (product) {
      label = SanxuatStages.getStageLabelByProduct(stage, product);
    } else {
      label = SanxuatStages.getStageLabel(stage, currentFactory, currentProductionLine);
    }
    var nameEl = chip.querySelector('.stage-name');
    if (nameEl && nameEl.textContent !== label) nameEl.textContent = label;
  });
}

function applyBatchFilters() {
  if (typeof TabMES !== 'undefined') { TabMES.applyBatchFilters(); return; }
  var lines = PRODUCTION_LINES[currentFactory] || [];
  var line = lines.find(function(l) { return l.id === currentProductionLine; });
  var filtered = batches;
  // Filter by production line
  if (currentProductionLine !== 'all' && line && line.products) {
    filtered = filtered.filter(function(b) { return line.products.indexOf(b.product) !== -1; });
  }
  // Filter by search keyword
  var keyword = (document.getElementById('batchSearch')?.value || '').toLowerCase();
  if (keyword) {
    filtered = filtered.filter(function(b) {
      return (b.batchNo || '').toLowerCase().indexOf(keyword) !== -1 ||
             (b.product || '').toLowerCase().indexOf(keyword) !== -1;
    });
  }
  // Filter by status
  var status = document.getElementById('batchStatusFilter')?.value || '';
  if (status) {
    filtered = filtered.filter(function(b) { return b.status === status; });
  }
  // Filter by active stage chip
  var activeStage = document.querySelector('.process-stage.active');
  if (activeStage) {
    var stageMatch = activeStage.getAttribute('onclick')?.match(/'(\w+)'/);
    if (stageMatch) {
      filtered = filtered.filter(function(b) { return b.processStage === stageMatch[1]; });
    }
  }
  // Filter by MES date
  var mesDate = document.getElementById('mesDate')?.value || '';
  if (mesDate) {
    filtered = filtered.filter(function(b) {
      var d = b.date?.toDate ? b.date.toDate() : new Date(b.date);
      return d.toISOString().slice(0, 10) === mesDate;
    });
  }
  // Filter by selected tank
  if (selectedMESTank) {
    filtered = filtered.filter(function(b) { return b.sourceTankNo === selectedMESTank; });
  }
  renderBatches(filtered);
  if (typeof updateFilteredBatchStats === 'function') updateFilteredBatchStats(filtered);
}

function updateFilteredBatchStats(filtered) {
  if (!filtered) filtered = batches;
  // Stats cards removed - dashboard handles display now
}

function renderStepDashboard(stage) {
  var container = document.getElementById('stepDashboard');
  if (!container) return;
  if (!stage) stage = currentStage;
  currentStage = stage;

  // Route to line record dashboard for steps 3-7 (canmu..baogoi)
  if (typeof SanxuatStages !== 'undefined' && SanxuatStages.isLineStage(stage)) {
    if (typeof renderLineRecordDashboard === 'function') {
      renderLineRecordDashboard(stage);
      return;
    }
  }

  var product = getActiveProduct();
  var specs = getSpecsForProduct(product);
  var stageSpecs = specs[stage] || {};
  var allFiltered = getFilteredBatchesForStep();
  var stageLabel = getStageLabel(stage);
  var stageIdx = STAGE_ORDER.indexOf(stage) + 1;
  var fields = getFieldsForStage(stage, product);

  // Only count batches at batch stages (xulymu, taodong) — exclude legacy batches stuck at line stages
  var batchStageOnly = allFiltered.filter(function(b) {
    return SanxuatStages.isBatchStage(b.processStage) || b.status === 'taodong_done';
  });

  // Get batches at this stage (flat filter, no parent/child)
  var stageBatches = allFiltered.filter(function(b) {
    return b.processStage === stage;
  });

  // Batches that have already advanced past this stage (for inspection)
  var advancedBatches = allFiltered.filter(function(b) {
    var bIdx = SanxuatStages.BATCH_STAGE_ORDER.indexOf(b.processStage);
    var sIdx = SanxuatStages.BATCH_STAGE_ORDER.indexOf(stage);
    return bIdx > sIdx;
  });

  var html = '';

  // Header
  var processingCount = batchStageOnly.filter(function(b) { return b.status === 'processing'; }).length;
  var doneCount = batchStageOnly.filter(function(b) { return b.status === 'taodong_done' || b.status === 'completed'; }).length;
  html += '<div class="step-dashboard-header">' +
    '<h3>B\u01B0\u1EDBc ' + stageIdx + ': ' + stageLabel + '</h3>' +
    (product ? '<span class="tccs-badge">' + getTCCSName(product) + '</span>' : '') +
    '<span class="batch-count">' + stageBatches.length + ' l\u00F4 t\u1EA1i b\u01B0\u1EDBc n\u00E0y</span>' +
    '<span class="batch-count" style="background:var(--accent);color:#fff;">' +
    processingCount + ' \u0111ang x\u1EED l\u00FD / ' + doneCount + ' ho\u00E0n t\u1EA5t / ' + batchStageOnly.length + ' t\u1ED5ng</span>' +
    '</div>';

  // If stage is "Không áp dụng" (e.g. taodong for SVR10/20), show notice
  if (stageLabel === 'Kh\u00F4ng \u00E1p d\u1EE5ng') {
    html += '<div style="text-align:center;padding:40px 20px;color:var(--text-muted);">' +
      '<div style="font-size:32px;margin-bottom:12px;">\u2014</div>' +
      '<div style="font-size:14px;">Giai \u0111o\u1EA1n n\u00E0y kh\u00F4ng \u00E1p d\u1EE5ng cho s\u1EA3n ph\u1EA9m hi\u1EC7n t\u1EA1i.</div>' +
      '<div style="font-size:12px;margin-top:4px;">Ch\u1ECDn b\u01B0\u1EDBc kh\u00E1c \u0111\u1EC3 ti\u1EBFp t\u1EE5c.</div></div>';
    container.innerHTML = html;
    var btnCreate = document.getElementById('btnCreateBatchFromStep');
    if (btnCreate) btnCreate.style.display = 'none';
    return;
  }

  // TCCS Requirements table
  html += renderTCCSRequirements(stage, stageSpecs, fields);

  // Tank cards for step 1 (Xử Lý Mủ)
  if (stage === 'xulymu' && mesTankData.length > 0) {
    var wsObj = typeof TabMES !== 'undefined' && TabMES.getCurrentWorkspace ? TabMES.getCurrentWorkspace() : null;
    var showTanks = !wsObj || wsObj !== 'muTap';
    if (showTanks) {
      html += renderStepTankCards();
    }
  }

  // Render batch cards (no DC grouping for batch stages 1-2)
  html += renderStepBatchCards(stageBatches, stage, stageSpecs, fields);

  // Show batches that have already advanced past this stage
  if (advancedBatches.length > 0) {
    html += '<div style="margin-top:16px;">';
    html += '<div class="advanced-section-header" onclick="var b=this.nextElementSibling;b.style.display=b.style.display===\'none\'?\'\':\'none\';this.querySelector(\'.toggle-arrow\').textContent=b.style.display===\'none\'?\'\u25B6\':\'\u25BC\'">';
    html += '<span class="toggle-arrow">\u25BC</span> \u0110\u00E3 chuy\u1EC3n b\u01B0\u1EDBc (' + advancedBatches.length + ' h\u1ED3)</div>';
    html += '<div class="advanced-section-body">';
    html += renderStepBatchCards(advancedBatches, stage, stageSpecs, fields);
    html += '</div></div>';
  }

  container.innerHTML = html;

  // Create button: show at batch stages (xulymu, taodong)
  var btnCreate = document.getElementById('btnCreateBatchFromStep');
  if (btnCreate) {
    var isBatchStage = SanxuatStages.isBatchStage(stage);
    if (isBatchStage && stage === 'xulymu') {
      btnCreate.style.display = '';
      var wsId = typeof currentWorkspace !== 'undefined' ? currentWorkspace : null;
      btnCreate.textContent = wsId === 'muTap' ? '+ T\u1EA1o L\u00F4' : '+ T\u1EA1o H\u1ED3 Ph\u1ED1i Li\u1EC7u';
      btnCreate.setAttribute('onclick', 'createBatchFromStep()');
    } else {
      btnCreate.style.display = 'none';
    }
  }
}

function filterDCSubtab(tabEl, dc) {
  // Toggle active subtab
  var parent = tabEl.parentElement;
  parent.querySelectorAll('.dc-subtab').forEach(function(t) { t.classList.remove('active'); });
  tabEl.classList.add('active');
  // Show/hide DC groups via .dc-active class (CSS: .dc-batch-group { display:none } .dc-batch-group.dc-active { display:block })
  var dashboard = document.getElementById('stepDashboard');
  if (!dashboard) return;
  dashboard.querySelectorAll('.dc-batch-group').forEach(function(g) {
    if (g.dataset.dcGroup === dc) {
      g.classList.add('dc-active');
    } else {
      g.classList.remove('dc-active');
    }
  });
}

function renderTCCSRequirements(stage, stageSpecs, fields) {
  // Chỉ hiện thông số có yêu cầu TCCS (bỏ dòng "—")
  const specRows = [];
  if (fields) {
    fields.forEach(fid => {
      const spec = stageSpecs[fid];
      if (spec) {
        specRows.push({ label: PARAM_LABELS[fid] || fid, specText: getSpecText(spec) });
      }
    });
  }
  // Thêm dòng axit + pH cho bước Tạo Đông
  if (stage === 'taodong') {
    if (stageSpecs._acidSpec) {
      const as = stageSpecs._acidSpec;
      let acidText = '';
      if (as.acetic) acidText += 'Acetic (CH\u2083COOH): \u2264 ' + as.acetic.max + '%';
      if (as.formic) acidText += (acidText ? '<br>' : '') + 'Formic (HCOOH): \u2264 ' + as.formic.max + '%';
      specRows.push({ label: 'N\u1ed3ng \u0111\u1ed9 axit pha', specText: acidText });
    }
    if (stageSpecs._phSpec) {
      specRows.push({ label: 'pH m\u01b0\u01a1ng (\u0111\u1ea7u / gi\u1eefa / cu\u1ed1i)', specText: getSpecText(stageSpecs._phSpec) });
    }
  }
  if (specRows.length === 0) return '';

  let html = '<details style="margin-bottom:8px;"><summary style="cursor:pointer;font-size:12px;font-weight:600;color:var(--text-secondary);padding:4px 0;user-select:none;">Thông số TCCS</summary>';
  html += '<table class="step-tccs-table" style="margin-top:4px;"><thead><tr><th>Thông số</th><th>Yêu cầu TCCS</th></tr></thead><tbody>';
  specRows.forEach(r => {
    html += `<tr><td>${r.label}</td><td class="spec-val">${r.specText}</td></tr>`;
  });
  html += '</tbody></table></details>';
  return html;
}

function renderStepTankCards() {
  const statusText = {empty:'Trống', filling:'Đang nạp', full:'Đầy', processing:'Đang xử lý', done:'Hoàn thành'};
  let html = '<div style="margin-bottom:15px;"><div style="font-size:13px;font-weight:600;color:var(--text-secondary);margin-bottom:8px;">Hồ phối liệu ngày chế biến:</div><div class="tank-grid" style="display:grid;">';
  for (let i = 1; i <= 4; i++) {
    const tankBatches = mesTankData.filter(b => b.tankNo === i);
    const active = tankBatches.find(b => ['filling','full','processing'].includes(b.status));
    const done = tankBatches.find(b => b.status === 'done');
    const batch = active || done;
    const cls = batch ? batch.status : 'empty';
    const weight = batch ? formatNumber(batch.totalWeight || 0) : '0';
    const drc = batch ? (batch.avgDRC || 0).toFixed(1) : '0';
    const dry = batch ? formatNumber(batch.totalDryWeight || 0) : '0';
    const st = batch ? (statusText[batch.status] || batch.status) : 'Trống';
    const code = batch ? batch.batchCode : '';
    const canCreate = batch && batch.status === 'full';
    html += `<div class="tank-card ${cls}">
      <div class="tank-icon">🛢️</div>
      <div class="tank-name">Hồ ${i}</div>
      <div class="tank-weight">${weight} <small>kg</small></div>
      ${batch ? `<div style="font-size:12px;color:var(--text-muted);margin-top:2px;">DRC ${drc}% · Q.Khô ${dry} kg</div>` : ''}
      ${code ? `<div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${code}</div>` : ''}
      <div class="tank-status">${st}</div>
      <div style="display:flex;gap:4px;margin-top:6px;justify-content:center;">
        ${batch ? `<button class="tank-action-btn btn-reopen" style="font-size:12px;padding:3px 8px;" onclick="openBlendingBatchModal('${batch.id}')">✏️ Sửa</button>` : ''}
        ${canCreate ? `<button class="tank-action-btn btn-start-process" style="font-size:12px;padding:3px 8px;" onclick="createBatchFromTank('${batch.id}')">Tạo lô từ hồ</button>` : ''}
      </div>
    </div>`;
  }
  html += '</div></div>';
  return html;
}

function renderBatchProgressTracker(currentBatchStage, batchStatus) {
  // Xác định bước hiện tại trong STAGE_ORDER 7 bước
  var stages = STAGE_ORDER; // ['xulymu','taodong','canmu','taohat','say','epbanh','baogoi']
  var shortLabels = {
    xulymu: 'XL M\u1EE7', taodong: 'T.\u0110\u00F4ng', canmu: 'C\u00E1n',
    taohat: 'T.H\u1EA1t', say: 'S\u1EA5y', epbanh: 'B\u00E1nh', baogoi: 'Bao G\u00F3i'
  };
  var currentIdx = stages.indexOf(currentBatchStage);
  // Nếu status là taodong_done thì coi như đã hoàn thành taodong, đang chờ canmu
  if (batchStatus === 'taodong_done') currentIdx = stages.indexOf('taodong');
  if (batchStatus === 'completed') currentIdx = stages.length; // all done

  var html = '<div class="batch-progress" style="margin-bottom:20px;">';
  for (var i = 0; i < stages.length; i++) {
    var cls = '';
    if (i < currentIdx) cls = 'done';
    else if (i === currentIdx) cls = 'current';
    html += '<div class="batch-progress-step ' + cls + '">';
    html += '<div class="batch-progress-dot">' + (i < currentIdx ? '\u2713' : (i + 1)) + '</div>';
    html += '<div class="batch-progress-label">' + (shortLabels[stages[i]] || stages[i]) + '</div>';
    if (i < stages.length - 1) {
      html += '<div class="batch-progress-line"></div>';
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function renderStepBatchCards(stageBatches, stage, stageSpecs, fields) {
  if (stageBatches.length === 0) {
    return '<div class="step-no-batch">Chưa có lô nào tại bước này</div>';
  }

  const stageIdx = STAGE_ORDER.indexOf(stage);
  let html = '';
  stageBatches.forEach(b => {
    const params = getBatchStageParams(b, stage);
    const hasParams = Object.keys(params).length > 0;

    // Shift info
    const stageDataObj = b.stageData?.[stage];
    let shiftHtml = '';
    if (stageDataObj?.shift) {
      shiftHtml = '<span class="shift-badge">' + stageDataObj.shift.name + '</span>';
    } else if (stageDataObj?.shiftIn || stageDataObj?.shiftOut) {
      shiftHtml = '<span class="shift-badge">' + (stageDataObj.shiftIn?.name || '—') + ' → ' + (stageDataObj.shiftOut?.name || '—') + '</span>';
    }

    html += '<div class="step-batch-card">' +
      '<div class="step-batch-card-header">' +
        '<div>' +
          '<span class="batch-info">' + (b.batchNo || '\u2014') + '</span>' +
          '<span class="batch-meta" style="margin-left:10px;">' + (b.product || '') + (b.sourceTankCode ? ' \u00B7 H\u1ED3 ' + b.sourceTankCode : '') + '</span>' +
          shiftHtml +
        '</div>' +
        '<div class="batch-meta">NL: ' + formatNumber(b.inputWeight) + ' kg ' + (b.outputWeight ? '\u2192 SL: ' + formatNumber(b.outputWeight) + ' kg' : '') + '</div>' +
      '</div>';

    // Progress tracker
    html += renderBatchProgressTracker(b.processStage, b.status);

    // Param grid
    if (fields && fields.length > 0) {
      html += '<div class="step-param-grid">';
      fields.forEach(fid => {
        const label = PARAM_LABELS[fid] || fid;
        const val = params[fid];
        // Nồng độ axit: lấy spec theo loại axit đã chọn
        let spec = stageSpecs[fid];
        let specText = spec ? getSpecText(spec) : '';
        if (fid === 'paramNongDoAxit' && stageSpecs._acidSpec && params.paramLoaiAxit) {
          spec = stageSpecs._acidSpec[params.paramLoaiAxit];
          specText = spec ? getSpecText(spec) : '';
        }
        let cls = 'empty';
        let displayVal = '—';
        if (val !== undefined && val !== null && val !== '') {
          displayVal = val;
          if (spec) {
            const numVal = parseFloat(val);
            if (!isNaN(numVal)) {
              const inRange = (spec.min === undefined || numVal >= spec.min) && (spec.max === undefined || numVal <= spec.max);
              cls = inRange ? 'ok' : 'warn';
            } else {
              cls = 'ok';
            }
          } else {
            cls = 'ok';
          }
        }
        html += `<div class="step-param-item ${cls}">
          <span class="param-label">${label}</span>
          <span><span class="param-value">${displayVal}</span><span class="param-spec">${specText}</span></span>
        </div>`;
      });
      html += '</div>';
    }

    // Hiển thị bảng pH mương cho bước Tạo Đông
    if (stage === 'taodong' && params.channels && params.channels.length > 0) {
      const phSpec = stageSpecs._phSpec || {min:5.2, max:5.6};
      html += '<table class="muong-ph-table" style="margin:8px 0;">';
      html += '<thead><tr><th>Mương</th><th>pH đầu</th><th>pH giữa</th><th>pH cuối</th></tr></thead><tbody>';
      params.channels.forEach(ch => {
        const checkPH = (v) => {
          if (v == null) return '<span style="color:var(--text-muted)">—</span>';
          const ok = (phSpec.min === undefined || v >= phSpec.min) && (phSpec.max === undefined || v <= phSpec.max);
          return ok ? '<span style="color:var(--success)">' + v + '</span>' : '<span style="color:var(--danger)">' + v + '</span>';
        };
        html += '<tr><td>Mương ' + ch.muong + '</td><td>' + checkPH(ch.phDau) + '</td><td>' + checkPH(ch.phGiua) + '</td><td>' + checkPH(ch.phCuoi) + '</td></tr>';
      });
      html += '</tbody></table>';
    }

    // Hiển thị TG cán thực tế theo mương cho bước Cán Mủ (legacy batches)
    if (stage === 'canmu') {
      var _canmuCh = (function() { var tp = getBatchStageParams(b, 'taodong'); return tp.channels || []; })();

      if (params.canmuChannels && params.canmuChannels.length > 0) {
        html += '<table class="muong-ph-table" style="margin:8px 0;">';
        html += '<thead><tr><th>M\u01B0\u01A1ng</th><th>TG b\u1EAFt \u0111\u1EA7u c\u00E1n</th><th>TG k\u1EBFt th\u00FAc c\u00E1n</th></tr></thead><tbody>';
        params.canmuChannels.forEach(function(cc) {
          var ch = _canmuCh[cc.idx];
          var muongName = ch ? 'M\u01B0\u01A1ng ' + ch.muong : 'M\u01B0\u01A1ng ' + (cc.idx + 1);
          var bd = cc.tgBatDau || '<span style="color:var(--text-muted)">\u2014</span>';
          var kt = cc.tgKetThuc || '<span style="color:var(--text-muted)">\u2014</span>';
          html += '<tr><td>' + muongName + '</td><td>' + bd + '</td><td>' + kt + '</td></tr>';
        });
        html += '</tbody></table>';
      } else if (_canmuCh.length > 0) {
        // No canmu data yet — show reminder
        html += '<div style="margin:6px 0;padding:6px 10px;border-radius:6px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);font-size:12px;color:#f59e0b;">';
        html += 'Ch\u01B0a nh\u1EADp TG c\u00E1n th\u1EF1c t\u1EBF \u2014 b\u1EA5m "Nh\u1EADp th\u00F4ng s\u1ED1" \u0111\u1EC3 khai b\u00E1o</div>';
      }
    }

    // Hiển thị trolley mapping cho bước Tạo Hạt
    if (stage === 'taohat' && params.trolleys && params.trolleys.length > 0) {
      // Hỗ trợ cả format cũ (nested) và mới (flat)
      let flatRows = [];
      if (params.trolleys[0]?.boxMappings) {
        params.trolleys.forEach(function(t) { (t.boxMappings||[]).forEach(function(m) { flatRows.push({trolleyNo:t.trolleyNo, fromBox:m.fromBox, toBox:m.toBox, muongNo:m.muongNo}); }); });
      } else {
        flatRows = params.trolleys;
      }
      if (flatRows.length > 0) {
        html += '<table class="muong-ph-table" style="margin:8px 0;"><thead><tr><th>Thùng sấy</th><th>Từ hộc</th><th>Đến hộc</th><th>Mương</th></tr></thead><tbody>';
        flatRows.forEach(function(r) {
          var boxText = (r.fromBox && r.toBox) ? (r.fromBox + ' → ' + r.toBox) : (!r.fromBox && !r.toBox ? 'Tất cả hộc' : (r.fromBox || r.toBox || '—'));
          html += '<tr><td style="font-weight:600;">#' + (r.trolleyNo || '—') + '</td><td colspan="2">' + boxText + '</td><td>' + (r.muongNo ? 'Mương ' + r.muongNo : '—') + '</td></tr>';
        });
        html += '</tbody></table>';
      }
    }

    // Hiển thị thông tin lò sấy cho bước Sấy
    if (stage === 'say') {
      const sd = b.stageData?.say;
      if (sd?.ovenId || sd?.trolleyDrying || sd?.tempLog) {
        html += '<div class="oven-info-card">';
        if (sd.ovenId) {
          const ovens = OVEN_CONFIG[currentFactory] || [];
          const oven = ovens.find(function(o) { return o.id === sd.ovenId; });
          html += '<div class="oven-title">🔥 ' + (oven ? oven.name + ' — ' + oven.line : sd.ovenId) + '</div>';
        }
        if (sd.trolleyDrying && sd.trolleyDrying.length > 0) {
          html += '<div class="oven-detail">' + sd.trolleyDrying.length + ' thùng: ';
          sd.trolleyDrying.forEach(function(td, i) {
            if (i > 0) html += ', ';
            html += '#' + td.trolleyNo;
            if (td.timeIn || td.timeOut) html += '(' + (td.timeIn || '?') + '–' + (td.timeOut || '?') + ')';
          });
          html += '</div>';
          // Heat exposure summary
          var hs = getOvenHeatSummaryFromData(sd);
          if (hs.warmupCount > 0 || hs.shutdownCount > 0) {
            html += '<div class="oven-heat-summary">';
            if (hs.warmupCount > 0) html += '<span class="heat-badge warmup">K\u0110 ' + hs.warmupCount + ' th\u00F9ng</span>';
            if (hs.shutdownCount > 0) html += '<span class="heat-badge shutdown">TL ' + hs.shutdownCount + ' th\u00F9ng</span>';
            html += '</div>';
          }
          if (hs.minHeat !== null) {
            html += '<div class="oven-detail">TG ch\u1ECBu nhi\u1EC7t: ' + _ovenFormatDuration(hs.minHeat);
            if (hs.maxHeat !== null && hs.maxHeat !== hs.minHeat) html += ' \u2013 ' + _ovenFormatDuration(hs.maxHeat);
            html += '</div>';
          }
        }
        if (sd.tempLog && sd.tempLog.length > 0) {
          var b1V = [], b2V = [];
          sd.tempLog.forEach(function(tl) { if (tl.burner1 != null) b1V.push(tl.burner1); if (tl.burner2 != null) b2V.push(tl.burner2); });
          html += '<div class="oven-detail">' + sd.tempLog.length + ' \u0111o \u00B7 ';
          if (b1V.length > 0) html += '\u0110\u01101: ' + Math.min.apply(null, b1V) + '\u2013' + Math.max.apply(null, b1V) + '\u00B0C';
          if (b1V.length > 0 && b2V.length > 0) html += ' \u00B7 ';
          if (b2V.length > 0) html += '\u0110\u01102: ' + Math.min.apply(null, b2V) + '\u2013' + Math.max.apply(null, b2V) + '\u00B0C';
          html += '</div>';
        }
        html += '</div>';
      }
    }

    // Action bar — chỉ hiện nút thao tác khi batch đang ở đúng bước này
    var isAtThisStage = b.processStage === stage;
    html += '<div class="step-action-bar">';
    html += '<button class="btn" style="background:rgba(99,102,241,0.15);color:#818cf8;border:1px solid rgba(99,102,241,0.3);" onclick="openTraceabilityTimeline(\'' + b.id + '\')">Truy xu\u1EA5t</button>';

    if (isAtThisStage) {
      if (b.status !== 'taodong_done') {
        html += '<button class="btn btn-primary" onclick="editBatchAtStage(\'' + b.id + '\',\'' + stage + '\')">Nh\u1EADp th\u00F4ng s\u1ED1</button>';
      }

      // Advance / status buttons
      var isBatchStage = SanxuatStages.isBatchStage(stage);
      if (b.status === 'taodong_done') {
        html += '<span style="display:inline-flex;align-items:center;gap:4px;padding:6px 14px;background:rgba(234,179,8,0.15);color:#eab308;border:1px solid rgba(234,179,8,0.3);border-radius:8px;font-size:13px;font-weight:600;">\u23F3 Ch\u1EDD C\u00E1n M\u1EE7</span>';
      } else if (isBatchStage) {
        var nextBatchStage = SanxuatStages.BATCH_STAGE_ORDER[SanxuatStages.BATCH_STAGE_ORDER.indexOf(stage) + 1];
        if (nextBatchStage) {
          html += '<button class="btn btn-success" style="background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;" onclick="advanceBatch(\'' + b.id + '\')">\u2192 ' + getStageLabel(nextBatchStage) + '</button>';
        } else {
          html += '<button class="btn btn-success" style="background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;" onclick="advanceBatch(\'' + b.id + '\')">\u2713 Ho\u00E0n th\u00E0nh T\u1EA1o \u0110\u00F4ng</button>';
        }
      }

      // Revert button
      if (b.status === 'taodong_done') {
        html += '<button class="btn btn-secondary" onclick="revertTaodongDone(\'' + b.id + '\')">\u2190 Quay l\u1EA1i</button>';
      } else if (stageIdx > 0) {
        html += '<button class="btn btn-secondary" onclick="revertBatch(\'' + b.id + '\')">\u2190 Quay l\u1EA1i</button>';
      }

      html += '<button class="btn" style="background:rgba(239,68,68,0.15);color:#ef4444;border:1px solid rgba(239,68,68,0.3);margin-left:auto;" onclick="deleteBatch(\'' + b.id + '\')" title="Xóa lô">🗑️ Xóa</button>';
    } else {
      // Batch đã qua bước này — chỉ hiện trạng thái
      html += '<span style="display:inline-flex;align-items:center;gap:4px;padding:6px 14px;background:rgba(0,104,255,0.08);color:#0068FF;border:1px solid rgba(0,104,255,0.2);border-radius:8px;font-size:13px;font-weight:600;">\u0110ang \u1EDF: ' + getStageLabel(b.processStage) + '</span>';
    }

    html += '</div></div>';
  });
  return html;
}

// ==================== LINE RECORD DASHBOARD (Steps 3-7) ====================

function renderLineRecordDashboard(stage) {
  var container = document.getElementById('stepDashboard');
  if (!container) return;
  if (!stage) stage = currentStage;

  var product = getActiveProduct();
  var specs = getSpecsForProduct(product);
  var stageSpecs = specs[stage] || {};
  var stageLabel = getStageLabel(stage);
  var stageIdx = STAGE_ORDER.indexOf(stage) + 1;
  var fields = getFieldsForStage(stage, product);

  // Get line records for this stage (parallel pipeline: show at all relevant stages)
  var allRecords = window.lineRecords || [];
  var sIdx = LineRecordProcessor.getLineStageIndex(stage);
  var stageRecords = allRecords.filter(function(r) {
    if (r.status === 'completed') return r.stageData && r.stageData[stage];
    // Hiện nếu: currentStage >= stage này, HOẶC đã có stageData cho stage này
    var rIdx = LineRecordProcessor.getLineStageIndex(r.currentStage);
    var hasData = r.stageData && r.stageData[stage];
    return rIdx >= sIdx || hasData;
  });

  var html = '';

  // Header
  html += '<div class="step-dashboard-header">' +
    '<h3>B\u01B0\u1EDBc ' + stageIdx + ': ' + stageLabel + '</h3>' +
    (product ? '<span class="tccs-badge">' + getTCCSName(product) + '</span>' : '') +
    '<span class="batch-count">' + stageRecords.length + ' phi\u1EBFu t\u1EA1i b\u01B0\u1EDBc n\u00E0y</span>' +
    '</div>';

  // TCCS Requirements table
  html += renderTCCSRequirements(stage, stageSpecs, fields);

  // DC sub-tabs
  var factory = currentFactory;
  var dcLines = SanxuatStages.getDCLinesForFactory(factory);

  if (dcLines.length > 1) {
    html += '<div class="dc-subtabs">';
    dcLines.forEach(function(dc) {
      var dcRecords = stageRecords.filter(function(r) { return r.productionLine === dc.id; });
      html += '<div class="dc-subtab" data-dc="' + dc.id + '" onclick="filterDCSubtab(this, \'' + dc.id + '\')">' +
        dc.name + ' <span class="dc-subtab-count">' + dcRecords.length + '</span></div>';
    });
    html += '</div>';

    // Render per-DC groups
    dcLines.forEach(function(dc) {
      var dcRecords = stageRecords.filter(function(r) { return r.productionLine === dc.id; });
      html += '<div class="dc-batch-group" data-dc-group="' + dc.id + '">';
      html += '<div class="dc-group-header">' + dc.name + '</div>';
      html += renderLineRecordCards(dcRecords, stage, stageSpecs, fields, product);
      html += '</div>';
    });
  } else {
    // Single DC line — no tabs needed
    html += renderLineRecordCards(stageRecords, stage, stageSpecs, fields, product);
  }

  // (Parallel pipeline: không cần section "Đã chuyển bước" riêng)

  // Legacy batches still at line stages (from old parent/child system)
  var legacyBatches = (window.batches || []).filter(function(b) {
    return b.processStage === stage && !b.isParent;
  });
  if (legacyBatches.length > 0) {
    html += '<div style="margin-top:16px;padding:10px 14px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:8px;">';
    html += '<div style="font-size:12px;font-weight:600;color:#f59e0b;margin-bottom:8px;">Legacy: ' + legacyBatches.length + ' l\u00F4 c\u0169 t\u1EA1i b\u01B0\u1EDBc n\u00E0y</div>';
    html += renderStepBatchCards(legacyBatches, stage, stageSpecs, fields);
    html += '</div>';
  }

  container.innerHTML = html;

  // Activate first DC subtab
  var firstSubtab = container.querySelector('.dc-subtab');
  if (firstSubtab) {
    firstSubtab.classList.add('active');
    filterDCSubtab(firstSubtab, firstSubtab.dataset.dc);
  }

  // Create button: "T\u1EA1o Phi\u1EBFu Ghi Nh\u1EADn"
  var btnCreate = document.getElementById('btnCreateBatchFromStep');
  if (btnCreate) {
    var _saCreate = window._currentShiftAccess;
    var _canCreate = !_saCreate || _saCreate.allowed;
    btnCreate.style.display = '';
    btnCreate.textContent = '+ T\u1EA1o Phi\u1EBFu Ghi Nh\u1EADn';
    if (_canCreate) {
      btnCreate.setAttribute('onclick', 'createLineRecordFromStep()');
      btnCreate.disabled = false;
      btnCreate.style.opacity = '';
      btnCreate.style.cursor = '';
      btnCreate.title = '';
    } else {
      btnCreate.removeAttribute('onclick');
      btnCreate.disabled = true;
      btnCreate.style.opacity = '0.5';
      btnCreate.style.cursor = 'not-allowed';
      btnCreate.title = _saCreate.reason || 'B\u1EA1n kh\u00F4ng c\u00F3 quy\u1EC1n t\u1EA1o phi\u1EBFu';
    }
  }
}

function renderLineRecordCards(records, stage, stageSpecs, fields, product) {
  if (records.length === 0) {
    return '<div class="step-no-batch">Ch\u01B0a c\u00F3 phi\u1EBFu ghi nh\u1EADn n\u00E0o t\u1EA1i b\u01B0\u1EDBc n\u00E0y</div>';
  }

  var stageIdx = STAGE_ORDER.indexOf(stage);
  var html = '';
  records.forEach(function(rec) {
    var params = {};
    if (rec.stageData && rec.stageData[stage] && rec.stageData[stage].params) {
      params = rec.stageData[stage].params;
    }
    var hasParams = Object.keys(params).length > 0;

    // Shift badge
    var stageDataObj = rec.stageData ? rec.stageData[stage] : null;
    var shiftHtml = '';
    if (stageDataObj && stageDataObj.shift) {
      shiftHtml = '<span class="shift-badge">' + stageDataObj.shift.name + '</span>';
    }
    // Shift from record level
    if (!shiftHtml && rec.shift) {
      var shiftName = rec.shift;
      var sanxuatShifts = _getSXShiftsCached();
      var shiftObj = sanxuatShifts.find(function(s) { return s.code === rec.shift; });
      if (shiftObj) shiftName = shiftObj.name;
      shiftHtml = '<span class="shift-badge">' + shiftName + '</span>';
    }

    // DC badge
    var dcBadge = rec.productionLine ? '<span class="dc-badge">DC ' + rec.productionLine + '</span>' : '';

    html += '<div class="step-batch-card">' +
      '<div class="step-batch-card-header">' +
        '<div>' +
          '<span class="batch-info">' + (rec.recordCode || '\u2014') + '</span>' +
          dcBadge +
          shiftHtml +
        '</div>' +
        '<div class="batch-meta">' + (rec.status === 'completed' ? '<span style="color:var(--success)">Ho\u00E0n th\u00E0nh</span>' : 'B\u01B0\u1EDBc: ' + getStageLabel(rec.currentStage)) + '</div>' +
      '</div>';

    // Progress tracker bỏ — parallel pipeline không cần hiển thị tuần tự

    // Loại mủ + mương tạo đông từ hồ liên kết
    var _lbProducts = [];
    var _lbChannelMap = {}; // muongNo → {klTuoi, batchNo, product}
    if (rec.linkedBatches && rec.linkedBatches.length > 0) {
      rec.linkedBatches.forEach(function(lb) {
        var bRef = (window.batches || []).find(function(x) { return x.id === lb.batchId; });
        if (!bRef) return;
        if (bRef.product && _lbProducts.indexOf(bRef.product) === -1) _lbProducts.push(bRef.product);
        var chs = bRef.stageData?.taodong?.params?.channels || bRef.techParams?.channels || [];
        chs.forEach(function(ch) {
          if (lb.muongs.indexOf(ch.muong) !== -1) {
            _lbChannelMap[ch.muong] = { klTuoi: ch.klTuoi || 0, klKho: ch.klKho || 0, batch: lb.batchNo, product: bRef.product || '' };
          }
        });
      });
    }

    // Product badge
    if (_lbProducts.length > 0) {
      html += '<div style="margin:4px 0 2px;display:flex;gap:6px;align-items:center;">';
      _lbProducts.forEach(function(p) {
        html += '<span style="display:inline-block;padding:2px 10px;border-radius:4px;font-size:12px;font-weight:700;background:rgba(34,197,94,0.15);color:#22c55e;border:1px solid rgba(34,197,94,0.3);">' + p + '</span>';
      });
      html += '</div>';
    }

    // Mương numbers with linked batch info + KL mỗi mương
    if (rec.muongNumbers && rec.muongNumbers.length > 0) {
      html += '<div style="margin:6px 0;font-size:12px;display:flex;flex-wrap:wrap;gap:4px;align-items:center;">';
      html += '<span style="font-weight:600;color:var(--text-secondary);">' + rec.muongNumbers.length + ' m\u01B0\u01A1ng:</span> ';
      rec.muongNumbers.forEach(function(m) {
        var chInfo = _lbChannelMap[m];
        var klText = chInfo && chInfo.klTuoi > 0 ? ' ' + formatNumber(chInfo.klTuoi) + 'kg' : '';
        html += '<span class="muong-badge" title="' + (chInfo ? chInfo.batch + ' \u00B7 KL t\u01B0\u01A1i: ' + (chInfo.klTuoi || 0) + ' kg \u00B7 KL kh\u00F4: ' + (chInfo.klKho || 0) + ' kg' : '') + '">M' + m + '<span style="font-weight:400;font-size:12px;">' + klText + '</span></span>';
      });
      // Show linked batch refs
      if (rec.linkedBatches && rec.linkedBatches.length > 0) {
        html += '<span style="margin-left:8px;font-size:12px;color:var(--text-muted);">\u2192 ';
        rec.linkedBatches.forEach(function(lb, idx) {
          if (idx > 0) html += ', ';
          html += '<span class="linked-batch-ref" title="M\u01B0\u01A1ng: ' + lb.muongs.join(', ') + '">' + lb.batchNo + '</span>';
        });
        html += '</span>';
      }
      html += '</div>';
    }

    // Param grid
    if (fields && fields.length > 0) {
      html += '<div class="step-param-grid">';
      fields.forEach(function(fid) {
        var label = PARAM_LABELS[fid] || fid;
        var val = params[fid];
        var spec = stageSpecs[fid];
        var specText = spec ? getSpecText(spec) : '';
        var cls = 'empty';
        var displayVal = '\u2014';
        if (val !== undefined && val !== null && val !== '') {
          displayVal = val;
          if (spec) {
            var numVal = parseFloat(val);
            if (!isNaN(numVal)) {
              var inRange = (spec.min === undefined || numVal >= spec.min) && (spec.max === undefined || numVal <= spec.max);
              cls = inRange ? 'ok' : 'warn';
            } else {
              cls = 'ok';
            }
          } else {
            cls = 'ok';
          }
        }
        html += '<div class="step-param-item ' + cls + '">' +
          '<span class="param-label">' + label + '</span>' +
          '<span><span class="param-value">' + displayVal + '</span><span class="param-spec">' + specText + '</span></span>' +
        '</div>';
      });
      html += '</div>';
    }

    // Canmu mương timing table
    if (stage === 'canmu' && params.canmuChannels && params.canmuChannels.length > 0) {
      html += '<table class="muong-ph-table" style="margin:8px 0;">';
      html += '<thead><tr><th>M\u01B0\u01A1ng</th><th>TG b\u1EAFt \u0111\u1EA7u c\u00E1n</th><th>TG k\u1EBFt th\u00FAc c\u00E1n</th></tr></thead><tbody>';
      params.canmuChannels.forEach(function(cc) {
        var muongNo = cc.muong || (rec.muongNumbers && rec.muongNumbers[cc.idx] ? rec.muongNumbers[cc.idx] : (cc.idx + 1));
        var bd = cc.tgBatDau || '<span style="color:var(--text-muted)">\u2014</span>';
        var kt = cc.tgKetThuc || '<span style="color:var(--text-muted)">\u2014</span>';
        html += '<tr><td>M\u01B0\u01A1ng ' + muongNo + '</td><td>' + bd + '</td><td>' + kt + '</td></tr>';
      });
      html += '</tbody></table>';
    } else if (stage === 'canmu' && rec.muongNumbers && rec.muongNumbers.length > 0 && !hasParams) {
      html += '<div style="margin:6px 0;padding:6px 10px;border-radius:6px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);font-size:12px;color:#f59e0b;">';
      html += 'Ch\u01B0a nh\u1EADp TG c\u00E1n th\u1EF1c t\u1EBF \u2014 b\u1EA5m "Nh\u1EADp th\u00F4ng s\u1ED1" \u0111\u1EC3 khai b\u00E1o</div>';
    }

    // Trolley mapping for taohat — only show trolleys with muongs belonging to this record (scrollable)
    if (stage === 'taohat' && params.trolleys && params.trolleys.length > 0) {
      var flatRows = [];
      if (params.trolleys[0] && params.trolleys[0].boxMappings) {
        params.trolleys.forEach(function(t) { (t.boxMappings||[]).forEach(function(m) { flatRows.push({trolleyNo:t.trolleyNo, fromBox:m.fromBox, toBox:m.toBox, muongNo:m.muongNo}); }); });
      } else {
        flatRows = params.trolleys;
      }
      // Filter by record's own muongs (prevent showing muongs from other records)
      var recMuongs = rec.muongNumbers || [];
      if (recMuongs.length > 0) {
        flatRows = flatRows.filter(function(r) { return !r.muongNo || recMuongs.indexOf(r.muongNo) !== -1; });
      }
      if (flatRows.length > 0) {
        html += '<div style="max-height:340px;overflow-y:auto;">';
        html += '<table class="muong-ph-table" style="margin:8px 0;"><thead><tr><th>Th\u00F9ng s\u1EA5y</th><th>T\u1EEB h\u1ED9c</th><th>\u0110\u1EBFn h\u1ED9c</th><th>M\u01B0\u01A1ng</th></tr></thead><tbody>';
        flatRows.forEach(function(r) {
          var boxText = (r.fromBox && r.toBox) ? (r.fromBox + ' \u2192 ' + r.toBox) : (!r.fromBox && !r.toBox ? 'T\u1EA5t c\u1EA3 h\u1ED9c' : (r.fromBox || r.toBox || '\u2014'));
          html += '<tr><td style="font-weight:600;">#' + (r.trolleyNo || '\u2014') + '</td><td colspan="2">' + boxText + '</td><td>' + (r.muongNo ? 'M\u01B0\u01A1ng ' + r.muongNo : '\u2014') + '</td></tr>';
        });
        html += '</tbody></table></div>';
      }
    }

    // Oven info for say
    if (stage === 'say' && stageDataObj) {
      var sd = stageDataObj;
      if (sd.ovenId || sd.trolleyDrying || sd.tempLog) {
        html += '<div class="oven-info-card">';
        if (sd.ovenId) {
          var ovens = OVEN_CONFIG[currentFactory] || [];
          var oven = ovens.find(function(o) { return o.id === sd.ovenId; });
          html += '<div class="oven-title">\uD83D\uDD25 ' + (oven ? oven.name + ' \u2014 ' + oven.line : sd.ovenId) + '</div>';
        }
        if (sd.trolleyDrying && sd.trolleyDrying.length > 0) {
          html += '<div class="oven-detail">' + sd.trolleyDrying.length + ' th\u00F9ng: ';
          sd.trolleyDrying.forEach(function(td, i) {
            if (i > 0) html += ', ';
            html += '#' + td.trolleyNo;
            if (td.timeIn || td.timeOut) html += '(' + (td.timeIn || '?') + '\u2013' + (td.timeOut || '?') + ')';
          });
          html += '</div>';
          // Heat exposure summary
          var hs2 = getOvenHeatSummaryFromData(sd);
          if (hs2.warmupCount > 0 || hs2.shutdownCount > 0) {
            html += '<div class="oven-heat-summary">';
            if (hs2.warmupCount > 0) html += '<span class="heat-badge warmup">K\u0110 ' + hs2.warmupCount + ' th\u00F9ng</span>';
            if (hs2.shutdownCount > 0) html += '<span class="heat-badge shutdown">TL ' + hs2.shutdownCount + ' th\u00F9ng</span>';
            html += '</div>';
          }
          if (hs2.minHeat !== null) {
            html += '<div class="oven-detail">TG ch\u1ECBu nhi\u1EC7t: ' + _ovenFormatDuration(hs2.minHeat);
            if (hs2.maxHeat !== null && hs2.maxHeat !== hs2.minHeat) html += ' \u2013 ' + _ovenFormatDuration(hs2.maxHeat);
            html += '</div>';
          }
        }
        if (sd.tempLog && sd.tempLog.length > 0) {
          var b1V = [], b2V = [];
          sd.tempLog.forEach(function(tl) { if (tl.burner1 != null) b1V.push(tl.burner1); if (tl.burner2 != null) b2V.push(tl.burner2); });
          html += '<div class="oven-detail">' + sd.tempLog.length + ' \u0111o \u00B7 ';
          if (b1V.length > 0) html += '\u0110\u01101: ' + Math.min.apply(null, b1V) + '\u2013' + Math.max.apply(null, b1V) + '\u00B0C';
          if (b1V.length > 0 && b2V.length > 0) html += ' \u00B7 ';
          if (b2V.length > 0) html += '\u0110\u01102: ' + Math.min.apply(null, b2V) + '\u2013' + Math.max.apply(null, b2V) + '\u00B0C';
          html += '</div>';
        }
        html += '</div>';
      }
    }

    // Action bar — parallel pipeline: nút Nhập thông số ở mọi bước, không cần Chuyển bước
    var _hasStageData = rec.stageData && rec.stageData[stage] && Object.keys(rec.stageData[stage].params || {}).length > 0;
    html += '<div class="step-action-bar">';

    // Badge trạng thái dữ liệu tại bước này
    if (_hasStageData) {
      html += '<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:rgba(34,197,94,0.1);color:#22c55e;border:1px solid rgba(34,197,94,0.3);border-radius:6px;font-size:11px;font-weight:600;">\u2713 \u0110\u00E3 nh\u1EADp</span>';
    } else {
      html += '<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:rgba(245,158,11,0.1);color:#f59e0b;border:1px solid rgba(245,158,11,0.3);border-radius:6px;font-size:11px;font-weight:600;">Ch\u01B0a nh\u1EADp</span>';
    }

    html += '<button class="btn" style="background:rgba(99,102,241,0.15);color:#818cf8;border:1px solid rgba(99,102,241,0.3);" onclick="openLineRecordTrace(\'' + rec.id + '\')">Truy xu\u1EA5t</button>';

    // Biểu đồ nhiệt — chỉ hiện ở bước Sấy khi có dữ liệu
    if (stage === 'say' && rec.stageData && rec.stageData.say) {
      html += '<button class="btn" style="background:rgba(245,158,11,0.15);color:#f59e0b;border:1px solid rgba(245,158,11,0.3);" onclick="openOvenTempChartFromRecord(\'' + rec.id + '\')">Bi\u1EC3u \u0111\u1ED3 nhi\u1EC7t</button>';
    }

    // Shift access control
    var _canEditRec = true;
    var _sa = window._currentShiftAccess;
    if (_sa) {
      if (!_sa.allowed) {
        _canEditRec = false;
      } else if (_sa.reason === 'shift') {
        if (rec.shift && rec.shift !== _sa.shiftCode) _canEditRec = false;
        if (_sa.allowedDCLines && _sa.allowedDCLines.indexOf(rec.productionLine) === -1) _canEditRec = false;
      }
    }

    // Nút Nhập thông số — hiện ở mọi bước (không gate bởi currentStage)
    if (rec.status !== 'completed') {
      if (_canEditRec) {
        html += '<button class="btn btn-primary" onclick="editLineRecordAtStage(\'' + rec.id + '\',\'' + stage + '\')">Nh\u1EADp th\u00F4ng s\u1ED1</button>';
      } else {
        html += '<button class="btn btn-primary" disabled style="opacity:0.5;cursor:not-allowed;" title="B\u1EA1n kh\u00F4ng c\u00F3 quy\u1EC1n ch\u1EC9nh s\u1EEDa phi\u1EBFu n\u00E0y">Nh\u1EADp th\u00F4ng s\u1ED1</button>';
      }
    }

    // Hoàn thành phiếu — chỉ hiện ở bước baogoi
    if (stage === 'baogoi' && rec.status !== 'completed' && _canEditRec) {
      html += '<button class="btn" style="background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;" onclick="completeLineRecord(\'' + rec.id + '\')">\u2713 Ho\u00E0n th\u00E0nh phi\u1EBFu</button>';
    }

    // Xóa — chỉ hiện ở bước đầu tiên (canmu)
    if (stage === 'canmu' && rec.status !== 'completed' && _canEditRec) {
      html += '<button class="btn" style="background:rgba(239,68,68,0.15);color:#ef4444;border:1px solid rgba(239,68,68,0.3);margin-left:auto;" onclick="deleteLineRecord(\'' + rec.id + '\')" title="X\u00F3a phi\u1EBFu">\uD83D\uDDD1\uFE0F X\u00F3a</button>';
    }

    html += '</div></div>';
  });
  return html;
}

var _advancingBatch = false;
async function advanceBatch(batchId) {
  if (_advancingBatch) return;
  var batch = batches.find(function(b) { return b.id === batchId; });
  if (!batch) return;

  // Batch stages: xulymu → taodong. Taodong is the last batch stage.
  var batchStageIdx = SanxuatStages.BATCH_STAGE_ORDER.indexOf(batch.processStage);
  var isLastBatchStage = batchStageIdx >= SanxuatStages.BATCH_STAGE_ORDER.length - 1;

  if (isLastBatchStage) {
    if (!(await showConfirm('Ho\u00E0n th\u00E0nh T\u1EA1o \u0110\u00F4ng cho h\u1ED3 n\u00E0y?'))) return;
  } else {
    var nextStage = SanxuatStages.BATCH_STAGE_ORDER[batchStageIdx + 1];
    var nextLabel = getStageLabel(nextStage);
    if (nextLabel === 'Kh\u00F4ng \u00E1p d\u1EE5ng') {
      if (!(await showConfirm('Ho\u00E0n th\u00E0nh l\u00F4 n\u00E0y?'))) return;
    } else {
      if (!(await showConfirm('Chuy\u1EC3n sang b\u01B0\u1EDBc "' + nextLabel + '"?'))) return;
    }
  }

  // Show loading state on clicked button
  _advancingBatch = true;
  var btn = event && event.target ? event.target.closest('button') : null;
  var btnOriginal = '';
  if (btn) {
    btnOriginal = btn.innerHTML;
    btn.innerHTML = '\u23F3 \u0110ang x\u1EED l\u00FD...';
    btn.disabled = true;
    btn.style.opacity = '0.6';
  }

  try {
    if (isLastBatchStage) {
      await db.collection('productionBatches').doc(batchId).update({
        status: 'taodong_done',
        ['stageData.' + batch.processStage + '.completedAt']: ErpDb.firestore.FieldValue.serverTimestamp(),
        ['stageData.' + batch.processStage + '.completedBy']: currentUser?.id || null,
        ['stageData.' + batch.processStage + '.completedByName']: currentUser?.hoTen || currentUser?.name || '',
        updatedAt: ErpDb.firestore.FieldValue.serverTimestamp(),
        timeline: ErpDb.firestore.FieldValue.arrayUnion(TabMES._timelineEntry('batch_advanced', batch.processStage, { fromStage: batch.processStage, toStage: 'taodong_done' }))
      });
      showToast('H\u1ED3 \u0111\u00E3 ho\u00E0n th\u00E0nh T\u1EA1o \u0110\u00F4ng!', 'success');
    } else {
      var nStage = SanxuatStages.BATCH_STAGE_ORDER[batchStageIdx + 1];
      var nLabel = getStageLabel(nStage);
      if (nLabel === 'Kh\u00F4ng \u00E1p d\u1EE5ng') {
        await db.collection('productionBatches').doc(batchId).update({
          status: 'taodong_done',
          ['stageData.' + batch.processStage + '.completedAt']: ErpDb.firestore.FieldValue.serverTimestamp(),
          ['stageData.' + batch.processStage + '.completedBy']: currentUser?.id || null,
          ['stageData.' + batch.processStage + '.completedByName']: currentUser?.hoTen || currentUser?.name || '',
          updatedAt: ErpDb.firestore.FieldValue.serverTimestamp(),
          timeline: ErpDb.firestore.FieldValue.arrayUnion(TabMES._timelineEntry('batch_advanced', batch.processStage, { fromStage: batch.processStage, toStage: 'taodong_done' }))
        });
        showToast('L\u00F4 \u0111\u00E3 ho\u00E0n th\u00E0nh!', 'success');
      } else {
        await db.collection('productionBatches').doc(batchId).update({
          processStage: nStage,
          ['stageData.' + batch.processStage + '.completedAt']: ErpDb.firestore.FieldValue.serverTimestamp(),
          ['stageData.' + batch.processStage + '.completedBy']: currentUser?.id || null,
          ['stageData.' + batch.processStage + '.completedByName']: currentUser?.hoTen || currentUser?.name || '',
          updatedAt: ErpDb.firestore.FieldValue.serverTimestamp(),
          timeline: ErpDb.firestore.FieldValue.arrayUnion(TabMES._timelineEntry('batch_advanced', batch.processStage, { fromStage: batch.processStage, toStage: nStage }))
        });
        showToast('\u0110\u00E3 chuy\u1EC3n sang: ' + nLabel, 'success');
      }
    }
    await loadBatches();
    renderStepDashboard(currentStage);
  } catch (e) {
    showToast('L\u1ED7i: ' + e.message, 'error');
    if (btn) { btn.innerHTML = btnOriginal; btn.disabled = false; btn.style.opacity = ''; }
  } finally {
    _advancingBatch = false;
  }
}

async function revertTaodongDone(batchId) {
  // Check if any line records are linked to this batch's muongs
  var batch = batches.find(function(b) { return b.id === batchId; });
  if (batch) {
    var batchMuongs = [];
    var channels = batch.stageData && batch.stageData.taodong && batch.stageData.taodong.params && batch.stageData.taodong.params.channels || [];
    channels.forEach(function(ch) { if (ch.muong) batchMuongs.push(ch.muong); });

    if (batchMuongs.length > 0) {
      var batchDate = batch.date;
      if (batchDate && batchDate.toDate) batchDate = batchDate.toDate();
      if (batchDate instanceof Date) batchDate = batchDate.getFullYear() + '-' + String(batchDate.getMonth() + 1).padStart(2, '0') + '-' + String(batchDate.getDate()).padStart(2, '0');

      var linkedRecs = (window.lineRecords || []).filter(function(rec) {
        var recDate = rec.taodongDate || rec.date || '';
        if (recDate !== batchDate) return false;
        return (rec.muongNumbers || []).some(function(m) { return batchMuongs.indexOf(m) !== -1; });
      });

      if (linkedRecs.length > 0) {
        var dcNames = linkedRecs.map(function(r) { return r.productionLine || r.id; }).join(', ');
        showToast('Kh\u00F4ng th\u1EC3 quay l\u1EA1i \u2014 \u0111\u00E3 c\u00F3 phi\u1EBFu DC li\u00EAn k\u1EBFt: ' + dcNames, 'error');
        return;
      }
    }
  }

  if (!(await showConfirm('Quay l\u1EA1i tr\u1EA1ng th\u00E1i \u0111ang x\u1EED l\u00FD T\u1EA1o \u0110\u00F4ng?'))) return;
  try {
    await db.collection('productionBatches').doc(batchId).update({
      status: 'processing',
      updatedAt: ErpDb.firestore.FieldValue.serverTimestamp(),
      timeline: ErpDb.firestore.FieldValue.arrayUnion(TabMES._timelineEntry('batch_reverted', 'taodong', { fromStatus: 'taodong_done', toStatus: 'processing' }))
    });
    showToast('\u0110\u00E3 quay l\u1EA1i tr\u1EA1ng th\u00E1i \u0111ang x\u1EED l\u00FD');
    await loadBatches();
    renderStepDashboard(currentStage);
  } catch (e) {
    showToast('L\u1ED7i: ' + e.message, 'error');
  }
}

async function revertBatch(batchId) {
  var batch = batches.find(function(b) { return b.id === batchId; });
  if (!batch) return;
  var batchStageIdx = SanxuatStages.BATCH_STAGE_ORDER.indexOf(batch.processStage);
  if (batchStageIdx <= 0) return;

  var prevStage = SanxuatStages.BATCH_STAGE_ORDER[batchStageIdx - 1];
  var prevLabel = getStageLabel(prevStage);

  if (!(await showConfirm('Quay l\u1EA1i b\u01B0\u1EDBc "' + prevLabel + '"?'))) return;

  // If reverting from taodong, subtract coagulum accumulation
  if (batch.processStage === 'taodong') {
    var klBotDay = parseFloat(batch.stageData?.taodong?.params?.paramKLBotDayHo) || 0;
    if (klBotDay > 0 && window.TabMES && TabMES._updateCoagAccumulation) {
      await TabMES._updateCoagAccumulation(currentFactory, batch.lineGroup || '', -klBotDay, currentUser);
    }
  }

  var revertData = {
    processStage: prevStage,
    status: 'processing',
    updatedAt: ErpDb.firestore.FieldValue.serverTimestamp(),
    timeline: ErpDb.firestore.FieldValue.arrayUnion(TabMES._timelineEntry('batch_reverted', batch.processStage, { fromStage: batch.processStage, toStage: prevStage }))
  };
  // Xóa stageData của bước hiện tại để tránh dữ liệu cũ gây sai lệch khi làm lại
  revertData['stageData.' + batch.processStage] = ErpDb.firestore.FieldValue.delete();
  await db.collection('productionBatches').doc(batchId).update(revertData);
  showToast('\u0110\u00E3 quay l\u1EA1i: ' + prevLabel);
  await loadBatches();
  if (window.loadCoagAccumulation) loadCoagAccumulation();
  renderStepDashboard(currentStage);
}

// === TRACEABILITY TIMELINE ===
async function openTraceabilityTimeline(batchId) {
  const batch = batches.find(function(b) { return b.id === batchId; });
  if (!batch) { showToast('Không tìm thấy lô', 'error'); return; }

  const title = document.getElementById('traceModalTitle');
  title.textContent = 'Truy Xuất: ' + (batch.batchNo || batchId);
  const body = document.getElementById('traceModalBody');
  body.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">Đang tải dữ liệu truy xuất...</div>';
  document.getElementById('traceModal').classList.add('active');

  // Lookup source tank
  let tank = null;
  if (batch.sourceTankId) {
    tank = mesTankData.find(function(t) { return t.id === batch.sourceTankId; });
    if (!tank) {
      try {
        const doc = await db.collection('blendingBatches').doc(batch.sourceTankId).get();
        if (doc.exists) tank = Object.assign({ id: doc.id }, doc.data());
      } catch (e) { console.warn('Trace: tank lookup error', e); }
    }
  }

  // Lookup vehicles from tank sourceReceipts (stores harvestData doc IDs)
  let vehicles = [];
  if (tank && tank.sourceReceipts && tank.sourceReceipts.length > 0) {
    const receiptIds = tank.sourceReceipts;
    // Try from loaded factoryReceipts first (match by doc ID or receiptNo)
    vehicles = factoryReceipts.filter(function(r) { return receiptIds.includes(r.id) || receiptIds.includes(r.receiptNo); });
    // If not found in memory, query harvestData directly by doc IDs
    if (vehicles.length === 0 && tank.date) {
      try {
        const snap = await db.collection('harvestData').where('importDate', '==', tank.date).get();
        snap.forEach(function(vDoc) {
          if (receiptIds.includes(vDoc.id)) {
            var d = vDoc.data();
            vehicles.push({
              receiptNo: vDoc.id,
              vehicleNo: d.soXe || d.vehicleNo || '-',
              plantation: d.donVi || '',
              muNuoc: d.muNuoc || 0,
              drcPercent: d.drc || 0,
              qkMuNuoc: d.qkMuNuoc || 0
            });
          }
        });
      } catch (e) { console.warn('Trace: vehicle lookup error', e); }
    }
  }

  // Build timeline HTML
  let html = '<div class="trace-timeline">';

  // === SOURCE: Vehicles & Farms ===
  if (vehicles.length > 0) {
    html += '<div class="trace-node">';
    html += '<div class="trace-dot source"></div>';
    html += '<div class="trace-node-header">Nguyên Liệu Đầu Vào <span class="trace-stage-num">' + vehicles.length + ' xe</span></div>';
    html += '<div class="trace-node-body">';
    vehicles.forEach(function(v) {
      html += '<div class="trace-vehicle-card">';
      html += '<div class="trace-vehicle-plate">' + v.vehicleNo + '</div>';
      html += '<div class="trace-vehicle-info">' + (v.plantation || 'Không rõ NT') + ' · ' + formatNumber(v.muNuoc) + ' kg · DRC ' + (v.drcPercent || 0) + '%</div>';
      html += '</div>';
    });
    html += '</div></div>';
  }

  // === SOURCE: Blending Tank ===
  if (tank) {
    html += '<div class="trace-node">';
    html += '<div class="trace-dot source"></div>';
    html += '<div class="trace-node-header">Hồ Phối Liệu <span class="trace-stage-num">' + (tank.batchCode || '') + '</span></div>';
    html += '<div class="trace-node-body">';
    html += '<span class="trace-param">Hồ #' + (tank.tankNo || '') + '</span>';
    html += '<span class="trace-param">' + formatNumber(tank.totalWeight || 0) + ' kg</span>';
    html += '<span class="trace-param">DRC TB: ' + (tank.avgDRC || 0) + '%</span>';
    html += '<span class="trace-param">Q.khô: ' + formatNumber(tank.totalDryWeight || 0) + ' kg</span>';
    html += '</div></div>';
  }

  // Determine if this is a new-style batch (ends at taodong) or legacy (all 7 stages)
  var isNewBatch = batch.status === 'taodong_done' || SanxuatStages.isBatchStage(batch.processStage);
  var isLegacy = !isNewBatch && SanxuatStages.isLineStage(batch.processStage);

  // For new batches: show stages 1-2, then linked line records
  // For legacy batches: show all 7 stages from batch data
  var batchStages = isLegacy ? STAGE_ORDER : SanxuatStages.BATCH_STAGE_ORDER;

  // === BATCH STAGES ===
  var currentIdx = batchStages.indexOf(batch.processStage);
  if (currentIdx < 0) currentIdx = batchStages.length; // taodong_done
  batchStages.forEach(function(stage, idx) {
    html += renderTraceStageNode(batch, stage, idx, currentIdx);
  });

  // === LINKED LINE RECORDS (for new-style batches) ===
  if (!isLegacy) {
    // Find line records that reference this batch — query Firestore directly
    var linkedRecords = [];
    // Get batch's muong numbers for fallback matching
    var batchMuongs = [];
    if (batch.stageData && batch.stageData.taodong && batch.stageData.taodong.params && batch.stageData.taodong.params.channels) {
      batchMuongs = batch.stageData.taodong.params.channels.map(function(ch) { return ch.muong; });
    } else if (batch.techParams && batch.techParams.channels) {
      batchMuongs = batch.techParams.channels.map(function(ch) { return ch.muong; });
    }
    var batchDate = batch.date;
    if (batchDate && batchDate.toDate) batchDate = batchDate.toDate().toISOString().slice(0, 10);

    try {
      var lrSnap = await db.collection('productionLineRecords')
        .where('factory', '==', batch.factory || currentFactory)
        .get();
      lrSnap.forEach(function(doc) {
        var d = doc.data();
        d.id = doc.id;
        // Check 1: direct linkedBatches reference
        var directLink = d.linkedBatches && d.linkedBatches.some(function(lb) { return lb.batchId === batchId; });
        // Check 2: fallback — muong overlap + matching taodong date
        var muongMatch = false;
        if (!directLink && batchMuongs.length > 0 && d.muongNumbers && d.muongNumbers.length > 0) {
          var tdDate = d.taodongDate || d.date || '';
          if (tdDate && tdDate === batchDate) {
            muongMatch = d.muongNumbers.some(function(m) { return batchMuongs.indexOf(m) !== -1; });
          }
        }
        if (directLink || muongMatch) {
          linkedRecords.push(d);
        }
      });
    } catch (e) {
      console.warn('Trace: line record lookup error', e);
      linkedRecords = (window.lineRecords || []).filter(function(r) {
        var dl = r.linkedBatches && r.linkedBatches.some(function(lb) { return lb.batchId === batchId; });
        var mm = false;
        if (!dl && batchMuongs.length > 0 && r.muongNumbers) {
          var td = r.taodongDate || r.date || '';
          if (td && td === batchDate) mm = r.muongNumbers.some(function(m) { return batchMuongs.indexOf(m) !== -1; });
        }
        return dl || mm;
      });
    }

    if (linkedRecords.length > 0) {
      html += '<div class="trace-node">';
      html += '<div class="trace-dot source" style="background:var(--warning);"></div>';
      html += '<div class="trace-node-header" style="color:var(--warning);font-weight:700;">Phi\u1EBFu Ghi Nh\u1EADn S\u1EA3n Xu\u1EA5t <span class="trace-stage-num">' + linkedRecords.length + ' phi\u1EBFu</span></div>';
      html += '<div class="trace-node-body">';
      linkedRecords.forEach(function(rec) {
        html += '<div style="margin-bottom:6px;padding:6px 8px;background:var(--bg-tertiary);border-radius:6px;">';
        html += '<strong>' + (rec.recordCode || '') + '</strong> \u00B7 DC ' + (rec.productionLine || '') + ' \u00B7 ' + (rec.shift || '');
        if (rec.muongNumbers) html += ' \u00B7 M\u01B0\u01A1ng: ' + rec.muongNumbers.join(', ');
        html += ' \u00B7 B\u01B0\u1EDBc: ' + getStageLabel(rec.currentStage);
        html += '</div>';

        // Check cross-DC drying for this record
        var _recCrossDC = [];
        (linkedRecords.concat(window.lineRecords || [])).forEach(function(other) {
          if (other.id === rec.id) return;
          var otd = other.stageData && other.stageData.say && other.stageData.say.trolleyDrying;
          if (!otd || !Array.isArray(otd)) return;
          otd.forEach(function(t) {
            if (t.transferred && t.fromRecordId === rec.id) {
              _recCrossDC.push({ trolleyNo: t.trolleyNo, dcLine: other.productionLine || '?' });
            }
          });
        });

        // Show line stages for this record
        SanxuatStages.LINE_STAGE_ORDER.forEach(function(ls, lsIdx) {
          var lsd = rec.stageData ? rec.stageData[ls] : null;
          var lsCurrentIdx = SanxuatStages.LINE_STAGE_ORDER.indexOf(rec.currentStage);
          var lsDotClass = lsIdx < lsCurrentIdx ? 'completed' : (lsIdx === lsCurrentIdx ? 'active' : 'pending');
          if (ls === 'say' && _recCrossDC.length > 0 && lsDotClass === 'pending' && !lsd) lsDotClass = 'completed';
          html += '<div style="margin-left:16px;display:flex;align-items:center;gap:6px;padding:2px 0;">';
          html += '<span class="trace-dot ' + lsDotClass + '" style="width:8px;height:8px;position:static;"></span>';
          html += '<span style="font-size:12px;">' + getStageLabel(ls) + '</span>';
          // Show actual production time instead of updatedAt
          if (lsd) {
            var _lsTime = lsd.stageTimeStart || '';
            if (!_lsTime && lsd.params && lsd.params.canmuChannels && lsd.params.canmuChannels.length > 0) {
              _lsTime = lsd.params.canmuChannels.reduce(function(min, cc) { return cc.tgBatDau && (!min || cc.tgBatDau < min) ? cc.tgBatDau : min; }, '');
            }
            if (_lsTime) html += ' <span style="font-size:12px;color:var(--text-muted);">' + _lsTime + '</span>';
          }
          // Cross-DC drying note
          if (ls === 'say' && _recCrossDC.length > 0) {
            html += ' <span style="font-size:12px;color:#818cf8;">(\u2197 ' + _recCrossDC[0].dcLine + ')</span>';
          }
          html += '</div>';
        });
      });
      html += '</div></div>';
    } else if (batch.status === 'taodong_done') {
      html += '<div class="trace-node">';
      html += '<div class="trace-dot pending"></div>';
      html += '<div class="trace-node-header" style="color:var(--text-muted);">Phi\u1EBFu DC <span style="font-size:12px;">(ch\u01B0a li\u00EAn k\u1EBFt)</span></div>';
      html += '<div class="trace-node-body" style="color:var(--text-muted);font-style:italic;">H\u1ED3 \u0111\u00E3 ho\u00E0n th\u00E0nh T\u1EA1o \u0110\u00F4ng, ch\u01B0a c\u00F3 phi\u1EBFu DC li\u00EAn k\u1EBFt.</div>';
      html += '</div>';
    }
  }

  // For legacy batches, show stages 3-7 from batch data
  if (isLegacy) {
    // Already rendered above in the full STAGE_ORDER loop
  }

  html += '</div>';

  // Summary footer
  html += '<div style="margin-top:16px;padding:12px;background:var(--bg-tertiary);border-radius:8px;font-size:12px;color:var(--text-secondary);">';
  html += '<b>S\u1EA3n ph\u1EA9m:</b> ' + (batch.product || '\u2014') + ' \u00B7 <b>Tr\u1EA1ng th\u00E1i:</b> ' + (batch.status === 'completed' ? 'Ho\u00E0n th\u00E0nh' : (batch.status === 'taodong_done' ? 'T\u1EA1o \u0110\u00F4ng xong' : '\u0110ang x\u1EED l\u00FD'));
  if (batch.inputWeight) html += ' \u00B7 <b>NL:</b> ' + formatNumber(batch.inputWeight) + ' kg';
  if (batch.outputWeight) html += ' \u00B7 <b>SL:</b> ' + formatNumber(batch.outputWeight) + ' kg';
  html += '</div>';

  body.innerHTML = html;
  renderAuditLog(batch);
  switchTraceTab('stages');
}

// === LINE RECORD TRACEABILITY ===
async function openLineRecordTrace(recordId) {
  var rec = (window.lineRecords || []).find(function(r) { return r.id === recordId; });
  if (!rec) {
    try {
      var doc = await db.collection('productionLineRecords').doc(recordId).get();
      if (doc.exists) rec = Object.assign({ id: doc.id }, doc.data());
    } catch (e) { /* ignore */ }
  }
  if (!rec) { showToast('Kh\u00F4ng t\u00ECm th\u1EA5y phi\u1EBFu', 'error'); return; }

  var title = document.getElementById('traceModalTitle');
  title.textContent = 'Truy Xu\u1EA5t: ' + (rec.recordCode || recordId);
  var body = document.getElementById('traceModalBody');
  body.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">\u0110ang t\u1EA3i d\u1EEF li\u1EC7u truy xu\u1EA5t chi ti\u1EBFt...</div>';
  document.getElementById('traceModal').classList.add('active');

  var html = '<div class="trace-timeline">';

  // === LINKED BATCHES — full detail ===
  var linkedBatches = rec.linkedBatches || [];
  if (linkedBatches.length > 0) {
    for (var bi = 0; bi < linkedBatches.length; bi++) {
      var lb = linkedBatches[bi];
      var batch = null;
      try {
        var bDoc = await db.collection('productionBatches').doc(lb.batchId).get();
        if (bDoc.exists) batch = Object.assign({ id: bDoc.id }, bDoc.data());
      } catch (e) { /* ignore */ }
      if (!batch) continue;

      // === 1. TI\u1EBEP NH\u1EACN NGUY\u00CAN LI\u1EC6U (xe + h\u1ED3 ph\u1ED1i li\u1EC7u) ===
      var tank = null;
      if (batch.sourceTankId) {
        tank = mesTankData.find(function(t) { return t.id === batch.sourceTankId; });
        if (!tank) {
          try {
            var tDoc = await db.collection('blendingBatches').doc(batch.sourceTankId).get();
            if (tDoc.exists) tank = Object.assign({ id: tDoc.id }, tDoc.data());
          } catch (e) { /* ignore */ }
        }
      }

      // Lookup vehicles from tank sourceReceipts (stores harvestData doc IDs)
      var vehicles = [];
      if (tank && tank.sourceReceipts && tank.sourceReceipts.length > 0) {
        var receiptIds = tank.sourceReceipts;
        // Match by doc ID or receiptNo
        vehicles = factoryReceipts.filter(function(r) { return receiptIds.includes(r.id) || receiptIds.includes(r.receiptNo); });
        // If not found in memory, query harvestData directly by doc IDs
        if (vehicles.length === 0 && tank.date) {
          try {
            var vSnap = await db.collection('harvestData').where('importDate', '==', tank.date).get();
            vSnap.forEach(function(vDoc) {
              if (receiptIds.includes(vDoc.id)) {
                var d = vDoc.data();
                vehicles.push({ receiptNo: vDoc.id, vehicleNo: d.soXe || d.vehicleNo || '-', plantation: d.donVi || '', muNuoc: d.muNuoc || 0, drcPercent: d.drc || 0, qkMuNuoc: d.qkMuNuoc || 0 });
              }
            });
          } catch (e) { /* ignore */ }
        }
      }

      // Vehicles node
      if (vehicles.length > 0) {
        html += '<div class="trace-node">';
        html += '<div class="trace-dot source"></div>';
        html += '<div class="trace-node-header">Nguy\u00EAn Li\u1EC7u \u0110\u1EA7u V\u00E0o <span class="trace-stage-num">' + vehicles.length + ' xe</span></div>';
        html += '<div class="trace-node-body">';
        vehicles.forEach(function(v) {
          html += '<div class="trace-vehicle-card">';
          html += '<div class="trace-vehicle-plate">' + v.vehicleNo + '</div>';
          html += '<div class="trace-vehicle-info">' + (v.plantation || '') + ' \u00B7 ' + formatNumber(v.muNuoc) + ' kg \u00B7 DRC ' + (v.drcPercent || 0) + '%</div>';
          html += '</div>';
        });
        html += '</div></div>';
      }

      // Blending tank node
      if (tank) {
        html += '<div class="trace-node">';
        html += '<div class="trace-dot source"></div>';
        html += '<div class="trace-node-header">H\u1ED3 Ph\u1ED1i Li\u1EC7u <span class="trace-stage-num">' + (tank.batchCode || '') + '</span></div>';
        html += '<div class="trace-node-body">';
        html += '<span class="trace-param">H\u1ED3 #' + (tank.tankNo || '') + '</span>';
        html += '<span class="trace-param">' + formatNumber(tank.totalWeight || 0) + ' kg</span>';
        html += '<span class="trace-param">DRC TB: ' + (tank.avgDRC || 0) + '%</span>';
        html += '<span class="trace-param">Q.kh\u00F4: ' + formatNumber(tank.totalDryWeight || 0) + ' kg</span>';
        html += '</div></div>';
      }

      // === 2. H\u1ED2 S\u1EA2N XU\u1EA4T — batch stages chi ti\u1EBFt ===
      html += '<div class="trace-node">';
      html += '<div class="trace-dot completed"></div>';
      html += '<div class="trace-node-header">H\u1ED3 ' + (batch.batchNo || lb.batchNo) + ' <span style="font-size:12px;padding:1px 6px;border-radius:3px;background:rgba(34,197,94,0.15);color:#22c55e;font-weight:700;">' + (batch.product || '') + '</span></div>';
      html += '<div class="trace-node-body">';
      if (lb.muongs) html += '<span class="trace-param">M\u01B0\u01A1ng: ' + lb.muongs.join(', ') + '</span>';
      html += '<span class="trace-param">NL: ' + formatNumber(batch.inputWeight || 0) + ' kg</span>';
      html += '</div></div>';

      // Batch stages with full params
      var bsCurrentIdx = SanxuatStages.BATCH_STAGE_ORDER.indexOf(batch.processStage);
      if (batch.status === 'taodong_done' || batch.status === 'completed') bsCurrentIdx = SanxuatStages.BATCH_STAGE_ORDER.length;
      SanxuatStages.BATCH_STAGE_ORDER.forEach(function(bs, bsIdx) {
        var bsd = batch.stageData ? batch.stageData[bs] : null;
        // Fallback: literal field "stageData.{stage}" from .add() bug
        var _bsdLit = batch['stageData.' + bs] || null;
        if (!bsd && _bsdLit) bsd = _bsdLit;
        var bsDotClass = bsIdx < bsCurrentIdx ? 'completed' : (bsIdx === bsCurrentIdx ? 'active' : 'pending');
        html += '<div class="trace-node">';
        html += '<div class="trace-dot ' + bsDotClass + '"></div>';
        html += '<div class="trace-node-header"><span class="trace-stage-num">B' + (bsIdx + 1) + '</span> ' + getStageLabel(bs);
        // Timestamp
        if (bsd) {
          var _bsTime = bsd.stageTimeStart || '';
          if (!_bsTime && bsd.completedAt) {
            var _ts = bsd.completedAt;
            if (_ts.toDate) _ts = _ts.toDate();
            else if (typeof _ts === 'string') _ts = new Date(_ts);
            if (_ts instanceof Date && !isNaN(_ts)) _bsTime = String(_ts.getHours()).padStart(2,'0') + ':' + String(_ts.getMinutes()).padStart(2,'0');
          }
          if (_bsTime) html += ' <span style="font-size:12px;color:var(--text-muted);">' + _bsTime + '</span>';
          var _bsEnd = bsd.stageTimeEnd || '';
          if (_bsEnd) html += ' \u2014 <span style="font-size:12px;color:var(--text-muted);">' + _bsEnd + '</span>';
        }
        // Personnel
        if (bsd) {
          var _bsPerson = bsd.updatedByName || bsd.completedByName || '';
          if (_bsPerson) html += ' <span class="trace-person">\uD83D\uDC64 ' + _bsPerson + '</span>';
        }
        html += '</div>';

        // Params: stageData.[stage].params \u2192 literal field fallback \u2192 techParams
        var _bsParams = (bsd && bsd.params) ? bsd.params : {};
        // Fallback: literal field "stageData.{stage}" (created by .add() with dot-notation key)
        if (Object.keys(_bsParams).length === 0) {
          var _litField = batch['stageData.' + bs];
          if (_litField && _litField.params) _bsParams = _litField.params;
        }
        if (Object.keys(_bsParams).length === 0 && bsIdx <= bsCurrentIdx && batch.techParams) {
          _bsParams = batch.techParams;
        }
        if (Object.keys(_bsParams).length > 0) {
          html += '<div class="trace-node-body">';
          // Ch\u1ECDn STAGE_FIELDS theo lo\u1EA1i s\u1EA3n ph\u1EA9m
          var _bsProd = batch.product || '';
          var _bsLatex = _bsProd === 'LatexHA' || _bsProd === 'LatexLA';
          var _bsSvr1020 = _bsProd === 'SVR10' || _bsProd === 'SVR20';
          var bsFields = (_bsLatex ? STAGE_FIELDS_107[bs] : (_bsSvr1020 ? STAGE_FIELDS_102[bs] : STAGE_FIELDS[bs])) || [];
          var _bsAuthors = bsd?.paramAuthors || {};
          bsFields.forEach(function(fid) {
            if (_bsParams[fid] !== undefined && _bsParams[fid] !== '') {
              var _ba = _bsAuthors[fid];
              html += '<span class="trace-param">' + (PARAM_LABELS[fid] || fid) + ': ' + _bsParams[fid];
              if (_ba && _ba.userName) html += ' <span class="param-author" title="' + _ba.userName + (_ba.at ? ' \u00B7 ' + _ba.at.slice(0,16).replace('T',' ') : '') + '">\uD83D\uDC64' + _ba.userName + '</span>';
              html += '</span>';
            }
          });
          // Channel detail for t\u1EA1o \u0111\u00F4ng
          var _chData = _bsParams.channels || [];
          if (bs === 'taodong' && _chData.length > 0) {
            html += '<table style="width:100%;margin-top:6px;font-size:12px;border-collapse:collapse;">';
            html += '<tr style="color:var(--text-muted);"><td style="padding:2px 4px;">M\u01B0\u01A1ng</td><td>pH \u0111\u1EA7u</td><td>pH gi\u1EEFa</td><td>pH cu\u1ED1i</td><td>KL t\u01B0\u01A1i</td><td>KL kh\u00F4</td></tr>';
            _chData.forEach(function(ch) {
              // Ch\u1EC9 hi\u1EC3n m\u01B0\u01A1ng thu\u1ED9c phi\u1EBFu n\u00E0y
              if (lb.muongs && lb.muongs.indexOf(ch.muong) === -1) return;
              html += '<tr style="border-top:1px solid var(--border-color);">';
              html += '<td style="padding:2px 4px;font-weight:600;">M' + ch.muong + '</td>';
              html += '<td>' + (ch.phDau || '\u2014') + '</td>';
              html += '<td>' + (ch.phGiua || '\u2014') + '</td>';
              html += '<td>' + (ch.phCuoi || '\u2014') + '</td>';
              html += '<td>' + (ch.klTuoi ? formatNumber(ch.klTuoi) : '\u2014') + '</td>';
              html += '<td>' + (ch.klKho ? formatNumber(ch.klKho) : '\u2014') + '</td>';
              html += '</tr>';
            });
            html += '</table>';
          }
          html += '</div>';
        }
        html += '</div>';
      });
    }
  } else {
    html += '<div class="trace-node"><div class="trace-dot pending"></div>';
    html += '<div class="trace-node-header" style="color:var(--text-muted);">Ch\u01B0a li\u00EAn k\u1EBFt h\u1ED3 n\u00E0o</div></div>';
  }

  // === LINE RECORD STAGES — chi ti\u1EBFt ===
  // Pre-collect cross-DC drying: trolleys from this record that were dried in another DC
  var _crossDCDrying = [];
  (window.lineRecords || []).forEach(function(otherRec) {
    if (otherRec.id === rec.id) return;
    var td = otherRec.stageData && otherRec.stageData.say && otherRec.stageData.say.trolleyDrying;
    if (!td || !Array.isArray(td)) return;
    td.forEach(function(t) {
      if (t.transferred && t.fromRecordId === rec.id) {
        _crossDCDrying.push({
          trolleyNo: t.trolleyNo,
          timeIn: t.timeIn || '',
          timeOut: t.timeOut || '',
          dcLine: otherRec.productionLine || '?',
          recordCode: otherRec.recordCode || otherRec.id
        });
      }
    });
  });
  var _hasCrossDCDrying = _crossDCDrying.length > 0;

  var lrCurrentIdx = SanxuatStages.LINE_STAGE_ORDER.indexOf(rec.currentStage);
  if (rec.status === 'completed') lrCurrentIdx = SanxuatStages.LINE_STAGE_ORDER.length;
  SanxuatStages.LINE_STAGE_ORDER.forEach(function(ls, lsIdx) {
    var lsd = rec.stageData ? rec.stageData[ls] : null;
    var dotClass = lsIdx < lrCurrentIdx ? 'completed' : (lsIdx === lrCurrentIdx ? 'active' : 'pending');
    // If trolleys were dried in another DC, treat say stage as completed even if no local data
    if (ls === 'say' && _hasCrossDCDrying && dotClass === 'pending' && !lsd) dotClass = 'completed';
    html += '<div class="trace-node">';
    html += '<div class="trace-dot ' + dotClass + '"></div>';
    html += '<div class="trace-node-header"><span class="trace-stage-num">B' + (lsIdx + 3) + '</span> ' + getStageLabel(ls);
    // Shift badge
    if (lsd?.shift) {
      html += ' <span class="shift-badge">' + (typeof lsd.shift === 'object' ? lsd.shift.name : lsd.shift) + '</span>';
    }
    // Time
    if (lsd) {
      var _lrTime = lsd.stageTimeStart || '';
      if (!_lrTime && lsd.params && lsd.params.canmuChannels && lsd.params.canmuChannels.length > 0) {
        _lrTime = lsd.params.canmuChannels.reduce(function(min, cc) { return cc.tgBatDau && (!min || cc.tgBatDau < min) ? cc.tgBatDau : min; }, '');
      }
      if (_lrTime) html += ' <span style="font-size:12px;color:var(--text-muted);">' + _lrTime + '</span>';
      var _lrEnd = lsd.stageTimeEnd || '';
      if (!_lrEnd && lsd.params && lsd.params.canmuChannels && lsd.params.canmuChannels.length > 0) {
        _lrEnd = lsd.params.canmuChannels.reduce(function(max, cc) { return cc.tgKetThuc && (!max || cc.tgKetThuc > max) ? cc.tgKetThuc : max; }, '');
      }
      if (_lrEnd) html += ' \u2014 <span style="font-size:12px;color:var(--text-muted);">' + _lrEnd + '</span>';
    }
    // Personnel
    if (lsd) {
      var _lrPerson = lsd.updatedByName || lsd.completedByName || '';
      if (_lrPerson) html += ' <span class="trace-person">\uD83D\uDC64 ' + _lrPerson + '</span>';
    }
    html += '</div>';

    if (lsd && lsd.params) {
      html += '<div class="trace-node-body">';
      var lsParams = lsd.params;
      var _lsAuthors = lsd.paramAuthors || {};
      var fields = STAGE_FIELDS[ls] || [];
      fields.forEach(function(fid) {
        if (lsParams[fid] !== undefined && lsParams[fid] !== '') {
          var _la = _lsAuthors[fid];
          html += '<span class="trace-param">' + (PARAM_LABELS[fid] || fid) + ': ' + lsParams[fid];
          if (_la && _la.userName) html += ' <span class="param-author" title="' + _la.userName + (_la.at ? ' \u00B7 ' + _la.at.slice(0,16).replace('T',' ') : '') + '">\uD83D\uDC64' + _la.userName + '</span>';
          html += '</span>';
        }
      });
      // Canmu channel timing
      if (ls === 'canmu' && lsParams.canmuChannels && lsParams.canmuChannels.length > 0) {
        html += '<table style="width:100%;margin-top:6px;font-size:12px;border-collapse:collapse;">';
        html += '<tr style="color:var(--text-muted);"><td style="padding:2px 4px;">M\u01B0\u01A1ng</td><td>B\u1EAFt \u0111\u1EA7u</td><td>K\u1EBFt th\u00FAc</td></tr>';
        lsParams.canmuChannels.forEach(function(cc) {
          html += '<tr style="border-top:1px solid var(--border-color);">';
          html += '<td style="padding:2px 4px;font-weight:600;">M' + cc.muong + '</td>';
          html += '<td>' + (cc.tgBatDau || '\u2014') + '</td>';
          html += '<td>' + (cc.tgKetThuc || '\u2014') + '</td>';
          html += '</tr>';
        });
        html += '</table>';
      }
      // Trolley mapping for taohat — filter by record's muongNumbers
      if (ls === 'taohat' && lsParams.trolleys && lsParams.trolleys.length > 0) {
        var flatT = lsParams.trolleys[0]?.boxMappings ? [] : lsParams.trolleys;
        if (lsParams.trolleys[0]?.boxMappings) {
          lsParams.trolleys.forEach(function(t) { (t.boxMappings||[]).forEach(function(m) { flatT.push({trolleyNo:t.trolleyNo, muongNo:m.muongNo}); }); });
        }
        var _recMuongs = rec.muongNumbers || [];
        if (_recMuongs.length > 0) {
          flatT = flatT.filter(function(r) { return !r.muongNo || _recMuongs.indexOf(r.muongNo) !== -1; });
        }
        html += '<div style="margin-top:4px;font-size:12px;">';
        var byT = {};
        flatT.forEach(function(r) { if(r.trolleyNo) { if(!byT[r.trolleyNo]) byT[r.trolleyNo]=[]; if(r.muongNo) byT[r.trolleyNo].push(r.muongNo); } });
        Object.keys(byT).forEach(function(tNo, i) {
          if (i > 0) html += ' \u00B7 ';
          html += 'Th\u00F9ng ' + tNo + (byT[tNo].length > 0 ? ' (M' + byT[tNo].join(',M') + ')' : '');
        });
        html += '</div>';
      }
      html += '</div>';
    }
    // Cross-DC drying: show trolleys from this record that were dried in another DC
    if (ls === 'say' && _hasCrossDCDrying) {
      var _hadBody = !!(lsd && lsd.params);
      if (!_hadBody) html += '<div class="trace-node-body">';
      html += '<div style="margin-top:' + (_hadBody ? '6' : '0') + 'px;padding:6px 8px;background:rgba(99,102,241,0.08);border-radius:6px;border:1px solid rgba(99,102,241,0.2);">';
      html += '<div style="font-size:12px;font-weight:600;color:#818cf8;margin-bottom:4px;">\u2197\uFE0F S\u1EA5y t\u1EA1i DC kh\u00E1c (' + _crossDCDrying[0].dcLine + ')</div>';
      html += '<table style="width:100%;font-size:12px;border-collapse:collapse;">';
      html += '<tr style="color:var(--text-muted);"><td style="padding:2px 4px;">Th\u00F9ng</td><td>V\u00E0o l\u00F2</td><td>Ra l\u00F2</td></tr>';
      _crossDCDrying.forEach(function(cd) {
        html += '<tr style="border-top:1px solid var(--border-color);">';
        html += '<td style="padding:2px 4px;font-weight:600;">#' + cd.trolleyNo + '</td>';
        html += '<td>' + (cd.timeIn || '\u2014') + '</td>';
        html += '<td>' + (cd.timeOut || '\u2014') + '</td>';
        html += '</tr>';
      });
      html += '</table></div>';
      if (!_hadBody) html += '</div>';
    }
    html += '</div>';
  });

  html += '</div>';

  // Summary footer
  html += '<div style="margin-top:16px;padding:12px;background:var(--bg-tertiary);border-radius:8px;font-size:12px;color:var(--text-secondary);">';
  html += '<b>DC:</b> ' + (rec.productionLine || '\u2014') + ' \u00B7 <b>Ca:</b> ' + (rec.shift || '\u2014') + ' \u00B7 <b>Ng\u00E0y SX:</b> ' + (rec.date || '\u2014');
  if (rec.muongNumbers) html += ' \u00B7 <b>M\u01B0\u01A1ng:</b> ' + rec.muongNumbers.join(', ');
  html += '</div>';

  body.innerHTML = html;
  renderAuditLog(rec);
  switchTraceTab('stages');
}

// === TRACE TAB SWITCHING & AUDIT LOG ===
function switchTraceTab(tab) {
  var tabs = document.querySelectorAll('#traceTabBar .trace-tab');
  tabs.forEach(function(t) { t.classList.toggle('active', t.dataset.tab === tab); });
  document.getElementById('traceModalBody').style.display = tab === 'stages' ? '' : 'none';
  document.getElementById('traceAuditBody').style.display = tab === 'audit' ? '' : 'none';
}

function renderAuditLog(entity) {
  var timeline = entity.timeline || [];
  var body = document.getElementById('traceAuditBody');

  if (timeline.length === 0) {
    body.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-muted);font-style:italic;">Ch\u01B0a c\u00F3 nh\u1EADt k\u00FD ho\u1EA1t \u0111\u1ED9ng cho b\u1EA3n ghi n\u00E0y.</div>';
    return;
  }

  // Sort by timestamp descending (most recent first)
  var sorted = timeline.slice().sort(function(a, b) {
    return (b.timestamp || '').localeCompare(a.timestamp || '');
  });

  var html = '<div style="padding:8px 0;">';
  sorted.forEach(function(entry) {
    var ts = entry.timestamp ? new Date(entry.timestamp) : null;
    var timeStr = ts ? (
      String(ts.getDate()).padStart(2,'0') + '/' +
      String(ts.getMonth() + 1).padStart(2,'0') + '/' +
      ts.getFullYear() + ' ' +
      String(ts.getHours()).padStart(2,'0') + ':' +
      String(ts.getMinutes()).padStart(2,'0')
    ) : '';

    var actionLabel = _getAuditActionLabel(entry.action);
    var badgeClass = _getAuditBadgeClass(entry.action);
    var stageLabel = entry.stage ? (window.getStageLabel ? getStageLabel(entry.stage) : entry.stage) : '';

    html += '<div class="audit-entry">';
    html += '<div class="audit-time">' + timeStr + '</div>';
    html += '<div style="flex:1;">';
    html += '<span class="audit-action-badge ' + badgeClass + '">' + actionLabel + '</span> ';
    if (stageLabel) html += '<span class="audit-stage">' + stageLabel + '</span> ';
    if (entry.userName) html += '<span class="audit-user">' + entry.userName + '</span>';
    if (entry.userRole) html += ' <span style="font-size:12px;color:var(--text-muted);">(' + entry.userRole + ')</span>';

    // Details
    if (entry.details) {
      html += '<div class="audit-details">';
      if (entry.details.fromStage && entry.details.toStage) {
        var from = window.getStageLabel ? getStageLabel(entry.details.fromStage) : entry.details.fromStage;
        var to = entry.details.toStage === 'completed' ? 'Ho\u00E0n th\u00E0nh' :
                 entry.details.toStage === 'taodong_done' ? 'T\u0110 xong' :
                 (window.getStageLabel ? getStageLabel(entry.details.toStage) : entry.details.toStage);
        html += from + ' \u2192 ' + to;
      }
      if (entry.details.fromStatus) {
        html += entry.details.fromStatus + ' \u2192 ' + (entry.details.toStatus || '');
      }
      // Show changed params
      if (entry.details.changedParams && entry.details.changedParams.length > 0) {
        var paramLabels = entry.details.changedParams.map(function(p) {
          return window.PARAM_LABELS && PARAM_LABELS[p] ? PARAM_LABELS[p] : p.replace('param', '');
        });
        html += '<div style="margin-top:2px;">\u270F\uFE0F ' + paramLabels.join(', ') + '</div>';
      }
      html += '</div>';
    }
    html += '</div></div>';
  });
  html += '</div>';

  body.innerHTML = html;
}

function _getAuditActionLabel(action) {
  var map = {
    'batch_created': 'T\u1EA1o h\u1ED3',
    'record_created': 'T\u1EA1o phi\u1EBFu',
    'stage_saved': 'L\u01B0u',
    'batch_advanced': 'Chuy\u1EC3n b\u01B0\u1EDBc',
    'record_advanced': 'Chuy\u1EC3n b\u01B0\u1EDBc',
    'batch_reverted': 'Quay l\u1EA1i',
    'record_reverted': 'Quay l\u1EA1i',
    'batch_completed': 'Ho\u00E0n th\u00E0nh',
    'record_completed': 'Ho\u00E0n th\u00E0nh'
  };
  return map[action] || action;
}

function _getAuditBadgeClass(action) {
  if (action.indexOf('created') !== -1) return 'created';
  if (action.indexOf('saved') !== -1) return 'saved';
  if (action.indexOf('advanced') !== -1) return 'advanced';
  if (action.indexOf('reverted') !== -1) return 'reverted';
  if (action.indexOf('completed') !== -1) return 'completed';
  if (action.indexOf('deleted') !== -1) return 'deleted';
  return 'saved';
}

// Helper: render a single trace stage node
function renderTraceStageNode(entity, stage, idx, currentIdx) {
  var stageLabel = getStageLabel(stage);
  var sd = entity.stageData ? entity.stageData[stage] : null;
  // Fallback: literal field "stageData.{stage}" from .add() bug
  if (!sd && entity['stageData.' + stage]) sd = entity['stageData.' + stage];
  var params = sd?.params || (idx <= currentIdx ? entity.techParams : null) || {};
  var hasData = sd || (idx === currentIdx && entity.techParams);
  var dotClass = idx < currentIdx ? 'completed' : (idx === currentIdx ? 'active' : 'pending');

  var html = '<div class="trace-node">';
  html += '<div class="trace-dot ' + dotClass + '"></div>';
  html += '<div class="trace-node-header">';
  html += '<span class="trace-stage-num">B' + (STAGE_ORDER.indexOf(stage) + 1) + '</span> ' + stageLabel;

  // Shift badge
  if (sd?.shift) {
    html += ' <span class="shift-badge">' + sd.shift.name + '</span>';
  } else if (sd?.shiftIn || sd?.shiftOut) {
    html += ' <span class="shift-badge">' + (sd.shiftIn?.name || '\u2014') + ' \u2192 ' + (sd.shiftOut?.name || '\u2014') + '</span>';
  }

  // Show actual production time (stageTimeStart) or fall back to updatedAt date only
  if (sd) {
    var _stTime = sd.stageTimeStart || '';
    if (_stTime) {
      html += ' <span style="font-size:12px;color:var(--text-muted);font-weight:400;">' + _stTime + '</span>';
    } else if (sd.updatedAt) {
      var t = typeof sd.updatedAt === 'string' ? sd.updatedAt : (sd.updatedAt?.toDate ? sd.updatedAt.toDate().toISOString() : '');
      if (t) {
        html += ' <span style="font-size:12px;color:var(--text-muted);font-weight:400;">' + new Date(t).toLocaleDateString('vi-VN') + '</span>';
      }
    }
  }
  // Personnel info
  if (sd) {
    var _personName = sd.updatedByName || sd.completedByName || '';
    if (_personName) {
      html += ' <span class="trace-person" title="Ng\u01B0\u1EDDi th\u1EF1c hi\u1EC7n">\uD83D\uDC64 ' + _personName + '</span>';
    }
  }
  html += '</div>';

  if (hasData && Object.keys(params).length > 0) {
    html += '<div class="trace-node-body">';

    // Stage execution time
    var _tStart = sd?.stageTimeStart || '';
    var _tEnd = sd?.stageTimeEnd || '';
    if (_tStart || _tEnd) {
      html += '<div style="margin-bottom:6px;font-size:12px;color:var(--text-secondary);">\u23F1 ';
      if (_tStart) html += 'B\u1EAFt \u0111\u1EA7u: <b>' + _tStart + '</b>';
      if (_tStart && _tEnd) html += ' \u2014 ';
      if (_tEnd) html += 'K\u1EBFt th\u00FAc: <b>' + _tEnd + '</b>';
      html += '</div>';
    }

    // Key params with author attribution
    var latex = isProductLatex();
    var svr1020 = isProductSVR10_20();
    var _pAuthors = sd?.paramAuthors || {};
    var fields = (latex ? STAGE_FIELDS_107[stage] : (svr1020 ? STAGE_FIELDS_102[stage] : STAGE_FIELDS[stage])) || [];
    fields.forEach(function(fid) {
      if (params[fid] !== undefined && params[fid] !== '') {
        var label = PARAM_LABELS[fid] || fid.replace('param', '');
        var author = _pAuthors[fid];
        html += '<span class="trace-param">' + label + ': ' + params[fid];
        if (author && author.userName) {
          html += ' <span class="param-author" title="' + author.userName + (author.at ? ' \u00B7 ' + author.at.slice(0, 16).replace('T', ' ') : '') + '">\uD83D\uDC64' + author.userName + '</span>';
        }
        html += '</span>';
      }
    });

    // Channels (taodong)
    if (stage === 'taodong' && params.channels && params.channels.length > 0) {
      html += '<div style="margin-top:4px;font-size:12px;">' + params.channels.length + ' m\u01B0\u01A1ng \u00B7 pH: ';
      var phVals = [];
      params.channels.forEach(function(ch) { if (ch.phDau) phVals.push(ch.phDau); });
      html += phVals.length > 0 ? (Math.min.apply(null, phVals).toFixed(1) + '\u2013' + Math.max.apply(null, phVals).toFixed(1)) : '\u2014';
      html += '</div>';
    }

    // Trolleys (taohat)
    if (stage === 'taohat' && params.trolleys && params.trolleys.length > 0) {
      var flatT = params.trolleys[0]?.boxMappings ? [] : params.trolleys;
      if (params.trolleys[0]?.boxMappings) {
        params.trolleys.forEach(function(t) { (t.boxMappings||[]).forEach(function(m) { flatT.push({trolleyNo:t.trolleyNo, muongNo:m.muongNo}); }); });
      }
      var byTrolley = {};
      flatT.forEach(function(r) { if(r.trolleyNo) { if(!byTrolley[r.trolleyNo]) byTrolley[r.trolleyNo]=[]; if(r.muongNo) byTrolley[r.trolleyNo].push(r.muongNo); } });
      var trolleyKeys = Object.keys(byTrolley);
      html += '<div style="margin-top:4px;font-size:12px;">' + trolleyKeys.length + ' th\u00F9ng s\u1EA5y: ';
      trolleyKeys.forEach(function(tNo, i) {
        if (i > 0) html += ', ';
        html += '#' + tNo;
        var muongs = byTrolley[tNo];
        if (muongs.length > 0) html += '(M' + muongs.join(',M') + ')';
      });
      html += '</div>';
    }

    // CanmuChannels
    if (stage === 'canmu' && params.canmuChannels && params.canmuChannels.length > 0) {
      html += '<div style="margin-top:4px;font-size:12px;">' + params.canmuChannels.length + ' m\u01B0\u01A1ng c\u00E1n</div>';
    }

    // Oven & Temperature (say)
    if (stage === 'say' && sd) {
      if (sd.ovenId) {
        var ovens = OVEN_CONFIG[currentFactory] || [];
        var oven = ovens.find(function(o) { return o.id === sd.ovenId; });
        html += '<span class="trace-param">\uD83D\uDD25 ' + (oven ? oven.name : sd.ovenId) + '</span>';
      }
      if (sd.trolleyDrying && sd.trolleyDrying.length > 0) {
        html += '<div style="margin-top:4px;font-size:12px;">' + sd.trolleyDrying.length + ' th\u00F9ng: ';
        sd.trolleyDrying.forEach(function(td, i) {
          if (i > 0) html += ', ';
          html += '#' + td.trolleyNo + '(' + (td.timeIn || '?') + '\u2013' + (td.timeOut || '?') + ')';
        });
        html += '</div>';
        // Heat summary in trace
        var hs3 = getOvenHeatSummaryFromData(sd);
        if (hs3.warmupCount > 0 || hs3.shutdownCount > 0) {
          html += '<div style="margin-top:2px;font-size:12px;">';
          if (hs3.warmupCount > 0) html += '<span class="heat-badge warmup">K\u0110 ' + hs3.warmupCount + '</span> ';
          if (hs3.shutdownCount > 0) html += '<span class="heat-badge shutdown">TL ' + hs3.shutdownCount + '</span> ';
          html += '</div>';
        }
        if (hs3.minHeat !== null) {
          html += '<div style="margin-top:2px;font-size:12px;">Ch\u1ECBu nhi\u1EC7t: ' + _ovenFormatDuration(hs3.minHeat);
          if (hs3.maxHeat !== null && hs3.maxHeat !== hs3.minHeat) html += ' \u2013 ' + _ovenFormatDuration(hs3.maxHeat);
          html += '</div>';
        }
      }
      if (sd.tempLog && sd.tempLog.length > 0) {
        var tb1 = [], tb2 = [];
        sd.tempLog.forEach(function(tl) { if (tl.burner1 != null) tb1.push(tl.burner1); if (tl.burner2 != null) tb2.push(tl.burner2); });
        html += '<div style="margin-top:2px;font-size:12px;">' + sd.tempLog.length + ' \u0111o \u00B7 ';
        if (tb1.length > 0) html += '\u0110\u01101: ' + Math.min.apply(null, tb1) + '\u2013' + Math.max.apply(null, tb1) + '\u00B0C';
        if (tb1.length > 0 && tb2.length > 0) html += ' \u00B7 ';
        if (tb2.length > 0) html += '\u0110\u01102: ' + Math.min.apply(null, tb2) + '\u2013' + Math.max.apply(null, tb2) + '\u00B0C';
        html += '</div>';
      }
    }

    html += '</div>';
  } else if (dotClass === 'pending') {
    html += '<div class="trace-node-body" style="color:var(--text-muted);font-style:italic;">Ch\u01B0a th\u1EF1c hi\u1EC7n</div>';
  }

  html += '</div>';
  return html;
}

function editBatchAtStage(batchId, stage) {
  openBatchModal(batchId);
  setTimeout(() => {
    document.getElementById('batchStage').value = stage;
    toggleStageParams();
    // Bước 2: hiện đầy đủ hồ phối liệu; Bước khác: chỉ hiện thông số
    const isStep2 = (stage === 'xulymu');
    document.getElementById('batchHeaderFields').style.display = isStep2 ? '' : 'none';
    document.getElementById('batchParamOnlyHeader').style.display = isStep2 ? 'none' : '';
    if (!isStep2) {
      const b = batches.find(x => x.id === batchId);
      const stageLabel = getStageLabel(stage);
      const stageIdx = STAGE_ORDER.indexOf(stage) + 1;
      document.getElementById('batchModalTitle').textContent = 'Nhập Thông Số — Bước ' + stageIdx + ': ' + stageLabel;
      var klSauPL = b?.stageData?.xulymu?.params?.paramKLSauPhaLoang;
      var weightLabel = klSauPL ? 'KL pha loãng: ' + formatNumber(klSauPL) + ' kg' : 'NL: ' + formatNumber(b?.inputWeight || 0) + ' kg';
      document.getElementById('batchParamOnlyInfo').innerHTML = '<b>' + (b?.batchNo || '') + '</b> · ' + (b?.product || '') + (b?.sourceTankCode ? ' · Hồ ' + b.sourceTankCode : '') + ' · ' + weightLabel;
    }
    // Load shift data
    const bShift = batches.find(x => x.id === batchId);
    if (bShift?.stageData?.[stage]) loadShiftData(bShift.stageData[stage], stage);

    // Bước 3 (Tạo Đông): prefill KL sau pha loãng + hiện TG kết thúc XL mủ
    if (stage === 'taodong') {
      prefillKLPhaLoang(batchId);
      showXulymuEndTime(batchId);
      validateTaodongTime();
    }

    // Bước 4 (Cán Mủ): sinh bảng TG cán theo từng mương từ dữ liệu bước 3
    if (stage === 'canmu') {
      generateCanmuMuongRows(batchId);
      const b = batches.find(x => x.id === batchId);
      const canmuData = b?.stageData?.canmu?.params?.canmuChannels || b?.techParams?.canmuChannels;
      if (canmuData) loadCanmuMuongData(canmuData);
    } else {
      const cc = document.getElementById('canmuMuongContainer');
      if (cc) cc.innerHTML = '';
    }

    // Bước 5 (Tạo Hạt): load trolley mapping
    if (stage === 'taohat') {
      currentEditingBatchId = batchId;
      initTrolleyTable();
      const bTh = batches.find(x => x.id === batchId);
      const trolleyData = bTh?.stageData?.taohat?.params?.trolleys || bTh?.techParams?.trolleys;
      if (trolleyData) loadTrolleyData(trolleyData);
    } else {
      initTrolleyTable();
    }

    // Bước 6 (Sấy): load oven & temperature data
    if (stage === 'say') {
      currentEditingBatchId = batchId;
      initOvenSelect();
      const bOven = batches.find(x => x.id === batchId);
      if (bOven?.stageData?.say) loadOvenData(bOven.stageData.say);
    } else {
      clearOvenSection();
    }
  }, 100);
}

function createBatchFromStep() {
  openBatchModal();
  setTimeout(() => {
    document.getElementById('batchStage').value = currentStage || 'xulymu';
    toggleStageParams();
  }, 100);
}

async function createBatchFromTank(tankId) {
  if (typeof TabMES !== 'undefined') { TabMES.createBatchFromTank(tankId); return; }
  const tank = mesTankData.find(t => t.id === tankId);
  if (!tank) return;

  var tankNo = tank.tankNo || 0;
  var usageCount = 1;
  try {
    var existing = await ErpDb.firestore().collection('productionBatches')
      .where('sourceTankNo', '==', tankNo)
      .where('factory', '==', currentFactory)
      .get();
    usageCount = existing.size + 1;
  } catch(e) {}

  var dateStr = (document.getElementById('mesDate') || {}).value || new Date().toISOString().slice(0, 10);
  var dp = dateStr.split('-');
  var batchCode = 'H' + String(tankNo).padStart(2, '0') + '/' +
    String(usageCount).padStart(2, '0') + '_' +
    dp[2] + '/' + dp[1] + '/' + dp[0].slice(-2);

  openBatchModal();
  setTimeout(() => {
    const batchNoEl = document.getElementById('batchNo');
    if (batchNoEl) { batchNoEl.value = batchCode; batchNoEl.readOnly = true; batchNoEl.style.opacity = '0.7'; }
    document.getElementById('batchStage').value = 'xulymu';
    toggleStageParams();
    const inputEl = document.getElementById('batchInputWeight');
    if (inputEl) { inputEl.value = tank.totalWeight || ''; inputEl.readOnly = true; inputEl.style.opacity = '0.7'; }
    populateBatchSourceTank(tankId);
  }, 150);
}

function onMESDateChange() {
  if (typeof TabMES !== 'undefined') { TabMES.onMESDateChange(); return; }
  const dateVal = document.getElementById('mesDate')?.value;
  if (!dateVal) return;
  loadMESTanks(dateVal);
  applyBatchFilters();
  renderStepDashboard(currentStage);
}

function onMESProductChange() {
  if (typeof TabMES !== 'undefined') TabMES.onMESProductChange();
}

async function loadMESTanks(dateStr) {
  const grid = document.getElementById('mesTankGrid');
  // Use workspace config if available, fallback to legacy production line check
  var showTanks;
  if (typeof currentWorkspace !== 'undefined' && currentWorkspace && typeof SanxuatStages !== 'undefined' && SanxuatStages.WORKSPACE_CONFIG) {
    var wsConfig = (SanxuatStages.WORKSPACE_CONFIG[currentFactory] || []).find(function(ws) { return ws.id === currentWorkspace; });
    showTanks = wsConfig ? wsConfig.showTanks : true;
  } else {
    showTanks = currentProductionLine === 'all' ||
      ['tccs101','tccs103','tccs118'].includes(currentProductionLine);
  }

  if (!showTanks || !dateStr) {
    if (grid) grid.style.display = 'none';
    mesTankData = [];
    return;
  }

  try {
    const snapshot = await db.collection('blendingBatches')
      .where('date', '==', dateStr)
      .orderBy('batchCode', 'asc')
      .get();
    mesTankData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(d => !d.factory || d.factory === currentFactory);
  } catch (e) {
    console.warn('Load MES tanks error:', e.message);
    mesTankData = [];
  }

  renderMESTankCards();
}

function renderMESTankCards() {
  const grid = document.getElementById('mesTankGrid');
  if (!grid) return;

  // Use workspace config if available, fallback to legacy production line check
  var showTanks;
  if (typeof currentWorkspace !== 'undefined' && currentWorkspace && typeof SanxuatStages !== 'undefined' && SanxuatStages.WORKSPACE_CONFIG) {
    var wsConfig = (SanxuatStages.WORKSPACE_CONFIG[currentFactory] || []).find(function(ws) { return ws.id === currentWorkspace; });
    showTanks = wsConfig ? wsConfig.showTanks : true;
  } else {
    showTanks = currentProductionLine === 'all' ||
      ['tccs101','tccs103','tccs118'].includes(currentProductionLine);
  }

  if (!showTanks || mesTankData.length === 0) {
    grid.style.display = 'none';
    return;
  }

  grid.style.display = '';
  const statusText = {empty:'Trống', filling:'Đang nạp', full:'Đầy', processing:'Đang xử lý', done:'Hoàn thành'};

  let html = '';
  for (let i = 1; i <= 4; i++) {
    const tankBatches = mesTankData.filter(b => b.tankNo === i);
    const active = tankBatches.find(b => ['filling','full','processing'].includes(b.status));
    const done = tankBatches.find(b => b.status === 'done');
    const batch = active || done;

    const cls = batch ? batch.status : 'empty';
    const weight = batch ? formatNumber(batch.totalWeight || 0) : '0';
    const drc = batch ? (batch.avgDRC || 0).toFixed(1) : '0';
    const dry = batch ? formatNumber(batch.totalDryWeight || 0) : '0';
    const st = batch ? (statusText[batch.status] || batch.status) : 'Trống';
    const code = batch ? batch.batchCode : '';
    const receipts = batch ? (batch.sourceReceipts || []).length : 0;

    html += `<div class="tank-card ${cls}" data-tank="${i}" data-batch-id="${batch?.id || ''}" onclick="selectMESTank(${i})" style="cursor:pointer">
      <div class="tank-icon">🛢️</div>
      <div class="tank-name">Hồ ${i}</div>
      <div class="tank-weight">${weight} <small>kg</small></div>
      ${batch ? `<div style="font-size:12px;color:var(--text-muted);margin-top:2px;">DRC ${drc}% · Q.Khô ${dry} kg · ${receipts} xe</div>` : ''}
      ${code ? `<div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${code}</div>` : ''}
      <div class="tank-status">${st}</div>
    </div>`;
  }
  grid.innerHTML = html;

  // Re-apply highlight if a tank is selected
  if (selectedMESTank) {
    grid.querySelectorAll('.tank-card').forEach(card => {
      const t = parseInt(card.dataset.tank);
      card.style.outline = (t === selectedMESTank) ? '2px solid var(--accent)' : '';
      card.style.outlineOffset = (t === selectedMESTank) ? '2px' : '';
    });
  }
}

function selectMESTank(tankNo) {
  const grid = document.getElementById('mesTankGrid');
  if (!grid) return;
  if (selectedMESTank === tankNo) {
    selectedMESTank = null;
  } else {
    selectedMESTank = tankNo;
  }
  grid.querySelectorAll('.tank-card').forEach(card => {
    const t = parseInt(card.dataset.tank);
    card.style.outline = (t === selectedMESTank) ? '2px solid var(--accent)' : '';
    card.style.outlineOffset = (t === selectedMESTank) ? '2px' : '';
  });
  applyBatchFilters();
}

function initMESDate() {
  const dateInput = document.getElementById('mesDate');
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }
  // Set default active stage chip
  document.querySelectorAll('.process-stage').forEach(el => {
    el.classList.toggle('active', el.getAttribute('onclick').includes("'" + currentStage + "'"));
  });
  onMESDateChange();
}

function selectStage(stage) {
  if (typeof TabMES !== 'undefined') { TabMES.selectStage(stage); return; }
  document.querySelectorAll('.process-stage').forEach(el => {
    const isThis = el.getAttribute('onclick').includes("'" + stage + "'");
    el.classList.toggle('active', isThis);
  });
  currentStage = stage;
  renderStepDashboard(stage);
  applyBatchFilters();
}

function searchBatches() { applyBatchFilters(); }

function filterBatches() { applyBatchFilters(); }

// === Mương tích lũy mủ bọt/đáy hồ ===
var _coagAccumData = null;
async function loadCoagAccumulation() {
  var card = document.getElementById('coagAccumulationCard');
  if (!card) return;
  var factory = typeof TabMES !== 'undefined' ? (TabMES.getCurrentWorkspace && TabMES.getCurrentWorkspace() ? TabMES.getCurrentWorkspace() : '') : '';
  var ws = factory; // workspace id
  factory = document.getElementById('factorySelector')?.value || '';
  var lineGroup = '';
  if (typeof SanxuatStages !== 'undefined') {
    var workspaces = SanxuatStages.WORKSPACE_CONFIG[factory] || [];
    var wsObj = workspaces.find(function(w) { return w.id === ws; });
    if (wsObj) lineGroup = wsObj.lineGroup || ws;
  }
  if (!lineGroup) lineGroup = ws || 'muNuoc';
  if (!factory) { card.style.display = 'none'; return; }
  var docId = factory + '_' + lineGroup;
  try {
    var doc = await db.collection('coagulumStorage').doc(docId).get();
    _coagAccumData = doc.exists ? Object.assign({ id: doc.id }, doc.data()) : null;
    renderCoagAccumCard();
  } catch (e) {
    console.error('Error loading coag accumulation:', e);
    card.style.display = 'none';
  }
}

function renderCoagAccumCard() {
  var card = document.getElementById('coagAccumulationCard');
  if (!card) return;
  var data = _coagAccumData;
  if (!data || data.totalKl <= 0) { card.style.display = 'none'; return; }
  card.style.display = '';
  var target = parseFloat(document.getElementById('paramKLMoiMuong')?.value) || 3700;
  var pct = Math.min(100, (data.totalKl / target * 100)).toFixed(0);
  var bar = document.getElementById('coagAccumBar');
  var text = document.getElementById('coagAccumText');
  var hint = document.getElementById('coagAccumHint');
  var status = document.getElementById('coagAccumStatus');
  var btn = document.getElementById('btnCreateSVR5');
  if (bar) bar.style.width = pct + '%';
  if (text) text.textContent = formatNumber(data.totalKl) + ' / ' + formatNumber(target) + ' kg';
  if (status) {
    if (data.status === 'day' || data.totalKl >= target) {
      status.textContent = '\u0110\u1ea7y';
      status.style.background = 'rgba(239,68,68,0.15)';
      status.style.color = '#ef4444';
    } else {
      status.textContent = '\u0110ang t\u00edch l\u0169y';
      status.style.background = 'rgba(245,158,11,0.15)';
      status.style.color = '#f59e0b';
    }
  }
  if (hint) hint.textContent = 'Khu v\u1ef1c: ' + (data.lineGroup || '') + ' \u00b7 C\u1eadp nh\u1eadt: ' + (data.updatedAt ? data.updatedAt.substring(0, 10) : '');
  if (btn) btn.style.display = (data.totalKl >= target * 0.8) ? '' : 'none';
}

async function createSVR5FromAccum() {
  if (!_coagAccumData) return;
  if (!(await showConfirm('T\u1ea1o h\u1ed3 SVR 5 t\u1eeb m\u01b0\u01a1ng t\u00edch l\u0169y (' + formatNumber(_coagAccumData.totalKl) + ' kg)?'))) return;
  var factory = document.getElementById('factorySelector')?.value || '';
  var user = ErpDb.auth().currentUser;
  var date = new Date().toISOString().substring(0, 10);
  try {
    // Tạo batch SVR5
    var batchData = {
      batchNo: 'BDH-' + factory + '-' + date.replace(/-/g, '') + '-1',
      date: date,
      product: 'SVR5',
      processStage: 'xulymu',
      inputWeight: _coagAccumData.totalKl,
      outputWeight: 0,
      status: 'active',
      notes: 'T\u1eeb m\u01b0\u01a1ng t\u00edch l\u0169y m\u1ee7 b\u1ecdt/\u0111\u00e1y h\u1ed3',
      factory: factory,
      lineGroup: _coagAccumData.lineGroup || '',
      sourceCoagAccumId: _coagAccumData.id,
      createdAt: ErpDb.firestore.FieldValue.serverTimestamp(),
      createdBy: user ? user.uid : null,
      updatedAt: ErpDb.firestore.FieldValue.serverTimestamp(),
      updatedBy: user ? user.uid : null
    };
    await db.collection('productionBatches').add(batchData);
    // Reset mương tích lũy
    await db.collection('coagulumStorage').doc(_coagAccumData.id).update({
      totalKl: 0,
      status: 'tich_luy',
      updatedAt: new Date().toISOString(),
      updatedBy: user ? user.uid : null
    });
    showToast('T\u1ea1o h\u1ed3 SVR 5 th\u00e0nh c\u00f4ng!');
    _coagAccumData = null;
    renderCoagAccumCard();
    if (typeof TabMES !== 'undefined') TabMES.loadBatches();
  } catch (e) {
    console.error('Error creating SVR5 batch:', e);
    showToast('L\u1ed7i t\u1ea1o h\u1ed3: ' + e.message, 'error');
  }
}

function openBatchModal(id) { TabMES.openBatchModal(id); }

function closeBatchModal() { TabMES.closeBatchModal(); }

async function populateBatchSourceTank(selectedId) { await TabMES.populateBatchSourceTank(selectedId); }

function onBatchDateChange() {
  var batchId = document.getElementById('batchId')?.value || '';
  var dateVal = document.getElementById('batchDate')?.value || '';
  // Cập nhật mã hồ theo ngày mới (chỉ khi tạo mới và chưa chọn hồ phối liệu)
  if (!batchId && dateVal) {
    var tankSelect = document.getElementById('batchSourceTank');
    var hasTank = tankSelect && tankSelect.value;
    if (!hasTank) {
      var dp = dateVal.split('-');
      var batchNoEl = document.getElementById('batchNo');
      if (batchNoEl) {
        batchNoEl.value = 'H00/01_' + dp[2] + '/' + dp[1] + '/' + dp[0].slice(2);
      }
    }
  }
  populateBatchSourceTank('');
}

function editBatch(id) {
  openBatchModal(id);
}

async function saveBatch() {
  // Check if we're saving a line record or a batch
  var lineRecordId = document.getElementById('lineRecordId');
  var lineRecordFields = document.getElementById('lineRecordFields');
  if (lineRecordFields && lineRecordFields.style.display !== 'none') {
    await TabMES.saveLineRecord();
  } else {
    await TabMES.saveBatch();
  }
}

async function deleteBatch(id) { await TabMES.deleteBatch(id); }

// Line record wrapper functions
async function deleteLineRecord(id) { await TabMES.deleteLineRecord(id); }
async function advanceLineRecord(id) { await TabMES.advanceLineRecord(id); }
async function revertLineRecord(id) { await TabMES.revertLineRecord(id); }
async function completeLineRecord(id) { await TabMES.completeLineRecord(id); }
function createLineRecordFromStep() { TabMES.createLineRecordFromStep(); }

async function editLineRecordAtStage(recordId, stage) {
  await TabMES.openLineRecordModal(recordId);
  // Modal is now fully initialized — lineRecordId, dcLine, date are all set
  var stageEl = document.getElementById('batchStage');
  if (stageEl) stageEl.value = stage;
  if (window.toggleStageParams) window.toggleStageParams();
  // Generate canmu muong rows for line records
  if (stage === 'canmu') {
    generateCanmuMuongRowsForLineRecord(recordId);
  }
  // Load existing stage params
  var rec = (window.lineRecords || []).find(function(r) { return r.id === recordId; });
  if (rec && rec.stageData && rec.stageData[stage] && rec.stageData[stage].params) {
    if (window.populateStageParams) window.populateStageParams(rec.stageData[stage].params, stage);
    if (stage === 'canmu' && rec.stageData[stage].params.canmuChannels) {
      loadCanmuMuongData(rec.stageData[stage].params.canmuChannels);
    }
  }
  if (rec && rec.stageData && rec.stageData[stage] && window.loadShiftData) {
    window.loadShiftData(rec.stageData[stage], stage);
  }
  if (stage === 'say' && rec && rec.stageData && rec.stageData.say) {
    if (window.initOvenSelect) window.initOvenSelect();
    if (window.loadOvenData) window.loadOvenData(rec.stageData.say);
  }
}

function generateCanmuMuongRowsForLineRecord(recordId) {
  var container = document.getElementById('canmuMuongContainer');
  if (!container) return;

  // Get mu\u01A1ng numbers from checkboxes (if modal open) or from saved record
  var muongNumbers = [];
  var checkedBoxes = document.querySelectorAll('#lineRecordMuongsContainer input[type=checkbox]:checked');
  if (checkedBoxes.length > 0) {
    checkedBoxes.forEach(function(cb) {
      var n = parseInt(cb.value);
      if (!isNaN(n)) muongNumbers.push(n);
    });
  } else if (recordId) {
    var rec = (window.lineRecords || []).find(function(r) { return r.id === recordId; });
    if (rec && rec.muongNumbers) muongNumbers = rec.muongNumbers;
  }

  if (muongNumbers.length === 0) {
    container.innerHTML = '<div class="param-hint" style="margin-top:8px;">Ch\u01B0a ch\u1ECDn m\u01B0\u01A1ng c\u00E1n</div>';
    container.dataset.channelCount = '0';
    return;
  }

  // Preserve existing time values keyed by mu\u01A1ng number before rebuild
  var savedTimes = {};
  var oldOrder = [];
  try { oldOrder = JSON.parse(container.dataset.muongOrder || '[]'); } catch(e) {}
  oldOrder.forEach(function(m, idx) {
    var bdEl = document.getElementById('canBD_' + idx);
    var ktEl = document.getElementById('canKT_' + idx);
    if (bdEl || ktEl) {
      savedTimes[m] = {
        bd: bdEl ? bdEl.value : '',
        kt: ktEl ? ktEl.value : ''
      };
    }
  });

  // Look up tgCanDuKien for each mu\u01A1ng from available data
  var muongData = window._availableMuongData || [];
  var channels = muongNumbers.map(function(m) {
    var md = muongData.find(function(d) { return d.muong === m; });
    return { muong: m, tgCanDuKien: md ? md.tgCanDuKien : null, batchNo: md ? md.batchNo : '' };
  });
  // Sort by estimated canning time (tgCanDuKien), muongs without time go last
  channels.sort(function(a, b) {
    if (!a.tgCanDuKien && !b.tgCanDuKien) return a.muong - b.muong;
    if (!a.tgCanDuKien) return 1;
    if (!b.tgCanDuKien) return -1;
    if (a.tgCanDuKien === b.tgCanDuKien) return a.muong - b.muong;
    return a.tgCanDuKien < b.tgCanDuKien ? -1 : 1;
  });

  var html = '<div class="stage-params-title" style="margin-top:12px;font-size:13px;">TG c\u00E1n th\u1EF1c t\u1EBF theo m\u01B0\u01A1ng (' + channels.length + ' m\u01B0\u01A1ng)</div>';
  html += '<table class="muong-ph-table"><thead><tr>';
  html += '<th style="width:90px;">M\u01B0\u01A1ng</th><th>TG b\u1EAFt \u0111\u1EA7u c\u00E1n</th><th>TG k\u1EBFt th\u00FAc c\u00E1n</th><th style="width:70px;">D\u1EF1 ki\u1EBFn</th>';
  html += '</tr></thead><tbody>';
  channels.forEach(function(ch, idx) {
    var duKienHtml = ch.tgCanDuKien
      ? '<span style="font-size:12px;color:var(--text-muted);">' + ch.tgCanDuKien + '</span>'
      : '<span style="color:var(--text-muted);">\u2014</span>';
    // Restore previously entered time if exists
    var prevBD = savedTimes[ch.muong] ? savedTimes[ch.muong].bd : '';
    var prevKT = savedTimes[ch.muong] ? savedTimes[ch.muong].kt : '';
    html += '<tr>';
    html += '<td style="font-weight:600;">M\u01B0\u01A1ng ' + ch.muong + '</td>';
    html += '<td><input type="text" id="canBD_' + idx + '" maxlength="5" placeholder="HH:MM" ' +
      'value="' + prevBD + '" ' +
      'oninput="maskTime24(this);_checkCanmuTimeWarning(this,' + idx + ');_validateCanmuTimeOverlap()" ' +
      'data-tgdukien="' + (ch.tgCanDuKien || '') + '" data-muong="' + ch.muong + '" style="text-align:center;"></td>';
    html += '<td><input type="text" id="canKT_' + idx + '" maxlength="5" placeholder="HH:MM" ' +
      'value="' + prevKT + '" oninput="maskTime24(this);_validateCanmuTimeOverlap()" ' +
      'data-muong="' + ch.muong + '" style="text-align:center;"></td>';
    html += '<td>' + duKienHtml + '</td>';
    html += '</tr>';
    html += '<tr id="canmuWarning_' + idx + '" style="display:none;"><td colspan="4">' +
      '<div style="padding:2px 8px;font-size:12px;color:#f59e0b;background:rgba(245,158,11,0.08);border-radius:4px;">' +
      '\u26A0 Th\u1EDDi gian c\u00E1n s\u1EDBm h\u01A1n d\u1EF1 ki\u1EBFn (' + (ch.tgCanDuKien || '') + ')' +
      '</div></td></tr>';
  });
  html += '</tbody></table>';

  // Hi\u1EC3n TG c\u00E1n c\u1EE7a phi\u1EBFu kh\u00E1c c\u00F9ng DC + ng\u00E0y (gi\u00FAp tr\u00E1nh tr\u00F9ng)
  // Use recordId param (reliable) with DOM fallback (may be empty due to async race)
  var currentRecId = recordId || (document.getElementById('lineRecordId') || {}).value || '';
  var dcLine = (document.getElementById('lineRecordDCLine') || {}).value || '';
  var prodDate = (document.getElementById('lineRecordProductionDate') || {}).value || '';
  var otherSlots = [];
  if (dcLine && prodDate) {
    (window.lineRecords || []).forEach(function(rec) {
      if (rec.id === currentRecId) return;
      if (rec.productionLine !== dcLine || rec.date !== prodDate) return;
      var chs = rec.stageData?.canmu?.params?.canmuChannels || [];
      chs.forEach(function(ch) {
        if (ch.tgBatDau && _isValidTime24(ch.tgBatDau)) {
          otherSlots.push({ muong: ch.muong, bd: ch.tgBatDau, kt: _isValidTime24(ch.tgKetThuc) ? ch.tgKetThuc : '?', rec: rec.recordCode || rec.shift || '' });
        }
      });
    });
  }
  if (otherSlots.length > 0) {
    otherSlots.sort(function(a, b) { return a.bd < b.bd ? -1 : 1; });
    html += '<div style="margin-top:6px;padding:6px 10px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:6px;font-size:12px;color:var(--text-secondary);">';
    html += '<span style="font-weight:600;color:#f59e0b;">TG \u0111\u00E3 d\u00F9ng (phi\u1EBFu kh\u00E1c c\u00F9ng DC):</span> ';
    otherSlots.forEach(function(s, i) {
      if (i > 0) html += ' \u00B7 ';
      html += 'M' + s.muong + ' ' + s.bd + '\u2013' + s.kt;
    });
    html += '</div>';
  }

  html += '<div class="param-hint" style="margin-top:4px;">Ph\u1EA3i k\u1EBFt th\u00FAc c\u00E1n m\u01B0\u01A1ng n\u00E0y m\u1EDBi \u0111\u01B0\u1EE3c c\u00E1n m\u01B0\u01A1ng ti\u1EBFp theo (kh\u00F4ng tr\u00F9ng TG c\u00F9ng DC)</div>';
  container.innerHTML = html;
  container.dataset.channelCount = channels.length;
  container.dataset.muongOrder = JSON.stringify(channels.map(function(ch) { return ch.muong; }));
}

// ==================== LINE RECORD MODAL POPULATE ====================

/**
 * Populate shift dropdown from admin catalog (categoryDepartments type='ca_sx')
 */
async function _populateLineRecordShifts(selectedShift) {
  var shiftSelect = document.getElementById('lineRecordShift');
  if (!shiftSelect) return;

  var shifts = [];
  if (typeof _getSXShiftsFromAdmin === 'function') {
    shifts = await _getSXShiftsFromAdmin();
  }

  shiftSelect.innerHTML = '<option value="">-- Ch\u1ECDn ca --</option>';
  shifts.forEach(function(s) {
    var opt = document.createElement('option');
    opt.value = s.code;
    opt.textContent = s.name;
    shiftSelect.appendChild(opt);
  });

  if (selectedShift) {
    shiftSelect.value = selectedShift;
  }
}

/**
 * Populate mu\u01A1ng checkboxes from t\u1EA1o \u0111\u00F4ng batches for the selected taodong date.
 * Reads date from lineRecordTaodongDate input.
 * @param {Array<number>} selectedMuongs - Pre-selected mu\u01A1ng numbers (for editing)
 */
function _populateLineRecordBatchInfo(rec) {
  var infoDiv = document.getElementById('lineRecordBatchInfo');
  if (!infoDiv) return;
  if (!rec || !rec.linkedBatches || rec.linkedBatches.length === 0) {
    infoDiv.style.display = 'none';
    infoDiv.innerHTML = '';
    return;
  }
  var products = [];
  var channelDetails = []; // {muong, klTuoi, klKho, batchNo, product}
  rec.linkedBatches.forEach(function(lb) {
    var bRef = (window.batches || []).find(function(x) { return x.id === lb.batchId; });
    if (!bRef) return;
    if (bRef.product && products.indexOf(bRef.product) === -1) products.push(bRef.product);
    var chs = bRef.stageData?.taodong?.params?.channels || bRef.techParams?.channels || [];
    chs.forEach(function(ch) {
      if (lb.muongs.indexOf(ch.muong) !== -1) {
        channelDetails.push({ muong: ch.muong, klTuoi: ch.klTuoi || 0, klKho: ch.klKho || 0, batchNo: lb.batchNo, product: bRef.product || '' });
      }
    });
  });
  channelDetails.sort(function(a, b) { return a.muong - b.muong; });
  var html = '';
  // Lo\u1EA1i m\u1EE7
  if (products.length > 0) {
    html += '<div style="margin-bottom:6px;display:flex;gap:6px;align-items:center;">';
    html += '<span style="font-size:12px;font-weight:600;color:var(--text-secondary);">Lo\u1EA1i m\u1EE7:</span>';
    products.forEach(function(p) {
      html += '<span style="padding:2px 10px;border-radius:4px;font-size:13px;font-weight:700;background:rgba(34,197,94,0.15);color:#22c55e;border:1px solid rgba(34,197,94,0.3);">' + p + '</span>';
    });
    html += '</div>';
  }
  // M\u01B0\u01A1ng t\u1EA1o \u0111\u00F4ng chi ti\u1EBFt
  if (channelDetails.length > 0) {
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">';
    html += '<span style="font-size:12px;font-weight:600;color:var(--text-secondary);">M\u01B0\u01A1ng:</span>';
    channelDetails.forEach(function(ch) {
      var klText = ch.klTuoi > 0 ? formatNumber(ch.klTuoi) + ' kg' : '';
      html += '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.3);border-radius:6px;font-size:12px;">';
      html += '<b style="color:#a78bfa;">M' + ch.muong + '</b>';
      if (klText) html += '<span style="color:var(--text-secondary);">' + klText + '</span>';
      html += '<span style="font-size:12px;color:var(--text-muted);">' + ch.batchNo + '</span>';
      html += '</span>';
    });
    html += '</div>';
  }
  infoDiv.innerHTML = html;
  infoDiv.style.display = html ? '' : 'none';
}

async function _populateLineRecordMuongs(selectedMuongs) {
  var container = document.getElementById('lineRecordMuongsContainer');
  if (!container) return;

  selectedMuongs = selectedMuongs || [];

  // Read date from the dedicated taodong date input
  var dateStr = (document.getElementById('lineRecordTaodongDate') || {}).value || '';
  if (!dateStr) {
    container.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:4px 0;">Ch\u1ECDn ng\u00E0y t\u1EA1o \u0111\u00F4ng tr\u01B0\u1EDBc</div>';
    window._availableMuongData = [];
    return;
  }

  // Search for batches matching the exact taodong date
  var allBatches = window.batches || [];
  var availableMuongs = _extractMuongsFromBatches(allBatches, dateStr);

  // Fallback: query Firestore directly if window.batches doesn't have batches for this date
  if (availableMuongs.length === 0 && typeof ErpDb !== 'undefined') {
    try {
      container.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:4px 0;">\u0110ang t\u1EA3i d\u1EEF li\u1EC7u...</div>';
      var factory = window.currentFactory;
      var snap = await ErpDb.firestore().collection('productionBatches')
        .where('factory', '==', factory)
        .where('date', '==', dateStr)
        .get();
      var fsBatches = [];
      snap.forEach(function(doc) { fsBatches.push(Object.assign({ id: doc.id }, doc.data())); });
      if (fsBatches.length > 0) {
        availableMuongs = _extractMuongsFromBatches(fsBatches, dateStr);
      }
    } catch (e) { console.warn('[MuongPopulate] Firestore fallback error:', e); }
  }

  // Sort by mu\u01A1ng number
  availableMuongs.sort(function(a, b) { return a.muong - b.muong; });

  // Store for timing function
  window._availableMuongData = availableMuongs;

  // Find muongs already assigned to OTHER records (same taodong date, any DC line)
  var currentRecordId = (document.getElementById('lineRecordId') || {}).value || '';
  var usedByOtherRecord = {};
  (window.lineRecords || []).forEach(function(rec) {
    if (rec.id === currentRecordId) return; // skip self
    var recTdDate = rec.taodongDate || rec.date || '';
    if (recTdDate !== dateStr) return; // different taodong date
    (rec.muongNumbers || []).forEach(function(m) {
      usedByOtherRecord[m] = rec.productionLine || '?';
    });
  });

  if (availableMuongs.length === 0) {
    container.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:4px 0;">Kh\u00F4ng t\u00ECm th\u1EA5y m\u01B0\u01A1ng t\u1EEB T\u1EA1o \u0110\u00F4ng ng\u00E0y ' + dateStr + '</div>';
    return;
  }

  // Auto-select all available muongs when no specific selection provided (new record or date change)
  var autoSelectAll = selectedMuongs.length === 0;

  // Render checkboxes — hide muongs already assigned to other records
  var html = '';
  availableMuongs.forEach(function(md) {
    if (usedByOtherRecord[md.muong]) return; // already assigned to another record
    var isChecked = autoSelectAll || selectedMuongs.indexOf(md.muong) !== -1;
    var bg = isChecked ? 'rgba(16,185,129,0.15)' : 'var(--bg-tertiary)';
    var border = isChecked ? 'var(--success)' : 'var(--border)';
    html += '<label style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;' +
      'background:' + bg + ';border:1px solid ' + border + ';border-radius:6px;cursor:pointer;font-size:12px;user-select:none;">' +
      '<input type="checkbox" value="' + md.muong + '"' + (isChecked ? ' checked' : '') +
      ' onchange="_onLineRecordMuongChange()" style="accent-color:var(--success);margin:0;">' +
      '<span style="font-weight:600;">M' + md.muong + '</span>' +
      '<span style="color:var(--text-muted);font-size:12px;">' + md.batchNo + '</span>' +
      '</label>';
  });
  if (!html) {
    container.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:4px 0;">T\u1EA5t c\u1EA3 m\u01B0\u01A1ng \u0111\u00E3 \u0111\u01B0\u1EE3c ghi nh\u1EADn trong phi\u1EBFu kh\u00E1c</div>';
    return;
  }
  container.innerHTML = html;

  // Sync hidden input
  _syncMuongHiddenInput();
}

/**
 * Extract available mu\u01A1ngs from batches matching a specific date.
 * @param {Array} batches - Array of batch objects
 * @param {string} dateStr - Target date (YYYY-MM-DD)
 * @returns {Array} availableMuongs [{muong, batchId, batchNo, tgCanDuKien}]
 */
function _extractMuongsFromBatches(batches, dateStr) {
  var availableMuongs = [];
  batches.forEach(function(batch) {
    // Only include batches that have completed taodong
    if (batch.status !== 'taodong_done' && batch.status !== 'completed') return;

    var bDate = batch.date;
    if (bDate && bDate.toDate) bDate = bDate.toDate();
    if (bDate instanceof Date) {
      bDate = bDate.getFullYear() + '-' + String(bDate.getMonth() + 1).padStart(2, '0') + '-' + String(bDate.getDate()).padStart(2, '0');
    }
    if (typeof bDate === 'string' && bDate !== dateStr) return;

    var channels = [];
    if (batch.stageData && batch.stageData.taodong && batch.stageData.taodong.params && batch.stageData.taodong.params.channels) {
      channels = batch.stageData.taodong.params.channels;
    } else if (batch.techParams && batch.techParams.channels) {
      channels = batch.techParams.channels;
    }
    if (channels.length === 0) return;

    var tgCanDuKien = '';
    if (batch.stageData && batch.stageData.taodong && batch.stageData.taodong.params) {
      tgCanDuKien = batch.stageData.taodong.params.paramTGCanDuKien || '';
    }
    if (!tgCanDuKien && batch.techParams) {
      tgCanDuKien = batch.techParams.paramTGCanDuKien || '';
    }

    channels.forEach(function(ch) {
      if (ch.muong) {
        if (!availableMuongs.some(function(a) { return a.muong === ch.muong; })) {
          availableMuongs.push({
            muong: ch.muong,
            batchId: batch.id,
            batchNo: batch.batchNo || batch.id,
            tgCanDuKien: tgCanDuKien
          });
        }
      }
    });
  });
  return availableMuongs;
}

/** Sync checked mu\u01A1ng checkboxes to hidden input */
function _syncMuongHiddenInput() {
  var hiddenInput = document.getElementById('lineRecordMuongs');
  if (!hiddenInput) return;
  var checked = document.querySelectorAll('#lineRecordMuongsContainer input[type=checkbox]:checked');
  var nums = [];
  checked.forEach(function(cb) { nums.push(cb.value); });
  hiddenInput.value = nums.join(', ');
}

/** Handle mu\u01A1ng checkbox change: update styles + timing table */
function _onLineRecordMuongChange() {
  _syncMuongHiddenInput();

  // Update checkbox label styles
  document.querySelectorAll('#lineRecordMuongsContainer label').forEach(function(label) {
    var cb = label.querySelector('input[type=checkbox]');
    if (cb && cb.checked) {
      label.style.background = 'rgba(16,185,129,0.15)';
      label.style.borderColor = 'var(--success)';
    } else {
      label.style.background = 'var(--bg-tertiary)';
      label.style.borderColor = 'var(--border)';
    }
  });

  // If canmu stage is active in modal, update timing table
  var stageEl = document.getElementById('batchStage');
  if (stageEl && stageEl.value === 'canmu') {
    var recordId = (document.getElementById('lineRecordId') || {}).value || '';
    generateCanmuMuongRowsForLineRecord(recordId);
  }

  // Refresh trolley muong dropdowns to match checked muongs
  var tbody = document.getElementById('trolleyMappingBody');
  if (tbody) {
    var newOpts = getTrolleyMuongOptions();
    tbody.querySelectorAll('select[id^="tMuong_"]').forEach(function(sel) {
      var curVal = sel.value;
      sel.innerHTML = newOpts;
      sel.value = curVal; // restore selection if still valid
    });
  }
}

/** Check if c\u00E1n start time is earlier than expected, show warning */
function _checkCanmuTimeWarning(inputEl, idx) {
  var warningRow = document.getElementById('canmuWarning_' + idx);
  if (!warningRow) return;
  var tgDuKien = inputEl.dataset.tgdukien;
  if (!tgDuKien) { warningRow.style.display = 'none'; return; }
  var inputTime = inputEl.value;
  if (!inputTime || inputTime.length < 5) { warningRow.style.display = 'none'; return; }
  if (inputTime < tgDuKien) {
    warningRow.style.display = '';
  } else {
    warningRow.style.display = 'none';
  }
}

/**
 * Validate canmu time ranges:
 * 1) end > start for each channel
 * 2) No overlap within current record (sequential canning)
 * 3) No overlap with OTHER records on same date + DC line
 * Returns true if valid, false if overlap detected.
 */
function _validateCanmuTimeOverlap() {
  var container = document.getElementById('canmuMuongContainer');
  if (!container) return true;
  var count = parseInt(container.dataset.channelCount) || 0;
  if (count === 0) return true;

  // Remove old overlap banner
  var oldBanner = document.getElementById('canmuOverlapBanner');
  if (oldBanner) oldBanner.remove();

  // Collect current record's time ranges
  var ranges = [];
  for (var i = 0; i < count; i++) {
    var bdEl = document.getElementById('canBD_' + i);
    var ktEl = document.getElementById('canKT_' + i);
    var bd = bdEl ? bdEl.value : '';
    var kt = ktEl ? ktEl.value : '';
    var muong = bdEl ? (bdEl.dataset.muong || '') : '';
    // Reset style
    if (bdEl) bdEl.style.borderColor = '';
    if (ktEl) ktEl.style.borderColor = '';

    // Validate time format
    var bdValid = _isValidTime24(bd);
    var ktValid = _isValidTime24(kt);
    if (bd && !bdValid) {
      if (bdEl) bdEl.style.borderColor = '#ef4444';
      _showCanmuOverlapBanner('M\u01B0\u01A1ng ' + muong + ': TG b\u1EAFt \u0111\u1EA7u kh\u00F4ng h\u1EE3p l\u1EC7 (' + bd + ')');
      return false;
    }
    if (kt && !ktValid) {
      if (ktEl) ktEl.style.borderColor = '#ef4444';
      _showCanmuOverlapBanner('M\u01B0\u01A1ng ' + muong + ': TG k\u1EBFt th\u00FAc kh\u00F4ng h\u1EE3p l\u1EC7 (' + kt + ')');
      return false;
    }
    // Check end <= start
    if (bdValid && ktValid) {
      if (kt <= bd) {
        if (ktEl) ktEl.style.borderColor = '#ef4444';
        if (bdEl) bdEl.style.borderColor = '#ef4444';
        _showCanmuOverlapBanner('M\u01B0\u01A1ng ' + muong + ': TG k\u1EBFt th\u00FAc ph\u1EA3i sau TG b\u1EAFt \u0111\u1EA7u');
        return false;
      }
    }
    if (bdValid) {
      ranges.push({ idx: i, muong: muong, bd: bd, kt: ktValid ? kt : null, source: 'current' });
    }
  }

  // Collect time ranges from OTHER records on same date + DC line
  var currentRecId = (document.getElementById('lineRecordId') || {}).value || '';
  var dcLine = (document.getElementById('lineRecordDCLine') || {}).value || '';
  var prodDate = (document.getElementById('lineRecordProductionDate') || {}).value || '';
  if (dcLine && prodDate) {
    (window.lineRecords || []).forEach(function(rec) {
      if (rec.id === currentRecId) return;
      if (rec.productionLine !== dcLine) return;
      if (rec.date !== prodDate) return;
      var chs = rec.stageData?.canmu?.params?.canmuChannels || [];
      chs.forEach(function(ch) {
        if (ch.tgBatDau && _isValidTime24(ch.tgBatDau)) {
          ranges.push({ idx: -1, muong: 'M' + ch.muong + ' (' + (rec.recordCode || rec.shift || '') + ')',
            bd: ch.tgBatDau, kt: _isValidTime24(ch.tgKetThuc) ? ch.tgKetThuc : null, source: 'other' });
        }
      });
    });
  }

  // Sort all ranges by start time
  ranges.sort(function(a, b) { return a.bd < b.bd ? -1 : (a.bd > b.bd ? 1 : 0); });

  // Check overlap: next start must be >= previous end
  for (var j = 1; j < ranges.length; j++) {
    var prev = ranges[j - 1];
    var curr = ranges[j];
    if (prev.kt && curr.bd < prev.kt) {
      // Highlight current record's inputs if involved
      if (prev.source === 'current') {
        var bdE1 = document.getElementById('canBD_' + prev.idx);
        var ktE1 = document.getElementById('canKT_' + prev.idx);
        if (bdE1) bdE1.style.borderColor = '#ef4444';
        if (ktE1) ktE1.style.borderColor = '#ef4444';
      }
      if (curr.source === 'current') {
        var bdE2 = document.getElementById('canBD_' + curr.idx);
        if (bdE2) bdE2.style.borderColor = '#ef4444';
      }
      var msg = prev.source === 'other' || curr.source === 'other'
        ? 'Tr\u00F9ng TG v\u1EDBi phi\u1EBFu kh\u00E1c c\u00F9ng DC: ' + prev.muong + ' (' + prev.bd + '\u2013' + (prev.kt || '?') + ') \u2194 ' + curr.muong + ' (' + curr.bd + ')'
        : 'M\u01B0\u01A1ng ' + prev.muong + ' v\u00E0 M\u01B0\u01A1ng ' + curr.muong + ' tr\u00F9ng TG. Ph\u1EA3i k\u1EBFt th\u00FAc m\u01B0\u01A1ng n\u00E0y m\u1EDBi c\u00E1n m\u01B0\u01A1ng kh\u00E1c.';
      _showCanmuOverlapBanner(msg);
      return false;
    }
  }
  return true;
}

function _showCanmuOverlapBanner(msg) {
  var container = document.getElementById('canmuMuongContainer');
  if (!container) return;
  var banner = document.getElementById('canmuOverlapBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'canmuOverlapBanner';
    banner.style.cssText = 'padding:6px 10px;margin-top:6px;font-size:12px;color:#ef4444;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:6px;';
    container.appendChild(banner);
  }
  banner.textContent = '\u26A0 ' + msg;
}

// Reuse _validateCanmuTimeOverlap which now returns false on overlap
function _hasCanmuTimeOverlap() {
  return !_validateCanmuTimeOverlap();
}

function exportBatches() {
  if (batches.length === 0) {
    showToast('Không có dữ liệu để xuất', 'warning');
    return;
  }

  const paramLabels = {
    paramDRC:'DRC(%)', paramTSC:'TSC(%)', paramNH3:'NH3(%)', paramPH:'pH', paramLoaiMu:'Loại mủ', paramNgoaiQuan:'Ngoại quan',
    paramDRCTruoc:'DRC trước(%)', paramDRCSau:'DRC sau(%)', paramPHTruocPL:'pH trước PL', paramPHSauPL:'pH sau PL', paramLoaiHCCatMach:'HC cắt mạch', paramKLHCCatMach:'KL HC(kg)', paramNuocPhaLoang:'Nước pha(L)', paramNa2S2O5:'Na2S2O5(kg)', paramMeshLoc:'Mesh lọc',
    paramSoMuong:'Số mương', paramLoaiAxit:'Loại axit', paramNongDoAxit:'Nồng độ axit(%)',
    paramTGBatDauMuong:'TG bắt đầu mương', paramTGKetThucMuong:'TG kết thúc mương', paramTGCanDuKien:'TG cán dự kiến',
    paramDayCanKeo:'Dày cán kéo(mm)', paramKheCan1:'Khe cán 1(mm)', paramKheCan2:'Khe cán 2(mm)', paramKheCan3:'Khe cán 3(mm)', paramDayTruocBam:'Dày trước bằm(mm)',
    paramKichThuocHat:'KT hạt(mm)', paramChieuSauBon:'Sâu bồn(cm)', paramKLHoc:'KL hộc(kg)', paramTGXepHoc:'TG xếp hộc', paramTGDeRao:'TG ráo(h)',
    paramNhienLieu:'Nhiên liệu', paramNhietDoSay:'Nhiệt độ sấy(°C)', paramSoThungSayDC:'Thùng sấy DC', paramSoThungTrongLo:'Thùng trong lò',
    paramNhietDoNguoi:'Nhiệt độ nguội(°C)', paramKhoiLuongBanh:'KL bành(kg)', paramKichThuocBanh:'KT bành(mm)', paramThoiGianEp:'TG ép(s)', paramTyLeKiemTra:'Tỷ lệ KT(%)',
    paramPhanHang:'Phân hạng', paramSoLuongBanh:'SL bành', paramViTriKho:'Vị trí kho', paramGhiNhanStatus:'Ghi nhãn',
    paramHAS:'HAS(kg/tấn)', paramMooneyBanDau:'Mooney ban đầu', paramHASDong:'HAS đông(kg)', paramMooneyDong:'Mooney đông',
    paramPPMooney:'PP Mooney', paramDBD:'DBD(kg)', paramMooneySay:'Mooney sấy', paramMooneyTarget:'Mooney mục tiêu',
    paramPhanHangBD:'Phân hạng ban đầu', paramGiongCay:'Giống cây', paramMauSacMu:'Màu sắc mủ NL', paramTGTiepNhan:'TG tiếp nhận(h)',
    paramMauSacSay:'Màu sắc sau sấy', paramKQSauSay:'KQ kiểm tra sau sấy'
  };
  const data = batches.map(b => {
    const row = {
      'Số Hồ': b.batchNo,
      'Ngày': formatDate(b.date),
      'Sản Phẩm': b.product,
      'Công Đoạn': getStageText(b.processStage, b.product),
      'NL Đầu Vào (kg)': b.inputWeight,
      'Sản Lượng (kg)': b.outputWeight,
      'Hiệu Suất (%)': b.inputWeight > 0 ? ((b.outputWeight || 0) / b.inputWeight * 100).toFixed(1) : 0,
      'Trạng Thái': b.status === 'completed' ? 'Hoàn thành' : 'Đang xử lý',
      'Ghi Chú': b.notes
    };
    if (b.techParams) {
      Object.entries(b.techParams).forEach(([k,v]) => {
        if (typeof v !== 'object') row[paramLabels[k] || k] = v;
      });
    }
    // Oven data from stageData.say
    const sd = b.stageData?.say;
    if (sd?.ovenId) {
      const ovens = OVEN_CONFIG[currentFactory] || [];
      const oven = ovens.find(o => o.id === sd.ovenId);
      row['Lò sấy'] = oven ? oven.name : sd.ovenId;
    }
    if (sd?.trolleyDrying) row['Thùng sấy'] = sd.trolleyDrying.map(t => '#' + t.trolleyNo + '(' + (t.timeIn||'') + '-' + (t.timeOut||'') + ')').join(', ');
    if (sd?.tempLog && sd.tempLog.length > 0) {
      const b1 = sd.tempLog.filter(t => t.burner1 != null).map(t => t.burner1);
      const b2 = sd.tempLog.filter(t => t.burner2 != null).map(t => t.burner2);
      if (b1.length > 0) row['Nhiệt ĐĐ1(°C)'] = Math.min(...b1) + '–' + Math.max(...b1);
      if (b2.length > 0) row['Nhiệt ĐĐ2(°C)'] = Math.min(...b2) + '–' + Math.max(...b2);
    }
    return row;
  });

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Lô Sản Xuất');
  XLSX.writeFile(wb, `LoSanXuat_${getFactoryShortName()}_${new Date().toISOString().slice(0,10)}.xlsx`);
  showToast('Đã xuất file Excel!');
}

// ============================================
// TAB 4: QUALITY TESTS (KCS/Lab)
// ============================================
    function loadTests() { TabQuality.loadTests(); }




    function searchTests() { TabQuality.searchTests(); }

    function filterTests() { TabQuality.filterTests(); }

    function openTestModal(id) { TabQuality.openTestModal(id); }

    function toggleTestFieldsByBatch() { TabQuality.toggleTestFieldsByBatch(); }

    function closeTestModal() { TabQuality.closeTestModal(); }

    function editTest(id) { TabQuality.editTest(id); }

    function saveTest() { TabQuality.saveTest(); }

    function deleteTest(id) { TabQuality.deleteTest(id); }

    function exportTests() { TabQuality.exportTests(); }

// ============================================
// TAB 5: WAREHOUSE
// ============================================
    function loadWarehouse() { TabWarehouse.loadWarehouse(); }




    function openWarehouseModal(id) { TabWarehouse.openWarehouseModal(id); }

    function closeWarehouseModal() { TabWarehouse.closeWarehouseModal(); }

    function editWarehouse(id) { TabWarehouse.editWarehouse(id); }

    function saveWarehouse() { TabWarehouse.saveWarehouse(); }

    function deleteWarehouse(id) { TabWarehouse.deleteWarehouse(id); }

    function exportInventory() { TabWarehouse.exportInventory(); }


// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  function mergeSessionIntoUser(profile, session) {
    if (!profile) profile = {};
    if (!session) return profile;
    var sessionIsAdmin = session.role === 'admin' || session.isSuperAdmin === true;
    var profileRole = profile.role || profile.erp_role || 'user';
    var role = sessionIsAdmin ? 'admin' : (session.role || profileRole);
    var pos = profile.position_name || profile.positionName || profile.position
      || session.position_name || session.positionName || session.position || '';
    return Object.assign({}, profile, {
      username: profile.username || session.username,
      name: profile.name || profile.hoTen || session.name || session.displayName,
      hoTen: profile.hoTen || profile.name || session.name,
      role: role,
      erp_role: role,
      position: pos,
      position_name: pos,
      positionName: pos,
      systemRoles: (session.systemRoles && session.systemRoles.length)
        ? session.systemRoles
        : (profile.systemRoles || []),
      isSuperAdmin: session.isSuperAdmin === true || profile.isSuperAdmin === true,
      appRolesCache: profile.appRolesCache || profile.app_roles_cache || session.appRolesCache || {}
    });
  }

  function updateSanxuatUserHeader() {
    var u = currentUser || window.currentUser;
    if (!u) return;
    var nameEl = document.getElementById('userName');
    var avatarEl = document.getElementById('userAvatar');
    if (!nameEl) return;
    var displayName = u.hoTen || u.name || u.username || 'User';
    var roleBadge = '';
    var sxEntry = (u.appRolesCache || u.app_roles_cache || {}).sanxuat;
    var sxRoles = sxEntry && (sxEntry.roles || (sxEntry.role ? [sxEntry.role] : []));
    if (sxRoles && sxRoles.length) {
      var sxRoleLabels = {
        admin: 'Quản trị SX', manager: 'Quản lý SX', supervisor: 'Giám sát',
        team_leader: 'Đội trưởng', doi_truong: 'Đội trưởng CN', staff: 'Nhập liệu cân mủ', viewer: 'Xem'
      };
      roleBadge = sxRoleLabels[sxRoles[0]] || sxRoles[0];
    }
    if (typeof Permissions !== 'undefined' && Permissions.isGlobalAdmin && Permissions.isGlobalAdmin(u)) {
      roleBadge = 'Admin';
    } else if (!roleBadge && u.role && String(u.role).toLowerCase() !== 'user') {
      var roleMap = { admin: 'Admin', vpp: 'Quản lý', manager: 'Quản lý hệ thống' };
      roleBadge = roleMap[String(u.role).toLowerCase()] || u.role;
    }
    if (!roleBadge && u.isSuperAdmin) roleBadge = 'Admin';
    if (!roleBadge && u.systemRoles && u.systemRoles.length) {
      var sr = String(u.systemRoles[0]);
      if (/super.?admin/i.test(sr)) roleBadge = 'Admin';
      else if (/department.?head/i.test(sr)) roleBadge = 'Lãnh đạo';
    }
    nameEl.textContent = displayName + (roleBadge ? ' · ' + roleBadge : '');
    if (avatarEl) avatarEl.textContent = (displayName.trim()[0] || 'U').toUpperCase();
  }

  async function applyUserPermissions() {
    if (!currentUser) return;
    try {
      Permissions.initFromUserData(currentUser);
      if (typeof navigator !== 'undefined' && navigator.onLine !== false) {
        await Permissions.loadRoleDefinitions(db);
        await Permissions.loadPositionBasedRoles(db);
      }
      Permissions.mergePositionRolesIntoCache();
    } catch (e) { console.warn('Permissions init:', e.message); }
    updateSanxuatUserHeader();
    if (typeof RrivAppBar !== 'undefined' && RrivAppBar.refresh) {
      RrivAppBar.refresh(currentUser);
    }
    try {
      window.dispatchEvent(new CustomEvent('rriv:user-updated', { detail: currentUser }));
    } catch (e) { /* ignore */ }
  }

  function bootApp(_firebaseUser) {
    var sessionUser = (typeof Auth !== 'undefined' && Auth.restoreSession && Auth.restoreSession()) || _firebaseUser;
    if (!sessionUser) {
      window.location.href = 'index.html';
      return;
    }
    try {
      const storedUser = localStorage.getItem('currentUser');
      if (storedUser) {
        currentUser = mergeSessionIntoUser(JSON.parse(storedUser), sessionUser);
      } else {
        currentUser = mergeSessionIntoUser({}, sessionUser);
      }
      const personnelId = sessionUser.uid || sessionUser.id || currentUser?.id;
      const online = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;

      var finishBoot = function () {
        window.currentUser = currentUser;
        window.currentFactory = currentFactory;
        window.showToast = showToast;
        window.formatDate = formatDate;
        window.formatDateVN = formatDateVN;
        window.formatNumber = formatNumber;
        window.generateCode = generateCode;

        if (currentUser) {
          updateSanxuatUserHeader();
          try { initFactorySelector(); } catch (_) { /* ignore */ }
          applyUserPermissions().then(function () {
            initFactorySelector();
            window.currentFactory = currentFactory;
          });
        }

        _getSXShiftsFromAdmin().catch(function() {});

        setTimeout(function () {
          if (typeof showTab === 'function') showTab(0);
        }, 0);

        var openHarvest = !online || window.location.hash === '#harvest' ||
          localStorage.getItem('sanxuat_open_harvest') === '1';
        if (openHarvest && typeof showTab === 'function') {
          setTimeout(function () { showTab(1); }, 150);
        }
      };

      if (!currentUser) {
        currentUser = mergeSessionIntoUser({
          id: personnelId || sessionUser.uid || sessionUser.id,
          uid: personnelId || sessionUser.uid || sessionUser.id,
          name: sessionUser.displayName || sessionUser.name
        }, sessionUser);
      }
      finishBoot();

      var profilePromise = Promise.resolve();
      if (sessionUser.username && typeof Auth !== 'undefined' && Auth.loadUserProfile) {
        profilePromise = Auth.loadUserProfile(sessionUser.username).then(function () {
          var prof = Auth.getProfile && Auth.getProfile();
          if (prof) {
            currentUser = mergeSessionIntoUser(prof, sessionUser);
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            updateSanxuatUserHeader();
          }
        }).catch(function () { /* offline */ });
      }

      profilePromise.then(function () {
        if (personnelId && online) {
          return db.collection('categoryPersonnel').doc(personnelId).get().then(function (personnelDoc) {
            if (personnelDoc.exists) {
              currentUser = mergeSessionIntoUser(
                { id: personnelDoc.id, uid: personnelDoc.id, ...personnelDoc.data() },
                sessionUser
              );
              localStorage.setItem('currentUser', JSON.stringify(currentUser));
              updateSanxuatUserHeader();
              applyUserPermissions().then(function () {
                initFactorySelector();
                window.currentFactory = currentFactory;
              });
            }
          }).catch(function () { /* offline */ });
        }
      });
    } catch (error) {
      console.error('Init error:', error);
      showToast('Lỗi khởi tạo ứng dụng', 'error');
    }
  }

  auth.onAuthStateChanged(async (user) => {
    bootApp(user);
  });
});
