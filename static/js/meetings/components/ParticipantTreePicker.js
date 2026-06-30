/**
 * ParticipantTreePicker.js — chọn người tham dự theo cây tổ chức + nhân sự ngoài
 */
(function () {
  'use strict';

  var ORG = window.PhonghopOrg;

  function escapeHtml(s) {
    return ORG.esc(s);
  }

  function externalKey(ext) {
    return String(ext.external_email || ext.external_name || '').trim().toLowerCase();
  }

  window.ParticipantTreePicker = {
    /**
     * @param {string} hostId
     * @param {{ orgData, onChange }} options
     */
    create: function (hostId, options) {
      options = options || {};
      var host = document.getElementById(hostId);
      if (!host) return null;

      var orgData = options.orgData || { personnel: [], departments: [], teams: [] };
      var tree = ORG.buildOrgTree(orgData);
      var expanded = { root: true };
      var selectedIds = {};
      var externals = [];
      var searchTerm = '';
      var onChange = options.onChange || null;
      var destroyed = false;

      function notify() {
        if (typeof onChange === 'function') onChange(getParticipants());
      }

      function getParticipants() {
        var internal = Object.keys(selectedIds).filter(function (id) { return selectedIds[id]; }).map(function (id) {
          var p = orgData.personnel.find(function (x) { return x.id === id; });
          return {
            employee_id: id,
            username: p && p.username ? String(p.username).trim().toLowerCase() : null,
            participant_role: 'participant',
            is_external: false
          };
        });
        var external = externals.map(function (e) {
          return {
            is_external: true,
            external_name: e.external_name,
            external_email: e.external_email,
            participant_role: 'participant'
          };
        });
        return internal.concat(external);
      }

      function setParticipants(list) {
        selectedIds = {};
        externals = [];
        (list || []).forEach(function (p) {
          if (p.is_external) {
            externals.push({
              external_name: p.external_name || p.display_name || '',
              external_email: p.external_email || ''
            });
          } else if (p.employee_id) {
            selectedIds[p.employee_id] = true;
          }
        });
        render();
        notify();
      }

      function togglePerson(id, checked) {
        if (checked) selectedIds[id] = true;
        else delete selectedIds[id];
        renderTags();
        updateGroupCheckboxes();
        notify();
      }

      function setGroupSelection(node, checked) {
        var ids = ORG.collectPersonIds(node, []);
        ids.forEach(function (id) {
          if (checked) selectedIds[id] = true;
          else delete selectedIds[id];
        });
        renderTags();
        updateGroupCheckboxes();
        notify();
      }

      function groupCheckState(node) {
        var ids = ORG.collectPersonIds(node, []);
        if (!ids.length) return 'none';
        var n = 0;
        ids.forEach(function (id) { if (selectedIds[id]) n++; });
        if (n === 0) return 'none';
        if (n === ids.length) return 'all';
        return 'some';
      }

      function updateGroupCheckboxes() {
        host.querySelectorAll('input[data-group-id]').forEach(function (cb) {
          var id = cb.getAttribute('data-group-id');
          var node = findGroupNode(tree, id);
          if (!node) return;
          var st = groupCheckState(node);
          cb.checked = st === 'all';
          cb.indeterminate = st === 'some';
        });
        host.querySelectorAll('input[data-person-id]').forEach(function (cb) {
          cb.checked = !!selectedIds[cb.getAttribute('data-person-id')];
        });
      }

      function findGroupNode(node, id) {
        if (!node) return null;
        if ((node.type === 'department' || node.type === 'team' || node.type === 'group' || node.type === 'root') && node.id === id) {
          return node;
        }
        var found = null;
        (node.children || []).some(function (c) {
          found = findGroupNode(c, id);
          return !!found;
        });
        return found;
      }

      function personMatchesSearch(node) {
        if (!searchTerm) return true;
        if (node.type !== 'person') return false;
        var p = node.person || {};
        var hay = [
          node.label, p.employeeCode, p.code, p.username, p.email, p.phone
        ].filter(Boolean).join(' ').toLowerCase();
        return hay.indexOf(searchTerm) >= 0;
      }

      function nodeVisible(node) {
        if (!searchTerm) return true;
        if (node.type === 'person') return personMatchesSearch(node);
        return (node.children || []).some(nodeVisible);
      }

      function renderNode(node, depth) {
        if (!nodeVisible(node)) return '';

        var hasChildren = node.children && node.children.length > 0;
        var isExpanded = expanded[node.id] !== false && (expanded[node.id] || node.type === 'root');
        if (searchTerm) isExpanded = true;

        if (node.type === 'person') {
          var checked = selectedIds[node.id] ? ' checked' : '';
          var ico = node.icon && node.icon !== '👤'
            ? '<span class="ph-ptree-person-ico">' + escapeHtml(node.icon) + '</span>'
            : '';
          return '<label class="ph-ptree-person" style="padding-left:' + (depth * 14 + 8) + 'px">' +
            '<input type="checkbox" data-person-id="' + escapeHtml(node.id) + '"' + checked + '>' +
            ico +
            '<span class="ph-ptree-person-name">' + escapeHtml(node.label) + '</span>' +
            (node.meta ? '<span class="ph-ptree-person-meta">' + escapeHtml(node.meta) + '</span>' : '') +
            '</label>';
        }

        var twist = hasChildren
          ? '<button type="button" class="ph-ptree-twist' + (isExpanded ? ' open' : '') + '" data-expand="' + escapeHtml(node.id) + '">▶</button>'
          : '<span class="ph-ptree-twist-sp"></span>';

        var groupCb = '';
        if (node.type !== 'root' && hasChildren) {
          groupCb = '<input type="checkbox" class="ph-ptree-group-cb" data-group-id="' + escapeHtml(node.id) + '" title="Chọn tất cả">';
        }

        var html = '<div class="ph-ptree-node" data-node-id="' + escapeHtml(node.id) + '">' +
          '<div class="ph-ptree-row" style="padding-left:' + (depth * 14) + 'px">' +
          twist + groupCb +
          '<span class="ph-ptree-ico">' + escapeHtml(node.icon || '') + '</span>' +
          '<span class="ph-ptree-lbl">' + escapeHtml(node.label) + '</span>' +
          (hasChildren ? '<span class="ph-ptree-cnt">' + ORG.collectPersonIds(node, []).length + '</span>' : '') +
          '</div>';

        if (hasChildren) {
          html += '<div class="ph-ptree-children' + (isExpanded ? ' open' : '') + '">';
          node.children.forEach(function (c) { html += renderNode(c, depth + 1); });
          html += '</div>';
        }
        html += '</div>';
        return html;
      }

      function renderTags() {
        var box = host.querySelector('#phPickerTags');
        if (!box) return;
        var tags = [];

        Object.keys(selectedIds).forEach(function (id) {
          if (!selectedIds[id]) return;
          var p = orgData.personnel.find(function (x) { return x.id === id; });
          var name = p ? ORG.personName(p) : id;
          tags.push('<span class="ph-tag">' + escapeHtml(name) +
            ' <button type="button" data-rm-int="' + escapeHtml(id) + '" aria-label="Xóa">&times;</button></span>');
        });

        externals.forEach(function (e, idx) {
          var label = e.external_name + (e.external_email ? ' (' + e.external_email + ')' : '');
          tags.push('<span class="ph-tag ph-tag-ext">🌐 ' + escapeHtml(label) +
            ' <button type="button" data-rm-ext="' + idx + '" aria-label="Xóa">&times;</button></span>');
        });

        box.innerHTML = tags.length
          ? tags.join('')
          : '<span class="ph-tags-hint">Chưa chọn người tham dự</span>';
      }

      function renderShell() {
        var count = orgData.personnel.filter(function (p) { return !p.disabled; }).length;
        host.innerHTML =
          '<div class="ph-picker-wrap">' +
            '<div class="ph-part-toolbar">' +
              '<span class="ph-part-label">Người tham dự (' + count + ' nhân sự)</span>' +
              '<div class="ph-part-actions">' +
                '<button type="button" class="ph-part-btn" id="phPickerExpand">⊕ Mở tất cả</button>' +
                '<button type="button" class="ph-part-btn" id="phPickerCollapse">⊖ Đóng</button>' +
                '<button type="button" class="ph-part-btn" id="phBtnExcel">📥 Excel</button>' +
                '<input type="file" id="phExcelInput" accept=".xlsx,.xls,.csv" hidden>' +
              '</div>' +
            '</div>' +
            '<input type="search" class="ph-picker-search" id="phPickerSearch" placeholder="Tìm tên, mã NV, username, email...">' +
            '<div class="ph-ptree-scroll" id="phPickerTree"></div>' +
            '<div class="ph-picker-external">' +
              '<div class="ph-picker-ext-head"><span>🌐 Nhân sự ngoài</span></div>' +
              '<div class="ph-picker-ext-form">' +
                '<input type="text" id="phExtName" placeholder="Họ và tên" class="ph-ext-input">' +
                '<input type="email" id="phExtEmail" placeholder="Email (bắt buộc)" class="ph-ext-input">' +
                '<button type="button" class="ph-part-btn" id="phExtAdd">+ Thêm</button>' +
              '</div>' +
            '</div>' +
            '<div id="phPickerTags" class="ph-tags"></div>' +
          '</div>';
      }

      function render() {
        if (destroyed) return;
        var treeEl = host.querySelector('#phPickerTree');
        if (!treeEl) {
          renderShell();
          bindStaticEvents();
          treeEl = host.querySelector('#phPickerTree');
        }
        treeEl.innerHTML = renderNode(tree, 0);
        bindTreeEvents();
        renderTags();
        updateGroupCheckboxes();
      }

      function bindStaticEvents() {
        var expandBtn = host.querySelector('#phPickerExpand');
        var collapseBtn = host.querySelector('#phPickerCollapse');
        var searchInput = host.querySelector('#phPickerSearch');
        var extAdd = host.querySelector('#phExtAdd');
        var btnExcel = host.querySelector('#phBtnExcel');
        var fileInput = host.querySelector('#phExcelInput');

        if (expandBtn) {
          expandBtn.addEventListener('click', function () {
            function walk(n) { expanded[n.id] = true; (n.children || []).forEach(walk); }
            walk(tree);
            render();
          });
        }
        if (collapseBtn) {
          collapseBtn.addEventListener('click', function () {
            expanded = { root: true };
            render();
          });
        }
        if (searchInput) {
          searchInput.addEventListener('input', function () {
            searchTerm = searchInput.value.trim().toLowerCase();
            render();
          });
        }
        if (extAdd) {
          extAdd.addEventListener('click', addExternalFromForm);
        }
        if (btnExcel && fileInput) {
          btnExcel.addEventListener('click', function () { fileInput.click(); });
          fileInput.addEventListener('change', function () {
            if (fileInput.files && fileInput.files[0]) {
              importExcel(fileInput.files[0]);
              fileInput.value = '';
            }
          });
        }
      }

      function addExternalFromForm() {
        var nameEl = host.querySelector('#phExtName');
        var emailEl = host.querySelector('#phExtEmail');
        var name = (nameEl && nameEl.value || '').trim();
        var email = (emailEl && emailEl.value || '').trim().toLowerCase();
        if (!name) {
          alert('Nhập họ tên nhân sự ngoài.');
          return;
        }
        if (!email) {
          alert('Nhân sự ngoài cần có email.');
          return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          alert('Email không hợp lệ.');
          return;
        }
        var key = (email || name).toLowerCase();
        if (externals.some(function (e) { return externalKey(e) === key; })) {
          alert('Người này đã có trong danh sách.');
          return;
        }
        externals.push({ external_name: name, external_email: email });
        if (nameEl) nameEl.value = '';
        if (emailEl) emailEl.value = '';
        renderTags();
        notify();
      }

      function importExcel(file) {
        if (typeof XLSX === 'undefined') {
          alert('Thư viện Excel chưa được nạp');
          return;
        }
        var reader = new FileReader();
        reader.onload = function (ev) {
          try {
            var wb = XLSX.read(ev.target.result, { type: 'array' });
            var sheet = wb.Sheets[wb.SheetNames[0]];
            var rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
            var SVC = window.PhonghopServices;
            var matched = 0;
            var missed = [];
            rows.forEach(function (row) {
              var keys = Object.keys(row || {});
              var token = '';
              keys.forEach(function (k) {
                var kl = k.toLowerCase();
                var v = String(row[k] || '').trim();
                if (!v) return;
                if (/username|tài khoản|tai khoan|user/.test(kl)) token = token || v;
                if (/mã nv|ma nv|employee|manv|code/.test(kl)) token = token || v;
                if (/email|mail/.test(kl)) token = token || v;
              });
              if (!token) {
                var vals = keys.map(function (k) { return String(row[k] || '').trim(); }).filter(Boolean);
                token = vals[0] || '';
              }
              var emp = SVC.findEmployeeByToken(
                orgData.personnel.map(function (p) {
                  return {
                    id: p.id,
                    username: p.username,
                    email: p.email,
                    employeeCode: p.employeeCode || p.code,
                    fullName: ORG.personName(p)
                  };
                }),
                token
              );
              if (emp) {
                selectedIds[emp.id] = true;
                matched++;
              } else if (token) {
                missed.push(token);
              }
            });
            render();
            var msg = 'Đã thêm ' + matched + ' người từ Excel.';
            if (missed.length) {
              msg += '\nKhông khớp: ' + missed.slice(0, 8).join(', ') +
                (missed.length > 8 ? '… (+' + (missed.length - 8) + ')' : '');
            }
            alert(msg);
          } catch (err) {
            alert(err.message || 'Lỗi import Excel');
          }
        };
        reader.readAsArrayBuffer(file);
      }

      function bindTreeEvents() {
        host.querySelectorAll('[data-expand]').forEach(function (btn) {
          btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var id = btn.getAttribute('data-expand');
            expanded[id] = !expanded[id];
            render();
          });
        });

        host.querySelectorAll('input[data-person-id]').forEach(function (cb) {
          cb.addEventListener('change', function () {
            togglePerson(cb.getAttribute('data-person-id'), cb.checked);
          });
        });

        host.querySelectorAll('input[data-group-id]').forEach(function (cb) {
          cb.addEventListener('change', function () {
            var node = findGroupNode(tree, cb.getAttribute('data-group-id'));
            if (node) setGroupSelection(node, cb.checked);
          });
        });

        host.querySelectorAll('#phPickerTags button[data-rm-int]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            togglePerson(btn.getAttribute('data-rm-int'), false);
            render();
          });
        });

        host.querySelectorAll('#phPickerTags button[data-rm-ext]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var idx = parseInt(btn.getAttribute('data-rm-ext'), 10);
            externals.splice(idx, 1);
            renderTags();
            notify();
          });
        });
      }

      function setOrgData(data) {
        orgData = data || { personnel: [], departments: [], teams: [] };
        tree = ORG.buildOrgTree(orgData);
        render();
      }

      function destroy() {
        destroyed = true;
        if (host) host.innerHTML = '';
      }

      render();

      return {
        getParticipants: getParticipants,
        setParticipants: setParticipants,
        setOrgData: setOrgData,
        destroy: destroy
      };
    }
  };
})();
