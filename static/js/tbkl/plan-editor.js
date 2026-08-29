/* plan-editor.js — Bảng kế hoạch triển khai kết luận (mục lớn + đầu việc con) */
(function () {
  'use strict';

  function uid(prefix) {
    return (prefix || 'x') + Math.random().toString(36).slice(2, 10);
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function orgUnits() {
    return window.TbklOrgUnits || null;
  }

  function directiveCode(meetingSeq, dirIdx) {
    return 'H' + meetingSeq + '-' + String(dirIdx).padStart(2, '0');
  }

  function taskCode(meetingSeq, dirIdx, taskIdx) {
    return directiveCode(meetingSeq, dirIdx) + '-' + String(taskIdx).padStart(2, '0');
  }

  function emptyDirective() {
    return {
      _id: uid('d'),
      title: '',
      content: '',
      lead_department_id: '',
      lead_department_name: '',
      executor_unit_id: '',
      executor_unit_name: '',
      deliverable: '',
      supervisor_name: '',
      deadline: '',
      tasks: []
    };
  }

  function emptyTask() {
    return {
      _id: uid('t'),
      title: '',
      deliverable: '',
      owner_unit_id: '',
      owner_unit_name: '',
      deadline: ''
    };
  }

  function PlanEditor(container, options) {
    this.container = container;
    this.options = options || {};
    this.meetingSeq = options.meetingSeq || 1;
    this.directives = [emptyDirective()];
    this.render();
  }

  PlanEditor.prototype.setMeetingSeq = function (n) {
    var seq = parseInt(n, 10);
    if (!seq || seq < 1) seq = 1;
    this.meetingSeq = seq;
    this.render();
  };

  PlanEditor.prototype.reset = function () {
    this.directives = [emptyDirective()];
    this.render();
  };

  PlanEditor.prototype.loadPlan = function (plan) {
    var ou = orgUnits();
    var dirs = (plan && plan.directives) || [];
    if (!dirs.length) {
      this.reset();
      return;
    }
    this.directives = dirs.map(function (d) {
      var leadId = d.lead_department_id || (ou ? ou.resolveId(d.lead_department_name) : '');
      var leadName = d.lead_department_name || (ou ? ou.labelFor(leadId) : '');
      var execId = d.executor_unit_id || (ou ? ou.resolveId(d.executor_unit_name) : '');
      var execName = d.executor_unit_name || (ou ? ou.labelFor(execId) : '');
      return {
        _id: uid('d'),
        title: d.title || '',
        content: d.content || d.title || '',
        lead_department_id: leadId || '',
        lead_department_name: leadName || '',
        executor_unit_id: execId || '',
        executor_unit_name: execName || '',
        deliverable: d.deliverable || '',
        supervisor_name: d.supervisor_name || '',
        deadline: d.deadline || '',
        tasks: (d.tasks || []).map(function (t) {
          var ownerId = t.owner_unit_id || (ou ? ou.resolveId(t.owner_unit_name) : '');
          var ownerName = t.owner_unit_name || (ou ? ou.labelFor(ownerId) : '');
          return {
            _id: uid('t'),
            title: t.title || '',
            deliverable: t.deliverable || '',
            owner_unit_id: ownerId || '',
            owner_unit_name: ownerName || '',
            deadline: t.deadline || ''
          };
        })
      };
    });
    this.render();
  };

  PlanEditor.prototype.getPlan = function () {
    var ou = orgUnits();
    return {
      directives: this.directives.map(function (d) {
        var leadId = d.lead_department_id || (ou ? ou.resolveId(d.lead_department_name) : '');
        var leadName = ou ? ou.labelFor(leadId || d.lead_department_name) : (d.lead_department_name || '');
        if (leadId && String(leadId).indexOf('pvt-') === 0) {
          leadName = ou ? ou.labelFor(leadId) : leadName;
        }
        var execId = d.executor_unit_id || (ou ? ou.resolveId(d.executor_unit_name) : '');
        var execName = ou ? ou.labelFor(execId || d.executor_unit_name) : (d.executor_unit_name || '');
        return {
          title: (d.title || '').trim(),
          content: (d.content || d.title || '').trim(),
          lead_department_id: leadId && leadId !== '__legacy__' ? leadId : null,
          lead_department_name: (leadName || '').trim() || null,
          executor_unit_id: execId && execId !== '__legacy__' ? execId : null,
          executor_unit_name: (execName || '').trim() || null,
          deliverable: (d.deliverable || '').trim() || null,
          supervisor_name: (d.supervisor_name || '').trim() || null,
          deadline: d.deadline || null,
          tasks: (d.tasks || []).map(function (t) {
            var ownerId = t.owner_unit_id || (ou ? ou.resolveId(t.owner_unit_name) : '');
            var ownerName = ou ? ou.labelFor(ownerId || t.owner_unit_name) : (t.owner_unit_name || '');
            return {
              title: (t.title || '').trim(),
              deliverable: (t.deliverable || '').trim() || null,
              owner_unit_id: ownerId && ownerId !== '__legacy__' ? ownerId : null,
              owner_unit_name: (ownerName || '').trim() || null,
              deadline: t.deadline || null
            };
          }).filter(function (t) { return t.title; })
        };
      }).filter(function (d) { return d.title; })
    };
  };

  PlanEditor.prototype.addDirective = function () {
    this.directives.push(emptyDirective());
    this.render();
  };

  PlanEditor.prototype.addTask = function (dirId) {
    var dir = this.directives.find(function (d) { return d._id === dirId; });
    if (!dir) return;
    dir.tasks.push(emptyTask());
    this.render();
  };

  PlanEditor.prototype.removeDirective = function (dirId) {
    if (this.directives.length <= 1) {
      this.directives = [emptyDirective()];
    } else {
      this.directives = this.directives.filter(function (d) { return d._id !== dirId; });
    }
    this.render();
  };

  PlanEditor.prototype.removeTask = function (dirId, taskId) {
    var dir = this.directives.find(function (d) { return d._id === dirId; });
    if (!dir) return;
    dir.tasks = dir.tasks.filter(function (t) { return t._id !== taskId; });
    this.render();
  };

  PlanEditor.prototype._applySelect = function (el) {
    var ou = orgUnits();
    var kind = el.getAttribute('data-pe-kind');
    var dirId = el.getAttribute('data-pe-dir');
    var taskId = el.getAttribute('data-pe-task');
    var field = el.getAttribute('data-pe-field');
    var val = el.value;
    var label = '';
    if (el.selectedIndex >= 0) {
      var opt = el.options[el.selectedIndex];
      label = (opt && opt.dataset && opt.dataset.label) ? opt.dataset.label : (opt ? opt.textContent : '');
    }
    if (kind === 'directive') {
      var dir = this.directives.find(function (d) { return d._id === dirId; });
      if (!dir) return;
      if (field === 'lead_department_id') {
        dir.lead_department_id = val;
        dir.lead_department_name = val === '__legacy__' ? label : (ou ? ou.labelFor(val) : label);
        if (val && String(val).indexOf('pvt-') === 0) {
          dir.supervisor_name = dir.lead_department_name;
        }
        el.title = dir.lead_department_name || 'Trách nhiệm chung';
      } else if (field === 'executor_unit_id') {
        dir.executor_unit_id = val;
        dir.executor_unit_name = val === '__legacy__' ? label : (ou ? ou.labelFor(val) : label);
        el.title = dir.executor_unit_name || 'Đơn vị TH';
      } else {
        dir[field] = val;
      }
    } else if (kind === 'task') {
      var d2 = this.directives.find(function (d) { return d._id === dirId; });
      if (!d2) return;
      var task = d2.tasks.find(function (t) { return t._id === taskId; });
      if (!task) return;
      if (field === 'owner_unit_id') {
        task.owner_unit_id = val;
        task.owner_unit_name = val === '__legacy__' ? label : (ou ? ou.labelFor(val) : label);
        el.title = task.owner_unit_name || 'Đơn vị TH';
      } else {
        task[field] = val;
      }
    }
  };

  PlanEditor.prototype.bindInput = function () {
    var self = this;
    this.container.querySelectorAll('[data-pe-field]').forEach(function (el) {
      var evt = el.tagName === 'SELECT' ? 'change' : 'input';
      el.addEventListener(evt, function () {
        if (el.tagName === 'SELECT') {
          self._applySelect(el);
          return;
        }
        var kind = el.getAttribute('data-pe-kind');
        var dirId = el.getAttribute('data-pe-dir');
        var taskId = el.getAttribute('data-pe-task');
        var field = el.getAttribute('data-pe-field');
        if (kind === 'directive') {
          var dir = self.directives.find(function (d) { return d._id === dirId; });
          if (dir) {
            dir[field] = el.value;
            if (field === 'title') dir.content = el.value;
          }
        } else if (kind === 'task') {
          var d2 = self.directives.find(function (d) { return d._id === dirId; });
          if (d2) {
            var task = d2.tasks.find(function (t) { return t._id === taskId; });
            if (task) task[field] = el.value;
          }
        }
      });
    });

    this.container.querySelectorAll('[data-pe-action]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var action = btn.getAttribute('data-pe-action');
        var dirId = btn.getAttribute('data-pe-dir');
        var taskId = btn.getAttribute('data-pe-task');
        if (action === 'add-directive') self.addDirective();
        if (action === 'add-task') self.addTask(dirId);
        if (action === 'remove-directive') self.removeDirective(dirId);
        if (action === 'remove-task') self.removeTask(dirId, taskId);
      });
    });
  };

  function planTextarea(kind, attrs, field, placeholder, value, rows) {
    var r = rows || 3;
    var rowClass = r >= 4 ? ' tbkl-plan-text-xl' : (r >= 3 ? ' tbkl-plan-text-lg' : '');
    return '<textarea rows="' + r + '" class="tbkl-plan-text' + rowClass + '" data-pe-kind="' + kind + '" ' + attrs +
      ' data-pe-field="' + field + '" placeholder="' + escapeHtml(placeholder) + '">' +
      escapeHtml(value) + '</textarea>';
  }

  PlanEditor.prototype._sharedSelect = function (dir) {
    var ou = orgUnits();
    if (!ou) {
      return '<input type="text" data-pe-kind="directive" data-pe-dir="' + dir._id + '" data-pe-field="lead_department_name" ' +
        'placeholder="Trách nhiệm chung" value="' + escapeHtml(dir.lead_department_name) + '">';
    }
    var selId = dir.lead_department_id || ou.resolveId(dir.lead_department_name);
    var fullTitle = ou.labelFor(selId || dir.lead_department_name) || 'Trách nhiệm chung';
    return '<select data-pe-kind="directive" data-pe-dir="' + dir._id + '" data-pe-field="lead_department_id" ' +
      'class="tbkl-plan-select" title="' + escapeHtml(fullTitle) + '">' +
      ou.optionsHtml(ou.sharedResponsibility(), selId, '— TC chung —', true) + '</select>';
  };

  PlanEditor.prototype._directiveExecutorSelect = function (dir) {
    var ou = orgUnits();
    if (!ou) {
      return '<input type="text" data-pe-kind="directive" data-pe-dir="' + dir._id + '" data-pe-field="executor_unit_name" ' +
        'placeholder="Đơn vị TH" value="' + escapeHtml(dir.executor_unit_name) + '">';
    }
    var selId = dir.executor_unit_id || ou.resolveId(dir.executor_unit_name);
    var fullTitle = ou.labelFor(selId || dir.executor_unit_name) || 'Đơn vị TH';
    return '<select data-pe-kind="directive" data-pe-dir="' + dir._id + '" data-pe-field="executor_unit_id" ' +
      'class="tbkl-plan-select" title="' + escapeHtml(fullTitle) + '">' +
      ou.optionsHtml(ou.directiveExecutors(), selId, '— ĐV TH —', true) + '</select>';
  };

  PlanEditor.prototype._executorSelect = function (dir, task) {
    var ou = orgUnits();
    if (!ou) {
      return '<input type="text" data-pe-kind="task" data-pe-dir="' + dir._id + '" data-pe-task="' + task._id + '" ' +
        'data-pe-field="owner_unit_name" placeholder="Đơn vị TH" value="' + escapeHtml(task.owner_unit_name) + '">';
    }
    var selId = task.owner_unit_id || ou.resolveId(task.owner_unit_name);
    var fullTitle = ou.labelFor(selId || task.owner_unit_name) || 'Đơn vị TH';
    return '<select data-pe-kind="task" data-pe-dir="' + dir._id + '" data-pe-task="' + task._id + '" ' +
      'data-pe-field="owner_unit_id" class="tbkl-plan-select" title="' + escapeHtml(fullTitle) + '">' +
      ou.optionsHtml(ou.executors(), selId, '— ĐV TH —', true) + '</select>';
  };

  PlanEditor.prototype.render = function () {
    var self = this;
    var seq = this.meetingSeq;
    var html = '<div class="tbkl-plan-toolbar">' +
      '<button type="button" class="tbkl-btn tbkl-btn-sm tbkl-btn-outline" data-pe-action="add-directive">+ Mục kết luận lớn</button>' +
      '<span class="tbkl-plan-hint">Mã tự sinh: H' + seq + '-01, H' + seq + '-01-01…</span></div>';

    html += '<div class="tbkl-plan-table-wrap"><table class="tbkl-plan-table">' +
      '<colgroup>' +
      '<col class="tbkl-plan-col-code">' +
      '<col class="tbkl-plan-col-text">' +
      '<col class="tbkl-plan-col-sp">' +
      '<col class="tbkl-plan-col-lead">' +
      '<col class="tbkl-plan-col-unit">' +
      '<col class="tbkl-plan-col-date">' +
      '<col class="tbkl-plan-col-act">' +
      '</colgroup><thead><tr>' +
      '<th class="tbkl-plan-col-code">Mã</th>' +
      '<th class="tbkl-plan-col-text">Kết luận / Đầu việc</th>' +
      '<th class="tbkl-plan-col-sp">Sản phẩm</th>' +
      '<th class="tbkl-plan-col-lead">Trách nhiệm chung</th>' +
      '<th class="tbkl-plan-col-unit">Đơn vị TH</th>' +
      '<th class="tbkl-plan-col-date">Hạn</th><th class="tbkl-plan-col-act"></th>' +
      '</tr></thead><tbody>';

    this.directives.forEach(function (dir, di) {
      var dCode = directiveCode(seq, di + 1);
      var dirText = dir.title || dir.content || '';
      html += '<tr class="tbkl-plan-row-directive">' +
        '<td class="tbkl-plan-code">' + escapeHtml(dCode) + '</td>' +
        '<td>' + planTextarea('directive', 'data-pe-dir="' + dir._id + '"', 'title',
          'Nội dung kết luận lớn…', dirText, 4) + '</td>' +
        '<td>' + planTextarea('directive', 'data-pe-dir="' + dir._id + '"', 'deliverable',
          'Sản phẩm / kết quả lớn (nếu có)…', dir.deliverable || '', 3) + '</td>' +
        '<td class="tbkl-plan-col-lead">' + self._sharedSelect(dir) + '</td>' +
        '<td class="tbkl-plan-col-unit">' + self._directiveExecutorSelect(dir) + '</td>' +
        '<td><input type="date" data-pe-kind="directive" data-pe-dir="' + dir._id + '" data-pe-field="deadline" value="' + escapeHtml(dir.deadline) + '"></td>' +
        '<td class="tbkl-plan-actions">' +
        '<button type="button" class="tbkl-btn tbkl-btn-sm tbkl-btn-outline" data-pe-action="add-task" data-pe-dir="' + dir._id + '" title="Thêm đầu việc con">+ Con</button> ' +
        '<button type="button" class="tbkl-btn tbkl-btn-sm tbkl-btn-danger" data-pe-action="remove-directive" data-pe-dir="' + dir._id + '" title="Xóa mục">✕</button></td></tr>';

      dir.tasks.forEach(function (task, ti) {
        var tCode = taskCode(seq, di + 1, ti + 1);
        html += '<tr class="tbkl-plan-row-task">' +
          '<td class="tbkl-plan-code">' + escapeHtml(tCode) + '</td>' +
          '<td>' + planTextarea('task', 'data-pe-dir="' + dir._id + '" data-pe-task="' + task._id + '"', 'title',
            'Đầu việc chi tiết…', task.title, 4) + '</td>' +
          '<td>' + planTextarea('task', 'data-pe-dir="' + dir._id + '" data-pe-task="' + task._id + '"', 'deliverable',
            'Sản phẩm / kết quả…', task.deliverable || '', 3) + '</td>' +
          '<td class="tbkl-plan-col-lead">—</td>' +
          '<td class="tbkl-plan-col-unit">' + self._executorSelect(dir, task) + '</td>' +
          '<td><input type="date" data-pe-kind="task" data-pe-dir="' + dir._id + '" data-pe-task="' + task._id + '" data-pe-field="deadline" value="' + escapeHtml(task.deadline) + '"></td>' +
          '<td class="tbkl-plan-actions">' +
          '<button type="button" class="tbkl-btn tbkl-btn-sm tbkl-btn-danger" data-pe-action="remove-task" data-pe-dir="' + dir._id + '" data-pe-task="' + task._id + '">✕</button></td></tr>';
      });
    });

    html += '</tbody></table></div>';
    this.container.innerHTML = html;
    this.bindInput();
  };

  var instances = {};

  window.TbklPlanEditor = {
    create: function (containerId, options) {
      var el = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
      if (!el) return null;
      var editor = new PlanEditor(el, options || {});
      instances[el.id || 'default'] = editor;
      return editor;
    },
    get: function (containerId) {
      return instances[containerId || 'default'] || null;
    }
  };
})();
