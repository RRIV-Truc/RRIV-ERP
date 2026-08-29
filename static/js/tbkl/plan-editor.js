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
      lead_department_name: '',
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
    var dirs = (plan && plan.directives) || [];
    if (!dirs.length) {
      this.reset();
      return;
    }
    this.directives = dirs.map(function (d) {
      return {
        _id: uid('d'),
        title: d.title || '',
        content: d.content || d.title || '',
        lead_department_name: d.lead_department_name || '',
        supervisor_name: d.supervisor_name || '',
        deadline: d.deadline || '',
        tasks: (d.tasks || []).map(function (t) {
          return {
            _id: uid('t'),
            title: t.title || '',
            deliverable: t.deliverable || '',
            owner_unit_name: t.owner_unit_name || '',
            deadline: t.deadline || ''
          };
        })
      };
    });
    this.render();
  };

  PlanEditor.prototype.getPlan = function () {
    var self = this;
    return {
      directives: this.directives.map(function (d) {
        return {
          title: (d.title || '').trim(),
          content: (d.content || d.title || '').trim(),
          lead_department_name: (d.lead_department_name || '').trim() || null,
          supervisor_name: (d.supervisor_name || '').trim() || null,
          deadline: d.deadline || null,
          tasks: (d.tasks || []).map(function (t) {
            return {
              title: (t.title || '').trim(),
              deliverable: (t.deliverable || '').trim() || null,
              owner_unit_name: (t.owner_unit_name || '').trim() || null,
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

  PlanEditor.prototype.bindInput = function () {
    var self = this;
    this.container.querySelectorAll('[data-pe-field]').forEach(function (el) {
      el.addEventListener('input', function () {
        var kind = el.getAttribute('data-pe-kind');
        var dirId = el.getAttribute('data-pe-dir');
        var taskId = el.getAttribute('data-pe-task');
        var field = el.getAttribute('data-pe-field');
        if (kind === 'directive') {
          var dir = self.directives.find(function (d) { return d._id === dirId; });
          if (dir) dir[field] = el.value;
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

  PlanEditor.prototype.render = function () {
    var self = this;
    var seq = this.meetingSeq;
    var html = '<div class="tbkl-plan-toolbar">' +
      '<button type="button" class="tbkl-btn tbkl-btn-sm tbkl-btn-outline" data-pe-action="add-directive">+ Mục kết luận lớn</button>' +
      '<span class="tbkl-plan-hint">Mã tự sinh: H' + seq + '-01, H' + seq + '-01-01…</span></div>';

    html += '<div class="tbkl-plan-table-wrap"><table class="tbkl-plan-table"><thead><tr>' +
      '<th>Mã</th><th>Kết luận / Đầu việc</th><th>SP</th><th>Phòng CT</th><th>Đơn vị TH</th><th>Hạn</th><th></th>' +
      '</tr></thead><tbody>';

    this.directives.forEach(function (dir, di) {
      var dCode = directiveCode(seq, di + 1);
      html += '<tr class="tbkl-plan-row-directive">' +
        '<td class="tbkl-plan-code">' + escapeHtml(dCode) + '</td>' +
        '<td><input type="text" data-pe-kind="directive" data-pe-dir="' + dir._id + '" data-pe-field="title" ' +
        'placeholder="Nội dung kết luận lớn…" value="' + escapeHtml(dir.title) + '"></td>' +
        '<td>—</td>' +
        '<td><input type="text" data-pe-kind="directive" data-pe-dir="' + dir._id + '" data-pe-field="lead_department_name" ' +
        'placeholder="Phòng chủ trì" value="' + escapeHtml(dir.lead_department_name) + '"></td>' +
        '<td>—</td>' +
        '<td><input type="date" data-pe-kind="directive" data-pe-dir="' + dir._id + '" data-pe-field="deadline" value="' + escapeHtml(dir.deadline) + '"></td>' +
        '<td class="tbkl-plan-actions">' +
        '<button type="button" class="tbkl-btn tbkl-btn-sm tbkl-btn-outline" data-pe-action="add-task" data-pe-dir="' + dir._id + '" title="Thêm đầu việc con">+ Con</button> ' +
        '<button type="button" class="tbkl-btn tbkl-btn-sm tbkl-btn-danger" data-pe-action="remove-directive" data-pe-dir="' + dir._id + '" title="Xóa mục">✕</button></td></tr>';

      dir.tasks.forEach(function (task, ti) {
        var tCode = taskCode(seq, di + 1, ti + 1);
        html += '<tr class="tbkl-plan-row-task">' +
          '<td class="tbkl-plan-code">' + escapeHtml(tCode) + '</td>' +
          '<td><input type="text" data-pe-kind="task" data-pe-dir="' + dir._id + '" data-pe-task="' + task._id + '" data-pe-field="title" ' +
          'placeholder="Đầu việc chi tiết…" value="' + escapeHtml(task.title) + '"></td>' +
          '<td><input type="text" data-pe-kind="task" data-pe-dir="' + dir._id + '" data-pe-task="' + task._id + '" data-pe-field="deliverable" ' +
          'placeholder="Sản phẩm" value="' + escapeHtml(task.deliverable) + '"></td>' +
          '<td>—</td>' +
          '<td><input type="text" data-pe-kind="task" data-pe-dir="' + dir._id + '" data-pe-task="' + task._id + '" data-pe-field="owner_unit_name" ' +
          'placeholder="Đơn vị TH" value="' + escapeHtml(task.owner_unit_name) + '"></td>' +
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
