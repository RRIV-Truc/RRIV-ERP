// =============================================
// RACI Matrix
// =============================================
function openRACIForm(taskId) {
  var task = allTasks.find(function(t) { return t.id === taskId; });
  if (!task) return;

  document.getElementById('raciTaskId').value = taskId;
  var raci = task.raci || {};

  // Populate selects and checkboxes
  var selR = document.getElementById('raciR');
  var selA = document.getElementById('raciA');
  var divC = document.getElementById('raciCCheckboxes');
  var divI = document.getElementById('raciICheckboxes');

  selR.innerHTML = '<option value="">-- Chọn --</option>';
  selA.innerHTML = '<option value="">-- Chọn --</option>';
  divC.innerHTML = '';
  divI.innerHTML = '';

  var cIds = (raci.consulted || []).map(function(c) { return c.uid; });
  var iIds = (raci.informed || []).map(function(i) { return i.uid; });

  allPersonnel.forEach(function(p) {
    var pName = p.hoTen || p.name || p.username || p.id;
    var opt = '<option value="' + p.id + '" data-name="' + escapeHtml(pName) + '">' + escapeHtml(pName) + '</option>';
    selR.innerHTML += opt;
    selA.innerHTML += opt;
    divC.innerHTML += '<label style="display:flex;align-items:center;gap:4px;font-size:14px;color:var(--text-secondary);cursor:pointer;">' +
      '<input type="checkbox" value="' + p.id + '" data-name="' + escapeHtml(pName) + '"' + (cIds.indexOf(p.id) !== -1 ? ' checked' : '') + '> ' + escapeHtml(pName) + '</label>';
    divI.innerHTML += '<label style="display:flex;align-items:center;gap:4px;font-size:14px;color:var(--text-secondary);cursor:pointer;">' +
      '<input type="checkbox" value="' + p.id + '" data-name="' + escapeHtml(pName) + '"' + (iIds.indexOf(p.id) !== -1 ? ' checked' : '') + '> ' + escapeHtml(pName) + '</label>';
  });

  // Pre-select R and A
  if (raci.responsible) selR.value = raci.responsible.uid || '';
  if (raci.accountable) selA.value = raci.accountable.uid || '';

  closeModal('taskDetailModal');
  openModal('raciModal');
}

async function saveRACI() {
  var taskId = document.getElementById('raciTaskId').value;
  var selR = document.getElementById('raciR');
  var selA = document.getElementById('raciA');

  var raciData = {};

  if (selR.value) {
    var rOpt = selR.selectedOptions[0];
    raciData.responsible = { uid: selR.value, name: rOpt ? rOpt.dataset.name || '' : '' };
  }
  if (selA.value) {
    var aOpt = selA.selectedOptions[0];
    raciData.accountable = { uid: selA.value, name: aOpt ? aOpt.dataset.name || '' : '' };
  }

  raciData.consulted = [];
  document.querySelectorAll('#raciCCheckboxes input:checked').forEach(function(cb) {
    raciData.consulted.push({ uid: cb.value, name: cb.dataset.name || '' });
  });

  raciData.informed = [];
  document.querySelectorAll('#raciICheckboxes input:checked').forEach(function(cb) {
    raciData.informed.push({ uid: cb.value, name: cb.dataset.name || '' });
  });

  try {
    await db.collection('workTasks').doc(taskId).update({
      raci: raciData,
      updatedAt: ErpDb.firestore.FieldValue.serverTimestamp()
    });
    showToast('\u0110\u00E3 c\u1EADp nh\u1EADt ph\u00E2n c\u00F4ng', 'success');
    closeModal('raciModal');
    await loadAllTasks();
    openTaskDetail(taskId);
  } catch (e) {
    showToast('Lỗi: ' + e.message, 'error');
  }
}

