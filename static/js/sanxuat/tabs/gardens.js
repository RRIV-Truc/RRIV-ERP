/**
 * Tab 0: Vườn Cây & EUDR - Garden management with Leaflet map
 * @module TabGardens
 * @depends SanxuatFactories
 */

const TabGardens = (function() {
  'use strict';

  // === State ===
  let gardens = [];
  let gardenMap = null;
  let geoJsonLayer = null;
  let mapPlots = [];
  let plotLayers = {};
  let currentMapLayer = 'satellite';

  const GEOJSON_CACHE_KEY = 'rrivLotGeoJson';
  const GEOJSON_LEGACY_KEY = 'rubberLotGeoJson';
  const GEOJSON_STATIC_URL = '/static/geojson/vien_nc_cao_su_tn.geojson';
  const GEOJSON_STORAGE_PATH = 'rriv-gis/Lo cao su - 2_Full.geojson';

  // === Helpers (delegated from global scope) ===
  function _db() { return ErpDb.firestore(); }
  function _user() { return window.currentUser; }
  function _showToast(msg, type) { if (window.showToast) window.showToast(msg, type); }
  function _formatNumber(n) { return window.formatNumber ? window.formatNumber(n) : String(n); }
  function _formatDate(d) { return window.formatDate ? window.formatDate(d) : ''; }
  function _generateCode(prefix) { return window.generateCode ? window.generateCode(prefix) : prefix + Date.now(); }

  // Màu đội SX — cùng logic app Vườn Cây (theo số đội)
  const TEAM_FILL_COLORS = [
    '#22c55e', '#3b82f6', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899',
    '#14b8a6', '#f97316', '#6366f1', '#84cc16', '#ef4444', '#a855f7'
  ];
  function getSquadColor(teamName) {
    if (!teamName) return '#64748b';
    var match = String(teamName).match(/\d+/);
    var teamNum = match ? parseInt(match[0], 10) : null;
    if (teamNum !== null && teamNum >= 1 && teamNum <= TEAM_FILL_COLORS.length) {
      return TEAM_FILL_COLORS[teamNum - 1];
    }
    return '#64748b';
  }

  function _plotTeamFromProps(props) {
    return String(
      props.Doi_2025 || props.doi_2025 || props.Nongtruong || props.nongtruong ||
      props.Nong_truong || props.nong_truong || ''
    ).trim();
  }

  function _plotFromFeature(feature, index) {
    var props = feature.properties || {};
    var code = props.Ma_lo || props.Ma_lo_2026 || props.Malo || props.malo || ('plot_' + index);
    var areaHa = parseFloat(
      props.Dtich2026_ha || props.Dien_tich_2025 || props.Dientich || props.dientich || 0
    );
    return {
      id: code,
      code: code,
      name: props.Ten_lo_moi || props.Tenlo || props.tenlo || props.Name || code,
      squad: _plotTeamFromProps(props),
      doi: _plotTeamFromProps(props),
      team: props.To_thuoc_Doi || props.to_thuoc_doi || props.To || props.to || '',
      area: areaHa * 10000,
      variety: props.Giong || props.giong || '',
      plantingYear: props.Nam_trong || props.Namtrong || props.namtrong || '',
      status: props.Hien_trang || props.Hientrangvuoncay || props.hientrangvuoncay || '',
      province: props.Tinh || '',
      district: props.HuyenThixa || '',
      commune: props.PhuongXa || '',
      landCert: props.GCN || props.GCNQSDD || '',
      geometry: feature.geometry,
      properties: props,
      eudrCompliant: true
    };
  }

  // ==================== MAP FUNCTIONS ====================

  function initGardenMap() {
    if (gardenMap) {
      setTimeout(function() {
        gardenMap.invalidateSize();
        if (mapPlots.length === 0) loadMapPlots();
      }, 100);
      _bindMapControls();
      return;
    }
    gardenMap = L.map('gardenMap', {
      center: [11.2756, 106.6123],
      zoom: 14,
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true
    });
    window.gardenMap = gardenMap;
    setupMapLayers();
    gardenMap.on('mousemove', function(e) {
      var el = document.getElementById('mapCoordsText');
      if (el) el.textContent = e.latlng.lat.toFixed(6) + '°N, ' + e.latlng.lng.toFixed(6) + '°E';
    });
    setTimeout(function() {
      if (gardenMap) gardenMap.invalidateSize();
    }, 100);
    _bindMapControls();
    loadMapPlots();
  }

  function _bindMapControls() {
    if (_bindMapControls._done) return;
    _bindMapControls._done = true;

    function onZoomIn(e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      if (gardenMap) gardenMap.zoomIn();
    }
    function onZoomOut(e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      if (gardenMap) gardenMap.zoomOut();
    }
    function onFullscreen(e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      toggleMapFullscreen();
    }

    var btnIn = document.getElementById('btnGardenMapZoomIn');
    var btnOut = document.getElementById('btnGardenMapZoomOut');
    var btnFs = document.getElementById('btnGardenMapFullscreen');
    var btnMin = document.getElementById('btnGardenMapMinimize');

    if (btnIn) {
      btnIn.addEventListener('click', onZoomIn);
      btnIn.addEventListener('touchend', onZoomIn, { passive: false });
    }
    if (btnOut) {
      btnOut.addEventListener('click', onZoomOut);
      btnOut.addEventListener('touchend', onZoomOut, { passive: false });
    }
    if (btnFs) {
      btnFs.addEventListener('click', onFullscreen);
      btnFs.addEventListener('touchend', onFullscreen, { passive: false });
    }
    if (btnMin) {
      btnMin.addEventListener('click', onFullscreen);
      btnMin.addEventListener('touchend', onFullscreen, { passive: false });
    }

    document.addEventListener('fullscreenchange', function() {
      var minBtn = document.getElementById('btnGardenMapMinimize');
      if (!document.fullscreenElement && minBtn) minBtn.classList.remove('show');
      setTimeout(function() {
        if (gardenMap) gardenMap.invalidateSize();
      }, 100);
    });
  }

  function zoomIn() {
    if (gardenMap) gardenMap.zoomIn();
  }

  function zoomOut() {
    if (gardenMap) gardenMap.zoomOut();
  }

  function toggleMapFullscreen() {
    var wrapper = document.getElementById('gardenMapWrapper');
    var minBtn = document.getElementById('btnGardenMapMinimize');
    if (!wrapper || !gardenMap) return;

    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    function _afterResize() {
      setTimeout(function() {
        gardenMap.invalidateSize();
        if (geoJsonLayer) {
          try {
            gardenMap.fitBounds(geoJsonLayer.getBounds(), { padding: [30, 30] });
          } catch (e) { /* ignore */ }
        }
      }, 100);
    }

    if (isIOS) {
      if (!wrapper.classList.contains('ios-fullscreen')) {
        wrapper.classList.add('ios-fullscreen');
        if (minBtn) minBtn.classList.add('show');
        document.body.style.overflow = 'hidden';
      } else {
        wrapper.classList.remove('ios-fullscreen');
        if (minBtn) minBtn.classList.remove('show');
        document.body.style.overflow = '';
      }
      _afterResize();
      return;
    }

    if (!document.fullscreenElement) {
      var req = wrapper.requestFullscreen && wrapper.requestFullscreen();
      if (req && req.then) {
        req.then(function() {
          if (minBtn) minBtn.classList.add('show');
          _afterResize();
        }).catch(function() {
          wrapper.classList.add('ios-fullscreen');
          if (minBtn) minBtn.classList.add('show');
          document.body.style.overflow = 'hidden';
          _afterResize();
        });
      } else {
        wrapper.classList.add('ios-fullscreen');
        if (minBtn) minBtn.classList.add('show');
        document.body.style.overflow = 'hidden';
        _afterResize();
      }
    } else if (document.exitFullscreen) {
      document.exitFullscreen().then(function() {
        if (minBtn) minBtn.classList.remove('show');
        _afterResize();
      });
    }
  }

  function setupMapLayers() {
    var osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 });
    var satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 });
    var hybridLayer = L.layerGroup([
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }),
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, opacity: 0.3 })
    ]);
    gardenMap.osmLayer = osmLayer;
    gardenMap.satelliteLayer = satelliteLayer;
    gardenMap.hybridLayer = hybridLayer;
    satelliteLayer.addTo(gardenMap);
  }

  function toggleMapLayer(layerType) {
    if (!gardenMap) return;
    if (gardenMap.osmLayer) gardenMap.removeLayer(gardenMap.osmLayer);
    if (gardenMap.satelliteLayer) gardenMap.removeLayer(gardenMap.satelliteLayer);
    if (gardenMap.hybridLayer) gardenMap.removeLayer(gardenMap.hybridLayer);
    var layer = gardenMap[layerType + 'Layer'];
    if (layer) layer.addTo(gardenMap);
    currentMapLayer = layerType;
    document.querySelectorAll('.map-layer-btn').forEach(function(btn) { btn.classList.remove('active'); });
    var activeBtn = document.getElementById('btnMap' + layerType.charAt(0).toUpperCase() + layerType.slice(1));
    if (activeBtn) activeBtn.classList.add('active');
  }

  function _readGeoJsonFromLocalStorage() {
    try {
      var saved = localStorage.getItem(GEOJSON_CACHE_KEY) || localStorage.getItem(GEOJSON_LEGACY_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) { /* ignore */ }
    return null;
  }

  function _cacheGeoJson(jsonStr) {
    try { localStorage.setItem(GEOJSON_CACHE_KEY, jsonStr); } catch (e) { /* ignore */ }
  }

  async function loadGeoJsonFromStatic() {
    try {
      var response = await fetch(GEOJSON_STATIC_URL);
      if (!response.ok) throw new Error('HTTP ' + response.status);
      var data = await response.json();
      _cacheGeoJson(JSON.stringify(data));
      return data;
    } catch (err) {
      console.warn('Bundled GeoJSON not available:', err);
      return null;
    }
  }

  async function loadGeoJsonFromFirestore() {
    try {
      var doc = await _db().collection('app_settings').doc('gardenGeoJson').get();
      if (doc.exists && doc.data().data) {
        var data = JSON.parse(doc.data().data);
        _cacheGeoJson(doc.data().data);
        return data;
      }
    } catch (e) { console.warn('Firestore GeoJSON error:', e.message); }
    return null;
  }

  async function loadGeoJsonFromFirebaseStorage() {
    if (!window.ErpDb || !ErpDb.storage) return null;
    try {
      var storageRef = ErpDb.storage().ref(GEOJSON_STORAGE_PATH);
      var downloadUrl = await storageRef.getDownloadURL();
      var response = await fetch(downloadUrl, { mode: 'cors' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      var data = await response.json();
      _cacheGeoJson(JSON.stringify(data));
      return data;
    } catch (err) {
      console.warn('Cloud Storage GeoJSON error:', err.message);
      return null;
    }
  }

  async function loadMapPlots() {
    if (!gardenMap) {
      initGardenMap();
      return;
    }
    var geoJsonData = _readGeoJsonFromLocalStorage();

    if (!geoJsonData || !geoJsonData.features) {
      geoJsonData = await loadGeoJsonFromStatic();
    }
    if (!geoJsonData || !geoJsonData.features) {
      geoJsonData = await loadGeoJsonFromFirestore();
    }
    if (!geoJsonData || !geoJsonData.features) {
      geoJsonData = await loadGeoJsonFromFirebaseStorage();
    }

    if (geoJsonData && geoJsonData.features) {
      displayGeoJson(geoJsonData);
    } else {
      mapPlots = [];
      renderSquadLegend();
      updateMapStats();
      _showToast('Chưa có dữ liệu bản đồ. Vui lòng import GeoJSON tại App Vườn Cây.', 'warning');
    }
  }

  function displayGeoJson(data) {
    if (!gardenMap || !data || !data.features) return;

    if (geoJsonLayer) {
      gardenMap.removeLayer(geoJsonLayer);
      geoJsonLayer = null;
    }
    plotLayers = {};

    mapPlots = data.features
      .filter(function(f) {
        return f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon');
      })
      .map(_plotFromFeature);

    geoJsonLayer = L.geoJSON(data, {
      filter: function(feature) {
        var g = feature.geometry;
        return g && (g.type === 'Polygon' || g.type === 'MultiPolygon');
      },
      style: function(feature) {
        var props = feature.properties || {};
        var team = _plotTeamFromProps(props);
        return {
          fillColor: getSquadColor(team),
          weight: 1.5,
          opacity: 1,
          color: '#ffffff',
          fillOpacity: 0.7
        };
      },
      onEachFeature: function(feature, layer) {
        var plot = _plotFromFeature(feature, 0);
        layer.bindPopup(createPlotPopup(plot));
        layer.on('mouseover', function() { this.setStyle({ fillOpacity: 0.85, weight: 3 }); });
        layer.on('mouseout', function() {
          var team = _plotTeamFromProps(feature.properties || {});
          this.setStyle({ fillColor: getSquadColor(team), fillOpacity: 0.7, weight: 1.5 });
        });
        if (plot.id) plotLayers[plot.id] = layer;
      }
    }).addTo(gardenMap);

    geoJsonLayer.bringToFront();
    updateMapStats();
    renderSquadLegend();

    try {
      var bounds = geoJsonLayer.getBounds();
      if (bounds.isValid()) {
        setTimeout(function() {
          gardenMap.fitBounds(bounds, { padding: [30, 30], animate: false });
        }, 150);
      }
    } catch (e) { /* ignore */ }
  }

  function createPlotPopup(plot) {
    var squadId = plot.squad || plot.doi || '-';
    var areaHa = plot.area ? (plot.area / 10000).toFixed(2) : '-';
    var statusText = plot.status === 'KD' ? 'Kinh doanh' : (plot.status === 'KTCB' ? 'Kiến thiết CB' : (plot.status || '-'));
    return '<div class="plot-popup">' +
      '<div class="plot-popup-header">Lô ' + (plot.name || plot.code || plot.id) + '</div>' +
      '<div class="plot-popup-body">' +
      '<div class="plot-popup-row"><span class="label">Mã lô:</span><span class="value">' + (plot.code || '-') + '</span></div>' +
      '<div class="plot-popup-row"><span class="label">Đội SX:</span><span class="value" style="color:' + getSquadColor(squadId) + '">' + squadId + '</span></div>' +
      '<div class="plot-popup-row"><span class="label">Tổ:</span><span class="value">' + (plot.team ? 'Tổ ' + plot.team : '-') + '</span></div>' +
      '<div class="plot-popup-row"><span class="label">Diện tích:</span><span class="value">' + areaHa + ' ha</span></div>' +
      '<div class="plot-popup-row"><span class="label">Giống:</span><span class="value">' + (plot.variety || '-') + '</span></div>' +
      '<div class="plot-popup-row"><span class="label">Năm trồng:</span><span class="value">' + (plot.plantingYear || '-') + '</span></div>' +
      '<div class="plot-popup-row"><span class="label">Hiện trạng:</span><span class="value" style="color:' + (plot.status === 'KD' ? '#22c55e' : '#f59e0b') + '">' + statusText + '</span></div>' +
      '<div class="plot-popup-row"><span class="label">EUDR:</span><span class="value" style="color:#22c55e">Tuân thủ</span></div>' +
      '</div></div>';
  }

  function updateMapStats() {
    var totalArea = 0, eudrCompliant = 0;
    var squads = new Set();
    mapPlots.forEach(function(plot) {
      if (plot.area) totalArea += parseFloat(plot.area);
      if (plot.eudrCompliant) eudrCompliant++;
      if (plot.squad || plot.doi) squads.add(plot.squad || plot.doi);
    });
    var el = function(id) { return document.getElementById(id); };
    if (el('mapTotalArea')) el('mapTotalArea').textContent = (totalArea / 10000).toFixed(1);
    if (el('mapTotalPlots')) el('mapTotalPlots').textContent = mapPlots.length;
    if (el('mapEudrCompliant')) el('mapEudrCompliant').textContent = eudrCompliant;
    if (el('mapTotalSquads')) el('mapTotalSquads').textContent = squads.size;
  }

  function renderSquadLegend() {
    var grid = document.getElementById('squadLegendGrid');
    if (!grid) return;
    var squadStats = {};
    mapPlots.forEach(function(plot) {
      var sid = plot.squad || plot.doi || 'other';
      if (!squadStats[sid]) squadStats[sid] = { count: 0, area: 0 };
      squadStats[sid].count++;
      if (plot.area) squadStats[sid].area += parseFloat(plot.area);
    });
    if (Object.keys(squadStats).length === 0) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:15px;color:var(--text-muted);">Chưa có dữ liệu lô. Vui lòng import GeoJSON tại <a href="app-vuoncay.html" style="color:var(--accent)">App Vườn Cây</a>.</div>';
      return;
    }
    var html = '';
    Object.keys(squadStats).sort(function(a, b) { return (parseInt(a) || 999) - (parseInt(b) || 999); }).forEach(function(sid) {
      var color = getSquadColor(sid);
      var stats = squadStats[sid];
      var areaHa = (stats.area / 10000).toFixed(1);
      var squadName = sid === 'other' ? 'Khác' : 'Đội ' + sid;
      html += '<div class="squad-legend-item" onclick="TabGardens.filterMapBySquad(\'' + sid + '\')">' +
        '<div class="squad-legend-color" style="background:' + color + '"></div>' +
        '<div class="squad-legend-info"><div class="squad-legend-name">' + squadName + '</div>' +
        '<div class="squad-legend-stats"><span>' + stats.count + ' lô</span><span>' + areaHa + ' ha</span></div></div></div>';
    });
    grid.innerHTML = html;
  }

  function filterMapBySquad(squadId) {
    Object.entries(plotLayers).forEach(function(entry) {
      var plotId = entry[0], layer = entry[1];
      var plot = mapPlots.find(function(p) { return p.id === plotId; });
      if (plot) {
        var plotSquad = plot.squad || plot.doi || 'other';
        layer.setStyle({ fillOpacity: (squadId === 'all' || plotSquad === squadId) ? 0.6 : 0.1 });
      }
    });
  }

  function fitMapBounds() {
    if (!gardenMap) return;
    if (geoJsonLayer) {
      try {
        gardenMap.fitBounds(geoJsonLayer.getBounds(), { padding: [30, 30] });
        return;
      } catch (e) { /* fall through */ }
    }
    if (Object.keys(plotLayers).length === 0) {
      _showToast('Chưa có dữ liệu lô để hiển thị', 'warning');
      return;
    }
    var group = L.featureGroup(Object.values(plotLayers));
    gardenMap.fitBounds(group.getBounds(), { padding: [30, 30] });
  }

  // ==================== GARDEN CRUD ====================

  async function loadGardens() {
    try {
      var saved = localStorage.getItem('rubberGardens');
      if (saved) gardens = JSON.parse(saved);
    } catch (e) { /* ignore */ }

    try {
      var snapshot = await _db().collection('rubberGardens').orderBy('createdAt', 'desc').get();
      gardens = snapshot.docs.map(function(doc) { return Object.assign({ id: doc.id }, doc.data()); });
      localStorage.setItem('rubberGardens', JSON.stringify(gardens));
    } catch (error) {
      console.warn('Firestore gardens error:', error.message);
    }

    // Sync with global scope for cross-tab access (Delivery, Reception use gardens)
    window.gardens = gardens;
    renderGardens();
    updateGardenStats();
  }

  function renderGardens(data) {
    data = data || gardens;
    var tbody = document.getElementById('gardensTableBody');
    if (!tbody) return;
    if (data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#64748b;">Chưa có dữ liệu vườn cây</td></tr>';
      return;
    }
    tbody.innerHTML = data.map(function(g) {
      return '<tr>' +
        '<td><strong>' + (g.code || '') + '</strong></td>' +
        '<td>' + (g.ownerName || '') + '</td>' +
        '<td>' + (g.ownerPhone || '') + '</td>' +
        '<td>' + _formatNumber(g.area) + '</td>' +
        '<td style="max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="' + (g.address || '') + '">' + (g.address || '') + '</td>' +
        '<td>' + (g.location ? g.location.lat + ', ' + g.location.lng : '') + '</td>' +
        '<td><span class="status-badge ' + (g.eudrStatus || 'pending') + '">' + getEudrStatusText(g.eudrStatus) + '</span></td>' +
        '<td><div class="action-btns">' +
        '<button class="action-btn edit" onclick="TabGardens.editGarden(\'' + g.id + '\')" title="Sửa">✏️</button>' +
        '<button class="action-btn delete" onclick="TabGardens.deleteGarden(\'' + g.id + '\')" title="Xóa">🗑️</button>' +
        '</div></td></tr>';
    }).join('');
  }

  function getEudrStatusText(status) {
    var map = { 'compliant': 'Tuân thủ', 'pending': 'Chờ xác minh', 'non-compliant': 'Chưa tuân thủ' };
    return map[status] || 'Chờ xác minh';
  }

  function updateGardenStats() {
    var el = function(id) { return document.getElementById(id); };
    if (el('totalGardens')) el('totalGardens').textContent = gardens.length;
    if (el('totalArea')) el('totalArea').textContent = _formatNumber(gardens.reduce(function(s, g) { return s + (parseFloat(g.area) || 0); }, 0));
    if (el('eudrCompliant')) el('eudrCompliant').textContent = gardens.filter(function(g) { return g.eudrStatus === 'compliant'; }).length;
    if (el('eudrPending')) el('eudrPending').textContent = gardens.filter(function(g) { return g.eudrStatus !== 'compliant'; }).length;
  }

  function searchGardens() {
    var keyword = (document.getElementById('gardenSearch')?.value || '').toLowerCase();
    var filtered = gardens.filter(function(g) {
      return (g.code || '').toLowerCase().indexOf(keyword) !== -1 ||
             (g.ownerName || '').toLowerCase().indexOf(keyword) !== -1 ||
             (g.address || '').toLowerCase().indexOf(keyword) !== -1;
    });
    renderGardens(filtered);
  }

  function filterGardens() {
    var status = document.getElementById('gardenStatusFilter')?.value || '';
    var filtered = status ? gardens.filter(function(g) { return g.eudrStatus === status; }) : gardens;
    renderGardens(filtered);
  }

  function openGardenModal(id) {
    document.getElementById('gardenModalTitle').textContent = id ? 'Chỉnh Sửa Vườn Cây' : 'Thêm Vườn Cây Mới';
    document.getElementById('gardenId').value = id || '';

    if (id) {
      var g = gardens.find(function(x) { return x.id === id; });
      if (g) {
        document.getElementById('gardenCode').value = g.code || '';
        document.getElementById('gardenArea').value = g.area || '';
        document.getElementById('gardenOwner').value = g.ownerName || '';
        document.getElementById('gardenPhone').value = g.ownerPhone || '';
        document.getElementById('gardenAddress').value = g.address || '';
        document.getElementById('gardenLat').value = g.location?.lat || '';
        document.getElementById('gardenLng').value = g.location?.lng || '';
        document.getElementById('gardenEudrStatus').value = g.eudrStatus || 'pending';
        document.getElementById('gardenEudrDate').value = g.eudrCertDate || '';
      }
    } else {
      document.getElementById('gardenCode').value = _generateCode('VC');
      ['gardenArea','gardenOwner','gardenPhone','gardenAddress','gardenLat','gardenLng','gardenEudrDate'].forEach(function(fid) {
        var el = document.getElementById(fid);
        if (el) el.value = '';
      });
      document.getElementById('gardenEudrStatus').value = 'pending';
    }
    document.getElementById('gardenModal').classList.add('active');
  }

  function closeGardenModal() {
    document.getElementById('gardenModal').classList.remove('active');
  }

  function editGarden(id) { openGardenModal(id); }

  async function saveGarden() {
    var id = document.getElementById('gardenId').value;
    var code = document.getElementById('gardenCode').value.trim();
    var area = parseFloat(document.getElementById('gardenArea').value) || 0;
    var ownerName = document.getElementById('gardenOwner').value.trim();
    var ownerPhone = document.getElementById('gardenPhone').value.trim();
    var address = document.getElementById('gardenAddress').value.trim();
    var lat = parseFloat(document.getElementById('gardenLat').value) || null;
    var lng = parseFloat(document.getElementById('gardenLng').value) || null;
    var eudrStatus = document.getElementById('gardenEudrStatus').value;
    var eudrCertDate = document.getElementById('gardenEudrDate').value;

    if (!code || !ownerName || !area) {
      _showToast('Vui lòng nhập đầy đủ thông tin bắt buộc', 'error');
      return;
    }

    var data = {
      code: code, area: area, ownerName: ownerName, ownerPhone: ownerPhone, address: address,
      location: lat && lng ? { lat: lat, lng: lng } : null,
      eudrStatus: eudrStatus, eudrCertDate: eudrCertDate || null,
      updatedAt: ErpDb.firestore.FieldValue.serverTimestamp(),
      updatedBy: _user()?.id || null
    };

    var localData = {
      code: code, area: area, ownerName: ownerName, ownerPhone: ownerPhone, address: address,
      location: lat && lng ? { lat: lat, lng: lng } : null,
      eudrStatus: eudrStatus, eudrCertDate: eudrCertDate || null,
      updatedAt: new Date().toISOString()
    };

    try {
      if (id) {
        await _db().collection('rubberGardens').doc(id).update(data);
        _showToast('Cập nhật thành công!');
      } else {
        data.createdAt = ErpDb.firestore.FieldValue.serverTimestamp();
        data.createdBy = _user()?.id || null;
        var docRef = await _db().collection('rubberGardens').add(data);
        localData.id = docRef.id;
        _showToast('Thêm mới thành công!');
      }
    } catch (error) {
      console.warn('Firestore save error, saving locally:', error.message);
      if (id) {
        var idx = gardens.findIndex(function(g) { return g.id === id; });
        if (idx >= 0) gardens[idx] = Object.assign({}, gardens[idx], localData);
      } else {
        localData.id = 'local_' + Date.now();
        localData.createdAt = new Date().toISOString();
        gardens.unshift(localData);
      }
      localStorage.setItem('rubberGardens', JSON.stringify(gardens));
      _showToast('Đã lưu offline!');
    }

    closeGardenModal();
    loadGardens();
  }

  async function deleteGarden(id) {
    if (!(await showConfirm('Bạn có chắc muốn xóa vườn cây này?'))) return;
    try { await _db().collection('rubberGardens').doc(id).delete(); }
    catch (error) { console.warn('Firestore delete error:', error.message); }
    gardens = gardens.filter(function(g) { return g.id !== id; });
    localStorage.setItem('rubberGardens', JSON.stringify(gardens));
    _showToast('Đã xóa!');
    loadGardens();
  }

  function exportGardens() {
    ExportService.toExcel({
      data: gardens,
      columns: [
        { key: 'code', header: 'Mã Vườn', width: 15 },
        { key: 'ownerName', header: 'Chủ Vườn', width: 25 },
        { key: 'ownerPhone', header: 'Điện Thoại', width: 15 },
        { key: 'area', header: 'Diện Tích (ha)', width: 15 },
        { key: 'address', header: 'Địa Chỉ', width: 35 },
        { key: 'location.lat', header: 'Vĩ Độ', width: 15 },
        { key: 'location.lng', header: 'Kinh Độ', width: 15 },
        { key: 'eudrStatus', header: 'Trạng Thái EUDR', width: 18, format: function(v) { return getEudrStatusText(v); } },
        { key: 'eudrCertDate', header: 'Ngày Chứng Nhận', width: 18 }
      ],
      fileName: 'VuonCay',
      sheetName: 'Vườn Cây'
    });
  }

  // ==================== PUBLIC API ====================
  return {
    // State access
    getGardens: function() { return gardens; },
    getMapPlots: function() { return mapPlots; },
    getSquadColor: getSquadColor,

    // Map
    initGardenMap: initGardenMap,
    loadMapPlots: loadMapPlots,
    toggleMapLayer: toggleMapLayer,
    filterMapBySquad: filterMapBySquad,
    fitMapBounds: fitMapBounds,
    zoomIn: zoomIn,
    zoomOut: zoomOut,
    toggleMapFullscreen: toggleMapFullscreen,

    // CRUD
    loadGardens: loadGardens,
    searchGardens: searchGardens,
    filterGardens: filterGardens,
    openGardenModal: openGardenModal,
    closeGardenModal: closeGardenModal,
    editGarden: editGarden,
    saveGarden: saveGarden,
    deleteGarden: deleteGarden,
    exportGardens: exportGardens,

    // Init (called by showTab)
    init: function() {
      loadGardens();
      setTimeout(function() {
        if (gardenMap) {
          gardenMap.invalidateSize();
          if (mapPlots.length === 0) loadMapPlots();
        } else {
          initGardenMap();
        }
      }, 100);
    }
  };
})();
