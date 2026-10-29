/**
 * AeroSense™ Deep Meteorological Predictor
 * Past & Present Time-Series Atmospheric Forecasting Engine
 */

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Lucide Icons
  if (window.lucide) {
    window.lucide.createIcons();
  }

  // Core State
  const state = {
    pastRecords: [],
    presentRecords: [],
    forecastRecords: [],
    tableRecords: [],

    pastStats: {
      count: 0,
      meanPress: 0,
      stdDevPress: 0,
      meanTemp: 0,
      minPress: 0,
      maxPress: 0,
      timeSpanHours: 0
    },

    presentMetrics: {
      currPress: 0,
      currTemp: 0,
      currAlt: 0,
      currQnh: 1013.25,
      dewPoint: 0,
      lclMeters: 0,
      wmoDelta3h: 0,
      wmoCode: 4,
      wmoDesc: 'Steady',
      tendencyHpaPerHr: 0,
      acceleration: 0,
      baselineDiff: 0,
      convectiveRiskPct: 0,
      primaryVerdict: 'Awaiting Data',
      confidenceScore: 0
    },

    horizons: [],

    currentPage: 1,
    rowsPerPage: 15,
    searchQuery: '',

    serialPort: null,
    serialReader: null,
    isStreaming: false
  };

  // Chart References
  let chartSynoptic = null;
  let chartThermo = null;
  let chartDerivative = null;

  // DOM Elements
  const filePastInput = document.getElementById('file-past-input');
  const filePresentInput = document.getElementById('file-present-input');
  const fileContinuousInput = document.getElementById('file-continuous-input');

  const btnBrowsePast = document.getElementById('btn-browse-past');
  const btnBrowsePresent = document.getElementById('btn-browse-present');

  const dropZonePast = document.getElementById('drop-zone-past');
  const dropZonePresent = document.getElementById('drop-zone-present');
  const linkBrowsePast = document.getElementById('link-browse-past');
  const linkBrowsePresent = document.getElementById('link-browse-present');

  const btnOpenPaste = document.getElementById('btn-open-paste-modal');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const btnCancelPaste = document.getElementById('btn-cancel-paste');
  const btnSubmitPaste = document.getElementById('btn-submit-paste');
  const pasteModal = document.getElementById('paste-modal');
  const pasteTextarea = document.getElementById('paste-textarea');

  const btnLiveSerial = document.getElementById('btn-live-serial');
  const btnClearAll = document.getElementById('btn-clear-all');
  const btnPrintReport = document.getElementById('btn-print-report');
  const btnExportCsv = document.getElementById('btn-export-csv');

  const tableSearch = document.getElementById('table-search');
  const btnPrevPage = document.getElementById('btn-prev-page');
  const btnNextPage = document.getElementById('btn-next-page');

  // Event Listeners
  initEventListeners();
  initEmptyCharts();
  initSubNav();

  function initEventListeners() {
    // Header file browse buttons
    if (btnBrowsePast) btnBrowsePast.addEventListener('click', () => filePastInput.click());
    if (btnBrowsePresent) btnBrowsePresent.addEventListener('click', () => filePresentInput.click());

    // Ingestion card browse links
    if (linkBrowsePast) linkBrowsePast.addEventListener('click', () => filePastInput.click());
    if (linkBrowsePresent) linkBrowsePresent.addEventListener('click', () => filePresentInput.click());

    if (filePastInput) {
      filePastInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
          handleFileRead(e.target.files[0], 'past');
          e.target.value = '';
        }
      });
    }

    if (filePresentInput) {
      filePresentInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
          handleFileRead(e.target.files[0], 'present');
          e.target.value = '';
        }
      });
    }

    if (fileContinuousInput) {
      fileContinuousInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
          handleContinuousFileRead(e.target.files[0]);
          e.target.value = '';
        }
      });
    }

    // Drag and Drop
    setupDragAndDrop(dropZonePast, 'past');
    setupDragAndDrop(dropZonePresent, 'present');

    // Paste Modal
    if (btnOpenPaste) btnOpenPaste.addEventListener('click', () => pasteModal.style.display = 'flex');
    if (btnCloseModal) btnCloseModal.addEventListener('click', () => pasteModal.style.display = 'none');
    if (btnCancelPaste) btnCancelPaste.addEventListener('click', () => pasteModal.style.display = 'none');
    if (btnSubmitPaste) btnSubmitPaste.addEventListener('click', handlePasteSubmit);

    // Live Web Serial
    if (btnLiveSerial) btnLiveSerial.addEventListener('click', toggleLiveSerialStream);

    // Utilities
    if (btnClearAll) btnClearAll.addEventListener('click', clearAllDatasets);
    if (btnPrintReport) btnPrintReport.addEventListener('click', () => window.print());
    if (btnExportCsv) btnExportCsv.addEventListener('click', exportAnalyzedCsv);

    // Table pagination & search
    if (tableSearch) tableSearch.addEventListener('input', handleTableSearch);
    if (btnPrevPage) btnPrevPage.addEventListener('click', () => changePage(-1));
    if (btnNextPage) btnNextPage.addEventListener('click', () => changePage(1));
  }

  function setupDragAndDrop(dropZone, target) {
    if (!dropZone) return;

    ['dragenter', 'dragover'].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('drag-over');
      });
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-over');
      });
    });

    dropZone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      if (dt.files.length > 0) {
        handleFileRead(dt.files[0], target);
      }
    });
  }

  // ==============================================================================
  // File Reading & Ingestion
  // ==============================================================================

  function handleFileRead(file, target) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const records = parseCsvTelemetry(text);
      if (records.length === 0) {
        alert('Could not parse any valid sensor records from this file. Ensure format matches AeroSense CSV.');
        return;
      }

      if (target === 'past') {
        state.pastRecords = records;
      } else {
        state.presentRecords = records;
      }

      runDeepMeteorologicalEngine();
    };
    reader.readAsText(file);
  }

  function handleContinuousFileRead(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const records = parseCsvTelemetry(text);
      if (records.length < 10) {
        alert('Continuous dataset too small. Please provide a file with at least 10 observations.');
        return;
      }

      // Automatically split: First 60% as Historical Past Baseline, final 40% as Present Observations
      const splitIdx = Math.floor(records.length * 0.6);
      state.pastRecords = records.slice(0, splitIdx);
      state.presentRecords = records.slice(splitIdx);

      runDeepMeteorologicalEngine();
    };
    reader.readAsText(file);
  }

  function handlePasteSubmit() {
    const text = pasteTextarea.value.trim();
    if (!text) {
      alert('Please paste CSV lines first.');
      return;
    }

    const radios = document.getElementsByName('paste-target');
    let target = 'present';
    for (const r of radios) {
      if (r.checked) target = r.value;
    }

    const records = parseCsvTelemetry(text);
    if (records.length === 0) {
      alert('Could not parse valid records from pasted text.');
      return;
    }

    if (target === 'past') {
      state.pastRecords = records;
    } else {
      state.presentRecords = records;
    }

    pasteModal.style.display = 'none';
    pasteTextarea.value = '';
    runDeepMeteorologicalEngine();
  }

  function clearAllDatasets() {
    if (confirm('Clear all ingested past and present datasets?')) {
      state.pastRecords = [];
      state.presentRecords = [];
      state.forecastRecords = [];
      state.tableRecords = [];
      resetMetrics();
      updateUI();
      initEmptyCharts();
    }
  }

  // ==============================================================================
  // Robust CSV Parsing (Supports New and Legacy Headers)
  // ==============================================================================

  // ==============================================================================
  // Robust Universal CSV Parsing (Supports Any Header Order and Sensor Formats)
  // ==============================================================================

  function parseCsvTelemetry(text) {
    if (!text || typeof text !== 'string') return [];
    const rawLines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#') && !l.startsWith('$'));
    if (rawLines.length === 0) return [];

    let colRecord = -1;
    let colTime = -1;
    let colTemp = -1;
    let colPress = -1;
    let colAlt = -1;
    let colQnh = -1;
    let colHum = -1;
    let colDew = -1;
    let colLat = -1;
    let colLon = -1;
    let colSpeed = -1;
    let colSats = -1;

    let startIdx = 0;
    const firstLine = rawLines[0];
    const firstParts = firstLine.split(',').map(p => p.trim().replace(/^["']|["']$/g, ''));

    // Check if the first line is a header
    const isHeader = firstParts.some(p => isNaN(parseFloat(p)) && p.length > 0);

    if (isHeader) {
      startIdx = 1;
      for (let j = 0; j < firstParts.length; j++) {
        const h = firstParts[j].toLowerCase().replace(/[^a-z0-9_]/g, '');
        if (h.includes('record') || h === 'rec') colRecord = j;
        else if (h.includes('time') || h.includes('timestamp') || h.includes('sec')) colTime = j;
        else if (h.includes('temp')) colTemp = j;
        else if (h.includes('press') || h.includes('baro')) colPress = j;
        else if (h.includes('alt')) colAlt = j;
        else if (h.includes('qnh') || h.includes('sealevel')) colQnh = j;
        else if (h.includes('hum') || h.includes('rh')) colHum = j;
        else if (h.includes('dew')) colDew = j;
        else if (h.includes('lat')) colLat = j;
        else if (h.includes('lon') || h.includes('lng')) colLon = j;
        else if (h.includes('speed') || h.includes('spd')) colSpeed = j;
        else if (h.includes('sat')) colSats = j;
      }
    }

    // Default column fallback if not detected
    if (colPress === -1 || colTemp === -1) {
      const sampleRow = (startIdx < rawLines.length) ? rawLines[startIdx].split(',').map(p => p.trim()) : firstParts;
      if (sampleRow.length >= 6) {
        colRecord = 0; colTime = 1; colTemp = 2; colPress = 3; colAlt = 4; colQnh = 5;
      } else if (sampleRow.length === 5) {
        colRecord = 0; colTime = 1; colTemp = 2; colPress = 3; colAlt = 4;
      } else if (sampleRow.length === 4) {
        colTime = 0; colTemp = 1; colPress = 2; colAlt = 3;
      } else if (sampleRow.length === 3) {
        colTemp = 0; colPress = 1; colAlt = 2;
      } else if (sampleRow.length === 2) {
        colTemp = 0; colPress = 1;
      }
    }

    const parsed = [];
    for (let i = startIdx; i < rawLines.length; i++) {
      const line = rawLines[i];
      const parts = line.split(',').map(p => p.trim().replace(/^["']|["']$/g, ''));
      if (parts.length < 2) continue;

      let temp = colTemp !== -1 && parts[colTemp] !== undefined ? parseFloat(parts[colTemp]) : NaN;
      let press = colPress !== -1 && parts[colPress] !== undefined ? parseFloat(parts[colPress]) : NaN;
      let alt = colAlt !== -1 && parts[colAlt] !== undefined ? parseFloat(parts[colAlt]) : NaN;
      let qnh = colQnh !== -1 && parts[colQnh] !== undefined ? parseFloat(parts[colQnh]) : 1013.25;
      let timeSec = colTime !== -1 && parts[colTime] !== undefined ? parseFloat(parts[colTime]) : (parsed.length * 5);
      let record = colRecord !== -1 && parts[colRecord] !== undefined ? parseInt(parts[colRecord], 10) : (parsed.length + 1);
      let hum = colHum !== -1 && parts[colHum] !== undefined ? parseFloat(parts[colHum]) : NaN;
      let dew = colDew !== -1 && parts[colDew] !== undefined ? parseFloat(parts[colDew]) : NaN;
      let lat = colLat !== -1 && parts[colLat] !== undefined ? parseFloat(parts[colLat]) : NaN;
      let lon = colLon !== -1 && parts[colLon] !== undefined ? parseFloat(parts[colLon]) : NaN;
      let speed = colSpeed !== -1 && parts[colSpeed] !== undefined ? parseFloat(parts[colSpeed]) : 0;
      let sats = colSats !== -1 && parts[colSats] !== undefined ? parseInt(parts[colSats]) : 0;

      // Smart scan fallback if values are outside expected physics ranges
      if (isNaN(press) || press < 300 || press > 1250) {
        for (let pIdx = 0; pIdx < parts.length; pIdx++) {
          const val = parseFloat(parts[pIdx]);
          if (!isNaN(val) && val >= 300 && val <= 1250) {
            press = val;
            break;
          }
        }
      }

      if (isNaN(temp) || temp < -50 || temp > 80) {
        for (let tIdx = 0; tIdx < parts.length; tIdx++) {
          const val = parseFloat(parts[tIdx]);
          if (!isNaN(val) && val >= -40 && val <= 70 && val !== press) {
            temp = val;
            break;
          }
        }
      }

      if (!isNaN(temp) && !isNaN(press) && press >= 300 && press <= 1250) {
        const exactQnh = (!isNaN(qnh) && qnh >= 850 && qnh <= 1150) ? qnh : 1013.25;
        const tempK = temp + 273.15;
        const compAlt = ((Math.pow(exactQnh / press, 0.190263) - 1.0) * tempK) / 0.0065;

        const estRh = !isNaN(hum) && hum >= 0 && hum <= 100 
          ? hum 
          : Math.min(98, Math.max(15, 65.0 - (temp - 20.0) * 1.8 + (1013.25 - press) * 0.4));
          
        const dewPoint = !isNaN(dew) ? dew : calculateDewPoint(temp, estRh);
        const lclMeters = Math.max(50, Math.round(125.0 * (temp - dewPoint)));

        parsed.push({
          record: isNaN(record) ? parsed.length + 1 : record,
          time: isNaN(timeSec) ? (parsed.length * 5) : timeSec,
          temp: parseFloat(temp.toFixed(2)),
          press: parseFloat(press.toFixed(2)),
          alt: parseFloat((!isNaN(alt) ? alt : compAlt).toFixed(1)),
          compAlt: parseFloat(compAlt.toFixed(1)),
          qnh: parseFloat(exactQnh.toFixed(2)),
          humidity: parseFloat(estRh.toFixed(1)),
          dewPoint: parseFloat(dewPoint.toFixed(1)),
          lclMeters: lclMeters,
          lat: (!isNaN(lat) && Math.abs(lat) > 0.0001) ? lat : null,
          lon: (!isNaN(lon) && Math.abs(lon) > 0.0001) ? lon : null,
          speed: !isNaN(speed) ? speed : 0,
          sats: !isNaN(sats) ? sats : 0
        });
      }
    }

    return parsed;
  }

  function calculateDewPoint(tempC, rhPct) {
    const a = 17.27;
    const b = 237.7;
    const alpha = ((a * tempC) / (b + tempC)) + Math.log(rhPct / 100.0);
    return (b * alpha) / (a - alpha);
  }

  // ==============================================================================
  // Deep Meteorological Analysis & Prediction Engine
  // ==============================================================================

  function runDeepMeteorologicalEngine(isSmooth = false) {
    const hasPast = state.pastRecords.length > 0;
    const hasPresent = state.presentRecords.length > 0;

    if (!hasPast && !hasPresent) {
      resetMetrics();
      updateUI();
      initEmptyCharts();
      return;
    }

    // 1. Analyze Historical Past Baseline
    if (hasPast) {
      computePastBaselineStats();
    }

    // 2. Compute Atmospheric State & Future Forecast
    if (hasPresent) {
      computePresentAtmosphericState();
      generateFutureForecastTimeline();
    } else if (hasPast) {
      // If only past records uploaded, predict future from past series!
      computePastAsPresentState();
      generateFutureForecastTimeline();
    }

    // 3. Assemble unified table data
    buildCombinedTableData();

    // 4. Update UI displays and charts
    updateUI();
    renderCharts(isSmooth);
  }

  function computePastAsPresentState() {
    const recs = state.pastRecords;
    if (recs.length === 0) return;
    const latest = recs[recs.length - 1];

    state.presentMetrics.currPress = latest.press;
    state.presentMetrics.currTemp = latest.temp;
    state.presentMetrics.currAlt = latest.compAlt;
    state.presentMetrics.currQnh = latest.qnh;
    state.presentMetrics.dewPoint = latest.dewPoint;
    state.presentMetrics.lclMeters = latest.lclMeters;
    state.presentMetrics.baselineDiff = 0;

    // Calculate Tendency & Slope from past series
    let delta3h = 0;
    let tendencyPerHour = 0;
    let acceleration = 0;

    if (recs.length >= 2) {
      const first = recs[0];
      const deltaSec = Math.max(1, latest.time - first.time);
      const deltaHours = deltaSec / 3600.0;
      const totalDeltaP = latest.press - first.press;

      tendencyPerHour = totalDeltaP / Math.max(0.1, deltaHours);
      delta3h = tendencyPerHour * 3.0;

      if (recs.length >= 4) {
        const midIdx = Math.floor(recs.length / 2);
        const midRec = recs[midIdx];
        const slope1 = (midRec.press - first.press) / Math.max(0.05, (midRec.time - first.time) / 3600.0);
        const slope2 = (latest.press - midRec.press) / Math.max(0.05, (latest.time - midRec.time) / 3600.0);
        acceleration = slope2 - slope1;
      }
    }

    state.presentMetrics.wmoDelta3h = parseFloat(delta3h.toFixed(2));
    state.presentMetrics.tendencyHpaPerHr = parseFloat(tendencyPerHour.toFixed(2));
    state.presentMetrics.acceleration = parseFloat(acceleration.toFixed(2));

    classifyWmoTendency(delta3h, acceleration);
    computeConvectiveRisk(latest.press, latest.temp, latest.dewPoint, delta3h);
  }

  function computePastBaselineStats() {
    const recs = state.pastRecords;
    let sumP = 0;
    let sumT = 0;
    let minP = Infinity;
    let maxP = -Infinity;

    for (const r of recs) {
      sumP += r.press;
      sumT += r.temp;
      if (r.press < minP) minP = r.press;
      if (r.press > maxP) maxP = r.press;
    }

    const meanP = sumP / recs.length;
    const meanT = sumT / recs.length;

    // Standard deviation of pressure
    let varP = 0;
    for (const r of recs) {
      varP += Math.pow(r.press - meanP, 2);
    }
    const stdDevP = Math.sqrt(varP / recs.length);

    const spanHours = (recs[recs.length - 1].time - recs[0].time) / 3600.0;

    state.pastStats = {
      count: recs.length,
      meanPress: parseFloat(meanP.toFixed(2)),
      stdDevPress: parseFloat(stdDevP.toFixed(2)),
      meanTemp: parseFloat(meanT.toFixed(1)),
      minPress: parseFloat(minP.toFixed(2)),
      maxPress: parseFloat(maxP.toFixed(2)),
      timeSpanHours: Math.max(0.1, parseFloat(spanHours.toFixed(1)))
    };
  }

  function computePresentAtmosphericState() {
    const recs = state.presentRecords;
    const latest = recs[recs.length - 1];

    state.presentMetrics.currPress = latest.press;
    state.presentMetrics.currTemp = latest.temp;
    state.presentMetrics.currAlt = latest.compAlt;
    state.presentMetrics.currQnh = latest.qnh;
    state.presentMetrics.dewPoint = latest.dewPoint;
    state.presentMetrics.lclMeters = latest.lclMeters;

    // Deviation from past baseline
    if (state.pastStats.count > 0) {
      state.presentMetrics.baselineDiff = parseFloat((latest.press - state.pastStats.meanPress).toFixed(2));
    } else {
      state.presentMetrics.baselineDiff = 0;
    }

    // Calculate 3-Hour Tendency & Slope
    let delta3h = 0;
    let tendencyPerHour = 0;
    let acceleration = 0;

    if (recs.length >= 2) {
      const first = recs[0];
      const deltaSec = Math.max(1, latest.time - first.time);
      const deltaHours = deltaSec / 3600.0;
      const totalDeltaP = latest.press - first.press;

      tendencyPerHour = totalDeltaP / Math.max(0.1, deltaHours);

      // Standardize to 3-hour equivalent
      delta3h = tendencyPerHour * 3.0;

      // Second derivative / acceleration: compare first half slope vs second half slope
      if (recs.length >= 4) {
        const midIdx = Math.floor(recs.length / 2);
        const midRec = recs[midIdx];
        const slope1 = (midRec.press - first.press) / Math.max(0.05, (midRec.time - first.time) / 3600.0);
        const slope2 = (latest.press - midRec.press) / Math.max(0.05, (latest.time - midRec.time) / 3600.0);
        acceleration = slope2 - slope1;
      }
    }

    state.presentMetrics.wmoDelta3h = parseFloat(delta3h.toFixed(2));
    state.presentMetrics.tendencyHpaPerHr = parseFloat(tendencyPerHour.toFixed(2));
    state.presentMetrics.acceleration = parseFloat(acceleration.toFixed(2));

    // WMO Code Table 0200 Classification
    classifyWmoTendency(delta3h, acceleration);

    // Multi-variable thermodynamic rain risk %
    computeConvectiveRisk(latest.press, latest.temp, latest.dewPoint, delta3h);
  }

  function classifyWmoTendency(delta3h, accel) {
    let code = 4;
    let desc = 'Steady (Little or no change)';

    if (delta3h > 2.0) {
      code = 2;
      desc = 'Rising steadily or rapidly (+2.0hPa/3h)';
    } else if (delta3h > 0.5) {
      code = (accel > 0) ? 1 : 0;
      desc = 'Rising moderately (+0.5 to +2.0hPa)';
    } else if (delta3h < -2.0) {
      code = 7;
      desc = 'Falling rapidly (Storm front alert: < -2.0hPa/3h)';
    } else if (delta3h < -0.5) {
      code = (accel < 0) ? 8 : 6;
      desc = 'Falling moderately (-0.5 to -2.0hPa)';
    } else {
      code = 4;
      desc = 'Steady / Minor micro-fluctuations (±0.5hPa)';
    }

    state.presentMetrics.wmoCode = code;
    state.presentMetrics.wmoDesc = desc;
  }

  function computeConvectiveRisk(press, temp, dewPoint, delta3h) {
    let risk = 15; // baseline calm risk

    // 1. Pressure Tendency Contribution
    if (delta3h < -2.5) risk += 50;
    else if (delta3h < -1.5) risk += 35;
    else if (delta3h < -0.6) risk += 20;
    else if (delta3h > 1.0) risk -= 10;

    // 2. Dew Point Depression (T - Td)
    const depression = Math.max(0, temp - dewPoint);
    if (depression < 2.5) risk += 25; // Saturated boundary layer
    else if (depression < 5.0) risk += 12;
    else if (depression > 12.0) risk -= 15; // Dry air mass

    // 3. Absolute Pressure Level
    if (press < 1002.0) risk += 15;
    else if (press < 1008.0) risk += 8;
    else if (press > 1020.0) risk -= 10;

    // 4. Past baseline divergence
    if (state.presentMetrics.baselineDiff < -4.0) {
      risk += 15; // Significant synoptic trough compared to historical mean
    }

    risk = Math.max(5, Math.min(98, Math.round(risk)));
    state.presentMetrics.convectiveRiskPct = risk;

    // Confidence Score based on past dataset richness and present sample density
    let confidence = 50;
    if (state.pastStats.count > 20) confidence += 20;
    if (state.presentRecords.length > 20) confidence += 20;
    if (Math.abs(delta3h) > 0.8) confidence += 8;
    state.presentMetrics.confidenceScore = Math.min(99, confidence);

    // Primary Predictive Verdict
    if (risk >= 80) {
      state.presentMetrics.primaryVerdict = 'SEVERE SQUALL / STORM FRONT';
    } else if (risk >= 65) {
      state.presentMetrics.primaryVerdict = 'STEADY RAIN & DETERIORATING';
    } else if (risk >= 45) {
      state.presentMetrics.primaryVerdict = 'SHOWERS LIKELY / OVERCAST';
    } else if (risk >= 25) {
      state.presentMetrics.primaryVerdict = 'SCATTERED CLOUDS / MILD';
    } else {
      state.presentMetrics.primaryVerdict = 'FAIR & STABLE HIGH PRESSURE';
    }
  }

  // ==============================================================================
  // Multi-Horizon Predictive Time-Series Extrapolation (+24 Hours)
  // ==============================================================================

  function generateFutureForecastTimeline() {
    const currP = state.presentMetrics.currPress;
    const currT = state.presentMetrics.currTemp;
    const slope = state.presentMetrics.tendencyHpaPerHr;
    const accel = state.presentMetrics.acceleration;
    const risk = state.presentMetrics.convectiveRiskPct;

    const horizons = [
      { id: 1, hours: 2, label: 'Next 1 - 3 Hours', damping: 0.12 },
      { id: 2, hours: 5, label: 'Next 3 - 6 Hours', damping: 0.22 },
      { id: 3, hours: 9, label: 'Next 6 - 12 Hours', damping: 0.35 },
      { id: 4, hours: 18, label: 'Next 12 - 24 Hours', damping: 0.48 }
    ];

    state.horizons = horizons.map(h => {
      // Extrapolate barometric pressure forward with exponential damping
      // P(t) = P0 + (slope * t * exp(-damping * t)) + (0.5 * accel * t^2 * exp(-2*damping*t))
      const dampedSlope = slope * Math.exp(-h.damping * h.hours);
      const deltaP = (dampedSlope * h.hours) + (0.5 * accel * Math.pow(h.hours, 1.3) * Math.exp(-h.damping * h.hours));
      const expPress = parseFloat((currP + deltaP).toFixed(2));

      // Temperature forecast (diurnal cooling/warming tendency)
      let tempDelta = (expPress < currP) ? -0.4 * h.hours : 0.2 * h.hours;
      const expTemp = parseFloat((currT + tempDelta).toFixed(1));

      // Rain probability trajectory
      let horizonRisk = risk;
      if (expPress < currP - 1.5) horizonRisk = Math.min(98, risk + h.hours * 3);
      else if (expPress > currP + 1.0) horizonRisk = Math.max(5, risk - h.hours * 4);
      else horizonRisk = Math.round(risk * (1.0 - h.damping * 0.5));

      // Weather condition classification
      let condition = 'Partly Cloudy';
      let icon = 'cloud-sun';
      let advisory = '';

      if (horizonRisk >= 80) {
        condition = 'Convective Storm Front';
        icon = 'cloud-lightning';
        advisory = `Sharp pressure trough (${expPress} hPa). Rapid squall lines and high wind gust hazard.`;
      } else if (horizonRisk >= 60) {
        condition = 'Precipitation / Steady Rain';
        icon = 'cloud-rain';
        advisory = `Surface barometric drop of ${(currP - expPress).toFixed(1)} hPa. Low cloud base ceiling.`;
      } else if (horizonRisk >= 40) {
        condition = 'Overcast / Showers Likely';
        icon = 'cloud';
        advisory = `Barometric tendency stabilizing near ${expPress} hPa. High relative humidity.`;
      } else if (horizonRisk >= 20) {
        condition = 'Partly Cloudy / Fair';
        icon = 'cloud-sun';
        advisory = `Barometer steady at ${expPress} hPa. Excellent visibility and stable lapse rate.`;
      } else {
        condition = 'Clear Sky / High Pressure';
        icon = 'sun';
        advisory = `Anticyclonic ridge building (${expPress} hPa). Unrestricted flight deck visibility.`;
      }

      return {
        id: h.id,
        hours: h.hours,
        label: h.label,
        expPress: expPress,
        expTemp: expTemp,
        risk: horizonRisk,
        condition: condition,
        icon: icon,
        advisory: advisory
      };
    });

    // Generate 24 hourly forecast records for chart forward projection
    state.forecastRecords = [];
    const sourceRecs = state.presentRecords.length > 0 ? state.presentRecords : state.pastRecords;
    const lastTime = sourceRecs.length > 0 ? sourceRecs[sourceRecs.length - 1].time : Math.floor(Date.now() / 1000);

    for (let h = 1; h <= 24; h++) {
      const dampedSlope = slope * Math.exp(-0.15 * h);
      const deltaP = (dampedSlope * h) + (0.5 * accel * Math.pow(h, 1.2) * Math.exp(-0.25 * h));
      const p = parseFloat((currP + deltaP).toFixed(2));
      const t = parseFloat((currT - (deltaP < 0 ? 0.25 : -0.15) * h).toFixed(1));
      const r = Math.min(98, Math.max(5, Math.round(risk + (currP - p) * 8.0)));

      state.forecastRecords.push({
        time: lastTime + (h * 3600),
        press: p,
        temp: t,
        risk: r
      });
    }
  }

  // ==============================================================================
  // Unified Data Table Assembler
  // ==============================================================================

  function buildCombinedTableData() {
    const rows = [];

    // Tag past records
    state.pastRecords.forEach(r => {
      rows.push({
        tag: 'PAST',
        time: r.time,
        press: r.press,
        alt: r.compAlt,
        temp: r.temp,
        dewPoint: r.dewPoint,
        lcl: r.lclMeters,
        trend: 0.0,
        verdict: 'Historical Baseline',
        risk: '--'
      });
    });

    // Tag present records
    state.presentRecords.forEach((r, idx) => {
      const trend = (idx > 0) ? ((r.press - state.presentRecords[0].press) / Math.max(0.1, (r.time - state.presentRecords[0].time) / 3600.0)).toFixed(2) : '0.00';
      rows.push({
        tag: 'PRESENT',
        time: r.time,
        press: r.press,
        alt: r.compAlt,
        temp: r.temp,
        dewPoint: r.dewPoint,
        lcl: r.lclMeters,
        trend: trend,
        verdict: state.presentMetrics.primaryVerdict,
        risk: state.presentMetrics.convectiveRiskPct
      });
    });

    // Tag forward forecast points (+1h, +3h, +6h, +12h, +24h)
    state.forecastRecords.forEach(r => {
      rows.push({
        tag: 'FORECAST',
        time: r.time,
        press: r.press,
        alt: state.presentMetrics.currAlt,
        temp: r.temp,
        dewPoint: parseFloat((r.temp - 4.5).toFixed(1)),
        lcl: Math.round(125 * 4.5),
        trend: (r.press - state.presentMetrics.currPress).toFixed(2),
        verdict: r.risk > 65 ? 'Precipitation' : 'Fair',
        risk: r.risk
      });
    });

    state.tableRecords = rows;
  }

  // ==============================================================================
  // UI Display Updates
  // ==============================================================================

  function updateUI() {
    // 1. Past Dataset Header Card
    const badgePast = document.getElementById('badge-past-status');
    const statPastCount = document.getElementById('stat-past-count');
    const statPastSpan = document.getElementById('stat-past-span');
    const statPastMeanP = document.getElementById('stat-past-mean-p');

    if (state.pastStats.count > 0) {
      if (badgePast) {
        badgePast.className = 'dataset-badge badge-loaded';
        badgePast.textContent = `${state.pastStats.count} Points Loaded`;
      }
      if (statPastCount) statPastCount.textContent = state.pastStats.count;
      if (statPastSpan) statPastSpan.textContent = `${state.pastStats.timeSpanHours} hrs`;
      if (statPastMeanP) statPastMeanP.textContent = `${state.pastStats.meanPress} hPa`;
    } else {
      if (badgePast) {
        badgePast.className = 'dataset-badge';
        badgePast.textContent = 'No File Loaded';
      }
      if (statPastCount) statPastCount.textContent = '0';
      if (statPastSpan) statPastSpan.textContent = '--';
      if (statPastMeanP) statPastMeanP.textContent = '--';
    }

    // 2. Present Dataset Header Card
    const badgePresent = document.getElementById('badge-present-status');
    const statPresentCount = document.getElementById('stat-present-count');
    const statPresentCurrP = document.getElementById('stat-present-curr-p');
    const statPresentAlt = document.getElementById('stat-present-alt');

    if (state.presentRecords.length > 0) {
      if (badgePresent) {
        badgePresent.className = 'dataset-badge badge-loaded';
        badgePresent.textContent = `${state.presentRecords.length} Observed Points`;
      }
      if (statPresentCount) statPresentCount.textContent = state.presentRecords.length;
      if (statPresentCurrP) statPresentCurrP.textContent = `${state.presentMetrics.currPress} hPa`;
      if (statPresentAlt) statPresentAlt.textContent = `${state.presentMetrics.currAlt} m`;
    } else {
      if (badgePresent) {
        badgePresent.className = 'dataset-badge';
        badgePresent.textContent = 'No File Loaded';
      }
      if (statPresentCount) statPresentCount.textContent = '0';
      if (statPresentCurrP) statPresentCurrP.textContent = '--';
      if (statPresentAlt) statPresentAlt.textContent = '--';
    }

    // 3. System Diagnostic Banner
    const bannerText = document.getElementById('banner-text');
    const bannerIndicator = document.getElementById('banner-state-indicator');

    if (state.pastRecords.length > 0 && state.presentRecords.length > 0) {
      if (bannerText) {
        bannerText.innerHTML = `<strong>Deep Meteorological Model Active:</strong> Comparing ${state.pastRecords.length} past training records vs ${state.presentRecords.length} present observations. Baseline deviation: <strong>${state.presentMetrics.baselineDiff > 0 ? '+' : ''}${state.presentMetrics.baselineDiff} hPa</strong>.`;
      }
      if (bannerIndicator) bannerIndicator.textContent = 'Past vs Present Synoptic Match';
    } else if (state.presentRecords.length > 0) {
      if (bannerText) {
        bannerText.innerHTML = `<strong>Present Observations Active:</strong> Running single-stream time-series forecasting. Ingest a past historical baseline file for full comparative synoptic anomaly detection.`;
      }
      if (bannerIndicator) bannerIndicator.textContent = 'Single Observation Stream';
    }

    // 4. KPI Metric Cards
    const kpiAltVal = document.getElementById('kpi-alt-val');
    const kpiQnhBadge = document.getElementById('kpi-qnh-badge');
    const kpiPressVal = document.getElementById('kpi-press-val');
    const kpiPressureTrendBadge = document.getElementById('kpi-pressure-trend-badge');
    const kpiBaselineDiff = document.getElementById('kpi-baseline-diff');
    const kpiWmoVal = document.getElementById('kpi-wmo-val');
    const kpiWmoCode = document.getElementById('kpi-wmo-code');
    const kpiWmoDesc = document.getElementById('kpi-wmo-desc');
    const kpiLclVal = document.getElementById('kpi-lcl-val');
    const kpiDewpointBadge = document.getElementById('kpi-dewpoint-badge');
    const kpiRiskVal = document.getElementById('kpi-risk-val');
    const kpiRiskBadge = document.getElementById('kpi-risk-badge');
    const kpiVerdictVal = document.getElementById('kpi-verdict-val');
    const kpiConfidenceBadge = document.getElementById('kpi-confidence-badge');

    if (state.presentRecords.length > 0 || state.pastRecords.length > 0) {
      const m = state.presentMetrics;
      if (kpiAltVal) kpiAltVal.innerHTML = `${m.currAlt} <span class="unit">m</span>`;
      if (kpiQnhBadge) kpiQnhBadge.textContent = `QNH ${m.currQnh}`;
      if (kpiPressVal) kpiPressVal.innerHTML = `${m.currPress} <span class="unit">hPa</span>`;
      if (kpiPressureTrendBadge) kpiPressureTrendBadge.textContent = `${m.tendencyHpaPerHr > 0 ? '+' : ''}${m.tendencyHpaPerHr} hPa/h`;
      if (kpiBaselineDiff) kpiBaselineDiff.textContent = `Deviation from Past: ${m.baselineDiff > 0 ? '+' : ''}${m.baselineDiff} hPa`;
      if (kpiWmoVal) kpiWmoVal.innerHTML = `${m.wmoDelta3h > 0 ? '+' : ''}${m.wmoDelta3h} <span class="unit">hPa/3h</span>`;
      if (kpiWmoCode) kpiWmoCode.textContent = `WMO Code ${m.wmoCode}`;
      if (kpiWmoDesc) kpiWmoDesc.textContent = m.wmoDesc;
      if (kpiLclVal) kpiLclVal.innerHTML = `${m.lclMeters} <span class="unit">m AGL</span>`;
      if (kpiDewpointBadge) kpiDewpointBadge.textContent = `Td: ${m.dewPoint} °C`;
      if (kpiRiskVal) kpiRiskVal.innerHTML = `${m.convectiveRiskPct} <span class="unit">%</span>`;
      if (kpiRiskBadge) kpiRiskBadge.textContent = m.convectiveRiskPct > 65 ? 'High Risk' : m.convectiveRiskPct > 35 ? 'Moderate' : 'Low';
      if (kpiVerdictVal) kpiVerdictVal.textContent = m.primaryVerdict;
      if (kpiConfidenceBadge) kpiConfidenceBadge.textContent = `Confidence: ${m.confidenceScore}%`;
    }

    // 5. Future Timeline Horizons
    state.horizons.forEach(h => {
      const condEl = document.getElementById(`horizon-cond-${h.id}`);
      const pressEl = document.getElementById(`h-press-${h.id}`);
      const tempEl = document.getElementById(`h-temp-${h.id}`);
      const riskEl = document.getElementById(`h-risk-${h.id}`);
      const advEl = document.getElementById(`h-adv-${h.id}`);
      const iconEl = document.getElementById(`horizon-icon-${h.id}`);

      if (condEl) condEl.textContent = h.condition;
      if (pressEl) pressEl.textContent = `${h.expPress} hPa`;
      if (tempEl) tempEl.textContent = `${h.expTemp} °C`;
      if (riskEl) riskEl.textContent = `${h.risk} %`;
      if (advEl) advEl.textContent = h.advisory;
      if (iconEl) iconEl.innerHTML = `<i data-lucide="${h.icon}"></i>`;
    });

    // 6. Update Tropospheric Flow Bar & Decision Flowchart
    if (state.presentRecords.length > 0) {
      updateFlowBar(state.presentMetrics.currAlt);
    } else if (state.pastRecords.length > 0) {
      updateFlowBar(state.pastRecords[state.pastRecords.length - 1].compAlt);
    }
    updateFlowchart();

    if (window.lucide) {
      window.lucide.createIcons();
    }

    renderTable();
  }

  function updateFlowBar(alt) {
    const pointer = document.getElementById('flowbar-pointer');
    const badge = document.getElementById('pointer-alt-badge');
    if (!pointer) return;

    const safeAlt = (alt !== undefined && !isNaN(alt)) ? alt : 0;
    // Map 0m to 5000m across 0% to 100% (clamped between 2% and 96%)
    const pct = Math.min(96, Math.max(2, (safeAlt / 5000.0) * 100));
    pointer.style.left = `${pct}%`;
    if (badge) {
      badge.textContent = `Station: ${safeAlt.toFixed(1)} m`;
    }
  }

  function updateFlowchart() {
    const m = state.presentMetrics;
    const hasData = (state.presentRecords.length > 0 || state.pastRecords.length > 0);
    if (!hasData) return;

    // Stage 1: Barometric Pressure
    const flowPVal = document.getElementById('flow-p-val');
    const flowPDesc = document.getElementById('flow-p-desc');
    const flowPPill = document.getElementById('flow-p-pill');
    if (flowPVal) flowPVal.textContent = `${m.currPress.toFixed(1)} hPa`;
    if (flowPDesc) {
      if (m.currPress > 1022) {
        flowPDesc.textContent = 'High-pressure anticyclone dominant';
        if (flowPPill) { flowPPill.textContent = 'Anticyclonic High'; flowPPill.className = 'flow-step-pill pill-good'; }
      } else if (m.currPress < 1005) {
        flowPDesc.textContent = 'Low-pressure cyclonic depression';
        if (flowPPill) { flowPPill.textContent = 'Depression Front'; flowPPill.className = 'flow-step-pill pill-crit'; }
      } else {
        flowPDesc.textContent = 'Standard tropospheric barometric range';
        if (flowPPill) { flowPPill.textContent = 'Standard Sea-Level'; flowPPill.className = 'flow-step-pill pill-good'; }
      }
    }

    // Stage 2: WMO 3h Tendency
    const flowTendVal = document.getElementById('flow-tend-val');
    const flowTendDesc = document.getElementById('flow-tend-desc');
    const flowTendPill = document.getElementById('flow-tend-pill');
    if (flowTendVal) flowTendVal.textContent = `${m.wmoDelta3h > 0 ? '+' : ''}${m.wmoDelta3h.toFixed(2)} hPa/3h`;
    if (flowTendDesc) flowTendDesc.textContent = m.wmoDesc;
    if (flowTendPill) {
      if (m.wmoDelta3h <= -2.0) {
        flowTendPill.textContent = 'Rapid Pressure Plunge';
        flowTendPill.className = 'flow-step-pill pill-crit';
      } else if (m.wmoDelta3h <= -0.6) {
        flowTendPill.textContent = 'Negative Tendency';
        flowTendPill.className = 'flow-step-pill pill-warn';
      } else if (m.wmoDelta3h >= 2.0) {
        flowTendPill.textContent = 'Rapid Rise (Clearing)';
        flowTendPill.className = 'flow-step-pill pill-good';
      } else {
        flowTendPill.textContent = 'Barometrically Steady';
        flowTendPill.className = 'flow-step-pill pill-good';
      }
    }

    // Stage 3: Moisture & Cloud Ceiling
    const flowLclVal = document.getElementById('flow-lcl-val');
    const flowLclDesc = document.getElementById('flow-lcl-desc');
    const flowLclPill = document.getElementById('flow-lcl-pill');
    if (flowLclVal) flowLclVal.textContent = `LCL: ${m.lclMeters} m AGL`;
    if (flowLclDesc) {
      flowLclDesc.textContent = `Dew Point Td: ${m.dewPoint.toFixed(1)}°C | Spread: ${(m.currTemp - m.dewPoint).toFixed(1)}°C`;
    }
    if (flowLclPill) {
      if (m.lclMeters < 300) {
        flowLclPill.textContent = 'Low Stratus / Fog Ceiling';
        flowLclPill.className = 'flow-step-pill pill-warn';
      } else if (m.lclMeters < 1000) {
        flowLclPill.textContent = 'Cumulus Cloud Base Formation';
        flowLclPill.className = 'flow-step-pill pill-info';
      } else {
        flowLclPill.textContent = 'High Ceiling (Dry Column)';
        flowLclPill.className = 'flow-step-pill pill-good';
      }
    }

    // Stage 4: AI Predictive Forecast
    const flowPredVal = document.getElementById('flow-pred-val');
    const flowPredDesc = document.getElementById('flow-pred-desc');
    const flowPredPill = document.getElementById('flow-pred-pill');
    if (flowPredVal) flowPredVal.textContent = m.primaryVerdict;
    if (flowPredDesc) {
      flowPredDesc.textContent = `24h Projection: Rain Risk ${m.convectiveRiskPct}% | Confidence ${m.confidenceScore}%`;
    }
    if (flowPredPill) {
      if (m.convectiveRiskPct >= 70) {
        flowPredPill.textContent = 'Precipitation Expected';
        flowPredPill.className = 'flow-step-pill pill-crit';
      } else if (m.convectiveRiskPct >= 40) {
        flowPredPill.textContent = 'Unsettled / Shower Risk';
        flowPredPill.className = 'flow-step-pill pill-warn';
      } else {
        flowPredPill.textContent = 'Fair / Clear Skies';
        flowPredPill.className = 'flow-step-pill pill-good';
      }
    }
  }

  function resetMetrics() {
    state.pastStats = { count: 0, meanPress: 0, stdDevPress: 0, meanTemp: 0, minPress: 0, maxPress: 0, timeSpanHours: 0 };
    state.presentMetrics = {
      currPress: 0, currTemp: 0, currAlt: 0, currQnh: 1013.25,
      dewPoint: 0, lclMeters: 0, wmoDelta3h: 0, wmoCode: 4, wmoDesc: 'Steady',
      tendencyHpaPerHr: 0, acceleration: 0, baselineDiff: 0, convectiveRiskPct: 0,
      primaryVerdict: 'Awaiting Data', confidenceScore: 0
    };
    state.horizons = [];
  }

  // ==============================================================================
  // Interactive Chart.js Visualizations
  // ==============================================================================

  function initEmptyCharts() {
    const ctxSynoptic = document.getElementById('chart-synoptic');
    const ctxThermo = document.getElementById('chart-thermo');
    const ctxDerivative = document.getElementById('chart-derivative');

    if (ctxSynoptic) {
      if (chartSynoptic) chartSynoptic.destroy();
      chartSynoptic = new Chart(ctxSynoptic, {
        type: 'line',
        data: { labels: [], datasets: [] },
        options: getChartOptions('Barometric Pressure (hPa)', 'Pressure (hPa)')
      });
    }

    if (ctxThermo) {
      if (chartThermo) chartThermo.destroy();
      chartThermo = new Chart(ctxThermo, {
        type: 'line',
        data: { labels: [], datasets: [] },
        options: getChartOptions('Temperature & Dew Point (°C)', 'Temperature (°C)')
      });
    }

    if (ctxDerivative) {
      if (chartDerivative) chartDerivative.destroy();
      chartDerivative = new Chart(ctxDerivative, {
        type: 'line',
        data: { labels: [], datasets: [] },
        options: getChartOptions('Tendency Rate (hPa/hr)', 'Rate of Change')
      });
    }
  }

  function getChartOptions(title, yLabel) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 200 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0f172a',
          titleColor: '#ffffff',
          bodyColor: '#e2e8f0',
          borderColor: '#cbd5e1',
          borderWidth: 1,
          padding: 10,
          cornerRadius: 8
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(148, 163, 184, 0.15)' },
          ticks: { color: '#64748b', font: { family: 'Inter', size: 10 }, maxRotation: 0 }
        },
        y: {
          grid: { color: 'rgba(148, 163, 184, 0.15)' },
          ticks: { color: '#64748b', font: { family: 'JetBrains Mono', size: 10 } },
          title: { display: true, text: yLabel, color: '#475569', font: { size: 11, weight: '600' } }
        }
      }
    };
  }

  function renderCharts(isSmooth = false) {
    const mode = isSmooth ? 'none' : undefined;
    renderSynopticChart(mode);
    renderThermoChart(mode);
    renderDerivativeChart(mode);
  }

  function renderSynopticChart(updateMode) {
    if (!chartSynoptic) return;

    const labels = [];
    const pastData = [];
    const presentData = [];
    const forecastData = [];

    // Past points
    state.pastRecords.forEach((r, idx) => {
      const lbl = `P-${formatTimeLabel(r.time)}`;
      labels.push(lbl);
      pastData.push(r.press);
      presentData.push(null);
      forecastData.push(null);
    });

    // Present points
    state.presentRecords.forEach((r, idx) => {
      const lbl = `Now-${formatTimeLabel(r.time)}`;
      labels.push(lbl);
      pastData.push(null);
      presentData.push(r.press);
      forecastData.push(null);
    });

    // Bridge point: Connect latest observation to forecast
    if (labels.length > 0 && state.forecastRecords.length > 0) {
      const lastIdx = labels.length - 1;
      forecastData[lastIdx] = state.presentMetrics.currPress;
    }

    // Forecast points
    state.forecastRecords.forEach((r, idx) => {
      const lbl = `+${idx + 1}h`;
      labels.push(lbl);
      pastData.push(null);
      presentData.push(null);
      forecastData.push(r.press);
    });

    chartSynoptic.data.labels = labels;
    chartSynoptic.data.datasets = [
      {
        label: 'Past Historical Baseline',
        data: pastData,
        borderColor: '#0284c7',
        backgroundColor: 'rgba(2, 132, 199, 0.08)',
        borderWidth: 2,
        tension: 0.25,
        fill: true,
        pointRadius: pastData.length > 50 ? 0 : 2
      },
      {
        label: 'Present Observed Telemetry',
        data: presentData,
        borderColor: '#f59e0b',
        backgroundColor: 'rgba(245, 158, 11, 0.1)',
        borderWidth: 2.5,
        tension: 0.2,
        fill: true,
        pointRadius: presentData.length > 50 ? 0 : 3
      },
      {
        label: 'Future Extrapolated Forecast (+24h)',
        data: forecastData,
        borderColor: '#7c3aed',
        borderDash: [6, 4],
        borderWidth: 2.5,
        tension: 0.35,
        fill: false,
        pointRadius: 2
      }
    ];

    chartSynoptic.update(updateMode);
  }

  function renderThermoChart(updateMode) {
    if (!chartThermo) return;

    const source = (state.presentRecords.length > 0) ? state.presentRecords : state.pastRecords;
    const labels = source.map(r => formatTimeLabel(r.time));
    const tempData = source.map(r => r.temp);
    const dewData = source.map(r => r.dewPoint);

    chartThermo.data.labels = labels;
    chartThermo.data.datasets = [
      {
        label: 'Ambient Temperature (°C)',
        data: tempData,
        borderColor: '#e11d48',
        backgroundColor: 'transparent',
        borderWidth: 2,
        tension: 0.25,
        pointRadius: 0
      },
      {
        label: 'Dew Point Temperature (°C)',
        data: dewData,
        borderColor: '#0284c7',
        backgroundColor: 'rgba(2, 132, 199, 0.08)',
        borderWidth: 2,
        tension: 0.25,
        fill: true,
        pointRadius: 0
      }
    ];

    chartThermo.update(updateMode);
  }

  function renderDerivativeChart(updateMode) {
    if (!chartDerivative) return;

    const source = (state.presentRecords.length > 0) ? state.presentRecords : state.pastRecords;
    if (source.length < 2) return;

    const labels = [];
    const derivativeData = [];
    const stormThresholdNeg = [];
    const stormThresholdPos = [];

    for (let i = 1; i < source.length; i++) {
      const dt = Math.max(0.01, (source[i].time - source[i - 1].time) / 3600.0);
      const dp = source[i].press - source[i - 1].press;
      const rate = parseFloat((dp / dt).toFixed(2));

      labels.push(formatTimeLabel(source[i].time));
      derivativeData.push(rate);
      stormThresholdNeg.push(-0.67); // Equivalent to -2.0 hPa per 3 hours
      stormThresholdPos.push(0.67);  // Equivalent to +2.0 hPa per 3 hours
    }

    chartDerivative.data.labels = labels;
    chartDerivative.data.datasets = [
      {
        label: 'Pressure Rate (hPa/hr)',
        data: derivativeData,
        borderColor: '#059669',
        backgroundColor: 'rgba(5, 150, 105, 0.1)',
        borderWidth: 2,
        tension: 0.2,
        pointRadius: 0
      },
      {
        label: 'WMO Rapid Drop Threshold',
        data: stormThresholdNeg,
        borderColor: '#dc2626',
        borderDash: [4, 4],
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false
      },
      {
        label: 'WMO Rapid Rise Threshold',
        data: stormThresholdPos,
        borderColor: '#2563eb',
        borderDash: [4, 4],
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false
      }
    ];

    chartDerivative.update(updateMode);
  }

  function formatTimeLabel(sec) {
    const s = Math.floor(sec);
    const m = Math.floor(s / 60) % 60;
    const h = Math.floor(s / 3600);
    return `${pad(h)}:${pad(m)}`;
  }

  function pad(n) {
    return n < 10 ? '0' + n : n;
  }

  // ==============================================================================
  // Telemetry Table & Pagination
  // ==============================================================================

  function handleTableSearch(e) {
    state.searchQuery = e.target.value.toLowerCase().trim();
    state.currentPage = 1;
    renderTable();
  }

  function changePage(delta) {
    state.currentPage += delta;
    renderTable();
  }

  function renderTable() {
    const tbody = document.getElementById('table-body');
    const pageInfo = document.getElementById('page-info');
    if (!tbody) return;

    let filtered = state.tableRecords;
    if (state.searchQuery) {
      filtered = filtered.filter(r => 
        r.tag.toLowerCase().includes(state.searchQuery) ||
        r.press.toString().includes(state.searchQuery) ||
        r.alt.toString().includes(state.searchQuery) ||
        r.temp.toString().includes(state.searchQuery) ||
        r.verdict.toLowerCase().includes(state.searchQuery)
      );
    }

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" class="empty-table-msg">No matching telemetry records found.</td></tr>`;
      if (pageInfo) pageInfo.textContent = 'Showing 0 of 0 records';
      if (btnPrevPage) btnPrevPage.disabled = true;
      if (btnNextPage) btnNextPage.disabled = true;
      return;
    }

    const totalPages = Math.ceil(filtered.length / state.rowsPerPage);
    if (state.currentPage < 1) state.currentPage = 1;
    if (state.currentPage > totalPages) state.currentPage = totalPages;

    const startIdx = (state.currentPage - 1) * state.rowsPerPage;
    const pageItems = filtered.slice(startIdx, startIdx + state.rowsPerPage);

    let html = '';
    pageItems.forEach(r => {
      let tagClass = 'tag-past';
      if (r.tag === 'PRESENT') tagClass = 'tag-present';
      if (r.tag === 'FORECAST') tagClass = 'tag-forecast';

      html += `<tr>
        <td><span class="${tagClass}">${r.tag}</span></td>
        <td>${formatTimeLabel(r.time)}</td>
        <td><strong>${r.press}</strong></td>
        <td>${r.alt} m</td>
        <td>${r.temp} °C</td>
        <td>${r.dewPoint} °C</td>
        <td>${r.lcl} m</td>
        <td>${r.trend > 0 ? '+' : ''}${r.trend}</td>
        <td>${r.verdict}</td>
        <td>${r.risk}%</td>
      </tr>`;
    });

    tbody.innerHTML = html;
    if (pageInfo) pageInfo.textContent = `Showing ${startIdx + 1} to ${Math.min(filtered.length, startIdx + state.rowsPerPage)} of ${filtered.length} records`;
    if (btnPrevPage) btnPrevPage.disabled = (state.currentPage <= 1);
    if (btnNextPage) btnNextPage.disabled = (state.currentPage >= totalPages);
  }

  function exportAnalyzedCsv() {
    if (state.tableRecords.length === 0) {
      alert('No data to export.');
      return;
    }

    let csv = 'Dataset,Time_s,Pressure_hPa,Comp_Altitude_m,Temp_C,DewPoint_C,CloudBase_LCL_m,Tendency_hPa_hr,Verdict,RainRisk_pct\n';
    state.tableRecords.forEach(r => {
      csv += `${r.tag},${r.time},${r.press},${r.alt},${r.temp},${r.dewPoint},${r.lcl},${r.trend},"${r.verdict}",${r.risk}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `AeroSense_Meteorological_Analysis_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // ==============================================================================
  // Web Serial Live Stream Reader (Connects to ESP32 USB)
  // ==============================================================================

  async function toggleLiveSerialStream() {
    if (state.isStreaming) {
      // Disconnect
      if (state.serialReader) {
        await state.serialReader.cancel();
      }
      if (state.serialPort) {
        await state.serialPort.close();
      }
      state.isStreaming = false;
      state.serialPort = null;
      state.serialReader = null;
      btnLiveSerial.innerHTML = `<span class="live-dot"></span> <i data-lucide="radio"></i> Live ESP32 Stream`;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    if (!('serial' in navigator)) {
      alert('Web Serial is supported in Google Chrome, Microsoft Edge, and Opera. Please open this page in Chrome or Edge.');
      return;
    }

    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });

      state.serialPort = port;
      state.isStreaming = true;
      btnLiveSerial.innerHTML = `<span class="live-dot"></span> <i data-lucide="power-off"></i> Disconnect Live USB`;
      if (window.lucide) window.lucide.createIcons();

      const textDecoder = new TextDecoderStream();
      port.readable.pipeTo(textDecoder.writable);
      const reader = textDecoder.readable.getReader();
      state.serialReader = reader;

      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          buffer += value;
          const lines = buffer.split('\n');
          buffer = lines.pop(); // Keep incomplete tail

          for (const line of lines) {
            processLiveSerialLine(line.trim());
          }
        }
      }
    } catch (err) {
      console.error('Serial Error:', err);
      state.isStreaming = false;
      btnLiveSerial.innerHTML = `<span class="live-dot"></span> <i data-lucide="radio"></i> Live ESP32 Stream`;
      if (window.lucide) window.lucide.createIcons();
    }
  }

  let liveEngineTimeout = null;
  let lastEngineRunTime = 0;

  function scheduleLiveEngineRun(throttleMs = 2000) {
    const now = Date.now();
    if (now - lastEngineRunTime >= throttleMs) {
      if (liveEngineTimeout) clearTimeout(liveEngineTimeout);
      liveEngineTimeout = null;
      lastEngineRunTime = now;
      runDeepMeteorologicalEngine(true);
    } else if (!liveEngineTimeout) {
      liveEngineTimeout = setTimeout(() => {
        liveEngineTimeout = null;
        lastEngineRunTime = Date.now();
        runDeepMeteorologicalEngine(true);
      }, throttleMs - (now - lastEngineRunTime));
    }
  }

  function processLiveSerialLine(line) {
    if (!line.startsWith('$AERO')) return;

    // Format: $AERO,uptime_s,temp_c,press_hpa,alt_m,qnh_hpa
    const parts = line.split(',');
    if (parts.length >= 6) {
      const timeSec = parseFloat(parts[1]);
      const temp = parseFloat(parts[2]);
      const press = parseFloat(parts[3]);
      const alt = parseFloat(parts[4]);
      const qnh = parseFloat(parts[5]);

      if (!isNaN(temp) && !isNaN(press) && press >= 300) {
        const estRh = Math.min(98, Math.max(15, 65.0 - (temp - 20.0) * 1.8 + (1013.25 - press) * 0.4));
        const dewPoint = calculateDewPoint(temp, estRh);
        const lclMeters = Math.max(50, Math.round(125.0 * (temp - dewPoint)));

        // Store EVERY record: All historical & present telemetry retained - NEVER discard!
        state.presentRecords.push({
          record: state.presentRecords.length + 1,
          time: timeSec,
          temp: temp,
          press: press,
          alt: alt,
          compAlt: alt,
          qnh: qnh,
          humidity: estRh,
          dewPoint: dewPoint,
          lclMeters: lclMeters
        });

        // 1. Instantaneous One-by-One KPI update (smooth numbers, zero full-page tearing)
        const statPresentCount = document.getElementById('stat-present-count');
        const statPresentCurrP = document.getElementById('stat-present-curr-p');
        const statPresentAlt = document.getElementById('stat-present-alt');
        const badgePresent = document.getElementById('badge-present-status');

        if (statPresentCount) statPresentCount.textContent = state.presentRecords.length;
        if (statPresentCurrP) statPresentCurrP.textContent = `${press.toFixed(2)} hPa`;
        if (statPresentAlt) statPresentAlt.textContent = `${alt.toFixed(1)} m`;
        if (badgePresent) {
          badgePresent.className = 'dataset-badge badge-loaded';
          badgePresent.textContent = `${state.presentRecords.length} Points Streamed`;
        }

        const kpiAltVal = document.getElementById('kpi-alt-val');
        const kpiPressVal = document.getElementById('kpi-press-val');
        const kpiQnhBadge = document.getElementById('kpi-qnh-badge');
        if (kpiAltVal) kpiAltVal.innerHTML = `${alt.toFixed(1)} <span class="unit">m</span>`;
        if (kpiPressVal) kpiPressVal.innerHTML = `${press.toFixed(2)} <span class="unit">hPa</span>`;
        if (kpiQnhBadge) kpiQnhBadge.textContent = `QNH ${qnh.toFixed(2)}`;

        // Instantly glide the Atmospheric Stratification Flow Bar pointer
        updateFlowBar(alt);

        // Update Flowchart live indicators (Stage 1 & Stage 3)
        const flowPVal = document.getElementById('flow-p-val');
        const flowLclVal = document.getElementById('flow-lcl-val');
        if (flowPVal) flowPVal.textContent = `${press.toFixed(1)} hPa`;
        if (flowLclVal) flowLclVal.textContent = `LCL: ${lclMeters} m`;

        // 2. Schedule Smooth Throttled Engine Run (Recalculates WMO tendency, future horizons, charts)
        // Uses smooth 'none' update mode on Chart.js to completely eliminate 1-second DOM flashing!
        scheduleLiveEngineRun(2000);
      }
    }
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
          const yOffset = -120; // Offset for fixed top navbar and sub-nav
          const y = targetSec.getBoundingClientRect().top + window.pageYOffset + yOffset;
          window.scrollTo({ top: y, behavior: 'smooth' });
        }
      });
    });

    const initialActive = subNav.querySelector('.sub-nav-btn.active') || buttons[0];
    setTimeout(() => updatePill(initialActive), 120);

    window.addEventListener('resize', () => {
      const currentActive = subNav.querySelector('.sub-nav-btn.active');
      updatePill(currentActive);
    });

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

});
