/**
 * AeroSense Pro Analyzer — Atmospheric Telemetry & Predictive Weather Forecaster
 * Client-side analytical engine, Chart.js visualizations, Web Serial real-time USB streaming
 */

// Application State
const state = {
  records: [],
  filteredRecords: [],
  currentPage: 1,
  pageSize: 12,
  charts: {},
  summary: {
    maxAltitude: 0,
    minAltitude: 0,
    currentPressure: 1013.25,
    pressureTrend: 0,
    minTemp: 0,
    maxTemp: 0,
    avgTemp: 0,
    avgHumidity: 0,
    dewPoint: 0,
    cloudBase: 0,
    maxRainRisk: 0,
    latestForecast: 'Standby'
  },
  // Web Serial Live Stream State
  serial: {
    port: null,
    reader: null,
    readableStreamClosed: null,
    isConnected: false,
    receivedCount: 0
  },
  // NEO-6M GPS & Interactive Leaflet Map State
  gps: {
    map: null,
    deviceMarker: null,
    trackPolyline: null,
    waypointLayerGroup: null,
    hasFix: false,
    latestLat: null,
    latestLon: null,
    latestSpeed: 0,
    latestSats: 0,
    totalDistanceKm: 0
  }
};

// ==============================================================================
// DOM Initialization & Event Listeners
// ==============================================================================

document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  initCharts();
  initGpsMap();
  initSubNav();
  initInternetWeatherResource();
  // Set initial clean state
  resetToLiveReadyState();
});

function initEventListeners() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const browseLink = document.getElementById('browse-link');
  const btnLiveSerial = document.getElementById('btn-live-serial');
  const btnClearData = document.getElementById('btn-clear-data');
  const btnOpenPaste = document.getElementById('btn-open-paste-modal');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const btnCancelPaste = document.getElementById('btn-cancel-paste');
  const btnSubmitPaste = document.getElementById('btn-submit-paste');
  const pasteModal = document.getElementById('paste-modal');
  const pasteTextarea = document.getElementById('paste-textarea');
  const btnExportCsv = document.getElementById('btn-export-csv');
  const btnPrint = document.getElementById('btn-print');

  const tableSearch = document.getElementById('table-search');
  const filterCondition = document.getElementById('filter-condition');
  const btnPrevPage = document.getElementById('btn-prev-page');
  const btnNextPage = document.getElementById('btn-next-page');

  // Soft Moving Sub-Navigation Bar
  initSubNav();

  // Web Serial Live USB Stream
  if (btnLiveSerial) {
    btnLiveSerial.addEventListener('click', toggleLiveSerialConnection);
  }

  // Clear / Reset Data
  if (btnClearData) {
    btnClearData.addEventListener('click', () => {
      if (confirm('Clear all displayed data and reset to live ready state?')) {
        resetToLiveReadyState();
      }
    });
  }

  // Drag and Drop
  ['dragenter', 'dragover'].forEach(name => {
    dropZone.addEventListener(name, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach(name => {
    dropZone.addEventListener(name, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('drag-over');
    });
  });

  dropZone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) handleFile(files[0]);
  });

  // Browse link trigger
  if (browseLink) {
    browseLink.addEventListener('click', () => fileInput.click());
  }

  // File Input
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleFile(e.target.files[0]);
  });

  // Paste Modal
  btnOpenPaste.addEventListener('click', () => {
    pasteModal.classList.add('active');
    pasteTextarea.focus();
  });

  btnCloseModal.addEventListener('click', () => pasteModal.classList.remove('active'));
  btnCancelPaste.addEventListener('click', () => pasteModal.classList.remove('active'));

  btnSubmitPaste.addEventListener('click', () => {
    const text = pasteTextarea.value.trim();
    if (text) {
      parseCSV(text, 'Pasted CSV Data');
      pasteModal.classList.remove('active');
      pasteTextarea.value = '';
    } else {
      alert('Please paste CSV rows to analyze.');
    }
  });

  // Export & Print
  btnExportCsv.addEventListener('click', exportAnalyzedCSV);
  btnPrint.addEventListener('click', () => window.print());

  // Table filtering & pagination
  tableSearch.addEventListener('input', applyTableFilters);
  filterCondition.addEventListener('change', applyTableFilters);

  btnPrevPage.addEventListener('click', () => {
    if (state.currentPage > 1) {
      state.currentPage--;
      renderTable();
    }
  });

  btnNextPage.addEventListener('click', () => {
    const totalPages = Math.ceil(state.filteredRecords.length / state.pageSize);
    if (state.currentPage < totalPages) {
      state.currentPage++;
      renderTable();
    }
  });
}

// ==============================================================================
// Web Serial API — Real-Time Live USB Telemetry Streaming
// ==============================================================================

async function toggleLiveSerialConnection() {
  if (state.serial.isConnected) {
    await disconnectSerial();
    return;
  }

  if (!('serial' in navigator)) {
    alert('Web Serial API is not supported in this browser. Please use Google Chrome, Microsoft Edge, or Opera on Windows/Mac/Linux to connect your ESP32 via USB.');
    return;
  }

  try {
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });

    state.serial.port = port;
    state.serial.isConnected = true;
    state.serial.receivedCount = 0;

    // Reset records to start fresh live stream
    state.records = [];
    state.filteredRecords = [];
    state.currentPage = 1;

    updateSerialButtonUI(true);

    const banner = document.getElementById('status-banner');
    const bannerText = document.getElementById('banner-text');
    banner.className = 'status-banner banner-info';
    bannerText.innerHTML = `<strong>🟢 LIVE USB STREAM ACTIVE:</strong> Connected to ESP32 at 115200 baud. Receiving real-time GY-BMP280 sensor telemetry...`;

    readSerialStream(port);
  } catch (err) {
    console.error('Serial connection error:', err);
    if (err.name !== 'NotFoundError') {
      alert(`Could not open ESP32 COM port: ${err.message}\nEnsure Serial Monitor in PlatformIO/Arduino is closed.`);
    }
  }
}

async function readSerialStream(port) {
  const textDecoder = new TextDecoderStream();
  state.serial.readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
  const reader = textDecoder.readable.getReader();
  state.serial.reader = reader;

  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        buffer += value;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop(); // Keep partial line for next iteration

        for (const line of lines) {
          processLiveSerialLine(line.trim());
        }
      }
    }
  } catch (err) {
    console.warn('Serial stream read error or closed:', err);
  } finally {
    reader.releaseLock();
    disconnectSerial();
  }
}

async function disconnectSerial() {
  if (state.serial.reader) {
    try {
      await state.serial.reader.cancel();
    } catch (e) { }
    state.serial.reader = null;
  }
  if (state.serial.readableStreamClosed) {
    try {
      await state.serial.readableStreamClosed;
    } catch (e) { }
    state.serial.readableStreamClosed = null;
  }
  if (state.serial.port) {
    try {
      await state.serial.port.close();
    } catch (e) { }
    state.serial.port = null;
  }

  state.serial.isConnected = false;
  updateSerialButtonUI(false);

  const banner = document.getElementById('status-banner');
  const bannerText = document.getElementById('banner-text');
  banner.className = 'status-banner banner-info';
  bannerText.innerHTML = `ESP32 Disconnected. ${state.records.length} real-time records recorded.`;
}

function updateSerialButtonUI(connected) {
  const btn = document.getElementById('btn-live-serial');
  if (btn) {
    if (connected) {
      btn.className = 'btn btn-live connected';
      btn.innerHTML = `<span class="live-dot"></span><i data-lucide="radio-tower"></i> Disconnect ESP32`;
    } else {
      btn.className = 'btn btn-live';
      btn.innerHTML = `<span class="live-dot"></span><i data-lucide="radio"></i> Connect ESP32 (Live USB)`;
    }
  }

  const btnSync = document.getElementById('btn-sync-qnh-hardware');
  const syncHint = document.getElementById('cal-sync-hint');
  if (btnSync) {
    btnSync.disabled = !connected;
  }
  if (syncHint) {
    syncHint.textContent = connected
      ? 'ESP32 connected via USB. Click to calibrate QNH & persist to NVS Flash.'
      : 'Connect ESP32 via USB Serial to calibrate altitude in real time.';
  }

  if (window.lucide) lucide.createIcons();
}

/**
 * Parses live $AERO packet emitted by the ESP32:
 * Modern format: $AERO,timestamp_s,temp_C,press_hPa,alt_m,qnh_hpa
 * Legacy format: $AERO,timestamp_s,temp_C,press_hPa,alt_m,hum_pct,trend_hPa_h,forecast,rain_risk
 */
function processLiveSerialLine(line) {
  if (!line) return;

  // Handle hardware calibration confirmation response
  if (line.startsWith('$CAL_OK,')) {
    console.log('ESP32 Calibration Response:', line);
    const syncPill = document.getElementById('cal-sync-pill');
    const syncHint = document.getElementById('cal-sync-hint');
    if (syncPill) {
      syncPill.className = 'cal-status-pill active-sync';
      syncPill.textContent = 'Hardware Synchronized (NVS Stored)';
    }
    if (syncHint) {
      syncHint.innerHTML = `<span class="text-success"><i data-lucide="check-circle-2"></i> ${line} - Altitude calibrated & stored in Flash!</span>`;
      if (window.lucide) lucide.createIcons();
    }
    return;
  }

  if (!line.startsWith('$AERO,')) return;

  const parts = line.split(',');
  if (parts.length < 5) return;

  const timeSec = parseFloat(parts[1]) || (Date.now() / 1000);
  const temp = parseFloat(parts[2]);
  const press = parseFloat(parts[3]);
  const alt = parseFloat(parts[4]);

  if (isNaN(temp) || isNaN(press) || isNaN(alt)) return;

  let hum, trend, forecast, rainRisk;
  if (parts.length === 9) {
    // Legacy 9-field packet
    hum = parseFloat(parts[5]);
    trend = parseFloat(parts[6]) || 0.0;
    forecast = parts[7].trim();
    rainRisk = parseInt(parts[8]) || 0;
  } else {
    // Modern $AERO packet with QNH and GPS coordinates
    hum = Math.min(98, Math.max(15, 65.0 - (temp - 20.0) * 1.8 + (1013.25 - press) * 0.4));
    trend = (state.records.length > 0) ? (press - state.records[state.records.length - 1].press) * 12.0 : 0.0;
    rainRisk = computeRainRisk(press, trend, hum);
    forecast = getZambrettiForecast(press, trend);
  }

  // Parse NEO-6M GPS Geodetic Fields: $AERO,time,temp,press,alt,qnh,lat,lon,speed,sats,fix
  let lat = null, lon = null, speed = 0, sats = 0, validFix = false;
  if (parts.length >= 10) {
    const pLat = parseFloat(parts[6]);
    const pLon = parseFloat(parts[7]);
    if (!isNaN(pLat) && !isNaN(pLon) && (Math.abs(pLat) > 0.0001 || Math.abs(pLon) > 0.0001)) {
      lat = pLat;
      lon = pLon;
      validFix = parts.length >= 11 ? (parseInt(parts[10]) === 1) : true;
    }
    speed = parseFloat(parts[8]) || 0;
    sats = parseInt(parts[9]) || 0;
  }

  const dewPoint = calculateDewPoint(temp, hum);
  const cloudBase = calculateCloudBase(temp, dewPoint);

  state.serial.receivedCount++;
  const recordNum = state.serial.receivedCount;

  const newRecord = {
    record: recordNum,
    time: Math.round(timeSec),
    temp: parseFloat(temp.toFixed(2)),
    press: parseFloat(press.toFixed(2)),
    alt: parseFloat(alt.toFixed(1)),
    humidity: parseFloat(hum.toFixed(1)),
    dewPoint: parseFloat(dewPoint.toFixed(1)),
    cloudBase: Math.max(0, Math.round(cloudBase)),
    trend: parseFloat(trend.toFixed(2)),
    forecast: forecast,
    rainRisk: Math.min(100, Math.max(0, rainRisk)),
    lat: lat,
    lon: lon,
    speed: speed,
    sats: sats,
    validFix: validFix
  };

  state.records.push(newRecord);
  // Retain all historical records - never drop older telemetry
  state.filteredRecords = [...state.records];

  // Live GPS Map Update
  if (lat !== null && lon !== null) {
    updateGpsUIAndMap(newRecord);
  }

  // 1. Instant smooth KPI updates (one-by-one streaming without page flash)
  const bannerCount = document.getElementById('banner-records-count');
  if (bannerCount) bannerCount.textContent = `${state.records.length} Records Analyzed (Live USB Stream)`;
  const valAlt = document.getElementById('val-altitude');
  if (valAlt) valAlt.innerHTML = `${newRecord.alt.toFixed(1)} <span class="unit">m</span>`;
  const valPress = document.getElementById('val-pressure');
  if (valPress) valPress.innerHTML = `${newRecord.press.toFixed(1)} <span class="unit">hPa</span>`;
  const valTemp = document.getElementById('val-temp');
  if (valTemp) valTemp.innerHTML = `${newRecord.temp.toFixed(1)} <span class="unit">°C</span>`;
  updateFlowBarPointer(newRecord.alt, newRecord.press);

  // 2. Schedule smooth throttled engine run (charts + table + summary)
  scheduleWebDashUpdate(2000);
}

let liveWebDashTimeout = null;
let lastWebDashRunTime = 0;

function scheduleWebDashUpdate(throttleMs = 2000) {
  const now = Date.now();
  if (now - lastWebDashRunTime >= throttleMs) {
    if (liveWebDashTimeout) clearTimeout(liveWebDashTimeout);
    liveWebDashTimeout = null;
    lastWebDashRunTime = now;
    computeSummary();
    updateUI('Live USB Stream');
    updateCharts('none');
    renderTable();
  } else if (!liveWebDashTimeout) {
    liveWebDashTimeout = setTimeout(() => {
      liveWebDashTimeout = null;
      lastWebDashRunTime = Date.now();
      computeSummary();
      updateUI('Live USB Stream');
      updateCharts('none');
      renderTable();
    }, throttleMs - (now - lastWebDashRunTime));
  }
}

// ==============================================================================
// Clean Initial State (No Fake Data!)
// ==============================================================================

function resetToLiveReadyState() {
  state.records = [];
  state.filteredRecords = [];
  state.currentPage = 1;

  state.summary = {
    maxAltitude: 0,
    minAltitude: 0,
    currentPressure: 1013.25,
    pressureTrend: 0,
    minTemp: 0,
    maxTemp: 0,
    avgTemp: 0,
    avgHumidity: 0,
    dewPoint: 0,
    cloudBase: 0,
    maxRainRisk: 0,
    latestForecast: 'Standby'
  };

  // Reset Banner
  const banner = document.getElementById('status-banner');
  const bannerText = document.getElementById('banner-text');
  const bannerCount = document.getElementById('banner-records-count');
  banner.className = 'status-banner banner-info';
  bannerText.innerHTML = `<strong>AWAITING FILE DROP:</strong> Please drag and drop your <code>aerosense.csv</code> SD card file to analyze your real sensor data.`;
  bannerCount.textContent = 'No Data Loaded';

  // Reset Metrics Cards
  document.getElementById('val-altitude').innerHTML = `-- <span class="unit">m</span>`;
  document.getElementById('sub-altitude').innerHTML = `<span>Ground: -- m</span> • <span>Gain: -- m</span>`;
  document.getElementById('bar-altitude').style.width = '0%';

  document.getElementById('val-pressure').innerHTML = `-- <span class="unit">hPa</span>`;
  document.getElementById('pressure-trend-text').textContent = 'Tendency: -- hPa/h (No File Loaded)';
  document.getElementById('bar-pressure').style.width = '0%';

  document.getElementById('val-temp').innerHTML = `-- <span class="unit">°C</span>`;
  document.getElementById('sub-temp').innerHTML = `<span>Min: -- °C</span> • <span>Max: -- °C</span>`;

  document.getElementById('val-humidity').innerHTML = `-- <span class="unit">%</span>`;
  document.getElementById('sub-humidity').innerHTML = `<span>Dew Point: -- °C</span> • <span>Cloud Base: -- m</span>`;
  document.getElementById('bar-humidity').style.width = '0%';

  document.getElementById('val-rain').innerHTML = `-- <span class="unit">%</span>`;
  document.getElementById('badge-forecast').textContent = 'No File Loaded';
  document.getElementById('bar-rain').style.width = '0%';

  // Reset Flow bar pointer (Hidden until file is dropped)
  updateFlowBarPointer(0, 1013.25, false);

  // Reset Flowchart
  document.getElementById('fn-baro-desc').textContent = 'Current: Awaiting File';
  document.getElementById('fn-trend-desc').textContent = 'Rate: -- hPa/hr';
  document.getElementById('fn-dew-desc').textContent = 'RH: --% | Td: --°C';
  document.getElementById('fn-forecast-desc').textContent = 'Status: Awaiting File';

  // Clear charts
  if (state.charts.altitude) {
    state.charts.altitude.data.labels = [];
    state.charts.altitude.data.datasets[0].data = [];
    state.charts.altitude.update();
  }
  if (state.charts.pressure) {
    state.charts.pressure.data.labels = [];
    state.charts.pressure.data.datasets[0].data = [];
    state.charts.pressure.data.datasets[1].data = [];
    state.charts.pressure.data.datasets[2].data = [];
    state.charts.pressure.update();
  }
  if (state.charts.temphum) {
    state.charts.temphum.data.labels = [];
    state.charts.temphum.data.datasets[0].data = [];
    state.charts.temphum.data.datasets[1].data = [];
    state.charts.temphum.data.datasets[2].data = [];
    state.charts.temphum.update();
  }
  if (state.charts.lapse) {
    state.charts.lapse.data.datasets[0].data = [];
    state.charts.lapse.data.datasets[1].data = [];
    state.charts.lapse.update();
  }

  // Clear GPS Map Track & Sidebar
  if (state.gps.trackPolyline) state.gps.trackPolyline.setLatLngs([]);
  if (state.gps.waypointLayerGroup) state.gps.waypointLayerGroup.clearLayers();
  state.gps.totalDistanceKm = 0;
  state.gps.latestLat = null;
  state.gps.latestLon = null;
  state.gps.hasFix = false;
  updateGpsSidebarStats(null);

  // Clear Table
  renderTable();

  if (window.lucide) lucide.createIcons();
}

// ==============================================================================
// File & CSV Parsing
// ==============================================================================

function handleFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    parseCSV(e.target.result, file.name);
  };
  reader.readAsText(file);
}

function parseCSV(csvText, sourceName) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) {
    alert('File or input does not contain enough CSV records.');
    return;
  }

  const records = [];
  const header = lines[0].toLowerCase().split(',');

  // Identify column indices
  let colRecord = header.findIndex(h => h.includes('record'));
  let colTime = header.findIndex(h => h.includes('time') || h.includes('sec'));
  let colTemp = header.findIndex(h => h.includes('temp'));
  let colPress = header.findIndex(h => h.includes('press') || h.includes('baro'));
  let colAlt = header.findIndex(h => h.includes('alt'));
  let colHum = header.findIndex(h => h.includes('hum'));
  let colTrend = header.findIndex(h => h.includes('trend'));
  let colForecast = header.findIndex(h => h.includes('forecast'));
  let colRainRisk = header.findIndex(h => h.includes('rain') || h.includes('risk'));
  let colLat = header.findIndex(h => h.includes('lat'));
  let colLon = header.findIndex(h => h.includes('lon') || h.includes('lng'));
  let colSpeed = header.findIndex(h => h.includes('speed') || h.includes('spd'));
  let colSats = header.findIndex(h => h.includes('sat'));
  let colFix = header.findIndex(h => h.includes('fix'));
  let colQnh = header.findIndex(h => h.includes('qnh'));

  // Default fallbacks if header doesn't match standard
  if (colTemp === -1) colTemp = 2;
  if (colPress === -1) colPress = 3;
  if (colAlt === -1) colAlt = 4;
  if (colHum === -1) colHum = 5;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(',');
    if (parts.length < 4) continue;

    const recordId = colRecord !== -1 && parts[colRecord] ? parseInt(parts[colRecord]) : i;
    const timeSec = colTime !== -1 && parts[colTime] ? parseFloat(parts[colTime]) : (i * 5);
    const temp = parseFloat(parts[colTemp]);
    const press = parseFloat(parts[colPress]);
    const alt = parseFloat(parts[colAlt]) || calculateAltitudeFromPressure(press);
    const hum = colHum !== -1 && parts[colHum] ? parseFloat(parts[colHum]) : 60.0;
    const trend = colTrend !== -1 && parts[colTrend] ? parseFloat(parts[colTrend]) : 0.0;
    let forecast = colForecast !== -1 && parts[colForecast] ? parts[colForecast].trim() : '';
    let rainRisk = colRainRisk !== -1 && parts[colRainRisk] ? parseInt(parts[colRainRisk]) : null;

    if (isNaN(temp) || isNaN(press)) continue;

    // Atmospheric Derived Values
    const dewPoint = calculateDewPoint(temp, hum);
    const cloudBase = calculateCloudBase(temp, dewPoint);

    if (rainRisk === null || isNaN(rainRisk)) {
      rainRisk = computeRainRisk(press, trend, hum);
    }
    if (!forecast) {
      forecast = getZambrettiForecast(press, trend);
    }

    // Geodetic GPS extraction
    let lat = null, lon = null, speed = 0, sats = 0, validFix = false;
    if (colLat !== -1 && parts[colLat]) {
      const pLat = parseFloat(parts[colLat]);
      const pLon = colLon !== -1 && parts[colLon] ? parseFloat(parts[colLon]) : NaN;
      if (!isNaN(pLat) && !isNaN(pLon) && (Math.abs(pLat) > 0.0001 || Math.abs(pLon) > 0.0001)) {
        lat = pLat;
        lon = pLon;
        validFix = colFix !== -1 && parts[colFix] ? (parseInt(parts[colFix]) > 0 || parts[colFix].toLowerCase().includes('true')) : true;
      }
    }
    if (colSpeed !== -1 && parts[colSpeed]) {
      const spd = parseFloat(parts[colSpeed]);
      if (!isNaN(spd)) speed = spd;
    }
    if (colSats !== -1 && parts[colSats]) {
      const s = parseInt(parts[colSats]);
      if (!isNaN(s)) sats = s;
    }
    const qnh = colQnh !== -1 && parts[colQnh] ? parseFloat(parts[colQnh]) : 1013.25;

    records.push({
      record: recordId,
      time: Math.round(timeSec),
      temp: parseFloat(temp.toFixed(2)),
      press: parseFloat(press.toFixed(2)),
      alt: parseFloat(alt.toFixed(1)),
      humidity: parseFloat(hum.toFixed(1)),
      dewPoint: parseFloat(dewPoint.toFixed(1)),
      cloudBase: Math.max(0, Math.round(cloudBase)),
      trend: parseFloat(trend.toFixed(2)),
      forecast: forecast,
      rainRisk: Math.min(100, Math.max(0, rainRisk)),
      lat: lat,
      lon: lon,
      speed: speed,
      sats: sats,
      validFix: validFix,
      qnh: qnh
    });
  }

  if (records.length === 0) {
    alert('Could not parse any valid records from CSV.');
    return;
  }

  state.records = records;
  state.filteredRecords = [...records];
  state.currentPage = 1;

  computeSummary();
  updateUI(sourceName);
  updateCharts();
  refreshGpsTrackFromRecords(records);
  renderTable();
}

// ==============================================================================
// Atmospheric & Meteorological Physics Models
// ==============================================================================

/**
 * Calculate Dew Point (°C) using Magnus-Tetens approximation
 */
function calculateDewPoint(T, RH) {
  if (isNaN(T) || isNaN(RH)) return 0;
  const a = 17.27;
  const b = 237.7;
  const alpha = ((a * T) / (b + T)) + Math.log(Math.max(0.01, RH) / 100.0);
  return (b * alpha) / (a - alpha);
}

/**
 * Lifted Condensation Level (Cloud Base) in meters
 * H_LCL ≈ 125 * (T - T_d)
 */
function calculateCloudBase(T, Td) {
  return Math.max(0, 125.0 * (T - Td));
}

/**
 * Standard barometric hypsometric formula for altitude (m)
 */
function calculateAltitudeFromPressure(P, P0 = 1013.25) {
  return 44330.0 * (1.0 - Math.pow(P / P0, 0.1902949));
}

/**
 * Dynamic Rain Probability Assessment (0 - 100%)
 */
function computeRainRisk(P, trend, RH) {
  let risk = 20;
  if (P < 995) risk += 50;
  else if (P < 1005) risk += 35;
  else if (P < 1012) risk += 15;
  else if (P > 1022) risk -= 15;

  if (trend < -1.8) risk += 45;
  else if (trend < -0.8) risk += 30;
  else if (trend < -0.3) risk += 15;
  else if (trend > 1.0) risk -= 20;

  if (RH > 80) risk += 20;
  else if (RH < 45) risk -= 10;

  return Math.min(100, Math.max(0, Math.round(risk)));
}

/**
 * Zambretti Forecaster Algorithm Map
 */
function getZambrettiForecast(P, trend) {
  if (trend < -1.8) return 'STORM FRONT ALERT';
  if (trend < -0.8 && P < 1008) return 'RAIN IMMINENT';
  if (trend < -0.3 || P < 1005) return 'SHOWERS LIKELY';
  if (P < 1012) return 'CLOUDY / OVERCAST';
  if (P >= 1012 && P < 1020 && trend >= -0.3) return 'FAIR WEATHER';
  if (P >= 1020 && trend >= 0) return 'SUNNY & CLEAR';
  return 'PARTLY CLOUDY';
}

// ==============================================================================
// Summary Analytics & UI Updates
// ==============================================================================

function computeSummary() {
  const recs = state.records;
  if (recs.length === 0) return;

  let maxAlt = -9999, minAlt = 9999;
  let minT = 999, maxT = -999, sumT = 0;
  let sumHum = 0;
  let maxRisk = 0;

  recs.forEach(r => {
    if (r.alt > maxAlt) maxAlt = r.alt;
    if (r.alt < minAlt) minAlt = r.alt;
    if (r.temp > maxT) maxT = r.temp;
    if (r.temp < minT) minT = r.temp;
    sumT += r.temp;
    sumHum += r.humidity;
    if (r.rainRisk > maxRisk) maxRisk = r.rainRisk;
  });

  const last = recs[recs.length - 1];
  const first = recs[0];
  const hours = Math.max(0.01, (last.time - first.time) / 3600);
  const dpdt = (last.press - first.press) / hours;

  state.summary = {
    maxAltitude: maxAlt,
    minAltitude: minAlt,
    currentPressure: last.press,
    pressureTrend: last.trend !== 0 ? last.trend : dpdt,
    minTemp: minT,
    maxTemp: maxT,
    avgTemp: sumT / recs.length,
    avgHumidity: sumHum / recs.length,
    dewPoint: calculateDewPoint(last.temp, last.humidity),
    cloudBase: last.cloudBase,
    maxRainRisk: maxRisk,
    latestForecast: last.forecast
  };
}

function updateUI(sourceName) {
  const s = state.summary;
  const count = state.records.length;

  // Banner
  const banner = document.getElementById('status-banner');
  const bannerText = document.getElementById('banner-text');
  const bannerCount = document.getElementById('banner-records-count');

  bannerCount.textContent = `${count} Records Analyzed (${sourceName})`;

  if (s.maxRainRisk >= 75) {
    banner.className = 'status-banner banner-alert';
    bannerText.innerHTML = `<strong>CRITICAL WEATHER WARNING:</strong> Severe barometric drop detected (Rain Risk: ${s.maxRainRisk}%). Storm front active.`;
  } else if (s.maxRainRisk >= 45) {
    banner.className = 'status-banner banner-warn';
    bannerText.innerHTML = `<strong>WEATHER ALERT:</strong> Unsettled barometric conditions detected. Precipitation likely (Rain Risk: ${s.maxRainRisk}%).`;
  } else {
    banner.className = 'status-banner banner-info';
    bannerText.innerHTML = `<strong>STABLE CONDITIONS:</strong> High-pressure anticyclone dominant. Clear/Fair weather forecast.`;
  }

  // Altitude Card
  document.getElementById('val-altitude').innerHTML = `${s.maxAltitude.toFixed(1)} <span class="unit">m</span>`;
  document.getElementById('sub-altitude').innerHTML = `<span>Ground: ${s.minAltitude.toFixed(1)} m</span> • <span>Gain: +${(s.maxAltitude - s.minAltitude).toFixed(1)} m</span>`;
  const altPercent = Math.min(100, (s.maxAltitude / 3000) * 100);
  document.getElementById('bar-altitude').style.width = `${Math.max(5, altPercent)}%`;

  // Barometer Card
  document.getElementById('val-pressure').innerHTML = `${s.currentPressure.toFixed(1)} <span class="unit">hPa</span>`;
  const trendSign = s.pressureTrend >= 0 ? '+' : '';
  const trendIcon = s.pressureTrend < -1.0 ? 'trending-down' : (s.pressureTrend > 1.0 ? 'trending-up' : 'minus');
  document.getElementById('pressure-trend-icon').innerHTML = `<i data-lucide="${trendIcon}"></i>`;
  document.getElementById('pressure-trend-text').textContent = `Tendency: ${trendSign}${s.pressureTrend.toFixed(2)} hPa/h`;

  // Temperature Card
  document.getElementById('val-temp').innerHTML = `${s.avgTemp.toFixed(1)} <span class="unit">°C</span>`;
  document.getElementById('sub-temp').innerHTML = `<span>Min: ${s.minTemp.toFixed(1)} °C</span> • <span>Max: ${s.maxTemp.toFixed(1)} °C</span>`;

  // Humidity Card
  document.getElementById('val-humidity').innerHTML = `${s.avgHumidity.toFixed(0)} <span class="unit">%</span>`;
  document.getElementById('sub-humidity').innerHTML = `<span>Dew Point: ${s.dewPoint.toFixed(1)} °C</span> • <span>Cloud Base: ${s.cloudBase} m</span>`;
  document.getElementById('bar-humidity').style.width = `${s.avgHumidity}%`;

  // Rain Probability Card
  document.getElementById('val-rain').innerHTML = `${s.maxRainRisk} <span class="unit">%</span>`;
  document.getElementById('badge-forecast').textContent = s.latestForecast;
  document.getElementById('bar-rain').style.width = `${s.maxRainRisk}%`;

  // Update Atmospheric Flow Bar Pointer
  updateFlowBarPointer(s.maxAltitude, s.currentPressure);

  // Update Decision Flowchart Nodes
  updateFlowChart(s);

  // Re-render Lucide Icons for dynamic content
  if (window.lucide) lucide.createIcons();
}

/**
 * Update the Tropospheric Flow Bar marker position
 */
function updateFlowBarPointer(alt, press, visible = true) {
  const pointer = document.getElementById('flowbar-pointer');
  if (!pointer) return;
  if (!visible) {
    pointer.style.display = 'none';
    return;
  }
  pointer.style.display = 'flex';
  const markerAlt = document.getElementById('marker-alt');
  const markerPress = document.getElementById('marker-press');

  markerAlt.textContent = `${alt.toFixed(0)} m`;
  markerPress.textContent = `${press.toFixed(1)} hPa`;

  const percent = Math.min(95, Math.max(5, (alt / 3000) * 100));
  pointer.style.left = `${percent}%`;
}

/**
 * Dynamically activate Flowchart decision steps
 */
function updateFlowChart(s) {
  const fnBaro = document.getElementById('fn-baro');
  const fnTrend = document.getElementById('fn-trend');
  const fnDew = document.getElementById('fn-dew');
  const fnForecast = document.getElementById('fn-forecast');

  document.getElementById('fn-baro-desc').textContent = `QNH: ${s.currentPressure.toFixed(1)} hPa`;
  document.getElementById('fn-trend-desc').textContent = `Rate: ${s.pressureTrend >= 0 ? '+' : ''}${s.pressureTrend.toFixed(2)} hPa/h`;
  document.getElementById('fn-dew-desc').textContent = `RH: ${s.avgHumidity.toFixed(0)}% | Td: ${s.dewPoint.toFixed(1)}°C`;
  document.getElementById('fn-forecast-desc').textContent = `${s.latestForecast} (${s.maxRainRisk}%)`;

  [fnBaro, fnTrend, fnDew, fnForecast].forEach(n => {
    n.classList.remove('node-alert');
    n.classList.add('node-active');
  });

  if (s.maxRainRisk >= 70) {
    fnTrend.classList.add('node-alert');
    fnForecast.classList.add('node-alert');
    document.getElementById('fn-trend-badge').textContent = 'Rapid Pressure Drop!';
    document.getElementById('fn-forecast-badge').textContent = 'Heavy Rain / Storm';
  } else if (s.maxRainRisk >= 40) {
    document.getElementById('fn-trend-badge').textContent = 'Negative Tendency';
    document.getElementById('fn-forecast-badge').textContent = 'Showers Probable';
  } else {
    document.getElementById('fn-trend-badge').textContent = 'Stable Pressure';
    document.getElementById('fn-forecast-badge').textContent = 'Fair Skies Ahead';
  }
}

// ==============================================================================
// Chart.js Visualizations Setup
// ==============================================================================

function initCharts() {
  const chartOptionsBase = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    plugins: {
      legend: {
        labels: {
          font: { family: "'Inter', sans-serif", size: 11 },
          color: '#475569',
          boxWidth: 12
        }
      },
      tooltip: {
        backgroundColor: '#0f172a',
        titleFont: { family: "'Outfit', sans-serif", weight: 'bold' },
        bodyFont: { family: "'JetBrains Mono', monospace", size: 12 },
        padding: 10,
        cornerRadius: 8
      }
    },
    scales: {
      x: {
        grid: { color: 'rgba(226, 232, 240, 0.6)' },
        ticks: { font: { family: "'JetBrains Mono', monospace", size: 10 }, color: '#64748b' }
      },
      y: {
        grid: { color: 'rgba(226, 232, 240, 0.6)' },
        ticks: { font: { family: "'JetBrains Mono', monospace", size: 10 }, color: '#64748b' }
      }
    }
  };

  // 1. Altitude Profile Chart
  const ctxAlt = document.getElementById('chart-altitude').getContext('2d');
  state.charts.altitude = new Chart(ctxAlt, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Altitude Elevation (m)',
        data: [],
        borderColor: '#0284c7',
        backgroundColor: 'rgba(2, 132, 199, 0.12)',
        borderWidth: 2.5,
        fill: true,
        tension: 0.35,
        pointRadius: 0,
        pointHoverRadius: 5
      }]
    },
    options: chartOptionsBase
  });

  // 2. Barometric Pressure & Rain Alert Chart
  const ctxPress = document.getElementById('chart-pressure').getContext('2d');
  state.charts.pressure = new Chart(ctxPress, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Barometric Pressure (hPa)',
          data: [],
          borderColor: '#7c3aed',
          backgroundColor: 'rgba(124, 58, 237, 0.08)',
          borderWidth: 2.5,
          fill: true,
          tension: 0.3,
          pointRadius: 0
        },
        {
          label: 'Rain Warning Line (1008 hPa)',
          data: [],
          borderColor: '#f59e0b',
          borderDash: [5, 5],
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false
        },
        {
          label: 'Storm Alert Line (1000 hPa)',
          data: [],
          borderColor: '#ef4444',
          borderDash: [4, 4],
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false
        }
      ]
    },
    options: chartOptionsBase
  });

  // 3. Temp & Humidity Dual Correlation
  const ctxTempHum = document.getElementById('chart-temphum').getContext('2d');
  state.charts.temphum = new Chart(ctxTempHum, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Temperature (°C)',
          data: [],
          borderColor: '#dc2626',
          borderWidth: 2,
          yAxisID: 'y',
          tension: 0.3,
          pointRadius: 0
        },
        {
          label: 'Humidity (%RH)',
          data: [],
          borderColor: '#06b6d4',
          borderWidth: 2,
          yAxisID: 'y1',
          tension: 0.3,
          pointRadius: 0
        },
        {
          label: 'Dew Point (°C)',
          data: [],
          borderColor: '#10b981',
          borderDash: [3, 3],
          borderWidth: 1.5,
          yAxisID: 'y',
          tension: 0.3,
          pointRadius: 0
        }
      ]
    },
    options: {
      ...chartOptionsBase,
      scales: {
        x: chartOptionsBase.scales.x,
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          title: { display: true, text: 'Temperature (°C)', font: { size: 10 } },
          grid: { color: 'rgba(226, 232, 240, 0.6)' }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          title: { display: true, text: 'Humidity (%)', font: { size: 10 } },
          grid: { drawOnChartArea: false },
          min: 0,
          max: 100
        }
      }
    }
  });

  // 4. Pressure vs Altitude Hypsometric Lapse Curve
  const ctxLapse = document.getElementById('chart-lapse').getContext('2d');
  state.charts.lapse = new Chart(ctxLapse, {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: 'AeroSense Recorded Profile',
          data: [],
          borderColor: '#2563eb',
          backgroundColor: '#38bdf8',
          borderWidth: 2,
          pointRadius: 3,
          showLine: true,
          tension: 0.2
        },
        {
          label: 'Theoretical Standard ISA Curve',
          data: [],
          borderColor: '#94a3b8',
          borderDash: [4, 4],
          borderWidth: 1.5,
          pointRadius: 0,
          showLine: true
        }
      ]
    },
    options: {
      ...chartOptionsBase,
      scales: {
        x: {
          type: 'linear',
          position: 'bottom',
          title: { display: true, text: 'Altitude (m)', font: { size: 10 } },
          grid: { color: 'rgba(226, 232, 240, 0.6)' }
        },
        y: {
          title: { display: true, text: 'Pressure (hPa)', font: { size: 10 } },
          grid: { color: 'rgba(226, 232, 240, 0.6)' }
        }
      }
    }
  });
}

function updateCharts(updateMode) {
  const recs = state.records;
  if (!recs || recs.length === 0) return;

  const step = Math.max(1, Math.floor(recs.length / 120));
  const sampled = [];
  for (let i = 0; i < recs.length; i += step) {
    sampled.push(recs[i]);
  }
  if (sampled[sampled.length - 1] !== recs[recs.length - 1]) {
    sampled.push(recs[recs.length - 1]);
  }

  const timeLabels = sampled.map(r => formatTime(r.time));

  // 1. Update Altitude Chart
  state.charts.altitude.data.labels = timeLabels;
  state.charts.altitude.data.datasets[0].data = sampled.map(r => r.alt);
  state.charts.altitude.update(updateMode);

  // 2. Update Pressure Chart
  state.charts.pressure.data.labels = timeLabels;
  state.charts.pressure.data.datasets[0].data = sampled.map(r => r.press);
  state.charts.pressure.data.datasets[1].data = sampled.map(() => 1008);
  state.charts.pressure.data.datasets[2].data = sampled.map(() => 1000);
  state.charts.pressure.update(updateMode);

  // 3. Update Temp & Hum Chart
  state.charts.temphum.data.labels = timeLabels;
  state.charts.temphum.data.datasets[0].data = sampled.map(r => r.temp);
  state.charts.temphum.data.datasets[1].data = sampled.map(r => r.humidity);
  state.charts.temphum.data.datasets[2].data = sampled.map(r => r.dewPoint);
  state.charts.temphum.update(updateMode);

  // 4. Update Hypsometric Lapse Curve
  const sortedByAlt = [...sampled].sort((a, b) => a.alt - b.alt);
  state.charts.lapse.data.datasets[0].data = sortedByAlt.map(r => ({ x: r.alt, y: r.press }));

  const minAlt = sortedByAlt[0].alt;
  const maxAlt = sortedByAlt[sortedByAlt.length - 1].alt;
  const isaData = [];
  const altStep = (maxAlt - minAlt) / 10 || 50;
  for (let a = minAlt; a <= maxAlt; a += altStep) {
    const pIsa = 1013.25 * Math.pow(1.0 - (0.0065 * a) / 288.15, 5.255);
    isaData.push({ x: a, y: parseFloat(pIsa.toFixed(1)) });
  }
  state.charts.lapse.data.datasets[1].data = isaData;
  state.charts.lapse.update(updateMode);
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// ==============================================================================
// Interactive Filterable Table
// ==============================================================================

function applyTableFilters() {
  const query = document.getElementById('table-search').value.toLowerCase();
  const condition = document.getElementById('filter-condition').value;

  state.filteredRecords = state.records.filter(r => {
    const textMatch = !query ||
      r.record.toString().includes(query) ||
      r.forecast.toLowerCase().includes(query) ||
      r.alt.toString().includes(query) ||
      r.temp.toString().includes(query) ||
      r.press.toString().includes(query) ||
      (r.lat && r.lat.toString().includes(query)) ||
      (r.lon && r.lon.toString().includes(query));

    if (!textMatch) return false;

    if (condition === 'gps') return r.lat !== null && r.lon !== null;
    if (condition === 'rain') return r.rainRisk >= 60;
    if (condition === 'clear') return r.rainRisk < 35;
    if (condition === 'high-alt') return r.alt > 500;
    return true;
  });

  state.currentPage = 1;
  renderTable();
}

function renderTable() {
  const tbody = document.getElementById('table-body');
  const pageInfo = document.getElementById('page-info');
  const btnPrev = document.getElementById('btn-prev-page');
  const btnNext = document.getElementById('btn-next-page');

  const total = state.filteredRecords.length;
  if (total === 0) {
    tbody.innerHTML = `<tr><td colspan="13" class="empty-table-msg">No data loaded yet. Connect your ESP32 via USB or drop an aerosense.csv SD file.</td></tr>`;
    pageInfo.textContent = 'Showing 0 of 0 records';
    btnPrev.disabled = true;
    btnNext.disabled = true;
    return;
  }

  const totalPages = Math.ceil(total / state.pageSize);
  const startIndex = (state.currentPage - 1) * state.pageSize;
  const endIndex = Math.min(startIndex + state.pageSize, total);
  const pageRecords = state.filteredRecords.slice(startIndex, endIndex);

  tbody.innerHTML = pageRecords.map(r => {
    let riskBadgeClass = 'badge-risk-low';
    if (r.rainRisk >= 70) riskBadgeClass = 'badge-risk-high';
    else if (r.rainRisk >= 40) riskBadgeClass = 'badge-risk-med';

    const hasGps = r.lat !== null && r.lat !== undefined && r.lon !== null && r.lon !== undefined;
    const latStr = hasGps ? r.lat.toFixed(5) : '--';
    const lonStr = hasGps ? r.lon.toFixed(5) : '--';
    const spdStr = r.speed !== undefined ? r.speed.toFixed(1) : '--';
    const satStr = r.sats !== undefined ? r.sats : 0;

    const mapActionBtn = hasGps
      ? `<button class="btn-map-action" onclick="focusWaypointOnMap(${r.lat}, ${r.lon}, ${r.record})"><i data-lucide="map-pin"></i> View</button>`
      : `<span class="text-muted" style="font-size: 0.72rem;">No Fix</span>`;

    return `
      <tr>
        <td>#${r.record}</td>
        <td>${r.time}s</td>
        <td><strong>${r.alt.toFixed(1)} m</strong></td>
        <td>${r.press.toFixed(2)} hPa</td>
        <td>${r.temp.toFixed(1)}°C</td>
        <td>${r.humidity.toFixed(0)}%</td>
        <td><span style="font-family: var(--font-mono); font-size: 0.8rem; color: #0284c7;">${latStr}</span></td>
        <td><span style="font-family: var(--font-mono); font-size: 0.8rem; color: #0284c7;">${lonStr}</span></td>
        <td>${spdStr}</td>
        <td><span style="background: #e0f2fe; color: #0369a1; padding: 2px 7px; border-radius: 9999px; font-weight: 700; font-size: 0.75rem;">${satStr}</span></td>
        <td>${r.forecast}</td>
        <td><span class="badge-risk ${riskBadgeClass}">${r.rainRisk}%</span></td>
        <td>${mapActionBtn}</td>
      </tr>
    `;
  }).join('');

  pageInfo.textContent = `Showing ${startIndex + 1} to ${endIndex} of ${total} records`;
  btnPrev.disabled = state.currentPage <= 1;
  btnNext.disabled = state.currentPage >= totalPages;

  if (window.lucide) lucide.createIcons();
}

// ==============================================================================
// Export Processed CSV
// ==============================================================================

function exportAnalyzedCSV() {
  if (state.records.length === 0) {
    alert('No real-time data to export.');
    return;
  }

  const headers = ['Record', 'Timestamp_s', 'Altitude_m', 'Pressure_hPa', 'Temp_C', 'Humidity_pct', 'Latitude', 'Longitude', 'Speed_kmh', 'Satellites', 'DewPoint_C', 'CloudBase_m', 'Trend_hPa_h', 'Forecast', 'Rain_Risk_pct'];
  const rows = state.records.map(r => [
    r.record,
    r.time,
    r.alt,
    r.press,
    r.temp,
    r.humidity,
    r.lat !== null && r.lat !== undefined ? r.lat.toFixed(6) : '',
    r.lon !== null && r.lon !== undefined ? r.lon.toFixed(6) : '',
    r.speed !== undefined ? r.speed.toFixed(1) : '0.0',
    r.sats !== undefined ? r.sats : '0',
    r.dewPoint,
    r.cloudBase,
    r.trend,
    `"${r.forecast}"`,
    r.rainRisk
  ].join(','));

  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `AeroSense_RealTime_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ==============================================================================
// Soft-Moving Sub-Navigation Bar & Scroll Spy
// ==============================================================================

function initSubNav() {
  const subNav = document.getElementById('sub-nav');
  const navPill = document.getElementById('nav-pill');
  if (!subNav || !navPill) return;

  const buttons = subNav.querySelectorAll('.sub-nav-btn');

  function updatePill(targetBtn) {
    if (!targetBtn) return;
    buttons.forEach(b => b.classList.remove('active'));
    targetBtn.classList.add('active');
    navPill.style.transform = `translateX(${targetBtn.offsetLeft}px)`;
    navPill.style.width = `${targetBtn.offsetWidth}px`;
  }

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const targetSec = document.getElementById(targetId);
      if (targetSec) {
        updatePill(btn);
        const yOffset = -115; // Offset for fixed top navbar and sub-nav
        const y = targetSec.getBoundingClientRect().top + window.pageYOffset + yOffset;
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
    });
  });

  // Initial pill position
  const initialActive = subNav.querySelector('.sub-nav-btn.active') || buttons[0];
  setTimeout(() => updatePill(initialActive), 120);

  window.addEventListener('resize', () => {
    const currentActive = subNav.querySelector('.sub-nav-btn.active');
    updatePill(currentActive);
  });

  // IntersectionObserver for auto-tracking active section on scroll
  const sectionIds = Array.from(buttons).map(b => b.getAttribute('data-target'));
  const sections = sectionIds.map(id => document.getElementById(id)).filter(Boolean);

  if ('IntersectionObserver' in window && sections.length > 0) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const matchBtn = subNav.querySelector(`.sub-nav-btn[data-target="${entry.target.id}"]`);
          if (matchBtn) updatePill(matchBtn);
        }
      });
    }, { rootMargin: '-20% 0px -60% 0px', threshold: 0.1 });

    sections.forEach(sec => observer.observe(sec));
  }
}

// ==============================================================================
// Internet Meteorological Resource & 1-Click Hardware Calibration Engine
// ==============================================================================

const internetData = {
  qnh: null,
  elevation: null,
  surfacePressure: null,
  temperature: null,
  humidity: null,
  weatherCode: null,
  latitude: null,
  longitude: null,
  locationName: 'Detecting Location...',
  lastUpdated: null
};

async function sendSerialCommand(cmdText) {
  if (!state.serial.isConnected || !state.serial.port) {
    alert('Please connect your ESP32 via USB Serial first (click "Connect ESP32 (Live USB)").');
    return false;
  }
  try {
    const encoder = new TextEncoder();
    const writer = state.serial.port.writable.getWriter();
    await writer.write(encoder.encode(cmdText + '\n'));
    writer.releaseLock();
    return true;
  } catch (err) {
    console.error('Failed to write to serial port:', err);
    alert('Failed to send command to ESP32: ' + err.message);
    return false;
  }
}

function initInternetWeatherResource() {
  const btnRefresh = document.getElementById('btn-refresh-internet');
  const btnSync = document.getElementById('btn-sync-qnh-hardware');

  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      fetchInternetWeatherAuto();
    });
  }

  if (btnSync) {
    btnSync.addEventListener('click', async () => {
      if (!internetData.qnh) {
        alert('Waiting for Internet QNH data to finish loading...');
        return;
      }
      btnSync.disabled = true;
      btnSync.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Transmitting $CAL to ESP32...`;
      if (window.lucide) lucide.createIcons();

      const success = await sendSerialCommand(`$CAL,QNH,${internetData.qnh.toFixed(2)}`);
      setTimeout(() => {
        btnSync.disabled = !state.serial.isConnected;
        btnSync.innerHTML = `<i data-lucide="send"></i> 1-Click Sync QNH to ESP32 Flash (USB)`;
        if (window.lucide) lucide.createIcons();
      }, 1000);

      if (success) {
        const syncPill = document.getElementById('cal-sync-pill');
        const syncHint = document.getElementById('cal-sync-hint');
        if (syncPill) {
          syncPill.className = 'cal-status-pill active-sync';
          syncPill.textContent = 'QNH Transmitted to ESP32!';
        }
        if (syncHint) {
          syncHint.innerHTML = `<span class="text-success"><i data-lucide="check-circle-2"></i> Sent $CAL,QNH,${internetData.qnh.toFixed(2)} to ESP32. Calibration written to NVS Flash.</span>`;
          if (window.lucide) lucide.createIcons();
        }
      }
    });
  }

  // Auto-detect and fetch on load
  fetchInternetWeatherAuto();
}

async function fetchInternetWeatherAuto() {
  const statusBadge = document.getElementById('badge-internet-status');
  if (statusBadge) {
    statusBadge.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Locating Ground Station...`;
    if (window.lucide) lucide.createIcons();
  }

  if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        fetchOpenMeteo(lat, lon, 'Local Ground Station');
      },
      (err) => {
        console.warn('Geolocation unavailable/denied, falling back to default coordinates:', err.message);
        fetchOpenMeteo(12.9716, 77.5946, 'Station Default (Bangalore)');
      },
      { timeout: 7000 }
    );
  } else {
    fetchOpenMeteo(12.9716, 77.5946, 'Station Default (Bangalore)');
  }
}

async function fetchOpenMeteo(lat, lon, label) {
  const statusBadge = document.getElementById('badge-internet-status');
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m,relative_humidity_2m,surface_pressure,pressure_msl,weather_code&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const current = data.current;
    internetData.qnh = current.pressure_msl;
    internetData.surfacePressure = current.surface_pressure;
    internetData.temperature = current.temperature_2m;
    internetData.humidity = current.relative_humidity_2m;
    internetData.elevation = data.elevation || 0;
    internetData.weatherCode = current.weather_code;
    internetData.latitude = lat;
    internetData.longitude = lon;
    internetData.locationName = label;
    internetData.lastUpdated = new Date();

    updateInternetUI();
  } catch (err) {
    console.error('Open-Meteo fetch error:', err);
    if (statusBadge) {
      statusBadge.className = 'badge-internet';
      statusBadge.innerHTML = `<i data-lucide="wifi-off"></i> Internet API Retry`;
      if (window.lucide) lucide.createIcons();
    }
  }
}

function getWeatherConditionText(code) {
  if (code === 0) return 'Clear Sky';
  if (code === 1 || code === 2) return 'Partly Cloudy';
  if (code === 3) return 'Overcast';
  if (code >= 45 && code <= 48) return 'Foggy';
  if (code >= 51 && code <= 67) return 'Rain / Drizzle';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Rain Showers';
  if (code >= 95) return 'Thunderstorm';
  return 'Fair Weather';
}

function updateInternetUI() {
  const statusBadge = document.getElementById('badge-internet-status');
  if (statusBadge) {
    statusBadge.className = 'badge-internet synced';
    statusBadge.innerHTML = `<i data-lucide="check-check"></i> Synced with Open-Meteo`;
  }

  const locEl = document.getElementById('net-location-name');
  if (locEl) locEl.textContent = `${internetData.locationName}`;

  const coordsEl = document.getElementById('net-coords-text');
  if (coordsEl) {
    coordsEl.textContent = `Lat: ${internetData.latitude.toFixed(2)}° • Lon: ${internetData.longitude.toFixed(2)}° • Ground Elev: ${internetData.elevation.toFixed(0)} m`;
  }

  const qnhEl = document.getElementById('net-qnh-val');
  if (qnhEl) qnhEl.innerHTML = `${internetData.qnh.toFixed(2)} <small>hPa</small>`;

  const elevEl = document.getElementById('net-elev-val');
  if (elevEl) elevEl.innerHTML = `${internetData.elevation.toFixed(0)} <small>m</small>`;

  const surfEl = document.getElementById('net-surface-press');
  if (surfEl) surfEl.innerHTML = `${internetData.surfacePressure.toFixed(1)} <small>hPa</small>`;

  const tempRhEl = document.getElementById('net-temp-rh');
  if (tempRhEl) tempRhEl.textContent = `${internetData.temperature.toFixed(1)}°C / ${internetData.humidity.toFixed(0)}%`;

  const condEl = document.getElementById('net-condition-desc');
  if (condEl) condEl.textContent = getWeatherConditionText(internetData.weatherCode);

  const targetQnhEl = document.getElementById('cal-target-qnh');
  if (targetQnhEl) targetQnhEl.textContent = `${internetData.qnh.toFixed(2)} hPa`;

  // Calculate Altitude Drift Error between default 1013.25 and true internet QNH
  const deltaP = 1013.25 - internetData.qnh;
  const errorAltMeters = deltaP * 8.43; // ~8.43m per hPa at low altitudes
  const errorEl = document.getElementById('cal-error-delta');
  if (errorEl) {
    const sign = errorAltMeters >= 0 ? '+' : '';
    errorEl.textContent = `${sign}${errorAltMeters.toFixed(1)} m`;
  }

  const btnSync = document.getElementById('btn-sync-qnh-hardware');
  if (btnSync && state.serial.isConnected) {
    btnSync.disabled = false;
  }

  if (window.lucide) lucide.createIcons();
}

// ==============================================================================
// Leaflet.js Interactive GPS Flight Map & Waypoint Logs Engine
// ==============================================================================

function initGpsMap() {
  if (typeof L === 'undefined') {
    console.warn('Leaflet library not loaded.');
    return;
  }
  const mapElement = document.getElementById('gps-map');
  if (!mapElement || state.gps.map) return;

  // Initial center: default ground station
  const defaultCenter = [12.9716, 77.5946];
  state.gps.map = L.map('gps-map', {
    zoomControl: true,
    attributionControl: true
  }).setView(defaultCenter, 13);

  // OpenStreetMap standard tiles
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(state.gps.map);

  // Custom Pulsing Device Marker
  const deviceIcon = L.divIcon({
    className: 'leaflet-device-marker',
    html: '<div class="gps-pulse-ring"></div><div class="gps-dot-center"></div>',
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });

  state.gps.deviceMarker = L.marker(defaultCenter, {
    icon: deviceIcon,
    title: 'AeroSense Device'
  }).addTo(state.gps.map);

  state.gps.deviceMarker.bindPopup(`<strong>AeroSense ESP32</strong><br>Awaiting GPS Lock...`);

  // Flight Path Polyline
  state.gps.trackPolyline = L.polyline([], {
    color: '#0284c7',
    weight: 4,
    opacity: 0.85,
    lineJoin: 'round'
  }).addTo(state.gps.map);

  // Layer group for individual clickable waypoint pins
  state.gps.waypointLayerGroup = L.layerGroup().addTo(state.gps.map);

  // Map Controls
  const btnRecenter = document.getElementById('btn-recenter-map');
  if (btnRecenter) {
    btnRecenter.addEventListener('click', () => {
      if (state.gps.latestLat && state.gps.latestLon) {
        state.gps.map.setView([state.gps.latestLat, state.gps.latestLon], 16, { animate: true });
        state.gps.deviceMarker.openPopup();
      } else {
        alert('No GPS location fix recorded yet.');
      }
    });
  }

  const btnFit = document.getElementById('btn-fit-bounds');
  if (btnFit) {
    btnFit.addEventListener('click', () => {
      if (state.gps.trackPolyline && state.gps.trackPolyline.getLatLngs().length > 0) {
        state.gps.map.fitBounds(state.gps.trackPolyline.getBounds(), { padding: [40, 40], maxZoom: 17 });
      } else if (state.gps.latestLat && state.gps.latestLon) {
        state.gps.map.setView([state.gps.latestLat, state.gps.latestLon], 15);
      } else {
        alert('No GPS path recorded yet.');
      }
    });
  }

  const btnClearTrack = document.getElementById('btn-clear-track');
  if (btnClearTrack) {
    btnClearTrack.addEventListener('click', () => {
      if (state.gps.trackPolyline) state.gps.trackPolyline.setLatLngs([]);
      if (state.gps.waypointLayerGroup) state.gps.waypointLayerGroup.clearLayers();
      state.gps.totalDistanceKm = 0;
      updateGpsSidebarStats(null);
    });
  }

  // Recalculate dimensions on load
  setTimeout(() => {
    state.gps.map.invalidateSize();
  }, 400);
}

function updateGpsUIAndMap(rec) {
  if (!rec || rec.lat === null || rec.lon === null || isNaN(rec.lat) || isNaN(rec.lon)) return;

  const lat = rec.lat;
  const lon = rec.lon;
  const speed = rec.speed || 0;
  const sats = rec.sats || 0;

  // Update distance
  if (state.gps.latestLat !== null && state.gps.latestLon !== null) {
    const segmentDist = calculateDistanceBetweenCoords(state.gps.latestLat, state.gps.latestLon, lat, lon);
    if (!isNaN(segmentDist) && segmentDist < 50) {
      state.gps.totalDistanceKm += segmentDist;
    }
  }

  state.gps.latestLat = lat;
  state.gps.latestLon = lon;
  state.gps.latestSpeed = speed;
  state.gps.latestSats = sats;
  state.gps.hasFix = true;

  if (state.gps.map && state.gps.deviceMarker) {
    const latLng = [lat, lon];
    state.gps.deviceMarker.setLatLng(latLng);
    state.gps.trackPolyline.addLatLng(latLng);

    state.gps.deviceMarker.bindPopup(`
      <div style="font-family: var(--font-body); font-size: 0.85rem; line-height: 1.4;">
        <strong style="color: #0284c7;">AeroSense Device Live</strong><br>
        <b>Lat:</b> ${lat.toFixed(5)}° • <b>Lon:</b> ${lon.toFixed(5)}°<br>
        <b>Altitude:</b> ${rec.alt.toFixed(1)} m • <b>Pressure:</b> ${rec.press.toFixed(1)} hPa<br>
        <b>Speed:</b> ${speed.toFixed(1)} km/h • <b>Satellites:</b> ${sats}
      </div>
    `);

    // Add a waypoint marker periodically
    if (rec.record % 5 === 0 || state.records.length < 20) {
      const circleWp = L.circleMarker(latLng, {
        radius: 4,
        color: '#0284c7',
        fillColor: '#ffffff',
        fillOpacity: 0.9,
        weight: 2
      });
      circleWp.bindPopup(`
        <div style="font-size: 0.8rem; line-height: 1.4;">
          <b>Log #${rec.record}</b> (${rec.time}s)<br>
          <b>Altitude:</b> ${rec.alt.toFixed(1)} m<br>
          <b>Coordinates:</b> ${lat.toFixed(5)}°, ${lon.toFixed(5)}°<br>
          <b>Temp:</b> ${rec.temp.toFixed(1)}°C • <b>Baro:</b> ${rec.press.toFixed(1)} hPa<br>
          <b>Speed:</b> ${speed.toFixed(1)} km/h
        </div>
      `);
      state.gps.waypointLayerGroup.addLayer(circleWp);
    }
  }

  updateGpsSidebarStats(rec);
}

function refreshGpsTrackFromRecords(records) {
  if (!state.gps.map) initGpsMap();
  if (!state.gps.map) return;

  const validGps = records.filter(r => r.lat !== null && r.lon !== null && !isNaN(r.lat) && !isNaN(r.lon));
  if (validGps.length === 0) {
    updateGpsSidebarStats(null);
    return;
  }

  const latLngs = validGps.map(r => [r.lat, r.lon]);
  state.gps.trackPolyline.setLatLngs(latLngs);
  state.gps.waypointLayerGroup.clearLayers();

  let totalDist = 0;
  for (let i = 1; i < validGps.length; i++) {
    const d = calculateDistanceBetweenCoords(validGps[i-1].lat, validGps[i-1].lon, validGps[i].lat, validGps[i].lon);
    if (!isNaN(d) && d < 50) totalDist += d;
  }
  state.gps.totalDistanceKm = totalDist;

  const stride = Math.max(1, Math.floor(validGps.length / 50));
  for (let i = 0; i < validGps.length; i += stride) {
    const r = validGps[i];
    const circle = L.circleMarker([r.lat, r.lon], {
      radius: 4,
      color: '#0284c7',
      fillColor: '#38bdf8',
      fillOpacity: 0.9,
      weight: 2
    });
    circle.bindPopup(`
      <div style="font-size: 0.8rem; line-height: 1.4;">
        <b>Log #${r.record}</b> (${r.time}s)<br>
        <b>Altitude:</b> ${r.alt.toFixed(1)} m<br>
        <b>Coordinates:</b> ${r.lat.toFixed(5)}°, ${r.lon.toFixed(5)}°<br>
        <b>Speed:</b> ${(r.speed || 0).toFixed(1)} km/h • <b>Sats:</b> ${r.sats || 0}
      </div>
    `);
    state.gps.waypointLayerGroup.addLayer(circle);
  }

  const latest = validGps[validGps.length - 1];
  state.gps.latestLat = latest.lat;
  state.gps.latestLon = latest.lon;
  state.gps.latestSpeed = latest.speed || 0;
  state.gps.latestSats = latest.sats || 0;
  state.gps.deviceMarker.setLatLng([latest.lat, latest.lon]);

  updateGpsSidebarStats(latest);

  try {
    state.gps.map.fitBounds(state.gps.trackPolyline.getBounds(), { padding: [40, 40], maxZoom: 16 });
  } catch (e) {
    state.gps.map.setView([latest.lat, latest.lon], 14);
  }
}

function updateGpsSidebarStats(rec) {
  const statusBadge = document.getElementById('badge-gps-status');
  const satsBadge = document.getElementById('badge-gps-sats');
  const valCoords = document.getElementById('val-gps-coords');
  const subGps = document.getElementById('sub-gps');
  const barGps = document.getElementById('bar-gps');
  const mapLat = document.getElementById('map-lat');
  const mapLon = document.getElementById('map-lon');
  const mapSpeed = document.getElementById('map-speed');
  const mapKnots = document.getElementById('map-knots');
  const mapBaroAlt = document.getElementById('map-baro-alt');
  const mapQnhAlt = document.getElementById('map-qnh-alt');
  const mapPtsCount = document.getElementById('map-pts-count');
  const mapDistance = document.getElementById('map-distance');
  const mapLastFix = document.getElementById('map-last-fix');
  const mapMarkerText = document.getElementById('map-marker-text');

  if (!rec || rec.lat === null || rec.lon === null) {
    if (statusBadge) {
      statusBadge.className = 'badge-gps-status searching';
      statusBadge.innerHTML = `<i data-lucide="loader-2" class="spin"></i> GPS Acquiring Fix`;
    }
    if (satsBadge) satsBadge.innerHTML = `<i data-lucide="satellite"></i> 0 Sats`;
    if (valCoords) valCoords.textContent = '--.------, --.------';
    if (subGps) subGps.innerHTML = `<span><i data-lucide="satellite"></i> 0 Sats</span> • <span>Speed: 0.0 km/h</span>`;
    if (barGps) barGps.style.width = '0%';
    if (mapLat) mapLat.textContent = '--.------°';
    if (mapLon) mapLon.textContent = '--.------°';
    if (mapSpeed) mapSpeed.textContent = '0.0';
    if (mapKnots) mapKnots.textContent = '0.0';
    if (mapBaroAlt) mapBaroAlt.textContent = '-- m';
    if (mapQnhAlt) mapQnhAlt.textContent = '-- m';
    if (mapPtsCount) mapPtsCount.textContent = '0';
    if (mapDistance) mapDistance.textContent = '0.00';
    if (mapLastFix) mapLastFix.textContent = 'Status: Awaiting GPS coordinates';
    if (mapMarkerText) mapMarkerText.textContent = 'Device Standby: Awaiting GPS coordinates';
    if (window.lucide) lucide.createIcons();
    return;
  }

  const speed = rec.speed || 0;
  const sats = rec.sats || 0;
  const knots = speed * 0.539957;

  if (statusBadge) {
    statusBadge.className = 'badge-gps-status locked';
    statusBadge.innerHTML = `<i data-lucide="check-circle-2"></i> GPS 3D FIX ACTIVE`;
  }
  if (satsBadge) satsBadge.innerHTML = `<i data-lucide="satellite"></i> ${sats} Sats`;
  if (valCoords) valCoords.textContent = `${rec.lat.toFixed(5)}°, ${rec.lon.toFixed(5)}°`;
  if (subGps) subGps.innerHTML = `<span><i data-lucide="satellite"></i> ${sats} Sats</span> • <span>Speed: ${speed.toFixed(1)} km/h</span>`;
  if (barGps) barGps.style.width = `${Math.min(100, Math.max(10, sats * 10))}%`;

  if (mapLat) mapLat.textContent = `${rec.lat.toFixed(6)}°`;
  if (mapLon) mapLon.textContent = `${rec.lon.toFixed(6)}°`;
  if (mapSpeed) mapSpeed.textContent = speed.toFixed(1);
  if (mapKnots) mapKnots.textContent = knots.toFixed(1);
  if (mapBaroAlt) mapBaroAlt.textContent = `${rec.alt.toFixed(1)} m`;
  if (mapQnhAlt) mapQnhAlt.textContent = `${(rec.qnh ? rec.alt : rec.alt).toFixed(1)} m`;

  const totalWaypoints = state.records.filter(r => r.lat !== null && r.lon !== null).length;
  if (mapPtsCount) mapPtsCount.textContent = totalWaypoints;
  if (mapDistance) mapDistance.textContent = state.gps.totalDistanceKm.toFixed(2);
  if (mapLastFix) mapLastFix.textContent = `Fix Active • Last Update at ${rec.time}s`;
  if (mapMarkerText) mapMarkerText.textContent = `Device Active: Lat ${rec.lat.toFixed(4)}°, Lon ${rec.lon.toFixed(4)}° • ${rec.alt.toFixed(0)}m Alt`;

  if (window.lucide) lucide.createIcons();
}

function focusWaypointOnMap(lat, lon, recordNum) {
  if (!state.gps.map) initGpsMap();
  const mapSec = document.getElementById('sec-map');
  if (mapSec) {
    const yOffset = -115;
    const y = mapSec.getBoundingClientRect().top + window.pageYOffset + yOffset;
    window.scrollTo({ top: y, behavior: 'smooth' });
  }

  setTimeout(() => {
    state.gps.map.setView([lat, lon], 16, { animate: true });
    const r = state.records.find(rec => rec.record === recordNum);
    const content = r
      ? `<div style="font-size: 0.85rem; line-height: 1.4;">
           <strong style="color: #0284c7;">AeroSense Log #${recordNum}</strong> (${r.time}s)<br>
           <b>Coordinates:</b> ${lat.toFixed(5)}°, ${lon.toFixed(5)}°<br>
           <b>Altitude:</b> ${r.alt.toFixed(1)} m • <b>Baro:</b> ${r.press.toFixed(1)} hPa<br>
           <b>Speed:</b> ${(r.speed || 0).toFixed(1)} km/h • <b>Sats:</b> ${r.sats || 0}
         </div>`
      : `<strong>Waypoint #${recordNum}</strong><br>${lat.toFixed(5)}°, ${lon.toFixed(5)}°`;

    L.popup()
      .setLatLng([lat, lon])
      .setContent(content)
      .openOn(state.gps.map);
  }, 400);
}

// Haversine formula to compute distance in km
function calculateDistanceBetweenCoords(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

window.focusWaypointOnMap = focusWaypointOnMap;
