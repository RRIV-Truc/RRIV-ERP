// =============================================
// Smart Archive
// =============================================
async function archiveTask(taskId) {
  if (!(await customConfirm('Lưu trữ công việc này?'))) return;
  try {
    await db.collection('workTasks').doc(taskId).update({
      status: 'archived',
      archivedAt: ErpDb.firestore.FieldValue.serverTimestamp(),
      archivedBy: { uid: userData.id, name: userData.hoTen || userData.name || '' },
      updatedAt: ErpDb.firestore.FieldValue.serverTimestamp()
    });
    showToast('Đã lưu trữ', 'success');
    closeModal('taskDetailModal');
    await loadAllTasks();
    loadDashboard();
    renderDeptPerformance();
    renderTaskList();
    loadMyTasks();
  } catch (e) {
    showToast('Lỗi: ' + e.message, 'error');
  }
}

async function unarchiveTask(taskId) {
  if (!(await customConfirm('Khôi phục công việc này?'))) return;
  try {
    await db.collection('workTasks').doc(taskId).update({
      status: 'completed',
      updatedAt: ErpDb.firestore.FieldValue.serverTimestamp()
    });
    showToast('Đã khôi phục', 'success');
    closeModal('taskDetailModal');
    await loadAllTasks();
    renderTaskList();
  } catch (e) {
    showToast('Lỗi: ' + e.message, 'error');
  }
}

// =============================================
// Dashboard KPI Personal Summary
// =============================================
async function loadKPISummaryForDashboard() {
  var summaryEl = document.getElementById('kpiSummary');
  if (!summaryEl) return;

  var now = new Date();
  var currentPeriod = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

  if (!canCreateTask()) {
    // Show personal KPI card
    try {
      var snap = await db.collection('kpiEvaluations')
        .where('employeeId', '==', userData.id)
        .where('period', '==', currentPeriod)
        .limit(1).get();

      if (snap.empty) {
        summaryEl.innerHTML = '<div style="font-size:12px;color:var(--text-muted);">Chưa có KPI tháng này</div>';
        return;
      }
      var kpi = { id: snap.docs[0].id, ...snap.docs[0].data() };
      var total = kpi.totalScore || 0;
      var cls = total >= 85 ? 'var(--success)' : total >= 70 ? 'var(--info)' : total >= 50 ? 'var(--warning)' : 'var(--danger)';

      var scores = [
        { label: 'Hoàn thành (C)', value: kpi.completionScore || 0, color: '#3b82f6' },
        { label: 'Đúng hạn (T)', value: kpi.timelinessScore || 0, color: '#22c55e' },
        { label: 'Chất lượng (Q)', value: kpi.qualityScore || 0, color: '#f59e0b' },
        { label: 'Phối hợp (F)', value: kpi.feedbackScore || 0, color: '#a78bfa' }
      ];

      var html = '<div class="kpi-personal-card">';
      html += '<div class="kpi-personal-score" style="color:' + cls + ';">' + total.toFixed(1) + '</div>';
      html += '<div class="kpi-personal-details">';
      html += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">KPI tháng ' + (now.getMonth() + 1) + '/' + now.getFullYear() + '</div>';
      scores.forEach(function(s) {
        var barW = Math.min(s.value, 100);
        html += '<div class="kpi-personal-bar">';
        html += '<div class="kpi-personal-bar-label">' + s.label + '</div>';
        html += '<div class="kpi-personal-bar-track"><div class="kpi-personal-bar-fill" style="width:' + barW + '%;background:' + s.color + ';"></div></div>';
        html += '<div class="kpi-personal-bar-value" style="color:' + s.color + ';">' + s.value.toFixed(0) + '</div>';
        html += '</div>';
      });
      html += '</div></div>';
      summaryEl.innerHTML = html;
    } catch (e) {
      summaryEl.innerHTML = '<div style="font-size:12px;color:var(--text-muted);">Lỗi tải KPI</div>';
    }
  } else {
    // Admin/Manager: show avg per department
    try {
      var snap = await db.collection('kpiEvaluations')
        .where('period', '==', currentPeriod)
        .get();

      if (snap.empty) {
        summaryEl.innerHTML = '<div style="font-size:12px;color:var(--text-muted);">Chưa có KPI tháng ' + (now.getMonth() + 1) + '. Vào tab KPI để tính.</div>';
        return;
      }

      var docs = snap.docs.map(function(d) { return d.data(); }).filter(function(k) { return k.type !== 'coordination'; });
      if (docs.length === 0) {
        summaryEl.innerHTML = '<div style="font-size:12px;color:var(--text-muted);">Ch\u01B0a c\u00F3 KPI c\u00E1 nh\u00E2n th\u00E1ng ' + (now.getMonth() + 1) + '. V\u00E0o tab KPI \u0111\u1EC3 t\u00EDnh.</div>';
        return;
      }
      var deptAvg = {};
      docs.forEach(function(k) {
        var dName = k.department ? (k.department.name || 'Ch\u01B0a ph\u00E2n ph\u00F2ng') : 'Ch\u01B0a ph\u00E2n ph\u00F2ng';
        if (!deptAvg[dName]) deptAvg[dName] = { sum: 0, count: 0 };
        deptAvg[dName].sum += (k.totalScore || 0);
        deptAvg[dName].count++;
      });

      var html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;">';
      Object.keys(deptAvg).sort().forEach(function(dept) {
        var avg = deptAvg[dept].sum / deptAvg[dept].count;
        var cls = avg >= 85 ? 'var(--success)' : avg >= 70 ? 'var(--info)' : avg >= 50 ? 'var(--warning)' : 'var(--danger)';
        html += '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:12px;text-align:center;">';
        html += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">' + escapeHtml(dept) + '</div>';
        html += '<div style="font-size:24px;font-weight:800;color:' + cls + ';">' + avg.toFixed(1) + '</div>';
        html += '<div style="font-size:12px;color:var(--text-muted);">' + deptAvg[dept].count + ' nhân viên</div>';
        html += '</div>';
      });
      html += '</div>';
      summaryEl.innerHTML = html;
    } catch (e) {
      summaryEl.innerHTML = '<div style="font-size:12px;color:var(--text-muted);">Lỗi tải KPI tổng quan</div>';
    }
  }
}



