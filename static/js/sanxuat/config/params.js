/**
 * Parameter Labels - 178 thông số kỹ thuật sản xuất cao su
 * Mapping từ field ID → tên hiển thị tiếng Việt
 * @module SanxuatParams
 */

const SanxuatParams = (function() {
  'use strict';

  const PARAM_LABELS = {
    // === Tiếp nhận ===
    paramDRC:'DRC (%)', paramTSC:'TSC (%)', paramNH3:'NH₃ (%)', paramPH:'pH',
    paramLoaiMu:'Loại mủ', paramNgoaiQuan:'Ngoại quan',
    paramPhanHangBD:'Phân hạng BĐ', paramGiongCay:'Giống cây',
    paramMauSacMu:'Màu sắc mủ', paramTGTiepNhan:'TG tiếp nhận',
    paramNguonTonTru:'Nguồn tồn trữ',

    // === Xử lý mủ ===
    paramDRCTruoc:'DRC trước pha loãng (%)', paramDRCSau:'DRC sau pha loãng (%)',
    paramNuocPhaLoang:'Nước pha loãng (L)', paramNa2S2O5:'Na₂S₂O₅ (kg)',
    paramMeshLoc:'Mesh lọc',

    // === Tạo đông ===
    paramSoMuong:'Số mương tạo đông', paramLoaiAxit:'Loại axit',
    paramNongDoAxit:'Nồng độ axit (%)',
    paramTGBatDauMuong:'TG bắt đầu xuống mương',
    paramTGKetThucMuong:'TG kết thúc xuống mương',
    paramTGCanDuKien:'TG cán dự kiến',

    // === Cán mủ ===
    paramDayCanKeo:'Dày cán kéo (mm)', paramKheCan1:'Khe cán 1 (mm)',
    paramKheCan2:'Khe cán 2 (mm)', paramKheCan3:'Khe cán 3 (mm)',
    paramDayTruocBam:'Dày trước bằm (mm)',

    // === Tạo hạt ===
    paramKichThuocHat:'Kích thước hạt (mm)', paramChieuSauBon:'Chiều sâu bồn (cm)',
    paramKLHoc:'KL mỗi hộc (kg)', paramTGXepHoc:'TG xếp hộc xong',
    paramTGDeRao:'TG để ráo (h)',

    // === Sấy ===
    paramNhienLieu:'Nhiên liệu', paramNhietDoSay:'Nhiệt độ sấy (°C)',
    paramThoiGianSay:'TG sấy (h)', paramSoThungSay:'Số thùng sấy',

    // === Ép bành ===
    paramNhietDoNguoi:'Nhiệt độ nguội (°C)', paramKhoiLuongBanh:'KL bành (kg)',
    paramKichThuocBanh:'Kích thước bành (mm)', paramThoiGianEp:'TG ép (s)',
    paramTyLeKiemTra:'Tỷ lệ KT (%)',

    // === Bao gói ===
    paramPhanHang:'Phân hạng', paramSoLuongBanh:'Số lượng bành',
    paramViTriKho:'Vị trí kho', paramGhiNhanStatus:'Ghi nhãn',

    // === CV specific (TCCS 103) ===
    paramHAS:'HAS (kg/tấn)', paramMooneyBanDau:'Mooney BĐ',
    paramHASDong:'HAS đông (kg)', paramMooneyDong:'Mooney đông',
    paramMooneySay:'Mooney sấy', paramMooneyTarget:'Mooney mục tiêu',
    paramPPMooney:'PP giảm Mooney', paramDBD:'DBD (kg)',
    paramMauSacSay:'Màu sắc sấy', paramKQSauSay:'KQ sau sấy',

    // === Latex specific (TCCS 107) ===
    paramVFA_LT:'VFA (%)', paramMg_LT:'Mg (%)', paramTGTiepNhan_LT:'TG từ cạo (h)',
    paramNH3BoSung:'NH₃ bổ sung (%)', paramMg_PL:'Mg trước xử lý (%)',
    paramDAHP:'DAHP (kg)', paramThoiGianKhuay:'TG khuấy (ph)',
    paramThoiGianLang:'TG lắng (h)', paramNH3_Lang:'NH₃ trước ly tâm (%)',
    paramVFA_Lang:'VFA trước ly tâm (%)', paramMg_Lang:'Mg trước ly tâm (%)',
    paramMeshLocLT:'Mesh lọc LT', paramThoiGianVS:'Chu kỳ VS (h)',
    paramDRC_LT:'DRC ly tâm (%)', paramTSC_LT:'TSC ly tâm (%)',
    paramHieuSuatLT:'Hiệu suất LT (%)',
    paramMeshLocHC:'Mesh lọc HC', paramNH3_HC:'NH₃ hoàn chỉnh (%)',
    paramAmoniLaurat:'Amoni laurat (%)', paramTMTD:'TMTD (%)',
    paramZnO:'ZnO (%)', paramThoiGianKhuay_HC:'TG khuấy HC (ph)',
    paramSoBonTC:'Bồn trung chuyển', paramTSC_TC:'TSC TC (%)',
    paramDRC_TC:'DRC TC (%)', paramNH3_TC:'NH₃ TC (%)',
    paramVFA_TC:'VFA TC (%)', paramKOH_TC:'KOH TC (%)',
    paramMST_TC:'MST TC (%)', paramMg_TC:'Mg TC (%)',
    paramSoBonTT:'Bồn tồn trữ', paramNgaySinhNhat:'Ngày sinh bồn',
    paramTSC_TT:'TSC TT (%)', paramDRC_TT:'DRC TT (%)',
    paramNH3_TT:'NH₃ TT (%)', paramVFA_TT:'VFA TT (%)',
    paramKOH_TT:'KOH TT (%)', paramMST_TT:'MST TT (%)',
    paramThoiGianTonTru:'TG tồn trữ (ngày)', paramCan:'Cặn (%)',
    paramDongKet:'Đông kết (%)', paramCu:'Cu (ppm)', paramMn:'Mn (ppm)'
  };

  /**
   * Get label for a parameter
   * @param {string} paramId - Parameter field ID
   * @returns {string} Vietnamese label or paramId as fallback
   */
  function getLabel(paramId) {
    return PARAM_LABELS[paramId] || paramId;
  }

  /**
   * Check if param exists
   */
  function has(paramId) {
    return paramId in PARAM_LABELS;
  }

  return {
    PARAM_LABELS,
    getLabel,
    has
  };
})();
