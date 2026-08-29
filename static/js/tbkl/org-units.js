/* org-units.js — Danh mục đơn vị TBKL (Viện: 2 PVT, 2 phòng NV, 3 trung tâm) */
(function () {
  'use strict';

  var DEPUTIES = [
    { id: 'pvt-hieu', label: 'Phó Viện trưởng Nguyễn Đôn Hiệu', kind: 'deputy' },
    { id: 'pvt-pha', label: 'Phó Viện trưởng Trần Ánh Pha', kind: 'deputy' }
  ];

  var OFFICES = [
    { id: 'dl-5', label: 'Phòng khoa học công nghệ', kind: 'office' },
    { id: 'dl-6', label: 'Phòng quản trị - tài chính kế toán', kind: 'office' }
  ];

  var CENTERS = [
    { id: 'dl-2', label: 'Trung tâm nghiên cứu phát triển sản phẩm mới', kind: 'center' },
    { id: 'dl-3', label: 'Trung tâm nghiên cứu phát triển Giống cao su', kind: 'center' },
    {
      id: 'dl-4',
      label: 'Trung tâm nghiên cứu ứng dụng nông nghiệp công nghệ cao và chuyển giao kỹ thuật',
      kind: 'center'
    }
  ];

  var ALL_UNITS = {
    id: 'all-units',
    label: 'Các đơn vị (phối hợp nhiều đơn vị)',
    kind: 'all'
  };

  function allShared() {
    return DEPUTIES.concat(OFFICES, CENTERS);
  }

  function allExecutors() {
    return OFFICES.concat(CENTERS);
  }

  function allDirectiveExecutors() {
    return OFFICES.concat(CENTERS, [ALL_UNITS]);
  }

  function findInList(list, id) {
    return list.find(function (u) { return u.id === id; }) || null;
  }

  function findById(id) {
    if (!id) return null;
    return findInList(allShared(), id)
      || findInList(allExecutors(), id)
      || findInList([ALL_UNITS], id);
  }

  function findByLabel(label) {
    var s = String(label || '').trim();
    if (!s) return null;
    var lists = [allShared(), allDirectiveExecutors()];
    for (var i = 0; i < lists.length; i++) {
      var hit = lists[i].find(function (u) { return u.label === s; });
      if (hit) return hit;
    }
    if (/các đơn vị/i.test(s) || /cac don vi/i.test(s)) return ALL_UNITS;
    return null;
  }

  function resolveId(idOrLabel) {
    var hit = findById(idOrLabel);
    if (hit) return hit.id;
    hit = findByLabel(idOrLabel);
    return hit ? hit.id : '';
  }

  function labelFor(idOrLabel) {
    var hit = findById(idOrLabel) || findByLabel(idOrLabel);
    return hit ? hit.label : String(idOrLabel || '').trim();
  }

  function optionsHtml(list, selectedId, placeholder) {
    var html = '<option value="">' + (placeholder || '— Chọn —') + '</option>';
    list.forEach(function (u) {
      var sel = selectedId === u.id ? ' selected' : '';
      html += '<option value="' + u.id + '" data-label="' + u.label.replace(/"/g, '&quot;') + '"' + sel + '>' +
        u.label + '</option>';
    });
    return html;
  }

  function fillSelect(selectEl, list, value, placeholder) {
    if (!selectEl) return;
    var id = resolveId(value) || '';
    if (!id && value) {
      var custom = document.createElement('option');
      custom.value = '__legacy__';
      custom.textContent = String(value);
      custom.selected = true;
      selectEl.innerHTML = optionsHtml(list, '', placeholder);
      selectEl.appendChild(custom);
      return;
    }
    selectEl.innerHTML = optionsHtml(list, id, placeholder);
  }

  window.TbklOrgUnits = {
    deputies: DEPUTIES,
    offices: OFFICES,
    centers: CENTERS,
    sharedResponsibility: allShared,
    executors: allExecutors,
    directiveExecutors: allDirectiveExecutors,
    allUnits: ALL_UNITS,
    findById: findById,
    findByLabel: findByLabel,
    resolveId: resolveId,
    labelFor: labelFor,
    optionsHtml: optionsHtml,
    fillSelect: fillSelect
  };
})();
