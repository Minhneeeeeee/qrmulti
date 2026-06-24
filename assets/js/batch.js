(() => {
  "use strict";

  const root = document.documentElement;
  const lang = root.dataset.lang || "vi";
  const baseT = (window.QR_MULTI_I18N && window.QR_MULTI_I18N[lang]) || {};
  const batchT = (window.QR_MULTI_BATCH_I18N && window.QR_MULTI_BATCH_I18N[lang]) || {};
  const t = { ...baseT, ...batchT };
  const qs = (selector, parent = document) => parent.querySelector(selector);
  const qsa = (selector, parent = document) => [...parent.querySelectorAll(selector)];

  const MAX_FILE_BYTES = 25 * 1024 * 1024;
  const MAX_VALID_ROWS = 2000;
  const MAX_QR_LENGTH = 2900;
  const MAX_LOGO_BYTES = 2 * 1024 * 1024;
  const PREVIEW_LIMIT = 8;

  const state = {
    file: null,
    workbook: null,
    matrix: [],
    headers: [],
    rows: [],
    records: [],
    errors: [],
    logo: "",
    transparent: false,
    previewInstances: [],
    generating: false,
    cancelRequested: false
  };

  qsa("[data-i18n]").forEach(element => {
    const key = element.dataset.i18n;
    if (Object.prototype.hasOwnProperty.call(t, key)) element.textContent = t[key];
  });
  qsa("[data-i18n-placeholder]").forEach(element => {
    const key = element.dataset.i18nPlaceholder;
    if (Object.prototype.hasOwnProperty.call(t, key)) element.placeholder = t[key];
  });

  const elements = {
    dropZone: qs("#dropZone"),
    batchFile: qs("#batchFile"),
    chooseFile: qs("#chooseFile"),
    replaceFile: qs("#replaceFile"),
    fileSummary: qs("#fileSummary"),
    fileNameDisplay: qs("#fileNameDisplay"),
    fileMeta: qs("#fileMeta"),
    sheetSelect: qs("#sheetSelect"),
    headerRow: qs("#headerRow"),
    contentColumn: qs("#contentColumn"),
    filenameColumn: qs("#filenameColumn"),
    labelColumn1: qs("#labelColumn1"),
    labelColumn2: qs("#labelColumn2"),
    totalRows: qs("#totalRows"),
    validRows: qs("#validRows"),
    skippedRows: qs("#skippedRows"),
    previewGrid: qs("#previewGrid"),
    errorBox: qs("#errorBox"),
    errorCount: qs("#errorCount"),
    errorList: qs("#errorList"),
    batchDotStyle: qs("#batchDotStyle"),
    batchCornerStyle: qs("#batchCornerStyle"),
    batchCornerDotStyle: qs("#batchCornerDotStyle"),
    batchErrorCorrection: qs("#batchErrorCorrection"),
    batchQrSize: qs("#batchQrSize"),
    batchQrMargin: qs("#batchQrMargin"),
    batchQrColor: qs("#batchQrColor"),
    batchBgColor: qs("#batchBgColor"),
    batchTransparentBg: qs("#batchTransparentBg"),
    batchLogoSize: qs("#batchLogoSize"),
    batchLogoFile: qs("#batchLogoFile"),
    batchLogoName: qs("#batchLogoName"),
    batchRemoveLogo: qs("#batchRemoveLogo"),
    resetBatchStyle: qs("#resetBatchStyle"),
    zipName: qs("#zipName"),
    generateZip: qs("#generateZip"),
    cancelGeneration: qs("#cancelGeneration"),
    exportStatus: qs("#exportStatus"),
    progressShell: qs("#progressShell"),
    progressBar: qs("#progressBar"),
    progressMeta: qs("#progressMeta"),
    progressText: qs("#progressText"),
    progressPercent: qs("#progressPercent"),
    toast: qs("#toast"),
    batchQrEngine: qs("#batchQrEngine")
  };

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => elements.toast.classList.remove("show"), 2200);
  }

  function saveLanguage(value) {
    try { window.localStorage.setItem("qrMultiLang", value); } catch (_) {}
  }

  qsa(".lang-btn").forEach(button => button.addEventListener("click", () => {
    saveLanguage(button.dataset.lang);
    window.location.href = button.dataset.href;
  }));
  saveLanguage(lang);

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / (1024 ** index);
    return `${value.toFixed(index === 0 ? 0 : value >= 10 ? 1 : 2)} ${units[index]}`;
  }

  function normalizeCell(value) {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  }

  function cleanFileName(value, fallback = "qr") {
    let name = normalizeCell(value) || fallback;
    name = name
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
      .replace(/[. ]+$/g, "")
      .replace(/\s+/g, " ")
      .slice(0, 100)
      .trim();
    if (!name) name = fallback;
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) name = `_${name}`;
    return name;
  }

  function cleanZipName() {
    return cleanFileName(elements.zipName.value, "qr-multi-batch").replace(/\s+/g, "-");
  }

  function option(label, value) {
    const element = document.createElement("option");
    element.value = String(value);
    element.textContent = label;
    return element;
  }

  function setSelectOptions(select, options, preferredValue) {
    const previous = preferredValue ?? select.value;
    select.innerHTML = "";
    options.forEach(item => select.append(option(item.label, item.value)));
    const exists = options.some(item => String(item.value) === String(previous));
    select.value = exists ? String(previous) : String(options[0]?.value ?? "");
  }

  function detectHeaderIndex(matrix) {
    const limit = Math.min(matrix.length, 20);
    let firstNonEmpty = 0;
    for (let index = 0; index < limit; index += 1) {
      const row = Array.isArray(matrix[index]) ? matrix[index] : [];
      const cells = row.map(normalizeCell).filter(Boolean);
      if (!cells.length) continue;
      firstNonEmpty = index;
      const stringLike = cells.filter(value => !/^[-+]?\d+(?:[.,]\d+)?$/.test(value)).length;
      if (cells.length >= 2 && stringLike >= Math.ceil(cells.length / 2)) return index;
      if (cells.length === 1 && stringLike === 1) return index;
    }
    return firstNonEmpty;
  }

  function buildUniqueHeaders(rawHeaders, width) {
    const seen = new Map();
    const headers = [];
    for (let column = 0; column < width; column += 1) {
      const fallback = `${String.fromCharCode(65 + (column % 26))}${column >= 26 ? Math.floor(column / 26) : ""}`;
      const base = normalizeCell(rawHeaders[column]) || `${lang === "zh-cn" ? "列" : lang === "en" ? "Column" : "Cột"} ${fallback}`;
      const count = (seen.get(base) || 0) + 1;
      seen.set(base, count);
      headers.push(count === 1 ? base : `${base} (${count})`);
    }
    return headers;
  }

  function getMatrixWidth(matrix) {
    return matrix.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
  }

  function populateSheetSelect() {
    const names = state.workbook?.SheetNames || [];
    setSelectOptions(elements.sheetSelect, names.map(name => ({ label: name, value: name })), names[0]);
    elements.sheetSelect.disabled = names.length === 0;
  }

  function resetDataset() {
    state.matrix = [];
    state.headers = [];
    state.rows = [];
    state.records = [];
    state.errors = [];
    elements.totalRows.textContent = "0";
    elements.validRows.textContent = "0";
    elements.skippedRows.textContent = "0";
    [elements.contentColumn, elements.filenameColumn, elements.labelColumn1, elements.labelColumn2].forEach(select => {
      select.innerHTML = "";
      select.disabled = true;
    });
    renderPreview();
    renderErrors();
    updateExportState();
  }

  function readSelectedSheet({ autoDetectHeader = false } = {}) {
    if (!state.workbook) return;
    const sheetName = elements.sheetSelect.value;
    const sheet = state.workbook.Sheets[sheetName];
    if (!sheet) {
      resetDataset();
      elements.exportStatus.textContent = t.emptySheet;
      return;
    }

    const matrix = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: false,
      blankrows: true
    });
    state.matrix = matrix;

    if (!matrix.some(row => Array.isArray(row) && row.some(cell => normalizeCell(cell)))) {
      resetDataset();
      elements.exportStatus.textContent = t.emptySheet;
      return;
    }

    const maxHeader = Math.max(1, Math.min(matrix.length, 1000));
    elements.headerRow.max = String(maxHeader);
    if (autoDetectHeader || !Number(elements.headerRow.value)) {
      elements.headerRow.value = String(detectHeaderIndex(matrix) + 1);
    }
    rebuildRowsFromHeader();
  }

  function rebuildRowsFromHeader() {
    if (!state.matrix.length) return;
    const headerIndex = Math.max(0, Math.min(state.matrix.length - 1, Number(elements.headerRow.value || 1) - 1));
    elements.headerRow.value = String(headerIndex + 1);
    const width = getMatrixWidth(state.matrix.slice(headerIndex));
    const rawHeaders = Array.isArray(state.matrix[headerIndex]) ? state.matrix[headerIndex] : [];
    state.headers = buildUniqueHeaders(rawHeaders, width);
    state.rows = [];

    for (let rowIndex = headerIndex + 1; rowIndex < state.matrix.length; rowIndex += 1) {
      const row = Array.isArray(state.matrix[rowIndex]) ? state.matrix[rowIndex] : [];
      const values = Array.from({ length: width }, (_, column) => normalizeCell(row[column]));
      if (!values.some(Boolean)) continue;
      state.rows.push({ sourceRow: rowIndex + 1, values });
    }

    const headerOptions = state.headers.map((header, index) => ({ label: header, value: index }));
    const contentPrevious = elements.contentColumn.value;
    const filenamePrevious = elements.filenameColumn.value;
    const label1Previous = elements.labelColumn1.value;
    const label2Previous = elements.labelColumn2.value;

    setSelectOptions(elements.contentColumn, headerOptions, contentPrevious || 0);
    setSelectOptions(elements.filenameColumn, [{ label: t.rowNumber, value: -1 }, ...headerOptions], filenamePrevious || (headerOptions[1]?.value ?? -1));
    setSelectOptions(elements.labelColumn1, [{ label: t.noLabel, value: -1 }, ...headerOptions], label1Previous || -1);
    setSelectOptions(elements.labelColumn2, [{ label: t.noLabel, value: -1 }, ...headerOptions], label2Previous || -1);
    [elements.contentColumn, elements.filenameColumn, elements.labelColumn1, elements.labelColumn2].forEach(select => { select.disabled = false; });

    refreshRecords();
  }

  function selectedColumn(select) {
    const parsed = Number(select.value);
    return Number.isInteger(parsed) ? parsed : -1;
  }

  function refreshRecords() {
    const contentIndex = selectedColumn(elements.contentColumn);
    const filenameIndex = selectedColumn(elements.filenameColumn);
    const label1Index = selectedColumn(elements.labelColumn1);
    const label2Index = selectedColumn(elements.labelColumn2);
    const records = [];
    const errors = [];

    if (contentIndex < 0 || !state.headers[contentIndex]) {
      state.records = [];
      state.errors = [];
      renderStats();
      renderPreview();
      renderErrors();
      updateExportState();
      return;
    }

    state.rows.forEach(row => {
      const data = normalizeCell(row.values[contentIndex]);
      if (!data) {
        errors.push({ row: row.sourceRow, reason: t.contentEmpty, content: "" });
        return;
      }
      if (data.length > MAX_QR_LENGTH) {
        errors.push({ row: row.sourceRow, reason: t.contentTooLong, content: data.slice(0, 120) });
        return;
      }
      const rawName = filenameIndex >= 0 ? row.values[filenameIndex] : `${t.rowLabel}-${row.sourceRow}`;
      const labels = [
        label1Index >= 0 ? normalizeCell(row.values[label1Index]) : "",
        label2Index >= 0 ? normalizeCell(row.values[label2Index]) : ""
      ].filter(Boolean);
      records.push({
        sourceRow: row.sourceRow,
        data,
        baseName: cleanFileName(rawName, `qr-${row.sourceRow}`),
        labels
      });
    });

    state.records = records;
    state.errors = errors;
    renderStats();
    renderPreview();
    renderErrors();
    updateExportState();
  }

  function renderStats() {
    elements.totalRows.textContent = String(state.rows.length);
    elements.validRows.textContent = String(state.records.length);
    elements.skippedRows.textContent = String(state.errors.length);
  }

  function renderErrors() {
    const errors = [...state.errors];
    if (state.records.length > MAX_VALID_ROWS) {
      errors.unshift({ row: "—", reason: t.tooManyRows, content: "" });
    }
    elements.errorList.innerHTML = "";
    elements.errorCount.textContent = String(errors.length);
    elements.errorBox.classList.toggle("show", errors.length > 0);
    errors.slice(0, 50).forEach(error => {
      const row = document.createElement("div");
      row.className = "error-row";
      const rowLabel = document.createElement("strong");
      rowLabel.textContent = `${t.rowLabel} ${error.row}`;
      const message = document.createElement("span");
      message.textContent = error.content ? `${error.reason}: ${error.content}` : error.reason;
      row.append(rowLabel, message);
      elements.errorList.append(row);
    });
    if (errors.length > 50) {
      const more = document.createElement("div");
      more.className = "error-row";
      more.innerHTML = `<strong>+${errors.length - 50}</strong><span>${t.moreErrors}</span>`;
      elements.errorList.append(more);
    }
  }

  function getStyle(sizeOverride) {
    const size = sizeOverride || Number(elements.batchQrSize.value);
    const background = state.transparent ? "transparent" : elements.batchBgColor.value;
    return {
      width: size,
      height: size,
      data: "https://qrmulti.com",
      image: state.logo || "",
      margin: Number(elements.batchQrMargin.value),
      qrOptions: { errorCorrectionLevel: elements.batchErrorCorrection.value },
      dotsOptions: { color: elements.batchQrColor.value, type: elements.batchDotStyle.value },
      cornersSquareOptions: { color: elements.batchQrColor.value, type: elements.batchCornerStyle.value },
      cornersDotOptions: { color: elements.batchQrColor.value, type: elements.batchCornerDotStyle.value },
      backgroundOptions: { color: background },
      imageOptions: {
        hideBackgroundDots: true,
        imageSize: Number(elements.batchLogoSize.value),
        margin: 5,
        saveAsBlob: true
      }
    };
  }

  let previewTimer;
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 120);
  }

  function renderPreview() {
    elements.previewGrid.innerHTML = "";
    state.previewInstances = [];
    if (!state.records.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = t.previewEmpty;
      elements.previewGrid.append(empty);
      return;
    }

    state.records.slice(0, PREVIEW_LIMIT).forEach(record => {
      const card = document.createElement("article");
      card.className = "preview-item";
      const qrTarget = document.createElement("div");
      qrTarget.className = "preview-qr";
      const file = document.createElement("div");
      file.className = "preview-file";
      file.title = `${record.baseName}.png`;
      file.textContent = `${record.baseName}.png`;
      card.append(qrTarget, file);
      record.labels.forEach(label => {
        const line = document.createElement("div");
        line.className = "preview-label";
        line.title = label;
        line.textContent = label;
        card.append(line);
      });
      elements.previewGrid.append(card);

      try {
        const style = getStyle(180);
        style.data = record.data;
        const instance = new QRCodeStyling({ ...style, type: "svg" });
        instance.append(qrTarget);
        state.previewInstances.push(instance);
      } catch (_) {
        qrTarget.textContent = "QR";
      }
    });
  }

  function updateRangeOutputs() {
    qsa("[data-batch-range-output]").forEach(output => {
      const input = qs(`#${output.dataset.batchRangeOutput}`);
      if (!input) return;
      output.textContent = output.dataset.suffix === "%"
        ? `${Math.round(Number(input.value) * 100)}%`
        : `${input.value}${output.dataset.suffix || ""}`;
    });
  }

  function updateExportState() {
    const tooMany = state.records.length > MAX_VALID_ROWS;
    const canExport = state.records.length > 0 && !tooMany && !state.generating;
    elements.generateZip.disabled = !canExport;
    if (!state.generating) {
      if (tooMany) elements.exportStatus.textContent = t.tooManyRows;
      else if (!state.records.length) elements.exportStatus.textContent = t.exportReady;
      else elements.exportStatus.textContent = `${state.records.length} ${t.validRows.toLowerCase ? t.validRows.toLowerCase() : t.validRows}`;
    }
  }

  async function loadFile(file) {
    if (!file) return;
    const extension = (file.name.split(".").pop() || "").toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(extension)) {
      showToast(t.unsupportedFile);
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      showToast(t.fileTooLarge);
      return;
    }

    try {
      elements.exportStatus.textContent = t.preparing;
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
      if (!workbook.SheetNames?.length) throw new Error(t.emptyWorkbook);
      state.file = file;
      state.workbook = workbook;
      elements.fileNameDisplay.textContent = file.name;
      elements.fileMeta.textContent = `${formatBytes(file.size)} · ${workbook.SheetNames.length} ${t.sheet}`;
      elements.fileSummary.classList.add("show");
      populateSheetSelect();
      readSelectedSheet({ autoDetectHeader: true });
    } catch (error) {
      console.error(error);
      resetDataset();
      showToast(error?.message === t.emptyWorkbook ? t.emptyWorkbook : t.readFailed);
      elements.exportStatus.textContent = t.readFailed;
    }
  }

  elements.chooseFile.addEventListener("click", () => elements.batchFile.click());
  elements.replaceFile.addEventListener("click", () => elements.batchFile.click());
  elements.batchFile.addEventListener("change", event => loadFile(event.target.files?.[0]));
  ["dragenter", "dragover"].forEach(type => elements.dropZone.addEventListener(type, event => {
    event.preventDefault();
    elements.dropZone.classList.add("dragover");
  }));
  ["dragleave", "drop"].forEach(type => elements.dropZone.addEventListener(type, event => {
    event.preventDefault();
    elements.dropZone.classList.remove("dragover");
  }));
  elements.dropZone.addEventListener("drop", event => loadFile(event.dataTransfer?.files?.[0]));

  elements.sheetSelect.addEventListener("change", () => readSelectedSheet({ autoDetectHeader: true }));
  elements.headerRow.addEventListener("change", rebuildRowsFromHeader);
  [elements.contentColumn, elements.filenameColumn, elements.labelColumn1, elements.labelColumn2]
    .forEach(select => select.addEventListener("change", refreshRecords));

  [
    elements.batchDotStyle,
    elements.batchCornerStyle,
    elements.batchCornerDotStyle,
    elements.batchErrorCorrection,
    elements.batchQrSize,
    elements.batchQrMargin,
    elements.batchQrColor,
    elements.batchBgColor,
    elements.batchLogoSize
  ].forEach(control => {
    control.addEventListener("input", () => { updateRangeOutputs(); schedulePreview(); });
    control.addEventListener("change", () => { updateRangeOutputs(); schedulePreview(); });
  });

  elements.batchTransparentBg.addEventListener("change", event => {
    state.transparent = event.target.checked;
    elements.batchBgColor.disabled = state.transparent;
    schedulePreview();
  });

  elements.batchLogoFile.addEventListener("change", event => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|jpg|svg\+xml|webp)$/i.test(file.type)) {
      showToast(t.invalidLogo);
      event.target.value = "";
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      showToast(t.logoTooLarge);
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      state.logo = String(reader.result || "");
      elements.batchLogoName.textContent = file.name;
      elements.batchRemoveLogo.disabled = false;
      schedulePreview();
    };
    reader.readAsDataURL(file);
  });

  elements.batchRemoveLogo.addEventListener("click", () => {
    state.logo = "";
    elements.batchLogoFile.value = "";
    elements.batchLogoName.textContent = "";
    elements.batchRemoveLogo.disabled = true;
    schedulePreview();
  });

  elements.resetBatchStyle.addEventListener("click", () => {
    elements.batchDotStyle.value = "rounded";
    elements.batchCornerStyle.value = "extra-rounded";
    elements.batchCornerDotStyle.value = "dot";
    elements.batchErrorCorrection.value = "Q";
    elements.batchQrSize.value = "600";
    elements.batchQrMargin.value = "16";
    elements.batchQrColor.value = "#111827";
    elements.batchBgColor.value = "#ffffff";
    elements.batchLogoSize.value = "0.28";
    elements.batchTransparentBg.checked = false;
    elements.batchBgColor.disabled = false;
    state.transparent = false;
    updateRangeOutputs();
    schedulePreview();
  });

  function setProgress(percent, message, detail = "") {
    const normalized = Math.max(0, Math.min(100, percent));
    elements.progressShell.classList.add("show");
    elements.progressMeta.classList.add("show");
    elements.progressBar.style.width = `${normalized}%`;
    elements.progressPercent.textContent = `${Math.round(normalized)}%`;
    elements.progressText.textContent = detail;
    elements.exportStatus.textContent = message;
  }

  function resetProgress() {
    elements.progressShell.classList.remove("show");
    elements.progressMeta.classList.remove("show");
    elements.progressBar.style.width = "0%";
    elements.progressPercent.textContent = "0%";
    elements.progressText.textContent = "";
  }

  function setGenerating(value) {
    state.generating = value;
    elements.cancelGeneration.disabled = !value;
    elements.generateZip.disabled = value || !state.records.length || state.records.length > MAX_VALID_ROWS;
    qsa("input, select, button", document).forEach(control => {
      if ([elements.cancelGeneration, elements.generateZip].includes(control)) return;
      if (control.closest(".language-switcher")) return;
      control.disabled = value || control.dataset.originallyDisabled === "true";
    });
    if (!value) {
      elements.sheetSelect.disabled = !state.workbook;
      elements.headerRow.disabled = !state.workbook;
      [elements.contentColumn, elements.filenameColumn, elements.labelColumn1, elements.labelColumn2].forEach(select => { select.disabled = !state.headers.length; });
      elements.batchRemoveLogo.disabled = !state.logo;
      elements.batchBgColor.disabled = state.transparent;
    }
  }

  const exportQr = new QRCodeStyling({ ...getStyle(600), type: "canvas" });
  exportQr.append(elements.batchQrEngine);

  function nextFrame() {
    return new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
  }

  async function renderQrBlob(data) {
    const style = getStyle();
    style.data = data;
    exportQr.update(style);
    await nextFrame();
    const blob = await exportQr.getRawData("png");
    if (!blob) throw new Error("PNG generation failed");
    return blob;
  }

  async function loadBlobImage(blob) {
    if (typeof createImageBitmap === "function") return createImageBitmap(blob);
    return new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(blob);
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = error => { URL.revokeObjectURL(url); reject(error); };
      image.src = url;
    });
  }

  function fitText(context, text, maxWidth) {
    if (context.measureText(text).width <= maxWidth) return text;
    let value = text;
    while (value.length > 1 && context.measureText(`${value}…`).width > maxWidth) value = value.slice(0, -1);
    return `${value}…`;
  }

  async function addLabelsToPng(qrBlob, labels) {
    if (!labels.length) return qrBlob;
    const size = Number(elements.batchQrSize.value);
    const fontSize = Math.max(15, Math.round(size * 0.037));
    const lineHeight = Math.round(fontSize * 1.45);
    const paddingTop = Math.round(fontSize * 0.75);
    const paddingBottom = Math.round(fontSize * 0.75);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size + paddingTop + paddingBottom + lineHeight * labels.length;
    const context = canvas.getContext("2d");
    if (!state.transparent) {
      context.fillStyle = elements.batchBgColor.value;
      context.fillRect(0, 0, canvas.width, canvas.height);
    } else {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
    const image = await loadBlobImage(qrBlob);
    context.drawImage(image, 0, 0, size, size);
    if (typeof image.close === "function") image.close();
    context.fillStyle = elements.batchQrColor.value;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `600 ${fontSize}px Inter, Arial, sans-serif`;
    labels.forEach((label, index) => {
      const y = size + paddingTop + lineHeight * index + lineHeight / 2;
      context.fillText(fitText(context, label, size - fontSize * 2), size / 2, y);
    });
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Canvas export failed")), "image/png");
    });
  }

  function uniqueFileName(baseName, used) {
    const key = baseName.toLocaleLowerCase();
    const current = used.get(key) || 0;
    used.set(key, current + 1);
    return current === 0 ? baseName : `${baseName}_${current + 1}`;
  }

  function csvEscape(value) {
    const text = String(value ?? "");
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function makeErrorCsv() {
    const header = ["source_row", "reason", "content"];
    const rows = state.errors.map(error => [error.row, error.reason, error.content]);
    return "\ufeff" + [header, ...rows].map(row => row.map(csvEscape).join(",")).join("\r\n");
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  elements.cancelGeneration.addEventListener("click", () => {
    if (state.generating) state.cancelRequested = true;
  });

  elements.generateZip.addEventListener("click", async () => {
    if (state.generating) return;
    if (!state.records.length) {
      showToast(t.noValidRows);
      return;
    }
    if (state.records.length > MAX_VALID_ROWS) {
      showToast(t.tooManyRows);
      return;
    }

    state.cancelRequested = false;
    setGenerating(true);
    resetProgress();
    const zip = new JSZip();
    const usedNames = new Map();

    try {
      for (let index = 0; index < state.records.length; index += 1) {
        if (state.cancelRequested) throw new DOMException("Cancelled", "AbortError");
        const record = state.records[index];
        const percent = (index / state.records.length) * 88;
        setProgress(percent, t.generating, `${index + 1} / ${state.records.length}`);
        let blob = await renderQrBlob(record.data);
        blob = await addLabelsToPng(blob, record.labels);
        const uniqueName = uniqueFileName(record.baseName, usedNames);
        zip.file(`${uniqueName}.png`, blob);
        if ((index + 1) % 5 === 0) await nextFrame();
      }

      if (state.errors.length) zip.file("skipped_rows.csv", makeErrorCsv());
      if (state.cancelRequested) throw new DOMException("Cancelled", "AbortError");

      setProgress(90, t.packing, "ZIP");
      const zipBlob = await zip.generateAsync(
        { type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } },
        metadata => setProgress(90 + metadata.percent * 0.1, t.packing, `${Math.round(metadata.percent)}%`)
      );
      downloadBlob(zipBlob, `${cleanZipName()}.zip`);
      setProgress(100, t.completed, `${state.records.length} PNG`);
      showToast(t.completed);
    } catch (error) {
      if (error?.name === "AbortError") {
        elements.exportStatus.textContent = t.cancelled;
        showToast(t.cancelled);
      } else {
        console.error(error);
        elements.exportStatus.textContent = t.exportFailed;
        showToast(t.exportFailed);
      }
    } finally {
      setGenerating(false);
      state.cancelRequested = false;
      setTimeout(() => {
        if (!state.generating) resetProgress();
        updateExportState();
      }, 1800);
    }
  });

  updateRangeOutputs();
  resetDataset();
  elements.exportStatus.textContent = t.exportReady;
})();
